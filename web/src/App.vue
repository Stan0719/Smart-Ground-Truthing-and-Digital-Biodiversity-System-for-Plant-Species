<script setup lang="ts">
import SiteFooter from './components/SiteFooter.vue'
</script>

<template>
  <div class="app-shell">
    <main class="app-content">
      <RouterView />
    </main>
    <SiteFooter />
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-content {
  flex: 1;
  min-width: 0;
}
</style>
