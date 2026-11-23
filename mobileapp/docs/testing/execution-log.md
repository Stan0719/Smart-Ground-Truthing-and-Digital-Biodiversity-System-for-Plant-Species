# Mobile and supporting backend execution log

**Date:** 2026-11-22. Commands ran from their respective authorized directories. Counts are individual Node test declarations, not files. Historic counts from other sessions are not used as current evidence. These two final suites are disjoint by file; focused reruns overlap and are not added to their total. **Scope correction:** the broad historical suites include pre-existing cybersecurity assertions and are factual project-level executions, **not individual mobile functional-testing totals**. Cybersecurity assessment and dependency advisory auditing are outside this contributor's scope.

| Run | Files | Executed | Passed | Failed | Skipped | Result |
|---|---:|---:|---:|---:|---:|---|
| Mobile baseline, all `scripts/*.test.mjs` except `recovery-flow.test.mjs` | 65 | 637 | 624 | 13 | 0 | Failed: 11 missing translation-hook mocks, 1 isolated fragment binding, 1 source assertion |
| Mobile focused repaired files | 4 | 80 | 80 | 0 | 0 | Passed; overlaps final run |
| New Species detail case focused rerun | 1 | 7 | 7 | 0 | 0 | Passed; overlaps final run |
| Mobile final permitted suite | 65 | 638 | 638 | 0 | 0 | Passed |
| Backend scoped unit sample: `observation-gps`, `plant-list-page`, `submission-updates`, `status-permissions`, `qr-local-mode`, `qr-local-config`, `species-dictionary`, `translation-service` | 8 | 44 | 44 | 0 | 0 | Passed; pure or mocked dependencies only |
| Mobile TypeScript | — | — | — | — | — | `npm run type-check` passed |
| Mobile full lint | — | — | — | — | — | `npm run lint` produced no lint result after more than two minutes and was interrupted; inconclusive |
| Targeted lint of four changed tests | — | — | — | — | — | `npx eslint --no-ignore ...`: 0 errors, 7 pre-existing warnings (unused variables and import order) |
| Scope-blocked mobile recovery test | 1 | — | — | — | — | Imports `web/` TypeScript and source; not run |
| Scope-blocked mobile auth npm script | — | — | — | — | — | Names `web/` and `deploy/` tests; not run as a script |
| Scope-blocked backend database integration | many | — | — | — | — | Shared backend fixture imports `web/server/test-postgres.mjs`; not run |
| Device browser, UAT and performance testing | — | — | — | — | — | Not executed; cybersecurity assessment is outside individual scope |

**Exact final mobile command (PowerShell, from `mobileapp/`):**

```powershell
$files = rg --files scripts -g '*.test.mjs' | Where-Object { $_ -notmatch 'recovery-flow\.test\.mjs$' }
node --test --test-isolation=none $files
```

**Exact backend command (from `plant-conservation-backend/`):**

```powershell
node --test --test-isolation=none test/observation-gps.test.cjs test/plant-list-page.test.cjs test/submission-updates.test.cjs test/status-permissions.test.cjs test/qr-local-mode.test.cjs test/qr-local-config.test.cjs test/species-dictionary.test.cjs test/translation-service.test.cjs
```

The mobile tests mostly use mocks, source transpilation and VM-rendered elements. The backend sample uses function-level mocks rather than an isolated PostgreSQL instance. None of these counts demonstrates a physical device or full API/database workflow.

## Phase 2 continuation — 2026-11-22

The Phase 1 rows above remain historical for this continuation. The following are newly executed, overlapping only where stated:

| Run | Files | Executed | Passed | Failed | Skipped | Result |
|---|---:|---:|---:|---:|---:|---|
| Mobile final permitted suite, including new client-to-route Species integration | 66 | 639 | 639 | 0 | 0 | Passed; one new case since Phase 1 |
| Strict-scope backend sample plus new isolated PGlite integration, with Node coverage | 6 | 20 | 20 | 0 | 0 | Passed; four new database cases; all loaded implementation modules inside backend |
| Exploratory wider backend run, excluded from strict-scope total | 9 | 48 | 48 | 0 | 0 | Passed, but three selected tests load broader server/domain and shared RBAC code; not counted as strict-scope evidence |
| Focused mobile-to-backend HTTP case | 1 | 1 | 1 | 0 | 0 | Passed; included in 639, not additive |
| Mobile TypeScript | — | — | — | — | — | `npm run type-check` passed |
| Targeted ESLint | — | — | — | — | — | 0 errors, 7 existing warnings across older test lines; new integration file had no warning |
| Broad configured ESLint on `screens components utils translations` | — | — | — | — | — | 61 errors, 9 warnings in existing application files; no application source changed in this phase |
| Backend JavaScript syntax | 3 files | — | — | — | — | `node --check` passed for new fixture, integration test and benchmark |
| Historical offline dependency audit, outside individual scope | 2 packages | — | — | — | — | `npm audit --offline --audit-level=high` reported 0 vulnerabilities in each using cached data; retained as factual history, **excluded from individual functional evidence** |
| In-memory Plant count microbenchmark | 1 script | 30 queries | 30 correct | 0 | 0 | Measurements in `performance-report.md`; not an API/device benchmark |

**Phase 2 mobile command (from `mobileapp/`):** same PowerShell command above, now selecting 66 files. **Strict-scope Phase 2 backend command (from `plant-conservation-backend/`):** `node --experimental-test-coverage --test --test-isolation=none test/observation-gps.test.cjs test/plant-list-page.test.cjs test/submission-updates.test.cjs test/status-permissions.test.cjs test/species-dictionary.test.cjs test/mobile-database-integration.test.cjs`. That historical backend selection included pre-existing permission tests outside the individual functional total. The narrow HTTP test uses a real loopback backend route and mobile client functions, but injects a synthetic identity and mocked upstream biodiversity response. Its standalone unauthenticated denial assertion was later removed from the current mixed functional test.

Other exact Phase 2 checks: `npm run type-check`; `npx eslint --no-ignore scripts/species-dictionary-integration.test.mjs scripts/species-detail-back.test.mjs scripts/species-detail-badges.test.mjs scripts/plant-photo-gallery.test.mjs scripts/botanist-records.test.mjs`; `npx eslint screens components utils translations`; `npm audit --offline --audit-level=high` in each package; `node scripts/benchmark-mobile-plant-counts.cjs` from the backend; `git diff --check -- mobileapp plant-conservation-backend` from the repository root.

## Phase 3 authenticated route continuation — 2026-11-22

Phase 1 and 2 counts above were **not rerun**. New execution evidence:

| Run | Executed | Passed | Failed | Skipped | Notes |
|---|---:|---:|---:|---:|---|
| `test/mobile-api-routes-isolated.test.cjs` final | 6 | 6 | 0 | 0 | Actual mounted backend route handlers, in-memory PGlite, loopback HTTP; synthetic session and policy stub |
| Focused backend regression: new file plus mobile database, Observation GPS and Species Dictionary | 16 | 16 | 0 | 0 | The same six Phase 3 cases plus ten previously existing cases; not additive to the six |
| Mobile client portion | 1 | 1 | 0 | 0 | Included in the six declarations, not additive; actual `plantApi.js` against loopback routes |
| Mobile `npm run type-check` | n/a | pass | 0 | n/a | No mobile source changed in Phase 3 |
| Backend `node --check` on new test | n/a | pass | 0 | n/a | Syntax check |
| Scoped `git diff --check -- mobileapp plant-conservation-backend` | n/a | pass | 0 | n/a | Tracked diffs only; new files also reviewed separately |
| Attempted ESLint from mobile on backend test | n/a | not checked | 0 | n/a | ESLint ignored the file as outside its configured base path; one warning, **not** a lint pass |

**Exact commands:** from `plant-conservation-backend/`, `node --test --test-isolation=none test/mobile-api-routes-isolated.test.cjs`, `node --test --test-isolation=none test/mobile-api-routes-isolated.test.cjs test/mobile-database-integration.test.cjs test/observation-gps.test.cjs test/species-dictionary.test.cjs`, and `node --check test/mobile-api-routes-isolated.test.cjs`; from `mobileapp/`, `npm run type-check` and `npx eslint --no-ignore ../plant-conservation-backend/test/mobile-api-routes-isolated.test.cjs`; from the repository root, `git diff --check -- mobileapp plant-conservation-backend` and scope-limited `git status --short -- mobileapp plant-conservation-backend`. A scoped trailing-whitespace search over the new test and edited documents found no matches. An initial `node --test` without `--test-isolation=none` failed to start because this Windows environment denied the runner child-process spawn (`EPERM`); it was not a test assertion failure. Intermediate Phase 3 runs exposed missing test-only migrations 006 and 014, corrected by applying those existing files **in memory only**; the final run passed.

The historical six test declarations included standalone synthetic token and role-denial assertions alongside functional Species/Plant reads, Observation creation/submit, Species Request creation, notification recipient handling, correction validation and mobile client requests. The standalone cybersecurity assertions were later removed from the current mixed test file; the historical run is not presented as a current individual functional total. No coverage run was made in Phase 3. See `phase-3-mobile-api-routes.md` for the route matrix and caveats.

## Phase 4 functional continuation — 2026-11-22

Phase 1–3 full-suite results above remain historical; they were not rerun for this continuation. The Phase 3 backend test file was extended with three new declarations and focused assertions for Plant/Species edits and corrections in its existing cases.

| Run | Executed | Passed | Failed | Skipped | Evidence |
|---|---:|---:|---:|---:|---|
| Backend isolated route file, final Phase 4 state | 9 | 9 | 0 | 0 | Six existing declarations (extended), three new declarations; actual loopback routes and disposable PGlite |
| Focused mobile draft/photo regression | 56 | 56 | 0 | 0 | Five files; local/mocked tests, no physical phone |

**Commands:** from `plant-conservation-backend/`, `node --test --test-isolation=none test/mobile-api-routes-isolated.test.cjs`; from `mobileapp/`, `node --test --test-isolation=none scripts/botanist-drafts.test.mjs scripts/botanist-draft-autosave.test.mjs scripts/add-plant-draft-lifecycle.test.mjs scripts/field-sync.test.mjs scripts/image-selection.test.mjs`. A Node `MODULE_TYPELESS_PACKAGE_JSON` warning occurred during mobile tests; all 56 assertions passed.

Final focused backend regression: `node --test --test-isolation=none test/mobile-api-routes-isolated.test.cjs test/mobile-database-integration.test.cjs test/observation-gps.test.cjs test/species-dictionary.test.cjs` passed **19/19** (the nine route cases plus ten existing cases; not additive to the 9/9 row). `node --check test/mobile-api-routes-isolated.test.cjs`, mobile `npm run type-check`, and scoped `git diff --check -- mobileapp plant-conservation-backend` passed. A scoped trailing-whitespace search on the new test and updated documents found no matches. Full mobile 639-test suite, full backend suite, configured ESLint, coverage, device tests and Officer routes were not run in Phase 4.

## Individual-scope cleanup after Phase 4

The Phase 1–4 results above remain factual historical execution records. Some broad suites and the 19-case Phase 4 regression included pre-existing permission/GPS policy tests; they are **not counted as individual mobile functional-testing totals**. Standalone token, role-denial and cross-account assertions introduced in the mixed Phase 3 route file were removed without changing the synthetic session fixture or production middleware. The security-only assessment document was removed.

| Post-cleanup run | Executed | Passed | Failed | Skipped | Scope |
|---|---:|---:|---:|---:|---|
| Backend route and PGlite functional tests | 13 | 13 | 0 | 0 | `test/mobile-api-routes-isolated.test.cjs` plus `test/mobile-database-integration.test.cjs`; no pre-existing security-only files |
| Mobile Species Dictionary, drafts, Field Sync and image selection | 57 | 57 | 0 | 0 | Six focused files; some pre-existing account-scoping assertions remain as functional draft integrity checks; not a security assessment |

**Commands:** from `plant-conservation-backend/`, `node --test --test-isolation=none test/mobile-api-routes-isolated.test.cjs test/mobile-database-integration.test.cjs` and `node --check test/mobile-api-routes-isolated.test.cjs`; from `mobileapp/`, `node --test --test-isolation=none scripts/species-dictionary-integration.test.mjs scripts/botanist-drafts.test.mjs scripts/botanist-draft-autosave.test.mjs scripts/add-plant-draft-lifecycle.test.mjs scripts/field-sync.test.mjs scripts/image-selection.test.mjs`; from repository root, `git diff --check -- mobileapp plant-conservation-backend`. The mobile run emitted Node's `MODULE_TYPELESS_PACKAGE_JSON` warning but all assertions passed. No full-suite, advisory scan or production database test was run during cleanup.
