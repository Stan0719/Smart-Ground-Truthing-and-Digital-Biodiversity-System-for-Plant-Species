# Face-login diagnosis — 13 October 2026

Follow-up: [authoritative integration and expanded matching evaluation](face-auth-evaluation.md). This document records the earlier prototype investigation.

The persistent iPhone failure is **not confirmed fixed**. Its failing stage is located, and an actual-model false rejection is reproducible. Fresh correlated iPhone evidence is still needed. The updated backend is running and reports ready through its existing HTTPS tunnel.

## Exact failure

- File/function: `face_backend/core.py`, `Auth.face_login`.
- Endpoint: `/face-login`; this backend has no `/login` endpoint.
- Previous error: `Face not recognized uniquely. Use your password.`, HTTP 401.
- Live references inspected: `c9f357913a16`, `b41f021cacc3`, `52f63c405605`, `29d6481637eb`. Each completed JPEG decoding, EXIF normalization, face detection and SFace embedding generation before HTTP 401. No session or subsequent `/me` was issued for these failed attempts.
- A read-only audit found exactly one account, role botanist, with a finite nonzero 128-dimensional template. Ambiguity between accounts is therefore excluded for the audited database. The failure indicates that the capture did not meet the cosine matching threshold. Why that capture differs from the enrollment remains unproved.
- The persistent database path is anchored to `Path(__file__).parent/data/auth.sqlite`, independent of working directory. Enrollment remained after restarts. The audit did not print account identity, passwords or template values.
- Enrollment/login use the same `Auth.image` → `server.embed` → `decode_image` → `represent_oriented` pipeline: SFace, OpenCV detection, alignment/normalization defaults and mandatory anti-spoofing. Images undergo EXIF transpose, RGB-to-BGR conversion and aspect-preserving resizing; the camera uses processed captures and `mirror=false`. Legacy templates contain no model/preprocessing version metadata, so their historical provenance cannot be proved from dimension alone.

## Actual-model reproduction

Two public DeepFace v0.0.93 fixtures, `tests/dataset/img1.jpg` and `img2.jpg`, completed actual SFace detection, anti-spoofing and embedding generation. Their original-resolution cosine distance was **0.3638**, above the application's unchanged **0.30** threshold. Installed DeepFace 0.0.100 defines SFace's default cosine threshold as **0.593** in `deepface/config/threshold.py`.

This demonstrates a stricter application threshold causing a public-pair false rejection; it is neither threshold calibration nor proof of the cause of the user's particular capture. The threshold has not been changed.

`check_real_pair.py` resizes fixtures to mobile upload bounds and uses actual models over isolated loopback HTTP with a temporary SQLite database. It enrolls the first photo, closes/reopens the database and tests login:

| Check | Result |
| --- | --- |
| Health | Passed |
| Enrollment persistence after database reopen | Passed |
| Same-photo `/face-login` | HTTP 200 |
| Same-photo authenticated `/me`, botanist role | Passed |
| Logout revocation | Passed |
| Second-photo `/face-login` | HTTP 401, `face_not_matched` |

The reproduction exits **1** because returning login on the second photo still fails. It never accesses the application database or saves input photos. Disposable accounts exist only in its temporary database.

## Changes in this investigation

- `face_backend/core.py`: centralized the existing threshold without changing it; distinct `face_not_matched`, `ambiguous_face`, `challenge_expired` codes; safe matching counts and session-stage logs.
- `face_backend/server.py`: validated 12-hex correlation header shared with client; `/me` success/rejection, embedding completion and startup database-path diagnostics.
- `face_backend/image_pipeline.py`: anti-spoofing success diagnostic after the mandatory model call succeeds.
- `utils/faceApi.js`, `components/FaceCameraModal.js`: one reference per capture attempt, passed to challenge and matching requests; structured transport/capture failures. References are log labels, never authentication tokens.
- `utils/faceSessionLifecycle.js`: passes the same reference to authenticated `/me` verification.
- `utils/completeFaceLogin.js`, `screens/Login.js`: testable completion flow publishes only the profile returned by authenticated `/me` and reports verification/navigation failures.
- `App.js`: correlated auth-context update, navigation dispatch and observed navigation state.
- `scripts/face-api.test.mjs`, `scripts/face-login-flow.test.mjs`, `face_backend/test_http.py`: correlation validation, trusted profile routing and rejected-session regressions.
- `face_backend/check_real_pair.py`: reproducible actual-model HTTP check.

Existing templates, password login, anti-spoofing, allowed roles, one-time challenges, eight-hour sessions and token-only backend session storage are preserved. No production account was created or biometric template changed by this investigation.

## Authentication boundary

Mobile authentication uses `App.js`'s `user` state. The face backend's authenticated `/me` profile supplies identity/role, and AccountTab renders BotanistDashboardScreen only for role `botanist`. The website's `web/src/services/auth.ts` uses a separate `/api/auth/me` system with different roles. No existing bridge authenticates face sessions against that service. A verified face session grants the existing prototype mobile dashboard; it does not establish website authentication or production plant API authorization. No cross-system access-control bypass was introduced.

## Validation

- Backend regressions: **28 tests — 25 passed, 3 optional portrait tests skipped**.
- Client checks: **20 passed — 11 API, 6 session, 3 completion/navigation**.
- Frontend lint and type checking: passed.
- Actual SFace model checks: detection/anti-spoofing passed, same-photo session succeeded, second-photo rejection reproduced.
- Physical iPhone success and rendered dashboard: **not verified**. A fresh correlated retry was requested; its result has not arrived.
- Dashboard tests exercise verified profile routing and failure behavior with injected session/navigation dependencies; they are not physical-device UI tests.

## Commands

Updated backend and Expo are already running. The backend restart was necessary to load new diagnostic code, not proposed as a recognition fix. Do not start duplicate listeners.

From the repository root, run regressions:

```bash
cd mobileapp
npm run lint
npm run type-check
node scripts/face-api.test.mjs
node scripts/face-session.test.mjs
node scripts/face-login-flow.test.mjs
cd face_backend
.venv/bin/python -m unittest test_core test_http test_supervisor test_image_pipeline
```

Reproduce actual-model returning login from `mobileapp/face_backend`:

```bash
curl -fL https://raw.githubusercontent.com/serengil/deepface/v0.0.93/tests/dataset/img1.jpg -o /tmp/niah-controlled-face-a.jpg
curl -fL https://raw.githubusercontent.com/serengil/deepface/v0.0.93/tests/dataset/img2.jpg -o /tmp/niah-controlled-face-b.jpg
OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 TF_NUM_INTRAOP_THREADS=2 TF_NUM_INTEROP_THREADS=2 .venv/bin/python check_real_pair.py --first /tmp/niah-controlled-face-a.jpg --second /tmp/niah-controlled-face-b.jpg
```

Health:

```bash
curl https://glowing-space-succotash-v6p7j4r5rgr9fwjwp-8000.app.github.dev/health
```

For a later fresh session, after stopping existing services: `cd mobileapp && npm run start:face`. The helper does not change forwarding visibility. Backend `FACE_IMAGE_DEBUG=1` and frontend `EXPO_PUBLIC_FACE_DEBUG=1` enable diagnostics; both are enabled for this test.

## Next iPhone test

1. Reload Expo Go once to load diagnostic client code. Log out; leave email/password blank.
2. Tap **Login with Face ID**, allow camera and keep the entire face visible. Send only the displayed error/reference or confirmation of success; no photo is needed.
3. Follow that reference through `challenge_validated`, `image_normalized`, `detection_completed`, `anti_spoofing_completed`, `embedding_generated`, `matching_completed` and `session_created`.
4. `matchedAccounts: 0` identifies non-match; more than one identifies ambiguity. Success must continue through backend `session_verified`, frontend `session_verification_passed`, `auth_context_updated` and `navigation_observed` for AccountTab.
5. Verify the correct dashboard, log out and repeat. Unknown-face and offline attempts must remain rejected. Existing registration should show the already-registered message without replacing the template.

Remaining evidence: the correlated iPhone capture and controlled matching/calibration results before changing threshold or preprocessing policy. Historical enrollment photo/provenance is unavailable, preventing direct image comparison to the original enrollment. The existing security threshold is preserved as requested.
