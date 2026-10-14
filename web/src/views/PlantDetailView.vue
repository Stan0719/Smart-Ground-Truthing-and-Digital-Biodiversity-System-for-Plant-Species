<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import NavigationBar from '../components/NavigationBar.vue'
import { plantRecords } from '../data/plantRecords'
import { plants as species } from '../data/plants'
import { usePrototypeSession } from '../composables/usePrototypeSession'

const route = useRoute()
const { t, te, locale } = useI18n()
const { isLoggedIn, userRole } = usePrototypeSession()
const canViewStaffPlantData = computed(
  () =>
    isLoggedIn.value && (userRole.value === 'admin' || userRole.value === 'conservation-officer'),
)
const plant = computed(() => plantRecords.find((item) => item.plantId === route.params.plantId))
const selectedSpecies = computed(() =>
  species.find((item) => item.slug === plant.value?.speciesSlug),
)
const primaryImage = computed(() => plant.value?.images.find((image) => image.path)?.path)
const latestApprovedObservation = computed(
  () =>
    [...(plant.value?.observations ?? [])]
      .filter((observation) => observation.status === 'Approved')
      .sort((a, b) => b.date.localeCompare(a.date))[0],
)

const optionLabel = (value: string) => {
  const optionKey = value.toLowerCase().replace(/\s+/g, '')
  const key = `species.records.options.${optionKey}`
  return te(key) ? t(key) : value
}

const translatedGenus = computed(() => {
  const key = `speciesContent.${selectedSpecies.value?.slug}.genus`
  return te(key) ? t(key) : selectedSpecies.value?.genus || '-'
})

const translatedMorphology = (lifeStage: string) =>
  t('species.plant.morphologyValue', {
    stage: optionLabel(lifeStage),
    species: t(`scientificNames.${selectedSpecies.value?.slug}`),
  })

const formatDate = (value: string) => {
  const dateLocale = locale.value === 'zh-CN' ? 'zh-CN' : locale.value === 'ms' ? 'ms-MY' : 'en-MY'
  return new Intl.DateTimeFormat(dateLocale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00`))
}
</script>

<template>
  <NavigationBar />

  <main v-if="plant && selectedSpecies" class="plant-detail-page">
    <section class="plant-hero">
      <div class="container">
        <RouterLink :to="`/species/${plant.speciesSlug}`" class="back-link"
          >←
          {{
            t('species.plant.back', { name: t(`plantNames.${selectedSpecies.slug}`) })
          }}</RouterLink
        >
        <div class="hero-grid">
          <img
            v-if="primaryImage"
            class="hero-image"
            :src="primaryImage"
            :alt="`${plant.plantId} field photograph`"
          />
          <div
            v-else
            class="image-placeholder"
            role="img"
            :aria-label="`${plant.plantId} field photo placeholder`"
          >
            <span aria-hidden="true">🌿</span><small>Field photograph coming soon</small>
          </div>
          <div class="hero-copy">
            <p class="eyebrow">{{ t('species.plant.verifiedRecord') }}</p>
            <h1>{{ t('speciesLabels.plantLabel') }} {{ plant.plantId }}</h1>
            <h2>{{ t(`plantNames.${selectedSpecies.slug}`) }}</h2>
            <p class="scientific-name">{{ t(`scientificNames.${selectedSpecies.slug}`) }}</p>
            <p class="species-summary">{{ t(`plantDescriptions.${selectedSpecies.slug}`) }}</p>
            <div class="hero-badges">
              <span v-if="canViewStaffPlantData">{{ optionLabel(plant.latestApproved.healthStatus) }}</span
              ><span>{{ optionLabel(plant.latestApproved.lifeStage) }}</span
              ><span v-if="canViewStaffPlantData">{{ optionLabel(plant.location.zone) }}</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="content-section">
      <div
        class="container content-grid"
        :class="{ 'public-content-grid': !canViewStaffPlantData }"
      >
        <div>
          <p class="eyebrow">{{ t('speciesLabels.plantInfo') }}</p>
          <h2>{{ t('species.plant.current') }}</h2>
          <div class="fact-grid">
            <div>
              <span>{{ t('speciesLabels.plantId') }}</span
              ><strong>{{ plant.plantId }}</strong>
            </div>
            <div>
              <span>{{ t('speciesLabels.species') }}</span
              ><strong>{{ t(`plantNames.${selectedSpecies.slug}`) }}</strong>
            </div>
            <div>
              <span>{{ t('speciesLabels.scientificName') }}</span
              ><strong
                ><em>{{ t(`scientificNames.${selectedSpecies.slug}`) }}</em></strong
              >
            </div>
            <div>
              <span>{{ t('speciesLabels.height') }}</span
              ><strong>{{ plant.latestApproved.heightCm }} cm</strong>
            </div>
            <div v-if="canViewStaffPlantData">
              <span>{{ t('speciesLabels.health') }}</span
              ><strong>{{ optionLabel(plant.latestApproved.healthStatus) }}</strong>
            </div>
            <div>
              <span>{{ t('speciesLabels.growthStage') }}</span
              ><strong>{{ optionLabel(plant.latestApproved.lifeStage) }}</strong>
            </div>
            <div>
              <span>{{ t('speciesLabels.genus') }}</span
              ><strong>{{ translatedGenus }}</strong>
            </div>
            <div>
              <span>{{ t('speciesLabels.lastVerified') }}</span
              ><strong>{{ formatDate(plant.latestApproved.date) }}</strong>
            </div>
            <div class="wide">
              <span>{{ t('speciesLabels.morphology') }}</span
              ><strong>{{ translatedMorphology(plant.latestApproved.lifeStage) }}</strong>
            </div>
            <div v-if="canViewStaffPlantData">
              <span>{{ t('speciesLabels.location') }}</span
              ><strong>{{ optionLabel(plant.location.zone) }}</strong>
            </div>
          </div>
        </div>

        <aside v-if="canViewStaffPlantData" class="staff-panel">
          <p class="eyebrow">{{ t('speciesLabels.staffRecord') }}</p>
          <section>
            <h3>{{ t('speciesLabels.gps') }}</h3>
            <dl>
              <div>
                <dt>{{ t('speciesLabels.latitude') }}</dt>
                <dd>{{ plant.location.latitude.toFixed(6) }}</dd>
              </div>
              <div>
                <dt>{{ t('speciesLabels.longitude') }}</dt>
                <dd>{{ plant.location.longitude.toFixed(6) }}</dd>
              </div>
              <div>
                <dt>{{ t('speciesLabels.altitude') }}</dt>
                <dd>{{ plant.location.altitudeM }} m</dd>
              </div>
              <div>
                <dt>{{ t('speciesLabels.gpsAccuracy') }}</dt>
                <dd>± {{ plant.location.accuracyM }} m</dd>
              </div>
            </dl>
          </section>
          <section>
            <h3>{{ t('speciesLabels.qrTag') }}</h3>
            <p class="qr-code">{{ plant.qr.code }}</p>
            <span class="status">{{ plant.qr.status }}</span>
          </section>
          <section>
            <h3>{{ t('speciesLabels.registration') }}</h3>
            <dl>
              <div>
                <dt>{{ t('speciesLabels.registeredBy') }}</dt>
                <dd>{{ plant.registeredBy }}</dd>
              </div>
              <div>
                <dt>{{ t('speciesLabels.registeredAt') }}</dt>
                <dd>{{ formatDate(plant.registeredAt) }}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </section>

    <section v-if="canViewStaffPlantData && latestApprovedObservation" class="latest-section">
      <div class="container">
        <p class="eyebrow">{{ t('speciesLabels.latestObservation') }}</p>
        <h2>{{ latestApprovedObservation.observationId }}</h2>
        <div class="observation-summary">
          <div>
            <span>Recorded by</span><strong>{{ latestApprovedObservation.recordedBy }}</strong>
          </div>
          <div>
            <span>Observed</span><strong>{{ formatDate(latestApprovedObservation.date) }}</strong>
          </div>
          <div>
            <span>Height</span><strong>{{ latestApprovedObservation.heightCm }} cm</strong>
          </div>
          <div>
            <span>Health</span><strong>{{ latestApprovedObservation.healthStatus }}</strong>
          </div>
          <div>
            <span>Growth stage</span><strong>{{ latestApprovedObservation.lifeStage }}</strong>
          </div>
          <div>
            <span>Morphology</span><strong>{{ latestApprovedObservation.morphology }}</strong>
          </div>
          <div class="wide">
            <span>Notes</span><strong>{{ latestApprovedObservation.notes }}</strong>
          </div>
        </div>
      </div>
    </section>

    <section v-if="canViewStaffPlantData" class="history-section">
      <div class="container">
        <p class="eyebrow">{{ t('speciesLabels.history') }}</p>
        <h2>{{ t('species.plant.timeline') }}</h2>
        <div class="history-list">
          <details
            v-for="observation in [...plant.observations].sort((a, b) =>
              b.date.localeCompare(a.date),
            )"
            :key="observation.observationId"
          >
            <summary>
              <span>{{ formatDate(observation.date) }}</span
              ><strong>{{ observation.recordedBy }}</strong
              ><em :class="observation.status.toLowerCase()">{{ observation.status }}</em>
            </summary>
            <div class="history-detail">
              <p>
                <b>{{ observation.observationId }}</b>
              </p>
              <p>
                {{ observation.heightCm }} cm · {{ observation.healthStatus }} ·
                {{ observation.lifeStage }}
              </p>
              <p>{{ observation.morphology }}</p>
              <p>{{ observation.notes }}</p>
            </div>
          </details>
        </div>
      </div>
    </section>
  </main>

  <main v-else class="not-found">
    <span>🌿</span>
    <h1>{{ t('species.plant.notFound') }}</h1>
    <p>{{ t('species.plant.notFoundDescription') }}</p>
    <RouterLink to="/species">{{ t('common.returnToSpecies') }}</RouterLink>
  </main>
</template>

<style scoped>
.plant-detail-page {
  background: #f8f6ee;
  color: #405f56;
}
.container {
  width: min(1160px, 88%);
  margin: 0 auto;
}
.plant-hero {
  padding: 64px 0 76px;
  background: linear-gradient(135deg, #e1eadb, #f7f3e8);
}
.back-link {
  display: inline-block;
  margin-bottom: 34px;
  color: #477462;
  font-size: 14px;
  font-weight: 700;
  text-decoration: none;
}
.hero-grid {
  display: grid;
  grid-template-columns: 1.05fr 0.95fr;
  align-items: center;
  gap: 72px;
}
.hero-image,
.image-placeholder {
  width: 100%;
  height: 480px;
  border: 1px solid rgba(63, 104, 77, 0.15);
  border-radius: 28px;
  box-shadow: 0 22px 50px rgba(37, 75, 58, 0.12);
}
.hero-image {
  object-fit: cover;
}
.image-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  background:
    radial-gradient(circle at 70% 28%, rgba(157, 217, 166, 0.48), transparent 35%),
    linear-gradient(145deg, #dce8d6, #c8d8c2);
}
.image-placeholder span {
  font-size: 72px;
}
.image-placeholder small {
  font-weight: 800;
  letter-spacing: 1px;
  text-transform: uppercase;
}
.eyebrow {
  margin: 0 0 12px;
  color: #50a078;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 2.2px;
}
.hero-copy h1 {
  margin: 0;
  color: #234a3c;
  font-size: clamp(44px, 5vw, 66px);
  line-height: 1.05;
}
.hero-copy h2 {
  margin: 18px 0 5px;
  color: #315f4e;
  font-size: 26px;
}
.scientific-name {
  margin: 0 0 26px;
  color: #7c6955;
  font-size: 20px;
  font-style: italic;
}
.hero-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.species-summary {
  max-width: 560px;
  margin: -12px 0 24px;
  color: #557168;
  font-size: 15px;
  line-height: 1.7;
}
.hero-badges span,
.status {
  padding: 7px 12px;
  border-radius: 999px;
  background: #d4e4cf;
  color: #35652f;
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
}
.content-section,
.latest-section,
.history-section {
  padding: 86px 0;
}
.content-grid {
  display: grid;
  grid-template-columns: 1.35fr 0.65fr;
  align-items: start;
  gap: 64px;
}
.content-section h2,
.latest-section h2,
.history-section h2 {
  margin: 0 0 26px;
  color: #234a3c;
  font-size: 36px;
}
.content-grid.public-content-grid {
  grid-template-columns: 1fr;
}
.fact-grid,
.observation-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.fact-grid > div,
.observation-summary > div {
  padding: 17px;
  border: 1px solid rgba(58, 96, 70, 0.12);
  border-radius: 13px;
  background: #fff;
}
.wide {
  grid-column: 1 / -1;
}
.fact-grid span,
.observation-summary span {
  display: block;
  margin-bottom: 5px;
  color: #7c8982;
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
}
.fact-grid strong,
.observation-summary strong {
  color: #315447;
  font-size: 14px;
  line-height: 1.55;
}
.staff-panel {
  padding: 28px;
  border-radius: 22px;
  background: #fff;
  box-shadow: 0 14px 40px rgba(37, 75, 58, 0.08);
}
.staff-panel section + section {
  margin-top: 24px;
  padding-top: 22px;
  border-top: 1px solid #e7e8e1;
}
.staff-panel h3 {
  margin: 0 0 13px;
  color: #315f4e;
}
.staff-panel dl {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 13px;
}
.staff-panel dt {
  color: #7c8982;
  font-size: 9px;
  font-weight: 800;
  text-transform: uppercase;
}
.staff-panel dd {
  margin: 3px 0 0;
  color: #315447;
  font-size: 13px;
  font-weight: 700;
}
.qr-code {
  color: #234a3c;
  font-size: 21px;
  font-weight: 800;
  letter-spacing: 1px;
}
.latest-section {
  background: #e8efe3;
}
.observation-summary {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.history-list {
  display: grid;
  gap: 12px;
}
.history-list details {
  border: 1px solid rgba(58, 96, 70, 0.12);
  border-radius: 14px;
  background: #fff;
}
.history-list summary {
  padding: 18px 20px;
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  align-items: center;
  gap: 18px;
  cursor: pointer;
  list-style: none;
}
.history-list summary span {
  color: #315447;
  font-weight: 700;
}
.history-list summary strong {
  font-size: 13px;
}
.history-list summary em {
  padding: 6px 10px;
  border-radius: 999px;
  background: #d9ead9;
  color: #35652f;
  font-size: 9px;
  font-style: normal;
  font-weight: 800;
  text-transform: uppercase;
}
.history-list summary em.pending {
  background: #fff0d9;
  color: #8a651f;
}
.history-detail {
  padding: 0 20px 18px;
  color: #63776d;
  font-size: 13px;
  line-height: 1.6;
}
.history-detail p {
  margin: 7px 0;
}
.not-found {
  min-height: calc(100vh - 76px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #f4f3e9;
  color: #50675d;
  text-align: center;
}
.not-found span {
  font-size: 50px;
}
.not-found h1 {
  color: #234a3c;
}
.not-found a {
  padding: 12px 20px;
  border-radius: 999px;
  background: #315b49;
  color: #fff;
  text-decoration: none;
}
@media (max-width: 850px) {
  .hero-grid,
  .content-grid {
    grid-template-columns: 1fr;
    gap: 46px;
  }
  .hero-image,
  .image-placeholder {
    height: 380px;
  }
  .observation-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 560px) {
  .plant-hero,
  .content-section,
  .latest-section,
  .history-section {
    padding: 54px 0;
  }
  .hero-image,
  .image-placeholder {
    height: 300px;
  }
  .fact-grid,
  .observation-summary {
    grid-template-columns: 1fr;
  }
  .wide {
    grid-column: auto;
  }
  .history-list summary {
    grid-template-columns: 1fr auto;
  }
  .history-list summary strong {
    grid-row: 2;
  }
  .staff-panel dl {
    grid-template-columns: 1fr;
  }
}
</style>
