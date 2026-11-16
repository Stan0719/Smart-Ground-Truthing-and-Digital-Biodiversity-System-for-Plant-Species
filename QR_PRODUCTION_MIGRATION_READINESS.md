# QR table move: production readiness package

**Decision: NO-GO.** This package is a review aid. No production connection,
SQL execution, migration, repair, grant, revoke, or RLS change was performed.

## Artifacts

- Read-only preflight and security inventory:
  `plant-conservation-backend/scripts/qr-production-readonly-preflight.sql`
- Existing production runbook, corrected to withdraw its former production
  command for the local-only migration:
  `PRODUCTION_MIGRATION_RUNBOOK.md`
- Local migration under review:
  `plant-conservation-backend/migrations/015-local-qr-only-move.sql`

The SQL file contains only `SELECT` statements and comments. Run it only from an
approved read-only production session. It never prints raw QR token values,
passwords, or connection strings. It requires the expected relations to exist;
stop if the opening relation inventory differs, and do not run sections that
name a missing relation. The sequence-state query uses the currently observed
sequence name; first confirm that name from the preceding catalog query.

The PostgREST schema list may not be visible through PostgreSQL settings. The
project team must also inspect the Supabase Data API exposed-schema setting in
the Dashboard. Keep `plant_app` unexposed unless a separate API design and
security review explicitly requires otherwise. The application uses its
backend API and direct PostgreSQL access for QR operations.

## 1. Read-only preflight execution order

Run the SQL file top to bottom and retain its outputs in the change record,
with access limited to the approved operators. Compare results with the
reviewed local test signature. Expected local signature: eight QR columns;
18 rows; 16 assigned and two unassigned; `GENERATED ALWAYS` identity;
`bigint` identifiers; `varchar(30)` status; three expected indexes; one outgoing
plant FK and two incoming scan-history FKs; identity sequence initially in
`public`.

### Plants 1 and 4

The first report for these records returns token fingerprints and mapping
identifiers, never token values. Review whether each plant token has an exact
inventory match, whether the token belongs to another plant, whether another
inventory code is already assigned to the plant, and the plant’s approval
state/timestamps. The duplicate queries must return no duplicate plant tokens,
inventory tokens, or plant assignments. Review scan rows associated by plant
reference or inventory QR ID and check that all non-NULL `qr_id` values resolve.

Previous project-supplied observations reported unmatched tokens for plants 1
and 4 and two spare inventory codes. They have not been independently
re-queried here. Do not substitute the two spares. A possible separate repair
is to create inventory mappings from the plants’ existing tokens, but only if
the production read-only preflight proves those tokens are unique and have no
conflicting QR row. That repair requires a separately reviewed transaction,
backup, application-owner approval, and post-repair history checks. Migration
015 does not perform it. This unresolved disposition is a release blocker.

### Table move signature

The migration expects exactly these relationships:

- `plant_app.qr_code.plant_id` → `plant_app.plant_record(plant_id)`,
  `ON DELETE SET NULL`.
- `public.qr_scan_history.qr_id` → `public.qr_code(qr_id)`,
  `ON DELETE CASCADE`.
- `plant_app.visitor_scan_history.qr_id` → `public.qr_code(qr_id)`,
  `ON DELETE SET NULL`.

The SQL reports every incoming and outgoing FK, not just the expected three.
The migration aborts unless there are exactly two incoming FKs with the
reviewed definitions. Any extra/missing FK or altered action is a stop.

For the reviewed PostgreSQL 17 schema, the source table has eight columns:
`qr_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL`, nullable `plant_id
bigint`, `qr_code text NOT NULL`, `status varchar(30) NOT NULL DEFAULT
'generated'`, `generated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP`,
and nullable `assigned_at`, `activated_at`, `retired_at` timestamptz. Expected
indexes/constraints are `qr_code_pkey`, `qr_code_plant_id_key`, and
`qr_code_qr_code_key`, all valid and ready, plus the named plant FK.

The table move changes the relation’s schema, not its OID. PostgreSQL retains
the table owner, table ACL, indexes, constraints, and FK dependencies when
`ALTER TABLE ... SET SCHEMA` succeeds. The identity sequence is expected to
move with its owning table. Still capture and compare these properties
pre/post; the local-only migration’s in-transaction postchecks explicitly
recheck the FKs and sequence location, while the separate report must verify
data/indexes/owner/ACLs after the move.

The migration preflight checks the exact local column/default/index/constraint
signature, rejects unexpected incoming FKs, triggers, views/rules, inheritance
and unrecognized catalog dependencies, and requires `CREATE` on `plant_app`
plus effective table ownership. It checks the outgoing FK, incoming FKs, and
identity sequence after movement. It does not repair unmatched plant tokens,
change grants, expose schemas, configure RLS, or create migration history.

## 2. Grants, role membership, RLS, and API exposure

The SQL inventories ACL entries and effective privileges for existing roles;
it does not grant anything. The project team must identify the actual backend
runtime database role through deployment configuration without printing
credentials, then verify its effective access after the move. At minimum,
assess:

- `USAGE` on `plant_app`.
- Required `SELECT`, `INSERT`, `UPDATE`, and only justified `DELETE` on
  `plant_app.qr_code`.
- `USAGE` on the QR identity sequence for inserts.
- Actual read/write access needed on `plant_app.plant_record` and
  `plant_app.visitor_scan_history`, including that history table’s identity
  sequence.
- Membership inheritance and `BYPASSRLS`/superuser properties; do not infer
  runtime behavior from the migration operator’s role.

Migration 010 enables RLS on visitor tables, but project documentation states
those tables use the backend API rather than the Supabase Data API. Verify the
actual production RLS flags and policies. Do not add policies, grants, or
expose `plant_app` as part of this table move. Verify Supabase Dashboard
exposed schemas and the deployed backend’s direct PostgreSQL connection role
separately.

## 3. Backup and restore verification checklist

Before a production change, the backup/recovery owner must sign off on all of
these:

1. Confirm from deployment inventory which database contains the plant,
   auth, and face schemas. Do not print or copy connection strings. Back up
   each distinct database that the recovery plan requires.
2. Use the approved secret-managed service definition and `pg_dump --format=custom`
   for a **complete database backup**. Do not pass a schema filter or rely on
   an empty schema list to mean full backup.
3. Choose a unique, access-controlled destination; refuse to overwrite an
   existing backup. Confirm `pg_dump` exit status is zero and file size is
   non-zero.
4. Run `pg_restore --list`; verify required schemas (`public`, `plant_app`,
   and any auth/face schemas in that same database), QR table/sequence,
   history tables, functions, constraints, and indexes are present.
5. Record backup file path, size, SHA-256, creation time, operator, and
   retention location in the restricted change record. Do not include
   credentials or raw QR token values.
6. Restore the archive into a **separate, pre-provisioned disposable target**
   that the owner confirms is empty and not shared. Never use `--clean`, drop,
   reset, or overwrite an existing database/container/volume.
7. Verify restored database identity and compare schema/object listing, table
   counts, QR data fingerprint, identity sequence ownership/state, all three
   FKs, index definitions, grants/RLS, and the plants 1/4 mapping report.
8. Preserve the restore logs and have a second reviewer attest that restore
   verification succeeded before the change window.

## 4. Migration history decision

The project reports that no production `plant_app.schema_migration_history`
ledger was found. This must be verified read-only; the SQL inventories both
that table and the Supabase CLI ledger relation if present. A custom application
ledger and `supabase_migrations.schema_migrations` are distinct histories.
Supabase CLI documentation identifies `supabase_migrations.schema_migrations`
as its deployment history; `db push` may create that table on first use and
records successful migration timestamps. This repository currently has no
reviewed Supabase migration artifact/configuration for this change, so the
team must choose and establish the canonical production workflow first. Do
not add a custom ledger by hand or run `db push` until the complete pending
migration set has been reviewed; either action could misrepresent or apply
unrelated history.

The general repository runner is local-host restricted and is not a production
deployment mechanism. It also executes migration 014/003 logic and can create
or upgrade a ledger; do not point it at production. The QR-specific runners are
fixed to local databases. Migration 015 itself is explicitly named and worded
as **local-only**, so it is not a production artifact.

Before deployment, the database owner and release owner must select the
authoritative production migration history. Reconcile all existing history
rows against known migration identities/checksums. Do not execute 003 or 014
just to create history. Establish migration 003 completion from its actual
catalog/data conditions (all plant tokens uniquely mapped with expected
status/timestamps, no duplicate or conflicting mappings, and legacy mirror
consistency if applicable); if state is ambiguous, stop for manual review.
Migration 015 supersedes 014 only as a schema outcome; that does not prove 014
was executed.

Use the chosen canonical production migration mechanism to record the exact
production artifact. If adopting Supabase CLI, reconcile its remote/local
migration list and complete historical baseline first, then deploy only the
reviewed pending artifact; use migration repair only to reconcile an already
executed change after explicit owner review, never as a substitute for
execution. If a separate application ledger is formally adopted, bootstrap it
through a separately reviewed change. Record migration 015 as `executed` only
after its production artifact actually commits, with its exact checksum and
actual execution time. Record 014 as `superseded` only with a verified
supersession link to that exact 015 identity; its recognition timestamp is
when supersession was verified, never a fabricated execution timestamp. Record
003 as `recognized` only if its complete data postcondition is established; do
not infer that from moving the table. Future migrations must use the selected
canonical mechanism and be reviewed before execution.

## 5. Production deployment sequence (not authorized by this package)

1. Clear every blocker below and collect the named approvals.
2. Run the read-only SQL immediately before the window. Compare every result
   with the approved restore rehearsal; stop on any change or uncertainty.
3. Prepare a separate production migration artifact. It must be reviewed for
   the actual production version/schema and use the approved migration-history
   mechanism. Do not execute `015-local-qr-only-move.sql` or any local runner.
4. Freeze QR writes/scans for the agreed window and confirm the backup plus
   restore rehearsal is still valid.
5. Execute only the approved artifact with the approved production operator
   command. The exact command is intentionally **not supplied**: the project
   has not approved an artifact, production target/session, migration-history
   method, or operator identity. Do not improvise a command from the local
   runbook.
6. On any SQL error or unexpected result, stop and verify state read-only; do
   not retry, repair, clean up, or restore without new approval.
7. Keep writes gated. Verify source absent/destination present, 18 rows and
   pre/post fingerprint, same assignment counts, exact columns/defaults/
   identity/indexes/constraints, owner/ACL/RLS, all three FK definitions,
   sequence ownership/location/next-value relation, all history references,
   and the migration-history event. Confirm plants 1/4 disposition separately.
8. Run API smoke tests with the approved runtime role (generation, assignment,
   approval activation, lookup, visitor scan/history, and denied invalid or
   inactive QR cases). Resume traffic only after all checks pass.

## 6. Rollback / recovery

**Before commit:** the move should be in one transaction. On failure, stop and
verify read-only that `public.qr_code` remains, `plant_app.qr_code` is absent,
source row count/fingerprint and history FKs are unchanged, and the sequence
remains in `public`. Do not retry until the cause is reviewed.

**After commit:** there is no automatic rollback. Gate QR writes/scans, capture
all post-backup writes, and have the database owner choose among application
release rollback, a separately reviewed reverse schema move, or recovery from
the verified backup. Rehearse any reverse move on a separate restored target;
preserve FK OIDs/definitions, sequence ownership/state, indexes, owner/ACLs,
history links, and current data. Never overwrite production with the backup as
an immediate reflex. Reopen traffic only after the recovery postchecks pass.

## 7. Go/no-go checklist and human approvals

**Current decision: NO-GO.** Known blockers: the production catalog has not
been inspected in this task; plants 1 and 4 have a reported unresolved token /
inventory mismatch; the production migration-history ledger is reported
absent; the deployed runtime role’s effective privileges/RLS behavior are not
verified; and the only candidate migration is explicitly local-only. No
production backup/restore rehearsal for this release is evidenced here.

Required written approvals before any execution:

- **Database/project owner:** confirms exact production database identity and
  signs off on read-only preflight, FK/schema signature, and data disposition.
- **Plant data/product owner:** approves a documented decision for plants 1
  and 4 and any separate repair; no spare QR reassignment by assumption.
- **Security owner:** approves runtime/migration role separation, least
  privileges, RLS behavior, and PostgREST exposed-schema decision.
- **Backup/recovery owner:** signs the complete backup, integrity/listing,
  restore rehearsal, and recovery plan.
- **Release/application owner:** approves backend/client compatibility, QR
  write freeze, smoke tests, and traffic reopening gates.
- **Migration-history owner:** approves the canonical history ledger and the
  exact executed/recognized/superseded events and checksums.
- **Change approver and production operator:** approve the exact production
  artifact checksum, command, window, stop conditions, and execution authority.

Until all blockers are closed and these approvals are recorded, do not execute
any migration, repair, grant, revoke, or RLS change.
