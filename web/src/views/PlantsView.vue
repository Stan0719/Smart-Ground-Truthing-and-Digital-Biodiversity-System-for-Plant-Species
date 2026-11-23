<script setup lang="ts">
import { conservationBadgeStyle } from '../utils/conservationBadge'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import NavigationBar from '../components/NavigationBar.vue'
import { usePrototypeSession } from '../composables/usePrototypeSession'
import { plants as prototypePlants, type Plant } from '../data/plants'
import type { AuthUser } from '../services/auth'
import { useCatalogueRefresh } from '../composables/useCatalogueRefresh'
import {refreshKnowledge,knowledgeError,catalogueLimited} from '../services/knowledge'

const species = ref<Plant[]>([])
const isLoading = ref(true)
const loadError = ref('')
const normalizeFamily = (value: string | null | undefined) => value?.trim().replace(/\s+/g, ' ') || ''
const familyKey = (value: string | null | undefined) => normalizeFamily(value).toLowerCase()
const activeFamily = ref('')
// Options describe only the authorized species returned by the existing capped API.
const families = computed(() => {
  const labels = new Map<string, string>()
  for (const item of species.value) {
    const label = normalizeFamily(item.family)
    if (label && !labels.has(familyKey(label))) labels.set(familyKey(label), label)
  }
  return [...labels].sort((a, b) => a[1].localeCompare(b[1]))
})
watch(families, (options) => {
  if (activeFamily.value && !options.some(([key]) => key === activeFamily.value)) activeFamily.value = ''
})
const sortOption = ref<'default' | 'name-asc' | 'name-desc' | 'scientific-asc'>('default')
const sortMenuOpen = ref(false)
const sortMenu = ref<HTMLElement | null>(null)
const familyDropdownOpen = ref(false)
const familyDropdown = ref<HTMLElement | null>(null)
const familyFilterTrigger = ref<HTMLButtonElement | null>(null)
const familySearchInput = ref<HTMLInputElement | null>(null)
const familySearchQuery = ref('')
const activeFamilyOption = ref(0)
const route = useRoute()
const { t } = useI18n()
// Keep the translated title intact, including Chinese word order.
const heroTitleParts = computed(() => t('species.heroTitle').split(/(Niah|尼亚)/u))
const { isLoggedIn, userRole } = usePrototypeSession()
const searchQuery = ref(typeof route.query.search === 'string' ? route.query.search.slice(0, 100) : '')
const familyOptions = computed(() => [
  { key: '', label: t('species.allFamilies') },
  ...families.value.map(([key, label]) => ({ key, label })),
])
const matchingFamilyOptions = computed(() => {
  const query = familySearchQuery.value.trim().toLocaleLowerCase()
  return query
    ? familyOptions.value.filter((option) => option.label.toLocaleLowerCase().includes(query))
    : familyOptions.value
})
const selectedFamilyLabel = computed(() =>
  familyOptions.value.find((option) => option.key === activeFamily.value)?.label || t('species.allFamilies'),
)
const activeFamilyOptionId = computed(() =>
  matchingFamilyOptions.value[activeFamilyOption.value]
    ? `family-option-${activeFamilyOption.value}`
    : undefined,
)

watch(familyDropdownOpen, async (open) => {
  if (open) {
    await nextTick()
    familySearchInput.value?.focus()
  }
})
watch(familySearchQuery, () => { activeFamilyOption.value = 0 })

const closeFamilyDropdown = () => {
  familyDropdownOpen.value = false
  familySearchQuery.value = ''
}

const toggleFamilyDropdown = () => {
  if (familyDropdownOpen.value) {
    closeFamilyDropdown()
    return
  }
  familySearchQuery.value = ''
  const selectedIndex = familyOptions.value.findIndex((option) => option.key === activeFamily.value)
  activeFamilyOption.value = Math.max(0, selectedIndex)
  familyDropdownOpen.value = true
}

const chooseFamily = async (key: string) => {
  activeFamily.value = key
  closeFamilyDropdown()
  await nextTick()
  familyFilterTrigger.value?.focus()
}

const handleFamilySearchKeydown = (event: KeyboardEvent) => {
  const lastIndex = matchingFamilyOptions.value.length - 1
  const activeOption = matchingFamilyOptions.value[activeFamilyOption.value]
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    activeFamilyOption.value = Math.min(lastIndex, activeFamilyOption.value + 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    activeFamilyOption.value = Math.max(0, activeFamilyOption.value - 1)
  } else if (event.key === 'Home' && lastIndex >= 0) {
    event.preventDefault()
    activeFamilyOption.value = 0
  } else if (event.key === 'End' && lastIndex >= 0) {
    event.preventDefault()
    activeFamilyOption.value = lastIndex
  } else if (event.key === 'Enter' && activeOption) {
    event.preventDefault()
    void chooseFamily(activeOption.key)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    closeFamilyDropdown()
    void nextTick(() => familyFilterTrigger.value?.focus())
  } else if (event.key === 'Tab') {
    closeFamilyDropdown()
    void nextTick(() => familyFilterTrigger.value?.focus())
  }
}

const handleFamilyTriggerKeydown = (event: KeyboardEvent) => {
  if (!familyDropdownOpen.value && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    event.preventDefault()
    toggleFamilyDropdown()
  }
}

const selectSort = (option: typeof sortOption.value) => {
  sortOption.value = option
  sortMenuOpen.value = false
}

const clearFilters = () => {
  searchQuery.value = ''
  activeFamily.value = ''
  sortMenuOpen.value = false
  closeFamilyDropdown()
}

const fetchSpecies = async (current: () => boolean, user: AuthUser | null) => {
  isLoading.value = species.value.length === 0
  loadError.value = ''
  try {
    await refreshKnowledge(user)
    if (!current()) return
    if (knowledgeError.value) throw Error(knowledgeError.value)
    // App-level and page-level refreshes share this authorized reactive catalogue.
    // Keep the live collection so a newer refresh cannot leave a copied empty list.
    species.value = prototypePlants
  } catch (error) {
    if (current()) { loadError.value = error instanceof Error ? error.message : t('catalogueDisplay.loadFailed') }
  } finally { if (current()) isLoading.value = false }
}
const catalogue = useCatalogueRefresh(fetchSpecies,
  () => { species.value = []; isLoading.value = false },
  () => { loadError.value = t('catalogueDisplay.loadFailed') })
const loadSpecies = () => catalogue.refresh()

const canViewConservationStatus = computed(
  () =>
    isLoggedIn.value && (userRole.value === 'botanist' || userRole.value === 'conservation-officer' || userRole.value === 'admin'),
)

const displayName = (item: Plant) => item.name
const displayScientificName = (item: Plant) =>
  item.scientificName
const displayFamily = (item: Plant) => item.family || ''

const closeSortMenu = (event: MouseEvent | KeyboardEvent) => {
  if (event instanceof KeyboardEvent && event.key === 'Escape') {
    sortMenuOpen.value = false
    closeFamilyDropdown()
  } else if (!(event.target instanceof Node) ||
    (!sortMenu.value?.contains(event.target) && !familyDropdown.value?.contains(event.target))) {
    sortMenuOpen.value = false
    closeFamilyDropdown()
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
    searchQuery.value = typeof search === 'string' ? search.slice(0, 100) : ''
  },
)

const filteredSpecies = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()

  const filtered = species.value.filter((item) => {
    const matchesFamily = !activeFamily.value || familyKey(item.family) === activeFamily.value
    const matchesSearch =
      !query ||
      item.name.toLowerCase().includes(query) ||
      displayName(item).toLowerCase().includes(query) ||
      item.scientificName.toLowerCase().includes(query) ||
      item.genus?.toLowerCase().includes(query) ||
      item.family?.toLowerCase().includes(query) ||
      item.description.toLowerCase().includes(query)

    return matchesFamily && matchesSearch
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
        <h1><template v-for="(part, index) in heroTitleParts" :key="index"><span v-if="part === 'Niah' || part === '尼亚'" class="hero-place-name">{{ part }}</span><template v-else>{{ part }}</template></template></h1>
        <p class="hero-lead">{{ t('species.heroLead') }}</p>
        <p class="hero-copy">{{ t('species.heroDescription') }}</p>
      </div>
    </section>

    <section class="plant-library" aria-labelledby="plant-library-title">
      <div class="library-container">
        <div class="library-heading">
          <div>
            <p class="section-label">{{ t('species.libraryEyebrow') }}</p>
            <h2 id="plant-library-title">{{ t('species.libraryTitle') }}</h2>
          </div>
          <p v-if="!isLoading && !loadError">{{ t('species.found', { count: filteredSpecies.length }) }}</p>
        </div>

        <p v-if="catalogueLimited" class="catalogue-notice" role="status">{{ t('catalogueDisplay.speciesLimited') }}</p>
        <div class="filter-bar">
          <div class="filter-controls">
            <label class="search-box">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m21 21-4.35-4.35m2.35-5.15A7.5 7.5 0 1 1 4 11.5a7.5 7.5 0 0 1 15 0Z" />
              </svg>
              <span class="sr-only">{{ t('nav.searchSpecies') }}</span>
              <input
                v-model="searchQuery"
                type="search"
                maxlength="100"
                :placeholder="t('species.searchPlaceholder')"
              />
            </label>
          </div>

          <div class="family-controls">
            <div ref="familyDropdown" class="family-dropdown">
              <span class="filter-control-label">{{ t('species.filterByFamily') }}</span>
              <button
                ref="familyFilterTrigger"
                type="button"
                class="family-select-trigger"
                :aria-label="`${t('species.filterByFamily')}: ${selectedFamilyLabel}`"
                aria-haspopup="listbox"
                :aria-expanded="familyDropdownOpen"
                aria-controls="family-options"
                @click="toggleFamilyDropdown"
                @keydown="handleFamilyTriggerKeydown"
              >
                <span class="family-select-value">{{ selectedFamilyLabel }}</span>
                <svg viewBox="0 0 24 24" aria-hidden="true" :class="{ open: familyDropdownOpen }">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>

              <div v-if="familyDropdownOpen" class="family-dropdown-panel">
                <label class="family-search-box">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="10.5" cy="10.5" r="6.5" />
                    <path d="m15.5 15.5 5 5" />
                  </svg>
                  <span class="sr-only">{{ t('species.searchFamilies') }}</span>
                  <input
                    ref="familySearchInput"
                    v-model="familySearchQuery"
                    type="search"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-controls="family-options"
                    aria-expanded="true"
                    :aria-label="t('species.searchFamilies')"
                    :aria-activedescendant="activeFamilyOptionId"
                    :placeholder="t('species.searchFamilies')"
                    @keydown="handleFamilySearchKeydown"
                  />
                </label>
                <div id="family-options" class="family-option-list" role="listbox" :aria-label="t('species.filterByFamily')">
                  <div
                    v-for="(option, index) in matchingFamilyOptions"
                    :id="`family-option-${index}`"
                    :key="option.key || 'all-families'"
                    class="family-option"
                    :class="{ selected: activeFamily === option.key, highlighted: activeFamilyOption === index }"
                    role="option"
                    :aria-selected="activeFamily === option.key"
                    @mouseenter="activeFamilyOption = index"
                    @mousedown.prevent
                    @click="chooseFamily(option.key)"
                  >
                    {{ option.label }}
                  </div>
                  <p v-if="!matchingFamilyOptions.length" class="family-options-empty" role="status">
                    {{ t('species.noFamiliesFound') }}
                  </p>
                </div>
              </div>
            </div>

            <button class="filter-reset-button" type="button" @click="clearFilters">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 12a9 9 0 1 0 2.64-6.36L3 8" />
                <path d="M3 3v5h5" />
              </svg>
              {{ t('species.reset') }}
            </button>

            <div ref="sortMenu" class="sort-menu">
              <button
                type="button"
                class="sort-button"
                :aria-label="t('species.sortLabel')"
                aria-haspopup="menu"
                :aria-expanded="sortMenuOpen"
                aria-controls="plant-sort-menu"
                @click="sortMenuOpen = !sortMenuOpen"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 6h12M4 6h.01M11 12h9M4 12h3M14 18h6M4 18h6" />
                </svg>
                <span>{{ t('common.sort') }}</span>
              </button>

              <div v-if="sortMenuOpen" id="plant-sort-menu" class="sort-options" role="menu">
                <button
                  type="button"
                  role="menuitemradio"
                  :aria-checked="sortOption === 'default'"
                  :class="{ selected: sortOption === 'default' }"
                  @click="selectSort('default')"
                >
                  {{ t('species.sortDefault') }}
                </button>
                <button
                  type="button"
                  role="menuitemradio"
                  :aria-checked="sortOption === 'name-asc'"
                  :class="{ selected: sortOption === 'name-asc' }"
                  @click="selectSort('name-asc')"
                >
                  {{ t('species.sortNameAsc') }}
                </button>
                <button
                  type="button"
                  role="menuitemradio"
                  :aria-checked="sortOption === 'name-desc'"
                  :class="{ selected: sortOption === 'name-desc' }"
                  @click="selectSort('name-desc')"
                >
                  {{ t('species.sortNameDesc') }}
                </button>
                <button
                  type="button"
                  role="menuitemradio"
                  :aria-checked="sortOption === 'scientific-asc'"
                  :class="{ selected: sortOption === 'scientific-asc' }"
                  @click="selectSort('scientific-asc')"
                >
                  {{ t('species.sortScientific') }}
                </button>
              </div>
            </div>
          </div>

          <p class="current-family-filter" aria-live="polite">
            {{ t('species.currentFilter', { family: selectedFamilyLabel }) }}
          </p>
        </div>

        <p v-if="isLoading" role="status">Loading plant species...</p>

        <p v-else-if="loadError" role="alert">
          {{ loadError }}
          <button type="button" @click="loadSpecies">Try again</button>
        </p>

        <div v-if="!isLoading && filteredSpecies.length" class="plant-grid">
          <article v-for="item in filteredSpecies" :key="item.slug" class="plant-card">
            <div class="plant-image-wrapper">
              <img
                v-if="item.image || item.images?.find((image) => image.path)?.path"
                class="plant-card-image"
                :src="item.image || item.images?.find((image) => image.path)?.path"
                :alt="displayName(item)"
              />
              <div
                v-else
                class="plant-image-placeholder"
                role="img"
                :aria-label="displayName(item) + ' image placeholder'"
              >
                <svg viewBox="0 0 64 64" aria-hidden="true">
                  <path d="M51 9C32 10 18 19 15 36c10-8 20-12 30-15-12 6-21 14-27 25" />
                  <path d="M16 37C7 29 7 19 8 12c9 3 16 9 18 17" />
                </svg>
                <span>{{ t('species.imageComingSoon') }}</span>
              </div>
              <div class="card-badges">
                <span
                  v-if="canViewConservationStatus && item.conservationStatus"
                  class="status-badge"
                  :style="conservationBadgeStyle(item.conservationStatus)"
                  >{{ item.conservationStatus }}</span
                >
              </div>
            </div>

            <div class="plant-card-content">
              <h3>{{ displayName(item) }}</h3>
              <p class="scientific-name">{{ displayScientificName(item) }}</p>
              <p v-if="item.family" class="plant-family">
                <span>{{ t('common.family') }}:</span> {{ displayFamily(item) }}
              </p>

              <div class="card-actions">
                <RouterLink
                  :to="`/species/${item.slug}`"
                  class="card-action-link card-action-secondary"
                  :aria-label="`View species information for ${item.scientificName}`"
                >
                  <span>{{ t('common.viewSpecies') }}</span>
                </RouterLink>

                <RouterLink
                  :to="`/species/${item.slug}/plants`"
                  class="card-action-link card-action-primary"
                  :aria-label="`View individual plants for ${item.scientificName}`"
                >
                  <span>{{ t('common.viewPlants') }}</span>
                </RouterLink>
              </div>
            </div>
          </article>
        </div>

        <div v-else-if="!isLoading && !loadError" class="empty-state">
          <span aria-hidden="true">ðŸŒ¿</span>
          <h3>{{ t('species.notFound') }}</h3>
          <p>{{ t('species.noMatch') }}</p>
          <button type="button" @click="clearFilters">
            {{ t('common.clearFilters') }}
          </button>
        </div>
      </div>
    </section>

    <section class="plants-quote">
      <p>{{ t('species.quote') }}</p>
      <span>{{ t('species.quoteAttribution') }}</span>
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
  background-image: url('/images/background_PlantsView.png');
  background-position: center 48%;
  background-size: cover;
  overflow: hidden;
}

.hero-overlay {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(
      90deg,
      rgba(8, 24, 17, 0.86) 0%,
      rgba(8, 24, 17, 0.6) 44%,
      rgba(8, 24, 17, 0.15) 78%
    ),
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

.hero-place-name {
  color: #A8D8B2;
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

.family-controls {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 10px;
  min-width: 0;
}

.family-dropdown {
  position: relative;
  display: grid;
  flex: 1 1 260px;
  gap: 6px;
  min-width: min(260px, 100%);
}

.filter-control-label {
  color: #63766d;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.family-select-trigger,
.filter-reset-button {
  box-sizing: border-box;
  min-height: 46px;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid #d0d9cf;
  border-radius: 13px;
  background: #fff;
  color: #254b42;
  box-shadow: 0 5px 20px rgba(35, 63, 49, 0.05);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
}

.family-select-trigger {
  width: 100%;
  justify-content: space-between;
  padding: 10px 14px;
  text-align: left;
}

.family-select-value {
  min-width: 0;
  overflow-wrap: anywhere;
}

.family-select-trigger svg,
.filter-reset-button svg {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  fill: none;
  stroke: #356f5a;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.family-select-trigger svg {
  transition: transform 0.18s ease;
}

.family-select-trigger svg.open {
  transform: rotate(180deg);
}

.family-select-trigger:hover,
.filter-reset-button:hover {
  border-color: #93b6a1;
  background: #f6f8f1;
}

.family-select-trigger:focus-visible,
.filter-reset-button:focus-visible,
.family-search-box:focus-within {
  outline: 3px solid rgba(80, 138, 106, 0.24);
  outline-offset: 2px;
  border-color: #508a6a;
}

.family-dropdown-panel {
  position: absolute;
  z-index: 10;
  top: calc(100% + 7px);
  right: 0;
  left: 0;
  min-width: 0;
  padding: 9px;
  border: 1px solid #d5ded3;
  border-radius: 14px;
  background: #fffefa;
  box-shadow: 0 12px 28px rgba(33, 57, 44, 0.16);
}

.family-search-box {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 10px;
  border: 1px solid #d9d9cf;
  border-radius: 10px;
  background: #fff;
}

.family-search-box svg {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  fill: none;
  stroke: #356f5a;
  stroke-linecap: round;
  stroke-width: 1.8;
}

.family-search-box input {
  width: 100%;
  min-width: 0;
  min-height: 42px;
  padding: 8px 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: #254b42;
  font: inherit;
  font-size: 13px;
}

.family-option-list {
  max-height: min(280px, 45vh);
  margin-top: 7px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.family-option {
  min-height: 42px;
  display: flex;
  align-items: center;
  padding: 8px 10px;
  border-radius: 9px;
  color: #40584e;
  cursor: pointer;
  font-size: 13px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.family-option:hover,
.family-option.highlighted {
  background: #edf3e9;
}

.family-option.selected {
  background: #dceadf;
  color: #245643;
  font-weight: 700;
}

.family-options-empty {
  margin: 0;
  padding: 12px 10px;
  color: #687970;
  font-size: 12px;
}

.filter-reset-button {
  justify-content: center;
  padding: 0 14px;
  white-space: nowrap;
}

.current-family-filter {
  margin: -10px 0 0;
  color: #687970;
  font-size: 12px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.sort-menu {
  position: relative;
  flex: 0 0 auto;
}

.sort-button {
  box-sizing: border-box;
  flex: 0 0 auto;
  height: 46px;
  min-height: 46px;
  min-width: 96px;
  display: flex;
  align-items: center;
  justify-content: center;
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
  height: 18px;
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
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 20px;
}

.plant-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(49, 91, 70, 0.1);
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 10px 30px rgba(33, 57, 44, 0.08);
  transition:
    transform 0.25s ease,
    box-shadow 0.25s ease;
}

.plant-card:hover {
  transform: translateY(-6px);
  box-shadow: 0 18px 38px rgba(33, 57, 44, 0.14);
}

.plant-image-wrapper {
  flex-shrink: 0;
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
  justify-content: flex-end;
  gap: 8px;
}

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
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  padding: 12px 16px;
}

.plant-card h3 {
  margin: 0;
  color: #203f35;
  font-size: 21px;
}

.scientific-name {
  margin: 3px 0 6px;
  color: #7c6c5b;
  font-size: 15px;
  font-style: italic;
}

.plant-family {
  margin: 0 0 8px;
  color: #66786f;
  font-size: 11px;
}

.plant-family span {
  color: #3d5f52;
  font-weight: 700;
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
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: auto;
  padding-top: 4px;
}

.card-action-link {
  box-sizing: border-box;
  width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
  min-width: 0;
  text-align: center;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 6px 8px;

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
  margin: 0 0 12px;
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

@media (max-width: 1199px) {
  .plant-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 950px) {
  .family-controls {
    align-items: flex-end;
  }

  .plant-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 620px) {
  .plants-page {
    overflow-x: hidden;
  }

  .plants-hero {
    min-height: 310px;
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

  .filter-controls > * {
    min-width: 0;
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
    min-width: 0;
    padding: 11px 0;
    font-size: 13px;
    text-overflow: ellipsis;
  }

  .sort-button {
    height: 42px;
    min-height: 42px;
    min-width: 88px;
    padding: 0 12px;
    border-radius: 11px;
    font-size: 12px;
  }

  .sort-button svg {
    width: 16px;
  }

  .sort-options {
    width: min(220px, 88vw);
    min-width: 0;
  }

  .family-controls {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: end;
    gap: 8px;
  }

  .family-dropdown {
    grid-column: 1 / -1;
    min-width: 0;
  }

  .family-select-trigger,
  .filter-reset-button {
    min-height: 42px;
    border-radius: 11px;
    font-size: 12px;
  }

  .family-select-trigger {
    padding: 8px 12px;
  }

  .filter-reset-button {
    padding: 0 11px;
  }

  .filter-reset-button svg {
    width: 16px;
    height: 16px;
  }

  .sort-button {
    min-height: 42px;
  }

  .family-dropdown-panel {
    right: 0;
    left: 0;
    width: auto;
  }

  .current-family-filter {
    margin-top: -5px;
    font-size: 11px;
  }

  .plant-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .plant-card {
    min-width: 0;
    display: flex;
    flex-direction: column;
    border-radius: 13px;
    box-shadow: 0 5px 16px rgba(33, 57, 44, 0.06);
  }

  .plant-image-wrapper {
    min-width: 0;
    aspect-ratio: 4 / 3;
  }

  .plant-image-placeholder {
    gap: 7px;
  }

  .plant-image-placeholder svg {
    width: 34px;
  }

  .plant-image-placeholder span {
    padding: 0 5px;
    font-size: 8px;
    letter-spacing: 0.6px;
    text-align: center;
  }

  .card-badges {
    top: 7px;
    right: 7px;
    left: 7px;
    flex-wrap: wrap;
    gap: 4px;
  }

  .status-badge {
    padding: 4px 6px;
    font-size: 8px;
  }

  .status-badge {
    font-size: 7px;
  }

  .plant-card-content {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 8px;
  }

  .plant-card h3 {
    font-size: 16px;
    line-height: 1.15;
    overflow-wrap: anywhere;
  }

  .scientific-name {
    margin: 3px 0 5px;
    font-size: 11px;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }

  .plant-family {
    margin-bottom: 7px;
    font-size: 9px;
    line-height: 1.3;
  }


  .card-actions {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 5px;
    margin-top: auto;
  }

  .card-action-link {
    min-height: 44px;
    width: 100%;
    box-sizing: border-box;
    gap: 3px;
    padding: 5px 4px;
    font-size: 9px;
    white-space: normal;
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
  .plants-hero {
    min-height: 300px;
  }

  .plants-hero h1 {
    font-size: 38px;
  }

  .library-container {
    width: 90%;
  }

  .plant-grid {
    gap: 8px;
  }

  .plant-card-content {
    padding: 9px;
  }

  .card-action-link {
    min-height: 44px;
    padding-inline: 6px;
    font-size: 9px;
  }

}

</style>
