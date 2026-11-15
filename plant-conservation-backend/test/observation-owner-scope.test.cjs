"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { createPlantDatabase } = require("./postgres-fixture.cjs");
const { createPlantApp } = require("../server.js");

test("observation creator can list and open a pending observation on another Botanist's plant", async (t) => {
  const pool = await createPlantDatabase();
  t.after(() => pool.end());
  await pool.query(`INSERT INTO species(scientific_name) VALUES('Public species');
    INSERT INTO rbac_species_visibility(species_id,visibility) VALUES(1,'public');
    INSERT INTO plant_record(plant_id,species_id,registered_subject,rbac_status,qr_token)
      VALUES(1,1,'staff:botA','Approved','owner-scope-plant');
    INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key)
      VALUES('11111111-1111-4111-8111-111111111111',1,'staff:botB','Pending Review','{"healthStatus":"Healthy"}','owner-scope-observation')`);
  const roles = { botA: "Botanist", botB: "Botanist", botC: "Botanist", officer: "Conservation Officer", visitor: "Visitor" };
  let authorNameAvailable = true;
  const tokens = Object.fromEntries(Object.keys(roles).map((key, index) => [key, String(index + 1).repeat(64)]));
  const auth = { session: async (token) => {
    const id = Object.keys(tokens).find((key) => tokens[key] === token);
    return id ? { id, role: roles[id], status: "Active", mustChangePassword: false } : null;
  }, event: async () => {}, db: { prepare: (sql) => {
    assert.equal(sql, "SELECT id,name,role FROM users WHERE id=?");
    return { get: async (id) => id === "botB" && authorNameAvailable ? { id, name: "Botanist B", role: "Botanist" } : null };
  } } };
  const server = createPlantApp({ pool, auth }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const observationId = "11111111-1111-4111-8111-111111111111";
  async function call(path, role) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      headers: { Authorization: `Bearer ${tokens[role]}` },
    });
    return { status: response.status, data: await response.json() };
  }
  assert.deepEqual((await call("/observations?scope=mine", "botB")).data.observations.map((row) => row.id), [observationId]);
  assert.deepEqual((await call("/observations?scope=mine", "botA")).data.observations, []);
  assert.deepEqual((await call("/observations?scope=mine", "botC")).data.observations, []);
  assert.equal((await call(`/observations/${observationId}`, "botB")).data.observation.owner_subject, "staff:botB");
  assert.equal((await call(`/observations/${observationId}`, "botA")).status, 404);
  assert.equal((await call(`/observations/${observationId}`, "botC")).status, 404);
  assert.equal((await call(`/observations/${observationId}`, "officer")).status, 200);
  await pool.query("UPDATE plant_observation SET status='Approved' WHERE id=$1", [observationId]);
  const approved = await call(`/observations/${observationId}`, "botA");
  assert.equal(approved.status, 200);
  assert.equal(approved.data.observation.recorded_by_name, "Botanist B");
  assert.equal(approved.data.observation.email, undefined);
  assert.equal((await call("/observations?limit=20", "botA")).data.observations[0].recorded_by_name, "Botanist B");
  authorNameAvailable = false;
  assert.equal((await call(`/observations/${observationId}`, "botA")).data.observation.recorded_by_name, null);
  await pool.query(`INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key)
    VALUES('22222222-2222-4222-8222-222222222222',1,'staff:botA','Approved','{}','later-approved')`);
  await pool.query(`INSERT INTO plant_asset(id,plant_id,owner_subject,client_key,observation_id,approved,content_type,content)
    VALUES('older-approved-photo',1,'staff:botB','older-photo',$1,TRUE,'image/jpeg',decode('ffd8ffd9','hex'))`, [observationId]);
  const assetResponse = (role) => fetch(`http://127.0.0.1:${server.address().port}/api/assets/older-approved-photo`, {
    headers: { Authorization: `Bearer ${tokens[role]}` },
  });
  assert.equal((await assetResponse("botA")).status, 200, "a Botanist can view an older approved field Observation photo");
  assert.equal((await assetResponse("visitor")).status, 404, "the older photo does not become publicly accessible");
  await pool.query("UPDATE plant_observation SET status='Rejected' WHERE id=$1", [observationId]);
  assert.equal((await assetResponse("botA")).status, 404, "a rejected Observation photo remains private");
});
