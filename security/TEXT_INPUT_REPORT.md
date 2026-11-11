# Text input security implementation

29 October 2026. Scope: validation, ordinary-text normalization and SQL injection review only. No dependencies installed, commits or pushes.

## Inspection and changes

The active data service is `plant-conservation-backend`, using `pg`, not a Supabase JavaScript client. Website authentication is in `web/server`. Login, registration and plant/species queries already bind values using placeholders. Dynamic authentication table names come from internal choices; schema identifiers are validated. No unsafe user-value SQL concatenation was found in the reviewed active paths, so no query rewrite was necessary. Search uses parameterized `strpos`, preserving punctuation and treating SQL-looking input literally.

Existing validation is in `web/server/http.mjs`, `activation.mjs`, the plant service's `domain.cjs`, and individual forms. These mechanisms were extended rather than introducing a validation framework. Existing API limits of 200 characters for species names and 4,000 for descriptions/notes were preserved for compatibility; schema columns are TEXT. Health/life stage remain limited to 100 and taxonomy to 1,000. Search controls allow 100 characters; the API retains its existing 200-character maximum.

Exact application/test files changed:

| File | Change |
| --- | --- |
| `plant-conservation-backend/domain.cjs` | Persist trimmed ordinary observation/species text using existing type/length validation; reject malformed species bodies and non-string search values; trim search. Coordinates and GPS validation unchanged. |
| `web/server/http.mjs` | Validate email format before website/mobile password login; permit surrounding email whitespace on Visitor registration. Existing account normalization, password handling, session and role logic retained. |
| `web/src/components/LoginModal.vue` | Friendly validation before submission, email trimming and length limit. |
| `web/src/components/StaffInvitations.vue` | Trim name and normalize email consistently with existing backend behavior; validate required name/email before submission. Existing backend provisioning validation retained. |
| `web/src/components/NavigationBar.vue` | Bound desktop and mobile navigation search inputs. |
| `web/src/views/PlantsView.vue` | Bound search input and incoming search URL value. |
| `web/src/views/SpeciesPlantsView.vue` | Bound plant search input. |
| `web/src/views/conservation/PlantSpeciesView.vue` | Extend existing required-field validation with name/description/habitat lengths and search bound. Existing Unicode support, trimming and text interpolation retained. |
| `mobileapp/screens/VisitorRegister.js` | Name/email length checks alongside existing required/email/password checks; passwords unchanged. |
| `mobileapp/screens/AddPlant.js` | Length checks for scientific names, morphology, descriptions and new-species request text before saving. |
| `mobileapp/screens/EditPlant.js` | Reject whitespace-only names and excessive names/descriptions in this existing prototype screen. |
| `mobileapp/screens/AddObservation.js` | Bound morphology and field notes. |
| `mobileapp/screens/FieldCollection.js` | Validate and trim ordinary observation text before draft creation/sync. GPS capture, values, validation and serialization untouched. |
| `mobileapp/screens/Plant.js` | Bound plant search input. |
| `mobileapp/screens/Species.js` | Bound species search input. |
| `web/server/text-input.test.mjs` | Five tests covering ordinary text, HTTP email validation, SQL parameter binding, rendering and isolated database workflows. |

Only plain text is normalized. Passwords and tokens are never trimmed or sanitized. Unicode, apostrophes, semicolons, botanical punctuation and HTML-like text remain data. Reviewed Vue templates use interpolation, with no `v-html` found in the searched application components/screens; React Native displays ordinary strings through Text.

The routed website Plant Species editor explicitly remains a session-only prototype. These changes do not turn it into a database-backed editor. The existing actual species API is independently validated and tested.

## Verification

- Five new tests pass. The isolated PGlite database test creates synthetic staff accounts, successfully logs in using passwords with surrounding spaces, creates a species through HTTP, searches a SQL-looking scientific name literally, creates a plant through native bearer authentication and verifies trimmed notes in storage. It also rejects long names and unauthorized species creation.
- HTTP tests reject empty, malformed, multiple-@ and non-string emails before account services are called. Ordinary text tests reject empty values, invalid types and excessive lengths; preserve Unicode and punctuation.
- Vue server rendering escapes script-like text; the reviewed species display template uses interpolation. No interactive browser or native-device execution test was performed.
- Targeted authentication, role-boundary, RBAC and security suite: 20 tests pass, zero failures. This includes the five new tests, so counts are not additive.
- Website production build/type check, mobile lint and mobile type check pass. Website build retains a large-chunk warning. Node reports an existing mobile module-type warning.
- Broader legacy `api.test.mjs` and `business.test.cjs` run: four failures. Three website API tests expect Botanist browser login; all three reproduce with the original HEAD HTTP handler. The business test sends a browser Origin for Botanist access and receives 403 at its initial `/observations` read, before reaching plant creation. Existing identity middleware explicitly rejects that browser role. Tests and access rules were not loosened.
- No real account credentials, production database, email delivery or phone runtime were used. Normal login and plant registration were verified only with synthetic accounts and an isolated database.

Evidence added in `security/evidence/`: `text-input-tests.txt`, `text-input-targeted-regressions.txt`, `text-input-regressions.txt`, `text-input-baseline-api.txt`, `text-input-web-build.txt`, `text-input-mobile-lint.txt`, `text-input-mobile-types.txt`. This report and those seven evidence files are the additional documentation files created by this task. Baseline temporary source copies were removed.

## Commands

Run from the repository root, in separate terminals for services; existing environment configuration is required:

```powershell
# Website and its authentication backend together
npm.cmd --prefix web run dev
# Authentication backend alone
npm.cmd --prefix web run server
# Plant API
npm.cmd --prefix plant-conservation-backend start
# Expo mobile app
npm.cmd --prefix mobileapp start

# Security tests and relevant regressions
node --test --test-isolation=none web/server/text-input.test.mjs web/server/auth.test.mjs web/server/client-boundary.test.mjs plant-conservation-backend/test/rbac.test.cjs
npm.cmd --prefix web run build
npm.cmd --prefix mobileapp run lint -- --no-cache
npm.cmd --prefix mobileapp run type-check

# Broader existing suites (known legacy role-expectation failures described above)
npm.cmd --prefix web run test:auth
npm.cmd --prefix plant-conservation-backend test
```

The mobile startup command retains the existing recovery-build hook. Service startup commands above are handoff instructions, not claims that services were deployed or launched for live use.

## Scope and remaining limits

No GPS/geolocation/map logic, IoT/device code or APIs, face recognition, password hashing/change flows, authorization grants, schema files, migrations, RLS policies or existing database records were modified by this task. Files that combine ordinary forms with GPS code (`AddPlant.js`, `FieldCollection.js`, `domain.cjs`) have text-only edits; their GPS sections are unchanged.

At task start the workspace already contained changes to `deploy/mobile-login-gateway.test.mjs`, `mobileapp/face_backend/.gitignore`, `mobileapp/face_backend/account_service.py`, and three untracked face-service documentation/test/startup files. They were left untouched, so the overall working tree is intentionally not clean.

This is a scoped hardening change, not a full security audit. The excluded face-service password endpoint and recovery/password-change flows were not altered. Live mobile/backend integration and browser/device interaction remain unverified. The older broad tests need their expectations reviewed against the existing browser-role policy in a separate task. No claim is made that every legacy/prototype endpoint or external deployment is secure.
