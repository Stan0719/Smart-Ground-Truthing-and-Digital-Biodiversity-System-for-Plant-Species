"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { readFileSync } = require("node:fs"), { join } = require("node:path"), { once } = require("node:events");
const sharp = require("sharp");
const { createPlantDatabase } = require("./postgres-fixture.cjs");
const { createPlantApp } = require("../server.js");

test("Phase 2: authoritative observation origin across creation, history and review", async t => {
  // In-memory PGlite only; never opens an application database connection.
  const pool = await createPlantDatabase();
  t.after(() => pool.end());
  for (const name of ["004-species-requests.sql", "006-atomic-plant-submissions.sql", "008-record-change-submissions.sql", "009-record-version-history.sql"])
    await pool.query(readFileSync(join(__dirname, "../migrations", name), "utf8"));
  await pool.query(`CREATE TABLE public.qr_code(qr_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plant_id integer UNIQUE,qr_code text UNIQUE,status text,assigned_at timestamptz,activated_at timestamptz,retired_at timestamptz)`);
  await pool.query(`INSERT INTO species(scientific_name,common_name,rbac_data) VALUES
    ('Species A','A','{}'),('Species B','B','{}'),('Unapproved','U','{"approvalStatus":"Pending Review"}'),('Protected','P','{}');
    INSERT INTO rbac_species_visibility VALUES(1,'public'),(2,'public'),(3,'public'),(4,'protected')`);
  const roles = { bot: "Botanist", other: "Botanist", officer: "Conservation Officer" };
  const tokens = Object.fromEntries(Object.keys(roles).map((key, i) => [key, String(i + 1).repeat(64)]));
  const auth = { session: async token => {
    const key = Object.keys(tokens).find(key => tokens[key] === token);
    return key ? { id: key, role: roles[key], status: "Active", mustChangePassword: false } : null;
  }, event: async () => {} };
  const server = createPlantApp({ pool, auth }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  async function call(path, method = "GET", body, role = "bot") {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokens[role]}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  }
  const photo = { content_type: "image/png", base64: (await sharp({ create: { width: 2, height: 2, channels: 3, background: "green" } }).png().toBuffer()).toString("base64") };
  const content = { heightCm: 20, healthStatus: "Healthy", lifeStage: "Mature", morphology: "Leaves", latitude: 4, longitude: 113 };
  let serial = 0;
  async function create(proposal = false) {
    const n = ++serial;
    const qr = (await pool.query("INSERT INTO public.qr_code(qr_code,status) VALUES($1,'generated') RETURNING qr_id", [`phase1-${n}`])).rows[0];
    const body = { scientific_name: `Individual ${n}`, latitude: 4, longitude: 113, content, photos: [photo, photo, photo], qr_id: qr.qr_id, client_key: `phase1-${n}`,
      ...(proposal ? { new_species: { scientific_name: `Proposal ${n}`, common_name: "New", genus_name: "Genus", family_name: "Family", conservation_status: "Least Concern", description: "Description", habitat: "Forest", photo } } : { species_id: 1 }) };
    const r = await call("/plant-submissions", "POST", body);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return { ...r.data, body };
  }
  const receipt = async f => (await pool.query("SELECT * FROM plant_submission_receipt WHERE client_key=$1", [f.body.client_key])).rows[0];
  const detail = f => call(`/observations/${f.id}`, "GET", undefined, "officer");
  const edit = (f, species, revision = 1, role = "bot") => call(`/my-plants/${f.plant_id}`, "PATCH", { species_id: species, scientific_name: f.body.scientific_name, content, expected_revision: revision }, role);
  const review = (f, revision = 1) => call(`/observations/${f.id}/review`, "POST", { decision: "Approved", comment: "Verified", revision }, "officer");
  const approveSpecies = f => call(`/species-requests/${f.species_request_id}/review`, "POST", { decision: "Approved", comment: "Verified", visibility: "public" }, "officer");

  const origin = async f => {
    const d = await detail(f);
    assert.equal(d.status, 200, JSON.stringify(d.data));
    const list = await call('/observations', 'GET', undefined, 'officer');
    const row = list.data.observations.find(row => row.id === f.id);
    assert.equal(row.origin_type, d.data.observation.origin_type);
    return d.data.observation.origin_type;
  };
  const stored = async f => (await pool.query('SELECT * FROM plant_observation WHERE id=$1', [f.id])).rows[0];

  await t.test('atomic existing and proposed registrations persist initial origin, replay original receipts and keep dependencies', async () => {
    for (const proposal of [false, true]) {
      const f = await create(proposal), before = await receipt(f);
      assert.equal((await stored(f)).origin_type, 'initial_registration');
      assert.equal(await origin(f), 'initial_registration');
      assert.deepEqual((await call('/plant-submissions', 'POST', f.body)).data, before.result);
      assert.deepEqual(await receipt(f), before);
      assert.equal((await call('/plant-submissions', 'POST', { ...f.body, scientific_name: 'Changed replay' })).status, 409);
      if (proposal) assert.equal((await review(f)).status, 409);
    }
  });
  await t.test('standalone route stamps Draft, ignores spoofed top-level fields, and keeps origin through edit/submit/review', async () => {
    const f = await create(); assert.equal((await review(f)).status, 200);
    const payload = { content, client_key: 'origin-visit', origin_type: 'initial_registration', origin: 'initial_registration', observation_type: 'initial_registration', is_initial_registration: true };
    const made = await call(`/plants/${f.plant_id}/observations`, 'POST', payload);
    assert.equal(made.status, 201); const visit = made.data;
    assert.equal((await stored(visit)).origin_type, 'subsequent_observation');
    assert.equal(await origin(visit), 'subsequent_observation');
    assert.equal((await call(`/observations/${visit.id}`, 'PATCH', { content: { ...content, notes: 'Edited' }, revision: 1, origin_type: 'initial_registration' })).status, 200);
    assert.equal((await call(`/observations/${visit.id}/submit`, 'POST', { origin_type: 'initial_registration' })).status, 200);
    assert.equal(await origin(visit), 'subsequent_observation');
    assert.equal((await review(visit, 2)).status, 200);
    assert.equal((await stored(visit)).origin_type, 'subsequent_observation');
    const count = (await pool.query('SELECT count(*)::int AS n FROM plant_observation WHERE plant_id=$1', [f.plant_id])).rows[0].n;
    assert.equal((await call(`/plants/${f.plant_id}/observations`, 'POST', payload)).data.id, visit.id);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM plant_observation WHERE plant_id=$1', [f.plant_id])).rows[0].n, count);
    assert.equal(await origin(f), 'initial_registration');
  });
  await t.test('historical receipt recovers only exact initial identity, independent of status and later observations', async () => {
    const f = await create(), before = await receipt(f);
    await pool.query("UPDATE plant_observation SET origin_type='unknown' WHERE id=$1", [f.id]);
    for (const status of ['Pending Review', 'Approved', 'Rejected', 'Flagged']) {
      await pool.query('UPDATE plant_observation SET status=$1 WHERE id=$2', [status, f.id]);
      assert.equal(await origin(f), 'initial_registration');
    }
    await pool.query("INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key) VALUES('900000',$1,'staff:bot','Pending Review',$2,'unproved-later')", [f.plant_id, content]);
    assert.equal(await origin({ id: '900000' }), 'unknown');
    assert.deepEqual(await receipt(f), before);
  });
  await t.test('no receipt never implies subsequent, even for earliest/approved records; unknown records remain reviewable', async () => {
    const f = await create();
    await pool.query("UPDATE plant_observation SET origin_type='unknown' WHERE id=$1", [f.id]);
    await pool.query('DELETE FROM plant_submission_receipt WHERE client_key=$1', [f.body.client_key]);
    assert.equal(await origin(f), 'unknown');
    assert.equal((await review(f)).status, 200);
    assert.equal(await origin(f), 'unknown');
  });
  await t.test('invalid, cross-plant, missing and duplicate receipt evidence resolves unknown without hiding records', async () => {
    for (const mode of ['owner', 'key', 'plant', 'id', 'species', 'hash', 'shape', 'duplicate', 'missing']) {
      const f = await create();
      if (mode === 'owner') await pool.query("UPDATE plant_submission_receipt SET owner_subject='staff:other' WHERE client_key=$1", [f.body.client_key]);
      if (mode === 'key') await pool.query("UPDATE plant_submission_receipt SET client_key=client_key||'-wrong' WHERE client_key=$1", [f.body.client_key]);
      if (mode === 'plant') await pool.query("UPDATE plant_submission_receipt SET result=jsonb_set(result,'{plant_id}','999999') WHERE client_key=$1", [f.body.client_key]);
      if (mode === 'id') await pool.query("UPDATE plant_submission_receipt SET result=jsonb_set(result,'{id}','\"missing\"') WHERE client_key=$1", [f.body.client_key]);
      if (mode === 'species') await pool.query("UPDATE plant_submission_receipt SET result=jsonb_set(result,'{species_id}','999999') WHERE client_key=$1", [f.body.client_key]);
      if (mode === 'hash') await pool.query("UPDATE plant_submission_receipt SET payload_hash='not-a-hash' WHERE client_key=$1", [f.body.client_key]);
      if (mode === 'shape') await pool.query("UPDATE plant_submission_receipt SET result=result-'species_request_id' WHERE client_key=$1", [f.body.client_key]);
      if (mode === 'duplicate') await pool.query("INSERT INTO plant_submission_receipt SELECT owner_subject,client_key||'-duplicate',payload_hash,result,created_at FROM plant_submission_receipt WHERE client_key=$1", [f.body.client_key]);
      if (mode === 'missing') await pool.query('DELETE FROM plant_submission_receipt WHERE client_key=$1', [f.body.client_key]);
      assert.equal(await origin(f), 'unknown', mode);
    }
  });
  await t.test('conflicting column/receipt evidence is unknown and does not change review eligibility', async () => {
    const f = await create();
    await pool.query("UPDATE plant_observation SET origin_type='subsequent_observation' WHERE id=$1", [f.id]);
    assert.equal(await origin(f), 'unknown');
    assert.equal((await review(f)).status, 200);
    assert.equal(await origin(f), 'unknown');
  });
  await t.test('permitted species correction preserves original initial origin and immutable receipt', async () => {
    const f = await create(), before = await receipt(f);
    assert.equal((await edit(f, 2)).status, 200);
    assert.equal(await origin(f), 'initial_registration');
    assert.deepEqual(await receipt(f), before);
    assert.equal((await review(f, 2)).status, 200);
  });
  await t.test('spoofed nested metadata is rejected and correction/proposal/review cannot rewrite origin', async () => {
    const f = await create();
    assert.equal((await call('/plant-submissions', 'POST', { ...f.body, origin_type: 'subsequent_observation' })).status, 400);
    assert.equal((await call(`/observations/${f.id}`, 'PATCH', { revision: 1, content: { ...content, origin_type: 'subsequent_observation' } })).status, 400);
    assert.equal((await call(`/my-plants/${f.plant_id}`, 'PATCH', { species_id: 1, scientific_name: 'Plant', content, expected_revision: 1, origin_type: 'subsequent_observation' })).status, 400);
    assert.equal((await call(`/observations/${f.id}/review`, 'POST', { decision: 'Approved', revision: 1, origin_type: 'subsequent_observation' }, 'officer')).status, 200);
    assert.equal((await stored(f)).origin_type, 'initial_registration');
    assert.equal((await call('/record-changes', 'POST', { kind: 'plant', target_id: f.plant_id, proposed: { species_id: 1, scientific_name: 'New', content, origin_type: 'subsequent_observation' }, client_key: 'spoof-change' })).status, 400);
  });
  await t.test('list/detail retain content/assets/species, redact Botanist GPS, and expose no receipt secrets', async () => {
    const f = await create(), officer = (await detail(f)).data.observation;
    assert.equal(officer.origin_type, 'initial_registration'); assert.equal(officer.content.latitude, 4);
    for (const key of ['id', 'plant_id', 'species_id', 'scientific_name', 'status', 'revision', 'assets', 'owner_subject', 'species_request_id']) assert.ok(Object.hasOwn(officer, key));
    for (const key of ['payload_hash', 'receipt', 'qr_token']) assert.equal(Object.hasOwn(officer, key), false);
    const own = (await call(`/observations/${f.id}`)).data.observation;
    assert.equal(own.origin_type, 'initial_registration'); assert.equal(own.content.latitude, undefined);
    assert.equal((await call(`/observations/${f.id}`, 'GET', undefined, 'other')).status, 404);
    assert.equal((await call(`/observations/${f.id}/review`, 'POST', { decision: 'Approved', revision: 1 }, 'bot')).status, 403);
  });
  await t.test('QR reassignment does not alter origin; genuine request linkage is validated independently of status', async () => {
    const f = await create(true);
    assert.equal(await origin(f), 'initial_registration');
    assert.equal((await approveSpecies(f)).status, 200);
    await pool.query("UPDATE plant_record SET qr_token='replacement-origin-qr' WHERE plant_id=$1", [f.plant_id]);
    assert.equal(await origin(f), 'initial_registration');
    await pool.query("UPDATE species_request_submission SET client_key=client_key||'-invalid' WHERE request_id=$1", [f.species_request_id]);
    assert.equal(await origin(f), 'unknown');
  });
  await t.test('atomic asset failure rolls back provenance together with plant, receipt, assets and QR assignment', async () => {
    const f = await create();
    const qr = (await pool.query("INSERT INTO public.qr_code(qr_code,status) VALUES('rollback-origin-qr','generated') RETURNING qr_id")).rows[0];
    const counts = async () => (await pool.query(`SELECT (SELECT count(*) FROM plant_record)::int AS plants,
      (SELECT count(*) FROM plant_observation)::int AS observations,(SELECT count(*) FROM plant_submission_receipt)::int AS receipts,
      (SELECT count(*) FROM plant_asset)::int AS assets`)).rows[0];
    const before = await counts();
    await pool.query(`CREATE FUNCTION fail_origin_asset() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated failure'; END $$;
      CREATE TRIGGER fail_origin_asset BEFORE INSERT ON plant_asset FOR EACH ROW EXECUTE FUNCTION fail_origin_asset()`);
    try {
      assert.equal((await call('/plant-submissions', 'POST', { ...f.body, qr_id: qr.qr_id, client_key: 'origin-rollback' })).status, 503);
      assert.deepEqual(await counts(), before);
      assert.equal((await pool.query('SELECT status FROM public.qr_code WHERE qr_id=$1', [qr.qr_id])).rows[0].status, 'generated');
    } finally { await pool.query('DROP TRIGGER fail_origin_asset ON plant_asset; DROP FUNCTION fail_origin_asset()'); }
  });
  await t.test('old schema stays operational; additive migration is repeatable, defaults unknown and constrains new values', async () => {
    const known = await create();
    const before = await receipt(known);
    const counts = (await pool.query('SELECT count(*)::int AS n FROM plant_observation')).rows[0].n;
    await pool.query('ALTER TABLE plant_observation DROP COLUMN origin_type');
    assert.equal(await origin(known), 'initial_registration');
    assert.equal((await review(known)).status, 200);
    const historical = await call(`/plants/${known.plant_id}/observations`, 'POST', { content, client_key: 'old-schema-visit' });
    assert.equal(historical.status, 201);
    assert.equal(await origin(historical.data), 'unknown');
    const oldAtomic = await create();
    assert.equal(await origin(oldAtomic), 'initial_registration');
    const migration = readFileSync(join(__dirname, '../migrations/012-observation-origin.sql'), 'utf8');
    await pool.query(migration); await pool.query(migration);
    assert.equal((await stored(historical.data)).origin_type, 'unknown');
    assert.equal(await origin(historical.data), 'unknown');
    assert.equal(await origin(oldAtomic), 'initial_registration');
    assert.deepEqual(await receipt(known), before);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM plant_observation')).rows[0].n, counts + 2);
    const newVisit = await call(`/plants/${known.plant_id}/observations`, 'POST', { content, client_key: 'migrated-visit' });
    assert.equal(newVisit.status, 201); assert.equal(await origin(newVisit.data), 'subsequent_observation');
    await assert.rejects(pool.query("UPDATE plant_observation SET origin_type='invented' WHERE id=$1", [newVisit.data.id]), { code: '23514' });
    await assert.rejects(pool.query('UPDATE plant_observation SET origin_type=NULL WHERE id=$1', [newVisit.data.id]), { code: '23502' });
    // Simulate malformed legacy metadata only inside this disposable fixture.
    await pool.query('ALTER TABLE plant_observation DROP CONSTRAINT plant_observation_origin_type_check');
    await pool.query("UPDATE plant_observation SET origin_type='invented' WHERE id=$1", [oldAtomic.id]);
    assert.equal(await origin(oldAtomic), 'unknown');
  });

});
