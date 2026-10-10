<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import AdminNotificationBell from '../components/AdminNotificationBell.vue'
import { useAdminSidebar } from '../composables/useAdminSidebar'
import { sendTemporaryPasswordEmail } from '../services/accountEmail'
import {
  createPrototypeUser,
  deletePrototypeVisitor,
  deletePrototypeUser,
  findPrototypeUserByEmail,
  getPrototypeUsers,
  getPrototypeVisitors,
  updatePrototypeVisitor,
  updatePrototypeUser,
  type PrototypeRole,
  type PrototypeUser,
} from '../data/prototypeAuth'

type UserStatus = 'Active' | 'Inactive' | 'Suspended'
type UserRole = 'Administrator' | 'Conservation Officer' | 'Botanist' | 'Visitor'

const router = useRouter()

interface UserRecord {
  id: string
  name: string
  email: string
  role: UserRole
  status: UserStatus
  lastLogin: string
  initials: string
}

const { sidebarOpen, isMobile, openSidebar, closeSidebar, handleNavigation } = useAdminSidebar()
const addUserOpen = ref(false)
const search = ref('')
const roleFilter = ref('All roles')
const statusFilter = ref('All statuses')
const USER_DIRECTORY_KEY = 'niahAdminUserDirectory'

const existingUsers: UserRecord[] = [
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
]

const existingEmails = new Set(existingUsers.map((user) => user.email.toLowerCase()))
const existingIds = new Set(existingUsers.map((user) => user.id))
const locallyCreatedUsers = getPrototypeUsers().filter(
  (user) => !existingEmails.has(user.email.toLowerCase()) && !existingIds.has(user.id),
)
const visitorUsers = getPrototypeVisitors().map<UserRecord>((visitor) => ({
  id: visitor.id,
  name: visitor.name,
  email: visitor.email.trim().toLowerCase(),
  role: 'Visitor',
  status: visitor.status,
  lastLogin: visitor.lastLogin || 'Never',
  initials:
    visitor.initials ||
    visitor.name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase())
      .join(''),
}))

const mergeUniqueUsers = (baseUsers: UserRecord[], additionalUsers: UserRecord[]) => {
  const merged = [...baseUsers]
  additionalUsers.forEach((user) => {
    const matchingIndex = merged.findIndex(
      (candidate) =>
        candidate.id === user.id || candidate.email.toLowerCase() === user.email.toLowerCase(),
    )
    if (matchingIndex === -1) merged.push(user)
    else merged[matchingIndex] = user
  })
  return merged
}

const loadUserDirectory = (): UserRecord[] => {
  try {
    const stored = JSON.parse(localStorage.getItem(USER_DIRECTORY_KEY) ?? 'null')
    if (Array.isArray(stored)) {
      return mergeUniqueUsers(stored, [...locallyCreatedUsers, ...visitorUsers])
    }
  } catch {
    // Fall back to the seeded directory when stored prototype data is invalid.
  }
  return mergeUniqueUsers([...existingUsers, ...locallyCreatedUsers], visitorUsers)
}
const users = ref<UserRecord[]>(loadUserDirectory())
const createdUser = ref<PrototypeUser | null>(null)
const actionMode = ref<'view' | 'edit' | 'delete' | null>(null)
const selectedUser = ref<UserRecord | null>(null)
const actionError = ref('')
const successMessage = ref('')
const errorMessage = ref('')
let successTimer: ReturnType<typeof setTimeout> | undefined
let errorTimer: ReturnType<typeof setTimeout> | undefined
const editUser = ref<{ name: string; email: string; role: UserRole; status: UserStatus }>({
  name: '',
  email: '',
  role: 'Botanist',
  status: 'Active',
})
const copyLabel = ref('Copy Password')
const emailState = ref<'idle' | 'sending' | 'sent' | 'error'>('idle')
const emailError = ref('')
const formError = ref('')
const newUser = ref<{ name: string; email: string; role: PrototypeRole | '' }>({
  name: '',
  email: '',
  role: '',
})

const showSuccessMessage = (message: string) => {
  if (errorTimer) clearTimeout(errorTimer)
  errorTimer = undefined
  errorMessage.value = ''

  if (successTimer) clearTimeout(successTimer)
  successMessage.value = message
  successTimer = setTimeout(() => {
    successMessage.value = ''
    successTimer = undefined
  }, 3500)
}

const showErrorMessage = (message: string) => {
  if (successTimer) clearTimeout(successTimer)
  successTimer = undefined
  successMessage.value = ''

  if (errorTimer) clearTimeout(errorTimer)
  errorMessage.value = message
  errorTimer = setTimeout(() => {
    errorMessage.value = ''
    errorTimer = undefined
  }, 4000)
}

const openAddUser = () => {
  newUser.value = { name: '', email: '', role: '' }
  formError.value = ''
  createdUser.value = null
  copyLabel.value = 'Copy Password'
  emailState.value = 'idle'
  emailError.value = ''
  addUserOpen.value = true
}

const submitNewUser = () => {
  const name = newUser.value.name.trim()
  const email = newUser.value.email.trim().toLowerCase()
  formError.value = ''

  if (!name || !email || !newUser.value.role) {
    formError.value = 'Full name, email and role are required.'
    showErrorMessage(formError.value)
    return
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    formError.value = 'Enter a valid email address.'
    showErrorMessage(formError.value)
    return
  }
  if (
    existingUsers.some((user) => user.email.toLowerCase() === email) ||
    findPrototypeUserByEmail(email) ||
    getPrototypeVisitors().some((visitor) => visitor.email.toLowerCase() === email)
  ) {
    formError.value = 'An account with this email already exists.'
    showErrorMessage(formError.value)
    return
  }

  let createdAccount: PrototypeUser | null = null
  try {
    createdAccount = createPrototypeUser({
      name,
      email,
      role: newUser.value.role,
      existingIds: existingUsers.map((user) => user.id),
    })
    users.value.push(createdAccount)
    saveUserDirectory()
    createdUser.value = createdAccount
  } catch {
    if (createdAccount) {
      users.value = users.value.filter((user) => user.id !== createdAccount?.id)
      try {
        deletePrototypeUser(createdAccount.id)
      } catch {
        // The visible directory is still restored if prototype storage is unavailable.
      }
    }
    formError.value = 'Unable to create the user account. Please try again.'
    showErrorMessage(formError.value)
  }
}

const saveUserDirectory = () => {
  localStorage.setItem(USER_DIRECTORY_KEY, JSON.stringify(users.value))
}

const initialsFor = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('')

const openUserAction = (mode: 'view' | 'edit' | 'delete', user: UserRecord) => {
  selectedUser.value = user
  actionMode.value = mode
  actionError.value = ''
  editUser.value = { name: user.name, email: user.email, role: user.role, status: user.status }
}

const closeUserAction = () => {
  actionMode.value = null
  selectedUser.value = null
  actionError.value = ''
}

const saveEditedUser = () => {
  if (!selectedUser.value) return
  const name = editUser.value.name.trim()
  const email = editUser.value.email.trim().toLowerCase()
  actionError.value = ''
  if (!name || !email) {
    actionError.value = 'Full name and email are required.'
    showErrorMessage(actionError.value)
    return
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    actionError.value = 'Enter a valid email address.'
    showErrorMessage(actionError.value)
    return
  }
  if (
    users.value.some(
      (user) => user.id !== selectedUser.value?.id && user.email.toLowerCase() === email,
    )
  ) {
    actionError.value = 'An account with this email already exists.'
    showErrorMessage(actionError.value)
    return
  }
  const updated: UserRecord = {
    ...selectedUser.value,
    ...editUser.value,
    name,
    email,
    initials: initialsFor(name),
  }
  const index = users.value.findIndex((user) => user.id === updated.id)
  const originalUser = { ...selectedUser.value }
  const prototypeUser = getPrototypeUsers().find((user) => user.id === updated.id)
  const prototypeVisitor = getPrototypeVisitors().find((visitor) => visitor.id === updated.id)

  try {
    if (index === -1) throw new Error('User record not found')
    users.value[index] = updated
    if (
      prototypeUser &&
      (updated.role === 'Conservation Officer' || updated.role === 'Botanist')
    ) {
      if (
        !updatePrototypeUser(updated.id, {
          name: updated.name,
          email: updated.email,
          role: updated.role,
          status: updated.status,
          initials: updated.initials,
        })
      ) {
        throw new Error('Prototype user could not be updated')
      }
    }
    if (prototypeVisitor) {
      if (
        !updatePrototypeVisitor(updated.id, {
          name: updated.name,
          email: updated.email,
          status: updated.status,
          initials: updated.initials,
        })
      ) {
        throw new Error('Prototype visitor could not be updated')
      }
    }
    saveUserDirectory()
    closeUserAction()
    showSuccessMessage(`${updated.name}'s account was updated successfully.`)
  } catch {
    if (index !== -1) users.value[index] = originalUser
    if (prototypeUser) {
      try {
        updatePrototypeUser(prototypeUser.id, {
          name: prototypeUser.name,
          email: prototypeUser.email,
          role: prototypeUser.role,
          status: prototypeUser.status,
          initials: prototypeUser.initials,
        })
      } catch {
        // Keep the modal open and report the original save failure.
      }
    }
    if (prototypeVisitor) {
      try {
        updatePrototypeVisitor(prototypeVisitor.id, {
          name: prototypeVisitor.name,
          email: prototypeVisitor.email,
          status: prototypeVisitor.status,
          initials: prototypeVisitor.initials || initialsFor(prototypeVisitor.name),
        })
      } catch {
        // Keep the modal open and report the original save failure.
      }
    }
    actionError.value = 'Unable to update the user account. Please try again.'
    showErrorMessage(actionError.value)
  }
}

const confirmDeleteUser = () => {
  if (!selectedUser.value) return

  const deletedUser = selectedUser.value
  const previousUsers = [...users.value]
  const previousUserCount = users.value.length

  try {
    users.value = users.value.filter((user) => user.id !== deletedUser.id)

    if (users.value.length === previousUserCount) {
      showErrorMessage(`Unable to delete ${deletedUser.name}'s account. Please try again.`)
      return
    }

    saveUserDirectory()
    if (deletedUser.role === 'Visitor') deletePrototypeVisitor(deletedUser.id)
    else deletePrototypeUser(deletedUser.id)
    closeUserAction()

    showSuccessMessage(`${deletedUser.name}'s account was deleted successfully.`)
  } catch {
    users.value = previousUsers
    showErrorMessage(`Unable to delete ${deletedUser.name}'s account. Please try again.`)
  }
}

const copyPassword = async () => {
  if (!createdUser.value) return
  try {
    await navigator.clipboard.writeText(createdUser.value.password)
    copyLabel.value = 'Copied'
  } catch {
    copyLabel.value = 'Copy unavailable'
  }
}

const sendAccountEmail = async () => {
  if (!createdUser.value || emailState.value === 'sending' || emailState.value === 'sent') return
  emailState.value = 'sending'
  emailError.value = ''
  try {
    await sendTemporaryPasswordEmail(createdUser.value, {
      serviceId: import.meta.env.VITE_EMAILJS_SERVICE_ID,
      templateId: import.meta.env.VITE_EMAILJS_TEMPLATE_ID,
      publicKey: import.meta.env.VITE_EMAILJS_PUBLIC_KEY,
      loginUrl:
        import.meta.env.VITE_ACCOUNT_LOGIN_URL ||
        new URL(import.meta.env.BASE_URL, window.location.origin).href,
    })
    emailState.value = 'sent'
  } catch (error) {
    emailState.value = 'error'
    emailError.value =
      error instanceof Error ? error.message : 'Email could not be sent. Please try again.'
    showErrorMessage(emailError.value || 'Account email could not be sent. Please try again.')
  }
}

const finishCreatingUser = () => {
  if (emailState.value === 'sending') return
  addUserOpen.value = false
  createdUser.value = null
}

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
const selectedIsPrototype = computed(() =>
  selectedUser.value
    ? getPrototypeUsers().some((user) => user.id === selectedUser.value?.id)
    : false,
)
const selectedIsVisitor = computed(() => selectedUser.value?.role === 'Visitor')
const totalUserCount = computed(() => users.value.length)
const activeUserCount = computed(
  () => users.value.filter((user) => user.status === 'Active').length,
)
const visitorCount = computed(() => users.value.filter((user) => user.role === 'Visitor').length)
const staffCount = computed(() => users.value.filter((user) => user.role !== 'Visitor').length)

const logout = () => {
  sidebarOpen.value = false
  router.push({ name: 'home' })
}
const clearFilters = () => {
  search.value = ''
  roleFilter.value = 'All roles'
  statusFilter.value = 'All statuses'
}
</script>

<template>
  <div class="admin-layout" :class="{ 'sidebar-open': sidebarOpen }">
    <aside class="sidebar" :class="{ open: sidebarOpen }">
      <button
        class="sidebar-close-button"
        type="button"
        aria-label="Close navigation"
        @click="closeSidebar"
      >
        ×
      </button>
      <RouterLink
        class="brand"
        to="/"
        data-tooltip="Go back to the public website"
        aria-label="Go back to the public website"
      >
        <img src="/images/logo.png" alt="Niah Biodiversity" />
        <div><strong>NIAH</strong><span>ADMINISTRATION</span></div>
      </RouterLink>
      <p class="nav-label">MAIN MENU</p>
      <nav aria-label="Administrator navigation">
        <RouterLink to="/admin" @click="handleNavigation"><span>⌂</span> Dashboard</RouterLink>
        <RouterLink to="/admin/users" class="active" @click="handleNavigation"
          ><span>♙</span> User Management</RouterLink
        >
        <RouterLink to="/admin/roles" @click="handleNavigation"
          ><span>◇</span> Role &amp; Permission</RouterLink
        >
        <RouterLink to="/admin/iot" @click="handleNavigation"
          ><span>⌁</span> IoT Monitoring</RouterLink
        >
        <RouterLink to="/admin/sensors" @click="handleNavigation"
          ><span>◉</span> Sensor Management</RouterLink
        >
        <RouterLink to="/admin/alerts" @click="handleNavigation"
          ><span>△</span> Threat Alerts <i>3</i></RouterLink
        >
        <RouterLink to="/admin/activity" @click="handleNavigation"
          ><span>↻</span> System Activity</RouterLink
        >
      </nav>
      <div class="sidebar-footer">
        <button type="button" @click="logout">Logout</button>
      </div>
    </aside>

    <button
      v-if="isMobile && sidebarOpen"
      class="drawer-backdrop"
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
          :aria-expanded="sidebarOpen"
          v-if="!sidebarOpen"
          @click="openSidebar"
        >
          <span></span><span></span><span></span>
        </button>
        <div>
          <p>ADMINISTRATION</p>
          <h1>User Management</h1>
        </div>
        <div class="top-actions">
          <AdminNotificationBell />
          <div class="admin-profile">
            <span>A</span>
            <div><strong>Admin01</strong><small>Administrator</small></div>
          </div>
        </div>
      </header>

      <main class="content">
        <section class="page-intro">
          <div>
            <h2>Manage system users</h2>
            <p>View accounts, assign access roles, and manage user status.</p>
          </div>
          <button class="primary-button" type="button" @click="openAddUser">
            <span>＋</span> Add New User
          </button>
        </section>

        <section class="stats-grid" aria-label="User summary">
          <article>
            <span class="stat-icon">♙</span>
            <div>
              <p>Total Users</p>
              <strong>{{ totalUserCount }}</strong><small>All registered accounts</small>
            </div>
          </article>
          <article>
            <span class="stat-icon active-icon">✓</span>
            <div>
              <p>Active Users</p>
              <strong>{{ activeUserCount }}</strong><small>Currently active accounts</small>
            </div>
          </article>
          <article>
            <span class="stat-icon officer-icon">◇</span>
            <div>
              <p>Staff Accounts</p>
              <strong>{{ staffCount }}</strong><small>Administrators, officers and botanists</small>
            </div>
          </article>
          <article>
            <span class="stat-icon botanist-icon">♧</span>
            <div>
              <p>Visitors</p>
              <strong>{{ visitorCount }}</strong><small>Self-registered accounts</small>
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
            <label class="search-box">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="10.5" cy="10.5" r="6.5" />
                <path d="m15.5 15.5 5 5" />
              </svg>
              <span class="sr-only">Search users</span>
              <input
                v-model="search"
                type="search"
                placeholder="Search name, email, ID or role..."
              />
            </label>
            <select v-model="roleFilter" aria-label="Filter by role">
              <option>All roles</option>
              <option>Administrator</option>
              <option>Conservation Officer</option>
              <option>Botanist</option>
              <option>Visitor</option>
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
                        <strong>{{ user.name }}</strong>
                        <small>{{ user.email }}</small>
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
                      <button type="button" title="View user" @click="openUserAction('view', user)">
                        View
                      </button>
                      <button type="button" title="Edit user" @click="openUserAction('edit', user)">
                        Edit
                      </button>
                      <button
                        class="delete-action"
                        type="button"
                        title="Delete user"
                        @click="openUserAction('delete', user)"
                      >
                        Delete
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

    <div v-if="successMessage" class="success-alert" role="status" aria-live="polite">
      <svg class="success-alert-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M9 12l2 2 4-4"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" />
      </svg>
      <p>
        <strong>Success</strong><span>{{ successMessage }}</span>
      </p>
    </div>

    <div v-if="errorMessage" class="error-alert" role="alert" aria-live="assertive">
      <svg class="error-alert-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" />
        <path d="M12 8v5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        <circle cx="12" cy="16.5" r="1" fill="currentColor" />
      </svg>
      <p>
        <strong>Error</strong><span>{{ errorMessage }}</span>
      </p>
    </div>

    <div v-if="addUserOpen" class="modal-backdrop" @click.self="finishCreatingUser">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="add-user-title">
        <div class="modal-heading">
          <div>
            <p>NEW ACCOUNT</p>
            <h2 id="add-user-title">Add New User</h2>
          </div>
          <button
            type="button"
            aria-label="Close"
            :disabled="emailState === 'sending'"
            @click="finishCreatingUser"
          >
            ×
          </button>
        </div>
        <div v-if="createdUser" class="creation-result">
          <strong>{{ createdUser.name }}</strong>
          <span>{{ createdUser.role }}</span>
          <span>{{ createdUser.email }}</span>
          <div class="temporary-password">
            <small>Temporary password</small><code>{{ createdUser.password }}</code>
          </div>
          <p class="form-note">
            The user must change this password when signing in for the first time.
          </p>
          <p v-if="emailState === 'sent'" class="form-note" role="status">
            Account email sent to {{ createdUser.email }}.
          </p>
          <p v-else-if="emailState === 'error'" class="form-error" role="alert">
            {{ emailError }} The account is still created; you can retry sending.
          </p>
          <button
            class="primary-button"
            type="button"
            :disabled="emailState === 'sending' || emailState === 'sent'"
            @click="sendAccountEmail"
          >
            {{
              emailState === 'sending'
                ? 'Sending email…'
                : emailState === 'sent'
                  ? 'Email Sent'
                  : emailState === 'error'
                    ? 'Retry Email'
                    : 'Send Account Email'
            }}
          </button>
          <div class="modal-actions">
            <button type="button" @click="copyPassword">{{ copyLabel }}</button>
            <button
              class="primary-button"
              type="button"
              :disabled="emailState === 'sending'"
              @click="finishCreatingUser"
            >
              Done
            </button>
          </div>
        </div>
        <form v-else @submit.prevent="submitNewUser">
          <label
            >Full name<input v-model="newUser.name" type="text" placeholder="Enter full name"
          /></label>
          <label
            >Email address<input
              v-model="newUser.email"
              type="email"
              placeholder="name@example.com"
          /></label>
          <label
            >Role<select v-model="newUser.role">
              <option value="" disabled>Select role</option>
              <option>Conservation Officer</option>
              <option>Botanist</option>
            </select></label
          >
          <p v-if="formError" class="form-error">{{ formError }}</p>
          <p class="form-note">
            A temporary password will be generated for this frontend-only prototype.
          </p>
          <div class="modal-actions">
            <button type="button" @click="addUserOpen = false">Cancel</button
            ><button class="primary-button" type="submit">Create User</button>
          </div>
        </form>
      </section>
    </div>

    <div v-if="actionMode && selectedUser" class="modal-backdrop" @click.self="closeUserAction">
      <section
        class="modal"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="`user-action-${actionMode}`"
      >
        <div class="modal-heading">
          <div>
            <p>
              {{
                actionMode === 'view'
                  ? 'ACCOUNT DETAILS'
                  : actionMode === 'edit'
                    ? 'UPDATE ACCOUNT'
                    : 'REMOVE ACCOUNT'
              }}
            </p>
            <h2 :id="`user-action-${actionMode}`">
              {{
                actionMode === 'view'
                  ? 'User Details'
                  : actionMode === 'edit'
                    ? 'Edit User'
                    : 'Delete User'
              }}
            </h2>
          </div>
          <button type="button" aria-label="Close" @click="closeUserAction">×</button>
        </div>

        <div v-if="actionMode === 'view'" class="user-details">
          <div class="detail-identity">
            <span>{{ selectedUser.initials }}</span>
            <div>
              <strong>{{ selectedUser.name }}</strong
              ><small>{{ selectedUser.email }}</small>
            </div>
          </div>
          <dl>
            <div>
              <dt>User ID</dt>
              <dd>{{ selectedUser.id }}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{{ selectedUser.role }}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{{ selectedUser.status }}</dd>
            </div>
            <div>
              <dt>Last login</dt>
              <dd>{{ selectedUser.lastLogin }}</dd>
            </div>
          </dl>
          <div class="modal-actions">
            <button type="button" @click="closeUserAction">Close</button
            ><button
              class="primary-button"
              type="button"
              @click="openUserAction('edit', selectedUser)"
            >
              Edit User
            </button>
          </div>
        </div>

        <form v-else-if="actionMode === 'edit'" @submit.prevent="saveEditedUser">
          <label>Full name<input v-model="editUser.name" type="text" required /></label>
          <label>Email address<input v-model="editUser.email" type="email" required /></label>
          <div class="form-row">
            <label
              >Role<select v-model="editUser.role" :disabled="selectedIsVisitor">
                <option v-if="selectedIsVisitor">Visitor</option>
                <template v-else>
                  <option :disabled="selectedIsPrototype">Administrator</option>
                  <option>Conservation Officer</option>
                  <option>Botanist</option>
                </template>
              </select></label
            >
            <label
              >Status<select v-model="editUser.status">
                <option>Active</option>
                <option>Inactive</option>
                <option>Suspended</option>
              </select></label
            >
          </div>
          <p v-if="actionError" class="form-error" role="alert">{{ actionError }}</p>
          <p v-if="selectedIsPrototype" class="form-note">
            Prototype accounts can be assigned to Conservation Officer or Botanist roles.
          </p>
          <p v-if="selectedIsVisitor" class="form-note">
            Visitor accounts are self-registered. Their role cannot be changed from User
            Management.
          </p>
          <div class="modal-actions">
            <button type="button" @click="closeUserAction">Cancel</button
            ><button class="primary-button" type="submit">Save Changes</button>
          </div>
        </form>

        <div v-else class="delete-confirmation">
          <div class="warning-icon">!</div>
          <p>
            Delete <strong>{{ selectedUser.name }}</strong> ({{ selectedUser.id }})?
          </p>
          <small
            >This removes the account from the directory<span v-if="selectedIsPrototype">
              and prevents it from signing in</span
            >. This action cannot be undone.</small
          >
          <div class="modal-actions">
            <button type="button" @click="closeUserAction">Cancel</button
            ><button class="danger-button" type="button" @click="confirmDeleteUser">
              Delete User
            </button>
          </div>
        </div>
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
.top-actions {
  display: flex;
  align-items: center;
  gap: 12px;
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
button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
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
.visitor {
  background: #e5eff1;
  color: #4d737a;
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
.row-actions .delete-action {
  color: #a64b40;
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
.success-alert {
  position: fixed;
  top: 96px;
  left: 50%;
  z-index: 1200;
  width: min(380px, calc(100vw - 32px));
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-left: 4px solid #0c723a;
  border-radius: 10px;
  background: #abe7bf;
  color: #245b3d;
  box-shadow: 0 10px 28px rgba(36, 91, 61, 0.15);
  transform: translateX(-50%);
  animation: success-alert-in 180ms ease-out;
}
.success-alert-icon {
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  color: #2f8a5a;
}
.success-alert p {
  margin: 0;
  display: grid;
  gap: 2px;
}
.success-alert strong {
  font-size: 11px;
  font-weight: 800;
}
.success-alert span {
  font-size: 10px;
}
.error-alert {
  position: fixed;
  top: 96px;
  left: 50%;
  z-index: 1201;
  width: min(380px, calc(100vw - 32px));
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-left: 4px solid #b42318;
  border-radius: 10px;
  background: #fde8e7;
  color: #7a271a;
  box-shadow: 0 10px 28px rgba(122, 39, 26, 0.16);
  transform: translateX(-50%);
  animation: error-alert-in 180ms ease-out;
}
.error-alert-icon {
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  color: #c43228;
}
.error-alert p {
  margin: 0;
  display: grid;
  gap: 2px;
}
.error-alert strong {
  font-size: 11px;
  font-weight: 800;
}
.error-alert span {
  font-size: 10px;
}
@keyframes success-alert-in {
  from {
    opacity: 0;
    transform: translate(-50%, -6px);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}
@keyframes error-alert-in {
  from {
    opacity: 0;
    transform: translate(-50%, -6px);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
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
.form-error {
  margin: 0;
  color: #b84b3a;
  font-size: 10px;
  font-weight: 700;
}
.creation-result {
  display: grid;
  gap: 7px;
  color: #617169;
  font-size: 11px;
}
.creation-result > strong {
  color: #315749;
  font-size: 15px;
}
.user-details,
.delete-confirmation {
  display: grid;
  gap: 16px;
}
.detail-identity {
  padding: 14px;
  display: flex;
  align-items: center;
  gap: 12px;
  border-radius: 10px;
  background: #f1f5f1;
}
.detail-identity > span {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: #dfece3;
  color: #337258;
  font-weight: 800;
}
.detail-identity div {
  display: grid;
  gap: 3px;
}
.detail-identity strong {
  color: #315749;
  font-size: 13px;
}
.detail-identity small {
  color: #7c8e86;
  font-size: 10px;
}
.user-details dl {
  margin: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.user-details dl div {
  padding: 11px;
  border: 1px solid #e2e9e2;
  border-radius: 8px;
}
.user-details dt {
  color: #87958f;
  font-size: 8px;
  font-weight: 800;
  text-transform: uppercase;
}
.user-details dd {
  margin: 5px 0 0;
  color: #36584b;
  font-size: 10px;
  font-weight: 700;
}
.delete-confirmation {
  text-align: center;
}
.delete-confirmation p {
  margin: 0;
  color: #405e53;
  font-size: 13px;
}
.delete-confirmation small {
  color: #7a8b84;
  font-size: 10px;
  line-height: 1.6;
}
.warning-icon {
  width: 48px;
  height: 48px;
  margin: 0 auto;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #f8e1dd;
  color: #b84b3a;
  font-size: 22px;
  font-weight: 800;
}
.danger-button {
  padding: 10px 15px;
  border: 0;
  border-radius: 8px;
  background: #b84b3a;
  color: #fff;
  cursor: pointer;
  font: inherit;
  font-size: 10px;
  font-weight: 700;
}
.temporary-password {
  margin-top: 9px;
  padding: 13px;
  display: grid;
  gap: 7px;
  border-radius: 8px;
  background: #f1f5f1;
}
.temporary-password small {
  color: #71827a;
  font-size: 9px;
  font-weight: 700;
}
.temporary-password code {
  width: fit-content;
  font-size: 15px;
  letter-spacing: 1px;
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
@media (max-width: 920px) {
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
  .top-actions {
    margin-left: auto;
  }
}
@media (max-width: 560px) {
  .success-alert,
  .error-alert {
    top: 82px;
  }
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
.sidebar nav button,
.sidebar-footer button {
  padding: 10px 13px;
  font-size: 12px;
  transition: 0.2s ease;
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
.admin-layout {
  grid-template-columns: 0 minmax(0, 1fr);
  transition: grid-template-columns 0.2s ease;
}
.admin-layout.sidebar-open {
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
  .admin-layout,
  .admin-layout.sidebar-open {
    grid-template-columns: 1fr;
  }
  .main-area {
    grid-column: 1;
  }
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
</style>
