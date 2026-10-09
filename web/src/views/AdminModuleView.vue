<script setup lang="ts">
import { computed, ref } from 'vue'
import AdminPageShell from '../components/AdminPageShell.vue'

type Section = 'roles' | 'iot' | 'sensors' | 'alerts' | 'activity'
const props = defineProps<{ section: Section }>()
const search = ref('')
const filter = ref('All')

interface IoTSensor {
  id: string
  deviceName: string
  deviceType: string
  serialNumber: string
  locationDescription: string
  plant: string
  temperature: string
  humidity: string
  soilMoisture: string
  rainfall: string
  movement: string
  status: 'Online' | 'Offline' | 'Alert'
  lastReading: string
  recordedAt: string
  gpsLatitude: string
  gpsLongitude: string
  installedAt: string
  readingId: string
}

const selectedSensor = ref<IoTSensor | null>(null)

const page = computed(
  () =>
    ({
      roles: {
        title: 'Role & Permission',
        eyebrow: 'ACCESS CONTROL',
        active: 'Role & Permission',
        intro: 'Configure access levels and review what each system role can do.',
      },
      iot: {
        title: 'IoT Monitoring',
        eyebrow: 'LIVE MONITORING',
        active: 'IoT Monitoring',
        intro: 'Monitor live environmental readings and sensor connectivity across Niah.',
      },
      sensors: {
        title: 'Sensor Management',
        eyebrow: 'DEVICE ADMINISTRATION',
        active: 'Sensor Management',
        intro: 'Register, assign, and maintain the IoT sensors protecting documented plants.',
      },
      alerts: {
        title: 'Threat Alerts',
        eyebrow: 'RISK MONITORING',
        active: 'Threat Alerts',
        intro: 'Review and track environmental, movement, and connectivity threats.',
      },
      activity: {
        title: 'System Activity',
        eyebrow: 'AUDIT & SECURITY',
        active: 'System Activity',
        intro: 'Review administrative actions, account events, and system changes.',
      },
    })[props.section],
)

const permissions = [
  { module: 'Dashboard overview', admin: true, officer: true, botanist: true },
  { module: 'User management', admin: true, officer: false, botanist: false },
  { module: 'Role & permission', admin: true, officer: false, botanist: false },
  { module: 'IoT monitoring', admin: true, officer: true, botanist: false },
  { module: 'Sensor management', admin: true, officer: true, botanist: false },
  { module: 'Threat alerts', admin: true, officer: true, botanist: false },
  { module: 'Plant observations', admin: false, officer: true, botanist: true },
  { module: 'System activity', admin: true, officer: false, botanist: false },
]

const sensors = [
  {
    id: 'S001',
    plant: 'PL001',
    zone: 'Zone A',
    type: 'Environment',
    temp: '29°C',
    humidity: '82%',
    movement: 'No',
    status: 'Online',
    battery: '94%',
    update: '2 mins ago',
  },
  {
    id: 'S002',
    plant: 'PL002',
    zone: 'Zone A',
    type: 'Motion',
    temp: '31°C',
    humidity: '75%',
    movement: 'Yes',
    status: 'Alert',
    battery: '81%',
    update: '5 mins ago',
  },
  {
    id: 'S003',
    plant: 'PL003',
    zone: 'Zone B',
    type: 'Environment',
    temp: '28°C',
    humidity: '85%',
    movement: 'No',
    status: 'Offline',
    battery: '12%',
    update: '20 mins ago',
  },
  {
    id: 'S004',
    plant: 'PL010',
    zone: 'Zone B',
    type: 'Temperature',
    temp: '30°C',
    humidity: '78%',
    movement: 'No',
    status: 'Online',
    battery: '76%',
    update: '3 mins ago',
  },
  {
    id: 'S005',
    plant: 'PL021',
    zone: 'Zone C',
    type: 'Motion',
    temp: '27°C',
    humidity: '88%',
    movement: 'No',
    status: 'Online',
    battery: '89%',
    update: '1 min ago',
  },
]

const iotSensors: IoTSensor[] = [
  {
    id: 'S001',
    deviceName: 'Environmental Sensor 01',
    deviceType: 'Environment',
    serialNumber: 'SN-NIAH-0001',
    locationDescription: 'Northern trail near PL001',
    plant: 'PL001',
    temperature: '29°C',
    humidity: '82%',
    soilMoisture: '68%',
    rainfall: 'No',
    movement: 'No',
    status: 'Online',
    lastReading: '2 mins ago',
    recordedAt: '29 Sep 2026, 1:18 PM',
    gpsLatitude: '3.80792',
    gpsLongitude: '113.78864',
    installedAt: '12 Aug 2026',
    readingId: 'RD001',
  },
  {
    id: 'S002',
    deviceName: 'Motion Sensor 02',
    deviceType: 'Motion',
    serialNumber: 'SN-NIAH-0002',
    locationDescription: 'Boardwalk beside PL002',
    plant: 'PL002',
    temperature: '31°C',
    humidity: '75%',
    soilMoisture: '61%',
    rainfall: 'No',
    movement: 'Yes',
    status: 'Alert',
    lastReading: '5 mins ago',
    recordedAt: '29 Sep 2026, 1:15 PM',
    gpsLatitude: '3.80841',
    gpsLongitude: '113.78912',
    installedAt: '12 Aug 2026',
    readingId: 'RD002',
  },
  {
    id: 'S003',
    deviceName: 'Environmental Sensor 03',
    deviceType: 'Environment',
    serialNumber: 'SN-NIAH-0003',
    locationDescription: 'Limestone path near PL003',
    plant: 'PL003',
    temperature: '28°C',
    humidity: '85%',
    soilMoisture: '74%',
    rainfall: 'Yes',
    movement: 'No',
    status: 'Offline',
    lastReading: '20 mins ago',
    recordedAt: '29 Sep 2026, 1:00 PM',
    gpsLatitude: '3.80903',
    gpsLongitude: '113.79024',
    installedAt: '18 Aug 2026',
    readingId: 'RD003',
  },
  {
    id: 'S004',
    deviceName: 'Temperature Sensor 04',
    deviceType: 'Temperature',
    serialNumber: 'SN-NIAH-0004',
    locationDescription: 'Cave entrance near PL010',
    plant: 'PL010',
    temperature: '30°C',
    humidity: '78%',
    soilMoisture: '65%',
    rainfall: 'No',
    movement: 'No',
    status: 'Online',
    lastReading: '3 mins ago',
    recordedAt: '29 Sep 2026, 1:17 PM',
    gpsLatitude: '3.81015',
    gpsLongitude: '113.79108',
    installedAt: '20 Aug 2026',
    readingId: 'RD004',
  },
  {
    id: 'S005',
    deviceName: 'Motion Sensor 05',
    deviceType: 'Motion',
    serialNumber: 'SN-NIAH-0005',
    locationDescription: 'Southern research plot near PL021',
    plant: 'PL021',
    temperature: '27°C',
    humidity: '88%',
    soilMoisture: '79%',
    rainfall: 'No',
    movement: 'No',
    status: 'Online',
    lastReading: '1 min ago',
    recordedAt: '29 Sep 2026, 1:19 PM',
    gpsLatitude: '3.80677',
    gpsLongitude: '113.78753',
    installedAt: '22 Aug 2026',
    readingId: 'RD005',
  },
]

const iotAlerts = [
  {
    id: 'A001',
    plant: 'PL002',
    readingId: 'RD002',
    type: 'Movement Detected',
    severity: 'High',
    confidence: '94%',
    status: 'New',
    createdAt: '29 Sep 2026, 10:35 AM',
  },
  {
    id: 'A002',
    plant: 'PL010',
    readingId: 'RD004',
    type: 'High Temperature',
    severity: 'Medium',
    confidence: '87%',
    status: 'Reviewing',
    createdAt: '29 Sep 2026, 11:20 AM',
  },
  {
    id: 'A003',
    plant: 'PL003',
    readingId: 'RD003',
    type: 'Sensor Offline',
    severity: 'Low',
    confidence: '99%',
    status: 'New',
    createdAt: '29 Sep 2026, 12:05 PM',
  },
]

const alerts = [
  {
    id: 'A001',
    plant: 'PL002',
    sensor: 'S002',
    type: 'Movement Detected',
    zone: 'Zone A',
    time: '29 Sep 2026, 10:35 AM',
    severity: 'High',
    status: 'New',
  },
  {
    id: 'A002',
    plant: 'PL010',
    sensor: 'S004',
    type: 'High Temperature',
    zone: 'Zone B',
    time: '29 Sep 2026, 11:20 AM',
    severity: 'Medium',
    status: 'Reviewing',
  },
  {
    id: 'A003',
    plant: 'PL021',
    sensor: 'S003',
    type: 'Sensor Offline',
    zone: 'Zone C',
    time: '29 Sep 2026, 12:05 PM',
    severity: 'Low',
    status: 'New',
  },
  {
    id: 'A004',
    plant: 'PL014',
    sensor: 'S011',
    type: 'Low Battery',
    zone: 'Zone B',
    time: '28 Sep 2026, 4:16 PM',
    severity: 'Low',
    status: 'Resolved',
  },
]

const logs = [
  {
    actor: 'Admin01',
    action: 'Created Botanist account for Siti Hajar',
    module: 'User Management',
    ip: '192.168.1.12',
    time: '29 Sep 2026, 10:20 AM',
    level: 'Info',
  },
  {
    actor: 'Admin02',
    action: 'Updated configuration for Sensor S002',
    module: 'Sensor Management',
    ip: '192.168.1.18',
    time: '29 Sep 2026, 11:05 AM',
    level: 'Info',
  },
  {
    actor: 'Admin01',
    action: 'Changed user role from Botanist to Officer',
    module: 'Role & Permission',
    ip: '192.168.1.12',
    time: '29 Sep 2026, 12:10 PM',
    level: 'Security',
  },
  {
    actor: 'System',
    action: 'Sensor S003 changed status to Offline',
    module: 'IoT Monitoring',
    ip: 'System',
    time: '29 Sep 2026, 12:30 PM',
    level: 'Warning',
  },
  {
    actor: 'Admin02',
    action: 'Resolved threat alert A004',
    module: 'Threat Alerts',
    ip: '192.168.1.18',
    time: '29 Sep 2026, 1:04 PM',
    level: 'Info',
  },
]

const filteredSensors = computed(() =>
  sensors.filter(
    (s) =>
      (!search.value ||
        Object.values(s).join(' ').toLowerCase().includes(search.value.toLowerCase())) &&
      (filter.value === 'All' || s.status === filter.value),
  ),
)
const filteredIoTSensors = computed(() => {
  const query = search.value.trim().toLowerCase()
  return iotSensors.filter((sensor) => {
    const matchesSearch =
      !query ||
      [
        sensor.id,
        sensor.deviceName,
        sensor.plant,
        sensor.serialNumber,
        sensor.locationDescription,
        sensor.deviceType,
      ].some((value) => value.toLowerCase().includes(query))
    return matchesSearch && (filter.value === 'All' || sensor.status === filter.value)
  })
})
const filteredAlerts = computed(() =>
  alerts.filter(
    (a) =>
      (!search.value ||
        Object.values(a).join(' ').toLowerCase().includes(search.value.toLowerCase())) &&
      (filter.value === 'All' || a.status === filter.value || a.severity === filter.value),
  ),
)
const filteredLogs = computed(() =>
  logs.filter(
    (l) =>
      (!search.value ||
        Object.values(l).join(' ').toLowerCase().includes(search.value.toLowerCase())) &&
      (filter.value === 'All' || l.level === filter.value),
  ),
)

const openSensorDetails = (sensor: IoTSensor) => {
  selectedSensor.value = sensor
}

const closeSensorDetails = () => {
  selectedSensor.value = null
}
</script>

<template>
  <AdminPageShell :title="page.title" :eyebrow="page.eyebrow" :active="page.active">
    <section class="page-intro">
      <div>
        <h2>{{ page.title }}</h2>
        <p>{{ page.intro }}</p>
      </div>
      <button v-if="section === 'roles'" class="primary" type="button">＋ Create Role</button
      ><button v-else-if="section === 'sensors'" class="primary" type="button">
        ＋ Register Sensor</button
      ><button v-else-if="section === 'activity'" class="secondary" type="button">
        Export Activity
      </button>
    </section>

    <template v-if="section === 'roles'">
      <section class="stat-grid three">
        <article>
          <span>◇</span>
          <div>
            <p>System Roles</p>
            <strong>3</strong><small>Active access groups</small>
          </div>
        </article>
        <article>
          <span>♙</span>
          <div>
            <p>Assigned Users</p>
            <strong>18</strong><small>Across all roles</small>
          </div>
        </article>
        <article>
          <span>✓</span>
          <div>
            <p>Permissions</p>
            <strong>24</strong><small>Configured rules</small>
          </div>
        </article>
      </section>
      <section class="role-cards">
        <article>
          <div class="role-head">
            <span>A</span>
            <div>
              <h3>Administrator</h3>
              <p>Full system access</p>
            </div>
            <b>3 users</b>
          </div>
          <p>Manages accounts, roles, sensors, alerts, and system activity.</p>
          <button type="button">Edit permissions</button>
        </article>
        <article>
          <div class="role-head">
            <span>C</span>
            <div>
              <h3>Conservation Officer</h3>
              <p>Conservation operations</p>
            </div>
            <b>5 users</b>
          </div>
          <p>Monitors sensors, handles threats, and reviews field observations.</p>
          <button type="button">Edit permissions</button>
        </article>
        <article>
          <div class="role-head">
            <span>B</span>
            <div>
              <h3>Botanist</h3>
              <p>Research access</p>
            </div>
            <b>10 users</b>
          </div>
          <p>Documents plant observations and contributes scientific information.</p>
          <button type="button">Edit permissions</button>
        </article>
      </section>
      <section class="panel">
        <div class="panel-head">
          <div>
            <p>ACCESS MATRIX</p>
            <h2>Module Permissions</h2>
          </div>
          <span>✓ Allowed &nbsp; — Restricted</span>
        </div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>System module</th>
                <th>Administrator</th>
                <th>Conservation Officer</th>
                <th>Botanist</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in permissions" :key="row.module">
                <td>
                  <strong>{{ row.module }}</strong>
                </td>
                <td>
                  <i :class="{ allowed: row.admin }">{{ row.admin ? '✓' : '—' }}</i>
                </td>
                <td>
                  <i :class="{ allowed: row.officer }">{{ row.officer ? '✓' : '—' }}</i>
                </td>
                <td>
                  <i :class="{ allowed: row.botanist }">{{ row.botanist ? '✓' : '—' }}</i>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <template v-else-if="section === 'iot'">
      <section class="stat-grid four">
        <article>
          <span>⌁</span>
          <div>
            <p>Total Sensors</p>
            <strong>27</strong><small>Registered devices</small>
          </div>
        </article>
        <article>
          <span>✓</span>
          <div>
            <p>Online Sensors</p>
            <strong>25</strong><small>92.6% available</small>
          </div>
        </article>
        <article class="warning">
          <span>×</span>
          <div>
            <p>Offline Sensors</p>
            <strong>2</strong><small>Needs attention</small>
          </div>
        </article>
        <article class="danger">
          <span>!</span>
          <div>
            <p>Active Threat Alerts</p>
            <strong>3</strong><small>2 unreviewed</small>
          </div>
        </article>
      </section>
      <section class="network-overview">
        <div class="panel-head">
          <div>
            <p>SENSOR NETWORK OVERVIEW</p>
            <h2>Connectivity Summary</h2>
          </div>
          <span class="live"><i></i> Updating</span>
        </div>
        <div class="network-metrics">
          <article><small>Online Sensors</small><strong>25</strong></article>
          <article><small>Offline Sensors</small><strong>2</strong></article>
          <article><small>Latest Reading</small><strong>2 mins ago</strong></article>
          <article><small>Reporting Today</small><strong>25 / 27</strong></article>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head">
          <div>
            <p>LIVE SENSOR FEED</p>
            <h2>Current Readings</h2>
          </div>
          <span class="live"><i></i> Updating</span>
        </div>
        <div class="filters">
          <label
            ><span>⌕</span
            ><input
              v-model="search"
              placeholder="Search sensor, device, plant or location..." /></label
          ><select v-model="filter">
            <option>All</option>
            <option>Online</option>
            <option>Offline</option>
            <option>Alert</option>
          </select>
        </div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Sensor</th>
                <th>Device</th>
                <th>Plant</th>
                <th>Temperature</th>
                <th>Humidity</th>
                <th>Soil Moisture</th>
                <th>Rainfall</th>
                <th>Motion</th>
                <th>Status</th>
                <th>Last Reading</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in filteredIoTSensors" :key="s.id">
                <td>
                  <strong>{{ s.id }}</strong>
                </td>
                <td>{{ s.deviceName }}</td>
                <td>{{ s.plant }}</td>
                <td>{{ s.temperature }}</td>
                <td>{{ s.humidity }}</td>
                <td>{{ s.soilMoisture }}</td>
                <td>{{ s.rainfall }}</td>
                <td>{{ s.movement }}</td>
                <td>
                  <em class="badge" :class="s.status.toLowerCase()">{{ s.status }}</em>
                </td>
                <td>{{ s.lastReading }}</td>
                <td>
                  <button class="table-action" type="button" @click="openSensorDetails(s)">
                    View
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head">
          <div>
            <p>RECENT THREAT ALERTS</p>
            <h2>Latest Alerts</h2>
          </div>
          <RouterLink class="secondary panel-link" to="/admin/alerts">View All Alerts</RouterLink>
        </div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Alert ID</th>
                <th>Plant ID</th>
                <th>Alert Type</th>
                <th>Severity</th>
                <th>Confidence</th>
                <th>Status</th>
                <th>Created At</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="alert in iotAlerts" :key="alert.id">
                <td>
                  <strong>{{ alert.id }}</strong>
                </td>
                <td>{{ alert.plant }}</td>
                <td>{{ alert.type }}</td>
                <td>
                  <em class="badge" :class="alert.severity.toLowerCase()">{{ alert.severity }}</em>
                </td>
                <td>{{ alert.confidence }}</td>
                <td>
                  <em class="badge" :class="alert.status.toLowerCase()">{{ alert.status }}</em>
                </td>
                <td>{{ alert.createdAt }}</td>
                <td>
                  <RouterLink class="table-action action-link" to="/admin/alerts">View</RouterLink>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <template v-else-if="section === 'sensors'">
      <section class="stat-grid four">
        <article>
          <span>◉</span>
          <div>
            <p>Registered</p>
            <strong>27</strong><small>Total devices</small>
          </div>
        </article>
        <article>
          <span>✓</span>
          <div>
            <p>Assigned</p>
            <strong>26</strong><small>Linked to plants</small>
          </div>
        </article>
        <article>
          <span>□</span>
          <div>
            <p>Unassigned</p>
            <strong>1</strong><small>Ready for setup</small>
          </div>
        </article>
        <article class="warning">
          <span>⌁</span>
          <div>
            <p>Maintenance</p>
            <strong>2</strong><small>Service scheduled</small>
          </div>
        </article>
      </section>
      <section class="panel">
        <div class="panel-head">
          <div>
            <p>DEVICE INVENTORY</p>
            <h2>All Sensors</h2>
          </div>
          <span>{{ filteredSensors.length }} records</span>
        </div>
        <div class="filters">
          <label
            ><span>⌕</span
            ><input v-model="search" placeholder="Search sensor, plant, type or zone..." /></label
          ><select v-model="filter">
            <option>All</option>
            <option>Online</option>
            <option>Offline</option>
            <option>Alert</option>
          </select>
        </div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Sensor ID</th>
                <th>Type</th>
                <th>Assigned Plant</th>
                <th>Zone</th>
                <th>Battery</th>
                <th>Status</th>
                <th>Last Update</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in filteredSensors" :key="s.id">
                <td>
                  <strong>{{ s.id }}</strong>
                </td>
                <td>{{ s.type }}</td>
                <td>{{ s.plant }}</td>
                <td>{{ s.zone }}</td>
                <td>
                  <div class="battery"><span :style="{ width: s.battery }"></span></div>
                  <small>{{ s.battery }}</small>
                </td>
                <td>
                  <em class="badge" :class="s.status.toLowerCase()">{{ s.status }}</em>
                </td>
                <td>{{ s.update }}</td>
                <td><button class="table-action">Manage</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <template v-else-if="section === 'alerts'">
      <section class="stat-grid four">
        <article class="danger">
          <span>!</span>
          <div>
            <p>Active Alerts</p>
            <strong>3</strong><small>Require review</small>
          </div>
        </article>
        <article>
          <span>●</span>
          <div>
            <p>High Severity</p>
            <strong>1</strong><small>Immediate action</small>
          </div>
        </article>
        <article>
          <span>⌕</span>
          <div>
            <p>Reviewing</p>
            <strong>1</strong><small>Being investigated</small>
          </div>
        </article>
        <article>
          <span>✓</span>
          <div>
            <p>Resolved Today</p>
            <strong>4</strong><small>Closed alerts</small>
          </div>
        </article>
      </section>
      <section class="panel">
        <div class="panel-head">
          <div>
            <p>THREAT REGISTER</p>
            <h2>All Threat Alerts</h2>
          </div>
          <button class="secondary">Export Alerts</button>
        </div>
        <div class="filters">
          <label
            ><span>⌕</span
            ><input
              v-model="search"
              placeholder="Search alert, plant, sensor or location..." /></label
          ><select v-model="filter">
            <option>All</option>
            <option>New</option>
            <option>Reviewing</option>
            <option>Resolved</option>
            <option>High</option>
            <option>Medium</option>
            <option>Low</option>
          </select>
        </div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Alert</th>
                <th>Plant / Sensor</th>
                <th>Threat Type</th>
                <th>Zone</th>
                <th>Date & Time</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in filteredAlerts" :key="a.id">
                <td>
                  <strong>{{ a.id }}</strong>
                </td>
                <td>{{ a.plant }} / {{ a.sensor }}</td>
                <td>{{ a.type }}</td>
                <td>{{ a.zone }}</td>
                <td>{{ a.time }}</td>
                <td>
                  <em class="badge" :class="a.severity.toLowerCase()">{{ a.severity }}</em>
                </td>
                <td>
                  <em class="badge" :class="a.status.toLowerCase()">{{ a.status }}</em>
                </td>
                <td><button class="table-action">View</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <template v-else>
      <section class="stat-grid four">
        <article>
          <span>↻</span>
          <div>
            <p>Events Today</p>
            <strong>42</strong><small>All modules</small>
          </div>
        </article>
        <article>
          <span>♙</span>
          <div>
            <p>User Actions</p>
            <strong>18</strong><small>Administrative events</small>
          </div>
        </article>
        <article class="warning">
          <span>!</span>
          <div>
            <p>Warnings</p>
            <strong>3</strong><small>System-generated</small>
          </div>
        </article>
        <article>
          <span>✓</span>
          <div>
            <p>Security Events</p>
            <strong>1</strong><small>No critical incidents</small>
          </div>
        </article>
      </section>
      <section class="panel">
        <div class="panel-head">
          <div>
            <p>ADMINISTRATIVE AUDIT TRAIL</p>
            <h2>Recent System Activity</h2>
          </div>
          <span>{{ filteredLogs.length }} events shown</span>
        </div>
        <div class="filters">
          <label
            ><span>⌕</span
            ><input v-model="search" placeholder="Search actor, action, module or IP..." /></label
          ><select v-model="filter">
            <option>All</option>
            <option>Info</option>
            <option>Security</option>
            <option>Warning</option>
          </select>
        </div>
        <div class="activity-list">
          <article v-for="log in filteredLogs" :key="log.time">
            <span class="event-icon" :class="log.level.toLowerCase()">{{
              log.level === 'Warning' ? '!' : log.level === 'Security' ? '◇' : '↻'
            }}</span>
            <div class="event-main">
              <strong>{{ log.action }}</strong>
              <p>
                <b>{{ log.actor }}</b> · {{ log.module }} · {{ log.ip }}
              </p>
            </div>
            <time>{{ log.time }}</time
            ><em class="badge" :class="log.level.toLowerCase()">{{ log.level }}</em>
          </article>
        </div>
      </section>
    </template>

    <div
      v-if="section === 'iot' && selectedSensor"
      class="sensor-modal-backdrop"
      @click.self="closeSensorDetails"
    >
      <section
        class="sensor-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sensor-details-title"
      >
        <header class="sensor-modal-head">
          <div>
            <p>SENSOR DETAILS</p>
            <h2 id="sensor-details-title">{{ selectedSensor.deviceName }}</h2>
          </div>
          <button type="button" aria-label="Close sensor details" @click="closeSensorDetails">
            ×
          </button>
        </header>
        <div class="detail-section">
          <h3>DEVICE INFORMATION</h3>
          <dl>
            <div>
              <dt>Sensor ID</dt>
              <dd>{{ selectedSensor.id }}</dd>
            </div>
            <div>
              <dt>Device Name</dt>
              <dd>{{ selectedSensor.deviceName }}</dd>
            </div>
            <div>
              <dt>Device Type</dt>
              <dd>{{ selectedSensor.deviceType }}</dd>
            </div>
            <div>
              <dt>Serial Number</dt>
              <dd>{{ selectedSensor.serialNumber }}</dd>
            </div>
            <div class="detail-wide">
              <dt>Location Description</dt>
              <dd>{{ selectedSensor.locationDescription }}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <em class="badge" :class="selectedSensor.status.toLowerCase()">{{
                  selectedSensor.status
                }}</em>
              </dd>
            </div>
            <div>
              <dt>Installed At</dt>
              <dd>{{ selectedSensor.installedAt }}</dd>
            </div>
          </dl>
        </div>
        <div class="detail-section">
          <h3>LATEST READING</h3>
          <dl>
            <div>
              <dt>Reading ID</dt>
              <dd>{{ selectedSensor.readingId }}</dd>
            </div>
            <div>
              <dt>Plant ID</dt>
              <dd>{{ selectedSensor.plant }}</dd>
            </div>
            <div>
              <dt>Temperature</dt>
              <dd>{{ selectedSensor.temperature }}</dd>
            </div>
            <div>
              <dt>Humidity</dt>
              <dd>{{ selectedSensor.humidity }}</dd>
            </div>
            <div>
              <dt>Soil Moisture</dt>
              <dd>{{ selectedSensor.soilMoisture }}</dd>
            </div>
            <div>
              <dt>Rainfall Detected</dt>
              <dd>{{ selectedSensor.rainfall }}</dd>
            </div>
            <div>
              <dt>Motion Detected</dt>
              <dd>{{ selectedSensor.movement }}</dd>
            </div>
            <div>
              <dt>Recorded At</dt>
              <dd>{{ selectedSensor.recordedAt }}</dd>
            </div>
          </dl>
        </div>
        <div class="detail-section">
          <h3>SENSOR READING GPS POSITION</h3>
          <dl>
            <div>
              <dt>Latitude</dt>
              <dd>{{ selectedSensor.gpsLatitude }}</dd>
            </div>
            <div>
              <dt>Longitude</dt>
              <dd>{{ selectedSensor.gpsLongitude }}</dd>
            </div>
          </dl>
        </div>
        <div class="sensor-modal-actions">
          <button class="primary" type="button" @click="closeSensorDetails">Close</button>
        </div>
      </section>
    </div>
  </AdminPageShell>
</template>

<style scoped>
* {
  box-sizing: border-box;
}
.page-intro {
  margin-bottom: 23px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}
.page-intro h2 {
  margin: 0 0 5px;
  color: #204b3c;
  font-size: 22px;
}
.page-intro p {
  margin: 0;
  color: #78877f;
  font-size: 13px;
}
.primary,
.secondary {
  padding: 10px 15px;
  border-radius: 9px;
  cursor: pointer;
  font: inherit;
  font-size: 10px;
  font-weight: 700;
}
.primary {
  border: 0;
  background: #32745b;
  color: #fff;
  box-shadow: 0 5px 13px rgba(50, 116, 91, 0.18);
}
.secondary {
  border: 1px solid #cfdcd3;
  background: #fff;
  color: #42745f;
}
.stat-grid {
  display: grid;
  gap: 14px;
}
.stat-grid.three {
  grid-template-columns: repeat(3, 1fr);
}
.stat-grid.four {
  grid-template-columns: repeat(4, 1fr);
}
.stat-grid article {
  padding: 18px;
  display: flex;
  align-items: flex-start;
  gap: 13px;
  border: 1px solid #e0e7df;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 6px 18px rgba(35, 70, 53, 0.045);
}
.stat-grid article > span {
  width: 39px;
  height: 39px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: #e4f0e8;
  color: #37785e;
  font-size: 18px;
  font-weight: 800;
}
.stat-grid article.warning > span {
  background: #fff0d9;
  color: #a36b13;
}
.stat-grid article.danger > span {
  background: #f8e4e0;
  color: #bd503e;
}
.stat-grid p {
  margin: 0 0 4px;
  color: #71817a;
  font-size: 10px;
  font-weight: 700;
}
.stat-grid strong {
  display: block;
  color: #274e40;
  font-size: 25px;
  line-height: 1;
}
.stat-grid small {
  display: block;
  margin-top: 6px;
  color: #93a099;
  font-size: 9px;
}
.panel {
  margin-top: 18px;
  padding: 23px;
  border: 1px solid #e0e7df;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 7px 22px rgba(35, 70, 53, 0.045);
}
.panel-head {
  margin-bottom: 20px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 15px;
}
.panel-head p {
  margin: 0 0 5px;
  color: #58a07f;
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 1.7px;
}
.panel-head h2 {
  margin: 0;
  color: #254c3e;
  font-size: 17px;
}
.panel-head > span {
  color: #82918a;
  font-size: 9px;
}
.role-cards {
  margin-top: 18px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}
.role-cards article {
  padding: 20px;
  border: 1px solid #e0e7df;
  border-radius: 15px;
  background: #fff;
}
.role-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.role-head > span {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: #dfece4;
  color: #34745b;
  font-weight: 800;
}
.role-head div {
  flex: 1;
}
.role-head h3 {
  margin: 0;
  color: #2b5244;
  font-size: 14px;
}
.role-head div p {
  margin: 3px 0 0;
  color: #8a9891;
  font-size: 8px;
}
.role-head b {
  padding: 5px 8px;
  border-radius: 999px;
  background: #edf3ee;
  color: #4d7564;
  font-size: 8px;
}
.role-cards article > p {
  min-height: 43px;
  margin: 17px 0;
  color: #6f7f78;
  font-size: 10px;
  line-height: 1.55;
}
.role-cards button {
  padding: 7px 10px;
  border: 1px solid #d4e0d7;
  border-radius: 7px;
  background: #fff;
  color: #3b775f;
  font: inherit;
  font-size: 9px;
  font-weight: 700;
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
  padding: 11px 12px;
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
td i {
  font-style: normal;
  color: #a7b0ac;
}
.allowed {
  width: 20px;
  height: 20px;
  display: inline-grid;
  place-items: center;
  border-radius: 50%;
  background: #dff1e6;
  color: #287a53 !important;
}
.zones {
  margin-top: 18px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}
.zones article {
  padding: 19px;
  border: 1px solid #e0e7df;
  border-radius: 15px;
  background: #fff;
}
.zones header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.zones header div {
  display: flex;
  align-items: center;
  gap: 8px;
}
.zones header span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #43a176;
  box-shadow: 0 0 0 4px #e4f3e9;
}
.zones h3 {
  margin: 0;
  color: #315548;
  font-size: 14px;
}
.zones header b {
  color: #52806c;
  font-size: 9px;
}
.zone-reading {
  margin-top: 18px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.zone-reading p {
  margin: 0;
}
.zone-reading small {
  display: block;
  color: #8e9b95;
  font-size: 7px;
  text-transform: uppercase;
}
.zone-reading strong {
  display: block;
  margin-top: 4px;
  color: #37594d;
  font-size: 11px;
}
.filters {
  margin-bottom: 18px;
  display: grid;
  grid-template-columns: minmax(240px, 1fr) 180px;
  gap: 10px;
}
.filters label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border: 1px solid #dce4dc;
  border-radius: 9px;
  background: #f9fbf8;
}
.filters input {
  width: 100%;
  padding: 10px 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: #36574b;
  font: inherit;
  font-size: 10px;
}
.filters select {
  padding: 0 11px;
  border: 1px solid #dce4dc;
  border-radius: 9px;
  background: #f9fbf8;
  color: #526a60;
  font: inherit;
  font-size: 10px;
}
.live {
  display: flex;
  align-items: center;
  gap: 6px !important;
  color: #3b8065 !important;
  font-weight: 700;
}
.live i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #42a277;
  animation: pulse 1.5s infinite;
}
@keyframes pulse {
  50% {
    box-shadow: 0 0 0 5px rgba(66, 162, 119, 0.15);
  }
}
.badge {
  padding: 5px 8px;
  border-radius: 999px;
  font-size: 8px;
  font-style: normal;
  font-weight: 800;
}
.online,
.resolved,
.info {
  background: #dff1e6;
  color: #287a53;
}
.offline {
  background: #ebeeec;
  color: #66716c;
}
.alert,
.high,
.warning {
  background: #f8e1dd;
  color: #b84b3a;
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
.security {
  background: #ebe6f5;
  color: #685c9a;
}
.battery {
  width: 70px;
  height: 5px;
  display: inline-block;
  overflow: hidden;
  border-radius: 999px;
  background: #e9eeea;
  vertical-align: middle;
}
.battery span {
  height: 100%;
  display: block;
  background: #4b9d79;
}
.table-action {
  padding: 5px 9px;
  border: 1px solid #d3dfd6;
  border-radius: 6px;
  background: #fff;
  color: #3c795f;
  font: inherit;
  font-size: 9px;
  font-weight: 700;
}
.activity-list {
  display: grid;
}
.activity-list article {
  padding: 14px 4px;
  display: grid;
  grid-template-columns: 35px minmax(220px, 1fr) auto auto;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid #edf0ed;
}
.activity-list article:last-child {
  border: 0;
}
.event-icon {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 9px;
  background: #e2eee6;
  color: #34785d;
  font-weight: 800;
}
.event-icon.warning {
  background: #f8e1dd;
  color: #b84b3a;
}
.event-icon.security {
  background: #ebe6f5;
  color: #685c9a;
}
.event-main strong {
  color: #3d5b50;
  font-size: 10px;
}
.event-main p {
  margin: 4px 0 0;
  color: #929e98;
  font-size: 8px;
}
.event-main b {
  color: #5d776c;
}
.activity-list time {
  color: #7f8e87;
  font-size: 8px;
  white-space: nowrap;
}
@media (max-width: 1000px) {
  .stat-grid.four {
    grid-template-columns: repeat(2, 1fr);
  }
  .role-cards,
  .zones {
    grid-template-columns: 1fr;
  }
  .role-cards article > p {
    min-height: 0;
  }
}
@media (max-width: 620px) {
  .page-intro {
    align-items: flex-start;
    flex-direction: column;
  }
  .stat-grid.three,
  .stat-grid.four {
    grid-template-columns: 1fr;
  }
  .panel {
    padding: 17px;
  }
  .panel-head {
    align-items: flex-start;
    flex-direction: column;
  }
  .filters {
    grid-template-columns: 1fr;
  }
  .filters select {
    min-height: 39px;
  }
  .activity-list article {
    grid-template-columns: 35px 1fr;
  }
  .activity-list time,
  .activity-list article > .badge {
    grid-column: 2;
  }
  .zone-reading {
    gap: 4px;
  }
}

.network-overview {
  margin-top: 18px;
  padding: 20px 23px;
  border: 1px solid #e0e7df;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 7px 22px rgba(35, 70, 53, 0.045);
}
.network-metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.network-metrics article {
  padding: 14px;
  border-radius: 10px;
  background: #f5f8f5;
}
.network-metrics small {
  display: block;
  color: #82918a;
  font-size: 8px;
  font-weight: 700;
  text-transform: uppercase;
}
.network-metrics strong {
  display: block;
  margin-top: 6px;
  color: #315749;
  font-size: 16px;
}
.panel-link,
.action-link {
  display: inline-block;
  text-decoration: none;
}
.sensor-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  padding: 20px;
  display: grid;
  place-items: center;
  overflow-y: auto;
  background: rgba(14, 39, 30, 0.56);
  backdrop-filter: blur(3px);
}
.sensor-modal {
  width: min(680px, 100%);
  max-height: calc(100vh - 40px);
  padding: 24px;
  overflow-y: auto;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 25px 70px rgba(16, 49, 37, 0.24);
}
.sensor-modal-head {
  margin-bottom: 20px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.sensor-modal-head p {
  margin: 0 0 5px;
  color: #58a07f;
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 1.7px;
}
.sensor-modal-head h2 {
  margin: 0;
  color: #254c3e;
  font-size: 18px;
}
.sensor-modal-head button {
  width: 31px;
  height: 31px;
  border: 0;
  border-radius: 8px;
  background: #eef2ee;
  color: #60746b;
  cursor: pointer;
  font-size: 19px;
}
.detail-section {
  margin-top: 14px;
  padding: 15px;
  border: 1px solid #e2e9e2;
  border-radius: 10px;
}
.detail-section h3 {
  margin: 0 0 12px;
  color: #4d7a68;
  font-size: 8px;
  letter-spacing: 1.2px;
}
.detail-section dl {
  margin: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.detail-section dl div {
  min-width: 0;
}
.detail-section .detail-wide {
  grid-column: 1 / -1;
}
.detail-section dt {
  color: #8a9891;
  font-size: 8px;
  font-weight: 700;
}
.detail-section dd {
  margin: 4px 0 0;
  color: #36584b;
  font-size: 10px;
  font-weight: 700;
  overflow-wrap: anywhere;
}
.sensor-modal-actions {
  margin-top: 18px;
  display: flex;
  justify-content: flex-end;
}
@media (max-width: 1000px) {
  .network-metrics {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 620px) {
  .network-overview,
  .sensor-modal {
    padding: 17px;
  }
  .network-metrics,
  .detail-section dl {
    grid-template-columns: 1fr;
  }
  .detail-section .detail-wide {
    grid-column: auto;
  }
}
</style>
