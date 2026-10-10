<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import SiteFooter from './components/SiteFooter.vue'

const route = useRoute()
const showSiteFooter = computed(
  () => !route.path.startsWith('/admin') && !route.path.startsWith('/conservation'),
)
</script>

<template>
  <div class="app-shell">
    <main class="app-content">
      <RouterView />
    </main>
    <SiteFooter v-if="showSiteFooter" />
  </div>
</template>

<style scoped>
.app-shell {
  width: 100%;
  min-width: 0;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-content {
  width: 100%;
  flex: 1;
  min-width: 0;
}
</style>
