<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { plantApi } from '../services/plantApi'
const container = ref<HTMLElement | null>(null),
  error = ref(''),
  plotted = ref(0),
  loaded = ref(false)
let map: L.Map | undefined
onMounted(async () => {
  try {
    const result = await plantApi<{
      plants: { plant_id: string; latitude: number; longitude: number }[]
    }>('/plants')
    if (!container.value) return
    map = L.map(container.value).setView([3.8, 113.8], 10)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    }).addTo(map)
    const points: L.LatLngExpression[] = []
    for (const plant of result.plants) {
      if (plant.latitude == null || plant.longitude == null) continue
      const lat = Number(plant.latitude),
        lng = Number(plant.longitude)
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        Math.abs(lat) > 90 ||
        Math.abs(lng) > 180
      )
        continue
      points.push([lat, lng])
      L.circleMarker([lat, lng], { radius: 6 }).addTo(map).bindTooltip(`Plant ${plant.plant_id}`)
    }
    plotted.value = points.length
    loaded.value = true
    if (points.length) map.fitBounds(L.latLngBounds(points), { maxZoom: 16 })
  } catch (e) {
    error.value = String(e)
  }
})
onUnmounted(() => map?.remove())
</script>
<template>
  <p v-if="error" role="alert">{{ error }}</p>
  <p v-if="loaded && !plotted">No plant coordinates are available yet.</p>
  <div ref="container" class="map" aria-label="Authorized species distribution map" />
</template>
<style scoped>
.map {
  height: 450px;
  width: 100%;
}
</style>
