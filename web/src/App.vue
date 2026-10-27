<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { currentUser } from './services/auth'
import {refreshKnowledge} from './services/knowledge'
import SiteFooter from './components/SiteFooter.vue'

const route = useRoute()
const showSiteFooter = computed(
  () => !route.path.startsWith('/admin') && !route.path.startsWith('/conservation'),
)
const router = useRouter()
let timer: ReturnType<typeof setInterval> | undefined
const checkSession = async () => {
  const path = route.path
  if (
    path.startsWith('/admin') ||
    path.startsWith('/conservation') ||
    path === '/change-password'
  ) {
    if (!(await currentUser())) await router.replace('/')
  }
}
const loadPublic=(path:string)=>{if(!path.startsWith('/admin')&&!path.startsWith('/conservation')&&path!=='/account'&&path!=='/change-password')void refreshKnowledge()}
router.afterEach(to=>loadPublic(to.path))
onMounted(() => {
  loadPublic(route.path)
  timer = setInterval(checkSession, 15000)
  window.addEventListener('focus', checkSession)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
  window.removeEventListener('focus', checkSession)
})
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
