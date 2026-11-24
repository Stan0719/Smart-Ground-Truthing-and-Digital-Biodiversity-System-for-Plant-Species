<script setup lang="ts">
import 'leaflet/dist/leaflet.css'
import * as L from 'leaflet'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatPlantId } from '../../utils/plantId'
interface Point { plantId: string; status: string; latitude?: number | null; longitude?: number | null; accuracy?: number | null; source: string }
const props = defineProps<{ target: Point; candidate: Point }>()
const emit = defineEmits<{ close: [] }>()
const { t, locale } = useI18n(), label = (key: string) => t('plantProximity.' + key)
const dialog = ref<HTMLDialogElement | null>(null), canvas = ref<HTMLElement | null>(null)
const located = (p: Point) => typeof p.latitude === 'number' && Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 90 && typeof p.longitude === 'number' && Number.isFinite(p.longitude) && Math.abs(p.longitude) <= 180
const records = computed(() => [{ ...props.target, role: 'currentSubmission', color: '#E65B32' }, { ...props.candidate, role: 'nearbyPlant', color: '#176BD2' }])
const separated = ref(false)
const separationNotice = computed(() => locale.value === 'ms' ? 'Penanda dipisahkan secara visual. Garisan menunjukkan lokasi GPS sebenar.' : locale.value === 'zh-CN' ? '标记仅作视觉分离，连线指向实际 GPS 位置。' : 'Markers are visually separated. Connecting lines point to the actual GPS locations.')
const coordinateLabel = (p: Point) => located(p) ? `${p.latitude}, ${p.longitude}` : label('locationUnavailable')
const statusLabel = (status: string) => t('dashboardValues.' + status.toLowerCase().replaceAll(' ', ''))
const accuracyLabel = (p: Point) => typeof p.accuracy === 'number' && Number.isFinite(p.accuracy) && p.accuracy >= 0 ? `${p.accuracy.toFixed(2)} m` : label('accuracyUnknown')
let map: L.Map | null = null, observer: ResizeObserver | null = null, frame: number | null = null, disposed = false
let opener: HTMLElement | null = null
const markers: L.Marker[] = []
let refreshMarkers: (() => void) | null = null
watch(() => JSON.stringify(records.value), () => refreshMarkers?.(), { flush: 'post' })
function focusMarker(index: number) { markers[index]?.openTooltip() }
function backdrop(event: MouseEvent) {
  if (event.target !== dialog.value || !dialog.value) return
  const box = dialog.value.getBoundingClientRect()
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) emit('close')
}
onMounted(async () => {
  opener = document.activeElement as HTMLElement | null
  dialog.value?.showModal()
  await nextTick()
  if (disposed || !canvas.value) return
  map = L.map(canvas.value)
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 20, maxNativeZoom: 19, attribution: 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
  }).addTo(map)
  const points: L.LatLngExpression[] = []
  function syncMarkers() {
  points.length = 0
  records.value.forEach((p, index) => {
    if (!map) return
    if (!located(p)) { markers[index]?.remove(); delete markers[index]; return }
    const point: L.LatLngExpression = [p.latitude!, p.longitude!]
    points.push(point)
    const tooltip = document.createElement('span')
    tooltip.textContent = `${label(p.role)} · ${formatPlantId(p.plantId)} · ${statusLabel(p.status)}`
    if (markers[index]) {
      markers[index]!.setLatLng(point).setTooltipContent(tooltip)
      return
    }
    markers[index] = L.marker(point, { icon: L.divIcon({ className: 'review-location-marker', iconSize: [0, 0], iconAnchor: [0, 0] }), keyboard: true, title: `${index + 1}: ${formatPlantId(p.plantId)}` }).addTo(map).bindTooltip(tooltip)
    markers[index]!.on('click', () => focusMarker(index))
  })
  }
  syncMarkers()
  function updateIcons() {
    if (!map) return
    const first = markers[0], second = markers[1]
    separated.value = Boolean(first && second && map.latLngToLayerPoint(first.getLatLng()).distanceTo(map.latLngToLayerPoint(second.getLatLng())) < 130)
    records.value.forEach((p, index) => {
      const marker = markers[index]
      if (!marker) return
      const offset = Math.max(20, Math.min(54, ((canvas.value?.clientWidth || 320) - 112) / 2))
      const dx = separated.value ? (index === 0 ? -offset : offset) : 0
      const dy = separated.value ? (index === 0 ? -28 : 28) : 0
      const host = document.createElement('div')
      host.className = 'review-marker-content'
      host.style.setProperty('--marker-color', p.color)
      if (separated.value) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        svg.classList.add('review-marker-leader')
        svg.setAttribute('viewBox', '-120 -80 240 160')
        for (const stroke of ['#FFFFFF', p.color]) {
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
          for (const [key, value] of Object.entries({ x1: '0', y1: '0', x2: String(dx), y2: String(dy), stroke, 'stroke-width': stroke === '#FFFFFF' ? '6' : '2' })) line.setAttribute(key, value)
          svg.append(line)
        }
        host.append(svg)
        const anchor = document.createElement('span')
        anchor.className = 'review-marker-anchor'; host.append(anchor)
      }
      const badge = document.createElement('span')
      badge.className = 'review-marker-badge'
      badge.style.transform = `translate(${dx}px, ${dy}px) translate(-50%, -50%)`
      const number = document.createElement('strong'); number.textContent = String(index + 1)
      const id = document.createElement('span'); id.textContent = formatPlantId(p.plantId)
      badge.append(number, id); host.append(badge)
      marker.setIcon(L.divIcon({ className: 'review-location-marker', html: host, iconSize: [0, 0], iconAnchor: [0, 0] }))
    })
  }
  map.on('zoomend', updateIcons)
  const fit = () => {
    if (frame !== null) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      frame = null
      if (disposed || !map) return
      map.invalidateSize({ pan: false })
      if (points.length) map.fitBounds(L.latLngBounds(points), { padding: [85, 65], maxZoom: 18 })
      else map.setView([3.8, 113.8], 5)
      updateIcons()
    })
  }
  refreshMarkers = () => { if (!disposed) { syncMarkers(); fit() } }
  observer = new ResizeObserver(fit); observer.observe(canvas.value); fit()
})
onBeforeUnmount(() => {
  disposed = true; observer?.disconnect()
  if (frame !== null) cancelAnimationFrame(frame)
  map?.remove(); dialog.value?.close()
  if (opener?.isConnected) opener.focus({ preventScroll: true })
})
</script>

<template>
  <dialog ref="dialog" class="review-location-dialog" :aria-label="label('mapTitle')" @cancel.prevent.stop="emit('close')" @keydown.stop @click="backdrop">
    <header><h2>{{ label('mapTitle') }}</h2><button type="button" autofocus :aria-label="label('closeDrawer')" @click="emit('close')">×</button></header>
    <div ref="canvas" class="review-location-canvas" :aria-label="label('mapTitle')" />
    <p v-if="separated" role="status">{{ separationNotice }}</p>
    <div class="review-location-legend">
      <section v-for="(point, index) in records" :key="point.role" :style="{ borderColor: point.color }">
        <button type="button" :disabled="!located(point)" @click="focusMarker(index)">{{ index + 1 }} - {{ label(point.role) }} · {{ formatPlantId(point.plantId) }}</button>
        <p v-if="point.status">{{ statusLabel(point.status) }}</p>
        <p v-if="!located(point)" role="status">{{ label('locationUnavailable') }}</p>
        <p>{{ label('mapAccuracy') }}: {{ accuracyLabel(point) }}</p>
        <p>{{ t('conservationText.coordinates') }}: {{ coordinateLabel(point) }}</p>
      </section>
    </div>
  </dialog>
</template>

<style scoped>
.review-location-dialog { box-sizing: border-box; width: min(850px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); overflow: auto; padding: 18px; border: 1px solid #91b5a1; border-radius: 14px; color: #24483c; background: #fff; }
.review-location-dialog::backdrop { background: rgb(0 0 0 / .35); }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
h2 { font-size: 20px; margin: 0 0 12px; }
button { border: 1px solid #91b5a1; border-radius: 6px; padding: 7px 10px; background: #fff; color: #245a46; cursor: pointer; font: inherit; }
button:focus-visible { outline: 3px solid #33745d; outline-offset: 2px; }
.review-location-canvas { height: min(50dvh, 430px); min-height: 230px; border-radius: 8px; }
.review-location-legend { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px; }
section { flex: 1 1 240px; border-left: 5px solid; padding: 8px; }
p { font-size: 13px; margin: 6px 0; }
</style>

<style scoped>
:deep(.review-location-marker) { background: transparent; border: 0; }
:deep(.review-marker-content) { position: relative; width: 0; height: 0; }
:deep(.review-marker-badge) { position: absolute; display: flex; align-items: center; gap: 6px; width: max-content; max-width: 108px; box-sizing: border-box; padding: 5px 9px; border: 4px solid #fff; border-radius: 22px; background: var(--marker-color); color: #142d24; box-shadow: 0 2px 5px #0009, 0 0 0 1px #243f32; font-size: 13px; font-weight: 750; white-space: nowrap; pointer-events: auto; cursor: pointer; }
:deep(.review-marker-badge strong) { display: grid; place-items: center; min-width: 20px; height: 20px; border-radius: 50%; background: #fff; color: #183d31; }
:deep(.review-marker-badge span) { overflow: hidden; text-overflow: ellipsis; background: #fff; color: #183d31; padding: 2px 4px; border-radius: 4px; }
:deep(.review-marker-leader) { position: absolute; width: 240px; height: 160px; left: -120px; top: -80px; overflow: visible; pointer-events: none; }
:deep(.review-marker-anchor) { position: absolute; width: 8px; height: 8px; border: 2px solid white; border-radius: 50%; background: var(--marker-color); transform: translate(-50%, -50%); pointer-events: none; }
:deep(.review-location-marker:focus-visible .review-marker-badge) { outline: 3px solid #fff; outline-offset: 3px; }
@media (max-width: 480px) { :deep(.review-marker-badge) { font-size: 12px; padding: 4px 6px; gap: 4px; } }
</style>
