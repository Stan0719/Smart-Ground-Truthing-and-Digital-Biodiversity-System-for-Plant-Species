<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import MonitoringIdentifier from '../../components/conservation/MonitoringIdentifier.vue'
import { monitoringDate, monitoringLabels } from '../../utils/officerMonitoringDisplay'
import AppModal from '../../components/conservation/AppModal.vue'
import CameraMonitoringSection from '../../components/CameraMonitoringSection.vue'
import SensorHistoryChart, {
  type SensorChartPoint,
} from '../../components/conservation/SensorHistoryChart.vue'
import { useConservationText } from '../../composables/useConservationText'
import { formatPlantId } from '../../utils/plantId'
import {
  loadCanonicalDevices,
  loadCanonicalHistory,
  type IoTDevice as ApiSensorDevice,
  type IoTReading as ApiSensorReading,
} from '../../services/iotMonitoring'

const { t } = useI18n()
const { ct, locale } = useConservationText()
const dt = (value?: string | null) => monitoringDate(value, locale.value)
const router = useRouter()
const devices = ref<ApiSensorDevice[]>([])
const selectedDevice = ref<ApiSensorDevice | null>(null)
const selectedReading = ref<ApiSensorReading | null>(null)
const historyDevice = ref<ApiSensorDevice | null>(null)
const historyReadings = ref<ApiSensorReading[]>([])
const deviceLabels = computed(() => monitoringLabels([...devices.value.map(item => item.sensor_id), selectedDevice.value?.sensor_id, historyDevice.value?.sensor_id]))
const readingLabels = computed(() => monitoringLabels([...devices.value.map(item => item.latest_reading?.reading_id), ...historyReadings.value.map(item => item.reading_id), selectedReading.value?.reading_id]))
const historyHasMore = ref(false)
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
    devices.value = await loadCanonicalDevices()
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

const viewDeviceAlerts = (device: ApiSensorDevice) => {
  selectedDevice.value = null
  void router.push({
    name: 'conservation-alerts',
    query: { device: String(device.sensor_id) },
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
  const plantId = reading.plant_id ? formatPlantId(reading.plant_id) : null
  if (!plantId) return

  if (source === 'device') selectedDevice.value = null
  else selectedReading.value = null

  void router.push({ name: 'conservation-map', query: { plant: plantId } })
}

const loadReadingHistory = async (device: ApiSensorDevice) => {
  historyDevice.value = device
  selectedDevice.value = null
  historyReadings.value = []
  historyHasMore.value = false
  historyErrorMessage.value = ''
  isHistoryLoading.value = true
  try {
    const result = await loadCanonicalHistory(device)
    historyReadings.value = result.readings
    historyHasMore.value = result.hasMore
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
          <span class="panel-description">Latest reading for each device only.</span>
        </div>
      </header>
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
    :title="selectedDevice.device_name"
    :subtitle="deviceLabels.get(String(selectedDevice.sensor_id)) || String(selectedDevice.sensor_id)"
    @close="selectedDevice = null"
  >
    <MonitoringIdentifier :value="selectedDevice.sensor_id" :labels="deviceLabels" />
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
          selectedDevice.latest_reading?.plant_id &&
          formatPlantId(selectedDevice.latest_reading.plant_id)
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
    :title="`Reading ${readingLabels.get(String(selectedReading.reading_id)) || selectedReading.reading_id}`"
    :subtitle="`Plant ${plantDisplayId(selectedReading)}`"
    @close="selectedReading = null"
  >
    <MonitoringIdentifier :value="selectedReading.reading_id" :labels="readingLabels" />
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
        v-if="selectedReading.plant_id && formatPlantId(selectedReading.plant_id)"
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

<style src="../../styles/officer-data-tables.css"></style>
