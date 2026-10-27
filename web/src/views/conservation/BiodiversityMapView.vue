<script setup lang="ts">
import { useConservationText } from '../../composables/useConservationText'
const { ct, dt, locale } = useConservationText()
import 'leaflet/dist/leaflet.css'
import * as L from 'leaflet'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppModal from '../../components/conservation/AppModal.vue'
import { formatPlantId } from '../../utils/plantId'

interface ApiPlant {
  plant_id: string | number
  species_id: string | number
  scientific_name?: string | null
  common_name?: string | null
  genus_name?: string | null
  family_name?: string | null
  current_status?: string | null
  latitude?: string | number | null
  longitude?: string | number | null
  accuracy_m?: string | number | null
  location_recorded_at?: string | null
}

interface PlantsResponse {
  plants?: ApiPlant[]
  message?: string
}

interface MapPlant {
  numericId: number
  id: string
  speciesId: string
  scientificName: string
  commonName: string
  genus: string
  family: string
  status: string
  latitude: number
  longitude: number
  accuracyM: number | null
  locationRecordedAt: string
}

const route = useRoute()
const router = useRouter()
const search = ref('')
const species = ref('')
const status = ref('')
const zone = ref('')
const plantStatus = ref('')
const plants = ref<MapPlant[]>([])
const selected = ref<MapPlant | null>(null)
const history = ref(false)
const isLoading = ref(true)
const loadError = ref('')
const mapElement = ref<HTMLElement | null>(null)
let map: L.Map | null = null
let markerLayer: L.LayerGroup | null = null
let resizeObserver: ResizeObserver | null = null
let resizeFrame: number | null = null
let settleTimer: ReturnType<typeof setTimeout> | null = null
const markers = new Map<string, L.Marker>()

const filtered = computed(() =>
  plants.value.filter((plant) => {
    const query = search.value.trim().toLowerCase()
    return (
      (!query ||
        plant.id.toLowerCase().includes(query) ||
        plant.scientificName.toLowerCase().includes(query) ||
        plant.commonName.toLowerCase().includes(query)) &&
      (!species.value || plant.speciesId === species.value) &&
      (!status.value || plant.status === status.value) &&
      (!plantStatus.value || plant.status === plantStatus.value)
    )
  }),
)
const hasCoordinates = (plant: MapPlant) =>
  Number.isFinite(plant.latitude) &&
  plant.latitude >= -90 &&
  plant.latitude <= 90 &&
  Number.isFinite(plant.longitude) &&
  plant.longitude >= -180 &&
  plant.longitude <= 180
const mappedPlants = computed(() => filtered.value.filter(hasCoordinates))
const unmappedPlantCount = computed(() => filtered.value.length - mappedPlants.value.length)
const speciesRecorded = computed(
  () => new Set(plants.value.map((plant) => plant.speciesId).filter(Boolean)).size,
)
const speciesOptions = computed(() => {
  const options = new Map<string, string>()
  plants.value.forEach((plant) =>
    options.set(plant.speciesId, plant.commonName || plant.scientificName || plant.speciesId),
  )
  return [...options].map(([id, name]) => ({ id, name }))
})
const plantStatuses = computed(() => [
  ...new Set(plants.value.map((plant) => plant.status).filter(Boolean)),
])

const numericValue = (value: string | number | null | undefined) => {
  if (value === null || value === undefined || value === '') return Number.NaN
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}
const displayValue = (value: string) => value || '—'
const coordinateValue = (value: number) => (Number.isFinite(value) ? value : '—')
const accuracyValue = (plant: MapPlant) =>
  plant.accuracyM === null ? '—' : `${plant.accuracyM} m`
const loadPlants = async () => {
  isLoading.value = true
  loadError.value = ''

  try {
    const response = await fetch('/api/plants')
    const result: PlantsResponse = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.message || 'Unable to load plant locations.')

    plants.value = (Array.isArray(result.plants) ? result.plants : [])
      .map((item): MapPlant | null => {
        const numericId = Number(item.plant_id)
        const id = formatPlantId(item.plant_id)
        if (!id || !Number.isSafeInteger(numericId) || numericId <= 0) return null

        const accuracy = numericValue(item.accuracy_m)
        return {
          numericId,
          id,
          speciesId: String(item.species_id ?? ''),
          scientificName: item.scientific_name || 'Identification pending',
          commonName: item.common_name || 'Common name unavailable',
          genus: item.genus_name || '',
          family: item.family_name || '',
          status: item.current_status || '',
          latitude: numericValue(item.latitude),
          longitude: numericValue(item.longitude),
          accuracyM: Number.isFinite(accuracy) ? accuracy : null,
          locationRecordedAt: item.location_recorded_at || '',
        }
      })
      .filter((plant): plant is MapPlant => plant !== null)
  } catch (error) {
    plants.value = []
    loadError.value =
      error instanceof Error ? error.message : 'An unexpected error occurred while loading plants.'
  } finally {
    isLoading.value = false
  }
}
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
const popupContent = (plant: MapPlant) => {
  const root = document.createElement('article')
  root.className = 'plant-popup-card'
  appendText(root, 'strong', plant.id, 'plant-popup-id')
  appendText(root, 'em', plant.scientificName, 'plant-popup-scientific')
  appendText(root, 'span', plant.commonName, 'plant-popup-common')
  const details = document.createElement('dl')
  const addDetail = (label: string, value: string) => {
    const row = document.createElement('div')
    appendText(row, 'dt', label)
    appendText(row, 'dd', value)
    details.appendChild(row)
  }
  addDetail(ct('Genus'), displayValue(plant.genus))
  addDetail(ct('Status'), displayValue(plant.status))
  addDetail(ct('Family'), displayValue(plant.family))
  addDetail(ct('GPS Accuracy'), accuracyValue(plant))
  addDetail(ct('Recorded'), plant.locationRecordedAt ? dt(plant.locationRecordedAt) : '—')
  root.appendChild(details)
  const actions = document.createElement('div')
  actions.className = 'plant-popup-actions'
  const detailsButton = appendText(actions, 'button', ct('View Plant Details'))
  detailsButton.type = 'button'
  detailsButton.addEventListener(
    'click',
    () => void router.push(`/plant/${plant.id}`),
  )
  const mapsLink = appendText(actions, 'a', ct('Open in Google Maps'))
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
const selectPlant = (plant: MapPlant, center = true) => {
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
      title: `${plant.id}: ${plant.scientificName}`,
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
  if (selected.value) markers.get(selected.value.id)?.openPopup()
  const zoomIn = mapElement.value?.querySelector('.leaflet-control-zoom-in')
  const zoomOut = mapElement.value?.querySelector('.leaflet-control-zoom-out')
  zoomIn?.setAttribute('title', ct('Zoom in'))
  zoomIn?.setAttribute('aria-label', ct('Zoom in'))
  zoomOut?.setAttribute('title', ct('Zoom out'))
  zoomOut?.setAttribute('aria-label', ct('Zoom out'))
}
const focus = async (plant: MapPlant) => {
  await nextTick()
  mapElement.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  selectPlant(plant)
}
const openHistory = (plant: MapPlant) => {
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
  await loadPlants()
})
watch([mappedPlants, locale], () => {
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
      <p class="page-kicker">{{ ct('SPATIAL RECORDS') }}</p>
      <h2>{{ ct('Biodiversity Map') }}</h2>
      <p>{{ ct('Visualise internal plant records with exact authorised coordinates.') }}</p>
    </div>
  </section>
  <div class="control-bar">
    <label class="field search-field"
      ><span>{{ ct('Plant ID') }}</span
      ><input v-model="search" placeholder="Search PL001"
    /></label>
    <label class="field"
      ><span>{{ ct('Species') }}</span
      ><select v-model="species">
        <option value="">{{ ct('All species') }}</option>
        <option v-for="item in speciesOptions" :key="item.id" :value="item.id">
          {{ item.name }}
        </option>
      </select></label
    >
    <label class="field"
      ><span>{{ ct('Conservation status') }}</span
      ><select v-model="status" disabled>
        <option value="">{{ ct('All statuses') }}</option>
      </select></label
    >
    <label class="field"
      ><span>{{ ct('Zone') }}</span
      ><select v-model="zone" disabled>
        <option value="">{{ ct('All zones') }}</option>
      </select></label
    >
    <label class="field"
      ><span>{{ ct('Plant status') }}</span
      ><select v-model="plantStatus">
        <option value="">{{ ct('All statuses') }}</option>
        <option v-for="item in plantStatuses" :key="item" :value="item">{{ ct(item) }}</option>
      </select></label
    >
  </div>
  <section class="panel map-card">
    <div class="map-shell">
      <div
        ref="mapElement"
        class="biodiversity-map"
        :aria-label="ct('Interactive biodiversity map')"
      ></div>
      <div class="map-summary" :aria-label="ct('Biodiversity map summary')">
        <article>
          <span aria-hidden="true">♣</span>
          <div>
            <small>{{ ct('Plant records') }}</small
            ><strong>{{ plants.length }}</strong>
          </div>
        </article>
        <article>
          <span aria-hidden="true">◉</span>
          <div>
            <small>{{ ct('Species recorded') }}</small
            ><strong>{{ speciesRecorded }}</strong>
          </div>
        </article>
        <article>
          <span aria-hidden="true">!</span>
          <div>
            <small>{{ ct('Active threats') }}</small
            ><strong>—</strong>
          </div>
        </article>
      </div>
      <button
        class="fit-map-button"
        type="button"
        :title="ct('Fit all visible plants')"
        @click="fitVisiblePlants"
      >
        <span aria-hidden="true">⌖</span><span>{{ ct('Fit visible plants') }}</span>
      </button>
      <div v-if="isLoading" class="map-empty" role="status">
        {{ ct('Loading plant locations...') }}
      </div>
      <div v-else-if="loadError" class="map-empty" role="alert">
        {{ loadError }}
      </div>
      <div v-else-if="!mappedPlants.length" class="map-empty" role="status">
        {{ ct('No plants with valid coordinates match the selected filters.') }}
      </div>
    </div>
    <p v-if="unmappedPlantCount" class="coordinate-note">
      {{
        ct('{count} filtered records are not shown because coordinates are unavailable.', {
          count: unmappedPlantCount,
        })
      }}
    </p>
    <div v-if="selected" class="selected-card">
      <div class="panel-header">
        <div>
          <h3>{{ selected.id }} · {{ selected.scientificName }}</h3>
          <span class="panel-description"
            >{{ selected.commonName }} · {{ displayValue(selected.genus) }}</span
          >
        </div>
        <div class="selection-actions">
          <a
            class="secondary-button"
            :href="`https://www.google.com/maps/search/?api=1&query=${selected.latitude},${selected.longitude}`"
            target="_blank"
            rel="noopener noreferrer"
            >{{ ct('Open in Google Maps') }}</a
          ><button class="secondary-button" type="button" @click="history = true">
            {{ ct('View History') }}
          </button>
        </div>
      </div>
      <dl class="detail-list">
        <div>
          <dt>{{ ct('Coordinates') }}</dt>
          <dd>{{ selected.latitude }}, {{ selected.longitude }}</dd>
        </div>
        <div>
          <dt>{{ ct('Current Status') }}</dt>
          <dd>{{ displayValue(selected.status) }}</dd>
        </div>
        <div>
          <dt>{{ ct('GPS Accuracy') }}</dt>
          <dd>{{ accuracyValue(selected) }}</dd>
        </div>
        <div>
          <dt>{{ ct('Location Recorded') }}</dt>
          <dd>{{ selected.locationRecordedAt ? dt(selected.locationRecordedAt) : '—' }}</dd>
        </div>
      </dl>
    </div>
  </section>
  <section class="panel">
    <header class="panel-header">
      <div>
        <h2>{{ ct('Mapped Plant Records') }}</h2>
        <span class="panel-description">{{
          ct('Coordinates are restricted to authorised internal users.')
        }}</span>
      </div>
    </header>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{{ ct('Plant ID') }}</th>
            <th>{{ ct('Species') }}</th>
            <th>{{ ct('Genus / Family') }}</th>
            <th>{{ ct('Latitude') }}</th>
            <th>{{ ct('Longitude') }}</th>
            <th>{{ ct('Current Status') }}</th>
            <th>{{ ct('GPS / Recorded') }}</th>
            <th>{{ ct('Actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="plant in filtered" :key="plant.id">
            <td>
              <strong>{{ plant.id }}</strong>
            </td>
            <td>
              <em>{{ plant.scientificName }}</em>
            </td>
            <td>{{ displayValue(plant.genus) }} / {{ displayValue(plant.family) }}</td>
            <td>{{ coordinateValue(plant.latitude) }}</td>
            <td>{{ coordinateValue(plant.longitude) }}</td>
            <td>
              <span
                class="badge"
                :class="plant.status.toLowerCase().replaceAll(' ', '-')"
                >{{ displayValue(plant.status) }}</span
              >
            </td>
            <td>
              {{ accuracyValue(plant) }} /
              {{ plant.locationRecordedAt ? dt(plant.locationRecordedAt) : '—' }}
            </td>
            <td>
              <div class="action-group">
                <button class="action-button" type="button" @click="selectPlant(plant, false)">
                  {{ ct('View') }}</button
                ><button class="action-button" type="button" @click="focus(plant)">
                  {{ ct('Focus on Map') }}</button
                ><button class="action-button" type="button" @click="openHistory(plant)">
                  {{ ct('History') }}
                </button>
              </div>
            </td>
          </tr>
          <tr v-if="!filtered.length">
            <td class="empty-row" colspan="8">
              {{ ct('No plant records match the selected filters.') }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
  <AppModal
    v-if="history && selected"
    :title="ct('{id} History', { id: selected.id })"
    :subtitle="selected.scientificName"
    wide
    @close="history = false"
  >
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{{ ct('Observation') }}</th>
            <th>{{ ct('Date') }}</th>
            <th>{{ ct('Height') }}</th>
            <th>{{ ct('Health') }}</th>
            <th>{{ ct('Status') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="empty-row" colspan="5">
              {{ ct('Observation history is not included in the plant location response.') }}
            </td>
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
        {{ ct('View Plant Observations') }}
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
  isolation: isolate;
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
