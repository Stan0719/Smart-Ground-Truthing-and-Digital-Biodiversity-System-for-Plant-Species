<script setup lang="ts">
import { computed, ref, onMounted, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import ActionFeedback from '../components/ActionFeedback.vue'
import AdminPageShell from '../components/AdminPageShell.vue'
import { api, currentUser, type AuthUser } from '../services/auth'
import StaffDialog from '../components/StaffDialog.vue'
import StaffInvitations from '../components/StaffInvitations.vue'
import { formatAdminLastLogin } from '../utils/adminLastLogin'
type UserStatus = 'Active' | 'Inactive' | 'Suspended' | 'Pending Activation'
type UserRole = 'Administrator' | 'Conservation Officer' | 'Botanist' | 'Visitor'

interface UserRecord {
  id: string
  name: string
  email: string
  role: UserRole
  status: UserStatus
  lastLogin: string
  initials: string
  mustChangePassword?: boolean
}

const { t, locale } = useI18n()
const roleOptions: UserRole[] = ['Administrator', 'Conservation Officer', 'Botanist', 'Visitor']
const statusOptions: UserStatus[] = ['Active', 'Suspended']
const roleLabel = (role: UserRole) => t(`adminUsers.roles.${role.replaceAll(' ', '')}`)
const statusLabel = (status: UserStatus) => t(`adminUsers.statuses.${status.toLowerCase()}`)
const lastLoginLabel = (value: string | null | undefined) => {
  if (value?.startsWith('Today,')) return value.replace('Today,', `${t('adminUsers.today')},`)
  if (value?.startsWith('Yesterday,'))
    return value.replace('Yesterday,', `${t('adminUsers.yesterday')},`)
  return formatAdminLastLogin(value, locale.value)
}

const addUserOpen = ref(false)
const search = ref('')
const roleFilter = ref('All roles')
const statusFilter = ref('All statuses')
const users = ref<UserRecord[]>([])
const loadError = ref('')
const currentAdminId = ref('')
const loadUsers = async () => {
  loadError.value = ''
  try {
    users.value = (await api<{ users: AuthUser[] }>('/admin/users')).users
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : 'Unable to load users.'
  }
}
onMounted(async () => {
  currentAdminId.value = (await currentUser())?.id ?? ''
  await loadUsers()
})
const actionMode = ref<'view' | 'edit' | 'delete' | null>(null)
const selectedUser = ref<UserRecord | null>(null)
const actionError = ref('')
const feedback = ref<{ id: number; variant: 'success' | 'error'; message: string } | null>(null)
let feedbackId = 0
const editUser = ref<{ name: string; email: string; role: UserRole; status: UserStatus | '' }>({
  name: '',
  email: '',
  role: 'Botanist',
  status: 'Active',
})
const creatingStaff = ref(false)

const showSuccessMessage = (message: string) => {
  feedback.value = { id: ++feedbackId, variant: 'success', message }
}

const showErrorMessage = (message: string) => {
  feedback.value = { id: ++feedbackId, variant: 'error', message }
}

const dismissFeedback = (id: number) => {
  if (feedback.value?.id === id) feedback.value = null
}

const copyPending = ref(false)
const shortUserId = (value: string) => value.length > 8 ? `${value.slice(0, 8)}…` : value
async function copyUserId(value: string) {
  if (!value || copyPending.value) return
  copyPending.value = true
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
    await navigator.clipboard.writeText(value)
    showSuccessMessage('Full identifier copied.')
  } catch {
    showErrorMessage('Unable to copy the identifier. Please try again.')
  } finally {
    copyPending.value = false
  }
}

const openAddUser = () => { addUserOpen.value = true }
const staffCreated = async (result: { delivery: string; message?: string }) => {
  addUserOpen.value = false
  await loadUsers()
  if (result.delivery === 'sent') showSuccessMessage('Staff account created. Temporary-password email accepted for delivery.')
  else showErrorMessage(result.message || 'Account created, but email delivery was not confirmed. Use Resend temporary password to retry.')
}
async function requestRecovery(user:UserRecord){if(!confirm('Send a password recovery code to '+user.email+'?'))return;try{await api('/admin/users/'+user.id+'/reset','POST',{});showSuccessMessage('Recovery requested. The account owner must complete the recovery flow.')}catch(e){showErrorMessage(e instanceof Error?e.message:'Recovery unavailable.')}}
const resendBusy = ref<string | null>(null)
const resendTemporaryPassword = async (user: UserRecord) => {
  if (resendBusy.value) return
  resendBusy.value = user.id
  try {
    const result = await api<{ delivery: string; message?: string }>(`/admin/users/${user.id}/resend`, 'POST', {})
    await loadUsers()
    if (result.delivery === 'sent') showSuccessMessage('Temporary-password email accepted for delivery.')
    else showErrorMessage(result.message || 'Email delivery was not confirmed.')
  } catch (error) { showErrorMessage(error instanceof Error ? error.message : 'Unable to resend temporary password.') }
  finally { resendBusy.value = null }
}

const openUserAction = (mode: 'view' | 'edit' | 'delete', user: UserRecord) => {
  selectedUser.value = user
  actionMode.value = mode
  actionError.value = ''
  editUser.value = { name: user.name, email: user.email, role: user.role, status: statusOptions.includes(user.status) ? user.status : '' }
}

const closeUserAction = () => {
  actionMode.value = null
  selectedUser.value = null
  actionError.value = ''
}

const saveEditedUser = async () => {
  if (!selectedUser.value) return
  actionError.value = ''
  const status = selectedUser.value.status === 'Pending Activation' ? 'Pending Activation' : editUser.value.status
  if (!status) {
    actionError.value = 'Choose Active or Suspended. The existing account status has not been changed.'
    return
  }
  try {
    const detailsChanged = editUser.value.name !== selectedUser.value.name ||
      editUser.value.email !== selectedUser.value.email || editUser.value.role !== selectedUser.value.role
    if (!detailsChanged && status === selectedUser.value.status) {
      closeUserAction()
      return
    }
    if (!detailsChanged && statusOptions.includes(status)) {
      // Status-only actions must not rewrite personal fields or require name keys.
      await api(`/admin/users/${selectedUser.value.id}/status`, 'PATCH', { status })
    } else {
      await api(`/admin/users/${selectedUser.value.id}`, 'PATCH', { ...editUser.value, status })
    }
    await loadUsers()
    closeUserAction()
    showSuccessMessage('Account updated successfully.')
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : 'Unable to update account.'
    showErrorMessage(actionError.value)
  }
}

const confirmDeleteUser = async () => {
  if (!selectedUser.value) return
  try {
    await api(`/admin/users/${selectedUser.value.id}`, 'DELETE', {})
    await loadUsers()
    closeUserAction()
    showSuccessMessage('Account deleted successfully.')
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : 'Unable to delete account.'
    showErrorMessage(actionError.value)
  }
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
const selectedIsPrototype = computed(() => Boolean(selectedUser.value))
const selectedIsVisitor = computed(() => selectedUser.value?.role === 'Visitor')
const selectedIsCurrentAdmin = computed(() =>
  selectedUser.value ? selectedUser.value.id === currentAdminId.value : false,
)
const totalUserCount = computed(() => users.value.length)
const activeUserCount = computed(
  () => users.value.filter((user) => user.status === 'Active').length,
)
const visitorCount = computed(() => users.value.filter((user) => user.role === 'Visitor').length)
const staffCount = computed(() => users.value.filter((user) => user.role !== 'Visitor').length)

const clearFilters = () => {
  search.value = ''
  roleFilter.value = 'All roles'
  statusFilter.value = 'All statuses'
}
const roleInfoButton = ref<HTMLButtonElement | null>(null)
const roleInfo = ref<HTMLElement | null>(null)
const roleInfoMessage = computed(() => selectedIsVisitor.value
  ? 'Visitor accounts are self-registered. Their role cannot be changed here.'
  : selectedIsCurrentAdmin.value
    ? 'Your own Administrator role cannot be changed here.'
    : 'Staff role changes require a new sign-in to take effect.')
function showRoleInfo() {
  const trigger = roleInfoButton.value, tooltip = roleInfo.value
  if (!trigger || !tooltip) return
  tooltip.showPopover()
  const anchor = trigger.getBoundingClientRect(), box = tooltip.getBoundingClientRect()
  tooltip.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8))}px`
  tooltip.style.top = `${Math.max(8, Math.min(anchor.top - box.height - 8 >= 8 ? anchor.top - box.height - 8 : anchor.bottom + 8, window.innerHeight - box.height - 8))}px`
}
function hideRoleInfo() { roleInfo.value?.hidePopover() }
function leaveRoleInfo() { if (document.activeElement !== roleInfoButton.value) hideRoleInfo() }
const actionModal = ref<HTMLElement | null>(null)
const deleteUserName = computed(() => selectedUser.value?.name?.trim() || selectedUser.value?.email || selectedUser.value?.id || 'this user')
let deleteReturnFocus: HTMLElement | null = null
watch(actionMode, async (mode, previous) => {
  if (mode === 'delete') {
    deleteReturnFocus = document.activeElement as HTMLElement | null
    await nextTick()
    if (actionMode.value === 'delete') actionModal.value?.querySelector<HTMLElement>('[data-delete-cancel]')?.focus()
  } else if (previous === 'delete') {
    await nextTick()
    if (deleteReturnFocus?.isConnected) deleteReturnFocus.focus()
    else document.querySelector<HTMLElement>('.admin-users .table-scroll')?.focus()
    deleteReturnFocus = null
  }
})
function handleActionBackdrop() {
  if (actionMode.value !== 'delete') { closeUserAction(); return }
  const modal = actionModal.value
  if (!modal) return
  modal.classList.remove('user-delete-shake')
  // Restart the same short animation on every backdrop click.
  void modal.offsetWidth
  modal.classList.add('user-delete-shake')
}
function finishDeleteShake(event: AnimationEvent) {
  if (event.target === actionModal.value) actionModal.value?.classList.remove('user-delete-shake')
}
function onDeleteKeydown(event: KeyboardEvent) {
  if (actionMode.value !== 'delete') return
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); return }
  if (event.key !== 'Tab') return
  const buttons = actionModal.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
  if (!buttons?.length) return
  const first = buttons[0]!, last = buttons[buttons.length - 1]!
  if (event.shiftKey && (document.activeElement === first || document.activeElement === actionModal.value)) {
    event.preventDefault(); last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault(); first.focus()
  }
}
</script>

<template>
  <AdminPageShell title="User Management" eyebrow="ADMINISTRATION" active="User Management">
    <div class="content admin-users">
      <section class="page-intro">
        <div>
          <h2>Manage system users</h2>
          <p>View accounts, assign access roles, and manage user status.</p>
          <p class="suspension-info"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg><span>Accounts inactive for 30 days are automatically suspended. Only Administrators can reactivate them, and the last active Administrator is protected.</span></p>
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
            <strong>{{ totalUserCount }}</strong
            ><small>{{ t('adminUsers.allRegisteredAccounts') }}</small>
          </div>
        </article>
        <article>
          <span class="stat-icon active-icon">✓</span>
          <div>
            <p>Active Users</p>
            <strong>{{ activeUserCount }}</strong
            ><small>{{ t('adminUsers.currentlyActiveAccounts') }}</small>
          </div>
        </article>
        <article>
          <span class="stat-icon officer-icon">◇</span>
          <div>
            <p>Staff Accounts</p>
            <strong>{{ staffCount }}</strong
            ><small>{{ t('adminUsers.staffDescription') }}</small>
          </div>
        </article>
        <article>
          <span class="stat-icon botanist-icon">♧</span>
          <div>
            <p>{{ t('adminUsers.visitors') }}</p>
            <strong>{{ visitorCount }}</strong
            ><small>{{ t('adminUsers.selfRegisteredAccounts') }}</small>
          </div>
        </article>
      </section>

      <section class="users-panel">
        <div class="panel-heading">
          <div>
            <p>{{ t('adminUsers.accountDirectory') }}</p>
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
            <span class="sr-only">{{ t('adminUsers.searchUsers') }}</span>
            <input
              v-model="search"
              type="search"
              :placeholder="t('adminUsers.searchPlaceholder')"
            />
          </label>
          <select v-model="roleFilter" :aria-label="t('adminUsers.filterByRole')">
            <option value="All roles">{{ t('adminUsers.allRoles') }}</option>
            <option v-for="role in roleOptions" :key="role" :value="role">
              {{ roleLabel(role) }}
            </option>
          </select>
          <select v-model="statusFilter" :aria-label="t('adminUsers.filterByStatus')">
            <option value="All statuses">{{ t('common.allStatuses') }}</option>
            <option v-for="status in statusOptions" :key="status" :value="status">
              {{ statusLabel(status) }}
            </option>
          </select>
          <button class="clear-button" type="button" @click="clearFilters">
            {{ t('adminUsers.clear') }}
          </button>
        </div>

        <div v-if="filteredUsers.length" class="table-scroll" tabindex="0" role="region" aria-label="User accounts">
          <table>
            <colgroup>
              <col class="users-name-column" />
              <col class="users-id-column" />
              <col class="users-role-column" />
              <col class="users-status-column" />
              <col class="users-login-column" />
              <col class="users-actions-column" />
            </colgroup>
            <thead>
              <tr>
                <th>User</th>
                <th>User ID</th>
                <th>Role</th>
                <th>Status</th>
                <th>{{ t('adminUsers.lastLogin') }}</th>
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
                  <span class="user-identifier">
                    <code :title="user.id">{{ shortUserId(user.id) }}</code>
                    <button class="user-id-copy" type="button" title="Copy full User ID" aria-label="Copy full User ID" :disabled="copyPending" @click="copyUserId(user.id)">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></svg>
                    </button>
                  </span>
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
                <td>{{ lastLoginLabel(user.lastLogin) }}</td>
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
    </div>

    <ActionFeedback
      v-if="feedback"
      :key="feedback.id"
      :feedback-id="feedback.id"
      :variant="feedback.variant"
      :message="feedback.message"
      @dismiss="dismissFeedback"
    />

    <StaffDialog v-if="addUserOpen" title="Add New User" :busy="creatingStaff" @close="addUserOpen = false">
      <StaffInvitations @created="staffCreated" @busy="creatingStaff = $event" @cancel="addUserOpen = false" />
    </StaffDialog>

    <div v-if="actionMode && selectedUser" class="modal-backdrop" @click.self="handleActionBackdrop">
      <section
        ref="actionModal"
        class="modal"
        :class="{ 'user-view-modal': actionMode === 'view', 'user-edit-modal': actionMode === 'edit', 'user-delete-modal': actionMode === 'delete' }"
        :tabindex="actionMode === 'delete' ? -1 : undefined"
        :aria-describedby="actionMode === 'delete' ? 'delete-user-question' : undefined"
        @keydown="onDeleteKeydown"
        @animationend="finishDeleteShake"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="`user-action-${actionMode}`"
      >
        <div class="modal-heading">
          <div v-if="actionMode === 'view'" class="user-view-heading">
            <span class="user-view-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="5" /><path d="M20 21a8 8 0 0 0-16 0" /></svg></span>
            <div><p>ACCOUNT DETAILS</p><h2 id="user-action-view">User Details</h2></div>
          </div>
          <div v-else-if="actionMode === 'edit'" class="user-view-heading">
            <span class="user-view-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m16 3 5 5 M4 16 16 4a3 3 0 0 1 4 4L8 20l-5 1Z" /></svg></span>
            <div><p>UPDATE ACCOUNT</p><h2 id="user-action-edit">Edit User</h2></div>
          </div>
          <button type="button" aria-label="Close" @click="closeUserAction">×</button>
        </div>

        <div v-if="actionMode === 'view'" class="user-details">
          <div class="detail-identity user-view-banner">
            <span>{{ selectedUser.initials }}</span>
            <div class="user-view-identity"><strong>{{ selectedUser.name }}</strong><small>{{ selectedUser.email }}</small></div>
            <div class="user-view-badges">
              <span class="status-badge" :class="selectedUser.status.toLowerCase()"><i></i>{{ selectedUser.status }}</span>
              <span class="role-badge" :class="selectedUser.role.toLowerCase().replace(' ', '-')">{{ selectedUser.role }}</span>
            </div>
          </div>
          <dl class="user-view-fields">
            <div>
              <span class="user-view-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12a10 10 0 0 1 20 0 M5 12a7 7 0 0 1 14 0c0 4-1 7-2 9 M8 12a4 4 0 0 1 8 0c0 4-1 7-2 10 M12 12c0 4-1 7-2 9 M5 16c0 2-1 3-1 4 M8 16c0 2-1 4-2 5" /></svg></span>
              <div><dt>User ID</dt><dd><span class="user-identifier"><code :title="selectedUser.id">{{ shortUserId(selectedUser.id) }}</code><button class="user-id-copy" type="button" title="Copy full User ID" aria-label="Copy full User ID" :disabled="copyPending" @click="copyUserId(selectedUser.id)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></svg></button></span></dd></div>
            </div>
            <div>
              <span class="user-view-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M22 21v-2a4 4 0 0 0-3-3.87 M16 3a4 4 0 0 1 0 8" /><circle cx="9" cy="7" r="4" /></svg></span>
              <div><dt>Role</dt><dd>{{ selectedUser.role }}</dd></div>
            </div>
            <div>
              <span class="user-view-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z M9 12l2 2 4-4" /></svg></span>
              <div><dt>Status</dt><dd>{{ selectedUser.status }}</dd></div>
            </div>
            <div>
              <span class="user-view-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4 M8 3v4 M3 11h18 M8 15h.01 M12 15h.01 M16 15h.01 M8 18h.01 M12 18h.01" /></svg></span>
              <div><dt>Last login</dt><dd>{{ lastLoginLabel(selectedUser.lastLogin) }}</dd></div>
            </div>
          </dl>
          <div class="modal-actions user-view-footer">
            <div class="user-view-recovery">
              <button v-if="!selectedUser.mustChangePassword&&selectedUser.status==='Active'" type="button" @click="requestRecovery(selectedUser)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="8" cy="15" r="5" /><path d="m11.5 11.5 8-8 M16 7l3 3 M19 4l2 2" /></svg>Request password recovery</button>
              <button v-if="selectedUser.mustChangePassword && selectedUser.status === 'Active' && ['Botanist','Conservation Officer'].includes(selectedUser.role)" type="button" :disabled="Boolean(resendBusy)" @click="resendTemporaryPassword(selectedUser)">{{ resendBusy === selectedUser.id ? 'Sending?' : 'Resend temporary password' }}</button>
            </div>
            <div class="user-view-close-actions">
              <button type="button" @click="closeUserAction">Close</button>
              <button class="primary-button" type="button" @click="openUserAction('edit', selectedUser)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m16 3 5 5 M4 16 16 4a3 3 0 0 1 4 4L8 20l-5 1Z" /></svg>Edit User</button>
            </div>
          </div>
        </div>

        <form v-else-if="actionMode === 'edit'" @submit.prevent="saveEditedUser">
          <div class="detail-identity user-view-banner">
            <span>{{ selectedUser.initials }}</span>
            <div class="user-view-identity"><strong>{{ selectedUser.name }}</strong><small>{{ selectedUser.email }}</small></div>
            <div class="user-view-badges">
              <span class="status-badge" :class="selectedUser.status.toLowerCase()"><i></i>{{ selectedUser.status }}</span>
              <span class="role-badge" :class="selectedUser.role.toLowerCase().replace(' ', '-')">{{ selectedUser.role }}</span>
            </div>
          </div>
          <div class="user-edit-grid">
            <div class="user-edit-field">
              <span class="user-view-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="5" /><path d="M20 21a8 8 0 0 0-16 0" /></svg></span>
              <label>Full name<input v-model="editUser.name" type="text" required /></label>
            </div>
            <div class="user-edit-field">
              <span class="user-view-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg></span>
              <label>Email address<input v-model="editUser.email" type="email" required /></label>
            </div>
            <div class="user-edit-field">
              <span class="user-view-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="7" r="4" /><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M22 21v-2a4 4 0 0 0-3-3.87 M16 3a4 4 0 0 1 0 8" /></svg></span>
              <div class="user-edit-control">
                <div class="user-edit-role-label"><label for="edit-user-role">Role</label><button ref="roleInfoButton" class="role-info-button" type="button" aria-label="Role information" aria-describedby="edit-user-role-info" @mouseenter="showRoleInfo" @mouseleave="leaveRoleInfo" @focus="showRoleInfo" @blur="hideRoleInfo" @click="showRoleInfo" @keydown.esc.stop="hideRoleInfo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="7.5" r="1.2" fill="currentColor" stroke="none" /><path d="M12 11v6" stroke-linecap="round" /></svg></button></div>
                <select id="edit-user-role" v-model="editUser.role" :disabled="selectedIsVisitor || selectedIsCurrentAdmin">
                  <option v-if="selectedIsVisitor">Visitor</option>
                  <template v-else>
                    <option :disabled="selectedIsPrototype">Administrator</option>
                    <option>Conservation Officer</option>
                    <option>Botanist</option>
                  </template>
                </select>
              </div>
            </div>
            <div class="user-edit-field">
              <span class="user-view-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z M9 12l2 2 4-4" /></svg></span>
              <label>Status<select v-model="editUser.status" required :disabled="selectedIsCurrentAdmin || selectedUser.status === 'Pending Activation'">
                <option disabled value="">Choose Active or Suspended</option>
                <option>Active</option>
                <option>Suspended</option>
              </select></label>
            </div>
          </div>
          <div id="edit-user-role-info" ref="roleInfo" class="user-role-popover" popover="auto" role="tooltip"><strong>Role information</strong><p>{{ roleInfoMessage }}</p></div>
          <p v-if="actionError" class="form-error" role="alert">{{ actionError }}</p>
          <p v-if="selectedUser.status === 'Inactive'" class="form-note">
            This is a legacy disabled account. Its status stays unchanged until you explicitly choose Active or Suspended.
          </p>
          <p v-if="selectedUser.status === 'Pending Activation'" class="form-note">
            This account's status is controlled by its existing activation workflow.
          </p>
          <p v-if="selectedIsCurrentAdmin" class="form-note">
            Your own Administrator role and account status cannot be changed from User Management.
          </p>
          <div class="modal-actions user-edit-footer">
            <button type="button" @click="closeUserAction">Cancel</button
            ><button class="primary-button" type="submit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z M7 3v6h10 M7 21v-8h10v8" /></svg>Save Changes</button>
          </div>
        </form>

        <div v-else class="delete-confirmation">
          <div class="delete-user-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18 M19 6l-1 14H6L5 6 M9 6V3h6v3 M10 10v6 M14 10v6" /></svg></div>
          <h2 id="user-action-delete">Delete User</h2>
          <p id="delete-user-question">Are you sure you want to delete <strong>{{ deleteUserName }}</strong>?</p>
          <div class="modal-actions user-delete-footer">
            <button data-delete-cancel type="button" @click="closeUserAction">Cancel</button
            ><button class="danger-button" type="button" @click="confirmDeleteUser">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18 M19 6l-1 14H6L5 6 M9 6V3h6v3 M10 10v6 M14 10v6" /></svg>Delete User
            </button>
          </div>
        </div>
      </section>
    </div>
  </AdminPageShell>
</template>

<style scoped>
* {
  box-sizing: border-box;
}
.content {
  width: 100%;
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
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}
.stats-grid article {
  padding: 19px;
  display: flex;
  align-items: center;
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
  font-size: 24px;
  flex: 0 0 39px;
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
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .filters {
    grid-template-columns: 1fr 1fr;
  }
  .search-box {
    grid-column: 1/-1;
  }
}
@media (max-width: 560px) {
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
/* User Management-only refinements. Shared dashboard controls retain their rules. */
.admin-users.admin-users.admin-users.admin-users .users-panel table { table-layout: fixed; min-width: 80rem; }
.admin-users.admin-users.admin-users.admin-users .users-panel :is(th, td) { padding: 12px 14px; }
.admin-users.admin-users.admin-users.admin-users .users-panel .user-cell { min-width: 0; max-width: 100%; }
.user-cell > span { flex-shrink: 0; }
.user-cell > div { flex: 1; min-width: 0; }
.user-cell :is(strong, small) { display: block; max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
.admin-users .page-intro > div { flex: 1; min-width: 0; }
.admin-users .page-intro > .primary-button {
  flex: 0 0 auto;
  min-width: max-content;
  min-height: 44px;
  padding: 10px 15px;
  white-space: nowrap;
  justify-content: center;
}
.stats-grid article, .stats-grid article > div { min-width: 0; }
.stats-grid article > div { overflow-wrap: anywhere; }
.suspension-info { display: flex; align-items: flex-start; gap: 8px; }
.suspension-info svg { width: 18px; height: 18px; flex: 0 0 18px; margin-top: 2px; color: #5b7065; }
.user-identifier { display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
.user-id-copy { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; flex: 0 0 44px; padding: 0; border: 0; border-radius: 5px; background: transparent; color: #315b49; cursor: pointer; }
.user-id-copy svg { width: 17px; height: 17px; flex: 0 0 17px; }
.user-id-copy:focus-visible { outline: 2px solid #245443; outline-offset: 2px; }
@media (max-width: 560px) {
  .admin-users .page-intro { align-items: stretch; }
  .admin-users .page-intro > .primary-button { width: 100%; min-width: 0; }
}
/* View-only modal. Edit and archive modal layouts retain their existing styles. */
.user-view-modal { width: min(760px, 100%); max-height: calc(100dvh - 40px); overflow-y: auto; padding: 28px; }
.user-view-modal .modal-heading { align-items: flex-start; gap: 16px; }
.user-view-heading { display: flex; align-items: center; gap: 16px; min-width: 0; }
.user-view-icon { display: grid; place-items: center; width: 48px; height: 48px; flex: 0 0 48px; border-radius: 12px; background: #e5efe8; color: #337258; }
.user-view-icon svg { width: 25px; height: 25px; }
.user-view-modal .modal-heading > button { flex: 0 0 36px; width: 36px; height: 36px; display: grid; place-items: center; }
.user-view-banner { padding: 20px; background: #f1f5f1; flex-wrap: wrap; gap: 14px; }
.user-view-banner > span { width: 54px; height: 54px; flex: 0 0 54px; border-radius: 12px; }
.user-view-banner .user-view-identity { flex: 1 1 12rem; min-width: 0; overflow-wrap: anywhere; }
.user-view-banner .user-view-badges { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.admin-shell.admin-shell.admin-shell .user-view-modal .user-view-identity strong { font-size: 1.125rem; line-height: 1.4; }
.user-view-modal .user-view-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 26px 24px; margin: 10px 0; }
.user-view-modal .user-view-fields > div { display: flex; align-items: flex-start; gap: 12px; padding: 0; border: 0; background: transparent; min-width: 0; }
.user-view-fields > div > div { min-width: 0; flex: 1; }
.user-view-modal .user-view-fields div { padding: 0; border: 0; border-radius: 0; background: transparent; }
.user-view-modal .user-view-fields dt { margin: 0 0 5px; }
.user-view-modal .user-view-fields dd { margin: 0; overflow-wrap: anywhere; }
.user-view-modal .user-view-fields .user-identifier { max-width: 100%; }
.user-view-modal .user-identifier code { font-size: .75rem; line-height: 1.5; }
.user-view-modal .user-view-footer { border-top: 1px solid #dfe7df; padding-top: 20px; margin-top: 6px; justify-content: space-between; gap: 12px; }
.user-view-recovery, .user-view-close-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.user-view-close-actions { margin-left: auto; }
.user-view-footer button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 10px 15px; border: 1px solid #dce4dc; border-radius: 9px; background: #fff; color: #3d7862; cursor: pointer; font: inherit; font-weight: 700; }
.user-view-footer button.primary-button { background: #32745b; color: #fff; }
.user-view-footer button svg { width: 18px; height: 18px; flex: 0 0 18px; }
.user-view-modal button:focus-visible { outline: 2px solid #468585; outline-offset: 2px; }
.admin-shell.admin-shell.admin-shell .user-view-modal button {
  transition: background-color 180ms ease, border-color 180ms ease, color 180ms ease;
}
.admin-shell.admin-shell.admin-shell .user-view-modal button:not(.primary-button) {
  border: 1px solid #245443;
  background: #fff;
  color: #245443;
}
.admin-shell.admin-shell.admin-shell .user-view-modal button.user-id-copy {
  border: 0;
  background: transparent;
}
@media (hover: hover) {
  .admin-shell.admin-shell.admin-shell .user-view-modal button:not(.primary-button):not(.user-id-copy):not(:disabled):hover {
    background: #245443;
    border-color: #245443;
    color: #fff;
  }
  .admin-shell.admin-shell.admin-shell .user-view-modal button.primary-button:not(:disabled):hover {
    background: #173f34;
    border-color: #173f34;
    color: #fff;
  }
}
@media (prefers-reduced-motion: reduce) {
  .admin-shell.admin-shell.admin-shell .user-view-modal button { transition: none; }
}
@media (max-width: 560px) {
  .user-view-modal { padding: 20px; }
  .user-view-modal .user-view-fields { grid-template-columns: minmax(0, 1fr); gap: 22px; }
  .user-view-banner .user-view-badges { width: 100%; }
  .user-view-recovery, .user-view-close-actions { width: 100%; }
  .user-view-footer button { flex: 1 1 auto; }
}
/* Size fixed-content columns deliberately and give the name column remaining space. */
.users-panel .users-id-column { width: 11rem; }
.users-panel .users-role-column { width: 13rem; }
.users-panel .users-status-column { width: 11rem; }
.users-panel .users-login-column { width: 13rem; }
.users-panel .users-actions-column { width: 15rem; }
.users-panel { container: user-directory / inline-size; }
.users-panel .filters { grid-template-columns: minmax(16rem, 1fr) minmax(10rem, 12rem) minmax(10rem, 12rem) max-content; }
.users-panel .filters > * { min-width: 0; }
.users-panel .search-box { min-height: 44px; }
.users-panel .search-box svg { flex: 0 0 17px; }
.users-panel .search-box input { min-width: 0; }
.users-panel .filters select, .users-panel .clear-button { height: 44px; min-height: 44px; }
.users-panel .clear-button { min-width: 5rem; padding-inline: 13px; }
.users-panel .table-scroll:focus-visible { outline: 2px solid #468585; outline-offset: 3px; }
@container user-directory (max-width: 58rem) {
  .users-panel .filters { grid-template-columns: repeat(2, minmax(0, 1fr)) max-content; }
  .users-panel .search-box { grid-column: 1 / -1; }
}
@container user-directory (max-width: 32rem) {
  .users-panel .filters { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .users-panel .clear-button { grid-column: 1 / -1; justify-self: start; }
}
@container user-directory (max-width: 22rem) {
  .users-panel .filters { grid-template-columns: minmax(0, 1fr); }
  .users-panel .clear-button { justify-self: stretch; }
}
/* Edit-only presentation preserves the original controls and disabled rendering. */
.user-edit-modal { width: min(760px, 100%); max-height: calc(100dvh - 40px); overflow-y: auto; padding: 28px; }
.user-edit-modal .modal-heading { align-items: flex-start; gap: 16px; }
.user-edit-modal .modal-heading > button { flex: 0 0 36px; width: 36px; height: 36px; display: grid; place-items: center; }
.admin-shell.admin-shell.admin-shell .user-edit-modal .user-view-identity strong { font-size: 1.125rem; line-height: 1.4; }
.user-edit-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 22px 24px; margin-block: 8px; }
.user-edit-field { display: flex; align-items: flex-start; gap: 12px; min-width: 0; }
.user-edit-field > label, .user-edit-control { flex: 1; min-width: 0; }
.user-edit-field > label { grid-template-rows: 24px auto; }
.user-edit-field > .user-view-icon { margin-top: 30px; }
.user-edit-control { display: grid; gap: 6px; }
.user-edit-role-label { display: flex; align-items: center; gap: 6px; }
.role-info-button { display: grid; place-items: center; width: 28px; height: 24px; padding: 0; border: 0; background: transparent; color: #337258; cursor: pointer; }
.role-info-button svg { width: 18px; height: 18px; }
.role-info-button:focus-visible { outline: 2px solid #468585; outline-offset: 2px; border-radius: 4px; }
.user-role-popover { position: fixed; inset: auto; margin: 0; width: max-content; max-width: min(280px, calc(100vw - 16px)); padding: 12px; border: 1px solid #dce4dc; border-radius: 9px; background: #f1f5f1; color: #29483e; box-shadow: 0 8px 24px #173f3426; }
.user-role-popover p { margin: 5px 0 0; }
.user-edit-footer { padding-top: 18px; border-top: 1px solid #dfe7df; }
.user-edit-footer button { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
.user-edit-footer svg { width: 18px; height: 18px; flex: 0 0 18px; }
@media (max-width: 560px) {
  .user-edit-modal { padding: 20px; }
  .user-edit-grid { grid-template-columns: minmax(0, 1fr); }
  .user-edit-footer button { flex: 1 1 auto; }
}
/* Delete-only confirmation and explicit backdrop feedback. */
.user-delete-modal { width: min(460px, 100%); max-height: calc(100dvh - 40px); overflow-y: auto; padding: 24px; }
.user-delete-modal .modal-heading { justify-content: flex-end; margin-bottom: 0; }
.user-delete-modal .modal-heading > button { width: 36px; height: 36px; display: grid; place-items: center; }
.user-delete-modal .delete-confirmation { gap: 14px; }
.delete-user-icon { display: grid; place-items: center; width: 64px; height: 64px; margin: 0 auto; border-radius: 50%; background: #f8e1dd; color: #b84d42; }
.delete-user-icon svg { width: 30px; height: 30px; }
.admin-shell.admin-shell.admin-shell .user-delete-modal .delete-confirmation h2 { margin: 0; font-size: 1.5rem; line-height: 1.3; color: #204c3d; }
.user-delete-modal .delete-confirmation p, .user-delete-modal .delete-confirmation small { overflow-wrap: anywhere; }
.user-delete-modal .user-delete-footer { margin-top: 6px; padding-top: 18px; border-top: 0; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
.user-delete-footer button { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
.user-delete-footer svg { width: 18px; height: 18px; flex: 0 0 18px; }
.admin-shell.admin-shell.admin-shell .user-delete-modal .danger-button { border-color: #b84d42; background: #b84d42; color: #fff; }
@media (hover: hover) {
  .admin-shell.admin-shell.admin-shell .user-delete-modal .danger-button:not(:disabled):hover { border-color: #a13c37; background: #a13c37; color: #fff; }
}
.user-delete-modal button:focus-visible { outline: 2px solid #468585; outline-offset: 2px; }
.user-delete-modal.user-delete-shake { animation: user-delete-shake 300ms ease-in-out; }
@keyframes user-delete-shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-4px); } 50% { transform: translateX(4px); } 75% { transform: translateX(-3px); } }
@media (prefers-reduced-motion: reduce) { .user-delete-modal.user-delete-shake { animation: none; } }
@media (max-width: 390px) { .user-delete-footer button { flex: 1 1 auto; } }
</style>
