# Face storage PostgreSQL cutover

The Python server now uses PostgreSQL through `postgres_store.py`. It loads the
same private environment files as the Node backend. It never falls back to a local
SQLite file, creates schemas, or changes database permissions at startup.

Required backend-only settings are `FACE_DATABASE_URL` (or the existing
`DATABASE_URL` fallback) and `FACE_PG_SCHEMA=plant_face`. Keep the face schema
distinct from `AUTH_PG_SCHEMA`. The existing account bridge URL and key are still
required. Remote PostgreSQL connections verify TLS; `PGSSLROOTCERT` can specify a
trusted CA file. Never place any database credentials in Expo public settings.

## Approval boundary

Code preparation does not migrate live enrollments. Before executing the cutover,
approve the driver installation, a brief stop/restart of only the Python face
service, and copying existing face data into the reviewed PostgreSQL face schema.
Do not restart the account API, bridge, gateway, or tunnel for this conversion.

## Reviewed sequence (not executed by documentation)

1. Install only `face_backend/requirements-postgres.txt` into the Python environment
   actually used by the face launcher. Do not reinstall the ML dependencies.
2. Stop the Python supervisor and worker during the maintenance window. Confirm
   that port 8000 is free so no enrollments can be written during the copy.
3. Back up `face_backend/data/auth.sqlite` with SQLite's backup API. Preserve both
   source and backup; do not use a raw file copy while SQLite is writing.
4. Confirm all six destination face tables are empty. Do not merge or overwrite
   an existing destination. The existing PostgreSQL schema must already be ready;
   do not run a schema migration without separate approval if it is missing.
5. From `web/`, run the existing import utility against the absolute backup path:

   ```powershell
   node scripts/import-sqlite.mjs 'ABSOLUTE_SQLITE_BACKUP_PATH' --face
   ```

   It opens the source read-only, takes a consistent snapshot, imports in one
   PostgreSQL transaction, verifies every copied field and row count, and refuses
   non-empty targets. It does not modify account tables or regenerate embeddings.
6. From `mobileapp/face_backend/`, use the launcher's Python executable to run
   `-B server.py --check-storage`. This validates existing PostgreSQL tables without
   creating them, doing inference, or authenticating an account.
7. Start only the existing Python face service with the Windows launcher's `Face`
   mode. Verify HTTPS `/face/health` reports `storage: postgresql`,
   `accountService: authoritative`, and `ready: true`.
8. The user can then test face login. No automatic enrollment or login is part of
   the migration. Keep SQLite intact as a rollback source; do not resume writing
   both stores. A rollback after PostgreSQL receives new enrollments requires a
   reviewed reconciliation, not simply deleting PostgreSQL rows.

SQLite remains in explicit test fixtures and the one-time importer only. It is no
longer opened by the Python server runtime after cutover. Each teammate connects
to the approved shared private PostgreSQL face store rather than copying face
templates between laptops.
