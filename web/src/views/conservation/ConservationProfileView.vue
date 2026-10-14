<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { conservationProfile as profile } from '../../data/conservationProfile'

const { t } = useI18n({ useScope: 'global' })

const profileErrors = reactive({ fullName: '', email: '' })
const profileSuccess = ref('')

const password = reactive({ current: '', next: '', confirm: '' })
const passwordErrors = reactive({ current: '', next: '', confirm: '' })
const passwordSuccess = ref('')

const saveProfile = () => {
  profileErrors.fullName = profile.fullName.trim() ? '' : 'adminProfile.validation.fullNameRequired'
  profileErrors.email = !profile.email.trim()
    ? 'adminProfile.validation.emailRequired'
    : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)
      ? ''
      : 'adminProfile.validation.emailInvalid'

  profileSuccess.value =
    profileErrors.fullName || profileErrors.email ? '' : 'adminProfile.messages.profileSaved'
}

const updatePassword = () => {
  passwordErrors.current = password.current ? '' : 'adminProfile.validation.currentRequired'
  passwordErrors.next = !password.next
    ? 'adminProfile.validation.newRequired'
    : password.next.length < 8
      ? 'adminProfile.validation.minimumLength'
      : ''
  passwordErrors.confirm = !password.confirm
    ? 'adminProfile.validation.confirmRequired'
    : password.next !== password.confirm
      ? 'adminProfile.validation.passwordMismatch'
      : ''

  if (passwordErrors.current || passwordErrors.next || passwordErrors.confirm) {
    passwordSuccess.value = ''
    return
  }

  passwordSuccess.value = 'adminProfile.messages.passwordValidated'
  password.current = ''
  password.next = ''
  password.confirm = ''
}
</script>

<template>
  <section class="profile-intro">
    <p class="page-kicker">{{ t('conservationProfile.eyebrow') }}</p>
    <h2>{{ t('conservationProfile.title') }}</h2>
    <p>{{ t('conservationProfile.intro') }}</p>
  </section>

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
        <button class="primary-button" type="submit">{{ t('adminProfile.saveChanges') }}</button>
      </div>
    </form>

    <form class="settings-card" novalidate @submit.prevent="updatePassword">
      <header>
        <h2>{{ t('adminProfile.changePassword') }}</h2>
        <p>{{ t('conservationProfile.passwordDescription') }}</p>
      </header>

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
            :aria-invalid="Boolean(passwordErrors.confirm)"
            aria-describedby="confirm-password-error"
          />
          <small v-if="passwordErrors.confirm" id="confirm-password-error" class="field-error">{{
            t(passwordErrors.confirm)
          }}</small>
        </label>
      </div>

      <p class="prototype-note">
        {{ t('adminProfile.prototypeNote') }}
      </p>
      <div class="form-footer">
        <p v-if="passwordSuccess" class="success-message" role="status">{{ t(passwordSuccess) }}</p>
        <button class="primary-button" type="submit">{{ t('adminProfile.updatePassword') }}</button>
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
