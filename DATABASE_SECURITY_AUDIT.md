# Backend Database Security Audit

## Scope and evidence

This is a repository review, not a live database assessment. No service was
started and no production connection was made. Production catalog, grant, RLS,
data, and connection-user observations below are supplied by the project team
in the review request; they have not been re-queried. Environment file values
were not displayed. Only configuration variable names were inspected.

## Connection architecture

`web/server/postgres.mjs` loads server environment in this precedence order:
inherited process environment, `plant-conservation-backend/.env`,
`web/.env.server`, and selected face settings from `mobileapp/.env.face`.
Existing process values win. In the inspected files, the backend `.env`
contains a `DATABASE_URL` key; `.env.server` has data-encryption keys and no
database URL keys; `mobileapp/.env.face` was absent. File presence does not
prove deployment environment values.

| Component | Connection selection | Schema/use | Connection and privilege notes |
|---|---|---|---|
| Plant API | `plant-conservation-backend/database.cjs`; `DATABASE_URL` wins over discrete `DB_*`/`PG*` settings | `plant_app` search path; QR code queries are explicitly qualified as `plant_app.qr_code`; other plant tables use the configured search path | `pg.Pool` defaults to max 10 because no max is supplied. Remote PostgreSQL uses TLS certificate verification. The plant process also creates the account-auth adapter. |
| Account/auth API | `AUTH_DATABASE_URL || DATABASE_URL` in `web/server/postgres.mjs` | `plant_auth` by default | Pool max 5; remote connections use `sslmode=verify-full` and certificate verification. Auth performs account, visitor, session, token, security-setting, nonce and audit operations. |
| Face API | `FACE_DATABASE_URL || DATABASE_URL` in `mobileapp/face_backend/postgres_store.py` | `plant_face` by default; must differ from `plant_auth` | Opens a direct psycopg connection, validates six tables at startup, and stores biometric templates, account links, sessions and challenges. Remote TLS uses `verify-full`. Face account authority may separately call the account service using its configured URL and key file. |
| Plant migration runner | `npm run migrate` → `scripts/migrate.cjs` | `plant_app` | Current runner rejects non-loopback database hosts. It uses the configured plant connection role, takes a backup, applies schema bootstrap plus its explicit 014/003 logic, and maintains the application ledger. It is not a production deployment path. |
| QR-only/local runners | `migrate:qr-only` and `migrate:qr-restore-test` | Fixed local database targets | Both are local-only. `migrate:qr-only` targets `plant_conservation_dev`; restore-test targets the isolated Docker database. Neither is a production command. |
| Auth/face migration runner | `npm run migrate:auth` / `npm run migrate:face` | `plant_auth` / `plant_face` | Uses the same auth/face URL precedence as runtime and performs DDL/revokes. No remote-host safety gate is present in the inspected runner. Treat these as privileged operator commands. |
| RBAC migration runner | `npm run migrate:rbac` | Application database | Uses the plant pool and has no local-host guard in the inspected runner. It takes a backup and applies RBAC data migration. Do not run without checking the selected target and role. |
| Other operator tools | `web/scripts/migrate-legacy-postgres.mjs`, `web/scripts/import-sqlite.mjs`, `web/server/create-admin.mjs` | Configured auth/plant/face database | These can perform database writes using the configured service credentials. They are not QR deployment tools. `create-admin` has a non-email mode that prints a generated temporary password; do not use that mode where terminal output is retained or shared. |

The project-supplied prior inspection states that the configured pooler
username was `postgres.ksdacwolokuprxzgpbxs`, that the backend URL path takes
precedence over `DB_USER=plant_app`, and that production `current_user` was
`postgres`. These facts indicate the current application uses an elevated
PostgreSQL role. They are not independently revalidated here. The URL username
is a project-scoped Supabase pooler form for the `postgres` database role; it
is not the Supabase Data API `service_role`.

### Safe session identity verification

Run from an already authorized session, not by starting the application:

```sql
SELECT current_database(), current_user, session_user;
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
FROM pg_roles
WHERE rolname = current_user;
```

Do not include connection strings, passwords, API keys, or service output in
logs. Confirm the role by comparing this result with the approved deployment
role inventory.

## Database operations and minimum privileges

The requirements below are application-runtime requirements, not migration
privileges. CRUD refers to PostgreSQL table privileges. RLS policies are an
additional condition and can still block these operations.

| Component | Object area | Minimum operation categories observed in code |
|---|---|---|
| Plant API | `plant_app.qr_code` | `SELECT` for listing, lookup and locking; `INSERT` for QR generation; `UPDATE` for assignment/reassignment; `DELETE` for eligible unused generated QR rows. |
| Plant API | `plant_app.qr_code_qr_id_seq` | `USAGE` for identity allocation. The table also needs `SELECT` for returned identity and QR values. |
| Plant API | `plant_app.plant_record` | `SELECT`, `INSERT`, and `UPDATE` for plant lookup, registration, and edits used with QR workflows. `RETURNING` requires corresponding `SELECT` access. Other plant routes require a broader, separately inventoried set of privileges. |
| Plant API | `plant_app.visitor_scan_history` | `SELECT` and `INSERT`; scan creation and visitor history retrieval. Its identity sequence requires `USAGE`. |
| Auth API | `plant_auth` tables | `SELECT`/`INSERT`/`UPDATE`/`DELETE` across accounts and visitors; session and visitor-session insert/read/delete; password-reset and activation-token insert/read/update; audit-event read/insert; security-setting read/update; nonce read/insert/delete; and account-email trigger maintenance. `auth_events_id_seq` needs `USAGE`. `schema_migrations` is read at startup. |
| Face API | `plant_face.accounts`, `sessions`, `challenges`, `real_face_templates`, `face_account_links`, `legacy_face_replacements` | `SELECT`, `INSERT`, `UPDATE`, and `DELETE` across the face workflow. Biometric and account-link data should be private to this service. |

All runtime roles need `USAGE` on their respective private schema. The existing
backend currently uses the elevated `postgres` role according to supplied
production evidence. This role has broad database privileges and bypasses RLS;
it is not a least-privilege runtime identity. `service_role` is a Data API/JWT
role with `BYPASSRLS`, but the supplied inspection says it lacks CRUD on the
relevant tables. RLS bypass does not grant table privileges and is not a reason
to use it as the backend PostgreSQL login.

### Excessive or unusual grants

The supplied production inspection found no effective `SELECT`, `INSERT`,
`UPDATE`, or `DELETE` on the inspected QR/plant tables for `anon`,
`authenticated`, or `service_role`; it did find effective `TRUNCATE`,
`TRIGGER`, and `REFERENCES` on some public tables. Those privileges are
unusual for browser/API roles and should be inventoried by exact relation and
grant source (direct, inherited, `PUBLIC`, and default privileges). Do not
apply a broad revoke until the exact objects and intended consumers are
confirmed. `postgres` had full privileges on inspected tables.

The QR move does not itself create runtime grants. A table move preserves its
owner and table ACLs, but callers also need `USAGE` on the destination schema.
The identity sequence ACL and the destination schema ACL must be checked
separately after the move.

## RLS and Supabase Data API

Supplied production observations:

- RLS disabled: `public.qr_code`, `public.plant_record`,
  `plant_app.plant_record`, and `public.qr_scan_history`.
- RLS enabled: `plant_app.visitor_scan_history`.
- No effective CRUD grants for `anon`, `authenticated`, and `service_role` on
  inspected QR/plant tables; some of those roles had other elevated table
  privileges on public tables.

RLS disabled does not by itself make a table reachable through PostgREST. Data
API reachability also depends on whether its schema is exposed, schema `USAGE`,
object privileges, and the API role selected for the request. Once a role has
table privileges, disabled RLS permits access to all rows for that role.
Conversely, enabled RLS with no applicable policy blocks ordinary roles even
when grants exist. The backend’s current `postgres` role bypasses RLS, which
explains why it can operate on the visitor-history table without user-facing
policies; a custom runtime role would need a deliberately designed policy or
an explicitly reviewed backend access model.

Repository code uses direct PostgreSQL for plant, visitor scan, authentication,
and face storage. The mobile application calls backend routes; the repository
does not show a QR `supabase-js` Data API client. Keep `plant_app` unexposed
unless direct client access is intentionally designed and reviewed. The
Supabase Dashboard’s Data API exposed-schema list is project configuration
and was not available in repository files. Supabase documents grants and RLS
as separate controls and recommends securing exposed objects with both:
[API security guide](https://supabase.com/docs/guides/api/securing-your-api).

`plant_app.visitor_scan_history` is enabled for RLS by migration 010, which
revokes `PUBLIC`, `anon`, and `authenticated` access and grants the trusted
`postgres` runtime. No corresponding policies are created in that migration.
Do not enable/force RLS or add policies without testing the actual identity
context and visitor ownership predicates.

## Recommendations

1. Replace the shared elevated `postgres` application connection with separate
   login roles for plant API, auth API, and face API. Keep migration ownership
   credentials separate, time-bound, and unavailable to public clients.
2. Grant only the reviewed schema and object privileges for each role. Do not
   grant Data API access to these private tables as a workaround for backend
   privilege errors.
3. Keep `plant_auth` and `plant_face` unexposed; keep `plant_app` unexposed
   unless a separately reviewed Data API design requires it.
4. Inventory and remove confirmed unnecessary `TRUNCATE`, `TRIGGER`, and
   `REFERENCES` grants from browser/API roles and review default privileges.
5. Design and test RLS for the non-owner backend identity, especially
   visitor-scoped scan history, before moving off `postgres`. Do not give a
   runtime role `BYPASSRLS` merely to avoid designing policies.
6. Separate migration credentials and deployment runner paths from runtime
   credentials. The current local-only Plant runners are not production
   runners; Auth, Face, and RBAC migration commands can use configured remote
   URLs and need controlled operator execution.
7. Review aggregate pool usage. Auth caps at 5; plant uses node-postgres’s
   default maximum; face opens a direct connection. Include all service
   instances and migration/backup activity in the Supabase connection budget.
8. Restrict operator utilities and backups. The system backup helper can
   include recovery/account-service key files; its manifest and archive
   directory are created with restrictive file modes, but the backup store
   still needs appropriate access control, encryption, retention, and restore
   testing.

## SQL proposal

`PROPOSED_DATABASE_PERMISSIONS.sql` is a review-only template. It uses
unassigned role placeholders and must not be executed as written. Runtime
grants are only a QR-related subset; the complete plant API privilege inventory
must be reviewed before role cutover. No role, grant, RLS, or exposure setting
was changed as part of this audit.
