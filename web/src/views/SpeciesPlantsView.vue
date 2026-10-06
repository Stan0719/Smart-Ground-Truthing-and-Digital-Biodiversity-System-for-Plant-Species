<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import NavigationBar from '../components/NavigationBar.vue'
import PlantRecordCard from '../components/PlantRecordCard.vue'
import { plants as species } from '../data/plants'
import { plantRecords } from '../data/plantRecords'

type SortOption = 'default' | 'id-asc' | 'verified-newest' | 'verified-oldest'

const route = useRoute()
const searchQuery = ref('')
const healthFilter = ref('All')
const lifeStageFilter = ref('All')
const qrFilter = ref('All')
const zoneFilter = ref('All')
const sortOption = ref<SortOption>('default')

const selectedSpecies = computed(() => species.find((item) => item.slug === route.params.slug))
const speciesPlants = computed(() =>
  plantRecords.filter((plant) => plant.speciesSlug === selectedSpecies.value?.slug),
)
const primaryImage = computed(() =>
  selectedSpecies.value?.image || selectedSpecies.value?.images?.find((image) => image.path)?.path,
)

const uniqueValues = (values: string[]) => ['All', ...new Set(values)]
const healthOptions = computed(() => uniqueValues(speciesPlants.value.map((plant) => plant.latestApproved.healthStatus)))
const lifeStageOptions = computed(() => uniqueValues(speciesPlants.value.map((plant) => plant.latestApproved.lifeStage)))
const qrOptions = computed(() => uniqueValues(speciesPlants.value.map((plant) => plant.qr.status)))
const zoneOptions = computed(() => uniqueValues(speciesPlants.value.map((plant) => plant.location.zone)))

const filteredPlants = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  const matches = speciesPlants.value.filter((plant) => {
    const matchesSearch =
      !query ||
      plant.plantId.toLowerCase().includes(query) ||
      plant.location.zone.toLowerCase().includes(query) ||
      plant.latestApproved.healthStatus.toLowerCase().includes(query) ||
      plant.qr.code.toLowerCase().includes(query) ||
      plant.qr.status.toLowerCase().includes(query)

    return (
      matchesSearch &&
      (healthFilter.value === 'All' || plant.latestApproved.healthStatus === healthFilter.value) &&
      (lifeStageFilter.value === 'All' || plant.latestApproved.lifeStage === lifeStageFilter.value) &&
      (qrFilter.value === 'All' || plant.qr.status === qrFilter.value) &&
      (zoneFilter.value === 'All' || plant.location.zone === zoneFilter.value)
    )
  })

  const sorted = [...matches]
  if (sortOption.value === 'id-asc') return sorted.sort((a, b) => a.plantId.localeCompare(b.plantId))
  if (sortOption.value === 'verified-newest') return sorted.sort((a, b) => b.latestApproved.date.localeCompare(a.latestApproved.date))
  if (sortOption.value === 'verified-oldest') return sorted.sort((a, b) => a.latestApproved.date.localeCompare(b.latestApproved.date))
  return sorted
})

const hasActiveFilters = computed(
  () =>
    Boolean(searchQuery.value) ||
    healthFilter.value !== 'All' ||
    lifeStageFilter.value !== 'All' ||
    qrFilter.value !== 'All' ||
    zoneFilter.value !== 'All',
)

const clearFilters = () => {
  searchQuery.value = ''
  healthFilter.value = 'All'
  lifeStageFilter.value = 'All'
  qrFilter.value = 'All'
  zoneFilter.value = 'All'
}

</script>

<template>
  <NavigationBar />

  <main v-if="selectedSpecies" class="species-plants-page">
    <section class="page-hero">
      <div class="page-container">
        <RouterLink :to="`/species/${selectedSpecies.slug}`" class="back-link">← Back to {{ selectedSpecies.name }}</RouterLink>
        <div class="hero-grid">
          <img v-if="primaryImage" :src="primaryImage" :alt="selectedSpecies.name" />
          <div class="hero-copy">
            <p class="section-label">VERIFIED INDIVIDUAL PLANTS</p>
            <h1>{{ selectedSpecies.name }}</h1>
            <p class="scientific-name">{{ selectedSpecies.scientificName }}</p>
            <p>Browse all verified individual plant records documented for this species in Niah National Park.</p>
            <strong>{{ speciesPlants.length }} plant {{ speciesPlants.length === 1 ? 'record' : 'records' }}</strong>
          </div>
        </div>
      </div>
    </section>

    <section class="records-section" aria-labelledby="plant-records-title">
      <div class="page-container">
        <div class="section-heading">
          <div><p class="section-label">PLANT RECORDS</p><h2 id="plant-records-title">All verified plants</h2></div>
          <p>{{ filteredPlants.length }} {{ filteredPlants.length === 1 ? 'plant' : 'plants' }} found</p>
        </div>

        <div v-if="speciesPlants.length" class="controls">
          <label class="search-box">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.35-4.35m2.35-5.15A7.5 7.5 0 1 1 4 11.5a7.5 7.5 0 0 1 15 0Z" /></svg>
            <span class="sr-only">Search plant records</span>
            <input v-model="searchQuery" type="search" placeholder="Search by Plant ID..." />
          </label>

          <div class="filter-grid">
            <label><span>Health</span><select v-model="healthFilter"><option v-for="option in healthOptions" :key="option">{{ option }}</option></select></label>
            <label><span>Life stage</span><select v-model="lifeStageFilter"><option v-for="option in lifeStageOptions" :key="option">{{ option }}</option></select></label>
            <label><span>QR status</span><select v-model="qrFilter"><option v-for="option in qrOptions" :key="option">{{ option }}</option></select></label>
            <label><span>Zone</span><select v-model="zoneFilter"><option v-for="option in zoneOptions" :key="option">{{ option }}</option></select></label>
            <label><span>Sort</span><select v-model="sortOption"><option value="default">Default</option><option value="id-asc">Plant ID: A–Z</option><option value="verified-newest">Latest Verified: Newest</option><option value="verified-oldest">Latest Verified: Oldest</option></select></label>
          </div>
        </div>

        <div v-if="filteredPlants.length" class="plant-grid">
          <PlantRecordCard
            v-for="plant in filteredPlants"
            :key="plant.plantId"
            :plant="plant"
          />
        </div>

        <div v-else class="empty-state">
          <span aria-hidden="true">🌿</span>
          <h3>{{ speciesPlants.length ? 'No plants match your current search or filters.' : 'No plant records found for this species.' }}</h3>
          <button v-if="speciesPlants.length && hasActiveFilters" type="button" @click="clearFilters">Clear Filters</button>
        </div>
      </div>
    </section>
  </main>

  <main v-else class="not-found"><span aria-hidden="true">🌿</span><h1>Species not found</h1><p>The species you are looking for is not in the collection.</p><RouterLink to="/species">Return to Species</RouterLink></main>
</template>

<style scoped>
.species-plants-page { background: #f8f6ee; color: #405f56; min-height: 100vh; }
.page-container { width: min(1160px, 88%); margin: 0 auto; }
.page-hero { padding: 64px 0 76px; background: linear-gradient(135deg, #e1eadb, #f7f3e8); }
.back-link { display: inline-block; margin-bottom: 34px; color: #477462; font-size: 14px; font-weight: 700; text-decoration: none; }
.back-link:hover { text-decoration: underline; }
.hero-grid { display: grid; grid-template-columns: minmax(260px,.7fr) minmax(0,1.3fr); align-items: center; gap: 58px; }
.hero-grid img { width: 100%; height: 320px; display: block; border-radius: 24px; object-fit: cover; box-shadow: 0 18px 42px rgba(37,75,58,.12); }
.section-label { margin: 0 0 12px; color: #50a078; font-size: 12px; font-weight: 800; letter-spacing: 2.3px; }
.hero-copy h1 { margin: 0; color: #234a3c; font-size: clamp(42px,5vw,64px); line-height: 1.05; }
.hero-copy .scientific-name { margin: 12px 0 20px; color: #7c6955; font-size: 22px; font-style: italic; }
.hero-copy > p:not(.section-label,.scientific-name) { max-width: 650px; font-size: 16px; line-height: 1.75; }
.hero-copy > strong { display: inline-flex; margin-top: 10px; padding: 8px 14px; border-radius: 999px; background: #d4e4cf; color: #35652f; font-size: 12px; }
.records-section { padding: 84px 0 96px; }
.section-heading { margin-bottom: 28px; display: flex; align-items: end; justify-content: space-between; gap: 20px; }
.section-heading h2 { margin: 0; color: #234a3c; font-size: 38px; }.section-heading > p { margin: 0; color: #63776d; font-size: 13px; font-weight: 700; }
.controls { margin-bottom: 34px; padding: 20px; border: 1px solid rgba(58,96,70,.12); border-radius: 18px; background: #fff; box-shadow: 0 8px 24px rgba(37,75,58,.06); }
.search-box { display: flex; align-items: center; gap: 10px; padding: 0 16px; border: 1px solid #d9d9cf; border-radius: 13px; }.search-box:focus-within { border-color: #508a6a; box-shadow: 0 0 0 3px rgba(80,138,106,.12); }.search-box svg { width: 20px; fill: none; stroke: #254b42; stroke-width: 2; }.search-box input { width: 100%; padding: 14px 0; border: 0; outline: 0; background: transparent; color: #254b42; font: inherit; }
.filter-grid { margin-top: 14px; display: grid; grid-template-columns: repeat(5,minmax(0,1fr)); gap: 10px; }.filter-grid label span { display: block; margin: 0 0 5px 3px; color: #718078; font-size: 9px; font-weight: 800; letter-spacing: .6px; text-transform: uppercase; }.filter-grid select { width: 100%; padding: 11px 10px; border: 1px solid #d9d9cf; border-radius: 11px; background: #fdfdfb; color: #405f56; font: inherit; font-size: 12px; }
.plant-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 22px; }
.empty-state button,.not-found a { display: inline-flex; padding: 10px 17px; border: 0; border-radius: 999px; background: #315b49; color: #fff; cursor: pointer; font: inherit; font-size: 12px; font-weight: 700; text-decoration: none; }
.empty-state { padding: 68px 24px; border: 1px dashed #aebfad; border-radius: 18px; text-align: center; }.empty-state > span { font-size: 42px; }.empty-state h3 { margin: 12px 0 20px; color: #315447; font-size: 22px; }
.not-found { min-height: calc(100vh - 76px); padding: 60px 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #f4f3e9; color: #50675d; text-align: center; }.not-found > span { font-size: 50px; }.not-found h1 { color: #234a3c; }.not-found p { margin: 0 0 22px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
@media (max-width: 950px) { .filter-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }.plant-grid { grid-template-columns: repeat(2,minmax(0,1fr)); } }
@media (max-width: 650px) { .page-hero,.records-section { padding: 52px 0; }.hero-grid { grid-template-columns: 1fr; gap: 30px; }.hero-grid img { height: 280px; }.section-heading { align-items: flex-start; flex-direction: column; gap: 8px; }.filter-grid,.plant-grid { grid-template-columns: 1fr; } }
</style>
