"use strict";
require("../environment.cjs");
const { poolFromEnvironment } = require("../database.cjs");
(async () => {
  let pool;
  try {
    pool = poolFromEnvironment();
    await pool.query("SELECT 1");
    const { rows } = await pool.query(
      "SELECT to_regclass('species') IS NOT NULL AS species,to_regclass('plant_record') IS NOT NULL AS plants,to_regclass('plant_observation') IS NOT NULL AS observations",
    );
    console.log(
      JSON.stringify(
        { connected: true, storage: "postgresql", tables: rows[0] },
        null,
        2,
      ),
    );
    if (!Object.values(rows[0]).every(Boolean)) process.exitCode = 1;
  } catch (error) {
    console.error("PostgreSQL check failed:", error.code ?? error.name);
    process.exitCode = 1;
  } finally {
    if (pool) await pool.end();
  }
})();
