# QR application-schema backup and restore rehearsal

## Follow-up restore evidence — 2026-11-15

A second clean restore was completed in the newly created, isolated Docker
container `qr-016-final-rehearsal-20261115` using
`public.ecr.aws/supabase/postgres:17.11.0.018`. It has no network attachment
and no published ports; it and its named data volume remain preserved. The
restore used the application-only archive
`C:\Users\keeji\Documents\SupabaseBackups\plant-conservation-system-app-only-qr-rehearsal-2026-11-14\application.dump`
(SHA-256
`4C7C8517C588BA24215C4F5263EE5EDD92A287D29E9407E20D3E9AE04340BACB`). The
archive header identifies PostgreSQL 17.11 for both dump and client. The QR
counts and dependencies were verified after restoration, and the restored
database was then used for the forward and rollback rehearsals documented in
[`qr-migration-test-results.md`](qr-migration-test-results.md).

This does **not** satisfy the production fresh-backup gate: the exact named
candidate `before-qr-restore-test-2026-11-14T02-04-05-903Z-f8833ad74f03.dump`
with expected SHA-256
`785A56314E8DB753834EAD9DB44D0D559436B86EDBAC01A000AAF88E60076E8B` was not
found in the inspected repository or SupabaseBackups folder. The substitute
archive is not the candidate and was not freshly captured from production.
No original backup file was modified.

The local image could not restore the archive as the `postgres` role because
it could not apply default-privilege entries for `supabase_admin`; the
successful restore used the image's `supabase_admin` administrator. The
restored QR table and identity sequence owners remained `postgres`, matching
the supplied production owner. This is only a rehearsal-image workaround,
not a production role recommendation. No failed attempt altered the retained
source backup; the successful restore was performed in the new isolated
container.

**Result:** successful restore of the supplied application-schema snapshot to isolated Docker PostgreSQL 17.11. The original backup folder was not modified. This validates the supplied snapshot, not a fresh production backup.

## Original backup inconsistency

Original folder: `C:\Users\keeji\Documents\SupabaseBackups\plant-conservation-system-pre-qr-migration-2026-11-14`.

The `data.sql` archive contains a COPY target for `auth.audit_log_entries` with an `ip_address` column, while `schema.sql` contains no definition of that table. That mismatch explains the failed full restore and means the original schema/data pair must not be described as a verified full restore. Managed `auth` data was not needed by the four application schemas in this rehearsal.

The requested schemas—`public`, `plant_app`, `plant_auth`, and `plant_face`—had table definitions for all their filtered data COPY targets. The filtered data contained 72 COPY targets in those schemas and 29,891 application rows. Dependency inspection found `public.plant_location.geometry` depends on PostGIS (`extensions.geometry`); no application object dependency on `auth`, `storage` or Vault was found. A standalone archive was produced from the successful local restore. It excludes managed schemas; an explicit extension bootstrap accompanies it.

## Rehearsal package

New sibling folder (original files remain in the original folder):

`C:\Users\keeji\Documents\SupabaseBackups\plant-conservation-system-app-only-qr-rehearsal-2026-11-14`

| File | SHA-256 | Purpose |
|---|---|---|
| `application.dump` | `4C7C8517C588BA24215C4F5263EE5EDD92A287D29E9407E20D3E9AE04340BACB` | Custom-format archive for the four application schemas and their data. |
| `extensions.sql` | `5CFD4301FEA6E12FDA4F4809E7C09DDE03B3F51D78E18B2E674A148C6BF75F33` | Local bootstrap for extensions required by the archived schema, including PostGIS. |
| `roles.sql` | `D91D07B816E12B6CBDF53012B514EA5A9C7084B9EAB5189B5CC9372E9522EB6A` | Role definitions used by the backup package; handle as sensitive operational material. |
| `README.md` | `D8A8052FE1732EDD4AF22374EF05BD04AFFC9AA8749B543B9C56A5EC94C4ECAF` | Restore notes and ordering. |
| `checksums.csv` | `44D9B8293B63D30799698A1B728AE0A54714F0F9C392964E471AF1E5F20507AD` | Package integrity manifest. |

Original file hashes were rechecked after packaging and remain equal to their original manifest: `schema.sql` `F61E9E7DF6A083A50629023024047B738D621E05CBB7956B82B1F2E058EE1DAF`, `data.sql` `ECAC6D1F10AEDC2640ED3A1041496CB08B3E48BA0B1EE582E6CB47E5D5393B0C`, `roles.sql` `D91D07B816E12B6CBDF53012B514EA5A9C7084B9EAB5189B5CC9372E9522EB6A`.

## Isolated restore performed

Container `qr-migration-rehearsal-20261114` uses `public.ecr.aws/supabase/postgres:17.11.0.018`, with an internal-only Docker network and a loopback-only local port (`127.0.0.1:55433`). It has no host mounts. Existing `plant-backup-restore-test` was inspected and left running and untouched. The new container/database are retained; do not delete them until their contents are no longer needed.

Restore order used: create isolated database; run `extensions.sql`; load role definitions as the local test administrator; restore `application.dump` in a single transaction. The image's `postgres` role did not have sufficient database creation rights; local restore therefore used `supabase_admin`. This is a property of the rehearsal image, not a production role recommendation. The dump TOC contained the four intended application schemas and no `auth`, `storage` or `vault` schema objects.

The successful restore produced 72 application tables: 23 in `public`, 32 in `plant_app`, 11 in `plant_auth`, and 6 in `plant_face`. QR baseline: 18 QR rows, 18 visitor scan-history rows, 0 public scan-history rows. The dump SHA-256 matched the package manifest. The original backup files were not altered.

## Verification results

Before the move in the restored `qr_rehearsal` database:

- QR row fingerprint: `0cfdc422a7dffbb87108b3aadb342b39`.
- Visitor-history fingerprint: `9f95e8184d5b24959aaea13f7010874d`.
- QR relation OID: `18171`; identity sequence OID: `18178`.
- Identity was `GENERATED ALWAYS`; sequence dependency type was identity-owned.
- Three valid indexes and the expected PK, two unique constraints and QR-to-plant FK were present.
- Both history FKs were validated. No unvalidated FKs were found.
- QR owner was `postgres`; RLS/FORCE RLS were false; there were no QR policies or user triggers.

The separate `qr_rollback_rehearsal` database also restored successfully and matched the same counts and fingerprints before migration. Each database was isolated from production.

## Safe future restore commands

These commands are for a separately approved local rehearsal only. They do not target or connect to Supabase. Confirm the package hashes first and use a new disposable database/container; never use `--clean` against a database containing anything to preserve.

```powershell
$package = 'C:\Users\keeji\Documents\SupabaseBackups\plant-conservation-system-app-only-qr-rehearsal-2026-11-14'
Get-FileHash -Algorithm SHA256 -LiteralPath "$package\application.dump", "$package\extensions.sql", "$package\roles.sql"
docker exec -i qr-migration-rehearsal-20261114 psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c 'CREATE DATABASE qr_rehearsal_fresh'
Get-Content -Raw -LiteralPath "$package\extensions.sql" | docker exec -i qr-migration-rehearsal-20261114 psql -U supabase_admin -d qr_rehearsal_fresh -v ON_ERROR_STOP=1
docker cp "$package\application.dump" qr-migration-rehearsal-20261114:/tmp/qr-application.dump
docker exec qr-migration-rehearsal-20261114 pg_restore -U supabase_admin -d qr_rehearsal_fresh --single-transaction --exit-on-error /tmp/qr-application.dump
```

Before running, verify the new database name does not exist and the container is the isolated local container. The commands above do not alter the retained rehearsal databases, but the added database and copied archive remain in the container afterward. `roles.sql` contains role definitions and should be inspected/handled by an authorized operator without printing secret-bearing role material. The retained rehearsal database already provides the successful restore evidence; these commands are not a request to run another restore.

## Current limitations

This snapshot predates the production change and does not prove the live production backup is valid or current. Before production, create a new protected backup and rehearse its restoration from scratch. Keep credential handling interactive or in an approved secret manager; never put passwords in command-line arguments, shell history, transcripts, or reports. No production database was contacted.
