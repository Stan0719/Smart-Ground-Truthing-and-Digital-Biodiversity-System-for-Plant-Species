# Migration 014/015 live type compatibility report

## Evidence and verdict

The user supplied SELECT-only live results for `plant_app`:

| Table | Verified column types |
| --- | --- |
| species | species_id BIGINT |
| plant_record | plant_id BIGINT, species_id BIGINT |
| plant_asset | id TEXT, species_id BIGINT, plant_id BIGINT, observation_id TEXT |
| plant_observation | id TEXT, plant_id BIGINT |
| species_request_submission | request_id INTEGER, approved_species_id INTEGER, proposed_species_id BIGINT |

These are supplied observations, not a live inspection by this task. The latest
confirmation of proposed_species_id supersedes the attachment's truncated result.

**Local migration type compatibility: PASS in isolated PGlite.**
**Live deployment/activation readiness: BLOCKED pending remaining evidence.**
The earlier false object-presence results establish neither compatible prerequisites
nor full absence: constraints, columns and functions can exist without those names.
No Supabase SQL, live writes, deployment or activation was performed.

## Exact migration corrections

Only four column definitions change, from INTEGER to BIGINT:

```sql
-- 014: species_image_collection
species_id BIGINT PRIMARY KEY REFERENCES species(species_id)
-- 014: species_image_reference
species_id BIGINT NOT NULL REFERENCES species_image_collection(species_id)
-- 014: species_image_arrangement_history
species_id BIGINT NOT NULL REFERENCES species_image_collection(species_id)
-- 015: plant_asset_photo_role
plant_id BIGINT NOT NULL
```

`species_request_proposed_image.request_id INTEGER PRIMARY KEY REFERENCES
species_request_submission(request_id)` remains INTEGER. Positions remain INTEGER;
asset/observation identifiers remain TEXT. Existing approved_species_id INTEGER and
proposed_species_id BIGINT are unchanged. Neither migration alters or references
those two request species columns in a new constraint. Revision/history types,
checks, indexes, FKs, triggers, RLS and migration numbers are preserved.

The runtime metadata checker now expects BIGINT for precisely the six verified
existing species/plant key columns and four new columns above. It still expects
INTEGER request_id/approved_species_id and BIGINT proposed_species_id. This does
not change authorization, grants, connection pools, or production activation.
Unverified dependency types have not been guessed or relaxed.

## Keys, constraints and existing request relationship

The required existing primary keys are species(species_id), plant_record(plant_id),
plant_asset(id), plant_observation(id), species_request_submission(request_id).
Existing validated FKs must connect asset species/plant/observation links, observation
plant links, plant species links, and both request species links to the intended
`plant_app` parents. Exact column types alone do not establish these relationships.

014 adds plant_asset UNIQUE(species_id,id), supporting the reference composite FK;
the collection PK supports reference/history FKs. The reference PK, deferred
UNIQUE(species_id,position), partial UNIQUE species_image_primary, removal CHECK,
history PK/UNIQUE(species_id,new_revision) and immutable trigger are unchanged.
The request photo_asset_id FK targets the existing TEXT plant_asset PK.

015 adds plant_asset UNIQUE(id,plant_id) and plant_observation UNIQUE(id,plant_id),
supporting both role composite FKs. Role PK(asset_id) and UNIQUE(asset_id,role)
support the proposal FK, with INTEGER request PK/FK and whole_plant CHECK. The
origin trigger and all five pagination indexes are unchanged. Existing unique
owner/client keys and asset bytes/association checks must still be verified.
The source PK/unique indexes satisfy these FK prerequisites offline; deployed
definitions, validated flags and index readiness remain unverified.

004 defines approved_species_id INTEGER REFERENCES species(species_id); 006 defines
proposed_species_id BIGINT REFERENCES species(species_id). The mixed-type fixture
proves PostgreSQL accepts the INTEGER-to-BIGINT FK, permits an in-range approval,
rejects an orphan (23503), and rejects approval ID 2147483648 (22003). A BIGINT
proposed ID 9007199254740993 is retained exactly, and proposed orphans are rejected.
This demonstrates compatibility, not existence of the FK in Supabase. The live FK
definition and validation must be obtained from the SELECT artifact. Do not alter
approved_species_id merely to make its spelling match the parent type.

## Backend compatibility findings and smallest follow-up

* species-gallery.cjs and species-photo-library.cjs reject species IDs above
  2147483647. Tests explicitly assert the current 400 responses for 2147483648 and
  9007199254740993. These are application limits, not a failure of corrected DDL.
* Gallery SQL uses inferred parameters for species IDs; its explicit ::integer
  cast is an image position, which should stay INTEGER. Library joins compare the
  actual key types; cursor IDs are TEXT, species binding is String(speciesId),
  timestamps retain SQL text precision, and only the page limit is converted.
* Gallery/library responses and web/src/services/speciesManagement.ts use Number
  species IDs. Lifting only the int32 guard would leave precision loss above
  Number.MAX_SAFE_INTEGER. PostgreSQL BIGINT results from node-postgres normally
  arrive as strings; native JavaScript bigint also cannot be JSON-stringified
  directly. No precision-changing driver parser was introduced.
* Provenance helpers pass species/plant/request values as bound parameters and
  preserve TEXT asset/observation IDs and exact request keys. Upload comparisons
  stringify keys. Those paths do not justify blanket INTEGER-to-BIGINT changes.
* Request review writes approved_species_id. A proposed BIGINT species beyond
  int32 can therefore fail approval even when its FK is valid. Request-ID int32
  validation remains appropriate for request_id INTEGER.
* Existing plant lookup in domain.cjs also limits plant_id to int32 and casts its
  optional filter to ::integer; JSONB numeric IDs can bypass node-postgres scalar
  string decoding. These broader existing limitations were inspected, not changed.
* Gallery revisions are BIGINT in SQL but Number in snapshots; revision-range
  handling also needs review if approaching the JavaScript safe integer limit.

Smallest safe follow-up if live IDs or sequences exceed the supported range: a
separately reviewed species/plant photo-workflow decimal-string ID contract across
validation, queries, responses, comparisons, cursors and frontend uploads. Test
with node-postgres-style strings and IDs above 2^53. Separately review the approval
column/range policy and all participating FK columns; do not silently widen live
approved_species_id in these migrations. Until then keep management activation off.
The metadata readiness response alone does not certify application ID ranges.

## Offline validation

The test-only adapter changes exactly the six verified parent/link columns in an
in-memory PGlite database. It preserves all other source types, including the mixed
request columns; it is not a live migration or a replacement baseline schema.

The focused suite applies 014 then 015, asserts the catalog types and validated
constraints/indexes, and checks composite membership, invalid references,
duplicate primary/order/membership rejection, deferred reordering, tombstones,
append-only history, immutable whole-plant provenance, request pointers and
unchanged bytes/ownership/evidence links. IDs above 2^53 use decimal strings and
explicit ::text results to avoid test-driver numeric rounding. The existing
plant_app readiness/integration fixture now uses the same verified types and
exercises actual low-ID reads/uploads/saves/removals and fail-closed activation.

The SELECT verification artifact is executed offline and checked to contain only
SELECT statements. The broader gallery, requests, approvals, privacy, plant
submission and history regressions passed: 107 tests, zero failures. After adding
explicit wrong-key-type readiness checks, the final focused rerun passed all 14
tests. `git diff --check` passed (existing line-ending warnings only). No frontend
files were changed by this task; frontend tests/build were not rerun.

## Remaining live evidence and deployment prerequisites

Run only the SELECT statements in `species-photo-schema-verification.sql` through
an already authorized SQL Editor session; nothing here instructs automatic execution.
It now includes exact FK endpoint types across schemas, duplicate-name inventory,
current species/plant ID ranges, request orphan counts, and sequence range metadata.
Retain the complete output for review, including these outstanding items:

1. Correct project, schema/search_path, all existing types/defaults/identity settings
   and prerequisite migrations. In particular verify rbac_species_visibility and
   record_change_submission species_id, plus related plant/location/QR/history keys;
   their live types were not supplied. Source INTEGER expectations remain fail-closed.
2. Actual PK/unique/FK/CHECK definitions, convalidated, deferrability and supporting
   indexes. Confirm each FK points to the intended schema, especially approved and
   proposed species; zero orphan counts are not a substitute for constraints.
3. Complete absence or partial presence of 014/015 columns, constraints, indexes,
   functions and triggers, including objects under another schema. A partial
   installation requires a reviewed recovery plan, not rerunning either script.
4. Current species/plant IDs and sequence headroom relative to int32/JavaScript
   limits. NULL sequence metadata is inconclusive. Check runtime ID decoding;
   source tests do not establish the deployed driver's configuration.
5. Actual backend role schema/table/sequence grants, RLS/FORCE RLS, owners and
   policies, plus unintended frontend-role grants. SQL Editor ownership is not API
   permission evidence. RLS/grant status remains NOT VERIFIED LIVE; no policies or
   privileges were modified. Do not grant broad bypass access to pass a checker.
6. Backup/recovery remains NOT VERIFIED: confirm a current recoverable backup,
   restore rehearsal/procedure, responsible operator and maintenance window,
   covering image BYTEA, request/version history, provenance and publication state.
   Review lock/unique-index build impact and uniqueness on existing data first.

Deploy compatible membership-aware portrait/list/binary readers and corrected
readiness checks with writes disabled first. After separate deployment approval
and the evidence above, apply 014 once in explicitly selected plant_app, verify it,
then 015 once, verify all objects and runtime permissions again. Neither script is
idempotent. Do not use the base/003 initialization runner to replay these scripts.
Resolve ID-range incompatibilities before enabling management. A later activation
needs separate authorization and workflow verification; it is not part of this task.
After removals, keep compatible readers/tombstones/history during recovery: reverting
to membership-unaware readers can republish retained bytes.
