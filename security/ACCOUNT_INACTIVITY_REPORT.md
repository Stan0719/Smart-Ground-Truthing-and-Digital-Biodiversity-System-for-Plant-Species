# Thirty-day account inactivity suspension

31 October 2026, Asia/Kuala_Lumpur.

Status: **IMPLEMENTED in code; isolated verification complete as recorded below. Live activation not performed.** No live account status, schema, policy, grant or record was changed. The existing account backend was not restarted because activation can update real account statuses and the user's instructions prohibit live record changes.

## Behavior

- Eligible Active accounts are suspended at **30 × 24 × 60 × 60 × 1,000 milliseconds** without a successful login. The comparison is `elapsed >= 30 days`; a value one millisecond below the boundary remains Active.
- Timing uses server Unix milliseconds and successful login ISO UTC timestamps, never browser time or formatted display text.
- Checks run in shared server-side account lookup, before password-login admission, again in the locked login recheck, and during validation of otherwise valid protected sessions. Other existing account callers use these common checks without modifying domain or recognition code.
- A suspended account receives the existing generic login rejection. Protected sessions are denied, and stored sessions are explicitly revoked. Existing database trigger/session protections remain in place.
- Automatic suspension records `automatic_inactivity_suspension` in the existing `auth_events` log without names, email, passwords or encryption keys. The system event has no human actor ID.
- A transaction-scoped shared PostgreSQL advisory lock plus an account-row lock serializes suspension/reactivation decisions. The status update and audit insertion commit together, preventing duplicate automatic events under concurrent requests.

There is **no background scheduler or Supabase cron job**. This deployment has a normal application process, not a reliable durable job scheduler. Untouched accounts may remain stored as Active after day 30 until a backend lookup/login or eligible session check reaches them; that check suspends them before protected admission. Expired sessions are already rejected without needing an account update. The dashboard need not be open, but its account list can show the last stored status until a policy-triggering account check occurs. Exact wall-clock bulk updates would require a separately approved durable job and live rollout.

## Which timestamp is used

The repository account schema has `last_login` as TEXT, but no account `created_at` or `reactivated_at` columns. Existing `auth_events.created_at` is a server-side Unix-millisecond timestamp, so no new column or migration is needed.

The policy uses the latest reliable eligible timestamp from:

- A valid UTC `last_login` written by existing successful login paths.
- Existing successful-authentication audit events.
- Account creation/invitation/bootstrap audit events.
- Administrator reactivation events (`account_reactivated`) and historical `status_Active` events.
- A one-time legacy initialization event (`inactivity_grace_started`) when no reliable prior timestamp exists.

Future/ambiguous display timestamps are not accepted as UTC login evidence. Audit lookup ignores future event timestamps. Failed logins, page views, session use, name edits and password-recovery requests do not refresh the window.

New `createUser`/`createVisitor` operations record `account_created` atomically with the account insert. Existing invitation workflows already record `invitation_created`. Old records are not assigned invented historical creation dates: an eligible legacy account with no reliable baseline receives one durable 30-day grace period at its first check. Repeated checks do not restart that period.

## Activation and Administrator safeguards

- Pending Activation accounts and accounts still required to change a temporary password are excluded from automatic inactivity suspension. Their existing temporary-password expiry/resend/mandatory-change rules continue to govern access; this exclusion does not authorize protected operations.
- Once an account completes the temporary-password workflow, its latest successful login becomes the inactivity baseline.
- The **last Active, fully activated Administrator is exempt** from automatic suspension to prevent total administrative lockout. With multiple eligible Administrators, stale Administrators can be suspended; concurrent checks cannot suspend the final operational one. This is an intentional safety exception to the general account rule.
- Existing self-protection remains: an Administrator cannot disable/suspend their own signed-in account through the account-status or edit endpoints, and the UI disables self-status editing.
- No face recognition model, camera, template, recognition endpoint or recognition function body was changed. Common account-status eligibility is enforced by the shared account service, rather than implementing another recognition-specific rule.

## Administrator-only reactivation

Existing website/session role gates remain. The account-management service also explicitly checks the existing `accounts.manage` permission, which only grants access to active, fully activated Administrators.

Both supported Account Management paths are covered:

1. `PATCH /api/admin/users/:id/status` changes only status.
2. `PATCH /api/admin/users/:id` retains the existing full account edit behavior.

A real transition from a disabled state to Active records `account_reactivated` with the operator's ID in the same transaction. It does not falsify `last_login`, alter a password or role, or restore an old session. The audit timestamp supplies a fresh 30-day window for a new login. Repeatedly saving an already-Active status does not create another reactivation event or extend that window.

In the dashboard, a status-only edit now uses the existing status-only endpoint. It does not rewrite names or invoke personal-name encryption unnecessarily. Actual name edits continue to require existing backend name-encryption keys and preserve that encryption implementation.

Reading a name that is already encrypted still requires its existing backend decryption keys; status-only handling does not bypass that protection.

## Inactive compatibility

A read-only aggregate live inspection found **22 Inactive staff accounts and 5 Active staff accounts**; no Visitor status groups were returned. No personal values or stored credentials were read, and no account was converted.

- New selectable options are **All statuses / Active / Suspended** in the filter and **Active / Suspended** in the edit dialog.
- Inactive remains a recognized legacy/internal database value. Existing constraints, records and archival behavior are retained.
- Legacy Inactive rows remain visible under All statuses with their stored status. Opening Edit does not silently map them to another status: the Administrator must explicitly choose Active or Suspended before saving.
- New public status selections of Inactive are rejected. A legacy Inactive value can still be preserved during an internal/backward-compatible full account edit; it is not offered as a new UI selection.
- Existing Pending Activation handling is preserved; its status is controlled by the activation workflow rather than the new status selector.
- Total/Active counts and existing role/search filters remain based on stored account values; no legacy record is relabeled as Suspended just for display.

No automatic conversion of the 22 Inactive records is proposed. Any future bulk conversion would require a separate, explicit approved data plan.

## Exact changes

Production source:

- `web/server/account-inactivity.mjs` — new account-only UTC inactivity policy using existing audit/session tables, concurrency locks, baseline selection, one-time grace initialization, session revocation and final-Administrator protection.
- `web/server/auth.mjs` — connect the policy to account lookup/password-login/session validation; record account creation; use an injectable server clock for deterministic tests; serialize login/status transitions; audit genuine reactivation without changing last login.
- `web/server/operations.mjs` — reuse existing Administrator permission checks; restrict selectable statuses; lock full edits and audit reactivation; preserve legacy/internal values and self-protection.
- `web/src/views/AdminUserManagementView.vue` — remove Inactive selections, retain explicit legacy handling, use status-only saves and explain the rule. Removed the unused old status-handler function; current behavior uses the edit dialog.

Tests:

- `web/server/account-inactivity.test.mjs` — 11 focused tests covering all requested scenarios across boundary, workflow and authorization cases.
- `web/server/activation.test.mjs` — replace an ID-only mock Administrator with an actual activated test Administrator so the existing Visitor-administration assertions run behind the real permission guard. Existing assertions and Visitor role restrictions are retained.

Documentation/evidence:

- This report.
- `security/evidence/account-inactivity-focused.txt`
- `security/evidence/account-inactivity-regressions.txt`
- `security/evidence/account-inactivity-web-build.txt`
- `security/evidence/account-inactivity-mobile-lint.txt`
- `security/evidence/account-inactivity-mobile-types.txt`
- `security/evidence/account-inactivity-static.txt`
- `security/evidence/account-inactivity-live-statuses.txt`
- `security/evidence/account-inactivity-scope.txt`

## Verification

Focused policy run:

```powershell
node --test web/server/account-inactivity.test.mjs
```

11 focused tests passed before the final compatibility refinements. The final combined run includes those tests and the broader account/name-encryption/keyring regressions:

```powershell
node --test --test-isolation=none web/server/account-inactivity.test.mjs web/server/account-name-storage.test.mjs security/backend-data-encryption.test.mjs security/encryption-utility.test.mjs web/server/api.test.mjs web/server/auth.test.mjs web/server/activation.test.mjs web/server/recovery.test.mjs web/server/operations.test.mjs web/server/auth-lifecycle.test.mjs
npm.cmd --prefix web run build
npm.cmd --prefix mobileapp run lint -- --no-cache
npm.cmd --prefix mobileapp run type-check
```

Final result: **58 tests passed, 0 failed; process exit 0.** Website build/type checking, mobile lint, mobile type checking, syntax checks and targeted ESLint all passed with exit 0. Results are in the evidence files listed above. Syntax checks cover the new policy/test and modified backend modules. Targeted ESLint covers these modules, the updated account fixture and the dashboard. Existing website bundle-size warnings are unrelated to account security.

The first broad run found an old test fixture that supplied only `{ id: 'admin' }` to the account-management service; the test now creates a real eligible Administrator. The targeted lint run identified an unused pre-existing status handler, which was removed after status-only edit handling was connected. These were corrected without weakening authorization.

All account creation, aging, reactivation, concurrency and encryption integration writes in tests use isolated PGlite or synthetic fixtures. No real account was aged, suspended or reactivated. No browser/device end-to-end session or real recognition test was performed; mobile lint/types are static checks.

## Database and rollout safety

No new column, constraint, migration, RLS policy, grant, dependency or scheduled job is required by this implementation. Existing account schema and encrypted-name storage remain unchanged. New baseline/suspension/reactivation events and status updates occur only when the new backend is actually deployed and handles policy-triggering requests.

The only live SQL in this task was an aggregate SELECT in a read-only transaction. The running authentication backend has not been restarted to activate the new rule. Approval is required before a live rollout that may suspend real accounts or initialize their audit grace windows, because the task expressly forbids live record changes.

Plant records/APIs/workflows, observations, reviews, notes, attachments, GPS/maps/geolocation, IoT/sensors, face recognition, roles, password hashing/reset logic, existing personal-data encryption and mobile source were not modified. No commit or push was made.
