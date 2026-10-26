<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppModal from '../../components/conservation/AppModal.vue'
import { useConservationText } from '../../composables/useConservationText'
import { prototypeCameraEvents } from '../../data/cameraMonitoringPrototype'
import type { CameraEvent } from '../../types/cameraMonitoring'
import { formatPlantId } from '../../utils/plantId'

interface ApiThreatAlert {
  alert_id: string | number
  plant_id: string | number
  reading_id: string | number | null
  sensor_id: string | number | null
  device_name: string | null
  alert_type: string
  severity: string
  confidence: string | number | null
  description: string | null
  image_path: string | null
  status: string
  created_at: string
  resolved_by: string | number | null
  resolved_at: string | null
  scientific_name: string | null
  common_name: string | null
}

interface ThreatAlertsResponse {
  message: string
  count: number
  alerts: ApiThreatAlert[]
}

const { ct, dt } = useConservationText()
const route = useRoute()
const alerts = ref<ApiThreatAlert[]>([])
const selectedAlert = ref<ApiThreatAlert | null>(null)
const selectedCameraEvent = ref<CameraEvent | null>(null)
const search = ref('')
const severity = ref('')
const status = ref('')
const date = ref('')
const isLoading = ref(true)
const errorMessage = ref('')

const formatAlertId = (id: string | number) => {
  const numericId = Number(id)
  return Number.isSafeInteger(numericId) && numericId > 0
    ? `ALT${String(numericId).padStart(3, '0')}`
    : String(id)
}
const plantDisplayId = (id: string | number) => formatPlantId(id) || '—'
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
const speciesLabel = (alert: ApiThreatAlert) => {
  if (alert.common_name && alert.scientific_name)
    return `${alert.common_name} (${alert.scientific_name})`
  return alert.common_name || alert.scientific_name || 'Not available'
}

const selectedAlertId = () => {
  const queryValue = route.query.alert
  if (typeof queryValue !== 'string') return
  selectedCameraEvent.value =
    prototypeCameraEvents.find((event) => event.eventId === queryValue) ?? null
  selectedAlert.value = null
  if (selectedCameraEvent.value) return

  const match = /^(?:ALT|A)?(\d+)$/i.exec(queryValue)
  if (!match) return
  selectedAlert.value =
    alerts.value.find((alert) => Number(alert.alert_id) === Number(match[1])) ?? null
}

const loadAlerts = async () => {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const response = await fetch('/api/iot/alerts')
    const result = (await response.json()) as Partial<ThreatAlertsResponse>
    if (!response.ok) throw new Error(result.message || 'Unable to retrieve threat alerts.')
    alerts.value = Array.isArray(result.alerts) ? result.alerts : []
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
watch(() => route.query.alert, selectedAlertId)

const severityOptions = computed(() => [...new Set(alerts.value.map((alert) => alert.severity))])
const statusOptions = computed(() => [...new Set(alerts.value.map((alert) => alert.status))])
const filteredAlerts = computed(() =>
  alerts.value.filter((alert) => {
    const displayId = formatAlertId(alert.alert_id)
    const plantId = plantDisplayId(alert.plant_id)
    const searchable =
      `${displayId} ${alert.alert_id} ${plantId} ${alert.alert_type} ${alert.description ?? ''} ${alert.device_name ?? ''} ${alert.scientific_name ?? ''} ${alert.common_name ?? ''}`
        .toLowerCase()
        .includes(search.value.toLowerCase())
    return (
      searchable &&
      (!severity.value || alert.severity === severity.value) &&
      (!status.value || alert.status === status.value) &&
      (!date.value || alert.created_at.slice(0, 10) === date.value)
    )
  }),
)
const cards = computed(() => [
  [
    'Active Alerts',
    alerts.value.filter((alert) => alert.status.toLowerCase() !== 'resolved').length,
  ],
  ['High Severity', alerts.value.filter((alert) => alert.severity.toLowerCase() === 'high').length],
  [
    'Under Review',
    alerts.value.filter((alert) => alert.status.toLowerCase() === 'reviewing').length,
  ],
  ['Resolved', alerts.value.filter((alert) => alert.status.toLowerCase() === 'resolved').length],
])
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
      ><select v-model="severity">
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
        <span class="panel-description">Read-only operational alert data.</span>
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
            <th>{{ ct('Sensor') }}</th>
            <th>{{ ct('Device') }}</th>
            <th>{{ ct('Detection Confidence') }}</th>
            <th>{{ ct('Severity') }}</th>
            <th>{{ ct('Status') }}</th>
            <th>{{ ct('Detected At') }}</th>
            <th>{{ ct('Actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="alert in filteredAlerts" :key="String(alert.alert_id)">
            <td>
              <strong>{{ formatAlertId(alert.alert_id) }}</strong>
            </td>
            <td>{{ alert.alert_type }}</td>
            <td>{{ plantDisplayId(alert.plant_id) }}</td>
            <td>
              <em>{{ speciesLabel(alert) }}</em>
            </td>
            <td>{{ alert.sensor_id ?? '—' }}</td>
            <td>{{ alert.device_name || '—' }}</td>
            <td>{{ formatConfidence(alert.confidence) }}</td>
            <td>
              <span class="badge" :class="alert.severity.toLowerCase()">{{ alert.severity }}</span>
            </td>
            <td>
              <span class="badge" :class="alert.status.toLowerCase()">{{ alert.status }}</span>
            </td>
            <td>{{ dt(alert.created_at) }}</td>
            <td>
              <div class="action-group">
                <button class="action-button" @click="selectedAlert = alert">
                  {{ ct('View') }}</button
                ><RouterLink
                  class="action-button"
                  :to="`/plant/${plantDisplayId(alert.plant_id)}`"
                  >{{ ct('View Plant') }}</RouterLink
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
    :title="`${formatAlertId(selectedAlert.alert_id)} · ${selectedAlert.alert_type}`"
    :subtitle="`${plantDisplayId(selectedAlert.plant_id)} · ${speciesLabel(selectedAlert)}`"
    wide
    @close="selectedAlert = null"
  >
    <dl class="detail-list real-alert-details">
      <div>
        <dt>{{ ct('Reading Reference') }}</dt>
        <dd>{{ selectedAlert.reading_id ?? '—' }}</dd>
      </div>
      <div>
        <dt>{{ ct('Sensor / Device') }}</dt>
        <dd>
          {{ selectedAlert.sensor_id ?? '—' }} · {{ selectedAlert.device_name || 'Not available' }}
        </dd>
      </div>
      <div>
        <dt>{{ ct('Detection Confidence') }}</dt>
        <dd>{{ formatConfidence(selectedAlert.confidence) }}</dd>
      </div>
      <div>
        <dt>{{ ct('Timestamp') }}</dt>
        <dd>{{ dt(selectedAlert.created_at) }}</dd>
      </div>
      <div>
        <dt>{{ ct('Severity') }}</dt>
        <dd>{{ selectedAlert.severity }}</dd>
      </div>
      <div>
        <dt>{{ ct('Current Status') }}</dt>
        <dd>{{ selectedAlert.status }}</dd>
      </div>
      <div>
        <dt>{{ ct('Resolved By') }}</dt>
        <dd>{{ selectedAlert.resolved_by ?? '—' }}</dd>
      </div>
      <div>
        <dt>{{ ct('Resolved At') }}</dt>
        <dd>{{ selectedAlert.resolved_at ? dt(selectedAlert.resolved_at) : '—' }}</dd>
      </div>
      <div class="wide">
        <dt>{{ ct('Description') }}</dt>
        <dd>{{ selectedAlert.description || 'No description provided.' }}</dd>
      </div>
    </dl>
    <h3>{{ ct('Image Evidence') }}</h3>
    <div class="evidence-unavailable">
      <strong>{{
        selectedAlert.image_path
          ? ct('Evidence metadata recorded')
          : ct('No image evidence recorded')
      }}</strong
      ><span>{{ ct('Image unavailable until secure media serving is implemented') }}</span>
    </div>
    <div class="modal-actions">
      <RouterLink
        class="secondary-button plant-link"
        :to="`/plant/${plantDisplayId(selectedAlert.plant_id)}`"
        >{{ ct('View Plant') }}</RouterLink
      >
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
