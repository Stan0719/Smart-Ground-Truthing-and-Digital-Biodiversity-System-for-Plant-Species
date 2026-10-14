# Website account status: setup and security guide

## What was found

The website had no backend or user database. Login used hard-coded accounts and browser localStorage, including plain passwords. The Admin table used sample users. Those accounts are not real backend accounts and are not imported. The mobile application is outside this change.

The website now uses a small Node API and SQLite database. Node 24.12 or newer is recommended. No new npm package is needed.

## 1. Recommended login flow

1. Browser sends email and password to POST /api/auth/login.
2. Server checks input size and limits login attempts by IP.
3. Server finds the account by its trimmed, lowercase email.
4. Server verifies the password hash. For an unknown email, it verifies against a dummy hash. This avoids skipping expensive work for unknown or blocked accounts.
5. Server reloads the account after password verification and requires users.status = 'Active'. This catches status changes during password verification.
6. Invalid password, unknown email, Inactive and Suspended all return HTTP 401 and the same message.
7. Only a valid Active account gets a session. Temporary-password sessions can only inspect their own session, change password or log out.

## 2. Backend logic

Allow login only when password is correct AND status is exactly Active. Do this for Administrator, Conservation Officer and Botanist. Role controls permission after authentication; it never bypasses status.

Passwords use salted scrypt (N=32768, r=8, p=3). SQL uses bound parameters. Admin user APIs check the current session, account status, password-change requirement and Administrator role. A user cannot change their own status through the API.

## 3. Frontend errors

All ordinary login failures display:

"Unable to sign in. Check your email and password or contact the administrator."

Do not reveal whether an account exists or whether it is Inactive or Suspended. Network failures get a separate server-unreachable message. Throttled requests use the same login message and HTTP 429, regardless of account existence.

The Admin page may display status because it requires an authenticated Administrator. Browser route checks and session polling help the interface; API checks enforce security. Already displayed data cannot be removed from someone's memory or screenshots.

## 4. Database rules

users.status is NOT NULL, defaults to Active and accepts only Active, Inactive or Suspended. Unknown and missing statuses are denied. Active is permitted; Inactive means administratively disabled; Suspended means blocked for an administrative/security reason. Neither blocked state may authenticate.

Email is normalized and unique. User creation accepts only explicit name/email/role fields; browser-provided status and password-change flags are ignored. New accounts require a password change. A database trigger removes sessions on any change to a blocked status, including a direct SQL update.

## 5. Session handling

Use a random opaque session cookie, not a token in localStorage. Only its SHA-256 hash is stored in SQLite. Cookies are HttpOnly and SameSite=Strict, with Secure in production. Sessions expire after eight hours. Every protected API request looks up the current user and requires Active.

Changing status to Inactive or Suspended removes ALL sessions in the same database update. Returning to Active requires a new login. Password changes also remove all sessions and require another login. Logout removes the current session. The website checks protected-page sessions every 15 seconds and when the window gets focus. Backend denial is immediate for later requests; polling only controls when the page redirects. Requests already authorized before a status change can finish.

## 6. Security considerations

Successful and failed login attempts, including blocked accounts, are stored in auth_events. Status changes record the acting admin. Passwords, cookies, tokens and submitted email addresses are not written to audit events. Known accounts are identified internally by user ID. Keep database and logs private, back them up securely, and set a retention period before deployment.

A dummy hash and consistent response reduce account enumeration; they do not guarantee perfectly identical network timings. Limit password length and login attempts. Current limit is 30 attempts per connection IP in 15 minutes and persists across restarts. Behind a proxy, all users may share an IP: configure trusted-proxy handling and shared IP/account rate limits before wider deployment. Do not blindly trust X-Forwarded-For.

Writes require an exact allowed Origin and JSON content type to reduce CSRF. Production must use HTTPS with the website and API on the same origin. Existing dashboards still contain prototype display data. Any future real plant/report/private-data API must use the same server-side session and role checks.

The old browser OTP recovery is disabled because it cannot safely reset backend credentials. Add backend-generated, hashed, expiring, single-use recovery codes, rate limits and server email delivery as a separate task. Recovery must never activate or unsuspend an account. Existing EmailJS temporary-password delivery remains an admin feature; for deployment, replace emailing passwords with server-sent, expiring invitation links. Never treat old localStorage accounts or browser OTPs as proof of identity.

## 7. Simple implementation and run steps

From the project root:

```bash
cd web
node --version
npm ci
npm run test:auth
npm run build
npm run create-admin
```

Enter an admin email and name. Save the generated temporary password privately. There are no default admin credentials.

Terminal 1, inside web:

```bash
npm run server
```

Terminal 2, inside web:

```bash
npm run dev -- --host localhost --port 5173
```

Open http://localhost:5173. Sign in as the new admin, set a new password (15 to 128 characters), then sign in again. Go to Admin → User Management and add a Conservation Officer. Copy the temporary password, then use a separate browser/private window to sign in and change it.

Test:

1. Active officer with correct password can log in.
2. Change the officer to Inactive using the Admin status dropdown. The officer's next API request fails, and their protected page redirects within about 15 seconds.
3. Try login with the correct password: denied with the generic message.
4. Repeat for Suspended: same message.
5. Set Active again: new login succeeds; old cookies remain invalid.
6. Try an unknown email or wrong password: same message.
7. Open /admin/users without signing in: redirected. Direct API request without a cookie: HTTP 401.

Run checks again if you edit the code:

```bash
npm run test:auth
npm run build
node --test tests/accountEmail.test.mjs
```

The SQLite database is created automatically at web/server/data/auth.sqlite and is ignored by Git. Do not delete it to reset a real deployment.

Production example (replace the domain; configure an HTTPS reverse proxy serving web/dist and forwarding /api to port 3001):

```bash
NODE_ENV=production APP_ORIGIN=https://your-domain.example npm run server
```

In Codespaces, development mode automatically accepts the exact forwarded website URL for port 5173 from the Codespaces environment, plus localhost and 127.0.0.1. Other workspaces are rejected. An explicit APP_ORIGIN overrides these development defaults. For another development domain, set APP_ORIGIN to the exact URL in the browser when starting the API. Use the same site for /api through the Vite proxy. If port 5173 is busy, choose another port and update APP_ORIGIN to match.

## Created files

- server/schema.sql: users, sessions, audit log and revocation trigger.
- server/auth.mjs: password verification, status enforcement and sessions.
- server/index.mjs: HTTP API, cookie handling, admin permission checks and input validation.
- server/create-admin.mjs: creates the first administrator without default credentials.
- server/auth.test.mjs: status, role, revocation, expiry, password and throttle tests.
- server/api.test.mjs: direct HTTP checks for login, permissions, cookies, CSRF, session revocation and logout.
- src/services/auth.ts: website API client.
- docs/account-status-security.md: this guide.

## Updated files

- package.json: backend, admin setup and test commands.
- vite.config.ts: forwards /api to the backend during development.
- .gitignore: excludes the private database.
- src/components/LoginModal.vue: backend login; removes mock login fallback.
- src/components/NavigationBar.vue: session lookup and backend logout.
- src/views/AdminUserManagementView.vue: real API users, creation and status updates.
- src/views/ChangePasswordView.vue: server password change.
- src/views/ForgotPasswordView.vue: explains that secure recovery is pending.
- src/router/index.ts: session and role checks before protected page navigation.
- src/layouts/ConservationOfficerLayout.vue, src/views/AdminDashboardView.vue and src/components/AdminPageShell.vue: backend logout from dashboard menus.
- src/App.vue: checks for revoked sessions on open protected pages.

## Research sources

- OWASP Authentication: generic messages, timing, throttling and logging: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- OWASP Password Storage: approved scrypt parameter options: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- OWASP Session Management: server sessions and cookie protection: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OWASP ASVS 5.0, session termination on account disable/delete: https://github.com/OWASP/ASVS/blob/master/5.0/en/0x16-V7-Session-Management.md
