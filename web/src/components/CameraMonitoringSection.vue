<script setup lang="ts">
import { Chart, registerables } from 'chart.js'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import AppModal from './conservation/AppModal.vue'
import type { CameraEvent, PlantCameraStatus } from '../types/cameraMonitoring'

Chart.register(...registerables)

interface CameraStatusResponse extends PlantCameraStatus {
  error?: string | null
}

const camera = ref<CameraStatusResponse>({
  cameraId: 'CAM-001',
  plantId: 'PL001',
  name: 'Plant Monitoring Camera 01',
  status: 'Offline',
})
const cameraEvents = ref<CameraEvent[]>([])
const connectionError = ref('Start the local camera server to connect the feed.')
const latestEvent = computed(() => cameraEvents.value[0] ?? null)
const cameraOnline = computed(() => camera.value.status === 'Online')
const streamUrl = '/camera-api/video-feed'
const cameraExpanded = ref(false)
const confidenceCanvas = ref<HTMLCanvasElement | null>(null)
const currentSystemTime = ref(new Date())
let confidenceChart: Chart | null = null
let clockInterval: ReturnType<typeof setInterval> | null = null
let cameraPollInterval: ReturnType<typeof setInterval> | null = null

const localTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
})
const formattedSystemTime = computed(() => localTimeFormatter.format(currentSystemTime.value))

const formatConfidence = (confidence: number | null) =>
  confidence === null ? 'Not available' : String(Math.round(confidence * 100)) + '%'

const formatDateTime = (value?: string) => {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not available'
  return new Intl.DateTimeFormat('en-MY', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

const eventCounts = computed(() => ({
  possiblePlantContact: cameraEvents.value.filter(
    (event) => event.eventType === 'possible_plant_contact',
  ).length,
  humanDetected: cameraEvents.value.filter((event) => event.eventType === 'human_detected').length,
  animalDetected: cameraEvents.value.filter((event) => event.eventType === 'animal_detected').length,
  total: cameraEvents.value.length,
}))

const renderConfidenceChart = async () => {
  confidenceChart?.destroy()
  confidenceChart = null
  await nextTick()
  if (!confidenceCanvas.value) return

  confidenceChart = new Chart(confidenceCanvas.value, {
    type: 'line',
    data: {
      labels: cameraEvents.value.map((event) =>
        new Intl.DateTimeFormat('en-MY', { hour: 'numeric', minute: '2-digit' }).format(
          new Date(event.detectedAt),
        ),
      ),
      datasets: [{
        data: cameraEvents.value.map((event) =>
          event.confidence === null ? null : Math.round(event.confidence * 100),
        ),
        borderColor: '#4f9774',
        backgroundColor: 'rgba(79, 151, 116, 0.12)',
        borderWidth: 2,
        pointBackgroundColor: '#f7fbf8',
        pointBorderColor: '#3f866a',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 5,
        tension: 0.28,
        fill: true,
        spanGaps: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => {
              const event = cameraEvents.value[items[0]?.dataIndex ?? 0]
              return event ? formatDateTime(event.detectedAt) : ''
            },
            label: (context) => 'Detection confidence: ' + context.parsed.y + '%',
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#75867e', font: { size: 9 } } },
        y: {
          min: 0,
          max: 100,
          grid: { color: 'rgba(76, 108, 94, 0.09)' },
          ticks: {
            color: '#75867e',
            font: { size: 9 },
            callback: (value) => String(value) + '%',
          },
        },
      },
    },
  })
}

const loadCameraData = async () => {
  try {
    const [statusResponse, eventsResponse] = await Promise.all([
      fetch('/camera-api/camera-status', { cache: 'no-store' }),
      fetch('/camera-api/camera-events', { cache: 'no-store' }),
    ])
    if (!statusResponse.ok || !eventsResponse.ok) throw new Error('Camera server unavailable.')
    camera.value = (await statusResponse.json()) as CameraStatusResponse
    const result = (await eventsResponse.json()) as { events?: CameraEvent[] }
    cameraEvents.value = Array.isArray(result.events) ? result.events : []
    connectionError.value = camera.value.error ?? ''
    await renderConfidenceChart()
  } catch (error) {
    camera.value = { ...camera.value, status: 'Offline' }
    connectionError.value = error instanceof Error ? error.message : 'Camera server unavailable.'
  }
}

onMounted(() => {
  void loadCameraData()
  cameraPollInterval = setInterval(() => void loadCameraData(), 3000)
  clockInterval = setInterval(() => {
    currentSystemTime.value = new Date()
  }, 1000)
})
onBeforeUnmount(() => {
  confidenceChart?.destroy()
  if (clockInterval !== null) clearInterval(clockInterval)
  if (cameraPollInterval !== null) clearInterval(cameraPollInterval)
})
</script>

<template>
  <section class="panel camera-monitoring-section">
    <header class="panel-header camera-header">
      <div>
        <p class="camera-kicker">LIVE LOCAL CAMERA</p>
        <h2>Camera Monitoring</h2>
        <span class="panel-description">
          AI detections are streamed directly from the local camera server without database storage.
        </span>
      </div>
      <span class="badge" :class="cameraOnline ? 'online' : 'unavailable'">{{ camera.status }}</span>
    </header>

    <div class="camera-console-row camera-primary-row">
      <article class="camera-hero-shell">
        <div class="camera-preview" role="group" aria-label="Live AI camera preview">
          <div class="preview-overlay preview-identity">
            <strong>{{ camera.name }}</strong>
            <span>{{ camera.cameraId }}</span>
          </div>
          <div class="preview-overlay preview-state">
            <span>{{ formattedSystemTime }}</span>
          </div>
          <img v-if="cameraOnline" :src="streamUrl" alt="Live AI plant monitoring camera" />
          <div v-else class="feed-placeholder">
            <span class="feed-icon" aria-hidden="true">▣</span>
            <strong>Camera feed unavailable</strong>
            <small>{{ connectionError || 'Waiting for camera frames' }}</small>
          </div>
          <div class="preview-overlay preview-plant">
            <span>Related Plant</span>
            <strong>{{ camera.plantId }}</strong>
          </div>
          <button
            class="expand-camera-button"
            type="button"
            aria-label="Expand live camera preview"
            @click="cameraExpanded = true"
          >
            <span aria-hidden="true">↗</span>
            Expand Camera
          </button>
        </div>
      </article>

      <aside class="prototype-analytics" aria-label="Live camera analytics">
        <div class="section-heading">
          <p class="camera-kicker">IN-MEMORY CAMERA EVENTS</p>
          <h3>Live Analytics</h3>
        </div>
        <div class="confidence-block">
          <div>
            <strong>Detection confidence</strong>
            <small>Based on {{ cameraEvents.length }} events from this server session.</small>
          </div>
          <div class="confidence-chart">
            <canvas
              ref="confidenceCanvas"
              role="img"
              aria-label="Live camera detection confidence"
            ></canvas>
          </div>
          <ul class="sr-only">
            <li v-for="event in cameraEvents" :key="event.eventId">
              {{ formatDateTime(event.detectedAt) }}: {{ formatConfidence(event.confidence) }}
            </li>
          </ul>
        </div>
        <div class="detection-summary">
          <h4>Detection Summary</h4>
          <dl>
            <div>
              <dt>Possible plant contact</dt>
              <dd>{{ eventCounts.possiblePlantContact }}</dd>
            </div>
            <div>
              <dt>Human detected</dt>
              <dd>{{ eventCounts.humanDetected }}</dd>
            </div>
            <div>
              <dt>Animal detected</dt>
              <dd>{{ eventCounts.animalDetected }}</dd>
            </div>
            <div class="summary-total">
              <dt>Total live events</dt>
              <dd>{{ eventCounts.total }}</dd>
            </div>
          </dl>
        </div>
      </aside>
    </div>

    <div class="camera-console-row camera-secondary-row">
      <article class="latest-detection">
        <p class="camera-kicker">LATEST LIVE DETECTION</p>
        <template v-if="latestEvent">
          <h3>{{ latestEvent.title }}</h3>
          <p>{{ latestEvent.description }}</p>
          <dl class="detection-meta">
            <div>
              <dt>Detection confidence</dt>
              <dd>{{ formatConfidence(latestEvent.confidence) }}</dd>
            </div>
            <div>
              <dt>Detected</dt>
              <dd>{{ formatDateTime(latestEvent.detectedAt) }}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <span class="badge new">{{ latestEvent.status }}</span>
              </dd>
            </div>
          </dl>
          <div class="camera-actions">
            <RouterLink
              class="action-button"
              :to="{ name: 'conservation-map', query: { plant: latestEvent.plantId } }"
              >View on Map</RouterLink
            >
            <RouterLink
              class="action-button"
              :to="{ name: 'conservation-alerts', query: { alert: latestEvent.eventId } }"
              >View Alert / Event</RouterLink
            >
          </div>
        </template>
        <p v-else>No human or animal detections have been received in this server session.</p>
      </article>
    </div>

    <AppModal
      v-if="cameraExpanded"
      title="Expanded Camera Preview"
      :subtitle="camera.name + ' · ' + camera.cameraId"
      wide
      @close="cameraExpanded = false"
    >
      <p class="modal-prototype-label">LIVE LOCAL CAMERA</p>
      <div class="camera-preview expanded-preview">
        <div class="preview-overlay preview-identity">
          <strong>{{ camera.name }}</strong>
          <span>{{ camera.cameraId }}</span>
        </div>
        <div class="preview-overlay preview-state">
          <span>{{ formattedSystemTime }}</span>
        </div>
        <img v-if="cameraOnline" :src="streamUrl" alt="Expanded live AI plant monitoring camera" />
        <div v-else class="feed-placeholder">
          <span class="feed-icon" aria-hidden="true">▣</span>
          <strong>Camera feed unavailable</strong>
          <small>{{ connectionError || 'Waiting for camera frames' }}</small>
        </div>
      </div>
      <dl class="expanded-meta">
        <div>
          <dt>Related Plant</dt>
          <dd>{{ camera.plantId }}</dd>
        </div>
        <div>
          <dt>Camera Status</dt>
          <dd>{{ camera.status }}</dd>
        </div>
        <div>
          <dt>Last Activity</dt>
          <dd>{{ formatDateTime(camera.lastSeenAt) }}</dd>
        </div>
        <div v-if="latestEvent">
          <dt>Latest Detection</dt>
          <dd>{{ latestEvent.title }} · {{ formatConfidence(latestEvent.confidence) }}</dd>
        </div>
      </dl>
      <div v-if="latestEvent" class="modal-actions">
        <RouterLink
          class="secondary-button modal-link"
          :to="{ name: 'conservation-map', query: { plant: latestEvent.plantId } }"
          @click="cameraExpanded = false"
          >View on Map</RouterLink
        >
        <RouterLink
          class="secondary-button modal-link"
          :to="{ name: 'conservation-alerts', query: { alert: latestEvent.eventId } }"
          @click="cameraExpanded = false"
          >View Alert / Event</RouterLink
        >
      </div>
    </AppModal>
  </section>
</template>

<style scoped>
.camera-monitoring-section {
  margin-top: 18px;
}
.camera-header {
  align-items: flex-start;
}
.camera-kicker {
  margin: 0 0 5px;
  color: #4d9074;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 1.35px;
}
.badge.unavailable {
  background: #e8eff2;
  color: #53727c;
}
.badge.online {
  background: #dff3e8;
  color: #26724e;
}
.camera-console-row {
  display: grid;
  gap: 16px;
}
.camera-primary-row {
  grid-template-columns: minmax(0, 1.75fr) minmax(250px, 0.75fr);
  align-items: start;
}
.camera-secondary-row {
  grid-template-columns: minmax(0, 1fr);
  margin-top: 16px;
}
.camera-hero-shell,
.prototype-analytics,
.latest-detection {
  min-width: 0;
  border: 1px solid #e4eae5;
  border-radius: 13px;
  background: #fbfcfa;
}
.camera-hero-shell {
  width: 100%;
  align-self: start;
  overflow: hidden;
  background: #20332d;
}
.camera-preview {
  width: 100%;
  position: relative;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: radial-gradient(circle at 50% 45%, #3a564b 0, #263d35 48%, #182a24 100%);
  color: #eef4ef;
}
.camera-preview > video,
.camera-preview > img,
.camera-preview > canvas {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}
.camera-preview::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(
    180deg,
    rgba(8, 22, 17, 0.58),
    transparent 29%,
    transparent 68%,
    rgba(8, 22, 17, 0.52)
  );
}
.feed-placeholder {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  text-align: center;
}
.feed-icon {
  color: #8eb3a3;
  font-size: 34px;
}
.feed-placeholder small {
  color: #b9c7c1;
}
.preview-overlay {
  position: absolute;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 10px;
}
.preview-overlay strong {
  font-size: 11px;
}
.preview-overlay span {
  color: #c2d0ca;
}
.preview-identity {
  top: 16px;
  left: 16px;
}
.preview-state {
  top: 16px;
  right: 16px;
  align-items: flex-end;
  text-align: right;
}
.preview-plant {
  bottom: 16px;
  left: 16px;
}
.expand-camera-button {
  position: absolute;
  right: 16px;
  bottom: 16px;
  z-index: 3;
  padding: 8px 11px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(229, 239, 233, 0.38);
  border-radius: 8px;
  background: rgba(20, 50, 39, 0.84);
  color: #f3f8f5;
  cursor: pointer;
  font: inherit;
  font-size: 10px;
  font-weight: 800;
  transition:
    transform 160ms ease,
    background 160ms ease;
}
.expand-camera-button:hover {
  transform: translateY(-2px);
  background: rgba(43, 91, 70, 0.94);
}
.expand-camera-button:focus-visible {
  outline: 3px solid rgba(164, 211, 190, 0.72);
  outline-offset: 3px;
}
.prototype-analytics,
.latest-detection {
  padding: 17px;
}
.section-heading h3 {
  margin: 0;
  color: #315447;
  font-size: 15px;
}
.confidence-block {
  padding: 13px 0 15px;
  border-bottom: 1px solid #e3e9e4;
}
.confidence-block > div:first-child {
  display: grid;
  gap: 3px;
}
.confidence-block strong,
.detection-summary h4 {
  color: #466359;
  font-size: 10px;
}
.confidence-block small {
  color: #87958e;
  font-size: 9px;
}
.confidence-chart {
  position: relative;
  height: 145px;
  margin-top: 8px;
}
.detection-summary {
  padding-top: 14px;
}
.detection-summary h4 {
  margin: 0 0 8px;
  text-transform: uppercase;
  letter-spacing: 0.55px;
}
.detection-summary dl {
  margin: 0;
}
.detection-summary dl div {
  padding: 6px 0;
  display: flex;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid #edf0ed;
}
.detection-summary dt {
  color: #71817a;
  font-size: 9px;
  text-transform: none;
}
.detection-summary dd {
  margin: 0;
  color: #315447;
  font-size: 10px;
  font-weight: 800;
}
.detection-summary .summary-total {
  padding-top: 9px;
  border-bottom: 0;
}
.detection-meta div {
  padding: 10px;
  border-radius: 9px;
  background: #fff;
}
dt {
  color: #84918b;
  font-size: 8px;
  font-weight: 800;
  text-transform: uppercase;
}
dd {
  margin: 4px 0 0;
  color: #315447;
  font-size: 11px;
  font-weight: 700;
  overflow-wrap: anywhere;
}
.latest-detection h3 {
  margin: 8px 0;
  color: #315447;
  font-size: 17px;
}
.latest-detection > p:not(.camera-kicker) {
  color: #63776d;
  font-size: 11px;
  line-height: 1.55;
}
.detection-meta {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin: 16px 0 0;
}
.camera-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}
.camera-actions .action-button {
  text-decoration: none;
}
.modal-prototype-label {
  margin: 0 0 10px;
  color: #4d9074;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 1.35px;
}
.expanded-preview {
  min-height: 360px;
  border-radius: 12px;
}
.expanded-meta {
  margin: 16px 0 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.expanded-meta div {
  padding: 10px;
  border-bottom: 1px solid #e5ebe6;
}
.modal-link {
  display: inline-flex;
  align-items: center;
  text-decoration: none;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
@media (max-width: 960px) {
  .camera-primary-row {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 520px) {
  .camera-preview {
    min-height: 0;
  }
  .preview-identity {
    left: 12px;
    max-width: 46%;
  }
  .preview-state {
    top: 12px;
    right: 12px;
    max-width: 46%;
    align-items: flex-end;
    text-align: right;
  }
  .preview-state span {
    max-width: 100%;
    line-height: 1.3;
  }
  .expand-camera-button {
    right: 12px;
    bottom: 12px;
  }
  .detection-meta,
  .expanded-meta {
    grid-template-columns: 1fr;
  }
  .expanded-preview {
    min-height: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .expand-camera-button {
    transition: none;
  }
}
</style>
