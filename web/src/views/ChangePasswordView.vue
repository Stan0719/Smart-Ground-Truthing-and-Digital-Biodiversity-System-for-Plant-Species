<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  PENDING_PASSWORD_CHANGE_KEY,
  findPrototypeUserByEmail,
  updatePrototypePassword,
} from '../data/prototypeAuth'

const router = useRouter()
const newPassword = ref('')
const confirmPassword = ref('')
const error = ref('')

const changePassword = () => {
  const email = sessionStorage.getItem(PENDING_PASSWORD_CHANGE_KEY)
  if (!email || !findPrototypeUserByEmail(email)?.mustChangePassword) {
    error.value = 'Your password-change session is no longer available. Please sign in again.'
    return
  }
  if (newPassword.value.length < 8) {
    error.value = 'Password must be at least 8 characters.'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = 'Passwords do not match.'
    return
  }
  if (!updatePrototypePassword(email, newPassword.value)) {
    error.value = 'Unable to update the password. Please sign in again.'
    return
  }

  sessionStorage.removeItem(PENDING_PASSWORD_CHANGE_KEY)
  router.replace({ name: 'conservation-dashboard' })
}
</script>

<template>
  <main class="auth-page">
    <section class="auth-card" aria-labelledby="change-password-title">
      <div class="auth-icon" aria-hidden="true">&#128274;</div>
      <header>
        <h1 id="change-password-title">Set New Password</h1>
        <p>Change your temporary password before accessing the Niah Biodiversity System.</p>
      </header>
      <form @submit.prevent="changePassword">
        <label>New Password<input v-model="newPassword" type="password" autocomplete="new-password" required /></label>
        <label>Confirm Password<input v-model="confirmPassword" type="password" autocomplete="new-password" required /></label>
        <p v-if="error" class="error-message">{{ error }}</p>
        <button type="submit">Change Password</button>
      </form>
    </section>
  </main>
</template>

<style scoped>
*{box-sizing:border-box}.auth-page{min-height:100vh;padding:20px;display:grid;place-items:center;background:#f3f6f2;font-family:inherit}.auth-card{position:relative;width:min(390px,100%);padding:36px 32px 32px;overflow:hidden;border:1px solid rgba(222,249,196,.18);border-radius:22px;background:linear-gradient(145deg,#315f5a,#244b47);box-shadow:0 28px 70px rgba(12,37,32,.38)}.auth-card::before{position:absolute;top:-90px;right:-80px;width:190px;height:190px;border-radius:50%;background:rgba(80,180,152,.13);content:''}.auth-icon{position:relative;width:58px;height:58px;margin:0 auto 16px;display:grid;place-items:center;border-radius:50%;background:#50b498;font-size:23px}header{position:relative;margin-bottom:30px;text-align:center}h1{margin:0 0 9px;color:#fff6dc;font-size:30px}header p{margin:0;color:#c9ddd6;font-size:14px;line-height:1.6}form{position:relative;display:grid;gap:18px}label{display:grid;gap:7px;color:#def9c4;font-size:13px;font-weight:600}input{width:100%;height:54px;padding:0 18px;border:1px solid rgba(224,235,221,.2);border-radius:12px;outline:0;background:#1f403d;color:#fff6dc;font:inherit;font-size:16px}input:focus{border-color:#76d1b5;box-shadow:0 0 0 4px rgba(80,180,152,.16)}button{width:100%;height:52px;margin-top:5px;border:0;border-radius:12px;background:#50b498;color:#fff;font:inherit;font-size:16px;font-weight:700;cursor:pointer;box-shadow:0 8px 18px rgba(12,40,34,.24)}button:hover{background:#67c7a9}.error-message{margin:0;color:#ffb3aa;font-size:13px;line-height:1.4;text-align:center}@media(max-width:500px){.auth-card{padding:34px 24px 28px}}
</style>
