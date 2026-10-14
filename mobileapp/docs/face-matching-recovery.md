# Facial matching and legacy recovery — 13 October 2026

Live iPhone authentication is not yet confirmed. This report supersedes the pending account/matching sections of the earlier evaluation.

## Verified cause and limits

Reference `5e8d5954286a` passed Fasnet, generated SFace's 128-dimensional embedding, and found zero matches at cosine distance <0.30. The old photo/embedding for that attempt was not retained, so its exact nearest distance cannot be recovered retrospectively. New attempts now log rounded nearest distance on the server when `FACE_IMAGE_DEBUG=1`, without identity labels, embeddings, photographs, passwords or tokens. The distance is not returned to clients. These diagnostics are still sensitive matching metadata: restrict access and retention to this investigation.

The preserved legacy template is 128-dimensional, finite and nonzero. It has no historical model/detector/alignment/decoder/version/weight provenance or source photograph. Compatibility with today's SFace cannot be proven from its shape or reverse-engineered from a vector. It has no real-account link. Linking alone would not change its distances or guarantee returning login.

Current registration, consented recovery and login all call `prototype.image` -> `server.embed` -> `decode_image` -> `represent_oriented`. Thus they share EXIF transpose, aspect-preserving maximum edge 1600, BGR uint8, SFace, OpenCV, enforced single-face detection, alignment, base normalization and required Fasnet. Orientation retries occur only after no-face detection, never after spoof rejection. New provenance records these settings, package versions and SFace weight hash; incompatible current templates fail closed. Historical templates are never relabeled as compatible.

The displayed email supplied by the user, `yuxi@gmail.com`, exists in the authoritative database as Active Visitor, with no required password change. The mailto target in that reply, `yuxiphuan@gmail.com`, is a suspended Conservation Officer and is ineligible. No roles/statuses changed. Database presence is not proof of the requester's ownership: fresh password authentication is required before any action. Visitor login retains Visitor permissions and goes to its existing HomeTab; Botanist login requires an eligible Active Botanist and uses AccountTab. No eligible Botanist was created or inferred from the officer.

## Changes

- `face_backend/matching_diagnostics.py`, `core.py`, `authoritative_auth.py`: opt-in server-only nearest cosine distance rounded to four decimals, compared-template count and unchanged decisions. No per-template identity or vector appears in logs/responses.
- `face_backend/pipeline_identity.py`: new provenance also describes decoder/color/dtype/resize/orientation policy and 128-dimensional SFace output. Existing legacy bytes remain untouched.
- `face_backend/authoritative_auth.py`, `server.py`: `/legacy-link` and `/legacy-reenroll` require a valid eligible real-account session, a freshly verified real password, the original legacy password and explicit consent. Temporary proof sessions are revoked. Eligibility is checked again before commit. Existing links to other accounts and existing real templates cannot be overwritten.
- `/legacy-link` preserves the existing template and explicitly reports unknown provenance. A match must still pass the existing threshold, anti-spoofing and real-account restrictions.
- `/legacy-reenroll` saves one fresh live template, including provenance, separately in `real_face_templates`. The old template stays byte-for-byte in the legacy database. Explicit consent records its retirement from active matching in `legacy_face_replacements`. This prevents the historical template from expanding the accepted gallery. Duplicate matches to other accounts fail; liveness/decoding failures leave no recovery link/template changes. Both insertion/link changes commit atomically.
- `face_backend/link_existing_face.py`: operator-assisted linking uses the same fresh-password recovery checks. The previous session-only `link_legacy` helper now rejects with `password_proof_required`.
- `screens/Login.js`: explicit management controls with ownership/consent confirmation; both passwords remain in transient memory, are cleared from form fields, and are never persisted by this recovery flow. Recovery logs out its real session afterward and requires a separate Face Login test.
- `utils/faceCaptureFlow.js`, `components/FaceCameraModal.js`: explicit consented legacy re-enrollment endpoint, authenticated same-account `/me` verification, and clear preservation/retirement wording. Returning Face Login still exclusively calls `/face-login` and cannot inherit recovery credentials.
- `face_backend/test_matching_diagnostics.py`, `test_account_integration.py`, `scripts/face-capture-flow.test.mjs`: diagnostics redaction, dual-password/consent gates, no silent overwrite, preserved old bytes, rejected liveness/duplicate atomicity, HTTP recovery, real sessions/revocation/repeated login and client route isolation.

No real enrollment has been linked, retired or replaced by the agent. Tests use isolated accounts/databases. Account roles, passwords, restrictions, production matching threshold and anti-spoofing policy remain unchanged.

## Actual matching evaluation

The final actual-model distinct-genuine integration test uses independently photographed public fixtures `img1` and `img2`, both passing Fasnet. Their processed SFace cosine distance is **0.3534**, so the second is correctly rejected under the unchanged security policy of <0.30. The earlier 0.3638 measurement used a different original-resolution fixture preparation; it is not the measured distance for the user's iPhone/template.

The public evaluation was rerun on nine photos, four labeled identities, six genuine and four different-person pairs with mandatory anti-spoofing. At 0.30 it rejected **4/6 genuine pairs** end to end, including one upstream spoof rejection; the conditional matcher rejected **3/5 eligible genuine pairs**. It accepted **0/4 different-person pairs**. Offline relaxed thresholds 0.40/0.50/0.593 removed matcher rejections on this tiny sample but do not establish a safe FAR. Pairs overlap and are correlated; neither a threshold increase nor an any-template-pass policy is justified. Production remains 0.30.

See `public-matching-results.json` and `face-auth-evaluation.md` for alignment/mirror/EXIF ablations and denominators. Public static photographs do not validate liveness or actual iPhone usability. Two new personal captures are needed to establish whether a fresh, proven pipeline template works for this user. Consent to a new template is not a claim that it will solve capture variability.

## Validation

**50 backend tests passed with no failures/skips**, with actual public portrait fixtures and real isolated Node/Python services. They include wrong passwords, consent denial, no live-capture bypass, duplicate rejection, unknown/ambiguous identities, historical preservation, incompatible provenance, real `/me`, logout/revocation and repeated login. **28 client tests passed** across API/session/completion/capture-flow suites; **8 website account-service tests passed**. Mobile lint and type checking pass. Public matching evaluation was rerun successfully.

After the final service reload, public HTTPS `/health` returned HTTP 200 with models and authoritative service ready. A before/after hash comparison confirmed identical legacy template bytes. The live database still has one legacy template, zero real templates, zero account links and zero retired templates. No account/template recovery action was performed by the agent.

## iPhone next steps

1. Reload Expo Go to load the new management controls. Leave credentials blank and retry **Login with Face ID once** first. Send only the new reference. This measures your existing-template distance without changing any biometric data; the old reference cannot supply that measurement.
2. For account setup, use the Active Visitor `yuxi@gmail.com` and its permanent password in the normal top fields. Do not use the suspended officer as an eligible account. If you require Botanist access, an authorized administrator must create/approve an actual Botanist through existing User Management; complete any temporary-password change first. No self-service Botanist approval flow is implemented.
3. Open **Manage my existing facial enrollment**. Enter original prototype enrollment email/password in the legacy fields. Do not send either password in chat. If you cannot prove legacy ownership, stop recovery and use password login; no automatic transfer or deletion is available.
4. **Link my existing enrollment** requires explicit ownership consent and fresh authentication of both accounts. It preserves the old template, but does not improve recognition. If measured captures do not match, linking will not fix that.
5. If you knowingly choose **Enroll a new capture, preserve my old template**, read the confirmation: a new template is stored for your eligible account; the old template remains preserved but is retired from active matching. Agree again in the camera, with a complete roughly frontal face and surrounding context in even lighting. A failed live/duplicate check saves nothing.
6. Recovery signs its session out. Leave email/password blank and perform a separate new Face Login capture. Success must create a real session, verify `/me` for the same immutable Visitor account and reach its authorized dashboard. Confirm account identity, log out, and repeat with another new capture. Send references if either attempt fails. Wait a minute if rate-limited; do not disable limits.
7. Registration/fixture success is not the acceptance gate. Until both real returning attempts verify the same eligible account and correct dashboard, live Face Login remains unconfirmed. If distances still exceed 0.30, representative consented genuine/impostor calibration is required, not an automatic threshold relaxation.

## Remaining risks

Legacy provenance is unknowable without source evidence. Small correlated fixture results cannot certify recognition or anti-spoofing security. The biometric SQLite database lacks encryption at rest; filesystem restrictions and a defined retention policy remain necessary. Static-photo liveness can be camera-sensitive and does not equal Apple's hardware Face ID. A recovered template can still reject a later genuine capture. Enrollment recovery requires possession of both passwords; account/session validation must remain server-side. No automatic fail-open, cloud image transfer or new liveness provider was added.
