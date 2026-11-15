# QR production schema migration audit

**Status:** repository and isolated-rehearsal audit complete; production deployment remains blocked pending the gates in [the cutover runbook](qr-production-cutover-runbook.md).

## Scope and evidence labels

- **Supplied production facts** are facts provided in this conversation, not independently queried live. No production connection was made.
- **Rehearsal observations** came from the supplied pre-migration backup restored into a new isolated PostgreSQL 17.11 Docker container.
- **Repository findings** are based on the current working tree. The repository contains existing uncommitted work; this audit preserved it.

Production project reference: `ksdacwolokuprxzgpbxs`. PostgreSQL: 17.11.

## Migration history and runners

The backend SQL files are in `plant-conservation-backend/migrations/001-*.sql` through `016-*.sql`. They are not in `supabase/migrations`; the latter directory has no migration SQL. The custom Plant API runner, `plant-conservation-backend/scripts/migrate.cjs`, manages `plant_app.schema_migration_history` and a limited explicit file map; it does not treat every file 001–016 as an automatically applied sequence. The QR-only local runner `plant-conservation-backend/scripts/migrate-qr-only.cjs` targets local development and migration 015; it must not be used for production.

The authentication bootstrap is separate: `web/server/schema.postgres.sql` creates `plant_auth.schema_migrations` and inserts integer version 1, and `web/server/auth.mjs` reads that version. Production is reported to have this v1 record, but neither `plant_app.schema_migration_history` nor `supabase_migrations.schema_migrations` exists. These ledgers are not interchangeable. Do not replay 001–015 to manufacture history. Supabase CLI tracking is ordinarily based on timestamped files in `supabase/migrations`; the CLI supports repairing tracking metadata for already-applied migrations without replaying their SQL. A repository migration history must first be reconciled by an authorized operator. See [Supabase migration deployment documentation](https://supabase.com/docs/guides/deployment/database-migrations).

The production schema facts (source QR table exists; destination does not) show that a completed move by 014/015/016 is not reflected in production. They do not prove which earlier migrations ran. The QR-to-`plant_app.plant_record` FK is evidence that the relation exists, not proof that a particular migration file ran. Production's visitor-history FK still points to `public.qr_code`, which is inconsistent with the current `010` file's expected target. Migrations 001–013 therefore require object-by-object live reconciliation; file presence is not evidence of application.

## Inventory of migrations 001–016

This is a static SQL inventory, not a claim that these changes exist in production.

| File | Main objects/changes |
|---|---|
| `001-rbac-foundation.sql` | Alters `public.plant_record` and `public.species`; creates `public.rbac_species_visibility` and `plant_subject_idx`. |
| `002-field-review-iot.sql` | Creates observation, review, asset, IoT, reading, threat, response and audit tables in `public`, with inline keys/checks and two named indexes. |
| `003-plant-qr-inventory.sql` | Precondition checks and inserts missing QR inventory mappings into `plant_app.qr_code`; does not create the table. |
| `004-species-requests.sql` | Creates species request submission table/index and enables RLS. |
| `005-plant-scientific-name.sql` | Adds `scientific_name` to `plant_app.plant_record`. |
| `006-atomic-plant-submissions.sql` | Creates plant submission receipt, adds proposed species FK, enables RLS. |
| `007-qr-plant-reference.sql` | Reconciles the QR-to-plant FK on `public.qr_code` to `plant_app.plant_record`. |
| `008-record-change-submissions.sql` | Creates record change submission table and partial unique indexes; enables RLS. |
| `009-record-version-history.sql` | Creates record version history, three indexes and RLS. |
| `010-visitor-favourites-scan-history.sql` | Creates `plant_app.visitor_favourite` and `plant_app.visitor_scan_history`, indexes, RLS and grants/revokes; its QR FK expectation conflicts with the supplied production FK location. |
| `011-botanist-notification-history.sql` | Creates botanist notification table/index, performs a backfill, enables RLS and changes grants. |
| `012-observation-origin.sql` | Adds observation origin type and check constraint. |
| `013-staff-notification-foundation.sql` | Creates staff notification/event tables, indexes, constraints, RLS and two guard trigger functions/triggers. |
| `014-move-qr-code-to-plant-app.sql` | Conditional schema move or target creation plus QR plant-FK reconciliation. A completed move is contradicted by the supplied production table locations. |
| `015-local-qr-only-move.sql`, `015-local-qr-only-move-rollback-test.sql`, `015-local-qr-only-move.sql.before-parent-fix` | Existing local-only/review artifacts; do not use as production history or deployment input. |
| `016-production-qr-schema-move.sql`, `016-production-qr-schema-move-rollback.sql` | Transactional production candidate and reverse schema move, with preconditions/locks/postconditions. |

The full SQL is in the linked files; this compact inventory omits individual inline constraints where their definition is already in the migration. The production schema must be checked against actual object names and definitions immediately before deployment.

## QR dependencies and application references

Supplied production dependency graph:

- `public.qr_code.plant_id` → `plant_app.plant_record`.
- `plant_app.visitor_scan_history.qr_id` → `public.qr_code`.
- `public.qr_scan_history.qr_id` → `public.qr_code`.

The rehearsal showed PostgreSQL updates FK target OIDs on `SET SCHEMA`; both incoming FKs and the outgoing plant FK remained validated without drop/recreate. The production script explicitly checks the expected FK names, columns and actions and stops if the shape differs.

Backend SQL already targets `plant_app.qr_code` in `plant-conservation-backend/domain.cjs`, `plant-submissions.cjs`, `record-changes.cjs` and `server.js` (startup readiness check). Mobile code calls the API rather than querying PostgreSQL directly. QR references in historical migrations and fixtures are intentionally not bulk-rewritten: they describe older schemas or migration scenarios. No application SQL path change was required by this audit. The deployed application version and the actual database connection role remain unverified.

## Backup and object security observations

The original backup's `data.sql` includes a COPY block for `auth.audit_log_entries.ip_address`, but `schema.sql` has no matching table definition. That managed-schema mismatch explains why the combined original dump cannot be considered a complete restorable snapshot. The four requested application schemas had matching table definitions for all their filtered data COPY blocks. A separate application-only archive was built and successfully restored; details and hashes are in [the backup rehearsal report](qr-backup-restore-rehearsal.md).

In the restored snapshot, the QR table ACL includes `anon`, `authenticated`, and `service_role`; the QR identity sequence ACL also includes those roles. RLS and FORCE RLS are off and there are no QR policies. `plant_app` schema USAGE is absent for those API roles in that snapshot. This is evidence about the backup snapshot only, not an independent live production check. Since table ACLs survive a schema move, do not expose `plant_app` through the Data API or grant schema USAGE until table/sequence ACLs, RLS policy design, token confidentiality, and runtime-role needs are reviewed. Supabase requires both schema exposure and suitable grants for Data API access; RLS is a separate row-security layer. See [custom schema configuration](https://supabase.com/docs/guides/api/using-custom-schemas) and [API security](https://supabase.com/docs/guides/api/securing-your-api).

Migration 016 preserves table ACL, owner, RLS flags, identity sequence ACL/owner and OIDs; it does not correct any pre-existing broad ACL or grant `plant_app` USAGE. Do not infer that this alone establishes a least-privilege state.

## Uncertainties and deployment blockers

1. No authorized live read-only preflight has confirmed the current owner, ACL, sequence, indexes, RLS, dependency count, exact history constraints, runtime role or current counts immediately before cutover.
2. Production backup restoration has not been rehearsed. The November 14 supplied snapshot was restored locally, but it is not a fresh pre-cutover backup.
3. The deployed API version, role and actual effective schema/table/sequence privileges are unknown.
4. Dashboard Data API exposed schemas and QR token exposure expectations are unknown.
5. Production Supabase migration tracking has no reported tracking schema; there is no safe automatic replay path for 001–015. Do not use `db push` to address this.
6. The production schema's 18/18/0 row counts and supplied dependency graph must be rechecked at the cutover boundary. Migration 016 intentionally aborts if they differ.

No production SQL was executed, and no production migration history was modified.
