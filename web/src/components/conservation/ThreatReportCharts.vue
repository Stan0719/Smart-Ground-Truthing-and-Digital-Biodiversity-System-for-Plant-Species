<script setup lang="ts">
import { Chart, registerables, type ChartConfiguration } from 'chart.js'
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { printChart } from '../../utils/reportExport'
import { threatSources, threatBucketLabel, type ThreatReportView } from '../../services/threatReport'
Chart.register(...registerables)
const props = defineProps<{ view: ThreatReportView }>()
const { t, locale } = useI18n()
const text = (key: string) => t('threatReport.' + key)
const trend = ref<HTMLCanvasElement | null>(null)
let chart: Chart | null = null, generation = 0
const colors = ['#245A46', '#7699AA', '#A3AA9B']
function configuration(): ChartConfiguration {
  const view = props.view
  return { type: 'bar', data: {
    labels: view.buckets.map(b => threatBucketLabel(b, locale.value)),
    datasets: threatSources.map((source, i) => ({ label: text(source), data: view.buckets.map(b => b.counts[i]!), backgroundColor: colors[i], borderRadius: 2, maxBarThickness: 38 })),
  }, options: { responsive: true, maintainAspectRatio: false, animation: false,
    plugins: { legend: { display: true, labels: { color: '#245443', boxWidth: 12, boxHeight: 12 } }, tooltip: { callbacks: { title: items => view.buckets[items[0]?.dataIndex ?? -1] ? threatBucketLabel(view.buckets[items[0]!.dataIndex]!, locale.value) : '' } } },
    scales: { x: { stacked: true, ticks: { maxTicksLimit: 8, maxRotation: 0 }, title: { display: true, text: text('creationPeriod') }, grid: { display: false } },
      y: { stacked: true, beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: text('count') } } },
  } }
}
async function draw() {
  const token = ++generation; chart?.destroy(); chart = null
  await nextTick(); if (token !== generation || !trend.value) return
  chart = new Chart(trend.value, configuration())
}
watch(() => [props.view, locale.value], draw, { immediate: true })
onBeforeUnmount(() => { generation++; chart?.destroy() })
function toPrintDataUrl() {
  const config = configuration()
  config.options!.plugins!.title = { display: true, text: text('trend'), color: '#245443', font: { size: 20 } }
  return printChart(config)
}
defineExpose({ toPrintDataUrl, configuration })
</script>
<template>
  <section class="threat-chart"><h3>{{ text('trend') }}</h3><p>{{ text(view.interval) }}<template v-if="view.step > 1"> × {{ view.step }}</template> · {{ text('creationBasis') }}</p><div class="chart-canvas"><canvas ref="trend" role="img" :aria-label="text('trend') + '. ' + text('chartAlternative')" /></div></section>
</template>
<style scoped>
.threat-chart { min-width: 0; width: 100%; box-sizing: border-box; border: 1px solid #dce7de; border-radius: 13px; padding: 18px; margin: 24px 0; background: #fff; }
h3 { margin: 0; color: #245443; font-size: 17px; line-height: 1.4; }
p { color: #617568; font-size: 12px; line-height: 1.5; margin: 6px 0 14px; overflow-wrap: anywhere; }
.chart-canvas { height: 285px; min-width: 0; position: relative; }
canvas { max-width: 100%; }
@container (max-width: 480px) { .threat-chart { padding: 12px; } .chart-canvas { height: 250px; } }
</style>
