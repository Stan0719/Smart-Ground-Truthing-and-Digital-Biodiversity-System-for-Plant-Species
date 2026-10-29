# Authentication and website role restriction fix

Root cause: website login called the unrestricted shared credential verifier, browser session lookup did not filter roles, and the router redirected temporary-password Botanists to website password change before rejecting permanent-password Botanists. Mobile password login required permanent passwords, and the Face account adapter also rejected temporary-password responses. Staff invitation instructions directed Botanists through the website.

Website login now passes an Administrator/Conservation Officer allowlist into the existing verifier, which checks it both before and inside the account-lock transaction. Browser session access checks the current role before /me, password change, or admin operations, including old Botanist sessions and mobile tokens placed into cookies. Website recovery request and confirmation also enforce that allowlist. Plant API identity rejects mobile-only roles presented through cookies or browser Origin requests; native bearer permissions remain unchanged. Client metadata is not a source of elevated permissions: a Botanist native bearer still retains only existing Botanist permissions. The Vue guard and login dialog check website eligibility before password-change routing.

Mobile temporary credentials retain existing hashing, status, expiry, throttling and session validation. Pending sessions can change passwords or log out; normal mobile identity/features remain blocked until password change. The mobile login screen keeps the pending token in component memory, accepts a confirmed 15–128 character replacement, calls /change-password and requests a fresh login. Existing password-change logic consumes activation records and revokes all account sessions. Both direct mobile HTTP and signed loopback Face adapter paths support this operation. Face enrollment/session/face-login eligibility still requires a permanent password. No face matching code was changed. Existing Visitor and Officer mobile role eligibility is preserved.

Files changed for this fix:
- web/server/auth.mjs
- web/server/http.mjs
- web/server/face-service.mjs
- web/server/recovery.mjs
- web/server/client-boundary.test.mjs (new)
- web/src/router/index.ts
- web/src/components/LoginModal.vue
- web/src/components/StaffInvitations.vue
- plant-conservation-backend/authorization.cjs
- mobileapp/screens/Login.js
- mobileapp/utils/faceApi.js
- mobileapp/face_backend/account_service.py
- mobileapp/face_backend/server.py
- mobileapp/face_backend/test_temporary_password_contract.py (new)
- PENDING_WORK.md (appended; existing content preserved)
- docs/authentication-client-fix.md (this report)

Inspected current HEAD 4c1bdd1 and resolver merge fd3bb13, AdminModuleView, shared/rbac.cjs, backend rbac.cjs, provisioning and mobile session flows. Resolver, grants and migrations are unchanged. Pre-existing changes to backend/server.js, mobile offlineDraftStore.js and security evidence are preserved.

Actual validation (all final commands passed):
- Repository root: node --test web/server/client-boundary.test.mjs — 2 grouped tests pass. Executes real hash verification/auth methods and HTTP server with an in-memory adapter, not a database. Covers Administrator/Officer website login; Botanist normal/temporary website rejection; Visitor rejection; protected browser endpoints; temporary mobile login/change/new login; invalid/expired temporary password; disabled account; pending feature restriction; token reuse and revocation; Plant API browser rejection/native permission identity preservation.
- mobileapp/face_backend: python -m unittest test_temporary_password_contract — 3 pass; mock account adapter tests, no persistence/model/network. Temporary password accepted only for password authentication; normal session and face issuance remain restricted; permanent flow and disabled/wrong role handling preserved.
- Root: node mobileapp/scripts/face-api.test.mjs — 11 pass.
- Root: node mobileapp/scripts/face-session.test.mjs — 6 pass.
- Root: node --test plant-conservation-backend/test/rbac-resolver.test.cjs — 14 pass with mock pool.
- web: npm.cmd run type-check — pass.
- mobileapp: npm.cmd run lint — pass; npm.cmd run type-check — pass.
- Root: git diff --check — pass.

Initial npm invocations were blocked by PowerShell npm.ps1 policy; npm.cmd succeeded without changing policy. The first Python test invocation from the repository root failed module discovery; rerunning from mobileapp/face_backend passed. These were invocation failures, not claimed as successful tests.

Database-backed suites were deliberately not run (including embedded PostgreSQL). No packages installed, emails sent, commits or pushes, migrations, IoT/GPS/protected-location edits. Real provisioning/delivery/storage concurrency and native-device/Face ID end-to-end verification remain pending in PENDING_WORK.md. No schema changes are proposed.
