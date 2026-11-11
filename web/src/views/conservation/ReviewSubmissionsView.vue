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
import type { PlantSimilarityAnalysis } from '../../data/plantSimilarityPrototype'

interface ReviewObservation {
  origin: ObservationOrigin
  // Raw backend ID is authoritative; displayId preserves numeric legacy presentation only.
  id: string
  displayId: string
  isCorrectionResubmission: boolean
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
const copyFeedback = ref('')
const copyFailed = ref(false)
const copyPending = ref(false)
const copiedKey = ref('')
let copyAttempt = 0
function clearCopyState() {
  copyAttempt++
  copyFeedback.value = ''; copiedKey.value = ''; copyFailed.value = false; copyPending.value = false
}
const search = ref('')
const status = ref('')
const species = ref('')
const date = ref('')
const selected = ref<ReviewObservation | null>(null)
const standaloneRequest = ref<LinkedSpeciesRequest | null>(null)
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
const qrCopyFeedback = ref('')
const qrCopyFailed = ref(false)
const qrCopyPending = ref(false)
const qrCopied = ref(false)
const knownQrIdentities = ref(new Set<string>())
let qrCopyAttempt = 0
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
const similarityResults = ref<Record<string, PlantSimilarityAnalysis>>({})
const similarityErrors = ref<Record<string, string>>({})
const similarityLoading = ref('')
let similarityAbort: AbortController | null = null
let similarityRequest = 0
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
    isCorrectionResubmission: item.is_correction_resubmission === true && observationOrigin(item.origin_type) !== 'unknown',
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
  ['Rejected', observations.value.filter((o) => o.status === 'Rejected').length],
  [
    'Approved Today',
    observations.value.filter(
      (o) => o.status === 'Approved' && dateKey(o.reviewedAt) === dateKey(new Date().toISOString()),
    ).length,
  ],
])

// Display only: canonical IDs/subjects remain unchanged on each observation.
function compactIdentifierTokens(values: readonly string[], part: (value: string) => string = value => value) {
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
  const entries = [...new Set(values)].map(value => {
    const raw = part(value), isUuid = uuid.test(raw)
    return { value, token: isUuid ? raw.replaceAll('-', '').toUpperCase() : raw, isUuid }
  })
  const counts = new Map<string, number>()
  for (const { token } of entries) {
    let length = Math.min(8, token.length)
    while (true) {
      const prefix = token.slice(0, length)
      counts.set(prefix, (counts.get(prefix) || 0) + 1)
      if (length === token.length) break
      length = Math.min(length + 4, token.length)
    }
  }
  return new Map(entries.map(({ value, token, isUuid }) => {
    let length = Math.min(8, token.length)
    while ((counts.get(token.slice(0, length)) || 0) > 1 && length < token.length) length = Math.min(length + 4, token.length)
    // Normalized UUIDs differing only in case still retain their exact, distinct identities.
    const label = (counts.get(token.slice(0, length)) || 0) > 1 ? value : token.slice(0, length) + (length < token.length && !isUuid ? '\u2026' : '')
    return [value, label]
  }))
}
const observationLabels = computed(() => compactIdentifierTokens([...observations.value.map(item => item.id), ...(selected.value ? [selected.value.id] : [])]))
const observationLabel = (id: string) => `OBS-${/^[0-9]+$/.test(id) ? id : observationLabels.value.get(id) || id}`
const subjectPart = (subject: string) => /^(staff|visitor):/.test(subject) ? subject.slice(subject.indexOf(':') + 1) : subject
const subjectTokens = computed(() => compactIdentifierTokens([...observations.value.map(item => item.recordedBy), ...(selected.value ? [selected.value.recordedBy] : [])].filter(Boolean), subjectPart))
const submitterLabel = (subject: string) => {
  if (!subject) return rt('unavailable')
  const account = reviewSession.value.user
  // The existing authenticated session can identify only this exact account.
  // Other submitters have no authorized name/directory mapping on this page.
  if (officerSessionReady.value && account && subject === `staff:${account.id}` && account.name?.trim()) return account.name.trim()
  const key = subject.startsWith('staff:') ? 'staffIdentifier' : subject.startsWith('visitor:') ? 'visitorIdentifier' : 'submitterIdentifier'
  return t('conservationPages.observations.' + key, { id: subjectTokens.value.get(subject) || subjectPart(subject) })
}
async function copyIdentifier(value: string, kind: 'observation' | 'subject') {
  if (!officerSessionReady.value || copyPending.value || !observations.value.some(item => (kind === 'observation' ? item.id : item.recordedBy) === value) || !value) return
  const attempt = ++copyAttempt, actor = reviewSession.value.user?.id
  const current = () => !disposed && attempt === copyAttempt && officerSessionReady.value && actor === reviewSession.value.user?.id
  copyPending.value = true; copiedKey.value = ''; copyFeedback.value = ''; copyFailed.value = false
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
    await navigator.clipboard.writeText(value)
    if (!current()) return
    copiedKey.value = `${kind}:${value}`
    copyFeedback.value = t('conservationPages.observations.' + (kind === 'observation' ? 'copiedObservation' : 'copiedSubject'), { id: kind === 'observation' ? observationLabel(value) : submitterLabel(value) })
  } catch {
    if (current()) { copyFailed.value = true; copyFeedback.value = t('conservationPages.observations.copyUnavailable') }
  } finally { if (current()) copyPending.value = false }
}


const filtered = computed(() =>
  observations.value.filter((observation) => {
    if (observation.origin !== queueOrigin.value) return false
    const searchable = `${observation.id} ${observation.plantId} ${observation.speciesId} ${observation.scientificName} ${observation.commonName} ${observation.recordedBy} ${observation.status} ${observationLabel(observation.id)} ${submitterLabel(observation.recordedBy)}`
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
const selectedSpeciesRequest = computed(() => standaloneRequest.value || selected.value?.speciesRequest || null)
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
  return !standaloneRequest.value && request?.state === 'approved' && !speciesResolved.value
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
    similarityRequest++
    similarityAbort?.abort()
    similarityLoading.value = ''
    similarityResults.value = {}
    similarityErrors.value = {}
    similarityAnalysis.value = null
    similarityTrigger.value = null
    clearCopyState()
    knownQrIdentities.value = new Set()

    clearPlantQr()
    listRequest++; observations.value = []; hasMore.value = false; nextCursor.value = null; isLoading.value = false
    selectionRequest++; selectionLoading.value = false; selectionError.value = ''; selected.value = null; standaloneRequest.value = null; speciesSaving.value = false; speciesRefreshing.value = false; comment.value = ''; needsReload.value = true
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
    selectedSpeciesRequest.value?.requestedBy !== `staff:${reviewSession.value.user?.id}` &&
    (Boolean(standaloneRequest.value) || selected.value?.origin === queueOrigin.value) &&
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
  similarityRequest++
  similarityAbort?.abort()
  similarityLoading.value = ''
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
  similarityRequest++
  similarityAbort?.abort()
  similarityLoading.value = ''
  clearPlantQr()
  selectionRequest++
  selectionLoading.value = false
  selectionError.value = ''
  selected.value = null
  resetSpeciesState()
  const query = { ...route.query }
  standaloneRequest.value = null
  delete query.speciesRequest
  delete query.review
  void router.replace({ query })
}

const similarityFor = (observationId: string) => similarityResults.value[observationId]

const formatSimilarity = (value: number) => `${Math.round(value * 100)}%`

function openSimilarity(analysis: PlantSimilarityAnalysis, event: Event) {
  similarityTrigger.value = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  similarityAnalysis.value = analysis
}

function parseSimilarity(value: unknown, observation: ReviewObservation): PlantSimilarityAnalysis {
  const data = record(value)
  if (!data || data.observationId !== observation.id || data.plantId !== observation.plantId ||
      data.status !== 'available' || !Array.isArray(data.candidates) ||
      data.candidates.length < 1 || data.candidates.length > 5)
    throw new Error('The similarity service returned an invalid result.')
  const candidates: PlantSimilarityAnalysis['candidates'] = []
  const seen = new Set<string>()
  for (const [index, value] of data.candidates.entries()) {
    const candidate = record(value)
    if (!candidate || typeof candidate.plantId !== 'string' || !/^PL[0-9]+$/.test(candidate.plantId) ||
        candidate.plantId === observation.plantId || seen.has(candidate.plantId) ||
        candidate.rank !== index + 1 || typeof candidate.similarity !== 'number' ||
        !Number.isFinite(candidate.similarity) || Math.abs(candidate.similarity) > 1 ||
        (candidate.distanceMeters !== undefined &&
          (typeof candidate.distanceMeters !== 'number' || !Number.isFinite(candidate.distanceMeters) || candidate.distanceMeters < 0)))
      throw new Error('The similarity service returned an invalid candidate.')
    seen.add(candidate.plantId)
    const rawObservationId = stringValue(candidate.observationId)
    candidates.push({ rank: index + 1, plantId: candidate.plantId,
      observationId: formatObservationId(rawObservationId) || rawObservationId || undefined,
      scientificName: stringValue(candidate.scientificName) || undefined,
      commonName: stringValue(candidate.commonName) || undefined,
      similarity: candidate.similarity,
      distanceMeters: candidate.distanceMeters as number | undefined })
  }
  if (data.highestSimilarity !== candidates[0]?.similarity)
    throw new Error('The similarity service returned inconsistent scores.')
  return { observationId: observation.displayId, plantId: observation.plantId,
    status: 'available', highestSimilarity: data.highestSimilarity as number, candidates }
}

async function checkSimilarity(observation: ReviewObservation, event: Event) {
  if (disposed || !officerSessionReady.value) return
  const cached = similarityFor(observation.id)
  if (cached) {
    openSimilarity(cached, event)
    return
  }
  const trigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  similarityAbort?.abort()
  const controller = new AbortController()
  similarityAbort = controller
  const token = ++similarityRequest
  similarityLoading.value = observation.id
  delete similarityErrors.value[observation.id]
  const timeout = window.setTimeout(() => controller.abort(), 180000)
  try {
    const response = await fetch(`/api/data/observations/${encodeURIComponent(observation.id)}/similarity`, {
      credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
    })
    const result: unknown = await response.json()
    if (!response.ok) {
      const error = record(result)
      throw new Error(typeof error?.error === 'string' ? error.error : 'Unable to compare this observation.')
    }
    const analysis = parseSimilarity(result, observation)
    if (disposed || token !== similarityRequest) return
    similarityResults.value[observation.id] = analysis
    similarityTrigger.value = trigger
    similarityAnalysis.value = analysis
  } catch (error) {
    if (!disposed && token === similarityRequest)
      similarityErrors.value[observation.id] = controller.signal.aborted
        ? 'Comparison timed out. Check the BioCLIP terminal and retry.'
        : error instanceof Error ? error.message : 'Unable to compare this observation.'
  } finally {
    window.clearTimeout(timeout)
    if (token === similarityRequest) similarityLoading.value = ''
  }
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
const qrLabel = (value: string) => compactIdentifierTokens([...knownQrIdentities.value, value]).get(value) || value
async function copyQrIdentity() {
  const value = plantQr.value?.identity, observationId = selected.value?.id
  if (!officerSessionReady.value || !value || !observationId || qrLoading.value || qrError.value || qrCopyPending.value) return
  const attempt = ++qrCopyAttempt, actor = reviewSession.value.user?.id
  const current = () => !disposed && attempt === qrCopyAttempt && officerSessionReady.value &&
    actor === reviewSession.value.user?.id && selected.value?.id === observationId && plantQr.value?.identity === value
  qrCopyPending.value = true; qrCopyFeedback.value = ''; qrCopyFailed.value = false; qrCopied.value = false
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
    await navigator.clipboard.writeText(value)
    if (current()) { qrCopied.value = true; qrCopyFeedback.value = rt('qrCopied') }
  } catch {
    if (current()) { qrCopyFailed.value = true; qrCopyFeedback.value = rt('qrCopyUnavailable') }
  } finally { if (current()) qrCopyPending.value = false }
}
function clearPlantQr() {
  qrCopyAttempt++
  qrCopyFeedback.value = ''; qrCopyFailed.value = false; qrCopyPending.value = false; qrCopied.value = false
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
    if (plantQr.value.identity) knownQrIdentities.value = new Set([...knownQrIdentities.value, plantQr.value.identity])
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
  if (similarityLoading.value === observation.id) {
    similarityRequest++
    similarityAbort?.abort()
    similarityLoading.value = ''
  }
  delete similarityResults.value[observation.id]
  delete similarityErrors.value[observation.id]
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
  if (standaloneRequest.value) { await refreshStandaloneRequest(); return }
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
  if ((!selected.value && !standaloneRequest.value) || !canReviewSpecies.value || !selectedSpeciesRequest.value) return
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
  if (standaloneRequest.value) { await decideStandaloneSpecies(decision, typedComment); return }
  const observationId = selected.value!.id
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
async function fetchStandaloneRequest(id: string) {
  if (!/^[1-9][0-9]{0,9}$/.test(id) || BigInt(id) > 2147483647n) throw new ReviewApiError(rt('feedback.invalidId'))
  const result = await request('/api/species-requests/' + encodeURIComponent(id))
  const data = record(result.species_request)
  if (!data || String(data.request_id) !== id) throw new ReviewApiError(rt('feedback.invalidResponse'))
  const mapped = mapLinkedSpeciesRequest({ species_request_id: id, species_request: {
    ...data, proposed_scientific_name: data.scientific_name,
    assets: [{ id: 'species-request-' + id, content_type: 'image/jpeg' }],
  } })
  if (!mapped || ['error','unknown','unavailable'].includes(mapped.state)) throw new ReviewApiError(rt('feedback.invalidResponse'))
  return mapped
}
async function refreshStandaloneRequest() {
  if (!standaloneRequest.value || reviewBusy.value || speciesRefreshing.value || !officerSessionReady.value) return
  const id = standaloneRequest.value.id, token = ++selectionRequest
  speciesRefreshing.value = true; speciesLoadError.value = ''
  try {
    const fresh = await fetchStandaloneRequest(id)
    if (!disposed && token === selectionRequest && officerSessionReady.value) { standaloneRequest.value = fresh; speciesNeedsReload.value = false; speciesSaveError.value = '' }
  } catch (error) { if (!disposed && token === selectionRequest) speciesLoadError.value = error instanceof Error ? error.message : rt('speciesRequest.loadFailed') }
  finally { if (!disposed && token === selectionRequest) speciesRefreshing.value = false }
}
async function decideStandaloneSpecies(decision: SpeciesRequestDecision, typedComment: string) {
  const id = standaloneRequest.value!.id, token = ++selectionRequest
  speciesSaving.value = true; speciesSaveError.value = ''; reviewMessage.value = null
  let committed = false
  const current = () => !disposed && token === selectionRequest && officerSessionReady.value && route.query.speciesRequest === id
  try {
    const fresh = await fetchStandaloneRequest(id)
    if (!current()) return
    standaloneRequest.value = fresh
    if (fresh.state !== 'pending' || fresh.requestedBy === `staff:${reviewSession.value.user?.id}`) throw new ReviewApiError(rt('speciesRequest.conflict'), 409)
    const result = await request(speciesRequestReviewUrl(id), { decision, comment: typedComment,
      ...(decision === 'Approved' ? { visibility: speciesVisibility.value } : {}) })
    if (!current()) return
    if (result.reviewed !== true) throw new ReviewApiError(rt('feedback.invalidResponse'))
    committed = true
    const saved = await fetchStandaloneRequest(id)
    if (!current()) return
    standaloneRequest.value = saved
    if (saved.status !== decision) throw new ReviewApiError(rt('feedback.invalidResponse'))
    showFeedback(rt('speciesRequest.saved'), 'success')
  } catch (error) {
    if (!current()) return
    if (error instanceof ReviewApiError && error.status === 409 && !committed) {
      try { const fresh = await fetchStandaloneRequest(id); if (!current()) return; standaloneRequest.value = fresh }
      catch { if (current()) { speciesNeedsReload.value = true; speciesLoadError.value = rt('speciesRequest.conflictReloadFailed') } }
    } else speciesNeedsReload.value = committed || !(error instanceof ReviewApiError) || ![400,401,403].includes(error.status)
    speciesSaveError.value = committed ? rt('speciesRequest.savedReloadFailed') : error instanceof Error ? error.message : rt('speciesRequest.loadFailed')
    speciesReviewComment.value = typedComment
  } finally {
    if (!disposed && token === selectionRequest) { speciesSaving.value = false; if (route.query.speciesRequest !== id) void resolveQuery() }
  }
}
async function resolveStandaloneQuery() {
  const id = route.query.speciesRequest
  if (standaloneRequest.value?.id === id) return
  const token = ++selectionRequest
  selected.value = null; standaloneRequest.value = null; clearPlantQr(); resetSpeciesState()
  selectionError.value = ''; selectionLoading.value = true; needsReload.value = false; reviewMessage.value = null
  try {
    if (route.query.review || typeof id !== 'string') throw new ReviewApiError(rt('feedback.invalidId'))
    const fresh = await fetchStandaloneRequest(id)
    if (!disposed && token === selectionRequest && officerSessionReady.value) { standaloneRequest.value = fresh; speciesReviewComment.value = fresh.reviewComment; failedAssets.value = new Set() }
  } catch (error) {
    if (!disposed && token === selectionRequest) { selectionError.value = error instanceof Error ? error.message : rt('speciesRequest.loadFailed'); showFeedback(selectionError.value) }
  } finally { if (!disposed && token === selectionRequest) selectionLoading.value = false }
}
async function resolveQuery() {
  if (isLoading.value || reviewBusy.value || disposed || !officerSessionReady.value) return
  if (route.query.speciesRequest !== undefined) { await resolveStandaloneQuery(); return }
  standaloneRequest.value = null
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
  if (!append) {
    similarityRequest++
    similarityAbort?.abort()
    similarityLoading.value = ''
    similarityResults.value = {}
    similarityErrors.value = {}
    similarityAnalysis.value = null
    similarityTrigger.value = null
    observations.value = []
    nextCursor.value = null
    hasMore.value = false
    skippedRecords.value = 0
  }
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
  () => [route.query.review, route.query.speciesRequest, officerSessionReady.value],
  () => void resolveQuery(),
)
onBeforeUnmount(() => {
  disposed = true
  clearCopyState()
  clearPlantQr()
  unsubscribeReviewSession()
  selectionRequest++
  similarityRequest++
  similarityAbort?.abort()
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

  <section class="page-intro reviews-intro">
    <div>
      <p class="page-kicker">{{ rt('queues.registrationEyebrow') }}</p>
      <h2>{{ rt('queues.registrations') }}</h2>
      <p>{{ rt('queues.registrationIntro') }}</p>
    </div>
  </section>
  <section class="summary-grid review-summary-grid">
    <article v-for="count in counts" :key="String(count[0])" class="summary-card review-summary-card" :class="`review-summary-${String(count[0]).toLowerCase().replaceAll(' ', '-')}`">
      <div class="review-summary-title">
        <p>{{ ct(count[0]) }}</p>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
          <template v-if="count[0] === 'Pending Review'"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></template>
          <path v-else-if="count[0] === 'Correction Required'" d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14z" />
          <path v-else-if="count[0] === 'Flagged'" d="M5 21V3h14l-3 5 3 5H5" />
          <template v-else-if="count[0] === 'Rejected'"><circle cx="12" cy="12" r="9" /><path d="m8 8 8 8M16 8l-8 8" /></template>
          <template v-else><circle cx="12" cy="12" r="9" /><path d="m7 12 3 3 7-7" /></template>
        </svg>
      </div>
      <strong>{{ countValue(count[1]!) }}</strong>
    </article>
  </section>
  <div class="control-bar reviews-filters">
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
    <label class="field">
      <span>{{ rt('recordCreated') }}</span>
      <input v-model="date" type="date" />
    </label>
  </div>
  <p v-if="selectionLoading" role="status">{{ rt('loadingDetail') }}</p>
  <p v-if="skippedRecords" role="status">{{ rt('skippedRecords', { count: skippedRecords }) }}</p>
  <p v-if="queueOrigin === 'unknown'">{{ rt('queues.originUnverified') }}</p>
  <section class="panel reviews-panel">
    <p class="copy-feedback" :class="{ warning: copyFailed }" role="status" aria-live="polite" aria-atomic="true">{{ copyFeedback }}</p>
    <div class="table-scroll reviews-scroll" role="region" :aria-label="rt('queues.registrations')" tabindex="0">
      <table class="reviews-table">
        <colgroup><col class="plant-column" /><col class="observation-column" /><col class="species-column" /><col class="submitter-column" /><col class="zone-column" /><col class="created-column" /><col class="status-column" /><col class="similarity-column" /><col class="actions-column" /></colgroup>
        <thead>
          <tr>
            <th scope="col">{{ ct('Plant ID') }}</th>
            <th scope="col">{{ ct('Observation ID') }}</th>
            <th scope="col">{{ ct('Species') }}</th>
            <th scope="col">{{ ct('Submitted By') }}</th>
            <th scope="col">{{ ct('Location Zone') }}</th>
            <th scope="col">{{ rt('recordCreated') }}</th>
            <th scope="col">{{ ct('Status') }}</th>
            <th scope="col">{{ ct('Similarity') }}</th>
            <th scope="col">{{ ct('Actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="observation in filtered" :key="observation.id">
            <td class="plant-id-cell">{{ observation.plantId }}</td>
          <td class="identity-cell"><div class="identifier-line"><strong :title="observation.id">{{ observationLabel(observation.id) }}</strong><button type="button" class="identifier-copy" :disabled="!officerSessionReady || copyPending" :aria-label="t('conservationPages.observations.copyObservationId', { id: observationLabel(observation.id) })" :title="t('conservationPages.observations.copyObservationId', { id: observationLabel(observation.id) })" @click="copyIdentifier(observation.id, 'observation')"><svg v-if="copiedKey !== `observation:${observation.id}`" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></svg><svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="m5 12 4 4 10-10" /></svg></button></div></td>
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
          <td class="identity-cell"><div class="identifier-line"><span :title="observation.recordedBy">{{ submitterLabel(observation.recordedBy) }}</span><template v-if="observation.recordedBy"><button type="button" class="identifier-copy" :disabled="!officerSessionReady || copyPending" :aria-label="t('conservationPages.observations.copySubject', { id: submitterLabel(observation.recordedBy) })" :title="t('conservationPages.observations.copySubject', { id: submitterLabel(observation.recordedBy) })" @click="copyIdentifier(observation.recordedBy, 'subject')"><svg v-if="copiedKey !== `subject:${observation.recordedBy}`" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></svg><svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="m5 12 4 4 10-10" /></svg></button></template></div></td>
            <td>{{ observation.zone || rt('notRecorded') }}</td>
            <td>{{ formatDate(observation.createdAt) }}</td>
            <td class="status-cell">
              <span class="review-status-group"><span class="badge" :class="observation.status.toLowerCase().replaceAll(' ', '-')">{{
                observation.status ? ct(observation.status) : '—'
              }}</span>
              <span v-if="observation.status === 'Pending Review' && observation.isCorrectionResubmission" class="badge resubmission-tag">{{ t('conservationPages.observations.resubmitted') }}</span></span>
            </td>
            <td>
              <button
                class="similarity-badge-button"
                type="button"
                :disabled="similarityLoading === observation.id || reviewBusy"
                :aria-label="`Check BioCLIP similarity for ${observation.displayId}`"
                @click="checkSimilarity(observation, $event)"
              >
                <strong>{{ similarityLoading === observation.id ? 'Checking...' :
                  similarityFor(observation.id) ? formatSimilarity(similarityFor(observation.id)!.highestSimilarity) : 'Check similarity' }}</strong>
                <span>BioCLIP 2</span>
              </button>
              <small v-if="similarityErrors[observation.id]" class="similarity-unavailable" role="alert">{{ similarityErrors[observation.id] }}</small>
            </td>
            <td class="actions-cell"><div class="action-group">
              <button class="action-button" :disabled="reviewBusy" @click="open(observation)">
                {{ ct('Review') }}
              </button>
            </div></td>
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
    v-if="selected || standaloneRequest"
    :title="standaloneRequest ? rt('speciesRequest.title') : ct('Review {id}', { id: observationLabel(selected!.id) })"
    :subtitle="
      standaloneRequest ? standaloneRequest.scientificName : ct('{id} · submitted by {name}', { id: selected!.plantId, name: submitterLabel(selected!.recordedBy) })
    "
    wide
    @close="closeReview"
  >
    <template v-if="selected">
    <dl v-if="copyFailed" class="detail-list">
      <div><dt>{{ ct('Observation ID') }}</dt><dd class="full-identifier">{{ selected.id }}</dd></div>
    </dl>
    <p v-if="selected.origin === 'unknown'" role="status">{{ rt('queues.originUnverified') }}</p>
    <p v-if="selected.origin !== queueOrigin" role="status">{{ rt('queues.originMoved') }} <RouterLink :to="{ name: 'conservation-observations' }">{{ rt('queues.fieldObservations') }}</RouterLink></p>
    <p v-if="selectionLoading" role="status">{{ rt('loadingLatestObservation') }}</p>
    <div v-if="selectionError" role="alert">
      <p>{{ selectionError }}</p>
      <button class="secondary-button" :disabled="selectionLoading || reviewBusy" @click="retrySelection">{{ rt('retryRefresh') }}</button>
    </div>
    </template>
    <section
      v-if="selectedSpeciesRequest"
      class="species-request-card"
      aria-labelledby="species-request-heading"
      :aria-busy="speciesRefreshing || speciesSaving"
    >
      <header class="species-request-header">
        <div>
          <p v-if="!standaloneRequest" class="section-kicker">{{ rt('speciesRequest.requiredFirst') }}</p>
          <h3 id="species-request-heading">{{ rt('speciesRequest.title') }}</h3>
        </div>
        <span class="species-request-badge">{{
          rt(`speciesRequest.states.${speciesRequestState}`)
        }}</span>
      </header>
      <p :role="speciesLoadError ? 'alert' : 'status'" id="species-request-notice">
        {{ standaloneRequest ? rt(`speciesRequest.states.${speciesRequestState}`) : speciesNotice }}
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
        </article>
      </div>
      <p v-else>{{ rt('noAssets') }}</p>
      <section
        v-if="selected && speciesResolved"
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
    <template v-if="selected">
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
              <dd>
                <div v-if="plantQr.identity" class="identifier-line qr-identifier">
                  <span :title="plantQr.identity">{{ qrLabel(plantQr.identity) }}</span>
                  <button type="button" class="identifier-copy" :disabled="!officerSessionReady || qrCopyPending" :aria-label="rt('copyQrIdentity')" :title="rt('copyQrIdentity')" @click="copyQrIdentity">
                    <svg v-if="!qrCopied" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></svg>
                    <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="m5 12 4 4 10-10" /></svg>
                  </button>
                </div>
                <span v-else>{{ rt('notRecorded') }}</span>
                <span class="qr-copy-feedback" role="status" aria-live="polite" aria-atomic="true">{{ qrCopyFeedback }}</span>
                <span v-if="qrCopyFailed" class="full-identifier qr-copy-fallback">{{ plantQr.identity }}</span>
              </dd>
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
              <span>BioCLIP 2</span>
              <h3 id="review-similarity-heading">AI Plant Similarity</h3>
              <p v-if="similarityFor(selected.id)?.status === 'available'">
                Highest visual similarity:
                <strong>{{
                  formatSimilarity(similarityFor(selected.id)!.highestSimilarity)
                }}</strong>
              </p>
              <p v-else>Compare this submission with approved plant photos.</p>
              <p v-if="similarityErrors[selected.id]" role="alert">{{ similarityErrors[selected.id] }}</p>
            </div>
            <button
              class="secondary-button"
              type="button"
              :disabled="similarityLoading === selected.id || reviewBusy"
              @click="checkSimilarity(selected, $event)"
            >
              {{ similarityLoading === selected.id ? 'Checking...' : similarityFor(selected.id) ? 'View matches' : 'Check similarity' }}
            </button>
          </section>
          <template v-if="selected.origin !== 'initial_registration'">
            <h3>{{ rt('loadedHistory') }}</h3>
            <p>{{ rt('historyLimit') }}</p>
            <div
              v-for="observation in observations.filter((item) => item.plantId === selected?.plantId)"
              :key="observation.id"
              class="history-item"
            >
              <strong class="observation-id" :title="observation.id">{{
                observationLabel(observation.id)
              }}</strong>
              <span class="history-date">{{ formatDate(observation.createdAt) }}</span>
              <div class="history-details">
                <span v-if="observation.health" class="history-health">{{ ct('Health Status') }}: {{ ct(observation.health) }}</span>
                <span v-if="observation.height">{{ ct('Height') }}: {{ observation.height }}</span>
              </div>
            </div>
          </template>
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
      class="modal-actions plant-review-actions"
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
    </template>
    <p v-if="standaloneRequest && reviewMessage" :role="reviewMessage.variant === 'error' ? 'alert' : 'status'">{{ reviewMessage.message }}</p>
  </AppModal>

  <PlantSimilarityDrawer
    v-if="similarityAnalysis"
    :analysis="similarityAnalysis"
    @close="closeSimilarity"
  />
</template>

<style scoped>
.review-status-group { display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
.reviews-table .status-cell .review-status-group .resubmission-tag { background: #FFF1DB; color: #926119; font-size: 12px; padding: 3px 8px; flex-shrink: 0; }

.reviews-intro h2 { font-size: 28px; line-height: 1.2; }
.reviews-intro p { font-size: 14px; line-height: 1.55; }
.reviews-intro .page-kicker { font-size: 12px; line-height: 1.4; }
.reviews-panel > .action-button { font-size: 13px; }

.reviews-filters { align-items: stretch; }
.reviews-filters > .field { grid-template-rows: 1fr 44px; }
.reviews-filters > .field > span { align-self: end; font-size: 12px; line-height: 1.4; }
.reviews-filters > .field > input, .reviews-filters > .field > select { box-sizing: border-box; height: 44px; padding: 9px 10px; font-size: 14px; line-height: 1.4; }
.review-summary-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.review-summary-card { min-width: 0; padding: 18px; border: 1px solid currentColor; border-radius: 14px; background: var(--review-summary-background); color: var(--review-summary-ink); box-shadow: none; }
.review-summary-title { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
.review-summary-title p { margin: 0; color: inherit; font-size: 14px; line-height: 1.5; }
.review-summary-title svg { flex: 0 0 20px; width: 20px; height: 20px; }
.review-summary-card strong { color: inherit; font-size: 30px; line-height: 1.2; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.review-summary-pending-review { --review-summary-background: #e8f0f5; --review-summary-ink: #315d78; }
.review-summary-correction-required { --review-summary-background: #fff1db; --review-summary-ink: #926119; }
.review-summary-flagged { --review-summary-background: #f0eaf8; --review-summary-ink: #69459a; }
.review-summary-rejected { --review-summary-background: #fbe8e5; --review-summary-ink: #a33f35; }
.review-summary-approved-today { --review-summary-background: #e7f3e9; --review-summary-ink: #287347; }
@media (max-width: 1280px) { .review-summary-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 900px) { .review-summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 480px) { .review-summary-grid { grid-template-columns: minmax(0, 1fr); } }
.reviews-scroll { min-width: 0; max-width: 100%; overflow-x: auto; overscroll-behavior-inline: contain; }
.reviews-scroll:focus-visible { outline: 3px solid #315b49; outline-offset: -3px; }
.reviews-table { width: 100%; min-width: 96rem; table-layout: auto; white-space: normal; border-collapse: separate; border-spacing: 0; }
.reviews-table .observation-column { width: 12rem; }
.reviews-table .submitter-column { width: 13rem; }
.reviews-table .plant-column { width: 6rem; }
.reviews-table .species-column { width: 13rem; }
.reviews-table .zone-column { width: 8rem; }
.reviews-table .similarity-column { width: 8rem; }
.reviews-table .status-column, .reviews-table .actions-column { width: 1%; }
.reviews-table .created-column { width: 12rem; }
.reviews-table th, .reviews-table td { padding: 12px 14px; text-align: left; vertical-align: middle; white-space: normal; overflow-wrap: anywhere; }
.reviews-table th { background: #245443; color: #fff; border-bottom-color: #245443; font-size: 12px; font-weight: 700; line-height: 1.4; }
.reviews-table thead th:first-child { border-top-left-radius: 10px; }
.reviews-table thead th:last-child { border-top-right-radius: 10px; }
.reviews-table td { font-size: 14px; line-height: 1.5; }
.reviews-table .plant-id-cell { color: #315749; font-weight: 700; }
.reviews-table .identity-cell strong { color: inherit; font-weight: 400; }
.reviews-table .status-cell, .reviews-table .actions-cell { white-space: nowrap; }
.reviews-table .badge { display: inline-flex; align-items: center; width: max-content; max-width: none; box-sizing: border-box; white-space: nowrap; overflow-wrap: normal; font-size: 12px; line-height: 1.4; vertical-align: middle; }
/* Auto-layout lets nonwrapping status/action content set its own minimum column width. */
.reviews-scroll .reviews-table .action-group { display: flex; flex-wrap: nowrap; align-items: center; justify-content: flex-start; gap: 7px; width: max-content; min-width: max-content; }
.reviews-table .action-group > .action-button { flex: 0 0 auto; width: max-content; min-width: max-content; max-width: none; height: auto; min-height: 32px; white-space: nowrap; overflow-wrap: normal; font-size: 13px; }
.reviews-scroll .reviews-table .identifier-copy { flex: 0 0 44px; width: 44px; min-width: 44px; max-width: 44px; }
.reviews-table .state-cell { padding: 30px 14px; text-align: center; }
@media (max-width: 767px) { .reviews-table .action-group > .action-button { min-height: 44px; } }
.identity-cell { white-space: normal; }
.identifier-line { display: inline-flex; align-items: center; justify-content: flex-start; flex-wrap: nowrap; gap: 7px; max-width: 100%; vertical-align: middle; }
.identifier-line > strong, .identifier-line > span { min-width: 0; overflow-wrap: anywhere; font-size: 14px; line-height: 1.5; }
.identifier-line > strong { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
.identifier-copy { display: grid; place-items: center start; flex: 0 0 44px; width: 44px; height: 44px; padding: 0; border: 1px solid transparent; border-radius: 8px; background: transparent; color: #315b49; cursor: pointer; }
.identifier-copy svg { display: block; width: 17px; height: 17px; }
.identifier-copy:focus-visible { outline: 3px solid #315b49; outline-offset: 2px; }
.identifier-copy:disabled { opacity: .5; cursor: not-allowed; }
.copy-feedback { margin: 0; padding: 0 18px 12px; color: #315b49; font-size: 12px; overflow-wrap: anywhere; }
.copy-feedback.warning { color: #8a6429; }
.copy-feedback:empty { position: absolute; width: 1px; height: 1px; padding: 0; clip-path: inset(50%); overflow: hidden; }
.full-identifier { overflow-wrap: anywhere; white-space: normal; user-select: text; }

/* Match the Pending Review badge currently displayed on Observations. */
.reviews-table .badge.pending-review { background: #e8eff2; color: #53727c; }
.reviews-table .badge.flagged { background: #f0eaf8; color: #69459a; }

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
.reviews-table .species-request-badge {
  font-size: 12px;
  line-height: 1.4;
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  justify-self: start;
  width: fit-content;
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
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
.reviews-table .similarity-badge-button strong { font-size: 14px; }
.reviews-table .similarity-badge-button span { font-size: 12px; }
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
  color: #63776d;
  font-size: 12px;
  line-height: 1.5;
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
.history-item {
  padding: 10px 0;
  display: grid;
  gap: 3px;
  border-bottom: 1px solid #edf0ed;
  font-size: 10px;
}
.history-item .observation-id { max-width: 100%; white-space: normal; }
.history-date { color: #63776d; }
.history-details { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; }
.history-details:empty { display: none; }
.plant-review-actions { margin-top: 20px; }
.qr-identifier { max-width: 100%; }
.qr-copy-feedback, .qr-copy-fallback { display: block; overflow-wrap: anywhere; line-height: 1.5; }
.qr-copy-feedback:empty { position: absolute; width: 1px; height: 1px; clip-path: inset(50%); overflow: hidden; }
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
