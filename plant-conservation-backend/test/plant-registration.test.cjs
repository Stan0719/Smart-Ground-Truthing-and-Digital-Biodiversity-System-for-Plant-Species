"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { readFileSync } = require("node:fs"), { join } = require("node:path"), { once } = require("node:events");
const sharp = require("sharp");
const { createPlantDatabase } = require("./postgres-fixture.cjs");
const { createPlantApp } = require("../server.js");

test("Registration projections stay independent of subsequent Observations", async t => {
  // In-memory PGlite only; never opens an application database connection.
  const pool = await createPlantDatabase();
  t.after(() => pool.end());
  for (const name of ["004-species-requests.sql", "006-atomic-plant-submissions.sql", "008-record-change-submissions.sql", "009-record-version-history.sql", "016-species-request-content-revision.sql", "017-species-review-cycle.sql"])
    await pool.query(readFileSync(join(__dirname, "../migrations", name), "utf8"));
  await pool.query(`CREATE TABLE plant_app.qr_code(qr_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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
    if (/^\/species-requests\/\d+\/review$/.test(path) && body && !Object.hasOwn(body, 'expected_revision')) {
      const row = (await pool.query('SELECT content_revision,review_cycle FROM species_request_submission WHERE request_id::text=$1', [path.split('/')[2]])).rows[0];
      body = { ...body, expected_review_cycle: row?.review_cycle || 1, expected_revision: row?.content_revision || 1 };
    }

    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { "Content-Type": "application/json", ...(role ? { Authorization: `Bearer ${tokens[role]}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  }
  const photo = { content_type: "image/png", base64: (await sharp({ create: { width: 2, height: 2, channels: 3, background: "green" } }).png().toBuffer()).toString("base64") };
  const content = { heightCm: 20, healthStatus: "Healthy", lifeStage: "Mature", morphology: "Leaves", latitude: 4, longitude: 113 };
  let serial = 0;
  async function create(proposal = false) {
    const n = ++serial;
    const qr = (await pool.query("INSERT INTO plant_app.qr_code(qr_code,status) VALUES($1,'generated') RETURNING qr_id", [`phase1-${n}`])).rows[0];
    const body = { scientific_name: `Individual ${n}`, latitude: 4, longitude: 113, content, photos: [photo, photo, photo], qr_id: qr.qr_id, client_key: `phase1-${n}`,
      ...(proposal ? { new_species: { scientific_name: `Proposal ${n}`, common_name: "New", genus_name: "Genus", family_name: "Family", conservation_status: "Least Concern", description: "Description", habitat: "Forest", photo } } : { species_id: 1 }) };
    const r = await call("/plant-submissions", "POST", body);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return { ...r.data, body };
  }

  const { resolvePlantRegistration } = require('../plant-registration.cjs');
  const assertOk = r => { assert.ok(r.status >= 200 && r.status < 300, JSON.stringify(r)); return r.data; };
  const f = await create();
  const approve = async (id, revision = 1) => assertOk(await call(`/observations/${id}/review`, 'POST', { decision:'Approved', comment:'Verified', revision }, 'officer'));
  await approve(f.id);
  // Enable immutable revision history only after the original approval capture:
  // this models existing deployed records without mutating any external DB.
  await pool.query(readFileSync(join(__dirname, '../migrations/028-immutable-record-version-revisions.sql'), 'utf8'));
  const original = await resolvePlantRegistration(pool, f.plant_id);
  assert.equal(original.state, 'available');
  assert.equal(original.photo_ids.length, 3);
  const addVisit = async (key, gps, withPhoto = false) => {
    const visit = assertOk(await call(`/plants/${f.plant_id}/observations`, 'POST', {
      client_key:key, content:{ heightCm:10,healthStatus:'Healthy',lifeStage:'Seedling',morphology:'Visit', ...gps },
    }));
    if (withPhoto) assertOk(await call('/assets', 'POST', { plant_id:f.plant_id, observation_id:visit.id,
      client_key:`${key}:photo:0`, content_type:photo.content_type,base64:photo.base64 }));
    assertOk(await call(`/observations/${visit.id}/submit`, 'POST', {}));
    return visit;
  };
  const checkRegistration = async () => {
    const row = assertOk(await call(`/plants/${f.plant_id}?scope=mine`)).plant;
    assert.equal(row.latitude,4); assert.equal(row.longitude,113);
    assert.equal(row.current_registration.content.heightCm,20);
    assert.equal(row.current_registration.content.lifeStage,'Mature');
    assert.ok(original.photo_ids.includes(row.plant_image_asset_id));
    const assets = assertOk(await call(`/assets?plant_id=${f.plant_id}&scope=mine`)).assets;
    assert.deepEqual(assets.map(a=>a.id).sort(), [...original.photo_ids].sort());
    const gallery = assertOk(await call(`/plants/${f.plant_id}/gallery`));
    assert.deepEqual(gallery.assets.map(a=>a.asset_id).sort(), [...original.photo_ids].sort());
    const detail = assertOk(await call(`/plants/${f.plant_id}/detail`, 'GET', undefined, 'officer'));
    assert.equal(detail.staff.approved_location.latitude,4);
    return row;
  };
  await t.test('pending and rejected visits do not replace registration GPS/photos or measurements', async () => {
    const rejected = await addVisit('rejected', {latitude:0,longitude:0}, true);
    await checkRegistration();
    assertOk(await call(`/observations/${rejected.id}/review`, 'POST', {decision:'Rejected',comment:'Rejected',revision:1},'officer'));
    await checkRegistration();
    assert.equal((await call(`/assets?plant_id=${f.plant_id}`, 'GET', undefined, 'other')).data.assets.length,3);
  });
  let visit;
  await t.test('approved visit B has its own photos/GPS while registration A stays unchanged', async () => {
    visit = await addVisit('visit', {latitude:37.4219983,longitude:-122.084}, true);
    await approve(visit.id);
    const row = await checkRegistration();
    assert.equal(row.latest_approved.heightCm,10);
    const verified = assertOk(await call(`/observations/${visit.id}`, 'GET',undefined,'officer')).observation;
    assert.equal(verified.content.latitude,37.4219983);
    const stored = (await pool.query('SELECT * FROM plant_observation WHERE id=$1',[f.id])).rows[0];
    assert.equal(stored.content.latitude,4);
    const history = assertOk(await call('/observations?scope=mine')).observations;
    assert.ok(history.some(o=>o.id===f.id)); assert.ok(history.some(o=>o.id===visit.id));
  });
  await t.test('GPS-free and photo-free approval preserves A and keeps the new Observation empty', async () => {
    const empty = await addVisit('gps-free', {}); await approve(empty.id);
    const row = await checkRegistration();
    assert.equal(row.latest_approved.latitude,undefined);
    assert.equal(row.latest_approved.longitude,undefined);
    const observation = assertOk(await call(`/observations/${empty.id}`)).observation;
    assert.equal(observation.assets.length,0);
    assert.equal(observation.content.latitude,undefined);
    assert.equal(row.scientific_name,f.body.scientific_name);
    assert.equal(String(row.species_id),'1'); assert.equal(row.qr_token,f.body.client_key);
  });
  await t.test('public reads and bytes authorize registration references without revealing private photos', async () => {
    const publicRow = assertOk(await call(`/plants/${f.plant_id}`, 'GET', undefined, null)).plant;
    assert.equal(publicRow.current_registration.content.heightCm,20);
    assert.equal(publicRow.current_registration.content.latitude,undefined);
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/assets/${original.photo_ids[0]}`);
    assert.equal(r.status,200); assert.ok((await r.arrayBuffer()).byteLength);
    const privatePlant = await create();
    const privateEvidence = assertOk(await call(`/plants/${privatePlant.plant_id}/detail/gallery`, 'GET',undefined,'officer'));
    assert.equal(privateEvidence.assets.length,3);
    const privateAsset = (await pool.query('SELECT id FROM plant_asset WHERE observation_id=$1',[privatePlant.id])).rows[0].id;
    for (const role of [null,'other']) {
      assert.equal((await call(`/plants/${privatePlant.plant_id}?scope=mine`, 'GET',undefined,role)).status,role?404:401);
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api/assets/${privateAsset}?scope=mine`, {
        headers:role?{Authorization:`Bearer ${tokens[role]}`}:{}});
      assert.equal(r.status,404);
    }
  });
  await t.test('genuine approved Plant edit C uses A as base and preserves subsequent Observation B', async () => {
    const change = assertOk(await call('/record-changes','POST', {kind:'plant',target_id:f.plant_id,
      client_key:'genuine-edit',proposed:{species_id:1,scientific_name:'Edited registration',
        content:{...content,heightCm:45,latitude:5,longitude:114}}})).change;
    const storedChange = assertOk(await call(`/record-changes/${change.id}`)).change;
    assert.equal(storedChange.base_snapshot.observation_id,f.id);
    assert.equal(storedChange.base_snapshot.content.heightCm,20);
    assert.equal(storedChange.base_snapshot.content.latitude,4);
    // A separate Observation approval must not invalidate an unchanged registration base.
    const more = await addVisit('while-edit-pending',{latitude:40,longitude:-120}); await approve(more.id);
    assertOk(await call(`/record-changes/${change.id}/review`,'POST',{decision:'Approved',comment:'Plant edit approved'},'officer'));
    const current = await resolvePlantRegistration(pool,f.plant_id);
    assert.equal(current.content.heightCm,45); assert.equal(current.content.latitude,5);
    assert.equal(current.observation_id,f.id); assert.deepEqual(current.photo_ids,original.photo_ids);
    const b = (await pool.query('SELECT content FROM plant_observation WHERE id=$1',[visit.id])).rows[0];
    assert.equal(b.content.heightCm,10); assert.equal(b.content.latitude,37.4219983);
    const row = assertOk(await call(`/plants/${f.plant_id}?scope=mine`)).plant;
    assert.equal(row.latitude,5); assert.equal(row.current_registration.content.heightCm,45);
    assert.equal(row.latest_verified_observation.id,more.id);
    assert.equal(row.latest_verified_observation.content.heightCm,10);
    assert.equal(row.latest_verified_observation.photo_ids.length,0);
    assert.equal((await call(`/record-changes/${change.id}/review`,'POST',{decision:'Approved',comment:'Replay'},'officer')).status,409);
  });
  await t.test('ambiguous legacy data stays in lists but cannot become a registration or edit base', async () => {
    const legacy = (await pool.query("INSERT INTO plant_record(species_id,registered_subject,qr_token,rbac_status) VALUES(1,'staff:bot','legacy','Approved') RETURNING plant_id")).rows[0];
    await pool.query("INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key) VALUES('legacy-observation',$1,'staff:bot','Approved','{\"latitude\":1,\"longitude\":110}','legacy')",[legacy.plant_id]);
    const row=assertOk(await call(`/plants/${legacy.plant_id}?scope=mine`)).plant;
    assert.equal(row.current_registration.state,'unavailable');assert.equal(row.latitude,null);
    assert.equal(row.plant_image_asset_id,null);
    const edit=await call('/record-changes','POST',{kind:'plant',target_id:legacy.plant_id,client_key:'legacy-edit',proposed:{species_id:1,scientific_name:'Legacy',content}});
    assert.equal(edit.status,409);
  });
});
