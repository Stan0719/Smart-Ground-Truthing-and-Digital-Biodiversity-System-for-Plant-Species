"use strict";
const test = require('node:test'), assert = require('node:assert/strict');
const { once } = require('node:events'), { readFileSync } = require('node:fs'), { join } = require('node:path');
const { createPlantDatabase } = require('./postgres-fixture.cjs');
const { createPlantApp } = require('../server.js');
const { permitted } = require('../../shared/rbac.cjs');
test('Plant Detail page reads are scoped, paginated and private', async t => {
  const pool = await createPlantDatabase(); t.after(() => pool.end());
  for (const name of ['004-species-requests.sql', '006-atomic-plant-submissions.sql']) await pool.query(readFileSync(join(__dirname, '../migrations', name), 'utf8'));
  await pool.query(`INSERT INTO family(family_id,family_name) VALUES(1,'Family');
    INSERT INTO genus(genus_id,family_id,genus_name) VALUES(1,1,'Genus');
    INSERT INTO species(species_id,scientific_name,common_name,genus_id,description,rbac_data) VALUES
      (1,'Species name','Common name',1,'Description','{}'),(2,'Secret species','Secret',1,'Protected','{}');
    INSERT INTO rbac_species_visibility VALUES(1,'public'),(2,'protected');
    INSERT INTO plant_record(plant_id,species_id,scientific_name,registered_subject,rbac_status,qr_token) VALUES
      (1,1,'Individual name','staff:bot','Approved','one'),(2,2,'Protected plant','staff:bot','Approved','two'),
      (3,1,'Pending plant','staff:bot','Pending Review','three');`);
  const statuses = ['Approved','Pending Review','Rejected','Flagged','Correction Required','Draft'];
  for (const [i, status] of statuses.entries()) {
    await pool.query(`INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,origin_type,created_at,updated_at)
      VALUES($1,1,$2,$3,$4,$1,$5,'2026-11-01 10:00:00.123456+00',$6)`,
    [`obs-${i}`, i === 5 ? 'staff:deleted' : 'staff:bot', status,
      {heightCm:12,healthStatus:'Healthy',lifeStage:'Mature',morphology:'Real morphology',notes:`Notes ${i}`,latitude:4,longitude:113,accuracy_m:5,altitudeM:18,zone:'Submitted'},
      i === 0 ? 'unknown' : 'subsequent_observation', i === 0 ? '2026-11-01' : '2026-11-02']);
    await pool.query(`INSERT INTO plant_asset(id,plant_id,observation_id,owner_subject,client_key,approved,content_type,content)
      VALUES($1,1,$2,'staff:bot',$3,FALSE,'image/jpeg',$4)`, [`photo-${i}`, `obs-${i}`, `capture-${i}:photo:0`, Buffer.from(`image ${i}`)]);
  }
  await pool.query(`INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,origin_type) VALUES
    ('foreign',2,'staff:other','Pending Review','{}','foreign','subsequent_observation'),
    ('new-approved',1,'staff:bot','Approved','{"latitude":5,"longitude":114,"zone":"Approved"}','new','subsequent_observation');
    INSERT INTO observation_review(id,observation_id,reviewer_subject,decision,comment) VALUES('review','obs-2','staff:officer','Rejected','Please correct');`);
  await pool.query(`INSERT INTO plant_submission_receipt(owner_subject,client_key,payload_hash,result) VALUES('staff:bot','obs-0',$1,$2)`,
    ['a'.repeat(64),{plant_id:1,id:'obs-0',species_id:1,qr_token:'fixture',status:'Pending Review',species_request_id:null}]);
  for (const [id, plant, observation, species] of [['bad-link',1,'foreign',null],['foreign-photo',2,'foreign',null],['reference',null,null,1]]) {
    await pool.query(`INSERT INTO plant_asset(id,plant_id,observation_id,species_id,owner_subject,client_key,content_type,content)
      VALUES($1,$2,$3,$4,'staff:bot',$1,'image/jpeg',$5)`,[id,plant,observation,species,Buffer.from(id)]);
  }
  const users = Object.fromEntries(['officer','admin','bot','visitor','inactive','reset'].map(id => [id,{ id,
    role: id === 'admin' ? 'Administrator' : id === 'bot' ? 'Botanist' : id === 'visitor' ? 'Visitor' : 'Conservation Officer',
    status: id === 'inactive' ? 'Inactive' : 'Active', mustChangePassword: id === 'reset' }]));
  const tokens = Object.fromEntries(Object.keys(users).map((id,i) => [id,String(i+1).repeat(64)]));
  const auth = { session: async token => users[Object.keys(tokens).find(id => tokens[id] === token)] ?? null, event: async () => {},
    db: { prepare: () => ({ get: async id => id === 'bot' ? {name:'Real Botanist',role:'Botanist'} : null }) } };
  const server = createPlantApp({pool,auth,origins:new Set()}).listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const call = async (path, role, method = 'GET', body) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{...(role ? {Authorization:`Bearer ${tokens[role]}`} : {}),...(body ? {'Content-Type':'application/json'} : {})},...(body ? {body:JSON.stringify(body)} : {})});
    return { status:r.status, data:r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() };
  };
  await t.test('visitors receive exactly six information fields and no preloaded staff evidence', async () => {
    for (const role of [undefined,'visitor','bot']) {
      const r = await call('/plants/1/detail',role); assert.equal(r.status,200); assert.equal(r.data.staff,null);
      assert.deepEqual(Object.keys(r.data.information).sort(),['plant_id','scientific_name','common_name','genus_name','family_name','description'].sort());
      assert.equal(r.data.information.scientific_name,'Individual name');
      assert.ok(!JSON.stringify(r.data).includes('staff:'));
      for (const suffix of ['history','gallery','assets/photo-0']) assert.equal((await call('/plants/1/detail/'+suffix,role)).status, role ? 403 : 401);
      assert.equal((await call('/plants/2/detail',role)).status,404);
      assert.equal((await call('/plants/3/detail',role)).status,404);
    }
  });
  await t.test('Officer and Admin read protected records without write or general Admin access', async () => {
    for (const role of ['officer','admin']) {
      const r = await call('/plants/1/detail',role); assert.equal(r.status,200); assert.equal(r.data.staff.approved_location.zone,'Approved');
      assert.equal((await call('/plants/2/detail',role)).status,200);
      assert.equal((await call('/plants/3/detail',role)).status,200);
      for (const permission of ['plants.create','observations.create','observations.edit.own']) assert.equal(permitted(users[role],permission),false);
    }
    for (const permission of ['observations.review','species.manage','plants.scientific.read','plants.public.read']) assert.equal(permitted(users.admin,permission),false);
    assert.equal((await call('/plants','admin')).status,403);
    assert.equal((await call('/plants','admin','POST',{})).status,403);
    assert.equal((await call('/assets','admin','POST',{})).status,403);
    assert.equal((await call('/observations/obs-1/review','admin','POST',{})).status,403);
    for (const role of ['inactive','reset']) {
      for (const suffix of ['', '/history','/gallery','/assets/photo-0']) assert.equal((await call('/plants/1/detail'+suffix,role)).status,403);
    }
  });
  await t.test('all history pages retain real rows, microsecond ordering, identity and exact photo linkage', async () => {
    for (const role of ['officer','admin']) {
      let cursor = null, rows = [], pages = 0;
      do {
        const r = await call('/plants/1/detail/history?limit=2'+(cursor ? '&cursor='+cursor : ''),role);
        assert.equal(r.status,200,JSON.stringify(r.data)); rows.push(...r.data.observations); pages++;
        assert.equal(r.data.page.has_more, r.data.page.next_cursor !== null); cursor = r.data.page.next_cursor;
        assert.ok(pages < 10);
      } while(cursor);
      assert.equal(rows.length,7); assert.equal(new Set(rows.map(o=>o.id)).size,7);
      assert.deepEqual(rows.slice(1).map(o=>o.id),['obs-5','obs-4','obs-3','obs-2','obs-1','obs-0']);
      assert.equal(rows.find(o=>o.id==='obs-0').origin,'initial_registration');
      assert.equal(rows.find(o=>o.id==='obs-5').recorded_by,null);
      assert.equal(rows.find(o=>o.id==='obs-2').review.comment,'Please correct');
      for (const o of rows) {
        if(o.id!=='obs-5') assert.equal(o.recorded_by,'Real Botanist');
        assert.ok(!JSON.stringify(o).includes('staff:'));
        for (const a of o.assets) { assert.equal(a.id,'photo-'+o.id.split('-')[1]); assert.equal((await call('/plants/1/detail/assets/'+a.id,role)).status,200); }
      }
    }
  });
  await t.test('registration gallery and byte reads agree for every status without species or foreign photos', async () => {
    for (const role of ['officer','admin']) {
      const r = await call('/plants/1/detail/gallery',role); assert.equal(r.status,200,JSON.stringify(r.data)); assert.equal(r.data.assets.length,1);
      assert.deepEqual(r.data.assets.filter(a=>a.effective_origin==='initial_registration').map(a=>a.asset_id),['photo-0']);
      for(const a of r.data.assets) assert.equal((await call('/plants/1/detail/assets/'+a.asset_id,role)).status,200);
      for(const id of ['reference','foreign-photo','bad-link','missing']) assert.equal((await call('/plants/1/detail/assets/'+id,role)).status,404);
    }
    assert.equal((await call('/assets/photo-0')).status,404); // Historical bytes were not globally loosened.
  });
  await t.test('history rejects invalid cursors and unavailable parents', async () => {
    const first = await call('/plants/1/detail/history?limit=1','officer');
    assert.equal((await call('/plants/2/detail/history?cursor='+first.data.page.next_cursor,'officer')).status,400);
    for(const query of ['limit=0','limit=101','cursor=invalid','scope=mine','limit[]=2']) assert.equal((await call('/plants/1/detail/history?'+query,'officer')).status,400);
    assert.equal((await call('/plants/999/detail/history','officer')).status,404);
    assert.equal((await call('/plants/3/detail/history','officer')).data.observations.length,0);
  });
});
