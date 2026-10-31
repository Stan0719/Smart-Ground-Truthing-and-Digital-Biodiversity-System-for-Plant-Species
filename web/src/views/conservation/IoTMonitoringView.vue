<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import AppModal from '../../components/conservation/AppModal.vue'
import CameraMonitoringSection from '../../components/CameraMonitoringSection.vue'
import SensorHistoryChart, {
  type SensorChartPoint,
} from '../../components/conservation/SensorHistoryChart.vue'
import { useConservationText } from '../../composables/useConservationText'
import { formatPlantId } from '../../utils/plantId'

interface ApiSensorReading {
  reading_id: string | number
  plant_id: string | number
  temperature_c: string | number | null
  humidity: string | number | null
  soil_moisture: string | number | null
  rainfall_mm: string | number | null
  motion_detected: boolean | null
  gps_latitude: string | number | null
  gps_longitude: string | number | null
  recorded_at: string
}

interface ApiSensorDevice {
  sensor_id: string | number
  device_name: string
  device_type: string
  serial_number: string | null
  location_description: string | null
  status: string
  installed_at: string | null
  latest_reading: ApiSensorReading | null
}

interface IoTDevicesResponse {
  message: string
  count: number
  devices: ApiSensorDevice[]
}

interface SensorReadingsResponse {
  message: string
  sensor: Omit<ApiSensorDevice, 'installed_at' | 'latest_reading'>
  count: number
  readings: ApiSensorReading[]
}

const { t } = useI18n()
const { ct, dt } = useConservationText()
const router = useRouter()
const devices = ref<ApiSensorDevice[]>([])
const selectedDevice = ref<ApiSensorDevice | null>(null)
const selectedReading = ref<ApiSensorReading | null>(null)
const historyDevice = ref<ApiSensorDevice | null>(null)
const historyReadings = ref<ApiSensorReading[]>([])
const isHistoryLoading = ref(false)
const historyErrorMessage = ref('')
const search = ref('')
const status = ref('')
const type = ref('')
const isLoading = ref(true)
const errorMessage = ref('')

const loadDevices = async () => {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const response = await fetch('/api/iot/devices')
    const result = (await response.json()) as Partial<IoTDevicesResponse>
    if (!response.ok) throw new Error(result.message || 'Unable to retrieve IoT devices.')
    devices.value = Array.isArray(result.devices) ? result.devices : []
  } catch (error) {
    devices.value = []
    errorMessage.value = error instanceof Error ? error.message : 'Unable to retrieve IoT devices.'
  } finally {
    isLoading.value = false
  }
}

onMounted(loadDevices)

const filteredDevices = computed(() =>
  devices.value.filter((device) => {
    const reading = device.latest_reading
    const plantId = reading ? formatPlantId(reading.plant_id) : ''
    const matchesSearch =
      `${device.sensor_id} ${device.device_name} ${device.device_type} ${device.serial_number ?? ''} ${device.location_description ?? ''} ${plantId ?? ''}`
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
  devices.value.flatMap((device) =>
    device.latest_reading ? [{ device, reading: device.latest_reading }] : [],
  ),
)
const statusOptions = computed(() => [...new Set(devices.value.map((device) => device.status))])
const typeOptions = computed(() => [...new Set(devices.value.map((device) => device.device_type))])
const cards = computed(() => [
  ['totalDevices', devices.value.length],
  [
    'onlineDevices',
    devices.value.filter((device) => device.status.toLowerCase() === 'online').length,
  ],
  [
    'offlineDevices',
    devices.value.filter((device) => device.status.toLowerCase() === 'offline').length,
  ],
  ['latestReadings', latestReadings.value.length],
])

const valueOrDash = (value: string | number | null | undefined, suffix = '') =>
  value === null || value === undefined || value === '' ? '—' : `${value}${suffix}`
const plantDisplayId = (reading: ApiSensorReading | null) =>
  reading ? formatPlantId(reading.plant_id) || '—' : '—'
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

const viewDeviceAlerts = (device: ApiSensorDevice) => {
  selectedDevice.value = null
  void router.push({
    name: 'conservation-alerts',
    query: { sensor: String(device.sensor_id) },
  })
}

const viewReadingAlerts = (reading: ApiSensorReading) => {
  selectedReading.value = null
  void router.push({
    name: 'conservation-alerts',
    query: { reading: String(reading.reading_id) },
  })
}

const viewReadingOnMap = (reading: ApiSensorReading, source: 'device' | 'reading') => {
  const plantId = formatPlantId(reading.plant_id)
  if (!plantId) return

  if (source === 'device') selectedDevice.value = null
  else selectedReading.value = null

  void router.push({ name: 'conservation-map', query: { plant: plantId } })
}

const loadReadingHistory = async (device: ApiSensorDevice) => {
  historyDevice.value = device
  selectedDevice.value = null
  historyReadings.value = []
  historyErrorMessage.value = ''
  isHistoryLoading.value = true
  try {
    const response = await fetch(`/api/iot/sensors/${device.sensor_id}/readings`)
    const result = (await response.json()) as Partial<SensorReadingsResponse>
    if (!response.ok) throw new Error(result.message || 'Unable to retrieve sensor readings.')
    historyReadings.value = Array.isArray(result.readings) ? result.readings : []
  } catch (error) {
    historyErrorMessage.value =
      error instanceof Error ? error.message : 'Unable to retrieve sensor readings.'
  } finally {
    isHistoryLoading.value = false
  }
}

const closeReadingHistory = () => {
  historyDevice.value = null
  historyReadings.value = []
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
      <div v-else class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Sensor ID</th>
              <th>Device Name</th>
              <th>Device Type</th>
              <th>Serial Number</th>
              <th>Related Plant</th>
              <th>Location Description</th>
              <th>Status</th>
              <th>Installed At</th>
              <th>Latest Reading</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="device in filteredDevices" :key="String(device.sensor_id)">
              <td>
                <strong>{{ device.sensor_id }}</strong>
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
          <span class="panel-description">Latest reading for each device only.</span>
        </div>
      </header>
      <p v-if="!latestReadings.length" class="state-message">No sensor readings available.</p>
      <div v-else class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Reading ID</th>
              <th>Sensor ID</th>
              <th>Plant ID</th>
              <th>Temperature</th>
              <th>Humidity</th>
              <th>Soil Moisture</th>
              <th>Rainfall</th>
              <th>Motion</th>
              <th>GPS</th>
              <th>Recorded At</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in latestReadings" :key="String(item.reading.reading_id)">
              <td>
                <strong>{{ item.reading.reading_id }}</strong>
              </td>
              <td>{{ item.device.sensor_id }}</td>
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
    :title="selectedDevice.device_name"
    :subtitle="String(selectedDevice.sensor_id)"
    @close="selectedDevice = null"
  >
    <dl class="detail-list">
      <div>
        <dt>Device Type</dt>
        <dd>{{ selectedDevice.device_type }}</dd>
      </div>
      <div>
        <dt>Serial Number</dt>
        <dd>{{ valueOrDash(selectedDevice.serial_number) }}</dd>
      </div>
      <div>
        <dt>Status</dt>
        <dd>{{ selectedDevice.status }}</dd>
      </div>
      <div>
        <dt>Location Description</dt>
        <dd>{{ valueOrDash(selectedDevice.location_description) }}</dd>
      </div>
      <div>
        <dt>Installed At</dt>
        <dd>{{ selectedDevice.installed_at ? dt(selectedDevice.installed_at) : '—' }}</dd>
      </div>
      <div>
        <dt>Related Plant</dt>
        <dd>{{ plantDisplayId(selectedDevice.latest_reading) }}</dd>
      </div>
      <div>
        <dt>Latest Reading</dt>
        <dd>
          {{
            selectedDevice.latest_reading
              ? dt(selectedDevice.latest_reading.recorded_at)
              : 'No reading available'
          }}
        </dd>
      </div>
    </dl>
    <div class="modal-actions">
      <button class="primary-button" type="button" @click="loadReadingHistory(selectedDevice)">
        View Reading History
      </button>
      <button class="action-button" type="button" @click="viewDeviceAlerts(selectedDevice)">
        View Alerts
      </button>
      <button
        v-if="
          selectedDevice.latest_reading && formatPlantId(selectedDevice.latest_reading.plant_id)
        "
        class="action-button"
        type="button"
        @click="viewReadingOnMap(selectedDevice.latest_reading, 'device')"
      >
        View on Map
      </button>
    </div>
  </AppModal>

  <AppModal
    v-if="historyDevice"
    :title="`Reading History · ${historyDevice.device_name}`"
    :subtitle="`Sensor ${historyDevice.sensor_id}`"
    wide
    @close="closeReadingHistory"
  >
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
      <div class="table-scroll history-table">
        <table>
          <thead>
            <tr>
              <th>Reading ID</th>
              <th>Recorded Time</th>
              <th>Related Plant</th>
              <th>Temperature</th>
              <th>Humidity</th>
              <th>Soil Moisture</th>
              <th>Rainfall</th>
              <th>Motion</th>
              <th>GPS</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="reading in historyReadings" :key="String(reading.reading_id)">
              <td>
                <strong>{{ reading.reading_id }}</strong>
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
    :title="`Reading ${selectedReading.reading_id}`"
    :subtitle="`Plant ${plantDisplayId(selectedReading)}`"
    @close="selectedReading = null"
  >
    <dl class="detail-list">
      <div>
        <dt>Temperature</dt>
        <dd>{{ valueOrDash(selectedReading.temperature_c, ' °C') }}</dd>
      </div>
      <div>
        <dt>Humidity</dt>
        <dd>{{ valueOrDash(selectedReading.humidity, '%') }}</dd>
      </div>
      <div>
        <dt>Soil Moisture</dt>
        <dd>{{ valueOrDash(selectedReading.soil_moisture, '%') }}</dd>
      </div>
      <div>
        <dt>Rainfall</dt>
        <dd>{{ valueOrDash(selectedReading.rainfall_mm, ' mm') }}</dd>
      </div>
      <div>
        <dt>Motion</dt>
        <dd>{{ motionValue(selectedReading) }}</dd>
      </div>
      <div>
        <dt>GPS</dt>
        <dd>{{ gpsValue(selectedReading) }}</dd>
      </div>
      <div>
        <dt>Recorded At</dt>
        <dd>{{ dt(selectedReading.recorded_at) }}</dd>
      </div>
    </dl>
    <div class="modal-actions">
      <button class="action-button" type="button" @click="viewReadingAlerts(selectedReading)">
        View Alerts
      </button>
      <button
        v-if="formatPlantId(selectedReading.plant_id)"
        class="action-button"
        type="button"
        @click="viewReadingOnMap(selectedReading, 'reading')"
      >
        View on Map
      </button>
    </div>
  </AppModal>
</template>

<style scoped>
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
