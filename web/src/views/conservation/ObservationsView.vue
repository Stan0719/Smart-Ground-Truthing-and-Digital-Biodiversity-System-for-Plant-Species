<script setup lang="ts">
import '../../styles/officer-copy.css'
import { useOfficerCopyConfirmation } from '../../composables/useOfficerCopyConfirmation'
const copyConfirmation = useOfficerCopyConfirmation({ schedule: (fn, ms) => window.setTimeout(fn, ms), cancel: id => window.clearTimeout(id as number) })
const controlCopied = copyConfirmation.copied, controlToastKey = copyConfirmation.toastKey

import { vOfficerDropdown } from '../../components/conservation/officerDropdown'
import { workflowBadgeStyle } from '../../utils/workflowBadge'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Directive } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { currentUser, sessionSnapshot, subscribeSession } from '../../services/auth'
import { ReviewApiError, createReviewRequest, performObservationReview, observationReviewSnapshot, reviewCommentValid, positiveRevision, reviewEligible, reviewTransitions, type ReviewDecision } from '../../services/observationReview'
import { mapLinkedSpeciesRequest, type LinkedSpeciesRequest } from '../../services/reviewSpeciesRequest'
import type { ObservationEdit, ObservationEditQueueState } from '../../services/observationEdits'
import MonitoringIdentifier from '../../components/conservation/MonitoringIdentifier.vue'
import ObservationEditQueue from '../../components/conservation/ObservationEditQueue.vue'
import AppModal from '../../components/conservation/AppModal.vue'
import ReviewCommentField from '../../components/conservation/ReviewCommentField.vue'
import PlantPhotoLightbox from '../../components/PlantPhotoLightbox.vue'
import ActionFeedback from '../../components/ActionFeedback.vue'
import ObservationReviewHistory from '../../components/conservation/ObservationReviewHistory.vue'
import { formatPlantId } from '../../utils/plantId'
import { observationOrigin, observationQueueUrl, readQueuePage, type ObservationOrigin, type ObservationQueue } from '../../services/observationQueue'
import { trackDatabaseTranslationFields } from '../../services/databaseTranslation'

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
const proposalQueue = ref<InstanceType<typeof ObservationEditQueue> | null>(null)
const proposalState = ref<ObservationEditQueueState>({ rows: [], names: {}, loading: true, error: '' })
const submissionType = ref<'all' | 'original' | 'edit'>('all')
function receiveProposalState(value: ObservationEditQueueState) {
  proposalState.value = authorizedOfficer.value ? value : { rows: [], names: {}, loading: false, error: '' }
}
function openProposal(row: ObservationEdit) {
  if (!authorizedOfficer.value || reviewSaving.value) return
  closeModal(true)
  proposalQueue.value?.view(row)
}

const queueOrigin = ref<ObservationQueue>('subsequent_observation')
const hasMore = ref(false)
const nextCursor = ref<string | null>(null)
let listRequest = 0
let listAbort: AbortController | null = null
const seenCursors = new Set<string>()
// Inclusive of the first request: at most 5 sequential 100-row scans per action.
// Stop on new queue matches, not on local search/species/owner/date matches.
const AUTO_SCAN_PAGE_LIMIT = 5
const AUTO_REFRESH_PAGE_LIMIT = 20
const AUTO_REFRESH_INTERVAL = 60_000
let loadedPageDepth = 0
let refreshTimer: number | undefined
let lastListRefreshAt = 0
const autoScanLimited = ref(false)
const scannedPages = ref(0)
const isLoading = ref(true)
const isRefreshing = ref(false)
const automaticRefreshError = ref('')
const automaticRefreshDeferred = ref(false)
const loadError = ref('')
const skippedRecords = ref(0)
const summaryRows = ref<ObservationView[]>([])
const summaryComplete = ref(false), summaryLoading = ref(false)
const summaryError = ref<'unavailable' | 'incomplete' | ''>('')
let summaryRequest = 0
let summaryAbort: AbortController | null = null
const SUMMARY_PAGE_LIMIT = 20
function invalidateSummary() {
  summaryRequest++; summaryAbort?.abort(); summaryAbort = null
  summaryComplete.value = false; summaryLoading.value = false; summaryError.value = ''; summaryRows.value = []
}
const selected = ref<ObservationView | null>(null)
const statusHelpOpen = ref(false)
const statusHelpButton = ref<HTMLElement | null>(null), statusHelpTooltip = ref<HTMLElement | null>(null)
let statusHelpTimer: number | undefined
function closeStatusHelp() { window.clearTimeout(statusHelpTimer); statusHelpOpen.value = false }
function showStatusHelp() { window.clearTimeout(statusHelpTimer); statusHelpOpen.value = true }
function deferCloseStatusHelp() { window.clearTimeout(statusHelpTimer); statusHelpTimer = window.setTimeout(closeStatusHelp, 150) }

const observationPhotoPreview = ref<InstanceType<typeof PlantPhotoLightbox> | null>(null)
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
const modalDate = (value: string) => formatDate(value)
const modalHeaders = new WeakMap<HTMLElement, { observer: ResizeObserver; observationId: string; measure: () => void }>()
const vObservationDialog: Directive<HTMLElement, string> = {
  mounted(root, binding) {
    const header = root.querySelector<HTMLElement>('.modal-header')
    const card = root.querySelector<HTMLElement>('.modal-card')
    if (!header || !card) return
    const measure = () => {
      card.style.setProperty('--observation-header-height', `${header.offsetHeight}px`)
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
const successNotice = ref(false), successSequence = ref(0)
const reviewInfo = ref(false)
const reviewFeedbackVariant = computed(() => reviewInfo.value ? 'info' : reviewSuccess.value ? 'success' : 'error')
const reviewCommentInput = ref<{ focus: () => void } | null>(null)
const reviewCommentError = computed(() => !reviewSuccess.value && reviewFeedback.value === rt('feedback.commentRequired'))
const rt = (key: string, params?: Record<string, string | number>) => t('conservationPages.reviews.' + key, params || {})
const reviewRequest = createReviewRequest(rt, (...args) => fetch(...args))
let detailRequest = 0
let disposed = false
const session = ref(sessionSnapshot())
const authorizedOfficer = computed(() => !session.value.pending && session.value.user?.role === 'Conservation Officer' && session.value.user.status === 'Active' && session.value.user.mustChangePassword === false)
const unsubscribeSession = subscribeSession((user, pending) => {
  const previousId = session.value.user?.id
  session.value = { user, pending }
  if (previousId !== user?.id) lastListRefreshAt = 0
  if (pending || !authorizedOfficer.value) stopAutomaticRefresh()
  else startAutomaticRefresh()
  if (pending && user && previousId === user.id) {
    if (reviewSaving.value || detailLoading.value) reviewNeedsReload.value = true
    detailRequest++; detailLoading.value = false
    return
  }
  if (!authorizedOfficer.value || previousId !== user?.id) {
    clearCopyState(); closeModal(true); invalidateList(); observations.value = []; proposalState.value = { rows: [], names: {}, loading: false, error: '' }
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

const canonicalStatuses = ['Draft', 'Pending Review', 'Approved', 'Rejected', 'Correction Required', 'Flagged', 'Withdrawn']
const supportedStatuses = [...canonicalStatuses, 'Cancelled', 'Superseded']
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
const summaryHasFilters = computed(() => !!(search.value.trim() || status.value || species.value || owner.value || date.value || submissionType.value !== 'all'))
const summaryBusy = computed(() => (submissionType.value !== 'edit' && (isLoading.value || isRefreshing.value || summaryLoading.value)) || (submissionType.value !== 'original' && proposalState.value.loading))
const summaryUnavailable = computed(() => !authorizedOfficer.value || (submissionType.value !== 'edit' && (!!loadError.value || !!automaticRefreshError.value || summaryError.value === 'unavailable')) || (submissionType.value !== 'original' && !!proposalState.value.error))
const summaryIncomplete = computed(() => submissionType.value !== 'edit' && (!summaryComplete.value || summaryError.value === 'incomplete'))
const summaryCounts = computed(() => {
  const available = !summaryBusy.value && !summaryUnavailable.value && !summaryIncomplete.value
  // Count submissions, not parent Observations: an edit uses its own ID/status.
  // Separate typed identities retain a genuine Observation and its edit request.
  const matches = new Map<string, string>()
  if (submissionType.value !== 'edit') {
    const originals = [...new Map([...summaryRows.value, ...observations.value].map(item => [item.id, item])).values()].filter(matchesObservation)
    for (const row of originals) matches.set(`observation:${row.id}`, row.status)
  }
  if (submissionType.value !== 'original') {
    for (const row of proposalItems.value.filter(matchesProposal)) matches.set(`observation-edit:${row.proposal.id}`, row.proposal.status)
  }
  return summaryStatuses.map(status => ({ status, count: available ? [...matches.values()].filter(value => canonicalStatus(value) === status).length : null }))
})
const summaryScope = computed(() => t('unifiedObservations.' + (summaryBusy.value ? 'summaryLoading' : summaryUnavailable.value ? 'summaryUnavailable' : summaryIncomplete.value ? 'summaryIncomplete' : 'summaryScope')))

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
  const parts = new Intl.DateTimeFormat(locale.value === 'ms' ? 'ms-MY' : locale.value, {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Kuching',
  }).formatToParts(parsed)
  const part = (type: string) => parts.find(part => part.type === type)?.value || ''
  return `${part('day')} ${part('month')} ${part('year')}, ${part('hour')}:${part('minute')}`
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
  const mapped: ObservationView = {
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
  trackDatabaseTranslationFields([
    { recordType: 'observation', recordId: id, fieldName: 'morphology', sourceVersion: String(item.revision), target: mapped, targetField: 'morphology' },
    { recordType: 'observation', recordId: id, fieldName: 'notes', sourceVersion: String(item.revision), target: mapped, targetField: 'notes' },
    { recordType: 'review-comment', recordId: id, fieldName: 'comment', target: mapped, targetField: 'reviewComment' },
  ])
  return mapped
}

class ObservationApiError extends Error {
  constructor(message: string, readonly status = 0) { super(message) }
}
async function request(url: string, signal?: AbortSignal, fresh: boolean | 'reload' = false): Promise<Record<string, unknown>> {
  let response: Response
  try {
    const timeout = AbortSignal.timeout(15000)
    response = await fetch(url, { credentials: 'same-origin', signal: signal ? AbortSignal.any([signal, timeout]) : timeout, ...(fresh ? { cache: fresh === true ? 'no-store' as const : fresh } : {}) })
  } catch {
    throw new ObservationApiError(t('conservationPages.observations.errors.network'))
  }
  let result: Record<string, unknown> | null
  try { result = record(await response.json()) }
  catch { throw new ObservationApiError(t('conservationPages.observations.errors.invalidResponse'), response.status) }
  if (!response.ok) {
    const fallback = response.status === 401
      ? t('conservationPages.observations.errors.unauthorized')
      : response.status === 403
        ? t('conservationPages.observations.errors.forbidden')
        : response.status === 404
          ? t('conservationPages.observations.errors.notFound')
          : t('conservationPages.observations.errors.requestFailed', { status: response.status })
    throw new ObservationApiError(fallback, response.status)
  }
  if (!result) throw new ObservationApiError(t('conservationPages.observations.errors.invalidResponse'))
  return result
}

function invalidateList() {
  invalidateSummary()
  listRequest++; listAbort?.abort(); listAbort = null
  hasMore.value = false; nextCursor.value = null; seenCursors.clear()
  loadedPageDepth = 0; isRefreshing.value = false; automaticRefreshError.value = ''; automaticRefreshDeferred.value = false
  isLoading.value = false; autoScanLimited.value = false; scannedPages.value = 0
}
// Invalidate immediately, including changes made while an empty page is scanning.
watch([queueOrigin, status], invalidateList, { flush: 'sync' })
async function loadObservations(append = false) {
  if (disposed || !authorizedOfficer.value) return
  if (append && (isLoading.value || !hasMore.value)) return
  invalidateSummary()
  listAbort?.abort()
  isRefreshing.value = false; automaticRefreshError.value = ''; automaticRefreshDeferred.value = false
  const token = ++listRequest
  const controller = new AbortController(); listAbort = controller
  const origin = 'subsequent_observation', selectedStatus = canonicalStatuses.includes(status.value) ? status.value : ''
  const current = () => !disposed && token === listRequest && !controller.signal.aborted && authorizedOfficer.value
  let cursor = append ? nextCursor.value : null
  if (!append) { clearCopyState(); observations.value = []; nextCursor.value = null; hasMore.value = false; skippedRecords.value = 0; seenCursors.clear(); loadedPageDepth = 0 }
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
      const found = rows.some(item => !previousIds.has(item.id) && item.origin === origin && (!selectedStatus || item.status === selectedStatus))
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
      loadedPageDepth++
      if (found || !page.hasMore) return
      cursor = page.cursor
    }
    autoScanLimited.value = hasMore.value
  } catch (error) {
    if (!current()) return
    // Keep successful pages and their continuation when a later request fails.
    loadError.value = error instanceof Error ? error.message : t('conservationPages.observations.errors.invalidResponse')
  } finally { if (current()) { isLoading.value = false; listAbort = null; if (!loadError.value) lastListRefreshAt = Date.now(); void refreshSummary() } }
}

function automaticRefreshBlocked() {
  return disposed || !authorizedOfficer.value || isLoading.value || isRefreshing.value || Boolean(listAbort) ||
    Boolean(selected.value) || historyModal.value || detailLoading.value || reviewSaving.value || copyPending.value ||
    statusHelpOpen.value || proposalState.value.loading || typeof route.query.observationEdit === 'string'
}

async function refreshObservations(manual = false) {
  if (automaticRefreshBlocked() || !loadedPageDepth) return
  if (!manual && loadedPageDepth > AUTO_REFRESH_PAGE_LIMIT) {
    automaticRefreshDeferred.value = true
    return
  }
  const actor = session.value.user?.id
  const depth = loadedPageDepth
  const origin = 'subsequent_observation'
  const selectedStatus = canonicalStatuses.includes(status.value) ? status.value : ''
  const controller = new AbortController()
  listAbort?.abort()
  const token = ++listRequest
  listAbort = controller
  const current = () => !disposed && token === listRequest && !controller.signal.aborted && authorizedOfficer.value && session.value.user?.id === actor
  invalidateSummary()
  automaticRefreshError.value = ''; automaticRefreshDeferred.value = false
  isRefreshing.value = true
  let cursor: string | null = null
  let latestPage: ReturnType<typeof readQueuePage> = null
  let pagesRead = 0, skipped = 0
  const visited = new Set<string>()
  const rows = new Map<string, ObservationView>()
  try {
    for (let index = 0; index < depth; index++) {
      const result = await request(observationQueueUrl(origin, selectedStatus, cursor), controller.signal, 'reload')
      if (!current()) return
      const page = readQueuePage(result.page)
      if (!Array.isArray(result.observations) || !page) throw new ObservationApiError(t('conservationPages.observations.errors.invalidResponse'))
      if (page.cursor !== null && (page.cursor === cursor || visited.has(page.cursor))) throw new ObservationApiError(t('conservationPages.observations.paginationInvalid'))
      if (page.cursor !== null) visited.add(page.cursor)
      const mapped = result.observations.map(mapObservation)
      skipped += mapped.length - mapped.filter((item): item is ObservationView => item !== null).length
      for (const item of mapped) if (item) rows.set(item.id, item)
      latestPage = page
      pagesRead++
      cursor = page.cursor
      if (!page.hasMore) break
    }
    if (!current() || !latestPage || pagesRead !== depth && latestPage.hasMore) return
    const staffIds = [...new Set([...rows.values()].map(item => item.ownerSubject).filter(subject => subject.startsWith('staff:')).map(subject => subject.slice(6)))]
      .filter(id => !submitterNames.value[id]).slice(0, 100)
    if (staffIds.length) {
      try {
        const directory = await request(`/api/conservation/submitter-names?ids=${encodeURIComponent(staffIds.join(','))}`, controller.signal)
        if (!current()) return
        if (directory.names && typeof directory.names === 'object' && !Array.isArray(directory.names))
          submitterNames.value = { ...submitterNames.value, ...directory.names as Record<string, string> }
      } catch { if (!current()) return /* Retain the existing abbreviated-name fallback. */ }
    }
    if (!current()) return
    observations.value = [...rows.values()].sort((a, b) => timestamp(b.createdAt) - timestamp(a.createdAt))
    skippedRecords.value = skipped
    hasMore.value = latestPage.hasMore
    nextCursor.value = latestPage.cursor
    loadedPageDepth = pagesRead
    seenCursors.clear(); for (const value of visited) seenCursors.add(value)
    if (!latestPage.hasMore) autoScanLimited.value = false
    lastListRefreshAt = Date.now()
  } catch (error) {
    if (current()) automaticRefreshError.value = error instanceof Error ? error.message : t('conservationPages.observations.errors.invalidResponse')
  } finally {
    if (current()) {
      isRefreshing.value = false
      listAbort = null
      if (!automaticRefreshError.value) {
        void refreshSummary()
        // The separate edit queue has expensive per-row evidence reads; it is
        // intentionally left to its existing manual/session refresh behavior.
      }
    }
  }
}

function startAutomaticRefresh() {
  if (refreshTimer !== undefined || !authorizedOfficer.value || disposed) return
  refreshTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible' && Date.now() - lastListRefreshAt >= AUTO_REFRESH_INTERVAL) void refreshObservations()
  }, AUTO_REFRESH_INTERVAL)
}
function stopAutomaticRefresh() {
  if (refreshTimer === undefined) return
  window.clearInterval(refreshTimer); refreshTimer = undefined
}
function refreshWhenVisible() {
  if (document.visibilityState === 'visible' && Date.now() - lastListRefreshAt >= AUTO_REFRESH_INTERVAL) void refreshObservations()
}

async function refreshSummary() {
  const token = ++summaryRequest
  summaryAbort?.abort(); summaryAbort = null
  summaryComplete.value = false; summaryLoading.value = false; summaryError.value = ''
  if (disposed || !authorizedOfficer.value || isLoading.value || isRefreshing.value || loadError.value) return
  summaryRows.value = [...observations.value]
  if (skippedRecords.value) { summaryError.value = 'unavailable'; return }
  if (!hasMore.value) { summaryComplete.value = true; return }
  const controller = new AbortController(); summaryAbort = controller
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60000)])
  const current = () => !disposed && token === summaryRequest && authorizedOfficer.value && !controller.signal.aborted
  const selectedStatus = canonicalStatuses.includes(status.value) ? status.value : ''
  let cursor = nextCursor.value
  const visited = new Set<string>()
  summaryLoading.value = true
  try {
    for (let pageNumber = 0; pageNumber < SUMMARY_PAGE_LIMIT; pageNumber++) {
      if (!cursor || visited.has(cursor)) throw new Error('Invalid summary continuation')
      visited.add(cursor)
      const result = await request(observationQueueUrl('subsequent_observation', selectedStatus, cursor), signal, true)
      if (!current()) return
      const page = readQueuePage(result.page)
      if (!Array.isArray(result.observations) || !page) throw new Error('Invalid summary page')
      const rows = result.observations.map(mapObservation)
      if (rows.some(row => !row)) throw new Error('Unverified summary record')
      summaryRows.value = [...new Map([...summaryRows.value, ...(rows as ObservationView[])].map(row => [row.id, row])).values()]
      const staffIds = [...new Set(summaryRows.value.map(row => row.ownerSubject).filter(subject => subject.startsWith('staff:')).map(subject => subject.slice(6)))].filter(id => !submitterNames.value[id])
      for (let i = 0; i < staffIds.length; i += 100) {
        try {
          const directory = await request(`/api/conservation/submitter-names?ids=${encodeURIComponent(staffIds.slice(i, i + 100).join(','))}`, signal)
          if (!current()) return
          if (directory.names && typeof directory.names === 'object') submitterNames.value = { ...submitterNames.value, ...directory.names as Record<string, string> }
        } catch { if (!current()) return /* Match the table's identifier fallback. */ }
      }
      if (!page.hasMore) { summaryComplete.value = true; return }
      cursor = page.cursor
    }
    summaryError.value = 'incomplete'
  } catch {
    if (current()) summaryError.value = 'unavailable'
  } finally {
    if (token === summaryRequest) { summaryLoading.value = false; summaryAbort = null }
  }
}

function retrySummary() {
  void refreshSummary()
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
  reviewSuccess.value = false; successNotice.value = false
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
  queueOrigin.value = 'subsequent_observation'; status.value = ''; void loadObservations()
  detailLoading.value = false
  detailError.value = ''
}
function closeModal(force = false) {
  if (reviewSaving.value && !force) return
  successNotice.value = false
  closeStatusHelp()
  observationPhotoPreview.value?.close()
  reviewMode.value = false
  reviewComment.value = ''
  reviewFeedback.value = ''
  reviewInfo.value = false
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
  summaryRows.value = summaryRows.value.map(item => item.id === row.id ? row : item)
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
  reviewSuccess.value = false; successNotice.value = false
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
    reviewSuccess.value = false; successNotice.value = false
    reviewInfo.value = !changed && !mustInspect
    reviewFeedback.value = reviewInfo.value ? modalText('upToDate') : rt('feedback.reloaded')
  } catch (error) {
    if (!disposed && token === detailRequest && selected.value?.id === id) {
      reviewNeedsReload.value = true
      reviewSuccess.value = false; successNotice.value = false
      reviewInfo.value = false
      reviewFeedback.value = error instanceof Error ? error.message : rt('feedback.loadFailed')
    }
  }
  finally { reviewSaving.value = false }
}
async function decide(decision: ReviewDecision) {
  if (!reviewAllowed.value || !selected.value || !reviewDecisions.value.includes(decision) || !positiveRevision(selected.value.revision)) return
  if (!reviewCommentValid(decision, reviewComment.value)) {
    reviewSuccess.value = false; successNotice.value = false
    reviewInfo.value = false
    reviewFeedback.value = rt('feedback.commentRequired')
    await nextTick(); reviewCommentInput.value?.focus()
    return
  }
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
    if (result.committed) { reviewHistoryRefresh.value++; successSequence.value++; successNotice.value = true }
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
const subjectTokens = computed(() => compactIdentifierTokens([...observations.value.map(item => item.ownerSubject), ...proposalState.value.rows.map(row => row.owner_subject)].filter(Boolean), subjectPart))
const submitterNames = ref<Record<string, string>>({})
const submitterLabel = (subject: string) => {
  if (!subject) return textOrUnavailable('')
  const id = subject.startsWith('staff:') ? subject.slice(6) : ''
  if (id && submitterNames.value[id]) return submitterNames.value[id]
  if (id && proposalState.value.names[id]) return proposalState.value.names[id]
  const account = session.value.user
  // The existing authenticated session can identify only this exact account.
  // Other submitters have no authorized name/directory mapping on this page.
  if (authorizedOfficer.value && account && subject === `staff:${account.id}` && account.name?.trim()) return account.name.trim()
  const key = subject.startsWith('staff:') ? 'staffIdentifier' : subject.startsWith('visitor:') ? 'visitorIdentifier' : 'submitterIdentifier'
  return t('conservationPages.observations.' + key, { id: subjectTokens.value.get(subject) || compactIdentifierTokens([subject], subjectPart).get(subject) || subjectPart(subject) })
}
async function copyIdentifier(value: string, kind: 'observation' | 'subject' | 'submission', reviewSubject = false, controlKey = `${kind}:${value}`) {
  if (!authorizedOfficer.value || copyPending.value || !value) return
  const listed = kind === 'submission' ? proposalItems.value.some(item => item.proposal.id === value) : observations.value.some(item => (kind === 'observation' ? item.id : item.ownerSubject) === value)
  const detail = selected.value
  const displayedInModal = detail && kind !== 'submission' && (kind === 'observation' ? detail.id === value : detail.ownerSubject === value || reviewSubject)
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

function matchesObservation(item: ObservationView) {
  if (item.origin !== 'subsequent_observation') return false
  const query = search.value.trim().toLowerCase()
  const searchable = `${item.id} ${item.plantRawId} ${item.plantDisplayId} ${item.scientificName} ${item.commonName} ${item.ownerSubject} ${item.status} ${observationLabel(item.id)} ${submitterLabel(item.ownerSubject)}`
  return (!query || searchable.toLowerCase().includes(query)) &&
    (!status.value || item.status === status.value) &&
    (!species.value || item.speciesId === species.value) &&
    (!owner.value || item.ownerSubject === owner.value) &&
    (!date.value || dateKey(item.createdAt) === date.value)
}
const filtered = computed(() => observations.value.filter(matchesObservation))
// Display-only union: proposal identity/revision never becomes a canonical Observation.
const proposalItems = computed(() => proposalState.value.rows.flatMap(proposal => {
  const baseline = mapObservation(proposal.observation_edit.current)
  return baseline?.origin === 'subsequent_observation' ? [{ kind: 'edit' as const, key: `observation-edit:${proposal.id}`, proposal, baseline }] : []
}))
const proposalLabels = computed(() => { const tokens=compactIdentifierTokens(proposalState.value.rows.map(row=>row.id)); return new Map(proposalItems.value.map(row => [row.proposal.id, `CHANGE-${tokens.get(row.proposal.id) || row.proposal.id}`])) })
function matchesProposal({ proposal, baseline }: (typeof proposalItems.value)[number]) {
  const query = search.value.trim().toLowerCase()
  // Origin/species belong to the verified baseline. Status, owner and date belong to the proposal.
  const searchable = `${proposal.id} CHANGE-${proposal.id} ${baseline.id} ${observationLabel(baseline.id)} ${baseline.plantRawId} ${baseline.plantDisplayId} ${baseline.scientificName} ${baseline.commonName} ${proposal.owner_subject} ${submitterLabel(proposal.owner_subject)} ${proposal.status}`
  return (queueOrigin.value === 'all' || baseline.origin === queueOrigin.value) &&
    (!query || searchable.toLowerCase().includes(query)) && (!status.value || proposal.status === status.value) &&
    (!species.value || baseline.speciesId === species.value) && (!owner.value || proposal.owner_subject === owner.value) &&
    (!date.value || dateKey(proposal.created_at) === date.value)
}
const displayedRows = computed(() => {
  const originals = submissionType.value === 'edit' ? [] : filtered.value.map(observation => ({ kind: 'original' as const, key: `observation:${observation.id}`, observation }))
  const proposals = submissionType.value === 'original' ? [] : proposalItems.value.filter(matchesProposal)
  return [...originals, ...proposals].sort((a,b) => timestamp(b.kind === 'original' ? b.observation.createdAt : b.proposal.created_at) - timestamp(a.kind === 'original' ? a.observation.createdAt : a.proposal.created_at))
})
const proposalReviewable = (row: ObservationEdit) => authorizedOfficer.value && !reviewSaving.value && row.status === 'Pending Review' &&
  Number.isSafeInteger(row.revision) && row.revision > 0 && row.owner_subject !== `staff:${session.value.user?.id}` && row.observation_edit.current.status === 'Approved'
watch(displayedRows, () => { copyAttempt++; copyPending.value = false; copyConfirmation.clear() })
const filtersHideLoaded = computed(() => filtered.value.length < observations.value.filter(item => item.origin === 'subsequent_observation').length)
watch(filtered, () => { copyAttempt++; copyPending.value = false; copyConfirmation.clear() })
const history = computed(() => selected.value
  ? observations.value.filter((item) => item.plantRawId === selected.value?.plantRawId) : [])
const speciesOptions = computed(() => {
  const options = new Map<string, string>()
  observations.value.forEach((item) => {
    if (item.speciesId) options.set(item.speciesId, item.commonName || item.scientificName || item.speciesId)
  })
  proposalItems.value.forEach(({baseline}) => { if (baseline.speciesId) options.set(baseline.speciesId, baseline.commonName || baseline.scientificName || baseline.speciesId) })
  return [...options].map(([id, name]) => ({ id, name }))
})
const ownerOptions = computed(() => [...new Set([...observations.value.map((item) => item.ownerSubject), ...proposalState.value.rows.map(row => row.owner_subject)].filter(Boolean))])

// Notification links use the existing authorized detail endpoint, independently
// of list pagination and filters. They never acknowledge notifications here.
async function resolveObservationQuery() {
  const token = ++navigationRequest
  const id = route.query.observation
  navigationError.value = ''
  if (reviewSaving.value) return
  closeModal()
  if (!id || route.query.observationEdit || !authorizedOfficer.value || disposed) return
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
watch(() => route.query.observationEdit, id => {
  if (typeof id === 'string' && id) { navigationRequest++; closeModal(true) }
}, { immediate: true })
watch(() => [route.query.observation, authorizedOfficer.value, session.value.user?.id], (next, previous) => {
  // A same-account verification outage/recovery must not reopen or close a draft.
  if (previous && next[0] === previous[0] && next[2] === previous[2] && session.value.user && (session.value.pending || selected.value)) return
  void resolveObservationQuery()
}, { immediate: true })

onMounted(() => {
  startAutomaticRefresh()
  void loadObservations()
  document.addEventListener('visibilitychange', refreshWhenVisible)
})
const observationPhotos = computed(() => authorizedOfficer.value && !reviewNeedsReload.value ? (selected.value?.assets || [])
  .filter(asset => asset.contentType.startsWith('image/') && !failedAssets.value.has(asset.id))
  .map(asset => ({ id: asset.id, url: assetUrl(asset.id) })) : [])
function openObservationPhoto(id: string, event: Event) {
  const index = observationPhotos.value.findIndex(photo => photo.id === id)
  if (index < 0 || !event.currentTarget) return
  void observationPhotoPreview.value?.open(observationPhotos.value, index, modalText('media'), event.currentTarget as HTMLElement)
}
watch(() => session.value.pending, pending => {
  if (pending) invalidateSummary()
  else if (authorizedOfficer.value && !isLoading.value && !loadError.value) void refreshSummary()
}, { flush: 'sync' })
const statusHelpContent = computed(() => {
  if (selected.value?.status === 'Rejected') return { title: modalText('aboutRejected'), description: t('submissionChanges.finalRejected'), note: '' }
  if (selected.value?.status === 'Approved') return { title: modalText('aboutApproved'), description: modalText('approvedDescription'), note: modalText('approvedEditNote') }
  return null
})
watch(() => [selected.value?.id, selected.value?.status], closeStatusHelp, { flush: 'sync' })
watch(statusHelpOpen, async open => {
  if (!open) { statusHelpTooltip.value?.hidePopover?.(); return }
  await nextTick()
  if (!statusHelpOpen.value || !statusHelpTooltip.value || !statusHelpButton.value || !statusHelpContent.value) return
  const bounds = statusHelpButton.value.getBoundingClientRect(), tooltip = statusHelpTooltip.value
  const width = Math.min(320, window.innerWidth - 24)
  tooltip.style.width = `${width}px`
  tooltip.style.left = `${Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12))}px`
  tooltip.style.top = `${bounds.bottom + 8}px`
  // Reuse the history-help native top-layer popover pattern, plus a body portal
  // so browsers without Popover support also escape modal overflow clipping.
  tooltip.showPopover?.()
  const height = tooltip.getBoundingClientRect().height
  if (bounds.bottom + 8 + height > window.innerHeight - 12) tooltip.style.top = `${Math.max(12, bounds.top - height - 8)}px`
})
function dismissStatusHelpKey(event: KeyboardEvent) {
  if (statusHelpOpen.value && event.key === 'Escape') {
    event.preventDefault(); event.stopPropagation(); closeStatusHelp()
  }
}
function dismissOutsideStatusHelp(event: Event) {
  const target = event.target as Node | null
  if (!statusHelpButton.value?.contains(target) && !statusHelpTooltip.value?.contains(target)) closeStatusHelp()
}
onMounted(() => {
  document.addEventListener('pointerdown', dismissOutsideStatusHelp)
  document.addEventListener('keydown', dismissStatusHelpKey, true)
  document.addEventListener('scroll', closeStatusHelp, true)
  window.addEventListener('resize', closeStatusHelp)
})
onBeforeUnmount(() => {
  stopAutomaticRefresh()
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', refreshWhenVisible)
  closeStatusHelp()
  if (typeof document !== 'undefined') {
    document.removeEventListener('pointerdown', dismissOutsideStatusHelp)
    document.removeEventListener('keydown', dismissStatusHelpKey, true)
    document.removeEventListener('scroll', closeStatusHelp, true)
  }
  window.removeEventListener?.('resize', closeStatusHelp)
})
watch(observationPhotos, photos => observationPhotoPreview.value?.reconcile(photos))
watch(() => selected.value?.id, () => observationPhotoPreview.value?.close(), { flush: 'sync' })

onBeforeUnmount(() => { disposed = true; navigationRequest++; clearCopyState(); detailRequest++; invalidateList(); unsubscribeSession() })
</script>

<template>
  <span class="officer-copy-live" role="status" aria-live="polite" aria-atomic="true"><span v-if="controlToastKey && !controlToastKey.startsWith('submitter:')" :key="controlToastKey">{{ t('conservationPages.reviews.copiedToast') }}</span></span>
  <section class="page-intro"><div>
    <p class="page-kicker">{{ t('conservationPages.observations.eyebrow') }}</p>
    <h2>{{ t('conservationPages.observations.title') }}</h2>
    <p>{{ rt('queues.fieldIntro') }}</p>
  </div></section>

  <ObservationEditQueue ref="proposalQueue" @state="receiveProposalState" />

  <p v-if="navigationError" role="alert">{{ navigationError }}</p>

  <section class="observation-summary" :aria-label="t('conservationPages.observations.summaryTitle')" :aria-busy="summaryBusy" :aria-describedby="summaryBusy || summaryUnavailable || summaryIncomplete ? 'observation-summary-definition' : undefined">
    <h3>{{ t(summaryHasFilters ? 'unifiedObservations.filteredSummaryTitle' : 'unifiedObservations.summaryTitle') }}</h3>
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
    <p v-if="summaryBusy || summaryUnavailable || summaryIncomplete" id="observation-summary-definition" class="observation-summary-definition" role="status">{{ summaryScope }}</p>
    <button v-if="summaryError && !isLoading && !loadError" type="button" class="action-button" :disabled="summaryLoading || !authorizedOfficer" @click="retrySummary">{{ t('conservationPages.observations.retry') }}</button>
  </section>

  <div class="control-bar">
    <label class="field"><span>{{ t('unifiedObservations.submissionType') }}</span><select v-officer-dropdown v-model="submissionType"><option value="all">{{ t('finalOfficerWorkflow.all') }}</option><option value="original">{{ t('finalOfficerWorkflow.original') }}</option><option value="edit">{{ t('finalOfficerWorkflow.edit') }}</option></select></label>
    <label class="field search-field"><span>{{ t('conservationPages.observations.search') }}</span><input v-model="search" :placeholder="t('conservationPages.observations.searchPlaceholder')" /></label>
    <label class="field"><span>{{ t('conservationPages.observations.status') }}</span><select v-officer-dropdown v-model="status" @change="loadObservations()"><option value="">{{ t('conservationPages.observations.allStatuses') }}</option><option v-for="item in supportedStatuses" :key="item" :value="item">{{ label(item) }}</option></select></label>
    <label class="field"><span>{{ t('conservationPages.observations.species') }}</span><select v-officer-dropdown v-model="species"><option value="">{{ t('conservationPages.observations.allSpecies') }}</option><option v-for="item in speciesOptions" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
    <label class="field"><span>{{ t('conservationPages.observations.submittedBy') }}</span><select v-officer-dropdown v-model="owner"><option value="">{{ t('conservationPages.observations.allSubmitters') }}</option><option v-for="item in ownerOptions" :key="item" :value="item" :title="item">{{ submitterLabel(item) }}</option></select></label>
    <label class="field"><span>{{ t('conservationPages.observations.created') }}</span><input v-model="date" type="date" /></label>
  </div>

  <section class="panel">
    <p v-if="isRefreshing" class="observation-auto-refresh-note" role="status" aria-live="polite">{{ t('conservationPages.observations.autoRefreshing') }}</p>
    <p v-else-if="automaticRefreshError" class="observation-auto-refresh-note error-state" role="alert">
      <span>{{ t('conservationPages.observations.autoRefreshFailed') }}</span>
      <button class="action-button" type="button" :disabled="!authorizedOfficer" @click="refreshObservations(true)">{{ t('conservationPages.observations.retry') }}</button>
    </p>
    <p v-else-if="automaticRefreshDeferred" class="observation-auto-refresh-note" role="status">
      <span>{{ t('conservationPages.observations.autoRefreshDeferred') }}</span>
      <button class="action-button" type="button" :disabled="!authorizedOfficer" @click="refreshObservations(true)">{{ t('conservationPages.observations.refreshNow') }}</button>
    </p>
    <p v-if="proposalState.error" class="proposal-warning" role="alert">{{ proposalState.error }} <button type="button" class="action-button" :disabled="!authorizedOfficer || proposalState.loading" @click="proposalQueue?.load()">{{ t('unifiedObservations.retry') }}</button></p>
    <p v-else-if="proposalState.loading" class="proposal-loading-note" role="status">{{ t('dashboardObservationEdits.loading') }}</p>
    <p v-if="!isLoading && filtersHideLoaded" class="dataset-note" role="status">{{ t(hasMore ? 'conservationPages.observations.filteredMore' : 'conservationPages.observations.filteredLoaded') }}</p>
    <p v-if="!isLoading && hasMore && !loadError" class="dataset-note" role="status">{{ t(autoScanLimited ? 'conservationPages.observations.paginationPaused' : 'conservationPages.observations.paginationMore') }}</p>
    <p v-if="skippedRecords" class="dataset-note" role="status">{{ t('conservationPages.observations.skipped', { count: skippedRecords }) }}</p>
    <p class="copy-feedback" :class="{ warning: copyFailed }" role="status" aria-live="polite" aria-atomic="true">{{ copyFeedback }}</p>
    <div class="table-scroll observations-scroll" role="region" :aria-label="t('conservationPages.observations.title')" tabindex="0"><table class="observations-table">
      <colgroup><col class="observation-column" /><col class="plant-column" /><col class="species-column" /><col class="submitter-column" /><col class="status-column" /><col class="created-column" /><col class="actions-column" /></colgroup>
      <thead><tr><th scope="col">{{ t('unifiedObservations.submissionId') }}</th><th scope="col">{{ t('conservationPages.observations.plantId') }}</th><th scope="col">{{ t('conservationPages.observations.species') }}</th><th scope="col">{{ t('conservationPages.observations.submittedBy') }}</th><th scope="col">{{ t('conservationPages.observations.status') }}</th><th scope="col">{{ t('conservationPages.observations.created') }}</th><th scope="col">{{ t('conservationPages.observations.actions') }}</th></tr></thead>
      <tbody>
        <tr v-for="row in displayedRows" :key="row.key" :class="{ 'terminal-read-only': ['Withdrawn','Cancelled'].includes(row.kind === 'original' ? row.observation.status : row.proposal.status), superseded: (row.kind === 'original' ? row.observation.status : String(row.proposal.status)) === 'Superseded' }">
          <template v-if="row.kind === 'original'"><template v-for="item in [row.observation]" :key="item.id">
          <td class="identity-cell submission-identity-cell"><span class="observation-card-emblem" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20 3C9 3 3 7 5 14s13 7 15-11ZM4 21 16 9" /></svg></span><div class="submission-identity-stack"><span class="observation-cell-label">{{ t('unifiedObservations.submissionId') }}</span><div class="identifier-line"><strong :title="item.id">{{ observationLabel(item.id) }}</strong><span class="officer-copy-anchor"><button type="button" class="identifier-copy" :disabled="!authorizedOfficer || copyPending" :aria-label="t('conservationPages.observations.copyObservationId', { id: observationLabel(item.id) })" :title="t('conservationPages.observations.copyObservationId', { id: observationLabel(item.id) })" @click="copyIdentifier(item.id, 'observation', false, `observation-icon-0:${item.id}`)"><svg v-if="!controlCopied[`observation-icon-0:${item.id}`]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></svg><svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="m5 12 4 4 10-10" /></svg></button><span v-if="controlToastKey === `observation-icon-0:${item.id}`" :key="`observation-icon-0:${item.id}`" class="officer-copy-toast" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 12 4 4 10-10" /></svg><span>{{ t('conservationPages.reviews.copiedToast') }}</span></span></span></div><span class="observation-cell-label">{{ t('unifiedObservations.submissionType') }}</span><span class="submission-type-badge submission-type-original">{{ t('finalOfficerWorkflow.original') }}</span><small v-if="item.origin === 'unknown'">{{ rt('queues.originUnverified') }}</small></div></td>
          <td class="plant-identity-cell"><span class="observation-cell-label">{{ t('conservationPages.observations.plantId') }}</span><span class="plant-id-value"><strong>{{ item.plantDisplayId }}</strong><em v-if="item.plantScientificName" class="observation-plant-name">{{ item.plantScientificName }}</em></span></td>
          <td><span class="observation-cell-label">{{ t('conservationPages.observations.species') }}</span><em>{{ speciesName(item) }}</em><small v-if="item.commonName && item.scientificName">{{ item.commonName }}</small><small v-if="item.hasSpeciesRequest">{{ t('conservationPages.observations.newSpeciesRequest') }}</small></td>
          <td class="identity-cell"><span class="observation-cell-label">{{ t('conservationPages.observations.submittedBy') }}</span><div class="identifier-line"><span :title="item.ownerSubject">{{ submitterLabel(item.ownerSubject) }}</span><template v-if="item.ownerSubject"><span class="officer-copy-anchor"><button type="button" class="identifier-copy" :disabled="!authorizedOfficer || copyPending" :aria-label="t('conservationPages.observations.copySubject', { id: submitterLabel(item.ownerSubject) })" :title="t('conservationPages.observations.copySubject', { id: submitterLabel(item.ownerSubject) })" @click="copyIdentifier(item.ownerSubject, 'subject', false, `observation-icon-1:${item.id}:${item.ownerSubject}`)"><svg v-if="!controlCopied[`observation-icon-1:${item.id}:${item.ownerSubject}`]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></svg><svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="m5 12 4 4 10-10" /></svg></button><span v-if="controlToastKey === `observation-icon-1:${item.id}:${item.ownerSubject}`" :key="`observation-icon-1:${item.id}:${item.ownerSubject}`" class="officer-copy-toast" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 12 4 4 10-10" /></svg><span>{{ t('conservationPages.reviews.copiedToast') }}</span></span></span></template></div></td><td class="status-cell"><span class="observation-cell-label">{{ t('conservationPages.observations.status') }}</span><span class="review-status-group"><span class="badge" :style="workflowBadgeStyle(item.status)" :class="keyFor(item.status)">{{ label(item.status) }}</span><span v-if="item.status === 'Pending Review' && item.isCorrectionResubmission" class="badge resubmission-tag">{{ t('conservationPages.observations.resubmitted') }}</span></span></td>
          <td class="created-cell"><span class="observation-cell-label">{{ t('conservationPages.observations.created') }}</span>{{ formatDate(item.createdAt) }}</td>
          <td class="actions-cell"><span class="observation-cell-label">{{ t('conservationPages.observations.actions') }}</span><div class="action-group">
            <button v-if="canReviewField(item)" type="button" class="action-button observation-icon-action" :disabled="reviewSaving" :aria-label="t('conservationPages.observations.review')" :title="t('conservationPages.observations.review')" @click="open(item, true)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M8 4H5v16h14V4h-3M9 2h6v4H9z" /><path d="m8 13 2.5 2.5L16 10" /></svg></button>
            <button v-else type="button" class="action-button observation-icon-action" :aria-label="t('common.viewDetails')" :title="t('common.viewDetails')" @click="open(item)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg></button>
            <RouterLink v-if="item.plantRouteId" class="action-button observation-icon-action" :to="`/plant/${item.plantRouteId}`" :aria-label="t('conservationPages.observations.viewPlant')" :title="t('conservationPages.observations.viewPlant')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" /><path d="M9 21v-7h6v7" /></svg></RouterLink>
            <button type="button" class="action-button observation-icon-action" :aria-label="t('conservationPages.observations.history')" :title="t('conservationPages.observations.history')" @click="openHistory(item)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></svg></button>
            <RouterLink v-if="authorizedOfficer && item.origin !== 'subsequent_observation' && (item.status === 'Pending Review' || item.status === 'Flagged')" class="action-button observation-icon-action" :to="{ name: 'conservation-reviews', query: { review: item.id } }" :aria-label="rt('queues.registrationReview')" :title="rt('queues.registrationReview')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 3h14v18l-7-4-7 4z" /><path d="M9 8h6m-6 4h6" /></svg></RouterLink>
          </div></td>
        </template></template>
          <template v-else>
            <td class="identity-cell submission-identity-cell"><span class="observation-card-emblem" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20 3C9 3 3 7 5 14s13 7 15-11ZM4 21 16 9" /></svg></span><div class="submission-identity-stack"><span class="observation-cell-label">{{ t('unifiedObservations.submissionId') }}</span><div class="identifier-line"><strong :title="row.proposal.id">{{ proposalLabels.get(row.proposal.id) }}</strong><span class="officer-copy-anchor"><button type="button" class="identifier-copy" :disabled="!authorizedOfficer || copyPending" :aria-label="t('monitoringDisplay.copy', { id: proposalLabels.get(row.proposal.id) })" :title="t('monitoringDisplay.copy', { id: proposalLabels.get(row.proposal.id) })" @click="copyIdentifier(row.proposal.id, 'submission', false, `submission-icon:${row.proposal.id}`)"><svg v-if="!controlCopied[`submission-icon:${row.proposal.id}`]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></svg><svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="m5 12 4 4 10-10" /></svg></button><span v-if="controlToastKey === `submission-icon:${row.proposal.id}`" :key="`submission-icon:${row.proposal.id}`" class="officer-copy-toast" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 12 4 4 10-10" /></svg><span>{{ t('conservationPages.reviews.copiedToast') }}</span></span></span></div><span class="observation-cell-label">{{ t('unifiedObservations.submissionType') }}</span><span class="submission-type-badge submission-type-edit">{{ t('finalOfficerWorkflow.edit') }}</span></div></td>
            <td class="plant-identity-cell"><span class="observation-cell-label">{{ t('conservationPages.observations.plantId') }}</span><span class="plant-id-value"><strong>{{ row.baseline.plantDisplayId }}</strong><em v-if="row.baseline.plantScientificName" class="observation-plant-name">{{ row.baseline.plantScientificName }}</em></span></td>
            <td><span class="observation-cell-label">{{ t('conservationPages.observations.species') }}</span><em>{{ speciesName(row.baseline) }}</em></td>
            <td class="identity-cell"><span class="observation-cell-label">{{ t('conservationPages.observations.submittedBy') }}</span><MonitoringIdentifier :value="row.proposal.owner_subject" :labels="new Map([[row.proposal.owner_subject,submitterLabel(row.proposal.owner_subject)]])" /></td>
            <td class="status-cell"><span class="observation-cell-label">{{ t('conservationPages.observations.status') }}</span><span class="badge" :style="workflowBadgeStyle(row.proposal.status)">{{ label(row.proposal.status) }}</span></td>
            <td class="created-cell"><span class="observation-cell-label">{{ t('conservationPages.observations.created') }}</span>{{ formatDate(row.proposal.created_at) }}</td>
            <td class="actions-cell"><span class="observation-cell-label">{{ t('conservationPages.observations.actions') }}</span><div class="action-group"><button type="button" class="action-button observation-icon-action" :disabled="!authorizedOfficer || reviewSaving" :aria-label="proposalReviewable(row.proposal) ? t('dashboardObservationEdits.review') : t('common.viewDetails')" :title="proposalReviewable(row.proposal) ? t('dashboardObservationEdits.review') : t('common.viewDetails')" @click="openProposal(row.proposal)"><svg v-if="proposalReviewable(row.proposal)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M8 4H5v16h14V4h-3M9 2h6v4H9z" /><path d="m8 13 2.5 2.5L16 10" /></svg><svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg></button></div></td>
          </template>
        </tr>
        <tr v-if="isLoading"><td colspan="7" class="state-cell">{{ t(scannedPages > 0 ? 'conservationPages.observations.scanning' : 'conservationPages.observations.loading') }}</td></tr>
        <tr v-else-if="loadError"><td colspan="7" class="state-cell error-state"><strong>{{ t('conservationPages.observations.loadFailed') }}</strong><span>{{ loadError }}</span><button class="action-button" @click="loadObservations(Boolean(nextCursor))">{{ t('conservationPages.observations.retry') }}</button></td></tr>
        <tr v-else-if="!displayedRows.length && !proposalState.loading"><td colspan="7" class="state-cell">{{ proposalState.error ? t('unifiedObservations.partial') : hasMore ? t('conservationPages.observations.emptyMore') : t('unifiedObservations.empty') }}</td></tr>
      </tbody>
    </table></div>
    <button v-if="hasMore || loadError" class="action-button" :disabled="isLoading" @click="loadObservations(Boolean(nextCursor))">{{ rt('queues.loadMore') }}</button>
  </section>

  <AppModal v-if="selected && !historyModal" v-observation-dialog="selected.id" class="observation-dialog" :title="modalText('title')" wide accessible @close="closeModal()">
    <template #title>
      <span class="observation-title-layout">
        <span class="observation-title-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 2 21 2c0 4-1 11-5 15-2 2-4 3-5 3ZM2 22l12-12" /></svg></span>
        <span class="observation-title-copy"><span>{{ modalText('title') }}</span><span class="observation-title-subtitle"><span class="identifier-line"><strong :title="selected.id">{{ observationLabel(selected.id) }}</strong><span class="officer-copy-anchor"><button type="button" class="identifier-copy" :disabled="!authorizedOfficer || copyPending" :aria-label="t('conservationPages.observations.copyObservationId', { id: observationLabel(selected.id) })" :title="t('conservationPages.observations.copyObservationId', { id: observationLabel(selected.id) })" @click="copyIdentifier(selected.id, 'observation', false, `observation-icon-2:${selected.id}`)"><svg v-if="!controlCopied[`observation-icon-2:${selected.id}`]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></svg><svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="m5 12 4 4 10-10" /></svg></button><span v-if="controlToastKey === `observation-icon-2:${selected.id}`" :key="`observation-icon-2:${selected.id}`" class="officer-copy-toast" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 12 4 4 10-10" /></svg><span>{{ t('conservationPages.reviews.copiedToast') }}</span></span></span></span></span></span>
        <span class="observation-refresh-control">
          <button class="observation-refresh-button" type="button" :aria-label="t('submissionChanges.reload')" aria-describedby="observation-refresh-tooltip" :disabled="!authorizedOfficer || reviewSaving || detailLoading" :aria-busy="reviewSaving || detailLoading" @click="reloadReview">
            <svg class="lucide lucide-refresh-cw" :class="{ 'observation-refresh-spinning': reviewSaving || detailLoading }" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15.5-6.4L21 8 M21 3v5h-5 M21 12a9 9 0 0 1-15.5 6.4L3 16 M8 16H3v5" /></svg>
          </button>
          <span id="observation-refresh-tooltip" class="observation-refresh-tooltip" role="tooltip">{{ t('submissionChanges.reload') }}</span>
        </span>
      </span>
    </template>
    <ActionFeedback v-if="successNotice" :key="successSequence" :feedback-id="successSequence" variant="success" :message="rt('feedback.saved')" @dismiss="successNotice = false" />
    <div class="observation-dialog-content"><p class="copy-feedback" :class="{ warning: copyFailed }" role="status" aria-live="polite" aria-atomic="true">{{ copyFeedback }}</p>
      <p v-if="selected.origin === 'unknown'" role="status">{{ rt('queues.originUnverified') }}</p>
      <p v-if="detailLoading" class="detail-state" role="status">{{ t('conservationPages.observations.loadingDetails') }}</p>
      <p v-if="detailError" class="detail-state error-state" role="alert">{{ detailError }}</p>
      <div v-if="!reviewAcknowledged || reviewNeedsReload" class="review-feedback error" role="alert"><p>{{ t(!reviewAcknowledged ? 'submissionChanges.conflict' : 'submissionChanges.reloadRequired') }}</p></div>
      <div v-if="statusHelpContent" class="observation-status-strip" :class="selected.status === 'Rejected' ? 'is-rejected' : 'is-approved'" role="status">
        <svg v-if="selected.status === 'Rejected'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="m8 8 8 8M16 8l-8 8" /></svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="m7 12 3 3 7-7" /></svg>
        <strong>{{ label(selected.status) }}</strong>
        <span class="observation-status-help" @mouseenter="showStatusHelp" @mouseleave="deferCloseStatusHelp"><button ref="statusHelpButton" type="button" class="observation-status-help-button" :aria-label="statusHelpContent.title" :aria-expanded="statusHelpOpen" :aria-describedby="statusHelpOpen ? 'observation-status-tooltip' : undefined" @focus="showStatusHelp" @blur="closeStatusHelp" @click="showStatusHelp" @keydown.esc.stop.prevent="closeStatusHelp">?</button></span>
      </div>
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
          <section class="observation-information-section observation-media">
            <h3 class="observation-section-heading"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8" cy="8" r="1" /><path d="m21 15-5-5L5 21" /></svg>{{ modalText('media') }}</h3>
            <div class="observation-section-content">
              <p v-if="!selected.assets.length">{{ t('conservationPages.observations.noAssets') }}</p>
              <div v-else class="submission-image-grid"><article v-for="(asset, index) in selected.assets" :key="asset.id" class="submitted-image-item"><button v-if="asset.contentType.startsWith('image/') && !failedAssets.has(asset.id)" type="button" class="submitted-image-preview observation-photo-button" :aria-label="`${t('common.viewDetails')}: ${modalText('media')} ${index + 1}`" @click="openObservationPhoto(asset.id, $event)"><img :src="assetUrl(asset.id)" :alt="`${modalText('media')} ${index + 1}`" loading="lazy" @error="imageFailed(asset.id)" /></button><div v-else class="submitted-image-preview"><span>{{ t(asset.contentType.startsWith('image/') ? 'conservationPages.observations.imageUnavailable' : 'conservationPages.observations.attachment') }}</span></div></article></div>
            </div>
          </section>
          </template>
        </div>
        <div class="observation-review-column" :class="{ 'observation-review-mode': reviewMode }">
          <div class="observation-review-content">

          <section v-if="reviewMode" class="officer-review" :aria-busy="reviewSaving || detailLoading">
            <h3 class="observation-section-heading"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="5" width="14" height="17" rx="2" /><rect x="9" y="2" width="6" height="5" rx="1" /><path d="m9 14 2 2 4-4" /></svg>{{ modalText('officerReview') }}</h3>
            <div class="observation-section-content">
      <p v-if="!reviewAllowed && !detailLoading && !reviewSaving && !reviewNeedsReload" role="status">{{ rt('reviewUnavailable') }}</p>
      <ReviewCommentField ref="reviewCommentInput" id="observation-review-comment" v-model="reviewComment" :label="t('conservationPages.observations.reviewComment')" :placeholder="t('conservationText.recordtheobservationdecisionorrequiredaction')" :invalid="reviewCommentError" :described-by="reviewCommentError ? 'observation-review-comment-error' : undefined" :disabled="reviewSaving || detailLoading" :rows="5" />
      <p v-if="reviewFeedback && !reviewSuccess" :id="reviewCommentError ? 'observation-review-comment-error' : undefined" :role="reviewInfo || reviewSuccess ? 'status' : 'alert'" class="observation-review-feedback" :class="[reviewFeedbackVariant, { 'observation-comment-validation': reviewCommentError }]"><svg v-if="reviewCommentError" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10" /><path d="M12 8v4 M12 16h.01" /></svg><span>{{ reviewFeedback }}</span></p>
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
    <Teleport to="body">
      <div v-if="statusHelpOpen && statusHelpContent" id="observation-status-tooltip" ref="statusHelpTooltip" popover="manual" class="observation-status-tooltip" role="tooltip" @mouseenter="showStatusHelp" @mouseleave="deferCloseStatusHelp">
        <strong><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></svg>{{ statusHelpContent.title }}</strong>
        <p>{{ statusHelpContent.description }}</p><p v-if="statusHelpContent.note" class="observation-status-edit-note">{{ statusHelpContent.note }}</p>
      </div>
    </Teleport>
    <PlantPhotoLightbox ref="observationPhotoPreview" root-scroll-lock />
  </AppModal>

  <AppModal v-if="selected && historyModal" :title="t('conservationPages.observations.historyTitle', { id: selected.plantDisplayId })" :subtitle="t('conservationPages.observations.historyLimit')" wide accessible @close="closeModal">
    <p v-if="isLoading" role="status">{{ t('conservationPages.observations.loading') }}</p>
    <p v-if="loadError" role="alert">{{ loadError }}</p>
    <button v-if="hasMore || loadError" class="action-button" :disabled="isLoading" @click="loadObservations(Boolean(nextCursor))">{{ rt('queues.loadMore') }}</button>
    <p class="observation-data-provenance" role="note">{{ modalText('historyReadOnly') }}</p>
    <div class="table-scroll history-table-scroll" role="region" tabindex="0" :aria-label="t('conservationPages.observations.historyTitle', { id: selected.plantDisplayId })"><table><thead><tr><th>{{ t('conservationPages.observations.id') }}</th><th>{{ t('conservationPages.observations.created') }}</th><th>{{ t('conservationPages.observations.height') }}</th><th>{{ t('conservationPages.observations.health') }}</th><th>{{ t('conservationPages.observations.status') }}</th></tr></thead><tbody><tr v-for="item in history" :key="item.id"><td>{{ item.id }}</td><td class="created-cell">{{ formatDate(item.createdAt) }}</td><td>{{ textOrUnavailable(item.height) }}</td><td>{{ label(item.healthStatus) }}</td><td>{{ label(item.status) }}</td></tr></tbody></table></div>
  </AppModal>
</template>

<style scoped>
.observation-summary-definition { margin: 10px 0 0; color: #536b60; font-size: 13px; line-height: 1.5; }
.observation-auto-refresh-note { display:flex; align-items:center; flex-wrap:wrap; gap:8px 12px; margin:0 0 12px; color:#536b60; font-size:13px; line-height:1.5; }
.observation-auto-refresh-note.error-state { color:#8b2f26; }
.proposal-loading-note { color:#52685d; font-size:13px; line-height:1.5; }
.proposal-warning { display:flex; align-items:center; flex-wrap:wrap; gap:10px; padding:10px 14px; background:#fff7ed; color:#7c2d12; border-radius:8px; }
.superseded > td { background:#f3f4f6; color:#4b5563; }
.terminal-read-only > td { background-color: #F3F4F6; color: #374151; }
@media (max-width: 640px) { .observation-type-field { flex-basis: 100%; width: 100%; min-width: 0; } }

.review-status-group { display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
.observations-table .status-cell .review-status-group .resubmission-tag { background: #FFF1DB; color: #926119; font-size: 12px; padding: 3px 8px; flex-shrink: 0; }

.observation-summary { min-width: 0; max-width: 100%; container-type: inline-size; margin-bottom: 18px; }
.observation-summary > h3 { margin: 0 0 16px; }
.observation-summary-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin-bottom: 8px; }
.observation-summary-card { min-width: 0; padding: 18px; border: 1px solid currentColor; border-radius: 14px; background: var(--observation-summary-background); color: var(--observation-summary-ink); box-shadow: none; display: grid; grid-template-rows: 1fr auto; }
.observation-summary-title { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
.officer-layout.officer-layout.officer-layout .observation-summary-title p { margin: 0; min-width: 0; color: inherit; font-size: .875rem; line-height: 1.5; }
.observation-summary-title svg { flex: 0 0 20px; width: 20px; height: 20px; }
.officer-layout.officer-layout.officer-layout .observation-summary-card strong { color: inherit; font-size: 1.875rem; line-height: 1.2; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.observation-summary-card[data-status="Pending Review"] { --observation-summary-background: #FEF9C3; --observation-summary-ink: #854D0E; }
.observation-summary-card[data-status="Correction Required"] { --observation-summary-background: #fff1db; --observation-summary-ink: #926119; }
.observation-summary-card[data-status="Flagged"] { --observation-summary-background: #f0eaf8; --observation-summary-ink: #69459a; }
.observation-summary-card[data-status="Rejected"] { --observation-summary-background: #fbe8e5; --observation-summary-ink: #a33f35; }
.observation-summary-card[data-status="Approved"] { --observation-summary-background: #e7f3e9; --observation-summary-ink: #287347; }
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
.state-cell span, td small { display: block; margin-top: 4px; }
.error-state { color: #9b3d35; }
.error-state .action-button { margin-top: 12px; }
.observations-scroll { min-width: 0; max-width: 100%; overflow-x: auto; overscroll-behavior-inline: contain; container-type: inline-size; }
.observations-scroll:focus-visible { outline: 3px solid #315b49; outline-offset: -3px; }
.officer-layout.officer-layout.officer-layout .observations-scroll .observations-table { width: 100%; min-width: 78rem; table-layout: fixed; white-space: normal; border-collapse: separate; border-spacing: 0; }
.observations-table .observation-column { width: 24%; }
.observations-table .plant-column { width: 14%; }
.observations-table .species-column { width: 17%; }
.observations-table .submitter-column { width: 13%; }
.observations-table .status-column { width: 11%; }
.observations-table .created-column { width: 12%; }
.observations-table .actions-column { width: 9%; }
.observations-table th, .observations-table td { padding: 10px; text-align: center; vertical-align: middle; white-space: normal; overflow-wrap: anywhere; }
.observations-table th:nth-child(1), .observations-table td:nth-child(1) { min-width: 16rem; }
.observations-table th:nth-child(2), .observations-table td:nth-child(2) { min-width: 10rem; }
.observations-table th:nth-child(3), .observations-table td:nth-child(3) { min-width: 12rem; }
.observations-table th:nth-child(4), .observations-table td:nth-child(4) { min-width: 10rem; }
.observations-table th:nth-child(5), .observations-table td:nth-child(5) { min-width: 9rem; }
.observations-table th:nth-child(6), .observations-table td:nth-child(6) { min-width: 11rem; }
.observations-table th:nth-child(7), .observations-table td:nth-child(7) { min-width: 10rem; }
.observations-table td:first-child .identifier-line { flex-wrap: wrap; max-width: 100%; }
.observations-table td:first-child .identifier-line strong { white-space: normal; overflow-wrap: anywhere; word-break: break-word; }
.observations-table td:nth-child(4) .identifier-line { flex-wrap: wrap; align-items: center; }
.observations-table td:nth-child(4) .identifier-line > span:first-child { white-space: normal; overflow-wrap: anywhere; word-break: break-word; }
.observation-cell-label, .observation-card-emblem { display: none; }
.submission-identity-stack { display: grid; justify-items: center; min-width: 0; gap: 3px; }
.observations-table .plant-id-value { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; }
.observations-table .plant-id-value strong { color: #174c38; font-weight: 700; }
.observations-table .observation-plant-name { color: #53695e; font-style: italic; overflow-wrap: anywhere; }
.observations-table th { background: #245443; color: #fff; border-bottom-color: #245443; font-size: 10px; font-weight: 700; line-height: 1.4; }
.observations-table thead th:first-child { border-top-left-radius: 10px; }
.observations-table thead th:last-child { border-top-right-radius: 10px; }
.observations-table td { font-size: 12px; line-height: 1.5; }
.observations-table th:nth-child(2), .observations-table th:nth-child(5), .observations-table th:nth-child(7) { white-space: nowrap; overflow-wrap: normal; }
.observations-table .status-cell { white-space: normal; }
.observations-table .actions-cell { text-align: center; white-space: nowrap; }
.observations-table .badge { display: inline-flex; align-items: center; width: max-content; max-width: none; box-sizing: border-box; white-space: nowrap; overflow-wrap: normal; font-size: 11px; line-height: 1.4; vertical-align: middle; }
.observations-scroll .observations-table .action-group { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 6px; width: 100%; min-width: 0; }
.observations-table .action-group > .action-button.observation-icon-action { display: inline-grid; place-items: center; flex: 0 0 36px; width: 36px; min-width: 36px; height: 36px; min-height: 36px; max-width: 36px; padding: 0; border-radius: 8px; }
.officer-layout.officer-layout.officer-layout .observations-table .observation-icon-action:hover:not(:disabled), .officer-layout.officer-layout.officer-layout .observations-table .observation-icon-action:focus-visible:not(:disabled) { border-color: #245443; background: #33745d; color: #fff; }
.observations-table .observation-icon-action { position: relative; }
.observations-table .observation-icon-action svg { display: block; width: 17px; height: 17px; }
.observations-table .observation-icon-action::after { content: attr(title); position: absolute; z-index: 5; right: 0; bottom: calc(100% + 6px); width: max-content; max-width: 180px; padding: 6px 9px; border-radius: 6px; background: #173f34; color: #fff; font-size: 12px; line-height: 1.5; text-align: center; white-space: normal; pointer-events: none; opacity: 0; visibility: hidden; }
.observations-table .observation-icon-action:hover::after, .observations-table .observation-icon-action:focus-visible::after { opacity: 1; visibility: visible; }
.observations-table .observation-icon-action:focus-visible { outline: 3px solid #315b49; outline-offset: 2px; }
.observations-scroll .observations-table .identifier-copy { flex: 0 0 44px; width: 44px; min-width: 44px; max-width: 44px; height: 44px; }
.observations-table .state-cell { padding: 30px 14px; text-align: center; }
@container (max-width: 1248px) {
  .officer-layout.officer-layout.officer-layout .observations-scroll .observations-table { display: block; width: 100%; min-width: 0; }
  .observations-table colgroup { display: none; }
  .observations-table thead { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
  .observations-table tbody { display: grid; gap: 12px; }
  .observations-table tbody tr { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 16px;padding:16px;border:1px solid #d7e0db;border-radius:16px;background:#fff; }
  .observations-table tbody tr > td { display: block; min-width: 0 !important; padding: 0; border: 0; text-align: left; white-space: normal; overflow-wrap: anywhere; }
  .observations-table tbody tr > td:first-child, .observations-table tbody tr > td:nth-child(6), .observations-table tbody tr > td:nth-child(7) { grid-column: 1 / -1; }
  .observations-table tbody tr > td:first-child { display: flex; align-items: center; gap: 14px; padding-bottom: 12px; border-bottom: 1px solid #d7e0db; }
  .observations-table .observation-card-emblem { display: grid; place-items: center; flex: 0 0 52px; width: 52px; height: 52px; border-radius: 11px; background: #dcebd8; color: #245443; }
  .observations-table .observation-card-emblem svg { width: 34px; height: 34px; }
  .observations-table tbody tr > td:first-child .submission-identity-stack { flex: 1 1 auto; display: grid; align-items: start; justify-items: start; gap: 4px; min-width: 0; }
  .observations-table tbody tr > td:first-child .identifier-line { display: flex; align-items: center; flex-wrap: wrap; min-width: 0; }
  .officer-layout.officer-layout.officer-layout .observations-table tbody tr > td:first-child .identifier-line > strong { color:#174c38;font-family:inherit;font-size:18px;font-weight:700;line-height:24px;overflow-wrap:anywhere; }
  .observations-table tbody tr > td:first-child .identifier-copy { flex: 0 0 40px; width: 40px; min-width: 40px; max-width: 40px; height: 40px; }
  .observations-table tbody tr > td:nth-child(2), .observations-table tbody tr > td:nth-child(3), .observations-table tbody tr > td:nth-child(4), .observations-table tbody tr > td:nth-child(5) { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px; }
  .observations-table .observation-cell-label { display:inline-flex;flex:0 0 auto;align-items:center;margin:0;color:#315848;font-size:14px;font-weight:600;line-height:20px; }
  .observations-table .observation-cell-label::after { content: ':'; }
  .observations-table .submission-identity-stack > .observation-cell-label { display: inline-flex; flex: 0 0 auto; }
  .observations-table .plant-id-cell, .observations-table .status-cell, .observations-table .identity-cell { font-size:14px;line-height:20px; }
  .observations-table .plant-id-value { display:flex;flex:1 1 50%;min-width:0;align-items:flex-start;flex-direction:column;flex-wrap:wrap;gap:2px; }
  .observations-table .plant-id-value strong { color:#174c38;font-size:14px;font-weight:700;line-height:20px; }
  .observations-table .observation-plant-name { color:#53695e;font-size:14px;font-style:italic;line-height:20px;overflow-wrap:anywhere; }
  .observations-table .identity-cell .identifier-line > span:first-child { font-size:14px;line-height:20px; }
  .observations-table tbody tr > td:nth-child(6) { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px; }
  .observations-table .identity-cell .identifier-line { display: flex; width: auto; align-items: center; flex-wrap: wrap; }
  .observations-table .identity-cell > .identifier-line,
  .observations-table .identity-cell > div.identifier-line { flex:1 1 48%;min-width:0; }
  .observations-table .identity-cell > .monitoring-identifier { flex:1 1 48%;min-width:0; }
  .observations-table .identity-cell > .identifier-line > span:first-child { min-width:0;overflow-wrap:anywhere; }
  .observations-table .terminal-read-only > td, .observations-table tr.terminal-read-only > td, .observations-table tr.superseded > td { background: #fff; color: inherit; }
  .observations-table .status-cell .review-status-group { justify-content:flex-start;flex-wrap:wrap;white-space:normal; }
  .observations-table tbody tr > td:nth-child(7) { padding-top: 12px; border-top: 1px solid #d7e0db; }
  .observations-table .actions-cell > .observation-cell-label { display: none; }
  .officer-layout.officer-layout.officer-layout .observations-scroll .observations-table .action-group { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: stretch; gap: 0; width: 100%; min-width: 0; }
  .officer-layout.officer-layout.officer-layout .observations-table .action-group > .action-button.observation-icon-action { display: flex; flex: 1 1 0; width: 100%; min-width: 0; max-width: none; height: auto; min-height: 56px; align-items: center; justify-content: center; flex-direction: column; gap: 6px; padding: 6px 4px; border: 0; border-radius: 6px; background: transparent; color: #2b6b50; white-space: normal; }
  .officer-layout.officer-layout.officer-layout .observations-table .action-group > .action-button.observation-icon-action:nth-child(3n + 2), .officer-layout.officer-layout.officer-layout .observations-table .action-group > .action-button.observation-icon-action:nth-child(3n) { border-left: 1px solid #d7e0db; }
  .officer-layout.officer-layout.officer-layout .observations-table .action-group > .action-button.observation-icon-action:hover:not(:disabled), .officer-layout.officer-layout.officer-layout .observations-table .action-group > .action-button.observation-icon-action:focus-visible:not(:disabled) { background: #33745d; color: #fff; }
  .observations-table .observation-icon-action::after { content: attr(aria-label); position: static; display: block; width: auto; max-width: 100%; padding: 0; border-radius: 0; background: transparent; color: inherit; font-size: 12px; line-height: 1.3; text-align: center; overflow-wrap: anywhere; opacity: 1; visibility: visible; }
  .observations-scroll .observations-table .identifier-copy { flex-basis: 44px; width: 44px; min-width: 44px; max-width: 44px; height: 44px; }
  .observations-table .state-cell { grid-column: 1 / -1; padding: 20px 12px; }
}
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

.submission-type-badge { display: inline-flex; align-items: center; box-sizing: border-box; max-width: 100%; padding: 4px 9px; border-radius: 6px; font-size: 12px; font-weight: 700; line-height: 1.4; white-space: normal; overflow-wrap: normal; word-break: normal; }
.submission-type-original { background-color: #e0f2fe; color: #075985; }
.submission-type-edit { background-color: #f3e8ff; color: #6b21a8; }
</style>

<style src="../../styles/observation-dialog.css">
.submission-type-badge { display: inline-flex; align-items: center; box-sizing: border-box; max-width: 100%; padding: 4px 9px; border-radius: 6px; font-size: 12px; font-weight: 700; line-height: 1.4; white-space: normal; overflow-wrap: normal; word-break: normal; }
.submission-type-original { background-color: #e0f2fe; color: #075985; }
.submission-type-edit { background-color: #f3e8ff; color: #6b21a8; }
</style>

