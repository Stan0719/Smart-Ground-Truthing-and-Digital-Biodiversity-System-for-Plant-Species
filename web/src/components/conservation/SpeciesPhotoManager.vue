<script setup lang="ts">
import { computed, nextTick, onMounted, onScopeDispose, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { assetUrlFromId } from '../../services/assetImages'
import { sessionSnapshot, subscribeSession } from '../../services/auth'
import {
  speciesPhotoWritesAvailable, reconcileSpeciesPhotoDraft, canManageSpeciesPhotos, createSpeciesGalleryDraft,
  mapManagedSpecies, removeSpeciesPhoto, requestSpeciesApi, validateSpeciesPhoto,
  persistSpeciesPhotoBatch, readSpeciesGallery, type SpeciesPhotoUpload, type ManagedSpecies, type SpeciesGalleryDraft, type SpeciesGallerySnapshot,
} from '../../services/speciesManagement'

const props = defineProps<{ species: ManagedSpecies | null; embedded?: boolean; busy?: boolean }>()
const emit = defineEmits<{ close: []; retry: [] }>()
const { t, locale } = useI18n()
const pt = (key: string, params: Record<string, string | number> = {}) =>
  t(`conservationPages.species.photos.${key}`, params)
const uid = useId()
const dialog = ref<HTMLDialogElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const expanded = ref(false)
const sourceFilter = ref<'all' | 'reference' | 'plant'>('all')
const libraryCursor = ref<string | null>(null)
const nextCursor = ref<string | null>(null)
const queuePrimary = ref<string | null>(null)
const dragging = ref<string | null>(null)
const dropTarget = ref<string | null>(null)
const photoOrder = ref<string[]>([])
const pointerId = ref<number | null>(null)
const announcement = ref('')
const portrait = ref('')
const images = ref<{ assetId: string; url: string; source?: 'reference' | 'plant' }[]>([])
const failedImages = ref<Set<string>>(new Set())
const loading = ref(false)
const readErrors = ref<string[]>([])
const fileErrors = ref<{ id: string; name: string; key: string }[]>([])
const selecting = ref(false)
const writesAvailable = ref(false)
const saving = ref(false)
const saveError = ref<'partial' | 'conflict' | null>(null)
const conflictSnapshot = ref<SpeciesGallerySnapshot | null>(null)
const conflictReadFailed = ref(false)
let lastSpeciesId = ''
const queue = ref<SpeciesPhotoUpload[]>([])
const canonical = ref<SpeciesGallerySnapshot | null>(null)
const draft = ref<SpeciesGalleryDraft | null>(null)
const initialSession = sessionSnapshot()
const owner = initialSession.user?.id
let saveBaseline: SpeciesGallerySnapshot | null = null
let generation = 0
let readRequest = 0
let libraryRequest = 0
let fileId = 0
let closed = false
let disposed = false
let opener: HTMLElement | null = null
const authorized = () => {
  const session = sessionSnapshot()
  return !closed && !disposed && session.user?.id === owner && canManageSpeciesPhotos(session.user, session.pending)
}
const mainImage = computed(() => {
  const queued = queue.value.find(item => item.id === queuePrimary.value)
  if (queued && !failedImages.value.has(queued.url)) return queued.url
  const proposed = draft.value?.primaryAssetId
  const eligiblePrimary = canonical.value?.images.find(image => image.assetId === proposed && image.eligible)
  const path = proposed && eligiblePrimary ? images.value.find(image => image.assetId === proposed)?.url || assetUrlFromId(eligiblePrimary.assetId) : portrait.value
  return path && !failedImages.value.has(path) ? path : ''
})
const visibleImages = computed(() => draft.value
  ? [...draft.value.orderedAssetIds.flatMap(id => images.value.filter(image => image.assetId === id)), ...images.value.filter(image => image.source === 'plant')]
  : images.value)
const displayedImages = computed(() => visibleImages.value.slice(0, expanded.value ? 16 : 4))
const dirty = computed(() => canonical.value && draft.value
  ? JSON.stringify(draft.value) !== JSON.stringify(createSpeciesGalleryDraft(canonical.value)) ||
    JSON.stringify(photoOrder.value) !== JSON.stringify([
      ...createSpeciesGalleryDraft(canonical.value).orderedAssetIds.filter(id => !queue.value.some(file => file.assetId === id)).map(id => `saved:${id}`),
      ...queue.value.filter(file => !file.removed).map(file => `queued:${file.id}`),
    ]) : false)
const arrangementAvailable = computed(() => Boolean(canonical.value && draft.value))
interface PhotoCard { key: string; id: string; url: string; name: string; queued: boolean; eligible: boolean; item?: SpeciesPhotoUpload }
const photoCards = computed(() => photoOrder.value.flatMap<PhotoCard>(key => {
  if (key.startsWith('queued:')) {
    const item = queue.value.find(file => `queued:${file.id}` === key && !file.removed)
    return item ? [{ key, id: item.id, url: item.url, name: item.file.name, queued: true, eligible: true, item }] : []
  }
  const image = canonical.value?.images.find(image => `saved:${image.assetId}` === key && draft.value?.orderedAssetIds.includes(image.assetId))
  return image && !queue.value.some(file => file.assetId === image.assetId) ? [{ key, id: image.assetId, url: image.url, name: image.assetId, queued: false, eligible: image.eligible, item: undefined }] : []
}))
const firstEligible = computed(() => photoCards.value.find(card => card.eligible)?.key || null)
const editableCards = computed(() => photoCards.value.filter(card => card.eligible))
const canReorder = (key: string) => authorized() && !props.busy && !saving.value && editableCards.value.some(card => card.key === key)
function syncPrimary() {
  const first = photoCards.value.find(card => card.eligible)
  queuePrimary.value = first?.queued ? first.id : null
  if (draft.value) draft.value = { ...draft.value, primaryAssetId: first && !first.queued ? first.id : null,
    orderedAssetIds: photoOrder.value.filter(key => key.startsWith('saved:')).map(key => key.slice(6)).filter(id => draft.value!.orderedAssetIds.includes(id)) }
}
function reorderPhoto(key: string, target: string) {
  if (!canReorder(key) || !canReorder(target) || key === target) return
  const keys = [...photoOrder.value], from = keys.indexOf(key), to = keys.indexOf(target)
  if (from < 0 || to < 0) return
  keys.splice(from, 1); keys.splice(to, 0, key); photoOrder.value = keys
  queue.value = [...queue.value].sort((a, b) => keys.indexOf(`queued:${a.id}`) - keys.indexOf(`queued:${b.id}`))
  syncPrimary(); announcement.value = pt('orderChanged')
}
function keyboardMove(event: KeyboardEvent, key: string) {
  if (!event.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
  event.preventDefault()
  const cards = editableCards.value, index = cards.findIndex(card => card.key === key)
  const target = cards[index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1)]
  if (target) reorderPhoto(key, target.key)
}
function endDrag() { dragging.value = null; dropTarget.value = null; pointerId.value = null }
function pointerStart(event: PointerEvent, key: string) {
  if (event.pointerType === 'mouse' || !canReorder(key) || (event.target as HTMLElement).closest('button, select, label')) return
  pointerId.value = event.pointerId; dragging.value = key; dropTarget.value = key
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function pointerMove(event: PointerEvent) {
  if (pointerId.value !== event.pointerId || !dragging.value) return
  event.preventDefault()
  const key = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-photo-key]')?.dataset.photoKey
  dropTarget.value = key && canReorder(key) ? key : null
}
function pointerEnd(event: PointerEvent) {
  if (pointerId.value !== event.pointerId) return
  if (dropTarget.value && dragging.value) reorderPhoto(dragging.value, dropTarget.value)
  endDrag()
}
function pointerCancel(event: PointerEvent) {
  // Native mouse drag emits pointercancel too; only cancel our captured touch/pen drag.
  if (pointerId.value === event.pointerId) endDrag()
}
const sizeLabel = (size: number) => `${new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }).format(size / 1024)} KiB`

function clearQueue() {
  for (const item of queue.value) URL.revokeObjectURL(item.url)
  queue.value = []
  queuePrimary.value = null
  photoOrder.value = []
  endDrag()
  fileErrors.value = []
  if (input.value) input.value.value = ''
}
function reset() {
  generation++
  clearQueue()
  selecting.value = false
  draft.value = null
  canonical.value = null
  images.value = []
  portrait.value = ''
  failedImages.value = new Set()
  readErrors.value = []
  writesAvailable.value = false
  saveError.value = null
  conflictSnapshot.value = null
  conflictReadFailed.value = false
  expanded.value = false
  nextCursor.value = null
  libraryCursor.value = null
  saveBaseline = null
}
function closeManager() {
  if (closed) return
  closed = true
  reset()
  if (!props.embedded) dialog.value?.close()
  emit('close')
}
function failImage(path: string) {
  failedImages.value = new Set([...failedImages.value, path])
}
function removeQueued(id: string) {
  const item = queue.value.find(entry => entry.id === id)
  if (!authorized() || props.busy || saving.value) return
  if (item?.assetId) {
    item.removed = true
    photoOrder.value = photoOrder.value.filter(key => key !== `queued:${id}`)
    syncPrimary()
    void nextTick(() => input.value?.focus())
    return
  }
  if (item) {
    URL.revokeObjectURL(item.url)
    failedImages.value = new Set([...failedImages.value].filter(path => path !== item.url))
  }
  queue.value = queue.value.filter(entry => entry.id !== id)
  photoOrder.value = photoOrder.value.filter(key => key !== `queued:${id}`)
  syncPrimary()
  void nextTick(() => input.value?.focus())
}
async function selectFiles(event: Event) {
  const field = event.target as HTMLInputElement
  const files = Array.from(field.files || [])
  field.value = '' // Allow selecting the same file again, including after an error.
  if (!authorized() || selecting.value || props.busy || saving.value) return
  const attempt = generation
  selecting.value = true
  fileErrors.value = []
  try {
    for (const file of files) {
      const id = `${uid}-file-${++fileId}`
      const invalid = await validateSpeciesPhoto(file)
      if (attempt !== generation || !authorized()) return
      if (invalid) { fileErrors.value.push({ id, name: file.name, key: invalid }); continue }
      try {
        queue.value.push({ id, clientKey: crypto.randomUUID(), file, url: URL.createObjectURL(file), status: 'queued' })
        photoOrder.value.push(`queued:${id}`)
        syncPrimary()
      }
      catch { fileErrors.value.push({ id, name: file.name, key: 'previewFailed' }) }
    }
  } finally { if (attempt === generation) selecting.value = false }
}
async function loadImages() {
  if (!authorized()) return
  const attempt = generation
  const request = ++readRequest
  const current = () => attempt === generation && request === readRequest && authorized()
  const speciesId = props.species?.id
  loading.value = true
  readErrors.value = []
  failedImages.value = new Set([...failedImages.value].filter(path => path.startsWith('blob:')))
  // Public authorized reads only. No unregistered management endpoint is called.
  await Promise.all([
    (async () => {
      try {
        const capability = await requestSpeciesApi('/api/species/photos/capabilities')
        if (!current()) return
        writesAvailable.value = speciesPhotoWritesAvailable(capability)
        if (!speciesId || capability.galleryAvailable !== true) return
        const snapshot = await readSpeciesGallery(speciesId)
        if (current() && !dirty.value) initializeDraft(snapshot)
      } catch { if (current()) writesAvailable.value = false }
    })(),
    (async () => {
      if (!speciesId) return
      try {
        const result = await requestSpeciesApi(`/api/species/${encodeURIComponent(speciesId)}`)
        if (!current()) return
        const record = mapManagedSpecies(result.species)
        if (!record || record.id !== speciesId) throw Error()
        portrait.value = record.portraitUrl
      } catch { if (current()) readErrors.value.push('portraitFailed') }
    })(),
    (async () => {
      if (!speciesId) return
      try {
        const result = await requestSpeciesApi(`/api/data/assets?species_id=${encodeURIComponent(speciesId)}`)
        if (!current()) return
        if (!Array.isArray(result.assets)) throw Error()
        const seen = new Set<string>()
        images.value = result.assets.flatMap(value => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return []
          const asset = value as Record<string, unknown>
          const path = assetUrlFromId(asset.id)
          if (!path || !['image/jpeg', 'image/png'].includes(String(asset.content_type)) || seen.has(path)) return []
          seen.add(path)
          return [{ assetId: String(asset.id), url: path }]
        })
      } catch { if (current()) readErrors.value.push('galleryFailed') }
    })(),
  ])
  if (current()) loading.value = false
}
// Future canonical management GET data is the only source of a revision/draft.
// These local operations never perform network writes; public lists cannot initialize them.
function initializeDraft(snapshot: SpeciesGallerySnapshot) {
  if (String(snapshot.speciesId) !== props.species?.id || !authorized()) return
  canonical.value = snapshot
  draft.value = createSpeciesGalleryDraft(snapshot)
  photoOrder.value = [...draft.value.orderedAssetIds.filter(id => !queue.value.some(file => file.assetId === id)).map(id => `saved:${id}`), ...queue.value.filter(file => !file.removed).map(file => `queued:${file.id}`)]
  syncPrimary()
}
// Compatibility helpers share the grid's one order; there is no independent main choice.
function setMain(id: string) { const first = editableCards.value[0]; if (first) reorderPhoto(`saved:${id}`, first.key) }
function setQueuedMain(id: string) { const first = editableCards.value[0]; if (first) reorderPhoto(`queued:${id}`, first.key) }
function move(id: string, direction: -1 | 1) { moveCard(`saved:${id}`, direction) }
function moveQueued(id: string, direction: -1 | 1) { moveCard(`queued:${id}`, direction) }
function moveCard(key: string, direction: -1 | 1) {
  const cards = editableCards.value, index = cards.findIndex(card => card.key === key), target = cards[index + direction]
  if (index >= 0 && target) reorderPhoto(key, target.key)
}
function stageRemoval(id: string) {
  if (props.busy || saving.value || !authorized() || !draft.value) return
  draft.value = removeSpeciesPhoto(draft.value, id)
  photoOrder.value = photoOrder.value.filter(key => key !== `saved:${id}`)
  syncPrimary()
  void nextTick(() => input.value?.focus())
}
function startDrag(event: DragEvent, id: string, queued: boolean) {
  const key = `${queued ? 'queued' : 'saved'}:${id}`
  if (!canReorder(key) || (event.target as HTMLElement | null)?.closest?.('button, select, label')) { event.preventDefault?.(); return }
  dragging.value = key
  event.dataTransfer?.setData('text/plain', key)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
function dropImage(id: string, queued: boolean) {
  if (dragging.value) reorderPhoto(dragging.value, `${queued ? 'queued' : 'saved'}:${id}`)
  endDrag()
}
async function loadLibrary(cursor: string | null) {
  if (!props.species || !authorized()) return
  const attempt = generation
  const request = ++libraryRequest
  loading.value = true
  try {
    const page = await requestSpeciesApi(`/api/species/${encodeURIComponent(props.species.id)}/photo-library?source=${sourceFilter.value}&limit=16${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
    if (attempt !== generation || request !== libraryRequest || !authorized()) return
    if (!Array.isArray(page.images)) throw Error()
    images.value = page.images.flatMap(value => {
      if (!value || typeof value !== 'object') return []
      const row = value as Record<string, unknown>, url = assetUrlFromId(row.assetId)
      return url && ['reference', 'plant'].includes(String(row.source)) ? [{ assetId: String(row.assetId), url, source: row.source as 'reference' | 'plant' }] : []
    })
    libraryCursor.value = cursor
    nextCursor.value = typeof (page.page as { nextCursor?: unknown })?.nextCursor === 'string' ? (page.page as { nextCursor: string }).nextCursor : null
  } catch { if (attempt === generation && request === libraryRequest && authorized()) { readErrors.value = ['libraryUnavailable']; nextCursor.value = null } }
  finally { if (attempt === generation && request === libraryRequest) loading.value = false }
}
watch(expanded, value => { if (value) void loadLibrary(null) })
async function refreshConflict() {
  if (!authorized()) return
  const attempt = generation
  try {
    const latest = await readSpeciesGallery(lastSpeciesId || props.species?.id || '')
    if (attempt !== generation || !authorized()) return
    conflictSnapshot.value = latest; conflictReadFailed.value = false
  } catch { if (attempt === generation && authorized()) conflictReadFailed.value = true }
}
function reconcileConflict(keepDraft: boolean) {
  const latest = conflictSnapshot.value
  if (!latest || props.busy || saving.value || !authorized()) return
  draft.value = reconcileSpeciesPhotoDraft(latest, draft.value, queue.value, keepDraft)
  canonical.value = latest; saveBaseline = latest
  const allowed = [...draft.value.orderedAssetIds.map(id => `saved:${id}`), ...queue.value.filter(file => !file.removed).map(file => `queued:${file.id}`)]
  photoOrder.value = keepDraft ? [...photoOrder.value.filter(key => allowed.includes(key)), ...allowed.filter(key => !photoOrder.value.includes(key))] : allowed
  syncPrimary()
  conflictSnapshot.value = null; conflictReadFailed.value = false; saveError.value = null
  announcement.value = pt('reconciled')
}
const unavailableReferences = computed(() => canonical.value?.images.filter(image => !image.eligible && draft.value?.orderedAssetIds.includes(image.assetId)) || [])
function stageUnavailableRemoval() {
  if (saving.value || !authorized()) return
  for (const image of unavailableReferences.value) stageRemoval(image.assetId)
}
async function commitPhotos(speciesId: string) {
  if (saving.value) return { complete: false, deferred: false }
  if (!queue.value.length && !dirty.value) return { complete: true, deferred: false }
  if (!writesAvailable.value || !authorized()) return { complete: false, deferred: true }
  if (conflictSnapshot.value || conflictReadFailed.value) return { complete: false, deferred: false, conflict: true }
  const attempt = generation
  const current = () => attempt === generation && authorized()
  lastSpeciesId = speciesId
  saving.value = true; saveError.value = null
  try {
    saveBaseline ||= canonical.value || await readSpeciesGallery(speciesId)
    syncPrimary()
    const order = photoCards.value.map(card => card.queued ? { queueId: card.id } : { assetId: card.id })
    const result = await persistSpeciesPhotoBatch(speciesId, saveBaseline, queue.value, queuePrimary.value, draft.value, current, order)
    if (!current()) return { complete: false, deferred: false }
    if (!result.complete) { saveError.value = 'partial'; return { complete: false, deferred: false } }
    clearQueue(); saveBaseline = result.snapshot; canonical.value = result.snapshot
    draft.value = createSpeciesGalleryDraft(result.snapshot)
    photoOrder.value = draft.value.orderedAssetIds.map(id => `saved:${id}`)
    syncPrimary()
    await loadImages()
    return { complete: true, deferred: false }
  } catch (error) {
    if (!current()) return { complete: false, deferred: false }
    const conflict = typeof error === 'object' && error !== null && 'status' in error && error.status === 409
    if (typeof error === 'object' && error !== null && 'status' in error && error.status === 503) writesAvailable.value = false
    saveError.value = conflict ? 'conflict' : 'partial'
    if (conflict) await refreshConflict()
    return { complete: false, deferred: false, conflict }
  } finally { saving.value = false }
}

// Read-only validation bridge for the shared species form; never uploads or edits drafts.
function validationState() { return { invalid: fileErrors.value.length > 0, pending: selecting.value } }
function discardRejectedFiles() {
  fileErrors.value = []
  input.value?.focus({ preventScroll: true })
}
defineExpose({ commitPhotos, validationState })
const unsubscribe = subscribeSession(() => { if (!authorized()) closeManager() })
watch(() => props.species?.id, () => { reset(); void loadImages() }, { immediate: true, flush: 'sync' })
onMounted(async () => {
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  if (!authorized()) { closeManager(); return }
  if (!props.embedded) dialog.value?.showModal() // Native top-layer dialog blocks background interaction and traps focus.
  await nextTick()
  if (!closed && !props.embedded) closeButton.value?.focus()
})
onScopeDispose(() => {
  disposed = true
  closed = true // A delayed native close event must not dismiss a newer manager.
  unsubscribe()
  reset()
  if (!props.embedded) dialog.value?.close()
  if (!props.embedded && opener?.isConnected) opener.focus()
})
</script>

<template>
  <component :is="embedded ? 'section' : 'dialog'" ref="dialog" class="species-photo-manager" :class="{ embedded }" :aria-labelledby="`${uid}-title`" :aria-describedby="`${uid}-subtitle`" @cancel.prevent="closeManager" @close="closeManager">
    <header class="photo-header">
      <div><h2 :id="`${uid}-title`">{{ pt(embedded ? 'sectionTitle' : 'title') }}</h2><p :id="`${uid}-subtitle`">{{ pt('sectionDescription') }}</p></div>
      <button v-if="!embedded" ref="closeButton" class="photo-close" type="button" :aria-label="t('common.close')" @click="closeManager"><span aria-hidden="true">×</span></button>
    </header>
    <div class="photo-body">
      <div v-if="species" class="species-identity"><h3>{{ species?.commonName || species?.scientificName || '' }}</h3><p v-if="species?.commonName && species?.scientificName"><em>{{ species.scientificName }}</em></p></div>
      <p v-if="!writesAvailable" :id="`${uid}-unavailable`" class="availability-note" role="status">{{ pt('formUnavailable') }}</p>
      <section v-if="saveError === 'conflict'" class="availability-note" role="alert" :aria-label="pt('conflictTitle')">
        <h3>{{ pt('conflictTitle') }}</h3><p>{{ pt('conflict') }}</p>
        <p v-if="conflictSnapshot">{{ pt('canonicalLoaded', { count: conflictSnapshot.images.length }) }}</p>
        <div v-if="conflictSnapshot" class="conflict-previews"><img v-for="image in conflictSnapshot.images.slice(0, 4)" :key="image.assetId" :src="image.url" :alt="pt('referenceSource')" loading="lazy" /></div>
        <p v-if="conflictReadFailed">{{ pt('conflictReadFailed') }}</p>
        <button v-if="!conflictSnapshot" class="photo-button" type="button" :disabled="saving" @click="refreshConflict">{{ pt('refreshCanonical') }}</button>
        <template v-else><button class="photo-button" type="button" :disabled="saving" @click="reconcileConflict(true)">{{ pt('reapplyDraft') }}</button> <button class="photo-button" type="button" :disabled="saving" @click="reconcileConflict(false)">{{ pt('useCanonical') }}</button></template>
      </section>
      <div v-if="unavailableReferences.length" class="availability-note"><p>{{ pt('unavailableReferences', { count: unavailableReferences.length }) }}</p><button class="photo-button" type="button" :disabled="saving || busy" @click="stageUnavailableRemoval">{{ pt('stageUnavailableRemoval') }}</button></div>
      <div v-if="saveError === 'partial'" class="read-error" role="alert"><p>{{ pt('partialFailure') }}</p><button type="button" class="photo-button" :disabled="saving || busy || !writesAvailable" @click="emit('retry')">{{ pt('retryPhotos') }}</button></div>
      <div v-if="readErrors.length" class="read-error" role="alert"><p v-for="key in readErrors" :key="key">{{ pt(key) }}</p><button type="button" class="photo-button" @click="loadImages">{{ pt('retry') }}</button></div>
      <section class="photo-workspace" :aria-labelledby="`${uid}-grid`" :aria-busy="loading || selecting">
        <div class="grid-heading"><h3 :id="`${uid}-grid`">{{ pt('gallery') }}</h3><span v-if="queue.filter(item => !item.removed).length" class="section-guidance">{{ pt('queuedCount', { count: queue.filter(item => !item.removed).length }) }}</span></div>
        <p :id="`${uid}-ordering`" class="section-guidance">{{ pt('mainDefault') }} {{ pt('reorderHint') }}</p>
        <p v-if="species && !loading && !arrangementAvailable" class="section-guidance">{{ pt('readOnlyGallery') }}</p>
        <p v-if="loading" role="status">{{ pt('loading') }}</p>
        <ul class="photo-grid" :aria-describedby="`${uid}-ordering`">
          <li v-for="(card, index) in photoCards" :key="card.key" class="photo-card" :class="{ 'is-main': firstEligible === card.key, 'is-dragging': dragging === card.key, 'drop-target': dropTarget === card.key, draggable: canReorder(card.key) }" :data-photo-key="card.key" :draggable="canReorder(card.key)" :tabindex="canReorder(card.key) ? 0 : undefined" :aria-label="pt('photoControls', { number: index + 1 })" :aria-describedby="`${uid}-ordering`" @keydown.self="keyboardMove($event, card.key)" @dragstart="startDrag($event, card.id, card.queued)" @dragover.prevent="dropTarget = canReorder(card.key) ? card.key : null" @drop.prevent="dropImage(card.id, card.queued)" @dragend="endDrag">
            <div class="thumbnail" @pointerdown="pointerStart($event, card.key)" @pointermove="pointerMove" @pointerup="pointerEnd" @pointercancel="pointerCancel">
              <img v-if="!failedImages.has(card.url)" :src="card.url" :alt="card.queued ? pt('previewAlt', { name: card.name }) : pt('photoAlt', { number: index + 1 })" draggable="false" @error="failImage(card.url)" />
              <div v-else class="image-placeholder">{{ pt('noImage') }}</div>
              <span v-if="firstEligible === card.key" class="main-badge">{{ pt('mainBadge') }}</span>
              <button v-if="card.queued || card.eligible" type="button" class="thumbnail-remove" :disabled="busy || saving" :aria-label="card.queued ? pt('removeQueuedName', { name: card.name }) : pt('removePhoto', { number: index + 1 })" :title="pt('removeGallery')" @pointerdown.stop @mousedown.stop @dragstart.stop.prevent @click.stop="card.queued ? removeQueued(card.id) : stageRemoval(card.id)"><span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" focusable="false"><path d="M4 4l16 16M20 4L4 20" /></svg></span></button>
            </div>
            <div class="card-caption"><strong :title="card.name">{{ card.name }}</strong><span>{{ pt(card.queued ? 'newPhotos' : 'referenceSource') }}</span>
              <template v-if="card.item"><span>{{ sizeLabel(card.item.file.size) }} &middot; {{ pt(card.item.status) }}</span><span v-if="card.item.error" class="file-errors" role="status">{{ pt('uploadFailed') }}</span></template>
              <span v-if="failedImages.has(card.url)" class="file-errors">{{ pt('previewFailed') }}</span>
            </div>
          </li>
          <li class="add-photo-tile" data-validation-group :aria-label="pt('addPhotos')" :aria-describedby="fileErrors.length ? `${uid}-selection-error` : `${uid}-guidance`">
            <input :id="`${uid}-files`" ref="input" class="visually-hidden" data-validation-field="photos" :aria-invalid="fileErrors.length > 0" type="file" accept="image/jpeg,image/png" multiple :disabled="selecting || busy || saving" :aria-describedby="`${uid}-guidance ${uid}-upload-notice ${uid}-errors ${uid}-selection-error`" @change="selectFiles" />
            <label class="add-photos" :for="`${uid}-files`"><span class="add-symbol" aria-hidden="true">+</span><strong>{{ selecting ? pt('validating') : pt('addPhotos') }}</strong><span :id="`${uid}-guidance`">{{ pt('guidance') }}</span></label>
            <small v-if="fileErrors.length" :id="`${uid}-selection-error`" class="file-errors selection-error">{{ pt('invalidSelection') }}</small>
          </li>
        </ul>
        <div :id="`${uid}-errors`" class="file-errors" aria-live="polite" aria-atomic="true"><p v-for="error in fileErrors" :key="error.id">{{ error.name }}: {{ pt(error.key) }}</p><button v-if="fileErrors.length" type="button" class="photo-button" :disabled="selecting || busy || saving" @click="discardRejectedFiles">{{ pt('discardRejected') }}</button></div>
        <p v-if="!writesAvailable" :id="`${uid}-upload-notice`" class="section-guidance">{{ pt('uploadUnavailable') }}</p>
        <p v-if="dirty" class="section-guidance" role="status">{{ pt('unsaved') }}</p>
        <button v-if="!embedded" class="photo-button" type="button" @click="species && commitPhotos(species.id)" :disabled="!writesAvailable || saving" :aria-describedby="`${uid}-upload-notice`">{{ pt('uploadPhotos') }}</button>
      </section>
      <section v-if="species" class="gallery-section" :aria-label="pt('libraryTitle')">
        <template v-if="!expanded && !arrangementAvailable">
          <p v-if="displayedImages.length" class="section-guidance">{{ pt('loadedPhotos', { count: displayedImages.length }) }}</p>
          <p v-else-if="!loading" class="empty-gallery">{{ pt('emptyGallery') }}</p>
          <ul class="library-grid"><li v-for="(image, index) in displayedImages" :key="image.assetId" class="library-photo"><img v-if="!failedImages.has(image.url)" :src="image.url" loading="lazy" :alt="pt('photoAlt', { number: index + 1 })" @error="failImage(image.url)" /><div v-else class="image-placeholder">{{ pt('noImage') }}</div></li></ul>
        </template>
        <button type="button" class="photo-button library-toggle" :aria-expanded="expanded" @click="expanded = !expanded">{{ pt(expanded ? 'collapseLibrary' : 'expandLibrary') }}</button>
        <template v-if="expanded">
          <h4>{{ pt('libraryTitle') }}</h4><label>{{ pt('sourceFilter') }}<select v-model="sourceFilter" @change="loadLibrary(null)"><option value="all">{{ pt('allPhotos') }}</option><option value="reference">{{ pt('referencePhotos') }}</option><option value="plant">{{ pt('plantPhotos') }}</option></select></label><p v-if="sourceFilter !== 'reference'" class="section-guidance">{{ pt('plantEligibility') }}</p>
          <p v-if="displayedImages.length" class="section-guidance">{{ pt('loadedPhotos', { count: displayedImages.length }) }}</p>
          <p v-else-if="!loading" class="empty-gallery">{{ pt('emptyGallery') }}</p>
          <ul class="library-grid"><li v-for="(image, index) in displayedImages" :key="image.assetId" class="library-photo"><img v-if="!failedImages.has(image.url)" :src="image.url" loading="lazy" :alt="pt('photoAlt', { number: index + 1 })" @error="failImage(image.url)" /><div v-else class="image-placeholder">{{ pt('noImage') }}</div><span>{{ pt(image.source === 'plant' ? 'plantSource' : 'referenceSource') }}</span><p v-if="image.source === 'plant'">{{ pt('plantMainUnavailable') }}</p></li></ul>
          <div class="library-pagination"><button type="button" class="photo-button" :disabled="!libraryCursor || loading" @click="loadLibrary(null)">{{ pt('firstPage') }}</button><button type="button" class="photo-button" :disabled="!nextCursor || loading" @click="loadLibrary(nextCursor)">{{ pt('nextPage') }}</button></div>
        </template>
      </section>
    </div>
    <p class="visually-hidden" aria-live="polite">{{ announcement }}</p>
    <footer v-if="!embedded" class="photo-footer"><button class="photo-button" type="button" @click="closeManager">{{ pt('cancel') }}</button><button class="photo-button primary" type="button" @click="species && commitPhotos(species.id)" :disabled="!writesAvailable || saving || !draft || !dirty" :aria-describedby="`${uid}-unavailable`">{{ pt('saveArrangement') }}</button></footer>
  </component>
</template>

<style scoped>
.species-photo-manager { --photo-green: #216b45; --photo-dark: #174a33; box-sizing: border-box; width: min(960px, calc(100% - 32px)); max-width: calc(100% - 32px); max-height: calc(100dvh - 32px); padding: 0; border: 1px solid var(--line, #dfe7df); border-radius: 18px; color: var(--ink, #29483e); background: var(--paper, #fff); box-shadow: 0 24px 80px #173f3429; overflow-y: auto; overscroll-behavior: contain; }
.species-photo-manager[open] { animation: photo-enter 150ms ease-out; }
.species-photo-manager::backdrop { background: #102f26a6; }
.species-photo-manager * { box-sizing: border-box; }
.photo-header, .photo-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 28px; }
.photo-header { border-bottom: 1px solid var(--line, #dfe7df); }
.photo-header h2 { margin: 0; font-size: 21px; color: var(--photo-dark); }
.photo-header p { margin: 6px 0 0; font-size: 13px; color: #53665b; }
.photo-close { width: 44px; height: 44px; flex-shrink: 0; border: 0; border-radius: 50%; background: var(--wash, #f3f6f2); color: var(--photo-dark); font-size: 26px; cursor: pointer; }
.photo-body { padding: 24px 28px; }
.species-identity h3 { margin: 0; font-size: 22px; }
.species-identity p { margin: 5px 0 18px; color: #53665b; }
.species-photo-manager h3 { overflow-wrap: anywhere; }
.availability-note { margin: 16px 0 24px; padding: 13px 16px; border-left: 3px solid #a8d5b5; background: #eff8f1; font-size: 13px; line-height: 1.6; }
.library-pagination { display: flex; gap: 12px; margin-top: 14px; }
.conflict-previews { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
.conflict-previews img { width: 64px; height: 64px; object-fit: contain; }
.section-guidance, .empty-gallery { color: #53665b; font-size: 12px; line-height: 1.65; }
.section-guidance { margin: 10px 0 14px; }
.photo-button { min-width: 0; min-height: 44px; padding: 9px 12px; border: 1px solid var(--line, #dfe7df); border-radius: 8px; background: #fff; color: var(--photo-dark); font: inherit; font-size: 12px; font-weight: 650; cursor: pointer; overflow-wrap: anywhere; transition: background-color 120ms ease, border-color 120ms ease; }
.photo-button svg { display: block; width: 18px; height: 18px; margin: auto; }
.photo-button:hover:not(:disabled), .photo-close:hover { border-color: var(--photo-green); background: #eff8f1; }
.photo-button:disabled { color: #68756e; background: #f4f6f4; cursor: not-allowed; }
.photo-button.primary { background: var(--photo-green); color: white; border-color: var(--photo-green); }
.photo-button.primary:disabled { background: #dce8e0; border-color: #dce8e0; color: #53665b; }
.photo-button:focus-visible, .photo-close:focus-visible { outline: 3px solid var(--photo-green); outline-offset: 3px; }
.visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.file-errors, .read-error { color: #b42318; font-size: 13px; overflow-wrap: anywhere; }
.file-errors p { margin: 12px 0; }
.photo-footer { border-top: 1px solid var(--line, #dfe7df); justify-content: flex-end; }
.species-photo-manager.embedded { width: 100%; max-width: 100%; max-height: none; border: 0; border-top: 1px solid var(--line, #dfe7df); border-radius: 0; box-shadow: none; overflow: visible; }
.embedded .photo-header, .embedded .photo-body { padding: 18px 0; }
.grid-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.grid-heading h3 { margin: 0; font-size: 15px; }
.photo-grid, .library-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; padding: 0; margin: 12px 0; list-style: none; }
.photo-card { min-width: 0; border: 1px solid #dfe7df; border-radius: 12px; background: white; transition: transform 140ms ease, box-shadow 140ms ease, opacity 140ms ease; }
.photo-card.is-main { border-color: var(--photo-green); }
.photo-card.draggable { cursor: grab; }
.photo-card.is-dragging { opacity: .5; cursor: grabbing; transform: scale(.97); }
.photo-grid:has(.is-dragging), .photo-grid:has(.is-dragging) .draggable { cursor: grabbing; }
.photo-card.drop-target { outline: 3px solid #216b45; outline-offset: 3px; box-shadow: -5px 0 0 #216b45; }
.thumbnail { position: relative; aspect-ratio: 4 / 3; border-radius: 11px 11px 0 0; overflow: hidden; background: #f3f6f2; }
.draggable .thumbnail { touch-action: none; }
.thumbnail img { display: block; width: 100%; height: 100%; object-fit: cover; user-select: none; }
.image-placeholder { display: grid; place-items: center; height: 100%; min-height: 90px; padding: 10px; font-size: 12px; text-align: center; color: #53665b; }
.main-badge { position: absolute; left: 7px; bottom: 7px; padding: 4px 8px; border-radius: 5px; background: #174a33; color: white; font-size: 11px; font-weight: 700; pointer-events: none; }
.thumbnail-remove { position: absolute; top: 3px; right: 3px; display: grid; place-items: center; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: #fff; cursor: pointer; font-size: 32px; touch-action: manipulation; }
.thumbnail-remove > span { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: #174a33; color: #fff; box-shadow: 0 1px 5px #173f3433; }
.thumbnail-remove > span > svg { display: block; width: 24px; height: 24px; margin: 0; }
.thumbnail-remove:hover:not(:disabled) > span { background: #216b45; }
.thumbnail-remove:disabled { opacity: .5; cursor: not-allowed; }
.card-caption { display: flex; flex-direction: column; gap: 4px; padding: 9px 10px; font-size: 11px; color: #53665b; }
.card-caption strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #29483e; font-size: 12px; }
.add-photo-tile { position: relative; min-width: 0; }
.add-photo-tile:has(.selection-error) .add-photos { height: auto; border-color: #a13f35; }
.selection-error { display: block; margin-top: 8px; line-height: 1.5; }
.add-photos { min-height: 170px; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; padding: 14px; border: 1px dashed #86ad92; border-radius: 12px; background: #f7faf7; color: #174a33; cursor: pointer; text-align: center; font-size: 12px; }
.add-photos > span:last-child { font-size: 11px; line-height: 1.5; color: #53665b; }
.add-symbol { font-size: 28px; font-weight: 300; }
.add-photos:hover { border-color: #216b45; background: #eff8f1; }
.add-photo-tile:focus-within .add-photos, .photo-card:focus-visible, .thumbnail-remove:focus-visible, select:focus-visible { outline: 3px solid #216b45; outline-offset: 3px; }
.add-photo-tile:has(input:disabled) { opacity: .6; }
.gallery-section { margin-top: 16px; padding-top: 16px; border-top: 1px solid #dfe7df; }
.library-grid img { width: 100%; height: 100px; object-fit: cover; border-radius: 8px; }
.library-photo { min-width: 0; font-size: 11px; color: #53665b; }
.library-photo p { margin-top: 4px; }
@keyframes photo-enter { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
@media (max-width: 480px) { .species-photo-manager { width: calc(100% - 16px); max-width: calc(100% - 16px); max-height: calc(100dvh - 16px); border-radius: 12px; } .photo-header, .photo-footer, .photo-body { padding: 18px 16px; } .photo-header { align-items: flex-start; } .photo-header h2 { font-size: 19px; } .photo-grid, .library-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; } .photo-footer { flex-wrap: wrap; } .photo-footer button { flex: 1; } }
@media (prefers-reduced-motion: reduce) { .species-photo-manager[open] { animation: none; } .photo-card, .photo-button { transition: none; } }
</style>
