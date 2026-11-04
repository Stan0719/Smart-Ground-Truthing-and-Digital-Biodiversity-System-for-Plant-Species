<script setup lang="ts">
// Historical links must not offer staff a password-creation bypass.
window.history.replaceState(null, '', window.location.pathname)
</script>
<template>
  <main style="max-width: 480px; margin: 60px auto; padding: 24px">
    <h1>Sign in with your temporary password</h1>
    <p>
      Your administrator creates your staff account and emails a temporary password. Sign in with
      it, then set a new password before using protected features.
    </p>
    <p>
      If you received an older activation link, ask your administrator to resend your
      temporary-password account email.
    </p>
    <RouterLink to="/">Return to sign in</RouterLink>
  </main>
</template>
