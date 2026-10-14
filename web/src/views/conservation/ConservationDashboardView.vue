<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import BiodiversityMapPreview from '../../components/conservation/BiodiversityMapPreview.vue'
import { conservationStore, speciesForPlant, speciesRequestForPlant } from '../../data/conservation'
const router = useRouter()
const { t, te } = useI18n()
const go = (name: string, query?: Record<string, string>) => router.push({ name, query })
const summaries = [
  ['plantSpecies', conservationStore.species.length, 'digitalKnowledgeBase'],
  ['plantRecords', conservationStore.plants.length, 'registeredPlants'],
  [
    'pendingReviews',
    conservationStore.observations.filter((o) => o.status === 'Pending Review').length,
    'requiresVerification',
  ],
  [
    'endangeredSpecies',
    conservationStore.species.filter((s) => s.status.includes('Endangered')).length,
    'underMonitoring',
  ],
  [
    'activeThreats',
    conservationStore.alerts.filter((a) => a.status !== 'Resolved').length,
    'needsAttention',
  ],
  ['recentObservations', conservationStore.observations.length, 'currentDataset'],
]
const pending = conservationStore.observations
  .filter((o) => o.status === 'Pending Review')
  .slice(0, 4)
const translatedScientificName = (id: string, fallback: string) => {
  const key = `conservationSpecies.scientific.${id}`
  return te(key) ? t(key) : fallback
}
const speciesLabel = (plantId: string) => {
  const officialSpecies = speciesForPlant(plantId)
  if (officialSpecies)
    return translatedScientificName(officialSpecies.id, officialSpecies.scientificName)
  const request = speciesRequestForPlant(plantId)
  const proposedName = request
    ? translatedScientificName('proposedShoreaNiahensis', request.proposedScientificName)
    : ''
  return request
    ? t('conservationDashboard.proposedSpecies', { name: proposedName })
    : t('conservationDashboard.speciesUnavailable')
}
const dataLabel = (value: string) => {
  const key = `dashboardValues.${value.toLowerCase().replace(/[^a-z0-9]+/g, '')}`
  return te(key) ? t(key) : value
}
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
      <div class="table-scroll">
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
            <tr v-for="o in pending" :key="o.id">
              <td>
                <strong>{{ o.id }}</strong>
              </td>
              <td>{{ o.plantId }}</td>
              <td>
                <em>{{ speciesLabel(o.plantId) }}</em>
              </td>
              <td>{{ o.recordedBy }}</td>
              <td>
                <span class="badge pending-review">{{ dataLabel(o.status) }}</span>
              </td>
              <td>
                <button class="action-button" @click="go('conservation-reviews', { review: o.id })">
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
      <div
        v-for="status in [
          'Not Assessed',
          'Least Concern',
          'Near Threatened',
          'Vulnerable',
          'Endangered',
          'Critically Endangered',
        ]"
        :key="status"
        class="overview-row"
      >
        <span>{{ dataLabel(status) }}</span
        ><strong>{{ conservationStore.species.filter((s) => s.status === status).length }}</strong>
      </div>
    </section>
  </div>
  <section class="panel">
    <header class="panel-header">
      <div>
        <p class="section-kicker">{{ t('conservationDashboard.latestRecords') }}</p>
        <h2>{{ t('conservationDashboard.recentPlantRecords') }}</h2>
      </div>
      <button class="secondary-button" @click="go('conservation-observations')">
        {{ t('conservationDashboard.viewAllPlants') }} →
      </button>
    </header>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{{ t('conservationDashboard.table.plantId') }}</th>
            <th>{{ t('conservationDashboard.table.species') }}</th>
            <th>{{ t('conservationDashboard.table.location') }}</th>
            <th>{{ t('conservationDashboard.table.recordedBy') }}</th>
            <th>{{ t('conservationDashboard.table.lastObservation') }}</th>
            <th>{{ t('conservationDashboard.table.status') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in conservationStore.plants.slice(0, 4)" :key="p.id">
            <td>
              <strong>{{ p.id }}</strong>
            </td>
            <td>
              <em>{{ speciesLabel(p.id) }}</em>
            </td>
            <td>{{ dataLabel(p.location) }}</td>
            <td>{{ p.registeredBy }}</td>
            <td>{{ p.lastObservation }}</td>
            <td>
              <span class="badge approved">{{ dataLabel(p.status) }}</span>
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
      <BiodiversityMapPreview />
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
      <article v-for="a in conservationStore.alerts.slice(0, 3)" :key="a.id" class="alert-preview">
        <div>
          <strong>{{ dataLabel(a.type) }}</strong
          ><small>{{ a.id }} · {{ a.plantId }} · {{ dataLabel(a.zone) }}</small>
        </div>
        <span class="badge alert-severity-badge" :class="a.severity.toLowerCase()">
          {{ dataLabel(a.severity) }}
        </span>
      </article>
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
        ＋
        <span
          ><strong>{{ t('conservationDashboard.actions.addSpecies') }}</strong
          ><small>{{ t('conservationDashboard.actions.createSpecies') }}</small></span
        ></button
      ><button @click="go('conservation-reviews')">
        ✓
        <span
          ><strong>{{ t('conservationDashboard.actions.reviewObservations') }}</strong
          ><small>{{ t('conservationDashboard.actions.verifySubmissions') }}</small></span
        ></button
      ><button @click="go('conservation-observations')">
        ⌕
        <span
          ><strong>{{ t('conservationDashboard.actions.searchPlants') }}</strong
          ><small>{{ t('conservationDashboard.actions.findRecords') }}</small></span
        ></button
      ><button @click="go('conservation-reports')">
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
          <path d="M16 17H8" />
        </svg>
        <span
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
.alert-preview {
  padding: 13px 0;
  display: flex;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid #edf0ed;
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
.quick-grid button:focus-visible {
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
