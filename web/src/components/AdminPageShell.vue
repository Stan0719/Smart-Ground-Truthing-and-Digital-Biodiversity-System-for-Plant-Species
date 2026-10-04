<script setup lang="ts">
import { ref } from 'vue'

defineProps<{ title: string; eyebrow: string; active: string }>()

const sidebarOpen = ref(false)
const profileOpen = ref(false)

const items = [
  { label: 'Dashboard', icon: '⌂', to: '/admin' },
  { label: 'User Management', icon: '♙', to: '/admin/users' },
  { label: 'Role & Permission', icon: '◇', to: '/admin/roles' },
  { label: 'IoT Monitoring', icon: '⌁', to: '/admin/iot' },
  { label: 'Sensor Management', icon: '◉', to: '/admin/sensors' },
  { label: 'Threat Alerts', icon: '△', to: '/admin/alerts', count: 3 },
  { label: 'System Activity', icon: '↻', to: '/admin/activity' },
]
</script>

<template>
  <div class="admin-shell">
    <aside class="sidebar" :class="{ open: sidebarOpen }">
      <div class="brand"><img src="/images/logo.png" alt="Niah Biodiversity" /><div><strong>NIAH</strong><span>ADMINISTRATION</span></div></div>
      <p class="nav-label">MAIN MENU</p>
      <nav aria-label="Administrator navigation">
        <RouterLink v-for="item in items" :key="item.to" :to="item.to" :class="{ active: active === item.label }" @click="sidebarOpen = false">
          <span class="nav-icon">{{ item.icon }}</span><span>{{ item.label }}</span><i v-if="item.count">{{ item.count }}</i>
        </RouterLink>
      </nav>
      <div class="sidebar-footer"><RouterLink to="/">← View public website</RouterLink><button type="button"><span>↪</span> Logout</button></div>
    </aside>

    <button v-if="sidebarOpen" class="backdrop" type="button" aria-label="Close navigation" @click="sidebarOpen = false"></button>

    <div class="main-area">
      <header class="topbar">
        <button class="menu-button" type="button" aria-label="Open navigation" @click="sidebarOpen = true"><span></span><span></span><span></span></button>
        <div class="heading"><p>{{ eyebrow }}</p><h1>{{ title }}</h1></div>
        <div class="top-actions">
          <button class="notification" type="button" aria-label="Notifications"><svg viewBox="0 0 24 24"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" /></svg><span>3</span></button>
          <div class="profile-wrap">
            <button class="profile" type="button" @click="profileOpen = !profileOpen"><b>A</b><span><strong>Admin01</strong><small>Administrator</small></span><i>⌄</i></button>
            <div v-if="profileOpen" class="profile-menu"><button type="button">Profile settings</button><button type="button">Sign out</button></div>
          </div>
        </div>
      </header>
      <main class="page-content"><slot /></main>
    </div>
  </div>
</template>

<style scoped>
*{box-sizing:border-box}.admin-shell{min-height:100vh;display:grid;grid-template-columns:258px minmax(0,1fr);background:#f3f6f2;color:#29483e}.sidebar{position:sticky;top:0;z-index:100;height:100vh;padding:24px 16px;display:flex;flex-direction:column;background:#173f34;color:#fff}.brand{padding:0 8px 25px;display:flex;align-items:center;gap:11px;border-bottom:1px solid rgba(255,255,255,.12)}.brand img{width:44px;height:44px;border-radius:50%;object-fit:cover}.brand div{display:flex;flex-direction:column}.brand strong{font-size:18px;letter-spacing:2px}.brand div span{margin-top:3px;color:#9dd5ba;font-size:8px;font-weight:700;letter-spacing:1.5px}.nav-label{margin:25px 13px 9px;color:#75a392;font-size:9px;font-weight:800;letter-spacing:1.6px}.sidebar nav{display:grid;gap:5px}.sidebar nav a,.sidebar-footer button{width:100%;padding:11px 13px;display:flex;align-items:center;gap:11px;border:0;border-radius:9px;background:transparent;color:#bfd7cd;cursor:pointer;font:inherit;font-size:13px;font-weight:600;text-align:left;text-decoration:none;transition:.2s}.sidebar nav a:hover,.sidebar nav a.active{background:#2b6754;color:#fff}.nav-icon{width:21px;text-align:center;font-size:18px}.sidebar nav i{margin-left:auto;width:21px;height:21px;display:grid;place-items:center;border-radius:50%;background:#c95c4a;color:#fff;font-size:10px;font-style:normal}.sidebar-footer{margin-top:auto;padding-top:16px;border-top:1px solid rgba(255,255,255,.1);display:grid;gap:5px}.sidebar-footer a{padding:10px 13px;color:#96c3b1;font-size:12px;font-weight:600;text-decoration:none}.sidebar-footer button span{width:21px;text-align:center;font-size:18px}.main-area{min-width:0}.topbar{position:sticky;top:0;z-index:80;min-height:82px;padding:0 3.5%;display:flex;align-items:center;justify-content:space-between;gap:20px;border-bottom:1px solid #dce4dc;background:rgba(255,255,255,.93);backdrop-filter:blur(12px)}.heading p{margin:0 0 3px;color:#62a087;font-size:9px;font-weight:800;letter-spacing:1.8px}.heading h1{margin:0;color:#204c3d;font-size:23px}.top-actions{display:flex;align-items:center;gap:12px}.notification{position:relative;width:39px;height:39px;display:grid;place-items:center;border:1px solid #dfe6df;border-radius:11px;background:#fff;color:#527066}.notification svg{width:19px;fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.8}.notification>span{position:absolute;top:-5px;right:-5px;width:18px;height:18px;display:grid;place-items:center;border:2px solid #fff;border-radius:50%;background:#c95845;color:#fff;font-size:8px;font-weight:800}.profile-wrap{position:relative}.profile{padding:5px;display:flex;align-items:center;gap:9px;border:1px solid transparent;border-radius:11px;background:transparent;color:#29483e}.profile:hover{border-color:#dfe6df;background:#f8faf7}.profile b{width:37px;height:37px;display:grid;place-items:center;border-radius:10px;background:#33745d;color:#fff}.profile>span{display:flex;flex-direction:column;align-items:flex-start}.profile strong{font-size:12px}.profile small{color:#82918b;font-size:9px}.profile i{color:#7a8b84;font-style:normal}.profile-menu{position:absolute;top:52px;right:0;width:155px;padding:7px;border:1px solid #e1e6e1;border-radius:10px;background:#fff;box-shadow:0 12px 30px rgba(28,65,51,.13)}.profile-menu button{width:100%;padding:9px;border:0;border-radius:6px;background:transparent;color:#425e54;font:inherit;font-size:11px;text-align:left}.profile-menu button:hover{background:#edf3ed}.page-content{width:min(1400px,94%);margin:0 auto;padding:32px 0 60px}.menu-button{display:none}.backdrop{display:none}
@media(max-width:820px){.admin-shell{grid-template-columns:1fr}.sidebar{position:fixed;left:0;width:258px;transform:translateX(-100%);transition:transform .25s}.sidebar.open{transform:translateX(0)}.backdrop{position:fixed;inset:0;z-index:90;display:block;border:0;background:rgba(12,35,27,.5)}.topbar{justify-content:flex-start}.menu-button{width:39px;height:39px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;border:1px solid #dfe6df;border-radius:9px;background:#fff}.menu-button span{width:18px;height:2px;background:#376354}.top-actions{margin-left:auto}}
@media(max-width:540px){.topbar{min-height:72px;padding:0 4%}.heading p,.profile>span,.profile i{display:none}.heading h1{font-size:17px}.page-content{width:91%;padding-top:23px}.profile{padding:2px}.profile b{width:35px;height:35px}}
</style>
