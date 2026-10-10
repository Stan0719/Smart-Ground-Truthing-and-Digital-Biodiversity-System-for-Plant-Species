<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { conservationStore } from '../data/conservation'
import { conservationProfile } from '../data/conservationProfile'

const router = useRouter()
const actionsWrap = ref<HTMLElement | null>(null)
const notificationsOpen = ref(false)
const profileOpen = ref(false)

const activeAlerts = computed(() =>
  conservationStore.alerts.filter((alert) => alert.status !== 'Resolved'),
)

const toggleNotifications = () => {
  notificationsOpen.value = !notificationsOpen.value
  if (notificationsOpen.value) profileOpen.value = false
}

const toggleProfile = () => {
  profileOpen.value = !profileOpen.value
  if (profileOpen.value) notificationsOpen.value = false
}

const closeMenus = () => {
  notificationsOpen.value = false
  profileOpen.value = false
}

const openAlert = async (alertId: string) => {
  closeMenus()
  await router.push({ name: 'conservation-alerts', query: { alert: alertId } })
}

const openProfileSettings = async () => {
  closeMenus()
  await router.push({ name: 'conservation-profile' })
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
}

const signOut = async () => {
  closeMenus()
  await router.push({ name: 'home' })
}

const handleOutsideClick = (event: MouseEvent) => {
  if (!actionsWrap.value?.contains(event.target as Node)) closeMenus()
}

onMounted(() => document.addEventListener('click', handleOutsideClick))
onBeforeUnmount(() => document.removeEventListener('click', handleOutsideClick))
</script>

<template>
  <div ref="actionsWrap" class="conservation-topbar-actions">
    <div class="notification-wrap">
      <button
        class="notification-button"
        type="button"
        aria-label="Notifications"
        aria-haspopup="menu"
        :aria-expanded="notificationsOpen"
        @click="toggleNotifications"
      >
        <span aria-hidden="true">♢</span>
        <b v-if="activeAlerts.length">{{ activeAlerts.length }}</b>
      </button>
      <section v-if="notificationsOpen" class="notification-menu" aria-label="Notifications">
        <header>
          <strong>Notifications</strong>
          <RouterLink :to="{ name: 'conservation-alerts' }" @click="closeMenus"
            >View all</RouterLink
          >
        </header>
        <button
          v-for="alert in activeAlerts.slice(0, 5)"
          :key="alert.id"
          type="button"
          @click="openAlert(alert.id)"
        >
          <strong>{{ alert.type }}</strong>
          <small>{{ alert.id }} · {{ alert.plantId }} · {{ alert.severity }}</small>
        </button>
        <p v-if="!activeAlerts.length">No active notifications.</p>
      </section>
    </div>

    <div class="profile-wrap">
      <button
        class="profile-button"
        type="button"
        aria-haspopup="menu"
        :aria-expanded="profileOpen"
        @click="toggleProfile"
      >
        <span class="avatar">O</span>
        <span class="profile-copy">
          <strong>{{ conservationProfile.fullName }}</strong>
          <small>{{ conservationProfile.role }}</small>
        </span>
        <span class="chevron" aria-hidden="true">⌄</span>
      </button>
      <div v-if="profileOpen" class="profile-menu" role="menu">
        <button type="button" role="menuitem" @click="openProfileSettings">Profile settings</button>
        <button type="button" role="menuitem" @click="signOut">Sign out</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.conservation-topbar-actions {
  display: flex;
  align-items: center;
  gap: 13px;
}
.notification-wrap,
.profile-wrap {
  position: relative;
}
.notification-button {
  position: relative;
  width: 39px;
  height: 39px;
  display: grid;
  place-items: center;
  border: 1px solid #dfe6df;
  border-radius: 11px;
  background: #fff;
  color: #527066;
  cursor: pointer;
  font: inherit;
  font-size: 18px;
}
.notification-button b {
  position: absolute;
  top: -5px;
  right: -5px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  display: grid;
  place-items: center;
  border: 2px solid #fff;
  border-radius: 999px;
  background: #c95845;
  color: #fff;
  font-size: 8px;
}
.notification-button:focus-visible,
.profile-button:focus-visible {
  outline: 3px solid rgba(51, 116, 93, 0.2);
  outline-offset: 2px;
}
.notification-menu,
.profile-menu {
  position: absolute;
  top: 52px;
  right: 0;
  z-index: 30;
  border: 1px solid #e1e6e1;
  border-radius: 11px;
  background: #fff;
  box-shadow: 0 12px 30px rgba(28, 65, 51, 0.13);
}
.notification-menu {
  width: min(330px, calc(100vw - 24px));
  padding: 8px;
}
.notification-menu header {
  padding: 5px 6px 9px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #edf0ed;
  color: #34594b;
  font-size: 11px;
}
.notification-menu header a {
  color: #3c7d64;
  font-size: 9px;
  font-weight: 700;
  text-decoration: none;
}
.notification-menu > button {
  width: 100%;
  padding: 10px 7px;
  display: grid;
  gap: 3px;
  border: 0;
  border-bottom: 1px solid #edf0ed;
  background: transparent;
  color: #405e53;
  cursor: pointer;
  text-align: left;
}
.notification-menu > button:last-of-type {
  border-bottom: 0;
}
.notification-menu > button:hover,
.notification-menu > button:focus-visible {
  border-radius: 7px;
  background: #f3f7f3;
  outline: none;
}
.notification-menu > button strong {
  font-size: 10px;
}
.notification-menu > button small,
.notification-menu > p {
  margin: 0;
  color: #87958f;
  font-size: 8px;
}
.notification-menu > p {
  padding: 13px 7px;
}
.profile-button {
  padding: 5px 8px 5px 5px;
  display: flex;
  align-items: center;
  gap: 9px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: transparent;
  color: #29483e;
  cursor: pointer;
  font: inherit;
}
.profile-button:hover {
  border-color: #dfe6df;
  background: #f8faf7;
}
.avatar {
  width: 37px;
  height: 37px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: #33745d;
  color: #fff;
  font-weight: 800;
}
.profile-copy {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.profile-copy strong {
  font-size: 12px;
}
.profile-copy small {
  color: #82918b;
  font-size: 9px;
}
.chevron {
  color: #7a8b84;
}
.profile-menu {
  width: 160px;
  padding: 7px;
}
.profile-menu button {
  width: 100%;
  padding: 9px 10px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #425e54;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  text-align: left;
}
.profile-menu button:hover,
.profile-menu button:focus-visible {
  background: #edf3ed;
  outline: none;
}
@media (max-width: 620px) {
  .profile-copy,
  .chevron {
    display: none;
  }
  .profile-button {
    padding: 3px;
  }
  .avatar {
    width: 35px;
    height: 35px;
  }
}
</style>
