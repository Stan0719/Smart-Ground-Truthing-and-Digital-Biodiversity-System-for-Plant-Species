<script setup lang="ts">
import { computed } from 'vue'
import { prototypeCameraEvents, prototypePlantCamera } from '../data/cameraMonitoringPrototype'

const latestEvent = computed(() => prototypeCameraEvents[0] ?? null)
const formatConfidence = (confidence: number | null) =>
  confidence === null ? 'Not available' : `${Math.round(confidence * 100)}%`
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
</script>

<template>
  <section class="panel camera-monitoring-section">
    <header class="panel-header camera-header">
      <div>
        <p class="camera-kicker">FRONTEND PROTOTYPE</p>
        <h2>Camera Monitoring</h2>
        <span class="panel-description">
          Current monitoring preview. No live AI or camera connection is active.
        </span>
      </div>
      <span class="badge unavailable">{{ prototypePlantCamera.status }}</span>
    </header>

    <div class="camera-grid">
      <article class="camera-summary">
        <dl class="camera-meta">
          <div>
            <dt>Camera</dt>
            <dd>{{ prototypePlantCamera.name }}</dd>
          </div>
          <div>
            <dt>Camera ID</dt>
            <dd>{{ prototypePlantCamera.cameraId }}</dd>
          </div>
          <div>
            <dt>Related plant</dt>
            <dd>{{ prototypePlantCamera.plantId }}</dd>
          </div>
          <div>
            <dt>Last activity</dt>
            <dd>{{ formatDateTime(prototypePlantCamera.lastSeenAt) }}</dd>
          </div>
        </dl>
        <div class="feed-placeholder" role="img" aria-label="Camera feed unavailable">
          <span aria-hidden="true">▣</span>
          <strong>Camera feed unavailable</strong>
          <small>Awaiting camera integration</small>
        </div>
      </article>

      <article class="latest-detection">
        <p class="camera-kicker">LATEST PROTOTYPE DETECTION</p>
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
              <dd>{{ latestEvent.status }}</dd>
            </div>
          </dl>
          <div class="camera-actions">
            <RouterLink class="action-button" :to="`/plant/${latestEvent.plantId}`"
              >View Plant</RouterLink
            >
            <RouterLink
              class="action-button"
              :to="{ name: 'conservation-alerts', query: { alert: latestEvent.eventId } }"
              >View Alert / Event</RouterLink
            >
          </div>
        </template>
      </article>
    </div>
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
  letter-spacing: 1.4px;
}
.badge.unavailable {
  background: #e8eff2;
  color: #53727c;
}
.camera-grid {
  display: grid;
  grid-template-columns: 1.25fr 0.75fr;
  gap: 16px;
  padding: 18px;
}
.camera-summary,
.latest-detection {
  padding: 16px;
  border: 1px solid #e4eae5;
  border-radius: 13px;
  background: #fbfcfa;
}
.camera-meta,
.detection-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 0 0 14px;
}
.camera-meta div,
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
}
.feed-placeholder {
  min-height: 250px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border-radius: 11px;
  background: linear-gradient(145deg, #20332d, #314840);
  color: #eef4ef;
  text-align: center;
}
.feed-placeholder span {
  color: #8eb3a3;
  font-size: 34px;
}
.feed-placeholder small {
  color: #b9c7c1;
}
.latest-detection h3 {
  margin: 0 0 8px;
  color: #315447;
  font-size: 17px;
}
.latest-detection > p:not(.camera-kicker) {
  color: #63776d;
  font-size: 11px;
  line-height: 1.55;
}
.detection-meta {
  grid-template-columns: 1fr;
  margin-top: 16px;
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
@media (max-width: 800px) {
  .camera-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 520px) {
  .camera-meta {
    grid-template-columns: 1fr;
  }
}
</style>
