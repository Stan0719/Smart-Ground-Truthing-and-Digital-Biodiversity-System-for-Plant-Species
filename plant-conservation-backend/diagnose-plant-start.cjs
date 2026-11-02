require("./environment.cjs");

async function main() {
  let auth;
  let pool;

  try {
    console.log("Stage 1: Loading server environment...");
    const { loadServerEnvironment } = await import("../web/server/postgres.mjs");
    loadServerEnvironment();

    console.log("Stage 2: Creating authentication service...");
    const { createAuth } = await import("../web/server/auth.mjs");
    auth = await createAuth();
    console.log("Authentication service created.");

    console.log("Stage 3: Creating plant database pool...");
    const { poolFromEnvironment } = require("./database.cjs");
    pool = poolFromEnvironment();

    console.log("Stage 4: Checking required plant tables...");
    await pool.query("SELECT plant_id,registered_subject,rbac_status,qr_token FROM plant_record LIMIT 0");
    await pool.query("SELECT species_id,rbac_data FROM species LIMIT 0");
    await pool.query("SELECT id,owner_subject,revision FROM plant_observation LIMIT 0");

    console.log("SUCCESS: All startup checks passed.");
  } catch (error) {
    console.error("FAILED:", error.message);
    console.error("Error code:", error.code || "No error code");
    console.error("Error name:", error.name);
  } finally {
    if (pool) await pool.end().catch(() => {});
    if (auth?.db) await auth.db.close().catch(() => {});
  }
}

main();
