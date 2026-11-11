# Observation origin (Phase 2)

The authorized `GET /api/observations` and `GET /api/observations/:id`
responses add `origin_type`. This describes creation context, never review
eligibility or queue membership. No existing fields or filters are removed.

| Value | Evidence |
| --- | --- |
| `initial_registration` | The exact initial observation identified by one validated atomic registration receipt, consistent with its stored origin. |
| `subsequent_observation` | The server persisted this value when the standalone field-observation route created the row, with no contradictory receipt evidence. |
| `unknown` | No sufficient evidence, malformed metadata, ambiguous receipts, or a column/receipt conflict. |

## Persistence and trust boundary

`plant_observation.origin_type` is non-null text, defaults to `unknown`, and
has a three-value CHECK constraint. Atomic `POST /api/plant-submissions`
assigns `initial_registration` in the existing transaction. Standalone
`POST /api/plants/:id/observations` assigns `subsequent_observation` when
creating a Draft. The legacy `POST /api/plants` route leaves the default
`unknown`; it is not the supported atomic registration route.

No correction, submit, review, QR-change or record-change handler updates
this column. Nested origin attributes are rejected by content allowlists.
Atomic registration and record-change allowlists reject extra top-level
origin attributes. Standalone create, observation PATCH, submit and review
ignore extra top-level origin attributes, as their existing contracts do;
they never assign them to the column. Only server route context sets origin.
Privileged direct SQL writers remain outside this HTTP trust boundary.

Receipts retain their original result/hash and the atomic POST replay response
is unchanged. Origin is additive on observation reads, not inserted into old
receipt results. A retry never relabels an existing observation.

## Historical receipt validation

Receipts currently have no explicit format/version field. The resolver accepts
the existing unversioned atomic response shape: an observation ID, positive
plant/species IDs, explicit null or positive species-request ID, original
`Pending Review` response status, nonblank QR token and 64-character SHA-256
hex hash. A versioned result is unknown until its version has a supported
validator. The original response status is a format check, not an inference
from the observation's current status.

Exactly one candidate receipt must match the plant or explicitly reference
the selected observation. Its initial observation must exist and match the
receipt's plant, owner and client key; the plant's registering owner must
match and the original species must exist. People/keys validate an explicit
ID binding; they never discover one. For a genuine species request, the
exact request must match the owner/key and original proposed/resulting
species. Request review status does not classify origin. A no-request
receipt permits the Phase 1 current-species correction without changing
immutable evidence. Current QR is not compared with the original QR token.

Only the receipt's exact observation can recover initial origin. Other
observations of the same plant do not inherit it. No receipt is not proof
of subsequent origin. Unknown historical rows remain unknown unless a
verified receipt proves initial origin. No backfill runs on reads.

A stored subsequent value claiming a receipt's initial observation is
unknown. A stored initial value without valid exact receipt evidence is
unknown. Invalid or duplicate candidate receipts are unknown. These outcomes
do not change the existing species guards, status transitions or accessibility.

Resolution batches lookups for the already authorized observation rows.
Receipt hashes, results, QR tokens and internal lookup maps are not added
to responses. Existing GPS redaction and media authorization remain intact.

## Deployment and old-schema compatibility

Migration: `migrations/012-observation-origin.sql`.

1. Back up and review the target configured `PLANT_PG_SCHEMA` and search path.
2. Have the database operator explicitly apply migration 012 using the
   project's reviewed deployment procedure. The current `scripts/migrate.cjs`
   does not automatically discover numbered migrations; running it alone is
   not sufficient for existing tables.
3. Deploy the backend and verify synthetic/isolated list/detail fixtures.

The migration is additive and repeatable; historical rows receive the
`unknown` default. It does not rewrite receipts, review revisions or IDs,
and performs no inferred bulk backfill. New-install schema DDL includes
the same column/constraint.

The backend does not issue runtime DDL. Before migration it detects the
missing column on creation and uses compatible inserts: atomic registrations
are still recoverable through receipts, while standalone observations remain
unknown because that database cannot persist their trusted origin. Applying
012 later does not guess which old rows came through the standalone route.
Deploy migration first to guarantee provenance for new field observations.
Database/query failures propagate normally; there is no broad error swallowing.

The migration has been exercised only in disposable PGlite tests, not run
against an application database. No production backfill utility is provided.

## Additive examples (synthetic)

List envelope:

```json
{"observations":[{"id":"11111111-1111-4111-8111-111111111111","plant_id":42,"origin_type":"initial_registration","status":"Pending Review","revision":1}]}
```

Detail envelope:

```json
{"observation":{"id":"22222222-2222-4222-8222-222222222222","plant_id":42,"origin_type":"subsequent_observation","status":"Draft","revision":1}}
```

These examples omit unchanged fields for brevity. Existing mobile/web clients
ignore the additional field. Both Officer pages still receive the same eligible
record types and use their existing review controls. Exclusive queues are Phase 3.
