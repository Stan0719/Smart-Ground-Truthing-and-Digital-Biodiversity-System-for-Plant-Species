<script setup lang="ts">
import { vOfficerDropdown } from '../../components/conservation/officerDropdown'
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

const { ct, locale } = useConservationText()
const route = useRoute()
const router = useRouter()
const search = ref('')
const speciesFilter = ref('')
const conservationFilter = ref('')
const statusFilter = ref('')
const plants = ref<EnrichedPlant[]>([])
const selected = ref<EnrichedPlant | null>(null)
const selectedImageFailed = ref(false)
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
  const parts = new Intl.DateTimeFormat(locale.value === 'ms' ? 'ms-MY' : locale.value, {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Kuching',
  }).formatToParts(parsed)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || ''
  return `${part('day')} ${part('month')} ${part('year')}, ${part('hour')}:${part('minute')}`
}
const speciesName = (plant: EnrichedPlant) =>
  plant.species?.scientificName || plant.species?.commonName || ct('Unavailable')
const accuracy = (plant: EnrichedPlant) =>
  plant.accuracyM === null ? ct('Unavailable') : `${plant.accuracyM} m`
const selectedImageUrl = computed(() => selected.value?.imageUrl || selected.value?.species?.imageUrl || '')
watch(selected, () => { selectedImageFailed.value = false })
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
  html: '<span class="plant-marker-pin" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M17,8C8,10,5.9,16.17,3.82,21.34L5.71,22l1-2.3A4.49,4.49,0,0,0,8,20C19,20,22,3,22,3,21,5,14,5.25,9,6.25S2,11.5,2,13.5a6.22,6.22,0,0,0,1.75,3.75C7,8,17,8,17,8Z"/></svg></span>',
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
const appendIcon = (parent: HTMLElement, pathData: string, className = 'plant-popup-icon') => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  svg.classList.add(className)
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', pathData)
  svg.appendChild(path)
  parent.appendChild(svg)
  return svg
}
const leafPath = 'M20 4C10 4 5 8 5 14a5 5 0 0 0 5 5c6 0 10-5 10-15ZM4 21l9-9'
const popupImage = (plant: EnrichedPlant) => {
  const imageWrap = document.createElement('div')
  imageWrap.className = 'plant-popup-image-wrap'
  const imageUrl = plant.imageUrl || plant.species?.imageUrl || ''
  const fallback = document.createElement('div')
  fallback.className = 'plant-popup-image-fallback'
  fallback.hidden = Boolean(imageUrl)
  appendIcon(fallback, leafPath, 'plant-image-leaf')
  if (imageUrl) {
    const image = document.createElement('img')
    image.className = 'plant-popup-image'
    image.alt = ''
    image.src = imageUrl
    image.addEventListener('error', () => { image.hidden = true; fallback.hidden = false })
    imageWrap.appendChild(image)
  }
  imageWrap.appendChild(fallback)
  return imageWrap
}
const popupContent = (plant: EnrichedPlant) => {
  const root = document.createElement('article')
  root.className = 'plant-popup-card'
  const header = document.createElement('header')
  header.className = 'plant-popup-header'
  header.appendChild(popupImage(plant))
  const identity = document.createElement('div')
  identity.className = 'plant-popup-identity'
  appendText(identity, 'strong', plant.displayId, 'plant-popup-id')
  appendText(identity, 'em', speciesName(plant), 'plant-popup-scientific')
  appendText(identity, 'span', display(plant.species?.commonName), 'plant-popup-common')
  header.appendChild(identity)
  root.appendChild(header)
  const details = document.createElement('dl')
  details.className = 'plant-popup-details'
  const addDetail = (name: string, value: string, icon: string, status = false) => {
    const row = document.createElement('div')
    row.className = 'plant-popup-row'
    appendIcon(row, icon)
    appendText(row, 'dt', name)
    appendText(row, 'dd', value, status ? `plant-popup-status ${plant.status.toLowerCase().replaceAll(' ', '-')}` : '')
    details.appendChild(row)
  }
  addDetail(ct('Plant scientific name'), display(plant.scientificName), 'M4 20h16M6 20l1.5-7h9L18 20M8 13l1-5h6l1 5M10 8V5h4v3')
  addDetail(ct('Species ID'), plant.speciesId, 'm12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5')
  addDetail(ct('Plant status'), display(plant.status), 'M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z M9 12l2 2 4-4', true)
  addDetail(ct('Registered at'), formatRegisteredAt(plant.registeredAt), 'M8 2v4m8-4v4M4 9h16M5 4h14a1 1 0 0 1 1 1v15H4V5a1 1 0 0 1 1-1Z')
  addDetail(ct('Latest approved observation'), formatRegisteredAt(plant.observedAt), 'M8 2v4m8-4v4M4 9h16M5 4h14a1 1 0 0 1 1 1v15H4V5a1 1 0 0 1 1-1Z')
  addDetail(ct('GPS Accuracy'), accuracy(plant), 'M12 22s8-4 8-11a8 8 0 1 0-16 0c0 7 8 11 8 11Z M12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z')
  root.appendChild(details)
  const actions = document.createElement('div')
  actions.className = 'plant-popup-actions'
  const detailsButton = appendText(actions, 'button', ct('View Plant Details'))
  detailsButton.type = 'button'
  appendIcon(detailsButton, 'M14 3h7v7m0-7L10 14M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6', 'plant-popup-action-icon')
  detailsButton.addEventListener('click', () => void router.push(`/plant/${encodeURIComponent(plant.id)}`))
  const mapsLink = appendText(actions, 'a', ct('Open in Google Maps'))
  appendIcon(mapsLink, 'M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z M12 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z', 'plant-popup-action-icon')
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
  map.closePopup()
  map.invalidateSize({ pan: false })
  map.fitBounds(L.latLngBounds(mappedPlants.value.map((plant) => [plant.latitude!, plant.longitude!])), {
    padding: [64, 64], maxZoom: 17, animate: false,
  })
}
const renderMarkers = () => {
  if (!markerLayer) return
  markerLayer.clearLayers()
  markers.clear()
  mappedPlants.value.forEach((plant) => {
    const marker = L.marker([plant.latitude!, plant.longitude!], {
      icon: markerIcon(), title: `${plant.displayId}: ${speciesName(plant)}`, riseOnHover: true,
  }).bindPopup(popupContent(plant), { maxWidth: 430, minWidth: 390, autoPan: true, className: 'biodiversity-plant-popup' })
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
  map = L.map(mapElement.value, { zoomControl: true, minZoom: 1, zoomSnap: 0.25 })
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
  <section class="page-intro map-page-intro">
    <h2>{{ ct('Biodiversity Map') }}</h2>
    <p>{{ ct('Visualise up to 500 authorised plant records using current plant locations.') }}</p>
  </section>
  <div class="control-bar map-filter-toolbar">
    <label class="field search-field"><span>{{ ct('Search loaded plants') }}</span><span class="map-search-input"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg><input v-model="search" :placeholder="ct('Plant ID, species ID, species name or status')" /></span></label>
    <span class="map-filter-divider" aria-hidden="true"></span>
    <label class="field"><span>{{ ct('Species') }}</span><select v-officer-dropdown v-model="speciesFilter"><option value="">{{ ct('All species') }}</option><option v-for="item in speciesOptions" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
    <label class="field"><span>{{ ct('Conservation status') }}</span><select v-officer-dropdown v-model="conservationFilter"><option value="">{{ ct('All statuses') }}</option><option v-for="item in conservationStatuses" :key="item" :value="item">{{ item }}</option></select></label>
    <label class="field"><span>{{ ct('Plant status') }}</span><select v-officer-dropdown v-model="statusFilter"><option value="">{{ ct('All statuses') }}</option><option v-for="item in plantStatuses" :key="item" :value="item">{{ ct(item) }}</option></select></label>
  </div>

  <section class="panel map-card">
    <div class="map-shell">
      <div ref="mapElement" class="biodiversity-map" :aria-label="ct('Interactive biodiversity map')"></div>
      <div class="map-summary">
        <article class="summary-plants">
          <svg class="map-summary-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 4C10 4 5 8 5 14a5 5 0 0 0 5 5c6 0 10-5 10-15ZM4 21l9-9" /></svg>
          <small>{{ ct('Plant records') }}</small><strong>{{ plants.length }}</strong>
        </article>
        <article class="summary-mapped">
          <svg class="map-summary-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></svg>
          <small>{{ ct('Mapped records') }}</small><strong>{{ mappedPlants.length }}</strong>
        </article>
        <article class="summary-species">
          <svg class="map-summary-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5" /></svg>
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
  </section>
  <p v-if="unmappedPlantCount" class="coordinate-note coordinate-info"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" /><path d="M12 10v7M12 7h.01" /></svg><span>{{ ct('{count} filtered records are not shown because coordinates are unavailable.', { count: unmappedPlantCount }) }}</span></p>
  <p v-if="speciesError" class="coordinate-note error-state">{{ ct('Species metadata is unavailable:') }} {{ speciesError }}</p>
  <p v-if="skippedPlants" class="coordinate-note">{{ ct('{count} malformed plant records were skipped.', { count: skippedPlants }) }}</p>
  <p v-if="deepLinkMissing" class="coordinate-note">{{ ct('The requested plant is not present in the loaded list of up to 500 records.') }}</p>
  <section v-if="selected" class="selected-card map-selected-card" :aria-label="ct('Selected plant information')">
    <div class="selected-identity">
      <img v-if="selectedImageUrl && !selectedImageFailed" class="selected-plant-image" :src="selectedImageUrl" alt="" @error="selectedImageFailed = true" />
      <div v-else class="selected-plant-image selected-plant-image-fallback" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 4C10 4 5 8 5 14a5 5 0 0 0 5 5c6 0 10-5 10-15ZM4 21l9-9" /></svg></div>
      <div class="selected-identity-copy">
        <h3>{{ selected.displayId }} — {{ speciesName(selected) }}</h3>
        <p><em>{{ display(selected.species?.commonName) }}</em><span> · </span>{{ ct('Species ID') }}: {{ selected.speciesId }}</p>
        <span class="selected-status-badge" :class="selected.status.toLowerCase().replaceAll(' ', '-')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>{{ ct(selected.status) }}</span>
      </div>
    </div>
    <div class="selected-info-section">
      <div class="selected-info-row"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h16M6 20l1.5-7h9L18 20M8 13l1-5h6l1 5M10 8V5h4v3" /></svg><div><strong>{{ ct('Plant scientific name') }}</strong><span>{{ display(selected.scientificName) }}</span></div></div>
      <div class="selected-info-row"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z M9 12l2 2 4-4" /></svg><div><strong>{{ ct('Plant status') }}</strong><span>{{ ct(selected.status) }}</span></div></div>
      <div class="selected-info-row"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 2v4m8-4v4M4 9h16M5 4h14a1 1 0 0 1 1 1v15H4V5a1 1 0 0 1 1-1Z" /></svg><div><strong>{{ ct('Latest approved observation') }}</strong><span>{{ formatRegisteredAt(selected.observedAt) }}</span></div></div>
    </div>
    <div class="selected-location-section">
      <div class="selected-info-row"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z M12 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" /></svg><div><strong>{{ ct('Coordinates') }}</strong><span>{{ selected.latitude }}, {{ selected.longitude }}</span></div></div>
      <div class="selected-info-row"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></svg><div><strong>{{ ct('GPS Accuracy') }}</strong><span>{{ accuracy(selected) }}</span></div></div>
    </div>
    <div class="selected-actions-section">
      <RouterLink class="selected-action-primary" :to="`/plant/${encodeURIComponent(selected.id)}`"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h7v7m0-7L10 14M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6"/></svg>{{ ct('View Plant Details') }}</RouterLink>
      <button class="selected-action-secondary" type="button" @click="history = true"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>{{ ct('History availability') }}</button>
    </div>
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
.map-page-intro { display: block; margin-bottom: 18px; text-align: left; }
.map-page-intro h2 { margin: 0 0 3px; color: #123a2c; font-size: clamp(1.75rem, 2.4vw, 2.25rem); font-weight: 800; letter-spacing: -.035em; line-height: 1.12; }
.map-page-intro p { margin: 0; color: #183a2d; font-size: 1rem; }
.map-filter-toolbar { display: grid; grid-template-columns: minmax(280px, 1.7fr) 1px minmax(150px, .82fr) minmax(190px, 1fr) minmax(170px, .9fr); align-items: center; gap: 24px; margin-bottom: 14px; padding: 12px 20px; border-color: #cad9ce; border-radius: 13px; background: rgba(255,255,255,.68); }
.map-filter-toolbar .field { min-width: 0; gap: 7px; }
.map-filter-toolbar .field > span:first-child { color: #132a20; font-size: 14px; font-weight: 750; letter-spacing: -.01em; text-transform: none; }
.map-filter-toolbar .field input, .map-filter-toolbar .field select { box-sizing: border-box; height: 41px; min-width: 0; padding: 0 13px; border-color: #cbd8cf; border-radius: 11px; background: #fff; color: #192b22; font-size: 14px; }
.map-filter-toolbar .search-field { flex: initial; }
.map-filter-toolbar .map-search-input { display: flex; align-items: center; gap: 10px; min-width: 0; height: 41px; padding: 0 12px; border: 1px solid #cbd8cf; border-radius: 11px; background: #fff; }
.map-filter-toolbar .map-search-input svg { flex: 0 0 20px; width: 20px; height: 20px; fill: none; stroke: #132a20; stroke-width: 2; stroke-linecap: round; }
.map-filter-toolbar .map-search-input input { width: 100%; height: 39px; padding: 0; border: 0; outline: 0; box-shadow: none; background: transparent; }
.map-filter-toolbar .map-search-input:focus-within { outline: 3px solid #0b6b4422; border-color: #508a6a; }
.map-filter-divider { width: 1px; height: 63px; background: #bdccc2; }
.map-card { padding: 0; overflow: visible; border: 0; border-radius: 14px; background: transparent; box-shadow: none; }
.map-shell { position: relative; isolation: isolate; height: clamp(390px, 34vw, 520px); min-height: 390px; overflow: hidden; border: 1px solid #d1ddd3; border-radius: 14px; background: #dce8dc; }
.biodiversity-map { width: 100%; height: 100%; min-height: inherit; z-index: 0; }
.officer-layout .map-card .map-shell .map-summary { position: absolute; top: 14px; right: 14px; z-index: 500; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: stretch; width: min(34rem, calc(100% - 28px)); max-width: calc(100% - 28px); gap: 9px; pointer-events: none; }
.officer-layout .map-card .map-shell .map-summary article { display: grid; grid-template-columns: 1.5rem minmax(0, 1fr); grid-template-rows: auto auto; align-content: center; align-items: center; column-gap: 9px; row-gap: 0; min-width: 0; min-height: 74px; padding: 10px 14px; border: 1px solid #dfe7df; border-radius: 15px; background: rgba(255,255,255,.96); box-shadow: 0 8px 22px rgba(24,61,47,.14); }
.map-summary-icon { grid-column: 1; grid-row: 1; align-self: center; width: 1.5rem; height: 1.5rem; color: #087442; }
.map-summary small, .map-summary strong, td small { display: block; }
.officer-layout .map-card .map-shell .map-summary small { grid-column: 2; grid-row: 1; font-size: .8125rem; line-height: 1.35; color: #1c2d24; white-space: nowrap; }
.officer-layout .map-card .map-shell .map-summary strong { grid-column: 2; grid-row: 2; margin: 1px 0 0; color: #123a2c; font-size: 1.7rem; line-height: 1.12; font-weight: 800; font-variant-numeric: tabular-nums; }
.fit-map-button { position: absolute; right: 12px; bottom: 34px; z-index: 500; display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 42px; max-width: calc(100% - 24px); padding: 8px 14px; border: 1px solid #b9cec1; border-radius: 12px; background: #fff; color: #123a2c; box-shadow: 0 4px 14px rgba(14,53,35,.16); cursor: pointer; font-size: 13px; font-weight: 750; }
.fit-map-button:hover { background: #f3f8f4; border-color: #80a78f; }
.fit-map-button svg { flex: 0 0 18px; width: 18px; height: 18px; }
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
.officer-layout .mapped-records-scroll .mapped-records-table .badge.pending-review { background: #FEF9C3; color: #854D0E; }
.officer-layout .mapped-records-scroll .mapped-records-table .badge.flagged { background: #f0eaf8; color: #69459a; }
.officer-layout .mapped-records-scroll .mapped-records-table .action-group { display: flex; flex-wrap: nowrap; align-items: center; gap: 7px; width: max-content; min-width: max-content; }
.map-empty { position: absolute; top: 50%; left: 50%; z-index: 500; width: min(390px, calc(100% - 32px)); padding: 16px; border-radius: 10px; background: rgba(255,255,255,.96); color: #60746b; text-align: center; transform: translate(-50%,-50%); }
.map-empty span { display: block; margin: 6px 0 12px; }
.coordinate-note { margin: 0; padding: 9px 18px; border: 1px solid #dce9dd; border-radius: 0; background: #eff6ef; color: #243d31; font-size: 13px; }
.error-state { color: #963d36; }
.coordinate-info { display: flex; align-items: center; gap: 9px; min-height: 38px; margin: 5px 0 16px; padding: 8px 18px; border: 0; border-radius: 12px; background: #e5f0e7; color: #1d3026; font-size: 13px; font-weight: 500; }
.coordinate-info svg { flex: 0 0 20px; width: 20px; height: 20px; }
.coordinate-info + .coordinate-note, .coordinate-note + .coordinate-note { margin-top: 6px; }
.map-selected-card { box-sizing: border-box; display: grid; grid-template-columns: minmax(0, 38fr) minmax(0, 23fr) minmax(0, 20fr) minmax(0, 19fr); align-items: stretch; gap: 18px; min-height: 194px; margin: 20px 0 18px; padding: 22px 28px; border: 0; border-radius: 15px; background: #034b30; color: #f7fbf7; }
.officer-layout.officer-layout .map-selected-card { background: #034b30; color: #f7fbf7; }
.map-selected-card > * { min-width: 0; }
.selected-identity { display: flex; align-items: center; gap: 20px; padding-right: 18px; border-right: 1px solid rgba(255,255,255,.43); }
.selected-plant-image { flex: 0 0 140px; width: 140px; height: 140px; object-fit: cover; border: 2px solid #e7f2e9; border-radius: 15px; background: #dcebdc; }
.selected-plant-image-fallback { display: grid; place-items: center; color: #18764c; }
.selected-plant-image-fallback svg { width: 54px; height: 54px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.selected-identity-copy { min-width: 0; }
.officer-layout.officer-layout .map-selected-card .selected-identity h3 { margin: 0 0 8px; color: #fff; font-size: clamp(1.1rem, 1.55vw, 1.55rem); font-weight: 800; line-height: 1.25; overflow-wrap: anywhere; }
.selected-identity-copy p { margin: 0 0 13px; color: #f2f7f3; font-size: 14px; line-height: 1.45; overflow-wrap: anywhere; }
.selected-identity-copy p em { color: #f2f7f3; }
.selected-status-badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 11px; border-radius: 999px; background: #a9eaa9; color: #0c3827; font-size: 12px; font-weight: 750; line-height: 1; }
.selected-status-badge svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
.selected-status-badge.pending-review { background: #f7e7a9; color: #55400b; }
.selected-status-badge.flagged, .selected-status-badge.rejected { background: #f4c9c3; color: #63251e; }
.selected-info-section, .selected-location-section { display: flex; flex-direction: column; justify-content: center; min-width: 0; padding-right: 18px; border-right: 1px solid rgba(255,255,255,.43); }
.selected-info-row { display: flex; align-items: flex-start; gap: 12px; min-width: 0; padding: 8px 0; }
.selected-info-row + .selected-info-row { border-top: 1px solid rgba(255,255,255,.27); }
.selected-info-row > svg { flex: 0 0 22px; width: 22px; height: 22px; margin-top: 1px; fill: none; stroke: #eff8f1; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.selected-info-row > div { display: grid; gap: 3px; min-width: 0; }
.selected-info-row strong { color: #fff; font-size: 13px; font-weight: 750; line-height: 1.3; }
.selected-info-row span { color: #f2f7f3; font-size: 12px; line-height: 1.35; overflow-wrap: anywhere; }
.selected-location-section { justify-content: center; }
.selected-actions-section { display: flex; flex-direction: column; justify-content: center; gap: 11px; min-width: 0; }
.selected-action-primary, .selected-action-secondary { box-sizing: border-box; display: flex; align-items: center; justify-content: center; gap: 9px; width: 100%; min-height: 45px; padding: 9px 12px; border: 1px solid #fff; border-radius: 11px; cursor: pointer; font: inherit; font-size: 13px; font-weight: 750; line-height: 1.25; text-align: center; text-decoration: none; }
.selected-action-primary { background: #f8fbf8; color: #102e22; }
.selected-action-secondary { background: transparent; color: #fff; }
.selected-action-primary:hover { background: #e9f2eb; }
.selected-action-secondary:hover { background: rgba(255,255,255,.12); }
.selected-action-primary svg, .selected-action-secondary svg { flex: 0 0 20px; width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
.selection-actions a, a.action-button { text-decoration: none; }
:deep(.plant-marker-host) { background: transparent; border: 0; }
:deep(.plant-marker-pin) { width: 36px; height: 36px; display: grid; place-items: center; border: 3px solid #fff; border-radius: 50% 50% 50% 7px; background: #65a556; color: #fff; box-shadow: 0 3px 9px rgba(16,57,33,.42); transform: rotate(-45deg); }
:deep(.plant-marker-pin svg) { width: 22px; height: 22px; fill: #FFFFFF; stroke: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; transform: rotate(45deg); }
:deep(.plant-marker-host:hover .plant-marker-pin), :deep(.plant-marker-host.is-selected .plant-marker-pin) { background: #246c45; transform: rotate(-45deg) scale(1.14); }
:deep(.leaflet-popup.biodiversity-plant-popup .leaflet-popup-content-wrapper) { padding: 0; border: 1px solid #dbe4dc; border-radius: 19px; background: #fff; box-shadow: 0 16px 42px rgba(20,48,35,.24); }
:deep(.leaflet-popup.biodiversity-plant-popup .leaflet-popup-content) { width: 390px !important; max-width: calc(100vw - 72px); margin: 15px 17px; }
:deep(.leaflet-popup.biodiversity-plant-popup .leaflet-popup-tip) { width: 17px; height: 17px; background: #fff; box-shadow: 3px 3px 6px rgba(20,48,35,.08); }
:deep(.leaflet-popup.biodiversity-plant-popup .leaflet-popup-close-button) { top: 9px; right: 10px; z-index: 1; width: 30px; height: 30px; color: #455b4e; font: 26px/28px Arial, sans-serif; }
:deep(.plant-popup-card) { display: grid; color: #122b20; font-family: inherit; }
:deep(.plant-popup-header) { display: flex; align-items: center; gap: 13px; min-width: 0; padding: 0 28px 8px 0; }
:deep(.plant-popup-image-wrap) { position: relative; flex: 0 0 72px; width: 72px; height: 72px; overflow: hidden; border-radius: 12px; background: #eaf2e8; }
:deep(.plant-popup-image) { display: block; width: 100%; height: 100%; object-fit: cover; }
:deep(.plant-popup-image-fallback) { position: absolute; inset: 0; display: grid; place-items: center; color: #18764c; }
:deep(.plant-popup-image-fallback[hidden]) { display: none; }
:deep(.plant-image-leaf) { width: 38px; height: 38px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
:deep(.plant-popup-identity) { min-width: 0; }
:deep(.plant-popup-identity > *) { display: block; margin: 0 0 3px; overflow-wrap: anywhere; }
:deep(.plant-popup-card .plant-popup-id) { color: #102e22; font-size: 21px; font-weight: 800; line-height: 1.15; }
:deep(.plant-popup-card .plant-popup-scientific) { color: #193c2c; font-size: 14px; font-weight: 650; line-height: 1.3; }
:deep(.plant-popup-card .plant-popup-common) { color: #69786f; font-size: 13px; font-style: italic; }
:deep(.plant-popup-details) { display: grid; margin: 1px 0 11px; }
:deep(.plant-popup-row) { display: grid; grid-template-columns: 20px minmax(0, 1fr) minmax(0, 1.04fr); align-items: center; gap: 9px; min-height: 31px; border-bottom: 1px solid #edf0ed; }
:deep(.plant-popup-icon) { width: 18px; height: 18px; fill: none; stroke: #173f30; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
:deep(.plant-popup-row dt) { min-width: 0; color: #24372d; font-size: 12px; font-weight: 700; line-height: 1.25; }
:deep(.plant-popup-row dd) { min-width: 0; margin: 0; color: #344a3e; font-size: 12px; line-height: 1.25; overflow-wrap: anywhere; }
:deep(.plant-popup-row .plant-popup-status) { justify-self: start; padding: 4px 9px; border-radius: 999px; background: #b8e8ad; color: #173e28; font-weight: 700; }
:deep(.plant-popup-row .plant-popup-status.pending-review) { background: #f7e7a9; color: #55400b; }
:deep(.plant-popup-row .plant-popup-status.flagged), :deep(.plant-popup-row .plant-popup-status.rejected) { background: #f4c9c3; color: #63251e; }
:deep(.plant-popup-actions) { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; margin-top: 11px; }
:deep(.plant-popup-actions a), :deep(.plant-popup-actions button) { box-sizing: border-box; display: flex; align-items: center; justify-content: center; gap: 7px; min-width: 0; min-height: 40px; padding: 7px 9px; border: 1px solid #83a793; border-radius: 11px; background: #fff; color: #164331; font: inherit; font-size: 11px; font-weight: 700; line-height: 1.25; text-align: center; text-decoration: none; cursor: pointer; }
:deep(.plant-popup-actions button) { border-color: #075338; background: #075338; color: #fff; }
:deep(.plant-popup-actions svg) { order: -1; flex: 0 0 17px; width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
:deep(.plant-popup-actions a:hover), :deep(.plant-popup-actions button:hover) { filter: brightness(.96); }
@media (max-width: 1250px) {
  .map-filter-toolbar { grid-template-columns: minmax(0, 1.35fr) minmax(0, .85fr) minmax(0, 1fr) minmax(0, .9fr); gap: 12px; padding-inline: 14px; }
  .map-filter-divider { display: none; }
}
@media (max-width: 1100px) {
  .map-selected-card { grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); }
  .selected-identity { grid-row: span 2; }
  .selected-info-section { border-right: 0; padding-right: 0; }
  .selected-location-section { padding: 0 18px 0 0; border-right: 1px solid rgba(255,255,255,.43); }
  .selected-actions-section { grid-column: 2; display: grid; grid-template-columns: 1fr 1fr; }
}
@media (max-width: 760px) {
  .map-page-intro { margin-bottom: 15px; }
  .map-page-intro h2 { font-size: 1.65rem; }
  .map-page-intro p { font-size: .85rem; }
  .map-filter-toolbar { grid-template-columns: 1fr; gap: 12px; padding: 14px; }
  .map-filter-divider { width: 100%; height: 1px; }
  .map-filter-toolbar .field > span:first-child { font-size: 13px; }
  .map-shell { height: 440px; min-height: 440px; }
  .officer-layout .map-card .map-shell .map-summary { left: 10px; right: 10px; top: 10px; width: auto; max-width: none; gap: 6px; }
  .officer-layout .map-card .map-shell .map-summary article { grid-template-columns: 18px minmax(0, 1fr); grid-template-rows: auto auto; justify-items: stretch; column-gap: 5px; row-gap: 1px; min-height: 74px; padding: 7px 6px; text-align: left; }
  .map-summary-icon { grid-column: 1; grid-row: 1; width: 18px; height: 18px; }
  .officer-layout .map-card .map-shell .map-summary small { grid-column: 2; grid-row: 1; font-size: 8px; line-height: 1.15; white-space: normal; overflow-wrap: anywhere; }
  .officer-layout .map-card .map-shell .map-summary strong { grid-column: 2; grid-row: 2; margin: 0; font-size: 16px; }
  .fit-map-button { right: 9px; bottom: 25px; min-height: 39px; padding: 7px 10px; font-size: 11px; }
  .coordinate-info { margin: 5px 0 12px; padding: 8px 11px; font-size: 11px; }
  .map-selected-card { grid-template-columns: minmax(0, 1fr); gap: 10px; min-height: 0; margin-bottom: 14px; padding: 15px; }
  .selected-identity { grid-row: auto; gap: 13px; padding: 0 0 12px; border-right: 0; border-bottom: 1px solid rgba(255,255,255,.43); }
  .selected-plant-image { flex-basis: 86px; width: 86px; height: 86px; border-radius: 11px; }
  .selected-plant-image-fallback svg { width: 40px; height: 40px; }
  .officer-layout.officer-layout .map-selected-card .selected-identity h3 { margin-bottom: 5px; font-size: 1rem; }
  .selected-identity-copy p { margin-bottom: 8px; font-size: 12px; }
  .selected-status-badge { padding: 5px 8px; font-size: 11px; }
  .selected-info-section, .selected-location-section { padding: 0; border-right: 0; }
  .selected-info-row { gap: 9px; padding: 8px 0; }
  .selected-info-row > svg { flex-basis: 20px; width: 20px; height: 20px; }
  .selected-info-row strong { font-size: 12px; }
  .selected-info-row span { font-size: 11px; }
  .selected-actions-section { grid-column: auto; display: grid; grid-template-columns: 1fr; gap: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,.43); }
  :deep(.leaflet-popup.biodiversity-plant-popup .leaflet-popup-content) { width: min(390px, calc(100vw - 72px)) !important; max-width: calc(100vw - 72px); margin: 13px; }
  :deep(.plant-popup-row) { grid-template-columns: 18px minmax(0, .95fr) minmax(0, 1.05fr); gap: 7px; }
  :deep(.plant-popup-row dt), :deep(.plant-popup-row dd) { font-size: 11px; }
  :deep(.plant-popup-actions) { gap: 6px; }
  :deep(.plant-popup-actions a), :deep(.plant-popup-actions button) { min-height: 42px; padding-inline: 6px; font-size: 10px; }
}
@media (max-width: 420px) {
  .map-shell { height: 400px; min-height: 400px; }
  .officer-layout .map-card .map-shell .map-summary article { min-height: 69px; }
  .officer-layout .map-card .map-shell .map-summary small { font-size: 8px; }
  :deep(.leaflet-popup.biodiversity-plant-popup .leaflet-popup-content-wrapper) { border-radius: 14px; }
  :deep(.leaflet-popup.biodiversity-plant-popup .leaflet-popup-content) { width: min(345px, calc(100vw - 72px)) !important; margin: 11px; }
  :deep(.plant-popup-image-wrap) { flex-basis: 58px; width: 58px; height: 58px; }
  :deep(.plant-popup-card .plant-popup-id) { font-size: 18px; }
  :deep(.plant-popup-card .plant-popup-scientific) { font-size: 12px; }
  :deep(.plant-popup-card .plant-popup-common) { font-size: 11px; }
}
</style>
