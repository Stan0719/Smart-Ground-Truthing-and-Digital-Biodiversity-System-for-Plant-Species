<script setup lang="ts">
import {ref} from 'vue'
import {api} from '../services/auth'
const email=ref(''),code=ref(''),password=ref(''),confirm=ref(''),requestId=ref(''),message=ref(''),error=ref(''),busy=ref(false),done=ref(false)
async function submit(){
 if(busy.value)return
 busy.value=true;error.value=''
 try{
  if(!requestId.value){
   const result=await api<{recoveryId:string,message:string}>('/auth/recovery/request','POST',{email:email.value.trim().toLowerCase()})
   requestId.value=result.recoveryId;message.value=result.message
  }else{
   if(password.value!==confirm.value)throw Error('Passwords do not match.')
   await api('/auth/recovery/confirm','POST',{recoveryId:requestId.value,code:code.value,password:password.value})
   password.value='';confirm.value='';code.value='';done.value=true;message.value='Password updated. Return to sign in.'
  }
 }catch(failure){error.value=failure instanceof Error?failure.message:'Recovery failed.'}finally{busy.value=false}
}
</script>
<template>
  <main class="auth-page">
    <section class="auth-card" aria-labelledby="recovery-title" :aria-busy="busy">
      <div class="auth-icon" aria-hidden="true">
        <svg v-if="done" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /></svg>
        <svg v-else viewBox="0 0 24 24">
          <rect x="5" y="10" width="14" height="11" rx="3" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
        </svg>
      </div>
      <header>
        <p class="eyebrow">ACCOUNT RECOVERY</p>
        <h1 id="recovery-title">{{ done ? 'Password Updated' : requestId ? 'Reset Password' : 'Forgot Password?' }}</h1>
        <p>{{ done ? 'Your account is ready. Sign in with your new password.' : requestId ? 'Check your email for a recovery code, then choose a new password.' : 'Enter your account email and we’ll help you reset your password.' }}</p>
      </header>

      <form v-if="!done" @submit.prevent="submit">
        <label v-if="!requestId" for="recovery-email">
          Email address
          <input id="recovery-email" v-model="email" type="email" placeholder="Enter your email" autocomplete="email" required :disabled="busy" />
        </label>
        <template v-else>
          <label for="recovery-code">
            Recovery code
            <input id="recovery-code" v-model="code" class="code-input" placeholder="000000" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required :disabled="busy" aria-describedby="code-hint" />
            <small id="code-hint">Enter the six-digit code within five minutes.</small>
          </label>
          <label for="recovery-password">
            New password
            <input id="recovery-password" v-model="password" type="password" placeholder="Enter a new password" autocomplete="new-password" minlength="15" maxlength="128" required :disabled="busy" aria-describedby="password-hint" />
            <small id="password-hint">Use 15–128 characters.</small>
          </label>
          <label for="recovery-confirm">
            Confirm password
            <input id="recovery-confirm" v-model="confirm" type="password" placeholder="Re-enter your password" autocomplete="new-password" required :disabled="busy" />
          </label>
        </template>
        <p v-if="error" class="feedback error-message" role="alert">{{ error }}</p>
        <button class="primary-button" type="submit" :disabled="busy">
          <span v-if="busy" class="spinner" aria-hidden="true"></span>
          {{ busy ? 'Please wait…' : requestId ? 'Reset password' : 'Request recovery code' }}
        </button>
      </form>
      <p v-if="message" class="feedback success-message" role="status">{{ message }}</p>
      <button v-if="requestId && !done" class="resend-button" type="button" :disabled="busy" @click="requestId='';code='';password='';confirm='';message='';error=''">
        Request a new code
      </button>
      <div class="card-footer">
        <RouterLink to="/" :class="{ 'success-link': done }">
          <span v-if="!done" aria-hidden="true">←</span>
          Return to sign in
          <span v-if="done" aria-hidden="true">→</span>
        </RouterLink>
      </div>
    </section>
  </main>
</template>

<style scoped>
* { box-sizing: border-box; }
.auth-page {
  min-height: 100vh;
  min-height: 100svh;
  display: grid;
  place-items: center;
  padding: 40px 20px;
  background: linear-gradient(rgba(20, 40, 35, .32), rgba(20, 40, 35, .32)), url('/images/b1.jpg') center / cover no-repeat;
  font-family: inherit;
}
.auth-card {
  position: relative;
  width: min(420px, 100%);
  padding: 36px 32px 28px;
  overflow: hidden;
  border: 1px solid rgba(222, 249, 196, .18);
  border-radius: 22px;
  background: linear-gradient(145deg, #315f5a, #244b47);
  box-shadow: 0 28px 70px rgba(12, 37, 32, .25);
}
.auth-card::before {
  position: absolute;
  top: -90px;
  right: -80px;
  width: 190px;
  height: 190px;
  border-radius: 50%;
  background: rgba(80, 180, 152, .13);
  content: '';
  pointer-events: none;
}
.auth-icon {
  position: relative;
  width: 58px;
  height: 58px;
  margin: 0 auto 20px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #50b498;
  color: #fff6dc;
}
.auth-icon svg { width: 28px; height: 28px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
header { position: relative; margin-bottom: 28px; text-align: center; }
.eyebrow { margin: 0 0 10px; color: #91d6bf; font-size: 10px; font-weight: 800; letter-spacing: .18em; }
h1 { margin: 0 0 10px; color: #fff6dc; font-size: clamp(26px, 6vw, 30px); line-height: 1.25; }
header > p:last-child { margin: 0; color: #c9ddd6; font-size: 14px; line-height: 1.7; }
form { position: relative; display: grid; gap: 18px; }
label { display: grid; gap: 8px; color: #def9c4; font-size: 13px; font-weight: 600; }
input {
  width: 100%;
  min-width: 0;
  height: 54px;
  padding: 0 16px;
  border: 1px solid rgba(224, 235, 221, .2);
  border-radius: 12px;
  outline: 0;
  background: #1f403d;
  color: #fff6dc;
  font: inherit;
  font-size: 16px;
  transition: border-color .2s, box-shadow .2s;
}
input::placeholder { color: #a0b9b0; font-size: 14px; }
input:focus { border-color: #76d1b5; box-shadow: 0 0 0 4px rgba(80, 180, 152, .16); }
.code-input { text-align: center; letter-spacing: .4em; font-variant-numeric: tabular-nums; }
.code-input::placeholder { letter-spacing: .4em; }
small { color: #bfd4cc; font-size: 11px; font-weight: 400; line-height: 1.5; }
button, a { -webkit-tap-highlight-color: transparent; }
.primary-button, .success-link {
  min-height: 52px;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border: 0;
  border-radius: 12px;
  background: #50b498;
  color: #fff;
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  text-align: center;
  box-shadow: 0 8px 18px rgba(12, 40, 34, .24);
  transition: background .2s;
}
.primary-button:hover:not(:disabled), .success-link:hover { background: #67c7a9; }
button:disabled { cursor: wait; opacity: .65; }
.feedback { position: relative; margin: 0; padding: 12px 14px; border-radius: 10px; font-size: 12px; line-height: 1.65; overflow-wrap: anywhere; }
.error-message { border: 1px solid rgba(255,179,170,.2); background: rgba(133,40,40,.15); color: #ffbdb5; }
.success-message { margin-top: 18px; border: 1px solid rgba(145,214,191,.22); background: rgba(80,180,152,.1); color: #def9c4; }
.resend-button { display: block; margin: 16px auto 0; padding: 6px; border: 0; background: transparent; color: #a5dfc9; font: inherit; font-size: 12px; cursor: pointer; }
.resend-button:hover { text-decoration: underline; }
.card-footer { position: relative; margin-top: 24px; padding-top: 20px; border-top: 1px solid rgba(224,235,221,.13); text-align: center; }
.card-footer a { display: inline-flex; align-items: center; justify-content: center; gap: 9px; color: #def9c4; font-size: 13px; font-weight: 600; text-decoration: none; }
.card-footer a:hover { color: #fff6dc; }
.card-footer .success-link { display: flex; color: #fff; }
button:focus-visible, a:focus-visible { outline: 2px solid #def9c4; outline-offset: 4px; }
.spinner { width: 16px; height: 16px; border: 2px solid rgba(255,255,255,.4); border-top-color: #fff; border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } input, .primary-button, .success-link { transition: none; } }
@media (max-width: 500px) { .auth-page { padding: 28px 16px; } .auth-card { padding: 32px 24px 26px; } }
</style>
