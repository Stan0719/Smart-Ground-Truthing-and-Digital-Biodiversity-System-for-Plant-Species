<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppModal from '../../components/conservation/AppModal.vue'
import { conservationStore, speciesForPlant, type PlantRecord } from '../../data/conservation'
const route = useRoute(),
  router = useRouter(),
  search = ref(''),
  species = ref(''),
  status = ref(''),
  zone = ref(''),
  plantStatus = ref(''),
  selected = ref<PlantRecord | null>(null),
  history = ref(false)
const filtered = computed(() =>
  conservationStore.plants.filter(
    (p) =>
      p.id.toLowerCase().includes(search.value.toLowerCase()) &&
      (!species.value || p.speciesId === species.value) &&
      (!status.value || speciesForPlant(p.id)?.status === status.value) &&
      (!zone.value || p.zone === zone.value) &&
      (!plantStatus.value || p.status === plantStatus.value),
  ),
)
function focus(p: PlantRecord) {
  selected.value = p
  document.querySelector('.map-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}
onMounted(() => {
  const p = conservationStore.plants.find((x) => x.id === route.query.plant)
  if (p) focus(p)
})
</script>
<template>
  <section class="page-intro">
    <div>
      <p class="page-kicker">SPATIAL RECORDS</p>
      <h2>Biodiversity Map</h2>
      <p>Visualise internal plant records with exact authorised coordinates.</p>
    </div>
  </section>
  <div class="control-bar">
    <label class="field search-field"
      ><span>Plant ID</span><input v-model="search" placeholder="Search PL001" /></label
    ><label class="field"
      ><span>Species</span
      ><select v-model="species">
        <option value="">All species</option>
        <option v-for="s in conservationStore.species" :key="s.id" :value="s.id">
          {{ s.commonName }}
        </option>
      </select></label
    ><label class="field"
      ><span>Conservation status</span
      ><select v-model="status">
        <option value="">All statuses</option>
        <option v-for="s in [...new Set(conservationStore.species.map((x) => x.status))]" :key="s">
          {{ s }}
        </option>
      </select></label
    ><label class="field"
      ><span>Zone</span
      ><select v-model="zone">
        <option value="">All zones</option>
        <option>Zone A</option>
        <option>Zone B</option>
        <option>Zone C</option>
      </select></label
    ><label class="field"
      ><span>Plant status</span
      ><select v-model="plantStatus">
        <option value="">All statuses</option>
        <option>Protected</option>
        <option>Monitored</option>
        <option>Stable</option>
      </select></label
    >
  </div>
  <section class="panel">
    <div class="map-panel">
      <div class="river"></div>
      <span class="zone-label" style="left: 8%; top: 13%">ZONE A</span
      ><span class="zone-label" style="left: 48%; top: 16%">ZONE B</span
      ><span class="zone-label" style="right: 8%; bottom: 12%">ZONE C</span
      ><button
        v-for="p in filtered"
        :key="p.id"
        class="map-marker"
        :class="[
          speciesForPlant(p.id)?.status.toLowerCase().replaceAll(' ', '-'),
          { selected: selected?.id === p.id },
        ]"
        :style="{ left: p.x + '%', top: p.y + '%' }"
        :aria-label="`View ${p.id}`"
        @click="selected = p"
      >
        <span></span><small>{{ p.id }}</small>
      </button>
    </div>
    <div v-if="selected" class="selected-card">
      <div class="panel-header">
        <div>
          <h3>{{ selected.id }} · {{ speciesForPlant(selected.id)?.scientificName }}</h3>
          <span class="panel-description"
            >{{ speciesForPlant(selected.id)?.commonName }} · {{ selected.zone }}</span
          >
        </div>
        <button class="secondary-button" @click="history = true">View History</button>
      </div>
      <dl class="detail-list">
        <div>
          <dt>Coordinates</dt>
          <dd>{{ selected.latitude }}, {{ selected.longitude }}</dd>
        </div>
        <div>
          <dt>Conservation Status</dt>
          <dd>{{ speciesForPlant(selected.id)?.status }}</dd>
        </div>
        <div>
          <dt>Last Observation</dt>
          <dd>{{ selected.lastObservation }}</dd>
        </div>
        <div>
          <dt>Health</dt>
          <dd>{{ selected.health }}</dd>
        </div>
      </dl>
    </div>
  </section>
  <section class="panel">
    <header class="panel-header">
      <div>
        <h2>Mapped Plant Records</h2>
        <span class="panel-description"
          >Coordinates are restricted to authorised internal users.</span
        >
      </div>
    </header>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Plant ID</th>
            <th>Species</th>
            <th>Location / Zone</th>
            <th>Latitude</th>
            <th>Longitude</th>
            <th>Conservation Status</th>
            <th>Last Observation</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in filtered" :key="p.id">
            <td>
              <strong>{{ p.id }}</strong>
            </td>
            <td>
              <em>{{ speciesForPlant(p.id)?.scientificName }}</em>
            </td>
            <td>{{ p.location }} / {{ p.zone }}</td>
            <td>{{ p.latitude }}</td>
            <td>{{ p.longitude }}</td>
            <td>
              <span
                class="badge"
                :class="speciesForPlant(p.id)?.status.toLowerCase().replaceAll(' ', '-')"
                >{{ speciesForPlant(p.id)?.status }}</span
              >
            </td>
            <td>{{ p.lastObservation }}</td>
            <td>
              <div class="action-group">
                <button class="action-button" @click="selected = p">View</button
                ><button class="action-button" @click="focus(p)">Focus on Map</button
                ><button class="action-button" @click="((selected = p), (history = true))">
                  History
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
  <AppModal
    v-if="history && selected"
    :title="`${selected.id} History`"
    :subtitle="speciesForPlant(selected.id)?.scientificName"
    wide
    @close="history = false"
    ><div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Observation</th>
            <th>Date</th>
            <th>Height</th>
            <th>Health</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="o in conservationStore.observations.filter((x) => x.plantId === selected?.id)"
            :key="o.id"
          >
            <td>{{ o.id }}</td>
            <td>{{ o.observedAt }}</td>
            <td>{{ o.height }}</td>
            <td>{{ o.health }}</td>
            <td>{{ o.status }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="modal-actions">
      <button
        class="primary-button"
        @click="router.push({ name: 'conservation-observations', query: { plant: selected?.id } })"
      >
        View Plant Observations
      </button>
    </div></AppModal
  >
</template>
