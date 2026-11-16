<script setup lang="ts">
import '../../styles/officer-copy.css'
import { useOfficerCopyConfirmation } from '../../composables/useOfficerCopyConfirmation'
const copyConfirmation = useOfficerCopyConfirmation({ schedule: (fn, ms) => window.setTimeout(fn, ms), cancel: id => window.clearTimeout(id as number) })
const controlCopied = copyConfirmation.copied, controlToastKey = copyConfirmation.toastKey

import { vOfficerDropdown } from '../../components/conservation/officerDropdown'
import SubmissionChanges from '../../components/conservation/SubmissionChanges.vue'
import { workflowBadgeStyle } from '../../utils/workflowBadge'
import { computed, onBeforeUnmount, onMounted, ref, watch, type Directive } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { currentUser, sessionSnapshot, subscribeSession } from '../../services/auth'
import { ReviewApiError, createReviewRequest, performObservationReview, observationReviewSnapshot, reviewCommentValid, positiveRevision, reviewEligible, reviewTransitions, type ReviewDecision } from '../../services/observationReview'
import { mapLinkedSpeciesRequest, type LinkedSpeciesRequest } from '../../services/reviewSpeciesRequest'
import AppModal from '../../components/conservation/AppModal.vue'
import ActionFeedback from '../../components/ActionFeedback.vue'
import ObservationReviewHistory from '../../components/conservation/ObservationReviewHistory.vue'
import { formatReviewTimestamp } from '../../services/observationReviewHistory'
import { formatPlantId } from '../../utils/plantId'
import { observationOrigin, observationQueueUrl, readQueuePage, type ObservationOrigin, type ObservationQueue } from '../../services/observationQueue'

interface ObservationAsset { id: string; contentType: string }
interface ObservationView {
  reviewSnapshot: ReturnType<typeof observationReviewSnapshot>
  origin: ObservationOrigin
  id: string
  plantRawId: string
  plantDisplayId: string
  plantRouteId: string
  ownerSubject: string
  status: string
  isCorrectionResubmission: boolean
  revision: number | null
  createdAt: string
  updatedAt: string
  speciesId: string
  plantScientificName: string
  speciesScientificName: string
  submissionUpdate: unknown
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
  speciesRequest: LinkedSpeciesRequest | null
}

const route = useRoute()
const navigationError = ref('')
let navigationRequest = 0
const { t, te, locale } = useI18n()
const observations = ref<ObservationView[]>([])
const queueOrigin = ref<ObservationQueue>('subsequent_observation')
const hasMore = ref(false)
const nextCursor = ref<string | null>(null)
let listRequest = 0
let listAbort: AbortController | null = null
const seenCursors = new Set<string>()
// Inclusive of the first request: at most 5 sequential 100-row scans per action.
// Stop on new queue matches, not on local search/species/owner/date matches.
const AUTO_SCAN_PAGE_LIMIT = 5
const autoScanLimited = ref(false)
const scannedPages = ref(0)
const isLoading = ref(true)
const loadError = ref('')
const skippedRecords = ref(0)
const selected = ref<ObservationView | null>(null)
const detailLoading = ref(false)
const detailError = ref('')
const historyModal = ref(false)
const failedAssets = ref(new Set<string>())
const copyFeedback = ref('')
const copyFailed = ref(false)
const copyPending = ref(false)
const copiedKey = ref('')
let copyAttempt = 0
function clearCopyState() {
  copyConfirmation.clear()
  copyAttempt++
  copyFeedback.value = ''; copiedKey.value = ''; copyFailed.value = false; copyPending.value = false
}
const search = ref('')
const status = ref('')
const species = ref('')
const owner = ref('')
const date = ref('')
const modalText = (key: string) => t('observationModal.' + key)
const modalDate = (value: string) => formatReviewTimestamp(value, locale.value)
const modalHeaders = new WeakMap<HTMLElement, { observer: ResizeObserver; observationId: string; measure: () => void }>()
const vObservationDialog: Directive<HTMLElement, string> = {
  mounted(root, binding) {
    const header = root.querySelector<HTMLElement>('.modal-header')
    const card = root.querySelector<HTMLElement>('.modal-card')
    if (!header || !card) return
    const measure = () => {
      card.style.setProperty('--observation-header-height', `${header.offsetHeight}px`)
      const actionsHeight = root.querySelector<HTMLElement>('.observation-decision-actions')?.offsetHeight || 0
      card.style.setProperty('--observation-review-height', `${Math.max(0, card.clientHeight - header.offsetHeight - actionsHeight - 56)}px`)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(header)
    observer.observe(card)
    const actions = root.querySelector<HTMLElement>('.observation-decision-actions')
    if (actions) observer.observe(actions)
    measure()
    modalHeaders.set(root, { observer, observationId: binding.value, measure })
  },
  updated(root, binding) {
    const current = modalHeaders.get(root)
    if (!current) return
    current.measure()
    if (current.observationId === binding.value) return
    current.observationId = binding.value
    const card = root.querySelector<HTMLElement>('.modal-card')
    if (card) card.scrollTop = 0
    root.querySelector<HTMLButtonElement>('.close-button')?.focus({ preventScroll: true })
  },
  unmounted(root) { modalHeaders.get(root)?.observer.disconnect(); modalHeaders.delete(root) },
}

const reviewHistoryRefresh = ref(0)
const reviewMode = ref(false)
const reviewComment = ref('')
const reviewSaving = ref(false)
const reviewNeedsReload = ref(false)
const reviewAcknowledged = ref(true)
const reviewFeedback = ref('')
const reviewSuccess = ref(false)
const reviewInfo = ref(false)
const reviewFeedbackVariant = computed(() => reviewInfo.value ? 'info' : reviewSuccess.value ? 'success' : 'error')
const commentFeedbackId = ref<number | null>(null)
let commentFeedbackSequence = 0
const reviewCommentError = computed(() => !reviewSuccess.value && reviewFeedback.value === rt('feedback.commentRequired'))
function dismissCommentFeedback(id: number) {
  if (commentFeedbackId.value === id) commentFeedbackId.value = null
}
const rt = (key: string, params?: Record<string, string | number>) => t('conservationPages.reviews.' + key, params || {})
const reviewRequest = createReviewRequest(rt, (...args) => fetch(...args))
let detailRequest = 0
let disposed = false
const session = ref(sessionSnapshot())
const authorizedOfficer = computed(() => !session.value.pending && session.value.user?.role === 'Conservation Officer' && session.value.user.status === 'Active' && session.value.user.mustChangePassword === false)
const unsubscribeSession = subscribeSession((user, pending) => {
  const previousId = session.value.user?.id
  session.value = { user, pending }
  if (pending && user && previousId === user.id) {
    if (reviewSaving.value || detailLoading.value) reviewNeedsReload.value = true
    detailRequest++; detailLoading.value = false
    return
  }
  if (!authorizedOfficer.value || previousId !== user?.id) {
    clearCopyState(); closeModal(true); invalidateList(); observations.value = []
  }
})
const reviewDecisions = computed(() => selected.value ? reviewTransitions[selected.value.status] || [] : [])
const canReviewField = (item: ObservationView) => item.origin === 'subsequent_observation' &&
  reviewEligible(session.value.user, session.value.pending, { ...item, owner: item.ownerSubject })
const reviewAllowed = computed(() => reviewMode.value && !historyModal.value && !detailLoading.value && !detailError.value && !reviewSaving.value && !reviewNeedsReload.value && reviewAcknowledged.value &&
  selected.value?.origin === 'subsequent_observation' &&
  Boolean(selected.value && reviewEligible(session.value.user, session.value.pending, { ...selected.value, owner: selected.value.ownerSubject })))
const canOpenReview = computed(() => authorizedOfficer.value && !reviewSaving.value && !historyModal.value && !detailLoading.value && !detailError.value &&
  selected.value?.origin !== 'subsequent_observation' &&
  Boolean(selected.value && ['Pending Review', 'Flagged'].includes(selected.value.status)))

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
const summaryStatuses = ['Pending Review', 'Correction Required', 'Flagged', 'Rejected', 'Approved']
const summaryCounts = computed(() => {
  const available = authorizedOfficer.value && !isLoading.value && !loadError.value
  // Match list deduplication and origin semantics, without narrowing counts to
  // client-side table search/species/owner/date filters or a visible preview.
  const loaded = [...new Map(observations.value.map(item => [item.id, item])).values()]
    .filter(item => queueOrigin.value === 'all' || item.origin === queueOrigin.value)
  return summaryStatuses.map(status => ({ status, count: available ? loaded.filter(item => canonicalStatus(item.status) === status).length : null }))
})
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
    reviewSnapshot: observationReviewSnapshot(item),
    origin: observationOrigin(item.origin_type),
    id,
    plantRawId,
    plantDisplayId: formattedPlantId || plantRawId,
    plantRouteId: formattedPlantId || '',
    ownerSubject: stringValue(item.owner_subject),
    status: canonicalStatus(item.status),
    isCorrectionResubmission: item.is_correction_resubmission === true && observationOrigin(item.origin_type) !== 'unknown',
    revision: typeof item.revision === 'number' && positiveRevision(item.revision) ? item.revision : null,
    createdAt: stringValue(item.created_at),
    updatedAt: stringValue(item.updated_at),
    speciesId: stringValue(item.species_id),
    plantScientificName: typeof item.plant_scientific_name === 'string' ? item.plant_scientific_name : '',
    speciesScientificName: typeof item.species_scientific_name === 'string' ? item.species_scientific_name : (typeof item.scientific_name === 'string' ? item.scientific_name : ''),
    submissionUpdate: item.submission_update,
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
    speciesRequest: mapLinkedSpeciesRequest(item),
    hasSpeciesRequest: Boolean(stringValue(item.species_request_id) || record(item.species_request)),
  }
}

class ObservationApiError extends Error {
  constructor(message: string, readonly status = 0) { super(message) }
}
async function request(url: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  let response: Response
  try {
    const timeout = AbortSignal.timeout(15000)
    response = await fetch(url, { credentials: 'same-origin', signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
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

function changeQueue() {
  closeModal()
  void loadObservations()
}
function invalidateList() {
  listRequest++; listAbort?.abort(); listAbort = null
  hasMore.value = false; nextCursor.value = null; seenCursors.clear()
  isLoading.value = false; autoScanLimited.value = false; scannedPages.value = 0
}
// Invalidate immediately, including changes made while an empty page is scanning.
watch([queueOrigin, status], invalidateList, { flush: 'sync' })
async function loadObservations(append = false) {
  if (disposed || !authorizedOfficer.value) return
  if (append && (isLoading.value || !hasMore.value)) return
  listAbort?.abort()
  const token = ++listRequest
  const controller = new AbortController(); listAbort = controller
  const origin = queueOrigin.value, selectedStatus = status.value
  const current = () => !disposed && token === listRequest && !controller.signal.aborted && authorizedOfficer.value
  let cursor = append ? nextCursor.value : null
  if (!append) { clearCopyState(); observations.value = []; nextCursor.value = null; hasMore.value = false; skippedRecords.value = 0; seenCursors.clear() }
  isLoading.value = true
  loadError.value = ''; autoScanLimited.value = false; scannedPages.value = 0
  try {
    for (let attempt = 0; attempt < AUTO_SCAN_PAGE_LIMIT; attempt++) {
      const result = await request(observationQueueUrl(origin, selectedStatus, cursor), controller.signal)
      if (!current()) return
      const page = readQueuePage(result.page)
      if (!Array.isArray(result.observations) || !page) throw new ObservationApiError(t('conservationPages.observations.errors.invalidResponse'))
      if (page.cursor !== null && (page.cursor === cursor || seenCursors.has(page.cursor))) {
        // A broken continuation must restart explicitly, never loop on Load more.
        hasMore.value = false; nextCursor.value = null
        throw new ObservationApiError(t('conservationPages.observations.paginationInvalid'))
      }
      const mapped = result.observations.map(mapObservation)
      const rows = mapped.filter((item): item is ObservationView => item !== null)
      const previousIds = new Set(observations.value.map(item => item.id))
      const found = rows.some(item => !previousIds.has(item.id) && (origin === 'all' || item.origin === origin) && (!selectedStatus || item.status === selectedStatus))
      skippedRecords.value += mapped.length - rows.length
      observations.value = [...new Map([...observations.value, ...rows].map(item => [item.id, item])).values()]
        .sort((a, b) => timestamp(b.createdAt) - timestamp(a.createdAt))
      const staffIds = [...new Set(observations.value.map(item => item.ownerSubject).filter(subject => subject.startsWith('staff:')).map(subject => subject.slice(6)))].slice(0, 100)
      if (staffIds.length) {
        try {
          const directory = await request(`/api/conservation/submitter-names?ids=${encodeURIComponent(staffIds.join(','))}`, controller.signal)
          if (current() && directory.names && typeof directory.names === 'object') submitterNames.value = { ...submitterNames.value, ...directory.names as Record<string, string> }
        } catch { /* Keep the abbreviated identifier if the directory is unavailable. */ }
      }
      hasMore.value = page.hasMore; nextCursor.value = page.cursor
      if (page.cursor !== null) seenCursors.add(page.cursor)
      scannedPages.value++
      if (found || !page.hasMore) return
      cursor = page.cursor
    }
    autoScanLimited.value = hasMore.value
  } catch (error) {
    if (!current()) return
    // Keep successful pages and their continuation when a later request fails.
    loadError.value = error instanceof Error ? error.message : t('conservationPages.observations.errors.invalidResponse')
  } finally { if (current()) { isLoading.value = false; listAbort = null } }
}

async function open(item: ObservationView, reviewing = false, expectedOrigin?: ObservationOrigin) {
  if (reviewSaving.value || (reviewing && !authorizedOfficer.value)) return
  reviewHistoryRefresh.value = 0
  reviewMode.value = reviewing
  reviewComment.value = item.reviewComment
  reviewNeedsReload.value = false
  reviewAcknowledged.value = true
  reviewFeedback.value = ''
  reviewInfo.value = false
  commentFeedbackId.value = null
  reviewSuccess.value = false
  const requestId = ++detailRequest
  selected.value = item
  historyModal.value = false
  detailLoading.value = true
  detailError.value = ''
  failedAssets.value = new Set()
  try {
    if (reviewing) {
      await currentUser()
      if (disposed || requestId !== detailRequest || !authorizedOfficer.value) return
    }
    const result = await request(`/api/observations/${encodeURIComponent(item.id)}`)
    const mapped = mapObservation(result.observation)
    if (disposed || requestId !== detailRequest || selected.value?.id !== item.id) return
    if (expectedOrigin && mapped?.origin !== expectedOrigin) { closeModal(); navigationError.value = rt('queues.originMoved'); return }
    if (!mapped || mapped.id !== item.id) throw new ObservationApiError(t('conservationPages.observations.errors.invalidResponse'))
    if (!disposed && requestId === detailRequest && selected.value?.id === item.id) {
      updateObservation(mapped)
    }
  } catch (error) {
    if (!disposed && requestId === detailRequest) detailError.value =
      error instanceof Error ? error.message : t('conservationPages.observations.errors.invalidResponse')
  } finally {
    if (!disposed && requestId === detailRequest) detailLoading.value = false
  }
}
function openHistory(item: ObservationView) {
  if (reviewSaving.value) return
  reviewMode.value = false
  detailRequest++
  selected.value = item
  historyModal.value = true
  queueOrigin.value = 'all'; status.value = ''; void loadObservations()
  detailLoading.value = false
  detailError.value = ''
}
function closeModal(force = false) {
  if (reviewSaving.value && !force) return
  reviewMode.value = false
  reviewComment.value = ''
  reviewFeedback.value = ''
  reviewInfo.value = false
  commentFeedbackId.value = null
  reviewNeedsReload.value = false
  detailRequest++
  selected.value = null
  historyModal.value = false
  detailLoading.value = false
  detailError.value = ''
}
function updateObservation(row: ObservationView) {
  const previous = selected.value?.id === row.id ? selected.value.speciesRequest : null
  if (previous && !row.speciesRequest) row = { ...row, speciesRequest: { ...previous, state: 'error' } }
  selected.value = row
  observations.value = observations.value.map(item => item.id === row.id ? row : item)
  if (reviewMode.value && row.origin !== 'subsequent_observation') {
    reviewFeedback.value = rt('queues.originMoved')
    void loadObservations()
  }
}
async function readReviewObservation(id: string) {
  const result = await request('/api/observations/' + encodeURIComponent(id))
  const row = mapObservation(result.observation)
  if (!row || row.id !== id || !positiveRevision(row.revision)) throw new ReviewApiError(rt('feedback.invalidResponse'))
  return row
}
async function reloadReview() {
  if (!selected.value || reviewSaving.value || !authorizedOfficer.value) return
  const id = selected.value.id, token = detailRequest
  reviewSaving.value = true
  reviewInfo.value = false
  reviewSuccess.value = false
  reviewFeedback.value = ''
  try {
    const row = await readReviewObservation(id)
    if (disposed || token !== detailRequest || selected.value?.id !== id) return
    const changed = row.reviewSnapshot.observation !== selected.value.reviewSnapshot.observation
    const mustInspect = !reviewAcknowledged.value
    const draftComment = reviewComment.value
    updateObservation(row)
    reviewComment.value = draftComment
    reviewNeedsReload.value = false
    reviewAcknowledged.value = !changed && !mustInspect
    reviewSuccess.value = false
    reviewInfo.value = !changed && !mustInspect
    reviewFeedback.value = reviewInfo.value ? modalText('upToDate') : rt('feedback.reloaded')
  } catch (error) {
    if (!disposed && token === detailRequest && selected.value?.id === id) {
      reviewNeedsReload.value = true
      reviewSuccess.value = false
      reviewInfo.value = false
      reviewFeedback.value = error instanceof Error ? error.message : rt('feedback.loadFailed')
    }
  }
  finally { reviewSaving.value = false }
}
async function decide(decision: ReviewDecision) {
  if (!reviewAllowed.value || !selected.value || !reviewDecisions.value.includes(decision) || !positiveRevision(selected.value.revision)) return
  if (!reviewCommentValid(decision, reviewComment.value)) {
    reviewSuccess.value = false
    reviewInfo.value = false
    reviewFeedback.value = rt('feedback.commentRequired')
    commentFeedbackId.value = ++commentFeedbackSequence
    return
  }
  commentFeedbackId.value = null
  const { id, revision } = selected.value
  const typedComment = reviewComment.value, token = detailRequest
  reviewSaving.value = true; reviewFeedback.value = ''; reviewSuccess.value = false; reviewInfo.value = false
  try {
    try {
      const latest = await readReviewObservation(id)
      if (disposed || token !== detailRequest || selected.value?.id !== id) return
      if (latest.origin !== 'subsequent_observation') { updateObservation(latest); reviewFeedback.value = rt('queues.originMoved'); return }
    } catch (error) {
      if (!disposed && token === detailRequest) { reviewNeedsReload.value = true; reviewFeedback.value = error instanceof Error ? error.message : rt('feedback.loadFailed') }
      return
    }
    const result = await performObservationReview({ id, revision, decision, comment: typedComment, request: reviewRequest, read: readReviewObservation,
      current: () => !disposed && token === detailRequest && selected.value?.id === id && authorizedOfficer.value, invalidResponse: rt('feedback.invalidResponse') })
    if (!result) return
    if (result.committed) reviewHistoryRefresh.value++
    if (result.observation) updateObservation(result.observation)
    reviewNeedsReload.value = result.needsReload || (result.error instanceof ReviewApiError && [401, 403].includes(result.error.status))
    if (result.kind === 'saved') { reviewSuccess.value = true; reviewComment.value = selected.value?.reviewComment || ''; reviewFeedback.value = rt('feedback.saved') }
    else {
      reviewComment.value = typedComment
      if (result.kind === 'conflict') { reviewAcknowledged.value = false; reviewFeedback.value = rt(result.needsReload ? 'feedback.conflictReloadFailed' : 'feedback.conflict') }
      else reviewFeedback.value = result.committed ? rt('feedback.savedReloadFailed') : result.error instanceof Error ? result.error.message : rt('feedback.loadFailed')
    }
  } finally { reviewSaving.value = false }
}
const assetUrl = (id: string) => `/api/data/assets/${encodeURIComponent(id)}`
const imageFailed = (id: string) => { failedAssets.value = new Set([...failedAssets.value, id]) }

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
const observationLabels = computed(() => compactIdentifierTokens(observations.value.map(item => item.id)))
const observationLabel = (id: string) => `OBS-${observationLabels.value.get(id) || compactIdentifierTokens([id]).get(id) || id}`
const subjectPart = (subject: string) => /^(staff|visitor):/.test(subject) ? subject.slice(subject.indexOf(':') + 1) : subject
const subjectTokens = computed(() => compactIdentifierTokens(observations.value.map(item => item.ownerSubject).filter(Boolean), subjectPart))
const submitterNames = ref<Record<string, string>>({})
const submitterLabel = (subject: string) => {
  if (!subject) return textOrUnavailable('')
  const id = subject.startsWith('staff:') ? subject.slice(6) : ''
  if (id && submitterNames.value[id]) return submitterNames.value[id]
  const account = session.value.user
  // The existing authenticated session can identify only this exact account.
  // Other submitters have no authorized name/directory mapping on this page.
  if (authorizedOfficer.value && account && subject === `staff:${account.id}` && account.name?.trim()) return account.name.trim()
  const key = subject.startsWith('staff:') ? 'staffIdentifier' : subject.startsWith('visitor:') ? 'visitorIdentifier' : 'submitterIdentifier'
  return t('conservationPages.observations.' + key, { id: subjectTokens.value.get(subject) || compactIdentifierTokens([subject], subjectPart).get(subject) || subjectPart(subject) })
}
async function copyIdentifier(value: string, kind: 'observation' | 'subject', reviewSubject = false, controlKey = `${kind}:${value}`) {
  if (!authorizedOfficer.value || copyPending.value || !value) return
  const listed = observations.value.some(item => (kind === 'observation' ? item.id : item.ownerSubject) === value)
  const detail = selected.value
  const displayedInModal = detail && (kind === 'observation' ? detail.id === value : detail.ownerSubject === value || reviewSubject)
  if (!listed && !displayedInModal) return
  const attempt = ++copyAttempt, actor = session.value.user?.id
  const current = () => !disposed && attempt === copyAttempt && authorizedOfficer.value && actor === session.value.user?.id
  copyConfirmation.reset(controlKey)
  copyPending.value = true; copiedKey.value = ''; copyFeedback.value = ''; copyFailed.value = false
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
    await navigator.clipboard.writeText(value)
    if (!current()) return
    copiedKey.value = `${kind}:${value}`
    copyFeedback.value = ''; copyConfirmation.confirm(controlKey)
  } catch {
    if (current()) { copyFailed.value = true; copyFeedback.value = t('conservationPages.observations.copyUnavailable') }
  } finally { if (current()) copyPending.value = false }
}

const filtered = computed(() => {
  const query = search.value.trim().toLowerCase()
  return observations.value.filter((item) => {
    if (queueOrigin.value !== 'all' && item.origin !== queueOrigin.value) return false
    const searchable = `${item.id} ${item.plantRawId} ${item.plantDisplayId} ${item.scientificName} ${item.commonName} ${item.ownerSubject} ${item.status} ${observationLabel(item.id)} ${submitterLabel(item.ownerSubject)}`
    return (!query || searchable.toLowerCase().includes(query)) &&
      (!status.value || item.status === status.value) &&
      (!species.value || item.speciesId === species.value) &&
      (!owner.value || item.ownerSubject === owner.value) &&
      (!date.value || dateKey(item.createdAt) === date.value)
  })
})
const filtersHideLoaded = computed(() => filtered.value.length < observations.value.filter(item => queueOrigin.value === 'all' || item.origin === queueOrigin.value).length)
watch(filtered, () => { copyAttempt++; copyPending.value = false; copyConfirmation.clear() })
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

// Notification links use the existing authorized detail endpoint, independently
// of list pagination and filters. They never acknowledge notifications here.
async function resolveObservationQuery() {
  const token = ++navigationRequest
  const id = route.query.observation
  navigationError.value = ''
  if (reviewSaving.value) return
  closeModal()
  if (!id || !authorizedOfficer.value || disposed) return
  if (typeof id !== 'string' || !/^(?:[1-9][0-9]{0,18}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(id)) {
    navigationError.value = rt('feedback.invalidId'); return
  }
  try {
    const result = await request('/api/observations/' + encodeURIComponent(id))
    if (disposed || token !== navigationRequest || !authorizedOfficer.value) return
    const row = mapObservation(result.observation)
    if (!row || row.id !== id) throw new Error(t('conservationPages.observations.errors.invalidResponse'))
    if (row.origin !== 'subsequent_observation') {
      navigationError.value = rt('queues.originMoved'); return
    }
    await open(row, true, 'subsequent_observation')
  } catch (error) {
    if (!disposed && token === navigationRequest && authorizedOfficer.value)
      navigationError.value = error instanceof Error ? error.message : t('conservationPages.observations.errors.invalidResponse')
  }
}
watch(() => [route.query.observation, authorizedOfficer.value, session.value.user?.id], (next, previous) => {
  // A same-account verification outage/recovery must not reopen or close a draft.
  if (previous && next[0] === previous[0] && next[2] === previous[2] && session.value.user && (session.value.pending || selected.value)) return
  void resolveObservationQuery()
}, { immediate: true })

onMounted(loadObservations)
onBeforeUnmount(() => { disposed = true; navigationRequest++; clearCopyState(); detailRequest++; invalidateList(); unsubscribeSession() })
</script>

<template>
  <span class="officer-copy-live" role="status" aria-live="polite" aria-atomic="true"><span v-if="controlToastKey && !controlToastKey.startsWith('submitter:')" :key="controlToastKey">{{ t('conservationPages.reviews.copiedToast') }}</span></span>
  <section class="page-intro"><div>
    <p class="page-kicker">{{ t('conservationPages.observations.eyebrow') }}</p>
    <h2>{{ t('conservationPages.observations.title') }}</h2>
    <p>{{ rt('queues.fieldIntro') }}</p>
  </div></section>

  <p v-if="navigationError" role="alert">{{ navigationError }}</p>

  <section class="observation-summary" :aria-label="t('conservationPages.observations.summaryTitle')" :aria-busy="isLoading" aria-describedby="observation-summary-scope">
    <div class="summary-grid observation-summary-grid">
      <article v-for="card in summaryCounts" :key="card.status" class="summary-card observation-summary-card" :data-status="card.status">
        <div class="observation-summary-title">
          <p>{{ label(card.status) }}</p>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
            <template v-if="card.status === 'Pending Review'"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></template>
            <path v-else-if="card.status === 'Correction Required'" d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14z" />
            <path v-else-if="card.status === 'Flagged'" d="M5 21V3h14l-3 5 3 5H5" />
            <template v-else-if="card.status === 'Rejected'"><circle cx="12" cy="12" r="9" /><path d="m8 8 8 8M16 8l-8 8" /></template>
            <template v-else><circle cx="12" cy="12" r="9" /><path d="m7 12 3 3 7-7" /></template>
          </svg>
        </div>
        <strong>{{ card.count === null ? '—' : card.count }}</strong>
      </article>
    </div>
    <p id="observation-summary-scope" class="observation-summary-scope">{{ t('conservationPages.observations.summaryScope') }}</p>
  </section>

  <div class="control-bar">
    <label class="field"><span>{{ rt('queues.reviewQueue') }}</span><select v-officer-dropdown v-model="queueOrigin" :disabled="reviewSaving" @change="changeQueue">
      <option value="subsequent_observation">{{ rt('queues.fieldObservations') }}</option>
      <option value="all">{{ rt('queues.allOrigins') }} · {{ rt('queues.history') }}</option>
      <option value="unknown">{{ rt('queues.legacy') }}</option>
    </select></label>
    <label class="field search-field"><span>{{ t('conservationPages.observations.search') }}</span><input v-model="search" :placeholder="t('conservationPages.observations.searchPlaceholder')" /></label>
    <label class="field"><span>{{ t('conservationPages.observations.status') }}</span><select v-officer-dropdown v-model="status" @change="loadObservations()"><option value="">{{ t('conservationPages.observations.allStatuses') }}</option><option v-for="item in supportedStatuses" :key="item" :value="item">{{ label(item) }}</option></select></label>
    <label class="field"><span>{{ t('conservationPages.observations.species') }}</span><select v-officer-dropdown v-model="species"><option value="">{{ t('conservationPages.observations.allSpecies') }}</option><option v-for="item in speciesOptions" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
    <label class="field"><span>{{ t('conservationPages.observations.submittedBy') }}</span><select v-officer-dropdown v-model="owner"><option value="">{{ t('conservationPages.observations.allSubmitters') }}</option><option v-for="item in ownerOptions" :key="item" :value="item" :title="item">{{ submitterLabel(item) }}</option></select></label>
    <label class="field"><span>{{ t('conservationPages.observations.created') }}</span><input v-model="date" type="date" /></label>
  </div>

  <section class="panel">
    <p v-if="!isLoading && filtersHideLoaded" class="dataset-note" role="status">{{ t(hasMore ? 'conservationPages.observations.filteredMore' : 'conservationPages.observations.filteredLoaded') }}</p>
    <p v-if="!isLoading && hasMore && !loadError" class="dataset-note" role="status">{{ t(autoScanLimited ? 'conservationPages.observations.paginationPaused' : 'conservationPages.observations.paginationMore') }}</p>
    <p v-if="skippedRecords" class="dataset-note" role="status">{{ t('conservationPages.observations.skipped', { count: skippedRecords }) }}</p>
    <p class="copy-feedback" :class="{ warning: copyFailed }" role="status" aria-live="polite" aria-atomic="true">{{ copyFeedback }}</p>
    <div class="table-scroll observations-scroll" role="region" :aria-label="t('conservationPages.observations.title')" tabindex="0"><table class="observations-table">
      <colgroup><col class="observation-column" /><col class="plant-column" /><col class="species-column" /><col class="submitter-column" /><col class="status-column" /><col class="created-column" /><col class="actions-column" /></colgroup>
      <thead><tr><th scope="col">{{ t('conservationPages.observations.observationId') }}</th><th scope="col">{{ t('conservationPages.observations.plantId') }}</th><th scope="col">{{ t('conservationPages.observations.species') }}</th><th scope="col">{{ t('conservationPages.observations.submittedBy') }}</th><th scope="col">{{ t('conservationPages.observations.status') }}</th><th scope="col">{{ t('conservationPages.observations.created') }}</th><th scope="col">{{ t('conservationPages.observations.actions') }}</th></tr></thead>
      <tbody>
        <tr v-for="item in filtered" :key="item.id">
          <td class="identity-cell"><div class="identifier-line"><strong :title="item.id">{{ observationLabel(item.id) }}</strong><span class="officer-copy-anchor"><button type="button" class="identifier-copy" :disabled="!authorizedOfficer || copyPending" :aria-label="t('conservationPages.observations.copyObservationId', { id: observationLabel(item.id) })" :title="t('conservationPages.observations.copyObservationId', { id: observationLabel(item.id) })" @click="copyIdentifier(item.id, 'observation', false, `observation-icon-0:${item.id}`)"><svg v-if="!controlCopied[`observation-icon-0:${item.id}`]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></svg><svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="m5 12 4 4 10-10" /></svg></button><span v-if="controlToastKey === `observation-icon-0:${item.id}`" :key="`observation-icon-0:${item.id}`" class="officer-copy-toast" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 12 4 4 10-10" /></svg><span>{{ t('conservationPages.reviews.copiedToast') }}</span></span></span></div><small v-if="item.origin === 'unknown'">{{ rt('queues.originUnverified') }}</small></td><td>{{ item.plantDisplayId }}</td>
          <td><em>{{ speciesName(item) }}</em><small v-if="item.commonName && item.scientificName">{{ item.commonName }}</small><small v-if="item.hasSpeciesRequest">{{ t('conservationPages.observations.newSpeciesRequest') }}</small></td>
          <td class="identity-cell"><div class="identifier-line"><span :title="item.ownerSubject">{{ submitterLabel(item.ownerSubject) }}</span><template v-if="item.ownerSubject"><span class="officer-copy-anchor"><button type="button" class="identifier-copy" :disabled="!authorizedOfficer || copyPending" :aria-label="t('conservationPages.observations.copySubject', { id: submitterLabel(item.ownerSubject) })" :title="t('conservationPages.observations.copySubject', { id: submitterLabel(item.ownerSubject) })" @click="copyIdentifier(item.ownerSubject, 'subject', false, `observation-icon-1:${item.id}:${item.ownerSubject}`)"><svg v-if="!controlCopied[`observation-icon-1:${item.id}:${item.ownerSubject}`]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></svg><svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="m5 12 4 4 10-10" /></svg></button><span v-if="controlToastKey === `observation-icon-1:${item.id}:${item.ownerSubject}`" :key="`observation-icon-1:${item.id}:${item.ownerSubject}`" class="officer-copy-toast" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 12 4 4 10-10" /></svg><span>{{ t('conservationPages.reviews.copiedToast') }}</span></span></span></template></div></td><td class="status-cell"><span class="review-status-group"><span class="badge" :style="workflowBadgeStyle(item.status)" :class="keyFor(item.status)">{{ label(item.status) }}</span><span v-if="item.status === 'Pending Review' && item.isCorrectionResubmission" class="badge resubmission-tag">{{ t('conservationPages.observations.resubmitted') }}</span></span></td><td>{{ formatDate(item.createdAt) }}</td>
          <td class="actions-cell"><div class="action-group">
            <button v-if="canReviewField(item)" class="action-button" :disabled="reviewSaving" @click="open(item, true)">{{ t('conservationPages.observations.review') }}</button>
            <button v-else class="action-button" @click="open(item)">{{ t('common.viewDetails') }}</button>
            <RouterLink v-if="item.plantRouteId" class="action-button" :to="`/plant/${item.plantRouteId}`">{{ t('conservationPages.observations.viewPlant') }}</RouterLink>
            <button class="action-button" @click="openHistory(item)">{{ t('conservationPages.observations.history') }}</button>
            <RouterLink class="action-button" :to="{ name: 'conservation-map', query: { plant: item.plantRawId } }">{{ t('conservationPages.observations.location') }}</RouterLink>
            <RouterLink v-if="authorizedOfficer && item.origin !== 'subsequent_observation' && (item.status === 'Pending Review' || item.status === 'Flagged')" class="action-button" :to="{ name: 'conservation-reviews', query: { review: item.id } }">{{ rt('queues.registrationReview') }}</RouterLink>
          </div></td>
        </tr>
        <tr v-if="isLoading"><td colspan="7" class="state-cell">{{ t(scannedPages > 0 ? 'conservationPages.observations.scanning' : 'conservationPages.observations.loading') }}</td></tr>
        <tr v-else-if="loadError"><td colspan="7" class="state-cell error-state"><strong>{{ t('conservationPages.observations.loadFailed') }}</strong><span>{{ loadError }}</span><button class="action-button" @click="loadObservations(Boolean(nextCursor))">{{ t('conservationPages.observations.retry') }}</button></td></tr>
        <tr v-else-if="!filtered.length"><td colspan="7" class="state-cell">{{ hasMore ? t('conservationPages.observations.emptyMore') : filtersHideLoaded ? t('conservationPages.observations.filteredLoaded') : rt(queueOrigin === 'subsequent_observation' ? 'queues.noFieldObservations' : 'queues.noRecords') }}</td></tr>
      </tbody>
    </table></div>
    <button v-if="hasMore || loadError" class="action-button" :disabled="isLoading" @click="loadObservations(Boolean(nextCursor))">{{ rt('queues.loadMore') }}</button>
  </section>

  <AppModal v-if="selected && !historyModal" v-observation-dialog="selected.id" class="observation-dialog" :title="modalText('title')" wide accessible @close="closeModal()">
    <template #title>
      <span class="observation-title-layout">
        <span class="observation-title-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 2 21 2c0 4-1 11-5 15-2 2-4 3-5 3ZM2 22l12-12" /></svg></span>
        <span class="observation-title-copy"><span>{{ modalText('title') }}</span><span class="observation-title-subtitle"><span class="identifier-line"><strong :title="selected.id">{{ observationLabel(selected.id) }}</strong><span class="officer-copy-anchor"><button type="button" class="identifier-copy" :disabled="!authorizedOfficer || copyPending" :aria-label="t('conservationPages.observations.copyObservationId', { id: observationLabel(selected.id) })" :title="t('conservationPages.observations.copyObservationId', { id: observationLabel(selected.id) })" @click="copyIdentifier(selected.id, 'observation', false, `observation-icon-2:${selected.id}`)"><svg v-if="!controlCopied[`observation-icon-2:${selected.id}`]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></svg><svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="m5 12 4 4 10-10" /></svg></button><span v-if="controlToastKey === `observation-icon-2:${selected.id}`" :key="`observation-icon-2:${selected.id}`" class="officer-copy-toast" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 12 4 4 10-10" /></svg><span>{{ t('conservationPages.reviews.copiedToast') }}</span></span></span></span></span></span>
      </span>
    </template>
    <ActionFeedback v-if="commentFeedbackId !== null" :key="commentFeedbackId" :feedback-id="commentFeedbackId" variant="error" :message="rt('feedback.commentRequired')" @dismiss="dismissCommentFeedback" />
    <div class="observation-dialog-content"><p class="copy-feedback" :class="{ warning: copyFailed }" role="status" aria-live="polite" aria-atomic="true">{{ copyFeedback }}</p>
      <p v-if="selected.origin === 'unknown'" role="status">{{ rt('queues.originUnverified') }}</p>
      <p v-if="detailLoading" class="detail-state" role="status">{{ t('conservationPages.observations.loadingDetails') }}</p>
      <p v-if="detailError" class="detail-state error-state" role="alert">{{ detailError }}</p>
      <p v-if="selected.status === 'Rejected'" class="review-feedback error" role="status">{{ t('submissionChanges.finalRejected') }}</p>
      <SubmissionChanges v-if="selected.status === 'Pending Review'" :update="selected.submissionUpdate" :revision="selected.revision" :initial-submission="selected.origin === 'subsequent_observation' && selected.revision === 1" :busy="reviewSaving || detailLoading" @reload="reloadReview" />
      <div v-if="!reviewAcknowledged || reviewNeedsReload" class="review-feedback error" role="alert"><p>{{ t(!reviewAcknowledged ? 'submissionChanges.conflict' : 'submissionChanges.reloadRequired') }}</p><button type="button" class="secondary-button" :disabled="reviewSaving" @click="reloadReview">{{ t('submissionChanges.reload') }}</button></div>
      <p class="observation-data-provenance" role="note">{{ modalText('currentRecordNotice') }}</p>
      <div class="observation-dialog-columns">
        <div class="observation-information-column">
          <template v-if="!reviewNeedsReload">
            <section class="observation-information-section">
              <h3 class="observation-section-heading"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></svg>{{ modalText('details') }}</h3>
              <dl class="detail-list observation-details">
                <div><dt>{{ t('conservationPages.observations.observationId') }}</dt><dd class="full-identifier"><span class="identifier-line"><strong :title="selected.id">{{ observationLabel(selected.id) }}</strong><span class="officer-copy-anchor"><button type="button" class="identifier-copy" :disabled="!authorizedOfficer || copyPending" :aria-label="t('conservationPages.observations.copyObservationId', { id: observationLabel(selected.id) })" :title="t('conservationPages.observations.copyObservationId', { id: observationLabel(selected.id) })" @click="copyIdentifier(selected.id, 'observation', false, `observation-icon-3:${selected.id}`)"><svg v-if="!controlCopied[`observation-icon-3:${selected.id}`]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></svg><svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="m5 12 4 4 10-10" /></svg></button><span v-if="controlToastKey === `observation-icon-3:${selected.id}`" :key="`observation-icon-3:${selected.id}`" class="officer-copy-toast" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 12 4 4 10-10" /></svg><span>{{ t('conservationPages.reviews.copiedToast') }}</span></span></span></span></dd></div>
                <div><dt>{{ t('conservationPages.observations.status') }}</dt><dd><span class="badge" :style="workflowBadgeStyle(selected.status)">{{ label(selected.status) }}</span></dd></div>
                <div><dt>{{ t('conservationPages.observations.submittedBy') }}</dt><dd class="full-identifier"><span class="identifier-line"><span :title="selected.ownerSubject">{{ submitterLabel(selected.ownerSubject) }}</span><template v-if="selected.ownerSubject"><span class="officer-copy-anchor"><button type="button" class="identifier-copy" :disabled="!authorizedOfficer || copyPending" :aria-label="t('conservationPages.observations.copySubject', { id: submitterLabel(selected.ownerSubject) })" :title="t('conservationPages.observations.copySubject', { id: submitterLabel(selected.ownerSubject) })" @click="copyIdentifier(selected.ownerSubject, 'subject', false, `observation-icon-4:${selected.id}:${selected.ownerSubject}`)"><svg v-if="!controlCopied[`observation-icon-4:${selected.id}:${selected.ownerSubject}`]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></svg><svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="m5 12 4 4 10-10" /></svg></button><span v-if="controlToastKey === `observation-icon-4:${selected.id}:${selected.ownerSubject}`" :key="`observation-icon-4:${selected.id}:${selected.ownerSubject}`" class="officer-copy-toast" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 12 4 4 10-10" /></svg><span>{{ t('conservationPages.reviews.copiedToast') }}</span></span></span></template></span></dd></div>
                <div><dt>{{ t('conservationPages.observations.created') }}</dt><dd>{{ modalDate(selected.createdAt) }}</dd></div>
                <div><dt>{{ t('conservationPages.observations.lastUpdated') }}</dt><dd>{{ modalDate(selected.updatedAt) }}</dd></div>
                <div><dt>{{ t('conservationPages.observations.reviewedAt') }}</dt><dd>{{ modalDate(selected.reviewedAt) }}</dd></div>
              </dl>
            </section>
            <section class="observation-information-section">
              <h3 class="observation-section-heading"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 2 21 2c0 4-1 11-5 15-2 2-4 3-5 3ZM2 22l12-12" /></svg>{{ modalText('plantSpecies') }}</h3>
              <dl class="detail-list">
                <div><dt>{{ t('conservationPages.observations.plantId') }}</dt><dd>{{ selected.plantDisplayId }}</dd></div>
                <div><dt>{{ t('submissionChanges.plantName') }}</dt><dd><em>{{ textOrUnavailable(selected.plantScientificName) }}</em></dd></div>
                <div><dt>{{ modalText('scientificName') }}</dt><dd><em>{{ textOrUnavailable(selected.speciesScientificName) }}</em></dd></div>
                <div><dt>{{ modalText('commonName') }}</dt><dd>{{ textOrUnavailable(selected.commonName) }}</dd></div>
                <div><dt>{{ modalText('speciesId') }}</dt><dd>{{ textOrUnavailable(selected.speciesId) }}</dd></div>
              </dl>
            </section>
            <section class="observation-information-section">
              <h3 class="observation-section-heading"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22v-9M12 13C5 13 3 9 3 5c6 0 9 3 9 8ZM12 17c0-6 3-9 9-9 0 6-3 9-9 9Z" /></svg>{{ modalText('observationInformation') }}</h3>
              <dl class="detail-list">
                <div><dt>{{ t('conservationPages.observations.height') }}</dt><dd>{{ textOrUnavailable(selected.height) }}</dd></div>
                <div><dt>{{ t('conservationPages.observations.growthStage') }}</dt><dd>{{ label(selected.lifeStage) }}</dd></div>
                <div><dt>{{ t('conservationPages.observations.healthStatus') }}</dt><dd>{{ label(selected.healthStatus) }}</dd></div>
                <div><dt>{{ t('conservationPages.observations.morphology') }}</dt><dd>{{ textOrUnavailable(selected.morphology) }}</dd></div>
                <div class="observation-field-wide"><dt>{{ t('conservationPages.observations.notes') }}</dt><dd>{{ textOrUnavailable(selected.notes) }}</dd></div>
              </dl>
              <template v-if="Object.keys(selected.taxonomy).length"><h4>{{ t('conservationPages.observations.taxonomy') }}</h4><dl class="detail-list"><div v-for="(value, key) in selected.taxonomy" :key="key"><dt>{{ key }}</dt><dd>{{ value }}</dd></div></dl></template>
            </section>
            <section class="observation-information-section">
              <h3 class="observation-section-heading"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>{{ modalText('location') }}</h3>
              <dl class="detail-list">
                <div><dt>{{ t('conservationPages.observations.coordinates') }}</dt><dd>{{ selected.latitude !== '' && selected.longitude !== '' ? `${selected.latitude}, ${selected.longitude}` : '—' }}</dd></div>
                <div><dt>{{ t('conservationPages.observations.gpsAccuracy') }}</dt><dd>{{ selected.gpsAccuracy !== '' ? `${selected.gpsAccuracy} m` : '—' }}</dd></div>
              </dl>
            </section>
          </template>
        </div>
        <div class="observation-review-column" :class="{ 'observation-review-mode': reviewMode }">
          <div class="observation-review-content" :tabindex="reviewMode ? 0 : undefined" :role="reviewMode ? 'region' : undefined" :aria-label="reviewMode ? modalText('officerReview') : undefined">
          <section v-if="!reviewNeedsReload" class="observation-side-section observation-media">
            <h3 class="observation-section-heading"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8" cy="8" r="1" /><path d="m21 15-5-5L5 21" /></svg>{{ modalText('media') }}</h3>
            <div class="observation-section-content">
              <p v-if="!selected.assets.length">{{ t('conservationPages.observations.noAssets') }}</p>
              <div v-else class="submission-image-grid"><article v-for="asset in selected.assets" :key="asset.id" class="submitted-image-item"><div class="submitted-image-preview"><img v-if="asset.contentType.startsWith('image/') && !failedAssets.has(asset.id)" :src="assetUrl(asset.id)" :alt="t('conservationPages.observations.imageAlt', { observation: selected.id, asset: asset.id })" loading="lazy" @error="imageFailed(asset.id)" /><span v-else>{{ t(asset.contentType.startsWith('image/') ? 'conservationPages.observations.imageUnavailable' : 'conservationPages.observations.attachment') }}</span></div><div class="asset-caption"><strong :title="asset.id">{{ asset.id }}</strong><small>{{ asset.contentType }}</small></div></article></div>
            </div>
          </section>
          <section v-if="reviewMode" class="officer-review" :aria-busy="reviewSaving || detailLoading">
            <h3 class="observation-section-heading"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="5" width="14" height="17" rx="2" /><rect x="9" y="2" width="6" height="5" rx="1" /><path d="m9 14 2 2 4-4" /></svg>{{ modalText('officerReview') }}</h3>
            <div class="observation-section-content">
      <p v-if="!reviewAllowed && !detailLoading && !reviewSaving && !reviewNeedsReload" role="status">{{ rt('reviewUnavailable') }}</p>
      <label class="field" for="observation-review-comment"><span>{{ rt('reviewComment') }}</span><textarea id="observation-review-comment" v-model="reviewComment" :placeholder="t('conservationText.recordtheobservationdecisionorrequiredaction')" :aria-invalid="reviewCommentError || undefined" :aria-describedby="reviewCommentError ? 'observation-review-comment-error' : undefined" maxlength="4000" rows="5" :disabled="reviewSaving || detailLoading" /></label>
      <p v-if="reviewFeedback" :id="reviewCommentError ? 'observation-review-comment-error' : undefined" :role="reviewInfo || reviewSuccess ? 'status' : 'alert'" class="observation-review-feedback" :class="[reviewFeedbackVariant, { 'observation-comment-validation': reviewCommentError }]"><svg v-if="reviewCommentError" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10" /><path d="M12 8v4 M12 16h.01" /></svg><span>{{ reviewFeedback }}</span></p>
      <button v-if="reviewNeedsReload" class="secondary-button" :disabled="reviewSaving" @click="reloadReview">{{ rt('reloadLatest') }}</button>
      <label v-if="!reviewAcknowledged && !reviewNeedsReload"><input v-model="reviewAcknowledged" type="checkbox" :disabled="reviewSaving" /> {{ rt('acknowledgeLatest') }}</label>
      <p v-if="reviewSaving" role="status">{{ rt('saving') }}</p>

            </div>
          </section>
          <ObservationReviewHistory v-if="authorizedOfficer" :observation-id="selected.id" :refresh-key="reviewHistoryRefresh"><template #reviewer="{ subject, review }"><span class="identifier-line"><span :title="subject">{{ submitterLabel(subject) }}</span><template v-if="subject"><span class="officer-copy-anchor"><button type="button" class="identifier-copy" :disabled="!authorizedOfficer || copyPending" :aria-label="t('conservationPages.observations.copySubject', { id: submitterLabel(subject) })" :title="t('conservationPages.observations.copySubject', { id: submitterLabel(subject) })" @click="copyIdentifier(subject, 'subject', true, `observation-icon-5:${selected.id}:${review.id}:${subject}`)"><svg v-if="!controlCopied[`observation-icon-5:${selected.id}:${review.id}:${subject}`]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></svg><svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="m5 12 4 4 10-10" /></svg></button><span v-if="controlToastKey === `observation-icon-5:${selected.id}:${review.id}:${subject}`" :key="`observation-icon-5:${selected.id}:${review.id}:${subject}`" class="officer-copy-toast" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 12 4 4 10-10" /></svg><span>{{ t('conservationPages.reviews.copiedToast') }}</span></span></span></template></span></template></ObservationReviewHistory>
    <div v-if="canOpenReview" class="modal-actions observation-review-actions">
      <RouterLink class="action-button modal-review-link" :to="{ name: 'conservation-reviews', query: { review: selected.id } }" @click="closeModal()">{{ t('conservationPages.observations.reviewSubmission') }}</RouterLink>
    </div>
          </div>

        </div>
      </div>
      <div v-if="reviewMode" class="modal-actions observation-decision-actions" role="group" :aria-label="rt('speciesRequest.plantDecision')" :aria-busy="reviewSaving || detailLoading">
        <button v-for="decision in reviewDecisions" :key="decision" :class="decision === 'Approved' ? 'primary-button' : decision === 'Rejected' ? 'danger-button' : 'secondary-button'" :disabled="!reviewAllowed" @click="decide(decision)">{{ rt('decisions.' + (decision === 'Correction Required' ? 'correction' : decision.toLowerCase())) }}</button>
      </div>
    </div>
  </AppModal>

  <AppModal v-if="selected && historyModal" :title="t('conservationPages.observations.historyTitle', { id: selected.plantDisplayId })" :subtitle="t('conservationPages.observations.historyLimit')" wide @close="closeModal">
    <p v-if="isLoading" role="status">{{ t('conservationPages.observations.loading') }}</p>
    <p v-if="loadError" role="alert">{{ loadError }}</p>
    <button v-if="hasMore || loadError" class="action-button" :disabled="isLoading" @click="loadObservations(Boolean(nextCursor))">{{ rt('queues.loadMore') }}</button>
    <p class="observation-data-provenance" role="note">{{ modalText('historyReadOnly') }}</p>
    <div class="table-scroll"><table><thead><tr><th>{{ t('conservationPages.observations.id') }}</th><th>{{ t('conservationPages.observations.created') }}</th><th>{{ t('conservationPages.observations.height') }}</th><th>{{ t('conservationPages.observations.health') }}</th><th>{{ t('conservationPages.observations.status') }}</th></tr></thead><tbody><tr v-for="item in history" :key="item.id"><td>{{ item.id }}</td><td>{{ formatDate(item.createdAt) }}</td><td>{{ textOrUnavailable(item.height) }}</td><td>{{ label(item.healthStatus) }}</td><td>{{ label(item.status) }}</td></tr></tbody></table></div>
  </AppModal>
</template>

<style scoped>
.review-status-group { display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
.observations-table .status-cell .review-status-group .resubmission-tag { background: #FFF1DB; color: #926119; font-size: 12px; padding: 3px 8px; flex-shrink: 0; }

.observation-summary { min-width: 0; max-width: 100%; container-type: inline-size; margin-bottom: 18px; }
.observation-summary-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin-bottom: 8px; }
.observation-summary-card { min-width: 0; padding: 18px; border: 1px solid currentColor; border-radius: 14px; background: var(--observation-summary-background); color: var(--observation-summary-ink); box-shadow: none; display: grid; grid-template-rows: 1fr auto; }
.observation-summary-title { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
.officer-layout.officer-layout.officer-layout .observation-summary-title p { margin: 0; min-width: 0; color: inherit; font-size: .875rem; line-height: 1.5; }
.observation-summary-title svg { flex: 0 0 20px; width: 20px; height: 20px; }
.officer-layout.officer-layout.officer-layout .observation-summary-card strong { color: inherit; font-size: 1.875rem; line-height: 1.2; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.observation-summary-card[data-status="Pending Review"] { --observation-summary-background: #e8f0f5; --observation-summary-ink: #315d78; }
.observation-summary-card[data-status="Correction Required"] { --observation-summary-background: #fff1db; --observation-summary-ink: #926119; }
.observation-summary-card[data-status="Flagged"] { --observation-summary-background: #f0eaf8; --observation-summary-ink: #69459a; }
.observation-summary-card[data-status="Rejected"] { --observation-summary-background: #fbe8e5; --observation-summary-ink: #a33f35; }
.observation-summary-card[data-status="Approved"] { --observation-summary-background: #e7f3e9; --observation-summary-ink: #287347; }
.officer-layout.officer-layout.officer-layout .observation-summary-scope { margin: 0; color: #5b7065; font-size: .8125rem; line-height: 1.5; }
@container (max-width: 1150px) { .observation-summary-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@container (max-width: 760px) { .observation-summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container (max-width: 420px) { .observation-summary-grid { grid-template-columns: minmax(0, 1fr); } }
a.action-button { text-decoration: none; }
.officer-review { margin-top: 24px; padding-top: 18px; border-top: 1px solid #dfe7df; }
.officer-review textarea { box-sizing: border-box; width: 100%; min-width: 0; resize: vertical; }
.observation-review-actions { justify-content: flex-end; }
.modal-review-link { max-width: 100%; white-space: normal; overflow-wrap: normal; }
.dataset-note, .detail-state { margin: 0; padding: 14px 18px; color: #63776d; font-size: 12px; }
.state-cell { padding: 30px; text-align: center; }
.state-cell span, td small, .asset-caption small { display: block; margin-top: 4px; }
.error-state { color: #9b3d35; }
.error-state .action-button { margin-top: 12px; }
.observations-scroll { min-width: 0; max-width: 100%; overflow-x: auto; overscroll-behavior-inline: contain; }
.observations-scroll:focus-visible { outline: 3px solid #315b49; outline-offset: -3px; }
.observations-table { width: 100%; min-width: 80rem; table-layout: auto; white-space: normal; border-collapse: separate; border-spacing: 0; }
.observations-table .observation-column { width: 11rem; }
.observations-table .submitter-column { width: 13rem; }
.observations-table .plant-column { width: 6rem; }
.observations-table .species-column { width: 20%; }
.observations-table .status-column, .observations-table .actions-column { width: 1%; }
.observations-table .created-column { width: 10rem; }
.observations-table th, .observations-table td { padding: 12px 14px; text-align: left; vertical-align: middle; white-space: normal; overflow-wrap: anywhere; }
.observations-table th { background: #245443; color: #fff; border-bottom-color: #245443; font-size: 10px; font-weight: 700; line-height: 1.4; }
.observations-table thead th:first-child { border-top-left-radius: 10px; }
.observations-table thead th:last-child { border-top-right-radius: 10px; }
.observations-table td { font-size: 12px; line-height: 1.5; }
.observations-table .status-cell, .observations-table .actions-cell { white-space: nowrap; }
.observations-table .badge { display: inline-flex; align-items: center; width: max-content; max-width: none; box-sizing: border-box; white-space: nowrap; overflow-wrap: normal; font-size: 11px; line-height: 1.4; vertical-align: middle; }
/* Auto-layout lets nonwrapping status/action content set its own minimum column width. */
.observations-scroll .observations-table .action-group { display: flex; flex-wrap: nowrap; align-items: center; justify-content: flex-start; gap: 7px; width: max-content; min-width: max-content; }
.observations-table .action-group > .action-button { flex: 0 0 auto; width: max-content; min-width: max-content; max-width: none; height: auto; min-height: 32px; white-space: nowrap; overflow-wrap: normal; font-size: 11px; }
.observations-scroll .observations-table .identifier-copy { flex: 0 0 44px; width: 44px; min-width: 44px; max-width: 44px; }
.observations-table .state-cell { padding: 30px 14px; text-align: center; }
@media (max-width: 767px) { .observations-table .action-group > .action-button { min-height: 44px; } }
.identity-cell { white-space: normal; }
.identifier-line { display: inline-flex; align-items: center; justify-content: flex-start; flex-wrap: nowrap; gap: 7px; max-width: 100%; vertical-align: middle; }
.identifier-line > strong, .identifier-line > span { min-width: 0; overflow-wrap: anywhere; font-size: 12px; line-height: 1.5; }
.identifier-line > strong { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
.identifier-copy { display: grid; place-items: center start; flex: 0 0 44px; width: 44px; height: 44px; padding: 0; border: 1px solid transparent; border-radius: 8px; background: transparent; color: #315b49; cursor: pointer; }
.identifier-copy svg { display: block; width: 17px; height: 17px; }
.identifier-copy:focus-visible { outline: 3px solid #315b49; outline-offset: 2px; }
.identifier-copy:disabled { opacity: .5; cursor: not-allowed; }
.copy-feedback { margin: 0; padding: 0 18px 12px; color: #315b49; font-size: 12px; overflow-wrap: anywhere; }
.copy-feedback.warning { color: #8a6429; }
.copy-feedback:empty { position: absolute; width: 1px; height: 1px; padding: 0; clip-path: inset(50%); overflow: hidden; }
.full-identifier { overflow-wrap: anywhere; white-space: normal; user-select: text; }
.submission-image-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; }
.submitted-image-item { overflow: hidden; border: 1px solid rgba(58, 96, 70, 0.15); border-radius: 14px; background: #fff; }
.submitted-image-preview { min-height: 150px; display: grid; place-items: center; background: #edf1e9; color: #63776d; }
.submitted-image-preview img { width: 100%; height: 190px; object-fit: cover; }
.asset-caption { padding: 12px; overflow-wrap: anywhere; }
</style>

<style src="../../styles/observation-dialog.css"></style>
