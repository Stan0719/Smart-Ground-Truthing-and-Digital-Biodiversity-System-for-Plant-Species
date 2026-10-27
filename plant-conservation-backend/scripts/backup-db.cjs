"use strict";
require("../environment.cjs");
const { resolve } = require("node:path");
const { backupPostgres } = require("./postgres-backup.cjs");
try {
  const file =
    process.argv[2] ||
    resolve(__dirname, "../backups", "plants-" + Date.now() + ".dump");
  console.log(JSON.stringify(backupPostgres(file), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
