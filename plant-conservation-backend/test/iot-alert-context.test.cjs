"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), express = require("express");
const { once } = require("node:events");
const { createPlantDatabase } = require("./postgres-fixture.cjs");
const { identity, requirePermission } = require("../authorization.cjs");
const { mountIoT } = require("../iot.cjs");
const { currentAssignment, readingContext } = require("../iot-alert-context.cjs");

test("exact alert context and bounded current assignments are authorized SELECT-only projections", async t => {
  const db = await createPlantDatabase(); t.after(() => db.end());
  await db.query(`INSERT INTO species(scientific_name) VALUES('Isolated species');
    INSERT INTO plant_record(species_id,registered_subject,qr_token) VALUES(1,'isolated','one'),(1,'isolated','two');
    INSERT INTO iot_device(id,name,plant_id,key_hash,device_type,thresholds) VALUES
      ('sensor-a','A',1,'fixture','Sensor','{"temperature":999}'),('sensor-b','B',2,'fixture','Sensor','{}'),
      ('unlinked','Unlinked',NULL,'fixture','Sensor','{}'),('camera','Camera',1,'fixture','Camera','{}'),('other-camera','Other camera',2,'fixture','Camera','{}');
    INSERT INTO sensor_reading(id,device_id,"values") VALUES
      ('frame-a','sensor-a','{"temperature":38,"humidity":72,"soilMoisture":2150,"movement":0,"rainfall":812,"sound":20,"_capture":{"observed_at":"2026-11-18T01:00:00Z"}}'),
      ('frame-b','sensor-b','{"temperature":999}'),('invalid-frame','sensor-a','{"temperature":"invalid"}');
    INSERT INTO threat_alert_history(id,device_id,reading_id,metric,value,camera_id) VALUES
      ('temperature-alert','sensor-a','frame-a','temperature',38,NULL),('humidity-alert','sensor-a','frame-a','humidity',72,NULL),
      ('mismatch','sensor-a','frame-b','temperature',999,NULL),('missing','sensor-a',NULL,'temperature',38,NULL),
      ('trigger-mismatch','sensor-a','frame-a','temperature',39,NULL),('invalid','sensor-a','invalid-frame','temperature',38,NULL),
      ('unlinked-alert','unlinked',NULL,'movement',1,NULL),('camera-alert','sensor-a',NULL,'possible_plant_contact',1,'camera'),
      ('camera-conflict','sensor-a',NULL,'possible_plant_contact',1,'other-camera');`);
  const users = { officer: { id: 'officer', role: 'Conservation Officer', status: 'Active', mustChangePassword: false },
    admin: { id: 'admin', role: 'Administrator', status: 'Active', mustChangePassword: false },
    botanist: { id: 'bot', role: 'Botanist', status: 'Active', mustChangePassword: false },
    inactive: { id: 'inactive', role: 'Conservation Officer', status: 'Inactive', mustChangePassword: false } };
  const tokens = Object.fromEntries(Object.keys(users).map((key, i) => [key, String(i + 1).repeat(64)]));
  const auth = { session: async token => users[Object.keys(tokens).find(key => tokens[key] === token)] || null, event: async () => {} };
  const queries = [], readOnly = { query: async (sql, values) => { assert.match(sql.trim(), /^SELECT\b/i); assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i); queries.push(sql); return db.query(sql, values) } };
  const app = express(); app.use(identity(auth)); mountIoT(app, { pool: readOnly, allow: permission => requirePermission(auth, permission) });
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: 'Request rejected' }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const get = async (path, user = 'officer') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/alerts/${path}`, { headers: tokens[user] ? { Authorization: `Bearer ${tokens[user]}` } : {} });
    return { status: response.status, body: await response.json() };
  };
  await t.test('Officer and Administrator read the exact grouped frame; current thresholds are never historical evidence', async () => {
    for (const user of ['officer','admin']) {
      const { status, body } = await get('temperature-alert/context', user);
      assert.equal(status, 200); assert.equal(body.alert.id, 'temperature-alert'); assert.equal(body.alert.value, 38);
      assert.equal(body.reading.id, 'frame-a'); assert.equal(body.reading.device_id, 'sensor-a'); assert.equal(body.reading.state, 'verified');
      assert.deepEqual(body.reading.values, { temperature: 38, humidity: 72, soilMoisture: 2150, movement: 0, rainfall: 812, sound: 20 });
      assert.equal(body.current_assignment.plant_id, '1'); assert.equal(body.current_assignment.basis, 'current_device_assignment');
      assert.equal(body.historical_threshold, null); assert.ok(!JSON.stringify(body).includes('999'));
      for (const key of ['latitude','longitude','owner_subject','thresholds','_capture']) assert.ok(!JSON.stringify(body).includes(`"${key}"`));
    }
  });
  await t.test('Guest, Botanist and inactive users cannot read context or assignment batches', async () => {
    for (const user of ['guest','botanist','inactive']) for (const path of ['temperature-alert/context','current-assignments?ids=temperature-alert'])
      assert.equal((await get(path, user)).status, user === 'guest' ? 401 : 403);
  });
  await t.test('mismatched, absent, malformed and inconsistent evidence exposes no substituted readings', async () => {
    for (const [id, expected] of [['mismatch','mismatched_device'],['missing','missing'],['trigger-mismatch','trigger_mismatch'],['invalid','invalid_values']]) {
      const { body } = await get(id + '/context'); assert.equal(body.reading.state, expected); assert.equal(body.reading.values, null);
    }
    assert.equal((await get('missing-alert/context')).status, 404);
  });
  await t.test('verified null links remain distinct from conflicting or unavailable assignments', async () => {
    assert.equal((await get('unlinked-alert/context')).body.current_assignment.state, 'not_linked');
    assert.equal((await get('camera-alert/context')).body.current_assignment.state, 'verified');
    assert.equal((await get('camera-alert/context')).body.reading.state, 'missing');
    assert.equal((await get('camera-conflict/context')).body.current_assignment.state, 'unavailable');
    assert.equal(currentAssignment({ device_id: 'missing-device', verified_device_id: null }).state, 'unavailable');
    assert.equal(readingContext({ device_id: 'missing-device', verified_device_id: null }).state, 'missing_device');
  });
  await t.test('exact identities are parameterized and batches use one bounded query', async () => {
    const previous = queries.length;
    const result = await get('current-assignments?ids=temperature-alert,humidity-alert,unlinked-alert,camera-conflict');
    assert.equal(result.body.assignments.length, 4); assert.equal(queries.length, previous + 1);
    assert.equal(result.body.assignments.find(row => row.alert_id === 'camera-conflict').state, 'unavailable');
    assert.equal((await get('bad%20id/context')).status, 400);
    assert.equal((await get('temperature-alert/context?latest=true')).status, 400);
    assert.equal((await get('current-assignments?ids=' + Array(51).fill('temperature-alert').join(','))).status, 400);
    assert.equal((await get('current-assignments?ids=bad%27id')).status, 400);
  });
  await t.test('independent alerts share a frame without merging statuses/history or performing writes', async () => {
    assert.equal((await get('humidity-alert/context')).body.reading.id, 'frame-a');
    const state = await db.query('SELECT id,status FROM threat_alert_history ORDER BY id');
    assert.ok(state.rows.every(row => row.status === 'New'));
    assert.equal((await db.query('SELECT count(*)::int AS n FROM threat_response')).rows[0].n, 0);
  });
});
