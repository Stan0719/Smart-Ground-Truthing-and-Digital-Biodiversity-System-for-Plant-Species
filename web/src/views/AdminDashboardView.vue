<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AdminPageShell from '../components/AdminPageShell.vue'
import { api } from '../services/auth'

type Device = { id: string; name: string; plant_id: string | null; status: string; last_seen: string | null }
type Alert = { id: string; device_id: string; metric: string; status: string; created_at: string }
type Reading = { id: string; device_id: string; values: Record<string, unknown>; created_at: string }
type Account = { role: string }
type Event = { id: number; reason: string; created_at: number }
const router = useRouter()
const { t } = useI18n()
const system = ref<{ accounts: number; database: string; uptimeSeconds: number } | null>(null)
const devices = ref<Device[]>([])
const alerts = ref<Alert[]>([])
const readings = ref<Reading[]>([])
const accounts = ref<Account[]>([])
const events = ref<Event[]>([])
const error = ref('')
const sensorError = ref(false)
const onlineCount = computed(() => devices.value.filter(device => device.status === 'Active').length)
const offlineCount = computed(() => devices.value.length - onlineCount.value)
const availability = computed(() => devices.value.length ? Math.round(onlineCount.value / devices.value.length * 100) : 0)
const summaryCards = computed(() => [
  { title: 'totalUsers', label: t('adminDashboard.summary.totalUsers'), value: system.value?.accounts ?? '—', note: 'Registered accounts', icon: 'U', tone: 'green' },
  { title: 'database', label: 'Database', value: system.value?.database ?? '—', note: 'PostgreSQL storage', icon: 'DB', tone: 'green' },
  { title: 'iotSensors', label: t('adminDashboard.summary.iotSensors'), value: sensorError.value ? '—' : devices.value.length, note: 'Registered devices', icon: 'S', tone: 'blue' },
  { title: 'activeSensors', label: t('adminDashboard.summary.activeSensors'), value: sensorError.value ? '—' : onlineCount.value, note: 'Active devices', icon: '✓', tone: 'success' },
  { title: 'offlineSensors', label: t('adminDashboard.summary.offlineSensors'), value: sensorError.value ? '—' : offlineCount.value, note: t('adminDashboard.summary.requiresAttention'), icon: '×', tone: 'neutral' },
  { title: 'threatAlerts', label: t('adminDashboard.summary.threatAlerts'), value: alerts.value.length, note: 'Recorded alerts', icon: '!', tone: 'danger' },
])
const userRoles = computed(() => [
  { label: 'administrators', role: 'Administrator', color: '#28745a' },
  { label: 'conservationOfficers', role: 'Conservation Officer', color: '#55a781' },
  { label: 'botanists', role: 'Botanist', color: '#91c7a8' },
].map(item => ({ ...item, value: accounts.value.filter(account => account.role === item.role).length, percent: accounts.value.length ? accounts.value.filter(account => account.role === item.role).length / accounts.value.length * 100 : 0 })))
const formatTime = (value: string | number) => value ? new Date(value).toLocaleString() : '—'
const readingValue = (reading: Reading, key: string) => reading.values?.[key] == null ? '—' : String(reading.values[key])
const refreshDashboard = async () => {
  const [status, deviceResult, alertResult, readingResult, userResult, eventResult] = await Promise.allSettled([
    api<{ system: NonNullable<typeof system.value> }>('/admin/system'),
    api<{ devices: Device[] }>('/data/devices'),
    api<{ alerts: Alert[] }>('/data/alerts'),
    api<{ readings: Reading[] }>('/data/readings'),
    api<{ users: Account[] }>('/admin/users'),
    api<{ events: Event[] }>('/admin/audit'),
  ])
  if (status.status === 'fulfilled') { system.value = status.value.system; error.value = '' }
  else error.value = status.reason instanceof Error ? status.reason.message : 'Unable to load system status.'
  if (deviceResult.status === 'fulfilled') { devices.value = deviceResult.value.devices; sensorError.value = false }
  else sensorError.value = true
  if (alertResult.status === 'fulfilled') alerts.value = alertResult.value.alerts
  if (readingResult.status === 'fulfilled') readings.value = readingResult.value.readings
  if (userResult.status === 'fulfilled') accounts.value = userResult.value.users
  if (eventResult.status === 'fulfilled') events.value = eventResult.value.events
}
const go = async (name: string) => { await router.push({ name }); window.scrollTo(0, 0) }
onMounted(refreshDashboard)
</script>

<template>
  <AdminPageShell :title="t('adminDashboard.title')" :eyebrow="t('adminDashboard.overview')" active="Dashboard">
    <div class="dashboard">
      <section class="welcome-row">
        <div><h2>{{ t('adminDashboard.greeting') }}</h2><p>{{ t('adminDashboard.intro') }}</p></div>
        <button class="secondary-button" type="button" @click="refreshDashboard">Refresh dashboard</button>
      </section>
      <p v-if="error" role="alert">{{ error }}</p>
      <p v-if="sensorError" role="alert">Sensor status could not be loaded.</p>
      <section class="summary-grid" :aria-label="t('adminDashboard.systemSummary')">
        <article v-for="card in summaryCards" :key="card.title" class="summary-card" :class="`tone-${card.tone}`">
          <div class="summary-icon" aria-hidden="true">{{ card.icon }}</div>
          <div><p>{{ card.label }}</p><strong>{{ card.value }}</strong><small>{{ card.note }}</small></div>
        </article>
      </section>
      <div class="dashboard-grid primary-grid">
        <section class="panel sensor-overview">
          <div class="panel-header"><div><p class="section-kicker">{{ t('adminDashboard.liveOverview') }}</p><h2>{{ t('adminDashboard.sensorStatusOverview') }}</h2></div><button class="secondary-button" type="button" @click="go('admin-iot')">{{ t('adminDashboard.viewIotMonitoring') }} &rarr;</button></div>
          <div class="sensor-content">
            <div class="donut" role="img" :aria-label="t('adminDashboard.sensorChartLabel')" :style="{ background: `conic-gradient(#55a781 ${availability}%, #e4e9e5 0)` }"><div><strong>{{ sensorError ? '—' : devices.length }}</strong><span>{{ t('adminDashboard.totalSensors') }}</span></div></div>
            <div class="sensor-legend"><div><span class="dot active-dot"></span><p>{{ t('adminDashboard.activeSensors') }}<small>{{ t('adminDashboard.operatingNormally') }}</small></p><strong>{{ sensorError ? '—' : onlineCount }}</strong></div><div><span class="dot offline-dot"></span><p>{{ t('adminDashboard.offlineSensors') }}<small>{{ t('adminDashboard.requiresAttention') }}</small></p><strong>{{ sensorError ? '—' : offlineCount }}</strong></div><div class="uptime"><span>{{ t('adminDashboard.networkAvailability') }}</span><strong>{{ sensorError ? '—' : availability + '%' }}</strong></div></div>
          </div>
        </section>
        <section class="panel system-status">
          <div class="panel-header"><div><p class="section-kicker">{{ t('adminDashboard.services') }}</p><h2>{{ t('adminDashboard.systemStatus') }}</h2></div><span class="all-operational">{{ system ? system.database : 'Unavailable' }}</span></div>
          <div class="service-list"><div><span><i></i>{{ t('adminDashboard.webSystem') }}</span><strong>{{ system ? t('adminDashboard.operational') : 'Unavailable' }}</strong></div><div><span><i></i>{{ t('adminDashboard.sensorNetwork') }}</span><strong>{{ sensorError ? 'Unavailable' : `${onlineCount} / ${devices.length}` }}</strong></div><div><span><i></i>{{ t('adminDashboard.lastSync') }}</span><strong>{{ new Date().toLocaleTimeString() }}</strong></div></div>
        </section>
      </div>
      <section class="panel table-panel">
        <div class="panel-header"><div><p class="section-kicker danger-kicker">{{ t('adminDashboard.attentionRequired') }}</p><h2>{{ t('adminDashboard.recentThreatAlerts') }}</h2></div><button class="secondary-button" type="button" @click="go('admin-alerts')">{{ t('adminDashboard.viewAllAlerts') }} &rarr;</button></div>
        <p v-if="!alerts.length">No threat alerts recorded.</p>
        <div v-else class="table-scroll"><table><thead><tr><th>{{ t('adminDashboard.table.alertId') }}</th><th>{{ t('adminDashboard.table.sensorId') }}</th><th>{{ t('adminDashboard.table.alertType') }}</th><th>{{ t('adminDashboard.table.dateTime') }}</th><th>{{ t('adminDashboard.table.status') }}</th></tr></thead><tbody><tr v-for="alert in alerts.slice(0, 8)" :key="alert.id"><td><strong>{{ alert.id }}</strong></td><td>{{ alert.device_id }}</td><td>{{ alert.metric }}</td><td>{{ formatTime(alert.created_at) }}</td><td><span class="badge" :class="alert.status.toLowerCase()">{{ alert.status }}</span></td></tr></tbody></table></div>
      </section>
      <section class="panel table-panel">
        <div class="panel-header"><div><p class="section-kicker">{{ t('adminDashboard.latestReadings') }}</p><h2>{{ t('adminDashboard.recentSensorActivity') }}</h2></div><button class="secondary-button" type="button" @click="go('admin-sensors')">{{ t('adminDashboard.viewAllSensors') }} &rarr;</button></div>
        <p v-if="!readings.length">No sensor readings received yet.</p>
        <div v-else class="table-scroll"><table><thead><tr><th>{{ t('adminDashboard.table.sensorId') }}</th><th>{{ t('adminDashboard.table.temperature') }}</th><th>{{ t('adminDashboard.table.humidity') }}</th><th>{{ t('adminDashboard.table.lastUpdate') }}</th></tr></thead><tbody><tr v-for="reading in readings.slice(0, 8)" :key="reading.id"><td><strong>{{ devices.find(device => device.id === reading.device_id)?.name ?? reading.device_id }}</strong></td><td>{{ readingValue(reading, 'temperature') }}</td><td>{{ readingValue(reading, 'humidity') }}</td><td>{{ formatTime(reading.created_at) }}</td></tr></tbody></table></div>
      </section>
      <div class="dashboard-grid lower-grid">
        <section class="panel user-summary"><div class="panel-header"><div><p class="section-kicker">{{ t('adminDashboard.accessOverview') }}</p><h2>{{ t('adminDashboard.userSummary') }}</h2></div><button class="secondary-button" type="button" @click="go('admin-users')">{{ t('adminDashboard.manageUsers') }} &rarr;</button></div><div class="role-list"><div v-for="role in userRoles" :key="role.role" class="role-row"><div class="role-copy"><span>{{ t(`adminDashboard.roles.${role.label}`) }}</span><strong>{{ role.value }}</strong></div><div class="role-track"><span :style="{ width: `${role.percent}%`, background: role.color }"></span></div></div></div></section>
        <section class="panel activity-panel"><div class="panel-header"><div><p class="section-kicker">{{ t('adminDashboard.auditTrail') }}</p><h2>{{ t('adminDashboard.recentSystemActivity') }}</h2></div></div><p v-if="!events.length">No account activity recorded.</p><div v-else class="timeline"><div v-for="event in events.slice(0, 5)" :key="event.id" class="timeline-item"><span class="timeline-dot"></span><div><strong>{{ event.reason }}</strong><time>{{ formatTime(event.created_at) }}</time></div></div></div></section>
      </div>
      <section class="panel quick-actions"><div class="panel-header"><div><p class="section-kicker">{{ t('adminDashboard.shortcuts') }}</p><h2>{{ t('adminDashboard.quickActions') }}</h2></div></div><div class="action-grid"><button type="button" @click="go('admin-users')"><span>+</span><div><strong>{{ t('adminDashboard.actions.addUser') }}</strong><small>{{ t('adminDashboard.actions.createAccount') }}</small></div></button><button type="button" @click="go('admin-iot')"><span>&rarr;</span><div><strong>{{ t('adminDashboard.actions.viewSensors') }}</strong><small>{{ t('adminDashboard.actions.openIot') }}</small></div></button><button type="button" @click="go('admin-alerts')"><span>!</span><div><strong>{{ t('adminDashboard.actions.viewAlerts') }}</strong><small>{{ t('adminDashboard.actions.reviewThreats') }}</small></div></button><button type="button" @click="go('admin-activity')"><span>&rarr;</span><div><strong>{{ t('adminDashboard.actions.systemActivity') }}</strong><small>{{ t('adminDashboard.actions.viewAuditTrail') }}</small></div></button></div></section>
    </div>
  </AdminPageShell>
</template>

<style scoped>
* {
  box-sizing: border-box;
}
.dashboard {
  width: 100%;
}
.welcome-row {
  margin-bottom: 24px;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
}
.welcome-row h2 {
  margin: 0 0 5px;
  color: #204b3c;
  font-size: 22px;
}
.welcome-row p {
  margin: 0;
  color: #78877f;
  font-size: 13px;
}
.welcome-row time {
  color: #73847c;
  font-size: 11px;
  font-weight: 600;
}
.summary-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 13px;
}
.summary-card {
  min-width: 0;
  padding: 18px;
  display: flex;
  align-items: flex-start;
  gap: 13px;
  border: 1px solid #e1e7e1;
  border-radius: 15px;
  background: #fff;
  box-shadow: 0 6px 18px rgba(35, 70, 53, 0.045);
}
.summary-card > div:last-child {
  min-width: 0;
}
.summary-icon {
  width: 37px;
  height: 37px;
  flex: 0 0 37px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: #e4f0e8;
  color: #37785e;
  font-size: 19px;
  font-weight: 800;
}
.summary-card p {
  margin: 0 0 4px;
  color: #71817a;
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
}
.summary-card strong {
  display: block;
  color: #274e40;
  font-size: 25px;
  line-height: 1;
  overflow-wrap: anywhere;
}
.summary-card small {
  display: block;
  margin-top: 6px;
  color: #93a099;
  font-size: 9px;
  white-space: nowrap;
}
.tone-blue .summary-icon {
  background: #e4f0f2;
  color: #367487;
}
.tone-success .summary-icon {
  background: #ddf2e5;
  color: #268256;
}
.tone-neutral .summary-icon {
  background: #ecefed;
  color: #6b7771;
}
.tone-danger .summary-icon {
  background: #f8e4e0;
  color: #bf513f;
}
.dashboard-grid {
  display: grid;
  gap: 18px;
}
.primary-grid {
  margin-top: 18px;
  grid-template-columns: minmax(0, 1.55fr) minmax(300px, 0.75fr);
}
.lower-grid {
  margin-top: 18px;
  grid-template-columns: minmax(300px, 0.78fr) minmax(0, 1.22fr);
}
.panel {
  padding: 23px;
  border: 1px solid #e0e7df;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 7px 22px rgba(35, 70, 53, 0.045);
}
.panel-header {
  margin-bottom: 21px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 15px;
}
.section-kicker {
  margin: 0 0 5px;
  color: #58a07f;
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 1.7px;
}
.danger-kicker {
  color: #c75b49;
}
.panel h2 {
  margin: 0;
  color: #254c3e;
  font-size: 17px;
}
.secondary-button {
  flex: 0 0 auto;
  padding: 9px 13px;
  border: 1px solid #cddbd2;
  border-radius: 8px;
  background: #fff;
  color: #3c7d64;
  cursor: pointer;
  font: inherit;
  font-size: 10px;
  font-weight: 800;
  white-space: nowrap;
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
.secondary-button:active {
  transform: translateY(0) scale(0.99);
}
.secondary-button:focus-visible {
  outline: 3px solid rgba(74, 145, 113, 0.3);
  outline-offset: 2px;
}
.sensor-content {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: clamp(35px, 6vw, 85px);
}
.donut {
  width: 168px;
  height: 168px;
  flex: 0 0 168px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: conic-gradient(#3b9671 0 92.6%, #e2a899 92.6% 100%);
}
.donut::before {
  content: '';
  grid-area: 1/1;
  width: 116px;
  height: 116px;
  border-radius: 50%;
  background: #fff;
}
.donut div {
  z-index: 1;
  grid-area: 1/1;
  text-align: center;
}
.donut strong {
  display: block;
  color: #255141;
  font-size: 34px;
}
.donut span {
  color: #82918a;
  font-size: 9px;
  font-weight: 600;
}
.sensor-legend {
  flex: 1;
  max-width: 360px;
}
.sensor-legend > div:not(.uptime) {
  padding: 12px 0;
  display: flex;
  align-items: center;
  gap: 11px;
  border-bottom: 1px solid #edf0ed;
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
}
.active-dot {
  background: #3b9671;
}
.offline-dot {
  background: #e2a899;
}
.sensor-legend p {
  margin: 0;
  flex: 1;
  color: #4b655b;
  font-size: 11px;
  font-weight: 700;
}
.sensor-legend p small {
  display: block;
  margin-top: 2px;
  color: #9aa49f;
  font-size: 8px;
  font-weight: 500;
}
.sensor-legend > div > strong {
  font-size: 17px;
}
.uptime {
  padding-top: 14px;
  display: flex;
  justify-content: space-between;
  color: #6e8178;
  font-size: 10px;
}
.uptime strong {
  color: #2e765c;
}
.all-operational {
  padding: 5px 8px;
  border-radius: 999px;
  background: #e2f2e8;
  color: #2a7d57;
  font-size: 8px;
  font-weight: 800;
  white-space: nowrap;
}
.service-list {
  display: grid;
  gap: 3px;
}
.service-list div {
  padding: 13px 0;
  display: flex;
  justify-content: space-between;
  border-bottom: 1px solid #edf0ed;
  font-size: 10px;
}
.service-list div:last-child {
  border: 0;
}
.service-list span {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #63766d;
}
.service-list i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #48a276;
  box-shadow: 0 0 0 3px #e4f3e9;
}
.service-list strong {
  color: #345849;
  font-size: 10px;
}
.table-panel {
  margin-top: 18px;
}
.table-scroll {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  white-space: nowrap;
}
th {
  padding: 10px 12px;
  border-bottom: 1px solid #dfe7df;
  background: #f7f9f6;
  color: #829088;
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.6px;
  text-align: left;
  text-transform: uppercase;
}
td {
  padding: 13px 12px;
  border-bottom: 1px solid #edf0ed;
  color: #617169;
  font-size: 10px;
}
tbody tr:last-child td {
  border-bottom: 0;
}
td strong {
  color: #315749;
}
.badge {
  padding: 5px 8px;
  border-radius: 999px;
  font-size: 8px;
  font-weight: 800;
}
.high,
.alert {
  background: #f9e1dc;
  color: #bc4936;
}
.medium,
.reviewing {
  background: #fff0d5;
  color: #a06b12;
}
.low {
  background: #e8eff2;
  color: #53727c;
}
.new {
  background: #e1edf9;
  color: #3972a1;
}
.resolved,
.online {
  background: #dff1e6;
  color: #287a53;
}
.offline {
  background: #ebeeec;
  color: #66716c;
}
.view-button {
  padding: 5px 10px;
  border: 1px solid #cddbd2;
  border-radius: 7px;
  background: #fff;
  color: #3c7d64;
  cursor: pointer;
  font: inherit;
  font-size: 9px;
  font-weight: 700;
}
.role-list {
  display: grid;
  gap: 20px;
}
.role-copy {
  margin-bottom: 7px;
  display: flex;
  justify-content: space-between;
  color: #5a7066;
  font-size: 11px;
}
.role-copy strong {
  color: #294f41;
  font-size: 14px;
}
.role-track {
  height: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: #edf1ed;
}
.role-track span {
  height: 100%;
  display: block;
  border-radius: 999px;
}
.timeline {
  position: relative;
  display: grid;
  gap: 0;
}
.timeline::before {
  content: '';
  position: absolute;
  top: 9px;
  bottom: 9px;
  left: 5px;
  width: 1px;
  background: #dfe7e0;
}
.timeline-item {
  position: relative;
  padding: 0 0 20px 25px;
}
.timeline-item:last-child {
  padding-bottom: 0;
}
.timeline-dot {
  position: absolute;
  top: 4px;
  left: 0;
  width: 11px;
  height: 11px;
  border: 3px solid #d8ece2;
  border-radius: 50%;
  background: #438d6e;
}
.timeline-item.warning .timeline-dot {
  border-color: #f4dfda;
  background: #c75b49;
}
.timeline-item strong {
  display: block;
  color: #405e53;
  font-size: 10px;
}
.timeline-item time {
  display: block;
  margin-top: 4px;
  color: #98a39e;
  font-size: 8px;
}
.quick-actions {
  margin-top: 18px;
}
.action-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
.action-grid button {
  padding: 14px;
  display: flex;
  align-items: center;
  gap: 11px;
  border: 1px solid #dfe6df;
  border-radius: 12px;
  background: #f9fbf8;
  color: #34594b;
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition: 0.2s ease;
}
.action-grid button:hover {
  border-color: #72aa92;
  background: #f0f7f2;
  transform: translateY(-2px);
}
.action-grid > button > span {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 9px;
  background: #e1eee5;
  color: #39795f;
  font-size: 17px;
  font-weight: 800;
}
.action-grid div {
  display: flex;
  flex-direction: column;
}
.action-grid strong {
  font-size: 11px;
}
.action-grid small {
  margin-top: 2px;
  color: #8c9993;
  font-size: 8px;
}
@media (max-width: 1250px) {
  .summary-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
@media (max-width: 920px) {
  .primary-grid,
  .lower-grid {
    grid-template-columns: 1fr;
  }
  .action-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 620px) {
  .welcome-row {
    align-items: flex-start;
    flex-direction: column;
  }
  .welcome-row time {
    display: none;
  }
  .summary-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .summary-card {
    padding: 14px;
  }
  .summary-icon {
    display: none;
  }
  .summary-card p,
  .summary-card small {
    white-space: normal;
  }
  .sensor-content {
    flex-direction: column;
  }
  .panel {
    padding: 19px;
  }
  .panel-header {
    align-items: flex-start;
    flex-direction: column;
  }
  .action-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 400px) {
  .summary-grid {
    grid-template-columns: 1fr;
  }
}
@media (prefers-reduced-motion: reduce) {
  .secondary-button {
    transition:
      background-color 0.2s ease,
      border-color 0.2s ease,
      color 0.2s ease,
      box-shadow 0.2s ease;
  }
  .secondary-button:hover,
  .secondary-button:active {
    transform: none;
  }
}
</style>
