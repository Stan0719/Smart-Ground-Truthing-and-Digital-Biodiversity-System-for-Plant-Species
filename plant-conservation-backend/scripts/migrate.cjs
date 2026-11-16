"use strict";
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const {
  poolFromEnvironment,
  resolveLocalPostgresTarget,
} = require("../database.cjs");
const { backupPostgres } = require("./postgres-backup.cjs");
const {
  MIGRATION_003_PUBLIC_CHECK_SQL,
  MIGRATION_003_STATE_SQL,
  POST_015_RECOGNITION_SQL,
  checksum,
  classifyQrInventory003,
  isPost015Catalog,
  validateHistory,
} = require("./migration-state.cjs");
async function runMigration({
  env = process.env,
  createPool = poolFromEnvironment,
  validateTarget = resolveLocalPostgresTarget,
  createBackup = backupPostgres,
  readFile = readFileSync,
  backupFile = resolve(
    __dirname,
    "../backups",
    "before-postgres-schema-" + Date.now() + ".dump",
  ),
} = {}) {
  let pool;
  let client;
  let transactionStarted = false;
  try {
    const schema = env.PLANT_PG_SCHEMA;
    if (schema !== "plant_app")
      throw Error("PLANT_PG_SCHEMA=plant_app is required for this migration.");
    const target = validateTarget(env);
    const migrationEnvironment = { ...env };
    delete migrationEnvironment.PGHOSTADDR;
    delete migrationEnvironment.PGSERVICE;
    delete migrationEnvironment.PGSERVICEFILE;
    if (!migrationEnvironment.DATABASE_URL) {
      migrationEnvironment.DB_HOST = target.host;
      migrationEnvironment.PGHOST = target.host;
    }
    pool = createPool(migrationEnvironment);
    client = await pool.connect();
    // Preserve current data before applying any DDL, even on a development host.
    createBackup(backupFile, {
      settings: migrationEnvironment,
      connection: migrationEnvironment.DATABASE_URL,
      schemas: [],
    });
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("SELECT pg_advisory_xact_lock(87423901)");
    const required = {
      species: ["species_id", "rbac_data"],
      plant_record: [
        "plant_id",
        "registered_subject",
        "rbac_status",
        "qr_token",
      ],
      plant_location: ["location_id", "latitude", "longitude", "accuracy_m"],
      plant_observation: ["id", "content", "owner_subject", "revision"],
    };
    for (const [table, columns] of Object.entries(required)) {
      const existing = await client.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema=$2 AND table_name=$1",
        [table,schema],
      );
      if (
        existing.rows.length &&
        columns.some((c) => !existing.rows.some((r) => r.column_name === c))
      )
        throw Error(
          "Existing PostgreSQL domain schema needs a reviewed mapping; no data was changed.",
        );
    }
    await client.query(
      readFile(resolve(__dirname, "../schema.postgres.sql"), "utf8"),
    );
    const migrationFiles = {
      "014-move-qr-code-to-plant-app.sql": "014-move-qr-code-to-plant-app.sql",
      "003-plant-qr-inventory.sql": "003-plant-qr-inventory.sql",
      "015-local-qr-only-move.sql": "015-local-qr-only-move.sql",
    };
    const migrationSql = Object.fromEntries(Object.entries(migrationFiles).map(([name, file]) =>
      [name, readFile(resolve(__dirname, "../migrations", file), "utf8")],
    ));
    const knownChecksums = Object.fromEntries(Object.entries(migrationSql).map(([name, sql]) =>
      [name, checksum(sql)],
    ));
    await client.query(`
      CREATE TABLE IF NOT EXISTS plant_app.schema_migration_history (
        migration_name TEXT PRIMARY KEY,
        migration_checksum TEXT NOT NULL,
        resolution TEXT NOT NULL CHECK (resolution IN ('executed','recognized','superseded')),
        executed_at TIMESTAMPTZ,
        recognized_at TIMESTAMPTZ,
        superseded_by TEXT,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    for (const [column, definition] of [
      ["migration_checksum", "TEXT"],
      ["resolution", "TEXT"],
      ["executed_at", "TIMESTAMPTZ"],
      ["recognized_at", "TIMESTAMPTZ"],
      ["superseded_by", "TEXT"],
      ["recorded_at", "TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP"],
    ]) {
      await client.query(
        `ALTER TABLE plant_app.schema_migration_history ADD COLUMN IF NOT EXISTS ${column} ${definition}`,
      );
    }
    // Upgrade the previous runner's ledger without discarding its audit time.
    // Legacy entries lack a SQL checksum and are deliberately rejected below
    // until an operator verifies their identity against the historical file.
    await client.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='plant_app' AND table_name='schema_migration_history'
            AND column_name='applied_at') THEN
          EXECUTE $m$
            UPDATE plant_app.schema_migration_history
            SET resolution=CASE WHEN applied_via='superseded-by-015'
              THEN 'superseded' ELSE 'executed' END,
              executed_at=CASE WHEN applied_via='superseded-by-015'
                THEN NULL ELSE applied_at END,
              recognized_at=CASE WHEN applied_via='superseded-by-015'
                THEN applied_at ELSE NULL END,
              superseded_by=CASE WHEN applied_via='superseded-by-015'
                THEN '015-local-qr-only-move.sql' ELSE NULL END
            WHERE resolution IS NULL
          $m$;
        END IF;
      END $$
    `);
    const appliedRows = await client.query(
      `SELECT migration_name,migration_checksum,resolution,executed_at,
        recognized_at,superseded_by FROM plant_app.schema_migration_history`,
    );
    const history = validateHistory(appliedRows.rows, knownChecksums);

    const migration014 = "014-move-qr-code-to-plant-app.sql";
    const qr015 = "015-local-qr-only-move.sql";
    const post015 = await client.query(POST_015_RECOGNITION_SQL);
    const shape = post015.rows[0];
    const post015Recognized = isPost015Catalog(shape);
    const qr015Recorded = history.has(qr015);
    if (qr015Recorded && !(shape?.source_absent && shape?.destination_present))
      throw Error("Recorded migration 015 has conflicting source/destination table locations; operator review required.");
    if (post015Recognized && !qr015Recorded) {
      await client.query(`
        INSERT INTO plant_app.schema_migration_history
          (migration_name,migration_checksum,resolution,recognized_at)
        VALUES ($1,$2,'recognized',CURRENT_TIMESTAMP)
      `, [qr015, knownChecksums[qr015]]);
      history.set(qr015, { migration_name: qr015, migration_checksum: knownChecksums[qr015], resolution: "recognized", recognized_at: new Date() });
    }
    if (qr015Recorded || post015Recognized) {
      if (!history.has(migration014)) {
        await client.query(`
          INSERT INTO plant_app.schema_migration_history
            (migration_name,migration_checksum,resolution,recognized_at,superseded_by)
          VALUES ($1,$2,'superseded',CURRENT_TIMESTAMP,$3)
        `, [migration014, knownChecksums[migration014], qr015]);
        history.set(migration014, { migration_name: migration014, migration_checksum: knownChecksums[migration014], resolution: "superseded", recognized_at: new Date(), superseded_by: qr015 });
      }
    }

    if (!history.has(migration014)) {
      const sql = migrationSql[migration014]
        .replace(/^\s*BEGIN;\s*/i, "")
        .replace(/\s*COMMIT;\s*$/i, "");
      await client.query(sql);
      await client.query(`
        INSERT INTO plant_app.schema_migration_history
          (migration_name,migration_checksum,resolution,executed_at)
        VALUES ($1,$2,'executed',CURRENT_TIMESTAMP)
      `, [migration014, knownChecksums[migration014]]);
      history.set(migration014, { migration_name: migration014, migration_checksum: knownChecksums[migration014], resolution: "executed", executed_at: new Date() });
    }

    const migration003 = "003-plant-qr-inventory.sql";
    if (!history.has(migration003)) {
      const state = (await client.query(MIGRATION_003_STATE_SQL)).rows[0];
      if (state.public_plant_exists) {
        state.public_mismatch_count = (await client.query(MIGRATION_003_PUBLIC_CHECK_SQL)).rows[0].mismatch_count;
      } else {
        state.public_mismatch_count = 0;
      }
      const disposition = classifyQrInventory003(state);
      if (disposition === "ambiguous")
        throw Error("Migration 003 QR inventory state is partial or inconsistent; operator review required.");
      if (disposition === "complete") {
        await client.query(`
          INSERT INTO plant_app.schema_migration_history
            (migration_name,migration_checksum,resolution,recognized_at)
          VALUES ($1,$2,'recognized',CURRENT_TIMESTAMP)
        `, [migration003, knownChecksums[migration003]]);
      } else {
        const sql = migrationSql[migration003]
          .replace(/^\s*BEGIN;\s*/i, "")
          .replace(/\s*COMMIT;\s*$/i, "");
        await client.query(sql);
        await client.query(`
          INSERT INTO plant_app.schema_migration_history
            (migration_name,migration_checksum,resolution,executed_at)
          VALUES ($1,$2,'executed',CURRENT_TIMESTAMP)
        `, [migration003, knownChecksums[migration003]]);
      }
    }
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
    await runMigration();
    console.log("PostgreSQL plant schema ready; existing data preserved.");
  } catch (error) {
    console.error(
      error.code ? "PostgreSQL migration failed: " + error.code : error.message,
    );
    process.exitCode = 1;
  }
}
if (require.main === module) main();

module.exports = { main, runMigration };
