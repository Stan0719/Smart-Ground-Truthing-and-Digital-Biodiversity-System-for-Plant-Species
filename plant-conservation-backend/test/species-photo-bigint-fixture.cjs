"use strict";
// Test-only adapter for an isolated PGlite pool. Never loads configuration.
// Change only user-verified columns; unverified dependencies retain source types.
async function useVerifiedPhotoKeyTypes(pool) {
  await pool.query(`
    ALTER TABLE species ALTER COLUMN species_id TYPE BIGINT,
      ALTER COLUMN genus_id TYPE BIGINT,
      ALTER COLUMN status_id TYPE BIGINT;
    ALTER TABLE rbac_species_visibility ALTER COLUMN species_id TYPE BIGINT;
    ALTER TABLE plant_record ALTER COLUMN plant_id TYPE BIGINT,
      ALTER COLUMN species_id TYPE BIGINT;
    ALTER TABLE plant_asset ALTER COLUMN species_id TYPE BIGINT,
      ALTER COLUMN plant_id TYPE BIGINT;
    ALTER TABLE plant_observation ALTER COLUMN plant_id TYPE BIGINT;
  `);
}
// Full ready schema for route tests that explicitly opt into photo writes.
async function createReadySpeciesPhotoDatabase() {
  const { createPlantDatabase } = require("./postgres-fixture.cjs");
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const pool = await createPlantDatabase();
  try {
    await pool.query("CREATE SCHEMA plant_app; SET search_path TO plant_app,pg_catalog;");
    await pool.query(readFileSync(join(__dirname, "../schema.postgres.sql"), "utf8"));
    for (const name of ["004-species-requests.sql", "006-atomic-plant-submissions.sql",
      "008-record-change-submissions.sql", "009-record-version-history.sql"])
      await pool.query(readFileSync(join(__dirname, "../migrations", name), "utf8"));
    await useVerifiedPhotoKeyTypes(pool);
    for (const name of ["014-species-image-gallery.sql", "015-species-photo-roles.sql"])
      await pool.query(readFileSync(join(__dirname, "../migrations", name), "utf8"));
    return pool;
  } catch (error) {
    await pool.end();
    throw error;
  }
}
module.exports = { useVerifiedPhotoKeyTypes, createReadySpeciesPhotoDatabase };
