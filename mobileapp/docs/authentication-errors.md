# Three authentication errors — investigation and repair

This report records the mobile registration/login integration repair, server-side recovery implementation and the verified anti-spoofing rejection. Physical iPhone recognition and live email delivery are not claimed successful.

## 1. Registration succeeds locally but /password fails

**Locations:** `screens/VisitorRegister.js:handleRegister` previously called `saveVisitorAccount`; `utils/visitorStorage.js` persisted a Visitor with a plaintext password in device AsyncStorage. No registration API was called. `screens/Login.js:handleLogin` instead called Python `/password`; `account_service.py:password_login` delegated to the signed `/internal/face/password` bridge in `web/server/face-service.mjs`. Its earlier role requirement accepted only permanent-password Botanists.

**Reference:** `989c1d06d392`. The reported email was absent from both the authoritative `users` table and the Python prototype `accounts` table in the read-only audit. The phone's private AsyncStorage was not accessible from the workspace. Code proves the registration success meant only local persistence, not authoritative registration. The new form explicitly created Visitor rather than Botanist. There was no server password hash for that local-only account, so this was not a verified scrypt mismatch or mandatory-password-change failure.

**Repair:** Registration now calls `/register` → signed `/internal/face/register` → `auth.createVisitor`, then displays success only after the returned immutable ID, email, Active status and Visitor role are confirmed. Passwords use the same existing scrypt hashing/verification as other real accounts. Visitor records and Visitor sessions use dedicated tables in the **same authoritative SQLite database**, preserving the existing privileged-user role constraint. Password/face sessions now accept eligible Visitors as Visitors and eligible Botanists as Botanists; officers, suspended accounts and mandatory-password-change restrictions remain enforced. No account is promoted or copied automatically. Password login no longer falls back to hardcoded/local credentials.

The mobile form now enforces the authoritative 15–128 character password policy. Existing local-only users must explicitly register through the repaired form; the agent did not create a production account or import its plaintext password. Botanist creation remains administrator-managed through existing User Management. New Visitor registration uses the previous Active Visitor policy; it has no invented Botanist approval or email-verification requirement.

## 2. Anti-spoofing rejection

**Locations:** `face_backend/server.py:embed`, endpoint `/face-login`, calls `image_pipeline.py:represent_oriented`; upstream `DeepFace.represent` raises `SpoofDetected`. `embed` maps it to HTTP 422 `liveness_rejected`.

**Reference:** `42e4ac03ec9b`. Live logs confirm challenge validation, JPEG decoding (916×720, EXIF 6, 128064 decoded bytes), normalization to 720×916 BGR without application cropping, then OpenCV processing at rotation 0 and `SpoofDetected`. Matching, template updates and session creation were not reached. This is a **model rejection**, not malformed JPEG, a network failure or a generic processing exception.

The installed Fasnet implementation uses MiniFASNetV2 and MiniFASNetV1SE, two context crops at scales 2.7/4.0 resized to 80×80. It sums model softmax outputs and accepts only winning class 1 as live. The application uses that unchanged boolean; it does not invert it or substitute an embedding similarity threshold for liveness. Enrollment and login use the same EXIF/BGR/detection/anti-spoofing pipeline. Application resizing preserves aspect ratio and adds no face crop; the model's context crops are its upstream design.

**Repair scope:** No verified preprocessing or decision-interpretation defect was found for this request. Anti-spoofing remains enabled and rejects the capture. Added a safe, idempotent observer around the upstream model that logs model name, context sizes, coarse face-area fraction and passed/rejected decision without scores, photos, pixels or embeddings; it returns the exact upstream result and never retries a spoof rejection. The regression verifies rejection/score preservation and one model call. Therefore **physical liveness is not claimed fixed**. Other real iPhone attempts passed anti-spoofing but subsequently failed the unchanged 0.30 match threshold, confirming separate failure stages.

A safe evaluation requires consented live iPhone captures and labeled presentation attacks across lighting, distances, camera orientations and devices. Measure bona-fide rejection and attack acceptance on held-out subjects; do not accept a rejected capture, alter Fasnet class interpretation, disable protection or adjust thresholds based only on successful public photos. Existing templates are preserved.

## 3. Forgot Password

**Locations:** `screens/Login.js` routes to `/forgot-password`; `src/app/forgot-password.js` formerly embedded a shared Vue page with a device-only `find/update` bridge. The current shared `web/src/views/ForgotPasswordView.vue` was a placeholder saying recovery was unavailable. `web/server/index.mjs` had no unauthenticated recovery endpoints. Historical local OTP/password updates could not update the real account database.

**Repair:** Native mobile recovery now calls Python `/recovery/request` and `/recovery/confirm`; its signed bridge invokes the same authoritative recovery implementation as website `/api/auth/recovery/request` and `/api/auth/recovery/confirm`. `web/server/recovery.mjs` owns six-digit random codes, HMAC-hashed storage, a five-minute expiry, five validation attempts, rate limiting, replacement invalidation and atomic single-use consumption. `auth.resetPassword` hashes the new password with the existing policy, updates the correct account and revokes sessions. Changes to account status, email or password invalidate pending recovery. Suspended accounts cannot reset into access. No code/token/password is logged or returned to the requester by the delivery API.

`recoveryId` is separate from the diagnostic `requestId`, preventing the Python correlation mechanism from overwriting the reset challenge identifier. Frontends never generate or validate OTPs locally and never update local password records.

**Delivery:** The approved EmailJS public configuration exists in `mobileapp/.env.local`, but previously was not available to the server. `recovery-config.mjs` reads only its three approved public EmailJS fields (server environment settings take precedence) and creates a shared private 600-permission reset-HMAC key alongside the selected authoritative database. Optional `EMAILJS_PRIVATE_KEY` is server-only. No real email was sent in agent testing. EmailJS account/template/quota/non-browser settings and optional private-key requirements remain external checks. Request responses are anti-enumerating: “If an eligible account exists, a recovery code will be sent. Delivery is not confirmed here.” Delivery failures invalidate the challenge and produce a sanitized audit event; the UI never claims reset success before server confirmation. Missing delivery configuration returns 503 for everyone.

EmailJS REST parameters follow the approved existing mechanism and its official `/send` documentation: https://www.emailjs.com/docs/rest-api/send/.

## Files changed

- Mobile: `screens/VisitorRegister.js`, `screens/Login.js`, `src/app/forgot-password.js`, `scripts/recovery-flow.test.mjs`.
- Python: `account_service.py`, `authoritative_auth.py`, `server.py`, new `spoof_diagnostics.py`, `test_account_integration.py`, new `test_spoof_diagnostics.py`.
- Account service: `schema.sql`, `auth.mjs`, `face-service.mjs`, `index.mjs`, new `recovery.mjs`, `recovery-config.mjs`, `recovery.test.mjs`.
- Website: `ForgotPasswordView.vue`, `services/auth.ts`, `LoginModal.vue` (Visitors are not mislabeled as officers on the website).
- Startup helper enables safe correlated password diagnostic logging. No provider exception text, recipient, password, token or OTP is logged.

## Startup commands

Both the website API (3001) and the private mobile account-service instance (3002) use the same `web/server/data/auth.sqlite`. Account restrictions are never changed to resolve login.

After stopping existing owned listeners, from the repository root:

```bash
# Terminal 1: authoritative account service (3002) + Python (8000) + Expo (8081)
cd mobileapp
bash scripts/start-authoritative-face-dev.sh

# Terminal 2: website authentication API (3001)
cd web
npm run server

# Terminal 3: website (5173)
cd web
npm run dev -- --host 0.0.0.0
```

If Expo already runs, use `bash scripts/start-authoritative-face-dev.sh --backend-only` instead in terminal 1. Keep these terminals open. The helper refuses to replace another listener. Port 3002 stays loopback-only; the existing approved HTTPS URL for port 8000 is used by the phone.

Optional EmailJS private credentials must be configured in the **server environment**, never `EXPO_PUBLIC_*` or chat. Server `EMAILJS_SERVICE_ID`, `EMAILJS_OTP_TEMPLATE_ID`, `EMAILJS_PUBLIC_KEY` override the existing approved public settings; `EMAILJS_PRIVATE_KEY` is optional according to EmailJS REST documentation but may be needed for account-specific restrictions. `AUTH_RESET_KEY_FILE` can specify a private persistent HMAC key file; otherwise `data/recovery.key` is generated without logging it. No delivery is tested without user authorization.

## iPhone validation

1. Reload Expo to load the repaired form/recovery screen. Register a **Visitor** through Create Account with 15–128 character matching passwords. Success must confirm server persistence. No Botanist permission should appear.
2. Return to Login and use those credentials. Check correlated `/password` diagnostics and `/me`; expect the Visitor home/account route. A Botanist must use an approved real Botanist account and its permanent password.
3. Face registration is a separate authenticated consent action. Existing unlinked legacy faces must use the explicitly authenticated/consented linking procedure in `face-auth-evaluation.md`, not automatic re-enrollment. A legacy face associated with a suspended officer is not promoted or linked by email.
4. For Face Login, leave credentials blank. Collect correlation references and distinguish `liveness_rejected`, `face_not_matched`, `account_not_linked` and account restrictions. Successful recognition/session/dashboard access remains a physical-device validation gate.
5. With the account owner's authorization, request a recovery code once. Confirm actual mailbox delivery, then submit the code and a policy-compliant new password. Verify old sessions/password fail and new password login works. Do not paste the code/password into chat. If delivery is unconfirmed, inspect the sanitized `recovery_delivery_failed` audit event and provider settings; do not claim success or bypass the code.

No production account, role/status, facial template or password was altered by agent tests. Tests use temporary databases/accounts and fake delivery callbacks. Historical local Visitor records are not silently migrated or used as an authentication fallback.

## Current error/function line references

| Stage | File | Line | Endpoint | Reference |
| --- | --- | --- | --- | --- |
| Registration | `mobileapp/screens/VisitorRegister.js` | 110 | `/register` | 989c1d06d392 |
| Password login | `mobileapp/screens/Login.js` | 331 | `/password` | 989c1d06d392 |
| Authority adapter | `mobileapp/face_backend/account_service.py` | 69 | `/internal/face/password` | 989c1d06d392 |
| Liveness error | `mobileapp/face_backend/server.py` | 31 | `/face-login` | 42e4ac03ec9b |
| Recovery screen | `mobileapp/src/app/forgot-password.js` | 6 | `/recovery/request; /recovery/confirm` | not supplied |
| Recovery request | `web/server/recovery.mjs` | 5 | `/api/auth/recovery/request` | not supplied |
| Recovery confirm | `web/server/recovery.mjs` | 23 | `/api/auth/recovery/confirm` | not supplied |

## Validation results

- Python: 37 distinct tests passed (36 in the full suite plus the added mobile HTTP end-to-end registration/password/recovery-configuration test), no failures/skips, including actual models, real Node/Python registration/session integration and observer rejection preservation.
- Node: 8 tests passed, no failures/skips; covers real HTTP account/security routes, Visitor persistence, recovery expiry/attempts/replay/blocked accounts/delivery failure and login after reset. Delivery is injected, not real email.
- Client: 29 passed (11 API, 6 session, 3 completion, 7 camera flow, 2 recovery UI); no failures/skips.
- Mobile lint/type checking and changed server/Vue ESLint/web type checking passed.
- Live HTTPS health returned HTTP 200 with models and authoritative account service ready. Website API through proxy returned the expected unauthenticated HTTP 401, confirming connectivity.
- Live audit showed one preserved legacy facial template and zero server Visitor accounts created by the agent. No production account reset, role/status change, template link or real recovery email was performed.
- Physical iPhone liveness, genuine returning recognition, actual mailbox delivery and end-to-end user reset/login remain external/device checks. The reported liveness rejection is unresolved; added diagnostics do not claim to repair the classifier.

Delivery is queued after the generic acknowledgement so provider round-trip time does not disclose account existence. A 202 response is request acceptance, not delivery confirmation. This development queue is process-local; restart before send completion can lose delivery. Production deployment should use a durable delivery queue, provider monitoring and explicit retention. OTP data remains in the authoritative database with expiry/attempt/used checks.
