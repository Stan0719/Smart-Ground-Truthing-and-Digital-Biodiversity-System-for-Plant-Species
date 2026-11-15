"use strict";
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
async function createPlantDatabase() {
  const { testPool } = await import("../../web/server/test-postgres.mjs");
  const pool = await testPool();

  await pool.query("CREATE SCHEMA IF NOT EXISTS plant_app");
  await pool.query("SET search_path TO plant_app, pg_catalog");

  await pool.query(
    readFileSync(join(__dirname, "../schema.postgres.sql"), "utf8"),
  );
  return pool;
}
module.exports = { createPlantDatabase };
