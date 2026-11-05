<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import ReportChart from '../../components/conservation/ReportChart.vue'
import {
  buildReportCsv,
  buildReportTable,
  filterAndSortReportRows,
  requestReport,
  reportRequestUrl,
  type ReportFilters,
  type ReportPeriod,
  type ApprovedPlantReport,
  type ReportSort,
} from '../../services/reporting'

const { t, locale } = useI18n()
const rt = (key: string, params: Record<string, string | number> = {}) =>
  t(`conservationPages.reports.${key}`, params)
const reportType = ref('species-approved')
const pendingPeriod = ref<ReportPeriod>('all-time')
const pendingStart = ref('')
const pendingEnd = ref('')
const appliedFilters = ref<ReportFilters>({ period: 'all-time' })
const filterError = ref('')
const retryFilters = ref<ReportFilters>({ period: 'all-time' })
let requestSequence = 0
onBeforeUnmount(() => { requestSequence++ })
const report = ref<ApprovedPlantReport | null>(null)
const isLoading = ref(true)
const loadError = ref('')
const search = ref('')
const sort = ref<ReportSort>('scientific-asc')
const toast = ref<{ tone: 'success' | 'error'; message: string } | null>(null)
const reportChart = ref<{ toDataUrl: () => string | null } | null>(null)

const filteredRows = computed(() =>
  filterAndSortReportRows(report.value?.rows || [], search.value, sort.value))
const totalSpecies = computed(() => report.value?.rows.length || 0)
const totalApprovedPlants = computed(() =>
  filteredRows.value.reduce((sum, row) => sum + row.approvedPlants, 0))
const chartRows = computed(() =>
  [...filteredRows.value]
    .sort((a, b) => b.approvedPlants - a.approvedPlants || a.scientificName.localeCompare(b.scientificName))
    .slice(0, 12))
const chartSpec = computed(() => ({
  title: rt('chartTitle'),
  labels: chartRows.value.map((row) => row.commonName || row.scientificName),
  values: chartRows.value.map((row) => row.approvedPlants),
  colors: chartRows.value.map((_, index) => index % 2 ? '#65a556' : '#32745b'),
}))
const appliedScope = computed(() => {
  const scope = report.value?.scope
  return `${scope?.startDate ? `${scope.startDate} to ${scope.endDate}` : rt('periodAllTime')} | Asia/Kuala_Lumpur`
})
// Page copy uses the returned snapshot; export metadata retains its existing scope.
const appliedPeriodLabel = computed(() => {
  const scope = report.value?.scope
  const period = scope?.period || 'all-time'
  let label = rt(period === 'this-month' ? 'periodThisMonth' : period === 'last-month' ? 'periodLastMonth' : 'periodAllTime')
  if (period === 'custom' && scope?.startDate && scope.endDate) {
    const dateLocale = locale.value === 'zh-CN' ? 'zh-CN' : locale.value === 'ms' ? 'ms-MY' : 'en-GB'
    label = new Intl.DateTimeFormat(dateLocale, {
      timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', year: 'numeric',
    }).formatRange(new Date(`${scope.startDate}T12:00:00+08:00`), new Date(`${scope.endDate}T12:00:00+08:00`))
  }
  return rt('appliedPeriod', { period: label })
})
const generatedAt = computed(() => {
  if (!report.value) return rt('unavailable')
  const parsed = new Date(report.value.generatedAt)
  if (Number.isNaN(parsed.getTime())) return rt('unavailable')
  const dateLocale = locale.value === 'zh-CN' ? 'zh-CN' : locale.value === 'ms' ? 'ms-MY' : 'en-MY'
  return new Intl.DateTimeFormat(dateLocale, {
    timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(parsed)
})

const errorMessage = (error: unknown, fallback: string) =>
  typeof error === 'object' && error !== null && 'message' in error &&
  typeof error.message === 'string' && error.message.trim() ? error.message : fallback

async function loadReport(filters: ReportFilters = appliedFilters.value) {
  const sequence = ++requestSequence
  const snapshot = { ...filters }
  retryFilters.value = snapshot
  isLoading.value = true
  loadError.value = ''
  try {
    const result = await requestReport(snapshot)
    if (sequence !== requestSequence) return
    report.value = result
    appliedFilters.value = snapshot
  } catch (error) {
    if (sequence !== requestSequence) return
    report.value = null
    loadError.value = errorMessage(error, rt('errors.load'))
  } finally { if (sequence === requestSequence) isLoading.value = false }
}
async function applyFilters() {
  filterError.value = ''
  const filters: ReportFilters = { period: pendingPeriod.value,
    ...(pendingPeriod.value === 'custom' ? { start: pendingStart.value, end: pendingEnd.value } : {}) }
  try { reportRequestUrl(filters) }
  catch { filterError.value = rt('invalidRange'); return }
  await loadReport(filters)
}
async function resetFilters() {
  reportType.value = 'species-approved'
  pendingPeriod.value = 'all-time'; pendingStart.value = ''; pendingEnd.value = ''
  search.value = ''; sort.value = 'scientific-asc'; filterError.value = ''
  await loadReport({ period: 'all-time' })
}

const filename = (extension: 'csv' | 'pdf') => {
  const date = report.value?.generatedAt.slice(0, 10) || 'report'
  return `niah-species-approved-plants-${date}.${extension}`
}
const downloadBlob = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
function exportCsv() {
  if (isLoading.value || !report.value || !filteredRows.value.length) return
  try {
    const csv = buildReportCsv(report.value, filteredRows.value, search.value.trim())
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename('csv'))
    toast.value = { tone: 'success', message: rt('csvDownloaded') }
  } catch {
    toast.value = { tone: 'error', message: rt('errors.export') }
  }
}
function exportUnicodePdf() {
  if (!report.value) return
  const table = buildReportTable(filteredRows.value)
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm' })
  const canvas = document.createElement('canvas')
  canvas.width = 1600
  canvas.height = 2263
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas unavailable')
  const margin = 72
  const widths = [650, 550, 250]
  let y = margin
  let page = 0
  const reset = () => {
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    y = margin
  }
  const flush = () => {
    if (page++) doc.addPage()
    doc.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 210, 297)
    reset()
  }
  const line = (value: string, size = 28, bold = false, color = '#204b3c') => {
    if (y + size * 1.6 > canvas.height - margin) flush()
    context.font = `${bold ? 'bold ' : ''}${size}px sans-serif`
    context.fillStyle = color
    context.fillText(value, margin, y + size, canvas.width - margin * 2)
    y += size * 1.5
  }
  const drawTableHeader = () => {
    context.fillStyle = '#32745b'
    context.fillRect(margin, y, widths.reduce((sum, width) => sum + width, 0), 58)
    context.font = 'bold 22px sans-serif'
    context.fillStyle = '#fff'
    let x = margin
    ;[rt('scientificName'), rt('commonName'), rt('approvedPlants')].forEach((value, index) => {
      context.fillText(value, x + 12, y + 36)
      x += widths[index]!
    })
    y += 58
  }
  reset()
  line(rt('speciesApprovedSummary'), 42, true)
  line(`${rt('generatedAt')}: ${generatedAt.value}`, 24)
  line(`${rt('totalSpecies')}: ${totalSpecies.value}`, 24)
  line(`${rt('totalApprovedPlants')}: ${totalApprovedPlants.value}`, 24)
  line(`${rt('matchingRows')}: ${filteredRows.value.length}`, 24)
  line(rt('registrationScope'), 24)
  line(appliedScope.value, 24)
  if (search.value.trim()) line(`${rt('search')}: ${search.value.trim()}`, 24)
  y += 18
  const maximum = Math.max(...chartRows.value.map((row) => row.approvedPlants), 1)
  chartRows.value.forEach((row) => {
    if (y + 54 > canvas.height - margin) flush()
    const label = row.commonName || row.scientificName
    context.font = '20px sans-serif'
    context.fillStyle = '#315447'
    context.fillText(`${label}: ${row.approvedPlants}`, margin, y + 20)
    context.fillStyle = '#65a556'
    context.fillRect(margin, y + 28, ((canvas.width - margin * 2) * row.approvedPlants) / maximum, 16)
    y += 54
  })
  y += 20
  drawTableHeader()
  table.rows.forEach((row, rowIndex) => {
    if (y + 54 > canvas.height - margin) {
      flush()
      drawTableHeader()
    }
    context.fillStyle = rowIndex % 2 ? '#f3f7f3' : '#fff'
    context.fillRect(margin, y, widths.reduce((sum, width) => sum + width, 0), 54)
    context.font = '21px sans-serif'
    context.fillStyle = '#204b3c'
    let x = margin
    row.forEach((value, index) => {
      context.fillText(String(value), x + 12, y + 34, widths[index]! - 24)
      x += widths[index]!
    })
    y += 54
  })
  flush()
  doc.save(filename('pdf'))
}
async function exportPdf() {
  await nextTick()
  await nextTick()
  if (isLoading.value || !report.value || !filteredRows.value.length) return
  try {
    if (locale.value === 'zh-CN') {
      exportUnicodePdf()
      toast.value = { tone: 'success', message: rt('pdfDownloaded') }
      return
    }
    const table = buildReportTable(filteredRows.value)
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm' })
    doc.setTextColor(32, 75, 60)
    doc.setFontSize(16)
    doc.text(rt('speciesApprovedSummary'), 14, 18)
    doc.setFontSize(9)
    doc.text(`${rt('generatedAt')}: ${generatedAt.value}`, 14, 26)
    doc.text(`${rt('totalSpecies')}: ${totalSpecies.value}`, 14, 32)
    doc.text(`${rt('totalApprovedPlants')}: ${totalApprovedPlants.value}`, 14, 38)
    doc.text(`${rt('matchingRows')}: ${filteredRows.value.length}`, 14, 44)
    doc.text(rt('registrationScope'), 14, 50)
    doc.text(appliedScope.value, 14, 56)
    if (search.value.trim()) doc.text(`${rt('search')}: ${search.value.trim()}`, 14, 62)
    let tableStart = 70
    const chartImage = reportChart.value?.toDataUrl()
    if (chartImage) {
      doc.addImage(chartImage, 'PNG', 14, 68, 175, 78)
      tableStart = 152
    }
    autoTable(doc, {
      startY: tableStart,
      head: [[rt('scientificName'), rt('commonName'), rt('approvedPlants')]],
      body: table.rows,
      theme: 'grid',
      headStyles: { fillColor: [50, 116, 91] },
      styles: { fontSize: 8 },
    })
    doc.save(filename('pdf'))
    toast.value = { tone: 'success', message: rt('pdfDownloaded') }
  } catch {
    toast.value = { tone: 'error', message: rt('errors.export') }
  }
}

onMounted(() => loadReport())
</script>

<template>
  <section class="page-intro"><div><p class="page-kicker">{{ rt('eyebrow') }}</p><h2>{{ rt('title') }}</h2><p>{{ rt('intro') }}</p></div></section>
  <section class="panel reports-panel">
    <form class="control-bar report-filters" aria-labelledby="report-filters-title" @submit.prevent="applyFilters">
      <h3 id="report-filters-title" class="filter-heading">{{ rt('filters') }}</h3>
      <label class="field category-field" for="report-category"><span>{{ rt('reportCategory') }}</span><select id="report-category" v-model="reportType"><option value="species-approved">{{ rt('speciesApprovedSummary') }}</option></select></label>
      <label class="field" for="report-period"><span>{{ rt('reportingPeriod') }}</span><select id="report-period" v-model="pendingPeriod"><option value="all-time">{{ rt('periodAllTime') }}</option><option value="this-month">{{ rt('periodThisMonth') }}</option><option value="last-month">{{ rt('periodLastMonth') }}</option><option value="custom">{{ rt('periodCustom') }}</option></select></label>
      <template v-if="pendingPeriod === 'custom'">
        <label class="field" for="report-start"><span>{{ rt('startDate') }}</span><input id="report-start" v-model="pendingStart" type="date" required :aria-invalid="Boolean(filterError)" aria-describedby="report-filter-error" /></label>
        <label class="field" for="report-end"><span>{{ rt('endDate') }}</span><input id="report-end" v-model="pendingEnd" type="date" required :aria-invalid="Boolean(filterError)" aria-describedby="report-filter-error" /></label>
      </template>
      <div class="filter-actions"><button class="primary-button" type="submit" :disabled="isLoading">{{ rt('apply') }}</button><button class="secondary-button" type="button" @click="resetFilters">{{ rt('reset') }}</button></div>
      <p v-if="filterError" id="report-filter-error" class="filter-error" role="alert">{{ filterError }}</p>
    </form>

    <div class="control-bar report-controls">
      <label class="field search-field"><span>{{ rt('search') }}</span><input v-model="search" :placeholder="rt('searchPlaceholder')" :disabled="!report" /></label>
      <label class="field"><span>{{ rt('sort') }}</span><select v-model="sort" :disabled="!report"><option value="scientific-asc">{{ rt('sortScientific') }}</option><option value="approved-desc">{{ rt('sortApprovedDesc') }}</option><option value="approved-asc">{{ rt('sortApprovedAsc') }}</option></select></label>
      <button class="secondary-button" type="button" :disabled="isLoading" @click="loadReport()">{{ rt('refresh') }}</button>
    </div>

    <div v-if="isLoading" class="report-state" role="status" aria-live="polite">{{ rt('loading') }}</div>
    <div v-else-if="loadError" class="report-state error" role="alert"><strong>{{ rt('loadFailed') }}</strong><span>{{ loadError }}</span><button class="primary-button" type="button" @click="loadReport(retryFilters)">{{ rt('retry') }}</button></div>
    <article v-else-if="report" class="report-preview">
      <header class="report-title"><h2>{{ rt('speciesApprovedSummary') }}</h2><p class="applied-scope">{{ appliedPeriodLabel }}</p><p>{{ rt('generatedAt') }}: <strong>{{ generatedAt }}</strong></p></header>
      <div class="metric-grid"><div class="metric"><span>{{ rt('totalSpecies') }}</span><strong>{{ totalSpecies }}</strong></div><div class="metric"><span>{{ rt('totalApprovedPlants') }}</span><strong>{{ totalApprovedPlants }}</strong></div><div class="metric"><span>{{ rt('matchingRows') }}</span><strong>{{ filteredRows.length }}</strong></div></div>
      <p v-if="filteredRows.length && totalApprovedPlants === 0" class="chart-note" role="status">{{ rt('noPlantsInPeriod') }}</p>
      <ReportChart v-if="filteredRows.length" ref="reportChart" :title="chartSpec.title" :labels="chartSpec.labels" :values="chartSpec.values" :colors="chartSpec.colors" />
      <p v-if="filteredRows.length > chartRows.length" class="chart-note">{{ rt('chartLimit', { count: chartRows.length }) }}</p>
      <div class="table-scroll"><table><thead><tr><th>{{ rt('scientificName') }}</th><th>{{ rt('commonName') }}</th><th>{{ rt('approvedPlants') }}</th></tr></thead><tbody><tr v-for="row in filteredRows" :key="row.speciesId || row.scientificName"><td><em>{{ row.scientificName }}</em></td><td>{{ row.commonName || rt('unavailable') }}</td><td>{{ row.approvedPlants }}</td></tr><tr v-if="!filteredRows.length"><td colspan="3" class="empty-row">{{ report.rows.length ? rt('noMatches') : rt('empty') }}</td></tr></tbody></table></div>
      <div class="modal-actions report-actions"><button type="button" class="secondary-button" :disabled="isLoading || !filteredRows.length" @click="exportPdf">{{ rt('exportPdf') }}</button><button type="button" class="secondary-button" :disabled="isLoading || !filteredRows.length" @click="exportCsv">{{ rt('exportCsv') }}</button></div>
      <p class="persistence-note">{{ rt('downloadOnly') }}</p>
    </article>
  </section>
  <div v-if="toast" class="toast" :class="toast.tone" :role="toast.tone === 'error' ? 'alert' : 'status'">{{ toast.message }}</div>
</template>

<style scoped>
.reports-panel { display: grid; gap: 20px; }
.report-filters { margin: 0; gap: 14px; }
.filter-heading { flex-basis: 100%; margin: 0; color: #315749; font-size: 13px; }
.category-field { flex: 1.6; }
.filter-actions { display: flex; gap: 8px; }
.filter-error { flex-basis: 100%; margin: 0; color: #9b3d35; font-size: 12px; }
.persistence-note, .chart-note { color: #63776d; font-size: 11px; }
.applied-scope { line-height: 1.6; }
.report-controls { margin: 0; }
.report-state { padding: 45px 20px; text-align: center; color: #64776e; }
.report-state span { display: block; margin: 7px 0 14px; }
.report-state.error { color: #9b3d35; }
.report-title p { color: #64776e; }
.report-actions { padding-top: 18px; border-top: 1px solid #edf0ed; }
.persistence-note { margin-bottom: 0; }
.toast.error { background: #8f3128; }

@media (max-width: 520px) { .filter-actions > button { flex: 1; } .report-preview { padding: 18px; } .metric-grid { grid-template-columns: 1fr; } }
</style>
