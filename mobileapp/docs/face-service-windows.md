# Face ID service on this Windows development computer

## Diagnosed failure, 29 October 2026

The mobile request `/health` uses the Face API base, so the full public URL is `https://idea-workforce-spam-foreign.trycloudflare.com/face/health`. The gateway strips `/face` and forwards GET `/health` to loopback port 8000. That port had no listener: direct access failed with ECONNREFUSED and both local/public gateway requests returned HTTP 503 with the gateway's fixed `Service unavailable` message. The public tunnel and mobile URL selection were working.

No retained development log contained reference `bd2ebad7c998`. Existing gateway transport tracing allowlists mobile account routes, and the Python GET health handler does not retain request IDs. The original request cannot be retrospectively correlated; the same failure was reproduced without credentials.

The existing `.venv-win` launcher referenced a removed Python 3.11.9 installation. Its dependencies and local model weights were present. A workspace-only Python 3.11.9 runtime was restored from the official python.org Windows embedded distribution into ignored `face_backend/.runtime/python311`; its `_pth` includes the existing `.venv-win/Lib/site-packages`. System Python and dependency versions were left unchanged. The real model initialization check passed; no injected matcher is used by the running service.

The working port-3001 account backend has the optional face adapter disabled. The documented authoritative development topology uses a separate loopback account instance on port 3002, backed by the same existing account store. The Windows launcher follows that topology and does not restart port 3001.

Python Windows chmod reports 0666 rather than enforcing POSIX 0600. `account_service.py` now checks a protected Windows DACL owned by the current user, rejects unrelated allowed principals and requires current-user read access. Unix permission checks remain unchanged. The launcher generates a random server-only 32-byte key if absent and applies a current-user-only DACL. Keys stay in ignored storage, never in Expo variables.

## Keep these processes running

The services are already running. Do not launch duplicates. To start them again after closing their terminals, open two PowerShell terminals at the repository root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File mobileapp/scripts/start-face-windows.ps1 -Mode Account
```

Then, in the other terminal:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File mobileapp/scripts/start-face-windows.ps1 -Mode Face
```

Both commands run in the foreground; keep them open. They refuse to replace occupied ports. The Face command uses the existing bounded-restart supervisor, real models, loopback binding and authoritative account restrictions. It does not enable prototype authentication or create user accounts. The local SQLite face-store schema is initialized by the existing server startup; no real face was enrolled, linked, deleted or replaced. Signed bridge requests use the existing nonce replay table as normal protocol bookkeeping. No account credentials, roles or status are changed.

Model-only readiness check, without opening the face database:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File mobileapp/scripts/start-face-windows.ps1 -Mode Check
```

Credential-free health checks:

```powershell
curl.exe http://127.0.0.1:8000/health
curl.exe http://127.0.0.1:8080/face/health
curl.exe https://idea-workforce-spam-foreign.trycloudflare.com/face/health
```

All three must report HTTP 200, `ready: true`, `accountService: authoritative` and `accountServiceReady: true`. Models must include SFace, Fasnet and opencv. An HTTP 200 from the separate password API does not establish Face ID readiness.

## Android verification

Keep the current tunnel, gateway, account server, face model process and Expo session running. Open `/face/health` in the phone browser, then return to the current Expo session and retry Face ID. Use an authorized account with a completed permanent password and an existing valid face enrollment. If enrollment is absent, complete the normal consent-based enrollment flow yourself. Do not bypass liveness or use prototype credentials. A healthy service does not establish recognition/liveness success on a real device.
