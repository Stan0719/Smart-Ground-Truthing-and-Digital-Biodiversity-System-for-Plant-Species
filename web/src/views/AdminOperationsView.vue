<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AdminPageShell from '../components/AdminPageShell.vue'
import StaffDialog from '../components/StaffDialog.vue'
import { api, logout, type AuthUser } from '../services/auth'
import { plantApi, type Device } from '../services/plantApi'
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
  alerts: {
    title: 'Threat Alerts',
    intro: 'Monitor recorded alerts. Conservation Officers manage alert responses.',
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
interface Alert {
  id: string
  device_id: string
  metric: string
  value: number
  status: string
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
  alerts = ref<Alert[]>([]),
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
const form = ref({ name: '', status: 'Active', metric: 'temperature', threshold: '' })
const roles = ['Administrator', 'Conservation Officer', 'Botanist', 'Visitor', 'Guest']
const metrics = ['temperature', 'humidity', 'soilMoisture', 'movement', 'rainfall', 'sound']
const date = (value: string | number | null | undefined) => {
  if (value == null) return 'No report received'
  const d = new Date(value)
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : 'Unavailable'
}
const label = (value: string) => value.replaceAll('_', ' ').replaceAll('.', ' · ')
const measurement = (values: Record<string, number>) =>
  Object.entries(values)
    .map(
      ([metric, value]) =>
        `${metric}: ${value}${metric === 'temperature' ? ' °C' : metric === 'humidity' ? ' %' : ''}`,
    )
    .join(' · ')
const filteredDevices = computed(() =>
  devices.value.filter(
    (d) =>
      `${d.name} ${d.id}`.toLowerCase().includes(search.value.toLowerCase()) &&
      (filter.value === 'All' || d.status === filter.value),
  ),
)
const filteredAlerts = computed(() =>
  alerts.value.filter(
    (a) =>
      `${a.device_id} ${a.metric} ${a.id}`.toLowerCase().includes(search.value.toLowerCase()) &&
      (filter.value === 'All' || a.status === filter.value),
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
    } else if (requested === 'alerts')
      alerts.value = (await plantApi<{ alerts: Alert[] }>('/alerts')).alerts
    else {
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
  selected.value = device || null
  form.value = {
    name: device?.name || '',
    status: device?.status || 'Active',
    metric: 'temperature',
    threshold:
      device?.thresholds.temperature === undefined ? '' : String(device.thresholds.temperature),
  }
  error.value = ''
  modal.value = kind
}
watch(
  () => form.value.metric,
  (metric) => {
    form.value.threshold =
      selected.value?.thresholds[metric] === undefined
        ? ''
        : String(selected.value.thresholds[metric])
  },
)
async function saveDevice() {
  if (operationBusy.value) return
  operationBusy.value = true
  error.value = ''
  try {
    if (modal.value === 'register') {
      const result = await plantApi<{ provisioningKey: string }>('/devices', 'POST', {
        name: form.value.name.trim(),
      })
      key.value = result.provisioningKey
      message.value = 'Sensor registered. Store its one-time device key privately.'
    } else if (modal.value === 'edit' && selected.value) {
      await plantApi(`/devices/${selected.value.id}`, 'PATCH', {
        name: form.value.name.trim(),
        status: form.value.status,
      })
      message.value = 'Sensor updated.'
    } else if (modal.value === 'threshold' && selected.value) {
      const value = Number(form.value.threshold)
      if (!String(form.value.threshold).trim() || !Number.isFinite(value))
        throw Error('Enter a finite numeric threshold.')
      await plantApi(`/devices/${selected.value.id}/thresholds`, 'PATCH', {
        thresholds: { ...selected.value.thresholds, [form.value.metric]: value },
      })
      message.value = 'Alert threshold saved.'
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
  alerts.value = []
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
        ><select v-if="section === 'alerts'" v-model="filter" aria-label="Alert status">
          <option>All</option>
          <option>New</option>
          <option>Reviewing</option>
          <option>Resolved</option>
        </select>
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
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Sensor</th>
                <th>Status</th>
                <th>Last report</th>
                <th>Thresholds</th>
                <th v-if="section === 'sensors'">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in filteredDevices" :key="d.id">
                <td>
                  {{ d.name }}<small>{{ d.id }}</small>
                </td>
                <td>
                  <span class="badge" :class="{ neutral: d.status !== 'Active' }">{{
                    d.status
                  }}</span>
                </td>
                <td>{{ date(d.last_seen) }}</td>
                <td>
                  {{
                    Object.keys(d.thresholds).length
                      ? measurement(d.thresholds)
                      : 'No thresholds configured'
                  }}
                </td>
                <td v-if="section === 'sensors'">
                  <div class="actions">
                    <button @click="open('edit', d)">Edit sensor</button
                    ><button @click="open('threshold', d)">Configure threshold</button>
                  </div>
                </td>
              </tr>
              <tr v-if="!filteredDevices.length">
                <td :colspan="section === 'sensors' ? 5 : 4" class="empty">
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
            Temperature is Celsius; humidity is percent. Soil, rain and sound values are raw sensor
            readings until calibrated.
          </p>
        </section>
      </template>
      <div v-if="section === 'alerts'" class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Alert</th>
              <th>Device</th>
              <th>Measurement</th>
              <th>Status</th>
              <th>Recorded at</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in filteredAlerts" :key="a.id">
              <td>{{ a.id }}</td>
              <td>{{ a.device_id }}</td>
              <td>{{ measurement({ [a.metric]: a.value }) }}</td>
              <td>
                <span class="badge">{{ a.status }}</span>
              </td>
              <td>{{ date(a.created_at) }}</td>
            </tr>
            <tr v-if="!filteredAlerts.length">
              <td colspan="5" class="empty">
                {{
                  busy
                    ? 'Loading alerts…'
                    : error
                      ? 'Alerts unavailable.'
                      : alerts.length
                        ? 'No matching alerts.'
                        : 'No threat alerts recorded.'
                }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
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
                ? 'Configure Alert Threshold'
                : 'Confirm Security Changes'
        "
        :busy="operationBusy"
        @close="modal = null"
      >
        <div class="staff-form">
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
          <form v-else class="staff-form" @submit.prevent="saveDevice">
            <template v-if="modal !== 'threshold'"
              ><label>Device name<input v-model="form.name" required maxlength="100" /></label
              ><label v-if="modal === 'edit'"
                >Device status<select v-model="form.status">
                  <option>Active</option>
                  <option>Inactive</option>
                </select></label
              ></template
            ><template v-else
              ><p>{{ selected?.name }}</p>
              <label
                >Alert metric<select v-model="form.metric">
                  <option v-for="metric in metrics" :key="metric">{{ metric }}</option>
                </select></label
              ><label
                >Threshold<input v-model="form.threshold" type="number" step="any" required
              /></label>
              <p>
                An alert is generated when a received measurement exceeds this threshold.
              </p></template
            >
            <div class="actions">
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
