'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createPlantDatabase } = require('./postgres-fixture.cjs');
const { createPlantApp } = require('../server.js');

test('Botanist notifications return complete newest-first history and persist owner-scoped read state', async (t) => {
  const pool = await createPlantDatabase();
  t.after(() => pool.end());
  await pool.query(`
    CREATE TABLE botanist_notification(
      id TEXT PRIMARY KEY, recipient_subject TEXT NOT NULL, type TEXT NOT NULL, source_key TEXT NOT NULL,
      observation_id TEXT REFERENCES plant_observation(id) ON DELETE SET NULL,
      review_id TEXT REFERENCES observation_review(id) ON DELETE SET NULL,
      plant_id BIGINT REFERENCES plant_record(plant_id) ON DELETE SET NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      read_at TIMESTAMPTZ, UNIQUE(recipient_subject,source_key)
    );
    INSERT INTO species(species_id,scientific_name,common_name,rbac_data) VALUES(1,'Plantus testus','Test plant','{}');
    INSERT INTO rbac_species_visibility(species_id,visibility) VALUES(1,'public');
    INSERT INTO plant_record(plant_id,species_id,registered_subject,rbac_status,qr_token) VALUES(1,1,'staff:alice','Approved','test-qr');
    INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key) VALUES
      ('obs-reviewed',1,'staff:alice','Approved','{}','reviewed'),
      ('obs-pending',1,'staff:alice','Pending Review','{}','pending'),
      ('obs-draft',1,'staff:alice','Draft','{}','draft');
    INSERT INTO observation_review(id,observation_id,reviewer_subject,decision,comment,created_at)
      VALUES('review-existing','obs-reviewed','staff:officer','Approved','Reviewed details','2026-11-02T03:00:00Z');
    INSERT INTO botanist_notification(id,recipient_subject,type,source_key,observation_id,review_id,plant_id,created_at,read_at) VALUES
      ('review:review-existing','staff:alice','observation_approved','review:review-existing','obs-reviewed','review-existing',1,'2026-11-02T03:00:00Z','2026-11-02T03:10:00Z'),
      ('submission:pending','staff:alice','observation_submitted','submission:pending:1','obs-pending',NULL,1,'2026-11-03T03:00:00Z',NULL),
      ('private-bob','staff:bob','observation_submitted','submission:bob','obs-pending',NULL,1,'2026-11-03T04:00:00Z',NULL);
  `);
  const roles = { alice: 'Botanist', bob: 'Botanist', officer: 'Conservation Officer', visitor: 'Visitor' };
  const tokens = Object.fromEntries(Object.keys(roles).map((name, index) => [name, String(index + 1).repeat(64)]));
  const auth = {
    session: async (token) => {
      const id = Object.keys(tokens).find((name) => tokens[name] === token);
      return id ? { id, role: roles[id], status: 'Active', mustChangePassword: false } : null;
    },
    event: async () => {},
  };
  const server = createPlantApp({ pool, auth, origins: new Set() }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const call = async (path, user = 'alice', method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${tokens[user]}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };

  const initial = await call('/notifications');
  assert.equal(initial.status, 200);
  assert.equal(initial.data.notifications.length, 2);
  assert.deepEqual(initial.data.notifications.map((item) => item.id), ['submission:pending', 'review:review-existing']);
  assert.equal(initial.data.notifications[1].read, true);
  assert.equal(initial.data.notifications[1].comment, 'Reviewed details');
  assert.equal(initial.data.notifications.filter((item) => !item.read).length, 1);
  assert.deepEqual((await call('/notifications', 'bob')).data.notifications.map((item) => item.id), ['private-bob']);

  const one = await call('/notifications/read', 'alice', 'POST', { ids: ['submission:pending'] });
  assert.equal(one.data.updated, 1);
  assert.equal((await call('/notifications')).data.notifications.filter((item) => !item.read).length, 0);
  await call('/notifications/read', 'alice', 'POST', { all: true });
  await call('/notifications/read', 'alice', 'POST', { all: true });
  assert.equal((await call('/notifications', 'bob')).data.notifications[0].read, false);
  assert.equal((await call('/notifications/read', 'visitor', 'POST', { all: true })).status, 403);

  const sync = await call('/notifications/sync', 'alice', 'POST', { type: 'sync_failed', key: 'draft-9' });
  assert.equal(sync.status, 201);
  await call('/notifications/read', 'alice', 'POST', { ids: [sync.data.notification.id] });
  const repeat = await call('/notifications/sync', 'alice', 'POST', { type: 'sync_failed', key: 'draft-9' });
  assert.equal(repeat.data.notification.id, sync.data.notification.id);
  assert.equal(repeat.data.notification.read, true);

  const submitted = await call('/observations/obs-draft/submit', 'alice', 'POST', {});
  assert.equal(submitted.status, 200);
  assert.ok((await call('/notifications')).data.notifications.some((item) => item.type === 'observation_submitted' && item.observationId === 'obs-draft'));
  const reviewed = await call('/observations/obs-pending/review', 'officer', 'POST', { decision: 'Correction Required', comment: 'Please clarify the field notes.', revision: 1 });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.data));
  assert.ok((await call('/notifications')).data.notifications.some((item) => item.type === 'correction_requested' && item.observationId === 'obs-pending'));
});

test('notification history endpoints fail clearly before the approved table migration exists', async (t) => {
  const pool = await createPlantDatabase();
  t.after(() => pool.end());
  const auth = { session: async () => ({ id: 'alice', role: 'Botanist', status: 'Active', mustChangePassword: false }), event: async () => {} };
  const server = createPlantApp({ pool, auth, origins: new Set() }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/notifications`, { headers: { Authorization: `Bearer ${'1'.repeat(64)}` } });
  assert.equal(response.status, 503);
});
