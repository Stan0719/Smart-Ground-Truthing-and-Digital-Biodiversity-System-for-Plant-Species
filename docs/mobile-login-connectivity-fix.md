# Mobile login connectivity investigation — 28 October 2026

## Confirmed failure and request path

The current ignored mobileapp/.env.local selects development and sets both EXPO_PUBLIC_AUTH_API_URL and EXPO_PUBLIC_AUTH_API_URL_DEVELOPMENT to https://unfortunately-love-visual-send.trycloudflare.com/api/mobile. Both Face URL variables use the same origin plus /face. These are public endpoint addresses, not secrets.

Login.js calls faceApi('/password'); with the existing auth variable present, that resolves to POST /api/mobile/password on Node, not Python. /change-password, /me, /logout and recovery similarly use the account base. Face recognition uses /face/challenge and /face/face-login. The historical Python /password endpoint exists and delegates through the signed account adapter, but direct password login does not need it.

Observed without credentials or database access:
- http://127.0.0.1:3001/health -> 200, Niah Authentication API, ready true.
- http://127.0.0.1:8080/auth-health -> 200, same account service. The active gateway on 8080 is a Node process; the checked-in alternative gateway template is Caddy. No restartable source for that active Node gateway was identified.
- Cloudflared executable exists at .local-tools/cloudflared/cloudflared.exe. A running process listens on loopback metrics port 20241.
- GET http://127.0.0.1:20241/quicktunnel reports unfortunately-love-visual-send.trycloudflare.com.
- GET http://127.0.0.1:20241/ready -> 503, readyConnections 0.
- That hostname fails DNS lookup (ENOTFOUND); example.com resolves as a control.

The immediate blocker is the disconnected development tunnel and unreachable hostname, before password validation reaches Node. The displayed face-backend wording is misleading: the old shared HTTP client used it for account failures too. Additional client defects: missing auth configuration silently fell back to Python, auth ignored environment-specific selection, and saved-session binding independently selected raw environment values. The prior isolated tests did not establish tunnel/device reachability.

## Implemented changes

- All password, first-password-change, recovery, registration and session requests explicitly use the selected Node auth URL; no silent Face service fallback.
- Auth uses development/production configuration and gateway /api/mobile derivation; saved sessions bind to that same selected auth URL. Production auth settings do not fall back to standalone development auth settings.
- Auth base validation requires HTTPS and /api/mobile. Auth network/timeout errors identify authentication, distinguish HTTP credential rejection from transport failure, and identify 404 endpoint misconfiguration. Auth request timeout is 15 seconds; Face request behavior retains its longer timeout. Cookies are omitted from native bearer requests.
- Direct /api/mobile/register preserves Visitor registration without needing Python. /api/mobile/health provides a constant non-database service identity for diagnostics. Existing /health and /auth-health remain usable on the running older process; the new mobile-health route requires reloading Node after database work is permitted.
- Existing website role restrictions, hashes, temporary expiry, password rules, session revocation, Face matching and RBAC grants/resolver remain intact.

Files changed in this follow-up (earlier work is preserved):
mobileapp/utils/apiConfiguration.js; mobileapp/utils/faceApi.js; mobileapp/utils/faceSession.js; mobileapp/scripts/check-api-connectivity.mjs; mobileapp/scripts/face-api.test.mjs; mobileapp/scripts/face-capture-flow.test.mjs; mobileapp/scripts/mobile-auth-routing.test.mjs (new); mobileapp/package.json (scripts only); mobileapp/.env.example (public endpoint examples only); web/server/http.mjs; web/server/client-boundary.test.mjs; PENDING_WORK.md (append); docs/mobile-login-connectivity-fix.md (this report).

## Exact service and tunnel commands

Commands below are instructions only: no backend/tunnel was restarted. Run from the repository root in PowerShell unless noted.

Node account service:

```powershell
$env:HOST = '127.0.0.1'
$env:PORT = '3001'
node web/server/index.mjs
```

Equivalent from web: npm.cmd run server. Startup calls createAuth(connectAuth()), opens PostgreSQL, and reads schema_migrations. It automatically loads the existing server/backend environment files. It requires the existing auth schema, database availability and configured credentials; optional Face account key configuration is loaded separately by the existing environment loader. Under the current no-database restriction, DO NOT run this command or the full stack supervisor. No migrations are needed for this fix. Do not replace the already-running account service while database access is prohibited.

The installed Cloudflare executable can restart the existing tunnel target. Stop only the original tunnel via Ctrl+C in its existing terminal first; keep the gateway on 8080 running:

```powershell
& '.\.local-tools\cloudflared\cloudflared.exe' tunnel --url http://127.0.0.1:8080 --metrics 127.0.0.1:20241
```

This creates a temporary public HTTPS address; the command was not executed in this investigation. Use the hostname it actually prints. Quick tunnel addresses can change on restart. Retrieve its current hostname and readiness in another terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:20241/quicktunnel
Invoke-RestMethod http://127.0.0.1:20241/ready
```

The quicktunnel endpoint exposes only the assigned hostname; do not dump diagnostic config/command-line routes or credentials. The hostname alone is insufficient: readiness must report active connections and the phone must reach auth-health. See Cloudflare's implementation: https://github.com/cloudflare/cloudflared/blob/master/metrics/metrics.go .

The existing checked-in gateway alternative, if Caddy is already available and port 8080 is free, uses:

```powershell
caddy validate --config deploy/private-phone.Caddyfile --adapter caddyfile
caddy run --config deploy/private-phone.Caddyfile --adapter caddyfile
```

Caddy was not found on this session's PATH. Do not install it or start a second listener as part of this task. The existing template preserves /api/mobile/* -> Node 3001 and strips /face -> Python 8000; blocks internal routes. Historical private Tailscale setup and its hostname are not proof of a configured Windows private VPN. No VPN or exposure settings were changed.

## Configure and verify the phone/emulator

Once the existing tunnel is connected, use its ACTUAL printed HTTPS origin in ignored mobileapp/.env.local. Set EXPO_PUBLIC_API_ENV=development, EXPO_PUBLIC_AUTH_API_URL_DEVELOPMENT=<actual-origin>/api/mobile, and EXPO_PUBLIC_FACE_API_URL_DEVELOPMENT=<actual-origin>/face. Update the legacy EXPO_PUBLIC_AUTH_API_URL and EXPO_PUBLIC_FACE_API_URL too if they remain. Do not copy the now-unreachable hostname. If a unified EXPO_PUBLIC_BACKEND_URL_DEVELOPMENT or private gateway setting is already selected, it takes precedence; use that same actual gateway origin. No URL was invented or written to .env.local in this investigation.

An HTTPS tunnel works for a physical phone and Android/iOS emulators alike; their localhost refers to themselves. Existing HTTP LAN configuration (historical 192.168.15.1) is not accepted by the secure client. Do not substitute HTTP localhost/10.0.2.2 or disable TLS validation. Ensure the device has internet access and, for private gateways, approved private-network access.

Restart Expo from mobileapp after changing the URL:

```powershell
npm.cmd start -- --clear
```

Rebuild installed release bundles to embed new public environment values. Then:
1. Open <actual-origin>/auth-health on the phone browser: expect JSON service Niah Authentication API and ready true. After the updated Node service is permitted to start, /api/mobile/health also works.
2. In mobileapp run npm.cmd run check:connectivity -- auth. It checks only /api/mobile/health, never sends credentials, and performs no SQL. On the current tunnel this exits 1 with API_DNS, an actual failing infrastructure check.
3. To check the password route from a phone HTTP client/Shortcut without database access, POST JSON {} with Content-Type application/json to <actual-origin>/api/mobile/password. Expect 401 JSON generic login error. Invalid input is rejected before credential lookup. GET from a phone browser does not test POST /password. Do not send real credentials or use a real login while database work is prohibited.
4. When database testing is authorized, use a dummy admin-provisioned Botanist and captured mocked email: temporary login -> matching new password inside app -> fresh permanent-password login. Confirm website rejection and Face ID regression on the actual phone.

## Actual tests and limits

Root command:
node --test web/server/client-boundary.test.mjs mobileapp/scripts/mobile-auth-routing.test.mjs mobileapp/scripts/face-api.test.mjs mobileapp/scripts/face-capture-flow.test.mjs mobileapp/scripts/api-connectivity.test.mjs mobileapp/scripts/face-session.test.mjs

The tests exercise the actual mobile router/client through real loopback HTTP into the real auth HTTP handler with an in-memory adapter. The injected TEST transport maps synthetic HTTPS hostnames to local HTTP; runtime HTTPS validation is unchanged. No SQL engine or database is started. Covers temporary/new-password lifecycle, invalid temporary credentials, disabled/expired accounts, website login/password denial, exact account/Face path separation, missing/wrong URLs, refused local connection, status-vs-network errors, and Face capture/session contracts. These do not prove physical face recognition, device TLS or PostgreSQL storage.

mobileapp npm.cmd run lint and npm.cmd run type-check pass. Final focused test result: 39 passed, 0 failed. git diff --check also passed. Current tunnel connectivity remains a recorded failure, not claimed as fixed by the code changes. No SQL, PostgreSQL/Supabase connection, package install, migration, IoT/location edit, real email, commit or push was performed. Native-device success and real account/storage integration remain blocked until tunnel connectivity and authorized database testing are available.
