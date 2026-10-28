> Historical instructions: project Python files and launchers were removed at the user's request. Python commands below are no longer runnable. The active website uses Vue, Node.js and PostgreSQL.

# Final system verification — 24 October 2026

> Latest UI verification: section 27 records the repaired staff modal and role pages, with 58 affected tests passing. The temporary-password workflow is retained; earlier full-suite totals are historical.

## 1. Executive summary

The local SQLite system is suitable for continued development and controlled
verification. **It is not approved as production-ready.** Real browser checks now
exercise the website against real isolated authentication and plant APIs, not
mocked application responses. Software regressions pass; remaining blockers are
email configuration, native-device/hardware evidence, mobile HTTPS reachability,
and unresolved mobile dependency advisories.

No deployment was performed. No port visibility was widened. No actual user's
password, status, role or face enrollment was reset. No sample plants/readings
were inserted into the live plant database. Supabase/PostgreSQL remain unused.

## 2. Problems discovered and root causes

| Finding | Root cause | Action |
|---|---|---|
| Mobile-only account login left a website cookie | LoginModal authenticated first, then only displayed a platform message | Revoke that browser session before displaying guidance |
| First conservation status could not be entered normally | Officer form accepted only an existing numeric reference ID in an empty DB | Accept a verified status name; resolve/create its reference inside the species transaction |
| Genus edits were ignored | Species UPDATE omitted genus_id | Update it when supplied, preserving it when omitted |
| Production origin could fall back to a development address | Origin resolver allowed automatic defaults in production | Require explicit APP_ORIGIN in production |
| Authentication/face files were mode 644 | SQLite creation used default file permissions | Enforce mode 600 at startup and on the existing files; directories remain private |
| Backup covered plants but not the full authentication/face recovery set | Existing tool was intentionally plant-only | Add a private system backup with integrity and isolated restoration checks |
| Browser console showed compute-pressure policy messages | Third-party YouTube iframe probes a restricted browser API | Keep the restriction; isolate only the external video document in local system tests |
| Phone requests do not reach API JSON | Codespaces private forwarding redirects to GitHub sign-in | Confirmed with unauthenticated HTTPS requests; no access setting changed |

The YouTube diagnostic is not a reason to grant additional browser permissions.
Its player itself is outside the scope of the local system tests. The production
website's visual design and embedded video were retained.

## 3. Files modified in this verification

- `.gitignore`: browser test artifacts.
- `web/package.json`, `web/package-lock.json`: Playwright development dependency
  and `test:browser` command; no application framework major upgrade.
- `web/playwright.config.mjs`, `web/tests/browser/system.spec.mjs`: reproducible
  headless Chromium role, navigation, workflow, image and report checks.
- `web/src/components/LoginModal.vue`: revoke unintended mobile-account web login.
- `web/src/views/conservation/ConservationWorkspace.vue`: verified status-name
  input; existing layout and role boundaries retained.
- `web/server/website-origin.mjs`, `website-origin.test.mjs`: production origin guard.
- `web/server/auth.mjs`: private database file permissions.
- `mobileapp/face_backend/core.py`: private face database file permissions.
- `plant-conservation-backend/domain.cjs`: transactional status references and
  correct optional genus updates, with unchanged permission middleware.
- `plant-conservation-backend/scripts/backup-system.cjs`, `package.json`: verified
  system backup command; existing plant-only backup remains available.
- `plant-conservation-backend/test/backup-system.test.cjs`, `test/business.test.cjs`:
  restoration, non-overwrite, reference validation, genus edits and UTC assertions.
- `mobileapp/package-lock.json`: result of a compatible audit-fix attempt; no
  forced SDK changes, no suppression of audit findings.
- `docs/final-system-verification.md`, `final-dependency-audit.json`,
  `sqlite-plant-storage.md`, `remaining-software-repairs.md`, `README.md`:
  evidence and current operational instructions.

Private runtime backup files were created under the already ignored backend
`backups/` directory. Existing images, prototype datasets, historical migrations,
previous backups and `shared/rbac.cjs` were not modified by this verification.

## 4. Fixes and dependency changes

Playwright and its Chromium browser were installed for development verification.
There was no automatic major Expo upgrade. `npm audit fix --ignore-scripts`
was attempted without `--force`; mobile's remaining eight entries were retained
and investigated rather than hidden by unsafe overrides. Current exact advisory
paths and fix suggestions are in [final-dependency-audit.json](final-dependency-audit.json).

New named conservation-status references are created only when an authorized
Officer supplies a name during an actual species write. No reference values or
scientific facts are seeded automatically. Providing a name and an ID together
is rejected; a transaction failure rolls back any new reference.

## 5. Tests and evidence

| Check | Passed | Failed at final verification | Skipped | Status |
|---|---:|---:|---:|---|
| Backend SQLite, workflow, IoT, RBAC and backup suite | 10 | 0 | 0 | VERIFIED — Automated testing passed |
| Website authentication, activation, origin, response and email-adapter suite | 22 | 0 | 0 | VERIFIED — Automated testing passed |
| Mobile API, session, recovery, encrypted-draft engine and sync suite | 43 | 0 | 0 | VERIFIED — Automated testing passed |
| Python with real-model negative test enabled | 44 | 0 | 7 | VERIFIED — Automated testing passed, subject to skipped checks |
| Serial parser | 3 | 0 | 0 | VERIFIED — Automated testing passed |
| Chromium browser scenarios | 6 | 0 | 0 | VERIFIED — Real browser testing passed |
| **Total distinct tests** | **128** | **0** | **7** | Subset reruns are not counted twice |

Additional passed checks: website production build/Vue type checking, changed Vue
component lint, mobile lint/type checking, Android Expo export, SQLite integrity
and foreign keys, Python `pip check`, and `git diff --check`. Android export is a
bundle build, not a physical device run.

Reproduce from the appropriate package directories:

```bash
# plant-conservation-backend
npm test
npm run check-db

# web
node --test --test-isolation=none server/*.test.mjs tests/*.test.mjs
npx playwright install chromium
npm run test:browser

# mobileapp
node --test --test-isolation=none scripts/*test.mjs
npm run lint
npm run type-check
npx expo export --platform android --output-dir /tmp/niah-android-check

# mobileapp/face_backend
FACE_TEST_REAL_MODELS=1 .venv/bin/python -m unittest discover -p 'test_*.py'

# workspace root
python3 -m unittest discover -s IoT/PlantPrototype -p 'test_*.py'
```

The browser suite creates separate temporary databases, random test passwords and
isolated loopback services. It uses the production frontend build, actual cookies,
actual APIs and real image processing. All test application records are synthetic
and stay outside live storage. Only YouTube's external document is stubbed;
website/authentication/plant API responses are not mocked. Uncaught page errors,
unexpected application console errors and local HTTP 5xx responses fail the suite.
Expected authorization denials are not treated as application crashes. Screenshots,
videos and traces are disabled to avoid retaining credential-bearing artifacts.

## 6. Website verification

**VERIFIED — Real browser testing passed:** homepage, Explore Plants redirect,
empty catalogue, absence of database error banner, route navigation and role
sessions. The live plant database remains zero species/zero plants, as authorized.
Its empty response is not a defect or a reason to add placeholder records.

The production frontend builds. Local development services remain session-bound;
these checks do not establish deployed hosting availability.

## 7. Administrator verification

**VERIFIED — Real browser testing passed (isolated account):** login, reload/session
persistence, Admin dashboard/navigation, permitted device API, rejected species
API, rejected Officer route, logout and subsequent unauthenticated session.
Backend tests cover account/status/security operations and Visitor management.

**IMPLEMENTED — Awaiting manual verification:** logging in with an actual existing
Administrator account. Existing passwords were not used, printed or reset.

## 8. Conservation Officer verification

**VERIFIED — Real browser testing passed (isolated account):** login/reload,
conservation dashboard, denial of Admin access, species form, named conservation
status, image upload, review approval, CSV/PDF report downloads, and logout.

**IMPLEMENTED — Awaiting manual verification:** actual Officer login and verified
real species entry. No actual plant facts were supplied, so live entry is pending.

## 9. Botanist verification

**VERIFIED — Real browser testing passed:** the existing website intentionally
provides dashboards to Administrators and Officers. A Botanist gets mobile-only
guidance and now leaves no hidden website session. Separate API checks verify
Botanist observation access and rejection of reports/Admin routes.

**VERIFIED — Automated testing passed:** owned plant/observation creation, retries,
corrections, photo association, rejected self-approval, and protected-data denial.
**BLOCKED — Physical hardware required:** actual mobile dashboard/device workflow.
No new Botanist web dashboard or additional permission was invented.

## 10. Visitor verification

**VERIFIED — Real browser testing passed:** mobile-only website login guidance,
no leftover cookie, public navigation after reload, rejected staff routes and
rejected observation/report APIs. Automated tests separately cover registration,
password authentication and revocation. Actual mobile login is **IMPLEMENTED —
Awaiting manual verification**.

## 11. Submission/review/public workflow

**VERIFIED — Real browser testing passed:** Officer creates an official public
species in the temporary DB and uploads a photo; an isolated Botanist submits a
plant through the real API and associates an observation photo; public requests
cannot see the unapproved plant/photo; Officer approves through the review UI;
public API shows the approved plant; Explore Plants renders the species/photo and
opens its detail page. Officer CSV and PDF downloads contain the expected test
report/valid PDF bytes.

**VERIFIED — Automated testing passed:** rejection/correction states, ownership,
revision conflicts, retry idempotency, and protected detail/search/image/QR/report
restrictions. Existing publication semantics are preserved: an Officer's official
species may be public immediately, while Botanist plant observations need review.

For genuine manual entry:

1. Sign in with your existing Officer account; open Conservation > Plant Species.
2. Supply verified scientific/common names and a description. Add habitat/cultural
   text only if verified. Conservation status is an optional verified name, not
   a guessed ID; leave it blank until sourced if unknown.
3. Choose Public only when publication is appropriate. Scientific staff/internal
   excludes Visitors/Guests; Protected remains Officer-only.
4. Save, click Edit for that row, then attach an official JPEG/PNG or PDF.
5. Location is a plant-record/observation attribute, not a species attribute. An
   existing active Botanist records actual latitude/longitude/accuracy and plant
   measurements in the mobile collection form, attaches field images and submits.
6. Officer reviews the observation and either approves or requests corrections
   with feedback. Check public views after approval. Sensitive coordinates remain
   excluded from public responses.

Do not publish or invent real species merely to populate the empty catalogue.

## 12. EmailJS activation

Token and delivery-adapter logic is **VERIFIED — Automated testing passed**.
Service ID/public key presence was confirmed without printing them. No activation
template ID was found in the checked project configuration.

**BLOCKED — Missing external configuration:** `EMAILJS_ACTIVATION_TEMPLATE_ID` and
controlled-inbox delivery verification. No email was sent; even after valid
configuration, sending a real test requires explicit approval and a test inbox.

In the existing [EmailJS dashboard](https://dashboard.emailjs.com/), open Email
Templates > Create New Template. Set To Email to `{{to_email}}`; use a subject such
as `Activate your Niah Biodiversity account`. Suitable content:

```html
<p>Hello {{to_name}},</p>
<p>Your {{role}} account has been invited to Niah Biodiversity.</p>
<p><a href="{{activation_link}}">Activate your account</a></p>
<p>This link expires after 24 hours and can be used only once.</p>
<p>If this invitation was unexpected, contact your system administrator.</p>
```

Save, copy its real template ID, and put it in private `web/.env.server`. Keep
service/private keys server-side; configure any required EmailJS server-request
permissions. Set the exact HTTPS APP_ORIGIN for deployment, restart authentication,
then request a controlled-inbox test. See [EmailJS send API](https://www.emailjs.com/docs/rest-api/send/).

## 13. Mobile readiness and HTTPS reachability

**VERIFIED — Automated testing passed:** API contracts, login/logout lifecycle,
owner checks, encrypted-draft engine, offline lease/expiry/clock rollback,
interrupted uploads/corrections and duplicate prevention. Lint, types and Android
export pass. **IMPLEMENTED — Awaiting manual verification:** native AES/SecureStore,
local device unlock and storage-full behavior. Existing native code is not proven
by Node tests or an Android bundle.

Unauthenticated HTTPS probes to both configured plant and face origins returned
**302 to github.dev**. A phone's API fetch cannot treat that HTML login flow as
application JSON. **BLOCKED — Missing external configuration** for reachable native
API origins; **BLOCKED — User approval required** for any visibility/access change.
No ports were made public. Secure choices are an approved HTTPS staging deployment
or a deliberately reviewed temporary tunnel/forwarding configuration. Preserve
application authentication, device credentials, request limits and HMAC boundaries.

Phone checklist: deny/approve camera and GPS; cancel capture; capture/upload a real
JPEG/PNG; save encrypted drafts; disconnect; terminate/reopen and unlock within the
15-minute lease; verify expiry locks private forms; reconnect after account
revocation; retry partial uploads; fill storage; verify prior drafts survive and
another account cannot open them. Native-device results remain **BLOCKED — Physical
hardware required**. Immediate revocation cannot be discovered while disconnected;
offline draft access is explicitly bounded and never authorizes server requests.

## 14. Face recognition

**VERIFIED — Automated testing passed:** repaired Python 3.11 environment and pip
consistency; real SFace, Fasnet and OpenCV readiness; actual blank-image rejection;
isolated signed Node/Python account integration, enrollment/recognition error
handling and liveness flags. Positive workflow tests inject a matcher unless an
authorized portrait fixture is explicitly supplied.

Seven portrait tests remain skipped because FACE_TEST_PORTRAIT,
FACE_TEST_SECOND_PORTRAIT and/or FACE_TEST_NEGATIVE_PORTRAIT were not supplied.
Existing enrolled biometric data was not repurposed as a test fixture.

**BLOCKED — Physical hardware required:** consented enrollment, same-person live
matching, different-person rejection, presentation attacks and camera denial. Use
controlled participants/fixtures and keep their data private; do not lower
thresholds or disable anti-spoofing to obtain a passing test.

## 15. IoT readiness

**VERIFIED — Automated testing passed:** device keys, valid/invalid payloads,
SQLite association, UTC timestamps, idempotent client keys, alert generation,
Officer response restrictions and serial parsing. Simulated data stays isolated.

Expected request: `POST /api/device/readings` with a private `Authorization: Device`
credential and JSON containing `device_id`, optional stable `client_key`, and
`values`. Reuse a key only for an identical retry; changed payloads return 409.
Temperature is Celsius, humidity percent, movement 0/1; soilMoisture, rainfall and
sound are raw ADC readings until calibrated. Alert thresholds retain upper-bound
semantics. Server timestamps use UTC.

**BLOCKED — Physical hardware required:** register a real device as Administrator,
store its key privately, verify firmware framing/wiring, compare readings with
references, retry/drop connections and verify alert/Officer response. The existing
serial bridge is not a durable disconnected gateway spool. Native mobile has no
new dedicated sensor dashboard; existing device monitoring is in Admin/Officer
website views. Device display/calibration remains pending hardware evidence.

## 16. Protected species and authorization

**VERIFIED — Automated testing passed:** Guest, Visitor, Botanist, Officer and
Administrator checks cover detail, search, images, QR and reports; unauthorized
responses do not expose protected records. Browser route guards and backend checks
both operate. `shared/rbac.cjs` and current eligibility are unchanged.

No policy decision is needed to retain Officer-only access. Any later Botanist
extension is **BLOCKED — User approval required**, outside this verification.

## 17. Dependency advisory analysis

Website and plant-backend audits: **VERIFIED — Automated testing passed**, zero
reported advisories. This is audit evidence, not proof that no vulnerabilities exist.

Mobile: **FAILED — Needs further repair**, 8 affected-package entries, representing
three underlying advisory chains (not eight distinct exploits):

| Package entry | Severity | Exposure/path assessment |
|---|---|---|
| decode-uri-component | Moderate | Router URL parsing; potentially reachable by malformed deep links |
| query-string | Moderate | Runtime navigation parser depending on affected decoder |
| expo-router | Moderate | Propagated runtime dependency finding |
| node-forge | High | CLI/code-signing tools; affected RSA verification, not this app's password hashing |
| @expo/code-signing-certificates | High | Tooling chain through node-forge |
| zod | High | Expo CLI validation path using v3; oversized untrusted collections are the advisory condition |
| @expo/cli | High | Propagated tooling findings |
| expo | High | Top-level SDK includes affected tooling; does not mean every SDK API is directly exploitable |

Tooling paths are still installed under dependencies, so they are not automatically
removed by `--omit=dev`. Source imports confirm query-string in router navigation
and node-forge in Expo CLI iOS signing. No exploit was run against production.

The installed decoder's compatible range excludes the patched release; Zod's
reported patched release requires moving this CLI dependency from v3 to v4. The
latest node-forge checked was 1.4.0 and remains affected. `npm audit fix` without
force did not clear the findings. npm proposes SDK-breaking changes (including an
Expo downgrade); none was applied. Forced transitive overrides were not used to
hide compatibility risk. Keep development servers private and review an upstream
compatible patch or a separately approved SDK migration before production.

Primary advisory details: [decoder DoS](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr),
[RSA verification](https://github.com/advisories/GHSA-86w9-cpqp-85rv),
[Zod memory exhaustion](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
Exact npm evidence is in [final-dependency-audit.json](final-dependency-audit.json).

## 18. Backup, restore and preservation

**VERIFIED — Automated testing passed:** `npm run backup-system` creates a NEW
mode-700 backup directory, uses SQLite online backup for plant/authentication/face
DBs, includes available private service/recovery keys, checks integrity/foreign
keys, restores copies into temporary files and compares table counts. A verified
manifest records counts and archive hashes. Existing destinations are never
replaced. An isolated regression tests non-overwrite and unchanged source bytes.

A verified backup and private downloadable ZIP were created:

`plant-conservation-backend/backups/system-1792837134488/`

`plant-conservation-backend/backups/system-1792837134488.zip`

The ZIP contains private account and biometric information and service keys. Keep
it in private encrypted storage; it is not a public shareable artifact. Existing
older backups were retained. Three staff rows, two Visitor rows, one legacy face
account and one real-face-template row compare unchanged; links remain unchanged.
The live plant database remains empty. All three database files are now mode 600.

To download: in VS Code Explorer expand plant-conservation-backend > backups,
right-click the ZIP and choose Download (or use the Codespaces browser file-download
action). Save it outside the Codespace, confirm the file downloaded, and store it
privately. No external transfer was performed automatically. Static image/source
files are not included in the database-only archive; keep the repository and any
untracked local images separately. Uploaded DB image blobs are included.

For future backups run `npm run backup-system` in the backend. After extraction,
check manifest hashes and restore only to NEW paths, with services stopped during
the actual switch. Never overwrite the live databases as a test. Configure both
Node services to use the same restored authentication DB and restore the matching
keys privately. Detailed plant-only recovery is retained in
[SQLite plant storage](sqlite-plant-storage.md). Multi-DB backups are individual
consistent snapshots, not a distributed atomic transaction; quiesce account/plant
writes for a coordinated production recovery point.

## 19. Live operation and account checks

Existing account credentials were unavailable for genuine-account browser testing;
no passwords were guessed or reset. The current account rows and enrollment rows
were compared read-only to verified snapshots. Real-account manual login remains
**IMPLEMENTED — Awaiting manual verification** even though role fixtures passed.

Development startup remains three Node/Vite terminals plus the optional face
launcher described in the earlier repair report. NODE_ENV=production now requires
explicit APP_ORIGIN; production storage must be persistent and outside disposable
release folders. Auth and plant databases remain separate, and both Node services
must refer to the same absolute authentication path. Mount the existing Python
face data directory persistently as well. Never expose `/internal/face/*` through
an internet proxy; keep the signed account adapter on loopback.

## 20. Deployment readiness and remaining actions

Overall: **BLOCKED — Missing external configuration**, with unresolved dependency
findings and native-device checks. No production deployment or public access
change was performed.

Before approval for deployment:

1. Choose a host, domain, HTTPS termination, service supervision and persistent
   disk layout. Set exact HTTPS origins; preserve secure cookies and RBAC.
2. Configure the EmailJS activation template, provide a controlled inbox, and
   approve one real delivery test. Confirm activation and single-use behavior.
3. Choose approved phone-reachable API origins; private Codespaces redirects are
   currently a demonstrated blocker. Any port visibility change needs approval.
4. Resolve or formally review the mobile advisory chains through compatible
   upstream patches or a separately approved SDK migration and regression run.
5. Test genuine existing accounts manually; enter only verified real species.
6. Execute Android/iOS native storage, unlock, offline, camera and GPS checks.
7. Supply consented portrait fixtures/live participants and test real recognition,
   incorrect-person rejection and liveness without weakening security.
8. Connect and calibrate physical sensors, then verify dropout/retry/alert behavior.
9. Download verified backups, practice a coordinated restore on a separate host,
   and set a backup schedule. Codespace deletion can erase local DBs and backups.
10. Configure reverse-proxy request limits/rate limiting, private logs and model
    resource limits; review HTTPS/CORS with the actual deployment topology.

No real browser or physical-device results are inferred from a build or a mock.
The remaining external/manual checks are explicitly pending, not counted as passed.

### Final live-service evidence after restart

A separate read-only Chromium probe of the actual running Vite site at
`http://127.0.0.1:5173/species` confirmed the empty-state heading, zero error banners
and zero uncaught browser errors. Live proxied species and plant APIs returned
HTTP 200 with empty arrays. Authentication returned the expected HTTP 401 without
a session. Face `/health` returned HTTP 200 with `ready: true` and authoritative
account mode. This probe is additional operational evidence, not an extra test
added to the distinct-test total.

After restart, read-only comparisons still found exactly three unchanged staff
rows, two unchanged Visitor rows, one unchanged face account, one unchanged
real-face-template row and zero links. Authentication and face database files were
both mode 600. Integrity checks passed and the live plant database remained empty.

Final execution logs are retained locally under `/tmp/niah-final2-*` and
`/tmp/niah-browser-verification.log`; they are development-session artifacts, not
persistent backups. Permanent reproducible evidence is in
`web/tests/browser/system.spec.mjs`, backend `test/`, web `server/*.test.mjs`,
mobile `scripts/*test.mjs` and Python `face_backend/test_*.py`.

## 21. Latest continuation — environment-aware mobile APIs

This section supersedes earlier test totals and describes the latest safe repairs.
The earlier verification evidence is retained as history. No exposure change,
real email, real-user enrollment, production record edit or deployment occurred.
The existing 15-minute offline lease/device unlock and Officer-only protected
species policy were not changed.

### Issues fixed and classifications

| Issue | Current classification | Latest evidence / remaining boundary |
|---|---|---|
| Authentication and RBAC | FIXED AND VERIFIED | Isolated login/logout, session expiry, ownership, Officer review and protected-data tests pass; genuine-account manual login remains pending |
| API environment selection | FIXED AND VERIFIED | Separate development/production settings; release cannot silently use development URLs; HTTPS and credential-free origins validated |
| Unclear mobile sign-in/JSON failures | FIXED AND VERIFIED | Token-free health preflight identifies redirect, HTML, wrong service, unavailable service and timeout before authenticated calls |
| Image URL mismatch | FIXED AND VERIFIED | Images now use the same selected environment/health guard as API calls and show load/access errors |
| Actual phone API access | IMPLEMENTED — EXTERNAL CONFIGURATION REQUIRED | Configured private Codespaces URLs still return sign-in HTML; no GitHub bypass or public forwarding applied |
| Access/hosting change | BLOCKED — USER APPROVAL REQUIRED | Choose an approved HTTPS staging or OS-level VPN/tunnel arrangement before any visibility change |
| Activation software | FIXED AND VERIFIED | Existing expiry, resend, invalid/reused-token rejection and delivery-failure tests pass; template specification provided |
| Actual activation email | IMPLEMENTED — EXTERNAL CONFIGURATION REQUIRED | Real template ID remains absent; controlled inbox and sending approval still required |
| Camera/GPS/encrypted native storage | IMPLEMENTED — DEVICE TEST REQUIRED | Build/lint/types and injected tests pass; no physical phone used |
| Offline draft/reconnection software | FIXED AND VERIFIED | Original lease unchanged; retries, owner checks, storage-full, corruption and partial corrections still pass |
| Face model/software checks | FIXED AND VERIFIED | Python environment consistent; real models and generated blank rejection pass; isolated account workflows pass |
| Genuine recognition/liveness evidence | BLOCKED — PHYSICAL HARDWARE REQUIRED | Seven controlled portrait checks remain skipped; no enrolled biometric data used as fixtures |
| IoT SQLite/auth/dedup/alerts software | FIXED AND VERIFIED | Simulated API and serial tests pass; no fake live readings inserted |
| Physical sensors | BLOCKED — PHYSICAL HARDWARE REQUIRED | No attached USB sensors detected; calibration/wiring/connectivity still require devices |
| Genuine account login | IMPLEMENTED — DEVICE TEST REQUIRED | Isolated browser accounts pass; actual passwords not requested, printed or reset |
| Mobile dependency advisories | FAILED — FURTHER INVESTIGATION REQUIRED | 8 entries remain (3 moderate, 5 high); no safe in-range fix found, no forced SDK upgrade |
| Plant/auth backup and isolated restoration | FIXED AND VERIFIED | New explicit non-biometric backup mode tested and used; previous backups retained |
| Deployment | IMPLEMENTED — EXTERNAL CONFIGURATION REQUIRED | Not deployed; hosting, persistence, approved HTTPS origins, email, advisories and physical verification remain blockers |

“Device test required” for genuine account login means an interactive check by the
account owner; actual web-account login can be done in a normal browser. It is not
counted as completed merely because isolated role accounts passed.

### Configuration and transport repairs

`mobileapp/utils/apiConfiguration.js` is the central public URL selector. Existing
single URL variables remain development fallbacks. Explicit `_DEVELOPMENT` values
take priority. Production requires `_PRODUCTION` values and rejects local and
Codespaces origins, credentials, query strings and fragments. Face URLs may use
an approved prefix; plant URLs remain origins. `eas.json` preview/production
profiles choose the corresponding environment without inventing hosts.

The face client's saved-session backend binding and both JSON/media requests now
use the same selection. Existing development settings continue to work as before.
Configuration failure is shown to the user, not replaced by a guessed endpoint.

Before authenticated requests, the clients perform a credential-free JSON health
check. Plant `/health` returns a constant service name and readiness after SELECT 1;
it exposes no tables or records. Face readiness must identify the authoritative
service. Successful preflights are cached per URL for only 10 seconds and never
authorize requests. Failures retry; they do not mint tokens or extend offline
leases. Backend session validation and RBAC still run on real requests.

No user password or bearer token is sent with the preflight. Redirects, opaque
redirects, sign-in HTML and nonmatching service identities are rejected. Native
fetch/image redirect behavior still needs phone evidence; the code does not claim
that a Node test proves every native networking detail.

Use `npm run check:connectivity` from mobileapp for safe diagnostics. It prints
service labels/error codes without passwords, bearer tokens or response bodies.
On the current private URLs it reports `API_NOT_JSON` with a private-forwarding
explanation. That nonzero result is a known access/configuration block, not a
failed unit test or permission to disable GitHub protection.

Detailed settings: [mobile-api-configuration.md](mobile-api-configuration.md).
Email specification: [emailjs-activation-template.md](emailjs-activation-template.md).

### Current verification results

| Suite | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Backend SQLite/RBAC/IoT/backup | 10 | 0 | 0 |
| Web authentication/activation/origin/response | 22 | 0 | 0 |
| Chromium browser role/workflow scenarios | 6 | 0 | 0 |
| Mobile, including four new connectivity tests | 47 | 0 | 0 |
| Python with real-model blank-image check | 44 | 0 | 7 |
| Serial parser | 3 | 0 | 0 |
| **Distinct test total** | **132** | **0** | **7** |

Website production build and browser scenarios pass. Mobile lint/type checking
and Android Expo export pass. SQLite integrity and foreign keys pass; the plant
DB still contains zero species and zero plants. The updated backup exclusion
behavior was additionally rerun as a subset (not counted twice). Current logs are
`/tmp/niah-continuation-*`; source tests and commands remain the reproducible proof.
The operational private-URL probe remains blocked, separately from unit results.

The seven Python skips still require authorized FACE_TEST_PORTRAIT,
FACE_TEST_SECOND_PORTRAIT and/or FACE_TEST_NEGATIVE_PORTRAIT fixtures. No portraits
were invented and no existing enrolled image/embedding was repurposed. Python
package consistency passed; file permission metadata remains owner-only.

### Current backup scope and account preservation

The latest request requires approval before accessing real biometric data. A new
`--without-biometrics` backup option explicitly skips the face DB and its account
service key. Its exclusion and non-overwrite behavior were tested with isolated
synthetic files. The previous full backups were retained, not read or deleted.

This run's verified plant/authentication backup and archive are:

`plant-conservation-backend/backups/system-1792847493490/`

`plant-conservation-backend/backups/system-1792847493490.zip`

Both database restoration checks use separate temporary files. No live database
was overwritten. Three staff and two Visitor rows compare unchanged to the new
private snapshot; no credentials/hashes are printed. Face file permissions were
checked without inspecting enrolled biometric content. Normal face-service startup
and health checks do not constitute consent to use enrolled data as test fixtures.

Reproduce this scope with:

```bash
# From plant-conservation-backend
npm run backup-system -- --without-biometrics
```

Download the private ZIP from VS Code Explorer > backend > backups > right-click
file > Download, and store it privately outside the Codespace. It contains account
information and recovery material; do not publish it. Face recovery needs a
separately approved biometric backup or an already authorized earlier backup.
Codespace deletion can erase local databases and local backups.

### Latest modified files

- `mobileapp/utils/apiConfiguration.js`: selector, HTTPS validation, diagnostic
  errors and token-free per-origin health guard.
- `mobileapp/utils/faceApi.js`, `faceSession.js`, `plantApi.js`: selected URLs,
  consistent session binding, guarded requests and redirect diagnostics.
- `mobileapp/screens/PersistentKnowledge.js`: environment-aware image loading and
  meaningful image failures.
- `mobileapp/.env.example`, private `.env.local`, `eas.json`: explicit environments
  and approved-host placeholders; existing URLs retained as development fallbacks.
- `mobileapp/scripts/check-api-connectivity.mjs`, `api-connectivity.test.mjs`,
  `face-api.test.mjs`, `face-capture-flow.test.mjs`, `package.json`: diagnostics,
  actual pure-module imports and regression tests.
- `plant-conservation-backend/server.js`, `test/business.test.cjs`: safe readiness
  endpoint and real SQLite health assertion.
- `plant-conservation-backend/scripts/backup-system.cjs`, `test/backup-system.test.cjs`:
  explicit non-biometric backup scope and verified exclusion.
- `mobileapp/package-lock.json`: result of the nonbreaking audit attempt; findings
  remain documented rather than suppressed.
- `docs/final-system-verification.md`, `final-dependency-audit.json`,
  `mobile-api-configuration.md`, `emailjs-activation-template.md`,
  `sqlite-plant-storage.md`, `README.md`: current evidence and setup instructions.

### IoT/device and notification boundaries

Authenticated ingestion, UTC timestamps, device associations, same-key retries,
changed-payload conflicts, threshold alerts and Officer responses remain verified
with isolated simulated data. See section 15 for exact payload/units. Real device
connection still needs a registered device ID, its private provisioning key, an
approved HTTPS plant origin, matching firmware output and calibrated thresholds.
No live sensor values were synthesized.

Monitoring is implemented in Admin/Officer website views. Current mobile roles do
not gain IoT permissions or a new sensor dashboard. The system stores/displays
alerts; no external push/email/SMS notification provider is configured or verified.
Adding notification delivery needs a chosen channel/audience and approval before
sending messages. It must not be described as tested physical alarms.

### Remaining user participation

1. Create/retrieve the real EmailJS activation template ID using the supplied
   specification; put it in server-only configuration. Provide an authorized inbox
   and approve any real test email.
2. Choose an approved phone-reachable HTTPS API topology. A secured staging host or
   an approved device VPN is preferable to embedding GitHub credentials. Any
   visibility change or deployment needs explicit approval; none was performed.
3. Run genuine account login on your browser/phone without sharing passwords here.
4. Supply consented test fixtures/participants for positive face/liveness testing;
   attach physical phones/sensors for camera/GPS/storage/calibration checks.
5. Review compatible upstream dependency patches or approve a separately tested
   SDK migration; eight audit entries are still open, not magically fixed.
6. Download the verified private backup outside the Codespace and choose persistent
   storage/HTTPS supervision before production. The system remains not production-ready.

### Latest live recheck

After restarting session-bound development processes, Chromium confirmed the live
Explore Plants page shows its empty state with zero error banners and zero uncaught
errors. Plant `/health` returned HTTP 200 with the expected ready identity; auth
without a session returned HTTP 401; face `/health` returned HTTP 200, ready and
authoritative. SQLite integrity/foreign keys passed and record counts stayed zero.
A broader scan of safe configuration/source files found no additional non-placeholder
activation-template candidate. No real activation email was sent.

## 22. Master RBAC security audit — current results

This section supersedes earlier totals and unresolved software findings in this document. The full permission matrix, API coverage, website/mobile authorization analysis and remaining privacy limits are in [rbac-complete-audit.md](rbac-complete-audit.md). Existing role definitions, Officer-only protected-species policy, accounts, enrollments, images, backups and live plant/IoT data were preserved.

### Issues found, causes and repairs

**FIXED AND VERIFIED:** eight concrete software findings were repaired:

1. Private observation images checked the parent plant registrant instead of the asset uploader. Downloads now allow the uploader or Officer until publication; unrelated plant owners cannot read another Botanist's private image.
2. Owner QR lookup omitted the current species visibility check. It now denies access after protected reclassification without changing its JSON shape.
3. An observation submit retry returned before checking current classification. The visibility check now runs before the idempotent return.
4. Upload retries checked only plant/species binding and returned before classification. They now also bind the observation and recheck current visibility, preserving valid exact retries.
5. Invalid upload bodies could raise a TypeError and misleading 503 database error. JSON mutations now require object bodies and the correct content type; parse errors do not echo request content.
6. A device-unlock prompt could finish after a 15-minute offline lease expired. Time/session checks now run again after unlock; unlock reuse is token-bound. Logout cancels restoration. The lease duration/device authentication remain unchanged.
7. Draft reads authorized before asynchronous decryption only. They now reauthorize before returning private rows, refusing account changes without deleting or rewriting storage.
8. Starting a second plant backend on an occupied port tried to read `server.address().port` when the address was null. Startup now waits for listening and closes its DB handles on failure; a subprocess regression checks safe failure.

Four HTTP regression cases first failed against the pre-fix implementation and passed after repair. Two mobile regression cases cover delayed unlock/expiry/logout and an account change during decryption. An additional startup regression and expanded denied-role matrix cover the remaining changes. A first draft of the new cancellation test exposed an inconsistent cancellation return; restoration now returns null after logout, matching existing cancellation semantics, and the final suite passes.

Expo compatibility verification also found `expo-location@57.0.20` behind the recommended SDK 57 patch. Installed the compatible `~57.0.22` version through `npx expo install expo-location`; no forced SDK upgrade or native API redesign. The [SDK 57 Location documentation](https://docs.expo.dev/versions/v57.0.0/sdk/location/) lists this version and installation method.

### Files modified in this audit

| Files | Change |
|---|---|
| `plant-conservation-backend/domain.cjs` | QR and submission retry classification checks. |
| `plant-conservation-backend/uploads.cjs` | Correct private ownership and retry authorization/binding. |
| `plant-conservation-backend/server.js` | JSON validation/redacted parse errors and safe startup failure. |
| `plant-conservation-backend/test/security-audit.test.cjs` (new) | Five isolated HTTP/startup security regression cases. |
| `plant-conservation-backend/test/rbac.test.cjs` | Broader denied-route matrix, unknown-role and mandatory-password checks. |
| `mobileapp/utils/faceSessionLifecycle.js` | Post-unlock expiry/generation checks, token-bound unlock and logout cancellation. |
| `mobileapp/utils/offlineDraftStore.js` | Reauthorize after storage/decryption. |
| `mobileapp/scripts/offline-recovery.test.mjs` | Two asynchronous security regression cases. |
| `mobileapp/package.json`, `mobileapp/package-lock.json` | SDK-compatible location patch. |
| `docs/rbac-complete-audit.md` (new) | Source-derived matrix, enforcement audit, fixes and residual risks. |
| `docs/final-system-verification.md` | This current report. |
| `docs/final-dependency-audit.json` | Refreshed registry audit for all three JS packages. |
| `docs/sqlite-plant-storage.md` | Correct outdated offline/model/policy limitations; link current evidence. |

Other modified/untracked files in the workspace predate this audit. They were not reset or attributed as newly created here. Private generated output includes the new backup below; Android export output is outside the repository in `/tmp`.

### Final automated results

| Suite | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Plant SQLite/RBAC/workflows/IoT/backups/security/startup | 15 | 0 | 0 |
| Website authentication/activation/recovery/origin/API response | 22 | 0 | 0 |
| Chromium role/workflow scenarios | 6 | 0 | 0 |
| Mobile authorization/connectivity/offline/sync | 49 | 0 | 0 |
| Python face service, including real-model blank-image rejection | 44 | 0 | 7 |
| IoT serial parser | 3 | 0 | 0 |
| **Distinct test total** | **139** | **0** | **7** |

Additional successful checks: website production build/type checking, mobile lint, TypeScript checking, final `expo install --check` and Android export; plant/authentication SQLite integrity and foreign keys; private backup restore and account comparison. These checks are not counted as extra tests. Final Android export: `/tmp/niah-rbac-android-final`. Logs: `/tmp/niah-audit-*`; ephemeral logs are supporting evidence, while checked-in source tests/commands are reproducible.

Commands used, from the respective directories:

```bash
# plant-conservation-backend
npm test
npm run check-db
node scripts/backup-system.cjs --without-biometrics
npm audit --json

# web
node --test --test-isolation=none server/*.test.mjs tests/*.test.mjs
npm run test:browser
npm audit --json

# mobileapp
node --test --test-isolation=none scripts/*test.mjs
npm run lint
npm run type-check
npx expo install --check
npx expo export --platform android --output-dir /tmp/niah-rbac-android-final
npm audit --json
npm run check:connectivity

# mobileapp/face_backend
FACE_TEST_REAL_MODELS=1 .venv/bin/python -m unittest discover -p 'test_*.py'

# workspace root
python3 -m unittest discover -s IoT/PlantPrototype -p 'test_*.py'
```

`check:connectivity` intentionally exits nonzero on current private phone URLs: both report `API_ACCESS_REDIRECT`. This operational diagnostic remains unsuccessful and is separate from the zero failed automated tests. Early reproduction runs failed as expected; the final runs above passed. A separate read-only browser probe initially matched both homepage/footer links; selecting the homepage link completed that live check. No application change was needed for that probe.

Seven Python portrait-dependent tests are **skipped**, not passed. Required authorized fixtures remain `FACE_TEST_PORTRAIT`, `FACE_TEST_SECOND_PORTRAIT` and/or `FACE_TEST_NEGATIVE_PORTRAIT`. Tests did not read live face enrollments. Physical phone/sensor tests, real email delivery, positive recognition/liveness with consented people and production deployment were **not executed**.

### Current component status

| Area | Classification | Evidence / remaining work |
|---|---|---|
| Website/local backend | **FIXED AND VERIFIED** | Live Vite proxy returns HTTP 200 with empty species/plants. Chromium clicks Explore Plants, sees “No species added yet”, no old database/JSON banner and no uncaught JS error. Repaired plant API restarted on unchanged loopback port 3000; existing auth/Vite services retained. |
| SQLite / PostgreSQL removal | **FIXED AND VERIFIED** | Separate persistent SQLite DBs; both integrity checks `ok`, no FK violations; zero species/plants; no Supabase/PG runtime needed or contacted. |
| RBAC | **FIXED AND VERIFIED** | Shared grants unchanged; server-side gates/object checks, default deny, role/status revocation, Officer-only protected records, no self-review; expanded tests pass. Deployment/privacy limits remain in the full audit. |
| Botanist workflow | **AUTOMATED TESTS PASSED — REAL-WORLD VERIFICATION PENDING** | Own drafts/edit/upload/submit/retry and Officer review integration pass with isolated records; physical collection still pending. |
| Officer workflow | **AUTOMATED TESTS PASSED — REAL-WORLD VERIFICATION PENDING** | Species/review/correction/publication/maps/reports/IoT response roles tested; genuine operational approval/content review pending. |
| Administrator workflow | **AUTOMATED TESTS PASSED — REAL-WORLD VERIFICATION PENDING** | Login/reload/guards/logout, account/security/device controls tested; no implicit plant privileges. Genuine account manual acceptance remains pending. |
| Visitor workflow | **AUTOMATED TESTS PASSED — REAL-WORLD VERIFICATION PENDING** | Public-only knowledge, persistent identity/revocation and website mobile guidance tested; physical app acceptance pending. |
| EmailJS | **CONFIGURATION REQUIRED** | Actual server activation template setting remains empty; software token/expiry/reuse/resend/provider handling passes injected tests. No real email sent. |
| Mobile HTTPS reachability | **CONFIGURATION REQUIRED** | Both configured private Codespaces health URLs redirect to sign-in; choose approved staging/private VPN reachability. No public forwarding or GitHub-auth bypass. |
| Offline recovery | **AUTOMATED TESTS PASSED — REAL-WORLD VERIFICATION PENDING** | 15-minute Botanist-only lease, device unlock, encryption, async ownership, disk-full retention and safe sync tested. Native SecureStore/cold start/device clock behavior pending. Legacy plaintext arrays require a device migration plan. |
| Face recognition | **AUTOMATED TESTS PASSED — REAL-WORLD VERIFICATION PENDING** | Python 3.11/model/negative inference and service/session tests pass; seven consented portrait tests skipped; no real-person accuracy/liveness claim. |
| Camera/GPS/native storage | **PHYSICAL DEVICE TEST REQUIRED** | Compatible location patch, lint/types/export pass; native permissions/capture/restart/full-storage behavior unverified on phone. |
| IoT hardware | **PHYSICAL DEVICE TEST REQUIRED** | Isolated ingestion/auth/limits/retries/alert/response and serial tests pass. Calibration, power/network recovery and actual sensor delivery pending; external notification transport not configured. |
| Dependencies | **FAILED — FURTHER REPAIR REQUIRED** | Web/backend audits zero; eight mobile affected packages remain after nonbreaking repair attempts. SDK compatibility and Android build pass; advisories require maintained compatible upstream fixes or a separately planned SDK migration. |
| Backup/local restore | **FIXED AND VERIFIED** | New non-biometric recovery set restored into isolated files; no live DB overwritten. Off-Codespace retention/production persistence still require configuration. |
| Protected-species policy | **FIXED AND VERIFIED** | Officer-only rule retained. No new policy decision required unless the user later requests a different eligibility model. |
| Production hosting | **CONFIGURATION REQUIRED** | No deployment, exposure, real delivery or hardware approval performed; see next actions. |

### Dependency advisory detail

Current `npm audit` results are captured in [final-dependency-audit.json](final-dependency-audit.json). Eight affected packages arise from three underlying advisory roots, not eight unrelated root vulnerabilities:

| Package | Audit severity | Inspected path / impact | Compatible remediation status |
|---|---|---|---|
| `decode-uri-component` | Moderate | Runtime malformed percent-decoding denial of service via query-string/router. | Installed router path still uses affected decoder; no compatible audit repair. |
| `query-string` | Moderate | Runtime transitive decoder exposure. | Router dependency chain requires upstream compatible release. |
| `expo-router` | Moderate | Runtime parent of that chain. | Audit suggests breaking Router 58; not forced into SDK 57. |
| `node-forge` | High | RSA PKCS#1 v1.5 signature verification issue through signing/CLI tooling. | Inspected graph lacks a nonbreaking audit repair; do not assume all app runtime auth uses this package. |
| `@expo/code-signing-certificates` | High | Tooling dependency on node-forge. | Upstream compatible remediation required. |
| `@expo/cli` | High | Development/build/signing and validation paths, including forge/zod. | Audit's major Expo replacement is not an approved compatible fix. |
| `expo` | High | Parent package inherits CLI advisory severity in npm graph. | No forced SDK downgrade/upgrade. |
| `zod` | High | CLI dependency; oversized constrained collection memory exhaustion. | Advisory fix is Zod 4.6.6+, incompatible with inspected Zod 3 consumer range. |

Advisories: [decoder DoS](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr), [forge signature verification](https://github.com/advisories/GHSA-86w9-cpqp-85rv), [Zod memory exhaustion](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). Runtime/tooling assessment is based on installed dependency paths; a complete application exploitability analysis was not performed. `npm audit fix --ignore-scripts --no-fund` was attempted without `--force`; advisories remain. The compatible location patch is a separate compatibility repair, not a claim to resolve these advisories. Re-run audits at release time and resolve/review them before production.

### Backup and preservation evidence

New verified recovery directory:

`plant-conservation-backend/backups/system-1792849181433/`

Contains plant/authentication snapshots, matching recovery key and verified manifest. Face database and face service key were explicitly excluded. A separate temporary restore passed integrity/FK/count comparisons. All three staff and two Visitor account rows compare unchanged with the snapshot, without printing credentials or hashes. Plant records remain empty. Existing media files, prototype records and older backups were retained. Face storage was checked by file permissions only: directory 700, database/key 600; no enrolled templates were read. Backup directory is 700 and files 600.

This backup contains sensitive account material; keep it private. Download it to independent private storage outside the Codespace. A Codespace deletion can destroy databases and every local backup together. Restore to **new filenames**, stop affected writers, preserve originals/sidecars, verify integrity/counts, then update the configured path and restart. Do not copy a running main SQLite file alone or delete WAL files. See [SQLite backup/restore instructions](sqlite-plant-storage.md).

### Exact next actions requiring participation

1. **Activation:** in the existing EmailJS account, create/retrieve an activation template using [the documented exact variables](emailjs-activation-template.md); put its real ID in ignored `web/.env.server` as `EMAILJS_ACTIVATION_TEMPLATE_ID`. Verify service/public/private-key requirements server-side. Restart auth. Then authorize a controlled inbox test; check receipt, correct HTTPS origin, successful activation, reuse denial and resend invalidation. Do not paste secrets or activation links into chat.
2. **Phone reachability:** choose an approved HTTPS staging host with persistent storage/private adapter, or an approved private VPN arrangement. Provide the intended origins for review before deployment/exposure. Set the matching development or production URL variables in [mobile API configuration](mobile-api-configuration.md), rebuild/reload and run `npm run check:connectivity`; both services must report ready JSON without GitHub redirects. Do not make ports public as an automatic workaround.
3. **Native acceptance:** on an authorized test phone verify denied/allowed camera and GPS, actual photos and local image recovery, account-bound login/logout, draft restart with device unlock, expiry after 15 minutes, storage-full preservation, partial sync/retry and images on the approved HTTPS hosts. Confirm forbidden roles/protected records stay denied after reconnect/revocation.
4. **Consented face evidence:** arrange authorized portrait fixtures/people; run the seven skipped cases, genuine enrollment, same-person acceptance, different-person rejection and liveness/printed or replayed image rejection. No accuracy claim until these pass. Never repurpose existing enrollments without consent.
5. **IoT:** connect approved sensors/serial bridge and registered test device; verify actual units/calibration, duplicate/network/power recovery, SQLite persistence, thresholds, alerts and Officer response. Define any required external notification channel separately; current alerts are in-app/persisted.
6. **Release prerequisites:** plan compatible advisory remediation; choose actual production website/API origins, TLS/private adapter routing, secret storage, persistent disk, off-Codespace backup destination and monitoring/retention. Review proxy rate limiting and legacy device drafts. Perform genuine role-based acceptance with authorized accounts. Deployment/exposure remains a later explicit approval step.

No further password reset, pgAdmin installation, Supabase login or PostgreSQL setup is required for the current local SQLite website.

## 23. Priority resolution of six external and software blockers

Latest run: **149 tests passed, zero failed, six skipped**, plus a separate passing private-gateway harness. The full RBAC audit was not repeated; existing authorization regression cases were rerun. [Remaining blockers resolution](remaining-blockers-resolution.md) provides the required issue/root-cause/source/change/test/evidence/external-action/deployment table and per-package advisory analysis. [Manual testing checklist](final-manual-testing-checklist.md) provides exact provider, phone, fixture and hardware actions. Previous “pending” statements should be interpreted using these current, specific prerequisites.

### Repairs and implementation

**Seven software gaps repaired** (all **FIXED AND AUTOMATICALLY VERIFIED** under their stated automated scope):

1. Email configuration lacked effective validation/startup diagnosis. Added a read-only diagnostic and shared public-setting fallback; missing/placeholder values are identified by name without exposing values. The actual environment is missing only `EMAILJS_ACTIVATION_TEMPLATE_ID`, not the public service/key available via the existing fallback.
2. Invitation/resend creation had no dedicated abuse bound. Added 20 per Administrator per 15 minutes before rotating tokens/creating accounts or sending; tests assert no extra delivery/token mutation after limit.
3. Mobile native capture silently ignored missing image data and trusted unchecked GPS; prompts could overlap. Added an injectable helper with explicit denial/cancellation/missing/type/decoded-size checks, finite GPS/range/accuracy checks and a prompt-in-progress guard. Production screen uses the helper.
4. IoT serial delivery discarded frames after network errors. Added a private persistent SQLite outbox committing before network delivery, stable retry keys, retained rejection, device binding, bounded capacity, visible safe errors and flush-only recovery.
5. IoT urllib defaults could follow a redirect with device credentials. The bridge now refuses redirects; test asserts rejection without forwarding.
6. A blank generated-image model test was skipped with the portrait class. Moved it to independent real-model opt-in; it now executes and rejects no-face data, reducing skips from seven to six without a genuine image.
7. The genuine-pair test's skip guard checked only the second fixture though code needed both. Guard now requires both to avoid KeyError when the first is absent. Genuine cases are not converted into fabricated biometric passes.

Additional working preparation: Caddy gateway configuration bound only to loopback, API/face-prefix routing, internal/file-path rejection, a synthetic routing harness, mobile private-origin example and a read-only release gate. Official temporary Caddy 2.10.2 binary was verified against the release's published **SHA-512** checksum before execution; no Caddy daemon/VPN/deployment was installed. An initial SHA-256 comparison was corrected to the checksum file's actual algorithm before executing anything. Local gateway validation/routing pass; private HTTPS/phone reachability remain **USER APPROVAL REQUIRED** / **EXTERNAL CONFIGURATION REQUIRED**. The gateway test started only synthetic loopback servers and cleaned them up.

### Final tests and executable checks

| Suite | Pass | Fail | Skip |
|---|---:|---:|---:|
| Plant/RBAC/SQLite/workflow/IoT/backup/startup | 15 | 0 | 0 |
| Website auth/activation/configuration/recovery/response | 25 | 0 | 0 |
| Chromium role/workflow | 6 | 0 | 0 |
| Mobile capture/session/connectivity/offline/sync | 52 | 0 | 0 |
| Python face service/real-model negative images | 45 | 0 | 6 |
| Serial parser/durable outbox | 6 | 0 | 0 |
| **Distinct total** | **149** | **0** | **6** |

Nine new top-level tests (three web, three capture, three outbox) and one existing generated-image test now executing account for the increase from 139 to 149. Reruns/subsets and gateway assertions are not counted twice. Website production build/type checking, mobile lint/type checking/Expo compatibility and Android export pass. Android artifact: `/tmp/niah-priority-android`; it is not an APK. Logs: `/tmp/niah-priority-*`.

Commands from the named package/workspace directory:

```bash
# plant-conservation-backend
npm test
npm run check-db
node scripts/backup-system.cjs --without-biometrics
npm audit --json

# web
node --test --test-isolation=none server/*.test.mjs tests/*.test.mjs
npm run test:browser
npm run check:activation
npm audit --json

# mobileapp
node --test --test-isolation=none scripts/*test.mjs
npm run lint
npm run type-check
npx expo install --check
npx expo export --platform android --output-dir /tmp/niah-priority-android
npm audit fix --ignore-scripts --no-fund
npm audit --json
npm ls decode-uri-component query-string expo-router node-forge zod @expo/cli @expo/code-signing-certificates expo --all
npm run check:connectivity

# mobileapp/face_backend
FACE_TEST_REAL_MODELS=1 .venv/bin/python -m unittest discover -v -p 'test_*.py'

# workspace root
python3 -m unittest discover -s IoT/PlantPrototype -p 'test_*.py'
CADDY_TEST_BINARY=/tmp/niah-priority-caddy node deploy/test-private-phone-gateway.mjs
node deploy/check-readiness.mjs
```

Expected nonzero operational diagnostics are separate from test failures: activation diagnostic reports missing template ID; both actual configured phone URLs report `API_ACCESS_REDIRECT`; release gate reports missing production origins/email and unresolved high advisories. No redirect authentication was bypassed, no TLS checks disabled and no actual inbox/phone/person/sensor test was executed.

### Current six-area completion statuses

- **Email: EXTERNAL CONFIGURATION REQUIRED.** **EMAILJS SOFTWARE COMPLETE — EXTERNAL TEMPLATE CONFIGURATION REQUIRED.** Exact template HTML is now an artifact; missing ID is diagnosed at startup and via `npm run check:activation`. Set only the actual dedicated activation ID (plus any provider-required server private key) and approve controlled receipt testing. Do not reuse OTP template blindly.
- **Phone HTTPS: USER APPROVAL REQUIRED.** Private gateway routing has executable proof; actual current private URLs still redirect. Recommended private Tailscale Serve preparation needs approved account/node/phone membership, restricted access policy and HTTPS hostname. No network membership/exposure change was made. Persistent staging deployment is a separate release prerequisite.
- **Physical phone: SOFTWARE READY — REAL DEVICE TEST REQUIRED.** Capture/GPS failures and offline/session/sync software tests pass. Native permission, device unlock, SecureStore/cold-start/full-storage/certificate/image behavior needs an authorized SDK 57 native build and physical device on the approved network. Checklist includes build/start commands and taps; no cloud build was run.
- **Face: SOFTWARE READY — REAL DEVICE TEST REQUIRED.** Python/model and safe negative/control-flow tests pass; six genuine-portrait tests still require first/second/observed-negative consented fixtures. The exact seven original test names, one repaired gate, remaining prerequisites and consented procedure are documented. No templates read or enrolled people used.
- **IoT: SOFTWARE READY — REAL DEVICE TEST REQUIRED**, with **HARDWARE INFORMATION REQUIRED** for exact board/analog probes/voltage/calibration. Firmware establishes DHT11/MPU6050 and pins/115200; durable retry/auth/ingestion tests pass. No real measurements inserted. Hardware receipt/calibration/network/power recovery and Officer response acceptance remain unexecuted.
- **Dependencies: UNRESOLVED SOFTWARE DEFECT.** Actual refreshed count is eight affected packages (five high, three moderate), three root advisories. Forge has no published patched version; decoder 0.5.x is outside the current CJS dependency contract; nested CLI Zod 3 cannot use the 4.6.6 fix without adaptation. Root Zod 4.6.7 is already patched. Current SDK 57 patch graph remains affected after non-forced audit repair; no SDK major/downgrade override. Web/backend audit zero. Exact installed versions, CVEs, paths, available fixes and mitigations are in the blockers report.

Production remains **EXTERNAL CONFIGURATION REQUIRED** and includes an **UNRESOLVED SOFTWARE DEFECT** dependency gate. New script checks configuration/owner-only storage and reported high/critical advisories without deploying; its success alone would not replace manual acceptance. Current production origin/hosting/DNS/TLS/private adapter/persistent disks/external backups/monitoring and real delivery/device verification have not been configured or accepted. No newly reproduced application defect from this run remains failing; the unresolved dependency findings and external prerequisites are explicit.

### Data, backup and live operation

Plant/authentication integrity/FK checks pass, three staff and two Visitor account rows compare identical to the new snapshot, and plant catalogue still has zero species/plants. Existing local databases/face file modes remain 600. New verified non-biometric backup: `plant-conservation-backend/backups/system-1792850606127/`; isolated restore passed and old backups/images/enrollments were preserved. Face DB/service key were excluded; no real biometric records were opened. Download recovery copies outside Codespaces before deletion/recreation; copying only a running SQLite main file can miss WAL commits.

Authentication starts with a safe startup warning naming only the missing activation template. Website/plant/auth services can run locally without PostgreSQL/Supabase; browser integration against isolated databases passes. No real email, person enrollment, sensor payload, public port/tunnel or deployment was performed. Any live service check remains read-only and uses the empty catalogue.

### Files changed in this priority run

- `.gitignore`: exclude the new private IoT outbox.
- `web/server/activation-configuration.mjs` (new): validation/effective public configuration.
- `web/server/activation.mjs`, `activation.test.mjs`: validation, invitation throttle and three regression cases.
- `web/server/recovery-config.mjs`: reuse the same public fallback as diagnostics.
- `web/server/index.mjs`: safe startup activation diagnosis.
- `web/package.json`: `check:activation` command.
- `web/scripts/check-activation.mjs`, `emailjs-activation-template.html` (new): non-sending readiness command and exact provider body.
- `mobileapp/utils/fieldCapture.js`, `scripts/field-capture.test.mjs` (new), `screens/FieldCollection.js`: tested native capture/GPS handling integrated into screen.
- `mobileapp/face_backend/test_image_pipeline.py`, `test_account_integration.py`: correct real-test prerequisites; no biometric policy/model threshold change.
- `IoT/PlantPrototype/serial_bridge.py`, `test_serial_bridge.py`: durable retry, redirect security and three tests.
- `deploy/private-phone.Caddyfile`, `private-phone.env.example`, `test-private-phone-gateway.mjs`, `check-readiness.mjs` (new): non-public configuration, executable routing verification and read-only release gate.
- `docs/final-manual-testing-checklist.md`, `remaining-blockers-resolution.md` (new); `final-system-verification.md`, `final-dependency-audit.json`, `emailjs-activation-template.md`, `mobile-api-configuration.md`: current evidence and executable handoff references.

No new dependency range/SDK major change was made in this run. Existing unrelated workspace changes were retained. Generated backup/runtime output stays ignored or in `/tmp`.

Final live probe after startup: `/api/data/species` and `/api/data/plants` both
return HTTP 200 with empty arrays. Unauthenticated `/api/auth/me` returns the
expected 401. Chromium follows the homepage Explore Plants link and renders
“No species added yet” with zero uncaught JavaScript errors. These were read-only
requests; no account login or genuine records were modified for the probe.

## 24. Access-aware automation continuation

Full current task/action table and file list: [automation-continuation.md](automation-continuation.md). **155 distinct tests passed, zero failed, six genuine-face cases skipped**. Totals: backend 15, auth/web 25, browser 6, mobile 52, Python 45 passing/6 skipped, serial/outbox 9, release-storage 3. The additional six tests verify automatic sensor drain and actual configured storage; no live record/biometric fixture was used.

Completed automatically: searched available process/project configuration, attempted repository secret-name API (existing token lacks permission), detected no accessible VPN/device/serial/consented fixture setup, reused prepared gateway/template/native code, reran safe tests and compatible advisory repair. Added automatic bounded sensor outbox drain and corrected release gate's hardcoded default storage checks. The gate now follows configured paths, checks parent permissions and separate backing files, and rejects memory/ambiguous authentication configuration. Tests use synthetic files and injected network failures/rate limits, not production data.

Fresh website build, mobile lint/type checking/SDK compatibility/Android export, local gateway harness and SQLite integrity/FK checks pass. Actual phone health probes still return `API_ACCESS_REDIRECT`; activation diagnostic names only the missing template ID; production gate fails closed on external release settings and unresolved high advisories. Current storage checks pass. These operational diagnostics are separate from unit-test results and do not establish external integration.

Mobile advisory result remains eight affected packages (5 high/3 moderate); web and backend audits zero. Current installed vulnerable paths are now recorded in [dependency-advisory-details.json](dependency-advisory-details.json); existing per-advisory mitigation/compatibility analysis is retained. Non-forced repair did not resolve them. No breaking dependency change was applied.

External boundaries are precise: provide dedicated EmailJS template ID (no email until approval); approve/authenticate private VPN node/phone; connect an authorized physical test device/runner; explicitly authorize private biometric fixture paths; connect the sensor/USB host with actual board/probe details. Codex can then resume the corresponding configuration and executable tests automatically, while physical taps/wiring/live-person actions still require the operator. No repeated pgAdmin/Supabase/password-reset steps are needed.

Files changed: `IoT/PlantPrototype/serial_bridge.py`, `test_serial_bridge.py`; new `deploy/storage-readiness.mjs`, `storage-readiness.test.mjs`, updated `check-readiness.mjs`; new `docs/automation-continuation.md`, `dependency-advisory-details.json`; updated current verification, blockers, manual checklist and dependency-audit documents. Existing accounts (3 staff/2 Visitors), empty plant catalogue, SQLite files, media, enrollments, backups, grants and offline limit were preserved. No deployment, exposure, real email or real biometric access occurred. Production remains blocked by the documented external prerequisites and dependency security findings.


## 25. Administrator-created staff accounts with temporary passwords

The user's required workflow preserves both existing EmailJS templates. No new
activation-link template is created or required. Existing staff template
`template_0yrgzoz` is selected server-side as `EMAILJS_TEMPLATE_ID`, reusing the
existing service/public key; OTP template remains unchanged. Provider fields:
`to_email`, `to_name`, `role`, `temporary_password`, `login_url`.

The server provisions only admin-assigned staff roles, stores a salted hash of a
random temporary password and marks mandatory first change. API responses/logs
never expose it. Staff must authenticate with that password and replace it with a
different password before RBAC access. Resend rotates only uncompleted credentials
and revokes sessions; completed/disabled users cannot be reset through resend.
Existing legacy Pending Activation rows stay intact until explicit admin resend.
Old activation links cannot set passwords (410 and no password form). Public OTP
recovery cannot bypass staff first login; permanent-user recovery/Visitor policy
and shared RBAC grants remain unchanged. No schema/data migration was performed.

Verified: **27 auth/configuration/recovery tests + 9 Chromium browser tests + 15
backend RBAC/SQLite/workflow tests = 51 passed, zero failed**. Website build/type
check pass. Tests use isolated synthetic accounts and mocked email only. Browser
checks cover Officer/Botanist initial login, forced password change, denial before
change and old password/session rejection afterward. Other suites were not rerun
for this focused policy change; no new full-suite total is claimed.

`npm --prefix web run check:staff-email` reports ready, empty missing/invalid
settings, valid origin and `deliveryTest: NOT SENT`. Existing live staff status
counts were inspected read-only: two Active and one Suspended permanent-password
accounts; none changed. No real email, provider template modification, biometric
access, public exposure or deployment occurred.

Changed implementation: web server activation/configuration, auth, recovery,
index and matching tests; StaffInvitations, legacy ActivateAccountView and admin
copy; diagnostic/package command/env example and private server template setting;
release-check label and current documentation. Historical filenames/aliases remain
compatible. See [current staff email guide](emailjs-activation-template.md).


## 26. Restore the Administrator dashboard layout with live data

The `/admin` route had been pointed at the minimally styled
`AdminOperationsView.vue`, which printed raw `/admin/system` keys as a definition
list. The original `AdminDashboardView.vue` layout was still present but used
hardcoded sample counts/alerts. Restored its route and reused its dashboard cards,
status panels, tables, role summary and quick actions with permitted live
account/system/device/reading/alert/audit APIs. Empty data has explicit empty
states; failed sources show unavailable rather than false zero counts. Dates,
account identity and notifications no longer show the prototype sample values.
Sensor recency is labeled as reports within five minutes, not proof of hardware
availability. Admin plant/scientific permissions remain denied and no catalogue,
location or protected-species API is used by the dashboard.

Replaced sample notification records with authorized current alerts and connected
the profile-menu sign-out to server logout/session revocation. Existing menu and
role gates remain. No new endpoint, privilege, live record, credential, template,
email or deployment change was made.

Type checking and production build completed; 11 Chromium checks passed against
isolated auth/plant APIs, including original role workflows, actual dashboard
counts, empty sensor/alert states, refresh/quick navigation, menu logout, no Admin
protected-plant requests and explicit unavailable-source handling. The first new
request assertion incorrectly included the unauthenticated homepage catalogue;
it was corrected to begin from an authenticated Admin page, preserving the
protected-request assertion. Fixture measurements exist only in temporary test
storage and are cleaned up. A test screenshot was inspected for layout.

Files: `web/src/router/index.ts`, `views/AdminDashboardView.vue`,
`components/AdminTopbarActions.vue`, `components/AdminNotificationBell.vue`,
`data/adminNotifications.ts`, `web/tests/browser/system.spec.mjs` and this report.
Vite reloads these source changes; refresh `/admin` to load the restored view.

## 27. Repair staff account modal and all routed staff module pages

The inline `StaffInvitations` component had been inserted above User Management,
and **Add New User** merely scrolled to it. Replaced that integration with an
accessible dialog opened only by the button. It includes name, username, email,
role, explicit Cancel/Close/Escape, focus handling and scroll locking. No request
is sent on open/cancel. Creation is submitted only by its explicit email action;
temporary-password response/errors and restricted resend stay server-backed.
Existing permanent accounts, templates and RBAC roles were not changed.

Repaired Administrator Role & Permission, IoT Monitoring, Sensor Management,
Threat Alerts, Security Settings, System Activity and Profile Settings with
consistent branded cards/tables, correct titles/active navigation, filters,
readable timestamps, explicit loading/error/empty states and responsive scroll
containers. Permissions come from the server matrix, retaining Officer-only
protected access. Sensor registration/edit/threshold forms are dialogs; the
one-time key is dismissible and threshold edits preserve other metric settings.
Security changes require confirmation and explain session revocation. Administrator
alert response controls remain unavailable under the existing permission model.

Repaired Officer dashboard/species/observations/reviews/map/IoT/alerts/reports/
profile routes. Species and review/response actions use dialogs with existing
validated APIs. Reports preview/export authorized aggregates. Maps handle missing
or invalid coordinates and show an empty state. Officer device management remains
unavailable. No prototype data is inserted or used as live values.

Profiles now load authoritative identity. Administrator profile edits use the
existing account API; Officer name/email remain read-only according to current
permissions. Password changes verify the current password through authentication,
apply the existing password endpoint and revoke sessions. Replaced fake Officer
notification data with authorized current alerts/review items; profile-menu
logout now revokes the server session. Removed stale prototype-only success
messages. Updated shared page/dialog styles; retained existing shells and menus.

Confirmed and fixed additional issues during browser verification: a decorative
plus sign prevented the expected Add New User accessible name; the HTML username
pattern needed an escaped hyphen for modern browser validation; numeric threshold
inputs can yield numbers and must not call string-only `.trim()`; primary-button
hover colors needed sufficient contrast; old success toasts must clear before a
new modal; Officer's logout button needed the same styled treatment as its shell.

**58 distinct affected tests passed: 27 auth/recovery/configuration, 15 backend
RBAC/SQLite/workflows and 16 Chromium scenarios; zero final failures.** The final
Cancel/mobile visual checks reran three browser cases as a subset, not added to
the count. Website type checking/production build pass. Route checks cover all
nine Administrator and nine Officer routes across desktop and narrow phone
browser widths, and the existing Guest/Visitor/Botanist website boundaries.
Physical phones/hardware and real email delivery are not claimed as tested.

Tests cover modal open/cancel/focus/restoration/username validity with mocked
email, actual isolated sensor registration/threshold/status persistence, complete
species-observation-review-publication flow, profile wrong/current-password and
session revocation, correct protected-species matrix and no horizontal document
overflow. Representative modal/module screenshots were inspected. Earlier failing
cases exposed the issues above and were repaired without weakening assertions.
Logs: `/tmp/niah-pages-*`; screenshots are ignored test artifacts.

Read-only live checks: authentication integrity `ok`, 3 staff and 2 Visitors;
plant integrity `ok`, zero species/plants/devices/readings. Existing images,
enrollments, backups and records were preserved. No real email or provider template
change, deployment, public exposure or new grant was made.

Files changed: new `web/src/components/StaffDialog.vue`, `AccountProfile.vue`,
`web/src/styles/staff-workspace.css`; updated `StaffInvitations.vue`,
`views/AdminUserManagementView.vue`, `AdminOperationsView.vue`, `AdminProfileView.vue`,
`views/conservation/ConservationWorkspace.vue`, `ConservationProfileView.vue`,
`components/AuthorizedMap.vue`, `AdminTopbarActions.vue`,
`ConservationTopbarActions.vue`, `data/adminNotifications.ts`,
`conservationNotifications.ts`, `web/tests/browser/system.spec.mjs` and this report.
No backend permission/schema changes were required. Refresh existing tabs with
Ctrl+Shift+R; an empty state indicates no records rather than a crashed page.

### Forgot-password visual regression repair (24 October 2026)

The recovery view had been replaced by unstyled markup. Restored its original
centered white card, pale background, green buttons, and stacked fields using
`bd55eb3` as the visual reference. Retained the current server-verified recovery
API, five-minute code expiry, minimum 15-character password, and non-enumerating
request message; did not restore historical browser-side OTP/prototype logic.

Changed `web/src/views/ForgotPasswordView.vue`; added two isolated browser
regression cases in `web/tests/browser/system.spec.mjs`. Production build and
TypeScript check passed. Both browser cases passed, covering desktop/mobile
layout, request errors, password mismatch, invalid/expired code, successful
confirmation, and restart. All five recovery backend tests passed with loopback
server access enabled. Browser delivery was intercepted; no real email was sent
and no existing account/database was modified. Mobile screenshots were inspected.

### Account deletion list repair (25 October 2026)

The DELETE endpoint previously only disabled accounts; GET still listed them.
DELETE now atomically records an account_archived audit marker, revokes sessions
and reset/invitation tokens, and disables sign-in. The user-management API excludes
archived IDs and rejects subsequent edit/reactivation requests. Historical rows,
images, enrollments, observations, and audit records remain intact. UI confirmation
and success text explain removal from the list. A permission-restricted SQLite
backup was made before archiving the two explicitly requested account IDs.
Two operations tests passed, including staff/visitor archival, refreshed list,
session revocation, retained records, blocked reactivation, and self-delete denial.
Production build and TypeScript checks passed; database integrity check returned ok.

### Botanist website rollback (25 October 2026)

At the user's request, removed the newly added Botanist website workspace and
its navigation/login integration. Botanist and Visitor permanent-password website
sign-ins again show mobile-only guidance and clear the website session. Old
`/botanist` URLs redirect to the public homepage. Staff mandatory temporary-password
changes remain available through the existing password-change flow. No backend
RBAC grants, mobile files, accounts, enrollments, plant records, images or databases
were changed by this rollback. Earlier Botanist-web completion notes are superseded.

## Private mobile HTTPS continuation — 25 October 2026

**EXTERNAL APPROVAL REQUIRED.** This entry supersedes earlier phone-network
readiness totals; historical 149/155-test reports were not treated as current proof.

Actual architecture: Android → approved private Tailscale Serve HTTPS → loopback
Caddy :8080 → plant :3000, auth :3001, face :8000 → existing separate SQLite stores.
No Caddy/Tailscale/tailscaled/ADB executable or TUN device was found. No approved
private hostname, VPN session or TLS certificate was configured. Existing mobile
Codespaces addresses still return redirect/sign-in HTML, not mobile API access.

Repairs/preparation completed:

- Caddy separates `/api/auth/*` and `/api/admin/*` to :3001, includes `/auth-health`,
  retains plant/image/IoT routing and face prefix, blocks internal/file paths,
  and rejects upstream redirects. Only static configuration assertions ran in
  this workspace: the live Caddy routing harness could NOT run without Caddy.
- Foreground local supervisor detects occupied ports, validates service identity,
  refuses incompatible existing servers, reuses the existing face signing key,
  sets loopback binds and gives face model initialization a longer readiness
  window. Startup initially timed out during TensorFlow import; after adjusting
  the readiness window, actual face health became ready/authoritative. Supervisor
  leaves independent services available if a model service does not become ready.
- Auth exposes a constant readiness endpoint with adapter-configured flag; no
  accounts, database paths, tokens or biometrics are returned.
- Optional single mobile HTTPS gateway configuration derives both service URLs.
  Session binding includes plant and face URLs. DNS/TLS/timeout errors are classified
  when supported by native/Node error evidence; opaque native errors are explicitly
  ambiguous. Existing offline 15-minute limit is unchanged.
- Read-only private HTTPS checker supports the future userspace SOCKS route with
  certificate validation enabled and no credentials/redirect following. Configurer
  requires actual authenticated-node DNS identity plus successful HTTPS/routes
  before editing mobile env; no placeholder/current URL was written this run.
- Existing email test fixture was updated to use a real Response error object,
  matching the adapter's current response-body diagnostics. No real mail was sent.

Actual verification:

| Check | Result |
| --- | --- |
| Mobile API/session/offline/sync/capture tests | 53 passed, 0 failed |
| Mobile lint/type checks | Passed |
| Android Expo export, SDK 57 | Passed; `/tmp/niah-private-phone-android-export`; bundle only, not installed APK |
| Web/auth/recovery/RBAC/response tests | 29 passed, 0 failed |
| Plant/SQLite/workflow/IoT/backup tests | 15 passed, 0 failed |
| Website Chromium regressions | 21 passed, 0 failed |
| Gateway config assertions + storage checks | 1 + 3 passed; not live Caddy evidence |
| Face suite | 51 run, 43 passed, 8 skipped, 0 failed; no genuine fixtures used |
| Live loopback health | Auth, plant, face: 200; face accountService authoritative |
| Live unauthenticated observations/IoT | 401; nonexistent image returned 404 |
| Real private TLS/DNS/VPN/phone | NOT VERIFIED — no approved installed VPN/hostname |
| Live Caddy routing | NOT RUN — binary absent; installation requires approval |

Files in this continuation: `deploy/private-phone.Caddyfile`,
`deploy/private-phone.env.example`, `deploy/test-private-phone-gateway.mjs`,
`deploy/mobile-private-stack.mjs`, `deploy/private-phone-config.test.mjs`,
`deploy/check-private-https.mjs`, `deploy/configure-private-mobile.mjs`,
`mobileapp/utils/apiConfiguration.js`, `mobileapp/utils/faceSession.js`,
`mobileapp/utils/plantApi.js`, `mobileapp/scripts/api-connectivity.test.mjs`,
`mobileapp/.env.example`, `web/server/index.mjs`,
`web/server/website-origin.test.mjs`, and the three requested updated guides/report
plus new `docs/mobile-private-https-setup.md`.

No enrollment, VPN installation, access-policy changes, public forwarding,
deployment, real email, genuine face-fixture use, account reset, record creation,
or data deletion was performed in this continuation. Existing accounts, SQLite,
images, face enrollments, backups, RBAC and Officer-only protected-species rules
were preserved. Local services remain foreground-managed; they stop when their
terminal/Codespace stops. Phone readiness is NOT fully configured.

Next approval: install Caddy and Tailscale as local tools. Then Codex can validate
Caddy and run the prepared live routing harness automatically. VPN login/device
enrollment and private Serve/ACL changes require explicit authorization and the
operator's account authentication. Exact commands, Android steps and stop commands:
[private mobile setup](mobile-private-https-setup.md).

## Approved Caddy/Tailscale installation and local gateway verification — 25 October 2026

**LOCALLY VERIFIED — VPN SETUP REQUIRED.** Supersedes the previous missing-binary
status. User explicitly approved local installation/configuration/testing, while
reserving separate approval for external VPN enrollment and private Serve.

Ubuntu 24.04.5 LTS / Linux x86_64 was detected. Installed official Caddy 2.11.7 and
Tailscale 1.104.2 into ignored `.local-tools/bin`, without sudo, shell-profile
changes or system package replacement. Caddy verified against its official
SHA-512 checksum manifest AND GitHub SHA-256 digests; Tailscale verified against
its official published SHA-256. Provenance manifest is local and ignored.
Installer initially expected SHA-256 in Caddy's manifest, refused execution on
mismatch, and was corrected to the actual SHA-512 format; both independent
checks then passed. No checksum verification was disabled.

Caddy configuration validated and local gateway :8080 started. The established
foreground supervisor reused healthy auth :3001, plant :3000 and authoritative
face :8000. It now discovers local tool binaries and can verify/reuse an existing
compatible gateway without creating duplicate processes or killing listeners.

Actual Caddy isolated harness: nine routes passed, bearer preserved, device-key
POST/body preserved, three upstream redirects rejected as 502 without Location,
and eight blocked paths returned 404. Eighteen actual read-only gateway probes
passed: auth/plant/face health 200, correct public catalogue/plant routing,
unauthenticated auth/Admin/scientific/IoT endpoints rejected with 401, nonexistent
image returned 404, and internal/database/env paths blocked. Existing RBAC tests
cover authorized/unauthorized role and protected-species behavior in isolated DBs.

Prepared/started local userspace tailscaled with private state and local SOCKS
:1055, without invoking `tailscale up`. Initial Unix socket path exceeded Linux's
length limit; moved socket into owner-only `/tmp/niah-tailscale-1000`. Persistent
state remains private under `.local-tools/tailscale`. Safe status query reports
**NeedsLogin**, no enrolled DNS identity. No auth URL was requested and no node
was enrolled. All five relevant TCP listeners were confirmed on 127.0.0.1 only.
Tailscale log uploads are disabled for this local test daemon.

Fresh regressions: mobile 53/53, auth/web 29/29, plant/RBAC 15/15, gateway static
configuration/storage 4/4; no failures. Gateway live harness and 18 live checks
also passed separately. No app code changed in this installation phase; earlier
Android export and native-device limits remain as previously documented.

New files: `deploy/install-local-network-tools.py`, `deploy/start-private-vpn.sh`,
`deploy/local-tools-env.sh`. Updated: `deploy/mobile-private-stack.mjs`,
`deploy/configure-private-mobile.mjs`, `deploy/test-private-phone-gateway.mjs`,
`docs/mobile-private-https-setup.md`, this verification report. Installation
artifacts, runtime state, and binaries are ignored under `.local-tools`.

Remaining gate: explicit approval to enroll this Codespace, then operator's
Tailscale browser authentication. Exact command after approval:
`source deploy/local-tools-env.sh` followed by
`tailscale --socket="$TAILSCALE_SOCKET" up`.
Private Serve/ACL configuration follows only after its authorization. No VPN
hostname/certificate or phone reachability is claimed; Expo URLs were NOT changed.
Accounts, SQLite stores, face enrollments, images, backups and RBAC were preserved.
No email, public port, Funnel, deployment or TLS bypass was performed.

### VPN enrollment confirmation — later on 25 October 2026

User completed Tailscale authentication with GitHub. Safe local status query
confirmed Running/online and node DNS `codespaces-83ea7d.tailb9ff43.ts.net`.
Local backend/gateway supervisor was restarted after its earlier terminals stopped.
Existing Serve status was empty. The requested post-enrollment private Serve
command reported that Serve is not enabled on the tailnet and supplied an owner
enablement URL; it awaits this external account action. No claim of working
private HTTPS/certificates or Android reachability is made; Expo URLs remain
unchanged. No Funnel or public-port change was performed.

### Private HTTPS now verified from enrolled host — 25 October 2026

**VPN CONNECTED — PHONE TEST REQUIRED.** User enabled tailnet Serve. Foreground
Serve now terminates HTTPS for `codespaces-83ea7d.tailb9ff43.ts.net:443` and proxies
to loopback :8080. All three local upstreams report ready; face is authoritative.

Real private-host tests exposed a previously missed Host-matching defect: Caddy's
127.0.0.1-only virtual host returned empty 200 responses for the preserved Tailscale
hostname. Added only that actual enrolled hostname as an explicit site alias;
retained `bind 127.0.0.1`. Read-only Caddy adaptation proved sole TCP listen
127.0.0.1:8080; runtime socket inspection confirmed it. Automatic review rejected
initial proposals over interface-exposure concerns; the specific-host alternative
was accepted after evidence proved no network bind expansion. No bypass occurred.

Reran installed-Caddy isolated routing harness, now exercising private Host header:
pass, including auth/plant/face/image/IoT routes, POST/device headers, three denied
redirects and eight blocked paths. Gateway static/storage tests 4/4; targeted
mobile connectivity/session tests 13/13. Private HTTPS checker passed plant and
face expected service/readiness, auth adapter identity, unauthenticated 401 auth/
observations/reports/devices/alerts, and 404 internal/database paths. Certificate
verification remained enabled; no redirects followed or application credentials
sent. This establishes host-side private HTTPS, not phone connectivity.

Only AFTER those checks, configure-private-mobile verified the enrolled DNS name,
backed up previous `.env.local` and set development single gateway URL to
`https://codespaces-83ea7d.tailb9ff43.ts.net`. Derived face base is `/face`. No account,
SQLite, image, face enrollment, backup or RBAC changes; no email or deployment.
Next required evidence is Android Tailscale connection and phone health checks,
then restarting/rebuilding Expo so the updated public environment is embedded.
