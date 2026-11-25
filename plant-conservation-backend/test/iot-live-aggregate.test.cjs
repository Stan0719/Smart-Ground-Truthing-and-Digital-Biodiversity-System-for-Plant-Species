"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { createPlantDatabase, installIoTLiveReadingAggregates } = require("./postgres-fixture.cjs");
const { createPlantApp } = require("../server.js");
const { generateOperationalReport } = require("../operational-reports.cjs");

test("live IoT readings stay in memory while completed 10-minute windows are aggregated", async t => {
  const pool = await createPlantDatabase();
  t.after(() => pool.end());
  await installIoTLiveReadingAggregates(pool);
  await pool.query("INSERT INTO species(scientific_name) VALUES('Synthetic species')");
  await pool.query("INSERT INTO plant_record(species_id,registered_subject,qr_token) VALUES(1,'test','one')");
  const deviceId = "11111111-1111-4111-8111-111111111111";
  const key = "a".repeat(64);
  await pool.query("INSERT INTO iot_device(id,name,plant_id,key_hash,device_type,thresholds) VALUES($1,$2,1,$3,'Sensor',$4)",
    [deviceId, "Live sensor", createHash("sha256").update(key).digest("hex"), { temperature: 25 }]);
  await pool.query('INSERT INTO sensor_reading(id,device_id,"values",created_at) VALUES($1,$2,$3,$4)',
    ["legacy-reading", deviceId, { temperature: 10 }, "2026-11-18T00:00:00Z"]);

  const auth = {
    session: async () => ({ id: "officer", role: "Conservation Officer", status: "Active", mustChangePassword: false }),
    event: async () => {},
  };
  const server = createPlantApp({ pool, auth, origins: new Set() }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  const base = "http://127.0.0.1:" + server.address().port;

  const send = async (temperature, observedAt) => {
    const response = await fetch(base + "/api/device/readings", {
      method: "POST",
      headers: { Authorization: "Device " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        device_id: deviceId,
        client_key: randomUUID(),
        values: { temperature, humidity: 60, soilMoisture: 2000, rainfall: 0, movement: 0 },
        capture: { observed_at: observedAt, mpu_connected: true, dht_status: "Operational" },
      }),
    });
    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));
    return body;
  };

  const t1 = "2026-11-18T00:01:00.000Z";
  const t2 = "2026-11-18T00:02:00.000Z";
  const t3 = "2026-11-18T00:11:00.000Z";
  assert.deepEqual(await send(20, t1), { recorded: true, live: true });
  assert.deepEqual(await send(22, t2), { recorded: true, live: true });
  assert.deepEqual(await send(24, t3), { recorded: true, live: true });

  const duplicate = await fetch(base + "/api/device/readings", {
    method: "POST",
    headers: { Authorization: "Device " + key, "Content-Type": "application/json" },
    body: JSON.stringify({
      device_id: deviceId, client_key: randomUUID(),
      values: { temperature: 24, humidity: 60, soilMoisture: 2000, rainfall: 0, movement: 0 },
      capture: { observed_at: t3, mpu_connected: true, dht_status: "Operational" },
    }),
  });
  assert.deepEqual(await duplicate.json(), { recorded: false, live: true });
  assert.deepEqual(await send(30, "2026-11-18T00:12:00.000Z"), { recorded: true, live: true });
  assert.deepEqual(await send(31, "2026-11-18T00:13:00.000Z"), { recorded: true, live: true });
  assert.deepEqual(await send(20, "2026-11-18T00:14:00.000Z"), { recorded: true, live: true });
  assert.deepEqual(await send(31, "2026-11-18T00:15:00.000Z"), { recorded: true, live: true });

  const aggregates = (await pool.query(
    "SELECT bucket_start,bucket_end,sample_count,metrics FROM iot_reading_aggregate WHERE device_id=$1",
    [deviceId],
  )).rows;
  assert.equal(aggregates.length, 1);
  assert.equal(aggregates[0].sample_count, 2);
  assert.equal(aggregates[0].metrics.temperature.sum, 42);
  assert.equal(aggregates[0].metrics.temperature.count, 2);
  assert.equal(aggregates[0].metrics.temperature.min, 20);
  assert.equal(aggregates[0].metrics.temperature.max, 22);
  assert.equal((await pool.query("SELECT COUNT(*)::integer AS count FROM sensor_reading WHERE device_id=$1", [deviceId])).rows[0].count, 1);
  assert.equal((await pool.query("SELECT COUNT(*)::integer AS count FROM iot_ingestion_receipt WHERE device_id=$1", [deviceId])).rows[0].count, 0);
  const alerts = (await pool.query("SELECT metric,value,reading_id FROM threat_alert_history WHERE device_id=$1", [deviceId])).rows;
  assert.deepEqual(alerts.map(row => [row.metric, row.value, row.reading_id]), [["temperature", 30, null], ["temperature", 31, null]]);

  const sessionHeaders = { Authorization: "Bearer " + "b".repeat(64) };
  const latest = await fetch(base + "/api/devices/" + deviceId + "/readings?page=1&limit=1", { headers: sessionHeaders });
  assert.equal(latest.status, 200);
  const latestBody = await latest.json();
  assert.equal(latestBody.readings.length, 1);
  assert.equal(latestBody.readings[0].values.temperature, 31);
  assert.equal(latestBody.readings[0].values._capture.dht_status, "Operational");
  assert.equal(latestBody.hasMore, true);
  const all = await (await fetch(base + "/api/readings", { headers: sessionHeaders })).json();
  assert.equal(all.readings.length, 2);
  assert.ok(all.readings.some(row => row.id === "legacy-reading"));
  assert.ok(all.readings.some(row => row.values.temperature === 31));
  const devices = await (await fetch(base + "/api/devices", { headers: sessionHeaders })).json();
  assert.equal(devices.devices[0].latest_reading.values.temperature, 31);

  const report = await generateOperationalReport(pool, "iot", {
    period: "custom", start: "2026-11-18", end: "2026-11-18", device: deviceId, measurement: "temperature",
  });
  // One legacy sample, two completed-window samples and five active saved samples.
  assert.equal(report.rows.length, 3);
  assert.equal(report.statistics.find(item => item.key === "totalReadings").value, 8);
  assert.equal(report.statistics.find(item => item.key === "average").value, 188 / 8);
  assert.equal(report.statistics.find(item => item.key === "minimum").value, 10);
  assert.equal(report.statistics.find(item => item.key === "maximum").value, 31);
  assert.equal(report.statistics.find(item => item.key === "latestReading").value, "2026-11-18T00:15:00.000Z");
});

test("additive migration keeps old readings and allows alerts without reading snapshots", async t => {
  const { testPool } = await import("../../web/server/test-postgres.mjs");
  const pool = await testPool();
  t.after(() => pool.end());
  await pool.query(`CREATE SCHEMA plant_app;
    CREATE TABLE plant_app.iot_device(id TEXT PRIMARY KEY);
    CREATE TABLE plant_app.sensor_reading(id TEXT PRIMARY KEY);
    CREATE TABLE plant_app.threat_alert_history(
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES plant_app.iot_device(id),
      reading_id TEXT NOT NULL REFERENCES plant_app.sensor_reading(id),
      metric TEXT NOT NULL,
      value DOUBLE PRECISION NOT NULL
    );
    INSERT INTO plant_app.iot_device VALUES('device');
    INSERT INTO plant_app.sensor_reading VALUES('old-reading');
    INSERT INTO plant_app.threat_alert_history VALUES('old-alert','device','old-reading','temperature',30);`);
  const migration = readFileSync(join(__dirname, "../migrations/031-iot-live-reading-aggregates.sql"), "utf8");
  await pool.query(migration);
  await pool.query("INSERT INTO plant_app.threat_alert_history(id,device_id,reading_id,metric,value) VALUES('new-alert','device',NULL,'possible_plant_contact',1)");
  assert.equal((await pool.query("SELECT COUNT(*)::integer AS count FROM plant_app.sensor_reading")).rows[0].count, 1);
  assert.equal((await pool.query("SELECT reading_id FROM plant_app.threat_alert_history WHERE id='old-alert'")).rows[0].reading_id, "old-reading");
  assert.equal((await pool.query("SELECT reading_id FROM plant_app.threat_alert_history WHERE id='new-alert'")).rows[0].reading_id, null);
  assert.equal((await pool.query("SELECT to_regclass('plant_app.iot_reading_checkpoint') AS name")).rows[0].name, "plant_app.iot_reading_checkpoint");
  assert.equal((await pool.query("SELECT to_regclass('plant_app.iot_reading_aggregate') AS name")).rows[0].name, "plant_app.iot_reading_aggregate");
  assert.equal((await pool.query("SELECT relrowsecurity FROM pg_class WHERE oid='plant_app.iot_reading_checkpoint'::regclass")).rows[0].relrowsecurity, true);
  assert.equal((await pool.query("SELECT relrowsecurity FROM pg_class WHERE oid='plant_app.iot_reading_aggregate'::regclass")).rows[0].relrowsecurity, true);
});
