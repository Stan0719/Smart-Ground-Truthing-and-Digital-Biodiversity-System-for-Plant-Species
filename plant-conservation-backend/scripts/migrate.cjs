"use strict";
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { poolFromEnvironment } = require("../database.cjs");
const { backupPostgres } = require("./postgres-backup.cjs");
async function main() {
  require("../environment.cjs");
  const schema=process.env.PLANT_PG_SCHEMA||"public";
  const pool = poolFromEnvironment();
  let client;
  try {
    client = await pool.connect();
    // Preserve current data before applying any DDL, even on a development host.
    backupPostgres(
      resolve(
        __dirname,
        "../backups",
        "before-postgres-schema-" + Date.now() + ".dump",
      ),
    );
    await client.query("BEGIN");
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
      readFileSync(resolve(__dirname, "../schema.postgres.sql"), "utf8"),
    );
    await client.query("COMMIT");
    console.log("PostgreSQL plant schema ready; existing data preserved.");
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error(
      error.code ? "PostgreSQL migration failed: " + error.code : error.message,
    );
    process.exitCode = 1;
  } finally {
    client?.release();
    await pool.end();
  }
}
if (require.main === module) main();
