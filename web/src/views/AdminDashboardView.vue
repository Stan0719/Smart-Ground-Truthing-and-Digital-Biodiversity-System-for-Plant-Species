<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import AdminNotificationBell from '../components/AdminNotificationBell.vue'
import { useAdminSidebar } from '../composables/useAdminSidebar'

const router = useRouter()
const profileOpen = ref(false)
const notificationBell = ref<{ closeNotifications: () => void } | null>(null)
const { sidebarOpen, isMobile, openSidebar, closeSidebar, handleNavigation } = useAdminSidebar()

const openUserManagement = async () => {
  await router.push({ name: 'admin-users' })
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
}

const openIoTMonitoring = async () => {
  await router.push({ name: 'admin-iot' })
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
}

const openThreatAlerts = async () => {
  await router.push({ name: 'admin-alerts' })
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
}

const openSystemActivity = async () => {
  await router.push({ name: 'admin-activity' })
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
}

const sidebarItems = [
  { label: 'Dashboard', icon: '⌂', active: true, to: '/admin' },
  { label: 'User Management', icon: '♙', to: '/admin/users' },
  { label: 'Role & Permission', icon: '◇', to: '/admin/roles' },
  { label: 'IoT Monitoring', icon: '⌁', to: '/admin/iot' },
  { label: 'Sensor Management', icon: '◉', to: '/admin/sensors' },
  { label: 'Threat Alerts', icon: '△', count: 3, to: '/admin/alerts' },
  { label: 'System Activity', icon: '↻', to: '/admin/activity' },
]

const summaryCards = [
  { title: 'Total Users', value: '18', note: '3 active roles', icon: '♙', tone: 'green' },
  { title: 'Plant Records', value: '350', note: 'Digital collection', icon: '♧', tone: 'green' },
  { title: 'IoT Sensors', value: '27', note: 'Across 3 zones', icon: '⌁', tone: 'blue' },
  { title: 'Active Sensors', value: '25', note: '92.6% online', icon: '✓', tone: 'success' },
  { title: 'Offline Sensors', value: '2', note: 'Requires attention', icon: '×', tone: 'neutral' },
  { title: 'Threat Alerts', value: '3', note: '2 need review', icon: '!', tone: 'danger' },
]

const threatAlerts = [
  {
    id: 'A001',
    plant: 'PL002',
    type: 'Movement Detected',
    location: 'Zone A',
    time: '29 Sep 2026, 10:35 AM',
    severity: 'High',
    status: 'New',
  },
  {
    id: 'A002',
    plant: 'PL010',
    type: 'High Temperature',
    location: 'Zone B',
    time: '29 Sep 2026, 11:20 AM',
    severity: 'Medium',
    status: 'Reviewing',
  },
  {
    id: 'A003',
    plant: 'PL021',
    type: 'Sensor Offline',
    location: 'Zone C',
    time: '29 Sep 2026, 12:05 PM',
    severity: 'Low',
    status: 'New',
  },
]

const sensorActivity = [
  {
    sensor: 'S001',
    plant: 'PL001',
    temperature: '29°C',
    humidity: '82%',
    movement: 'No',
    status: 'Online',
    update: '2 mins ago',
  },
  {
    sensor: 'S002',
    plant: 'PL002',
    temperature: '31°C',
    humidity: '75%',
    movement: 'Yes',
    status: 'Alert',
    update: '5 mins ago',
  },
  {
    sensor: 'S003',
    plant: 'PL003',
    temperature: '28°C',
    humidity: '85%',
    movement: 'No',
    status: 'Offline',
    update: '20 mins ago',
  },
]

const userRoles = [
  { label: 'Administrators', value: 3, percent: 17, color: '#28745a' },
  { label: 'Conservation Officers', value: 5, percent: 28, color: '#55a781' },
  { label: 'Botanists', value: 10, percent: 55, color: '#91c7a8' },
]

const activities = [
  { title: 'Admin01 created a Botanist account', time: '29 Sep 2026, 10:20 AM', type: 'user' },
  { title: 'Admin02 updated Sensor S002', time: '29 Sep 2026, 11:05 AM', type: 'sensor' },
  { title: 'Admin01 changed a user role', time: '29 Sep 2026, 12:10 PM', type: 'role' },
  { title: 'Sensor S003 went offline', time: '29 Sep 2026, 12:30 PM', type: 'warning' },
]

const toggleProfile = () => {
  profileOpen.value = !profileOpen.value
  if (profileOpen.value) notificationBell.value?.closeNotifications()
}

const logout = () => {
  sidebarOpen.value = false
  profileOpen.value = false
  router.push({ name: 'home' })
}
</script>

<template>
  <div class="admin-layout" :class="{ 'sidebar-open': sidebarOpen }">
    <aside class="sidebar" :class="{ open: sidebarOpen }">
      <button
        class="sidebar-close-button"
        type="button"
        aria-label="Close navigation"
        @click="closeSidebar"
      >
        ×
      </button>
      <RouterLink
        class="brand"
        to="/"
        data-tooltip="Go back to the public website"
        aria-label="Go back to the public website"
      >
        <img src="/images/logo.png" alt="Niah Biodiversity" />
        <div><strong>NIAH</strong><span>ADMINISTRATION</span></div>
      </RouterLink>

      <p class="nav-label">MAIN MENU</p>
      <nav aria-label="Administrator navigation">
        <RouterLink
          v-for="item in sidebarItems.filter((entry) => entry.to)"
          :key="item.label"
          :to="item.to!"
          :class="{ active: item.active }"
          @click="handleNavigation"
        >
          <span class="nav-icon" aria-hidden="true">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
          <span v-if="item.count" class="nav-count">{{ item.count }}</span>
        </RouterLink>
        <button
          v-for="item in sidebarItems.filter((entry) => !entry.to)"
          :key="item.label"
          type="button"
          @click="handleNavigation"
        >
          <span class="nav-icon" aria-hidden="true">{{ item.icon }}</span
          ><span>{{ item.label }}</span
          ><span v-if="item.count" class="nav-count">{{ item.count }}</span>
        </button>
      </nav>

      <div class="sidebar-footer">
        <button type="button" @click="logout">Logout</button>
      </div>
    </aside>

    <button
      v-if="isMobile && sidebarOpen"
      class="drawer-backdrop"
      type="button"
      aria-label="Close navigation"
      @click="closeSidebar"
    ></button>

    <div class="main-area">
      <header class="topbar">
        <button
          class="menu-button"
          type="button"
          aria-label="Open navigation"
          :aria-expanded="sidebarOpen"
          v-if="!sidebarOpen"
          @click="openSidebar"
        >
          <span></span><span></span><span></span>
        </button>
        <div class="page-heading">
          <p>OVERVIEW</p>
          <h1>Administrator Dashboard</h1>
        </div>

        <div class="topbar-actions">
          <AdminNotificationBell ref="notificationBell" @opened="profileOpen = false" />
          <div class="profile-wrap">
            <button
              class="profile-button"
              type="button"
              :aria-expanded="profileOpen"
              @click="toggleProfile"
            >
              <span class="avatar">A</span
              ><span class="profile-copy"><strong>Admin01</strong><small>Administrator</small></span
              ><span class="chevron">⌄</span>
            </button>
            <div v-if="profileOpen" class="profile-menu">
              <button type="button">Profile settings</button><button type="button">Sign out</button>
            </div>
          </div>
        </div>
      </header>

      <main class="dashboard">
        <section class="welcome-row">
          <div>
            <h2>Good afternoon, Administrator</h2>
            <p>Here is the latest overview of the biodiversity monitoring system.</p>
          </div>
          <time datetime="2026-09-29">Monday, 29 September 2026</time>
        </section>

        <section class="summary-grid" aria-label="System summary">
          <article
            v-for="card in summaryCards"
            :key="card.title"
            class="summary-card"
            :class="`tone-${card.tone}`"
          >
            <div class="summary-icon" aria-hidden="true">{{ card.icon }}</div>
            <div>
              <p>{{ card.title }}</p>
              <strong>{{ card.value }}</strong
              ><small>{{ card.note }}</small>
            </div>
          </article>
        </section>

        <div class="dashboard-grid primary-grid">
          <section class="panel sensor-overview">
            <div class="panel-header">
              <div>
                <p class="section-kicker">LIVE OVERVIEW</p>
                <h2>Sensor Status Overview</h2>
              </div>
              <button class="text-action" type="button">View IoT Monitoring →</button>
            </div>
            <div class="sensor-content">
              <div
                class="donut"
                role="img"
                aria-label="25 active and 2 offline sensors out of 27 total"
              >
                <div><strong>27</strong><span>Total sensors</span></div>
              </div>
              <div class="sensor-legend">
                <div>
                  <span class="dot active-dot"></span>
                  <p>Active sensors<small>Operating normally</small></p>
                  <strong>25</strong>
                </div>
                <div>
                  <span class="dot offline-dot"></span>
                  <p>Offline sensors<small>Requires attention</small></p>
                  <strong>2</strong>
                </div>
                <div class="uptime"><span>Network availability</span><strong>92.6%</strong></div>
              </div>
            </div>
          </section>

          <section class="panel system-status">
            <div class="panel-header">
              <div>
                <p class="section-kicker">SERVICES</p>
                <h2>System Status</h2>
              </div>
              <span class="all-operational">All systems normal</span>
            </div>
            <div class="service-list">
              <div>
                <span><i></i>Web System</span><strong>Operational</strong>
              </div>
              <div>
                <span><i></i>IoT Service</span><strong>Operational</strong>
              </div>
              <div>
                <span><i></i>Sensor Network</span><strong>25/27 Online</strong>
              </div>
              <div>
                <span><i></i>Last Sync</span><strong>2 minutes ago</strong>
              </div>
            </div>
          </section>
        </div>

        <section class="panel table-panel">
          <div class="panel-header">
            <div>
              <p class="section-kicker danger-kicker">ATTENTION REQUIRED</p>
              <h2>Recent Threat Alerts</h2>
            </div>
            <button class="text-action" type="button">View All Alerts →</button>
          </div>
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Alert ID</th>
                  <th>Plant ID</th>
                  <th>Alert Type</th>
                  <th>Location</th>
                  <th>Date / Time</th>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="alert in threatAlerts" :key="alert.id">
                  <td>
                    <strong>{{ alert.id }}</strong>
                  </td>
                  <td>{{ alert.plant }}</td>
                  <td>{{ alert.type }}</td>
                  <td>{{ alert.location }}</td>
                  <td>{{ alert.time }}</td>
                  <td>
                    <span class="badge" :class="alert.severity.toLowerCase()">{{
                      alert.severity
                    }}</span>
                  </td>
                  <td>
                    <span class="badge" :class="alert.status.toLowerCase()">{{
                      alert.status
                    }}</span>
                  </td>
                  <td><button class="view-button" type="button">View</button></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="panel table-panel">
          <div class="panel-header">
            <div>
              <p class="section-kicker">LATEST READINGS</p>
              <h2>Recent Sensor Activity</h2>
            </div>
            <button class="text-action" type="button">View all sensors →</button>
          </div>
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Sensor ID</th>
                  <th>Plant ID</th>
                  <th>Temperature</th>
                  <th>Humidity</th>
                  <th>Movement</th>
                  <th>Status</th>
                  <th>Last Update</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="sensor in sensorActivity" :key="sensor.sensor">
                  <td>
                    <strong>{{ sensor.sensor }}</strong>
                  </td>
                  <td>{{ sensor.plant }}</td>
                  <td>{{ sensor.temperature }}</td>
                  <td>{{ sensor.humidity }}</td>
                  <td>{{ sensor.movement }}</td>
                  <td>
                    <span class="badge" :class="sensor.status.toLowerCase()">{{
                      sensor.status
                    }}</span>
                  </td>
                  <td>{{ sensor.update }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <div class="dashboard-grid lower-grid">
          <section class="panel user-summary">
            <div class="panel-header">
              <div>
                <p class="section-kicker">ACCESS OVERVIEW</p>
                <h2>User Summary</h2>
              </div>
              <button class="text-action" type="button">Manage Users →</button>
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
                <p class="section-kicker">AUDIT TRAIL</p>
                <h2>Recent System Activity</h2>
              </div>
            </div>
            <div class="timeline">
              <div
                v-for="activity in activities"
                :key="activity.title"
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
              <p class="section-kicker">SHORTCUTS</p>
              <h2>Quick Actions</h2>
            </div>
          </div>
          <div class="action-grid">
            <button type="button" @click="openUserManagement">
              <span>＋</span>
              <div><strong>Add User</strong><small>Create a new account</small></div>
            </button>
            <button type="button" @click="openIoTMonitoring">
              <span>⌁</span>
              <div><strong>View Sensors</strong><small>Open IoT monitoring</small></div>
            </button>
            <button type="button" @click="openThreatAlerts">
              <span>!</span>
              <div><strong>View Alerts</strong><small>Review active threats</small></div>
            </button>
            <button type="button" @click="openSystemActivity">
              <span>↻</span>
              <div><strong>System Activity</strong><small>View the audit trail</small></div>
            </button>
          </div>
        </section>
      </main>
    </div>
  </div>
</template>

<style scoped>
* {
  box-sizing: border-box;
}
.admin-layout {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 0 minmax(0, 1fr);
  background: #f3f6f2;
  color: #29483e;
  transition: grid-template-columns 0.2s ease;
}
.admin-layout.sidebar-open {
  grid-template-columns: 258px minmax(0, 1fr);
}
.sidebar {
  position: fixed;
  top: 0;
  width: 258px;
  height: 100vh;
  padding: 24px 16px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: #173f34;
  color: #fff;
  z-index: 100;
  transform: translateX(-100%);
  transition: transform 0.2s ease;
}
.sidebar.open {
  transform: translateX(0);
}
.sidebar-close-button {
  position: absolute;
  top: 12px;
  right: 10px;
  z-index: 2;
  width: 30px;
  min-width: 0;
  height: 30px;
  padding: 0;
  display: grid;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.07);
  color: #bfd7cd;
  cursor: pointer;
  font-size: 22px;
  line-height: 1;
}
.brand {
  position: relative;
  margin: -8px -4px 0;
  padding: 8px 12px 25px;
  display: flex;
  align-items: center;
  gap: 11px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  color: #fff;
  text-decoration: none;
}
.brand img {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  object-fit: cover;
}
.brand div {
  display: flex;
  flex-direction: column;
}
.brand strong {
  font-size: 18px;
  letter-spacing: 2px;
}
.brand span {
  margin-top: 3px;
  color: #9dd5ba;
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 1.5px;
}
.brand::after {
  position: absolute;
  bottom: -30px;
  left: 12px;
  z-index: 110;
  padding: 6px 9px;
  border-radius: 6px;
  background: rgba(18, 25, 22, 0.96);
  color: #fff;
  box-shadow: 0 5px 14px rgba(0, 0, 0, 0.2);
  content: attr(data-tooltip);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.2px;
  white-space: nowrap;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translateY(-3px);
  transition:
    opacity 180ms ease,
    transform 180ms ease,
    visibility 180ms ease;
}
.brand:hover::after,
.brand:focus-visible::after {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
}
.nav-label {
  margin: 25px 13px 9px;
  color: #75a392;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 1.6px;
}
.sidebar nav {
  display: grid;
  gap: 4px;
}
.sidebar nav button,
.sidebar nav a,
.sidebar-footer button {
  width: 100%;
  padding: 10px 13px;
  display: flex;
  align-items: center;
  gap: 11px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: #bfd7cd;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  text-align: left;
  text-decoration: none;
  transition: 0.2s ease;
}
.sidebar nav button:hover,
.sidebar nav a:hover,
.sidebar nav a.active {
  background: #2b6754;
  color: #fff;
}
.nav-icon {
  width: 21px;
  text-align: center;
  font-size: 18px;
}
.nav-count {
  margin-left: auto;
  min-width: 21px;
  height: 21px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #c95c4a;
  color: #fff;
  font-size: 10px;
}
.sidebar-footer {
  margin-top: auto;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}
.sidebar-footer button {
  justify-content: center;
  background: #fce8e6;
  color: #b84d42;
}
.sidebar-footer button:hover,
.sidebar-footer button:focus-visible {
  background: #b84d42;
  color: #fff;
}
.main-area {
  min-width: 0;
  grid-column: 2;
}
.topbar {
  position: sticky;
  top: 0;
  z-index: 80;
  min-height: 82px;
  padding: 0 3.5%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  border-bottom: 1px solid #dce4dc;
  background: rgba(255, 255, 255, 0.93);
  backdrop-filter: blur(12px);
}
.page-heading p {
  margin: 0 0 3px;
  color: #62a087;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 1.8px;
}
.page-heading h1 {
  margin: 0;
  color: #204c3d;
  font-size: 23px;
}
.topbar-actions {
  display: flex;
  align-items: center;
  gap: 13px;
}
.profile-wrap {
  position: relative;
}
.profile-button {
  padding: 5px 8px 5px 5px;
  display: flex;
  align-items: center;
  gap: 9px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: transparent;
  color: #29483e;
  cursor: pointer;
  font: inherit;
}
.profile-button:hover {
  border-color: #dfe6df;
  background: #f8faf7;
}
.avatar {
  width: 37px;
  height: 37px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: #33745d;
  color: #fff;
  font-weight: 800;
}
.profile-copy {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.profile-copy strong {
  font-size: 12px;
}
.profile-copy small {
  color: #82918b;
  font-size: 9px;
}
.chevron {
  color: #7a8b84;
}
.profile-menu {
  position: absolute;
  top: 52px;
  right: 0;
  width: 160px;
  padding: 7px;
  border: 1px solid #e1e6e1;
  border-radius: 11px;
  background: #fff;
  box-shadow: 0 12px 30px rgba(28, 65, 51, 0.13);
}
.profile-menu button {
  width: 100%;
  padding: 9px 10px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #425e54;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.profile-menu button:hover {
  background: #edf3ed;
}
.menu-button {
  width: 39px;
  height: 39px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 1px solid #dfe6df;
  border-radius: 9px;
  background: #fff;
}
.menu-button span {
  width: 18px;
  height: 2px;
  background: #376354;
}
.dashboard {
  width: min(1420px, 94%);
  margin: 0 auto;
  padding: 31px 0 55px;
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
.text-action {
  padding: 5px 0;
  border: 0;
  background: transparent;
  color: #3c8168;
  cursor: pointer;
  font: inherit;
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
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
.drawer-backdrop {
  display: none;
}
@media (max-width: 1250px) {
  .summary-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
@media (max-width: 920px) {
  .admin-layout {
    grid-template-columns: 1fr;
  }
  .admin-layout.sidebar-open {
    grid-template-columns: 1fr;
  }
  .main-area {
    grid-column: 1;
  }
  .sidebar {
    position: fixed;
    left: 0;
    width: 258px;
    transform: translateX(-100%);
    transition: transform 0.2s ease;
  }
  .sidebar-close-button {
    position: absolute;
    top: 12px;
    right: 10px;
    z-index: 2;
    width: 30px;
    min-width: 0;
    height: 30px;
    padding: 0;
    display: grid;
    place-items: center;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.07);
    color: #bfd7cd;
    cursor: pointer;
    font-size: 22px;
    line-height: 1;
  }
  .sidebar.open {
    transform: translateX(0);
  }
  .drawer-backdrop {
    position: fixed;
    inset: 0;
    z-index: 90;
    display: block;
    border: 0;
    background: rgba(12, 35, 27, 0.5);
  }
  .menu-button {
    width: 39px;
    height: 39px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    border: 1px solid #dfe6df;
    border-radius: 9px;
    background: #fff;
  }
  .menu-button span {
    width: 18px;
    height: 2px;
    background: #376354;
  }
  .topbar {
    justify-content: flex-start;
  }
  .topbar-actions {
    margin-left: auto;
  }
  .primary-grid,
  .lower-grid {
    grid-template-columns: 1fr;
  }
  .action-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 620px) {
  .topbar {
    min-height: 72px;
    padding: 0 4%;
  }
  .page-heading p,
  .profile-copy,
  .chevron {
    display: none;
  }
  .page-heading h1 {
    font-size: 17px;
  }
  .dashboard {
    width: 91%;
    padding-top: 23px;
  }
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
  .profile-button {
    padding: 3px;
  }
  .profile-button .avatar {
    width: 35px;
    height: 35px;
  }
}
@media (max-width: 400px) {
  .summary-grid {
    grid-template-columns: 1fr;
  }
}
</style>
