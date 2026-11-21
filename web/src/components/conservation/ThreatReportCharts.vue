<script setup lang="ts">
import { Chart, registerables, type ChartConfiguration } from 'chart.js'
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { printChart } from '../../utils/reportExport'
import { threatSources, threatBucketLabel, type ThreatReportView } from '../../services/threatReport'
Chart.register(...registerables)
const props = defineProps<{ view: ThreatReportView; selectedBucketIndex?: number | null }>()
const emit = defineEmits<{ selectBucket: [index: number] }>()
const { t, locale } = useI18n()
const text = (key: string) => t('threatReport.' + key)
const trend = ref<HTMLCanvasElement | null>(null)
let chart: Chart | null = null, generation = 0
const colors = ['#245A46', '#7699AA', '#A3AA9B']
function configuration(selectedIndex: number | null | undefined = props.selectedBucketIndex): ChartConfiguration {
  const view = props.view
  return { type: 'bar', data: {
    labels: view.buckets.map(b => threatBucketLabel(b, locale.value)),
    datasets: threatSources.map((source, i) => ({ label: text(source), data: view.buckets.map(b => b.counts[i]!), backgroundColor: view.buckets.map((_bucket, index) => selectedIndex == null || selectedIndex === index ? colors[i]! : `${colors[i]}55`), borderColor: view.buckets.map((_bucket, index) => selectedIndex === index ? '#173e2f' : colors[i]!), borderWidth: view.buckets.map((_bucket, index) => selectedIndex === index ? 2 : 1), borderRadius: 2, maxBarThickness: 38 })),
  }, options: { responsive: true, maintainAspectRatio: false, animation: false,
    onClick: (_event, elements) => { const index = elements[0]?.index; if (index !== undefined) emit('selectBucket', index) },
    onHover: (event, elements) => { const target = event.native?.target as HTMLElement | undefined; if (target) target.style.cursor = elements.length ? 'pointer' : 'default' },
    plugins: { legend: { display: true, labels: { color: '#245443', boxWidth: 12, boxHeight: 12 } }, tooltip: { callbacks: {
      title: items => view.buckets[items[0]?.dataIndex ?? -1] ? threatBucketLabel(view.buckets[items[0]!.dataIndex]!, locale.value) : '',
      afterBody: items => { const bucket = view.buckets[items[0]?.dataIndex ?? -1]; return bucket ? [`${text('total')}: ${bucket.counts.reduce((sum, count) => sum + count, 0).toLocaleString(locale.value)}`] : [] },
    } } },
    scales: { x: { stacked: true, ticks: { maxTicksLimit: 8, maxRotation: 0 }, title: { display: true, text: text('creationPeriod') }, grid: { display: false } },
      y: { stacked: true, beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: text('count') } } },
  } }
}
async function draw() {
  const token = ++generation; chart?.destroy(); chart = null
  await nextTick(); if (token !== generation || !trend.value) return
  chart = new Chart(trend.value, configuration())
}
function updateSelection() {
  if (!chart) return
  chart.data.datasets.forEach((dataset, sourceIndex) => {
    dataset.backgroundColor = props.view.buckets.map((_bucket, index) => props.selectedBucketIndex == null || props.selectedBucketIndex === index ? colors[sourceIndex]! : `${colors[sourceIndex]}55`)
    dataset.borderColor = props.view.buckets.map((_bucket, index) => props.selectedBucketIndex === index ? '#173e2f' : colors[sourceIndex]!)
    dataset.borderWidth = props.view.buckets.map((_bucket, index) => props.selectedBucketIndex === index ? 2 : 1)
  })
  chart.update('none')
}
watch(() => [props.view, locale.value], draw, { immediate: true })
watch(() => props.selectedBucketIndex, updateSelection)
onBeforeUnmount(() => { generation++; chart?.destroy() })
function toPrintDataUrl() {
  const config = configuration(null)
  config.options!.plugins!.title = { display: true, text: text('trend'), color: '#245443', font: { size: 20 } }
  return printChart(config)
}
defineExpose({ toPrintDataUrl, configuration })
</script>
<template>
  <section class="threat-chart"><h3>{{ text('trend') }}</h3><p>{{ text(view.interval) }}<template v-if="view.step > 1"> × {{ view.step }}</template> · {{ text('creationBasis') }}</p><div class="chart-canvas"><canvas ref="trend" role="img" :aria-label="text('trend') + '. ' + text('chartAlternative')" /></div><p class="chart-interaction-note">{{ text('chartInteraction') }}</p></section>
</template>
<style scoped>
.threat-chart { min-width: 0; width: 100%; box-sizing: border-box; border: 1px solid #dce7de; border-radius: 13px; padding: 18px; margin: 24px 0; background: #fff; }
h3 { margin: 0; color: #245443; font-size: 17px; line-height: 1.4; }
p { color: #617568; font-size: 12px; line-height: 1.5; margin: 6px 0 14px; overflow-wrap: anywhere; }
.chart-interaction-note { margin: 10px 0 0; font-size: 12px; }
.chart-canvas { height: 285px; min-width: 0; position: relative; }
canvas { max-width: 100%; }
@container (max-width: 480px) { .threat-chart { padding: 12px; } .chart-canvas { height: 250px; } }
</style>
