# Development PostgreSQL database migration review checklist

**Status: proposed review artifact only. Nothing in this document is team-approved for execution.**

## Scope and evidence boundary

This review used repository SQL, source code, package scripts, tests, and documentation only. No environment values were read, no database was contacted, no SQL was executed, and no migration or backup was run. Repository documentation describes prior shared-database work, but this audit did not verify the current live schemas, rows, grants, RLS, extensions, or project reference.

The repository contains pre-existing modified and untracked files. This artifact was created as a new file; no existing file was edited.

## Executive summary for the team

- The intended application split is `plant_auth` for accounts/sessions, `plant_app` for plant and IoT data, and `plant_face` for face-service storage. `public` contains legacy-generation objects and the current RBAC catalog/assignment path.
- The three PostgreSQL schema files describe useful target structures, but there is no single fresh-project bootstrap command. The Plant bootstrap defaults to `public` unless `PLANT_PG_SCHEMA` is supplied, and it does not create the target schema. The account and face migration runner is explicit and performs DDL, privilege changes, and some idempotent data writes.
- The numbered SQL files are not automatically discovered by the current migration runners. Some are legacy `public` changes; the web numbered SQL files use SQLite syntax, and one contains `DROP TABLE users`.
- The RBAC assignment migration requires existing `public.role`, `public.permission`, and `public.role_permission` definitions. The only self-contained role/permission DDL and seed found is a test fixture. A reviewed fresh-project RBAC bootstrap is still required.
- Do not copy shared accounts, passwords, face templates, or production records. Create synthetic development users and data only in a separately confirmed development project.

## Current architecture from repository definitions

| Schema | Tables and purpose | Evidence / important relationships |
|---|---|---|
| `plant_auth` | `schema_migrations`, `users`, `visitors`, `sessions`, `visitor_sessions`, `auth_events`, `face_service_nonces`, `password_resets`, `activation_tokens`, `security_settings`, `account_emails` | `sessions.user_id -> users.id`; `visitor_sessions.user_id -> visitors.id`; `activation_tokens.user_id -> users.id`. `maintain_account_email` and `restrict_account_sessions` triggers maintain email registry and revoke sessions/recovery state on restricted account updates. Defined in `web/server/schema.postgres.sql`. |
| `plant_app` | `family`, `genus`, `conservation_status`, `species`, `rbac_species_visibility`, `plant_record`, `plant_location`, `plant_observation`, `observation_review`, `plant_asset`, `iot_device`, `sensor_reading`, `threat_alert_history`, `threat_response`, `business_audit`, `iot_ingestion_receipt` | Taxonomy -> species -> plants; plant -> locations/observations; observations -> reviews/assets; device -> readings/alerts; alerts -> responses; ingestion receipt links device and reading. Defined in `plant-conservation-backend/schema.postgres.sql`. |
| `plant_face` | `accounts`, `sessions`, `challenges`, `real_face_templates`, `face_account_links`, `legacy_face_replacements` | Face templates can link to a real account ID; legacy link tables refer to `accounts.email`. Defined in `mobileapp/face_backend/schema.postgres.sql`. |
| `public` | Legacy plant/account/IoT tables and RBAC catalog/assignment tables are referenced by compatibility routes, fixtures, and migration tools. | Current `plant-conservation-backend/iot.cjs` still queries `public.sensor_device`, `public.sensor_reading`, and `public.threat_alert` for compatibility routes; newer IoT handlers use the configured schema. RBAC migration/preflight uses `public.role`, `public.permission`, and `public.role_permission`. The legacy prototype module also queries public plant/observation tables but is not mounted by the active server. This inspection does not verify which objects exist live. |

### Schema and identity notes

- `web/server/postgres.mjs` selects `AUTH_DATABASE_URL` then `DATABASE_URL`; the default account schema is `plant_auth`.
- `plant-conservation-backend/database.cjs` uses `DATABASE_URL` or discrete PG settings; the plant schema defaults to `public`. It sets a transaction-local search path for unqualified application SQL.
- `mobileapp/face_backend/postgres_store.py` selects `FACE_DATABASE_URL` then `DATABASE_URL`; the face schema defaults to `plant_face`, must be private and distinct from the auth schema, and is validated without creating tables.
- `mobileapp/face_backend/server.py` injects the PostgreSQL store into the face auth object. The SQLite-backed `Auth` constructor remains available for fixtures/prototype paths, but the production server path connects PostgreSQL and has no SQLite fallback.
- Face authentication’s authoritative account and session operations are delegated to the Node account service when configured. `plant_face` holds face factors/templates and links; it is not a replacement account directory. The schema’s legacy `accounts.password` column deserves explicit privacy/retention review; do not seed or copy it for new accounts.
- Inherited process environment variables override values loaded from files. The Node loader reads the plant backend `.env`, then `web/.env.server`, then selected face settings; the face Python loader reuses that precedence. Do not rely on a file edit to override an already-set PowerShell variable.

## Overlapping generations: do not infer deletion from names

| Similar objects | Difference shown by source |
|---|---|
| `public.users` vs `plant_auth.users` | Legacy public identity/role-ID representation versus current string-ID application staff account table. Visitors are separated into `plant_auth.visitors`. |
| `public.plant_record` vs `plant_app.plant_record` | Legacy fields such as `registered_by`/`current_status` differ from private `registered_subject`/`rbac_status`/`qr_token`. |
| `public.sensor_device` vs `plant_app.iot_device` | Legacy sensor-device model and identifiers versus the newer device model, with optional camera/device type support. |
| `public.sensor_reading` vs `plant_app.sensor_reading` | Legacy `sensor_id` plus individual sensor columns/GPS versus newer `device_id` plus JSON `values`. Same table name does not mean compatible data. |
| `public.threat_alert` vs `plant_app.threat_alert_history` | Legacy alert ID/type/severity/description model versus newer device/reading/metric/value/status model. |
| `plant_auth.users` vs `plant_face.accounts` | Authoritative account/password/session policy versus face-side legacy/prototype account records and templates. Do not synchronize passwords between them. |
| SQLite schemas vs PostgreSQL schemas | Parallel historical/test/runtime definitions, not interchangeable SQL. The Face runtime now selects PostgreSQL; SQLite remains for tests and import/recovery paths. |

The one-time legacy cutover in `web/server/legacy-postgres.mjs` refuses to proceed if any target schema already exists and refuses populated legacy IoT/media/QR tables without an explicit mapping. It is not a general synchronization job. The documentation says the old public tables were preserved, but that statement was not live-verified in this audit.

## Complete SQL file inventory (14 files)

“Status” below is a source-based classification, not execution approval.

| File path | Database type | Purpose / schema affected | Data or destructive behavior | Status for fresh Supabase dev |
|---|---|---|---|---|
| `schema.sql` | MySQL | Old root `biodiversity_db` and `users` table | Creates database/table; no seed rows | **LEGACY / DO NOT EXECUTE** on PostgreSQL (`AUTO_INCREMENT`, `USE`). |
| `seed.sql` | MySQL | Sample users in root database | Inserts three illustrative rows and placeholder hash strings | **LEGACY / DO NOT EXECUTE**; not valid PostgreSQL and not real test credentials. |
| `plant-conservation-backend/sqlite/schema.sql` | SQLite | Plant-domain tables and workflow | Creates tables/triggers/indexes | **LEGACY / TEST OR IMPORT ONLY**; SQLite-specific syntax. |
| `plant-conservation-backend/schema.postgres.sql` | PostgreSQL | Plant-domain schema, normally targeted to `plant_app` via `PLANT_PG_SCHEMA` | Creates tables/indexes; no seed rows or drops | **CANDIDATE FOR REVIEW** (technical fit only, not team approval). Requires target schema and grants first; `CREATE IF NOT EXISTS` does not prove an existing table has the expected shape. |
| `plant-conservation-backend/migrations/001-rbac-foundation.sql` | PostgreSQL | Alters legacy `public.plant_record` and `public.species`; creates `public.rbac_species_visibility` | Adds columns, relaxes `registered_by` NOT NULL, adds index/table; requires pre-existing legacy columns/tables | **LEGACY / NEEDS REVIEW**; not the `plant_app` bootstrap and not idempotent (`ADD COLUMN` lacks `IF NOT EXISTS`). |
| `plant-conservation-backend/migrations/002-field-review-iot.sql` | PostgreSQL | Creates workflow/assets/IoT tables in `public` | Creates tables/indexes; aborts if equivalent legacy objects, including `public.threat_alert`, exist | **LEGACY / NEEDS REVIEW**; explicitly public-specific and has conflict preflight, not a private-schema setup. |
| `plant-conservation-backend/test/fixtures/rbac-legacy.sql` | PostgreSQL test fixture | Creates `public.role`, `public.permission`, `public.role_permission`; seeds four roles, nine old permissions and legacy assignments | Creates and inserts test-only catalog/assignment rows | **TEST ONLY**; useful for review but not a production migration/bootstrap. |
| `web/server/schema.sql` | SQLite | Older auth/users/session/account schema | Creates tables and triggers | **LEGACY / TEST ONLY**; contains SQLite trigger syntax. |
| `web/server/schema.postgres.sql` | PostgreSQL | Account schema for `plant_auth` | Creates tables/functions/triggers; inserts default `security_settings` and backfills `account_emails`; no `DROP TABLE`; migration runner drops/recreates named triggers | **CANDIDATE FOR REVIEW** (technical fit only, not team approval). Requires owner-level DDL privileges and security review. |
| `web/server/migrations/001-account-activation.sql` | SQLite-era SQL | Rebuilds `users` as `users_next` | Copies rows, then **`DROP TABLE users`**, renames replacement | **DESTRUCTIVE / DO NOT EXECUTE** on any shared or Supabase PostgreSQL database. Not run by current PG runner. |
| `web/server/migrations/002-reviewer-identity.sql` | SQLite-era SQL | Adds `postgres_user_id` to users | Alters table and creates unique index; uses SQLite `typeof()` | **LEGACY / DO NOT EXECUTE** on PostgreSQL; not run by current PG runner. |
| `mobileapp/face_backend/schema.postgres.sql` | PostgreSQL | Face storage in `plant_face` | Creates six tables; no seed rows or drops | **OPTIONAL CANDIDATE FOR REVIEW** (technical fit only, not team approval) when Face ID is enabled. Runtime validates these tables and does not create them. |
| `security/account-security-readonly.sql` | PostgreSQL | Read-only catalog/security inspection for `plant_auth` | `BEGIN READ ONLY`, catalog SELECTs, `ROLLBACK` | **READ-ONLY REVIEW TOOL**; schema literals may need review if configured names differ. |
| `docs/recovery/inspect-postgresql.sql` | PostgreSQL | Read-only schema metadata inventory | `BEGIN ... READ ONLY`, catalog queries, `ROLLBACK` | **READ-ONLY REVIEW TOOL**; broad metadata output should remain private and be run only after approval. |

The table contains 14 distinct SQL files. The numbered migration files are not a linear sequence, and their presence in a migrations folder does not mean the current runner applies them.

## Supporting database-related code, tests, and docs reviewed

### Connection, startup, and migration code

- `plant-conservation-backend/database.cjs`, `environment.cjs`, `server.js`
- `plant-conservation-backend/scripts/migrate.cjs`, `migrate-rbac.cjs`, `preflight-rbac.cjs`, `rbac-preflight.cjs`, `check-db.cjs`, `inspect-schema.cjs`, `postgres-backup.cjs`, `backup-db.cjs`, `backup-system.cjs`
- `plant-conservation-backend/rbac-migration.cjs`, `rbac.cjs`, `authorization.cjs`
- `web/server/postgres.mjs`, `migrate.mjs`, `legacy-postgres.mjs`, `auth.mjs`, `test-postgres.mjs`
- `web/scripts/migrate-legacy-postgres.mjs`, `rehearse-legacy-postgres.mjs`, `import-sqlite.mjs`, `check-postgres.mjs`
- `mobileapp/face_backend/postgres_store.py`, `authoritative_auth.py`, `server.py`, `account_service.py`

### Tests, fixtures, and documentation

- Plant backend: `test/database.test.cjs`, `test/postgres-fixture.cjs`, `test/fixtures/rbac-legacy.sql`, `test/rbac.test.cjs`, `test/rbac-resolver.test.cjs`, `test/rbac-preflight.test.cjs`, `test/rbac-migration.test.cjs`, `test/backup-system.test.cjs`
- Website backend: `server/postgres.test.mjs`, `server/legacy-postgres.test.mjs`, `server/face-postgres-migration.test.mjs`, `server/test-postgres.mjs`
- Face backend: `test_postgres_store.py`, `test_account_integration.py`
- RBAC consumers/docs: `shared/rbac.cjs`, `mobileapp/utils/rbac.js`, `mobileapp/scripts/rbac.test.mjs`, `docs/rbac-results.md`, `docs/rbac-implementation.md`, `docs/rbac-complete-audit.md`, `plant-conservation-backend/docs/rbac-migration-runbook.md`
- Setup/security docs: `README.md`, `docs/postgresql-migration.md`, `docs/supabase-connection.md`, `docs/sqlite-plant-storage.md`, `mobileapp/docs/face-postgresql.md`, `security/README.md`

Three existing local PostgreSQL dump archives were detected by filename in the ignored backup area; their contents were not opened or restored. Environment files and backup contents were not inspected.

## Migration runner and SQL behavior

| Command/function | What source says it does | Important boundary |
|---|---|---|
| `npm --prefix plant-conservation-backend run migrate` | `scripts/migrate.cjs` takes a PostgreSQL backup, begins a transaction, takes advisory lock `87423901`, checks some columns, and applies `schema.postgres.sql` through the configured plant search path. | Defaults to `public`; explicitly set `PLANT_PG_SCHEMA=plant_app`. Does not create that schema itself. Existing incompatible tables may be skipped by `IF NOT EXISTS` unless the precheck catches them. **Not run here.** |
| `npm --prefix web run migrate:auth` | `web/server/migrate.mjs` creates `plant_auth`, revokes schema access from `PUBLIC` and Supabase API roles when present, applies the PG auth schema and revokes table privileges from `PUBLIC`. | Alters privileges and creates objects; includes idempotent inserts/backfill. Requires reviewed owner/DDL authority. **Not run here.** |
| `npm --prefix web run migrate:face` | Same explicit runner with `--face`; creates the configured private face schema, applies the face schema, and revokes broad privileges. | Optional Face ID setup. It does not migrate SQLite data. **Not run here.** |
| `npm --prefix plant-conservation-backend run migrate:rbac` | Explicit backup then `applyRbacMigration` against fully qualified `public.*` RBAC objects. Adds approved permission definitions and replaces role assignments after preflight/locking. | Requires the three RBAC tables, exact expected roles, and nine established permission definitions already present. The migration does not create the full base RBAC schema. Uses the approved matrix; preserves definitions and keeps `manage_qr_codes` unassigned/unmapped. **Not run here.** |
| `web/scripts/migrate-legacy-postgres.mjs` | One-time SERIALIZABLE migration from specific legacy public tables into three new private schemas, with table locks, fingerprints, backup manifest checks and validation. | Not a blank-project installer. Refuses pre-existing targets and populated unmapped legacy IoT/media/QR data. **Do not use for a fresh project.** |
| `web/server/migrations/*.sql` | No current runner auto-discovers these files. | One is destructive SQLite-era SQL; the other is SQLite-specific. **Do not execute on Supabase PostgreSQL.** |
| `plant-conservation-backend/migrations/*.sql` | No current runner auto-discovers these files. | Both target legacy `public`; they are not the private `plant_app` schema bootstrap. |

The existing RBAC matrix in `plant-conservation-backend/rbac-migration.cjs` has roles `Admin`, `Conservation Officer`, `Botanist`, and `Visitor`; the resolver maps application `Administrator` exactly to database `Admin`. The assignment migration defines 13 proposed DB permissions in addition to the nine existing ones. `manage_qr_codes` remains unassigned; `generate_qr_codes` is distinct and assigned to Botanist by the target matrix.

Current application authorization in `plant-conservation-backend/authorization.cjs` still imports `permitted()` from `shared/rbac.cjs`. The isolated database resolver in `plant-conservation-backend/rbac.cjs` is not wired into that path. The migration therefore must not be described as changing runtime enforcement. Also, `shared/rbac.cjs` currently does not list the `qr.generate` application key while the resolver mapping names it; that mismatch needs resolution before resolver integration, without broadening policy.

## RBAC review and missing bootstrap

The test fixture demonstrates this relational design:

- `public.role(role_id PK, role_name UNIQUE NOT NULL)`
- `public.permission(permission_id PK, permission_name UNIQUE NOT NULL)`
- `public.role_permission(role_id FK, permission_id FK, composite PK)`

The migration runbook additionally allows optional text description on permission and requires unique role/permission names, primary keys, both foreign keys, and a unique/composite assignment key. The project’s preflight checks RLS and expected schema properties. Those checks do not establish what the live database contains.

Repository RBAC source has these gaps for a fresh project:

1. No production migration creates the three RBAC tables and the four base role rows plus nine established permission rows. The SQL fixture is test-only.
2. The resolver’s allowlist includes `generate_qr_codes -> qr.generate`; current `shared/rbac.cjs` lacks `qr.generate`, and the resolver is unintegrated. Review before code enforcement.
3. The current application policy is hardcoded in shared code; the database assignment migration does not switch it to database policy.
4. The plant schema SQL itself contains no RLS policies. Security depends on server-side authorization and database grants; Supabase API roles should not gain direct access to private account/face tables.
5. No SQL file in the inventory creates an extension. Current private plant/face definitions do not require one. Any optional PostGIS requirement for legacy source data must be separately confirmed.

The approved target matrix should be taken from `TARGET_ASSIGNMENTS` in `rbac-migration.cjs`, not reconstructed in this document. Anonymous access is application logic, not a database role assignment. `record_observations` maps to creation and own-edit capabilities only if ownership/workflow checks remain enforced in every edit path. Exact GPS is a separate Officer permission. Self-review must remain denied by application checks.

## Fresh development-project execution proposal (not approved)

| Order | Proposed step | Prerequisites | Main risk | Approval |
|---:|---|---|---|---|
| 0 | Create/designate a separate Supabase development project; record and independently verify its project reference. Establish isolated owners/service login and backup/restore plan. | Team project owner and DBA | Wrong project or inherited shared credentials could mutate shared data. | Explicit team/DBA approval. |
| 1 | Review role model, schema ownership, grants, RLS, TLS, connection paths, and security policy. Create private `plant_app`, `plant_auth`, and optionally `plant_face` schemas with reviewed access. | New project, secure access plan | Broad grants, exposed tables, or wrong owner/search path. | DBA/security approval. |
| 2 | Apply the account PostgreSQL schema with `AUTH_PG_SCHEMA=plant_auth`. | Correct isolated URL, DDL-capable approved role, backup | Creates account/security objects, functions/triggers, inserts registry/settings rows, revokes privileges. | Reviewed SQL and explicit execution approval. |
| 3 | Apply plant schema bootstrap with `PLANT_PG_SCHEMA=plant_app`; ensure schema exists first. | Correct isolated URL and schema privileges | Plant migration defaults to `public` if omitted; existing incompatible definitions can be missed by `IF NOT EXISTS`. | Reviewed SQL, target check, backup, approval. |
| 4 | Establish the base `public` RBAC schema and four role/nine permission definitions through a separately reviewed bootstrap. | Approved DDL/seed source absent from production migration set; fixture only as reference | Incorrect IDs, names, constraints, or assignments can lock out/grant wrong roles. | Team policy + DBA approval. |
| 5 | Run the explicit RBAC preflight and then, only after review, the explicit assignment migration. | Base RBAC bootstrap, backup/restore rehearsal, maintenance write-freeze | Assignment replacement changes policy data; manual/external writers may not share advisory lock. | Separate explicit approval for each run. |
| 6 (optional) | Apply face schema with `FACE_PG_SCHEMA=plant_face`; configure account bridge separately. | Account service tested, TLS/keys set, approved face enrollment policy | Biometric data is sensitive; schema has legacy password-like column. | Security/privacy approval. |
| 7 | Create synthetic development accounts/data through approved development flows; verify roles, constraints, authorization, and logs. | All schema and authorization checks complete | Accidentally copying or using real users/templates. | Account-owner and test-data approval. |

Do not use `migrate-legacy-postgres` in this sequence. Do not apply SQLite/MySQL files. Do not assume Supabase Auth (`auth.users`) is the identity store for this application; code uses `plant_auth`.

## Connection isolation and configuration checklist

For the new project only, configure the following values privately and consistently:

| Variable | New development value to provide | Consumer |
|---|---|---|
| `DATABASE_URL` | New dev PostgreSQL connection URI, verified TLS, no production fallback | Plant API; fallback for Auth/Face |
| `AUTH_DATABASE_URL` | Same new dev project URI unless team deliberately provisions a separate DB endpoint | Auth API takes precedence over `DATABASE_URL` |
| `FACE_DATABASE_URL` | Same new dev project URI unless separately approved | Face store takes precedence over `DATABASE_URL` |
| `PLANT_PG_SCHEMA` | `plant_app` | Plant API/migrations; never leave default `public` for this setup |
| `AUTH_PG_SCHEMA` | `plant_auth` | Account API |
| `FACE_PG_SCHEMA` | `plant_face` | Face storage |

Operational safeguards before any startup:

- Use a fresh, project-specific connection credential—not a copied shared `.env` and not Supabase API keys as PostgreSQL passwords.
- Set explicit process environment values for **all three URL variables** so a missing service-specific variable cannot fall back to the old shared `DATABASE_URL`.
- Check inherited PowerShell variable names and override them only in the service process; inherited values win over file-loaded values.
- Keep URLs and passwords out of `EXPO_PUBLIC_*`, logs, source control, screenshots, and command history. Keep TLS verification enabled and use the project CA as required.
- Confirm the project reference/host, database name, schema, and effective database identity before any migration or service that can write. A regional pooler hostname alone does not identify the project.
- Give each service only its required schema privileges. Do not grant private schema access to Supabase `anon`/`authenticated`; review sequence and function privileges as well as table privileges. Do not enable RLS or change grants without an approved policy plan.

## Verification checklist to run only after approval

These are proposed verification categories, not executed SQL or a ready-to-run script:

1. Confirm project ref, server/database identity, TLS verification, current user, and configured schema for each service.
2. Inspect schema/table/column metadata, PK/unique/FK/index definitions, triggers/functions, extensions, RLS flags/policies, and effective privileges for each service role.
3. Verify all required tables exist in the intended schemas and that `public` RBAC definitions match the approved shape.
4. Compare RBAC assignments to the target matrix in both directions (no missing and no excess pairs); verify `manage_qr_codes` exists but is unassigned.
5. Verify no Supabase API role can access credential/session/face tables and that application service roles have only required access.
6. Create synthetic Botanist, Officer, Admin, and Visitor accounts in dev through approved flows. Test Botanist website denial, mobile password login, temporary-password change, and optional Face ID with a dedicated synthetic enrollment.
7. Exercise plant visibility, exact-GPS filtering, ownership, no self-review, IoT role separation, and audit behavior against synthetic records only.
8. Confirm backup archive integrity and restore into an isolated disposable database before declaring recovery readiness.

Avoid selecting or printing user rows, password hashes, session values, face templates, QR tokens, or exact location data during metadata verification.

## Required teammate/DBA decisions

- New development project reference, owner, endpoint type, approved TLS/CA details, and dedicated service login procedure.
- Exact database/schema ownership and effective grants for Auth, Plant, Face, migrations, and backup tooling.
- Whether new dev is a shared team project with synthetic-only data and who may create test accounts.
- Reviewed production-quality bootstrap for `public.role`, `public.permission`, and `public.role_permission`; confirm target permission names/assignments from the approved matrix.
- Resolution of the `qr.generate` application-key gap before any resolver integration.
- Whether a PostGIS extension or legacy geometry is needed for any development feature (not required by the current private schema definitions).
- Whether Face ID is in scope now; whether legacy face account/password columns should be retained, left empty, or redesigned in a separately reviewed change.
- Development email sink/test inbox, temporary-password handling, biometric consent, and test-data retention policy.
- Backup destination, restore rehearsal owner, and recovery procedure.
- Production/shared `TRUNCATE` grants have been separately reported; keep that DBA issue outside this development RBAC migration unless the DBA explicitly scopes it.

## Approval record (intentionally blank)

- [ ] Project owner approves isolated dev project and project reference.
- [ ] DBA approves schema ownership, grants, RLS posture, TLS, and backup/recovery plan.
- [ ] Team approves reviewed SQL/bootstrap and exact execution order.
- [ ] Security/privacy owner approves account, Face ID, and test-data handling.
- [ ] Executor confirms target identity and obtains per-migration authorization.

**No item above is marked approved by this document.**
