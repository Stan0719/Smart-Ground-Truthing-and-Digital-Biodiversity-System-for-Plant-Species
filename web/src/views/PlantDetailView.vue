<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import NavigationBar from '../components/NavigationBar.vue'
import PlantPhotoGallery from '../components/PlantPhotoGallery.vue'
import { createPlantGallery, groupGallery } from '../services/plantGallery'
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

import { currentUser, sessionSnapshot, subscribeSession, type AuthUser } from '../services/auth'

const route = useRoute()
const router = useRouter()
// Only known same-app destinations are accepted; never follow arbitrary return URLs.
const backTarget = computed(() => {
  const previous = router.options.history.state.back
  if (typeof previous !== 'string' || !previous.startsWith('/') || previous.startsWith('//') || previous.includes('\\')) return '/species'
  const resolved = router.resolve(previous)
  const publicSources = ['home', 'species', 'species-detail', 'species-plants']
  const staffSources = ['conservation-dashboard', 'conservation-map', 'conservation-observations', 'conservation-reviews']
  return publicSources.includes(String(resolved.name)) ||
    (canReadStaff.value && staffSources.includes(String(resolved.name))) ? resolved.fullPath : '/species'
})
const { ct, dt } = useConservationText()
const plant = ref<EnrichedPlant | null>(null)
const isLoading = ref(true)
const loadError = ref('')
const errorStatus = ref(0)
const speciesError = ref('')
let loadRequest = 0
let disposed = false
let sessionRequest = 0
const user = ref<AuthUser | null>(null)
const canReadStaff = computed(() => user.value?.role === 'Conservation Officer' && user.value.status === 'Active' && user.value.mustChangePassword === false)
const imageFailed = ref(false)
<<<<<<< Updated upstream
const gallery = createPlantGallery()
const galleryGroups = computed(() => groupGallery(gallery.state.assets))
function loadPhotos(append = false) {
  if (!plant.value || sessionSnapshot().pending) return
  const scientific = Boolean(user.value && ['Botanist', 'Conservation Officer'].includes(user.value.role) && user.value.status === 'Active' && !user.value.mustChangePassword)
  void gallery.load(plant.value.id, scientific, append)
}
function clearRecord() {
  gallery.reset()
=======
function clearRecord() {
>>>>>>> Stashed changes
  loadRequest++
  plant.value = null
  speciesError.value = ''
  imageFailed.value = false
}
const unsubscribe = subscribeSession((verifiedUser, pending) => {
  sessionRequest++
  clearRecord()
  user.value = null
  if (pending) {
    isLoading.value = false
    loadError.value = ct('Verify your session to view this plant.')
    return
  }
  user.value = verifiedUser
  void loadPlant()
})
async function verifySession() {
  const request = ++sessionRequest
  clearRecord()
  user.value = null
  isLoading.value = true
  await currentUser()
  if (disposed || request !== sessionRequest) return
  const state = sessionSnapshot()
  if (state.pending) {
    isLoading.value = false
    loadError.value = ct('Verify your session to view this plant.')
    return
  }
  user.value = state.user
  await loadPlant()
}
const onVisible = () => { if (document.visibilityState === 'visible') void verifySession() }
let sessionTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  window.addEventListener('focus', verifySession)
  document.addEventListener('visibilitychange', onVisible)
  sessionTimer = setInterval(verifySession, 60000)
})
onBeforeUnmount(() => {
  disposed = true; sessionRequest++; clearRecord(); unsubscribe()
  window.removeEventListener('focus', verifySession)
  document.removeEventListener('visibilitychange', onVisible)
  if (sessionTimer) clearInterval(sessionTimer)
})

const display = (value: string | null | undefined) => value || ct('Unavailable')
const latest = computed(() => plant.value?.latestApproved || null)
const hasLocation = computed(() => Boolean(plant.value && hasValidCoordinates(plant.value)))
const submittedGps = computed(() => canReadStaff.value ? plant.value?.submittedGps || null : null)
const hasSubmittedGps = computed(() => submittedGps.value?.latitude != null && submittedGps.value?.longitude != null)
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
  gallery.reset()
  plant.value = null
  imageFailed.value = false
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
    if (disposed || requestId !== loadRequest) return
    let species = null
    try {
      const speciesResult = await requestPlantApi(`/api/species/${encodeURIComponent(mapped.speciesId)}`)
      species = mapSpeciesContract(speciesResult.species)
      if (requestId !== loadRequest || disposed) return
      if (!species || species.id !== mapped.speciesId) speciesError.value = ct('Species metadata returned an invalid response.')
    } catch (error) {
      if (requestId !== loadRequest || disposed) return
      speciesError.value = error instanceof Error ? error.message : ct('Species metadata is unavailable.')
    }
    if (requestId === loadRequest) {
      plant.value = enrichPlant(mapped, new Map(species ? [[species.id, species]] : []))
      loadPhotos()
    }
  } catch (error) {
    if (requestId !== loadRequest) return
    loadError.value = error instanceof Error ? error.message : ct('Unable to load this plant record.')
    errorStatus.value = typeof error === 'object' && error && 'status' in error && typeof error.status === 'number'
      ? error.status : 0
  } finally {
    if (requestId === loadRequest) isLoading.value = false
  }
}

watch(() => route.params.plantId, verifySession, { immediate: true })
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
    <button class="primary-link" type="button" @click="verifySession">{{ ct('Retry') }}</button>
    <RouterLink :to="backTarget" class="back-link"><svg class="back-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m12 5-7 7 7 7M5 12h14" /></svg><span>{{ ct('Back') }}</span></RouterLink>
  </main>

  <main v-else-if="plant" class="plant-detail-page">
    <section class="plant-hero">
      <div class="container">
        <RouterLink :to="backTarget" class="back-link"><svg class="back-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m12 5-7 7 7 7M5 12h14" /></svg><span>{{ ct('Back') }}</span></RouterLink>
        <div class="hero-grid">
          <figure class="image-panel">
          <img v-if="plant.species?.imageUrl && !imageFailed" class="plant-image" :src="plant.species.imageUrl" :alt="pageTitle" @error="imageFailed = true" />
          <div v-else class="image-placeholder" role="img" :aria-label="ct('No plant image was supplied by the plant endpoint.')">
            <span aria-hidden="true">🌿</span><small>{{ ct('No plant image supplied') }}</small>
          </div>
            <figcaption>{{ ct('Species representative image') }}</figcaption>
          </figure>
      <div class="record-panel">
        <h1>{{ ct('Plant Information') }}</h1>
        <p v-if="speciesError" class="inline-error">{{ ct('Species enrichment unavailable:') }} {{ speciesError }}</p>
        <dl class="fact-grid">
          <div><dt>{{ ct('Plant ID') }}</dt><dd>{{ plant.displayId }}</dd></div>
          <div><dt>{{ ct('Scientific name') }}</dt><dd><em>{{ display(plant.species?.scientificName) }}</em></dd></div>
          <div><dt>{{ ct('Common name') }}</dt><dd>{{ display(plant.species?.commonName) }}</dd></div>
          <div><dt>{{ ct('Genus') }}</dt><dd>{{ display(plant.species?.genus) }}</dd></div>
          <div><dt>{{ ct('Family') }}</dt><dd>{{ display(plant.species?.family) }}</dd></div>
          <div v-if="plant.species?.description" class="wide"><dt>{{ ct('Description') }}</dt><dd>{{ plant.species.description }}</dd></div>
        </dl>
      </div>

        </div>
      </div>
    </section>

    <section v-if="canReadStaff" class="content-section"><div class="container">
      <aside v-if="canReadStaff" class="staff-panel">
        <div class="hero-badges"><span>{{ display(plant.status) }}</span><span v-if="plant.species?.conservationStatus">{{ plant.species.conservationStatus }}</span><span v-if="latest?.lifeStage">{{ latest.lifeStage }}</span></div>
        <section><h3>{{ ct('Plant status') }}</h3><dl>
          <div><dt>{{ ct('Raw plant ID') }}</dt><dd>{{ plant.id }}</dd></div>
          <div><dt>{{ ct('Species ID') }}</dt><dd>{{ plant.speciesId }}</dd></div>
          <div><dt>{{ ct('Plant status') }}</dt><dd>{{ display(plant.status) }}</dd></div>
          <div><dt>{{ ct('Conservation status') }}</dt><dd>{{ display(plant.species?.conservationStatus) }}</dd></div>
          <div v-if="plant.species?.habitat" class="wide"><dt>{{ ct('Habitat') }}</dt><dd>{{ plant.species.habitat }}</dd></div></dl></section>

<<<<<<< Updated upstream
        <section><h3>{{ ct('Approved Plant Location') }}</h3><dl>
=======
        <section><h3>{{ ct('Location') }}</h3><dl>
>>>>>>> Stashed changes
          <div><dt>{{ ct('Latitude') }}</dt><dd>{{ plant.latitude ?? ct('Unavailable') }}</dd></div>
          <div><dt>{{ ct('Longitude') }}</dt><dd>{{ plant.longitude ?? ct('Unavailable') }}</dd></div>
          <div><dt>{{ ct('GPS Accuracy') }}</dt><dd>{{ accuracy(plant.accuracyM) }}</dd></div>
          <div v-if="plant.altitudeM !== null"><dt>{{ ct('Altitude') }}</dt><dd>{{ plant.altitudeM }} m</dd></div>
          <div v-if="plant.zone"><dt>{{ ct('Zone') }}</dt><dd>{{ plant.zone }}</dd></div>
        </dl><p v-if="!hasLocation" class="availability-note">{{ ct('No approved plant location is available.') }}</p></section>
        <section class="submitted-gps"><h3>{{ ct('Submitted GPS Evidence') }}</h3>
          <p class="location-context">{{ ct('From the latest linked observation. Submitted evidence is separate from the approved plant location.') }}</p>
          <dl v-if="submittedGps">
            <div><dt>{{ ct('Submission/review status') }}</dt><dd>{{ display(submittedGps.status) }}</dd></div>
            <div><dt>{{ ct('Latitude') }}</dt><dd>{{ submittedGps.latitude ?? ct('Unavailable') }}</dd></div>
            <div><dt>{{ ct('Longitude') }}</dt><dd>{{ submittedGps.longitude ?? ct('Unavailable') }}</dd></div>
            <div v-if="submittedGps.accuracyM !== null"><dt>{{ ct('GPS Accuracy') }}</dt><dd>{{ accuracy(submittedGps.accuracyM) }}</dd></div>
            <div v-if="submittedGps.altitudeM !== null"><dt>{{ ct('Altitude') }}</dt><dd>{{ submittedGps.altitudeM }} m</dd></div>
            <div v-if="submittedGps.zone"><dt>{{ ct('Zone') }}</dt><dd>{{ submittedGps.zone }}</dd></div>
          </dl>
          <p v-if="!hasSubmittedGps" class="availability-note">{{ ct('No valid submitted GPS coordinates are available.') }}</p>
        </section>
        <section><h3>{{ ct('Registration') }}</h3><dl>
          <div><dt>{{ ct('Registered subject') }}</dt><dd>{{ display(plant.registeredSubject) }}</dd></div>
          <div><dt>{{ ct('Registered at') }}</dt><dd>{{ plant.registeredAt ? dt(plant.registeredAt) : ct('Unavailable') }}</dd></div>
        </dl></section>
      </aside>
    </div></section>

    <section v-if="canReadStaff" class="latest-section"><div class="container">
      <p class="eyebrow">{{ ct('Observations') }}</p>
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

<<<<<<< Updated upstream
    <section class="content-section"><div class="container">
      <PlantPhotoGallery :key="gallery.state.epoch" :groups="galleryGroups" :loading="gallery.state.loading" :error="gallery.state.error" :complete="gallery.state.complete" :has-more="gallery.state.hasMore" @retry="loadPhotos()" @more="loadPhotos(true)" />
    </div></section>

    <section v-if="canReadStaff" class="history-section"><div class="container limitation-grid">
=======
    <section v-if="canReadStaff" class="history-section"><div class="container limitation-grid">
      <article><p class="eyebrow">{{ ct('ASSETS') }}</p><h2>{{ ct('Submitted media') }}</h2><p>{{ ct('The current plant detail response does not include observation asset IDs. No images or attachments have been fabricated.') }}</p></article>
>>>>>>> Stashed changes
      <article><p class="eyebrow">{{ ct('HISTORY') }}</p><h2>{{ ct('Observation history') }}</h2><p>{{ ct('Complete observation history is not included in the plant detail response. No capped-list history is presented as complete history.') }}</p><RouterLink class="primary-link" to="/conservation/observations">{{ ct('Browse loaded observations') }}</RouterLink></article>
    </div></section>
  </main>
</template>

<style scoped>
.plant-detail-page { background: #f8f6ee; color: #405f56; }
.container { width: min(1160px, 88%); margin: 0 auto; }
.plant-hero { padding: 28px 0 36px; background: linear-gradient(135deg,#e1eadb,#f7f3e8); }
.back-link { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 10px 16px; box-sizing: border-box; margin-bottom: 20px; border: 1px solid #a8bfae; border-radius: 12px; background: #ffffff80; color: #315f4e; font-weight: 700; line-height: 1.25; text-decoration: none; }
.back-link:hover { background: #468585; border-color: #468585; color: #fff; }
.back-link:active { background: #356f70; border-color: #356f70; color: #fff; }
.back-icon { width: 20px; height: 20px; flex: none; }
.record-panel h1 { margin: 0; color: #315f4e; font-size: 24px; }
.plant-image { display: block; width: 100%; height: auto; aspect-ratio: 4 / 3; object-fit: contain; border-radius: 24px; background: #dfe9d9; }
.image-panel { margin: 0; min-width: 0; }
.image-panel figcaption { margin-top: 10px; font-size: 13px; color: #50675d; }
.hero-grid > .record-panel { min-width: 0; }
.back-link:focus-visible { outline: 3px solid #315f4e; outline-offset: 4px; }
.hero-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr); align-items: start; gap: 28px; }
.image-placeholder { aspect-ratio: 4 / 3; display: grid; place-items: center; align-content: center; gap: 12px; border-radius: 24px; background: #dfe9d9; color: #587367; }
.image-placeholder span { font-size: 58px; }
.eyebrow { color: #659061; font-size: 11px; font-weight: 800; letter-spacing: .13em; }
.hero-badges { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 22px; }
.hero-badges span { padding: 7px 11px; border-radius: 99px; background: #d6e6d3; color: #35652f; font-size: 11px; font-weight: 800; }
.inline-error, .availability-note { color: #8a5a43; }
<<<<<<< Updated upstream
.location-context { max-width: 65ch; color: #50675d; line-height: 1.6; }
=======
>>>>>>> Stashed changes
.content-section, .latest-section, .history-section { padding: 32px 0; }
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
.limitation-grid { display: grid; grid-template-columns: 1fr; gap: 24px; }
.primary-link { display: inline-block; padding: 11px 17px; border: 0; border-radius: 99px; background: #315f4e; color: #fff; font: inherit; text-decoration: none; cursor: pointer; }
.state-page { min-height: calc(100vh - 76px); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 30px; background: #f4f3e9; color: #50675d; text-align: center; }
.state-page .state-icon { font-size: 48px; }
.state-page a { color: #315f4e; }
@media (max-width: 850px) { .hero-grid, .limitation-grid { grid-template-columns: 1fr; } .observation-summary { grid-template-columns: repeat(2,1fr); } }
@media (max-width: 560px) { .fact-grid, .staff-panel dl, .taxonomy-list, .observation-summary { grid-template-columns: 1fr; } .wide { grid-column: auto; } }
</style>
