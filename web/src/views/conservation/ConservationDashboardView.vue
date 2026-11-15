<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import MonitoringIdentifier from '../../components/conservation/MonitoringIdentifier.vue'
import { monitoringLabels, monitoringDate } from '../../utils/officerMonitoringDisplay'
import { sessionSnapshot, subscribeSession } from '../../services/auth'
import BiodiversityMapPreview from '../../components/conservation/BiodiversityMapPreview.vue'
import { reviewEligible, reviewTransitions, positiveRevision } from '../../services/observationReview'
import { mapLinkedSpeciesRequest, speciesRequestCanDecide } from '../../services/reviewSpeciesRequest'
import { observationOrigin } from '../../services/observationQueue'
import { formatObservationId } from '../../utils/observationId'
import { formatPlantId } from '../../utils/plantId'

interface ApiObservation extends Record<string, unknown> {
  origin_type?: unknown
  id: string | number
  plant_id: string | number
  owner_subject?: string | null
  status?: string | null
  scientific_name?: string | null
  common_name?: string | null
}

interface ApiPlant {
  plant_id: string | number
  species_id: string | number
  registered_subject?: string | null
  rbac_status?: string | null
  registered_at?: string | null
  latitude?: string | number | null
  longitude?: string | number | null
  observed_at?: string | null
}

interface ApiSpecies {
  species_id: string | number
  scientific_name?: string | null
  common_name?: string | null
  conservation_status?: string | null
}

interface ApiAlert {
  alert_id: string | number
  plant_id: string | number
  alert_type: string
  severity: string
  status: string
  created_at: string
}

const router = useRouter()
const { t, te, locale } = useI18n()
const today = new Date()
const dateLocale = computed(() => locale.value === 'ms' ? 'ms-MY' : locale.value.startsWith('en') ? 'en-GB' : locale.value)
const currentDate = computed(() =>
  new Intl.DateTimeFormat(dateLocale.value, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(today),
)
const currentDateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
const dt = (value?: string | null) => monitoringDate(value, locale.value)

const go = (name: string, query?: Record<string, string>) => router.push({ name, query })

const session = ref(sessionSnapshot())
const unsubscribeSession = subscribeSession((user, pending) => { session.value = { user, pending } })
onBeforeUnmount(unsubscribeSession)
const authorizedOfficer = computed(() => !session.value.pending && session.value.user?.role === 'Conservation Officer' && session.value.user.status === 'Active' && session.value.user.mustChangePassword === false)
const observations = ref<ApiObservation[]>([])
const plants = ref<ApiPlant[]>([])
const species = ref<ApiSpecies[]>([])
const alerts = ref<ApiAlert[]>([])
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
const observationDisplayLabels = computed(() => new Map([...monitoringLabels(observations.value.map(item => item.id))].map(([raw, label]) => [raw, formatObservationId(raw) || (uuid.test(raw) ? `OBS-${label.replace(/\u2026$/, '')}` : label)])))
const subjectLabels = computed(() => {
  const subjects = [...new Set([...observations.value.map(item => item.owner_subject), ...plants.value.map(item => item.registered_subject)].filter((value): value is string => typeof value === 'string' && !!value))]
  const part = (value: string) => /^(staff|visitor):/.test(value) ? value.slice(value.indexOf(':') + 1) : value
  const tokens = monitoringLabels(subjects.map(part))
  return new Map(subjects.map(subject => {
    const account = session.value.user
    if (authorizedOfficer.value && account && subject === `staff:${account.id}` && account.name?.trim()) return [subject, account.name.trim()]
    const raw = part(subject), token = tokens.get(raw) || raw
    const id = uuid.test(raw) ? token.replace(/\u2026$/, '') : token
    const key = subject.startsWith('staff:') ? 'staffIdentifier' : subject.startsWith('visitor:') ? 'visitorIdentifier' : 'submitterIdentifier'
    return [subject, t('conservationPages.observations.' + key, { id })]
  }))
})
const observationsLoading = ref(true)
const plantsLoading = ref(true)
const speciesLoading = ref(true)
const alertsLoading = ref(true)
const observationsError = ref('')
const plantsError = ref('')
const speciesError = ref('')
const alertsError = ref('')

const loadJson = async <T,>(url: string, collection: string): Promise<T[]> => {
  let response: Response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15000) })
  } catch {
    throw new Error('Dashboard data unavailable. Please try again later.')
  }
  let result: Record<string, unknown>
  try {
    const body: unknown = await response.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error()
    result = body as Record<string, unknown>
  } catch {
    throw new Error('Dashboard data unavailable: invalid server response.')
  }
  if (!response.ok) {
    const message = [result.message, result.error].find(
      (value): value is string => typeof value === 'string' && Boolean(value.trim()),
    )
    throw new Error(message || 'Dashboard data unavailable. Please try again later.')
  }
  if (
    !Array.isArray(result[collection]) ||
    result[collection].some((item) => !item || typeof item !== 'object' || Array.isArray(item))
  )
    throw new Error('Dashboard data unavailable: invalid server response.')
  return result[collection] as T[]
}

const loadObservations = async () => {
  observationsLoading.value = true
  observationsError.value = ''
  try {
    observations.value = await loadJson<ApiObservation>('/api/observations', 'observations')
  } catch (error) {
    observations.value = []
    observationsError.value = error instanceof Error ? error.message : 'Observations unavailable.'
  } finally {
    observationsLoading.value = false
  }
}
const loadPlants = async () => {
  plantsLoading.value = true
  plantsError.value = ''
  try {
    plants.value = await loadJson<ApiPlant>('/api/plants', 'plants')
  } catch (error) {
    plants.value = []
    plantsError.value = error instanceof Error ? error.message : 'Plant records unavailable.'
  } finally {
    plantsLoading.value = false
  }
}
const loadSpecies = async () => {
  speciesLoading.value = true
  speciesError.value = ''
  try {
    species.value = await loadJson<ApiSpecies>('/api/species?scope=scientific', 'species')
  } catch (error) {
    species.value = []
    speciesError.value = error instanceof Error ? error.message : 'Species data unavailable.'
  } finally {
    speciesLoading.value = false
  }
}
const loadAlerts = async () => {
  alertsLoading.value = true
  alertsError.value = ''
  try {
    alerts.value = await loadJson<ApiAlert>('/api/iot/alerts', 'alerts')
  } catch (error) {
    alerts.value = []
    alertsError.value = error instanceof Error ? error.message : 'Threat alerts unavailable.'
  } finally {
    alertsLoading.value = false
  }
}

onMounted(() => {
  void Promise.allSettled([loadObservations(), loadPlants(), loadSpecies(), loadAlerts()])
})

const effectiveObservationStatus = (observation: ApiObservation) =>
  typeof observation.status === 'string' ? observation.status.trim() : ''
// Preserve the existing review-required grouping, including correction/flagged records.
const requiresReview = (observation: ApiObservation) => {
  const status = effectiveObservationStatus(observation).toLowerCase().replace(/[_-]+/g, ' ')
  return ['pending', 'pending review', 'correction required', 'flagged'].includes(status)
}
const pending = computed(() => observations.value.filter(requiresReview).slice(0, 4))
// Reuse the server's provenance classification; never infer origin from plant/status.
// Conflicting duplicate identities cannot safely belong to either preview.
const previewReviewEligible = (row: ApiObservation) => {
  if (!authorizedOfficer.value || observationsLoading.value || observationsError.value) return false
  const status = effectiveObservationStatus(row)
  if (!reviewTransitions[status]?.length || !positiveRevision(row.revision)) return false
  const id = String(row.id)
  if (!/^(?:[1-9][0-9]{0,18}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(id) || !formatPlantId(row.plant_id)) return false
  if (typeof row.owner_subject !== 'string' || !row.owner_subject.trim()) return false
  if (row.species_id == null || !row.scientific_name?.trim()) return false
  const request = mapLinkedSpeciesRequest(row)
  const plantReview = reviewEligible(session.value.user, session.value.pending, {
    revision: row.revision, owner: row.owner_subject, status,
    speciesId: row.species_id == null ? '' : String(row.species_id),
    scientificName: row.scientific_name || '', speciesRequest: request,
  })
  // The existing registration review also permits resolving its linked species
  // request first. Do not hide that actionable path behind the plant's gate.
  const speciesReview = observationOrigin(row.origin_type) === 'initial_registration' && speciesRequestCanDecide(request) && Boolean(request?.requestedBy) &&
    request?.requestedBy !== `staff:${session.value.user?.id}`
  return plantReview || speciesReview
}
const classifiedPending = computed(() => {
  const byId = new Map<string, ApiObservation[]>()
  for (const row of observations.value) {
    const id = String(row.id)
    byId.set(id, [...(byId.get(id) || []), row])
  }
  return [...byId.values()].flatMap(rows => new Set(rows.map(row => observationOrigin(row.origin_type))).size === 1 ? [rows[0]!] : []).filter(previewReviewEligible)
})
const pendingRegistrations = computed(() => classifiedPending.value.filter(row => observationOrigin(row.origin_type) === 'initial_registration').slice(0, 4))
const pendingFieldObservations = computed(() => classifiedPending.value.filter(row => observationOrigin(row.origin_type) === 'subsequent_observation').slice(0, 4))

const timestamp = (value?: string | null) => {
  const parsed = value ? Date.parse(value) : NaN
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY
}
// Most recently registered among the loaded records; missing dates sort last.
const recentPlants = computed(() =>
  [...plants.value]
    .sort((a, b) => timestamp(b.registered_at) - timestamp(a.registered_at))
    .slice(0, 4),
)
const speciesById = computed(
  () => new Map(species.value.map((item) => [String(item.species_id), item])),
)
const speciesForPlant = (plant: ApiPlant) => speciesById.value.get(String(plant.species_id))
const recentAlerts = computed(() =>
  [...alerts.value]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 3),
)
const mapPlants = computed(() =>
  plants.value.flatMap((plant) => {
    // This overview represents approved biodiversity records, not the review queue.
    if (normalizeStatus(plant.rbac_status) !== 'approved') return []
    const id = formatPlantId(plant.plant_id)
    if (
      plant.latitude === null ||
      plant.latitude === undefined ||
      plant.longitude === null ||
      plant.longitude === undefined ||
      String(plant.latitude).trim() === '' ||
      String(plant.longitude).trim() === ''
    )
      return []
    const latitude = Number(plant.latitude)
    const longitude = Number(plant.longitude)
    if (
      !id ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    )
      return []
    return [
      {
        id,
        latitude,
        longitude,
        scientificName: speciesForPlant(plant)?.scientific_name || '',
        commonName: speciesForPlant(plant)?.common_name || '',
      },
    ]
  }),
)

const normalizeStatus = (value?: string | null) =>
  (typeof value === 'string' ? value : '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
const endangeredSpeciesCount = computed(
  () =>
    species.value.filter((item) => normalizeStatus(item.conservation_status).includes('endangered'))
      .length,
)
const activeAlertCount = computed(
  () => alerts.value.filter((alert) => normalizeStatus(alert.status) !== 'resolved').length,
)
const summaries = computed(() => [
  [
    'plantSpecies',
    speciesLoading.value ? '—' : speciesError.value ? '—' : species.value.length,
    'digitalKnowledgeBase',
  ],
  [
    'plantRecords',
    plantsLoading.value ? '—' : plantsError.value ? '—' : plants.value.length,
    'registeredPlants',
  ],
  [
    'pendingReviews',
    observationsLoading.value
      ? '—'
      : observationsError.value
        ? '—'
        : observations.value.filter(requiresReview).length,
    'requiresVerification',
  ],
  [
    'endangeredSpecies',
    speciesLoading.value ? '—' : speciesError.value ? '—' : endangeredSpeciesCount.value,
    'underMonitoring',
  ],
  [
    'activeThreats',
    alertsLoading.value ? '—' : alertsError.value ? '—' : activeAlertCount.value,
    'needsAttention',
  ],
  [
    'recentObservations',
    observationsLoading.value ? '—' : observationsError.value ? '—' : observations.value.length,
    'currentDataset',
  ],
])

// Overview presentation order only; the existing summaries/count sources stay intact.
const summaryOrder = ['pendingReviews', 'activeThreats', 'endangeredSpecies', 'plantRecords', 'plantSpecies', 'recentObservations']
const orderedSummaries = computed(() => summaryOrder.map(key => summaries.value.find(card => card[0] === key)!))
const statusShare = (status: string) => species.value.length ? statusCount(status) / species.value.length * 100 : 0

const biodiversityStatuses = [
  'Not Assessed',
  'Least Concern',
  'Near Threatened',
  'Vulnerable',
  'Endangered',
  'Critically Endangered',
]
const statusCount = (status: string) =>
  species.value.filter(
    (item) => normalizeStatus(item.conservation_status) === normalizeStatus(status),
  ).length
const dataLabel = (value: string) => {
  const key = `dashboardValues.${value.toLowerCase().replace(/[^a-z0-9]+/g, '')}`
  return te(key) ? t(key) : value
}
const valueOrDash = (value: string | number | null | undefined) =>
  value === null || value === undefined || value === '' ? '—' : String(value)
// Numeric legacy IDs retain their presentation; current UUIDs stay intact, including in links.
const observationId = (item: ApiObservation) => formatObservationId(item.id) || String(item.id)
const statusClass = (status?: string | null) => normalizeStatus(status).replaceAll(' ', '-')
const plantId = (value: string | number) => formatPlantId(value) || '—'
const alertId = (value: string | number) => {
  const numeric = Number(value)
  return Number.isSafeInteger(numeric) && numeric > 0
    ? `ALT${String(numeric).padStart(3, '0')}`
    : String(value)
}
const speciesName = (item?: { scientific_name?: string | null; common_name?: string | null }) =>
  item?.scientific_name || item?.common_name || t('conservationDashboard.speciesUnavailable')
</script>

<template>
  <div class="dashboard-overview">
  <section class="page-intro">
    <div>
      <p class="page-kicker">{{ t('conservationDashboard.overview') }}</p>
      <h2>{{ t('conservationDashboard.greeting') }}</h2>
    </div>
    <time :datetime="currentDateKey">{{ currentDate }}</time>
  </section>

  <section class="summary-grid">
    <article v-for="card in orderedSummaries" :key="String(card[0])" class="summary-card" :data-metric="String(card[0])">
      <p>{{ t(`conservationDashboard.summary.${card[0]}`) }}</p>
      <strong>{{ card[1] }}</strong>
    </article>
  </section>
  <p class="statistics-scope">{{ t('conservationDashboard.countScope') }}</p>

  <section class="panel pending-review-panel">
      <header class="panel-header">
        <div>
          <p class="section-kicker">{{ t('conservationDashboard.requiresReview') }}</p>
          <h2>{{ t('conservationDashboard.pendingPlantRegistrations') }}</h2>
        </div>
        <button class="secondary-button" @click="go('conservation-reviews')">
          {{ t('conservationDashboard.viewAllSubmissions') }} →
        </button>
      </header>
      <p v-if="observationsLoading" class="dashboard-state">{{ t('conservationDashboard.loadingObservations') }}</p>
      <p v-else-if="observationsError" class="dashboard-state error-state">
        {{ observationsError }}
      </p>
      <p v-else-if="!pendingRegistrations.length" class="dashboard-state">
        {{ t('conservationDashboard.noPendingRegistrations') }}
      </p>
      <div v-else class="table-scroll officer-table-scroll overview-table-scroll" role="region" :aria-label="t('conservationDashboard.pendingPlantRegistrations')" tabindex="0">
        <table class="officer-data-table pending-review-table"><colgroup><col class="overview-plant"/><col class="overview-species"/><col class="overview-subject"/><col class="overview-status"/><col class="overview-actions"/></colgroup>
          <thead>
            <tr>
              <th scope="col">{{ t('conservationDashboard.table.plantId') }}</th>
              <th scope="col">{{ t('conservationDashboard.table.species') }}</th>
              <th scope="col">{{ t('conservationDashboard.table.submittedBy') }}</th>
              <th scope="col">{{ t('conservationDashboard.table.status') }}</th>
              <th scope="col">{{ t('conservationDashboard.table.action') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in pendingRegistrations" :key="String(item.id)">
              <td>{{ plantId(item.plant_id) }}</td>
              <td>
                <em>{{ speciesName(item) }}</em>
              </td>
              <td><MonitoringIdentifier :value="item.owner_subject" :labels="subjectLabels" /></td>
              <td>
                <span class="badge" :class="statusClass(effectiveObservationStatus(item))">{{
                  dataLabel(effectiveObservationStatus(item))
                }}</span>
              </td>
              <td>
                <button
                  class="action-button"
                  @click="go('conservation-reviews', { review: observationId(item) })"
                >
                  {{ t('conservationDashboard.review') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

  <div class="two-column overview-medium">
    <section class="panel pending-observations-panel">
      <header class="panel-header">
        <div>
          <p class="section-kicker">{{ t('conservationDashboard.fieldRecords') }}</p>
          <h2>{{ t('conservationDashboard.pendingObservations') }}</h2>
        </div>
        <button class="secondary-button" @click="go('conservation-observations')">{{ t('conservationDashboard.viewAllObservations') }}</button>
      </header>
      <p v-if="observationsLoading" class="dashboard-state">{{ t('conservationDashboard.loadingObservations') }}</p>
      <p v-else-if="observationsError" class="dashboard-state error-state">{{ observationsError }}</p>
      <p v-else-if="!pendingFieldObservations.length" class="dashboard-state">{{ t('conservationDashboard.noPendingObservations') }}</p>
      <div v-else class="table-scroll officer-table-scroll overview-table-scroll" role="region" :aria-label="t('conservationDashboard.pendingObservations')" tabindex="0">
        <table class="officer-data-table field-observations-table"><colgroup><col class="overview-observation"/><col class="overview-plant"/><col class="overview-species"/><col class="overview-subject"/><col class="overview-status"/><col class="overview-actions"/></colgroup>
          <thead><tr>
            <th scope="col">{{ t('conservationDashboard.table.observationId') }}</th>
            <th scope="col">{{ t('conservationDashboard.table.plantId') }}</th>
            <th scope="col">{{ t('conservationDashboard.table.species') }}</th>
            <th scope="col">{{ t('conservationDashboard.table.submittedBy') }}</th>
            <th scope="col">{{ t('conservationDashboard.table.status') }}</th>
            <th scope="col">{{ t('conservationDashboard.table.action') }}</th>
          </tr></thead>
          <tbody><tr v-for="item in pendingFieldObservations" :key="String(item.id)">
            <td><strong><MonitoringIdentifier :value="String(item.id)" :labels="observationDisplayLabels" /></strong></td>
            <td>{{ plantId(item.plant_id) }}</td>
            <td><em>{{ speciesName(item) }}</em></td>
            <td><MonitoringIdentifier :value="item.owner_subject" :labels="subjectLabels" /></td>
            <td><span class="badge" :class="statusClass(effectiveObservationStatus(item))">{{ dataLabel(effectiveObservationStatus(item)) }}</span></td>
            <td><button class="action-button" @click="go('conservation-observations', { observation: observationId(item) })">{{ t('conservationDashboard.viewObservations') }}</button></td>
          </tr></tbody>
        </table>
      </div>
    </section>

    <section class="panel conservation-status-panel">
      <header class="panel-header">
        <div>
          <p class="section-kicker">{{ t('conservationDashboard.speciesHealth') }}</p>
          <h2>{{ t('conservationDashboard.speciesConservationStatus') }}</h2>
        </div>
      </header>
      <p v-if="speciesLoading" class="dashboard-state">Loading species...</p>
      <p v-else-if="speciesError" class="dashboard-state error-state">{{ speciesError }}</p>
      <template v-else>
        <p class="status-scope">{{ t('conservationDashboard.speciesStatusScope', { total: species.length }) }}</p>
        <div v-for="itemStatus in biodiversityStatuses" :key="itemStatus" class="conservation-row" :data-status="statusClass(itemStatus)">
          <div class="overview-row"><span>{{ dataLabel(itemStatus) }}</span><strong>{{ statusCount(itemStatus) }}</strong></div>
          <div class="status-track" role="img" :aria-label="t('conservationDashboard.speciesStatusShare', { status: dataLabel(itemStatus), count: statusCount(itemStatus), total: species.length })"><span class="status-fill" :style="{ width: statusShare(itemStatus) + '%' }"></span></div>
        </div>
      </template>
    </section>
  </div>

  <div class="two-column dashboard-lower">
    <section class="panel">
      <header class="panel-header">
        <div>
          <p class="section-kicker">{{ t('conservationDashboard.parkCoverage') }}</p>
          <h2>{{ t('conservationDashboard.speciesDistribution') }}</h2>
        </div>
        <button class="secondary-button" @click="go('conservation-map')">
          {{ t('conservationDashboard.openFullMap') }} →
        </button>
      </header>
      <p v-if="plantsLoading" class="dashboard-state">Loading map records...</p>
      <p v-else-if="plantsError" class="dashboard-state error-state">{{ plantsError }}</p>
      <BiodiversityMapPreview v-else :plants="mapPlants" />
    </section>

    <section class="panel">
      <header class="panel-header">
        <div>
          <p class="section-kicker">{{ t('conservationDashboard.attentionRequired') }}</p>
          <h2>{{ t('conservationDashboard.conservationAlerts') }}</h2>
        </div>
        <button class="secondary-button" @click="go('conservation-alerts')">
          {{ t('conservationDashboard.viewAllAlerts') }} →
        </button>
      </header>
      <p v-if="alertsLoading" class="dashboard-state">Loading threat alerts...</p>
      <p v-else-if="alertsError" class="dashboard-state error-state">{{ alertsError }}</p>
      <p v-else-if="!recentAlerts.length" class="dashboard-state">No threat alerts available.</p>
      <button
        v-for="alert in recentAlerts"
        v-else
        :key="String(alert.alert_id)"
        class="alert-preview"
        @click="go('conservation-alerts', { alert: alertId(alert.alert_id) })"
      >
        <div>
          <strong>{{ alert.alert_type }}</strong
          ><small
            >{{ alertId(alert.alert_id) }} · {{ plantId(alert.plant_id) }} ·
            {{ dt(alert.created_at) }} · {{ alert.status }}</small
          >
        </div>
        <span class="badge alert-severity-badge" :class="statusClass(alert.severity)">{{
          valueOrDash(alert.severity)
        }}</span>
      </button>
    </section>
  </div>

  <section class="panel">
    <header class="panel-header">
      <div>
        <p class="section-kicker">{{ t('conservationDashboard.shortcuts') }}</p>
        <h2>{{ t('conservationDashboard.quickActions') }}</h2>
      </div>
    </header>
    <div class="quick-grid">
      <button @click="go('conservation-species', { action: 'add' })">
        <svg class="preview-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span
          ><strong>{{ t('conservationDashboard.actions.addSpecies') }}</strong
          ><small>{{ t('conservationDashboard.actions.createSpecies') }}</small></span
        >
      </button>
      <button @click="go('conservation-reviews')">
        <svg class="preview-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg><span
          ><strong>{{ t('conservationDashboard.actions.reviewObservations') }}</strong
          ><small>{{ t('conservationDashboard.actions.verifySubmissions') }}</small></span
        >
      </button>
      <button @click="go('conservation-observations')">
        <svg class="preview-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg><span
          ><strong>{{ t('conservationDashboard.actions.searchObservations') }}</strong
          ><small>{{ t('conservationDashboard.actions.findRecords') }}</small></span
        >
      </button>
      <button @click="go('conservation-reports')">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="lucide lucide-file-text preview-icon"
          aria-hidden="true"
        >
          <path
            d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"
          />
          <path d="M14 2v5a1 1 0 0 0 1 1h5" />
          <path d="M10 9H8" />
          <path d="M16 13H8" />
          <path d="M16 17H8" /></svg
        ><span
          ><strong>{{ t('conservationDashboard.actions.generateReport') }}</strong
          ><small>{{ t('conservationDashboard.actions.createSummary') }}</small></span
        >
      </button>
    </div>
  </section>
  </div>
</template>

<style scoped>
.dashboard-overview { min-width: 0; max-width: 100%; container-type: inline-size; }
.dashboard-overview > *, .dashboard-overview .panel, .dashboard-overview .two-column > * { min-width: 0; max-width: 100%; box-sizing: border-box; }
.dashboard-overview .page-intro { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: baseline; gap: 6px 24px; }
.dashboard-overview .page-intro > div { display: contents; }
.dashboard-overview .page-intro .page-kicker { grid-column: 1 / -1; grid-row: 1; }
.dashboard-overview .page-intro h2 { min-width: 0; grid-column: 1; grid-row: 2; margin: 0; }
.officer-layout.officer-layout.officer-layout .dashboard-overview .page-intro > time { grid-column: 2; grid-row: 2; max-width: 100%; font-size: 1.125rem; font-weight: 600; line-height: 1.4; color: #315b49; overflow-wrap: anywhere; }
@container (max-width: 800px) {
  .dashboard-overview .page-intro { grid-template-columns: minmax(0, 1fr); }
  .officer-layout.officer-layout.officer-layout .dashboard-overview .page-intro > time { grid-column: 1; grid-row: 3; }
}
.dashboard-overview .summary-grid { grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; margin-bottom: 8px; }
.dashboard-overview .summary-card { --summary-background: #edf2ee; --summary-ink: #315b49; min-width: 0; padding: 16px; border: 1px solid var(--summary-ink); border-radius: 12px; background: var(--summary-background); color: var(--summary-ink); box-shadow: none; display: grid; grid-template-rows: 1fr auto; gap: 6px; }
.dashboard-overview .summary-card[data-metric="pendingReviews"] { --summary-background: #e8f0f5; --summary-ink: #315d78; }
.dashboard-overview .summary-card[data-metric="activeThreats"] { --summary-background: #fbe8e5; --summary-ink: #a33f35; }
.dashboard-overview .summary-card[data-metric="endangeredSpecies"] { --summary-background: #fff1db; --summary-ink: #926119; }
.officer-layout.officer-layout.officer-layout .dashboard-overview .summary-card p { margin: 0; color: inherit; font-size: .875rem; line-height: 1.4; }
.officer-layout.officer-layout.officer-layout .dashboard-overview .summary-card strong { color: inherit; font-size: 1.875rem; line-height: 1.2; }
.dashboard-overview .two-column { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.overview-medium { margin-top: 18px; }
.statistics-scope { margin: 0 0 16px; color: #5b7065; font-size: .8125rem; line-height: 1.5; }
.status-scope { margin: 0 0 12px; color: #5b7065; font-size: .8125rem; }
.conservation-row { padding-block: 9px; border-bottom: 1px solid #edf0ed; }
.conservation-row:last-child { border-bottom: 0; }
.conservation-row .overview-row { padding: 0 0 6px; border: 0; }
.status-track { width: 100%; height: 7px; background: #edf2ee; border-radius: 4px; }
.status-fill { display: block; height: 100%; background: #287a53; border-radius: inherit; }
.conservation-row[data-status="not-assessed"] .status-fill { background: #8a9992; }
.conservation-row[data-status="near-threatened"] .status-fill { background: #71845b; }
.conservation-row[data-status="vulnerable"] .status-fill { background: #9a6814; }
.conservation-row[data-status="endangered"] .status-fill, .conservation-row[data-status="critically-endangered"] .status-fill { background: #b84938; }
.dashboard-overview .panel-header { flex-wrap: wrap; gap: 12px; align-items: center; }
.dashboard-overview .panel-header > div { min-width: 0; flex: 1 1 14rem; }
.dashboard-overview .panel-header > button { max-width: 100%; flex: 0 0 auto; }
.officer-layout.officer-layout.officer-layout .dashboard-overview .overview-table-scroll { min-width: 0; max-width: 100%; width: 100%; overflow-x: auto; overscroll-behavior-inline: contain; }
.officer-layout.officer-layout.officer-layout .dashboard-overview .pending-review-table { min-width: 50rem; }
.officer-layout.officer-layout.officer-layout .dashboard-overview .field-observations-table { min-width: 50rem; }
.overview-observation, .overview-subject { width: 14rem; }
.overview-plant { width: 7rem; }
.overview-species { width: 24%; }
.overview-date { width: 12rem; }
.overview-status, .overview-actions { width: 1%; }
.dashboard-overview .overview-table-scroll :is(.badge, .action-button) { white-space: nowrap; }
.dashboard-overview :is(.pending-review-table, .field-observations-table) .badge.pending-review, .dashboard-overview :is(.pending-review-table, .field-observations-table) .badge.pending { background: #e8eff2; color: #53727c; }
.dashboard-overview :is(.pending-review-table, .field-observations-table) .badge.flagged { background: #f0eaf8; color: #69459a; }
.dashboard-overview .quick-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.dashboard-overview .quick-grid button { min-width: 0; padding: 12px; align-items: center; }
.dashboard-overview .quick-grid button > span { min-width: 0; overflow-wrap: anywhere; }
.dashboard-overview .quick-grid .preview-icon { width: 20px; height: 20px; flex: 0 0 20px; }
.dashboard-overview .alert-preview > div { min-width: 0; overflow-wrap: anywhere; }
@container (max-width: 1250px) { .dashboard-overview .summary-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@container (max-width: 1000px) {
  .dashboard-overview .two-column { grid-template-columns: minmax(0, 1fr); }
  .dashboard-overview .quick-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@container (max-width: 650px) { .dashboard-overview .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container (max-width: 400px) {
  .dashboard-overview .summary-grid, .dashboard-overview .quick-grid { grid-template-columns: minmax(0, 1fr); }
  .dashboard-overview .alert-preview { flex-wrap: wrap; }
}
.overview-row {
  padding: 12px 0;
  display: flex;
  justify-content: space-between;
  border-bottom: 1px solid #edf0ed;
  color: #5a7066;
  font-size: 11px;
  gap: 12px;
  align-items: center;
}
.overview-row > span { min-width: 0; }
.overview-row > strong { flex: 0 0 auto; font-variant-numeric: tabular-nums; }
.overview-row:last-child { border-bottom: 0; }
.dashboard-lower {
  margin-top: 18px;
}
.two-column + .panel {
  margin-top: 18px;
}
.dashboard-state {
  margin: 0;
  padding: 28px 18px;
  color: #7b8a83;
  font-size: 11px;
  text-align: center;
}
.error-state {
  color: #a04d3f;
}
.record-link {
  color: #2f7459;
  text-decoration: none;
}
.record-link:hover {
  text-decoration: underline;
}
.alert-preview {
  width: 100%;
  padding: 13px 0;
  display: flex;
  justify-content: space-between;
  gap: 10px;
  border: 0;
  border-bottom: 1px solid #edf0ed;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.alert-preview:hover {
  background: #f6f9f6;
}
.alert-preview div {
  display: grid;
  gap: 4px;
}
.alert-preview strong {
  font-size: 11px;
}
.alert-preview small {
  color: #8a9992;
  font-size: 9px;
}
.alert-severity-badge {
  width: auto;
  min-width: 48px;
  flex: 0 0 auto;
  align-self: center;
  padding: 5px 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  line-height: 1;
  white-space: nowrap;
}
.quick-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
.quick-grid button {
  padding: 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid #dfe6df;
  border-radius: 12px;
  background: #f9fbf8;
  color: #39795f;
  cursor: pointer;
  text-align: left;
  font-size: 18px;
}
.quick-grid .preview-icon {
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
  overflow: visible;
}
.secondary-button,
.action-button,
.quick-grid button {
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
.action-button:hover {
  border-color: #9fc4ad;
  background: #edf6f0;
  color: #28664e;
  box-shadow: 0 3px 9px rgba(42, 91, 70, 0.08);
  transform: translateY(-1px);
}
.quick-grid button:hover {
  border-color: #b1cfbb;
  background: #f1f7f3;
  box-shadow: 0 6px 16px rgba(35, 70, 53, 0.09);
  transform: translateY(-2px);
}
.quick-grid button:hover strong {
  color: #244f3f;
}
.secondary-button:active,
.action-button:active,
.quick-grid button:active {
  transform: translateY(0) scale(0.99);
}
.secondary-button:focus-visible,
.action-button:focus-visible,
.quick-grid button:focus-visible,
.alert-preview:focus-visible {
  outline: 3px solid rgba(74, 145, 113, 0.3);
  outline-offset: 2px;
}
.quick-grid span {
  display: grid;
}
.quick-grid strong {
  color: #34594b;
  font-size: 11px;
}
.quick-grid small {
  margin-top: 3px;
  color: #8c9993;
  font-size: 8px;
}
@media (max-width: 800px) {
  .quick-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 450px) {
  .quick-grid {
    grid-template-columns: 1fr;
  }
}
@media (prefers-reduced-motion: reduce) {
  .secondary-button,
  .action-button,
  .quick-grid button {
    transition:
      background-color 0.2s ease,
      border-color 0.2s ease,
      color 0.2s ease,
      box-shadow 0.2s ease;
  }
  .secondary-button:hover,
  .action-button:hover,
  .quick-grid button:hover,
  .secondary-button:active,
  .action-button:active,
  .quick-grid button:active {
    transform: none;
  }
}
</style>

<style src="../../styles/officer-data-tables.css"></style>
