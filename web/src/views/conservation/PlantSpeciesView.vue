<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import ActionFeedback from '../../components/ActionFeedback.vue'
import AppModal from '../../components/conservation/AppModal.vue'
import {
  mapManagedSpecies,
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
  culturalSignificance: '',
})
const form = reactive<SpeciesForm>(blankForm())
const formErrors = ref<Partial<Record<keyof SpeciesForm, string>>>({})
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
    culturalSignificance: item.culturalSignificance,
  } : blankForm())
  formErrors.value = {}
  mutationError.value = ''
}
function openCreate() {
  detailRequest++
  editing.value = false
  selected.value = null
  assignForm()
  modal.value = 'form'
}
async function loadForModal(item: ManagedSpecies, mode: 'view' | 'form') {
  const requestId = ++detailRequest
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
  if (mutation.value) return
  formErrors.value = validateSpeciesForm(form, taxonomy.value, knownStatuses.value)
  if (Object.keys(formErrors.value).length) return
  mutation.value = editing.value ? 'update' : 'create'
  mutationError.value = ''
  let committed = false
  try {
    const payload = speciesPayload(form)
    const result = editing.value && selected.value
      ? await requestSpeciesApi(`/api/species/${encodeURIComponent(selected.value.id)}`, { method: 'PATCH', body: payload })
      : await requestSpeciesApi('/api/species', { method: 'POST', body: payload })
    committed = true
    const id = editing.value && selected.value ? selected.value.id : String(result.species_id ?? '')
    if (editing.value ? result.updated !== true : !id) throw new Error(st('errors.invalidResponse'))
    await fetchSpeciesDetail(id)
    await fetchSpeciesList()
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
    <button class="primary-button" type="button" @click="openCreate">+ {{ st('createSpecies') }}</button>
  </div>

  <section class="panel">
    <p v-if="!isLoading && !loadError" class="dataset-note">{{ st('loadedLimit') }}<span v-if="skippedRecords"> · {{ st('skipped', { count: skippedRecords }) }}</span></p>
    <div class="table-scroll"><table><thead><tr><th>{{ st('speciesId') }}</th><th>{{ st('scientificName') }}</th><th>{{ st('commonName') }}</th><th>{{ st('genus') }}</th><th>{{ st('family') }}</th><th>{{ st('conservationStatus') }}</th><th>{{ st('visibility') }}</th><th>{{ st('actions') }}</th></tr></thead><tbody>
      <tr v-for="item in filtered" :key="item.id"><td><strong>{{ item.id }}</strong></td><td><em>{{ item.scientificName || st('unavailable') }}</em></td><td>{{ item.commonName || st('unavailable') }}</td><td>{{ item.genus || st('unavailable') }}</td><td>{{ item.family || st('unavailable') }}</td><td>{{ item.conservationStatus || st('unavailable') }}</td><td><span class="badge">{{ visibilityLabel(item.visibility) }}</span></td><td><div class="action-group"><button class="action-button" @click="view(item)">{{ st('view') }}</button><button class="action-button" @click="openEdit(item)">{{ st('editSpecies') }}</button><button class="action-button danger" @click="confirmDelete(item)">{{ st('deleteSpecies') }}</button></div></td></tr>
      <tr v-if="isLoading"><td colspan="8" class="empty-row">{{ st('loading') }}</td></tr>
      <tr v-else-if="loadError"><td colspan="8" class="error-row"><strong>{{ st('loadFailed') }}</strong><span>{{ loadError }}</span><button class="action-button" @click="loadSpecies">{{ st('retry') }}</button></td></tr>
      <tr v-else-if="!filtered.length"><td colspan="8" class="empty-row">{{ species.length ? st('noMatches') : st('empty') }}</td></tr>
    </tbody></table></div>
  </section>

  <AppModal v-if="modal === 'form'" :title="editing ? st('editSpecies') : st('createSpecies')" :subtitle="st('formSubtitle')" wide @close="!mutation && (modal = null)">
    <p v-if="detailLoading" class="state-note">{{ st('loadingDetail') }}</p>
    <p v-if="taxonomyError" class="state-note warning">{{ st('taxonomyUnavailable') }} {{ taxonomyError }}</p>
    <p v-if="mutationError" class="state-note error">{{ mutationError }}</p>
    <form class="form-grid" novalidate @submit.prevent="save">
      <label class="form-field"><span>{{ st('scientificName') }} *</span><input v-model="form.scientificName" :disabled="detailLoading || Boolean(mutation)" /><small v-if="formErrors.scientificName" class="field-error">{{ formErrors.scientificName }}</small></label>
      <label class="form-field"><span>{{ st('commonName') }} *</span><input v-model="form.commonName" :disabled="detailLoading || Boolean(mutation)" /><small v-if="formErrors.commonName" class="field-error">{{ formErrors.commonName }}</small></label>
      <label class="form-field"><span>{{ st('genus') }}</span><select v-model="form.genusId" :disabled="detailLoading || Boolean(mutation) || Boolean(taxonomyError)"><option value="">{{ st('noGenus') }}</option><option v-for="item in taxonomy" :key="item.id" :value="item.id">{{ item.name }}</option></select><small v-if="formErrors.genusId" class="field-error">{{ formErrors.genusId }}</small></label>
      <label class="form-field"><span>{{ st('familyDerived') }}</span><input :value="selectedGenus?.family || st('unavailable')" readonly class="readonly-field" /></label>
      <label class="form-field"><span>{{ st('conservationStatus') }}</span><select v-model="form.conservationStatus" :disabled="detailLoading || Boolean(mutation)"><option value="">{{ st('noConservationStatus') }}</option><option v-for="item in knownStatuses" :key="item" :value="item">{{ item }}</option></select><small v-if="formErrors.conservationStatus" class="field-error">{{ formErrors.conservationStatus }}</small></label>
      <label class="form-field"><span>{{ st('visibility') }} *</span><select v-model="form.visibility" :disabled="detailLoading || Boolean(mutation)"><option v-for="item in visibilities" :key="item" :value="item">{{ visibilityLabel(item) }}</option></select><small v-if="formErrors.visibility" class="field-error">{{ formErrors.visibility }}</small></label>
      <label class="form-field full"><span>{{ st('description') }} *</span><textarea v-model="form.description" :disabled="detailLoading || Boolean(mutation)"></textarea><small v-if="formErrors.description" class="field-error">{{ formErrors.description }}</small></label>
      <label class="form-field full"><span>{{ st('habitat') }}</span><textarea v-model="form.habitat" maxlength="4000" :disabled="detailLoading || Boolean(mutation)"></textarea><small v-if="formErrors.habitat" class="field-error">{{ formErrors.habitat }}</small></label>
      <label class="form-field full"><span>{{ st('culturalSignificance') }}</span><textarea v-model="form.culturalSignificance" maxlength="4000" :disabled="detailLoading || Boolean(mutation)"></textarea><small v-if="formErrors.culturalSignificance" class="field-error">{{ formErrors.culturalSignificance }}</small></label>
      <div class="form-field full image-limitation"><strong>{{ st('speciesImages') }}</strong><p>{{ st('imageLimitation') }}</p></div>
      <div class="modal-actions form-field full"><button type="button" class="secondary-button" :disabled="Boolean(mutation)" @click="modal = null">{{ st('cancel') }}</button><button class="primary-button" :disabled="detailLoading || Boolean(mutation)">{{ mutation ? st('saving') : st('save') }}</button></div>
    </form>
  </AppModal>

  <AppModal v-if="modal === 'view' && selected" :title="selected.scientificName" :subtitle="selected.commonName" @close="modal = null">
    <p v-if="detailLoading" class="state-note">{{ st('loadingDetail') }}</p><p v-if="mutationError" class="state-note error">{{ mutationError }}</p>
    <dl class="detail-list"><div><dt>{{ st('speciesId') }}</dt><dd>{{ selected.id }}</dd></div><div><dt>{{ st('genus') }}</dt><dd>{{ selected.genus || st('unavailable') }}</dd></div><div><dt>{{ st('family') }}</dt><dd>{{ selected.family || st('unavailable') }}</dd></div><div><dt>{{ st('conservationStatus') }}</dt><dd>{{ selected.conservationStatus || st('unavailable') }}</dd></div><div><dt>{{ st('visibility') }}</dt><dd>{{ visibilityLabel(selected.visibility) }}</dd></div><div><dt>{{ st('habitat') }}</dt><dd>{{ selected.habitat || st('unavailable') }}</dd></div><div><dt>{{ st('culturalSignificance') }}</dt><dd>{{ selected.culturalSignificance || st('unavailable') }}</dd></div><div><dt>{{ st('description') }}</dt><dd>{{ selected.description || st('unavailable') }}</dd></div></dl>
  </AppModal>

  <AppModal v-if="modal === 'delete' && selected" :title="st('deleteConfirmTitle')" :subtitle="`${selected.id} — ${selected.scientificName}`" :close-on-backdrop="false" danger-backdrop hide-close compact @close="!mutation && (modal = null)">
    <div class="delete-confirmation"><p>{{ st('deleteConfirmation') }}</p><p class="warning">{{ st('deleteReferenceWarning') }}</p><p v-if="mutationError" class="state-note error">{{ mutationError }}</p><div class="modal-actions"><button ref="deleteCancelButton" class="secondary-button" :disabled="Boolean(mutation)" @click="modal = null">{{ st('cancel') }}</button><button class="danger-button" :disabled="Boolean(mutation)" @click="remove">{{ mutation === 'delete' ? st('deleting') : st('deleteSpecies') }}</button></div></div>
  </AppModal>
</template>

<style scoped>
.dataset-note, .state-note { margin: 0; padding: 12px 16px; color: #64776e; font-size: 11px; }
.error-row { padding: 28px; text-align: center; color: #9b3d35; }
.error-row span { display: block; margin: 6px 0 12px; }
.state-note.error, .field-error { color: #a13f35; }
.state-note.warning, .warning { color: #8a6429; }
.form-grid { align-items: start; }
.form-field { align-content: start; }
.form-field textarea { min-height: 90px; }
.field-error { font-size: 10px; font-weight: 700; }
.image-limitation { padding: 14px; border: 1px solid #d8e4dc; border-radius: 10px; background: #f7faf7; color: #5f746a; }
.image-limitation p { margin: 5px 0 0; font-size: 11px; }
.delete-confirmation { text-align: center; }
.delete-confirmation .modal-actions { justify-content: center; margin-top: 20px; }
</style>
