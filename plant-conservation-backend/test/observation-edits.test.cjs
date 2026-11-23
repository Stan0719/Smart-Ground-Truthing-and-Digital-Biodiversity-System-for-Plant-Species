'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const sharp = require('sharp');
const { createPlantDatabase } = require('./postgres-fixture.cjs');
const { createPlantApp } = require('../server.js');

for (const pgWire of [false, true]) test(`Observation edit proposals preserve approved data, ownership, review states and versions (${pgWire ? 'node-postgres bindings' : 'PGlite bindings'})`, async (t) => {
  const pool = await createPlantDatabase();
  t.after(() => pool.end());
  if (pgWire) {
    // PGlite supplies the disposable SQL engine; pg supplies production parameter serialization.
    // In particular, a native [] becomes PostgreSQL '{}' rather than JSON '[]'.
    const { prepareValue } = require('pg/lib/utils');
    const connect = pool.connect.bind(pool);
    pool.connect = async () => {
      const client = await connect(), query = client.query.bind(client);
      client.query = (sql, values = []) => query(sql, values.map(value => prepareValue(value)));
      return client;
    };
  }
  // Migration 016 asserts plant_app; keep this isolated fixture in the same schema as production.
  await pool.query('SET search_path TO plant_app,pg_catalog');
  for (const number of ['004','006','008','009','016','017','021','022','024','025','026','027','028','029']) {
    const file = number === '016' ? '016-species-request-content-revision.sql' : require('node:fs').readdirSync(join(__dirname, '../migrations')).find(name => name.startsWith(number + '-'));
    await pool.query(readFileSync(join(__dirname, '../migrations', file), 'utf8'));
  }
  await pool.query(readFileSync(join(__dirname, '../migrations/032-translation-storage.sql'), 'utf8'));
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
  await pool.query(`INSERT INTO plant_submission_receipt(owner_subject,client_key,payload_hash,result)
    VALUES('staff:alice','registration-alice',$1,$2)`, ['a'.repeat(64), {
      plant_id: 1, id: '33333333-3333-4333-8333-333333333333', species_id: 1,
      qr_token: 'qr-edit-test', status: 'Pending Review', species_request_id: null,
    }]);
  const originalPhoto = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#246a40' } }).jpeg().toBuffer();
  const newPhoto = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#aacc44' } }).jpeg().toBuffer();
  await pool.query(`INSERT INTO plant_asset(id,plant_id,owner_subject,client_key,observation_id,approved,content_type,content)
    VALUES($1,1,'staff:bob','photo-original',$2,TRUE,'image/jpeg',$3)`,
  ['22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', originalPhoto]);
  const roles = { alice: 'Botanist', bob: 'Botanist', carol: 'Botanist', officer: 'Conservation Officer', officer2: 'Conservation Officer', visitor: 'Visitor' };
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
  const capability = await call('/observation-edits/capabilities', 'bob');
  assert.equal(capability.data.available, true);
  assert.equal(capability.data.versioning_available, false, 'the legacy workflow is identified when Migration 030 is absent');
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
  const photoTypes = (await pool.query(`SELECT jsonb_typeof(retained_photo_ids) AS retained,
    jsonb_typeof(added_photos) AS additions FROM observation_edit_request WHERE id=$1`, [editId])).rows[0];
  assert.deepEqual(photoTypes, { retained: 'array', additions: 'array' });
  assert.deepEqual(first.data.edit.retained_photo_ids, []);
  assert.equal(first.data.edit.added_photo_count, 1);
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
  // Invalid review requests must not change proposal, evidence or public data.
  const beforeInvalid = (await call(`/observation-edits/${editId}`, 'bob')).data.edit;
  for (const revision of [undefined, null, 0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
    const response = await call(`/observation-edits/${editId}/review`, 'officer', 'POST', {decision:'Approved',revision});
    assert.equal(response.status,400,JSON.stringify(response.data));
    assert.deepEqual((await call(`/observation-edits/${editId}`, 'bob')).data.edit,beforeInvalid);
  }
  assert.equal((await call(`/observation-edits/${editId}/review`, 'officer', 'POST', {decision:'Flagged',revision:1,comment:'Unsupported'})).status,400);
  assert.equal((await call('/observation-versions/does-not-exist/photos/0','bob')).status,404);
  assert.equal((await pool.query('SELECT count(*)::int n FROM observation_submission_version')).rows[0].n,0);
  const correction = await call(`/observation-edits/${editId}/review`, 'officer', 'POST', { decision: 'Correction Required', comment: 'Clarify the note.', revision: 1 });
  assert.equal(correction.status, 200, JSON.stringify(correction.data));
  assert.equal((await call(`/observation-edits/${editId}`, 'bob')).data.edit.review_comment, 'Clarify the note.');
  const resubmitted = await call(`/observation-edits/${editId}`, 'bob', 'PATCH', { revision: 1,
    content: { ...proposal.content, notes: 'Clarified note' } });
  assert.equal(resubmitted.status, 200, JSON.stringify(resubmitted.data));
  assert.equal(resubmitted.data.edit.id, editId);
  assert.equal(resubmitted.data.edit.status, 'Pending Review');
  assert.equal((await call(`/observation-edits/${editId}/cancel`, 'bob', 'POST', {})).status, 409);
  assert.equal((await call(`/observation-edits/${editId}/cancel`, 'carol', 'POST', {})).status, 404);
  assert.equal((await call(`/observation-edits/${editId}`, 'carol', 'PATCH', { revision: 2, content: proposal.content })).status, 404);
  assert.equal((await call(`/observation-edits/${editId}/review`, 'officer', 'POST',
    { decision: 'Approved', comment: 'Stale decision.', revision: 1 })).status, 409);
  assert.equal((await call(`/observation-edits/${editId}`, 'bob')).data.edit.status, 'Pending Review');
  const tooLong = await call(`/observation-edits/${editId}/review`, 'officer', 'POST', { decision: 'Approved', comment: 'x'.repeat(4001), revision: 2 });
  assert.equal(tooLong.status, 400);
  assert.equal((await call(`/observation-edits/${editId}/review`, 'officer', 'POST', { decision: 'Rejected', comment: '', revision: 2 })).status, 400);
  const approved = await call(`/observation-edits/${editId}/review`, 'officer', 'POST', { decision: 'Approved', comment: '', revision: 2 });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  const current = (await call(`/observations/${observationId}`, 'bob')).data.observation;
  assert.equal(current.id, observationId);
  assert.equal(current.content.morphology, 'Edited leaves');
  assert.equal(current.content.notes, 'Clarified note');
  assert.equal(current.review_comment, '');
  assert.equal(current.review_decision, 'Approved');
  assert.ok(current.reviewed_at);
  assert.equal((await call(`/observations/${observationId}`, 'alice')).data.observation.review_comment, '');
  const currentPhotos = (await pool.query('SELECT id FROM plant_asset WHERE observation_id=$1 AND approved=TRUE', [observationId])).rows;
  assert.equal(currentPhotos.length, 1);
  assert.notEqual(currentPhotos[0].id, '22222222-2222-4222-8222-222222222222');
  const history = (await call(`/observations/${observationId}/edit-history`, 'bob')).data;
  assert.deepEqual(history.versions.map((version) => version.version_number), [0, 1]);
  assert.equal(history.versions[0].content.morphology, 'Original');
  assert.deepEqual(history.versions[0].photo_ids, ['22222222-2222-4222-8222-222222222222']);
  assert.deepEqual(history.versions[1].photo_ids, [currentPhotos[0].id]);
  const historicalPhoto = await photoResponse(`/observation-versions/${history.versions[0].id}/photos/0`, 'bob');
  assert.equal(historicalPhoto.status,200);
  assert.deepEqual(Buffer.from(await historicalPhoto.arrayBuffer()),originalPhoto);
  const retainedAsset=(await pool.query('SELECT observation_id,content FROM plant_asset WHERE id=$1',['22222222-2222-4222-8222-222222222222'])).rows[0];
  assert.equal(retainedAsset.observation_id,null);assert.deepEqual(Buffer.from(retainedAsset.content),originalPhoto);
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
  const competing = await Promise.all(['officer','officer2'].map(officer => call(`/observation-edits/${second.data.edit.id}/review`, officer, 'POST', {decision:'Rejected',comment:'Not verified.',revision:1})));
  assert.deepEqual(competing.map(result=>result.status).sort(),[200,409]);
  assert.deepEqual((await call(`/observations/${observationId}`, 'bob')).data.observation.content,current.content);
  const afterRejectedEdit = (await call(`/observations/${observationId}`, 'bob')).data.observation;
  assert.equal(afterRejectedEdit.content.morphology, 'Edited leaves');
  assert.equal(afterRejectedEdit.review_comment, '');
  assert.equal((await call('/observation-edits', 'bob', 'POST', { ...proposal, client_key: 'edit-bob-3' })).status, 201);
  const initialId = '33333333-3333-4333-8333-333333333333';
  const initialPayload = { observation_id: initialId, client_key: 'initial-plant-edit',
    content: { ...proposal.content, morphology: 'Initial edit', latitude: 1.5, longitude: 2.5, accuracy_m: 3 }, photo_ids: [] };
  const initialBefore = (await call(`/observations/${initialId}`, 'alice')).data.observation;
  assert.equal(initialBefore.origin_type, 'initial_registration');
  const initialEdit = await call('/observation-edits', 'alice', 'POST', initialPayload);
  assert.equal(initialEdit.status, 409); assert.match(initialEdit.data.error, /use Edit Plant/);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM observation_edit_request WHERE observation_id=$1', [initialId])).rows[0].n, 0);
  assert.equal((await call('/observation-edits', 'alice', 'POST', { ...initialPayload, origin_type: 'subsequent_observation' })).status, 400);
  // A contradictory stored label cannot override receipt-backed registration identity.
  await pool.query("UPDATE plant_observation SET origin_type='subsequent_observation' WHERE id=$1",[initialId]);
  assert.equal((await call('/observation-edits','alice','POST',initialPayload)).status,409);
  await pool.query("UPDATE plant_observation SET origin_type='initial_registration' WHERE id=$1",[initialId]);
  // Multiple receipt candidates are ambiguous; neither date nor raw label may select one.
  await pool.query(`INSERT INTO plant_submission_receipt(owner_subject,client_key,payload_hash,result)
    SELECT owner_subject,'ambiguous-receipt',payload_hash,result FROM plant_submission_receipt WHERE client_key='registration-alice'`);
  assert.equal((await call('/observation-edits','alice','POST',initialPayload)).status,409);
  await pool.query("DELETE FROM plant_submission_receipt WHERE client_key='ambiguous-receipt'");
  assert.deepEqual((await call(`/observations/${initialId}`,'alice')).data.observation.content,initialBefore.content);

  for (const origin of ['unknown']) {
    const unknownId = '44444444-4444-4444-8444-444444444444';
    await pool.query(`INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,origin_type)
      VALUES($1,1,'staff:alice','Approved',$2,'legacy-unknown',$3)
      ON CONFLICT(id) DO UPDATE SET origin_type=EXCLUDED.origin_type`, [unknownId, initialBefore.content, origin]);
    assert.equal((await call('/observation-edits', 'alice', 'POST', { ...initialPayload, observation_id: unknownId, client_key: 'unknown-edit' })).status, 409);
  }
  // Seed a pre-policy request without reinterpreting its submitted target or evidence.
  const { createHash } = require('node:crypto');
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const normalized = { content: initialPayload.content, photoIds: [], photos: [] };
  const base = { content: initialBefore.content, revision: initialBefore.revision, photo_ids: [] };
  const legacyId = '66666666-6666-4666-8666-666666666666';
  await pool.query(`INSERT INTO observation_edit_request
    (id,observation_id,owner_subject,version_number,base_revision,base_fingerprint,base_snapshot,proposed_content,retained_photo_ids,added_photos,client_key,payload_hash)
    VALUES($1,$2,'staff:alice',1,$3,$4,$5,$6,'[]'::jsonb,'[]'::jsonb,$7,$8)`,
    [legacyId, initialId, initialBefore.revision, digest(base), base, initialPayload.content, initialPayload.client_key, digest({ observationId: initialId, proposed: normalized })]);
  const replay = await call('/observation-edits', 'alice', 'POST', initialPayload);
  assert.equal(replay.status, 201, JSON.stringify(replay.data)); assert.equal(replay.data.edit.id, legacyId);
  assert.equal((await call('/observation-edits', 'alice', 'POST', { ...initialPayload, content: { ...initialPayload.content, notes: 'changed retry' } })).status, 409);
  assert.equal((await call(`/observation-edits/${legacyId}`, 'alice')).status, 200);
  assert.equal((await call(`/observations/${initialId}/edit-history`, 'alice')).status, 200);
  assert.equal((await call(`/observation-edits/${legacyId}/review`, 'officer', 'POST', { decision: 'Correction Required', comment: 'Clarify', revision: 1 })).status, 200);
  assert.equal((await call(`/observation-edits/${legacyId}`, 'alice', 'PATCH', { content: initialPayload.content, photo_ids: [], revision: 1 })).status, 200);
  assert.equal((await call(`/observation-edits/${legacyId}/review`, 'officer', 'POST', { decision: 'Approved', comment: 'Stale', revision: 1 })).status, 409);
  assert.equal((await call(`/observation-edits/${legacyId}/review`, 'officer', 'POST', { decision: 'Approved', comment: 'Accepted existing proposal', revision: 2 })).status, 200);
  assert.equal((await call(`/observations/${initialId}`, 'alice')).data.observation.content.morphology, 'Initial edit');
  // Cancelling an existing initial-origin request remains independent of the new creation policy.
  const cancelLegacyId = '77777777-7777-4777-8777-777777777777';
  const latestInitial = (await call(`/observations/${initialId}`, 'alice')).data.observation;
  const cancelBase = { content: latestInitial.content, revision: latestInitial.revision, photo_ids: [] };
  await pool.query(`INSERT INTO observation_edit_request
    (id,observation_id,owner_subject,version_number,base_revision,base_fingerprint,base_snapshot,proposed_content,retained_photo_ids,added_photos,client_key,payload_hash)
    VALUES($1,$2,'staff:alice',2,$3,$4,$5,$6,'[]'::jsonb,'[]'::jsonb,'legacy-cancel-key','legacy-hash')`,
    [cancelLegacyId,initialId,latestInitial.revision,digest(cancelBase),cancelBase,latestInitial.content]);
  assert.equal((await call(`/observation-edits/${cancelLegacyId}/cancel`, 'alice', 'POST', {})).status,200);
  assert.equal((await call(`/observation-edits/${cancelLegacyId}`, 'alice')).data.edit.status,'Cancelled');
  assert.deepEqual((await call(`/observations/${initialId}`, 'alice')).data.observation.content,latestInitial.content);
  const zeroObservationId = '55555555-5555-4555-8555-555555555555';
  await pool.query(`INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,origin_type)
    VALUES($1,1,'staff:bob','Approved',$2,'zero-photo-baseline','subsequent_observation')`,[zeroObservationId,original.content]);
  const zero = await call('/observation-edits', 'bob', 'POST', {
    observation_id: zeroObservationId, client_key: 'zero-photo-contract', content: proposal.content, photo_ids: [], photos: [],
  });
  assert.equal(zero.status, 201, JSON.stringify(zero.data));
  assert.deepEqual(zero.data.edit.retained_photo_ids, []);
  assert.equal(zero.data.edit.added_photo_count, 0);
  const zeroId = zero.data.edit.id;
  const beforeMalformed = (await pool.query('SELECT * FROM observation_edit_request WHERE id=$1', [zeroId])).rows[0];
  const approvedBeforeMalformed = (await call(`/observations/${zeroObservationId}`, 'officer')).data.observation;
  for (const column of ['retained_photo_ids', 'added_photos']) {
    await pool.query(`UPDATE observation_edit_request SET ${column}='{}'::jsonb WHERE id=$1`, [zeroId]);
    for (const path of ['/observation-edits', `/observation-edits/${zeroId}`]) {
      const bad = await call(path, 'officer');
      assert.equal(bad.status, 409); assert.match(bad.data.error, /photo evidence is invalid/);
    }
    assert.equal((await call(`/observation-edits/${zeroId}/review`, 'officer', 'POST', {decision:'Approved',revision:1,comment:'Blocked'})).status,409);
    assert.equal((await pool.query('SELECT status FROM observation_edit_request WHERE id=$1',[zeroId])).rows[0].status,'Pending Review');
    assert.deepEqual((await call(`/observations/${zeroObservationId}`, 'officer')).data.observation,approvedBeforeMalformed);
    // Restore only the disposable fixture after asserting no endpoint repaired the evidence.
    assert.deepEqual((await pool.query(`SELECT ${column} AS value FROM observation_edit_request WHERE id=$1`,[zeroId])).rows[0].value,{});
    await pool.query(`UPDATE observation_edit_request SET ${column}=$1::jsonb WHERE id=$2`,[JSON.stringify(beforeMalformed[column]),zeroId]);
  }
  assert.equal((await call(`/observation-edits/${zeroId}/review`, 'officer', 'POST', {decision:'Approved',revision:1,comment:'Valid zero-photo proposal'})).status,200);
  const zeroHistory = (await call(`/observations/${zeroObservationId}/edit-history`, 'officer')).data;
  assert.deepEqual(zeroHistory.versions.at(-1).photo_ids,[]);
  assert.equal((await pool.query(`SELECT bool_and(jsonb_typeof(photo_ids)='array') AS valid FROM observation_version_history WHERE observation_id=$1`,[zeroObservationId])).rows[0].valid,true);
  const retainedObservationId='66666666-6666-4666-8666-666666666666', retainedPhotoId='77777777-7777-4777-8777-777777777777';
  await pool.query(`INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,origin_type)
    VALUES($1,1,'staff:bob','Approved',$2,'retained-photo-baseline','subsequent_observation')`,[retainedObservationId,original.content]);
  await pool.query(`INSERT INTO plant_asset(id,plant_id,owner_subject,client_key,observation_id,approved,content_type,content)
    VALUES($1,1,'staff:bob','retained-photo-evidence',$2,TRUE,'image/jpeg',$3)`,[retainedPhotoId,retainedObservationId,originalPhoto]);
  const retainedProposal=await call('/observation-edits','bob','POST',{observation_id:retainedObservationId,client_key:'nonempty-retained',content:proposal.content,photo_ids:[retainedPhotoId],photos:[]});
  assert.equal(retainedProposal.status,201,JSON.stringify(retainedProposal.data));assert.deepEqual(retainedProposal.data.edit.retained_photo_ids,[retainedPhotoId]);
  const retainedId=retainedProposal.data.edit.id;
  assert.equal((await call(`/observation-edits/${retainedId}/review`,'officer','POST',{decision:'Correction Required',revision:1,comment:'Clarify'})).status,200);
  const correctedRetained=await call(`/observation-edits/${retainedId}`,'bob','PATCH',{revision:1,content:{...proposal.content,notes:'Corrected'},photo_ids:[retainedPhotoId],photos:[]});
  assert.equal(correctedRetained.status,200);assert.deepEqual(correctedRetained.data.edit.retained_photo_ids,[retainedPhotoId]);
  assert.equal((await call(`/observation-edits/${retainedId}/review`,'officer','POST',{decision:'Approved',revision:2,comment:'Verified'})).status,200);
  const retainedHistory=(await call(`/observations/${retainedObservationId}/edit-history`,'officer')).data;
  assert.deepEqual(retainedHistory.versions.at(-1).photo_ids,[retainedPhotoId]);
  const historyId = zeroHistory.versions.at(-1).id;
  await pool.query("UPDATE observation_version_history SET photo_ids='{}'::jsonb WHERE id=$1",[historyId]);
  const invalidHistory = await call(`/observations/${zeroObservationId}/edit-history`, 'officer');
  assert.equal(invalidHistory.status,409);assert.match(invalidHistory.data.error,/photo evidence is invalid/);
  assert.deepEqual((await pool.query('SELECT photo_ids FROM observation_version_history WHERE id=$1',[historyId])).rows[0].photo_ids,{});

});


test('production pg bindings distinguish SQL-array literals from explicit JSONB arrays',async t=>{
 const pool=await createPlantDatabase();t.after(()=>pool.end());const {prepareValue}=require('pg/lib/utils');
 const result=(await pool.query('SELECT $1::jsonb AS native, $2::jsonb AS empty, $3::jsonb AS refs',[
  prepareValue([]),prepareValue(JSON.stringify([])),prepareValue(JSON.stringify(['opaque-photo']))
 ])).rows[0];
 assert.deepEqual(result.native,{});assert.deepEqual(result.empty,[]);assert.deepEqual(result.refs,['opaque-photo']);
})
