<script setup lang="ts">
import { Chart, registerables } from 'chart.js'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

Chart.register(...registerables)

export interface SensorChartPoint {
  recordedAt: string
  value: number
}

const props = defineProps<{
  title: string
  unit: string
  emptyMessage: string
  points: SensorChartPoint[]
  type?: 'line' | 'bar'
}>()

const canvas = ref<HTMLCanvasElement | null>(null)
const hasData = computed(() => props.points.length > 0)
let chart: Chart | null = null

const formatTimestamp = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-MY', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

const renderChart = async () => {
  chart?.destroy()
  chart = null
  if (!hasData.value) return
  await nextTick()
  if (!canvas.value) return

  const isBar = props.type === 'bar'
  chart = new Chart(canvas.value, {
    type: isBar ? 'bar' : 'line',
    data: {
      labels: props.points.map((point) => formatTimestamp(point.recordedAt)),
      datasets: [
        {
          label: `${props.title} (${props.unit})`,
          data: props.points.map((point) => point.value),
          borderColor: '#3f866a',
          backgroundColor: isBar ? 'rgba(79, 151, 116, 0.42)' : 'rgba(79, 151, 116, 0.12)',
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 4,
          tension: 0.24,
          fill: !isBar,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) => `${context.parsed.y} ${props.unit}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#75867e', maxRotation: 35, minRotation: 0 },
        },
        y: {
          beginAtZero: isBar,
          grid: { color: 'rgba(76, 108, 94, 0.1)' },
          ticks: { color: '#75867e', callback: (value) => `${value} ${props.unit}` },
        },
      },
    },
  })
}

onMounted(renderChart)
watch(() => [props.points, props.title, props.unit, props.type], renderChart, { deep: true })
onBeforeUnmount(() => chart?.destroy())
</script>

<template>
  <article class="sensor-history-chart">
    <h3>{{ title }}</h3>
    <div v-if="hasData" class="chart-canvas"><canvas ref="canvas"></canvas></div>
    <p v-else class="chart-empty">{{ emptyMessage }}</p>
  </article>
</template>

<style scoped>
.sensor-history-chart {
  min-width: 0;
  padding: 16px;
  border: 1px solid #e2e9e3;
  border-radius: 12px;
  background: #fbfcfa;
}
.sensor-history-chart h3 {
  margin: 0 0 12px;
  color: #34594b;
  font-size: 13px;
}
.chart-canvas {
  position: relative;
  height: 230px;
}
.chart-empty {
  min-height: 180px;
  margin: 0;
  display: grid;
  place-items: center;
  color: #829088;
  font-size: 11px;
  text-align: center;
}
</style>
