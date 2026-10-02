<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
  login: [user: { username: string; role: 'admin' | 'conservation-officer' }]
}>()

const email = ref('')
const password = ref('')
const loginError = ref('')

const closeModal = () => {
  emit('close')
  loginError.value = ''
}
//testing
const handleLogin = () => {
  const mockUsers = [
    {
      email: 'admin@niah.com',
      password: 'admin123',
      username: 'Admin01',
      role: 'admin' as const,
    },
    {
      email: 'officer@niah.com',
      password: 'officer123',
      username: 'Officer01',
      role: 'conservation-officer' as const,
    },
  ]

  const mockUser = mockUsers.find(
    (user) => user.email === email.value && user.password === password.value,
  )

  if (mockUser) {
    emit('login', {
      username: mockUser.username,
      role: mockUser.role,
    })
    emit('close')

    email.value = ''
    password.value = ''
    loginError.value = ''

    return
  }

  loginError.value = 'Invalid email or password.'
}
</script>

<template>
  <Transition name="modal-fade">
    <div v-if="visible" class="modal-backdrop" @click.self="closeModal">
      <div class="login-modal" role="dialog" aria-modal="true" aria-labelledby="login-title">
        <button
          type="button"
          class="close-button"
          aria-label="Close login"
          @click="closeModal"
        >
          &times;
        </button>

        <div class="modal-header">
            <div class="login-icon-circle">
                <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 448 512"
                aria-hidden="true"
                >
                <path
                    d="M224 248a120 120 0 1 0 0-240 120 120 0 1 0 0 240zm-29.7 56C95.8 304 16 383.8 16 482.3 16 498.7 29.3 512 45.7 512l356.6 0c16.4 0 29.7-13.3 29.7-29.7 0-98.5-79.8-178.3-178.3-178.3l-59.4 0z"
                />
                </svg>
            </div>

            <h2 id="login-title">Welcome Back</h2>
            <p>Sign in to access the Niah Biodiversity System.</p>
        </div>

        <form class="login-form" @submit.prevent="handleLogin">
            <div class="input-container">
                <input
                id="email"
                v-model="email"
                class="form-input"
                type="email"
                placeholder=" "
                autocomplete="email"
                required
                />
                <div class="label-cut label-cut-email"></div>
                <label class="floating-label" for="email">Email</label>
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
                <label class="floating-label" for="password">Password</label>
            </div>

            <div class="forgot-password-row">
                <button type="button" class="forgot-password-button">
                    Forget password?
                </button>
            </div>

            <p
                v-if="loginError"
                class="login-error"
            >
                {{ loginError }}
            </p>

            <button type="submit" class="login-submit">Login</button>
        </form>
      </div>
    </div>
  </Transition>
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
  background: rgba(20, 40, 35, 0.62);
  backdrop-filter: blur(7px);
}

.login-modal {
  position: relative;
  box-sizing: border-box;
  width: min(390px, 100%);
  padding: 36px 32px 32px;
  overflow: hidden;
  border: 1px solid rgba(222, 249, 196, 0.18);
  border-radius: 22px;
  background: linear-gradient(145deg, #315f5a, #244b47);
  box-shadow: 0 28px 70px rgba(12, 37, 32, 0.38);
}

.login-modal::before {
  position: absolute;
  top: -90px;
  right: -80px;
  width: 190px;
  height: 190px;
  border-radius: 50%;
  background: rgba(80, 180, 152, 0.13);
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
  transition: background 180ms ease, color 180ms ease, transform 180ms ease;
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
  transition: transform 220ms ease, box-shadow 220ms ease;
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
  transition: border-color 200ms ease, box-shadow 200ms ease, background 200ms ease;
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
  transition: opacity 200ms ease, transform 200ms ease;
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
  transition: color 200ms ease, transform 200ms ease;
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
  transition: background 180ms ease, box-shadow 180ms ease, transform 180ms ease;
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
  transition: opacity 200ms ease, transform 200ms ease;
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
  color: #B84A4A;
  font-size: 13px;
  font-weight: 500;
  text-align: center;
}
</style>
