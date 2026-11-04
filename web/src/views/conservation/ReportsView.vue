<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import ReportChart from '../../components/conservation/ReportChart.vue'
import {
  buildReportCsv,
  buildReportTable,
  filterAndSortReportRows,
  requestReport,
  type ApprovedPlantReport,
  type ReportSort,
} from '../../services/reporting'

type ReportType = 'species-approved' | 'observations' | 'threats' | 'iot' | 'camera' | 'custom-date'
const { t, locale } = useI18n()
const rt = (key: string, params: Record<string, string | number> = {}) =>
  t(`conservationPages.reports.${key}`, params)
const reportTypes: { id: ReportType; label: string; supported: boolean }[] = [
  { id: 'species-approved', label: 'speciesApprovedSummary', supported: true },
  { id: 'observations', label: 'observationSummary', supported: false },
  { id: 'threats', label: 'threatIncidentReport', supported: false },
  { id: 'iot', label: 'iotMonitoringReport', supported: false },
  { id: 'camera', label: 'cameraIncidentReport', supported: false },
  { id: 'custom-date', label: 'customDateReport', supported: false },
]
const reportType = ref<ReportType>('species-approved')
const report = ref<ApprovedPlantReport | null>(null)
const isLoading = ref(true)
const loadError = ref('')
const search = ref('')
const sort = ref<ReportSort>('scientific-asc')
const unsupportedMessage = ref('')
const toast = ref<{ tone: 'success' | 'error'; message: string } | null>(null)
const reportChart = ref<{ toDataUrl: () => string | null } | null>(null)

const selectedType = computed(() => reportTypes.find((item) => item.id === reportType.value)!)
const filteredRows = computed(() =>
  filterAndSortReportRows(report.value?.rows || [], search.value, sort.value))
const totalSpecies = computed(() => report.value?.rows.length || 0)
const totalApprovedPlants = computed(() =>
  report.value?.rows.reduce((sum, row) => sum + row.approvedPlants, 0) || 0)
const chartRows = computed(() =>
  [...(report.value?.rows || [])]
    .sort((a, b) => b.approvedPlants - a.approvedPlants || a.scientificName.localeCompare(b.scientificName))
    .slice(0, 12))
const chartSpec = computed(() => ({
  title: rt('chartTitle'),
  labels: chartRows.value.map((row) => row.commonName || row.scientificName),
  values: chartRows.value.map((row) => row.approvedPlants),
  colors: chartRows.value.map((_, index) => index % 2 ? '#65a556' : '#32745b'),
}))
const generatedAt = computed(() => {
  if (!report.value) return rt('unavailable')
  const parsed = new Date(report.value.generatedAt)
  if (Number.isNaN(parsed.getTime())) return rt('unavailable')
  const dateLocale = locale.value === 'zh-CN' ? 'zh-CN' : locale.value === 'ms' ? 'ms-MY' : 'en-MY'
  return new Intl.DateTimeFormat(dateLocale, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(parsed)
})

const errorMessage = (error: unknown, fallback: string) =>
  typeof error === 'object' && error !== null && 'message' in error &&
  typeof error.message === 'string' && error.message.trim() ? error.message : fallback

async function loadReport() {
  if (!selectedType.value.supported) {
    unsupportedMessage.value = rt('backendUnavailable')
    return
  }
  isLoading.value = true
  loadError.value = ''
  unsupportedMessage.value = ''
  try { report.value = await requestReport() }
  catch (error) {
    report.value = null
    loadError.value = errorMessage(error, rt('errors.load'))
  } finally { isLoading.value = false }
}
function chooseReportType() {
  if (!selectedType.value.supported) {
    unsupportedMessage.value = rt('backendUnavailable')
    return
  }
  unsupportedMessage.value = ''
  if (!report.value && !isLoading.value) void loadReport()
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
  if (!report.value || !filteredRows.value.length) return
  try {
    const csv = buildReportCsv(report.value, filteredRows.value)
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
    context.fillText(value, margin, y + size)
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
function exportPdf() {
  if (!report.value || !filteredRows.value.length) return
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
    let tableStart = 46
    const chartImage = reportChart.value?.toDataUrl()
    if (chartImage) {
      doc.addImage(chartImage, 'PNG', 14, 44, 175, 78)
      tableStart = 128
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

onMounted(loadReport)
</script>

<template>
  <section class="page-intro"><div><p class="page-kicker">{{ rt('eyebrow') }}</p><h2>{{ rt('title') }}</h2><p>{{ rt('intro') }}</p></div></section>
  <section class="panel reports-panel">
    <header class="panel-header"><div><h2>{{ rt('reportType') }}</h2><span class="panel-description">{{ rt('supportedDescription') }}</span></div></header>
    <div class="report-type-grid" role="list">
      <label v-for="item in reportTypes" :key="item.id" class="report-type-option" :class="{ unsupported: !item.supported }">
        <input v-model="reportType" type="radio" :value="item.id" :disabled="!item.supported" @change="chooseReportType" />
        <span><strong>{{ rt(item.label) }}</strong><small>{{ item.supported ? rt('realBackendReport') : rt('backendUnavailable') }}</small></span>
      </label>
    </div>

    <p v-if="unsupportedMessage" class="unsupported-note" role="status">{{ unsupportedMessage }}</p>
    <div class="scope-note"><strong>{{ rt('dataScope') }}</strong><span>{{ rt('allAvailableData') }}</span><small>{{ rt('dateUnsupported') }}</small></div>

    <div class="control-bar report-controls">
      <label class="field search-field"><span>{{ rt('search') }}</span><input v-model="search" :placeholder="rt('searchPlaceholder')" :disabled="!report" /></label>
      <label class="field"><span>{{ rt('sort') }}</span><select v-model="sort" :disabled="!report"><option value="scientific-asc">{{ rt('sortScientific') }}</option><option value="approved-desc">{{ rt('sortApprovedDesc') }}</option><option value="approved-asc">{{ rt('sortApprovedAsc') }}</option></select></label>
      <button class="secondary-button" type="button" :disabled="isLoading" @click="loadReport">{{ rt('refresh') }}</button>
    </div>

    <div v-if="isLoading" class="report-state" role="status" aria-live="polite">{{ rt('loading') }}</div>
    <div v-else-if="loadError" class="report-state error" role="alert"><strong>{{ rt('loadFailed') }}</strong><span>{{ loadError }}</span><button class="primary-button" type="button" @click="loadReport">{{ rt('retry') }}</button></div>
    <article v-else-if="report" class="report-preview">
      <header class="report-title"><p class="section-kicker">{{ rt('realBackendReport') }}</p><h2>{{ rt('speciesApprovedSummary') }}</h2><p>{{ rt('generatedAt') }}: <strong>{{ generatedAt }}</strong></p></header>
      <div class="metric-grid"><div class="metric"><span>{{ rt('totalSpecies') }}</span><strong>{{ totalSpecies }}</strong></div><div class="metric"><span>{{ rt('totalApprovedPlants') }}</span><strong>{{ totalApprovedPlants }}</strong></div><div class="metric"><span>{{ rt('matchingRows') }}</span><strong>{{ filteredRows.length }}</strong></div></div>
      <ReportChart v-if="report.rows.length" ref="reportChart" :title="chartSpec.title" :labels="chartSpec.labels" :values="chartSpec.values" :colors="chartSpec.colors" />
      <p v-if="report.rows.length > chartRows.length" class="chart-note">{{ rt('chartLimit', { count: chartRows.length }) }}</p>
      <div class="table-scroll"><table><thead><tr><th>{{ rt('scientificName') }}</th><th>{{ rt('commonName') }}</th><th>{{ rt('approvedPlants') }}</th></tr></thead><tbody><tr v-for="row in filteredRows" :key="row.scientificName"><td><em>{{ row.scientificName }}</em></td><td>{{ row.commonName || rt('unavailable') }}</td><td>{{ row.approvedPlants }}</td></tr><tr v-if="!filteredRows.length"><td colspan="3" class="empty-row">{{ report.rows.length ? rt('noMatches') : rt('empty') }}</td></tr></tbody></table></div>
      <div class="modal-actions report-actions"><button type="button" class="secondary-button" :disabled="!filteredRows.length" @click="exportPdf">{{ rt('exportPdf') }}</button><button type="button" class="secondary-button" :disabled="!filteredRows.length" @click="exportCsv">{{ rt('exportCsv') }}</button></div>
      <p class="persistence-note">{{ rt('downloadOnly') }}</p>
    </article>
  </section>
  <div v-if="toast" class="toast" :class="toast.tone" :role="toast.tone === 'error' ? 'alert' : 'status'">{{ toast.message }}</div>
</template>

<style scoped>
.reports-panel { display: grid; gap: 20px; }
.report-type-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 12px; }
.report-type-option { display: flex; gap: 10px; padding: 15px; border: 1px solid #dce6de; border-radius: 12px; background: #fff; }
.report-type-option span, .report-type-option small { display: block; }
.report-type-option small { margin-top: 5px; color: #71827a; font-size: 10px; }
.report-type-option.unsupported { background: #f4f4ef; color: #7b817d; }
.unsupported-note, .scope-note, .persistence-note, .chart-note { padding: 12px 14px; border-radius: 10px; background: #f4f7f2; color: #63776d; font-size: 11px; }
.scope-note { display: flex; flex-wrap: wrap; gap: 8px 18px; }
.scope-note small { flex-basis: 100%; }
.report-controls { margin: 0; }
.report-state { padding: 45px 20px; text-align: center; color: #64776e; }
.report-state span { display: block; margin: 7px 0 14px; }
.report-state.error { color: #9b3d35; }
.report-title p { color: #64776e; }
.report-actions { padding-top: 18px; border-top: 1px solid #edf0ed; }
.persistence-note { margin-bottom: 0; }
.toast.error { background: #8f3128; }
@media (max-width: 800px) { .report-type-grid { grid-template-columns: repeat(2,minmax(0,1fr)); } }
@media (max-width: 520px) { .report-type-grid { grid-template-columns: 1fr; } .report-preview { padding: 18px; } .metric-grid { grid-template-columns: 1fr; } }
</style>
