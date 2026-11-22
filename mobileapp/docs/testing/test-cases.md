# Mobile test case specification

**Environment:** synthetic fixtures in the scoped Node suites unless marked manual. **Actual status:** see `execution-log.md`; no physical-phone result is implied.

| Case / requirement | Preconditions and data | Steps | Expected result | Actual result / status / evidence |
|---|---|---|---|---|
| TC-AUTH-01 / MOB-01 | Mock valid and invalid sessions | Historical session/security checks | Historical result retained | Passed in broad Phase 1 mobile suite; **outside individual functional-testing scope** |
| TC-VIS-01 / MOB-02 | Synthetic Visitor/Guest data | Load browse, favourite and scan history state | Only permitted records and account-owned data appear | Unit assertions passed; device not executed |
| TC-CAT-01 / MOB-03 | Public pages, empty and malformed responses | Search/filter/load next page and error states | No duplicate items; proper continuation and error display | Mobile and 44-case backend sample passed; real network not executed |
| TC-TRANS-01 / MOB-04 | Fetched Species 6, all roles, translated field mock | Render detail after fetch and inspect translation hook and visible text | Only authorized fetched fields, correct public-only flag and account ID | New regression passed in focused and final mobile runs |
| TC-SUB-01 / MOB-05 | Draft and proposed edit fixtures | Restore form, validate, submit simulated request | Correct payload; approved original preserved; errors retained | Unit assertions passed; actual mobile-to-backend transaction not executed |
| TC-QR-01 / MOB-06 | Role/status scan fixtures | Scan Pending, Approved, Rejected and invalid code | Role-appropriate alert or navigation; no private leak | Unit assertions passed; camera/printed code not executed |
| TC-GPS-01 / MOB-07 | Two Observation rows and protected visibility fixture | Historical GPS policy check | Historical result retained | Backend unit assertions passed; **outside individual functional-testing scope** |
| TC-MEDIA-01 / MOB-08 | Local photo and draft fixtures | Select valid/invalid photo, save and reopen draft | Valid state retained and invalid selection handled | Unit assertions passed; physical file access not executed |
| TC-NOTIF-01 / MOB-09 | Account-scoped notification fixtures | Load, mark/read, switch account | Correct recipient and state; no cross-account cache | Unit assertions passed; real delivery not executed |
| TC-UX-01 / MOB-10 | EN/MS/ZH fixtures and size options | Change language/text size, inspect scroll and labels | Correct localized, accessible state | Unit/static assertions passed; visual/device not executed |
| TC-SEC-01 / MOB-11 | Synthetic unauthorized role | Historical permission check | Historical result retained | Scoped unit tests passed; **outside individual functional-testing scope** |
| PERF-01 / MOB-12 | Isolated local backend and database required | Measure fixed GET workload with agreed concurrency | Record p50/p95, throughput and error rate | **Not executed**; no valid isolated mobile backend service available |
| UAT-01 / MOB-12 | Real Botanist participant and test device required | Complete plant/Observation/QR/correction tasks | Participant records task completion and feedback | **Not executed**; use `uat-package.md` |

## Phase 2 added cases

| Case / requirement | Preconditions and data | Steps | Expected result | Actual result / status / evidence |
|---|---|---|---|---|
| TC-DB-01 / MOB-03 | Fresh in-memory PGlite, public/protected Species, approved/pending Plants | Insert synthetic rows and call actual backend count helper | Only approved visible Plants counted | Passed in `test/mobile-database-integration.test.cjs` |
| TC-DB-02 / MOB-05 | Fresh in-memory PGlite | Insert Observation, repeat client key, use invalid Plant ID, then roll back a valid insertion | Duplicate and FK rejected; rollback removes only proposed row | Passed in same file |
| TC-DB-03 / MOB-05 | Separate fresh in-memory PGlite | Query Observation count without seed | No records from prior test | Passed in same file |
| TC-DB-04 / MOB-07 | Fresh in-memory PGlite with one Plant | Insert zero/boundary GPS and out-of-range or negative-accuracy values | Valid values retained; invalid values rejected by constraints | Passed in same file |
| TC-HTTP-01 / MOB-04 | Loopback Express route, synthetic Botanist identity, mocked upstream source | Call real mobile Species search through `plantApi` and mounted backend dictionary route; try a short query | Valid result mapped; short query rejected | Current functional test retains search assertions; historical standalone unauthenticated denial check was removed as outside individual scope |

## Phase 3 added cases

| Case | Isolated action | Expected | Actual |
|---|---|---|---|
| TC-API-01 | Mount actual Species route with synthetic Botanist session; query search and invalid/missing IDs | Visible Species returned; malformed/missing identifiers handled | Current functional case passes. Historical standalone token-rejection assertions were removed as outside scope. |
| TC-API-02 | Submit valid and invalid Observation content with synthetic Botanist; repeat client key; retrieve and submit | Validation rejects bad height/GPS, one Draft persists, retry is idempotent, status becomes Pending Review | Passed; in-memory PostgreSQL and real route SQL |
| TC-API-03 | Submit valid Species Request image/data; test missing image, duplicate name and detail | One Pending Review row and photo persist; invalid/duplicate requests rejected | Current functional case passes; historical cross-account denial assertion removed |
| TC-API-04 | Retrieve and mark notifications for two synthetic Botanists | Each sees and marks only own notification | Passed; migration 011 applied only in memory |
| TC-API-05 | Call correction capabilities and malformed correction routes with synthetic Botanist session | Capability and input-validation codes are correct | Current functional case passes; historical credential/role denial assertions removed |
| TC-API-06 | Use real mobile `plantApi` over loopback for Species, Plant, Observation and notifications | Successful mapping and backend validation error | Current functional case passes; historical wrong-account assertion removed |

## Phase 4 added or extended cases

| Case | Isolated action | Expected | Actual |
|---|---|---|---|
| TC-FUNC-01 | Generate QR; submit Add Plant through real mobile client with three images/GPS; retry, invalid QR, missing/oversized image | One Pending Review Plant/Observation/receipt/version; no duplicate or partial failed submission | Passed in `test/mobile-api-routes-isolated.test.cjs` |
| TC-FUNC-02 | Lookup generated, retired, pending, approved, rejected, withdrawn and unknown QR; attempt assigned/retired QR reuse | Existing role-specific status markers; no QR reassignment | Passed with disposable seeded states; camera scanning not run |
| TC-FUNC-03 | Seed synthetic Correction Required Plant/Species decisions; resubmit original corrections | Proposed fields, retained photos and new pending versions persist; feedback retrievable | Passed; decision routes not run |
| TC-FUNC-04 | Seed approved Plant/Species; submit edit proposals | Pending changes/versions persist, approved source unchanged | Passed; Officer approval/edit correction not run |
| TC-FUNC-05 | Submit Observation edit; seed correction decision; resubmit revision 2 | Request, feedback, event and proposal persist; approved Observation unchanged | Passed for migration 021 path, not newer 029/030 path |
| TC-FUNC-06 | Inject connection, timeout and non-JSON failures into actual mobile `plantApi`; retry | Classified errors, caller-controlled retry, unchanged input object | Passed; real network outage/latency and screen-level form state not run |
| TC-FUNC-07 | Run existing Add Plant draft, autosave, Botanist draft, Field Sync and image selection cases | Recovery, owner scoping, photos/GPS/QR, failed-save preservation and restored-photo validation | 56/56 passed across five focused files |
