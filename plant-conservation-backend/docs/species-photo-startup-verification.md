# Private species-photo startup verification

For a separately authorized future plant-backend startup, use its usual production
environment and private server logs, adding this argument to the existing entrypoint:

```text
node server.js --verify-species-photo-startup
```

Or, from the backend directory, forward the argument through the existing npm script:

```text
npm start -- --verify-species-photo-startup
```

These commands start a server. They were NOT executed during implementation. Do not
run a second instance alongside an existing backend or use this as an instruction
to restart/deploy the current instance. Add the argument only to the next deliberately
authorized startup. No .env edit or new configuration secret is required.

Without the argument the startup does not load or run this diagnostic. No endpoint
is added. The default management-write gate remains false. Startup parses
PLANT_SPECIES_PHOTO_WRITES_ENABLED once and passes the same Boolean snapshot to the
diagnostic, upload route and gallery route. The diagnostic flag never enables writes
and still rejects an enabled setting; it is strictly a writes-off preflight.

## Evidence collected

After the normal auth/plant resources are created, before the existing preflights,
HTTP listen and notification-worker start, the diagnostic receives the existing
plant pool wrapper. It creates no pool and imports no environment configuration.

The first checkout begins REPEATABLE READ READ ONLY. The wrapper applies its usual
transaction-local search_path. One SELECT reads current_user, session_user,
current_schema(), search_path, its resolved schema list and transaction_read_only.
The wrapper's read-only schema getter reports the schema captured when that wrapper
was created, rather than rereading an environment variable that may have changed.
COMMIT/ROLLBACK and release preserve the connection lifecycle.

This deployment check requires current_user=postgres, session_user=postgres,
configured/effective schema=plant_app, resolved search_path=[plant_app,pg_catalog],
a read-only transaction and management writes disabled. The expected postgres role
comes from the reviewed deployment candidate. An unexpected role needs private review;
it is not silently accepted or printed. This check is not a general role migration.

The already loaded domain and upload modules declare membership-aware reader version
1 and expose the same helper they use in their reader implementations. The diagnostic
requires both version declarations, identity with the loaded gallery membership
helper, and its collection/reference/tombstone predicates. It reports
membership-aware-v1. This is a software compatibility contract backed by the reader
regression tests, not a cryptographic artifact attestation or proof of every possible
reader behavior. It does not reread source files to guess what an old process loaded.

Every item reports VERIFIED, FAILED or UNKNOWN. Expected non-secret values are
included; unexpected role/schema/path values are redacted. Raw environment, pool
configuration, hostnames, project identifiers, credentials, tokens, driver errors,
stack traces, table data and image bytes are never included in the diagnostic.
Keep these startup logs in the private backend logging system.

If identity/schema/read-only evidence, reader compatibility or the disabled-write
gate cannot be verified, the opted-in startup throws PHOTO_STARTUP_CHECK_FAILED.
The existing startup catch closes the auth and plant resources before any listen.
This does not change a server that was already running.

## Schema readiness is separate from reader deployment

After the core checks succeed and the identity client is released, the existing
inspectPhotoSchema helper sequentially checks out a client from the SAME supplied
pool for its own metadata-only read-only transaction. There is no nested checkout,
new pool or migration. Results report both migration classifications:

* Both verified absent: photoSchema UNKNOWN; expected before initial migration.
* Incomplete/mismatched schema: photoSchema FAILED.
* Metadata unavailable: photoSchema UNKNOWN.
* Full checker success: photoSchema VERIFIED and both migrations verified-applied.

These schema results do not prevent compatible readers being deployed before the
migrations. Only readerStartup VERIFIED allows the opted-in reader startup to
continue. photoSchema FAILED/UNKNOWN still blocks management activation; the write
gate stays disabled even when photoSchema becomes VERIFIED. A successful report is
evidence from that future process, not evidence about the currently running backend.

## Remaining deployment prerequisites

Keep the completed live mixed-type/constraint/ownership/grant/RLS and ID/sequence
headroom results with the deployment record. Before migration, confirm complete
absence of partial 014/015 objects, columns, composite constraints, functions and
triggers; confirm the intended project, explicit plant_app deployment schema and
authorized DDL role. A partial installation needs a reviewed plan, not a rerun.

Confirm a current recoverable backup, restoration procedure or rehearsal, responsible
operator and recovery window. Include BYTEA images, request/version history,
provenance, tombstones and publication state. Archive-list validation alone does not
prove restoration. Keep membership-aware readers during recovery after removals.

Only under separate authorization: deploy compatible readers with writes off, apply
014 once, verify, apply 015 once, then verify types/constraints/indexes, enabled
immutable/provenance triggers, new-table RLS and runtime history-sequence access.
Retain the new startup report and authenticated Officer capability results. No
startup diagnostic or SQL Editor result authorizes activation by itself.

## Explicit activation setting and gate scope

Only the exact case-sensitive string `true` in the server-only environment setting
`PLANT_SPECIES_PHOTO_WRITES_ENABLED` requests activation. Absent, empty, `false`,
`TRUE`, `1`, surrounding whitespace and every other value mean disabled. Existing
process settings override .env according to the normal environment loader. No .env
file was edited by this preparation; do not put this setting in a VITE/public variable.

The setting is captured once at startup; changing a shell or .env while the server
runs does not change the running instance. It creates no additional pool. Both gated
routes freshly use the existing pool's metadata readiness checker after existing
Officer authorization and before their data transaction:

* POST /api/assets when the sole parent is species_id and validated image content
  is JPEG/PNG (normalized to JPEG). This covers every new direct species-reference
  image through this route, including legacy callers of that same category and
  retry POSTs; caller-provided client keys do not bypass the gate.
* PUT /api/species/:id/images for primary selection, order and reference removal.

Disabled requests receive 503 after authorization/validation without data mutations.
The flag cannot override readiness, Officer permissions, provenance, revision or
membership checks. Mixed parents and fake PDF image payloads remain invalid.

The gate does NOT disable plant_id observation-photo uploads, species PDF documents,
species text CRUD, plant submissions, species requests/reviewed corrections, or their
existing photo/provenance handling. Those workflows retain their own authorization
and approval rules. GET readers remain available. This is not a universal database
write switch. No public configuration endpoint or new role grant is introduced.

It does not cancel in-flight requests, reverse previous uploads, hide existing
published images, remove retained bytes, or undo history. Species text, each upload
and final gallery save remain separate commits. Successful uploads can become
visible according to species visibility before a later batch failure. Rollback is
not deletion and must retain compatible readers, tombstones and history.

## Future Windows PowerShell commands (NOT executed)

Use only at a separately authorized lifecycle transition, after the operator has
drained/replaced the previous instance using the existing service procedure. Do not
start an additional instance on the current running port. For a service deployment,
apply the equivalent setting through its existing supervisor; a terminal variable
does not configure an already running or independently supervised process.

Writes-off preflight, at its own authorized future startup:

```powershell
Set-Location 'C:\Users\User\OneDrive\Desktop\CTIP\Assignment\Smart-Ground-Truthing-and-Digital-Biodiversity-System-for-Plant-Species\plant-conservation-backend'
$env:PLANT_SPECIES_PHOTO_WRITES_ENABLED = 'false'
npm start -- --verify-species-photo-startup
```

Controlled activation, only after the preflight instance has been deliberately
replaced and approval/backup recovery prerequisites are satisfied:

```powershell
Set-Location 'C:\Users\User\OneDrive\Desktop\CTIP\Assignment\Smart-Ground-Truthing-and-Digital-Biodiversity-System-for-Plant-Species\plant-conservation-backend'
$env:PLANT_SPECIES_PHOTO_WRITES_ENABLED = 'true'
npm start
```

Do not combine enabled configuration with --verify-species-photo-startup: that
preflight correctly fails closed. No enabled-state diagnostic was added or needed;
before real uploads, verify the existing authenticated Officer capabilities endpoint:
both migrations verified-applied, schemaReady=true, issues=[], activationRequested=true
and writesEnabled=true. A true setting with failed readiness still blocks both routes.

Rollback, after the operator-controlled drain/replacement of the enabled instance:

```powershell
Set-Location 'C:\Users\User\OneDrive\Desktop\CTIP\Assignment\Smart-Ground-Truthing-and-Digital-Biodiversity-System-for-Plant-Species\plant-conservation-backend'
$env:PLANT_SPECIES_PHOTO_WRITES_ENABLED = 'false'
npm start -- --verify-species-photo-startup
```

Use explicit false for rollback; removing a shell override could expose a true value
from another configuration source. Confirm both capability activation fields are
false, schema readiness remains true, and new gated requests return 503. Do not drop
014/015, restore membership-unaware code, or delete uploaded bytes to disable writes.
There is no hot kill switch. An urgent stop requires the existing operator-controlled
ingress/drain procedure; requests already past admission may complete. Keep reads up
and understand the legacy-upload impact of any broader route block.

Before the first real upload, confirm deployed proxy body limits/origins/timeouts,
backup/restoration readiness and designated non-sensitive test species. Then perform
an authorized JPEG/PNG multi-upload, partial retry, primary/reorder/removal, stale
409 and public/private binary-access smoke test. Offline results are not proof of
real deployment upload behavior. All commands above are future instructions only.
