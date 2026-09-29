<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import NavigationBar from '../components/NavigationBar.vue'
import { plants } from '../data/plants'

const categories = ['All', 'Trees', 'Flowers', 'Ferns', 'Climbers'] as const
const activeCategory = ref<(typeof categories)[number]>('All')
const route = useRoute()
const searchQuery = ref(typeof route.query.search === 'string' ? route.query.search : '')

watch(
  () => route.query.search,
  (search) => {
    searchQuery.value = typeof search === 'string' ? search : ''
  },
)

const filteredPlants = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()

  return plants.filter((plant) => {
    const matchesCategory = activeCategory.value === 'All' || plant.category === activeCategory.value
    const matchesSearch =
      !query ||
      plant.name.toLowerCase().includes(query) ||
      plant.scientificName.toLowerCase().includes(query) ||
      plant.category.toLowerCase().includes(query) ||
      plant.description.toLowerCase().includes(query)

    return matchesCategory && matchesSearch
  })
})
</script>

<template>
  <NavigationBar />

  <main class="plants-page">
    <section class="plants-hero">
      <div class="hero-overlay"></div>

      <div class="hero-content">
        <p class="eyebrow">NIAH NATIONAL PARK</p>
        <h1>Plants of Niah</h1>
        <p class="hero-lead">Explore the rich flora of Niah National Park.</p>
        <p class="hero-copy">
          From towering rainforest trees to delicate orchids, discover the remarkable plant
          life that makes Niah a place of extraordinary beauty and ecological significance.
        </p>
      </div>
    </section>

    <section class="plant-library" aria-labelledby="plant-library-title">
      <div class="library-container">
        <div class="library-heading">
          <div>
            <p class="section-label">EXPLORE THE COLLECTION</p>
            <h2 id="plant-library-title">Discover Niah's flora</h2>
          </div>
          <p>{{ filteredPlants.length }} plant{{ filteredPlants.length === 1 ? '' : 's' }} found</p>
        </div>

        <div class="filter-bar">
          <label class="search-box">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m21 21-4.35-4.35m2.35-5.15A7.5 7.5 0 1 1 4 11.5a7.5 7.5 0 0 1 15 0Z" />
            </svg>
            <span class="sr-only">Search plants</span>
            <input
              v-model="searchQuery"
              type="search"
              placeholder="Search by name, scientific name or keyword..."
            />
          </label>

          <div class="category-filters" aria-label="Filter plants by category">
            <button
              v-for="category in categories"
              :key="category"
              type="button"
              :class="{ active: activeCategory === category }"
              @click="activeCategory = category"
            >
              {{ category }}
            </button>
          </div>
        </div>

        <div v-if="filteredPlants.length" class="plant-grid">
          <article v-for="plant in filteredPlants" :key="plant.name" class="plant-card">
            <div class="plant-image-wrapper">
              <div class="plant-image-placeholder" role="img" :aria-label="`${plant.name} image placeholder`">
                <svg viewBox="0 0 64 64" aria-hidden="true">
                  <path d="M51 9C32 10 18 19 15 36c10-8 20-12 30-15-12 6-21 14-27 25" />
                  <path d="M16 37C7 29 7 19 8 12c9 3 16 9 18 17" />
                </svg>
                <span>Image coming soon</span>
              </div>
              <span class="category-badge">{{ plant.category }}</span>
            </div>

            <div class="plant-card-content">
              <h3>{{ plant.name }}</h3>
              <p class="scientific-name">{{ plant.scientificName }}</p>
              <p class="plant-description">{{ plant.description }}</p>

              <RouterLink
                :to="`/plants/${plant.slug}`"
                class="learn-more"
                :aria-label="`Learn more about ${plant.name}`"
              >
                <span class="circle" aria-hidden="true">
                  <span class="button-arrow"></span>
                </span>
                <span class="button-text">Learn more</span>
              </RouterLink>
            </div>
          </article>
        </div>

        <div v-else class="empty-state">
          <span aria-hidden="true">🌿</span>
          <h3>No plants found</h3>
          <p>Try another search term or select a different category.</p>
          <button type="button" @click="searchQuery = ''; activeCategory = 'All'">Clear filters</button>
        </div>
      </div>
    </section>

    <section class="plants-quote">
      <p>“Extraordinary plants. A timeless rainforest.”</p>
      <span>NIAH NATIONAL PARK</span>
    </section>
  </main>
</template>

<style scoped>
.plants-page {
  background: #f8f6ee;
}

.plants-hero {
  position: relative;
  min-height: 460px;
  display: flex;
  align-items: flex-end;
  background-image: url('/images/hero.jpg');
  background-position: center 48%;
  background-size: cover;
  overflow: hidden;
}

.hero-overlay {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(90deg, rgba(8, 24, 17, 0.86) 0%, rgba(8, 24, 17, 0.6) 44%, rgba(8, 24, 17, 0.15) 78%),
    linear-gradient(0deg, rgba(8, 24, 17, 0.35), transparent 55%);
}

.hero-content {
  position: relative;
  z-index: 1;
  width: min(1200px, 88%);
  margin: 0 auto;
  padding: 86px 0 58px;
  color: #fffaf0;
}

.eyebrow,
.section-label {
  margin: 0 0 12px;
  color: #9cdba6;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 3px;
}

.plants-hero h1 {
  margin: 0;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: clamp(54px, 7vw, 86px);
  font-weight: 600;
  line-height: 1;
  letter-spacing: -2px;
}

.hero-lead {
  margin: 14px 0 8px;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: clamp(21px, 2.2vw, 30px);
}

.hero-copy {
  max-width: 680px;
  margin: 0;
  color: #e9eee4;
  font-size: 16px;
  line-height: 1.7;
}

.plant-library {
  padding: 64px 0 88px;
}

.library-container {
  width: min(1200px, 92%);
  margin: 0 auto;
}

.library-heading {
  margin-bottom: 30px;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
}

.library-heading h2 {
  margin: 0;
  color: #254b42;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: clamp(32px, 4vw, 48px);
  font-weight: 600;
}

.library-heading > p {
  margin: 0 0 6px;
  color: #6a7b73;
  font-size: 13px;
  font-weight: 600;
}

.filter-bar {
  margin-bottom: 28px;
  display: flex;
  align-items: center;
  gap: 18px;
}

.search-box {
  min-width: 260px;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 18px;
  border: 1px solid #d9d9cf;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 5px 20px rgba(35, 63, 49, 0.05);
}

.search-box:focus-within {
  border-color: #508a6a;
  box-shadow: 0 0 0 3px rgba(80, 138, 106, 0.12);
}

.search-box svg {
  width: 20px;
  fill: none;
  stroke: #254b42;
  stroke-linecap: round;
  stroke-width: 2;
}

.search-box input {
  width: 100%;
  padding: 15px 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: #254b42;
  font: inherit;
}

.category-filters {
  display: flex;
  gap: 9px;
}

.category-filters button {
  padding: 13px 20px;
  border: 0;
  border-radius: 999px;
  background: #eeece3;
  color: #44564e;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  transition: 0.2s ease;
}

.category-filters button:hover {
  background: #dfe8da;
}

.category-filters button.active {
  background: #35652f;
  color: #fff;
}

.plant-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
}

.plant-card {
  overflow: hidden;
  border: 1px solid rgba(49, 91, 70, 0.1);
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 10px 30px rgba(33, 57, 44, 0.08);
  transition: transform 0.25s ease, box-shadow 0.25s ease;
}

.plant-card:hover {
  transform: translateY(-6px);
  box-shadow: 0 18px 38px rgba(33, 57, 44, 0.14);
}

.plant-image-wrapper {
  position: relative;
  aspect-ratio: 4 / 3;
  overflow: hidden;
}

.plant-image-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background:
    radial-gradient(circle at 75% 25%, rgba(156, 219, 166, 0.35), transparent 34%),
    linear-gradient(145deg, #e6eddd, #d3dfcb);
  color: #577265;
}

.plant-image-placeholder svg {
  width: 54px;
  fill: none;
  stroke: #5f8267;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2.4;
}

.plant-image-placeholder span {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.category-badge {
  position: absolute;
  top: 14px;
  right: 14px;
  padding: 7px 11px;
  border-radius: 999px;
  background: rgba(20, 54, 37, 0.84);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.plant-card-content {
  padding: 22px;
}

.plant-card h3 {
  margin: 0;
  color: #203f35;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 23px;
}

.scientific-name {
  margin: 5px 0 14px;
  color: #7c6c5b;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 15px;
  font-style: italic;
}

.plant-description {
  min-height: 66px;
  margin: 0 0 20px;
  color: #617068;
  font-size: 13px;
  line-height: 1.65;
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
  font: inherit;
  font-size: 13px;
  text-decoration: none;
  vertical-align: middle;
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

.empty-state {
  padding: 72px 24px;
  border: 1px dashed #bdc8bd;
  border-radius: 18px;
  text-align: center;
  color: #63736a;
}

.empty-state > span {
  font-size: 38px;
}

.empty-state h3 {
  margin: 12px 0 6px;
  color: #254b42;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 26px;
}

.empty-state p {
  margin: 0 0 20px;
}

.empty-state button {
  padding: 11px 18px;
  border: 0;
  border-radius: 999px;
  background: #35652f;
  color: #fff;
  cursor: pointer;
  font: inherit;
  font-weight: 600;
}

.plants-quote {
  min-height: 210px;
  padding: 44px 6%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background:
    linear-gradient(rgba(11, 39, 29, 0.78), rgba(11, 39, 29, 0.78)),
    url('/images/hero.jpg') center 75% / cover;
  color: #fff;
  text-align: center;
}

.plants-quote p {
  margin: 0 0 18px;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: clamp(25px, 3.5vw, 38px);
  font-style: italic;
}

.plants-quote span {
  color: #d6e3cf;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 5px;
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
  .filter-bar {
    align-items: stretch;
    flex-direction: column;
  }

  .category-filters {
    overflow-x: auto;
    padding-bottom: 4px;
  }

  .category-filters button {
    flex: 0 0 auto;
  }

  .plant-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 620px) {
  .plants-hero {
    min-height: 420px;
  }

  .hero-content {
    width: 86%;
    padding-bottom: 46px;
  }

  .plants-hero h1 {
    font-size: 52px;
  }

  .hero-copy {
    font-size: 14px;
  }

  .plant-library {
    padding: 48px 0 64px;
  }

  .library-container {
    width: 88%;
  }

  .library-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }

  .search-box {
    min-width: 0;
  }

  .plant-grid {
    grid-template-columns: 1fr;
  }

  .plant-description {
    min-height: 0;
  }
}
</style>
