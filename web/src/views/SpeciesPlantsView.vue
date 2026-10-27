<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import NavigationBar from '../components/NavigationBar.vue'
import PlantRecordCard from '../components/PlantRecordCard.vue'
import { plants as prototypeSpecies, type Plant } from '../data/plants'
import type { PlantRecord } from '../data/plantRecords'
import { usePrototypeSession } from '../composables/usePrototypeSession'
import { formatPlantId } from '../utils/plantId'

type SortOption = 'default' | 'id-asc' | 'verified-newest' | 'verified-oldest'

const route = useRoute()
const { t, te } = useI18n()
const { isLoggedIn, userRole } = usePrototypeSession()
const canViewStaffPlantData = computed(
  () =>
    isLoggedIn.value && (userRole.value === 'botanist' || userRole.value === 'conservation-officer'),
)
const searchQuery = ref('')
const healthFilter = ref('All')
const lifeStageFilter = ref('All')
const qrFilter = ref('All')
const zoneFilter = ref('All')
const sortOption = ref<SortOption>('default')
const filtersOpen = ref(false)
const selectedSpecies = ref<Plant | null>(null)
const speciesPlants = ref<Array<PlantRecord & { genus?: string; detailLinkEnabled?: boolean }>>([])
const isLoading = ref(true)
const loadError = ref('')

interface ApiSpecies {
  species_id: string | number
  scientific_name: string
  common_name: string
  genus_name?: string
  family_name?: string
  conservation_status?: string
  description?: string
}

interface ApiPlant {
  plant_id: string | number
  species_id: string | number
  registered_by: string | number
  current_status?: string | null
  registered_at?: string | null
  scientific_name?: string | null
  common_name?: string | null
  genus_name?: string | null
  latitude?: string | number | null
  longitude?: string | number | null
  accuracy_m?: string | number | null
  latest_observation_id?: string | number | null
  height_cm?: string | number | null
  life_stage?: string | null
  health_status?: string | null
  morphology?: string | null
  notes?: string | null
  last_verified_at?: string | null
}

interface SpeciesResponse {
  species: ApiSpecies[]
}

interface PlantsResponse {
  plants: ApiPlant[]
}

const generatedSlug = (item: ApiSpecies) => {
  const name = item.common_name || item.scientific_name

  return `${name}-${item.species_id}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

const numericValue = (value: string | number | null | undefined) => {
  if (value === null || value === undefined || value === '') return Number.NaN
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

const loadPlants = async () => {
  isLoading.value = true
  loadError.value = ''
  selectedSpecies.value = null
  speciesPlants.value = []

  try {
    const slug = String(route.params.slug || '')
    const prototypeForSlug = prototypeSpecies.find((item) => item.slug === slug)
    const speciesResponse = await fetch('/api/species')

    if (!speciesResponse.ok) throw new Error('Unable to load plant records.')

    const speciesResult: SpeciesResponse = await speciesResponse.json()
    const apiSpecies = prototypeForSlug
      ? speciesResult.species.find(
          (item) =>
            item.scientific_name.toLowerCase() === prototypeForSlug.scientificName.toLowerCase(),
        )
      : speciesResult.species.find((item) => String(item.species_id)===slug||generatedSlug(item) === slug)

    if (!apiSpecies) return

    const prototype = prototypeSpecies.find(
      (item) => item.scientificName.toLowerCase() === apiSpecies.scientific_name.toLowerCase(),
    )

    selectedSpecies.value = {
      ...(prototype || {}),
      speciesId: String(apiSpecies.species_id),
      slug,
      name: apiSpecies.common_name || apiSpecies.scientific_name,
      scientificName: apiSpecies.scientific_name,
      genus: apiSpecies.genus_name || '',
      family: apiSpecies.family_name || '',
      conservationStatus: apiSpecies.conservation_status || '',
      description: apiSpecies.description || 'No description available yet.',
      category: prototype?.category || ('' as Plant['category']),
      overview: prototype?.overview || '',
      habitat: prototype?.habitat || '',
      characteristics: prototype?.characteristics || [],
      significance: prototype?.significance || '',
    }

    const plantsResponse = await fetch('/api/plants')
    if (!plantsResponse.ok) throw new Error('Unable to load plant records.')

    const plantsResult: PlantsResponse = await plantsResponse.json()
    const speciesId = String(apiSpecies.species_id)

    speciesPlants.value = plantsResult.plants
      .filter((item) => String(item.species_id) === speciesId)
      .map((item) => ({ item, plantId: formatPlantId(item.plant_id) }))
      .filter((entry): entry is { item: ApiPlant; plantId: string } => entry.plantId !== null)
      .map(({ item, plantId }) => ({
        plantId,
        speciesSlug: slug,
        speciesId: String(item.species_id),
        speciesName: item.scientific_name || apiSpecies.scientific_name,
        commonName: item.common_name || apiSpecies.common_name || apiSpecies.scientific_name,
        genus: item.genus_name || apiSpecies.genus_name || '',
        latestApproved: {
          date: item.last_verified_at || '',
          heightCm: numericValue(item.height_cm),
          healthStatus: item.health_status || '',
          lifeStage: item.life_stage || '',
          morphology: item.morphology || '',
          notes: item.notes || '',
        },
        location: {
          zone: '',
          latitude: numericValue(item.latitude),
          longitude: numericValue(item.longitude),
          altitudeM: Number.NaN,
          accuracyM: numericValue(item.accuracy_m),
        },
        qr: { code: '', status: '' },
        registeredBy: String(item.registered_by || ''),
        registeredAt: item.registered_at || '',
        images: [],
        observations: [],
        detailLinkEnabled: true,
      }))
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : 'An unexpected error occurred.'
  } finally {
    isLoading.value = false
  }
}

watch(() => route.params.slug, loadPlants, { immediate: true })

const primaryImage = computed(
  () =>
    selectedSpecies.value?.image ||
    selectedSpecies.value?.images?.find((image) => image.path)?.path,
)

const uniqueValues = (values: string[]) => ['All', ...new Set(values)]
const healthOptions = computed(() =>
  uniqueValues(
    speciesPlants.value.map((plant) => plant.latestApproved.healthStatus).filter(Boolean),
  ),
)
const lifeStageOptions = computed(() =>
  uniqueValues(speciesPlants.value.map((plant) => plant.latestApproved.lifeStage).filter(Boolean)),
)
const qrOptions = computed(() =>
  uniqueValues(speciesPlants.value.map((plant) => plant.qr.status).filter(Boolean)),
)
const zoneOptions = computed(() =>
  uniqueValues(speciesPlants.value.map((plant) => plant.location.zone).filter(Boolean)),
)

const filteredPlants = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  const matches = speciesPlants.value.filter((plant) => {
    const matchesSearch =
      !query ||
      plant.plantId.toLowerCase().includes(query) ||
      (canViewStaffPlantData.value &&
        (plant.location.zone.toLowerCase().includes(query) ||
          plant.latestApproved.healthStatus.toLowerCase().includes(query) ||
          plant.qr.code.toLowerCase().includes(query) ||
          plant.qr.status.toLowerCase().includes(query)))

    return (
      matchesSearch &&
      (!canViewStaffPlantData.value ||
        healthFilter.value === 'All' ||
        plant.latestApproved.healthStatus === healthFilter.value) &&
      (lifeStageFilter.value === 'All' ||
        plant.latestApproved.lifeStage === lifeStageFilter.value) &&
      (!canViewStaffPlantData.value ||
        qrFilter.value === 'All' ||
        plant.qr.status === qrFilter.value) &&
      (!canViewStaffPlantData.value ||
        zoneFilter.value === 'All' ||
        plant.location.zone === zoneFilter.value)
    )
  })

  const sorted = [...matches]
  if (sortOption.value === 'id-asc')
    return sorted.sort((a, b) => a.plantId.localeCompare(b.plantId))
  if (sortOption.value === 'verified-newest')
    return sorted.sort((a, b) => b.latestApproved.date.localeCompare(a.latestApproved.date))
  if (sortOption.value === 'verified-oldest')
    return sorted.sort((a, b) => a.latestApproved.date.localeCompare(b.latestApproved.date))
  return sorted
})

const hasActiveFilters = computed(
  () =>
    Boolean(searchQuery.value) ||
    lifeStageFilter.value !== 'All' ||
    (canViewStaffPlantData.value &&
      (healthFilter.value !== 'All' || qrFilter.value !== 'All' || zoneFilter.value !== 'All')),
)

const activeFilterCount = computed(
  () =>
    [
      lifeStageFilter.value !== 'All',
      canViewStaffPlantData.value && healthFilter.value !== 'All',
      canViewStaffPlantData.value && qrFilter.value !== 'All',
      canViewStaffPlantData.value && zoneFilter.value !== 'All',
    ].filter(Boolean).length,
)

const clearAdvancedFilters = () => {
  healthFilter.value = 'All'
  lifeStageFilter.value = 'All'
  qrFilter.value = 'All'
  zoneFilter.value = 'All'
}

const clearFilters = () => {
  searchQuery.value = ''
  healthFilter.value = 'All'
  lifeStageFilter.value = 'All'
  qrFilter.value = 'All'
  zoneFilter.value = 'All'
}

const optionLabel = (option: string) => {
  if (!option) return '—'
  const optionKey = option.toLowerCase().replace(/\s+/g, '')
  const key = `species.records.options.${optionKey}`
  return te(key) ? t(key) : option
}

const translatedOr = (key: string, fallback: string) => (te(key) ? t(key) : fallback)
const displayName = computed(() =>
  selectedSpecies.value
    ? translatedOr(`plantNames.${selectedSpecies.value.slug}`, selectedSpecies.value.name)
    : '',
)
const displayScientificName = computed(() =>
  selectedSpecies.value
    ? translatedOr(
        `scientificNames.${selectedSpecies.value.slug}`,
        selectedSpecies.value.scientificName,
      )
    : '',
)
const displayDescription = computed(() =>
  selectedSpecies.value
    ? translatedOr(
        `plantDescriptions.${selectedSpecies.value.slug}`,
        selectedSpecies.value.description,
      )
    : '',
)

watch(
  canViewStaffPlantData,
  (canView) => {
    if (!canView) {
      healthFilter.value = 'All'
      qrFilter.value = 'All'
      zoneFilter.value = 'All'
    }
  },
  { immediate: true },
)
</script>

<template>
  <NavigationBar />

  <main v-if="isLoading" class="not-found">
    <p>Loading plant records...</p>
  </main>

  <main v-else-if="selectedSpecies" class="species-plants-page">
    <section class="page-hero">
      <div class="page-container">
        <RouterLink :to="`/species/${selectedSpecies.slug}`" class="back-link"
          >← {{ t('species.records.back', { name: displayName }) }}</RouterLink
        >
        <div class="hero-grid">
          <img v-if="primaryImage" :src="primaryImage" :alt="displayName" />
          <div class="hero-copy">
            <p class="section-label">{{ t('species.records.eyebrow') }}</p>
            <h1>{{ displayName }}</h1>
            <p class="scientific-name">{{ displayScientificName }}</p>
            <p>{{ displayDescription }}</p>
            <strong>{{
              t('species.records.count', { count: speciesPlants.length }, speciesPlants.length)
            }}</strong>
          </div>
        </div>
      </div>
    </section>

    <section class="records-section" aria-labelledby="plant-records-title">
      <div class="page-container">
        <div class="section-heading">
          <div>
            <p class="section-label">{{ t('species.records.section') }}</p>
            <h2 id="plant-records-title">{{ t('species.records.title') }}</h2>
          </div>
          <p>
            {{
              t('species.records.found', { count: filteredPlants.length }, filteredPlants.length)
            }}
          </p>
        </div>

        <div v-if="speciesPlants.length" class="controls">
          <div class="mobile-control-row">
            <label class="search-box">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m21 21-4.35-4.35m2.35-5.15A7.5 7.5 0 1 1 4 11.5a7.5 7.5 0 0 1 15 0Z" />
              </svg>
              <span class="sr-only">{{ t('species.records.search') }}</span>
              <input
                v-model="searchQuery"
                type="search"
                :placeholder="t('species.records.search')"
              />
            </label>

            <button
              type="button"
              class="filter-toggle"
              :class="{ active: filtersOpen }"
              :aria-expanded="filtersOpen"
              aria-controls="advanced-plant-filters"
              @click="filtersOpen = !filtersOpen"
            >
              {{ t('common.filters') }}
              <span v-if="activeFilterCount" class="filter-count">{{ activeFilterCount }}</span>
            </button>
          </div>

          <div
            id="advanced-plant-filters"
            class="filter-grid"
            :class="{
              'mobile-filters-open': filtersOpen,
              'public-filters': !canViewStaffPlantData,
            }"
          >
            <label v-if="canViewStaffPlantData"
              ><span>{{ t('species.records.filters.health') }}</span
              ><select v-model="healthFilter">
                <option v-for="option in healthOptions" :key="option" :value="option">
                  {{ optionLabel(option) }}
                </option>
              </select></label
            >
            <label
              ><span>{{ t('species.records.filters.lifeStage') }}</span
              ><select v-model="lifeStageFilter">
                <option v-for="option in lifeStageOptions" :key="option" :value="option">
                  {{ optionLabel(option) }}
                </option>
              </select></label
            >
            <label v-if="canViewStaffPlantData"
              ><span>{{ t('species.records.filters.qrStatus') }}</span
              ><select v-model="qrFilter">
                <option v-for="option in qrOptions" :key="option" :value="option">
                  {{ optionLabel(option) }}
                </option>
              </select></label
            >
            <label v-if="canViewStaffPlantData"
              ><span>{{ t('species.records.filters.zone') }}</span
              ><select v-model="zoneFilter">
                <option v-for="option in zoneOptions" :key="option" :value="option">
                  {{ optionLabel(option) }}
                </option>
              </select></label
            >

            <label
              ><span>{{ t('species.records.filters.sort') }}</span
              ><select v-model="sortOption">
                <option value="default">{{ t('species.records.sort.default') }}</option>
                <option value="id-asc">{{ t('species.records.sort.idAsc') }}</option>
                <option value="verified-newest">
                  {{ t('species.records.sort.verifiedNewest') }}
                </option>
                <option value="verified-oldest">
                  {{ t('species.records.sort.verifiedOldest') }}
                </option>
              </select></label
            >
          </div>
          <button
            v-if="filtersOpen && activeFilterCount"
            type="button"
            class="mobile-clear-filters"
            @click="clearAdvancedFilters"
          >
            {{ t('common.clearFilters') }}
          </button>
        </div>

        <div v-if="filteredPlants.length" class="plant-grid">
          <PlantRecordCard v-for="plant in filteredPlants" :key="plant.plantId" :plant="plant" />
        </div>

        <div v-else class="empty-state">
          <span aria-hidden="true">🌿</span>
          <h3>
            {{ speciesPlants.length ? t('species.records.noMatch') : t('species.records.none') }}
          </h3>
          <button
            v-if="speciesPlants.length && hasActiveFilters"
            type="button"
            @click="clearFilters"
          >
            {{ t('common.clearFilters') }}
          </button>
        </div>
      </div>
    </section>
  </main>

  <main v-else class="not-found">
    <span aria-hidden="true">🌿</span>
    <h1>{{ t('species.notFound') }}</h1>
    <p>{{ loadError || t('species.notFoundDescription') }}</p>
    <RouterLink to="/species">{{ t('common.returnToSpecies') }}</RouterLink>
  </main>
</template>

<style scoped>
.species-plants-page {
  background: #f8f6ee;
  color: #405f56;
  min-height: 100vh;
}
.page-container {
  width: min(1160px, 88%);
  margin: 0 auto;
}
.page-hero {
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
.back-link:hover {
  text-decoration: underline;
}
.hero-grid {
  display: grid;
  grid-template-columns: minmax(260px, 0.7fr) minmax(0, 1.3fr);
  align-items: center;
  gap: 58px;
}
.hero-grid img {
  width: 100%;
  height: 320px;
  display: block;
  border-radius: 24px;
  object-fit: cover;
  box-shadow: 0 18px 42px rgba(37, 75, 58, 0.12);
}
.section-label {
  margin: 0 0 12px;
  color: #50a078;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 2.3px;
}
.hero-copy h1 {
  margin: 0;
  color: #234a3c;
  font-size: clamp(42px, 5vw, 64px);
  line-height: 1.05;
}
.hero-copy .scientific-name {
  margin: 12px 0 20px;
  color: #7c6955;
  font-size: 22px;
  font-style: italic;
}
.hero-copy > p:not(.section-label, .scientific-name) {
  max-width: 650px;
  font-size: 16px;
  line-height: 1.75;
}
.hero-copy > strong {
  display: inline-flex;
  margin-top: 10px;
  padding: 8px 14px;
  border-radius: 999px;
  background: #d4e4cf;
  color: #35652f;
  font-size: 12px;
}
.records-section {
  padding: 84px 0 96px;
}
.section-heading {
  margin-bottom: 28px;
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 20px;
}
.section-heading h2 {
  margin: 0;
  color: #234a3c;
  font-size: 38px;
}
.section-heading > p {
  margin: 0;
  color: #63776d;
  font-size: 13px;
  font-weight: 700;
}
.controls {
  margin-bottom: 34px;
  padding: 20px;
  border: 1px solid rgba(58, 96, 70, 0.12);
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(37, 75, 58, 0.06);
}
.mobile-control-row {
  display: contents;
}
.filter-toggle,
.mobile-clear-filters {
  display: none;
}
.search-box {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  border: 1px solid #d9d9cf;
  border-radius: 13px;
}
.search-box:focus-within {
  border-color: #508a6a;
  box-shadow: 0 0 0 3px rgba(80, 138, 106, 0.12);
}
.search-box svg {
  width: 20px;
  fill: none;
  stroke: #254b42;
  stroke-width: 2;
}
.search-box input {
  width: 100%;
  padding: 14px 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: #254b42;
  font: inherit;
}
.filter-grid {
  margin-top: 14px;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
}
.filter-grid label span {
  display: block;
  margin: 0 0 5px 3px;
  color: #718078;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.6px;
  text-transform: uppercase;
}
.filter-grid select {
  width: 100%;
  padding: 11px 10px;
  border: 1px solid #d9d9cf;
  border-radius: 11px;
  background: #fdfdfb;
  color: #405f56;
  font: inherit;
  font-size: 12px;
}
.filter-grid.public-filters {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.plant-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 22px;
}
.empty-state button,
.not-found a {
  display: inline-flex;
  padding: 10px 17px;
  border: 0;
  border-radius: 999px;
  background: #315b49;
  color: #fff;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  text-decoration: none;
}
.empty-state {
  padding: 68px 24px;
  border: 1px dashed #aebfad;
  border-radius: 18px;
  text-align: center;
}
.empty-state > span {
  font-size: 42px;
}
.empty-state h3 {
  margin: 12px 0 20px;
  color: #315447;
  font-size: 22px;
}
.not-found {
  min-height: calc(100vh - 76px);
  padding: 60px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #f4f3e9;
  color: #50675d;
  text-align: center;
}
.not-found > span {
  font-size: 50px;
}
.not-found h1 {
  color: #234a3c;
}
.not-found p {
  margin: 0 0 22px;
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
@media (max-width: 950px) {
  .filter-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .plant-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 620px) {
  .page-container {
    width: 92%;
  }
  .page-hero {
    padding: 34px 0 38px;
  }
  .back-link {
    margin-bottom: 20px;
    font-size: 12px;
  }
  .hero-grid {
    grid-template-columns: 1fr;
    gap: 18px;
  }
  .hero-grid img {
    height: 175px;
    border-radius: 16px;
  }
  .section-label {
    margin-bottom: 8px;
    font-size: 10px;
    letter-spacing: 1.7px;
  }
  .hero-copy h1 {
    font-size: 32px;
  }
  .hero-copy .scientific-name {
    margin: 7px 0 10px;
    font-size: 16px;
  }
  .hero-copy > p:not(.section-label, .scientific-name) {
    margin: 0;
    font-size: 12px;
    line-height: 1.55;
  }
  .hero-copy > strong {
    margin-top: 9px;
    padding: 6px 10px;
    font-size: 10px;
  }
  .records-section {
    padding: 36px 0 48px;
  }
  .section-heading {
    margin-bottom: 18px;
    align-items: flex-start;
    flex-direction: column;
    gap: 5px;
  }
  .section-heading h2 {
    font-size: 28px;
  }
  .section-heading > p {
    font-size: 11px;
  }
  .plant-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .controls {
    margin-bottom: 20px;
    padding: 9px;
    border-radius: 13px;
  }
  .mobile-control-row {
    display: flex;
    align-items: stretch;
    gap: 8px;
  }
  .search-box {
    min-width: 0;
    flex: 1;
    padding: 0 9px;
    border-radius: 10px;
  }
  .search-box input {
    min-width: 0;
    padding: 8px 0;
    font-size: 12px;
  }
  .search-box svg {
    width: 15px;
    flex: 0 0 15px;
  }
  .filter-toggle {
    min-height: 36px;
    padding: 0 11px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: 1px solid #b7c7bd;
    border-radius: 10px;
    background: #f7f6ef;
    color: #315b49;
    cursor: pointer;
    font-size: 10px;
    font-weight: 700;
  }
  .filter-toggle.active {
    border-color: #759785;
    background: #e9f0e8;
    color: #234a3c;
  }
  .filter-toggle:focus-visible,
  .mobile-clear-filters:focus-visible {
    outline: 3px solid rgba(49, 91, 73, 0.2);
    outline-offset: 2px;
  }
  .filter-count {
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    background: #315b49;
    color: #fff;
    font-size: 9px;
    font-weight: 800;
  }
  .filter-grid {
    display: none;
  }
  .filter-grid.mobile-filters-open {
    margin-top: 12px;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .filter-grid.mobile-filters-open label:last-child {
    grid-column: 1 / -1;
  }
  .filter-grid label span {
    font-size: 8px;
  }
  .filter-grid select {
    min-height: 40px;
    padding: 9px 8px;
    font-size: 11px;
  }
  .mobile-clear-filters {
    margin: 10px 0 0 auto;
    padding: 7px 10px;
    display: block;
    border: 1px solid #cddbd2;
    border-radius: 8px;
    background: #fff;
    color: #3c7d64;
    cursor: pointer;
    font-size: 10px;
    font-weight: 800;
  }
  .empty-state {
    padding: 40px 16px;
  }
  .empty-state > span {
    font-size: 30px;
  }
  .empty-state h3 {
    margin: 9px 0 14px;
    font-size: 18px;
  }
  .empty-state button {
    padding: 8px 13px;
    font-size: 10px;
  }

  :deep(.plant-record-card) {
    display: flex;
    flex-direction: column;
    border-radius: 13px;
    box-shadow: 0 5px 16px rgba(37, 75, 58, 0.07);
  }
  :deep(.record-image) {
    height: 120px;
  }
  :deep(.record-placeholder) {
    font-size: 34px;
  }
  :deep(.record-image > span) {
    left: 7px;
    bottom: 7px;
    padding: 4px 6px;
    font-size: 8px;
  }
  :deep(.record-copy) {
    flex: 1;
    padding: 10px;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  :deep(.record-copy h3) {
    font-size: 16px;
    line-height: 1.15;
  }
  :deep(.record-common-name) {
    margin: 3px 0 1px;
    font-size: 11px;
    line-height: 1.3;
  }
  :deep(.record-species) {
    margin-bottom: 9px;
    overflow-wrap: anywhere;
    font-size: 10px;
    line-height: 1.3;
  }
  :deep(.record-copy dl) {
    margin-bottom: 12px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 7px 5px;
  }
  :deep(.record-copy dt) {
    font-size: 7px;
    letter-spacing: 0.35px;
  }
  :deep(.record-copy dd) {
    margin-top: 2px;
    overflow-wrap: anywhere;
    font-size: 9px;
    line-height: 1.25;
  }
  :deep(.learn-more) {
    width: min(100%, 120px);
    height: 32px;
    margin-top: auto;
  }
  :deep(.learn-more .circle) {
    width: 32px;
    height: 32px;
  }
  :deep(.learn-more .button-arrow) {
    left: 8px;
    width: 12px;
  }
  :deep(.learn-more .button-arrow::before) {
    top: -3px;
    width: 7px;
    height: 7px;
  }
  :deep(.learn-more .button-text) {
    padding: 6px 4px 6px 26px;
    font-size: 9px;
    line-height: 20px;
  }
}

@media (max-width: 360px) {
  .filter-toggle {
    padding-inline: 10px;
  }
  .plant-grid {
    gap: 8px;
  }
  :deep(.record-image) {
    height: 110px;
  }
  :deep(.record-copy) {
    padding: 8px;
  }
  :deep(.learn-more) {
    width: min(100%, 116px);
    height: 31px;
  }
  :deep(.learn-more .circle) {
    width: 31px;
    height: 31px;
  }
  :deep(.learn-more .button-text) {
    font-size: 8px;
  }
}
</style>
