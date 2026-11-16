# Final rejection and species review cycles

Migration `017-species-review-cycle.sql` is **NOT APPLIED**. No live database connection, service restart or remote migration was performed.

## Domain and compatibility

Rejected submissions are terminal through species edits, pending plant edits, observation edits and observation submission. These paths return HTTP 409 with `SUBMISSION_REJECTED`. Existing ownership, permissions and revision comparisons remain enforced. An initial registration's observation status is checked even when the plant remains Pending Review after direct observation rejection. Subsequent observation rejection leaves an already-approved plant available for new separate observations.

Correction Required remains recoverable. Approved records retain their separate change-proposal workflow. Existing rejected records and saved drafts are retained. Historical rejections are not rewritten or cascaded retroactively.

Species reads add `review_cycle`. Officer reviews require both `expected_revision` and `expected_review_cycle`, captured from the inspected request. Content changes retain migration 016 semantics. The new trigger advances `review_cycle` when Correction Required becomes Pending Review, including unchanged saves. Older Officer clients receive HTTP 409 for a missing cycle. Older Botanist clients remain subject to terminal-state checks. Botanist edits continue using their captured content revision. The server advances the cycle without a new mobile edit field.

The web treats `SPECIES_REQUEST_REVIEW_CYCLE_CONFLICT` as an inspection conflict. It clears visibility and requires explicit reload and acknowledgement. It never retries a decision automatically.

## Linked rejection

The immutable registration receipt establishes request, plant and initial observation identity. Species ID alone never discovers the parent. Owner, client key, IDs, current association, receipt uniqueness and parent statuses are revalidated.

The species request is already locked. The cascade acquires the initial observation and plant with `FOR UPDATE NOWAIT`. It never waits for those parents, because existing review and edit routes can acquire parent locks first. Lock contention returns HTTP 409 `SPECIES_REQUEST_REVIEW_BUSY` and rolls back. Existing Priority 1 lock order is untouched. Independent PostgreSQL lock timing still requires testing.

The cascade accepts Pending Review or Flagged observations with a Pending Review plant. A consistently Rejected observation/plant pair receives no duplicate parent decision or notification. Mixed terminal states, Approved parents, unexpected states, missing receipts and inconsistent links return `SPECIES_REQUEST_LINK_CONFLICT` for manual reconciliation.

One transaction stores the request rejection, parent rejection, observation revision increment, automatic dependency review event, applicable version-history update, notification and business audits. `review_origin='species_dependency'`, `species_request_id` and `species_review_cycle` identify the automatic event. Its ID equals the initiating request's `review_decision_id`. The initiating Officer remains attributable while the history labels the event as automatic.

The existing observation-rejected notification carries the species cause and finality in its comment and metadata. Migration 011 notification storage is required for a linked cascade. Missing storage fails with HTTP 503 and no committed cascade. Standalone requests affect no plant.

QR assignments, tokens, receipts, identity and evidence bytes remain intact.

## Required Priority 1 integration

`uploads.cjs` and its concurrency tests remain teammate-owned and unmodified. Its evidence upload eligibility still includes Rejected. Therefore this implementation does **not** establish complete rejected-evidence write protection.

Priority 1 must reject new evidence writes to terminal observations while retaining legitimate upload retry behavior. Its owner-read rules also need review because rejected owner observations are excluded from some existing asset read paths. Officer evidence access and stored bytes are retained. Coordinate authorized owner reads with that workstream.

## Migration procedure for the operator

1. Confirm the intended database and schema, a recoverable backup and the restoration procedure.
2. Verify migrations 004, 006 and 016 in `plant_app`. Verify migration 011 separately for notifications and migration 009 separately for optional edit snapshots. Verify request and observation review key types against the installed schema.
3. Inspect whether 017 objects are absent, complete or partial before execution. The existing runner does not automatically discover later numbered migrations. `npm run migrate` does not install 017.
4. After separate deployment approval, run the file with an explicitly selected `plant_app,pg_catalog` search path and `ON_ERROR_STOP`. The file contains its own transaction.
5. Verify `review_cycle INTEGER NOT NULL DEFAULT 1`, the validated positive constraint, the enabled BEFORE UPDATE ROW trigger and its function definition. Verify `review_decision_id` and all three new observation-review attribution columns.
6. Existing rows receive cycle 1 as a deployment baseline. This does not reconstruct earlier cycle counts. Check for null/nonpositive cycles and malformed or disabled objects.
7. `ADD COLUMN IF NOT EXISTS` cannot repair an existing incorrect column definition. Partial installations require a reviewed repair plan. Runtime checks reject missing/disabled cycle infrastructure. Missing attribution columns cause transactional failure and rollback.
8. Deploy all backend instances together with compatible Officer clients. Drain older backend instances so their previous status rules cannot accept writes. Preserve drafts and direct older clients to update when a new precondition is unavailable.
9. Verify unchanged and changed correction resubmission, stale-cycle rejection, final rejection, exact parent cascade, rollback, duplicate decisions and QR preservation in isolated development.

Example operator command for later approval, from the repository root. Replace the service placeholder with the verified target profile. This command has not been run against any configured database.

```powershell
psql -X --dbname='service=OPERATOR_VERIFIED_TARGET' --set=ON_ERROR_STOP=1 --command='SET search_path TO "plant_app", pg_catalog' --file='.\plant-conservation-backend\migrations\017-species-review-cycle.sql'
```

Post-installation SELECT checks should inspect both tables' column types, nullability and defaults, `species_request_review_cycle_positive`, `observation_review_dependency_origin`, the enabled trigger and `pg_get_functiondef` for its bound function. Confirm that `plant_record` accepts Rejected and that the migration 011 table has the notification columns and unique recipient/source constraint. Compare definitions with the reviewed migration. Confirm that existing cycles are positive. Schema existence alone is insufficient.

## Remaining verification

Local PGlite fixtures serialize transactions. Independent PostgreSQL connection contention, NOWAIT behavior under real concurrent transactions and device/browser visual testing remain deployment checks. Complete Priority 1 terminal-evidence integration before claiming full submission immutability.

## File manifest

- `plant-conservation-backend/domain.cjs`
- `plant-conservation-backend/record-changes.cjs`
- `plant-conservation-backend/species-requests.cjs`
- `plant-conservation-backend/server.js`
- `plant-conservation-backend/observation-review-history.cjs`
- `plant-conservation-backend/final-rejection.cjs`
- `plant-conservation-backend/linked-species-rejection.cjs`
- `plant-conservation-backend/species-review-cycle.cjs`
- `plant-conservation-backend/migrations/017-species-review-cycle.sql`
- `shared/rbac.cjs`
- `web/src/views/conservation/ReviewSubmissionsView.vue`
- `web/src/views/conservation/ObservationsView.vue`
- `web/src/services/reviewSpeciesRequest.ts`
- `web/src/services/observationReview.ts`
- `web/src/services/observationReviewHistory.ts`
- `web/src/components/conservation/ObservationReviewHistory.vue`
- `web/src/locales/en.json`
- `web/src/locales/ms.json`
- `web/src/locales/zh-CN.json`
- `web/tests/reviewIntegration.test.mjs`
- `mobileapp/screens/BotanistSpeciesRequestDetail.js`
- `mobileapp/screens/EditSpeciesRequest.js`
- `mobileapp/screens/BotanistPlantDetail.js`
- `mobileapp/screens/EditPlantRecord.js`
- `mobileapp/screens/FieldCollection.js`
- `mobileapp/screens/NotificationObservation.js`
- `mobileapp/screens/BotanistNotifications.js`
- `mobileapp/screens/BotanistMyDrafts.js`
- `mobileapp/utils/fieldSync.js`
- `mobileapp/translations/en.json`
- `mobileapp/translations/ms.json`
- `mobileapp/translations/zh.json`
- `mobileapp/scripts/record-edits.test.mjs`
- `mobileapp/scripts/field-sync.test.mjs`
- `plant-conservation-backend/test/final-rejection.test.cjs`
- `plant-conservation-backend/test/record-changes.test.cjs`
- `plant-conservation-backend/test/species-request-revision.test.cjs`
- `plant-conservation-backend/test/species-request-integration.test.cjs`
- `plant-conservation-backend/test/species-requests.test.cjs`
- `plant-conservation-backend/test/species-gallery.test.cjs`
- `plant-conservation-backend/test/species-photo-library.test.cjs`
- `plant-conservation-backend/test/plant-submissions.test.cjs`
- `plant-conservation-backend/test/observation-origin.test.cjs`
- `plant-conservation-backend/test/pending-species-correction.test.cjs`
- `plant-conservation-backend/docs/final-rejection-rollout.md`
