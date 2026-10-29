# Physical Android authentication verification

The public health endpoint and credential-free POST probes work from the development computer. This does not establish phone connectivity. No Android device is attached through adb in this environment. The current phone-specific failure is not yet established.

## On each phone

1. Open the current public `/auth-health` URL in the phone browser. Expect JSON identifying `Niah Authentication API` with `ready: true`. `accountAdapter: false` does not block direct password login.
2. Open the current Expo session on port 8082. The login screen must display `Development build: 20261029.3` above the form, together with the runtime Metro address. Older text means this phone is running an older bundle.
3. Tap **Check authentication connection (no credentials)**. This uses native fetch to GET the selected `/api/mobile/health`. Record only its result, error code and reference. No account is touched.
4. If it succeeds, attempt one login. Record the development error code/reference if it fails. Never share credentials, OTPs or tokens.
5. Expected temporary flow: `/api/mobile/password` returns a pending session; mandatory password change sends `/api/mobile/change-password`; after confirmation the app asks for a fresh login. Use separate authorized test accounts on the two phones: changing one account's temporary password makes that temporary password unusable on the other phone.
6. Repeat on a second Android phone. Test Wi-Fi first. For mobile-data API access, first load the bundle over Wi-Fi and then switch networks, or separately expose Metro using an Expo development tunnel. The public API hostname does not make LAN Metro reachable over mobile data.

## Trace interpretation

### Loading the corrected Expo Go session

The previous 8082 process returned HTTP 500 for the Android manifest even though direct JS bundle requests succeeded. Another project Metro instance was running on 8081. Both were replaced by one verified Expo Go instance on 8082. A bundle-only check was insufficient; `check-expo-runtime.mjs` now requires a successful manifest, matching project root, Android development entry, current marker, diagnostic control and development prelude.

Current session on the developer's Wi-Fi: `exp://172.17.100.166:8082`. This is the Metro address, not an API address or permanent production IP. It may change with the computer's network.

On Android, return to Expo Go Home, force-stop Expo Go if necessary, and reopen it. Open the exact address above using Expo Go's URL entry or a QR encoding that exact address. Do not select the older Recent project on 8081. Use the same Wi-Fi as the computer. If an old session persists, Android Settings > Apps > Expo Go > Storage & cache > Clear cache is a cache-only reset; do not choose Clear storage/data or uninstall. Do not delete project files or offline drafts.

The current Metro process is already running. If a manual restart becomes necessary, first stop that project's Metro terminal with Ctrl+C, then run in PowerShell:

```powershell
cd "C:\innovation project\Smart-Ground-Truthing-and-Digital-Biodiversity-System-for-Plant-Species\mobileapp"
$env:REACT_NATIVE_PACKAGER_HOSTNAME='172.17.100.166'
npm.cmd start -- --go --lan --port 8082 --clear
```

Use the computer's current Wi-Fi IPv4 address if it has changed. No API settings need to change for this Metro-session reset. Do not stop the auth server, gateway or Cloudflare connector.

Development mobile logs use `[mobile-api]` and contain only base/endpoint, method, generated reference, elapsed milliseconds, phase and status/code. They do not log bodies or arbitrary native exception messages. Production mobile diagnostic output and UI are disabled. Native fetch often reports only `Network request failed`; such errors remain `API_UNREACHABLE` rather than inventing DNS/TLS attribution.

Gateway development stdout contains JSON `mobile_transport` events. Backend development traces are retained in `web/server/data/auth-diagnostics.ndjson` alongside existing private diagnostics. Trace routes are restricted to password, change-password and health. Query strings, account identifiers, IPs and request bodies are excluded. Production transport tracing is off by default.

- No gateway event for the reference: request did not reach this gateway; check the phone's loaded URL and network path, including DNS/TLS/tunnel.
- Gateway received but no backend event: investigate upstream routing/process availability. A 503 may indicate gateway upstream failure.
- Backend received and completed: examine the HTTP status. A 401 is an authentication denial, not a connectivity error; 429 is rate limiting. Do not repeatedly retry credentials.
- Backend completed but phone got no response: investigate the return transport or interrupted response body using the same reference.
- Browser health succeeds but native check fails: compare the native runtime/network path; browser success alone does not identify the native failure.

Backend/gateway processes must load the updated modules to enable new tracing. Cloudflare need not restart while its existing upstream remains `http://127.0.0.1:8080`.

## Stable shared HTTPS hostname

Cloudflare Quick Tunnels use temporary hostnames and provide no uptime guarantee. They are usable for a short development session but cannot ensure a permanent API address. See https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/.

Stable deployment needs your Cloudflare account, an active domain/DNS zone and a named tunnel. None were provisioned by this change. Do not put Cloudflare credentials or service tokens in Expo public variables.

Using Cloudflare Zero Trust dashboard:

1. Open **Networks > Connectors > Cloudflare Tunnels**, create a cloudflared tunnel named `niah-development`, and select Windows.
2. On this developer computer, execute the connector installation/run command supplied by your dashboard. Keep its token private; use the generated command rather than inventing a token.
3. Add a published application route using a hostname in your own domain. Choose service type `HTTP` and URL `127.0.0.1:8080`. This HTTP hop is local loopback; phone traffic remains HTTPS.
4. Keep the existing gateway internal-path exclusions and application authentication. Browser-interactive Cloudflare Access sign-in is not a substitute for a mobile API authentication flow. If your organization requires Access, configure a supported native-client access method with your administrator; do not embed a shared service token in the app.
5. Verify `https://YOUR-ACTUAL-HOSTNAME/auth-health` on both phones before updating configuration.
6. Set `EXPO_PUBLIC_AUTH_API_URL` and `EXPO_PUBLIC_AUTH_API_URL_DEVELOPMENT` to `https://YOUR-ACTUAL-HOSTNAME/api/mobile` with `EXPO_PUBLIC_API_ENV=development`. Check for `EXPO_PUBLIC_BACKEND_URL_DEVELOPMENT`, `EXPO_PUBLIC_BACKEND_URL` or `EXPO_PUBLIC_PRIVATE_GATEWAY_URL` overrides. Keep production settings separate; release configuration never falls back to development settings.
7. Restart Metro with `npm.cmd start -- --lan --port 8082 --clear` from `mobileapp`, then verify its actual bundle from repository root with `node mobileapp/scripts/check-expo-runtime.mjs http://127.0.0.1:8082`. Reload both phones and repeat the native check.

Official named tunnel setup: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/.

No stable hostname or physical-device success is claimed until these steps are completed. The backend computer, gateway, named connector and network must remain available for a locally hosted API; use a managed backend host if that availability cannot be maintained.
