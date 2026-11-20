<script setup lang="ts">
import { vOfficerDropdown } from '../../components/conservation/officerDropdown'
import { computed, onMounted, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { sessionSnapshot, subscribeSession } from '../../services/auth'
import type { ThreatAlertPreview } from '../../data/threatAlertPreview'
import MonitoringIdentifier from '../../components/conservation/MonitoringIdentifier.vue'
import { monitoringLabels } from '../../utils/officerMonitoringDisplay'
import { threatAlertBadgeStyle } from '../../utils/workflowBadge'
import AppModal from '../../components/conservation/AppModal.vue'
import { useConservationText } from '../../composables/useConservationText'
import { createThreatAlertRefresh } from '../../services/threatAlertRefresh'
import { loadCameraEvents } from '../../services/cameraEvents'
import type { CameraEvent } from '../../types/cameraMonitoring'
import { SENSOR_METRICS, loadAlertContext, loadCurrentAssignments, assignedPlantLabel, unavailableAssignment, type AlertContext, type CurrentAssignment } from '../../services/alertEvidence'
import { alertSource, alertTypeLabel, alertStatusLabel, sensorUnit, sensorMetricLabel, threatAlertDate, threatAlertDay } from '../../utils/threatAlertDisplay'
import {
  loadCanonicalAlertQueue,
  saveAlertResponse,
  ThreatAlertApiError,
  type AlertResponseStatus,
  type CanonicalThreatAlert,
} from '../../services/threatAlerts'

const { ct, locale } = useConservationText()
const dt = (value?: string | null) => threatAlertDate(value, locale.value)
const route = useRoute()
const alerts = ref<CanonicalThreatAlert[]>([])
const selectedAlert = ref<CanonicalThreatAlert | null>(null)
const search = ref('')
const sourceFilter = ref('')
const status = ref('')
const date = ref('')
const isLoading = ref(true)
const errorMessage = ref('')
const responseStatus = ref<AlertResponseStatus>('Reviewing')
const responseNote = ref('')
const responseError = ref('')
const responseFeedback = ref('')
const isSavingResponse = ref(false)
const isVerifying = ref(false)
const isRefreshing = ref(false)
const verificationRequired = ref(false)
const inspectionRequired = ref(false)
const selectedUnavailable = ref(false)
const refreshError = ref('')
const queueMeta = ref({ alertsCapped: false, historyCapped: false })
const assignmentRows = ref<Record<string, CurrentAssignment>>({})
const assignmentError = ref(false)
const evidence = ref<AlertContext | null>(null)
const evidenceLoading = ref(false)
const evidenceError = ref(false)
const cameraEvent = ref<CameraEvent | null>(null)
const cameraLoading = ref(false)
const cameraError = ref('')
const cameraHasMore = ref(false)
const playbackError = ref(false)
const responseStaffNames = ref<Record<string, string>>({})
let cameraRequest = 0
let cameraController: AbortController | null = null
let assignmentRequest = 0, evidenceRequest = 0
let assignmentController: AbortController | null = null, evidenceController: AbortController | null = null
let responseNameRequest = 0
const assignmentFor = (alert: CanonicalThreatAlert) => assignmentRows.value[alert.id]?.device_id === alert.deviceId ? assignmentRows.value[alert.id]! : unavailableAssignment(alert.deviceId)
const selectedAssignment = computed(() => evidence.value && evidence.value.alert.id === selectedAlert.value?.id ? evidence.value.current_assignment : selectedAlert.value ? assignmentFor(selectedAlert.value) : undefined)
const eventReadings = computed(() => SENSOR_METRICS.filter(metric => metric !== 'sound' && evidence.value?.reading.state === 'verified' && Object.hasOwn(evidence.value.reading.values || {}, metric))
  .map(metric => ({ metric, value: evidence.value!.reading.values![metric]! })))
const uncertainAlerts = new Set<string>()
let disposed = false, selectionGeneration = 0, saveGeneration = 0
let listWork: Promise<void> | null = null
let loadController: AbortController | null = null
let poll: ReturnType<typeof createThreatAlertRefresh> | null = null
const eligible = () => { const s = sessionSnapshot(); return !s.pending && s.user?.role === 'Conservation Officer' && s.user.status === 'Active' && !s.user.mustChangePassword }
const accountKey = () => { const s = sessionSnapshot(); return `${s.user?.id}:${s.user?.role}:${s.user?.status}:${s.user?.mustChangePassword}:${s.pending}` }
const statusText = (value: string) => ct(alertStatusLabel(value))
const sourceText = (alert: CanonicalThreatAlert) => ct(alertSource(alert) === 'Unknown' ? 'Source unavailable' : alertSource(alert))
const typeText = (alert: CanonicalThreatAlert) => ct(alertTypeLabel(alert.metric))
const reviewBlocked = computed(() => isSavingResponse.value || isVerifying.value || isRefreshing.value || verificationRequired.value || inspectionRequired.value || selectedUnavailable.value || !eligible() || !['New','Reviewing'].includes(selectedAlert.value?.status || ''))
const primaryLabel = computed(() => responseStatus.value === 'Resolved' ? 'Resolve Alert' : selectedAlert.value?.status === 'New' ? 'Start Review' : 'Save Response')
function closeAlert() {
  resetEvidence()
  resetCameraEvidence()
  selectionGeneration++; isVerifying.value = false; selectedAlert.value = null; responseNote.value = ''; responseError.value = ''; responseFeedback.value = ''
  verificationRequired.value = false; inspectionRequired.value = false; selectedUnavailable.value = false
}
function clearPrivate() {
  assignmentRequest++; assignmentController?.abort(); assignmentController = null; assignmentRows.value = {}; assignmentError.value = false
  responseNameRequest++; responseStaffNames.value = {}
  generation++; saveGeneration++; loadController?.abort(); loadController = null; listWork = null; uncertainAlerts.clear(); closeAlert()
  alerts.value = []; hasLoaded.value = false; isLoading.value = false; isSavingResponse.value = false; isVerifying.value = false; isRefreshing.value = false
  refreshError.value = ''; errorMessage.value = ''; queueMeta.value = { alertsCapped: false, historyCapped: false }
}


// The preview module (including fixtures and local decisions) is never imported in production.
const developmentPreview = import.meta.env.DEV && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
const preview = shallowRef<ThreatAlertPreview | null>(null)
const session = ref(sessionSnapshot())
const hasLoaded = ref(false)
const isStartingPreview = ref(false)
let generation = 0
const authorizedPreview = computed(() => !session.value.pending && session.value.user?.role === 'Conservation Officer' && session.value.user.status === 'Active' && !session.value.user.mustChangePassword)
const canPreview = computed(() => developmentPreview && authorizedPreview.value && hasLoaded.value && !isLoading.value && !isRefreshing.value && !errorMessage.value && alerts.value.length === 0)
const previewActive = computed(() => canPreview.value && preview.value !== null)
const isSampleAlert = computed(() => !!selectedAlert.value && !!preview.value?.owns(selectedAlert.value))
const displayedAlerts = computed(() => previewActive.value ? preview.value!.rows : alerts.value)
const exitPreview = () => {
  if (isSampleAlert.value) {
    selectedAlert.value = null
    responseNote.value = ''
    responseError.value = ''
    responseFeedback.value = ''
  }
  preview.value = null
  isStartingPreview.value = false
  generation++
}
const startPreview = async () => {
  if (!import.meta.env.DEV || !canPreview.value || preview.value || isStartingPreview.value) return
  const token = generation
  isStartingPreview.value = true
  try {
    const { createThreatAlertPreview } = await import('../../data/threatAlertPreview')
    if (token === generation && canPreview.value) preview.value = createThreatAlertPreview()
  } finally {
    if (token === generation) isStartingPreview.value = false
  }
}
const unsubscribeSession = subscribeSession(() => {
  exitPreview(); clearPrivate(); session.value = sessionSnapshot(); poll?.stop()
  if (eligible() && !disposed) { isLoading.value = true; poll?.start() }
  else errorMessage.value = ct('Verify your session before viewing alerts.')
})
onBeforeUnmount(() => { disposed = true; exitPreview(); clearPrivate(); poll?.stop(); unsubscribeSession() })

const loadedAlerts = computed(() => [...displayedAlerts.value, ...(selectedAlert.value ? [selectedAlert.value] : [])])
const alertLabels = computed(() => monitoringLabels(loadedAlerts.value.map(item => item.id)))
const deviceLabels = computed(() => monitoringLabels(loadedAlerts.value.map(item => item.deviceId)))
const readingLabels = computed(() => monitoringLabels(loadedAlerts.value.map(item => item.readingId)))
const cameraLabels = computed(() => monitoringLabels(loadedAlerts.value.map(item => item.cameraId)))
const subjectLabels = computed(() => monitoringLabels(loadedAlerts.value.flatMap(item => item.responses.map(response => response.officerSubject))))
const responseStaffIds = computed(() => {
  const subjects = loadedAlerts.value.flatMap(item => item.responses.map(response => response.officerSubject))
  return [...new Set(subjects.filter(subject => subject.startsWith('staff:')).map(subject => subject.slice(6)))].slice(0, 100)
})
watch(() => responseStaffIds.value.join(','), async joined => {
  const token = ++responseNameRequest, ids = joined ? joined.split(',').filter(Boolean) : []
  responseStaffNames.value = {}
  if (!ids.length || !eligible()) return
  const actor = accountKey()
  try {
    const response = await fetch(`/api/conservation/submitter-names?ids=${encodeURIComponent(ids.join(','))}`, { credentials: 'same-origin', signal: AbortSignal.timeout(5000) })
    if (!response.ok) return
    const body = await response.json() as { names?: Record<string, unknown> }
    if (disposed || token !== responseNameRequest || !eligible() || actor !== accountKey() || !body.names || typeof body.names !== 'object' || Array.isArray(body.names)) return
    responseStaffNames.value = Object.fromEntries(Object.entries(body.names).filter(([id, name]) => ids.includes(id) && typeof name === 'string' && name.trim())) as Record<string, string>
  } catch { /* Keep the safe identifier display when a name cannot be resolved. */ }
})
const responseActorName = (subject: string) => subject.startsWith('staff:') ? responseStaffNames.value[subject.slice(6)]?.trim() || '' : ''
const formatAlertId = (id: string) => alertLabels.value.get(id) || id
const detectionDate = threatAlertDay
const recordingLabel = (event: CameraEvent) => ({ recording: 'Recording', processing: 'Processing', ready: 'Available', failed: 'Interrupted', unavailable: 'Unavailable' })[event.recordingStatus ?? 'unavailable']
const formatDuration = (seconds?: number) => seconds === undefined ? '\u2014' : `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
const openAlert = (alert: CanonicalThreatAlert) => {
  if (!eligible() || (!alerts.value.includes(alert) && !(import.meta.env.DEV && previewActive.value && preview.value?.owns(alert)))) return
  closeAlert(); selectedAlert.value = alert
  responseStatus.value = 'Reviewing'
  verificationRequired.value = uncertainAlerts.has(alert.id)
  void loadEvidence(alert)
}

function resetEvidence() {
  evidenceRequest++; evidenceController?.abort(); evidenceController = null
  evidence.value = null; evidenceLoading.value = false; evidenceError.value = false
}
function resetCameraEvidence() {
  cameraRequest++; cameraController?.abort(); cameraController = null
  cameraEvent.value = null; cameraLoading.value = false; cameraError.value = ''; cameraHasMore.value = false; playbackError.value = false
}
async function loadCameraEvidence(alert: CanonicalThreatAlert) {
  if (!eligible() || disposed || alertSource(alert) !== 'Camera' || preview.value?.owns(alert)) return
  cameraController?.abort()
  const request = ++cameraRequest, selection = selectionGeneration, account = accountKey()
  const controller = new AbortController(); cameraController = controller; cameraLoading.value = true; cameraError.value = ''
  const current = () => !disposed && eligible() && selection === selectionGeneration && request === cameraRequest && selectedAlert.value?.id === alert.id && account === accountKey()
  try {
    const result = await loadCameraEvents(controller.signal)
    if (!current()) return
    // Match the persisted event, camera and detection time; never use a neighbouring clip or the alert's file path.
    const match = result.events.find(event => event.eventId === alert.id && event.cameraId === alert.cameraId &&
      event.eventType === alert.metric && Date.parse(event.detectedAt) === Date.parse(alert.detectedAt)) ?? null
    if (match?.videoUrl !== cameraEvent.value?.videoUrl) playbackError.value = false
    cameraEvent.value = match; cameraHasMore.value = result.hasMore
  } catch (error) {
    if (current()) cameraError.value = error instanceof Error ? error.message : ct('Unable to retrieve camera events.')
  } finally { if (current()) { cameraLoading.value = false; cameraController = null } }
}
async function loadEvidence(alert: CanonicalThreatAlert) {
  resetEvidence()
  if (alertSource(alert) === 'Camera') { void loadCameraEvidence(alert); return }
  if (!eligible() || disposed || alertSource(alert) !== 'Sensor' || preview.value?.owns(alert)) return
  const request = evidenceRequest, token = generation, selection = selectionGeneration, account = accountKey()
  const controller = new AbortController(); evidenceController = controller; evidenceLoading.value = true
  const current = () => !disposed && eligible() && token === generation && selection === selectionGeneration && request === evidenceRequest && selectedAlert.value?.id === alert.id && account === accountKey()
  try {
    const result = await loadAlertContext(alert, controller.signal)
    if (current()) evidence.value = result
  } catch (error) {
    if (!current()) return
    if (error instanceof ThreatAlertApiError && [401,403].includes(error.status)) { clearPrivate(); poll?.stop(); errorMessage.value = ct('Verify your session before viewing alerts.') }
    else evidenceError.value = true
  } finally { if (current()) { evidenceLoading.value = false; evidenceController = null } }
}
async function refreshAssignments(rows: CanonicalThreatAlert[]) {
  if (!eligible() || disposed) return
  assignmentController?.abort()
  const request = ++assignmentRequest, token = generation, account = accountKey(), controller = new AbortController()
  assignmentController = controller
  const current = () => !disposed && eligible() && token === generation && request === assignmentRequest && account === accountKey()
  try {
    const result = await loadCurrentAssignments(rows, controller.signal)
    if (current()) { assignmentRows.value = result.assignments; assignmentError.value = result.partial }
  } catch (error) {
    if (!current()) return
    if (error instanceof ThreatAlertApiError && [401,403].includes(error.status)) { clearPrivate(); poll?.stop(); errorMessage.value = ct('Verify your session before viewing alerts.') }
    else { assignmentRows.value = {}; assignmentError.value = true }
  } finally { if (current()) assignmentController = null }
}

const selectedAlertId = () => {
  const queryValue = route.query.alert
  if (typeof queryValue !== 'string') return
  selectedAlert.value = null
  const alert = alerts.value.find((item) => item.id === queryValue)
  if (alert) openAlert(alert)
}

function applyQueue(result: Awaited<ReturnType<typeof loadCanonicalAlertQueue>>, inspectChanges = true) {
  alerts.value = result.alerts
  queueMeta.value = { alertsCapped: result.alertsCapped, historyCapped: result.historyCapped }
  void refreshAssignments(result.alerts)
  if (selectedAlert.value && !isSampleAlert.value) {
    const next = result.alerts.find(row => row.id === selectedAlert.value!.id)
    if (next) {
      if (inspectChanges && JSON.stringify(next) !== JSON.stringify(selectedAlert.value)) inspectionRequired.value = true
      selectedAlert.value = next; selectedUnavailable.value = false
    } else { selectedUnavailable.value = true; inspectionRequired.value = true }
    if (next) void loadEvidence(next)
  }
}
function loadAlerts(background = false): Promise<void> {
  if (disposed || !eligible() || isSavingResponse.value || isVerifying.value) return Promise.resolve()
  if (listWork) return listWork
  exitPreview()
  const token = generation, account = accountKey()
  const controller = new AbortController()
  loadController = controller
  const current = () => !disposed && token === generation && account === accountKey() && eligible()
  isRefreshing.value = true
  if (!background) isLoading.value = true
  errorMessage.value = ''; refreshError.value = ''
  const work = (async () => {
    try {
      const result = await loadCanonicalAlertQueue(controller.signal)
      if (!current()) return
      applyQueue(result); hasLoaded.value = true
      if (!background) selectedAlertId()
    } catch (error) {
      if (!current()) return
      if (error instanceof ThreatAlertApiError && [401,403].includes(error.status)) {
        clearPrivate(); poll?.stop(); errorMessage.value = ct('Verify your session before viewing alerts.')
      } else if (hasLoaded.value) refreshError.value = ct('Alerts could not be refreshed. Previously loaded alerts remain visible.')
      else { alerts.value = []; errorMessage.value = ct('Unable to retrieve threat alerts.') }
    } finally { if (current()) { isLoading.value = false; isRefreshing.value = false; loadController = null } }
  })()
  listWork = work
  void work.finally(() => { if (listWork === work) listWork = null })
  return work
}
onMounted(() => {
  poll = createThreatAlertRefresh({ refresh: () => loadAlerts(hasLoaded.value), ready: () => eligible() && !isSavingResponse.value && !isVerifying.value, window, document })
  if (eligible()) poll.start()
  else { isLoading.value = false; errorMessage.value = ct('Verify your session before viewing alerts.') }
})
watch(() => [route.query.alert, route.query.device, route.query.reading], () => { closeAlert(); selectedAlertId() })

const statusOptions = ['New', 'Reviewing', 'Resolved']
const filteredAlerts = computed(() => displayedAlerts.value.filter(alert => {
  const searchable = `${alert.id} ${alert.metric} ${typeText(alert)} ${alert.value} ${alert.deviceId} ${alert.readingId ?? ''} ${alert.cameraId ?? ''} ${alert.status} ${statusText(alert.status)}`.toLowerCase().includes(search.value.toLowerCase())
  const deviceQuery = typeof route.query.device === 'string' ? route.query.device : ''
  const readingQuery = typeof route.query.reading === 'string' ? route.query.reading : ''
  return searchable && (!sourceFilter.value || alertSource(alert) === sourceFilter.value) &&
    (!status.value || alert.status === status.value) && (!date.value || detectionDate(alert.detectedAt) === date.value) &&
    (!deviceQuery || alert.deviceId === deviceQuery) && (!readingQuery || alert.readingId === readingQuery)
}).sort((a,b) => (Date.parse(b.detectedAt) || 0) - (Date.parse(a.detectedAt) || 0) || a.id.localeCompare(b.id)))
const cards = computed(() => [
  [
    'Active Alerts',
    alerts.value.filter((alert) => alert.status.toLowerCase() !== 'resolved').length,
  ],
  ['New Alerts', alerts.value.filter((alert) => alert.status === 'New').length],
  [
    'Under Review',
    alerts.value.filter((alert) => alert.status.toLowerCase() === 'reviewing').length,
  ],
  ['Resolved', alerts.value.filter((alert) => alert.status.toLowerCase() === 'resolved').length],
])

async function verifyResponse() {
  if (!selectedAlert.value || !eligible() || isVerifying.value || isSavingResponse.value || isRefreshing.value) return
  const id = selectedAlert.value.id, token = generation, selection = selectionGeneration, account = accountKey()
  const current = () => !disposed && eligible() && token === generation && selection === selectionGeneration && selectedAlert.value?.id === id && account === accountKey()
  isVerifying.value = true
  try {
    const result = await loadCanonicalAlertQueue()
    if (!current()) return
    applyQueue(result, false)
    if (selectedUnavailable.value) throw Error('Unavailable')
    uncertainAlerts.delete(id); verificationRequired.value = false; inspectionRequired.value = true
    responseError.value = ''; responseFeedback.value = ct('Latest alert loaded. Inspect it before another response.')
  } catch { if (current()) responseError.value = ct('Latest alert could not be verified. Your note is preserved; retry reload.') }
  finally { if (token === generation && selection === selectionGeneration) isVerifying.value = false }
}
const submitResponse = async () => {
  if (!selectedAlert.value || reviewBlocked.value) return
  responseError.value = ''; responseFeedback.value = ''
  if (!responseNote.value.trim() || responseNote.value.length > 4000) {
    responseError.value = ct('Enter a response note of 1 to 4,000 characters.'); return
  }
  if (import.meta.env.DEV && isSampleAlert.value) {
    if (!previewActive.value || !authorizedPreview.value) return
    const result = preview.value!.respond(selectedAlert.value, responseNote.value, responseStatus.value)
    if (result) responseError.value = result
    else { responseNote.value = ''; responseFeedback.value = 'Sample response applied locally. Not saved to database.' }
    return
  }
  if (!alerts.value.includes(selectedAlert.value)) {
    responseError.value = ct('This alert is not a current backend record. Reload before responding.'); return
  }
  const id = selectedAlert.value.id, token = generation, selection = selectionGeneration, account = accountKey(), save = ++saveGeneration
  const current = () => !disposed && eligible() && token === generation && selection === selectionGeneration && selectedAlert.value?.id === id && account === accountKey()
  isSavingResponse.value = true
  uncertainAlerts.add(id)
  let committed = false
  try {
    await saveAlertResponse(id, responseNote.value, responseStatus.value)
    if (!current()) return
    committed = true
    const result = await loadCanonicalAlertQueue()
    if (!current()) return
    applyQueue(result, false)
    if (selectedUnavailable.value) throw Error('Unavailable')
    uncertainAlerts.delete(id); verificationRequired.value = false; inspectionRequired.value = false
    responseNote.value = ''; responseFeedback.value = ct('Response saved and verified.')
  } catch (error) {
    if (!current()) return
    verificationRequired.value = true
    if (!committed && error instanceof ThreatAlertApiError && error.status === 409) {
      isSavingResponse.value = false
      await verifyResponse()
      if (current()) responseError.value = ct('This alert changed while you were responding. Inspect the latest data before trying again.')
    } else if (error instanceof ThreatAlertApiError && [401,403].includes(error.status)) {
      clearPrivate(); poll?.stop(); errorMessage.value = ct('Verify your session before viewing alerts.')
    } else if (!committed && error instanceof ThreatAlertApiError && error.status === 400) {
      uncertainAlerts.delete(id); verificationRequired.value = false; responseError.value = error.message
    } else {
      responseError.value = ct(committed ? 'Response saved, but latest data could not be verified. Retry reload before responding again.' : 'The save outcome is uncertain. Retry reload before responding again; your note is preserved.')
    }
  } finally { if (save === saveGeneration) isSavingResponse.value = false }
}
</script>

<template>
  <section class="page-intro">
    <div><p class="page-kicker">{{ ct('INCIDENT RESPONSE') }}</p><h2>{{ ct('Threat Alerts') }}</h2><p>{{ ct('Inspect available evidence and record your investigation response.') }}</p></div>
    <button class="action-button" type="button" :disabled="isRefreshing || isSavingResponse || isVerifying" @click="loadAlerts(true)">{{ ct(isRefreshing ? 'Refreshing...' : 'Refresh alerts') }}</button>
  </section>
  <section class="summary-grid">
    <article v-for="card in cards" :key="String(card[0])" class="summary-card alert-summary-card" :data-status="String(card[0])"><p>{{ ct(String(card[0])) }}</p><strong>{{ card[1] }}</strong></article>
  </section>
  <p class="scope-note">{{ ct('Summary counts describe loaded alerts.') }}</p>
  <p v-if="queueMeta.alertsCapped || queueMeta.historyCapped" class="alert-notice" role="status">{{ ct('The service limit was reached. Alert totals or response history may be incomplete.') }}</p>
  <p class="scope-note">{{ ct('Only alerts returned by the authorized alert service are shown.') }}</p>
  <p v-if="assignmentError" class="alert-notice" role="status">{{ ct('Current assignments could not be verified for some alerts.') }} <button type="button" class="action-button" @click="refreshAssignments(alerts)">{{ ct('Retry assignment lookup') }}</button></p>
  <div class="control-bar">
    <label class="field search-field"><span>{{ ct('Search') }}</span><input v-model="search" :placeholder="ct('Alert ID, device, reading, type or status')" /></label>
    <label class="field"><span>{{ ct('Alert Source') }}</span><select v-officer-dropdown v-model="sourceFilter"><option value="">{{ ct('All Sources') }}</option><option value="Sensor">{{ ct('Sensor') }}</option><option value="Camera">{{ ct('Camera') }}</option></select></label>
    <label class="field"><span>{{ ct('Status') }}</span><select v-officer-dropdown v-model="status"><option value="">{{ ct('All statuses') }}</option><option v-for="item in statusOptions" :key="item" :value="item">{{ statusText(item) }}</option></select></label>
    <label class="field"><span>{{ ct('Date') }}</span><input v-model="date" type="date" /></label>
  </div>
  <p class="scope-note">{{ ct('Severity is unavailable from the alert service.') }}</p>
  <section class="panel">
    <header class="panel-header"><div><h2>{{ ct('Threat Alerts') }}</h2><span v-if="previewActive" class="sample-marker">SAMPLE DATA &mdash; summary cards show real backend counts</span></div>
      <div v-if="developmentPreview && canPreview" class="preview-controls"><button v-if="!previewActive" class="action-button" type="button" :disabled="isStartingPreview" @click="startPreview">Preview Sample Alerts</button><button v-else class="action-button" type="button" @click="exitPreview">Exit Preview</button></div>
    </header>
    <p v-if="refreshError" class="alert-notice" role="alert">{{ refreshError }} <button type="button" class="action-button" @click="loadAlerts(true)">{{ ct('Retry') }}</button></p>
    <p v-if="isLoading" class="state-message" role="status">{{ ct('Loading threat alerts...') }}</p>
    <div v-else-if="errorMessage" class="state-message error-state" role="alert"><p>{{ errorMessage }}</p><button class="action-button" type="button" @click="loadAlerts()">{{ ct('Try again') }}</button></div>
    <p v-else-if="!filteredAlerts.length" class="state-message">{{ ct('No threat alerts found.') }}</p>
    <div v-else class="table-scroll officer-table-scroll" role="region" :aria-label="ct('Threat Alerts')" tabindex="0">
      <table class="officer-data-table threat-alert-table"><colgroup><col class="column-id" /><col class="column-source" /><col class="column-plant" /><col class="column-type" /><col class="column-identifier" /><col class="column-status" /><col class="column-time" /><col class="column-actions" /></colgroup>
        <thead><tr><th scope="col">{{ ct('Alert ID') }}</th><th scope="col">{{ ct('Alert Source') }}</th><th scope="col">{{ ct('Current Assigned Plant') }}</th><th scope="col">{{ ct('Alert Type') }}</th><th scope="col">{{ ct('Device / Camera') }}</th><th scope="col">{{ ct('Status') }}</th><th scope="col">{{ ct('Detected At') }}</th><th scope="col">{{ ct('Actions') }}</th></tr></thead>
        <tbody><tr v-for="alert in filteredAlerts" :key="alert.id">
          <td><strong><MonitoringIdentifier :value="alert.id" :labels="alertLabels" /></strong></td>
          <td><span class="source-badge" :class="alertSource(alert).toLowerCase()">{{ sourceText(alert) }}</span></td>
          <td><RouterLink v-if="assignedPlantLabel(assignmentFor(alert))" :to="`/plant/${assignmentFor(alert).plant_id}`" class="assigned-plant-chip" :aria-label="`${ct('Current Assigned Plant')}: ${assignedPlantLabel(assignmentFor(alert))}`"><svg class="plant-chip-leaf" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19C1 7 11 3 21 3c0 10-4 20-16 16Zm-2 2L17 7" /></svg><span>{{ assignedPlantLabel(assignmentFor(alert)) }}</span><svg class="plant-chip-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h11v11M19 5 5 19" /></svg></RouterLink><span v-else>{{ ct(assignmentFor(alert).state === 'not_linked' ? 'Not linked' : 'Unavailable') }}</span></td>
          <td>{{ typeText(alert) }}</td>
          <td><MonitoringIdentifier :value="alertSource(alert) === 'Camera' ? alert.cameraId : alert.deviceId" :labels="alertSource(alert) === 'Camera' ? cameraLabels : deviceLabels" /></td>
          <td><span class="badge" :style="threatAlertBadgeStyle(alert.status)" :class="alert.status.toLowerCase()">{{ statusText(alert.status) }}</span></td>
          <td class="alert-time">{{ dt(alert.detectedAt) }}</td><td><button class="action-button" type="button" @click="openAlert(alert)">{{ ct('View') }}</button></td>
        </tr></tbody>
      </table>
    </div>
  </section>

  <AppModal v-if="selectedAlert" class="threat-investigation-modal" :title="ct('Threat Alert')" :subtitle="`${formatAlertId(selectedAlert.id)} / ${typeText(selectedAlert)}`" wide accessible @close="closeAlert">
    <template #title><span class="investigation-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3 2 21h20L12 3Z" /><path d="M12 9v5m0 3h.01" /></svg>{{ ct('Threat Alert') }}</span></template>
    <div class="investigation-status"><span v-if="isSampleAlert" class="sample-marker">SAMPLE PREVIEW &mdash; NOT SAVED TO DATABASE</span><span class="source-badge" :class="alertSource(selectedAlert).toLowerCase()">{{ sourceText(selectedAlert) }}</span><span>{{ ct('Status') }}</span><span class="badge" :style="threatAlertBadgeStyle(selectedAlert.status)">{{ statusText(selectedAlert.status) }}</span></div>
    <div class="investigation-grid">
      <div class="investigation-evidence">
        <section class="investigation-section"><h3><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10h.01" /></svg>{{ ct('Alert Information') }}</h3>
          <dl class="evidence-fields"><div><dt>{{ ct('Alert ID') }}</dt><dd><MonitoringIdentifier :value="selectedAlert.id" :labels="alertLabels" /></dd></div><div><dt>{{ ct('Alert Type') }}</dt><dd>{{ typeText(selectedAlert) }}</dd></div><div><dt>{{ ct('Detected At') }}</dt><dd>{{ dt(selectedAlert.detectedAt) }}</dd></div><div><dt>{{ ct('Created At') }}</dt><dd>{{ dt(selectedAlert.createdAt) }}</dd></div><div><dt>{{ ct('Device') }}</dt><dd><MonitoringIdentifier :value="selectedAlert.deviceId" :labels="deviceLabels" /></dd></div><div v-if="selectedAlert.readingId"><dt>{{ ct('Reading Reference') }}</dt><dd><MonitoringIdentifier :value="selectedAlert.readingId" :labels="readingLabels" /></dd></div><div v-if="alertSource(selectedAlert) === 'Camera'"><dt>{{ ct('Camera Reference') }}</dt><dd><MonitoringIdentifier :value="selectedAlert.cameraId" :labels="cameraLabels" /></dd></div></dl>
          <p class="evidence-note">{{ ct('Detection time is the recorded alert time and may represent ingestion, not sensor capture.') }}</p>
        </section>
        <section class="investigation-section"><h3><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19C1 7 11 3 21 3c0 10-4 20-16 16Zm-2 2L17 7" /></svg>{{ ct('Plant & Location') }}</h3><dl class="evidence-fields"><div><dt>{{ ct('Current Assigned Plant') }}</dt><dd><RouterLink v-if="assignedPlantLabel(selectedAssignment)" :to="`/plant/${selectedAssignment?.plant_id}`" class="assigned-plant-chip" :aria-label="`${ct('Current Assigned Plant')}: ${assignedPlantLabel(selectedAssignment)}`"><svg class="plant-chip-leaf" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19C1 7 11 3 21 3c0 10-4 20-16 16Zm-2 2L17 7" /></svg><span>{{ assignedPlantLabel(selectedAssignment) }}</span><svg class="plant-chip-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h11v11M19 5 5 19" /></svg></RouterLink><span v-else>{{ ct(selectedAssignment?.state === 'not_linked' ? 'Not linked' : 'Unavailable') }}</span></dd></div><div><dt>{{ ct('Device') }}</dt><dd><MonitoringIdentifier :value="selectedAlert.deviceId" :labels="deviceLabels" /></dd></div></dl><p class="evidence-note">{{ ct('This is the current device assignment, not necessarily the Plant assigned when the alert occurred. Event-time location is unavailable.') }}</p></section>
        <section v-if="alertSource(selectedAlert) === 'Sensor'" class="investigation-section"><h3><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l3-8 4 16 3-8h4" /></svg>{{ ct('Sensor Evidence') }}</h3>
          <dl class="evidence-fields"><div><dt>{{ ct('Triggering Sensor') }}</dt><dd>{{ ct(sensorMetricLabel(selectedAlert.metric)) }}</dd></div><div><dt>{{ ct('Sensor reading') }}</dt><dd class="reading-value">{{ selectedAlert.value }} <span>{{ ct(sensorUnit(selectedAlert.metric) || 'Unit unavailable') }}</span></dd></div><div><dt>{{ ct('Configured triggering threshold') }}</dt><dd>{{ ct('Threshold unavailable') }}</dd></div><div><dt>{{ ct('Reading unit') }}</dt><dd>{{ ct(sensorUnit(selectedAlert.metric) || 'Unit unavailable') }}</dd></div><div><dt>{{ ct('Amount exceeding threshold') }}</dt><dd>{{ ct('Unavailable') }}</dd></div></dl>
          <p class="evidence-note">{{ ct('The threshold at detection was not supplied. Current device settings are not historical evidence.') }}</p>
          <h4 class="frame-heading">{{ ct('Same-event sensor readings') }}</h4>
          <p class="evidence-note">{{ ct('Values belong to one stored frame. Sensors may have been sampled at different instants.') }}</p>
          <p v-if="evidenceLoading" class="evidence-note" role="status">{{ ct('Loading exact reading evidence...') }}</p>
          <div v-else-if="evidenceError" class="alert-notice" role="alert"><p>{{ ct('Exact reading evidence could not be verified. No other frame was substituted.') }}</p><button class="action-button" type="button" @click="loadEvidence(selectedAlert)">{{ ct('Retry evidence lookup') }}</button></div>
          <template v-else-if="evidence?.reading.state === 'verified'">
            <p class="evidence-note">{{ ct('Frame received at') }}: {{ dt(evidence.reading.received_at) }}</p>
            <table class="same-event-readings"><thead><tr><th scope="col">{{ ct('Sensor') }}</th><th scope="col">{{ ct('Reading') }}</th><th scope="col">{{ ct('Evidence Role') }}</th></tr></thead><tbody><tr v-for="row in eventReadings" :key="row.metric" :class="{ 'trigger-reading': row.metric === selectedAlert.metric }"><th scope="row">{{ ct(sensorMetricLabel(row.metric)) }}</th><td>{{ row.value }} {{ ct(sensorUnit(row.metric) || 'Unit unavailable') }}</td><td><span class="evidence-role" :class="row.metric === selectedAlert.metric ? 'trigger' : 'context'">{{ ct(row.metric === selectedAlert.metric ? 'Trigger' : 'Context') }}</span></td></tr></tbody></table>
          </template>
          <p v-else class="evidence-note" role="status">{{ ct('The exact linked reading is missing or unverified. No other frame has been substituted.') }}</p>
        </section>
        <section v-else-if="alertSource(selectedAlert) === 'Camera'" class="investigation-section"><h3><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="12" height="12" rx="2" /><path d="m15 10 6-3v10l-6-3" /></svg>{{ ct('Camera Evidence') }}</h3>
          <button class="action-button" type="button" :disabled="cameraLoading || isSampleAlert" :aria-busy="cameraLoading" @click="loadCameraEvidence(selectedAlert)">{{ ct(cameraLoading ? 'Refreshing...' : 'Refresh recording') }}</button>
          <p v-if="cameraLoading && !cameraEvent" class="evidence-note" role="status">{{ ct('Loading recording details...') }}</p>
          <p v-if="cameraError" class="alert-notice" role="alert">{{ cameraError }}</p>
          <template v-if="cameraEvent">
            <dl class="evidence-fields"><div><dt>{{ ct('Recording') }}</dt><dd>{{ ct(recordingLabel(cameraEvent)) }}</dd></div><div><dt>{{ ct('Recording duration') }}</dt><dd>{{ formatDuration(cameraEvent.durationSeconds) }}</dd></div><div><dt>{{ ct('Description') }}</dt><dd>{{ cameraEvent.description }}</dd></div></dl>
            <video v-if="cameraEvent.videoUrl" :key="cameraEvent.eventId" class="event-video" :src="cameraEvent.videoUrl" :aria-label="ct('Event Recording')" controls preload="metadata" @error="playbackError = true"></video>
            <p v-else class="recording-unavailable">{{ ct(cameraEvent.recordingStatus === 'recording' ? 'This event is still being recorded.' : cameraEvent.recordingStatus === 'processing' ? 'The clip is being prepared. Refresh the event list shortly.' : 'This recording was interrupted or is unavailable.') }}</p>
            <p v-if="playbackError" class="alert-notice" role="alert">{{ ct('Unable to play this clip. Check your login and that the recording is available on the backend computer.') }}</p>
          </template>
          <div v-else-if="!cameraLoading" class="recording-unavailable"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m10 9 5 3-5 3V9Z" /></svg><strong>{{ ct('No authorized recording is available for this alert.') }}</strong></div>
          <p v-if="cameraHasMore && !cameraEvent" class="evidence-note">{{ ct('Only the latest 100 camera events were checked for this recording.') }}</p>
          <dl class="evidence-fields"><div><dt>{{ ct('Contact duration') }}</dt><dd>{{ cameraEvent?.contactDurationSeconds != null ? `${cameraEvent.contactDurationSeconds.toFixed(1)} s` : ct('Unavailable') }}</dd></div><div><dt>{{ ct('Configured contact threshold') }}</dt><dd>{{ cameraEvent?.contactThresholdSeconds != null ? `${cameraEvent.contactThresholdSeconds.toFixed(1)} s` : ct('Threshold unavailable') }}</dd></div><div><dt>{{ ct('Detection confidence') }}</dt><dd>{{ cameraEvent?.confidence != null ? `${Math.round(cameraEvent.confidence * 100)}%` : ct('Unavailable') }}</dd></div></dl>
          <p v-if="cameraEvent?.confidenceKind === 'wrist_keypoint'" class="evidence-note">{{ ct('Confidence describes wrist detection, not the probability of a threat. Contact duration is measured at the alert trigger.') }}</p>
          <p v-else class="evidence-note">{{ ct('Detailed detection evidence was not supplied. A contact alert does not establish poaching.') }}</p>
        </section>
        <section v-else class="investigation-section"><h3>{{ ct('Alert Evidence') }}</h3><p class="evidence-note">{{ ct('Source-specific evidence is unavailable.') }}</p><dl class="evidence-fields"><div><dt>{{ ct('Metric Value') }}</dt><dd>{{ selectedAlert.value }}</dd></div></dl></section>
        <section class="investigation-section response-history"><h3><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v13H8l-4 4V4Z" /><path d="M8 8h8M8 12h5" /></svg>{{ ct('Response History') }}</h3>
          <p class="evidence-note">{{ ct('Newest first. History covers responses returned by the service.') }}</p><p v-if="queueMeta.historyCapped" class="alert-notice" role="status">{{ ct('Response history may be incomplete because the service limit was reached.') }}</p>
          <div v-if="!selectedAlert.responses.length" class="evidence-unavailable"><strong>{{ ct('No response history recorded.') }}</strong><span>{{ ct('No responses are present in the loaded history.') }}</span></div>
          <ol v-else class="response-timeline"><li v-for="response in [...selectedAlert.responses].sort((a,b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))" :key="response.id"><div class="response-meta"><strong>{{ statusText(response.status) }}</strong><time :datetime="response.createdAt">{{ dt(response.createdAt) }}</time></div><p>{{ response.note }}</p><span v-if="responseActorName(response.officerSubject)" class="response-actor">{{ responseActorName(response.officerSubject) }}</span><MonitoringIdentifier v-else :value="response.officerSubject" :labels="subjectLabels" /></li></ol>
        </section>
      </div>
      <section class="investigation-section officer-review"><h3><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4H4v17h16V4h-4M8 2h8v5H8V2Zm0 12 3 3 5-6" /></svg>{{ ct('Officer Review') }}</h3>
        <p v-if="selectedAlert.status === 'Resolved'" class="alert-notice">{{ ct('This alert is resolved and read-only.') }}</p>
        <p v-if="selectedUnavailable" class="alert-notice" role="alert">{{ ct('This alert is not available in the latest loaded results. Review is blocked.') }}</p>
        <div v-if="verificationRequired" class="alert-notice" role="status"><p>{{ ct('Verify the latest alert before another response.') }}</p><button type="button" class="action-button" :disabled="isSavingResponse || isVerifying || isRefreshing" @click="verifyResponse">{{ ct(isVerifying ? 'Verifying...' : 'Retry reload') }}</button></div>
        <div v-if="inspectionRequired && !verificationRequired" class="alert-notice" role="status"><p>{{ ct('Inspect the latest alert and history before another response.') }}</p><button type="button" class="action-button" :disabled="isVerifying || selectedUnavailable" @click="inspectionRequired = false">{{ ct('I have inspected the latest alert') }}</button></div>
        <label class="field"><span>{{ ct('Response Status') }}</span><select v-officer-dropdown v-model="responseStatus" :disabled="reviewBlocked"><option value="Reviewing">{{ ct('Under Review') }}</option><option value="Resolved">{{ ct('Resolved') }}</option></select></label>
        <label class="field response-note"><span>{{ ct('Response Note') }} <span aria-hidden="true">*</span></span><textarea v-model="responseNote" maxlength="4000" :disabled="isSavingResponse || isVerifying || selectedAlert.status === 'Resolved' || selectedUnavailable" :placeholder="ct('Describe your observation and follow-up action.')" :aria-label="ct('Response Note')" aria-required="true"></textarea><small>{{ responseNote.length }} / 4,000</small></label>
        <p v-if="responseError" class="state-message error-state" role="alert">{{ responseError }}</p><p v-if="responseFeedback" class="review-feedback" role="status" aria-live="polite">{{ responseFeedback }}</p>
        <div class="review-actions"><button class="action-button" type="button" @click="closeAlert">{{ ct('Close') }}</button><button class="primary-button" type="button" :disabled="reviewBlocked || !responseNote.trim()" @click="submitResponse">{{ ct(isSavingResponse ? 'Saving...' : primaryLabel) }}</button></div>
      </section>
    </div>
  </AppModal>
</template>

<style scoped>
.event-video { display: block; width: 100%; max-height: 420px; margin-top: 14px; border-radius: 12px; background: #102d22; }
.assigned-plant-chip { display: inline-flex; align-items: center; gap: 7px; max-width: 100%; padding: 5px 9px; border: 1px solid #c8d8c4; border-radius: 7px; background: #edf3e8; color: #245a46; font-size: 12px; line-height: 1.5; font-weight: 750; text-decoration: none; white-space: nowrap; vertical-align: middle; transition: background-color .16s ease, border-color .16s ease; }
.assigned-plant-chip:visited { color: #245a46; }
.assigned-plant-chip:hover { background: #dcebd7; border-color: #74916e; color: #173f34; text-decoration: none; }
.assigned-plant-chip:focus-visible { outline: 3px solid #33745d; outline-offset: 3px; }
.assigned-plant-chip svg { flex: 0 0 auto; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.plant-chip-leaf { width: 15px; height: 15px; }
.plant-chip-arrow { width: 12px; height: 12px; opacity: .8; }
@media (prefers-reduced-motion: reduce) { .assigned-plant-chip { transition: none; } }

.preview-controls { display: flex; flex-wrap: wrap; gap: 8px; }
.sample-marker { display: block; margin-top: 6px; color: #854d0e; font-weight: 700; overflow-wrap: anywhere; }

.officer-layout.officer-layout .officer-table-scroll .threat-alert-table { min-width: 82rem; }

.alert-summary-card { --alert-card-background: #e8f0f5; --alert-card-ink: #315d78; padding: 16px; border: 1px solid var(--alert-card-ink); background: var(--alert-card-background); color: var(--alert-card-ink); }
.alert-summary-card[data-status="Active Alerts"] { --alert-card-background: #fbe8e5; --alert-card-ink: #a33f35; }
.alert-summary-card[data-status="New Alerts"] { --alert-card-background: #e8f0f5; --alert-card-ink: #315d78; }
.alert-summary-card[data-status="Under Review"] { --alert-card-background: #fff1db; --alert-card-ink: #926119; }
.alert-summary-card[data-status="Resolved"] { --alert-card-background: #e7f3e9; --alert-card-ink: #287347; }
.officer-layout.officer-layout.officer-layout .alert-summary-card :is(p, strong) { color: inherit; }
.real-alert-details .wide {
  grid-column: 1 / -1;
}
.evidence-unavailable {
  min-height: 120px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 11px;
  background: #eef2ef;
  color: #526b60;
  text-align: center;
}
.evidence-unavailable span {
  color: #819088;
  font-size: 10px;
}
.state-message {
  margin: 18px 0;
  padding: 24px;
  border: 1px solid #e1e7e1;
  border-radius: 13px;
  background: #fff;
  color: #65776f;
  text-align: center;
}
.error-state {
  color: #9a4739;
}
.error-state p {
  margin-top: 0;
}
.scope-note { margin: 8px 0 12px; color: #52685f; font-size: 12px; line-height: 1.6; }
.alert-notice { padding: 12px 15px; border: 1px solid #d8e4d8; border-radius: 9px; background: #f1f6ee; color: #354f42; font-size: 13px; line-height: 1.6; }
.alert-notice p { margin: 0 0 8px; }
.source-badge { display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 7px; color: #374151; background: #e5e7eb; font-size: 12px; font-weight: 700; white-space: nowrap; }
.source-badge.sensor { color: #1d5973; background: #e5f1f8; }
.source-badge.camera { color: #5b3e78; background: #f0e9f7; }
.alert-time { min-width: 12rem; }
.threat-investigation-modal :deep(.modal-card.wide) { box-sizing: border-box; width: min(1120px, calc(100vw - 40px)); max-height: 92dvh; padding: 26px; overflow-y: auto; border-radius: 18px; }
.threat-investigation-modal :deep(.modal-header) { align-items: flex-start; margin-bottom: 16px; }
.threat-investigation-modal :deep(.modal-header h2) { margin: 0; font-size: 25px; color: #173f34; }
.threat-investigation-modal :deep(.modal-header p) { margin: 8px 0 0; color: #52685f; overflow-wrap: anywhere; }
.investigation-title { display: inline-flex; align-items: center; gap: 12px; }
.investigation-title svg { width: 40px; height: 40px; padding: 9px; box-sizing: border-box; border-radius: 10px; background: #fce8e5; color: #ae3e34; }
.investigation-status { display: flex; justify-content: flex-end; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; color: #355449; font-size: 13px; font-weight: 600; }
.investigation-grid { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(290px, 1fr); gap: 22px; align-items: start; }
.investigation-evidence { display: grid; gap: 22px; min-width: 0; }
.investigation-section { min-width: 0; border: 1px solid #e0e9e0; border-radius: 11px; background: #fff; overflow: hidden; }
.investigation-section h3 { display: flex; align-items: center; gap: 9px; margin: 0; padding: 12px 15px; background: #eaf3e8; color: #174c38; font-size: 13px; line-height: 1.5; font-weight: 800; text-transform: uppercase; letter-spacing: .025em; }
.investigation-section h3 svg { width: 19px; height: 19px; flex-shrink: 0; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linejoin: round; stroke-linecap: round; }
.evidence-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 20px; margin: 0; padding: 4px 15px; }
.evidence-fields > div { min-width: 0; padding: 13px 0; border-bottom: 1px solid #edf1ec; }
.evidence-fields dt { margin-bottom: 6px; color: #38594b; font-size: 12px; font-weight: 750; }
.evidence-fields dd { margin: 0; color: #243e34; font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
.evidence-fields .reading-value { color: #174c38; font-size: 26px; line-height: 1.2; font-weight: 750; }
.reading-value span { font-size: 15px; }
.evidence-note { margin: 0; padding: 12px 15px; color: #5d7167; font-size: 12px; line-height: 1.65; }
.frame-heading { margin: 12px 15px 0; color: #245a46; font-size: 14px; }
.same-event-readings { width: 100%; border-collapse: collapse; font-size: 12px; text-align: left; }
.same-event-readings :is(th,td) { padding: 12px 15px; border-top: 1px solid #e4ebe2; overflow-wrap: anywhere; }
.same-event-readings thead { color: #50685a; background: #f5f8f3; }
.same-event-readings .trigger-reading { background: #eaf5eb; color: #174c38; font-weight: 700; }
.evidence-role { display: inline-block; padding: 3px 7px; border-radius: 5px; background: #eef0ef; color: #455c50; font-size: 11px; }
.evidence-role.trigger { background: #d5ead9; color: #1b5134; }
.recording-unavailable { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; min-height: 145px; margin: 15px; padding: 20px; border-radius: 8px; background: #f1f5f0; color: #496356; text-align: center; font-size: 13px; line-height: 1.6; }
.recording-unavailable svg { width: 32px; height: 32px; fill: none; stroke: currentColor; stroke-width: 1.4; }
.response-history .evidence-unavailable { margin: 0 15px 15px; padding: 15px; box-sizing: border-box; }
.response-history .evidence-unavailable span { font-size: 12px; }
.response-timeline { list-style: none; margin: 0; padding: 0 15px 15px; }
.response-timeline li { padding: 15px 0; border-top: 1px solid #e4ebe2; }
.response-meta { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 5px 12px; font-size: 12px; color: #385c49; }
.response-meta time { color: #5a6d62; }
.response-timeline p { white-space: pre-wrap; overflow-wrap: anywhere; color: #294437; font-size: 13px; line-height: 1.65; }
.response-actor { display: inline-block; color: #385c49; font-size: 13px; font-weight: 600; }
.officer-review { position: sticky; top: 0; }
.officer-review > :not(h3) { margin-left: 15px; margin-right: 15px; }
.officer-review .field { display: flex; flex-direction: column; margin-top: 18px; gap: 8px; color: #29493a; }
.officer-review .field > span { font-weight: 700; font-size: 12px; }
.officer-review select, .officer-review textarea { width: 100%; box-sizing: border-box; border: 1px solid #bdcfc2; border-radius: 8px; background: #fff; padding: 11px 12px; color: #243f32; font: inherit; font-size: 13px; }
.officer-review textarea { min-height: 175px; resize: vertical; line-height: 1.65; }
.officer-review .response-note small { text-align: right; color: #61776b; font-size: 11px; }
.officer-review .state-message { padding: 12px; font-size: 12px; }
.review-feedback { color: #245a46; font-size: 13px; line-height: 1.6; }
.review-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; padding: 24px 0 16px; }
.review-actions button { min-height: 42px; font-size: 13px; font-weight: 700; }
.officer-review :is(button,select,textarea):disabled { opacity: .6; cursor: not-allowed; }
.threat-investigation-modal :deep(button), .threat-alert-table button { transition: background-color .16s ease, box-shadow .16s ease; }
.threat-investigation-modal :deep(button:focus-visible), .officer-review :is(select,textarea):focus-visible { outline: 3px solid #75a88b; outline-offset: 3px; }
@media (max-width: 820px) { .investigation-grid { grid-template-columns: 1fr; } .officer-review { position: static; } .threat-investigation-modal :deep(.modal-card.wide) { padding: 18px; } }
@media (max-width: 480px) { .evidence-fields { grid-template-columns: 1fr; } .investigation-title { font-size: 21px; } .review-actions button { flex: 1; } }
@media (prefers-reduced-motion: reduce) { .threat-investigation-modal :deep(button), .threat-alert-table button { transition: none; } }
</style>

<style src="../../styles/officer-data-tables.css"></style>
