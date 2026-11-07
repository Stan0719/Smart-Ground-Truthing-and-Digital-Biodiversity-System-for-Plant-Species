"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { createPlantDatabase } = require("./postgres-fixture.cjs");
const { transaction } = require("../domain.cjs");
const { configured, poolMax } = require("../database.cjs");
test("PostgreSQL starts empty and preserves relational constraints and rollback", async () => {
  const pool = await createPlantDatabase();
  try {
    assert.equal(
      (await pool.query("SELECT COUNT(*) AS n FROM species")).rows[0].n,
      0,
    );
    await assert.rejects(
      transaction(pool, async (c) => {
        await c.query(
          "INSERT INTO species(scientific_name) VALUES('rollback')",
        );
        throw Error("rollback");
      }),
    );
    assert.equal(
      (await pool.query("SELECT COUNT(*) AS n FROM species")).rows[0].n,
      0,
    );
    await assert.rejects(
      pool.query(
        "INSERT INTO plant_record(species_id,registered_subject,qr_token) VALUES(999,'staff:test','invalid')",
      ),
      { code: "23503" },
    );
  } finally {
    await pool.end();
  }
});
test("PostgreSQL configuration recognizes connection URLs and local fallback settings", () => {
  assert.equal(
    configured({ DATABASE_URL: "postgresql://u:p@localhost/db" }),
    true,
  );
  assert.equal(
    configured({ DB_HOST: "localhost", DB_NAME: "plants", DB_USER: "app" }),
    true,
  );
  assert.equal(configured({ PLANT_DB: "old.sqlite" }), false);
});
test("PostgreSQL pool limits use safe defaults and validated overrides", () => {
  assert.equal(poolMax({}, "PLANT_PG_POOL_MAX", 4), 4);
  assert.equal(poolMax({ PLANT_PG_POOL_MAX: "3" }, "PLANT_PG_POOL_MAX", 4), 3);
  assert.throws(
    () => poolMax({ PLANT_PG_POOL_MAX: "0" }, "PLANT_PG_POOL_MAX", 4),
    /integer from 1 to 100/,
  );
  assert.throws(
    () => poolMax({ PLANT_PG_POOL_MAX: "101" }, "PLANT_PG_POOL_MAX", 4),
    /integer from 1 to 100/,
  );
});
