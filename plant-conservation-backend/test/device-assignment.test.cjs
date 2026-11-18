"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const express = require("express"), { once } = require("node:events");
const { createPlantDatabase } = require("./postgres-fixture.cjs");
const { identity, requirePermission } = require("../authorization.cjs");
const { mountIoT } = require("../iot.cjs");

test("Admin current device assignment validates Approved Plants atomically without rewriting alerts", async t => {
  const db = await createPlantDatabase(); t.after(() => db.end());
  await db.query(`INSERT INTO species(scientific_name) VALUES('Isolated assignment species');
    INSERT INTO plant_record(plant_id,species_id,registered_subject,rbac_status,qr_token) VALUES
      (1,1,'fixture','Approved','one'),(2,1,'fixture','Approved','two'),
      (3,1,'fixture','Pending Review','three'),(4,1,'fixture','Rejected','four');
    INSERT INTO iot_device(id,name,plant_id,key_hash,device_type) VALUES
      ('sensor','Sensor',1,'fixture','Sensor'),('camera','Camera',1,'fixture','Camera');
    INSERT INTO threat_alert_history(id,device_id,metric,value) VALUES('old-alert','sensor','temperature',38)`);
  await db.query("UPDATE iot_device SET thresholds=$1 WHERE id='camera'", [{ temperature: 99 }]);
  const users = { admin: { id: 'admin', role: 'Administrator', status: 'Active', mustChangePassword: false },
    officer: { id: 'officer', role: 'Conservation Officer', status: 'Active', mustChangePassword: false },
    bot: { id: 'bot', role: 'Botanist', status: 'Active', mustChangePassword: false },
    inactive: { id: 'inactive', role: 'Administrator', status: 'Inactive', mustChangePassword: false } };
  const tokens = Object.fromEntries(Object.keys(users).map((u, i) => [u, String(i + 1).repeat(64)]));
  const auth = { session: async token => users[Object.keys(tokens).find(u => tokens[u] === token)] || null, event: async () => {} };
  let failAudit = false;
  const pool = { query: (...args) => db.query(...args), connect: async () => {
    const c = await db.connect(); return { release: () => c.release(), query: (sql, args) => {
      if (failAudit && sql.includes('business_audit')) { failAudit = false; throw Error('isolated audit failure'); }
      return c.query(sql, args);
    } };
  } };
  const app = express(); app.use(express.json(), identity(auth)); mountIoT(app, { pool, allow: p => requirePermission(auth, p) });
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const call = async (path, method = 'GET', body, user = 'admin') => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method,
      headers: { ...(tokens[user] ? { Authorization: `Bearer ${tokens[user]}` } : {}), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, body: await r.json() };
  };
  await t.test('register supports approved Plant and omitted/null unassigned, retaining type contracts', async () => {
    for (const extra of [{ plant_id: '2' }, {}, { plant_id: null, device_type: 'Camera' }]) {
      const r = await call('/devices', 'POST', { name: 'Fixture device', ...extra }); assert.equal(r.status, 201);
      const row = (await db.query('SELECT * FROM iot_device WHERE id=$1', [r.body.id])).rows[0];
      assert.equal(row.plant_id, extra.plant_id === '2' ? 2 : null);
      assert.equal(row.device_type, extra.device_type || 'Sensor'); assert.equal(row.status, 'Active');
    }
  });
  await t.test('edit assigns Sensor and Camera, omitted field preserves, null explicitly unassigns', async () => {
    for (const id of ['sensor', 'camera']) {
      assert.equal((await call('/devices/' + id, 'PATCH', { name: 'Renamed', status: 'Inactive', plant_id: 2 })).status, 200);
      assert.equal((await call('/devices/' + id, 'PATCH', { name: 'Renamed again', status: 'Inactive' })).status, 200);
      const row = (await db.query('SELECT * FROM iot_device WHERE id=$1', [id])).rows[0];
      assert.equal(row.plant_id, 2); assert.equal(row.status, 'Inactive');
      assert.equal((await call('/devices/' + id, 'PATCH', { name: 'Renamed again', status: 'Inactive', plant_id: null })).status, 200);
      assert.equal((await db.query('SELECT plant_id FROM iot_device WHERE id=$1', [id])).rows[0].plant_id, null);
    }
    assert.deepEqual((await db.query("SELECT thresholds FROM iot_device WHERE id='camera'")).rows[0].thresholds, { temperature: 99 });
  });
  await t.test('invalid, nonexistent and unapproved assignments reject create/edit without partial changes', async () => {
    const before = (await db.query("SELECT * FROM iot_device WHERE id='sensor'")).rows[0];
    const count = (await db.query('SELECT count(*)::int AS n FROM iot_device')).rows[0].n;
    for (const plant_id of [0, -1, '', false, [], {}, '1 OR 1=1', 1.5, 2147483648, 999, 3, 4]) {
      assert.equal((await call('/devices', 'POST', { name: 'Invalid', plant_id })).status, 400);
      assert.equal((await call('/devices/sensor', 'PATCH', { name: 'Must roll back', status: 'Active', plant_id })).status, 400);
    }
    assert.deepEqual((await db.query("SELECT * FROM iot_device WHERE id='sensor'")).rows[0], before);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM iot_device')).rows[0].n, count);
    // Existing historical/unapproved links survive name-only saves, but cannot be newly selected.
    await db.query("UPDATE iot_device SET plant_id=3 WHERE id='sensor'");
    assert.equal((await call('/devices/sensor', 'PATCH', { name: 'Keep historical link', status: 'Inactive' })).status, 200);
    assert.equal((await db.query("SELECT plant_id FROM iot_device WHERE id='sensor'")).rows[0].plant_id, 3);
  });
  await t.test('non-Admins and invalid sessions cannot write assignments', async () => {
    for (const user of ['officer', 'bot', 'inactive', 'guest']) {
      const expected = user === 'guest' ? 401 : 403;
      assert.equal((await call('/devices', 'POST', { name: 'Forbidden', plant_id: 1 }, user)).status, expected);
      assert.equal((await call('/devices/sensor', 'PATCH', { name: 'Forbidden', status: 'Active', plant_id: 1 }, user)).status, expected);
    }
  });
  await t.test('failure after the update rolls back name, status and Plant together', async () => {
    const before = (await db.query("SELECT * FROM iot_device WHERE id='sensor'")).rows[0];
    failAudit = true;
    assert.equal((await call('/devices/sensor', 'PATCH', { name: 'Must not persist', status: 'Active', plant_id: 2 })).status, 500);
    assert.deepEqual((await db.query("SELECT * FROM iot_device WHERE id='sensor'")).rows[0], before);
  });
  await t.test('sensor thresholds and old alert evidence survive; Officer reads the updated current link', async () => {
    const old = (await db.query("SELECT * FROM threat_alert_history WHERE id='old-alert'")).rows[0];
    assert.equal((await call('/devices/sensor/thresholds', 'PATCH', { thresholds: { temperature: 31, humidity: 80 } })).status, 200);
    await call('/devices/sensor', 'PATCH', { name: 'Sensor', status: 'Active', plant_id: 2 });
    assert.deepEqual((await db.query("SELECT thresholds FROM iot_device WHERE id='sensor'")).rows[0].thresholds, { temperature: 31, humidity: 80 });
    assert.deepEqual((await db.query("SELECT * FROM threat_alert_history WHERE id='old-alert'")).rows[0], old);
    const context = await call('/alerts/old-alert/context', 'GET', undefined, 'officer');
    assert.equal(context.status, 200); assert.equal(context.body.current_assignment.plant_id, '2');
    assert.equal(context.body.current_assignment.basis, 'current_device_assignment');
    assert.equal((await call('/devices/missing', 'PATCH', { name: 'Missing', status: 'Active', plant_id: null })).status, 404);
  });
});
