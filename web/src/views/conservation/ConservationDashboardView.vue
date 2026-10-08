<script setup lang="ts">
import { useRouter } from 'vue-router'
import { conservationStore, speciesForPlant, speciesRequestForPlant } from '../../data/conservation'
const router = useRouter()
const go = (name: string, query?: Record<string, string>) => router.push({ name, query })
const summaries = [
  ['Plant Species', conservationStore.species.length, 'Digital knowledge base'],
  ['Plant Records', conservationStore.plants.length, 'Registered plants'],
  [
    'Pending Reviews',
    conservationStore.observations.filter((o) => o.status === 'Pending Review').length,
    'Requires verification',
  ],
  [
    'Endangered Species',
    conservationStore.species.filter((s) => s.status.includes('Endangered')).length,
    'Under monitoring',
  ],
  [
    'Active Threats',
    conservationStore.alerts.filter((a) => a.status !== 'Resolved').length,
    'Needs attention',
  ],
  ['Recent Observations', conservationStore.observations.length, 'Current mock dataset'],
]
const pending = conservationStore.observations
  .filter((o) => o.status === 'Pending Review')
  .slice(0, 4)
const speciesLabel = (plantId: string) => {
  const officialSpecies = speciesForPlant(plantId)
  if (officialSpecies) return officialSpecies.scientificName
  const request = speciesRequestForPlant(plantId)
  return request ? `Proposed: ${request.proposedScientificName}` : 'Species unavailable'
}
</script>
<template>
  <section class="page-intro">
    <div>
      <p class="page-kicker">OVERVIEW</p>
      <h2>Good afternoon, Conservation Officer</h2>
      <p>Here is the latest overview of biodiversity records and conservation activities.</p>
    </div>
    <time datetime="2026-10-03">Saturday, 3 October 2026</time>
  </section>
  <section class="summary-grid">
    <article v-for="card in summaries" :key="String(card[0])" class="summary-card">
      <p>{{ card[0] }}</p>
      <strong>{{ card[1] }}</strong
      ><small>{{ card[2] }}</small>
    </article>
  </section>
  <div class="two-column">
    <section class="panel">
      <header class="panel-header">
        <div>
          <p class="section-kicker">REQUIRES REVIEW</p>
          <h2>Pending Observation Reviews</h2>
          <span class="panel-description">Recent field observations submitted by botanists</span>
        </div>
        <button class="secondary-button" @click="go('conservation-reviews')">
          View All Submissions →
        </button>
      </header>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Observation ID</th>
              <th>Plant ID</th>
              <th>Species</th>
              <th>Submitted By</th>
              <th>Status</th>
              <th>Action</th>
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
                <span class="badge pending-review">{{ o.status }}</span>
              </td>
              <td>
                <button class="action-button" @click="go('conservation-reviews', { review: o.id })">
                  Review
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
          <p class="section-kicker">SPECIES HEALTH</p>
          <h2>Biodiversity Overview</h2>
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
        <span>{{ status }}</span
        ><strong>{{ conservationStore.species.filter((s) => s.status === status).length }}</strong>
      </div>
    </section>
  </div>
  <section class="panel">
    <header class="panel-header">
      <div>
        <p class="section-kicker">LATEST RECORDS</p>
        <h2>Recent Plant Records</h2>
      </div>
      <button class="secondary-button" @click="go('conservation-observations')">
        View All Plants →
      </button>
    </header>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Plant ID</th>
            <th>Species</th>
            <th>Location</th>
            <th>Recorded By</th>
            <th>Last Observation</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in conservationStore.plants.slice(0, 4)" :key="p.id">
            <td>
              <strong>{{ p.id }}</strong>
            </td>
            <td>
              <em>{{ speciesForPlant(p.id)?.scientificName }}</em>
            </td>
            <td>{{ p.location }}</td>
            <td>{{ p.registeredBy }}</td>
            <td>{{ p.lastObservation }}</td>
            <td>
              <span class="badge approved">{{ p.status }}</span>
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
          <p class="section-kicker">PARK COVERAGE</p>
          <h2>Species Distribution</h2>
        </div>
        <button class="secondary-button" @click="go('conservation-map')">Open Full Map →</button>
      </header>
      <div class="map-panel mini">
        <div class="river"></div>
        <span class="zone-label" style="left: 8%; top: 13%">ZONE A</span
        ><span class="zone-label" style="left: 48%; top: 16%">ZONE B</span
        ><span class="zone-label" style="right: 8%; bottom: 12%">ZONE C</span
        ><button
          v-for="p in conservationStore.plants"
          :key="p.id"
          class="map-marker"
          :class="speciesForPlant(p.id)?.status.toLowerCase().replaceAll(' ', '-')"
          :style="{ left: p.x + '%', top: p.y + '%' }"
          @click="go('conservation-map', { plant: p.id })"
        >
          <span></span><small>{{ p.id }}</small>
        </button>
      </div>
    </section>
    <section class="panel">
      <header class="panel-header">
        <div>
          <p class="section-kicker">ATTENTION REQUIRED</p>
          <h2>Conservation Alerts</h2>
        </div>
        <button class="secondary-button" @click="go('conservation-alerts')">
          View All Alerts →
        </button>
      </header>
      <article v-for="a in conservationStore.alerts.slice(0, 3)" :key="a.id" class="alert-preview">
        <div>
          <strong>{{ a.type }}</strong
          ><small>{{ a.id }} · {{ a.plantId }} · {{ a.zone }}</small>
        </div>
        <span class="badge" :class="a.severity.toLowerCase()">{{ a.severity }}</span>
      </article>
    </section>
  </div>
  <section class="panel">
    <header class="panel-header">
      <div>
        <p class="section-kicker">SHORTCUTS</p>
        <h2>Quick Actions</h2>
      </div>
    </header>
    <div class="quick-grid">
      <button @click="go('conservation-species', { action: 'add' })">
        ＋
        <span
          ><strong>Add Plant Species</strong><small>Create a species record</small></span
        ></button
      ><button @click="go('conservation-reviews')">
        ✓ <span><strong>Review Observations</strong><small>Verify submissions</small></span></button
      ><button @click="go('conservation-observations')">
        ⌕ <span><strong>Search Plants</strong><small>Find observation records</small></span></button
      ><button @click="go('conservation-reports')">
        ▤ <span><strong>Generate Report</strong><small>Create a summary</small></span>
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
.mini {
  height: 285px;
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
</style>
