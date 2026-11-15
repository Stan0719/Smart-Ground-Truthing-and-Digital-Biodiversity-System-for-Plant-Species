# QR table production cutover runbook

## Rehearsal status update — 2026-11-15

Forward migration 016 and its reverse schema move have passed a local restore,
forward rehearsal, and separate rollback rehearsal on PostgreSQL 17.11. The
new container is network-isolated and retained. See the detailed results in
[`qr-migration-test-results.md`](qr-migration-test-results.md). This does not
authorize production execution.

The particular candidate backup/hash specified for this task was not found.
The different app-only archive used for rehearsal
(`4C7C8517C588BA24215C4F5263EE5EDD92A287D29E9407E20D3E9AE04340BACB`) restored
successfully, but it is a historical application-schema snapshot, not a fresh
production backup. Thus hard blocker 1 below remains unresolved. The complete
backend test suite is also not green (two gallery and three species-request
integration failures); targeted QR tests pass. Production backend build and
deployment status are unverified. Do not proceed until owners decide whether
those unrelated failures block the release and confirm the exact deployed
build.

**State: NOT APPROVED FOR EXECUTION.** No production connection, command, DDL, DML, or migration-history change was performed while preparing this package. Every production action below requires the project owner's explicit approval and an authorized operator.

## Hard blockers

Do not start until all are true:

1. A fresh production backup is completed immediately before the window, stored securely, checksummed, and restored successfully into a separate isolated PostgreSQL 17.11 environment. The November 14 application-only package is rehearsal evidence only, not a fresh production backup.
2. Read-only production preflight confirms source-only state; 18 `public.qr_code` rows; 18 `plant_app.visitor_scan_history` rows; 0 `public.qr_scan_history` rows; table structure/identity/defaults/indexes/constraints/owner/ACL/RLS exactly match migration 016 preconditions; and exactly the expected three FK edges exist and are validated.
3. Determine the actual backend connection `session_user` and `current_user`; verify its effective schema/table/identity-sequence privileges. Do not assume `postgres`, `service_role`, or another role from local files.
4. Confirm Supabase Data API exposed schemas in project settings. Decide whether QR tokens must remain inaccessible via Data API; `plant_app` exposure plus preserved broad table ACL must be reviewed. Do not grant `anon`, `authenticated`, or `service_role` access automatically.
5. Reconcile migration history with the responsible operator. Production lacks `supabase_migrations.schema_migrations`, and the app/auth ledgers track different things. No replay of 001–015 and no `supabase db push` are allowed. If adopting CLI tracking, establish the correct timestamped migration in `supabase/migrations` and use an explicitly reviewed history-only repair after manual application; do not claim it is tracked until verified. See [Supabase migration deployment docs](https://supabase.com/docs/guides/deployment/database-migrations).
6. The deployed application version and cutover deployment order are confirmed. Current backend source already expects `plant_app.qr_code`; production still has the old location according to supplied facts.
7. The owner explicitly approves the maintenance window, production execution, and named executor.

Any mismatch, timeout, unexpected lock wait, extra FK/dependency, changed row count, ACL/RLS difference, destination object, or ambiguous role/history state blocks execution. Stop and investigate; do not weaken timeouts or edit preconditions to force success.

## Approval gate and change window

1. Schedule a maintenance window. Announce QR generation, assignment, scanning/history writes, and application deploy pause.
2. Pause QR-affecting traffic at the application/gateway and stop background workers that can read/write QR rows or visitor history. Drain in-flight requests and verify no writers remain.
3. Take the fresh backup and perform the restore rehearsal before the approved window. Keep the backup protected and immutable.
4. Run the read-only preflight in the same session/role intended for the change where possible. Save sanitized outputs (no connection strings or secrets).
5. Confirm the application build/config is ready for `plant_app.qr_code`; decide whether to deploy code immediately before or after DDL while traffic remains paused. Since code already targets the destination schema, the coordinated cutover must avoid serving that version before the table move.
6. Get explicit owner approval to execute the exact reviewed 016 file. This runbook itself is not authorization.

## Read-only preflight

Run from an approved SQL client against the intended project only after authorization. Use the secure connection profile/prompt; do not place credentials in command arguments, logs or this document. Do not execute DDL/DML in this phase.

```sql
SELECT current_database(), session_user, current_user, version();
SELECT to_regclass('public.qr_code') AS source,
       to_regclass('plant_app.qr_code') AS destination,
       (SELECT count(*) FROM public.qr_code) AS qr_count,
       (SELECT count(*) FROM plant_app.visitor_scan_history) AS visitor_history_count,
       (SELECT count(*) FROM public.qr_scan_history) AS public_scan_count;
SELECT c.conname, c.conrelid::regclass AS referencing_table,
       c.confrelid::regclass AS referenced_table, c.convalidated,
       pg_get_constraintdef(c.oid)
FROM pg_constraint c
WHERE c.contype='f'
  AND (c.conrelid IN ('public.qr_code'::regclass,
                      'plant_app.visitor_scan_history'::regclass,
                      'public.qr_scan_history'::regclass)
       OR c.confrelid='public.qr_code'::regclass);
```

If either relation is absent, the `::regclass` query will error; treat that as a failed preflight, not a reason to improvise. Also collect table/sequence OIDs, owner, ACL, RLS flags, identity sequence metadata, indexes, defaults, columns, every incoming FK, dependencies, and effective privileges from a reviewed read-only query set. Check Dashboard → API settings for exposed schemas. Runtime role and exposed-schema settings are currently unknown.

## Execution procedure (approval required)

Use a trusted local copy of the reviewed file `plant-conservation-backend/migrations/016-production-qr-schema-move.sql`. Verify its checksum against the approved change artifact before execution. Use a TLS-verified PostgreSQL client connected to the correct project with credentials entered through the approved secure client prompt/profile. Never paste the connection URI into shell history or logs.

Example PowerShell shape, with connection details supplied only through a secure libpq service definition or an interactive client profile:

```powershell
$migration = 'plant-conservation-backend\migrations\016-production-qr-schema-move.sql'
Get-FileHash -Algorithm SHA256 -LiteralPath $migration
psql --set ON_ERROR_STOP=1 --file $migration <approved-secure-connection-profile>
```

`<approved-secure-connection-profile>` is a placeholder, not a literal argument. The operator must use the organization's approved credential mechanism; never use `-W` with a password, `PGPASSWORD`, or a pasted URL. Do not run `supabase db push`, `supabase migration up`, or any unreviewed migration runner. Migration 016 sets local `lock_timeout='5s'` and `statement_timeout='60s'`; a timeout/error aborts the transaction. Stop, diagnose, and reschedule if it cannot acquire locks safely.

## Post-migration verification while traffic remains paused

Require every check to pass before resuming traffic:

```sql
SELECT to_regclass('public.qr_code') AS old_table,
       to_regclass('plant_app.qr_code') AS new_table,
       (SELECT count(*) FROM plant_app.qr_code) AS qr_count,
       (SELECT count(*) FROM plant_app.visitor_scan_history) AS visitor_history_count,
       (SELECT count(*) FROM public.qr_scan_history) AS public_scan_count;
SELECT c.conname, c.conrelid::regclass AS referencing_table,
       c.confrelid::regclass AS referenced_table, c.convalidated,
       pg_get_constraintdef(c.oid)
FROM pg_constraint c
WHERE c.contype='f'
  AND (c.conrelid IN ('plant_app.qr_code'::regclass,
                      'plant_app.visitor_scan_history'::regclass,
                      'public.qr_scan_history'::regclass)
       OR c.confrelid='plant_app.qr_code'::regclass);
SELECT pg_get_serial_sequence('plant_app.qr_code','qr_id') AS identity_sequence;
```

Check old table is NULL, new relation exists with the pre-migration OID, row counts remain exactly 18/18/0, QR ID/token/status values match a protected preflight fingerprint/export, both history FKs now reference the destination and remain validated, plant FK remains validated, and sequence OID/identity ownership/defaults/indexes/constraints/owner/ACL/RLS match the approved baseline. Recheck effective runtime privileges and Data API exposure. Do not print QR token values in logs. Run backend readiness check and one controlled generation/retrieval/scan through the deployed application with test records/approved controlled account; inspect visitor history counts for expected behavior. No such live check has been run yet.

## Migration-history reconciliation

Do not insert guessed rows into `plant_auth.schema_migrations` or create a CLI ledger by hand. `plant_auth.schema_migrations` v1 is the authentication bootstrap; it does not represent backend migrations 001–016. Before the window, the owner/operator must agree on a source-of-truth tracking approach. CLI tracking should use a proper timestamped migration in `supabase/migrations`; if the schema move was applied manually and its SQL is already verified, an authorized operator may use `supabase migration repair --status applied <timestamp> --remote` only after confirming exactly which migration is being marked and that the command changes tracking only. Confirm the current CLI version and command semantics first. This history repair must never replay SQL and must not be run until separately approved. CLI v3 uses local defaults unless explicitly remote; treat any `--remote` command as production-impacting. See [CLI v3 migration guidance](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3).

## Rollback conditions and procedure

Rollback is appropriate only if postchecks fail before traffic resumes, or if a separately approved incident plan requires reverting and the application is aligned to the old schema. First pause/drain QR-related traffic again. Confirm only `plant_app.qr_code` exists; all three FK edges, counts, current row fingerprints, identity dependency and ACL/RLS state satisfy `016-production-qr-schema-move-rollback.sql`. Back up the current state if any application traffic has occurred. Then obtain explicit approval and execute the reviewed rollback file through the same secure `psql` method. It uses the reverse `ALTER TABLE ... SET SCHEMA public` and preserves rows; it is not a data rollback.

After traffic resumes, new QR/history writes remain in the same tables, but the rollback does not reverse application code, permissions changed separately, or API configuration. Reverting the schema while application code still queries `plant_app.qr_code` causes downtime. Coordinate app rollback and database rollback together, and verify post-rollback OID/count/FKs/identity and app readiness before reopening traffic.

## Expected downtime and residual risks

The script obtains `ACCESS EXCLUSIVE` on QR and `SHARE` locks on both history tables and `plant_app.plant_record`; these block relevant writes while the transaction runs. The schema move should be brief, but lock acquisition can fail at five seconds and the transaction has a 60-second statement timeout. Plan for QR-related downtime covering traffic pause/drain, migration, verification and code/schema alignment. Exact duration cannot be guaranteed before observing production load and lock queues.

The `ALTER TABLE ... SET SCHEMA` operation preserves the existing table and sequence objects, records, indexes, constraints, FKs, owner, ACL and RLS flags; the local PG17.11 rehearsal confirmed those postconditions. It also preserves any broad existing ACL. It does not itself make `plant_app` exposed through the Supabase API or grant schema USAGE. Verify both intentionally. Never grant API roles automatically.

## Production actions requiring explicit human approval

- Authorize a production read-only preflight and dashboard settings review.
- Approve the fresh backup and restore rehearsal procedure/storage.
- Choose and approve application pause/deploy order and maintenance window.
- Approve the exact reviewed 016 checksum and production execution.
- Approve any separate privilege/RLS/API exposure change, if justified; none is included in 016.
- Approve any history-only Supabase CLI repair after successful DDL and a reviewed tracking plan.
- Approve rollback execution if rollback conditions occur.
