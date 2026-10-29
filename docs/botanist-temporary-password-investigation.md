# Botanist temporary-password rejection investigation — 28 October 2026

Status: **REAL ACCOUNT FAILURE NOT YET DIAGNOSED OR CLAIMED FIXED.** Non-database source tracing, private diagnostic improvements and regression tests are complete. Actual account/store verification requires approval.

## What the evidence establishes

The reported `/password: Unable to sign in...` is the generic authentication error propagated by the mobile client. Unlike the preceding network incident, a reachable password endpoint can return this for several distinct conditions. It does not establish an incorrect password or an isolated test store by itself.

- web/server/index.mjs:11 creates one auth instance and passes that same instance to staff provisioning (line 13) and the HTTP server (line 24). In this source architecture Administrator issuance and mobile login share a store if they reach this same server instance.
- web/vite.config.ts routes local website /api traffic to loopback 3001. The checked-in gateway routes /api/mobile to the account service. The live auth process startup metadata identifies `web/server/index.mjs`; the live loopback gateway identifies `deploy/mobile-login-gateway.mjs`. That gateway source file is no longer present in this working tree, so the current gateway implementation cannot be equated with the checked-in Caddy template or a fresh deployment just from its process name.
- File-only environment resolution (without connecting) selects a non-loopback PostgreSQL target and plant_auth schema. This describes configuration currently on disk, not environment overrides loaded into the already-running process. No credentials or raw connection string were printed.
- Historical `.local-tools/mobile-login/test-accounts` artifacts exist. Their existence does not prove that either current service uses that store, or that real Administrator-created accounts are present or absent. No contents of an account database were read.
- Source supports real Administrator-provisioned Botanists through PostgreSQL, not only synthetic fixture users. Whether the current tunnel reaches the intended real store remains UNKNOWN. No runtime database was queried and no real login was attempted.
- `accountAdapter: true` in web/server/http.mjs means `Boolean(key)` for the configured Face account-adapter key. It does not verify account existence, account-store identity, password validity or that the running process has loaded the latest source.

## Complete flow and rejection points

1. web/src/components/StaffInvitations.vue calls POST /api/admin/users. web/server/operations.mjs:75 calls activation.invite using the same auth object.
2. web/server/activation.mjs:48 generates a random temporary password; line 49 hashes it with hashPassword. The account is stored Active, role Botanist, must_change_password=1 (line 85). Older activation records are consumed; the new temporary credential expires after ONE HOUR (line 91). The email callback receives the generated password only after the transaction (line 96). Resend replaces the hash and invalidates sessions and older activation records. Only the newest email credential is valid.
3. web/server/auth.mjs:12 uses a random salt and scrypt (N=32768, r=8, p=3); verification uses timingSafeEqual, with existing PBKDF2 compatibility retained. Plaintext is not stored as the password hash.
4. mobileapp/screens/Login.js normalizes the EMAIL, preserves password bytes, and calls /password. This implementation accepts email, not username; use the email on the Administrator account. mobileapp/utils/faceApi.js:98 routes this to the selected auth base plus /password, not the Face recognition endpoint.
5. web/server/http.mjs:73 accepts POST /api/mobile/password. It validates body types, invokes auth.login with Botanist/Visitor/Officer roles, and DOES NOT require a permanent password. web/server/auth.mjs:144 verifies credentials and current account state, then rechecks under the existing lock before issuing a session. Generic rejection can mean missing/deleted account, password mismatch (including an old resend credential), inactive status, expired temporary password, changed credentials, or disallowed role. Throttling returns 429 rather than 401.
6. A successful temporary login returns mustChangePassword=true. Login.js:418 keeps that pending session in component memory and renders the two new-password inputs in the SAME mobile login screen (line 668); no separate navigation screen or website activation step is involved. It does not establish normal mobile access yet.
7. Login.js:395 calls /change-password with the pending bearer token. http.mjs:86 enforces 15–128 characters. auth.mjs:288 rejects expired/inactive accounts and reuse of the current password, hashes the replacement, clears must_change_password, revokes all account sessions, and consumes activation records. The app clears the temporary state and asks the user to sign in again.
8. The old password now fails verification; the new password creates a fresh session. Pending sessions cannot access /me or normal features. Existing website login and session boundaries continue to allow only Administrator and Conservation Officer (http.mjs:112 and 127), regardless of password-change state or mobile-token reuse.

No identified source defect currently explains why THIS real account receives 401. Missing account, wrong/expired credential, runtime store mismatch and stale loaded code remain hypotheses pending approved evidence.

## Minimal changes in this investigation

- web/server/auth.mjs: optional private diagnostic sink, with default console logging enabled only by AUTH_DEBUG=1. Existing checks are centralized without changing the credential/status/role/expiry rules or SQL. Logs contain a validated random request reference, process ID, stage and enumerated reason only. No names, emails, user IDs, passwords, hashes, tokens, connection strings or keys.
- web/server/http.mjs: passes the mobile client's validated 12-hex request reference into auth.login, generates one if absent/invalid, and returns it with the generic response. The existing client displays it through parseFaceResponse. Before this change, only the signed Face bridge supplied a reference, so ordinary mobile rejection did not produce the existing debug verification log.
- web/server/client-boundary.test.mjs: extended explicit synthetic in-memory adapter and added real loopback HTTP Administrator issuance -> mobile password-change lifecycle, empty-store mismatch, detailed private-vs-public diagnostics, and expiry/resend/session-revocation tests. No working user was created in any running service; email delivery is an array callback.
- docs/botanist-temporary-password-investigation.md (this file), PENDING_WORK.md (append only).

These are diagnostics/regression improvements, not a claimed repair of the real account. They are not loaded into a long-running Node process until an authorized restart. No process was restarted here: standard startup opens PostgreSQL, which requires approval.

## Actual validation

Repository root:

```powershell
node --test web/server/client-boundary.test.mjs mobileapp/scripts/mobile-auth-routing.test.mjs mobileapp/scripts/face-api.test.mjs mobileapp/scripts/face-capture-flow.test.mjs mobileapp/scripts/api-connectivity.test.mjs mobileapp/scripts/face-session.test.mjs
```

**42 passed, 0 failed.** Six grouped boundary tests include issuance using the same auth instance, scrypt hash storage, forced password change, old-password rejection, all-session invalidation, temporary expiry/resend, separate empty-store rejection, generic errors and secret-free private logs. Existing routing/Face capture/session contracts also pass. Requests traverse the actual mobile client and actual Node HTTP handler; only test transport maps synthetic HTTPS hosts to loopback HTTP. No database engine, SQL query execution or real email service is used.

- web: npm.cmd run type-check — PASS.
- mobileapp: npm.cmd run lint and npm.cmd run type-check — PASS.
- git diff --check — PASS.

These results do not establish physical-device success, live account presence, deployment store alignment or real PostgreSQL integration. No schema/migration/SQL integration, RBAC grant/resolver, IoT/location handling or Face recognition changes; no installation, commit or push.

## Required approval before actual store verification

Approve a bounded READ-ONLY inspection of the actual account store(s) used by the Administrator website and tunneled mobile auth server. Identify which Administrator website/environment created the account and the affected account email (never send its password). Using existing configured access only, compare the actual database target AND auth schema used by both running services, then inspect ONLY that account's existence, canonical role, status, must_change_password, password-format support (classification only, never output the hash), and activation expiry/used state. Do not list other accounts, create accounts, resend email, change passwords/status, create sessions, run migrations or modify records.

A real password-login attempt is NOT read-only: existing auth writes attempt/audit records and, on success, sessions/last_login. A restart also connects to PostgreSQL. Approve those separately if wanted. The affected password should be entered locally by its owner, not shared in chat or logs. If a store mismatch is confirmed, environment alignment is also a separate authorized change; do not copy/promote accounts to hide it.

## Physical mobile verification after approval and diagnosis

1. Confirm the Administrator website and mobile auth target are the intended SAME store/schema and the running server has the intended source. If enabling AUTH_DEBUG=1, restart only the approved auth service after database-connection approval; keep logs private.
2. Using an existing authorized Botanist account, have the Administrator explicitly resend only if required. Use the newest emailed password within one hour. Do not create an account silently. Resend invalidates earlier credentials.
3. In the phone app, enter the exact account EMAIL and temporary password; avoid leading/trailing password whitespace introduced by copying. Expected: password login succeeds and new-password plus confirmation fields appear inside the mobile app. Normal features remain unavailable.
4. If rejected, record only the displayed request reference and HTTP status, then match it to the private server diagnostic. Use account_missing/password_mismatch/account_inactive/temporary_password_expired/role_denied to decide the authorized next action. Keep the public error generic.
5. Enter a matching NEW password of 15–128 characters, different from the temporary password. Expected: password change succeeds and app asks for a fresh login.
6. Verify the old temporary password is rejected and both earlier pending sessions fail. Sign in with the new password; expect authorized Botanist features and successful /me. Restart the app and verify server-confirmed session restoration.
7. Verify website login rejects this Botanist using both old and new passwords, and website /change-password, /account and protected endpoints do not grant access using the mobile session. Verify Visitor website rejection and existing Administrator/Officer website access.
8. Face recognition/device acceptance is separate; no matching logic was changed. Capture only safe status/reference evidence. Disable temporary debug logging after diagnosis. No physical-device outcome is claimed by this report.

## Runtime-only follow-up — 28 October 2026

Status: **Exact real-account rejection reason remains unverified. No additional authentication fix is claimed.** The user has not approved real database access. No tests were rerun as a substitute for runtime diagnosis, and no authentication implementation was changed in this follow-up.

Confirmed observations:

- The user reports no request-reference suffix and no password_verification log for the failed phone attempt.
- Existing Node auth PID 11648 started at 2026-10-28 18:06:18 Malaysia time. The current auth.mjs and http.mjs diagnostic code was saved at 22:16:43 Malaysia time. The previously inspected command is plain Node with web/server/index.mjs. Its statically imported modules are not automatically reloaded by editing files. The newly added diagnostic code therefore cannot be assumed active in this process; its older start time and missing reference/log are consistent with stale loaded code. This explains lack of diagnostic evidence, NOT the underlying credential rejection.
- Available .local-tools/auth-runtime.stdout.log and stderr.log were last written on 27 October, before the running auth process started. Neither contains structured password_verification events. They do not provide a rejection reason for the current incident. No raw or sensitive log content was printed.
- Existing listener PIDs: auth 11648 on loopback 3001; local website Vite 43192 on 5173; local gateway 12920 on 8080; Cloudflare 33612 with loopback metrics 20241.
- Cloudflare's live /config identifies its upstream as http://127.0.0.1:8080. /quicktunnel reports unfortunately-love-visual-send.trycloudflare.com. At this inspection /ready returns HTTP 503, readyConnections=0. This is a current connectivity fault, distinct from the already-received generic authentication rejection. It does not invalidate the user's earlier observation of a connected tunnel.
- Controlled credential-free invalid-JSON request tracing observed the local website proxy open a connection to auth port 3001/PID 11648. Completed empty JSON requests through both local website login and local mobile gateway returned HTTP 401. This proves those local invalid requests receive rejection responses; it does not inspect accounts or prove that both handlers use an identical store. No real email/password was submitted. The gateway's startup source path deploy/mobile-login-gateway.mjs, previously obtained from process metadata, is absent from this checkout, so its loaded routing implementation remains unreviewable from that file.
- Current source shares an auth instance for provisioning/login and rejects pending mobile accounts from ordinary feature access. That source architecture is not proof of which runtime account store the phone bundle and the account-creating Administrator website actually reach. Historical test-accounts files remain insufficient evidence of an isolated current environment.

Classification:

| Candidate cause | Evidence status |
| --- | --- |
| Missing/wrong-store account | Unverified; needs actual runtime target/schema/account lookup |
| Wrong or superseded temporary password | Unverified; requires correlated private diagnostic evidence or an explicitly approved owner-entered attempt |
| One-hour expiry | Enforced in source and isolated tests, but affected account's expiry not inspected |
| Inactive account / wrong role | Enforced in source, affected record not inspected |
| Client rejecting a successful temporary login | No evidence; the reported message is the backend's generic rejection, before successful-login handling |
| Stale running auth code | Diagnostic availability problem established by process/file timing and missing reference; not established as the login-rejection cause |
| Current disconnected tunnel | Observed locally; separate from the received 401 and cannot explain its credential rejection |

Next action requires explicit approval: a bounded READ-ONLY inspection using existing configured access, comparing the actual Administrator and mobile auth runtime database target and schema, then inspecting only the affected account's existence, canonical role, status, must-change flag, password-format classification (no hash output) and activation expiry/used state. Specify the Administrator website/environment and account email privately; never send its password. Do not enumerate unrelated accounts, create sessions, reset/resend, change records or run migrations. If this does not identify the cause, loading AUTH_DEBUG diagnostics requires a separately authorized auth restart (database connection) and an owner-entered login attempt (auth audit/session writes). These actions were not performed.

After the runtime/account cause is established and an authorized remedy is applied, follow the physical-device checklist above: newest email credential within one hour, forced mobile password change, old-password rejection, fresh new-password login, session revocation, and continued Botanist/Visitor website rejection. These physical checks remain pending.

## Approved investigation execution — 28 October 2026

This section supersedes earlier statements that all database access is awaiting approval. The user explicitly approved a single-service diagnostic restart, startup connection and bounded read-only inspection, but did not approve real login attempts or record changes.

### Completed, with actual database metadata evidence

- Identified the existing auth listener: PID 11648, web/server/index.mjs, loopback port 3001.
- Created `.local-tools/auth-approved-readonly.mjs`, a local inspection helper containing no credentials. It loads existing configuration files and uses a new PostgreSQL client with `default_transaction_read_only=on`, a statement timeout, and explicit `BEGIN TRANSACTION READ ONLY`.
- Queried only current database identity (reported as an opaque fingerprint), transaction read-only state, and existence of the configured `plant_auth.users` and `plant_auth.activation_tokens` relations. It selected no user rows, passwords, password hashes, token values or personal information, and rolled back the transaction.
- Initial sandboxed connection returned EACCES. Retried the same approved read-only metadata check with network escalation: connection succeeded; transaction_read_only was on; both required relations exist.
- This proves the existing file-selected database is reachable and contains the auth relations. It does NOT prove the running service loaded that exact target/schema or that the affected account exists there.
- Direct http://127.0.0.1:3001/health and gateway http://127.0.0.1:8080/auth-health both returned HTTP 200, service Niah Authentication API, ready true, accountAdapter true.
- Auth PID 11648, gateway PID 12920, Vite PID 43192 and Cloudflare PID 33612 remain unchanged with their original start times. No service was stopped or restarted. No login, account modification, password resend/reset, migration, installation, commit or push occurred.

### Blocked portions and why

The actual affected email has not been supplied. The two replies supplied literal placeholders `[enter Botanist email]` and `[ACTUAL BOTANIST EMAIL]`. Neither is a usable account identifier. The account lookup was deliberately not performed, and unrelated users were not enumerated. The Administrator environment is identified by the user as the local website running in VS Code.

To preserve runtime-only overrides, the proposed restart helper would have captured the current process environment in memory before a targeted stop. Automatic approval review REJECTED that implementation because live-process memory extraction could read credentials and force-termination could disrupt the service. Nothing in that rejected invocation executed. The unused restart helper was subsequently removed. This rejection concerns the implementation method, not a withdrawal of the user's general restart authorization. It was not bypassed.

A safe continuation needs the original service terminal/launch environment for a normal Ctrl+C restart, or confirmation that the existing configuration files contain all required settings and there are no runtime-only overrides. Do not silently replace an unknown runtime environment with the current file configuration. Do not capture credentials from process memory or force-stop the service as a workaround for the rejection.

### Current diagnosis

Restart success: NO, not executed. Existing service remains healthy. Administrator/mobile store identity: still UNVERIFIED at runtime. Account existence/role/status/must-change/hash-format/activation expiry: NOT INSPECTED because the actual email is missing. Exact real-account rejection: UNKNOWN. No corrective database change is justified by current evidence.

Next required inputs are a valid affected email (never its password) and the original auth launch terminal/environment, or confirmation that a restart may rely exclusively on the existing configuration files. After an approved safe restart, enable AUTH_DEBUG=1 and keep logs private. A real login attempt remains separately unauthorized because it writes audit/session records.

## Mandatory mobile screen and email regression follow-up — 29 October 2026

**Real-account HTTP 401 remains unverified.** The latest affected-email reply still contained a placeholder, so no account lookup was performed. No actual credential comparison, login attempt, password issuance/resend or real email was authorized or executed in this follow-up. The local listener check returned no auth/gateway listener on ports 3001/8080, and the available auth log files contained no structured rejection event. No service was started, force-stopped or restarted with unverified environment settings. These current observations do not determine the reason for the previously received phone 401.

### Confirmed UI defect and focused implementation

The previous pending-password UI appended replacement-password fields to the normal login form. Normal email/password, biometric/Face, recovery, registration and guest controls remained visible on that same form. This did not satisfy the requested dedicated mandatory Change Password screen, although backend restrictions already blocked pending users from ordinary authenticated features. It is a separate defect from the initial 401.

Login now switches its entire rendered content to MandatoryPasswordChangeScreen immediately after a successful temporary login returns mustChangePassword=true, before normal session establishment, biometric credential saving, enrollment or normal navigation. The pending token stays only in component memory. The screen exposes secure replacement and confirmation fields, submit, and sign out; it exposes no guest, registration, recovery or Face controls. It locks repeated submissions. A helper validates matching 15–128 character passwords, calls the existing /change-password endpoint with the pending bearer token, and requires the server's changed=true acknowledgement. Failure retains the mandatory state. Success discards the pending session and returns to login with instructions to use the new password; it does not establish a normal session automatically. Sign out attempts the existing logout endpoint and clears pending local credentials even if the server session has already expired.

This screen transition does NOT correct or bypass an initial server 401. No backend password-verification policy was changed in this follow-up. Existing one-hour expiry, hash verification, status, role, website allowlist, password-change session revocation and Face recognition remain unchanged.

Files changed in this follow-up:
- mobileapp/screens/Login.js — exclusive pending-password screen selection and success/sign-out handling.
- mobileapp/screens/MandatoryPasswordChange.js — new mandatory mobile screen.
- mobileapp/utils/firstLoginPassword.js — confirmation and server-acknowledgement validation.
- mobileapp/scripts/first-login-screen.test.mjs — actual Login component selection/callback and mandatory UI tests with mocked native hooks, without a device or account store.
- mobileapp/package.json — test:mobile-auth includes the new screen and existing email-adapter tests; no dependencies added.
- web/server/client-boundary.test.mjs — additional mocked delivery-failure and stored-recipient resend regression.
- docs/botanist-temporary-password-investigation.md and PENDING_WORK.md — current evidence and remaining work.

### Email implementation verified without sending mail

Source review confirms that issuance generates a random temporary password, hashes it with scrypt, persists the first-change state and activation expiry, and then invokes delivery. Resend uses the stored account's registered email rather than an incoming replacement recipient, replaces the hash, consumes old activation records and revokes old sessions. The EmailJS adapter sends the temporary_password and registered to_email variables. Provider errors are categorized into safe messages without provider-body/secret leakage. Failed delivery returns delivery=failed (202), not sent. AdminUserManagementView checks that delivery state and shows an error; a successful HTTP status alone is not treated as email delivery success.

Automated tests verified those contracts with mocked delivery and synthetic in-memory fixtures, including previous-password rejection after resend and acceptance of the newly issued fixture credential. No real provider request or inbox receipt was tested, so real email delivery is NOT claimed verified. A fresh real password/email requires an actual target email, account diagnosis and separate explicit issuance/send approval.

### Actual tests

From repository root:

```powershell
node --test web/server/client-boundary.test.mjs web/server/website-origin.test.mjs mobileapp/scripts/first-login-screen.test.mjs mobileapp/scripts/mobile-auth-routing.test.mjs mobileapp/scripts/face-api.test.mjs mobileapp/scripts/face-capture-flow.test.mjs mobileapp/scripts/api-connectivity.test.mjs mobileapp/scripts/face-session.test.mjs
```

Result: **49 passed, 0 failed**. This includes four new component/workflow tests and the delivery recipient/failure test, plus earlier temporary/permanent login, expiry/resend, session revocation, website role boundaries and Face capture/session regressions. UI tests transpile the real components using the already installed TypeScript and inject native hooks/API dependencies; they do not prove native-device rendering. Auth lifecycle tests use real loopback HTTP and the actual auth methods with an in-memory adapter; no database engine is opened by these tests.

mobileapp: npm.cmd run lint — PASS; npm.cmd run type-check — PASS.
web: npm.cmd run type-check — PASS.
git diff --check — PASS.

### What is still needed for the actual account

Supply the affected Botanist's actual valid email privately (not another bracketed placeholder, never its password). The existing bounded read-only authorization can then be used to inspect only that account's role/status/must-change/hash-format classification and activation expiry/used metadata. Verify the actual Administrator and mobile runtime store/schema using verified launch settings; the earlier configured-database metadata check is not proof of live target alignment. If diagnostics need an auth startup, use verified configuration without force-stopping another process. No actual-account change is justified before that evidence.

After the cause is established, obtain separate approval before generating/resending a real temporary password or sending mail. With approved delivery and an approved owner-operated login attempt, the phone checklist is: normal Email/Password fields with newest credential within one hour -> dedicated mandatory screen -> matching new password -> fresh login using the replacement -> old credential and old-session rejection -> authorized Botanist features. Botanist/Visitor website login must still fail. Physical-device and actual delivery results remain pending.

## Affected account read-only result — 29 October 2026, 07:34 Malaysia time

The user supplied a valid affected-account email. It was used solely as a parameter for the approved lookup and is intentionally omitted from this report. No password was requested or supplied. No real login was attempted.

`.local-tools/auth-account-readonly.mjs` connected using existing file configuration and opened `BEGIN TRANSACTION READ ONLY`, with default_transaction_read_only enabled and a statement timeout. The database returned only the permitted account metadata and a server-side password-format classification. It did not return password/hash/token values, user identifiers, unrelated accounts or other personal data. The transaction was rolled back and the connection closed.

Confirmed at 07:34:08 Malaysia time:

| Permitted check | Result |
| --- | --- |
| Matching account in file-configured authentication store | Exactly one |
| Exact normalized-email match used by auth.byEmail | Yes |
| Role | Botanist |
| Status | Active |
| Mandatory password change | Required |
| Password storage classification | Supported scrypt format; raw hash never returned |
| Activation records | One, unused |
| Unexpired unused activation | Present |
| Expired unused activation blocking login | None |
| Recorded temporary-password expiry | 29 October 2026, 08:31:57 Malaysia time |
| Database clock compared with inspection host | Matched at inspection |

These results rule out absence, status, role, unsupported stored format, used activation and expiry in this inspected store at that time. They do NOT verify that the emailed password equals the stored credential; that requires an explicitly authorized owner-entered authentication attempt, not reading a hash or asking for a password in chat. Validity after 08:31:57 is not implied. No expiry was extended.

### Current runtime routing evidence

- Node auth now listens on 127.0.0.1:3001 as PID 26504, started 29 October at 07:29:41 Malaysia time, after the diagnostic source changes. GET /health returns 200, ready=true. accountAdapter=false only means the signed Face bridge key is not enabled in that instance; it is not a requirement for direct mobile password authentication.
- The current mobile file configuration selects development and uses https://computation-warriors-you-agencies.trycloudflare.com/api/mobile. A phone bundle may still retain earlier embedded configuration, so file settings are not proof of its actual request URL.
- Cloudflare PID 29096 exposes metrics on loopback 20242. Its /quicktunnel hostname matches that configured mobile hostname. /ready returned HTTP 503 with zero active connections; /config targets http://127.0.0.1:8080. No gateway listener was found on 8080. The configured public hostname returned ENOTFOUND while an independent DNS control resolved.
- Thus the local Node auth service is healthy, but the CURRENT configured mobile route cannot reach it. No tunnel/gateway/config changes were made under this read-only investigation.
- The source Administrator provisioning and mobile endpoint share the same auth object in web/server/index.mjs, and the website's configured API proxy points to Node 3001. The supplied account exists in the file-configured store. Runtime store equality with the phone remains unverified because its configured public route is unavailable and running-process overrides/embedded phone settings have not been established. No environment mismatch is claimed proven merely from the failed route.

### What is and is not diagnosed

Confirmed: account eligibility and activation state in the configured store are correct at the inspection timestamp; CURRENT tunnel/gateway reachability is broken. This connectivity fault would cause a transport failure now, not the historical generic password-verification 401. The original 401 rejection reason remains unverified: no account-correlated private diagnostic was available, no real password verification was attempted, and the phone's actual target/build cannot yet be established. The existence of supported scrypt syntax does not prove that the entered password matches it. No authentication-policy or account-data fix is justified by this evidence.

The mobile source already switches to MandatoryPasswordChangeScreen after a successful temporary login returns mustChangePassword=true, before normal session establishment. The dedicated screen and backend revocation behavior were covered by the earlier 49 passing tests. No tests were rerun or code changes made in this read-only follow-up, and no physical-phone result is claimed.

### Phone testing steps after connectivity is restored

1. Restore the existing approved gateway/tunnel route so the current phone-reachable HTTPS auth base reaches Node /api/mobile on 3001. Its health endpoint must return the auth service identity, and Cloudflare readiness must show active connections. Do not invent a hostname, disable TLS, or expose internal Face adapter routes. Restoration/startup is outside this read-only execution.
2. Confirm mobileapp/.env.local and the phone's current bundle use that verified auth base. Reload/rebuild Expo as appropriate after a URL change. Do not change RBAC or database settings to solve a tunnel problem.
3. On the phone, the account owner enters the registered email and newest emailed temporary password in the normal login fields, before the recorded expiry. This investigation has not attempted that login on the owner's behalf. A successful response must lead directly to the dedicated Change Password screen with no normal feature controls.
4. Enter matching new passwords of 15–128 characters, different from the temporary password. After server-confirmed change, sign in again with the new password. Check old-credential and old-session rejection and continued Botanist/Visitor website rejection.
5. If the phone still receives 401, retain only its request reference and match the private password_verification reason in the auth terminal. Do not share the password, hash or token. That can distinguish password_mismatch from policy denial or an account_missing result on another target.
6. If expiry passes before testing succeeds, a fresh issuance/resend must be separately approved. It will replace the existing credential; do not issue, resend or extend expiry silently. Real email delivery is confirmed by the user; no additional email was sent here.

## Live connectivity restored and mobile bundle refreshed — 29 October 2026

This section supersedes earlier entries saying connectivity restoration had not been authorized or executed. The user explicitly authorized gateway/tunnel startup, four mobile URL updates with backup, Expo refresh, non-destructive HTTP checks, tests and the existing bounded account inspection. Real credential login, account changes and fresh password/email issuance remain unauthorized.

### Actual implementation and running services

The previously used Node gateway source was missing, and Caddy was not installed. Restored `deploy/mobile-login-gateway.mjs` as a dependency-free Node equivalent of the existing checked-in Caddy routing, with command `node deploy/mobile-login-gateway.mjs`. It binds ONLY 127.0.0.1:8080. /auth-health forwards to auth :3001/health; /api/auth/*, /api/admin/* and /api/mobile/* preserve their path and reach auth :3001. Existing /face/* routing strips only that prefix and reaches :8000; existing plant API routes reach :3000. Internal/private/file paths are denied, redirects rejected, hop/proxy identity headers filtered, bearer/Origin/body forwarding preserved, request size bounded, and upstream failures sanitized. No static files, credentials or request bodies are logged/served. No IoT/Face recognition implementation was changed and no IoT/Face service was started.

Started gateway PID 44468. Started replacement Cloudflare PID 32060 using the existing executable, HTTP/2, loopback gateway and separate metrics port 20244. The disconnected older tunnel was left untouched; no process was force-killed. The auth service PID 26504 remained running and was not restarted; sanitized startup metadata confirms the standard server/index.mjs entrypoint. No process environment memory was read.

Actual tunnel command, from project root:

```powershell
& '.\.local-tools\cloudflared\cloudflared.exe' tunnel --url http://127.0.0.1:8080 --protocol http2 --metrics 127.0.0.1:20244 --no-autoupdate
```

Actual current hostname: **https://scores-enzyme-boundary-talent.trycloudflare.com**. Do not assume it survives a future quick-tunnel restart. The new tunnel /ready returned HTTP 200 with one active connection. Local and PUBLIC HTTPS probes passed:

| Probe | Actual result |
| --- | --- |
| 127.0.0.1:8080/auth-health | 200, Niah Authentication API, ready true |
| 127.0.0.1:8080/api/mobile/health | 200, same service |
| Public /auth-health | 200, same service |
| Public /api/mobile/health | 200, same service |
| Public POST /api/mobile/password with JSON {} only | 401, expected invalid-input rejection; no credential verification attempted |
| App's own check-api-connectivity.mjs auth | auth: ready |
| Local website / | 200 |
| Local website /api/mobile/health | 200, same auth service |

The restored local website is http://localhost:5173 (Vite PID 29656). Its API proxy and the restored public mobile route converge on the same loopback 3001 standard auth service, which constructs one auth adapter for provisioning and mobile login. This establishes common server routing; actual phone bundle use still requires reloading on the phone. The bounded account inspection below uses the existing configured database files; no runtime-only credential overrides were extracted, so health alone is not claimed to fingerprint the PostgreSQL connection.

### Four URL values backed up and changed, nothing else

Backup: `.local-tools/mobile-login/mobile-env-backup-2026-10-28T23-42-05-977Z.txt`.

Only these existing values in ignored mobileapp/.env.local were changed:
- EXPO_PUBLIC_AUTH_API_URL and EXPO_PUBLIC_AUTH_API_URL_DEVELOPMENT -> current hostname + /api/mobile.
- EXPO_PUBLIC_FACE_API_URL and EXPO_PUBLIC_FACE_API_URL_DEVELOPMENT -> current hostname + /face.

A byte-content comparison with the four values masked confirmed all unrelated settings stayed unchanged. Environment selection resolves development and the new auth URL. The Face prefix is preserved; recognizer availability is not claimed or required for direct password login.

Started the missing Expo server with the installed CLI, cleared cache, LAN mode and port 8081 (PID 40852). The first launch exited because this SDK disallows combining --offline and --host; the supported LAN-only launch then succeeded. No existing Expo service was stopped. No packages were installed or updated. Node core startup commands were launched hidden with local stdout/stderr logs under .local-tools.

```powershell
# From mobileapp, using existing installed CLI:
node node_modules/expo/bin/cli start --clear --host lan --port 8081 --max-workers 2
```

Metro /status returned 200, packager-status:running. The phone-facing Wi-Fi manifest returned 200 and advertises **192.168.1.4:8081**, including a launch asset on that host. Phone entry: **exp://192.168.1.4:8081**, on the same Wi-Fi. A complete served Android development bundle returned HTTP 200 (9,491,101 characters at this check): it contains the CURRENT working auth hostname and dedicated mandatory-password screen, and DOES NOT contain the retired hostname. Thus the served bundle is refreshed; no claim is made that a phone has loaded it yet.

### Actual affected-account metadata recheck

Approved read-only transaction at **07:42:48 Malaysia time**: exactly one matching account in the configured store; Botanist; Active; mandatory change required; supported scrypt classification; one unused activation; unexpired at inspection; no expired-unused activation blocking login. Recorded expiry remains **29 October 2026, 08:31:57 Malaysia time**. Raw password/hash/token values were not selected or returned. No records, timestamps or passwords were modified. The provided email is deliberately omitted from logs and this report.

This establishes that account absence/status/role/format/expiry do not explain a rejection in that inspected store at that time. It does not prove that any particular entered password matches the stored credential, nor that a previous phone attempt used this refreshed URL/build. No new password or real email was generated, sent or resent.

### Original HTTP 401: honest remaining limit

The confirmed network defects (missing gateway source/listener, disconnected tunnel, retired URL) are repaired and verified through real HTTP. No credential-verification code defect was established, so hashing, expiry and RBAC policies were not changed to force success. The real password has not been submitted; the original 401 is NOT claimed fixed. An owner-entered phone test using the refreshed bundle is required. A continuing 401 must be correlated via its request reference with the private password_verification reason from the auth terminal; no password/hash/token should be shared. If logging is not enabled in the user's auth process, a separately authorized non-disruptive restart with verified launch configuration may be needed; this execution did not restart that process.

### Tests actually run

```powershell
node --test deploy/mobile-login-gateway.test.mjs web/server/client-boundary.test.mjs web/server/website-origin.test.mjs mobileapp/scripts/first-login-screen.test.mjs mobileapp/scripts/mobile-auth-routing.test.mjs mobileapp/scripts/face-api.test.mjs mobileapp/scripts/face-capture-flow.test.mjs mobileapp/scripts/api-connectivity.test.mjs mobileapp/scripts/face-session.test.mjs
```

**51 passed, 0 failed.** Includes two new real-HTTP gateway/security-routing tests plus the prior auth, Administrator issuance/resend/failure, forced-screen, old/new credential, revocation, website role and Face client regressions. These tests use synthetic in-memory fixtures, not real accounts. mobileapp npm.cmd run lint and npm.cmd run type-check PASS; web npm.cmd run type-check PASS; git diff --check PASS. The public HTTPS and Wi-Fi/Metro checks above are separate runtime evidence, not inferred from these tests. Initial sandboxed public probes returned EACCES; authorized network escalation then verified actual HTTPS success.

Files changed in this execution: deploy/mobile-login-gateway.mjs (restored/new), deploy/mobile-login-gateway.test.mjs (new), mobileapp/.env.local (only four authorized values, backed up), mobileapp/package.json (gateway test added to test:mobile-auth only), docs/botanist-temporary-password-investigation.md and PENDING_WORK.md (append). Logs/backups/read-only helpers under ignored .local-tools contain no printed account credentials. Existing teammate/security edits were preserved.

### Final real-phone checklist

1. On the same Wi-Fi, reopen the app from **exp://192.168.1.4:8081** and reload it. An already-installed standalone release must use a new bundle/build; merely changing .env.local does not update an old installed release.
2. On the phone browser verify https://scores-enzyme-boundary-talent.trycloudflare.com/auth-health returns ready JSON, without a sign-in redirect.
3. Before the recorded 08:31:57 MYT expiry, the owner enters the registered email and newest delivered temporary password in the normal Email/Password fields. Do not send credentials to Codex.
4. Expect the exclusive Change Password screen. Enter matching new passwords of 15–128 characters. After success, sign in freshly with the new password.
5. Verify the old temporary credential and prior sessions no longer work, and Botanist/Visitor website access remains rejected. Only user-owned phone attempts are described here; none were executed by the agent.
6. If 401 remains, send only its request reference and safe private diagnostic reason. If the credential has expired, fresh issuance/resend requires separate approval; nothing here extends expiry or issues a password.

## Reproducible phone rejection, reference 6f19a0734712 — 29 October 2026

**Original real login status: STILL FAILING as reported by the user's real phone test. No real success is claimed.** The user explicitly chose to keep the existing backend running when asked about activating the repair below. No backend process was restarted or force-stopped, and no real credential login, password change, resend or email was executed.

### Exact reference search and limits

Searched the retained auth, gateway, tunnel and Expo log files under .local-tools for the exact reference. There were zero matching lines. The available auth-runtime stdout/stderr files predate the currently running backend; the current gateway intentionally does not retain request credentials or bodies. Source auth.mjs emits verification details only through its diagnostic callback, whose prior default console implementation requires AUTH_DEBUG=1. The existing configuration files contain no AUTH_DEBUG setting; runtime-only overrides were not read, so whether the live terminal enabled it cannot be asserted. No current retained private verification event is available for the reference. The legacy auth_events table has no reference field, so it cannot recover exact reference correlation.

The reference in the phone error is consistent with the Node /api/mobile/password result handling: a validated client reference is passed to auth.login and returned with the generic response. Current routing converges on Node3001, but health responses alone cannot prove the historical reference used a particular runtime database or lookup key. The reference itself does not encode a rejection reason.

### Bounded read-only account and safe history inspection

At 07:58:09 Malaysia time, the approved account lookup still returned exactly one matching normalized email, Active/Botanist, must-change required and supported scrypt classification. One activation record remained unused, unexpired at inspection, and expiring 08:31:57 MYT on 29 October. Database/host clocks matched. No hash/password/token values were returned.

An additional read-only query inspected only safe issuance/rejection/success reason codes and timestamps for this exact account, excluding IPs, actor/user identifiers, credential values and unrelated accounts. The only matching event was invitation_created at 07:31:57.645 MYT. There was no recorded newer issuance or account-linked invalid_credentials, account_blocked or authenticated event in the bounded 24-hour history. Activation record count remains one.

This does NOT establish a bad password. A rejected password for a successfully resolved account should produce an account-linked invalid_credentials event in the inspected store. A different lookup key/account_missing result or a different runtime store could explain the lack of linked events, but neither is confirmed. No unrelated/null-account attempts were enumerated to guess the answer. A supported hash format does not prove a match, and current eligibility does not prove past request eligibility.

### Confirmed defect repaired in source: missing diagnostic retention/runtime identity

Added web/server/auth-diagnostics.mjs and wired it into web/server/index.mjs. In development the updated entrypoint retains sanitized diagnostics by default; production remains off unless AUTH_DEBUG=1. It writes a bounded private auth-diagnostics.ndjson plus one rotated previous file under ignored web/server/data, with mode 0600 on supported platforms. Only timestamp, process/opaque-instance identity, opaque configured-store fingerprint, validated request reference, enumerated stage and enumerated reason are admitted. Names, emails, account identifiers, payloads, passwords, password hashes, tokens, keys and connection strings are discarded. Logging failures do not change auth outcomes.

The fingerprint includes normalized database target/database/schema but excludes credentials; it allows comparison of the running application's own configuration with the read-only inspector without reading another process's memory or exposing settings. A new GET /internal/auth/diagnostics endpoint supplies only the opaque runtime identity, is disabled with diagnostics, requires loopback and no browser Origin, and is denied by the existing gateway internal-path rule. No log content or account data is exposed through that endpoint.

Added four focused tests for retained safe correlation, redaction, validation/rotation and production gating, credential-independent store fingerprinting, and loopback-only identity access. Expanded gateway denial coverage for this new internal path.

**Activation pending:** the running Node process has not loaded this patch. The user selected 'Keep backend running for now'; this choice was respected. The patch cannot retroactively recreate the missing event for 6f19a0734712. No credential policy, expiry, hashing algorithm, role grant, database schema or SQL adapter was changed to make login pass.

Changed files in this follow-up:
- web/server/auth-diagnostics.mjs (new)
- web/server/auth-diagnostics.test.mjs (new)
- web/server/index.mjs (wire private diagnostic retention and opaque identity)
- web/server/http.mjs (loopback-only internal identity endpoint)
- deploy/mobile-login-gateway.test.mjs (explicit private-path denial regression)
- docs/botanist-temporary-password-investigation.md and PENDING_WORK.md (append)

Read-only helper .local-tools/auth-account-events-readonly.mjs contains no hardcoded identity or secret; the account key is provided through stdin and never printed. Existing teammate/security changes remain preserved.

### Full real workflow status

PASS below means the stated evidence only; source/fixture checks are distinguished from real credential success.

| Stage | Status | Evidence |
| --- | --- | --- |
| A Administrator creates Botanist | PASS | User confirmation and scoped invitation_created record |
| B Account saved in configured PostgreSQL store | PASS | One exact normalized-email account found read-only |
| C Temporary issuance | PASS | One recorded issuance/activation; secure generation/hash source reviewed |
| D Real email delivery | PASS | User explicitly confirmed receipt; no new send attempted |
| E Phone uses expected auth URL | NOT VERIFIED for failed attempt | Served Android bundle has current URL; actual failed phone bundle not retained |
| F Mobile submits password request | PASS, outcome rejected | User's real HTTP401 and request reference; credential values intentionally unavailable |
| G Failed reference reaches expected Node instance | NOT VERIFIED | Current gateway routes correctly; no retained exact-reference event |
| H Failed request resolves this account in expected store | NOT VERIFIED | Inspected account exists, but no account-linked login event |
| I Entered credential matches stored scrypt credential | NOT VERIFIED | Never submitted or retrieved; generic 401 is not a precise category |
| J Real request passes activation/status/role gates | NOT VERIFIED | Inspected account is eligible at 07:58; exact request execution unknown |
| K Temporary login returns mustChangePassword state | FAIL in real reported flow | User received 401, not success |
| L Phone opens mandatory change screen | NOT VERIFIED for this account | Blocked by K; real component/served bundle and isolated tests pass |
| M Real permanent password saved | NOT VERIFIED | No real password-change operation authorized or executed |
| N Real temporary credential/old sessions revoked | NOT VERIFIED | Source/fixture tests pass; M not performed |
| O Real permanent-password login | NOT VERIFIED | No owner success reported and no agent credential attempt |
| P Botanist website denial | PASS in source/isolated regression | Existing backend allowlist and role/session tests unchanged; no prohibited real login attempted |

### Live checks and actual tests

Current public hostname remains https://scores-enzyme-boundary-talent.trycloudflare.com. Local auth, gateway and Expo checks all return 200; tunnel readiness returns 200/one connection. Public /auth-health and /api/mobile/health return 200/ready; public /internal/auth/diagnostics returns 404. The served full Android bundle returns 200 and contains both the current hostname and mandatory-change screen. No URL changed and no .env backup/update was needed in this follow-up. An empty-payload 401 was NOT treated as real-login success.

```powershell
node --check web/server/index.mjs
node --test web/server/auth-diagnostics.test.mjs deploy/mobile-login-gateway.test.mjs web/server/client-boundary.test.mjs web/server/website-origin.test.mjs mobileapp/scripts/first-login-screen.test.mjs mobileapp/scripts/mobile-auth-routing.test.mjs mobileapp/scripts/face-api.test.mjs mobileapp/scripts/face-capture-flow.test.mjs mobileapp/scripts/api-connectivity.test.mjs mobileapp/scripts/face-session.test.mjs
```

**55 passed, 0 failed.** Mobile lint and type-check PASS, web type-check PASS, diff check PASS. Tests used mocks/in-memory fixtures and temporary diagnostic files, never the real password. No production credential match was inferred from them.

### Required next real verification, respecting the keep-running decision

Exact historical reason cannot be recovered from the available logs. To distinguish wrong lookup from wrong store or wrong password, either provide an existing safe terminal event for the reference if one was retained elsewhere, or later authorize a controlled restart with verified launch configuration so the retained diagnostics and opaque store-identity probe become active. No further restart was requested after the user declined it.

After diagnostics are active and store alignment is checked, the owner can open Expo Go -> exp://192.168.1.4:8081 on the same Wi-Fi -> Reload the latest bundle. The owner enters the newest credential locally. Capture only the reference and private reason/stage if 401 occurs. A fresh temporary password, if needed after expiry, must be explicitly approved before Administrator Dashboard -> User Management -> affected Botanist -> Resend temporary password; that invalidates the previous credential. Never paste the password into Codex. On successful login expect Change Password, enter matching 15–128 character replacement, then sign in freshly using it and verify old-credential rejection. No success is claimed until that real phone flow completes.

## Controlled auth restart approval: safe-stop blocker — 29 October 2026

The user approved restarting ONLY auth port 3001, preserving configuration, with no force kill or entire-process environment capture. Process inspection identified the current listener as PID 26504, node.exe, startup script server/index.mjs. Its ancestry is npm run server under a shared npm run dev / run-p task tree owned by VS Code. The parallel launcher was verified from sanitized process metadata. No environment values or raw command lines were printed.

A console Ctrl+C to that shared launch can affect sibling tasks and does not provide a verified auth-only stop. On Windows, programmatic Node process.kill/subprocess.kill with SIGINT/SIGTERM unconditionally terminates the target rather than guaranteeing the registered graceful shutdown handler. Therefore no stop signal, force kill, terminal interrupt, restart or environment capture was performed. This follows the user's explicit instruction to stop and explain if configuration preservation or graceful stopping cannot be established. Reference: https://nodejs.org/download/release/v24.11.0/docs/api/process.html .

Actual current checks, with PID unchanged:
- 127.0.0.1:3001/health -> 200, auth service ready.
- 127.0.0.1:3001/auth-health -> 401 in the still-running old code (that alias previously existed only at the gateway).
- 127.0.0.1:8080/auth-health -> 200, auth service ready.
- Cloudflare metrics 20244/ready -> 200, one connection.
- Current public /auth-health -> 200, ready, hostname unchanged.
- Public /internal/auth/diagnostics -> 404, correctly blocked by gateway.
- web/server/data/auth-diagnostics.ndjson does not yet exist; updated retained diagnostics remain NOT ACTIVE in the unchanged process.

Prepared the missing direct /auth-health alias in web/server/http.mjs alongside existing /health and /api/mobile/health, so the next updated launch meets the requested direct health URL without account/session lookup. Added a regression to auth-diagnostics.test.mjs. Five focused diagnostics/health tests PASS, index syntax check PASS, diff check PASS. These source changes are not claimed live until the approved safe restart can occur. No database/schema/account/RBAC change was made.

Safe manual continuation:
1. Do NOT send Ctrl+C to the shared npm run dev tree if only auth may be stopped. There is no verified auth-only graceful stop command for this existing shared launch. The service owner must provide an isolated auth console/stop control, or separately decide to pause the shared launcher and its sibling task(s). That broader stop was not authorized or performed by the agent.
2. After the owner has gracefully stopped the auth listener, retain the original launch terminal/environment and use the existing configuration files. Do not copy/print DB environment values. In PowerShell, guard against a still-running listener before starting the new dedicated auth process:

```powershell
Set-Location 'C:\innovation project\Smart-Ground-Truthing-and-Digital-Biodiversity-System-for-Plant-Species\web'
if (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue) {
  throw 'Auth is still running. No process has been stopped.'
}
$env:AUTH_DEBUG = '1'
$env:HOST = '127.0.0.1'
$env:PORT = '3001'
node server/index.mjs
```

3. Run auth standalone, rather than under run-p, so future Ctrl+C in THIS auth-only terminal affects only auth and invokes its shutdown handler. Keep existing DB/auth settings unchanged. If runtime-only overrides were used previously, preserve them in the original terminal rather than reconstructing values.
4. After startup verify /auth-health and /internal/auth/diagnostics locally, compare opaque store identity with the configured target, and inspect only sanitized auth_runtime metadata in web/server/data/auth-diagnostics.ndjson. Verify gateway/public health still passes and public internal path stays 404.
5. Only after actual activation is confirmed ask the owner for one fresh phone attempt and its reference. No phone retry was requested as though diagnostics were active; no real login was executed.

Result: restart NOT EXECUTED; old PID remains 26504; diagnostics activation/database identity for a new process remain pending a verified auth-only graceful stop. No claim of successful restart or fixed real credential login is made.

## Shared-launcher pause approved: owning-terminal access unavailable — 29 October 2026

The user authorized a temporary graceful Ctrl+C pause of the shared npm run dev launcher, followed by standalone auth and restoration of sibling tasks. No additional permission was requested, no processes were terminated by PID and no taskkill/environment capture was used.

Read-only process-tree inspection identified:
- npm run dev root PID 35244 -> run-p PID 41588.
- Auth branch: npm server PID 23080 -> cmd PID 34968 -> node PID 26504, script server/index.mjs, listener 127.0.0.1:3001.
- Sibling branch: npm dev:client PID 19996 -> cmd PID 40496 -> Vite PID 27656, listener [::1]:5173.
- Independent Vite PID 29656 listens on 127.0.0.1:5173 and is outside this shared tree.
- Gateway PID 44468 on 127.0.0.1:8080, Expo PID 40852 on 8081, and replacement tunnel PID 32060/metrics 20244 are outside the shared launcher and would not need restarting for this pause.

Existing startup configuration files were checked without printing values: backend .env exists and parses into valid DB options, web/.env.server and mobileapp/.env.face are absent. A credential-excluding expected store fingerprint can be calculated. This does not prove whether the original owning shell has additional runtime overrides; preserving that original shell is necessary rather than reconstructing secrets.

Attempted supported Windows desktop access through @oai/sky list_apps and the alternative cua inventory. Both failed with the concrete error: 'Computer Use native pipe is unavailable ... The system cannot find the file specified. (os error 2)'. No app/window was selected and no keys or terminal commands were sent. Consequently the exact visible VS Code terminal cannot be verified or controlled. User instructions explicitly require stopping with manual instructions if owning-terminal access/configuration cannot be established, so execution stopped before Ctrl+C.

Result: NO services stopped or restarted; auth PID remains 26504; retained diagnostics remain inactive. Current auth /health, gateway /auth-health, IPv4 website and Expo status are 200; public auth-health is 200 and public internal diagnostics is 404. No real credential/account operation or DB change occurred. No fresh phone retry is requested until diagnostic activation is actually confirmed.

Manual continuation must occur in the original VS Code terminal that visibly shows npm run dev -> run-p server dev:client. Ctrl+C pauses that approved shared task, including its IPv6 Vite sibling. Keep the original shell open to preserve settings; if it closes or its overrides cannot be verified, stop rather than guessing secrets. If it is cmd, enter powershell.exe -NoLogo after the launcher exits, which inherits that shell's environment. Guard that 3001 is free. In that same preserved environment set AUTH_DEBUG=1/HOST=127.0.0.1/PORT=3001 and launch node server/index.mjs in a dedicated PowerShell window; restore npm.cmd run dev:client in a second dedicated window with the same web working directory. Do not run npm run dev again or start another auth copy. Existing independent IPv4 Vite, gateway, tunnel and Expo should be left running. After startup verify the loopback identity and retained auth_runtime log before any phone retry.

## Backend lifetime investigation — 29 October 2026

The two previously started auth processes had exited with no retained exit reason; no matching Windows Node crash event was available. Original source remained healthy in a 40-second real-entrypoint/port3001 baseline, including idle-pool intervals; overlapping signal test exited cleanly. Historical spontaneous exit cause remains UNVERIFIED, not attributed to credentials, pool timeout or external termination without evidence.

Added strict secret-free lifecycle retention and safe shutdown/cleanup diagnostics; auth_runtime is now emitted only after listening succeeds. An instrumentation wiring error caught in a controlled test was corrected before deployment. Updated real-entrypoint run stayed healthy for 40 seconds and logged exact requested SIGTERM shutdown/exit0. Started the missing backend independently as PID22584 using the verified existing target/schema. Ten health/identity samples over45seconds passed; launch parent42100 had exited while auth remained alive. Direct/gateway/public auth health are200, private identity200/diagnostics active/store fingerprint matches, public internal path404. No existing service was killed or restarted; no real credentials or account changes.

Full regression61pass/0fail; lifecycle/diagnostic10pass; oxlint/type-check/syntax/diff pass. See docs/auth-backend-lifecycle.md for exact files, controlled probes, honest cause limits, logs and guarded restart commands. Primary retained log is web/server/data/auth-diagnostics.ndjson. Diagnostic activation is NOW confirmed, superseding earlier pending-activation entries. The original Botanist real-login failure remains separate and is not claimed fixed by process-lifetime stability.

## Original mobile workflow focus with active diagnostics — 29 October 2026, 08:52 MYT

No backend, gateway, tunnel or Expo was stopped or restarted in this follow-up. PID22584 remained active and its private runtime identity reported diagnosticsEnabled=true. The live opaque target/schema fingerprint matches the existing configuration used by the bounded read-only account inspection. This resolves the previous uncertainty about the currently running backend versus the inspected configured store; it does not reconstruct historical pre-diagnostic requests.

### Actual 401 evidence and confirmed current blocker

The retained diagnostic file still contains **zero password_verification events**. No relevant event exists to attribute the original historical 401/reference to a precise verification branch. The current account was inspected read-only at 08:52:04 MYT: one exact lookup match, Active/Botanist, must-change required, supported scrypt classification, one unused activation expiring **29 October 2026 at 08:31:57 MYT**. Now expiredUnusedBlocksLogin=true and unexpiredUnusedExists=false. The database and host clocks agree. No raw hash, token, password, identifiers or unrelated account records were returned.

**Confirmed current cause of ineligibility: temporary-password expiry.** The existing credential must be rejected now even if its password bytes are correct. This does not prove expiry caused the earlier phone 401 while previous checks showed it unexpired. Password correctness for the real email remains untested; no real credential was submitted. Do not silently extend expiry, bypass verification or change roles to make it pass.

### Request and response trace verified in source

- Login.js handleLogin normalizes email by trimming/lowercasing and passes the password string unchanged into faceApi('/password', {email,password}). No credential value is logged.
- createMobileApi selects auth, never the Face service, for password/session/change operations. Current configured endpoint is https://scores-enzyme-boundary-talent.trycloudflare.com/api/mobile/password. It POSTs JSON fields email/password with a validated-format correlation header; no bearer is needed for initial credential verification. Returned HTTP errors retain status/reference separately from transport failures.
- Gateway forwards /api/mobile/* unchanged to loopback3001, preserving request body, Origin and authorization where present. The auth server checks payload types, invokes the existing auth.login with Botanist/Visitor/Officer roles and does not require a permanent password for this route.
- Auth lookup uses normalized email, verifies scrypt (or supported legacy compatibility), then checks status, expiry, role and current credential state; it rechecks account policy under the existing transaction lock before creating a session. Public failure stays generic; private reason is retained for an actual attempt.
- Temporary success returns mustChangePassword=true. Login exits before normal session establishment and exclusively renders MandatoryPasswordChangeScreen. Its token stays in component memory; ordinary mobile /me remains blocked until password change.
- The screen uses changeFirstLoginPassword to check matching 15–128 character fields, send the pending bearer to /change-password, and require changed=true acknowledgement. Backend hashes the replacement, clears must-change, revokes account sessions, and consumes activation records. App returns to fresh login. Website allowlist remains Administrator/Officer only.

No confirmed production credential-handling/navigation defect was found in this follow-up, so no production auth policy or account code was changed speculatively.

### Strengthened isolated test and actual result

Extended web/server/client-boundary.test.mjs with an end-to-end scenario that uses an explicit synthetic in-memory account store, real Administrator provisioning/auth HTTP handler, the actual gateway on an ephemeral loopback port, actual mobile client, and the same mandatory-change helper called by the screen. Mock delivery records only synthetic messages in memory. It checks:
- Administrator login/issuance through the gateway;
- initial mobile password request method/path/field names/reference metadata, without logging values;
- pending session cannot reach ordinary /me;
- expired credential rejection with private temporary_password_expired reason;
- Administrator resend through the gateway invalidates earlier credential/session;
- newest temporary credential succeeds;
- mismatched confirmation is blocked before any HTTP submission;
- successful replacement requires acknowledgement and invalidates all earlier sessions/activation records;
- old temporary rejection, new permanent login and /me success;
- website login and website password-change rejection even with a mobile session;
- private test diagnostics contain no synthetic credential/token values.

```powershell
node --test web/server/client-boundary.test.mjs mobileapp/scripts/first-login-screen.test.mjs
```

**12 passed, 0 failed.** This includes the actual component selection/callback tests and the new gateway-to-helper integration. git diff --check PASS. No database engine or real user was changed by the tests, no real delivery occurred, and no test result is claimed as real phone success. Production retained verification-event count remained zero, demonstrating these synthetic tests did not submit credentials to the live backend.

Changed files in this follow-up: web/server/client-boundary.test.mjs and the appended report/PENDING_WORK.md only. No production code changes, restarts, installations, commits or pushes.

### Minimum remaining real-phone verification

The existing credential has expired. An Administrator must explicitly issue/resend a fresh credential to the existing registered account before a meaningful success test. This modifies the real account and sends email; the agent has NOT done it and requires separate approval to do so. The Administrator may perform the action themselves through User Management -> affected Botanist -> Resend temporary password. Use only the newest email.

Then open/reload the existing Expo app (same Wi-Fi: exp://192.168.1.4:8081), enter registered email and the newest temporary password in the normal form within its one-hour validity, expect the dedicated Change Password screen, enter matching new passwords, and sign in again with the replacement. Verify the prior temporary password is rejected. If 401 persists, provide only the new reference; active private diagnostics can now identify its exact reason without sharing passwords or restarting services. The original historical 401 remains unproven; the current expired credential and isolated successful workflow are confirmed separately.

### 2026-10-29: confirmed phone-time account lookup failure and retry UI correction

This update supersedes the earlier expired-credential advice: a newer invitation was recorded at 08:59:37 MYT, expiring at 09:59:37 MYT. At the bounded 09:03 read-only inspection it was unused and unexpired. The account was Active/Botanist, required password change, and had a supported scrypt format. No password, hash, token, account identifier or unrelated record was returned.

The user confirms a phone attempt at approximately 09:01 MYT. Retained diagnostics record password_verification at 2026-10-29T01:01:03.215Z (09:01:03 MYT), reference 2f22785aab6e, reason account_missing, stage verification, PID 22584. Neither retained log contains reference 6f19a0734712. This is a time-correlated current-backend request, not proof that the old displayed reference belongs to that response. Missing account lookup prevents verification; this event does not establish password mismatch or expiry.

The configured Administrator/mobile store fingerprint matches the running backend. The registered address resolves using the actual PostgreSQL adapter and the same parameterized users lookup inside a READ ONLY transaction. Account table row-level security is disabled. Source normalizes both issuance/login with trim().toLowerCase(); no confirmed normalization defect was found. The historical event does not retain submitted email bytes, so the exact identifier discrepancy remains unverified. Do not change account records or password verification to compensate.

Confirmed display defect: Login retained the previous error during a subsequent request and showed no password-request progress. Login.js now clears errors at attempt start, displays Signing in…, locks the password form while pending, and restores it on completion. A development-only marker, Development build: 20261029.1, identifies the updated phone bundle. The existing catch already replaces errors when a response completes; therefore this pending-display defect alone does not explain the reported old reference after completion. A stale/different phone bundle remains a hypothesis.

Expo served the updated Android bundle with the marker and current scores-enzyme-boundary-talent.trycloudflare.com hostname, without the old reference literal. Malformed public POST checks were dynamic/no-store; no cached POST response was demonstrated. Direct backend, gateway and public auth-health returned HTTP 200. Services were not restarted; accounts, credentials and database records were not changed.

Validation: 29 focused tests passed (screen retry, mandatory change, API references/routing, website role boundary, isolated gateway issuance/change/permanent-login lifecycle); mobile lint and type-check passed; git diff --check passed. These tests do not prove the real phone login works.

Next phone step: Reload the existing Expo app and confirm Development build: 20261029.1. Clear and manually enter the registered email, use only the newest temporary password, tap once and wait for Signing in… to finish. Share only a fresh reference and attempt time if rejected. Do not send credentials. On success complete mandatory change, then verify permanent-password login and rejection of the temporary password. Credential validity must be assessed at actual test time; the 09:03 inspection is not a promise of later validity. No resend is authorized or performed by this update.

### 2026-10-29: mobile authentication and business API integration

Confirmed a configuration gap separate from the historical 401: mobileapp/.env.local had auth/Face URLs but no plant API URL, and port3000 had no listener. Backed up the file to .env.local.before-plant-integration-20261029-094201.backup and added EXPO_PUBLIC_PLANT_API_URL and EXPO_PUBLIC_PLANT_API_URL_DEVELOPMENT, both using the existing HTTPS gateway origin. No unrelated settings changed.

With explicit user approval, started the existing Plant API using node server.js in plant-conservation-backend, unchanged environment, PID44164 at127.0.0.1:3000. Startup verified existing schema columns; no migrations, accounts, records or email deliveries changed. First sandboxed start failed and exited; the approved startup with network access succeeded. Existing authentication22584, gateway44468, tunnel and Expo40852 were not stopped/restarted.

Real connectivity: direct plant /health200; gateway /health200 and /auth-health200; public /health200 and /auth-health200; public /api/mobile/password with empty JSON401 (routing only, no credential lookup); private /internal/auth/diagnostics404 publicly. No real credential login was attempted and no real species/account records were retrieved in these checks.

Served Expo SDK58 virtual environment confirms development auth URL is the current scores-enzyme-boundary-talent.trycloudflare.com/api/mobile. Login submits POST JSON fields email/password; actual component test verifies surrounding email whitespace/case normalize correctly and password is unchanged. Existing retained 09:01 event remains account_missing; submitted real-phone email bytes were not retained, so exact phone input remains unverified.

Expanded the isolated gateway integration to run the actual Plant Express app with a synthetic data adapter, actual mobile plantApi and session manager, synthetic account provisioning and mock delivery. It proves temporary login -> blocked business access -> mandatory change -> all temporary sessions invalid -> old password denied -> permanent login -> SecureStore-adapter session establishment -> verified Bearer scientific species read -> administrator API denial -> Botanist website login/browser denial -> logout revocation. Scientific visibility is restricted to public/internal, with no protected scope. Tests execute real loopback HTTP, never contact production-like services/databases, and never send email.

Validation: 63 targeted tests pass; mobile lint/type-check pass. Added mobileapp/scripts/check-expo-runtime.mjs to inspect public URL descriptors in the actually served Android bundle without evaluating it or displaying bundle text/secrets. Its current result: authentication and Face configured, plant missing, ready:false. This confirms the existing Metro process still serves its pre-edit environment snapshot. An Expo-only graceful restart is necessary to activate the added URL. PID40852 parent20032 no longer exists; no reliable owning terminal found through process ancestry. User asked to Ctrl+C only the Metro8081 terminal and run npm.cmd start -- --lan from mobileapp; no process was killed and no duplicate Expo was started.

Remaining: after that restart, run node mobileapp/scripts/check-expo-runtime.mjs and require ready:true, then reload the physical phone app (Development build:20261029.1). Enter registered email/newest still-valid temporary credential privately, complete mandatory password change, sign in with permanent password, open permitted plant features, verify old temporary password denied. Share only fresh reference/time on rejection. Physical-phone success and its exact submitted identifier are not claimed verified by synthetic tests.

Expo restart follow-up: user reported restarting on8081, but live verification still finds original PID40852 (started07:44:42 MYT) listening there. No8082/8083 listeners. Served-bundle runtime check remains ready:false with plant URL absent, while .env.local contains both plant URLs. Authentication, plant and both gateway health routes remain200. Therefore the requested restart did not replace the serving process; do not claim updated runtime ready or terminate PID forcibly. Ask user to stop the actual Metro8081 terminal and start explicitly with --lan --port8081 --clear.
