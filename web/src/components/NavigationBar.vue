<script setup lang="ts">
import {
  ref,
  computed,
  nextTick,
  onMounted,
  onBeforeUnmount,
  watch
} from 'vue'

import { useRoute, useRouter } from 'vue-router'
import LoginModal from './LoginModal.vue'
import { PENDING_PASSWORD_CHANGE_KEY } from '../data/prototypeAuth'

const route = useRoute()
const router = useRouter()
const navSearch = ref('')

type UserRole = 'admin' | 'conservation-officer' | null

const isLoggedIn = ref(false)

// TEMPORARY FRONTEND ROLE STATE.
// Replace this with the authenticated user's role from the backend/database
// when authentication is integrated.
const userRole = ref<UserRole>(null)

const username = ref('')

const navItems = computed(() => {
  const items = [
    {
      label: 'Home',
      to: '/',
    },
    {
      label: 'Explore Species',
      to: '/species',
    },
  ]

  if (isLoggedIn.value && userRole.value === 'admin') {
    items.push({
      label: 'Admin',
      to: '/admin',
    })
  }

  if (isLoggedIn.value && userRole.value === 'conservation-officer') {
    items.push({
      label: 'Conservation Officer',
      to: '/conservation-dashboard',
    })
  }

  return items
})

const submitNavSearch = () => {
  const query = navSearch.value.trim()

  router.push({
    path: '/species',
    query: query ? { search: query } : {}
  })
}

const navTrack = ref<HTMLElement | null>(null)

const thumbLeft = ref(0)
const thumbWidth = ref(0)

const activeNavIndex = computed(() => {
  const index = navItems.value.findIndex(item => {
    if (item.to === '/') {
      return route.path === '/'
    }

    if (item.to === '/species') {
      return route.path.startsWith('/species') || route.path.startsWith('/plant/')
    }

    return route.path.startsWith(item.to)
  })

  return index === -1 ? 0 : index
})

const updateNavThumb = async () => {
  await nextTick()

  const track = navTrack.value

  if (!track) {
    return
  }

  const links =
    track.querySelectorAll<HTMLElement>('.nav-link')

  const activeLink =
    links[activeNavIndex.value]

  if (!activeLink) {
    return
  }

  const trackRect =
    track.getBoundingClientRect()

  const linkRect =
    activeLink.getBoundingClientRect()

  thumbLeft.value =
    linkRect.left - trackRect.left

  thumbWidth.value =
    linkRect.width
}

const navThumbStyle = computed(() => ({
  transform: `translateX(${thumbLeft.value}px)`,
  width: `${thumbWidth.value}px`
}))

const handleResize = () => {
  updateNavThumb()
}

onMounted(() => {
  updateNavThumb()

  window.addEventListener(
    'resize',
    handleResize
  )
})

onBeforeUnmount(() => {
  window.removeEventListener(
    'resize',
    handleResize
  )
})

watch(
  [() => route.path, isLoggedIn, userRole],
  () => {
    updateNavThumb()
  }
)

const mobileMenuOpen = ref(false)

const loginModalOpen = ref(false)

const logoutModalOpen = ref(false)

const closeMobileMenu = () => {

  mobileMenuOpen.value = false

}

const handleLogoClick = (event: MouseEvent) => {
  closeMobileMenu()

  // If already on HomeView, scroll to the top instead of reloading the route
  if (route.path === '/') {
    event.preventDefault()

    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    })
  }
}

const toggleMobileMenu = () => {
  mobileMenuOpen.value = !mobileMenuOpen.value
}


const openLoginModal = () => {
  mobileMenuOpen.value = false
  loginModalOpen.value = true

}

const handleLogin = (user: {
  username: string
  role: Exclude<UserRole, null>
  email?: string
  mustChangePassword?: boolean
}) => {
  if (user.mustChangePassword && user.email) {
    sessionStorage.setItem(PENDING_PASSWORD_CHANGE_KEY, user.email)
    loginModalOpen.value = false
    router.push({ name: 'change-password' })
    return
  }

  username.value = user.username
  userRole.value = user.role
  isLoggedIn.value = true
  loginModalOpen.value = false
  router.push(user.role === 'admin' ? { name: 'admin-dashboard' } : { name: 'conservation-dashboard' })
}

const closeLoginModal = () => {

  loginModalOpen.value = false

}


const openLogoutModal = () => {

  mobileMenuOpen.value = false

  logoutModalOpen.value = true

}


const closeLogoutModal = () => {

  logoutModalOpen.value = false

}


const logout = () => {

  isLoggedIn.value = false

  userRole.value = null

  username.value = ''

  logoutModalOpen.value = false

}



</script>

<template>
  <header class="navbar">
    <div class="navbar-container">

      <!-- Logo -->
      <RouterLink
        to="/"
        class="logo"
        @click="handleLogoClick"
      >
        <img
          src="/images/logo2.png"
          alt="Niah Biodiversity Logo"
          class="logo-image"
        />

        <div class="logo-text">
          <span class="logo-title">NIAH</span>
          <span class="logo-subtitle">BIODIVERSITY</span>
        </div>
      </RouterLink>

      <!-- Desktop Navigation -->
      <nav class="desktop-nav" aria-label="Main navigation">
        <div
          ref="navTrack"
          class="nav-track"
        >
          <div
            class="nav-thumb"
            :style="navThumbStyle"
            aria-hidden="true"
          ></div>

          <RouterLink
            v-for="(item, index) in navItems"
            :key="item.to"
            :to="item.to"
            class="nav-link"
            :class="{ 'is-active': index === activeNavIndex }"
          >
            {{ item.label }}
          </RouterLink>

          <form class="nav-search" role="search" @submit.prevent="submitNavSearch">
            <label>
              <span class="sr-only">Search plants</span>
              <input
                v-model="navSearch"
                autocomplete="off"
                placeholder="Search here..."
                type="search"
              />
            </label>

            <button type="submit" aria-label="Search plants">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="10.8" cy="10.8" r="6.8" />
                <path d="m16 16 4.5 4.5" />
              </svg>
            </button>
          </form>
        </div>
      </nav>

      <!-- =========================
           Authentication
           ========================= -->

      <div class="auth-area">

        <!-- Logged Out -->

        <button
          v-if="!isLoggedIn"
          class="login-button"
          type="button"
          aria-label="Login"
          title="Login"
          @click="openLoginModal"
        >

          <!-- User Icon -->

          <svg
            class="login-icon"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 448 512"
            aria-hidden="true"
          >

            <path
              d="M224 248a120 120 0 1 0 0-240 120 120 0 1 0 0 240zm-29.7 56C95.8 304 16 383.8 16 482.3 16 498.7 29.3 512 45.7 512l356.6 0c16.4 0 29.7-13.3 29.7-29.7 0-98.5-79.8-178.3-178.3-178.3l-59.4 0z"
            />

          </svg>

          <span class="login-button-text">Login</span>

        </button>


        <!-- Logged In -->

        <button
          v-else
          class="logout-button"
          type="button"
          @click="openLogoutModal"
        >

          <span>
            {{ username }}
          </span>

          <!-- Logout Icon -->

          <svg
            class="logout-icon"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >

            <path
              d="M16 17L21 12M21 12L16 7M21 12H9M12 17C12 17.93 12 18.395 11.8978 18.7765C11.6204 19.8117 10.8117 20.6204 9.77646 20.8978C9.39496 21 8.92997 21 8 21H7.5C6.10218 21 5.40326 21 4.85195 20.7716C4.11687 20.4672 3.53284 19.8831 3.22836 19.1481C3 18.5967 3 17.8978 3 16.5V7.5C3 6.10217 3 5.40326 3.22836 4.85195C3.53284 4.11687 4.11687 3.53284 4.85195 3.22836C5.40326 3 6.10218 3 7.5 3H8C8.92997 3 9.39496 3 9.77646 3.10222C10.8117 3.37962 11.6204 4.18827 11.8978 5.22354C12 5.60504 12 6.07003 12 7"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />

          </svg>

          Logout

        </button>

      </div>

      <button
        class="menu-button"
        type="button"
        aria-label="Toggle navigation menu"
        :aria-expanded="mobileMenuOpen"
        aria-controls="mobile-navigation"
        @click="toggleMobileMenu"
      >
        <span></span>
        <span></span>
        <span></span>
      </button>

      <!-- =========================
         Mobile Navigation
      ========================= -->

      <button
        v-if="mobileMenuOpen"
        class="mobile-nav-backdrop"
        type="button"
        aria-label="Close navigation menu"
        @click="closeMobileMenu"
      ></button>

      <nav
        id="mobile-navigation"
        class="mobile-nav"
        :class="{ open: mobileMenuOpen }"
        aria-label="Mobile navigation"
      >

        <div class="mobile-drawer-header">
          <RouterLink to="/" class="mobile-drawer-brand" @click="closeMobileMenu">
            <img src="/images/logo.png" alt="" />
            <span>
              <strong>NIAH</strong>
              <small>BIODIVERSITY</small>
            </span>
          </RouterLink>

          <button
            class="mobile-drawer-close"
            type="button"
            aria-label="Close navigation menu"
            @click="closeMobileMenu"
          >
            ×
          </button>
        </div>

        <p class="mobile-menu-label">MENU</p>

        <RouterLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="mobile-nav-link"
          @click="closeMobileMenu"
        >
          <span class="mobile-link-icon" aria-hidden="true">
            <svg v-if="item.to === '/'" viewBox="0 0 24 24"><path d="m3 11 9-8 9 8M5 10v10h14V10M9 20v-6h6v6" /></svg>
            <svg v-else viewBox="0 0 24 24"><path d="M20 4C10 4 5 9 5 16c5-4 9-6 13-8-5 3-9 7-11 12" /></svg>
          </span>
          <span>{{ item.label }}</span>
        </RouterLink>

        <RouterLink
          to="/search"
          class="mobile-nav-link"
          @click="closeMobileMenu"
        >
          <span class="mobile-link-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></svg>
          </span>
          <span>Search</span>
        </RouterLink>


        <div class="mobile-nav-divider" aria-hidden="true"></div>

        <!-- Mobile Authentication: reuses the shared login/logout state. -->

        <button
          v-if="!isLoggedIn"
          class="mobile-login-button"
          type="button"
          @click="openLoginModal"
        >

          <svg
            class="login-icon"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 448 512"
            aria-hidden="true"
          >

            <path
              d="M224 248a120 120 0 1 0 0-240 120 120 0 1 0 0 240zm-29.7 56C95.8 304 16 383.8 16 482.3 16 498.7 29.3 512 45.7 512l356.6 0c16.4 0 29.7-13.3 29.7-29.7 0-98.5-79.8-178.3-178.3-178.3l-59.4 0z"
            />

          </svg>

          Login

        </button>
        <div v-else class="mobile-authenticated">
          <div class="mobile-user">
            <svg
              class="login-icon"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 448 512"
              aria-hidden="true"
            >
              <path
                d="M224 248a120 120 0 1 0 0-240 120 120 0 1 0 0 240zm-29.7 56C95.8 304 16 383.8 16 482.3 16 498.7 29.3 512 45.7 512l356.6 0c16.4 0 29.7-13.3 29.7-29.7 0-98.5-79.8-178.3-178.3-178.3l-59.4 0z"
              />
            </svg>
            <span>{{ username }}</span>
          </div>

          <button
            class="mobile-logout-button"
            type="button"
            @click="openLogoutModal"
          >
            <svg
              class="logout-icon"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M16 17L21 12M21 12L16 7M21 12H9M12 17C12 17.93 12 18.395 11.8978 18.7765C11.6204 19.8117 10.8117 20.6204 9.77646 20.8978C9.39496 21 8.92997 21 8 21H7.5C6.10218 21 5.40326 21 4.85195 20.7716C4.11687 20.4672 3.53284 19.8831 3.22836 19.1481C3 18.5967 3 17.8978 3 16.5V7.5C3 6.10217 3 5.40326 3.22836 4.85195C3.53284 4.11687 4.11687 3.53284 4.85195 3.22836C5.40326 3 6.10218 3 7.5 3H8C8.92997 3 9.39496 3 9.77646 3.10222C10.8117 3.37962 11.6204 4.18827 11.8978 5.22354C12 5.60504 12 6.07003 12 7"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            Logout
          </button>
        </div>

      </nav>
    </div>
  </header>
  <!-- =========================
       Login Modal
  ========================= -->

  <LoginModal
    :visible="loginModalOpen"
    @close="closeLoginModal"
    @login="handleLogin"
  />


  <!-- =========================
       Logout Confirmation Modal
  ========================= -->

  <div
    v-if="logoutModalOpen"
    class="modal-overlay"
    @click.self="closeLogoutModal"
  >

    <div class="logout-modal">

      <div class="modal-icon">

        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >

          <path
            d="M16 17L21 12M21 12L16 7M21 12H9M12 17C12 17.93 12 18.395 11.8978 18.7765C11.6204 19.8117 10.8117 20.6204 9.77646 20.8978C9.39496 21 8.92997 21 8 21H7.5C6.10218 21 5.40326 21 4.85195 20.7716C4.11687 20.4672 3.53284 19.8831 3.22836 19.1481C3 18.5967 3 17.8978 3 16.5V7.5C3 6.10217 3 5.40326 3.22836 4.85195C3.53284 4.11687 4.11687 3.53284 4.85195 3.22836C5.40326 3 6.10218 3 7.5 3H8C8.92997 3 9.39496 3 9.77646 3.10222C10.8117 3.37962 11.6204 4.18827 11.8978 5.22354C12 5.60504 12 6.07003 12 7"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />

        </svg>

      </div>

      <h2>
        Log out?
      </h2>

      <p>
        Are you sure you want to log out of your account?
      </p>

      <div class="modal-actions">

        <button
          class="cancel-button"
          type="button"
          @click="closeLogoutModal"
        >
          Cancel
        </button>

        <button
          class="confirm-logout-button"
          type="button"
          @click="logout"
        >
          Log Out
        </button>

      </div>

    </div>
  </div>
</template>

<style scoped>
.navbar {
  position: sticky;
  top: 0;
  z-index: 1000;

  width: 100%;

  background: rgba(224, 235, 221, 0.95);

  border-bottom: 1px solid rgba(70, 133, 133, 0.15);

  backdrop-filter: blur(10px);
}

.navbar-container {
  box-sizing: border-box;
  width: 100%;
  padding: 0 10px;

  min-height: 76px;

  margin: 0 auto;

  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;

  gap: 30px;
}

/* =========================
   Logo
========================= */

.logo {
  display: flex;
  align-items: center;

  justify-self: start;

  gap: 10px;

  color: #468585;

  text-decoration: none;

  flex-shrink: 0;
}

/* Circular logo image */
.logo-image {
  width: 46px;
  height: 46px;
  /* border-radius: 50%; */
  object-fit: cover;
}

.logo-text {
  display: flex;
  flex-direction: column;

  line-height: 1;
}

.logo-title {
  font-size: 18px;
  font-weight: 800;

  letter-spacing: 1.5px;
}

.logo-subtitle {
  margin-top: 4px;

  font-size: 9px;
  font-weight: 600;

  letter-spacing: 2px;

  color: #468585;
}

/* =========================
   Desktop Navigation
   ========================= */

.desktop-nav {
  display: flex;
  align-items: center;
  justify-self: center;
}

.nav-track {
  position: relative;

  display: inline-flex;
  align-items: center;

  gap: 4px;
  padding: 4px;

  border-radius: 14px;

  user-select: none;
}

.nav-thumb {
  position: absolute;

  top: 4px;
  left: 0;

  height: 36px;

  border-radius: 10px;

  background: #468585;

  box-shadow:
    0 2px 8px rgba(70, 133, 133, 0.25);

  pointer-events: none;

  transition:
    transform 280ms cubic-bezier(0.23, 1, 0.32, 1),
    width 280ms cubic-bezier(0.23, 1, 0.32, 1);

  z-index: 0;
}

.nav-link {
  position: relative;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  min-height: 36px;
  padding: 0 15px;

  border-radius: 10px;

  color: #468585;
  text-decoration: none;

  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;

  transition:
    color 180ms ease,
    transform 160ms cubic-bezier(0.23, 1, 0.32, 1);

  z-index: 1;
}

.nav-link.router-link-active,
.nav-link.is-active {
  color: #ffffff !important;
}

@media (hover: hover) and (pointer: fine) {
  .nav-link:not(.is-active):hover {
    color: #50B498;
    background: rgba(80, 180, 152, 0.08);
  }
}

.nav-link:active {
  transform: scale(0.96);
}

.nav-link:focus-visible {
  outline: 2px solid #50B498;
  outline-offset: 3px;
}

.nav-search {
  margin-left: 5px;
  display: flex;
  align-items: center;
  gap: 7px;
}

.nav-search label {
  display: flex;
}

.nav-search input {
  width: 150px;
  padding: 9px 14px;
  border: 1px solid rgba(70, 133, 133, 0.45);
  border-radius: 999px;
  outline: none;
  background: #e0ebdd;
  color: #405f5b;
  font-family: inherit;
  font-size: 12px;
  box-shadow: 0 4px 12px rgba(70, 133, 133, 0.12);
  transition: 0.3s ease;
}

.nav-search input::placeholder {
  color: #648580;
  opacity: 0.72;
}

.nav-search input:focus {
  width: 185px;
  border-color: #50b498;
  box-shadow: 0 5px 16px rgba(80, 180, 152, 0.28), 0 0 0 2px rgba(80, 180, 152, 0.14);
}

.nav-search button {
  width: 36px;
  height: 36px;
  padding: 7px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(70, 133, 133, 0.45);
  border-radius: 50%;
  outline: none;
  background: #e0ebdd;
  color: #468585;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(70, 133, 133, 0.12);
  transition: 0.3s ease;
}

.nav-search button:hover,
.nav-search button:focus-visible {
  border-color: #50b498;
  background: #d5e8d7;
  color: #32756a;
  box-shadow: 0 5px 16px rgba(80, 180, 152, 0.28);
  transform: translateY(-2px);
}

.nav-search button svg {
  width: 21px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.7;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
/* =========================
   Login Button
   ========================= */

.login-button {
  padding: 10px 20px;

  border-radius: 24px;

  background: #468585;
  color: white;

  text-decoration: none;

  font-size: 14px;
  font-weight: 600;

  transition:
    background 0.2s ease,
    transform 0.2s ease;
}

.login-button:hover {
  background: #50B498;

  transform: translateY(-1px);
}

/* =========================
   Mobile Menu Button
   ========================= */

.menu-button {
  display: none;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 5px;

  width: 42px;
  height: 42px;

  padding: 8px;

  border: none;
  border-radius: 8px;

  background: transparent;

  cursor: pointer;

  transition: background 0.2s ease;
}

.menu-button span {
  display: block;

  width: 24px;
  height: 3px;
  min-height: 3px;
  max-height: 3px;
  flex: 0 0 3px;
  margin: 0;

  border-radius: 2px;

  background: #468585;

  transition: transform 0.2s ease, opacity 0.2s ease;
}

.menu-button:hover,
.menu-button:focus-visible {
  background: #E0EBDD ;
}

.menu-button[aria-expanded='true'] span:nth-child(1) {
  transform: translateY(8px) rotate(45deg);
}

.menu-button[aria-expanded='true'] span:nth-child(2) {
  opacity: 0;
}

.menu-button[aria-expanded='true'] span:nth-child(3) {
  transform: translateY(-8px) rotate(-45deg);
}

/* =========================
   Mobile Navigation
   ========================= */

.mobile-nav {
  display: none;
}

.mobile-nav-backdrop {
  display: none;
}

/* =========================
   Responsive
   ========================= */

@media (max-width: 900px) {
  .navbar-container {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0;
  }

  .logo {
    transform: none;
  }

  .desktop-nav,
  .auth-area {
    display: none;
  }

  .menu-button {
    display: flex;
  }

  .mobile-nav {
    box-sizing: border-box;
    position: fixed;
    top: 0;
    right: 0;
    z-index: 1200;

    width: min(330px, 86vw);
    height: 100dvh;

    padding: 0 18px 24px;

    display: flex;
    flex-direction: column;
    gap: 3px;

    overflow-y: auto;

    background: #356f70;
    box-shadow: -18px 0 45px rgba(25, 55, 50, 0.24);

    transform: translateX(105%);
    visibility: hidden;

    transition:
      transform 0.3s cubic-bezier(0.22, 1, 0.36, 1),
      visibility 0.3s ease;
  }

  .mobile-nav.open {
    transform: translateX(0);
    visibility: visible;
  }

  .mobile-nav-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1100;

    display: block;

    padding: 0;
    border: 0;

    background: rgba(18, 39, 34, 0.48);
    backdrop-filter: blur(2px);
  }

  .mobile-drawer-header {
    min-height: 92px;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid rgba(255, 255, 255, 0.16);
  }

  .mobile-drawer-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    color: #fff;
    text-decoration: none;
  }

  .mobile-drawer-brand img {
    width: 46px;
    height: 46px;
    border-radius: 50%;
    object-fit: cover;
    background: #fff;
  }

  .mobile-drawer-brand > span {
    display: flex;
    flex-direction: column;
  }

  .mobile-drawer-brand strong {
    font-size: 16px;
    letter-spacing: 2px;
  }

  .mobile-drawer-brand small {
    margin-top: 3px;
    color: #c5ead1;
    font-size: 7px;
    font-weight: 700;
    letter-spacing: 1.8px;
  }

  .mobile-drawer-close {
    width: 35px;
    height: 35px;
    display: grid;
    place-items: center;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 9px;
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
    cursor: pointer;
    font: inherit;
    font-size: 24px;
    line-height: 1;
  }

  .mobile-menu-label {
    margin: 8px 12px 9px;
    color: #a9d8c0;
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 2px;
  }

  .mobile-nav-link {
    padding: 13px 12px;

    display: flex;
    align-items: center;
    gap: 13px;

    color: #e5f1eb;

    text-decoration: none;

    font-size: 13px;
    font-weight: 600;

    border-bottom: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 8px;

    transition: background-color 0.2s ease, color 0.2s ease;
  }

  .mobile-nav-link:hover,
  .mobile-nav-link.router-link-active {
    background: rgba(255, 255, 255, 0.13);
    color: #fff;
  }

  .mobile-link-icon {
    width: 25px;
    height: 25px;
    flex: 0 0 25px;
    display: grid;
    place-items: center;
    border-radius: 7px;
    background: rgba(255, 255, 255, 0.09);
  }

  .mobile-link-icon svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .mobile-nav-divider {
    width: 100%;
    height: 1px;
    margin: 10px 0 8px;
    background: rgba(255, 255, 255, 0.16);
  }

  .mobile-login-button,
  .mobile-logout-button {
    display: flex;

    align-items: center;
    justify-content: center;

    gap: 8px;

    width: 100%;

    margin-top: 8px;

    padding: 12px;

    border: none;

    border-radius: 24px;

    background: #fff6dc;

    color: #356f70;

    font-family: inherit;

    font-size: 15px;
    font-weight: 600;

    cursor: pointer;

    transition: background 0.2s ease, transform 0.2s ease;
  }

  .mobile-login-button:hover,
  .mobile-logout-button:hover {
    background: #def9c4;
    transform: translateY(-1px);
  }

  .mobile-authenticated {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 10px;
    margin-top: 8px;
  }

  .mobile-user {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
    padding: 12px 14px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.1);
    color: #ffffff;
    font-size: 15px;
    font-weight: 700;
  }

  .mobile-user .login-icon {
    flex: 0 0 auto;
    width: 16px;
    height: 16px;
  }

  .mobile-logout-button {
    width: auto;
    min-width: 112px;
    margin-top: 0;
  }
}

/*Login */
.login-button {
  display: flex;
  align-items: center;
  justify-content: center;

  gap: 8px;

  padding: 10px 20px;

  border: none;
  border-radius: 24px;

  background: #468585;
  color: white;

  font-family: inherit;
  font-size: 14px;
  font-weight: 600;

  cursor: pointer;

  transition:
    background 0.2s ease,
    transform 0.2s ease;
}

.login-button:hover {
  background: #50B498;

  transform: translateY(-1px);
}

.login-icon {
  width: 14px;
  height: 14px;

  fill: currentColor;
}

/* */
/* =========================
   Authentication Area
   ========================= */

.auth-area {
  display: flex;
  align-items: center;
  justify-self: end;
  gap: 10px;
}


/* Login Icon */

.login-icon {
  width: 14px;
  height: 14px;
  fill: currentColor;
}


/* Logout Icon */

.logout-icon {
  width: 19px;
  height: 19px;
  flex: 0 0 19px;
  fill: none;
}


/* Login Button */

.login-button,
.logout-button {
  display: flex;
  align-items: center;
  justify-content: center;

  gap: 8px;

  padding: 10px 18px;

  border: none;
  border-radius: 24px;

  background: #468585;
  color: white;

  font-family: inherit;
  font-size: 14px;
  font-weight: 600;

  cursor: pointer;

  transition:
    background 0.2s ease,
    transform 0.2s ease;
}


.login-button:hover,
.logout-button:hover {
  background: #50B498;

  transform: translateY(-1px);
}

/* Compact desktop login button: reveal its label on hover or keyboard focus. */
.login-button {
  width: 42px;
  height: 42px;
  padding: 0;
  gap: 0;
  overflow: hidden;
  white-space: nowrap;
  transition:
    width 0.25s ease,
    gap 0.25s ease,
    padding 0.25s ease,
    background 0.2s ease,
    transform 0.2s ease;
}

.login-button .login-icon {
  width: 17px;
  height: 17px;
  flex: 0 0 17px;
}

.login-button-text {
  max-width: 0;
  overflow: hidden;
  opacity: 0;
  transform: translateX(-6px);
  transition:
    max-width 0.25s ease,
    opacity 0.2s ease,
    transform 0.25s ease;
}

.login-button:hover,
.login-button:focus-visible {
  width: 104px;
  padding: 0 16px;
  gap: 8px;
}

.login-button:hover .login-button-text,
.login-button:focus-visible .login-button-text {
  max-width: 48px;
  opacity: 1;
  transform: translateX(0);
}


/* =========================
   Logout Modal
   ========================= */

.modal-overlay {
  position: fixed;

  inset: 0;

  z-index: 2000;

  display: flex;

  align-items: center;
  justify-content: center;

  padding: 20px;

  background: rgba(30, 45, 40, 0.55);

  backdrop-filter: blur(5px);
}


.logout-modal {
  width: min(420px, 100%);

  padding: 36px;

  border-radius: 24px;

  background: #FFF6DC;

  box-shadow:
    0 25px 70px rgba(30, 45, 40, 0.25);

  text-align: center;
}


.modal-icon {
  width: 52px;
  height: 52px;

  margin: 0 auto 18px;

  display: flex;

  align-items: center;
  justify-content: center;

  border-radius: 50%;

  background: #E0EBDD;

  color: #468585;
}


.modal-icon svg {
  width: 22px;
  height: 22px;

  fill: none;
}


.logout-modal h2 {
  margin: 0 0 10px;

  color: #468585;

  font-size: 26px;
}


.logout-modal p {
  margin: 0;

  color: #55716D;

  font-size: 15px;

  line-height: 1.6;
}


.modal-actions {
  display: flex;

  justify-content: center;

  gap: 12px;

  margin-top: 28px;
}


.cancel-button,
.confirm-logout-button {
  padding: 11px 22px;

  border-radius: 22px;

  font-family: inherit;

  font-size: 14px;
  font-weight: 600;

  cursor: pointer;

  transition: 0.2s ease;
}


.cancel-button {
  border: 1px solid rgba(70, 133, 133, 0.25);

  background: transparent;

  color: #468585;
}


.cancel-button:hover {
  background: #E0EBDD;
}


.confirm-logout-button {
  border: none;

  background: #468585;

  color: white;
}


.confirm-logout-button:hover {
  background: #50B498;

  transform: translateY(-1px);
}

/* Keep desktop authentication out of the mobile header. This rule is placed
   after the desktop auth styles so it wins the cascade. */
@media (max-width: 900px) {
  .auth-area {
    display: none;
  }
}
</style>
