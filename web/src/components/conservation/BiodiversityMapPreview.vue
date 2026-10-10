<script setup lang="ts">
import 'leaflet/dist/leaflet.css'
import * as L from 'leaflet'
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { conservationStore, speciesForPlant, speciesRequestForPlant } from '../../data/conservation'

const router = useRouter()
const mapElement = ref<HTMLElement | null>(null)
let map: L.Map | null = null
let markerLayer: L.LayerGroup | null = null
let resizeObserver: ResizeObserver | null = null
let resizeFrame: number | null = null
let settleTimer: ReturnType<typeof setTimeout> | null = null

const mappedPlants = conservationStore.plants.filter(
  (plant) => Number.isFinite(plant.latitude) && Number.isFinite(plant.longitude),
)

const scientificNameFor = (plantId: string) =>
  speciesForPlant(plantId)?.scientificName ??
  speciesRequestForPlant(plantId)?.proposedScientificName ??
  'Identification pending'

const openPlantOnFullMap = async (plantId: string) => {
  await router.push({
    name: 'conservation-map',
    query: { plant: plantId },
  })
}

const markerIcon = () =>
  L.divIcon({
    className: 'preview-plant-marker-host',
    html: `<span class="preview-plant-marker-pin" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 20v-5m0 0c-4.8 0-7-2.7-7-6.7 3.8-.5 6.4.9 7 4.1.6-3.2 3.2-4.6 7-4.1 0 4-2.2 6.7-7 6.7Z"/></svg></span>`,
    iconSize: [38, 46],
    iconAnchor: [19, 44],
    tooltipAnchor: [0, -38],
  })

const scheduleMapResize = () => {
  if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = null
    map?.invalidateSize({ pan: false })
  })
}

onMounted(async () => {
  await nextTick()
  if (!mapElement.value || !mappedPlants.length || map) return

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

  const bounds = L.latLngBounds([])
  mappedPlants.forEach((plant) => {
    const scientificName = scientificNameFor(plant.id)
    const marker = L.marker([plant.latitude, plant.longitude], {
      icon: markerIcon(),
      title: `${plant.id}: ${scientificName}`,
      riseOnHover: true,
      keyboard: true,
    })
      .bindTooltip(`<strong>${plant.id}</strong><br><em>${scientificName}</em>`, {
        direction: 'top',
        opacity: 0.96,
      })
      .on('click', () => {
        void router.push({ name: 'conservation-map', query: { plant: plant.id } })
      })
      .addTo(markerLayer!)
    bounds.extend(marker.getLatLng())
  })
  resizeObserver = new ResizeObserver(scheduleMapResize)
  resizeObserver.observe(mapElement.value)
  await nextTick()
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = null
    map?.invalidateSize({ pan: false })
    map?.fitBounds(bounds, { padding: [32, 32], maxZoom: 16 })
  })
  settleTimer = setTimeout(() => {
    map?.invalidateSize({ pan: false })
  }, 150)
})

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
})
</script>

<template>
  <div class="dashboard-map-preview-shell">
    <div
      v-if="mappedPlants.length"
      ref="mapElement"
      class="dashboard-map-preview"
      aria-label="Plant distribution map preview"
    ></div>
    <div v-else class="dashboard-map-empty" role="status">No mapped plant records available.</div>
  </div>
</template>

<style scoped>
.dashboard-map-preview-shell {
  min-height: 285px;
  overflow: hidden;
  border: 1px solid #dfe7df;
  border-radius: 12px;
  background: #dce8dc;
}
.dashboard-map-preview {
  width: 100%;
  height: 285px;
  z-index: 0;
}
.dashboard-map-empty {
  min-height: 285px;
  display: grid;
  place-items: center;
  padding: 20px;
  color: #687a71;
  font-size: 10px;
  text-align: center;
}
:deep(.leaflet-control-attribution) {
  max-width: calc(100% - 16px);
  font-size: 7px;
  white-space: normal;
}
:deep(.preview-plant-marker-host) {
  background: transparent;
  border: 0;
}
:deep(.preview-plant-marker-pin) {
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
:deep(.preview-plant-marker-pin svg) {
  width: 22px;
  height: 22px;
  fill: currentColor;
  transform: rotate(45deg);
}
:deep(.preview-plant-marker-host:hover .preview-plant-marker-pin),
:deep(.preview-plant-marker-host:focus .preview-plant-marker-pin) {
  background: #246c45;
  transform: rotate(-45deg) scale(1.14);
}
:deep(.preview-plant-marker-host:focus-visible) {
  outline: 3px solid rgba(255, 255, 255, 0.9);
  outline-offset: 3px;
}
:deep(.leaflet-tooltip) {
  border: 0;
  border-radius: 8px;
  color: #315548;
  box-shadow: 0 5px 14px rgba(17, 53, 39, 0.2);
  font-size: 9px;
  line-height: 1.45;
}
@media (max-width: 620px) {
  .dashboard-map-preview-shell,
  .dashboard-map-preview,
  .dashboard-map-empty {
    min-height: 280px;
  }
  .dashboard-map-preview {
    height: 280px;
  }
}
@media (prefers-reduced-motion: reduce) {
  :deep(.preview-plant-marker-pin) {
    transition: background-color 0.16s ease;
  }
  :deep(.preview-plant-marker-host:hover .preview-plant-marker-pin),
  :deep(.preview-plant-marker-host:focus .preview-plant-marker-pin) {
    transform: rotate(-45deg);
  }
}
</style>
