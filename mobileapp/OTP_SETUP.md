# Website and app password recovery

The implementation is already added in this workspace. The app compiles the **actual website** `ForgotPasswordView.vue`, `otpEmail.ts`, and `style.css` into an embedded WebView. Both platforms use one source for the HTML, scoped CSS, Poppins font, labels, OTP generation, EmailJS request, countdown, verification, and password validation. There is no second React Native recreation of those forms.

Native navigation and account storage use a small adapter because the website uses localStorage and the app uses AsyncStorage. Screen width, safe areas, keyboard behavior, and browser font rendering can affect the final appearance. The shared Google Fonts stylesheet requires internet access, just as it does on the website.

## 1. Open the repository in VS Code

Keep `web/` and `mobileapp/` together. The recovery build imports the website source from its sibling directory. Use Node.js 22.18+ in the 22.x series, or 24.12+ (matching `web/package.json`).

From a terminal at the repository root:

```bash
cd web
npm ci
cd ../mobileapp
npm ci
```

The added dependencies and their compatible versions are already recorded in `mobileapp/package.json` and `package-lock.json`. You do not need to install a Vue runtime separately in the app: it is bundled into the recovery HTML by the website build tools.

For reference, the Expo dependency installation commands used for this implementation are:

```bash
npx expo install react-native-webview expo-router react-native-safe-area-context react-native-screens expo-linking expo-constants
npx expo install react-dom react-native-reanimated react-native-worklets
npx expo install --dev eslint eslint-config-expo typescript @types/react
```

Run those from `mobileapp/` only when recreating the integration in a fresh copy. `npm ci` is sufficient for this updated project.

## 2. Configure the same EmailJS service and template

`mobileapp/.env.local` has been populated with the three public EmailJS identifiers from `web/.env.local` in this workspace. It is ignored by Git. For another checkout, create `mobileapp/.env.local` using `.env.example`, then map the website values as follows:

| Website variable | App variable |
| --- | --- |
| `VITE_EMAILJS_SERVICE_ID` | `EXPO_PUBLIC_EMAILJS_SERVICE_ID` |
| `VITE_EMAILJS_OTP_TEMPLATE_ID` | `EXPO_PUBLIC_EMAILJS_OTP_TEMPLATE_ID` |
| `VITE_EMAILJS_PUBLIC_KEY` | `EXPO_PUBLIC_EMAILJS_PUBLIC_KEY` |

```dotenv
EXPO_PUBLIC_EMAILJS_SERVICE_ID=your_service_id
EXPO_PUBLIC_EMAILJS_OTP_TEMPLATE_ID=your_otp_template_id
EXPO_PUBLIC_EMAILJS_PUBLIC_KEY=your_public_key
```

Use the **same OTP template** as the website, with `to_email`, `to_name`, and `otp_code`. Keep its expiry text at 20 seconds. These are public client identifiers; no private EmailJS key is needed. The native WebView uses `https://localhost/` as its document base URL. If your EmailJS account restricts browser origins, check whether that origin must be allowed when testing delivery. EmailJS service/template settings and quota still apply.

Restart Expo after changing environment variables.

## 3. Build and run

From `mobileapp/`:

```bash
npm run build:recovery
npm start -- --clear
```

`npm start` automatically rebuilds the shared recovery page through `prestart`. Open the project in Expo Go on a compatible SDK 57 device, or your existing development build.

For an emulator/simulator:

```bash
npm run android
# Or, on macOS with an iOS simulator:
npm run ios
```

Both commands also rebuild the recovery page before starting Expo. A previously built native development app needs to be rebuilt to include newly added native dependencies. WebView recovery targets Android and iOS; `npm run web` is not a recovery test. Use the existing Vue website for browser testing.

## 4. Follow the same recovery flow

1. Create a Visitor account **in the app** using your real email address.
2. From Login, select **Forget password?**.
3. Enter the account email and select **Send OTP**.
4. Enter the six-digit code from the email before the 20-second countdown ends.
5. Select **Verify OTP**.
6. Enter and confirm a password of at least eight characters.
7. Select **Save new password**.
8. Select **Return to website** or **Back to home** (the labels are intentionally identical to the website). In the app, both return to its Home screen. Open Account → Login and sign in with the new password.

Android's hardware Back returns to the previous screen. Leaving recovery discards the in-memory OTP session.

The bundled demo botanist `admin@niah.com` has a hardcoded password and is outside this locally registered Visitor recovery flow. The website likewise recovers locally created prototype accounts.

**Accounts are not synchronized:** website accounts live in that browser's localStorage; app Visitor accounts live in that installation's AsyncStorage. Resetting one does not reset the other. Shared cross-device accounts would require backend authentication. This preserves the existing prototype architecture and client-side OTP verification.

## 5. Files added and changed

Paths in this table are relative to `mobileapp/`, unless prefixed with `../web/`.

| File | Purpose |
| --- | --- |
| `src/app/_layout.js` | Expo Router root stack. |
| `src/app/index.js` | Wraps the existing app's navigation in an independent tree. |
| `src/app/forgot-password.js` | WebView route, public settings injection, account-storage bridge, and Home navigation. |
| `recovery/main.js` | Mounts the website's Vue recovery component with an in-memory Vue router. |
| `recovery/bridge.js` | Async account lookup/update adapter for the website component. |
| `scripts/build-recovery.mjs` | Bundles the actual website page, email service, and global CSS. |
| `generated/recoveryHtml.js` | Generated self-contained HTML/CSS/JavaScript. Never edit by hand. |
| `scripts/recovery-flow.test.mjs` | Tests the shared website logic and the app's actual storage update. |
| `.env.example` | Public EmailJS configuration template. |
| `.env.local` | Local public identifiers copied from the website; not committed. |
| `utils/visitorStorage.js` | Updates the existing Visitor password without creating another account. |
| `screens/Login.js` | Opens the recovery route. |
| `App.js` | SDK 57 navigation imports and recovery Home return. |
| `screens/BotanistDashboard.js` | SDK 57 navigation import. |
| `index.js` | Delegates registration to Expo Router. |
| `app.json` | Router plugin and app URL scheme. |
| `package.json`, `package-lock.json` | Dependencies, Router entry, build/test commands. |
| `eslint.config.js`, `tsconfig.json` | Lint and JavaScript project check configuration. |
| `../web/src/views/ForgotPasswordView.vue` | Supports async app storage, storage errors, and disabling duplicate saves. Both platforms build this same file. |

The existing unrelated edits to the website LoginModal and ChangePasswordView are preserved.

## 6. Verify before testing on a device

From `mobileapp/`:

```bash
npm run build:recovery
npm run test:otp
npm run lint
npm run type-check
npx expo export --platform android --output-dir /tmp/niah-otp-export
```

The mobile project is JavaScript; its TypeScript configuration does not enable full `checkJs` type checking of existing screens. The website has its own Vue/TypeScript check:

```bash
cd ../web
npm run type-check
```

Manual device checks:

- Unknown email: no code is sent.
- Delivery: the same EmailJS template arrives with a six-digit code.
- Resend: disabled during the countdown and enabled after expiry.
- Expiry: switching to the email app for more than 20 seconds does not extend code validity.
- Incorrect code: five incorrect attempts invalidate the code and allow a new request.
- Password form: short or mismatched passwords cannot be saved.
- Persistence: the old password fails and the new password works, including after restarting the app.
- Network/storage failure: an error appears and the form can be retried.
- Home links and hardware Back work as described above.

Real EmailJS delivery and final appearance still need device verification. Automated tests mock email delivery and do not send live emails.

## Future website changes

Edit the website's recovery component, email service, or global stylesheet, then rebuild the app's recovery bundle:

```bash
cd mobileapp
npm run build:recovery
```

Commit the generated `generated/recoveryHtml.js` alongside the source changes so app builds always include the latest shared page.

References: [Expo SDK 57 WebView](https://docs.expo.dev/versions/v57.0.0/sdk/webview/), [Expo Router SDK migration](https://docs.expo.dev/router/migrate/sdk-55-to-56/).
