# Facial authentication evaluation — 13 October 2026

Recognition is **not confirmed fixed**. No returning iPhone botanist has completed the authoritative login/dashboard validation. The running backend now uses the real web account service and rejects unlinked legacy enrollments; the existing template is preserved. HTTPS health reports `accountService: authoritative`, `accountServiceReady: true`.

## Verified causes and remaining uncertainty

1. Previous iPhone requests completed JPEG decoding, EXIF normalization, face detection and SFace embedding generation, then failed cosine matching at 0.30. The audited database had only one enrollment, excluding account ambiguity in those earlier attempts. No session was created for them.
2. The actual-model public fixture experiment reproduces genuine-pair false rejection. A documented fixture pair had original-resolution distance 0.3638; the application rejected it at 0.30. Multiple-pair evaluation below confirms this was not an isolated public-fixture result.
3. Mobile password login previously called the separate prototype `/password` when face configuration was enabled; it did not call the real website account service. The local prototype marked the existing enrollment as botanist, but its email matched a **suspended Conservation Officer** in the real account database. That database currently contains no Botanist accounts. Even successful recognition must not authorize that officer as a botanist.
4. Legacy templates lack model/version/weight metadata and the original enrollment photos are unavailable. Their exact historical provenance cannot be established. No template was overwritten, relabeled, re-enrolled or automatically linked by email.
5. No new physical-iPhone attempt arrived during this evaluation. Existing metadata logs were inspected; fresh measured capture outcomes and successful account/dashboard access remain required. The cause of differences in that specific person's captures is not proven by public fixtures.

## Actual-model evaluation

Source labels: DeepFace v0.0.93 `tests/test_verify.py`. Nine public fixture photos cover four identity groups, six genuine pairs and four different-person pairs. Inputs are decoded/re-encoded at JPEG quality 85 with an aspect-preserving 1600-pixel bound. Model: installed DeepFace 0.0.100 SFace; OpenCV detector; BGR arrays; `normalization=base`; mandatory anti-spoofing. No application templates or private photos are used or output.

Production settings are explicit: `align=True`, detection enforced, anti-spoofing enabled, normalization base. Alternate alignment is an **offline ablation only**, not a production change. Mirrored and EXIF6 variants are synthetic sensitivity probes, not new independent subjects or genuine live captures.

| Production-aligned threshold (offline comparison only) | Genuine pairs rejected including upstream processing | Matcher rejects among five eligible genuine pairs | Different-person pairs accepted |
| --- | --- | --- | --- |
| 0.30 (unchanged live threshold) | 4/6 = 66.7% | 3/5 = 60% | 0/4 |
| 0.40 | 1/6 = 16.7% | 0/5 | 0/4 |
| 0.50 | 1/6 = 16.7% | 0/5 | 0/4 |
| 0.593 (installed model default) | 1/6 = 16.7% | 0/5 | 0/4 |

One fixture is rejected by anti-spoofing. Fixture labels establish identity, not liveness ground truth; this is not a measured live-person anti-spoof false rejection rate. Rates describe these fixture pairs only.

At 0.30, unaligned inputs reject 6/6 genuine pairs end to end (4/4 eligible pairs at matching); mirrored inputs reject 3/6 (2/5 at matching); EXIF6 inputs reject 4/6 (2/4 at matching). An EXIF6 variant and an unaligned variant also produce a multiple-face rejection on one fixture. Mandatory multiple-face rejection remains enforced. These results show detector/preprocessing sensitivity; they do not prove that iPhone EXIF handling is incorrect.

Full denominators, upstream failures and threshold comparisons are in `public-matching-results.json`. Zero acceptances in four overlapping impostor pairs **does not establish a safe population FAR**. Even four independent zero-error trials would have a one-sided 95% binomial upper bound near 52.7%; these pairs are correlated, so even that calculation cannot justify deployment. Variants must not be counted as independent additional evidence.

**Decision:** 0.30 has poor fixture usability, but no new production threshold is selected. Calibration needs consented representative iPhone captures, subject-disjoint development/validation cohorts, a predefined security target, uncertainty estimates, and evaluation of unknown identities, 1:N ambiguity, varying gallery size and spoof attempts. Raising the distance cutoff is relaxing acceptance even though it is numerically an increase. No automatic threshold update was implemented.

## Real-account integration

- `web/server/auth.mjs` remains authoritative. Password verification uses its existing scrypt logic, throttling, status checks, permanent-password requirements and roles. Face issuance requires the current real user to be Active, role Botanist and no mandatory password change; it creates the service's normal eight-hour session and audit event.
- `web/server/face-service.mjs` adds explicitly enabled **loopback-only** internal calls protected by HMAC over exact path/body, timestamp and nonce. Nonces persist in SQLite across service restarts. Incorrect signatures, expired assertions, replay, wrong roles, blocked accounts and expired sessions are rejected. Browser Origin/cookie protections remain on browser endpoints.
- `mobileapp/face_backend/account_service.py` uses a private server-side key file and explicit loopback URL. No service key or plaintext password is stored in Expo configuration or face-login storage. Real passwords are used transiently for password login and sent only over the internal loopback connection.
- `authoritative_auth.py` uses real account IDs, delegates sessions and `/me` to that service, checks every matching identity for ambiguity, and rejects unknown or unlinked faces. It never creates an account during recognition or falls back to prototype authorization in this mode.
- New enrollments require an authoritative session and the existing explicit photo consent. New template metadata includes model settings, installed library versions and SFace weight digest. A detected metadata mismatch fails closed with `template_incompatible`. Legacy metadata remains unknown, rather than being falsely assigned current provenance.
- Existing templates can only be linked with explicit consent plus authentication to **both** the original prototype enrollment account and an eligible real Botanist account using `link_existing_face.py`. The template is preserved; the new mapping uses the immutable real account ID. An email match alone never grants access. The operator flow is privileged and must be run only with the enrolling user's consent.
- Removing enrollment in real-account mode removes its real template or link and revokes real sessions. Any legacy prototype template remains preserved and unlinked, unable to authenticate in real-account mode.
- The explicit `start-authoritative-face-dev.sh` helper starts a private account-service instance on loopback port 3002, using the existing web account database, and starts the face backend in authoritative mode. Its key file is permission 600 and ignored by Git. It refuses to replace an existing listener. The account service is not publicly forwarded.

The current live legacy enrollment is **unlinked** and cannot authenticate a real botanist. No real Botanist account has been created by the agent; the suspended officer's role/status was not modified. Password login remains available through the authoritative account service for eligible accounts. Prototype credentials are not real-account credentials.

## Legitimate account creation and linking

The existing code has administrator-managed account creation; it does **not** contain a self-service Botanist approval workflow. Do not use the mobile Visitor registration or prototype `--create-user` command for a real Botanist.

1. An authorized Administrator signs in to the existing website, completes any mandatory password change, and uses User Management to create a new account with role **Botanist** and the intended user's own identity/email. An inactive legitimate Botanist can be activated through existing administrator status controls after the required organizational approval. Do not repurpose the suspended officer.
2. The Botanist signs in on the website with the administrator-issued temporary password and completes the required permanent password change. The real account must be Active and remain Botanist.
3. Keep the authoritative face helper running. In a second terminal, from the repository root:

```bash
cd mobileapp
export FACE_ACCOUNT_SERVICE_URL=http://127.0.0.1:3002
export FACE_ACCOUNT_SERVICE_KEY_FILE="$PWD/face_backend/data/account-service.key"
face_backend/.venv/bin/python face_backend/link_existing_face.py
```

The operator enters original prototype credentials and approved real Botanist credentials through hidden password prompts, then explicitly types `LINK`. Do not paste credentials into chat or shell arguments. This links the existing template without resetting it. If ownership/consent cannot be proven, leave it unlinked and arrange separately authorized enrollment; do not bypass the proof.

For a genuinely new face without an old enrollment, use password login with the approved real account and the registration consent switch. Duplicate legacy matches fail with `existing_face_requires_link`; they are not overwritten. Successful enrollment is not evidence that future different captures will pass the unchanged threshold.

## Consent-based multi-capture enrollment proposal

Multi-capture is **not activated**, and no existing data is re-enrolled. A secure candidate design would require fresh real-account password authentication and explicit consent, capture three live frontal/slightly varied views, apply anti-spoofing and quality checks separately, require inter-capture identity consistency, and commit the complete enrollment atomically. Each template needs model/preprocessing provenance, retention/deletion controls and encryption at rest. It must reject duplicates across other accounts.

Matching multiple templates with a simple "any sample passes" rule increases false-acceptance opportunities. A candidate voting/margin rule must be calibrated against genuine and impostor galleries, including account ambiguity; do not select it from this small fixture test. Existing legacy data should remain until explicit migration/re-enrollment authorization and successful validation. A software photo challenge does not prove physical liveness or provide Apple's Face ID security guarantees.

## Privacy-safe iPhone diagnostics

Logged data is limited to correlation ID, stages, image dimensions/EXIF orientation, detected-face area fraction, whether eye landmarks were found, model settings, match counts and account/session verification outcome. No photos, embeddings, passwords, tokens, individual matching distances, account names or emails are logged. Images are processed in memory and not retained. Debug metadata should have a defined short retention period; enrolled/matched counts still reveal aggregate service information.

Real mode also reports authoritative session rejection separately. `/health` verifies both model readiness and the actual account-service health, so an offline authority fails readiness and cannot fall back to the prototype.

## Tests

- 34 Python regression/integration tests passed with `FACE_TEST_PORTRAIT` set: includes actual-model rotation/mirror/blank-photo checks, controlled enrollment, private Node/Python integration, authoritative sessions, template linking preservation, metadata mismatch, unlinked/unknown/ambiguous rejection.
- 4 Node account-service/API/security tests passed: includes browser Origin/status controls, nonce replay, roles, mandatory password change, session expiry and revocation.
- 20 client API/session/completion tests passed.
- Mobile lint/type checking and changed web server ESLint/web type checking passed.
- Expanded actual-model evaluation completed four variants over the ten labeled public pairs. Recognition failures remain reported in the metrics.
- Actual SFace same-photo matching obtained and verified an authoritative account-service session **only for a temporary test Botanist**. This is not a real returning iPhone botanist or an unseen genuine-capture success test.
- Live public health: HTTP 200, authoritative mode ready. No fresh iPhone attempt was received during the investigation.

## Exact running and validation commands

Both live services are currently running. Do not launch duplicate listeners. For a later fresh run after stopping existing owned services:

```bash
cd mobileapp
# If Expo is already running, start only account service + Python:
bash scripts/start-authoritative-face-dev.sh --backend-only
# If Expo is also stopped, instead use:
bash scripts/start-authoritative-face-dev.sh
```

Verify:

```bash
curl https://glowing-space-succotash-v6p7j4r5rgr9fwjwp-8000.app.github.dev/health
```

Re-run evaluation with the public files already downloaded into `/tmp/niah-public-fixtures`:

```bash
cd mobileapp/face_backend
OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 TF_NUM_INTRAOP_THREADS=2 TF_NUM_INTEROP_THREADS=2 .venv/bin/python evaluate_matching.py --fixtures /tmp/niah-public-fixtures --output ../docs/public-matching-results.json
FACE_TEST_PORTRAIT=/tmp/niah-public-fixtures/img1.jpg OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 TF_NUM_INTRAOP_THREADS=2 TF_NUM_INTEROP_THREADS=2 .venv/bin/python -m unittest test_core test_http test_supervisor test_image_pipeline test_account_integration
```

Client/web checks from their respective directories:

```bash
# mobileapp
npm run lint
npm run type-check
node scripts/face-api.test.mjs
node scripts/face-session.test.mjs
node scripts/face-login-flow.test.mjs
# web
node --test server/*.test.mjs
./node_modules/.bin/eslint server/auth.mjs server/index.mjs server/face-service.mjs server/face-service.test.mjs
npm run type-check
```

## Physical iPhone validation gate

1. Complete legitimate account creation, permanent-password change and explicit template linking first. Existing unlinked face attempts must fail; no unauthorized Botanist access should appear.
2. Reload Expo Go once for the correlated client code. Confirm the face URL's health shows authoritative mode. Log out and leave email/password blank.
3. Retry three captures in good lighting with the whole face visible. Record error references and success/failure only; do not retain photos. The operator reads matching backend metadata, including `capture_quality`, `matching_completed`, `session_created`, `session_verified`, and frontend verification/auth-context/navigation events.
4. A positive result must identify the real immutable Botanist account, verify `/me`, display its correct dashboard, log out/revoke and repeat successfully on a **new capture**. Verify expiry/foreground revalidation too.
5. Test unknown subjects, multiple faces, camera denial and account-service outage. Administrators must also test suspension and mandatory-password-change states using a disposable approved test account; none may grant dashboard access. Do not change the real officer's restrictions.
6. Obtain representative consented genuine/different-person and spoof measurements before choosing a new threshold or multi-template policy. The passing regression suite does not satisfy this gate.

## Remaining security risks

The fixture sample is too small and correlated for reliable FAR/FRR calibration. OpenCV detection/alignment is capture-sensitive; historical template provenance remains unknown. Static-photo anti-spoofing and one-use upload challenges do not guarantee live-person capture. The existing local biometric database is not encrypted at rest; restrict filesystem access, define retention and secure backups before production. The HMAC service key grants trusted face-issuer privileges and needs secure storage/rotation; loopback and persistent replay checks reduce exposure but cannot protect a fully compromised host. Public face port 8000 remains temporary test exposure as previously authorized. These concerns require validation/review before real sensitive-account deployment.
