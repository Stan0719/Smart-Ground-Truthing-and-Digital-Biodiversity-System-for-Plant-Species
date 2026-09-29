<script setup lang="ts">
import { ref } from 'vue'

const sidebarOpen = ref(false)

const navigationItems = [
  { label: 'Overview', icon: 'grid' },
  { label: 'Plants', icon: 'leaf' },
  { label: 'Users', icon: 'users' },
  { label: 'Content', icon: 'file' },
  { label: 'Settings', icon: 'settings' },
]

const activeSection = ref('Overview')

const selectSection = (section: string) => {
  activeSection.value = section
  sidebarOpen.value = false
}
</script>

<template>
  <div class="admin-shell">
    <aside class="admin-sidebar" :class="{ open: sidebarOpen }">
      <div class="admin-brand">
        <img src="/images/logo.png" alt="Niah Biodiversity" />
        <div>
          <strong>NIAH</strong>
          <span>ADMIN PORTAL</span>
        </div>
      </div>

      <nav aria-label="Admin navigation">
        <button
          v-for="item in navigationItems"
          :key="item.label"
          type="button"
          :class="{ active: activeSection === item.label }"
          @click="selectSection(item.label)"
        >
          <svg v-if="item.icon === 'grid'" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          <svg v-else-if="item.icon === 'leaf'" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 4C10 4 5 9 5 16c5-4 9-6 13-8-5 3-9 7-11 12" />
          </svg>
          <svg v-else-if="item.icon === 'users'" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="9" cy="8" r="3" /><path d="M3 20c0-4 2-6 6-6s6 2 6 6" /><path d="M16 5a3 3 0 0 1 0 6M17 14c3 .4 4 2.4 4 6" />
          </svg>
          <svg v-else-if="item.icon === 'file'" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 13h6M9 17h6" />
          </svg>
          <svg v-else viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="3" /><path d="M19 13.5v-3l-2-.7-.7-1.7.9-1.9-2.1-2.1-1.9.9-1.7-.7L10.5 2h-3l-.7 2.3-1.7.7-1.9-.9-2.1 2.1.9 1.9-.7 1.7-2 .7v3l2 .7.7 1.7-.9 1.9 2.1 2.1 1.9-.9 1.7.7.7 2.3h3l.7-2.3 1.7-.7 1.9.9 2.1-2.1-.9-1.9.7-1.7z" />
          </svg>
          <span>{{ item.label }}</span>
        </button>
      </nav>

      <RouterLink to="/" class="view-site">← View public website</RouterLink>
    </aside>

    <button
      v-if="sidebarOpen"
      class="sidebar-backdrop"
      type="button"
      aria-label="Close admin navigation"
      @click="sidebarOpen = false"
    ></button>

    <div class="admin-main">
      <header class="admin-header">
        <button
          class="menu-toggle"
          type="button"
          aria-label="Open admin navigation"
          @click="sidebarOpen = true"
        >
          <span></span><span></span><span></span>
        </button>

        <div>
          <p>ADMIN DASHBOARD</p>
          <h1>{{ activeSection }}</h1>
        </div>

        <div class="admin-profile">
          <span>A</span>
          <div>
            <strong>Administrator</strong>
            <small>Admin account</small>
          </div>
        </div>
      </header>

      <main class="dashboard-content">
        <section class="welcome-card">
          <div>
            <p class="eyebrow">NIAH BIODIVERSITY SYSTEM</p>
            <h2>Admin dashboard is ready</h2>
            <p>
              This is the initial admin-only workspace. The final modules, content, and
              visual layout can be added when your dashboard design is ready.
            </p>
          </div>
          <div class="placeholder-mark" aria-hidden="true">🌿</div>
        </section>

        <section class="placeholder-grid" aria-label="Dashboard placeholders">
          <article>
            <span>01</span>
            <h3>Plant management</h3>
            <p>Add, update, review, and organise plant records.</p>
          </article>
          <article>
            <span>02</span>
            <h3>User management</h3>
            <p>Manage administrator and visitor accounts.</p>
          </article>
          <article>
            <span>03</span>
            <h3>Website content</h3>
            <p>Prepare and maintain public website information.</p>
          </article>
        </section>

        <section class="design-placeholder">
          <div class="placeholder-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 5h16v14H4zM4 9h16M9 9v10" />
            </svg>
          </div>
          <h2>Dashboard layout placeholder</h2>
          <p>Your completed admin design can be implemented in this area later.</p>
        </section>
      </main>
    </div>
  </div>
</template>

<style scoped>
.admin-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr);
  background: #f4f6f1;
  color: #345048;
}

.admin-sidebar {
  position: sticky;
  top: 0;
  height: 100vh;
  box-sizing: border-box;
  padding: 24px 18px;
  display: flex;
  flex-direction: column;
  background: #183e34;
  color: #fff;
}

.admin-brand {
  padding: 0 8px 28px;
  display: flex;
  align-items: center;
  gap: 11px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}

.admin-brand img {
  width: 43px;
  height: 43px;
  border-radius: 50%;
  object-fit: cover;
}

.admin-brand div {
  display: flex;
  flex-direction: column;
}

.admin-brand strong {
  font-size: 17px;
  letter-spacing: 2px;
}

.admin-brand span {
  margin-top: 3px;
  color: #9cd5b5;
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 1.7px;
}

.admin-sidebar nav {
  margin-top: 28px;
  display: grid;
  gap: 7px;
}

.admin-sidebar nav button {
  width: 100%;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 12px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: #cce0d7;
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  text-align: left;
}

.admin-sidebar nav button:hover,
.admin-sidebar nav button.active {
  background: #2e6553;
  color: #fff;
}

.admin-sidebar nav svg {
  width: 19px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.view-site {
  margin-top: auto;
  padding: 12px 14px;
  color: #b8d5c7;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
}

.admin-main {
  min-width: 0;
}

.admin-header {
  min-height: 88px;
  padding: 0 4%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  border-bottom: 1px solid #dce3da;
  background: rgba(255, 255, 255, 0.82);
}

.admin-header p {
  margin: 0 0 3px;
  color: #71a18e;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 2px;
}

.admin-header h1 {
  margin: 0;
  color: #244c3f;
  font-size: 24px;
}

.admin-profile {
  display: flex;
  align-items: center;
  gap: 10px;
}

.admin-profile > span {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #43836c;
  color: #fff;
  font-weight: 800;
}

.admin-profile div {
  display: flex;
  flex-direction: column;
}

.admin-profile strong {
  color: #31584b;
  font-size: 13px;
}

.admin-profile small {
  color: #86938d;
  font-size: 10px;
}

.menu-toggle {
  display: none;
}

.dashboard-content {
  width: min(1160px, 92%);
  margin: 0 auto;
  padding: 42px 0 70px;
}

.welcome-card {
  padding: 38px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 30px;
  border-radius: 20px;
  background: linear-gradient(130deg, #285b4b, #477f67);
  color: #fff;
  box-shadow: 0 18px 40px rgba(31, 76, 60, 0.14);
}

.eyebrow {
  margin: 0 0 10px;
  color: #b9e1c9;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 2.2px;
}

.welcome-card h2 {
  margin: 0 0 10px;
  font-size: clamp(28px, 4vw, 40px);
}

.welcome-card p:last-child {
  max-width: 650px;
  margin: 0;
  color: #dbeae3;
  font-size: 14px;
  line-height: 1.7;
}

.placeholder-mark {
  font-size: 72px;
}

.placeholder-grid {
  margin-top: 26px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}

.placeholder-grid article {
  padding: 26px;
  border: 1px solid #e0e5dd;
  border-radius: 16px;
  background: #fff;
}

.placeholder-grid span {
  color: #80a997;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 1.5px;
}

.placeholder-grid h3 {
  margin: 14px 0 8px;
  color: #2c5547;
  font-size: 18px;
}

.placeholder-grid p {
  margin: 0;
  color: #75837c;
  font-size: 13px;
  line-height: 1.6;
}

.design-placeholder {
  min-height: 260px;
  margin-top: 26px;
  padding: 30px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 2px dashed #cbd7cc;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.48);
  text-align: center;
}

.placeholder-icon {
  width: 52px;
  height: 52px;
  display: grid;
  place-items: center;
  border-radius: 14px;
  background: #dfeae0;
  color: #4f7b64;
}

.placeholder-icon svg {
  width: 25px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.design-placeholder h2 {
  margin: 17px 0 7px;
  color: #33594c;
  font-size: 20px;
}

.design-placeholder p {
  margin: 0;
  color: #7b8982;
  font-size: 13px;
}

.sidebar-backdrop {
  display: none;
}

@media (max-width: 820px) {
  .admin-shell {
    grid-template-columns: 1fr;
  }

  .admin-sidebar {
    position: fixed;
    left: 0;
    z-index: 1200;
    width: 250px;
    transform: translateX(-100%);
    transition: transform 0.25s ease;
  }

  .admin-sidebar.open {
    transform: translateX(0);
  }

  .sidebar-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1100;
    display: block;
    border: 0;
    background: rgba(13, 31, 24, 0.5);
  }

  .admin-header {
    justify-content: flex-start;
  }

  .menu-toggle {
    width: 40px;
    height: 40px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    border: 0;
    border-radius: 9px;
    background: #e7eee6;
  }

  .menu-toggle span {
    width: 19px;
    height: 2px;
    background: #31584b;
  }

  .admin-profile {
    margin-left: auto;
  }

  .placeholder-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 520px) {
  .admin-header {
    min-height: 76px;
  }

  .admin-header p,
  .admin-profile div {
    display: none;
  }

  .admin-header h1 {
    font-size: 20px;
  }

  .dashboard-content {
    padding-top: 25px;
  }

  .welcome-card {
    padding: 28px;
  }

  .placeholder-mark {
    display: none;
  }
}
</style>
