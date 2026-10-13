# Free local camera face-login prototype

FACEIO has been removed. This uses Expo Camera in the mobile app and DeepFace on your own computer. No recognition-service account, subscription, hosted camera page, or phone biometric enrollment is needed. Your computer must stay running. This is camera-based recognition, not Apple's Face ID.

## Status

The account/session logic is tested with a fake matcher. Model loading and inference have been exercised on synthetic inputs and a public sample image. Your actual Expo camera capture, live enrollment, recognition accuracy and spoof resistance remain unverified. Do not use for real sensitive accounts until those checks and security review pass. A one-time challenge prevents reusing an attempt, but does not prove that an uploaded photo is newly captured. DeepFace's optional anti-spoofing is not a guarantee against replay/deepfakes. The cosine threshold (0.30) requires validation with representative users. Password login remains available.

## 1. Start the backend on your computer

Use Python 3.11 for this setup. The current workspace Python 3.14 is unsuitable for assuming TensorFlow compatibility. From the project root:

```bash
cd mobileapp/face_backend
python3.11 -m venv .venv
source .venv/bin/activate
python setup.py
python server.py --create-user
bash start.sh
```

On Windows use `py -3.11 -m venv .venv`, then `.venv\Scripts\activate` instead of the first two commands. Enter your account email, a password with 12+ characters, name and role (`botanist` or `visitor`) when prompted. Password input is hidden. Use invented test accounts initially.

Accounts are created on the server, not copied from the app's hardcoded admin or visitor storage. With the backend enabled, BOTH password and face login use these server accounts. Provisioning is an operator command; the phone cannot grant itself an account or role. Existing local visitor registration/reset features do not update this separate prototype database.

Server startup downloads and checks face and anti-spoofing models before accepting requests; this can take several minutes. Wait for the listening message. Python dependencies and model weights have their own licenses; review them before deployment.

## 2. Give the phone a reachable HTTPS backend address

The app requires HTTPS for credentials and face photos. If running this project in Codespaces, forward port **8000**, make it accessible to your phone, and copy its HTTPS URL. Keep that access available only during your test. Run `FACE_BIND_HOST=0.0.0.0 bash start.sh` in your own terminal if your forwarding setup needs it. Leave that terminal open. The helper stays in the foreground; it does not start a hidden persistent public service.

For a local computer, use a trusted HTTPS tunnel or configure local TLS. `localhost` on the phone is the phone, not your computer. Prefer a private local network with TLS or a managed tunnel that authenticates the phone with its supported credentials. A GitHub-private Codespaces port requires GitHub tunnel authentication; the mobile account token is not a GitHub token. Do not embed GitHub tokens in Expo public variables. In this session public port access was explicitly approved for temporary testing; it is not a production default. Do not widen access further and return it to Private after testing.

In `mobileapp/.env.local` preserve existing EmailJS settings and add:

```env
EXPO_PUBLIC_FACE_API_URL=https://your-reachable-backend-address
```

Remove old `EXPO_PUBLIC_FACEIO_PUBLIC_ID` and `EXPO_PUBLIC_FACEIO_PAGE_URL` entries if present. The URL is public configuration, not a secret.

## 3. Open the app and enroll

In another terminal:

```bash
cd mobileapp
npm install
npx expo start --tunnel
```

Use a compatible Expo Go release. Expo Camera is included in Expo Go; actual phone testing is still needed. No paid Apple membership is needed just to write/test this camera approach through Expo Go. Installing a standalone custom iPhone build still requires signing.

1. Enter the SERVER account email/password.
2. Enable **Register my face after password login** and tap Login.
3. Allow camera access. Read the consent text, then tap **Agree and register my face**.
4. Backend requires exactly one face and enables anti-spoofing; a failure never falls back to accepting the photo.
5. Log out, tap **Sign in with face**, then **Scan and sign in**. No password is required for a successful registered-face match. The app revalidates the returned short-lived session before entering.
6. To delete a template, enter the server email/password on Login and tap **Remove my face**. This also revokes existing backend sessions.

The app does not persist camera session tokens. Its current navigation keeps user state in memory; this prototype does not add protected plant APIs or persistent session restoration. Password-login sessions expire after eight hours. Logout from the existing Account screen clears the app's user state but does not call the prototype backend logout endpoint, because tokens are not retained by that screen.

## Data and limits

The server keeps hashed passwords, face vectors and hashed session tokens in ignored `face_backend/data/auth.sqlite`. It does not store source photos. Templates are biometric data, not anonymous hashes. The database is not encrypted; protect the computer and add encrypted storage before using real accounts. Photos are processed in memory; the app's camera may create a cache image. No ages or genders are collected. There is no online face-service subscription.

The backend is deliberately small and runs one request at a time. It limits attempts per IP and caps image sizes. It is not a production authentication service: no server password recovery, administrator account lifecycle, or mobile API authorization has been added.

## Checks

```bash
cd mobileapp/face_backend
python -m unittest discover -v
```

These test rejected credentials, authenticated enrollment, one-use/expired attempts, mismatched/duplicate faces, template deletion, session revocation and matcher failures with a fake matcher. They do not validate actual recognition accuracy.

Physical tests required: owner recognition, another person rejected, photo/video spoof rejected, multiple faces rejected, denied camera permission, cancellation, unavailable backend, poor lighting and deletion. Keep normal password login as fallback.

References: https://github.com/serengil/deepface and https://docs.expo.dev/versions/v57.0.0/sdk/camera/

## Original built-in biometric option

The existing SecureStore autofill is separate. It uses enrolled device biometrics and remains available in supported native builds. It unlocks saved email/password rather than recognizing camera photos. iPhone Face ID for that option cannot run in Expo Go.

## Reliability fixes and diagnostics

The prior empty response was reproduced at the Codespaces boundary: unauthenticated requests received empty HTTP 401 while the port was private; requests received empty HTTP 502 when no backend process was running. A successful browser health check did not guarantee phone access because the browser was signed in to GitHub. Starting a server in an assistant tool session did not reliably retain it between turns. Launch in YOUR terminal using `start.sh` and keep that terminal open, or use a properly configured authenticated development process manager.

Separate model failures were reproduced: missing tf-keras, missing PyTorch, and OpenCV 5 lacking cascade files. `setup.py` installs the tested compatible versions and installs headless OpenCV last to prevent overlapping cv2 packages from replacing the working files. Server startup now loads models and detectors before listening. It exits clearly if dependencies are broken instead of advertising readiness.

GET `/health` reports `ready`, dependency status, and loaded model names. This does not assess recognition accuracy. POST requests carry JSON, base64 JPEG, explicit enrollment consent, and a Bearer account session. Errors include status codes and safe request references, also present in terminal logs. Stack locations are logged without exception values or request contents; passwords, tokens, images and embeddings must never be printed.

- Empty 401/403: tunnel access is blocked. Configure authenticated access; public access is only an explicitly approved testing alternative.
- Empty 502/503/504: gateway cannot reach the running service. Check the backend terminal/process and URL, not face position.
- Non-JSON: wrong URL or tunnel login/interstitial page.
- 400/413/415: malformed body, oversized photo, or wrong content type.
- 401: credentials/session/face match rejected.
- 403: missing explicit enrollment consent.
- 409: already enrolled or duplicate face; avoid repeated enrollment.
- 422: invalid photo, no/multiple faces, or liveness rejection.
- 503 JSON: internal backend failure; match its request reference with terminal logs.
- Timeout: the client stops waiting after two minutes; an enrollment may already have completed. Sign in again and check registration rather than assuming cancellation undid the operation.

The HTTP backend handles one request at a time; it closes each HTTP connection, bounds upload size, gives socket reads a timeout, and returns valid JSON for caught failures. It cannot catch a killed process, out-of-memory exit, native segfault, or stopped workspace; those appear as gateway/network errors. Production would need supervised workers, monitoring and durable protected storage.

Run app communication checks from `mobileapp` with `npm run test:face-api`. Backend HTTP tests bind ephemeral loopback ports and use invented accounts plus a fake matcher. Real-device testing cannot be automated from this workspace: camera permission, capture readiness, upload, enrollment success alert, owner login, unknown/ambiguous rejection, liveness rejection, deletion and invalid-session handling must still be confirmed.

The existing account database is not migrated or deleted. Once this URL is configured, server-provisioned accounts are used for password and face login; the app's original local password path remains when camera backend configuration is absent. Local visitor registration/recovery does not synchronize with the Python account database. The separate built-in biometric autofill remains unchanged.

## Validation for the reliability update

Completed in this workspace: 14 backend tests (including real loopback HTTP requests with a mocked matcher), 9 JavaScript client tests, mobile lint and project type checking, Python compilation, shell-script syntax checking, and the actual `server.py --check-models` diagnostic. The finite model check reports SFace, Fasnet and the OpenCV detector loaded. The configured Codespaces HTTPS health URL was reachable during inspection. Port visibility was not changed by this update.

New startup command for Codespaces, run in your own terminal after stopping the old server with Ctrl+C:

```bash
cd mobileapp/face_backend
FACE_BIND_HOST=0.0.0.0 bash start.sh
```

Keep it running. In a second terminal, run `npx expo start --tunnel` from `mobileapp`; restart Expo if the environment URL changes, and reload the app after code changes. `/health` must include `"ready": true` before scanning. The previous server process must be restarted to load these changes. Tool-hosted foreground sessions are not a durable launch method.

Installation repair if needed: activate `.venv`, then `python setup.py`. To check real installed models without launching a server: `python server.py --check-models`. Do not rerun account creation for an account that already exists.

Changed for this update: `screens/Login.js`, `components/FaceCameraModal.js`, `utils/faceApi.js`, `face_backend/server.py`, `face_backend/core.py`, `face_backend/test_core.py`, `face_backend/test_http.py`, `face_backend/start.sh`, `scripts/face-api.test.mjs`, `package.json`, `.env.face.example`, and this guide. Existing `.env.local` HTTPS configuration and `app.json` camera permissions were inspected and preserved; credentials and existing account records were not reset.

Live phone verification remains required. A passing mocked test does not prove that this prototype securely recognizes the owner or rejects photos. The earlier public sample image was accepted by the full pipeline, so anti-spoofing must not be treated as established protection. Keep use limited to test accounts until stronger liveness validation and representative accuracy tests pass.

## Time-limited test session

`FACE_BIND_HOST=0.0.0.0 bash test-session.sh` runs the same backend for at most 30 minutes. It stops automatically; it does not change port visibility or model checks. When running on a publicly forwarded port, background launch still needs explicit approval for that testing window. The normal `start.sh` method remains a foreground process in your own terminal.

## Keeping the process alive (502 investigation)

The most recent reproduction again showed no listening backend process, an empty HTTP 502 from the tunnel, no enrolled-image request in the log, and no recorded cgroup OOM kill. This does not establish a DeepFace crash. A tool-launched server and a 30-minute test window are not permanent hosting; a stopped workspace, process cleanup or elapsed test window can remove the backend.

`start.sh` now runs `run_backend.py` in the foreground. The supervisor records each worker exit code, restarts unexpected failures up to three times, and terminates children on Ctrl+C/SIGTERM. It does not revive a closed editor terminal or stopped workspace. Model thread pools are bounded for this development environment. Fatal native errors emit a Python stack trace via faulthandler, without logging request data. A 30-minute test-session launcher still stops after its limit and must not be described as continuous service.

Use YOUR Codespaces terminal, and leave it open:

```bash
cd mobileapp/face_backend
FACE_BIND_HOST=0.0.0.0 bash start.sh
```

Wait for the listening message, then verify the environment URL plus `/health` on the computer AND phone. For the existing explicitly approved public test port, no new tunnel command is needed: Codespaces forwards port 8000. Port access must remain appropriate for your test; do not add credentials to the source code or Expo public environment variables. After testing, stop the supervisor with Ctrl+C and restore private port visibility. A desktop computer sharing the phone's LAN needs a reachable LAN address and TLS, not this remote Codespaces address.

In a second terminal run `npx expo start --tunnel` from `mobileapp`. Its tunnel carries the Expo bundle and is separate from the HTTPS backend forwarding. Existing `.env.local` continues to contain the backend URL. Restart Expo if this URL changes. Reload Expo Go after code changes.

The camera page now explicitly displays “Connecting to face recognition server” and “Scanning and processing face”. A gateway 502 is distinguished from a JSON backend exception and a client timeout. No successful face scan is simulated. Models remain mandatory. Native photo spoof resistance and real phone registration still require manual validation.

Latest checks for the 502 update: 16 backend tests and 9 client tests passed, plus lint/type checking. Actual supervised startup and localhost health passed; the configured HTTPS tunnel returned HTTP 200 while the finite test server was running. A separate isolated, in-memory account successfully completed password verification, public-sample JPEG upload, DeepFace enrollment, facial login and session verification over actual loopback HTTP. Enrollment took approximately 9 seconds and subsequent matching less than a second in that sample test. No source images or test templates were added to the real account database. All finite test servers were stopped afterward.

This verifies the technical pipeline, NOT live-user recognition or liveness accuracy. The public sample image was accepted despite enabled anti-spoofing; do not claim photo attacks are reliably blocked. Physical-device enrollment/login, phone-to-backend access, user-specific false rejections and spoof resistance remain manual checks. The service is not left running by the finite tests: start `bash start.sh` in your own terminal before phone testing.

## Persistent 502 investigation: proven boundary and combined launch

At the latest inspection only Expo processes were running. `ss -ltnp '( sport = :8000 )'` showed no listener; local health failed with connection refused (HTTP 000); the exact configured HTTPS health address returned empty HTTP 502 with a Codespaces relay header. GitHub CLI confirmed port 8000 forwards to the same codespace and is still Public under the previously approved testing configuration. No OOM kill was recorded. The latest earlier server log had startup and password success, but no enrollment processing or model exception. This proves the current failure is a missing listening backend; it does not prove which event stopped the earlier process.

A controlled temporary server then passed startup, local health, the SAME HTTPS tunnel health, actual JPEG enrollment through that tunnel, facial login and session verification. It used an invented account in memory and a public OpenCV sample; no real account database was altered. The server was stopped after the finite test. The tunnel is not persistently broken: changing DeepFace matching cannot fix a 502 produced while nothing listens on its forwarded port.

Error generation is `utils/faceApi.js`, `parseFaceResponse`, in the branch for an empty 502/503/504 response. In the current `FaceCameraModal.js` the FIRST scan request is GET `/health`, then `/challenge` for login, then `/enroll` or `/face-login` after capture. A 502 in preflight occurs BEFORE any photo upload or DeepFace processing. The exact request from a previously loaded phone bundle cannot be inferred; newly enabled safe runtime traces identify it on the next attempt.

**Use one terminal command for BOTH services:**

```bash
# Stop the OLD Expo command with Ctrl+C first, then run from the repository root:
cd mobileapp
npm run start:face
```

Keep THIS terminal open. `scripts/start-face-dev.sh` starts the supervised backend, waits for localhost readiness, then starts Expo with the alternate ngrok subdomain setting. If a compatible backend already exists, it is reused. It does not change port visibility, daemonize services or hardcode a tunnel URL. It stops owned children on exit and refuses to start Expo if the backend never becomes ready. A second terminal is no longer required for routine startup. Stop testing with Ctrl+C.

The Expo tunnel carries the app bundle; Codespaces forwarding on port 8000 carries backend requests. They are different connections. `npm run start:face` does not create or authorize a new public backend port. For this session the configured .env.local URL was inspected and matches the port mapping. The URL remains environment configuration. Do not use this public prototype for real credentials/photos without appropriate deployment security.

`EXPO_PUBLIC_FACE_DEBUG=1` was enabled in local environment configuration. Frontend traces report endpoint, sanitized origin, request stage, HTTP status, content type and response length; never payloads or response values. Set it to 0 after debugging. Backend traces report known route names, safe request references, image byte counts, processing start/completion and stack locations. Never post passwords, tokens, images or embeddings from diagnostic output.

Latest results: backend startup PASS; local health PASS; HTTPS tunnel health PASS; controlled real-model registration and facial login via tunnel PASS; 16 backend regression tests PASS; 9 client tests PASS; lint/type checking PASS. Physical Expo camera registration NOT TESTED from the agent environment. A live user's false rejection, spoof-resistance, camera orientation and actual runtime logs remain physical-device checks.

## iPhone image-orientation investigation

Reference `603cbbe61c74` was not found in the saved logs available to the agent, and the original capture was not stored. Its exact failure cannot be attributed to orientation without runtime metadata. The error originates in `server.embed`, when DeepFace's OpenCV Haar detector raises FaceNotDetected. It means decoding reached detection; it is not the same as spoof rejection or a tunnel failure.

A reproducible defect was found with a controlled public portrait: the previous pipeline detected upright/mirrored images but failed a 90-degree pixel rotation. Capture quality was 0.5 and backend decoding relied on OpenCV without an explicit tested normalization layer. Expo processes photo orientation by default; missing or incorrect EXIF in this specific user's photo was not proven.

Fix: `face_backend/image_pipeline.py` decodes JPEG/PNG with Pillow in memory, checks dimensions, applies all eight EXIF orientations, preserves aspect ratio without cropping, bounds the longest side to 1600 pixels, and converts RGB to contiguous BGR for DeepFace. If detection alone fails, it tries the other three right-angle rotations. Every trial retains face detection and anti-spoofing; liveness rejection stops immediately. Matching threshold and SFace model are unchanged. OpenCV remains the detector; a detector/model change would require additional compatibility and accuracy evaluation.

Capture now explicitly uses `skipProcessing: false`, JPEG quality 0.8 and non-mirrored front-camera output. It chooses a supported 640+ pixel photo size up to 1600 when available, validates native dimensions/base64 payload and logs only safe metadata in development. No frontend crop is applied. Images are not saved by the backend. The camera still may generate its native temporary cache file.

Run `npm run start:face` after stopping the OLD combined command with Ctrl+C. This enables `FACE_IMAGE_DEBUG=1` on its backend. Image diagnostics include reference ID, encoded/decoded size, source format and dimensions, EXIF orientation, applied rotation, BGR order, detector, face count and exception class. They contain no pixels, face vectors or full EXIF data. Set debug flags to 0 outside development.

Tests in `test_image_pipeline.py` cover all EXIF orientations, BGR conversion, bounds/aspect ratio, invalid/empty images, no-face/multiple-face behavior, and non-retry of spoof rejection. Optional actual-model tests require `FACE_TEST_PORTRAIT` pointing to a controlled public portrait; they exercise upright/rotated/mirrored/EXIF JPEGs, a blank image, and authenticated `/enroll` over loopback HTTP using an isolated in-memory account. They do not validate live phone recognition or photo-spoof protection.

Actual iPhone retry is required. If it fails again, copy only metadata lines matching the new request reference from the backend terminal. Do not save/send user face photos without explicit consent.

Orientation-update validation completed: 9 image-pipeline tests passed, including actual DeepFace inference on upright, all three rotated, mirrored and EXIF-tagged public-sample JPEGs, actual blank-image rejection, and actual authenticated rotated-JPEG enrollment returning HTTP 200. The 16 existing backend tests and 9 client tests also passed; mobile lint/type checking passed. No physical iPhone capture was accessed or saved. Successful sample inference still does not establish liveness accuracy.

## Returning botanist: one-tap camera login

This is camera-based DeepFace login, despite the button label “Login with Face ID”; it does not use Apple's Face ID. Existing enrollment and anti-spoofing checks remain in place.

1. Keep the backend running (`npm run start:face` in `mobileapp`) and confirm the phone can open its `/health` URL with `ready: true`.
2. Reload Expo Go to load the updated screen.
3. Register once with your backend email/password and “Register my face after password login,” if not already registered.
4. Log out. Leave email and password blank.
5. Tap **Login with Face ID**. Allow camera access if asked, center your face, and hold still. The returning-user scan starts automatically once the camera is ready. On failure use **Retry face login** or password login.
6. Successful verification opens the same account's dashboard. Log out and repeat to confirm returning login.

Only the backend-bound session token is saved with Expo SecureStore on native devices; this new session feature does not save a password or a local role. The app verifies `/me` before restoring access, on foreground return and every minute. Invalid/expired or unreachable sessions clear local access. Logout removes local storage and asks `/logout` to revoke the token. If the backend is offline, remote revocation cannot be confirmed and that server token remains valid until its eight-hour expiration. Unsupported storage platforms use memory only.

The separate original device-biometric credential autofill option remains unchanged. Face login does not fill or reconstruct passwords.

Automated session/HTTP tests use controlled account fixtures, not physical iPhone captures. Verify real enrollment and returning login on your iPhone. Existing local/demo plant screens are not a server authorization boundary: production plant APIs must validate session tokens and roles on the backend for each protected operation.


## Existing enrollment and returning login

Registration checks authenticated `/enrollment-status` before opening the camera. An existing template displays “Your face is already registered. You can now use Face Login.” Same-account `/enroll` conflicts use `already_enrolled`; different-account `duplicate_face` remains a failure. Neither path replaces or deletes a template.

Returning login sends only a one-time challenge and image to `/face-login`. The server uniquely matches existing accounts, issues a session, and the app verifies `/me` before navigating botanists to AccountTab. Backend login uses token-only storage and does not offer password autofill storage.

On iPhone, reload, log out, leave credentials blank, and tap **Login with Face ID**. Verify the existing botanist dashboard, then log out and repeat. Select registration during password login and confirm the exact already-registered message without another capture. Camera denial, unknown faces and backend unavailability must not open a dashboard. Automated tests use synthetic embeddings and isolated accounts; live matching, orientation, lighting and spoof resistance require physical-device checks. Existing enrollment does not guarantee every capture matches; recognition rejection must not be bypassed.
