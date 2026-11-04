# Mobile API configuration and secure connectivity

The mobile app now selects one environment for API requests, saved-session binding
and image loading. No URLs contain credentials or API keys. Existing single URL
settings remain backward-compatible development fallbacks.

## Development / preview

In ignored `mobileapp/.env.local`:

```ini
EXPO_PUBLIC_API_ENV=development
EXPO_PUBLIC_PLANT_API_URL_DEVELOPMENT=https://YOUR-APPROVED-PLANT-ORIGIN
EXPO_PUBLIC_FACE_API_URL_DEVELOPMENT=https://YOUR-APPROVED-FACE-ORIGIN
```

Do not copy these placeholders as actual hosts. Alternatively keep the existing
EXPO_PUBLIC_PLANT_API_URL / EXPO_PUBLIC_FACE_API_URL development values. Explicit
_DEVELOPMENT values take priority. Restart/reload Expo after changing configuration.

## Production

Supply actual approved HTTPS origins through the build environment:

```ini
EXPO_PUBLIC_API_ENV=production
EXPO_PUBLIC_PLANT_API_URL_PRODUCTION=https://YOUR-APPROVED-PLANT-ORIGIN
EXPO_PUBLIC_FACE_API_URL_PRODUCTION=https://YOUR-APPROVED-FACE-ORIGIN
```

Production does not fall back to development URLs. Localhost and Codespaces origins
are rejected for production configuration. Plant URL is an origin only; the face
URL may have an approved proxy path prefix. No credentials, query strings or
fragments are accepted. `eas.json` preview/production profiles explicitly select
the matching environment; they do not invent deployment hosts. A standalone
release with no explicit API environment defaults to production and fails closed
if production origins are missing. The current local environment explicitly uses
development for preview testing.

Expo public environment values are embedded into the app bundle. Never put a
password, user token, device key or face account-service key in these settings.

## Diagnostics and request behavior

From mobileapp run:

```bash
npm run check:connectivity
```

The command prints service labels and safe error codes only. It does not send
application credentials. The runtime uses the same checks before authenticated
requests: GET `<configured-base>/health`, Accept JSON, credentials omitted, and a
5-second timeout. It checks the expected service identity/readiness, rejects
redirects/sign-in HTML and caches successful checks for only 10 seconds. Failed
checks are retried; cached results are scoped to the URL, never authorization.
Real requests still carry the normal bearer token and the backend still performs
session/RBAC checks. Offline leases remain 15 minutes, Botanist-only, local-device
unlocked and draft-only; the preflight does not create a session or extend a lease.

Plant health returns only a constant service name and readiness after SELECT 1.
It exposes no tables, accounts, paths or records. Face health must identify the
ready authoritative service. API redirects are requested to fail; exact native
redirect behavior must still be verified on the phone. Native images use the same
validated URL/health guard and show load failures, rather than silently using a
stale development address.

The current Codespaces URLs are private and diagnostics report a sign-in page.
That is an access configuration blocker, not a reason to disable HTTPS or bypass
GitHub. No visibility change has been made.

Approved access choices:

1. Preferred: choose a secured HTTPS staging deployment with persistent SQLite,
   private account adapter, application auth/RBAC and appropriate rate limits.
2. Development only: explicitly review a temporary forwarding/tunnel arrangement
   and its public surface before approving any exposure change.

An approved OS-level device VPN with private HTTPS origins is another option; it
does not require embedding GitHub session credentials.

No option is deployed automatically. Do not embed GitHub personal access
tokens or session cookies in the mobile application to bypass private forwarding.
Keep `/internal/face/*` and its shared signing key private and loopback-bound.

## Device verification still required

With approved reachability, test both health checks without app credentials, then
login/logout, enrollment consent and sessions, internal/protected record rejection,
image loading, camera/GPS denial and approval, offline restart/unlock, expiry,
partial sync and storage-full recovery. Builds and injected tests do not establish
native-device behavior. Physical sensor tests remain separate.

References: https://docs.expo.dev/guides/environment-variables/ and the project's
Expo SDK 57 documentation and installed module APIs.

## Prepared private phone route

A loopback-only Caddy gateway and mobile URL example now live in `deploy/`.
Its routing/bearer-header preservation and blocked internal/file paths were tested
with synthetic local upstreams. It is **not deployed**, joined to a VPN or proof of
phone HTTPS reachability. The recommended private Tailscale Serve setup requires
approval, an authenticated node/phone and restrictive tailnet policy before any
network change. No Funnel, public Codespaces ports or GitHub credential embedding.
See [the exact private access and native acceptance steps](final-manual-testing-checklist.md#2-private-phone-https-access--approval-before-setup).

## Current private-HTTPS continuation — 25 October 2026

See [the complete private setup guide](mobile-private-https-setup.md). The optional
`EXPO_PUBLIC_PRIVATE_GATEWAY_URL` derives plant origin and face `/face` from a
single verified HTTPS origin. Without it existing environment selection remains
unchanged. Saved sessions now bind to both service URLs, invalidating old-host
sessions after configuration changes. The local env was not overwritten with a
placeholder: the approved private hostname does not exist yet.

`node deploy/mobile-private-stack.mjs --start` supervises loopback auth :3001,
plant :3000, face :8000 and Caddy :8080 when already installed. Existing adapter
signing key is reused, no enrollment/installation/Serve invocation is automated.
`node deploy/check-private-https.mjs ACTUAL_HTTPS_ORIGIN --socks` verifies private
TLS/routing with userspace SOCKS after approved setup; it never follows redirects
or sends application credentials. `configure-private-mobile.mjs` additionally
requires the hostname to match the authenticated node before writing settings.

Diagnostics distinguish known DNS/TLS/timeout evidence, health authentication
requirements, wrong service and redirects. An opaque native network failure
cannot reliably distinguish VPN-off from DNS/TLS failure; it explicitly reports
that limitation. Regular API 401 retains session-expiry handling. Offline lease,
account ownership, protected species and native-device consent remain unchanged.

## Normal HTTPS backend without a phone VPN client

`mobileapp/utils/apiConfiguration.js` also accepts a regular reachable HTTPS
backend using `EXPO_PUBLIC_BACKEND_URL` (development fallback),
`EXPO_PUBLIC_BACKEND_URL_DEVELOPMENT` (development priority), or
`EXPO_PUBLIC_BACKEND_URL_PRODUCTION` (explicit release value). It derives the
plant origin and face `/face` base. A supplied normal backend takes priority over
the legacy private-gateway setting; absent a supplied URL the existing working
configuration is preserved. Release never falls back to the development value.

This is URL selection, not a tunnel/deployment or a networking-permission bypass.
The chosen gateway must actually be reachable from the phone with trusted HTTPS
and must implement the existing plant and face routes. A private Codespaces URL
or a `*.ts.net` origin still requires its existing network access. Do not point the
app at an arbitrary host, disable TLS, publish ports, or embed GitHub credentials.
No normal HTTPS deployment address has been provided or activated in this change.

Once an actual approved reachable gateway is available, place its HTTPS origin in
`mobileapp/.env.local` as `EXPO_PUBLIC_BACKEND_URL=...` for development, then
restart/rebuild Expo. Keep credentials out of all EXPO_PUBLIC settings. Existing
health/redirect checks, bearer authentication, RBAC, URL-bound sessions and offline
limits continue to apply. The prior private configuration remains active until a
replacement URL is explicitly supplied.
