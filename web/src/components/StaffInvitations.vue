<script setup lang="ts">
import { ref } from 'vue'
import { api } from '../services/auth'
const emit = defineEmits<{
  created: [result: { delivery: string; message?: string }]
  busy: [value: boolean]
  cancel: []
}>()
const error = ref(''),
  busy = ref(false)
const form = ref({ name: '', username: '', email: '', role: 'Botanist' })
async function invite() {
  if (busy.value) return
  form.value.name = form.value.name.trim()
  form.value.email = form.value.email.trim().toLowerCase()
  if (!form.value.name || form.value.name.length > 100 ||
      form.value.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.value.email)) {
    error.value = 'Enter a name (up to 100 characters) and a valid email address.'
    return
  }
  busy.value = true
  emit('busy', true)
  error.value = ''
  try {
    const result = await api<{ delivery: string; message?: string }>(
      '/admin/users',
      'POST',
      form.value,
    )
    emit('created', result)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Account could not be created.'
  } finally {
    busy.value = false
    emit('busy', false)
  }
}
</script>
<template>
  <form class="staff-account-form" @submit.prevent="invite">
    <p>Within one hour, Botanists must sign in and change the emailed temporary password in the mobile app. Conservation Officers complete this step on the website.</p>
    <label
      >Full name<input v-model="form.name" required maxlength="100" autocomplete="name"
    /></label>
    <label
      >Username<input
        v-model="form.username"
        required
        pattern="[A-Za-z0-9_.\-]{3,64}"
        maxlength="64"
        autocomplete="off"
    /></label>
    <label
      >Email<input v-model="form.email" required type="email" maxlength="254" autocomplete="email"
    /></label>
    <label
      >Role<select v-model="form.role">
        <option>Botanist</option>
        <option>Conservation Officer</option>
      </select></label
    >
    <p v-if="error" role="alert">{{ error }}</p>
    <div class="form-actions">
      <button type="button" class="cancel" :disabled="busy" @click="emit('cancel')">Cancel</button>
      <button :disabled="busy">
        {{ busy ? 'Creating account…' : 'Create account and email temporary password' }}
      </button>
    </div>
  </form>
</template>
<style scoped>
.form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.form-actions button {
  flex: 1;
}
button.cancel {
  background: white;
  color: #32745b;
  border: 1px solid #cfddd4;
}
@media (max-width: 500px) {
  .form-actions {
    flex-direction: column-reverse;
  }
  .form-actions button {
    flex: none;
    width: 100%;
  }
}
.staff-account-form {
  display: grid;
  gap: 16px;
}
p {
  margin: 0;
  color: #6d8077;
  font-size: 14px;
  line-height: 1.6;
}
label {
  display: grid;
  gap: 7px;
  font-size: 14px;
  font-weight: 600;
}
input,
select {
  box-sizing: border-box;
  max-width: 100%;
  width: 100%;
  padding: 11px 12px;
  border: 1px solid #cfddd4;
  border-radius: 9px;
  font: inherit;
  background: #fff;
  color: #29483e;
}
button {
  padding: 12px 16px;
  border: 0;
  border-radius: 9px;
  background: #32745b;
  color: #fff;
  font: inherit;
  cursor: pointer;
}
button:disabled {
  opacity: 0.6;
  cursor: wait;
}
[role='alert'] {
  color: #a02020;
}
</style>
