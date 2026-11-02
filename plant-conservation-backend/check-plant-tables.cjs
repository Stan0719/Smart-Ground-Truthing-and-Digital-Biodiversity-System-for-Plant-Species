require("./environment.cjs");

const { poolFromEnvironment } = require("./database.cjs");

async function main() {
  const pool = poolFromEnvironment();

  try {
    const result = await pool.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = $1
       AND table_type = $2
       ORDER BY table_name`,
      ["plant_app", "BASE TABLE"]
    );

    console.table(result.rows);
    console.log("Total tables:", result.rowCount);
  } catch (error) {
    console.error("Database error:", error.code || error.message);
  } finally {
    await pool.end();
  }
}

main();
