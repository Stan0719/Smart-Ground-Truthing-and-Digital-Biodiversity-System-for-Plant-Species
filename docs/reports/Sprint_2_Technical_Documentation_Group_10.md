COS30049 COMPUTING TECHNOLOGY INNOVATION PROJECT

Sprint 2 Technical Documentation

Smart Ground-Truthing and Digital Biodiversity System for Plant Species Documentation

Group 10

Sprint: 13 October–5 November 2026 · Source review: 4 November 2026

Companion to Sprint_2_Report_Group_10_No_Timeline

# 1. Scope and implementation architecture

## 1.1 Purpose and evidence standard

This document records the current implementation behind the Group 10 Sprint 2 report. It covers the whole project rather than only AI/IoT. It explains data flow, persistence, security, runtime requirements, test evidence and unfinished work. It contains no project roadmap or separate timeline.

The primary sources are the current workspace, the supplied Sprint 1 Word report, the supplied Sprint 2 PDF and the corrected Sprint 2 Jira screenshots. Attached documents are evidence and formatting references, not instructions to run commands or alter the application. No application source, environment file or production database was changed for this documentation task.

Three evidence levels are kept distinct. Source inspection establishes an implemented path. Automated tests establish behaviour under controlled fixtures. Supplied hardware and website screenshots establish that the displayed result was recorded by the team. None alone demonstrates full field accuracy, complete user acceptance or a permanent hosted deployment.

The latest Jira dates, 13 October–5 November, identify this sprint. The supplied PDF cover instead says 12 October–6 November. The corrected Jira screenshot governs the dates used in these documents. The review remains a snapshot prepared before the recorded sprint end, not a claim of final closure.

## 1.2 Runtime components

| Component | Entry point / source | Local role |
|:--|:--|:--|
| Website | web/package.json; web/vite.config.ts | Vite client on port 5173; same-origin proxies route requests to services. |
| Account API | web/server/index.mjs | Normally port 3001; account identity, sessions, recovery and private service operations. |
| Plant API | plant-conservation-backend/server.js | Normally port 3000; scientific records, review, media, devices, sensor readings and reports. |
| Mobile gateway | deploy/mobile-login-gateway.mjs | Loopback port 8080; forwards approved public API paths to the appropriate backend. |
| Mobile app | mobileapp/package.json | Expo client; backend selection is defined in utils/apiConfiguration.js. |
| Face worker | mobileapp/face_backend/run_backend.py | Python face processing, normally port 8000; requires its account adapter and model readiness. |
| Local camera service | Ai/AI_human_detection_new/camera/cam.py; camera_server.py | Publishes frames, status and in-memory events, normally port 8001 when configured. |
| BioCLIP API | Ai/Ai_duplication_BioCLIP2/api.py | Loopback port 8002; local pretrained embedding inference. |
| Sensor bridge | IoT/PlantPrototype/serial_bridge.py | Owns the USB serial port, queues readings and uploads them. |
| Combined launcher | integration_ai/iot/connect_camera_iot.py | Starts the uploader and camera with a shared sensor/plant configuration. |

*Table 1 – Component entry points and local responsibilities.*

The current architecture is a development setup with several local processes. Cloudflare can expose the loopback mobile gateway through temporary HTTPS. It does not upload the application to hosting, run Python after the laptop shuts down, store video clips or replace PostgreSQL. A hosted deployment needs reviewed service hosting and camera routing of its own.

## 1.3 Shared persistence and schema boundaries

Plant-domain connections use the configured PLANT_PG_SCHEMA through transaction-local search paths. Account storage defaults to the private plant_auth schema, and biometric storage defaults to a distinct plant_face schema. The repository also contains legacy public-schema data paths. A common database host does not guarantee that two routes read the same tables.

| Data group | Important records / relationships | Implementation reference |
|:--|:--|:--|
| Taxonomy and species | Family, genus, conservation status, species and species-visibility policy. | schema.postgres.sql; migrations/001-rbac-foundation.sql; species-requests.cjs. |
| Plant documentation | plant_record, plant_location, plant_observation and protected plant_asset bytes. | domain.cjs; uploads.cjs; plant-submissions.cjs. |
| Submission integrity | plant_submission_receipt links account and client key to a payload hash and saved result. | migrations/006-atomic-plant-submissions.sql. |
| QR inventory | Public QR inventory is linked to the correct plant record relation. | migrations/003-plant-qr-inventory.sql; 007-qr-plant-reference.sql. |
| Review and change history | Decisions, revisions, proposed changes and version snapshots. | record-changes.cjs; record-version-history.cjs; migrations/008 and 009. |
| Monitoring | iot_device, sensor_reading, ingestion receipts, threat_alert_history and responses. | migrations/002-field-review-iot.sql; iot.cjs. |
| Accounts and sessions | Users, Visitors, sessions, activation state, reset records and authentication events. | web/server/postgres.mjs; auth.mjs; recovery.mjs. |
| Biometric data | Private face-processing persistence and account linkage. | mobileapp/face_backend/postgres_store.py; web/server/face-service.mjs. |

*Table 2 – Persistent data areas; names identify code contracts rather than certify a particular deployed schema.*

Database implementation delays in Sprint 1 carried shared-storage and integration work into Sprint 2, as recorded in the earlier report and confirmed by the group. This explains the dependency carryover. It does not mean that current data is missing or that every unresolved hardware, AI or usability issue was caused by the database.

Migrations are separate reviewed operations. Runtime connection code does not prove that every migration has been applied correctly to the live deployment. QR foreign-key alignment is particularly important because a constraint referencing a legacy plant table can reject an otherwise valid new submission. Isolated tests cover the reproduced failure and targeted repair.

# 2. Module implementation details

## 2.1 Online plant registration

The main Add Plant screen uses plantApi to request POST /api/plant-submissions. The request carries an existing species ID or complete new-species proposal, the entered plant name, observation content, coordinates, QR inventory selection, a client key and the required photographs. An independent species proposal can also include its species photograph.

The server validates allowed fields, required content, GPS values, QR availability and photo count. JPEG/PNG input is decoded with bounded size and pixel checks, orientation is corrected, and stored image bytes are normalised. At least three plant photos are required. Photos exceeding configured input limits are rejected rather than silently dropped.

The transaction locks the owner's submission identity and the selected QR inventory row. It creates or resolves the species, creates the plant and location, assigns the QR, writes the initial Pending Review observation and photos, stores any species request and records audit events. It then stores the receipt and commits. A storage failure rolls back related writes.

Identical retries reuse the owner's client key and payload hash, returning the saved result. Altered content with an already-used key is rejected rather than becoming a different hidden submission. The mobile screen guards repeated taps and retains inputs after failure. These guarantees depend on the current submission endpoint, not on every older plant form.

## 2.2 Offline field collection and synchronisation

The separate FieldCollection screen uses fieldStorage, offlineDraftStore and fieldSync. A draft contains its owner context, intended path/method, client key, body and assets. The storage layer supports protected local drafts, storage limits and recovery after interrupted writes. It must preserve previously saved records when a new write fails.

syncDrafts restores the authoritative session and checks that the current Botanist owns the drafts. It uploads or updates the record, uploads associated photos, then calls the submit operation. Only after confirmation does it remove the matching local draft. A newer edit of the same draft must not be deleted by completion of an older upload.

The implementation retains failed drafts and stable upload identities. Tests cover partial photo failures, response loss after an update, account changes, notification failures and retry recovery. Notification storage is deliberately prevented from changing the success or failure of the actual synchronisation operation. A local “saved” message is distinct from successful server submission.

Offline access is bounded to an owner draft lease and device unlock conditions. It does not create valid API authority while offline. Tests cover expiry, clock rollback, logout and authorisation changes during asynchronous draft access. Device-level operation must still be verified with the actual Expo app and protected storage implementation.

The main Add Observation screen is a separate unresolved path. It imports addPlantObservation from data/mockData.js, which pushes into a local array. Its “Pending Review” message is not proof of a database submission. SCRUM-16 being Done describes the synchronisation deliverable; it does not make this other screen persistent or close the still-open offline tasks in Sprint 1.

## 2.3 Officer review, publication and reports

ReviewSubmissionsView loads authoritative observations and evidence, preserving raw UUIDs rather than deriving identities from display labels. The Officer can approve, reject, flag or request correction according to supported transitions. Non-approval decisions require feedback. Review requests include the expected revision, and a conflict triggers a refetch rather than silently overwriting a newer decision.

A species request can be a dependency of plant approval. Pending, rejected, malformed or ambiguously linked requests must not be treated as approved species. The Officer explicitly chooses visibility when approving the proposed species. The interface waits for authoritative linkage to the resulting species before unlocking the related plant decision.

Shared RBAC separates ownership, scientific review, public publication and administration. Botanists can create records and edit permitted owned observations. Officers review protected scientific evidence. Administrators manage accounts/devices and thresholds but do not inherit Officer approval. Public responses contain only data allowed by the publication and visibility policy, with exact coordinates projected away for roles without that permission.

The implemented report service requests /api/data/reports and validates the backend response. The supported species/approved-plant summary uses real rows and the server generation timestamp for CSV/PDF exports. Unsupported report types are blocked rather than generated from fixtures. This verifies that report path, not every analytics or dashboard card in the website.

The public knowledge adapter clears its previous data before loading permitted species, plant records and protected media. PlantsView's legacy variable name prototypePlants does not mean those refreshed records are fixtures. Its search and sort act on the retrieved catalogue. The Officer map also retrieves plants and scientific species metadata through API contracts instead of inventing map coordinates.

Some summaries still need integration. Administrator dashboard cards contain fixed example totals, and the Officer dashboard's alert aggregation still requests /api/iot/alerts rather than the canonical alert-history path used by ThreatAlertsView. Those counts are not evidence that live camera or canonical sensor events have reached every dashboard. The final demonstration should distinguish these summaries from the connected detail screens.

## 2.4 Security, recovery, biometrics and language

Current account password creation uses scrypt. Server validation checks status, session expiry and forced-password-change requirements. Credentials are not established by a browser role selection. The account service persists session and audit state, and shared permission checks protect plant APIs independently of visible navigation controls.

Recovery uses a random six-digit OTP, an HMAC-derived stored value, a five-minute expiry and a five-attempt bound at confirmation. Request throttling and single-use consumption reduce repeated guessing and replay. Accepted reset operations update credentials and revoke prior access. Email delivery is asynchronous and environment-dependent; an HTTP acceptance response does not prove receipt.

The inactivity policy uses a thirty-day boundary and eligible server-side activity timestamps. It removes existing sessions when an account is suspended. Administrator reactivation gives a fresh window without restoring old tokens. The policy protects the final active, fully activated Administrator and treats temporary-password and legacy states separately.

The face server initialises SFace recognition, Fasnet anti-spoofing and OpenCV detection through DeepFace before reporting readiness. Recognition outcomes are linked to an authoritative account through private signed operations. A model loading successfully is not a successful biometric login, and anti-spoofing may reject genuine users. Formal false-acceptance and false-rejection results are not supplied.

English/Bahasa Melayu language resources are loaded locally. Preferences persist, unsupported stored choices fall back to English, and newer user choices cannot be overwritten by a slow restore. Canonical statuses and scientific records are preserved; unrecognised server messages are not automatically machine-translated. Physical-device language and accessibility review remain part of usability acceptance.

## 2.5 Current ESP32 hardware and firmware

The present sketch retains the ESP32, DHT11, soil and raindrop analogue probes, MPU6050 and LED. The supplied PDF confirms removal of the sound sensor and LCD during hardware refinement. The bridge retains compatibility with older sound-labelled frames, which does not mean the current kit still contains that sensor.

| Parameter | Inspected value | Interpretation |
|:--|:--|:--|
| USB serial baud | 115200 | Must match the serial bridge; only one process should own the COM port. |
| Soil / rain / DHT sampling | Configured at 1 second | Configuration interval, not an independently measured sensor response time. |
| Movement acceleration threshold | 1.8 m/s² change from gravity magnitude | Tuning parameter, not validated plant-damage sensitivity. |
| Movement rotation threshold | 20 degrees/second | Converted from Adafruit gyroscope radians/second. |
| Quiet period | 1500 ms | Movement state remains active until sufficiently quiet for this period. |
| Startup MPU check | mpu.begin() sets mpuReady | Not continuous proof that the MPU remains physically connected. |

*Table 3 – Firmware settings and their practical interpretation.*

The sketch records startup axis averages, but the inspected movement formula uses acceleration magnitude relative to 9.81 and total rotation rate. Soil/rain labels use configured analogue thresholds. Without calibration, those values must not be described as moisture percentages, rainfall depth or universal environmental limits. Probe behaviour also depends on the actual hardware and conditions.

DHT failures do not clear the last valid reading in the inspected sketch. MPU readiness is established at startup, and ongoing getEvent calls do not update that readiness flag through a demonstrated health check. The PDF describes disconnection experiments, but the code does not establish reliable continuous disconnect recognition. Firmware-to-dashboard health remains an explicit acceptance issue.

## 2.6 Serial bridge, persistence and live movement

The bridge recognises sectioned firmware dashboards and older flat PlatformIO output. It maps temperature, humidity, soil, rain and movement to the canonical reading fields. “No movement” becomes zero, “DETECTED” becomes one, and unknown text does not invent a reading. Parser state is reset between frames to avoid carrying an earlier frame's values into a newer one.

Complete frames are committed to a private SQLite outbox before HTTP upload. Each retains its original capture metadata and client key across retries. The bridge rejects remote HTTP origins, redirects and ambiguous credential-bearing URLs; exact loopback HTTP is permitted for a backend on the same computer. Do not publish device keys in code, reports or shell examples.

POST /api/device/readings verifies the registered active Sensor and device key. It writes the reading and ingestion receipt, updates last-seen state and evaluates configured thresholds. Retried receipts must not create repeated readings or alerts. Stored capture metadata is included in the reading JSON rather than requiring another schema column.

GET /api/device/movement accepts only the Sensor's own key and matching plant assignment. It derives moving, stationary, stale or unavailable from the latest reading. Both capture and receipt times matter. A recent retry of an old frame must remain stale, and small or excessive future-time discrepancies are treated according to the explicit freshness checks. Samples beyond five seconds cannot enable a combined camera alert.

The website sensor adapter now reads /api/data/devices and canonical per-device reading history. It maps missing values to unavailable, preserves valid zero readings and exposes whether additional history exists. Current sensor-page loading is request-driven; a visible page does not imply a guaranteed continuous push stream or automatic refresh of every table.

## 2.7 Camera detection, correlation and recording

The camera combines YOLO human/animal tracking, YOLO-World plant boxes and YOLO pose wrist keypoints. The current wrist threshold is 0.35, the plant threshold 0.25 and the proximity margin 24 pixels. These are implementation settings, not measured confidence that physical contact occurred. Track IDs are local detection identities, not registered plant IDs or recognised people.

An operator fixes the physical plant region using P or dragging. The configured CAMERA_PLANT_ID must match the plant to which the Sensor is assigned. Wrist proximity must persist for two seconds in that region, and the authenticated movement client must currently report moving. Camera-only or MPU-only activity cannot qualify. Clearing/changing the region resets contact state; regions are not persisted across restart.

IoTMovementSource polls in the background and expires its cached result. The camera does not open the USB port; it obtains movement from the backend. The combined launcher is a convenience wrapper around the uploader and camera, and preflights the device/plant binding. It does not replace the backend, website or model dependencies and must not be run alongside another uploader owning the same COM port.

The camera HTTP service publishes annotated MJPEG frames, status and a bounded in-memory event list. The website uses /camera-api through the Vite development proxy. Status becomes Offline when frames are unavailable or stale. Displaying a green person box does not increment qualifying-event counts, and combined event confidence remains unavailable rather than being fabricated from unrelated model scores.

Qualifying contact starts a local MP4. Recordings use 640×360 scene output and configured 60 FPS playback timing, with held frames during slow inference. That setting does not prove 60 newly analysed frames per second. Ordinary contact loss has a five-second tail; stale/unavailable sensor state finishes the clip immediately. Pausing, changing region and normal shutdown also finalise recording.

Current clips remain under Ai/AI_human_detection_new/camera/recordings. A database video_path column is only a possible reference field; it does not store video bytes or automatically create an upload and playback path. The current camera does not persist these live events/clips into canonical alert history. The separate prototype camera events in ThreatAlertsView remain labelled demonstration content and cannot be submitted as canonical sensor responses.

## 2.8 BioCLIP candidate retrieval and website contract

The engine loads hf-hub:imageomics/bioclip-2 through OpenCLIP, using CUDA when available and CPU otherwise. It corrects orientation, converts RGB, applies model preprocessing and generates normalised image embeddings. Ranking uses cosine similarity. Cache identity includes model/pipeline details and file metadata; changed photos generate different cache keys.

The GUI compares a query with its chosen folder gallery and excludes the exact query path. The website route instead selects stored database photos, so folder filenames are not its record identity. It excludes the query plant entirely, including older observations of that same plant. Different plants with visually identical photos can still appear and require review.

| Stage | Current contract |
|:--|:--|
| Website request | GET /api/data/observations/:rawId/similarity, with the existing same-origin session. |
| Backend route | GET /api/observations/:id/similarity, guarded by observations.review. |
| Query photo | One linked JPEG/PNG from that observation, preferring client key photo:0. |
| Reference gallery | Other approved plants, approved observations and approved assets, with allowed visibility and approved species. |
| Gallery bound | One image per plant; at most 50 plants in plant-ID order. This is not exhaustive retrieval over larger databases. |
| Inference | Backend normalises images, sends base64 to loopback POST /search on port 8002 and waits up to three minutes. |
| Model response | Exact model identifier plus one finite, unique, known-ID cosine score for every submitted reference. |
| Website result | Top five ranks, display plant IDs, real observation IDs, available names, similarity and optional distance. |

*Table 4 – Stored-photo comparison contract.*

The Node backend verifies the model identifier, reference IDs, uniqueness and finite scores within −1 to 1. Missing observations or photos, empty approved galleries, service outages and invalid results receive explicit errors. There is no fallback to demonstration scores. The Python service accepts one inference at a time and returns busy rather than running unbounded concurrent model calls.

Distance uses valid numeric observation coordinates, falling back to the stored plant location when the observation pair is unavailable. A Haversine calculation produces metres. A genuine zero is preserved; no coordinates means no distance. This does not account for GPS uncertainty, habitat barriers or whether the two records represent the same specimen.

The website validates record identity and candidate structure, displays loading/errors and ignores stale responses after selection or refresh. Results are cached for the current page session and invalidated by relevant review changes or reload. They are not persisted analyses, automatic approvals or duplicate rejection decisions. Displayed high/moderate/low bands are review guidance rather than empirically calibrated duplicate thresholds.

# 3. Verification, backlog traceability and remaining work

## 3.1 Verification record

| Verification group | Observed result | Scope |
|:--|:--|:--|
| Complete plant-backend suite | 155 tests: 153 passed initially; two sandbox-blocked subprocess cases passed on targeted rerun. | SQL fixtures, registration, review, migrations, RBAC, ingestion, movement gating and similarity contracts. |
| Affected backend rerun | 21 passed; overlaps the 155-test suite. | rbac-preflight.test.cjs and security-audit.test.cjs; do not add to unique suite count. |
| Website integration selection | 50 passed. | Review, IoT adapter/history, sensor-alert responses and report export inputs. |
| Mobile integration selection | 45 passed. | Add Plant, offline draft safety/sync, localisation and session/face-flow handling. |
| Account/security selection | 29 passed. | Inactivity, activation, authentication, OTP recovery and signed face-service adapter. |
| Camera selection | 18 passed. | Contact timing, region behaviour, recorder timing, HTTP publication and movement-client failure states. |
| Serial uploader | 24 passed after sandbox-access rerun. | Firmware parsing, queue persistence, retry, redirect rejection and serial ownership boundary. |
| BioCLIP unit checks | 4 passed in this session's integration work. | Ranking, feature validation, recursive scanning and cache invalidation. |
| Web build/type check | Passed in this session's integration work. | Bundle-size warning is advisory; no physical browser workflow certified. |
| Live local BioCLIP protocol | Synthetic-image request passed. | Identical image scored approximately 1; confirms protocol, not specimen accuracy. |

*Table 5 – Evidence; reruns and nested test groups must not be treated as additional independent acceptance trials.*

No new hardware flashing, live database migration or device-key change was required for this report. Automated examples use synthetic data and isolated fixtures. The screenshots in the supplied PDF show project demonstrations, but do not supply a measured AI evaluation, a repeated disconnect experiment log or a complete physical phone-to-website acceptance record.

## 3.2 All twenty-nine Jira items

| Jira | Screenshot status | Code/evidence interpretation and remaining acceptance |
|:--|:--|:--|
| 213 Duplicate plant detection | Done | Website-connected BioCLIP ranking exists; specimen-level accuracy evaluation remains under item 34. |
| 22 Environmental sensor collection | Done | Firmware and supplied hardware images show collection; calibration and health limits remain. |
| 211 Field-data validation | In Progress | Backend and form validators exist; verify complete workflow coverage and remaining mock path. |
| 16 Cloud synchronisation | Done | Field draft queue/sync exists and tests pass; physical offline/reconnect demonstration remains useful evidence. |
| 219 Functional testing/fixes | In Progress | Several suites pass; broad completion and defect acceptance remain open. |
| 218 Mobile/backend/database integration | Done | Atomic Add Plant and backend paths are implemented; Add Observation remains a separate gap. |
| 220 Completed prototype demonstration | In Progress | Screenshots exist; no final whole-system demonstration sign-off is supplied. |
| 25 System integration testing | In Progress | Connected SQL/HTTP fixtures pass; physical system scenarios remain. |
| 26 Usability testing | In Progress | No participant protocol, sample or measured findings supplied. |
| 34 AI performance/field usability | In Progress | No labelled specimen benchmark, retrieval metrics or false-alert rates supplied. |
| 27 Final integration/testing | In Progress | Cannot close while the listed integration and evaluation limits remain unresolved. |
| 234 Biometrics | Done | Account-linked face processing exists; real acceptance/error rates are not established by that status. |
| 235 Auto detect prototype | Done | Detector and fixed-region workflow exist; does not imply fully autonomous plant identification. |
| 236 Account inactivity | Done | Thirty-day server policy and relevant account tests pass. |
| 237 Translation | Done | English/Malay resources and controlled-value display preserve underlying record semantics. |
| 238 PostgreSQL configuration | In Progress | Connection code exists; deployment-specific configuration and operational evidence remain open. |
| 239 Schema investigation | In Progress | Domain/auth/face boundaries and legacy relations require reconciliation evidence. |
| 240 Database migration | In Progress | Reviewed scripts exist; applying and checking a target deployment is a separate operation. |
| 241 Database permissions | In Progress | RBAC/preflight code and tests exist; live role privileges and scope remain to be documented. |
| 242 Backend/Supabase integration | In Progress | PostgreSQL integration exists; endpoint configuration is not proof of completed platform setup. |
| 243 Database testing/troubleshooting | In Progress | Current fixture checks pass; deployment data, backup/restore and recovery acceptance remain. |
| 275 AI/IoT integration | Done | Camera reads plant-bound movement through the API; physical combined cases still need recorded evidence. |
| 276 External camera integration | Done | Website stream/proxy exists; local routing is not permanent hosted camera access. |
| 277 Sensor/device status enhancement | In Progress | Unknown/stale states exist in software; firmware runtime-health reporting remains limited. |
| 279 IoT system testing | Done | Hardware experimentation is described in the supplied PDF; full repeatable results are not included. |
| 280 Hardware troubleshooting | In Progress | Soil/rain status detection and runtime disconnect behaviour remain unresolved. |
| 281 Serial communication reliability | Done | Parser/outbox/retry logic exists and all 24 bridge tests pass. |
| 282 AI troubleshooting | Done | Runtime and detection handling improved; no resulting accuracy percentage is established. |
| 283 AI integration testing | To Do | Retain this status; isolated software tests do not constitute completion of the Jira acceptance item. |

*Table 6 – Full status traceability; numeric keys carry the SCRUM- prefix.*

## 3.3 Acceptance scenarios still requiring evidence

| Scenario | Required evidence / expected outcome |
|:--|:--|
| Real online registration | Botanist submits photos/GPS/QR; same IDs and bytes are retrieved by the Officer after restart. |
| Offline restart/reconnect | Draft and photos survive; owner unlocks; upload completes once; repeated retries create no duplicates. |
| Remaining observation screen | A visible Add Observation submission is persisted rather than appended to mockData. |
| Review conflict | Two review clients cannot overwrite each other; losing client sees authoritative state and must acknowledge recovery. |
| Species dependency | Unapproved species cannot silently unlock plant publication; explicit visibility is retained. |
| Shared sensor records | Compare actual serial reading with canonical database and website history; zero and unavailable remain distinct. |
| Dashboard consistency | Replace static Administrator totals and reconcile Officer legacy alert aggregation with the intended canonical data source. |
| Stationary MPU + wrist | No combined alert. |
| Moving MPU without wrist | No combined alert. |
| Both conditions | Qualifying wrist timing plus fresh bound movement produces a reviewable alert and local clip. |
| Unplug/reconnect | Stale/unavailable state prevents alerts; a new healthy reading is needed to resume. Inspect firmware's health flag limits. |
| Old outbox backlog | Retried old movement is stored as history but cannot reopen the live gate. |
| Camera restart | Document that memory events clear and clips remain local; do not present prototype history as recovered events. |
| AI retrieval | Use labelled same-specimen/different-view and same-species/different-specimen pairs; record top-k retrieval and failure cases. |
| Biometric access | Record genuine-user completion, spoof rejection, false rejection and password fallback on the target phone/runtime. |
| Usability | Record tasks, participants, completion/errors and feedback; screenshots alone are insufficient. |
| Database recovery | Verify the intended backup and a controlled restore; archive validation alone is not restoration evidence. |

*Table 7 – Remaining acceptance scenarios; no dates or execution timeline are asserted.*

## 3.4 Jira and reporting interpretation

The current board contains 13 Done, 15 In Progress and 1 To Do item: 29 total. Thirteen divided by twenty-nine is 44.8% by item count. The scope log shows fourteen additions and a commitment increase from fifteen to twenty-nine. These counts do not establish equal effort per task or a measured velocity.

The burndown screenshot's endpoint is not numerically reconciled with the sixteen non-Done items in its lists. No complete issue-history export was provided, so an exact daily reconstruction would be invented. The report discusses the observed shape, records the discrepancy and uses the current list statuses for its summary. No replacement daily burndown or roadmap has been fabricated.

# 4. Operation and handover

## 4.1 Website and BioCLIP

Run these from the repository root in separate PowerShell terminals. Reuse existing service terminals instead of starting duplicate listeners. The website dev command starts both its account server and Vite. Existing environment configuration must point to the intended database and contain valid private server settings; no private values belong in this document.

```powershell
npm.cmd --prefix plant-conservation-backend start
```

```powershell
npm.cmd --prefix web run dev
```

```powershell
& ".\Ai\Ai_duplication_BioCLIP2\.venv\Scripts\python.exe" -B ".\Ai\Ai_duplication_BioCLIP2\api.py"
```

Wait for BioCLIP readiness. Sign in as a Conservation Officer, open Review Submissions and choose Check similarity. The query needs a stored JPEG/PNG and at least one other eligible approved reference plant with a photo. A missing gallery should produce a clear error rather than dummy candidates. The GUI's folder gallery does not populate database reference records.

## 4.2 Mobile connectivity

The current mobile gateway command is below. It routes account requests to port 3001, plant requests to port 3000 and /face requests to port 8000. It does not start those services. Password-based mobile operation requires the account and plant services; face functionality additionally requires its configured account adapter and ready Python face worker.

```powershell
node .\deploy\mobile-login-gateway.mjs
```

On this computer, cloudflared was found at the installed path below. A temporary tunnel is one way to reach the local gateway from a phone. The command must remain running; a new invocation may produce a different hostname. Do not hard-code the example hostname into shared source.

```powershell
& "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://127.0.0.1:8080 --no-autoupdate
```

In the Expo terminal, set the current address, then start the app. The current API selector derives plant, authentication and face paths from EXPO_PUBLIC_BACKEND_URL_DEVELOPMENT. Process environment values can override an edited .env.local file, so check the terminal's active value when an old hostname persists.

```powershell
$env:EXPO_PUBLIC_API_ENV = 'development'
$env:EXPO_PUBLIC_BACKEND_URL_DEVELOPMENT = 'https://YOUR-CURRENT-HOST.trycloudflare.com'
npm.cmd --prefix mobileapp start -- --clear
```

The Windows face-start script in the repository references .venv-win, while this workspace has used another runtime location and a short-path workaround. Its documentation is incomplete. Do not assume that script is ready solely because it exists. Confirm the actual configured Python 3.11 runtime and account adapter before including face login in a final demonstration.

## 4.3 Combined camera and USB kit

Keep the physical kit wired to its current firmware. Close PlatformIO/Arduino serial monitors before collection. Use a Python environment containing both the camera dependencies and pyserial; the BioCLIP virtual environment is not automatically the camera environment. The backend must already be running and the Sensor assigned to the intended plant.

```powershell
python -B .\integration_ai\iot\connect_camera_iot.py --port COM_PORT_FROM_LIST --plant PL001 --device-id REGISTERED_SENSOR_ID --api-origin http://127.0.0.1:3000 --camera-index 0
```

Replace the port and Sensor identifier. The launcher prompts privately for its provisioning key if not already configured. PL001 is an example; use the plant physically attached to that MPU. The launcher starts one uploader and one camera. Do not separately start serial_bridge.py at the same time. Select the region with P, and use Q to finalise recording and stop the pair.

| Check | Expected interpretation |
|:--|:--|
| GET http://127.0.0.1:3000/health | Plant API reports ready; does not by itself prove all domain data or migrations. |
| GET http://127.0.0.1:8001/camera-status | Camera status reflects published frames, not proof that a combined event occurred. |
| GET http://localhost:5173/camera-api/camera-status | Confirms the Vite proxy reaches the local camera service. |
| GET http://127.0.0.1:8002/health | BioCLIP service/model ready; not proof of a valid database gallery. |
| Camera MPU overlay | moving, stationary, stale or unavailable; inspect the reported device and plant binding. |
| Sensor history | Canonical readings retain values and timestamps; a newly delivered old frame must not look live to the camera. |

*Table 8 – Local diagnostic checks.*

## 4.4 Reproducible checks and handover material

The commands below reproduce the principal Node checks used for this report. Python camera tests run from Ai/AI_human_detection_new, and BioCLIP unit tests run inside its own environment. These commands use isolated fixtures; they are not instructions to migrate or seed the live database.

```powershell
npm.cmd --prefix plant-conservation-backend test
```

```powershell
node --test --test-isolation=none web/tests/reviewIntegration.test.mjs web/tests/iotMonitoringIntegration.test.mjs web/tests/threatAlertsIntegration.test.mjs web/tests/reportingIntegration.test.mjs
```

```powershell
node --test --test-isolation=none mobileapp/scripts/field-sync.test.mjs mobileapp/scripts/offline-recovery.test.mjs mobileapp/scripts/add-plant-workflow.test.mjs mobileapp/scripts/localization.test.mjs mobileapp/scripts/face-login-flow.test.mjs mobileapp/scripts/face-session.test.mjs
```

```powershell
python -B -m unittest discover -s IoT/PlantPrototype -p test_serial_bridge.py -v
```

Handover should retain both report files, the source modules, reviewed migration scripts, the latest Jira export and reproducible test output. Add actual acceptance records for the remaining physical and user scenarios. Keep credentials, encryption keys, face data and private outbox contents outside submitted evidence. Source availability and successful fixture tests support progress; final acceptance remains tied to the explicitly scoped system behaviour.
