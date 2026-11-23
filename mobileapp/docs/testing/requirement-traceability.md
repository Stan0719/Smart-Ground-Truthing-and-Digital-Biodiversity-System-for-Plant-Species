# Mobile and backend requirement traceability matrix

Executed evidence refers to the 2026-11-22 run in `execution-log.md`. A passing file is evidence for its asserted cases, not for an entire physical workflow.

| ID | Requirement / component | Case | Type and expected result | Evidence / status | Gap |
|---|---|---|---|---|---|
| MOB-01 | Login, session and role routing / mobile + backend | TC-AUTH-01 | Historical session/security assertions | Executed in the historical broad mobile suite; **outside individual functional-testing scope** | Cybersecurity teammate owns assessment |
| MOB-02 | Guest/Visitor browsing, favourites, scan history / mobile | TC-VIS-01 | Unit: scoped records and account data | `scripts/visitor-features.test.mjs`, `scan-history-loader.test.mjs`; executed | Device/network pending |
| MOB-03 | Plant/Species browsing, search, pagination, details / mobile + backend | TC-CAT-01 | Unit: authorized result, empty/error, continuation | `scripts/species-catalog.test.mjs`, `plant-list-states.test.mjs`; backend `test/plant-list-page.test.cjs`; executed | Large dataset and real API pending |
| MOB-04 | Species detail database text and public visibility / mobile | TC-TRANS-01 | Positive/negative: only fetched authorized fields translated in viewer scope | `scripts/species-detail-back.test.mjs`; new regression executed | Phone localization pending |
| MOB-05 | Plant, Species and Observation submission/edit/correction / mobile + backend | TC-SUB-01 | Unit: validation, draft and proposed changes preserve originals | `scripts/add-plant-workflow.test.mjs`, `record-edits.test.mjs`, `observation-edit-requests.test.mjs`; backend `test/submission-updates.test.cjs`; executed | Isolated API/database end-to-end blocked |
| MOB-06 | QR scan and inventory / mobile + backend | TC-QR-01 | Positive/negative: scan status and role response | `scripts/scan-role-flow.test.mjs`, `qr-inventory.test.mjs`; backend `test/qr-local-mode.test.cjs`; executed | Camera/printed QR device check pending |
| MOB-07 | Observation GPS authorization / backend | TC-GPS-01 | Historical protected-location policy assertions | `test/observation-gps.test.cjs` executed historically; **outside individual functional-testing scope** | Cybersecurity teammate owns policy assessment; numeric GPS validation remains functional |
| MOB-08 | Photos and drafts / mobile | TC-MEDIA-01 | Unit: selection, reuse and recovery | `scripts/image-selection.test.mjs`, `botanist-drafts.test.mjs`; executed | Camera/gallery and file permissions pending |
| MOB-09 | Notifications, status and version display / mobile | TC-NOTIF-01 | Unit: scoped notification/read and status behavior | `scripts/botanist-notifications.test.mjs`, `status-refresh.test.mjs`, `botanist-records.test.mjs`; executed | Real push/delivery and Officer cycle pending |
| MOB-10 | Localization, accessibility and layout / mobile | TC-UX-01 | Unit/static: text preference, labels and scroll state | `scripts/localization.test.mjs`, `text-size-accessibility.test.mjs`, `scroll-discoverability.test.mjs`; executed | Small phone, large font, screen reader pending |
| MOB-11 | API security / backend | TC-SEC-01 | Historical permission assertions | `test/status-permissions.test.cjs`, `observation-gps.test.cjs` executed historically; **outside individual functional-testing scope** | Cybersecurity teammate owns assessment |
| MOB-12 | Performance and UAT / integration | PERF-01, UAT-01 | Measured local latency and observed user task completion | Not executed | Isolated service and participants required |

## Phase 2 evidence update

- **MOB-03 / TC-CAT-01:** `plant-conservation-backend/test/mobile-database-integration.test.cjs` passed against a new in-memory PostgreSQL fixture. It checks approval and Species visibility before counting. This is database integration, not the complete production route.
- **MOB-04 / TC-TRANS-01:** `mobileapp/scripts/species-dictionary-integration.test.mjs` passed with real loopback HTTP from mobile `plantApi` and `searchSpeciesDictionary` to the mounted backend dictionary route. The identity and external species source are test doubles.
- **MOB-05 / TC-SUB-01:** the isolated database test passed Observation foreign-key, duplicate-client-key, transaction rollback and per-test isolation cases. Actual submission endpoint and Officer cycle remain blocked by cross-directory dependencies.
- **MOB-07 / TC-GPS-01:** the new isolated database case passed zero and boundary coordinates and rejected values outside the stored Plant location constraints. It does not test device GPS capture.
- **MOB-11 / TC-SEC-01:** historical permission-test and offline advisory-audit executions are retained in the execution log as factual results **outside individual scope**; they are excluded from individual mobile functional totals.
- **MOB-12 / PERF-01:** a 500-record in-memory Plant-count query microbenchmark ran, but API and device performance remain unverified. UAT is still not executed.

## Phase 3 evidence update

- **MOB-01 / TC-AUTH-01:** Phase 3 historically exercised synthetic bearer rejection; those standalone assertions have since been removed from the mixed route test as **outside individual scope**. The functional route harness still supplies a synthetic signed-in user.
- **MOB-03 / TC-CAT-01:** actual Species list/detail and one Plant detail route were exercised against PGlite. Search, malformed/missing Species IDs, and the real mobile `plantApi` path passed. Plant list pagination remains unverified in this phase.
- **MOB-05 / TC-SUB-01:** actual Observation creation, Draft retrieval, idempotent retry, Pending Review submit, and Species Request creation/detail/duplicate handling passed against disposable PostgreSQL. Correction endpoints passed malformed-payload cases; their historical standalone authentication assertions were removed from the current functional test.
- **MOB-09 / TC-NOTIF-01:** actual notification retrieval and read marking preserved recipient isolation for two synthetic Botanists. Delivery and sync remain unverified.
- **MOB-07 / TC-GPS-01:** Observation creation accepted numeric zero GPS and rejected latitude outside the valid range at the route boundary. Production GPS visibility was not tested because the shared policy was replaced by a test stub.
- See `phase-3-mobile-api-routes.md` and `execution-log.md` for exact routes, setup and limitations. No device result is implied.

## Phase 4 evidence update

- **MOB-05 / TC-SUB-01:** Add Plant succeeded through real mobile `plantApi` and mounted backend route, persisting a Pending Review Plant, initial Observation, GPS, three photos, QR assignment, receipt and version. Plant, Species and Observation edit proposals were created through actual backend routes. Original Plant/Species corrections and Observation edit correction resubmission succeeded after review states were seeded in disposable data.
- **MOB-06 / TC-QR-01:** generated, assigned, Pending Review, Approved, Rejected and Withdrawn QR lookup responses and assigned-QR reuse rejection passed with synthetic data. Camera/print behavior was not exercised.
- **MOB-08 / TC-MEDIA-01:** focused draft/photo suite passed 56/56, including local recovery, failure preservation and restored-image size checks. No real-device offline synchronization claim is made.
- **MOB-09 / TC-NOTIF-01:** Species and Observation edit correction feedback was retrieved through their detail routes. Officer decision routes and delivery were not run.
- **MOB-11 / TC-SEC-01:** Phase 4 excludes cybersecurity assessment; the synthetic session/policy remains only as a functional route fixture and does not establish production permissions.
- See `phase-4-functional-integration.md` for exact workflow boundaries and unexecuted cases.
