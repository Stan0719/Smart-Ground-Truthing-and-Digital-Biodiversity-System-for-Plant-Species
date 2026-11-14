<script setup lang="ts">
import type { IoTReading } from '../services/iotMonitoring'
import type { DetailLocation } from '../services/plantDetail'
import { iotDate, soilCondition, surfaceCondition } from '../utils/iotDisplay'

defineProps<{
  plantId: string
  plantLabel: string
  reading: IoTReading | null
  location: DetailLocation | null
  locationLoading: boolean
  locationError: string
  readingsBusy: boolean
  readingsError: string
}>()
defineEmits<{ refresh: [] }>()
const measurement = (value: number | null | undefined, unit: string) =>
  value != null && Number.isFinite(value) ? `${value}${unit}` : '—'
</script>

<template>
  <section class="plant-conditions" aria-label="Camera plant conditions">
    <header class="conditions-heading">
      <div><span class="conditions-kicker">{{ plantLabel || 'Related plant' }}</span><h3>Plant conditions</h3></div>
      <button type="button" class="conditions-refresh" :disabled="!plantId || readingsBusy || locationLoading" @click="$emit('refresh')">{{ readingsBusy || locationLoading ? 'Refreshing…' : 'Refresh' }}</button>
    </header>
    <p v-if="!plantId" class="conditions-note">Connect the camera to identify its linked plant.</p>
    <dl class="conditions-grid">
      <div><dt>Temperature</dt><dd>{{ measurement(reading?.temperature_c, ' °C') }}</dd></div>
      <div><dt>Humidity</dt><dd>{{ measurement(reading?.humidity, '%') }}</dd></div>
      <div><dt>Soil condition</dt><dd>{{ soilCondition(reading?.soil_moisture) }}</dd></div>
      <div><dt>Surface condition</dt><dd>{{ surfaceCondition(reading?.rainfall_mm) }}</dd></div>
    </dl>
    <div class="conditions-location">
      <div>
        <span class="location-label">Fixed plant location</span>
        <template v-if="location">
          <strong v-if="location.zone">{{ location.zone }}</strong>
          <span class="location-coordinates">{{ location.latitude }}, {{ location.longitude }}</span>
        </template>
        <span v-else>{{ locationLoading ? 'Loading location…' : 'Location unavailable' }}</span>
      </div>
      <RouterLink v-if="location && plantId" :to="{ name: 'conservation-map', query: { plant: plantLabel || plantId } }" class="conditions-map">View on map <span aria-hidden="true">↗</span></RouterLink>
    </div>
    <p class="conditions-note">{{ reading ? `Reading recorded: ${iotDate(reading.recorded_at)}` : readingsBusy ? 'Loading sensor readings…' : plantId ? 'No sensor readings available for this plant.' : 'Sensor readings unavailable.' }}</p>
    <p v-if="readingsError" class="conditions-error" role="alert">{{ readingsError }} Displayed readings have not been updated.</p>
    <p v-if="locationError" class="conditions-error" role="alert">{{ locationError }}</p>
  </section>
</template>

<style scoped>
.plant-conditions { padding: 18px; background: #f8fbf8; color: #254b3d; }
.conditions-heading { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 15px; }
.conditions-kicker { color: #567461; font-size: 11px; font-weight: 700; letter-spacing: .7px; }
.conditions-heading h3 { margin: 3px 0 0; color: #254b3d; font-size: 17px; }
.conditions-refresh { padding: 7px 12px; border: 1px solid #b9cfc0; border-radius: 8px; background: #fff; color: #315f49; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
.conditions-refresh:disabled { cursor: default; opacity: .6; }
.conditions-refresh:focus-visible, .conditions-map:focus-visible { outline: 3px solid #33745d; outline-offset: 3px; }
.conditions-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 0; }
.conditions-grid > div { padding: 12px; min-width: 0; border: 1px solid #e0e9e2; border-radius: 10px; background: #fff; }
.conditions-grid dt { color: #61776a; font-size: 11px; font-weight: 600; line-height: 1.4; }
.conditions-grid dd { margin: 7px 0 0; color: #254b3d; font-size: 18px; font-weight: 700; line-height: 1.35; overflow-wrap: anywhere; }
.conditions-location { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 14px; padding-top: 13px; border-top: 1px solid #dfe8e0; }
.conditions-location > div { display: grid; gap: 4px; min-width: 0; font-size: 13px; overflow-wrap: anywhere; }
.location-label { color: #61776a; font-size: 11px; font-weight: 600; }
.location-coordinates { font-variant-numeric: tabular-nums; }
.conditions-map { flex-shrink: 0; color: #315f49; font-size: 12px; font-weight: 700; text-decoration: none; }
.conditions-note { margin: 12px 0 0; color: #61776a; font-size: 12px; line-height: 1.5; }
.conditions-error { margin: 8px 0 0; color: #9d3b30; font-size: 12px; line-height: 1.5; }
@media (max-width: 700px) { .conditions-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 380px) { .plant-conditions { padding: 12px; } .conditions-grid { gap: 8px; } .conditions-grid > div { padding: 10px; } .conditions-grid dd { font-size: 16px; } }
</style>
