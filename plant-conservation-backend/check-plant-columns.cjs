const { Client } = require("pg");

const client = new Client({
  connectionString: process.env.DATABASE_URL
});

async function main() {
  await client.connect();

  const result = await client.query(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN (
        'plant_record',
        'species',
        'plant_observation'
      )
    ORDER BY table_name, ordinal_position
  `);

  console.table(result.rows);
  await client.end();
}

main().catch(async (error) => {
  console.error("Diagnostic failed:", error.code || error.name);
  await client.end().catch(() => {});
  process.exitCode = 1;
});
