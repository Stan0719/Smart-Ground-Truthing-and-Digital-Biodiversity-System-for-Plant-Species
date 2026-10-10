<script setup lang="ts">
import 'leaflet/dist/leaflet.css'
import * as L from 'leaflet'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppModal from '../../components/conservation/AppModal.vue'
import {
  conservationStore,
  speciesForPlant,
  speciesRequestForPlant,
  type PlantRecord,
} from '../../data/conservation'

const route = useRoute()
const router = useRouter()
const search = ref('')
const species = ref('')
const status = ref('')
const zone = ref('')
const plantStatus = ref('')
const selected = ref<PlantRecord | null>(null)
const history = ref(false)
const mapElement = ref<HTMLElement | null>(null)
let map: L.Map | null = null
let markerLayer: L.LayerGroup | null = null
let resizeObserver: ResizeObserver | null = null
let resizeFrame: number | null = null
let settleTimer: ReturnType<typeof setTimeout> | null = null
const markers = new Map<string, L.Marker>()

const filtered = computed(() =>
  conservationStore.plants.filter(
    (plant) =>
      plant.id.toLowerCase().includes(search.value.trim().toLowerCase()) &&
      (!species.value || plant.speciesId === species.value) &&
      (!status.value || speciesForPlant(plant.id)?.status === status.value) &&
      (!zone.value || plant.zone === zone.value) &&
      (!plantStatus.value || plant.status === plantStatus.value),
  ),
)
const hasCoordinates = (plant: PlantRecord) =>
  Number.isFinite(plant.latitude) && Number.isFinite(plant.longitude)
const mappedPlants = computed(() => filtered.value.filter(hasCoordinates))
const unmappedPlantCount = computed(() => filtered.value.length - mappedPlants.value.length)
const speciesRecorded = computed(
  () => new Set(conservationStore.plants.map((plant) => plant.speciesId).filter(Boolean)).size,
)
const activeThreats = computed(
  () => conservationStore.alerts.filter((alert) => alert.status !== 'Resolved').length,
)
const conservationStatuses = computed(() => [
  ...new Set(conservationStore.species.map((item) => item.status)),
])

const plantIdentity = (plant: PlantRecord) => {
  const known = speciesForPlant(plant.id)
  const request = speciesRequestForPlant(plant.id)
  return {
    scientificName:
      known?.scientificName ?? request?.proposedScientificName ?? 'Identification pending',
    commonName: known?.commonName ?? request?.proposedCommonName ?? 'Common name unavailable',
    conservationStatus: known?.status ?? request?.status ?? 'Not assessed',
  }
}
const activeThreatFor = (plant: PlantRecord) =>
  conservationStore.alerts.find(
    (alert) => alert.plantId === plant.id && alert.status !== 'Resolved',
  )
const markerIcon = () =>
  L.divIcon({
    className: 'plant-marker-host',
    html: `<span class="plant-marker-pin" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 20v-5m0 0c-4.8 0-7-2.7-7-6.7 3.8-.5 6.4.9 7 4.1.6-3.2 3.2-4.6 7-4.1 0 4-2.2 6.7-7 6.7Z"/></svg></span>`,
    iconSize: [38, 46],
    iconAnchor: [19, 44],
    popupAnchor: [0, -42],
  })
const appendText = <Tag extends keyof HTMLElementTagNameMap>(
  parent: HTMLElement,
  tag: Tag,
  value: string,
  className?: string,
): HTMLElementTagNameMap[Tag] => {
  const element = document.createElement(tag)
  element.textContent = value
  if (className) element.className = className
  parent.appendChild(element)
  return element
}
const popupContent = (plant: PlantRecord) => {
  const identity = plantIdentity(plant)
  const threat = activeThreatFor(plant)
  const root = document.createElement('article')
  root.className = 'plant-popup-card'
  appendText(root, 'strong', plant.id, 'plant-popup-id')
  appendText(root, 'em', identity.scientificName, 'plant-popup-scientific')
  appendText(root, 'span', identity.commonName, 'plant-popup-common')
  const details = document.createElement('dl')
  const addDetail = (label: string, value: string) => {
    const row = document.createElement('div')
    appendText(row, 'dt', label)
    appendText(row, 'dd', value)
    details.appendChild(row)
  }
  addDetail('Status', identity.conservationStatus)
  addDetail('Health', plant.health)
  addDetail('Location', `${plant.location} · ${plant.zone}`)
  addDetail('Last observation', plant.lastObservation)
  root.appendChild(details)
  if (threat)
    appendText(root, 'p', `${threat.severity} threat: ${threat.type}`, 'plant-popup-threat')
  const actions = document.createElement('div')
  actions.className = 'plant-popup-actions'
  const detailsButton = appendText(actions, 'button', 'View Plant Details')
  detailsButton.type = 'button'
  detailsButton.addEventListener(
    'click',
    () => void router.push({ name: 'conservation-observations', query: { plant: plant.id } }),
  )
  const mapsLink = appendText(actions, 'a', 'Open in Google Maps')
  mapsLink.href = `https://www.google.com/maps/search/?api=1&query=${plant.latitude},${plant.longitude}`
  mapsLink.target = '_blank'
  mapsLink.rel = 'noopener noreferrer'
  root.appendChild(actions)
  return root
}
const highlightSelectedMarker = () =>
  markers.forEach((marker, id) =>
    marker.getElement()?.classList.toggle('is-selected', selected.value?.id === id),
  )
const selectPlant = (plant: PlantRecord, center = true) => {
  if (!hasCoordinates(plant) || !map) return

  selected.value = plant

  if (center) {
    // setView works even when the map does not yet have
    // an initial center/zoom.
    map.setView([plant.latitude, plant.longitude], 17, {
      animate: false,
    })
  }

  map.whenReady(() => {
    markers.get(plant.id)?.openPopup()
    highlightSelectedMarker()
  })
}

const fitVisiblePlants = () => {
  if (!map || !mappedPlants.value.length) return
  const bounds = L.latLngBounds(
    mappedPlants.value.map((plant) => [plant.latitude, plant.longitude] as L.LatLngTuple),
  )
  map.fitBounds(bounds, { padding: [48, 48], maxZoom: 17 })
}
const renderMarkers = () => {
  if (!markerLayer) return
  markerLayer.clearLayers()
  markers.clear()
  mappedPlants.value.forEach((plant) => {
    const marker = L.marker([plant.latitude, plant.longitude], {
      icon: markerIcon(),
      title: `${plant.id}: ${plantIdentity(plant).scientificName}`,
      riseOnHover: true,
    })
      .bindPopup(popupContent(plant), { maxWidth: 320, minWidth: 250 })
      .on('click', () => {
        selected.value = plant
        highlightSelectedMarker()
      })
      .addTo(markerLayer!)
    markers.set(plant.id, marker)
  })
  highlightSelectedMarker()
}
const focus = async (plant: PlantRecord) => {
  await nextTick()
  mapElement.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  selectPlant(plant)
}
const openHistory = (plant: PlantRecord) => {
  selected.value = plant
  history.value = true
}
const selectFromRoute = () => {
  const plantId = typeof route.query.plant === 'string' ? route.query.plant : ''
  const plant = mappedPlants.value.find((item) => item.id === plantId)
  if (plant) selectPlant(plant)
}

const scheduleMapRefresh = (applyRouteSelection = false) => {
  if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = null
    if (!map) return
    map.invalidateSize({ pan: false })
    if (applyRouteSelection && route.query.plant) selectFromRoute()
    else if (applyRouteSelection) fitVisiblePlants()
  })
}

onMounted(async () => {
  await nextTick()
  if (!mapElement.value || map) return
  map = L.map(mapElement.value, { zoomControl: true, minZoom: 3 })
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      maxZoom: 20,
      maxNativeZoom: 19,
      attribution:
        'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    },
  ).addTo(map)
  markerLayer = L.layerGroup().addTo(map)
  renderMarkers()
  resizeObserver = new ResizeObserver(() => scheduleMapRefresh())
  resizeObserver.observe(mapElement.value)
  await nextTick()
  scheduleMapRefresh(true)
  settleTimer = setTimeout(() => {
    map?.invalidateSize({ pan: false })
  }, 150)
})
watch(mappedPlants, () => {
  renderMarkers()
  if (selected.value && !mappedPlants.value.some((plant) => plant.id === selected.value?.id))
    selected.value = null
  scheduleMapRefresh(true)
})
watch(
  () => route.query.plant,
  () => scheduleMapRefresh(true),
)
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null

  if (resizeFrame !== null) {
    cancelAnimationFrame(resizeFrame)
  }
  resizeFrame = null

  if (settleTimer) {
    clearTimeout(settleTimer)
  }
  settleTimer = null

  markerLayer?.clearLayers()
  markerLayer = null

  map?.off()
  map?.remove()
  map = null

  markers.clear()
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
      ><span>Plant ID</span><input v-model="search" placeholder="Search PL001"
    /></label>
    <label class="field"
      ><span>Species</span
      ><select v-model="species">
        <option value="">All species</option>
        <option v-for="item in conservationStore.species" :key="item.id" :value="item.id">
          {{ item.commonName }}
        </option>
      </select></label
    >
    <label class="field"
      ><span>Conservation status</span
      ><select v-model="status">
        <option value="">All statuses</option>
        <option v-for="item in conservationStatuses" :key="item">{{ item }}</option>
      </select></label
    >
    <label class="field"
      ><span>Zone</span
      ><select v-model="zone">
        <option value="">All zones</option>
        <option>Zone A</option>
        <option>Zone B</option>
        <option>Zone C</option>
      </select></label
    >
    <label class="field"
      ><span>Plant status</span
      ><select v-model="plantStatus">
        <option value="">All statuses</option>
        <option>Protected</option>
        <option>Monitored</option>
        <option>Stable</option>
      </select></label
    >
  </div>
  <section class="panel map-card">
    <div class="map-shell">
      <div
        ref="mapElement"
        class="biodiversity-map"
        aria-label="Interactive biodiversity map"
      ></div>
      <div class="map-summary" aria-label="Biodiversity map summary">
        <article>
          <span aria-hidden="true">♣</span>
          <div>
            <small>Plant records</small><strong>{{ conservationStore.plants.length }}</strong>
          </div>
        </article>
        <article>
          <span aria-hidden="true">◉</span>
          <div>
            <small>Species recorded</small><strong>{{ speciesRecorded }}</strong>
          </div>
        </article>
        <article>
          <span aria-hidden="true">!</span>
          <div>
            <small>Active threats</small><strong>{{ activeThreats }}</strong>
          </div>
        </article>
      </div>
      <button
        class="fit-map-button"
        type="button"
        title="Fit all visible plants"
        @click="fitVisiblePlants"
      >
        <span aria-hidden="true">⌖</span><span>Fit visible plants</span>
      </button>
      <div v-if="!mappedPlants.length" class="map-empty" role="status">
        No plants with valid coordinates match the selected filters.
      </div>
    </div>
    <p v-if="unmappedPlantCount" class="coordinate-note">
      {{ unmappedPlantCount }} filtered
      {{ unmappedPlantCount === 1 ? 'record is' : 'records are' }} not shown because coordinates are
      unavailable.
    </p>
    <div v-if="selected" class="selected-card">
      <div class="panel-header">
        <div>
          <h3>{{ selected.id }} · {{ plantIdentity(selected).scientificName }}</h3>
          <span class="panel-description"
            >{{ plantIdentity(selected).commonName }} · {{ selected.zone }}</span
          >
        </div>
        <div class="selection-actions">
          <a
            class="secondary-button"
            :href="`https://www.google.com/maps/search/?api=1&query=${selected.latitude},${selected.longitude}`"
            target="_blank"
            rel="noopener noreferrer"
            >Open in Google Maps</a
          ><button class="secondary-button" type="button" @click="history = true">
            View History
          </button>
        </div>
      </div>
      <dl class="detail-list">
        <div>
          <dt>Coordinates</dt>
          <dd>{{ selected.latitude }}, {{ selected.longitude }}</dd>
        </div>
        <div>
          <dt>Conservation Status</dt>
          <dd>{{ plantIdentity(selected).conservationStatus }}</dd>
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
          <tr v-for="plant in filtered" :key="plant.id">
            <td>
              <strong>{{ plant.id }}</strong>
            </td>
            <td>
              <em>{{ plantIdentity(plant).scientificName }}</em>
            </td>
            <td>{{ plant.location }} / {{ plant.zone }}</td>
            <td>{{ plant.latitude }}</td>
            <td>{{ plant.longitude }}</td>
            <td>
              <span
                class="badge"
                :class="plantIdentity(plant).conservationStatus.toLowerCase().replaceAll(' ', '-')"
                >{{ plantIdentity(plant).conservationStatus }}</span
              >
            </td>
            <td>{{ plant.lastObservation }}</td>
            <td>
              <div class="action-group">
                <button class="action-button" type="button" @click="selectPlant(plant, false)">
                  View</button
                ><button class="action-button" type="button" @click="focus(plant)">
                  Focus on Map</button
                ><button class="action-button" type="button" @click="openHistory(plant)">
                  History
                </button>
              </div>
            </td>
          </tr>
          <tr v-if="!filtered.length">
            <td class="empty-row" colspan="8">No plant records match the selected filters.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
  <AppModal
    v-if="history && selected"
    :title="`${selected.id} History`"
    :subtitle="plantIdentity(selected).scientificName"
    wide
    @close="history = false"
  >
    <div class="table-scroll">
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
            v-for="observation in conservationStore.observations.filter(
              (item) => item.plantId === selected?.id,
            )"
            :key="observation.id"
          >
            <td>{{ observation.id }}</td>
            <td>{{ observation.observedAt }}</td>
            <td>{{ observation.height }}</td>
            <td>{{ observation.health }}</td>
            <td>{{ observation.status }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="modal-actions">
      <button
        class="primary-button"
        type="button"
        @click="router.push({ name: 'conservation-observations', query: { plant: selected?.id } })"
      >
        View Plant Observations
      </button>
    </div>
  </AppModal>
</template>

<style scoped>
.map-card {
  padding: 0;
  overflow: hidden;
}
.map-shell {
  position: relative;
  min-height: 620px;
  background: #dce8dc;
}
.biodiversity-map {
  width: 100%;
  min-height: 620px;
  z-index: 0;
}
.map-summary {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 500;
  display: grid;
  grid-template-columns: repeat(3, minmax(150px, 1fr));
  gap: 10px;
  pointer-events: none;
}
.map-summary article {
  min-width: 0;
  padding: 11px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid rgba(223, 231, 223, 0.9);
  border-radius: 13px;
  background: rgba(255, 255, 255, 0.95);
  box-shadow: 0 8px 22px rgba(24, 61, 47, 0.14);
}
.map-summary article > span {
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #e9f3e8;
  color: #4c8d56;
  font-weight: 800;
}
.map-summary small {
  display: block;
  color: #708178;
  font-size: 9px;
  font-weight: 700;
  white-space: nowrap;
}
.map-summary strong {
  display: block;
  margin-top: 2px;
  color: #173f34;
  font-size: 16px;
}
.fit-map-button {
  position: absolute;
  right: 14px;
  bottom: 24px;
  z-index: 500;
  padding: 9px 12px;
  display: flex;
  align-items: center;
  gap: 7px;
  border: 1px solid #d9e3da;
  border-radius: 9px;
  background: #fff;
  color: #326d55;
  box-shadow: 0 4px 14px rgba(24, 61, 47, 0.17);
  cursor: pointer;
  font: inherit;
  font-size: 9px;
  font-weight: 800;
}
.fit-map-button span:first-child {
  font-size: 17px;
}
.map-empty {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 500;
  width: min(360px, calc(100% - 32px));
  padding: 16px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.94);
  color: #60746b;
  font-size: 11px;
  text-align: center;
  transform: translate(-50%, -50%);
}
.coordinate-note {
  margin: 0;
  padding: 9px 18px;
  border-top: 1px solid #e3e9e3;
  background: #f8faf8;
  color: #77877f;
  font-size: 9px;
}
.selected-card {
  padding: 20px 23px 23px;
  border-top: 1px solid #e3e9e3;
}
.selection-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
.selection-actions a {
  text-decoration: none;
}
:deep(.leaflet-control-attribution) {
  max-width: min(72vw, 650px);
  font-size: 8px;
  white-space: normal;
}
:deep(.plant-marker-host) {
  background: transparent;
  border: 0;
}
:deep(.plant-marker-pin) {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border: 3px solid #fff;
  border-radius: 50% 50% 50% 7px;
  background: #65a556;
  color: #fff;
  box-shadow: 0 3px 9px rgba(16, 57, 33, 0.42);
  transform: rotate(-45deg);
  transition:
    transform 0.16s ease,
    background-color 0.16s ease;
}
:deep(.plant-marker-pin svg) {
  width: 22px;
  height: 22px;
  fill: currentColor;
  transform: rotate(45deg);
}
:deep(.plant-marker-host:hover .plant-marker-pin),
:deep(.plant-marker-host.is-selected .plant-marker-pin) {
  background: #246c45;
  transform: rotate(-45deg) scale(1.14);
}
:deep(.leaflet-popup-content-wrapper) {
  border-radius: 14px;
  box-shadow: 0 12px 32px rgba(17, 53, 39, 0.24);
}
:deep(.leaflet-popup-content) {
  margin: 16px;
}
:deep(.plant-popup-card) {
  display: grid;
  color: #425e54;
}
:deep(.plant-popup-id) {
  color: #173f34;
  font-size: 14px;
}
:deep(.plant-popup-scientific) {
  margin-top: 3px;
  color: #35624f;
  font-size: 12px;
}
:deep(.plant-popup-common) {
  margin-top: 2px;
  color: #7b8b83;
  font-size: 10px;
}
:deep(.plant-popup-card dl) {
  margin: 12px 0 0;
  display: grid;
  gap: 6px;
}
:deep(.plant-popup-card dl div) {
  display: grid;
  grid-template-columns: 90px 1fr;
  gap: 8px;
}
:deep(.plant-popup-card dt) {
  color: #8a9992;
  font-size: 8px;
  font-weight: 700;
  text-transform: uppercase;
}
:deep(.plant-popup-card dd) {
  margin: 0;
  color: #3e5d51;
  font-size: 9px;
  font-weight: 700;
}
:deep(.plant-popup-threat) {
  margin: 11px 0 0;
  padding: 7px 9px;
  border-radius: 7px;
  background: #f9e5e0;
  color: #a54235;
  font-size: 9px;
  font-weight: 700;
}
:deep(.plant-popup-actions) {
  margin-top: 12px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px;
}
:deep(.plant-popup-actions button),
:deep(.plant-popup-actions a) {
  padding: 7px 8px;
  border: 1px solid #cfdcd3;
  border-radius: 7px;
  background: #fff;
  color: #317057;
  cursor: pointer;
  font: inherit;
  font-size: 8px;
  font-weight: 800;
  text-align: center;
  text-decoration: none;
}
:deep(.plant-popup-actions button) {
  border-color: #32745b;
  background: #32745b;
  color: #fff;
}
@media (max-width: 900px) {
  .map-summary {
    left: 54px;
    right: 12px;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .map-summary article {
    padding: 9px;
  }
  .map-summary article > span {
    display: none;
  }
}
@media (max-width: 620px) {
  .map-shell,
  .biodiversity-map {
    min-height: 560px;
  }
  .map-summary {
    top: 10px;
    left: 48px;
    right: 8px;
    gap: 5px;
  }
  .map-summary article {
    padding: 8px 7px;
    border-radius: 9px;
  }
  .map-summary small {
    font-size: 7px;
    white-space: normal;
  }
  .map-summary strong {
    font-size: 13px;
  }
  .fit-map-button {
    right: 9px;
    bottom: 25px;
  }
  .fit-map-button span:last-child {
    display: none;
  }
  .selected-card {
    padding: 17px;
  }
  .selection-actions {
    justify-content: flex-start;
  }
  :deep(.plant-popup-actions) {
    grid-template-columns: 1fr;
  }
}
</style>
