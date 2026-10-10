<script setup lang="ts">
import { Chart, registerables } from 'chart.js'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

Chart.register(...registerables)

const props = defineProps<{
  title: string
  labels: string[]
  values: number[]
  colors: string[]
}>()

const canvas = ref<HTMLCanvasElement | null>(null)
let chart: Chart<'bar'> | null = null
const hasData = computed(() => props.values.some((value) => value > 0))
const description = computed(() =>
  props.labels.map((label, index) => `${label}: ${props.values[index] ?? 0}`).join(', '),
)

const renderChart = async () => {
  chart?.destroy()
  chart = null
  if (!hasData.value) return
  await nextTick()
  if (!canvas.value) return
  chart = new Chart(canvas.value, {
    type: 'bar',
    data: {
      labels: props.labels,
      datasets: [
        {
          data: props.values,
          backgroundColor: props.colors,
          borderColor: props.colors,
          borderWidth: 1,
          borderRadius: 5,
          maxBarThickness: 58,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      devicePixelRatio: 2,
      plugins: { legend: { display: false }, tooltip: { enabled: true } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#5f746a', font: { size: 10 } } },
        y: {
          beginAtZero: true,
          ticks: { precision: 0, color: '#71817a', font: { size: 9 } },
          grid: { color: 'rgba(53, 89, 75, 0.09)' },
        },
      },
    },
  })
}

const toDataUrl = () => (hasData.value && canvas.value ? canvas.value.toDataURL('image/png') : null)

onMounted(renderChart)
watch(() => [props.labels, props.values, props.colors], renderChart, { deep: true })
onBeforeUnmount(() => chart?.destroy())

defineExpose({ toDataUrl })
</script>

<template>
  <section class="report-chart" :aria-label="`${title}. ${description}`">
    <h3>{{ title }}</h3>
    <div v-if="hasData" class="chart-canvas">
      <canvas ref="canvas" role="img" :aria-label="description">
        {{ description }}
      </canvas>
    </div>
    <p v-else>No data available for this chart with the selected filters.</p>
  </section>
</template>

<style scoped>
.report-chart {
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
  height: 300px;
}
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
  .chart-canvas {
    height: 270px;
  }
}
</style>
