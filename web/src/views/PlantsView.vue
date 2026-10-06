<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import NavigationBar from '../components/NavigationBar.vue'
import { plants as species } from '../data/plants'

const categories = ['All', 'Trees', 'Flowers', 'Ferns', 'Climbers'] as const
const activeCategory = ref<(typeof categories)[number]>('All')
const sortOption = ref<'default' | 'name-asc' | 'name-desc' | 'scientific-asc'>('default')
const sortMenuOpen = ref(false)
const sortMenu = ref<HTMLElement | null>(null)
const route = useRoute()
const searchQuery = ref(typeof route.query.search === 'string' ? route.query.search : '')

const closeSortMenu = (event: MouseEvent | KeyboardEvent) => {
  if (
    event instanceof KeyboardEvent
      ? event.key === 'Escape'
      : !sortMenu.value?.contains(event.target as Node)
  ) {
    sortMenuOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', closeSortMenu)
  document.addEventListener('keydown', closeSortMenu)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', closeSortMenu)
  document.removeEventListener('keydown', closeSortMenu)
})

watch(
  () => route.query.search,
  (search) => {
    searchQuery.value = typeof search === 'string' ? search : ''
  },
)

const filteredSpecies = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()

  const filtered = species.filter((item) => {
    const matchesCategory = activeCategory.value === 'All' || item.category === activeCategory.value
    const matchesSearch =
      !query ||
      item.name.toLowerCase().includes(query) ||
      item.scientificName.toLowerCase().includes(query) ||
      item.genus?.toLowerCase().includes(query) ||
      item.category.toLowerCase().includes(query) ||
      item.family?.toLowerCase().includes(query) ||
      item.description.toLowerCase().includes(query)

    return matchesCategory && matchesSearch
  })

  const sorted = [...filtered]

  if (sortOption.value === 'name-asc') {
    return sorted.sort((a, b) => a.name.localeCompare(b.name))
  }

  if (sortOption.value === 'name-desc') {
    return sorted.sort((a, b) => b.name.localeCompare(a.name))
  }

  if (sortOption.value === 'scientific-asc') {
    return sorted.sort((a, b) => a.scientificName.localeCompare(b.scientificName))
  }

  return sorted
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
          <p>{{ filteredSpecies.length }} species found</p>
        </div>

        <div class="filter-bar">
          <div class="filter-controls">
            <label class="search-box">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m21 21-4.35-4.35m2.35-5.15A7.5 7.5 0 1 1 4 11.5a7.5 7.5 0 0 1 15 0Z" />
              </svg>
              <span class="sr-only">Search species</span>
              <input
                v-model="searchQuery"
                type="search"
                placeholder="Search by name, scientific name or keyword..."
              />
            </label>

            <div ref="sortMenu" class="sort-menu">
              <button
                type="button"
                class="sort-button"
                aria-label="Sort species"
                aria-haspopup="menu"
                :aria-expanded="sortMenuOpen"
                aria-controls="plant-sort-menu"
                @click="sortMenuOpen = !sortMenuOpen"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 6h12M4 6h.01M11 12h9M4 12h3M14 18h6M4 18h6" />
                </svg>
                <span>Sort</span>
              </button>

              <div v-if="sortMenuOpen" id="plant-sort-menu" class="sort-options" role="menu">
                <button
                  type="button"
                  role="menuitemradio"
                  :aria-checked="sortOption === 'default'"
                  :class="{ selected: sortOption === 'default' }"
                  @click="sortOption = 'default'; sortMenuOpen = false"
                >
                  Default order
                </button>
                <button
                  type="button"
                  role="menuitemradio"
                  :aria-checked="sortOption === 'name-asc'"
                  :class="{ selected: sortOption === 'name-asc' }"
                  @click="sortOption = 'name-asc'; sortMenuOpen = false"
                >
                  Name: A–Z
                </button>
                <button
                  type="button"
                  role="menuitemradio"
                  :aria-checked="sortOption === 'name-desc'"
                  :class="{ selected: sortOption === 'name-desc' }"
                  @click="sortOption = 'name-desc'; sortMenuOpen = false"
                >
                  Name: Z–A
                </button>
                <button
                  type="button"
                  role="menuitemradio"
                  :aria-checked="sortOption === 'scientific-asc'"
                  :class="{ selected: sortOption === 'scientific-asc' }"
                  @click="sortOption = 'scientific-asc'; sortMenuOpen = false"
                >
                  Scientific name: A–Z
                </button>
              </div>
            </div>
          </div>

          <div class="category-filters" aria-label="Filter species by plant group">
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

        <div v-if="filteredSpecies.length" class="plant-grid">
          <article v-for="item in filteredSpecies" :key="item.slug" class="plant-card">
            <div class="plant-image-wrapper">
              <img
                v-if="item.image || item.images?.find((image) => image.path)?.path"
                class="plant-card-image"
                :src="item.image || item.images?.find((image) => image.path)?.path"
                :alt="item.name"
              />
              <div v-else class="plant-image-placeholder" role="img" :aria-label="`${item.name} image placeholder`">
                <svg viewBox="0 0 64 64" aria-hidden="true">
                  <path d="M51 9C32 10 18 19 15 36c10-8 20-12 30-15-12 6-21 14-27 25" />
                  <path d="M16 37C7 29 7 19 8 12c9 3 16 9 18 17" />
                </svg>
                <span>Image coming soon</span>
              </div>
              <div class="card-badges">
                <span class="category-badge">{{ item.category }}</span>
                <span v-if="item.conservationStatus" class="status-badge">{{ item.conservationStatus }}</span>
              </div>
            </div>

            <div class="plant-card-content">
              <h3>{{ item.name }}</h3>
              <p class="scientific-name">{{ item.scientificName }}</p>
              <p v-if="item.family" class="plant-family"><span>Family:</span> {{ item.family }}</p>
              <p class="plant-description">{{ item.description }}</p>

              <div class="card-actions">
                <RouterLink
                  :to="`/species/${item.slug}`"
                  class="card-action-link card-action-secondary"
                  :aria-label="`View species information for ${item.scientificName}`"
                >
                  <span>View Species</span>
                </RouterLink>

                <RouterLink
                  :to="`/species/${item.slug}/plants`"
                  class="card-action-link card-action-primary"
                  :aria-label="`View individual plants for ${item.scientificName}`"
                >
                  <span>View Plants</span>
                  <span class="action-arrow" aria-hidden="true">→</span>
                </RouterLink>
              </div>
            </div>
          </article>
        </div>

        <div v-else class="empty-state">
          <span aria-hidden="true">🌿</span>
          <h3>No species found</h3>
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
  font-size: clamp(54px, 7vw, 86px);
  font-weight: 600;
  line-height: 1;
  letter-spacing: -2px;
}

.hero-lead {
  margin: 14px 0 8px;
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
  flex-direction: column;
  gap: 18px;
}

.filter-controls {
  display: flex;
  align-items: stretch;
  gap: 12px;
  min-width: 0;
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

.sort-menu {
  position: relative;
  flex: 0 0 auto;
}

.sort-button {
  height: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 18px;
  border: 1px solid #d9d9cf;
  border-radius: 14px;
  background: #fff;
  color: #44564e;
  box-shadow: 0 5px 20px rgba(35, 63, 49, 0.05);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
}

.sort-button svg {
  width: 18px;
  fill: none;
  stroke: #254b42;
  stroke-linecap: round;
  stroke-width: 2;
}

.sort-button:focus-visible,
.sort-options button:focus-visible {
  outline: 3px solid rgba(80, 138, 106, 0.12);
  outline-offset: 1px;
  border-color: #508a6a;
}

.sort-options {
  position: absolute;
  z-index: 5;
  top: calc(100% + 8px);
  right: 0;
  min-width: 220px;
  padding: 6px;
  border: 1px solid #d9d9cf;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 10px 30px rgba(33, 57, 44, 0.14);
}

.sort-options button {
  width: 100%;
  padding: 10px 12px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: #44564e;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  text-align: left;
}

.sort-options button:hover {
  background: #eeece3;
}

.sort-options button.selected {
  background: #dfe8da;
  color: #254b42;
  font-weight: 700;
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

.plant-card-image {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
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

.card-badges {
  position: absolute;
  top: 14px;
  right: 14px;
  left: 14px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.category-badge,
.status-badge {
  padding: 7px 11px;
  border-radius: 999px;
  background: rgba(20, 54, 37, 0.84);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.status-badge {
  background: rgba(255, 246, 220, 0.92);
  color: #6f532e;
  font-size: 9px;
  text-transform: uppercase;
}

.plant-card-content {
  padding: 22px;
}

.plant-card h3 {
  margin: 0;
  color: #203f35;
  font-size: 23px;
}

.scientific-name {
  margin: 5px 0 9px;
  color: #7c6c5b;
  font-size: 15px;
  font-style: italic;
}

.plant-family {
  margin: 0 0 14px;
  color: #66786f;
  font-size: 11px;
}

.plant-family span {
  color: #3d5f52;
  font-weight: 700;
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

.card-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 4px;
}

.card-action-link {
  min-height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 14px;

  border-radius: 999px;

  font-size: 12px;
  font-weight: 700;
  text-decoration: none;

  transition:
    transform 0.2s ease,
    background 0.2s ease,
    border-color 0.2s ease,
    color 0.2s ease,
    box-shadow 0.2s ease;
}

/* Secondary: species knowledge */
.card-action-secondary {
  border: 1px solid #b7c7bd;
  background: #f7f6ef;
  color: #315b49;
}

.card-action-secondary:hover {
  border-color: #759785;
  background: #e9f0e8;
  color: #234a3c;
  transform: translateY(-2px);
}

/* Primary: individual plants */
.card-action-primary {
  border: 1px solid #315b49;
  background: #315b49;
  color: #fff;
  box-shadow: 0 5px 14px rgba(35, 74, 60, 0.12);
}

.card-action-primary:hover {
  border-color: #234a3c;
  background: #234a3c;
  transform: translateY(-2px);
  box-shadow: 0 8px 18px rgba(35, 74, 60, 0.18);
}

.action-arrow {
  display: inline-block;
  font-size: 15px;
  line-height: 1;
  transition: transform 0.2s ease;
}

.card-action-primary:hover .action-arrow {
  transform: translateX(3px);
}

.card-action-link:focus-visible {
  outline: 3px solid rgba(49, 91, 73, 0.22);
  outline-offset: 3px;
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
    min-height: 320px;
  }

  .hero-content {
    width: 90%;
    padding: 48px 0 32px;
  }

  .eyebrow,
  .section-label {
    margin-bottom: 8px;
    font-size: 10px;
    letter-spacing: 2px;
  }

  .plants-hero h1 {
    font-size: 40px;
    letter-spacing: -1px;
  }

  .hero-lead {
    margin: 9px 0 5px;
    font-size: 17px;
  }

  .hero-copy {
    font-size: 12px;
    line-height: 1.55;
  }

  .plant-library {
    padding: 32px 0 44px;
  }

  .library-container {
    width: 92%;
  }

  .library-heading {
    margin-bottom: 20px;
    align-items: flex-start;
    flex-direction: column;
    gap: 5px;
  }

  .library-heading h2 {
    font-size: 28px;
  }

  .library-heading > p {
    margin-bottom: 0;
    font-size: 11px;
  }

  .filter-bar {
    margin-bottom: 22px;
    gap: 12px;
  }

  .filter-controls {
    gap: 8px;
  }

  .search-box {
    min-width: 0;
    gap: 8px;
    padding: 0 12px;
    border-radius: 11px;
  }

  .search-box svg {
    width: 17px;
  }

  .search-box input {
    padding: 11px 0;
    font-size: 13px;
  }

  .sort-button {
    min-height: 42px;
    padding: 0 12px;
    border-radius: 11px;
    font-size: 12px;
  }

  .sort-button svg {
    width: 16px;
  }

  .category-filters {
    gap: 6px;
  }

  .category-filters button {
    padding: 8px 13px;
    font-size: 11px;
  }

  .plant-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .plant-card {
    display: flex;
    flex-direction: column;
    border-radius: 13px;
    box-shadow: 0 5px 16px rgba(33, 57, 44, 0.06);
  }

  .plant-image-wrapper {
    aspect-ratio: 4 / 3;
  }

  .card-badges {
    top: 7px;
    right: 7px;
    left: 7px;
    flex-wrap: wrap;
    gap: 4px;
  }

  .category-badge,
  .status-badge {
    padding: 4px 6px;
    font-size: 8px;
  }

  .status-badge {
    font-size: 7px;
  }

  .plant-card-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 11px;
  }

  .plant-card h3 {
    font-size: 16px;
    line-height: 1.15;
  }

  .scientific-name {
    margin: 3px 0 5px;
    font-size: 11px;
    line-height: 1.3;
  }

  .plant-family {
    margin-bottom: 7px;
    font-size: 9px;
    line-height: 1.3;
  }

  .plant-description {
    min-height: 30px;
    margin-bottom: 10px;
    display: -webkit-box;
    overflow: hidden;
    font-size: 10px;
    line-height: 1.45;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .card-actions {
    grid-template-columns: 1fr;
    gap: 6px;
    margin-top: auto;
  }

  .card-action-link {
    min-height: 36px;
    width: 100%;
    box-sizing: border-box;
    padding: 7px 8px;
    font-size: 10px;
  }

  .action-arrow {
    font-size: 12px;
  }

  .empty-state {
    padding: 42px 18px;
  }

  .empty-state > span {
    font-size: 30px;
  }

  .empty-state h3 {
    margin: 9px 0 4px;
    font-size: 21px;
  }

  .empty-state p {
    margin-bottom: 15px;
    font-size: 12px;
  }

  .empty-state button {
    padding: 9px 14px;
    font-size: 12px;
  }

  .plants-quote {
    min-height: 150px;
    padding: 30px 6%;
  }

  .plants-quote p {
    margin-bottom: 13px;
    font-size: 22px;
  }

  .plants-quote span {
    font-size: 9px;
    letter-spacing: 3px;
  }
}

@media (max-width: 360px) {
  .plant-card-content {
    padding: 9px;
  }

  .card-action-link {
    min-height: 35px;
    padding-inline: 6px;
    font-size: 9px;
  }

  .action-arrow {
    font-size: 11px;
  }
}
</style>
