<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import MonitoringIdentifier from '../../components/conservation/MonitoringIdentifier.vue'
import { monitoringLabels } from '../../utils/officerMonitoringDisplay'
import { iotDate, deviceDisplayTitle } from '../../utils/iotDisplay'
import { sessionSnapshot, subscribeSession, type AuthUser } from '../../services/auth'
import AppModal from '../../components/conservation/AppModal.vue'
import ActionFeedback from '../../components/ActionFeedback.vue'
import { loadCanonicalAlerts, CANONICAL_ALERT_CAP } from '../../services/threatAlerts'
import CameraMonitoringSection from '../../components/CameraMonitoringSection.vue'
import SensorHistoryChart, {
  type SensorChartPoint,
} from '../../components/conservation/SensorHistoryChart.vue'
import { useConservationText } from '../../composables/useConservationText'
import { formatPlantId } from '../../utils/plantId'
import {
  loadCanonicalDevices,
  loadCanonicalHistory,
  loadLatestReadings,
  type IoTDevice as ApiSensorDevice,
  type IoTReading as ApiSensorReading,
} from '../../services/iotMonitoring'

const { t } = useI18n()
const { ct } = useConservationText()
const dt = iotDate
const router = useRouter()
const devices = ref<ApiSensorDevice[]>([])
const selectedDevice = ref<ApiSensorDevice | null>(null)
const selectedReading = ref<ApiSensorReading | null>(null)
const historyDevice = ref<ApiSensorDevice | null>(null)
const historyReadings = ref<ApiSensorReading[]>([])
const deviceLabels = computed(() => monitoringLabels([...devices.value.map(item => item.sensor_id), selectedDevice.value?.sensor_id, historyDevice.value?.sensor_id]))
const readingLabels = computed(() => monitoringLabels([...readingDevices.value.map(item => item.latest_reading?.reading_id), ...historyReadings.value.map(item => item.reading_id), selectedReading.value?.reading_id]))
const historyHasMore = ref(false)
const isHistoryLoading = ref(false)
const historyErrorMessage = ref('')
const search = ref('')
const status = ref('')
const type = ref('')
const isLoading = ref(true)
const errorMessage = ref('')

const readingDevices = ref<ApiSensorDevice[]>([])
const isRefreshing = ref(false)
const refreshError = ref('')
const isLookingDeviceAlerts = ref(false)
const deviceAlertFeedback = ref<{ id: number; variant: 'info' | 'error'; title: string; message: string } | null>(null)
let deviceAlertEpoch = 0, deviceAlertFeedbackId = 0
let deviceAlertRequest: AbortController | null = null
const invalidateDeviceAlerts = () => {
  deviceAlertEpoch++
  deviceAlertRequest?.abort(); deviceAlertRequest = null
  isLookingDeviceAlerts.value = false; deviceAlertFeedback.value = null
}
const dismissDeviceAlertFeedback = (id: number) => {
  if (deviceAlertFeedback.value?.id === id) deviceAlertFeedback.value = null
}
watch(() => selectedDevice.value?.sensor_id, invalidateDeviceAlerts, { flush: 'sync' })
let generation = 0, disposed = false
let initialRequest: AbortController | null = null, refreshRequest: AbortController | null = null
const sessionKey = (user: AuthUser | null, pending: boolean) => !pending && user?.status === 'Active' &&
  user.mustChangePassword === false && ['Conservation Officer', 'Administrator'].includes(user.role) ? `${user.id}:${user.role}` : ''
let identity = sessionKey(sessionSnapshot().user, sessionSnapshot().pending)
const clearSessionData = () => {
  generation++
  invalidateDeviceAlerts()
  initialRequest?.abort(); refreshRequest?.abort()
  devices.value = []; readingDevices.value = []; historyReadings.value = []
  selectedDevice.value = null; selectedReading.value = null; historyDevice.value = null
  isLoading.value = false; isRefreshing.value = false; isHistoryLoading.value = false
  errorMessage.value = ''; refreshError.value = ''; historyErrorMessage.value = ''
}
const loadDevices = async () => {
  if (!identity || disposed || initialRequest) return
  const version = generation, controller = new AbortController()
  initialRequest = controller
  isLoading.value = true
  errorMessage.value = ''
  try {
    const result = await loadCanonicalDevices(controller.signal)
    if (version !== generation || disposed) return
    devices.value = result
    readingDevices.value = result
  } catch (error) {
    if (version !== generation || disposed) return
    devices.value = []; readingDevices.value = []
    errorMessage.value = error instanceof Error ? error.message : 'Unable to retrieve IoT devices.'
  } finally {
    if (initialRequest === controller) initialRequest = null
    if (version === generation && !disposed) isLoading.value = false
  }
}
const refreshReadings = async () => {
  if (!identity || disposed || isLoading.value || isRefreshing.value) return
  const version = generation, controller = new AbortController()
  refreshRequest = controller
  isRefreshing.value = true
  refreshError.value = ''
  try {
    const result = await loadLatestReadings(devices.value, controller.signal)
    if (version !== generation || disposed) return
    readingDevices.value = result
  } catch (error) {
    controller.abort()
    if (version !== generation || disposed) return
    refreshError.value = error instanceof Error ? error.message : 'Unable to refresh sensor readings. Please try again.'
  } finally {
    if (refreshRequest === controller) refreshRequest = null
    if (version === generation && !disposed) isRefreshing.value = false
  }
}
const unsubscribe = subscribeSession((user, pending) => {
  const nextIdentity = sessionKey(user, pending)
  if (identity === nextIdentity) return
  identity = nextIdentity
  clearSessionData()
  initialRequest = null; refreshRequest = null
  if (identity) void loadDevices()
})
onBeforeUnmount(() => { disposed = true; unsubscribe(); clearSessionData() })
onMounted(loadDevices)

const filteredDevices = computed(() =>
  devices.value.filter((device) => {
    const reading = device.latest_reading
    const plantId = reading?.plant_id ? formatPlantId(reading.plant_id) : ''
    const matchesSearch =
      `${device.sensor_id} ${device.device_name} ${device.device_type} ${device.status} ${device.serial_number ?? ''} ${device.location_description ?? ''} ${plantId ?? ''}`
        .toLowerCase()
        .includes(search.value.toLowerCase())
    return (
      matchesSearch &&
      (!status.value || device.status === status.value) &&
      (!type.value || device.device_type === type.value)
    )
  }),
)

const latestReadings = computed(() =>
  readingDevices.value.flatMap((device) =>
    device.latest_reading ? [{ device, reading: device.latest_reading }] : [],
  ),
)
const statusOptions = computed(() => [...new Set(devices.value.map((device) => device.status))])
const typeOptions = computed(() => [...new Set(devices.value.map((device) => device.device_type))])
const cards = computed(() => [
  ['totalDevices', devices.value.length],
  [
    'onlineDevices',
    devices.value.some((device) => device.status.toLowerCase() === 'online')
      ? devices.value.filter((device) => device.status.toLowerCase() === 'online').length
      : '—',
  ],
  [
    'offlineDevices',
    devices.value.some((device) => device.status.toLowerCase() === 'offline')
      ? devices.value.filter((device) => device.status.toLowerCase() === 'offline').length
      : '—',
  ],
  ['latestReadings', latestReadings.value.length],
])

const valueOrDash = (value: string | number | null | undefined, suffix = '') =>
  value === null || value === undefined || value === '' ? '—' : `${value}${suffix}`
const plantDisplayId = (reading: ApiSensorReading | null) =>
  reading?.plant_id ? formatPlantId(reading.plant_id) || '—' : '—'
const gpsValue = (reading: ApiSensorReading | null) =>
  reading?.gps_latitude !== null &&
  reading?.gps_latitude !== undefined &&
  reading?.gps_longitude !== null &&
  reading?.gps_longitude !== undefined
    ? `${reading.gps_latitude}, ${reading.gps_longitude}`
    : '—'
const motionValue = (reading: ApiSensorReading) => {
  if (reading.motion_detected === null) return '—'
  return reading.motion_detected ? 'Detected' : 'No motion'
}

const viewDeviceAlerts = async (device: ApiSensorDevice) => {
  if (!identity || disposed || selectedDevice.value?.sensor_id !== device.sensor_id ||
      isLookingDeviceAlerts.value || deviceAlertFeedback.value?.variant === 'info') return
  const version = generation, epoch = ++deviceAlertEpoch, controller = new AbortController()
  deviceAlertRequest = controller
  isLookingDeviceAlerts.value = true
  deviceAlertFeedback.value = null
  const current = () => !disposed && version === generation && epoch === deviceAlertEpoch &&
    selectedDevice.value?.sensor_id === device.sensor_id
  try {
    const alerts = await loadCanonicalAlerts(controller.signal)
    if (!current()) return
    if (alerts.some(alert => alert.deviceId === String(device.sensor_id))) {
      selectedDevice.value = null
      void router.push({ name: 'conservation-alerts', query: { device: String(device.sensor_id) } })
    } else if (alerts.length >= CANONICAL_ALERT_CAP) {
      deviceAlertFeedback.value = { id: ++deviceAlertFeedbackId, variant: 'error', title: 'Threat alerts unavailable',
        message: 'The alert list is limited. Unable to confirm whether this device has recorded alerts.' }
    } else {
      deviceAlertFeedback.value = { id: ++deviceAlertFeedbackId, variant: 'info', title: 'No threat alerts found',
        message: 'There are currently no recorded threat alerts for this device.' }
    }
  } catch {
    if (current()) deviceAlertFeedback.value = { id: ++deviceAlertFeedbackId, variant: 'error', title: 'Threat alerts unavailable',
      message: 'Unable to load threat alerts. Please try again.' }
  } finally {
    if (deviceAlertRequest === controller) deviceAlertRequest = null
    if (current()) isLookingDeviceAlerts.value = false
  }
}

const viewReadingAlerts = (reading: ApiSensorReading) => {
  selectedReading.value = null
  void router.push({
    name: 'conservation-alerts',
    query: { reading: String(reading.reading_id) },
  })
}

const viewReadingOnMap = (reading: ApiSensorReading, source: 'device' | 'reading') => {
  const plantId = reading.plant_id ? formatPlantId(reading.plant_id) : null
  if (!plantId) return

  if (source === 'device') selectedDevice.value = null
  else selectedReading.value = null

  void router.push({ name: 'conservation-map', query: { plant: plantId } })
}

const loadReadingHistory = async (device: ApiSensorDevice) => {
  const version = generation
  historyDevice.value = device
  selectedDevice.value = null
  historyReadings.value = []
  historyHasMore.value = false
  historyErrorMessage.value = ''
  isHistoryLoading.value = true
  try {
    const result = await loadCanonicalHistory(device)
    if (version !== generation || disposed || historyDevice.value?.sensor_id !== device.sensor_id) return
    historyReadings.value = result.readings
    historyHasMore.value = result.hasMore
  } catch (error) {
    if (version !== generation || disposed) return
    historyErrorMessage.value =
      error instanceof Error ? error.message : 'Unable to retrieve sensor readings.'
  } finally {
    if (version === generation && !disposed) isHistoryLoading.value = false
  }
}

const closeReadingHistory = () => {
  historyDevice.value = null
  historyReadings.value = []
  historyHasMore.value = false
  historyErrorMessage.value = ''
}

type NumericReadingField = 'temperature_c' | 'humidity' | 'soil_moisture' | 'rainfall_mm'
const chartPointsFor = (field: NumericReadingField): SensorChartPoint[] =>
  historyReadings.value
    .filter((reading) => reading[field] !== null && Number.isFinite(Number(reading[field])))
    .map((reading) => ({ recordedAt: reading.recorded_at, value: Number(reading[field]) }))
    .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime())

const temperatureChartPoints = computed(() => chartPointsFor('temperature_c'))
const humidityChartPoints = computed(() => chartPointsFor('humidity'))
const soilMoistureChartPoints = computed(() => chartPointsFor('soil_moisture'))
const rainfallChartPoints = computed(() => chartPointsFor('rainfall_mm'))
</script>

<template>
  <ActionFeedback v-if="deviceAlertFeedback" :key="deviceAlertFeedback.id" :feedback-id="deviceAlertFeedback.id" :variant="deviceAlertFeedback.variant" :title="deviceAlertFeedback.title" :message="deviceAlertFeedback.message" @dismiss="dismissDeviceAlertFeedback" />
  <section class="page-intro">
    <div>
      <p class="page-kicker">{{ t('conservationPages.iot.eyebrow') }}</p>
      <h2>{{ t('conservationPages.iot.title') }}</h2>
      <p>{{ t('conservationPages.iot.intro') }}</p>
    </div>
  </section>

  <section class="summary-grid">
    <article v-for="card in cards" :key="String(card[0])" class="summary-card">
      <p>{{ t(`conservationPages.iot.cards.${card[0]}`) }}</p>
      <strong>{{ card[1] }}</strong
      ><small>Database records</small>
    </article>
  </section>

  <CameraMonitoringSection />

  <div class="control-bar">
    <label class="field search-field">
      <span>{{ t('common.search') }}</span>
      <input v-model="search" :placeholder="t('conservationPages.iot.searchPlaceholder')" />
    </label>
    <label class="field">
      <span>{{ t('conservationPages.iot.deviceStatus') }}</span>
      <select v-model="status">
        <option value="">{{ t('common.allStatuses') }}</option>
        <option v-for="item in statusOptions" :key="item" :value="item">{{ ct(item) }}</option>
      </select>
    </label>
    <label class="field">
      <span>{{ t('conservationPages.iot.deviceType') }}</span>
      <select v-model="type">
        <option value="">{{ t('conservationPages.iot.allTypes') }}</option>
        <option v-for="item in typeOptions" :key="item" :value="item">{{ ct(item) }}</option>
      </select>
    </label>
  </div>

  <p v-if="isLoading" class="state-message">Loading sensor devices...</p>
  <div v-else-if="errorMessage" class="state-message error-state">
    <p>{{ errorMessage }}</p>
    <button class="action-button" type="button" @click="loadDevices">Try again</button>
  </div>

  <template v-else>
    <section class="panel">
      <header class="panel-header">
        <div>
          <h2>{{ t('conservationPages.iot.devices') }}</h2>
          <span class="panel-description"
            >PostgreSQL sensor devices and their latest readings.</span
          >
        </div>
      </header>
      <p v-if="!filteredDevices.length" class="state-message">No sensor devices found.</p>
      <div v-else class="table-scroll officer-table-scroll" role="region" :aria-label="t('conservationPages.iot.devices')" tabindex="0">
        <table class="officer-data-table iot-device-table"><colgroup><col class="column-id" /><col class="column-name" /><col class="column-type" /><col class="column-identifier" /><col class="column-plant" /><col class="column-description" /><col class="column-status" /><col class="column-time" /><col class="column-time" /><col class="column-actions" /></colgroup>
          <thead>
            <tr>
              <th scope="col">Sensor ID</th>
              <th scope="col">Device Name</th>
              <th scope="col">Device Type</th>
              <th scope="col">Serial Number</th>
              <th scope="col">Related Plant</th>
              <th scope="col">Location Description</th>
              <th scope="col">Status</th>
              <th scope="col">Installed At</th>
              <th scope="col">Latest Reading</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="device in filteredDevices" :key="String(device.sensor_id)">
              <td>
                <strong><MonitoringIdentifier :value="device.sensor_id" :labels="deviceLabels" /></strong>
              </td>
              <td>{{ device.device_name }}</td>
              <td>{{ device.device_type }}</td>
              <td>{{ valueOrDash(device.serial_number) }}</td>
              <td>{{ plantDisplayId(device.latest_reading) }}</td>
              <td>{{ valueOrDash(device.location_description) }}</td>
              <td>
                <span class="badge" :class="device.status.toLowerCase()">{{ device.status }}</span>
              </td>
              <td>{{ device.installed_at ? dt(device.installed_at) : '—' }}</td>
              <td>
                {{ device.latest_reading ? dt(device.latest_reading.recorded_at) : 'No reading' }}
              </td>
              <td>
                <div class="action-group">
                  <button class="action-button" @click="selectedDevice = device">
                    {{ t('common.view') }}
                  </button>
                  <button
                    v-if="device.latest_reading"
                    class="action-button"
                    @click="selectedReading = device.latest_reading"
                  >
                    View Reading
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <header class="panel-header">
        <div>
          <h2>{{ t('conservationPages.iot.recentReadings') }}</h2>
          <span class="panel-description">Latest stored reading for each device only. Refresh manually for updates.</span>
        </div>
        <button class="action-button" type="button" :disabled="isRefreshing || isLoading || !identity" :aria-busy="isRefreshing" @click="refreshReadings">{{ isRefreshing ? 'Refreshing...' : 'Refresh' }}</button>
      </header>
      <div v-if="refreshError" class="state-message error-state" role="alert">
        <p>{{ refreshError }}</p>
        <button class="action-button" type="button" :disabled="isRefreshing || !identity" @click="refreshReadings">Try again</button>
      </div>
      <p v-if="!latestReadings.length" class="state-message">No sensor readings available.</p>
      <div v-else class="table-scroll officer-table-scroll" role="region" :aria-label="t('conservationPages.iot.recentReadings')" tabindex="0">
        <table class="officer-data-table iot-reading-table"><colgroup><col class="column-id" /><col class="column-identifier" /><col class="column-plant" /><col class="column-metric" /><col class="column-metric" /><col class="column-metric" /><col class="column-metric" /><col class="column-status" /><col class="column-coordinates" /><col class="column-time" /><col class="column-actions" /></colgroup>
          <thead>
            <tr>
              <th scope="col">Reading ID</th>
              <th scope="col">Sensor ID</th>
              <th scope="col">Plant ID</th>
              <th scope="col">Temperature</th>
              <th scope="col">Humidity</th>
              <th scope="col">Soil Moisture</th>
              <th scope="col">Rainfall</th>
              <th scope="col">Motion</th>
              <th scope="col">GPS</th>
              <th scope="col">Recorded At</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in latestReadings" :key="String(item.reading.reading_id)">
              <td>
                <strong><MonitoringIdentifier :value="item.reading.reading_id" :labels="readingLabels" /></strong>
              </td>
              <td><MonitoringIdentifier :value="item.device.sensor_id" :labels="deviceLabels" /></td>
              <td>{{ plantDisplayId(item.reading) }}</td>
              <td>{{ valueOrDash(item.reading.temperature_c, ' °C') }}</td>
              <td>{{ valueOrDash(item.reading.humidity, '%') }}</td>
              <td>{{ valueOrDash(item.reading.soil_moisture, '%') }}</td>
              <td>{{ valueOrDash(item.reading.rainfall_mm, ' mm') }}</td>
              <td>
                <span class="badge" :class="item.reading.motion_detected ? 'high' : 'approved'">{{
                  motionValue(item.reading)
                }}</span>
              </td>
              <td>{{ gpsValue(item.reading) }}</td>
              <td>{{ dt(item.reading.recorded_at) }}</td>
              <td>
                <button class="action-button" @click="selectedReading = item.reading">
                  {{ t('common.details') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>

  <AppModal
    v-if="selectedDevice"
    class="reading-details-modal device-details-modal"
    subtitle="Sensor Device"
    accessible
    :title="deviceDisplayTitle(selectedDevice.device_name)"
    @close="selectedDevice = null"
  >
    <template #title>
      <span class="reading-heading"><span class="reading-header-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.9 4.9a10 10 0 0 0 0 14.2 M19.1 4.9a10 10 0 0 1 0 14.2 M8 8a5.7 5.7 0 0 0 0 8 M16 8a5.7 5.7 0 0 1 0 8 M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z" /></svg></span><span>{{ deviceDisplayTitle(selectedDevice.device_name) }}</span></span>
    </template>
    <div class="reading-id-row"><svg class="reading-document-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z M14 2v6h6 M8 13h8 M8 17h6" /></svg><span>Device ID:</span><MonitoringIdentifier :value="selectedDevice.sensor_id" :labels="deviceLabels" copy-label="Copy full Device ID" :feedback-duration="3000" /></div>
    <dl class="reading-measurements">
      <div class="reading-measurement">
        <dt><span class="reading-field-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 10 5-10 5L2 8Z M2 12l10 5 10-5 M2 16l10 5 10-5" /></svg></span>Device Type</dt>
        <dd>{{ selectedDevice.device_type }}</dd>
      </div>
      <div class="reading-measurement">
        <dt><span class="reading-field-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3 8 21 M16 3l-2 18 M4 9h16 M3 15h16" /></svg></span>Serial Number</dt>
        <dd>{{ valueOrDash(selectedDevice.serial_number) }}</dd>
      </div>
      <div class="reading-measurement">
        <dt><span class="reading-field-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12h5l3-9 4 18 3-9h5" /></svg></span>Status</dt>
        <dd><span class="badge device-registration-status" :class="selectedDevice.status.toLowerCase()">{{ selectedDevice.status }}</span></dd>
      </div>
      <div class="reading-measurement">
        <dt><span class="reading-field-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z M14.5 10a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z" /></svg></span>Location Description</dt>
        <dd>{{ valueOrDash(selectedDevice.location_description) }}</dd>
      </div>
      <div class="reading-measurement">
        <dt><span class="reading-field-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h18v16H3Z M8 3v4 M16 3v4 M3 11h18" /></svg></span>Installed At</dt>
        <dd>{{ selectedDevice.installed_at ? dt(selectedDevice.installed_at) : '—' }}</dd>
      </div>
      <div class="reading-measurement">
        <dt><span class="reading-field-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22V10 M12 12C4 13 3 4 3 4s9-1 9 8Z M12 10C12 2 21 3 21 3s0 8-9 7Z" /></svg></span>Related Plant</dt>
        <dd>{{ plantDisplayId(selectedDevice.latest_reading) }}</dd>
      </div>
      <div class="reading-measurement">
        <dt><span class="reading-field-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20v-6h3v6Z M10 20V8h3v12Z M16 20V3h3v17Z" /></svg></span>Latest Reading</dt>
        <dd>
          {{
            selectedDevice.latest_reading
              ? dt(selectedDevice.latest_reading.recorded_at)
              : 'No reading available'
          }}
        </dd>
      </div>
    </dl>
    <div class="modal-actions reading-actions device-actions">
      <button class="action-button device-history-button" type="button" @click="loadReadingHistory(selectedDevice)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20v-6h3v6Z M10 20V8h3v12Z M16 20V3h3v17Z" /></svg><span>View Reading History</span>
      </button>
      <button class="action-button" type="button" :disabled="isLookingDeviceAlerts" :aria-busy="isLookingDeviceAlerts" @click="viewDeviceAlerts(selectedDevice)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4" /></svg><span>View Alerts</span>
      </button>
      <button
        v-if="
          selectedDevice.latest_reading?.plant_id &&
          formatPlantId(selectedDevice.latest_reading.plant_id)
        "
        class="action-button"
        type="button"
        @click="viewReadingOnMap(selectedDevice.latest_reading, 'device')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z M14.5 10a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z" /></svg><span>View on Map</span>
      </button>
    </div>
  </AppModal>

  <AppModal
    v-if="historyDevice"
    :title="`Reading History · ${historyDevice.device_name}`"
    :subtitle="`Sensor ${deviceLabels.get(String(historyDevice.sensor_id)) || historyDevice.sensor_id}`"
    wide
    @close="closeReadingHistory"
  >
    <MonitoringIdentifier :value="historyDevice.sensor_id" :labels="deviceLabels" />
    <p v-if="isHistoryLoading" class="state-message">Loading reading history...</p>
    <div v-else-if="historyErrorMessage" class="state-message error-state">
      <p>{{ historyErrorMessage }}</p>
      <button class="action-button" type="button" @click="loadReadingHistory(historyDevice)">
        Try again
      </button>
    </div>
    <p v-else-if="!historyReadings.length" class="state-message">
      No historical readings are available for this sensor.
    </p>
    <template v-else>
      <p v-if="historyHasMore" class="state-message">
        Showing the latest {{ historyReadings.length }} readings. More history is available.
      </p>
      <section class="history-charts" aria-label="Historical sensor charts">
        <SensorHistoryChart
          title="Temperature over time"
          unit="°C"
          empty-message="No temperature history available."
          :points="temperatureChartPoints"
        />
        <SensorHistoryChart
          title="Humidity over time"
          unit="%"
          empty-message="No humidity history available."
          :points="humidityChartPoints"
        />
        <SensorHistoryChart
          title="Soil moisture over time"
          unit="%"
          empty-message="No soil moisture history available."
          :points="soilMoistureChartPoints"
        />
        <SensorHistoryChart
          title="Rainfall over time"
          unit="mm"
          type="bar"
          empty-message="No rainfall history available."
          :points="rainfallChartPoints"
        />
      </section>
      <div class="table-scroll officer-table-scroll history-table" role="region" :aria-label="`Reading History · ${historyDevice.device_name}`" tabindex="0">
        <table class="officer-data-table iot-history-table"><colgroup><col class="column-id" /><col class="column-time" /><col class="column-plant" /><col class="column-metric" /><col class="column-metric" /><col class="column-metric" /><col class="column-metric" /><col class="column-status" /><col class="column-coordinates" /></colgroup>
          <thead>
            <tr>
              <th scope="col">Reading ID</th>
              <th scope="col">Recorded Time</th>
              <th scope="col">Related Plant</th>
              <th scope="col">Temperature</th>
              <th scope="col">Humidity</th>
              <th scope="col">Soil Moisture</th>
              <th scope="col">Rainfall</th>
              <th scope="col">Motion</th>
              <th scope="col">GPS</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="reading in historyReadings" :key="String(reading.reading_id)">
              <td>
                <strong><MonitoringIdentifier :value="reading.reading_id" :labels="readingLabels" /></strong>
              </td>
              <td>{{ dt(reading.recorded_at) }}</td>
              <td>{{ plantDisplayId(reading) }}</td>
              <td>{{ valueOrDash(reading.temperature_c, ' °C') }}</td>
              <td>{{ valueOrDash(reading.humidity, '%') }}</td>
              <td>{{ valueOrDash(reading.soil_moisture, '%') }}</td>
              <td>{{ valueOrDash(reading.rainfall_mm, ' mm') }}</td>
              <td>{{ motionValue(reading) }}</td>
              <td>{{ gpsValue(reading) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </AppModal>

  <AppModal
    v-if="selectedReading"
    class="reading-details-modal"
    title="Sensor Reading Details"
    :subtitle="`Plant ${plantDisplayId(selectedReading)}`"
    accessible
    @close="selectedReading = null"
  >
    <template #title>
      <span class="reading-heading">
        <span class="reading-header-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h5l3-9 4 18 3-9h5" /></svg></span>
        <span>Sensor Reading Details</span>
      </span>
    </template>
    <div class="reading-id-row">
      <svg class="reading-document-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z M14 2v6h6 M8 13h8 M8 17h6" /></svg>
      <span>Reading ID:</span>
      <MonitoringIdentifier :value="selectedReading.reading_id" :labels="readingLabels" copy-label="Copy full Reading ID" :feedback-duration="3000" />
    </div>
    <dl class="reading-measurements">
      <div class="reading-measurement">
        <dt><span class="reading-field-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14.8V5a3 3 0 0 1 6 0v9.8a5 5 0 1 1-6 0Z M12 8v9" /></svg></span>Temperature</dt>
        <dd>{{ valueOrDash(selectedReading.temperature_c, ' °C') }}</dd>
      </div>
      <div class="reading-measurement">
        <dt><span class="reading-field-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2s-7 8-7 13a7 7 0 0 0 14 0c0-5-7-13-7-13Z M15 16a3 3 0 0 1-3 3" /></svg></span>Humidity</dt>
        <dd>{{ valueOrDash(selectedReading.humidity, '%') }}</dd>
      </div>
      <div class="reading-measurement">
        <dt><span class="reading-field-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 19c5-5 13-5 18 0 M12 16V9 M12 10C6 11 5 5 5 5s7-1 7 5Z M12 9c0-5 7-5 7-5s0 6-7 5Z M6 22h.01 M12 21h.01 M18 22h.01" /></svg></span>Soil Moisture</dt>
        <dd>{{ valueOrDash(selectedReading.soil_moisture, '%') }}</dd>
      </div>
      <div class="reading-measurement">
        <dt><span class="reading-field-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 15a4 4 0 0 1-1-7 6 6 0 0 1 11-3 5 5 0 1 1 3 10Z M7 18l-2 4 M13 18l-2 4 M19 18l-2 4" /></svg></span>Rainfall</dt>
        <dd>{{ valueOrDash(selectedReading.rainfall_mm, ' mm') }}</dd>
      </div>
      <div class="reading-measurement">
        <dt><span class="reading-field-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 4.9a10 10 0 0 0 0 14.2 M19.1 4.9a10 10 0 0 1 0 14.2 M8 8a5.7 5.7 0 0 0 0 8 M16 8a5.7 5.7 0 0 1 0 8 M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z" /></svg></span>Motion</dt>
        <dd><span class="badge reading-motion" :class="selectedReading.motion_detected ? 'detected' : 'quiet'">{{ motionValue(selectedReading) }}</span></dd>
      </div>
      <div class="reading-measurement">
        <dt><span class="reading-field-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></svg></span>GPS</dt>
        <dd>{{ gpsValue(selectedReading) }}</dd>
      </div>
      <div class="reading-measurement reading-recorded-at">
        <dt><span class="reading-field-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4 M8 3v4 M3 11h18" /></svg></span>Recorded At</dt>
        <dd>{{ dt(selectedReading.recorded_at) }}</dd>
      </div>
    </dl>
    <div class="modal-actions reading-actions">
      <button class="action-button" type="button" @click="viewReadingAlerts(selectedReading)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4" /></svg><span>View Alerts</span>
      </button>
      <button
        v-if="selectedReading.plant_id && formatPlantId(selectedReading.plant_id)"
        class="action-button"
        type="button"
        @click="viewReadingOnMap(selectedReading, 'reading')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></svg><span>View on Map</span>
      </button>
    </div>
  </AppModal>
</template>

<style scoped>
.device-registration-status.active { background: #DCFCE7; color: #166534; }
.device-registration-status.inactive { background: #E5E7EB; color: #374151; }
.officer-layout.officer-layout .device-details-modal .device-actions .action-button.device-history-button { background: var(--green, #33745d); border-color: var(--green, #33745d); color: #fff; }
.officer-layout.officer-layout .device-details-modal .device-actions .action-button.device-history-button:hover { background: var(--forest, #173f34); border-color: var(--forest, #173f34); }

.officer-layout.officer-layout .reading-details-modal :deep(.modal-card) { width: min(800px, 100%); padding: 24px 28px; border-radius: 20px; }
.officer-layout.officer-layout .reading-details-modal :deep(.modal-header) { align-items: flex-start; margin-bottom: 16px; }
.officer-layout.officer-layout .reading-details-modal :deep(.modal-header > div) { position: relative; min-height: 56px; padding-left: 72px; }
.officer-layout.officer-layout .reading-details-modal :deep(.modal-header h2) { font-size: clamp(20px, 2.2vw, 24px); line-height: 1.3; }
.officer-layout.officer-layout .reading-details-modal :deep(.modal-header p) { margin-top: 4px; font-size: 14px; }
.officer-layout.officer-layout .reading-details-modal :deep(.close-button) { flex: 0 0 44px; width: 44px; height: 44px; }
.reading-heading { display: block; padding-top: 3px; }
.reading-header-icon { position: absolute; top: 0; left: 0; display: grid; place-items: center; width: 56px; height: 56px; border-radius: 12px; background: #e7f5e8; color: #166534; }
.reading-header-icon svg { width: 32px; height: 32px; }
.reading-id-row { position: relative; display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; margin-bottom: 4px; padding: 0 0 20px; background: transparent; color: #166534; font-size: 15px; font-weight: 700; }
.reading-document-icon { flex: 0 0 24px; width: 24px; height: 24px; margin-right: 8px; }
.reading-id-row :deep(.monitoring-identifier) { min-width: 0; }
.reading-id-row :deep(.monitoring-copy-feedback) { position: absolute; bottom: 0; left: 40px; max-width: calc(100% - 40px); color: #166534; font-size: 12px; line-height: 1.4; font-weight: 400; }
.reading-id-row :deep(.monitoring-id-line) { min-width: 0; max-width: 100%; white-space: normal; }
.reading-id-row :deep(.monitoring-id-line > span) { min-width: 0; overflow-wrap: anywhere; }
.reading-measurements { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 24px; margin: 0; }
.reading-measurement { position: relative; min-width: 0; min-height: 80px; padding: 14px 0 14px 64px; border-bottom: 1px solid #e3eae5; }
.officer-layout.officer-layout .reading-details-modal .reading-measurement dt { color: #5b7065; font-size: 12px; font-weight: 800; line-height: 1.5; text-transform: uppercase; }
.officer-layout.officer-layout .reading-details-modal .reading-measurement dd { margin: 4px 0 0; color: #172f27; font-size: 18px; line-height: 1.4; overflow-wrap: anywhere; }
.reading-field-icon { position: absolute; top: 14px; left: 0; display: grid; place-items: center; width: 44px; height: 44px; border-radius: 10px; background: #e7f5e8; color: #166534; }
.reading-field-icon svg { width: 26px; height: 26px; }
.reading-recorded-at { grid-column: 1 / -1; }
.reading-motion { display: inline-flex; padding: 4px 12px; border-radius: 999px; font-size: 14px; font-weight: 600; background: #E5E7EB; color: #374151; }
.reading-motion.detected { background: #FFEDD5; color: #9A3412; }
.officer-layout.officer-layout .reading-details-modal .reading-actions { justify-content: flex-end; gap: 12px; margin-top: 18px; }
.officer-layout.officer-layout .reading-details-modal .reading-actions .action-button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; max-width: 100%; padding: 8px 18px; border: 1px solid #33745d; background: #fff; color: #245c40; font-weight: 700; white-space: normal; }
.reading-actions svg { flex: 0 0 20px; width: 20px; height: 20px; }
@media (max-width: 620px) {
  .officer-layout.officer-layout .reading-details-modal :deep(.modal-card) { padding: 20px 18px; border-radius: 18px; }
  .officer-layout.officer-layout .reading-details-modal :deep(.modal-header > div) { min-height: 48px; padding-left: 62px; }
  .officer-layout.officer-layout .reading-details-modal :deep(.modal-header h2) { font-size: 18px; }
  .officer-layout.officer-layout .reading-details-modal :deep(.modal-header p) { font-size: 14px; }
  .reading-header-icon { width: 48px; height: 48px; border-radius: 10px; }
  .reading-header-icon svg { width: 30px; height: 30px; }
  .reading-id-row { font-size: 15px; }
  .reading-measurements { grid-template-columns: minmax(0, 1fr); }
  .reading-measurement { min-height: 76px; padding: 12px 0 12px 62px; }
  .reading-field-icon { top: 12px; width: 44px; height: 44px; }
  .reading-field-icon svg { width: 26px; height: 26px; }
  .officer-layout.officer-layout .reading-details-modal .reading-measurement dd { font-size: 18px; }
  .officer-layout.officer-layout .reading-details-modal .reading-actions { gap: 10px; }
  .officer-layout.officer-layout .reading-details-modal .reading-actions .action-button { flex: 1 1 170px; padding: 10px 14px; }
}
.iot-device-table .badge.active {
  background: #DCFCE7;
  color: #166534;
}
.iot-device-table .badge.inactive,
.iot-reading-table .badge.approved {
  background: #E5E7EB;
  color: #374151;
}
.iot-reading-table .badge.high {
  background: #FFEDD5;
  color: #9A3412;
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
.history-table {
  padding: 18px;
}
.history-charts {
  padding: 18px 18px 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
@media (max-width: 760px) {
  .history-charts {
    grid-template-columns: 1fr;
  }
}
</style>

<style src="../../styles/officer-data-tables.css"></style>
