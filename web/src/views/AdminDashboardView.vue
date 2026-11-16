<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { emptyOverview, loadOverview, accountSummary, overviewDate } from '../services/adminOverview'
import { sessionSnapshot, subscribeSession } from '../services/auth'
import { formatPlantId } from '../utils/plantId'
import AdminTableIdentifier from '../components/AdminTableIdentifier.vue'
import AdminPageShell from '../components/AdminPageShell.vue'

const router = useRouter()
const { t, te } = useI18n()

const overview = ref(emptyOverview())
const loading = ref(true)
const now = ref(new Date())
let generation = 0
let busy = false
let disposed = false
let stopSession: (() => void) | undefined
async function refresh() {
  if (disposed || busy || sessionSnapshot().user?.role !== 'Administrator') return
  busy = true
  const version = generation
  const result = await loadOverview()
  if (version === generation) { overview.value = result; loading.value = false; now.value = new Date() }
  busy = false
  if (version !== generation && !disposed) void refresh()
}
onMounted(() => {
  stopSession = subscribeSession((user, pending) => {
    generation++
    overview.value = emptyOverview()
    loading.value = pending
    if (!pending && user?.role === 'Administrator') void refresh()
  })
  void refresh()
  window.addEventListener('focus', refresh)
})
onBeforeUnmount(() => { disposed = true; generation++; stopSession?.(); window.removeEventListener('focus', refresh) })
const accounts = computed(() => accountSummary(overview.value.users))
const active = computed(() => overview.value.devices?.filter(d => d.status === 'Active').length ?? null)
const shown = (value: number | null | undefined) => value ?? (loading.value ? '…' : '—')
const currentDate = computed(() => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuching', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now.value))
const greeting = computed(() => {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuching', hour: 'numeric', hourCycle: 'h23' }).format(now.value))
  return hour < 12 ? 'Good morning, Administrator' : hour < 18 ? 'Good afternoon, Administrator' : 'Good evening, Administrator'
})
const lastSync = computed(() => {
  const times = overview.value.devices?.map(d => d.latest_reading?.created_at).filter((v): v is string => Boolean(v)).filter(v => Number.isFinite(Date.parse(v))) ?? []
  return times.length ? overviewDate(times.sort((a, b) => Date.parse(b) - Date.parse(a))[0]) : '—'
})
const donutStyle = computed(() => {
  const total = overview.value.devices?.length ?? 0
  const percent = total ? (active.value ?? 0) / total * 100 : 0
  return { background: `conic-gradient(#3b9671 0 ${percent}%, #e5e7eb ${percent}% 100%)` }
})

const openUserManagement = async () => {
  await router.push({ name: 'admin-users' })
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
}

const openIoTMonitoring = async () => {
  await router.push({ name: 'admin-iot' })
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
}

const openSensorManagement = async () => {
  await router.push({ name: 'admin-sensors' })
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
}

const openThreatAlerts = async () => {
  await router.push({ name: 'admin-iot' })
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
}

const openSystemActivity = async () => {
  await router.push({ name: 'admin-activity' })
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
}

const summaryCards = computed(() => [
  { title: 'totalUsers', value: shown(accounts.value?.total), note: accounts.value ? `${accounts.value.roles} account roles` : loading.value ? 'Loading accounts…' : 'Account directory unavailable', icon: '♙', tone: 'green' },
  { title: 'plantRecords', value: shown(overview.value.totals?.plants), note: 'Individual plant records', icon: '♧', tone: 'green' },
  { title: 'iotSensors', value: shown(overview.value.devices?.length), note: 'Registered devices', icon: '⌁', tone: 'blue' },
  { title: 'activeSensors', value: shown(active.value), note: 'Active registration status', icon: '✓', tone: 'success' },
  { title: 'offlineSensors', value: '—', note: 'Connectivity unavailable', icon: '×', tone: 'neutral' },
  { title: 'threatAlerts', value: shown(overview.value.totals?.alerts), note: 'Not resolved', icon: '!', tone: 'danger' },
])
const threatAlerts = computed(() => (overview.value.alerts ?? []).slice().sort((a,b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0,3).map(a => ({
  id: a.id, plant: overview.value.devices?.find(d => d.id === a.device_id)?.plant_id ?? '—',
  type: a.metric, location: '—', time: overviewDate(a.created_at), severity: '—', status: a.status,
})))
const sensorActivity = computed(() => (overview.value.devices ?? []).filter(d => d.latest_reading).sort((a,b) => Date.parse(b.latest_reading!.created_at) - Date.parse(a.latest_reading!.created_at)).slice(0,3).map(d => ({
  sensor: d.id, plant: d.plant_id ?? '—', temperature: d.latest_reading?.values.temperature == null ? '—' : `${d.latest_reading.values.temperature}°C`,
  humidity: d.latest_reading?.values.humidity == null ? '—' : `${d.latest_reading.values.humidity}%`,
  movement: d.latest_reading?.values.movement == null ? '—' : String(d.latest_reading.values.movement),
  status: d.status, update: overviewDate(d.latest_reading?.created_at),
})))
const userRoles = computed(() => ['Administrator', 'Conservation Officer', 'Botanist', 'Visitor'].map((role,index) => {
  const count = accounts.value?.users.filter(u => u.role === role).length ?? 0
  return { label: role, value: shown(accounts.value ? count : null), percent: accounts.value?.total ? count / accounts.value.total * 100 : 0, color: ['#28745a','#55a781','#91c7a8','#bed9cb'][index] }
}))
const activities = computed(() => (overview.value.events ?? []).slice(0,4).map(e => ({ id: e.id, title: e.reason.replaceAll('_',' '), time: overviewDate(e.created_at), type: 'user' })))
const dataLabel = (value: string) => {
  const key = `dashboardValues.${value.toLowerCase().replace(/[^a-z0-9]+/g, '')}`
  return te(key) ? t(key) : value
}
</script>

<template>
  <AdminPageShell
    :title="t('adminDashboard.title')"
    :eyebrow="t('adminDashboard.overview')"
    active="Dashboard"
  >
    <div class="dashboard">
      <section class="welcome-row">
        <div>
          <h2>{{ greeting }}</h2>
          <p>{{ t('adminDashboard.intro') }}</p>
        </div>
        <time :datetime="now.toISOString()">{{ currentDate }}</time>
      </section>

      <section class="summary-grid" :aria-label="t('adminDashboard.systemSummary')">
        <article
          v-for="card in summaryCards"
          :key="card.title"
          class="summary-card"
          :class="`tone-${card.tone}`"
        >
          <div class="summary-icon" aria-hidden="true">{{ card.icon }}</div>
          <div>
            <p>{{ t(`adminDashboard.summary.${card.title}`) }}</p>
            <strong>
              {{ card.value }}
            </strong>
          </div>
        </article>
      </section>

      <div class="dashboard-grid primary-grid">
        <section class="panel sensor-overview">
          <div class="panel-header">
            <div>
              <p class="section-kicker">{{ t('adminDashboard.liveOverview') }}</p>
              <h2>{{ t('adminDashboard.sensorStatusOverview') }}</h2>
            </div>
            <button class="secondary-button" type="button" @click="openIoTMonitoring">
              {{ t('adminDashboard.viewIotMonitoring') }} →
            </button>
          </div>
          <div class="sensor-content">
            <div class="donut" :style="donutStyle" role="img" :aria-label="'Active registration status; connectivity unavailable'">
              <div>
                <strong>{{ shown(overview.devices?.length) }}</strong><span>{{ t('adminDashboard.totalSensors') }}</span>
              </div>
            </div>
            <div class="sensor-legend">
              <div>
                <span class="dot active-dot"></span>
                <p>
                  {{ t('adminDashboard.activeSensors')
                  }}<small>{{ 'Active registration status' }}</small>
                </p>
                <strong>{{ shown(active) }}</strong>
              </div>
              <div>
                <span class="dot offline-dot"></span>
                <p>
                  {{ t('adminDashboard.offlineSensors')
                  }}<small>{{ 'Connectivity unavailable' }}</small>
                </p>
                <strong>—</strong>
              </div>
              <div class="uptime">
                <span>{{ t('adminDashboard.networkAvailability') }}</span
                ><strong>—</strong>
              </div>
            </div>
          </div>
        </section>

        <section class="panel system-status">
          <div class="panel-header">
            <div>
              <p class="section-kicker">{{ t('adminDashboard.services') }}</p>
              <h2>{{ t('adminDashboard.systemStatus') }}</h2>
            </div>
            <span class="all-operational" style="background: #f3f4f6; color: #617169">{{ 'Service checks' }}</span>
          </div>
          <div class="service-list">
            <div>
              <span><i :style="{ background: overview.healthy ? undefined : '#9ca3af' }"></i>{{ t('adminDashboard.webSystem') }}</span
              ><strong :style="{ color: overview.healthy ? undefined : '#617169' }">{{ loading ? 'Checking…' : overview.healthy ? 'Operational' : 'Unavailable' }}</strong>
            </div>
            <div>
              <span><i style="background: #9ca3af"></i>{{ t('adminDashboard.iotService') }}</span
              ><strong style="color: #617169">Unknown</strong>
            </div>
            <div>
              <span><i style="background: #9ca3af"></i>{{ t('adminDashboard.sensorNetwork') }}</span
              ><strong style="color: #617169">Unavailable</strong>
            </div>
            <div>
              <span><i style="background: #9ca3af"></i>{{ t('adminDashboard.lastSync') }}</span
              ><strong>{{ lastSync }}</strong>
            </div>
          </div>
        </section>
      </div>

      <section class="panel table-panel">
        <div class="panel-header admin-table-title">
          <div>
            <p class="section-kicker danger-kicker">{{ t('adminDashboard.attentionRequired') }}</p>
            <h2>{{ t('adminDashboard.recentThreatAlerts') }}</h2>
          </div>
          <button class="secondary-button" type="button" @click="openThreatAlerts">
            {{ t('adminDashboard.viewAllAlerts') }} →
          </button>
        </div>
        <div class="table-scroll admin-table-scroll" tabindex="0" role="region" aria-label="Dashboard records">
          <table class="admin-data-table admin-overview-table">
            <thead>
              <tr>
                <th>{{ t('adminDashboard.table.alertId') }}</th>
                <th>{{ t('adminDashboard.table.plantId') }}</th>
                <th>{{ t('adminDashboard.table.alertType') }}</th>
                <th>{{ t('adminDashboard.table.location') }}</th>
                <th>{{ t('adminDashboard.table.dateTime') }}</th>
                <th>{{ t('adminDashboard.table.severity') }}</th>
                <th>{{ t('adminDashboard.table.status') }}</th>
                <th>{{ t('adminDashboard.table.action') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!threatAlerts.length"><td colspan="8">{{ loading ? 'Loading alerts…' : overview.alerts ? 'No threat alerts recorded.' : 'Threat alerts unavailable. Please retry by refocusing this page.' }}</td></tr>
              <tr v-for="alert in threatAlerts" :key="alert.id">
                <td>
                  <strong><AdminTableIdentifier :value="alert.id" /></strong>
                </td>
                <td>{{ formatPlantId(alert.plant) || '—' }}</td>
                <td>{{ dataLabel(alert.type) }}</td>
                <td>{{ dataLabel(alert.location) }}</td>
                <td>{{ alert.time }}</td>
                <td>
                  <span class="badge" :class="alert.severity.toLowerCase()">{{
                    dataLabel(alert.severity)
                  }}</span>
                </td>
                <td>
                  <span class="badge" :class="alert.status.toLowerCase()">{{
                    dataLabel(alert.status)
                  }}</span>
                </td>
                <td>
                  <button class="view-button" type="button" @click="openThreatAlerts">{{ t('adminDashboard.view') }}</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel table-panel">
        <div class="panel-header admin-table-title">
          <div>
            <p class="section-kicker">{{ t('adminDashboard.latestReadings') }}</p>
            <h2>{{ t('adminDashboard.recentSensorActivity') }}</h2>
          </div>
          <button class="secondary-button" type="button" @click="openSensorManagement">
            {{ t('adminDashboard.viewAllSensors') }} →
          </button>
        </div>
        <div class="table-scroll admin-table-scroll" tabindex="0" role="region" aria-label="Dashboard records">
          <table class="admin-data-table admin-overview-table">
            <thead>
              <tr>
                <th>{{ t('adminDashboard.table.sensorId') }}</th>
                <th>{{ t('adminDashboard.table.plantId') }}</th>
                <th>{{ t('adminDashboard.table.temperature') }}</th>
                <th>{{ t('adminDashboard.table.humidity') }}</th>
                <th>{{ t('adminDashboard.table.movement') }}</th>
                <th>{{ t('adminDashboard.table.status') }}</th>
                <th>{{ t('adminDashboard.table.lastUpdate') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!sensorActivity.length"><td colspan="7">{{ loading ? 'Loading readings…' : overview.devices ? 'No sensor readings recorded.' : 'Sensor readings unavailable.' }}</td></tr>
              <tr v-for="sensor in sensorActivity" :key="sensor.sensor">
                <td>
                  <strong><AdminTableIdentifier :value="sensor.sensor" /></strong>
                </td>
                <td>{{ formatPlantId(sensor.plant) || '—' }}</td>
                <td>{{ sensor.temperature }}</td>
                <td>{{ sensor.humidity }}</td>
                <td>{{ dataLabel(sensor.movement) }}</td>
                <td>
                  <span class="badge" :class="sensor.status.toLowerCase()">{{
                    dataLabel(sensor.status)
                  }}</span>
                </td>
                <td>{{ dataLabel(sensor.update) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div class="dashboard-grid lower-grid">
        <section class="panel user-summary">
          <div class="panel-header">
            <div>
              <p class="section-kicker">{{ t('adminDashboard.accessOverview') }}</p>
              <h2>{{ t('adminDashboard.userSummary') }}</h2>
            </div>
            <button class="secondary-button" type="button" @click="openUserManagement">
              {{ t('adminDashboard.manageUsers') }} →
            </button>
          </div>
          <div class="role-list">
            <div v-for="role in userRoles" :key="role.label" class="role-row">
              <div class="role-copy">
                <span>{{ role.label }}</span
                ><strong>{{ role.value }}</strong>
              </div>
              <div class="role-track">
                <span :style="{ width: `${role.percent}%`, background: role.color }"></span>
              </div>
            </div>
          </div>
        </section>

        <section class="panel activity-panel">
          <div class="panel-header">
            <div>
              <p class="section-kicker">{{ t('adminDashboard.auditTrail') }}</p>
              <h2>{{ t('adminDashboard.recentSystemActivity') }}</h2>
            </div>
          </div>
          <div class="timeline">
            <p v-if="!activities.length">{{ loading ? 'Loading activity…' : overview.events ? 'No activity recorded.' : 'Activity unavailable.' }}</p>
            <div
              v-for="activity in activities"
              :key="activity.id"
              class="timeline-item"
              :class="activity.type"
            >
              <span class="timeline-dot"></span>
              <div>
                <strong>{{ activity.title }}</strong
                ><time>{{ activity.time }}</time>
              </div>
            </div>
          </div>
        </section>
      </div>

      <section class="panel quick-actions">
        <div class="panel-header">
          <div>
            <p class="section-kicker">{{ t('adminDashboard.shortcuts') }}</p>
            <h2>{{ t('adminDashboard.quickActions') }}</h2>
          </div>
        </div>
        <div class="action-grid">
          <button type="button" @click="openUserManagement">
            <span>＋</span>
            <div>
              <strong>{{ t('adminDashboard.actions.addUser') }}</strong
              ><small>{{ t('adminDashboard.actions.createAccount') }}</small>
            </div>
          </button>
          <button type="button" @click="openIoTMonitoring">
            <span>⌁</span>
            <div>
              <strong>{{ t('adminDashboard.actions.viewSensors') }}</strong
              ><small>{{ t('adminDashboard.actions.openIot') }}</small>
            </div>
          </button>
          <button type="button" @click="openThreatAlerts">
            <span>!</span>
            <div>
              <strong>{{ t('adminDashboard.actions.viewAlerts') }}</strong
              ><small>{{ t('adminDashboard.actions.reviewThreats') }}</small>
            </div>
          </button>
          <button type="button" @click="openSystemActivity">
            <span>↻</span>
            <div>
              <strong>{{ t('adminDashboard.actions.systemActivity') }}</strong
              ><small>{{ t('adminDashboard.actions.viewAuditTrail') }}</small>
            </div>
          </button>
        </div>
      </section>
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
  align-items: center;
  gap: 13px;
  border: 1px solid #e1e7e1;
  border-radius: 15px;
  background: #fff;
  box-shadow: 0 6px 18px rgba(35, 70, 53, 0.045);
}
.summary-icon {
  width: 48px;
  height: 48px;
  flex: 0 0 48px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: #e4f0e8;
  color: #37785e;
  font-size: 28px;
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
  background: #e5e7eb;
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
    gap: 8px;
  }
  .summary-icon {
    width: 40px;
    height: 40px;
    flex-basis: 40px;
    font-size: 25px;
  }
  .summary-card > div:last-child {
    min-width: 0;
  }
  .summary-card p {
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