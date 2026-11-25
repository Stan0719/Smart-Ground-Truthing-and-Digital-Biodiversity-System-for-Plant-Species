<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import MonitoringIdentifier from '../../components/conservation/MonitoringIdentifier.vue'
import { monitoringLabels, monitoringDate } from '../../utils/officerMonitoringDisplay'
import { sessionSnapshot, subscribeSession } from '../../services/auth'
import BiodiversityMapPreview from '../../components/conservation/BiodiversityMapPreview.vue'
import { reviewEligible, reviewTransitions, positiveRevision } from '../../services/observationReview'
import { mapLinkedSpeciesRequest, speciesRequestCanDecide } from '../../services/reviewSpeciesRequest'
import { observationOrigin, readQueuePage } from '../../services/observationQueue'
import { formatObservationId } from '../../utils/observationId'
import { formatPlantId } from '../../utils/plantId'
import { loadCanonicalAlertQueue, type CanonicalThreatAlert } from '../../services/threatAlerts'
import { loadAlertContext, type AlertContext } from '../../services/alertEvidence'
import { loadCameraEvents } from '../../services/cameraEvents'
import type { CameraEvent } from '../../types/cameraMonitoring'
import { createThreatAlertRefresh } from '../../services/threatAlertRefresh'
import { alertSource, alertStatusLabel, alertTypeLabel, sensorUnit } from '../../utils/threatAlertDisplay'
import { threatAlertBadgeStyle } from '../../utils/workflowBadge'
import { useConservationText } from '../../composables/useConservationText'

interface ApiObservation extends Record<string, unknown> {
  origin_type?: unknown
  id: string | number
  plant_id: string | number
  owner_subject?: string | null
  status?: string | null
  scientific_name?: string | null
  common_name?: string | null
}

interface ApiPlant {
  plant_id: string | number
  species_id: string | number
  registered_subject?: string | null
  rbac_status?: string | null
  registered_at?: string | null
  latitude?: string | number | null
  longitude?: string | number | null
  observed_at?: string | null
}

interface ApiSpecies {
  species_id: string | number
  scientific_name?: string | null
  common_name?: string | null
  conservation_status?: string | null
}

interface DashboardAlertEvidence {
  signature: string
  state: 'loading' | 'ready' | 'unavailable'
  context?: AlertContext
  cameraEvent?: CameraEvent | null
}

const router = useRouter()
const { t, te, locale } = useI18n()
const { ct: alertText } = useConservationText()
const today = new Date()
const dateLocale = computed(() => locale.value === 'ms' ? 'ms-MY' : locale.value.startsWith('en') ? 'en-GB' : locale.value)
const currentDate = computed(() =>
  new Intl.DateTimeFormat(dateLocale.value, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(today),
)
const currentDateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
const dt = (value?: string | null) => monitoringDate(value, locale.value)

const go = (name: string, query?: Record<string, string>) => router.push({ name, query })

const session = ref(sessionSnapshot())
const unsubscribeSession = subscribeSession((user, pending) => { session.value = { user, pending } })
onBeforeUnmount(unsubscribeSession)
const authorizedOfficer = computed(() => !session.value.pending && session.value.user?.role === 'Conservation Officer' && session.value.user.status === 'Active' && session.value.user.mustChangePassword === false)
const observations = ref<ApiObservation[]>([])
const registrationRows = ref<ApiObservation[]>([])
const fieldRows = ref<ApiObservation[]>([])
const registrationLoading = ref(true), fieldLoading = ref(true)
const registrationError = ref(''), fieldError = ref('')
const observationTotals = ref<{ total: number; pending: number } | null>(null)
const previewControllers = new Map<string, AbortController>()
let disposed = false
onBeforeUnmount(() => { disposed = true; for (const controller of previewControllers.values()) controller.abort() })
const plants = ref<ApiPlant[]>([])
const species = ref<ApiSpecies[]>([])
const alerts = ref<CanonicalThreatAlert[]>([])
const dashboardAlertEvidence = ref<Record<string, DashboardAlertEvidence>>({})
const alertContextControllers = new Map<string, AbortController>()
let cameraEvidenceController: AbortController | null = null
let cameraEvidenceGeneration = 0
let cameraEvidenceRequestKey = ''
let alertEvidenceSessionGeneration = 0
const alertsLoaded = ref(false)
let alertsSequence = 0
let alertsController: AbortController | null = null
let alertsRefresh: ReturnType<typeof createThreatAlertRefresh> | null = null
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
const observationDisplayLabels = computed(() => new Map([...monitoringLabels(observations.value.map(item => item.id))].map(([raw, label]) => [raw, formatObservationId(raw) || (uuid.test(raw) ? `OBS-${label.replace(/\u2026$/, '')}` : label)])))
const observationsLoading = ref(true)
const plantsLoading = ref(true)
const speciesLoading = ref(true)
const alertsLoading = ref(true)
const observationsError = ref('')
const plantsError = ref('')
const speciesError = ref('')
const alertsError = ref('')

const loadJson = async <T,>(url: string, collection: string): Promise<T[]> => {
  let response: Response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15000) })
  } catch {
    throw new Error('Dashboard data unavailable. Please try again later.')
  }
  let result: Record<string, unknown>
  try {
    const body: unknown = await response.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error()
    result = body as Record<string, unknown>
  } catch {
    throw new Error('Dashboard data unavailable: invalid server response.')
  }
  if (!response.ok) {
    const message = [result.message, result.error].find(
      (value): value is string => typeof value === 'string' && Boolean(value.trim()),
    )
    throw new Error(message || 'Dashboard data unavailable. Please try again later.')
  }
  if (
    !Array.isArray(result[collection]) ||
    result[collection].some((item) => !item || typeof item !== 'object' || Array.isArray(item))
  )
    throw new Error('Dashboard data unavailable: invalid server response.')
  return result[collection] as T[]
}

const loadObservations = async () => {
  const controller = new AbortController()
  previewControllers.get('counts')?.abort(); previewControllers.set('counts', controller)
  observationsLoading.value = true; observationsError.value = ''; observationTotals.value = null
  try {
    const response = await fetch('/api/observations?view=dashboard-counts', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
    const body = await response.json()
    if (!response.ok || !Number.isSafeInteger(body.totals?.total) || body.totals.total < 0 ||
        !Number.isSafeInteger(body.totals?.pending) || body.totals.pending < 0 || body.totals.pending > body.totals.total) throw Error()
    if (!controller.signal.aborted && !disposed) observationTotals.value = body.totals
  } catch {
    if (!controller.signal.aborted && !disposed) observationsError.value = t('conservationDashboard.previewError')
  } finally { if (!controller.signal.aborted && !disposed) observationsLoading.value = false }
}
const loadPreview = async (origin: 'initial_registration' | 'subsequent_observation') => {
  if (!authorizedOfficer.value || disposed) return
  const rows = origin === 'initial_registration' ? registrationRows : fieldRows
  const loading = origin === 'initial_registration' ? registrationLoading : fieldLoading
  const error = origin === 'initial_registration' ? registrationError : fieldError
  const controller = new AbortController()
  previewControllers.get(origin)?.abort(); previewControllers.set(origin, controller)
  loading.value = true; error.value = ''; rows.value = []
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)])
  const found = new Map<string, ApiObservation>(), cursors = new Set<string>()
  let cursor: string | null = null
  try {
    // Scan only pending candidates in small pages; never call the full-history list.
    // A bounded incomplete scan is an error, never a false empty/success state.
    for (let page = 0; page < 20; page++) {
      const query = new URLSearchParams({ view: 'dashboard', origin_type: origin, status: 'Pending Review', limit: '10' })
      if (cursor) query.set('cursor', cursor)
      const response = await fetch('/api/observations?' + query, { signal })
      const body = await response.json()
      signal.throwIfAborted()
      const pagination = readQueuePage(body.page)
      if (!response.ok || !pagination || !Array.isArray(body.observations) || body.observations.length > 10 ||
          body.observations.some((row: ApiObservation) => !row || row.origin_type !== origin || row.status !== 'Pending Review')) throw Error()
      if (controller.signal.aborted || disposed) return
      for (const row of body.observations as ApiObservation[]) {
        if (previewReviewEligible(row)) found.set(String(row.id), row)
        if (found.size === 5) break
      }
      if (found.size === 5 || !pagination.hasMore) {
        rows.value = [...found.values()]; return
      }
      if (!pagination.cursor || cursors.has(pagination.cursor)) throw Error()
      cursor = pagination.cursor; cursors.add(cursor)
    }
    throw Error()
  } catch {
    if (!controller.signal.aborted && !disposed) error.value = t('conservationDashboard.previewError')
  } finally {
    if (!controller.signal.aborted && !disposed) {
      loading.value = false
      observations.value = [...registrationRows.value, ...fieldRows.value]
    }
  }
}
const loadRegistrations = () => loadPreview('initial_registration')
const loadFieldObservations = () => loadPreview('subsequent_observation')
const loadPlants = async () => {
  plantsLoading.value = true
  plantsError.value = ''
  try {
    plants.value = await loadJson<ApiPlant>('/api/plants', 'plants')
  } catch (error) {
    plants.value = []
    plantsError.value = error instanceof Error ? error.message : 'Plant records unavailable.'
  } finally {
    plantsLoading.value = false
  }
}
const loadSpecies = async () => {
  speciesLoading.value = true
  speciesError.value = ''
  try {
    species.value = await loadJson<ApiSpecies>('/api/species?scope=scientific', 'species')
  } catch (error) {
    species.value = []
    speciesError.value = error instanceof Error ? error.message : 'Species data unavailable.'
  } finally {
    speciesLoading.value = false
  }
}
const loadAlerts = async () => {
  if (!authorizedOfficer.value || disposed) return
  const sequence = ++alertsSequence
  alertsController?.abort()
  const controller = new AbortController()
  alertsController = controller
  const accountId = session.value.user?.id
  if (!alertsLoaded.value) alertsLoading.value = true
  alertsError.value = ''
  try {
    const result = await loadCanonicalAlertQueue(controller.signal)
    if (controller.signal.aborted || disposed || sequence !== alertsSequence || accountId !== session.value.user?.id || !authorizedOfficer.value) return
    alerts.value = result.alerts
    alertsLoaded.value = true
    void loadDashboardAlertEvidence(result.alerts)
  } catch {
    if (controller.signal.aborted || disposed || sequence !== alertsSequence || accountId !== session.value.user?.id) return
    alertsError.value = alertText('Unable to retrieve threat alerts.')
  } finally {
    if (!controller.signal.aborted && sequence === alertsSequence && !disposed) alertsLoading.value = false
  }
}

const alertSignature = (alert: CanonicalThreatAlert) => [alert.id, alert.deviceId, alert.readingId, alert.metric, alert.value, alert.detectedAt].join('|')
const recentAlertRows = (rows: CanonicalThreatAlert[]) => [...rows]
  .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id))
  .slice(0, 3)
function clearDashboardAlertEvidence() {
  for (const controller of alertContextControllers.values()) controller.abort()
  alertContextControllers.clear()
  cameraEvidenceController?.abort(); cameraEvidenceController = null; cameraEvidenceGeneration++; cameraEvidenceRequestKey = ''
  alertEvidenceSessionGeneration++
  dashboardAlertEvidence.value = {}
}
async function loadDashboardAlertEvidence(rows: CanonicalThreatAlert[]) {
  if (!authorizedOfficer.value || disposed) return
  const sessionGeneration = alertEvidenceSessionGeneration
  const targets = recentAlertRows(rows), signatures = new Map(targets.map(alert => [alert.id, alertSignature(alert)]))
  for (const [id, controller] of alertContextControllers) {
    if (!signatures.has(id) || dashboardAlertEvidence.value[id]?.signature !== signatures.get(id)) { controller.abort(); alertContextControllers.delete(id) }
  }
  const nextEvidence: Record<string, DashboardAlertEvidence> = {}
  for (const alert of targets) {
    const prior = dashboardAlertEvidence.value[alert.id]
    if (prior?.signature === alertSignature(alert) && prior.state === 'ready') nextEvidence[alert.id] = prior
    else if (prior?.signature === alertSignature(alert) && prior.state === 'loading') nextEvidence[alert.id] = prior
    else nextEvidence[alert.id] = { signature: alertSignature(alert), state: 'loading' }
  }
  dashboardAlertEvidence.value = nextEvidence
  const accountId = session.value.user?.id
  const stillCurrent = (id: string, signature: string) => !disposed && alertEvidenceSessionGeneration === sessionGeneration && authorizedOfficer.value && accountId === session.value.user?.id && signatures.get(id) === signature && dashboardAlertEvidence.value[id]?.signature === signature
  const store = (id: string, signature: string, result: Omit<DashboardAlertEvidence, 'signature'>) => {
    if (!stillCurrent(id, signature)) return
    dashboardAlertEvidence.value = { ...dashboardAlertEvidence.value, [id]: { signature, ...result } }
  }
  await Promise.all(targets.filter(alert => alertSource(alert) === 'Sensor' && dashboardAlertEvidence.value[alert.id]?.state === 'loading' && !alertContextControllers.has(alert.id)).map(async alert => {
    const signature = signatures.get(alert.id)!, controller = new AbortController()
    alertContextControllers.set(alert.id, controller)
    try {
      const context = await loadAlertContext(alert, controller.signal)
      store(alert.id, signature, { state: 'ready', context })
    } catch {
      store(alert.id, signature, { state: 'unavailable' })
    } finally {
      if (alertContextControllers.get(alert.id) === controller) alertContextControllers.delete(alert.id)
    }
  }))
  const cameras = targets.filter(alert => alertSource(alert) === 'Camera' && dashboardAlertEvidence.value[alert.id]?.state === 'loading')
  const cameraRequestKey = cameras.map(alert => `${alert.id}:${signatures.get(alert.id)}`).sort().join('|')
  if (cameraEvidenceController && cameraEvidenceRequestKey !== cameraRequestKey) {
    cameraEvidenceController.abort(); cameraEvidenceController = null; cameraEvidenceGeneration++; cameraEvidenceRequestKey = ''
  }
  if (!cameras.length && cameraEvidenceController) {
    cameraEvidenceController.abort(); cameraEvidenceController = null; cameraEvidenceGeneration++; cameraEvidenceRequestKey = ''
  }
  if (cameras.length && !cameraEvidenceController) {
    cameraEvidenceRequestKey = cameraRequestKey
    const generation = ++cameraEvidenceGeneration, controller = new AbortController(); cameraEvidenceController = controller
    try {
      const result = await loadCameraEvents(controller.signal)
      if (generation !== cameraEvidenceGeneration || controller.signal.aborted) return
      for (const alert of cameras) {
        const signature = signatures.get(alert.id)!
        const event = result.events.find(item => item.eventId === alert.id && item.cameraId === alert.cameraId && item.eventType === alert.metric && Date.parse(item.detectedAt) === Date.parse(alert.detectedAt)) ?? null
        store(alert.id, signature, { state: 'ready', cameraEvent: event })
      }
    } catch {
      if (generation === cameraEvidenceGeneration && !controller.signal.aborted) for (const alert of cameras) store(alert.id, signatures.get(alert.id)!, { state: 'unavailable' })
    } finally { if (cameraEvidenceController === controller) { cameraEvidenceController = null; cameraEvidenceRequestKey = '' } }
  }
}

onMounted(() => {
  alertsRefresh = createThreatAlertRefresh({ refresh: loadAlerts, ready: () => authorizedOfficer.value && !disposed, window, document })
  if (authorizedOfficer.value) {
    void Promise.allSettled([loadObservations(), loadRegistrations(), loadFieldObservations(), loadPlants(), loadSpecies()])
    alertsRefresh.start()
  }
})

onBeforeUnmount(() => {
  alertsRefresh?.stop()
  alertsController?.abort()
  alertsSequence++
  clearDashboardAlertEvidence()
})

watch(() => [authorizedOfficer.value, session.value.user?.id] as const, ([ready, id], previous) => {
  if (!ready || id !== previous?.[1]) {
    alertsRefresh?.stop()
    alertsController?.abort()
    alertsSequence++
    alerts.value = []; alertsLoaded.value = false
    clearDashboardAlertEvidence()
    alertsLoading.value = true; alertsError.value = ''
    for (const controller of previewControllers.values()) controller.abort()
    registrationRows.value = []; fieldRows.value = []; observations.value = []; observationTotals.value = null
    registrationLoading.value = true; fieldLoading.value = true; observationsLoading.value = true
    registrationError.value = ''; fieldError.value = ''; observationsError.value = ''
  }
  if (ready) {
    void Promise.allSettled([loadObservations(), loadRegistrations(), loadFieldObservations(), loadPlants(), loadSpecies()])
    if (alertsRefresh) alertsRefresh.start()
    else void loadAlerts()
  }
})

const effectiveObservationStatus = (observation: ApiObservation) =>
  typeof observation.status === 'string' ? observation.status.trim() : ''
// Reuse the server's provenance classification; never infer origin from plant/status.
// Conflicting duplicate identities cannot safely belong to either preview.
const previewReviewEligible = (row: ApiObservation) => {
  if (!authorizedOfficer.value || row.status !== 'Pending Review') return false
  const status = effectiveObservationStatus(row)
  if (!reviewTransitions[status]?.length || !positiveRevision(row.revision)) return false
  const id = String(row.id)
  if (!/^(?:[1-9][0-9]{0,18}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(id) || !formatPlantId(row.plant_id)) return false
  if (typeof row.owner_subject !== 'string' || !row.owner_subject.trim()) return false
  const request = mapLinkedSpeciesRequest(row)
  const plantReview = row.species_id != null && Boolean(row.scientific_name?.trim()) && reviewEligible(session.value.user, session.value.pending, {
    revision: row.revision, owner: row.owner_subject, status,
    speciesId: row.species_id == null ? '' : String(row.species_id),
    scientificName: row.scientific_name || '', speciesRequest: request,
  })
  // The existing registration review also permits resolving its linked species
  // request first. Do not hide that actionable path behind the plant's gate.
  const speciesReview = observationOrigin(row.origin_type) === 'initial_registration' && positiveRevision(request?.reviewCycle) && positiveRevision(request?.contentRevision) && speciesRequestCanDecide(request) && Boolean(request?.requestedBy) &&
    request?.requestedBy !== `staff:${session.value.user?.id}`
  return plantReview || speciesReview
}
const classifiedPending = computed(() => {
  const byId = new Map<string, ApiObservation[]>()
  for (const row of [...registrationRows.value, ...fieldRows.value]) {
    const id = String(row.id); byId.set(id, [...(byId.get(id) || []), row])
  }
  return [...byId.values()].flatMap(rows => new Set(rows.map(row => observationOrigin(row.origin_type))).size === 1 ? [rows[0]!] : []).filter(previewReviewEligible)
})
const pendingRegistrations = computed(() => classifiedPending.value.filter(row => observationOrigin(row.origin_type) === 'initial_registration').slice(0, 5))
const pendingFieldObservations = computed(() => classifiedPending.value.filter(row => observationOrigin(row.origin_type) === 'subsequent_observation').slice(0, 5))

const speciesById = computed(
  () => new Map(species.value.map((item) => [String(item.species_id), item])),
)
const speciesForPlant = (plant: ApiPlant) => speciesById.value.get(String(plant.species_id))
const recentAlerts = computed(() => recentAlertRows(alerts.value))
const alertTypeText = (alert: CanonicalThreatAlert) => alertText(alertTypeLabel(alert.metric))
const alertStatusText = (alert: CanonicalThreatAlert) => alertText(alertStatusLabel(alert.status))
const alertSourceText = (alert: CanonicalThreatAlert) => alertText(alertSource(alert))
const alertIconType = (alert: CanonicalThreatAlert) => {
  if (alertSource(alert) === 'Sensor') return ({ temperature: 'temperature', humidity: 'humidity', soilMoisture: 'soil', rainfall: 'rainfall', movement: 'movement', sound: 'sound' } as Record<string, string>)[alert.metric] || 'general'
  if (alertSource(alert) === 'Camera') return ({ possible_plant_contact: 'camera', human_detected: 'human', animal_detected: 'animal', suspicious_movement: 'movement' } as Record<string, string>)[alert.metric] || 'camera'
  return 'general'
}
const alertBadgeStyle = (alert: CanonicalThreatAlert) => threatAlertBadgeStyle(alert.status)
const alertCanOpen = (alert: CanonicalThreatAlert) => /^[A-Za-z0-9_-]{1,200}$/.test(alert.id)
const overviewAlertPlant = (alert: CanonicalThreatAlert) => {
  const evidence = dashboardAlertEvidence.value[alert.id]
  const eventPlant = evidence?.context?.plant_at_detection
  const cameraPlant = evidence?.cameraEvent?.plantId
  const currentPlant = evidence?.context?.current_assignment
  const plantId = eventPlant?.state === 'verified' ? eventPlant.plant_id : cameraPlant || (currentPlant?.state === 'verified' ? currentPlant.plant_id : null)
  if (!plantId) return { text: t('conservationDashboard.alertCard.plantUnavailable'), isCurrent: false }
  const plant = plants.value.find(item => String(item.plant_id) === String(plantId))
  const name = plant ? speciesForPlant(plant)?.scientific_name?.trim() : ''
  return { text: `${formatPlantId(plantId) || t('conservationDashboard.alertCard.plantUnavailable')}${name ? ` · ${alertText(name)}` : ''}`, isCurrent: eventPlant?.state !== 'verified' && !cameraPlant && currentPlant?.state === 'verified' }
}
const overviewAlertTitle = (alert: CanonicalThreatAlert) => {
  const evidence = dashboardAlertEvidence.value[alert.id]
  if (alertSource(alert) === 'Camera') {
    if (evidence?.cameraEvent?.title) return alertText(evidence.cameraEvent.title)
    const cameraTitleKeys: Record<string, string> = { possible_plant_contact: 'possiblePlantContact', human_detected: 'humanActivity', animal_detected: 'animalActivity', suspicious_movement: 'suspiciousMovement' }
    const key = cameraTitleKeys[alert.metric]
    return key ? t(`conservationDashboard.alertCard.titles.${key}`) : alertTypeText(alert)
  }
  if (alertSource(alert) === 'Sensor') {
    const direction = evidence?.context?.historical_threshold?.direction
    const metricKeys: Record<string, string> = { temperature: 'temperature', humidity: 'humidity', soilMoisture: 'soilMoisture', rainfall: 'rainfall', movement: 'movement', sound: 'sound' }
    const metric = metricKeys[alert.metric]
    const key = metric && direction ? `${direction}${metric[0]!.toUpperCase()}${metric.slice(1)}` : `${metric}Threshold`
    if (metric && te(`conservationDashboard.alertCard.titles.${key}`)) return t(`conservationDashboard.alertCard.titles.${key}`)
  }
  return alertTypeText(alert)
}
const overviewAlertDetail = (alert: CanonicalThreatAlert) => {
  const evidence = dashboardAlertEvidence.value[alert.id]
  const unit = sensorUnit(alert.metric)
  const value = `${alert.value}${unit ? ` ${unit}` : ''}`
  if (alertSource(alert) === 'Camera') return evidence?.cameraEvent?.description ? alertText(evidence.cameraEvent.description) : t('conservationDashboard.alertCard.details.unavailable')
  const threshold = evidence?.context?.historical_threshold
  if (threshold?.direction === 'high') return t('conservationDashboard.alertCard.details.aboveMaximum', { value, limit: `${threshold.limit}${unit ? ` ${unit}` : ''}` })
  if (threshold?.direction === 'low') return t('conservationDashboard.alertCard.details.belowMinimum', { value, limit: `${threshold.limit}${unit ? ` ${unit}` : ''}` })
  return t('conservationDashboard.alertCard.details.recordedValue', { value })
}
const overviewAlertThresholdExceeded = (alert: CanonicalThreatAlert) => {
  const direction = dashboardAlertEvidence.value[alert.id]?.context?.historical_threshold?.direction
  return alertSource(alert) === 'Sensor' && (direction === 'high' || direction === 'low')
}
const mapPlants = computed(() =>
  plants.value.flatMap((plant) => {
    // This overview represents approved biodiversity records, not the review queue.
    if (normalizeStatus(plant.rbac_status) !== 'approved') return []
    const id = formatPlantId(plant.plant_id)
    if (
      plant.latitude === null ||
      plant.latitude === undefined ||
      plant.longitude === null ||
      plant.longitude === undefined ||
      String(plant.latitude).trim() === '' ||
      String(plant.longitude).trim() === ''
    )
      return []
    const latitude = Number(plant.latitude)
    const longitude = Number(plant.longitude)
    if (
      !id ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    )
      return []
    return [
      {
        id,
        latitude,
        longitude,
        scientificName: speciesForPlant(plant)?.scientific_name || '',
        commonName: speciesForPlant(plant)?.common_name || '',
      },
    ]
  }),
)

const normalizeStatus = (value?: string | null) =>
  (typeof value === 'string' ? value : '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
const endangeredSpeciesCount = computed(
  () =>
    species.value.filter((item) => normalizeStatus(item.conservation_status).includes('endangered'))
      .length,
)
const activeAlertCount = computed(
  () => alerts.value.filter((alert) => ['new', 'reviewing'].includes(normalizeStatus(alert.status))).length,
)
const summaries = computed(() => [
  [
    'plantSpecies',
    speciesLoading.value ? '—' : speciesError.value ? '—' : species.value.length,
    'digitalKnowledgeBase',
  ],
  [
    'plantRecords',
    plantsLoading.value ? '—' : plantsError.value ? '—' : plants.value.length,
    'registeredPlants',
  ],
  [
    'pendingReviews',
    observationsLoading.value
      ? '—'
      : observationsError.value
        ? '—'
        : observationTotals.value?.pending ?? '?',
    'requiresVerification',
  ],
  [
    'endangeredSpecies',
    speciesLoading.value ? '—' : speciesError.value ? '—' : endangeredSpeciesCount.value,
    'underMonitoring',
  ],
  [
    'activeThreats',
    alertsLoading.value || !alertsLoaded.value ? '—' : activeAlertCount.value,
    'needsAttention',
  ],
  [
    'recentObservations',
    observationsLoading.value ? '—' : observationsError.value ? '—' : observationTotals.value?.total ?? '?',
    'currentDataset',
  ],
])

// Overview presentation order only; the existing summaries/count sources stay intact.
const summaryOrder = ['pendingReviews', 'activeThreats', 'endangeredSpecies', 'plantRecords', 'plantSpecies', 'recentObservations']
const orderedSummaries = computed(() => summaryOrder.map(key => summaries.value.find(card => card[0] === key)!))
const statusShare = (status: string) => species.value.length ? statusCount(status) / species.value.length * 100 : 0

const biodiversityStatuses = [
  'Not Assessed',
  'Least Concern',
  'Near Threatened',
  'Vulnerable',
  'Endangered',
  'Critically Endangered',
]
const statusCount = (status: string) =>
  species.value.filter(
    (item) => normalizeStatus(item.conservation_status) === normalizeStatus(status),
  ).length
const dataLabel = (value: string) => {
  const key = `dashboardValues.${value.toLowerCase().replace(/[^a-z0-9]+/g, '')}`
  return te(key) ? t(key) : value
}
// Numeric legacy IDs retain their presentation; current UUIDs stay intact, including in links.
const observationId = (item: ApiObservation) => formatObservationId(item.id) || String(item.id)
const statusClass = (status?: string | null) => normalizeStatus(status).replaceAll(' ', '-')
const plantId = (value: string | number) => formatPlantId(value) || '—'
const previewSpeciesName = (item: ApiObservation) => item.scientific_name || mapLinkedSpeciesRequest(item)?.scientificName || speciesName(item)
const speciesName = (item?: { scientific_name?: string | null; common_name?: string | null }) =>
  item?.scientific_name || item?.common_name || t('conservationDashboard.speciesUnavailable')
</script>

<template>
  <div class="dashboard-overview">
  <section class="page-intro">
    <div>
      <p class="page-kicker">{{ t('conservationDashboard.overview') }}</p>
      <h2>{{ t('conservationDashboard.greeting') }}</h2>
    </div>
    <time :datetime="currentDateKey">{{ currentDate }}</time>
  </section>

  <section class="summary-grid">
    <article v-for="card in orderedSummaries" :key="String(card[0])" class="summary-card" :data-metric="String(card[0])">
      <p>{{ t(`conservationDashboard.summary.${card[0]}`) }}</p>
      <strong>{{ card[1] }}</strong>
    </article>
  </section>

  <div class="two-column dashboard-lower">
<section class="panel conservation-status-panel">
      <header class="panel-header">
        <div>
          <p class="section-kicker">{{ t('conservationDashboard.speciesHealth') }}</p>
          <h2>{{ t('conservationDashboard.speciesConservationStatus') }}</h2>
        </div>
      </header>
      <p v-if="speciesLoading" class="dashboard-state">Loading species...</p>
      <p v-else-if="speciesError" class="dashboard-state error-state">{{ speciesError }}</p>
      <template v-else>
        <p class="status-scope">{{ t('conservationDashboard.speciesStatusScope', { total: species.length }) }}</p>
        <div v-for="itemStatus in biodiversityStatuses" :key="itemStatus" class="conservation-row" :data-status="statusClass(itemStatus)">
          <div class="overview-row"><span>{{ dataLabel(itemStatus) }}</span><strong>{{ statusCount(itemStatus) }}</strong></div>
          <div class="status-track" role="img" :aria-label="t('conservationDashboard.speciesStatusShare', { status: dataLabel(itemStatus), count: statusCount(itemStatus), total: species.length })"><span class="status-fill" :style="{ width: statusShare(itemStatus) + '%' }"></span></div>
        </div>
      </template>
    </section>

<section class="panel">
      <header class="panel-header">
        <div>
          <p class="section-kicker">{{ t('conservationDashboard.attentionRequired') }}</p>
          <h2>{{ t('conservationDashboard.conservationAlerts') }}</h2>
        </div>
        <button class="secondary-button" @click="go('conservation-alerts')">
          {{ t('conservationDashboard.viewAllAlerts') }} →
        </button>
      </header>
      <p v-if="alertsLoading && !alertsLoaded" class="dashboard-state">{{ alertText('Loading threat alerts...') }}</p>
      <p v-else-if="alertsError && (!alertsLoaded || !recentAlerts.length)" class="dashboard-state error-state" role="status">{{ alertsError }}</p>
      <p v-else-if="!recentAlerts.length" class="dashboard-state">{{ alertText('No threat alerts found.') }}</p>
      <p v-if="alertsError && alertsLoaded && recentAlerts.length" class="dashboard-state error-state" role="status">{{ alertsError }}</p>
      <button
        v-for="alert in recentAlerts"
        :key="alert.id"
        class="alert-preview"
        type="button"
        :disabled="!alertCanOpen(alert)"
        :aria-label="`${overviewAlertTitle(alert)} · ${overviewAlertPlant(alert).text} · ${overviewAlertDetail(alert)} · ${dt(alert.detectedAt)} · ${alertStatusText(alert)}`"
        @click="alertCanOpen(alert) && go('conservation-alerts', { alert: alert.id })"
      >
        <span class="alert-preview-icon" :class="`alert-icon-${alertIconType(alert)}`" aria-hidden="true">
          <svg v-if="alertIconType(alert) === 'temperature'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 14.76V5a2 2 0 0 0-4 0v9.76a4 4 0 1 0 4 0Z"/><path d="M12 12v5"/></svg>
          <svg v-else-if="alertIconType(alert) === 'humidity'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3s-6.5 7.1-6.5 11.8a6.5 6.5 0 1 0 13 0C18.5 10.1 12 3 12 3Z"/></svg>
          <svg v-else-if="alertIconType(alert) === 'soil'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21v-9m0 3C5 15 4 10 4 5c5 0 8 3 8 8m0-2c0-5 4-8 8-8 0 5-1 10-8 10"/></svg>
          <svg v-else-if="alertIconType(alert) === 'rainfall'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 15h10a4 4 0 0 0 .4-8A6 6 0 0 0 6 8a3.5 3.5 0 0 0 1 7Z"/><path d="m8 18-1 2m6-2-1 2m6-2-1 2"/></svg>
          <svg v-else-if="alertIconType(alert) === 'movement'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="15.5" cy="4.5" r="2"/><path d="m12 22 2-6-3-3 2-4 4 3 3 1M11 13l-4 2-3 4m7-11-3 3-4 1"/></svg>
          <svg v-else-if="alertIconType(alert) === 'camera'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h3l1.5-2h7L17 7h3v12H4z"/><circle cx="12" cy="13" r="3.5"/></svg>
          <svg v-else-if="alertIconType(alert) === 'animal'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13c-2.3 1.2-3.5 3-3 5 .4 1.5 2.1 2 4 1.2 2-.9 4-.9 6 0 1.9.8 3.6.3 4-1.2.5-2-0.7-3.8-3-5-1.4-.7-2.3-2-4-2s-2.6 1.3-4 2Z"/><ellipse cx="5.5" cy="8" rx="1.7" ry="2.3"/><ellipse cx="10" cy="5.5" rx="1.7" ry="2.3"/><ellipse cx="14" cy="5.5" rx="1.7" ry="2.3"/><ellipse cx="18.5" cy="8" rx="1.7" ry="2.3"/></svg>
          <svg v-else-if="alertIconType(alert) === 'human'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="7" r="3"/><path d="M3 20v-1a6 6 0 0 1 12 0v1M17 11a3 3 0 1 0 0-6m1 9a5 5 0 0 1 3 4v1"/></svg>
          <svg v-else-if="alertIconType(alert) === 'sound'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10v4h4l5 4V6l-5 4H3Z"/><path d="M16 9a5 5 0 0 1 0 6m3-9a9 9 0 0 1 0 12"/></svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 22 20H2L12 3Z"/><path d="M12 9v5m0 3h.01"/></svg>
        </span>
        <div class="alert-preview-copy">
          <strong>{{ overviewAlertTitle(alert) }}</strong>
          <small><span v-if="overviewAlertPlant(alert).isCurrent">{{ t('conservationDashboard.alertCard.currentAssignment') }}: </span>{{ overviewAlertPlant(alert).text }} · {{ alertSourceText(alert) }}</small>
          <small class="alert-preview-detail" :class="{ 'threshold-exceeded': overviewAlertThresholdExceeded(alert) }">{{ overviewAlertDetail(alert) }}</small>
          <small>{{ dt(alert.detectedAt) }}</small>
        </div>
        <span class="badge alert-severity-badge" :style="alertBadgeStyle(alert)">{{
          alertStatusText(alert)
        }}</span>
      </button>
    </section>
  </div>

<section class="panel pending-review-panel">
      <header class="panel-header">
        <div>
          <p class="section-kicker">{{ t('conservationDashboard.requiresReview') }}</p>
          <h2>{{ t('conservationDashboard.pendingPlantRegistrations') }}</h2>
        </div>
        <button class="secondary-button" @click="go('conservation-reviews')">
          {{ t('conservationDashboard.viewAllSubmissions') }} →
        </button>
      </header>
      <p v-if="registrationLoading" class="dashboard-state">{{ t('conservationDashboard.loadingObservations') }}</p>
      <p v-else-if="registrationError" role="alert" class="dashboard-state error-state">
        {{ registrationError }} <button type="button" class="secondary-button" :disabled="!authorizedOfficer || registrationLoading" @click="loadRegistrations">{{ t('conservationText.retry') }}</button>
      </p>
      <p v-else-if="!pendingRegistrations.length" class="dashboard-state">
        {{ t('conservationDashboard.noPendingRegistrations') }}
      </p>
      <div v-else class="table-scroll officer-table-scroll overview-table-scroll" role="region" :aria-label="t('conservationDashboard.pendingPlantRegistrations')" tabindex="0">
        <table class="officer-data-table pending-review-table" role="table"><colgroup><col class="overview-plant"/><col class="overview-species"/><col class="overview-subject"/><col class="overview-status"/><col class="overview-actions"/></colgroup>
          <thead role="rowgroup">
            <tr role="row">
              <th scope="col" role="columnheader">{{ t('conservationDashboard.table.plantId') }}</th>
              <th scope="col" role="columnheader">{{ t('conservationDashboard.table.species') }}</th>
              <th scope="col" role="columnheader">{{ t('conservationDashboard.table.submittedAt') }}</th>
              <th scope="col" role="columnheader">{{ t('conservationDashboard.table.status') }}</th>
              <th scope="col" role="columnheader">{{ t('conservationDashboard.table.action') }}</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            <tr role="row" v-for="item in pendingRegistrations" :key="String(item.id)">
              <td role="cell"><span class="overview-cell-label" aria-hidden="true">{{ t('conservationDashboard.table.plantId') }}</span>{{ plantId(item.plant_id) }}</td>
              <td role="cell"><span class="overview-cell-label" aria-hidden="true">{{ t('conservationDashboard.table.species') }}</span>
                <em>{{ previewSpeciesName(item) }}</em>
              </td>
              <td role="cell"><span class="overview-cell-label" aria-hidden="true">{{ t('conservationDashboard.table.submittedAt') }}</span><time>{{ dt(typeof item.created_at === 'string' ? item.created_at : null) }}</time></td>
              <td role="cell"><span class="overview-cell-label" aria-hidden="true">{{ t('conservationDashboard.table.status') }}</span>
                <span class="badge" :class="statusClass(effectiveObservationStatus(item))">{{
                  dataLabel(effectiveObservationStatus(item))
                }}</span>
              </td>
              <td role="cell"><span class="overview-cell-label" aria-hidden="true">{{ t('conservationDashboard.table.action') }}</span>
                <button
                  class="action-button"
                  @click="go('conservation-reviews', { review: observationId(item) })"
                >
                  {{ t('conservationDashboard.review') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

  <div class="two-column dashboard-lower">
<section class="panel pending-observations-panel">
      <header class="panel-header">
        <div>
          <p class="section-kicker">{{ t('conservationDashboard.fieldRecords') }}</p>
          <h2>{{ t('conservationDashboard.pendingObservations') }}</h2>
        </div>
        <button class="secondary-button" @click="go('conservation-observations')">{{ t('conservationDashboard.viewAllObservations') }}</button>
      </header>
      <p v-if="fieldLoading" class="dashboard-state">{{ t('conservationDashboard.loadingObservations') }}</p>
      <p v-else-if="fieldError" role="alert" class="dashboard-state error-state">{{ fieldError }} <button type="button" class="secondary-button" :disabled="!authorizedOfficer || fieldLoading" @click="loadFieldObservations">{{ t('conservationText.retry') }}</button></p>
      <p v-else-if="!pendingFieldObservations.length" class="dashboard-state">{{ t('conservationDashboard.noPendingObservations') }}</p>
      <div v-else class="table-scroll officer-table-scroll overview-table-scroll" role="region" :aria-label="t('conservationDashboard.pendingObservations')" tabindex="0">
        <table class="officer-data-table field-observations-table" role="table"><colgroup><col class="overview-observation"/><col class="overview-plant"/><col class="overview-species"/><col class="overview-subject"/><col class="overview-status"/><col class="overview-actions"/></colgroup>
          <thead role="rowgroup"><tr role="row">
            <th scope="col" role="columnheader">{{ t('conservationDashboard.table.observationId') }}</th>
            <th scope="col" role="columnheader">{{ t('conservationDashboard.table.plantId') }}</th>
            <th scope="col" role="columnheader">{{ t('conservationDashboard.table.species') }}</th>
            <th scope="col" role="columnheader">{{ t('conservationDashboard.table.submittedAt') }}</th>
            <th scope="col" role="columnheader">{{ t('conservationDashboard.table.status') }}</th>
            <th scope="col" role="columnheader">{{ t('conservationDashboard.table.action') }}</th>
          </tr></thead>
          <tbody role="rowgroup"><tr v-for="item in pendingFieldObservations" :key="String(item.id)" role="row">
            <td role="cell"><span class="overview-cell-label" aria-hidden="true">{{ t('conservationDashboard.table.observationId') }}</span><strong><MonitoringIdentifier :value="String(item.id)" :labels="observationDisplayLabels" /></strong></td>
            <td role="cell"><span class="overview-cell-label" aria-hidden="true">{{ t('conservationDashboard.table.plantId') }}</span>{{ plantId(item.plant_id) }}</td>
            <td role="cell"><span class="overview-cell-label" aria-hidden="true">{{ t('conservationDashboard.table.species') }}</span><em>{{ previewSpeciesName(item) }}</em></td>
            <td role="cell"><span class="overview-cell-label" aria-hidden="true">{{ t('conservationDashboard.table.submittedAt') }}</span><time>{{ dt(typeof item.created_at === 'string' ? item.created_at : null) }}</time></td>
            <td role="cell"><span class="overview-cell-label" aria-hidden="true">{{ t('conservationDashboard.table.status') }}</span><span class="badge" :class="statusClass(effectiveObservationStatus(item))">{{ dataLabel(effectiveObservationStatus(item)) }}</span></td>
            <td role="cell"><span class="overview-cell-label" aria-hidden="true">{{ t('conservationDashboard.table.action') }}</span><button class="action-button" @click="go('conservation-observations', { observation: observationId(item) })">{{ t('conservationDashboard.viewObservations') }}</button></td>
          </tr></tbody>
        </table>
      </div>
    </section>

<section class="panel">
      <header class="panel-header">
        <div>
          <p class="section-kicker">{{ t('conservationDashboard.parkCoverage') }}</p>
          <h2>{{ t('conservationDashboard.speciesDistribution') }}</h2>
        </div>
        <button class="secondary-button" @click="go('conservation-map')">
          {{ t('conservationDashboard.openFullMap') }} →
        </button>
      </header>
      <p v-if="plantsLoading" class="dashboard-state">Loading map records...</p>
      <p v-else-if="plantsError" class="dashboard-state error-state">{{ plantsError }}</p>
      <BiodiversityMapPreview v-else :plants="mapPlants" />
    </section>
  </div>






  <section class="panel">
    <header class="panel-header">
      <div>
        <p class="section-kicker">{{ t('conservationDashboard.shortcuts') }}</p>
        <h2>{{ t('conservationDashboard.quickActions') }}</h2>
      </div>
    </header>
    <div class="quick-grid">
      <button @click="go('conservation-species', { action: 'add' })">
        <svg class="preview-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span
          ><strong>{{ t('conservationDashboard.actions.addSpecies') }}</strong
          ><small>{{ t('conservationDashboard.actions.createSpecies') }}</small></span
        >
      </button>
      <button @click="go('conservation-reviews')">
        <svg class="preview-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg><span
          ><strong>{{ t('conservationDashboard.actions.reviewObservations') }}</strong
          ><small>{{ t('conservationDashboard.actions.verifySubmissions') }}</small></span
        >
      </button>
      <button @click="go('conservation-observations')">
        <svg class="preview-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg><span
          ><strong>{{ t('conservationDashboard.actions.searchObservations') }}</strong
          ><small>{{ t('conservationDashboard.actions.findRecords') }}</small></span
        >
      </button>
      <button @click="go('conservation-reports')">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="lucide lucide-file-text preview-icon"
          aria-hidden="true"
        >
          <path
            d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"
          />
          <path d="M14 2v5a1 1 0 0 0 1 1h5" />
          <path d="M10 9H8" />
          <path d="M16 13H8" />
          <path d="M16 17H8" /></svg
        ><span
          ><strong>{{ t('conservationDashboard.actions.generateReport') }}</strong
          ><small>{{ t('conservationDashboard.actions.createSummary') }}</small></span
        >
      </button>
    </div>
  </section>
  </div>
</template>

<style scoped>
.dashboard-overview { min-width: 0; max-width: 100%; container-type: inline-size; }
.dashboard-overview > *, .dashboard-overview .panel, .dashboard-overview .two-column > * { min-width: 0; max-width: 100%; box-sizing: border-box; }
.dashboard-overview .page-intro { margin-bottom: 24px; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: baseline; gap: 6px 24px; }
.dashboard-overview .page-intro > div { display: contents; }
.dashboard-overview .page-intro .page-kicker { grid-column: 1 / -1; grid-row: 1; }
.dashboard-overview .page-intro h2 { min-width: 0; grid-column: 1; grid-row: 2; margin: 0; }
.officer-layout.officer-layout.officer-layout .dashboard-overview .page-intro > time { grid-column: 2; grid-row: 2; max-width: 100%; font-size: 1.125rem; font-weight: 600; line-height: 1.4; color: #315b49; overflow-wrap: anywhere; }
@container (max-width: 800px) {
  .dashboard-overview .page-intro { grid-template-columns: minmax(0, 1fr); }
  .officer-layout.officer-layout.officer-layout .dashboard-overview .page-intro > time { grid-column: 1; grid-row: 3; }
}
.dashboard-overview .summary-grid { grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; margin-bottom: 8px; }
.dashboard-overview .summary-card { --summary-background: #edf2ee; --summary-ink: #315b49; min-width: 0; padding: 16px; border: 1px solid var(--summary-ink); border-radius: 12px; background: var(--summary-background); color: var(--summary-ink); box-shadow: none; display: grid; grid-template-rows: 1fr auto; gap: 6px; }
.dashboard-overview .summary-card[data-metric="pendingReviews"] { --summary-background: #e8f0f5; --summary-ink: #315d78; }
.dashboard-overview .summary-card[data-metric="activeThreats"] { --summary-background: #fbe8e5; --summary-ink: #a33f35; }
.dashboard-overview .summary-card[data-metric="endangeredSpecies"] { --summary-background: #fff1db; --summary-ink: #926119; }
.officer-layout.officer-layout.officer-layout .dashboard-overview .summary-card p { margin: 0; color: inherit; font-size: .875rem; line-height: 1.4; }
.officer-layout.officer-layout.officer-layout .dashboard-overview .summary-card strong { color: inherit; font-size: 1.875rem; line-height: 1.2; }
.dashboard-overview .two-column { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; }
.dashboard-overview .two-column > .panel { margin-top: 0; }
.dashboard-overview .two-column.overview-medium { grid-template-columns: minmax(0, 1fr) 18rem; align-items: start; gap: 24px; margin-top: 24px; }
@container (min-width: 1251px) { .dashboard-overview .two-column.overview-medium { align-items: stretch; } }
.status-scope { margin: 0 0 12px; color: #5b7065; font-size: .8125rem; }
.conservation-row { padding-block: 9px; border-bottom: 1px solid #edf0ed; }
.conservation-row:last-child { border-bottom: 0; }
.conservation-row .overview-row { padding: 0 0 6px; border: 0; }
.status-track { width: 100%; height: 7px; background: #edf2ee; border-radius: 4px; }
.status-fill { display: block; height: 100%; background: #287a53; border-radius: inherit; }
.conservation-row[data-status="not-assessed"] .status-fill { background: #8a9992; }
.conservation-row[data-status="near-threatened"] .status-fill { background: #71845b; }
.conservation-row[data-status="vulnerable"] .status-fill { background: #9a6814; }
.conservation-row[data-status="endangered"] .status-fill, .conservation-row[data-status="critically-endangered"] .status-fill { background: #b84938; }
.dashboard-overview .panel-header { flex-direction: row; flex-wrap: wrap; gap: 12px; align-items: center; }
.dashboard-overview .panel-header > div { min-width: 0; flex: 1 1 14rem; }
.dashboard-overview .panel-header > button { max-width: 100%; flex: 0 0 auto; }
.officer-layout.officer-layout.officer-layout .dashboard-overview .overview-table-scroll { min-width: 0; max-width: 100%; width: 100%; overflow-x: auto; overscroll-behavior-inline: contain; }
.officer-layout.officer-layout.officer-layout .dashboard-overview .pending-review-table { min-width: 0; width: 100%; table-layout: fixed; }
.officer-layout.officer-layout.officer-layout .dashboard-overview .field-observations-table { min-width: 0; width: 100%; table-layout: fixed; }
.officer-layout.officer-layout.officer-layout .dashboard-overview :is(.page-kicker, .section-kicker) { color: #426b56; }
.officer-layout.officer-layout.officer-layout .dashboard-overview .overview-table-scroll table :is(.action-button, .secondary-button) { height: auto; min-height: 44px; min-width: 44px; }
.officer-layout.officer-layout.officer-layout .dashboard-overview :is(button, a):focus-visible { outline: 3px solid #33745d; outline-offset: 2px; }
.officer-layout.officer-layout.officer-layout .dashboard-overview .overview-table-scroll:focus-visible { outline: 3px solid #33745d; outline-offset: -3px; }
.dashboard-overview .field-observations-table col.overview-observation { width: 20%; }
.dashboard-overview .field-observations-table col.overview-plant { width: 10%; }
.dashboard-overview .field-observations-table col.overview-species { width: 19%; }
.dashboard-overview .field-observations-table col.overview-subject { width: 18%; }
.dashboard-overview .field-observations-table col.overview-status { width: 17%; }
.dashboard-overview .field-observations-table col.overview-actions { width: 16%; }
.officer-layout.officer-layout.officer-layout .dashboard-overview :is(.pending-review-table, .field-observations-table) :is(th, td) { white-space: normal; overflow-wrap: anywhere; }
.officer-layout.officer-layout.officer-layout .dashboard-overview :is(.pending-review-table, .field-observations-table) :is(.badge, .action-button) { min-width: 0; max-width: 100%; width: fit-content; white-space: normal; overflow-wrap: anywhere; }
.officer-layout.officer-layout.officer-layout .dashboard-overview :is(.pending-review-table, .field-observations-table) .badge { white-space: nowrap; overflow-wrap: normal; max-width: none; flex-shrink: 0; }
.dashboard-overview :is(.pending-review-table, .field-observations-table) :deep(.monitoring-id-line) { min-width: 0; max-width: 100%; white-space: normal; }
.dashboard-overview :is(.pending-review-table, .field-observations-table) :deep(.monitoring-id-line > span:first-child) { min-width: 0; overflow-wrap: anywhere; }
.officer-layout.officer-layout.officer-layout .dashboard-overview :deep(.dashboard-map-empty) { color: #426b56; }
.officer-layout.officer-layout.officer-layout .dashboard-overview .pending-review-table col { width: 20%; }
.overview-cell-label { display: none; }
@container (max-width: 1250px) { .dashboard-overview .two-column.overview-medium { grid-template-columns: minmax(0, 1fr); } }
@container (max-width: 800px) {
  .officer-layout.officer-layout.officer-layout .dashboard-overview :is(.pending-review-table, .field-observations-table) { display: block; }
  .dashboard-overview :is(.pending-review-table, .field-observations-table) colgroup { display: none; }
  .dashboard-overview :is(.pending-review-table, .field-observations-table) thead { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .dashboard-overview :is(.pending-review-table, .field-observations-table) tbody { display: grid; gap: 12px; }
  .dashboard-overview :is(.pending-review-table, .field-observations-table) tbody tr { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px 16px; padding: 14px; border: 1px solid #dfe7df; border-radius: 10px; background: #fff; }
  .officer-layout.officer-layout.officer-layout .dashboard-overview :is(.pending-review-table, .field-observations-table) td { display: block; min-width: 0; padding: 0; border: 0; }
  .dashboard-overview :is(.pending-review-table, .field-observations-table) td:nth-child(1), .dashboard-overview :is(.pending-review-table, .field-observations-table) td:nth-child(4) { grid-column: 1 / -1; }
  .dashboard-overview :is(.pending-review-table, .field-observations-table) .overview-cell-label { display: block; margin-bottom: 4px; color: #426b56; font-size: var(--officer-small, .75rem); font-weight: 700; line-height: 1.5; }
}
.overview-observation, .overview-subject { width: 14rem; }
.overview-plant { width: 7rem; }
.overview-species { width: 24%; }
.overview-date { width: 12rem; }
.overview-status, .overview-actions { width: 1%; }
.dashboard-overview .overview-table-scroll :is(.badge, .action-button) { white-space: nowrap; }
.dashboard-overview :is(.pending-review-table, .field-observations-table) .badge.pending-review, .dashboard-overview :is(.pending-review-table, .field-observations-table) .badge.pending { background: #FEF9C3; color: #854D0E; }
.dashboard-overview :is(.pending-review-table, .field-observations-table) .badge.flagged { background: #f0eaf8; color: #69459a; }
.dashboard-overview .quick-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.dashboard-overview .quick-grid button { min-width: 0; padding: 12px; align-items: center; }
.dashboard-overview .quick-grid button > span { min-width: 0; overflow-wrap: anywhere; }
.dashboard-overview .quick-grid .preview-icon { width: 20px; height: 20px; flex: 0 0 20px; }
.dashboard-overview .alert-preview > div { min-width: 0; overflow-wrap: anywhere; }
@container (max-width: 1250px) { .dashboard-overview .summary-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@container (max-width: 1000px) {
  .dashboard-overview .two-column { grid-template-columns: minmax(0, 1fr); }
  .dashboard-overview .quick-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@container (max-width: 650px) { .dashboard-overview .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container (max-width: 400px) {
  .dashboard-overview .summary-grid, .dashboard-overview .quick-grid { grid-template-columns: minmax(0, 1fr); }
  .dashboard-overview .alert-preview { flex-wrap: wrap; }
}
.overview-row {
  padding: 12px 0;
  display: flex;
  justify-content: space-between;
  border-bottom: 1px solid #edf0ed;
  color: #5a7066;
  font-size: 11px;
  gap: 12px;
  align-items: center;
}
.overview-row > span { min-width: 0; }
.overview-row > strong { flex: 0 0 auto; font-variant-numeric: tabular-nums; }
.overview-row:last-child { border-bottom: 0; }
.dashboard-lower {
  margin-top: 24px;
}
.two-column + .panel {
  margin-top: 24px;
}
.dashboard-state {
  margin: 0;
  padding: 28px 18px;
  color: #5b7065;
  font-size: 11px;
  text-align: center;
}
.error-state {
  color: #a04d3f;
}
.record-link {
  color: #2f7459;
  text-decoration: none;
}
.record-link:hover {
  text-decoration: underline;
}
.alert-preview {
  width: 100%;
  min-width: 0;
  padding: 14px 0;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  border: 0;
  border-bottom: 1px solid #edf0ed;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.alert-preview:hover {
  background: #f6f9f6;
}
.alert-preview:focus-visible { outline: 3px solid #33745d; outline-offset: 2px; border-radius: 8px; }
.alert-preview-icon { width: 44px; height: 44px; flex: 0 0 44px; display: grid; place-items: center; border-radius: 12px; background: #e7eee9; color: #34775c; }
.alert-preview-icon svg { width: 20px; height: 20px; }
.alert-icon-temperature { background: #fbe9e1; color: #c65334; }
.alert-icon-humidity, .alert-icon-rainfall { background: #e7f1fb; color: #2874ad; }
.alert-icon-soil, .alert-icon-camera { background: #e8f0e8; color: #34775c; }
.alert-icon-movement, .alert-icon-human, .alert-icon-sound { background: #f0eafb; color: #674aa0; }
.alert-icon-animal { background: #fff2d9; color: #b47708; }
.alert-icon-general { background: #fde8e7; color: #bd3d36; }
.alert-preview-copy {
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  gap: 3px;
}
.alert-preview strong {
  color: #254c3e;
  font-size: 13px;
  line-height: 1.4;
}
.alert-preview small {
  color: #60756b;
  font-size: 11px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.alert-preview small.alert-preview-detail { color: #60756b; font-weight: 400; }
.officer-layout.officer-layout.officer-layout .alert-preview small.alert-preview-detail.threshold-exceeded { color: #b42318; font-weight: 700; }
.alert-severity-badge {
  width: auto;
  min-width: 48px;
  flex: 0 0 auto;
  align-self: flex-start;
  padding: 5px 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  line-height: 1;
  white-space: nowrap;
}
.quick-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
.quick-grid button {
  padding: 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid #dfe6df;
  border-radius: 12px;
  background: #f9fbf8;
  color: #39795f;
  cursor: pointer;
  text-align: left;
  font-size: 18px;
}
.quick-grid .preview-icon {
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
  overflow: visible;
}
.secondary-button,
.action-button,
.quick-grid button {
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease,
    color 0.2s ease,
    transform 0.15s ease,
    box-shadow 0.2s ease;
}
.secondary-button:hover {
  border-color: #9fc4ad;
  background: #f1f7f3;
  color: #2f6f56;
  box-shadow: 0 4px 12px rgba(42, 91, 70, 0.08);
  transform: translateY(-1px);
}
.action-button:hover {
  border-color: #9fc4ad;
  background: #edf6f0;
  color: #28664e;
  box-shadow: 0 3px 9px rgba(42, 91, 70, 0.08);
  transform: translateY(-1px);
}
.quick-grid button:hover {
  border-color: #b1cfbb;
  background: #f1f7f3;
  box-shadow: 0 6px 16px rgba(35, 70, 53, 0.09);
  transform: translateY(-2px);
}
.quick-grid button:hover strong {
  color: #244f3f;
}
.secondary-button:active,
.action-button:active,
.quick-grid button:active {
  transform: translateY(0) scale(0.99);
}
.secondary-button:focus-visible,
.action-button:focus-visible,
.quick-grid button:focus-visible,
.alert-preview:focus-visible {
  outline: 3px solid rgba(74, 145, 113, 0.3);
  outline-offset: 2px;
}
.quick-grid span {
  display: grid;
}
.quick-grid strong {
  color: #34594b;
  font-size: 11px;
}
.quick-grid small {
  margin-top: 3px;
  color: #8c9993;
  font-size: 8px;
}
@media (max-width: 800px) {
  .quick-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 450px) {
  .quick-grid {
    grid-template-columns: 1fr;
  }
}
@media (prefers-reduced-motion: reduce) {
  .secondary-button,
  .action-button,
  .quick-grid button {
    transition:
      background-color 0.2s ease,
      border-color 0.2s ease,
      color 0.2s ease,
      box-shadow 0.2s ease;
  }
  .secondary-button:hover,
  .action-button:hover,
  .quick-grid button:hover,
  .secondary-button:active,
  .action-button:active,
  .quick-grid button:active {
    transform: none;
  }
}
</style>

<style src="../../styles/officer-data-tables.css"></style>
