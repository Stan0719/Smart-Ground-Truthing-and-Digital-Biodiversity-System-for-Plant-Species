<script setup lang="ts">
import { useConservationText } from '../../composables/useConservationText'
const { ct, locale } = useConservationText()
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { sessionSnapshot, subscribeSession } from '../../services/auth'
import { ReviewApiError, createReviewRequest, performObservationReview, reviewCommentValid, positiveRevision, reviewEligible, reviewTransitions as transitions, type ReviewDecision } from '../../services/observationReview'
import ActionFeedback from '../../components/ActionFeedback.vue'
import AppModal from '../../components/conservation/AppModal.vue'
import PlantSimilarityDrawer from '../../components/conservation/PlantSimilarityDrawer.vue'
import { formatObservationId } from '../../utils/observationId'
import { formatPlantId } from '../../utils/plantId'
import { observationOrigin, observationQueueUrl, readQueuePage, type ObservationOrigin } from '../../services/observationQueue'
import {
  mapLinkedSpeciesRequest,
  hasResolvedSpecies,
  speciesRequestReviewUrl,
  speciesRequestCanDecide,
  type SpeciesRequestDecision,
  type LinkedSpeciesRequest,
} from '../../services/reviewSpeciesRequest'
import type { ObservationStatus } from '../../data/conservation'
import {
  plantSimilarityByObservation,
  type PlantSimilarityAnalysis,
} from '../../data/plantSimilarityPrototype'

interface ReviewObservation {
  origin: ObservationOrigin
  // Raw backend ID is authoritative; displayId preserves numeric legacy presentation only.
  id: string
  displayId: string
  revision: number
  plantId: string
  plantRawId: string
  zone: string
  altitude: string
  recordedBy: string
  height: string
  growthStage: string
  health: string
  createdAt: string
  updatedAt: string
  status: string
  morphology: string
  notes: string
  gpsAccuracy: string
  reviewedAt?: string
  reviewComment?: string
  reviewDecision: string
  assets: { id: string; contentType: string }[]
  speciesId: string
  scientificName: string
  commonName: string
  latitude: string
  longitude: string
  speciesRequest: LinkedSpeciesRequest | null
}

const route = useRoute()
const router = useRouter()
const { t } = useI18n({ useScope: 'global' })
const search = ref('')
const status = ref('')
const species = ref('')
const date = ref('')
const selected = ref<ReviewObservation | null>(null)
const comment = ref('')
const observations = ref<ReviewObservation[]>([])
const queueOrigin = ref<'initial_registration' | 'unknown'>('initial_registration')
const hasMore = ref(false)
const nextCursor = ref<string | null>(null)
let listRequest = 0
const isLoading = ref(true)
const loadError = ref('')
const selectionLoading = ref(false)
const selectionError = ref('')
const plantQr = ref<{ identity: string; status: string } | null>(null)
const qrLoading = ref(false)
const qrError = ref('')
let qrRequest = 0
const isSaving = ref(false)
const needsReload = ref(false)
const conflictAcknowledged = ref(true)
const failedAssets = ref(new Set<string>())
const speciesReviewComment = ref('')
const speciesVisibility = ref<'' | 'public' | 'internal' | 'protected'>('')
const speciesLoadError = ref('')
const speciesRefreshing = ref(false)
const speciesSaving = ref(false)
const speciesSaveError = ref('')
const speciesNeedsReload = ref(false)
const reviewBusy = computed(() => isSaving.value || speciesSaving.value)
const skippedRecords = ref(0)
const reviewMessage = ref<{ variant: 'success' | 'error'; message: string } | null>(null)
const feedback = ref<{ id: number; variant: 'success' | 'error'; message: string } | null>(null)
const similarityAnalysis = ref<PlantSimilarityAnalysis | null>(null)
const similarityTrigger = ref<HTMLElement | null>(null)
let feedbackId = 0
let selectionRequest = 0
let disposed = false
const rt = (key: string, params: Record<string, string | number> = {}) =>
  t(`conservationPages.reviews.${key}`, params)

const showFeedback = (message: string, variant: 'success' | 'error' = 'error') => {
  reviewMessage.value = { variant, message }
  feedback.value = { id: ++feedbackId, variant, message }
}

const dismissFeedback = (id: number) => {
  if (feedback.value?.id === id) feedback.value = null
}

const supportedStatuses: ObservationStatus[] = [
  'Draft',
  'Pending Review',
  'Approved',
  'Rejected',
  'Correction Required',
  'Flagged',
]
const canonicalStatus = (value: string | null | undefined) => {
  const normalized = (value || '').trim().toLowerCase().replace(/[_-]+/g, ' ')
  return supportedStatuses.find((item) => item.toLowerCase() === normalized) || ''
}
const stringValue = (value: unknown) =>
  typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
    ? String(value)
    : ''
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
const observationIdPattern =
  /^(?:[1-9][0-9]{0,18}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i
const numericValue = (value: unknown, min: number, max = Infinity) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? String(value)
    : ''
const dateKey = (value: string | undefined) => {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
const formatDate = (value: string | undefined) => {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return new Intl.DateTimeFormat(locale.value === 'ms' ? 'ms-MY' : locale.value, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(parsed)
}

const mapObservation = (value: unknown): ReviewObservation | null => {
  const item = record(value)
  if (!item) return null
  const id = stringValue(item.id)
  const plantId = formatPlantId(stringValue(item.plant_id))
  const content = record(item.content)
  if (
    !observationIdPattern.test(id) ||
    !plantId ||
    !content ||
    !positiveRevision(item.revision) ||
    !Number.isSafeInteger(item.revision) ||
    item.revision < 1
  )
    return null
  const height = numericValue(content.heightCm, 0)
  return {
    origin: observationOrigin(item.origin_type),
    id,
    displayId: formatObservationId(id) || id,
    revision: item.revision,
    plantId,
    plantRawId: String(Number(stringValue(item.plant_id))),
    zone: typeof content.zone === 'string' && content.zone.trim() ? content.zone : '',
    altitude: numericValue(content.altitudeM, -Infinity),
    recordedBy: stringValue(item.owner_subject),
    height: height ? `${height} cm` : '',
    growthStage: stringValue(content.lifeStage),
    health: stringValue(content.healthStatus),
    createdAt: stringValue(item.created_at),
    updatedAt: stringValue(item.updated_at),
    status: canonicalStatus(stringValue(item.status)),
    morphology: stringValue(content.morphology),
    notes: stringValue(content.notes),
    gpsAccuracy: numericValue(content.accuracy_m, 0),
    reviewedAt: stringValue(item.reviewed_at),
    reviewComment: stringValue(item.review_comment),
    reviewDecision: canonicalStatus(stringValue(item.review_decision)),
    assets: Array.isArray(item.assets)
      ? item.assets.flatMap((value) => {
          const asset = record(value)
          return asset &&
            typeof asset.id === 'string' &&
            asset.id &&
            typeof asset.content_type === 'string'
            ? [{ id: asset.id, contentType: asset.content_type }]
            : []
        })
      : [],
    speciesId: stringValue(item.species_id),
    scientificName: stringValue(item.scientific_name),
    commonName: stringValue(item.common_name),
    latitude: numericValue(content.latitude, -90, 90),
    longitude: numericValue(content.longitude, -180, 180),
    speciesRequest: mapLinkedSpeciesRequest(item),
  }
}

const counts = computed(() => [
  ['Pending Review', observations.value.filter((o) => o.status === 'Pending Review').length],
  [
    'Correction Required',
    observations.value.filter((o) => o.status === 'Correction Required').length,
  ],
  ['Flagged', observations.value.filter((o) => o.status === 'Flagged').length],
  [
    'Approved Today',
    observations.value.filter(
      (o) => o.status === 'Approved' && dateKey(o.reviewedAt) === dateKey(new Date().toISOString()),
    ).length,
  ],
])

const filtered = computed(() =>
  observations.value.filter((observation) => {
    if (observation.origin !== queueOrigin.value) return false
    const searchable = `${observation.id} ${observation.plantId} ${observation.speciesId} ${observation.scientificName} ${observation.commonName} ${observation.recordedBy} ${observation.status}`
    const matchesDate = !date.value || dateKey(observation.createdAt) === date.value
    return (
      searchable.toLowerCase().includes(search.value.toLowerCase()) &&
      (!status.value || observation.status === status.value) &&
      (!species.value || observation.speciesId === species.value) &&
      matchesDate
    )
  }),
)

const selectedSpecies = computed(() => selected.value)
const selectedSpeciesRequest = computed(() => selected.value?.speciesRequest || null)
const speciesResolved = computed(() =>
  Boolean(
    selected.value &&
    hasResolvedSpecies(
      selectedSpeciesRequest.value,
      selected.value.speciesId,
      selected.value.scientificName,
    ),
  ),
)
const speciesRequestState = computed(() => {
  if (speciesSaving.value) return 'saving'
  if (speciesRefreshing.value) return 'loading'
  if (speciesLoadError.value || speciesSaveError.value) return 'error'
  const request = selectedSpeciesRequest.value
  return request?.state === 'approved' && !speciesResolved.value
    ? 'incomplete'
    : request?.state || 'unavailable'
})
const speciesNotice = computed(() => rt(`speciesRequest.notices.${speciesRequestState.value}`))
const reviewSession = ref(sessionSnapshot())
const officerSessionReady = computed(() => !reviewSession.value.pending && reviewSession.value.user?.role === 'Conservation Officer' &&
  reviewSession.value.user.status === 'Active' && reviewSession.value.user.mustChangePassword === false)
const unsubscribeReviewSession = subscribeSession((user, pending) => {
  const old = reviewSession.value.user?.id
  reviewSession.value = { user, pending }
  if (pending || !user || user.role !== 'Conservation Officer' || user.status !== 'Active' || user.mustChangePassword || old !== user.id) {
    clearPlantQr()
    listRequest++; observations.value = []; hasMore.value = false; nextCursor.value = null; isLoading.value = false
    selectionRequest++; selectionLoading.value = false; selectionError.value = ''; selected.value = null; comment.value = ''; needsReload.value = true
  }
})
const canReviewPlant = computed(
  () =>
    !reviewBusy.value &&
    selected.value?.origin === queueOrigin.value &&
    !selectionLoading.value && !selectionError.value &&
    !needsReload.value &&
    conflictAcknowledged.value &&
    !speciesRefreshing.value &&
    !speciesLoadError.value &&
    !speciesNeedsReload.value &&
    speciesResolved.value &&
    Boolean(selected.value && reviewEligible(reviewSession.value.user, reviewSession.value.pending, { ...selected.value, owner: selected.value.recordedBy })),
)
const canReviewSpecies = computed(
  () =>
    speciesRequestCanDecide(selectedSpeciesRequest.value) &&
    selected.value?.origin === queueOrigin.value &&
    !selectionLoading.value && !selectionError.value &&
    officerSessionReady.value &&
    !reviewBusy.value &&
    !speciesRefreshing.value &&
    !speciesLoadError.value &&
    !speciesNeedsReload.value &&
    !needsReload.value,
)
function resetSpeciesState(observation?: ReviewObservation) {
  speciesVisibility.value = ''
  speciesReviewComment.value = observation?.speciesRequest?.reviewComment || ''
  speciesLoadError.value = ''
  speciesRefreshing.value = false
  speciesSaveError.value = ''
  speciesNeedsReload.value = false
}

const speciesOptions = computed(() => {
  const options = new Map<string, string>()
  observations.value.forEach((observation) => {
    if (observation.speciesId) {
      options.set(
        observation.speciesId,
        observation.commonName || observation.scientificName || observation.speciesId,
      )
    }
  })
  return [...options].map(([id, name]) => ({ id, name }))
})

async function open(observation: ReviewObservation) {
  if (reviewBusy.value || !officerSessionReady.value) return
  const token = ++selectionRequest
  selected.value = observation
  comment.value = observation.reviewComment || ''
  reviewMessage.value = null
  needsReload.value = false
  conflictAcknowledged.value = true
  failedAssets.value = new Set()
  resetSpeciesState(observation)
  void router.replace({ query: { ...route.query, review: observation.id } })
  await refreshSelection(observation.id, token)
}

async function refreshSelection(id: string, token: number) {
  clearPlantQr()
  selectionLoading.value = true
  selectionError.value = ''
  try {
    const fresh = await fetchObservation(id)
    if (disposed || token !== selectionRequest || selected.value?.id !== id) return
    updateObservation(fresh)
  } catch {
    if (!disposed && token === selectionRequest && selected.value?.id === id) {
      selectionError.value = rt('unableToRefreshObservation')
      needsReload.value = true
    }
  } finally {
    if (!disposed && token === selectionRequest) selectionLoading.value = false
  }
}

async function retrySelection() {
  if (!selected.value || reviewBusy.value || selectionLoading.value) return
  const id = selected.value.id
  const token = ++selectionRequest
  await refreshSelection(id, token)
  if (token === selectionRequest && !selectionError.value && selected.value?.id === id) needsReload.value = false
}

function closeReview() {
  if (reviewBusy.value) return
  clearPlantQr()
  selectionRequest++
  selectionLoading.value = false
  selectionError.value = ''
  selected.value = null
  resetSpeciesState()
  const query = { ...route.query }
  delete query.review
  void router.replace({ query })
}

const similarityFor = (observationId: string) => plantSimilarityByObservation.get(observationId)

const formatSimilarity = (value: number) => `${Math.round(value * 100)}%`

function openSimilarity(analysis: PlantSimilarityAnalysis, event: Event) {
  similarityTrigger.value = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  similarityAnalysis.value = analysis
}

function closeSimilarity() {
  similarityAnalysis.value = null
  void nextTick(() => similarityTrigger.value?.focus())
}

const canDecide = (decision: ReviewDecision) =>
  canReviewPlant.value &&
  Boolean(selected.value && transitions[selected.value.status]?.includes(decision))
const countValue = (value: string | number) =>
  isLoading.value ? rt('loading') : loadError.value ? rt('unavailable') : value
const assetUrl = (id: string) => `/api/data/assets/${encodeURIComponent(id)}`
const imageFailed = (id: string) => {
  failedAssets.value = new Set([...failedAssets.value, id])
}

const request = createReviewRequest(rt, (...args) => fetch(...args))
function clearPlantQr() {
  qrRequest++
  plantQr.value = null
  qrLoading.value = false
  qrError.value = ''
}
async function loadPlantQr(observation: ReviewObservation) {
  clearPlantQr()
  if (!officerSessionReady.value || disposed) return
  const token = qrRequest
  const current = () => !disposed && token === qrRequest && officerSessionReady.value &&
    selected.value?.id === observation.id && selected.value.plantRawId === observation.plantRawId
  qrLoading.value = true
  try {
    const result = await request(`/api/plants/${encodeURIComponent(observation.plantRawId)}`)
    if (!current()) return
    const plant = record(result.plant)
    if (!plant || stringValue(plant.plant_id) !== observation.plantRawId)
      throw new ReviewApiError(rt('feedback.invalidResponse'))
    // Only plant-level QR fields are composed here. Never substitute plant location/content.
    plantQr.value = {
      identity: typeof plant.qr_token === 'string' && plant.qr_token.trim() ? plant.qr_token : '',
      status: typeof plant.qr_status === 'string' && plant.qr_status.trim() ? plant.qr_status : '',
    }
  } catch {
    if (current()) qrError.value = rt('qrLoadFailed')
  } finally {
    if (current()) qrLoading.value = false
  }
}
async function fetchObservation(id: string) {
  const result = await request(`/api/observations/${encodeURIComponent(id)}`)
  const observation = mapObservation(result.observation)
  if (!observation || observation.id !== id || !observation.status)
    throw new ReviewApiError(rt('feedback.invalidResponse'))
  return observation
}
function updateObservation(observation: ReviewObservation) {
  const previousRequest =
    selected.value?.id === observation.id ? selected.value.speciesRequest : null
  const lostDependency = previousRequest && !observation.speciesRequest
  if (lostDependency) {
    observation = { ...observation, speciesRequest: { ...previousRequest, state: 'error' } }
  }
  observations.value = observations.value.map((item) =>
    item.id === observation.id ? observation : item,
  )
  if (observation.origin !== queueOrigin.value) {
    observations.value = observations.value.filter(item => item.id !== observation.id)
    void loadObservations()
  }
  selected.value = observation
  void loadPlantQr(observation)
  resetSpeciesState(observation)
  if (lostDependency) speciesLoadError.value = rt('speciesRequest.loadFailed')
}
async function refreshSpeciesRequest() {
  if (!selected.value || reviewBusy.value || speciesRefreshing.value || selectionLoading.value || selectionError.value) return
  const id = selected.value.id
  const token = ++selectionRequest
  speciesRefreshing.value = true
  speciesLoadError.value = ''
  try {
    // Observation detail is authoritative for both the request and resulting species.
    const fresh = await fetchObservation(id)
    if (disposed || token !== selectionRequest) return
    updateObservation(fresh)
    failedAssets.value = new Set()
  } catch (error) {
    if (!disposed && token === selectionRequest)
      speciesLoadError.value =
        error instanceof Error ? error.message : rt('speciesRequest.loadFailed')
  } finally {
    if (!disposed && token === selectionRequest) speciesRefreshing.value = false
  }
}
async function decideSpecies(decision: SpeciesRequestDecision) {
  if (!selected.value || !canReviewSpecies.value || !selectedSpeciesRequest.value) return
  if (decision === 'Approved' && !speciesVisibility.value) {
    speciesSaveError.value = 'Select visibility.'
    return
  }
  const typedComment = speciesReviewComment.value
  if (typedComment.length > 4000 || (decision !== 'Approved' && !typedComment.trim())) {
    speciesSaveError.value = rt(
      typedComment.length > 4000
        ? 'speciesRequest.commentTooLong'
        : 'speciesRequest.commentRequired',
    )
    return
  }
  const observationId = selected.value.id
  const requestId = selectedSpeciesRequest.value.id
  const token = ++selectionRequest
  speciesSaving.value = true
  speciesSaveError.value = ''
  reviewMessage.value = null
  let committed = false
  const current = () => !disposed && token === selectionRequest
  try {
    const latest = await fetchObservation(observationId)
    if (!current()) return
    if (latest.origin !== queueOrigin.value || latest.speciesRequest?.id !== requestId || latest.speciesRequest.state !== 'pending') {
      updateObservation(latest)
      speciesReviewComment.value = typedComment
      showFeedback(latest.origin !== queueOrigin.value ? rt('queues.originMoved') : rt('speciesRequest.conflict'))
      return
    }
    const result = await request(speciesRequestReviewUrl(requestId), {
      decision,
      comment: typedComment,
      ...(decision === 'Approved' ? { visibility: speciesVisibility.value } : {}),
    })
    if (!current()) return
    if (result.reviewed !== true) throw new ReviewApiError(rt('feedback.invalidResponse'))
    committed = true
    const fresh = await fetchObservation(observationId)
    if (!current()) return
    updateObservation(fresh)
    if (
      !selectedSpeciesRequest.value ||
      selectedSpeciesRequest.value.id !== requestId ||
      selectedSpeciesRequest.value.state !==
        (
          {
            Approved: 'approved',
            Rejected: 'rejected',
            'Correction Required': 'correction',
          } as const
        )[decision]
    ) {
      throw new ReviewApiError(rt('feedback.invalidResponse'))
    }
    showFeedback(rt('speciesRequest.saved'), 'success')
  } catch (error) {
    if (!current()) return
    if (error instanceof ReviewApiError && error.status === 409 && !committed) {
      try {
        const fresh = await fetchObservation(observationId)
        if (!current()) return
        updateObservation(fresh)
        showFeedback(rt('speciesRequest.conflict'))
      } catch {
        if (!current()) return
        speciesNeedsReload.value = true
        speciesLoadError.value = rt('speciesRequest.conflictReloadFailed')
        showFeedback(speciesLoadError.value)
      }
    } else {
      speciesNeedsReload.value =
        committed || !(error instanceof ReviewApiError) || ![400, 401, 403].includes(error.status)
      speciesSaveError.value = committed
        ? rt('speciesRequest.savedReloadFailed')
        : error instanceof Error
          ? error.message
          : rt('feedback.requestFailed', { status: 0 })
      showFeedback(speciesSaveError.value)
    }
    speciesReviewComment.value = typedComment
  } finally {
    if (current()) {
      speciesSaving.value = false
      if (route.query.review !== observationId) void resolveQuery()
    }
  }
}
async function resolveQuery() {
  if (isLoading.value || reviewBusy.value || disposed || !officerSessionReady.value) return
  const id = typeof route.query.review === 'string' ? route.query.review : ''
  if (id && selected.value?.id === id) return
  const token = ++selectionRequest
  selected.value = null
  clearPlantQr()
  resetSpeciesState()
  selectionLoading.value = false
  if (!id) return
  if (!observationIdPattern.test(id)) {
    showFeedback(rt('feedback.invalidId'))
    return
  }
  selectionLoading.value = true
  try {
    const observation = await fetchObservation(id)
    if (disposed || token !== selectionRequest) return
    selected.value = observation
    if (observation.origin === 'unknown' && queueOrigin.value !== 'unknown') {
      queueOrigin.value = 'unknown'
      void loadObservations()
    }
    void loadPlantQr(observation)
    comment.value = observation.reviewComment || ''
    reviewMessage.value = null
    needsReload.value = false
    conflictAcknowledged.value = true
    failedAssets.value = new Set()
    resetSpeciesState(observation)
    selectionError.value = ''
  } catch (error) {
    if (!disposed && token === selectionRequest)
      showFeedback(error instanceof Error ? error.message : rt('feedback.loadFailed'))
  } finally {
    if (!disposed && token === selectionRequest) selectionLoading.value = false
  }
}
async function reloadSelected() {
  if (!selected.value || reviewBusy.value || selectionLoading.value || selectionError.value) return
  const id = selected.value.id
  const token = ++selectionRequest
  isSaving.value = true
  try {
    const fresh = await fetchObservation(id)
    if (disposed || token !== selectionRequest || selected.value?.id !== id) return
    updateObservation(fresh)
    needsReload.value = false
    conflictAcknowledged.value = false
    showFeedback(rt('feedback.reloaded'))
  } catch (error) {
    if (!disposed && token === selectionRequest)
      showFeedback(error instanceof Error ? error.message : rt('feedback.loadFailed'))
  } finally {
    isSaving.value = false
    if (!disposed && token === selectionRequest && route.query.review !== id) void resolveQuery()
  }
}
async function decide(decision: ReviewDecision) {
  if (!selected.value || !canDecide(decision)) return
  if (!reviewCommentValid(decision, comment.value)) {
    showFeedback(rt('feedback.commentRequired'))
    return
  }
  const { id, revision } = selected.value
  const typedComment = comment.value
  isSaving.value = true
  reviewMessage.value = null
  const token = selectionRequest
  try {
    try {
      const latest = await fetchObservation(id)
      if (disposed || token !== selectionRequest || selected.value?.id !== id) return
      if (latest.origin !== queueOrigin.value) { updateObservation(latest); showFeedback(rt('queues.originMoved')); return }
    } catch (error) {
      if (!disposed && token === selectionRequest) { needsReload.value = true; showFeedback(error instanceof Error ? error.message : rt('feedback.loadFailed')) }
      return
    }
    const result = await performObservationReview({ id, revision, decision, comment: typedComment, request, read: fetchObservation,
      current: () => !disposed && token === selectionRequest && selected.value?.id === id, invalidResponse: rt('feedback.invalidResponse') })
    if (!result) return
    if (result.observation) updateObservation(result.observation)
    needsReload.value = result.needsReload
    if (result.kind === 'saved') { comment.value = selected.value?.reviewComment || ''; showFeedback(rt('feedback.saved'), 'success') }
    else {
      comment.value = typedComment
      if (result.kind === 'conflict') { conflictAcknowledged.value = false; showFeedback(rt(result.needsReload ? 'feedback.conflictReloadFailed' : 'feedback.conflict')) }
      else showFeedback(result.committed ? rt('feedback.savedReloadFailed') : result.error instanceof Error ? result.error.message : rt('feedback.requestFailed', { status: 0 }))
    }
  } finally {
    isSaving.value = false
    if (route.query.review !== id) void resolveQuery()
  }

}

function changeQueue() {
  closeReview()
  void loadObservations()
}
async function loadObservations(append = false) {
  if (append && (isLoading.value || !hasMore.value)) return
  const token = ++listRequest
  const cursor = append ? nextCursor.value : null
  if (!append) { observations.value = []; nextCursor.value = null; hasMore.value = false; skippedRecords.value = 0 }
  isLoading.value = true
  loadError.value = ''
  try {
    const result = await request(observationQueueUrl(queueOrigin.value, status.value, cursor))
    if (disposed || token !== listRequest) return
    const page = readQueuePage(result.page)
    if (!Array.isArray(result.observations) || !page || (page.cursor !== null && page.cursor === cursor))
      throw new ReviewApiError(rt('feedback.invalidResponse'))
    const mapped = result.observations
      .map(mapObservation)
      .filter((item): item is ReviewObservation => item !== null)
    observations.value = [...new Map([...(append ? observations.value : []), ...mapped].map(item => [item.id, item])).values()]
    skippedRecords.value += result.observations.length - mapped.length
    hasMore.value = page.hasMore; nextCursor.value = page.cursor
  } catch (loadFailure) {
    if (disposed || token !== listRequest) return
    loadError.value = loadFailure instanceof Error ? loadFailure.message : rt('feedback.loadFailed')
  } finally {
    if (!disposed && token === listRequest) { isLoading.value = false; void resolveQuery() }
  }
}
onMounted(loadObservations)
watch(
  () => route.query.review,
  () => void resolveQuery(),
)
onBeforeUnmount(() => {
  disposed = true
  clearPlantQr()
  unsubscribeReviewSession()
  selectionRequest++
  listRequest++
})
</script>

<template>
  <ActionFeedback
    v-if="feedback"
    :key="feedback.id"
    :feedback-id="feedback.id"
    :variant="feedback.variant"
    :message="feedback.message"
    @dismiss="dismissFeedback"
  />

  <section class="page-intro">
    <div>
      <p class="page-kicker">{{ ct('VERIFICATION WORKFLOW') }}</p>
      <h2>{{ rt('queues.registrations') }}</h2>
      <p>{{ rt('queues.registrationIntro') }}</p>
    </div>
  </section>
  <section class="summary-grid">
    <article v-for="count in counts" :key="String(count[0])" class="summary-card">
      <p>{{ ct(count[0]) }}</p>
      <strong>{{ countValue(count[1]!) }}</strong
      ><small>{{ rt('queues.loadedScope') }}</small>
    </article>
  </section>
  <div class="control-bar">
    <label class="field"><span>{{ rt('queues.reviewQueue') }}</span><select v-model="queueOrigin" :disabled="reviewBusy" @change="changeQueue">
      <option value="initial_registration">{{ rt('queues.registrations') }}</option>
      <option value="unknown">{{ rt('queues.legacy') }}</option>
    </select></label>
    <label class="field search-field"
      ><span>{{ ct('Search') }}</span
      ><input v-model="search" :placeholder="ct('Observation ID, Plant ID, species or botanist')"
    /></label>
    <label class="field"
      ><span>{{ ct('Review status') }}</span
      ><select v-model="status" @change="loadObservations()">
        <option value="">{{ ct('All statuses') }}</option>
        <option
          v-for="reviewStatus in [
            'Pending Review',
            'Approved',
            'Rejected',
            'Correction Required',
            'Flagged',
          ]"
          :key="reviewStatus"
          :value="reviewStatus"
        >
          {{ ct(reviewStatus) }}
        </option>
      </select></label
    >
    <label class="field"
      ><span>{{ ct('Species') }}</span
      ><select v-model="species">
        <option value="">{{ ct('All species') }}</option>
        <option v-for="item in speciesOptions" :key="item.id" :value="item.id">
          {{ item.name }}
        </option>
      </select></label
    >
    <label class="field"
      ><span>{{ rt('recordCreated') }}</span> ><input v-model="date" type="date"
    /></label>
  </div>
  <p v-if="selectionLoading" role="status">{{ rt('loadingDetail') }}</p>
  <p v-if="skippedRecords" role="status">{{ rt('skippedRecords', { count: skippedRecords }) }}</p>
  <p>{{ rt('queues.loadedScope') }}</p>
  <p v-if="queueOrigin === 'unknown'">{{ rt('queues.originUnverified') }}</p>
  <section class="panel">
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{{ ct('Observation ID') }}</th>
            <th>{{ ct('Plant ID') }}</th>
            <th>{{ ct('Species') }}</th>
            <th>{{ ct('Submitted By') }}</th>
            <th>{{ ct('Location Zone') }}</th>
            <th>{{ rt('recordCreated') }}</th>
            <th>{{ ct('Status') }}</th>
            <th>{{ ct('Similarity') }}</th>
            <th>{{ ct('Actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="observation in filtered" :key="observation.id">
            <td>
              <strong class="observation-id" :title="observation.id">{{
                observation.displayId
              }}</strong>
            </td>
            <td>{{ observation.plantId }}</td>
            <td>
              <div v-if="observation.speciesRequest" class="species-request-list">
                <span class="species-request-badge">{{ rt('speciesRequest.title') }}</span>
                <em>{{
                  observation.speciesRequest.scientificName || rt('speciesRequest.proposed')
                }}</em>
              </div>
              <em v-else-if="observation.scientificName">{{ observation.scientificName }}</em>
              <span v-else>{{ ct('Species unavailable') }}</span>
            </td>
            <td>{{ observation.recordedBy || '—' }}</td>
            <td>{{ observation.zone || rt('notRecorded') }}</td>
            <td>{{ formatDate(observation.createdAt) }}</td>
            <td>
              <span class="badge" :class="observation.status.toLowerCase().replaceAll(' ', '-')">{{
                observation.status ? ct(observation.status) : '—'
              }}</span>
            </td>
            <td>
              <button
                v-if="similarityFor(observation.displayId)?.status === 'available'"
                class="similarity-badge-button"
                type="button"
                :aria-label="`View prototype visual similarity results for ${observation.displayId}: ${formatSimilarity(similarityFor(observation.displayId)!.highestSimilarity)}`"
                @click="openSimilarity(similarityFor(observation.displayId)!, $event)"
              >
                <strong>{{
                  formatSimilarity(similarityFor(observation.displayId)!.highestSimilarity)
                }}</strong>
                <span>Prototype</span>
              </button>
              <span v-else class="similarity-unavailable">{{ rt('similarityUnavailable') }}</span>
            </td>
            <td>
              <button class="action-button" :disabled="reviewBusy" @click="open(observation)">
                {{ ct('Review') }}
              </button>
            </td>
          </tr>
          <tr v-if="isLoading || loadError || !filtered.length">
            <td colspan="9">
              {{
                isLoading
                  ? 'Loading review submissions...'
                  : loadError || rt(queueOrigin === 'unknown' ? 'queues.noRecords' : 'queues.noRegistrations')
              }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <button v-if="hasMore || loadError" class="action-button" :disabled="isLoading" @click="loadObservations(Boolean(nextCursor))">{{ rt('queues.loadMore') }}</button>
  </section>

  <AppModal
    v-if="selected"
    :title="ct('Review {id}', { id: selected.displayId })"
    :subtitle="
      ct('{id} · submitted by {name}', { id: selected.plantId, name: selected.recordedBy })
    "
    wide
    @close="closeReview"
  >
    <p v-if="selected.origin === 'unknown'" role="status">{{ rt('queues.originUnverified') }}</p>
    <p v-if="selected.origin !== queueOrigin" role="status">{{ rt('queues.originMoved') }} <RouterLink :to="{ name: 'conservation-observations' }">{{ rt('queues.fieldObservations') }}</RouterLink></p>
    <p v-if="selectionLoading" role="status">{{ rt('loadingLatestObservation') }}</p>
    <div v-if="selectionError" role="alert">
      <p>{{ selectionError }}</p>
      <button class="secondary-button" :disabled="selectionLoading || reviewBusy" @click="retrySelection">{{ rt('retryRefresh') }}</button>
    </div>
    <section
      v-if="selectedSpeciesRequest"
      class="species-request-card"
      aria-labelledby="species-request-heading"
      :aria-busy="speciesRefreshing || speciesSaving"
    >
      <header class="species-request-header">
        <div>
          <p class="section-kicker">{{ rt('speciesRequest.requiredFirst') }}</p>
          <h3 id="species-request-heading">{{ rt('speciesRequest.title') }}</h3>
        </div>
        <span class="species-request-badge">{{
          rt(`speciesRequest.states.${speciesRequestState}`)
        }}</span>
      </header>
      <p :role="speciesLoadError ? 'alert' : 'status'" id="species-request-notice">
        {{ speciesNotice }}
      </p>
      <p v-if="speciesLoadError" role="alert">{{ speciesLoadError }}</p>
      <p v-if="speciesSaveError" role="alert">{{ speciesSaveError }}</p>
      <dl class="species-request-details">
        <div>
          <dt>{{ ct('Species Request ID') }}</dt>
          <dd>{{ selectedSpeciesRequest.id || rt('unavailable') }}</dd>
        </div>
        <div>
          <dt>{{ ct('Scientific Name') }}</dt>
          <dd>{{ selectedSpeciesRequest.scientificName || rt('unavailable') }}</dd>
        </div>
        <div>
          <dt>{{ ct('Common Name') }}</dt>
          <dd>{{ selectedSpeciesRequest.commonName || rt('unavailable') }}</dd>
        </div>
        <div>
          <dt>{{ ct('Genus') }}</dt>
          <dd>{{ selectedSpeciesRequest.genus || rt('unavailable') }}</dd>
        </div>
        <div>
          <dt>{{ ct('Family') }}</dt>
          <dd>{{ selectedSpeciesRequest.family || rt('unavailable') }}</dd>
        </div>
        <div>
          <dt>{{ ct('Conservation Status') }}</dt>
          <dd>{{ selectedSpeciesRequest.conservationStatus || rt('unavailable') }}</dd>
        </div>
        <div>
          <dt>{{ ct('Description') }}</dt>
          <dd>{{ selectedSpeciesRequest.description || rt('unavailable') }}</dd>
        </div>
        <div>
          <dt>{{ ct('Habitat / Ecological Information') }}</dt>
          <dd>{{ selectedSpeciesRequest.habitat || rt('unavailable') }}</dd>
        </div>
        <div>
          <dt>{{ ct('Submitted By') }}</dt>
          <dd>{{ selectedSpeciesRequest.requestedBy || rt('unavailable') }}</dd>
        </div>
        <div>
          <dt>{{ ct('Submitted At') }}</dt>
          <dd>{{ formatDate(selectedSpeciesRequest.submittedAt) }}</dd>
        </div>
        <div>
          <dt>{{ rt('speciesRequest.storedComment') }}</dt>
          <dd>{{ selectedSpeciesRequest.reviewComment || '—' }}</dd>
        </div>
      </dl>
      <div v-if="selectedSpeciesRequest.assets.length" class="submission-image-grid">
        <article
          v-for="asset in selectedSpeciesRequest.assets"
          :key="asset.id"
          class="submitted-image-item"
        >
          <div class="submitted-image-preview">
            <img
              v-if="asset.contentType.startsWith('image/') && !failedAssets.has(asset.id)"
              :src="assetUrl(asset.id)"
              :alt="rt('speciesRequest.imageAlt', { id: asset.id })"
              loading="lazy"
              @error="imageFailed(asset.id)"
            />
            <span v-else>{{
              rt(asset.contentType.startsWith('image/') ? 'imageUnavailable' : 'attachment')
            }}</span>
          </div>
          <small class="asset-id">{{ asset.id }} · {{ asset.contentType }}</small>
        </article>
      </div>
      <p v-else>{{ rt('noAssets') }}</p>
      <section
        v-if="speciesResolved"
        class="approved-species"
        aria-labelledby="approved-species-heading"
      >
        <h4 id="approved-species-heading">{{ rt('speciesRequest.approvedSpecies') }}</h4>
        <dl class="species-request-details">
          <div>
            <dt>{{ ct('Species ID') }}</dt>
            <dd>{{ selected.speciesId }}</dd>
          </div>
          <div>
            <dt>{{ ct('Scientific Name') }}</dt>
            <dd>{{ selected.scientificName }}</dd>
          </div>
          <div>
            <dt>{{ ct('Common Name') }}</dt>
            <dd>{{ selected.commonName || rt('unavailable') }}</dd>
          </div>
        </dl>
      </section>
      <label class="form-field">
        <span>{{ rt('speciesRequest.comment') }}</span>
        <textarea
          v-model="speciesReviewComment"
          :disabled="!canReviewSpecies"
          maxlength="4000"
          aria-describedby="species-request-comment-help"
        />
      </label>
      <label v-if="canReviewSpecies">
        Visibility
        <select v-model="speciesVisibility" :disabled="speciesSaving">
          <option disabled value="">Select visibility</option>
          <option value="public">Public</option>
          <option value="internal">Internal</option>
          <option value="protected">Protected</option>
        </select>
      </label>
      <p id="species-request-comment-help">{{ rt('speciesRequest.commentHelp') }}</p>
      <div class="species-request-actions" :aria-busy="speciesSaving">
        <button
          type="button"
          class="primary-button"
          :disabled="!canReviewSpecies"
          @click="decideSpecies('Approved')"
        >
          {{ rt('speciesRequest.approve') }}
        </button>
        <button
          type="button"
          class="danger-button"
          :disabled="!canReviewSpecies"
          @click="decideSpecies('Rejected')"
        >
          {{ rt('speciesRequest.reject') }}
        </button>
        <button
          type="button"
          class="secondary-button"
          :disabled="!canReviewSpecies"
          @click="decideSpecies('Correction Required')"
        >
          {{ rt('speciesRequest.correct') }}
        </button>
        <button
          type="button"
          class="secondary-button"
          :disabled="reviewBusy || speciesRefreshing"
          @click="refreshSpeciesRequest"
        >
          {{ rt('speciesRequest.refresh') }}
        </button>
      </div>
    </section>
    <section class="review-section">
      <h3>{{ rt('speciesRequest.plantObservation') }}</h3>
      <p class="section-kicker">{{ ct('PLANT & SPECIES INFORMATION') }}</p>
      <div class="two-column">
        <div>
          <h4>{{ rt('selectedSpecies') }}</h4>
          <dl class="detail-list">
            <div>
              <dt>{{ ct('Plant ID') }}</dt>
              <dd>{{ selected.plantId || '—' }}</dd>
            </div>
            <div>
              <dt>{{ ct('Species ID') }}</dt>
              <dd>{{ selected.speciesId || '—' }}</dd>
            </div>
            <div>
              <dt>{{ rt('speciesScientificName') }}</dt>
              <dd>{{ selectedSpecies?.scientificName || '—' }}</dd>
            </div>
            <div>
              <dt>{{ rt('speciesCommonName') }}</dt>
              <dd>{{ selectedSpecies?.commonName || '—' }}</dd>
            </div>
            <div>
              <dt>{{ rt('speciesRequestIdLabel') }}</dt>
              <dd v-if="selectedSpeciesRequest">
                {{ selectedSpeciesRequest.id || rt('requestDetailsUnavailable') }}
                <span v-if="selectedSpeciesRequest.state === 'unavailable' || selectedSpeciesRequest.status.toLowerCase() === 'unavailable'"> · {{ rt('requestDetailsUnavailable') }}</span>
                <span v-else> · {{ ct(selectedSpeciesRequest.status || rt('requestDetailsUnavailable')) }}</span>
              </dd>
              <dd v-else>{{ rt('noLinkedSpeciesRequest') }}</dd>
            </div>
          </dl>

          <p class="section-kicker review-subsection-heading">
            {{ ct('OBSERVATION INFORMATION') }}
          </p>
          <dl class="detail-list">
            <div>
              <dt>{{ ct('Height') }}</dt>
              <dd>{{ selected.height || '—' }}</dd>
            </div>
            <div>
              <dt>{{ ct('Growth Stage') }}</dt>
              <dd>{{ selected.growthStage ? ct(selected.growthStage) : '—' }}</dd>
            </div>
            <div>
              <dt>{{ ct('Health Status') }}</dt>
              <dd>{{ selected.health ? ct(selected.health) : '—' }}</dd>
            </div>
            <div>
              <dt>{{ ct('Morphology') }}</dt>
              <dd>{{ selected.morphology || '—' }}</dd>
            </div>
            <div>
              <dt>{{ ct('Description / Notes') }}</dt>
              <dd>{{ selected.notes || '—' }}</dd>
            </div>
          </dl>

          <p class="section-kicker review-subsection-heading">
            {{ rt('submissionLocation') }}
          </p>
          <dl class="detail-list">
            <div>
              <dt>{{ ct('Location Zone') }}</dt>
              <dd>{{ selected.zone || rt('notRecorded') }}</dd>
            </div>
            <div>
              <dt>{{ ct('Latitude') }}</dt>
              <dd>{{ selected.latitude || rt('unavailable') }}</dd>
            </div>
            <div>
              <dt>{{ ct('Longitude') }}</dt>
              <dd>{{ selected.longitude || rt('unavailable') }}</dd>
            </div>
            <div>
              <dt>{{ ct('Altitude') }}</dt>
              <dd>{{ selected.altitude !== '' ? `${selected.altitude} m` : rt('notRecorded') }}</dd>
            </div>
            <div>
              <dt>{{ ct('GPS Accuracy') }}</dt>
              <dd>
                {{ selected.gpsAccuracy !== '' ? `${selected.gpsAccuracy} m` : rt('unavailable') }}
              </dd>
            </div>
          </dl>

          <p class="section-kicker review-subsection-heading">{{ rt('currentPlantQr') }}</p>
          <p v-if="qrLoading" role="status">{{ rt('qrLoading') }}</p>
          <p v-else-if="qrError" role="alert">{{ qrError }}</p>
          <dl v-else-if="plantQr" class="detail-list">
            <div>
              <dt>{{ rt('qrIdentity') }}</dt>
              <dd>{{ plantQr.identity || rt('notRecorded') }}</dd>
            </div>
            <div>
              <dt>{{ rt('qrStatus') }}</dt>
              <dd>{{ plantQr.status || rt('notRecorded') }}</dd>
            </div>
          </dl>

          <p class="section-kicker review-subsection-heading">{{ ct('SUBMITTED IMAGES') }}</p>
          <p v-if="!selected.assets.length">{{ rt('noAssets') }}</p>
          <div v-else class="submission-image-grid">
            <article v-for="asset in selected.assets" :key="asset.id" class="submitted-image-item">
              <div class="submitted-image-preview">
                <img
                  v-if="asset.contentType.startsWith('image/') && !failedAssets.has(asset.id)"
                  :src="assetUrl(asset.id)"
                  :alt="rt('imageAlt', { id: selected.displayId, asset: asset.id })"
                  loading="lazy"
                  @error="imageFailed(asset.id)"
                />
                <span v-else>{{
                  rt(asset.contentType.startsWith('image/') ? 'imageUnavailable' : 'attachment')
                }}</span>
              </div>
              <div class="submitted-image-caption">
                <strong class="asset-id" :title="asset.id">{{ asset.id }}</strong>
                <small>{{ asset.contentType }}</small>
              </div>
            </article>
          </div>

          <p class="section-kicker review-subsection-heading">
            {{ ct('SUBMISSION INFORMATION') }}
          </p>
          <dl class="detail-list">
            <div>
              <dt>{{ ct('Submitted By') }}</dt>
              <dd>{{ selected.recordedBy || '—' }}</dd>
            </div>
            <div>
              <dt>{{ rt('recordCreated') }}</dt>
              <dd>{{ formatDate(selected.createdAt) }}</dd>
            </div>
            <div>
              <dt>{{ rt('lastUpdated') }}</dt>
              <dd>{{ formatDate(selected.updatedAt) }}</dd>
            </div>
            <div>
              <dt>{{ rt('reviewedAt') }}</dt>
              <dd>{{ formatDate(selected.reviewedAt) }}</dd>
            </div>
            <div>
              <dt>{{ rt('reviewDecision') }}</dt>
              <dd>{{ selected.reviewDecision ? ct(selected.reviewDecision) : '—' }}</dd>
            </div>
            <div>
              <dt>{{ ct('Status') }}</dt>
              <dd>{{ selected.status ? ct(selected.status) : '—' }}</dd>
            </div>
          </dl>
        </div>
        <aside>
          <p class="section-kicker">{{ ct('REVIEW DECISION') }}</p>
          <section class="review-similarity-summary" aria-labelledby="review-similarity-heading">
            <div>
              <span>Frontend prototype</span>
              <h3 id="review-similarity-heading">AI Plant Similarity</h3>
              <p v-if="similarityFor(selected.displayId)?.status === 'available'">
                Highest mock visual match:
                <strong>{{
                  formatSimilarity(similarityFor(selected.displayId)!.highestSimilarity)
                }}</strong>
              </p>
              <p v-else>{{ rt('similarityUnavailable') }}</p>
            </div>
            <button
              v-if="similarityFor(selected.displayId)?.status === 'available'"
              class="secondary-button"
              type="button"
              @click="openSimilarity(similarityFor(selected.displayId)!, $event)"
            >
              View matches
            </button>
          </section>
          <h3>{{ rt('loadedHistory') }}</h3>
          <p>{{ rt('historyLimit') }}</p>
          <div
            v-for="observation in observations.filter((item) => item.plantId === selected?.plantId)"
            :key="observation.id"
            class="history-item"
          >
            <strong class="observation-id" :title="observation.id">{{
              observation.displayId
            }}</strong
            ><span
              >{{ formatDate(observation.createdAt) }} · {{ observation.height || '—' }} ·
              {{ observation.health ? ct(observation.health) : '—' }}</span
            >
          </div>
          <label class="form-field officer-comment"
            ><span>{{ ct('Observation Review Comment') }}</span
            ><textarea
              v-model="comment"
              :disabled="reviewBusy || selectionLoading"
              :placeholder="ct('Record the observation decision or required action')"
            ></textarea>
          </label>
        </aside>
      </div>
    </section>

    <p
      v-if="reviewMessage"
      :role="reviewMessage.variant === 'error' ? 'alert' : 'status'"
      class="review-feedback"
      :class="reviewMessage.variant"
    >
      {{ reviewMessage.message }}
    </p>
    <p v-if="isSaving" role="status">{{ rt('saving') }}</p>
    <button
      v-if="needsReload && !selectionError"
      class="secondary-button"
      :disabled="reviewBusy"
      @click="reloadSelected"
    >
      {{ rt('reloadLatest') }}
    </button>
    <label v-if="!conflictAcknowledged && !needsReload" class="conflict-confirmation">
      <input v-model="conflictAcknowledged" type="checkbox" :disabled="reviewBusy" />
      {{ rt('acknowledgeLatest') }}
    </label>
    <h3>{{ rt('speciesRequest.plantDecision') }}</h3>
    <p
      v-if="
        selectedSpeciesRequest &&
        (!speciesResolved ||
          speciesRefreshing ||
          speciesSaving ||
          speciesLoadError ||
          speciesNeedsReload)
      "
      id="plant-species-gate"
      class="species-gate-notice"
      role="status"
    >
      {{ rt('speciesRequest.resolveFirst') }}
    </p>
    <div
      class="modal-actions"
      role="group"
      :aria-label="rt('speciesRequest.plantDecision')"
      :aria-busy="reviewBusy"
      :aria-describedby="
        selectedSpeciesRequest &&
        (!speciesResolved ||
          speciesRefreshing ||
          speciesSaving ||
          speciesLoadError ||
          speciesNeedsReload)
          ? 'plant-species-gate'
          : undefined
      "
    >
      <button class="primary-button" :disabled="!canDecide('Approved')" @click="decide('Approved')">
        {{ ct('Approve') }}
      </button>
      <button class="danger-button" :disabled="!canDecide('Rejected')" @click="decide('Rejected')">
        {{ ct('Reject') }}
      </button>
      <button
        class="secondary-button"
        :disabled="!canDecide('Correction Required')"
        @click="decide('Correction Required')"
      >
        {{ ct('Request Correction') }}
      </button>
      <button class="secondary-button" :disabled="!canDecide('Flagged')" @click="decide('Flagged')">
        {{ ct('Flag') }}
      </button>
    </div>
  </AppModal>

  <PlantSimilarityDrawer
    v-if="similarityAnalysis"
    :analysis="similarityAnalysis"
    @close="closeSimilarity"
  />
</template>

<style scoped>
.two-column > div { min-width: 0; }
.detail-list dd { min-width: 0; overflow-wrap: anywhere; }
.species-request-card {
  margin-bottom: 24px;
  padding: 18px;
  border: 1px solid #aac8b6;
  border-left: 4px solid #39785a;
  border-radius: 12px;
  background: #f5faf5;
  color: #294c3c;
}
.species-request-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.species-request-header h3 {
  margin: 5px 0 10px;
}
.species-request-badge {
  display: inline-block;
  padding: 5px 8px;
  border: 1px solid #b8cebd;
  border-radius: 8px;
  background: #e7f1e7;
  font-size: 10px;
  font-weight: 700;
}
.species-request-list {
  display: grid;
  gap: 6px;
}
.species-request-details {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 18px;
}
.species-request-details dt {
  font-size: 10px;
  font-weight: 700;
}
.species-request-details dd {
  margin: 4px 0 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.species-request-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.approved-species,
.species-gate-notice {
  margin: 14px 0;
  padding: 12px;
  border: 1px solid #c7daca;
  border-radius: 8px;
  background: #eaf3e9;
}
@media (max-width: 620px) {
  .species-request-header {
    flex-direction: column;
  }
  .species-request-details {
    grid-template-columns: 1fr;
  }
  .species-request-actions button {
    width: 100%;
  }
}
.observation-id,
.asset-id {
  display: block;
  max-width: 180px;
  overflow-wrap: anywhere;
}
.review-feedback {
  padding: 12px;
  border-radius: 8px;
}
.review-feedback.error {
  color: #8a2929;
  background: #fff0ed;
}
.review-feedback.success {
  color: #245b3d;
  background: #e8f3ec;
}
.conflict-confirmation {
  display: block;
  padding: 12px 0;
}
button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.similarity-badge-button {
  min-width: 58px;
  padding: 5px 8px;
  display: inline-grid;
  justify-items: center;
  gap: 1px;
  border: 1px solid #bcd7c8;
  border-radius: 9px;
  background: #e8f3ec;
  color: #287a53;
  cursor: pointer;
}
.similarity-badge-button strong {
  color: inherit;
  font-size: 10px;
  line-height: 1.1;
}
.similarity-badge-button span {
  font-size: 7px;
  font-weight: 800;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.similarity-badge-button:hover {
  border-color: #73a68e;
  background: #dceee3;
}
.similarity-badge-button:focus-visible {
  outline: 3px solid rgba(65, 132, 104, 0.22);
  outline-offset: 2px;
}
.similarity-unavailable {
  color: #89968f;
  font-size: 9px;
}
.review-similarity-summary {
  margin: 10px 0 20px;
  padding: 14px;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid #d6e5dc;
  border-radius: 10px;
  background: #f6faf7;
}
.review-similarity-summary span {
  color: #698075;
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.review-similarity-summary h3 {
  margin: 4px 0;
  color: #315749;
  font-size: 12px;
}
.review-similarity-summary p {
  margin: 0;
  color: #71817a;
  font-size: 9px;
  line-height: 1.45;
}
.review-similarity-summary p strong {
  color: #287a53;
}
.review-similarity-summary .secondary-button {
  flex: 0 0 auto;
}
.review-subsection-heading {
  margin-top: 24px;
  margin-bottom: 12px;
}
.submission-image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(145px, 1fr));
  gap: 10px;
}
.submitted-image-item {
  min-width: 0;
}
.submitted-image-preview {
  width: 100%;
  aspect-ratio: 4 / 3;
  display: grid;
  place-items: center;
  padding: 12px;
  border: 1px dashed #a9c1b4;
  border-radius: 10px;
  background: #edf4ee;
  color: #587568;
  text-align: center;
  font-size: 10px;
  line-height: 1.4;
}
.submitted-image-preview img {
  width: 100%;
  height: 100%;
  border-radius: inherit;
  object-fit: cover;
}
.submitted-image-caption {
  padding: 8px 2px 0;
  display: grid;
  gap: 3px;
}
.submitted-image-caption strong {
  color: #38594c;
  font-size: 11px;
}
.submitted-image-caption small {
  color: #71857b;
  font-size: 10px;
  line-height: 1.4;
}
.history-item {
  padding: 10px 0;
  display: grid;
  gap: 3px;
  border-bottom: 1px solid #edf0ed;
  font-size: 10px;
}
.history-item span {
  color: #829088;
}
.officer-comment {
  margin-top: 18px;
}
.form-error {
  color: #b84d42;
  font-size: 10px;
}
.review-section > .section-kicker {
  margin-bottom: 14px;
}
@media (max-width: 620px) {
  .review-similarity-summary {
    align-items: flex-start;
    flex-direction: column;
  }
  .submission-image-grid {
    grid-template-columns: 1fr;
  }
}
</style>
