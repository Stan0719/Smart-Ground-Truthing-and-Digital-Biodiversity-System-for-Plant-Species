"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { once } = require("node:events");
const sharp = require("sharp");
const { createPlantDatabase } = require("./postgres-fixture.cjs");
const { createPlantApp } = require("../server.js");
const { observationHistory, speciesHistory } = require("../historical-reviews.cjs");

test("approval history with Migration 028 in isolated PGlite",async t=>{
  const pool = await createPlantDatabase(); t.after(() => pool.end());
  for (const name of ["004-species-requests.sql","006-atomic-plant-submissions.sql","008-record-change-submissions.sql","009-record-version-history.sql","016-species-request-content-revision.sql","017-species-review-cycle.sql","028-immutable-record-version-revisions.sql"])
    await pool.query(readFileSync(join(__dirname,"../migrations/"+name),"utf8"));
  const photo = await sharp({create:{width:4,height:4,channels:3,background:"green"}}).jpeg().toBuffer();
  await pool.query(`INSERT INTO species(scientific_name,rbac_data) VALUES('Catalogue original','{"approvalStatus":"Approved"}');
    INSERT INTO rbac_species_visibility VALUES(1,'public');
    INSERT INTO plant_record(plant_id,species_id,registered_subject,scientific_name,rbac_status,qr_token)
      VALUES(24,1,'staff:bot','Original plant','Pending Review','fixture-only');
    INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,origin_type)
      VALUES('24',24,'staff:bot','Pending Review','{"heightCm":12,"healthStatus":"Healthy","lifeStage":"Mature","morphology":"Original","notes":"Original notes","zone":"Original zone"}','original','initial_registration');
    CREATE TABLE plant_app.qr_code(qr_id INTEGER PRIMARY KEY,plant_id INTEGER,qr_code TEXT,status TEXT,assigned_at TIMESTAMPTZ,activated_at TIMESTAMPTZ,retired_at TIMESTAMPTZ);
    INSERT INTO plant_app.qr_code(qr_id,plant_id,qr_code,status) VALUES(1,24,'fixture-only','assigned')`);
  for (let i=0;i<3;i++) await pool.query("INSERT INTO plant_asset(id,plant_id,owner_subject,client_key,observation_id,approved,content_type,content) VALUES($1,24,'staff:bot',$1,'24',FALSE,'image/jpeg',$2)", ["original-"+i,photo]);
  const tokens = {bot:"1".repeat(64),officer:"2".repeat(64)};
  const server = createPlantApp({pool,auth:{session:async token => token===tokens.bot ? {id:"bot",role:"Botanist",status:"Active",mustChangePassword:false} : token===tokens.officer ? {id:"officer",role:"Conservation Officer",status:"Active",mustChangePassword:false} : null,event:async()=>{}}}).listen(0,"127.0.0.1");
  await once(server,"listening");t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const call = async(path,role="officer",method="GET",body) => {
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api`+path,{method,headers:{Authorization:`Bearer ${tokens[role]}`,"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
    const data=await response.json();assert.ok(response.status<300,JSON.stringify(data));return data;
  };

  const raw=async(path,body)=>fetch(`http://127.0.0.1:${server.address().port}/api`+path,{method:"POST",headers:{Authorization:`Bearer ${tokens.officer}`,"Content-Type":"application/json"},body:JSON.stringify(body)});
  async function seedObservation(id,status="Pending Review",history=true){
    await pool.query(`INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,origin_type)
      VALUES($1,24,'staff:bot',$2,'{}',$1,'initial_registration')`,[id,status]);
    if(history)await pool.query(`INSERT INTO record_version_history(id,record_type,plant_id,version_number,owner_subject,edited_by,status,snapshot)
      SELECT $1,'plant',24,COALESCE(MAX(version_number),0)+1,'staff:bot','staff:bot',$2,$3 FROM record_version_history WHERE plant_id=24`,
      ['submitted-'+id,status,{observation_id:id,content:{original:true},photo_ids:['original-0']}]);
  }
  for(const decision of ['Approved','Rejected','Correction Required']){
    await t.test('Flagged follow-up '+decision,async()=>{
      const id='flag-'+decision;await seedObservation(id,'Flagged');
      const before=(await pool.query('SELECT snapshot FROM record_version_history WHERE id=$1',['submitted-'+id])).rows[0].snapshot;
      await call('/observations/'+id+'/review','officer','POST',{decision,revision:1,comment:'Follow up'});
      const source=(await pool.query('SELECT * FROM record_version_history WHERE id=$1',['submitted-'+id])).rows[0];
      assert.equal(source.status,decision);assert.deepEqual(source.snapshot,before);
    });
  }
  await t.test('pending approval appends provenance, retains evidence, is idempotent and reader-compatible',async()=>{
    await seedObservation('pending');
    await call('/observations/pending/review','officer','POST',{decision:'Approved',revision:1});
    const versions=(await pool.query("SELECT * FROM record_version_history WHERE snapshot->>'observation_id'='pending' ORDER BY version_number")).rows;
    assert.equal(versions.length,2);assert.equal(versions[0].snapshot.content.original,true);
    const provenance=versions[1].snapshot.review_provenance;
    assert.equal(provenance.source_submitted_history_id,'submitted-pending');assert.equal(provenance.evidence_type,'approval_capture');
    const {transaction}=require('../domain.cjs');
    await transaction(pool,c=>require('../historical-reviews.cjs').captureApprovedReview(c,{kind:'plant',submissionId:'pending',reviewId:provenance.review_id,reviewer:'staff:officer',versionId:versions[0].id}));
    assert.equal((await pool.query("SELECT COUNT(*)::int n FROM record_version_history WHERE snapshot->'review_provenance'->>'review_id'=$1",[provenance.review_id])).rows[0].n,1);
    const result=await observationHistory(pool,[{id:'pending',plant_id:24,status:'Approved'}]);assert.equal(result[0].historical_review.state,'available');
    await assert.rejects(pool.query("UPDATE record_version_history SET snapshot='{}' WHERE id='submitted-pending'"),/immutable/);
  });
  await t.test('Superseded approval captures still require exact event, submission, Plant, reviewer and timestamp evidence',async()=>{
    for(const scenario of ['valid','valid-missing-photo','pending','rejected','wrong-kind','wrong-plant','wrong-observation','wrong-submission','wrong-review','wrong-reviewer','wrong-time','late-capture','non-approval']){
      const observationId='evidence-'+scenario;
      await seedObservation(observationId,'Approved',false);
      const review=(await pool.query("INSERT INTO observation_review(id,observation_id,reviewer_subject,decision,comment) VALUES('review-'||$1,$1,'staff:officer',$2,'Fixture') RETURNING id,created_at",[observationId,scenario==='non-approval'?'Rejected':'Approved'])).rows[0];
      const snapshot={plant_id:scenario==='wrong-plant'?999:24,observation_id:scenario==='wrong-observation'?'unrelated':observationId,content:{heightCm:20},species_id:1,scientific_name:'Original plant',species_scientific_name:'Catalogue original',common_name:'Original',photo_ids:scenario==='valid-missing-photo'?['unavailable-photo']:['original-0'],
        review_provenance:{kind:scenario==='wrong-kind'?'species':'plant',submission_id:scenario==='wrong-submission'?'unrelated':observationId,review_id:scenario==='wrong-review'?'unrelated':review.id}};
      await pool.query(`INSERT INTO record_version_history(id,record_type,plant_id,version_number,owner_subject,edited_by,status,snapshot,reviewed_by,reviewed_at,created_at)
        SELECT $1,'plant',24,COALESCE(MAX(version_number),0)+1,'staff:bot','staff:bot',$2,$3,$4,$5::timestamptz + ($6::integer * INTERVAL '1 second'),$5::timestamptz + ($7::integer * INTERVAL '1 second') FROM record_version_history WHERE plant_id=24`,
        ['capture-'+scenario,scenario==='pending'?'Pending Review':scenario==='rejected'?'Rejected':'Superseded',snapshot,scenario==='wrong-reviewer'?'staff:other':'staff:officer',review.created_at,scenario==='wrong-time'?1:0,scenario==='late-capture'?1:0]);
      const history=(await observationHistory(pool,[{id:observationId,plant_id:24,status:'Approved',content:{heightCm:999},assets:[{id:'unverified'}]}]))[0].historical_review;
      assert.equal(history.state,scenario.startsWith('valid')?'available':'unavailable',scenario);
      if(scenario==='valid-missing-photo'){assert.equal(history.fields.content.heightCm,20);assert.deepEqual(history.assets,[]);assert.equal(history.photos_unavailable,true);continue;}
      if(scenario==='valid'){assert.equal(history.fields.content.heightCm,20);assert.deepEqual(history.assets,[{id:'original-0',content_type:'image/jpeg'}]);
        assert.equal((await observationHistory(pool,[{id:observationId,plant_id:999,status:'Approved'}]))[0].historical_review.state,'unavailable');}
      else {assert.deepEqual(history.fields,{});assert.deepEqual(history.assets,[]);}
    }
    await seedObservation('no-original-capture','Approved',false);
    const absent=(await observationHistory(pool,[{id:'no-original-capture',plant_id:24,status:'Approved',content:{heightCm:999}}]))[0].historical_review;
    assert.deepEqual(absent,{state:'unavailable',assets:[],fields:{}});
  });
  await t.test('history-free legacy approval and competing reviews',async()=>{
    await seedObservation('legacy','Pending Review',false);
    const results=await Promise.all([raw('/observations/legacy/review',{decision:'Approved',revision:1}),raw('/observations/legacy/review',{decision:'Approved',revision:1})]);
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    assert.equal((await pool.query("SELECT COUNT(*)::int n FROM observation_review WHERE observation_id='legacy'")).rows[0].n,1);
    assert.equal((await pool.query("SELECT COUNT(*)::int n FROM record_version_history WHERE snapshot->>'observation_id'='legacy'")).rows[0].n,1);
  });
  await t.test('failed capture rolls back canonical state, source metadata and review',async()=>{
    await seedObservation('rollback');
    await pool.query("ALTER TABLE record_version_history ADD CONSTRAINT reject_capture CHECK(NOT(snapshot ? 'review_provenance')) NOT VALID");
    try{
      const response=await raw('/observations/rollback/review',{decision:'Approved',revision:1});assert.ok(response.status>=400);
      assert.equal((await pool.query("SELECT status FROM plant_observation WHERE id='rollback'")).rows[0].status,'Pending Review');
      assert.equal((await pool.query("SELECT status FROM record_version_history WHERE id='submitted-rollback'")).rows[0].status,'Pending Review');
      assert.equal((await pool.query("SELECT COUNT(*)::int n FROM observation_review WHERE observation_id='rollback'")).rows[0].n,0);
    }finally{await pool.query('ALTER TABLE record_version_history DROP CONSTRAINT reject_capture')}
  });
  for (const decision of ['Rejected','Correction Required']) await t.test('pending metadata-only '+decision,async()=>{
    const id='pending-'+decision;await seedObservation(id);
    await call('/observations/'+id+'/review','officer','POST',{decision,revision:1,comment:'Reason'});
    const source=(await pool.query('SELECT status,snapshot FROM record_version_history WHERE id=$1',['submitted-'+id])).rows[0];
    assert.equal(source.status,decision);assert.equal(source.snapshot.content.original,true);
    assert.equal((await pool.query("SELECT COUNT(*)::int n FROM record_version_history WHERE snapshot->'review_provenance'->>'submission_id'=$1",[id])).rows[0].n,0);
  });
  for(const decision of ['Rejected','Correction Required']) await t.test('Species submitted history '+decision,async()=>{
    const request=(await pool.query(`INSERT INTO species_request_submission(owner_subject,client_key,payload_hash,scientific_name,common_name,genus_name,family_name,conservation_status,description,habitat,photo)
      VALUES('staff:bot',$1,'hash',$1,'Common','Genus','Family','Least Concern','Description','Habitat',$2) RETURNING *`,['species-'+decision,photo])).rows[0];
    await pool.query(`INSERT INTO record_version_history(id,record_type,request_id,version_number,owner_subject,edited_by,status,snapshot,species_photo)
      VALUES($1,'species',$2,1,'staff:bot','staff:bot','Pending Review',$3,$4)`,['source-'+decision,request.request_id,{request_id:request.request_id},photo]);
    await call('/species-requests/'+request.request_id+'/review','officer','POST',{decision,comment:'Reason',expected_revision:1,expected_review_cycle:1});
    const rows=(await pool.query('SELECT status,snapshot,species_photo FROM record_version_history WHERE request_id=$1',[request.request_id])).rows;
    assert.equal(rows.length,1);assert.equal(rows[0].status,decision);assert.deepEqual(rows[0].snapshot,{request_id:request.request_id});assert.deepEqual(Buffer.from(rows[0].species_photo),photo);
  });
  await t.test('Species pending snapshot/photo remain immutable and approval capture reads correctly',async()=>{
    const request=(await pool.query(`INSERT INTO species_request_submission(owner_subject,client_key,payload_hash,scientific_name,common_name,genus_name,family_name,conservation_status,description,habitat,photo)
      VALUES('staff:bot','new-species','hash','New species','Common','Genus','Family','Least Concern','Description','Habitat',$1) RETURNING *`,[photo])).rows[0];
    await pool.query(`INSERT INTO record_version_history(id,record_type,request_id,version_number,owner_subject,edited_by,status,snapshot,species_photo)
      VALUES('species-source','species',$1,1,'staff:bot','staff:bot','Pending Review',$2,$3)`,[request.request_id,{request_id:request.request_id,scientific_name:'New species'},photo]);
    await call('/species-requests/'+request.request_id+'/review','officer','POST',{decision:'Approved',visibility:'public',expected_revision:1,expected_review_cycle:1});
    const rows=(await pool.query('SELECT * FROM record_version_history WHERE request_id=$1 ORDER BY version_number',[request.request_id])).rows;
    assert.equal(rows.length,2);assert.deepEqual(Buffer.from(rows[0].species_photo),photo);assert.equal(rows[0].snapshot.scientific_name,'New species');
    assert.equal(rows[1].snapshot.review_provenance.source_submitted_history_id,'species-source');
    const current=(await pool.query('SELECT * FROM species_request_submission WHERE request_id=$1',[request.request_id])).rows[0];
    assert.equal((await speciesHistory(pool,current)).historical_review.state,'available');
    await assert.rejects(pool.query("UPDATE record_version_history SET species_photo=decode('01','hex') WHERE id='species-source'"),/immutable/);
  });
});
