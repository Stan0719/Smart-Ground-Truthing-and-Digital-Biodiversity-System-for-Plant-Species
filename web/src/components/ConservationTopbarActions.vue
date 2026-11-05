<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { logout, sessionSnapshot, subscribeSession } from '../services/auth'
import { createOfficerInbox, type OfficerNotice } from '../services/officerNotifications'
import { conservationProfile } from '../data/conservationProfile'
import LanguageSwitcher from './LanguageSwitcher.vue'

const router = useRouter()
const { t, locale } = useI18n()
const actionsWrap = ref<HTMLElement | null>(null)
const notificationsOpen = ref(false)
const profileOpen = ref(false)
const notificationButton = ref<HTMLButtonElement | null>(null)
const inbox = createOfficerInbox({ transport: (...args) => fetch(...args), navigate: async destination => {
  await router.push(destination)
  return router.currentRoute.value.name === destination.name &&
    (!destination.query?.review || router.currentRoute.value.query.review === destination.query.review)
} })
const notificationState = inbox.state
const nt = (key: string) => t('dashboardNotifications.officerLive.' + key)
const noticeTitle = (notice: OfficerNotice) => nt(notice.event_type === 'registration_submitted' ? 'registrationTitle' : 'fieldTitle')
const noticeMessage = (notice: OfficerNotice) => nt(notice.event_type === 'registration_submitted'
  ? notice.species_review_required ? 'speciesFirst' : 'registrationMessage' : 'fieldMessage')
const noticeTime = (notice: OfficerNotice) => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(notice.created_at))
let mounted = false
let poll: ReturnType<typeof setInterval> | null = null
const syncPolling = () => {
  if (poll) clearInterval(poll)
  poll = null
  if (mounted && notificationState.ready) poll = setInterval(() => {
    if (document.visibilityState === 'visible' && !notificationsOpen.value) void inbox.refreshCount()
  }, 60000)
}
watch(() => notificationState.ready, syncPolling)
const initialSession = sessionSnapshot()
inbox.setSession(initialSession.user, initialSession.pending)
const unsubscribe = subscribeSession((user, pending) => {
  if (inbox.setSession(user, pending)) {
    closeMenus()
    if (mounted && notificationState.ready) void inbox.load()
  }
})
const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && notificationsOpen.value) {
    closeMenus(); notificationButton.value?.focus()
  }
}

const toggleNotifications = () => {
  notificationsOpen.value = !notificationsOpen.value
  if (notificationsOpen.value) { profileOpen.value = false; void inbox.load() }
}

const toggleProfile = () => {
  profileOpen.value = !profileOpen.value
  if (profileOpen.value) notificationsOpen.value = false
}

const closeMenus = () => {
  notificationsOpen.value = false
  profileOpen.value = false
}

const openNotification = async (notification: OfficerNotice) => {
  if (await inbox.open(notification)) closeMenus()
}

const openProfileSettings = async () => {
  closeMenus()
  await router.push({ name: 'conservation-profile' })
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
}

const signOut = async () => {
  closeMenus()
  await logout()
  await router.replace('/')
}

const handleOutsideClick = (event: MouseEvent) => {
  if (!actionsWrap.value?.contains(event.target as Node)) closeMenus()
}

onMounted(() => {
  mounted = true
  document.addEventListener('click', handleOutsideClick)
  document.addEventListener('keydown', onKeydown)
  void inbox.load()
  syncPolling()
})
onBeforeUnmount(() => {
  mounted = false; unsubscribe(); inbox.dispose()
  if (poll) clearInterval(poll)
  document.removeEventListener('click', handleOutsideClick)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="actionsWrap" class="conservation-topbar-actions">
    <div class="dashboard-language"><LanguageSwitcher /></div>
    <div class="notification-wrap">
      <button
        ref="notificationButton"
        class="notification-button"
        type="button"
        :aria-label="t('dashboardNav.notifications')"
        :aria-expanded="notificationsOpen"
        aria-controls="conservation-notifications"
        @click="toggleNotifications"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" />
        </svg>
        <span v-if="notificationState.unread !== null && notificationState.unread > 0" class="notification-count" aria-live="polite">
          {{ notificationState.unread }}
        </span>
      </button>

      <section
        v-if="notificationsOpen"
        id="conservation-notifications"
        class="notification-menu"
        :aria-label="t('dashboardNav.conservationNotifications')"
      >
        <header>
          <strong>{{ t('dashboardNav.notifications') }}</strong>
          <button
            type="button"
            :disabled="notificationState.busy || notificationState.loading || !notificationState.boundary || !notificationState.unread"
            @click="inbox.markAll()"
          >
            {{ t('dashboardNav.markAllRead') }}
          </button>
        </header>
        <p v-if="notificationState.loading" class="notification-empty" role="status">{{ nt('loading') }}</p>
        <div v-if="notificationState.error" class="notification-empty" role="alert">
          <p>{{ nt(notificationState.error) }}</p>
          <button type="button" :disabled="notificationState.loading || notificationState.busy || !notificationState.ready" @click="inbox.load(notificationState.error === 'loadFailed' && Boolean(notificationState.cursor))">{{ nt('retry') }}</button>
        </div>
        <div v-if="notificationState.items.length || notificationState.hasMore" class="notification-list">
          <button
            v-for="notification in notificationState.items"
            :key="notification.id"
            class="notification-item"
            :class="{ unread: notification.read_at === null }"
            :disabled="notificationState.busy || !notificationState.ready"
            type="button"
            @click="openNotification(notification)"
          >
            <span class="notification-type review" aria-hidden="true">✓</span>
            <span class="notification-copy">
              <strong>{{ noticeTitle(notification) }}</strong>
              <span>{{ noticeMessage(notification) }}</span>
              <small>{{ notification.resource.id }}</small>
              <time :datetime="notification.created_at">{{ noticeTime(notification) }}</time>
              <small v-if="notification.read_at === null">{{ nt('unread') }}</small>
            </span>
            <i v-if="notification.read_at === null" aria-hidden="true"></i>
          </button>
          <button v-if="notificationState.hasMore" type="button" class="notification-item" :disabled="notificationState.loading || notificationState.busy" @click="inbox.load(true)">{{ nt('more') }}</button>
        </div>
        <p v-if="!notificationState.loading && !notificationState.error && !notificationState.items.length" class="notification-empty">{{ t('dashboardNav.noNotifications') }}</p>
        <footer>{{ t('dashboardNav.notificationHint') }}</footer>
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
          <small>{{ t('dashboardNav.conservationOfficer') }}</small>
        </span>
        <span class="chevron" aria-hidden="true">⌄</span>
      </button>
      <div v-if="profileOpen" class="profile-menu" role="menu">
        <button type="button" role="menuitem" @click="openProfileSettings">
          {{ t('dashboardNav.profileSettings') }}
        </button>
        <button type="button" role="menuitem" @click="signOut">
          {{ t('dashboardNav.signOut') }}
        </button>
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
.dashboard-language :deep(.language-trigger) {
  min-height: 39px;
  border-radius: 11px;
  background: #fff;
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
.notification-type.camera,
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
  .dashboard-language :deep(.language-switcher),
  .dashboard-language :deep(.language-trigger) {
    width: auto;
  }
  .dashboard-language :deep(.language-trigger) {
    min-height: 35px;
    padding-inline: 9px;
    color: #3f7777;
  }
  .dashboard-language :deep(.language-full) {
    display: none;
  }
  .dashboard-language :deep(.language-short) {
    display: inline;
  }
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
