<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { PlantSimilarityAnalysis } from '../../data/plantSimilarityPrototype'

const props = defineProps<{
  analysis: PlantSimilarityAnalysis
}>()

const emit = defineEmits<{
  close: []
}>()

const drawer = ref<HTMLElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
let previousBodyOverflow = ''

const percent = (value: number) => `${Math.round(value * 100)}%`
const attentionLabel = (value: number) =>
  value >= 0.9 ? 'High visual similarity' : value >= 0.75 ? 'Moderate visual similarity' : 'Low visual similarity'
const attentionClass = (value: number) =>
  value >= 0.9 ? 'high' : value >= 0.75 ? 'moderate' : 'low'
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
// These categories are prototype review guidance, not validated duplicate thresholds.
const distanceLabel = (distanceMeters?: number) => {
  if (distanceMeters === undefined || !Number.isFinite(distanceMeters) || distanceMeters < 0) {
    return 'Location distance unavailable'
  }
  if (distanceMeters < 10) return 'Very close recorded location'
  if (distanceMeters < 100) return 'Nearby recorded location'
  return 'Different recorded location'
}

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    emit('close')
    return
  }

  if (event.key !== 'Tab' || !drawer.value) return
  const focusable = Array.from(
    drawer.value.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  )
  if (!focusable.length) return

  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}

onMounted(() => {
  previousBodyOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  document.addEventListener('keydown', handleKeydown)
  void nextTick(() => closeButton.value?.focus())
})

onBeforeUnmount(() => {
  document.body.style.overflow = previousBodyOverflow
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div class="similarity-drawer-layer">
      <button
        class="similarity-drawer-backdrop"
        type="button"
        aria-label="Close plant similarity results"
        @click="emit('close')"
      ></button>
      <aside
        ref="drawer"
        class="similarity-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="similarity-drawer-title"
        aria-describedby="similarity-drawer-description"
      >
        <header class="similarity-drawer-header">
          <div>
            <span class="prototype-label">Frontend prototype</span>
            <h2 id="similarity-drawer-title">AI Plant Similarity</h2>
            <p>{{ props.analysis.observationId }} · {{ props.analysis.plantId }}</p>
          </div>
          <button
            ref="closeButton"
            class="drawer-close-button"
            type="button"
            aria-label="Close plant similarity results"
            @click="emit('close')"
          >
            ×
          </button>
        </header>

        <div class="similarity-drawer-body">
          <div id="similarity-drawer-description" class="prototype-disclosure">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 10v6M12 7h.01" />
            </svg>
            <p>
              Frontend prototype: visual similarity and recorded-location comparisons are
              demonstration data and were not generated from the current submission. Neither
              signal confirms that two records represent the same physical plant.
            </p>
          </div>

          <section class="source-summary" aria-labelledby="source-summary-title">
            <div>
              <span class="section-label">Source submission</span>
              <h3 id="source-summary-title">{{ props.analysis.observationId }}</h3>
              <p>{{ props.analysis.plantId }}</p>
            </div>
            <div class="highest-match">
              <strong>{{ percent(props.analysis.highestSimilarity) }}</strong>
              <span>Highest Visual Similarity</span>
              <small :class="attentionClass(props.analysis.highestSimilarity)">
                {{ attentionLabel(props.analysis.highestSimilarity) }}
              </small>
            </div>
          </section>

          <section class="location-comparison" aria-labelledby="location-comparison-title">
            <span class="section-label">Top visual match location</span>
            <div class="location-comparison-content">
              <div>
                <h3 id="location-comparison-title">Recorded distance</h3>
                <strong>{{ formatDistance(topVisualCandidate?.distanceMeters) }}</strong>
              </div>
              <span>{{ distanceLabel(topVisualCandidate?.distanceMeters) }}</span>
            </div>
            <p>
              Location evidence may support duplicate review but does not confirm that the records
              represent the same physical plant.
            </p>
          </section>

          <section aria-labelledby="candidate-results-title">
            <div class="candidate-heading">
              <div>
                <span class="section-label">Ranked candidates</span>
                <h3 id="candidate-results-title">Top Similar Plant Records</h3>
              </div>
              <span>{{ props.analysis.candidates.length }} results</span>
            </div>

            <ol class="candidate-list">
              <li v-for="candidate in props.analysis.candidates" :key="candidate.rank">
                <div class="candidate-rank" :aria-label="`Rank ${candidate.rank}`">
                  {{ candidate.rank }}
                </div>
                <div class="candidate-identity">
                  <strong><em>{{ candidate.scientificName || 'Species unavailable' }}</em></strong>
                  <span v-if="candidate.commonName">{{ candidate.commonName }}</span>
                  <small>
                    {{ candidate.plantId }}
                    <template v-if="candidate.observationId"> · {{ candidate.observationId }}</template>
                  </small>
                  <small class="candidate-distance">
                    Recorded distance: {{ formatDistance(candidate.distanceMeters) }}
                  </small>
                </div>
                <div class="candidate-score">
                  <strong>{{ percent(candidate.similarity) }}</strong>
                  <span :class="attentionClass(candidate.similarity)">
                    {{ attentionLabel(candidate.similarity) }}
                  </span>
                </div>
              </li>
            </ol>
          </section>

          <p class="similarity-footnote">
            Visual-similarity percentages and location distances are prototype demonstration
            values. They are separate review signals, not identification confidence or duplicate
            certainty. Conservation Officer decisions remain independent.
          </p>
        </div>
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.similarity-drawer-layer {
  position: fixed;
  inset: 0;
  z-index: 350;
}

.similarity-drawer-backdrop {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: rgba(12, 35, 28, 0.48);
  cursor: default;
  animation: backdrop-in 180ms ease-out;
}

.similarity-drawer {
  position: absolute;
  top: 0;
  right: 0;
  width: min(440px, 92vw);
  height: 100dvh;
  display: flex;
  flex-direction: column;
  background: #fbfdfb;
  color: #315749;
  box-shadow: -16px 0 44px rgba(18, 52, 40, 0.22);
  animation: drawer-in 220ms ease-out;
}

.similarity-drawer-header {
  padding: 22px 22px 18px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  border-bottom: 1px solid #dce7df;
  background: #f5faf6;
}

.prototype-label,
.section-label {
  display: block;
  color: #648174;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.similarity-drawer-header h2 {
  margin: 5px 0 4px;
  color: #294e40;
  font-size: 20px;
}

.similarity-drawer-header p,
.source-summary p {
  margin: 0;
  color: #71857b;
  font-size: 11px;
}

.drawer-close-button {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid #d4e2d9;
  border-radius: 50%;
  background: #fff;
  color: #3c6555;
  cursor: pointer;
  font-size: 22px;
  line-height: 1;
}

.drawer-close-button:hover {
  background: #eaf3ed;
}

.drawer-close-button:focus-visible {
  outline: 3px solid rgba(65, 132, 104, 0.25);
  outline-offset: 2px;
}

.similarity-drawer-body {
  padding: 20px 22px 28px;
  overflow-y: auto;
}

.prototype-disclosure {
  padding: 12px;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  border: 1px solid #ead8aa;
  border-radius: 10px;
  background: #fff8e7;
  color: #7d611f;
}

.prototype-disclosure svg {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
}

.prototype-disclosure p {
  margin: 0;
  font-size: 10px;
  line-height: 1.55;
}

.source-summary {
  margin: 18px 0 24px;
  padding-bottom: 20px;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  border-bottom: 1px solid #dfe9e2;
}

.source-summary h3,
.candidate-heading h3 {
  margin: 4px 0;
  color: #294e40;
  font-size: 15px;
}

.highest-match {
  display: grid;
  justify-items: end;
  text-align: right;
}

.highest-match strong {
  color: #2d7358;
  font-size: 24px;
  line-height: 1;
}

.highest-match span,
.candidate-heading > span {
  margin-top: 5px;
  color: #7a8b83;
  font-size: 9px;
}

.highest-match small {
  margin-top: 6px;
  font-size: 8px;
  font-weight: 800;
}

.highest-match small.high {
  color: #287a53;
}

.highest-match small.moderate {
  color: #906113;
}

.highest-match small.low {
  color: #53727c;
}

.location-comparison {
  margin: -6px 0 24px;
  padding: 14px;
  border: 1px solid #d6e5dc;
  border-radius: 10px;
  background: #f6faf7;
}

.location-comparison-content {
  margin-top: 8px;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 14px;
}

.location-comparison h3 {
  margin: 0 0 4px;
  color: #587568;
  font-size: 9px;
  font-weight: 700;
}

.location-comparison strong {
  color: #315749;
  font-size: 18px;
}

.location-comparison-content > span {
  color: #3b705b;
  font-size: 9px;
  font-weight: 800;
  text-align: right;
}

.location-comparison p {
  margin: 10px 0 0;
  color: #71817a;
  font-size: 9px;
  line-height: 1.5;
}

.candidate-heading {
  margin-bottom: 12px;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
}

.candidate-list {
  margin: 0;
  padding: 0;
  display: grid;
  list-style: none;
}

.candidate-list li {
  min-width: 0;
  padding: 14px 0;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
  border-top: 1px solid #e3ebe5;
}

.candidate-rank {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #e6f0e9;
  color: #3b705b;
  font-size: 10px;
  font-weight: 800;
}

.candidate-identity {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.candidate-identity strong {
  overflow-wrap: anywhere;
  color: #315749;
  font-size: 11px;
}

.candidate-identity span,
.candidate-identity small {
  overflow-wrap: anywhere;
  color: #71857b;
  font-size: 9px;
}

.candidate-identity .candidate-distance {
  margin-top: 2px;
  color: #496c5e;
  font-weight: 700;
}

.candidate-score {
  display: grid;
  justify-items: end;
  gap: 4px;
  text-align: right;
}

.candidate-score strong {
  color: #315749;
  font-size: 14px;
}

.candidate-score span {
  padding: 3px 6px;
  border-radius: 999px;
  font-size: 7px;
  font-weight: 800;
  white-space: nowrap;
}

.candidate-score .high {
  background: #dff1e6;
  color: #287a53;
}

.candidate-score .moderate {
  background: #fff0d5;
  color: #906113;
}

.candidate-score .low {
  background: #e8eff2;
  color: #53727c;
}

.similarity-footnote {
  margin: 18px 0 0;
  color: #71817a;
  font-size: 9px;
  line-height: 1.55;
}

@keyframes drawer-in {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}

@keyframes backdrop-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@media (max-width: 520px) {
  .similarity-drawer {
    width: 100%;
  }

  .similarity-drawer-header,
  .similarity-drawer-body {
    padding-right: 17px;
    padding-left: 17px;
  }

  .candidate-list li {
    grid-template-columns: 26px minmax(0, 1fr);
  }

  .candidate-score {
    grid-column: 2;
    justify-items: start;
    text-align: left;
  }

  .location-comparison-content {
    align-items: flex-start;
    flex-direction: column;
    gap: 6px;
  }

  .location-comparison-content > span {
    text-align: left;
  }
}

@media (prefers-reduced-motion: reduce) {
  .similarity-drawer,
  .similarity-drawer-backdrop {
    animation: none;
  }
}
</style>
