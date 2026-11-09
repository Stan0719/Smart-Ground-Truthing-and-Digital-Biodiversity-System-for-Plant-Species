<script setup lang="ts">
import { useConservationText } from '../../composables/useConservationText'
import 'leaflet/dist/leaflet.css'
import * as L from 'leaflet'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppModal from '../../components/conservation/AppModal.vue'
import {
  enrichPlant,
  hasValidCoordinates,
  mapPlantContract,
  mapSpeciesContract,
  matchesPlantQuery,
  requestPlantApi,
  type EnrichedPlant,
  type SpeciesContract,
} from '../../services/plantIntegration'

const { ct, dt, locale } = useConservationText()
const route = useRoute()
const router = useRouter()
const search = ref('')
const speciesFilter = ref('')
const conservationFilter = ref('')
const statusFilter = ref('')
const plants = ref<EnrichedPlant[]>([])
const selected = ref<EnrichedPlant | null>(null)
const history = ref(false)
const isLoading = ref(true)
const loadError = ref('')
const speciesError = ref('')
const skippedPlants = ref(0)
const mapElement = ref<HTMLElement | null>(null)
let map: L.Map | null = null
let markerLayer: L.LayerGroup | null = null
let resizeObserver: ResizeObserver | null = null
let resizeFrame: number | null = null
let settleTimer: ReturnType<typeof setTimeout> | null = null
const markers = new Map<string, L.Marker>()

const display = (value: string | null | undefined) => value || ct('Unavailable')
// Display only: retain each original registration timestamp on the plant record.
const formatRegisteredAt = (value: string | null | undefined) => {
  if (!value) return ct('Unavailable')
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ct('Unavailable')
  return new Intl.DateTimeFormat(locale.value === 'ms' ? 'ms-MY' : locale.value, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(parsed)
}
const speciesName = (plant: EnrichedPlant) =>
  plant.species?.scientificName || plant.species?.commonName || ct('Unavailable')
const accuracy = (plant: EnrichedPlant) =>
  plant.accuracyM === null ? ct('Unavailable') : `${plant.accuracyM} m`
const filtered = computed(() => plants.value.filter((plant) =>
  matchesPlantQuery(plant, search.value) &&
  (!speciesFilter.value || plant.speciesId === speciesFilter.value) &&
  (!conservationFilter.value || plant.species?.conservationStatus === conservationFilter.value) &&
  (!statusFilter.value || plant.status === statusFilter.value),
))
const mappedPlants = computed(() => filtered.value.filter(hasValidCoordinates))
const unmappedPlantCount = computed(() => filtered.value.length - mappedPlants.value.length)
const speciesRecorded = computed(() => new Set(plants.value.map((plant) => plant.speciesId)).size)
const speciesOptions = computed(() => {
  const options = new Map<string, string>()
  plants.value.forEach((plant) => options.set(plant.speciesId,
    plant.species?.commonName || plant.species?.scientificName || plant.speciesId))
  return [...options].map(([id, name]) => ({ id, name }))
})
const conservationStatuses = computed(() => [
  ...new Set(plants.value.map((plant) => plant.species?.conservationStatus).filter((value): value is string => Boolean(value))),
])
const plantStatuses = computed(() => [
  ...new Set(plants.value.map((plant) => plant.status).filter(Boolean)),
])
const routePlantId = computed(() => typeof route.query.plant === 'string' ? route.query.plant : '')
const deepLinkMissing = computed(() =>
  !isLoading.value && !loadError.value && Boolean(routePlantId.value) &&
  !plants.value.some((plant) => plant.id === routePlantId.value || plant.displayId === routePlantId.value),
)

async function loadPlants() {
  isLoading.value = true
  loadError.value = ''
  speciesError.value = ''
  skippedPlants.value = 0
  try {
    const [plantResult, speciesResult] = await Promise.allSettled([
      requestPlantApi('/api/plants'),
      requestPlantApi('/api/species?scope=scientific'),
    ])
    if (plantResult.status === 'rejected') throw plantResult.reason
    if (!Array.isArray(plantResult.value.plants)) throw new Error('The plant service returned an invalid response.')

    const speciesById = new Map<string, SpeciesContract>()
    if (speciesResult.status === 'fulfilled' && Array.isArray(speciesResult.value.species)) {
      speciesResult.value.species.forEach((value) => {
        const item = mapSpeciesContract(value)
        if (item) speciesById.set(item.id, item)
      })
    } else {
      speciesError.value = speciesResult.status === 'rejected'
        ? speciesResult.reason instanceof Error ? speciesResult.reason.message : 'Species metadata is unavailable.'
        : 'The species service returned an invalid response.'
    }

    const mapped = plantResult.value.plants.map(mapPlantContract)
    skippedPlants.value = mapped.filter((plant) => plant === null).length
    plants.value = mapped.filter((plant): plant is NonNullable<typeof plant> => plant !== null)
      .map((plant) => enrichPlant(plant, speciesById))
    await nextTick()
    renderMarkers()
    selectFromRoute()
    if (!routePlantId.value) fitVisiblePlants()
  } catch (error) {
    plants.value = []
    loadError.value = error instanceof Error ? error.message : 'Unable to load plant locations.'
  } finally {
    isLoading.value = false
  }
}

const markerIcon = () => L.divIcon({
  className: 'plant-marker-host',
  html: '<span class="plant-marker-pin" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 20v-5m0 0c-4.8 0-7-2.7-7-6.7 3.8-.5 6.4.9 7 4.1.6-3.2 3.2-4.6 7-4.1 0 4-2.2 6.7-7 6.7Z"/></svg></span>',
  iconSize: [38, 46], iconAnchor: [19, 44], popupAnchor: [0, -42],
})
const appendText = <Tag extends keyof HTMLElementTagNameMap>(
  parent: HTMLElement, tag: Tag, value: string, className?: string,
) => {
  const element = document.createElement(tag)
  element.textContent = value
  if (className) element.className = className
  parent.appendChild(element)
  return element
}
const popupContent = (plant: EnrichedPlant) => {
  const root = document.createElement('article')
  root.className = 'plant-popup-card'
  appendText(root, 'strong', plant.displayId, 'plant-popup-id')
  appendText(root, 'em', speciesName(plant), 'plant-popup-scientific')
  appendText(root, 'span', plant.species?.commonName || ct('Unavailable'), 'plant-popup-common')
  const details = document.createElement('dl')
  const addDetail = (name: string, value: string) => {
    const row = document.createElement('div')
    appendText(row, 'dt', name)
    appendText(row, 'dd', value)
    details.appendChild(row)
  }
  addDetail(ct('Species ID'), plant.speciesId)
  addDetail(ct('Plant status'), display(plant.status))
  addDetail(ct('Registered at'), plant.registeredAt ? dt(plant.registeredAt) : ct('Unavailable'))
  addDetail(ct('Latest approved observation'), plant.observedAt ? dt(plant.observedAt) : ct('Unavailable'))
  addDetail(ct('GPS Accuracy'), accuracy(plant))
  root.appendChild(details)
  const actions = document.createElement('div')
  actions.className = 'plant-popup-actions'
  const detailsButton = appendText(actions, 'button', ct('View Plant Details'))
  detailsButton.type = 'button'
  detailsButton.addEventListener('click', () => void router.push(`/plant/${encodeURIComponent(plant.id)}`))
  const mapsLink = appendText(actions, 'a', ct('Open in Google Maps'))
  mapsLink.href = `https://www.google.com/maps/search/?api=1&query=${plant.latitude},${plant.longitude}`
  mapsLink.target = '_blank'
  mapsLink.rel = 'noopener noreferrer'
  root.appendChild(actions)
  return root
}
const highlightSelectedMarker = () => markers.forEach((marker, id) =>
  marker.getElement()?.classList.toggle('is-selected', selected.value?.id === id))
const selectPlant = (plant: EnrichedPlant, center = true) => {
  if (!hasValidCoordinates(plant) || !map) return
  selected.value = plant
  history.value = false
  if (center) map.setView([plant.latitude!, plant.longitude!], 17, { animate: false })
  map.whenReady(() => {
    markers.get(plant.id)?.openPopup()
    highlightSelectedMarker()
  })
}
const fitVisiblePlants = () => {
  if (!map || !mappedPlants.value.length) return
  map.fitBounds(L.latLngBounds(mappedPlants.value.map((plant) => [plant.latitude!, plant.longitude!])), {
    padding: [48, 48], maxZoom: 17,
  })
}
const renderMarkers = () => {
  if (!markerLayer) return
  markerLayer.clearLayers()
  markers.clear()
  mappedPlants.value.forEach((plant) => {
    const marker = L.marker([plant.latitude!, plant.longitude!], {
      icon: markerIcon(), title: `${plant.displayId}: ${speciesName(plant)}`, riseOnHover: true,
    }).bindPopup(popupContent(plant), { maxWidth: 330, minWidth: 260 })
      .on('click', () => { selected.value = plant; highlightSelectedMarker() })
      .addTo(markerLayer!)
    markers.set(plant.id, marker)
  })
  highlightSelectedMarker()
}
const focus = async (plant: EnrichedPlant) => {
  await nextTick()
  mapElement.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  selectPlant(plant)
}
const selectFromRoute = () => {
  if (!routePlantId.value) return
  const plant = mappedPlants.value.find((item) =>
    item.id === routePlantId.value || item.displayId === routePlantId.value)
  if (plant) selectPlant(plant)
}
const scheduleMapRefresh = (applyRoute = false) => {
  if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = null
    map?.invalidateSize({ pan: false })
    if (applyRoute) selectFromRoute()
  })
}

onMounted(async () => {
  await nextTick()
  if (!mapElement.value || map) return
  map = L.map(mapElement.value, { zoomControl: true, minZoom: 3 })
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 20, maxNativeZoom: 19,
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
  }).addTo(map)
  markerLayer = L.layerGroup().addTo(map)
  resizeObserver = new ResizeObserver(() => scheduleMapRefresh())
  resizeObserver.observe(mapElement.value)
  settleTimer = setTimeout(() => map?.invalidateSize({ pan: false }), 150)
  await loadPlants()
})
watch([mappedPlants, locale], () => {
  renderMarkers()
  if (selected.value && !mappedPlants.value.some((plant) => plant.id === selected.value?.id)) selected.value = null
  scheduleMapRefresh(true)
})
watch(() => route.query.plant, () => scheduleMapRefresh(true))
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)
  if (settleTimer) clearTimeout(settleTimer)
  markerLayer?.clearLayers()
  map?.off()
  map?.remove()
  resizeObserver = null
  resizeFrame = null
  settleTimer = null
  markerLayer = null
  map = null
  markers.clear()
})
</script>

<template>
  <section class="page-intro"><div><p class="page-kicker">{{ ct('SPATIAL RECORDS') }}</p><h2>{{ ct('Biodiversity Map') }}</h2><p>{{ ct('Visualise up to 500 authorised plant records using current plant locations.') }}</p></div></section>
  <div class="control-bar">
    <label class="field search-field"><span>{{ ct('Search loaded plants') }}</span><input v-model="search" :placeholder="ct('Plant ID, species ID, species name or status')" /></label>
    <label class="field"><span>{{ ct('Species') }}</span><select v-model="speciesFilter"><option value="">{{ ct('All species') }}</option><option v-for="item in speciesOptions" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
    <label class="field"><span>{{ ct('Conservation status') }}</span><select v-model="conservationFilter"><option value="">{{ ct('All statuses') }}</option><option v-for="item in conservationStatuses" :key="item" :value="item">{{ item }}</option></select></label>
    <label class="field"><span>{{ ct('Plant status') }}</span><select v-model="statusFilter"><option value="">{{ ct('All statuses') }}</option><option v-for="item in plantStatuses" :key="item" :value="item">{{ ct(item) }}</option></select></label>
  </div>

  <section class="panel map-card">
    <div class="map-shell">
      <div ref="mapElement" class="biodiversity-map" :aria-label="ct('Interactive biodiversity map')"></div>
      <div class="map-summary">
        <article>
          <svg class="map-summary-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h8M8 12h8M8 17h5" /></svg>
          <small>{{ ct('Plant records') }}</small><strong>{{ plants.length }}</strong>
        </article>
        <article>
          <svg class="map-summary-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></svg>
          <small>{{ ct('Mapped records') }}</small><strong>{{ mappedPlants.length }}</strong>
        </article>
        <article>
          <svg class="map-summary-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 3c-9-1-15 3-15 9a6 6 0 0 0 6 6c6 0 10-6 9-15ZM3 21l12-12" /></svg>
          <small>{{ ct('Species recorded') }}</small><strong>{{ speciesRecorded }}</strong>
        </article>
      </div>
      <button class="fit-map-button" type="button" @click="fitVisiblePlants">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5" /><circle cx="12" cy="12" r="3" /></svg>
        <span>{{ ct('Fit visible plants') }}</span>
      </button>
      <div v-if="isLoading" class="map-empty" role="status">{{ ct('Loading plant locations...') }}</div>
      <div v-else-if="loadError" class="map-empty error-state" role="alert"><strong>{{ ct('Plant locations could not be loaded.') }}</strong><span>{{ loadError }}</span><button type="button" @click="loadPlants">{{ ct('Retry') }}</button></div>
      <div v-else-if="!mappedPlants.length" class="map-empty" role="status">{{ ct('No plants with valid coordinates match the selected filters.') }}</div>
    </div>
    <p v-if="speciesError" class="coordinate-note error-state">{{ ct('Species metadata is unavailable:') }} {{ speciesError }}</p>
    <p v-if="unmappedPlantCount" class="coordinate-note">{{ ct('{count} filtered records are not shown because coordinates are unavailable.', { count: unmappedPlantCount }) }}</p>
    <p v-if="skippedPlants" class="coordinate-note">{{ ct('{count} malformed plant records were skipped.', { count: skippedPlants }) }}</p>
    <p v-if="deepLinkMissing" class="coordinate-note">{{ ct('The requested plant is not present in the loaded list of up to 500 records.') }}</p>
    <div v-if="selected" class="selected-card"><div class="panel-header"><div><h3>{{ selected.displayId }} · {{ speciesName(selected) }}</h3><span class="panel-description">{{ display(selected.species?.commonName) }} · {{ ct('Species ID') }} {{ selected.speciesId }}</span></div><div class="selection-actions"><RouterLink class="secondary-button" :to="`/plant/${encodeURIComponent(selected.id)}`">{{ ct('View Plant Details') }}</RouterLink><button class="secondary-button" type="button" @click="history = true">{{ ct('History availability') }}</button></div></div><dl class="detail-list"><div><dt>{{ ct('Coordinates') }}</dt><dd>{{ selected.latitude }}, {{ selected.longitude }}</dd></div><div><dt>{{ ct('Plant status') }}</dt><dd>{{ display(selected.status) }}</dd></div><div><dt>{{ ct('GPS Accuracy') }}</dt><dd>{{ accuracy(selected) }}</dd></div><div><dt>{{ ct('Latest approved observation') }}</dt><dd>{{ selected.observedAt ? dt(selected.observedAt) : ct('Unavailable') }}</dd></div></dl></div>
  </section>

  <section class="panel mapped-records-panel">
    <header class="panel-header"><div><h2>{{ ct('Mapped Plant Records') }}</h2></div></header>
    <div class="table-scroll mapped-records-scroll" role="region" :aria-label="ct('Mapped Plant Records')" tabindex="0">
      <table class="mapped-records-table">
        <colgroup><col class="plant-column" /><col class="species-column" /><col class="species-id-column" /><col class="status-column" /><col class="coordinates-column" /><col class="accuracy-column" /><col class="registered-column" /><col class="actions-column" /></colgroup>
        <thead><tr><th scope="col">{{ ct('Plant ID') }}</th><th scope="col">{{ ct('Species') }}</th><th scope="col">{{ ct('Species ID') }}</th><th scope="col">{{ ct('Plant status') }}</th><th scope="col">{{ ct('Coordinates') }}</th><th scope="col">{{ ct('GPS Accuracy') }}</th><th scope="col">{{ ct('Registered at') }}</th><th scope="col">{{ ct('Actions') }}</th></tr></thead>
        <tbody>
          <tr v-for="plant in filtered" :key="plant.id">
            <td><strong>{{ plant.displayId }}</strong></td>
            <td class="species-name-cell"><em>{{ speciesName(plant) }}</em><small>{{ display(plant.species?.commonName) }}</small></td>
            <td>{{ plant.speciesId }}</td>
            <td class="status-cell"><span class="badge" :class="plant.status.toLowerCase().replaceAll(' ', '-')">{{ display(plant.status) }}</span></td>
            <td>{{ plant.latitude ?? ct('Unavailable') }}, {{ plant.longitude ?? ct('Unavailable') }}</td>
            <td>{{ accuracy(plant) }}</td>
            <td>{{ formatRegisteredAt(plant.registeredAt) }}</td>
            <td class="actions-cell"><div class="action-group"><button v-if="hasValidCoordinates(plant)" class="action-button" type="button" @click="focus(plant)">{{ ct('Focus on Map') }}</button><RouterLink class="action-button" :to="`/plant/${encodeURIComponent(plant.id)}`">{{ ct('View Plant Details') }}</RouterLink></div></td>
          </tr>
          <tr v-if="!isLoading && !loadError && !filtered.length"><td colspan="8" class="empty-row">{{ ct('No plant records match the selected filters.') }}</td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <AppModal v-if="history && selected" :title="ct('{id} Observation History', { id: selected.displayId })" :subtitle="speciesName(selected)" @close="history = false"><p>{{ ct('Complete observation history is not included in the plant response. No history has been inferred from the capped observation list.') }}</p></AppModal>
</template>

<style scoped>
.map-card { padding: 0; overflow: hidden; }
.map-shell { position: relative; isolation: isolate; min-height: 620px; background: #dce8dc; }
.biodiversity-map { width: 100%; min-height: 620px; z-index: 0; }
.officer-layout .map-card .map-shell .map-summary { position: absolute; top: 14px; right: 14px; z-index: 500; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: stretch; width: min(34rem, calc(100% - 28px)); max-width: calc(100% - 28px); gap: 10px; pointer-events: none; }
.officer-layout .map-card .map-shell .map-summary article { display: grid; grid-template-columns: 1.25rem minmax(0, 1fr); grid-template-rows: 1fr auto; align-items: center; gap: 6px; min-width: 0; padding: 11px 14px; border: 1px solid #dfe7df; border-radius: 13px; background: rgba(255,255,255,.95); box-shadow: 0 8px 22px rgba(24,61,47,.14); }
.map-summary-icon { width: 1.25rem; height: 1.25rem; color: #315b49; }
.map-summary small, .map-summary strong, td small { display: block; }
.officer-layout .map-card .map-shell .map-summary small { font-size: var(--officer-support, .8125rem); line-height: 1.5; overflow-wrap: anywhere; }
.officer-layout .map-card .map-shell .map-summary strong { grid-column: 1 / -1; margin: 0; color: #173f34; font-size: var(--officer-number, 1.875rem); line-height: 1.2; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.fit-map-button { position: absolute; right: 14px; bottom: 24px; z-index: 500; display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 2.75rem; max-width: calc(100% - 28px); padding: 9px 12px; border: 1px solid #d9e3da; border-radius: 9px; background: #fff; color: #326d55; cursor: pointer; font-weight: 800; }
.fit-map-button svg { flex: 0 0 20px; width: 20px; height: 20px; }
.fit-map-button:focus-visible, .mapped-records-scroll:focus-visible { outline: 3px solid #315b49; outline-offset: -3px; }
.officer-layout .mapped-records-panel .mapped-records-scroll { min-width: 0; max-width: 100%; overflow-x: auto; overscroll-behavior-inline: contain; }
.officer-layout .mapped-records-scroll .mapped-records-table { width: 100%; min-width: 90rem; table-layout: auto; border-collapse: separate; border-spacing: 0; }
.mapped-records-table .plant-column, .mapped-records-table .species-id-column { width: 7rem; }
.mapped-records-table .species-column { width: 16rem; }
.mapped-records-table .status-column { width: 12rem; }
.mapped-records-table .coordinates-column { width: 13rem; }
.mapped-records-table .accuracy-column { width: 8rem; }
.mapped-records-table .registered-column { width: 14rem; }
.mapped-records-table .actions-column { width: 1%; }
.officer-layout .mapped-records-scroll .mapped-records-table th, .officer-layout .mapped-records-scroll .mapped-records-table td { padding: 12px 14px; text-align: left; vertical-align: middle; }
.officer-layout .mapped-records-scroll .mapped-records-table th { background: #245443; color: #fff; border-bottom-color: #245443; font-size: var(--officer-small, .75rem); font-weight: 700; text-transform: uppercase; letter-spacing: .6px; line-height: 1.5; }
.mapped-records-table thead th:first-child { border-top-left-radius: 10px; }
.mapped-records-table thead th:last-child { border-top-right-radius: 10px; }
.officer-layout .mapped-records-scroll .mapped-records-table td { font-size: var(--officer-text, .875rem); line-height: 1.5; }
.officer-layout .mapped-records-scroll .mapped-records-table td.species-name-cell { white-space: normal; overflow-wrap: normal; word-break: normal; }
.officer-layout .mapped-records-scroll .mapped-records-table .status-cell, .officer-layout .mapped-records-scroll .mapped-records-table .actions-cell { white-space: nowrap; }
.officer-layout .mapped-records-scroll .mapped-records-table .badge.pending-review { background: #e8eff2; color: #53727c; }
.officer-layout .mapped-records-scroll .mapped-records-table .badge.flagged { background: #f0eaf8; color: #69459a; }
.officer-layout .mapped-records-scroll .mapped-records-table .action-group { display: flex; flex-wrap: nowrap; align-items: center; gap: 7px; width: max-content; min-width: max-content; }
.map-empty { position: absolute; top: 50%; left: 50%; z-index: 500; width: min(390px, calc(100% - 32px)); padding: 16px; border-radius: 10px; background: rgba(255,255,255,.96); color: #60746b; text-align: center; transform: translate(-50%,-50%); }
.map-empty span { display: block; margin: 6px 0 12px; }
.coordinate-note { margin: 0; padding: 9px 18px; border-top: 1px solid #e3e9e3; background: #f8faf8; color: #77877f; font-size: 10px; }
.error-state { color: #963d36; }
.selected-card { padding: 20px 23px 23px; border-top: 1px solid #e3e9e3; }
.selection-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.selection-actions a, a.action-button { text-decoration: none; }
:deep(.plant-marker-host) { background: transparent; border: 0; }
:deep(.plant-marker-pin) { width: 36px; height: 36px; display: grid; place-items: center; border: 3px solid #fff; border-radius: 50% 50% 50% 7px; background: #65a556; color: #fff; box-shadow: 0 3px 9px rgba(16,57,33,.42); transform: rotate(-45deg); }
:deep(.plant-marker-pin svg) { width: 22px; height: 22px; fill: currentColor; transform: rotate(45deg); }
:deep(.plant-marker-host:hover .plant-marker-pin), :deep(.plant-marker-host.is-selected .plant-marker-pin) { background: #246c45; transform: rotate(-45deg) scale(1.14); }
:deep(.plant-popup-card) { display: grid; color: #425e54; }
:deep(.plant-popup-card strong), :deep(.plant-popup-card em), :deep(.plant-popup-card span) { display: block; margin-bottom: 5px; }
:deep(.plant-popup-card dl) { margin: 8px 0; }
:deep(.plant-popup-card dl div) { display: flex; justify-content: space-between; gap: 15px; }
:deep(.plant-popup-card dd) { margin: 0; text-align: right; }
:deep(.plant-popup-actions) { display: flex; gap: 7px; margin-top: 8px; }
:deep(.plant-popup-actions a), :deep(.plant-popup-actions button) { padding: 7px 9px; border: 0; border-radius: 7px; background: #315f4e; color: white; font: inherit; text-decoration: none; cursor: pointer; }
@media (max-width: 760px) { .officer-layout .map-card .map-shell .map-summary { left: 12px; right: 12px; width: auto; max-width: none; gap: 6px; } .officer-layout .map-card .map-shell .map-summary article { padding: 10px 8px; } }
</style>
