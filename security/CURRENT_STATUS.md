# Current five-feature security status after Git pull

Review date: 28 October 2026 (Asia/Kuala_Lumpur). Current HEAD: 4c1bdd1. Earlier source baseline: 7241fb7.

## Pull comparison and preservation

Initial working tree already had modified mobileapp/utils/offlineDraftStore.js and plant-conservation-backend/server.js, plus untracked security/ and PENDING_WORK.md. These were preserved. Git comparison for reviewed web/mobile/deploy and plant server paths showed only pulled changes to web/src/router/index.ts and web/src/views/AdminModuleView.vue. No pulled changes to the reviewed cryptography, HTTP, Face ID or draft engines. No regression found within inspected/tested scope; this does not certify every repository path. The previous 39 Node tests were rerun before the new fix and all passed. Review evidence is in evidence/pull-review-baseline.txt and pull-review-git-comparison.txt.

## Five-feature completion matrix

| Feature | Completed | Tested | Remaining work possible now | Postponed work | Final status |
|---|---|---|---|---|---|
| 1. Personal data encryption | Isolated AES-256-GCM prototype with external ephemeral keys, 12-byte IV, enforced 16-byte tag, context binding and envelope validation; source key/logging and Face ID review | Dummy name/email round trip; wrong/missing/invalid keys; tampering; context substitution; malformed envelopes; encryption failure; Face ID bridge rejects before persistence; diagnostic metadata | No confirmed approved coding gap remains in the prototype; it is not production persistence | SQL integration, persistent key management/rotation/recovery, biometric template encryption/retention; native key/device verification | PARTIALLY COMPLETED overall; COMPLETED/TESTED preparation |
| 2. Performance and assessment record encryption | Explicit dummy Conservation Officer training-assessment prototype; no application feature created | Round trip, integrity/tag/ciphertext changes, wrong/missing keys, wrong context, malformed envelope and encryption failure | Requirement interpretation for genuine performance records; no such feature identified in current UI search or earlier source/schema review | Actual assessment storage/query/key integration; genuine performance integration only if records are identified; plant/restricted notes remain excluded IoT work | PARTIALLY COMPLETED overall; COMPLETED/TESTED dummy assessment preparation |
| 3. HTTPS/TLS | Existing production origin enforcement, mobile HTTPS validation, Secure/HttpOnly/SameSite cookie policy, no-store/nosniff API headers and loopback gateway configuration preserved | Production HTTP origin rejected; production cookie issuance/clear flags; local HTTP development cookies omit Secure; actual web mock headers; mobile URL/release separation; gateway declaration tests | No verified configuration bug found; no speculative header policy applied | Actual endpoint certificate/chain/redirect/frontend header verification; deployed proxy/TLS boundary; physical mobile connectivity; SQL TLS and IoT transport excluded | COMPLETED/TESTED isolated configuration scope; PARTIALLY COMPLETED live feature |
| 4. Secure API errors | Existing known database-code and syntax-error sanitization preserved; web generic error response retained | Actual extracted plant middleware tests for four codes, generic 503, 400 malformed JSON and 413; mock web handler 500/409/404 bodies and 500 log confidentiality | No further confirmed information-disclosure fix identified in permitted paths | Real SQL-route integration testing; IoT and restricted-data endpoints excluded | COMPLETED/TESTED approved isolated scope; integration verification POSTPONED |
| 5. Offline observation encryption | Existing native encrypted write adapter, per-account SecureStore keys, serial draft engine and verified legacy-array conversion preserved | Legacy conversion/read-back, failed encryption/verification/space/write preservation, retry/recovery, wrong account/key, corrupt ciphertext and unchanged bytes; existing recovery tests | No verified generic draft-engine coding gap identified | Native Expo/SecureStore encryption, OS interruption/restart and power-loss verification; SQL synchronization and restricted/location work excluded | COMPLETED/TESTED generic engine scope; PARTIALLY COMPLETED device verification |

None of the five is certified end-to-end in production. Within the approved isolated scope, API errors and generic offline draft engine work are complete; HTTPS configuration tests are complete; personal/assessment dummy preparation is complete. Features 1/2 still need future production coding with approved SQL storage/key contracts. Features 3/5 need deployment/device verification for their non-SQL portions. Feature 4 additionally needs real SQL-route verification once allowed, not a speculative code rewrite.

## New verified finding and fix

F03: dummy prototype decryption accepted a truncated four-byte GCM tag despite generating 16-byte tags. Reproduction used dummy personal data only and is saved in evidence/pull-review-before.txt. This is a prototype validation weakness, not evidence of a production exploit or pull regression. Added strict external key/context checks on both operations, canonical base64 envelope validation, fixed 12-byte IV/16-byte tag checks, and explicit authTagLength=16 on decryption. Existing production formats and crypto paths untouched. Reassessment rejects the exact shortened-tag case and other malformed inputs.

No further confirmed API disclosure was found in permitted tested paths. Plant 4xx errors can intentionally use domain error.message for application validation errors; arbitrary unexercised paths are not certified. SQL/IoT/location/restricted-note route review and tests were not performed. Web mocks throw synthetic errors from an injected session function; they never execute a query or create an auth store. Cookie issuance tests execute the actual formatter expression in isolation; expired-cookie/header tests execute the actual web request handler. No successful database login is claimed.

## Key, logging and biometric review

Prototype keys are caller-supplied Node Buffers, generated only inside dummy tests; no key/ciphertext database, public env export or application import was added. Helpers do not log plaintext/keys. Missing keys fail before encryption/decryption. Key identifiers, durable provisioning, rotation, backup recovery and memory-hardening are not implemented. No claim of production secret management.

Re-reviewed web/server/auth.mjs, mobile face image_pipeline.py, server.py, account_service.py and native fieldStorage/faceSession adapters. Runtime recognition/capture remains unchanged. Existing debug output exposes processing metadata and authentication verification outcome/role when debug flags are enabled; production debug-off and restricted log access remain recommendations. Startup errors may include exception text and source basenames in server-side logs; exhaustive production log review is postponed. No raw biometric vector/image logging was identified in inspected normal call sites. Diagnostic helpers are not universal redactors.

Biometric templates remain JSON text in inspected legacy/local SQL persistence paths; source does not establish encrypted template storage. Encryption remediation, deletion/retention and persisted nonce replay testing are POSTPONED. No real biometric store was opened. See FACE_ID_REVIEW.md; its isolated-test claims remain valid after this pull, not claims of encrypted biometric storage.

Current UI record search found only JavaScript performance.now() timing calls, not personnel performance records. Earlier broad inventory also found no genuine performance record feature. Search results saved in evidence/pull-review-record-search.txt. This is a bounded inventory, not proof no future module will contain such records. Do not repurpose plant measurements or create a performance feature. The historical hypothetical-performance category in generic crypto tests is algorithm demonstration only, not an implemented record type.

## Reassessment commands and evidence

```powershell
node --test security/offline-security.test.mjs security/scope-security.test.mjs security/pull-review.test.mjs mobileapp/scripts/offline-recovery.test.mjs mobileapp/scripts/face-session.test.mjs mobileapp/scripts/face-capture-flow.test.mjs deploy/private-phone-config.test.mjs
npm.cmd --prefix mobileapp run lint -- --no-cache
npm.cmd --prefix mobileapp run type-check
# From mobileapp/face_backend:
python -B -m unittest test_matching_diagnostics -v
```

Results: 45 Node tests passed, 0 failed, exit 0 (evidence/pull-review-reassessment.txt); 2 Python tests passed, exit 0 (pull-review-face-diagnostics.txt); mobile lint and typecheck exit 0 (pull-review-mobile-lint.txt and pull-review-mobile-typecheck.txt); git diff --check exit 0. Raw Python stderr transcripts may contain PowerShell NativeCommandError formatting even though unittest exit is 0 and report ends OK.

No packages installed; no SQL queries/connections/migrations/schema changes; no IoT tests/code; no GPS, protected-location or restricted-note implementation/tests; no live endpoint called; no commit/push. Prior npm audit registry failures and missing Semgrep still limit dependency/static assessment; no new clean scan claim is made.

SSDLC evidence chain: inventory/pull baseline -> reproduced F03 -> minimal prototype fix -> same-case reassessment plus regression suite -> documented residual work. F01/F02 fixes still pass. All SQL/IoT/live verification is POSTPONED in PENDING_WORK.md; university mandatory production encryption requirement remains only partially fulfilled until permitted integrations are verified.
