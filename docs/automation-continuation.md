> Historical instructions: project Python files and launchers were removed at the user's request. Python commands below are no longer runnable. The active website uses Vue, Node.js and PostgreSQL.

# Automation continuation — 24 October 2026

> Current staff-email policy supersedes earlier activation-link guidance: preserve the existing temporary-password template and require first-login change. No new template is needed. See [staff email guide](emailjs-activation-template.md).

## What changed in this run

Two additional local capabilities were completed without changing accounts, roles, databases, enrolled faces, images or backups:

1. **Automatic sensor backlog recovery:** `serial_bridge.py --drain` retries transient failures/HTTP 429 with bounded exponential backoff, retaining the exact payload/idempotency key. It stops on credential, validation or redirect rejection; queued data is not discarded. Default is 30 passes, configurable with `--attempts 1..1000`. This removes the earlier need to repeatedly invoke `--flush-only` after ordinary network/rate-limit interruptions. Three tests cover actual HTTPError 429 recovery, permanent rejection and bounded network failure.
2. **Configured-storage release checks:** the release gate previously always checked default DB filenames and only their file permissions. It now resolves backend/server environment files and process overrides, checks parent-directory permissions, rejects in-memory storage and ambiguous relative `AUTH_DB`, and detects reused account/plant storage including hard links. Metadata-only tests use synthetic files; no real DB is opened or changed by this checker.

Prepared gateway, activation template, camera/GPS/offline implementations and consented testing instructions were reused rather than rewritten. Existing safe Caddy binary was reused for the synthetic loopback test; no VPN daemon, exposure or deployment was started.

## Actual access discovered

- All relevant process environment names were checked without printing values. Local environment files, deployment examples and `.github`/`.devcontainer` configuration were checked for activation/VPN/portrait assignments, excluding private DBs, backups and dependencies. Activation ID occurs only as an empty setting/example. Effective service/public key fallback is already working.
- An existing GitHub token is present, but the repository secret-name API denies access with its current permissions. A normal metadata query was attempted; no token, secret value or provider credential was printed. Secret values cannot be assumed available merely because the Codespace has a GitHub token. No workflow was created to extract secrets.
- No Tailscale binary, socket, state directory or VPN interface, approved VPN credentials or private HTTPS hostname configuration was detected. Actual plant/face URLs remain private Codespaces origins and return `API_ACCESS_REDIRECT` without credentials.
- No ADB/fastboot tool, configured Android environment, ADB socket, USB vendor descriptor, serial `/dev/ttyUSB*`/`ttyACM*` or `/dev/serial/by-id/*` device was found. Docker is installed but its running-container metadata is inaccessible; no remote Android endpoint is configured. These observations establish no accessible device, not that the user's own computer has none.
- No `FACE_TEST_*` assignments or consent manifest was found. No portrait or enrollment was opened. A face fixture's mere presence would not establish consent; no genuine biometric fixture was used.
- Existing firmware specifies DHT11, MPU6050, ESP32-style pins and 115200 serial. Exact ESP32 board variant, analog probe module names/voltage/calibration and actual USB host/port remain unavailable.

## Task handoff table

| Task | Automatically completed work | Tests passed | Remaining blocker | Exact action required from user | Can Codex continue automatically afterward? |
|---|---|---|---|---|---|
| EmailJS activation | Searched available environment/project settings and attempted secret-name access; reused correct public service/key fallback and exact HTML template; ran non-sending diagnostic | 25 auth/activation/configuration/recovery tests | Only activation template ID missing locally; GitHub secret metadata permission denied; no EmailJS account session | Create/save the dedicated template using `web/scripts/emailjs-activation-template.html`, then provide **its template ID**. If it already exists, provide just that ID. No password/private key is requested | Yes: configure ID and validate automatically. Real inbox delivery still needs separate approval |
| Private mobile HTTPS/VPN | Reused complete loopback gateway/environment example; reran synthetic routing/header/internal-path tests; probed existing URLs without app credentials | Gateway harness and connectivity cases within 52 mobile tests | No approved tailnet/node membership/hostname; current URLs redirect to GitHub | Approve the prepared private VPN setup and authenticate the node and phone to the same restricted tailnet. Do not send auth keys in chat | Yes for node/gateway/API settings and automated probes after approved access exists; actual phone request remains device evidence |
| Physical phone | Inspected device/tool/socket/USB/container access; retained exact install/start/tap checklist; reran capture/GPS/session/offline/sync mocks and Android export | 52 mobile tests; lint/types/compatibility/export | No device or authorized remote/USB bridge accessible inside Codespaces | Connect an authorized test phone through the desktop bridge or approved device runner, and approve/install the native test build. Then perform OS permission/physical actions when prompted | Partly: accessible ADB/device checks can be automated; camera/GPS/OS-unlock physical acceptance still requires the phone/user |
| Face recognition/liveness | Checked authorization configuration, ran real-model generated-negative and isolated account/session/image tests; retained anti-spoofing/thresholds | 45 Python tests; 6 genuine-face cases skipped | No consented/approved fixtures or real-person test authorization | Supply private first/second/observed-negative fixture paths **with explicit permission for those tests**, following checklist section 4; never repurpose enrollments | Yes for fixture-backed tests after authorization; genuine live capture/replay acceptance requires participants/device |
| IoT | Inspected actual firmware/device availability; added automatic bounded queue draining, tested stable retry keys/permanent-error retention; reran API simulation | 9 serial/outbox tests plus IoT cases in 15 backend tests | No accessible sensor/serial host; board/probe details incomplete | Connect the sensor to an authorized USB host and provide board/probe model, voltage/calibration and host/serial access. Known pin/baud instructions already exist | Yes for reachable serial/API diagnostics and retry/storage checks; physical wiring/calibration needs hardware/operator |
| Dependencies/production | Refreshed all eight installed paths/versions, attempted compatible non-forced audit repair; repaired configured-storage gate; reran regression/build/integrity checks | 155 distinct tests overall; gate's 3 isolated tests; web/backend audits 0 | Mobile audit still 8 affected packages: 5 high/3 moderate; upstream/module/API compatibility; production origins/access/manual evidence absent | No action needed for continued safe patch checks. A breaking SDK migration or deployment needs a separately reviewed plan/approval; do not force upgrade. Production origin/hosting/network choices are needed before release | Yes for compatible upstream fixes when available; breaking migration/deployment remain approval boundaries |

Exact provider recipient/subject/body, private VPN setup commands, native APK/desktop bridge commands, physical taps, six fixture prerequisites and hardware wiring/serial commands remain in [final-manual-testing-checklist.md](final-manual-testing-checklist.md). No additional PostgreSQL, Supabase, pgAdmin or account-reset work is required.

## Fresh verification

| Suite | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Backend/RBAC/SQLite/workflow/IoT/backup | 15 | 0 | 0 |
| Web authentication/activation/recovery/configuration | 25 | 0 | 0 |
| Chromium browser | 6 | 0 | 0 |
| Mobile capture/session/connectivity/offline/sync | 52 | 0 | 0 |
| Python face/model/image/account tests | 45 | 0 | 6 |
| Serial parser/outbox/drain | 9 | 0 | 0 |
| Configured storage release gate | 3 | 0 | 0 |
| **Total** | **155** | **0** | **6** |

Website build/type check, mobile lint/type check/Expo compatibility and Android export pass. Android output: `/tmp/niah-auto-android` (bundle, not APK). Separate Caddy harness passes four synthetic routes, header preservation and six blocked paths; not counted as six more tests. Logs: `/tmp/niah-auto-*`.

SQLite plant integrity/FK checks pass with zero species/plants; authentication integrity/FK checks pass with 3 staff/2 Visitors. Isolated backup/restore regression passes; existing recovery sets were retained. No new live backup was necessary for these code-only changes. Native/biometric/real sensor/email/phone-network tests were not performed.

Operational diagnostics intentionally return nonzero: activation ID missing; private API redirects; production gate missing release configuration/high advisory resolution. Those results are not reported as successful external integration or failed unit tests. Release gate checks now pass for the actual configured local private/separate/persistent storage.

Reproducible new commands from workspace root:

```bash
node --test --test-isolation=none deploy/storage-readiness.test.mjs
python3 -m unittest discover -s IoT/PlantPrototype -p 'test_*.py'
node deploy/check-readiness.mjs
# Only on the authorized real sensor host after credentials/origin are configured:
python3 IoT/PlantPrototype/serial_bridge.py --drain --attempts 30
```

The full suite commands are unchanged from [final-system-verification.md section 23](final-system-verification.md#23-priority-resolution-of-six-external-and-software-blockers). Their current outputs are above; no completed implementation was rewritten simply to increase the test count.

## Exact dependency result

Current installed versions and vulnerable locations are captured in [dependency-advisory-details.json](dependency-advisory-details.json). Eight affected packages derive from three advisory roots:

| Package/version | Severity | Dependency path | Resolution/mitigation |
|---|---|---|---|
| `decode-uri-component` 0.2.2 | Moderate | Expo Router → query-string → decoder | Patched 0.5.x is outside current CJS contract; no safe compatible automatic repair. Restrict/bound untrusted deep links while waiting for supported parent fix |
| `query-string` 7.1.3 | Moderate | Expo Router → query-string | Inherits decoder issue; needs compatible Router chain update |
| `expo-router` 57.0.29 | Moderate | Direct dependency | Audit proposes Router 58.0.26; not forced into SDK 57 |
| `node-forge` 1.4.0 | High | Expo → CLI → forge; CLI → signing-certificates → forge | No published patched version in inspected advisory/registry; keep build/signing inputs trusted and tooling private |
| `@expo/code-signing-certificates` 0.0.6 | High | Expo → CLI → signing-certificates | Inherits forge issue; supported upstream remediation required |
| `@expo/cli` 57.0.32 | High | Expo → CLI → forge/Zod | Current SDK chain still affected; do not expose CLI/Metro; use trusted bounded config |
| `expo` 57.0.31 | High | Direct parent of CLI | Inherits tooling findings; audit's Expo 54 replacement is a breaking downgrade, not a repair applied here |
| `zod` 3.25.76 (nested CLI copy) | High | Expo → CLI → nested Zod | Fix is 4.6.6+; root 4.6.7 is already patched, nested CLI 3.x requires upstream API adaptation; no blind override |

CVEs, advisory links, available versions and compatibility reasoning are retained in [remaining-blockers-resolution.md](remaining-blockers-resolution.md#individual-dependency-investigation). [Final dependency audit](final-dependency-audit.json) is refreshed. Mitigations do not remove vulnerabilities or establish production readiness. All compatible update attempts in this run left the same eight; no force flag, essential-package removal or major change was used.

## Changed files

- `IoT/PlantPrototype/serial_bridge.py`, `test_serial_bridge.py`: bounded automatic drain and three regression cases.
- `deploy/storage-readiness.mjs`, `storage-readiness.test.mjs` (new), `check-readiness.mjs`: actual configured storage checks and three regression cases.
- `docs/automation-continuation.md`, `dependency-advisory-details.json` (new): this handoff/current paths.
- `docs/final-system-verification.md`, `remaining-blockers-resolution.md`, `final-manual-testing-checklist.md`, `final-dependency-audit.json`: current evidence and simplified drain instructions.

**Production is not ready.** External credentials, consent, device access and the dependency findings cannot be truthfully replaced by simulated passes. No email, public exposure, deployment, real enrollment or production record mutation occurred.
