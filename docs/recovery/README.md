> Historical instructions: project Python files and launchers were removed at the user's request. Python commands below are no longer runnable. The active website uses Vue, Node.js and PostgreSQL.

# Codespaces recovery status ? incomplete

Branch: recovery/codespaces-postgresql. Source commit: 168d462. Baseline main: 87517c9.
No commits, pushes, remote-main changes, database connections or schema migrations performed.

## Recovered files

99 files absent from main were copied byte-for-byte before targeted edits. No missing tracked files were excluded by the cache/secret filename filter and no local-path collisions occurred. This is not a completed content-level secret audit. See file-inventory.json for every copied path.

## Changes made after recovery

- Added plant-conservation-backend/database.cjs: PostgreSQL pool configuration, no automatic schema changes; respects pg TLS configuration.
- Converted plant-conservation-backend/scripts/inspect-schema.cjs to PostgreSQL metadata queries in a read-only repeatable-read transaction; emits schema metadata, no application rows or credentials.
- Converted SQLite timestamp expressions in recovered domain.cjs and iot.cjs to CURRENT_TIMESTAMP.
- Added this report and machine-readable inventories.
- Existing main files and the three original untracked files log_in.py, schema.sql and seed.sql remain unchanged.

## Review required before integration

Main uses public.plant_observation with numeric observation_id and individual observation fields; recovered code uses text id, owner_subject, JSON content, revision and client_key. Recovered migration 002 tries to CREATE the same table. It must NOT be applied to the existing database. Existing ownership, account identifiers and verification records must be mapped from a real schema export before safe reuse of those tables can be confirmed.

There is no local .env database configuration, installed project dependencies, psql or known schema export in this checkout. No database contents have been inspected. Existing SQLite data availability is unknown. Recovered SQLite backup, initialization and migration scripts remain historical/unconverted and are not ready for PostgreSQL use. Source filenames mentioning SQLite are listed in sqlite-inventory.json, including tests/docs/tooling and device-local buffering; this list is an investigation inventory, not a claim that every listed file is an application database.

Authentication in main also uses SQLite. A complete PostgreSQL conversion requires asynchronous changes across auth, sessions, activation, recovery, face-service, authorization middleware and callers. It has NOT been completed. Recovered features are present but not wired into main's entry points. All 25 merge conflicts remain unresolved; see conflicts.json. No whole-file conflict selections have been made. Expo 58, current layouts, translation support, PostgreSQL endpoints and Windows fixes remain intact.

log_in.py still requires a PostgreSQL database.py helper; root schema.sql is MySQL-style; seed.sql contains invalid placeholder hashes. These have been preserved pending alignment with the final account schema. No seed records were inserted.

## Validation so far

- node --check passes for database.cjs, inspect-schema.cjs, domain.cjs and iot.cjs.
- IoT serial bridge unittest suite: 12 tests run, 11 pass, 1 error caused by Unix permission assertion on Windows followed by SQLite file cleanup failure. Needs Windows adaptation and retest.
- Recovered mobile field-capture, field-sync and RBAC tests: 11 passed, 0 failed.
- Web/mobile lint, typecheck, builds, full backend suites and PostgreSQL integration tests have not run; project dependencies are absent.
- No assertion that all functionality is integrated, secure or production-ready is warranted yet.

## Next steps

Obtain read-only schema metadata and confirm whether existing PostgreSQL data must be retained; map accounts/observations without duplicate domain tables; implement reviewed migrations and separate validated data transfer; finish asynchronous PostgreSQL authentication; merge 25 conflicts preserving main improvements; wire recovered modules; fix Python login/seeding; install compatible dependencies; run full checks; update this report with final complete file lists and results. User approval is required before commit/push/merge.

## Full list of copied files

- `IoT/PlantPrototype/README.md`
- `IoT/PlantPrototype/requirements.txt`
- `IoT/PlantPrototype/serial_bridge.py`
- `IoT/PlantPrototype/test_serial_bridge.py`
- `deploy/check-private-https.mjs`
- `deploy/check-readiness.mjs`
- `deploy/configure-private-mobile.mjs`
- `deploy/install-local-network-tools.py`
- `deploy/local-tools-env.sh`
- `deploy/mobile-private-stack.mjs`
- `deploy/private-phone-config.test.mjs`
- `deploy/private-phone.Caddyfile`
- `deploy/private-phone.env.example`
- `deploy/start-private-vpn.sh`
- `deploy/storage-readiness.mjs`
- `deploy/storage-readiness.test.mjs`
- `deploy/test-private-phone-gateway.mjs`
- `docs/automation-continuation.md`
- `docs/dependency-advisory-details.json`
- `docs/emailjs-activation-template.md`
- `docs/final-dependency-audit.json`
- `docs/final-manual-testing-checklist.md`
- `docs/final-system-verification.md`
- `docs/iot-deployment-progress-2026-10-25.md`
- `docs/mobile-api-configuration.md`
- `docs/mobile-private-https-setup.md`
- `docs/rbac-complete-audit.md`
- `docs/rbac-implementation.md`
- `docs/rbac-results.md`
- `docs/remaining-blockers-resolution.md`
- `docs/remaining-software-repairs.md`
- `docs/sqlite-plant-storage.md`
- `docs/supabase-connection.md`
- `mobileapp/face_backend/test_real_model_safety.py`
- `mobileapp/screens/FieldCollection.js`
- `mobileapp/screens/PersistentKnowledge.js`
- `mobileapp/scripts/api-connectivity.test.mjs`
- `mobileapp/scripts/check-api-connectivity.mjs`
- `mobileapp/scripts/field-capture.test.mjs`
- `mobileapp/scripts/field-sync.test.mjs`
- `mobileapp/scripts/offline-recovery.test.mjs`
- `mobileapp/scripts/plant-session.test.mjs`
- `mobileapp/scripts/rbac.test.mjs`
- `mobileapp/scripts/setup-face-env.sh`
- `mobileapp/utils/apiConfiguration.js`
- `mobileapp/utils/fieldCapture.js`
- `mobileapp/utils/fieldStorage.js`
- `mobileapp/utils/fieldSync.js`
- `mobileapp/utils/offlineDraftStore.js`
- `mobileapp/utils/rbac.js`
- `plant-conservation-backend/.env.example`
- `plant-conservation-backend/authorization.cjs`
- `plant-conservation-backend/database.cjs`
- `plant-conservation-backend/domain.cjs`
- `plant-conservation-backend/environment.cjs`
- `plant-conservation-backend/iot.cjs`
- `plant-conservation-backend/migrations/001-rbac-foundation.sql`
- `plant-conservation-backend/migrations/002-field-review-iot.sql`
- `plant-conservation-backend/scripts/backup-db.cjs`
- `plant-conservation-backend/scripts/backup-system.cjs`
- `plant-conservation-backend/scripts/check-db.cjs`
- `plant-conservation-backend/scripts/inspect-schema.cjs`
- `plant-conservation-backend/scripts/migrate.cjs`
- `plant-conservation-backend/sqlite/schema.sql`
- `plant-conservation-backend/test/backup-system.test.cjs`
- `plant-conservation-backend/test/business.test.cjs`
- `plant-conservation-backend/test/database.test.cjs`
- `plant-conservation-backend/test/rbac.test.cjs`
- `plant-conservation-backend/test/security-audit.test.cjs`
- `plant-conservation-backend/uploads.cjs`
- `shared/rbac.cjs`
- `web/.env.server.example`
- `web/playwright.config.mjs`
- `web/scripts/check-activation.mjs`
- `web/scripts/emailjs-activation-template.html`
- `web/server/activation-configuration.mjs`
- `web/server/activation.mjs`
- `web/server/activation.test.mjs`
- `web/server/migrate.mjs`
- `web/server/migrations/001-account-activation.sql`
- `web/server/migrations/002-reviewer-identity.sql`
- `web/server/operations.mjs`
- `web/server/operations.test.mjs`
- `web/server/review-identity.mjs`
- `web/server/website-origin.mjs`
- `web/server/website-origin.test.mjs`
- `web/src/components/AccountProfile.vue`
- `web/src/components/AuthorizedMap.vue`
- `web/src/components/StaffDialog.vue`
- `web/src/components/StaffInvitations.vue`
- `web/src/services/apiResponse.ts`
- `web/src/services/knowledge.ts`
- `web/src/services/plantApi.ts`
- `web/src/styles/staff-workspace.css`
- `web/src/views/ActivateAccountView.vue`
- `web/src/views/AdminOperationsView.vue`
- `web/src/views/conservation/ConservationWorkspace.vue`
- `web/tests/apiResponse.test.mjs`
- `web/tests/browser/system.spec.mjs`

## Read-only inspection prepared

See SCHEMA-INSPECTION.md and inspect-postgresql.sql. No PostgreSQL connection configuration exists in the current environment. Inspection has not run against a server; real schema and data presence remain unknown. The Node runner now executes the same read-only SQL and omits column defaults. Local metadata exports are ignored in .gitignore.
