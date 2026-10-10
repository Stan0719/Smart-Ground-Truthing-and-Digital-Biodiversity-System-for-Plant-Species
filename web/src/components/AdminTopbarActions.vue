<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { adminProfile } from '../data/adminProfile'
import AdminNotificationBell from './AdminNotificationBell.vue'

const router = useRouter()
const profileOpen = ref(false)
const actionsWrap = ref<HTMLElement | null>(null)
const notificationBell = ref<{ closeNotifications: () => void } | null>(null)

const toggleProfile = () => {
  profileOpen.value = !profileOpen.value
  if (profileOpen.value) notificationBell.value?.closeNotifications()
}

const closeProfile = () => {
  profileOpen.value = false
}

const openProfileSettings = async () => {
  closeProfile()
  await router.push({ name: 'admin-profile' })
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
}

const signOut = async () => {
  closeProfile()
  await router.push({ name: 'home' })
}

const handleOutsideClick = (event: MouseEvent) => {
  if (profileOpen.value && !actionsWrap.value?.contains(event.target as Node)) closeProfile()
}

onMounted(() => document.addEventListener('click', handleOutsideClick))
onBeforeUnmount(() => document.removeEventListener('click', handleOutsideClick))
</script>

<template>
  <div ref="actionsWrap" class="admin-topbar-actions">
    <AdminNotificationBell ref="notificationBell" @opened="closeProfile" />
    <div class="profile-wrap">
      <button
        class="profile-button"
        type="button"
        :aria-expanded="profileOpen"
        aria-haspopup="menu"
        @click="toggleProfile"
      >
        <span class="avatar">A</span>
        <span class="profile-copy">
          <strong>{{ adminProfile.fullName }}</strong>
          <small>{{ adminProfile.role }}</small>
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
.admin-topbar-actions {
  display: flex;
  align-items: center;
  gap: 13px;
}
.profile-wrap {
  position: relative;
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
.profile-button:focus-visible {
  outline: 3px solid rgba(51, 116, 93, 0.2);
  outline-offset: 2px;
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
  position: absolute;
  top: 52px;
  right: 0;
  z-index: 20;
  width: 160px;
  padding: 7px;
  border: 1px solid #e1e6e1;
  border-radius: 11px;
  background: #fff;
  box-shadow: 0 12px 30px rgba(28, 65, 51, 0.13);
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
