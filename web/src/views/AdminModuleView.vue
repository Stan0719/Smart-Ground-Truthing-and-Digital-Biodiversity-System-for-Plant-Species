<script setup lang="ts">
import { computed, nextTick, ref, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import ActionFeedback from '../components/ActionFeedback.vue'
import AdminPageShell from '../components/AdminPageShell.vue'
import {api} from '../services/auth'
import { plantApi } from '../services/plantApi'

type Section = 'roles' | 'iot' | 'sensors' | 'alerts' | 'activity' | 'settings'
const props = defineProps<{ section: Section }>()
const { t, te, locale } = useI18n()
const dataLabel = (value: string) => {
  const key = `adminModules.values.${value.toLowerCase().replace(/[^a-z0-9]+/g, '')}`
  return te(key) ? t(key) : value
}
const security=ref({session_hours:8,login_limit:30}), securitySaving=ref(false),securityMessage=ref('')
async function saveSecurity(){securitySaving.value=true;serverError.value='';try{await api('/admin/settings','PATCH',security.value);securityMessage.value='Security settings saved. All sessions were revoked; sign in again.'}catch(e){serverError.value=e instanceof Error?e.message:'Settings were not saved.'}finally{securitySaving.value=false}}
const enforced=ref<Record<string,string[]>>({}), assignedUsers=ref<{role:string}[]>([]), persistedEvents=ref<{id:number;user_id:string;actor_id:string;reason:string;created_at:number}[]>([]), serverError=ref(''), serverLoading=ref(true)
const roleSummaries = computed(() => [
  { role: 'Administrator', initial: 'A', key: 'administrator' },
  { role: 'Conservation Officer', initial: 'C', key: 'officer' },
  { role: 'Botanist', initial: 'B', key: 'botanist' },
  { role: 'Visitor', initial: 'V', key: 'visitor' },
].map(item => ({ ...item, count: assignedUsers.value.filter(user => user.role === item.role).length })))
onMounted(async()=>{try{if(props.section==='settings')security.value=(await api<{settings:typeof security.value}>('/admin/settings')).settings; if(props.section==='roles'){const [permissions,users]=await Promise.all([api<{permissions:Record<string,string[]>}>('/admin/permissions'),api<{users:{role:string}[]}>('/admin/users')]);enforced.value=permissions.permissions;assignedUsers.value=users.users} if(props.section==='activity')persistedEvents.value=(await api<{events:typeof persistedEvents.value}>('/admin/audit')).events}catch(e){serverError.value=e instanceof Error?e.message:'Unable to load authorized data.'}finally{serverLoading.value=false}})
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
  status: string
  lastReading: string
  recordedAt: string
  gpsLatitude: string
  gpsLongitude: string
  installedAt: string
  readingId: string
}

interface ThreatAlert {
  id: string
  plant: string
  readingId: string
  sensorId: string
  type: string
  severity: string
  confidence: string
  description: string
  imagePath: string
  status: string
  createdAt: string
  resolvedBy: string
  resolvedAt: string
  sensorLocation?: string
  temperature?: string
  humidity?: string
  soilMoisture?: string
  rainfall?: string
  movement?: string
  recordedAt?: string
  gpsLatitude?: string
  gpsLongitude?: string
  plantLatitude?: string
  plantLongitude?: string
  plantAccuracy?: string
}

type ActivityType = 'Info' | 'Security' | 'Warning' | 'Error'

interface ActivityLog {
  id: string
  actor: string
  role: string
  action: string
  target: string
  module: string
  ipAddress: string
  timestamp: string
  type: ActivityType
}

const selectedSensor = ref<IoTSensor | null>(null)
const selectedAlert = ref<ThreatAlert | null>(null)
const alertModal = ref<'view' | 'resolve' | null>(null)
const alertStatusFilter = ref<'All Statuses' | ThreatAlert['status']>('All Statuses')
const alertSeverityFilter = ref<'All Severities' | ThreatAlert['severity']>('All Severities')
type SensorForm = Pick<
  IoTSensor,
  | 'id'
  | 'deviceName'
  | 'deviceType'
  | 'serialNumber'
  | 'locationDescription'
  | 'status'
  | 'installedAt'
>

const sensorModal = ref<'register' | 'view' | 'edit' | 'delete' | null>(null)
const sensorFormError = ref('')
const feedback = ref<{ id: number; variant: 'success' | 'error'; message: string } | null>(null)
let feedbackId = 0
const exportButton = ref<HTMLButtonElement | null>(null)
const exportDialog = ref<HTMLElement | null>(null)
const exportModalOpen = ref(false)
const exportFromDate = ref('')
const exportToDate = ref('')
const exportType = ref<'All' | ActivityType>('All')
const exportModule = ref('All Modules')
const exportScope = ref<'filtered' | 'all'>('filtered')
const exportFormat = ref<'csv' | 'pdf'>('csv')
const exportValidationMessage = ref('')
const sensorForm = ref<SensorForm>({
  id: '',
  deviceName: '',
  deviceType: '',
  serialNumber: '',
  locationDescription: '',
  status: 'Online',
  installedAt: '',
})

const page = computed(
  () =>
    ({
      settings:{title:'Security Settings',eyebrow:'SECURITY',active:'Security Settings',intro:'Account session and login limits.'},
      roles: {
        title: t('adminRoles.title'),
        eyebrow: t('adminRoles.eyebrow'),
        active: 'Role & Permission',
        intro: t('adminRoles.intro'),
      },
      iot: {
        title: 'IoT Monitoring',
        eyebrow: t('adminModules.iot.eyebrow'),
        active: 'IoT Monitoring',
        intro: t('adminModules.iot.intro'),
      },
      sensors: {
        title: 'Sensor Management',
        eyebrow: t('adminModules.sensors.eyebrow'),
        active: 'Sensor Management',
        intro: t('adminModules.sensors.intro'),
      },
      alerts: {
        title: 'Threat Alerts',
        eyebrow: t('adminModules.alerts.eyebrow'),
        active: 'Threat Alerts',
        intro: t('adminModules.alerts.intro'),
      },
      activity: {
        title: 'System Activity',
        eyebrow: t('adminModules.activity.eyebrow'),
        active: 'System Activity',
        intro: t('adminModules.activity.intro'),
      },
    })[props.section],
)

const permissions = [
  { module: 'dashboardOverview', admin: true, officer: true, botanist: true, visitor: false },
  { module: 'userManagement', admin: true, officer: false, botanist: false, visitor: false },
  { module: 'rolePermission', admin: true, officer: false, botanist: false, visitor: false },
  { module: 'iotMonitoring', admin: true, officer: true, botanist: false, visitor: false },
  { module: 'sensorManagement', admin: true, officer: true, botanist: false, visitor: false },
  { module: 'threatAlerts', admin: true, officer: true, botanist: false, visitor: false },
  { module: 'plantObservations', admin: false, officer: true, botanist: true, visitor: false },
  { module: 'systemActivity', admin: true, officer: false, botanist: false, visitor: false },
]

const sensors = ref<IoTSensor[]>([
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
    status: 'Online',
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
])

interface PlantDevice {
  id: string
  name: string
  plant_id: string | number | null
  status: string
  thresholds: Record<string, number>
  last_seen: string | null
}
interface PlantReading {
  id: string
  device_id: string
  values: Record<string, number>
  created_at: string
}
interface PlantAlert {
  id: string
  device_id: string
  reading_id: string
  metric: string
  value: number
  status: string
  created_at: string
}
interface DevicesResponse { devices: PlantDevice[] }
interface ReadingsResponse { readings: PlantReading[] }
interface AlertsResponse { alerts: PlantAlert[]; responses: unknown[] }

const liveDevices = ref<PlantDevice[]>([])
const liveReadings = ref<PlantReading[]>([])
const liveAlerts = ref<PlantAlert[]>([])
const iotLoading = ref(false)
const devicesLoaded = ref(false)
const readingsLoaded = ref(false)
const alertsLoaded = ref(false)
const devicesError = ref('')
const readingsError = ref('')
const alertsError = ref('')
let iotRequestVersion = 0

const scalarText = (value: string | number | null | undefined, fallback = '—') =>
  value === null || value === undefined || value === '' ? fallback : String(value)
const formattedTimestamp = (value: string | null | undefined) => {
  if (value === null || value === undefined || value === '') return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : formatActivityTimestamp(date.toISOString())
}
const latestReadingByDevice = computed(() => {
  const latest = new Map<string, PlantReading>()
  for (const reading of liveReadings.value) {
    if (!latest.has(reading.device_id)) latest.set(reading.device_id, reading)
  }
  return latest
})
const sensorRows = computed<IoTSensor[]>(() => liveDevices.value.map((device) => {
  const reading = latestReadingByDevice.value.get(device.id)
  const values = reading?.values || {}
  const measurement = (name: string, suffix = '') => {
    const value = values[name]
    return typeof value === 'number' && Number.isFinite(value) ? `${value}${suffix}` : '—'
  }
  return {
    id: device.id,
    deviceName: device.name,
    deviceType: '—',
    serialNumber: '—',
    locationDescription: '—',
    plant: scalarText(device.plant_id),
    temperature: measurement('temperature', '°C'),
    humidity: measurement('humidity', '%'),
    soilMoisture: measurement('soilMoisture'),
    rainfall: measurement('rainfall'),
    movement: measurement('movement'),
    status: device.status,
    lastReading: formattedTimestamp(reading?.created_at),
    recordedAt: formattedTimestamp(reading?.created_at),
    gpsLatitude: '—',
    gpsLongitude: '—',
    installedAt: '—',
    readingId: reading?.id || '—',
  }
}))

async function loadAdminIoTData() {
  const version = ++iotRequestVersion
  iotLoading.value = true
  devicesError.value = ''
  readingsError.value = ''
  alertsError.value = ''
  const [devicesResult, readingsResult, alertsResult] = await Promise.allSettled([
    plantApi<DevicesResponse>('/devices'),
    plantApi<ReadingsResponse>('/readings'),
    plantApi<AlertsResponse>('/alerts'),
  ])
  if (version !== iotRequestVersion) return
  if (devicesResult.status === 'fulfilled' && Array.isArray(devicesResult.value.devices)) {
    liveDevices.value = devicesResult.value.devices
    devicesLoaded.value = true
  } else {
    devicesError.value = devicesResult.status === 'rejected'
      ? (devicesResult.reason instanceof Error ? devicesResult.reason.message : 'Unable to load devices.')
      : 'The devices API returned an invalid response.'
  }
  if (readingsResult.status === 'fulfilled' && Array.isArray(readingsResult.value.readings)) {
    liveReadings.value = readingsResult.value.readings
    readingsLoaded.value = true
  } else {
    readingsError.value = readingsResult.status === 'rejected'
      ? (readingsResult.reason instanceof Error ? readingsResult.reason.message : 'Unable to load readings.')
      : 'The readings API returned an invalid response.'
  }
  if (alertsResult.status === 'fulfilled' && Array.isArray(alertsResult.value.alerts)) {
    liveAlerts.value = alertsResult.value.alerts
    alertsLoaded.value = true
  } else {
    alertsError.value = alertsResult.status === 'rejected'
      ? (alertsResult.reason instanceof Error ? alertsResult.reason.message : 'Unable to load alerts.')
      : 'The alerts API returned an invalid response.'
  }
  iotLoading.value = false
}

watch(() => props.section, (section) => {
  if (section === 'iot') void loadAdminIoTData()
  else iotRequestVersion += 1
}, { immediate: true })

const alerts = ref<ThreatAlert[]>([
  {
    id: 'A001',
    plant: 'PL002',
    readingId: 'RD002',
    sensorId: 'S002',
    type: 'Movement Detected',
    severity: 'High',
    confidence: '94%',
    description: 'Movement was detected near protected plant PL002.',
    imagePath: '',
    status: 'New',
    createdAt: '29 Sep 2026, 10:35 AM',
    resolvedBy: '',
    resolvedAt: '',
    sensorLocation: 'Boardwalk beside PL002',
    temperature: '31°C',
    humidity: '75%',
    soilMoisture: '61%',
    rainfall: 'No',
    movement: 'Yes',
    recordedAt: '29 Sep 2026, 10:34 AM',
    gpsLatitude: '3.80841',
    gpsLongitude: '113.78912',
    plantLatitude: '3.80838',
    plantLongitude: '113.78908',
    plantAccuracy: '4.2 m',
  },
  {
    id: 'A002',
    plant: 'PL010',
    readingId: 'RD004',
    sensorId: 'S004',
    type: 'High Temperature',
    severity: 'Medium',
    confidence: '87%',
    description: 'Temperature exceeded the configured monitoring threshold near PL010.',
    imagePath: '',
    status: 'Reviewing',
    createdAt: '29 Sep 2026, 11:20 AM',
    resolvedBy: '',
    resolvedAt: '',
    sensorLocation: 'Cave entrance near PL010',
    temperature: '30°C',
    humidity: '78%',
    soilMoisture: '65%',
    rainfall: 'No',
    movement: 'No',
    recordedAt: '29 Sep 2026, 11:19 AM',
    gpsLatitude: '3.81015',
    gpsLongitude: '113.79108',
    plantLatitude: '3.81011',
    plantLongitude: '113.79102',
    plantAccuracy: '3.8 m',
  },
  {
    id: 'A003',
    plant: 'PL003',
    readingId: 'RD003',
    sensorId: 'S003',
    type: 'Sensor Offline',
    severity: 'Low',
    confidence: '99%',
    description: 'Sensor S003 stopped reporting readings.',
    imagePath: '',
    status: 'New',
    createdAt: '29 Sep 2026, 12:05 PM',
    resolvedBy: '',
    resolvedAt: '',
    sensorLocation: 'Limestone path near PL003',
    temperature: '28°C',
    humidity: '85%',
    soilMoisture: '74%',
    rainfall: 'Yes',
    movement: 'No',
    recordedAt: '29 Sep 2026, 12:00 PM',
    gpsLatitude: '3.80903',
    gpsLongitude: '113.79024',
    plantLatitude: '3.80900',
    plantLongitude: '113.79019',
    plantAccuracy: '5.1 m',
  },
  {
    id: 'A004',
    plant: 'PL021',
    readingId: 'RD005',
    sensorId: 'S005',
    type: 'Rainfall Detected',
    severity: 'Low',
    confidence: '91%',
    description: 'Rainfall was detected at the southern research plot near PL021.',
    imagePath: '',
    status: 'Resolved',
    createdAt: '28 Sep 2026, 4:16 PM',
    resolvedBy: 'Admin02',
    resolvedAt: '28 Sep 2026, 5:02 PM',
    sensorLocation: 'Southern research plot near PL021',
    temperature: '27°C',
    humidity: '88%',
    soilMoisture: '79%',
    rainfall: 'Yes',
    movement: 'No',
    recordedAt: '28 Sep 2026, 4:15 PM',
    gpsLatitude: '3.80677',
    gpsLongitude: '113.78753',
    plantLatitude: '3.80672',
    plantLongitude: '113.78748',
    plantAccuracy: '4.7 m',
  },
])

const logs: ActivityLog[] = [
  {
    id: 'ACT001',
    actor: 'Admin01',
    role: 'Administrator',
    action: 'Created Botanist account',
    target: 'Siti Hajar',
    module: 'User Management',
    ipAddress: '192.168.1.12',
    timestamp: '2026-09-29T10:20:00',
    type: 'Info',
  },
  {
    id: 'ACT002',
    actor: 'Admin02',
    role: 'Administrator',
    action: 'Updated configuration',
    target: 'Sensor S002',
    module: 'Sensor Management',
    ipAddress: '192.168.1.18',
    timestamp: '2026-09-29T11:05:00',
    type: 'Info',
  },
  {
    id: 'ACT003',
    actor: 'Admin01',
    role: 'Administrator',
    action: 'Changed user role from Botanist to Officer',
    target: 'User role',
    module: 'Role & Permission',
    ipAddress: '192.168.1.12',
    timestamp: '2026-09-29T12:10:00',
    type: 'Security',
  },
  {
    id: 'ACT004',
    actor: 'System',
    role: 'System',
    action: 'Sensor S003 changed status to Offline',
    target: 'Sensor S003',
    module: 'IoT Monitoring',
    ipAddress: 'System',
    timestamp: '2026-09-29T12:30:00',
    type: 'Warning',
  },
  {
    id: 'ACT005',
    actor: 'Admin02',
    role: 'Administrator',
    action: 'Resolved threat alert A004',
    target: 'Threat alert A004',
    module: 'Threat Alerts',
    ipAddress: '192.168.1.18',
    timestamp: '2026-09-29T13:04:00',
    type: 'Info',
  },
]

const formatActivityTimestamp = (timestamp: string) =>
  new Intl.DateTimeFormat(
    locale.value === 'zh-CN' ? 'zh-CN' : locale.value === 'ms' ? 'ms-MY' : 'en-MY',
    {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    },
  ).format(new Date(timestamp))

const filteredSensors = computed(() => {
  const query = search.value.trim().toLowerCase()
  return sensors.value.filter((sensor) => {
    const matchesSearch =
      !query ||
      [
        sensor.id,
        sensor.deviceName,
        sensor.deviceType,
        sensor.serialNumber,
        sensor.locationDescription,
        sensor.plant,
      ].some((value) => value.toLowerCase().includes(query))
    return matchesSearch && (filter.value === 'All' || sensor.status === filter.value)
  })
})
const filteredIoTSensors = computed(() => {
  const query = search.value.trim().toLowerCase()
  return sensorRows.value.filter((sensor) => {
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
const iotStatusOptions = computed(() => [...new Set(sensorRows.value.map((sensor) => sensor.status))])
const recentAlerts = computed(() => liveAlerts.value.slice(0, 3))
const filteredAlerts = computed(() => {
  const query = search.value.trim().toLowerCase()
  return alerts.value.filter((alert) => {
    const matchesSearch =
      !query ||
      [
        alert.id,
        alert.plant,
        alert.sensorId,
        alert.readingId,
        alert.type,
        alert.description,
        alert.status,
        alert.severity,
      ].some((value) => value.toLowerCase().includes(query))
    const matchesStatus =
      alertStatusFilter.value === 'All Statuses' || alert.status === alertStatusFilter.value
    const matchesSeverity =
      alertSeverityFilter.value === 'All Severities' || alert.severity === alertSeverityFilter.value
    return matchesSearch && matchesStatus && matchesSeverity
  })
})
const filteredLogs = computed(() =>
  logs.filter(
    (l) =>
      (!search.value ||
        Object.values(l).join(' ').toLowerCase().includes(search.value.toLowerCase())) &&
      (filter.value === 'All' || l.type === filter.value),
  ),
)

const activeDeviceCount = computed(() => liveDevices.value.filter((device) => device.status === 'Active').length)
const inactiveDeviceCount = computed(() => liveDevices.value.filter((device) => device.status === 'Inactive').length)
const onlineSensorCount = computed(() => sensors.value.filter((sensor) => sensor.status === 'Online').length)
const offlineSensorCount = computed(() => sensors.value.filter((sensor) => sensor.status === 'Offline').length)
const latestReadingAge = computed(() => {
  const timestamps = liveReadings.value
    .map((reading) => new Date(reading.created_at).getTime())
    .filter((timestamp) => Number.isFinite(timestamp))
  if (!timestamps.length) return '—'
  const minutes = Math.max(0, Math.floor((Date.now() - Math.max(...timestamps)) / 60000))
  return minutes < 1 ? 'Just now' : `${minutes} min${minutes === 1 ? '' : 's'} ago`
})
const devicesWithReadingsCount = computed(() => liveDevices.value.filter((device) => device.last_seen !== null).length)
const maintenanceSensorCount = computed(
  () => sensors.value.filter((s) => s.status === 'Maintenance').length,
)
const activeAlertCount = computed(
  () => liveAlerts.value.filter((alert) => alert.status.toLowerCase() !== 'resolved').length,
)
const highSeverityAlertCount = computed(
  () =>
    alerts.value.filter((alert) => alert.severity === 'High' && alert.status !== 'Resolved').length,
)
const reviewingAlertCount = computed(
  () => alerts.value.filter((alert) => alert.status === 'Reviewing').length,
)
const resolvedAlertCount = computed(
  () => alerts.value.filter((alert) => alert.status === 'Resolved').length,
)
const selectedAlertSensor = computed(() =>
  selectedAlert.value
    ? sensors.value.find((sensor) => sensor.id === selectedAlert.value?.sensorId)
    : undefined,
)

const showSuccessMessage = (message: string) => {
  feedback.value = { id: ++feedbackId, variant: 'success', message }
}

const showErrorMessage = (message: string) => {
  feedback.value = { id: ++feedbackId, variant: 'error', message }
}

const dismissFeedback = (id: number) => {
  if (feedback.value?.id === id) feedback.value = null
}

const openExportModal = async () => {
  exportValidationMessage.value = ''
  exportModalOpen.value = true
  await nextTick()
  exportDialog.value?.focus()
}

const closeExportModal = async () => {
  exportModalOpen.value = false
  exportValidationMessage.value = ''
  await nextTick()
  exportButton.value?.focus()
}

const exportDateRangeLabel = () => {
  if (exportFromDate.value && exportToDate.value) {
    return `${exportFromDate.value} to ${exportToDate.value}`
  }
  if (exportFromDate.value) return `From ${exportFromDate.value}`
  if (exportToDate.value) return `Through ${exportToDate.value}`
  return 'All dates'
}

const activityRecordsForExport = () => {
  const source = exportScope.value === 'filtered' ? filteredLogs.value : logs
  return source.filter((log) => {
    const activityDate = log.timestamp.slice(0, 10)
    const matchesFrom = !exportFromDate.value || activityDate >= exportFromDate.value
    const matchesTo = !exportToDate.value || activityDate <= exportToDate.value
    const matchesType = exportType.value === 'All' || log.type === exportType.value
    const matchesModule = exportModule.value === 'All Modules' || log.module === exportModule.value
    return matchesFrom && matchesTo && matchesType && matchesModule
  })
}

const generateExportFilename = (extension: 'csv' | 'pdf') => {
  let datePart = new Date().toLocaleDateString('en-CA')
  if (exportFromDate.value && exportToDate.value) {
    datePart = `${exportFromDate.value}-to-${exportToDate.value}`
  } else if (exportFromDate.value || exportToDate.value) {
    datePart = exportFromDate.value || exportToDate.value
  }
  return `system-activity-${datePart}.${extension}`
}

const escapeCsvCell = (value: string) => `"${value.replace(/"/g, '""')}"`

const exportActivitiesToCsv = (records: ActivityLog[]) => {
  const rows = records.map((log) => [
    formatActivityTimestamp(log.timestamp),
    log.actor,
    log.role,
    log.action,
    log.module,
    log.target,
    log.ipAddress,
    log.type,
  ])
  const headings = [
    'Date & Time',
    'User',
    'Role',
    'Action',
    'Module',
    'Target',
    'IP Address',
    'Event Type',
  ]
  const csv = `\uFEFF${[headings, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')}`
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  const link = document.createElement('a')
  link.href = url
  link.download = generateExportFilename('csv')
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

const exportActivitiesToPdf = (records: ActivityLog[]) => {
  const document = new jsPDF({ orientation: 'landscape' })
  document.setTextColor(37, 76, 62)
  document.setFontSize(18)
  document.text('System Activity Report', 14, 17)
  document.setTextColor(90, 110, 101)
  document.setFontSize(9)
  const details = [
    `Exported: ${formatActivityTimestamp(new Date().toISOString())}`,
    `Date range: ${exportDateRangeLabel()}`,
    `Activity type: ${exportType.value}`,
    `Module: ${exportModule.value}`,
    `Total records: ${records.length}`,
  ]
  details.forEach((detail, index) => document.text(detail, 14, 25 + index * 5))
  autoTable(document, {
    startY: 53,
    head: [['Date/Time', 'User', 'Action', 'Module', 'IP Address', 'Type']],
    body: records.map((log) => [
      formatActivityTimestamp(log.timestamp),
      log.actor,
      `${log.action}${log.target ? ` — ${log.target}` : ''}`,
      log.module,
      log.ipAddress,
      log.type,
    ]),
    headStyles: { fillColor: [50, 116, 91] },
    styles: { fontSize: 8, cellPadding: 3 },
    alternateRowStyles: { fillColor: [244, 248, 244] },
  })
  document.save(generateExportFilename('pdf'))
}

const exportActivity = async () => {
  if (exportFromDate.value && exportToDate.value && exportFromDate.value > exportToDate.value) {
    exportValidationMessage.value = t('adminModules.export.dateValidation')
    return
  }

  const records = activityRecordsForExport()
  if (!records.length) {
    exportValidationMessage.value = t('adminModules.export.noRecords')
    return
  }

  exportValidationMessage.value = ''
  if (exportFormat.value === 'pdf') exportActivitiesToPdf(records)
  else exportActivitiesToCsv(records)
  await closeExportModal()
  showSuccessMessage(t('adminModules.export.success'))
}

const openAlertDetails = (alert: ThreatAlert) => {
  selectedAlert.value = alert
  alertModal.value = 'view'
}

const closeAlertModal = () => {
  selectedAlert.value = null
  alertModal.value = null
}

const markAlertReviewing = () => {
  const alert = selectedAlert.value
  if (!alert || alert.status !== 'New') {
    showErrorMessage(`Unable to update threat alert ${alert?.id ?? ''}. Please try again.`)
    return
  }
  alert.status = 'Reviewing'
  showSuccessMessage(`Threat alert ${alert.id} is now under review.`)
}

const openResolveConfirmation = () => {
  if (!selectedAlert.value || selectedAlert.value.status === 'Resolved') return
  alertModal.value = 'resolve'
}

const cancelResolveAlert = () => {
  alertModal.value = 'view'
}

const confirmResolveAlert = () => {
  const alert = selectedAlert.value
  if (!alert || alert.status === 'Resolved') {
    showErrorMessage(`Unable to resolve threat alert ${alert?.id ?? ''}. Please try again.`)
    return
  }
  alert.status = 'Resolved'
  alert.resolvedBy = 'Admin01'
  alert.resolvedAt = new Intl.DateTimeFormat('en-MY', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date())
  alertModal.value = 'view'
  showSuccessMessage(`Threat alert ${alert.id} was resolved successfully.`)
}

const nextSensorId = () => {
  const highestId = sensors.value.reduce((highest, sensor) => {
    const match = sensor.id.match(/^S(\d+)$/i)
    return match ? Math.max(highest, Number(match[1])) : highest
  }, 0)
  return `S${String(highestId + 1).padStart(3, '0')}`
}

const openRegisterSensor = () => {
  sensorForm.value = {
    id: nextSensorId(),
    deviceName: '',
    deviceType: '',
    serialNumber: '',
    locationDescription: '',
    status: 'Online',
    installedAt: '',
  }
  sensorFormError.value = ''
  sensorModal.value = 'register'
}

const openSensorDetails = (sensor: IoTSensor) => {
  selectedSensor.value = sensor
  sensorModal.value = 'view'
}

const closeSensorDetails = () => {
  selectedSensor.value = null
  sensorModal.value = null
  sensorFormError.value = ''
}

const openEditSensor = (sensor: IoTSensor) => {
  selectedSensor.value = sensor
  sensorForm.value = {
    id: sensor.id,
    deviceName: sensor.deviceName,
    deviceType: sensor.deviceType,
    serialNumber: sensor.serialNumber,
    locationDescription: sensor.locationDescription,
    status: sensor.status,
    installedAt: sensor.installedAt,
  }
  sensorFormError.value = ''
  sensorModal.value = 'edit'
}

const openDeleteSensor = (sensor: IoTSensor) => {
  selectedSensor.value = sensor
  sensorModal.value = 'delete'
}

const validateSensorForm = (editing = false) => {
  const form = sensorForm.value
  if (
    !form.deviceName.trim() ||
    !form.deviceType ||
    !form.serialNumber.trim() ||
    !form.status ||
    !form.installedAt
  ) {
    return 'Device name, device type, serial number, status and installed date are required.'
  }
  const serial = form.serialNumber.trim().toLowerCase()
  const duplicate = sensors.value.some(
    (sensor) =>
      sensor.serialNumber.trim().toLowerCase() === serial && (!editing || sensor.id !== form.id),
  )
  if (duplicate) {
    return editing
      ? 'Another sensor already uses this serial number.'
      : 'A sensor with this serial number already exists.'
  }
  return ''
}

const saveSensor = (editing = false) => {
  sensorFormError.value = validateSensorForm(editing)
  if (sensorFormError.value) {
    showErrorMessage(sensorFormError.value)
    return
  }
  const form = { ...sensorForm.value }
  if (editing) {
    const sensor = sensors.value.find((item) => item.id === form.id)
    if (!sensor) {
      sensorFormError.value = 'Unable to update this sensor. Please try again.'
      showErrorMessage(sensorFormError.value)
      return
    }
    Object.assign(sensor, form, {
      deviceName: form.deviceName.trim(),
      serialNumber: form.serialNumber.trim(),
      locationDescription: form.locationDescription.trim(),
    })
    closeSensorDetails()
    showSuccessMessage(`${form.deviceName.trim()} was updated successfully.`)
    return
  }
  sensors.value.push({
    ...form,
    deviceName: form.deviceName.trim(),
    serialNumber: form.serialNumber.trim(),
    locationDescription: form.locationDescription.trim(),
    plant: '—',
    temperature: '—',
    humidity: '—',
    soilMoisture: '—',
    rainfall: '—',
    movement: '—',
    lastReading: 'No readings yet',
    recordedAt: '—',
    gpsLatitude: '—',
    gpsLongitude: '—',
    readingId: '—',
  })
  closeSensorDetails()
  showSuccessMessage(`${form.deviceName.trim()} was registered successfully.`)
}

const confirmDeleteSensor = () => {
  const sensor = selectedSensor.value
  if (!sensor) {
    showErrorMessage('Unable to delete this sensor. Please try again.')
    return
  }
  const index = sensors.value.findIndex((item) => item.id === sensor.id)
  if (index < 0) {
    showErrorMessage(`Unable to delete ${sensor.deviceName}. Please try again.`)
    return
  }
  sensors.value.splice(index, 1)
  closeSensorDetails()
  showSuccessMessage(`${sensor.deviceName} was deleted successfully.`)
}
</script>

<template>
  <AdminPageShell :title="page.title" :eyebrow="page.eyebrow" :active="page.active">
<template v-if="['roles','activity','settings'].includes(section)">
<h2>{{page.title}}</h2><form v-if="section==='settings'&&!serverLoading" @submit.prevent="saveSecurity"><label>Session hours<input v-model.number="security.session_hours" type="number" min="1" max="24" required></label><label>Login attempts per 15 minutes<input v-model.number="security.login_limit" type="number" min="5" max="100" required></label><p>Saving revokes all existing sessions.</p><button :disabled="securitySaving">Save security settings</button><p role="status">{{securityMessage}}</p></form><p v-if="serverError" role="alert">{{serverError}}</p><p v-if="serverLoading">Loading?</p>
<template v-if="section==='roles'&&!serverLoading&&!serverError">
  <section class="stat-grid three" aria-label="Role summary">
    <article><span>R</span><div><p>{{ t('adminRoles.systemRoles') }}</p><strong>4</strong><small>{{ t('adminRoles.predefinedGroups') }}</small></div></article>
    <article><span>U</span><div><p>{{ t('adminRoles.assignedUsers') }}</p><strong>{{ assignedUsers.length }}</strong><small>{{ t('adminRoles.acrossAllRoles') }}</small></div></article>
    <article><span>P</span><div><p>{{ t('adminRoles.permissions') }}</p><strong>{{ Object.keys(enforced).length }}</strong><small>{{ t('adminRoles.configuredRules') }}</small></div></article>
  </section>
  <section class="role-cards" aria-label="System roles">
    <article v-for="item in roleSummaries" :key="item.role">
      <div class="role-head"><span>{{ item.initial }}</span><div><h3>{{ t(`adminRoles.roles.${item.key}.name`) }}</h3><p>{{ t(`adminRoles.roles.${item.key}.access`) }}</p></div><b>{{ t('adminRoles.userCount', { count: item.count }) }}</b></div>
      <p>{{ t(`adminRoles.roles.${item.key}.description`) }}</p>
      <span class="system-role-label">{{ t('adminRoles.systemDefined') }}</span>
    </article>
  </section>
  <p class="read-only-note">{{ t('adminRoles.readOnlyNotice') }}</p>
  <section class="panel permission-panel">
    <div class="panel-head"><div><p>{{ t('adminRoles.matrixEyebrow') }}</p><h2>{{ t('adminRoles.modulePermissions') }}</h2></div><span>{{ t('adminRoles.allowedRestricted') }}</span></div>
    <div class="table-scroll"><table><thead><tr><th>{{ t('adminRoles.systemModule') }}</th><th v-for="item in roleSummaries" :key="item.role">{{ t(`adminRoles.roles.${item.key}.name`) }}</th></tr></thead><tbody><tr v-for="(roles,permission) in enforced" :key="permission"><th>{{ permission }}</th><td v-for="item in roleSummaries" :key="item.role"><span :class="roles.includes(item.role)?'allowed':'restricted'">{{ roles.includes(item.role)?'✓':'—' }}</span></td></tr></tbody></table></div>
  </section>
</template>
<template v-if="section==='activity'&&!serverLoading&&!serverError"><p v-if="!persistedEvents.length">No account activity recorded.</p><table v-else><thead><tr><th>Time</th><th>Account</th><th>Actor</th><th>Action</th></tr></thead><tbody><tr v-for="event in persistedEvents" :key="event.id"><td>{{new Date(Number(event.created_at)).toLocaleString()}}</td><td>{{event.user_id||'Anonymous'}}</td><td>{{event.actor_id||'Self'}}</td><td>{{event.reason}}</td></tr></tbody></table></template>
</template><template v-else>

    <section class="page-intro">
      <div>
        <h2>{{ page.title }}</h2>
        <p>{{ page.intro }}</p>
      </div>
      <button
        v-if="section === 'sensors'"
        class="primary"
        type="button"
        @click="openRegisterSensor"
      >
        ＋ Register Sensor</button
      ><button
        v-else-if="section === 'activity'"
        ref="exportButton"
        class="secondary"
        type="button"
        @click="openExportModal"
      >
        Export Activity
      </button>
    </section>

    <template v-if="section === 'roles'">
      <section class="stat-grid three">
        <article>
          <span>◇</span>
          <div>
            <p>{{ t('adminRoles.systemRoles') }}</p>
            <strong>4</strong><small>{{ t('adminRoles.predefinedGroups') }}</small>
          </div>
        </article>
        <article>
          <span>♙</span>
          <div>
            <p>{{ t('adminRoles.assignedUsers') }}</p>
            <strong>18</strong><small>{{ t('adminRoles.acrossAllRoles') }}</small>
          </div>
        </article>
        <article>
          <span>✓</span>
          <div>
            <p>{{ t('adminRoles.permissions') }}</p>
            <strong>24</strong><small>{{ t('adminRoles.configuredRules') }}</small>
          </div>
        </article>
      </section>
      <section class="role-cards">
        <article>
          <div class="role-head">
            <span>A</span>
            <div>
              <h3>{{ t('adminRoles.roles.administrator.name') }}</h3>
              <p>{{ t('adminRoles.roles.administrator.access') }}</p>
            </div>
            <b>{{ t('adminRoles.userCount', { count: 3 }) }}</b>
          </div>
          <p>{{ t('adminRoles.roles.administrator.description') }}</p>
          <span class="system-role-label">{{ t('adminRoles.systemDefined') }}</span>
        </article>
        <article>
          <div class="role-head">
            <span>C</span>
            <div>
              <h3>{{ t('adminRoles.roles.officer.name') }}</h3>
              <p>{{ t('adminRoles.roles.officer.access') }}</p>
            </div>
            <b>{{ t('adminRoles.userCount', { count: 5 }) }}</b>
          </div>
          <p>{{ t('adminRoles.roles.officer.description') }}</p>
          <span class="system-role-label">{{ t('adminRoles.systemDefined') }}</span>
        </article>
        <article>
          <div class="role-head">
            <span>B</span>
            <div>
              <h3>{{ t('adminRoles.roles.botanist.name') }}</h3>
              <p>{{ t('adminRoles.roles.botanist.access') }}</p>
            </div>
            <b>{{ t('adminRoles.userCount', { count: 10 }) }}</b>
          </div>
          <p>{{ t('adminRoles.roles.botanist.description') }}</p>
          <span class="system-role-label">{{ t('adminRoles.systemDefined') }}</span>
        </article>
        <article>
          <div class="role-head">
            <span>V</span>
            <div>
              <h3>{{ t('adminRoles.roles.visitor.name') }}</h3>
              <p>{{ t('adminRoles.roles.visitor.access') }}</p>
            </div>
            <b>{{ t('adminRoles.prototype') }}</b>
          </div>
          <p>{{ t('adminRoles.roles.visitor.description') }}</p>
          <span class="system-role-label">{{ t('adminRoles.systemDefined') }}</span>
        </article>
      </section>
      <p class="read-only-note">
        {{ t('adminRoles.readOnlyNotice') }}
      </p>
      <section class="panel">
        <div class="panel-head">
          <div>
            <p>{{ t('adminRoles.matrixEyebrow') }}</p>
            <h2>{{ t('adminRoles.modulePermissions') }}</h2>
          </div>
          <span>{{ t('adminRoles.allowedRestricted') }}</span>
        </div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{{ t('adminRoles.systemModule') }}</th>
                <th>{{ t('adminRoles.roles.administrator.name') }}</th>
                <th>{{ t('adminRoles.roles.officer.name') }}</th>
                <th>{{ t('adminRoles.roles.botanist.name') }}</th>
                <th>{{ t('adminRoles.roles.visitor.name') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in permissions" :key="row.module">
                <td>
                  <strong>{{ t(`adminRoles.modules.${row.module}`) }}</strong>
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
                <td>
                  <i :class="{ allowed: row.visitor }">{{ row.visitor ? '✓' : '—' }}</i>
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
            <p>{{ t('adminModules.iot.totalSensors') }}</p>
            <strong>{{ devicesLoaded ? liveDevices.length : '—' }}</strong
            ><small>{{ t('adminModules.iot.registeredDevices') }}</small>
          </div>
        </article>
        <article>
          <span>✓</span>
          <div>
            <p>Active devices</p>
            <strong>{{ devicesLoaded ? activeDeviceCount : '—' }}</strong
            ><small>Stored device status</small>
          </div>
        </article>
        <article class="warning">
          <span>×</span>
          <div>
            <p>Inactive devices</p>
            <strong>{{ devicesLoaded ? inactiveDeviceCount : '—' }}</strong
            ><small>Stored device status</small>
          </div>
        </article>
        <article class="danger">
          <span>!</span>
          <div>
            <p>{{ t('adminModules.iot.activeThreatAlerts') }}</p>
            <strong>{{ alertsLoaded ? activeAlertCount : '—' }}</strong
            ><small>{{ alertsLoaded ? 'Not resolved' : 'Waiting for alert data' }}</small>
          </div>
        </article>
      </section>
      <section class="network-overview">
        <div class="panel-head">
          <div>
            <p>{{ t('adminModules.iot.networkEyebrow') }}</p>
            <h2>Device status and reporting</h2>
          </div>
          <span class="live"><i></i>{{ iotLoading ? 'Loading API data' : devicesError || readingsError || alertsError ? 'API unavailable' : 'PostgreSQL API data' }}</span>
        </div>
        <div class="network-metrics">
          <article>
            <small>Active devices</small
            ><strong>{{ devicesLoaded ? activeDeviceCount : '—' }}</strong>
          </article>
          <article>
            <small>Inactive devices</small
            ><strong>{{ devicesLoaded ? inactiveDeviceCount : '—' }}</strong>
          </article>
          <article>
            <small>{{ t('adminModules.iot.latestReading') }}</small
            ><strong>{{ devicesLoaded ? latestReadingAge : '—' }}</strong>
          </article>
          <article>
            <small>Devices reporting</small
            ><strong>{{ devicesLoaded ? `${devicesWithReadingsCount} / ${liveDevices.length}` : '—' }}</strong>
          </article>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head">
          <div>
            <p>{{ t('adminModules.iot.liveFeed') }}</p>
            <h2>Latest Available Readings</h2>
          </div>
          <span class="live"><i></i>{{ iotLoading ? 'Loading API data' : devicesError || readingsError ? 'Device or reading API unavailable' : 'PostgreSQL API data' }}</span>
        </div>
        <div class="filters">
          <label
            ><span>⌕</span
            ><input
              v-model="search"
              :placeholder="t('adminModules.iot.searchPlaceholder')" /></label
          ><select v-model="filter">
            <option>All</option>
            <option v-for="status in iotStatusOptions" :key="status" :value="status">{{ status }}</option>
          </select>
        </div>
        <div class="table-scroll">
          <p v-if="readingsError" role="alert">Reading data unavailable: {{ readingsError }} <button class="table-action" type="button" @click="loadAdminIoTData">Retry</button></p>
          <p v-else-if="iotLoading && !readingsLoaded">Loading readings…</p>
          <p v-else-if="readingsLoaded && !liveReadings.length">No readings received yet.</p>
          <table>
            <thead>
              <tr>
                <th>Sensor</th>
                <th>Device</th>
                <th>Plant</th>
                <th>Temperature</th>
                <th>Humidity</th>
                <th>{{ t('adminModules.columns.soilMoisture') }}</th>
                <th>Rainfall</th>
                <th>Motion</th>
                <th>Status</th>
                <th>{{ t('adminModules.columns.lastReading') }}</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="iotLoading && !devicesLoaded"><td colspan="11">Loading sensors…</td></tr>
              <tr v-else-if="devicesError"><td colspan="11">{{ devicesError }} <button class="table-action" type="button" @click="loadAdminIoTData">Retry</button></td></tr>
              <tr v-else-if="!liveDevices.length"><td colspan="11">No devices registered yet.</td></tr>
              <tr v-else-if="!filteredIoTSensors.length"><td colspan="11">No sensors match these filters.</td></tr>
              <tr v-for="s in filteredIoTSensors" :key="s.id">
                <td>
                  <strong>{{ s.id }}</strong>
                </td>
                <td>{{ dataLabel(s.deviceName) }}</td>
                <td>{{ s.plant }}</td>
                <td>{{ s.temperature }}</td>
                <td>{{ s.humidity }}</td>
                <td>{{ s.soilMoisture }}</td>
                <td>{{ dataLabel(s.rainfall) }}</td>
                <td>{{ dataLabel(s.movement) }}</td>
                <td>
                  <em class="badge" :class="s.status.toLowerCase()">{{ s.status }}</em>
                </td>
                <td>{{ dataLabel(s.lastReading) }}</td>
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
            <p>{{ t('adminModules.iot.recentAlerts') }}</p>
            <h2>Latest Alerts</h2>
          </div>
          <RouterLink class="secondary panel-link" to="/admin/alerts">View All Alerts</RouterLink>
        </div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Alert ID</th>
                <th>Device ID</th>
                <th>Metric</th>
                <th>Value</th>
                <th>Status</th>
                <th>{{ t('adminModules.columns.createdAt') }}</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="iotLoading && !alertsLoaded"><td colspan="7">Loading alerts…</td></tr>
              <tr v-else-if="alertsError"><td colspan="7">{{ alertsError }} <button class="table-action" type="button" @click="loadAdminIoTData">Retry</button></td></tr>
              <tr v-else-if="!liveAlerts.length"><td colspan="7">No threat alerts recorded.</td></tr>
              <tr v-for="alert in recentAlerts" :key="alert.id">
                <td>
                  <strong>{{ alert.id }}</strong>
                </td>
                <td>{{ alert.device_id }}</td>
                <td>{{ dataLabel(alert.metric) }}</td>
                <td>{{ alert.value }}</td>
                <td>
                  <em class="badge" :class="alert.status.toLowerCase()">{{ alert.status }}</em>
                </td>
                <td>{{ formattedTimestamp(alert.created_at) }}</td>
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
            <strong>{{ sensors.length }}</strong
            ><small>{{ t('adminModules.sensors.totalDevices') }}</small>
          </div>
        </article>
        <article>
          <span>✓</span>
          <div>
            <p>Online</p>
            <strong>{{ onlineSensorCount }}</strong
            ><small>{{ t('adminModules.sensors.connectedDevices') }}</small>
          </div>
        </article>
        <article>
          <span>□</span>
          <div>
            <p>Offline</p>
            <strong>{{ offlineSensorCount }}</strong
            ><small>{{ t('adminModules.common.needsAttention') }}</small>
          </div>
        </article>
        <article class="warning">
          <span>⌁</span>
          <div>
            <p>Maintenance</p>
            <strong>{{ maintenanceSensorCount }}</strong
            ><small>{{ t('adminModules.sensors.serviceScheduled') }}</small>
          </div>
        </article>
      </section>
      <section class="panel">
        <div class="panel-head">
          <div>
            <p>{{ t('adminModules.sensors.inventoryEyebrow') }}</p>
            <h2>{{ t('adminModules.sensors.allSensors') }}</h2>
          </div>
          <span>{{ filteredSensors.length }} records</span>
        </div>
        <div class="filters">
          <label
            ><span>⌕</span
            ><input
              v-model="search"
              :placeholder="t('adminModules.sensors.searchPlaceholder')" /></label
          ><select v-model="filter">
            <option>All</option>
            <option>Online</option>
            <option>Offline</option>
            <option>Maintenance</option>
            <option>Inactive</option>
          </select>
        </div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Sensor ID</th>
                <th>Device Name</th>
                <th>Device Type</th>
                <th>{{ t('adminModules.columns.serialNumber') }}</th>
                <th>Location</th>
                <th>Status</th>
                <th>{{ t('adminModules.columns.installedAt') }}</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in filteredSensors" :key="s.id">
                <td>
                  <strong>{{ s.id }}</strong>
                </td>
                <td>{{ dataLabel(s.deviceName) }}</td>
                <td>{{ dataLabel(s.deviceType) }}</td>
                <td>{{ s.serialNumber }}</td>
                <td>{{ s.locationDescription ? dataLabel(s.locationDescription) : '—' }}</td>
                <td>
                  <em class="badge" :class="s.status.toLowerCase()">{{ s.status }}</em>
                </td>
                <td>{{ dataLabel(s.installedAt) }}</td>
                <td>
                  <div class="sensor-actions">
                    <button class="table-action" type="button" @click="openSensorDetails(s)">
                      View
                    </button>
                    <button class="table-action" type="button" @click="openEditSensor(s)">
                      Edit
                    </button>
                    <button
                      class="table-action delete-action"
                      type="button"
                      @click="openDeleteSensor(s)"
                    >
                      Delete
                    </button>
                  </div>
                </td>
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
            <p>{{ t('adminModules.alerts.activeAlerts') }}</p>
            <strong>{{ activeAlertCount }}</strong
            ><small>{{ t('adminModules.alerts.requireReview') }}</small>
          </div>
        </article>
        <article>
          <span>●</span>
          <div>
            <p>{{ t('adminModules.alerts.highSeverity') }}</p>
            <strong>{{ highSeverityAlertCount }}</strong
            ><small>{{ t('adminModules.alerts.immediateAction') }}</small>
          </div>
        </article>
        <article>
          <span>⌕</span>
          <div>
            <p>{{ t('adminModules.alerts.underReview') }}</p>
            <strong>{{ reviewingAlertCount }}</strong
            ><small>{{ t('adminModules.alerts.beingInvestigated') }}</small>
          </div>
        </article>
        <article>
          <span>✓</span>
          <div>
            <p>Resolved</p>
            <strong>{{ resolvedAlertCount }}</strong
            ><small>{{ t('adminModules.alerts.closedAlerts') }}</small>
          </div>
        </article>
      </section>
      <section class="panel">
        <div class="panel-head">
          <div>
            <p>{{ t('adminModules.alerts.registerEyebrow') }}</p>
            <h2>{{ t('adminModules.alerts.allAlerts') }}</h2>
          </div>
          <button class="secondary" type="button">Export Alerts</button>
        </div>
        <div class="filters alert-filters">
          <label
            ><span>⌕</span
            ><input v-model="search" :placeholder="t('adminModules.alerts.searchPlaceholder')"
          /></label>
          <select v-model="alertStatusFilter" :aria-label="t('adminModules.alerts.filterByStatus')">
            <option value="All Statuses">{{ t('common.allStatuses') }}</option>
            <option v-for="item in ['New', 'Reviewing', 'Resolved']" :key="item" :value="item">
              {{ dataLabel(item) }}
            </option>
          </select>
          <select v-model="alertSeverityFilter" aria-label="Filter alerts by severity">
            <option>All Severities</option>
            <option>High</option>
            <option>Medium</option>
            <option>Low</option>
          </select>
        </div>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Alert ID</th>
                <th>Plant ID</th>
                <th>Sensor ID</th>
                <th>Alert Type</th>
                <th>Severity</th>
                <th>Confidence</th>
                <th>Status</th>
                <th>{{ t('adminModules.columns.createdAt') }}</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="alert in filteredAlerts" :key="alert.id">
                <td>
                  <strong>{{ alert.id }}</strong>
                </td>
                <td>{{ alert.plant }}</td>
                <td>{{ alert.sensorId }}</td>
                <td>{{ dataLabel(alert.type) }}</td>
                <td>
                  <em class="badge" :class="alert.severity.toLowerCase()">{{ alert.severity }}</em>
                </td>
                <td>{{ alert.confidence }}</td>
                <td>
                  <em class="badge" :class="alert.status.toLowerCase()">{{ alert.status }}</em>
                </td>
                <td>{{ dataLabel(alert.createdAt) }}</td>
                <td>
                  <button class="table-action" type="button" @click="openAlertDetails(alert)">
                    View
                  </button>
                </td>
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
            <p>{{ t('adminModules.activity.eventsToday') }}</p>
            <strong>42</strong><small>{{ t('adminModules.activity.allModules') }}</small>
          </div>
        </article>
        <article>
          <span>♙</span>
          <div>
            <p>{{ t('adminModules.activity.userActions') }}</p>
            <strong>18</strong><small>{{ t('adminModules.activity.administrativeEvents') }}</small>
          </div>
        </article>
        <article class="warning">
          <span>!</span>
          <div>
            <p>{{ t('adminModules.activity.warnings') }}</p>
            <strong>3</strong><small>{{ t('adminModules.activity.systemGenerated') }}</small>
          </div>
        </article>
        <article>
          <span>✓</span>
          <div>
            <p>{{ t('adminModules.activity.securityEvents') }}</p>
            <strong>1</strong><small>{{ t('adminModules.activity.noCriticalIncidents') }}</small>
          </div>
        </article>
      </section>
      <section class="panel">
        <div class="panel-head">
          <div>
            <p>{{ t('adminModules.activity.auditEyebrow') }}</p>
            <h2>{{ t('adminModules.activity.recentActivity') }}</h2>
          </div>
          <span>{{ filteredLogs.length }} events shown</span>
        </div>
        <div class="filters">
          <label
            ><span>⌕</span
            ><input
              v-model="search"
              :placeholder="t('adminModules.activity.searchPlaceholder')" /></label
          ><select v-model="filter">
            <option value="All">{{ t('common.all') }}</option>
            <option v-for="item in ['Info', 'Security', 'Warning']" :key="item" :value="item">
              {{ dataLabel(item) }}
            </option>
          </select>
        </div>
        <div class="activity-list">
          <article v-for="log in filteredLogs" :key="log.id">
            <span class="event-icon" :class="log.type.toLowerCase()">{{
              log.type === 'Warning' ? '!' : log.type === 'Security' ? '◇' : '↻'
            }}</span>
            <div class="event-main">
              <strong
                >{{ dataLabel(log.action)
                }}{{ log.target ? ` — ${dataLabel(log.target)}` : '' }}</strong
              >
              <p>
                <b>{{ dataLabel(log.actor) }}</b> · {{ dataLabel(log.module) }} ·
                {{ log.ipAddress }}
              </p>
            </div>
            <time :datetime="log.timestamp">{{ formatActivityTimestamp(log.timestamp) }}</time
            ><em class="badge" :class="log.type.toLowerCase()">{{ dataLabel(log.type) }}</em>
          </article>
        </div>
      </section>
    </template>

    <div
      v-if="exportModalOpen"
      class="sensor-modal-backdrop"
      @click.self="closeExportModal"
      @keydown.esc="closeExportModal"
    >
      <section
        ref="exportDialog"
        class="sensor-modal export-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-activity-title"
        tabindex="-1"
      >
        <header class="sensor-modal-head">
          <div>
            <p>{{ t('adminModules.export.eyebrow') }}</p>
            <h2 id="export-activity-title">{{ t('adminModules.export.title') }}</h2>
          </div>
          <button
            type="button"
            :aria-label="t('adminModules.export.closeDialog')"
            @click="closeExportModal"
          >
            ×
          </button>
        </header>

        <form class="export-form" @submit.prevent="exportActivity">
          <fieldset>
            <legend>{{ t('adminModules.export.dateRange') }}</legend>
            <div class="export-date-grid">
              <label
                ><span>{{ t('adminModules.export.fromDate') }}</span
                ><input v-model="exportFromDate" type="date"
              /></label>
              <label
                ><span>{{ t('adminModules.export.toDate') }}</span
                ><input v-model="exportToDate" type="date"
              /></label>
            </div>
          </fieldset>

          <div class="export-select-grid">
            <label>
              <span>{{ t('adminModules.export.activityType') }}</span>
              <select v-model="exportType">
                <option value="All">{{ t('common.all') }}</option>
                <option
                  v-for="item in ['Info', 'Security', 'Warning', 'Error']"
                  :key="item"
                  :value="item"
                >
                  {{ dataLabel(item) }}
                </option>
              </select>
            </label>
            <label>
              <span>{{ t('adminModules.export.module') }}</span>
              <select v-model="exportModule">
                <option value="All Modules">{{ t('adminModules.activity.allModules') }}</option>
                <option
                  v-for="item in [
                    'User Management',
                    'Role & Permission',
                    'IoT Monitoring',
                    'Sensor Management',
                    'Threat Alerts',
                    'System Activity',
                  ]"
                  :key="item"
                  :value="item"
                >
                  {{ dataLabel(item) }}
                </option>
              </select>
            </label>
          </div>

          <fieldset>
            <legend>{{ t('adminModules.export.scope') }}</legend>
            <div class="export-options">
              <label>
                <input v-model="exportScope" type="radio" value="filtered" />
                <span
                  ><b>{{ t('adminModules.export.filteredResults') }}</b
                  ><small>{{ t('adminModules.export.filteredDescription') }}</small></span
                >
              </label>
              <label>
                <input v-model="exportScope" type="radio" value="all" />
                <span
                  ><b>{{ t('adminModules.export.allRecords') }}</b
                  ><small>{{ t('adminModules.export.allDescription') }}</small></span
                >
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend>{{ t('adminModules.export.fileFormat') }}</legend>
            <div class="export-format-options">
              <label><input v-model="exportFormat" type="radio" value="csv" /> CSV</label>
              <label><input v-model="exportFormat" type="radio" value="pdf" /> PDF</label>
            </div>
          </fieldset>

          <p v-if="exportValidationMessage" class="form-error" role="alert">
            {{ exportValidationMessage }}
          </p>

          <div class="sensor-modal-actions modal-button-group">
            <button class="secondary" type="button" @click="closeExportModal">
              {{ t('common.cancel') }}
            </button>
            <button class="primary" type="submit">{{ t('adminModules.export.submit') }}</button>
          </div>
        </form>
      </section>
    </div>

    <div
      v-if="alertModal === 'view' && selectedAlert"
      class="sensor-modal-backdrop"
      @click.self="closeAlertModal"
    >
      <section
        class="sensor-modal alert-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="alert-details-title"
      >
        <header class="sensor-modal-head">
          <div>
            <p>THREAT ALERT</p>
            <h2 id="alert-details-title">{{ selectedAlert.type }}</h2>
          </div>
          <button type="button" aria-label="Close alert details" @click="closeAlertModal">×</button>
        </header>

        <div class="detail-section">
          <h3>ALERT DETAILS</h3>
          <dl>
            <div>
              <dt>Alert ID</dt>
              <dd>{{ selectedAlert.id }}</dd>
            </div>
            <div>
              <dt>Alert Type</dt>
              <dd>{{ selectedAlert.type }}</dd>
            </div>
            <div>
              <dt>Severity</dt>
              <dd>
                <em class="badge" :class="selectedAlert.severity.toLowerCase()">{{
                  selectedAlert.severity
                }}</em>
              </dd>
            </div>
            <div>
              <dt>Confidence</dt>
              <dd>{{ selectedAlert.confidence }}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <em class="badge" :class="selectedAlert.status.toLowerCase()">{{
                  selectedAlert.status
                }}</em>
              </dd>
            </div>
            <div>
              <dt>Created At</dt>
              <dd>{{ selectedAlert.createdAt }}</dd>
            </div>
          </dl>
        </div>

        <div class="detail-section">
          <h3>RELATED RECORD</h3>
          <dl>
            <div>
              <dt>Plant ID</dt>
              <dd>{{ selectedAlert.plant }}</dd>
            </div>
            <div>
              <dt>Reading ID</dt>
              <dd>{{ selectedAlert.readingId }}</dd>
            </div>
            <div>
              <dt>Sensor ID</dt>
              <dd>{{ selectedAlert.sensorId }}</dd>
            </div>
            <div>
              <dt>Device Name</dt>
              <dd>{{ selectedAlertSensor?.deviceName || 'Unavailable' }}</dd>
            </div>
            <div>
              <dt>Device Type</dt>
              <dd>{{ selectedAlertSensor?.deviceType || 'Unavailable' }}</dd>
            </div>
          </dl>
        </div>

        <div class="detail-section">
          <h3>TRIGGERING SENSOR READING</h3>
          <dl>
            <div>
              <dt>Temperature</dt>
              <dd>{{ selectedAlert.temperature || '—' }}</dd>
            </div>
            <div>
              <dt>Humidity</dt>
              <dd>{{ selectedAlert.humidity || '—' }}</dd>
            </div>
            <div>
              <dt>Soil Moisture</dt>
              <dd>{{ selectedAlert.soilMoisture || '—' }}</dd>
            </div>
            <div>
              <dt>Rainfall Detected</dt>
              <dd>{{ selectedAlert.rainfall || '—' }}</dd>
            </div>
            <div>
              <dt>Motion Detected</dt>
              <dd>{{ selectedAlert.movement || '—' }}</dd>
            </div>
            <div>
              <dt>Recorded At</dt>
              <dd>{{ selectedAlert.recordedAt || '—' }}</dd>
            </div>
          </dl>
        </div>

        <div class="detail-section">
          <h3>LOCATION</h3>
          <dl>
            <div class="detail-wide">
              <dt>Sensor Location Description</dt>
              <dd>{{ selectedAlert.sensorLocation || '—' }}</dd>
            </div>
            <div>
              <dt>Reading GPS</dt>
              <dd>
                {{
                  selectedAlert.gpsLatitude && selectedAlert.gpsLongitude
                    ? `${selectedAlert.gpsLatitude}, ${selectedAlert.gpsLongitude}`
                    : '—'
                }}
              </dd>
            </div>
            <div>
              <dt>Registered Plant GPS</dt>
              <dd>
                {{
                  selectedAlert.plantLatitude && selectedAlert.plantLongitude
                    ? `${selectedAlert.plantLatitude}, ${selectedAlert.plantLongitude}`
                    : '—'
                }}
              </dd>
            </div>
            <div>
              <dt>Accuracy</dt>
              <dd>{{ selectedAlert.plantAccuracy || '—' }}</dd>
            </div>
          </dl>
        </div>

        <div class="detail-section">
          <h3>DESCRIPTION</h3>
          <p class="alert-description">{{ selectedAlert.description }}</p>
        </div>

        <div class="detail-section">
          <h3>EVIDENCE IMAGE</h3>
          <img
            v-if="selectedAlert.imagePath"
            class="alert-evidence"
            :src="selectedAlert.imagePath"
            alt="Threat alert evidence"
          />
          <p v-else class="empty-evidence">No image evidence available.</p>
        </div>

        <div v-if="selectedAlert.status === 'Resolved'" class="detail-section">
          <h3>RESOLUTION</h3>
          <dl>
            <div>
              <dt>Resolved By</dt>
              <dd>{{ selectedAlert.resolvedBy }}</dd>
            </div>
            <div>
              <dt>Resolved At</dt>
              <dd>{{ selectedAlert.resolvedAt }}</dd>
            </div>
          </dl>
        </div>

        <div class="sensor-modal-actions alert-modal-actions">
          <button class="secondary" type="button" @click="closeAlertModal">Close</button>
          <button
            v-if="selectedAlert.status === 'New'"
            class="secondary"
            type="button"
            @click="markAlertReviewing"
          >
            Mark as Reviewing
          </button>
          <button
            v-if="selectedAlert.status !== 'Resolved'"
            class="primary"
            type="button"
            @click="openResolveConfirmation"
          >
            Resolve Alert
          </button>
        </div>
      </section>
    </div>

    <div
      v-if="alertModal === 'resolve' && selectedAlert"
      class="sensor-modal-backdrop"
      @click.self="cancelResolveAlert"
    >
      <section
        class="sensor-modal delete-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="resolve-alert-title"
      >
        <header class="sensor-modal-head">
          <div>
            <p>CONFIRM RESOLUTION</p>
            <h2 id="resolve-alert-title">Resolve Threat Alert</h2>
          </div>
          <button type="button" aria-label="Close resolve confirmation" @click="cancelResolveAlert">
            ×
          </button>
        </header>
        <div class="delete-confirmation resolve-confirmation">
          <span class="resolution-icon">✓</span>
          <p>
            <strong>Alert {{ selectedAlert.id }}</strong
            ><br />{{ selectedAlert.type }}<br />Plant {{ selectedAlert.plant }}
          </p>
          <small>Are you sure this threat has been investigated and resolved?</small>
          <div class="sensor-modal-actions modal-button-group">
            <button class="secondary" type="button" @click="cancelResolveAlert">Cancel</button>
            <button class="primary" type="button" @click="confirmResolveAlert">
              Resolve Alert
            </button>
          </div>
        </div>
      </section>
    </div>

    <ActionFeedback
      v-if="feedback"
      :key="feedback.id"
      :feedback-id="feedback.id"
      :variant="feedback.variant"
      :message="feedback.message"
      @dismiss="dismissFeedback"
    />

    <div
      v-if="sensorModal === 'view' && selectedSensor"
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
        <div v-if="selectedSensor.readingId !== '—'" class="detail-section">
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
        <div v-if="selectedSensor.readingId !== '—'" class="detail-section">
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
        <div v-else class="detail-section">
          <h3>LATEST READING</h3>
          <p class="empty-evidence">No sensor readings available yet.</p>
        </div>
        <div class="sensor-modal-actions">
          <button class="primary" type="button" @click="closeSensorDetails">Close</button>
        </div>
      </section>
    </div>

    <div
      v-if="sensorModal === 'register' || sensorModal === 'edit'"
      class="sensor-modal-backdrop"
      @click.self="closeSensorDetails"
    >
      <section
        class="sensor-modal sensor-form-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sensor-form-title"
      >
        <header class="sensor-modal-head">
          <div>
            <p>{{ sensorModal === 'register' ? 'NEW DEVICE' : 'DEVICE SETTINGS' }}</p>
            <h2 id="sensor-form-title">
              {{ sensorModal === 'register' ? 'Register Sensor' : 'Edit Sensor' }}
            </h2>
          </div>
          <button type="button" aria-label="Close sensor form" @click="closeSensorDetails">
            ×
          </button>
        </header>
        <form class="sensor-form" @submit.prevent="saveSensor(sensorModal === 'edit')">
          <div class="sensor-form-grid">
            <label>Sensor ID<input v-model="sensorForm.id" type="text" readonly /></label>
            <label>Device Name<input v-model="sensorForm.deviceName" type="text" /></label>
            <label
              >Device Type<select v-model="sensorForm.deviceType">
                <option value="" disabled>Select device type</option>
                <option>Environment</option>
                <option>Motion</option>
                <option>Temperature</option>
                <option>Humidity</option>
                <option>Soil Moisture</option>
                <option>Rainfall</option>
                <option>GPS</option>
                <option>Multi-Sensor</option>
              </select></label
            >
            <label>Serial Number<input v-model="sensorForm.serialNumber" type="text" /></label>
            <label
              >Status<select v-model="sensorForm.status">
                <option>Online</option>
                <option>Offline</option>
                <option>Maintenance</option>
                <option>Inactive</option>
              </select></label
            >
            <label>Installed At<input v-model="sensorForm.installedAt" type="date" /></label>
            <label class="form-wide"
              >Location Description<input v-model="sensorForm.locationDescription" type="text"
            /></label>
          </div>
          <p v-if="sensorFormError" class="form-error">{{ sensorFormError }}</p>
          <div class="sensor-modal-actions modal-button-group">
            <button class="secondary" type="button" @click="closeSensorDetails">Cancel</button>
            <button class="primary" type="submit">
              {{ sensorModal === 'register' ? 'Register Sensor' : 'Save Changes' }}
            </button>
          </div>
        </form>
      </section>
    </div>

    <div
      v-if="sensorModal === 'delete' && selectedSensor"
      class="sensor-modal-backdrop"
      @click.self="closeSensorDetails"
    >
      <section
        class="sensor-modal delete-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-sensor-title"
      >
        <header class="sensor-modal-head">
          <div>
            <p>CONFIRM REMOVAL</p>
            <h2 id="delete-sensor-title">Delete Sensor</h2>
          </div>
          <button type="button" aria-label="Close delete confirmation" @click="closeSensorDetails">
            ×
          </button>
        </header>
        <div class="delete-confirmation">
          <span class="warning-icon">!</span>
          <p>
            Delete <strong>{{ selectedSensor.deviceName }}</strong> ({{ selectedSensor.id }})?
          </p>
          <small
            >This will remove the sensor from the prototype device directory. This action cannot be
            undone.</small
          >
          <div class="sensor-modal-actions modal-button-group">
            <button class="secondary" type="button" @click="closeSensorDetails">Cancel</button>
            <button class="danger-button" type="button" @click="confirmDeleteSensor">
              Delete Sensor
            </button>
          </div>
        </div>
      </section>
    </div>
</template>  </AdminPageShell>
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
  grid-template-columns: repeat(2, 1fr);
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
.system-role-label {
  width: fit-content;
  padding: 5px 8px;
  display: inline-block;
  border-radius: 999px;
  background: #edf3ee;
  color: #5e786d;
  font-size: 9px;
  font-weight: 700;
}
.read-only-note {
  margin: 14px 0 0;
  padding: 10px 12px;
  border: 1px solid #c7ddd2;
  border-left: 3px solid #5f9f82;
  border-radius: 7px;
  background: #dfeee6;
  color: #405f52;
  font-size: 9px;
  line-height: 1.5;
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
.filters.alert-filters {
  grid-template-columns: minmax(240px, 1fr) 160px 160px;
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
  .filters.alert-filters {
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
.sensor-actions {
  display: flex;
  gap: 6px;
}
.sensor-actions .delete-action {
  color: #a64b40;
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
.alert-modal-actions {
  flex-wrap: wrap;
  gap: 8px;
}
.alert-description,
.empty-evidence {
  margin: 0;
  color: #617169;
  font-size: 10px;
  line-height: 1.6;
}
.empty-evidence {
  color: #87958f;
  font-style: italic;
}
.alert-evidence {
  width: 100%;
  max-height: 280px;
  border-radius: 8px;
  object-fit: cover;
}
.resolution-icon {
  width: 48px;
  height: 48px;
  margin: 0 auto;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #dff1e6;
  color: #287a53;
  font-size: 22px;
  font-weight: 800;
}
.sensor-form {
  display: grid;
  gap: 14px;
}
.sensor-form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px 12px;
}
.sensor-form label {
  display: grid;
  gap: 6px;
  color: #4a645a;
  font-size: 10px;
  font-weight: 700;
}
.sensor-form input,
.sensor-form select {
  width: 100%;
  padding: 10px 11px;
  border: 1px solid #dce4dc;
  border-radius: 8px;
  outline: 0;
  background: #fafcfa;
  color: #355448;
  font: inherit;
  font-size: 10px;
}
.sensor-form input:focus,
.sensor-form select:focus {
  border-color: #62a087;
  box-shadow: 0 0 0 3px rgba(98, 160, 135, 0.12);
}
.sensor-form input[readonly] {
  background: #eef2ee;
  color: #708078;
}
.export-modal {
  width: min(620px, 100%);
  outline: 0;
}
.export-form {
  display: grid;
  gap: 16px;
}
.export-form fieldset {
  min-width: 0;
  margin: 0;
  padding: 14px;
  border: 1px solid #e2e9e2;
  border-radius: 10px;
}
.export-form legend {
  padding: 0 6px;
  color: #4d7a68;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 1px;
  text-transform: uppercase;
}
.export-date-grid,
.export-select-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.export-form label {
  color: #4a645a;
  font-size: 10px;
  font-weight: 700;
}
.export-date-grid label,
.export-select-grid > label {
  display: grid;
  gap: 6px;
}
.export-form input[type='date'],
.export-form select {
  width: 100%;
  min-height: 39px;
  padding: 9px 10px;
  border: 1px solid #dce4dc;
  border-radius: 8px;
  outline: 0;
  background: #fafcfa;
  color: #355448;
  font: inherit;
  font-size: 10px;
}
.export-form input[type='date']:focus,
.export-form select:focus {
  border-color: #62a087;
  box-shadow: 0 0 0 3px rgba(98, 160, 135, 0.12);
}
.export-options {
  display: grid;
  gap: 9px;
}
.export-options label {
  padding: 11px;
  display: flex;
  align-items: flex-start;
  gap: 9px;
  border: 1px solid #e4e9e4;
  border-radius: 8px;
  background: #fafcfa;
  cursor: pointer;
}
.export-options input,
.export-format-options input {
  accent-color: #32745b;
}
.export-options span {
  display: grid;
  gap: 3px;
}
.export-options b {
  color: #355448;
  font-size: 10px;
}
.export-options small {
  color: #83918b;
  font-size: 9px;
  font-weight: 400;
  line-height: 1.45;
}
.export-format-options {
  display: flex;
  gap: 24px;
}
.export-format-options label {
  display: flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
}
.form-wide {
  grid-column: 1 / -1;
}
.form-error {
  margin: 0;
  color: #b84b3a;
  font-size: 10px;
  font-weight: 700;
}
.modal-button-group {
  gap: 8px;
}
.danger-button {
  padding: 10px 15px;
  border: 0;
  border-radius: 8px;
  background: #b84b3a;
  color: #fff;
  cursor: pointer;
  font: inherit;
  font-size: 10px;
  font-weight: 700;
}
.delete-confirmation {
  display: grid;
  gap: 16px;
  text-align: center;
}
.delete-confirmation p {
  margin: 0;
  color: #405e53;
  font-size: 13px;
}
.delete-confirmation small {
  color: #7a8b84;
  font-size: 10px;
  line-height: 1.6;
}
.warning-icon {
  width: 48px;
  height: 48px;
  margin: 0 auto;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #f8e1dd;
  color: #b84b3a;
  font-size: 22px;
  font-weight: 800;
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
  .detail-section dl,
  .sensor-form-grid,
  .export-date-grid,
  .export-select-grid {
    grid-template-columns: 1fr;
  }
  .sensor-modal-backdrop {
    padding: 12px;
  }
  .export-modal {
    max-height: calc(100dvh - 24px);
  }
  .export-form {
    gap: 13px;
  }
  .export-form fieldset {
    padding: 12px;
  }
  .export-modal .sensor-modal-actions button {
    min-height: 40px;
    padding-inline: 18px;
  }
  .detail-section .detail-wide {
    grid-column: auto;
  }
  .form-wide {
    grid-column: auto;
  }
}
</style>
