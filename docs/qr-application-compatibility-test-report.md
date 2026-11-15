# QR migration 016 application compatibility report

**Scope:** local repository implementation and automated tests only. No
production backend was started, no live QR operation was sent, and no
production database was contacted.

## Implementation review

The Plant backend QR table operations use `plant_app.qr_code` in:

- `plant-conservation-backend/domain.cjs`
- `plant-conservation-backend/plant-submissions.cjs`
- `plant-conservation-backend/record-changes.cjs`
- `plant-conservation-backend/server.js` (startup metadata probe)

The startup configuration defaults the QR plant schema to `plant_app` and
rejects an alternate schema through `plant-conservation-backend/qr-plant-mode.cjs`.
The mobile application uses the Plant API route `/api/qr/:token`; it does not
query a database schema directly. Thus the checked-in backend is compatible
with the destination schema after migration 016. References to `public.qr_code`
that remain in the repository are in migration/precondition material, legacy
fixtures, and local migration tools; they are not the runtime QR table query
path identified above.

This review does not identify the currently deployed production build or prove
that it matches the repository. It also does not verify the production
connection role, live schema privileges, or Supabase Dashboard Data API
exposure. These remain production cutover checks.

## Test results

Commands were run locally from the indicated directories; they used the
repository's isolated test fixtures and did not access production.

Backend targeted QR suite (`plant-conservation-backend`):

```powershell
node --test --test-reporter=dot --test-isolation=none test/qr-production-migration.test.cjs test/qr-local-migration.test.cjs test/qr-inventory.test.cjs test/qr-lookup.test.cjs test/qr-generation.test.cjs test/qr-plant-reference.test.cjs test/plant-submissions.test.cjs test/record-changes.test.cjs test/visitor-features.test.cjs test/server-startup.test.cjs
```

**Result: passed (exit code 0).** The migration and startup QR tests also
passed independently (6/6). The suite emitted one simulated `XX000` request
failure from a negative-path test; the expected test assertions passed.

Mobile QR/API tests (`mobileapp`):

```powershell
node --test --test-reporter=dot scripts/qr-payload.test.mjs scripts/qr-inventory.test.mjs scripts/plant-api-mapping.test.mjs scripts/api-connectivity.test.mjs
```

**Result: passed (exit code 0).**

Full backend suite (`plant-conservation-backend`):

```powershell
node --test --test-reporter=dot --test-isolation=none test/*.test.cjs
```

**Result: failed in unrelated coverage.** Gallery assertions had two expected
HTTP 200 responses but received 404; species-request integration assertions
had three expected HTTP 200 responses but received 503. QR startup/migration
tests pass independently. These unrelated failures were not changed as part
of QR compatibility work; the team should decide whether they block a general
backend release and investigate them before release.

## Test fixture adjustment

`plant-conservation-backend/test/server-startup.test.cjs` now passes the
`qrPlantSchema` argument when evaluating the server startup source. The source
already supplies this setting to `createPlantApp`; the fixture omission caused
the QR-specific startup test to fail. This is the only tracked file changed
during this final rehearsal task. No runtime application implementation or
migration SQL was altered.

## Cutover implication

Keep QR traffic paused during the cutover. Deploy only a confirmed backend
build that queries `plant_app.qr_code`, coordinate its activation with the
schema move, and smoke-test QR generation/retrieval/scanning before resuming
traffic. Current repository source is compatible; deployed-build identity is
still unknown and must be confirmed by the release operator.
