# QR migration 016 rehearsal and application test results

## Latest independent rehearsal — 2026-11-15

The earlier November 14 results below describe the first rehearsal. A second
local rehearsal was completed against an isolated Docker container running
`public.ecr.aws/supabase/postgres:17.11.0.018` (`qr-016-final-rehearsal-20261115`).
The container used `--network none`, published no host ports, and remains
preserved. No production connection or SQL execution occurred.

The restored archive used for this second rehearsal was
`C:\Users\keeji\Documents\SupabaseBackups\plant-conservation-system-app-only-qr-rehearsal-2026-11-14\application.dump`,
SHA-256 `4C7C8517C588BA24215C4F5263EE5EDD92A287D29E9407E20D3E9AE04340BACB`.
It is an application-schema snapshot derived from the November 14 material,
not a fresh production backup. The separate candidate named
`before-qr-restore-test-2026-11-14T02-04-05-903Z-f8833ad74f03.dump` with
expected SHA-256 `785A56314E8DB753834EAD9DB44D0D559436B86EDBAC01A000AAF88E60076E8B`
was not found in the inspected backup locations. Do not treat the archive
used here as that candidate or as current production recovery evidence.

Forward migration ran only in `plant_qr_migration_rehearsal`; rollback ran in
a separate cloned database, `plant_qr_rollback_rehearsal`. The forward file
SHA-256 was
`EA17C54D0355D5893335CFC54522CDBFAF7455A54E6EE7400E692AC616654BBD`; rollback
SHA-256 was
`7DA7265F275E12C8BDACAE1E9B9192BBBF8C66F2092553D97F74AA3BDE596E94`.
Both completed their transaction and internal checks without SQL changes.

Verified in the restored archive before and after each operation:

- 18 QR rows, 18 visitor history rows, and 0 public QR scan history rows.
- QR relation OID `19558` and identity sequence OID `19565` were preserved.
- The data fingerprints were unchanged: QR `8c8a9b0b7ff606d84a25a225445a8c360d77806fd92bab05f03a4618b6f11a47`; visitor history `727d57294613270330fd94e1585fb0ad8132d6069a8f92e8fb60b6338bb804fe`. Fingerprints include sensitive QR fields only as digest input; token values were not printed.
- Sequence state remained `last_value=24, is_called=true`; identity ownership/default remained correct and the sequence moved with the table.
- The primary key and two unique indexes remained; all three validated FK edges remained correct, including both incoming history FKs and the outgoing plant FK.
- Table/sequence owner and ACL, RLS and FORCE RLS flags remained unchanged; RLS stayed disabled. `anon`, `authenticated` and `service_role` still lacked `plant_app` schema USAGE in this archive. No grants or RLS settings were changed.
- Rollback restored the public schema location with the same OIDs, data fingerprints, sequence state, indexes, constraints, FKs, owner, ACL and RLS flags.

### Final application test run

After a QR startup-test fixture was corrected to pass the new QR schema
argument to the server bootstrap, the targeted backend QR suite and targeted
mobile API tests passed. The complete backend test suite was also run and
still has unrelated failures: two gallery assertions expect HTTP 200 but get
404, and three species-request integration assertions expect HTTP 200 but get
503. The QR-related server startup and migration tests pass separately. These
failures are not represented as QR migration failures, but the full backend
suite is not green and should be investigated before a general release.

The tracked code change made during this task is limited to
`plant-conservation-backend/test/server-startup.test.cjs`, supplying the QR
schema argument to the existing source-evaluation fixture. No migration SQL,
secrets, or production settings were changed. See
[`qr-application-compatibility-test-report.md`](qr-application-compatibility-test-report.md)
for command/result details.

**Verdict:** migration 016 and its reverse move passed the isolated PostgreSQL 17.11 rehearsal. This is not production approval. Production deployment remains blocked on the items in [the cutover runbook](qr-production-cutover-runbook.md).

## Database rehearsal

Container `qr-migration-rehearsal-20261114`; image PostgreSQL 17.11.0.018. Migration ran only against the restored local database `qr_rehearsal`. Rollback ran only against a separate restored local database `qr_rollback_rehearsal`. No production connection or SQL execution occurred.

Migration 016 completed its transaction and all internal checks. Results:

- `public.qr_code` absent; `plant_app.qr_code` present.
- QR OID remained `18171`; row count remained 18.
- QR fingerprint remained `0cfdc422a7dffbb87108b3aadb342b39`; visitor-history fingerprint remained `9f95e8184d5b24959aaea13f7010874d`; counts were 18 visitor history and 0 public QR scan history.
- Same identity sequence OID `18178`, now `plant_app.qr_code_qr_id_seq`; identity remained `GENERATED ALWAYS`, bigint, and internally owned.
- Primary key, unique indexes, definitions, constraints, defaults and nullability remained as before.
- Outgoing plant FK and both history FKs were validated and pointed at the correct post-move objects. No FK was dropped or recreated by the schema move.
- Table owner, table ACL, identity sequence owner/ACL, RLS flags and policy count were unchanged. In the restored snapshot RLS/FORCE RLS remained false, there were no policies or user triggers, and schema USAGE for `anon`, `authenticated` and `service_role` remained absent.

The separate rollback rehearsal moved the same relation back to `public` with the original OID, 18/18/0 counts, row fingerprints, sequence OID, ACL/owner/RLS state and validated FK targets. Rollback is only a schema-location reversal: once app traffic resumes, pause/drain it again and coordinate app version before reversing. It does not undo writes made after cutover or other separately changed permissions/configuration.

## Automated tests

Backend command, from `plant-conservation-backend`:

```text
node --test --test-isolation=none test/qr-production-migration.test.cjs test/qr-generation.test.cjs test/qr-lookup.test.cjs test/qr-plant-reference.test.cjs test/qr-inventory.test.cjs test/visitor-features.test.cjs test/plant-submissions.test.cjs test/record-changes.test.cjs
```

Result: **59 passed, 0 failed**. Coverage includes migration/rollback safety and preconditions, QR generation, retrieval/lookup, inventory assignment/deletion, visitor scan history, QR-related plant submission and record changes. A simulated `XX000` log line is expected from the rollback-on-storage-failure test; the test passed.

Mobile command, from `mobileapp`:

```text
node --test scripts/qr-inventory.test.mjs scripts/qr-payload.test.mjs scripts/visitor-features.test.mjs scripts/record-edits.test.mjs scripts/plant-api-mapping.test.mjs
```

Result: **32 passed, 0 failed**. Node emitted two non-fatal module-type reparse warnings.

The new additive test `plant-conservation-backend/test/qr-generation.test.cjs` covers authorized generation, unique persisted QR rows, rejected anonymous/visitor requests, and invalid counts. No existing application source was changed: the backend already queries `plant_app.qr_code`; mobile uses the API. Existing uncommitted tests/files were preserved.

## Test limitations

The app test suite uses its local PostgreSQL-compatible fixture; only migration DDL rehearsal used the isolated PostgreSQL 17.11 container. The application tests do not validate the deployed production runtime role or Supabase Data API configuration. No actual production QR scan was sent. Data API exposure, live grants, and runtime connection identity require authorized read-only verification before cutover.
