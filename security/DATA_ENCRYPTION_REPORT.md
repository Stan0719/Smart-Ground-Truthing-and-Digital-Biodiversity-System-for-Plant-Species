# Data encryption implementation and verification

Date: 31 October 2026, Asia/Kuala_Lumpur.

**Overall status: PARTIALLY IMPLEMENTED.** Safe backend utility/configuration work and focused verification are complete. **Application-level database field encryption is not integrated.** No eligible account field met all of the approval's compatibility restrictions. Integration is **BLOCKED — APPROVAL REQUIRED**, not fully complete.

## 1. Existing encryption preserved

- `security/dummy-encryption.mjs` already implements AES-256-GCM using a 32-byte caller-supplied key, a cryptographically random 12-byte nonce, a 16-byte authentication tag, authenticated record context, canonical base64 fields and a version-1 envelope. The existing seven focused utility tests still pass. No defect requiring a change to this primitive was found.
- The explicitly approved inspection of `mobileapp/utils/fieldStorage.js` and `offlineDraftStore.js` found account-scoped native encrypted draft storage, SecureStore-backed device keys, device-unlocked access, authorization rechecks and verified conversion of legacy arrays before storage replacement. These files were not modified, and no stored draft contents were opened. Existing mobile data encryption remains separate from the new backend keys and formats.
- Account passwords remain salted password hashes. Session and activation tokens remain hashed, and recovery codes remain HMAC-protected. Hashing is not reversible data encryption and must not be replaced by it.
- `web/server/postgres.mjs` already enforces certificate-verified TLS for remote account database connections; it remains unchanged.

## 2. Safe work added

`web/server/data-encryption.mjs` provides a backend-only utility using the existing GCM primitive, without registering an endpoint, loading configuration at startup, opening a database or changing any persistence consumer.

It adds:

- A version-2 envelope with `version`, `algorithm`, `keyId`, `iv`, `tag` and `ciphertext`.
- Key identifiers and a keyring: new writes use the active key; reads use the envelope's key ID. Retaining old keys permits decryption after rotation.
- Authentication of the version, algorithm, key ID and caller-supplied record/field context. Changing the key ID fails even when two IDs refer to the same key bytes.
- Strict canonical-base64, 32-byte backend keys, validated IDs and configuration rejection for missing/invalid keys. No key is generated or saved automatically.
- Explicit opt-in reading of the old standalone Node version-1 envelope using a configured legacy key ID. This is not the mobile combined-ciphertext format, and does not alter that format.
- No plaintext decryption fallback. Unsupported versions, malformed ciphertext, unavailable keys and authentication failures throw errors rather than returning plaintext, empty data or replacement values.
- Fixed error messages without configuration contents, underlying exception messages, plaintext or keys. The utility performs no logging.

`security/backend-data-encryption.test.mjs` adds nine isolated tests. Synthetic fixtures reuse existing account field names (`name`, `email`); no new production sensitive field or feature was invented.

## 3. Exact files changed in this task

All are new files; no existing source file was edited:

1. `web/server/data-encryption.mjs`
2. `security/backend-data-encryption.test.mjs`
3. `security/DATA_ENCRYPTION_REPORT.md`
4. `security/evidence/encryption-completion-baseline-status.json`
5. `security/evidence/encryption-completion-tests.txt`
6. `security/evidence/encryption-completion-web-build.txt`
7. `security/evidence/encryption-completion-mobile-lint.txt`
8. `security/evidence/encryption-completion-mobile-types.txt`
9. `security/evidence/encryption-completion-static.txt`

The workspace already contained changes from earlier tasks, including text-security and face-service work. They were left in place. The baseline-status evidence lists their paths without opening protected source or records. Builds generate ignored output; no dependencies were installed, commits made or pushes performed.

## 4. Storage coverage

| Path/data | Actual protection | Status/limit |
| --- | --- | --- |
| Existing native offline drafts | Native AES encrypted payload; per-account keys in SecureStore | Existing implementation preserved; generic injected-engine regressions pass. No physical device or stored draft inspected. |
| Non-plant account name/email/username fields | Ordinary values in application SQL; remote connection configured for verified TLS | No application field encryption added. Hosted Supabase provides infrastructure encryption at rest; project-specific operation was not verified. |
| Account audit IP/reason/linked IDs | Ordinary values in SQL, restricted application access, configured database TLS | No reversible encryption added; several fields are operational query inputs. |
| Passwords, session tokens, reset codes | Existing password hashing/token hashing/HMAC | Preserved. These should not be reversibly encrypted instead. |
| New backend utility | AES-256-GCM versioned envelopes and keyring, tested entirely in memory | Not imported into application persistence; no application data is newly encrypted before Supabase storage. |
| Website/mobile account APIs | Existing plaintext JSON contract over configured transport protections | No client-side field encryption or backend encryption keys added to client code. |

Supabase documents AES-256 encryption at rest and TLS in transit for hosted customer data: [Supabase security](https://supabase.com/security). This satisfies the infrastructure-storage/transport portion of an encryption requirement, but does not establish backend field encryption or protect plaintext returned through authorized SQL access. It does not certify this project's live connection, exports, local database copies or downloaded backups. Supabase's own encryption of its platform secrets does not mean our custom account columns are application-encrypted.

AES-GCM authenticated-encryption behavior is documented in [Node.js 24 crypto](https://nodejs.org/docs/latest-v24.x/api/crypto.html). The existing native AES API is documented in [Expo 58 Crypto](https://docs.expo.dev/versions/v58.0.0/sdk/crypto/). These are documentation checks, not live project/device tests.

## 5. Why no database field was integrated automatically

Source-only review was limited to account storage and paths in `web/server/auth.mjs`, `activation.mjs`, `recovery.mjs`, `operations.mjs`, the account schema and connection adapter, plus the website account API contract. No real account rows or excluded domain records were read.

| Existing field category | Sensitivity and current use | Why automatic field encryption is unsafe under this approval |
| --- | --- | --- |
| `users.email`, `visitors.email`, `account_emails.email` | Personal identifiers; login/recovery lookups, uniqueness registry, invitations, updates and email delivery | Randomized ciphertext breaks lookups and cross-table uniqueness. Preserving behavior requires an approved lookup/index strategy and changes to authentication-adjacent readers/writers. |
| `users.name`, `visitors.name` | Personal identifiers; login/session response, initials, administrative display/sorting, recovery and invitation email | All writers/readers and legacy plaintext handling must be mapped, including shared consumers outside the allowed inspection scope. A partial change can display ciphertext or break delivery/initials. No integration was attempted. |
| `username` | Account identifier, validation/uniqueness/admin operations | Encryption changes lookup/index/validation semantics. No approved replacement contract exists. |
| `auth_events.ip`, `reason`, `user_id`, `actor_id`, timestamps | Personal/linked security metadata | IP/reason/actor values are queried by throttling, recovery, invitation limits and archival logic. Encrypting them changes preserved security behavior. Audit integrity also requires controls beyond encryption. |
| Password/session/recovery material | Existing hashes and HMACs | Preserve one-way verification and current flows; do not replace with reversible encryption. |

Names and emails are genuine personal-data candidates if the required threat model includes database dumps or privileged SQL readers. Their presence alone does not establish that additional reversible encryption is mandatory on top of platform encryption/access control. No independent confidential non-plant record category was found that could safely be integrated without changing preserved contracts. Restricted domain data was expressly excluded and was not considered as an alternative.

No schema, API contract, existing record or login/password behavior was changed. Database field encryption integration needs separate approval for the selected fields, every affected reader/writer, legacy-record strategy, lookup/uniqueness requirements and durable key recovery.

## 6. Backend key configuration (prepared, not activated)

The new module exports `createDataEncryption(...)` for explicit caller-supplied keyrings and `dataEncryptionFromEnvironment(...)` for a future approved backend consumer. Merely starting the existing application does not call either factory or require new credentials.

Server-only configuration names:

- `DATA_ENCRYPTION_KEYS`: JSON object mapping non-secret key IDs to canonical base64 secrets, each decoding to exactly 32 cryptographically random bytes.
- `DATA_ENCRYPTION_ACTIVE_KEY_ID`: existing key ID used for new encryption.
- `DATA_ENCRYPTION_LEGACY_KEY_ID`: optional explicit key for reading the old standalone Node v1 format; omit unless that compatibility is actually required.

Provision keys through a deployment secret manager or protected backend-only configuration when integration is approved. Never use `VITE_` or `EXPO_PUBLIC_` names; the environment factory rejects public-prefixed versions of these configuration names. No frontend/mobile code imports the new module; no application key was generated, configured, written to disk or placed in any build. Existing mobile offline keys remain on device as required by its existing design.

Rotation means retaining the old secret key under its old ID and setting a new active ID. Changing active ID does not rewrite stored envelopes. Removing an old key makes its ciphertext unreadable; key retention, backup, revocation and disaster-recovery procedures must be approved before real persistence use. No automatic key generation, KMS integration, key migration or rotation job is claimed. Environment-key storage alone is not a full key-management system.

## 7. Actual verification

Focused encryption run: **16 passed, 0 failed**, covering the nine new tests and seven existing primitive tests. The final combined regression run includes those tests, so counts are not additive.

```powershell
node --test --test-isolation=none security/backend-data-encryption.test.mjs security/encryption-utility.test.mjs web/server/api.test.mjs web/server/auth.test.mjs web/server/activation.test.mjs web/server/recovery.test.mjs web/server/operations.test.mjs mobileapp/scripts/offline-recovery.test.mjs
```

Final result: **46 tests passed, 0 failed; process exit 0**. Coverage includes encryption/decryption, wrong keys, ciphertext/tag/nonce tampering, missing/invalid configuration, malformed envelopes, nonce variation, explicit version compatibility, key rotation, metadata/context binding, secret-safe errors, account/authentication/temporary-password/recovery behavior and generic injected offline-storage failures/recovery. All test data is synthetic; existing accounts and live database records are not used.

| Check | Result |
| --- | --- |
| `npm.cmd --prefix web run build` | PASS, exit 0; includes website type checking. Existing large-bundle warning remains. |
| `npm.cmd --prefix mobileapp run lint -- --no-cache` | PASS, exit 0. |
| `npm.cmd --prefix mobileapp run type-check` | PASS, exit 0. |
| `node --check web/server/data-encryption.mjs` | PASS, exit 0. |
| `node --check security/backend-data-encryption.test.mjs` | PASS, exit 0. |
| From `web/`: `node_modules\.bin\eslint.cmd server/data-encryption.mjs --no-cache` | PASS, exit 0. |
| Real mobile-device AES/SecureStore/cold-start operation | NOT TESTED. |
| Live account encryption persistence or live TLS handshake | NOT TESTED; no persistence integration and no live SQL run. |
| Full repository backend tests | NOT RUN: only eligible account tests ran; excluded domain/face test suites were not run. |

Initial syntax/lint shell attempts used incorrect relative paths and were corrected. The saved static evidence records the successful commands and exit codes. Tests/build/lint/type checks do not justify claiming end-to-end encryption or real-device verification.

## 8. Supabase review and remaining blockers

Eligible account SQL currently stores ordinary personal fields as plaintext from the application's perspective, protected in transit by configured TLS and at rest by the provider's infrastructure. No account field is encrypted with the new helper before database writes. No live SQL was executed in this task. The earlier EACCES metadata limitation remains unresolved and is not presented as a new live verification result.

**BLOCKED — APPROVAL REQUIRED:** production field encryption integration that affects account lookups, shared readers, API behavior, schemas, legacy records or authentication flows. No suitable safe field was established within the current restrictions.

**Configuration required after approval:** select actual permitted fields and threat model; provision backend secrets; document backup/rotation/recovery and the ciphertext format; verify every permitted reader/writer in isolated tests before any deployment or record change. No credentials are needed in chat.

**Not verified:** live Supabase storage/configuration, provider-managed key operation for this project, real phone encryption behavior, historical client builds, and deployed secret-management controls.

Final classification: **PARTIALLY IMPLEMENTED; backend persistence integration BLOCKED — APPROVAL REQUIRED.** The approved safe utility work is complete, existing protection is preserved and tested within the stated limits, and no protected functionality or live data was changed.
