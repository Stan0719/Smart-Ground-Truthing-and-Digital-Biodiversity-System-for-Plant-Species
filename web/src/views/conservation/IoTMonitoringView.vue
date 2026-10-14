<script setup lang="ts">
import { useConservationText } from '../../composables/useConservationText'
const { ct, sf, dt, speciesText, observationText, locale } = useConservationText()
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppModal from '../../components/conservation/AppModal.vue'
import {
  conservationStore,
  plantFor,
  speciesForPlant,
  type SensorDevice,
  type SensorReading,
} from '../../data/conservation'
const { t, te } = useI18n()
const search = ref(''),
  status = ref(''),
  type = ref(''),
  zone = ref(''),
  device = ref<SensorDevice | null>(null),
  reading = ref<SensorReading | null>(null),
  showReadings = ref(false)
const label = ct
const filtered = computed(() =>
  conservationStore.devices.filter(
    (d) =>
      `${d.id} ${d.name} ${ct(d.name)} ${d.plantId}`
        .toLowerCase()
        .includes(search.value.toLowerCase()) &&
      (!status.value || d.status === status.value) &&
      (!type.value || d.type === type.value) &&
      (!zone.value || d.zone === zone.value),
  ),
)
const cards = computed(() => [
  ['totalDevices', conservationStore.devices.length],
  ['onlineDevices', conservationStore.devices.filter((d) => d.status === 'Online').length],
  ['offlineDevices', conservationStore.devices.filter((d) => d.status === 'Offline').length],
  ['latestReadings', conservationStore.readings.length],
  [
    'devicesWithAlerts',
    new Set(conservationStore.alerts.filter((a) => a.status !== 'Resolved').map((a) => a.sensorId))
      .size,
  ],
])
const deviceColumns = [
  'sensorId',
  'deviceName',
  'deviceType',
  'assignedPlant',
  'location',
  'status',
  'installedAt',
  'lastReading',
  'actions',
]
const readingColumns = [
  'readingId',
  'sensorId',
  'plantId',
  'temperature',
  'humidity',
  'soilMoisture',
  'rainfall',
  'light',
  'motion',
  'gps',
  'recordedAt',
  'actions',
]
const openReadings = (item: SensorDevice) => {
  device.value = item
  showReadings.value = true
}
const closeReadings = () => {
  showReadings.value = false
  device.value = null
}
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
    <article v-for="c in cards" :key="String(c[0])" class="summary-card">
      <p>{{ t(`conservationPages.iot.cards.${c[0]}`) }}</p>
      <strong>{{ c[1] }}</strong
      ><small>{{ t('conservationPages.iot.liveState') }}</small>
    </article>
  </section>
  <div class="control-bar">
    <label class="field search-field"
      ><span>{{ t('common.search') }}</span
      ><input v-model="search" :placeholder="t('conservationPages.iot.searchPlaceholder')" /></label
    ><label class="field"
      ><span>{{ t('conservationPages.iot.deviceStatus') }}</span
      ><select v-model="status">
        <option value="">{{ t('common.allStatuses') }}</option>
        <option v-for="item in ['Online', 'Offline', 'Maintenance']" :key="item" :value="item">
          {{ label(item) }}
        </option>
      </select></label
    ><label class="field"
      ><span>{{ t('conservationPages.iot.deviceType') }}</span
      ><select v-model="type">
        <option value="">{{ t('conservationPages.iot.allTypes') }}</option>
        <option
          v-for="item in [...new Set(conservationStore.devices.map((d) => d.type))]"
          :key="item"
          :value="item"
        >
          {{ label(item) }}
        </option>
      </select></label
    ><label class="field"
      ><span>{{ t('speciesLabels.zone') }}</span
      ><select v-model="zone">
        <option value="">{{ t('conservationPages.common.allZones') }}</option>
        <option v-for="item in ['Zone A', 'Zone B', 'Zone C']" :key="item" :value="item">
          {{ label(item) }}
        </option>
      </select></label
    >
  </div>
  <section class="panel">
    <header class="panel-header">
      <div>
        <h2>{{ t('conservationPages.iot.devices') }}</h2>
        <span class="panel-description">{{ t('conservationPages.iot.accessNote') }}</span>
      </div>
    </header>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th v-for="key in deviceColumns" :key="key">
              {{ t(`conservationPages.iot.columns.${key}`) }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in filtered" :key="d.id">
            <td>
              <strong>{{ d.id }}</strong>
            </td>
            <td>{{ ct(d.name) }}</td>
            <td>{{ label(d.type) }}</td>
            <td>{{ d.plantId }}</td>
            <td>{{ label(d.zone) }}</td>
            <td>
              <span class="badge" :class="d.status.toLowerCase()">{{ label(d.status) }}</span>
            </td>
            <td>{{ dt(d.installedAt) }}</td>
            <td>{{ dt(d.lastReading) }}</td>
            <td>
              <div class="action-group">
                <button class="action-button" @click="device = d">{{ t('common.view') }}</button
                ><button class="action-button" @click="openReadings(d)">
                  {{ t('conservationPages.iot.viewReadings') }}</button
                ><RouterLink
                  class="action-button"
                  :to="{ name: 'conservation-map', query: { plant: d.plantId } }"
                  >{{ t('speciesLabels.location') }}</RouterLink
                >
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
      </div>
    </header>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th v-for="key in readingColumns" :key="key">
              {{ t(`conservationPages.iot.columns.${key}`) }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in conservationStore.readings" :key="r.id">
            <td>
              <strong>{{ r.id }}</strong>
            </td>
            <td>{{ r.sensorId }}</td>
            <td>{{ r.plantId }}</td>
            <td>{{ r.temperature }}</td>
            <td>{{ r.humidity }}</td>
            <td>{{ r.soilMoisture }}</td>
            <td>{{ r.rainfall }}</td>
            <td>{{ r.light }}</td>
            <td>
              <span class="badge" :class="r.motion === 'Detected' ? 'high' : 'approved'">{{
                label(r.motion)
              }}</span>
            </td>
            <td>{{ r.gps }}</td>
            <td>{{ dt(r.recordedAt) }}</td>
            <td>
              <div class="action-group">
                <button class="action-button" @click="reading = r">{{ t('common.details') }}</button
                ><RouterLink
                  class="action-button"
                  :to="{ name: 'conservation-observations', query: { plant: r.plantId } }"
                  >{{ t('speciesLabels.plant') }}</RouterLink
                ><RouterLink
                  class="action-button"
                  :to="{ name: 'conservation-map', query: { plant: r.plantId } }"
                  >{{ t('speciesLabels.location') }}</RouterLink
                >
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
  <AppModal
    v-if="device && !showReadings"
    :title="ct(device.name)"
    :subtitle="device.id"
    @close="device = null"
    ><dl class="detail-list">
      <div>
        <dt>{{ t('conservationPages.iot.columns.assignedPlant') }}</dt>
        <dd>{{ device.plantId }} · {{ speciesText(device.plantId) }}</dd>
      </div>
      <div>
        <dt>{{ t('speciesLabels.status') }}</dt>
        <dd>{{ label(device.status) }}</dd>
      </div>
      <div>
        <dt>{{ t('speciesLabels.location') }}</dt>
        <dd>{{ label(device.zone) }} · {{ ct(plantFor(device.plantId)?.location) }}</dd>
      </div>
      <div>
        <dt>{{ t('conservationPages.iot.columns.lastReading') }}</dt>
        <dd>{{ dt(device.lastReading) }}</dd>
      </div>
    </dl></AppModal
  >
  <AppModal
    v-if="device && showReadings"
    :title="t('conservationPages.iot.deviceReadings', { id: device.id })"
    wide
    @close="closeReadings"
    ><div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{{ ct('ID') }}</th>
            <th v-for="key in ['temperature', 'humidity', 'soil', 'motion', 'recorded']" :key="key">
              {{ t(`conservationPages.iot.columns.${key}`) }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in conservationStore.readings.filter((x) => x.sensorId === device?.id)"
            :key="r.id"
          >
            <td>{{ r.id }}</td>
            <td>{{ r.temperature }}</td>
            <td>{{ r.humidity }}</td>
            <td>{{ r.soilMoisture }}</td>
            <td>{{ label(r.motion) }}</td>
            <td>{{ dt(r.recordedAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div></AppModal
  >
  <AppModal
    v-if="reading"
    :title="t('conservationPages.iot.readingTitle', { id: reading.id })"
    :subtitle="`${reading.sensorId} · ${reading.plantId}`"
    @close="reading = null"
    ><dl class="detail-list">
      <div v-for="(value, key) in reading" :key="key">
        <dt>
          {{
            te(`conservationPages.iot.fields.${key}`)
              ? t(`conservationPages.iot.fields.${key}`)
              : key
          }}
        </dt>
        <dd>{{ key === 'recordedAt' ? dt(String(value)) : label(value) }}</dd>
      </div>
    </dl></AppModal
  >
</template>
<style scoped>
a.action-button {
  text-decoration: none;
}
</style>
