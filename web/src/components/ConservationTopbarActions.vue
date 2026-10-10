<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  conservationNotifications,
  markAllConservationNotificationsRead,
  unreadConservationNotificationCount,
  type ConservationNotification,
} from '../data/conservationNotifications'
import { conservationProfile } from '../data/conservationProfile'

const router = useRouter()
const actionsWrap = ref<HTMLElement | null>(null)
const notificationsOpen = ref(false)
const profileOpen = ref(false)

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

const openNotification = async (notification: ConservationNotification) => {
  notification.read = true
  closeMenus()
  if (notification.route) await router.push(notification.route)
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
        :aria-expanded="notificationsOpen"
        aria-controls="conservation-notifications"
        @click="toggleNotifications"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" />
        </svg>
        <span v-if="unreadConservationNotificationCount" class="notification-count">
          {{ unreadConservationNotificationCount }}
        </span>
      </button>

      <section
        v-if="notificationsOpen"
        id="conservation-notifications"
        class="notification-menu"
        aria-label="Conservation Officer notifications"
      >
        <header>
          <strong>Notifications</strong>
          <button
            type="button"
            :disabled="unreadConservationNotificationCount === 0"
            @click="markAllConservationNotificationsRead"
          >
            Mark all as read
          </button>
        </header>
        <div v-if="conservationNotifications.length" class="notification-list">
          <button
            v-for="notification in conservationNotifications.slice(0, 5)"
            :key="notification.id"
            class="notification-item"
            :class="{ unread: !notification.read }"
            type="button"
            @click="openNotification(notification)"
          >
            <span class="notification-type" :class="notification.type" aria-hidden="true">
              {{
                notification.type === 'review'
                  ? '✓'
                  : notification.type === 'species'
                    ? '♧'
                    : notification.type === 'threat'
                      ? '!'
                      : notification.type === 'sensor'
                        ? '×'
                        : '⌁'
              }}
            </span>
            <span class="notification-copy">
              <strong>{{ notification.title }}</strong>
              <span>{{ notification.message }}</span>
              <time>{{ notification.time }}</time>
            </span>
            <i v-if="!notification.read" aria-hidden="true"></i>
          </button>
        </div>
        <p v-else class="notification-empty">No notifications.</p>
        <footer>View relevant notifications by clicking an item.</footer>
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
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease,
    transform 0.15s ease;
}
.notification-button:hover {
  border-color: #cfdcd3;
  background: #f8faf7;
}
.notification-button:active {
  transform: scale(0.95);
}
.notification-button:focus-visible {
  outline: 2px solid #62a087;
  outline-offset: 2px;
}
.notification-button svg {
  width: 19px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
  transform-origin: top center;
}
.notification-button:hover svg {
  animation: bell-ring 0.9s both;
}
.notification-count {
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
  font-weight: 800;
}
.notification-menu,
.profile-menu {
  position: absolute;
  top: 49px;
  right: 0;
  z-index: 120;
  border: 1px solid #e1e6e1;
  border-radius: 13px;
  background: #fff;
  box-shadow: 0 14px 36px rgba(28, 65, 51, 0.16);
}
.notification-menu {
  width: min(360px, calc(100vw - 24px));
  overflow: hidden;
}
.notification-menu header {
  padding: 13px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid #e9eeea;
}
.notification-menu header strong {
  color: #294f41;
  font-size: 12px;
}
.notification-menu header button {
  padding: 0;
  border: 0;
  background: transparent;
  color: #3c8168;
  cursor: pointer;
  font: inherit;
  font-size: 9px;
  font-weight: 700;
}
.notification-menu header button:disabled {
  color: #9ba7a1;
  cursor: default;
}
.notification-list {
  max-height: 350px;
  overflow-y: auto;
}
.notification-item {
  position: relative;
  width: 100%;
  padding: 12px 14px;
  display: grid;
  grid-template-columns: 31px minmax(0, 1fr) 6px;
  align-items: start;
  gap: 10px;
  border: 0;
  border-bottom: 1px solid #edf0ed;
  background: #fff;
  color: #425e54;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.notification-item:hover {
  background: #f5f9f6;
}
.notification-item.unread {
  background: #f0f7f2;
}
.notification-type {
  width: 31px;
  height: 31px;
  display: grid;
  place-items: center;
  border-radius: 9px;
  background: #e6efe9;
  color: #3a795f;
  font-size: 14px;
  font-weight: 800;
}
.notification-type.species {
  background: #e4f0e8;
  color: #287a53;
}
.notification-type.threat,
.notification-type.sensor {
  background: #f8e4e0;
  color: #b84b3a;
}
.notification-type.system {
  background: #e8eff2;
  color: #53727c;
}
.notification-copy {
  min-width: 0;
  display: grid;
  gap: 3px;
}
.notification-copy strong {
  color: #35574a;
  font-size: 10px;
}
.notification-item.unread .notification-copy strong {
  color: #204c3d;
  font-weight: 800;
}
.notification-copy > span {
  color: #6f8078;
  font-size: 9px;
  line-height: 1.45;
}
.notification-copy time {
  color: #98a39e;
  font-size: 8px;
}
.notification-item > i {
  width: 6px;
  height: 6px;
  margin-top: 5px;
  border-radius: 50%;
  background: #c95845;
}
.notification-empty {
  margin: 0;
  padding: 28px 14px;
  color: #82918a;
  font-size: 10px;
  text-align: center;
}
.notification-menu footer {
  padding: 9px 14px;
  background: #f8faf8;
  color: #87958f;
  font-size: 8px;
  text-align: center;
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
  top: 52px;
  width: 160px;
  padding: 7px;
  border-radius: 11px;
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
@keyframes bell-ring {
  0%,
  100% {
    transform: rotateZ(0);
  }
  15% {
    transform: rotateZ(10deg);
  }
  30% {
    transform: rotateZ(-10deg);
  }
  45% {
    transform: rotateZ(5deg);
  }
  60% {
    transform: rotateZ(-5deg);
  }
  75% {
    transform: rotateZ(2deg);
  }
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
@media (prefers-reduced-motion: reduce) {
  .notification-button:hover svg {
    animation: none;
  }
  .notification-button:active {
    transform: none;
  }
}
</style>
