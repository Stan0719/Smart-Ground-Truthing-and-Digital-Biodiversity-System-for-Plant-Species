<script setup lang="ts">
import { observationEditDestination } from '../../services/observationEdits'
import RegistrationObservationEdits from '../../components/conservation/RegistrationObservationEdits.vue'
import StandaloneSpeciesRows from '../../components/conservation/StandaloneSpeciesRows.vue'
import { reviewQueueCache } from '../../services/reviewQueueCache'
interface QueueSnapshot { observations: ReviewObservation[]; changes: RecordChange[]; species: LinkedSpeciesRequest[]; capped: boolean; skipped: number }
const queueSnapshot = ref<QueueSnapshot>({ observations: [], changes: [], species: [], capped: false, skipped: 0 })
const standaloneSpecies = computed({ get: () => queueSnapshot.value.species, set: species => { queueSnapshot.value = { ...queueSnapshot.value, species } } })
const queueReady = ref(false), queueRefreshing = ref(false)
const queueUnverified = ref(false)

const speciesQueueLoading = ref(false), speciesQueueError = ref(false), speciesQueueCapped = ref(false)
type ReviewQueueRow = UnifiedReviewRow<ReviewObservation> | { kind: 'linked_species_request'; key: string; speciesRequest: LinkedSpeciesRequest; createdAt: string }
const rowSource = (row: ReviewQueueRow) => 'speciesRequest' in row ? row.speciesRequest : 'observation' in row ? row.observation : row.change
const rowSubject = (row: ReviewQueueRow) => 'speciesRequest' in row ? row.speciesRequest.requestedBy : 'observation' in row ? row.observation.recordedBy : row.change.owner_subject
const rowStatus = (row: ReviewQueueRow) => 'speciesRequest' in row ? row.speciesRequest.status : 'observation' in row ? row.observation.status : row.change.status
const speciesReadbacks = new Map<string, { sequence: number; request: LinkedSpeciesRequest }>()
function applyVerifiedSpecies(fresh: LinkedSpeciesRequest) {
  reviewQueueCache.evict()
  standaloneRequest.value = fresh
  speciesReadbacks.set(fresh.id, { sequence: ++readbackSequenceCounter, request: fresh })
  standaloneSpecies.value = [...standaloneSpecies.value.filter(row => row.id !== fresh.id), fresh]
}
async function fetchStandaloneSpecies(signal?: AbortSignal) {
  try {
  const payload = await request('/api/species-requests', undefined, { signal, retry: true })
  if (!Array.isArray(payload.species_requests) || payload.species_requests.length > 500) throw Error('Invalid Species queue')
  const mapped = payload.species_requests.map(value => {
    const data = objectValue(value)
    if (!data) return null
    return mapLinkedSpeciesRequest({ species_request_id: data.request_id, species_request: { ...data, proposed_scientific_name: data.scientific_name, assets: [{ id: 'species-request-' + data.request_id, content_type: 'image/jpeg' }] } }, true)
  })
  if (mapped.some(row => !row || ['unknown','error','unavailable'].includes(row.state))) throw Error('Invalid Species evidence')
  return { species: mapped as LinkedSpeciesRequest[], capped: payload.species_requests.length === 500 }
  } catch (failure) { throw Object.assign(failure instanceof Error ? failure : Error('Invalid Species queue'), { queueSource: 'species' }) }
}
// Retrying a source must still produce a coherent queue with linked registrations.
async function loadStandaloneSpecies() { await loadObservations() }
const eligibleObservations = computed(() => observations.value.filter(row => row.origin === (queueOrigin.value === 'unknown' ? 'unknown' : 'initial_registration')))
const standaloneRows = computed<ReviewQueueRow[]>(() => {
  const linked = new Set(eligibleObservations.value.flatMap(row => row.speciesRequest ? [row.speciesRequest.id] : []))
  return standaloneSpecies.value.filter(row => !linked.has(row.id)).map(speciesRequest => ({ kind: 'linked_species_request', key: 'species-request:' + speciesRequest.id, speciesRequest, createdAt: speciesRequest.submittedAt }))
})

import '../../styles/officer-copy.css'
import { useOfficerCopyConfirmation } from '../../composables/useOfficerCopyConfirmation'
const copyConfirmation = useOfficerCopyConfirmation({ schedule: (fn, ms) => window.setTimeout(fn, ms), cancel: id => window.clearTimeout(id as number) })
const controlCopied = copyConfirmation.copied, controlToastKey = copyConfirmation.toastKey

import ReviewFilterDropdown from '../../components/conservation/ReviewFilterDropdown.vue'
import ObservationVersionHistory from '../../components/conservation/ObservationVersionHistory.vue'
import ApprovedRecordChanges from '../../components/conservation/ApprovedRecordChanges.vue'
import { readCompleteQueue, submissionSearchMatches, changeMatches, changeSpeciesId, changeZone, unifiedReviewRows, type RecordChange, type UnifiedReviewRow } from '../../services/recordChanges'
const objectValue = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const changeProposals = computed({ get: () => queueSnapshot.value.changes, set: changes => { queueSnapshot.value = { ...queueSnapshot.value, changes } } })
const submitterNames = ref<Record<string, string>>({})
const changeDialog = ref<InstanceType<typeof ApprovedRecordChanges> | null>(null)
const visibleLimit = ref(100)

import SubmissionChanges from '../../components/conservation/SubmissionChanges.vue'
import { workflowBadgeStyle } from '../../utils/workflowBadge'
import { reviewDateTime, submitterIdentifierLabels } from '../../utils/officerMonitoringDisplay'
import MonitoringIdentifier from '../../components/conservation/MonitoringIdentifier.vue'
import { useConservationText } from '../../composables/useConservationText'
const { ct } = useConservationText()
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { sessionSnapshot, subscribeSession } from '../../services/auth'
import { ReviewApiError, createReviewRequest, readReviewQueueSource, reviewQueueFailureDiagnostic, performObservationReview, observationReviewSnapshot, reviewCommentValid, positiveRevision, reviewEligible, reviewTransitions as transitions, type ReviewDecision } from '../../services/observationReview'
import ActionFeedback from '../../components/ActionFeedback.vue'
import AppModal from '../../components/conservation/AppModal.vue'
import PlantProximityPanel from '../../components/conservation/PlantProximityPanel.vue'
import PlantProximityCell from '../../components/conservation/PlantProximityCell.vue'
import { requestPlantProximity } from '../../services/plantProximity'
import { createPlantProximityQueue, proximityKey } from '../../services/plantProximityQueue'
import PlantPhotoLightbox from '../../components/PlantPhotoLightbox.vue'
import VisibilitySelector from '../../components/conservation/VisibilitySelector.vue'
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

interface ReviewObservation {
  reviewSnapshot: ReturnType<typeof observationReviewSnapshot>
  speciesAssociation: { speciesId: string; scientificName: string }
  historicalState: string
  historicalVersion: boolean
  displayedSnapshotId: string
  approvedSourceSnapshotId: string
  historicalPhotosUnavailable: boolean
  reviewedBy: string
  tableReviewedBy: string
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
  reviewOrigin: string
  reviewDecision: string
  assets: { id: string; contentType: string }[]
  speciesId: string
  plantScientificName: string
  speciesScientificName: string
  submissionUpdate: unknown
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
// Submitted By feedback belongs to a submission row, never to its shared owner.
const copiedToastRow = computed({ get: () => controlToastKey.value.startsWith('submitter:') ? controlToastKey.value.slice(10) : '', set: key => { if (key) copyConfirmation.activate('submitter:' + key); else if (controlToastKey.value.startsWith('submitter:')) copyConfirmation.dismiss() } })
const submitterCopied = ref<Record<string, boolean>>({})
const submitterPending = ref<Record<string, boolean>>({})
const submitterCopies = new Map<string, { source: ReviewObservation | RecordChange | LinkedSpeciesRequest; subject: string; timer?: ReturnType<typeof setTimeout> }>()
function resetSubmitterCopy(key: string) {
  if (copiedToastRow.value === key) copiedToastRow.value = ''
  const entry = submitterCopies.get(key)
  if (entry?.timer !== undefined) window.clearTimeout(entry.timer)
  submitterCopies.delete(key)
  delete submitterCopied.value[key]; delete submitterPending.value[key]
}
function clearSubmitterCopies() { for (const key of submitterCopies.keys()) resetSubmitterCopy(key) }
let copyAttempt = 0
function clearCopyState() {
  copyConfirmation.clear()
  clearSubmitterCopies()
  copyAttempt++
  copyFeedback.value = ''; copiedKey.value = ''; copyFailed.value = false; copyPending.value = false
}
const search = ref('')
const submissionType = ref('')
const submissionTypes = ['initial_registration', 'linked_species_request', 'approved_plant_change', 'approved_species_change'] as const
const reviewStatuses = ['Pending Review', 'Approved', 'Rejected', 'Correction Required', 'Flagged', 'Cancelled', 'Withdrawn', 'Superseded'] as const
const typeFilterOptions = computed(() => [{ value: '', label: t('approvedChanges.allTypes') }, ...submissionTypes.map(value => ({ value, label: typeLabel(value) }))])
const statusFilterOptions = computed(() => [{ value: '', label: ct('All statuses') }, ...reviewStatuses.map(value => ({ value, label: value === 'Cancelled' ? t('approvedChanges.cancelled') : ct(value) }))])
const speciesFilterOptions = computed(() => [{ value: '', label: ct('All species') }, ...speciesOptions.value.map(item => ({ value: item.id, label: item.name }))])
const typeLabel = (kind: string) => kind === 'observation_edit' ? t('observationEdits.title') : kind === 'initial_registration' ? t('approvedChanges.originalRegistration') : kind === 'linked_species_request' ? rt('speciesRequest.title') : kind === 'approved_plant_change' ? t('approvedChanges.plantEdit') : kind === 'approved_species_change' ? t('approvedChanges.speciesEdit') : rt('queues.unverifiedOriginSubmissions')
function clearFilters() { search.value = ''; submissionType.value = ''; status.value = ''; species.value = ''; date.value = ''; visibleLimit.value = 100 }
const status = ref('')
const species = ref('')
const date = ref('')
const selected = ref<ReviewObservation | null>(null)
const historicalSelectionActive = ref(false)
watch(() => selected.value?.id, () => { historicalSelectionActive.value = false })
const standaloneRequest = ref<LinkedSpeciesRequest | null>(null)
const comment = ref('')
const observations = computed({ get: () => queueSnapshot.value.observations, set: observations => { queueSnapshot.value = { ...queueSnapshot.value, observations } } })
const queueOrigin = ref<'initial_registration' | 'unknown'>('initial_registration')
const hasMore = ref(false)
const nextCursor = ref<string | null>(null)
let listRequest = 0
let readbackSequenceCounter = 0
const observationReadbacks = new Map<string, { sequence: number; observation: ReviewObservation }>()
const changeReadbacks = new Map<string, { sequence: number; change: RecordChange }>()
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
const speciesVisibilityError = ref('')
const speciesCommentError = ref('')
const speciesVisibilityField = ref<HTMLElement | null>(null)
const speciesCommentField = ref<HTMLTextAreaElement | null>(null)
watch(speciesVisibility, value => {
  if (['public', 'internal', 'protected'].includes(value)) speciesVisibilityError.value = ''
}, { flush: 'sync' })
watch(speciesReviewComment, value => {
  if (value.trim() && value.length <= 4000) speciesCommentError.value = ''
}, { flush: 'sync' })
watch(() => standaloneRequest.value?.id || selected.value?.id, () => {
  speciesVisibilityError.value = ''
  speciesCommentError.value = ''
}, { flush: 'sync' })
async function focusSpeciesField(field: 'visibility' | 'comment') {
  await nextTick()
  const group = field === 'visibility' ? speciesVisibilityField.value : speciesCommentField.value
  const control = field === 'visibility' ? group?.querySelector<HTMLElement>('input:not(:disabled)') : group
  const modal = group?.closest('.modal-card')
  if (!group || !control || !modal) return
  control.focus({ preventScroll: true })
  // Scroll only the nearest scrollable modal ancestor, keeping the page in place.
  let scroller = group.parentElement
  while (scroller && modal.contains(scroller)) {
    if (/(auto|scroll)/.test(window.getComputedStyle(scroller).overflowY) && scroller.scrollHeight > scroller.clientHeight) {
      const bounds = scroller.getBoundingClientRect()
      const fieldBounds = group.getBoundingClientRect()
      const error = field === 'comment'
        ? document.getElementById?.('species-request-comment-error')
        : group.querySelector<HTMLElement>('.visibility-error')
      const errorBounds = error?.getBoundingClientRect()
      const bottom = Math.max(fieldBounds.bottom, errorBounds?.bottom ?? fieldBounds.bottom)
      const top = bottom - fieldBounds.top > scroller.clientHeight && errorBounds ? errorBounds.top : fieldBounds.top
      if (top < bounds.top || bottom > bounds.bottom) {
        scroller.scrollTo({
          top: scroller.scrollTop + top - bounds.top - 16,
          behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        })
      }
      break
    }
    scroller = scroller.parentElement
  }
}
const speciesNeedsReload = ref(false)
const speciesCycleConflict = ref(false)
const speciesVersionConflict = ref(false)
const speciesInspectionRequired = ref(false)
const speciesReloaded = ref(false)
function requireLatestSpecies(cycleConflict = false) {
  speciesCycleConflict.value = cycleConflict
  speciesVisibilityError.value = ''
  speciesCommentError.value = ''
  speciesVersionConflict.value = true
  speciesNeedsReload.value = true
  speciesInspectionRequired.value = true
  speciesVisibility.value = ''
  speciesSaveError.value = ''
}

const reviewBusy = computed(() => isSaving.value || speciesSaving.value)
const skippedRecords = ref(0)
const reviewMessage = ref<{ variant: 'success' | 'error' | 'info'; message: string } | null>(null)
const feedback = ref<{ id: number; variant: 'success' | 'error' | 'info'; message: string } | null>(null)
const queueHelp = ref<HTMLElement | null>(null), queueHelpOpen = ref(false)
function showQueueHelp(event: Event) {
  const tooltip = queueHelp.value
  if (!tooltip) return
  tooltip.showPopover()
  const anchor = (event.currentTarget as HTMLElement).getBoundingClientRect(), box = tooltip.getBoundingClientRect()
  tooltip.style.left = `${Math.max(12, Math.min(anchor.left, window.innerWidth - box.width - 12))}px`
  tooltip.style.top = `${Math.max(12, Math.min(anchor.bottom + 8, window.innerHeight - box.height - 12))}px`
}
function hideQueueHelp(event?: Event) {
  if (event?.type === 'mouseleave' && event.currentTarget === document.activeElement) return
  queueHelp.value?.hidePopover()
}
let feedbackId = 0
let selectionRequest = 0
let disposed = false
const rt = (key: string, params: Record<string, string | number> = {}) =>
  t(`conservationPages.reviews.${key}`, params)

const showFeedback = (message: string, variant: 'success' | 'error' | 'info' = 'error') => {
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
const formatDate = reviewDateTime

const mapObservation = (value: unknown): ReviewObservation | null => {
  let item = record(value)
  if (!item) return null
  const reviewSnapshot = observationReviewSnapshot(item)
  // Eligibility uses the authoritative response, independently of historical display.
  const speciesAssociation = {
    speciesId: stringValue(item.species_id),
    scientificName: typeof item.scientific_name === 'string' ? item.scientific_name : '',
  }
  const historical = record(item.historical_review)
  const capture = record(historical?.approval_capture)
  const historicalVersion = item.origin_type === 'initial_registration' && item.status === 'Approved' &&
    ['available','partial'].includes(stringValue(historical?.state)) && typeof capture?.id === 'string' && Boolean(capture.id.trim()) && capture.status === 'Superseded'
  const historicalState = item.status === 'Approved' ? stringValue(historical?.state) || 'unavailable' : ''
  if (historicalState) {
    const fields = record(historical?.fields) || {}
    item = { ...item, ...fields, content: record(fields.content) || {},
      species_id: fields.species_id ?? '', plant_scientific_name: fields.plant_scientific_name ?? '',
      scientific_name: fields.scientific_name ?? '', species_scientific_name: fields.species_scientific_name ?? '',
      common_name: fields.common_name ?? '', assets: historical?.assets || [] }
  }
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
    reviewSnapshot,
    speciesAssociation,
    historicalState,
    historicalVersion,
    displayedSnapshotId: ['available','partial'].includes(historicalState) ? stringValue(capture?.id) : '',
    approvedSourceSnapshotId: item.origin_type === 'initial_registration' && ['available','partial'].includes(historicalState) ? stringValue(capture?.source_submitted_history_id) : '',
    historicalPhotosUnavailable: historicalState === 'unavailable' || historical?.photos_unavailable === true,
    reviewedBy: stringValue(item.reviewed_by),
    // A previous cycle's reviewer must never label a new Pending Review row.
    tableReviewedBy: ['Approved', 'Rejected', 'Correction Required', 'Flagged'].includes(stringValue(item.status)) &&
      stringValue(item.review_decision) === item.status && Number.isFinite(Date.parse(stringValue(item.reviewed_at)))
      ? stringValue(item.reviewed_by) : '',
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
    reviewOrigin: stringValue(item.review_origin),
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
    plantScientificName: typeof item.plant_scientific_name === 'string' ? item.plant_scientific_name : '',
    speciesScientificName: typeof item.species_scientific_name === 'string' ? item.species_scientific_name : (typeof item.scientific_name === 'string' ? item.scientific_name : ''),
    submissionUpdate: item.submission_update,
    scientificName: stringValue(item.scientific_name),
    commonName: stringValue(item.common_name),
    latitude: numericValue(content.latitude, -90, 90),
    longitude: numericValue(content.longitude, -180, 180),
    speciesRequest: mapLinkedSpeciesRequest(item, true),
  }
}

const countRecords = computed(() => [
  ...eligibleObservations.value.map(row => ({ status: row.status, reviewedAt: row.reviewedAt })),
  ...standaloneRows.value.map(row => ({ status: rowStatus(row), reviewedAt: 'speciesRequest' in row ? row.speciesRequest.reviewedAt : undefined })),
  ...changeProposals.value.map(row => ({ status: row.status, reviewedAt: row.reviewed_at || undefined })),
])
const counts = computed(() => [
  ...['Pending Review','Correction Required','Flagged','Rejected'].map(status => [status,countRecords.value.filter(row => row.status === status).length]),
  ['Approved Today',countRecords.value.filter(row => row.status === 'Approved' && dateKey(row.reviewedAt) === dateKey(new Date().toISOString())).length],
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
const subjectTokens = computed(() => compactIdentifierTokens([...standaloneSpecies.value.flatMap(item => [item.requestedBy, item.reviewedBy || '']),
      ...observations.value.map(item => item.recordedBy), ...changeProposals.value.map(item => item.owner_subject), ...(selected.value ? [selected.value.recordedBy] : [])].filter(Boolean), subjectPart))
const labelsWithSubmitterNames = (values: (string | null | undefined)[]) => {
  const subjects = values.filter((value): value is string => typeof value === 'string' && Boolean(value))
  const labels = submitterIdentifierLabels(subjects)
  for (const subject of subjects) {
    const id = subject.startsWith('staff:') ? subject.slice(6) : ''
    const account = reviewSession.value.user
    const name = (id && submitterNames.value[id]) ||
      (officerSessionReady.value && account && subject === `staff:${account.id}` ? account.name?.trim() : '')
    if (name) labels.set(subject, name)
  }
  return labels
}
const submissionSubmitterLabels = computed(() => labelsWithSubmitterNames([
  ...standaloneSpecies.value.flatMap(item => [item.requestedBy, item.reviewedBy || '']),
      ...observations.value.map(item => item.recordedBy), selected.value?.recordedBy,
]))
// The directory resolves names only; review ownership comes from the row's decision.
const reviewerName = (subject: string) => {
  if (!officerSessionReady.value || !subject.startsWith('staff:')) return '—'
  const id = subject.slice(6)
  const name = submitterNames.value[id]
  if (typeof name === 'string' && name.trim()) return name.trim()
  const account = reviewSession.value.user
  return account && subject === `staff:${account.id}` && account.name?.trim() ? account.name.trim() : '—'
}
const changeReviewerName = (change: RecordChange) => reviewerName(
  ['Approved', 'Rejected', 'Correction Required'].includes(change.status) &&
    Number.isFinite(Date.parse(change.reviewed_at || '')) ? change.reviewed_by || '' : '',
)
const submitterLabel = (subject: string) => {
  if (!subject) return rt('unavailable')
  const staffId = subject.startsWith('staff:') ? subject.slice(6) : ''
  if (staffId && submitterNames.value[staffId]) return submitterNames.value[staffId]
  const account = reviewSession.value.user
  // The existing authenticated session can identify only this exact account.
  // Other submitters have no authorized name/directory mapping on this page.
  if (officerSessionReady.value && account && subject === `staff:${account.id}` && account.name?.trim()) return account.name.trim()
  const key = subject.startsWith('staff:') ? 'staffIdentifier' : subject.startsWith('visitor:') ? 'visitorIdentifier' : 'submitterIdentifier'
  return t('conservationPages.observations.' + key, { id: subjectTokens.value.get(subject) || subjectPart(subject) })
}
async function copySubmitter(row: ReviewQueueRow) {
  if (!officerSessionReady.value || submitterPending.value[row.key]) return
  const source = rowSource(row)
  const subject = rowSubject(row)
  const actor = reviewSession.value.user?.id
  const matchesRow = () => reviewRows.value.some(item => item.key === row.key && rowSource(item) === source && rowSubject(item) === subject)
  if (!subject || !matchesRow()) return
  resetSubmitterCopy(row.key)
  const entry = { source, subject, timer: undefined as ReturnType<typeof setTimeout> | undefined }
  submitterCopies.set(row.key, entry); submitterPending.value[row.key] = true
  const current = () => !disposed && officerSessionReady.value && actor === reviewSession.value.user?.id && submitterCopies.get(row.key) === entry && matchesRow()
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
    await navigator.clipboard.writeText(subject)
    if (!current()) return
    submitterCopied.value[row.key] = true
    copiedToastRow.value = row.key
    copyFeedback.value = ''; copyFailed.value = false
    entry.timer = window.setTimeout(() => {
      if (submitterCopies.get(row.key) === entry) resetSubmitterCopy(row.key)
    }, 2000)
  } catch {
    if (current()) {
      copiedToastRow.value = ''
      resetSubmitterCopy(row.key)
      copyFailed.value = true; copyFeedback.value = t('conservationPages.observations.copyUnavailable')
    }
  } finally { if (current()) delete submitterPending.value[row.key] }
}
async function copyIdentifier(value: string, kind: 'observation' | 'subject' | 'change', controlKey = `${kind}:${value}`) {
  if (!officerSessionReady.value || copyPending.value || !(observations.value.some(item => (kind === 'observation' ? item.id : item.recordedBy) === value) || changeProposals.value.some(item => (kind === 'change' ? item.id : item.owner_subject) === value)) || !value) return
  const attempt = ++copyAttempt, actor = reviewSession.value.user?.id
  const current = () => !disposed && attempt === copyAttempt && officerSessionReady.value && actor === reviewSession.value.user?.id
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


const filtered = computed(() =>
  observations.value.filter((observation) => {
    if (queueOrigin.value === 'unknown' ? observation.origin !== 'unknown' : observation.origin !== 'initial_registration') return false
    const kind = observation.origin === 'unknown' ? 'legacy_observation' : observation.speciesRequest ? 'linked_species_request' : 'initial_registration'
    const matchesSearch = submissionSearchMatches(search.value, [observation.plantRawId, observation.id],
      [observation.id, observationLabel(observation.id), observation.plantId, observation.recordedBy, submitterLabel(observation.recordedBy)],
      [observation.scientificName, observation.commonName, observation.plantScientificName, observation.speciesScientificName, observation.speciesRequest?.scientificName, observation.zone, observation.status, ct(observation.status), typeLabel(kind), kind === 'linked_species_request' ? 'New Species Request' : kind === 'initial_registration' ? 'Original Registration' : 'Unverified Origin Submissions'])
    const matchesDate = !date.value || dateKey(observation.createdAt) === date.value
    return (
      matchesSearch &&
      (!status.value || observation.status === status.value) &&
      (!species.value || observation.speciesId === species.value) &&
      matchesDate
    )
  }),
)

const matchingChanges = computed(() => changeProposals.value.filter(change => changeMatches(change,
  { search: search.value, status: status.value, species: species.value, date: date.value }, value => dateKey(value),
  { identifiers: [proposalLabel(change.id), submitterLabel(change.owner_subject)], text: [typeLabel(change.observation_edit ? 'observation_edit' : change.plant_id ? 'approved_plant_change' : 'approved_species_change'), ct(change.status)] })))
const notificationChange = computed(() => changeProposals.value.find(row => row.id === route.query.change))
const allReviewRows = computed<ReviewQueueRow[]>(() => {
  const speciesRows = standaloneRows.value.filter(row => {
    if (!('speciesRequest' in row)) return false
    const item = row.speciesRequest
    return (!status.value || item.status === status.value) && (!date.value || dateKey(item.submittedAt) === date.value) &&
      (!species.value || item.approvedSpeciesId === species.value) && submissionSearchMatches(search.value, [item.id],
      [item.id, 'SPECIES-' + item.id, item.requestedBy, submitterLabel(item.requestedBy)], [item.scientificName, item.commonName, item.status, ct(item.status), typeLabel('linked_species_request')])
  })
  const rows: ReviewQueueRow[] = [...unifiedReviewRows(filtered.value, matchingChanges.value), ...speciesRows]
    .filter(row => !submissionType.value || row.kind === submissionType.value)
    .sort((a,b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0) || a.key.localeCompare(b.key))
  const pinned = notificationChange.value
  if (!pinned) return rows
  const [selection] = unifiedReviewRows<ReviewObservation>([], [pinned])
  return selection ? [selection,...rows.filter(row => row.key !== selection.key)] : rows
})
const reviewRows = computed(() => allReviewRows.value.slice(0, visibleLimit.value))
watch(reviewRows, () => { copyAttempt++; copyPending.value = false; copyConfirmation.clear() })
watch(reviewRows, rows => {
  for (const [key, entry] of submitterCopies) {
    if (!rows.some(row => row.key === key && (rowSource(row)) === entry.source && (rowSubject(row)) === entry.subject)) resetSubmitterCopy(key)
  }
}, { flush: 'sync' })
const proposalTokens = computed(() => compactIdentifierTokens(changeProposals.value.map(row => row.id)))
const proposalLabel = (id: string) => `CHANGE-${proposalTokens.value.get(id) || id}`
async function openChange(change: RecordChange) {
  if (change.observation_edit) {
    await router.push(observationEditDestination(change.id, change.observation_edit.current.origin_type))
    return
  }
  const alreadySelected = route.query.change === change.id
  closeReview()
  await router.replace({ query: { ...route.query, review: undefined, speciesRequest: undefined, observationEdit: undefined, change: change.id } })
  if (alreadySelected) await changeDialog.value?.open(change.id)
}
watch([search,submissionType,status,species,date], () => { visibleLimit.value = 100 })

const selectedSpecies = computed(() => selected.value)
const selectedSpeciesRequest = computed(() => standaloneRequest.value || selected.value?.speciesRequest || null)
const speciesSubmitterLabels = computed(() => labelsWithSubmitterNames([selectedSpeciesRequest.value?.requestedBy]))
const reviewerLabels = computed(() => labelsWithSubmitterNames([selected.value?.reviewedBy, selectedSpeciesRequest.value?.reviewedBy]))
const speciesRequestImages = computed(() => selectedSpeciesRequest.value?.assets.filter(asset => asset.contentType.startsWith('image/')) || [])
const speciesPhotoPreview = ref<InstanceType<typeof PlantPhotoLightbox> | null>(null)
const submissionPhotoPreview = ref<InstanceType<typeof PlantPhotoLightbox> | null>(null)
function enlargeSubmissionPhoto(assetId: string, event: Event) {
  const photos = (selected.value?.assets || [])
    .filter(asset => asset.contentType.startsWith('image/') && !failedAssets.value.has(asset.id))
    .map(asset => ({ id: asset.id, url: assetUrl(asset.id) }))
  const index = photos.findIndex(photo => photo.id === assetId)
  if (index >= 0 && event.currentTarget instanceof HTMLElement)
    void submissionPhotoPreview.value?.open(photos, index, ct('SUBMITTED IMAGES'), event.currentTarget)
}
function enlargeSpeciesPhoto(assetId: string, event: Event) {
  const photos = speciesRequestImages.value.filter(asset => !failedAssets.value.has(asset.id)).map(asset => ({ id: asset.id, url: assetUrl(asset.id) }))
  const index = photos.findIndex(photo => photo.id === assetId)
  if (index >= 0 && event.currentTarget instanceof HTMLElement)
    void speciesPhotoPreview.value?.open(photos, index, 'Species request photo', event.currentTarget)
}
const speciesRefreshHelp = ref<HTMLElement | null>(null)
function showSpeciesRefreshHelp(event: Event) {
  const help = speciesRefreshHelp.value
  if (!help) return
  help.showPopover()
  const anchor = (event.currentTarget as HTMLElement).getBoundingClientRect(), box = help.getBoundingClientRect()
  help.style.left = `${Math.max(8, Math.min(anchor.right - box.width, window.innerWidth - box.width - 8))}px`
  help.style.top = `${Math.max(8, Math.min(anchor.top > box.height + 16 ? anchor.top - box.height - 8 : anchor.bottom + 8, window.innerHeight - box.height - 8))}px`
}
function hideSpeciesRefreshHelp(event?: Event) {
  if (event?.type === 'mouseleave' && event.currentTarget === document.activeElement) return
  speciesRefreshHelp.value?.hidePopover()
}
const speciesResolved = computed(() =>
  Boolean(
    selected.value &&
    hasResolvedSpecies(
      selectedSpeciesRequest.value,
      selected.value.speciesAssociation.speciesId,
      selected.value.speciesAssociation.scientificName,
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
const speciesNotice = computed(() => rt(`speciesRequest.notices.${speciesRequestState.value === 'approved' && selected.value?.status === 'Approved' ? 'approvedReadOnly' : speciesRequestState.value}`))
const reviewSession = ref(sessionSnapshot())
const officerSessionReady = computed(() => !reviewSession.value.pending && reviewSession.value.user?.role === 'Conservation Officer' &&
  reviewSession.value.user.status === 'Active' && reviewSession.value.user.mustChangePassword === false)
let queueRecoveryOfficer = reviewSession.value.pending ? reviewSession.value.user?.id : undefined
const unsubscribeReviewSession = subscribeSession((user, pending) => {
  const old = reviewSession.value.user?.id
  reviewSession.value = { user, pending }
  if (pending && user && old === user.id) {
    queueRecoveryOfficer = user.id
    queueUnverified.value = true
    queueRefreshing.value = false
    if (speciesQueueLoading.value) { speciesQueueLoading.value = false; speciesQueueError.value = true }
    if (isSaving.value || speciesSaving.value || selectionLoading.value || speciesRefreshing.value) needsReload.value = true
    selectionRequest++; listRequest++; selectionLoading.value = false; isLoading.value = false
    isSaving.value = false; speciesSaving.value = false; speciesRefreshing.value = false
    return
  }
  if (pending || !user || user.role !== 'Conservation Officer' || user.status !== 'Active' || user.mustChangePassword || old !== user.id) {
    queueRecoveryOfficer = undefined
    queueReady.value = false; queueRefreshing.value = false; submitterNames.value = {}; nameRequest++; nameAbort?.abort()
    observationReadbacks.clear(); changeReadbacks.clear(); speciesReadbacks.clear(); standaloneSpecies.value = []; speciesQueueLoading.value = false; speciesQueueError.value = false; speciesQueueCapped.value = false
    clearCopyState()
    knownQrIdentities.value = new Set()

    clearPlantQr()
    listRequest++; observations.value = []; changeProposals.value = []; hasMore.value = false; nextCursor.value = null; isLoading.value = false
    selectionRequest++; selectionLoading.value = false; selectionError.value = ''; selected.value = null; standaloneRequest.value = null; speciesSaving.value = false; speciesRefreshing.value = false; comment.value = ''; needsReload.value = true
    resetSpeciesState(); speciesCycleConflict.value = false; reviewMessage.value = null; feedback.value = null
  }
  if (officerSessionReady.value && user && queueRecoveryOfficer === user.id) {
    const actor = user.id
    // Consume once, even if pending and verified arrive within the same render tick.
    queueRecoveryOfficer = undefined
    void nextTick(() => {
      if (!disposed && officerSessionReady.value && reviewSession.value.user?.id === actor) void loadObservations()
    })
  }
})
const proximityDrawer = ref<InstanceType<typeof PlantProximityPanel> | null>(null)
const proximitySelection = ref<{ id: string; revision: number } | null>(null)
const proximityVersion = ref(0)
const proximityQueue = createPlantProximityQueue(requestPlantProximity, () => { proximityVersion.value++ })
const proximityEntries = computed(() => {
  void proximityVersion.value
  return new Map([...proximityQueue.entries].map(([key, entry]) => [key, { ...entry }]))
})
const selectedProximityEntry = computed(() => proximitySelection.value ? proximityEntries.value.get(proximityKey(proximitySelection.value)) : undefined)
const isProximityEligible = (row: ReviewObservation) => row.origin === 'initial_registration' && !row.historicalVersion && ['Pending Review', 'Correction Required', 'Flagged'].includes(row.status)
const proximityTargets = computed(() => queueReady.value && !queueUnverified.value && officerSessionReady.value
  ? reviewRows.value.flatMap(row => 'observation' in row && isProximityEligible(row.observation)
    ? [{ id: row.observation.id, revision: row.observation.revision, stamp: row.observation.reviewSnapshot.observation }] : []) : [])
watch(proximityTargets, rows => {
  proximityQueue.setRows(rows)
  if (proximitySelection.value && !rows.some(row => proximityKey(row) === proximityKey(proximitySelection.value!))) {
    proximityDrawer.value?.closeDrawer(); proximitySelection.value = null
  }
}, { immediate: true, flush: 'sync' })
watch(() => [officerSessionReady.value, reviewSession.value.user?.id], () => {
  proximityQueue.clear(); proximityDrawer.value?.closeDrawer(); proximitySelection.value = null
  proximityQueue.setRows(proximityTargets.value)
}, { flush: 'sync' })
async function openProximity(row: ReviewObservation, event: MouseEvent) {
  if (!officerSessionReady.value || queueUnverified.value || !proximityQueue.entries.has(proximityKey(row))) return
  const source = event.currentTarget
  proximitySelection.value = { id: row.id, revision: row.revision }
  proximityQueue.visibility(row, true)
  await nextTick()
  if (proximitySelection.value?.id === row.id && proximitySelection.value.revision === row.revision)
    await proximityDrawer.value?.openDrawer({ currentTarget: source })
}
const canReviewPlant = computed(
  () =>
    !reviewBusy.value &&
    selected.value?.origin === 'initial_registration' &&
    selected.value?.origin === queueOrigin.value &&
    !selectionLoading.value && !selectionError.value &&
    !queueUnverified.value && !needsReload.value &&
    conflictAcknowledged.value &&
    !speciesRefreshing.value &&
    !speciesLoadError.value &&
    !speciesNeedsReload.value &&
    speciesResolved.value &&
    Boolean(selected.value && reviewEligible(reviewSession.value.user, reviewSession.value.pending, { ...selected.value, ...selected.value.speciesAssociation, owner: selected.value.recordedBy })),
)
const canReviewSpecies = computed(
  () =>
    !queueUnverified.value && !historicalSelectionActive.value && !speciesInspectionRequired.value && !speciesVersionConflict.value &&
    typeof selectedSpeciesRequest.value?.reviewCycle === 'number' && typeof selectedSpeciesRequest.value?.contentRevision === 'number' && speciesRequestCanDecide(selectedSpeciesRequest.value) &&
    selectedSpeciesRequest.value?.requestedBy !== `staff:${reviewSession.value.user?.id}` &&
    (Boolean(standaloneRequest.value) || (selected.value?.origin === 'initial_registration' && selected.value?.origin === queueOrigin.value)) &&
    !selectionLoading.value && !selectionError.value &&
    officerSessionReady.value &&
    !reviewBusy.value &&
    !speciesRefreshing.value &&
    !speciesLoadError.value &&
    !speciesNeedsReload.value &&
    !needsReload.value,
)
function resetSpeciesState(observation?: ReviewObservation) {
  speciesVisibilityError.value = ''
  speciesCommentError.value = ''
  speciesVersionConflict.value = false
  speciesInspectionRequired.value = false
  speciesReloaded.value = false
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
  changeProposals.value.forEach(change => { const id = changeSpeciesId(change); if (id && !options.has(id)) options.set(id, change.species_id ? String(change.proposed_snapshot.scientific_name || id) : String(change.proposed_snapshot.species_scientific_name || change.base_snapshot.species_scientific_name || id)) })
  standaloneSpecies.value.forEach(row => { if (row.approvedSpeciesId && !options.has(row.approvedSpeciesId)) options.set(row.approvedSpeciesId, row.commonName || row.scientificName || row.approvedSpeciesId) })
  return [...options].map(([id, name]) => ({ id, name }))
})

async function open(observation: ReviewObservation) {
  if (reviewBusy.value || !officerSessionReady.value) return
  const token = ++selectionRequest
  if (observation.origin !== 'subsequent_observation') queueOrigin.value = observation.origin
  selected.value = observation
  comment.value = observation.reviewComment || ''
  reviewMessage.value = null
  needsReload.value = false
  conflictAcknowledged.value = true
  failedAssets.value = new Set()
  resetSpeciesState(observation)
  void router.replace({ query: { ...route.query, change: undefined, observationEdit: undefined, review: observation.id } })
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
  standaloneRequest.value = null
  delete query.speciesRequest
  delete query.review
  void router.replace({ query })
}

const canDecide = (decision: ReviewDecision) =>
  !queueUnverified.value && !historicalSelectionActive.value && canReviewPlant.value &&
  Boolean(selected.value && transitions[selected.value.status]?.includes(decision))
const countValue = (value: string | number) =>
  !officerSessionReady.value || !queueReady.value || queueUnverified.value || loadError.value || skippedRecords.value ? rt('unavailable') : value
const assetUrl = (id: string) => id.startsWith('historical-species-')
  ? `/api/data/record-versions/${encodeURIComponent(id.slice(19))}/photo`
  : `/api/data/assets/${encodeURIComponent(id)}`
const imageFailed = (id: string) => {
  failedAssets.value = new Set([...failedAssets.value, id])
}

const request = createReviewRequest(rt, (...args) => { if (args[1]?.method === 'POST') reviewQueueCache.invalidate(); return fetch(...args) })
const qrLabel = (value: string) => compactIdentifierTokens([...knownQrIdentities.value, value]).get(value) || value
async function copyQrIdentity() {
  const value = plantQr.value?.identity, observationId = selected.value?.id
  if (!officerSessionReady.value || !value || !observationId || qrLoading.value || qrError.value || qrCopyPending.value) return
  const attempt = ++qrCopyAttempt, actor = reviewSession.value.user?.id
  const current = () => !disposed && attempt === qrCopyAttempt && officerSessionReady.value &&
    actor === reviewSession.value.user?.id && selected.value?.id === observationId && plantQr.value?.identity === value
  copyConfirmation.reset('qr:' + observationId)
  qrCopyPending.value = true; qrCopyFeedback.value = ''; qrCopyFailed.value = false; qrCopied.value = false
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
    await navigator.clipboard.writeText(value)
    if (current()) { qrCopied.value = true; qrCopyFeedback.value = ''; copyConfirmation.confirm('qr:' + observationId) }
  } catch {
    if (current()) { qrCopyFailed.value = true; qrCopyFeedback.value = rt('qrCopyUnavailable') }
  } finally { if (current()) qrCopyPending.value = false }
}
function clearPlantQr() {
  if (selected.value) copyConfirmation.reset('qr:' + selected.value.id)
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
  reviewQueueCache.evict()
  const previousRequest =
    selected.value?.id === observation.id ? selected.value.speciesRequest : null
  const lostDependency = previousRequest && !observation.speciesRequest
  if (lostDependency) {
    observation = { ...observation, speciesRequest: { ...previousRequest, state: 'error' } }
  }
  observationReadbacks.set(observation.id, { sequence: ++readbackSequenceCounter, observation })
  observations.value = observations.value.map((item) =>
    item.id === observation.id ? observation : item,
  )
  if (observation.origin !== queueOrigin.value) {
    if (observation.origin === 'subsequent_observation') observations.value = observations.value.filter(item => item.id !== observation.id)
  }
  selected.value = observation
  void loadPlantQr(observation)
  const mustInspect = speciesInspectionRequired.value
  resetSpeciesState(observation)
  speciesInspectionRequired.value = mustInspect
  if (lostDependency) speciesLoadError.value = rt('speciesRequest.loadFailed')
}
async function refreshSpeciesRequest() {
  if (standaloneRequest.value) { await refreshStandaloneRequest(); return }
  if (!selected.value || reviewBusy.value || speciesRefreshing.value || selectionLoading.value || selectionError.value) return
  const mustInspect = speciesInspectionRequired.value
  const speciesDraft = speciesReviewComment.value
  const id = selected.value.id
  const token = ++selectionRequest
  speciesRefreshing.value = true
  speciesLoadError.value = ''
  try {
    // Observation detail is authoritative for both the request and resulting species.
    const fresh = await fetchObservation(id)
    if (disposed || token !== selectionRequest) return
    updateObservation(fresh)
    speciesReviewComment.value = speciesDraft
    speciesNeedsReload.value = false
    speciesVersionConflict.value = false
    speciesInspectionRequired.value = mustInspect
    speciesReloaded.value = true
    failedAssets.value = new Set()
  } catch (error) {
    if (!disposed && token === selectionRequest)
      speciesLoadError.value =
        error instanceof Error ? error.message : rt('speciesRequest.loadFailed')
  } finally {
    if (!disposed && token === selectionRequest) speciesRefreshing.value = false
  }
}
function reviewedByOther(status: string, reviewer: string | undefined, at: string | undefined) {
  return ['Approved', 'Rejected', 'Correction Required'].includes(status) &&
    Boolean(at && Number.isFinite(Date.parse(at)) && reviewer?.startsWith('staff:') && reviewer.length > 6 && reviewer !== `staff:${reviewSession.value.user?.id}`)
}
async function recoverSpeciesConflict(error: ReviewApiError, draft: string, current: () => boolean, observationId?: string) {
  const code = error.code
  const cycleChanged = code === 'SPECIES_REQUEST_REVIEW_CYCLE_CONFLICT'
  const versionChanged = cycleChanged || code === 'SPECIES_REQUEST_VERSION_CONFLICT'
  // Lock before reading; never reuse approval visibility after a conflict.
  requireLatestSpecies(cycleChanged)
  const plantDraft = comment.value
  try {
    if (observationId) {
      const fresh = await fetchObservation(observationId)
      if (!current()) return
      updateObservation(fresh)
      comment.value = plantDraft
    } else {
      const fresh = await fetchStandaloneRequest(standaloneRequest.value!.id)
      if (!current()) return
      applyVerifiedSpecies(fresh)
      void loadObservations()
    }
    const fresh = selectedSpeciesRequest.value
    if (!fresh || ['error','unknown','unavailable'].includes(fresh.state)) throw new ReviewApiError(rt('feedback.invalidResponse'))
    speciesReviewComment.value = draft
    speciesVisibility.value = ''
    speciesNeedsReload.value = false
    speciesLoadError.value = ''; speciesSaveError.value = ''
    speciesVersionConflict.value = false
    speciesCycleConflict.value = cycleChanged
    speciesReloaded.value = true
    speciesInspectionRequired.value = fresh.state === 'pending'
    const confirmed = reviewedByOther(fresh.status, fresh.reviewedBy, fresh.reviewedAt)
    showFeedback(confirmed ? rt('feedback.reviewedElsewhere') : fresh.state !== 'pending' ? rt('feedback.conflictRefreshed') : versionChanged ? cycleChanged ? t('submissionChanges.cycleChanged') : rt('speciesRequest.submissionChanged') : rt('speciesRequest.conflict'), fresh.state !== 'pending' ? 'info' : 'error')
  } catch {
    if (!current()) return
    requireLatestSpecies(cycleChanged)
    speciesLoadError.value = rt('speciesRequest.conflictReloadFailed')
    showFeedback(speciesLoadError.value)
  } finally { if (current()) speciesReviewComment.value = draft }
}
async function decideSpecies(decision: SpeciesRequestDecision) {
  if (historicalSelectionActive.value || (!selected.value && !standaloneRequest.value) || !canReviewSpecies.value || !selectedSpeciesRequest.value) return
  speciesVisibilityError.value = ''
  speciesCommentError.value = ''
  if (decision === 'Approved' && !speciesVisibility.value) {
    speciesVisibilityError.value = t('officerFeedback.visibilityRequired')
    await focusSpeciesField('visibility')
    return
  }
  const typedComment = speciesReviewComment.value
  if (typedComment.length > 4000 || (decision !== 'Approved' && !typedComment.trim())) {
    speciesCommentError.value = rt(
      typedComment.length > 4000
        ? 'speciesRequest.commentTooLong'
        : 'speciesRequest.commentRequired',
    )
    await focusSpeciesField('comment')
    return
  }
  if (standaloneRequest.value) { await decideStandaloneSpecies(decision, typedComment); return }
  const observationId = selected.value!.id
  const requestId = selectedSpeciesRequest.value.id
  const expectedReviewCycle = selectedSpeciesRequest.value.reviewCycle!
  const expectedRevision = selectedSpeciesRequest.value.contentRevision!
  const token = ++selectionRequest
  speciesSaving.value = true
  speciesSaveError.value = ''
  reviewMessage.value = null
  let committed = false
  const actor = reviewSession.value.user?.id
  const current = () => !disposed && token === selectionRequest && officerSessionReady.value && actor === reviewSession.value.user?.id && selected.value?.id === observationId && route.query.review === observationId
  try {
    const latest = await fetchObservation(observationId)
    if (!current()) return
    if (latest.origin !== queueOrigin.value || latest.speciesRequest?.id !== requestId || latest.speciesRequest.state !== 'pending') {
      updateObservation(latest)
      speciesReviewComment.value = typedComment
      speciesVisibility.value = ''
      const fresh = latest.speciesRequest
      const confirmed = !!fresh && reviewedByOther(fresh.status, fresh.reviewedBy, fresh.reviewedAt)
      showFeedback(latest.origin !== queueOrigin.value ? rt('queues.originMoved') : confirmed ? rt('feedback.reviewedElsewhere') : rt('feedback.conflictRefreshed'), latest.origin === queueOrigin.value ? 'info' : 'error')
      return
    }
    const result = await request(speciesRequestReviewUrl(requestId), {
      expected_review_cycle: expectedReviewCycle,
      expected_revision: expectedRevision,
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
      await recoverSpeciesConflict(error, typedComment, current, observationId)
      if (!current()) return
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
    // Cleanup belongs to this request, even when navigation made its result stale.
    if (!disposed && token === selectionRequest) {
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
  } }, true)
  if (!mapped || ['error','unknown','unavailable'].includes(mapped.state)) throw new ReviewApiError(rt('feedback.invalidResponse'))
  return mapped
}
async function refreshStandaloneRequest() {
  if (!standaloneRequest.value || reviewBusy.value || speciesRefreshing.value || !officerSessionReady.value) return
  const mustInspect = speciesInspectionRequired.value
  const id = standaloneRequest.value.id, token = ++selectionRequest
  speciesRefreshing.value = true; speciesLoadError.value = ''
  try {
    const fresh = await fetchStandaloneRequest(id)
    if (!disposed && token === selectionRequest && officerSessionReady.value) {
      applyVerifiedSpecies(fresh)
      speciesVisibilityError.value = ''
      speciesCommentError.value = ''
      speciesNeedsReload.value = false
      speciesSaveError.value = ''
      speciesVersionConflict.value = false
      speciesInspectionRequired.value = mustInspect
      speciesReloaded.value = true
      speciesVisibility.value = ''
    }
  } catch (error) { if (!disposed && token === selectionRequest) speciesLoadError.value = error instanceof Error ? error.message : rt('speciesRequest.loadFailed') }
  finally { if (!disposed && token === selectionRequest) speciesRefreshing.value = false }
}
async function decideStandaloneSpecies(decision: SpeciesRequestDecision, typedComment: string) {
  if (historicalSelectionActive.value) return
  const expectedReviewCycle = standaloneRequest.value!.reviewCycle!
  const expectedRevision = standaloneRequest.value!.contentRevision!
  const id = standaloneRequest.value!.id, token = ++selectionRequest
  speciesSaving.value = true; speciesSaveError.value = ''; reviewMessage.value = null
  let committed = false
  const current = () => !disposed && token === selectionRequest && officerSessionReady.value && route.query.speciesRequest === id
  try {
    const fresh = await fetchStandaloneRequest(id)
    if (!current()) return
    if (fresh.state !== 'pending' || fresh.requestedBy === `staff:${reviewSession.value.user?.id}`) {
      applyVerifiedSpecies(fresh); speciesVisibility.value = ''; speciesReviewComment.value = typedComment
      const confirmed = reviewedByOther(fresh.status, fresh.reviewedBy, fresh.reviewedAt)
      showFeedback(confirmed ? rt('feedback.reviewedElsewhere') : rt('feedback.conflictRefreshed'), 'info')
      return
    }
    const result = await request(speciesRequestReviewUrl(id), { decision, comment: typedComment, expected_revision: expectedRevision, expected_review_cycle: expectedReviewCycle,
      ...(decision === 'Approved' ? { visibility: speciesVisibility.value } : {}) })
    if (!current()) return
    if (result.reviewed !== true) throw new ReviewApiError(rt('feedback.invalidResponse'))
    committed = true
    const saved = await fetchStandaloneRequest(id)
    if (!current()) return
    applyVerifiedSpecies(saved)
    if (saved.status !== decision) throw new ReviewApiError(rt('feedback.invalidResponse'))
    showFeedback(rt('speciesRequest.saved'), 'success')
  } catch (error) {
    if (!current()) return
    if (error instanceof ReviewApiError && error.status === 409 && !committed) {
      await recoverSpeciesConflict(error, typedComment, current)
      return
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
    if (!disposed && token === selectionRequest && officerSessionReady.value) { applyVerifiedSpecies(fresh); speciesReviewComment.value = fresh.reviewComment; failedAssets.value = new Set() }
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
    if (observation.origin !== 'subsequent_observation') queueOrigin.value = observation.origin
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
    const changed = fresh.reviewSnapshot.observation !== selected.value.reviewSnapshot.observation
    const speciesChanged = fresh.reviewSnapshot.species !== selected.value.reviewSnapshot.species
    const mustInspect = !conflictAcknowledged.value
    const draftComment = comment.value
    const draftSpeciesComment = speciesReviewComment.value
    const visibility = speciesVisibility.value
    const mustInspectSpecies = speciesInspectionRequired.value
    updateObservation(fresh)
    comment.value = draftComment
    speciesReviewComment.value = draftSpeciesComment
    speciesInspectionRequired.value = mustInspectSpecies || speciesChanged
    if (!speciesChanged && !mustInspectSpecies) speciesVisibility.value = visibility
    needsReload.value = false
    conflictAcknowledged.value = !mustInspect && !changed
    failedAssets.value = new Set()
    showFeedback(changed || mustInspect ? rt('feedback.reloaded') : t('submissionChanges.upToDate'), changed || mustInspect ? 'error' : 'info')
  } catch (error) {
    if (!disposed && token === selectionRequest) {
      needsReload.value = true
      showFeedback(error instanceof Error ? error.message : rt('feedback.loadFailed'))
    }
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
      current: () => !disposed && token === selectionRequest && officerSessionReady.value && selected.value?.id === id && route.query.review === id, invalidResponse: rt('feedback.invalidResponse') })
    if (!result) return
    const speciesDraft = speciesReviewComment.value
    if (result.observation) updateObservation(result.observation)
    if (result.kind !== 'saved') { speciesReviewComment.value = speciesDraft; speciesVisibility.value = '' }
    needsReload.value = result.needsReload
    if (result.kind === 'saved') { comment.value = selected.value?.reviewComment || ''; showFeedback(rt('feedback.saved'), 'success') }
    else {
      comment.value = typedComment
      if (result.kind === 'conflict') {
        const fresh = result.observation
        const confirmed = !!fresh && reviewedByOther(fresh.status, fresh.reviewedBy, fresh.reviewedAt)
        const completed = !!fresh && ['Approved','Rejected','Correction Required'].includes(fresh.status)
        conflictAcknowledged.value = completed
        if (fresh?.speciesRequest?.state === 'pending') speciesInspectionRequired.value = true
        showFeedback(rt(result.needsReload ? 'feedback.conflictReloadFailed' : confirmed ? 'feedback.reviewedElsewhere' : completed ? 'feedback.conflictRefreshed' : 'feedback.conflict'), completed ? 'info' : 'error')
      }
      else showFeedback(result.committed ? rt('feedback.savedReloadFailed') : result.error instanceof Error ? result.error.message : rt('feedback.requestFailed', { status: 0 }))
    }
  } finally {
    isSaving.value = false
    if (route.query.review !== id) void resolveQuery()
  }

}

function updateChange(change: RecordChange) {
  reviewQueueCache.evict()
  if (!officerSessionReady.value || disposed) return
  changeReadbacks.set((change.observation_edit ? 'observation-edit:' : '') + change.id, { sequence: ++readbackSequenceCounter, change })
  changeProposals.value = changeProposals.value.map(row => row.id === change.id && !!row.observation_edit === !!change.observation_edit ? change : row)
}
let nameRequest = 0
let nameAbort: AbortController | null = null
async function resolveQueueNames(token: number, actor: string) {
  const ids = [...new Set([
    ...standaloneSpecies.value.flatMap(item => [item.requestedBy, item.reviewedBy || '']),
    ...observations.value.flatMap(item => [item.recordedBy, item.reviewedBy, item.speciesRequest?.reviewedBy || '']),
    ...changeProposals.value.flatMap(item => [item.owner_subject, item.reviewed_by || '']),
  ].filter(subject => subject.startsWith('staff:')).map(subject => subject.slice(6)))].slice(0, 100)
  const sequence = ++nameRequest
  nameAbort?.abort(); nameAbort = new AbortController()
  if (!ids.length) return
  try {
    const response = await fetch(`/api/conservation/submitter-names?ids=${encodeURIComponent(ids.join(','))}`, { credentials: 'same-origin', signal: AbortSignal.any([nameAbort.signal, AbortSignal.timeout(5000)]) })
    if (!response.ok) return
    const body = await response.json() as { names?: Record<string, unknown> }
    if (!disposed && token === listRequest && sequence === nameRequest && officerSessionReady.value && reviewSession.value.user?.id === actor && body.names && typeof body.names === 'object' && !Array.isArray(body.names)) {
      submitterNames.value = Object.fromEntries(Object.entries(body.names).filter(([id, name]) => ids.includes(id) && typeof name === 'string' && name.trim())) as Record<string, string>
    }
  } catch { /* Optional labels never delay or disable the verified queue. */ }
}
async function loadObservations(append = false) {
  if (append) { visibleLimit.value += 100; return }
  if (disposed || !officerSessionReady.value) return
  const token = ++listRequest, actor = reviewSession.value.user!.id
  const readbackSequence = readbackSequenceCounter
  const current = () => !disposed && token === listRequest && officerSessionReady.value && reviewSession.value.user?.id === actor
  if (!queueReady.value) {
    const cached = reviewQueueCache.read<QueueSnapshot>()
    if (cached) { queueSnapshot.value = cached; queueReady.value = true; speciesQueueCapped.value = cached.capped; skippedRecords.value = cached.skipped }
  }
  isLoading.value = !queueReady.value; queueRefreshing.value = queueReady.value
  loadError.value = ''; speciesQueueError.value = false; speciesQueueLoading.value = true
  nextCursor.value = null; hasMore.value = false
  try {
    const snapshot = await reviewQueueCache.load<QueueSnapshot>(async (current, signal) => {
      const [rawObservations, changes, species] = await Promise.all([
      readReviewQueueSource('observations', () => readCompleteQueue(async cursor => {
        const result = await request(observationQueueUrl('all', '', cursor), undefined, { signal, retry: true })
        const page = readQueuePage(result.page)
        if (!Array.isArray(result.observations) || !page) throw new ReviewApiError(rt('feedback.invalidResponse'))
        return { rows: result.observations, more: page.hasMore, cursor: page.cursor }
      }, current)),
      readReviewQueueSource('changes', () => readCompleteQueue<RecordChange>(async cursor => {
        const query = new URLSearchParams({ limit: '100' }); if (cursor) query.set('cursor',cursor)
        const result = await request('/api/data/record-changes?' + query, undefined, { signal, retry: true })
        const page = readQueuePage(result.page)
        if (!Array.isArray(result.changes) || !page || result.changes.some(value => {
          const row = objectValue(value)
          return !row || typeof row.id !== 'string' || typeof row.status !== 'string' || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at)) || typeof row.owner_subject !== 'string' || Boolean(row.plant_id) === Boolean(row.species_id) || !objectValue(row.base_snapshot) || !objectValue(row.proposed_snapshot)
        })) throw new ReviewApiError(rt('feedback.invalidResponse'))
        return { rows: result.changes as RecordChange[], more: page.hasMore, cursor: page.cursor }
      }, current)),
        readReviewQueueSource('species', () => fetchStandaloneSpecies(signal)),
      ])
      const mapped = rawObservations.map(mapObservation)
      return {
        observations: mapped.filter((item): item is ReviewObservation => item !== null && item.origin !== 'subsequent_observation'),
        changes: changes.filter(item => !item.observation_edit),
        species: species.species, capped: species.capped, skipped: mapped.filter(item => item === null).length,
      }
    })
    if (!current()) return
    const freshSpecies = new Map(snapshot.species.map(row => [row.id, row]))
    for (const [id, readback] of speciesReadbacks) {
      const listed = freshSpecies.get(id), verified = readback.request
      const newerCycle = listed && ((listed.contentRevision || 0) > (verified.contentRevision || 0) || (listed.reviewCycle || 0) > (verified.reviewCycle || 0))
      if (readback.sequence > readbackSequence || !listed || (!newerCycle && ((listed.contentRevision || 0) < (verified.contentRevision || 0) || (listed.reviewCycle || 0) < (verified.reviewCycle || 0) || (listed.state === 'pending' && verified.state !== 'pending')))) freshSpecies.set(id, verified)
    }
    // One reactive assignment publishes all sources, before optional names.
    queueSnapshot.value = { ...snapshot,
      observations: [...new Map(snapshot.observations.map(item => {
        const readback = observationReadbacks.get(item.id)
        return [item.id, readback && readback.sequence > readbackSequence ? readback.observation : item] as const
      })).values()].filter(item => item.origin !== 'subsequent_observation'),
      changes: [...new Map(snapshot.changes.map(item => {
        const readback = changeReadbacks.get(item.id)
        return [item.id, readback && readback.sequence > readbackSequence ? readback.change : item] as const
      })).values()], species: [...freshSpecies.values()],
    }
    speciesQueueCapped.value = snapshot.capped; skippedRecords.value = snapshot.skipped
    queueReady.value = true; queueUnverified.value = false
    void resolveQueueNames(token, actor)
  } catch (failure) {
    if (current()) {
      console.warn('[review-queue]', reviewQueueFailureDiagnostic(failure))
      queueUnverified.value = true; speciesQueueError.value = (failure as { queueSource?: string })?.queueSource === 'species'
      loadError.value = failure instanceof Error ? failure.message : rt('feedback.loadFailed')
    }
  } finally {
    if (current()) { isLoading.value = false; queueRefreshing.value = false; speciesQueueLoading.value = false; void resolveQuery() }
  }
}
watch(() => route.query.change, id => { if (typeof id === 'string' && queueOrigin.value !== 'initial_registration') { queueOrigin.value = 'initial_registration'; void loadObservations() } })
onMounted(loadObservations)
watch(
  () => [route.query.review, route.query.speciesRequest, officerSessionReady.value],
  () => void resolveQuery(),
)
watch(() => route.query.legacy, value => { if(value === '1') queueOrigin.value = 'unknown' }, { immediate: true })
watch(() => [route.query.review, route.query.speciesRequest, route.query.change, route.query.observationEdit], clearSubmitterCopies)
onBeforeUnmount(() => {
  disposed = true
  proximityQueue.dispose(); proximityDrawer.value?.closeDrawer()
  nameRequest++; nameAbort?.abort()
  clearCopyState()
  clearPlantQr()
  unsubscribeReviewSession()
  selectionRequest++
  listRequest++
})
</script>

<template>
  <span class="officer-copy-live" role="status" aria-live="polite" aria-atomic="true"><span v-if="controlToastKey && !controlToastKey.startsWith('submitter:')" :key="controlToastKey">{{ t('conservationPages.reviews.copiedToast') }}</span></span>
  <div class="submitter-copy-status" role="status" aria-live="polite" aria-atomic="true">
    <span v-if="copiedToastRow" :key="copiedToastRow">{{ rt('copiedToast') }}</span>
  </div>
  <ActionFeedback
    v-if="feedback"
    :key="feedback.id"
    :feedback-id="feedback.id"
    :variant="feedback.variant"
    :message="feedback.message"
    @dismiss="dismissFeedback"
  />

  <ApprovedRecordChanges ref="changeDialog" @updated="updateChange" @reviewing="reviewQueueCache.invalidate()" />
  <section class="page-intro reviews-intro">
    <div>
      <p class="page-kicker">{{ rt('queues.registrationEyebrow') }}</p>
      <div class="registration-title-row"><h2>{{ rt('queues.registrations') }}</h2><button type="button" class="queue-help-button" :aria-label="rt('queues.aboutQueue')" :aria-expanded="queueHelpOpen" aria-controls="registration-queue-help" @mouseenter="showQueueHelp" @mouseleave="hideQueueHelp" @focus="showQueueHelp" @blur="hideQueueHelp" @click="showQueueHelp" @keydown.esc.stop.prevent="hideQueueHelp()">?</button></div>
      <div id="registration-queue-help" ref="queueHelp" popover="auto" role="tooltip" class="queue-help-popover" @toggle="queueHelpOpen = ($event as ToggleEvent).newState === 'open'">
        <div class="queue-help-heading"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 10v7m0-11v1" /></svg><strong>{{ rt('queues.aboutQueue') }}</strong></div>
        <div class="queue-help-section"><span class="queue-help-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 4C10 3 4 7 5 13c1 7 14 5 15-9Z" /><path d="M3 21 15 9" /></svg></span><div><h3>{{ rt('queues.includedHeading') }}</h3><p>{{ rt('queues.includedText') }}</p></div></div>
        <div class="queue-help-section"><span class="queue-help-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 7 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5M3 17l9 5 9-5" /></svg></span><div><h3>{{ rt('queues.countsHeading') }}</h3><p>{{ rt('queues.countsText') }}</p></div></div>
      </div>
      <p>{{ rt('queues.registrationIntro') }}</p>
    </div>
  </section>
  <p v-if="queueRefreshing" role="status">{{ rt('queueRefresh.refreshing') }}</p>
  <p v-if="queueUnverified" class="review-feedback error" role="alert">{{ rt('queueRefresh.unverified') }}</p>
  <p v-if="speciesQueueLoading" role="status">{{ t('finalOfficerWorkflow.loading') }}</p>
  <p v-if="speciesQueueError || speciesQueueCapped" role="status">{{ t(speciesQueueError ? 'finalOfficerWorkflow.speciesUnavailable' : 'finalOfficerWorkflow.speciesCapped') }} <button type="button" :disabled="!officerSessionReady || speciesQueueLoading" @click="loadStandaloneSpecies">{{ t('finalOfficerWorkflow.retry') }}</button></p>
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
    <label class="field" for="review-type-filter"><span id="review-type-filter-label">{{ t('approvedChanges.submissionType') }}</span><ReviewFilterDropdown id="review-type-filter" v-model="submissionType" labelled-by="review-type-filter-label" :options="typeFilterOptions" /></label>
    <label class="field search-field"
      ><span>{{ ct('Search') }}</span
      ><input v-model="search" :placeholder="t('approvedChanges.searchPlaceholder')"
    /></label>
    <label class="field" for="review-status-filter"><span id="review-status-filter-label">{{ ct('Review status') }}</span><ReviewFilterDropdown id="review-status-filter" v-model="status" labelled-by="review-status-filter-label" :options="statusFilterOptions" /></label>
    <label class="field" for="review-species-filter"><span id="review-species-filter-label">{{ ct('Species') }}</span><ReviewFilterDropdown id="review-species-filter" v-model="species" labelled-by="review-species-filter-label" :options="speciesFilterOptions" /></label>
    <label class="field">
      <span>{{ rt('recordCreated') }}</span>
      <input v-model="date" type="date" />
    </label>
  </div>
  <button type="button" class="secondary-button clear-review-filters" @click="clearFilters"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10a9 9 0 1 1 2.6 8.4 M3 4v6h6" /></svg><span>{{ t('common.clearFilters') }}</span></button>
  <p v-if="notificationChange" role="status">{{ t('approvedChanges.notificationSelection') }}</p>
  <p v-if="selectionLoading" role="status">{{ rt('loadingDetail') }}</p>
  <p v-if="skippedRecords" role="status">{{ rt('skippedRecords', { count: skippedRecords }) }}</p>
  <p v-if="queueOrigin === 'unknown'">{{ rt('queues.originUnverified') }}</p>
  <section class="panel reviews-panel">
    <p class="copy-feedback" :class="{ warning: copyFailed }" role="status" aria-live="polite" aria-atomic="true">{{ copyFeedback }}</p>
    <div class="table-scroll reviews-scroll" role="region" :aria-label="rt('queues.registrations')" tabindex="0">
      <table class="reviews-table">
        <colgroup><col class="observation-column" /><col class="plant-column" /><col class="type-column" /><col class="species-column" /><col class="submitter-column" /><col class="reviewer-column" /><col class="zone-column" /><col class="created-column" /><col class="status-column" /><col class="proximity-column" /><col class="actions-column" /></colgroup>
        <thead>
          <tr>
            <th scope="col">{{ t('approvedChanges.submissionId') }}</th>
            <th scope="col">{{ t('approvedChanges.plantId') }}</th>
            <th scope="col">{{ t('approvedChanges.submissionType') }}</th>
            <th scope="col">{{ ct('Species') }}</th>
            <th scope="col">{{ ct('Submitted By') }}</th>
            <th scope="col">{{ t('approvedChanges.reviewedByColumn') }}</th>
            <th scope="col">{{ ct('Location Zone') }}</th>
            <th scope="col">{{ rt('recordCreated') }}</th>
            <th scope="col">{{ ct('Status') }}</th>
            <th scope="col">{{ t('plantProximity.scoreColumn') }}</th>
            <th scope="col">{{ ct('Actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in (queueReady ? reviewRows : [])" :key="row.key" :class="{ 'terminal-read-only': ['Withdrawn', 'Cancelled'].includes(rowStatus(row)) }">
          <StandaloneSpeciesRows v-if="'speciesRequest' in row" :row="row.speciesRequest" :submitter="submitterLabel(row.speciesRequest.requestedBy)" :reviewer="row.speciesRequest.state === 'pending' || !row.speciesRequest.reviewedAt ? '\u2014' : reviewerName(row.speciesRequest.reviewedBy || '')" :authorized="officerSessionReady" @open="router.push({ name: 'conservation-reviews', query: { speciesRequest: $event } })" />
          <template v-else-if="'observation' in row"><template v-for="observation in [row.observation]" :key="observation.id">
          <td class="identity-cell"><div class="identifier-line"><strong :title="observation.id">{{ observationLabel(observation.id) }}</strong><span class="officer-copy-anchor"><button type="button" class="identifier-copy" :disabled="!officerSessionReady || copyPending" :aria-label="t('conservationPages.observations.copyObservationId', { id: observationLabel(observation.id) })" :title="t('conservationPages.observations.copyObservationId', { id: observationLabel(observation.id) })" @click="copyIdentifier(observation.id, 'observation', `review-icon-0:${observation.id}`)"><svg v-if="!controlCopied[`review-icon-0:${observation.id}`]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></svg><svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="m5 12 4 4 10-10" /></svg></button><span v-if="controlToastKey === `review-icon-0:${observation.id}`" :key="`review-icon-0:${observation.id}`" class="officer-copy-toast" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 12 4 4 10-10" /></svg><span>{{ t('conservationPages.reviews.copiedToast') }}</span></span></span></div></td>
            <td class="plant-id-cell">{{ observation.plantId }}</td>
            <td class="submission-type-cell"><div class="species-request-list">
              <span class="species-request-badge">{{ observation.origin === 'unknown' ? rt('queues.unverifiedOriginSubmissions') : observation.speciesRequest ? rt('speciesRequest.title') : t('approvedChanges.originalRegistration') }}</span>
              <span v-if="observation.speciesRequest?.updated" class="badge species-updated-badge">{{ rt('speciesRequest.updated') }}</span>
            </div></td>
            <td><em v-if="observation.speciesRequest?.scientificName || observation.plantScientificName || observation.scientificName">{{ observation.speciesRequest ? observation.speciesRequest.scientificName || ct('Species unavailable') : observation.plantScientificName || observation.scientificName }}</em><span v-else>{{ ct('Species unavailable') }}</span></td>
          <td class="identity-cell"><div class="identifier-line"><span :title="observation.recordedBy">{{ submitterLabel(observation.recordedBy) }}</span><template v-if="observation.recordedBy"><span class="submitter-copy-anchor"><button type="button" class="identifier-copy" :disabled="!officerSessionReady || submitterPending[row.key]" :aria-label="t('conservationPages.observations.copySubject', { id: submitterLabel(observation.recordedBy) })" :title="t('conservationPages.observations.copySubject', { id: submitterLabel(observation.recordedBy) })" @click="copySubmitter(row)" :data-submitter-copy="row.key"><svg v-if="!submitterCopied[row.key]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></svg><svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="m5 12 4 4 10-10" /></svg></button><span v-if="copiedToastRow === row.key" class="submitter-copy-toast" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 12 4 4 10-10" /></svg><span>{{ rt('copiedToast') }}</span></span></span></template></div></td>
            <td class="reviewer-cell">{{ reviewerName(observation.tableReviewedBy) }}</td>
            <td>{{ observation.zone || rt('notRecorded') }}</td>
            <td>{{ formatDate(observation.createdAt) }}</td>
            <td class="status-cell">
              <span class="review-status-group" :class="{ 'has-historical-version': observation.historicalVersion }"><span class="badge" :style="workflowBadgeStyle(observation.status)" :class="observation.status.toLowerCase().replaceAll(' ', '-')">{{
                observation.status ? ct(observation.status) : '—'
              }}</span>
              <span v-if="observation.historicalVersion" class="badge historical-version-badge">{{ t('observationVersions.historicalVersion') }}</span>
              <span v-if="observation.status === 'Pending Review' && (observation.submissionUpdate as { state?: string } | null)?.state === 'updated'" class="badge resubmission-tag">{{ t('submissionChanges.updated') }}</span>
              <span v-if="observation.status === 'Pending Review' && observation.isCorrectionResubmission" class="badge resubmission-tag">{{ t('conservationPages.observations.resubmitted') }}</span></span>
            </td>
            <td class="proximity-cell"><PlantProximityCell v-if="isProximityEligible(observation)" :key="proximityKey(observation)" :entry="proximityEntries.get(proximityKey(observation))" :enabled="officerSessionReady && !queueUnverified" @visibility="proximityQueue.visibility(observation, $event)" @open="openProximity(observation, $event)" /><span v-else>—</span></td>
            <td class="actions-cell"><div class="action-group">
              <button class="action-button" :disabled="reviewBusy" @click="open(observation)">
                {{ ct('Review') }}
              </button>
            </div></td>
          </template></template>
          <template v-else>
            <td class="identity-cell edit-identity"><div class="identifier-line"><strong :title="row.change.id" :aria-label="row.change.id">{{ proposalLabel(row.change.id) }}</strong><span class="officer-copy-anchor"><button type="button" class="identifier-copy" :disabled="!officerSessionReady || copyPending" :aria-label="t('approvedChanges.copyProposal')" @click="copyIdentifier(row.change.id, 'change', `review-icon-1:${row.change.id}`)"><svg v-if="!controlCopied[`review-icon-1:${row.change.id}`]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></svg><svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 12 4 4 10-10" /></svg></button><span v-if="controlToastKey === `review-icon-1:${row.change.id}`" :key="`review-icon-1:${row.change.id}`" class="officer-copy-toast" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 12 4 4 10-10" /></svg><span>{{ t('conservationPages.reviews.copiedToast') }}</span></span></span></div><small v-if="row.change.plant_id == null">{{ t('approvedChanges.speciesId') + ': ' + row.change.species_id }}</small></td>
            <td class="plant-id-cell">{{ row.change.plant_id != null ? formatPlantId(row.change.plant_id) || row.change.plant_id : '\u2014' }}</td>
            <td class="submission-type-cell"><div class="species-request-list"><span class="species-request-badge edit-type-badge" :class="row.kind === 'approved_plant_change' ? 'plant-edit' : 'species-edit'">{{ typeLabel(row.kind) }}</span></div></td>
            <td><em>{{ row.change.proposed_snapshot.scientific_name || rt('notRecorded') }}</em></td>
            <td class="identity-cell"><div class="identifier-line"><span :title="row.change.owner_subject">{{ submitterLabel(row.change.owner_subject) }}</span><span class="submitter-copy-anchor"><button type="button" class="identifier-copy" :disabled="!officerSessionReady || submitterPending[row.key]" :aria-label="t('conservationPages.observations.copySubject', { id: submitterLabel(row.change.owner_subject) })" @click="copySubmitter(row)" :data-submitter-copy="row.key"><svg v-if="!submitterCopied[row.key]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></svg><svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 12 4 4 10-10" /></svg></button><span v-if="copiedToastRow === row.key" class="submitter-copy-toast" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 12 4 4 10-10" /></svg><span>{{ rt('copiedToast') }}</span></span></span></div></td>
            <td class="reviewer-cell">{{ changeReviewerName(row.change) }}</td>
            <td>{{ changeZone(row.change) || rt('notRecorded') }}</td>
            <td>{{ formatDate(row.change.created_at) }}</td>
            <td class="status-cell"><span class="review-status-group"><span class="badge" :style="workflowBadgeStyle(row.change.status)" :class="row.change.status.toLowerCase().replaceAll(' ', '-')">{{ row.change.status === 'Cancelled' ? t('approvedChanges.cancelled') : ct(row.change.status) }}</span></span></td>
            <td class="proximity-cell">—</td>
            <td class="actions-cell"><div class="action-group"><button class="action-button" :disabled="reviewBusy || !officerSessionReady" :aria-label="t('approvedChanges.reviewProposal', { id: proposalLabel(row.change.id) })" @click="openChange(row.change)">{{ ct('Review') }}</button></div></td>
          </template>
          </tr>
          <tr v-if="isLoading || loadError || !reviewRows.length">
            <td colspan="11">
              {{
                isLoading
                  ? rt('queueRefresh.loading')
                  : loadError || rt(queueOrigin === 'unknown' ? 'queues.noRecords' : 'queues.noRegistrations')
              }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <button v-if="loadError || queueUnverified || (!queueReady && !isLoading)" class="action-button queue-retry" :disabled="!officerSessionReady || isLoading || queueRefreshing" @click="loadObservations()">{{ t('finalOfficerWorkflow.retry') }}</button>
    <button v-else-if="allReviewRows.length > visibleLimit" class="action-button" :disabled="isLoading || !officerSessionReady" @click="loadObservations(true)">{{ rt('queues.loadMore') }}</button>
  </section>

  <PlantProximityPanel ref="proximityDrawer" :observation-id="proximitySelection?.id" :revision="proximitySelection?.revision" :value="selectedProximityEntry?.result" :loading="selectedProximityEntry?.state === 'idle' || selectedProximityEntry?.state === 'loading'" :failed="selectedProximityEntry?.state === 'failed'" :context="proximitySelection ? observationLabel(proximitySelection.id) : ''" @retry="proximitySelection && proximityQueue.retry(proximitySelection)" />
  <RegistrationObservationEdits />
  <AppModal
    v-if="selected || standaloneRequest"
    :suspended="historicalSelectionActive"
    :title="standaloneRequest ? rt('speciesRequest.title') : ct('Review {id}', { id: observationLabel(selected!.id) })"
    :subtitle="
      standaloneRequest ? standaloneRequest.scientificName : ct('{id} · submitted by {name}', { id: selected!.plantId, name: submitterLabel(selected!.recordedBy) })
    "
    wide
    @close="closeReview"
  >
    <template v-if="selected" #title>
      <span class="submission-modal-title">
        <span>{{ ct('Review {id}', { id: observationLabel(selected.id) }) }}</span>
        <span class="submission-refresh-control">
        <button class="submission-refresh-button" type="button" :aria-label="t('submissionChanges.reload')" aria-describedby="submission-refresh-tooltip" :disabled="reviewBusy || selectionLoading || !!selectionError" :aria-busy="isSaving" @click="reloadSelected">
          <svg class="lucide lucide-refresh-cw" :class="{ 'species-refresh-spinning': isSaving }" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15.5-6.4L21 8 M21 3v5h-5 M21 12a9 9 0 0 1-15.5 6.4L3 16 M8 16H3v5" /></svg>
        </button>
        <span id="submission-refresh-tooltip" class="submission-refresh-tooltip" role="tooltip">{{ t('submissionChanges.reload') }}</span>
        </span>
      </span>
    </template>
    <template v-if="selected">
    <dl v-if="copyFailed" class="detail-list">
      <div><dt>{{ ct('Observation ID') }}</dt><dd class="full-identifier">{{ selected.id }}</dd></div>
    </dl>
    <p v-if="selected.reviewOrigin === 'species_dependency'" class="review-feedback error" role="status">{{ t('submissionChanges.automaticRejection') }}</p>
    <p v-if="selected.status === 'Rejected'" class="review-feedback error" role="status">{{ t('submissionChanges.finalRejected') }}</p>
    <SubmissionChanges v-if="selected.status === 'Pending Review'" :update="selected.submissionUpdate" :revision="selected.revision" :initial-submission="selected.origin === 'initial_registration' && selected.revision === 1" :busy="reviewBusy || selectionLoading" hide-reload @reload="reloadSelected" />
    <div v-if="!conflictAcknowledged || needsReload" class="review-feedback error" role="alert"><p>{{ t(!conflictAcknowledged ? 'submissionChanges.conflict' : 'submissionChanges.reloadRequired') }}</p></div>
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
          <p v-if="!standaloneRequest && !speciesResolved" class="section-kicker species-prerequisite"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 4c0 9-4 15-10 15a6 6 0 0 1-6-6C4 7 11 4 20 4Z M4 21 15 10" /></svg>{{ rt('speciesRequest.requiredFirst') }}</p>
          <h3 id="species-request-heading">{{ rt('speciesRequest.title') }}</h3>
        </div>
        <div class="species-header-controls">
          <span class="species-request-badge" :style="workflowBadgeStyle(speciesRequestState === 'pending' ? 'Pending Review' : speciesRequestState === 'approved' ? 'Approved' : speciesRequestState === 'rejected' ? 'Rejected' : speciesRequestState === 'correction' ? 'Correction Required' : speciesRequestState === 'withdrawn' ? 'Withdrawn' : '')">{{ rt(`speciesRequest.states.${!standaloneRequest && speciesRequestState === 'approved' ? 'verified' : speciesRequestState}`) }}</span>
          <span v-if="selectedSpeciesRequest.updated" class="badge species-updated-badge">{{ rt('speciesRequest.updated') }}</span>
          <button class="species-refresh-button" type="button" aria-label="Refresh submission and species resolution" aria-describedby="species-refresh-help" :disabled="reviewBusy || speciesRefreshing" :aria-busy="speciesRefreshing" @click="refreshSpeciesRequest" @mouseenter="showSpeciesRefreshHelp" @mouseleave="hideSpeciesRefreshHelp" @focus="showSpeciesRefreshHelp" @blur="hideSpeciesRefreshHelp" @pointerdown="showSpeciesRefreshHelp" @keydown.esc.stop.prevent="hideSpeciesRefreshHelp"><svg class="lucide lucide-refresh-cw" :class="{ 'species-refresh-spinning': speciesRefreshing }" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15.5-6.4L21 8 M21 3v5h-5 M21 12a9 9 0 0 1-15.5 6.4L3 16 M8 16H3v5" /></svg></button>
          <div id="species-refresh-help" ref="speciesRefreshHelp" popover="auto" role="tooltip" class="species-refresh-help">Refresh submission and species resolution</div>
        </div>
      </header>
      <p v-if="standaloneRequest || speciesRequestState !== 'pending'" :class="{ 'review-feedback error': ['error', 'unknown', 'unavailable'].includes(speciesRequestState) }" :role="['error', 'unknown', 'unavailable'].includes(speciesRequestState) ? 'alert' : 'status'" id="species-request-notice">
        {{ standaloneRequest ? rt(`speciesRequest.states.${speciesRequestState}`) : speciesNotice }}
      </p>
      <div v-if="speciesVersionConflict" class="review-feedback error" role="alert">
        <strong>{{ speciesCycleConflict ? t('submissionChanges.cycleChanged') : rt('speciesRequest.submissionChanged') }}</strong>
        <p>{{ rt('speciesRequest.versionConflict') }}</p>
        <button type="button" class="secondary-button" :disabled="reviewBusy || speciesRefreshing" @click="refreshSpeciesRequest">{{ rt('speciesRequest.reloadLatest') }}</button>
      </div>
      <p v-if="speciesReloaded" role="status">{{ rt('speciesRequest.refreshed') }}</p>
      <label v-if="speciesInspectionRequired && !speciesVersionConflict"><input type="checkbox" :checked="false" @change="speciesInspectionRequired = !($event.target as HTMLInputElement).checked" /> {{ rt('speciesRequest.inspectLatest') }}</label>
      <p v-if="speciesLoadError" class="review-feedback error" role="alert">{{ speciesLoadError }}</p>
      <p v-if="speciesSaveError" class="review-feedback error" role="alert">{{ speciesSaveError }}</p>
      <div v-if="selectedSpeciesRequest.state === 'pending' && (selectedSpeciesRequest.contentRevision === null || selectedSpeciesRequest.reviewCycle === null) && !speciesLoadError" class="review-feedback error" role="alert">
        <strong>Species revision could not be verified.</strong>
        <p>Review is blocked because content or review-cycle metadata is missing. Reload the submission. If this persists, ask the database operator to verify migrations 016 and 017.</p>
        <button type="button" class="secondary-button" :disabled="reviewBusy || speciesRefreshing" @click="refreshSpeciesRequest">{{ rt('speciesRequest.reloadLatest') }}</button>
      </div>
      <p v-if="selectedSpeciesRequest.historicalState" class="review-feedback" role="status">{{ t(selectedSpeciesRequest.historicalState === 'unavailable' ? 'approvedChanges.historicalSpeciesUnavailable' : selectedSpeciesRequest.historicalState === 'available' ? 'approvedChanges.historicalAvailable' : 'approvedChanges.historicalPartial') }}</p>
      <p v-if="selectedSpeciesRequest.historicalPhotosUnavailable" role="status">{{ t('approvedChanges.historicalPhotosUnavailable') }}</p>
      <div class="species-panel-columns">
        <section class="species-panel-metadata" aria-labelledby="species-details-heading">
          <h4 id="species-details-heading" class="species-panel-heading"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 4c0 9-4 15-10 15a6 6 0 0 1-6-6C4 7 11 4 20 4Z M4 21 15 10" /></svg><span>SPECIES REQUEST DETAILS</span></h4>
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
          <dd><MonitoringIdentifier v-if="selectedSpeciesRequest.requestedBy" :value="selectedSpeciesRequest.requestedBy" :labels="speciesSubmitterLabels" copy-label="Copy full species submitter ID" :feedback-duration="3000" /><span v-else>{{ rt('unavailable') }}</span></dd>
        </div>
        <div>
          <dt>{{ ct('Submitted At') }}</dt>
          <dd>{{ reviewDateTime(selectedSpeciesRequest.submittedAt) }}</dd>
        </div>
        <div>
          <dt>{{ rt('speciesRequest.storedComment') }}</dt>
          <dd>{{ selectedSpeciesRequest.reviewComment || '—' }}</dd>
        </div>
        <div v-if="selectedSpeciesRequest.reviewedAt"><dt>{{ rt('reviewedAt') }}</dt><dd>{{ reviewDateTime(selectedSpeciesRequest.reviewedAt) }}</dd></div>
        <div v-if="selectedSpeciesRequest.reviewedBy"><dt>{{ t('approvedChanges.reviewedBy') }}</dt><dd><MonitoringIdentifier :value="selectedSpeciesRequest.reviewedBy" :labels="reviewerLabels" copy-label="Copy full staff ID" :feedback-duration="3000" /></dd>
        </div>
      </dl>
        </section>
        <section class="species-panel-images" aria-labelledby="species-images-heading">
          <h4 id="species-images-heading" class="species-panel-heading"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m21 16-6-6L3 21"/></svg><span>SPECIES IMAGES ({{ speciesRequestImages.length }})</span></h4>
          <div v-if="selectedSpeciesRequest.assets.length" class="species-thumbnail-grid">
            <article v-for="asset in selectedSpeciesRequest.assets" :key="asset.id" class="species-thumbnail-item">
              <button v-if="asset.contentType.startsWith('image/') && !failedAssets.has(asset.id)" type="button" class="species-thumbnail-button" :aria-label="rt('speciesRequest.imageAlt', { id: asset.id }) + ' - Enlarge photo'" @click="enlargeSpeciesPhoto(asset.id, $event)">
                <img :src="assetUrl(asset.id)" :alt="rt('speciesRequest.imageAlt', { id: asset.id })" loading="lazy" decoding="async" @error="imageFailed(asset.id)" />
                <svg class="species-zoom-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6 M10 7v6 M7 10h6"/></svg>
              </button>
              <span v-else class="species-photo-placeholder">{{ rt(asset.contentType.startsWith('image/') ? 'imageUnavailable' : 'attachment') }}</span>
            </article>
          </div>
          <p v-else>{{ rt('noAssets') }}</p>
        </section>
      </div>
      <PlantPhotoLightbox ref="speciesPhotoPreview" root-scroll-lock />
      <label class="form-field species-review-comment">
        <span class="species-panel-heading"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M21 11a8 8 0 0 1-8 8 9 9 0 0 1-4-1l-6 3 2-6a9 9 0 0 1-1-4 8.5 8.5 0 0 1 17 0Z"/></svg><span>{{ ct('Species Review Comment / Reason') }}</span></span>
        <textarea
          ref="speciesCommentField"
          v-model="speciesReviewComment"
          :disabled="!canReviewSpecies"
          maxlength="4000"
          :aria-invalid="speciesCommentError ? 'true' : undefined"
          :aria-describedby="speciesCommentError ? 'species-request-comment-error' : undefined"
        />
      </label>
      <p v-if="speciesCommentError" id="species-request-comment-error" class="review-feedback error review-comment-validation" role="alert"><svg class="review-comment-alert-icon lucide lucide-circle-alert" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10" /><path d="M12 8v4 M12 16h.01" /></svg><span>{{ speciesCommentError }}</span></p>
      <div v-if="canReviewSpecies" ref="speciesVisibilityField" class="species-visibility-validation" aria-live="polite" aria-atomic="true">
        <VisibilitySelector id="species-review-visibility" v-model="speciesVisibility" :disabled="speciesSaving" :invalid="Boolean(speciesVisibilityError)" :error="speciesVisibilityError" required />
      </div>
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
      </div>
    </section>
    <template v-if="selected">
    <section class="review-section">
      <div class="plant-observation-heading">
        <h3>{{ rt('speciesRequest.plantObservation') }}</h3>
        <div class="plant-observation-badges" role="status">
          <span class="badge submission-review-badge" :style="workflowBadgeStyle(selected.status)" :class="selected.status.toLowerCase().replaceAll(' ', '-')">{{ selected.status ? ct(selected.status) : rt('unavailable') }}</span>
          <span v-if="selected.historicalVersion" class="badge historical-version-badge">{{ t('observationVersions.historicalVersion') }}</span>
        </div>
      </div>
      <p v-if="selected.historicalState && selected.historicalState !== 'available'" class="review-feedback" role="status">{{ t(selected.historicalState === 'unavailable' ? 'approvedChanges.historicalUnavailable' : selected.historicalState === 'available' ? 'approvedChanges.historicalAvailable' : 'approvedChanges.historicalPartial') }}</p>
      <p v-if="selected.historicalPhotosUnavailable" role="status">{{ t('approvedChanges.historicalPhotosUnavailable') }}</p>
      <p class="section-kicker review-section-heading"><svg class="review-section-icon" data-section-icon="leaf" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 4c-9-1-16 2-16 9a7 7 0 0 0 7 7c7 0 10-7 9-16Z M4 20l10-10" /></svg><span>{{ ct('PLANT & SPECIES INFORMATION') }}</span></p>
      <div class="two-column review-observation-columns">
        <div class="review-observation-evidence">
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
              <dt>{{ t('submissionChanges.plantName') }}</dt><dd>{{ selected.plantScientificName || '—' }}</dd>
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


          <p class="section-kicker review-subsection-heading review-section-heading"><svg class="review-section-icon" data-section-icon="sprout" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 22v-9 M12 14C5 15 3 8 3 8s9-2 9 6Z M12 11c0-7 9-8 9-8s0 9-9 8Z" /></svg><span>{{ ct('OBSERVATION INFORMATION') }}</span></p>
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

          <p class="section-kicker review-subsection-heading review-section-heading"><svg class="review-section-icon" data-section-icon="pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></svg><span>{{ rt('submissionLocation') }}</span></p>
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

          <p class="section-kicker review-subsection-heading review-section-heading"><svg class="review-section-icon" data-section-icon="qr" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 3h6v6H3Z M15 3h6v6h-6Z M3 15h6v6H3Z M15 15h3v3h-3Z M21 14v4 M14 21h4 M21 21h.01" /></svg><span>{{ rt('currentPlantQr') }}</span></p>
          <p v-if="qrLoading" role="status">{{ rt('qrLoading') }}</p>
          <p v-else-if="qrError" role="alert">{{ qrError }}</p>
          <dl v-else-if="plantQr" class="detail-list">
            <div>
              <dt>{{ rt('qrIdentity') }}</dt>
              <dd>
                <div v-if="plantQr.identity" class="identifier-line qr-identifier">
                  <span :title="plantQr.identity">{{ qrLabel(plantQr.identity) }}</span>
                  <span class="officer-copy-anchor"><button type="button" class="identifier-copy" :disabled="!officerSessionReady || qrCopyPending" :aria-label="rt('copyQrIdentity')" :title="rt('copyQrIdentity')" @click="copyQrIdentity">
                    <svg v-if="!controlCopied[`qr:${selected.id}`]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></svg>
                    <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="m5 12 4 4 10-10" /></svg>
                  </button><span v-if="controlToastKey === `qr:${selected.id}`" :key="`qr:${selected.id}`" class="officer-copy-toast" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 12 4 4 10-10" /></svg><span>{{ t('conservationPages.reviews.copiedToast') }}</span></span></span>
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

          <p class="section-kicker review-subsection-heading review-section-heading"><svg class="review-section-icon" data-section-icon="image" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg><span>{{ ct('SUBMITTED IMAGES') }}</span></p>
          <p v-if="!selected.assets.length">{{ rt('noAssets') }}</p>
          <div v-else class="submission-image-grid">
            <article v-for="asset in selected.assets" :key="asset.id" class="submitted-image-item">
              <button v-if="asset.contentType.startsWith('image/') && !failedAssets.has(asset.id)"
                type="button" class="submitted-image-preview submitted-image-button"
                :aria-label="rt('imageAlt', { id: selected.displayId, asset: asset.id }) + ' - ' + ct('Enlarge photo')"
                @click="enlargeSubmissionPhoto(asset.id, $event)">
                <img
                  :src="assetUrl(asset.id)"
                  :alt="rt('imageAlt', { id: selected.displayId, asset: asset.id })"
                  loading="lazy"
                  @error="imageFailed(asset.id)"
                />
              </button>
              <div v-else class="submitted-image-preview"><span>{{
                  rt(asset.contentType.startsWith('image/') ? 'imageUnavailable' : 'attachment')
                }}</span>
              </div>
            </article>
          </div>

          <PlantPhotoLightbox ref="submissionPhotoPreview" root-scroll-lock />

          <p class="section-kicker review-subsection-heading review-section-heading"><svg class="review-section-icon" data-section-icon="file" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z M14 2v6h6 M8 13h8 M8 17h6" /></svg><span>{{ ct('SUBMISSION INFORMATION') }}</span></p>
          <dl class="detail-list submission-information">
            <div>
              <dt>{{ ct('Submitted By') }}</dt>
              <dd><MonitoringIdentifier :value="selected.recordedBy" :labels="submissionSubmitterLabels" copy-label="Copy full submitter ID" :feedback-duration="3000" /></dd>
            </div>
            <div>
              <dt>{{ rt('recordCreated') }}</dt>
              <dd>{{ reviewDateTime(selected.createdAt) }}</dd>
            </div>
            <div>
              <dt>{{ rt('lastUpdated') }}</dt>
              <dd>{{ reviewDateTime(selected.updatedAt) }}</dd>
            </div>
            <div>
              <dt>{{ rt('reviewedAt') }}</dt>
              <dd>{{ reviewDateTime(selected.reviewedAt) }}</dd>
            </div>
            <div>
              <dt>{{ t('approvedChanges.reviewedBy') }}</dt>
              <dd><MonitoringIdentifier v-if="selected.reviewedBy" :value="selected.reviewedBy" :labels="reviewerLabels" copy-label="Copy full staff ID" :feedback-duration="3000" /><span v-else>&#8212;</span></dd>
            </div>
            <div>
              <dt>{{ rt('reviewDecision') }}</dt>
              <dd><span class="badge submission-review-badge" :style="workflowBadgeStyle(selected.reviewDecision)" :class="selected.reviewDecision.toLowerCase().replaceAll(' ', '-')">{{ selected.reviewDecision ? ct(selected.reviewDecision) : '—' }}</span></dd>
            </div>

          </dl>
        </div>
        <aside class="review-decision-panel" tabindex="0" aria-labelledby="review-decision-heading">
          <p id="review-decision-heading" class="section-kicker review-section-heading"><svg class="review-section-icon" data-section-icon="clipboard" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="5" y="4" width="14" height="18" rx="2" /><rect x="9" y="2" width="6" height="4" rx="1" /><path d="m9 14 2 2 4-4" /></svg><span>{{ ct('REVIEW DECISION') }}</span></p>
          <ObservationVersionHistory :approved-source-snapshot-id="selected.approvedSourceSnapshotId" :displayed-snapshot-id="selected.displayedSnapshotId" :observation-id="selected.id" :plant-id="String(Number(selected.plantId.slice(2)))" :origin="selected.origin" :enabled="officerSessionReady && !reviewBusy" :context="String(reviewSession.user?.id) + String(route.fullPath || JSON.stringify(route.query))" @active="historicalSelectionActive = $event" />
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
              <span class="history-date">{{ reviewDateTime(observation.createdAt) }}</span>
              <div class="history-details">
                <span v-if="observation.health" class="history-health">{{ ct('Health Status') }}: {{ ct(observation.health) }}</span>
                <span v-if="observation.height">{{ ct('Height') }}: {{ observation.height }}</span>
              </div>
            </div>
          </template>
          <label class="form-field officer-comment"
            ><span class="review-section-heading"><svg class="review-section-icon" data-section-icon="comment" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8Z" /></svg><span>{{ ct('Observation Review Comment') }}</span></span
            ><textarea
              v-model="comment"
              :disabled="reviewBusy || selectionLoading"
              :placeholder="ct('Record the observation decision or required action')"
            ></textarea>
          </label>
          <p
            v-if="reviewMessage"
            :role="reviewMessage.variant === 'error' ? 'alert' : 'status'"
            class="review-feedback"
            :class="[reviewMessage.variant, { 'review-comment-validation': reviewMessage.variant === 'error' && reviewMessage.message === rt('feedback.commentRequired') }]"
          >
            <svg v-if="reviewMessage.variant === 'error' && reviewMessage.message === rt('feedback.commentRequired')" class="review-comment-alert-icon lucide lucide-circle-alert" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10" /><path d="M12 8v4 M12 16h.01" /></svg><span>{{ reviewMessage.message }}</span>
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
        </aside>
      </div>
    </section>

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
      <svg class="species-gate-info-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v6" /><circle cx="12" cy="8" r="1" fill="currentColor" stroke="none" /></svg>
      <span>{{ rt('speciesRequest.resolveFirst') }}</span>
    </p>
    <div
      v-if="!historicalSelectionActive"
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

</template>

<style scoped>
.registration-title-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.registration-title-row h2 { margin: 0; }
.queue-help-button { display: inline-grid; place-items: center; flex: none; width: 22px; min-height: 22px; padding: 0; border: 1px solid #a8b5ac; border-radius: 50%; background: transparent; color: #52685b; font: inherit; font-size: 12px; cursor: help; }
.queue-help-button:focus-visible { outline: 3px solid #5b9375; outline-offset: 3px; }
.queue-help-popover { position: fixed; inset: auto; margin: 0; width: min(420px, calc(100vw - 24px)); box-sizing: border-box; max-height: calc(100dvh - 24px); overflow: auto; padding: 10px; border: 1px solid #a8b9ac; border-radius: 18px; background: #fff; color: #17251b; font-size: 14px; line-height: 1.5; box-shadow: 0 8px 28px #102d2526; }
.queue-help-heading { display: flex; gap: 12px; align-items: center; padding: 12px 14px; border-radius: 12px; background: #eaf6e5; font-size: 20px; color: #14271a; }
.queue-help-heading svg { width: 29px; height: 29px; flex: none; fill: none; stroke: #276d28; stroke-width: 2; }
.queue-help-section { display: grid; grid-template-columns: 48px minmax(0,1fr); gap: 16px; margin: 0 12px; padding: 22px 0; }
.queue-help-section + .queue-help-section { border-top: 1px solid #dce5dc; }
.queue-help-icon { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 11px; background: #eaf6e5; }
.queue-help-icon svg { width: 30px; height: 30px; fill: none; stroke: #206423; stroke-width: 2; stroke-linejoin: round; }
.queue-help-section h3 { margin: 0 0 7px; font-size: 17px; line-height: 1.35; font-weight: 700; color: #17251b; }
.queue-help-section p { margin: 0; color: #28342b; font-size: 14px; line-height: 1.5; }
.plant-observation-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px 16px; margin-bottom: 12px; }
.plant-observation-heading h3 { margin: 0; min-width: 0; }
.plant-observation-badges { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.plant-observation-badges .historical-version-badge, .reviews-table .historical-version-badge { background: #e5e7eb; color: #374151; font-size: 12px; font-weight: 700; }

.terminal-read-only > td { background-color: #F3F4F6; color: #374151; }
/* Non-interactive and deliberately below the Officer modal layer (300).
   No animation or transition: reduced-motion users receive the same feedback. */
.submitter-copy-status { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.submitter-copy-anchor { position: relative; display: inline-flex; flex: none; }
.submitter-copy-toast { position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%); z-index: 200; pointer-events: none; white-space: nowrap; display: flex; align-items: center; gap: 8px; max-width: calc(100vw - 48px); padding: 10px 16px; border-radius: 8px; background: #DCF3E4; color: #245A46; box-shadow: 0 4px 14px #173f3426; font-size: 14px; font-weight: 500; line-height: 1.4; }
.submitter-copy-toast svg { width: 16px; height: 16px; flex: none; }

.officer-layout.officer-layout .review-section .review-section-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #eaf3e9;
  color: var(--forest, #173f34);
  font-size: var(--officer-label, .8125rem);
  font-weight: 800;
  line-height: 1.5;
  letter-spacing: .04em;
}
.review-section-heading .review-section-icon { flex: 0 0 20px; width: 20px; height: 20px; color: var(--green, #33745d); }
.review-section-heading > span { min-width: 0; overflow-wrap: anywhere; color: inherit; font: inherit; letter-spacing: inherit; }
.review-observation-columns { align-items: start; }
.review-observation-evidence, .review-decision-panel { min-width: 0; }
.review-decision-panel { align-self: start; overflow-wrap: anywhere; }
.review-decision-panel:focus-visible { outline: 2px solid #33745d; outline-offset: 2px; }
@media (min-width: 921px) {
  .review-decision-panel {
    position: sticky;
    top: 16px;
    /* Modal viewport minus outer margins (40px), padding (48px), and sticky inset (16px). */
    max-height: calc(100vh - 104px);
    max-height: calc(100dvh - 104px);
    overflow: auto;
    scrollbar-gutter: stable;
  }
}
.review-status-group { display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
.reviews-table .status-cell .review-status-group .resubmission-tag { background: #FFF1DB; color: #926119; font-size: 12px; padding: 3px 8px; flex-shrink: 0; }

.reviews-intro h2 { font-size: 28px; line-height: 1.2; }
.reviews-intro p { font-size: 14px; line-height: 1.55; }
.reviews-intro .page-kicker { font-size: 12px; line-height: 1.4; }
.reviews-panel > .action-button { font-size: 13px; }

.reviews-filters { align-items: stretch; }
.clear-review-filters { display: flex; align-items: center; gap: 5px; width: fit-content; margin: 0 0 18px; padding: 4px 12px; border: 1px solid #d5d9d6; border-radius: 999px; background: #fff; color: #5b635e; font-size: 12px; font-weight: 500; line-height: 1.4; }
.clear-review-filters svg { flex: 0 0 15px; }
.clear-review-filters:hover { background: #f3f6f3; border-color: #aebbb3; }
.clear-review-filters:focus-visible { outline: 2px solid var(--green, #33745d); outline-offset: 3px; }
.reviews-filters > .field { grid-template-rows: 1fr 44px; }
.reviews-filters > .field > span { align-self: end; font-size: 12px; line-height: 1.4; }
.reviews-filters > .field > input, .reviews-filters > .field > select { box-sizing: border-box; height: 44px; padding: 9px 10px; font-size: 14px; line-height: 1.4; }
.review-summary-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.review-summary-card { min-width: 0; padding: 18px; border: 1px solid currentColor; border-radius: 14px; background: var(--review-summary-background); color: var(--review-summary-ink); box-shadow: none; }
.review-summary-title { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
.review-summary-title p { margin: 0; color: inherit; font-size: 14px; line-height: 1.5; }
.review-summary-title svg { flex: 0 0 20px; width: 20px; height: 20px; }
.review-summary-card strong { color: inherit; font-size: 30px; line-height: 1.2; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.review-summary-pending-review { --review-summary-background: #FEF9C3; --review-summary-ink: #854D0E; }
.review-summary-correction-required { --review-summary-background: #fff1db; --review-summary-ink: #926119; }
.review-summary-flagged { --review-summary-background: #f0eaf8; --review-summary-ink: #69459a; }
.review-summary-rejected { --review-summary-background: #fbe8e5; --review-summary-ink: #a33f35; }
.review-summary-approved-today { --review-summary-background: #e7f3e9; --review-summary-ink: #287347; }
@media (max-width: 1280px) { .review-summary-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 900px) { .review-summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 480px) { .review-summary-grid { grid-template-columns: minmax(0, 1fr); } }
.reviews-scroll { min-width: 0; max-width: 100%; overflow-x: auto; overscroll-behavior-inline: contain; }
.reviews-scroll:focus-visible { outline: 3px solid #315b49; outline-offset: -3px; }
.reviews-table { width: 100%; min-width: 135rem; table-layout: fixed; white-space: normal; border-collapse: separate; border-spacing: 0; }
.reviews-table .observation-column { width: 12rem; }
.reviews-table .submitter-column, .reviews-table .reviewer-column { width: 13rem; }
.reviews-table .plant-column { width: 6rem; }
.reviews-table .type-column { width: 11rem; }
.reviews-table .species-column { width: 13rem; }
.reviews-table .zone-column { width: 8rem; }
.reviews-table .status-column { width: 12rem; }
.reviews-table .proximity-column { width: 15rem; }
.reviews-table .actions-column { width: 16rem; }
.reviews-table .created-column { width: 12rem; }
.reviews-table th, .reviews-table td { padding: 12px 14px; text-align: left; vertical-align: middle; white-space: normal; overflow-wrap: anywhere; }
.reviews-table th { background: #245443; color: #fff; border-bottom-color: #245443; font-size: 12px; font-weight: 700; line-height: 1.4; }
.reviews-table thead th:first-child { border-top-left-radius: 10px; }
.reviews-table thead th:last-child { border-top-right-radius: 10px; }
.reviews-table td { font-size: 14px; line-height: 1.5; }
.reviews-table .plant-id-cell { color: #315749; font-weight: 700; }
.reviews-table .identity-cell strong { color: inherit; font-weight: 700; }
.reviews-table .edit-identity strong { color: #315749; font-weight: 700; }
.reviews-table .edit-identity small { display: block; color: #60776c; margin-top: 3px; }
.reviews-table .species-request-badge.plant-edit { background: #e5f2f7; color: #22546b; border-color: #aacbd8; }
.reviews-table .species-request-badge.species-edit { background: #f0eaf7; color: #654580; border-color: #ccb9dc; }
.reviews-table .status-cell, .reviews-table .actions-cell { white-space: nowrap; }
.submission-review-badge, .reviews-table .badge { display: inline-flex; align-items: center; width: max-content; max-width: none; box-sizing: border-box; white-space: nowrap; overflow-wrap: normal; font-size: 12px; line-height: 1.4; vertical-align: middle; }
.reviews-table .review-status-group.has-historical-version { flex-direction: column; align-items: flex-start; gap: 4px; max-width: 100%; white-space: normal; }
.reviews-table .review-status-group.has-historical-version .badge { max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
/* Auto-layout lets nonwrapping status/action content set its own minimum column width. */
.reviews-scroll .reviews-table .action-group { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-start; gap: 7px; width: 100%; min-width: 0; }
.reviews-table .action-group > .action-button { flex: 0 1 auto; width: auto; min-width: 0; max-width: 100%; height: auto; min-height: 32px; white-space: normal; overflow-wrap: anywhere; font-size: 13px; }
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


.two-column > div { min-width: 0; }
.detail-list dd { min-width: 0; overflow-wrap: anywhere; }
.submission-information dd { line-height: 24px; }
.submission-information :deep(.monitoring-identifier) { position: relative; vertical-align: top; }
.detail-list.submission-information :deep(.monitoring-identifier .monitoring-id-copy) { flex-basis: 28px; width: 28px; height: 24px; }
.submission-information :deep(.monitoring-copy-feedback) { position: absolute; top: 100%; left: 0; font-size: 11px; line-height: 14px; }
.submission-information :deep(.monitoring-identifier:has(.monitoring-full-id) .monitoring-copy-feedback) { position: static; }
.species-request-card {
  margin-bottom: 24px;
  padding: 18px;
  border: 1px solid #aac8b6;
  border-left: 4px solid #39785a;
  border-radius: 12px;
  background: #f5faf5;
  color: #294c3c;
}
.species-updated-badge { background: #fff1db; color: #926119; font-size: 12px; }
.species-request-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.species-request-header h3 {
  margin: 5px 0 10px;
}
.species-request-card .species-prerequisite { display: flex; align-items: center; gap: 8px; }
.species-request-card .species-prerequisite svg { flex: 0 0 18px; color: var(--green, #33745d); }
.species-request-card .species-header-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.species-request-card .species-header-controls .species-request-badge { border: 0; border-radius: 999px; font-size: 12px; }
.species-request-card .species-refresh-button { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 36px; width: 36px; height: 36px; padding: 0; border: 1px solid var(--line, #dfe7df); border-radius: 8px; background: #fff; color: var(--green, #33745d); cursor: pointer; }
.species-request-card .species-refresh-button:focus-visible, .species-request-card .species-thumbnail-button:focus-visible { outline: 2px solid var(--green, #33745d); outline-offset: 3px; }
.species-refresh-help { position: fixed; inset: auto; margin: 0; max-width: min(280px, calc(100vw - 16px)); box-sizing: border-box; padding: 9px 12px; border: 1px solid var(--line, #dfe7df); border-radius: 8px; background: var(--forest, #173f34); color: #fff; font: 400 12px/1.5 Poppins, sans-serif; }
.species-request-card .species-panel-columns { display: grid; grid-template-columns: minmax(0, 2fr) minmax(170px, 1fr); gap: 24px; margin-top: 18px; }
.species-request-card .species-panel-metadata, .species-request-card .species-panel-images { min-width: 0; }
.species-request-card .species-panel-heading { display: flex; align-items: center; gap: 8px; min-height: 40px; margin: 0 0 12px; padding: 8px 12px; border-radius: 8px; background: #eaf3e9; color: var(--forest, #173f34); font-size: 13px; font-weight: 800; line-height: 1.5; text-transform: uppercase; }
.species-request-card .species-panel-heading svg { flex: 0 0 18px; color: var(--green, #33745d); }
.species-request-card .species-thumbnail-grid { display: flex; flex-wrap: wrap; gap: 10px; }
.species-request-card .species-thumbnail-item { width: 128px; max-width: 100%; }
.species-request-card .species-thumbnail-button, .species-request-card .species-photo-placeholder { position: relative; display: grid; place-items: center; box-sizing: border-box; width: 128px; max-width: 100%; aspect-ratio: 1; padding: 0; overflow: hidden; border: 1px solid var(--line, #dfe7df); border-radius: 10px; background: var(--wash, #f3f6f2); color: #5b7065; }
.species-request-card .species-thumbnail-button { cursor: zoom-in; }
.species-request-card .species-thumbnail-button img { width: 100%; height: 100%; object-fit: cover; }
.species-request-card .species-photo-placeholder { padding: 10px; font-size: 12px; text-align: center; }
.species-request-card .species-zoom-icon { position: absolute; bottom: 5px; right: 5px; padding: 3px; border-radius: 4px; background: #fff; color: var(--green, #33745d); }
.species-request-card .species-request-details { margin: 0; }
.species-request-card .species-request-details dt { color: #5b7065; }
.species-request-card .species-review-comment { margin-top: 18px; }
.species-request-card .species-review-comment textarea { min-height: 82px; }
.species-request-card textarea[aria-invalid="true"] { border-color: #b91c1c; box-shadow: 0 0 0 1px #b91c1c; }
.species-visibility-validation :deep(.visibility-selector[aria-invalid="true"]) { padding: 12px; border: 1px solid #b91c1c; border-radius: 10px; background: #fff7f7; }
.species-visibility-validation :deep(.visibility-error) { display: flex; align-items: flex-start; gap: 8px; margin-top: 12px; padding: 12px; border-radius: 8px; background: #fff0ef; color: #a32222; font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
.species-visibility-validation :deep(.visibility-error)::before { content: '!'; display: inline-grid; place-items: center; flex: 0 0 18px; height: 18px; border: 1px solid currentColor; border-radius: 50%; font-weight: 700; }
.species-request-card .species-request-actions { justify-content: flex-end; margin-top: 14px; }
.species-refresh-spinning { animation: species-refresh-spin 1s linear infinite; }
@keyframes species-refresh-spin { to { transform: rotate(360deg); } }
@media (max-width: 800px) { .species-request-card .species-panel-columns { grid-template-columns: minmax(0, 1fr); gap: 18px; } }
@media (prefers-reduced-motion: reduce) { .species-refresh-spinning { animation: none; } }
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
.species-gate-notice {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 14px 0;
  color: var(--muted, #61736b);
  font-size: 13px;
  line-height: 1.6;
}
.species-gate-info-icon { flex: 0 0 18px; margin-top: 2px; }
.submission-modal-title { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.submission-modal-title > span { min-width: 0; overflow-wrap: anywhere; }
.submission-refresh-control { position: relative; display: inline-flex; }
.submission-refresh-tooltip { position: absolute; top: calc(100% + 6px); left: 0; z-index: 2; width: max-content; max-width: min(240px, calc(100vw - 64px)); padding: 7px 10px; border-radius: 6px; background: var(--forest, #173f34); color: #fff; font-size: 12px; font-weight: 400; line-height: 1.5; opacity: 0; visibility: hidden; pointer-events: none; }
.submission-refresh-control:hover .submission-refresh-tooltip, .submission-refresh-control:focus-within .submission-refresh-tooltip { opacity: 1; visibility: visible; }
.submission-refresh-button { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 36px; width: 36px; height: 36px; padding: 0; border: 1px solid var(--line, #dfe7df); border-radius: 8px; background: #fff; color: var(--green, #33745d); cursor: pointer; }
.submission-refresh-button:focus-visible { outline: 2px solid var(--green, #33745d); outline-offset: 3px; }
.submission-refresh-button:disabled { opacity: .55; cursor: default; }
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
.review-feedback.info {
  color: #315b49;
  background: #f0f7f1;
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
.submitted-image-button { cursor: zoom-in; }
.submitted-image-button:focus-visible { outline: 2px solid var(--green, #33745d); outline-offset: 3px; }
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
.review-comment-validation { display: flex; align-items: flex-start; gap: 8px; }
.review-comment-alert-icon { display: block; flex: 0 0 18px; width: 18px; height: 18px; margin-top: 2px; color: inherit; }
.review-comment-validation > span { min-width: 0; }
.form-error {
  color: #b84d42;
  font-size: 10px;
}
.review-section > .section-kicker {
  margin-bottom: 14px;
}
@media (max-width: 620px) {
  .submission-image-grid {
    grid-template-columns: 1fr;
  }
}
</style>
