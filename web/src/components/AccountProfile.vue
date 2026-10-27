<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, currentUser, logout, type AuthUser } from '../services/auth'
const props = defineProps<{ canEdit?: boolean; standalone?: boolean }>(),
  router = useRouter(),
  user = ref<AuthUser | null>(null),
  error = ref(''),
  message = ref(''),
  busy = ref(false),
  loaded = ref(false)
const profile = ref({ name: '', email: '' }),
  password = ref({ current: '', next: '', confirmation: '' })
const editable = computed(() => props.canEdit && user.value?.role === 'Administrator')
onMounted(async () => {
  user.value = await currentUser()
  if (user.value) profile.value = { name: user.value.name, email: user.value.email }
  else error.value = 'Your account could not be loaded. Sign in again.'
  loaded.value = true
})
async function saveProfile() {
  if (!user.value || !editable.value || busy.value) return
  error.value = ''
  message.value = ''
  busy.value = true
  try {
    await api(`/admin/users/${user.value.id}`, 'PATCH', {
      name: profile.value.name,
      email: profile.value.email,
      role: user.value.role,
      status: user.value.status,
    })
    const verified = await currentUser()
    if (!verified) {
      await router.replace('/')
      return
    }
    user.value = verified
    profile.value = { name: verified.name, email: verified.email }
    window.dispatchEvent(new Event('niah-account-updated'))
    message.value = 'Profile saved.'
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Profile could not be saved.'
  } finally {
    busy.value = false
  }
}
async function updatePassword() {
  if (!user.value || busy.value) return
  error.value = ''
  message.value = ''
  if (
    password.value.next.length < 15 ||
    password.value.next.length > 128 ||
    password.value.next !== password.value.confirmation
  ) {
    error.value = 'Use matching passwords with 15 to 128 characters.'
    return
  }
  if (password.value.next === password.value.current) {
    error.value = 'Choose a different new password.'
    return
  }
  busy.value = true
  try {
    const result = await api<{ user: AuthUser }>('/auth/login', 'POST', {
      email: user.value.email,
      password: password.value.current,
    })
    if (result.user.id !== user.value.id) throw Error('Your account changed. Sign in again.')
    await api('/auth/password', 'POST', {
      password: password.value.next,
      confirmation: password.value.confirmation,
    })
    password.value = { current: '', next: '', confirmation: '' }
    window.alert('Password changed. Please sign in again.')
    await router.replace({ path: '/', query: { passwordChanged: '1' } })
  } catch (cause) {
    password.value.current = ''
    error.value = cause instanceof Error ? cause.message : 'Password could not be changed.'
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <section class="staff-page" :class="{ 'standalone-account': standalone }">
    <div v-if="standalone" class="account-toolbar">
      <RouterLink to="/">Niah Biodiversity</RouterLink>
      <button @click="async()=>{await logout();await router.replace('/')}" type="button">Sign out</button>
    </div>
    <p v-if="user?.role==='Botanist'" class="account-notice">Your account is active. Use the same email and personal password in the mobile app for field collection.</p>
    <div class="page-heading">
      <div>
        <h2>Profile Settings</h2>
        <p class="muted">Your verified account information and password controls.</p>
      </div>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="message" role="status">{{ message }}</p>
    <p v-if="!loaded">Loading account…</p>
    <div v-if="user" class="two-columns">
      <section class="panel">
        <h3>Profile Information</h3>
        <form class="staff-form" @submit.prevent="saveProfile">
          <label>Account ID<input :value="user.id" readonly /></label
          ><label
            >Full Name<input
              v-model="profile.name"
              :readonly="!editable"
              maxlength="100"
              required /></label
          ><label
            >Email<input
              v-model="profile.email"
              type="email"
              :readonly="!editable"
              maxlength="254"
              required /></label
          ><label>Role<input :value="user.role" readonly /></label>
          <p v-if="!editable">Contact an Administrator to update your name or email.</p>
          <p v-else>
            Changing your email revokes your current sessions and requires signing in again.
          </p>
          <div v-if="editable" class="actions">
            <button class="primary" :disabled="busy">Save Changes</button>
          </div>
        </form>
      </section>
      <section class="panel">
        <h3>Change Password</h3>
        <form class="staff-form" @submit.prevent="updatePassword">
          <label
            >Current Password<input
              v-model="password.current"
              type="password"
              autocomplete="current-password"
              required /></label
          ><label
            >New Password<input
              v-model="password.next"
              type="password"
              autocomplete="new-password"
              minlength="15"
              maxlength="128"
              required /></label
          ><label
            >Confirm New Password<input
              v-model="password.confirmation"
              type="password"
              autocomplete="new-password"
              required
          /></label>
          <p>Successful password changes sign out all sessions for your account.</p>
          <div class="actions">
            <button class="primary" :disabled="busy">Update Password</button>
          </div>
        </form>
      </section>
    </div>
  </section>
</template>
<style src="../styles/staff-workspace.css"></style>
<style scoped>
.standalone-account {
  max-width: 1180px;
  margin: 0 auto;
  padding: 32px 24px 56px;
}
.account-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 28px;
}
.account-toolbar a {
  color: #204b3c;
  font-size: 20px;
  font-weight: 700;
  text-decoration: none;
}
.account-notice {
  padding: 16px 20px;
  margin: 0 0 24px;
  border: 1px solid #ccdbd1;
  border-radius: 12px;
  background: #edf5ef;
}
.standalone-account .two-columns {
  align-items: start;
}
.staff-page .two-columns > .panel {
  margin: 0;
}
@media (max-width: 640px) {
  .standalone-account {
    padding: 20px 16px 32px;
  }
}
</style>
