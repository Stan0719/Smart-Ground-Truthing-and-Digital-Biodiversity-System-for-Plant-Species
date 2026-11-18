<script setup lang="ts">
import { Chart, registerables, type ChartConfiguration } from 'chart.js'
import { computed, ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import type { IoTSummary } from '../../services/iotReporting'
import { iotTimestamp, iotAxisLabel, iotVisibleTickIndexes } from '../../utils/iotBucketDisplay'
import { printChart } from '../../utils/reportExport'
Chart.register(...registerables)
const props = defineProps<{ report: IoTSummary }>()
const { t, locale } = useI18n()
const canvas = ref<HTMLCanvasElement | null>(null)
const selectedIndex = ref<number | null>(null)
const keyboardActive = ref(false)
const label = (key: string) => t(`conservationPages.reports.iotSummary.${key}`)
const movementHighlights = computed(() => {
  const buckets = props.report.buckets
  const highest = buckets.reduce((max, b) => b.validMeasurements ? Math.max(max, b.detectedSampleCount!) : max, 0)
  const final = buckets.length - 1
  // The all-zero case explicitly highlights the latest bucket with valid samples.
  const latest = highest === 0 ? buckets.reduce((index, b, current) => b.validMeasurements > 0 ? current : index, -1) : final
  return buckets.map((b, index) => {
    const isHighest = b.validMeasurements > 0 && highest > 0 && b.detectedSampleCount === highest
    const isLatest = b.validMeasurements > 0 && index === latest
    return { highest: isHighest, latest: isLatest, latestValid: isLatest && index !== final,
      color: !b.validMeasurements ? 'transparent' : isHighest ? '#E88936' : isLatest ? '#245A46' : '#D0E4D5' }
  })
})
const movementContext = (index: number) => {
  const highlight = movementHighlights.value[index]
  return highlight ? [highlight.latest ? label(highlight.latestValid ? 'latestValidPeriod' : 'latestPeriod') : '', highlight.highest ? label('highestDetectionCount') : ''].filter(Boolean) : []
}
const bucketRange = (index: number) => {
  const r = props.report, bucket = r.buckets[index]
  return bucket ? `${iotTimestamp(bucket.startInclusive, locale.value, r.scope.timezone)} – ${iotTimestamp(bucket.endExclusive, locale.value, r.scope.timezone)}` : ''
}
const inspection = computed(() => {
  const r = props.report, bucket = selectedIndex.value === null ? null : r.buckets[selectedIndex.value]
  if (!bucket) return ''
  const number = (value: number | null) => value === null ? '—' : new Intl.NumberFormat(locale.value, { maximumFractionDigits: 4 }).format(value)
  if (r.measurement.key === 'movement') return `${bucketRange(selectedIndex.value!)} · ${label('movementDetectedReadings')}: ${number(bucket.validMeasurements ? bucket.detectedSampleCount! : null)} · ${label('validReadings')}: ${number(bucket.validMeasurements)} · ${label('missingMeasurements')}: ${number(bucket.missingMeasurements)}${bucket.validMeasurements ? '' : ` · ${label('noValid')}`} ${movementContext(selectedIndex.value!).join(' · ')}`.trim()
  return `${bucketRange(selectedIndex.value!)} · ${label('average')}: ${number(bucket.average)} ${r.measurement.unit} · ${label('maximum')}: ${number(bucket.maximum)} ${r.measurement.unit} · ${label('validMeasurements')}: ${number(bucket.validMeasurements)}${bucket.validMeasurements ? '' : ` · ${label('noValid')}`}`
})
function inspectKey(event: KeyboardEvent) {
  const last = props.report.buckets.length - 1
  if (last < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const current = selectedIndex.value ?? 0
  selectedIndex.value = event.key === 'Home' ? 0 : event.key === 'End' ? last : Math.max(0, Math.min(last, current + (event.key === 'ArrowRight' ? 1 : -1)))
  showMovementTooltip()
}
let chart: Chart | null = null, generation = 0
function showMovementTooltip() {
  if (props.report.measurement.key !== 'movement' || !chart || selectedIndex.value === null) return
  const index = selectedIndex.value, bar = chart.getDatasetMeta(0).data[index]
  if (!bar) return
  if (!props.report.buckets[index]?.validMeasurements) {
    chart.tooltip?.setActiveElements([], { x: 0, y: 0 }); chart.update('none'); return
  }
  chart.tooltip?.setActiveElements([{ datasetIndex: 0, index }], { x: bar.x, y: bar.y })
  chart.update('none')
}
function focusChart() {
  keyboardActive.value = true
  selectedIndex.value = props.report.buckets.length ? 0 : null
  showMovementTooltip()
}
function blurChart() {
  keyboardActive.value = false; selectedIndex.value = null
  if (props.report.measurement.key === 'movement' && chart) {
    chart.tooltip?.setActiveElements([], { x: 0, y: 0 }); chart.update('none')
  }
}
function configuration(): ChartConfiguration<'line' | 'bar'> {
  const r = props.report
  const movement = r.measurement.key === 'movement'
  const axisLabels = r.buckets.map(b => iotAxisLabel(b, r.aggregation.interval, locale.value, r.scope.timezone))
  let visibleMovementLabels = new Set<number>()
  return { type: movement ? 'bar' : 'line', data: { labels: r.buckets.map(b => iotAxisLabel(b, r.aggregation.interval, locale.value, r.scope.timezone)), datasets: movement ? [{ label: label('movementDetectedReadings'), data: r.buckets.map((b, bucketIndex) => ({ x: bucketIndex, y: b.validMeasurements ? b.detectedSampleCount! : null })), backgroundColor: movementHighlights.value.map(h => h.color), borderColor: movementHighlights.value.map(h => h.color), borderRadius: 3, maxBarThickness: 38, categoryPercentage: .8, barPercentage: .85 }] : (['average', 'maximum'] as const).map((key, index) => ({ label: `${label(key)} (${r.measurement.unit})`, data: r.buckets.map((b, bucketIndex) => ({ x: bucketIndex, y: b[key] })), borderColor: index ? '#f18418' : '#2c9148', backgroundColor: index ? '#f18418' : '#2c9148', spanGaps: false, tension: 0, pointRadius: r.buckets.length > 100 ? 0 : 3 })) }, options: {
    responsive: true, maintainAspectRatio: false, animation: false, parsing: false, locale: locale.value,
    layout: { padding: { left: 12, right: 12 } },
    interaction: { mode: 'index', intersect: false },
    onHover: (event, _elements, activeChart) => {
      if (event.x == null || !activeChart.scales.x || event.type === 'mouseout') { selectedIndex.value = null; return }
      const index = Math.round(Number(activeChart.scales.x.getValueForPixel(event.x)))
      selectedIndex.value = Number.isFinite(index) && index >= 0 && index < r.buckets.length ? index : null
    },
    plugins: { legend: { position: 'bottom', ...(movement ? { onClick: () => {}, labels: { boxWidth: 12, boxHeight: 10, padding: 12, generateLabels: () => [
      { text: label('otherPeriods'), fillStyle: '#D0E4D5', strokeStyle: '#D0E4D5', lineWidth: 0 },
      { text: label('latestPeriod'), fillStyle: '#245A46', strokeStyle: '#245A46', lineWidth: 0 },
      { text: label('highestDetectionCount'), fillStyle: '#E88936', strokeStyle: '#E88936', lineWidth: 0 },
    ] } } : {}) }, tooltip: { callbacks: {
      title: items => bucketRange(items[0]?.dataIndex ?? -1),
      afterBody: items => { const bucket = r.buckets[items[0]?.dataIndex ?? -1]; return bucket ? movement ? [`${label('validReadings')}: ${new Intl.NumberFormat(locale.value).format(bucket.validMeasurements)}`, `${label('missingMeasurements')}: ${new Intl.NumberFormat(locale.value).format(bucket.missingMeasurements)}`, ...movementContext(items[0]?.dataIndex ?? -1)] : `${label('validMeasurements')}: ${new Intl.NumberFormat(locale.value).format(bucket.validMeasurements)}` : '' },
    } } },
    scales: { x: { type: 'category', ...(movement ? { offset: true } : {}), afterBuildTicks: scale => {
      const labels = r.buckets.map(b => iotAxisLabel(b, r.aggregation.interval, locale.value, r.scope.timezone))
      scale.ctx.save()
      // Print charts set a larger font; measure the active chart, not globals.
      const font = scale.chart.options.font
      scale.ctx.font = `${font?.size ?? Chart.defaults.font.size}px ${font?.family ?? Chart.defaults.font.family}`
      const usableWidth = movement && labels.length ? scale.width * (labels.length - 1) / labels.length : scale.width
      const visible = new Set(iotVisibleTickIndexes(labels.map(value => scale.ctx.measureText(value).width), usableWidth))
      scale.ctx.restore()
      // Bar controllers also use ticks to calculate category geometry. Keep every
      // Movement tick and hide text only; center labels on the same index as bars.
      if (movement) visibleMovementLabels = visible
      else scale.ticks = scale.ticks.filter(tick => visible.has(tick.value))
    }, ticks: { autoSkip: false, align: movement ? 'center' : 'inner', minRotation: 0, maxRotation: 0, ...(movement ? { callback: (value: string | number) => visibleMovementLabels.has(Number(value)) ? axisLabels[Number(value)] : '' } : {}) } }, y: { ...(movement ? { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#e7ece8' } } : {}), title: { display: true, text: movement ? label('movementDetectedReadings') : `${t(`conservationPages.reports.operational.${r.measurement.key}`)} (${r.measurement.unit})` } } },
  } }
}
watch(() => [props.report, locale.value], async () => { const token = ++generation; selectedIndex.value = null; keyboardActive.value = false; chart?.destroy(); chart = null; await nextTick(); if (canvas.value && token === generation) chart = new Chart(canvas.value, configuration()) }, { immediate: true })
onBeforeUnmount(() => { generation++; chart?.destroy() })
defineExpose({ toPrintDataUrl: () => {
  const config = configuration()
  if (props.report.measurement.key === 'movement') {
    config.options!.plugins = { ...config.options!.plugins, title: { display: true, text: label('movementTrend'), color: '#164f38' } }
  }
  return printChart(config)
} })
</script>
<template><div class="iot-chart-accessible"><div class="iot-trend"><canvas ref="canvas" role="img" :tabindex="report.buckets.length ? 0 : -1" :aria-label="`${label('chartDescription')} ${label('chartKeyboard')}`" @focus="focusChart" @blur="blurChart" @keydown="inspectKey">{{ label('chartDescription') }}</canvas></div><p class="iot-chart-note">{{ label(report.measurement.key === 'movement' ? 'movementPeriodNote' : 'categorySpacing') }}</p><p v-if="inspection && keyboardActive" class="iot-chart-inspection chart-screen-reader" role="status" aria-live="polite">{{ inspection }}</p></div></template>
<style scoped>
.iot-trend { position: relative; height: 340px; min-width: 0; max-width: 100%; }
.iot-trend canvas { max-width: 100%; }
.iot-chart-accessible { min-width: 0; max-width: 100%; }
.iot-trend canvas:focus-visible { outline: 2px solid #569374; outline-offset: 2px; border-radius: 4px; }
.iot-chart-note, .iot-chart-inspection { margin: 10px 0 0; font-size: .8rem; color: #61756b; line-height: 1.6; overflow-wrap: anywhere; }
.chart-screen-reader { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); clip-path: inset(50%); white-space: nowrap; border: 0; }
@media (max-width: 600px) { .iot-trend { height: 280px; } }
</style>
