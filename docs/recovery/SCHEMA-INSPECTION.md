# Read-only PostgreSQL inspection

Status: prepared, not executed against PostgreSQL. No connection variables, local .env or psql are available in this session. This does not establish whether the existing database contains data.

## Preferred method: existing database SQL editor

Open the SQL editor for the database already used by the project (for example its Supabase SQL editor or pgAdmin). Run the entire contents of `inspect-postgresql.sql`. Export/copy the single schema_report JSON result to `docs/recovery/postgresql-schema.local.json` and tell the agent it is ready. No password or connection URL needs to be shared in chat.

The transaction is explicitly READ ONLY with timeouts and ends in ROLLBACK. It lists tables, column types, keys/constraints, index names, trigger metadata and extension names. It does not query application records, password hashes or connection settings. Column defaults, trigger bodies and index definitions are omitted to reduce incidental exposure. Constraint definitions can contain schema-specific literal values; review before sharing outside the project. Metadata visibility depends on the database role; use a role that can inspect the project schemas.

## Optional: existing PostgreSQL client

From the repository root, with your database connection already configured securely through PostgreSQL environment variables and your usual password mechanism:

```powershell
psql -X -v ON_ERROR_STOP=1 -A -t -f docs/recovery/inspect-postgresql.sql -o docs/recovery/postgresql-schema.local.json
```

Do not place the database password in a command or paste it into chat. psql output may include transaction status lines; the agent can extract the JSON result.

## Optional: Node runner

After installing existing backend dependencies and configuring its ignored server-only .env:

```powershell
node plant-conservation-backend/scripts/inspect-schema.cjs > docs/recovery/postgresql-schema.local.json
```

The runner uses the exact same SQL as the manual method and prints generic errors without connection details. Do not run the recovered migration scripts yet; their observation-table assumptions conflict with main.

## Review after inspection

Check existing public.users identifiers and constraints; plant_observation/verification columns; species, plant_record and location keys; IoT/device tables; and PostGIS availability. Obtain a reviewed backup and an explicit data-transfer plan separately before changing schema or moving records. Metadata alone does not prove that a table is empty.
