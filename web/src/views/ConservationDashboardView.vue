<script setup lang="ts">
import { ref } from 'vue'

type Tone = 'green' | 'blue' | 'warning' | 'danger' | 'success' | 'neutral'

const sidebarOpen = ref(false)
const desktopSidebarCollapsed = ref(false)
const profileOpen = ref(false)

const sidebarItems = [
  { label: 'Dashboard', icon: '⌂', active: true },
  { label: 'Plant Species', icon: '♧' },
  { label: 'Observations', icon: '◎' },
  { label: 'Review Submissions', icon: '✓', count: 12 },
  { label: 'Biodiversity Map', icon: '⌖' },
  { label: 'IoT Monitoring', icon: '⌁' },
  { label: 'Threat Alerts', icon: '△', count: 3 },
  { label: 'Reports', icon: '▤' },
]

const summaryCards: Array<{ title: string; value: string; note: string; icon: string; tone: Tone }> = [
  { title: 'Plant Species', value: '126', note: 'Digital knowledge base', icon: '♧', tone: 'green' },
  { title: 'Plant Records', value: '350', note: 'Registered plants', icon: '▤', tone: 'green' },
  { title: 'Pending Reviews', value: '12', note: 'Requires verification', icon: '⌛', tone: 'warning' },
  { title: 'Endangered Species', value: '18', note: 'Under monitoring', icon: '◇', tone: 'danger' },
  { title: 'Active Threats', value: '3', note: '2 high priority', icon: '!', tone: 'danger' },
  { title: 'Recent Observations', value: '24', note: 'This week', icon: '◎', tone: 'blue' },
]

const pendingReviews = [
  { id: 'OBS001', plant: 'PL024', species: 'Nepenthes ampullaria', submittedBy: 'Botanist01', location: 'Zone A', date: '29 Sep 2026', status: 'Pending' },
  { id: 'OBS002', plant: 'PL031', species: 'Shorea parvifolia', submittedBy: 'Botanist03', location: 'Zone B', date: '29 Sep 2026', status: 'Pending' },
  { id: 'OBS003', plant: 'PL044', species: 'Unknown Species', submittedBy: 'Botanist02', location: 'Zone C', date: '28 Sep 2026', status: 'Pending' },
]

const conservationStatuses = [
  { label: 'Least Concern', value: 65, percent: 52, color: '#3f9270' },
  { label: 'Vulnerable', value: 25, percent: 20, color: '#d7a548' },
  { label: 'Endangered', value: 18, percent: 14, color: '#d57351' },
  { label: 'Critically Endangered', value: 8, percent: 6, color: '#b84d42' },
  { label: 'Other', value: 10, percent: 8, color: '#8ca29a' },
]

const recentPlants = [
  { id: 'PL051', species: 'Nepenthes ampullaria', location: 'Zone A', recordedBy: 'Botanist01', date: '29 Sep 2026', status: 'Approved' },
  { id: 'PL050', species: 'Shorea parvifolia', location: 'Zone C', recordedBy: 'Botanist02', date: '29 Sep 2026', status: 'Pending' },
  { id: 'PL049', species: 'Dipterocarpus grandiflorus', location: 'Zone B', recordedBy: 'Botanist01', date: '28 Sep 2026', status: 'Approved' },
]

const alerts = [
  { id: 'A001', title: 'Movement Detected', detail: 'Possible disturbance near protected plant PL002', species: 'Protected Species A', location: 'Zone A', severity: 'High', status: 'New' },
  { id: 'A002', title: 'High Temperature', detail: 'Unusual temperature recorded near plant PL010', species: 'Shorea parvifolia', location: 'Zone B', severity: 'Medium', status: 'Reviewing' },
  { id: 'A003', title: 'Sensor Offline', detail: 'Monitoring interrupted for plant PL021', species: 'Nepenthes ampullaria', location: 'Zone C', severity: 'Low', status: 'New' },
]

const mapMarkers = [
  { id: 'PL024', label: 'Nepenthes', zone: 'Zone A', x: 23, y: 36, level: 'endangered' },
  { id: 'PL031', label: 'Shorea', zone: 'Zone B', x: 54, y: 25, level: 'vulnerable' },
  { id: 'PL044', label: 'Unverified', zone: 'Zone C', x: 71, y: 61, level: 'other' },
  { id: 'PL051', label: 'Nepenthes', zone: 'Zone A', x: 38, y: 70, level: 'endangered' },
  { id: 'PL049', label: 'Dipterocarpus', zone: 'Zone B', x: 81, y: 38, level: 'safe' },
]

const closeSidebar = () => {
  sidebarOpen.value = false
}

const toggleSidebar = () => {
  if (window.matchMedia('(max-width: 920px)').matches) {
    sidebarOpen.value = !sidebarOpen.value
    return
  }

  desktopSidebarCollapsed.value = !desktopSidebarCollapsed.value
}

const closeSidebarFromControl = () => {
  if (window.matchMedia('(max-width: 920px)').matches) {
    closeSidebar()
    return
  }

  desktopSidebarCollapsed.value = true
}
</script>

<template>
  <div class="officer-layout" :class="{ 'sidebar-collapsed': desktopSidebarCollapsed }">
    <aside class="sidebar" :class="{ open: sidebarOpen }">
      <button class="sidebar-close-button" type="button" aria-label="Close navigation" @click="closeSidebarFromControl">&times;</button>
      <RouterLink class="brand" to="/" data-tooltip="Back to public website" aria-label="Back to public website">
        <img src="/images/logo.png" alt="Niah Biodiversity" />
        <div><strong>NIAH</strong><span>CONSERVATION</span></div>
      </RouterLink>

      <p class="nav-label">MAIN MENU</p>
      <nav aria-label="Conservation Officer navigation">
        <button v-for="item in sidebarItems" :key="item.label" type="button" :class="{ active: item.active }" @click="closeSidebar">
          <span class="nav-icon" aria-hidden="true">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
          <span v-if="item.count" class="nav-count">{{ item.count }}</span>
        </button>
      </nav>

      <div class="sidebar-footer">
        <button class="logout-button" type="button">Logout</button>
      </div>
    </aside>

    <button v-if="sidebarOpen" class="drawer-backdrop" type="button" aria-label="Close navigation" @click="closeSidebar"></button>

    <div class="main-area">
      <header class="topbar">
        <button
          class="menu-button"
          type="button"
          aria-label="Toggle navigation"
          @click="toggleSidebar"
        ><span></span><span></span><span></span></button>
        <div class="page-heading"><p>OVERVIEW</p><h1>Conservation Officer Dashboard</h1></div>
        <div class="topbar-actions">
          <button class="notification-button" type="button" aria-label="Notifications">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" /></svg><span>3</span>
          </button>
          <div class="profile-wrap">
            <button class="profile-button" type="button" :aria-expanded="profileOpen" @click="profileOpen = !profileOpen">
              <span class="avatar">O</span><span class="profile-copy"><strong>Officer01</strong><small>Conservation Officer</small></span><span class="chevron">⌄</span>
            </button>
            <div v-if="profileOpen" class="profile-menu"><button type="button">Profile settings</button><button type="button">Sign out</button></div>
          </div>
        </div>
      </header>

      <main class="dashboard">
        <section class="welcome-row">
          <div><h2>Good afternoon, Conservation Officer</h2><p>Here is the latest overview of biodiversity records and conservation activities.</p></div>
          <time datetime="2026-09-29">Tuesday, 29 September 2026</time>
        </section>

        <section class="summary-grid" aria-label="Biodiversity summary">
          <article v-for="card in summaryCards" :key="card.title" class="summary-card" :class="`tone-${card.tone}`">
            <div class="summary-icon" aria-hidden="true">{{ card.icon }}</div>
            <div><p>{{ card.title }}</p><strong>{{ card.value }}</strong><small>{{ card.note }}</small></div>
          </article>
        </section>

        <div class="dashboard-grid primary-grid">
          <section class="panel review-panel">
            <div class="panel-header">
              <div><p class="section-kicker warning-kicker">REQUIRES REVIEW</p><h2>Pending Observation Reviews</h2><span class="panel-description">Recent field observations submitted by botanists</span></div>
              <button class="text-action" type="button">View All Submissions →</button>
            </div>
            <div class="table-scroll"><table>
              <thead><tr><th>Observation ID</th><th>Plant ID</th><th>Species</th><th>Submitted By</th><th>Location</th><th>Date</th><th>Status</th><th>Action</th></tr></thead>
              <tbody><tr v-for="review in pendingReviews" :key="review.id">
                <td><strong>{{ review.id }}</strong></td><td>{{ review.plant }}</td><td><em>{{ review.species }}</em></td><td>{{ review.submittedBy }}</td><td>{{ review.location }}</td><td>{{ review.date }}</td><td><span class="badge pending">{{ review.status }}</span></td><td><button class="view-button review-button" type="button">Review</button></td>
              </tr></tbody>
            </table></div>
          </section>

          <section class="panel biodiversity-overview">
            <div class="panel-header"><div><p class="section-kicker">SPECIES HEALTH</p><h2>Biodiversity Overview</h2></div><span class="species-total">126 species</span></div>
            <div class="status-list">
              <div v-for="status in conservationStatuses" :key="status.label" class="status-row">
                <div class="status-copy"><span><i :style="{ background: status.color }"></i>{{ status.label }}</span><strong>{{ status.value }}</strong></div>
                <div class="status-track"><span :style="{ width: `${status.percent}%`, background: status.color }"></span></div>
              </div>
            </div>
          </section>
        </div>

        <section class="panel table-panel">
          <div class="panel-header"><div><p class="section-kicker">LATEST RECORDS</p><h2>Recent Plant Records</h2></div><button class="text-action" type="button">View All Plants →</button></div>
          <div class="table-scroll"><table>
            <thead><tr><th>Plant ID</th><th>Species</th><th>Location</th><th>Recorded By</th><th>Date</th><th>Status</th><th>Action</th></tr></thead>
            <tbody><tr v-for="plant in recentPlants" :key="plant.id">
              <td><strong>{{ plant.id }}</strong></td><td><em>{{ plant.species }}</em></td><td>{{ plant.location }}</td><td>{{ plant.recordedBy }}</td><td>{{ plant.date }}</td><td><span class="badge" :class="plant.status.toLowerCase()">{{ plant.status }}</span></td><td><button class="view-button" type="button">View</button></td>
            </tr></tbody>
          </table></div>
        </section>

        <div class="dashboard-grid lower-grid">
          <section class="panel distribution-panel">
            <div class="panel-header"><div><p class="section-kicker">PARK COVERAGE</p><h2>Species Distribution</h2></div><button class="text-action" type="button">Open Full Map →</button></div>
            <div class="map-filters" aria-label="Map filters">
              <label><span>Species</span><select><option>All Species</option></select></label>
              <label><span>Conservation Status</span><select><option>All Conservation Status</option></select></label>
              <label><span>Zone</span><select><option>All Zones</option></select></label>
            </div>
            <div class="park-map" role="img" aria-label="Illustrative map showing documented plant locations across Zones A, B and C">
              <div class="terrain terrain-one"></div><div class="terrain terrain-two"></div><div class="river"></div>
              <span class="zone-label zone-a">ZONE A</span><span class="zone-label zone-b">ZONE B</span><span class="zone-label zone-c">ZONE C</span>
              <button v-for="marker in mapMarkers" :key="marker.id" class="map-marker" :class="marker.level" :style="{ left: `${marker.x}%`, top: `${marker.y}%` }" type="button" :aria-label="`${marker.id}, ${marker.label}, ${marker.zone}`"><span></span><small>{{ marker.id }}</small></button>
              <div class="map-legend"><span><i class="safe"></i>Stable</span><span><i class="vulnerable"></i>Vulnerable</span><span><i class="endangered"></i>Endangered</span></div>
            </div>
          </section>

          <section class="panel alerts-panel">
            <div class="panel-header"><div><p class="section-kicker danger-kicker">ATTENTION REQUIRED</p><h2>Conservation Alerts</h2></div><button class="text-action" type="button">View All Alerts →</button></div>
            <div class="alert-list">
              <article v-for="alert in alerts" :key="alert.id" class="alert-item">
                <div class="alert-symbol" :class="alert.severity.toLowerCase()">!</div>
                <div class="alert-copy"><div class="alert-title"><strong>{{ alert.title }}</strong><span>{{ alert.id }}</span></div><p>{{ alert.detail }}</p><small><em>{{ alert.species }}</em><span>•</span>{{ alert.location }}</small></div>
                <div class="alert-badges"><span class="badge" :class="alert.severity.toLowerCase()">{{ alert.severity }}</span><span class="badge" :class="alert.status.toLowerCase()">{{ alert.status }}</span></div>
              </article>
            </div>
          </section>
        </div>

        <section class="panel quick-actions">
          <div class="panel-header"><div><p class="section-kicker">SHORTCUTS</p><h2>Quick Actions</h2></div></div>
          <div class="action-grid">
            <button type="button"><span>＋</span><div><strong>Add Plant Species</strong><small>Create a new species record</small></div></button>
            <button type="button"><span>✓</span><div><strong>Review Observations</strong><small>Review pending submissions</small></div></button>
            <button type="button"><span>⌕</span><div><strong>Search Plants</strong><small>Find biodiversity records</small></div></button>
            <button type="button"><span>▤</span><div><strong>Generate Report</strong><small>Create a biodiversity report</small></div></button>
          </div>
        </section>
      </main>
    </div>
  </div>
</template>

<style scoped>
* { box-sizing: border-box; }
button, select { font-family: inherit; }
.officer-layout { min-height: 100vh; display: flex; align-items: flex-start; overflow-x: clip; background: #f3f6f2; color: #29483e; }
.sidebar { position: sticky; top: 0; z-index: 100; width: 258px; min-width: 0; height: 100vh; padding: 24px 16px; flex: 0 0 258px; overflow: hidden; display: flex; flex-direction: column; background: #173f34; color: #fff; transition: flex-basis .2s cubic-bezier(.4,0,.2,1), padding-inline .2s cubic-bezier(.4,0,.2,1); will-change: flex-basis; }
.sidebar > * { min-width: 226px; }
.sidebar-close-button { position: absolute; top: 12px; right: 10px; z-index: 2; width: 30px; height: 30px; padding: 0; display: grid; place-items: center; border: 1px solid rgba(255,255,255,.16); border-radius: 8px; background: rgba(255,255,255,.07); color: #bfd7cd; cursor: pointer; font-size: 22px; line-height: 1; transition: .2s ease; }
.sidebar-close-button:hover { background: #2b6754; color: #fff; }
.sidebar-close-button:focus-visible { outline: 2px solid #9dd5ba; outline-offset: 2px; }
.brand { position: relative; margin: -8px -4px 0; padding: 8px 12px 25px; display: flex; align-items: center; gap: 11px; border-bottom: 1px solid rgba(255,255,255,.12); border-radius: 10px 10px 0 0; color: #fff; text-decoration: none; transition: border-color .2s ease; }
.brand:hover { border-bottom-color: rgba(255,255,255,.2); }
.brand:focus-visible { outline: 2px solid #9dd5ba; outline-offset: 2px; }
.brand::after { content: attr(data-tooltip); position: absolute; z-index: 110; left: 12px; bottom: -30px; padding: 6px 9px; border-radius: 6px; background: rgba(18,25,22,.96); color: #fff; box-shadow: 0 5px 14px rgba(0,0,0,.2); font-size: 8px; font-weight: 600; letter-spacing: .2px; white-space: nowrap; opacity: 0; visibility: hidden; pointer-events: none; transform: translateY(-3px); transition: opacity .18s ease, transform .18s ease, visibility .18s ease; }
.brand:hover::after, .brand:focus-visible::after { opacity: 1; visibility: visible; transform: translateY(0); }
.brand img { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; }
.brand div { display: flex; flex-direction: column; }
.brand strong { font-size: 18px; letter-spacing: 2px; }
.brand span { margin-top: 3px; color: #9dd5ba; font-size: 8px; font-weight: 700; letter-spacing: 1.5px; }
.nav-label { margin: 25px 13px 9px; color: #75a392; font-size: 9px; font-weight: 800; letter-spacing: 1.6px; }
.sidebar nav { display: grid; gap: 4px; }
.sidebar nav button, .sidebar-footer button { width: 100%; padding: 10px 13px; display: flex; align-items: center; gap: 11px; border: 0; border-radius: 9px; background: transparent; color: #bfd7cd; cursor: pointer; font-size: 12px; font-weight: 600; text-align: left; transition: .2s ease; }
.sidebar nav button:hover, .sidebar nav button.active { background: #2b6754; color: #fff; }
.nav-icon { width: 21px; text-align: center; font-size: 18px; }
.nav-count { margin-left: auto; min-width: 21px; height: 21px; padding: 0 5px; display: grid; place-items: center; border-radius: 999px; background: #c95c4a; color: #fff; font-size: 9px; }
.sidebar-footer { margin-top: auto; padding-top: 16px; border-top: 1px solid rgba(255,255,255,.1); display: grid; gap: 5px; }
.sidebar-footer .logout-button { justify-content: center; background: #fce8e6; color: #b84d42; transition: background .2s ease, color .2s ease, transform .2s ease; }
.sidebar-footer .logout-button:hover { background: #b84d42; color: #fff; }
.sidebar-footer .logout-button:active { transform: translateY(1px); }
.main-area { min-width: 0; flex: 1 1 auto; }
.topbar { position: sticky; top: 0; z-index: 80; min-height: 82px; padding: 0 3.5%; display: flex; align-items: center; justify-content: space-between; gap: 24px; border-bottom: 1px solid #dce4dc; background: rgba(255,255,255,.93); backdrop-filter: blur(12px); }
.page-heading p { margin: 0 0 3px; color: #62a087; font-size: 9px; font-weight: 800; letter-spacing: 1.8px; }
.page-heading h1 { margin: 0; color: #204c3d; font-size: 23px; }
.topbar-actions { display: flex; align-items: center; gap: 13px; }
.notification-button { position: relative; width: 39px; height: 39px; display: grid; place-items: center; border: 1px solid #dfe6df; border-radius: 11px; background: #fff; color: #527066; cursor: pointer; }
.notification-button svg { width: 19px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; }
.notification-button span { position: absolute; top: -5px; right: -5px; width: 18px; height: 18px; display: grid; place-items: center; border: 2px solid #fff; border-radius: 50%; background: #c95845; color: #fff; font-size: 8px; font-weight: 800; }
.profile-wrap { position: relative; }
.profile-button { padding: 5px 8px 5px 5px; display: flex; align-items: center; gap: 9px; border: 1px solid transparent; border-radius: 12px; background: transparent; color: #29483e; cursor: pointer; }
.profile-button:hover { border-color: #dfe6df; background: #f8faf7; }
.avatar { width: 37px; height: 37px; display: grid; place-items: center; border-radius: 10px; background: #33745d; color: #fff; font-weight: 800; }
.profile-copy { display: flex; flex-direction: column; align-items: flex-start; }
.profile-copy strong { font-size: 12px; }
.profile-copy small { color: #82918b; font-size: 9px; }
.chevron { color: #7a8b84; }
.profile-menu { position: absolute; top: 52px; right: 0; width: 160px; padding: 7px; border: 1px solid #e1e6e1; border-radius: 11px; background: #fff; box-shadow: 0 12px 30px rgba(28,65,51,.13); }
.profile-menu button { width: 100%; padding: 9px 10px; border: 0; border-radius: 7px; background: transparent; color: #425e54; font-size: 12px; text-align: left; cursor: pointer; }
.profile-menu button:hover { background: #edf3ed; }
.menu-button { width:39px; height:39px; flex:0 0 39px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; border:1px solid #dfe6df; border-radius:9px; background:#fff; cursor:pointer; }
.menu-button span { width:18px; height:2px; background:#376354; }
.dashboard { width: min(1420px, 94%); margin: 0 auto; padding: 31px 0 55px; }
.welcome-row { margin-bottom: 24px; display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; }
.welcome-row h2 { margin: 0 0 5px; color: #204b3c; font-size: 22px; }
.welcome-row p { margin: 0; color: #78877f; font-size: 13px; }
.welcome-row time { color: #73847c; font-size: 11px; font-weight: 600; }
.summary-grid { display: grid; grid-template-columns: repeat(6,minmax(0,1fr)); gap: 13px; }
.summary-card { min-width: 0; padding: 18px; display: flex; align-items: flex-start; gap: 13px; border: 1px solid #e1e7e1; border-radius: 15px; background: #fff; box-shadow: 0 6px 18px rgba(35,70,53,.045); }
.summary-icon { width: 37px; height: 37px; flex: 0 0 37px; display: grid; place-items: center; border-radius: 10px; background: #e4f0e8; color: #37785e; font-size: 19px; font-weight: 800; }
.summary-card p { margin: 0 0 4px; color: #71817a; font-size: 10px; font-weight: 700; white-space: nowrap; }
.summary-card strong { display: block; color: #274e40; font-size: 25px; line-height: 1; }
.summary-card small { display: block; margin-top: 6px; color: #93a099; font-size: 9px; white-space: nowrap; }
.tone-blue .summary-icon { background:#e4f0f2; color:#367487; }
.tone-success .summary-icon { background:#ddf2e5; color:#268256; }
.tone-neutral .summary-icon { background:#ecefed; color:#6b7771; }
.tone-warning .summary-icon { background:#fff0d5; color:#aa7214; }
.tone-danger .summary-icon { background:#f8e4e0; color:#bf513f; }
.dashboard-grid { display: grid; gap: 18px; }
.primary-grid { margin-top: 18px; grid-template-columns: minmax(0,1.62fr) minmax(300px,.72fr); }
.lower-grid { margin-top: 18px; grid-template-columns: minmax(0,1.2fr) minmax(340px,.8fr); }
.panel { min-width: 0; padding: 23px; border: 1px solid #e0e7df; border-radius: 16px; background: #fff; box-shadow: 0 7px 22px rgba(35,70,53,.045); }
.panel-header { margin-bottom: 21px; display: flex; align-items: flex-start; justify-content: space-between; gap: 15px; }
.section-kicker { margin: 0 0 5px; color: #58a07f; font-size: 8px; font-weight: 800; letter-spacing: 1.7px; }
.danger-kicker { color: #c75b49; }
.warning-kicker { color: #b87921; }
.panel h2 { margin: 0; color: #254c3e; font-size: 17px; }
.panel-description { display: block; margin-top: 5px; color: #8b9992; font-size: 9px; }
.text-action { padding: 5px 0; border: 0; background: transparent; color: #3c8168; cursor: pointer; font-size: 10px; font-weight: 700; white-space: nowrap; }
.table-panel { margin-top: 18px; }
.table-scroll { max-width: 100%; overflow-x: auto; }
table { width: 100%; border-collapse: collapse; white-space: nowrap; }
th { padding: 10px 12px; border-bottom: 1px solid #dfe7df; background: #f7f9f6; color: #829088; font-size: 8px; font-weight: 800; letter-spacing: .6px; text-align: left; text-transform: uppercase; }
td { padding: 13px 12px; border-bottom: 1px solid #edf0ed; color: #617169; font-size: 10px; }
tbody tr:last-child td { border-bottom: 0; }
td strong { color: #315749; }
td em { color: #3d6254; font-style: italic; font-weight: 500; }
.badge { display: inline-block; padding: 5px 8px; border-radius: 999px; font-size: 8px; font-weight: 800; }
.high { background:#f9e1dc; color:#bc4936; }.medium,.reviewing,.pending { background:#fff0d5; color:#a06b12; }.low { background:#e8eff2; color:#53727c; }.new { background:#e1edf9; color:#3972a1; }.approved { background:#dff1e6; color:#287a53; }
.view-button { padding: 5px 10px; border: 1px solid #cddbd2; border-radius: 7px; background: #fff; color: #3c7d64; cursor: pointer; font-size: 9px; font-weight: 700; }
.review-button { border-color: #93bba8; background: #f1f8f4; }
.species-total { padding: 5px 8px; border-radius: 999px; background: #e2f2e8; color: #2a7d57; font-size: 8px; font-weight: 800; white-space: nowrap; }
.status-list { display: grid; gap: 17px; }
.status-copy { margin-bottom: 7px; display: flex; justify-content: space-between; color: #5a7066; font-size: 10px; }
.status-copy span { display: flex; align-items: center; gap: 7px; }
.status-copy i { width: 7px; height: 7px; border-radius: 50%; }
.status-copy strong { color: #294f41; font-size: 12px; }
.status-track { height: 7px; overflow: hidden; border-radius: 999px; background: #edf1ed; }
.status-track span { height: 100%; display: block; min-width: 5px; border-radius: 999px; }
.map-filters { margin-bottom: 14px; display: grid; grid-template-columns: repeat(3,1fr); gap: 9px; }
.map-filters label { min-width: 0; }
.map-filters label > span { display: block; margin-bottom: 5px; color: #829088; font-size: 8px; font-weight: 700; text-transform: uppercase; }
.map-filters select { width: 100%; padding: 8px 25px 8px 9px; border: 1px solid #dfe6df; border-radius: 8px; background: #fafcfa; color: #587066; font-size: 9px; }
.park-map { position: relative; height: 285px; overflow: hidden; border: 1px solid #dce7de; border-radius: 13px; background: linear-gradient(135deg,#e8f1e7,#d6e6d8); }
.park-map::before, .park-map::after { content:''; position:absolute; border:1px dashed rgba(54,105,82,.25); border-radius:50%; }
.park-map::before { width:300px; height:180px; left:-40px; top:-30px; transform:rotate(-13deg); }
.park-map::after { width:360px; height:210px; right:-65px; bottom:-70px; transform:rotate(15deg); }
.terrain { position:absolute; border-radius:48% 52% 61% 39%; background:rgba(90,143,102,.13); transform:rotate(18deg); }
.terrain-one { width:42%; height:45%; left:8%; top:34%; }.terrain-two { width:39%; height:48%; right:5%; top:7%; background:rgba(87,130,94,.1); }
.river { position:absolute; width:115%; height:30px; left:-7%; top:51%; border-top:8px solid rgba(113,169,175,.3); border-radius:50%; transform:rotate(-8deg); }
.zone-label { position:absolute; color:rgba(42,83,65,.38); font-size:10px; font-weight:800; letter-spacing:2px; }.zone-a{left:8%;top:13%}.zone-b{left:49%;top:12%}.zone-c{right:8%;bottom:12%}
.map-marker { position:absolute; z-index:3; padding:0; border:0; background:transparent; cursor:pointer; transform:translate(-50%,-50%); }
.map-marker > span { width:16px; height:16px; display:block; border:3px solid #fff; border-radius:50% 50% 50% 0; background:#4a9574; box-shadow:0 2px 6px rgba(35,68,53,.28); transform:rotate(-45deg); }
.map-marker.vulnerable > span { background:#d7a548; }.map-marker.endangered > span { background:#c35b49; }.map-marker.other > span { background:#81968e; }
.map-marker small { position:absolute; top:18px; left:50%; padding:2px 4px; border-radius:4px; background:rgba(255,255,255,.85); color:#416052; font-size:7px; font-weight:800; transform:translateX(-50%); }
.map-legend { position:absolute; z-index:4; right:10px; bottom:10px; padding:7px 9px; display:flex; gap:10px; border:1px solid rgba(215,226,216,.9); border-radius:7px; background:rgba(255,255,255,.88); color:#63766d; font-size:7px; }
.map-legend span { display:flex; align-items:center; gap:4px; }.map-legend i { width:6px; height:6px; border-radius:50%; background:#4a9574; }.map-legend .vulnerable{background:#d7a548}.map-legend .endangered{background:#c35b49}
.alert-list { display: grid; }
.alert-item { padding: 14px 0; display: grid; grid-template-columns: 31px minmax(0,1fr) auto; gap: 10px; border-bottom: 1px solid #edf0ed; }
.alert-item:first-child { padding-top: 0; }.alert-item:last-child { padding-bottom: 0; border: 0; }
.alert-symbol { width: 29px; height: 29px; display: grid; place-items: center; border-radius: 8px; background: #f8e4e0; color: #b94e3d; font-size: 13px; font-weight: 800; }
.alert-symbol.medium { background:#fff0d5; color:#a06b12; }.alert-symbol.low { background:#e8eff2; color:#53727c; }
.alert-copy { min-width: 0; }.alert-title { display:flex; justify-content:space-between; gap:8px; }.alert-title strong { color:#36594c; font-size:10px; }.alert-title span { color:#9aa59f; font-size:8px; }
.alert-copy p { margin:3px 0; color:#6f8078; font-size:8px; line-height:1.45; }.alert-copy small { display:flex; flex-wrap:wrap; gap:5px; color:#91a099; font-size:7px; }.alert-badges { display:flex; flex-direction:column; align-items:flex-end; gap:5px; }
.quick-actions { margin-top: 18px; }
.action-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
.action-grid button { padding:14px; display:flex; align-items:center; gap:11px; border:1px solid #dfe6df; border-radius:12px; background:#f9fbf8; color:#34594b; cursor:pointer; text-align:left; transition:.2s ease; }
.action-grid button:hover { border-color:#72aa92; background:#f0f7f2; transform:translateY(-2px); }
.action-grid > button > span { width:34px; height:34px; flex:0 0 34px; display:grid; place-items:center; border-radius:9px; background:#e1eee5; color:#39795f; font-size:17px; font-weight:800; }
.action-grid div { display:flex; flex-direction:column; }.action-grid strong { font-size:11px; }.action-grid small { margin-top:2px; color:#8c9993; font-size:8px; }
.drawer-backdrop { display:none; }
@media(min-width:921px){.officer-layout.sidebar-collapsed .sidebar{flex-basis:0;padding-inline:0;visibility:hidden;pointer-events:none;transition: flex-basis .2s cubic-bezier(.4,0,.2,1), padding-inline .2s cubic-bezier(.4,0,.2,1), visibility 0s linear .2s}}
@media(max-width:1250px){.summary-grid{grid-template-columns:repeat(3,1fr)}.primary-grid{grid-template-columns:1fr}.biodiversity-overview .status-list{grid-template-columns:repeat(5,1fr)}.lower-grid{grid-template-columns:1fr}.park-map{height:320px}}
@media(max-width:920px){.officer-layout{display:block;overflow-x:hidden}.sidebar{position:fixed;left:0;width:258px;transform:translateX(-100%);transition:transform .2s cubic-bezier(.4,0,.2,1)}.sidebar.open{transform:translateX(0)}.drawer-backdrop{position:fixed;inset:0;z-index:90;display:block;border:0;background:rgba(12,35,27,.5)}.topbar{justify-content:flex-start}.topbar-actions{margin-left:auto}.action-grid{grid-template-columns:repeat(2,1fr)}.biodiversity-overview .status-list{grid-template-columns:repeat(2,1fr)}}
@media(prefers-reduced-motion:reduce){.sidebar{transition:none!important}}
@media(max-width:620px){.topbar{min-height:72px;padding:0 4%;gap:10px}.page-heading p,.profile-copy,.chevron{display:none}.page-heading h1{font-size:16px}.dashboard{width:91%;padding-top:23px}.welcome-row{align-items:flex-start;flex-direction:column}.welcome-row time{display:none}.welcome-row h2{font-size:19px}.summary-grid{grid-template-columns:repeat(2,1fr)}.summary-card{padding:14px}.summary-icon{display:none}.summary-card p,.summary-card small{white-space:normal}.panel{padding:19px}.panel-header{align-items:flex-start;flex-direction:column}.action-grid{grid-template-columns:1fr}.profile-button{padding:3px}.profile-button .avatar{width:35px;height:35px}.map-filters{grid-template-columns:1fr}.park-map{height:280px}.alert-item{grid-template-columns:31px minmax(0,1fr)}.alert-badges{grid-column:2;flex-direction:row;align-items:center}.map-legend{left:10px;right:auto}.biodiversity-overview .status-list{grid-template-columns:1fr}}
@media(max-width:400px){.summary-grid{grid-template-columns:1fr}.page-heading h1{font-size:14px}.notification-button{display:none}}
</style>
