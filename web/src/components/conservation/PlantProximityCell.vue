<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ProximityEntry } from '../../services/plantProximityQueue'
import { gpsProximityScore, proximityScoreTone, formatProximityScore, gpsAccuracyUncertain } from '../../services/plantProximityScore'
const props = defineProps<{ entry?: ProximityEntry; enabled: boolean }>()
const emit = defineEmits<{ visibility: [visible: boolean]; open: [event: MouseEvent] }>()
const { t, locale } = useI18n(), anchor = ref<HTMLElement | null>(null)
const nearest = computed(() => props.entry?.result?.candidates[0])
const text = (key: string) => t('plantProximity.' + key)
const score = computed(() => props.enabled && props.entry?.state === 'ready' && props.entry.result?.state === 'complete' && nearest.value
  ? gpsProximityScore(nearest.value.distance_m, props.entry.result.config) : null)
const tooltip = computed(() => {
  const result = props.entry?.result
  const uncertainty = result && nearest.value && (gpsAccuracyUncertain(result.accuracy_m, result.config.accuracy_warning_m) || gpsAccuracyUncertain(nearest.value.accuracy_m, result.config.accuracy_warning_m))
  return text('scoreDisclaimer') + (result?.state === 'complete' && !nearest.value ? ' ' + text('noScore') : '') + (uncertainty ? ' ' + text('scoreUncertain') : '')
})
const label = computed(() => {
  const entry = props.entry
  if (!props.enabled) return text('tableUnavailable')
  if (!entry || entry.state === 'idle' || entry.state === 'loading') return text('tableLoading')
  if (entry.state === 'failed' || entry.result?.state === 'unavailable') return text('tableUnavailable')
  if (entry.result?.state === 'not_eligible') return '—'
  if (entry.result?.state === 'incomplete') return text('tableIncomplete')
  if (entry.result?.state === 'complete') return formatProximityScore(score.value, locale.value)
  return text('tableUnavailable')
})
let observer: IntersectionObserver | null = null, disposed = false
onMounted(() => {
  // Observe the row, so horizontal scrolling does not delay visible-row checks.
  const target = anchor.value?.closest('tr') || anchor.value
  if (target && typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver(entries => { if (!disposed) emit('visibility', entries.some(entry => entry.isIntersecting)) }, { rootMargin: '120px 0px' })
    observer.observe(target)
  }
})
onBeforeUnmount(() => { disposed = true; observer?.disconnect(); emit('visibility', false) })
function open(event: MouseEvent) { emit('visibility', true); emit('open', event) }
</script>
<template>
  <span ref="anchor" class="proximity-table-cell">
    <button type="button" class="proximity-table-button" :class="proximityScoreTone(score)" :title="tooltip" :disabled="!enabled || entry?.result?.state === 'not_eligible'" aria-haspopup="dialog" :aria-label="text('scoreColumn') + ': ' + label + '. ' + tooltip + ' ' + text('viewNearby')" :aria-busy="entry?.state === 'loading'" @click="open">{{ label }}</button>
  </span>
</template>
<style scoped>
.proximity-table-cell { display: block; min-width: 0; }
.proximity-table-button { display: inline-flex; flex-wrap: wrap; gap: 4px 6px; align-items: center; max-width: 100%; padding: 5px 8px; border: 1px solid #d2e1d7; border-radius: 7px; background: #f2f7f3; color: #245a46; font: inherit; font-size: 12px; line-height: 1.5; text-align: left; cursor: pointer; }
.proximity-table-button.high { background: #fde2df; border-color: #e9b5b0; color: #973831; }
.proximity-table-button.raised { background: #fff0c5; border-color: #e8d390; color: #79580e; }
.proximity-table-button.moderate { background: #e6f0e7; border-color: #b8d0bc; color: #315c48; }
.proximity-table-button.low { background: #eef1f3; border-color: #cdd6dd; color: #455661; }
.proximity-table-button:disabled { cursor: default; opacity: .65; }
.proximity-table-button:focus-visible { outline: 3px solid #33745d; outline-offset: 3px; }
@media (max-width: 767px) { .proximity-table-button { min-height: 44px; } }
</style>
