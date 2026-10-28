# Complete RBAC audit — 24 October 2026

> Current staff-email policy supersedes earlier activation-link guidance: preserve the existing temporary-password template and require first-login change. No new template is needed. See [staff email guide](emailjs-activation-template.md).

## Result and scope

**FIXED AND VERIFIED:** the reproducible authorization defects described below are repaired. The approved permission model is unchanged. This is a source review and automated/local verification, not a claim of production readiness or an external penetration test.

Reviewed shared rules; plant authorization, domain, media and IoT routes; authentication, activation, recovery, signed face adapter and account migrations; website router/services/components/dashboards; mobile login/session, connectivity, collection, knowledge, encryption and synchronization; SQLite schemas/backups and the associated tests. Read the existing final verification, mobile connectivity, activation template and SQLite storage documents.

**139 distinct tests passed, zero failed, seven skipped** in the final run. Seven new top-level regression cases supplement the previous 132 cases; the role-denial matrix was also expanded within an existing test. Physical-device behavior, real email delivery and positive portrait/liveness validation remain unverified. See [final verification, section 22](final-system-verification.md#22-master-rbac-security-audit--current-results).

## Exact role-permission matrix

The following table was generated directly from `Object.entries(require('../shared/rbac.cjs').grants)`, with columns `Guest` followed by exported `roles`. It is a snapshot, not a second editable policy. Re-run that expression after changing the shared policy.

| Permission | Guest | Visitor | Botanist | Conservation Officer | Administrator |
|---|---|---|---|---|---|
| `accounts.manage` | — | — | — | — | Yes |
| `permissions.manage` | — | — | — | — | Yes |
| `audit.read` | — | — | — | — | Yes |
| `security.manage` | — | — | — | — | Yes |
| `system.read` | — | — | — | — | Yes |
| `plants.public.read` | Yes | Yes | Yes | Yes | — |
| `plants.scientific.read` | — | — | Yes | Yes | — |
| `plants.protected.read` | — | — | — | Yes | — |
| `plants.create` | — | — | Yes | — | — |
| `observations.create` | — | — | Yes | — | — |
| `observations.edit.own` | — | — | Yes | — | — |
| `observations.review` | — | — | — | Yes | — |
| `species.manage` | — | — | — | Yes | — |
| `reports.read` | — | — | — | Yes | — |
| `devices.manage` | — | — | — | — | Yes |
| `thresholds.manage` | — | — | — | — | Yes |
| `devices.read` | — | — | — | Yes | Yes |
| `readings.read` | — | — | — | Yes | Yes |
| `alerts.read` | — | — | — | Yes | Yes |
| `responses.manage` | — | — | — | Yes | — |

“Yes” requires an Active account with `mustChangePassword === false`. Guest means no authenticated account; it is not an assignable account role. Unknown permission names and unrecognized role strings are denied. Backend canonical role names are exact; the mobile presentation maps only Botanist/Visitor to `botanist`/`visitor` after authoritative verification. A client profile never assigns backend privileges.

Administrator has explicit account/system/IoT grants and **does not have plant-read, scientific, review or protected-species grants**. Only Conservation Officer has protected-species access. Botanist sees public/internal species and owns collection/edit workflows. Visitor/Guest see only public published information. No policy decision is needed to retain this existing rule.

The permissions endpoint displays fixed grants; it is not a mechanism to grant arbitrary permissions. All `/api/admin/*` requests currently use the Administrator-only `accounts.manage` gate, while the advertised administrative grants have the same single-role membership.

## Backend enforcement coverage

Paths below are plant API paths; Vite exposes them under `/api/data/*` on the website. Authentication routes retain `/api/*`.

| API surface | Server enforcement and object checks |
|---|---|
| `GET /`, `/health` | Public service identity/readiness only; no records or credentials. |
| `GET /api/db-test`, `/api/tables` | `system.read`; Administrator only. |
| `GET /api/species`, `/api/species/:id` | `plants.public.read`; current species visibility; scientific scope additionally requires `plants.scientific.read`. |
| `GET /api/plants` | `plants.public.read`; current species visibility; approved records, own records or Officer review access; public projection omits coordinates and scientific fields. |
| `POST /api/plants` | `plants.create`; visible species, validated content/location, owner assigned from session; retry lookup also checks current visibility. |
| `GET /api/observations` | `plants.scientific.read`; own observations or Officer; current classification filter. |
| `POST /api/plants/:id/observations` | `observations.create`; approved visible parent; owner assigned from session; retry parent binding. |
| `PATCH /api/observations/:id` | `observations.edit.own`; exact owner, editable state, expected revision, current species visibility. |
| `POST /api/observations/:id/submit` | `observations.create`; exact owner and current species visibility before an idempotent return. |
| `POST /api/observations/:id/review` | `observations.review`; pending/flagged transitions, expected revision, comments when required; no self-review, including after a role change. |
| `GET /api/qr/:token` | `plants.public.read`; approved plant and current species visibility. A QR token is a lookup identifier, not an authorization credential. |
| `GET /api/plants/:id/qr` | `plants.create`; exact registered owner **and current species visibility**. Original response fields retained. |
| `POST/PATCH/DELETE /api/species[/:id]` | `species.manage`; Officer only; validated fields and referential integrity. |
| `GET /api/assets`, `/api/assets/:id` | `plants.public.read`; classification checked through species/parent plant; private field images restricted to uploader/Officer; publication requires approved asset and plant; PDF additionally requires scientific read. |
| `POST /api/assets` | Official species files require `species.manage`; field photos require `plants.create`, visible parent and own editable observation. Retry keys stay bound to the same parent **and observation**, with visibility checked on every retry. |
| `GET /api/reports` | `reports.read`; Officer only; aggregate approved plant counts. Frontend report exports cannot create additional backend grants. |
| `GET /api/audit` | `audit.read`; Administrator only; business audit metadata. |
| `GET /api/devices`, `/api/readings`, `/api/alerts` | Respective explicit read grants, Administrator/Officer. |
| `POST/PATCH /api/devices[/:id]`, `PATCH /api/devices/:id/thresholds` | `devices.manage` / `thresholds.manage`; Administrator only. Provisioning key shown once, only its hash stored. |
| `POST /api/alerts/:id/responses` | `responses.manage`; Officer only; authenticated author recorded. |
| `POST /api/device/readings` | Separate `Device <64-hex-key>` authentication against active device/key hash; not a user-session bypass. Finite named metrics, range/unit checks, server receipt time, retry receipt comparison and per-device rate limit. |

`browserBoundary` validates configured origins, mutation requests and preflights. Credential parsing rejects malformed, duplicate or conflicting bearer/cookie tokens. Invalid supplied credentials return 401 rather than silently becoming Guest. `identity` loads authoritative account/session state; `requirePermission` checks shared grants and records denials. JSON mutation bodies must be objects; malformed JSON is redacted in error responses. SQL is parameterized and SQLite writes are transactional.

Tests exercise denied roles before storage access, actual SQLite workflows, visibility/ownership/review, media, IoT and the defects below. Endpoint coverage combines source inspection and integration tests; it is not exhaustive fuzzing of every possible request interleaving.

## Authentication, account activation and sessions

- Passwords use server-side salted hashing; session secrets are random and stored hashed. Expiry/account state are checked on session use. Website cookies are HttpOnly/SameSite=Strict and Secure in production.
- Login reloads authoritative state after async password verification. A role, status, password or permanent-password restriction cannot be supplied by the client to obtain broader access.
- Role/email changes revoke staff sessions; blocked status revokes staff/Visitor sessions. Password changes/recovery revoke sessions. Tests cover revocation and administrative security settings.
- Admin endpoints are gated before `adminRequest`. Self-disable/self-role changes are prevented. Delete means disable/cancel while retaining account references. Staff invitation accepts only Botanist/Conservation Officer.
- Activation requires Pending Activation, no existing password, matching valid passwords and an unused, unexpired hashed 24-hour token. Resend invalidates previous links; delivery failure does not mark an account Active. Links use the exact website origin and token fragment. Tests inject delivery and verify single use/expiry/resend/failure.
- Recovery uses a server-controlled key, bounded code attempts/expiry and single use. Blocked accounts cannot recover access through reset. No reset key belongs in public mobile environment values.
- `/internal/face/*` uses the private loopback adapter, HMAC timestamp/nonce validation and replay protection. Mobile account issuance is restricted to active permanent Botanist/Visitor identities; registration does not create staff roles. Do not publicly route this internal surface.
- **CONFIGURATION REQUIRED:** no usable `EMAILJS_ACTIVATION_TEMPLATE_ID` was found in the actual server configuration or another local environment file. The OTP template is not an activation template. No real email was sent. Follow [the template specification](emailjs-activation-template.md).

## Website and mobile authorization

Website admin routes require a fresh authoritative Administrator; `/conservation/*` requires Officer; mandatory password change is handled before dashboard navigation. These are usability controls in addition to server checks. Navigation, invitation, map and dashboard services use the same session-backed APIs. Maps use authorized plant responses; reports are Officer-only. Browser tests use real isolated APIs and synthetic accounts, covering role redirects, reload/logout, empty catalogue and review-to-publication/media.

Botanist and Visitor website login currently displays mobile-only guidance and does not leave a hidden website session. Their collection/knowledge experience is mobile. No new website dashboard was invented or role privileges expanded.

Mobile establishes/restores identity through `/me`; saved sessions are bound to the selected face backend. Business requests carry the authoritative bearer token, and responses are rejected if the local session changes during the request. Owner-bound synchronization rechecks the authenticated account; server-side ownership/state/classification remain authoritative. Sync retry keys, revisions and conditional local removal preserve newer drafts and prevent duplicate submissions.

Encrypted drafts use account-specific AES storage with a key in native SecureStore. Draft reads now reauthorize after asynchronous storage/decryption. Writes remain serialized and preserve previous data on low storage/failure. Offline access is Botanist-only, device-unlocked, bound to the original verification time and limited to **15 minutes**; it cannot authorize server requests. Expiry, clock rollback and session generation are rechecked after device unlock. Unlock reuse is bound to the session token and expiry. Logout clears local session/lease.

Development/production URL selection, health identity/JSON checks, timeout and redirect/HTML errors are tested. Production fails closed without approved HTTPS production origins. Current private Codespaces URLs return `API_ACCESS_REDIRECT` for both services; this is an operational access failure, not an authorization fix that code may bypass. See [secure phone connectivity choices](mobile-api-configuration.md). Native fetch/image behavior and camera/GPS permission flows still require a phone.

## Protected-species privacy and residual limits

Only Officer receives `plants.protected.read`. The backend filters species, lists, plant/observation lookups, QR and images against current classification. Public projections omit structured coordinates/scientific status; uploads are decoded/re-encoded as JPEG rather than serving original image metadata. Reports are Officer-only. The new retry/QR tests explicitly reclassify an isolated species to protected and assert denial for its former Botanist owner.

Classification access also applies to private photo uploaders: ownership does not override protected status. Approved public photos become publicly visible only under the established approval rules.

Administrators can see IoT device/plant identifiers and audit target IDs under their explicit operational grants; these APIs do not join species names or plant locations. They cannot use those IDs to read protected records. Avoid putting sensitive species names/coordinates into free-form device names or audit metadata. Free-text publication and visual landmarks in images require Officer content review; field-level projection cannot prove such content contains no sensitive location clue.

Previously authorized data already cached offline cannot be remotely erased while a phone is disconnected. The existing bounded lease limits local access; server revocation/classification is enforced on reconnection. Legacy plaintext draft arrays are still accepted for recovery and become encrypted on a successful subsequent save. No device draft was inspected, deleted or migrated automatically. Verify and migrate any legacy device storage under an explicit device data plan before production.

## Security defects repaired in this audit

| Finding/root cause | Repair | Regression evidence |
|---|---|---|
| Private photo access used the parent plant registrant | Check asset uploader instead; keep Officer review access | Uploader 200, unrelated parent owner 404, Officer 200, Guest 404 |
| Owner QR omitted species classification | Check visible species, retain original JSON fields | Former owner denied after protected reclassification |
| Submit retry returned before species authorization | Recheck classification before idempotent return | Submitted observation retry denied after reclassification |
| Upload retry omitted observation binding/current classification | Compare observation/parents and check current plant visibility before retry return | Exact retry retains ID; cross-observation reuse 409; protected retry 404 |
| Unexpected upload body raised TypeError/503 | Validate JSON content type/object; redact parse errors | Missing/array body 400; text body 415 |
| Unlock prompt could outlast offline lease | Recheck time/session after unlock, token-bind unlock cache | Delayed unlock expiry and logout cannot restore private profile |
| Draft decryption could finish after account change | Reauthorize before returning rows | Delayed decrypt after owner switch fails closed without writing |
| Port collision caused null `server.address()` stack | Await successful listening, close startup resources on failure | Isolated occupied-port process exits 1 with safe startup message |

No changes were made to `shared/rbac.cjs`, live account roles/passwords, protected-species grants, biometric templates or live plant/IoT records.

## IoT, dependencies and deployment risks

Simulated ingestion/alerts/Officer responses and unauthorized API rejection pass in isolated databases. Timestamps are server receipt times; payload timestamps are not treated as trusted device event times. Temperature is Celsius, humidity percent, movement binary; soil moisture/rainfall/sound remain raw sensor readings until physically calibrated. Alerts are persisted/displayed; external notifications are not configured. Physical serial/network reconnect, calibration, power-cycle and end-to-end sensor tests remain required.

Current audits: website 0, plant backend 0; mobile **8 affected packages: 5 high, 3 moderate**, arising from three advisory roots. `decode-uri-component`/`query-string`/`expo-router` affect deep-link parsing runtime; `node-forge`/`@expo/code-signing-certificates`/`@expo/cli`/`expo` and `zod` concern CLI/signing/validation paths in the inspected dependency graph. Package audit severity is not proof of exploitability in every application path. Compatible non-forced audit repair did not remove them; forced SDK changes were not applied. See the per-package table in [final verification](final-system-verification.md#22-master-rbac-security-audit--current-results) and [machine-readable audit](final-dependency-audit.json).

Before production: choose approved HTTPS hosting with persistent SQLite/private face adapter, explicit origin/CORS/cookie and reverse-proxy design, secure external backups, secret handling, monitored rate limits/log retention, dependency remediation and real-device/consented face tests. Current per-socket IP limiting must be reviewed behind a proxy; do not blindly trust forwarded IP headers. Automated review is not a substitute for deployment configuration or native-device evidence. No deployment or public exposure was performed.
