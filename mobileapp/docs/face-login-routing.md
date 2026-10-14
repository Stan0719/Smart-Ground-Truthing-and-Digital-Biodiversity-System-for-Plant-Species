# Face Login endpoint separation — 13 October 2026

## Source of the reported error

Reference `a835b69eb447` was previously observed in the Python terminal as `POST /enroll`, followed by HTTP 409 from `Auth.enroll`'s `already_enrolled` branch. The exact old message was `Face already registered. Remove it before registering again.` The current backend no longer contains that wording. `/face-login` does not call `enroll`; `faceApi.js` prepends the actual requested path to errors and does not reroute them.

The previous current-source button opened mode `recognize`; registration was entered separately through authenticated password login with the registration switch. Without a fresh correlated trace of the physical button press, it is not possible to distinguish an old JavaScript bundle, an old enrollment modal/error retained during development refresh, or an earlier operation whose error was still being displayed. The historical reference does not establish the operation executed by a new gesture. No unsupported attribution is made.

## Changes

- `screens/Login.js`: separate controller methods for login/enrollment; Face Login clears registration intent and messages; request-specific completion ignores callbacks from older camera openings. Mount/development refresh clears the camera and messages. Recognition completion never resolves registration logic.
- `components/FaceCameraModal.js`: keyed by unique camera-opening ID rather than mode alone; ignores canceled/superseded operations; sends explicit enrollment consent only from the enrollment action. Camera API, anti-spoofing, preprocessing and real-account verification remain unchanged.
- `utils/faceCaptureFlow.js`: immutable operation requests, validated modes, explicit endpoint branches and diagnostics with `flowVersion: face-routing-v2`. Registration requires consent and an authenticated matching `/me` profile before capture/upload. Login obtains a challenge and calls only `/face-login`, never `/enroll`.
- `scripts/face-capture-flow.test.mjs`: seven regression tests for routing, consent/account verification, closing/reopening, delayed captures, logout/relogin, reload/reset and authorization failures.

Only frontend routing/state and tests were changed in this turn. `faceApi.js` already preserves the actual endpoint/error reference; Python endpoint handlers and the authoritative account integration are preserved.

## Verification

The actual controller/capture/client code used by the button was executed against the running HTTPS backend using a synthetic invalid image. Reference **adfd85477ce7** logged:

```text
camera_opened mode=recognize flowVersion=face-routing-v2
capture_endpoint_selected mode=recognize endpoint=/face-login
POST /challenge -> 200
POST /face-login -> 422 invalid_image
```

The backend terminal confirmed the same reference and `/face-login` endpoint. Called endpoints were `/health`, `/challenge`, `/face-login`; `/enroll` was never called. The invalid synthetic image was correctly rejected; no session, account or template was created. This verifies the bound operation's code path over real HTTP, not a physical iPhone button press or successful recognition.

Metro served iOS route modules containing `face-routing-v2`, `capture_endpoint_selected` and LoginScreen using the manifest router-root settings. The lazy entry alone excludes route code and cannot establish bundle freshness. This confirms server-side availability, not the phone's loaded version.

27 client regressions passed: 11 API, 6 session, 3 completion/navigation and 7 camera-operation tests. Mobile lint/type checking passed. Backend endpoint/account integration suite: 16 tests, 15 passed and one optional actual-model test skipped in this turn; actual-model integration had passed during the preceding investigation.

Read-only audit after testing: one preserved legacy template, zero new authoritative templates, zero links. No roles, suspension statuses, recognition thresholds or anti-spoofing settings were changed.

## Physical iPhone validation

1. Reload Expo Go once to receive the new routing diagnostics. This is to load changed code, not a claim that restarting repairs recognition. Confirm the Metro log says `login_screen_loaded` with `flowVersion: face-routing-v2`. A currently served updated bundle does not prove which bundle a phone has loaded.
2. Leave email/password blank and press **Login with Face ID**. Expect `camera_opened` with `mode: recognize`, then `capture_endpoint_selected` with `endpoint: /face-login`. `capture_started.cameraRequestId` connects the opening ID to the capture's correlation reference. The Python terminal must show `POST endpoint=/face-login` for that reference and no `/enroll`.
3. Close the camera, reopen Face Login, and repeat. Each opening must use a new ID and begin with no enrollment error. Reload and repeat to check refresh behavior.
4. Send the new displayed reference/error or confirm success. If the exact historical reference `a835b69eb447` reappears, report whether `face-routing-v2` was logged; do not delete or re-enroll the face as a workaround.
5. Registration testing is a separate authenticated operation: use an eligible real account, explicit consent and the registration action. Never register merely to test the Face Login button.
6. Successful login must pass authoritative `/me`, publish the trusted account and open its dashboard; logout and repeat with a new capture. Rejected sessions must never navigate.

## Separate account-linking limitation

The existing legacy enrollment is unlinked to an eligible real Botanist account. The last audit found no real Botanist account; its prototype email matched a suspended Conservation Officer. This restriction is separate from endpoint routing. Recognition of an unlinked template fails with `account_not_linked` rather than attempting `/enroll`. A non-match can fail earlier with `face_not_matched`.

An authorized administrator must create a legitimate Botanist through existing User Management, and the user must complete the required permanent-password change. The authenticated, explicit-consent operator linking command in `face-auth-evaluation.md` can then associate the preserved template with that approved account. Do not repurpose the officer, automatically link by email, create duplicate enrollment or bypass role/status checks.

Recognition and physical-button behavior remain unverified until the fresh iPhone trace arrives. The code-path routing correction is verified separately from the unresolved recognition/account-linking requirements.
