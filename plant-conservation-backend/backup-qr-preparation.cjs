"use strict";

const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");

const { resolveLocalPostgresTarget } = require("./database.cjs");
const { backupPostgres } = require("./scripts/postgres-backup.cjs");

// Load ONLY the separate local configuration.
const env = dotenv.parse(
  fs.readFileSync(path.resolve("qr-local.env"), "utf8")
);

// Require a temporary password supplied by the current process.
if (!process.env.PGPASSWORD) {
  throw new Error("Temporary PostgreSQL password is missing.");
}
env.PGPASSWORD = process.env.PGPASSWORD;

// Reject accidental remote connection configuration.
if (env.DATABASE_URL || env.PGHOSTADDR || env.PGSERVICE) {
  throw new Error("Unexpected connection override. Backup cancelled.");
}

resolveLocalPostgresTarget(env);

if (
  env.DB_NAME !== "plant_conservation_dev" ||
  env.DB_HOST !== "127.0.0.1" ||
  env.DB_PORT !== "5432"
) {
  throw new Error("Backup restricted to the verified local database.");
}

env.PG_DUMP_BINARY =
  "C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe";
env.PG_RESTORE_BINARY =
  "C:\\Program Files\\PostgreSQL\\18\\bin\\pg_restore.exe";

const file = path.resolve(
  "backups",
  "plant_conservation_dev-full-" + Date.now() + ".dump"
);

const result = backupPostgres(file, {
  settings: env,
  schemas: []
});

console.log(JSON.stringify({ file, ...result }, null, 2));
