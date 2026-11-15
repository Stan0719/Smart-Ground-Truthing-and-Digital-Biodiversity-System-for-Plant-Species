<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { jsPDF } from 'jspdf'
import OperationalReport from '../../components/conservation/OperationalReport.vue'
import type { OperationalCategory } from '../../services/operationalReporting'
import { reportCsv, reportFilename, renderReportPdf, type ReportDocument } from '../../utils/reportExport'
import ReportChart from '../../components/conservation/ReportChart.vue'
import {
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
const operationalFilters = ref<ReportFilters>({ period: 'all-time' })
const operationalBusy = ref(false)
watch(reportType, category => {
  operationalBusy.value = false
  if (category === 'species-approved') void loadReport()
  else { requestSequence++; isLoading.value = false; operationalFilters.value = { ...appliedFilters.value } }
})
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
const reportChart = ref<{ toDataUrl: () => string | null; toPrintDataUrl: () => Promise<string | null> } | null>(null)
const exporting = ref(false)

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
// Both page and exports label the returned snapshot, never pending filter inputs.
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
    operationalFilters.value = { ...snapshot }
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
  if (reportType.value !== 'species-approved') { appliedFilters.value = { ...filters }; operationalFilters.value = { ...filters }; return }
  await loadReport(filters)
}
async function resetFilters() {
  const switchingCategory = reportType.value !== 'species-approved'
  operationalFilters.value = { period: 'all-time' }
  appliedFilters.value = { period: 'all-time' }
  pendingPeriod.value = 'all-time'; pendingStart.value = ''; pendingEnd.value = ''
  search.value = ''; sort.value = 'scientific-asc'; filterError.value = ''
  if (switchingCategory) { reportType.value = 'species-approved'; await nextTick(); return }
  await loadReport({ period: 'all-time' })
}

const exportDocument = (): ReportDocument => {
  const result = report.value!
  const columns = [rt('scientificName'), rt('commonName'), rt('approvedPlants')]
  return {
    category: 'species-approved', title: rt('speciesApprovedSummary'), period: appliedPeriodLabel.value,
    timezone: t('conservationPages.reports.operational.malaysiaTime'), generatedAt: result.generatedAt,
    generatedLabel: `${rt('generatedAt')}: ${generatedAt.value}`,
    statistics: [
      { label: rt('totalSpecies'), value: totalSpecies.value, display: String(totalSpecies.value), background: '#f2f7f2', ink: '#295340' },
      { label: rt('totalApprovedPlants'), value: totalApprovedPlants.value, display: String(totalApprovedPlants.value), background: '#f2f7f2', ink: '#295340' },
      { label: rt('matchingRows'), value: filteredRows.value.length, display: String(filteredRows.value.length), background: '#f2f7f2', ink: '#295340' },
    ], columns,
    rows: filteredRows.value.map(row => [row.scientificName, row.commonName, row.approvedPlants]),
    displayRows: filteredRows.value.map(row => [row.scientificName, row.commonName || rt('unavailable'), String(row.approvedPlants)]),
    chart: chartRows.value.map(row => ({ series: rt('chartTitle'), point: row.commonName || row.scientificName, value: row.approvedPlants, unit: rt('approvedPlants') })),
    context: search.value.trim() ? [{ label: rt('search'), value: search.value.trim() }] : [],
  }
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
  if (isLoading.value || exporting.value || reportType.value !== 'species-approved' || !report.value || !filteredRows.value.length) return
  try {
    const model = exportDocument()
    downloadBlob(new Blob([reportCsv(model)], { type: 'text/csv;charset=utf-8' }), reportFilename(model, 'csv'))
    toast.value = { tone: 'success', message: rt('csvDownloaded') }
  } catch { toast.value = { tone: 'error', message: rt('errors.export') } }
}
async function exportPdf() {
  if (isLoading.value || exporting.value || reportType.value !== 'species-approved' || !report.value || !filteredRows.value.length) return
  const snapshot = report.value, query = search.value, ordering = sort.value, sequence = requestSequence, language = locale.value
  const current = () => !isLoading.value && report.value === snapshot && reportType.value === 'species-approved' && search.value === query && sort.value === ordering && sequence === requestSequence && locale.value === language
  exporting.value = true
  try {
    const model = exportDocument()
    await nextTick()
    const chartImage = chartSpec.value.values.some(value => value > 0) ? await reportChart.value?.toPrintDataUrl() : null
    if (!current()) return
    if (chartSpec.value.values.some(value => value > 0) && !chartImage) throw new Error('Chart unavailable')
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm' })
    if (await renderReportPdf(model, chartImage || null, pdf, current) && current()) {
      pdf.save(reportFilename(model, 'pdf'))
      toast.value = { tone: 'success', message: rt('pdfDownloaded') }
    }
  } catch { if (current()) toast.value = { tone: 'error', message: rt('errors.export') } }
  finally { exporting.value = false }
}

onMounted(() => loadReport())
</script>

<template>
  <section class="page-intro"><div><p class="page-kicker">{{ rt('eyebrow') }}</p><h2>{{ rt('title') }}</h2><p>{{ rt('intro') }}</p></div></section>
  <section class="panel reports-panel">
    <form class="control-bar report-filters" :class="{ 'custom-period': pendingPeriod === 'custom' }" aria-labelledby="report-filters-title" @submit.prevent="applyFilters">
      <h3 id="report-filters-title" class="filter-heading">{{ rt('filters') }}</h3>
      <label class="field category-field" for="report-category"><span>{{ rt('reportCategory') }}</span><select id="report-category" v-model="reportType"><option value="species-approved">{{ rt('speciesApprovedSummary') }}</option><option value="observations">{{ rt('observationSummary') }}</option><option value="threats">{{ rt('threatIncidentReport') }}</option><option value="iot">{{ rt('iotMonitoringReport') }}</option></select></label>
      <label class="field" for="report-period"><span>{{ rt('reportingPeriod') }}</span><select id="report-period" v-model="pendingPeriod"><option value="all-time">{{ rt('periodAllTime') }}</option><option value="this-month">{{ rt('periodThisMonth') }}</option><option value="last-month">{{ rt('periodLastMonth') }}</option><option value="custom">{{ rt('periodCustom') }}</option></select></label>
      <template v-if="pendingPeriod === 'custom'">
        <label class="field" for="report-start"><span>{{ rt('startDate') }}</span><input id="report-start" v-model="pendingStart" type="date" required :aria-invalid="Boolean(filterError)" aria-describedby="report-filter-error" /></label>
        <label class="field" for="report-end"><span>{{ rt('endDate') }}</span><input id="report-end" v-model="pendingEnd" type="date" required :aria-invalid="Boolean(filterError)" aria-describedby="report-filter-error" /></label>
      </template>
      <div class="filter-actions"><button class="primary-button report-toolbar-button" type="submit" :disabled="isLoading || operationalBusy">{{ rt('apply') }}</button><button class="secondary-button report-toolbar-button" type="button" @click="resetFilters">{{ rt('reset') }}</button></div>
      <p v-if="filterError" id="report-filter-error" class="filter-error" role="alert">{{ filterError }}</p>
    </form>

    <OperationalReport v-if="reportType !== 'species-approved'" :key="reportType" :category="reportType as OperationalCategory" :filters="operationalFilters" @busy="operationalBusy = $event" />
    <template v-else>
    <div class="control-bar report-controls">
      <label class="field search-field"><span>{{ rt('search') }}</span><input v-model="search" :placeholder="rt('searchPlaceholder')" :disabled="!report" /></label>
      <label class="field"><span>{{ rt('sort') }}</span><select v-model="sort" :disabled="!report"><option value="scientific-asc">{{ rt('sortScientific') }}</option><option value="approved-desc">{{ rt('sortApprovedDesc') }}</option><option value="approved-asc">{{ rt('sortApprovedAsc') }}</option></select></label>
      <button class="secondary-button report-toolbar-button" type="button" :disabled="isLoading" @click="loadReport()">{{ rt('refresh') }}</button>
    </div>

    <div v-if="isLoading" class="report-state" role="status" aria-live="polite">{{ rt('loading') }}</div>
    <div v-else-if="loadError" class="report-state error" role="alert"><strong>{{ rt('loadFailed') }}</strong><span>{{ loadError }}</span><button class="primary-button" type="button" @click="loadReport(retryFilters)">{{ rt('retry') }}</button></div>
    <article v-else-if="report" class="report-preview">
      <header class="report-title"><h2>{{ rt('speciesApprovedSummary') }}</h2><p class="applied-scope">{{ appliedPeriodLabel }}</p><p>{{ rt('generatedAt') }}: <strong>{{ generatedAt }}</strong></p></header>
      <div class="metric-grid"><div class="metric"><span>{{ rt('totalSpecies') }}</span><strong>{{ totalSpecies }}</strong></div><div class="metric"><span>{{ rt('totalApprovedPlants') }}</span><strong>{{ totalApprovedPlants }}</strong></div><div class="metric"><span>{{ rt('matchingRows') }}</span><strong>{{ filteredRows.length }}</strong></div></div>
      <p v-if="filteredRows.length && totalApprovedPlants === 0" class="chart-note" role="status">{{ rt('noPlantsInPeriod') }}</p>
      <ReportChart v-if="filteredRows.length" ref="reportChart" :title="chartSpec.title" :labels="chartSpec.labels" :values="chartSpec.values" :colors="chartSpec.colors" />
      <p v-if="filteredRows.length > chartRows.length" class="chart-note">{{ rt('chartLimit', { count: chartRows.length }) }}</p>
      <div class="table-scroll officer-table-scroll" role="region" :aria-label="rt('speciesApprovedSummary')" tabindex="0">
        <table class="officer-data-table report-summary-table"><colgroup><col class="column-report-scientific" /><col class="column-report-common" /><col class="column-report-count" /></colgroup><thead><tr><th scope="col">{{ rt('scientificName') }}</th><th scope="col">{{ rt('commonName') }}</th><th scope="col">{{ rt('approvedPlants') }}</th></tr></thead><tbody><tr v-for="row in filteredRows" :key="row.speciesId || row.scientificName"><td><em>{{ row.scientificName }}</em></td><td>{{ row.commonName || rt('unavailable') }}</td><td>{{ row.approvedPlants }}</td></tr><tr v-if="!filteredRows.length"><td colspan="3" class="empty-row">{{ report.rows.length ? rt('noMatches') : rt('empty') }}</td></tr></tbody></table></div>
      <div class="modal-actions report-actions"><button type="button" class="secondary-button" :disabled="isLoading || exporting || !filteredRows.length" @click="exportPdf">{{ rt('exportPdf') }}</button><button type="button" class="secondary-button" :disabled="isLoading || exporting || !filteredRows.length" @click="exportCsv">{{ rt('exportCsv') }}</button></div>
      <p class="persistence-note">{{ rt('downloadOnly') }}</p>
    </article>
    </template>
  </section>
  <div v-if="toast" class="toast" :class="toast.tone" :role="toast.tone === 'error' ? 'alert' : 'status'">{{ toast.message }}</div>
</template>

<style scoped>
.reports-panel { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; min-width: 0; max-width: 100%; box-sizing: border-box; container-type: inline-size; }
.reports-panel > *, .report-preview, .report-title { min-width: 0; max-width: 100%; box-sizing: border-box; }
.report-title, .report-state, .filter-error { overflow-wrap: anywhere; }
.officer-layout.officer-layout.officer-layout .reports-panel :is(.report-filters, .report-controls) { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr) auto; align-items: stretch; }
.officer-layout.officer-layout.officer-layout .reports-panel .control-bar > .field { min-width: 0; max-width: 100%; grid-template-rows: 1fr auto; }
.officer-layout.officer-layout.officer-layout .reports-panel .control-bar :is(input, select) { box-sizing: border-box; min-width: 0; width: 100%; max-width: 100%; min-height: 2.75rem; font-size: .875rem; }
.officer-layout.officer-layout.officer-layout .reports-panel .report-filters.custom-period { grid-template-columns: repeat(4, minmax(0, 1fr)) auto; }
.reports-panel .filter-heading, .reports-panel .filter-error { grid-column: 1 / -1; }
.reports-panel .filter-actions { min-width: 0; max-width: 100%; justify-self: start; }
.officer-layout.officer-layout.officer-layout .reports-panel .metric-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); min-width: 0; gap: 12px; }
.officer-layout.officer-layout.officer-layout .reports-panel .metric-grid .metric { min-width: 0; min-height: 0; height: auto; padding: 14px; display: flex; flex-direction: column; justify-content: flex-start; gap: 6px; }
.officer-layout.officer-layout.officer-layout .reports-panel .metric-grid .metric span { font-size: .8125rem; line-height: 1.4; }
.officer-layout.officer-layout.officer-layout .reports-panel .metric-grid .metric strong { margin: 0; font-size: 1.5rem; line-height: 1.25; }
.officer-layout.officer-layout.officer-layout .reports-panel .officer-table-scroll { min-width: 0; max-width: 100%; width: 100%; overflow-x: auto; overscroll-behavior-inline: contain; }
.officer-layout.officer-layout.officer-layout .reports-panel .report-summary-table { min-width: 38rem; }
.report-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.report-actions > button, .filter-actions > button { flex: 0 0 auto; white-space: nowrap; max-width: 100%; }
@container (max-width: 900px) {
  .officer-layout.officer-layout.officer-layout .reports-panel :is(.report-filters, .report-filters.custom-period, .report-controls) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .reports-panel .filter-actions { grid-column: 1 / -1; }
}
@container (max-width: 800px) { .officer-layout.officer-layout.officer-layout .reports-panel .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container (max-width: 520px) {
  .officer-layout.officer-layout.officer-layout .reports-panel .metric-grid { grid-template-columns: minmax(0, 1fr); }
  .officer-layout.officer-layout.officer-layout .reports-panel :is(.report-filters, .report-filters.custom-period, .report-controls) { grid-template-columns: minmax(0, 1fr); }
}
.report-filters { margin: 0; gap: 14px; }
.filter-heading { flex-basis: 100%; margin: 0; color: #315749; font-size: 13px; }
.category-field { flex: 1.6; }
.filter-actions { display: flex; align-items: center; align-self: flex-end; flex-wrap: wrap; gap: 8px; }
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

/* Beat shared Officer minimum-height/stretch rules only for these three controls. */
.officer-layout.officer-layout.officer-layout .reports-panel .control-bar .report-toolbar-button {
  position: relative;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: flex-end;
  justify-self: start;
  flex: 0 0 auto;
  width: auto;
  height: 40px;
  min-height: 40px;
  padding: 0 15px;
  border-radius: 9px;
  font-size: 14px;
  line-height: 1.4;
  white-space: nowrap;
}
/* Extend the hit area to 44px without increasing the visible toolbar height. */
.officer-layout .reports-panel .report-toolbar-button::after {
  content: '';
  position: absolute;
  inset: -2px 0;
}
@media (max-width: 620px) {
  .filter-actions { align-self: flex-start; }
  .officer-layout.officer-layout.officer-layout .reports-panel .control-bar .report-toolbar-button { align-self: flex-start; }
}
@media (max-width: 520px) { .report-preview { padding: 18px; } .metric-grid { grid-template-columns: 1fr; } }
@container (max-width: 280px) {
  .report-actions > button, .filter-actions > button { white-space: normal; overflow-wrap: anywhere; }
  .officer-layout.officer-layout.officer-layout .reports-panel .control-bar .report-toolbar-button { height: auto; min-height: 40px; white-space: normal; overflow-wrap: anywhere; }
}
</style>

<style src="../../styles/officer-data-tables.css"></style>
