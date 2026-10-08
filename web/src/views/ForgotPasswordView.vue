<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  findPrototypeUserByEmail,
  updatePrototypePassword,
} from '../data/prototypeAuth'
import { sendOtpEmail } from '../services/otpEmail'

const router = useRouter()

const step = ref<'email' | 'otp' | 'password' | 'done'>('email')

const email = ref('')
const accountEmail = ref('')
const enteredOtp = ref('')
const activeOtp = ref('')
const expiresAt = ref(0)
const secondsLeft = ref(0)
const attempts = ref(0)
const verified = ref(false)

const newPassword = ref('')
const confirmPassword = ref('')
const sending = ref(false)
const error = ref('')
const message = ref('')

let timer: ReturnType<typeof setInterval> | undefined

const canResend = computed(
  () => secondsLeft.value === 0 && !sending.value,
)

function stopTimer() {
  if (timer !== undefined) {
    clearInterval(timer)
    timer = undefined
  }
}

function updateCountdown() {
  secondsLeft.value = Math.max(
    0,
    Math.ceil((expiresAt.value - Date.now()) / 1000),
  )

  if (secondsLeft.value === 0) {
    activeOtp.value = ''
    stopTimer()
  }
}

function startCountdown() {
  stopTimer()
  expiresAt.value = Date.now() + 20_000
  updateCountdown()
  timer = setInterval(updateCountdown, 250)
}

function generateOtp(): string {
  const values = new Uint32Array(1)
  const limit = Math.floor(2 ** 32 / 1_000_000) * 1_000_000

  do {
    crypto.getRandomValues(values)
  } while (values[0]! >= limit)

  return String(values[0]! % 1_000_000).padStart(6, '0')
}

async function sendCode() {
  if (sending.value) return
  if (step.value === 'otp' && !canResend.value) return

  error.value = ''
  message.value = ''

  const targetEmail =
    step.value === 'email'
      ? email.value.trim().toLowerCase()
      : accountEmail.value

  const user = findPrototypeUserByEmail(targetEmail)

  if (!user) {
    error.value = 'No locally created account was found for this email.'
    return
  }

  // Invalidate the previous code before sending a new one.
  stopTimer()
  activeOtp.value = ''
  secondsLeft.value = 0
  expiresAt.value = 0
  enteredOtp.value = ''
  verified.value = false
  sending.value = true

  const code = generateOtp()

  try {
    await sendOtpEmail(user.email, user.name, code)

    accountEmail.value = user.email
    activeOtp.value = code
    attempts.value = 0
    step.value = 'otp'
    startCountdown()
    message.value = 'Code sent. Check your email.'
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : 'Unable to send the code.'
  } finally {
    sending.value = false
  }
}

function verifyCode() {
  error.value = ''
  message.value = ''

  // Check the actual expiry time when the user submits.
  if (!activeOtp.value || Date.now() >= expiresAt.value) {
    activeOtp.value = ''
    secondsLeft.value = 0
    stopTimer()
    error.value = 'The code has expired. Click Resend OTP.'
    return
  }

  if (attempts.value >= 5) {
    error.value = 'Too many incorrect attempts. Request a new code.'
    return
  }

  if (enteredOtp.value.trim() !== activeOtp.value) {
    attempts.value += 1

    if (attempts.value >= 5) {
      activeOtp.value = ''
      secondsLeft.value = 0
      stopTimer()
      error.value = 'Too many incorrect attempts. Request a new code.'
    } else {
      error.value = 'Incorrect code. Please try again.'
    }

    return
  }

  verified.value = true
  activeOtp.value = ''
  stopTimer()
  step.value = 'password'
  enteredOtp.value = ''
}

function resetPassword() {
  error.value = ''

  if (!verified.value) {
    error.value = 'Verify your email code first.'
    return
  }

  if (newPassword.value.length < 8) {
    error.value = 'Password must contain at least 8 characters.'
    return
  }

  if (newPassword.value !== confirmPassword.value) {
    error.value = 'Passwords do not match.'
    return
  }

  if (!updatePrototypePassword(accountEmail.value, newPassword.value)) {
    error.value = 'Account could not be updated.'
    return
  }

  verified.value = false
  newPassword.value = ''
  confirmPassword.value = ''
  step.value = 'done'
}

onUnmounted(stopTimer)
</script>

<template>
  <main class="recovery-page">
    <section class="recovery-card">
      <h1>Forgot password</h1>

      <form v-if="step === 'email'" @submit.prevent="sendCode">
        <p>Enter the email used for your account.</p>

        <label for="recovery-email">Email</label>
        <input
          id="recovery-email"
          v-model="email"
          type="email"
          autocomplete="email"
          required
        />

        <button type="submit" :disabled="sending">
          {{ sending ? 'Sending…' : 'Send OTP' }}
        </button>
      </form>

      <form v-else-if="step === 'otp'" @submit.prevent="verifyCode">
        <p>Enter the code sent to {{ accountEmail }}.</p>

        <p v-if="secondsLeft > 0">
          Code expires in <strong>{{ secondsLeft }} seconds</strong>.
        </p>
        <p v-else>The code has expired. Request a new one.</p>

        <label for="recovery-otp">Six-digit code</label>
        <input
          id="recovery-otp"
          v-model="enteredOtp"
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="6"
          pattern="[0-9]{6}"
          required
        />

        <button
          type="submit"
          :disabled="sending || secondsLeft === 0"
        >
          Verify OTP
        </button>

        <button
          type="button"
          :disabled="!canResend"
          @click="sendCode"
        >
          {{ sending ? 'Sending…' : 'Resend OTP' }}
        </button>
      </form>

      <form v-else-if="step === 'password'" @submit.prevent="resetPassword">
        <p>Your code is verified. Choose a new password.</p>

        <label for="new-password">New password</label>
        <input
          id="new-password"
          v-model="newPassword"
          type="password"
          autocomplete="new-password"
          minlength="8"
          required
        />

        <label for="confirm-password">Confirm password</label>
        <input
          id="confirm-password"
          v-model="confirmPassword"
          type="password"
          autocomplete="new-password"
          minlength="8"
          required
        />

        <button type="submit">Save new password</button>
      </form>

      <div v-else>
        <p>Your password has been updated.</p>

        <button type="button" @click="router.push('/')">
          Return to website
        </button>

        <p>Click Login to sign in with your new password.</p>
      </div>

      <p v-if="message" class="message" role="status">
        {{ message }}
      </p>

      <p v-if="error" class="error" role="alert">
        {{ error }}
      </p>

      <RouterLink to="/">Back to home</RouterLink>
    </section>
  </main>
</template>

<style scoped>
.recovery-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: #f3f6f2;
}

.recovery-card {
  width: 100%;
  max-width: 400px;
  box-sizing: border-box;
  padding: 28px;
  border-radius: 18px;
  background: white;
  box-shadow: 0 12px 35px rgb(0 0 0 / 10%);
}

h1 {
  color: #244b47;
}

form {
  display: grid;
  gap: 12px;
}

input,
button {
  box-sizing: border-box;
  width: 100%;
  padding: 12px;
  border-radius: 8px;
  font: inherit;
}

input {
  border: 1px solid #bbb;
}

button {
  border: 0;
  background: #28745a;
  color: white;
  cursor: pointer;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.message {
  color: #28745a;
}

.error {
  color: #b42318;
}

a {
  display: inline-block;
  margin-top: 16px;
}
</style>