# QR schema move: production readiness package

## Latest status update — 2026-11-15

The local PostgreSQL 17.11 forward migration and reverse-move rehearsals have
now passed on a fresh restore in the network-isolated container
`qr-016-final-rehearsal-20261115`. The forward and rollback files were not
changed. Their SHA-256 values at rehearsal were respectively
`EA17C54D0355D5893335CFC54522CDBFAF7455A54E6EE7400E692AC616654BBD` and
`7DA7265F275E12C8BDACAE1E9B9192BBBF8C66F2092553D97F74AA3BDE596E94`.
Table/sequence OIDs, all 18 QR records, both history counts, the FK graph,
indexes, identity state, ownership, ACLs and RLS flags matched before/after.
Details are in [`../docs/qr-migration-test-results.md`](../docs/qr-migration-test-results.md)
and [`../docs/qr-backup-restore-rehearsal.md`](../docs/qr-backup-restore-rehearsal.md).

The archive used was the app-only snapshot with SHA-256
`4C7C8517C588BA24215C4F5263EE5EDD92A287D29E9407E20D3E9AE04340BACB`, not a
fresh production capture. The separately named expected candidate and hash
`785A56314E8DB753834EAD9DB44D0D559436B86EDBAC01A000AAF88E60076E8B` were
not found. Therefore the fresh-backup-and-restore production gate remains
open. Production state, runtime role, Dashboard Data API exposure, migration
history, and deployed build have not been freshly inspected in this task.

Targeted QR backend/mobile tests passed. The full backend suite still has
unrelated gallery (2 expected 200/actual 404) and species-request integration
(3 expected 200/actual 503) failures. One QR startup fixture was updated in
`test/server-startup.test.cjs`; no application runtime module or migration SQL
was changed in this task. See
[`../docs/qr-application-compatibility-test-report.md`](../docs/qr-application-compatibility-test-report.md).
**Status remains not approved for production execution.**

## Status

This is a review package, not authorization to run a production migration. The
production SQL and reverse SQL are kept outside `supabase/migrations` because
the canonical production migration history has not been selected or reconciled.
Nothing in this package was run against production. No grants are issued by the
move.

## Package files

- `migrations/016-production-qr-schema-move.sql` — production candidate. Its
  only data-definition change to the QR relation is
  `ALTER TABLE public.qr_code SET SCHEMA plant_app`.
- `migrations/016-production-qr-schema-move-rollback.sql` — reverse schema
  move, retaining whatever data exists when rollback is approved.
- `scripts/qr-production-readonly-checks.sql` — count, role, ACL, RLS and
  PostgREST setting checks. It does not select QR token values or change state.
- `test/qr-production-migration.test.cjs` — migration safety test coverage;
  targeted tests passed locally.

## Migration behavior and operator configuration

The production candidate has one transaction, `lock_timeout = '5s'`, and
`statement_timeout = '60s'`. These are explicit operator-editable values near
the top of the file. Choose values for the approved maintenance window, review
them, and retain finite bounds. A timeout aborts the transaction; do not remove
the timeout to force the change through live traffic.

After taking locks, it requires 18 `public.qr_code` rows, 18
`plant_app.visitor_scan_history` rows, and 0 `public.qr_scan_history` rows.
These are configuration gates derived from the supplied production snapshot.
If a fresh read-only check differs, stop and reconcile with the data owner; do
not casually change the constants. It requires RLS disabled and not forced,
the reviewed table shape/indexes/FKs, exactly the two known incoming QR FKs,
and the existing plant target. The OID, row counts, owner, ACL, RLS state,
history FKs and identity sequence are checked after the move.

The operation does not copy records, rebuild constraints, grant privileges,
enable RLS, expose a schema, or resolve plant/token mapping discrepancies.
The move preserves table and sequence ACLs. `plant_app` schema `USAGE` and
Data API exposure are separate controls and must be reviewed independently.

## Test coverage status

The targeted backend QR suite passed, including migration safety,
preconditions, forward/reverse behavior, generation, lookup, inventory,
visitor history, plant submission, record changes, and server startup. The
mobile API/payload tests passed. Separately, the actual migration SQL and
rollback SQL were both executed successfully against restored, isolated
PostgreSQL 17.11 databases; detailed counts, fingerprints, OIDs and dependency
checks are in `../docs/qr-migration-test-results.md`.

The complete backend suite is not green: two gallery assertions received 404
instead of 200, and three species-request integration assertions received 503
instead of 200. These failures are outside the QR test set. The QR-specific
startup fixture was corrected in `test/server-startup.test.cjs` to supply the
schema argument the startup code already expects. No runtime QR module or
migration SQL was changed for that fix. See
`../docs/qr-application-compatibility-test-report.md` for exact commands and
release implications.

## Read-only preflight and access review

Run the first query in `scripts/qr-production-readonly-checks.sql` on the
backend's actual PostgreSQL connection, not an administrator connection, to
record `session_user`, `current_user`, and `search_path`. The remaining queries
report effective schema/table/sequence privileges for that current role and,
separately, diagnostic privileges for `anon`, `authenticated`, and
`service_role` if those roles exist. They do not change grants.

The `pgrst.db_schemas` GUC queries are diagnostic only. Supabase's Dashboard
Data API **Exposed schemas** setting is authoritative; confirm that
`plant_app` is not exposed unless a separately reviewed API design explicitly
requires it. Keep QR token access behind the backend. Do not grant API roles
access automatically. If the backend uses a future least-privilege login,
grant only the verified runtime role the specific schema/table/sequence
privileges its routes need, after its RLS model has been decided.

## Deployment checklist

1. **Select the migration-history authority.** Reconcile the local
   `supabase/migrations` directory and remote
   `supabase_migrations.schema_migrations` history using an authorized,
   read-only review. Decide whether this change will be adopted into the
   Supabase CLI workflow or another formally approved ledger. Do not run
   `migration repair` or the local application migration runner to manufacture
   history. This package file is not automatically discovered by Supabase CLI.
2. **Confirm production state immediately before the window.** From approved
   read-only sessions, confirm source/destination, exact table shape, row
   counts (18 / 18 / 0), all three FK definitions, owner/ACL/RLS, sequence
   identity, catalog dependencies, and plant/token mapping disposition. The
   migration fails on a count or shape mismatch.
3. **Resolve data ownership and permission questions.** Record the actual
   backend `current_user`; review its effective grants and the Data API
   Exposed schemas setting. Keep `plant_app` unexposed and do not grant
   `anon`, `authenticated`, or `service_role` access as part of this move.
4. **Prove recovery first.** Take and validate a complete backup, restore it
   to a separate disposable PostgreSQL 17.11 target, compare QR/history data,
   rehearse the production candidate and reverse artifact, and retain logs.
   The backup must be restorable; a successful dump alone is insufficient.
5. **Approve application cutover.** Confirm a tested application build that
   queries `plant_app.qr_code`. Choose either a planned outage or a coordinated
   rollout. Old code querying `public.qr_code` fails after the move; new code
   querying `plant_app.qr_code` fails before it.
6. **Pause writes and scans.** Stop or gate QR generation, assignment,
   reassignment, activation, lookup/scan recording, and background jobs.
   Drain transactions before running the script. Confirm the 5 second lock
   timeout and 60 second statement timeout are suitable. If a lock times out,
   stop and investigate; do not retry during active writes.
7. **Obtain final approval for the exact artifact and operator command.**
   Review the artifact checksum, database identity, approved role, selected
   history entry, maintenance window, backup location, application build, and
   rollback owner. Only then may an authorized operator execute it through the
   approved migration system.
8. **Keep traffic paused until verification passes.** Do not use the
   local-only 015 file or any local-only runner in production. On any SQL
   exception or unexpected postcheck, stop and inspect read-only before any
   retry or repair.

## Post-migration verification checklist

Use count-only queries and an approved non-secret fingerprint comparison; do
not print QR token values in logs.

- `public.qr_code` is absent; `plant_app.qr_code` exists with the exact
  original relation OID.
- `plant_app.qr_code` has 18 rows and the same set of 18 `qr_id` values as the
  pre-change baseline. Compare a secured fingerprint of QR ID, plant ID,
  status, and timestamps without outputting `qr_code` tokens.
- `plant_app.visitor_scan_history` still has all 18 rows; compare its stable
  scan IDs and QR ID links to the pre-change baseline.
- `public.qr_scan_history` remains at 0 rows unless an approved fresh baseline
  changed; its FK still targets the moved table object.
- Both history FKs target `plant_app.qr_code(qr_id)` with their original
  delete/update actions, validation and deferrability. The plant FK still
  targets `plant_app.plant_record(plant_id)` with `ON DELETE SET NULL`.
- The identity sequence has the original OID, remains identity-owned by
  `qr_id`, is located in `plant_app`, and has unchanged owner/ACL and a next
  value above the maximum QR ID.
- Table owner and ACL are unchanged; `relrowsecurity` and
  `relforcerowsecurity` remain false. No role grants were added.
- The backend application's approved runtime role can perform its required
  routes. API roles cannot read QR tokens; `plant_app` remains absent from the
  Dashboard's exposed schema list.
- The chosen migration history records the exact reviewed artifact only after
  commit. Do not label a recognized/superseded state as execution.

Resume traffic only after the application smoke checks and these postchecks
pass and the operator records approval to reopen service.

## Rollback limitations

The reverse file moves the same table object from `plant_app` back to `public`
inside a transaction. It preserves post-move QR and history writes; it does not
rewind them. Once application traffic resumes, a reverse move alone is not a
rollback of the application release, permissions, API settings, or ledger.
Pause traffic again, compare all post-backup writes, confirm the old application
can safely use the current schema/data, and rehearse the reverse move against a
fresh restore before approval. Do not restore over production as an automatic
rollback. If plant records or QR/history schemas changed after the move, stop
for a recovery decision rather than applying this reverse file blindly.

## Remaining uncertainties

- Actual production role, effective grants, schema exposure and live catalog
  state were not inspected during this preparation.
- Whether 18/18/0 still matches at execution time is unknown.
- The Supabase CLI remote migration list and any manual SQL history are
  unknown; the production history authority has not been selected.
- The unresolved plant/token mappings noted in the earlier readiness review
  still need a data-owner decision. This move will not repair them.
- The exact candidate backup named in the task and its expected SHA-256 were
  not found. The app-only archive used for successful local restore/rehearsal
  is a historical snapshot, not a fresh production backup. A fresh production
  backup and independent restore rehearsal remain mandatory.
- Deployed backend build, live runtime role, actual Data API exposure, and
  current production catalog state remain unverified. The repository alone
  does not establish those production facts.

## Human approvals required

Before production execution, obtain explicit approval for:

1. The current read-only preflight, exact counts/OIDs/FKs/ACL/RLS, role and
   API exposure findings, and disposition of any changed or ambiguous data.
2. The complete backup and successful isolated restore/rehearsal evidence.
3. The production artifact checksum, migration-history mechanism and exact
   registration semantics.
4. The actual application build and planned outage/coordinated cutover.
5. The lock and statement timeout values, approved migration operator,
   production target identity, maintenance window, and stop conditions.
6. The named rollback/recovery owner and a decision to resume traffic after
   verification.

Approval of this readiness package does not itself authorize execution.

## Supabase references

- [Using custom schemas](https://supabase.com/docs/guides/api/using-custom-schemas) describes the Dashboard Exposed schemas setting and the separate PostgreSQL schema/table grants needed for Data API access.
- [Deploy database migrations](https://supabase.com/docs/guides/deployment/database-migrations) documents local migration files under `supabase/migrations` and remote history in `supabase_migrations.schema_migrations`.
