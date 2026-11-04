<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import NavigationBar from '../components/NavigationBar.vue'
import { useConservationText } from '../composables/useConservationText'
import {
  enrichPlant,
  hasValidCoordinates,
  mapPlantContract,
  mapSpeciesContract,
  rawPlantIdFromRoute,
  requestPlantApi,
  type EnrichedPlant,
} from '../services/plantIntegration'

const route = useRoute()
const { ct, dt } = useConservationText()
const plant = ref<EnrichedPlant | null>(null)
const isLoading = ref(true)
const loadError = ref('')
const errorStatus = ref(0)
const speciesError = ref('')
let loadRequest = 0

const display = (value: string | null | undefined) => value || ct('Unavailable')
const latest = computed(() => plant.value?.latestApproved || null)
const hasLocation = computed(() => Boolean(plant.value && hasValidCoordinates(plant.value)))
const hasObservationGps = computed(() =>
  latest.value?.latitude !== null && latest.value?.latitude !== undefined &&
  latest.value?.longitude !== null && latest.value?.longitude !== undefined,
)
const pageTitle = computed(() => plant.value?.species?.commonName || plant.value?.species?.scientificName || ct('Plant record'))
const height = computed(() => latest.value?.heightCm === null || latest.value?.heightCm === undefined
  ? ct('Unavailable') : `${latest.value.heightCm} cm`)
const accuracy = (value: number | null | undefined) => value === null || value === undefined
  ? ct('Unavailable') : `${value} m`

async function loadPlant() {
  const requestId = ++loadRequest
  plant.value = null
  loadError.value = ''
  errorStatus.value = 0
  speciesError.value = ''
  isLoading.value = true
  const rawId = rawPlantIdFromRoute(route.params.plantId)
  if (!rawId) {
    loadError.value = ct('Invalid plant identifier.')
    errorStatus.value = 400
    isLoading.value = false
    return
  }
  try {
    const result = await requestPlantApi(`/api/plants/${encodeURIComponent(rawId)}`)
    const mapped = mapPlantContract(result.plant)
    if (!mapped || mapped.id !== rawId) throw new Error('The plant service returned an invalid response.')
    let species = null
    try {
      const speciesResult = await requestPlantApi(`/api/species/${encodeURIComponent(mapped.speciesId)}`)
      species = mapSpeciesContract(speciesResult.species)
      if (!species || species.id !== mapped.speciesId) speciesError.value = ct('Species metadata returned an invalid response.')
    } catch (error) {
      speciesError.value = error instanceof Error ? error.message : ct('Species metadata is unavailable.')
    }
    if (requestId === loadRequest) plant.value = enrichPlant(mapped, new Map(species ? [[species.id, species]] : []))
  } catch (error) {
    if (requestId !== loadRequest) return
    loadError.value = error instanceof Error ? error.message : ct('Unable to load this plant record.')
    errorStatus.value = typeof error === 'object' && error && 'status' in error && typeof error.status === 'number'
      ? error.status : 0
  } finally {
    if (requestId === loadRequest) isLoading.value = false
  }
}

watch(() => route.params.plantId, loadPlant, { immediate: true })
</script>

<template>
  <NavigationBar />

  <main v-if="isLoading" class="state-page" role="status">
    <span class="state-icon" aria-hidden="true">⌛</span>
    <h1>{{ ct('Loading plant record…') }}</h1>
  </main>

  <main v-else-if="loadError" class="state-page" role="alert">
    <span class="state-icon" aria-hidden="true">🌿</span>
    <h1>{{ errorStatus === 404 ? ct('Plant record not found') : ct('Plant record unavailable') }}</h1>
    <p>{{ loadError }}</p>
    <button class="primary-link" type="button" @click="loadPlant">{{ ct('Retry') }}</button>
    <RouterLink to="/conservation/map">{{ ct('Return to biodiversity map') }}</RouterLink>
  </main>

  <main v-else-if="plant" class="plant-detail-page">
    <section class="plant-hero">
      <div class="container">
        <RouterLink :to="{ name: 'conservation-map', query: { plant: plant.id } }" class="back-link">← {{ ct('Back to biodiversity map') }}</RouterLink>
        <div class="hero-grid">
          <div class="image-placeholder" role="img" :aria-label="ct('No plant image was supplied by the plant endpoint.')">
            <span aria-hidden="true">🌿</span><small>{{ ct('No plant image supplied') }}</small>
          </div>
          <div class="hero-copy">
            <p class="eyebrow">{{ ct('CURRENT BACKEND RECORD') }}</p>
            <h1>{{ plant.displayId }}</h1>
            <p class="raw-id">{{ ct('Raw plant ID') }}: {{ plant.id }}</p>
            <h2>{{ pageTitle }}</h2>
            <p class="scientific-name">{{ display(plant.species?.scientificName) }}</p>
            <div class="hero-badges"><span>{{ display(plant.status) }}</span><span v-if="plant.species?.conservationStatus">{{ plant.species.conservationStatus }}</span><span v-if="latest?.lifeStage">{{ latest.lifeStage }}</span></div>
            <p v-if="speciesError" class="inline-error">{{ ct('Species enrichment unavailable:') }} {{ speciesError }}</p>
          </div>
        </div>
      </div>
    </section>

    <section class="content-section"><div class="container content-grid">
      <div class="record-panel">
        <p class="eyebrow">{{ ct('PLANT CONTRACT') }}</p><h2>{{ ct('Plant and species information') }}</h2>
        <dl class="fact-grid">
          <div><dt>{{ ct('Plant ID') }}</dt><dd>{{ plant.displayId }}</dd></div>
          <div><dt>{{ ct('Species ID') }}</dt><dd>{{ plant.speciesId }}</dd></div>
          <div><dt>{{ ct('Plant status') }}</dt><dd>{{ display(plant.status) }}</dd></div>
          <div><dt>{{ ct('Scientific name') }}</dt><dd><em>{{ display(plant.species?.scientificName) }}</em></dd></div>
          <div><dt>{{ ct('Common name') }}</dt><dd>{{ display(plant.species?.commonName) }}</dd></div>
          <div><dt>{{ ct('Genus') }}</dt><dd>{{ display(plant.species?.genus) }}</dd></div>
          <div><dt>{{ ct('Family') }}</dt><dd>{{ display(plant.species?.family) }}</dd></div>
          <div><dt>{{ ct('Conservation status') }}</dt><dd>{{ display(plant.species?.conservationStatus) }}</dd></div>
          <div v-if="plant.species?.description" class="wide"><dt>{{ ct('Description') }}</dt><dd>{{ plant.species.description }}</dd></div>
          <div v-if="plant.species?.habitat" class="wide"><dt>{{ ct('Habitat') }}</dt><dd>{{ plant.species.habitat }}</dd></div>
        </dl>
      </div>

      <aside class="staff-panel">
        <p class="eyebrow">{{ ct('OFFICER-AUTHORISED DATA') }}</p>
        <section><h3>{{ ct('Current / latest recorded plant location') }}</h3><dl>
          <div><dt>{{ ct('Latitude') }}</dt><dd>{{ plant.latitude ?? ct('Unavailable') }}</dd></div>
          <div><dt>{{ ct('Longitude') }}</dt><dd>{{ plant.longitude ?? ct('Unavailable') }}</dd></div>
          <div><dt>{{ ct('GPS Accuracy') }}</dt><dd>{{ accuracy(plant.accuracyM) }}</dd></div>
        </dl><p v-if="!hasLocation" class="availability-note">{{ ct('A valid current plant location is unavailable.') }}</p></section>
        <section><h3>{{ ct('Registration') }}</h3><dl>
          <div><dt>{{ ct('Registered subject') }}</dt><dd>{{ display(plant.registeredSubject) }}</dd></div>
          <div><dt>{{ ct('Registered at') }}</dt><dd>{{ plant.registeredAt ? dt(plant.registeredAt) : ct('Unavailable') }}</dd></div>
        </dl></section>
      </aside>
    </div></section>

    <section class="latest-section"><div class="container">
      <p class="eyebrow">{{ ct('LATEST APPROVED OBSERVATION CONTENT') }}</p>
      <h2>{{ plant.observedAt ? dt(plant.observedAt) : ct('No approved observation available') }}</h2>
      <div v-if="latest" class="observation-summary">
        <div><span>{{ ct('Height') }}</span><strong>{{ height }}</strong></div>
        <div><span>{{ ct('Health status') }}</span><strong>{{ display(latest.healthStatus) }}</strong></div>
        <div><span>{{ ct('Life stage') }}</span><strong>{{ display(latest.lifeStage) }}</strong></div>
        <div class="wide"><span>{{ ct('Morphology') }}</span><strong>{{ display(latest.morphology) }}</strong></div>
        <div class="wide"><span>{{ ct('Notes') }}</span><strong>{{ display(latest.notes) }}</strong></div>
        <div><span>{{ ct('Submitted observation latitude') }}</span><strong>{{ hasObservationGps ? latest.latitude : ct('Unavailable') }}</strong></div>
        <div><span>{{ ct('Submitted observation longitude') }}</span><strong>{{ hasObservationGps ? latest.longitude : ct('Unavailable') }}</strong></div>
        <div><span>{{ ct('Submitted GPS accuracy') }}</span><strong>{{ accuracy(latest.accuracyM) }}</strong></div>
      </div>
      <p v-else class="availability-note">{{ ct('The plant has no latest approved observation content.') }}</p>
      <template v-if="latest && Object.keys(latest.taxonomy).length"><h3>{{ ct('Submitted taxonomy') }}</h3><dl class="taxonomy-list"><div v-for="(value, key) in latest.taxonomy" :key="key"><dt>{{ key }}</dt><dd>{{ value }}</dd></div></dl></template>
    </div></section>

    <section class="history-section"><div class="container limitation-grid">
      <article><p class="eyebrow">{{ ct('ASSETS') }}</p><h2>{{ ct('Submitted media') }}</h2><p>{{ ct('The current plant detail response does not include observation asset IDs. No images or attachments have been fabricated.') }}</p></article>
      <article><p class="eyebrow">{{ ct('HISTORY') }}</p><h2>{{ ct('Observation history') }}</h2><p>{{ ct('Complete observation history is not included in the plant detail response. No capped-list history is presented as complete history.') }}</p><RouterLink class="primary-link" to="/conservation/observations">{{ ct('Browse loaded observations') }}</RouterLink></article>
    </div></section>
  </main>
</template>

<style scoped>
.plant-detail-page { background: #f8f6ee; color: #405f56; }
.container { width: min(1160px, 88%); margin: 0 auto; }
.plant-hero { padding: 62px 0 76px; background: linear-gradient(135deg,#e1eadb,#f7f3e8); }
.back-link { display: inline-block; margin-bottom: 32px; color: #477462; font-weight: 700; text-decoration: none; }
.hero-grid { display: grid; grid-template-columns: 1.05fr .95fr; align-items: center; gap: 70px; }
.image-placeholder { min-height: 390px; display: grid; place-items: center; align-content: center; gap: 12px; border-radius: 24px; background: #dfe9d9; color: #587367; }
.image-placeholder span { font-size: 58px; }
.eyebrow { color: #659061; font-size: 11px; font-weight: 800; letter-spacing: .13em; }
.hero-copy h1 { margin: 10px 0 0; color: #234a3c; font-size: clamp(38px,6vw,72px); }
.hero-copy h2 { margin: 12px 0 2px; color: #315f4e; font-size: 27px; }
.scientific-name { margin: 0; font-style: italic; }
.raw-id { color: #718179; font-size: 12px; }
.hero-badges { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 22px; }
.hero-badges span { padding: 7px 11px; border-radius: 99px; background: #d6e6d3; color: #35652f; font-size: 11px; font-weight: 800; }
.inline-error, .availability-note { color: #8a5a43; }
.content-section, .latest-section, .history-section { padding: 70px 0; }
.content-grid { display: grid; grid-template-columns: 1.25fr .75fr; gap: 48px; }
.record-panel, .staff-panel, .limitation-grid article { padding: 28px; border-radius: 22px; background: #fff; box-shadow: 0 14px 40px rgba(37,75,58,.08); }
.fact-grid, .staff-panel dl, .taxonomy-list { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 14px; }
.fact-grid { margin: 24px 0 0; }
.fact-grid div, .staff-panel dl div, .taxonomy-list div { padding: 12px; border-radius: 12px; background: #f4f7f1; }
.fact-grid dt, .staff-panel dt, .taxonomy-list dt, .observation-summary span { color: #78887f; font-size: 10px; font-weight: 800; text-transform: uppercase; }
.fact-grid dd, .staff-panel dd, .taxonomy-list dd { margin: 5px 0 0; color: #315447; font-weight: 700; overflow-wrap: anywhere; }
.wide { grid-column: 1 / -1; }
.staff-panel section + section { margin-top: 24px; padding-top: 20px; border-top: 1px solid #e1e7df; }
.latest-section { background: #e8efe3; }
.observation-summary { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 14px; margin-top: 24px; }
.observation-summary div { padding: 18px; border-radius: 15px; background: #fff; }
.observation-summary strong { display: block; margin-top: 5px; color: #315447; line-height: 1.55; }
.taxonomy-list { margin-top: 18px; }
.limitation-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
.primary-link { display: inline-block; padding: 11px 17px; border: 0; border-radius: 99px; background: #315f4e; color: #fff; font: inherit; text-decoration: none; cursor: pointer; }
.state-page { min-height: calc(100vh - 76px); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 30px; background: #f4f3e9; color: #50675d; text-align: center; }
.state-page .state-icon { font-size: 48px; }
.state-page a { color: #315f4e; }
@media (max-width: 850px) { .hero-grid, .content-grid, .limitation-grid { grid-template-columns: 1fr; } .observation-summary { grid-template-columns: repeat(2,1fr); } }
@media (max-width: 560px) { .fact-grid, .staff-panel dl, .taxonomy-list, .observation-summary { grid-template-columns: 1fr; } .wide { grid-column: auto; } }
</style>
