"use strict";
const test = require('node:test'), assert = require('node:assert/strict');
const { once } = require('node:events'), { readFileSync } = require('node:fs'), { join } = require('node:path');
const { createPlantDatabase } = require('./postgres-fixture.cjs');
const { createPlantApp } = require('../server.js');
const { generateIoTSummary } = require('../iot-summary-report.cjs');
const { range, validateThresholds, violation } = require('../sensor-thresholds.cjs');
const migration = readFileSync(join(__dirname, '../migrations/034-sensor-alert-evidence.sql'), 'utf8');

test('threshold ranges preserve legacy maxima, exact boundaries, optional limits and validation', () => {
  assert.deepEqual(range(0), { max: 0 }); assert.equal(violation(0, range(0)), null);
  assert.equal(violation(-1, range({ min: 0 })), 'low');
  assert.equal(violation(1, range(0)), 'high');
  for (const limits of [{ min: 20, max: 30 }, { min: 20 }, { max: 30 }]) assert.equal(violation(25, range(limits)), null);
  for (const limits of [{ min: 40, max: 30 }, {}, { min: null }, { min: '1' }, { max: Infinity }, { low: 1 }])
    assert.throws(() => validateThresholds({ temperature: limits }), error => error.status === 400);
  assert.throws(() => validateThresholds({ unknown: 1 }));
  assert.deepEqual(validateThresholds({ temperature: null, humidity: { max: 80 } }), { temperature: null, humidity: { max: 80 } });
});

test('registered multi-sensor device saves immutable event-only evidence and independent ranges without changing reports', async t => {
  const db = await createPlantDatabase(); t.after(() => db.end());
  await db.query(migration); // Disposable PGlite only; never the configured application database.
  await db.query(`INSERT INTO species(scientific_name) VALUES('Evidence fixture');
    INSERT INTO plant_record(plant_id,species_id,registered_subject,rbac_status,qr_token) VALUES
    (1,1,'fixture','Approved','one'),(2,1,'fixture','Approved','two')`);
  const auth = { session: async token => ({ id: token[0] === 'a' ? 'admin' : 'officer', role: token[0] === 'a' ? 'Administrator' : 'Conservation Officer', status: 'Active', mustChangePassword: false }), event: async () => {} };
  const server = createPlantApp({ pool: db, auth, origins: new Set() }).listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = 'http://127.0.0.1:' + server.address().port + '/api';
  const call = async (path, method = 'GET', body, credential = 'Bearer ' + 'a'.repeat(64)) => {
    const response = await fetch(base + path, { method, headers: { Authorization: credential, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const registration = await call('/devices', 'POST', { name: 'Multi-sensor fixture', plant_id: 1 });
  assert.equal(registration.status, 201);
  const id = registration.body.id, key = registration.body.provisioningKey;
  const configure = thresholds => call('/devices/' + id + '/thresholds', 'PATCH', { thresholds });
  assert.equal((await configure({ temperature: { min: 20, max: 30 } })).status, 200);
  assert.equal((await configure({ humidity: { min: 40, max: 80 } })).status, 200);
  assert.deepEqual((await db.query('SELECT thresholds FROM iot_device WHERE id=$1', [id])).rows[0].thresholds,
    { temperature: { min: 20, max: 30 }, humidity: { min: 40, max: 80 } });
  assert.equal((await configure({ temperature: { min: 40, max: 20 } })).status, 400);
  assert.equal((await call('/devices/' + id + '/thresholds', 'PATCH', { thresholds: { temperature: 3 } }, 'Bearer ' + 'b'.repeat(64))).status, 403);
  const sample = (minute, temperature, humidity) => ({ device_id: id, client_key: 'sample-' + minute, values: { temperature, humidity, movement: 0, soilMoisture: 2000 },
    capture: { observed_at: `2026-11-21T00:${String(minute).padStart(2, '0')}:00.000Z`, mpu_connected: true } });
  const send = body => call('/device/readings', 'POST', body, 'Device ' + key);
  for (const values of [[1,20,80],[2,35,30],[3,36,31],[4,10,90],[5,25,60],[6,40,60]]) assert.equal((await send(sample(...values))).status, 201);
  const replay = await send(sample(2,35,30)); assert.equal(replay.status, 201); assert.equal(replay.body.recorded, false);
  let alerts = (await db.query('SELECT * FROM threat_alert_history WHERE device_id=$1 ORDER BY created_at,id', [id])).rows;
  assert.equal(alerts.length, 5, 'repeated violation suppresses alerts; high-to-low and normal-to-high re-arm');
  const original = alerts.find(alert => alert.metric === 'temperature' && alert.value === 35);
  assert.equal(original.reading_id, null);
  assert.deepEqual(original.sensor_evidence.values, sample(2,35,30).values);
  assert.deepEqual(original.sensor_evidence.limits, { min: 20, max: 30 });
  assert.equal(original.sensor_evidence.plant_id, '1'); assert.equal(original.sensor_evidence.direction, 'high');
  assert.equal(original.sensor_evidence.captured_at, sample(2,35,30).capture.observed_at);
  assert.equal((await configure({ temperature: { min: 0, max: 99 } })).status, 200);
  assert.equal((await call('/devices/' + id, 'PATCH', { name: 'Reassigned', status: 'Active', plant_id: 2 })).status, 200);
  assert.equal((await send(sample(12,40,60))).status, 201);
  const context = await call('/alerts/' + original.id + '/context', 'GET', undefined, 'Bearer ' + 'b'.repeat(64));
  assert.equal(context.status, 200); assert.equal(context.body.current_assignment.plant_id, '2');
  assert.equal(context.body.plant_at_detection.plant_id, '1');
  assert.deepEqual(context.body.historical_threshold, { min: 20, max: 30, direction: 'high', limit: 30 });
  assert.equal(context.body.reading.basis, 'alert_snapshot'); assert.deepEqual(context.body.reading.values, sample(2,35,30).values);
  assert.equal((await call('/devices/' + id + '/readings?page=1&limit=1')).body.thresholds.temperature.max, 99);
  await assert.rejects(db.query("UPDATE threat_alert_history SET sensor_evidence=sensor_evidence||'{\"plant_id\":\"2\"}' WHERE id=$1", [original.id]), /immutable/);
  await assert.rejects(db.query('UPDATE threat_alert_history SET value=999 WHERE id=$1', [original.id]), /immutable/);
  assert.equal((await call('/alerts/' + original.id + '/responses', 'POST', { note: 'Inspected saved evidence', status: 'Reviewing' }, 'Bearer ' + 'b'.repeat(64))).status, 200);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM sensor_reading WHERE device_id=$1', [id])).rows[0].n, 0);
  const report = await generateIoTSummary(db, { contractVersion: '1', device: id, period: 'all-time', measurement: 'temperature' });
  assert.equal(report.summary.receivedRows, 7); assert.equal(report.summary.average, 206/7);
  assert.equal(report.temperatureThreshold, 99); assert.equal(report.summary.minimum, 10); assert.equal(report.summary.maximum, 40);
  assert.deepEqual((await db.query('SELECT sensor_evidence FROM threat_alert_history WHERE id=$1', [original.id])).rows[0].sensor_evidence, original.sensor_evidence);
  assert.equal((await configure({ humidity: null })).status, 200);
  assert.deepEqual((await db.query('SELECT thresholds FROM iot_device WHERE id=$1', [id])).rows[0].thresholds, { temperature: { min: 0, max: 99 } });
  const camera = await call('/devices', 'POST', { name: 'Separate camera', device_type: 'Camera', plant_id: 2 });
  assert.equal(camera.status, 201);
  assert.equal((await call('/devices/' + camera.body.id + '/thresholds', 'PATCH', { thresholds: { temperature: { max: 1 } } })).status, 400);
  assert.equal((await call('/device/readings', 'POST', { device_id: camera.body.id, values: { temperature: 50 } }, 'Device ' + camera.body.provisioningKey)).status, 403);
});

test('pre-034 deployment keeps legacy maxima working and rejects range activation without partial changes', async t => {
  const db = await createPlantDatabase(); t.after(() => db.end());
  const { evidenceReady } = require('../sensor-thresholds.cjs');
  assert.equal(await evidenceReady(db), false);
  await db.query(`INSERT INTO iot_device(id,name,key_hash,thresholds) VALUES('legacy','Legacy','fixture','{"temperature":30}');
    INSERT INTO threat_alert_history(id,device_id,metric,value) VALUES('old','legacy','temperature',40)`);
  const auth = { session: async () => ({ id: 'admin', role: 'Administrator', status: 'Active', mustChangePassword: false }), event: async () => {} };
  const server = createPlantApp({ pool: db, auth, origins: new Set() }).listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const save = async thresholds => fetch('http://127.0.0.1:' + server.address().port + '/api/devices/legacy/thresholds', {
    method: 'PATCH', headers: { Authorization: 'Bearer ' + 'a'.repeat(64), 'Content-Type': 'application/json' }, body: JSON.stringify({ thresholds }) });
  assert.equal((await save({ temperature: { min: 10, max: 40 } })).status, 503);
  assert.deepEqual((await db.query("SELECT thresholds FROM iot_device WHERE id='legacy'")).rows[0].thresholds, { temperature: 30 });
  assert.equal((await save({ temperature: 35 })).status, 200);
  await db.query(migration);
  assert.equal(await evidenceReady(db), true);
  const row = (await db.query("SELECT * FROM threat_alert_history WHERE id='old'")).rows[0];
  assert.equal(row.sensor_evidence, null); assert.equal(row.value, 40);
  await assert.rejects(db.query("UPDATE threat_alert_history SET sensor_evidence='{}' WHERE id='old'"), /immutable/);
});
