<script setup lang="ts">
import { reactive, ref } from 'vue'
import AdminPageShell from '../components/AdminPageShell.vue'
import { adminProfile, saveAdminProfile } from '../data/adminProfile'

const profile = reactive({
  fullName: adminProfile.fullName,
  email: adminProfile.email,
})
const profileErrors = reactive({ fullName: '', email: '' })
const profileSuccess = ref('')

const password = reactive({ current: '', next: '', confirm: '' })
const passwordErrors = reactive({ current: '', next: '', confirm: '' })
const passwordSuccess = ref('')

const saveProfile = () => {
  profileErrors.fullName = profile.fullName.trim() ? '' : 'Full name is required.'
  profileErrors.email = !profile.email.trim()
    ? 'Email is required.'
    : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)
      ? ''
      : 'Enter a valid email address.'

  if (profileErrors.fullName || profileErrors.email) {
    profileSuccess.value = ''
    return
  }

  saveAdminProfile(profile)
  profile.fullName = adminProfile.fullName
  profile.email = adminProfile.email
  profileSuccess.value = 'Profile changes saved locally for this prototype.'
}

const updatePassword = () => {
  passwordErrors.current = password.current ? '' : 'Current password is required.'
  passwordErrors.next = !password.next
    ? 'New password is required.'
    : password.next.length < 8
      ? 'New password must be at least 8 characters.'
      : ''
  passwordErrors.confirm = !password.confirm
    ? 'Confirm your new password.'
    : password.next !== password.confirm
      ? 'New password and confirmation must match.'
      : ''

  if (passwordErrors.current || passwordErrors.next || passwordErrors.confirm) {
    passwordSuccess.value = ''
    return
  }

  passwordSuccess.value = 'Password validation completed successfully for this prototype.'
  password.current = ''
  password.next = ''
  password.confirm = ''
}
</script>

<template>
  <AdminPageShell title="Profile Settings" eyebrow="ACCOUNT" active="">
    <section class="profile-intro">
      <p class="page-kicker">ACCOUNT</p>
      <h2>Profile Settings</h2>
      <p>Manage your account details and security preferences.</p>
    </section>

    <div class="profile-settings">
      <form class="settings-card" novalidate @submit.prevent="saveProfile">
        <header>
          <h2>Profile Information</h2>
          <p>Manage your Administrator account information.</p>
        </header>

        <div class="settings-fields">
          <label class="settings-field">
            <span>Account ID <small>Read only</small></span>
            <input :value="adminProfile.accountId" type="text" readonly aria-readonly="true" />
          </label>

          <label class="settings-field">
            <span>Full Name</span>
            <input
              v-model="profile.fullName"
              type="text"
              autocomplete="name"
              :aria-invalid="Boolean(profileErrors.fullName)"
              aria-describedby="admin-full-name-error"
            />
            <small v-if="profileErrors.fullName" id="admin-full-name-error" class="field-error">{{
              profileErrors.fullName
            }}</small>
          </label>

          <label class="settings-field">
            <span>Email</span>
            <input
              v-model="profile.email"
              type="email"
              autocomplete="email"
              :aria-invalid="Boolean(profileErrors.email)"
              aria-describedby="admin-email-error"
            />
            <small v-if="profileErrors.email" id="admin-email-error" class="field-error">{{
              profileErrors.email
            }}</small>
          </label>

          <label class="settings-field">
            <span>Role <small>Read only</small></span>
            <input :value="adminProfile.role" type="text" readonly aria-readonly="true" />
          </label>
        </div>

        <div class="form-footer">
          <p v-if="profileSuccess" class="success-message" role="status">
            {{ profileSuccess }}
          </p>
          <button class="primary-button" type="submit">Save Changes</button>
        </div>
      </form>

      <form class="settings-card" novalidate @submit.prevent="updatePassword">
        <header>
          <h2>Change Password</h2>
          <p>Validate a new password for your Administrator account.</p>
        </header>

        <div class="settings-fields">
          <label class="settings-field">
            <span>Current Password</span>
            <input
              v-model="password.current"
              type="password"
              autocomplete="current-password"
              :aria-invalid="Boolean(passwordErrors.current)"
              aria-describedby="admin-current-password-error"
            />
            <small
              v-if="passwordErrors.current"
              id="admin-current-password-error"
              class="field-error"
              >{{ passwordErrors.current }}</small
            >
          </label>

          <label class="settings-field">
            <span>New Password</span>
            <input
              v-model="password.next"
              type="password"
              autocomplete="new-password"
              :aria-invalid="Boolean(passwordErrors.next)"
              aria-describedby="admin-new-password-error"
            />
            <small
              v-if="passwordErrors.next"
              id="admin-new-password-error"
              class="field-error"
              >{{ passwordErrors.next }}</small
            >
          </label>

          <label class="settings-field">
            <span>Confirm New Password</span>
            <input
              v-model="password.confirm"
              type="password"
              autocomplete="new-password"
              :aria-invalid="Boolean(passwordErrors.confirm)"
              aria-describedby="admin-confirm-password-error"
            />
            <small
              v-if="passwordErrors.confirm"
              id="admin-confirm-password-error"
              class="field-error"
              >{{ passwordErrors.confirm }}</small
            >
          </label>
        </div>

        <p class="prototype-note">
          Prototype only: the current password is not verified and no account data is sent to a
          server.
        </p>
        <div class="form-footer">
          <p v-if="passwordSuccess" class="success-message" role="status">
            {{ passwordSuccess }}
          </p>
          <button class="primary-button" type="submit">Update Password</button>
        </div>
      </form>
    </div>
  </AdminPageShell>
</template>

<style scoped>
.profile-intro { max-width: 820px; margin-bottom: 22px; }
.page-kicker { margin: 0 0 4px; color: #62a087; font-size: 9px; font-weight: 800; letter-spacing: 1.7px; }
.profile-intro h2 { margin: 0 0 6px; color: #204b3c; font-size: 22px; }
.profile-intro > p:last-child { margin: 0; color: #78877f; font-size: 13px; line-height: 1.55; }
.profile-settings { width: min(820px, 100%); display: grid; gap: 18px; }
.settings-card { padding: 25px; border: 1px solid #e0e7df; border-radius: 16px; background: #fff; box-shadow: 0 7px 22px #2346350b; }
.settings-card header { margin-bottom: 22px; padding-bottom: 17px; border-bottom: 1px solid #edf0ed; }
.settings-card h2 { margin: 0; color: #254c3e; font-size: 18px; }
.settings-card header p { margin: 6px 0 0; color: #7d8c85; font-size: 11px; line-height: 1.5; }
.settings-fields { display: grid; gap: 16px; }
.settings-field { display: grid; gap: 6px; }
.settings-field > span { color: #60756b; font-size: 10px; font-weight: 800; letter-spacing: .4px; text-transform: uppercase; }
.settings-field > span small { margin-left: 6px; color: #96a29c; font-size: 8px; font-weight: 700; letter-spacing: 0; }
.settings-field input { box-sizing: border-box; width: 100%; padding: 11px 12px; border: 1px solid #d9e3da; border-radius: 9px; background: #fafcfa; color: #405e52; font: inherit; font-size: 12px; outline: none; }
.settings-field input:focus { border-color: #65a187; box-shadow: 0 0 0 3px #65a1871f; }
.settings-field input[readonly] { border-color: #e3e8e2; background: #f1f4f0; color: #728078; cursor: not-allowed; }
.settings-field input[aria-invalid='true'] { border-color: #c96b60; box-shadow: 0 0 0 3px #c96b6017; }
.field-error { color: #b84d42; font-size: 10px; }
.prototype-note { margin: 15px 0 0; color: #8a9891; font-size: 10px; line-height: 1.5; }
.form-footer { min-height: 37px; margin-top: 20px; display: flex; align-items: center; justify-content: flex-end; gap: 14px; }
.success-message { margin: 0 auto 0 0; color: #287a53; font-size: 10px; font-weight: 700; }
.primary-button { padding: 10px 15px; border: 0; border-radius: 9px; background: #32745b; color: #fff; cursor: pointer; font: inherit; font-size: 10px; font-weight: 700; box-shadow: 0 5px 13px rgba(50, 116, 91, .18); }
.primary-button:hover { background: #28664f; }
.primary-button:focus-visible { outline: 3px solid #33745d35; outline-offset: 3px; }
@media (max-width: 620px) {
  .profile-intro { margin-bottom: 17px; }
  .settings-card { padding: 18px; }
  .settings-card header { margin-bottom: 18px; }
  .form-footer { align-items: stretch; flex-direction: column; }
  .success-message { margin: 0; }
  .primary-button { min-height: 42px; width: 100%; }
}
</style>
