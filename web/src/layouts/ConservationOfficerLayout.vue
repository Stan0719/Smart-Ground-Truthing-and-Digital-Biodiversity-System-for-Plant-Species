<script setup lang="ts">
import { logout } from '../services/auth'
import { useRouter } from 'vue-router'
const router = useRouter()
const signOut = async () => { await logout(); await router.replace('/') }

import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import ConservationTopbarActions from '../components/ConservationTopbarActions.vue'
import { useAuthenticatedPageTranslation } from '../composables/useAuthenticatedPageTranslation'

const route = useRoute()
const { t, te } = useI18n()
const sidebarOpen = ref(false)
const collapsed = ref(false)
useAuthenticatedPageTranslation('.officer-layout')

const items = [
  { labelKey: 'dashboardNav.dashboard', icon: 'dashboard', name: 'conservation-dashboard' },
  { labelKey: 'dashboardNav.plantSpecies', icon: 'species', name: 'conservation-species' },
  { labelKey: 'dashboardNav.observations', icon: 'observation', name: 'conservation-observations' },
  { labelKey: 'dashboardNav.reviewSubmissions', icon: '✓', name: 'conservation-reviews' },
  { labelKey: 'dashboardNav.biodiversityMap', icon: 'map', name: 'conservation-map' },
  { labelKey: 'dashboardNav.iotMonitoring', icon: 'iot', name: 'conservation-iot' },
  { labelKey: 'dashboardNav.threatAlerts', icon: 'threat', name: 'conservation-alerts' },
  { labelKey: 'dashboardNav.reports', icon: 'report', name: 'conservation-reports' },
]

const title = computed(() => {
  const titleKey = route.meta.titleKey
  if (typeof titleKey === 'string' && te(titleKey)) return t(titleKey)
  const key = `dashboardNav.titles.${String(route.name)}`
  return te(key) ? t(key) : String(route.meta.title || t('dashboardNav.conservationOfficer'))
})
const section = computed(() => t('dashboardNav.conservation'))
const toggle = () =>
  window.matchMedia('(max-width: 920px)').matches
    ? (sidebarOpen.value = !sidebarOpen.value)
    : (collapsed.value = !collapsed.value)
const closeControl = () =>
  window.matchMedia('(max-width: 920px)').matches
    ? (sidebarOpen.value = false)
    : (collapsed.value = true)
</script>

<template>
  <div class="officer-layout" :class="{ 'sidebar-collapsed': collapsed }">
    <aside class="sidebar" :class="{ open: sidebarOpen }">
      <button
        class="sidebar-close-button"
        type="button"
        :aria-label="t('dashboardNav.closeNavigation')"
        @click="closeControl"
      >
        ×
      </button>
      <RouterLink
        class="brand"
        to="/"
        :data-tooltip="t('dashboardNav.backToWebsite')"
        :aria-label="t('dashboardNav.backToWebsite')"
      >
        <img src="/images/logo.png" alt="Niah Biodiversity" />
        <div><strong>NIAH</strong><span>CONSERVATION</span></div>
      </RouterLink>
      <p class="nav-label">{{ t('dashboardNav.mainMenu') }}</p>
      <nav :aria-label="t('dashboardNav.conservationNavigation')">
        <RouterLink
          v-for="item in items"
          :key="item.name"
          :to="{ name: item.name }"
          @click="sidebarOpen = false"
        >
          <span class="nav-icon" aria-hidden="true">
            <svg
              v-if="item.icon === 'dashboard'"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="sidebar-nav-svg"
            >
              <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
              <path
                d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
              />
            </svg>

            <svg
              v-else-if="item.icon === 'species'"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="sidebar-nav-svg"
            >
              <path
                d="M14 9.536V7a4 4 0 0 1 4-4h1.5a.5.5 0 0 1 .5.5V5a4 4 0 0 1-4 4 4 4 0 0 0-4 4c0 2 1 3 1 5a5 5 0 0 1-1 3"
              />
              <path d="M4 9a5 5 0 0 1 8 4 5 5 0 0 1-8-4" />
              <path d="M5 21h14" />
            </svg>

            <svg
              v-else-if="item.icon === 'observation'"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="sidebar-nav-svg"
            >
              <path
                d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"
              />
              <circle cx="12" cy="12" r="3" />
            </svg>

            <svg
              v-else-if="item.icon === 'map'"
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="sidebar-map-icon"
            >
              <path
                d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"
              />
              <path d="M15 5.764v15" />
              <path d="M9 3.236v15" />
            </svg>

            <!-- IoT Monitoring -->
            <svg
              v-else-if="item.icon === 'iot'"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="sidebar-nav-svg"
            >
              <path
                d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"
              />
            </svg>

            <!-- Threat Alerts -->
            <svg
              v-else-if="item.icon === 'threat'"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="sidebar-nav-svg"
            >
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
            </svg>

            <!-- Reports -->
            <svg
              v-else-if="item.icon === 'report'"
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="sidebar-report-icon"
            >
              <path
                d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"
              />
              <path d="M14 2v5a1 1 0 0 0 1 1h5" />
              <path d="M10 9H8" />
              <path d="M16 13H8" />
              <path d="M16 17H8" />
            </svg>

            <template v-else>
              {{ item.icon }}
            </template>
          </span>
          <span>{{ t(item.labelKey) }}</span>
        </RouterLink>
      </nav>

      <div class="sidebar-footer">
        <RouterLink to="/">{{ t('nav.logout') }}</RouterLink>
      </div>
      <div class="sidebar-footer"><button type="button" @click="signOut">Logout</button></div>
    </aside>
    <button
      v-if="sidebarOpen"
      class="drawer-backdrop"
      type="button"
      :aria-label="t('dashboardNav.closeNavigation')"
      @click="sidebarOpen = false"
    ></button>
    <div class="main-area">
      <header class="topbar">
        <button
          class="menu-button"
          type="button"
          :aria-label="t('dashboardNav.toggleNavigation')"
          @click="toggle"
        >
          <span></span><span></span><span></span>
        </button>
        <div class="page-heading">
          <p>{{ section }}</p>
          <h1>{{ title }}</h1>
        </div>
        <ConservationTopbarActions />
      </header>
      <main class="conservation-page">
        <RouterView v-slot="{ Component, route }">
          <component :is="Component" :key="route.path" />
        </RouterView>
      </main>
    </div>
  </div>
</template>

<style src="../styles/conservation.css"></style>
