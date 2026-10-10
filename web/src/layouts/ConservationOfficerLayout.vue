<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import ConservationTopbarActions from '../components/ConservationTopbarActions.vue'

const route = useRoute()
const sidebarOpen = ref(false)
const collapsed = ref(false)

const items = [
  { label: 'Dashboard', icon: '⌂', name: 'conservation-dashboard' },
  { label: 'Plant Species', icon: '♧', name: 'conservation-species' },
  { label: 'Observations', icon: '◎', name: 'conservation-observations' },
  { label: 'Review Submissions', icon: '✓', name: 'conservation-reviews' },
  { label: 'Biodiversity Map', icon: '⌖', name: 'conservation-map' },
  { label: 'IoT Monitoring', icon: '⌁', name: 'conservation-iot' },
  { label: 'Threat Alerts', icon: '△', name: 'conservation-alerts' },
  { label: 'Reports', icon: '▤', name: 'conservation-reports' },
]

const title = computed(() => String(route.meta.title || 'Conservation Officer'))
const section = computed(() => String(route.meta.section || 'CONSERVATION'))
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
        aria-label="Close navigation"
        @click="closeControl"
      >
        ×
      </button>
      <RouterLink
        class="brand"
        to="/"
        data-tooltip="Go back to the public website"
        aria-label="Go back to the public website"
      >
        <img src="/images/logo.png" alt="Niah Biodiversity" />
        <div><strong>NIAH</strong><span>CONSERVATION</span></div>
      </RouterLink>
      <p class="nav-label">MAIN MENU</p>
      <nav aria-label="Conservation Officer navigation">
        <RouterLink
          v-for="item in items"
          :key="item.name"
          :to="{ name: item.name }"
          @click="sidebarOpen = false"
        >
          <span class="nav-icon" aria-hidden="true">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>
      <div class="sidebar-footer"><RouterLink to="/">Logout</RouterLink></div>
    </aside>
    <button
      v-if="sidebarOpen"
      class="drawer-backdrop"
      type="button"
      aria-label="Close navigation"
      @click="sidebarOpen = false"
    ></button>
    <div class="main-area">
      <header class="topbar">
        <button class="menu-button" type="button" aria-label="Toggle navigation" @click="toggle">
          <span></span><span></span><span></span>
        </button>
        <div class="page-heading">
          <p>{{ section }}</p>
          <h1>{{ title }}</h1>
        </div>
        <ConservationTopbarActions />
      </header>
      <main class="conservation-page"><RouterView /></main>
    </div>
  </div>
</template>

<style src="../styles/conservation.css"></style>
