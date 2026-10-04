<script setup lang="ts">
import { computed, ref } from 'vue'

type UserStatus = 'Active' | 'Inactive' | 'Suspended'
type UserRole = 'Administrator' | 'Conservation Officer' | 'Botanist'

interface UserRecord {
  id: string
  name: string
  email: string
  role: UserRole
  status: UserStatus
  lastLogin: string
  initials: string
}

const sidebarOpen = ref(false)
const addUserOpen = ref(false)
const search = ref('')
const roleFilter = ref('All roles')
const statusFilter = ref('All statuses')

const users = ref<UserRecord[]>([
  {
    id: 'USR001',
    name: 'Aina Rahman',
    email: 'aina@niah.my',
    role: 'Administrator',
    status: 'Active',
    lastLogin: 'Today, 9:42 AM',
    initials: 'AR',
  },
  {
    id: 'USR002',
    name: 'Daniel Lee',
    email: 'daniel@niah.my',
    role: 'Administrator',
    status: 'Active',
    lastLogin: 'Today, 8:15 AM',
    initials: 'DL',
  },
  {
    id: 'USR003',
    name: 'Nur Izzati',
    email: 'izzati@niah.my',
    role: 'Conservation Officer',
    status: 'Active',
    lastLogin: 'Yesterday, 4:30 PM',
    initials: 'NI',
  },
  {
    id: 'USR004',
    name: 'Michael Jawan',
    email: 'michael@niah.my',
    role: 'Conservation Officer',
    status: 'Active',
    lastLogin: 'Yesterday, 2:18 PM',
    initials: 'MJ',
  },
  {
    id: 'USR005',
    name: 'Siti Hajar',
    email: 'siti@niah.my',
    role: 'Botanist',
    status: 'Active',
    lastLogin: '29 Sep, 11:05 AM',
    initials: 'SH',
  },
  {
    id: 'USR006',
    name: 'Kelvin Ting',
    email: 'kelvin@niah.my',
    role: 'Botanist',
    status: 'Inactive',
    lastLogin: '25 Sep, 3:20 PM',
    initials: 'KT',
  },
  {
    id: 'USR007',
    name: 'Farah Nabila',
    email: 'farah@niah.my',
    role: 'Botanist',
    status: 'Suspended',
    lastLogin: '18 Sep, 10:10 AM',
    initials: 'FN',
  },
])

const filteredUsers = computed(() => {
  const query = search.value.trim().toLowerCase()
  return users.value.filter((user) => {
    const matchesSearch =
      !query ||
      [user.id, user.name, user.email, user.role].some((value) =>
        value.toLowerCase().includes(query),
      )
    const matchesRole = roleFilter.value === 'All roles' || user.role === roleFilter.value
    const matchesStatus =
      statusFilter.value === 'All statuses' || user.status === statusFilter.value
    return matchesSearch && matchesRole && matchesStatus
  })
})

const closeSidebar = () => {
  sidebarOpen.value = false
}
const clearFilters = () => {
  search.value = ''
  roleFilter.value = 'All roles'
  statusFilter.value = 'All statuses'
}
</script>

<template>
  <div class="admin-layout">
    <aside class="sidebar" :class="{ open: sidebarOpen }">
      <div class="brand">
        <img src="/images/logo.png" alt="Niah Biodiversity" />
        <div><strong>NIAH</strong><span>ADMINISTRATION</span></div>
      </div>
      <p class="nav-label">MAIN MENU</p>
      <nav aria-label="Administrator navigation">
        <RouterLink to="/admin" @click="closeSidebar"><span>⌂</span> Dashboard</RouterLink>
        <RouterLink to="/admin/users" class="active" @click="closeSidebar"
          ><span>♙</span> User Management</RouterLink
        >
        <button type="button"><span>◇</span> Role &amp; Permission</button>
        <button type="button"><span>⌁</span> IoT Monitoring</button>
        <button type="button"><span>◉</span> Sensor Management</button>
        <button type="button"><span>△</span> Threat Alerts <i>3</i></button>
        <button type="button"><span>↻</span> System Activity</button>
      </nav>
      <div class="sidebar-footer">
        <RouterLink to="/">← View public website</RouterLink
        ><button type="button"><span>↪</span> Logout</button>
      </div>
    </aside>

    <button
      v-if="sidebarOpen"
      class="backdrop"
      type="button"
      aria-label="Close navigation"
      @click="closeSidebar"
    ></button>

    <div class="main-area">
      <header class="topbar">
        <button
          class="menu-button"
          type="button"
          aria-label="Open navigation"
          @click="sidebarOpen = true"
        >
          <span></span><span></span><span></span>
        </button>
        <div>
          <p>ADMINISTRATION</p>
          <h1>User Management</h1>
        </div>
        <div class="admin-profile">
          <span>A</span>
          <div><strong>Admin01</strong><small>Administrator</small></div>
        </div>
      </header>

      <main class="content">
        <section class="page-intro">
          <div>
            <h2>Manage system users</h2>
            <p>View accounts, assign access roles, and manage user status.</p>
          </div>
          <button class="primary-button" type="button" @click="addUserOpen = true">
            <span>＋</span> Add New User
          </button>
        </section>

        <section class="stats-grid" aria-label="User summary">
          <article>
            <span class="stat-icon">♙</span>
            <div>
              <p>Total Users</p>
              <strong>18</strong><small>All registered accounts</small>
            </div>
          </article>
          <article>
            <span class="stat-icon active-icon">✓</span>
            <div>
              <p>Active Users</p>
              <strong>16</strong><small>88.9% of accounts</small>
            </div>
          </article>
          <article>
            <span class="stat-icon officer-icon">◇</span>
            <div>
              <p>Officers</p>
              <strong>5</strong><small>Conservation officers</small>
            </div>
          </article>
          <article>
            <span class="stat-icon botanist-icon">♧</span>
            <div>
              <p>Botanists</p>
              <strong>10</strong><small>Research accounts</small>
            </div>
          </article>
        </section>

        <section class="users-panel">
          <div class="panel-heading">
            <div>
              <p>ACCOUNT DIRECTORY</p>
              <h2>All Users</h2>
            </div>
            <span>{{ filteredUsers.length }} records shown</span>
          </div>

          <div class="filters">
            <label class="search-box"
              ><svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="10.5" cy="10.5" r="6.5" />
                <path d="m15.5 15.5 5 5" /></svg
              ><span class="sr-only">Search users</span
              ><input
                v-model="search"
                type="search"
                placeholder="Search name, email, ID or role..."
            /></label>
            <select v-model="roleFilter" aria-label="Filter by role">
              <option>All roles</option>
              <option>Administrator</option>
              <option>Conservation Officer</option>
              <option>Botanist</option>
            </select>
            <select v-model="statusFilter" aria-label="Filter by status">
              <option>All statuses</option>
              <option>Active</option>
              <option>Inactive</option>
              <option>Suspended</option>
            </select>
            <button class="clear-button" type="button" @click="clearFilters">Clear</button>
          </div>

          <div v-if="filteredUsers.length" class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>User ID</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last Login</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="user in filteredUsers" :key="user.id">
                  <td>
                    <div class="user-cell">
                      <span>{{ user.initials }}</span>
                      <div>
                        <strong>{{ user.name }}</strong
                        ><small>{{ user.email }}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <code>{{ user.id }}</code>
                  </td>
                  <td>
                    <span class="role-badge" :class="user.role.toLowerCase().replace(' ', '-')">{{
                      user.role
                    }}</span>
                  </td>
                  <td>
                    <span class="status-badge" :class="user.status.toLowerCase()"
                      ><i></i>{{ user.status }}</span
                    >
                  </td>
                  <td>{{ user.lastLogin }}</td>
                  <td>
                    <div class="row-actions">
                      <button type="button" title="View user">View</button
                      ><button type="button" title="More actions" aria-label="More actions">
                        •••
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="empty-state">
            <span>♙</span>
            <h3>No users found</h3>
            <p>Try changing or clearing your filters.</p>
            <button type="button" @click="clearFilters">Clear filters</button>
          </div>
        </section>
      </main>
    </div>

    <div v-if="addUserOpen" class="modal-backdrop" @click.self="addUserOpen = false">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="add-user-title">
        <div class="modal-heading">
          <div>
            <p>NEW ACCOUNT</p>
            <h2 id="add-user-title">Add New User</h2>
          </div>
          <button type="button" aria-label="Close" @click="addUserOpen = false">×</button>
        </div>
        <form @submit.prevent="addUserOpen = false">
          <label>Full name<input type="text" placeholder="Enter full name" required /></label>
          <label>Email address<input type="email" placeholder="name@example.com" required /></label>
          <div class="form-row">
            <label
              >Role<select required>
                <option value="" disabled selected>Select role</option>
                <option>Administrator</option>
                <option>Conservation Officer</option>
                <option>Botanist</option>
              </select></label
            ><label
              >Account status<select>
                <option>Active</option>
                <option>Inactive</option>
              </select></label
            >
          </div>
          <label
            >Temporary password<input
              type="password"
              placeholder="Enter temporary password"
              required
          /></label>
          <p class="form-note">This prototype form does not save data to a database.</p>
          <div class="modal-actions">
            <button type="button" @click="addUserOpen = false">Cancel</button
            ><button class="primary-button" type="submit">Create User</button>
          </div>
        </form>
      </section>
    </div>
  </div>
</template>

<style scoped>
* {
  box-sizing: border-box;
}
.admin-layout {
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
.brand span {
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
.sidebar nav button,
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
}
.sidebar nav a:hover,
.sidebar nav button:hover,
.sidebar nav a.active {
  background: #2b6754;
  color: #fff;
}
.sidebar nav span,
.sidebar-footer span {
  width: 21px;
  text-align: center;
  font-size: 18px;
}
.sidebar nav i {
  margin-left: auto;
  width: 21px;
  height: 21px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #c95c4a;
  color: #fff;
  font-size: 10px;
  font-style: normal;
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
  border-bottom: 1px solid #dce4dc;
  background: rgba(255, 255, 255, 0.93);
  backdrop-filter: blur(12px);
}
.topbar p {
  margin: 0 0 3px;
  color: #62a087;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 1.8px;
}
.topbar h1 {
  margin: 0;
  color: #204c3d;
  font-size: 23px;
}
.admin-profile {
  display: flex;
  align-items: center;
  gap: 9px;
}
.admin-profile > span {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: #33745d;
  color: #fff;
  font-weight: 800;
}
.admin-profile div {
  display: flex;
  flex-direction: column;
}
.admin-profile strong {
  font-size: 12px;
}
.admin-profile small {
  color: #82918b;
  font-size: 9px;
}
.menu-button {
  display: none;
}
.content {
  width: min(1400px, 94%);
  margin: 0 auto;
  padding: 32px 0 60px;
}
.page-intro {
  margin-bottom: 23px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}
.page-intro h2 {
  margin: 0 0 5px;
  color: #204b3c;
  font-size: 22px;
}
.page-intro p {
  margin: 0;
  color: #78877f;
  font-size: 13px;
}
.primary-button {
  padding: 11px 16px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 0;
  border-radius: 9px;
  background: #32745b;
  color: #fff;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  box-shadow: 0 5px 13px rgba(50, 116, 91, 0.18);
}
.primary-button:hover {
  background: #28664f;
}
.primary-button span {
  font-size: 17px;
}
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
}
.stats-grid article {
  padding: 19px;
  display: flex;
  align-items: flex-start;
  gap: 13px;
  border: 1px solid #e0e7df;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 6px 18px rgba(35, 70, 53, 0.045);
}
.stat-icon {
  width: 39px;
  height: 39px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: #e5efe8;
  color: #3c7a61;
  font-size: 19px;
}
.active-icon {
  background: #dff2e6;
  color: #2b855a;
}
.officer-icon {
  background: #e4edf4;
  color: #477b9c;
}
.botanist-icon {
  background: #f0ebdc;
  color: #8b753a;
}
.stats-grid p {
  margin: 0 0 4px;
  color: #71817a;
  font-size: 10px;
  font-weight: 700;
}
.stats-grid strong {
  display: block;
  color: #274e40;
  font-size: 25px;
  line-height: 1;
}
.stats-grid small {
  display: block;
  margin-top: 6px;
  color: #93a099;
  font-size: 9px;
}
.users-panel {
  margin-top: 18px;
  padding: 23px;
  border: 1px solid #e0e7df;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 7px 22px rgba(35, 70, 53, 0.045);
}
.panel-heading {
  margin-bottom: 19px;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
}
.panel-heading p,
.modal-heading p {
  margin: 0 0 5px;
  color: #58a07f;
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 1.7px;
}
.panel-heading h2,
.modal-heading h2 {
  margin: 0;
  color: #254c3e;
  font-size: 18px;
}
.panel-heading > span {
  color: #87958f;
  font-size: 9px;
}
.filters {
  margin-bottom: 18px;
  display: grid;
  grid-template-columns: minmax(250px, 1fr) 190px 170px auto;
  gap: 10px;
}
.search-box {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 12px;
  border: 1px solid #dce4dc;
  border-radius: 9px;
  background: #f9fbf8;
}
.search-box:focus-within {
  border-color: #62a087;
  box-shadow: 0 0 0 3px rgba(98, 160, 135, 0.12);
}
.search-box svg {
  width: 17px;
  fill: none;
  stroke: #678178;
  stroke-width: 1.8;
  stroke-linecap: round;
}
.search-box input {
  width: 100%;
  padding: 10px 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: #36574b;
  font: inherit;
  font-size: 10px;
}
.filters select {
  padding: 0 11px;
  border: 1px solid #dce4dc;
  border-radius: 9px;
  outline: 0;
  background: #f9fbf8;
  color: #526a60;
  font: inherit;
  font-size: 10px;
}
.clear-button {
  padding: 0 13px;
  border: 1px solid #dce4dc;
  border-radius: 9px;
  background: #fff;
  color: #668077;
  cursor: pointer;
  font: inherit;
  font-size: 10px;
  font-weight: 700;
}
.table-scroll {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  white-space: nowrap;
}
th {
  padding: 11px 12px;
  border-bottom: 1px solid #dfe7df;
  background: #f7f9f6;
  color: #829088;
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.6px;
  text-align: left;
  text-transform: uppercase;
}
td {
  padding: 13px 12px;
  border-bottom: 1px solid #edf0ed;
  color: #617169;
  font-size: 10px;
}
tbody tr:last-child td {
  border-bottom: 0;
}
.user-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}
.user-cell > span {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 9px;
  background: #dfece3;
  color: #337258;
  font-size: 10px;
  font-weight: 800;
}
.user-cell div {
  display: flex;
  flex-direction: column;
}
.user-cell strong {
  color: #315749;
  font-size: 10px;
}
.user-cell small {
  margin-top: 2px;
  color: #899790;
  font-size: 8px;
}
code {
  padding: 4px 7px;
  border-radius: 5px;
  background: #eff3ef;
  color: #49675b;
  font-family: inherit;
  font-size: 9px;
}
.role-badge,
.status-badge {
  padding: 5px 8px;
  border-radius: 999px;
  font-size: 8px;
  font-weight: 800;
}
.administrator {
  background: #e5e9f5;
  color: #5b65a0;
}
.conservation-officer {
  background: #ddf0e7;
  color: #31775c;
}
.botanist {
  background: #f3ecd9;
  color: #876b26;
}
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.status-badge i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
}
.status-badge.active {
  background: #dff1e6;
  color: #287a53;
}
.status-badge.inactive {
  background: #ebeeec;
  color: #66716c;
}
.status-badge.suspended {
  background: #f8e1dd;
  color: #b84b3a;
}
.row-actions {
  display: flex;
  gap: 6px;
}
.row-actions button {
  padding: 5px 9px;
  border: 1px solid #d7e1d8;
  border-radius: 6px;
  background: #fff;
  color: #3d7862;
  cursor: pointer;
  font: inherit;
  font-size: 9px;
  font-weight: 700;
}
.empty-state {
  padding: 60px 20px;
  text-align: center;
}
.empty-state > span {
  font-size: 36px;
  color: #7ba08e;
}
.empty-state h3 {
  margin: 10px 0 5px;
  color: #315648;
}
.empty-state p {
  margin: 0 0 17px;
  color: #829088;
  font-size: 11px;
}
.empty-state button {
  padding: 8px 13px;
  border: 0;
  border-radius: 7px;
  background: #36775e;
  color: #fff;
  font: inherit;
  font-size: 10px;
}
.backdrop {
  display: none;
}
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  padding: 20px;
  display: grid;
  place-items: center;
  background: rgba(14, 39, 30, 0.56);
  backdrop-filter: blur(3px);
}
.modal {
  width: min(500px, 100%);
  padding: 25px;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 25px 70px rgba(16, 49, 37, 0.24);
}
.modal-heading {
  margin-bottom: 22px;
  display: flex;
  justify-content: space-between;
}
.modal-heading > button {
  width: 31px;
  height: 31px;
  border: 0;
  border-radius: 8px;
  background: #eef2ee;
  color: #60746b;
  cursor: pointer;
  font-size: 19px;
}
.modal form {
  display: grid;
  gap: 15px;
}
.modal label {
  display: grid;
  gap: 6px;
  color: #4a645a;
  font-size: 10px;
  font-weight: 700;
}
.modal input,
.modal select {
  width: 100%;
  padding: 10px 11px;
  border: 1px solid #dce4dc;
  border-radius: 8px;
  outline: 0;
  background: #fafcfa;
  color: #355448;
  font: inherit;
  font-size: 10px;
}
.modal input:focus,
.modal select:focus {
  border-color: #62a087;
  box-shadow: 0 0 0 3px rgba(98, 160, 135, 0.12);
}
.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.form-note {
  margin: 0;
  padding: 10px;
  border-radius: 7px;
  background: #f1f5f1;
  color: #71827a;
  font-size: 9px;
}
.modal-actions {
  margin-top: 5px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.modal-actions > button:not(.primary-button) {
  padding: 10px 15px;
  border: 1px solid #dce4dc;
  border-radius: 8px;
  background: #fff;
  color: #60746b;
  cursor: pointer;
  font: inherit;
  font-size: 10px;
  font-weight: 700;
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
@media (max-width: 1050px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .filters {
    grid-template-columns: 1fr 1fr;
  }
  .search-box {
    grid-column: 1/-1;
  }
}
@media (max-width: 820px) {
  .admin-layout {
    grid-template-columns: 1fr;
  }
  .sidebar {
    position: fixed;
    left: 0;
    width: 258px;
    transform: translateX(-100%);
    transition: transform 0.25s ease;
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
    gap: 15px;
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
  .admin-profile {
    margin-left: auto;
  }
}
@media (max-width: 560px) {
  .topbar {
    min-height: 72px;
    padding: 0 4%;
  }
  .topbar p,
  .admin-profile div {
    display: none;
  }
  .topbar h1 {
    font-size: 17px;
  }
  .content {
    width: 91%;
    padding-top: 23px;
  }
  .page-intro {
    align-items: flex-start;
    flex-direction: column;
  }
  .stats-grid {
    grid-template-columns: 1fr;
  }
  .filters {
    grid-template-columns: 1fr;
  }
  .search-box {
    grid-column: auto;
  }
  .filters select,
  .clear-button {
    min-height: 39px;
  }
  .users-panel {
    padding: 16px;
  }
  .form-row {
    grid-template-columns: 1fr;
  }
}
</style>
