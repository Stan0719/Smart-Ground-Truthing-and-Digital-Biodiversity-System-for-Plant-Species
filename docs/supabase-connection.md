> **26 October 2026 update:** Server storage has moved to PostgreSQL. Read [the current migration guide](postgresql-migration.md) before following historical SQLite paths, backups or test results below. Live Supabase cutover is not verified.

> Historical PostgreSQL-era document. The current plant backend uses SQLite.
> Follow [SQLite plant storage](sqlite-plant-storage.md) for current setup and backup instructions.
> Old PostgreSQL commands and completion counts below are retained for history.

# Supabase connection recovery

The existing plant records belong in Supabase. An empty `DATABASE_URL` previously
sent the backend to an unrelated local PostgreSQL instance. The current private
backend `.env` enables `DATABASE_URL_REQUIRED=1` to prevent that fallback.

## Required private configuration

1. Open the Supabase project that contains the existing plant records.
2. Open **Connect**, choose **Session pooler**, and copy its **URI**.
   Use the exact supplied host, port, database and username; do not guess a region.
3. Put the URI in `plant-conservation-backend/.env` as `DATABASE_URL="..."`.
   Replace the password placeholder with the database password, percent-encoded
   for a URL. Do not use a website-login password or an anonymous API key.
4. Use `sslmode=verify-full`. If the project needs its downloaded CA certificate,
   supply its absolute path using `sslrootcert`. Do not disable certificate
   verification. Without explicit URI SSL options, Supabase connections default
   to verified TLS in this backend.
5. Alternatively, provide `DATABASE_URL` as a Codespaces Secret, then restart the
   Codespace session as required for the secret to enter the process environment.
   Process environment variables take precedence over `.env`.

`.env` is ignored by Git and should remain permission 600. Never paste the URI in
chat, commit it, or include it in screenshots. No usable session-pooler URI was
available when these changes were made, so live Supabase verification is blocked.

## Read-only verification after configuration

From `plant-conservation-backend`:

```bash
npm run check-db
npm run inspect-schema
```

`check-db` uses a read-only transaction, rolls it back, and prints only connection
status and public table names. It does not print credentials or plant records.
Schema inspection prints metadata; review that output privately against the SQL
queries in `domain.cjs`, `uploads.cjs` and `iot.cjs`. A connection alone does not
establish schema compatibility or visibility of existing plants.

Restart the existing plant API after updating its environment. If it is already
running, stop that instance before `npm start` to avoid a port conflict. Keep the
authentication API and Vite running separately. Then verify:

```bash
curl -i http://127.0.0.1:3000/api/species
curl -i http://127.0.0.1:5173/api/data/species
```

An empty list is not proof of missing records: publication state, permissions and
row-level security must be considered. No migrations, seeders or database resets
are authorized by this procedure. Proposed schema changes require explicit user
approval after read-only review.

## Backup before approved schema work

Use a private destination directory (mode 700). Supply credentials through a
temporary private libpq service/password file, never command-line arguments or
logs. Check server version first: installed `pg_dump` 16 cannot dump a newer
major server. Use a compatible client if necessary. Create a custom-format dump,
check the exit status and verify its archive listing with `pg_restore --list`.
Protect the dump with mode 600. Archive readability alone is not a restore test;
perform any restore test only in a separate explicitly approved database.

Sources: [Supabase connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres),
[Supabase psql guide](https://supabase.com/docs/guides/database/psql),
[node-postgres SSL](https://node-postgres.com/features/ssl).
