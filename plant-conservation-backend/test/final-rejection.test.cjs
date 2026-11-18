"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { once } = require("node:events");
const sharp = require("sharp");
const { createPlantDatabase } = require("./postgres-fixture.cjs");
const { createPlantApp } = require("../server.js");

test("final rejection, linked cascade and review cycles preserve submission identity", async t => {
  const pool = await createPlantDatabase();
  t.after(() => pool.end());
  // Migration 017 explicitly selects plant_app; keep this disposable fixture consistent.
  await pool.query("CREATE SCHEMA IF NOT EXISTS plant_app; SET search_path=plant_app,pg_catalog");
  await pool.query(readFileSync(join(__dirname, "../schema.postgres.sql"), "utf8"));
  const migration = name => readFileSync(join(__dirname, "../migrations", name), "utf8");
  for (const name of ["004-species-requests.sql", "006-atomic-plant-submissions.sql", "008-record-change-submissions.sql", "009-record-version-history.sql"])
    await pool.query(migration(name));
  const photo = await sharp({ create: { width: 3, height: 3, channels: 3, background: "green" } }).jpeg().toBuffer();
  await pool.query(`INSERT INTO species_request_submission(owner_subject,client_key,payload_hash,scientific_name,common_name,genus_name,family_name,conservation_status,description,habitat,photo)
    VALUES('staff:bot','legacy','legacy','Legacy','Common','Genus','Family','Least Concern','Description','Forest',$1)`, [photo]);
  await pool.query(migration("016-species-request-content-revision.sql"));
  await pool.query(migration("017-species-review-cycle.sql"));
  await pool.query(migration("016-species-request-content-revision.sql"));
  await pool.query(migration("017-species-review-cycle.sql"));
  const legacy = (await pool.query("SELECT content_revision,content_updated_at FROM species_request_submission WHERE client_key='legacy'")).rows[0];
  assert.deepEqual(legacy, { content_revision: 1, content_updated_at: null });
  const users = {
    bot: { id: "bot", role: "Botanist" }, other: { id: "other", role: "Botanist" },
    officer: { id: "officer", role: "Conservation Officer" }, second: { id: "second", role: "Conservation Officer" },
  };
  const tokens = Object.fromEntries(Object.keys(users).map((key, index) => [key, String(index + 1).repeat(64)]));
  const auth = { event: async () => {}, session: async token => {
    const key = Object.keys(tokens).find(key => tokens[key] === token);
    return key ? { ...users[key], status: "Active", mustChangePassword: false } : null;
  } };
  const server = createPlantApp({ pool, auth, origins: new Set() }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  async function call(path, body, role = "officer", method = body === undefined ? "GET" : "POST") {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { Authorization: `Bearer ${tokens[role]}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
  }
  let serial = 0;
  const proposal = name => ({ scientific_name: name, common_name: "Common", genus_name: "Genus", family_name: "Family", conservation_status: "Least Concern", description: "Description", habitat: "Forest" });
  async function create() {
    const data = proposal(`Revision species ${++serial}`);
    const result = await call("/species-requests", { ...data, photo: { content_type: "image/jpeg", base64: photo.toString("base64") }, client_key: `revision-${serial}` }, "bot");
    assert.equal(result.status, 201, JSON.stringify(result.data));
    assert.equal(result.data.species_request.content_revision, 1);
    return { id: result.data.species_request.request_id, data };
  }
  const stored = async id => (await pool.query("SELECT * FROM species_request_submission WHERE request_id=$1", [id])).rows[0];
  const edit = async (f, changes = {}) => call(`/my-species-requests/${f.id}`, { ...f.data, expected_revision: (await stored(f.id)).content_revision, ...changes }, "bot", "PATCH");
  const review = (f, decision, revision = 1, role = "officer") => call(`/species-requests/${f.id}/review`, {
    decision, expected_review_cycle: 1, comment: "Inspected proposal", visibility: "internal", ...(revision === undefined ? {} : { expected_revision: revision }),
  }, role);
  async function state() {
    const snapshot = {};
    for (const table of ["species_request_submission", "species", "rbac_species_visibility", "plant_asset", "business_audit", "record_version_history"])
      snapshot[table] = (await pool.query(`SELECT * FROM ${table}`)).rows;
    return snapshot;
  }

  await pool.query(`CREATE TABLE plant_app.qr_code(qr_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,plant_id integer,qr_code text,status text,assigned_at timestamptz);
    CREATE TABLE botanist_notification(id text PRIMARY KEY,recipient_subject text,type text,source_key text,observation_id text,review_id text,plant_id integer,metadata jsonb,created_at timestamptz DEFAULT CURRENT_TIMESTAMP,read_at timestamptz,UNIQUE(recipient_subject,source_key));`);
  async function linked() {
    const qr = (await pool.query("INSERT INTO plant_app.qr_code(qr_code,status) VALUES($1,'generated') RETURNING qr_id", ['qr-'+(++serial)])).rows[0];
    const data = proposal('Linked final '+serial), image={content_type:'image/jpeg',base64:photo.toString('base64')};
    const result = await call('/plant-submissions',{scientific_name:'Individual',latitude:4,longitude:113,qr_id:qr.qr_id,client_key:'final-'+serial,
      photos:[image,image,image],new_species:{...data,photo:image},content:{heightCm:20,healthStatus:'Healthy',lifeStage:'Mature',morphology:'Leaves'}},'bot');
    assert.equal(result.status,201,JSON.stringify(result.data));
    return {id:result.data.species_request_id,data,plantId:result.data.plant_id,observationId:result.data.id};
  }
  async function allState() {
    const result={};
    for(const table of ['species_request_submission','species','plant_record','plant_observation','plant_asset','plant_submission_receipt','observation_review','business_audit','botanist_notification','plant_app.qr_code']) result[table]=(await pool.query('SELECT * FROM '+table)).rows;
    return result;
  }
  await t.test('rejecting a shared pending species request closes both linked plant registrations', async () => {
    const first = await linked();
    const qr = (await pool.query("INSERT INTO plant_app.qr_code(qr_code,status) VALUES($1,'generated') RETURNING qr_id", ['shared-'+(++serial)])).rows[0];
    const image = { content_type: 'image/jpeg', base64: photo.toString('base64') };
    const second = await call('/plant-submissions', { scientific_name: 'Second individual', latitude: 4, longitude: 113,
      qr_id: qr.qr_id, client_key: 'shared-'+serial, species_request_id: first.id,
      photos: [image,image,image], content: { heightCm: 21, healthStatus: 'Healthy', lifeStage: 'Mature', morphology: 'Leaves' } }, 'bot');
    assert.equal(second.status, 201, JSON.stringify(second.data));
    assert.equal(second.data.species_request_id, first.id);
    assert.notEqual(second.data.plant_id, first.plantId);
    const result = await review({ id: first.id }, 'Rejected');
    assert.equal(result.status, 200, JSON.stringify(result.data));
    for (const plantId of [first.plantId, second.data.plant_id])
      assert.equal((await pool.query('SELECT rbac_status FROM plant_record WHERE plant_id=$1', [plantId])).rows[0].rbac_status, 'Rejected');
    for (const observationId of [first.observationId, second.data.id])
      assert.equal((await pool.query('SELECT status FROM plant_observation WHERE id=$1', [observationId])).rows[0].status, 'Rejected');
    assert.equal((await pool.query('SELECT count(*)::integer AS n FROM observation_review WHERE species_request_id=$1', [first.id])).rows[0].n, 2);
  });
  await t.test('shared request correction keeps both plants linked to one request', async () => {
    const first = await linked();
    const qr = (await pool.query("INSERT INTO plant_app.qr_code(qr_code,status) VALUES($1,'generated') RETURNING qr_id", ['correction-'+(++serial)])).rows[0];
    const image = { content_type: 'image/jpeg', base64: photo.toString('base64') };
    const second = await call('/plant-submissions', { scientific_name: 'Corrected partner', latitude: 4, longitude: 113,
      qr_id: qr.qr_id, client_key: 'correction-'+serial, species_request_id: first.id,
      photos: [image,image,image], content: { heightCm: 21, healthStatus: 'Healthy', lifeStage: 'Mature', morphology: 'Leaves' } }, 'bot');
    assert.equal(second.status, 201, JSON.stringify(second.data));
    assert.equal((await review({ id: first.id }, 'Correction Required')).status, 200);
    assert.equal((await edit(first)).status, 200);
    assert.equal((await stored(first.id)).request_status, 'Pending Review');
    assert.equal((await pool.query('SELECT count(*)::integer AS n FROM species_request_submission WHERE request_id=$1', [first.id])).rows[0].n, 1);
    assert.equal((await pool.query('SELECT species_id FROM plant_record WHERE plant_id=$1', [first.plantId])).rows[0].species_id,
      (await pool.query('SELECT species_id FROM plant_record WHERE plant_id=$1', [second.data.plant_id])).rows[0].species_id);
  });
  await t.test('unchanged correction resubmission opens a new review cycle and rejects every old/missing cycle',async()=>{
    const f=await create();
    assert.equal((await review(f,'Correction Required')).status,200);
    assert.equal((await edit(f)).status,200);
    const row=await stored(f.id);assert.equal(row.content_revision,1);assert.equal(row.review_cycle,2);
    assert.equal((await edit(f)).status,200);assert.equal((await stored(f.id)).review_cycle,2);
    for(const cycle of [undefined,null,0,'2',1,2.5]){
      const before=await allState();
      const result=await call('/species-requests/'+f.id+'/review',{decision:'Approved',visibility:'internal',expected_revision:1,expected_review_cycle:cycle});
      assert.equal(result.status,409);assert.equal(result.data.code,'SPECIES_REQUEST_REVIEW_CYCLE_CONFLICT');assert.deepEqual(await allState(),before);
    }
    assert.equal((await call('/species-requests/'+f.id+'/review',{decision:'Approved',visibility:'internal',expected_revision:1,expected_review_cycle:2})).status,200);
  });
  await t.test('standalone final rejection cannot reopen and does not change plants',async()=>{
    const f=await create(),plants=(await pool.query('SELECT * FROM plant_record')).rows;
    assert.equal((await review(f,'Rejected')).status,200);
    const before=await allState();const result=await edit(f);assert.equal(result.status,409);assert.equal(result.data.code,'SUBMISSION_REJECTED');
    assert.deepEqual(await allState(),before);assert.deepEqual((await pool.query('SELECT * FROM plant_record')).rows,plants);
  });
  await t.test('linked rejection is atomic, attributed and preserves QR, receipts and evidence',async()=>{
    const f=await linked(), before=await allState();
    const unrelated=(await pool.query("INSERT INTO plant_record(species_id,registered_subject,qr_token,rbac_status) VALUES($1,'staff:other','unrelated','Pending Review') RETURNING plant_id",[(await stored(f.id)).proposed_species_id])).rows[0];
    const result=await review(f,'Rejected');assert.equal(result.status,200,JSON.stringify(result.data));
    const after=await allState();assert.equal((await stored(f.id)).request_status,'Rejected');
    assert.equal(after.plant_observation.find(row=>row.id===f.observationId).status,'Rejected');
    assert.equal(after.plant_record.find(row=>row.plant_id===f.plantId).rbac_status,'Rejected');
    assert.equal(after.plant_record.find(row=>row.plant_id===unrelated.plant_id).rbac_status,'Pending Review');
    for(const table of ['plant_asset','plant_submission_receipt','plant_app.qr_code'])assert.deepEqual(after[table],before[table]);
    const history=after.observation_review.find(row=>row.observation_id===f.observationId);
    assert.equal(history.review_origin,'species_dependency');assert.equal(history.species_request_id,f.id);assert.equal(history.id,(await stored(f.id)).review_decision_id);
    assert.equal(after.botanist_notification.filter(row=>row.review_id===history.id).length,1);
    assert.equal((await review(f,'Rejected')).status,409);
    const stable=await allState();assert.equal((await edit(f)).status,409);
    const content={heightCm:21,healthStatus:'Healthy',lifeStage:'Mature',morphology:'Leaves',latitude:4,longitude:113};
    assert.equal((await call('/observations/'+f.observationId,{revision:2,content},'bot','PATCH')).data.code,'SUBMISSION_REJECTED');
    assert.equal((await call('/observations/'+f.observationId+'/submit',{},'bot')).data.code,'SUBMISSION_REJECTED');
    assert.equal((await call('/my-plants/'+f.plantId,{species_id:after.plant_record.find(row=>row.plant_id===f.plantId).species_id,scientific_name:'Individual',content,expected_revision:2},'bot','PATCH')).data.code,'SUBMISSION_REJECTED');
    assert.deepEqual(await allState(),stable);
    assert.equal((await call('/observations/'+f.observationId)).status,200);
  });
  await t.test('inconsistent and already approved parents fail without partial writes',async()=>{
    for(const mode of ['approved','missing','wrong_owner','subsequent','duplicate']){
      const f=await linked();
      if(mode==='approved')await pool.query("UPDATE plant_record SET rbac_status='Approved' WHERE plant_id=$1",[f.plantId]);
      else if(mode==='missing') await pool.query("DELETE FROM plant_submission_receipt WHERE result->>'species_request_id'=$1",[String(f.id)]);
      else if(mode==='wrong_owner') await pool.query("UPDATE plant_record SET registered_subject='staff:other' WHERE plant_id=$1",[f.plantId]);
      else if(mode==='subsequent') await pool.query("UPDATE plant_observation SET origin_type='subsequent_observation' WHERE id=$1",[f.observationId]);
      else await pool.query("INSERT INTO plant_submission_receipt(owner_subject,client_key,payload_hash,result) SELECT 'staff:other',client_key||'-duplicate',payload_hash,result FROM plant_submission_receipt WHERE result->>'species_request_id'=$1",[String(f.id)]);
      const before=await allState(),result=await review(f,'Rejected');assert.equal(result.status,409);assert.equal(result.data.code,'SPECIES_REQUEST_LINK_CONFLICT');assert.deepEqual(await allState(),before);
    }
  });
  await t.test('audit failure rolls back both rejections, history and notification',async()=>{
    const f=await linked();await pool.query("ALTER TABLE business_audit ADD CONSTRAINT fail_cascade CHECK(action<>'linked_registration_auto_rejected') NOT VALID");
    const before=await allState();assert.ok((await review(f,'Rejected')).status>=400);assert.deepEqual(await allState(),before);
    await pool.query('ALTER TABLE business_audit DROP CONSTRAINT fail_cascade');
  });
  await t.test('subsequent rejected records are terminal while correction and Flagged followups remain valid',async()=>{
    const f=await create();assert.equal((await review(f,'Approved')).status,200);
    const species=(await stored(f.id)).approved_species_id;
    const plant=(await pool.query("INSERT INTO plant_record(species_id,registered_subject,qr_token,rbac_status) VALUES($1,'staff:bot','subsequent-final','Approved') RETURNING plant_id",[species])).rows[0].plant_id;
    const content={heightCm:20,healthStatus:'Healthy',lifeStage:'Mature',morphology:'Leaves'};
    const made=await call('/plants/'+plant+'/observations',{content,client_key:'subsequent-one'},'bot');const id=made.data.id;
    assert.equal((await call('/observations/'+id+'/submit',{},'bot')).status,200);assert.equal((await call('/observations/'+id+'/submit',{},'bot')).status,200);
    assert.equal((await call('/observations/'+id+'/review',{decision:'Flagged',comment:'Inspect',revision:1})).status,200);
    assert.equal((await call('/observations/'+id+'/review',{decision:'Correction Required',comment:'Correct',revision:2})).status,200);
    assert.equal((await call('/observations/'+id+'/submit',{},'bot')).status,409);
    assert.equal((await call('/observations/'+id,{content,revision:3},'bot','PATCH')).status,200);
    assert.equal((await call('/observations/'+id+'/submit',{},'bot')).status,200);
    const results=await Promise.all(['officer','second'].map(role=>call('/observations/'+id+'/review',{decision:'Rejected',comment:'Final',revision:4},role)));
    assert.deepEqual(results.map(row=>row.status).sort(),[200,409]);
    const before=await allState();assert.equal((await call('/observations/'+id,{content,revision:5},'bot','PATCH')).status,409);assert.equal((await call('/observations/'+id+'/submit',{},'bot')).status,409);assert.deepEqual(await allState(),before);
    assert.equal((await pool.query('SELECT rbac_status FROM plant_record WHERE plant_id=$1',[plant])).rows[0].rbac_status,'Approved');
    assert.equal((await call('/plants/'+plant+'/observations',{content,client_key:'separate-new'},'bot')).status,201);
  });
  await t.test('direct initial rejection checks observation status even while plant status remains Pending Review',async()=>{
    const f=await linked();assert.equal((await review(f,'Approved')).status,200);
    assert.equal((await call('/observations/'+f.observationId+'/review',{decision:'Rejected',comment:'Final observation rejection',revision:1})).status,200);
    assert.equal((await pool.query('SELECT rbac_status FROM plant_record WHERE plant_id=$1',[f.plantId])).rows[0].rbac_status,'Pending Review');
    const content={heightCm:20,healthStatus:'Healthy',lifeStage:'Mature',morphology:'Leaves',latitude:4,longitude:113};
    const before=await allState();
    assert.equal((await call('/my-plants/'+f.plantId,{species_id:(await stored(f.id)).approved_species_id,scientific_name:'Individual',content,expected_revision:2},'bot','PATCH')).data.code,'SUBMISSION_REJECTED');
    assert.equal((await call('/observations/'+f.observationId,{content,revision:2},'bot','PATCH')).data.code,'SUBMISSION_REJECTED');
    assert.deepEqual(await allState(),before);
  });
  await t.test('changed correction content and partial migration states fail safely',async()=>{
    const f=await create();assert.equal((await review(f,'Correction Required')).status,200);
    assert.equal((await edit(f,{habitat:'Corrected forest'})).status,200);
    assert.equal((await stored(f.id)).content_revision,2);assert.equal((await stored(f.id)).review_cycle,2);
    assert.equal((await call('/species-requests/'+f.id+'/review',{decision:'Approved',visibility:'internal',expected_revision:2,expected_review_cycle:1})).status,409);
    await pool.query('ALTER TABLE species_request_submission DISABLE TRIGGER species_request_review_cycle');
    const before=await allState();assert.equal((await call('/species-requests/'+f.id+'/review',{decision:'Approved',visibility:'internal',expected_revision:2,expected_review_cycle:2})).status,503);assert.deepEqual(await allState(),before);
    await pool.query('ALTER TABLE species_request_submission ENABLE TRIGGER species_request_review_cycle');
  });
  await t.test('two Officers competing on linked requests cannot duplicate cascade effects',async()=>{
    const f=await linked();
    const results=await Promise.all([review(f,'Rejected'),review(f,'Approved',1,'second')]);
    assert.deepEqual(results.map(row=>row.status).sort(),[200,409]);
    assert.equal((await pool.query("SELECT count(*)::integer AS n FROM business_audit WHERE action='species_request_reviewed' AND target=$1",[String(f.id)])).rows[0].n,1);
    assert.ok((await pool.query('SELECT count(*)::integer AS n FROM observation_review WHERE observation_id=$1',[f.observationId])).rows[0].n<=1);
  });

  await t.test('Flagged and already rejected parent states are handled without reversing earlier decisions',async()=>{
    for(const status of ['Flagged','Rejected']){
      const f=await linked();await pool.query('UPDATE plant_observation SET status=$1 WHERE id=$2',[status,f.observationId]);
      if(status==='Rejected')await pool.query("UPDATE plant_record SET rbac_status='Rejected' WHERE plant_id=$1",[f.plantId]);
      assert.equal((await review(f,'Rejected')).status,200);
      assert.equal((await pool.query('SELECT status FROM plant_observation WHERE id=$1',[f.observationId])).rows[0].status,'Rejected');
      assert.equal((await pool.query('SELECT count(*)::integer AS n FROM observation_review WHERE observation_id=$1',[f.observationId])).rows[0].n,status==='Rejected'?0:1);
    }
  });
  await t.test('pending Botanist edit competing with cascade leaves the registration terminal and consistent',async()=>{
    const f=await linked(), request=await stored(f.id);
    const results=await Promise.all([
      call('/my-plants/'+f.plantId,{species_id:request.proposed_species_id,scientific_name:'Edited individual',expected_revision:1,content:{heightCm:25,healthStatus:'Healthy',lifeStage:'Mature',morphology:'Leaves',latitude:4,longitude:113}},'bot','PATCH'),
      review(f,'Rejected')]);
    assert.ok([200,409].includes(results[0].status));assert.equal(results[1].status,200);
    assert.equal((await pool.query('SELECT status FROM plant_observation WHERE id=$1',[f.observationId])).rows[0].status,'Rejected');
    assert.equal((await pool.query('SELECT rbac_status FROM plant_record WHERE plant_id=$1',[f.plantId])).rows[0].rbac_status,'Rejected');
  });

});


test('busy parent locks return a retry conflict before cascade writes',async()=>{
 const { rejectLinkedRegistration }=require('../linked-species-rejection.cjs');
 let writes=0;
 const request={request_id:1,owner_subject:'staff:bot',client_key:'key',proposed_species_id:2};
 const c={query:async sql=>{
  if(sql.includes('to_regclass'))return {rows:[{available:true}]};
  if(sql.includes('FROM plant_submission_receipt'))return {rows:[{owner_subject:'staff:bot',client_key:'key',result:{id:'observation',plant_id:3,species_id:2}}]};
  if(sql.includes('FOR UPDATE NOWAIT'))throw Object.assign(Error('busy'),{code:'55P03'});
  writes++;throw Error('Unexpected write');
 }};
 await assert.rejects(rejectLinkedRegistration(c,request,{id:'officer'},'Reason','decision',async()=>{writes++;}),error=>error.status===409&&error.code==='SPECIES_REQUEST_REVIEW_BUSY');
 assert.equal(writes,0);
});
