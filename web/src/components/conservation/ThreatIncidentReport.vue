<script setup lang="ts">
import ActionFeedback from '../ActionFeedback.vue'
import { computed, onBeforeUnmount, ref, shallowRef, watch, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { jsPDF } from 'jspdf'
import { vOfficerDropdown } from './officerDropdown'
import ThreatReportCharts from './ThreatReportCharts.vue'
import MonitoringIdentifier from './MonitoringIdentifier.vue'
import { monitoringLabels } from '../../utils/officerMonitoringDisplay'
import { requestOperationalReport, type OperationalReport } from '../../services/operationalReporting'
import { buildThreatReport, threatReportDate, threatMetricLabel, threatReportDocument, triggerReading, type ThreatSource, type ThreatStatus } from '../../services/threatReport'
import type { ReportFilters } from '../../services/reporting'
import { reportCsv, reportFilename, renderReportPdf } from '../../utils/reportExport'
import { workflowBadgeStyle } from '../../utils/workflowBadge'
const props = defineProps<{ filters: ReportFilters }>()
const exportFailed = ref(false), exportSequence = ref(0)
const emit = defineEmits<{ busy: [value: boolean] }>()
const { t, locale } = useI18n(), text = (key: string) => t('threatReport.' + key)
const report = shallowRef<OperationalReport | null>(null), source = ref<'' | ThreatSource>(''), status = ref<ThreatStatus>('')
const loading = ref(false), error = ref(''), exporting = ref(false), feedback = ref('')
const chart = ref<InstanceType<typeof ThreatReportCharts> | null>(null)
let generation = 0, disposed = false
const view = computed(() => report.value ? buildThreatReport(report.value, source.value, status.value) : null)
async function load() {
  const token = ++generation; loading.value = true; report.value = null; error.value = ''; feedback.value = ''; emit('busy', true)
  try {
    const result = await requestOperationalReport('threats', { ...props.filters })
    if (disposed || token !== generation) return
    buildThreatReport(result) // Fail closed before publishing malformed dates/statuses.
    report.value = result
  } catch { if (!disposed && token === generation) error.value = text('unavailable') }
  finally { if (!disposed && token === generation) { loading.value = false; emit('busy', false) } }
}
watch(() => props.filters, () => { source.value = ''; status.value = ''; void load() }, { immediate: true, deep: true })
watch([source, status], () => { feedback.value = '' })
onBeforeUnmount(() => { disposed = true; generation++; emit('busy', false) })
const idLabels = computed(() => monitoringLabels(view.value?.rows.map(row => row.id) || []))
const deviceLabels = computed(() => monitoringLabels(view.value?.rows.flatMap(row => [row.deviceId, row.cameraId]) || []))
const help = ref<HTMLElement | null>(null), helpId = useId()
function showHelp(event: Event) {
  const box = help.value, anchor = event.currentTarget as HTMLElement
  if (!box) return
  box.showPopover()
  const rect = anchor.getBoundingClientRect(), bounds = box.getBoundingClientRect()
  box.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - bounds.width - 12))}px`
  box.style.top = `${Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - bounds.height - 12))}px`
}
function hideHelp() { help.value?.hidePopover() }
function leaveHelp(event: MouseEvent) { if (document.activeElement !== event.currentTarget) hideHelp() }
const documentModel = (kind: 'pdf' | 'csv' = 'pdf') => threatReportDocument(view.value!, text, locale.value, kind)
async function exportFile(kind: 'csv' | 'pdf') {
  if (!view.value || loading.value || exporting.value) return
  const snapshot = view.value, language = locale.value, token = generation
  const current = () => !disposed && generation === token && view.value === snapshot && locale.value === language && !loading.value
  const model = documentModel(kind); exporting.value = true; feedback.value = ''; exportFailed.value = false; exportSequence.value++
  try {
    if (kind === 'csv') {
      const url = URL.createObjectURL(new Blob([reportCsv(model)], { type: 'text/csv;charset=utf-8' }))
      const link = document.createElement('a'); link.href = url; link.download = reportFilename(model, 'csv'); link.click(); URL.revokeObjectURL(url)
    } else {
      const image = await chart.value?.toPrintDataUrl(); if (!current()) return
      if (!image) throw Error('Chart unavailable')
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm' })
      if (await renderReportPdf(model, image, pdf, current) && current()) pdf.save(reportFilename(model, 'pdf'))
    }
    if (current()) feedback.value = text('downloaded')
  } catch { exportFailed.value = true; if (current()) feedback.value = text('exportFailed') }
  finally { exporting.value = false }
}
defineExpose({ load, view, source, status, exportFile, documentModel })
</script>
<template>
  <section class="threat-report" :aria-label="text('title')">
    <p v-if="loading" role="status">{{ text('loading') }}</p>
    <div v-else-if="error" role="alert"><p>{{ error }}</p><button class="secondary-button" type="button" @click="load">{{ text('retry') }}</button></div>
    <template v-else-if="view">
      <header class="report-heading"><div><div class="threat-report-title"><h2>{{ text('title') }}</h2><button class="report-help" type="button" :aria-label="text('helpLabel')" :aria-describedby="helpId" @mouseenter="showHelp" @mouseleave="leaveHelp" @focus="showHelp" @blur="hideHelp" @click="showHelp" @keydown.esc="hideHelp">?</button><span :id="helpId" ref="help" class="report-help-tooltip" popover="auto" role="tooltip">{{ text('help') }}</span></div><p>{{ text('generated') }}: {{ threatReportDate(view.generatedAt, locale) }}</p></div><button class="secondary-button" type="button" :disabled="exporting" @click="load">{{ text('refresh') }}</button></header>
      <div class="report-local-filters"><label><span>{{ text('source') }}</span><select v-officer-dropdown v-model="source"><option value="">{{ text('allSources') }}</option><option v-for="s in ['Sensor', 'Camera', 'Unknown']" :key="s" :value="s">{{ text(s) }}</option></select></label><label><span>{{ text('status') }}</span><select v-officer-dropdown v-model="status"><option value="">{{ text('allStatuses') }}</option><option v-for="s in ['New', 'Reviewing', 'Resolved']" :key="s" :value="s">{{ text(s) }}</option></select></label><button class="secondary-button" type="button" @click="source = ''; status = ''">{{ text('clear') }}</button></div>
      <div class="threat-summary"><div v-for="stat in view.statistics" :key="stat.key" class="summary-item"><span>{{ text(stat.key) }}</span><strong>{{ stat.value.toLocaleString(locale) }}</strong></div></div>
      <p v-if="view.sourceCounts[2]" class="scope-note unknown-note">{{ text('Unknown') }}: <strong>{{ view.sourceCounts[2].toLocaleString(locale) }}</strong> · {{ text('unknownNote') }}</p>
      <ThreatReportCharts ref="chart" :view="view" />
      <p v-if="!view.hasTriggerProjection" class="scope-note" role="status">{{ text('projectionMissing') }}</p>
      <p v-if="!view.rows.length" class="empty-report" role="status">{{ text('empty') }}</p>
      <div class="threat-table-scroll" tabindex="0" role="region" :aria-label="text('table')"><table><thead><tr><th v-for="key in ['alertId', 'source', 'type', 'triggerReading', 'deviceCamera', 'currentPlant', 'currentSpecies', 'status', 'createdAt']" :key="key" scope="col">{{ text(key) }}</th></tr></thead><tbody><tr v-for="(row, index) in view.rows" :key="row.id || index"><td><MonitoringIdentifier v-if="row.id" :value="row.id" :labels="idLabels" /><span v-else>{{ text('unavailableValue') }}</span></td><td>{{ text(row.source) }}</td><td>{{ threatMetricLabel(row.metric, text) }}</td><td>{{ triggerReading(row, text) }}</td><td><div v-if="row.deviceId" class="report-device"><small>{{ text('deviceId') }}</small><MonitoringIdentifier :value="row.deviceId" :labels="deviceLabels" /></div><div v-if="row.cameraId" class="report-device"><small>{{ text('cameraId') }}</small><MonitoringIdentifier :value="row.cameraId" :labels="deviceLabels" /></div><span v-if="!row.deviceId && !row.cameraId">{{ text('unavailableValue') }}</span></td><td>{{ row.plant ?? '—' }}</td><td>{{ row.species ?? '—' }}</td><td><span class="review-status" :style="workflowBadgeStyle(row.status === 'Resolved' ? 'Approved' : row.status === 'Reviewing' ? 'Pending Review' : 'Draft')">{{ text(row.status) }}</span></td><td><time :datetime="row.createdAt">{{ threatReportDate(row.createdAt, locale) }}</time></td></tr></tbody></table></div>
      <aside class="report-limitations"><h3>{{ text('interpretation') }}</h3><p>{{ text('limitations') }}</p><p>{{ text('triggerLimit') }}</p><p>{{ text('scaleLimit') }}</p></aside>
      <div class="export-actions"><button class="secondary-button" type="button" :disabled="exporting" @click="exportFile('pdf')">{{ text('pdf') }}</button><button class="secondary-button" type="button" :disabled="exporting" @click="exportFile('csv')">{{ text('csv') }}</button></div>
    </template>
    <ActionFeedback v-if="feedback" :key="exportSequence" :feedback-id="exportSequence" :variant="exportFailed ? 'error' : 'success'" :message="feedback" @dismiss="feedback = ''" />
  </section>
</template>
<style scoped>
.threat-report { min-width: 0; max-width: 100%; container-type: inline-size; color: #244a39; }
.report-heading { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 14px; }
h2 { margin: 0 0 8px; font-size: 23px; color: #1d4937; } .report-heading p { margin: 4px 0; font-size: 12px; color: #5d7364; }
.scope-note { font-size: 13px; line-height: 1.6; color: #587060; }
.report-local-filters { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 14px; margin: 20px 0; padding: 16px; border: 1px solid #dce6de; border-radius: 12px; background: #fafbf8; }
.report-local-filters label { display: grid; gap: 6px; flex: 1 1 200px; min-width: 0; font-size: 12px; font-weight: 600; }
.report-local-filters select { width: 100%; min-width: 0; min-height: 43px; border: 1px solid #cbdccf; border-radius: 9px; padding: 10px; background: #fff; color: #245443; font: inherit; font-size: 14px; }
.threat-summary { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
.summary-item { display: grid; gap: 9px; padding: 17px; border: 1px solid #d4e3d6; border-radius: 11px; background: #eef5ed; min-width: 0; }
.summary-item:nth-child(3) { background: #eef3f5; } .summary-item:nth-child(4) { background: #faf4e5; } .summary-item span { font-size: 12px; line-height: 1.5; } .summary-item strong { font-size: 26px; overflow-wrap: anywhere; }
.threat-table-scroll { width: 100%; max-width: 100%; overflow-x: auto; border: 1px solid #dce6de; border-radius: 10px; }
table { width: 100%; min-width: 1200px; border-collapse: collapse; } th { color: #fff; background: #245443; font-size: 12px; line-height: 1.5; } th,td { padding: 12px 14px; text-align: left; vertical-align: top; } td { font-size: 13px; line-height: 1.6; border-bottom: 1px solid #e5ebe5; overflow-wrap: anywhere; max-width: 270px; } time { white-space: nowrap; }
.threat-report-title { display: flex; align-items: center; flex-wrap: wrap; gap: 9px; }
.threat-report-title h2 { margin-bottom: 0; }
.report-help { display: inline-grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 1px solid #96b09f; border-radius: 50%; background: #f3f8f1; color: #245443; font-size: 15px; font-weight: 700; cursor: pointer; }
.report-help-tooltip { position: fixed; margin: 0; max-width: min(340px, calc(100vw - 24px)); box-sizing: border-box; padding: 13px 15px; border: 1px solid #abc2b0; border-radius: 10px; background: #f2f8ef; color: #244a39; font-size: 13px; line-height: 1.6; box-shadow: 0 5px 18px #173f3420; }
.report-help-tooltip::backdrop { background: transparent; }
.report-device { display: grid; gap: 2px; margin-bottom: 5px; }
.report-device small { color: #617568; font-size: 11px; }
.review-status { display: inline-block; border-radius: 6px; padding: 3px 8px; white-space: nowrap; font-size: 12px; }
.report-limitations { padding: 15px 18px; margin-top: 20px; border-radius: 10px; background: #f0f5ef; } .report-limitations h3 { margin: 0 0 6px; font-size: 14px; } .report-limitations p { margin: 6px 0; font-size: 12px; line-height: 1.7; }
.export-actions { display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; margin-top: 18px; }.empty-report { padding: 16px; background: #f5f7f2; border-radius: 8px; font-size: 14px; }
button { max-width: 100%; white-space: normal; } .threat-table-scroll:focus-visible, button:focus-visible, select:focus-visible { outline: 3px solid #468585; outline-offset: 3px; }
@container (max-width: 900px) { .threat-summary { grid-template-columns: repeat(3,minmax(0,1fr)); } }
@container (max-width: 480px) { .threat-summary { grid-template-columns: repeat(2,minmax(0,1fr)); }.summary-item { padding: 13px; }.report-local-filters { padding: 12px; }.export-actions { justify-content: flex-start; } }
</style>
