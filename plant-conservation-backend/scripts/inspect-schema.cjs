"use strict";
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
async function inspect(pool) {
  const client = await pool.connect();
  try {
    const sql = readFileSync(
      resolve(__dirname, "../../docs/recovery/inspect-postgresql.sql"),
      "utf8",
    );
    const results = await client.query(sql);
    const result = results.find(
      (item) => item.rows?.[0]?.schema_report !== undefined,
    );
    if (!result) throw Error("Schema metadata result is missing.");
    return JSON.parse(result.rows[0].schema_report);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
if (require.main === module) {
  (async () => {
    let pool;
    try {
      require("../environment.cjs");
      pool = require("../database.cjs").poolFromEnvironment();
      console.log(JSON.stringify(await inspect(pool), null, 2));
    } catch {
      console.error(
        "Read-only PostgreSQL schema inspection failed. Verify dependencies, server-only configuration and metadata access. Connection details were not printed.",
      );
      process.exitCode = 1;
    } finally {
      if (pool) await pool.end();
    }
  })();
}
module.exports = { inspect };
