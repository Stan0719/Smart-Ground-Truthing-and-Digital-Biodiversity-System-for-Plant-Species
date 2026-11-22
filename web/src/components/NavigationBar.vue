<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onBeforeUnmount, watch } from 'vue'

import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import LoginModal from './LoginModal.vue'
import LanguageSwitcher from './LanguageSwitcher.vue'
import { verifySession, logout as serverLogout } from '../services/auth'
import { searchGlobalWebsite, type GlobalSearchCategory, type GlobalSearchResponse, type GlobalSearchResult } from '../services/globalSearch'

import { usePrototypeSession } from '../composables/usePrototypeSession'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const navSearch = ref('')
const searchOpen = ref(false)
const searchLoading = ref(false)
const searchError = ref(false)
const searchActiveIndex = ref(-1)
const searchResponse = ref<GlobalSearchResponse | null>(null)
const searchCategories: GlobalSearchCategory[] = ['species', 'plants', 'observations', 'alerts', 'pages']
const isSearchableQuery = computed(() => navSearch.value.trim().length >= 2 || /^\d$/.test(navSearch.value.trim()))
let searchTimer: number | undefined
let searchController: AbortController | null = null
let searchRequest = 0
const flatSearchResults = computed(() => searchCategories.flatMap((category) => searchResponse.value?.results?.[category] || []))
const searchOptionId = (variant: string, result: GlobalSearchResult) => `${variant}-global-search-${flatSearchResults.value.indexOf(result)}`

watch([navSearch, locale], ([rawQuery, selectedLocale]) => {
  window.clearTimeout(searchTimer)
  searchController?.abort()
  const request = ++searchRequest
  searchResponse.value = null
  searchError.value = false
  searchActiveIndex.value = -1
  const query = rawQuery.trim()
  if (query.length < 2 && !/^\d$/.test(query)) { searchLoading.value = false; return }
  searchTimer = window.setTimeout(async () => {
    const controller = new AbortController()
    searchController = controller
    searchLoading.value = true
    try {
      const result = await searchGlobalWebsite(query, selectedLocale, { limit: 4, signal: controller.signal })
      if (request === searchRequest && !controller.signal.aborted) searchResponse.value = result
    } catch (error) {
      if (request === searchRequest && !(error instanceof DOMException && error.name === 'AbortError')) searchError.value = true
    } finally {
      if (request === searchRequest) searchLoading.value = false
    }
  }, 300)
}, { flush: 'post' })

const openSearchResult = (result: GlobalSearchResult) => {
  searchOpen.value = false
  searchActiveIndex.value = -1
  closeMobileMenu()
  void router.push(result.path)
}

const submitNavSearch = () => {
  const query = navSearch.value.trim()
  if (!query) return
  const selected = flatSearchResults.value[searchActiveIndex.value]
  if (selected) { openSearchResult(selected); return }
  searchOpen.value = false
  void router.push({ name: 'global-search', query: { q: query } })
}

const handleSearchKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') { searchOpen.value = false; searchActiveIndex.value = -1; return }
  if (event.key === 'ArrowDown' && flatSearchResults.value.length) {
    event.preventDefault(); searchOpen.value = true
    searchActiveIndex.value = (searchActiveIndex.value + 1) % flatSearchResults.value.length
  } else if (event.key === 'ArrowUp' && flatSearchResults.value.length) {
    event.preventDefault(); searchOpen.value = true
    searchActiveIndex.value = searchActiveIndex.value <= 0 ? flatSearchResults.value.length - 1 : searchActiveIndex.value - 1
  }
}

const resultTypeLabel = (type: GlobalSearchCategory) => t(`globalSearch.categories.${type}`)

type UserRole = 'admin' | 'conservation-officer' | null

const { isLoggedIn, userRole, username, sessionPending, canUseProtectedSession } = usePrototypeSession()

const navItems = computed(() => {
  const items = [
    {
      label: t('nav.home'),
      to: '/',
    },
    {
      label: t('nav.species'),
      to: '/species',
    },
  ]

  if (canUseProtectedSession.value && userRole.value === 'admin') {
    items.push({
      label: t('nav.admin'),
      to: '/admin',
    })
  }

  if (canUseProtectedSession.value && userRole.value === 'conservation-officer') {
    items.push({
      label: t('nav.officer'),
      to: '/conservation-dashboard',
    })
  }

  return items
})

const navTrack = ref<HTMLElement | null>(null)

const thumbLeft = ref(0)
const thumbWidth = ref(0)

const activeNavIndex = computed(() => {
  const index = navItems.value.findIndex((item) => {
    if (item.to === '/') {
      return route.path === '/'
    }

    if (item.to === '/species') {
      return route.path.startsWith('/species') || route.path.startsWith('/plant/')
    }

    return route.path.startsWith(item.to)
  })

  return index === -1 ? 0 : index
})

const updateNavThumb = async () => {
  await nextTick()

  const track = navTrack.value

  if (!track) {
    return
  }

  const links = track.querySelectorAll<HTMLElement>('.nav-link')

  const activeLink = links[activeNavIndex.value]

  if (!activeLink) {
    return
  }

  const trackRect = track.getBoundingClientRect()

  const linkRect = activeLink.getBoundingClientRect()

  thumbLeft.value = linkRect.left - trackRect.left

  thumbWidth.value = linkRect.width
}

const navThumbStyle = computed(() => ({
  transform: `translateX(${thumbLeft.value}px)`,
  width: `${thumbWidth.value}px`,
}))

const handleResize = () => {
  updateNavThumb()
}

onMounted(async () => {
  void verifySession()
  updateNavThumb()

  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  window.clearTimeout(searchTimer)
  searchController?.abort()
})

watch([() => route.path, isLoggedIn, userRole, canUseProtectedSession], () => {
  updateNavThumb()
})
watch(() => route.fullPath, () => { searchOpen.value = false })

const mobileMenuOpen = ref(false)
const mobileSearchOpen = ref(false)

const loginModalOpen = ref(false)

const logoutModalOpen = ref(false)

const closeMobileMenu = () => {
  mobileMenuOpen.value = false
  mobileSearchOpen.value = false

}

const submitMobileSearch = () => {
  submitNavSearch()
  mobileSearchOpen.value = false
  closeMobileMenu()
}

const handleLogoClick = (event: MouseEvent) => {
  closeMobileMenu()

  // If already on HomeView, scroll to the top instead of reloading the route
  if (route.path === '/') {
    event.preventDefault()

    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    })
  }
}

const toggleMobileMenu = () => {
  mobileMenuOpen.value = !mobileMenuOpen.value
}

const openLoginModal = () => {
  mobileMenuOpen.value = false
  loginModalOpen.value = true
}

const handleLogin = (user: {
  username: string
  role: Exclude<UserRole, null>
  email?: string
  mustChangePassword?: boolean
}) => {
  loginModalOpen.value = false
  router.push(
    user.role === 'admin' ? { name: 'admin-dashboard' } : { name: 'conservation-dashboard' },
  )
}

const closeLoginModal = () => {
  loginModalOpen.value = false
}

const openLogoutModal = () => {
  mobileMenuOpen.value = false

  logoutModalOpen.value = true
}

const closeLogoutModal = () => {
  logoutModalOpen.value = false
}

const logout = async () => {
  await serverLogout()

  logoutModalOpen.value = false
}
</script>

<template>
  <header class="navbar">
    <div class="navbar-container">
      <!-- Logo -->
      <RouterLink to="/" class="logo" @click="handleLogoClick">
        <img src="/images/logo2.png" alt="Niah Biodiversity Logo" class="logo-image" />

        <div class="logo-text">
          <span class="logo-title">NIAH</span>
          <span class="logo-subtitle">BIODIVERSITY</span>
        </div>
      </RouterLink>

      <!-- Desktop Navigation -->
      <nav class="desktop-nav" :aria-label="t('nav.main')">
        <div
          ref="navTrack"
          class="nav-track"
        >
          <div
            class="nav-thumb"
            :style="navThumbStyle"
            aria-hidden="true"
          ></div>

          <RouterLink
            v-for="(item, index) in navItems"
            :key="item.to"
            :to="item.to"
            class="nav-link"
            :class="{ 'is-active': index === activeNavIndex }"
          >
            {{ item.label }}
          </RouterLink>

          <form class="nav-search" role="search" @submit.prevent="submitNavSearch">
            <label>
              <span class="sr-only">{{ t('globalSearch.inputLabel') }}</span>
              <input
                v-model="navSearch"
                autocomplete="off"
                :placeholder="t('globalSearch.placeholder')"
                type="search"
                maxlength="100"
                role="combobox"
                aria-autocomplete="list"
                :aria-expanded="searchOpen && isSearchableQuery"
                aria-controls="desktop-global-search-results"
                :aria-activedescendant="searchOpen && searchActiveIndex >= 0 ? `desktop-global-search-${searchActiveIndex}` : undefined"
                @focus="searchOpen = true"
                @keydown="handleSearchKeydown"
              />
            </label>

            <button type="submit" :aria-label="t('globalSearch.submit')">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="10.8" cy="10.8" r="6.8" />
                <path d="m16 16 4.5 4.5" />
              </svg>
            </button>
            <div
              v-if="searchOpen && isSearchableQuery"
              id="desktop-global-search-results"
              class="global-search-suggestions"
              role="listbox"
              :aria-label="t('globalSearch.suggestions')"
            >
              <p v-if="searchLoading" class="suggestion-state" role="status">{{ t('globalSearch.loading') }}</p>
              <p v-else-if="searchError" class="suggestion-state">{{ t('globalSearch.error') }}</p>
              <p v-else-if="!flatSearchResults.length" class="suggestion-state">{{ t('globalSearch.empty') }}</p>
              <template v-else>
                <template v-for="category in searchCategories" :key="category">
                  <p v-if="searchResponse?.results[category]?.length" class="suggestion-category">{{ resultTypeLabel(category) }}</p>
                  <button
                    v-for="item in searchResponse?.results[category] || []"
                    :id="`desktop-global-search-${flatSearchResults.indexOf(item)}`"
                    :key="`${category}-${item.id}`"
                    type="button"
                    class="suggestion-option"
                    role="option"
                    :aria-selected="flatSearchResults.indexOf(item) === searchActiveIndex"
                    @mousedown.prevent
                    @click="openSearchResult(item)"
                  >
                    <strong>{{ item.title }}</strong>
                    <small v-if="item.snippet">{{ item.snippet }}</small>
                  </button>
                </template>
                <button type="button" class="suggestion-view-all" @mousedown.prevent @click="submitNavSearch">{{ t('globalSearch.viewAll') }} →</button>
              </template>
            </div>
          </form>
        </div>
      </nav>

      <!-- =========================
           Authentication
           ========================= -->

      <div class="auth-area">
        <LanguageSwitcher />
        <!-- Logged Out -->

        <button
          v-if="!isLoggedIn && !sessionPending"
          class="login-button"
          type="button"
          :aria-label="t('nav.login')"
          :title="t('nav.login')"
          @click="openLoginModal"
        >
          <!-- User Icon -->

          <svg
            class="login-icon"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 448 512"
            aria-hidden="true"
          >
            <path
              d="M224 248a120 120 0 1 0 0-240 120 120 0 1 0 0 240zm-29.7 56C95.8 304 16 383.8 16 482.3 16 498.7 29.3 512 45.7 512l356.6 0c16.4 0 29.7-13.3 29.7-29.7 0-98.5-79.8-178.3-178.3-178.3l-59.4 0z"
            />
          </svg>

          <span class="login-button-text">{{ t('nav.login') }}</span>
        </button>

        <!-- Logged In -->

        <button v-else-if="isLoggedIn" class="logout-button" type="button" @click="openLogoutModal">
          <span>
            {{ username }}
          </span>

          <!-- Logout Icon -->

          <svg
            class="logout-icon"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M16 17L21 12M21 12L16 7M21 12H9M12 17C12 17.93 12 18.395 11.8978 18.7765C11.6204 19.8117 10.8117 20.6204 9.77646 20.8978C9.39496 21 8.92997 21 8 21H7.5C6.10218 21 5.40326 21 4.85195 20.7716C4.11687 20.4672 3.53284 19.8831 3.22836 19.1481C3 18.5967 3 17.8978 3 16.5V7.5C3 6.10217 3 5.40326 3.22836 4.85195C3.53284 4.11687 4.11687 3.53284 4.85195 3.22836C5.40326 3 6.10218 3 7.5 3H8C8.92997 3 9.39496 3 9.77646 3.10222C10.8117 3.37962 11.6204 4.18827 11.8978 5.22354C12 5.60504 12 6.07003 12 7"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>

          {{ t('nav.logout') }}

        </button>
      </div>

      <button
        class="menu-button"
        type="button"
        :aria-label="t('nav.toggle')"
        :aria-expanded="mobileMenuOpen"
        aria-controls="mobile-navigation"
        @click="toggleMobileMenu"
      >
        <span></span>
        <span></span>
        <span></span>
      </button>

      <!-- =========================
         Mobile Navigation
      ========================= -->

      <button
        v-if="mobileMenuOpen"
        class="mobile-nav-backdrop"
        type="button"
        :aria-label="t('nav.close')"
        @click="closeMobileMenu"
      ></button>

      <nav
        id="mobile-navigation"
        class="mobile-nav"
        :class="{ open: mobileMenuOpen }"
        :aria-label="t('nav.mobile')"
      >
        <div class="mobile-drawer-header">
          <RouterLink to="/" class="mobile-drawer-brand" @click="closeMobileMenu">
            <img src="/images/logo.png" alt="" />
            <span>
              <strong>NIAH</strong>
              <small>BIODIVERSITY</small>
            </span>
          </RouterLink>

          <button
            class="mobile-drawer-close"
            type="button"
            :aria-label="t('nav.close')"
            @click="closeMobileMenu"
          >
            ×
          </button>
        </div>

        <p class="mobile-menu-label">{{ t('nav.menu') }}</p>

        <RouterLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="mobile-nav-link"
          @click="closeMobileMenu"
        >
          <span class="mobile-link-icon" aria-hidden="true">
            <svg v-if="item.to === '/'" viewBox="0 0 24 24">
              <path d="m3 11 9-8 9 8M5 10v10h14V10M9 20v-6h6v6" />
            </svg>
            <svg v-else viewBox="0 0 24 24">
              <path d="M20 4C10 4 5 9 5 16c5-4 9-6 13-8-5 3-9 7-11 12" />
            </svg>
          </span>
          <span>{{ item.label }}</span>
        </RouterLink>

        <button
          type="button"
          class="mobile-nav-link mobile-search-toggle"
          :aria-expanded="mobileSearchOpen"
          aria-controls="mobile-search-panel"
          @click="mobileSearchOpen = !mobileSearchOpen"
        >
          <span class="mobile-link-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="m15.5 15.5 5 5" />
            </svg>
          </span>
          <span>{{ t('nav.search') }}</span>
          <span class="mobile-search-chevron" aria-hidden="true">›</span>
        </button>

        <div v-if="mobileSearchOpen" id="mobile-search-panel" class="mobile-search-panel">
          <form role="search" class="mobile-search-form" @submit.prevent="submitMobileSearch">
            <input
              v-model="navSearch"
              type="search"
                maxlength="100"
              autocomplete="off"
              :placeholder="t('globalSearch.placeholder')"
              :aria-label="t('globalSearch.inputLabel')"
              role="combobox"
              aria-autocomplete="list"
              :aria-expanded="searchOpen && isSearchableQuery"
              aria-controls="mobile-global-search-results"
              :aria-activedescendant="searchOpen && searchActiveIndex >= 0 ? `mobile-global-search-${searchActiveIndex}` : undefined"
              @focus="searchOpen = true"
              @keydown="handleSearchKeydown"
            />
            <button type="submit" :aria-label="t('globalSearch.submit')">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="10.5" cy="10.5" r="6.5" />
                <path d="m15.5 15.5 5 5" />
              </svg>
            </button>
            <div
              v-if="searchOpen && isSearchableQuery"
              id="mobile-global-search-results"
              class="global-search-suggestions mobile-global-search-suggestions"
              role="listbox"
              :aria-label="t('globalSearch.suggestions')"
            >
              <p v-if="searchLoading" class="suggestion-state" role="status">{{ t('globalSearch.loading') }}</p>
              <p v-else-if="searchError" class="suggestion-state">{{ t('globalSearch.error') }}</p>
              <p v-else-if="!flatSearchResults.length" class="suggestion-state">{{ t('globalSearch.empty') }}</p>
              <template v-else>
                <template v-for="category in searchCategories" :key="category">
                  <p v-if="searchResponse?.results[category]?.length" class="suggestion-category">{{ resultTypeLabel(category) }}</p>
                  <button
                    v-for="item in searchResponse?.results[category] || []"
                    :id="`mobile-global-search-${flatSearchResults.indexOf(item)}`"
                    :key="`${category}-${item.id}`"
                    type="button"
                    class="suggestion-option"
                    role="option"
                    :aria-selected="flatSearchResults.indexOf(item) === searchActiveIndex"
                    @mousedown.prevent
                    @click="openSearchResult(item)"
                  >
                    <strong>{{ item.title }}</strong>
                    <small v-if="item.snippet">{{ item.snippet }}</small>
                  </button>
                </template>
                <button type="button" class="suggestion-view-all" @mousedown.prevent @click="submitMobileSearch">{{ t('globalSearch.viewAll') }} →</button>
              </template>
            </div>
          </form>
        </div>

        <div class="mobile-nav-divider" aria-hidden="true"></div>

        <LanguageSwitcher />

        <div class="mobile-nav-divider" aria-hidden="true"></div>

        <!-- Mobile Authentication: reuses the shared login/logout state. -->

        <button
          v-if="!isLoggedIn && !sessionPending"
          class="mobile-login-button"
          type="button"
          @click="openLoginModal"
        >
          <svg
            class="login-icon"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 448 512"
            aria-hidden="true"
          >
            <path
              d="M224 248a120 120 0 1 0 0-240 120 120 0 1 0 0 240zm-29.7 56C95.8 304 16 383.8 16 482.3 16 498.7 29.3 512 45.7 512l356.6 0c16.4 0 29.7-13.3 29.7-29.7 0-98.5-79.8-178.3-178.3-178.3l-59.4 0z"
            />
          </svg>

          {{ t('nav.login') }}
        </button>
        <div v-else-if="isLoggedIn" class="mobile-authenticated">
          <div class="mobile-user">
            <svg
              class="login-icon"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 448 512"
              aria-hidden="true"
            >
              <path
                d="M224 248a120 120 0 1 0 0-240 120 120 0 1 0 0 240zm-29.7 56C95.8 304 16 383.8 16 482.3 16 498.7 29.3 512 45.7 512l356.6 0c16.4 0 29.7-13.3 29.7-29.7 0-98.5-79.8-178.3-178.3-178.3l-59.4 0z"
              />
            </svg>
            <span>{{ username }}</span>
          </div>

          <button class="mobile-logout-button" type="button" @click="openLogoutModal">
            <svg
              class="logout-icon"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M16 17L21 12M21 12L16 7M21 12H9M12 17C12 17.93 12 18.395 11.8978 18.7765C11.6204 19.8117 10.8117 20.6204 9.77646 20.8978C9.39496 21 8.92997 21 8 21H7.5C6.10218 21 5.40326 21 4.85195 20.7716C4.11687 20.4672 3.53284 19.8831 3.22836 19.1481C3 18.5967 3 17.8978 3 16.5V7.5C3 6.10217 3 5.40326 3.22836 4.85195C3.53284 4.11687 4.11687 3.53284 4.85195 3.22836C5.40326 3 6.10218 3 7.5 3H8C8.92997 3 9.39496 3 9.77646 3.10222C10.8117 3.37962 11.6204 4.18827 11.8978 5.22354C12 5.60504 12 6.07003 12 7"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            {{ t('nav.logout') }}
          </button>
        </div>
      </nav>
    </div>
  </header>
  <!-- =========================
       Login Modal
  ========================= -->

  <LoginModal :visible="loginModalOpen" @close="closeLoginModal" @login="handleLogin" />

  <!-- =========================
       Logout Confirmation Modal
  ========================= -->

  <div v-if="logoutModalOpen" class="modal-overlay" @click.self="closeLogoutModal">
    <div class="logout-modal">
      <div class="modal-icon">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M16 17L21 12M21 12L16 7M21 12H9M12 17C12 17.93 12 18.395 11.8978 18.7765C11.6204 19.8117 10.8117 20.6204 9.77646 20.8978C9.39496 21 8.92997 21 8 21H7.5C6.10218 21 5.40326 21 4.85195 20.7716C4.11687 20.4672 3.53284 19.8831 3.22836 19.1481C3 18.5967 3 17.8978 3 16.5V7.5C3 6.10217 3 5.40326 3.22836 4.85195C3.53284 4.11687 4.11687 3.53284 4.85195 3.22836C5.40326 3 6.10218 3 7.5 3H8C8.92997 3 9.39496 3 9.77646 3.10222C10.8117 3.37962 11.6204 4.18827 11.8978 5.22354C12 5.60504 12 6.07003 12 7"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </div>

      <h2>
        {{ t('auth.logoutTitle') }}
      </h2>

      <p>
        {{ t('auth.logoutPrompt') }}
      </p>

      <div class="modal-actions">

        <button
          class="cancel-button"
          type="button"
          @click="closeLogoutModal"
        >
          {{ t('common.cancel') }}
        </button>

        <button
          class="confirm-logout-button"
          type="button"
          @click="logout"
        >
          {{ t('auth.confirmLogout') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.navbar {
  position: sticky;
  top: 0;
  z-index: 1000;

  width: 100%;

  background: rgba(224, 235, 221, 0.95);

  border-bottom: 1px solid rgba(70, 133, 133, 0.15);

  backdrop-filter: blur(10px);
}

.navbar-container {
  box-sizing: border-box;
  width: 100%;
  padding: 0 10px;

  min-height: 76px;

  margin: 0 auto;

  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;

  gap: 30px;
}

/* =========================
   Logo
========================= */

.logo {
  display: flex;
  align-items: center;

  justify-self: start;

  gap: 10px;

  color: #468585;

  text-decoration: none;

  flex-shrink: 0;
}

/* Circular logo image */
.logo-image {
  width: 46px;
  height: 46px;
  /* border-radius: 50%; */
  object-fit: cover;
}

.logo-text {
  display: flex;
  flex-direction: column;

  line-height: 1;
}

.logo-title {
  font-size: 18px;
  font-weight: 800;

  letter-spacing: 1.5px;
}

.logo-subtitle {
  margin-top: 4px;

  font-size: 9px;
  font-weight: 600;

  letter-spacing: 2px;

  color: #468585;
}

/* =========================
   Desktop Navigation
   ========================= */

.desktop-nav {
  display: flex;
  align-items: center;
  justify-self: center;
}

.nav-track {
  position: relative;

  display: inline-flex;
  align-items: center;

  gap: 4px;
  padding: 4px;

  border-radius: 14px;

  user-select: none;
}

.nav-thumb {
  position: absolute;

  top: 4px;
  left: 0;

  height: 36px;

  border-radius: 10px;

  background: #468585;

  box-shadow: 0 2px 8px rgba(70, 133, 133, 0.25);

  pointer-events: none;

  transition:
    transform 280ms cubic-bezier(0.23, 1, 0.32, 1),
    width 280ms cubic-bezier(0.23, 1, 0.32, 1);

  z-index: 0;
}

.nav-link {
  position: relative;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  min-height: 36px;
  padding: 0 15px;

  border-radius: 10px;

  color: #468585;
  text-decoration: none;

  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;

  transition:
    color 180ms ease,
    transform 160ms cubic-bezier(0.23, 1, 0.32, 1);

  z-index: 1;
}

.nav-link.router-link-active,
.nav-link.is-active {
  color: #ffffff !important;
}

@media (hover: hover) and (pointer: fine) {
  .nav-link:not(.is-active):hover {
    color: #50b498;
    background: rgba(80, 180, 152, 0.08);
  }
}

.nav-link:active {
  transform: scale(0.96);
}

.nav-link:focus-visible {
  outline: 2px solid #50b498;
  outline-offset: 3px;
}

.nav-search {
  margin-left: 5px;
  display: flex;
  align-items: center;
  gap: 7px;
  position: relative;
}

.global-search-suggestions {
  position: absolute;
  z-index: 120;
  top: calc(100% + 10px);
  left: 0;
  width: min(430px, calc(100vw - 32px));
  max-height: min(62vh, 480px);
  overflow-y: auto;
  padding: 8px;
  border: 1px solid #d8e5d8;
  border-radius: 16px;
  background: #fffdf7;
  color: #174538;
  box-shadow: 0 18px 45px rgba(13, 53, 40, .2);
}

.suggestion-category {
  margin: 8px 10px 4px;
  color: #438c75;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: .12em;
  text-transform: uppercase;
}

.suggestion-option {
  width: 100%;
  display: grid;
  gap: 3px;
  padding: 10px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.suggestion-option:hover,
.suggestion-option:focus-visible,
.suggestion-option[aria-selected='true'] { outline: none; background: #eaf3e9; }
.suggestion-option strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.suggestion-option small { display: -webkit-box; overflow: hidden; color: #698079; font-size: 11px; line-height: 1.4; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.suggestion-state { margin: 8px 10px; color: #617a72; font-size: 13px; }
.suggestion-view-all { width: 100%; margin-top: 4px; padding: 11px 10px; border: 0; border-top: 1px solid #e6eee5; background: transparent; color: #347760; font: inherit; font-size: 12px; font-weight: 800; cursor: pointer; text-align: left; }
.suggestion-view-all:hover, .suggestion-view-all:focus-visible { color: #174538; outline: 2px solid #77b8a4; outline-offset: -2px; }

.nav-search label {
  display: flex;
}

.nav-search input {
  width: 150px;
  padding: 9px 14px;
  border: 1px solid rgba(70, 133, 133, 0.45);
  border-radius: 999px;
  outline: none;
  background: #e0ebdd;
  color: #405f5b;
  font-family: inherit;
  font-size: 12px;
  box-shadow: 0 4px 12px rgba(70, 133, 133, 0.12);
  transition: 0.3s ease;
}

.nav-search input::placeholder {
  color: #648580;
  opacity: 0.72;
}

.nav-search input:focus {
  width: 185px;
  border-color: #50b498;
  box-shadow:
    0 5px 16px rgba(80, 180, 152, 0.28),
    0 0 0 2px rgba(80, 180, 152, 0.14);
}

.nav-search > button {
  width: 36px;
  height: 36px;
  padding: 7px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(70, 133, 133, 0.45);
  border-radius: 50%;
  outline: none;
  background: #e0ebdd;
  color: #468585;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(70, 133, 133, 0.12);
  transition: 0.3s ease;
}

.nav-search > button:hover,
.nav-search > button:focus-visible {
  border-color: #50b498;
  background: #d5e8d7;
  color: #32756a;
  box-shadow: 0 5px 16px rgba(80, 180, 152, 0.28);
  transform: translateY(-2px);
}

.nav-search > button svg {
  width: 21px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.7;
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
/* =========================
   Login Button
   ========================= */

.login-button {
  padding: 10px 20px;

  border-radius: 24px;

  background: #468585;
  color: white;

  text-decoration: none;

  font-size: 14px;
  font-weight: 600;

  transition:
    background 0.2s ease,
    transform 0.2s ease;
}

.login-button:hover {
  background: #50b498;

  transform: translateY(-1px);
}

/* =========================
   Mobile Menu Button
   ========================= */

.menu-button {
  display: none;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 5px;

  width: 42px;
  height: 42px;

  padding: 8px;

  border: none;
  border-radius: 8px;

  background: transparent;

  cursor: pointer;

  transition: background 0.2s ease;
}

.menu-button span {
  display: block;

  width: 24px;
  height: 3px;
  min-height: 3px;
  max-height: 3px;
  flex: 0 0 3px;
  margin: 0;

  border-radius: 2px;

  background: #468585;

  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}

.menu-button:hover,
.menu-button:focus-visible {
  background: #e0ebdd;
}

.menu-button[aria-expanded='true'] span:nth-child(1) {
  transform: translateY(8px) rotate(45deg);
}

.menu-button[aria-expanded='true'] span:nth-child(2) {
  opacity: 0;
}

.menu-button[aria-expanded='true'] span:nth-child(3) {
  transform: translateY(-8px) rotate(-45deg);
}

/* =========================
   Mobile Navigation
   ========================= */

.mobile-nav {
  display: none;
}

.mobile-nav-backdrop {
  display: none;
}

/* =========================
   Responsive
   ========================= */

@media (max-width: 900px) {
  .navbar-container {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0;
  }

  .logo {
    transform: none;
  }

  .desktop-nav,
  .auth-area {
    display: none;
  }

  .menu-button {
    display: flex;
  }

  .mobile-nav {
    box-sizing: border-box;
    position: fixed;
    top: 0;
    right: 0;
    z-index: 1200;

    width: min(330px, 86vw);
    height: 100dvh;

    padding: 0 18px 24px;

    display: flex;
    flex-direction: column;
    gap: 3px;

    overflow-y: auto;

    background: #173f34;
    box-shadow: -18px 0 45px rgba(25, 55, 50, 0.24);

    transform: translateX(105%);
    visibility: hidden;

    transition:
      transform 0.3s cubic-bezier(0.22, 1, 0.36, 1),
      visibility 0.3s ease;
  }

  .mobile-nav.open {
    transform: translateX(0);
    visibility: visible;
  }

  .mobile-nav-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1100;

    display: block;

    padding: 0;
    border: 0;

    background: rgba(18, 39, 34, 0.48);
    backdrop-filter: blur(2px);
  }

  .mobile-drawer-header {
    min-height: 92px;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  }

  .mobile-drawer-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    color: #fff;
    text-decoration: none;
  }

  .mobile-drawer-brand img {
    width: 46px;
    height: 46px;
    border-radius: 50%;
    object-fit: cover;
    background: #fff;
  }

  .mobile-drawer-brand > span {
    display: flex;
    flex-direction: column;
  }

  .mobile-drawer-brand strong {
    font-size: 16px;
    letter-spacing: 2px;
  }

  .mobile-drawer-brand small {
    margin-top: 3px;
    color: #9dd5ba;
    font-size: 7px;
    font-weight: 700;
    letter-spacing: 1.8px;
  }

  .mobile-drawer-close {
    width: 35px;
    height: 35px;
    display: grid;
    place-items: center;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 9px;
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
    cursor: pointer;
    font: inherit;
    font-size: 24px;
    line-height: 1;
  }

  .mobile-menu-label {
    margin: 8px 12px 9px;
    color: #75a392;
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 2px;
  }

  .mobile-nav-link {
    padding: 13px 12px;

    display: flex;
    align-items: center;
    gap: 13px;

    color: #bfd7cd;

    text-decoration: none;

    font-size: 13px;
    font-weight: 600;

    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;

    transition:
      background-color 0.2s ease,
      color 0.2s ease;
  }

  .mobile-nav-link:hover,
  .mobile-nav-link.router-link-active,
  .mobile-nav-link:focus-visible,
  .mobile-search-toggle[aria-expanded='true'] {
    background: #2b6754;
    color: #fff;
  }

  .mobile-search-toggle {
    box-sizing: border-box;
    width: 100%;
    border: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.14);
    background: transparent;
    cursor: pointer;
    font: inherit;
    text-align: left;
  }

  .mobile-search-chevron {
    margin-left: auto;
    font-size: 20px;
    line-height: 1;
    transition: transform 0.2s ease;
  }

  .mobile-search-toggle[aria-expanded='true'] .mobile-search-chevron {
    transform: rotate(90deg);
  }

  .mobile-search-panel {
    padding: 7px 12px 12px 50px;
  }

  .mobile-search-form {
    min-width: 0;
    position: relative;
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .mobile-search-form input {
    min-width: 0;
    flex: 1;
    padding: 9px 11px;
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 999px;
    outline: none;
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
    font: inherit;
    font-size: 12px;
  }

  .mobile-search-form input::placeholder {
    color: rgba(255, 255, 255, 0.65);
  }

  .mobile-search-form input::-webkit-search-cancel-button {
    cursor: pointer;
    filter: brightness(0) invert(1);
    opacity: 0.8;
  }

  .mobile-search-form input:focus-visible {
    border-color: rgba(255, 255, 255, 0.5);
    box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.1);
  }

  .mobile-search-form > button {
    width: 34px;
    height: 34px;
    flex: 0 0 34px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: #2b6754;
    color: #fff;
    cursor: pointer;
  }

  .mobile-search-form > button:focus-visible {
    outline: 3px solid rgba(255, 255, 255, 0.35);
    outline-offset: 2px;
  }

  .mobile-search-form > button svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .mobile-global-search-suggestions { left: 0; right: 0; width: auto; top: calc(100% + 8px); max-height: min(55vh, 420px); }

  .mobile-link-icon {
    width: 25px;
    height: 25px;
    flex: 0 0 25px;
    display: grid;
    place-items: center;
    border-radius: 7px;
    background: transparent;
  }

  .mobile-link-icon svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .mobile-nav-divider {
    width: 100%;
    height: 1px;
    margin: 10px 0 8px;
    background: rgba(255, 255, 255, 0.12);
  }

  :deep(.mobile-nav .language-trigger) {
    border-color: rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.08);
    color: #bfd7cd;
  }

  :deep(.mobile-nav .language-trigger:hover),
  :deep(.mobile-nav .language-trigger:focus-visible) {
    border-color: rgba(255, 255, 255, 0.38);
    background: rgba(255, 255, 255, 0.13);
  }

  :deep(.mobile-nav .language-menu) {
    border-color: rgba(255, 255, 255, 0.16);
    background: #173f34;
  }

  :deep(.mobile-nav .language-menu button) {
    color: #bfd7cd;
  }

  :deep(.mobile-nav .language-menu button:hover),
  :deep(.mobile-nav .language-menu button:focus-visible),
  :deep(.mobile-nav .language-menu button.active) {
    background: #2b6754;
    color: #fff;
  }

  .mobile-login-button,
  .mobile-logout-button {
    display: flex;

    align-items: center;
    justify-content: center;

    gap: 8px;

    width: 100%;

    margin-top: 8px;

    padding: 12px;

    border: none;

    border-radius: 9px;

    background: #2b6754;

    color: #fff;

    font-family: inherit;

    font-size: 15px;
    font-weight: 600;

    cursor: pointer;

    transition:
      background 0.2s ease,
      transform 0.2s ease;
  }

  .mobile-login-button {
    border-radius: 24px;
  }

  .mobile-login-button:hover {
    background: #37795f;
    transform: translateY(-1px);
  }

  .mobile-logout-button {
    background: #fce8e6;
    color: #b84d42;
  }

  .mobile-logout-button:hover,
  .mobile-logout-button:focus-visible {
    background: #b84d42;
    color: #fff;
    transform: none;
  }

  .mobile-authenticated {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 10px;
    margin-top: 8px;
  }

  .mobile-user {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
    padding: 12px 14px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.1);
    color: #ffffff;
    font-size: 15px;
    font-weight: 700;
  }

  .mobile-user .login-icon {
    flex: 0 0 auto;
    width: 16px;
    height: 16px;
  }

  .mobile-logout-button {
    width: auto;
    min-width: 112px;
    margin-top: 0;
  }
}

/*Login */
.login-button {
  display: flex;
  align-items: center;
  justify-content: center;

  gap: 8px;

  padding: 10px 20px;

  border: none;
  border-radius: 24px;

  background: #468585;
  color: white;

  font-family: inherit;
  font-size: 14px;
  font-weight: 600;

  cursor: pointer;

  transition:
    background 0.2s ease,
    transform 0.2s ease;
}

.login-button:hover {
  background: #50b498;

  transform: translateY(-1px);
}

.login-icon {
  width: 14px;
  height: 14px;

  fill: currentColor;
}

/* */
/* =========================
   Authentication Area
   ========================= */

.auth-area {
  display: flex;
  align-items: center;
  justify-self: end;
  gap: 10px;
}

/* Login Icon */

.login-icon {
  width: 14px;
  height: 14px;
  fill: currentColor;
}

/* Logout Icon */

.logout-icon {
  width: 19px;
  height: 19px;
  flex: 0 0 19px;
  fill: none;
}

/* Login Button */

.login-button,
.logout-button {
  display: flex;
  align-items: center;
  justify-content: center;

  gap: 8px;

  padding: 10px 18px;

  border: none;
  border-radius: 24px;

  background: #468585;
  color: white;

  font-family: inherit;
  font-size: 14px;
  font-weight: 600;

  cursor: pointer;

  transition:
    background 0.2s ease,
    transform 0.2s ease;
}

.login-button:hover,
.logout-button:hover {
  background: #50b498;

  transform: translateY(-1px);
}

/* Compact desktop login button: reveal its label on hover or keyboard focus. */
.login-button {
  width: 42px;
  height: 42px;
  padding: 0;
  gap: 0;
  overflow: hidden;
  white-space: nowrap;
  transition:
    width 0.25s ease,
    gap 0.25s ease,
    padding 0.25s ease,
    background 0.2s ease,
    transform 0.2s ease;
}

.login-button .login-icon {
  width: 17px;
  height: 17px;
  flex: 0 0 17px;
}

.login-button-text {
  max-width: 0;
  overflow: hidden;
  opacity: 0;
  transform: translateX(-6px);
  transition:
    max-width 0.25s ease,
    opacity 0.2s ease,
    transform 0.25s ease;
}

.login-button:hover,
.login-button:focus-visible {
  width: 104px;
  padding: 0 16px;
  gap: 8px;
}

.login-button:hover .login-button-text,
.login-button:focus-visible .login-button-text {
  max-width: 48px;
  opacity: 1;
  transform: translateX(0);
}

/* =========================
   Logout Modal
   ========================= */

.modal-overlay {
  position: fixed;

  inset: 0;

  z-index: 2000;

  display: flex;

  align-items: center;
  justify-content: center;

  padding: 20px;

  background: rgba(30, 45, 40, 0.55);

  backdrop-filter: blur(5px);
}

.logout-modal {
  width: min(420px, 100%);

  padding: 36px;

  border-radius: 24px;

  background: #fff6dc;

  box-shadow: 0 25px 70px rgba(30, 45, 40, 0.25);

  text-align: center;
}

.modal-icon {
  width: 52px;
  height: 52px;

  margin: 0 auto 18px;

  display: flex;

  align-items: center;
  justify-content: center;

  border-radius: 50%;

  background: #e0ebdd;

  color: #468585;
}

.modal-icon svg {
  width: 22px;
  height: 22px;

  fill: none;
}

.logout-modal h2 {
  margin: 0 0 10px;

  color: #468585;

  font-size: 26px;
}

.logout-modal p {
  margin: 0;

  color: #55716d;

  font-size: 15px;

  line-height: 1.6;
}

.modal-actions {
  display: flex;

  justify-content: center;

  gap: 12px;

  margin-top: 28px;
}

.cancel-button,
.confirm-logout-button {
  padding: 11px 22px;

  border-radius: 22px;

  font-family: inherit;

  font-size: 14px;
  font-weight: 600;

  cursor: pointer;

  transition: 0.2s ease;
}

.cancel-button {
  border: 1px solid rgba(70, 133, 133, 0.25);

  background: transparent;

  color: #468585;
}

.cancel-button:hover {
  background: #e0ebdd;
}

.confirm-logout-button {
  border: none;

  background: #468585;

  color: white;
}

.confirm-logout-button:hover {
  background: #50b498;

  transform: translateY(-1px);
}

/* Keep desktop authentication out of the mobile header. This rule is placed
   after the desktop auth styles so it wins the cascade. */
@media (max-width: 900px) {
  .auth-area {
    display: none;
  }
}
</style>
