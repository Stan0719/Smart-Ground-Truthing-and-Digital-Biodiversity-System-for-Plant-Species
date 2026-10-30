"use strict";
require("../environment.cjs");
const { poolFromEnvironment } = require("../database.cjs");
(async () => {
  let pool;
  try {
    pool = poolFromEnvironment();
    await pool.query("SELECT 1");
    const { rows } = await pool.query(`
      SELECT
        current_database() AS database_name,
        inet_server_addr()::text AS server_address,
        current_schema() AS current_schema,
        current_setting('search_path') AS search_path,
        to_regclass('species') IS NOT NULL AS species,
        to_regclass('plant_record') IS NOT NULL AS plants,
        to_regclass('plant_observation') IS NOT NULL AS observations
    `);
    console.log(JSON.stringify({
      connected: true,
      storage: "postgresql",
      database: rows[0].database_name,
      server_address: rows[0].server_address,
      current_schema: rows[0].current_schema,
      search_path: rows[0].search_path,
      tables: {
        species: rows[0].species,
        plants: rows[0].plants,
        observations: rows[0].observations
      }
    }, null, 2));
    if (![rows[0].species, rows[0].plants, rows[0].observations].every(Boolean))
      process.exitCode = 1;
  } catch (error) {
    console.error("PostgreSQL check failed:", error.code ?? error.name);
    process.exitCode = 1;
  } finally {
    if (pool) await pool.end();
  }
})();
