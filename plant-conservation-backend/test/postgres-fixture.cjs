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
// Explicit opt-in: old/missing-schema fixtures must remain available for negatives.
async function installRecordChangeNotifications(pool) {
  if (!(await pool.query("SELECT to_regclass('plant_app.botanist_notification') IS NOT NULL AS ready")).rows[0].ready)
    await pool.query(readFileSync(join(__dirname, "../migrations/011-botanist-notification-history.sql"), "utf8"));
  await pool.query(readFileSync(join(__dirname, "../migrations/030-record-change-review-notifications.sql"), "utf8"));
}
module.exports = { createPlantDatabase, installRecordChangeNotifications };
