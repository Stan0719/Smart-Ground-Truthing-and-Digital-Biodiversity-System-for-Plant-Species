"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto"), { once } = require("node:events");
const { readFileSync } = require("node:fs"), { join } = require("node:path");
const { createPlantDatabase } = require("./postgres-fixture.cjs");
const { createPlantApp } = require("../server.js");
const key = "a".repeat(64);
async function server(t, pool) {
  const instance = createPlantApp({ pool, auth: { session: async () => null }, origins: new Set() }).listen(0, "127.0.0.1");
  await once(instance, "listening");
  t.after(() => new Promise(resolve => { instance.closeAllConnections(); instance.close(resolve); }));
  return async (clientKey, values, capture, device = "retry-device") => {
    const r = await fetch("http://127.0.0.1:" + instance.address().port + "/api/device/readings", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Device " + key },
      body: JSON.stringify({ device_id: device, client_key: clientKey, values, ...(capture ? { capture } : {}) }),
    });
    return { status: r.status, body: await r.json() };
  };
}
async function fixture(t) {
  const pool = await createPlantDatabase(); t.after(() => pool.end());
  await pool.query("INSERT INTO iot_device(id,name,key_hash,device_type,thresholds) VALUES($1,$1,$2,'Sensor',$3),('other-device','Other',$2,'Sensor','{}')", ["retry-device", createHash("sha256").update(key).digest("hex"), { temperature: 25 }]);
  return pool;
}
test("durable Sensor keys survive exact retries, equal clocks, cutover and another worker without raw writes", async t => {
  const pool = await fixture(t);
  for (const file of ['004-species-requests.sql', '006-atomic-plant-submissions.sql', '008-record-change-submissions.sql', '009-record-version-history.sql', '013-staff-notification-foundation.sql', '016-species-request-content-revision.sql', '017-species-review-cycle.sql', '021-observation-edit-requests.sql', '022-cancel-edit-requests.sql', '024-record-change-review-events.sql', '025-original-plant-withdrawal.sql', '026-original-species-withdrawal.sql', '027-original-observation-withdrawal.sql', '028-immutable-record-version-revisions.sql', '029-observation-submission-versions.sql', '030-observation-edit-officer-notifications.sql', '031-iot-live-reading-aggregates.sql', '032-canonical-threat-officer-notifications.sql', '033-iot-sensor-retry-identity.sql']) await pool.query(readFileSync(join(__dirname, "../migrations", file), "utf8"));
  await pool.query("ALTER TABLE iot_reading_aggregate ADD COLUMN IF NOT EXISTS metrics JSONB NOT NULL DEFAULT '{}'::jsonb");
  const send = await server(t, pool);
  const realNow = Date.now; let clock = Date.parse("2026-11-18T00:01:00Z"); Date.now = () => clock; t.after(() => { Date.now = realNow; });
  const count = async () => Number((await pool.query("SELECT sample_count FROM iot_reading_checkpoint WHERE device_id='retry-device'")).rows[0].sample_count);
  const alerts = async () => Number((await pool.query("SELECT COUNT(*) AS n FROM threat_alert_history")).rows[0].n);
  assert.deepEqual(await send("one", { temperature: 35, humidity: 60 }), { status: 201, body: { recorded: true, live: true } });
  assert.deepEqual(await send("one", { humidity: 60, temperature: 35 }), { status: 201, body: { recorded: false, live: true } });
  assert.equal(await count(), 1); assert.equal(await alerts(), 1);
  assert.equal((await send("two", { temperature: 35 })).body.recorded, true, "distinct key at identical clock is a new sample");
  assert.equal(await count(), 2);
  assert.equal((await send("one", { temperature: 36, humidity: 60 })).status, 409);
  clock += 600000;
  assert.equal((await send("three", { temperature: 20 })).body.recorded, true);
  assert.equal(Number((await pool.query("SELECT sample_count FROM iot_reading_aggregate WHERE device_id='retry-device'")).rows[0].sample_count), 2);
  const otherWorker = await server(t, { query: (...args) => pool.query(...args), connect: () => pool.connect() });
  assert.equal((await otherWorker("one", { temperature: 35, humidity: 60 })).body.recorded, false);
  assert.equal((await otherWorker("one", { temperature: 36, humidity: 60 })).status, 409);
  assert.equal(await count(), 1); assert.equal(await alerts(), 1);
  assert.equal((await otherWorker("four", { temperature: 36 })).body.recorded, true);
  assert.equal(await count(), 2); assert.equal(await alerts(), 2);
  const capture = { observed_at: new Date(clock + 1000).toISOString(), mpu_connected: true };
  assert.equal((await send("captured", { temperature: 36 }, capture)).body.recorded, true);
  assert.equal((await otherWorker("captured", { temperature: 36 }, capture)).body.recorded, false);
  assert.equal((await otherWorker("same-time-other-key", { temperature: 36 }, capture)).body.recorded, false);
  assert.equal((await otherWorker("same-time-other-key", { temperature: 20 }, capture)).status, 409);
  assert.equal(await count(), 3);
  assert.equal((await send("one", { temperature: 10 }, undefined, "other-device")).body.recorded, true, "key scope is per device");
  assert.equal((await send("before-rollback", { temperature: 10 })).body.recorded, true);
  const notifications = async () => Number((await pool.query("SELECT COUNT(*) AS n FROM staff_notification_event WHERE resource_kind='threat_alert'")).rows[0].n);
  assert.equal(await notifications(), 2);
  await pool.query(`CREATE FUNCTION reject_retry_fixture() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.client_key='rollback' THEN RAISE EXCEPTION 'synthetic receipt failure'; END IF; RETURN NEW; END$$;
    CREATE TRIGGER reject_retry_fixture BEFORE INSERT ON iot_sensor_receipt FOR EACH ROW EXECUTE FUNCTION reject_retry_fixture()`);
  assert.equal((await send("rollback", { temperature: 40 })).status, 503);
  assert.equal(await count(), 4); assert.equal(await alerts(), 2); assert.equal(await notifications(), 2);
  assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM iot_sensor_receipt WHERE client_key='rollback'")).rows[0].n, 0);
  await pool.query("DROP TRIGGER reject_retry_fixture ON iot_sensor_receipt");
  assert.equal((await otherWorker("rollback", { temperature: 40 })).body.recorded, true);
  const simultaneous = await Promise.all([send("five", { temperature: 20 }), otherWorker("six", { temperature: 20 })]);
  assert.ok(simultaneous.every(r => r.status === 201 && r.body.recorded)); assert.equal(await count(), 7); assert.equal(await alerts(), 3); assert.equal(await notifications(), 3);
  const race = await Promise.all([send("same-key-race", { temperature: 20 }), otherWorker("same-key-race", { temperature: 20 })]);
  assert.deepEqual(race.map(r => r.body.recorded).sort(), [false, true]); assert.equal(await count(), 8);
  assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM sensor_reading")).rows[0].n, 0);
});

test("033 upgrades additively, legacy receipt identity stays valid, and missing migration fails closed", async t => {
  const pool = await fixture(t), send = await server(t, pool);
  await pool.query("DROP TABLE iot_sensor_receipt");
  assert.equal((await send("missing-migration", { temperature: 35 })).status, 503);
  assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM iot_reading_checkpoint")).rows[0].n, 0);
  assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM threat_alert_history")).rows[0].n, 0);
  await pool.query("INSERT INTO sensor_reading(id,device_id,\"values\") VALUES('legacy','retry-device',$1)", [{ temperature: 35 }]);
  await pool.query("INSERT INTO iot_ingestion_receipt VALUES('retry-device','legacy-key','legacy')");
  await pool.query(readFileSync(join(__dirname, "../migrations/031-iot-live-reading-aggregates.sql"), "utf8"));
  await pool.query(readFileSync(join(__dirname, "../migrations/033-iot-sensor-retry-identity.sql"), "utf8"));
  assert.equal((await send("legacy-key", { temperature: 35 })).body.recorded, false);
  assert.equal((await send("legacy-key", { temperature: 36 })).status, 409);
  assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM sensor_reading")).rows[0].n, 1);
  assert.equal((await pool.query("SELECT relrowsecurity FROM pg_class WHERE oid='plant_app.iot_sensor_receipt'::regclass")).rows[0].relrowsecurity, true);
  await assert.rejects(pool.query("INSERT INTO iot_sensor_receipt VALUES('retry-device','bad','invalid',CURRENT_TIMESTAMP,DEFAULT)"));
});
