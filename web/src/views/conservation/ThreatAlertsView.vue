<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppModal from '../../components/conservation/AppModal.vue'
import { useConservationText } from '../../composables/useConservationText'
import { prototypeCameraEvents } from '../../data/cameraMonitoringPrototype'
import type { CameraEvent } from '../../types/cameraMonitoring'
import {
  CANONICAL_ALERT_CAP,
  loadCanonicalAlerts,
  saveAlertResponse,
  ThreatAlertApiError,
  type AlertResponseStatus,
  type CanonicalThreatAlert,
} from '../../services/threatAlerts'

const { ct, dt } = useConservationText()
const route = useRoute()
const alerts = ref<CanonicalThreatAlert[]>([])
const selectedAlert = ref<CanonicalThreatAlert | null>(null)
const selectedCameraEvent = ref<CameraEvent | null>(null)
const search = ref('')
const severity = ref('')
const status = ref('')
const date = ref('')
const isLoading = ref(true)
const errorMessage = ref('')
const responseStatus = ref<AlertResponseStatus>('Reviewing')
const responseNote = ref('')
const responseError = ref('')
const responseFeedback = ref('')
const isSavingResponse = ref(false)

const formatAlertId = (id: string) => id
const formatConfidence = (value: string | number | null) => {
  if (value === null || value === '') return 'Not available'
  const confidence = Number(value)
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) return 'Not available'
  const percentage = confidence <= 1 ? confidence * 100 : confidence
  return `${Math.round(percentage)}%`
}
const formatDuration = (seconds?: number) => {
  if (seconds === undefined) return '—'
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
const isWebVideoUrl = (value?: string) => {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
const openAlert = (alert: CanonicalThreatAlert) => {
  selectedAlert.value = alert
  responseStatus.value = alert.status === 'Reviewing' ? 'Resolved' : 'Reviewing'
  responseNote.value = ''
  responseError.value = ''
  responseFeedback.value = ''
}

const selectedAlertId = () => {
  const queryValue = route.query.alert
  if (typeof queryValue !== 'string') return
  selectedCameraEvent.value =
    prototypeCameraEvents.find((event) => event.eventId === queryValue) ?? null
  selectedAlert.value = null
  if (selectedCameraEvent.value) return

  const alert = alerts.value.find((item) => item.id === queryValue)
  if (alert) openAlert(alert)
}

const loadAlerts = async () => {
  isLoading.value = true
  errorMessage.value = ''
  try {
    alerts.value = await loadCanonicalAlerts()
    selectedAlertId()
  } catch (error) {
    alerts.value = []
    errorMessage.value =
      error instanceof Error ? error.message : 'Unable to retrieve threat alerts.'
  } finally {
    isLoading.value = false
  }
}

onMounted(loadAlerts)
watch(() => [route.query.alert, route.query.device, route.query.reading], selectedAlertId)

const severityOptions = computed<string[]>(() => [])
const statusOptions = computed(() => [...new Set(alerts.value.map((alert) => alert.status))])
const filteredAlerts = computed(() =>
  alerts.value.filter((alert) => {
    const searchable =
      `${alert.id} ${alert.metric} ${alert.value} ${alert.deviceId} ${alert.readingId ?? ''} ${alert.cameraId ?? ''} ${alert.status}`
        .toLowerCase()
        .includes(search.value.toLowerCase())
    const deviceQuery = typeof route.query.device === 'string' ? route.query.device : ''
    const readingQuery = typeof route.query.reading === 'string' ? route.query.reading : ''
    return (
      searchable &&
      !severity.value &&
      (!status.value || alert.status === status.value) &&
      (!date.value || alert.createdAt.slice(0, 10) === date.value) &&
      (!deviceQuery || alert.deviceId === deviceQuery) &&
      (!readingQuery || alert.readingId === readingQuery)
    )
  }),
)
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

const submitResponse = async () => {
  if (!selectedAlert.value || isSavingResponse.value) return
  responseError.value = ''
  responseFeedback.value = ''
  if (!responseNote.value.trim()) {
    responseError.value = 'A response note is required.'
    return
  }
  const id = selectedAlert.value.id
  isSavingResponse.value = true
  let committed = false
  try {
    await saveAlertResponse(id, responseNote.value, responseStatus.value)
    committed = true
    const refreshed = await loadCanonicalAlerts()
    alerts.value = refreshed
    const alert = refreshed.find((item) => item.id === id)
    if (!alert) throw new Error('The refreshed alert is unavailable.')
    selectedAlert.value = alert
    responseNote.value = ''
    responseFeedback.value = 'Response saved and verified from the canonical alert service.'
  } catch (error) {
    if (!committed && error instanceof ThreatAlertApiError && error.status === 409) {
      try {
        const refreshed = await loadCanonicalAlerts()
        alerts.value = refreshed
        selectedAlert.value = refreshed.find((item) => item.id === id) ?? selectedAlert.value
        responseError.value = 'This alert changed while you were responding. Latest data was reloaded; review it before trying again.'
      } catch {
        responseError.value = 'This alert changed, but latest data could not be reloaded. Your note is preserved; reload before trying again.'
      }
    } else if (!committed && error instanceof ThreatAlertApiError && error.kind === 'network') {
      responseError.value = 'The save outcome is uncertain because the service could not be reached. Your note is preserved; reload before trying again.'
    } else {
      responseError.value = committed
        ? 'The response was saved, but refreshed alert data could not be loaded. Reload before submitting again.'
        : error instanceof Error ? error.message : 'Unable to save the alert response.'
    }
  } finally {
    isSavingResponse.value = false
  }
}
</script>

<template>
  <section class="page-intro">
    <div>
      <p class="page-kicker">{{ ct('INCIDENT RESPONSE') }}</p>
      <h2>{{ ct('Threat Alerts') }}</h2>
      <p>{{ ct('Review environmental and security events around monitored plants.') }}</p>
    </div>
  </section>

  <section class="summary-grid">
    <article v-for="card in cards" :key="String(card[0])" class="summary-card">
      <p>{{ ct(String(card[0])) }}</p>
      <strong>{{ card[1] }}</strong>
      <small>{{ ct('PostgreSQL alert register') }}</small>
    </article>
  </section>

  <div class="control-bar">
    <label class="field search-field"
      ><span>{{ ct('Search') }}</span
      ><input v-model="search" :placeholder="ct('Alert ID, Plant ID or type')"
    /></label>
    <label class="field"
      ><span>{{ ct('Severity') }}</span
      ><select v-model="severity" disabled title="Canonical alerts do not provide severity.">
        <option value="">{{ ct('All severities') }}</option>
        <option v-for="item in severityOptions" :key="item" :value="item">{{ ct(item) }}</option>
      </select></label
    >
    <label class="field"
      ><span>{{ ct('Status') }}</span
      ><select v-model="status">
        <option value="">{{ ct('All statuses') }}</option>
        <option v-for="item in statusOptions" :key="item" :value="item">{{ ct(item) }}</option>
      </select></label
    >
    <label class="field"
      ><span>{{ ct('Date') }}</span
      ><input v-model="date" type="date"
    /></label>
  </div>

  <section class="panel camera-alert-panel">
    <header class="panel-header">
      <div>
        <h2>{{ ct('Suspicious Camera Events') }}</h2>
        <span class="panel-description">{{
          ct('Frontend prototype events · not persisted or connected to the AI module')
        }}</span>
      </div>
    </header>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{{ ct('Event ID') }}</th>
            <th>{{ ct('Event Type') }}</th>
            <th>{{ ct('Plant ID') }}</th>
            <th>{{ ct('Camera ID') }}</th>
            <th>{{ ct('Detection Confidence') }}</th>
            <th>{{ ct('Status') }}</th>
            <th>{{ ct('Detected At') }}</th>
            <th>{{ ct('Recording') }}</th>
            <th>{{ ct('Actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="event in prototypeCameraEvents" :key="event.eventId">
            <td>
              <strong>{{ event.eventId }}</strong>
            </td>
            <td>{{ event.description }}</td>
            <td>{{ event.plantId }}</td>
            <td>{{ event.cameraId }}</td>
            <td>{{ formatConfidence(event.confidence) }}</td>
            <td>
              <span class="badge" :class="event.status.toLowerCase()">{{ event.status }}</span>
            </td>
            <td>{{ dt(event.detectedAt) }}</td>
            <td>{{ isWebVideoUrl(event.videoUrl) ? ct('Available') : ct('Unavailable') }}</td>
            <td>
              <button class="action-button" @click="selectedCameraEvent = event">
                {{ ct('View') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <p v-if="isLoading" class="state-message">Loading threat alerts...</p>
  <div v-else-if="errorMessage" class="state-message error-state">
    <p>{{ errorMessage }}</p>
    <button class="action-button" @click="loadAlerts">Try again</button>
  </div>
  <section v-else class="panel">
    <header class="panel-header">
      <div>
        <h2>{{ ct('PostgreSQL Threat Alerts') }}</h2>
        <span class="panel-description"
          >Canonical alerts and response records · up to {{ CANONICAL_ALERT_CAP }} each.</span
        >
      </div>
    </header>
    <p v-if="!filteredAlerts.length" class="state-message">No threat alerts found.</p>
    <div v-else class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{{ ct('Alert ID') }}</th>
            <th>{{ ct('Alert Type') }}</th>
            <th>{{ ct('Plant ID') }}</th>
            <th>{{ ct('Species') }}</th>
            <th>{{ ct('Reading Reference') }}</th>
            <th>{{ ct('Device') }}</th>
            <th>{{ ct('Detection Confidence') }}</th>
            <th>{{ ct('Severity') }}</th>
            <th>{{ ct('Status') }}</th>
            <th>{{ ct('Detected At') }}</th>
            <th>{{ ct('Actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="alert in filteredAlerts" :key="alert.id">
            <td>
              <strong>{{ formatAlertId(alert.id) }}</strong>
            </td>
            <td>{{ alert.metric }}</td>
            <td>—</td>
            <td><em>Not available</em></td>
            <td>{{ alert.readingId ?? '—' }}</td>
            <td>{{ alert.deviceId }}</td>
            <td>Not available</td>
            <td>
              <span class="badge unavailable">Not available</span>
            </td>
            <td>
              <span class="badge" :class="alert.status.toLowerCase()">{{ alert.status }}</span>
            </td>
            <td>{{ dt(alert.detectedAt) }}</td>
            <td>
              <div class="action-group">
                <button class="action-button" @click="openAlert(alert)">
                  {{ ct('View') }}</button
                ><button
                  class="action-button"
                  disabled
                  title="Canonical alerts do not provide a plant ID."
                  >{{ ct('View Plant') }}</button
                >
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <AppModal
    v-if="selectedCameraEvent"
    :title="selectedCameraEvent.title"
    :subtitle="`${selectedCameraEvent.eventId} · ${selectedCameraEvent.plantId}`"
    wide
    @close="selectedCameraEvent = null"
  >
    <dl class="detail-list camera-event-details">
      <div>
        <dt>{{ ct('Camera ID') }}</dt>
        <dd>{{ selectedCameraEvent.cameraId }}</dd>
      </div>
      <div>
        <dt>{{ ct('Event Type') }}</dt>
        <dd>{{ selectedCameraEvent.description }}</dd>
      </div>
      <div>
        <dt>{{ ct('Detection Confidence') }}</dt>
        <dd>{{ formatConfidence(selectedCameraEvent.confidence) }}</dd>
      </div>
      <div>
        <dt>{{ ct('Timestamp') }}</dt>
        <dd>{{ dt(selectedCameraEvent.detectedAt) }}</dd>
      </div>
      <div>
        <dt>{{ ct('Duration') }}</dt>
        <dd>{{ formatDuration(selectedCameraEvent.durationSeconds) }}</dd>
      </div>
      <div>
        <dt>{{ ct('Current Status') }}</dt>
        <dd>{{ selectedCameraEvent.status }}</dd>
      </div>
      <div class="wide">
        <dt>{{ ct('Description') }}</dt>
        <dd>{{ selectedCameraEvent.description }}</dd>
      </div>
    </dl>
    <h3>{{ ct('Event Recording') }}</h3>
    <video
      v-if="isWebVideoUrl(selectedCameraEvent.videoUrl)"
      class="event-video"
      :src="selectedCameraEvent.videoUrl"
      controls
      preload="metadata"
    ></video>
    <div v-else class="recording-unavailable">
      <strong>{{ ct('Recording unavailable') }}</strong
      ><span>{{ ct('Awaiting secure video-serving integration') }}</span>
    </div>
    <div class="modal-actions">
      <RouterLink
        class="secondary-button plant-link"
        :to="`/plant/${selectedCameraEvent.plantId}`"
        >{{ ct('View Plant') }}</RouterLink
      >
    </div>
  </AppModal>

  <AppModal
    v-if="selectedAlert"
    :title="`${formatAlertId(selectedAlert.id)} · ${selectedAlert.metric}`"
    :subtitle="`${selectedAlert.deviceId} · canonical alert`"
    wide
    @close="selectedAlert = null"
  >
    <dl class="detail-list real-alert-details">
      <div>
        <dt>{{ ct('Reading Reference') }}</dt>
        <dd>{{ selectedAlert.readingId ?? '—' }}</dd>
      </div>
      <div>
        <dt>{{ ct('Device') }}</dt>
        <dd>{{ selectedAlert.deviceId }}</dd>
      </div>
      <div>
        <dt>{{ ct('Detection Confidence') }}</dt>
        <dd>Not available</dd>
      </div>
      <div>
        <dt>{{ ct('Timestamp') }}</dt>
        <dd>{{ dt(selectedAlert.detectedAt) }}</dd>
      </div>
      <div>
        <dt>{{ ct('Severity') }}</dt>
        <dd>Not available</dd>
      </div>
      <div>
        <dt>{{ ct('Current Status') }}</dt>
        <dd>{{ selectedAlert.status }}</dd>
      </div>
      <div>
        <dt>{{ ct('Metric Value') }}</dt>
        <dd>{{ selectedAlert.value }}</dd>
      </div>
      <div>
        <dt>{{ ct('Created At') }}</dt>
        <dd>{{ dt(selectedAlert.createdAt) }}</dd>
      </div>
      <div class="wide">
        <dt>{{ ct('Camera Reference') }}</dt>
        <dd>{{ selectedAlert.cameraId ?? '—' }}</dd>
      </div>
    </dl>
    <h3>{{ ct('Response History') }}</h3>
    <div v-if="!selectedAlert.responses.length" class="evidence-unavailable">
      <strong>No response history recorded</strong>
      <span>Canonical response history will appear after a saved Officer action.</span>
    </div>
    <dl v-else class="detail-list real-alert-details">
      <div v-for="response in selectedAlert.responses" :key="response.id" class="wide">
        <dt>{{ response.status }} · {{ dt(response.createdAt) }}</dt>
        <dd>{{ response.note }} · {{ response.officerSubject }}</dd>
      </div>
    </dl>
    <label class="field">
      <span>Response status</span>
      <select v-model="responseStatus" :disabled="selectedAlert.status === 'Resolved' || isSavingResponse">
        <option value="Reviewing">Reviewing</option>
        <option value="Resolved">Resolved</option>
      </select>
    </label>
    <label class="field">
      <span>Response note</span>
      <textarea v-model="responseNote" :disabled="selectedAlert.status === 'Resolved' || isSavingResponse"></textarea>
    </label>
    <p v-if="responseError" class="state-message error-state">{{ responseError }}</p>
    <p v-if="responseFeedback" class="state-message">{{ responseFeedback }}</p>
    <div class="modal-actions">
      <button
        class="primary-button"
        type="button"
        :disabled="selectedAlert.status === 'Resolved' || isSavingResponse"
        :title="selectedAlert.status === 'Resolved' ? 'Resolved alerts cannot receive another response.' : ''"
        @click="submitResponse"
      >{{ isSavingResponse ? 'Saving...' : 'Save Response' }}</button>
    </div>
  </AppModal>
</template>

<style scoped>
.camera-alert-panel {
  margin-bottom: 18px;
}
.camera-event-details .wide,
.real-alert-details .wide {
  grid-column: 1 / -1;
}
.recording-unavailable,
.evidence-unavailable {
  min-height: 180px;
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
.recording-unavailable span,
.evidence-unavailable span {
  color: #819088;
  font-size: 10px;
}
.event-video {
  width: 100%;
  max-height: 420px;
  border-radius: 11px;
  background: #17221e;
}
.plant-link {
  display: inline-flex;
  align-items: center;
  text-decoration: none;
}
a.action-button {
  text-decoration: none;
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
</style>
