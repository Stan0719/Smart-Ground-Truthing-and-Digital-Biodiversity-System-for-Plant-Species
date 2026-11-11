"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { createHash, randomUUID } = require("node:crypto");
const { createPlantDatabase } = require("./postgres-fixture.cjs");
const { createPlantApp } = require("../server.js");

test("camera gate reads only fresh, connected MPU state from its assigned sensor", async (t) => {
  const pool = await createPlantDatabase();
  t.after(() => pool.end());
  await pool.query("INSERT INTO species(scientific_name) VALUES('Synthetic species')");
  await pool.query("INSERT INTO plant_record(species_id,registered_subject,qr_token) VALUES(1,'test','one'),(1,'test','two')");
  const key = "a".repeat(64);
  await pool.query("INSERT INTO iot_device(id,name,plant_id,key_hash,device_type) VALUES($1,$2,1,$3,'Sensor')",
    ["test-sensor", "Synthetic sensor", createHash("sha256").update(key).digest("hex")]);
  const app = createPlantApp({ pool, auth: { session: async () => null, event: async () => {} } });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const path = "/api/device/movement?device_id=test-sensor&plant_id=1";
  const headers = { Authorization: `Device ${key}` };
  const get = async (suffix = path, auth = headers) => {
    const response = await fetch(base + suffix, { headers: auth });
    return { status: response.status, body: await response.json() };
  };
  const reading = async (movement, capture, clientKey = randomUUID(), clear = true) => {
    if (clear) {
      await pool.query("DELETE FROM iot_ingestion_receipt");
      await pool.query("DELETE FROM sensor_reading");
    }
    await pool.query("UPDATE iot_device SET last_seen=NULL");
    const response = await fetch(base + "/api/device/readings", {
      method: "POST", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: "test-sensor", values: { movement },
        client_key: clientKey, ...(capture === undefined ? {} : { capture }) }),
    });
    assert.equal(response.status, 201, await response.text());
    return clientKey;
  };
  const capture = (age = 0, connected = true) => ({
    observed_at: new Date(Date.now() - age).toISOString(), mpu_connected: connected,
  });

  await t.test("missing/wrong keys, wrong plants and disabled sensors cannot open the gate", async () => {
    assert.equal((await get(path, {})).status, 401);
    assert.equal((await get(path, { Authorization: `Device ${"b".repeat(64)}` })).status, 401);
    assert.equal((await get(path.replace("plant_id=1", "plant_id=2"))).status, 403);
    await pool.query("UPDATE iot_device SET status='Inactive'");
    assert.equal((await get()).status, 401);
    await pool.query("UPDATE iot_device SET status='Active'");
    assert.equal((await get()).body.status, "unavailable");
  });
  await t.test("fresh movement and no-movement reach the camera as distinct states", async () => {
    await reading(1, capture());
    let result = await get();
    assert.equal(result.status, 200);
    assert.equal(result.body.plantId, "1");
    assert.equal(result.body.status, "moving");
    assert.equal(result.body.movement, 1);
    await reading(0, capture());
    result = await get();
    assert.equal(result.body.status, "stationary");
    assert.equal(result.body.movement, 0);
  });
  await t.test("disconnected and legacy readings remain unavailable", async () => {
    await reading(1, capture(0, false));
    assert.equal((await get()).body.movement, null);
    await reading(1, undefined);
    assert.equal((await get()).body.status, "unavailable");
  });
  await t.test("old queued movement does not become live after upload or retry", async () => {
    const id = await reading(1, capture(30000));
    assert.equal((await get()).body.status, "stale");
    await reading(1, capture(), id, false);
    const result = (await get()).body;
    assert.equal(result.status, "stale");
    assert.equal(result.movement, null);
    assert.equal((await pool.query("SELECT COUNT(*)::integer AS count FROM sensor_reading")).rows[0].count, 1);
  });
  await t.test("stale database receipts and future-dated samples cannot open the gate", async () => {
    await reading(1, capture());
    await pool.query("UPDATE sensor_reading SET created_at=CURRENT_TIMESTAMP-INTERVAL '30 seconds'");
    assert.equal((await get()).body.status, "stale");
    await reading(1, capture(-30000));
    assert.equal((await get()).body.status, "stale");
  });
});
