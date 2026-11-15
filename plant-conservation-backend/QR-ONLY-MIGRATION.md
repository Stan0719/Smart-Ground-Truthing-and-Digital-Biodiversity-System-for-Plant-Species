# QR inventory schema migration

## Current schema

After migration 015, the QR inventory is `plant_app.qr_code` and its plant
relationship is `plant_app.plant_record`. The backend reads
`PLANT_QR_PLANT_SCHEMA=plant_app` (the default); the `public` parent mode is
unsupported. QR listing, lookup, scan history, assignment, and reassignment
must use this application schema layout.

The QR inventory migration was validated against an isolated local restored
database. That validation does not authorize a production migration. Do not run
`migrate:qr-only`, migration 014, migration 015, or a generic migration command
as a substitute for the project's separately approved deployment procedure.
Migration 015 is a historical one-time move from `public.qr_code`; it requires
the reviewed `plant_app.plant_record` and the incoming QR-history foreign keys.
It does not create or reconcile application plant records.

## Historical layouts and migrations

- Migration 014 is an earlier general migration. Its expected QR identity,
  `plant_id`, and `status` definitions predate the reviewed migration 015
  inventory. It is retained for history and must not be replayed against the
  post-015 QR table.
- Before migration 015, `public.qr_code` was the legacy inventory. In the
  reviewed migration 015 input, its QR-to-plant foreign key already referenced
  `plant_app.plant_record`; migration 015 moved the table and its dependent
  sequence, indexes, constraints, ACL, and incoming foreign keys into
  `plant_app`.
- Older local notes describing `public.plant_record` as the QR parent or
  recommending `PLANT_QR_PLANT_SCHEMA=public` describe a different legacy
  arrangement. They are not valid configuration instructions after migration
  015.

## Migration history and repeat runs

The general backend runner maintains `plant_app.schema_migration_history` for
the migrations it manages. Each entry contains the exact SQL file checksum and
one of three resolutions: `executed` has an execution timestamp, `recognized`
has a structural/data recognition timestamp, and `superseded` names the
migration that replaces it. Recognition time is not an execution time. The
runner validates names, checksums, resolution fields, and supersession links
before it skips any entry. Legacy rows without checksums are preserved but
stop the runner for operator verification.

If the runner finds the complete reviewed post-015 catalog shape without
history entries, it records 015 as `recognized` and 014 as `superseded` by 015;
it does not claim either file was executed by the general runner. Migration 003
is adopted as `recognized` only when every plant record has the matching QR
row, status, and timestamps produced by 003, and duplicate-token/public-plant
checks pass. A populated state with no mappings is treated as unapplied and
runs 003; an empty or partial state cannot establish history and stops for
operator review.

The runner's migration order is an explicit manifest, not a directory glob.
Future migrations must be added to that manifest with a known immutable file
identity and checksum, an explicit transactional execution or recognition
rule, ledger validation, and isolated regression tests. Do not infer migration
completion from a migration number or filename alone. Review the database
backup and migration history before using any migration runner in a deployment
environment.

## QR assignment and data integrity

The QR table's `plant_id` foreign key targets `plant_app.plant_record(plant_id)`
with `ON DELETE SET NULL`. Keep the QR and plant schemas aligned. Before
changing QR assignment or migrating plant records, reconcile IDs and QR tokens
and review visitor scan history and other foreign-key dependencies. Do not
restore QR assignment by setting an environment variable to `public`.

## Supabase API exposure

The backend accesses PostgreSQL directly. The mobile client uses backend API
routes; it does not require `plant_app` to be exposed through the Supabase Data
API. Keep the schema unexposed unless direct client access is deliberately
designed with suitable grants and row-level security policies.
