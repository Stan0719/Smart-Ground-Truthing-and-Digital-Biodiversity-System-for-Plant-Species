<script setup lang="ts">
import { logout as serverLogout } from '../services/auth'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AdminTopbarActions from './AdminTopbarActions.vue'
import { useAdminSidebar } from '../composables/useAdminSidebar'
import { useAuthenticatedPageTranslation } from '../composables/useAuthenticatedPageTranslation'

defineProps<{ title: string; eyebrow: string; active: string }>()

const router = useRouter()
const { t } = useI18n()
const { sidebarOpen, isMobile, openSidebar, closeSidebar, handleNavigation } = useAdminSidebar()
useAuthenticatedPageTranslation('.admin-shell')

const logout = async () => {
  await serverLogout()
  sidebarOpen.value = false
  router.push({ name: 'home' })
}

const items = [
  { id: 'Dashboard', labelKey: 'dashboardNav.dashboard', icon: 'dashboard', to: '/admin' },
  {
    id: 'User Management',
    labelKey: 'dashboardNav.userManagement',
    icon: 'user',
    to: '/admin/users',
  },
  {
    id: 'Role & Permission',
    labelKey: 'dashboardNav.rolesPermissions',
    icon: '◇',
    to: '/admin/roles',
  },
  { id: 'IoT Monitoring', labelKey: 'dashboardNav.iotMonitoring', icon: 'iot', to: '/admin/iot' },
  {
    id: 'Sensor Management',
    labelKey: 'dashboardNav.sensorManagement',
    icon: '◉',
    to: '/admin/sensors',
  },
  {
    id: 'Threat Alerts',
    labelKey: 'dashboardNav.threatAlerts',
    icon: 'threat',
    to: '/admin/alerts',
  },
  {
    id: 'System Activity',
    labelKey: 'dashboardNav.systemActivity',
    icon: '↻',
    to: '/admin/activity',
  },
]
</script>

<template>
  <div class="admin-shell" :class="{ 'sidebar-open': sidebarOpen }">
    <aside class="sidebar" :class="{ open: sidebarOpen }">
      <button
        class="sidebar-close-button"
        type="button"
        :aria-label="t('dashboardNav.closeNavigation')"
        @click="closeSidebar"
      >
        ×
      </button>
      <RouterLink
        class="brand"
        to="/"
        :data-tooltip="t('dashboardNav.backToWebsite')"
        :aria-label="t('dashboardNav.backToWebsite')"
        ><img src="/images/logo.png" alt="Niah Biodiversity" />
        <div><strong>NIAH</strong><span>ADMINISTRATION</span></div></RouterLink
      >
      <p class="nav-label">{{ t('dashboardNav.mainMenu') }}</p>
      <nav :aria-label="t('dashboardNav.adminNavigation')">
        <RouterLink
          v-for="item in items"
          :key="item.to"
          :to="item.to"
          :class="{ active: active === item.id }"
          @click="handleNavigation"
        >
          <span class="nav-icon" aria-hidden="true">
            <!-- Dashboard -->
            <svg
              v-if="item.icon === 'dashboard'"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="sidebar-nav-svg"
            >
              <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
              <path
                d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
              />
            </svg>

            <!-- User Management -->
            <svg
              v-else-if="item.icon === 'user'"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="sidebar-nav-svg"
            >
              <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>

            <!-- IoT Monitoring -->
            <svg
              v-else-if="item.icon === 'iot'"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="sidebar-nav-svg"
            >
              <path
                d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"
              />
            </svg>

            <!-- Threat Alerts -->
            <svg
              v-else-if="item.icon === 'threat'"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="sidebar-nav-svg"
            >
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
            </svg>

            <!-- Existing text icons -->
            <template v-else>
              {{ item.icon }}
            </template>
          </span>
          <span>{{ t(item.labelKey) }}</span>
        </RouterLink>
      </nav>
      <div class="sidebar-footer">
        <button type="button" @click="logout">{{ t('nav.logout') }}</button>
      </div>
    </aside>

    <button
      v-if="isMobile && sidebarOpen"
      class="drawer-backdrop"
      type="button"
      :aria-label="t('dashboardNav.closeNavigation')"
      @click="closeSidebar"
    ></button>

    <div class="main-area">
      <header class="topbar">
        <button
          v-if="!sidebarOpen"
          class="menu-button"
          type="button"
          :aria-label="t('dashboardNav.openNavigation')"
          :aria-expanded="sidebarOpen"
          @click="openSidebar"
        >
          <span></span><span></span><span></span>
        </button>
        <div class="heading">
          <p>{{ eyebrow }}</p>
          <h1>{{ title }}</h1>
        </div>
        <AdminTopbarActions />
      </header>
      <main class="page-content"><slot /></main>
    </div>
  </div>
</template>

<style scoped>
* {
  box-sizing: border-box;
}
.admin-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 258px minmax(0, 1fr);
  background: #f3f6f2;
  color: #29483e;
}
.sidebar {
  position: sticky;
  top: 0;
  z-index: 100;
  height: 100vh;
  padding: 24px 16px;
  display: flex;
  flex-direction: column;
  background: #173f34;
  color: #fff;
}
.brand {
  padding: 0 8px 25px;
  display: flex;
  align-items: center;
  gap: 11px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}
.brand img {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  object-fit: cover;
}
.brand div {
  display: flex;
  flex-direction: column;
}
.brand strong {
  font-size: 18px;
  letter-spacing: 2px;
}
.brand div span {
  margin-top: 3px;
  color: #9dd5ba;
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 1.5px;
}
.nav-label {
  margin: 25px 13px 9px;
  color: #75a392;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 1.6px;
}
.sidebar nav {
  display: grid;
  gap: 5px;
}
.sidebar nav a,
.sidebar-footer button {
  width: 100%;
  padding: 11px 13px;
  display: flex;
  align-items: center;
  gap: 11px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: #bfd7cd;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  text-align: left;
  text-decoration: none;
  transition: 0.2s;
}
.sidebar nav a:hover,
.sidebar nav a.active {
  background: #2b6754;
  color: #fff;
}
.nav-icon {
  width: 21px;
  text-align: center;
  font-size: 18px;
}
.sidebar-footer {
  margin-top: auto;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  display: grid;
  gap: 5px;
}
.sidebar-footer a {
  padding: 10px 13px;
  color: #96c3b1;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
}
.sidebar-footer button span {
  width: 21px;
  text-align: center;
  font-size: 18px;
}
.main-area {
  min-width: 0;
}
.topbar {
  position: sticky;
  top: 0;
  z-index: 80;
  min-height: 82px;
  padding: 0 3.5%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  border-bottom: 1px solid #dce4dc;
  background: rgba(255, 255, 255, 0.93);
  backdrop-filter: blur(12px);
}
.heading p {
  margin: 0 0 3px;
  color: #62a087;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 1.8px;
}
.heading h1 {
  margin: 0;
  color: #204c3d;
  font-size: 23px;
}
.page-content {
  width: min(1400px, 94%);
  margin: 0 auto;
  padding: 32px 0 60px;
}
.menu-button {
  display: none;
}
.backdrop {
  display: none;
}
@media (max-width: 920px) {
  .admin-shell {
    grid-template-columns: 1fr;
  }
  .sidebar {
    position: fixed;
    left: 0;
    width: 258px;
    transform: translateX(-100%);
    transition: transform 0.25s;
  }
  .sidebar.open {
    transform: translateX(0);
  }
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 90;
    display: block;
    border: 0;
    background: rgba(12, 35, 27, 0.5);
  }
  .topbar {
    justify-content: flex-start;
  }
  .menu-button {
    width: 39px;
    height: 39px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    border: 1px solid #dfe6df;
    border-radius: 9px;
    background: #fff;
  }
  .menu-button span {
    width: 18px;
    height: 2px;
    background: #376354;
  }
  :deep(.admin-topbar-actions) {
    margin-left: auto;
  }
}
@media (max-width: 540px) {
  .topbar {
    min-height: 72px;
    padding: 0 4%;
  }
  .heading p {
    display: none;
  }
  .heading h1 {
    font-size: 17px;
  }
  .page-content {
    width: 91%;
    padding-top: 23px;
  }
}

/* Match the Administrator Dashboard sidebar. */
.sidebar {
  width: 258px;
  overflow: hidden;
  transition: 0.2s ease;
}
.sidebar-close-button {
  display: none;
}
.brand {
  position: relative;
  margin: -8px -4px 0;
  padding: 8px 12px 25px;
  color: #fff;
  text-decoration: none;
}
.brand::after {
  position: absolute;
  bottom: -30px;
  left: 12px;
  z-index: 110;
  padding: 6px 9px;
  border-radius: 6px;
  background: rgba(18, 25, 22, 0.96);
  color: #fff;
  box-shadow: 0 5px 14px rgba(0, 0, 0, 0.2);
  content: attr(data-tooltip);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.2px;
  white-space: nowrap;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translateY(-3px);
  transition:
    opacity 180ms ease,
    transform 180ms ease,
    visibility 180ms ease;
}
.brand:hover::after,
.brand:focus-visible::after {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
}
.sidebar nav {
  gap: 4px;
}
.sidebar nav a,
.sidebar-footer button {
  padding: 10px 13px;
  font-size: 12px;
}
.sidebar-footer {
  display: block;
}
.sidebar-footer button {
  justify-content: center;
  background: #fce8e6;
  color: #b84d42;
}
.sidebar-footer button:hover,
.sidebar-footer button:focus-visible {
  background: #b84d42;
  color: #fff;
}
.drawer-backdrop {
  display: none;
}
@media (max-width: 920px) {
  .sidebar {
    transition: transform 0.2s ease;
  }
  .sidebar-close-button {
    position: absolute;
    top: 12px;
    right: 10px;
    z-index: 2;
    width: 30px;
    min-width: 0;
    height: 30px;
    padding: 0;
    display: grid;
    place-items: center;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.07);
    color: #bfd7cd;
    cursor: pointer;
    font-size: 22px;
    line-height: 1;
  }
  .drawer-backdrop {
    position: fixed;
    inset: 0;
    z-index: 90;
    display: block;
    border: 0;
    background: rgba(12, 35, 27, 0.5);
  }
}
.admin-shell {
  grid-template-columns: 0 minmax(0, 1fr);
  transition: grid-template-columns 0.2s ease;
}
.admin-shell.sidebar-open {
  grid-template-columns: 258px minmax(0, 1fr);
}
.sidebar {
  position: fixed;
  left: 0;
  transform: translateX(-100%);
}
.sidebar.open {
  transform: translateX(0);
}
.main-area {
  grid-column: 2;
}
.sidebar-close-button {
  position: absolute;
  top: 12px;
  right: 10px;
  z-index: 2;
  width: 30px;
  min-width: 0;
  height: 30px;
  padding: 0;
  display: grid;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.07);
  color: #bfd7cd;
  cursor: pointer;
  font-size: 22px;
  line-height: 1;
}
.menu-button {
  width: 39px;
  height: 39px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 1px solid #dfe6df;
  border-radius: 9px;
  background: #fff;
}
.menu-button span {
  width: 18px;
  height: 2px;
  background: #376354;
}
@media (max-width: 920px) {
  .admin-shell,
  .admin-shell.sidebar-open {
    grid-template-columns: 1fr;
  }
  .main-area {
    grid-column: 1;
  }
}

.nav-icon {
  width: 21px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  text-align: center;
  font-size: 18px;
}

.sidebar-nav-svg {
  width: 18px;
  height: 18px;
  display: block;
  flex-shrink: 0;
  overflow: visible;
}
</style>
