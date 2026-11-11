# Backend personal-data encryption integration

31 October 2026, Asia/Kuala_Lumpur. This report supersedes earlier reports' statement that backend name encryption is unconnected. No live deployment or database modification was performed.

## Field results

The configured account schema is `plant_auth`, separate from Supabase's built-in `auth` schema. Live read-only column inspection returned **EACCES**. Thus YES/NO below describes the verified repository account schema and implemented backend, not an independently inspected live Supabase schema or existing production-row contents.

| Field | Exists | Exact table.column | Backend AES connected | Actual write encryption | Actual read decryption | Remaining blocker |
| --- | --- | --- | --- | --- | --- | --- |
| Personal name | YES | `plant_auth.users.name`, `plant_auth.visitors.name` | YES, through runtime `connectAuth` and the account PostgreSQL adapter | PASS: real staff creation, Visitor creation, staff invitation and account-edit writes; SQL-bound parameters and raw PostgreSQL storage checked | PASS: login, sessions, account list, mobile Visitor response, lookup and recovery delivery | Backend keyring must be configured before new name writes or encrypted-name reads. Live deployment not performed. |
| Email | YES | `plant_auth.users.email`, `plant_auth.visitors.email`, `plant_auth.account_emails.email` | NO | NOT TESTED for encryption | NOT TESTED for decryption | BLOCKED — APPROVAL REQUIRED for coordinated blind-index, uniqueness-registry and trigger/schema work. Email lookup remains unchanged and explicitly plaintext at application level. |
| Phone number | NO in the account schema | None found | NO | NOT TESTED | NOT TESTED | No current field/path to integrate. No column or data feature was invented. Live schema remains unverified. |

Overall: **name integration IMPLEMENTED AND VERIFIED in isolated PostgreSQL and real HTTP handlers; email integration BLOCKED; live activation NOT PERFORMED pending backend key configuration.** This is partial personal-data coverage, not full email/name/phone encryption or proof of production rollout.

## Actual production integration

`connectAuth(env)` in `web/server/postgres.mjs` now installs account-name storage processing on the existing account database adapter. It lazily obtains the existing AES-256-GCM keyring from backend configuration. No new encryption algorithm, endpoint, schema, table, column or authorization mechanism was introduced.

The processing supports the single-row parameterized `users`/`visitors` INSERT and name-UPDATE statement forms actually used by the existing backend. It encrypts the name parameter **before** the PostgreSQL driver's query call, preserving every other parameter. Unsupported account-name write forms fail closed. SQL structure is backend-authored; user values remain bound parameters. This is intentionally not a general SQL parser: any future name-write query shape must be reviewed and tested before use. Raw SQL import/migration tooling was not modified or run.

On account SELECT/RETURNING results, the adapter decrypts recognized stored names before existing backend functions use them. Account rows containing encrypted names need the existing `id` and `role` fields for record/table context validation; all reviewed runtime readers return full account rows. Partial projections of an encrypted name without that context fail rather than leak an envelope. Authorization remains at the existing HTTP/service boundaries: anonymous requests do not gain database access through this change.

Stored representation:

```text
niah:account-name:v2:<JSON version-2 AES-256-GCM envelope>
```

The envelope uses the existing `data-encryption.mjs` implementation and includes its key ID, random nonce, authentication tag and ciphertext. Authenticated context binds the value to `account:<users-or-visitors>:<account-id>:name`. Substituting a name between records/tables or altering protected metadata/ciphertext fails authentication.

No name plaintext is supplied to a supported INSERT/UPDATE when encryption is required. Missing/invalid keys stop that write and roll back its transaction; there is no plaintext-write fallback. Corrupt recognized ciphertext and unavailable decryption keys fail with a fixed message, with no decrypted value, key or raw cipher error returned. Existing HTTP error sanitization remains unchanged.

The existing generic `postgresDatabase` factory can still be used without this protection by isolated tools/adapters; production `connectAuth` always installs it. Existing application writes use that configured account connection. Do not bypass it with raw pool writes for application account creation/editing.

## Exact personal-data paths inspected

### Names

- `auth.mjs`: `createUser` inserts `users.name`; `createVisitor` inserts `visitors.name`. Email/ID lookups, password login, locked account rechecks and session queries read account rows. `publicUser` computes the same plaintext name/initials after adapter decryption.
- `activation.mjs`: the invitation path inserts `users.name`; resends read the current name for delivery. Its password and expiry behavior is unchanged.
- `operations.mjs`: administrative PATCH updates names for either account table. Account list SELECTs are decrypted before existing plaintext name sorting and API responses.
- `recovery.mjs`: lookup/locked SELECTs receive decrypted names for delivery. Password reset authorization, hashing, code verification and session revocation are unchanged.
- `create-admin.mjs`: existing bootstrap uses `createUser` and therefore gets the same encrypted persistence without changes to bootstrap behavior.
- `review-identity.mjs`: the existing account SELECT receives a plaintext name through the same adapter; no domain endpoint or consumer was edited.
- No runtime SQL equality, substring search, join or index on personal `name` was found in the inspected account paths. Existing account lists continue to return plaintext names for display and client filtering. No complete browser/device interaction claim is made.

### Email

- `auth.mjs`: `byEmail` uses exact `WHERE email=?` for both tables; create/update paths normalize email consistently with the existing behavior.
- `activation.mjs`, `recovery.mjs`, `create-admin.mjs`: email supports duplicate checks, identity lookup and delivery.
- `operations.mjs`: account edits update email, and archival releases the original unique identifier.
- Account schema: `users.email` and `visitors.email` have unique constraints. The `account_emails` registry and `maintain_account_email` trigger enforce uniqueness across both account tables.
- These queries and trigger definitions are unchanged. Backend source currently binds ordinary normalized emails; existing live stored email values were not read and cannot be independently classified from a live sample.

### Phone

No phone/telephone/mobile-number account column or account CRUD/lookup path was found in the active repository account schema/code inspected. This does not assert absence in every unrelated database schema or uninspected live project.

## Compatibility and key requirements

The existing columns are `TEXT`, so encrypted names fit without schema changes. No existing records are rewritten on startup, SELECT, login or status/password changes. Legacy unmarked plaintext names remain readable; a subsequent explicit name edit encrypts the newly supplied name. Reads of legacy plaintext are a compatibility path, not an encryption-failure fallback. No migration is required to keep existing accounts usable.

Legacy plaintext rows remain plaintext until an approved explicit edit or future separately approved migration. Therefore, this implementation does not claim that all historical personal names are encrypted. Recognized encrypted markers, including unsupported marker versions, never fall back to plaintext. Because legacy rows have no encryption-state column, arbitrary deletion of the entire marker/value cannot be distinguished from replacement by a legacy plaintext value; preventing that downgrade requires a separately approved persistent encryption-state strategy. GCM integrity is enforced for recognized ciphertext.

The reserved `niah:account-name:` namespace must not be used by an old plaintext name. A pre-existing marker-prefixed value that is not a valid encrypted name fails safely and is not deleted or rewritten. No production scan for such legacy collisions was possible.

Backend configuration already supported by the reused utility:

- `DATA_ENCRYPTION_KEYS`: secret JSON keyring, mapping key IDs to canonical base64 encodings of 32 cryptographically random bytes.
- `DATA_ENCRYPTION_ACTIVE_KEY_ID`: key ID used for new encrypted names.
- `DATA_ENCRYPTION_LEGACY_KEY_ID`: not needed for account-name v2 storage; do not add it merely for this integration.

The inspected backend configuration currently has no keyring/active ID. No keys were generated, printed, saved or placed in client configuration. An operator must provision them through a backend deployment secret manager or protected server-only settings. Never use `VITE_`/`EXPO_PUBLIC_` variables. Every process reading/writing this account database needs the same retained keyring and updated adapter before encrypted writes begin. The keyring is cached per connection adapter; restart processes for a deliberate key rotation.

Deployment must include the already-existing `web/server/data-encryption.mjs` and `security/dummy-encryption.mjs` dependencies as well as the newly integrated files. The former is still an untracked artifact from the previous approved task; it was reused rather than recreated here. No commit or packaging action was performed.

Without keys, legacy plaintext login/read paths still work, but account creation/name edits fail safely. Reads of encrypted names also require the correct keys. Thus configuration is a required rollout step, not an optional enhancement; this task did not deploy the change or restart live services. Removing a key or rolling back to a reader that cannot decrypt stored names can make them unreadable. Keep old keys under their original IDs; no automatic rotation, key deletion or data migration runs.

## Smallest safe email implementation plan — approval required

Random GCM nonces make equal email addresses produce different ciphertext. Existing `WHERE email=?` queries cannot find them, randomized ciphertext cannot enforce email uniqueness, and leaving `account_emails.email` as plaintext would leave a second unencrypted email copy.

The minimum coordinated plan is:

1. Approve a separate backend HMAC lookup key and the exact existing normalization (`trim().toLowerCase()`). Do not use an unkeyed email hash or reuse the GCM key as the lookup key.
2. Add indexed `email_lookup_hash` values to `users` and `visitors`, with uniqueness enforced across both tables through a reviewed registry design. Adjust the account-email trigger/registry so it uses supplied blind indexes rather than copying plaintext email or randomized ciphertext.
3. Encrypt email into the existing email columns, lookup using the blind indexes, and decrypt for authorized API responses and delivery. Preserve duplicate checking, updates, archival/reuse, invitations, login and reset behavior together.
4. Approve controlled backfill of existing emails and registry entries, verify duplicate/normalization handling, and establish a backup/rollback and lookup-key rotation plan. Remove plaintext registry copies only through that reviewed migration.
5. Verify all account services and delivery flows against a staging copy before any production rollout. Protect the HMAC key and encryption keys separately.

No schema SQL was generated or applied, no new lookup column added, no registry/trigger/grant/RLS change made, and no existing email silently reclassified as encrypted. This portion stops at the plan because the required live database changes and migrations are expressly unapproved.

## Verification actually run

Final combined account/encryption/backend regression command:

**Final result: 47 tests passed, 0 failed; process exit code 0.**

```powershell
node --test --test-isolation=none web/server/account-name-storage.test.mjs security/backend-data-encryption.test.mjs security/encryption-utility.test.mjs web/server/api.test.mjs web/server/auth.test.mjs web/server/activation.test.mjs web/server/recovery.test.mjs web/server/operations.test.mjs web/server/auth-lifecycle.test.mjs
```

The five new integration tests use the actual PostgreSQL account adapter, existing authentication/invitation/recovery/admin code, and real HTTP handlers with synthetic accounts in isolated PGlite. They verify:

- Ciphertext in actual staff/Visitor INSERT parameters and raw stored rows.
- Encrypted staff/Visitor name UPDATE values and unchanged email/role/password handling.
- Plaintext-equivalent website login, mobile Visitor registration/login, authorized admin list/edit responses and recovery delivery.
- Anonymous denial, existing role checks, forced password changes and session invalidation through existing regressions.
- Legacy plaintext compatibility, including actual login without configured encryption keys, and encryption on explicit name edit.
- Wrong-key SELECT failure, ciphertext tampering, record/table context substitution, unsupported formats/SQL shapes and missing-key writes that insert no record and preserve old data.

Existing seven primitive and nine keyring/envelope tests additionally cover nonce freshness, tag verification, rotation, malformed inputs, versioning and key validation. Full browser/native-device behavior and real face recognition are not tested.

Website build (`npm.cmd --prefix web run build`), mobile lint (`npm.cmd --prefix mobileapp run lint -- --no-cache`), mobile type checking (`npm.cmd --prefix mobileapp run type-check`), JavaScript syntax checks and targeted ESLint passed. The website retains its existing bundle-size warning. Detailed final test counts/exit codes are in `security/evidence/account-name-integration-tests.txt`.

The initial regression found a pending-account fixture using a literal ID; that fixture was parameterized rather than weakening write protection. A new raw legacy-seeding test initially omitted the account search path needed by existing triggers; its isolated setup was corrected. Neither fix changes application behavior or live records.

## Exact files changed by this integration task

Production:

- `web/server/postgres.mjs`: install name storage processing in production `connectAuth`, encrypt bound names before queries, decrypt account results; keep TLS and transaction behavior.
- `web/server/account-name-storage.mjs`: new persistence adapter, reusing existing AES-GCM/keyring utilities.

Tests:

- `web/server/account-name-storage.test.mjs`: new actual database/HTTP integration tests.
- `web/server/test-postgres.mjs`: supply an ephemeral in-memory test keyring so existing backend tests also exercise encrypted-name persistence.
- `web/server/activation.test.mjs`: bind the legacy fixture ID as a SQL parameter; assertions unchanged.

Documentation/evidence:

- This report.
- `security/evidence/account-name-integration-tests.txt`
- `security/evidence/account-name-integration-web-build.txt`
- `security/evidence/account-name-integration-mobile-lint.txt`
- `security/evidence/account-name-integration-mobile-types.txt`
- `security/evidence/account-name-integration-static.txt`
- `security/evidence/account-name-integration-live.txt`
- `security/evidence/account-name-integration-scope.txt`

## Preserved boundaries

No plant records/tables/APIs, observations, notes, reviews, attachments, GPS/maps/geolocation, IoT/sensors or face-recognition code/data were modified. No account schema, password hashing, role rule, authentication criterion, live record, RLS policy or grant was changed. Existing website/mobile API code was not changed. No dependencies were installed and nothing was committed or pushed.

Only backend name integration is complete in code and isolated tests. Backend key provisioning and coordinated rollout remain operator actions. Email blind-index/schema/registry/backfill work requires explicit approval; phone integration is inapplicable to the verified current schema. Live Supabase remains NOT VERIFIED.
