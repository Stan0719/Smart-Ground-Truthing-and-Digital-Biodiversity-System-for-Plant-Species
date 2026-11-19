<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import MonitoringIdentifier from './MonitoringIdentifier.vue'
import PlantPhotoLightbox from '../PlantPhotoLightbox.vue'
import { monitoringLabels } from '../../utils/officerMonitoringDisplay'
import { assetUrlFromId } from '../../services/assetImages'
import { similarityBadgeStyle, similarityLabel } from '../../utils/similarityBadge'
import type { PlantSimilarityAnalysis } from '../../data/plantSimilarityPrototype'

const props = defineProps<{
  analysis: PlantSimilarityAnalysis
}>()

const emit = defineEmits<{
  close: []
}>()

const drawer = ref<HTMLElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
let previousRootOverflow = ''
const lightbox = ref<InstanceType<typeof PlantPhotoLightbox> | null>(null)
const failedPhotos = reactive(new Set<string>())
const sourceId = computed(() => props.analysis.rawObservationId || props.analysis.observationId)
const observationLabels = computed(() => monitoringLabels([sourceId.value, ...props.analysis.candidates.map(item => item.rawObservationId || item.observationId)]))
const photoUrl = (id?: string) => id && !failedPhotos.has(id) ? assetUrlFromId(id) : ''
function openPhoto(id: string | undefined, event: Event, label: string) {
  const url = photoUrl(id)
  if (id && url && event.currentTarget instanceof HTMLElement)
    void lightbox.value?.open([{ id, url }], 0, label, event.currentTarget)
}

const percent = (value: number) => `${Math.round(value * 100)}%`
const topVisualCandidate = computed(
  () => props.analysis.candidates.find((candidate) => candidate.rank === 1) ?? props.analysis.candidates[0],
)
const formatDistance = (distanceMeters?: number) => {
  if (distanceMeters === undefined || !Number.isFinite(distanceMeters) || distanceMeters < 0) {
    return 'Distance unavailable'
  }
  if (distanceMeters >= 1000) return `${(distanceMeters / 1000).toFixed(1)} km`
  if (distanceMeters < 10) return `${distanceMeters.toFixed(1)} m`
  return `${Math.round(distanceMeters)} m`
}
// Display guidance only; these distances are not validated duplicate thresholds.
const distanceLabel = (distanceMeters?: number) => {
  if (distanceMeters === undefined || !Number.isFinite(distanceMeters) || distanceMeters < 0) {
    return 'Location distance unavailable'
  }
  if (distanceMeters < 10) return 'Very close recorded location'
  if (distanceMeters < 100) return 'Nearby recorded location'
  return 'Different recorded location'
}

const handleKeydown = (event: KeyboardEvent) => {
  // Native image dialogs own their keyboard interaction while above this drawer.
  if (event.defaultPrevented || drawer.value?.querySelector('dialog[open]') ||
      (event.target instanceof Element && event.target.closest('dialog[open]'))) return
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }

  if (event.key !== 'Tab' || !drawer.value) return
  const focusable = Array.from(
    drawer.value.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter(element => !element.closest('dialog'))
  if (!focusable.length) return

  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (!drawer.value.contains(document.activeElement)) {
    event.preventDefault()
    first?.focus()
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}

onMounted(() => {
  previousRootOverflow = document.documentElement.style.overflow
  document.documentElement.style.overflow = 'hidden'
  document.addEventListener('keydown', handleKeydown)
  void nextTick(() => closeButton.value?.focus())
})

onBeforeUnmount(() => {
  lightbox.value?.close()
  document.documentElement.style.overflow = previousRootOverflow
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div class="similarity-drawer-layer officer-type-layer">
      <button class="similarity-drawer-backdrop" type="button" aria-label="Close plant similarity results" @click="emit('close')"></button>
      <aside ref="drawer" class="similarity-drawer" role="dialog" aria-modal="true" aria-labelledby="similarity-drawer-title" aria-describedby="similarity-drawer-description">
        <header class="similarity-drawer-header">
          <div class="drawer-heading">
            <h2 id="similarity-drawer-title"><svg class="similarity-heading-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 4c0 9-4 15-10 15a6 6 0 0 1-6-6C4 7 11 4 20 4Z M4 21 15 10" /></svg><span>AI Plant Similarity</span></h2>
            <p>BioCLIP 2 &middot; {{ props.analysis.plantId }}</p>
            <div class="source-observation"><span>Observation</span><MonitoringIdentifier :value="sourceId" :labels="observationLabels" copy-label="Copy full source observation ID" :feedback-duration="3000" /></div>
          </div>
          <button ref="closeButton" class="drawer-close-button" type="button" aria-label="Close plant similarity results" @click="emit('close')">&times;</button>
        </header>
        <div class="similarity-drawer-body">
          <section class="comparison-source" aria-labelledby="comparison-source-title">
            <h3 id="comparison-source-title">Submitted Comparison Photo</h3>
            <div class="source-photo-row">
              <button v-if="photoUrl(props.analysis.sourceAssetId)" class="comparison-photo source-photo" type="button" :aria-label="`Enlarge submitted comparison photo for ${props.analysis.plantId}`" @click="openPhoto(props.analysis.sourceAssetId, $event, `Submitted comparison photo \u00b7 ${props.analysis.plantId}`)">
                <img :src="photoUrl(props.analysis.sourceAssetId)" :alt="`Submitted comparison photograph for ${props.analysis.plantId}`" decoding="async" @error="failedPhotos.add(props.analysis.sourceAssetId!)" />
                <svg class="zoom-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M10 7v6M7 10h6"/></svg>
              </button>
              <span v-else class="comparison-photo photo-unavailable" role="status">Photo unavailable.</span>
              <div><p>Source plant <strong>{{ props.analysis.plantId }}</strong></p><small v-if="photoUrl(props.analysis.sourceAssetId)">Click to enlarge</small></div>
            </div>
          </section>
          <section class="similarity-overview" aria-label="Comparison overview">
            <div class="similarity-metric">
              <h3>Highest Visual Similarity</h3>
              <strong class="similarity-score-badge" :style="similarityBadgeStyle(props.analysis.highestSimilarity)">{{ percent(props.analysis.highestSimilarity) }}</strong>
              <span>{{ similarityLabel(props.analysis.highestSimilarity) }}</span>
            </div>
            <div class="similarity-metric">
              <h3>Recorded Distance to Top Visual Match</h3>
              <strong class="recorded-distance">{{ formatDistance(topVisualCandidate?.distanceMeters) }}</strong>
              <span>{{ distanceLabel(topVisualCandidate?.distanceMeters) }}</span>
            </div>
          </section>
          <p id="similarity-drawer-description" class="similarity-caveat">BioCLIP 2 measures visual similarity, not identification confidence or proof of duplication. GPS distance is separate supporting evidence. Conservation Officer decisions remain independent.</p>
          <section aria-labelledby="candidate-results-title">
            <div class="candidate-heading"><h3 id="candidate-results-title">Top Similar Plant Records</h3><span>{{ props.analysis.candidates.length }} {{ props.analysis.candidates.length === 1 ? 'match' : 'matches' }}</span></div>
            <ol class="candidate-list">
              <li v-for="candidate in props.analysis.candidates" :key="candidate.rank">
                <span class="candidate-rank" :aria-label="`Rank ${candidate.rank}`">{{ candidate.rank }}</span>
                <button v-if="photoUrl(candidate.assetId)" class="comparison-photo candidate-photo" type="button" :aria-label="`Enlarge comparison photo for rank ${candidate.rank}, ${candidate.plantId}`" @click="openPhoto(candidate.assetId, $event, `Reference comparison photo \u00b7 ${candidate.plantId}`)">
                  <img :src="photoUrl(candidate.assetId)" :alt="`Reference comparison photograph for ${candidate.plantId}`" loading="lazy" decoding="async" @error="failedPhotos.add(candidate.assetId!)" />
                  <svg class="zoom-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M10 7v6M7 10h6"/></svg>
                </button>
                <span v-else class="comparison-photo candidate-photo photo-unavailable" role="status">Photo unavailable.</span>
                <div class="candidate-identity">
                  <strong><em>{{ candidate.scientificName || 'Species unavailable' }}</em></strong>
                  <span v-if="candidate.commonName">{{ candidate.commonName }}</span>
                  <small>{{ candidate.plantId }}</small>
                  <MonitoringIdentifier v-if="candidate.rawObservationId || candidate.observationId" :value="candidate.rawObservationId || candidate.observationId" :labels="observationLabels" copy-label="Copy full candidate observation ID" :feedback-duration="3000" />
                  <small class="candidate-distance">Recorded distance: {{ formatDistance(candidate.distanceMeters) }}</small>
                </div>
                <div class="candidate-score"><strong class="similarity-score-badge" :style="similarityBadgeStyle(candidate.similarity)" :title="similarityLabel(candidate.similarity)">{{ percent(candidate.similarity) }}</strong><span class="candidate-score-description">{{ similarityLabel(candidate.similarity) }}</span></div>
              </li>
            </ol>
          </section>
        </div>
        <PlantPhotoLightbox ref="lightbox" root-scroll-lock />
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.similarity-drawer-layer { position: fixed; inset: 0; z-index: 350; }
.similarity-drawer-backdrop { position: absolute; inset: 0; width: 100%; height: 100%; padding: 0; border: 0; background: rgb(12 35 28 / 48%); cursor: default; }
.similarity-drawer { position: absolute; top: 0; right: 0; width: min(520px, 94vw); height: 100dvh; display: flex; flex-direction: column; background: var(--paper, #fff); color: var(--ink, #29483e); box-shadow: -12px 0 36px rgb(18 52 40 / 16%); animation: drawer-in 180ms ease-out; }
.similarity-drawer-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 22px 24px 18px; border-bottom: 1px solid var(--line, #dfe7df); }
.drawer-heading { min-width: 0; }
.similarity-drawer-header h2 { display: flex; align-items: center; gap: 9px; margin: 0 0 4px; color: var(--forest, #173f34); }
.similarity-heading-icon { display: block; flex: 0 0 20px; width: 20px; height: 20px; max-width: 20px; max-height: 20px; fill: none; color: var(--green, #33745d); }
.similarity-drawer-header p { margin: 0; }
.source-observation { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 8px; margin-top: 8px; font-size: 13px; }
.similarity-drawer-layer .similarity-drawer .drawer-close-button { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 44px; width: 44px; height: 44px; padding: 0; border: 1px solid var(--forest, #173f34); border-radius: 50%; color: #fff; background: var(--forest, #173f34); font-size: 24px; line-height: 1; cursor: pointer; }
.similarity-drawer-layer .similarity-drawer .drawer-close-button:hover { background: var(--green, #33745d); }
button:focus-visible { outline: 3px solid var(--green, #33745d); outline-offset: 3px; }
.similarity-drawer-body { flex: 1; min-height: 0; min-width: 0; overflow-y: auto; overscroll-behavior: contain; padding: 20px 24px 24px; }
.similarity-drawer-layer .similarity-drawer .comparison-source h3 { margin: 0 0 10px; font-size: 15px; }
.source-photo-row { display: flex; align-items: center; gap: 16px; }
.source-photo-row p { margin: 0 0 4px; }
.source-photo-row small { color: var(--muted, #78877f); }
.comparison-photo { position: relative; display: grid; place-items: center; flex: 0 0 96px; width: 96px; height: 96px; padding: 0; overflow: hidden; border: 1px solid var(--line, #dfe7df); border-radius: 10px; background: var(--wash, #f3f6f2); color: var(--forest, #173f34); cursor: zoom-in; }
.comparison-photo img { display: block; width: 100%; height: 100%; object-fit: cover; }
.zoom-icon { position: absolute; right: 4px; bottom: 4px; width: 22px; height: 22px; padding: 3px; border-radius: 5px; background: rgb(255 255 255 / 92%); }
.photo-unavailable { box-sizing: border-box; padding: 8px; font-size: 12px; line-height: 1.4; text-align: center; color: #5b7065; cursor: default; }
.similarity-overview { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 16px; }
.similarity-metric { min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 12px; background: var(--wash, #f3f6f2); border-radius: 8px; }
.similarity-drawer-layer .similarity-drawer .similarity-metric h3 { margin: 0; font-size: 13px; line-height: 1.45; }
.similarity-metric > span { color: #5b7065; font-size: 12px; line-height: 1.5; }
.similarity-score-badge { display: inline-flex; width: max-content; padding: 4px 9px; border-radius: 999px; background: var(--similarity-background, #e5e7eb); color: var(--similarity-text, #374151); font-size: 17px; line-height: 1.4; white-space: nowrap; }
.recorded-distance { font-size: 18px; line-height: 1.8; overflow-wrap: anywhere; }
.similarity-drawer-layer .similarity-drawer .similarity-caveat { margin: 14px 0 18px; color: #5b7065; font-size: 13px; line-height: 1.55; }
.candidate-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 6px; }
.candidate-heading h3 { margin: 0; color: var(--forest, #173f34); font-size: 17px; }
.candidate-heading > span { flex-shrink: 0; color: #5b7065; }
.candidate-list { margin: 0; padding: 0; list-style: none; }
.candidate-list li { display: grid; grid-template-columns: 22px 64px minmax(0, 1fr) max-content; align-items: start; gap: 10px; padding: 12px 0; border-top: 1px solid var(--line, #dfe7df); }
.candidate-rank { color: var(--green, #33745d); font-weight: 800; }
.candidate-photo { width: 64px; height: 64px; border-radius: 8px; }
.candidate-identity { display: grid; gap: 3px; min-width: 0; overflow-wrap: anywhere; }
.candidate-identity strong { color: var(--ink, #29483e); word-break: normal; overflow-wrap: break-word; }
.candidate-identity > span { word-break: normal; overflow-wrap: break-word; }
.candidate-score { display: grid; justify-items: end; gap: 5px; text-align: right; }
.candidate-score-description { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.similarity-drawer :deep(.monitoring-identifier) { min-width: 0; font-size: 12px; }
.similarity-drawer :deep(.monitoring-id-line) { white-space: nowrap; overflow-wrap: normal; }
.similarity-drawer-layer .similarity-drawer :deep(.monitoring-identifier .monitoring-id-copy) { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 28px; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--green, #33745d); cursor: pointer; }
.similarity-drawer :deep(.monitoring-id-copy:focus-visible) { outline: 2px solid var(--green, #33745d); outline-offset: 2px; }
@keyframes drawer-in { from { transform: translateX(100%); } to { transform: translateX(0); } }
@media (max-width: 520px) {
  .similarity-drawer { width: 100%; }
  .similarity-drawer-header { padding: 18px 16px 14px; }
  .similarity-drawer-body { padding: 16px; }
  .candidate-list li { grid-template-columns: 22px 64px minmax(0, 1fr); gap: 8px; }
  .candidate-score { grid-column: 3; justify-items: start; text-align: left; }
  .similarity-overview { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) { .similarity-drawer { animation: none; } }
</style>
