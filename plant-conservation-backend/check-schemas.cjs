const { Client } = require("pg");

const client = new Client({
  connectionString: process.env.DATABASE_URL
});

async function main() {
  await client.connect();

  const result = await client.query(`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_name IN (
      'plant_record',
      'species',
      'plant_observation'
    )
    AND table_schema IN ('public', 'plant_app')
    ORDER BY table_schema, table_name
  `);

  console.table(result.rows);
  await client.end();
}

main().catch(async (error) => {
  console.error("Check failed:", error.code || error.name);
  await client.end().catch(() => {});
  process.exitCode = 1;
});
