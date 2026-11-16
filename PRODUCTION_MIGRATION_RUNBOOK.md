# QR Migration 015 Production Runbook (Review Draft — NO-GO)

**Status: NOT APPROVED FOR EXECUTION.** This document proposes an operator
procedure only. The repository local runners must not be used against
production. No production action was taken while preparing this runbook.

**Critical correction:** `015-local-qr-only-move.sql` is explicitly a local
verification migration and must not be executed against production. The former
draft execution command below has been withdrawn. Production requires a
separately reviewed production migration artifact and an approved deployment
mechanism. The local migration and its runners are evidence for design/testing,
not production deployment inputs.

## 0. Approval and roles

Required participants: database owner, application release owner, security
reviewer, and operator with approved production database access. Confirm the
target project/database from approved deployment inventory. Do not paste,
print, or put connection strings/passwords in shell history, logs, tickets, or
this runbook.

The currently configured application database role is reported as `postgres`
through a project-scoped Supabase pooler username. Treat that as elevated. Use
a separate reviewed migration owner role for migration execution and a
separate least-privilege runtime role for the application cutover. Role
creation/grants and RLS policy work require their own reviewed change; they are
not included in migration 015.

## 1. Preconditions and stop gates

Do not proceed unless all are true:

1. The production state has been inspected read-only. Record source/destination
   table locations, owners, row counts, definitions, incoming/outgoing FKs,
   indexes, identity sequence, grants, RLS flags/policies, views/rules/triggers,
   and dependencies.
2. Production source matches migration 015’s complete preflight. In
   particular: `public.qr_code` exists; `plant_app.qr_code` does not;
   `plant_app.plant_record`, `public.qr_scan_history`, and
   `plant_app.visitor_scan_history` exist; the expected reviewed constraints,
   types, defaults, nullability, indexes, FKs, sequence, and ownership match.
3. No unexpected view, rule, trigger, partition/inheritance relation, or
   catalog dependency points to `public.qr_code`.
4. The two plant tokens without QR inventory rows (IDs 1 and 4) have an
   explicitly approved disposition. Do not use either unassigned QR token to
   repair them by assumption. Migration 015 does not repair those rows.
5. The exact migration 015 bytes and checksum have been reviewed against the
   release artifact. Do not run 003 or 014 as part of this change.
6. The destination schema remains unexposed through PostgREST unless direct
   access has been intentionally designed, granted, and secured.
7. Backup, restore verification, application release order, runtime role,
   schema `USAGE`, table/sequence privileges, and RLS behavior are approved.
8. The project has an explicit decision on migration history. The current
   production ledger is reported absent, and the repository has no
   production-safe history registration procedure. Do not run the general
   local-only runner to create/repair it; do not create a false execution
   timestamp. Resolve this before claiming migration history is complete.
9. The DBA has established whether plant, auth, and face settings resolve to
   one database or multiple databases using deployment metadata, without
   displaying URLs. The migration target is the plant database; each distinct
   database that must be recoverable needs its own verified archive and restore
   rehearsal.

**Stop** on any mismatch, ambiguous history/data, unexpected dependency,
privilege/RLS uncertainty, or backup failure. Preserve the output and request
database-owner review.

## 2. Backup and restore rehearsal

Use the DBA-approved PostgreSQL client/service configuration. The service name
below is a placeholder, not a connection string. Pick a unique backup path and
refuse to overwrite an existing file.

PowerShell proposal:

```powershell
$backupDirectory = 'D:\approved-backups'
$backupName = 'qr-before-015-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.dump'
$backupPath = Join-Path $backupDirectory $backupName
if (Test-Path -LiteralPath $backupPath) { throw 'Backup already exists; choose a new path.' }
pg_dump --format=custom --file $backupPath --dbname 'service=<approved-production-backup-service>'
if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed; stop deployment.' }
if ((Get-Item -LiteralPath $backupPath).Length -le 0) { throw 'Backup is empty; stop deployment.' }
pg_restore --list $backupPath
if ($LASTEXITCODE -ne 0) { throw 'Backup archive listing failed; stop deployment.' }
Get-FileHash -LiteralPath $backupPath -Algorithm SHA256
```

Record the path, byte size, hash, completion time, operator, and retention
location in the change record. For the QR target database, confirm the archive
includes every schema that actually resides in that database (expected here:
`public`, `plant_app`, `plant_auth`, `plant_face`) and relevant sequences,
tables, constraints, indexes, functions, and policies. If auth or face services
use separate databases, take and verify separate complete archives for those
databases as required by the recovery plan. Restore each archive into a
separate, pre-provisioned disposable database that is confirmed empty and not
used by another test. Do not use `--clean`, drop, reset, or overwrite any
existing database/container/volume. Verify the restore and reconcile the
expected 18 QR rows, 18 visitor scan rows, and reported FK/data relationships
before production approval.

## 3. Pre-migration data report

Run from the authorized read-only inspection session. Retain counts and
fingerprints in the change record; avoid exporting QR token values.

```sql
SELECT to_regclass('public.qr_code') AS source_qr,
       to_regclass('plant_app.qr_code') AS destination_qr,
       to_regclass('plant_app.plant_record') AS app_plants,
       to_regclass('public.plant_record') AS public_plants,
       to_regclass('public.qr_scan_history') AS public_scan_history,
       to_regclass('plant_app.visitor_scan_history') AS visitor_scan_history;

SELECT count(*) AS qr_rows,
       count(*) FILTER (WHERE plant_id IS NOT NULL) AS assigned,
       count(*) FILTER (WHERE plant_id IS NULL) AS unassigned,
       md5(coalesce(string_agg(to_jsonb(q)::text, E'\n' ORDER BY qr_id), '')) AS row_fingerprint
FROM public.qr_code q;

SELECT count(*) AS plant_rows,
       count(*) FILTER (WHERE NOT EXISTS (
         SELECT 1 FROM public.qr_code q
         WHERE q.plant_id = p.plant_id AND q.qr_code = p.qr_token
       )) AS plants_without_matching_inventory
FROM plant_app.plant_record p;

SELECT p.plant_id
FROM plant_app.plant_record p
LEFT JOIN public.qr_code q
  ON q.plant_id = p.plant_id AND q.qr_code = p.qr_token
WHERE q.qr_id IS NULL
ORDER BY p.plant_id;

SELECT count(*) AS visitor_history_rows,
       count(*) FILTER (WHERE h.qr_id IS NOT NULL AND q.qr_id IS NULL) AS orphaned_qr_references
FROM plant_app.visitor_scan_history h
LEFT JOIN public.qr_code q ON q.qr_id = h.qr_id;

SELECT count(*) AS public_scan_history_rows,
       count(*) FILTER (WHERE h.qr_id IS NOT NULL AND q.qr_id IS NULL) AS orphaned_qr_references
FROM public.qr_scan_history h
LEFT JOIN public.qr_code q ON q.qr_id = h.qr_id;
```

Expected based on the supplied production inspection: source exists,
destination absent; 18 QR rows, 16 assigned, 2 unassigned; 18 plants and two
unmatched plant IDs (1 and 4); 18 visitor history rows with no orphaned QR
references; zero public QR scan history rows. Any deviation is a stop.

Also compare `plant_app.plant_record` and `public.plant_record` by plant ID
and species ID as required by the 003/007 historical checks. Do not run those
migrations to obtain a comparison.

## 4. Permission and Supabase checks

From the authorized session, verify `current_database()`, `current_user`, and
`session_user`; compare the result with the approved migration-role inventory.
Check effective `CREATE` on `plant_app`, ownership/control of
`public.qr_code`, and the role’s effective privileges without granting them.
For the post-move runtime identity, verify `USAGE` on `plant_app`, QR table
operations, QR identity sequence `USAGE`, plant record operations, and visitor
history `SELECT`/`INSERT` plus its identity sequence `USAGE`.

Inspect `relrowsecurity`, `relforcerowsecurity`, `pg_policies`, table/sequence
ACLs, and the Supabase Data API exposed-schema setting. Migration 010 enables
RLS on visitor scan history and supplies grants for `postgres`, but no row
policies. Do not assume a custom runtime role will work because `postgres`
currently bypasses RLS. Do not expose `plant_app` or grant browser roles as a
fix for backend permission errors.

## 5. Application compatibility gate

Before scheduling the cutover, verify the deployed Plant API version uses
`plant_app.qr_code` and `plant_app.plant_record`; the current repository code
does. Confirm the currently deployed version does not expect
`public.qr_code`. The mobile QR flow uses backend routes; verify no deployed
mobile/web client calls the Supabase Data API directly for QR rows.

The two unmatched plant records must have a product-approved handling plan.
Migration 003 would add two rows from those plants’ existing tokens and preserve
the two spare inventory tokens, but 003 is not included in this migration and
must not be run automatically. Decide separately whether the backend can
operate with these missing inventory rows or whether a reviewed data
remediation is required.

## 6. Proposed execution sequence

1. Confirm all preconditions and approvals; put QR writing/scanning into the
   agreed maintenance state.
2. Re-run the read-only preflight immediately before execution and compare it
   to the approved report. Stop if any counts, table locations, ownership,
   FK, grants, or dependency state changed.
3. **Do not execute `015-local-qr-only-move.sql` in production.** No production
   apply command is approved or supplied by this runbook. First resolve every
   blocker in `QR_PRODUCTION_MIGRATION_READINESS.md`, prepare a production
   artifact with the approved migration-history mechanism, verify its checksum
   and rehearse it against a separate restored copy. The project team must
   approve the exact command and artifact in a later change window. Do not use
   `npm run migrate`, `migrate:qr-only`, `migrate:qr-restore-test`, migration
   014, or migration 003 as an improvised production path.
4. If execution fails, stop. The migration transaction should roll back; use
   the read-only table-location and row-count queries to verify. Do not retry
   or perform cleanup until the cause is understood.
5. If it succeeds, keep QR writes gated until all postchecks pass.

## 7. Post-migration verification

Repeat the data report with `plant_app.qr_code` substituted for
`public.qr_code`. Confirm:

- `public.qr_code` absent and `plant_app.qr_code` present.
- Exactly 18 QR records remain, with the same 16 assigned and 2 unassigned.
- The row fingerprint matches the pre-migration fingerprint.
- The two unassigned token values/QR IDs are unchanged; no QR record was
  reassigned or regenerated.
- The table has the reviewed eight columns/types/defaults/nullability and
  `GENERATED ALWAYS` identity.
- Primary/unique index names/definitions, constraints, and index validity match
  the reviewed signature.
- The QR-to-plant FK targets `plant_app.plant_record` with `ON DELETE SET
  NULL`; both incoming scan-history FKs target the moved QR table and retain
  their original delete actions; all constraints are validated.
- The QR identity sequence is owned by `plant_app.qr_code.qr_id`, is located
  in `plant_app`, and its next value is above the existing maximum. Verify by
  reading its `last_value`, `is_called`, and `increment_by`; do not call
  `nextval()` as a check because that changes sequence state.
- Owner, table ACL, sequence ACL, destination schema `USAGE`, RLS flags and
  policies are correct for the approved roles.
- Visitor scan history remains 18 rows and all prior QR references resolve;
  public scan history remains unchanged.
- API smoke tests cover list, generate, lookup, assignment, scan-history
  insert/read, and plant-record joins under the approved runtime role.
- The 003 mismatch decision remains recorded; do not silently repair it.

Read-only sequence-state check:

```sql
SELECT s.last_value,
       s.is_called,
       p.increment_by,
       (SELECT max(qr_id) FROM plant_app.qr_code) AS max_qr_id,
       CASE WHEN s.is_called THEN s.last_value + p.increment_by ELSE s.last_value END AS next_value,
       (CASE WHEN s.is_called THEN s.last_value + p.increment_by ELSE s.last_value END)
         > coalesce((SELECT max(qr_id) FROM plant_app.qr_code), 0) AS next_value_above_max
FROM plant_app.qr_code_qr_id_seq s
JOIN pg_sequences p
  ON p.schemaname = 'plant_app'
 AND p.sequencename = 'qr_code_qr_id_seq';
```

Do not claim 003 completion from the 015 table move. Do not mark 014 executed.
The current production ledger is reported absent and the current runner is
local-only; migration-history registration requires a separate reviewed
production process. Any recognition timestamp must describe when structural
completion was verified, not the original execution time.

## 8. Rollback and recovery

### Failure before COMMIT

The 015 transaction should roll back atomically. Confirm `public.qr_code`
exists, `plant_app.qr_code` is absent, counts and FKs are unchanged, and the
identity sequence remains in `public`. Stop and investigate before another
attempt.

### Application failure after COMMIT

1. Gate QR writes/scans and preserve logs/observed writes.
2. Decide whether to roll back the application release, perform a reviewed
   reverse schema move, or recover from the backup. Do not choose automatically.
3. Before reverse movement, rehearse the exact procedure on a restored,
   disposable copy. Confirm `public.qr_code` is absent and ownership/CREATE
   rights are appropriate. Reverse movement must retain sequence ownership,
   incoming FKs, table data, ACLs, and expected schema visibility.
4. If the reverse move is approved, run it as a separate transaction in a
   separately reviewed rollback script while writes are paused. Verify the
   complete pre-migration signature and data fingerprint before reopening
   traffic.
5. Restore the backup only through an approved recovery plan after accounting
   for every write since backup time. Restore to a separate recovery target
   first; never overwrite production as a reflexive rollback.

## 9. Final release sign-off

The database owner, security reviewer, and application owner must sign off on
the production preflight, approved role/grants/RLS model, unmatched plant
tokens decision, backup/restore proof, migration output, postchecks, history
record, and rollback rehearsal. This runbook does not authorize execution.
