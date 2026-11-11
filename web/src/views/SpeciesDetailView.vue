<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import NavigationBar from '../components/NavigationBar.vue'
import PlantRecordCard from '../components/PlantRecordCard.vue'
import type { PlantRecord } from '../data/plantRecords'
import { assetUrlFromId, plantThumbnailImages, webAssetUrl } from '../services/assetImages'
import { mapPlantCardMetadata } from '../services/plantCardMapping'
import { requestPlantApi } from '../services/plantIntegration'
import { formatPlantId } from '../utils/plantId'
import { conservationBadgeStyle } from '../utils/conservationBadge'
import { currentUser, sessionSnapshot, subscribeSession, type AuthUser } from '../services/auth'

interface SpeciesProfile {
  id: string; commonName: string; scientificName: string; genus: string; family: string
  description: string; habitat: string; conservationStatus: string; image: string
}
const route = useRoute()
const { t } = useI18n()
const selectedSpecies = ref<SpeciesProfile | null>(null)
const linkedPlants = ref<Array<PlantRecord & { genus: string }>>([])
const images = ref<string[]>([])
const failedImages = ref<string[]>([])
const isLoading = ref(true)
const loadError = ref('')
const plantsError = ref('')
const plantsLoading = ref(false)
const imagesError = ref('')
const user = ref<AuthUser | null>(null)
const scientific = computed(() => Boolean(user.value && user.value.status === 'Active' && !user.value.mustChangePassword &&
  ['Botanist', 'Conservation Officer'].includes(user.value.role)))
const text = (v: unknown) => typeof v === 'string' ? v.trim() : ''
const object = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
const validId = (v: unknown) => /^(?:[1-9][0-9]*)$/.test(String(v ?? '')) && BigInt(String(v)) <= 2147483647n
const generatedSlug = (v: Record<string, unknown>) => `${text(v.common_name) || text(v.scientific_name)}-${v.species_id}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const displayName = computed(() => selectedSpecies.value?.commonName || selectedSpecies.value?.scientificName || t('species.notFound'))
const selectedImage = ref('')
// The portrait is first; direct references retain API order. This is not saved gallery order.
const imageCandidates = computed(() => [...new Set([selectedSpecies.value?.image || '', ...images.value].filter(Boolean))])
const galleryImages = computed(() => imageCandidates.value.filter(path => !failedImages.value.includes(path)))
const primaryImage = computed(() => galleryImages.value.includes(selectedImage.value) ? selectedImage.value : galleryImages.value[0] || '')
const canNavigate = computed(() => galleryImages.value.length > 1)
const imagePosition = computed(() => ({ current: galleryImages.value.indexOf(primaryImage.value) + 1, total: galleryImages.value.length }))
const previewPlants = computed(() => linkedPlants.value.slice(0, 3))
let generation = 0, verification = 0, disposed = false
const portraitTrigger = ref<HTMLButtonElement | null>(null)
const dialog = ref<HTMLDialogElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
const zoomImage = ref('')
let previousOverflow: string | null = null
function closeZoom() {
  const wasOpen = Boolean(zoomImage.value)
  zoomImage.value = ''
  if (dialog.value?.open) dialog.value.close()
  if (previousOverflow !== null) { document.body.style.overflow = previousOverflow; previousOverflow = null }
  if (wasOpen && portraitTrigger.value?.isConnected) portraitTrigger.value.focus()
}
async function openZoom() {
  if (!primaryImage.value) return
  zoomImage.value = primaryImage.value
  await nextTick()
  if (!zoomImage.value || disposed || !dialog.value) return
  if (!dialog.value.open) dialog.value.showModal()
  if (previousOverflow === null) { previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden' }
  closeButton.value?.focus()
}
function selectImage(path: string) {
  if (!galleryImages.value.includes(path)) return
  selectedImage.value = path
}
function navigateImage(direction: -1 | 1) {
  if (!canNavigate.value) return
  const index = galleryImages.value.indexOf(primaryImage.value)
  selectImage(galleryImages.value[(index + direction + galleryImages.value.length) % galleryImages.value.length]!)
}
function zoomKeydown(event: KeyboardEvent) {
  if (!zoomImage.value || event.altKey || event.ctrlKey || event.metaKey) return
  if (event.key === 'Escape') { event.preventDefault(); closeZoom() }
  else if (canNavigate.value && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault(); event.stopPropagation()
    navigateImage(event.key === 'ArrowLeft' ? -1 : 1)
  }
}
watch(primaryImage, path => {
  if (!zoomImage.value) return
  if (path) zoomImage.value = path
  else closeZoom()
}, { flush: 'sync' })
watch(canNavigate, async available => {
  if (available) return
  const restoreFocus = Boolean(zoomImage.value) || document.activeElement?.classList?.contains('image-nav')
  if (!restoreFocus) return
  await nextTick()
  if (zoomImage.value) closeButton.value?.focus({ preventScroll: true })
  else if (primaryImage.value) portraitTrigger.value?.focus({ preventScroll: true })
})
function mainImageFailed(event: Event) {
  const path = webAssetUrl((event.currentTarget as HTMLImageElement | null)?.getAttribute('src'))
  if (path && imageCandidates.value.includes(path)) imageFailed(path)
}
function imageFailed(path: string) {
  if (failedImages.value.includes(path)) return
  const available = galleryImages.value, index = available.indexOf(path)
  if (path === primaryImage.value) selectedImage.value = available.length > 1 ? available[(index + 1) % available.length]! : ''
  failedImages.value.push(path)
}
function clearPage() {
  generation++
  closeZoom()
  selectedImage.value = ''; selectedSpecies.value = null; linkedPlants.value = []; images.value = []; failedImages.value = []
  loadError.value = ''; plantsError.value = ''; imagesError.value = ''; plantsLoading.value = false
}
async function loadSpecies() {
  clearPage()
  const attempt = generation
  const current = () => !disposed && generation === attempt
  isLoading.value = true
  if (sessionSnapshot().pending) { isLoading.value = false; loadError.value = t('species.detail.verifySession'); return }
  try {
    const slug = typeof route.params.slug === 'string' ? route.params.slug : ''
    let id = validId(slug) ? slug : ''
    // Generated legacy URLs carry an ID, but their full slug must match the returned record.
    const suffix = /-([1-9][0-9]*)$/.exec(slug)?.[1]
    if (!id && suffix && validId(suffix)) id = suffix
    if (!id) {
      const catalog = await requestPlantApi('/api/data/species')
      if (!current()) return
      if (!Array.isArray(catalog.species)) throw Error(t('species.detail.loadFailed'))
      const matches = catalog.species.map(object).filter((row): row is Record<string, unknown> => Boolean(row && validId(row.species_id) && generatedSlug(row) === slug))
      if (matches.length !== 1) throw Error(t('species.detail.unresolvedSlug'))
      id = String(matches[0]!.species_id)
    }
    const result = await requestPlantApi(`/api/data/species/${encodeURIComponent(id)}`)
    if (!current()) return
    const item = object(result.species)
    if (!item || String(item.species_id) !== id || !text(item.scientific_name) || (!validId(slug) && generatedSlug(item) !== slug))
      throw Error(t('species.detail.unresolvedSlug'))
    selectedSpecies.value = {
      id, commonName: text(item.common_name), scientificName: text(item.scientific_name), genus: text(item.genus_name), family: text(item.family_name),
      description: text(item.description), habitat: scientific.value ? text(item.habitat) : '',
      conservationStatus: scientific.value ? text(item.conservation_status) : '',
      image: webAssetUrl(item.image_url) || assetUrlFromId(item.image_asset_id),
    }
    isLoading.value = false
    const profile = selectedSpecies.value
    plantsLoading.value = true
    // Independent failures must not hide an otherwise valid species profile.
    await Promise.all([
      (async () => {
        try {
          const result = await requestPlantApi('/api/data/plants')
          if (!current()) return
          if (!Array.isArray(result.plants)) throw Error()
          linkedPlants.value = result.plants.flatMap(value => {
            const row = object(value)
            if (!row || String(row.species_id) !== id || (row.rbac_status !== undefined && row.rbac_status !== 'Approved')) return []
            const plantId = validId(row.plant_id) ? formatPlantId(String(row.plant_id)) : null
            if (!plantId) return []
            return [{ plantId, speciesId: id, speciesSlug: id, speciesName: profile.scientificName,
              commonName: profile.commonName || profile.scientificName, genus: profile.genus || '—', ...mapPlantCardMetadata(row),
              qr: { code: '', status: '' }, registeredBy: '', registeredAt: '',
              images: plantThumbnailImages(row), observations: [] }]
          })
        } catch { if (current()) plantsError.value = t('species.detail.plantsFailed') }
        finally { if (current()) plantsLoading.value = false }
      })(),
      (async () => {
        try {
          const result = await requestPlantApi(`/api/data/assets?species_id=${id}`)
          if (!current()) return
          if (!Array.isArray(result.assets)) throw Error()
          images.value = [...new Set(result.assets.flatMap(value => {
            const a = object(value), path = a && assetUrlFromId(a.id)
            return a && path && ['image/jpeg', 'image/png'].includes(String(a.content_type)) ? [path] : []
          }))]
        } catch { if (current()) imagesError.value = t('species.detail.imagesFailed') }
      })(),
    ])
  } catch (error) { if (current()) loadError.value = error instanceof Error ? error.message : t('species.detail.loadFailed') }
  finally { if (current()) isLoading.value = false }
}
const unsubscribe = subscribeSession((verifiedUser, pending) => {
  verification++; user.value = pending ? null : verifiedUser
  void loadSpecies()
})
async function verifySession() {
  const attempt = ++verification
  clearPage(); user.value = null; isLoading.value = true
  await currentUser()
  if (disposed || verification !== attempt) return
  user.value = sessionSnapshot().user
  await loadSpecies()
}
watch(() => route.params.slug, verifySession, { immediate: true, flush: 'sync' })
const onVisible = () => { if (document.visibilityState === 'visible') void verifySession() }
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  window.addEventListener('focus', verifySession); document.addEventListener('visibilitychange', onVisible)
  timer = setInterval(verifySession, 60000)
})
onBeforeUnmount(() => {
  disposed = true; verification++; clearPage(); unsubscribe()
  window.removeEventListener('focus', verifySession); document.removeEventListener('visibilitychange', onVisible)
  if (timer) clearInterval(timer)
})
</script>

<template>
  <NavigationBar />
  <main v-if="isLoading" class="not-found" role="status"><p>{{ t('species.detail.loading') }}</p></main>
  <main v-else-if="selectedSpecies" class="detail-page">
    <section class="detail-hero">
      <div class="detail-container">
        <RouterLink to="/species" class="back-link"><svg class="back-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m12 5-7 7 7 7M5 12h14" /></svg><span>{{ t('conservationText.back') }}</span></RouterLink>
        <div class="hero-grid">
          <div class="profile-images">
            <div class="main-image-frame">
              <button v-if="primaryImage" ref="portraitTrigger" type="button" class="species-image-card portrait-trigger" :aria-label="t('species.detail.enlargeImage')" @click="openZoom">
                <img :key="primaryImage" class="plant-image" :src="primaryImage" :alt="t('species.detail.speciesPhoto', { number: galleryImages.indexOf(primaryImage) + 1, name: displayName })" @error="mainImageFailed" />
              </button>
              <div v-else class="plant-placeholder" role="img" :aria-label="t('species.detail.imageUnavailable')">
                <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M51 9C32 10 18 19 15 36c10-8 20-12 30-15-12 6-21 14-27 25" /><path d="M16 37C7 29 7 19 8 12c9 3 16 9 18 17" /></svg>
                <span>{{ t('species.detail.imageUnavailable') }}</span>
              </div>
              <template v-if="canNavigate">
                <button type="button" class="image-nav previous-photo" :aria-label="t('species.detail.previousPhoto')" @click.stop="navigateImage(-1)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m14 6-6 6 6 6" /></svg></button>
                <button type="button" class="image-nav next-photo" :aria-label="t('species.detail.nextPhoto')" @click.stop="navigateImage(1)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m10 6 6 6-6 6" /></svg></button>
                <span class="gallery-counter" role="status" :aria-live="zoomImage ? 'off' : 'polite'" aria-atomic="true"><span aria-hidden="true">{{ t('species.detail.photoPosition', imagePosition) }}</span><span class="visually-hidden">{{ t('species.detail.photoCounter', imagePosition) }}</span></span>
              </template>
            </div>
            <div v-if="galleryImages.length > 1" class="species-thumbnails" role="group" :aria-label="t('species.detail.galleryEyebrow')">
              <button v-for="(path, index) in galleryImages" :key="path" type="button" class="photo-thumbnail" :class="{ 'is-selected': primaryImage === path }" :aria-pressed="primaryImage === path" :aria-label="t('species.detail.viewPhoto', { number: index + 1 })" @click="selectImage(path)">
                <img :src="path" alt="" @error="imageFailed(path)" />
                <span v-if="primaryImage === path" class="visually-hidden">{{ t('species.detail.selectedPhoto') }}</span>
              </button>
            </div>
            <p v-if="imagesError" class="profile-image-error" role="alert">{{ imagesError }}</p>
          </div>
          <div class="hero-copy">
            <div class="profile-heading-line">
              <p class="section-label">{{ t('species.detail.profileEyebrow') }}</p>
              <span v-if="scientific && selectedSpecies.conservationStatus" class="conservation-status" :style="conservationBadgeStyle(selectedSpecies.conservationStatus)">{{ selectedSpecies.conservationStatus }}</span>
            </div>
            <h1>{{ displayName }}</h1>
            <p v-if="selectedSpecies.commonName && selectedSpecies.commonName !== selectedSpecies.scientificName" class="scientific-name">{{ selectedSpecies.scientificName }}</p>
            <dl v-if="selectedSpecies.family || selectedSpecies.genus" class="profile-taxonomy" :class="{ 'single-field': !selectedSpecies.family || !selectedSpecies.genus }">
              <div v-if="selectedSpecies.family">
                <dt><svg class="taxonomy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 4c-8-1-15 2-15 9a6 6 0 0 0 6 6c7 0 10-7 9-15Z" /><path d="M4 21 15 10" /></svg><span>{{ t('speciesLabels.family') }}</span></dt>
                <dd>{{ selectedSpecies.family }}</dd>
              </div>
              <div v-if="selectedSpecies.genus">
                <dt><svg class="taxonomy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 21v-9M12 15C5 15 3 11 3 6c6 0 9 3 9 9ZM12 11c0-6 3-9 9-9 0 6-3 9-9 9Z" /></svg><span>{{ t('speciesLabels.genus') }}</span></dt>
                <dd>{{ selectedSpecies.genus }}</dd>
              </div>
            </dl>
            <section v-if="scientific && selectedSpecies.habitat" class="profile-habitat" aria-labelledby="species-habitat-title">
              <h2 id="species-habitat-title"><svg class="taxonomy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 22v-7M12 2l7 9h-4l6 6H3l6-6H5Z" /></svg><span>{{ t('speciesLabels.habitat') }}</span></h2>
              <p>{{ selectedSpecies.habitat }}</p>
            </section>
            <hr v-if="scientific && selectedSpecies.habitat && selectedSpecies.description" class="profile-divider" />
            <section v-if="selectedSpecies.description" class="profile-description" aria-labelledby="species-description-title">
              <h2 id="species-description-title">{{ t('conservationText.description') }}</h2>
              <p class="summary">{{ selectedSpecies.description }}</p>
            </section>
          </div>
        </div>
      </div>
    </section>
    <section class="individual-plants" aria-labelledby="individual-plants-title">
      <div class="detail-container">
        <div class="section-heading">
          <p class="section-label">{{ t('species.detail.individualEyebrow') }}</p>
          <div class="plants-heading-row">
            <h2 id="individual-plants-title">{{ t('species.detail.linkedTitle') }}</h2>
            <RouterLink v-if="linkedPlants.length" class="view-all-plants" :to="`/species/${selectedSpecies.id}/plants`"><span>{{ t('species.detail.viewAll') }}</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12h14m-6-6 6 6-6 6" /></svg></RouterLink>
          </div>
          <p>{{ t('species.detail.linkedDescription') }}</p>
          <p v-if="!plantsError && !plantsLoading && linkedPlants.length">{{ t('species.detail.loadedRecords', { count: linkedPlants.length }, linkedPlants.length) }}</p>
          <p v-if="!plantsError && !plantsLoading && previewPlants.length < linkedPlants.length">{{ t('species.detail.previewRecords', { count: previewPlants.length, loaded: linkedPlants.length }) }}</p>
        </div>
        <p v-if="plantsLoading" role="status">{{ t('species.detail.loadingRecords') }}</p>
        <p v-else-if="plantsError" role="alert">{{ plantsError }}</p>
        <div v-else-if="linkedPlants.length" class="individual-plant-grid"><PlantRecordCard v-for="plant in previewPlants" :key="plant.plantId" :plant="plant" compact /></div>
        <p v-else class="no-records">{{ t('species.detail.noLoadedRecords') }}</p>
      </div>
    </section>

  </main>
  <main v-else class="not-found">
    <h1>{{ t('species.notFound') }}</h1><p>{{ loadError || t('species.notFoundDescription') }}</p>
    <RouterLink to="/species">{{ t('common.returnToSpecies') }}</RouterLink>
  </main>
  <dialog ref="dialog" class="portrait-dialog" :aria-label="t('species.detail.enlargeImage')" @cancel.prevent="closeZoom" @close="closeZoom" @keydown="zoomKeydown" @click="($event.target === $event.currentTarget) && closeZoom()">
    <div v-if="zoomImage" class="zoom-content" @click.self="closeZoom">
      <div class="zoom-photo-frame" @click.stop>
        <button ref="closeButton" type="button" class="zoom-close" :aria-label="t('common.close')" @click.stop="closeZoom"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
        <img :key="zoomImage" :src="zoomImage" :alt="t('species.detail.speciesPhoto', { number: imagePosition.current, name: displayName })" @error="mainImageFailed" />
        <template v-if="canNavigate">
                <button type="button" class="image-nav previous-photo" :aria-label="t('species.detail.previousPhoto')" @click.stop="navigateImage(-1)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m14 6-6 6 6 6" /></svg></button>
                <button type="button" class="image-nav next-photo" :aria-label="t('species.detail.nextPhoto')" @click.stop="navigateImage(1)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m10 6 6 6-6 6" /></svg></button>
                <span class="gallery-counter" role="status" aria-live="polite" aria-atomic="true"><span aria-hidden="true">{{ t('species.detail.photoPosition', imagePosition) }}</span><span class="visually-hidden">{{ t('species.detail.photoCounter', imagePosition) }}</span></span>
              </template>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.detail-page {
  background: #f8f6ee;
  color: #405f56;
}

.detail-container {
  width: min(1160px, 88%);
  margin: 0 auto;
}

.detail-hero {
  padding: 48px 0;
  background: linear-gradient(135deg, #e1eadb, #f7f3e8);
}

.detail-hero > .detail-container {
  max-width: 1080px;
}

.hero-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.44fr) minmax(0, 0.56fr);
  align-items: start;
  gap: 24px;
}

.plant-placeholder {
  width: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  min-width: 0;
  background: transparent;
  color: #4e7060;
}

.species-image-card {
  width: 100%;
  box-sizing: border-box;
  overflow: hidden;
  border-radius: 22px;
  background: transparent;
}

.profile-images { min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 12px; align-self: start; }
.main-image-frame { position: relative; min-width: 0; width: 100%; aspect-ratio: 4 / 3; flex: none; border-radius: 22px; overflow: hidden; }
.main-image-frame > .species-image-card,
.main-image-frame > .plant-placeholder { position: absolute; inset: 0; width: 100%; height: 100%; }
.species-thumbnails { display: flex; flex: 0 0 auto; gap: 8px; padding: 4px; max-width: 100%; box-sizing: border-box; overflow-x: auto; overscroll-behavior-x: contain; background: transparent; }
.photo-thumbnail { flex: 0 0 64px; width: 64px; height: 52px; padding: 3px; border: 2px solid transparent; border-radius: 8px; background: transparent; cursor: pointer; }
.photo-thumbnail img { width: 100%; height: 100%; display: block; object-fit: cover; border-radius: 4px; }
.photo-thumbnail.is-selected { border-color: #234a3c; }
.image-nav { position: absolute; top: 50%; z-index: 1; display: grid; place-items: center; width: 44px; height: 44px; padding: 0; transform: translateY(-50%); border: 1px solid rgb(255 255 255 / 45%); border-radius: 50%; background: rgb(23 63 52 / 84%); color: #fff; cursor: pointer; box-shadow: 0 2px 8px rgb(0 0 0 / 16%); transition: background-color 120ms ease; }
.image-nav svg { display: block; width: 20px; height: 20px; pointer-events: none; }
.previous-photo { left: 10px; }
.next-photo { right: 10px; }
.image-nav:hover { background: #173f34; }
.image-nav:focus-visible { outline: 3px solid #fff; outline-offset: 2px; box-shadow: 0 0 0 5px #173f34; }
.gallery-counter { position: absolute; right: 12px; bottom: 12px; z-index: 1; padding: 5px 9px; border-radius: 999px; background: rgb(23 63 52 / 84%); color: #fff; font-size: 12px; line-height: 1.4; pointer-events: none; }
.plant-image, .zoom-photo-frame img { animation: photo-reveal 120ms ease-out; }
@keyframes photo-reveal { from { opacity: .75; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .plant-image, .zoom-photo-frame img { animation: none; } .image-nav { transition: none; } }
.photo-thumbnail:focus-visible { outline: 2px solid #234a3c; outline-offset: 2px; }
.profile-image-error { margin: 0; padding: 12px; color: #735123; font-size: 13px; line-height: 1.5; }
.visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

.plant-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.plant-placeholder svg {
  width: 82px;
  fill: none;
  stroke: #537b5d;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
}

.plant-placeholder span {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1.5px;
  text-transform: uppercase;
}

.conservation-status {
  display: inline-flex;
  padding: 7px 13px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.hero-copy h1 {
  margin: 0;
  color: #234a3c;
  font-size: clamp(30px, 3.2vw, 48px);
  font-weight: 600;
  line-height: 1.12;
}

.scientific-name {
  margin: 8px 0 18px;
  color: #7c6955;
  font-size: 18px;
  font-style: italic;
}

.summary {
  margin: 0;
  color: #50675d;
  font-size: 17px;
  line-height: 1.8;
}

.section-label {
  margin: 0 0 12px;
  color: #50a078;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 2.5px;
}

.section-heading {
  max-width: none;
  margin-bottom: 34px;
}

.section-heading h2 {
  margin: 0;
  color: #234a3c;
  font-size: clamp(30px, 4vw, 42px);
  line-height: 1.15;
}

.section-heading > p:last-child {
  margin: 14px 0 0;
  color: #63776d;
  font-size: 14px;
  line-height: 1.75;
}

.individual-plants {
  padding: 90px 0;
  background: #e8efe3;
}

.individual-plant-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
}

.no-records {
  padding: 30px;
  border: 1px dashed #aebfad;
  border-radius: 16px;
  text-align: center;
}
.plants-heading-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px 24px; }
.plants-heading-row h2 { min-width: 0; overflow-wrap: anywhere; }
.section-heading > p { max-width: 720px; }
.view-all-plants { display: inline-flex; align-items: center; justify-content: center; gap: 9px; flex: 0 1 auto; max-width: 100%; min-height: 44px; box-sizing: border-box; padding: 12px 18px; border: 1px solid #a7c4b0; border-radius: 12px; background: #f8faf5; color: #315b49; font-size: 14px; font-weight: 600; line-height: 1.25; text-decoration: none; transition: background-color 180ms ease, border-color 180ms ease, color 180ms ease, transform 180ms ease; }
.view-all-plants span { min-width: 0; overflow-wrap: anywhere; }
.view-all-plants svg { width: 18px; height: 18px; flex: 0 0 18px; }
.view-all-plants:hover { border-color: #315b49; background: #315b49; color: #fff; }
.view-all-plants:active { background: #234a3c; transform: translateY(1px); }
.view-all-plants:focus-visible { outline: 3px solid #315b49; outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) { .view-all-plants { transition: none; } .view-all-plants:active { transform: none; } }

.not-found a {
  padding: 12px 20px;
  border-radius: 999px;
  background: #fff4d8;
  color: #315b49;
  font-size: 14px;
  font-weight: 700;
  text-decoration: none;
}

.not-found {
  min-height: calc(100vh - 76px);
  padding: 60px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #f4f3e9;
  color: #50675d;
  text-align: center;
}

.not-found span {
  font-size: 50px;
}

.not-found h1 {
  margin: 16px 0 8px;
  color: #234a3c;
}

.not-found p {
  margin: 0 0 24px;
}

@media (max-width: 899px) {
  .hero-grid {
    grid-template-columns: 1fr;
  }

}

@media (max-width: 850px) {

  .individual-plant-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 620px) {
  .detail-container {
    width: 92%;
  }

  .detail-hero,
  .individual-plants {
    padding: 38px 0;
  }

.conservation-status {
    padding: 5px 9px;
    font-size: 9px;
  }

  .scientific-name {
    margin: 8px 0 14px;
    font-size: 17px;
  }

  .summary {
    font-size: 15px;
    line-height: 1.6;
  }

.section-heading {
    margin-bottom: 22px;
  }

  .section-heading h2 {
    font-size: 28px;
  }

  .section-label {
    margin-bottom: 8px;
    font-size: 10px;
    letter-spacing: 1.7px;
  }

  .individual-plant-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .plants-heading-row { flex-direction: column; align-items: flex-start; }
  .view-all-plants { align-self: flex-start; }

.back-arrow {
    font-size: 14px;
  }

  :deep(.plant-record-card) {
    display: flex;
    flex-direction: column;
    border-radius: 13px;
    box-shadow: 0 5px 16px rgba(37, 75, 58, 0.07);
  }

  :deep(.record-image) {
    height: 120px;
  }

  :deep(.record-placeholder) {
    font-size: 34px;
  }

  :deep(.record-image > span) {
    left: 7px;
    bottom: 7px;
    padding: 4px 6px;
    font-size: 8px;
  }

  :deep(.record-copy) {
    min-width: 0;
    padding: 10px;
    display: flex;
    flex: 1;
    flex-direction: column;
  }

  :deep(.record-copy h3) {
    font-size: 16px;
    line-height: 1.15;
  }

  :deep(.record-common-name) {
    margin: 3px 0 1px;
    font-size: 11px;
    line-height: 1.3;
  }

  :deep(.record-species) {
    margin-bottom: 9px;
    overflow-wrap: anywhere;
    font-size: 10px;
    line-height: 1.3;
  }

  :deep(.record-copy dl) {
    margin-bottom: 12px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 7px 5px;
  }

  :deep(.record-copy dt) {
    font-size: 7px;
    letter-spacing: 0.35px;
  }

  :deep(.record-copy dd) {
    margin-top: 2px;
    overflow-wrap: anywhere;
    font-size: 9px;
    line-height: 1.25;
  }

  :deep(.learn-more) {
    width: min(100%, 118px);
    height: 30px;
    margin-top: auto;
  }

  :deep(.learn-more .circle) {
    width: 30px;
    height: 30px;
  }

  :deep(.learn-more .button-arrow) {
    left: 7px;
    width: 12px;
  }

  :deep(.learn-more .button-arrow::before) {
    top: -3px;
    width: 6px;
    height: 6px;
    border-width: 1.5px;
  }

  :deep(.learn-more .button-text) {
    padding: 5px 4px 5px 24px;
    font-size: 8px;
    line-height: 20px;
  }
}

@media (max-width: 360px) {
  .individual-plant-grid {
    gap: 8px;
  }

  :deep(.record-image) {
    height: 110px;
  }

  :deep(.record-copy) {
    padding: 8px;
  }

  :deep(.learn-more) {
    width: min(100%, 108px);
    height: 29px;
  }

  :deep(.learn-more .circle) {
    width: 29px;
    height: 29px;
  }

  :deep(.learn-more .button-text) {
    font-size: 8px;
  }
}

.back-link { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 10px 16px; box-sizing: border-box; margin-bottom: 20px; border: 1px solid #a8bfae; border-radius: 12px; background: #ffffff80; color: #315f4e; font-weight: 700; line-height: 1.25; text-decoration: none; }
.back-link:hover { background: #468585; border-color: #468585; color: #fff; }
.back-link:active { background: #356f70; border-color: #356f70; color: #fff; }
.back-icon { width: 20px; height: 20px; flex: none; }
.back-link:focus-visible { outline: 3px solid #315f4e; outline-offset: 4px; }

.hero-copy {
  min-width: 0;
  align-self: start;
  padding: clamp(22px, 2.8vw, 36px);
  border: 1px solid rgba(58, 96, 70, 0.12);
  border-radius: 26px;
  background: #fff;
  box-shadow: 0 12px 36px rgba(37, 75, 58, 0.09);
  overflow-wrap: anywhere;
}
.portrait-trigger { position: relative; padding: 0; border: 0; cursor: zoom-in; display: block; }
.portrait-trigger:focus-visible, .zoom-close:focus-visible { outline: 3px solid #315f4e; outline-offset: 4px; }
.portrait-trigger:focus-visible { outline-offset: -4px; }
.profile-heading-line { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px 12px; margin-bottom: 14px; }
.profile-heading-line .section-label { margin: 0; padding: 6px 10px; border-radius: 999px; background: #234a3c; color: #fff; font-size: 10px; line-height: 1.4; letter-spacing: 1.2px; text-transform: uppercase; }
.profile-heading-line .conservation-status { padding: 5px 9px; font-size: 10px; letter-spacing: 0.5px; }
.profile-taxonomy { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; margin: 0 0 20px; }
.profile-taxonomy.single-field { grid-template-columns: minmax(0, 1fr); }
.profile-taxonomy > div { min-width: 0; padding: 16px 18px; border-radius: 12px; background: #f4f6f1; }
.profile-taxonomy dt { display: flex; align-items: center; gap: 8px; color: #63776d; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; }
.profile-taxonomy dd { margin: 6px 0 0; color: #315447; font-size: 16px; font-weight: 600; }
.taxonomy-icon { width: 18px; height: 18px; flex: 0 0 18px; color: #64816c; }
.profile-habitat { min-width: 0; margin-top: 20px; padding: 16px 18px; border-radius: 12px; background: #f4f6f1; }
.profile-habitat h2 { display: flex; align-items: center; gap: 8px; margin: 0; color: #63776d; font-size: 12px; font-weight: 500; line-height: 1.5; text-transform: uppercase; letter-spacing: 1px; }
.profile-habitat p { margin: 6px 0 0; color: #315447; font-size: 16px; line-height: 1.7; }
.profile-divider { margin: 20px 0; border: 0; border-top: 1px solid #dfe7df; }
.profile-description { margin-top: 20px; }
.profile-description h2 { margin: 0 0 8px; color: #315447; font-size: 14px; font-weight: 600; line-height: 1.5; }
@media (max-width: 420px) {
  .profile-taxonomy { grid-template-columns: minmax(0, 1fr); gap: 16px; }
  .profile-taxonomy > div, .profile-habitat { padding: 14px 16px; }
}
.portrait-dialog { position: fixed; inset: 0; margin: 0; padding: 0; border: 0; border-radius: 0; width: 100%; max-width: none; height: 100dvh; max-height: none; box-sizing: border-box; background: transparent; box-shadow: none; overflow: hidden; }
.portrait-dialog::backdrop { background: rgb(8 24 17 / 85%); }
.zoom-content { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
.zoom-photo-frame { position: relative; flex: 0 0 auto; width: fit-content; line-height: 0; }
/* Natural image dimensions determine the frame. Reserve space for controls on every side. */
.zoom-content img { display: block; max-width: calc(100vw - 128px); max-height: calc(100dvh - 128px); width: auto; height: auto; object-fit: contain; border-radius: 10px; }
.zoom-close { position: absolute; top: -12px; right: -12px; z-index: 2; display: grid; place-items: center; width: 44px; height: 44px; padding: 0; border: 1px solid rgb(255 255 255 / 45%); border-radius: 50%; background: rgb(23 63 52 / 84%); color: #fff; cursor: pointer; }
.zoom-close svg { display: block; width: 22px; height: 22px; pointer-events: none; }
.zoom-close:hover { background: #173f34; }
.zoom-close:focus-visible { outline: 3px solid #fff; outline-offset: 2px; box-shadow: 0 0 0 5px #173f34; }
.zoom-photo-frame .previous-photo { left: -52px; }
.zoom-photo-frame .next-photo { right: -52px; }
.zoom-photo-frame .gallery-counter { top: calc(100% + 12px); bottom: auto; right: auto; left: 50%; transform: translateX(-50%); padding: 0; background: transparent; white-space: nowrap; }
</style>
