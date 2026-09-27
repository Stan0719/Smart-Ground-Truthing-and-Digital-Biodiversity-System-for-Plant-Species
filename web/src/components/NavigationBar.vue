<script setup lang="ts">
import { ref } from 'vue'

const mobileMenuOpen = ref(false)

const closeMobileMenu = () => {
  mobileMenuOpen.value = false
}
</script>

<template>
  <header class="navbar">
    <div class="navbar-container">

      <!-- Logo -->
      <RouterLink to="/" class="logo" @click="closeMobileMenu">
        <div class="logo-icon">N</div>

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

      <!-- Login -->
      <RouterLink to="/login" class="login-button">
        Login
      </RouterLink>

      <!-- Mobile Menu Button -->
      <button
        class="menu-button"
        type="button"
        aria-label="Toggle navigation menu"
        @click="mobileMenuOpen = !mobileMenuOpen"
      >
        <span></span>
        <span></span>
        <span></span>
      </button>
    </div>

    <!-- Mobile Navigation -->
    <nav v-if="mobileMenuOpen" class="mobile-nav">

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

      <RouterLink
        to="/login"
        class="mobile-login-button"
        @click="closeMobileMenu"
      >
        Login
      </RouterLink>

    </nav>
  </header>
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
  width: min(1200px, 92%);
  min-height: 76px;

  margin: 0 auto;

  display: flex;
  align-items: center;
  justify-content: space-between;

  gap: 30px;
}

/* =========================
   Logo
   ========================= */

.logo {
  display: flex;
  align-items: center;

  gap: 10px;

  color: #468585;

  text-decoration: none;

  flex-shrink: 0;
}

.logo-icon {
  width: 42px;
  height: 42px;

  display: flex;
  align-items: center;
  justify-content: center;

  border-radius: 50%;

  background: #50B498;
  color: white;

  font-size: 20px;
  font-weight: 700;
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

  width: 42px;
  height: 42px;

  padding: 8px;

  border: none;
  border-radius: 8px;

  background: transparent;

  cursor: pointer;
}

.menu-button span {
  display: block;

  width: 24px;
  height: 2px;

  margin: 5px auto;

  background: #468585;
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

  .desktop-nav,
  .login-button {
    display: none;
  }

  .menu-button {
    display: block;
  }

  .mobile-nav {
    width: 100%;

    padding: 10px 4% 20px;

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

  .mobile-login-button {
    margin-top: 8px;

    padding: 12px;

    text-align: center;

    border-radius: 24px;

    background: #468585;
    color: white;

    text-decoration: none;

    font-weight: 600;
  }
}
</style>