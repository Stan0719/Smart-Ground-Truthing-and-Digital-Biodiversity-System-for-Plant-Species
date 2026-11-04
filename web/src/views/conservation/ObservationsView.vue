<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppModal from '../../components/conservation/AppModal.vue'
import { formatPlantId } from '../../utils/plantId'

interface ObservationAsset { id: string; contentType: string }
interface ObservationView {
  id: string
  plantRawId: string
  plantDisplayId: string
  plantRouteId: string
  ownerSubject: string
  status: string
  revision: number | null
  createdAt: string
  updatedAt: string
  speciesId: string
  scientificName: string
  commonName: string
  height: string
  lifeStage: string
  healthStatus: string
  morphology: string
  notes: string
  latitude: string
  longitude: string
  gpsAccuracy: string
  taxonomy: Record<string, string>
  reviewComment: string
  reviewDecision: string
  reviewedAt: string
  assets: ObservationAsset[]
  hasSpeciesRequest: boolean
}

const { t, te, locale } = useI18n()
const observations = ref<ObservationView[]>([])
const isLoading = ref(true)
const loadError = ref('')
const skippedRecords = ref(0)
const selected = ref<ObservationView | null>(null)
const detailLoading = ref(false)
const detailError = ref('')
const historyModal = ref(false)
const failedAssets = ref(new Set<string>())
const search = ref('')
const status = ref('')
const species = ref('')
const owner = ref('')
const date = ref('')
let detailRequest = 0
let disposed = false

const supportedStatuses = ['Draft', 'Pending Review', 'Approved', 'Rejected', 'Correction Required', 'Flagged']
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const stringValue = (value: unknown) =>
  typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) ? String(value) : ''
const numericValue = (value: unknown, min = -Infinity, max = Infinity) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? String(value) : ''
const canonicalStatus = (value: unknown) => {
  const raw = stringValue(value).trim()
  const normalized = raw.toLowerCase().replace(/[_-]+/g, ' ')
  return supportedStatuses.find((item) => item.toLowerCase() === normalized) || raw
}
const keyFor = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '')
const label = (value: string | undefined) => {
  if (!value) return '—'
  const key = `conservationPages.observations.values.${keyFor(value)}`
  const shared = `dashboardValues.${keyFor(value)}`
  return te(key) ? t(key) : te(shared) ? t(shared) : value
}
const textOrUnavailable = (value: string) => value || '—'
const speciesName = (item: ObservationView) =>
  item.scientificName || item.commonName || t('conservationPages.observations.unconfirmedSpecies')
const dateKey = (value: string) => {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`
}
const timestamp = (value: string) => {
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
}
const formatDate = (value: string) => {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return new Intl.DateTimeFormat(locale.value === 'ms' ? 'ms-MY' : locale.value, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(parsed)
}

const mapObservation = (value: unknown): ObservationView | null => {
  const item = record(value)
  if (!item) return null
  const id = stringValue(item.id).trim()
  const plantRawId = stringValue(item.plant_id).trim()
  const content = record(item.content)
  if (!id || !plantRawId || !content) return null
  const formattedPlantId = formatPlantId(plantRawId)
  const taxonomyRecord = record(content.taxonomy)
  const taxonomy = taxonomyRecord ? Object.fromEntries(
    Object.entries(taxonomyRecord).flatMap(([key, entry]) => {
      const text = stringValue(entry)
      return text ? [[key, text]] : []
    }),
  ) : {}
  const height = numericValue(content.heightCm, 0)
  return {
    id,
    plantRawId,
    plantDisplayId: formattedPlantId || plantRawId,
    plantRouteId: formattedPlantId || '',
    ownerSubject: stringValue(item.owner_subject),
    status: canonicalStatus(item.status),
    revision: typeof item.revision === 'number' && Number.isSafeInteger(item.revision) && item.revision >= 0 ? item.revision : null,
    createdAt: stringValue(item.created_at),
    updatedAt: stringValue(item.updated_at),
    speciesId: stringValue(item.species_id),
    scientificName: stringValue(item.scientific_name),
    commonName: stringValue(item.common_name),
    height: height ? `${height} cm` : '',
    lifeStage: stringValue(content.lifeStage),
    healthStatus: stringValue(content.healthStatus),
    morphology: stringValue(content.morphology),
    notes: stringValue(content.notes),
    latitude: numericValue(content.latitude, -90, 90),
    longitude: numericValue(content.longitude, -180, 180),
    gpsAccuracy: numericValue(content.accuracy_m, 0),
    taxonomy,
    reviewComment: stringValue(item.review_comment),
    reviewDecision: canonicalStatus(item.review_decision),
    reviewedAt: stringValue(item.reviewed_at),
    assets: Array.isArray(item.assets) ? item.assets.flatMap((entry) => {
      const asset = record(entry)
      const assetId = stringValue(asset?.id).trim()
      return assetId ? [{ id: assetId, contentType: stringValue(asset?.content_type) || 'application/octet-stream' }] : []
    }) : [],
    hasSpeciesRequest: Boolean(stringValue(item.species_request_id) || record(item.species_request)),
  }
}

class ObservationApiError extends Error {
  constructor(message: string, readonly status = 0) { super(message) }
}
async function request(url: string): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetch(url, { credentials: 'same-origin', signal: AbortSignal.timeout(15000) })
  } catch {
    throw new ObservationApiError(t('conservationPages.observations.errors.network'))
  }
  let result: Record<string, unknown> | null
  try { result = record(await response.json()) }
  catch { throw new ObservationApiError(t('conservationPages.observations.errors.invalidResponse'), response.status) }
  if (!response.ok) {
    const backendMessage = [result?.message, result?.error].find(
      (value): value is string => typeof value === 'string' && Boolean(value.trim()),
    )
    const fallback = response.status === 401
      ? t('conservationPages.observations.errors.unauthorized')
      : response.status === 403
        ? t('conservationPages.observations.errors.forbidden')
        : response.status === 404
          ? t('conservationPages.observations.errors.notFound')
          : t('conservationPages.observations.errors.requestFailed', { status: response.status })
    throw new ObservationApiError(backendMessage || fallback, response.status)
  }
  if (!result) throw new ObservationApiError(t('conservationPages.observations.errors.invalidResponse'))
  return result
}

async function loadObservations() {
  isLoading.value = true
  loadError.value = ''
  skippedRecords.value = 0
  try {
    const result = await request('/api/observations')
    if (!Array.isArray(result.observations)) throw new ObservationApiError(t('conservationPages.observations.errors.invalidResponse'))
    const mapped = result.observations.map(mapObservation)
    skippedRecords.value = mapped.filter((item) => item === null).length
    observations.value = mapped.filter((item): item is ObservationView => item !== null)
      .sort((a, b) => timestamp(b.createdAt) - timestamp(a.createdAt))
  } catch (error) {
    observations.value = []
    loadError.value = error instanceof Error ? error.message : t('conservationPages.observations.errors.invalidResponse')
  } finally { isLoading.value = false }
}

async function open(item: ObservationView) {
  const requestId = ++detailRequest
  selected.value = item
  historyModal.value = false
  detailLoading.value = true
  detailError.value = ''
  failedAssets.value = new Set()
  try {
    const result = await request(`/api/observations/${encodeURIComponent(item.id)}`)
    const mapped = mapObservation(result.observation)
    if (!mapped) throw new ObservationApiError(t('conservationPages.observations.errors.invalidResponse'))
    if (!disposed && requestId === detailRequest && selected.value?.id === item.id) {
      selected.value = mapped
      const index = observations.value.findIndex((entry) => entry.id === mapped.id)
      if (index >= 0) observations.value[index] = mapped
    }
  } catch (error) {
    if (!disposed && requestId === detailRequest) detailError.value =
      error instanceof Error ? error.message : t('conservationPages.observations.errors.invalidResponse')
  } finally {
    if (!disposed && requestId === detailRequest) detailLoading.value = false
  }
}
function openHistory(item: ObservationView) {
  detailRequest++
  selected.value = item
  historyModal.value = true
  detailLoading.value = false
  detailError.value = ''
}
function closeModal() {
  detailRequest++
  selected.value = null
  historyModal.value = false
  detailLoading.value = false
  detailError.value = ''
}
const assetUrl = (id: string) => `/api/data/assets/${encodeURIComponent(id)}`
const imageFailed = (id: string) => { failedAssets.value = new Set([...failedAssets.value, id]) }

const filtered = computed(() => {
  const query = search.value.trim().toLowerCase()
  return observations.value.filter((item) => {
    const searchable = `${item.id} ${item.plantRawId} ${item.plantDisplayId} ${item.scientificName} ${item.commonName} ${item.ownerSubject} ${item.status}`
    return (!query || searchable.toLowerCase().includes(query)) &&
      (!status.value || item.status === status.value) &&
      (!species.value || item.speciesId === species.value) &&
      (!owner.value || item.ownerSubject === owner.value) &&
      (!date.value || dateKey(item.createdAt) === date.value)
  })
})
const history = computed(() => selected.value
  ? observations.value.filter((item) => item.plantRawId === selected.value?.plantRawId) : [])
const speciesOptions = computed(() => {
  const options = new Map<string, string>()
  observations.value.forEach((item) => {
    if (item.speciesId) options.set(item.speciesId, item.commonName || item.scientificName || item.speciesId)
  })
  return [...options].map(([id, name]) => ({ id, name }))
})
const ownerOptions = computed(() => [...new Set(observations.value.map((item) => item.ownerSubject).filter(Boolean))])

onMounted(loadObservations)
onBeforeUnmount(() => { disposed = true; detailRequest++ })
</script>

<template>
  <section class="page-intro"><div>
    <p class="page-kicker">{{ t('conservationPages.observations.eyebrow') }}</p>
    <h2>{{ t('conservationPages.observations.title') }}</h2>
    <p>{{ t('conservationPages.observations.intro') }}</p>
  </div></section>

  <div class="control-bar">
    <label class="field search-field"><span>{{ t('conservationPages.observations.search') }}</span><input v-model="search" :placeholder="t('conservationPages.observations.searchPlaceholder')" /></label>
    <label class="field"><span>{{ t('conservationPages.observations.status') }}</span><select v-model="status"><option value="">{{ t('conservationPages.observations.allStatuses') }}</option><option v-for="item in supportedStatuses" :key="item" :value="item">{{ label(item) }}</option></select></label>
    <label class="field"><span>{{ t('conservationPages.observations.species') }}</span><select v-model="species"><option value="">{{ t('conservationPages.observations.allSpecies') }}</option><option v-for="item in speciesOptions" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
    <label class="field"><span>{{ t('conservationPages.observations.submittedBy') }}</span><select v-model="owner"><option value="">{{ t('conservationPages.observations.allSubmitters') }}</option><option v-for="item in ownerOptions" :key="item" :value="item">{{ item }}</option></select></label>
    <label class="field"><span>{{ t('conservationPages.observations.created') }}</span><input v-model="date" type="date" /></label>
  </div>

  <section class="panel">
    <p v-if="!isLoading && !loadError" class="dataset-note">{{ t('conservationPages.observations.loadedLimit') }}<span v-if="skippedRecords"> · {{ t('conservationPages.observations.skipped', { count: skippedRecords }) }}</span></p>
    <div class="table-scroll"><table>
      <thead><tr><th>{{ t('conservationPages.observations.observationId') }}</th><th>{{ t('conservationPages.observations.plantId') }}</th><th>{{ t('conservationPages.observations.species') }}</th><th>{{ t('conservationPages.observations.submittedBy') }}</th><th>{{ t('conservationPages.observations.status') }}</th><th>{{ t('conservationPages.observations.created') }}</th><th>{{ t('conservationPages.observations.reviewState') }}</th><th>{{ t('conservationPages.observations.actions') }}</th></tr></thead>
      <tbody>
        <tr v-for="item in filtered" :key="item.id">
          <td><strong class="raw-id">{{ item.id }}</strong></td><td>{{ item.plantDisplayId }}</td>
          <td><em>{{ speciesName(item) }}</em><small v-if="item.commonName && item.scientificName">{{ item.commonName }}</small><small v-if="item.hasSpeciesRequest">{{ t('conservationPages.observations.newSpeciesRequest') }}</small></td>
          <td>{{ textOrUnavailable(item.ownerSubject) }}</td><td><span class="badge" :class="keyFor(item.status)">{{ label(item.status) }}</span></td><td>{{ formatDate(item.createdAt) }}</td>
          <td>{{ label(item.reviewDecision || item.status) }}<small v-if="item.reviewedAt">{{ formatDate(item.reviewedAt) }}</small></td>
          <td><div class="action-group">
            <button class="action-button" @click="open(item)">{{ t('conservationPages.observations.view') }}</button>
            <RouterLink v-if="item.plantRouteId" class="action-button" :to="`/plant/${item.plantRouteId}`">{{ t('conservationPages.observations.viewPlant') }}</RouterLink>
            <button class="action-button" @click="openHistory(item)">{{ t('conservationPages.observations.history') }}</button>
            <RouterLink class="action-button" :to="{ name: 'conservation-map', query: { plant: item.plantRawId } }">{{ t('conservationPages.observations.location') }}</RouterLink>
            <RouterLink v-if="item.status === 'Pending Review' || item.status === 'Flagged'" class="action-button" :to="{ name: 'conservation-reviews', query: { review: item.id } }">{{ t('conservationPages.observations.review') }}</RouterLink>
          </div></td>
        </tr>
        <tr v-if="isLoading"><td colspan="8" class="state-cell">{{ t('conservationPages.observations.loading') }}</td></tr>
        <tr v-else-if="loadError"><td colspan="8" class="state-cell error-state"><strong>{{ t('conservationPages.observations.loadFailed') }}</strong><span>{{ loadError }}</span><button class="action-button" @click="loadObservations">{{ t('conservationPages.observations.retry') }}</button></td></tr>
        <tr v-else-if="!filtered.length"><td colspan="8" class="state-cell">{{ t('conservationPages.observations.empty') }}</td></tr>
      </tbody>
    </table></div>
  </section>

  <AppModal v-if="selected && !historyModal" :title="t('conservationPages.observations.observationTitle', { id: selected.id })" :subtitle="`${selected.plantDisplayId} · ${speciesName(selected)}`" wide @close="closeModal">
    <p v-if="detailLoading" class="detail-state">{{ t('conservationPages.observations.loadingDetails') }}</p><p v-if="detailError" class="detail-state error-state">{{ detailError }}</p>
    <dl class="detail-list">
      <div><dt>{{ t('conservationPages.observations.submittedBy') }}</dt><dd>{{ textOrUnavailable(selected.ownerSubject) }}</dd></div><div><dt>{{ t('conservationPages.observations.status') }}</dt><dd>{{ label(selected.status) }}</dd></div>
      <div><dt>{{ t('conservationPages.observations.created') }}</dt><dd>{{ formatDate(selected.createdAt) }}</dd></div><div><dt>{{ t('conservationPages.observations.lastUpdated') }}</dt><dd>{{ formatDate(selected.updatedAt) }}</dd></div>
      <div><dt>{{ t('conservationPages.observations.height') }}</dt><dd>{{ textOrUnavailable(selected.height) }}</dd></div><div><dt>{{ t('conservationPages.observations.growthStage') }}</dt><dd>{{ label(selected.lifeStage) }}</dd></div><div><dt>{{ t('conservationPages.observations.healthStatus') }}</dt><dd>{{ label(selected.healthStatus) }}</dd></div>
      <div><dt>{{ t('conservationPages.observations.morphology') }}</dt><dd>{{ textOrUnavailable(selected.morphology) }}</dd></div><div><dt>{{ t('conservationPages.observations.notes') }}</dt><dd>{{ textOrUnavailable(selected.notes) }}</dd></div>
      <div><dt>{{ t('conservationPages.observations.coordinates') }}</dt><dd>{{ selected.latitude !== '' && selected.longitude !== '' ? `${selected.latitude}, ${selected.longitude}` : '—' }}</dd></div><div><dt>{{ t('conservationPages.observations.gpsAccuracy') }}</dt><dd>{{ selected.gpsAccuracy !== '' ? `${selected.gpsAccuracy} m` : '—' }}</dd></div>
      <div><dt>{{ t('conservationPages.observations.reviewState') }}</dt><dd>{{ label(selected.reviewDecision || selected.status) }}</dd></div><div><dt>{{ t('conservationPages.observations.reviewedAt') }}</dt><dd>{{ formatDate(selected.reviewedAt) }}</dd></div><div><dt>{{ t('conservationPages.observations.reviewComments') }}</dt><dd>{{ textOrUnavailable(selected.reviewComment) }}</dd></div>
    </dl>
    <template v-if="Object.keys(selected.taxonomy).length"><h3>{{ t('conservationPages.observations.taxonomy') }}</h3><dl class="detail-list"><div v-for="(value, key) in selected.taxonomy" :key="key"><dt>{{ key }}</dt><dd>{{ value }}</dd></div></dl></template>
    <h3>{{ t('conservationPages.observations.media') }}</h3><p v-if="!selected.assets.length">{{ t('conservationPages.observations.noAssets') }}</p>
    <div v-else class="submission-image-grid"><article v-for="asset in selected.assets" :key="asset.id" class="submitted-image-item"><div class="submitted-image-preview"><img v-if="asset.contentType.startsWith('image/') && !failedAssets.has(asset.id)" :src="assetUrl(asset.id)" :alt="t('conservationPages.observations.imageAlt', { observation: selected.id, asset: asset.id })" loading="lazy" @error="imageFailed(asset.id)" /><span v-else>{{ t(asset.contentType.startsWith('image/') ? 'conservationPages.observations.imageUnavailable' : 'conservationPages.observations.attachment') }}</span></div><div class="asset-caption"><strong :title="asset.id">{{ asset.id }}</strong><small>{{ asset.contentType }}</small></div></article></div>
  </AppModal>

  <AppModal v-if="selected && historyModal" :title="t('conservationPages.observations.historyTitle', { id: selected.plantDisplayId })" :subtitle="t('conservationPages.observations.historyLimit')" wide @close="closeModal">
    <div class="table-scroll"><table><thead><tr><th>{{ t('conservationPages.observations.id') }}</th><th>{{ t('conservationPages.observations.created') }}</th><th>{{ t('conservationPages.observations.height') }}</th><th>{{ t('conservationPages.observations.health') }}</th><th>{{ t('conservationPages.observations.status') }}</th></tr></thead><tbody><tr v-for="item in history" :key="item.id"><td>{{ item.id }}</td><td>{{ formatDate(item.createdAt) }}</td><td>{{ textOrUnavailable(item.height) }}</td><td>{{ label(item.healthStatus) }}</td><td>{{ label(item.status) }}</td></tr></tbody></table></div>
  </AppModal>
</template>

<style scoped>
a.action-button { text-decoration: none; }
.dataset-note, .detail-state { margin: 0; padding: 14px 18px; color: #63776d; font-size: 12px; }
.state-cell { padding: 30px; text-align: center; }
.state-cell span, td small, .asset-caption small { display: block; margin-top: 4px; }
.error-state { color: #9b3d35; }
.error-state .action-button { margin-top: 12px; }
.raw-id { overflow-wrap: anywhere; }
.submission-image-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; }
.submitted-image-item { overflow: hidden; border: 1px solid rgba(58, 96, 70, 0.15); border-radius: 14px; background: #fff; }
.submitted-image-preview { min-height: 150px; display: grid; place-items: center; background: #edf1e9; color: #63776d; }
.submitted-image-preview img { width: 100%; height: 190px; object-fit: cover; }
.asset-caption { padding: 12px; overflow-wrap: anywhere; }
</style>
