<script setup lang="ts">

import { ref } from 'vue'
import LoginModal from './LoginModal.vue'

const mobileMenuOpen = ref(false)

const loginModalOpen = ref(false)

const logoutModalOpen = ref(false)

const isLoggedIn = ref(false)

const username = ref('Admin')


const closeMobileMenu = () => {

  mobileMenuOpen.value = false

}

const toggleMobileMenu = () => {
  mobileMenuOpen.value = !mobileMenuOpen.value
}


const openLoginModal = () => {
  mobileMenuOpen.value = false
  loginModalOpen.value = true

}

const handleLogin = (loggedInUsername: string) => {
  username.value = loggedInUsername
  isLoggedIn.value = true
  loginModalOpen.value = false
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

  logoutModalOpen.value = false

}

</script>

<template>
  <header class="navbar">
    <div class="navbar-container">

      <!-- Logo -->
      <RouterLink to="/" class="logo" @click="closeMobileMenu">
        <img
          src="/images/logo.png"
          alt="Niah Biodiversity Logo"
          class="logo-image"
        />

        <div class="logo-text">
          <span class="logo-title">NIAH</span>
          <span class="logo-subtitle">BIODIVERSITY</span>
        </div>
      </RouterLink>

      <!-- Desktop Navigation -->
      <nav class="desktop-nav">
        <RouterLink to="/" class="nav-link">
          Home
        </RouterLink>

        <RouterLink to="/plants" class="nav-link">
          Explore Plants
        </RouterLink>

        <RouterLink to="/about" class="nav-link">
          About Niah
        </RouterLink>

        <RouterLink to="/search" class="nav-link">
          Search
        </RouterLink>
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

      <nav
        id="mobile-navigation"
        v-if="mobileMenuOpen"
        class="mobile-nav"
        aria-label="Mobile navigation"
      >

        <RouterLink
          to="/"
          class="mobile-nav-link"
          @click="closeMobileMenu"
        >
          Home
        </RouterLink>

        <RouterLink
          to="/plants"
          class="mobile-nav-link"
          @click="closeMobileMenu"
        >
          Explore Plants
        </RouterLink>

        <RouterLink
          to="/about"
          class="mobile-nav-link"
          @click="closeMobileMenu"
        >
          About Niah
        </RouterLink>

        <RouterLink
          to="/search"
          class="mobile-nav-link"
          @click="closeMobileMenu"
        >
          Search
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
  border-radius: 50%;
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

  gap: 28px;
}

.nav-link {
  position: relative;

  color: #468585;

  text-decoration: none;

  font-size: 14px;
  font-weight: 600;

  transition: color 0.2s ease;
}

.nav-link::after {
  content: '';

  position: absolute;

  left: 0;
  bottom: -7px;

  width: 0;
  height: 2px;

  background: #50B498;

  transition: width 0.2s ease;
}

.nav-link:hover {
  color: #50B498;
}

.nav-link:hover::after,
.nav-link.router-link-active::after {
  width: 100%;
}

.nav-link.router-link-active {
  color: #50B498;
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
    width: 100%;

    padding: 10px 0 20px;

    display: flex;
    flex-direction: column;

    gap: 4px;

    background: #E0EBDD;

    border-top: 1px solid rgba(70, 133, 133, 0.1);
  }

  .mobile-nav-link {
    padding: 13px 10px;

    color: #468585;

    text-decoration: none;

    font-size: 15px;
    font-weight: 600;

    border-radius: 8px;
  }

  .mobile-nav-link:hover {
    background: #DEF9C4;
  }

  .mobile-nav-divider {
    width: 100%;
    height: 1px;
    margin: 10px 0 8px;
    background: rgba(70, 133, 133, 0.2);
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

    background: #468585;

    color: white;

    font-family: inherit;

    font-size: 15px;
    font-weight: 600;

    cursor: pointer;

    transition: background 0.2s ease, transform 0.2s ease;
  }

  .mobile-login-button:hover,
  .mobile-logout-button:hover {
    background: #50B498;
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
    background: rgba(70, 133, 133, 0.1);
    color: #405F5B;
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
