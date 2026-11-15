"use strict";

const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const {
  poolFromEnvironment,
  resolveLocalPostgresTarget,
} = require("../database.cjs");
const { backupPostgres } = require("./postgres-backup.cjs");

const TARGET_DATABASE = "plant_conservation_dev";
const PERMISSION_PREFLIGHT = `
  SELECT
    to_regclass('public.qr_code') IS NOT NULL AS source_exists,
    to_regnamespace('plant_app') IS NOT NULL AS schema_exists,
    COALESCE((
      SELECT migration_role.rolsuper
        OR source.relowner = migration_role.oid
        OR pg_has_role(current_user, source.relowner, 'USAGE')
      FROM pg_class source
      JOIN pg_roles migration_role ON migration_role.rolname = current_user
      WHERE source.oid = to_regclass('public.qr_code')
    ), false) AS can_move,
    CASE
      WHEN to_regnamespace('plant_app') IS NULL THEN false
      ELSE has_schema_privilege(current_user, to_regnamespace('plant_app'), 'CREATE')
    END AS can_create
`;

function databaseName(env) {
  if (Object.prototype.hasOwnProperty.call(env, "DATABASE_URL")) {
    try {
      return decodeURIComponent(new URL(env.DATABASE_URL).pathname.slice(1));
    } catch {
      throw Error("Invalid PostgreSQL migration URL.");
    }
  }
  return env.DB_NAME || env.PGDATABASE;
}

async function runQrOnlyMigration({
  env = process.env,
  createPool = poolFromEnvironment,
  validateTarget = resolveLocalPostgresTarget,
  createBackup = backupPostgres,
  readFile = readFileSync,
  backupFile = resolve(
    __dirname,
    "../backups",
    "before-local-qr-move-" + Date.now() + ".dump",
  ),
} = {}) {
  let pool;
  let client;
  let transactionStarted = false;
  try {
    const target = validateTarget(env);
    if (databaseName(env) !== TARGET_DATABASE)
      throw Error("QR-only migration is restricted to plant_conservation_dev.");

    const migrationEnvironment = {
      ...env,
      PLANT_PG_SCHEMA: "plant_app",
    };
    if (!migrationEnvironment.DATABASE_URL) {
      migrationEnvironment.DB_HOST = target.host;
      migrationEnvironment.PGHOST = target.host;
    }

    pool = createPool(migrationEnvironment);
    client = await pool.connect();
    const permissions = (await client.query(PERMISSION_PREFLIGHT)).rows[0];
    if (!permissions?.source_exists)
      throw Error("public.qr_code is required for this local-only migration.");
    if (!permissions.schema_exists)
      throw Error("plant_app schema is required before the QR-only migration.");
    if (!permissions.can_move)
      throw Error("Migration role needs effective ownership rights on public.qr_code.");
    if (!permissions.can_create)
      throw Error("Migration role requires CREATE privilege on plant_app.");

    await createBackup(backupFile, {
      settings: migrationEnvironment,
      connection: migrationEnvironment.DATABASE_URL,
      schemas: [],
    });

    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("SELECT pg_advisory_xact_lock(87423902)");

    const migration = readFile(
      resolve(__dirname, "../migrations/015-local-qr-only-move.sql"),
      "utf8",
    )
      .replace(/^\s*BEGIN;\s*/i, "")
      .replace(/\s*COMMIT;\s*$/i, "");
    await client.query(migration);
    await client.query("COMMIT");
  } catch (error) {
    if (transactionStarted && client)
      await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client?.release();
    if (pool) await pool.end();
  }
}

async function main() {
  require("../environment.cjs");
  try {
    await runQrOnlyMigration();
    console.log("Local QR table moved; public plant records were not changed.");
  } catch (error) {
    console.error(
      error.code
        ? "Local QR migration failed: " + error.code
        : error.message,
    );
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { main, runQrOnlyMigration };
