<script setup lang="ts">
import VisibilitySelector from '../../components/conservation/VisibilitySelector.vue'
import { computed, nextTick, onMounted, onScopeDispose, reactive, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import ActionFeedback from '../../components/ActionFeedback.vue'
import AppModal from '../../components/conservation/AppModal.vue'
import SpeciesPhotoManager from '../../components/conservation/SpeciesPhotoManager.vue'
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
const mutationError = ref('')
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
})
const form = reactive<SpeciesForm>(blankForm())
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
const errorMessage = (error: unknown, fallback: string) =>
  typeof error === 'object' && error !== null && 'message' in error &&
  typeof error.message === 'string' && error.message.trim()
    ? error.message
    : fallback
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
  } : blankForm())
  resetValidation()
  mutationError.value = ''
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
    if (mode === 'form') assignForm(detail)
  } catch (error) {
    if (requestId === detailRequest) mutationError.value = errorMessage(error, st('errors.detail'))
  } finally {
    if (requestId === detailRequest) detailLoading.value = false
  }
}
const view = (item: ManagedSpecies) => loadForModal(item, 'view')
const openEdit = (item: ManagedSpecies) => loadForModal(item, 'form')

async function save() {
  if (mutation.value || detailLoading.value) return
  validationAttempted.value = true
  formErrors.value = currentFormErrors()
  if (invalidFields.value.length) { await focusFirstInvalid(); return }
  clearValidationHighlight()
  mutation.value = editing.value ? 'update' : 'create'
  mutationError.value = ''
  let committed = false
  try {
    const payload = speciesPayload(form)
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
    const message = errorMessage(error, st('errors.save'))
    mutationError.value = committed ? st('errors.savedRefresh', { message }) : message
  } finally { mutation.value = null }
}

function confirmDelete(item: ManagedSpecies) {
  detailRequest++
  selected.value = item
  mutationError.value = ''
  modal.value = 'delete'
  void nextTick(() => deleteCancelButton.value?.focus())
}
async function remove() {
  if (!selected.value || mutation.value) return
  mutation.value = 'delete'
  mutationError.value = ''
  let committed = false
  try {
    const result = await requestSpeciesApi(`/api/species/${encodeURIComponent(selected.value.id)}`, { method: 'DELETE' })
    committed = true
    if (result.deleted !== true) throw new Error(st('errors.invalidResponse'))
    await fetchSpeciesList()
    modal.value = null
    showFeedback('success', st('feedback.deleted'))
  } catch (error) {
    const message = errorMessage(error, st('errors.delete'))
    mutationError.value = committed ? st('errors.deletedRefresh', { message }) : message
  } finally { mutation.value = null }
}

onMounted(async () => {
  await Promise.all([loadSpecies(), loadTaxonomy()])
  if (route.query.action === 'add') openCreate()
})
</script>

<template>
  <ActionFeedback v-if="feedback" :key="feedback.id" :feedback-id="feedback.id" :variant="feedback.variant" :message="feedback.message" @dismiss="dismissFeedback" />
  <section class="page-intro"><div><p class="page-kicker">{{ st('knowledgeBase') }}</p><h2>{{ st('title') }}</h2><p>{{ st('intro') }}</p></div></section>
  <div class="control-bar">
    <label class="field search-field"><span>{{ st('searchSpecies') }}</span><input v-model.trim="search" maxlength="100" :placeholder="st('searchPlaceholder')" /></label>
    <label class="field"><span>{{ st('family') }}</span><select v-model="familyFilter"><option value="">{{ st('allFamilies') }}</option><option v-for="item in families" :key="item" :value="item">{{ item }}</option></select></label>
    <label class="field"><span>{{ st('conservationStatus') }}</span><select v-model="statusFilter"><option value="">{{ st('allStatuses') }}</option><option v-for="item in knownStatuses" :key="item" :value="item">{{ item }}</option></select></label>
    <label class="field"><span>{{ st('visibility') }}</span><select v-model="visibilityFilter"><option value="">{{ st('allVisibility') }}</option><option v-for="item in visibilities" :key="item" :value="item">{{ visibilityLabel(item) }}</option></select></label>
    <button class="primary-button create-species-button" type="button" @click="openCreate">+ {{ st('createSpecies') }}</button>
  </div>

  <section class="panel">
    <p v-if="!isLoading && !loadError && skippedRecords" class="dataset-note" role="status">{{ st('skipped', { count: skippedRecords }) }}</p>
    <div class="table-scroll species-scroll" role="region" :aria-label="st('title')" :aria-description="st('loadedLimit')" tabindex="0">
      <table class="species-table">
        <colgroup>
          <col class="species-id-column" /><col class="scientific-column" /><col class="common-column" /><col class="genus-column" /><col class="family-column" /><col class="status-column" /><col class="visibility-column" /><col class="actions-column" />
        </colgroup>
        <thead><tr>
          <th scope="col">{{ st('speciesId') }}</th><th scope="col">{{ st('scientificName') }}</th><th scope="col">{{ st('commonName') }}</th><th scope="col">{{ st('genus') }}</th><th scope="col">{{ st('family') }}</th><th scope="col">{{ st('conservationStatus') }}</th><th scope="col">{{ st('visibility') }}</th><th scope="col">{{ st('actions') }}</th>
        </tr></thead>
        <tbody>
          <tr v-for="item in filtered" :key="item.id">
            <td><strong>{{ item.id }}</strong></td>
            <td class="name-cell"><em>{{ item.scientificName || st('unavailable') }}</em></td>
            <td class="name-cell">{{ item.commonName || st('unavailable') }}</td>
            <td class="name-cell">{{ item.genus || st('unavailable') }}</td>
            <td class="name-cell">{{ item.family || st('unavailable') }}</td>
            <td class="status-cell"><span class="badge conservation-status" :style="conservationBadgeStyle(item.conservationStatus)">{{ item.conservationStatus || st('unavailable') }}</span></td>
            <td><span class="badge">{{ visibilityLabel(item.visibility) }}</span></td>
            <td class="actions-cell"><div class="action-group"><button class="action-button" @click="view(item)">{{ st('view') }}</button><button class="action-button" @click="openEdit(item)">{{ st('editSpecies') }}</button><button class="action-button danger" @click="confirmDelete(item)">{{ st('deleteSpecies') }}</button></div></td>
          </tr>
          <tr v-if="isLoading"><td colspan="8" class="empty-row">{{ st('loading') }}</td></tr>
          <tr v-else-if="loadError"><td colspan="8" class="error-row"><strong>{{ st('loadFailed') }}</strong><span>{{ loadError }}</span><button class="action-button" @click="loadSpecies">{{ st('retry') }}</button></td></tr>
          <tr v-else-if="!filtered.length"><td colspan="8" class="empty-row">{{ species.length ? st('noMatches') : st('empty') }}</td></tr>
        </tbody>
      </table>
    </div>
  </section>



  <AppModal v-if="modal === 'form'" :title="editing ? st('editSpecies') : st('createSpecies')" :subtitle="st('formSubtitle')" wide accessible @close="!mutation && (modal = null)">
    <p v-if="detailLoading" class="state-note">{{ st('loadingDetail') }}</p>
    <p v-if="taxonomyError" class="state-note warning">{{ st('taxonomyUnavailable') }} {{ taxonomyError }}</p>
    <p v-if="mutationError" class="state-note error">{{ mutationError }}</p>
    <form ref="speciesForm" class="form-grid" novalidate @submit.prevent="save">
      <label class="form-field"><span>{{ st('scientificName') }} *</span><input v-model="form.scientificName" :placeholder="st('placeholders.scientificName')" data-validation-field="scientificName" aria-required="true" :aria-invalid="Boolean(formErrors.scientificName)" :aria-describedby="formErrors.scientificName ? 'species-scientificName-error' : undefined" :disabled="detailLoading || Boolean(mutation)" /><small id="species-scientificName-error" v-if="formErrors.scientificName" class="field-error">{{ formErrors.scientificName }}</small></label>
      <label class="form-field"><span>{{ st('commonName') }} *</span><input v-model="form.commonName" :placeholder="st('placeholders.commonName')" data-validation-field="commonName" aria-required="true" :aria-invalid="Boolean(formErrors.commonName)" :aria-describedby="formErrors.commonName ? 'species-commonName-error' : undefined" :disabled="detailLoading || Boolean(mutation)" /><small id="species-commonName-error" v-if="formErrors.commonName" class="field-error">{{ formErrors.commonName }}</small></label>
      <div class="form-field" data-validation-group><label for="species-genus-input"><span>{{ st('genus') }}</span></label><select id="species-genus-input" v-model="form.genusId" :title="st('placeholders.genus')" :aria-description="st('placeholders.genus')" data-validation-field="genusId" :aria-invalid="Boolean(formErrors.genusId)" :aria-describedby="formErrors.genusId ? 'species-genusId-error' : undefined" :disabled="detailLoading || Boolean(mutation) || Boolean(taxonomyError)"><option value="">{{ st('noGenus') }}</option><option v-for="item in taxonomy" :key="item.id" :value="item.id">{{ item.name }}</option></select><button v-if="taxonomyError" type="button" class="secondary-button taxonomy-retry" :disabled="detailLoading || Boolean(mutation)" :aria-describedby="formErrors.genusId ? 'species-genusId-error' : undefined" data-validation-focus @click="loadTaxonomy">{{ st('retry') }}</button><small id="species-genusId-error" v-if="formErrors.genusId" class="field-error">{{ formErrors.genusId }}</small></div>
      <label class="form-field"><span>{{ st('familyDerived') }}</span><input :value="selectedGenus?.family || ''" :placeholder="st('placeholders.family')" readonly class="readonly-field" /></label>
      <label class="form-field"><span>{{ st('conservationStatus') }}</span><select v-model="form.conservationStatus" :title="st('placeholders.conservationStatus')" :aria-description="st('placeholders.conservationStatus')" data-validation-field="conservationStatus" :aria-invalid="Boolean(formErrors.conservationStatus)" :aria-describedby="formErrors.conservationStatus ? 'species-conservationStatus-error' : undefined" :disabled="detailLoading || Boolean(mutation)"><option value="">{{ st('noConservationStatus') }}</option><option v-for="item in knownStatuses" :key="item" :value="item">{{ item }}</option></select><small id="species-conservationStatus-error" v-if="formErrors.conservationStatus" class="field-error">{{ formErrors.conservationStatus }}</small></label>
      <label v-if="editing" class="form-field"><span>{{ st('visibility') }} *</span><select v-model="form.visibility" :title="st('placeholders.visibility')" :aria-description="st('placeholders.visibility')" data-validation-field="visibility" aria-required="true" :aria-invalid="Boolean(formErrors.visibility)" :aria-describedby="formErrors.visibility ? 'species-visibility-error' : undefined" :disabled="detailLoading || Boolean(mutation)"><option value="" disabled>{{ st('placeholders.visibility') }}</option><option v-for="item in visibilities" :key="item" :value="item">{{ visibilityLabel(item) }}</option></select><small id="species-visibility-error" v-if="formErrors.visibility" class="field-error">{{ formErrors.visibility }}</small></label>
      <VisibilitySelector v-else id="species-visibility" class="create-species-visibility" v-model="form.visibility" validation-field="visibility" horizontal required :invalid="Boolean(formErrors.visibility)" :error="formErrors.visibility" :disabled="detailLoading || Boolean(mutation)" />
      <label class="form-field full"><span>{{ st('description') }} *</span><textarea v-model="form.description" :placeholder="st('placeholders.description')" data-validation-field="description" aria-required="true" :aria-invalid="Boolean(formErrors.description)" :aria-describedby="formErrors.description ? 'species-description-error' : undefined" :disabled="detailLoading || Boolean(mutation)"></textarea><small id="species-description-error" v-if="formErrors.description" class="field-error">{{ formErrors.description }}</small></label>
      <label class="form-field full"><span>{{ st('habitat') }}</span><textarea v-model="form.habitat" :placeholder="st('placeholders.habitat')" data-validation-field="habitat" :aria-invalid="Boolean(formErrors.habitat)" :aria-describedby="formErrors.habitat ? 'species-habitat-error' : undefined" maxlength="4000" :disabled="detailLoading || Boolean(mutation)"></textarea><small id="species-habitat-error" v-if="formErrors.habitat" class="field-error">{{ formErrors.habitat }}</small></label>
      <SpeciesPhotoManager v-if="canManagePhotos && !detailLoading" ref="photoEditor" class="form-field full" embedded :species="editing ? selected : null" :busy="Boolean(mutation)" @retry="save" />
      <p v-if="photoSaveNotice" class="form-field full state-note warning" role="status">{{ photoSaveNotice }}</p>
      <div class="modal-actions form-field full"><p class="validation-summary" role="status" aria-live="polite" aria-atomic="true">{{ validationAttempted && invalidFields.length ? st('validationSummary', { count: invalidFields.length }) : '' }}</p><button type="button" class="secondary-button" :disabled="Boolean(mutation)" @click="modal = null">{{ st('cancel') }}</button><button class="primary-button" :disabled="detailLoading || Boolean(mutation)">{{ mutation ? st('saving') : st('save') }}</button></div>
    </form>
  </AppModal>

  <AppModal v-if="modal === 'view' && selected" :title="selected.scientificName" :subtitle="selected.commonName" @close="modal = null">
    <p v-if="detailLoading" class="state-note">{{ st('loadingDetail') }}</p><p v-if="mutationError" class="state-note error">{{ mutationError }}</p>
    <dl class="detail-list"><div><dt>{{ st('speciesId') }}</dt><dd>{{ selected.id }}</dd></div><div><dt>{{ st('genus') }}</dt><dd>{{ selected.genus || st('unavailable') }}</dd></div><div><dt>{{ st('family') }}</dt><dd>{{ selected.family || st('unavailable') }}</dd></div><div><dt>{{ st('conservationStatus') }}</dt><dd><span class="badge conservation-status" :style="conservationBadgeStyle(selected.conservationStatus)">{{ selected.conservationStatus || st('unavailable') }}</span></dd></div><div><dt>{{ st('visibility') }}</dt><dd>{{ visibilityLabel(selected.visibility) }}</dd></div><div><dt>{{ st('habitat') }}</dt><dd>{{ selected.habitat || st('unavailable') }}</dd></div><div><dt>{{ st('culturalSignificance') }}</dt><dd>{{ selected.culturalSignificance || st('unavailable') }}</dd></div><div><dt>{{ st('description') }}</dt><dd>{{ selected.description || st('unavailable') }}</dd></div></dl>
  </AppModal>

  <AppModal v-if="modal === 'delete' && selected" :title="st('deleteConfirmTitle')" :subtitle="`${selected.id} — ${selected.scientificName}`" :close-on-backdrop="false" danger-backdrop hide-close compact @close="!mutation && (modal = null)">
    <div class="delete-confirmation"><p>{{ st('deleteConfirmation') }}</p><p class="warning">{{ st('deleteReferenceWarning') }}</p><p v-if="mutationError" class="state-note error">{{ mutationError }}</p><div class="modal-actions"><button ref="deleteCancelButton" class="secondary-button" :disabled="Boolean(mutation)" @click="modal = null">{{ st('cancel') }}</button><button class="danger-button" :disabled="Boolean(mutation)" @click="remove">{{ mutation === 'delete' ? st('deleting') : st('deleteSpecies') }}</button></div></div>
  </AppModal>
</template>

<style scoped>
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
.officer-layout .species-scroll .species-table { width: 100%; min-width: 88rem; table-layout: auto; border-collapse: separate; border-spacing: 0; }
.species-table .species-id-column { width: 7rem; }
.species-table .scientific-column { width: 16rem; }
.species-table .common-column { width: 15rem; }
.species-table .genus-column { width: 10rem; }
.species-table .family-column { width: 11rem; }
.species-table .status-column { width: 13rem; }
.species-table .visibility-column { width: 9rem; }
.species-table .actions-column { width: 1%; }
.officer-layout .species-scroll .species-table th, .officer-layout .species-scroll .species-table td { padding: 12px 14px; text-align: left; vertical-align: middle; }
.officer-layout .species-scroll .species-table th { background: #245443; color: #fff; border-bottom-color: #245443; font-size: var(--officer-small, .75rem); font-weight: 700; text-transform: uppercase; letter-spacing: .6px; line-height: 1.5; }
.species-table thead th:first-child { border-top-left-radius: 10px; }
.species-table thead th:last-child { border-top-right-radius: 10px; }
.officer-layout .species-scroll .species-table td { font-size: var(--officer-text, .875rem); line-height: 1.5; }
.officer-layout .species-scroll .species-table td.name-cell { white-space: normal; overflow-wrap: normal; word-break: normal; }
.officer-layout .species-scroll .species-table .status-cell, .officer-layout .species-scroll .species-table .actions-cell { white-space: nowrap; }
.officer-layout .species-scroll .species-table .action-group { display: flex; align-items: center; flex-wrap: nowrap; gap: 7px; width: max-content; min-width: max-content; }

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
.form-grid > .form-field > span,
.form-grid > .form-field > label { display: block; margin: 0; font-size: 9px; line-height: 1.5; }
.form-grid > .form-field > label > span { display: block; line-height: inherit; }
.form-grid > .form-field > input,
.form-grid > .form-field > select { height: 44px; min-height: 44px; line-height: 1.5; }
.form-field textarea { min-height: 90px; }
.form-grid input::placeholder, .form-grid textarea::placeholder { color: #64776e; opacity: 1; }
.field-error { font-size: 10px; font-weight: 700; }
.image-limitation { padding: 14px; border: 1px solid #d8e4dc; border-radius: 10px; background: #f7faf7; color: #5f746a; }
.image-limitation p { margin: 5px 0 0; font-size: 11px; }
.delete-confirmation { text-align: center; }
.delete-confirmation .modal-actions { justify-content: center; margin-top: 20px; }
</style>
