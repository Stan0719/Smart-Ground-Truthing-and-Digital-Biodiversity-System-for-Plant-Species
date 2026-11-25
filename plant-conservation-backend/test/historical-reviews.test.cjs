"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { once } = require("node:events");
const sharp = require("sharp");
const { createHash } = require("node:crypto");
const { createPlantDatabase, installRecordChangeNotifications, installTranslationStorage } = require("./postgres-fixture.cjs");
const { createPlantApp } = require("../server.js");
const { observationHistory, speciesHistory } = require("../historical-reviews.cjs");
const { seedRegistrationReceipt } = require("./registration-provenance-fixture.cjs");

test("historical reviews select event-linked submitted versions without changing live approvals", async t => {
  const pool = await createPlantDatabase(); t.after(() => pool.end());
  await pool.query("CREATE SCHEMA IF NOT EXISTS plant_app; SET search_path=plant_app,pg_catalog");
  await pool.query(readFileSync(join(__dirname,"../schema.postgres.sql"),"utf8"));
  for (const name of ["004-species-requests.sql","006-atomic-plant-submissions.sql","008-record-change-submissions.sql","009-record-version-history.sql","016-species-request-content-revision.sql","017-species-review-cycle.sql"])
    await pool.query(readFileSync(join(__dirname,"../migrations/"+name),"utf8"));
  await installRecordChangeNotifications(pool);
  await installTranslationStorage(pool);
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
  await seedRegistrationReceipt(pool, '24');
  const original = {species_id:1,scientific_name:"Original plant",content:{heightCm:12,healthStatus:"Healthy",lifeStage:"Mature",morphology:"Original",notes:"Original notes",zone:"Original zone",latitude:0,longitude:0}};
  // The existing pending-edit path captures the submitted version; the actual
  // approval endpoint links that version to its review event in one transaction.
  await call("/my-plants/24","bot","PATCH",{...original,expected_revision:1});
  // A correction through the generic route does not refresh the older submitted snapshot.
  await call("/observations/24/review","officer","POST",{decision:"Correction Required",revision:2,comment:"Correct the measurement"});
  await call("/observations/24","bot","PATCH",{revision:3,content:{...original.content,heightCm:13,notes:"Final reviewed notes"}});
  await call("/observations/24/submit","bot","POST",{});
  await call("/observations/24/review","officer","POST",{decision:"Approved",revision:4,comment:"Original approval"});
  await t.test("verified plant history keeps original identity, names, content, photos and reviewer",async()=>{
    const row=(await call("/observations/24")).observation;
    assert.equal(row.status,"Approved");assert.equal(row.historical_review.state,"available");
    assert.equal((await pool.query("SELECT status FROM plant_app.qr_code WHERE plant_id=24")).rows[0].status,"active");
    assert.equal((await pool.query("SELECT to_regclass('public.qr_code') AS legacy_relation")).rows[0].legacy_relation,null);
    assert.equal(row.historical_review.fields.plant_scientific_name,"Original plant");
    assert.equal(row.historical_review.fields.species_scientific_name,"Catalogue original");
    assert.equal(row.historical_review.fields.content.morphology,"Original");
    assert.equal(row.historical_review.fields.content.heightCm,13);
    assert.equal(row.historical_review.fields.content.notes,"Final reviewed notes");
    assert.equal(row.historical_review.reviewed_by,"staff:officer");
    assert.deepEqual(row.historical_review.assets.map(a=>a.id),["original-0","original-1","original-2"]);
  });
  let change;
  await t.test("later approved proposal is distinct, live values change, original history stays approved",async()=>{
    change=(await call("/record-changes","bot","POST",{kind:"plant",target_id:24,client_key:"edit-3",proposed:{...original,scientific_name:"Edited plant",content:{...original.content,heightCm:55,morphology:"Edit 3"},photo_ids:["original-0","original-1","original-2"]}})).change;
    const before=(await call("/observations/24")).observation;
    assert.equal(before.content.morphology,"Original");
    await call(`/record-changes/${change.id}/review`,"officer","POST",{decision:"Approved",comment:"Edit approved"});
    const row=(await call("/observations/24")).observation;
    assert.equal(row.content.morphology,"Edit 3");assert.equal(row.historical_review.fields.content.morphology,"Original");
    assert.equal(row.historical_review.fields.plant_scientific_name,"Original plant");
    assert.equal(row.status,"Approved");assert.equal(row.review_comment,"Original approval");
    const proposal=(await call(`/record-changes/${change.id}`)).change;
    assert.notEqual(proposal.id,row.id);assert.equal(proposal.plant_id,24);assert.equal(proposal.status,"Approved");
    assert.equal((await pool.query("SELECT scientific_name FROM plant_record WHERE plant_id=24")).rows[0].scientific_name,"Edited plant");
    assert.equal((await call("/observations/24","bot")).observation.historical_review,undefined);
    const history=(await call("/record-versions?kind=plant&id=24")).versions;
    assert.equal(history.filter(v=>v.status==="Approved").length,2);
  });
  await t.test("detached historical photos still use existing authenticated asset access",async()=>{
    await pool.query("UPDATE plant_asset SET observation_id=NULL,approved=FALSE WHERE id='original-0'");
    const row=(await call("/observations/24")).observation;
    assert.ok(row.historical_review.assets.some(a=>a.id==="original-0"));
    const result=await fetch(`http://127.0.0.1:${server.address().port}/api/assets/original-0`,{headers:{Authorization:`Bearer ${tokens.officer}`}});
    assert.equal(result.status,200);assert.deepEqual(Buffer.from(await result.arrayBuffer()),photo);
  });
  await t.test("missing original photo is reported without substituting a replacement",async()=>{
    await pool.query("DELETE FROM plant_asset WHERE id='original-1'");
    const row=(await call("/observations/24")).observation;
    assert.equal(row.historical_review.photos_unavailable,true);
    assert.deepEqual(row.historical_review.assets.map(a=>a.id),["original-0","original-2"]);
  });
  await t.test("unverified lazy baseline and another observation never supply historical fields",async()=>{
    await pool.query(`INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key) VALUES('25',24,'staff:bot','Approved','{"heightCm":999}','another')`);
    const row=(await call("/observations/25")).observation;
    assert.deepEqual(row.historical_review,{state:"unavailable",fields:{},assets:[]});
    const stored=(await pool.query("SELECT status FROM record_version_history WHERE plant_id=24 AND version_number=3")).rows[0];
    assert.equal(stored.status,"Approved");
  });
  await t.test("species original content and stored photo remain independent from live request edits",async()=>{
    const fields={scientific_name:"Historical species",common_name:"Historical common",genus_name:"Genus",family_name:"Family",conservation_status:"Least Concern",description:"Original description",habitat:"Original habitat"};
    const request=(await pool.query(`INSERT INTO species_request_submission(owner_subject,client_key,payload_hash,scientific_name,common_name,genus_name,family_name,conservation_status,description,habitat,photo)
      VALUES('staff:bot','species','hash','Historical species','Historical common','Genus','Family','Least Concern','Original description','Original habitat',$1) RETURNING *`,[photo])).rows[0];
    await call('/species-requests/'+request.request_id+'/review','officer','POST',{decision:'Approved',comment:'Original species approval',visibility:'public',expected_revision:1,expected_review_cycle:1});
    const approved=(await pool.query('SELECT * FROM species_request_submission WHERE request_id=$1',[request.request_id])).rows[0];
    const exposed=(await call("/record-versions?kind=species&id="+request.request_id)).versions;
    assert.equal(exposed[0].species_photo_fingerprint,createHash("sha256").update(photo).digest("hex"));
    const speciesVersion=(await pool.query('SELECT id FROM record_version_history WHERE request_id=$1',[request.request_id])).rows[0].id;
    const edit=(await call('/record-changes','bot','POST',{kind:'species',target_id:request.request_id,client_key:'species-edit',proposed:{...fields,scientific_name:'Current species',common_name:'Current common',description:'Current description',habitat:'Current habitat'}})).change;
    await call('/record-changes/'+edit.id+'/review','officer','POST',{decision:'Approved',comment:'Species edit approved'});
    const response=(await call('/species-requests/'+request.request_id)).species_request;
    assert.equal(response.scientific_name,'Current species');
    assert.equal(response.historical_review.fields.scientific_name,'Historical species');
    assert.equal(response.historical_review.assets[0].id,'historical-species-'+speciesVersion);
    const linked=await observationHistory(pool,[{id:'25',plant_id:24,status:'Approved',species_request:approved}]);
    assert.equal(linked[0].species_request.historical_review.fields.description,'Original description');
    const image=await fetch(`http://127.0.0.1:${server.address().port}/api/record-versions/${speciesVersion}/photo`,{headers:{Authorization:`Bearer ${tokens.officer}`}});
    assert.equal(image.status,200);assert.deepEqual(Buffer.from(await image.arrayBuffer()),photo);
    await pool.query("UPDATE record_version_history SET reviewed_by='staff:other' WHERE id=$1",[speciesVersion]);
    assert.equal((await speciesHistory(pool,approved)).historical_review.state,'unavailable');
  });
  await t.test("an unmarked legacy snapshot is rejected even when its review metadata matches",async()=>{
    const version=(await pool.query("SELECT id,snapshot FROM record_version_history WHERE plant_id=24 AND snapshot ? 'review_provenance' AND change_id IS NULL")).rows[0];
    await pool.query("UPDATE record_version_history SET snapshot=snapshot-'review_provenance' WHERE id=$1",[version.id]);
    assert.equal((await call('/observations/24')).observation.historical_review.state,'unavailable');
    await pool.query("UPDATE record_version_history SET snapshot=$1 WHERE id=$2",[version.snapshot,version.id]);
  });
  await t.test("snapshot capture failure rolls back the approval and its review/audit side effects",async()=>{
    await pool.query(`INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,origin_type)
      VALUES('26',24,'staff:bot','Pending Review','{}','rollback-fixture','subsequent_observation')`);
    const auditBefore=(await pool.query("SELECT COUNT(*)::int AS n FROM business_audit")).rows[0].n;
    await pool.query("ALTER TABLE record_version_history ADD CONSTRAINT fixture_capture_failure CHECK (NOT(snapshot ? 'review_provenance')) NOT VALID");
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/observations/26/review`,{method:'POST',headers:{Authorization:`Bearer ${tokens.officer}`,'Content-Type':'application/json'},body:JSON.stringify({revision:1,decision:'Approved',comment:'Must roll back'})});
    assert.equal(response.status,400);
    assert.deepEqual((await pool.query("SELECT status,revision FROM plant_observation WHERE id='26'")).rows[0],{status:'Pending Review',revision:1});
    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM observation_review WHERE observation_id='26'")).rows[0].n,0);
    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM business_audit")).rows[0].n,auditBefore);
    await pool.query("ALTER TABLE record_version_history DROP CONSTRAINT fixture_capture_failure");
  });
  await t.test("read projections make no audit or version writes and missing migration is safe",async()=>{
    const before=(await pool.query("SELECT COUNT(*)::int AS n FROM business_audit")).rows[0].n;
    await call('/observations');await call('/observations/24');
    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM business_audit")).rows[0].n,before);
    await pool.query("ALTER TABLE record_version_history RENAME TO unavailable_history");
    assert.equal((await call('/observations/24')).observation.historical_review.state,'unavailable');
  });
});
