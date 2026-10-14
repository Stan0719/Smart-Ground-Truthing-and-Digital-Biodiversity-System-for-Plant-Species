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
 <main class="auth-page"><section class="auth-card"><h1>Forgot Password</h1>
 <form v-if="!done" @submit.prevent="submit">
  <input v-if="!requestId" v-model="email" type="email" placeholder="Email" aria-label="Account email" required/>
  <template v-else><p>Enter the six-digit code within five minutes.</p><input v-model="code" placeholder="Recovery code" aria-label="Recovery code" pattern="[0-9]{6}" required/><input v-model="password" type="password" placeholder="New password" aria-label="New password" minlength="15" maxlength="128" required/><input v-model="confirm" type="password" placeholder="Confirm password" aria-label="Confirm password" required/></template>
  <button :disabled="busy">{{busy?'Please wait…':requestId?'Reset password':'Request recovery code'}}</button>
 </form><p v-if="message" role="status">{{message}}</p><p v-if="error" role="alert">{{error}}</p>
 <button v-if="requestId&&!done" :disabled="busy" @click="requestId='';code='';password='';confirm='';message='';error=''">Request a new code</button>
 <RouterLink to="/">Return to sign in</RouterLink></section></main>
</template>
