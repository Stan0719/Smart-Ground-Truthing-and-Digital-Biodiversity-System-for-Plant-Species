> **Latest verified stage ? 26 October 2026:** Eight audited web integration failures are repaired. The current detailed master-instruction report and 195-row function/role compliance matrix are at the end of this document and supersede earlier failure tables. Overall acceptance remains partial: physical/network/biometric/deployment gates are not passed.

> **Current status ? 26 October 2026:** PostgreSQL cutover and TLS connection checks pass. One separate Administrator was created and its temporary-password email was sent; user reported login success, but the database still marks the first password change as pending; acceptance is not yet verified. Web/backend dependency audits now report zero findings; mobile has five high findings. **IoT integration: Pending / To Be Completed Later**, explicitly skipped by the user. Do not follow the historical hardware instructions below. IoT source and configuration remain unchanged. Physical mobile, genuine-face acceptance, production hosting and independent recovery checks remain pending.

> Historical instructions: project Python files and launchers were removed at the user's request. Python commands below are no longer runnable. The active website uses Vue, Node.js and PostgreSQL.

> **26 October 2026 update:** Server storage has moved to PostgreSQL. Read [the current migration guide](postgresql-migration.md) before following historical SQLite paths, backups or test results below. Live Supabase cutover is not verified.

# Final manual testing checklist — 24 October 2026

Software tests do not establish physical-device results. Use authorized test accounts and genuine measurements; do not reset existing users, reuse enrolled portraits, publish private ports or bypass liveness. Current catalogue is intentionally empty: an Officer must add genuine species before collecting real plants.

## 1. Staff email — preserve existing temporary-password template

No new EmailJS template is required. Both provider templates remain unchanged.
The current workflow is Administrator creates staff account → existing email
contains temporary password/login URL → staff signs in → mandatory password
change → assigned RBAC access. See [current staff email guide](emailjs-activation-template.md).

1. Codex configured the existing `template_0yrgzoz` as `EMAILJS_TEMPLATE_ID` in
   `web/.env.server`; existing service/public key fallback is reused. OTP template
   `template_ka70fq4` remains unchanged. No activation-template ID is needed.
2. From workspace root run `npm --prefix web run check:staff-email`.
   Success: `staffEmail.ready: true`, valid website origin, `deliveryTest: NOT SENT`.
3. Before any real test, approve the test inbox, new test staff account and number
   of emails. Then use Administrator → User Management → Create staff account.
4. Verify initial temporary-password login redirects to Set New Password; access
   to protected APIs is denied until a different password is set. Re-login with
   the new password; verify the old temporary password/session stop working and
   the assigned role is enforced.
5. Admin resend rotates temporary credentials only before first change; it does
   not reset completed/disabled accounts. Every real send requires approval.
   Old activation links/public recovery cannot bypass the required initial login.

Existing accounts/passwords are not automatically converted or reset.

## 2. Private phone HTTPS access — approval before setup

**USER APPROVAL REQUIRED** for VPN membership/network setup; **EXTERNAL CONFIGURATION REQUIRED** for its account/device. Recommended for this verification: an approved private Tailscale tailnet with HTTPS Serve, restricted to your test phone and development node. It avoids public forwarding and GitHub sign-in cookies. Codespaces Tailscale userspace-networking support must be established by the account/environment administrator; this run did not install or authenticate Tailscale.

Alternatives: a secured persistent HTTPS staging deployment is the release destination, but requires hosting/DNS/TLS/persistence/secrets approval. A public tunnel with interactive GitHub or identity-provider sign-in repeats the native-fetch problem; embedding tunnel/GitHub credentials is not supported. Private VPN is the shortest development option if your organization allows it.

1. Approve the private setup, then have the administrator install supported Tailscale and Caddy on the development node and Tailscale on the phone. Authenticate both to the approved tailnet. Restrict node port 443 to authorized test users/devices in tailnet access policy; do not rely on a default broad tailnet policy. Enable tailnet HTTPS/MagicDNS when requested. Never use Funnel or make Codespaces ports public.
2. Keep plant API on `127.0.0.1:3000`, Python on `127.0.0.1:8000`, and account adapter on `127.0.0.1:3002`. Start missing services in separate terminals from workspace root:

   ```bash
   # Terminal A
   cd plant-conservation-backend
   npm start

   # Terminal B, from workspace root
   bash mobileapp/scripts/start-authoritative-face-dev.sh --backend-only
   ```

   Stop an old instance through its existing terminal first if a port is occupied. The helper deliberately refuses to replace existing face services.
3. From workspace root validate and start the prepared loopback gateway:

   ```bash
   caddy validate --config deploy/private-phone.Caddyfile --adapter caddyfile
   caddy run --config deploy/private-phone.Caddyfile --adapter caddyfile
   ```

4. **Only after approval**, on the same node enable private HTTPS:

   ```bash
   tailscale serve --bg --https=443 http://127.0.0.1:8080
   tailscale serve status
   ```

   This step changes private network access and has NOT been executed here. Use the HTTPS hostname printed by Serve, not the placeholder in an example. The Caddy listener stays loopback; TLS is terminated by Serve. Internal face-adapter routes and files are not proxied. No raw biometric API becomes public.
5. Put that actual hostname in ignored `mobileapp/.env.local`, following `deploy/private-phone.env.example`: plant is `https://actual-node.actual-tailnet.ts.net`, face is the same origin plus `/face`. From mobileapp run `npm run check:connectivity`; expected both ready. On the **phone**, with VPN connected, open `/health` and `/face/health`; expected JSON and no GitHub/HTML redirect. Check an unauthorized protected API returns 401/403. The phone check has NOT been performed here.
6. Revoke access after the test using the corresponding Serve command with `off` and stop Caddy; follow your administrator's membership/device removal policy. Do not reset other existing Serve configurations blindly.

Routing evidence in this workspace: `deploy/test-private-phone-gateway.mjs` ran against checksum-verified Caddy 2.10.2 with synthetic loopback upstreams, preserving bearer headers, stripping only `/face`, and rejecting six internal/file/unknown paths. This proves local routing, not VPN/TLS/certificate/phone reachability.

References: [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve), [Caddy binding](https://caddyserver.com/docs/caddyfile/directives/bind).

## 3. Install/start the native app and tap through acceptance

**SOFTWARE READY — REAL DEVICE TEST REQUIRED.** Use an SDK 57 native build with the project's SecureStore/crypto/camera/location modules. The Android export in this run is a JavaScript bundle, not an installable APK. No cloud build was run.

After approving Expo/EAS cloud build and using your own Expo account, from mobileapp:

```bash
# Only after the correct approved development URLs are supplied to the build environment
npx eas-cli@latest build --platform android --profile preview
```

Before building, configure the same public URLs in the EAS build environment/profile; `.env.local` must not be assumed to upload to EAS. Never upload private backend keys, SQLite or face data. Install the resulting internal APK through its approved download link. This preview contains its bundle and needs no publicly exposed Metro server. A cloud build requires separate approval/account access; it is not completed by the local Android export.

For an already authorized development build on a computer attached to the phone by USB, `npx expo start --dev-client --localhost` starts Metro. In Codespaces, forward Metro port 8081 privately to that computer and use its Android `adb reverse tcp:8081 tcp:8081`; verify local forwarding/Expo development-build support. Codespaces cannot directly access a Windows USB phone without that desktop bridge. Do not open a public Metro tunnel automatically. The existing preview profile is the simpler acceptance path once approved.

| Tap/action | Expected result | Safe failure evidence |
|---|---|---|
| Sign in with authorized Botanist password | Authoritative Botanist identity; dashboard; no client-selected role | Screen name, safe error/status, app build version |
| Register new plant → Record current GPS → deny | Clear denial; no substituted coordinates; form retained | Permission state/message, never private coordinates |
| Allow GPS → Record current GPS | Finite latitude/longitude/accuracy attached; zero coordinates are valid | Whether values appeared, not exact protected location |
| Capture photo → deny, cancel, then allow | Denial explained, cancellation changes nothing, JPEG/PNG added; rapid repeated taps do not overlap capture | Safe message, photo count; no biometric screenshot |
| Attach photo; try unsupported/oversized image | Clear rejection; previous form/photos remain | Type/approximate size/error, no private image |
| Enter genuine species/reference and morphology/height → Save offline draft | Device-encrypted saved draft; no fake species creation | Draft count and safe message |
| Disconnect network; close/reopen app within 15 minutes; unlock device | Only owner Botanist drafts restored; no server authority | Relative elapsed time/unlock result |
| Repeat after 15 minutes, or delay unlock past expiry | Access refused; saved data retained for later authorized sign-in | Relative time/error |
| Sign out, sign in as another user/Visitor | Previous owner's drafts cannot open/sync; Visitor cannot collect | Role/safe denial only |
| Reconnect → Submit and synchronize | Uploads finish before submission; Officer sees Pending Review; local draft removed only after acknowledgement | Safe record ID/status, no token |
| Interrupt between two photo uploads; reconnect and retry | Same keys prevent duplicate records/images; draft retained until success | Counts and safe request status |
| Disable account/expire server session during sync using authorized test workflow | Server rejects; no further writes; local draft preserved | 401/403 and draft count |
| Officer requests correction; Botanist edits, retries after disconnect | Revision/ownership revalidated; newer local edits retained | Safe status/revision only |
| Fill test device storage under an agreed reversible test plan | Clear storage error; earlier encrypted drafts remain; no destructive clearing | Available-space category/error |
| Officer approves genuine observation; Visitor opens catalogue/image | Only published public data visible; protected species/coordinates denied | Role, route and safe result |

Native cold start, OS device authentication, certificate validation, permission prompts and storage-full behavior remain unperformed. On failure record device/OS, app version, role, step, safe error code and relative time. Never send bearer/device keys, passwords, face images, activation links or protected coordinates.

## 4. Consented face recognition and liveness

**USER APPROVAL REQUIRED** for biometric fixtures/enrollment. Model safety tests and mocked session/security paths pass; they do not establish recognition accuracy. Obtain informed consent, private fixture storage/retention/deletion agreement and permission to test the stated cases. Never reuse existing enrollments just to complete a test.

Original seven skipped cases and disposition:

| Test | Original prerequisite | Current disposition / safe substitute |
|---|---|---|
| `RealPortraitTests.test_real_no_face_photo` | Incorrectly inherited portrait requirement | Moved to `RealNoFaceTests`; generated blank image now passes real-model rejection independently. |
| `AccountIntegrationTests.test_actual_distinct_genuine_capture_obeys_threshold` | First and second genuine captures | Six remaining skips include this; guard now explicitly requires BOTH `FACE_TEST_PORTRAIT` and `FACE_TEST_SECOND_PORTRAIT`, preventing a KeyError with only the second value. Synthetic-vector identity/ambiguity tests already exercise non-biometric control flow. |
| `AccountIntegrationTests.test_actual_models_issue_and_validate_real_service_session` | `FACE_TEST_PORTRAIT` | Needs consented face; injected-account/session tests cover issuance/revocation without biometric evidence. |
| `RealPortraitTests.test_instrumented_actual_model_keyword_interface` | `FACE_TEST_PORTRAIT` | Needs consented face; spoof instrumentation keyword-interface tests already pass safely. |
| `RealPortraitTests.test_instrumented_actual_model_still_rejects_public_fixture` | BOTH first and negative fixtures | Requires separately authorized observed rejection fixture; synthetic spoof rejection tests ensure no accepting retry/session. A random portrait must not be assumed to fail liveness. |
| `RealPortraitTests.test_real_portrait_rotated_and_mirrored` | `FACE_TEST_PORTRAIT` | Needs consented face; synthetic-image EXIF/orientation/BGR logic already passes. |
| `RealPortraitTests.test_real_rotated_jpeg_enrollment_over_http` | `FACE_TEST_PORTRAIT` | Needs consented face; isolated enrollment/consent/session protocol tests pass with injected embeddings. |

After consent, provide absolute private fixture paths through environment variables (do not commit images). From `mobileapp/face_backend`:

```bash
FACE_TEST_REAL_MODELS=1 \
FACE_TEST_PORTRAIT=/private/authorized-first.jpg \
FACE_TEST_SECOND_PORTRAIT=/private/authorized-second.jpg \
FACE_TEST_NEGATIVE_PORTRAIT=/private/authorized-observed-rejection.jpg \
.venv/bin/python -m unittest discover -v -p 'test_*.py'
```

Expected all applicable tests execute; any actual model rejection is a real failure to investigate, never grounds to disable anti-spoofing or raise thresholds silently. The threshold test may validly reject a capture; it verifies enforcement rather than proving a target true-positive rate. Physical acceptance additionally needs same-person different capture success, a different authorized person rejection, print/screen replay rejection, no/multiple-face rejection, expired challenge/session, disabled account denial and logout. Use a separate authorized test account and preserve existing enrollments.

## 5. Real sensor integration

25 October continuation: the bridge now supports `--list-ports` and direct
`--port` input, including Windows without WSL. See the
[USB host guide](../IoT/PlantPrototype/README.md). Exact board/probe confirmation,
physical measurements and real alerts remain unverified.

**SOFTWARE READY — REAL DEVICE TEST REQUIRED.** Repository firmware `IoT/PlantPrototype/PlantPrototype.ino` identifies DHT11, MPU6050 and ESP32-style pins; exact board variant and analog probe module/calibration are **HARDWARE INFORMATION REQUIRED**.

Known wiring/constants: DHT11 GPIO4; soil ADC35; rain ADC34; sound ADC32; LED GPIO5; MPU6050 I²C SDA21/SCL22; USB serial **115200 baud**. Firmware includes DHT, Adafruit MPU6050 and Adafruit Unified Sensor libraries. Do not wire unfamiliar voltage modules based only on pin numbers: confirm the exact board, supply/logic voltages and probe modules with their specifications first. Firmware has no Wi-Fi upload; it prints serial frames. The bridge runs on the computer physically connected to USB, not directly in a remote Codespace without an approved serial bridge.

1. Provide board model, soil/rain/sound module names, voltage limits and intended raw-to-unit calibration. Confirm whether low or high raw values represent threat. Current backend alerts trigger only `value > threshold`; the firmware sound LED uses **raw sound < 2000**, so it is not the same rule.
2. Administrator → IoT → register an authorized real test device. Save its provisioning key privately on the USB host. It is shown once and only its hash is stored in the API database. Never paste it in chat.
3. On that host set `PLANT_API_ORIGIN` to the approved phone-reachable HTTPS plant origin, `DEVICE_ID` and `DEVICE_KEY` to its actual values, and optionally `IOT_OUTBOX` to a private local file. Do not type secrets in reusable command-line arguments or commit them. Use your host's private environment/config mechanism.
4. Select the board and install the firmware's stated Arduino libraries using the board vendor's matching tooling. Compile/upload at 115200. Record the actual port (e.g. `/dev/ttyUSB0` only if that is your real device).
5. Pipe a trusted serial reader into `python3 IoT/PlantPrototype/serial_bridge.py`. If using an already installed PySerial on the USB host, this executable example opens the actual port named in `SERIAL_PORT`:

   ```bash
   python3 -u -c 'import os,serial,sys; s=serial.Serial(os.environ["SERIAL_PORT"],115200,timeout=2); exec("while True:\n line=s.readline()\n if line: sys.stdout.write(line.decode(errors=\"replace\")); sys.stdout.flush()")' \
     | python3 IoT/PlantPrototype/serial_bridge.py
   ```

6. Expected real frame values persist in SQLite; Administrator/Officer → readings shows them; Visitor/Botanist access is denied. Celsius/humidity percent/movement 0 or 1 are validated; soil/rain/sound are raw ADC readings, not fabricated physical units. Server stores receipt time, not an untrusted device timestamp.
7. Administrator sets a suitable threshold under a controlled genuine measurement plan; a real crossing creates an alert. Officer records a response; Administrator cannot submit an Officer response and Officer cannot manage device credentials/thresholds.
8. Disconnect API/network, observe “retained in private outbox”; reconnect and retry. Stop serial input if needed to drain backlog, then run `python3 IoT/PlantPrototype/serial_bridge.py --drain --attempts 30`. This automatically retries temporary network failures and rate limits with bounded backoff; invalid credentials/redirects stop without deleting queued data. Use `--flush-only` only for a deliberate single-pass diagnostic. Exit 0 means drained; exit 1 means readings retained. Invalid key/device/redirect must retain the queue; fix configuration instead of deleting it. Queue is limited to 10,000 frames and stops with an error when full; it is not unlimited storage. Real-time delivery failure is reported without logging credentials.
9. Verify device disable rejects ingestion, restart retains queued client keys, duplicate resend does not create a second reading and power/network recovery succeeds. Preserve/export queue before replacing the USB host. The private outbox contains sensor data and is gitignored; no key is stored in its rows.

## 6. Production release gate

From workspace root run `node deploy/check-readiness.mjs`. Current expected result is nonzero: activation ID, production website/mobile origins and high dependency remediation are not configured/resolved. Storage checks resolve configured backend/server environment paths and process overrides, validate file/directory permissions and separate backing files, and reject `:memory:` or ambiguous relative `AUTH_DB`; use an absolute `AUTH_DB` for an override. Passing this script alone never proves hardware, phone, email receipt or production readiness.

Before release obtain explicit approval for hosting/network changes, set actual HTTPS origins and exact CORS, keep adapter/databases loopback/private, provision persistent disks, store secrets privately, configure monitored rate limiting/log retention, resolve/review the documented advisories and perform the above acceptance tests. Download the verified plant/authentication backup outside Codespaces; deletion of the Codespace can destroy every local copy together. No deployment was performed.

## Private-connectivity continuation — 25 October 2026

Follow [mobile-private-https-setup.md](mobile-private-https-setup.md) for current
commands. Existing gateway routes now separate auth :3001 from plant :3000;
face remains :8000. All three actual local services were ready, including the
shared-key authoritative face adapter. Caddy/Tailscale/ADB were absent and no
private hostname existed. Gateway live execution and certificate/phone evidence
remain NOT VERIFIED; configuration assertions are not a substitute. Approve local
Caddy/Tailscale installation first; enrollment, ACL review and private Serve need
approval before their external effects. There is no TUN device; use the documented
userspace socket/SOCKS setup. Do not enable Funnel or widen Codespaces visibility.


## Automated website RBAC audit ? 26 October 2026

Owner requested an automatic Administrator / Conservation Officer / Botanist website audit. Existing browser harness was migrated from SQLite to isolated PGlite PostgreSQL engines using the actual Node authentication and plant APIs. No live accounts or records were changed, no email was sent, and IoT source/configuration/hardware were left unchanged. Browser tools were installed only into dependency/cache outputs, without adding an application source file or changing dependency manifests for the runner.

- All eight route/API role matrices passed: 48 protected-route checks and 28 HTTP permission checks across Administrator, Conservation Officer, Botanist and unauthenticated Guest.
- All 34 authentication tests and 14 backend tests passed. Vue type checking and production build passed.
- Twelve non-IoT protected pages were checked separately for API failures, required data requests and correct profile identity: four checks passed and eight failed. Passing checks establish connection smoke coverage only; empty test tables do not validate every displayed field or full write workflow.

| Page | Result | Evidence / remaining work |
| --- | --- | --- |
| Administrator dashboard | Failed | Requests species data, which correctly returns 403 for Administrator under the current least-privilege policy; dashboard also contains hard-coded counters. Fix its data source rather than broadening role access. |
| Administrator users | Connection smoke passed | Loads authenticated account API. Full staff email acceptance is separate. |
| Administrator profile | Failed | Shows local Admin01 rather than authenticated PostgreSQL test account; existing form does not persist its password change to the API. |
| Administrator roles | Failed | Hard-coded matrix; never requests /api/admin/permissions. Display can disagree with enforced shared/rbac.cjs policy. |
| Administrator activity | Failed | Hard-coded logs; never requests /api/admin/audit. |
| Officer dashboard | Non-IoT connection smoke passed | IoT request results excluded by user instruction. Existing collection adapters still require nonempty-record acceptance. |
| Officer profile | Failed | Shows local Officer01 rather than authenticated PostgreSQL test account. |
| Officer species | Failed | Edits local conservationStore; does not request the species API. |
| Officer observations | Connection smoke passed | Authenticated observations endpoint reachable; legacy field mapping still needs nonempty-record acceptance. |
| Officer review | Failed | /api/species-requests returns 404; this blocks the combined load. Review adapters/actions need integration validation. |
| Officer map | Connection smoke passed | Authenticated plants endpoint reachable; actual coordinate/record display remains separate acceptance. |
| Officer reports | Failed | Uses local conservationStore and does not request the authenticated reports API. |

Additional browser checks: the existing public-home empty-catalogue expectation failed and needs alignment with genuine API-backed content. Botanist website login displays mobile-only guidance but retains an authenticated cookie (/api/auth/me returns 200); it still cannot enter Administrator or Officer routes. This is a platform-flow inconsistency, not evidence of privilege escalation. There is no Botanist web workspace in the current router; Botanist is assigned to the mobile workflow. No hardware/physical mobile/face recognition acceptance is claimed.

Reproduce with a browser runner installed in dependency outputs: from web, run node node_modules/@playwright/test/cli.js test --grep 'RBAC (route|API) matrix|PostgreSQL page connection'. The page failures above remain intentionally visible; this audit does not certify all pages as integrated.


## Master-instruction implementation and RBAC compliance ? 26 October 2026

This section supersedes earlier audit failures and historical SQLite/Python instructions. Overall acceptance remains PARTIAL. No live accounts were created, real passwords reset, real emails sent, production infrastructure changed or IoT hardware contacted during this master-instruction stage. Existing IoT source/configuration and shared/rbac.cjs grants were preserved. Local development APIs were restarted, with live counts unchanged: four staff accounts, two plants, one observation.

### Preservation and migration evidence

- Original PostgreSQL backup restored again into isolated PGlite/PostGIS; all 23 original public tables matched the current original source. Migration rehearsal retained IDs, original hashes and relationships: one legacy account, two families, two genera, seven statuses, two species, two plants, two locations, one observation.
- A new private-schema INSERT-format pg_dump archive was created inside the existing restricted backup directory. pg_restore archive validation and actual isolated restoration passed; restored counts: four current staff accounts, two plants, one observation. Backups remain private; no credential hashes, sessions, connection strings or keys are included in this report.
- Active TLS-verified PostgreSQL checks passed for plant_app, plant_auth and plant_face. No live schema migration was needed for these fixes. One-hour newly issued temporary credentials use expiry metadata in the existing activation_tokens table; confirmation links remain disabled.
- No original SQLite database files were located by the current workspace inventory. Their separate original backup cannot be newly certified. An independent off-computer backup and restoration drill are still required. The unsupported original Botanist hash remains unchanged; it is a known legacy login issue rather than silent migration data loss.

### Implemented changes and storage/API map

| Change | Frontend / API | PostgreSQL storage |
| --- | --- | --- |
| Authorized administrator status dashboard | AdminDashboardView; GET /api/admin/system | plant_auth.users, visitors; runtime metrics only, no scientific plant access |
| Real account profiles and password changes | AdminProfileView / ConservationProfileView reuse AccountProfile; /api/auth/me, /api/auth/login, /api/auth/password | plant_auth.users / visitors / sessions / visitor_sessions |
| Actual permission and activity pages | AdminModuleView; GET /api/admin/permissions and /api/admin/audit | enforced shared/rbac.cjs grants; plant_auth.auth_events |
| Security-settings page | /admin/settings; GET/PATCH /api/admin/settings | plant_auth.security_settings; server revokes sessions on changes |
| Official species and taxonomy | PlantSpeciesView; /api/data/species, /api/data/taxonomy, /api/data/assets | plant_app.species, genus, family, conservation_status, rbac_species_visibility, plant_asset, domain_audit |
| Officer observation review | ReviewSubmissionsView; GET /api/data/observations, POST /api/data/observations/:id/review | plant_app.plant_observation, observation_review, plant_record, plant_asset; authorized photo metadata returned with observations |
| Own feedback / observation adapters | ObservationsView, mobile plantApi; GET observations | own observation ownership predicate retained; latest review comment returned; UUID IDs and JSON content handled |
| Reports and real public catalogue images | ReportsView, PlantsView, SpeciesDetailView, App and knowledge integration; GET reports/species/assets | only API-authorized rows; CSV/PDF exports; CSV formula prefixes escaped; no sample operational catalogue before fetch |
| Minimum Botanist/Visitor web account experience | /account, LoginModal, AccountProfile | existing account/session tables; no Admin or Officer dashboard granted |
| Shared password authentication | /api/mobile/password, /api/mobile/me, /api/mobile/logout and recovery routes | same plant_auth identities, secure hashes and sessions; native bearer sessions independent of website cookies |
| Approved temporary expiry | activation.mjs and auth.mjs; one hour for NEWLY ISSUED credentials | activation_tokens opaque random identifier, expiry and used metadata; no plaintext password stored; expired login/session/change rejected |
| Admin-initiated recovery | POST /api/admin/users/:id/reset; explicit User Management confirmation | existing recovery flow and auth_events; sends owner a recovery code only when actually requested, does not directly replace password |
| Mobile draft/session repairs | faceApi / faceSession / faceSessionLifecycle / plantApi | SecureStore-backed bounded draft lease, device unlock, 15-minute expiry, rollback/cancellation protection; online authority always reverified; expected draft owner enforced |

### Commands and evidence

- node web/scripts/rehearse-legacy-postgres.mjs: original backup restoration/rehearsal passed, 23 matching tables.
- node web/scripts/check-postgres.mjs and backend check-db: active schemas verified; no live mutations.
- npm --prefix web run test:auth: 36 passed, zero failed.
- npm --prefix plant-conservation-backend test: 14 passed, zero failed; includes authorization, ownership, feedback isolation, official taxonomy denial matrix, media, review transitions and isolated simulated-IoT storage.
- node --test mobileapp/scripts/*.test.mjs: 59 passed, zero failed. These exercise transport, session, capture-flow and offline/sync logic with injected services and fixtures; they are NOT physical phone or genuine-face acceptance.
- node --test deploy/storage-readiness.test.mjs deploy/private-phone-config.test.mjs: 3 passed.
- Browser acceptance subset: 27 passed. Includes 52 page access decisions, 28 HTTP permission decisions, 13 protected page connection/identity smoke tests, Botanist/Visitor account pages, initial credential changes, profile password change and the species ? photo upload ? Botanist observation ? Officer review/photo ? publication ? CSV/PDF flow. Browser tests use actual Node APIs and isolated PostgreSQL engines, not live test accounts or real delivery. Isolated browser login_limit is 100 so the suite does not throttle itself; production settings were not weakened.
- After the final taxonomy/review-photo edits, the three affected browser tests passed again. Vue type checking and Vite production build passed. The large-chunk build warning remains; it does not establish a functional failure.
- npm audits refreshed: web 0, backend 0, mobile 5 high / 0 critical. No Expo major migration or forced override.
- npm --prefix web run check:staff-email: ready, no delivery performed.
- node deploy/check-readiness.mjs: correctly BLOCKED by absent production origin/HTTPS configuration and remaining mobile findings; PostgreSQL, schema separation, retired SQLite runtime and staff email configuration pass. Face storage is not a working recognition service.

### Complete function-by-role compliance coverage

Roles below distinguish Guest (no login), Visitor (authenticated), Botanist, Conservation Officer and Administrator. PASS applies only to the cited implemented/tested scope. PARTIAL means at least one part needs broader integration, full device or manual acceptance. No row asserts a genuine biometric or physical hardware result. For read access, Visitor includes the public projection; exact coordinates and protected records stay excluded. Botanist protected-species policy remains the EXISTING deny rule in shared/rbac.cjs; no broader internal policy was invented.

Evidence keys: AUTH = web/server/auth.test.mjs, api.test.mjs, activation.test.mjs, recovery.test.mjs and operations.test.mjs; API = plant-conservation-backend/test/business.test.cjs, rbac.test.cjs and security-audit.test.cjs; WEB = web/tests/browser/system.spec.mjs acceptance subset; MOBILE = mobileapp/scripts logic suites. Table references are schema-qualified by the storage map above.

| Module | Function | Role | Expected permission | Actual result | Status | Evidence | Fix required |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Security | Secure login | Guest | N | Cookie and bearer credentials verified; no anonymous identity | PASS | /api/auth/login; /api/mobile/password; users/visitors/sessions; AUTH, WEB | Physical mobile endpoint acceptance pending |
| Security | Secure login | Visitor | Y | Cookie and bearer credentials verified; no anonymous identity | PASS | /api/auth/login; /api/mobile/password; users/visitors/sessions; AUTH, WEB | Physical mobile endpoint acceptance pending |
| Security | Secure login | Botanist | Y | Cookie and bearer credentials verified; no anonymous identity | PASS | /api/auth/login; /api/mobile/password; users/visitors/sessions; AUTH, WEB | Physical mobile endpoint acceptance pending |
| Security | Secure login | Conservation Officer | Y | Cookie and bearer credentials verified; no anonymous identity | PASS | /api/auth/login; /api/mobile/password; users/visitors/sessions; AUTH, WEB | Physical mobile endpoint acceptance pending |
| Security | Secure login | Administrator | Y | Cookie and bearer credentials verified; no anonymous identity | PASS | /api/auth/login; /api/mobile/password; users/visitors/sessions; AUTH, WEB | Physical mobile endpoint acceptance pending |
| Security | Role-specific dashboard / account page | Guest | N | Admin/Officer guarded dashboards; Visitor/Botanist own account page | PARTIAL | router; /account; auth sessions; WEB | Full native role experience remains device-dependent |
| Security | Role-specific dashboard / account page | Visitor | Y | Admin/Officer guarded dashboards; Visitor/Botanist own account page | PARTIAL | router; /account; auth sessions; WEB | Full native role experience remains device-dependent |
| Security | Role-specific dashboard / account page | Botanist | Y | Admin/Officer guarded dashboards; Visitor/Botanist own account page | PARTIAL | router; /account; auth sessions; WEB | Full native role experience remains device-dependent |
| Security | Role-specific dashboard / account page | Conservation Officer | Y | Admin/Officer guarded dashboards; Visitor/Botanist own account page | PARTIAL | router; /account; auth sessions; WEB | Full native role experience remains device-dependent |
| Security | Role-specific dashboard / account page | Administrator | Y | Admin/Officer guarded dashboards; Visitor/Botanist own account page | PARTIAL | router; /account; auth sessions; WEB | Full native role experience remains device-dependent |
| Security | Create/edit/disable user accounts | Guest | N | Admin-only server operations; Botanist provisioning tested with fake delivery | PASS | /api/admin/users; users/visitors/auth_events; AUTH, WEB | Real staff provisioning requires approval |
| Security | Create/edit/disable user accounts | Visitor | N | Admin-only server operations; Botanist provisioning tested with fake delivery | PASS | /api/admin/users; users/visitors/auth_events; AUTH, WEB | Real staff provisioning requires approval |
| Security | Create/edit/disable user accounts | Botanist | N | Admin-only server operations; Botanist provisioning tested with fake delivery | PASS | /api/admin/users; users/visitors/auth_events; AUTH, WEB | Real staff provisioning requires approval |
| Security | Create/edit/disable user accounts | Conservation Officer | N | Admin-only server operations; Botanist provisioning tested with fake delivery | PASS | /api/admin/users; users/visitors/auth_events; AUTH, WEB | Real staff provisioning requires approval |
| Security | Create/edit/disable user accounts | Administrator | Y | Admin-only server operations; Botanist provisioning tested with fake delivery | PASS | /api/admin/users; users/visitors/auth_events; AUTH, WEB | Real staff provisioning requires approval |
| Security | Assign roles and permissions | Guest | N | Admin role assignments enforced; permission display reads immutable enforced policy | PARTIAL | /api/admin/users/:id; /permissions; shared/rbac.cjs; AUTH, WEB | Arbitrary grant editing is not implemented; policy changes require approval |
| Security | Assign roles and permissions | Visitor | N | Admin role assignments enforced; permission display reads immutable enforced policy | PARTIAL | /api/admin/users/:id; /permissions; shared/rbac.cjs; AUTH, WEB | Arbitrary grant editing is not implemented; policy changes require approval |
| Security | Assign roles and permissions | Botanist | N | Admin role assignments enforced; permission display reads immutable enforced policy | PARTIAL | /api/admin/users/:id; /permissions; shared/rbac.cjs; AUTH, WEB | Arbitrary grant editing is not implemented; policy changes require approval |
| Security | Assign roles and permissions | Conservation Officer | N | Admin role assignments enforced; permission display reads immutable enforced policy | PARTIAL | /api/admin/users/:id; /permissions; shared/rbac.cjs; AUTH, WEB | Arbitrary grant editing is not implemented; policy changes require approval |
| Security | Assign roles and permissions | Administrator | Y | Admin role assignments enforced; permission display reads immutable enforced policy | PARTIAL | /api/admin/users/:id; /permissions; shared/rbac.cjs; AUTH, WEB | Arbitrary grant editing is not implemented; policy changes require approval |
| Security | Self-service and administrative password reset | Guest | Y | Self-service OTP and Admin-only recovery initiation tested; owner confirms code | PARTIAL | /auth/recovery/*; /admin/users/:id/reset; password_resets; AUTH | Real delivery/receipt for new flow requires approval |
| Security | Self-service and administrative password reset | Visitor | Y | Self-service OTP and Admin-only recovery initiation tested; owner confirms code | PARTIAL | /auth/recovery/*; /admin/users/:id/reset; password_resets; AUTH | Real delivery/receipt for new flow requires approval |
| Security | Self-service and administrative password reset | Botanist | Y | Self-service OTP and Admin-only recovery initiation tested; owner confirms code | PARTIAL | /auth/recovery/*; /admin/users/:id/reset; password_resets; AUTH | Real delivery/receipt for new flow requires approval |
| Security | Self-service and administrative password reset | Conservation Officer | Y | Self-service OTP and Admin-only recovery initiation tested; owner confirms code | PARTIAL | /auth/recovery/*; /admin/users/:id/reset; password_resets; AUTH | Real delivery/receipt for new flow requires approval |
| Security | Self-service and administrative password reset | Administrator | Y | Self-service OTP and Admin-only recovery initiation tested; owner confirms code | PARTIAL | /auth/recovery/*; /admin/users/:id/reset; password_resets; AUTH | Real delivery/receipt for new flow requires approval |
| Security | View user activity/login/audit logs | Guest | N | Persisted account logs and plant audit endpoints reject other roles | PASS | /admin/audit; /api/data/audit; auth_events/domain_audit; AUTH, API, WEB | None in tested local scope |
| Security | View user activity/login/audit logs | Visitor | N | Persisted account logs and plant audit endpoints reject other roles | PASS | /admin/audit; /api/data/audit; auth_events/domain_audit; AUTH, API, WEB | None in tested local scope |
| Security | View user activity/login/audit logs | Botanist | N | Persisted account logs and plant audit endpoints reject other roles | PASS | /admin/audit; /api/data/audit; auth_events/domain_audit; AUTH, API, WEB | None in tested local scope |
| Security | View user activity/login/audit logs | Conservation Officer | N | Persisted account logs and plant audit endpoints reject other roles | PASS | /admin/audit; /api/data/audit; auth_events/domain_audit; AUTH, API, WEB | None in tested local scope |
| Security | View user activity/login/audit logs | Administrator | Y | Persisted account logs and plant audit endpoints reject other roles | PASS | /admin/audit; /api/data/audit; auth_events/domain_audit; AUTH, API, WEB | None in tested local scope |
| Security | Manage security settings | Guest | N | Persisted constrained settings; all sessions revoked on change | PASS | /admin/settings; security_settings; AUTH, WEB | Production settings need approved configuration |
| Security | Manage security settings | Visitor | N | Persisted constrained settings; all sessions revoked on change | PASS | /admin/settings; security_settings; AUTH, WEB | Production settings need approved configuration |
| Security | Manage security settings | Botanist | N | Persisted constrained settings; all sessions revoked on change | PASS | /admin/settings; security_settings; AUTH, WEB | Production settings need approved configuration |
| Security | Manage security settings | Conservation Officer | N | Persisted constrained settings; all sessions revoked on change | PASS | /admin/settings; security_settings; AUTH, WEB | Production settings need approved configuration |
| Security | Manage security settings | Administrator | Y | Persisted constrained settings; all sessions revoked on change | PASS | /admin/settings; security_settings; AUTH, WEB | Production settings need approved configuration |
| Security | Monitor system status | Guest | N | Admin dashboard uses authorized account/runtime statistics | PASS | /admin/system; users/visitors; AUTH, WEB | Production monitoring acceptance pending |
| Security | Monitor system status | Visitor | N | Admin dashboard uses authorized account/runtime statistics | PASS | /admin/system; users/visitors; AUTH, WEB | Production monitoring acceptance pending |
| Security | Monitor system status | Botanist | N | Admin dashboard uses authorized account/runtime statistics | PASS | /admin/system; users/visitors; AUTH, WEB | Production monitoring acceptance pending |
| Security | Monitor system status | Conservation Officer | N | Admin dashboard uses authorized account/runtime statistics | PASS | /admin/system; users/visitors; AUTH, WEB | Production monitoring acceptance pending |
| Security | Monitor system status | Administrator | Y | Admin dashboard uses authorized account/runtime statistics | PASS | /admin/system; users/visitors; AUTH, WEB | Production monitoring acceptance pending |
| Knowledge | Read names/taxonomy/description | Guest | Y | Server-projected catalogue excludes Admin | PASS | GET species; species/genus/family; API, WEB | None in tested API scope |
| Knowledge | Read names/taxonomy/description | Visitor | Y | Server-projected catalogue excludes Admin | PASS | GET species; species/genus/family; API, WEB | None in tested API scope |
| Knowledge | Read names/taxonomy/description | Botanist | Y | Server-projected catalogue excludes Admin | PASS | GET species; species/genus/family; API, WEB | None in tested API scope |
| Knowledge | Read names/taxonomy/description | Conservation Officer | Y | Server-projected catalogue excludes Admin | PASS | GET species; species/genus/family; API, WEB | None in tested API scope |
| Knowledge | Read names/taxonomy/description | Administrator | N | Server-projected catalogue excludes Admin | PASS | GET species; species/genus/family; API, WEB | None in tested API scope |
| Knowledge | Read photos/habitat/cultural significance | Guest | Y | Official media and text use authorized APIs; approved image publication tested | PARTIAL | species/assets; plant_asset; API, WEB | Broader document and device display acceptance remains |
| Knowledge | Read photos/habitat/cultural significance | Visitor | Y | Official media and text use authorized APIs; approved image publication tested | PARTIAL | species/assets; plant_asset; API, WEB | Broader document and device display acceptance remains |
| Knowledge | Read photos/habitat/cultural significance | Botanist | Y | Official media and text use authorized APIs; approved image publication tested | PARTIAL | species/assets; plant_asset; API, WEB | Broader document and device display acceptance remains |
| Knowledge | Read photos/habitat/cultural significance | Conservation Officer | Y | Official media and text use authorized APIs; approved image publication tested | PARTIAL | species/assets; plant_asset; API, WEB | Broader document and device display acceptance remains |
| Knowledge | Read photos/habitat/cultural significance | Administrator | N | Official media and text use authorized APIs; approved image publication tested | PARTIAL | species/assets; plant_asset; API, WEB | Broader document and device display acceptance remains |
| Knowledge | Search/filter plants | Guest | Y | Authorized catalogue feeds existing search/filter; Admin API denied | PARTIAL | species; PlantsView; API, WEB | Full filter combinations need browser acceptance |
| Knowledge | Search/filter plants | Visitor | Y | Authorized catalogue feeds existing search/filter; Admin API denied | PARTIAL | species; PlantsView; API, WEB | Full filter combinations need browser acceptance |
| Knowledge | Search/filter plants | Botanist | Y | Authorized catalogue feeds existing search/filter; Admin API denied | PARTIAL | species; PlantsView; API, WEB | Full filter combinations need browser acceptance |
| Knowledge | Search/filter plants | Conservation Officer | Y | Authorized catalogue feeds existing search/filter; Admin API denied | PARTIAL | species; PlantsView; API, WEB | Full filter combinations need browser acceptance |
| Knowledge | Search/filter plants | Administrator | N | Authorized catalogue feeds existing search/filter; Admin API denied | PARTIAL | species; PlantsView; API, WEB | Full filter combinations need browser acceptance |
| Knowledge | Scan QR and read authorized linked content | Guest | Y | QR API preserves public versus scientific projection and ownership rules | PARTIAL | /api/data/qr/:token; plant_record; API | Physical camera/QR scan remains blocked by device setup |
| Knowledge | Scan QR and read authorized linked content | Visitor | Y | QR API preserves public versus scientific projection and ownership rules | PARTIAL | /api/data/qr/:token; plant_record; API | Physical camera/QR scan remains blocked by device setup |
| Knowledge | Scan QR and read authorized linked content | Botanist | Y | QR API preserves public versus scientific projection and ownership rules | PARTIAL | /api/data/qr/:token; plant_record; API | Physical camera/QR scan remains blocked by device setup |
| Knowledge | Scan QR and read authorized linked content | Conservation Officer | Y | QR API preserves public versus scientific projection and ownership rules | PARTIAL | /api/data/qr/:token; plant_record; API | Physical camera/QR scan remains blocked by device setup |
| Knowledge | Scan QR and read authorized linked content | Administrator | N | QR API preserves public versus scientific projection and ownership rules | PARTIAL | /api/data/qr/:token; plant_record; API | Physical camera/QR scan remains blocked by device setup |
| Knowledge | Species distribution map | Guest | N | Scientific coordinates available only to authorized roles; Officer map connects | PARTIAL | plants/plant_location; BiodiversityMapView; API, WEB | Botanist physical mobile map acceptance pending |
| Knowledge | Species distribution map | Visitor | N | Scientific coordinates available only to authorized roles; Officer map connects | PARTIAL | plants/plant_location; BiodiversityMapView; API, WEB | Botanist physical mobile map acceptance pending |
| Knowledge | Species distribution map | Botanist | Y | Scientific coordinates available only to authorized roles; Officer map connects | PARTIAL | plants/plant_location; BiodiversityMapView; API, WEB | Botanist physical mobile map acceptance pending |
| Knowledge | Species distribution map | Conservation Officer | Y | Scientific coordinates available only to authorized roles; Officer map connects | PARTIAL | plants/plant_location; BiodiversityMapView; API, WEB | Botanist physical mobile map acceptance pending |
| Knowledge | Species distribution map | Administrator | N | Scientific coordinates available only to authorized roles; Officer map connects | PARTIAL | plants/plant_location; BiodiversityMapView; API, WEB | Botanist physical mobile map acceptance pending |
| Knowledge | Read conservation status | Guest | N | Scientific projection includes status; public projection omits it | PASS | species/conservation_status; shared projectSpecies; API | None in tested projection scope |
| Knowledge | Read conservation status | Visitor | N | Scientific projection includes status; public projection omits it | PASS | species/conservation_status; shared projectSpecies; API | None in tested projection scope |
| Knowledge | Read conservation status | Botanist | Y | Scientific projection includes status; public projection omits it | PASS | species/conservation_status; shared projectSpecies; API | None in tested projection scope |
| Knowledge | Read conservation status | Conservation Officer | Y | Scientific projection includes status; public projection omits it | PASS | species/conservation_status; shared projectSpecies; API | None in tested projection scope |
| Knowledge | Read conservation status | Administrator | N | Scientific projection includes status; public projection omits it | PASS | species/conservation_status; shared projectSpecies; API | None in tested projection scope |
| Knowledge | Read protected/rare species | Guest | N | Existing internal rule denies Botanist protected records; Officer allowed | PASS | rbac_species_visibility; shared grants/visibilityFor; API | Broader Botanist access would require approved policy |
| Knowledge | Read protected/rare species | Visitor | N | Existing internal rule denies Botanist protected records; Officer allowed | PASS | rbac_species_visibility; shared grants/visibilityFor; API | Broader Botanist access would require approved policy |
| Knowledge | Read protected/rare species | Botanist | Conditional: existing internal rule denies protected data | Existing internal rule denies Botanist protected records; Officer allowed | PASS | rbac_species_visibility; shared grants/visibilityFor; API | Broader Botanist access would require approved policy |
| Knowledge | Read protected/rare species | Conservation Officer | Y | Existing internal rule denies Botanist protected records; Officer allowed | PASS | rbac_species_visibility; shared grants/visibilityFor; API | Broader Botanist access would require approved policy |
| Knowledge | Read protected/rare species | Administrator | N | Existing internal rule denies Botanist protected records; Officer allowed | PASS | rbac_species_visibility; shared grants/visibilityFor; API | Broader Botanist access would require approved policy |
| Knowledge | Read exact GPS | Guest | N | Scientific API includes authorized coordinates; public projection omits them | PARTIAL | plants/plant_location; public QR projection; API | Full map/export/QR UI leakage acceptance remains |
| Knowledge | Read exact GPS | Visitor | N | Scientific API includes authorized coordinates; public projection omits them | PARTIAL | plants/plant_location; public QR projection; API | Full map/export/QR UI leakage acceptance remains |
| Knowledge | Read exact GPS | Botanist | Y | Scientific API includes authorized coordinates; public projection omits them | PARTIAL | plants/plant_location; public QR projection; API | Full map/export/QR UI leakage acceptance remains |
| Knowledge | Read exact GPS | Conservation Officer | Y | Scientific API includes authorized coordinates; public projection omits them | PARTIAL | plants/plant_location; public QR projection; API | Full map/export/QR UI leakage acceptance remains |
| Knowledge | Read exact GPS | Administrator | N | Scientific API includes authorized coordinates; public projection omits them | PARTIAL | plants/plant_location; public QR projection; API | Full map/export/QR UI leakage acceptance remains |
| Field | Register new plant record | Guest | N | Botanist-only server creation with duplicate client-key protection | PARTIAL | POST plants; plant_record/plant_observation; API, WEB | Actual device collection acceptance pending |
| Field | Register new plant record | Visitor | N | Botanist-only server creation with duplicate client-key protection | PARTIAL | POST plants; plant_record/plant_observation; API, WEB | Actual device collection acceptance pending |
| Field | Register new plant record | Botanist | Y | Botanist-only server creation with duplicate client-key protection | PARTIAL | POST plants; plant_record/plant_observation; API, WEB | Actual device collection acceptance pending |
| Field | Register new plant record | Conservation Officer | N | Botanist-only server creation with duplicate client-key protection | PARTIAL | POST plants; plant_record/plant_observation; API, WEB | Actual device collection acceptance pending |
| Field | Register new plant record | Administrator | N | Botanist-only server creation with duplicate client-key protection | PARTIAL | POST plants; plant_record/plant_observation; API, WEB | Actual device collection acceptance pending |
| Field | Record taxonomy/morphology/height/attributes | Guest | N | Species reference and validated observation content stored | PARTIAL | POST plants/observations; content JSONB; API, WEB | Physical entry and taxonomy UX acceptance pending |
| Field | Record taxonomy/morphology/height/attributes | Visitor | N | Species reference and validated observation content stored | PARTIAL | POST plants/observations; content JSONB; API, WEB | Physical entry and taxonomy UX acceptance pending |
| Field | Record taxonomy/morphology/height/attributes | Botanist | Y | Species reference and validated observation content stored | PARTIAL | POST plants/observations; content JSONB; API, WEB | Physical entry and taxonomy UX acceptance pending |
| Field | Record taxonomy/morphology/height/attributes | Conservation Officer | N | Species reference and validated observation content stored | PARTIAL | POST plants/observations; content JSONB; API, WEB | Physical entry and taxonomy UX acceptance pending |
| Field | Record taxonomy/morphology/height/attributes | Administrator | N | Species reference and validated observation content stored | PARTIAL | POST plants/observations; content JSONB; API, WEB | Physical entry and taxonomy UX acceptance pending |
| Field | Capture and attach photos | Guest | N | Owned image upload and publication boundaries tested | PARTIAL | assets; plant_asset; API, WEB, MOBILE | Native camera permission/capture not physically tested |
| Field | Capture and attach photos | Visitor | N | Owned image upload and publication boundaries tested | PARTIAL | assets; plant_asset; API, WEB, MOBILE | Native camera permission/capture not physically tested |
| Field | Capture and attach photos | Botanist | Y | Owned image upload and publication boundaries tested | PARTIAL | assets; plant_asset; API, WEB, MOBILE | Native camera permission/capture not physically tested |
| Field | Capture and attach photos | Conservation Officer | N | Owned image upload and publication boundaries tested | PARTIAL | assets; plant_asset; API, WEB, MOBILE | Native camera permission/capture not physically tested |
| Field | Capture and attach photos | Administrator | N | Owned image upload and publication boundaries tested | PARTIAL | assets; plant_asset; API, WEB, MOBILE | Native camera permission/capture not physically tested |
| Field | GPS capture and manual correction | Guest | N | Server coordinate validation and review workflow; capture-flow logic tests | PARTIAL | content/plant_location; API, MOBILE | Physical GPS, precision and manual correction acceptance pending |
| Field | GPS capture and manual correction | Visitor | N | Server coordinate validation and review workflow; capture-flow logic tests | PARTIAL | content/plant_location; API, MOBILE | Physical GPS, precision and manual correction acceptance pending |
| Field | GPS capture and manual correction | Botanist | Y | Server coordinate validation and review workflow; capture-flow logic tests | PARTIAL | content/plant_location; API, MOBILE | Physical GPS, precision and manual correction acceptance pending |
| Field | GPS capture and manual correction | Conservation Officer | N | Server coordinate validation and review workflow; capture-flow logic tests | PARTIAL | content/plant_location; API, MOBILE | Physical GPS, precision and manual correction acceptance pending |
| Field | GPS capture and manual correction | Administrator | N | Server coordinate validation and review workflow; capture-flow logic tests | PARTIAL | content/plant_location; API, MOBILE | Physical GPS, precision and manual correction acceptance pending |
| Field | Generate plant QR | Guest | N | Owner-only generation; other Botanists/roles denied | PASS | GET plants/:id/qr; plant_record.qr_token; API | Physical scanning separately pending |
| Field | Generate plant QR | Visitor | N | Owner-only generation; other Botanists/roles denied | PASS | GET plants/:id/qr; plant_record.qr_token; API | Physical scanning separately pending |
| Field | Generate plant QR | Botanist | Y | Owner-only generation; other Botanists/roles denied | PASS | GET plants/:id/qr; plant_record.qr_token; API | Physical scanning separately pending |
| Field | Generate plant QR | Conservation Officer | N | Owner-only generation; other Botanists/roles denied | PASS | GET plants/:id/qr; plant_record.qr_token; API | Physical scanning separately pending |
| Field | Generate plant QR | Administrator | N | Owner-only generation; other Botanists/roles denied | PASS | GET plants/:id/qr; plant_record.qr_token; API | Physical scanning separately pending |
| Field | Offline encrypted drafts and synchronization | Guest | N | Encryption adapter, account isolation, 15-minute lease, retries/cancellation tested | PARTIAL | fieldStorage/offlineDraftStore/fieldSync; SecureStore and API; MOBILE | Native AES/SecureStore/network restart acceptance required |
| Field | Offline encrypted drafts and synchronization | Visitor | N | Encryption adapter, account isolation, 15-minute lease, retries/cancellation tested | PARTIAL | fieldStorage/offlineDraftStore/fieldSync; SecureStore and API; MOBILE | Native AES/SecureStore/network restart acceptance required |
| Field | Offline encrypted drafts and synchronization | Botanist | Y | Encryption adapter, account isolation, 15-minute lease, retries/cancellation tested | PARTIAL | fieldStorage/offlineDraftStore/fieldSync; SecureStore and API; MOBILE | Native AES/SecureStore/network restart acceptance required |
| Field | Offline encrypted drafts and synchronization | Conservation Officer | N | Encryption adapter, account isolation, 15-minute lease, retries/cancellation tested | PARTIAL | fieldStorage/offlineDraftStore/fieldSync; SecureStore and API; MOBILE | Native AES/SecureStore/network restart acceptance required |
| Field | Offline encrypted drafts and synchronization | Administrator | N | Encryption adapter, account isolation, 15-minute lease, retries/cancellation tested | PARTIAL | fieldStorage/offlineDraftStore/fieldSync; SecureStore and API; MOBILE | Native AES/SecureStore/network restart acceptance required |
| Field | Submit observation for review | Guest | N | Owned draft submission and Officer review exercised through real Node APIs | PASS | observations/:id/submit; plant_observation; API, WEB | Native device submission separately pending |
| Field | Submit observation for review | Visitor | N | Owned draft submission and Officer review exercised through real Node APIs | PASS | observations/:id/submit; plant_observation; API, WEB | Native device submission separately pending |
| Field | Submit observation for review | Botanist | Y | Owned draft submission and Officer review exercised through real Node APIs | PASS | observations/:id/submit; plant_observation; API, WEB | Native device submission separately pending |
| Field | Submit observation for review | Conservation Officer | N | Owned draft submission and Officer review exercised through real Node APIs | PASS | observations/:id/submit; plant_observation; API, WEB | Native device submission separately pending |
| Field | Submit observation for review | Administrator | N | Owned draft submission and Officer review exercised through real Node APIs | PASS | observations/:id/submit; plant_observation; API, WEB | Native device submission separately pending |
| Field | Edit own record subject to Officer approval | Guest | N | Foreign ownership denied; submitted/approved changes blocked; corrections resubmitted | PASS | PATCH observations/:id; observation_review; API | None in tested backend workflow |
| Field | Edit own record subject to Officer approval | Visitor | N | Foreign ownership denied; submitted/approved changes blocked; corrections resubmitted | PASS | PATCH observations/:id; observation_review; API | None in tested backend workflow |
| Field | Edit own record subject to Officer approval | Botanist | Y | Foreign ownership denied; submitted/approved changes blocked; corrections resubmitted | PASS | PATCH observations/:id; observation_review; API | None in tested backend workflow |
| Field | Edit own record subject to Officer approval | Conservation Officer | N | Foreign ownership denied; submitted/approved changes blocked; corrections resubmitted | PASS | PATCH observations/:id; observation_review; API | None in tested backend workflow |
| Field | Edit own record subject to Officer approval | Administrator | N | Foreign ownership denied; submitted/approved changes blocked; corrections resubmitted | PASS | PATCH observations/:id; observation_review; API | None in tested backend workflow |
| Field | Search plant reference database | Guest | Y | Role-filtered reference catalogue; no Admin plant access | PARTIAL | species; API, WEB; mobile plantApi | Physical mobile browsing and filters pending |
| Field | Search plant reference database | Visitor | Y | Role-filtered reference catalogue; no Admin plant access | PARTIAL | species; API, WEB; mobile plantApi | Physical mobile browsing and filters pending |
| Field | Search plant reference database | Botanist | Y | Role-filtered reference catalogue; no Admin plant access | PARTIAL | species; API, WEB; mobile plantApi | Physical mobile browsing and filters pending |
| Field | Search plant reference database | Conservation Officer | Y | Role-filtered reference catalogue; no Admin plant access | PARTIAL | species; API, WEB; mobile plantApi | Physical mobile browsing and filters pending |
| Field | Search plant reference database | Administrator | N | Role-filtered reference catalogue; no Admin plant access | PARTIAL | species; API, WEB; mobile plantApi | Physical mobile browsing and filters pending |
| Review | Review Botanist observations | Guest | N | Officer-only list/review includes authorized observation photos | PASS | observations/plant_asset; API, WEB | None in tested local workflow |
| Review | Review Botanist observations | Visitor | N | Officer-only list/review includes authorized observation photos | PASS | observations/plant_asset; API, WEB | None in tested local workflow |
| Review | Review Botanist observations | Botanist | N | Officer-only list/review includes authorized observation photos | PASS | observations/plant_asset; API, WEB | None in tested local workflow |
| Review | Review Botanist observations | Conservation Officer | Y | Officer-only list/review includes authorized observation photos | PASS | observations/plant_asset; API, WEB | None in tested local workflow |
| Review | Review Botanist observations | Administrator | N | Officer-only list/review includes authorized observation photos | PASS | observations/plant_asset; API, WEB | None in tested local workflow |
| Review | Approve/reject/flag observations | Guest | N | Validated transitions, optimistic revision and persisted decisions | PASS | observations/:id/review; observation_review; API, WEB | None in tested local workflow |
| Review | Approve/reject/flag observations | Visitor | N | Validated transitions, optimistic revision and persisted decisions | PASS | observations/:id/review; observation_review; API, WEB | None in tested local workflow |
| Review | Approve/reject/flag observations | Botanist | N | Validated transitions, optimistic revision and persisted decisions | PASS | observations/:id/review; observation_review; API, WEB | None in tested local workflow |
| Review | Approve/reject/flag observations | Conservation Officer | Y | Validated transitions, optimistic revision and persisted decisions | PASS | observations/:id/review; observation_review; API, WEB | None in tested local workflow |
| Review | Approve/reject/flag observations | Administrator | N | Validated transitions, optimistic revision and persisted decisions | PASS | observations/:id/review; observation_review; API, WEB | None in tested local workflow |
| Review | Give rejection/correction feedback | Guest | N | Feedback required for non-approval; owner sees latest comment; other user denied | PASS | observation_review.comment; GET observations; API | None in tested backend scope |
| Review | Give rejection/correction feedback | Visitor | N | Feedback required for non-approval; owner sees latest comment; other user denied | PASS | observation_review.comment; GET observations; API | None in tested backend scope |
| Review | Give rejection/correction feedback | Botanist | N | Feedback required for non-approval; owner sees latest comment; other user denied | PASS | observation_review.comment; GET observations; API | None in tested backend scope |
| Review | Give rejection/correction feedback | Conservation Officer | Y | Feedback required for non-approval; owner sees latest comment; other user denied | PASS | observation_review.comment; GET observations; API | None in tested backend scope |
| Review | Give rejection/correction feedback | Administrator | N | Feedback required for non-approval; owner sees latest comment; other user denied | PASS | observation_review.comment; GET observations; API | None in tested backend scope |
| Review | Approve own observation | Guest | N | Owner subject comparison rejects self-approval | PASS | shared assertReview; observation owner_subject; API | None |
| Review | Approve own observation | Visitor | N | Owner subject comparison rejects self-approval | PASS | shared assertReview; observation owner_subject; API | None |
| Review | Approve own observation | Botanist | N | Owner subject comparison rejects self-approval | PASS | shared assertReview; observation owner_subject; API | None |
| Review | Approve own observation | Conservation Officer | N | Owner subject comparison rejects self-approval | PASS | shared assertReview; observation owner_subject; API | None |
| Review | Approve own observation | Administrator | N | Owner subject comparison rejects self-approval | PASS | shared assertReview; observation owner_subject; API | None |
| Review | Add/edit/delete official species | Guest | N | Officer CRUD uses PostgreSQL; taxonomy selects existing genus/family | PARTIAL | species/taxonomy; species/genus/family/visibility; API, WEB | Full destructive UI confirmation and referenced-delete acceptance remains |
| Review | Add/edit/delete official species | Visitor | N | Officer CRUD uses PostgreSQL; taxonomy selects existing genus/family | PARTIAL | species/taxonomy; species/genus/family/visibility; API, WEB | Full destructive UI confirmation and referenced-delete acceptance remains |
| Review | Add/edit/delete official species | Botanist | N | Officer CRUD uses PostgreSQL; taxonomy selects existing genus/family | PARTIAL | species/taxonomy; species/genus/family/visibility; API, WEB | Full destructive UI confirmation and referenced-delete acceptance remains |
| Review | Add/edit/delete official species | Conservation Officer | Y | Officer CRUD uses PostgreSQL; taxonomy selects existing genus/family | PARTIAL | species/taxonomy; species/genus/family/visibility; API, WEB | Full destructive UI confirmation and referenced-delete acceptance remains |
| Review | Add/edit/delete official species | Administrator | N | Officer CRUD uses PostgreSQL; taxonomy selects existing genus/family | PARTIAL | species/taxonomy; species/genus/family/visibility; API, WEB | Full destructive UI confirmation and referenced-delete acceptance remains |
| Review | Upload official photos/supporting documents | Guest | N | Authorized image/PDF API; official image upload/browser publication passed | PARTIAL | assets; plant_asset; API, WEB | Full PDF upload/download browser acceptance remains |
| Review | Upload official photos/supporting documents | Visitor | N | Authorized image/PDF API; official image upload/browser publication passed | PARTIAL | assets; plant_asset; API, WEB | Full PDF upload/download browser acceptance remains |
| Review | Upload official photos/supporting documents | Botanist | N | Authorized image/PDF API; official image upload/browser publication passed | PARTIAL | assets; plant_asset; API, WEB | Full PDF upload/download browser acceptance remains |
| Review | Upload official photos/supporting documents | Conservation Officer | Y | Authorized image/PDF API; official image upload/browser publication passed | PARTIAL | assets; plant_asset; API, WEB | Full PDF upload/download browser acceptance remains |
| Review | Upload official photos/supporting documents | Administrator | N | Authorized image/PDF API; official image upload/browser publication passed | PARTIAL | assets; plant_asset; API, WEB | Full PDF upload/download browser acceptance remains |
| Review | Manage conservation information | Guest | N | Officer species conservation fields persisted through existing endpoint | PARTIAL | species/conservation_status; API, WEB | Broader field/edit reload acceptance remains |
| Review | Manage conservation information | Visitor | N | Officer species conservation fields persisted through existing endpoint | PARTIAL | species/conservation_status; API, WEB | Broader field/edit reload acceptance remains |
| Review | Manage conservation information | Botanist | N | Officer species conservation fields persisted through existing endpoint | PARTIAL | species/conservation_status; API, WEB | Broader field/edit reload acceptance remains |
| Review | Manage conservation information | Conservation Officer | Y | Officer species conservation fields persisted through existing endpoint | PARTIAL | species/conservation_status; API, WEB | Broader field/edit reload acceptance remains |
| Review | Manage conservation information | Administrator | N | Officer species conservation fields persisted through existing endpoint | PARTIAL | species/conservation_status; API, WEB | Broader field/edit reload acceptance remains |
| Review | Generate/export biodiversity reports | Guest | N | PostgreSQL aggregate rows; genuine CSV/PDF downloads in isolated workflow | PASS | reports; species/plant_record; WEB, API | Production-volume acceptance pending |
| Review | Generate/export biodiversity reports | Visitor | N | PostgreSQL aggregate rows; genuine CSV/PDF downloads in isolated workflow | PASS | reports; species/plant_record; WEB, API | Production-volume acceptance pending |
| Review | Generate/export biodiversity reports | Botanist | N | PostgreSQL aggregate rows; genuine CSV/PDF downloads in isolated workflow | PASS | reports; species/plant_record; WEB, API | Production-volume acceptance pending |
| Review | Generate/export biodiversity reports | Conservation Officer | Y | PostgreSQL aggregate rows; genuine CSV/PDF downloads in isolated workflow | PASS | reports; species/plant_record; WEB, API | Production-volume acceptance pending |
| Review | Generate/export biodiversity reports | Administrator | N | PostgreSQL aggregate rows; genuine CSV/PDF downloads in isolated workflow | PASS | reports; species/plant_record; WEB, API | Production-volume acceptance pending |
| IoT software | Register/manage sensors/devices | Guest | N | Existing isolated fixture authorization tests; hardware unchanged | PARTIAL | devices; iot_device; existing API tests | UI production integration and real devices pending approval |
| IoT software | Register/manage sensors/devices | Visitor | N | Existing isolated fixture authorization tests; hardware unchanged | PARTIAL | devices; iot_device; existing API tests | UI production integration and real devices pending approval |
| IoT software | Register/manage sensors/devices | Botanist | N | Existing isolated fixture authorization tests; hardware unchanged | PARTIAL | devices; iot_device; existing API tests | UI production integration and real devices pending approval |
| IoT software | Register/manage sensors/devices | Conservation Officer | N | Existing isolated fixture authorization tests; hardware unchanged | PARTIAL | devices; iot_device; existing API tests | UI production integration and real devices pending approval |
| IoT software | Register/manage sensors/devices | Administrator | Y | Existing isolated fixture authorization tests; hardware unchanged | PARTIAL | devices; iot_device; existing API tests | UI production integration and real devices pending approval |
| IoT software | View device status | Guest | N | Existing role grants/API fixtures; IoT views not certified | PARTIAL | devices; iot_device; API fixtures | Do not treat sample UI as real hardware acceptance |
| IoT software | View device status | Visitor | N | Existing role grants/API fixtures; IoT views not certified | PARTIAL | devices; iot_device; API fixtures | Do not treat sample UI as real hardware acceptance |
| IoT software | View device status | Botanist | N | Existing role grants/API fixtures; IoT views not certified | PARTIAL | devices; iot_device; API fixtures | Do not treat sample UI as real hardware acceptance |
| IoT software | View device status | Conservation Officer | Y | Existing role grants/API fixtures; IoT views not certified | PARTIAL | devices; iot_device; API fixtures | Do not treat sample UI as real hardware acceptance |
| IoT software | View device status | Administrator | Y | Existing role grants/API fixtures; IoT views not certified | PARTIAL | devices; iot_device; API fixtures | Do not treat sample UI as real hardware acceptance |
| IoT software | Configure alert thresholds | Guest | N | Existing Admin-only backend tests; no real threshold changed | PARTIAL | devices; iot_device thresholds; API fixtures | Real measurement/threshold plan pending approval |
| IoT software | Configure alert thresholds | Visitor | N | Existing Admin-only backend tests; no real threshold changed | PARTIAL | devices; iot_device thresholds; API fixtures | Real measurement/threshold plan pending approval |
| IoT software | Configure alert thresholds | Botanist | N | Existing Admin-only backend tests; no real threshold changed | PARTIAL | devices; iot_device thresholds; API fixtures | Real measurement/threshold plan pending approval |
| IoT software | Configure alert thresholds | Conservation Officer | N | Existing Admin-only backend tests; no real threshold changed | PARTIAL | devices; iot_device thresholds; API fixtures | Real measurement/threshold plan pending approval |
| IoT software | Configure alert thresholds | Administrator | Y | Existing Admin-only backend tests; no real threshold changed | PARTIAL | devices; iot_device thresholds; API fixtures | Real measurement/threshold plan pending approval |
| IoT software | Monitoring dashboard/sensor readings | Guest | N | Existing isolated readings permission/storage tests only | PARTIAL | readings; sensor_reading; API fixtures | Hardware and existing sample dashboard replacement deferred |
| IoT software | Monitoring dashboard/sensor readings | Visitor | N | Existing isolated readings permission/storage tests only | PARTIAL | readings; sensor_reading; API fixtures | Hardware and existing sample dashboard replacement deferred |
| IoT software | Monitoring dashboard/sensor readings | Botanist | N | Existing isolated readings permission/storage tests only | PARTIAL | readings; sensor_reading; API fixtures | Hardware and existing sample dashboard replacement deferred |
| IoT software | Monitoring dashboard/sensor readings | Conservation Officer | Y | Existing isolated readings permission/storage tests only | PARTIAL | readings; sensor_reading; API fixtures | Hardware and existing sample dashboard replacement deferred |
| IoT software | Monitoring dashboard/sensor readings | Administrator | Y | Existing isolated readings permission/storage tests only | PARTIAL | readings; sensor_reading; API fixtures | Hardware and existing sample dashboard replacement deferred |
| IoT software | Threat alerts/history | Guest | N | Existing role tests and fixtures; no physical alert generated | PARTIAL | alerts; threat_alert_history; API fixtures | Real alert acceptance requires hardware approval |
| IoT software | Threat alerts/history | Visitor | N | Existing role tests and fixtures; no physical alert generated | PARTIAL | alerts; threat_alert_history; API fixtures | Real alert acceptance requires hardware approval |
| IoT software | Threat alerts/history | Botanist | N | Existing role tests and fixtures; no physical alert generated | PARTIAL | alerts; threat_alert_history; API fixtures | Real alert acceptance requires hardware approval |
| IoT software | Threat alerts/history | Conservation Officer | Y | Existing role tests and fixtures; no physical alert generated | PARTIAL | alerts; threat_alert_history; API fixtures | Real alert acceptance requires hardware approval |
| IoT software | Threat alerts/history | Administrator | Y | Existing role tests and fixtures; no physical alert generated | PARTIAL | alerts; threat_alert_history; API fixtures | Real alert acceptance requires hardware approval |
| IoT software | Manage response records | Guest | N | Officer-only fixture response authorization; Admin denied | PARTIAL | responses; existing IoT tables; API fixtures | Physical incident/response acceptance pending |
| IoT software | Manage response records | Visitor | N | Officer-only fixture response authorization; Admin denied | PARTIAL | responses; existing IoT tables; API fixtures | Physical incident/response acceptance pending |
| IoT software | Manage response records | Botanist | N | Officer-only fixture response authorization; Admin denied | PARTIAL | responses; existing IoT tables; API fixtures | Physical incident/response acceptance pending |
| IoT software | Manage response records | Conservation Officer | Y | Officer-only fixture response authorization; Admin denied | PARTIAL | responses; existing IoT tables; API fixtures | Physical incident/response acceptance pending |
| IoT software | Manage response records | Administrator | N | Officer-only fixture response authorization; Admin denied | PARTIAL | responses; existing IoT tables; API fixtures | Physical incident/response acceptance pending |

### Additional mandatory shared-account and acceptance requirements

| Requirement | Result | Status | Evidence / remaining action |
| --- | --- | --- | --- |
| Admin creates Botanist, secure random temporary password, existing templates | Isolated provisioning/UI/API tests pass; no plaintext in API/audit/database; opaque expiry metadata | PASS | activation tests and browser first Botanist login; real delivery gate separate |
| Newly issued temporary credentials expire after ONE HOUR | Expired login, temporary session and password change fail; resend invalidates prior issue; old real accounts not reset | PASS | approved user answer; API expiry test; existing activation_tokens metadata |
| Mandatory website first change; old temporary password rejected | Browser tests pass | PASS | first Botanist/Officer tests |
| New password works for website and native password API | Same account ID/hash source; native bearer cookie separation | PASS | shared-account API test; physical app connection blocked |
| Simultaneous sessions, independent logout, service restart | Web logout preserves mobile token, mobile logout preserves web token; new HTTP service over same PostgreSQL store validates token | PASS | shared-account API test; live counts preserved after API restart |
| Botanist self account/password UI without staff dashboard | Own /account page survives reload; Admin/Officer routes and APIs reject Botanist | PASS | browser account page and route/API matrices |
| Cross-user isolation and own review feedback | Other Botanist cannot change/read owned private observation; own latest correction comment returned | PASS | backend business/security suites |
| Physical networking, camera/GPS, native AES, app restart/sync | Logic tests pass; not exercised on the intended phone | BLOCKED | Needs approved HTTPS connectivity and native device |
| Genuine face recognition and physical replay/liveness | No consented fixtures or operational replacement recognition service verified; anti-spoofing not bypassed | BLOCKED | Six genuine-face tests and real acceptance remain |
| Physical IoT | No connection, USB/serial, wiring, calibration, flashing or provisioning performed | BLOCKED | PENDING ? REQUIRES USER APPROVAL |
| Arbitrary editable permission-grant policy | Enforced policy is intentionally fixed in shared/rbac.cjs; admin can assign permitted account roles | NOT IMPLEMENTED | Requires an explicitly approved configurable-policy scope/migration; display is now accurate |
| Broader mobile Officer reference access | Native password endpoint now accepts Officer as conservation-officer; reference grants are mapped; Botanist-only creation and Admin management remain denied | PARTIAL | API and mobile permission tests pass; full physical Officer reference-screen acceptance remains pending |
| Full browser suite | Relevant non-IoT subset passes; old mock IoT/obsolete layout tests were not certified | NOT TESTED | No claim that every historical browser test passes |

### Eleven-step project status

| Step | Work | Status | Evidence | Remaining action |
| --- | --- | --- | --- | --- |
| 1 | Preserve data/configuration | PARTIAL | Original 23-table restore/rehearsal and fresh private backup restoration passed; live records preserved | Locate original SQLite backup and retain an independent off-computer copy |
| 2 | PostgreSQL migration | PASS for active storage | TLS, three private schemas, source fingerprints, preserved IDs/counts/relationships | Legacy unsupported Botanist credential needs owner-authorized recovery; not reset here |
| 3 | Application/RBAC integration | PARTIAL overall; eight audited failures repaired | 13 protected pages and core end-to-end workflow pass; 36 auth/14 backend tests | Remaining matrix PARTIAL/NOT IMPLEMENTED/NOT TESTED entries; device work separate |
| 4 | EmailJS | PARTIAL | Configuration valid; existing templates; fake-delivery activation tests; historical approved diagnostic receipt | Approval and approved recipient before ONE new real Botanist acceptance email/account |
| 5 | Private HTTPS | BLOCKED | Existing setup guide; no VPN installed/configured | Approve actual network design, host and phone setup |
| 6 | Native mobile acceptance | BLOCKED | 59 logic tests; shared password endpoint and owner-bound calls implemented | Approved HTTPS URL and physical install/test; native build not claimed |
| 7 | Face acceptance | BLOCKED | Storage/flow tests only | Consented fixtures, functional recognition backend and genuine liveness/replay acceptance |
| 8 | Physical IoT | BLOCKED / ON HOLD | Existing source/configuration preserved; fixtures only | Explicit user approval; do not connect hardware |
| 9 | Dependencies | PARTIAL | Refreshed audit: web/backend zero; mobile five high | Review upstream node-forge/Zod/Expo chain; no forced SDK migration |
| 10 | Production/recovery | BLOCKED | Read-only readiness gate shows storage/email ready, production origin/HTTPS/dependency gate false | Approved hosting/config, independent retention, restoration/monitoring and final integration acceptance |
| 11 | Deployment | BLOCKED | deploymentPerformed=false | Explicit deployment approval only after acceptance gates |

### Changed files in this stage

Application: web/src/App.vue; router/index.ts; components/LoginModal.vue and AccountProfile.vue; views/AdminDashboardView.vue, AdminProfileView.vue, AdminUserManagementView.vue, AdminModuleView.vue, PlantsView.vue, SpeciesDetailView.vue, SpeciesPlantsView.vue, PlantDetailView.vue; views/conservation/ConservationProfileView.vue, PlantSpeciesView.vue, ReviewSubmissionsView.vue, ReportsView.vue, ObservationsView.vue; data/plants.ts and plantRecords.ts; services/plantApi.ts. Existing files were reused; no new application source file or Python file was introduced.

Backend: web/server/auth.mjs, activation.mjs, http.mjs, operations.mjs; plant-conservation-backend/domain.cjs. No shared/rbac.cjs policy or live schema was changed. deploy/private-phone.Caddyfile adds only the /api/mobile/* account-service route; it was not activated. docs/mobile-private-https-setup.md describes the current approval-gated plan and replaces obsolete Codespaces/Python claims. deploy/check-readiness.mjs now loads the same private server environment as runtime; audit JSON was normalized to UTF-8 without BOM.

Mobile: mobileapp/utils/faceApi.js, faceSession.js, faceSessionLifecycle.js and plantApi.js, plus rbac.js for existing Officer reference permissions. Authenticated mobile catalogue calls now forward bearer authority and scientific scope; a transport/owner-isolation regression test verifies this. Configure EXPO_PUBLIC_AUTH_API_URL privately as the APPROVED HTTPS gateway plus /api/mobile for Node shared-password/account functions; face camera operations still use EXPO_PUBLIC_FACE_API_URL and require a functional recognition service. Configure EXPO_PUBLIC_API_URL as the approved HTTPS plant API origin; the old hard-coded hosted fallback was removed. No actual URLs/VPN/hosting configuration was changed.

Tests: web/server/api.test.mjs, activation.test.mjs; web/tests/browser/system.spec.mjs; plant-conservation-backend/test/business.test.cjs; mobileapp/scripts/face-session.test.mjs, rbac.test.mjs and plant-session.test.mjs. Existing offline/session tests caught missing lifecycle functionality; repairs now pass the suite. Reports: this checklist and final-dependency-audit.json. Backup/checkpoint artifacts remain under existing ignored private directories. No secrets are included here.

### Final acceptance

The project is NOT fully accepted and NOT deployed. Local audited integrations pass in isolated PostgreSQL-backed services. Hardware, genuine biometrics, approved private HTTPS/native installation, real Botanist email acceptance, independent backup retention, remaining mobile advisories and unverified matrix portions remain explicit blockers or follow-up work.
