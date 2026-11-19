<script setup lang="ts">
import { useConservationText } from '../../composables/useConservationText'
const { ct } = useConservationText()
import { Chart, registerables, type ChartConfiguration } from 'chart.js'
import { printChart } from '../../utils/reportExport'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

Chart.register(...registerables)

const props = defineProps<{
  title: string
  labels: string[]
  scientificNames: string[]
  commonNames: string[]
  axisTitle: string
  approvedLabel: string
  values: number[]
  colors: string[]
  selectedIndex?: number | null
}>()
const emit = defineEmits<{ select: [index: number] }>()

const canvas = ref<HTMLCanvasElement | null>(null)
let chart: Chart<'bar'> | null = null
const hasData = computed(() => props.values.length > 0)
const description = computed(() =>
  props.labels.map((label, index) => `${label}: ${props.values[index] ?? 0}`).join(', '),
)

const configuration = (): ChartConfiguration<'bar'> => ({
    type: 'bar',
    plugins: [{
      id: 'reportChartClick',
      afterEvent: (instance, args) => {
        if (args.event.type !== 'click' || !args.event.native) return
        const points = instance.getElementsAtEventForMode(args.event.native, 'nearest', { intersect: true }, true)
        if (points[0]) emit('select', points[0].index)
      },
    }, {
      id: 'reportCountLabels',
      afterDatasetsDraw: (instance) => {
        const context = instance.ctx
        const bars = instance.getDatasetMeta(0).data
        context.save()
        context.font = '600 12px sans-serif'
        context.fillStyle = '#315749'
        context.textBaseline = 'middle'
        bars.forEach((bar, index) => {
          const value = props.values[index]
          if (!bar || value == null) return
          const x = bar.x + 7
          context.textAlign = x + context.measureText(String(value)).width < instance.chartArea.right ? 'left' : 'right'
          context.fillText(String(value), context.textAlign === 'left' ? x : bar.x - 7, bar.y)
        })
        context.restore()
      },
    }],
    data: {
      labels: props.labels,
      datasets: [
        {
          data: props.values,
          backgroundColor: props.colors.map((color, index) => props.selectedIndex == null || props.selectedIndex === index ? color : `${color}55`),
          borderColor: props.colors,
          borderWidth: 1,
          borderRadius: 5,
          maxBarThickness: 24,
          barPercentage: 0.78,
          categoryPercentage: 0.82,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      animation: false,
      devicePixelRatio: 2,
      onHover: (event, elements) => { if (event.native?.target) (event.native.target as HTMLElement).style.cursor = elements.length ? 'pointer' : 'default' },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          callbacks: {
            title: (items) => {
              const index = items[0]?.dataIndex ?? 0
              return [props.scientificNames[index] || props.labels[index] || '', props.commonNames[index] || '']
            },
            label: (item) => `${props.approvedLabel}: ${item.parsed.x ?? 0}`,
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          grace: '12%',
          title: { display: true, text: props.axisTitle, color: '#5f746a', font: { size: 11, weight: 600 } },
          grid: { color: 'rgba(53, 89, 75, 0.09)' },
          ticks: { precision: 0, color: '#71817a', font: { size: 12 } },
        },
        y: {
          type: 'category',
          ticks: { autoSkip: false, color: '#526b5f', font: { size: 11 }, padding: 8 },
          grid: { display: false },
        },
      },
    },
  })

const renderChart = async () => {
  chart?.destroy()
  chart = null
  if (!hasData.value) return
  await nextTick()
  if (!canvas.value) return
  chart = new Chart(canvas.value, configuration())
}

const toDataUrl = () => (hasData.value && canvas.value ? canvas.value.toDataURL('image/png') : null)

onMounted(renderChart)
watch(() => [props.labels, props.scientificNames, props.commonNames, props.axisTitle, props.approvedLabel, props.values, props.colors, props.selectedIndex], renderChart, { deep: true })
onBeforeUnmount(() => chart?.destroy())

defineExpose({ toDataUrl, toPrintDataUrl: () => hasData.value ? printChart(configuration()) : Promise.resolve(null) })
</script>

<template>
  <section class="report-chart" :aria-label="`${title}. ${description}`">
    <h3>{{ title }}</h3>
    <div v-if="hasData" class="chart-canvas" :style="{ height: `${Math.max(300, props.labels.length * 38)}px` }">
      <canvas ref="canvas" role="img" :aria-label="description">
        {{ description }}
      </canvas>
    </div>
    <p v-else>{{ ct('No data available for this chart with the selected filters.') }}</p>
  </section>
</template>

<style scoped>
.report-chart {
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  margin: 18px 0;
  padding: 18px;
  border: 1px solid #e0e7df;
  border-radius: 13px;
  background: #fff;
}
.report-chart h3 {
  margin: 0 0 14px;
  color: #315749;
  font-size: 13px;
}
.chart-canvas {
  position: relative;
  min-width: 0;
  width: 100%;
  max-width: 100%;
  height: 300px;
}
.chart-canvas canvas { display: block; max-width: 100%; }
@container (max-width: 520px) { .chart-canvas { min-height: 300px; } }
.report-chart p {
  margin: 0;
  padding: 35px 12px;
  color: #87958f;
  font-size: 10px;
  text-align: center;
}
@media (max-width: 620px) {
  .report-chart {
    padding: 14px;
  }
}
</style>
