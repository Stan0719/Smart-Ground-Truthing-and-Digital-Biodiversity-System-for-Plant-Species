> Historical instructions: project Python files and launchers were removed at the user's request. Python commands below are no longer runnable. The active website uses Vue, Node.js and PostgreSQL.

> See [final system verification](final-system-verification.md) for the latest browser checks, fixes and deployment assessment. Results below describe the earlier repair run.

# Remaining software repairs and verification

This report covers the repair work after the SQLite transition. Existing user
accounts, passwords, biometric enrollments, images, backups and protected-species
policy were preserved. No fake plant records were added and no Supabase connection
was made.

## Activation email

**FIXED AND VERIFIED:** secure random hashed activation tokens, expiry, invalid and
reused-token rejection, resend invalidation, pending-account login rejection and
failed-delivery handling pass isolated tests. Links now use the actual Codespace
website origin unless `APP_ORIGIN` explicitly supplies a different exact origin.
Both localhost aliases remain available only in automatic development mode.

**BLOCKED — EXTERNAL CONFIGURATION REQUIRED:** service ID and public key are
available, but `EMAILJS_ACTIVATION_TEMPLATE_ID` is missing. No real email was sent.

To complete configuration:

1. Sign in to the existing [EmailJS dashboard](https://dashboard.emailjs.com/).
2. Open **Email Templates**, create a separate account-activation template, and
   set **To Email** to `{{to_email}}`.
3. Include `{{to_name}}`, `{{role}}` and `{{activation_link}}` in the content. Make
   the activation link clickable. Do not include a password.
4. Save the template and copy its real template ID into private `web/.env.server`:
   `EMAILJS_ACTIVATION_TEMPLATE_ID=...`. A private file with an empty setting is
   available; no placeholder ID was invented.
5. If the account requires a server-side private key or non-browser request
   permission, configure that in EmailJS and `EMAILJS_PRIVATE_KEY` server-side.
6. Restart the authentication API. An authorized Administrator should invite a
   controlled test inbox, verify receipt, activate once, and confirm reuse fails.
   An inbox/recipient must be supplied before any real delivery test.

Reference: [EmailJS send API](https://www.emailjs.com/docs/rest-api/send/).

## Face environment and service

**FIXED AND VERIFIED:** the Python symlink pointed to deleted
`/tmp/niah-face-python311/bin/python`. A persistent Python 3.11.17 was installed
under ignored `.local-runtimes/`, and the existing environment was repaired in
place. Its installed packages and enrolled templates were retained. `pip check`
passes; NumPy, Pillow, OpenCV, DeepFace, TensorFlow and CPU Torch import. Actual
SFace, Fasnet anti-spoofing and OpenCV detector models load. A real-model inference
check rejects a generated blank image. The loopback service reports readiness and
authoritative account mode at `http://127.0.0.1:8000/health`.

Signed account-service tests verify real Node/Python integration against isolated
accounts. These positive enrollment/login tests inject a matcher; they do not
prove a real person can authenticate. Seven public-portrait model tests remain
skipped because controlled positive/negative portrait fixtures were not supplied.

**BLOCKED — PHYSICAL DEVICE REQUIRED:** live camera enrollment, liveness and
recognition accuracy. No enrolled user's image or embedding was printed or used
as a test fixture. No recognition threshold or liveness check was weakened.

Reproducible repair/install:

```bash
bash mobileapp/scripts/setup-face-env.sh
bash mobileapp/scripts/start-authoritative-face-dev.sh --backend-only
```

Setup preserves existing packages before installing the existing requirements,
and refuses an unrecognized broken environment. The authoritative launcher binds
loopback by default, never changes port visibility and disables image debugging
by default. It starts a signed Node account adapter on port 3002. Keep both worker
and supervisor running. Do not start a second copy on occupied ports.

## Mobile permissions and API configuration

**FIXED AND VERIFIED:** Android bundle, Expo config, lint and type checks pass.
Camera/library cancellation is null-safe; JPEG/PNG are identified by their data;
photo count is bounded; photos can be removed to recover from storage limits.
GPS ranges and nonnegative accuracy are validated before persistence. Native
location and image-picker permission plugins include user-facing descriptions.
The existing face URL was retained and the missing plant HTTPS origin was set to
this Codespace's forwarded port 3000, without making any port public.

**BLOCKED — PHYSICAL DEVICE REQUIRED:** real permission prompts, camera capture,
GPS accuracy and tunnel access from a phone. A private Codespaces forwarding URL
may require GitHub sign-in that a native API request cannot perform. Supply a
reachable, appropriately secured deployment/tunnel for device testing; no port
visibility was broadened automatically. Restart Expo after environment changes.

## Offline drafts and session recovery

**FIXED AND VERIFIED:** injectable offline persistence/session/sync tests pass.

- A successful online account verification stores a separate short-lived owner
  lease in SecureStore. Offline access is opt-in, Botanist-only, requires local
  device authentication, and expires 15 minutes after the last online check.
- Offline access only opens/saves the owner's local drafts. It does not authorize
  API calls or synchronization. Server rejection clears local session access;
  network failures retain the token for a later online retry.
- Revocation cannot be discovered while disconnected. The local lease is bounded,
  never renewed offline, rejects clock rollback before its verification time, and
  is visibly labeled offline. Reconnect to check current account eligibility.
- Private fields are hidden after lease expiry; an unsaved form stays in memory
  while locked and can be revisited after successful verification. Saved drafts
  remain encrypted on the device.
- New draft writes use AES-GCM via `expo-crypto`; per-account keys stay in
  SecureStore. Existing legacy plaintext drafts are retained and remain readable
  by the owner; they become encrypted on the next successful replacement. No
  bulk deletion or risky forced migration was performed.
- The plaintext draft budget is 900,000 UTF-8 bytes per account so encrypted
  envelopes stay below Android's per-entry storage limits. Disk-space checks
  reserve overhead; failure leaves prior drafts unchanged. Reduce/remove photos
  or synchronize first. The current unsaved form is not crash-durable until a
  successful save, and storage exhaustion cannot guarantee saving new data.
- Sync preserves drafts until server confirmation, reuses upload keys, reconciles
  a changed server Draft with revision checks and refuses changes to an already
  submitted version. Concurrent local edits cannot be removed by an older sync.

**IMPLEMENTED BUT NOT VERIFIED:** native AES/SecureStore, local unlock, real disk
exhaustion and process termination on a phone. Pure engine tests exercise actual
Node AES-GCM with injected storage; Expo-native encryption still needs a device.
A compatible development build may be needed if the installed Expo Go client does
not contain the matching SDK modules. Keys must not be removed while drafts exist.

References: [Expo SDK 57 Crypto](https://docs.expo.dev/versions/v57.0.0/sdk/crypto/)
and the installed SDK 57 module type definitions.

## IoT

**FIXED AND VERIFIED:** authenticated simulated ingestion, finite readings,
humidity percentage limits, nonnegative raw readings, movement flags, alert
creation, role restrictions and duplicate retry handling pass against SQLite.
Optional `client_key` makes retries idempotent per device; reusing a key with a
different payload returns 409. Existing payloads without a key remain supported.
The serial bridge supplies a key and ignores malformed numeric firmware lines.

An additive SQLite v1-to-v2 upgrade adds only `iot_ingestion_receipt`; existing
records are not rewritten. A verified plant backup was taken beforehand. Private
online backups of authentication and face databases were also made under ignored
`.rbac-backups/integration-*` before starting account integration.

Temperature is Celsius, humidity percent, movement 0/1; soil moisture/rain/sound
are raw ADC readings, not calibrated physical units. Timestamps are server UTC.
Threshold comparisons retain their existing upper-bound behavior. Offline serial
bridge delivery is not a durable spool; a persistent hardware gateway is a
separate deployment decision.

**BLOCKED — PHYSICAL DEVICE REQUIRED:** sensor calibration, wiring, serial timing,
network dropout behavior and physical alarms.

## Protected species

**FIXED AND VERIFIED:** direct detail, image, QR, search and report tests enforce
current restrictions across Guest, Visitor, Botanist, Officer and Administrator.
`shared/rbac.cjs` was not changed. Administrators have no automatic scientific
access; Officers alone retain protected-species access.

**REQUIRES USER POLICY DECISION:** any eligibility rule granting Botanists
protected-species access. Current denial remains enforced.

## SQLite, data preservation and operations

The plant database remains local and initially empty. Species/plants lists return
HTTP 200 through Vite. Authentication is separate. Backup and restore instructions
remain in [SQLite plant storage](sqlite-plant-storage.md). Download backups outside
the Codespace before deletion/recreation; local runtimes/models also need setup
again if the Codespace is deleted.

No actual invitation, password reset, face enrollment or plant creation was done
against application accounts/data during testing. Fixtures use isolated databases.

## Dependency updates

Installed `expo-crypto ~57.0.4` and `expo-file-system ~57.0.7` using Expo's version
resolver; Python runtime manager uv 0.13.5 and CPython 3.11.17 were installed
separately without replacing global Python. Existing face model dependencies were
reused. Compatible npm security updates were applied without `--force`.

Website and plant-backend audits report zero advisories after those updates.
Mobile audit decreased from 13 to 8 advisories (3 moderate, 5 high), primarily Expo
CLI/code-signing dependencies and router transitive packages. npm proposes
breaking SDK changes for the remaining advisories. These were not forced into an
SDK 57 application. **FAILED — FURTHER INVESTIGATION REQUIRED:** resolve the
remaining mobile dependency advisories through a separately validated SDK update
or reviewed compatible dependency patches before production deployment.

## Files changed in this repair

- `.gitignore`: persistent private Python runtime/tool directories.
- `web/.env.server.example`, private `web/.env.server`, `web/server/index.mjs`,
  `website-origin.mjs`, `website-origin.test.mjs`, `activation.mjs`,
  `activation.test.mjs`: server origin, template configuration and activation tests.
- `mobileapp/App.js`, `app.json`, private `.env.local`, `package.json`,
  `package-lock.json`: bounded offline startup, permission plugins, native modules
  and current plant origin.
- `mobileapp/utils/faceApi.js`, `faceSession.js`, `faceSessionLifecycle.js`,
  `fieldStorage.js`, `offlineDraftStore.js`, `fieldSync.js`: transport classification,
  secure local lease, encrypted owner storage and retry handling.
- `mobileapp/screens/FieldCollection.js`: recovery UI, locked forms, photo/GPS
  validation and retry behavior.
- `mobileapp/scripts/face-session.test.mjs`, `field-sync.test.mjs`,
  `offline-recovery.test.mjs`, `setup-face-env.sh`, `start-authoritative-face-dev.sh`:
  regression coverage, persistent Python setup and safer loopback startup.
- `mobileapp/face_backend/test_real_model_safety.py` and ignored `.venv` interpreter
  link/config: actual-model negative test and environment repair.
- `plant-conservation-backend/database.cjs`, `domain.cjs`, `iot.cjs`,
  `test/business.test.cjs`: additive retry receipts, owner retry responses,
  validation and full role regressions.
- `IoT/PlantPrototype/serial_bridge.py`, `test_serial_bridge.py`: retry keys and
  malformed-line coverage.
- Web and backend `package-lock.json`: compatible dependency security updates.
- This report and the current SQLite setup documentation.

## Physical-device checklist

1. Build/install the matching SDK application; verify API reachability without
   exposing account-service keys or relaxing backend authorization.
2. Test camera/location denial, later approval, cancellation, JPEG/PNG upload and
   GPS validation on Android and iOS.
3. Sign in online as an active Botanist, save a small draft with an image, turn
   networking off, terminate/reopen, unlock local drafts and recover the form.
4. Wait beyond 15 minutes; private forms must lock. Reconnect/sign in; saved drafts
   must remain. Check account suspension/revocation online and another account.
5. Fill storage, retry writes and verify earlier drafts survive. Test corrupted
   ciphertext, missing device keys, app reinstall and unsaved-form messaging.
6. Interrupt sync after creating a server draft and after a photo upload; retry
   without duplicate records, then confirm Officer review and public projection.
7. Register a real device, store its provisioning key privately, stream calibrated
   readings, retry the same key, and verify a single reading/alert and Officer
   response. Confirm wrong keys and inactive devices are rejected.
8. With explicit consent, test real face enrollment, genuine live matching,
   different-person rejection and presentation attacks. Never weaken anti-spoofing
   to make a fixture pass.

## Final verification results

| Check | Result |
|---|---|
| Plant backend / SQLite / IoT / RBAC tests | 9 passed |
| Website authentication, activation, origin and API-response tests | 22 passed |
| Mobile API, login, recovery, offline storage and synchronization tests | 43 passed |
| Python with `FACE_TEST_REAL_MODELS=1` | 44 passed; 7 portrait-fixture tests skipped |
| Serial parser | 3 passed |
| Total | 121 passed; 7 skipped |
| Website production build and Vue/TypeScript checks | Passed |
| Mobile lint and TypeScript checks | Passed |
| Android Expo export | Passed; JavaScript/Hermes bundle, not a device run |
| SQLite integrity / foreign keys | Passed; zero species and zero plants |
| Existing accounts | 3 staff and 2 Visitor rows unchanged |
| Existing face data | 1 account and 1 real-face-template row unchanged; links unchanged |
| Live website and proxied species API | HTTP 200; `{"species":[]}` |
| Live plant API | HTTP 200; `{"plants":[]}` |
| Authentication without a session | Expected HTTP 401 |
| Real-model face service | HTTP 200, ready, authoritative account mode |

Service processes are development-session-bound, not deployed hosting. They were
restarted after an interrupted session and checked again. For field corrections,
Save Offline now queues PATCH operations too; retries after a lost PATCH response
use the server's current revision/content before uploading photos and submitting.
This behavior has a dedicated interrupted-correction regression test.

No external email, genuine-person recognition, physical camera/GPS, native device
storage or actual sensor result is claimed by these automated checks.
