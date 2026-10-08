# .

This template should help get you started developing with Vue 3 in Vite.

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur).

## Recommended Browser Setup

- Chromium-based browsers (Chrome, Edge, Brave, etc.):
  - [Vue.js devtools](https://chromewebstore.google.com/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd)
  - [Turn on Custom Object Formatter in Chrome DevTools](http://bit.ly/object-formatters)
- Firefox:
  - [Vue.js devtools](https://addons.mozilla.org/en-US/firefox/addon/vue-js-devtools/)
  - [Turn on Custom Object Formatter in Firefox DevTools](https://fxdx.dev/firefox-devtools-custom-object-formatters/)

## Type Support for `.vue` Imports in TS

TypeScript cannot handle type information for `.vue` imports by default, so we replace the `tsc` CLI with `vue-tsc` for type checking. In editors, we need [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) to make the TypeScript language service aware of `.vue` types.

## Customize configuration

See [Vite Configuration Reference](https://vite.dev/config/).

## Project Setup

```sh
npm install
```

### Compile and Hot-Reload for Development

```sh
npm run dev
```

### Send temporary passwords by email

After creating an account under **Admin → User Management → Add New User**, click
**Send Account Email**. The email contains the generated temporary password. Failed
requests can be retried without creating another account. Successful requests disable
the send button for that account confirmation.

1. Create an [EmailJS](https://www.emailjs.com/) account and connect an email service.
2. Create a template with **To Email** set to `{{to_email}}`, and a subject such as
   `Your Niah Biodiversity account`. Use the following body (normal escaped template
   variables; do not use triple braces):

   ```text
   Hello {{to_name}},

   Your Niah Biodiversity account has been created.
   Email: {{to_email}}
   Role: {{role}}
   Temporary password: {{temporary_password}}
   Website: {{login_url}}

   Conservation Officers: sign in on the website and change your password on first login.
   Botanists: use the Niah mobile application.
   ```

3. Copy `.env.example` to `.env.local`. Fill in the service ID, template ID, and
   public key from EmailJS. Set `VITE_ACCOUNT_LOGIN_URL` to your public website URL
   for deployed builds. Restart Vite after changing these values.
4. Configure the allowed website origins in EmailJS, including your development
   origin and deployed website. Only public EmailJS identifiers belong in `VITE_*`;
   these values are included in the browser build. Never add SMTP passwords or private keys.
5. Create a test account using an inbox you control, send the email, and check the
   inbox and spam folder. A successful API response confirms EmailJS accepted the request,
   not that the recipient received it. API details: [EmailJS send endpoint](https://www.emailjs.com/docs/rest-api/send/).

This is account credential delivery, not email address verification. Accounts currently
use browser-local storage and plain-text prototype passwords. An emailed account
cannot yet authenticate from another browser/device or the mobile application.
Production use requires shared backend authentication, password hashing, server-side
administrator authorization, and server-side email delivery. The existing first-login
password-change requirement remains in the website prototype.

Run the email service checks with `node --test tests/accountEmail.test.mjs`.

### Type-Check, Compile and Minify for Production

```sh
npm run build
```

### Lint with [ESLint](https://eslint.org/)

```sh
npm run lint
```
