<script setup lang="ts">
import { vOfficerDropdown } from './officerDropdown'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { jsPDF } from 'jspdf'
import OperationalReportChart from './OperationalReportChart.vue'
import { requestOperationalReport, type Cell, type OperationalCategory, type OperationalReport } from '../../services/operationalReporting'
import { reportCsv, reportFilename, renderReportPdf, reportPalette, type ReportDocument } from '../../utils/reportExport'
import type { ReportFilters } from '../../services/reporting'
import { monitoringDate } from '../../utils/officerMonitoringDisplay'
const props = defineProps<{ category: OperationalCategory; filters: ReportFilters }>()
const emit = defineEmits<{ busy: [value: boolean] }>()
const { t, te, locale } = useI18n()
const text = (key: string) => te(`conservationPages.reports.operational.${key}`) ? t(`conservationPages.reports.operational.${key}`) : key
const rt = (key: string) => t(`conservationPages.reports.${key}`)
const report = ref<OperationalReport | null>(null), loading = ref(false), error = ref(''), feedback = ref('')
const device = ref(''), measurement = ref('temperature')
const chart = ref<InstanceType<typeof OperationalReportChart> | null>(null)
const reportView = ref<'graph' | 'table'>('graph'), selectedPeriodIndex = ref<number | null>(null)
const exporting = ref(false)
let request = 0, disposed = false
async function load() {
  const token = ++request
  loading.value = true; emit('busy', true); report.value = null; error.value = ''; feedback.value = ''
  try {
    const result = await requestOperationalReport(props.category, { ...props.filters }, device.value, measurement.value)
    if (disposed || token !== request) return
    report.value = result
    if (result.device) device.value = result.device
  } catch { if (!disposed && token === request) error.value = text('unavailable') }
  finally { if (!disposed && token === request) { loading.value = false; emit('busy', false) } }
}
watch(() => [props.category, props.filters], () => { device.value = ''; reportView.value = 'graph'; selectedPeriodIndex.value = null; void load() }, { immediate: true, deep: true })
onBeforeUnmount(() => { disposed = true; request++; emit('busy', false) })
const display = (value: Cell, column = '') => {
  if (value === null) return '\u2014'
  if (['period', 'createdAt', 'recordedAt', 'latestReading'].includes(column)) return monitoringDate(String(value), locale.value)
  if (typeof value === 'number') return new Intl.NumberFormat(locale.value, { maximumFractionDigits: 4 }).format(value)
  if (['status', 'measurement', 'unit'].includes(column)) return text(String(value))
  return String(value)
}
const scopeLabel = computed(() => report.value?.scope.startDate ? `${report.value.scope.startDate} – ${report.value.scope.endDate} · Asia/Kuala_Lumpur` : `${rt('periodAllTime')} · Asia/Kuala_Lumpur`)
// Label only: the validated result retains its IANA zone and precise timestamps.
const displayScopeLabel = computed(() => scopeLabel.value.replace('Asia/Kuala_Lumpur', text('malaysiaTime')))
const observationThemes: Record<string, string> = { totalObservations: 'total', 'Pending Review': 'pending', Approved: 'approved', Rejected: 'rejected', 'Correction Required': 'correction', Flagged: 'flagged' }
const statClasses = (key: string) => ({
  ['observation-' + (observationThemes[key] || 'total')]: props.category === 'observations',
  'latest-stat': props.category === 'iot' && key === 'latestReading',
})
const latestParts = (value: Cell) => {
  const formatted = display(value, 'latestReading')
  const parts = /^(.*?)(\d{2}:\d{2})$/.exec(formatted)
  return parts ? [parts[1]!.trimEnd(), parts[2]!] : [formatted]
}
const hasStatUnit = (key: string, value: Cell) => props.category === 'iot' && value !== null && ['minimum', 'average', 'maximum'].includes(key)
const hasChart = computed(() => report.value?.chart.series.some(series => series.values.some(value => value !== null && (report.value?.chart.kind === 'line' || value > 0))))
const isObservationReport = computed(() => props.category === 'observations')
const selectedPeriodLabel = computed(() => {
  const label = selectedPeriodIndex.value === null ? null : report.value?.chart.labels[selectedPeriodIndex.value]
  return label ? monitoringDate(label, locale.value) : ''
})
const tableRows = computed(() => {
  const rows = report.value?.rows || []
  if (props.category !== 'observations' || selectedPeriodIndex.value === null) return rows
  const selected = report.value?.chart.labels[selectedPeriodIndex.value]
  return selected ? rows.filter(row => row[0] === selected) : rows
})
const observationStory = computed(() => {
  const current = report.value
  if (props.category !== 'observations' || !current?.chart.labels.length) return ''
  const index = current.chart.labels.length - 1
  const totalAt = (periodIndex: number) => current.chart.series.reduce((sum, series) => sum + (series.values[periodIndex] ?? 0), 0)
  const latestTotal = totalAt(index), previousTotal = index > 0 ? totalAt(index - 1) : null
  const status = [...current.chart.series].sort((a, b) => (b.values[index] ?? 0) - (a.values[index] ?? 0))[0]
  const params = { latestPeriod: monitoringDate(current.chart.labels[index]!, locale.value), latestTotal: latestTotal.toLocaleString(locale.value), topStatus: status ? text(status.key) : '', statusCount: (status?.values[index] ?? 0).toLocaleString(locale.value), periodCount: current.chart.labels.length.toLocaleString(locale.value), total: String(current.statistics.find(stat => stat.key === 'totalObservations')?.value ?? latestTotal) }
  if (previousTotal === null) return t('conservationPages.reports.operational.observationStorySingle', params)
  const change = latestTotal - previousTotal
  const comparison = { ...params, previousPeriod: monitoringDate(current.chart.labels[index - 1]!, locale.value), previousTotal: previousTotal.toLocaleString(locale.value) }
  return change === 0 ? t('conservationPages.reports.operational.observationStoryNoChange', comparison)
    : t('conservationPages.reports.operational.observationStoryChange', { ...comparison, changeDirection: text(change > 0 ? 'observationIncrease' : 'observationDecrease'), changeAmount: Math.abs(change).toLocaleString(locale.value) })
})
function selectObservationPeriod(index: number) { selectedPeriodIndex.value = selectedPeriodIndex.value === index ? null : index }
const showTable = computed(() => !isObservationReport.value || reportView.value === 'table')
const exportDocument = (): ReportDocument => {
  const r = report.value!
  const context = r.category === 'iot' ? [
    { label: text('device'), value: r.device ? `${r.devices?.find(item => item.id === r.device)?.name || ''} (${r.device})` : null },
    { label: text('measurement'), value: text(r.measurement!) + ' (' + text(r.chart.unit) + ')' },
  ] : []
  return {
    category: r.category, title: text(r.category), period: scopeLabel.value.split(' \u00b7 ')[0]!, timezone: text('malaysiaTime'),
    generatedAt: r.generatedAt, generatedLabel: `${rt('generatedAt')}: ${monitoringDate(r.generatedAt, locale.value)}`,
    statistics: r.statistics.map(stat => ({ label: text(stat.key), value: stat.value, display: display(stat.value, stat.key),
      unit: hasStatUnit(stat.key, stat.value) ? text(r.chart.unit) : '',
      background: r.category === 'observations' ? reportPalette[stat.key]?.[0] : undefined,
      ink: r.category === 'observations' ? reportPalette[stat.key]?.[1] : undefined,
    })), columns: r.columns.map(text),
    rows: r.rows.map(row => row.map((value, index) => ['status', 'measurement', 'unit'].includes(r.columns[index]!) && value !== null ? text(String(value)) : value)),
    displayRows: r.rows.map(row => row.map((value, index) => display(value, r.columns[index]!))),
    chart: r.chart.series.flatMap(series => r.chart.labels.map((point, index) => ({ series: text(series.key), point, value: series.values[index] ?? null, unit: text(r.chart.unit) }))), context,
  }
}
async function exportFile(kind: 'csv' | 'pdf') {
  if (loading.value || exporting.value || !report.value?.rows.length) return
  const snapshot = report.value, token = request, language = locale.value
  const current = () => !disposed && !loading.value && request === token && report.value === snapshot && locale.value === language
  exporting.value = true; feedback.value = ''
  try {
    const model = exportDocument()
    if (kind === 'csv') {
      const url = URL.createObjectURL(new Blob([reportCsv(model)], { type: 'text/csv;charset=utf-8' }))
      const link = document.createElement('a'); link.href = url; link.download = reportFilename(model, 'csv'); link.click(); URL.revokeObjectURL(url)
    } else {
      await nextTick()
      const chartImage = hasChart.value ? await chart.value?.toPrintDataUrl() : null
      if (!current()) return
      if (hasChart.value && !chartImage) throw new Error('Chart unavailable')
      const pdf = new jsPDF({ orientation: model.columns.length > 5 ? 'landscape' : 'portrait', unit: 'mm' })
      if (!await renderReportPdf(model, chartImage || null, pdf, current) || !current()) return
      pdf.save(reportFilename(model, 'pdf'))
    }
    if (current()) feedback.value = rt(kind === 'csv' ? 'csvDownloaded' : 'pdfDownloaded')
  } catch { if (current()) feedback.value = t('conservationPages.reports.errors.export') }
  finally { exporting.value = false }
}

defineExpose({ load, exportFile, exportDocument, reportView, selectedPeriodIndex, tableRows, observationStory, selectObservationPeriod })
</script>
<template>
  <section class="operational-report" :aria-label="text(category)">
    <div class="operational-actions"><button class="secondary-button" type="button" :disabled="loading" @click="load">{{ rt('refresh') }}</button></div>
    <p v-if="loading" role="status">{{ rt('loading') }}</p>
    <p v-else-if="error" role="alert">{{ error }}</p>
    <template v-else-if="report">
      <h2>{{ text(category) }}</h2>
      <p class="scope">{{ displayScopeLabel }} · {{ monitoringDate(report.generatedAt, locale) }}</p>
      <p v-if="category === 'threats'" class="scope">{{ text(report.basis) }}</p>
      <p v-else-if="category === 'observations'" class="scope">{{ text('observationScopeShort') }}</p>
      <div v-if="category === 'iot'" class="control-bar">
        <label class="field"><span>{{ text('device') }}</span><select v-officer-dropdown v-model="device" @change="load"><option v-for="item in report.devices" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
        <label class="field"><span>{{ text('measurement') }}</span><select v-officer-dropdown v-model="measurement" @change="load"><option v-for="item in report.measurements" :key="item" :value="item">{{ text(item) }}</option></select></label>
      </div>
      <div class="operational-metrics" :class="{ 'iot-metrics': category === 'iot', 'observation-metrics': category === 'observations' }">
        <div v-for="stat in report.statistics" :key="stat.key" class="metric" :class="[statClasses(stat.key), { 'report-stat': category !== 'threats' }]">
          <span class="stat-label">{{ text(stat.key) }}</span>
          <strong class="stat-value">
            <time class="stat-value" v-if="category === 'iot' && stat.key === 'latestReading' && stat.value !== null" :datetime="String(stat.value)"><span v-for="(part, index) in latestParts(stat.value)" :key="index" class="timestamp-part">{{ part }}</span></time>
            <template v-else>{{ display(stat.value, stat.key) }}</template>
            <span v-if="hasStatUnit(stat.key, stat.value)" class="stat-unit">{{ text(report.chart.unit) }}</span>
          </strong>
        </div>
      </div>
      <aside v-if="category === 'observations' && observationStory" class="observation-story" aria-live="polite"><h3>{{ text('observationStoryTitle') }}</h3><p>{{ observationStory }}</p><p class="story-note">{{ text('observationStoryNote') }}</p></aside>
      <div v-if="category === 'observations'" class="observation-view-switch" role="group" :aria-label="rt('reportView')"><button type="button" :class="{ active: reportView === 'graph' }" :aria-pressed="reportView === 'graph'" @click="reportView = 'graph'">{{ rt('graphView') }}</button><button type="button" :class="{ active: reportView === 'table' }" :aria-pressed="reportView === 'table'" @click="reportView = 'table'">{{ rt('tableView') }}</button></div>
      <p v-if="category === 'observations' && selectedPeriodLabel" class="period-selection" role="status"><strong>{{ text('selectedObservationPeriod') }}:</strong> {{ selectedPeriodLabel }} <button type="button" class="clear-period-selection" @click="selectedPeriodIndex = null">{{ text('clearObservationPeriod') }}</button></p>
      <p v-if="category === 'observations' && reportView === 'graph'" class="chart-interaction-note">{{ text('observationChartInteraction') }}</p>
      <OperationalReportChart v-if="hasChart && (!isObservationReport || reportView === 'graph')" ref="chart" :report="report" :selected-period-index="isObservationReport ? selectedPeriodIndex : null" @select-period="selectObservationPeriod" />
      <p v-if="category === 'observations' && reportView === 'graph' && !hasChart && report.rows.length" role="status">{{ rt('empty') }}</p>
      <p v-if="category !== 'observations' && !hasChart && report.rows.length" role="status">{{ rt('empty') }}</p>
      <p v-if="!report.rows.length" role="status">{{ rt('empty') }}</p>
      <div v-if="showTable && tableRows.length" class="operational-scroll" :class="'table-' + category" role="region" :aria-label="text(category)" tabindex="0">
        <table><thead><tr><th v-for="column in report.columns" :key="column" scope="col">{{ text(column) }}</th></tr></thead><tbody><tr v-for="(row, index) in tableRows" :key="index"><td v-for="(value, col) in row" :key="col"><span :class="{ 'report-status': report.columns[col] === 'status' }">{{ display(value, report.columns[col]) }}</span></td></tr></tbody></table>
      </div>
      <div class="operational-actions"><button class="secondary-button" type="button" :disabled="loading || exporting || !report.rows.length" @click="exportFile('pdf')">{{ rt('exportPdf') }}</button><button class="secondary-button" type="button" :disabled="loading || exporting || !report.rows.length" @click="exportFile('csv')">{{ rt('exportCsv') }}</button></div>
    </template>
    <p v-if="feedback" role="status">{{ feedback }}</p>
  </section>
</template>
<style scoped>
.operational-report { min-width: 0; max-width: 100%; container-type: inline-size; }
.operational-report > * { min-width: 0; max-width: 100%; box-sizing: border-box; }
.scope, .operational-report > p, .operational-report > h2 { overflow-wrap: anywhere; }
.officer-layout.officer-layout.officer-layout .operational-report .control-bar { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.officer-layout.officer-layout.officer-layout .operational-report .control-bar > .field { min-width: 0; max-width: 100%; grid-template-rows: 1fr auto; }
.officer-layout.officer-layout.officer-layout .operational-report .control-bar select { min-width: 0; max-width: 100%; width: 100%; box-sizing: border-box; min-height: 2.75rem; font-size: .875rem; }
.scope { color: #526e60; font-size: 13px; line-height: 1.5; }
.operational-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.metric { padding: 14px; border: 1px solid #c4d7c9; border-radius: 10px; background: #f4f7f2; display: grid; gap: 6px; }
.metric span { font-size: 13px; }
.metric strong { font-size: 25px; overflow-wrap: anywhere; }
.officer-layout.officer-layout.officer-layout .operational-report .metric { min-width: 0; min-height: 0; height: auto; }
.officer-layout.officer-layout.officer-layout .operational-report .metric > .stat-label { font-size: .8125rem; line-height: 1.4; }
.officer-layout.officer-layout.officer-layout .operational-report .metric strong { font-size: 1.5rem; line-height: 1.25; }
/* Local overrides outrank the shared Officer metric typography. */
.officer-layout.officer-layout.officer-layout .operational-report .report-stat {
  box-sizing: border-box; min-width: 0; height: auto; min-height: 0;
  padding: 14px; border: 1px solid var(--stat-ink, #c4d7c9); border-radius: 10px;
  background: var(--stat-background, #f4f7f2); color: var(--stat-ink, #315b49);
  display: flex; flex-direction: column; justify-content: flex-start; gap: 6px;
}
.officer-layout.officer-layout.officer-layout .operational-report .report-stat > .stat-label { color: inherit; font-size: .8125rem; line-height: 1.4; }
.officer-layout.officer-layout.officer-layout .operational-report .report-stat .stat-value { margin: 0; color: inherit; font-size: 1.5rem; font-weight: 700; line-height: 1.25; }
.observation-total { --stat-background: #edf2ee; --stat-ink: #315b49; }
.observation-pending { --stat-background: #e8f0f5; --stat-ink: #315d78; }
.observation-approved { --stat-background: #e7f3e9; --stat-ink: #287347; }
.observation-rejected { --stat-background: #fbe8e5; --stat-ink: #a33f35; }
.observation-correction { --stat-background: #fff1db; --stat-ink: #926119; }
.observation-flagged { --stat-background: #f0eaf8; --stat-ink: #69459a; }
.observation-story { margin: 18px 0 14px; padding: 16px 18px; border: 1px solid #d5e3d8; border-left: 4px solid #477d62; border-radius: 10px; background: #f4f8f3; color: #315749; }
.observation-story h3 { margin: 0 0 7px; font-size: 15px; }
.observation-story p { margin: 0; font-size: 13px; line-height: 1.65; }
.observation-story .story-note { margin-top: 7px; color: #60756b; font-size: 11px; }
.observation-view-switch { display: inline-flex; gap: 3px; margin: 8px 0 2px; padding: 3px; border: 1px solid #cbd9cf; border-radius: 8px; background: #f3f7f3; }
.observation-view-switch button { min-width: 82px; min-height: 36px; padding: 6px 14px; border: 0; border-radius: 6px; background: transparent; color: #426554; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.observation-view-switch button.active { background: #315749; color: #fff; box-shadow: 0 1px 2px #14302326; }
.period-selection { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 12px 0 0; padding: 10px 12px; border-left: 3px solid #477d62; background: #f3f7f3; color: #315749; font-size: 13px; }
.clear-period-selection { border: 0; padding: 4px 0; background: transparent; color: #32745b; text-decoration: underline; font: inherit; cursor: pointer; }
.chart-interaction-note { color: #5e7468; font-size: 12px; line-height: 1.5; margin: 12px 0 -10px; }
.iot-metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: start; }
.latest-stat time { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 .25em; }
.officer-layout.officer-layout.officer-layout .operational-report .report-stat .timestamp-part { min-width: 0; max-width: 100%; font-size: inherit; line-height: inherit; color: inherit; white-space: normal; overflow-wrap: anywhere; }
.officer-layout.officer-layout.officer-layout .operational-report .report-stat .stat-unit { display: inline-block; margin-left: .4em; font-size: .75rem; line-height: 1.4; color: inherit; }
@container (min-width: 1700px) { .iot-metrics { grid-template-columns: repeat(6, minmax(0, 1fr)); } }
@container (min-width: 1250px) { .observation-metrics { grid-template-columns: repeat(6, minmax(0, 1fr)); } }
@container (max-width: 800px) { .operational-metrics, .iot-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container (max-width: 520px) {
  .operational-metrics, .iot-metrics { grid-template-columns: minmax(0, 1fr); }
  .officer-layout.officer-layout.officer-layout .operational-report .control-bar { grid-template-columns: minmax(0, 1fr); }
}
@container (min-width: 801px) {
  .operational-report .operational-scroll.table-observations { overflow-x: visible; }
  .officer-layout.officer-layout.officer-layout .operational-report .operational-scroll.table-observations table { min-width: 0; width: 100%; table-layout: fixed; }
  .officer-layout.officer-layout.officer-layout .operational-report .operational-scroll.table-observations :is(th, td) { padding: 10px 8px; white-space: normal; overflow-wrap: anywhere; }
  .officer-layout.officer-layout.officer-layout .operational-report .operational-scroll.table-observations th { font-size: 10px; line-height: 1.35; }
  .officer-layout.officer-layout.officer-layout .operational-report .operational-scroll.table-observations :is(th, td):nth-child(1) { width: 12%; }
  .officer-layout.officer-layout.officer-layout .operational-report .operational-scroll.table-observations :is(th, td):nth-child(2) { width: 17%; }
  .officer-layout.officer-layout.officer-layout .operational-report .operational-scroll.table-observations :is(th, td):nth-child(3) { width: 16%; }
  .officer-layout.officer-layout.officer-layout .operational-report .operational-scroll.table-observations :is(th, td):nth-child(4) { width: 12%; }
  .officer-layout.officer-layout.officer-layout .operational-report .operational-scroll.table-observations :is(th, td):nth-child(5) { width: 11%; }
  .officer-layout.officer-layout.officer-layout .operational-report .operational-scroll.table-observations :is(th, td):nth-child(6) { width: 19%; }
  .officer-layout.officer-layout.officer-layout .operational-report .operational-scroll.table-observations :is(th, td):nth-child(7) { width: 13%; }
}
.operational-scroll { min-width: 0; max-width: 100%; width: 100%; overflow-x: auto; overscroll-behavior-inline: contain; }
.officer-layout .operational-scroll table { min-width: 760px; width: 100%; border-collapse: separate; border-spacing: 0; }
.officer-layout.officer-layout.officer-layout .operational-scroll.table-observations table { min-width: 50rem; }
.officer-layout.officer-layout.officer-layout .operational-scroll.table-threats table { min-width: 48rem; }
.officer-layout.officer-layout.officer-layout .operational-scroll.table-iot table { min-width: 44rem; }
.officer-layout .operational-scroll th { background: #245443; color: white; text-transform: uppercase; font-size: 12px; }
.officer-layout .operational-scroll :is(th, td) { padding: 12px 14px; vertical-align: middle; text-align: left; }
.officer-layout .operational-scroll td { font-size: 14px; }
.report-status { white-space: nowrap; border-radius: 7px; background: #edf3ef; padding: 4px 8px; }
.operational-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-block: 14px; }
.operational-actions > button { flex: 0 0 auto; max-width: 100%; white-space: nowrap; }
@container (max-width: 280px) { .operational-actions > button { white-space: normal; overflow-wrap: anywhere; } }
.operational-scroll:focus-visible { outline: 3px solid #468585; outline-offset: 2px; }
</style>
