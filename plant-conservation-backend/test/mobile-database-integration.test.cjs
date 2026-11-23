"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createMobileTestDatabase } = require("./mobile-postgres-fixture.cjs");
const { readPlantSpeciesCounts } = require("../plant-list-page.cjs");

test("public Plant count applies approval and Species visibility in an isolated database", async (t) => {
  const db = await createMobileTestDatabase();
  t.after(() => db.close());
  await db.query("INSERT INTO species(species_id,scientific_name) VALUES (1,'Public'),(2,'Protected')");
  await db.query("INSERT INTO rbac_species_visibility(species_id,visibility) VALUES (1,'public'),(2,'protected')");
  await db.query(`INSERT INTO plant_record(plant_id,species_id,registered_subject,rbac_status,qr_token) VALUES
    (1,1,'staff:one','Approved','qr-1'),(2,1,'staff:one','Pending Review','qr-2'),
    (3,2,'staff:two','Approved','qr-3')`);
  assert.deepEqual((await readPlantSpeciesCounts(db, ["public"], false)).map((row) => row.count), [1]);
  const internal = await readPlantSpeciesCounts(db, ["public", "protected"], false);
  assert.deepEqual(internal.map((row) => [row.species_id, row.count]), [[1, 1], [2, 1]]);
});

test("Observation relationships, duplicate keys and rollback obey PostgreSQL constraints", async (t) => {
  const db = await createMobileTestDatabase();
  t.after(() => db.close());
  await db.query("INSERT INTO species(species_id,scientific_name) VALUES (1,'Public')");
  await db.query("INSERT INTO plant_record(plant_id,species_id,registered_subject,qr_token) VALUES (1,1,'staff:one','qr-1')");
  const insert = "INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key) VALUES ($1,$2,$3,$4,$5,$6)";
  await db.query(insert, ["one", 1, "staff:one", "Pending Review", { heightCm: 100 }, "client-1"]);
  await assert.rejects(db.query(insert, ["duplicate", 1, "staff:one", "Pending Review", {}, "client-1"]), { code: "23505" });
  await assert.rejects(db.query(insert, ["orphan", 999, "staff:one", "Pending Review", {}, "client-2"]), { code: "23503" });
  await db.query("BEGIN");
  await db.query(insert, ["rolled-back", 1, "staff:one", "Pending Review", {}, "client-3"]);
  await db.query("ROLLBACK");
  const rows = (await db.query("SELECT id,content FROM plant_observation ORDER BY id")).rows;
  assert.deepEqual(rows, [{ id: "one", content: { heightCm: 100 } }]);
});

test("each test database begins without records from another test", async (t) => {
  const db = await createMobileTestDatabase();
  t.after(() => db.close());
  assert.equal((await db.query("SELECT count(*)::integer AS n FROM plant_observation")).rows[0].n, 0);
});

test("Plant GPS constraints accept boundary and zero values but reject invalid coordinates", async (t) => {
  const db = await createMobileTestDatabase();
  t.after(() => db.close());
  await db.query("INSERT INTO species(species_id,scientific_name) VALUES (1,'Public')");
  await db.query("INSERT INTO plant_record(plant_id,species_id,registered_subject,qr_token) VALUES (1,1,'staff:one','qr-1')");
  const insert = "INSERT INTO plant_location(plant_id,latitude,longitude,accuracy_m) VALUES ($1,$2,$3,$4)";
  await db.query(insert, [1, 0, 0, 0]);
  await db.query(insert, [1, -90, 180, null]);
  for (const values of [[1, 90.01, 0, 1], [1, 0, -180.01, 1], [1, 1, 1, -1]])
    await assert.rejects(db.query(insert, values), { code: "23514" });
  assert.equal((await db.query("SELECT count(*)::integer AS n FROM plant_location")).rows[0].n, 2);
});
