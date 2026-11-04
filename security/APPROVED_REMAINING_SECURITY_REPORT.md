# Approved remaining security work

31 October 2026, Asia/Kuala_Lumpur. Approval source: the user's pasted instructions authorizing narrow account-test corrections, standalone encryption verification and account-only Supabase inspection. No production application code was changed.

## Results

| Feature | Status | Work completed | Remaining limits |
| --- | --- | --- | --- |
| API protection | ALREADY IMPLEMENTED; account test corrections COMPLETED | Corrected three demonstrably outdated account-test expectations; verified audit API access for Administrator, denied Conservation Officer and anonymous callers | No authentication, role, password, session or endpoint behavior changed. Live deployment not tested. |
| Data encryption | PARTIALLY IMPLEMENTED | Reviewed existing AES-256-GCM prototype; added seven focused standalone tests; existing offline draft regression tests pass | No additional confirmed cryptographic defect found. Prototype remains disconnected from persistence; backend data encryption is not implemented by this work. |
| Supabase security | PARTIALLY IMPLEMENTED locally; live NOT VERIFIED | Verified account-schema revocations and TLS configuration in isolated tests; scanned available client source/build artifacts; prepared read-only account metadata SQL | Live connection still fails with EACCES. Existing live roles, policies, grants, exposed schemas, RPCs and audit-table privileges remain unknown. |

## Exact changes made

Modified:

- `web/server/api.test.mjs`: a role-changed Botanist is rejected by website login and can sign in through mobile; browser use of that token is rejected. The temporary-password test now verifies the mobile-only Botanist lifecycle, expiry, mandatory password change, invalidation of old credentials and independent native sessions. The account-recovery test expects Botanist browser rejection (401), while retaining Conservation Officer denial (403) and Administrator success (202). Added anonymous/Officer denial and Administrator success assertions for `/api/admin/audit`.

Added:

- `security/encryption-utility.test.mjs`: synthetic non-plant JSON round trip; serialized envelopes; nonce/ciphertext variation; wrong/missing/type/length-invalid keys; missing/wrong record context; nonce/tag/ciphertext tampering; malformed envelopes/base64; truncated/wrong-length tags/nonces; truncated ciphertext; unsupported serialization.
- `security/account-security.test.mjs`: existing account migration blocks anon/authenticated schema use and PUBLIC table grants in an isolated PGlite database; checks existing account trigger functions are invoker-security; validates the manual SQL against isolated metadata; verifies remote account configuration enforces certificate validation even when a supplied URL says sslmode=disable.
- `security/account-security-readonly.sql`: transaction-scoped, read-only account metadata queries covering inspection-role privileges, account schema access, account table ownership/RLS, policies, effective API-role privileges, direct table grants and the two known account trigger functions. No application records, credentials, password hashes or session values are queried.
- This report and five evidence files: `approved-remaining-tests.txt`, `approved-remaining-web-build.txt`, `approved-remaining-client-scan.txt`, `approved-remaining-live.txt`, `approved-remaining-scope.txt` under `security/evidence/`.

No changes to `security/dummy-encryption.mjs` were needed: it already requires a 32-byte key, generates a random 12-byte IV, authenticates record context, produces a 16-byte tag, enforces tag length during decryption, rejects noncanonical base64 and verifies ciphertext integrity before returning parsed data. No key configuration module was added because no persistence consumer is approved; adding unused production key requirements would not improve security.

## Tests and checks actually run

Before correction, all three `web/server/api.test.mjs` tests failed at the role-policy expectations already identified. After correction, all three pass without application changes.

Final combined regression command:

```powershell
node --test --test-isolation=none security/encryption-utility.test.mjs security/account-security.test.mjs web/server/api.test.mjs web/server/auth.test.mjs web/server/client-boundary.test.mjs mobileapp/scripts/offline-recovery.test.mjs
```

Result: **31 tests passed, 0 failed; process exit 0**. These include existing session/password and mobile offline-draft engine regressions. Tests create synthetic accounts only in isolated adapters/PGlite; they never use existing live accounts or records. Some existing tests import gateway/mobile client and plant identity factories; no plant endpoints or data were modified. This is not a native-device encryption test or real face-recognition test.

Additional checks:

- `npm.cmd --prefix web run build`: passed, exit 0, including Vue type checking. Existing large-bundle warning remains.
- `node --check security/encryption-utility.test.mjs`, `node --check security/account-security.test.mjs`, `node --check web/server/api.test.mjs`: passed.
- `git diff --check`: passed (Git reports existing line-ending conversion notices).
- Client scan: 146 files across current web/mobile client source, selected client configuration and available web build; no matching configured privileged values, service-role JWTs, sb_secret patterns or credential-bearing PostgreSQL URLs found. Selected private configuration files are not tracked by Git. This is a bounded pattern/value scan, not a guarantee about every secret, Git history or deployed artifacts.
- No mobile build artifact exists for inspection. No packages were installed; no mobile source was changed, so no mobile rebuild was requested.
- Baseline file-hash comparison confirms the only previously existing file changed by this task is `web/server/api.test.mjs`. All earlier text-security and face-service work was preserved byte-for-byte. Ignored build artifacts are excluded from that source comparison.

## Supabase live limitation and manual inspection

The configured account destination identifies as Supabase. A read-only metadata retry, using existing credentials and certificate-verifying TLS, returned **EACCES**. No live metadata result is claimed. An initial shell attempt from the repository root could not resolve pg; the retry used web/'s already-installed dependency, without installing anything.

Open `security/account-security-readonly.sql` in Supabase SQL Editor and run the entire script. It defaults to the existing `plant_auth` account schema; if the actual AUTH_PG_SCHEMA differs, replace only those quoted schema literals after confirming the value privately. The script begins READ ONLY and ends ROLLBACK. It reads catalog metadata only.

Interpretation:

- Credential/session/account-audit tables should not be reachable by anon/authenticated through exposed schemas. RLS being off on a backend-only private schema is not alone proof of public exposure; examine schema grants, table grants, API exposure and connection-role ownership together.
- Account audit API access is Administrator-only, but database append-only integrity is not proven. Review whether the backend writer can UPDATE/DELETE/TRUNCATE auth_events and which identities can read it before proposing restricted writer privileges. Do not change grants blindly.
- SQL Editor's inspection role is not necessarily the backend connection role. Its superuser/BYPASSRLS result cannot certify the application's database role.
- The script examines only the two account trigger functions defined in source. It does not certify unknown live RPCs or functions outside the approved account scope. Those triggers use default invoker security; absence of a fixed search_path is not itself proof of a SECURITY DEFINER exploit.
- Verify the account schema is absent from Data API exposed schemas in project settings. Do not alter settings automatically.

## Unchanged areas and approval boundaries

No plant records, APIs, observations, descriptions, notes, reviews, attachments, registration, identification, approval, editing, search or permissions were changed. GPS, IoT, sensors, maps, geolocation, face recognition, login/password behavior, hashing, sessions and role rules remain unchanged. No database persistence encryption, record migration, RLS/grant change, schema migration, credential change or Supabase project-setting change was performed. No commits or pushes.

The fourth previously failing broader test, `plant-conservation-backend/test/business.test.cjs`, remains untouched and was not rerun here: it sends a Botanist browser Origin and expects access. Its correction is **BLOCKED — APPROVAL REQUIRED** because this approval explicitly excludes plant-related files/workflows. The three account-role tests are now corrected; this is not a claim that the full repository test suite is green.

Database encryption integration is **BLOCKED — APPROVAL REQUIRED**: no existing clearly approved non-plant sensitive field was identified. All plant fields, including notes/reviews/attachments, are expressly excluded. Key provisioning, rotation and durable recovery remain future work only when a real approved persistence consumer exists.

Any live policy/grant/schema/settings repair requires separate approval after account metadata is reviewed. Do not provide secrets in chat; only sanitized account-security metadata is needed. With current access restrictions, live Supabase verification remains NOT VERIFIED.
