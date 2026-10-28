"use strict";

const { resolve } = require("node:path");
const { poolFromEnvironment } = require("../database.cjs");
const { backupPostgres } = require("./postgres-backup.cjs");
const { applyRbacMigration, RBAC_BACKUP_SCHEMAS } = require("../rbac-migration.cjs");

async function runRbacMigration({
  pool,
  backup = backupPostgres,
  apply = applyRbacMigration,
  backupPath = resolve(__dirname, "../backups", `before-rbac-${Date.now()}.dump`),
}) {
  backup(backupPath, { schemas: [...RBAC_BACKUP_SCHEMAS] });
  let client;
  try {
    client = await pool.connect();
    return await apply(client);
  } finally {
    client?.release();
  }
}

async function main() {
  require("../environment.cjs");
  const pool = poolFromEnvironment();
  try {
    const result = await runRbacMigration({ pool });
    console.log(`RBAC assignment migration completed for ${result.roles} roles.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) main();

module.exports = { main, runRbacMigration };
