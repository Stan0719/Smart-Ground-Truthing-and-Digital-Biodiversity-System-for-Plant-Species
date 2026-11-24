<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { api, currentUser, sessionSnapshot, subscribeSession, type AuthUser } from '../../services/auth'

const { t } = useI18n({ useScope: 'global' })
const router = useRouter()
const account = ref<AuthUser | null>(sessionSnapshot().user)
const profile = reactive({
  accountId: account.value?.id || '',
  fullName: account.value?.name || '',
  email: account.value?.email || '',
  role: 'Conservation Officer' as const,
})

const profileErrors = reactive({ fullName: '', email: '' })
const profileSuccess = ref('')
const profileLoadError = ref(false)

const password = reactive({ current: '', next: '', confirm: '' })
const passwordErrors = reactive({ current: '', next: '', confirm: '' })
const passwordRequestError = ref('')
const passwordBusy = ref(false)

const applyAccount = (user: AuthUser | null) => {
  const next = user?.role === 'Conservation Officer' ? user : null
  if (account.value?.id !== next?.id) {
    password.current = ''
    password.next = ''
    password.confirm = ''
    passwordRequestError.value = ''
  }
  account.value = next
  Object.assign(profile, {
    accountId: next?.id || '',
    fullName: next?.name || '',
    email: next?.email || '',
  })
  profileLoadError.value = false
}
const unsubscribeSession = subscribeSession((user, pending) => {
  // Login briefly publishes an anonymous pending state before verification.
  // Retain this form's data during that transition; clear it on confirmed logout.
  if (pending && !user) return
  applyAccount(user)
})
onBeforeUnmount(unsubscribeSession)

onMounted(async () => {
  try {
    const user = await currentUser()
    if (!user || sessionSnapshot().user?.id !== user.id) throw Error()
    applyAccount(user)
  } catch {
    profileLoadError.value = true
  }
})

const saveProfile = () => {
  profileErrors.fullName = profile.fullName.trim() ? '' : 'adminProfile.validation.fullNameRequired'
  profileErrors.email = !profile.email.trim()
    ? 'adminProfile.validation.emailRequired'
    : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)
      ? ''
      : 'adminProfile.validation.emailInvalid'

  profileSuccess.value =
    profileErrors.fullName || profileErrors.email ? '' : 'officerFeedback.prototypeValidated'
}

const updatePassword = async () => {
  passwordErrors.current = password.current ? '' : 'adminProfile.validation.currentRequired'
  passwordErrors.next = !password.next
    ? 'adminProfile.validation.newRequired'
    : password.next.length < 15 || password.next.length > 128
      ? 'adminProfile.validation.minimumLength'
      : ''
  passwordErrors.confirm = !password.confirm
    ? 'adminProfile.validation.confirmRequired'
    : password.next !== password.confirm
      ? 'adminProfile.validation.passwordMismatch'
      : ''

  if (passwordErrors.current || passwordErrors.next || passwordErrors.confirm || !account.value || passwordBusy.value) {
    passwordRequestError.value = ''
    return
  }

  passwordRequestError.value = ''
  passwordBusy.value = true
  try {
    const verification = await api<{ user: AuthUser }>('/auth/login', 'POST', {
      email: account.value.email,
      password: password.current,
    })
    if (verification.user.id !== account.value.id) throw Error('Your account changed. Sign in again.')
    await api('/auth/password', 'POST', { password: password.next, confirmation: password.confirm })
    password.current = ''
    password.next = ''
    password.confirm = ''
    window.alert(t('officerFeedback.passwordChanged'))
    await router.replace({ path: '/', query: { passwordChanged: '1' } })
  } catch (error) {
    password.current = ''
    passwordRequestError.value = error instanceof Error ? error.message : t('officerFeedback.failed')
  } finally {
    passwordBusy.value = false
  }
}
</script>

<template>
  <section class="profile-intro">
    <p class="page-kicker">{{ t('conservationProfile.eyebrow') }}</p>
    <h2>{{ t('conservationProfile.title') }}</h2>
    <p>{{ t('conservationProfile.intro') }}</p>
  </section>

  <p role="note">{{ t('officerFeedback.prototype') }}</p>
  <p v-if="profileLoadError" role="alert">{{ t('officerFeedback.profileLoadFailed') }}</p>
  <div class="profile-settings">
    <form class="settings-card" novalidate @submit.prevent="saveProfile">
      <header>
        <h2>{{ t('adminProfile.profileInformation') }}</h2>
        <p>{{ t('conservationProfile.profileDescription') }}</p>
      </header>

      <div class="settings-fields">
        <label class="settings-field">
          <span
            >{{ t('adminProfile.accountId') }} <small>{{ t('adminProfile.readOnly') }}</small></span
          >
          <input :value="profile.accountId" type="text" readonly aria-readonly="true" />
        </label>

        <label class="settings-field">
          <span>{{ t('adminProfile.fullName') }}</span>
          <input
            v-model="profile.fullName"
            type="text"
            autocomplete="name"
            readonly
            aria-readonly="true"
            :aria-invalid="Boolean(profileErrors.fullName)"
            aria-describedby="full-name-error"
          />
          <small v-if="profileErrors.fullName" id="full-name-error" class="field-error">{{
            t(profileErrors.fullName)
          }}</small>
        </label>

        <label class="settings-field">
          <span>{{ t('adminProfile.email') }}</span>
          <input
            v-model="profile.email"
            type="email"
            autocomplete="email"
            readonly
            aria-readonly="true"
            :aria-invalid="Boolean(profileErrors.email)"
            aria-describedby="email-error"
          />
          <small v-if="profileErrors.email" id="email-error" class="field-error">{{
            t(profileErrors.email)
          }}</small>
        </label>

        <label class="settings-field">
          <span
            >{{ t('adminProfile.role') }} <small>{{ t('adminProfile.readOnly') }}</small></span
          >
          <input :value="t('nav.officer')" type="text" readonly aria-readonly="true" />
        </label>
      </div>

      <div class="form-footer">
        <p v-if="profileSuccess" class="success-message" role="status">{{ t(profileSuccess) }}</p>
        <button class="primary-button" type="submit">{{ t('officerFeedback.validateOnly') }}</button>
      </div>
    </form>

    <form class="settings-card" novalidate @submit.prevent="updatePassword">
      <header>
        <h2>{{ t('adminProfile.changePassword') }}</h2>
        <p>{{ t('conservationProfile.passwordDescription') }}</p>
      </header>

      <p v-if="passwordRequestError" role="alert">{{ passwordRequestError }}</p>
      <div class="settings-fields">
        <label class="settings-field">
          <span>{{ t('adminProfile.currentPassword') }}</span>
          <input
            v-model="password.current"
            type="password"
            autocomplete="current-password"
            :aria-invalid="Boolean(passwordErrors.current)"
            aria-describedby="current-password-error"
          />
          <small v-if="passwordErrors.current" id="current-password-error" class="field-error">{{
            t(passwordErrors.current)
          }}</small>
        </label>

        <label class="settings-field">
          <span>{{ t('adminProfile.newPassword') }}</span>
          <input
            v-model="password.next"
            type="password"
            autocomplete="new-password"
            minlength="15"
            maxlength="128"
            :aria-invalid="Boolean(passwordErrors.next)"
            aria-describedby="new-password-error"
          />
          <small v-if="passwordErrors.next" id="new-password-error" class="field-error">{{
            t(passwordErrors.next)
          }}</small>
        </label>

        <label class="settings-field">
          <span>{{ t('adminProfile.confirmPassword') }}</span>
          <input
            v-model="password.confirm"
            type="password"
            autocomplete="new-password"
            maxlength="128"
            :aria-invalid="Boolean(passwordErrors.confirm)"
            aria-describedby="confirm-password-error"
          />
          <small v-if="passwordErrors.confirm" id="confirm-password-error" class="field-error">{{
            t(passwordErrors.confirm)
          }}</small>
        </label>
      </div>


      <div class="form-footer">
        <button class="primary-button" type="submit" :disabled="passwordBusy || !account">
          {{ t('adminProfile.updatePassword') }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.profile-intro {
  max-width: 820px;
  margin-bottom: 22px;
}
.profile-intro h2 {
  margin: 0 0 6px;
  color: #204b3c;
  font-size: 22px;
}
.profile-intro > p:last-child {
  margin: 0;
  color: #78877f;
  font-size: 13px;
  line-height: 1.55;
}
.profile-settings {
  width: min(820px, 100%);
  display: grid;
  gap: 18px;
}
.settings-card {
  padding: 25px;
  border: 1px solid #e0e7df;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 7px 22px #2346350b;
}
.settings-card header {
  margin-bottom: 22px;
  padding-bottom: 17px;
  border-bottom: 1px solid #edf0ed;
}
.settings-card h2 {
  margin: 0;
  color: #254c3e;
  font-size: 18px;
}
.settings-card header p {
  margin: 6px 0 0;
  color: #7d8c85;
  font-size: 11px;
  line-height: 1.5;
}
.settings-fields {
  display: grid;
  gap: 16px;
}
.settings-field {
  display: grid;
  gap: 6px;
}
.settings-field > span {
  color: #60756b;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.4px;
  text-transform: uppercase;
}
.settings-field > span small {
  margin-left: 6px;
  color: #96a29c;
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0;
}
.settings-field input {
  width: 100%;
  padding: 11px 12px;
  border: 1px solid #d9e3da;
  border-radius: 9px;
  background: #fafcfa;
  color: #405e52;
  font-size: 12px;
  outline: none;
}
.settings-field input:focus {
  border-color: #65a187;
  box-shadow: 0 0 0 3px #65a1871f;
}
.settings-field input[readonly] {
  border-color: #e3e8e2;
  background: #f1f4f0;
  color: #728078;
  cursor: not-allowed;
}
.settings-field input[aria-invalid='true'] {
  border-color: #c96b60;
  box-shadow: 0 0 0 3px #c96b6017;
}
.field-error {
  color: #b84d42;
  font-size: 10px;
}
.prototype-note {
  margin: 15px 0 0;
  color: #8a9891;
  font-size: 10px;
  line-height: 1.5;
}
.form-footer {
  min-height: 37px;
  margin-top: 20px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 14px;
}
.success-message {
  margin: 0 auto 0 0;
  color: #287a53;
  font-size: 10px;
  font-weight: 700;
}
.primary-button:focus-visible {
  outline: 3px solid #33745d35;
  outline-offset: 3px;
}
@media (max-width: 620px) {
  .profile-intro {
    margin-bottom: 17px;
  }
  .settings-card {
    padding: 18px;
  }
  .settings-card header {
    margin-bottom: 18px;
  }
  .form-footer {
    align-items: stretch;
    flex-direction: column;
  }
  .success-message {
    margin: 0;
  }
  .primary-button {
    min-height: 42px;
    width: 100%;
  }
}
</style>
