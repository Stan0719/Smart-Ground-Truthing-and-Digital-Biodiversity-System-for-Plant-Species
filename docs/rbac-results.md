> Historical instructions: project Python files and launchers were removed at the user's request. Python commands below are no longer runnable. The active website uses Vue, Node.js and PostgreSQL.

> Historical PostgreSQL-era document. The current plant backend uses SQLite.
> Follow [SQLite plant storage](sqlite-plant-storage.md) for current setup and backup instructions.
> Old PostgreSQL commands and completion counts below are retained for history.

# RBAC implementation results

Implementation spans all six phases, but the application is **not fully operational** without the missing PostgreSQL/PostGIS connection, reviewed live schema, activation email configuration and device verification. No production database or production credentials were modified.

## Database changes actually applied

- SQLite: backed up under `web/server/data/backups/`; three existing staff rows preserved, password hashes unchanged, zero foreign-key violations after migration.
- Staff schema: unique username, Pending Activation, nullable initial password hash and status/hash constraint.
- Added activation tokens and security settings; added role/email/status invalidation triggers.
- Existing Visitors, sessions, recovery and authentication audit records retained.
- PostgreSQL application database: **no migration applied**. Configuration and `pg_dump` are unavailable. Inspection and migration commands fail closed.
- Isolated test database: relational SQL migrations applied and business workflows exercised in PGlite. Spatial functions are explicit test doubles; this is not PostGIS verification.
- Source snapshots: `.rbac-backups/source/`, ignored by Git. Runtime demo data was removed without deleting the snapshots or database records.

## Requirement results

Counts use operational completion against the original 49 checks. A tested implementation whose real application database or integration is unavailable remains Partial. This is intentionally stricter than counting a passing mock test as a working installed system.

| Module | Total | Implemented | Partial | Missing | Cannot verify |
|---|---:|---:|---:|---:|---:|
| Authentication and Administration | 8 | 6 | 2 | 0 | 0 |
| Plant Knowledge System | 8 | 0 | 7 | 0 | 1 |
| Field Data Collection | 9 | 0 | 9 | 0 | 0 |
| Review and Curation | 8 | 0 | 8 | 0 | 0 |
| IoT Plant Protection | 6 | 0 | 6 | 0 | 0 |
| Staff activation steps | 9 | 7 | 1 | 0 | 1 |
| Visitor self-registration | 1 | 1 | 0 | 0 | 0 |
| **Total** | **49** | **14** | **33** | **0** | **2** |

Strict completed percentage: 14 / 49 = 28.6%. No credit is assigned to Partial requirements.

- A1/A4/A5/A6/A7/A8: login, role enforcement, recovery, audit, settings and operational status implemented and tested.
- A2: role routing and dashboards connected in code; device/browser end-to-end verification remains.
- A3: account/Visitor administration implemented; live staff invitations await email configuration.
- B1–B6/B8, C1–C9, D1–D8, E1–E6: backend and frontend implementations exist, but actual PostgreSQL schema compatibility, migration and live application-data integration remain unverified. Native storage/camera/GPS workflows require physical-device checks. C6 additionally needs offline cold-start/private-draft recovery UX and storage quota verification.
- B7: protected Botanist policy is undefined. Deny-by-default is enforced; the missing internal rule is not invented.
- Activation A9/A10/A11/A13/A14/A15/A16: invitation validation, pending/null hash, expiring single-use token, form, confirmation, hashing and activation implemented/tested. A12 live email receipt Cannot Verify. A17 post-activation dashboard end-to-end verification Partial.
- Visitor registration uses the existing authoritative service and forces Visitor; it cannot self-assign staff roles.

## Dependencies

- Installed the plant service's existing locked dependencies.
- Added `sharp` for bounded image decode/re-encode and EXIF/GPS metadata removal.
- Added `@electric-sql/pglite` as a **development-only** SQL test dependency. The application still uses `pg` and PostgreSQL/PostGIS.
- No framework major versions were intentionally upgraded; existing mobile packages were retained.

## Remaining integrations and limitations

1. Configure a local development PostgreSQL/PostGIS connection. Inspect metadata and equivalent existing tables before applying backed-up migrations. Do not bypass the schema checks.
2. Review legacy owner mappings and publication/review states; no guessed ownership or automatic publication was performed.
3. Configure the server-side activation email template and verify receipt in an authorized test inbox. No real invitation or recovery email was sent during this work.
4. Set a reachable HTTPS mobile plant API origin. No network port visibility was broadened.
5. Restore the intended Python 3.11 face environment and models. Current checkout has no executable `.venv/bin/python`; actual face recognition/liveness was not run.
6. Supply the protected-species authorization policy for Botanists.
7. Test camera, location permission, photo storage quotas, prolonged offline drafts, logout/relogin and synchronization on a physical device/emulator.
8. Test actual sensors and calibrate raw ADC units. The serial bridge and simulated device tests do not establish physical sensor or deployment connectivity. Alert thresholds currently compare numeric upper bounds; hardware-specific lower-bound alarms remain integration work.
9. Review production hosting, HTTPS routing, backup/restore and approved migrations separately. None were deployed.

## Files created

| File | Purpose | Status |
|---|---|---|
| `IoT/PlantPrototype/serial_bridge.py` | Adapter for existing serial firmware output; no hardware claim | Created |
| `IoT/PlantPrototype/test_serial_bridge.py` | Automated regression/authorization tests | Created |
| `docs/rbac-implementation.md` | Implementation and verification documentation | Created |
| `docs/rbac-results.md` | Implementation and verification documentation | Created |
| `mobileapp/screens/FieldCollection.js` | Botanist field forms, drafts, synchronization and owned revisions | Created |
| `mobileapp/screens/PersistentKnowledge.js` | API-backed mobile catalogue, detail and map screens | Created |
| `mobileapp/scripts/field-sync.test.mjs` | Automated regression/authorization tests | Created |
| `mobileapp/scripts/plant-session.test.mjs` | Automated regression/authorization tests | Created |
| `mobileapp/utils/fieldStorage.js` | Account-scoped local draft storage | Created |
| `mobileapp/utils/fieldSync.js` | Owner-verified idempotent draft/media synchronization | Created |
| `mobileapp/utils/plantApi.js` | Mobile authenticated business API client | Created |
| `plant-conservation-backend/.env.example` | Configuration template without credentials | Created |
| `plant-conservation-backend/authorization.cjs` | Origin, session and permission middleware | Created |
| `plant-conservation-backend/database.cjs` | Configured PostgreSQL connection; explicit unavailable state | Created |
| `plant-conservation-backend/domain.cjs` | Plant, observation, review, curation, QR, report and audit endpoints | Created |
| `plant-conservation-backend/iot.cjs` | Device management, device authentication, readings, alerts and responses | Created |
| `plant-conservation-backend/migrations/001-rbac-foundation.sql` | Reviewed schema migration; application PostgreSQL migrations not applied | Created |
| `plant-conservation-backend/migrations/002-field-review-iot.sql` | Reviewed schema migration; application PostgreSQL migrations not applied | Created |
| `plant-conservation-backend/scripts/inspect-schema.cjs` | Read-only PostgreSQL schema inspection | Created |
| `plant-conservation-backend/scripts/migrate.cjs` | Local-only PostgreSQL backup and transactional migration runner | Created |
| `plant-conservation-backend/test/business.test.cjs` | Automated regression/authorization tests | Created |
| `plant-conservation-backend/test/rbac.test.cjs` | Automated regression/authorization tests | Created |
| `plant-conservation-backend/uploads.cjs` | Validated metadata-stripped images and authorized media delivery | Created |
| `shared/rbac.cjs` | Explicit backend role grants, visibility rules and workflow guards | Created |
| `web/.env.server.example` | Configuration template without credentials | Created |
| `web/server/activation.mjs` | Staff invitation, hashed tokens, activation and email delivery | Created |
| `web/server/activation.test.mjs` | Automated regression/authorization tests | Created |
| `web/server/migrate.mjs` | Backed-up SQLite account schema migration | Created |
| `web/server/migrations/001-account-activation.sql` | Reviewed schema migration; application PostgreSQL migrations not applied | Created |
| `web/server/operations.mjs` | Admin account, audit, settings and real system-status operations | Created |
| `web/server/operations.test.mjs` | Automated regression/authorization tests | Created |
| `web/src/components/AuthorizedMap.vue` | Map using authorized live coordinates | Created |
| `web/src/components/StaffInvitations.vue` | Staff invitation and resend interface | Created |
| `web/src/services/knowledge.ts` | Hydrate website views from role-filtered backend data | Created |
| `web/src/services/plantApi.ts` | Website typed business API client | Created |
| `web/src/views/ActivateAccountView.vue` | Password/confirmation activation page | Created |
| `web/src/views/AdminOperationsView.vue` | Real Admin operations and IoT UI | Created |
| `web/src/views/conservation/ConservationWorkspace.vue` | Officer review, curation, reports and IoT UI | Created |

## Files modified

| File | Changes | Status |
|---|---|---|
| `.gitignore` | Integrate RBAC with existing application behavior and configuration | Modified |
| `README.md` | Integrate RBAC with existing application behavior and configuration | Modified |
| `mobileapp/.env.example` | Configuration template without credentials | Modified |
| `mobileapp/App.js` | Integrate RBAC with existing application behavior and configuration | Modified |
| `mobileapp/data/mockData.js` | Integrate RBAC with existing application behavior and configuration | Modified |
| `mobileapp/face_backend/server.py` | Integrate RBAC with existing application behavior and configuration | Modified |
| `mobileapp/screens/Scan.js` | Integrate RBAC with existing application behavior and configuration | Modified |
| `mobileapp/scripts/start-authoritative-face-dev.sh` | Integrate RBAC with existing application behavior and configuration | Modified |
| `mobileapp/src/app/forgot-password.js` | Integrate RBAC with existing application behavior and configuration | Modified |
| `mobileapp/utils/faceSessionLifecycle.js` | Integrate RBAC with existing application behavior and configuration | Modified |
| `plant-conservation-backend/package-lock.json` | Integrate RBAC with existing application behavior and configuration | Modified |
| `plant-conservation-backend/package.json` | Integrate RBAC with existing application behavior and configuration | Modified |
| `plant-conservation-backend/server.js` | Integrate RBAC with existing application behavior and configuration | Modified |
| `web/README.md` | Integrate RBAC with existing application behavior and configuration | Modified |
| `web/server/api.test.mjs` | Automated regression/authorization tests | Modified |
| `web/server/auth.mjs` | Integrate RBAC with existing application behavior and configuration | Modified |
| `web/server/index.mjs` | Integrate RBAC with existing application behavior and configuration | Modified |
| `web/server/schema.sql` | Reviewed schema migration; application PostgreSQL migrations not applied | Modified |
| `web/src/App.vue` | Integrate RBAC with existing application behavior and configuration | Modified |
| `web/src/components/AdminPageShell.vue` | Integrate RBAC with existing application behavior and configuration | Modified |
| `web/src/components/NavigationBar.vue` | Integrate RBAC with existing application behavior and configuration | Modified |
| `web/src/composables/usePrototypeSession.ts` | Integrate RBAC with existing application behavior and configuration | Modified |
| `web/src/data/plantRecords.ts` | Integrate RBAC with existing application behavior and configuration | Modified |
| `web/src/data/plants.ts` | Integrate RBAC with existing application behavior and configuration | Modified |
| `web/src/router/index.ts` | Integrate RBAC with existing application behavior and configuration | Modified |
| `web/src/services/auth.ts` | Integrate RBAC with existing application behavior and configuration | Modified |
| `web/src/views/AdminUserManagementView.vue` | Integrate RBAC with existing application behavior and configuration | Modified |
| `web/src/views/ChangePasswordView.vue` | Integrate RBAC with existing application behavior and configuration | Modified |
| `web/src/views/ForgotPasswordView.vue` | Integrate RBAC with existing application behavior and configuration | Modified |
| `web/src/views/PlantDetailView.vue` | Integrate RBAC with existing application behavior and configuration | Modified |
| `web/src/views/PlantsView.vue` | Integrate RBAC with existing application behavior and configuration | Modified |
| `web/src/views/SpeciesDetailView.vue` | Integrate RBAC with existing application behavior and configuration | Modified |
| `web/vite.config.ts` | Integrate RBAC with existing application behavior and configuration | Modified |

## Test results

| Suite / command | Passed | Failed at final run | Skipped / blocked | Evidence and limits |
|---|---:|---:|---|---|
| `web`: `npm run test:auth` | 12 | 0 | 0 | HTTP auth, activation, Visitor management, settings, expiry/revocation and signed face integration |
| Plant backend: `npm test` | 5 | 0 | 0 | Permission matrix and relational SQL workflows, including curation, media and simulated IoT; not real PostGIS |
| Mobile: Node flow tests listed in setup guide, `--test-isolation=none` | 35 | 0 | 0 | API contracts, face login flows, sessions, draft ownership/retry, recovery |
| Website legacy email adapter: `node --test --test-isolation=none web/tests/accountEmail.test.mjs` | 4 | 0 | 0 | Preserved compatibility tests with mocked delivery; no real email sent |
| Python: `python -m unittest test_core test_http test_account_integration` | 30 | 0 | 2 actual-model fixture tests | Isolated accounts and injected matcher, not actual recognition |
| Python: `python -m unittest test_supervisor test_matching_diagnostics` | 4 | 0 | 0 | Existing supervisor and matching diagnostics |
| Serial bridge: `python -m unittest discover -s IoT/PlantPrototype -p 'test_*.py'` | 2 | 0 | 0 | Firmware text parsing only, no physical sensor |
| **Automated test total** | **92** | **0** | **2 skipped** | Additional model/image suites require unavailable NumPy/Pillow/OpenCV/DeepFace |

Additional verification:

- Website production build and Vue/TypeScript checking pass. A PDF export typing issue and a malformed multiline Vue click handler were corrected before the successful build.
- ESLint on changed website integration components passes.
- Mobile `npm run lint` and `npm run type-check` pass.
- Metro generated an Android bundle successfully (HTTP 200); no emulator or physical device was used.
- A SQL numeric/double-precision inference error in GPS inserts was detected by the PGlite workflow test and corrected without changing authorization checks.
- Initial dependency/network and localhost-listening sandbox restrictions were resolved using authorized execution; application database configuration remains absent.
- `git diff --check` passes. No commit or deployment was made.

## Verified development service status

| Service | URL | Final verification |
|---|---|---|
| Vue frontend | http://127.0.0.1:5173/ | HTTP 200 |
| Authentication API | http://127.0.0.1:3001/ | `/api/auth/me` returns expected HTTP 401 without a session; SQLite is available |
| Plant API | http://127.0.0.1:3000/ | Root HTTP 200; `/api/species` returns HTTP 503 because PostgreSQL is not configured |
| Expo/Metro | http://127.0.0.1:8081/ | `/status` HTTP 200; Android bundle compiled |
| Face inference service | Not running | Intended Python 3.11 executable and model dependencies unavailable; isolated fake-matcher integration passed |
| IoT hardware | Not connected | Parser and simulated ingestion tests passed; no claim of real hardware integration |

The two API processes were restarted after implementation. Development servers are session-bound; these URLs were verified at report time and are not deployed public hosting URLs.
