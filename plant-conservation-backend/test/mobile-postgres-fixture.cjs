"use strict";
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

async function createMobileTestDatabase() {
  // In-memory only: never reads .env, DATABASE_URL, or a shared service.
  const db = new PGlite();
  try {
    await db.query("CREATE SCHEMA IF NOT EXISTS plant_app");
    await db.query("SET search_path TO plant_app, pg_catalog");
    await db.exec(readFileSync(join(__dirname, "../schema.postgres.sql"), "utf8"));
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

module.exports = { createMobileTestDatabase };
