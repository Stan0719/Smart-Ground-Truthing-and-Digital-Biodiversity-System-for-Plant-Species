<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { jsPDF } from 'jspdf'
import { vOfficerDropdown } from './officerDropdown'
import IoTSummaryChart from './IoTSummaryChart.vue'
import { loadCanonicalDevices, loadCanonicalHistoryPage, type IoTDevice, type IoTReading } from '../../services/iotMonitoring'
import { IoTReportError, measurementUnits, requestIoTSummary, type IoTExactRange, type IoTSummary, type Measurement } from '../../services/iotReporting'
import type { ReportFilters } from '../../services/reporting'
import { iotBucketLabel, iotDate, iotTimestamp } from '../../utils/iotBucketDisplay'
import { renderReportPdf, reportCsv, reportFilename, type ReportDocument } from '../../utils/reportExport'
const props = defineProps<{ filters: ReportFilters }>()
const emit = defineEmits<{ busy: [value: boolean] }>()
const { t, te, locale } = useI18n()
const text = (key: string) => t(`conservationPages.reports.iotSummary.${key}`)
const rt = (key: string) => t(`conservationPages.reports.${key}`)
const metricLabel = (key: string) => t(`conservationPages.reports.operational.${key}`)
const devices = ref<IoTDevice[]>([]), device = ref(''), measurement = ref<Measurement>('temperature')
const reportView = ref<'graph' | 'table'>('graph')
type TemperatureRange = 'report-period' | 'last-hour' | 'last-24-hours' | 'last-7-days' | 'last-30-days' | 'custom'
const temperatureRange = ref<TemperatureRange>('report-period'), customStart = ref(''), customEnd = ref('')
const liveEnabled = ref(true), liveRefreshing = ref(false), liveError = ref('')
const rawReadings = ref<IoTReading[]>([]), rawPage = ref(0), rawHasMore = ref(false), rawLoading = ref(false), rawError = ref('')
const report = ref<IoTSummary | null>(null), loading = ref(false), error = ref(''), feedback = ref(''), exporting = ref(false)
const chart = ref<InstanceType<typeof IoTSummaryChart> | null>(null)
const measurements: Measurement[] = ['temperature', 'humidity', 'soilMoisture', 'rainfall', 'movement']
let generation = 0, rawGeneration = 0, disposed = false, controller: AbortController | null = null, rawController: AbortController | null = null
let liveTimer: ReturnType<typeof setInterval> | null = null
const selectionKey = () => JSON.stringify([props.filters, device.value, measurement.value, temperatureRange.value, customStart.value, customEnd.value])
const loadedSelection = ref('')
const canExport = computed(() => !!report.value && measurements.includes(measurement.value) && report.value.measurement.key === measurement.value && !loading.value && !liveRefreshing.value && !exporting.value && !error.value && loadedSelection.value === selectionKey())
const relativeRanges: TemperatureRange[] = ['last-hour', 'last-24-hours', 'last-7-days', 'last-30-days']
const canLive = computed(() => measurement.value === 'temperature' && relativeRanges.includes(temperatureRange.value))
const liveActive = computed(() => canLive.value && liveEnabled.value)
function klDate(instant: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant)).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}
function customInstant(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return null
  const normalized = value.length === 16 ? `${value}:00` : value
  const date = new Date(`${normalized}+08:00`)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}
const customRangeValid = computed(() => {
  const startAt = customInstant(customStart.value), endAt = customInstant(customEnd.value)
  return !!startAt && !!endAt && Date.parse(startAt) < Date.parse(endAt)
})
function requestSelection(now = new Date()): { filters: ReportFilters; range?: IoTExactRange } | null {
  if (measurement.value !== 'temperature' || temperatureRange.value === 'report-period') return { filters: { ...props.filters } }
  let startAt: string, endAt: string
  if (temperatureRange.value === 'custom') {
    const start = customInstant(customStart.value), end = customInstant(customEnd.value)
    if (!start || !end || Date.parse(start) >= Date.parse(end)) return null
    startAt = start; endAt = end
  } else {
    const duration = { 'last-hour': 3600000, 'last-24-hours': 86400000, 'last-7-days': 604800000, 'last-30-days': 2592000000 }[temperatureRange.value]
    endAt = now.toISOString(); startAt = new Date(now.getTime() - duration).toISOString()
  }
  return { filters: { period: 'custom', start: klDate(startAt), end: klDate(endAt) }, range: { startAt, endAt } }
}
function rangeLabel(key: TemperatureRange) { return key === 'report-period' ? period.value : text(`range.${key}`) }
const selectedRangeLabel = computed(() => {
  if (temperatureRange.value !== 'custom') return rangeLabel(temperatureRange.value)
  const start = customInstant(customStart.value), end = customInstant(customEnd.value)
  if (!start || !end || Date.parse(start) >= Date.parse(end)) return text('range.custom')
  const formatter = new Intl.DateTimeFormat(locale.value, { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
  return `${formatter.format(new Date(start))} – ${formatter.format(new Date(end))} (${text('malaysiaTime')})`
})
async function load() {
  if (!measurements.includes(measurement.value)) measurement.value = 'temperature'
  const token = ++generation
  controller?.abort(); controller = new AbortController()
  const signal = controller.signal
  report.value = null; error.value = ''; liveError.value = ''; feedback.value = ''; loading.value = true; emit('busy', true)
  rawController?.abort(); rawGeneration++; rawLoading.value = false; rawReadings.value = []; rawPage.value = 0; rawHasMore.value = false; rawError.value = ''
  try {
    const options = await loadCanonicalDevices(signal)
    if (disposed || token !== generation) return
    devices.value = options
    if (!options.some(d => d.sensor_id === device.value)) {
      const preferred = options.find(d => [d.sensor_id, d.device_name].some(value => value.trim().toLowerCase() === 'plantsensordevice'))
      device.value = preferred?.sensor_id || options[0]?.sensor_id || ''
    }
    if (!device.value) return
    const requestKey = selectionKey(), selected = requestSelection()
    if (!selected) { error.value = 'invalidRange'; return }
    const result = await requestIoTSummary(selected.filters, device.value, measurement.value, signal, selected.range)
    if (!disposed && token === generation && requestKey === selectionKey()) {
      report.value = result; loadedSelection.value = requestKey
      if (reportView.value === 'table' && measurement.value === 'temperature') await loadRawPage(true)
    }
  } catch (cause) {
    if (!disposed && token === generation) error.value = cause instanceof IoTReportError ? cause.code : (cause as { status?: number })?.status === 401 || (cause as { status?: number })?.status === 403 ? 'unauthorized' : 'unavailable'
  } finally { if (!disposed && token === generation) { loading.value = false; emit('busy', false) } }
}
async function loadRawPage(reset = false) {
  if (!report.value || measurement.value !== 'temperature' || !device.value || rawLoading.value) return
  const selectedDevice = devices.value.find(item => item.sensor_id === device.value)
  if (!selectedDevice) return
  const token = ++rawGeneration, page = reset ? 1 : rawPage.value + 1
  rawController?.abort(); rawController = new AbortController()
  rawLoading.value = true; rawError.value = ''
  try {
    const history = await loadCanonicalHistoryPage(selectedDevice, page, rawController.signal)
    if (disposed || token !== rawGeneration) return
    const start = report.value.scope.effectiveStartInclusive, end = report.value.scope.effectiveEndExclusive
    const inRange = history.readings.filter(reading => (!start || Date.parse(reading.recorded_at) >= Date.parse(start)) && (!end || Date.parse(reading.recorded_at) < Date.parse(end)))
    const existing = reset ? [] : rawReadings.value
    const ids = new Set(existing.map(reading => reading.reading_id))
    rawReadings.value = [...existing, ...inRange.filter(reading => !ids.has(reading.reading_id))]
    rawPage.value = page
    const oldest = history.readings.at(-1)
    rawHasMore.value = history.hasMore && !(start && oldest && Date.parse(oldest.recorded_at) < Date.parse(start))
  } catch (cause) {
    if (!disposed && token === rawGeneration && !(cause instanceof Error && cause.name === 'AbortError')) rawError.value = 'unavailable'
  } finally { if (!disposed && token === rawGeneration) rawLoading.value = false }
}
async function refreshLive() {
  if (!liveActive.value || loading.value || liveRefreshing.value || !device.value || typeof document === 'undefined' || document.visibilityState !== 'visible') return
  const selected = requestSelection()
  if (!selected) return
  const token = ++generation, requestKey = selectionKey()
  controller?.abort(); controller = new AbortController()
  liveRefreshing.value = true
  try {
    const result = await requestIoTSummary(selected.filters, device.value, measurement.value, controller.signal, selected.range)
    if (!disposed && token === generation && requestKey === selectionKey()) {
      report.value = result; loadedSelection.value = requestKey; liveError.value = ''
      if (reportView.value === 'table') await loadRawPage(true)
    }
  } catch (cause) {
    if (!disposed && token === generation && !(cause instanceof Error && cause.name === 'AbortError')) liveError.value = cause instanceof IoTReportError ? cause.code : 'unavailable'
  } finally { if (!disposed && token === generation) liveRefreshing.value = false }
}
function toggleLive() {
  if (!canLive.value) return
  liveEnabled.value = !liveEnabled.value
  if (liveEnabled.value) { liveError.value = ''; void refreshLive() }
}
function changeTemperatureRange() {
  liveError.value = ''
  if (temperatureRange.value !== 'custom') void load()
}
function changeReportView(view: 'graph' | 'table') {
  reportView.value = view
  if (view === 'table' && measurement.value === 'temperature') void loadRawPage(true)
}
function onVisibilityChange() { if (document.visibilityState === 'visible') void refreshLive() }
watch(() => props.filters, () => { temperatureRange.value = 'report-period'; void load() }, { deep: true, immediate: true, flush: 'sync' })
onMounted(() => {
  document.addEventListener('visibilitychange', onVisibilityChange)
  liveTimer = setInterval(() => { void refreshLive() }, 30000)
})
onBeforeUnmount(() => {
  disposed = true; generation++; rawGeneration++; controller?.abort(); rawController?.abort(); if (liveTimer) clearInterval(liveTimer)
  document.removeEventListener('visibilitychange', onVisibilityChange); emit('busy', false)
})
const format = (value: number | null) => value === null ? '—' : new Intl.NumberFormat(locale.value, { maximumFractionDigits: 4 }).format(value)
const date = (value: string | null) => value ? iotTimestamp(value, locale.value, report.value?.scope.timezone || 'Asia/Kuala_Lumpur') : '—'
const unit = computed(() => report.value?.measurement.unit || measurementUnits[measurement.value])
const period = computed(() => {
  const scope = report.value?.scope
  return scope?.startInclusive && scope.endExclusive
    ? `${iotDate(scope.startInclusive, locale.value, scope.timezone)} – ${iotDate(new Date(Date.parse(scope.endExclusive) - 1).toISOString(), locale.value, scope.timezone)}`
    : rt('periodAllTime')
})
const displayPeriod = computed(() => {
  if (measurement.value !== 'temperature') return period.value
  const scope = report.value?.scope
  if (temperatureRange.value === 'custom' && scope?.effectiveStartInclusive && scope.effectiveEndExclusive) {
    const formatter = new Intl.DateTimeFormat(locale.value, { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    return `${formatter.format(new Date(scope.effectiveStartInclusive))} – ${formatter.format(new Date(scope.effectiveEndExclusive))} (${text('malaysiaTime')})`
  }
  return selectedRangeLabel.value
})
const interval = computed(() => report.value ? t(`conservationPages.reports.iotSummary.summarized_${report.value.aggregation.interval}_${report.value.aggregation.step === 1 ? 'one' : 'many'}`, { count: format(report.value.aggregation.step) }) : '')
const isMovement = computed(() => report.value?.measurement.key === 'movement')
const cards = computed(() => report.value ? isMovement.value ? [
  { key: 'validReadings', value: report.value.summary.validMeasurements, unit: '' },
  { key: 'movementDetected', value: report.value.summary.detectedSampleCount!, unit: '' },
  { key: 'missingMeasurements', value: report.value.summary.missingMeasurements, unit: '' },
  { key: 'detectionRate', value: report.value.summary.validMeasurements ? report.value.summary.detectedSampleCount! / report.value.summary.validMeasurements * 100 : null, unit: '%' },
] : measurement.value === 'temperature' ? [
  { key: 'validReadings', value: report.value.summary.validMeasurements, unit: '' },
  { key: 'latestTemperature', value: report.value.latestReading?.value ?? null, unit: unit.value },
  ...(['average', 'minimum', 'maximum'] as const).map(key => ({ key, value: report.value!.summary[key], unit: unit.value })),
] : [
  { key: 'validReadings', value: report.value.summary.validMeasurements, unit: '' },
  ...(['average', 'minimum', 'maximum'] as const).map(key => ({ key, value: report.value!.summary[key], unit: unit.value })),
] : [])
const hasChart = computed(() => report.value?.buckets.some(b => b.validMeasurements > 0))
const coverageNotes = computed(() => {
  const c = report.value?.coverage
  if (!c?.nativeResolutionMinutes) return ''
  return [text('aggregateCoverage'), ...(c.omittedPartialSamples ? [text('partialCoverage')] : []), ...(c.omittedMovementSamples ? [text('movementUnavailable')] : [])].join(' ')
})
function cardDisplay(card: { key: string; value: number | null }) {
  const r = report.value, c = r?.coverage
  if (r && !r.summary.receivedRows && c && (c.omittedPartialSamples > 0 || c.omittedMovementSamples > 0)) return text('dataUnavailable')
  return card.key === 'latestTemperature' && card.value === null && c?.nativeResolutionMinutes ? text('individualUnavailable') : format(card.value)
}
const qualitySummary = computed(() => {
  const r = report.value
  if (!r || !r.summary.receivedRows) return coverageNotes.value ? text('dataUnavailable') : text('qualityNoRecords')
  const s = r.summary
  const key = s.validMeasurements === 0 ? 'qualityNoneValid' : s.missingMeasurements === 0 ? 'qualityAllValid' : 'qualitySomeMissing'
  const sentence = t(`conservationPages.reports.iotSummary.${key}`, {
    received: format(s.receivedRows), valid: format(s.validMeasurements), missing: format(s.missingMeasurements), measurement: metricLabel(r.measurement.key),
  })
  const { firstReceivedAt, lastReceivedAt } = r.observedSpan
  if (!firstReceivedAt || !lastReceivedAt) return sentence
  return `${sentence} ${t('conservationPages.reports.iotSummary.qualitySpan', { start: date(firstReceivedAt), end: date(lastReceivedAt) })}`
})
const qualityDescription = computed(() => {
  const r = report.value
  if (!r || !r.summary.receivedRows) return coverageNotes.value ? text('dataUnavailable') : text('qualityNoRecords')
  const key = !r.summary.validMeasurements ? 'descriptionNoneValid' : r.summary.missingMeasurements ? 'descriptionPartial' : 'descriptionAllValid'
  const sentence = t(`conservationPages.reports.iotSummary.${key}`, { measurement: metricLabel(r.measurement.key) })
  const { firstReceivedAt, lastReceivedAt } = r.observedSpan
  if (!firstReceivedAt || !lastReceivedAt) return sentence
  return `${t('conservationPages.reports.iotSummary.qualitySpan', { start: date(firstReceivedAt), end: date(lastReceivedAt) })} ${sentence}`
})
const technicalRows = computed(() => [
  { label: text('aggregation'), value: interval.value },
  { label: text('timestampLabel'), value: `${report.value?.coverage?.nativeResolutionMinutes ? text('aggregateTimestamp') : text('receiptTime')} · ${date(report.value?.observedSpan.firstReceivedAt || null)} – ${date(report.value?.observedSpan.lastReceivedAt || null)}` },
  { label: text('missingLabel'), value: text('limitations.missing_counts_apply_to_received_rows') },
  { label: text('availabilityLabel'), value: text('limitations.availability_not_calculated') },
  { label: text('average'), value: text('limitations.sample_weighted_average') },
])
const extraLimitations = computed(() => (report.value?.limitations || [])
  .filter(code => !['receipt_time_not_capture_time', 'missing_counts_apply_to_received_rows', 'expected_sampling_schedule_unavailable', 'availability_not_calculated', 'sample_weighted_average'].includes(code))
  .map(code => te(`conservationPages.reports.iotSummary.limitations.${code}`) ? text(`limitations.${code}`) : text('unknownLimitation')))
const headers = computed(() => isMovement.value ? [text('bucket'), text('device'), text('movementDetected'), text('validReadings'), text('missingMeasurements')] : [text('bucket'), text('device'), `${text('average')} (${unit.value})`, `${text('minimum')} (${unit.value})`, `${text('maximum')} (${unit.value})`, text('validMeasurements'), text('missingMeasurements')])
const rows = computed(() => report.value?.buckets.map(b => [iotBucketLabel(b, report.value!.aggregation.interval, locale.value, report.value!.scope.timezone, true), report.value!.device.name, ...(isMovement.value ? [b.validMeasurements ? format(b.detectedSampleCount!) : '—', format(b.validMeasurements), format(b.missingMeasurements)] : [format(b.average), format(b.minimum), format(b.maximum), format(b.validMeasurements), format(b.missingMeasurements)])]) || [])
function exportDocument(): ReportDocument {
  const r = report.value!
  return { category: 'iot-summary', title: text('title'), period: displayPeriod.value, timezone: 'Asia/Kuala_Lumpur', generatedAt: r.generatedAt, generatedLabel: `${text('reportGenerated')}: ${date(r.generatedAt)}`,
    statistics: cards.value.map(c => ({ label: c.key === 'validReadings' || isMovement.value ? text(c.key) : `${text(c.key)} · ${metricLabel(r.measurement.key)}`, value: c.value, display: cardDisplay(c), unit: c.value === null ? '' : c.unit })),
    columns: headers.value, rows: rows.value, displayRows: rows.value,
    chart: isMovement.value ? r.buckets.map(b => ({ series: text('movementDetectedReadings'), point: b.startInclusive, value: b.validMeasurements ? b.detectedSampleCount! : null, unit: '' })) : r.buckets.flatMap(b => (['average', 'minimum', 'maximum'] as const).map(key => ({ series: text(key), point: b.startInclusive, value: b[key], unit: r.measurement.unit }))),
    context: [{ label: text('device'), value: `${r.device.name} (${r.device.id})` }, { label: text('metric'), value: `${metricLabel(r.measurement.key)} (${r.measurement.unit})` }, { label: text('aggregation'), value: interval.value }],
    notes: [{ label: text('qualityTitle'), value: `${qualitySummary.value}${coverageNotes.value ? `\n${coverageNotes.value}` : ''}\n${text('qualityEssential')}${isMovement.value ? `\n${text('movementCaveat')}\n${text('detectionRateNote')}` : ''}` }], statisticsColumns: 4,
  }
}
async function exportPdf() {
  if (!canExport.value) return
  const snapshot = report.value, token = generation, language = locale.value
  const current = () => !disposed && !loading.value && token === generation && snapshot === report.value && language === locale.value && loadedSelection.value === selectionKey()
  exporting.value = true; feedback.value = ''
  try {
    const model = exportDocument()
    await nextTick()
    const image = hasChart.value ? await chart.value?.toPrintDataUrl() : null
    if (!current()) return
    if (hasChart.value && !image) throw Error('Chart unavailable')
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm' })
    if (await renderReportPdf(model, image || null, pdf, current) && current()) { pdf.save(reportFilename(model, 'pdf')); feedback.value = rt('pdfDownloaded') }
  } catch { if (current()) feedback.value = t('conservationPages.reports.errors.export') }
  finally { exporting.value = false }
}
// Keep CSV strictly tabular. Context belongs in the safe filename and unit headers.
function csvDocument(): ReportDocument {
  const r = report.value!
  const model = exportDocument()
  return { ...model,
    category: `iot-environmental-report-${r.measurement.key}-${r.measurement.unit}-${r.device.id.slice(0, 24)}-${r.aggregation.step}-${r.aggregation.interval}`,
    columns: model.columns.map((heading, index) => index === 0 && coverageNotes.value ? `${heading}: ${coverageNotes.value}` : heading),
    rows: r.buckets.map(b => [
      `${iotTimestamp(b.startInclusive, locale.value, r.scope.timezone)} – ${iotTimestamp(b.endExclusive, locale.value, r.scope.timezone)} [Asia/Kuala_Lumpur; ${text('csvEndExclusive')}]`,
      r.device.name,
      ...(r.measurement.key === 'movement'
        ? [b.detectedSampleCount!, b.validMeasurements, b.missingMeasurements]
        : [b.average, b.minimum, b.maximum, b.validMeasurements, b.missingMeasurements]),
    ]),
  }
}
function exportCsv() {
  if (!canExport.value || !report.value?.buckets.length) return
  exporting.value = true; feedback.value = ''
  let url: string | undefined
  try {
    const model = csvDocument()
    url = URL.createObjectURL(new Blob([reportCsv(model)], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = reportFilename(model, 'csv')
    document.body.appendChild(anchor)
    try { anchor.click() } finally { anchor.remove() }
    feedback.value = rt('csvDownloaded')
  } catch { feedback.value = rt('errors.export') }
  finally {
    if (url) { const downloadUrl = url; setTimeout(() => URL.revokeObjectURL(downloadUrl), 0) }
    exporting.value = false
  }
}
defineExpose({ load, exportPdf, exportCsv, exportDocument })
</script>
<template>
  <section class="iot-report" :aria-label="text('title')">
    <div class="iot-controls">
      <label><span>{{ text('device') }}</span><select v-officer-dropdown v-model="device" :disabled="loading || !devices.length" @change="load"><option v-if="!devices.length" value="">{{ text('noDevice') }}</option><option v-for="item in devices" :key="item.sensor_id" :value="item.sensor_id">{{ item.device_name }}</option></select></label>
      <label><span>{{ text('metric') }}</span><select v-officer-dropdown v-model="measurement" :disabled="loading" @change="load"><option v-for="key in measurements" :key="key" :value="key">{{ metricLabel(key) }} ({{ measurementUnits[key] }})</option></select></label>
      <button type="button" class="secondary-button" :disabled="loading" @click="load">{{ rt('refresh') }}</button>
    </div>
    <p v-if="loading" role="status">{{ rt('loading') }}</p>
    <div v-else-if="error" role="alert"><p>{{ text(`errors.${error}`) }}</p><button type="button" class="secondary-button" @click="load">{{ rt('refresh') }}</button></div>
    <p v-else-if="!device" role="status">{{ text('noDevice') }}</p>
    <article v-else-if="report" class="iot-content">
      <header><h2>{{ text('title') }}</h2><p>{{ text('subtitle') }}</p><p>{{ text('device') }}: <strong>{{ report.device.name }}</strong> · {{ displayPeriod }} · {{ metricLabel(report.measurement.key) }} ({{ unit }})</p><p class="iot-meta">{{ text('reportGenerated') }}: {{ date(report.generatedAt) }} · {{ interval }}</p></header>
      <div class="iot-cards"><div v-for="card in cards" :key="card.key" class="iot-card"><span>{{ text(card.key) }}<template v-if="card.key !== 'validReadings' && card.key !== 'latestTemperature' && !isMovement"> · {{ metricLabel(report.measurement.key) }}</template></span><strong>{{ cardDisplay(card) }}<small v-if="card.unit && card.value !== null"> {{ card.unit }}</small></strong><small v-if="card.key === 'latestTemperature' && report.latestReading">{{ date(report.latestReading.recordedAt) }}</small></div></div>
      <div class="report-view-switch" role="group" :aria-label="rt('reportView')">
        <button type="button" class="report-view-button" :class="{ active: reportView === 'graph' }" :aria-pressed="reportView === 'graph'" @click="changeReportView('graph')">{{ rt('graphView') }}</button>
        <button type="button" class="report-view-button" :class="{ active: reportView === 'table' }" :aria-pressed="reportView === 'table'" @click="changeReportView('table')">{{ rt('tableView') }}</button>
      </div>
      <section v-if="measurement === 'temperature'" class="temperature-controls" :aria-label="text('temperatureControls')">
        <label><span>{{ text('rangeLabel') }}</span><select v-model="temperatureRange" @change="changeTemperatureRange"><option v-for="key in ['report-period','last-hour','last-24-hours','last-7-days','last-30-days','custom']" :key="key" :value="key">{{ text(`range.${key}`) }}</option></select></label>
        <template v-if="temperatureRange === 'custom'"><label><span>{{ text('from') }} ({{ text('malaysiaTime') }})</span><input v-model="customStart" type="datetime-local" step="60"></label><label><span>{{ text('to') }} ({{ text('malaysiaTime') }})</span><input v-model="customEnd" type="datetime-local" step="60"></label><button type="button" class="secondary-button" :disabled="!customRangeValid || loading" @click="load">{{ text('applyRange') }}</button><p v-if="!customRangeValid && (customStart || customEnd)" class="range-error" role="alert">{{ text('invalidRange') }}</p></template>
        <div v-if="canLive" class="live-controls"><span class="live-indicator" :class="{ active: liveActive }"><i aria-hidden="true"></i>{{ liveActive ? text('liveActive') : text('livePaused') }}</span><button type="button" class="secondary-button" @click="toggleLive">{{ liveEnabled ? text('pauseUpdates') : text('resumeUpdates') }}</button><span class="iot-meta">{{ text('lastUpdated') }}: {{ date(report.generatedAt) }}<template v-if="liveRefreshing"> · {{ rt('loading') }}</template></span><p v-if="liveError" role="status">{{ text(`errors.${liveError}`) }}</p></div>
      </section>
      <section v-if="reportView === 'graph'" class="report-data-view graph-view" :aria-label="rt('graphView')">
        <section class="iot-chart-panel"><h3>{{ isMovement ? text('movementTrend') : `${metricLabel(report.measurement.key)} · ${text('trend')}` }}</h3><IoTSummaryChart v-if="hasChart" ref="chart" :report="report" /><p v-else role="status">{{ text(!report.summary.receivedRows && coverageNotes ? 'dataUnavailable' : report.summary.receivedRows ? 'noValid' : 'noReadings') }}</p></section>
      </section>
      <section v-if="reportView === 'table'" class="report-data-view table-view" :aria-label="rt('tableView')">
        <div v-if="measurement === 'temperature'" class="raw-readings"><h3>{{ text('rawReadings') }}</h3><div v-if="rawReadings.length" class="iot-table-scroll" role="region" tabindex="0" :aria-label="text('rawReadings')"><table><thead><tr><th scope="col">{{ text('timestampLabel') }}</th><th scope="col">{{ text('device') }}</th><th scope="col">{{ metricLabel('temperature') }} ({{ unit }})</th></tr></thead><tbody><tr v-for="reading in rawReadings" :key="reading.reading_id"><td>{{ date(reading.recorded_at) }}</td><td>{{ report.device.name }}</td><td>{{ format(reading.temperature_c) }}</td></tr></tbody></table></div><p v-else-if="rawLoading" role="status">{{ text('loadingRaw') }}</p><p v-else>{{ text(report.coverage?.nativeResolutionMinutes ? 'individualUnavailable' : 'noRawReadings') }}</p><p v-if="rawError" role="status">{{ text(`errors.${rawError}`) }}</p><button v-if="rawHasMore" type="button" class="secondary-button" :disabled="rawLoading" @click="loadRawPage()">{{ rawLoading ? text('loadingRaw') : text('loadOlder') }}</button></div>
        <div v-if="rows.length" class="iot-table-scroll" role="region" tabindex="0" :aria-label="text('tableTitle')"><table><thead><tr><th v-for="heading in headers" :key="heading" scope="col">{{ heading }}</th></tr></thead><tbody><tr v-for="(row, index) in rows" :key="report.buckets[index]!.startInclusive"><td v-for="(cell, col) in row" :key="col" :title="col === 0 ? `${date(report.buckets[index]!.startInclusive)} – ${date(report.buckets[index]!.endExclusive)}` : undefined">{{ cell }}</td></tr></tbody></table></div>
        <p v-else role="status">{{ text(!report.summary.receivedRows && coverageNotes ? 'dataUnavailable' : report.summary.receivedRows ? 'noValid' : 'noReadings') }}</p>
      </section>
      <aside class="iot-quality">
        <h3><span class="quality-info" aria-hidden="true">ⓘ</span>{{ text('qualityTitle') }}</h3>
        <div class="quality-badges">
          <span class="quality-badge" :class="{ 'quality-badge-valid': report.summary.validMeasurements > 0 }">{{ t('conservationPages.reports.iotSummary.validBadge', { count: format(report.summary.validMeasurements) }) }}</span>
          <span class="quality-badge">{{ t('conservationPages.reports.iotSummary.missingBadge', { count: format(report.summary.missingMeasurements) }) }}</span>
        </div>
        <p>{{ qualityDescription }}</p><p v-if="coverageNotes" class="quality-essential" role="status">{{ coverageNotes }}</p><p class="quality-essential">{{ text('qualityEssential') }}</p><p v-if="isMovement" class="quality-essential">{{ text('movementCaveat') }} {{ text('detectionRateNote') }}</p>
        <details class="quality-details"><summary>{{ text('technicalDetails') }}<svg class="quality-chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="m3 6 5 5 5-5" /></svg></summary>
          <dl><div v-for="row in technicalRows" :key="row.label"><dt>{{ row.label }}:</dt><dd>{{ row.value }}</dd></div></dl>
          <p v-for="note in extraLimitations" :key="note" class="quality-extra">{{ note }}</p><p v-if="measurement === 'movement'" class="quality-extra">{{ text('movementNote') }}</p>
        </details>
      </aside>
      <div class="iot-exports"><button type="button" class="secondary-button" :disabled="!canExport" @click="exportPdf">{{ rt('exportPdf') }}</button><button type="button" class="secondary-button" :disabled="!canExport || !report.buckets.length" aria-describedby="iot-csv-note" @click="exportCsv">{{ text('downloadCsv') }}</button></div>
      <p id="iot-csv-note" class="iot-meta">{{ text('csvDescription') }}</p><p v-if="feedback" role="status">{{ feedback }}</p>
    </article>
  </section>
</template>
<style scoped>
.iot-report { min-width: 0; container-type: inline-size; color: #244f40; }
.iot-controls { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr) auto; gap: 20px; align-items: end; padding: 18px; border: 1px solid #d9e5de; border-radius: 12px; margin-bottom: 20px; background: #fff; }
.iot-controls label { display: grid; gap: 8px; min-width: 0; }
.iot-controls label > span { font-weight: 600; }
.iot-controls select { width: 100%; min-width: 0; min-height: 44px; background: #f8faf8; border: 1px solid #d3dfd7; border-radius: 9px; padding: 10px; font: inherit; color: inherit; }
.iot-content { background: #fff; border: 1px solid #d9e5de; border-radius: 14px; padding: 24px; box-shadow: 0 3px 15px #173e2f05; min-width: 0; }
.report-view-switch { display: inline-flex; width: fit-content; gap: 2px; margin: 0 0 18px; padding: 3px; border: 1px solid #cbd9cf; border-radius: 8px; background: #f3f7f3; }
.iot-report .report-view-button { min-width: 82px; min-height: 36px; padding: 6px 14px; border: 0; border-radius: 6px; background: transparent; color: #426554; font-size: 13px; }
.iot-report .report-view-button.active { background: #315749; color: #fff; box-shadow: 0 1px 2px rgba(20, 48, 35, .15); }
.report-data-view { min-width: 0; }
.temperature-controls { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; padding: 14px; margin: 0 0 18px; border: 1px solid #dce6df; border-radius: 10px; background: #fbfdfb; }
.temperature-controls label { display: grid; gap: 6px; min-width: 190px; }
.temperature-controls label > span { font-size: .8rem; font-weight: 600; }
.temperature-controls select, .temperature-controls input { min-height: 38px; padding: 7px 10px; border: 1px solid #d3dfd7; border-radius: 7px; font: inherit; color: inherit; background: #fff; }
.live-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; width: 100%; }
.live-indicator { display: inline-flex; align-items: center; gap: 7px; font-size: .85rem; color: #68716b; }
.live-indicator i { width: 9px; height: 9px; border-radius: 50%; background: #9a9d9a; }
.live-indicator.active i { background: #27874f; box-shadow: 0 0 0 3px #27874f22; }
.range-error { color: #9a342d; margin: 0; }
.raw-readings { margin: 12px 0 24px; }
.raw-readings h3 { margin-bottom: 10px; }
header { text-align: center; margin-bottom: 24px; } h2 { margin: 0 0 8px; font-size: 1.6rem; color: #104b34; } h3 { margin: 0 0 16px; font-size: 1.2rem; color: #164f38; } header p { margin: 8px 0; }
.iot-meta { font-size: .9rem; color: #61756b; line-height: 1.6; }
.iot-cards { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 14px; margin-bottom: 20px; }
.iot-card { padding: 18px; border-radius: 10px; background: #eef5ef; min-width: 0; overflow-wrap: anywhere; }
.iot-card span { display: block; line-height: 1.5; } .iot-card strong { display: block; margin-top: 9px; font-size: 1.65rem; line-height: 1.3; color: #123e2b; } .iot-card small { font-size: 1rem; }
.iot-chart-panel { border: 1px solid #dce6df; border-radius: 12px; padding: 18px; margin-bottom: 20px; min-width: 0; }
.iot-table-scroll { overflow-x: auto; margin-block: 20px; max-width: 100%; } table { border-collapse: collapse; width: 100%; min-width: 850px; } th { background: #23553f; color: white; text-align: left; padding: 12px; font-weight: 600; } td { border-bottom: 1px solid #e2e9e4; padding: 12px; line-height: 1.5; } tbody tr:nth-child(even) { background: #f8faf8; }
.iot-quality { background: #fff; border: 1px solid #dce2de; border-radius: 11px; padding: 16px; line-height: 1.6; margin-top: 20px; color: #252b27; }
.iot-quality h3 { display: flex; align-items: center; gap: 8px; margin: 0 0 7px; font-size: .95rem; font-weight: 500; color: #202923; }
.quality-info { color: #197344; font-size: 1rem; }
.quality-badges { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.quality-badge { padding: 2px 7px; border-radius: 999px; background: #f0f1f0; color: #3b413d; font-size: .75rem; font-weight: 500; line-height: 1.5; }
.quality-badge-valid { background: #dcf3e4; color: #176b3d; }
.iot-quality p { margin: 0 0 8px; font-size: .9rem; } .iot-quality .quality-essential { font-size: .8rem; color: #68716b; }
.quality-details { margin-top: 12px; border-top: 1px solid #ebeeec; }
.quality-details summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; box-sizing: border-box; padding: 11px 0; cursor: pointer; color: #303831; font-size: .85rem; font-weight: 500; border-radius: 4px; list-style: none; }
.quality-details summary::-webkit-details-marker { display: none; } .quality-details summary:hover { background: #f7faf8; }
.quality-details summary:focus-visible { outline: 3px solid #79ad93; outline-offset: 3px; }
.quality-chevron { width: 14px; height: 14px; flex-shrink: 0; fill: none; stroke: #68716b; stroke-width: 1.3; }
.quality-details[open] .quality-chevron { transform: rotate(180deg); }
.quality-details dl { margin: 0; padding: 2px 10px 0; font-size: .85rem; }
.quality-details dl > div { margin: 0 0 6px; } .quality-details dt { display: inline; font-weight: 600; } .quality-details dd { display: inline; margin: 0 0 0 4px; }
.iot-quality .quality-extra { margin: 6px 10px; font-size: .8rem; color: #68716b; }
.iot-exports { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 12px; margin-top: 22px; }
.iot-report button { min-height: 42px; padding: 9px 18px; border: 1px solid #569374; border-radius: 8px; color: #20543b; background: white; font: inherit; font-weight: 600; cursor: pointer; } .iot-report button:disabled { opacity: .55; cursor: not-allowed; } .iot-report button:focus-visible { outline: 3px solid #79ad93; outline-offset: 3px; }
@container (max-width: 850px) { .iot-cards { grid-template-columns: repeat(2,minmax(0,1fr)); } }
@container (max-width: 520px) { .iot-controls { grid-template-columns: minmax(0,1fr); gap: 14px; } .iot-content { padding: 14px; } .iot-cards { grid-template-columns: minmax(0,1fr); } }
</style>
