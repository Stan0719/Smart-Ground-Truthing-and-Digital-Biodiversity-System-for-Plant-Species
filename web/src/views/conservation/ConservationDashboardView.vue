<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import BiodiversityMapPreview from '../../components/conservation/BiodiversityMapPreview.vue'
import { useConservationText } from '../../composables/useConservationText'
import { formatObservationId } from '../../utils/observationId'
import { formatPlantId } from '../../utils/plantId'

interface ApiObservation {
  observation_id: string | number
  plant_id: string | number
  recorded_by?: string | number | null
  status?: string | null
  verification_status?: string | null
  scientific_name?: string | null
  common_name?: string | null
}

interface ApiPlant {
  plant_id: string | number
  registered_by?: string | number | null
  current_status?: string | null
  registered_at?: string | null
  scientific_name?: string | null
  common_name?: string | null
  latitude?: string | number | null
  longitude?: string | number | null
  last_verified_at?: string | null
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
const { t, te } = useI18n()
const { dt } = useConservationText()
const go = (name: string, query?: Record<string, string>) => router.push({ name, query })

const observations = ref<ApiObservation[]>([])
const plants = ref<ApiPlant[]>([])
const species = ref<ApiSpecies[]>([])
const alerts = ref<ApiAlert[]>([])
const observationsLoading = ref(true)
const plantsLoading = ref(true)
const speciesLoading = ref(true)
const alertsLoading = ref(true)
const observationsError = ref('')
const plantsError = ref('')
const speciesError = ref('')
const alertsError = ref('')

const loadJson = async <T,>(url: string, collection: string): Promise<T[]> => {
  const response = await fetch(url)
  const result = (await response.json()) as Record<string, unknown>
  if (!response.ok) throw new Error(String(result.message || 'Unable to load dashboard data.'))
  return Array.isArray(result[collection]) ? (result[collection] as T[]) : []
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
    species.value = await loadJson<ApiSpecies>('/api/species', 'species')
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
  (observation.verification_status || observation.status || '').trim()
const requiresReview = (observation: ApiObservation) => {
  const status = effectiveObservationStatus(observation).toLowerCase().replace(/[_-]+/g, ' ')
  return ['pending', 'pending review', 'correction required', 'flagged'].includes(status)
}
const pending = computed(() => observations.value.filter(requiresReview).slice(0, 4))
const recentPlants = computed(() => plants.value.slice(0, 4))
const recentAlerts = computed(() =>
  [...alerts.value]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 3),
)
const mapPlants = computed(() =>
  plants.value.flatMap((plant) => {
    const id = formatPlantId(plant.plant_id)
    if (
      plant.latitude === null ||
      plant.latitude === undefined ||
      plant.longitude === null ||
      plant.longitude === undefined
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
        scientificName: plant.scientific_name || '',
        commonName: plant.common_name || '',
      },
    ]
  }),
)

const endangeredSpeciesCount = computed(
  () =>
    species.value.filter((item) =>
      (item.conservation_status || '').toLowerCase().includes('endangered'),
    ).length,
)
const activeAlertCount = computed(
  () => alerts.value.filter((alert) => alert.status.toLowerCase() !== 'resolved').length,
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

const biodiversityStatuses = [
  'Not Assessed',
  'Least Concern',
  'Near Threatened',
  'Vulnerable',
  'Endangered',
  'Critically Endangered',
]
const statusCount = (status: string) =>
  species.value.filter((item) => item.conservation_status === status).length
const dataLabel = (value: string) => {
  const key = `dashboardValues.${value.toLowerCase().replace(/[^a-z0-9]+/g, '')}`
  return te(key) ? t(key) : value
}
const valueOrDash = (value: string | number | null | undefined) =>
  value === null || value === undefined || value === '' ? '—' : String(value)
const observationId = (item: ApiObservation) => formatObservationId(item.observation_id) || '—'
const plantId = (value: string | number) => formatPlantId(value) || '—'
const alertId = (value: string | number) => {
  const numeric = Number(value)
  return Number.isSafeInteger(numeric) && numeric > 0
    ? `ALT${String(numeric).padStart(3, '0')}`
    : String(value)
}
const speciesName = (item: { scientific_name?: string | null; common_name?: string | null }) =>
  item.scientific_name || item.common_name || 'Not available'
</script>

<template>
  <section class="page-intro">
    <div>
      <p class="page-kicker">{{ t('conservationDashboard.overview') }}</p>
      <h2>{{ t('conservationDashboard.greeting') }}</h2>
      <p>{{ t('conservationDashboard.intro') }}</p>
    </div>
    <time datetime="2026-10-03">{{ t('conservationDashboard.date') }}</time>
  </section>

  <section class="summary-grid">
    <article v-for="card in summaries" :key="String(card[0])" class="summary-card">
      <p>{{ t(`conservationDashboard.summary.${card[0]}`) }}</p>
      <strong>{{ card[1] }}</strong
      ><small>{{ t(`conservationDashboard.summary.${card[2]}`) }}</small>
    </article>
  </section>

  <div class="two-column">
    <section class="panel">
      <header class="panel-header">
        <div>
          <p class="section-kicker">{{ t('conservationDashboard.requiresReview') }}</p>
          <h2>{{ t('conservationDashboard.pendingObservationReviews') }}</h2>
          <span class="panel-description">{{ t('conservationDashboard.pendingDescription') }}</span>
        </div>
        <button class="secondary-button" @click="go('conservation-reviews')">
          {{ t('conservationDashboard.viewAllSubmissions') }} →
        </button>
      </header>
      <p v-if="observationsLoading" class="dashboard-state">Loading observations...</p>
      <p v-else-if="observationsError" class="dashboard-state error-state">
        {{ observationsError }}
      </p>
      <p v-else-if="!pending.length" class="dashboard-state">
        No observations currently require review.
      </p>
      <div v-else class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{{ t('conservationDashboard.table.observationId') }}</th>
              <th>{{ t('conservationDashboard.table.plantId') }}</th>
              <th>{{ t('conservationDashboard.table.species') }}</th>
              <th>{{ t('conservationDashboard.table.submittedBy') }}</th>
              <th>{{ t('conservationDashboard.table.status') }}</th>
              <th>{{ t('conservationDashboard.table.action') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in pending" :key="String(item.observation_id)">
              <td>
                <strong>{{ observationId(item) }}</strong>
              </td>
              <td>{{ plantId(item.plant_id) }}</td>
              <td>
                <em>{{ speciesName(item) }}</em>
              </td>
              <td>{{ valueOrDash(item.recorded_by) }}</td>
              <td>
                <span class="badge pending-review">{{
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

    <section class="panel">
      <header class="panel-header">
        <div>
          <p class="section-kicker">{{ t('conservationDashboard.speciesHealth') }}</p>
          <h2>{{ t('conservationDashboard.biodiversityOverview') }}</h2>
        </div>
      </header>
      <p v-if="speciesLoading" class="dashboard-state">Loading species...</p>
      <p v-else-if="speciesError" class="dashboard-state error-state">{{ speciesError }}</p>
      <template v-else
        ><div v-for="itemStatus in biodiversityStatuses" :key="itemStatus" class="overview-row">
          <span>{{ dataLabel(itemStatus) }}</span
          ><strong>{{ statusCount(itemStatus) }}</strong>
        </div></template
      >
    </section>
  </div>

  <section class="panel">
    <header class="panel-header">
      <div>
        <p class="section-kicker">{{ t('conservationDashboard.latestRecords') }}</p>
        <h2>{{ t('conservationDashboard.recentPlantRecords') }}</h2>
      </div>
      <button class="secondary-button" @click="go('conservation-observations')">
        View All Observations →
      </button>
    </header>
    <p v-if="plantsLoading" class="dashboard-state">Loading plant records...</p>
    <p v-else-if="plantsError" class="dashboard-state error-state">{{ plantsError }}</p>
    <p v-else-if="!recentPlants.length" class="dashboard-state">No plant records available.</p>
    <div v-else class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{{ t('conservationDashboard.table.plantId') }}</th>
            <th>{{ t('conservationDashboard.table.species') }}</th>
            <th>Registered By</th>
            <th>Registered At</th>
            <th>{{ t('conservationDashboard.table.lastObservation') }}</th>
            <th>{{ t('conservationDashboard.table.status') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="plant in recentPlants" :key="String(plant.plant_id)">
            <td>
              <RouterLink class="record-link" :to="`/plant/${plantId(plant.plant_id)}`"
                ><strong>{{ plantId(plant.plant_id) }}</strong></RouterLink
              >
            </td>
            <td>
              <em>{{ speciesName(plant) }}</em>
            </td>
            <td>{{ valueOrDash(plant.registered_by) }}</td>
            <td>{{ plant.registered_at ? dt(plant.registered_at) : '—' }}</td>
            <td>{{ plant.last_verified_at ? dt(plant.last_verified_at) : '—' }}</td>
            <td>
              <span class="badge approved">{{ valueOrDash(plant.current_status) }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

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
        <span class="badge alert-severity-badge" :class="alert.severity.toLowerCase()">{{
          alert.severity
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
        ＋<span
          ><strong>{{ t('conservationDashboard.actions.addSpecies') }}</strong
          ><small>{{ t('conservationDashboard.actions.createSpecies') }}</small></span
        >
      </button>
      <button @click="go('conservation-reviews')">
        ✓<span
          ><strong>{{ t('conservationDashboard.actions.reviewObservations') }}</strong
          ><small>{{ t('conservationDashboard.actions.verifySubmissions') }}</small></span
        >
      </button>
      <button @click="go('conservation-observations')">
        ⌕<span
          ><strong>Search Observations</strong
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
</template>

<style scoped>
.overview-row {
  padding: 12px 0;
  display: flex;
  justify-content: space-between;
  border-bottom: 1px solid #edf0ed;
  color: #5a7066;
  font-size: 11px;
}
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
