<script setup lang="ts">
import { useRouter } from 'vue-router'
import HomeView from './HomeView.vue'
import LoginModal from '../components/LoginModal.vue'

const router = useRouter()
let signedIn = false
function closeRecovery() {
  if (!signedIn) void router.replace({ name: 'home' })
}
function finishLogin(user: { role: 'admin' | 'conservation-officer' }) {
  signedIn = true
  void router.replace({ name: user.role === 'admin' ? 'admin-dashboard' : 'conservation-dashboard' })
}
</script>

<template>
  <HomeView />
  <LoginModal visible initial-view="recovery" @close="closeRecovery" @login="finishLogin" />
</template>
