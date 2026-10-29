# Face ID biometric protection review

Status: TESTED for isolated controls; PARTIALLY COMPLETED overall. Review date: 28 October 2026. No real photos, face embeddings, credentials, accounts, SQL database or recognition models used. No recognition/login/RBAC code changed.

| Control | Source evidence | Current result and limit |
|---|---|---|
| Image processing | mobileapp/face_backend/image_pipeline.py | In-memory normalization; image dimensions/format checks and diagnostic metadata. This review did not execute model inference, image decoding or camera capture. |
| Request logs | mobileapp/face_backend/server.py | Default BaseHTTPRequestHandler access logging suppressed; structured endpoint/reference and timing logs remain. Inspected normal paths do not print images or vectors. This is a source review, not exhaustive runtime log certification. |
| Diagnostic privacy | image_pipeline.py; matching_diagnostics.py | FACE_IMAGE_DEBUG gates metadata; existing diagnostic tests confirm opt-in output and expected matching metadata fields using dummy distances. Diagnostic helper accepts arbitrary keyword values, so call-site review and production debug-off remain necessary; not a universal redaction mechanism. |
| Signed internal bridge | web/server/face-service.mjs | HMAC-SHA256 and timing-safe comparison, loopback-only POST, timestamp window, nonce shape and payload limit. Isolated tests verify disabled/remote/stale/forged/oversized/wrong-content-type requests fail before any auth or DB access. Successful signed requests and persisted nonce replay protection depend on SQL and are POSTPONED. |
| Mobile session handling | mobileapp/utils/faceSession.js; faceSessionLifecycle.js | Native SecureStore configuration is WHEN_UNLOCKED_THIS_DEVICE_ONLY; nonnative/unavailable storage uses memory. Session lifecycle and camera-flow tests use injected storage/API only. Real OS biometric unlock, hardware key protection and native lifecycle are POSTPONED. |
| Template storage | mobileapp/face_backend/core.py; authoritative_auth.py; server.py | Legacy/local paths serialize templates as JSON in SQLite text fields. Encryption-at-rest is not established by the inspected source. Runtime setup/schema integration may differ; do not open real stores. Classification: sensitive biometric persistence gap; integration/remediation POSTPONED with SQL work. |
| Recognition/liveness | server.py | Source requests SFace/anti-spoofing pipeline and rejects processing failures. No accuracy, liveness bypass resistance, false acceptance or real-model claim made. Recognition behavior unchanged. |

Recommendations for resumed work: approve biometric retention/consent/deletion requirements, confirm active store, implement appropriate authenticated template encryption with separate keys, verify backups/deletion and nonce replay persistence with dummy data, and run model/device evaluation in an approved environment. These are recommendations, not completed fixes.

Safe commands, repository root:

```powershell
node --test security/scope-security.test.mjs mobileapp/scripts/face-session.test.mjs mobileapp/scripts/face-capture-flow.test.mjs
```

From mobileapp/face_backend:

```powershell
python -B -m unittest test_matching_diagnostics -v
```

The Python command imports definitions but never constructs Auth, opens SQL or starts a service. Two tests passed. The first attempted invocation used the repository directory and failed output redirection before Python ran; it was rerun from the correct directory. Saved raw stderr/stdout includes PowerShell NativeCommandError formatting for unittest stderr; actual process exit was 0 and the report ends OK.

## Review after latest pull

HEAD 4c1bdd1 review: inspected Face ID paths have no pulled changes relative to the earlier review. Repeated 2 isolated matching diagnostic tests passed (exit 0), and session/capture/bridge regressions are included in the 45 passing Node tests. No real model, native biometric store, camera or SQL persistence was exercised. Current feature status and key/logging limitations are in CURRENT_STATUS.md. Template encryption and persistent nonce replay verification remain POSTPONED; recognition and storage formats unchanged.
