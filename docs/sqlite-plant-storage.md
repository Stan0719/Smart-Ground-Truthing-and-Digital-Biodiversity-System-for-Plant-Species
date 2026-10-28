> **26 October 2026 update:** Server storage has moved to PostgreSQL. Read [the current migration guide](postgresql-migration.md) before following historical SQLite paths, backups or test results below. Live Supabase cutover is not verified.

# Local SQLite plant storage

The plant backend now runs without Supabase, PostgreSQL, PostGIS or PGlite.
Existing API routes and role restrictions remain in place. A new, initially empty
plant database was explicitly authorized; old Supabase records are not imported.
No sample data is inserted into application storage.

## Configuration and startup

Use Node 24.12 or newer (Node 24 LTS recommended). The backend uses built-in
`node:sqlite`; no external database server or native SQLite package is required.

`plant-conservation-backend/.env`:

```ini
PLANT_DB=data/plants.sqlite
PORT=3000
HOST=127.0.0.1
```

Relative plant database paths resolve from the backend directory, independently
of the terminal's current folder. Process variables take priority over `.env`.
`DATABASE_URL` and `DB_*` variables are unused. Plant storage is separate from
`web/server/data/auth.sqlite`. Do not set `AUTH_DB` to the plant database.

In separate terminals:

```bash
# Terminal 1, from plant-conservation-backend
npm ci
npm start

# Terminal 2, from web
npm run server

# Terminal 3, from web
npm run dev -- --host 0.0.0.0
```

Use VS Code Ports to open 5173. Vite forwards `/api/data/*` to port 3000 and the
remaining `/api/*` requests to authentication on port 3001. Authentication roles
and accounts are unchanged. An active Conservation Officer can add real species;
Botanists can collect observations; Administrators retain their existing explicit
account and device permissions. No role gains automatic access to all data.

## Storage and behavior

- `data/plants.sqlite` has a separate application identifier and versioned schema.
- Foreign keys, constraints and serialized `BEGIN IMMEDIATE` transactions protect
  relationships, retries, review decisions and concurrent updates.
- Species attributes, observation JSON, visibility, reviews, audit, images/PDF
  blobs and IoT data live in the plant database.
- Coordinates remain latitude, longitude and accuracy values with range checks;
  PostGIS is not used. No existing endpoint performs spatial-radius queries.
- Numeric identifiers, JSON objects and approval flags are serialized to match
  the previous API. Owner subjects still refer to authoritative account IDs.
- Existing image files, source snapshots and historical SQL remain untouched.
- Local `data/` and `backups/` are gitignored. The main database is mode 600 and
  newly created storage directories are mode 700.
- Empty public catalogues return `{"species":[]}` and `{"plants":[]}` with HTTP
  200. No data is fabricated and the existing error banner still shows genuine
  storage/API failures. Private and protected species remain filtered by RBAC.

Check from the backend:

```bash
npm run check-db
npm run inspect-schema
npm test
```

The check command opens/initializes the authorized local plant database, verifies
integrity and foreign keys, then prints counts. Tests use isolated temporary or
in-memory databases; test fixtures are not application records. Historical
PostgreSQL migration files are retained; `scripts/migrate.cjs` refuses execution.

## Backup

From the backend:

```bash
npm run backup-db
# Or supply a NEW destination file:
npm run backup-db -- /absolute/private/location/plants-backup.sqlite
```

The script uses SQLite's online backup API so committed data in WAL is included.
It never overwrites an existing destination. It validates the archive's SQLite
integrity, foreign keys and application identifier, and reports success only
when those checks pass. A failed output is not a usable backup. Backups contain
private records and images: keep them private and encrypted where appropriate.

Back up authentication separately; this command never copies or changes it.
Copying only `plants.sqlite` while a writer runs is unsafe because committed data
may still be in `plants.sqlite-wal`. Do not delete WAL or SHM files while running.

## Restore

1. Stop the plant API with Ctrl+C. Also stop any tooling using the target plant
   database. Do not stop or overwrite the authentication database.
2. Keep the existing database and its sidecar files intact for rollback.
3. Copy a verified backup to a NEW local filename, for example
   `data/plants-restored.sqlite`; protect the copy with `chmod 600`.
4. Change `PLANT_DB` in the backend `.env` to that new file. If a process variable
   overrides it, update that variable too. Do not overwrite any old database.
5. Run `npm run check-db`, restart the plant API, and verify expected record
   counts, species visibility, observations and images. If verification fails,
   stop the API and point `PLANT_DB` back to the original file.

Backup and restore to a separate file are regression-tested. Integrity checks
alone do not establish that every expected real-world record was included;
compare application counts and inspect required records after a restore.

## Codespaces durability

The database survives API restarts in this Codespace. It is not an external
managed database. Deleting or recreating a Codespace can lose local records,
authentication data and local backups. Download verified backups regularly to
private storage OUTSIDE the Codespace; do not rely on Git or a local backups
folder. Keep at least one independent backup before rebuilds or environment
changes. This local architecture is intended for a single API process, not
multiple API hosts sharing a database over a network filesystem.

## Verification limits

SQLite conversion is complete and independent of PostgreSQL/Supabase. Subsequent
software repairs added bounded offline restart recovery and repaired the face
model environment; see the latest [RBAC audit](rbac-complete-audit.md) and
[final verification](final-system-verification.md#22-master-rbac-security-audit--current-results).
Email template configuration, phone reachability, authorized portrait fixtures
and physical sensor/camera/GPS checks remain separate requirements. Protected
species remain Officer-only under the existing policy; no Botanist eligibility
policy is needed to keep that rule. No Supabase connection is made by this backend
or its database checks.

## Files changed for this transition

- `.gitignore`, `README.md`: ignore private plant storage and describe current startup.
- `plant-conservation-backend/database.cjs`: persistent native SQLite, schema guards,
  JSON/identifier serialization, queued transactions and constraint handling.
- `plant-conservation-backend/sqlite/schema.sql`: empty versioned plant schema.
- `plant-conservation-backend/domain.cjs`, `iot.cjs`, `uploads.cjs`: SQLite queries
  for all existing domain, reports, media, review and IoT endpoints.
- `plant-conservation-backend/server.js`: SQLite metadata endpoint and storage error.
- `plant-conservation-backend/.env`, `.env.example`: local `PLANT_DB` configuration.
- `plant-conservation-backend/package.json`, `package-lock.json`: remove `pg` and
  PGlite; add local checks/backup command and retire the migration command.
- `plant-conservation-backend/scripts/check-db.cjs`, `inspect-schema.cjs`,
  `backup-db.cjs`, `migrate.cjs`: SQLite tools and disabled historical migration.
- `plant-conservation-backend/test/business.test.cjs`, `database.test.cjs`,
  `rbac.test.cjs`: converted workflows, empty lists, durability/restore, constraints
  and permission regression checks.
- `web/src/views/HomeView.vue`, `PlantsView.vue`: empty-catalogue text; catalogue
  sorting/filter reset handlers remain valid through template formatting.
- `docs/sqlite-plant-storage.md`: current setup and backup/restore instructions.
- `docs/rbac-implementation.md`, `rbac-results.md`, `supabase-connection.md`:
  historical notices pointing to these current instructions.

Authentication implementation files, mobile implementation files, original image
files, historical SQL migrations and source/database backups were not changed by
this transition. New private runtime files are `data/plants.sqlite` and its WAL
sidecars. A verified empty database backup was created in `backups/`.

Later face, activation, offline and IoT repairs are recorded in
[remaining software repairs](remaining-software-repairs.md).
The plant database now upgrades additively to schema version 2 for optional IoT
retry receipts; existing plant records are not rewritten.

## Full-system backups

From the backend, `npm run backup-system` additionally snapshots the authentication
and optional face databases and copies matching private recovery/service keys.
It verifies integrity and restoration into temporary files, never overwriting a
live database. The backup directory is private and includes a verified manifest.
Download backups outside the Codespace. See
[final system verification](final-system-verification.md#18-backup-restore-and-preservation)
for the current backup ZIP, private download instructions and coordinated restore
limitations. Do not share these archives publicly or commit them to Git.

For a plant/authentication-only recovery set without opening face storage, use
`npm run backup-system -- --without-biometrics`. This also excludes the face
account-service key. Use the full biometric scope only when authorized.
