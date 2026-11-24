<script setup lang="ts">
import { computed } from 'vue'
import { useConservationText } from '../../composables/useConservationText'
import { DEFAULT_SENSOR_THRESHOLDS, thresholdRangeLabel, thresholdState } from '../../services/sensorThresholds'
const props = defineProps<{ value: number | null; configured?: unknown; metric?: string; unit?: string }>()
const { ct } = useConservationText()
const usingDefault = computed(() => props.configured === undefined && !!DEFAULT_SENSOR_THRESHOLDS[props.metric || ''])
const limits = computed(() => usingDefault.value ? DEFAULT_SENSOR_THRESHOLDS[props.metric!] : props.configured)
const range = computed(() => thresholdRangeLabel(limits.value, props.unit))
const state = computed(() => thresholdState(props.value, limits.value))
const breached = computed(() => state.value === 'Below minimum' || state.value === 'Above maximum')
const reading = computed(() => {
  if (props.value == null || !Number.isFinite(props.value)) return '—'
  const unit = props.unit && props.unit !== 'raw ADC' ? props.unit : ''
  return `${props.value}${unit === '%' ? '' : unit ? ' ' : ''}${unit}`
})
</script>
<template>
  <span class="threshold-status">
    <strong class="sensor-reading" :class="{ breached }">{{ reading }}</strong>
    <small v-if="range" class="sensor-range">{{ ct(usingDefault ? 'Default range' : 'Range') }}: {{ range }}</small>
    <small v-else class="sensor-range" :aria-label="ct('Not configured')">—</small>
    <span v-if="breached" class="threshold-badge">{{ ct(state) }}</span>
  </span>
</template>
<style scoped>
.threshold-status { display: flex; flex-direction: column; align-items: flex-start; gap: 5px; line-height: 1.4; }
.sensor-reading { font-size: .875rem; font-weight: 600; white-space: nowrap; color: #29483e; }
.sensor-reading.breached { color: #b42318; }
.sensor-range { font-size: .6875rem; font-weight: 400; white-space: nowrap; color: #66766c; }
.threshold-badge { display: inline-flex; padding: 3px 8px; border-radius: 999px; background: #fee8e6; color: #b42318; font-size: .6875rem; font-weight: 600; white-space: nowrap; }
</style>
