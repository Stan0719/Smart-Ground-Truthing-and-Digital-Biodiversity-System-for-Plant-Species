<script setup lang="ts">
import { computed } from 'vue'
import { useConservationText } from '../../composables/useConservationText'
import { thresholdLabel, thresholdState } from '../../services/sensorThresholds'
const props = defineProps<{ value: number | null; configured?: unknown }>()
const { ct } = useConservationText()
const state = computed(() => thresholdState(props.value, props.configured))
const breached = computed(() => state.value === 'Below minimum' || state.value === 'Above maximum')
</script>
<template>
  <span class="threshold-status" :class="{ breached }">
    <small v-if="thresholdLabel(configured)">{{ ct('Configured limits') }}: {{ thresholdLabel(configured) }}</small>
    <small>{{ ct(state) }}</small>
  </span>
</template>
<style scoped>
.threshold-status { display: block; margin-top: 4px; color: #57665d; line-height: 1.5; }
.threshold-status small { display: block; font-size: .75rem; }
.threshold-status.breached { color: #a12c23; font-weight: 700; }
</style>
