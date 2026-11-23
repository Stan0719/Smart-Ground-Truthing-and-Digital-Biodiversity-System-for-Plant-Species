<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AdminPlantAssignment from '../components/AdminPlantAssignment.vue'
import { KEEP_ASSIGNMENT, assignmentPayload, currentAssignment, deviceType, plantLabel } from '../services/deviceAssignment'
import { useRoute, useRouter } from 'vue-router'
import AdminPageShell from '../components/AdminPageShell.vue'
import AdminTableIdentifier from '../components/AdminTableIdentifier.vue'
import StaffDialog from '../components/StaffDialog.vue'
import { api, logout, type AuthUser } from '../services/auth'
import { plantApi, type Device } from '../services/plantApi'
import { DEFAULT_SENSOR_THRESHOLDS, sensorLimits, thresholdRangeLabel, type SensorThresholds } from '../services/sensorThresholds'
const { t } = useI18n()
const da = (key: string) => t('adminDeviceAssignment.' + key)
const assignmentLabel = (device: Device) => { const a = currentAssignment(device); return a.state === 'assigned' ? plantLabel(a.id) : da(a.state) }
const route = useRoute(),
  router = useRouter(),
  section = computed(() => route.path.split('/').pop() || '')
const pages: Record<string, { title: string; intro: string }> = {
  roles: {
    title: 'Role & Permission',
    intro: 'Review the server-enforced permissions for each role.',
  },
  iot: {
    title: 'IoT Monitoring',
    intro: 'View received sensor measurements and registered device status.',
  },
  sensors: {
    title: 'Sensor Management',
    intro: 'Register devices and configure their status and alert thresholds.',
  },
  settings: { title: 'Security Settings', intro: 'Manage sign-in limits and session duration.' },
  activity: {
    title: 'System Activity',
    intro: 'Review account and device audit events with readable timestamps.',
  },
}
const page = computed(
  () =>
    pages[section.value] || { title: 'Administration', intro: 'Select a module from the menu.' },
)
interface Reading {
  id: string
  device_id: string
  values: Record<string, number>
  created_at: string
}
interface Audit {
  id: string | number
  created_at: string | number
  reason?: string
  action?: string
  actor_id?: string
  actor_subject?: string
  user_id?: string
  target?: string
  source?: string
}
const devices = ref<Device[]>([]),
  readings = ref<Reading[]>([]),
  events = ref<Audit[]>([]),
  users = ref<AuthUser[]>([]),
  permissions = ref<Record<string, string[]>>({})
const settings = ref({ session_hours: 8, login_limit: 30 }),
  busy = ref(false),
  operationBusy = ref(false),
  error = ref(''),
  message = ref(''),
  search = ref(''),
  filter = ref('All')
const modal = ref<'register' | 'edit' | 'threshold' | 'settings' | null>(null),
  selected = ref<Device | null>(null),
  key = ref('')
const form = ref({ name: '', status: 'Active', plant: '' })
const thresholdRows = ref<{ metric: string; minimum: string; maximum: string }[]>([])
const roles = ['Administrator', 'Conservation Officer', 'Botanist', 'Visitor', 'Guest']
const metrics = ['temperature', 'humidity', 'soilMoisture', 'movement', 'rainfall']
const thresholdMetrics = metrics.filter(metric => metric !== 'movement')
const metricUnits: Record<string, string> = {
  temperature: '°C',
  humidity: '%',
  soilMoisture: 'raw ADC',
  rainfall: 'raw ADC',
}
const metricLabels: Record<string, string> = {
  temperature: 'Temperature',
  humidity: 'Humidity',
  soilMoisture: 'Soil moisture',
  rainfall: 'Rainfall',
}
// Starting values for unconfigured metrics; changes apply when the form is saved.
const thresholdDefaults = DEFAULT_SENSOR_THRESHOLDS
const metricIcons: Record<string, string[]> = {
  temperature: ['M14 14.8V5a3 3 0 0 0-6 0v9.8a5 5 0 1 0 6 0Z', 'M11 8v9', 'M9 18a2 2 0 1 0 4 0 2 2 0 0 0-4 0'],
  humidity: ['M12 3C9 7 5 11 5 15a7 7 0 0 0 14 0c0-4-4-8-7-12Z'],
  soilMoisture: ['M12 21v-8', 'M12 15C5 15 3 11 3 7c6 0 9 2 9 8Z', 'M12 12c0-6 3-9 9-9 0 6-3 9-9 9Z'],
  rainfall: ['M6 15a5 5 0 0 1-1-10 6 6 0 0 1 11-1 5 5 0 1 1 2 11H6Z', 'm8 18-1 3m6-3-1 3m6-3-1 3'],
}
const date = (value: string | number | null | undefined) => {
  if (value == null) return 'No report received'
  const d = new Date(value)
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : 'Unavailable'
}
const label = (value: string) => value.replaceAll('_', ' ').replaceAll('.', ' · ')
const measurement = (values: Record<string, number>) =>
  Object.entries(values)
    .filter(([metric]) => metrics.includes(metric))
    .map(
      ([metric, value]) =>
        `${metric}: ${value}${metric === 'temperature' ? ' °C' : metric === 'humidity' ? ' %' : ''}`,
    )
    .join(' · ')
const configuredThresholds = (values: SensorThresholds) => thresholdMetrics.flatMap(metric => {
  const range = thresholdRangeLabel(values[metric], metricUnits[metric])
  return range ? [{ metric, label: metricLabels[metric], range }] : []
})
const filteredDevices = computed(() =>
  devices.value.filter(
    (d) =>
      `${d.name} ${d.id}`.toLowerCase().includes(search.value.toLowerCase()) &&
      (filter.value === 'All' || d.status === filter.value),
  ),
)
const filteredReadings = computed(() =>
  readings.value.filter((r) =>
    `${r.device_id} ${measurement(r.values)}`.toLowerCase().includes(search.value.toLowerCase()),
  ),
)
const filteredEvents = computed(() =>
  events.value.filter((e) =>
    `${e.reason || e.action || ''} ${e.actor_id || e.actor_subject || e.user_id || ''}`
      .toLowerCase()
      .includes(search.value.toLowerCase()),
  ),
)
const filteredPermissions = computed(() =>
  Object.entries(permissions.value).filter(([name]) =>
    name.toLowerCase().includes(search.value.toLowerCase()),
  ),
)
const actor = (event: Audit) => {
  const id = event.actor_id || event.actor_subject?.replace(/^staff:/, '') || event.user_id
  return users.value.find((u) => u.id === id)?.name || id || 'System / unauthenticated'
}
async function load() {
  busy.value = true
  error.value = ''
  const requested = section.value
  try {
    if (requested === 'roles')
      permissions.value = (
        await api<{ permissions: Record<string, string[]> }>('/admin/permissions')
      ).permissions
    else if (requested === 'settings')
      settings.value = (await api<{ settings: typeof settings.value }>('/admin/settings')).settings
    else if (requested === 'activity') {
      const results = await Promise.allSettled([
        api<{ events: Audit[] }>('/admin/audit'),
        plantApi<{ events: Audit[] }>('/audit'),
        api<{ users: AuthUser[] }>('/admin/users'),
      ])
      if (requested !== section.value) return
      events.value = []
      for (const [index, result] of results.entries()) {
        if (result.status === 'fulfilled') {
          if (index === 2) users.value = (result.value as { users: AuthUser[] }).users
          else
            events.value.push(
              ...(result.value as { events: Audit[] }).events.map((e) => ({
                ...e,
                source: index === 0 ? 'Account' : 'Device',
              })),
            )
        } else error.value += 'Some audit sources could not be loaded. '
      }
      events.value.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )
    } else {
      const [d, r] = await Promise.all([
        plantApi<{ devices: Device[] }>('/devices'),
        plantApi<{ readings: Reading[] }>('/readings'),
      ])
      if (requested !== section.value) return
      devices.value = d.devices
      readings.value = r.readings
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'The page could not be loaded.'
  } finally {
    if (requested === section.value) busy.value = false
  }
}
function open(kind: 'register' | 'edit' | 'threshold', device?: Device) {
  if (kind === 'threshold' && (!device || deviceType(device) !== 'Sensor')) return
  selected.value = device || null
  form.value = {
    name: device?.name || '',
    status: device?.status || 'Active',
    plant: kind === 'edit' ? KEEP_ASSIGNMENT : '',
  }
  thresholdRows.value = thresholdMetrics.map(metric => {
    const limits = sensorLimits(device?.thresholds[metric])
    const defaults = thresholdDefaults[metric]!
    return {
      metric,
      minimum: (limits || defaults).min?.toString() ?? '',
      maximum: (limits || defaults).max?.toString() ?? '',
    }
  })
  error.value = ''
  modal.value = kind
}
function resetThresholds(metric?: string) {
  if (operationBusy.value) return
  for (const row of thresholdRows.value) {
    if (metric && row.metric !== metric) continue
    const defaults = thresholdDefaults[row.metric]!
    row.minimum = defaults.min?.toString() ?? ''
    row.maximum = defaults.max?.toString() ?? ''
  }
  error.value = ''
}
async function saveDevice() {
  if (operationBusy.value) return
  operationBusy.value = true
  error.value = ''
  try {
    if (modal.value === 'register') {
      const result = await plantApi<{ provisioningKey: string }>('/devices', 'POST', {
        name: form.value.name.trim(),
        ...assignmentPayload(form.value.plant, false),
      })
      key.value = result.provisioningKey
      message.value = 'Sensor registered. Store its one-time device key privately.'
    } else if (modal.value === 'edit' && selected.value) {
      await plantApi(`/devices/${selected.value.id}`, 'PATCH', {
        name: form.value.name.trim(),
        status: form.value.status,
        ...assignmentPayload(form.value.plant, true),
      })
      message.value = 'Sensor updated.'
    } else if (modal.value === 'threshold' && selected.value) {
      if (deviceType(selected.value) !== 'Sensor') throw Error(da('thresholdUnavailable'))
      const thresholds: Record<string, SensorThresholds[string] | null> = {}
      for (const row of thresholdRows.value) {
        if (!thresholdMetrics.includes(row.metric)) throw Error('Select a supported threshold metric.')
        const minimum = String(row.minimum).trim(), maximum = String(row.maximum).trim()
        const limits = { ...(minimum ? { min: Number(minimum) } : {}), ...(maximum ? { max: Number(maximum) } : {}) }
        if ((minimum || maximum) && !sensorLimits(limits))
          throw Error(`${metricLabels[row.metric]}: enter finite limits with minimum no greater than maximum.`)
        thresholds[row.metric] = minimum || maximum ? limits : null
      }
      await plantApi(`/devices/${selected.value.id}/thresholds`, 'PATCH', {
        thresholds,
      })
      message.value = 'Alert thresholds saved.'
    }
    modal.value = null
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Changes could not be saved.'
  } finally {
    operationBusy.value = false
  }
}
async function saveSettings() {
  operationBusy.value = true
  error.value = ''
  try {
    await api('/admin/settings', 'PATCH', settings.value)
    await logout()
    await router.replace('/')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Settings could not be saved.'
  } finally {
    operationBusy.value = false
    modal.value = null
  }
}
onMounted(load)
watch(section, () => {
  key.value = ''
  modal.value = null
  search.value = ''
  filter.value = 'All'
  message.value = ''
  devices.value = []
  readings.value = []
  events.value = []
  permissions.value = {}
  void load()
})
</script>
<template>
  <AdminPageShell :title="page.title" eyebrow="ADMINISTRATION" :active="page.title">
    <section class="staff-page">
      <div class="page-heading">
        <div>
          <h2>{{ page.title }}</h2>
          <p class="muted">{{ page.intro }}</p>
        </div>
        <div class="actions">
          <button :disabled="busy" @click="load">{{ busy ? 'Loading…' : 'Refresh' }}</button
          ><button v-if="section === 'sensors'" class="primary" @click="open('register')">
            Register Sensor
          </button>
        </div>
      </div>
      <p v-if="error && !modal" role="alert">{{ error }}</p>
      <p v-if="message" role="status">{{ message }}</p>
      <section v-if="key" class="panel">
        <h3>One-time device key</h3>
        <p>Save this key privately on the device. It cannot be retrieved again.</p>
        <code>{{ key }}</code>
        <div class="actions"><button @click="key = ''">Dismiss key</button></div>
      </section>
      <div v-if="section !== 'settings'" class="toolbar">
        <input
          v-model="search"
          :aria-label="section === 'roles' ? 'Search permissions' : 'Search records'"
          placeholder="Search records…"
        /><select
          v-if="section === 'sensors' || section === 'iot'"
          v-model="filter"
          aria-label="Device status"
        >
          <option>All</option>
          <option>Active</option>
          <option>Inactive</option></select
        >
      </div>
      <template v-if="section === 'roles'">
        <p class="muted">
          Permissions are predefined and enforced by the server. Protected-species access is
          Conservation Officer only.
        </p>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Permission</th>
                <th v-for="role in roles" :key="role">{{ role }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="[permission, allowed] in filteredPermissions" :key="permission">
                <td>
                  {{ label(permission) }}<small>{{ permission }}</small>
                </td>
                <td v-for="role in roles" :key="role">
                  {{ allowed.includes(role) ? 'Allowed' : '—' }}
                </td>
              </tr>
              <tr v-if="!filteredPermissions.length">
                <td colspan="6" class="empty">
                  {{
                    busy
                      ? 'Loading permissions…'
                      : error
                        ? 'Permissions unavailable.'
                        : 'No matching permissions.'
                  }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <template v-if="section === 'sensors' || section === 'iot'">
        <div class="stats">
          <div class="stat">
            <span>Registered sensors</span><strong>{{ error ? '—' : devices.length }}</strong>
          </div>
          <div class="stat">
            <span>Enabled devices</span
            ><strong>{{
              error ? '—' : devices.filter((d) => d.status === 'Active').length
            }}</strong>
          </div>
          <div class="stat">
            <span>Received readings</span><strong>{{ error ? '—' : readings.length }}</strong>
          </div>
        </div>
        <div class="sensor-device-container">
        <div class="table-scroll admin-table-scroll sensor-device-scroll" tabindex="0" role="region" aria-label="Sensor devices">
          <table class="admin-data-table admin-device-table sensor-device-table" role="table">
            <thead role="rowgroup">
              <tr role="row">
                <th scope="col" role="columnheader">Sensor</th>
                <th scope="col" role="columnheader">{{ da('deviceType') }}</th>
                <th scope="col" role="columnheader">Status</th>
                <th scope="col" role="columnheader">{{ da('currentPlant') }}</th>
                <th scope="col" role="columnheader">Last report</th>
                <th scope="col" role="columnheader">Thresholds</th>
                <th v-if="section === 'sensors'" scope="col" role="columnheader">Actions</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              <tr v-for="d in filteredDevices" :key="d.id" role="row">
                <td role="cell" class="sensor-identity-cell">
                  <span class="sensor-card-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="12" height="11" rx="3" /><path d="M7 19v3m4-3v3M7 11v4h4v-4M16 3a7 7 0 0 1 6 6m-7-2a3 3 0 0 1 3 3" /></svg></span>
                  <strong class="sensor-device-name">{{ d.name }}</strong><small><AdminTableIdentifier :value="d.id" copy-label="Copy full Device ID" /></small>
                </td>
                <td role="cell" class="sensor-type-cell"><span class="sensor-cell-label" aria-hidden="true">{{ da('deviceType') }}</span><span>{{ da(deviceType(d)) }}</span></td>
                <td role="cell"><span class="sensor-cell-label" aria-hidden="true">Status:</span>
                  <span class="badge" :class="{ neutral: d.status !== 'Active' }">{{
                    d.status
                  }}</span>
                </td>
                <td role="cell"><span class="sensor-cell-label" aria-hidden="true">{{ da('currentPlant') }}:</span><span>{{ assignmentLabel(d) }}</span></td>
                <td role="cell"><span class="sensor-cell-label" aria-hidden="true">Last report:</span><span>{{ date(d.last_seen) }}</span></td>
                <td v-if="deviceType(d) !== 'Sensor'" role="cell" class="sensor-threshold-cell"><span class="sensor-cell-label" aria-hidden="true">Thresholds:</span><span>{{ da(deviceType(d) === 'Camera' ? 'cameraRules' : 'thresholdUnavailable') }}</span></td>
                <td v-else role="cell" class="sensor-threshold-cell"><span class="sensor-cell-label" aria-hidden="true">Thresholds:</span>
                  <ul v-if="configuredThresholds(d.thresholds).length" class="sensor-threshold-list">
                    <li v-for="entry in configuredThresholds(d.thresholds)" :key="entry.metric"><span class="sensor-threshold-name">{{ entry.label }}:</span><span>{{ entry.range }}</span></li>
                  </ul>
                  <span v-else>No thresholds configured</span>
                </td>
                <td v-if="section === 'sensors'" role="cell" class="sensor-actions-cell">
                  <div class="actions">
                    <button @click="open('edit', d)">Edit sensor</button
                    ><button v-if="deviceType(d) === 'Sensor'" @click="open('threshold', d)">Configure threshold</button>
                  </div>
                </td>
              </tr>
              <tr v-if="!filteredDevices.length" role="row">
                <td :colspan="section === 'sensors' ? 7 : 6" class="empty" role="cell">
                  {{
                    busy
                      ? 'Loading sensors…'
                      : error
                        ? 'Sensor data unavailable.'
                        : devices.length
                          ? 'No matching sensors.'
                          : 'No sensors registered yet.'
                  }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        </div>
        <section v-if="section === 'iot'" class="panel" style="margin-top: 22px">
          <h3>Latest sensor readings</h3>
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Device</th>
                  <th>Measurements</th>
                  <th>Received at</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in filteredReadings" :key="r.id">
                  <td>{{ devices.find((d) => d.id === r.device_id)?.name || r.device_id }}</td>
                  <td>{{ measurement(r.values) }}</td>
                  <td>{{ date(r.created_at) }}</td>
                </tr>
                <tr v-if="!filteredReadings.length">
                  <td colspan="3" class="empty">
                    {{
                      busy
                        ? 'Loading readings…'
                        : error
                          ? 'Readings unavailable.'
                          : 'No sensor readings received yet.'
                    }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="muted">
            Temperature is Celsius; humidity is percent. Soil and rain values are raw sensor
            readings until calibrated.
          </p>
        </section>
      </template>
      <div v-if="section === 'activity'" class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Date / Time</th>
              <th>Action</th>
              <th>Actor</th>
              <th>Source</th>
              <th>Target</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(event, index) in filteredEvents"
              :key="`${event.source}-${event.id}-${index}`"
            >
              <td>{{ date(event.created_at) }}</td>
              <td>{{ label(event.action || event.reason || 'Event') }}</td>
              <td>{{ actor(event) }}</td>
              <td>{{ event.source }}</td>
              <td>{{ event.target || event.user_id || '—' }}</td>
            </tr>
            <tr v-if="!filteredEvents.length">
              <td colspan="5" class="empty">
                {{
                  busy
                    ? 'Loading activity…'
                    : error
                      ? 'Activity unavailable.'
                      : 'No matching activity recorded.'
                }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <section v-if="section === 'settings'" class="panel">
        <h3>Session and sign-in policy</h3>
        <form class="staff-form" style="max-width: 560px" @submit.prevent="modal = 'settings'">
          <label
            >Session duration (hours)<input
              v-model.number="settings.session_hours"
              type="number"
              min="1"
              max="24"
              required /></label
          ><label
            >Login attempts per 15 minutes<input
              v-model.number="settings.login_limit"
              type="number"
              min="5"
              max="100"
              required
          /></label>
          <p>Saving revokes current sessions for all accounts. Everyone must sign in again.</p>
          <div class="actions">
            <button class="primary" :disabled="busy || operationBusy">
              Review security changes
            </button>
          </div>
        </form>
      </section>
      <StaffDialog
        v-if="modal"
        :title="
          modal === 'register'
            ? 'Register Sensor'
            : modal === 'edit'
              ? 'Edit Sensor'
              : modal === 'threshold'
                ? 'Configure Alert Thresholds'
                : 'Confirm Security Changes'
        "
        :busy="operationBusy"
        :variant="modal === 'threshold' ? 'thresholds' : undefined"
        @close="modal = null"
      >
        <div class="staff-form" :class="{ 'threshold-dialog-content': modal === 'threshold' }">
          <p v-if="error" role="alert">{{ error }}</p>
          <template v-if="modal === 'settings'"
            ><p>
              Set sessions to {{ settings.session_hours }} hours and
              {{ settings.login_limit }} login attempts per 15 minutes? This signs out all accounts.
            </p>
            <div class="actions">
              <button @click="modal = null">Cancel</button
              ><button class="primary" :disabled="operationBusy" @click="saveSettings">
                Save and sign out
              </button>
            </div></template
          >
          <form v-else class="staff-form" :class="{ 'threshold-form': modal === 'threshold' }" @submit.prevent="saveDevice">
            <template v-if="modal !== 'threshold'"
              ><label>Device name<input v-model="form.name" required maxlength="100" /></label
              ><label v-if="modal === 'edit'"
                >Device status<select v-model="form.status">
                  <option>Active</option>
                  <option>Inactive</option>
                </select></label
              >
              <AdminPlantAssignment v-if="modal === 'register' || modal === 'edit'" v-model="form.plant" :editing="modal === 'edit'" :device="selected" :disabled="operationBusy" />
              </template
            ><div v-else class="threshold-editor">
              <div class="threshold-device">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="9" width="12" height="10" rx="3" /><path d="M7 19v3m4-3v3M7 12v3h4v-3M16 3a7 7 0 0 1 6 6m-7-2a3 3 0 0 1 3 3" /></svg>
                <span>{{ selected?.name }}</span>
              </div>
              <p class="threshold-intro">
                Receive alerts when sensor readings drop below the minimum or exceed the maximum.
              </p>
              <div class="threshold-grid">
              <fieldset v-for="row in thresholdRows" :key="row.metric" class="threshold-metric" :class="row.metric" :disabled="operationBusy" :aria-label="metricLabels[row.metric]">
                <div class="threshold-metric-heading">
                  <div class="threshold-metric-name">
                    <span class="threshold-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path v-for="(path, index) in metricIcons[row.metric]" :key="index" :d="path" /></svg></span>
                    <h3>{{ metricLabels[row.metric] }}</h3>
                  </div>
                  <button type="button" class="threshold-default" :aria-label="`Use default ${metricLabels[row.metric]?.toLowerCase()} thresholds`" :disabled="operationBusy" @click="resetThresholds(row.metric)">Use default</button>
                </div>
                <div class="threshold-range">
                  <label>Min<span class="threshold-input"><input v-model="row.minimum" type="number" step="any" :disabled="operationBusy" :aria-label="`${metricLabels[row.metric]} minimum (${metricUnits[row.metric]})`" /><span aria-hidden="true">{{ metricUnits[row.metric] }}</span></span></label>
                  <label>Max<span class="threshold-input"><input v-model="row.maximum" type="number" step="any" :disabled="operationBusy" :aria-label="`${metricLabels[row.metric]} maximum (${metricUnits[row.metric]})`" /><span aria-hidden="true">{{ metricUnits[row.metric] }}</span></span></label>
                </div>
              </fieldset>
              </div>
              <p class="threshold-hint">Leave both limits blank to disable a metric's alerts. Save changes to apply all thresholds.</p>
            </div>
            <div class="actions" :class="{ 'threshold-footer': modal === 'threshold' }">
              <button v-if="modal === 'threshold'" class="threshold-reset" type="button" :disabled="operationBusy" @click="resetThresholds()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11a9 9 0 1 1 2.6 7.4M3 4v7h7" /></svg>
                <span>Use all defaults</span>
              </button>
              <button type="button" :disabled="operationBusy" @click="modal = null">Cancel</button
              ><button class="primary" :disabled="operationBusy">
                {{
                  operationBusy
                    ? 'Saving…'
                    : modal === 'register'
                      ? 'Register sensor'
                      : 'Save changes'
                }}
              </button>
            </div>
          </form>
        </div>
      </StaffDialog>
    </section>
  </AdminPageShell>
</template>
<style src="../styles/staff-workspace.css"></style>
<style scoped>
.threshold-dialog-content,
.threshold-form {
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 0;
}
.threshold-dialog-content > [role='alert'] {
  flex-shrink: 0;
  margin: 0 30px 12px;
}
.threshold-editor {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 30px 22px;
}
.threshold-device {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  max-width: 100%;
  padding: 7px 13px;
  border: 1px solid #c4d9cd;
  border-radius: 24px;
  background: #e4f0e8;
  color: #446d59;
  font-size: 15px;
  overflow-wrap: anywhere;
}
.threshold-device svg { width: 22px; height: 22px; flex-shrink: 0; }
.threshold-editor .threshold-intro {
  margin: 14px 0 18px;
  font-size: 14px;
  color: #293c33;
}
.threshold-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.threshold-metric {
  min-width: 0;
  margin: 0;
  padding: 14px;
  border: 1px solid #c8d1ca;
  border-radius: 14px;
  background: #fff;
  --metric-color: #b97926;
  --metric-tint: #fff0df;
}
.threshold-metric.humidity { --metric-color: #5973a7; --metric-tint: #e4eaf7; }
.threshold-metric.soilMoisture { --metric-color: #4e7e54; --metric-tint: #dfeedd; }
.threshold-metric.rainfall { --metric-color: #535e85; --metric-tint: #e1e4f0; }
.threshold-metric-heading,
.threshold-metric-name {
  display: flex;
  align-items: center;
  gap: 10px;
}
.threshold-metric-heading { justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.threshold-metric-name h3 { margin: 0; font-size: 16px; line-height: 1.3; color: #243d30; }
.threshold-form .threshold-default {
  padding: 5px 7px;
  border-color: #d7e2d9;
  border-radius: 6px;
  background: #f4f8f4;
  color: #38634f;
  font-size: 11px;
  white-space: nowrap;
}
.threshold-form .threshold-default:hover { background: #e8f0e9; }
.threshold-icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: 10px;
  color: var(--metric-color);
  background: var(--metric-tint);
}
.threshold-icon svg { width: 21px; height: 21px; }
.threshold-range label {
  font-size: 12px;
  font-weight: 600;
  color: #34483b;
}
.threshold-range {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.threshold-input {
  display: flex;
  align-items: center;
  min-width: 0;
  border: 1px solid #c5cfc6;
  border-radius: 10px;
  background: #fff;
}
.threshold-input:hover { border-color: #8caa99; }
.threshold-input:focus-within { border-color: #33745d; outline: 2px solid #33745d; outline-offset: 0; }
.threshold-form .threshold-input input {
  min-width: 0;
  padding: 10px 8px;
  border: 0;
  border-radius: 10px;
  outline: 0;
  background: transparent;
  font-size: 14px;
  font-weight: 400;
  color: #263d30;
  appearance: textfield;
}
.threshold-input input::-webkit-inner-spin-button,
.threshold-input input::-webkit-outer-spin-button { margin: 0; -webkit-appearance: none; }
.threshold-input > span { padding-right: 8px; white-space: nowrap; font-size: 11px; font-weight: 400; color: #7c857e; }
.threshold-form .threshold-input input:disabled { color: #7e897f; opacity: 1; -webkit-text-fill-color: #7e897f; }
.threshold-editor .threshold-hint { margin-top: 14px; font-size: 12px; }
.threshold-form .threshold-footer {
  flex-shrink: 0;
  align-items: center;
  flex-wrap: nowrap;
  gap: 10px;
  padding: 18px 30px;
  border-top: 1px solid #d7dfd8;
  background: #fff;
}
.threshold-footer > button { padding: 11px 18px; }
.threshold-footer > button:not(.primary):not(.threshold-reset) { border-color: #38634f; color: #315b47; }
.threshold-footer .primary { background: #285c46; }
.threshold-footer .threshold-reset {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  margin-right: auto;
  padding: 10px 14px;
  border: 1px solid #b8cfc0;
  border-radius: 9px;
  background: #edf5ef;
  color: #315b47;
  white-space: nowrap;
}
.threshold-reset svg { width: 17px; height: 17px; flex-shrink: 0; }
.threshold-footer .threshold-reset:not(:disabled):hover { border-color: #8fb29b; background: #e0eee4; }
.threshold-footer .threshold-reset:not(:disabled):active { background: #d5e6db; }
@media (max-width: 600px) {
  .threshold-grid { grid-template-columns: 1fr; gap: 12px; }
}
@media (max-width: 500px) {
  .threshold-editor { padding: 0 18px 16px; }
  .threshold-dialog-content > [role='alert'] { margin-inline: 18px; }
  .threshold-metric { padding: 14px 12px; }
  .threshold-metric-name h3 { font-size: 16px; }
  .threshold-range { gap: 10px; }
  .threshold-form .threshold-input input { padding: 10px 8px; }
  .threshold-form .threshold-footer { padding: 14px 18px; flex-wrap: wrap; gap: 8px; }
  .threshold-footer > button { padding: 10px 12px; }
  .threshold-footer .threshold-reset { flex-basis: 100%; margin-right: 0; }
}
@media (max-width: 350px) {
  .threshold-range { grid-template-columns: 1fr; }
}
</style>
