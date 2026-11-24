<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { api, logout, type AuthUser } from '../services/auth'
import { useRouter } from 'vue-router'
const router = useRouter()
const { t } = useI18n({ useScope: 'global' })
const loginErrorKeys: Record<string, string> = {
  'Unable to sign in. Check your email and password or contact the administrator.': 'credentials',
  'Unable to reach the server. Please try again.': 'network',
  'Service unavailable. Please try again.': 'unavailable',
  'Request rejected.': 'rejected',
  'Invalid request.': 'invalid',
}

const props = defineProps<{
  visible: boolean
  initialView?: 'recovery'
}>()

const emit = defineEmits<{
  close: []
  login: [
    user: {
      username: string
      role: 'admin' | 'conservation-officer'
      email?: string
      mustChangePassword?: boolean
    },
  ]
}>()

const email = ref('')
const password = ref('')
const loginError = ref('')
const platformMessage = ref('')
const dialog = ref<HTMLElement | null>(null)
const recovery = ref(false)
const recoveryEmail = ref('')
const code = ref('')
const newPassword = ref('')
const confirmation = ref('')
const recoveryId = ref('')
const recoveryError = ref('')
const recoveryBusy = ref(false)
const recoveryDone = ref(false)
let recoveryAttempt = 0
let previousFocus: HTMLElement | null = null
let previousOverflow: string | undefined

function resetRecovery(keepEmail = false) {
  recoveryAttempt++
  if (!keepEmail) recoveryEmail.value = ''
  code.value = newPassword.value = confirmation.value = recoveryId.value = recoveryError.value = ''
  recoveryBusy.value = recoveryDone.value = false
}
const closeModal = () => {
  resetRecovery()
  password.value = ''
  loginError.value = ''
  platformMessage.value = ''
  emit('close')
}

const openForgotPassword = () => {
  resetRecovery()
  recoveryEmail.value = email.value
  password.value = ''
  recovery.value = true
  void focusForm()
}
function returnToLogin() {
  resetRecovery()
  loginError.value = platformMessage.value = ''
  recovery.value = false
  void focusForm()
}
async function focusForm() {
  await nextTick()
  if (!props.visible) return
  const target = dialog.value?.querySelector<HTMLElement>(recoveryDone.value ? '#login-title' : 'input:not([disabled])')
  ;(target ?? dialog.value)?.focus()
}
function handleModalKeys(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeModal()
  } else if (event.key === 'Tab' && dialog.value) {
    const controls = [...dialog.value.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')]
    const first = controls[0], last = controls.at(-1)
    const active = document.activeElement
    if (first && last && (!controls.some(control => control === active) || (event.shiftKey ? active === first : active === last))) {
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus()
    }
  }
}
function containFocus(event: FocusEvent) {
  if (dialog.value && event.target instanceof Node && !dialog.value.contains(event.target)) void focusForm()
}
const visibleControl = (element: HTMLElement) =>
  element.isConnected && element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible'
function releaseModal() {
  document.removeEventListener('keydown', handleModalKeys)
  document.removeEventListener('focusin', containFocus)
  if (previousOverflow === undefined) return
  document.body.style.overflow = previousOverflow
  previousOverflow = undefined
  const trigger = previousFocus
  previousFocus = null
  if (trigger && visibleControl(trigger)) trigger.focus()
  else if (!props.initialView)
    Array.from(document.querySelectorAll<HTMLElement>('.navbar .menu-button, .navbar .login-button')).find(visibleControl)?.focus()
}
watch(() => props.visible, (visible) => {
  if (!visible) {
    resetRecovery()
    releaseModal()
    return
  }
  recovery.value = props.initialView === 'recovery'
  const active = document.activeElement
  previousFocus = active instanceof HTMLElement && active !== document.body ? active : null
  // The drawer closes as it launches Login. Return focus to its opener.
  if (previousFocus?.closest('.mobile-nav'))
    previousFocus = previousFocus.closest('.navbar')?.querySelector<HTMLElement>('.menu-button') ?? null
  previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  document.addEventListener('keydown', handleModalKeys)
  document.addEventListener('focusin', containFocus)
  void focusForm()
}, { immediate: true, flush: 'post' })
onBeforeUnmount(() => { resetRecovery(); releaseModal() })

async function submitRecovery() {
  if (recoveryBusy.value) return
  const address = recoveryEmail.value.trim().toLowerCase()
  const id = recoveryId.value
  recoveryError.value = ''
  if (!id && (address.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))) {
    recoveryError.value = 'invalidEmail'
    return
  }
  if (id) {
    if (newPassword.value !== confirmation.value) { recoveryError.value = 'mismatch'; return }
    if (!/^\d{6}$/.test(code.value) || newPassword.value.length < 15 || newPassword.value.length > 128) {
      recoveryError.value = 'invalidReset'
      return
    }
  }
  const attempt = ++recoveryAttempt
  recoveryBusy.value = true
  try {
    if (id) {
      await api('/auth/recovery/confirm', 'POST', { recoveryId: id, code: code.value, password: newPassword.value })
      if (attempt !== recoveryAttempt) return
      code.value = newPassword.value = confirmation.value = ''
      recoveryDone.value = true
    } else {
      const result = await api<{ recoveryId: string }>('/auth/recovery/request', 'POST', { email: address })
      if (attempt !== recoveryAttempt) return
      if (typeof result.recoveryId !== 'string' || !/^[a-f0-9]{32}$/.test(result.recoveryId)) throw Error('Invalid recovery response')
      recoveryId.value = result.recoveryId
    }
    void focusForm()
  } catch (error) {
    if (attempt !== recoveryAttempt) return
    const status = (error as { status?: number })?.status
    recoveryError.value = status === 429 ? 'rateLimit' : status === 503 ? 'unavailable'
      : id && (status === 401 || (error instanceof Error && error.message === 'Recovery code is invalid or expired.')) ? 'expired'
      : status === 400 ? (id ? 'invalidReset' : 'invalidEmail') : 'generic'
  } finally {
    if (attempt === recoveryAttempt) recoveryBusy.value = false
  }
}

const submitting = ref(false)
const handleLogin = async () => {
  if (submitting.value) return
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()) || email.value.length > 254 || !password.value) {
    loginError.value = 'loginModal.errors.invalid'
    return
  }
  email.value = email.value.trim()
  submitting.value = true
  loginError.value = ''
  platformMessage.value = ''
  try {
    const { user } = await api<{ user: AuthUser }>('/auth/login', 'POST', {
      email: email.value,
      password: password.value,
    })
    if (!['Administrator', 'Conservation Officer'].includes(user.role)) {
      await logout()
      platformMessage.value = 'loginModal.mobileOnly'
      return
    }
    if (user.mustChangePassword) {
      closeModal()
      await router.push({ name: 'change-password' })
      return
    }
    emit('login', {
      username: user.name,
      role: user.role === 'Administrator' ? 'admin' : 'conservation-officer',
      email: user.email,
    })
    emit('close')
    email.value = ''
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    loginError.value = `loginModal.errors.${loginErrorKeys[message] || 'generic'}`
  } finally {
    password.value = ''
    submitting.value = false
  }
}
</script>

<template>
  <Teleport to="body">
  <Transition name="modal-fade">
    <div v-if="visible" class="modal-backdrop" @click.self="closeModal">
      <div ref="dialog" class="login-modal" role="dialog" aria-modal="true" aria-labelledby="login-title" tabindex="-1">
        <button
          type="button"
          class="close-button"
          :aria-label="t(recovery ? 'passwordRecovery.close' : 'loginModal.close')"
          @click="closeModal"
        >
          &times;
        </button>

        <div class="modal-header">
          <div class="login-icon-circle">
            <svg v-if="recovery" class="recovery-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path v-if="recoveryDone" d="m5 12 4 4L19 6" />
              <template v-else>
                <rect x="5" y="10" width="14" height="11" rx="3" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
              </template>
            </svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" aria-hidden="true">
              <path
                d="M224 248a120 120 0 1 0 0-240 120 120 0 1 0 0 240zm-29.7 56C95.8 304 16 383.8 16 482.3 16 498.7 29.3 512 45.7 512l356.6 0c16.4 0 29.7-13.3 29.7-29.7 0-98.5-79.8-178.3-178.3-178.3l-59.4 0z"
              />
            </svg>
          </div>

          <h2 id="login-title" tabindex="-1">{{ t(!recovery ? 'loginModal.title' : recoveryDone ? 'passwordRecovery.doneTitle' : recoveryId ? 'passwordRecovery.resetTitle' : 'passwordRecovery.title') }}</h2>
          <p v-if="!recovery">{{ t('loginModal.intro') }}</p>
          <p v-else-if="!recoveryDone">{{ t(recoveryId ? 'passwordRecovery.codeIntro' : 'passwordRecovery.intro') }}</p>
        </div>

        <form v-if="!recovery" class="login-form" @submit.prevent="handleLogin">
          <div class="input-container">
            <input
              id="email"
              v-model="email"
              class="form-input"
              type="email"
              maxlength="254"
              placeholder=" "
              autocomplete="email"
              required
            />
            <div class="label-cut label-cut-email"></div>
            <label class="floating-label" for="email">{{ t('loginModal.email') }}</label>
          </div>

          <div class="input-container">
            <input
              id="password"
              v-model="password"
              class="form-input"
              type="password"
              placeholder=" "
              autocomplete="current-password"
              required
            />
            <div class="label-cut label-cut-password"></div>
            <label class="floating-label" for="password">{{ t('loginModal.password') }}</label>
          </div>

          <div class="forgot-password-row">
            <button type="button" class="forgot-password-button" @click="openForgotPassword">
              {{ t('loginModal.forgotPassword') }}
            </button>
          </div>

          <p v-if="loginError" class="login-error">
            {{ t(loginError) }}
          </p>
          <p v-if="platformMessage" class="platform-message">{{ t(platformMessage) }}</p>

          <button type="submit" class="login-submit" :disabled="submitting">
            {{ t(submitting ? 'loginModal.signingIn' : 'loginModal.submit') }}
          </button>
        </form>
        <template v-else>
          <form v-if="!recoveryDone" class="login-form recovery-form" novalidate :aria-busy="recoveryBusy" @submit.prevent="submitRecovery">
            <label v-if="!recoveryId" for="recovery-email">
              {{ t('passwordRecovery.email') }}
              <input id="recovery-email" v-model="recoveryEmail" class="form-input" type="email" maxlength="254" autocomplete="email" required :disabled="recoveryBusy" :aria-invalid="recoveryError === 'invalidEmail' || undefined" />
            </label>
            <template v-else>
              <label for="recovery-code">
                {{ t('passwordRecovery.code') }}
                <input id="recovery-code" v-model="code" class="form-input" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required :disabled="recoveryBusy" aria-describedby="recovery-code-hint" />
                <small id="recovery-code-hint">{{ t('passwordRecovery.codeHint') }}</small>
              </label>
              <label for="recovery-password">
                {{ t('passwordRecovery.password') }}
                <input id="recovery-password" v-model="newPassword" class="form-input" type="password" autocomplete="new-password" minlength="15" maxlength="128" required :disabled="recoveryBusy" aria-describedby="recovery-password-hint" />
                <small id="recovery-password-hint">{{ t('passwordRecovery.passwordHint') }}</small>
              </label>
              <label for="recovery-confirm">
                {{ t('passwordRecovery.confirm') }}
                <input id="recovery-confirm" v-model="confirmation" class="form-input" type="password" autocomplete="new-password" maxlength="128" required :disabled="recoveryBusy" />
              </label>
            </template>
            <p v-if="recoveryError" class="recovery-error" role="alert">{{ t(`passwordRecovery.${recoveryError}`) }}</p>
            <button type="submit" class="login-submit" :disabled="recoveryBusy">
              {{ t(recoveryBusy ? 'passwordRecovery.busy' : recoveryId ? 'passwordRecovery.reset' : 'passwordRecovery.request') }}
            </button>
          </form>
          <p v-if="recoveryId" class="recovery-status" role="status">{{ t(recoveryDone ? 'passwordRecovery.done' : 'passwordRecovery.requested') }}</p>
          <div class="recovery-actions">
            <button v-if="recoveryId && !recoveryDone" type="button" class="forgot-password-button" :disabled="recoveryBusy" @click="resetRecovery(true); focusForm()">{{ t('passwordRecovery.resend') }}</button>
            <button type="button" class="forgot-password-button" @click="returnToLogin"><span aria-hidden="true">←</span> {{ t('passwordRecovery.back') }}</button>
          </div>
        </template>
      </div>
    </div>
  </Transition>
  </Teleport>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  box-sizing: border-box;
  background: rgba(20, 40, 35, 0.62);
  backdrop-filter: blur(7px);
}

.login-modal {
  position: relative;
  box-sizing: border-box;
  width: min(390px, 100%);
  padding: 36px 32px 32px;
  max-height: calc(100vh - 40px);
  max-height: calc(100dvh - 40px);
  overflow: hidden auto;
  border: 1px solid rgba(222, 249, 196, 0.18);
  border-radius: 22px;
  background: linear-gradient(145deg, #315f5a, #244b47);
  box-shadow: 0 28px 70px rgba(12, 37, 32, 0.38);
}

.login-icon-circle .recovery-icon {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.recovery-form { gap: 14px; }
.recovery-form label { display: grid; gap: 6px; color: #def9c4; font-size: 13px; }
.recovery-form .form-input { height: 54px; padding: 0 18px; }
.recovery-form small, .recovery-status { color: #c9ddd6; }
.recovery-form .login-submit { min-height: 52px; height: auto; padding: 10px; }
.recovery-form button:disabled, .recovery-actions button:disabled { cursor: wait; opacity: .65; }
.recovery-error, .recovery-status { font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
.recovery-error { color: #ffbdb5; margin: 0; }
.recovery-status { margin: 14px 0 0; }
.recovery-actions { position: relative; display: grid; justify-items: center; gap: 12px; margin-top: 18px; }

.login-modal::before {
  position: absolute;
  top: 0;
  right: 0;
  width: 110px;
  height: 100px;
  background: radial-gradient(circle 95px at 95px 5px, rgba(80, 180, 152, 0.13) 99.5%, transparent 100%);
  content: '';
  pointer-events: none;
}

.close-button {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 1;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(224, 235, 221, 0.09);
  color: #e0ebdd;
  font: inherit;
  font-size: 26px;
  line-height: 34px;
  cursor: pointer;
  transition:
    background 180ms ease,
    color 180ms ease,
    transform 180ms ease;
}

.close-button:hover {
  background: #def9c4;
  color: #315f5a;
  transform: rotate(90deg);
}

.close-button:focus-visible,
.login-submit:focus-visible {
  outline: 3px solid rgba(222, 249, 196, 0.6);
  outline-offset: 3px;
}

.modal-header {
  position: relative;
  display: block;
  margin-bottom: 34px;
  text-align: center;
}

.login-icon-circle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 58px;
  height: 58px;
  margin: 0 auto 16px;
  border-radius: 50%;
  background: #50b498;
  color: white;
  box-shadow: 0 8px 22px rgba(15, 48, 41, 0.32);
  transition:
    transform 220ms ease,
    box-shadow 220ms ease;
}

.login-modal:hover .login-icon-circle {
  transform: translateY(-3px);
  box-shadow: 0 12px 26px rgba(15, 48, 41, 0.4);
}

.login-icon-circle svg {
  width: 23px;
  height: 23px;
  fill: currentColor;
}

.modal-header h2 {
  margin: 0 0 9px;
  color: #fff6dc;
  font-size: 30px;
  font-weight: 700;
}

.modal-header p {
  margin: 0;
  color: #c9ddd6;
  font-size: 14px;
  line-height: 1.6;
}

.login-form {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 27px;
}

.input-container {
  position: relative;
  height: 54px;
}

.form-input {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 6px 18px 0;
  border: 1px solid rgba(224, 235, 221, 0.2);
  border-radius: 12px;
  outline: none;
  background: #1f403d;
  color: #fff6dc;
  font: inherit;
  font-size: 16px;
  transition:
    border-color 200ms ease,
    box-shadow 200ms ease,
    background 200ms ease;
}

.form-input:hover {
  border-color: rgba(222, 249, 196, 0.5);
  background: #234944;
}

.form-input:focus {
  border-color: #76d1b5;
  background: #234944;
  box-shadow: 0 0 0 4px rgba(80, 180, 152, 0.16);
}

.label-cut {
  position: absolute;
  top: -10px;
  left: 14px;
  height: 20px;
  border-radius: 8px;
  background: #2b5651;
  opacity: 0;
  transform: scaleX(0.7);
  transition:
    opacity 200ms ease,
    transform 200ms ease;
  pointer-events: none;
}

.label-cut-email {
  width: 56px;
}

.label-cut-password {
  width: 82px;
}

.floating-label {
  position: absolute;
  top: 19px;
  left: 18px;
  color: #9bbdb4;
  font-size: 15px;
  line-height: 16px;
  pointer-events: none;
  transform-origin: left center;
  transition:
    color 200ms ease,
    transform 200ms ease;
}

.form-input:focus ~ .label-cut,
.form-input:not(:placeholder-shown) ~ .label-cut {
  opacity: 1;
  transform: scaleX(1);
}

.form-input:focus ~ .floating-label,
.form-input:not(:placeholder-shown) ~ .floating-label {
  color: #def9c4;
  transform: translateY(-27px) translateX(5px) scale(0.78);
}

.forgot-password-row {
  display: flex;
  justify-content: flex-end;
  margin: -16px 0 -8px;
}

.forgot-password-button {
  padding: 0;
  border: 0;
  background: transparent;
  color: #c9ddd6;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: color 180ms ease;
}

.forgot-password-button:hover,
.forgot-password-button:focus-visible {
  color: #def9c4;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.login-submit {
  box-sizing: border-box;
  width: 100%;
  height: 52px;
  margin-top: 5px;
  border: 0;
  border-radius: 12px;
  background: #50b498;
  color: white;
  font: inherit;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 8px 18px rgba(12, 40, 34, 0.24);
  transition:
    background 180ms ease,
    box-shadow 180ms ease,
    transform 180ms ease;
}

.login-submit:hover {
  background: #67c7a9;
  box-shadow: 0 12px 24px rgba(12, 40, 34, 0.32);
  transform: translateY(-2px);
}

.login-submit:active {
  background: #3e9d83;
  box-shadow: 0 4px 10px rgba(12, 40, 34, 0.28);
  transform: translateY(1px);
}

.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 200ms ease;
}

.modal-fade-enter-active .login-modal,
.modal-fade-leave-active .login-modal {
  transition:
    opacity 200ms ease,
    transform 200ms ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.modal-fade-enter-from .login-modal,
.modal-fade-leave-to .login-modal {
  opacity: 0;
  transform: translateY(12px) scale(0.97);
}

@media (max-width: 500px) {
  .login-modal {
    padding: 34px 24px 28px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .login-modal,
  .login-icon-circle,
  .close-button,
  .form-input,
  .floating-label,
  .label-cut,
  .login-submit {
    transition: none;
  }
}

/*login error */
.login-error {
  margin: 18px 0 -18px;
  color: #b84a4a;
  font-size: 13px;
  font-weight: 500;
  text-align: center;
}
.platform-message {
  margin: 18px 0 -18px;
  color: #def9c4;
  font-size: 13px;
  line-height: 1.5;
  text-align: center;
}
</style>
