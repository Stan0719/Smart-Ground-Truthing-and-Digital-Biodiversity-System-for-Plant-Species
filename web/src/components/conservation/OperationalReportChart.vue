<script setup lang="ts">
import { Chart, registerables, type ChartConfiguration } from 'chart.js'
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { OperationalReport } from '../../services/operationalReporting'
import { monitoringDate } from '../../utils/officerMonitoringDisplay'
import { printChart } from '../../utils/reportExport'
import { reportSeries } from '../../utils/reportSeries'
Chart.register(...registerables)
const props = defineProps<{ report: OperationalReport; selectedPeriodIndex?: number | null }>()
const emit = defineEmits<{ selectPeriod: [index: number] }>()
const { t, te, locale } = useI18n()
const label = (key: string) => te(`conservationPages.reports.operational.${key}`) ? t(`conservationPages.reports.operational.${key}`) : key
const canvas = ref<HTMLCanvasElement | null>(null)
let chart: Chart | null = null, revision = 0
const colors: Record<string, string> = { 'Pending Review': '#2969a2', Approved: '#32745b', Rejected: '#b84d42', 'Correction Required': '#a56b13', Flagged: '#8051ad' }
function configuration(selectedIndex: number | null | undefined = props.selectedPeriodIndex): ChartConfiguration {
  const c = props.report.chart, line = c.kind === 'line', stacked = c.kind === 'stacked'
  const config: ChartConfiguration = {
    type: line ? 'line' : 'bar',
    data: {
      labels: line ? undefined : c.labels.map(value => stacked ? monitoringDate(value, locale.value) : label(value)),
      datasets: c.series.map(series => ({
        label: label(series.key),
        data: line ? reportSeries(c.labels, series.values) : series.values,
        borderColor: stacked ? c.labels.map((_value, index) => selectedIndex === index ? '#173e2f' : colors[series.key] || '#32745b') : colors[series.key] || '#32745b',
        backgroundColor: stacked ? c.labels.map((_value, index) => selectedIndex == null || selectedIndex === index ? colors[series.key] || '#32745b' : `${colors[series.key] || '#32745b'}55`) : colors[series.key] || '#32745b',
        spanGaps: false, pointRadius: line ? 2 : undefined, borderWidth: stacked ? c.labels.map((_value, index) => selectedIndex === index ? 2 : 1) : line ? 2 : 1,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, locale: locale.value,
      indexAxis: c.kind === 'horizontal' ? 'y' : 'x',
      ...(line ? { parsing: false } : {}),
      ...(stacked ? {
        onClick: (_event, elements) => { const index = elements[0]?.index; if (index !== undefined) emit('selectPeriod', index) },
        onHover: (event, elements) => { const target = event.native as unknown as HTMLElement | null; if (target) target.style.cursor = elements.length ? 'pointer' : 'default' },
      } : {}),
      plugins: {
        legend: { display: stacked },
        tooltip: { callbacks: line ? { title: items => monitoringDate(new Date(Number(items[0]?.parsed.x)).toISOString(), locale.value) } : stacked ? {
          title: items => c.labels[items[0]?.dataIndex ?? -1] ? monitoringDate(c.labels[items[0]!.dataIndex], locale.value) : '',
          afterBody: items => { const index = items[0]?.dataIndex ?? -1; const total = c.series.reduce((sum, series) => sum + (series.values[index] ?? 0), 0); return `${label('periodTotal')}: ${new Intl.NumberFormat(locale.value).format(total)}` },
        } : {} },
      },
      scales: {
        x: { stacked, type: line ? 'linear' : c.kind === 'horizontal' ? 'linear' : 'category',
          title: { display: true, text: label(line ? 'recordedAt' : c.kind === 'horizontal' ? 'totalIncidents' : 'period') },
          ticks: line ? { maxTicksLimit: 8, callback: value => monitoringDate(new Date(Number(value)).toISOString(), locale.value) } : { maxTicksLimit: 12 } },
        y: { stacked, beginAtZero: !line, title: { display: true, text: label(c.kind === 'horizontal' ? 'category' : line ? c.unit : 'count') } },
      },
    },
  }
  return config
}
async function draw() {
  const token = ++revision
  chart?.destroy(); chart = null
  await nextTick()
  if (!canvas.value || token !== revision) return
  chart = new Chart(canvas.value, configuration())
}
function updateSelection() {
  if (!chart || props.report.chart.kind !== 'stacked') return
  chart.data.datasets.forEach((dataset, seriesIndex) => {
    const color = colors[props.report.chart.series[seriesIndex]?.key || ''] || '#32745b'
    dataset.backgroundColor = props.report.chart.labels.map((_value, index) => props.selectedPeriodIndex == null || props.selectedPeriodIndex === index ? color : `${color}55`)
    dataset.borderColor = props.report.chart.labels.map((_value, index) => props.selectedPeriodIndex === index ? '#173e2f' : color)
    dataset.borderWidth = props.report.chart.labels.map((_value, index) => props.selectedPeriodIndex === index ? 2 : 1)
  })
  chart.update('none')
}
watch(() => [props.report, locale.value], draw, { immediate: true })
watch(() => props.selectedPeriodIndex, updateSelection)
onBeforeUnmount(() => { revision++; chart?.destroy() })
defineExpose({ toDataUrl: () => canvas.value?.toDataURL('image/png') || null, toPrintDataUrl: () => printChart(configuration(null)), configuration })
</script>
<template>
  <div class="operational-chart"><canvas ref="canvas" role="img" :aria-label="label(report.category) + '. ' + label('chartTable')">{{ label('chartTable') }}</canvas></div>
</template>
<style scoped>
.operational-chart { position: relative; height: 340px; min-width: 0; width: 100%; max-width: 100%; box-sizing: border-box; margin-block: 18px; }
.operational-chart canvas { display: block; max-width: 100%; }
@container (max-width: 800px) { .operational-chart { height: 300px; } }
@container (max-width: 520px) { .operational-chart { height: 260px; } }
</style>
