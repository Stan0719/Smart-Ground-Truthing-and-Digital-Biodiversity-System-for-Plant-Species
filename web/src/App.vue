<script setup lang="ts">
import { clearDatabaseTranslationTargets } from './services/databaseTranslation'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { verifySession, sessionVerificationCurrent, sessionSnapshot, subscribeSession, logout } from './services/auth'
import {refreshKnowledge} from './services/knowledge'
import { useI18n } from 'vue-i18n'
import SiteFooter from './components/SiteFooter.vue'

const { t } = useI18n()
const reconnectText = computed(() => t('sessionVerification.unavailable'))
const retryText = computed(() => t('sessionVerification.retry'))
const route = useRoute()
watch(() => route.fullPath, clearDatabaseTranslationTargets, { flush: 'sync' })
const showSiteFooter = computed(
  () => !route.path.startsWith('/admin') && !route.path.startsWith('/conservation'),
)
const router = useRouter()
const protectedRoute = computed(() => route.path.startsWith('/admin') || route.path.startsWith('/conservation') || route.path === '/account' || route.path === '/change-password')
const signOut = async () => {
  try { await logout(); await router.replace('/') }
  catch { await verifySession() }
}
const session = ref(sessionSnapshot())
const unsubscribeSession = subscribeSession(() => { session.value = sessionSnapshot() })
let checkSequence = 0
let timer: ReturnType<typeof setInterval> | undefined
const checkSession = async () => {
  const path = route.fullPath
  const token = ++checkSequence
  if (route.path.startsWith('/admin') || route.path.startsWith('/conservation') || route.path === '/change-password' || route.path === '/account' || session.value.unavailable) {
    const result = await verifySession()
    if (token !== checkSequence || route.fullPath !== path || !sessionVerificationCurrent(result)) return
    if (result.status === 'unauthenticated') await router.replace('/')
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
  checkSequence++; unsubscribeSession()
  if (timer) clearInterval(timer)
  window.removeEventListener('focus', checkSession)
})
</script>

<template>
  <div class="app-shell">
    <div v-if="session.unavailable" class="session-reconnect" role="alert">{{ reconnectText }} <button type="button" @click="checkSession">{{ retryText }}</button> <button type="button" @click="signOut">{{ t('nav.logout') }}</button></div>
    <main class="app-content" :inert="Boolean(session.unavailable || (protectedRoute && session.pending))">
      <RouterView />
    </main>
    <SiteFooter v-if="showSiteFooter" />
  </div>
</template>

<style scoped>
.session-reconnect { padding: 12px 20px; background: #fff3d6; color: #385442; text-align: center; }
.session-reconnect button { margin-left: 12px; padding: 6px 14px; border: 1px solid #569374; border-radius: 6px; background: white; color: #20543b; cursor: pointer; }
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
