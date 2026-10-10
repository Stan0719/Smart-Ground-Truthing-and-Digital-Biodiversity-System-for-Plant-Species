<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  adminNotifications,
  markAllAdminNotificationsRead,
  unreadAdminNotificationCount,
  type AdminNotification,
} from '../data/adminNotifications'

const emit = defineEmits<{ opened: [] }>()
const router = useRouter()
const notificationOpen = ref(false)
const notificationWrap = ref<HTMLElement | null>(null)

const toggleNotifications = () => {
  notificationOpen.value = !notificationOpen.value
  if (notificationOpen.value) emit('opened')
}

const closeNotifications = () => {
  notificationOpen.value = false
}

const openNotification = (notification: AdminNotification) => {
  notification.read = true
  closeNotifications()
  if (notification.route) router.push(notification.route)
}

const handleOutsideClick = (event: MouseEvent) => {
  if (
    notificationOpen.value &&
    notificationWrap.value &&
    !notificationWrap.value.contains(event.target as Node)
  ) {
    closeNotifications()
  }
}

defineExpose({ closeNotifications })
onMounted(() => document.addEventListener('click', handleOutsideClick))
onBeforeUnmount(() => document.removeEventListener('click', handleOutsideClick))
</script>

<template>
  <div ref="notificationWrap" class="notification-wrap">
    <button
      class="notification-button"
      type="button"
      aria-label="Notifications"
      :aria-expanded="notificationOpen"
      aria-controls="admin-notifications"
      @click="toggleNotifications"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" />
      </svg>
      <span v-if="unreadAdminNotificationCount" class="notification-count">{{
        unreadAdminNotificationCount
      }}</span>
    </button>

    <section
      v-if="notificationOpen"
      id="admin-notifications"
      class="notification-menu"
      aria-label="Admin notifications"
    >
      <header>
        <strong>Notifications</strong>
        <button
          type="button"
          :disabled="unreadAdminNotificationCount === 0"
          @click="markAllAdminNotificationsRead"
        >
          Mark all as read
        </button>
      </header>
      <div v-if="adminNotifications.length" class="notification-list">
        <button
          v-for="notification in adminNotifications.slice(0, 5)"
          :key="notification.id"
          class="notification-item"
          :class="{ unread: !notification.read }"
          type="button"
          @click="openNotification(notification)"
        >
          <span class="notification-type" :class="notification.type" aria-hidden="true">{{
            notification.type === 'sensor' ? '×' : notification.type === 'system' ? '⌁' : '!'
          }}</span>
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
</template>

<style scoped>
.notification-wrap {
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
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border: 2px solid #fff;
  border-radius: 50%;
  background: #c95845;
  color: #fff;
  font-size: 8px;
  font-weight: 800;
}
.notification-menu {
  position: absolute;
  top: 49px;
  right: 0;
  z-index: 120;
  width: min(360px, calc(100vw - 24px));
  overflow: hidden;
  border: 1px solid #e1e6e1;
  border-radius: 13px;
  background: #fff;
  box-shadow: 0 14px 36px rgba(28, 65, 51, 0.16);
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
.notification-type.threat,
.notification-type.sensor {
  background: #f8e4e0;
  color: #b84b3a;
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
@media (prefers-reduced-motion: reduce) {
  .notification-button:hover svg {
    animation: none;
  }
  .notification-button:active {
    transform: none;
  }
}
</style>
