<script setup lang="ts">
import { vOfficerDropdown } from '../../components/conservation/officerDropdown'
import VisibilitySelector from '../../components/conservation/VisibilitySelector.vue'
import { computed, nextTick, onMounted, onScopeDispose, reactive, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { officerActionError } from '../../services/officerActionFeedback'
import ActionFeedback from '../../components/ActionFeedback.vue'
import AppModal from '../../components/conservation/AppModal.vue'
import SpeciesPhotoManager from '../../components/conservation/SpeciesPhotoManager.vue'
import SpeciesViewImages from '../../components/conservation/SpeciesViewImages.vue'
import TextLanguageSelect from '../../components/conservation/TextLanguageSelect.vue'
import { conservationBadgeStyle } from '../../utils/conservationBadge'
import { sessionSnapshot, subscribeSession } from '../../services/auth'
import {
  mapManagedSpecies,
  canManageSpeciesPhotos,
  mapTaxonomyGenus,
  requestSpeciesApi,
  speciesPayload,
  validateSpeciesForm,
  type ManagedSpecies,
  type SpeciesForm,
  type SpeciesVisibility,
  type TaxonomyGenus,
} from '../../services/speciesManagement'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const st = (key: string, params: Record<string, string | number> = {}) =>
  t(`conservationPages.species.${key}`, params)

const species = ref<ManagedSpecies[]>([])
const taxonomy = ref<TaxonomyGenus[]>([])
const isLoading = ref(true)
const loadError = ref('')
const taxonomyError = ref('')
const skippedRecords = ref(0)
const search = ref('')
const familyFilter = ref('')
const statusFilter = ref('')
const visibilityFilter = ref('')
const tableActions = [
  { key: 'view', label: 'view', icon: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0' },
  { key: 'edit', label: 'editSpecies', icon: 'm16 3 5 5-12 12-6 1 1-6ZM14 5l5 5' },
  { key: 'delete', label: 'deleteSpecies', icon: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7' },
] as const
const modal = ref<'form' | 'view' | 'delete' | null>(null)
const selected = ref<ManagedSpecies | null>(null)
const photoSession = shallowRef(sessionSnapshot())
const canManagePhotos = computed(() => canManageSpeciesPhotos(photoSession.value.user, photoSession.value.pending))
const photoEditor = ref<InstanceType<typeof SpeciesPhotoManager> | null>(null)
const createdSpeciesId = ref('')
const photoSaveNotice = ref('')
const unsubscribePhotos = subscribeSession((user, pending) => {
  photoSession.value = { user, pending }
  if (!canManagePhotos.value) modal.value = null
})
onScopeDispose(unsubscribePhotos)
const editing = ref(false)
const detailLoading = ref(false)
const mutation = ref<'create' | 'update' | 'delete' | null>(null)
const mutationError = ref(''), speciesConflict = ref(false)
const unverifiedDeletes = reactive(new Set<string>())
const confirmedDeletes = reactive(new Set<string>())
const deletionNeedsReadback = computed(() => Boolean(selected.value && unverifiedDeletes.has(selected.value.id)))
const deleteCancelButton = ref<HTMLButtonElement | null>(null)
const feedback = ref<{ id: number; variant: 'success' | 'error'; message: string } | null>(null)
let feedbackId = 0
let detailRequest = 0

const blankForm = (): SpeciesForm => ({
  scientificName: '',
  commonName: '',
  genusId: '',
  conservationStatus: '',
  visibility: 'protected',
  description: '',
  habitat: '',
  culturalSignificance: '',
})
const form = reactive<SpeciesForm>(blankForm())
const sourceLanguages = reactive({ description: 'unknown', habitat: 'unknown', culturalSignificance: 'unknown' })
const loadedSourceLanguages: Partial<typeof sourceLanguages> = {}
for (const field of ['description', 'habitat', 'culturalSignificance'] as const) {
  watch(() => form[field], () => {
    if (loadedSourceLanguages[field] === sourceLanguages[field]) sourceLanguages[field] = 'unknown'
    delete loadedSourceLanguages[field]
  }, { flush: 'sync' })
}
const formErrors = ref<Partial<Record<keyof SpeciesForm, string>>>({})
const speciesForm = ref<HTMLFormElement | null>(null)
const validationAttempted = ref(false)
const photoValidation = computed(() => photoEditor.value?.validationState?.())
const invalidFields = computed(() => [
  ...Object.keys(formErrors.value),
  ...(validationAttempted.value && (photoValidation.value?.invalid || photoValidation.value?.pending) ? ['photos'] : []),
])
let highlightTimer: ReturnType<typeof setTimeout> | undefined
let highlightedGroup: HTMLElement | null = null
let validationRun = 0
function clearValidationHighlight() {
  if (highlightTimer !== undefined) clearTimeout(highlightTimer)
  highlightTimer = undefined
  highlightedGroup?.classList.remove('validation-highlight')
  highlightedGroup = null
}
function resetValidation() {
  validationRun++
  validationAttempted.value = false
  clearValidationHighlight()
  formErrors.value = {}
}
function currentFormErrors() {
  const errors = validateSpeciesForm(form, taxonomy.value, knownStatuses.value)
  if (errors.genusId && taxonomyError.value) errors.genusId = `${st('taxonomyUnavailable')} ${taxonomyError.value}`
  // novalidate avoids browser popups; native constraints join the same field error map.
  for (const control of speciesForm.value?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-validation-field]') || []) {
    const key = control.dataset.validationField as keyof SpeciesForm
    if (key in form && !control.disabled && control.validity && !control.validity.valid && !errors[key]) errors[key] = control.validationMessage || st('validationInvalid')
  }
  return errors
}
async function focusFirstInvalid() {
  const run = ++validationRun
  clearValidationHighlight()
  await nextTick()
  if (run !== validationRun || modal.value !== 'form') return
  const control = Array.from(speciesForm.value?.querySelectorAll<HTMLElement>('[data-validation-field]') || [])
    .find(control => invalidFields.value.includes(control.dataset.validationField || ''))
  if (!control) return
  const group = control.closest<HTMLElement>('[data-validation-group], .form-field') || control
  const focusTarget = control.matches(':disabled') ? group.querySelector<HTMLElement>('[data-validation-focus]') || group : control
  if (focusTarget === group) group.tabIndex = -1
  focusTarget.focus({ preventScroll: true })
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const scroller = speciesForm.value?.closest<HTMLElement>('.modal-card')
  if (scroller) {
    const header = scroller.querySelector<HTMLElement>('.modal-header')
    const stickyHeaderHeight = header && ['sticky', 'fixed'].includes(window.getComputedStyle(header).position) ? header.getBoundingClientRect().height : 0
    scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + group.getBoundingClientRect().top - scroller.getBoundingClientRect().top - stickyHeaderHeight - 20), behavior: reduced ? 'instant' : 'smooth' })
  }
  if (!reduced) {
    highlightedGroup = group
    void group.offsetWidth // Restart the single pulse on a repeated Save attempt.
    group.classList.add('validation-highlight')
    highlightTimer = setTimeout(clearValidationHighlight, 1800)
  }
}
watch([() => ({ ...form }), taxonomy, taxonomyError], () => {
  if (validationAttempted.value) formErrors.value = currentFormErrors()
}, { flush: 'post' })
watch(modal, value => { if (value !== 'form') resetValidation() })
onScopeDispose(() => { validationRun++; clearValidationHighlight() })
const visibilities: SpeciesVisibility[] = ['public', 'internal', 'protected']
const visibilityLabel = (value: string) => {
  if (value === 'public') return st('visibilityPublic')
  if (value === 'internal') return st('visibilityInternal')
  if (value === 'protected') return st('visibilityProtected')
  return st('unavailable')
}
const viewFields = computed(() => selected.value ? [
  { key: 'speciesId', value: selected.value.id, icon: 'M12 21V10M12 14C4 14 3 9 3 4c6 0 9 3 9 8 0-5 3-8 9-8 0 5-1 10-9 10Z' },
  { key: 'genus', value: selected.value.genus, icon: 'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z' },
  { key: 'family', value: selected.value.family, icon: 'm3 7 9-5 9 5-9 5Zm0 5 9 5 9-5M3 17l9 5 9-5' },
  { key: 'conservationStatus', value: selected.value.conservationStatus, icon: 'M12 3 3 7v5c0 5 4 8 9 10 5-2 9-5 9-10V7Z' },
  { key: 'visibility', value: visibilityLabel(selected.value.visibility), icon: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0' },
  { key: 'habitat', value: selected.value.habitat, icon: 'm2 20 8-16 5 10 3-6 4 12ZM10 4l8 16' },
  { key: 'culturalSignificance', value: selected.value.culturalSignificance, icon: 'm12 2 3 7 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z' },
  { key: 'description', value: selected.value.description, icon: 'M4 3h16v18H4ZM8 7h8M8 11h8M8 15h5' },
] : [])
const errorMessage = (error: unknown, fallback: string) => {
  const kind = officerActionError(error)
  if (kind === 'conflict') return t('officerFeedback.' + ((error as { code?: string })?.code === 'SPECIES_DELETE_REFERENCED' || /referenced by plant records/i.test((error as Error)?.message || '') ? 'speciesReferenced' : 'speciesConflict'))
  return t('officerFeedback.' + kind) || fallback
}
const showFeedback = (variant: 'success' | 'error', message: string) => {
  feedback.value = { id: ++feedbackId, variant, message }
}
const dismissFeedback = (id: number) => {
  if (feedback.value?.id === id) feedback.value = null
}

const knownStatuses = computed(() => [
  ...new Set(species.value.map((item) => item.conservationStatus).filter(Boolean)),
].sort((a, b) => a.localeCompare(b)))
const families = computed(() => [
  ...new Set(species.value.map((item) => item.family).filter(Boolean)),
].sort((a, b) => a.localeCompare(b)))
const selectedGenus = computed(() => taxonomy.value.find((item) => item.id === form.genusId) || null)
const filtered = computed(() => {
  const query = search.value.trim().toLowerCase()
  return species.value.filter((item) => {
    const searchable = `${item.id} ${item.scientificName} ${item.commonName} ${item.genus} ${item.family} ${item.conservationStatus} ${item.visibility}`
    return (!query || searchable.toLowerCase().includes(query)) &&
      (!familyFilter.value || item.family === familyFilter.value) &&
      (!statusFilter.value || item.conservationStatus === statusFilter.value) &&
      (!visibilityFilter.value || item.visibility === visibilityFilter.value)
  })
})

async function fetchSpeciesList() {
  const result = await requestSpeciesApi('/api/species?scope=scientific')
  if (!Array.isArray(result.species)) throw new Error(st('errors.invalidResponse'))
  const mapped = result.species.map(mapManagedSpecies)
  skippedRecords.value = mapped.filter((item) => item === null).length
  species.value = mapped.filter((item): item is ManagedSpecies => item !== null)
    .sort((a, b) => a.scientificName.localeCompare(b.scientificName) || a.id.localeCompare(b.id))
}
async function loadSpecies() {
  isLoading.value = true
  loadError.value = ''
  try { await fetchSpeciesList(); return true }
  catch (error) {
    species.value = []
    loadError.value = errorMessage(error, st('errors.load'))
    return false
  } finally { isLoading.value = false }
}
async function loadTaxonomy() {
  taxonomyError.value = ''
  try {
    const result = await requestSpeciesApi('/api/taxonomy')
    if (!Array.isArray(result.genera)) throw new Error(st('errors.invalidResponse'))
    taxonomy.value = result.genera.map(mapTaxonomyGenus)
      .filter((item): item is TaxonomyGenus => item !== null)
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch (error) {
    taxonomy.value = []
    taxonomyError.value = errorMessage(error, st('errors.taxonomy'))
  }
}
async function fetchSpeciesDetail(id: string) {
  const result = await requestSpeciesApi(`/api/species/${encodeURIComponent(id)}`)
  const mapped = mapManagedSpecies(result.species)
  if (!mapped || mapped.id !== id) throw new Error(st('errors.invalidResponse'))
  return mapped
}

function assignForm(item?: ManagedSpecies) {
  Object.assign(form, item ? {
    scientificName: item.scientificName,
    commonName: item.commonName,
    genusId: item.genusId,
    conservationStatus: item.conservationStatus,
    visibility: item.visibility || 'protected',
    description: item.description,
    habitat: item.habitat,
    culturalSignificance: item.culturalSignificance,
  } : blankForm())
  Object.assign(sourceLanguages, { description: 'unknown', habitat: 'unknown', culturalSignificance: 'unknown' })
  for (const field of ['description', 'habitat', 'culturalSignificance'] as const) delete loadedSourceLanguages[field]
  resetValidation()
  mutationError.value = ''; speciesConflict.value = false
}
function openCreate() {
  detailRequest++
  editing.value = false
  selected.value = null
  assignForm()
  createdSpeciesId.value = ''
  photoSaveNotice.value = ''
  modal.value = 'form'
}
async function loadForModal(item: ManagedSpecies, mode: 'view' | 'form') {
  const requestId = ++detailRequest
  createdSpeciesId.value = ''
  photoSaveNotice.value = ''
  selected.value = item
  editing.value = mode === 'form'
  modal.value = mode
  detailLoading.value = true
  mutationError.value = ''
  try {
    const detail = await fetchSpeciesDetail(item.id)
    if (requestId !== detailRequest) return
    selected.value = detail
    if (mode === 'form') {
      assignForm(detail)
      const result = await requestSpeciesApi('/api/website/translations/source-languages', { method: 'POST', body: {
        entries: ['description', 'habitat', 'culturalSignificance'].map((fieldName) => ({ recordType: 'species', recordId: detail.id, fieldName })),
      } })
      if (requestId !== detailRequest) return
      for (const row of (Array.isArray(result.sourceLanguages) ? result.sourceLanguages : []))
        if (Object.hasOwn(sourceLanguages, row.fieldName) && ['en', 'ms', 'zh-CN'].includes(row.sourceLocale)) {
          const field = row.fieldName as keyof typeof sourceLanguages
          sourceLanguages[field] = loadedSourceLanguages[field] = row.sourceLocale
        }
    }
  } catch (error) {
    if (requestId === detailRequest) mutationError.value = errorMessage(error, st('errors.detail'))
  } finally {
    if (requestId === detailRequest) detailLoading.value = false
  }
}
const view = (item: ManagedSpecies) => loadForModal(item, 'view')
const openEdit = (item: ManagedSpecies) => loadForModal(item, 'form')

async function refreshConflict() {
  if (modal.value === 'delete' && deletionNeedsReadback.value) { await verifyDeletion(); return }
  if (!selected.value || detailLoading.value || mutation.value) return
  const id = selected.value.id, token = detailRequest
  detailLoading.value = true
  try {
    const latest = await fetchSpeciesDetail(id)
    await fetchSpeciesList()
    if (token !== detailRequest || selected.value?.id !== id) return
    selected.value = latest; speciesConflict.value = false; mutationError.value = ''
    // Intentionally keep the Officer's form/photo draft; no mutation is repeated.
  } catch (error) { if (token === detailRequest) mutationError.value = errorMessage(error, '') }
  finally { if (token === detailRequest) detailLoading.value = false }
}
async function save() {
  if (mutation.value || detailLoading.value || speciesConflict.value) return
  validationAttempted.value = true
  formErrors.value = currentFormErrors()
  if (invalidFields.value.length) { await focusFirstInvalid(); return }
  clearValidationHighlight()
  mutation.value = editing.value ? 'update' : 'create'
  mutationError.value = ''
  let committed = false
  try {
    const payload = { ...speciesPayload(form), source_languages: { ...sourceLanguages } }
    const savedId = editing.value ? selected.value?.id : createdSpeciesId.value
    const result = savedId
      ? await requestSpeciesApi(`/api/species/${encodeURIComponent(savedId)}`, { method: 'PATCH', body: payload })
      : await requestSpeciesApi('/api/species', { method: 'POST', body: payload })
    committed = true
    const id = savedId || String(result.species_id ?? '')
    if (!editing.value && id) createdSpeciesId.value = id
    if (savedId ? result.updated !== true : !id) throw new Error(st('errors.invalidResponse'))
    const photoResult = await photoEditor.value?.commitPhotos(id)
    await fetchSpeciesDetail(id)
    await fetchSpeciesList()
    if (photoResult && !photoResult.complete) {
      photoSaveNotice.value = st(photoResult.deferred ? 'photos.textSavedDeferred' : photoResult.conflict ? 'photos.conflict' : 'photos.partialFailure')
      return
    }
    modal.value = null
    await router.replace({ query: {} })
    showFeedback('success', editing.value ? st('feedback.edited') : st('feedback.added'))
  } catch (error) {
    speciesConflict.value = !committed && officerActionError(error) === 'conflict'
    const message = errorMessage(error, st('errors.save'))
    mutationError.value = committed ? st('errors.savedRefresh', { message }) : message
  } finally { mutation.value = null }
}

function confirmDelete(item: ManagedSpecies) {
  detailRequest++
  selected.value = item
  mutationError.value = ''
  speciesConflict.value = false
  if (unverifiedDeletes.has(item.id)) mutationError.value = st(confirmedDeletes.has(item.id) ? 'errors.deletedRefreshPending' : 'errors.deleteUncertain')
  modal.value = 'delete'
  void nextTick(() => deleteCancelButton.value?.focus())
}
async function remove() {
  if (!selected.value || mutation.value || detailLoading.value || speciesConflict.value || deletionNeedsReadback.value) return
  mutation.value = 'delete'
  mutationError.value = ''
  let committed = false
  try {
    const result = await requestSpeciesApi(`/api/species/${encodeURIComponent(selected.value.id)}`, { method: 'DELETE' })
    if (result.deleted !== true) throw new Error(st('errors.invalidResponse'))
    committed = true
    confirmedDeletes.add(selected.value.id)
    unverifiedDeletes.add(selected.value.id)
    await fetchSpeciesList()
    unverifiedDeletes.delete(selected.value.id)
    modal.value = null
    showFeedback('success', st('feedback.deleted'))
  } catch (error) {
    speciesConflict.value = !committed && officerActionError(error) === 'conflict'
    const message = errorMessage(error, st('errors.delete'))
    const failure = error as { kind?: string; status?: number }
    const uncertain = !committed && (['network','server'].includes(officerActionError(error)) || (failure?.kind === 'invalid' && Number(failure.status) >= 200 && Number(failure.status) < 300))
    if (uncertain) unverifiedDeletes.add(selected.value!.id)
    mutationError.value = committed ? st('errors.deletedRefresh', { message }) : uncertain ? st('errors.deleteUncertain') : message
  } finally { mutation.value = null }
}

async function verifyDeletion() {
  if (!selected.value || mutation.value || detailLoading.value || !deletionNeedsReadback.value) return
  const id = selected.value.id, token = detailRequest
  detailLoading.value = true
  try {
    if (!confirmedDeletes.has(id)) {
      // Catalogue 404 also means unavailable visibility/approval, so a failed
      // read cannot prove deletion or unlock a second mutation.
      const latest = await fetchSpeciesDetail(id)
      if (token !== detailRequest || selected.value?.id !== id) return
      selected.value = latest
      unverifiedDeletes.delete(id)
      speciesConflict.value = false
      mutationError.value = st('errors.deleteStillPresent')
      return
    }
    await fetchSpeciesList()
    if (token !== detailRequest || selected.value?.id !== id) return
    unverifiedDeletes.delete(id)
    modal.value = null
    showFeedback('success', st('feedback.deleted'))
  } catch (error) {
    if (token === detailRequest) mutationError.value = st(confirmedDeletes.has(id) ? 'errors.deletedRefresh' : 'errors.deleteVerificationFailed', { message: errorMessage(error, '') })
  } finally { if (token === detailRequest) detailLoading.value = false }
}

onMounted(async () => {
  await Promise.all([loadSpecies(), loadTaxonomy()])
  if (route.query.action === 'add') openCreate()
})
</script>

<template>
  <ActionFeedback v-if="feedback" :key="feedback.id" :feedback-id="feedback.id" :variant="feedback.variant" :message="feedback.message" @dismiss="dismissFeedback" />
  <section class="page-intro"><div><p class="page-kicker">{{ st('knowledgeBase') }}</p><h2>{{ st('title') }}</h2><p>{{ st('intro') }}</p></div></section>
  <div class="control-bar species-controls">
    <label class="field search-field"><span>{{ st('searchSpecies') }}</span><input v-model.trim="search" maxlength="100" :placeholder="st('searchPlaceholder')" /></label>
    <label class="field"><span>{{ st('family') }}</span><select v-officer-dropdown v-model="familyFilter"><option value="">{{ st('allFamilies') }}</option><option v-for="item in families" :key="item" :value="item">{{ item }}</option></select></label>
    <label class="field"><span>{{ st('conservationStatus') }}</span><select v-officer-dropdown v-model="statusFilter"><option value="">{{ st('allStatuses') }}</option><option v-for="item in knownStatuses" :key="item" :value="item">{{ item }}</option></select></label>
    <label class="field"><span>{{ st('visibility') }}</span><select v-officer-dropdown v-model="visibilityFilter"><option value="">{{ st('allVisibility') }}</option><option v-for="item in visibilities" :key="item" :value="item">{{ visibilityLabel(item) }}</option></select></label>
    <button class="primary-button create-species-button" type="button" @click="openCreate">+ {{ st('createSpecies') }}</button>
  </div>

  <section class="panel species-table-panel">
    <p v-if="!isLoading && !loadError && skippedRecords" class="dataset-note" role="status">{{ st('skipped', { count: skippedRecords }) }}</p>
    <div class="table-scroll species-scroll" role="region" :aria-label="st('title')" :aria-description="st('loadedLimit')" tabindex="0">
      <table class="species-table" role="table">
        <colgroup><col class="species-id-column" /><col class="scientific-column" /><col class="common-column" /><col class="status-column" /><col class="visibility-column" /><col class="actions-column" /></colgroup>
        <thead role="rowgroup"><tr role="row">
          <th scope="col" role="columnheader">{{ st('speciesId') }}</th><th scope="col" role="columnheader">{{ st('scientificName') }}</th><th scope="col" role="columnheader">{{ st('commonName') }}</th><th scope="col" role="columnheader">{{ st('conservationStatus') }}</th><th scope="col" role="columnheader">{{ st('visibility') }}</th><th scope="col" role="columnheader">{{ st('actions') }}</th>
        </tr></thead>
        <tbody role="rowgroup">
          <tr v-for="item in filtered" :key="item.id" role="row">
            <td role="cell"><span class="species-card-leaf" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 3C8 3 3 7 4 15s12 6 16-12ZM3 22 16 9" /></svg></span><span class="species-cell-label" aria-hidden="true">{{ st('speciesId') }}</span><strong>{{ item.id }}</strong></td>
            <td role="cell" class="name-cell"><span class="species-cell-label" aria-hidden="true">{{ st('scientificName') }}</span><em>{{ item.scientificName || st('unavailable') }}</em></td>
            <td role="cell" class="name-cell"><span class="species-cell-label" aria-hidden="true"><svg class="species-card-field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h8l10 10-8 8L3 11ZM7 7h.01" /></svg>{{ st('commonName') }}:</span>{{ item.commonName || st('unavailable') }}</td>
            <td role="cell" class="status-cell"><span class="species-cell-label" aria-hidden="true"><svg class="species-card-field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V10M12 14C4 14 3 9 3 4c6 0 9 3 9 8 0-5 3-8 9-8 0 5-1 10-9 10Z" /></svg>{{ st('conservationStatus') }}:</span><span class="badge conservation-status" :style="conservationBadgeStyle(item.conservationStatus)">{{ item.conservationStatus || st('unavailable') }}</span></td>
            <td role="cell"><span class="species-cell-label" aria-hidden="true"><svg class="species-card-field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0" /></svg>{{ st('visibility') }}:</span><span class="badge">{{ visibilityLabel(item.visibility) }}</span></td>
            <td role="cell" class="actions-cell"><span class="species-cell-label" aria-hidden="true">{{ st('actions') }}</span><div class="action-group">
              <span v-for="action in tableActions" :key="action.key" class="species-action-control">
                <button type="button" class="action-button species-icon-action" :class="{ danger: action.key === 'delete' }" :aria-label="st(action.label)" :aria-describedby="`species-${item.id}-${action.key}-tooltip`" :disabled="!canManagePhotos || Boolean(mutation)" @click="action.key === 'view' ? view(item) : action.key === 'edit' ? openEdit(item) : confirmDelete(item)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="action.icon" /></svg><span class="species-action-name">{{ st(action.label) }}</span></button>
                <span :id="`species-${item.id}-${action.key}-tooltip`" class="species-action-tooltip" role="tooltip">{{ st(action.label) }}</span>
              </span>
            </div></td>
          </tr>
          <tr v-if="isLoading" role="row"><td role="cell" colspan="6" class="empty-row">{{ st('loading') }}</td></tr>
          <tr v-else-if="loadError" role="row"><td role="cell" colspan="6" class="error-row"><strong>{{ st('loadFailed') }}</strong><span>{{ loadError }}</span><button class="action-button" @click="loadSpecies">{{ st('retry') }}</button></td></tr>
          <tr v-else-if="!filtered.length" role="row"><td role="cell" colspan="6" class="empty-row">{{ species.length ? st('noMatches') : st('empty') }}</td></tr>
        </tbody>
      </table>
    </div>
  </section>



  <AppModal v-if="modal === 'form'" :class="{ 'species-create-modal': !editing }" :title="editing ? st('editSpecies') : st('createSpecies')" :subtitle="st(editing ? 'formSubtitle' : 'createFormSubtitle')" wide accessible @close="!mutation && (modal = null)">
    <template #title><span :class="{ 'species-create-title': !editing }"><svg v-if="!editing" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.8 3.2C12.1 3.4 5.1 5.3 4 12.2c-.7 4.2 2.7 6.8 6.1 5.6 4.5-1.5 7.4-6.4 10.7-14.6ZM3.4 21c2.8-5.2 6.1-8.5 11.2-11.2" /></svg>{{ editing ? st('editSpecies') : st('createSpecies') }}</span></template>
    <p v-if="detailLoading" class="state-note">{{ st('loadingDetail') }}</p>
    <p v-if="taxonomyError" class="state-note warning">{{ st('taxonomyUnavailable') }} {{ taxonomyError }}</p>
    <div v-if="speciesConflict" class="state-note error" role="alert"><p>{{ mutationError || t('officerFeedback.speciesConflict') }}</p><button type="button" :disabled="detailLoading || Boolean(mutation)" @click="refreshConflict">{{ t('officerFeedback.refresh') }}</button></div><p v-if="mutationError && !speciesConflict" class="state-note error" role="alert">{{ mutationError }}</p>
    <form ref="speciesForm" class="form-grid" :class="{ 'species-create-form': !editing }" novalidate @submit.prevent="save">
      <section class="create-form-section create-basic-section">
        <h3 class="create-form-section-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/></svg>{{ st('basicInformation') }}</h3>
      <label class="form-field"><span>{{ st('scientificName') }} *</span><input v-model="form.scientificName" :placeholder="st('placeholders.scientificName')" data-validation-field="scientificName" aria-required="true" :aria-invalid="Boolean(formErrors.scientificName)" :aria-describedby="formErrors.scientificName ? 'species-scientificName-error' : undefined" :disabled="detailLoading || Boolean(mutation)" /><small id="species-scientificName-error" v-if="formErrors.scientificName" class="field-error">{{ formErrors.scientificName }}</small></label>
      <label class="form-field"><span>{{ st('commonName') }} *</span><input v-model="form.commonName" :placeholder="st('placeholders.commonName')" data-validation-field="commonName" aria-required="true" :aria-invalid="Boolean(formErrors.commonName)" :aria-describedby="formErrors.commonName ? 'species-commonName-error' : undefined" :disabled="detailLoading || Boolean(mutation)" /><small id="species-commonName-error" v-if="formErrors.commonName" class="field-error">{{ formErrors.commonName }}</small></label>
      <div class="form-field" data-validation-group><label for="species-genus-input"><span>{{ st('genus') }}</span></label><select v-officer-dropdown id="species-genus-input" v-model="form.genusId" :title="st('placeholders.genus')" :aria-description="st('placeholders.genus')" data-validation-field="genusId" :aria-invalid="Boolean(formErrors.genusId)" :aria-describedby="formErrors.genusId ? 'species-genusId-error' : undefined" :disabled="detailLoading || Boolean(mutation) || Boolean(taxonomyError)"><option value="">{{ st('noGenus') }}</option><option v-for="item in taxonomy" :key="item.id" :value="item.id">{{ item.name }}</option></select><button v-if="taxonomyError" type="button" class="secondary-button taxonomy-retry" :disabled="detailLoading || Boolean(mutation)" :aria-describedby="formErrors.genusId ? 'species-genusId-error' : undefined" data-validation-focus @click="loadTaxonomy">{{ st('retry') }}</button><small id="species-genusId-error" v-if="formErrors.genusId" class="field-error">{{ formErrors.genusId }}</small></div>
      <label class="form-field"><span>{{ st('familyDerived') }}</span><input :value="selectedGenus?.family || ''" :placeholder="st('placeholders.family')" readonly class="readonly-field" /></label>
      <label class="form-field"><span>{{ st('conservationStatus') }}</span><select v-officer-dropdown v-model="form.conservationStatus" :title="st('placeholders.conservationStatus')" :aria-description="st('placeholders.conservationStatus')" data-validation-field="conservationStatus" :aria-invalid="Boolean(formErrors.conservationStatus)" :aria-describedby="formErrors.conservationStatus ? 'species-conservationStatus-error' : undefined" :disabled="detailLoading || Boolean(mutation)"><option value="">{{ st('noConservationStatus') }}</option><option v-for="item in knownStatuses" :key="item" :value="item">{{ item }}</option></select><small id="species-conservationStatus-error" v-if="formErrors.conservationStatus" class="field-error">{{ formErrors.conservationStatus }}</small></label>
      <label v-if="editing" class="form-field"><span>{{ st('visibility') }} *</span><select v-officer-dropdown v-model="form.visibility" :title="st('placeholders.visibility')" :aria-description="st('placeholders.visibility')" data-validation-field="visibility" aria-required="true" :aria-invalid="Boolean(formErrors.visibility)" :aria-describedby="formErrors.visibility ? 'species-visibility-error' : undefined" :disabled="detailLoading || Boolean(mutation)"><option value="" disabled>{{ st('placeholders.visibility') }}</option><option v-for="item in visibilities" :key="item" :value="item">{{ visibilityLabel(item) }}</option></select><small id="species-visibility-error" v-if="formErrors.visibility" class="field-error">{{ formErrors.visibility }}</small></label>
      </section>
      <section v-if="!editing" class="create-form-section create-visibility-section">
        <VisibilitySelector id="species-visibility" class="create-species-visibility" v-model="form.visibility" validation-field="visibility" horizontal required :invalid="Boolean(formErrors.visibility)" :error="formErrors.visibility" :disabled="detailLoading || Boolean(mutation)" />
      </section>
      <section class="create-form-section create-details-section">
        <h3 class="create-form-section-title"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.8 3.2C12.1 3.4 5.1 5.3 4 12.2c-.7 4.2 2.7 6.8 6.1 5.6 4.5-1.5 7.4-6.4 10.7-14.6ZM3.4 21c2.8-5.2 6.1-8.5 11.2-11.2"/></svg>{{ st('speciesDetails') }}</h3>
      <label class="form-field full"><span>{{ st('description') }} *</span><textarea v-model="form.description" :placeholder="st('placeholders.description')" data-validation-field="description" aria-required="true" :aria-invalid="Boolean(formErrors.description)" :aria-describedby="formErrors.description ? 'species-description-error' : undefined" :disabled="detailLoading || Boolean(mutation)"></textarea><small id="species-description-error" v-if="formErrors.description" class="field-error">{{ formErrors.description }}</small></label>
      <TextLanguageSelect v-model="sourceLanguages.description" class="full" :disabled="detailLoading || Boolean(mutation)" />
      <label class="form-field full"><span>{{ st('habitat') }}</span><textarea v-model="form.habitat" :placeholder="st('placeholders.habitat')" data-validation-field="habitat" :aria-invalid="Boolean(formErrors.habitat)" :aria-describedby="formErrors.habitat ? 'species-habitat-error' : undefined" maxlength="4000" :disabled="detailLoading || Boolean(mutation)"></textarea><small id="species-habitat-error" v-if="formErrors.habitat" class="field-error">{{ formErrors.habitat }}</small></label>
      <TextLanguageSelect v-model="sourceLanguages.habitat" class="full" :disabled="detailLoading || Boolean(mutation)" />
      <label class="form-field full"><span>{{ st('culturalSignificance') }}</span><textarea v-model="form.culturalSignificance" maxlength="4000" :disabled="detailLoading || Boolean(mutation)"></textarea><small v-if="formErrors.culturalSignificance" class="field-error">{{ formErrors.culturalSignificance }}</small></label>
      <TextLanguageSelect v-model="sourceLanguages.culturalSignificance" class="full" :disabled="detailLoading || Boolean(mutation)" />
      </section>
      <section v-if="canManagePhotos && !detailLoading" class="create-form-section create-photos-section">
        <SpeciesPhotoManager ref="photoEditor" class="form-field full" embedded :species="editing ? selected : null" :busy="Boolean(mutation)" @retry="save" />
      </section>
      <p v-if="photoSaveNotice" class="form-field full state-note warning" role="status">{{ photoSaveNotice }}</p>
      <div class="modal-actions form-field full"><p class="validation-summary" role="status" aria-live="polite" aria-atomic="true">{{ validationAttempted && invalidFields.length ? st('validationSummary', { count: invalidFields.length }) : '' }}</p><button type="button" class="secondary-button" :disabled="Boolean(mutation)" @click="modal = null">{{ st('cancel') }}</button><button class="primary-button" :disabled="detailLoading || Boolean(mutation)">{{ mutation ? st('saving') : st('save') }}</button></div>
    </form>
  </AppModal>

  <AppModal v-if="modal === 'view' && selected" class="species-view-modal" wide accessible :title="selected.scientificName" :subtitle="selected.commonName" @close="modal = null">
    <template #title><span class="species-view-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M20 3C8 3 3 7 4 15s12 6 16-12ZM3 22 16 9" /></svg>{{ selected.scientificName }}</span></template>
    <p v-if="detailLoading" class="state-note">{{ st('loadingDetail') }}</p><div v-if="speciesConflict" class="state-note error" role="alert"><p>{{ mutationError || t('officerFeedback.speciesConflict') }}</p><button type="button" :disabled="detailLoading || Boolean(mutation)" @click="refreshConflict">{{ t('officerFeedback.refresh') }}</button></div><p v-if="mutationError && !speciesConflict" class="state-note error" role="alert">{{ mutationError }}</p>
    <dl class="detail-list species-view-fields"><div v-for="field in viewFields" :key="field.key"><svg class="species-field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="field.icon" /></svg><div><dt>{{ st(field.key) }}</dt><dd><span v-if="field.key === 'conservationStatus'" class="badge conservation-status" :style="conservationBadgeStyle(selected.conservationStatus)">{{ field.value || st('unavailable') }}</span><template v-else>{{ field.value || st('unavailable') }}</template></dd></div></div></dl>
    <SpeciesViewImages v-if="!detailLoading && !mutationError" :species="selected" />
  </AppModal>

  <AppModal v-if="modal === 'delete' && selected" class="species-delete-dialog" :title="st('deleteSpecies')" :subtitle="st('deleteDialogSubtitle')" :close-on-backdrop="false" :close-on-escape="false" danger-backdrop accessible @close="!mutation && (modal = null)">
    <template #title><span class="species-delete-icon" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13h32M17 13V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v5M12 13l2 29h20l2-29M20 21v13m8-13v13"/></svg></span><span>{{ st('deleteSpecies') }}</span></template>
    <div class="species-delete-content">
      <div v-if="speciesConflict" class="species-delete-state error" role="alert"><p>{{ mutationError || t('officerFeedback.speciesConflict') }}</p><button type="button" :disabled="detailLoading || Boolean(mutation)" @click="refreshConflict">{{ t('officerFeedback.refresh') }}</button></div>
      <p v-if="mutationError && !speciesConflict" class="species-delete-state error" role="alert">{{ mutationError }}</p>
      <section class="species-delete-warning" role="note"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M24 5 45 42H3L24 5Z"/><path d="M24 17v12m0 7h.02"/></svg><div><strong>{{ st('deleteIrreversible') }}</strong><p>{{ st('deleteConfirmation') }}</p></div></section>
      <section class="species-delete-important" role="note"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 39C7 21 17 8 41 6c-1 23-13 34-31 33"/><path d="M9 41c8-13 17-21 29-29"/></svg><div><strong>{{ st('deleteImportant') }}</strong><p>{{ st('deleteReferenceWarning') }}</p></div></section>
      <button v-if="deletionNeedsReadback" type="button" class="species-delete-refresh" :disabled="detailLoading || Boolean(mutation)" @click="verifyDeletion">{{ t('officerFeedback.refresh') }}</button>
      <div class="species-delete-actions"><button ref="deleteCancelButton" class="species-delete-cancel" :disabled="Boolean(mutation)" @click="modal = null">{{ st('cancel') }}</button><button class="species-delete-confirm" :disabled="Boolean(mutation) || detailLoading || speciesConflict || deletionNeedsReadback" @click="remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg>{{ mutation === 'delete' ? st('deleting') : st('deleteSpecies') }}</button></div>
    </div>
  </AppModal>
</template>

<style scoped>
.species-view-modal :deep(.modal-card.wide) { width: min(1000px, calc(100vw - 32px)); box-sizing: border-box; max-height: calc(100dvh - 32px); overflow-y: auto; padding: 24px; }
.species-delete-dialog :deep(.modal-card) { box-sizing:border-box;width:min(640px,calc(100vw - 32px));max-width:calc(100vw - 32px);max-height:calc(100dvh - 32px);overflow:auto;padding:0;border:1px solid #e3e9e5;border-radius:16px; }
.species-delete-dialog :deep(.modal-header) { display:flex;align-items:center;gap:12px;margin:0;padding:20px 24px 16px;border-bottom:1px solid #e2e7e3; }
.species-delete-dialog :deep(.custom-modal-title) { flex:1;min-width:0; }
.species-delete-dialog.species-delete-dialog.species-delete-dialog :deep(.modal-header h2) { display:flex;align-items:center;gap:12px;margin:0;color:#164733;font-family:inherit;font-size:22px;line-height:30px; }
.species-delete-dialog :deep(.modal-header h2 span:last-child) { min-width:0;overflow-wrap:anywhere; }
.species-delete-dialog.species-delete-dialog.species-delete-dialog :deep(.modal-header p) { margin:4px 0 0;color:#526c60;font-size:14px;line-height:22px; }
.officer-layout.officer-layout.officer-layout :deep(.species-delete-dialog .close-button) { flex:0 0 44px;width:44px;height:44px;min-width:44px;min-height:44px;border-radius:8px; }
.species-delete-icon { display:grid;width:48px;height:48px;flex:none;place-items:center;border-radius:12px;background:#faeeee;color:#bd4b42; }
.species-delete-icon svg { width:28px;height:28px; }
.species-delete-content { display:grid;gap:16px;padding:20px 24px 22px; }
.species-delete-warning,.species-delete-important { display:grid;grid-template-columns:32px minmax(0,1fr);align-items:start;gap:12px;min-width:0;padding:14px;border-radius:12px; }
.species-delete-warning { background:#fbefef;color:#344b4c; }
.species-delete-warning>svg,.species-delete-important>svg { width:28px;height:28px; }
.species-delete-warning>svg,.species-delete-warning strong { color:#b4261d; }
.species-delete-important { background:#f0f4f1;color:#344b4c; }
.species-delete-important>svg { color:#69a678;fill:#69a678; }
.species-delete-important strong { color:#176146; }
.species-delete-warning strong,.species-delete-important strong { display:block;margin-bottom:4px;font-size:16px;line-height:24px; }
.species-delete-warning p,.species-delete-important p { margin:0;font-size:14px;line-height:22px;overflow-wrap:anywhere; }
.species-delete-state { padding:14px 18px;border-radius:12px;background:#fff6e7;color:#59421f;font-size:16px;overflow-wrap:anywhere; }
.species-delete-state p { margin:0 0 10px; }
.species-delete-state.error { background:#fff0ed;color:#8f261d; }
.species-delete-state button,.species-delete-refresh { justify-self:start;min-height:44px;padding:10px 18px;border:1px solid #668773;border-radius:10px;background:#fff;color:#174b37;font:600 15px/1.3 Poppins,Arial,sans-serif;cursor:pointer; }
.species-delete-actions { display:flex;justify-content:flex-end;gap:10px;margin-top:4px;padding-top:14px;border-top:1px solid #e2e7e3; }
.species-delete-actions button { display:flex;min-width:124px;min-height:44px;align-items:center;justify-content:center;gap:8px;padding:8px 14px;border:1px solid transparent;border-radius:9px;font-family:inherit;font-size:14px;font-weight:600;line-height:20px;cursor:pointer; }
.species-delete-actions svg { width:18px;height:18px; }
.species-delete-cancel { border-color:#bfd5c6!important;background:#fff;color:#176146; }
.species-delete-confirm { background:#b63e37;color:#fff; }
.species-delete-actions button:disabled,.species-delete-state button:disabled,.species-delete-refresh:disabled { opacity:.55;cursor:not-allowed; }
.species-delete-actions button:focus-visible,.species-delete-dialog :deep(.close-button:focus-visible),.species-delete-state button:focus-visible,.species-delete-refresh:focus-visible { outline:3px solid #245443;outline-offset:3px; }
@media(max-width:560px) { .species-delete-dialog :deep(.modal-card){width:calc(100vw - 20px);max-width:calc(100vw - 20px);max-height:calc(100dvh - 20px)}.species-delete-dialog :deep(.modal-header){gap:8px;padding:16px 16px 16px 12px}.species-delete-dialog.species-delete-dialog.species-delete-dialog :deep(.modal-header h2){gap:8px;font-size:20px;line-height:28px}.species-delete-dialog.species-delete-dialog.species-delete-dialog :deep(.modal-header p){font-size:13px;line-height:20px}.species-delete-icon{width:40px;height:40px;border-radius:10px}.species-delete-icon svg{width:24px;height:24px}.species-delete-content{gap:12px;padding:16px}.species-delete-warning,.species-delete-important{grid-template-columns:26px minmax(0,1fr);gap:10px;padding:12px}.species-delete-warning>svg,.species-delete-important>svg{width:24px;height:24px}.species-delete-actions{gap:8px;padding-top:12px}.species-delete-actions button{flex:1;min-width:0;padding:8px 10px} }
.species-view-modal :deep(.modal-header) { padding: 0 0 20px; margin-bottom: 24px; border-bottom: 1px solid #d7e2dc; align-items: flex-start; gap: 16px; }
.species-view-title { display: flex; align-items: center; gap: 16px; color: #174c38; overflow-wrap: anywhere; }
.species-view-title svg { width: 36px; height: 36px; flex: 0 0 36px; }
.species-view-modal :deep(.modal-header > div > p) { margin: 6px 0 0 52px; }
.species-view-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; margin: 0; }
.species-view-fields > div { display: flex; align-items: flex-start; gap: 18px; padding: 20px; border: 1px solid #d7e2dc; border-radius: 14px; background: #f2f6ef; min-width: 0; }
.species-view-fields > div > div { display: block; min-width: 0; padding: 0; border: 0; }
.species-field-icon { width: 28px; height: 28px; flex: 0 0 28px; margin-top: 3px; color: #245443; }
.species-view-fields dt { margin: 0 0 8px; color: #174c38; font-weight: 700; }
.species-view-fields dd { margin: 0; color: #29483e; white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-width: 600px) {
  .species-view-modal :deep(.modal-card.wide) { padding: 16px; }
  .species-view-fields { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .species-view-fields > div { padding: 16px; gap: 12px; }
  .species-view-title { gap: 10px; }
  .species-view-modal :deep(.modal-header > div > p) { margin-left: 46px; }
}
.officer-layout .control-bar > .create-species-button {
  align-self: flex-end;
  flex: 0 0 auto;
  width: fit-content;
  max-width: 100%;
  box-sizing: border-box;
  height: auto;
  min-height: 2.75rem;
  padding: 0 15px;
  white-space: normal;
  overflow-wrap: anywhere;
}
/* Include the Officer boundary to outrank shared table defaults only in this table. */
.officer-layout .species-scroll { min-width: 0; max-width: 100%; overflow-x: auto; overscroll-behavior-inline: contain; }
.species-scroll:focus-visible { outline: 3px solid #315b49; outline-offset: -3px; }
.officer-layout .species-scroll .species-table { width: 100%; min-width: 48rem; table-layout: auto; border-collapse: separate; border-spacing: 0; }
.species-table .species-id-column { width: 7rem; }
.species-table .scientific-column { width: 24%; }
.species-table .common-column { width: 20%; }
.species-table .status-column { width: 13rem; }
.species-table .visibility-column { width: 9rem; }
.species-table .actions-column { width: 152px; }
.officer-layout .species-scroll .species-table th, .officer-layout .species-scroll .species-table td { padding: 12px 14px; text-align: left; vertical-align: middle; }
.officer-layout .species-scroll .species-table th { background: #245443; color: #fff; border-bottom-color: #245443; font-size: var(--officer-small, .75rem); font-weight: 700; text-transform: uppercase; letter-spacing: .6px; line-height: 1.5; }
.species-table thead th:first-child { border-top-left-radius: 10px; }
.species-table thead th:last-child { border-top-right-radius: 10px; }
.officer-layout .species-scroll .species-table td { font-size: var(--officer-text, .875rem); line-height: 1.5; }
.officer-layout .species-scroll .species-table td.name-cell { white-space: normal; overflow-wrap: normal; word-break: normal; }
.officer-layout .species-scroll .species-table .status-cell, .officer-layout .species-scroll .species-table .actions-cell { white-space: nowrap; }
.officer-layout .species-scroll .species-table .action-group { display: flex; align-items: center; flex-wrap: nowrap; gap: 7px; width: max-content; min-width: max-content; }
.species-scroll { container-type: inline-size; }
.species-cell-label { display: none; }
.species-card-leaf, .species-action-name { display: none; }
.species-action-control { position: relative; display: inline-flex; flex-direction: column; align-items: center; }
.officer-layout.officer-layout.officer-layout .species-table .species-icon-action { width: 44px; height: 44px; min-height: 44px; min-width: 44px; padding: 0; display: inline-flex; align-items: center; justify-content: center; }
.species-icon-action svg { width: 18px; height: 18px; flex: none; }
.species-icon-action:focus-visible { outline: 3px solid #245443; outline-offset: 2px; }
.species-action-tooltip { position: absolute; bottom: calc(100% + 6px); right: 0; z-index: 3; width: max-content; max-width: 180px; padding: 6px 9px; border-radius: 6px; background: #173f34; color: #fff; font-size: 12px; line-height: 1.5; pointer-events: none; opacity: 0; visibility: hidden; white-space: normal; }
.species-action-control:hover .species-action-tooltip, .species-action-control:focus-within .species-action-tooltip { opacity: 1; visibility: visible; }
@media (hover: none) {
  .species-action-control { width: 44px; flex: 0 0 44px; }
  .species-action-tooltip { position: static; opacity: 1; visibility: visible; width: auto; max-width: 100%; padding: 4px 0 0; background: transparent; color: #245443; text-align: center; overflow-wrap: anywhere; }
}
@container (max-width: 767px) {
  .officer-layout .species-scroll .species-table { display: block; min-width: 0; width: 100%; }
  .species-table colgroup { display: none; }
  .species-table thead { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); }
  .species-table tbody { display: grid; gap: 16px; }
  .species-table tbody tr { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; padding: 16px; border: 1px solid #d7e0db; border-radius: 16px; background: #fff; }
  .officer-layout .species-scroll .species-table td { display: block; min-width: 0; padding: 0; border: 0; white-space: normal; }
  .officer-layout .species-scroll .species-table td.name-cell { overflow-wrap: anywhere; }
  .species-table td:nth-child(2), .species-table td:nth-child(3), .species-table .status-cell, .species-table .actions-cell, .species-table td[colspan] { grid-column: 1 / -1; }
  .officer-layout .species-scroll .species-table .status-cell .badge { white-space: normal; max-width: 100%; overflow-wrap: anywhere; }
  .species-cell-label { display: block; margin-bottom: 4px; font-size: 12px; line-height: 1.5; color: #426b56; font-weight: 600; }
  .species-table .actions-cell .species-cell-label { margin-bottom: 8px; }
  .species-table .species-action-control { width: 44px; flex: 0 0 44px; }
  .species-table .species-action-tooltip { position: static; opacity: 1; visibility: visible; width: auto; max-width: 100%; padding: 4px 0 0; background: transparent; color: #245443; text-align: center; overflow-wrap: anywhere; }
  .officer-layout .species-scroll .species-table td:first-child:not([colspan]) { position: relative; padding-left: 64px; font-weight: 700; color: #174c38; font-size: 18px; }
  .species-table td:first-child > .species-cell-label, .species-table td:nth-child(2) > .species-cell-label { display: none; }
  .species-card-leaf { position: absolute; left: 0; top: 0; display: grid; place-items: center; width: 48px; height: 48px; border-radius: 10px; background: #dcebd8; color: #245443; }
  .species-card-leaf svg { width: 32px; height: 32px; }
  .officer-layout .species-scroll .species-table td:nth-child(2) { margin-top: -6px; padding: 0 0 16px 64px; border-bottom: 1px solid #d7e0db; font-size: 16px; }
  .officer-layout .species-scroll .species-table td:nth-child(n+3):not(.actions-cell):not([colspan]) { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px; }
  .species-table td:nth-child(n+3):not(.actions-cell):not([colspan]) .species-cell-label { display: inline-flex; align-items: center; gap: 8px; margin: 0; font-size: 14px; font-weight: 600; }
  .species-card-field-icon { width: 18px; height: 18px; color: #245443; flex: none; }
  .officer-layout .species-scroll .species-table .actions-cell { margin-top: 4px; padding-top: 12px; border-top: 1px solid #d7e0db; }
  .species-table .actions-cell > .species-cell-label { display: none; }
  .officer-layout .species-scroll .species-table .action-group { display: flex; width: 100%; min-width: 0; gap: 0; }
  .species-table .species-action-control { width: auto; flex: 1 1 0; min-width: 0; padding-inline: 4px; }
  .species-table .species-action-control + .species-action-control { border-left: 1px solid #d7e0db; }
  .officer-layout.officer-layout.officer-layout .species-table .species-icon-action { width: 100%; height: auto; min-width: 0; border: 0; background: transparent; padding: 6px 0; gap: 6px; font-weight: 500; white-space: normal; }
  .species-action-name { display: inline; font-size: 13px; overflow-wrap: anywhere; }
  .species-table .species-action-tooltip { display: none; }
}
@media (max-width: 767px) {
  .officer-layout.officer-layout.officer-layout .species-table-panel { padding: 0; background: transparent; border: 0; box-shadow: none; }
  .species-controls { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  .species-controls > .field { min-width: 0; max-width: 100%; }
  .species-controls > .search-field, .species-controls > .field:nth-child(2), .species-controls > .create-species-button { grid-column: 1 / -1; }
  .species-controls > .create-species-button { justify-self: start; }
}

.dataset-note, .state-note { margin: 0; padding: 12px 16px; color: #64776e; font-size: 11px; }
.error-row { padding: 28px; text-align: center; color: #9b3d35; }
.error-row span { display: block; margin: 6px 0 12px; }
.state-note.error, .field-error { color: #a13f35; }
.state-note.warning, .warning { color: #8a6429; }
.form-grid { align-items: start; }
.validation-summary { flex-basis: 100%; margin: 0; color: #a13f35; font-size: 13px; font-weight: 600; }
.validation-summary:empty { position: absolute; width: 1px; height: 1px; clip-path: inset(50%); overflow: hidden; }
.form-grid :deep([aria-invalid="true"]) { border-color: #a13f35; }
.form-grid :deep(.validation-highlight) { border-radius: 8px; animation: validation-pulse 1.8s ease-out; }
.taxonomy-retry { justify-self: start; }
@keyframes validation-pulse { 0%, 30% { background-color: #fcecea; outline: 2px solid #c16b63; outline-offset: 5px; } 100% { background-color: transparent; outline: 2px solid transparent; outline-offset: 5px; } }
@media (prefers-reduced-motion: reduce) { .form-grid :deep(.validation-highlight) { animation: none; } }
.form-field { align-content: start; }
.form-grid .form-field > span,
.form-grid .form-field > label { display: block; margin: 0; font-size: 9px; line-height: 1.5; }
.form-grid .form-field > label > span { display: block; line-height: inherit; }
.form-grid .form-field > input,
.form-grid .form-field > select { height: 44px; min-height: 44px; line-height: 1.5; }
.form-field textarea { min-height: 90px; }
.form-grid input::placeholder, .form-grid textarea::placeholder { color: #64776e; opacity: 1; }
.field-error { font-size: 10px; font-weight: 700; }
.image-limitation { padding: 14px; border: 1px solid #d8e4dc; border-radius: 10px; background: #f7faf7; color: #5f746a; }
.image-limitation p { margin: 5px 0 0; font-size: 11px; }
.delete-confirmation { text-align: center; }
.delete-confirmation .modal-actions { justify-content: center; margin-top: 20px; }

/* Create Species form only: grouped panels mirror the NIAH form-card pattern. */
.species-create-modal :deep(.modal-card.wide) { display: flex; flex-direction: column; width: min(1140px, calc(100vw - 40px)); max-height: calc(100dvh - 40px); overflow: hidden; padding: 24px 28px 18px; }
.species-create-modal :deep(.modal-header) { flex: 0 0 auto; align-items: flex-start; margin-bottom: 16px; padding-bottom: 14px; border-bottom: 1px solid #d7e2dc; }
.species-create-modal :deep(.modal-header h2) { font-size: 24px; line-height: 1.25; }
.species-create-modal :deep(.modal-header p) { margin-top: 4px; color: #52685d; font-size: 14px; line-height: 1.45; }
.species-create-title { display: inline-flex; align-items: center; gap: 12px; color: #174c38; }
.species-create-title svg { width: 36px; height: 36px; padding: 8px; box-sizing: border-box; border-radius: 10px; background: #e6f1e5; color: #278442; }
.species-create-modal :deep(.modal-header > div > p) { margin-left: 48px; }
.species-create-form { display: flex; flex-direction: column; align-items: stretch; flex: 1 1 auto; min-height: 0; gap: 16px; overflow-y: auto; overscroll-behavior: contain; padding: 0 2px 2px 0; }
.create-form-section { display: contents; }
.create-form-section-title { display: none; }
.species-create-form .create-form-section { display: grid; align-self: stretch; width: 100%; box-sizing: border-box; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 18px; min-width: 0; padding: 0 18px 16px; border: 1px solid #e0e9e2; border-radius: 14px; background: #fff; box-shadow: 0 2px 8px #193d2b0b; }
.species-create-form .create-form-section-title { grid-column: 1 / -1; display: flex; align-items: center; gap: 10px; margin: 0 -18px 0; padding: 11px 18px; border-radius: 13px 13px 0 0; background: #e8f2e8; color: #174c38; font-size: 17px; line-height: 1.4; }
.create-form-section-title svg { width: 20px; height: 20px; flex: 0 0 20px; color: #26784a; }
.species-create-form .create-form-section .form-field { min-width: 0; }
.species-create-form .form-field.full { grid-column: 1 / -1; }
.species-create-form .form-field > span, .species-create-form .form-field > label { color: #173f34; font-size: 13px; font-weight: 700; }
.species-create-form .form-field > input, .species-create-form .form-field > select { font-size: 14px; }
.species-create-form .form-field textarea { min-height: 78px; font-size: 14px; }
.species-create-form .create-visibility-section { display: block; align-self: stretch; width: 100%; box-sizing: border-box; padding: 0 18px 14px; background: #fbfdfb; }
.species-create-form .create-visibility-section .visibility-selector-horizontal { display: block; margin: 0; padding: 0; background: transparent; }
.species-create-form :deep(.visibility-intro) { margin: 0 -18px 12px; padding: 10px 18px; border-radius: 13px 13px 0 0; background: #e8f2e8; }
.species-create-form :deep(.visibility-title) { font-size: 17px; }
.species-create-form :deep(.visibility-selector .visibility-intro p) { margin: 2px 0 0 28px; font-size: 13px; }
.species-create-form :deep(.visibility-options) { gap: 12px; }
.species-create-form :deep(.visibility-option) { min-height: 88px; padding: 13px 14px; border-radius: 12px; }
.species-create-form :deep(.visibility-option-heading) { font-size: 14px; }
.species-create-form :deep(.visibility-description) { font-size: 13px; line-height: 1.45; }
.species-create-form .create-photos-section { display: block; align-self: stretch; width: 100%; box-sizing: border-box; padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
.species-create-form .create-photos-section .species-photo-manager.embedded { border: 1px solid #e0e9e2; border-radius: 14px; background: #fff; box-shadow: 0 2px 8px #193d2b0b; overflow: hidden; }
.species-create-form .create-photos-section :deep(.photo-header) { padding: 12px 16px; border: 0; background: #e8f2e8; }
.species-create-form .create-photos-section :deep(.photo-header h2) { font-size: 17px; }
.species-create-form .create-photos-section :deep(.photo-header p) { margin-top: 2px; }
.species-create-form .create-photos-section :deep(.photo-body) { padding: 14px 16px; }
.species-create-form .modal-actions { align-self: stretch; width: 100%; box-sizing: border-box; position: sticky; bottom: 0; z-index: 1; flex: 0 0 auto; margin: 0; padding: 12px 0 2px; border-top: 1px solid #d7e2dc; background: #fff; }
.species-create-form .validation-summary { margin-right: auto; }
@media (max-width: 700px) {
  .species-create-modal :deep(.modal-card.wide) { width: calc(100vw - 20px); max-height: calc(100dvh - 20px); padding: 16px; }
  .species-create-modal :deep(.modal-header h2) { font-size: 21px; }
  .species-create-form .create-form-section { grid-template-columns: minmax(0, 1fr); gap: 11px; padding-inline: 14px; }
  .species-create-form .create-form-section-title { margin-inline: -14px; padding-inline: 14px; }
  .species-create-form .create-visibility-section { padding-inline: 14px; }
  .species-create-form :deep(.visibility-intro) { margin-inline: -14px; padding-inline: 14px; }
  .species-create-form .create-photos-section { padding-inline: 0; }
}
@media (max-width: 420px) {
  .species-create-modal :deep(.modal-card.wide) { width: calc(100vw - 12px); max-height: calc(100dvh - 12px); padding: 12px; }
  .species-create-title { gap: 8px; }
  .species-create-title svg { width: 32px; height: 32px; }
  .species-create-modal :deep(.modal-header > div > p) { margin-left: 40px; }
  .species-create-form :deep(.visibility-options) { grid-template-columns: minmax(0, 1fr); }
  .species-create-form :deep(.visibility-option) { min-height: 0; }
}
</style>
