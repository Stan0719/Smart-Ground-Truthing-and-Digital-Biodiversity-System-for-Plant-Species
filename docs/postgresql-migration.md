# PostgreSQL migration ? 26 October 2026

The live database mapping and local application configuration are complete. The application uses Vue components with Node.js and PostgreSQL. No project Python source files were created or restored during this continuation.

## Active storage

| Component | Schema |
| --- | --- |
| Plant records, observation workflow and IoT API | plant_app |
| User accounts, sessions and RBAC authentication | plant_auth |
| Face-storage tables for future integration | plant_face |

The existing backend .env selects PLANT_PG_SCHEMA=plant_app. DATABASE_URL and PGSSLROOTCERT remain private. Database TLS certificate and hostname verification remain enabled. Vue /api/data requests route to the local Node plant API through the existing Vite proxy.

## What was preserved

The original 23 public tables remain intact. A pre-change PostgreSQL archive was restored into an isolated PostgreSQL/PostGIS test engine; every source table matched after timestamps were compared in UTC and geometry was compared in its stored representation. The mapping was rehearsed on that restored copy before live execution. Source fingerprints were checked again under transaction locks immediately before cutover and after the migration.

Copied and verified: 1 existing account, 2 families, 2 genera, 7 conservation statuses, 2 species, 2 plants, 2 locations and 1 observation. Original IDs, password hash, ownership and pending workflow were preserved. Pending verification is retained in private legacy_records without inventing a completed Officer review. Original geometry and other source fields remain in the original tables and private legacy metadata. No account was reset and no synthetic business records or biometric enrollments were added.

Legacy species had no publication classification, so imported visibility defaults to protected. An authorized Officer must classify records before public publication. The old public tables are retained for rollback and are not automatically synchronized with the active private schemas. Any older deployment that still writes to public must be updated or stopped before a production release; no hosting deployment was performed here.

Anonymous and authenticated Supabase API roles cannot access the private application schemas or read the original credential/reset tables. RBAC grants remain in shared/rbac.cjs and server-side checks.

## Verification

- 34 web authentication/migration/security tests passed (26 October compatible dependency update).
- 14 plant backend/RBAC/media/simulated-IoT/backup-command tests passed.
- 3 gateway/storage tests passed.
- Vue TypeScript checks and production build passed after compatible dependency updates.
- Temporary loopback Node API checks against the migrated live database passed: plant health 200, public catalogue 200, unauthenticated device access 401, unauthenticated session access 401.
- Live readiness checks pass for PostgreSQL plant, authentication and face-storage schemas and private separation.
- The production gate remains blocked by administrator/staff acceptance, production HTTPS/origins, dependency findings and real-world acceptance. EmailJS configuration and one approved delivery test are confirmed. A face-storage table is not a working face-recognition service.

## Known legacy credential issue and current account acceptance

The migrated legacy account is a Botanist, not an Administrator. Its original unsupported password hash remains unchanged. Owner-authorized account recovery remains separate; no existing real password was reset during the master-instruction stage.

The owner confirmed successful Administrator website access in the earlier setup. Current master-instruction changes use disposable accounts only in isolated PostgreSQL test engines. After local API restart, active storage retained four staff accounts, two plants and one observation. No real email, account creation or live record mutation occurred in this stage. All eight audited page integration failures were repaired; read the latest master-instruction report in final-manual-testing-checklist.md for current tests and outstanding acceptance gates.

A fresh private-schema backup was archive-validated and actually restored into an isolated PostgreSQL engine in this stage. It retained the same four staff accounts, two plants and one observation. Original public backup restoration and migration rehearsal were repeated successfully across all 23 source tables. Separate original SQLite backup availability was not established; independent off-computer retention remains outstanding.

## Backups and commands

Private backup archives, SQL restoration material and existing checkpoint files are under the ignored plant-conservation-backend/backups and .local-tools locations. The backup directory has restricted NTFS permissions. The original archives were retained. An independent backup outside this computer is still required for production recovery.

Existing commands:

- npm --prefix web run check:postgres
- npm --prefix plant-conservation-backend run check-db
- npm --prefix web run test:auth
- npm --prefix plant-conservation-backend test
- node deploy/check-readiness.mjs

The existing migrate-legacy-postgres command refuses existing target schemas and is not a routine rerun command. Future backup commands follow PLANT_PG_SCHEMA; they must include the active private schemas. Starting the standard authentication server may initialize its normal private recovery-key file if absent; no such startup was performed during this no-new-files continuation.
