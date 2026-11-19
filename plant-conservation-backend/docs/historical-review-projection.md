# Historical Officer review projections

Original observation/request review decisions remain distinct from approved record-change proposals. Approval still updates the live plant/species through the existing handlers. No migration, new table, review status, notification mechanism, or upload behavior is introduced.

## Verified snapshots

`historical-reviews.cjs` captures the exact reviewed values inside the original approval transaction, using the existing optional `record_version_history` table (migration 009). It finalizes that transaction's existing submitted version, or inserts the first reviewed version when none exists. The JSON `review_provenance` binds kind, canonical submission ID and actual review/decision ID. It captures plant and species scientific names separately, reviewed content, taxonomy IDs and original photo IDs; species versions retain their existing private photo bytes. No QR token is added to these snapshots.

Officer observation/detail reads add `historical_review` without replacing their existing live fields. Officer species-request detail and embedded linked requests expose equivalent metadata. The Review Submissions frontend opts into historical display for Approved originals; other consumers retain their existing mappings. Live Plant Detail/Species Detail APIs are unchanged.

A read validates the provenance against the actual approval event, reviewer, target and timestamp. Lazy baselines, arbitrary proposal baselines, legacy pending snapshots subsequently marked Approved, and present-day catalogue joins do not prove original values. Unmarked pre-deployment snapshots are deliberately unavailable. No backfill or reconstruction is attempted. Partial snapshots show only captured fields and an explicit notice.

If migration 009 is absent, approval retains its existing behavior and historical reads report unavailable. Existing species review prerequisites 016/017 still apply; this feature adds no migration requirement. Deploy the backend capture/read changes and web presentation together. Existing originals will show unavailable until a trustworthy original-review snapshot exists; approving a later edit does not manufacture one.

## Photos and decisions

Historical plant photo IDs are resolved only against matching plant assets, including detached retained bytes; retrieval still uses the existing authenticated asset endpoint. Missing/deleted/denied photos show unavailable and never fall back to current attachments. Historical species photos use the existing authenticated version-photo endpoint. Species proposal baseline photos match the recorded SHA-256 photo fingerprint from the authorized version-history API; adjacent rejected versions are never assumed to be the baseline. Storage, retention, evidence locks and lightbox design are unchanged.

Stored Approved decisions remain Approved. Existing version-history consumers continue deriving Current/Superseded separately. Record-change proposals support their existing Approved/Rejected decisions; Correction Required/cancellation are not added by this change. The teammate's cancellation implementation is outside scope.

## Unified table

The nine columns are Submission ID, Plant ID, Submission Type, Species, Submitted By, Location/Zone, Record Created, Status and Actions. Type badges appear in column three. Canonical IDs, full-ID copying, separate review routes, pagination and notification pinning remain intact. No Edit N label is inferred: the proposal-list contract does not expose a reliable edit sequence. Table fonts remain unchanged; horizontal scrolling accommodates the columns.

## Verification limits

Use isolated PGlite fixtures and mocked web HTTP tests. Do not use shared Supabase or run migrations against it for verification. Live end-to-end checks remain blocked by the separate public.qr_code / plant_app QR integration mismatch. Browser layout verification must be reported separately from compiled Vue/CSS/render tests.

## Changed files for this task

Backend:
- `plant-conservation-backend/historical-reviews.cjs` (new capture/projection helper)
- `plant-conservation-backend/domain.cjs` (approval capture and Officer historical projection)
- `plant-conservation-backend/species-requests.cjs` (species capture and historical reads)
- `plant-conservation-backend/record-version-history.cjs` (authenticated photo fingerprint metadata)
- `plant-conservation-backend/test/historical-reviews.test.cjs` (new isolated regressions)
- `plant-conservation-backend/test/final-rejection.test.cjs`
- `plant-conservation-backend/test/species-request-revision.test.cjs`
- `plant-conservation-backend/test/species-requests.test.cjs`
- `plant-conservation-backend/docs/historical-review-projection.md` (this report)

The three existing backend test files receive only disposable plant_app fixture initialization to match migration 017's explicit schema selection; their existing assertions remain intact.

Web:
- `web/src/views/conservation/ReviewSubmissionsView.vue`
- `web/src/services/reviewSpeciesRequest.ts`
- `web/src/components/conservation/ApprovedRecordChanges.vue`
- `web/src/locales/en.json`
- `web/src/locales/ms.json`
- `web/src/locales/zh-CN.json`
- `web/tests/reviewIntegration.test.mjs`
- `web/tests/recordChanges.test.mjs`

## Final checks

- Backend: 70 passed, zero failed across historical-reviews, record-changes, record-change-handoff, final-rejection, species-request-revision, observation-review-history, plant-detail, plant-public-privacy and species-requests tests.
- Web: 168 passed, zero failed across reviewIntegration, recordChanges and observationsIntegration tests.
- vue-tsc: passed.
- Scoped ESLint on the three changed web source files: passed.
- Backend syntax, localization JSON/UTF-8 validation and scoped Git whitespace checks: passed.
- Historical regression coverage includes a correction through the generic observation route, separate live/historical content after approval, original review metadata, original names/photos, detached/deleted photos, matching species baseline fingerprints, rejection of unmarked legacy snapshots and approval rollback when snapshot storage fails.
- All database tests use disposable PGlite. No external PostgreSQL/Supabase connection or real Plant 24 data was inspected.
- No browser visual verification was performed. Compiled Vue render/CSS tests cover column placement, typography and horizontal-scroll rules; desktop/laptop/narrow layouts still need browser inspection after QR integration.
- No Git mutation, service restart, migration execution against a configured database, mobile/QR/upload-locking/notification-refresh change or protected-file access was performed.

Existing edits already span several of these shared backend/web/locale files. Integrate the focused hunks with teammates before staging; this report is not an allowlist to stage entire pre-existing modified files. Existing local modifications were preserved.
