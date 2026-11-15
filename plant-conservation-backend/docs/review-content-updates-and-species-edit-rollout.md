# Review content updates and species editing rollout

## Prerequisites

Verify the intended database and `PLANT_PG_SCHEMA` through the established operator process. No migration is added by this change.

- Migration 016 must be fully installed before species editing is enabled.
- Verify migration 009 separately for recorded plant edit snapshots.
- The migration runner does not discover these numbered migrations automatically.

No database migration or remote verification was performed for this implementation.

## Contracts

Observation list/detail responses retain the species meaning of `scientific_name` and add `plant_scientific_name` and `species_scientific_name`. The existing visibility policy applies to the species name. Plant detail retains its existing plant-name preference for `information.scientific_name` and adds the two explicit fields for authorized Officer/Admin detail reads. Public detail response fields retain their existing shape.

Officer observation reads add `submission_update` with `state`, `version`, `updated_at` and `changes`. States are `updated`, `unchanged` and `unavailable`. The version identifies an existing edit snapshot. It is separate from observation revision and species content revision.

An Updated indication requires a matching current snapshot from a direct owner edit. No-op differences, review decisions and approved-record proposals cannot establish an update. Missing history, missing snapshots and mismatched observation/evidence/name versions produce an unavailable result. Location changes disclose no historical coordinates. Current location privacy remains enforced by the existing projection.

`PATCH /api/my-species-requests/:id` now requires a positive integer `expected_revision` captured when the editing form loaded. Missing, malformed and stale preconditions return HTTP 409 with `SPECIES_REQUEST_EDIT_VERSION_CONFLICT`. Missing server revision metadata returns HTTP 503. Ownership and editable-state checks remain enforced. The migration 016 trigger continues to control meaningful revision advancement.

## Deployment order

1. Verify migration 016 and separately establish migration 009 history availability.
2. Release the updated mobile editor and backend together, or distribute the updated mobile client before enforcing the new backend contract.
3. During an overlapping rollout, older clients receive HTTP 409 after backend enforcement. Require those clients to update. Preserve their local drafts.
4. Release the web reader together with or before the additive backend fields. Older backend responses show unavailable change history in the new web UI.
5. Verify a fresh initial registration, pending plant edit, stale Officer decision, linked species edit and standalone species edit against the same development backend.

Backend enforcement is required for write protection. A staged mobile rollout alone cannot prevent older backend instances accepting unsafe species saves. Approved-record proposal contracts are separate and retain their existing behavior.

## Conflict recovery

Officers keep their comment and inspect fetched content before another decision. Reload Latest Submission remains explicit and never retries a decision.

Botanists retain their form and photo selections after a species edit conflict. Loading the latest version requires confirmation because it replaces the in-progress form. Existing saved drafts remain separate. A successful reload requires explicit inspection acknowledgement before another save. Failed reloads retain the form and conflict lock.

## Scope and remaining verification

Evidence upload behavior, observation submission/review locks and revision semantics were excluded from this work. Independent PostgreSQL connection timing and device/browser visual verification remain release checks. Local PGlite fixtures serialize transactions.

## Implementation file manifest

Backend files

- `plant-conservation-backend/domain.cjs`
- `plant-conservation-backend/plant-detail.cjs`
- `plant-conservation-backend/record-changes.cjs`
- `plant-conservation-backend/submission-updates.cjs` (new)
- `plant-conservation-backend/test/plant-detail.test.cjs`
- `plant-conservation-backend/test/record-changes.test.cjs`
- `plant-conservation-backend/test/species-gallery.test.cjs`
- `plant-conservation-backend/test/species-request-revision.test.cjs`
- `plant-conservation-backend/test/submission-updates.test.cjs` (new)
- `plant-conservation-backend/docs/review-content-updates-and-species-edit-rollout.md` (new)

Web files

- `web/src/components/conservation/SubmissionChanges.vue` (new)
- `web/src/views/conservation/ReviewSubmissionsView.vue`
- `web/src/views/conservation/ObservationsView.vue`
- `web/src/services/plantDetail.ts`
- `web/src/locales/en.json`
- `web/src/locales/ms.json`
- `web/src/locales/zh-CN.json`
- `web/tests/reviewIntegration.test.mjs`
- `web/tests/submissionChanges.test.mjs` (new)

Mobile files

- `mobileapp/utils/plantApi.js`
- `mobileapp/screens/EditSpeciesRequest.js`
- `mobileapp/screens/EditPlantRecord.js`
- `mobileapp/screens/BotanistPlantDetail.js`
- `mobileapp/translations/en.json`
- `mobileapp/translations/ms.json`
- `mobileapp/translations/zh.json`
- `mobileapp/scripts/record-edits.test.mjs`
- `mobileapp/scripts/plant-api-mapping.test.mjs`
