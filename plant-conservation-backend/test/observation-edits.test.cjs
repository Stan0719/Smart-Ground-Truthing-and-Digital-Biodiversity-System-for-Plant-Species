'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const sharp = require('sharp');
const { createPlantDatabase } = require('./postgres-fixture.cjs');
const { createPlantApp } = require('../server.js');

test('Observation edit proposals preserve approved data, ownership, review states and versions', async (t) => {
  const pool = await createPlantDatabase();
  t.after(() => pool.end());
  // Migration 016 asserts plant_app; keep this isolated fixture in the same schema as production.
  await pool.query('SET search_path TO plant_app,pg_catalog');
  await pool.query(readFileSync(join(__dirname, '../migrations/021-observation-edit-requests.sql'), 'utf8'));
  await pool.query(`
    CREATE TABLE botanist_notification(
      id TEXT PRIMARY KEY,recipient_subject TEXT NOT NULL,type TEXT NOT NULL,source_key TEXT NOT NULL,
      observation_id TEXT,review_id TEXT,plant_id BIGINT,metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,read_at TIMESTAMPTZ,
      UNIQUE(recipient_subject,source_key));
    INSERT INTO species(species_id,scientific_name,common_name,rbac_data) VALUES(1,'Plantus testus','Test plant','{}');
    INSERT INTO rbac_species_visibility(species_id,visibility) VALUES(1,'public');
    INSERT INTO plant_record(plant_id,species_id,registered_subject,rbac_status,qr_token) VALUES(1,1,'staff:alice','Approved','qr-edit-test');
    INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,origin_type)
      VALUES('11111111-1111-4111-8111-111111111111',1,'staff:bob','Approved',
        '{"heightCm":80,"healthStatus":"Healthy","lifeStage":"Mature","morphology":"Original"}',
        'observation-bob','subsequent_observation'),
        ('33333333-3333-4333-8333-333333333333',1,'staff:alice','Approved',
        '{"heightCm":80,"healthStatus":"Healthy","lifeStage":"Mature","morphology":"Registration"}',
        'registration-alice','initial_registration');
  `);
  const originalPhoto = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#246a40' } }).jpeg().toBuffer();
  const newPhoto = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#aacc44' } }).jpeg().toBuffer();
  await pool.query(`INSERT INTO plant_asset(id,plant_id,owner_subject,client_key,observation_id,approved,content_type,content)
    VALUES($1,1,'staff:bob','photo-original',$2,TRUE,'image/jpeg',$3)`,
  ['22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', originalPhoto]);
  const roles = { alice: 'Botanist', bob: 'Botanist', carol: 'Botanist', officer: 'Conservation Officer', visitor: 'Visitor' };
  const tokens = Object.fromEntries(Object.keys(roles).map((name, index) => [name, String(index + 1).repeat(64)]));
  const auth = { session: async (token) => {
    const id = Object.keys(tokens).find((name) => tokens[name] === token);
    return id ? { id, role: roles[id], status: 'Active', mustChangePassword: false } : null;
  }, event: async () => {} };
  const server = createPlantApp({ pool, auth, origins: new Set() }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const call = async (path, user, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { Authorization: `Bearer ${tokens[user]}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  const observationId = '11111111-1111-4111-8111-111111111111';
  const original = (await call(`/observations/${observationId}`, 'bob')).data.observation;
  const proposal = { observation_id: observationId, client_key: 'edit-bob-1', content: {
    heightCm: 95, healthStatus: 'Healthy', lifeStage: 'Mature', morphology: 'Edited leaves', notes: 'New note',
  }, photo_ids: [], photos: [{ content_type: 'image/jpeg', base64: newPhoto.toString('base64') }] };
  assert.equal((await call('/observation-edits', 'alice', 'POST', proposal)).status, 404);
  assert.equal((await call('/observation-edits', 'carol', 'POST', proposal)).status, 404);
  const first = await call('/observation-edits', 'bob', 'POST', proposal);
  assert.equal(first.status, 201, JSON.stringify(first.data));
  const editId = first.data.edit.id;
  assert.equal(first.data.edit.status, 'Pending Review');
  const photoResponse = async (path, user) => fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
    headers: { Authorization: `Bearer ${tokens[user]}` },
  });
  assert.equal((await photoResponse(`/observation-edits/${editId}/photos/0`, 'bob')).status, 200);
  assert.equal((await photoResponse(`/observation-edits/${editId}/photos/0`, 'officer')).status, 200);
  assert.equal((await photoResponse(`/observation-edits/${editId}/photos/0`, 'alice')).status, 404);
  assert.equal((await photoResponse(`/observation-edits/${editId}/photos/0`, 'visitor')).status, 403);
  assert.equal((await call('/observation-edits', 'bob', 'POST', proposal)).data.edit.id, editId);
  assert.equal((await call('/observation-edits', 'bob', 'POST', { ...proposal, client_key: 'edit-bob-duplicate' })).status, 409);
  assert.equal((await call(`/observation-edits/${editId}`, 'alice')).status, 404);
  assert.equal((await call(`/observation-edits/${editId}`, 'visitor')).status, 403);
  assert.equal((await call('/observation-edits', 'bob')).data.edits.length, 1);
  assert.equal((await call('/observation-edits', 'alice')).data.edits.length, 0);
  assert.deepEqual((await call(`/observations/${observationId}`, 'bob')).data.observation.content, original.content);
  assert.deepEqual((await pool.query('SELECT id FROM plant_asset WHERE observation_id=$1 AND approved=TRUE', [observationId])).rows.map((row) => row.id),
    ['22222222-2222-4222-8222-222222222222']);
  const correction = await call(`/observation-edits/${editId}/review`, 'officer', 'POST', { decision: 'Correction Required', comment: 'Clarify the note.' });
  assert.equal(correction.status, 200, JSON.stringify(correction.data));
  assert.equal((await call(`/observation-edits/${editId}`, 'bob')).data.edit.review_comment, 'Clarify the note.');
  const resubmitted = await call(`/observation-edits/${editId}`, 'bob', 'PATCH', { revision: 1,
    content: { ...proposal.content, notes: 'Clarified note' } });
  assert.equal(resubmitted.status, 200, JSON.stringify(resubmitted.data));
  assert.equal(resubmitted.data.edit.id, editId);
  assert.equal(resubmitted.data.edit.status, 'Pending Review');
  assert.equal((await call(`/observation-edits/${editId}`, 'carol', 'PATCH', { revision: 2, content: proposal.content })).status, 404);
  const approved = await call(`/observation-edits/${editId}/review`, 'officer', 'POST', { decision: 'Approved', comment: 'Accepted.' });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  const current = (await call(`/observations/${observationId}`, 'bob')).data.observation;
  assert.equal(current.id, observationId);
  assert.equal(current.content.morphology, 'Edited leaves');
  assert.equal(current.content.notes, 'Clarified note');
  assert.equal(current.review_comment, 'Accepted.');
  assert.equal(current.review_decision, 'Approved');
  assert.ok(current.reviewed_at);
  assert.equal((await call(`/observations/${observationId}`, 'alice')).data.observation.review_comment, 'Accepted.');
  const currentPhotos = (await pool.query('SELECT id FROM plant_asset WHERE observation_id=$1 AND approved=TRUE', [observationId])).rows;
  assert.equal(currentPhotos.length, 1);
  assert.notEqual(currentPhotos[0].id, '22222222-2222-4222-8222-222222222222');
  const history = (await call(`/observations/${observationId}/edit-history`, 'bob')).data;
  assert.deepEqual(history.versions.map((version) => version.version_number), [0, 1]);
  assert.equal(history.versions[0].content.morphology, 'Original');
  assert.deepEqual(history.versions[0].photo_ids, ['22222222-2222-4222-8222-222222222222']);
  assert.deepEqual(history.versions[1].photo_ids, [currentPhotos[0].id]);
  assert.equal((await photoResponse(`/observation-versions/${history.versions[0].id}/photos/0`, 'bob')).status, 200);
  assert.equal((await photoResponse(`/observation-versions/${history.versions[0].id}/photos/0`, 'alice')).status, 404);
  assert.deepEqual(history.events.map((event) => event.event_type), ['submitted', 'correction_required', 'resubmitted', 'approved']);
  const notifications = (await call('/notifications', 'bob')).data.notifications;
  assert.deepEqual(notifications.filter((event) => event.entityType === 'observation_edit').map((event) => event.type).sort(),
    ['observation_edit_approved', 'observation_edit_correction', 'observation_edit_resubmitted', 'observation_edit_submitted'].sort());
  assert.equal((await call('/notifications', 'alice')).data.notifications.some((event) => event.entityType === 'observation_edit'), false);
  assert.equal((await call(`/observations/${observationId}/edit-history`, 'alice')).status, 404);
  const second = await call('/observation-edits', 'bob', 'POST', { ...proposal, client_key: 'edit-bob-2', content: { ...proposal.content, morphology: 'Edit two' } });
  assert.equal(second.status, 201, JSON.stringify(second.data));
  assert.equal(second.data.edit.version_number, 2);
  assert.equal((await call(`/observation-edits/${second.data.edit.id}/review`, 'officer', 'POST', { decision: 'Rejected', comment: 'Not verified.' })).status, 200);
  const afterRejectedEdit = (await call(`/observations/${observationId}`, 'bob')).data.observation;
  assert.equal(afterRejectedEdit.content.morphology, 'Edited leaves');
  assert.equal(afterRejectedEdit.review_comment, 'Accepted.');
  assert.equal((await call('/observation-edits', 'bob', 'POST', { ...proposal, client_key: 'edit-bob-3' })).status, 201);
  const initialId = '33333333-3333-4333-8333-333333333333';
  const initialEdit = await call('/observation-edits', 'alice', 'POST', { ...proposal,
    observation_id: initialId, client_key: 'initial-plant-edit', content: { ...proposal.content, morphology: 'Initial edit', latitude: 1.5, longitude: 2.5, accuracy_m: 3 } });
  assert.equal(initialEdit.status, 201, JSON.stringify(initialEdit.data));
  assert.equal((await call(`/observation-edits/${initialEdit.data.edit.id}/review`, 'officer', 'POST',
    { decision: 'Approved', comment: 'Accepted initial observation edit.' })).status, 200);
  assert.equal((await call(`/observations/${initialId}`, 'alice')).data.observation.content.morphology, 'Initial edit');
  assert.equal((await pool.query('SELECT rbac_status FROM plant_record WHERE plant_id=1')).rows[0].rbac_status, 'Approved');
  assert.deepEqual((await pool.query('SELECT latitude,longitude,accuracy_m FROM plant_location WHERE plant_id=1 ORDER BY location_id DESC LIMIT 1')).rows[0],
    { latitude: 1.5, longitude: 2.5, accuracy_m: 3 });
  const unknownId = '44444444-4444-4444-8444-444444444444';
  await pool.query(`INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,origin_type)
    VALUES($1,1,'staff:alice','Approved',$2,'legacy-unknown','unknown')`,
  [unknownId, { heightCm: 71, healthStatus: 'Healthy', lifeStage: 'Mature', morphology: 'Legacy leaves' }]);
  const unknownEdit = await call('/observation-edits', 'alice', 'POST', { ...proposal,
    observation_id: unknownId, client_key: 'unknown-observation-edit', content: { ...proposal.content, morphology: 'Legacy edit' } });
  assert.equal(unknownEdit.status, 201, JSON.stringify(unknownEdit.data));
  assert.equal((await call(`/observation-edits/${unknownEdit.data.edit.id}/review`, 'officer', 'POST',
    { decision: 'Approved', comment: 'Accepted legacy observation edit.' })).status, 200);
  assert.equal((await call(`/observations/${unknownId}`, 'alice')).data.observation.content.morphology, 'Legacy edit');
  const ownHistory = (await call(`/observations/${initialId}/edit-history`, 'alice')).data;
  const otherHistory = (await call(`/observations/${unknownId}/edit-history`, 'alice')).data;
  assert.deepEqual(ownHistory.versions.map((version) => version.version_number), [0, 1]);
  assert.deepEqual(otherHistory.versions.map((version) => version.version_number), [0, 1]);
  assert.equal(ownHistory.versions[1].edit_request_id, initialEdit.data.edit.id);
  assert.equal(otherHistory.versions[1].edit_request_id, unknownEdit.data.edit.id);
});
