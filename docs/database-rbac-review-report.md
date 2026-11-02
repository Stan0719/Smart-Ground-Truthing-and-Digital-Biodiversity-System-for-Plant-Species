# Database and RBAC review report

**Status: read-only review for team discussion. No migration or configuration is approved for execution by this report.**

## 1. Executive summary

### Confirmed from source/configuration inspection

- The current plant API authorization path calls `permitted()` from `shared/rbac.cjs`; it does not resolve database grants at request time. `plant-conservation-backend/rbac.cjs` is a separate resolver module and is not imported by the active authorization middleware.
- The repository’s proposed database policy is in `plant-conservation-backend/rbac-migration.cjs`. The only full RBAC table DDL and old-role seed found is a **test fixture**, not a production bootstrap.
- The database target assignment migration requires pre-existing `public.role`, `public.permission`, and `public.role_permission` tables, four roles, and the nine established permission definitions. It can add the 13 proposed permission definitions and replace assignments, but does not create the base RBAC tables or role rows.
- `generate_qr_codes` maps to `qr.generate` in the isolated resolver, but `qr.generate` is not a key in the current `shared/rbac.cjs`, and the active QR routes use other application permissions.
- Current local configuration inspection found `DATABASE_URL` in `plant-conservation-backend/.env` targeting the **previously identified shared Supabase project**. No new development-project URL was found in the inspected configuration. `AUTH_DATABASE_URL` and `FACE_DATABASE_URL` are absent there, so Auth and Face fall back to `DATABASE_URL` unless their process environments override it.
- Auth defaults to `plant_auth`; Face defaults to `plant_face`; Plant schema is configured as `plant_app` in the local backend `.env`. The local `DB_HOST`/`DB_NAME` fallback settings also exist, but `DATABASE_URL` takes precedence in the Plant connection module.
- Auth and Face schema migration code revokes some broad privileges, but there are no service-specific `GRANT` statements in the reviewed schema/migration files. The Plant schema migration has no corresponding revoke/grant or RLS setup. Live effective grants, memberships, RLS, and policies remain unverified.

### Overall recommendation

Do not run a migration or start database-connected services with the current local configuration. First obtain and verify the new development project reference, then provision its connection roles and schemas under DBA review. Prepare a separate reviewed RBAC base bootstrap before running the existing RBAC assignment migration. Keep the resolver unintegrated until the `qr.generate` contract and application enforcement plan are resolved.

## 2. RBAC findings

### Current and proposed sources of truth

| Concern | Repository source | Finding |
|---|---|---|
| Account identity and role on a session | `plant_auth.users`/`plant_auth.visitors`, used by the Auth service | Identity is supplied by the account/session service. `plant_auth.users.role` allows staff roles; Visitors use their separate account table. No Supabase `auth.users` dependency is shown in this application path. |
| Runtime authorization policy today | `shared/rbac.cjs`, imported by `plant-conservation-backend/authorization.cjs` | Hardcoded application permission grants are authoritative for active route checks. A database assignment change alone does not change these grants. |
| Proposed database role names and target assignments | `plant-conservation-backend/rbac-migration.cjs` | Defines `Admin`, `Conservation Officer`, `Botanist`, and `Visitor`, plus legacy and target matrices. These are repository policy definitions, not confirmation of current live rows. |
| Database resolver | `plant-conservation-backend/rbac.cjs` | Maps application `Administrator` exactly to database `Admin`; queries fully qualified public RBAC tables; not integrated into `authorization.cjs` or the active server. |
| Table/seed example | `plant-conservation-backend/test/fixtures/rbac-legacy.sql` | Test-only DDL and legacy seed; not an approved production bootstrap. |

The application’s `Guest`/anonymous behavior is a code-level special case for public permissions, not a row in `public.role`. The existing application roles use `Administrator`; the database migration uses `Admin`. The explicit resolver alias is appropriate only for that exact pair.

### Existing nine database permissions and legacy assignments

Repository fixture/migration definitions list these nine permission names. The current live catalog and assignments were **not** queried.

| Database role | Legacy repository assignments |
|---|---|
| Admin | All nine: `manage_users`, `manage_species`, `register_plants`, `record_observations`, `verify_observations`, `view_plants`, `manage_sensors`, `view_alerts`, `manage_qr_codes` |
| Conservation Officer | All except `manage_users` (eight permissions) |
| Botanist | `manage_species`, `register_plants`, `record_observations`, `view_plants` |
| Visitor | `view_plants` |

### Approved target matrix represented in repository

This reflects `TARGET_ASSIGNMENTS`; it is the migration’s target, not live state.

| Role | Target database permissions |
|---|---|
| Admin | `manage_users`, `manage_sensors`, `view_alerts`, `manage_permissions`, `read_audit_logs`, `manage_security_settings`, `read_system_status`, `view_devices`, `view_readings`, `manage_thresholds` |
| Conservation Officer | `manage_species`, `verify_observations`, `view_plants`, `view_alerts`, `view_scientific_plants`, `view_protected_species`, `read_exact_plant_gps`, `read_reports`, `view_devices`, `view_readings`, `manage_alert_responses` |
| Botanist | `register_plants`, `record_observations`, `view_plants`, `view_scientific_plants`, `generate_qr_codes` |
| Visitor | `view_plants` |

The target removes Admin’s legacy plant, observation, review, and QR grants; removes Botanist’s `manage_species`; removes the legacy Officer/Admin `manage_qr_codes` assignments; and separates IoT viewing from management. `manage_qr_codes` is retained as a defined permission but intentionally unmapped and unassigned. `record_observations` maps to both observation creation and own-edit; owner, workflow, revision, visibility, and self-review checks must continue to be enforced in application logic.

### Database-to-application mapping comparison

| Database permission | Application permission(s) | Target role(s) |
|---|---|---|
| `manage_users` (existing) | `accounts.manage` | Admin |
| `manage_species` (existing) | `species.manage` | Conservation Officer |
| `register_plants` (existing) | `plants.create` | Botanist |
| `record_observations` (existing) | `observations.create`, `observations.edit.own` | Botanist, subject to mandatory ownership/workflow checks |
| `verify_observations` (existing) | `observations.review` | Conservation Officer, with no self-review |
| `view_plants` (existing) | `plants.public.read` | Visitor, Botanist, Conservation Officer |
| `manage_sensors` (existing) | `devices.manage` | Admin |
| `view_alerts` (existing) | `alerts.read` | Admin, Conservation Officer |
| `manage_qr_codes` (existing) | **Unmapped** | **Unassigned** |
| `manage_permissions` (proposed) | `permissions.manage` | Admin |
| `read_audit_logs` (proposed) | `audit.read` | Admin |
| `manage_security_settings` (proposed) | `security.manage` | Admin |
| `read_system_status` (proposed) | `system.read` | Admin |
| `view_scientific_plants` (proposed) | `plants.scientific.read` | Botanist, Conservation Officer |
| `view_protected_species` (proposed) | `plants.protected.read` | Conservation Officer |
| `read_exact_plant_gps` (proposed) | `plants.gps.exact.read` | Conservation Officer only |
| `read_reports` (proposed) | `reports.read` | Conservation Officer |
| `view_devices` (proposed) | `devices.read` | Admin, Conservation Officer |
| `view_readings` (proposed) | `readings.read` | Admin, Conservation Officer |
| `manage_thresholds` (proposed) | `thresholds.manage` | Admin |
| `manage_alert_responses` (proposed) | `responses.manage` | Conservation Officer |
| `generate_qr_codes` (proposed) | `qr.generate` in isolated resolver | Botanist |

`shared/rbac.cjs` currently has the application permission keys shown above except `qr.generate`. It has 21 defined permission keys, including the separately approved exact-GPS permission. The public RBAC database must not be treated as the current enforcement source until the resolver is deliberately integrated and tested.

### `qr.generate` mismatch

**Confirmed from code:** the resolver maps `generate_qr_codes` to `qr.generate`, but the current hardcoded application grant map has no `qr.generate` key. The public QR lookup route `GET /api/qr/:token` is guarded by `plants.public.read`; the owner QR retrieval route `GET /api/plants/:id/qr` is guarded by `plants.create` and checks ownership. No active route found in this review uses `qr.generate`.

**Implication:** the database migration’s `generate_qr_codes` assignment will not independently authorize a route. If the resolver were integrated without first adding and designing an application check for `qr.generate`, the current application permission gate would not recognize it. Avoid mapping `manage_qr_codes` as a workaround; it remains broader/ambiguous and unmapped. The team must decide whether the current owner QR endpoint should remain part of plant registration, or whether a narrowly scoped distinct `qr.generate` route/check is required. Public QR lookup remains a read permission, not a QR-management permission.

### Missing bootstrap and RBAC dependencies

The test fixture is the only reviewed source that creates the three RBAC tables and seeds the four base roles and nine established permissions. The runtime RBAC migration validates those definitions, then adds the proposed permission definitions and replaces assignments. Before a fresh project can run it, the team needs a reviewed bootstrap specification defining:

- exact columns and types for `role(role_id, role_name)`, `permission(permission_id, permission_name[, description])`, and `role_permission(role_id, permission_id)`;
- primary keys, unique role/permission names, non-null assignment IDs, both foreign keys, and a composite assignment key;
- the exact role rows and nine original permission rows;
- RLS expectations and narrowly scoped privileges;
- how the bootstrap is versioned/re-run safely.

No executable bootstrap SQL was created or proposed for immediate execution.

## 3. Schema and privilege review

| Schema | Service access required by inspected code | Security posture from repository files | Live status |
|---|---|---|---|
| `plant_auth` | Auth API reads/writes users, visitors, sessions, recovery, activation, audit/security data. Face service calls the Auth API bridge for authoritative identity/session actions; it should not need direct account-table access. | Auth migrator creates schema, revokes schema access from `PUBLIC`, `anon`, `authenticated` when present, and revokes table privileges from `PUBLIC`. No service-specific grants are declared. No RLS policies are in the schema file. | Effective role, memberships, grants, RLS, and policies unknown. |
| `plant_app` | Plant API performs plant/workflow/asset/IoT reads and writes; authenticated routes enforce application-level policy. Device ingestion uses device-key authentication and writes readings/alerts. | Schema file defines tables/FKs/indexes but no grants, revokes, RLS, or policies. Plant migration does not establish schema-specific grants. | Effective role, grants, RLS, and policies unknown. |
| `plant_face` | Face API reads/writes challenges, templates, legacy links/replacements, and face-side records. | Face migrator creates schema and tables, revokes `PUBLIC` schema/table access and `anon`/`authenticated` schema access; no service-specific grants. Schema contains a legacy `accounts.password` field and biometric templates, requiring strict privacy review. | Effective role, memberships, grants, RLS, and policies unknown. |
| `public` | RBAC preflight/migration uses the three RBAC tables. Current compatibility IoT endpoints query `public.sensor_device`, `public.sensor_reading`, and `public.threat_alert`. The old prototype and one-time cutover tool also query legacy public tables. | The Plant schema migration does not revoke public/API-role privileges. RBAC migration requires RLS disabled on RBAC tables and does not alter grants/RLS. No live policy/grant state is established here. | Table existence, RLS, exposure, grants, and row visibility unknown. |

### Recommended database-role separation

**Recommendation, DBA approval required:** use separate principals for schema migration/backup and service runtime. Migration roles need reviewed DDL/ownership capability only during setup. Runtime logins should have schema `USAGE` and only required table/sequence privileges, without ownership, role administration, broad schema creation, or access to unrelated schemas. Keep credentials server-side and distinct from Supabase API keys.

Do not grant `anon` or `authenticated` direct access to `plant_auth` or `plant_face`. Do not assume private schema names alone enforce privacy: check schema exposure, effective privileges (including inherited and `PUBLIC` grants), ownership, function execution, and Supabase API exposure settings. `service_role` bypasses RLS; it must not be put in the client. If any Supabase Data API role is intended to read plant data, define a separately reviewed RLS policy model first. The inspected schemas do not define one.

The `plant_face.accounts.password` column and legacy SQLite/prototype routes are separate risks requiring an explicit data-retention decision; do not populate them as part of fresh development setup. The reported public-schema `TRUNCATE` grants remain a separate DBA issue and were not verified or changed in this task.

## 4. Database URL and environment findings

### Code behavior

| Setting | Consumer and precedence | Schema |
|---|---|---|
| `DATABASE_URL` | Plant API and Plant migration. Auth uses it as fallback; Face uses it as fallback. | Plant defaults `PLANT_PG_SCHEMA` to `public`; Auth defaults `AUTH_PG_SCHEMA` to `plant_auth`; Face defaults `FACE_PG_SCHEMA` to `plant_face`. |
| `AUTH_DATABASE_URL` | Auth API only; takes precedence over `DATABASE_URL`. | `AUTH_PG_SCHEMA`, default `plant_auth`. |
| `FACE_DATABASE_URL` | Face API only; takes precedence over `DATABASE_URL`. | `FACE_PG_SCHEMA`, default `plant_face`, required to remain distinct from Auth. |
| `PLANT_PG_SCHEMA` | Plant pool and Plant migration search path. | Must be explicitly `plant_app` for this project design; default is unsafe `public` for new setup. |
| `PGSSLROOTCERT` | Node clients and Face psycopg connection for TLS verification. | Path only; keep private configuration and certificate verification enabled. |

`plant-conservation-backend/environment.cjs` loads its `.env` without overriding existing process variables. `web/server/postgres.mjs` loads backend `.env`, then `web/.env.server`, then selected settings from `mobileapp/.env.face`, filling only undefined process variables. Thus inherited process variables win; order among file values means later files can override earlier file values if the process variable was unset. `mobileapp/.env.local` is an Expo/client file and is not loaded by these backend database loaders.

### Sanitized current local configuration observation

No URL or credential is reproduced here. The local Plant `.env` has `DATABASE_URL` configured; its target classified as the previously identified shared Supabase project, not a verified new development project. The same file has local `DB_HOST`/`DB_NAME` fallback entries, but the configured `DATABASE_URL` takes precedence. `AUTH_DATABASE_URL` and `FACE_DATABASE_URL` were not present in the inspected server configuration files. `web/.env.server` has TLS CA configuration but no DB URL; `mobileapp/.env.face` is absent. `PLANT_PG_SCHEMA` is set to `plant_app`; Auth and Face schema variables are unset and therefore use code defaults.

The current inspection process had no inherited database-variable names, but that does not establish the environment of a separately launched PowerShell terminal or an already-running service. No service was started or inspected at runtime. The new dev project reference/URL was not provided, so no configuration can be confirmed as targeting that project.

**High-priority isolation action:** before any local backend startup, obtain the new project reference and explicitly set `DATABASE_URL`, `AUTH_DATABASE_URL`, and `FACE_DATABASE_URL` for the service processes to the approved new development database (or deliberately configure a separate endpoint per service). Set all three to avoid fallback to the shared `DATABASE_URL`; set all three schema names explicitly. Verify the target through a sanitized identity check only after the team approves a read-only connection. Do not copy the current shared `.env` as the development configuration.

## 5. Migration order and execution risks

The project has explicit runners; numbered filenames are not automatically discovered.

| Proposed order | Action (future, approval required) | Prerequisite / risk |
|---:|---|---|
| 0 | Create/designate the separate Supabase development project and verify the project reference independently. | No new dev reference/URL is currently established in local configuration. |
| 1 | DBA reviews TLS, schema ownership, separate migration/runtime principals, effective grants, RLS/API exposure, backup destination, and restore rehearsal. | Do not reuse shared-project credentials; no live grant/policy claims are made here. |
| 2 | Prepare reviewed schema ownership/creation for `plant_app`; then run the Plant schema bootstrap with explicit `PLANT_PG_SCHEMA=plant_app`. | Plant migration defaults to `public`, backs up first, checks only selected required columns, and the schema file uses `CREATE TABLE IF NOT EXISTS`; it does not create the target schema. |
| 3 | Run the explicit Auth schema migration with `AUTH_PG_SCHEMA=plant_auth`. | It creates tables/functions/triggers, revokes access, and inserts/backfills some registry/settings rows; it is a write operation requiring approval. |
| 4 | If Face ID is in development scope, run the explicit Face schema migration with `FACE_PG_SCHEMA=plant_face` and configure the account bridge. | Face schema must remain private; do not copy legacy biometric/account data by default. |
| 5 | Approve and create a new versioned base RBAC bootstrap for the three public RBAC tables, four roles, and nine established permissions. | No production bootstrap exists in the repository; the current fixture is test-only. |
| 6 | Verify bootstrap metadata and target identity; make a public-schema backup; coordinate a role-assignment write freeze; then run the explicit RBAC preflight/migration only after separate approval. | RBAC migration targets `public`, adds proposed definitions, replaces assignments in a transaction, and backs up the whole `public` schema. It does not integrate runtime authorization. |
| 7 | Provision synthetic development-only accounts/data and test flows. | Do not copy real team accounts, passwords, or templates. Use a test email sink/inbox and a specifically authorized face test participant. |
| 8 | Separately approve and integrate database resolver policy only after resolving `qr.generate`; test every route/helper, ownership/workflow, protected visibility, exact GPS, and self-review. | This task does not authorize runtime integration. |

### Files not to use for fresh development setup

- Root `schema.sql` and `seed.sql`: MySQL syntax/sample data.
- `plant-conservation-backend/sqlite/schema.sql` and `web/server/schema.sql`: SQLite schemas.
- `web/server/migrations/001-account-activation.sql`: copies then drops `users`; destructive SQLite-era migration.
- `web/server/migrations/002-reviewer-identity.sql`: SQLite-specific `typeof()` expression; not used by current PostgreSQL runner.
- `plant-conservation-backend/migrations/001-rbac-foundation.sql` and `002-field-review-iot.sql`: modify/create legacy `public` tables, not `plant_app`; they are not automatically run.
- `web/scripts/migrate-legacy-postgres.mjs`: one-time legacy cutover that requires a particular populated public source, refuses existing targets, and rejects populated unmapped legacy IoT/media/QR tables. Not a fresh DB installer.
- `plant-conservation-backend/test/fixtures/rbac-legacy.sql`: test fixture only.

### Compatibility-table blocker

The active Plant API still has legacy IoT compatibility routes that query public tables, while newer IoT routes query `plant_app`. A fresh project created only from the private schema files will not necessarily have `public.sensor_device`, legacy `public.sensor_reading`, or `public.threat_alert`. Those compatibility routes may fail until the team chooses a reviewed public compatibility bootstrap or separately approves a code transition to the newer API. Do not apply the legacy migrations automatically to solve this.

## 6. Backup, rollback, and recovery

### Backup scope

- The generic `backupPostgres` helper defaults to the configured Plant schema and uses `pg_dump` custom archives plus `pg_restore --list` validation. It does not perform a restore rehearsal.
- The RBAC migration runner explicitly backs up `public`, regardless of `PLANT_PG_SCHEMA`; this is a schema-wide public dump, not just three RBAC tables.
- The system backup script separately backs up Plant and Auth schemas and optionally Face. Its default Plant archive is the configured Plant schema; it does not by itself include `public` RBAC tables. Plan a complete recovery set covering `plant_app`, `plant_auth`, `plant_face` (if used), and `public` when public compatibility/RBAC data matters, plus necessary private recovery/service keys under separate key handling.
- Current source uses TLS verification for remote PostgreSQL connections. Never put a DB password in command-line arguments, output, source, or Expo variables.

### Required recovery procedure before execution

1. Create a private, non-overwriting archive set for the new development project before each approved write phase; record project identity and schema scope without logging credentials.
2. Validate archive readability and perform an isolated restore rehearsal. `pg_restore --list` is not proof of restorability.
3. Keep a protected, independent copy outside the developer laptop and document who can restore it.
4. Prefer rebuilding the isolated development project from reviewed schema/bootstrap if it is genuinely fresh and a migration fails; do not restore development data over the shared project.
5. For RBAC assignment rollback after commit, use a validated exact assignment snapshot. The RBAC migration rollback restores assignments but intentionally leaves newly added permission definitions present and unassigned; it does not delete role/permission definitions.
6. Verify the exact target or restored matrix in both directions. Keep the write-freeze for RBAC changes until verification completes.

All migrations and backups remain unexecuted in this task.

## 7. Team/DBA decisions and action checklist

### Project owner / team

- [ ] Supply and independently verify the separate dev project reference; confirm it is not the shared project.
- [ ] Decide whether the dev project will contain synthetic-only accounts and data and who can provision them.
- [ ] Confirm whether public legacy IoT compatibility endpoints must remain available in dev.
- [ ] Confirm the target role/permission matrix, including exact Botanist QR generation behavior and `qr.generate` usage.
- [ ] Approve development email handling and face-enrollment consent/retention policy.

### DBA / security reviewer

- [ ] Review schema owners, dedicated runtime and migration logins, membership/effective privileges, sequences and function execution.
- [ ] Inspect live RLS flags/policies and table/schema grants for all four schemas; do not infer correctness from migration source.
- [ ] Confirm private schemas are not exposed to Supabase API roles; review `public` API exposure and `TRUNCATE` grants separately.
- [ ] Approve TLS/CA and pooler/direct endpoint for the new project.
- [ ] Supply/review a fresh-project RBAC base bootstrap with constraints and safe seeding.
- [ ] Approve a write-freeze, full backup scope, isolated restore test, and recovery owner.

### Implementation/release owner

- [ ] Keep the resolver unintegrated until the QR permission design is reconciled with routes and application grants.
- [ ] Ensure all URL variables point only to the new development project and all three schemas are explicit before starting a service.
- [ ] Test schema bootstraps and RBAC migration against an isolated disposable PostgreSQL database first.
- [ ] Obtain separate approval before each live-project preflight, backup, migration, or service startup.

## 8. Evidence and limitations

### Confirmed from source or sanitized local configuration

- Runtime hardcoded authorization, isolated resolver, target/legacy matrix, route permission use, migration runner behavior, schema DDL, and backup behavior described above were inspected in the paths listed below.
- The existing Plant `.env` contains a configured `DATABASE_URL` classified internally as the previously identified shared Supabase target. No URL, host, username, password, or project reference is included in this report.
- No new development target was present in the inspected configuration files.

### Requires live, approved metadata verification

- Current role/permission IDs and assignment rows.
- Actual schema/table presence, columns, types, keys, indexes, foreign keys, and constraints.
- Effective owners, grants, inherited role memberships, `PUBLIC` rights, RLS flags/policies, Data API exposure, and extensions.
- Actual project target used by a running service. No service process was started or queried.

### Exact files inspected for this report

- RBAC/application: `shared/rbac.cjs`; `plant-conservation-backend/rbac.cjs`; `plant-conservation-backend/rbac-migration.cjs`; `plant-conservation-backend/authorization.cjs`; `plant-conservation-backend/domain.cjs`; `plant-conservation-backend/iot.cjs`; `plant-conservation-backend/test/fixtures/rbac-legacy.sql`.
- Schema/migrations: `plant-conservation-backend/schema.postgres.sql`; `web/server/schema.postgres.sql`; `mobileapp/face_backend/schema.postgres.sql`; `plant-conservation-backend/migrations/001-rbac-foundation.sql`; `plant-conservation-backend/migrations/002-field-review-iot.sql`; `web/server/migrations/001-account-activation.sql`; `web/server/migrations/002-reviewer-identity.sql`.
- Connection/startup: `plant-conservation-backend/environment.cjs`; `plant-conservation-backend/database.cjs`; `plant-conservation-backend/server.js`; `plant-conservation-backend/scripts/migrate.cjs`; `plant-conservation-backend/scripts/migrate-rbac.cjs`; `plant-conservation-backend/scripts/postgres-backup.cjs`; `plant-conservation-backend/scripts/backup-system.cjs`; `web/server/postgres.mjs`; `web/server/index.mjs`; `web/server/migrate.mjs`; `web/server/legacy-postgres.mjs`; `web/scripts/migrate-legacy-postgres.mjs`; `mobileapp/face_backend/postgres_store.py`; `mobileapp/face_backend/server.py`.
- Documentation/configuration: `docs/development-database-migration-checklist.md`; `plant-conservation-backend/docs/rbac-migration-runbook.md`; `docs/supabase-connection.md`; `docs/postgresql-migration.md`; `mobileapp/docs/face-postgresql.md`; sanitized presence/target classification of relevant keys in `plant-conservation-backend/.env`, `web/.env.server`, and `mobileapp/.env.face`. No credential values were printed. The `.env.face` file is absent. `mobileapp/.env.local` is not loaded by backend DB configuration and its values were not inspected.

**No database connection, SQL execution, migration, backup, service startup, or application/configuration edit was performed.**
