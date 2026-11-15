# NIAH source reconciliation: 15 November 2026

## Recovery references and scope

- Current branch remains main at 8e6b6db22f8a9813d6941dbc3fbb9b2610c1150d.
- Backup branch remains backup/officer-work-2026-11-15 at 8bc435ef2f3d195d50c6909861f8159cf545f4c2.
- Common ancestor: 889a97ebb28bd080e6908813c240f171d05690f0.
- Backup changes: 125 source paths. Main changes since the common ancestor: 95 paths.
- Exact overlap: 22 paths. Main-only changed paths: 73, all preserved.
- No merge, cherry-pick, staging, commit, fetch, pull, branch switch or history change was performed.
- These changes are an UNSTAGED source-level reconciliation, not a completed Git merge.
- The four excluded working files were neither read nor written. Only their path/status and filesystem metadata were inspected.

## Reconciliation decisions

Files unchanged on main since the common ancestor received the corresponding authorized backup source. Shared files were combined by comparing both sides against the common ancestor; neither side replaced the other wholesale.

The three coincident source-edit positions were independent additions:
1. domain.cjs retains main's QR schema normalization/parent relation and the backup's Admin overview route.
2. server.js retains main's QR schema options and route wiring and adds the backup's observation-review-history route.
3. PlantDetailView.vue retains main's latest/latest-approved observation computations alongside the backup's guest habitat, gallery, session-refresh and name presentation.

Mobile merges retain main's approved/pending card styling, All Plants labels and test harness additions, together with backup final-rejection, correction, optimistic-concurrency and historical/version UI changes. Main-only AddPlant, Plant, PlantDetail, SpeciesDetail and draft-management updates were preserved.

Shared RBAC/catalogue/photo-read changes from the authorized backup remain together. No new permission decision, role grant or upload-locking behavior was invented during reconciliation.

### QR compatibility

Main's production code continues using plant_app.qr_code, with qrPlantSchema restricted to plant_app and parent references resolved through qr-plant-mode.cjs. Main's activation step remains in normal observation approval; generated/retired codes are not treated as active scans. Record-change and registration QR paths retain main's schema changes.

Historical review capture remains in the original approval transaction after the established approval/QR updates. The integration regression checks that QR activation succeeds without a public.qr_code relation and that the original reviewed values remain preserved.

### Isolated fixture reconciliation

The common test fixture now creates plant_app. Backup tests therefore use idempotent schema setup rather than trying to create it twice. Post-move application fixtures use plant_app.qr_code, include the activation columns, and provide required mapping rows. The ready-species-photo test helper includes the existing 016/017 prerequisites before testing review endpoints. These are disposable PGlite fixture changes, not production migrations or permission bypasses.

## Migration identity, ordering and deployment gate

Evidence:
- scripts/migrate.cjs:84-94 explicitly loads 003-plant-qr-inventory.sql, 014-move-qr-code-to-plant-app.sql and 015-local-qr-only-move.sql.
- scripts/migrate.cjs:95-104 defines plant_app.schema_migration_history with migration_name TEXT PRIMARY KEY and migration_checksum.
- scripts/migration-state.cjs:200-202 computes SHA-256 over SQL text.
- scripts/migration-state.cjs:225-250 validates full names, checksums and executed/recognized/superseded resolutions; unknown entries are rejected.
- scripts/migrate-qr-only.cjs:92-97 explicitly loads only 015-local-qr-only-move.sql.
- The production 016 SQL is a separately operated transaction. It is not automatically discovered by npm run migrate.
- No runner scans the directory by numeric-prefix ordering.

The duplicate numeric prefixes do not collide in the current filename-keyed allowlist. They do create an operational risk for manual instructions or future prefix-based tooling.

Preserved unchanged:
- 014-move-qr-code-to-plant-app.sql and 014-species-image-gallery.sql.
- 015-local-qr-only-move.sql, its rollback-test file, and 015-species-photo-roles.sql.
- 016-production-qr-schema-move.sql and its rollback file.
- 016-species-request-content-revision.sql.
- 017-species-review-cycle.sql.

No migration was renamed, deleted, rewritten or run against a configured database. All main migration contents and both backup migration contents were compared with their source commits.

Operator review is required before deployment:
1. Confirm actual installed objects and any manual application of application 016/017; this task did not inspect Supabase.
2. Inspect the existing migration ledger and full filenames/checksums. Do not replay already-applied SQL because of a numeric prefix.
3. Do not add application 016/017 or production QR 016 to the QR runner's ledger ad hoc: its strict allowlist would reject those unknown entries.
4. Agree on explicit full-filename phases and a ledger strategy before expanding tooling. Do not rename deployed migrations automatically.
5. Application 016 follows 004/006 (and the established plant-name schema 005); 017 requires 016 and the observation/request tables. History capture uses optional migration 009. Photo roles follow their gallery prerequisites. The QR production cutover/rollback remains a separate operator-reviewed procedure.

The older historical-review document's QR-startup limitation describes the pre-integration state. The updated source now preserves main's plant_app startup checks, but actual startup against the installed database was not attempted.

## Tests and verification

- Combined backend: 164 passed, zero failed. Covers original/historical review snapshots, record changes, linked rejection, review cycles/revisions, review history, RBAC/Admin catalogue, photo libraries/gallery/privacy, plant submissions/details, notification delivery, business flows, QR inventory/lookup/generation/mode/config, startup mocks and migration-state validation.
- Historical review suite rerun after the final QR/schema assertions: 10 passed, zero failed.
- Web: 281 passed, zero failed across reviewIntegration, recordChanges, observationsIntegration, officerNotificationRefresh, officerNotifications, plantDetailVisibilityIntegration, speciesDetailIntegration and adminOverview.
- Mobile selected suites: 118 tests, 114 passed, four failed. Suites: record-edits, field-sync, plant-api-mapping, add-plant-draft-lifecycle, plant-card-display, species-detail-badges and localization.
- Read-only main baseline rerun: main source snapshots supplied in memory to localization and plant-card-display tests without a checkout. The same four failures reproduce (22 baseline checks: 18 passed, four failed).
- Web vue-tsc and mobile tsc passed.
- Scoped web ESLint passed.
- Scoped mobile ESLint: zero errors, three existing unnecessary-hook-dependency warnings (BotanistPlantDetail, BotanistSpeciesRequestDetail and NotificationObservation).
- Backend syntax and scoped whitespace checks passed.
- No live PostgreSQL/Supabase connection, migration CLI execution, service restart, browser or physical-device verification was performed. SQL tests use isolated PGlite; independent-connection lock timing remains unverified.

### Remaining mobile baseline failures (not concealed or rewritten)

1. localization.test.mjs:140: PersistentKnowledgeMap.native.js lacks the expected useAppTranslation subscription.
2. localization.test.mjs:163: localization-contract.json is stale relative to App.js navigation/auth expressions.
3. localization.test.mjs:237: the AddPlant render harness expects a species-selector label not present in the current initial render.
4. plant-card-display.test.mjs:60: the source-shape assertion expects a different owner-pending Zone hydration expression.

App.js, PersistentKnowledgeMap.native.js, AddPlant.js and Plant.js are unchanged from main. AddPlant label dictionaries are also unchanged. Resolve the tests or behavior with the mobile owner; do not change production behavior merely to satisfy stale source-text assertions.

## Deferred work and next Git steps

HOLD staging/production deployment until the mobile baseline failures and migration deployment plan are reviewed. Passing backend/web tests does not verify live schema or production readiness.

Review this unstaged reconciliation with the teammate, particularly shared authorization and QR/review interactions. If explicitly approved later, stage an explicit source allowlist excluding all four protected/excluded paths and create a reviewed integration commit on main. Do not blindly merge or cherry-pick the original backup over the already reconciled working tree. Retain the backup branch and both recovery references. No staging or commit is authorized by this report.

## Exact overlapping paths

- mobileapp/screens/BotanistPlantDetail.js
- mobileapp/scripts/record-edits.test.mjs
- mobileapp/translations/en.json
- mobileapp/translations/ms.json
- mobileapp/translations/zh.json
- plant-conservation-backend/domain.cjs
- plant-conservation-backend/plant-detail.cjs
- plant-conservation-backend/record-changes.cjs
- plant-conservation-backend/server.js
- plant-conservation-backend/test/business.test.cjs
- plant-conservation-backend/test/integration-reads.test.cjs
- plant-conservation-backend/test/observation-origin.test.cjs
- plant-conservation-backend/test/officer-notification-delivery.test.cjs
- plant-conservation-backend/test/pending-species-correction.test.cjs
- plant-conservation-backend/test/plant-detail.test.cjs
- plant-conservation-backend/test/plant-public-privacy.test.cjs
- plant-conservation-backend/test/plant-submissions.test.cjs
- plant-conservation-backend/test/record-changes.test.cjs
- plant-conservation-backend/test/species-requests.test.cjs
- web/src/services/plantDetail.ts
- web/src/views/PlantDetailView.vue
- web/tests/plantDetailVisibilityIntegration.test.mjs

## Exact source paths reintroduced or modified by this task

- mobileapp/screens/BotanistMyDrafts.js
- mobileapp/screens/BotanistNotifications.js
- mobileapp/screens/BotanistPlantDetail.js
- mobileapp/screens/BotanistSpeciesRequestDetail.js
- mobileapp/screens/EditPlantRecord.js
- mobileapp/screens/EditSpeciesRequest.js
- mobileapp/screens/FieldCollection.js
- mobileapp/screens/NotificationObservation.js
- mobileapp/scripts/field-sync.test.mjs
- mobileapp/scripts/plant-api-mapping.test.mjs
- mobileapp/scripts/record-edits.test.mjs
- mobileapp/translations/en.json
- mobileapp/translations/ms.json
- mobileapp/translations/zh.json
- mobileapp/utils/fieldSync.js
- mobileapp/utils/plantApi.js
- plant-conservation-backend/docs/approved-record-change-web-rollout.md
- plant-conservation-backend/docs/final-rejection-rollout.md
- plant-conservation-backend/docs/historical-review-projection.md
- plant-conservation-backend/docs/review-content-updates-and-species-edit-rollout.md
- plant-conservation-backend/docs/source-integration-2026-11-15.md
- plant-conservation-backend/domain.cjs
- plant-conservation-backend/final-rejection.cjs
- plant-conservation-backend/historical-reviews.cjs
- plant-conservation-backend/linked-species-rejection.cjs
- plant-conservation-backend/migrations/016-species-request-content-revision.sql
- plant-conservation-backend/migrations/017-species-review-cycle.sql
- plant-conservation-backend/observation-review-history.cjs
- plant-conservation-backend/officer-notification-delivery.cjs
- plant-conservation-backend/plant-detail.cjs
- plant-conservation-backend/record-changes.cjs
- plant-conservation-backend/record-version-history.cjs
- plant-conservation-backend/server.js
- plant-conservation-backend/species-requests.cjs
- plant-conservation-backend/species-review-cycle.cjs
- plant-conservation-backend/staff-notifications.cjs
- plant-conservation-backend/submission-updates.cjs
- plant-conservation-backend/test/admin-catalogue.test.cjs
- plant-conservation-backend/test/admin-overview.test.cjs
- plant-conservation-backend/test/business.test.cjs
- plant-conservation-backend/test/final-rejection.test.cjs
- plant-conservation-backend/test/historical-reviews.test.cjs
- plant-conservation-backend/test/integration-reads.test.cjs
- plant-conservation-backend/test/observation-origin.test.cjs
- plant-conservation-backend/test/observation-review-history.test.cjs
- plant-conservation-backend/test/officer-notification-delivery.test.cjs
- plant-conservation-backend/test/pending-species-correction.test.cjs
- plant-conservation-backend/test/plant-detail.test.cjs
- plant-conservation-backend/test/plant-public-privacy.test.cjs
- plant-conservation-backend/test/plant-submissions.test.cjs
- plant-conservation-backend/test/rbac.test.cjs
- plant-conservation-backend/test/record-change-handoff.test.cjs
- plant-conservation-backend/test/record-changes.test.cjs
- plant-conservation-backend/test/species-gallery.test.cjs
- plant-conservation-backend/test/species-photo-bigint-fixture.cjs
- plant-conservation-backend/test/species-photo-library.test.cjs
- plant-conservation-backend/test/species-request-integration.test.cjs
- plant-conservation-backend/test/species-request-revision.test.cjs
- plant-conservation-backend/test/species-requests.test.cjs
- plant-conservation-backend/test/submission-updates.test.cjs
- plant-conservation-backend/uploads.cjs
- shared/rbac.cjs
- web/src/components/AdminPageShell.vue
- web/src/components/AdminTableIdentifier.vue
- web/src/components/ConservationTopbarActions.vue
- web/src/components/PlantPhotoGallery.vue
- web/src/components/PlantPhotoLightbox.vue
- web/src/components/PlantRecordCard.vue
- web/src/components/conservation/ApprovedRecordChanges.vue
- web/src/components/conservation/ObservationReviewHistory.vue
- web/src/components/conservation/SubmissionChanges.vue
- web/src/data/adminNotifications.ts
- web/src/data/threatAlertPreview.ts
- web/src/locales/en.json
- web/src/locales/ms.json
- web/src/locales/zh-CN.json
- web/src/router/index.ts
- web/src/services/adminOverview.ts
- web/src/services/knowledge.ts
- web/src/services/observationReview.ts
- web/src/services/observationReviewHistory.ts
- web/src/services/officerNotificationRefresh.ts
- web/src/services/officerNotifications.ts
- web/src/services/plantDetail.ts
- web/src/services/plantGallery.ts
- web/src/services/recordChanges.ts
- web/src/services/reviewSpeciesRequest.ts
- web/src/styles/admin-tables.css
- web/src/styles/admin-typography.css
- web/src/styles/observation-dialog.css
- web/src/utils/adminLastLogin.ts
- web/src/views/AdminDashboardView.vue
- web/src/views/AdminModuleView.vue
- web/src/views/AdminOperationsView.vue
- web/src/views/AdminUserManagementView.vue
- web/src/views/PlantDetailView.vue
- web/src/views/PlantsView.vue
- web/src/views/SpeciesDetailView.vue
- web/src/views/SpeciesPlantsView.vue
- web/src/views/conservation/ObservationsView.vue
- web/src/views/conservation/ReviewSubmissionsView.vue
- web/src/views/conservation/ThreatAlertsView.vue
- web/tests/adminAlertNavigation.test.mjs
- web/tests/adminOverview.test.mjs
- web/tests/adminResponsiveLayout.test.mjs
- web/tests/adminTables.test.mjs
- web/tests/adminTypography.test.mjs
- web/tests/adminUserRefinements.test.mjs
- web/tests/assetImages.test.mjs
- web/tests/browser/system.spec.mjs
- web/tests/observationReviewHistory.browser.mjs
- web/tests/observationReviewHistory.test.mjs
- web/tests/observationsIntegration.test.mjs
- web/tests/officerDataTables.test.mjs
- web/tests/officerMonitoringDisplay.test.mjs
- web/tests/officerNotificationRefresh.test.mjs
- web/tests/officerNotifications.test.mjs
- web/tests/plantDetailVisibilityIntegration.test.mjs
- web/tests/plantGallery.test.mjs
- web/tests/plantPhotoViewer.test.mjs
- web/tests/recordChanges.test.mjs
- web/tests/reviewIntegration.test.mjs
- web/tests/speciesCatalogue.test.mjs
- web/tests/speciesDetailIntegration.test.mjs
- web/tests/submissionChanges.test.mjs
- web/tests/threatAlertPreview.browser.mjs
- web/tests/threatAlertsIntegration.test.mjs
