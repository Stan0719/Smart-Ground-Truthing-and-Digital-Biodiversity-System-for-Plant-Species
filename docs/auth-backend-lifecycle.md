# Authentication backend process lifetime — 29 October 2026

## Outcome and evidence limit

The service is running independently as **PID 22584** on **127.0.0.1:3001**, with private diagnostics enabled and retained. Its live opaque store fingerprint matches the existing file-configured authentication database/schema and the two prior user-started instances. No credentials or environment values were printed or copied. No user records, passwords, email delivery, database schema or unrelated service were changed.

**The exact historical exit cause is NOT established.** Prior PIDs 29312 and 21364 had exited, but their retained logs contain startup only. Windows Application events contained no Node crash entry for the inspected period. That does not rule out an exception, terminal/task shutdown or external termination. No unsupported attribution is made.

The original source has a referenced HTTP listener, no .unref() calls and no lifetime timer. Its explicit process.exit(0) was confined to SIGINT/SIGTERM cleanup. Completing the ES module or allowing PostgreSQL's idle pool timeout does not, by itself, close that HTTP listener.

## Controlled reproduction performed

1. Verified port 3001 was free. Launched the UNMODIFIED entrypoint in a controlled child using the existing startup settings and AUTH_DEBUG=1/HOST=127.0.0.1/PORT=3001. No credentials were submitted; health requests used Connection: close, so idle intervals did not depend on persistent client sockets. The test-only IPC channel was unreferenced, so it could not keep the server alive.
2. PID 2132 remained alive for **40 seconds**, with eight health samples returning 200, including after the pool idle timeout. It exited code 0 only after the harness explicitly emitted SIGTERM inside its own child. No existing process was signalled or killed.
3. A separate original-code overlapping SIGINT/SIGTERM test (PID 10916) also exited cleanly with code 0. It did not reproduce an unexplained crash; it is NOT claimed as the historical cause.
4. An initial instrumented-entrypoint run caught an introduced lifecycle wiring ReferenceError. This was corrected before persistent deployment, then the full real-entrypoint test was repeated successfully. This transient test failure is distinct from the user's earlier exits.
5. Updated controlled PID 43260 remained healthy for 40 seconds and exited code 0 only after the requested test shutdown. Retained events identify SIGTERM -> server_closed -> database_closed -> shutdown_complete -> process_exit, reason signal.
6. Started the missing service independently, PID 22584. A separate health-only observer then verified **45 seconds / ten samples**, all 200, same PID and opaque instance identity. The startup PowerShell parent PID 42100 had already exited while auth remained running and port 3001 stayed bound. This verifies survival after the launch command returns; it does not prove indefinite lifetime or reconstruct an earlier termination.

Controlled harness commands (local test helpers, no real logins):

```powershell
node .local-tools/auth-lifetime-probe.mjs
node .local-tools/auth-lifetime-probe.mjs --double-signal
```

Those helpers start only their own child, use schema-read startup/health, and request its normal in-process signal shutdown through an unreferenced private test IPC channel. They do not use taskkill, PID kill, process-memory inspection or credential operations.

## Changes made

- web/server/auth-lifecycle.mjs — observes process startup, listening, server close/error, signal requests, database cleanup, cleanup failure, uncaught-exception monitor, beforeExit and exit. Records safe name/code/origin only; no error messages, stacks, request bodies or secrets. Fatal monitoring does not swallow exceptions or unhandled rejections. Overlapping shutdown requests are guarded so cleanup runs once; cleanup failure is explicit/nonzero.
- web/server/index.mjs — installs lifecycle observation before auth initialization; attaches server/database shutdown; moves auth_runtime readiness event into the successful listen callback. The listener stays normally referenced. No keep-alive interval, automatic respawn or authentication-policy workaround was added.
- web/server/auth-diagnostics.mjs — strict lifecycle-event/field allowlist for private bounded retention.
- web/server/auth-lifecycle.test.mjs — real HTTP listener, requested/overlapping shutdown, unexpected close, database-cleanup failure and fatal-observer regressions with synthetic dependencies.
- web/server/auth-diagnostics.test.mjs — lifecycle message/stack/secret redaction regression.
- web/scripts/check-auth-lifetime.mjs — separate health-only observer that verifies stable PID/instance and port responses; it cannot keep the auth server's event loop alive.
- docs/auth-backend-lifecycle.md, docs/botanist-temporary-password-investigation.md and PENDING_WORK.md — evidence and limitations.

Logs:
- Primary private lifecycle/auth log: web/server/data/auth-diagnostics.ndjson (one bounded rotated .previous file).
- Standalone stdout/stderr: .local-tools/auth-lifecycle.stdout.log and .local-tools/auth-lifecycle.stderr.log. No raw exception output was copied into reports.

Interpretation for a future exit:
- shutdown_requested names a received SIGINT/SIGTERM; process_exit records signal/exit code after cleanup.
- uncaught_exception records safe errorName/errorCode and whether origin was an uncaught exception or unhandled rejection; default fatal behavior is retained.
- server_closed without a shutdown signal records listener closure independently of auth/account logic.
- before_exit records whether the listener was active when Node drained its event loop.
- An abrupt OS/host termination may prevent JavaScript exit callbacks entirely. Absence of an exit event is not conclusive proof of who stopped the process. Foreground PowerShell $LASTEXITCODE and external process observation remain useful.

## Actual validation results

```powershell
node --test web/server/auth-lifecycle.test.mjs web/server/auth-diagnostics.test.mjs deploy/mobile-login-gateway.test.mjs web/server/client-boundary.test.mjs web/server/website-origin.test.mjs mobileapp/scripts/first-login-screen.test.mjs mobileapp/scripts/mobile-auth-routing.test.mjs mobileapp/scripts/face-api.test.mjs mobileapp/scripts/face-capture-flow.test.mjs mobileapp/scripts/api-connectivity.test.mjs mobileapp/scripts/face-session.test.mjs
```

**61 passed, 0 failed** after the wiring correction. Ten focused lifecycle/diagnostic tests pass. Installed oxlint over index/lifecycle/diagnostics passes; web npm.cmd run type-check passes; index syntax check and git diff --check pass.

Live verification:
- Direct /auth-health and gateway /auth-health: 200, ready.
- Loopback /internal/auth/diagnostics: 200, PID22584, diagnosticsEnabled true, fingerprint matches expected configured store.
- Public https://scores-enzyme-boundary-talent.trycloudflare.com/auth-health: 200, ready.
- Public /internal/auth/diagnostics: 404, denied.
- Windows listener ownership: 127.0.0.1:3001 owned by PID22584 after its launch parent exited.

No account inspection beyond previously approved startup schema readiness, account writes, password operations, mail, migrations, package installs, commits or pushes were performed in this process-lifetime investigation. Unrelated gateway/tunnel/website/Expo processes were not restarted or stopped.

## Exact safe startup and observation commands

**Auth is already running; do not start a duplicate.** For a future foreground start, only after the prior auth instance has been stopped gracefully through its verified owning console/control:

```powershell
Set-Location 'C:\innovation project\Smart-Ground-Truthing-and-Digital-Biodiversity-System-for-Plant-Species\web'
if (Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object LocalPort -eq 3001) {
    throw 'Port 3001 is occupied. No existing process was stopped.'
}
$env:AUTH_DEBUG = '1'
$env:HOST = '127.0.0.1'
$env:PORT = '3001'
node server/index.mjs
Write-Host "Authentication exit code: $LASTEXITCODE"
```

Use the original verified environment/configuration. Do not print or reconstruct secret values. Do not use npm run dev for auth: it combines the server and frontend lifetime. In an auth-only foreground terminal, Ctrl+C invokes the logged graceful path. Do not use taskkill or force-kill the current verification service; it was started independently with retained logs and is left running.

In another terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:3001/auth-health
Invoke-RestMethod http://127.0.0.1:3001/internal/auth/diagnostics
node web/scripts/check-auth-lifetime.mjs 45
```

The last command is run from the project root and checks only health/opaque identity. If a future exit occurs, provide only lifecycle event names, signal/reason/error code, PID and exit code. Never provide passwords, hashes, tokens, database URLs or raw secret-bearing logs.

Final observation after documentation: PID22584 was still healthy 348 seconds after its recorded listener startup, with diagnosticsEnabled=true and no process_exit event. The same process remained bound throughout the independent 45-second observer; no synthetic keep-alive was installed. Final diff check passed after removing an extra blank line at the entrypoint EOF.
