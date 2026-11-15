<script setup lang="ts">
import { workflowBadgeStyle } from '../utils/workflowBadge'
import { computed, reactive, ref } from 'vue'
import { formatPlantDateTime } from '../utils/plantDateTime'
import { useConservationText } from '../composables/useConservationText'
import type { HistoryObservation } from '../services/plantHistory'
import PlantPhotoLightbox from './PlantPhotoLightbox.vue'
const props = defineProps<{ observations: HistoryObservation[]; loading: boolean; error: string; complete: boolean; hasMore: boolean }>()
defineEmits<{ retry: []; more: [] }>()
const { ct } = useConservationText()
const dateTime = (value: unknown) => formatPlantDateTime(value, ct('Unavailable'))
// origin is the backend's verified effective origin. Unknown is never guessed.
// Filter presentation only; pagination still follows every server continuation.
const visibleObservations = computed(() => props.observations.filter(observation => observation.origin !== 'initial_registration'))
const lightbox = ref<InstanceType<typeof PlantPhotoLightbox> | null>(null), failed = reactive(new Set<string>())
const display = (value: string | number | null) => value === null || value === '' ? ct('Unavailable') : value
function enlarge(observation: HistoryObservation, index: number, event: MouseEvent) {
  void lightbox.value?.open(observation.assets, index, `${ct('Observation')} · ${dateTime(observation.date)}`, event.currentTarget as HTMLElement)
}
</script>

<template>
  <section class="observation-history" :aria-busy="loading" aria-labelledby="plant-history-title">
    <header class="history-heading"><div><p class="eyebrow">{{ ct('FIELD RECORD') }}</p><h2 id="plant-history-title">{{ ct('Observation History') }}</h2></div><p v-if="visibleObservations.length" role="status">{{ visibleObservations.length }} {{ ct(complete && !hasMore ? 'observations' : 'observations loaded') }}</p></header>
    <p v-if="loading" role="status">{{ ct('Loading observation history…') }}</p>
    <div v-if="error" class="history-error" role="alert"><p>{{ ct(error) }}</p><button type="button" :disabled="loading" @click="$emit('retry')">{{ ct('Retry') }}</button></div>
    <p v-if="!loading && complete && !hasMore && !visibleObservations.length && !error" class="empty-history">{{ ct('No subsequent or unclassified observations are available for this plant.') }}</p>
    <p v-if="!loading && hasMore && !visibleObservations.length && !error" role="status">{{ ct('No subsequent or unclassified observations are loaded yet. More pages remain.') }}</p>
    <details v-for="observation in visibleObservations" :key="observation.id" class="observation-row">
      <summary>
        <span class="observation-date"><strong>{{ dateTime(observation.date) }}</strong><small>{{ ct(observation.origin === 'subsequent_observation' ? 'Subsequent observation' : 'Origin not verified') }}</small></span>
        <span class="recorded-by"><small>{{ ct('Recorded by') }}</small>{{ display(observation.recorded_by) }}</span>
        <span class="status-badge" :style="workflowBadgeStyle(observation.status)" :data-status="observation.status">{{ ct(observation.status) }}</span>
        <span class="photo-count">{{ observation.assets.length }} {{ ct('photos') }}</span>
        <span class="expand-mark" aria-hidden="true">+</span>
      </summary>
      <div class="observation-details">
        <dl class="observation-facts">
          <div><dt>{{ ct('Height') }}</dt><dd>{{ observation.content.heightCm === null ? ct('Unavailable') : `${observation.content.heightCm} cm` }}</dd></div>
          <div><dt>{{ ct('Health status') }}</dt><dd>{{ display(observation.content.healthStatus) }}</dd></div>
          <div><dt>{{ ct('Life stage') }}</dt><dd>{{ display(observation.content.lifeStage) }}</dd></div>
          <div class="wide"><dt>{{ ct('Morphology') }}</dt><dd>{{ display(observation.content.morphology) }}</dd></div>
          <div class="wide"><dt>{{ ct('Notes') }}</dt><dd>{{ display(observation.content.notes) }}</dd></div>
        </dl>
        <section class="gps-evidence"><h3>{{ ct('Submitted GPS Evidence') }}</h3><p>{{ ct('Submitted evidence is separate from the approved plant location.') }}</p>
          <dl class="observation-facts">
            <div><dt>{{ ct('Latitude') }}</dt><dd>{{ display(observation.content.latitude) }}</dd></div>
            <div><dt>{{ ct('Longitude') }}</dt><dd>{{ display(observation.content.longitude) }}</dd></div>
            <div><dt>{{ ct('GPS Accuracy') }}</dt><dd>{{ observation.content.accuracy_m === null ? ct('Unavailable') : `${observation.content.accuracy_m} m` }}</dd></div>
            <div><dt>{{ ct('Altitude') }}</dt><dd>{{ observation.content.altitude_m === null ? ct('Unavailable') : `${observation.content.altitude_m} m` }}</dd></div>
            <div><dt>{{ ct('Zone') }}</dt><dd>{{ display(observation.content.zone) }}</dd></div>
          </dl>
        </section>
        <p v-if="observation.review" class="review-note"><strong>{{ ct(observation.review.decision) }} · {{ dateTime(observation.review.created_at) }}</strong><span>{{ observation.review.comment }}</span></p>
        <div v-if="observation.assets.length" class="history-thumbnails" role="group" :aria-label="ct('Observation photos')">
          <button v-for="(photo, index) in observation.assets" :key="photo.id" type="button" :aria-label="`${ct('Enlarge observation photo')} ${index + 1} / ${observation.assets.length}`" @click="enlarge(observation, index, $event)">
            <img v-if="!failed.has(photo.id)" :src="photo.url" alt="" loading="lazy" @error="failed.add(photo.id)" /><span v-else>{{ ct('Photo unavailable') }}</span><small>{{ index + 1 }}</small>
          </button>
        </div>
        <p v-else class="registration-note">{{ ct('No photos are available for this observation.') }}</p>
      </div>
    </details>
    <footer v-if="hasMore"><p>{{ ct('More history pages are available. This is not the complete history.') }}</p><button type="button" :disabled="loading" @click="$emit('more')">{{ ct('Load more observations') }}</button></footer>
    <PlantPhotoLightbox ref="lightbox" />
  </section>
</template>

<style scoped>
.observation-history { padding: 26px 28px; border-radius: 20px; background: #fff; color: #315447; box-shadow: 0 8px 32px #254b3a08; }
.history-heading { display: flex; justify-content: space-between; align-items: center; gap: 20px; margin-bottom: 22px; }
.eyebrow { margin: 0 0 7px; font-size: 10px; letter-spacing: .13em; color: #66796b; }
h2 { margin: 0; font-size: 24px; font-weight: 600; }
.history-heading > p, footer p { font-size: 12px; color: #66796b; }
.observation-row { border-top: 1px solid #dfe6dd; }
summary { display: grid; grid-template-columns: minmax(150px, 1.4fr) minmax(110px, 1fr) auto 72px 20px; gap: 20px; align-items: center; padding: 18px 0; cursor: pointer; list-style: none; font-size: 13px; }
summary::-webkit-details-marker { display: none; }
summary:hover { color: #216b45; }
summary:focus-visible, button:focus-visible { outline: 3px solid #315f4e; outline-offset: 3px; border-radius: 6px; }
.observation-date, .recorded-by { display: grid; gap: 5px; overflow-wrap: anywhere; }
summary small { color: #66796b; font-size: 11px; font-weight: 400; }
.status-badge { padding: 5px 9px; border-radius: 6px; background: #eef2e8; font-size: 11px; }
.expand-mark { font-size: 22px; text-align: center; transition: transform 120ms; }
details[open] .expand-mark { transform: rotate(45deg); }
.observation-details { padding: 0 0 24px; animation: reveal 120ms ease-out; }
.observation-facts { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 16px; margin: 0; }
.observation-facts dt { color: #66796b; font-size: 11px; }
.observation-facts dd { margin: 6px 0 0; font-size: 13px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
.wide { grid-column: 1 / -1; }
.gps-evidence { margin-top: 22px; padding-top: 18px; border-top: 1px solid #edf0e9; }
h3 { margin: 0; font-size: 14px; }
.gps-evidence p, .registration-note { color: #66796b; font-size: 12px; line-height: 1.6; }
.review-note { display: grid; gap: 6px; margin-top: 20px; padding: 12px; background: #f4f7f1; border-radius: 8px; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.history-thumbnails { display: flex; gap: 10px; overflow-x: auto; padding: 5px 3px; margin-top: 18px; }
.history-thumbnails button { position: relative; flex: 0 0 96px; height: 76px; padding: 3px; border: 1px solid #dfe6dd; border-radius: 8px; background: #f4f7f1; color: #315447; cursor: zoom-in; }
.history-thumbnails img { width: 100%; height: 100%; object-fit: contain; border-radius: 5px; }
.history-thumbnails span { font-size: 11px; }
.history-thumbnails small { position: absolute; right: 4px; bottom: 4px; padding: 2px 5px; background: #173f34d9; color: #fff; border-radius: 3px; }
footer { display: flex; align-items: center; justify-content: space-between; gap: 18px; border-top: 1px solid #dfe6dd; padding-top: 16px; }
footer button, .history-error button { min-height: 44px; padding: 9px 14px; border: 1px solid #a8bfae; border-radius: 8px; background: #f4f7f1; color: #315447; font: inherit; font-size: 12px; cursor: pointer; }
.history-error { color: #8d3d35; }
@keyframes reveal { from { opacity: .6; } to { opacity: 1; } }
@media (max-width: 760px) { summary { grid-template-columns: 1fr auto 20px; gap: 12px; } .recorded-by { grid-column: 1; grid-row: 2; } .photo-count { grid-column: 2; grid-row: 2; font-size: 12px; } .expand-mark { grid-column: 3; grid-row: 1 / 3; } }
@media (max-width: 480px) { .observation-history { padding: 20px 16px; } .history-heading, footer { align-items: flex-start; flex-direction: column; gap: 8px; } .observation-facts { grid-template-columns: repeat(2,minmax(0,1fr)); } }
@media (prefers-reduced-motion: reduce) { .observation-details { animation: none; } .expand-mark { transition: none; } }
</style>
