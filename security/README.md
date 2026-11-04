Latest review after pull: see [CURRENT_STATUS.md](CURRENT_STATUS.md) for HEAD 4c1bdd1, the five-feature matrix and **45 passing Node tests plus 2 Python tests**. Earlier sections below are historical evidence and retain their original counts.

# Cybersecurity implementation and evidence

Date: 28 October 2026 (Asia/Kuala_Lumpur). Baseline: Git 7241fb7; clean working tree before implementation. All test records are synthetic. No packages installed, SQL connections/migrations, IoT changes, commits or pushes.

## Status and assignment traceability

| Work | Status | Scope and requirement |
|---|---|---|
| API error-message fix | COMPLETED; TESTED in isolation | R3/R4/R5: four database error codes retain 400/409 with fixed public messages. Syntax-error bodies use a fixed message. 5xx remains generic. Authentication/RBAC untouched. |
| Legacy draft conversion | COMPLETED; TESTED in memory; PARTIALLY COMPLETED at deployment level | R4/R5/R6: read converts legacy arrays using existing injected encryption; verifies decrypted serialized content before replacement and rechecks authorization. Encryption/verification/space/write failures preserve original dummy bytes. Existing native key/encryption APIs unchanged. Native-device validation remains pending. |
| HTTPS/TLS configuration review | TESTED in isolation; PARTIALLY COMPLETED | R2/R3/R6: production HTTP origin rejection and API headers tested; existing gateway loopback/routing protections tested. Node HTTP behind Tailscale TLS termination is intentional. No new redirect/HSTS policy imposed on local mobile development. Live TLS, certificate validity and frontend response headers not tested. |
| Personal/assessment encryption preparation | COMPLETED prototype; TESTED; integration POSTPONED | R1/R2/R6 preparation only. AES-256-GCM with random 12-byte nonce, integrity tag and record-context AAD; externally supplied ephemeral 32-byte dummy key. No application imports this prototype. |
| Performance encryption preparation | COMPLETED hypothetical prototype; TESTED; actual requirement unresolved | No genuine employee/student performance records identified. The hypothetical category test proves a generic encryption capability, not an implemented performance feature. |
| Password-hashing verification | TESTED in isolation | Existing scrypt production function tested with dummy passwords, unique salts and independently derived correct/wrong values. No verifier/login/Face ID/RBAC change or database-backed regression claim. |
| Dependency vulnerability assessment | PARTIALLY COMPLETED | npm audit attempted for all three applications, exit 1 due to registry endpoint/network failure. No advisory results or clean dependency claim. Semgrep not available on PATH; not installed or executed. |
| SQL and IoT work | POSTPONED | See ../PENDING_WORK.md. |

## SSDLC execution

1. Plan: scope source-only API confidentiality, encrypted offline persistence, transport configuration and dummy encryption; exclude SQL/IoT and preserve authentication boundaries.
2. Identify threats: database metadata disclosure; readable legacy drafts; conversion data loss; ciphertext modification or record substitution; insecure deployed transport.
3. Assess baseline: read Git/source/configuration and execute old middleware/draft engine from Git 7241fb7 entirely in memory. Baseline tests intentionally assert vulnerable behavior: passing means the finding was reproduced, not that the old code was secure.
4. Implement smallest fixes: constant database-code messages; legacy draft encryption/round-trip verification before replacement. No schema, native cryptography, authentication or gateway behavior changes.
5. Verify/reassess: run same baseline-sensitive cases against current source, plus failure preservation, cryptographic integrity, existing offline recovery and gateway tests. Run mobile lint and typecheck.
6. Handoff: retain limitations, commands and genuine output; postpone storage/deployment integration explicitly; require final SQL/native/live-TLS verification before production acceptance.

## Confirmed finding register

- F01, database error disclosure: error.message was reflected for 23505/23503/23514/22P02; an API caller reaching such an error could learn internal names/details. Qualitative severity: medium, route reachability not proven here. Fixed public mapping in plant-conservation-backend/server.js. Reassessment confirms no dummy marker in four mapped cases or generic 503.
- F02, plaintext legacy drafts: JSON arrays were read without encryption or conversion, leaving sensitive observations readable to a party able to access device storage. Qualitative severity: medium. Fixed migration on read in mobileapp/utils/offlineDraftStore.js. Conversion failures reject the read without deleting original storage. Retry with the owner account after resolving storage/key failure. Existing encrypted drafts follow the prior path.
- Review item: mobileapp/utils/visitorStorage.js retains plaintext password-writing helpers; source search found no active callers. Do not label it an active authentication vulnerability. Legacy data cleanup needs a separate preservation/retention decision.
- Hardening review: no CSP/HSTS/frame/referrer/permissions headers were found in inspected API/gateway configuration. Frontend hosting can supply them; verify actual document responses before choosing policies. API-only CSP has limited relevance. HSTS belongs at a verified HTTPS boundary; do not force local HTTP redirects.

## Encryption inventory and implementation boundaries

Personal: users/visitors name, username, email, last_login; auth_events IP and linked subjects; field observations can link owners/location/media. Existing passwords are salted hashes, session tokens are hashed; hashing is not reversible personal-data encryption.
Assessments: plant_observation content and observation_review decision/comment/reviewer are candidate domain assessments, subject to assignment interpretation. Inspected SQL columns do not demonstrate field encryption. Underlying disk/backup encryption is unknown.
Performance: no genuine personnel/student performance records found. Plant height/health and JavaScript performance.now() are not personnel performance records.
Native drafts: fieldStorage.js already supplies Expo AES encryption and per-account SecureStore keys. This change reuses that path. Node AES-GCM fixtures do not certify native algorithm parameters or secure key hardware. Single setItem preserves originals for injected write failures; power-loss atomicity is not proven. There is no plaintext backup copy added.
Prototype key management: production integration needs an external secret store, versioned key identifiers, rotation/recovery, access controls, retention and query/uniqueness design. Never hardcode keys, put them in public env variables, or store them beside ciphertext. Encryption at rest does not replace TLS or authorization.

## Evidence and reproduction

Run from repository root; no broad SQL test suites:

```powershell
$env:SECURITY_BASELINE='1'
node --test security/offline-security.test.mjs
Remove-Item Env:SECURITY_BASELINE
node --test security/offline-security.test.mjs mobileapp/scripts/offline-recovery.test.mjs deploy/private-phone-config.test.mjs
npm.cmd --prefix mobileapp run lint -- --no-cache
npm.cmd --prefix mobileapp run type-check
```

Saved evidence: evidence/baseline.txt (7 passing baseline assertions, including expected vulnerabilities); evidence/reassessment.txt (22 passed, zero failed); evidence/mobile-lint.txt and mobile-typecheck.txt (both exit 0).
The middleware test extracts and executes the actual function without importing the plant application or IoT module. HTTPS mock tests import web factories without invoking createAuth or starting a database or listener. Existing offline tests use injected synthetic sessions, not real Face ID.

Audit attempts (each application directory): `npm.cmd audit --json --ignore-scripts --cache "$env:TEMP/niah-security-npm-cache"`. All exit 1 because the registry endpoint failed; evidence/*-audit.json contains raw mixed stdout/stderr transcripts, NOT valid JSON advisory reports. Repeat after registry access is available, save advisory JSON separately from stderr, review reachability, approve changes, then rerun identical audits. Do not use automatic audit fix.
Semgrep was not found on PATH. Once available through an approved environment, candidate command: `semgrep scan --config p/javascript --json web/server plant-conservation-backend mobileapp/utils`; registry rules require network. Manually verify findings and reassess actual fixes. No Semgrep result is claimed.

Acceptance now: isolated fixes and preparation validated; SQL/IoT integration, native storage behavior and live TLS remain outside acceptance. No full-system security certification is claimed.


## Scope correction and latest reassessment

This section supersedes earlier candidate-assessment/location scope descriptions. Sensitive GPS, protected/rare species locations, restricted plant observation notes and their access controls are POSTPONED IoT-related work. No current implementation or test targets them. Generic offline encryption regression uses dummy drafts only; ownership/session checks cover the existing generic storage/session boundary, not protected species or restricted-note access policies.

Conservation Officer assessment preparation now has an explicit synthetic training-assessment fixture with no plant/location content. The record is fictional and is not a new application feature. Actual assessment and performance storage integration remain POSTPONED; no actual performance-record feature has been identified.

Latest scoped command:

```powershell
node --test security/offline-security.test.mjs security/scope-security.test.mjs mobileapp/scripts/offline-recovery.test.mjs mobileapp/scripts/face-session.test.mjs mobileapp/scripts/face-capture-flow.test.mjs deploy/private-phone-config.test.mjs
```

Result: 39 tests passed, zero failed; evidence/scoped-reassessment.txt. Additional Python diagnostic tests: 2 passed, exit 0; evidence/face-diagnostics.txt. See FACE_ID_REVIEW.md for scope, findings and limits. Mobile HTTPS URL tests reject insecure, credential-bearing, query/fragment-bearing and unsuitable production hosts without network access; development HTTPS remains supported and release config does not fall back to development URLs. Existing configurations were verified; no deployment or transport behavior was changed.

Face ID recognition/liveness models, SQL-backed signed-bridge replay storage and native biometric/secure-storage behavior were not exercised. SQL, IoT and live deployment verification are POSTPONED. Existing npm audit network failures and unavailable Semgrep remain assessment limitations; no repeated installation or scan attempt was made in this correction phase.

