<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import {
  conservationStore,
  speciesForPlant,
  type ConservationStatus,
  type ObservationStatus,
} from '../../data/conservation'

type ReportType =
  | 'Biodiversity Summary'
  | 'Species Report'
  | 'Field Observation Report'
  | 'Conservation Status Report'
  | 'Threat Alert Report'

interface ReportForm {
  type: ReportType
  start: string
  end: string
  species: string
  status: ConservationStatus | ''
  observationStatus: ObservationStatus | ''
}

const reportTypes: ReportType[] = [
  'Biodiversity Summary',
  'Species Report',
  'Field Observation Report',
  'Conservation Status Report',
  'Threat Alert Report',
]
const observationStatuses: ObservationStatus[] = [
  'Draft', 'Pending Review', 'Approved', 'Rejected', 'Correction Required', 'Flagged',
]

const form = reactive<ReportForm>({
  type: 'Biodiversity Summary', start: '2026-09-01', end: '2026-10-03',
  species: '', status: '', observationStatus: '',
})
const preview = ref(false)
const toast = ref('')
const validationMessage = ref('')

const usesDates = computed(() => form.type !== 'Conservation Status Report')
const usesConservationStatus = computed(() =>
  ['Biodiversity Summary', 'Species Report', 'Conservation Status Report'].includes(form.type),
)
const usesObservationStatus = computed(() =>
  ['Biodiversity Summary', 'Field Observation Report'].includes(form.type),
)
const conservationStatuses = computed(() => [
  ...new Set(conservationStore.species.map((species) => species.status)),
])
const selectedSpecies = computed(() =>
  conservationStore.species.find((species) => species.id === form.species),
)

const parseRecordDate = (value: string) => {
  const parsed = Date.parse(value.replace(',', ''))
  return Number.isNaN(parsed) ? null : parsed
}

const isWithinDateRange = (value: string) => {
  if (!usesDates.value) return true
  const timestamp = parseRecordDate(value)
  if (timestamp === null) return false
  const start = form.start ? new Date(`${form.start}T00:00:00`).getTime() : null
  const end = form.end ? new Date(`${form.end}T23:59:59.999`).getTime() : null
  return (start === null || timestamp >= start) && (end === null || timestamp <= end)
}

const filteredSpecies = computed(() =>
  conservationStore.species.filter(
    (species) =>
      (!form.species || species.id === form.species) &&
      (!usesConservationStatus.value || !form.status || species.status === form.status),
  ),
)
const filteredSpeciesIds = computed(() => new Set(filteredSpecies.value.map((species) => species.id)))
const matchingPlants = computed(() =>
  conservationStore.plants.filter((plant) => filteredSpeciesIds.value.has(plant.speciesId)),
)
const filteredPlants = computed(() =>
  matchingPlants.value.filter((plant) => isWithinDateRange(plant.registeredAt)),
)
const filteredObservations = computed(() =>
  conservationStore.observations.filter((observation) => {
    const species = speciesForPlant(observation.plantId)
    return Boolean(species && filteredSpeciesIds.value.has(species.id)) &&
      isWithinDateRange(observation.observedAt) &&
      (!form.observationStatus || observation.status === form.observationStatus)
  }),
)
const filteredAlerts = computed(() =>
  conservationStore.alerts.filter((alert) => {
    const species = speciesForPlant(alert.plantId)
    return Boolean(species && filteredSpeciesIds.value.has(species.id)) &&
      isWithinDateRange(alert.detectedAt)
  }),
)

const biodiversityMetrics = computed(() => ({
  totalPlants: matchingPlants.value.length,
  uniqueSpecies: new Set(matchingPlants.value.map((plant) => plant.speciesId)).size,
  newPlants: filteredPlants.value.length,
  approvedObservations: filteredObservations.value.filter((item) => item.status === 'Approved').length,
  pendingObservations: filteredObservations.value.filter((item) => item.status === 'Pending Review').length,
}))
const observationMetrics = computed(() => ({
  total: filteredObservations.value.length,
  approved: filteredObservations.value.filter((item) => item.status === 'Approved').length,
  pending: filteredObservations.value.filter((item) => item.status === 'Pending Review').length,
  rejected: filteredObservations.value.filter((item) => item.status === 'Rejected').length,
}))
const alertMetrics = computed(() => ({
  total: filteredAlerts.value.length,
  high: filteredAlerts.value.filter((item) => item.severity === 'High').length,
  active: filteredAlerts.value.filter((item) => item.status !== 'Resolved').length,
  resolved: filteredAlerts.value.filter((item) => item.status === 'Resolved').length,
}))

const speciesRows = computed(() =>
  filteredSpecies.value.map((species) => {
    const registrations = filteredPlants.value
      .filter((plant) => plant.speciesId === species.id)
      .sort((a, b) => (parseRecordDate(a.registeredAt) ?? 0) - (parseRecordDate(b.registeredAt) ?? 0))
    return {
      ...species,
      totalPlants: registrations.length,
      firstRegistered: registrations.at(0)?.registeredAt ?? '—',
      latestRegistered: registrations.at(-1)?.registeredAt ?? '—',
    }
  }),
)
const conservationRows = computed(() =>
  conservationStatuses.value
    .filter((status) => !form.status || status === form.status)
    .map((status) => {
      const statusSpecies = filteredSpecies.value.filter((species) => species.status === status)
      const speciesIds = new Set(statusSpecies.map((species) => species.id))
      return {
        status,
        speciesCount: statusSpecies.length,
        plantCount: conservationStore.plants.filter((plant) => speciesIds.has(plant.speciesId)).length,
      }
    }),
)
const reportMeta = computed(() => {
  const details: string[] = []
  if (usesDates.value) details.push(`Reporting period: ${form.start || 'Any'} to ${form.end || 'Any'}`)
  details.push(`Species: ${selectedSpecies.value?.scientificName ?? 'All species'}`)
  if (usesConservationStatus.value) details.push(`Conservation status: ${form.status || 'All statuses'}`)
  if (usesObservationStatus.value) details.push(`Observation status: ${form.observationStatus || 'All statuses'}`)
  return details
})

const emptyMessage = (subject: string) => `No ${subject} match the selected filters.`

function generate() {
  validationMessage.value = ''
  if (usesDates.value && form.start && form.end && form.start > form.end) {
    preview.value = false
    validationMessage.value = 'Start date must not be after end date.'
    return
  }
  preview.value = true
  requestAnimationFrame(() =>
    document.querySelector('.report-preview')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
  )
}

function exportFile(format: 'PDF' | 'CSV') {
  toast.value = `${format} export is ready for backend integration.`
  window.setTimeout(() => { toast.value = '' }, 2500)
}
</script>

<template>
  <section class="page-intro">
    <div><p class="page-kicker">ANALYSIS &amp; EXPORT</p><h2>Reports</h2><p>Generate filtered period summaries from biodiversity records.</p></div>
  </section>

  <section class="panel reports-panel">
    <header class="panel-header"><div><p class="section-kicker">GENERATE REPORT</p><h2>Report Filters</h2></div></header>
    <form class="form-grid report-filters" @submit.prevent="generate">
      <label class="form-field"><span>Report Type</span><select v-model="form.type"><option v-for="type in reportTypes" :key="type">{{ type }}</option></select></label>
      <label class="form-field"><span>Species</span><select v-model="form.species"><option value="">All species</option><option v-for="species in conservationStore.species" :key="species.id" :value="species.id">{{ species.scientificName }}</option></select></label>
      <label v-if="usesDates" class="form-field"><span>Start Date</span><input v-model="form.start" type="date" /></label>
      <label v-if="usesDates" class="form-field"><span>End Date</span><input v-model="form.end" type="date" /></label>
      <label v-if="usesConservationStatus" class="form-field"><span>Conservation Status</span><select v-model="form.status"><option value="">All statuses</option><option v-for="status in conservationStatuses" :key="status">{{ status }}</option></select></label>
      <label v-if="usesObservationStatus" class="form-field"><span>Observation Status</span><select v-model="form.observationStatus"><option value="">All statuses</option><option v-for="status in observationStatuses" :key="status">{{ status }}</option></select></label>
      <div class="form-field report-submit"><span aria-hidden="true">&nbsp;</span><button type="submit" class="primary-button">Generate Report</button></div>
      <p v-if="validationMessage" class="report-error" role="alert">{{ validationMessage }}</p>
    </form>

    <article v-if="preview" class="report-preview">
      <header class="report-title"><p class="section-kicker">NIAH NATIONAL PARK</p><h2>{{ form.type }}</h2></header>
      <div class="report-meta" aria-label="Applied report filters"><span v-for="detail in reportMeta" :key="detail">{{ detail }}</span></div>

      <div v-if="form.type === 'Biodiversity Summary'" class="metric-grid">
        <div class="metric"><span>Total Plant Records</span><strong>{{ biodiversityMetrics.totalPlants }}</strong></div>
        <div class="metric"><span>Unique Species</span><strong>{{ biodiversityMetrics.uniqueSpecies }}</strong></div>
        <div class="metric"><span>New Plant Records</span><strong>{{ biodiversityMetrics.newPlants }}</strong></div>
        <div class="metric"><span>Approved Observations</span><strong>{{ biodiversityMetrics.approvedObservations }}</strong></div>
        <div class="metric"><span>Pending Observations</span><strong>{{ biodiversityMetrics.pendingObservations }}</strong></div>
      </div>

      <div v-else-if="form.type === 'Species Report'" class="table-scroll">
        <table><thead><tr><th>Scientific Name</th><th>Common Name</th><th>Family</th><th>Conservation Status</th><th>Total Plant Records</th><th>First Plant Registered</th><th>Latest Plant Registered</th></tr></thead><tbody>
          <tr v-for="species in speciesRows" :key="species.id"><td><em>{{ species.scientificName }}</em></td><td>{{ species.commonName }}</td><td>{{ species.family }}</td><td>{{ species.status }}</td><td>{{ species.totalPlants }}</td><td>{{ species.firstRegistered }}</td><td>{{ species.latestRegistered }}</td></tr>
          <tr v-if="!speciesRows.length"><td colspan="7" class="empty-row">{{ emptyMessage('species') }}</td></tr>
        </tbody></table>
      </div>

      <template v-else-if="form.type === 'Field Observation Report'">
        <div class="metric-grid report-metrics"><div class="metric"><span>Total Observations</span><strong>{{ observationMetrics.total }}</strong></div><div class="metric"><span>Approved</span><strong>{{ observationMetrics.approved }}</strong></div><div class="metric"><span>Pending</span><strong>{{ observationMetrics.pending }}</strong></div><div class="metric"><span>Rejected</span><strong>{{ observationMetrics.rejected }}</strong></div></div>
        <div class="table-scroll"><table><thead><tr><th>Observation ID</th><th>Plant ID</th><th>Species</th><th>Observed At</th><th>Life Stage</th><th>Health Status</th><th>Status</th></tr></thead><tbody>
          <tr v-for="observation in filteredObservations" :key="observation.id"><td><strong>{{ observation.id }}</strong></td><td>{{ observation.plantId }}</td><td><em>{{ speciesForPlant(observation.plantId)?.scientificName ?? '—' }}</em></td><td>{{ observation.observedAt }}</td><td>{{ observation.growthStage }}</td><td>{{ observation.health }}</td><td>{{ observation.status }}</td></tr>
          <tr v-if="!filteredObservations.length"><td colspan="7" class="empty-row">{{ emptyMessage('observations') }}</td></tr>
        </tbody></table></div>
      </template>

      <div v-else-if="form.type === 'Conservation Status Report'" class="metric-grid">
        <div v-for="row in conservationRows" :key="row.status" class="metric"><span>{{ row.status }}</span><strong>{{ row.speciesCount }} species</strong><small>{{ row.plantCount }} plant records</small></div>
      </div>

      <template v-else>
        <div class="metric-grid report-metrics"><div class="metric"><span>Total Alerts</span><strong>{{ alertMetrics.total }}</strong></div><div class="metric"><span>High Severity</span><strong>{{ alertMetrics.high }}</strong></div><div class="metric"><span>Open / Active Alerts</span><strong>{{ alertMetrics.active }}</strong></div><div class="metric"><span>Resolved Alerts</span><strong>{{ alertMetrics.resolved }}</strong></div></div>
        <div class="table-scroll"><table><thead><tr><th>Alert ID</th><th>Plant ID</th><th>Species</th><th>Alert Type</th><th>Severity</th><th>Confidence</th><th>Created At</th><th>Status</th><th>Resolved At</th></tr></thead><tbody>
          <tr v-for="alert in filteredAlerts" :key="alert.id"><td><strong>{{ alert.id }}</strong></td><td>{{ alert.plantId }}</td><td><em>{{ speciesForPlant(alert.plantId)?.scientificName ?? '—' }}</em></td><td>{{ alert.type }}</td><td>{{ alert.severity }}</td><td>—</td><td>{{ alert.detectedAt }}</td><td>{{ alert.status }}</td><td>—</td></tr>
          <tr v-if="!filteredAlerts.length"><td colspan="9" class="empty-row">{{ emptyMessage('threat alerts') }}</td></tr>
        </tbody></table></div>
      </template>

      <div class="modal-actions report-actions"><button type="button" class="secondary-button" @click="exportFile('PDF')">Export PDF</button><button type="button" class="secondary-button" @click="exportFile('CSV')">Export CSV</button></div>
    </article>
  </section>
  <div v-if="toast" class="toast" role="status">{{ toast }}</div>
</template>

<style scoped>
.report-filters{align-items:end}.report-submit .primary-button{width:100%}.report-error{grid-column:1/-1;margin:0;color:#b84d42;font-size:10px;font-weight:700}.report-meta{display:flex;flex-wrap:wrap;gap:7px 18px}.report-meta span{position:relative}.report-meta span+span::before{position:absolute;left:-11px;content:'·'}.report-metrics{margin-bottom:18px}.metric small{display:block;margin-top:5px;color:#87968e;font-size:9px}.report-actions{padding-top:18px;border-top:1px solid #edf0ed}
@media(max-width:620px){.report-preview{padding:18px}.report-meta{align-items:flex-start;flex-direction:column;gap:5px}.report-meta span+span::before{content:none}.metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.report-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:380px){.metric-grid{grid-template-columns:1fr}}
</style>
