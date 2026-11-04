> Historical instructions: project Python files and launchers were removed at the user's request. Python commands below are no longer runnable. The active website uses Vue, Node.js and PostgreSQL.

> **26 October 2026 update:** Server storage has moved to PostgreSQL. Read [the current migration guide](postgresql-migration.md) before following historical SQLite paths, backups or test results below. Live Supabase cutover is not verified.

# IoT and deployment progress — 25 October 2026

Status: **AUTOMATED SOFTWARE CHECKS PASSED; PHYSICAL INTEGRATION AND RELEASE NOT COMPLETE**.

## Full-completion follow-up

The user requested full completion. Reinspection still found no accessible USB
serial board, deployment workflow or configured production destination. Hardware
models remain unknown. Hosting and an independent backup destination need actual
user/account information before their configuration can be completed.

A fresh official npm registry check confirmed latest `@expo/cli` 58.1.15 still
requires `zod ^3.25.76` and `node-forge ^1.4.0`; latest `node-forge` remains 1.4.0.
Therefore an SDK 58 migration alone cannot clear all current advisory roots.
No untested migration, invented device measurement or release sign-off was applied.
Expo's [upgrade guide](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/)
requires matching dependency updates and version-specific migration checks.

To identify the USB port on the Windows host without installing software, run:

```powershell
Get-CimInstance Win32_SerialPort | Select-Object DeviceID, Description
```

An empty result does not identify the board or prove it is faulty. Confirm its
physical USB connection and provide its printed model/probe labels or photos.
This read-only discovery command does not flash the board or change its wiring.

This continuation does not change `mobileapp/App.js`, screen routing, role grants,
firmware, existing device credentials, thresholds, or dependency manifests/locks.

## Part 5 — hardware and IoT

- No `/dev/ttyUSB*` or `/dev/ttyACM*` device is available in this Codespace.
- User confirmed exact board/probe models are unknown. Firmware suggests ESP32,
  DHT11, MPU6050 and analog soil/rain/sound probes; this is not physical identification.
- Added direct `--port` (115200 baud) and credential-free `--list-ports` modes to
  the existing durable bridge, plus optional pinned `pyserial==3.5` requirements.
  Existing stdin, outbox, retry and authentication behavior remains supported.
- Added tests for timeout handling, replacement decoding, connection closure,
  disconnects and rejection of network serial URLs.
- [USB host guide](../IoT/PlantPrototype/README.md) provides Windows PowerShell
  instructions without WSL. USB mode requires pyserial on the actual USB host;
  this Codespace currently lacks that optional package, and its CLI reports the
  installation instruction. Serial behavior was tested using injected connections.
- Firmware has no Wi-Fi upload. The USB computer must reach the HTTPS backend;
  a phone VPN does not supply connectivity to that computer.
- Administrator manages devices/credentials/thresholds; Administrator and Officer
  read readings/alerts; Officer responds to alerts. Botanist/Visitor are denied.
  Existing isolated API tests exercised ingestion, idempotency, invalid values,
  authentication, alert creation and role restrictions. These are synthetic tests.

Still required: identify physical models/voltage/calibration; connect board to
an accessible USB host; provision an authorized real device; capture actual
measurements; verify real threshold crossing and Officer response; test physical
network/power recovery. The backend currently triggers above-threshold alerts,
while the sketch sound LED triggers below 2000: do not treat them as equivalent.
No hardware was flashed, connected or claimed to be measured remotely.

## Part 6 — eight packages reviewed individually

Fresh official npm audits: website **0**, plant backend **0**, mobile **8 affected
packages (5 high, 3 moderate)**. This is eight graph entries arising from three
root advisories, not eight independently discovered exploits. Registry metadata,
installed lockfile paths, consumer ranges and available fixes were inspected.
No major upgrade/downgrade or dependency override was applied. No migration was
performed or claimed tested. A separate SDK migration needs its own tests and
cannot alone resolve an upstream package with no published patch.

| Package | Installed affected version | Latest published | Assessment |
| --- | --- | --- | --- |
| `@expo/cli` | 57.0.32 | 58.1.15 | SDK 57 latest is still 57.0.32; requires Zod 3 and node-forge. Audit suggests an Expo major downgrade, not a compatible repair. |
| `@expo/code-signing-certificates` | 0.0.6 | 0.0.7 | 0.0.7 is published but still requires node-forge ^1.4.0; upgrading this parent alone does not resolve its finding. |
| `decode-uri-component` | 0.2.2 | 0.5.1 | Patched starting 0.5.0, but the installed query-string consumer requires ^0.2.2. No forced cross-major override applied. |
| `expo` | 57.0.31 | 58.0.19 | SDK 57 latest remains 57.0.31. Latest Expo is SDK 58; that is a separate migration, not an automatic audit repair. |
| `expo-router` | 57.0.29 | 58.0.26 | SDK 57 latest remains 57.0.29 and requires query-string ^7.1.3. Audit proposes Router 58, requiring separate SDK migration validation. |
| `node-forge` | 1.4.0 | 1.4.0 | Latest remains 1.4.0; advisory lists no patched version. This remains an upstream release/security-review blocker. |
| `query-string` | 7.1.3 | 10.0.0 | Installed consumer requires decode-uri-component ^0.2.2. Latest query-string is major 10; swapping it into Router 57 is outside its range. |
| `zod` | 3.25.76 | 4.6.7 | Nested CLI version 3.25.76 is affected; fix starts at 4.6.6. The CLI still declares ^3.25.76, so a blind major override is not justified. |

Sources: [decoder advisory](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr),
[forge advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv),
[Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
Machine-readable evidence: [audit](final-dependency-audit.json) and
[per-package registry review](dependency-advisory-details.json).

Keep development/build tools private and signing/configuration inputs trusted;
limit untrusted deep-link input. These mitigations do not remove the findings
or establish full application exploitability analysis.

## Checks executed in this continuation

| Check | Result |
| --- | --- |
| Serial/outbox/USB unit tests | 12 passed |
| Backend RBAC, SQLite, IoT and backup tests | 15 passed |
| Web authentication/security tests | 22 passed |
| Mobile utility/session/recovery tests | 57 passed |
| Gateway configuration/storage tests | 4 passed |
| Selected Administrator/Officer/IoT Chromium UI tests | 4 passed |
| **Total automated test cases** | **114 passed, 0 failed** |
| Actual Caddy synthetic gateway harness | Passed; bearer/device headers, POST bodies, routing, redirect denial and blocked paths |
| Web build and type check | Completed without reported errors |
| Mobile lint and TypeScript check | Passed |
| Expo SDK 57 dependency compatibility (offline check) | Reported up to date; CLI warns offline validation is unreliable |
| Existing live plant SQLite integrity/foreign keys | Passed; zero species/plants preserved |
| Plant/account backup and isolated restoration | Passed; biometric database/service key excluded |
| Production readiness gate | **Failed as expected; release is blocked** |

The initial sandbox API tests were denied loopback listen permissions (`EPERM`).
They passed after rerunning with authorized loopback access. Initial sandbox npm
network requests failed; fresh audit results above are from successful authorized
registry access. These infrastructure failures were not patched as app defects.

Private verified local backup:
`plant-conservation-backend/backups/system-1792934155459/`.
Its folder is gitignored; files include account credentials/hashes and a recovery
key and must stay private. No live database was replaced. No biometric backup
was taken. No independent off-Codespace destination has been configured or tested;
local restore success does not establish disaster recovery after Codespace loss.

Latest read-only production gate:

```json
{
  "checks": {
    "staffTemporaryPasswordEmail": true,
    "productionWebsiteOrigin": false,
    "plantProductionHttps": false,
    "faceProductionHttps": false,
    "plantStorage": true,
    "authenticationStorage": true,
    "faceStorage": true,
    "separateAccountStorage": true,
    "persistentPlantStorage": true,
    "unambiguousAuthenticationPath": true,
    "dependencyHighCritical": false
  },
  "manualEvidenceRequired": [
    "phone networking/camera/GPS/storage",
    "consented positive recognition and liveness",
    "physical sensor calibration and reconnect",
    "controlled temporary-password email receipt",
    "independent backup retention"
  ],
  "deploymentPerformed": false
}
```

Final release sign-off remains pending real phone/hardware/consented biometric
acceptance, controlled email receipt, remediation/security disposition of all
advisories, actual production origins/hosting/TLS/secrets/persistent storage,
monitoring and an independent backup recovery test. No production deployment,
public port, real test email, new account or synthetic live measurement was created.

## Reproduce

```bash
python3 -m unittest discover -s IoT/PlantPrototype -p 'test_*.py' -v
npm --prefix plant-conservation-backend test
npm --prefix web run test:auth
node --test --test-isolation=none mobileapp/scripts/*.test.mjs
node --test --test-isolation=none deploy/*.test.mjs
CADDY_TEST_BINARY="$PWD/.local-tools/bin/caddy" node deploy/test-private-phone-gateway.mjs
npm --prefix web run build
npm --prefix mobileapp run lint
npm --prefix mobileapp run type-check
npm --prefix plant-conservation-backend run check-db
node deploy/check-readiness.mjs
```

From `web`, run `./node_modules/.bin/playwright test --grep
'sensor registration|Administrator modules|Conservation Officer'` after building.
Audits require registry access; HTTP/browser suites need temporary loopback access.
The release gate exits nonzero until all its configuration/security checks pass;
even a passing gate would not establish real-world acceptance.
