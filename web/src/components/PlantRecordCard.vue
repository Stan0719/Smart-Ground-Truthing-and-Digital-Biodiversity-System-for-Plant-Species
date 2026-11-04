<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PlantRecord } from '../data/plantRecords'
import { plants as species } from '../data/plants'
import { usePrototypeSession } from '../composables/usePrototypeSession'

const props = withDefaults(
  defineProps<{
    plant: PlantRecord & { genus?: string; detailLinkEnabled?: boolean }
    compact?: boolean
  }>(),
  { compact: false },
)
const { t, te, locale } = useI18n()

const primaryImage = computed(() => props.plant.images.find((image) => image.path)?.path)
const selectedSpecies = computed(() =>
  species.find((item) => item.slug === props.plant.speciesSlug),
)
const { isLoggedIn, userRole } = usePrototypeSession()
const canViewStaffPlantData = computed(
  () =>
    isLoggedIn.value && (userRole.value === 'admin' || userRole.value === 'conservation-officer'),
)

const optionLabel = (value: string) => {
  if (!value) return '—'
  const optionKey = value.toLowerCase().replace(/\s+/g, '')
  const key = `species.records.options.${optionKey}`
  return te(key) ? t(key) : value
}

const translatedGenus = computed(() => {
  const key = `speciesContent.${props.plant.speciesSlug}.genus`
  return te(key) ? t(key) : props.plant.genus || selectedSpecies.value?.genus || '—'
})

const formatDate = (value: string) => {
  if (!value) return '—'
  const date = new Date(value.includes('T') ? value : `${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return '—'
  const dateLocale = locale.value === 'zh-CN' ? 'zh-CN' : locale.value === 'ms' ? 'ms-MY' : 'en-MY'
  return new Intl.DateTimeFormat(dateLocale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

const displayHeight = computed(() =>
  Number.isFinite(props.plant.latestApproved.heightCm)
    ? `${props.plant.latestApproved.heightCm} cm`
    : '—',
)
const displayName = computed(() => {
  const key = `plantNames.${props.plant.speciesSlug}`
  return te(key) ? t(key) : props.plant.commonName
})
const displayScientificName = computed(() => {
  const key = `scientificNames.${props.plant.speciesSlug}`
  return te(key) ? t(key) : props.plant.speciesName
})
const showDetailLink = computed(() => props.plant.detailLinkEnabled !== false)
</script>

<template>
  <article class="plant-record-card" :class="{ compact }">
    <div class="record-image">
      <img
        v-if="primaryImage"
        :src="primaryImage"
        :alt="t('common.fieldRecordAlt', { id: plant.plantId })"
      />
      <div v-else class="record-placeholder" aria-hidden="true">🌿</div>
      <span>{{ plant.plantId }}</span>
    </div>

    <div class="record-copy">
      <h3>{{ plant.plantId }}</h3>
      <p class="record-common-name">{{ displayName }}</p>
      <p class="record-species">{{ displayScientificName }}</p>
      <dl v-if="canViewStaffPlantData">
        <div>
          <dt>{{ t('common.location') }}</dt>
          <dd>{{ optionLabel(plant.location.zone) }}</dd>
        </div>
        <div>
          <dt>{{ t('common.height') }}</dt>
          <dd>{{ displayHeight }}</dd>
        </div>
        <div>
          <dt>{{ t('common.lifeStage') }}</dt>
          <dd>{{ optionLabel(plant.latestApproved.lifeStage) }}</dd>
        </div>
        <div>
          <dt>{{ compact ? t('common.verified') : t('common.lastVerified') }}</dt>
          <dd>{{ formatDate(plant.latestApproved.date) }}</dd>
        </div>
      </dl>
      <dl v-else>
        <div>
          <dt>{{ t('common.height') }}</dt>
          <dd>{{ displayHeight }}</dd>
        </div>
        <div>
          <dt>{{ t('common.lifeStage') }}</dt>
          <dd>{{ optionLabel(plant.latestApproved.lifeStage) }}</dd>
        </div>
        <div>
          <dt>{{ t('speciesLabels.genus') }}</dt>
          <dd>{{ translatedGenus }}</dd>
        </div>
        <div>
          <dt>{{ compact ? t('common.verified') : t('common.lastVerified') }}</dt>
          <dd>{{ formatDate(plant.latestApproved.date) }}</dd>
        </div>
      </dl>

      <RouterLink
        v-if="showDetailLink"
        :to="`/plant/${plant.plantId}`"
        class="learn-more"
        :aria-label="t('common.viewPlantAria', { id: plant.plantId })"
      >
        <span class="circle" aria-hidden="true"><span class="button-arrow"></span></span>
        <span class="button-text">{{ t('common.viewPlant') }}</span>
      </RouterLink>
    </div>
  </article>
</template>

<style scoped>
.plant-record-card {
  height: 100%;
  overflow: hidden;
  border: 1px solid rgba(58, 96, 70, 0.12);
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 10px 28px rgba(37, 75, 58, 0.08);
  transition:
    transform 0.25s ease,
    box-shadow 0.25s ease;
}
.plant-record-card:hover {
  transform: translateY(-6px);
  box-shadow: 0 18px 38px rgba(33, 57, 44, 0.14);
}
.record-image {
  position: relative;
  height: 210px;
}
.record-image img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}
.record-placeholder {
  height: 100%;
  display: grid;
  place-items: center;
  background: linear-gradient(145deg, #dfe9da, #c8d9c3);
  font-size: 48px;
}
.record-image > span {
  position: absolute;
  left: 14px;
  bottom: 12px;
  padding: 6px 10px;
  border-radius: 999px;
  background: #214638;
  color: #fff;
  font-size: 11px;
  font-weight: 800;
}
.record-copy {
  padding: 21px;
}
.record-copy h3 {
  margin: 0;
  color: #234a3c;
  font-size: 24px;
}
.record-common-name {
  margin: 5px 0 2px;
  color: #315447;
  font-size: 14px;
  font-weight: 700;
}
.record-species {
  margin: 0 0 18px;
  color: #7c6955;
  font-size: 13px;
  font-style: italic;
}
.record-copy dl {
  margin: 0 0 20px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 13px;
}
.record-copy dt {
  color: #7c8982;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.7px;
  text-transform: uppercase;
}
.record-copy dd {
  margin: 3px 0 0;
  color: #315447;
  font-size: 12px;
  font-weight: 700;
}
.plant-record-card.compact .record-image {
  height: 180px;
}
.plant-record-card.compact .record-copy {
  padding: 20px;
}
.plant-record-card.compact .record-copy h3 {
  font-size: 23px;
}
.plant-record-card.compact .record-common-name {
  margin-top: 4px;
}
.learn-more {
  position: relative;
  width: 170px;
  height: 42px;
  margin: 0 auto;
  display: block;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: #f3f0e7;
  cursor: pointer;
  font-size: 13px;
  text-decoration: none;
  overflow: hidden;
}
.learn-more .circle {
  position: absolute;
  top: 0;
  left: 0;
  width: 42px;
  height: 42px;
  display: block;
  border-radius: 50%;
  background: #8a5727;
  transition: all 0.45s cubic-bezier(0.65, 0, 0.076, 1);
}
.learn-more .button-arrow {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 11px;
  width: 16px;
  height: 2px;
  margin: auto;
  background: transparent;
  transition: all 0.45s cubic-bezier(0.65, 0, 0.076, 1);
}
.learn-more .button-arrow::before {
  content: '';
  position: absolute;
  top: -4px;
  right: 1px;
  width: 8px;
  height: 8px;
  border-top: 2px solid #fff;
  border-right: 2px solid #fff;
  transform: rotate(45deg);
}
.learn-more .button-text {
  position: absolute;
  inset: 0;
  padding: 11px 8px 11px 34px;
  color: #805020;
  font-weight: 700;
  line-height: 20px;
  text-align: center;
  text-transform: uppercase;
  transition: color 0.45s cubic-bezier(0.65, 0, 0.076, 1);
}
.learn-more:hover .circle,
.learn-more:focus-visible .circle {
  width: 100%;
  border-radius: 999px;
}
.learn-more:hover .button-arrow,
.learn-more:focus-visible .button-arrow {
  background: #fff;
  transform: translateX(8px);
}
.learn-more:hover .button-text,
.learn-more:focus-visible .button-text {
  color: #fff;
}
.learn-more:focus-visible {
  outline: 3px solid rgba(138, 87, 39, 0.3);
  outline-offset: 3px;
}
</style>
