<script setup lang="ts">
import { workflowBadgeStyle } from '../utils/workflowBadge'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import NavigationBar from '../components/NavigationBar.vue'
import PlantPhotoGallery from '../components/PlantPhotoGallery.vue'
import { createPlantGallery, groupGallery } from '../services/plantGallery'
import PlantObservationHistory from '../components/PlantObservationHistory.vue'
import PlantRegistrationRecord from '../components/PlantRegistrationRecord.vue'
import { createPlantHistory } from '../services/plantHistory'
import { readPlantDetail, canReadPlantDetail, type PlantDetail } from '../services/plantDetail'
import { formatPlantId } from '../utils/plantId'
import { conservationBadgeStyle } from '../utils/conservationBadge'
import { useConservationText } from '../composables/useConservationText'
import { rawPlantIdFromRoute } from '../services/plantIntegration'

import { api, sessionSnapshot, subscribeSession, type AuthUser } from '../services/auth'

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
const { ct } = useConservationText()
const { t } = useI18n()
const plant = ref<PlantDetail | null>(null)
const isLoading = ref(true)
const loadError = ref('')
const errorStatus = ref(0)
let loadRequest = 0
let disposed = false
let sessionRequest = 0
let refreshWork: Promise<void> | null = null
const refreshError = ref('')
const identity = (value: AuthUser | null) => value ? `${value.id}:${value.role}:${value.status}:${value.mustChangePassword}` : ''
const user = ref<AuthUser | null>(null)
const canReadStaff = computed(() => canReadPlantDetail(user.value) && plant.value?.staff != null)
const gallery = createPlantGallery({ detail: true })
const publicGallery = createPlantGallery({ publicOnly: true })
const isGuest = computed(() => user.value === null)
const visibleGallery = computed(() => canReadStaff.value ? gallery : publicGallery)
const history = createPlantHistory()
const galleryGroups = computed(() => canReadStaff.value
  ? groupGallery(gallery.state.assets).filter(group => group.origin === 'initial_registration')
  : groupGallery(publicGallery.state.assets))
function loadPhotos(append = false) {
  if (!plant.value || sessionSnapshot().pending) return
  if (canReadStaff.value) void gallery.load(plant.value.information.plant_id, true, append)
  else if (isGuest.value) void publicGallery.load(plant.value.information.plant_id, false, append)
}
function loadHistory(append = false) {
  if (!plant.value || !canReadStaff.value || sessionSnapshot().pending) return
  void history.load(plant.value.information.plant_id, append)
}
function retryHistory() {
  if (!plant.value || !canReadStaff.value || sessionSnapshot().pending) return
  void history.retry(plant.value.information.plant_id)
}
function clearRecord() {
  gallery.reset(); publicGallery.reset(); history.reset()
  loadRequest++
  plant.value = null
}
const unsubscribe = subscribeSession((verifiedUser, pending) => {
  if (pending && sessionSnapshot().unavailable && verifiedUser && identity(user.value) === identity(verifiedUser) && canReadPlantDetail(verifiedUser)) {
    sessionRequest++; loadRequest++; refreshWork = null; history.pause()
    refreshError.value = ct('Verify your session to view this plant.')
    return
  }
  if (pending) {
    sessionRequest++; refreshWork = null; clearRecord(); user.value = null
    return
  }
  if (identity(user.value) === identity(verifiedUser) && plant.value) return
  sessionRequest++; refreshWork = null
  clearRecord(); user.value = verifiedUser
  void loadPlant()
})
function verifySession() {
  if (refreshWork) return refreshWork
  const request = ++sessionRequest
  const work = (async () => {
    const existing = plant.value !== null
    if (!existing) isLoading.value = true
    let verified: AuthUser | null
    try {
      verified = (await api<{ user: AuthUser }>('/auth/me')).user
      if (!verified || typeof verified.id !== 'string' || !['Administrator', 'Conservation Officer', 'Botanist', 'Visitor'].includes(verified.role) ||
          !['Active', 'Inactive', 'Suspended'].includes(verified.status) || typeof verified.mustChangePassword !== 'boolean') throw Error('Invalid session response.')
    } catch (error) {
      if (disposed || request !== sessionRequest) return
      if ((error as { status?: number })?.status === 401) verified = null
      else {
        refreshError.value = ct('Verify your session to view this plant.')
        if (!existing) { isLoading.value = false; loadError.value = refreshError.value }
        return
      }
    }
    if (disposed || request !== sessionRequest) return
    if (identity(user.value) !== identity(verified)) {
      clearRecord()
      user.value = verified
      await loadPlant()
      return
    }
    user.value = verified
    await loadPlant(existing)
  })()
  refreshWork = work
  void work.finally(() => { if (refreshWork === work) refreshWork = null })
  return work
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
const habitat = computed(() => canReadStaff.value ? plant.value?.staff?.habitat : isGuest.value ? plant.value?.information.habitat : null)
const badgeKey = (value: string | null | undefined) => (value || '').toLowerCase().replace(/[^a-z]/g, '')

async function loadPlant(background = false) {
  const requestId = ++loadRequest
  if (!background) { gallery.reset(); publicGallery.reset(); history.reset(); plant.value = null }
  loadError.value = ''
  errorStatus.value = 0
  if (!background) isLoading.value = true
  refreshError.value = ''
  const rawId = rawPlantIdFromRoute(route.params.plantId)
  if (!rawId) {
    loadError.value = ct('Invalid plant identifier.')
    errorStatus.value = 400
    isLoading.value = false
    return
  }
  try {
    const detail = await readPlantDetail(rawId, canReadPlantDetail(user.value))
    if (disposed || requestId !== loadRequest) return
    const historyScopeChanged = plant.value?.staff?.status !== detail.staff?.status || Boolean(plant.value?.staff) !== Boolean(detail.staff)
    if (background && historyScopeChanged) history.reset()
    if (JSON.stringify(plant.value) !== JSON.stringify(detail)) plant.value = detail
    if (background) {
      if (canReadStaff.value) {
        if (historyScopeChanged) await history.load(rawId)
        else await history.refresh(rawId)
      }
      if (disposed || requestId !== loadRequest) return
      if (canReadStaff.value || isGuest.value) await visibleGallery.value.refresh(rawId, canReadStaff.value)
      if (disposed || requestId !== loadRequest) return
      if (visibleGallery.value.state.denied) {
        clearRecord(); loadError.value = ct('Plant record unavailable'); isLoading.value = false
      }
    } else {
      if (canReadStaff.value || isGuest.value) loadPhotos()
      if (canReadStaff.value) loadHistory()
    }
  } catch (error) {
    if (requestId !== loadRequest) return
    const status = (error as { status?: number })?.status
    if (background && ![401, 403, 404].includes(status || 0)) { refreshError.value = error instanceof Error ? error.message : ct('Unable to load this plant record.'); return }
    clearRecord()
    isLoading.value = false
    loadError.value = error instanceof Error ? error.message : ct('Unable to load this plant record.')
    errorStatus.value = typeof error === 'object' && error && 'status' in error && typeof error.status === 'number'
      ? error.status : 0
  } finally {
    if (requestId === loadRequest) isLoading.value = false
  }
}

watch(() => route.params.plantId, () => { sessionRequest++; refreshWork = null; clearRecord(); void verifySession() }, { immediate: true, flush: 'sync' })
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
    <p v-if="refreshError" class="availability-note" role="status">{{ refreshError }}</p>
    <section class="plant-hero">
      <div class="container" :class="{ 'staff-hero': canReadStaff || isGuest }">
        <RouterLink :to="backTarget" class="back-link"><svg class="back-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m12 5-7 7 7 7M5 12h14" /></svg><span>{{ ct('Back') }}</span></RouterLink>
        <div class="hero-grid" :class="{ 'visitor-grid': !canReadStaff && !isGuest }">
          <PlantPhotoGallery v-if="canReadStaff || isGuest" :key="`${isGuest}:${visibleGallery.state.epoch}`" registration-only :public-photos="isGuest" :groups="galleryGroups" :loading="visibleGallery.state.loading" :error="visibleGallery.state.error" :complete="visibleGallery.state.complete" :has-more="visibleGallery.state.hasMore" @retry="loadPhotos()" @more="loadPhotos(true)" />
          <div class="record-panel">
            <div class="profile-heading-line">
              <p class="section-label">{{ ct('Plant Information') }}</p>
              <div v-if="canReadStaff && plant.staff" class="profile-badges">
                <span class="status-badge" :style="workflowBadgeStyle(plant.staff.status)" :data-status="badgeKey(plant.staff.status)"><span class="visually-hidden">{{ ct('Plant status') }}: </span>{{ ct(plant.staff.status) }}</span>
                <span v-if="plant.staff.conservation_status" class="conservation-status" :style="conservationBadgeStyle(plant.staff.conservation_status)" :data-status="badgeKey(plant.staff.conservation_status)"><span class="visually-hidden">{{ ct('Conservation status') }}: </span>{{ ct(plant.staff.conservation_status) }}</span>
              </div>
            </div>
            <dl class="plant-identity">
              <div><dt class="visually-hidden">{{ ct('Common name') }}</dt><dd><h1>{{ display(plant.information.common_name) }}</h1></dd></div>
              <div><dt class="visually-hidden">{{ ct('Scientific name') }}</dt><dd class="scientific-name"><em>{{ display(plant.information.scientific_name) }}</em></dd></div>
              <div v-if="!isGuest" class="plant-id"><dt>{{ ct('Plant ID') }}</dt><dd>{{ formatPlantId(plant.information.plant_id) || plant.information.plant_id }}</dd></div>
            </dl>
            <dl class="profile-taxonomy">
              <div><dt><svg class="taxonomy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 4c-8-1-15 2-15 9a6 6 0 0 0 6 6c7 0 10-7 9-15Z" /><path d="M4 21 15 10" /></svg><span>{{ ct('Family') }}</span></dt><dd>{{ display(plant.information.family_name) }}</dd></div>
              <div><dt><svg class="taxonomy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 21v-9M12 15C5 15 3 11 3 6c6 0 9 3 9 9ZM12 11c0-6 3-9 9-9 0 6-3 9-9 9Z" /></svg><span>{{ ct('Genus') }}</span></dt><dd>{{ display(plant.information.genus_name) }}</dd></div>
            </dl>
            <section v-if="habitat" class="profile-habitat" aria-labelledby="plant-habitat-title">
              <h2 id="plant-habitat-title"><svg class="taxonomy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 22v-7M12 2l7 9h-4l6 6H3l6-6H5Z" /></svg><span>{{ t('speciesLabels.habitat') }}</span></h2>
              <p>{{ habitat }}</p>
            </section>
            <hr v-if="habitat" class="profile-divider" />
            <section class="profile-description" aria-labelledby="plant-description-title"><h2 id="plant-description-title">{{ ct('Description') }}</h2><p class="summary">{{ display(plant.information.description) }}</p></section>
          </div>
        </div>
      </div>
    </section>
    <section v-if="canReadStaff && plant.staff" class="content-section"><div class="container">
      <PlantRegistrationRecord :authorized="canReadStaff" :staff="plant.staff" :plant-id="plant.information.plant_id" :observations="history.state.observations" :complete="history.state.complete" :loading="history.state.loading" :error="history.state.error" :has-more="history.state.hasMore" :verified-complete="history.state.verifiedComplete" />
    </div></section>
    <section v-if="canReadStaff" class="history-section"><div class="container">
      <PlantObservationHistory :key="history.state.epoch" :observations="history.state.observations" :loading="history.state.loading" :error="history.state.error" :complete="history.state.complete" :has-more="history.state.hasMore" :refreshing="history.state.refreshing" :retained="history.state.hasSnapshot" @retry="retryHistory()" @more="loadHistory(true)" />
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
.record-panel h1 { margin: 0; color: #234a3c; font-size: clamp(30px, 3.2vw, 48px); font-weight: 600; line-height: 1.12; }
.hero-grid > .record-panel { min-width: 0; }
.back-link:focus-visible { outline: 3px solid #315f4e; outline-offset: 4px; }
.hero-grid.visitor-grid { grid-template-columns: 1fr; }
.plant-hero > .staff-hero { max-width: 1080px; }
.hero-grid { display: grid; grid-template-columns: minmax(0, 0.44fr) minmax(0, 0.56fr); align-items: start; gap: 24px; }
.availability-note { color: #8a5a43; }
.content-section { padding: 24px 0 0; }
.history-section { padding: 24px 0 32px; }
.record-panel, .staff-panel { min-width: 0; padding: clamp(22px, 2.8vw, 36px); border: 1px solid rgba(58, 96, 70, 0.12); border-radius: 26px; background: #fff; box-shadow: 0 12px 36px rgba(37, 75, 58, 0.09); overflow-wrap: anywhere; }
.profile-heading-line { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px 12px; margin-bottom: 14px; }
.section-label { margin: 0; padding: 6px 10px; border-radius: 999px; background: #234a3c; color: #fff; font-size: 10px; font-weight: 700; line-height: 1.4; letter-spacing: 1.2px; text-transform: uppercase; }
.profile-badges { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 6px; margin-left: auto; }
.status-badge, .conservation-status { display: inline-flex; padding: 5px 9px; border-radius: 999px; background: #e8eff2; color: #53727c; font-size: 10px; font-weight: 700; line-height: 1.4; letter-spacing: .5px; text-transform: uppercase; }
.plant-identity { margin: 0; }
.plant-identity dd { margin: 0; }
.plant-identity .scientific-name { margin: 8px 0 18px; color: #7c6955; font-size: 18px; font-style: italic; }
.plant-id { display: flex; align-items: baseline; gap: 10px; margin-bottom: 20px; }
.plant-id dt { color: #63776d; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; }
.plant-id dd { color: #315447; font-size: 14px; font-weight: 600; }
.profile-taxonomy { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; margin: 0 0 20px; }
.profile-taxonomy > div, .profile-habitat { min-width: 0; padding: 16px 18px; border-radius: 12px; background: #f4f6f1; }
.profile-taxonomy dt, .profile-habitat h2 { display: flex; align-items: center; gap: 8px; margin: 0; color: #63776d; font-size: 12px; font-weight: 500; line-height: 1.5; text-transform: uppercase; letter-spacing: 1px; }
.profile-taxonomy dd { margin: 6px 0 0; color: #315447; font-size: 16px; font-weight: 600; }
.taxonomy-icon { width: 18px; height: 18px; flex: 0 0 18px; color: #64816c; }
.profile-habitat { margin-top: 20px; }
.profile-habitat p { margin: 6px 0 0; color: #315447; font-size: 16px; line-height: 1.7; white-space: pre-wrap; }
.profile-divider { margin: 20px 0; border: 0; border-top: 1px solid #dfe7df; }
.profile-description { margin-top: 20px; }
.profile-description h2 { margin: 0 0 8px; color: #315447; font-size: 14px; font-weight: 600; line-height: 1.5; }
.summary { margin: 0; color: #50675d; font-size: 17px; line-height: 1.8; white-space: pre-wrap; }
.staff-panel h2 { margin: 0 0 18px; color: #234a3c; font-size: 22px; font-weight: 600; }
.staff-panel h3 { margin: 18px 0 12px; color: #315447; font-size: 14px; font-weight: 600; }
.approved-location h3 { display: flex; align-items: center; gap: 8px; }
.registration-grid, .location-grid { display: grid; gap: 12px; margin: 0; }
.registration-grid { grid-template-columns: minmax(0, 1fr); }
.location-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.staff-panel dl > div { min-width: 0; padding: 12px 14px; border-radius: 12px; background: #f4f6f1; }
.staff-panel dt { color: #63776d; font-size: 11px; }
.staff-panel dd { margin: 6px 0 0; color: #315447; font-size: 14px; font-weight: 600; }
.latest-section { padding: 24px 0 0; }
.observation-summary-panel { padding: clamp(22px, 2.8vw, 36px); border: 1px solid rgba(58, 96, 70, 0.12); border-radius: 26px; background: #fff; box-shadow: 0 12px 36px rgba(37, 75, 58, 0.09); }
.observation-summary-panel h2 { margin: 0 0 12px; color: #234a3c; font-size: 22px; font-weight: 600; }
.observation-date-line, .submitted-gps > p { color: #63776d; font-size: 12px; }
.observation-summary, .taxonomy-list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 0; }
.observation-summary > div, .taxonomy-list > div { min-width: 0; padding: 12px 14px; border-radius: 12px; background: #f4f6f1; }
.observation-summary dt, .taxonomy-list dt { color: #63776d; font-size: 11px; }
.observation-summary dd, .taxonomy-list dd { margin: 6px 0 0; color: #315447; font-size: 14px; font-weight: 600; white-space: pre-wrap; overflow-wrap: anywhere; }
.taxonomy-list { margin-top: 12px; }
.submitted-gps { margin-top: 22px; padding-top: 18px; border-top: 1px solid #dfe7df; }
.submitted-gps h3 { margin: 0; color: #315447; font-size: 14px; }
.gps-summary { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.primary-link { display: inline-block; padding: 11px 17px; border: 0; border-radius: 99px; background: #315f4e; color: #fff; font: inherit; text-decoration: none; cursor: pointer; }
.state-page { min-height: calc(100vh - 76px); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 30px; background: #f4f3e9; color: #50675d; text-align: center; }
.state-page .state-icon { font-size: 48px; }
.state-page a { color: #315f4e; }
@media (max-width: 850px) { .hero-grid { grid-template-columns: 1fr; } .location-grid, .gps-summary { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 560px) { .location-grid, .gps-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 420px) { .profile-taxonomy, .location-grid, .gps-summary, .observation-summary, .taxonomy-list { grid-template-columns: minmax(0, 1fr); } }
</style>
