"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {readFileSync}=require('node:fs'),{join}=require('node:path'),{once}=require('node:events');
const {createPlantDatabase}=require('./postgres-fixture.cjs');
const {createPlantApp}=require('../server.js');
const {createOfficerNotificationDelivery}=require('../officer-notification-delivery.cjs');
const {enqueueObservationEdit}=require('../observation-edit-notifications.cjs');
const {createObservationEditNotificationReconciliation}=require('../observation-edit-notifications.cjs');
test('notification-only 030: real 029 proposals, exact evidence, durable delivery and inbox',async t=>{
 const db=await createPlantDatabase();t.after(()=>db.end());await db.query('SET search_path TO plant_app,pg_catalog');
 for(const file of ['004-species-requests.sql','006-atomic-plant-submissions.sql','008-record-change-submissions.sql','009-record-version-history.sql','013-staff-notification-foundation.sql','016-species-request-content-revision.sql','017-species-review-cycle.sql','021-observation-edit-requests.sql','022-cancel-edit-requests.sql','024-record-change-review-events.sql','025-original-plant-withdrawal.sql','026-original-species-withdrawal.sql','027-original-observation-withdrawal.sql','028-immutable-record-version-revisions.sql','029-observation-submission-versions.sql'])await db.query(readFileSync(join(__dirname,'../migrations',file),'utf8'));
 await db.query(`INSERT INTO species(species_id,scientific_name,common_name,rbac_data) VALUES(1,'Plantus fixture','Fixture','{}');
 INSERT INTO rbac_species_visibility VALUES(1,'public');
 INSERT INTO plant_record(plant_id,species_id,registered_subject,rbac_status,qr_token) VALUES(1,1,'staff:alice','Approved','notice-qr');
 INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,origin_type) VALUES
 ('11111111-1111-4111-8111-111111111111',1,'staff:bot','Approved','{"heightCm":80,"healthStatus":"Healthy"}','subsequent','subsequent_observation'),
 ('33333333-3333-4333-8333-333333333333',1,'staff:alice','Approved','{"heightCm":80,"healthStatus":"Healthy"}','initial','initial_registration');`);
 await db.query(`INSERT INTO plant_submission_receipt(owner_subject,client_key,payload_hash,result)
 VALUES('staff:alice','initial',repeat('a',64),$1::jsonb)`,[JSON.stringify({id:'33333333-3333-4333-8333-333333333333',plant_id:1,species_id:1,status:'Pending Review',qr_token:'notice-qr',species_request_id:null})]);
 const oldId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 await db.query(`INSERT INTO staff_notification_event(id,source_key,event_type,audience_role,resource_kind,metadata)
 VALUES($1,'existing-system','system_failure','Administrator','system','{"preserved":true}')`,[oldId]);
 const beforeMigration=(await db.query('SELECT * FROM staff_notification_event WHERE id=$1',[oldId])).rows[0];
 await db.query(readFileSync(join(__dirname,'../migrations/030-observation-edit-officer-notifications.sql'),'utf8'));
 const migrated=(await db.query('SELECT * FROM staff_notification_event WHERE id=$1',[oldId])).rows[0];
 for(const key of Object.keys(beforeMigration))assert.deepEqual(migrated[key],beforeMigration[key],key+' remains unchanged');
 assert.equal(migrated.observation_edit_request_id,null);assert.equal(migrated.observation_edit_revision,null);
 let failEnqueue=false,failCommit=false,directoryDown=false;
 const pool={query:(...a)=>db.query(...a),connect:async()=>{const c=await db.connect();return {release:()=>c.release(),query:async(sql,args)=>{if(failEnqueue&&sql.includes('INSERT INTO plant_app.staff_notification_event')){failEnqueue=false;throw Error('isolated enqueue failure')}if(failCommit&&sql==='COMMIT'){failCommit=false;throw Error('isolated commit failure')}return c.query(sql,args)}}}};
 const roles={bot:'Botanist',alice:'Botanist',officer:'Conservation Officer',second:'Conservation Officer',visitor:'Visitor'};
 const tokens=Object.fromEntries(Object.keys(roles).map((id,i)=>[id,String(i+1).repeat(64)]));
 const auth={session:async token=>{const id=Object.keys(tokens).find(id=>tokens[id]===token);return id?{id,role:roles[id],status:'Active',mustChangePassword:false}:null},event:async()=>{},db:{prepare:()=>({all:async()=>{if(directoryDown)throw Error('isolated directory down');return ['officer','second','bot'].map(id=>({id,role:'Conservation Officer',status:'Active',must_change_password:0}))}})}};
 const delivery=createOfficerNotificationDelivery({pool,auth});
 const server=createPlantApp({pool,auth,officerNotifications:delivery,origins:new Set()}).listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))});
 const call=async(path,user='officer',method='GET',body)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{Authorization:`Bearer ${tokens[user]}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()}};
 const observation='11111111-1111-4111-8111-111111111111',initial='33333333-3333-4333-8333-333333333333';
 const body=(id,key)=>({observation_id:id,client_key:key,content:{heightCm:95,healthStatus:'Healthy',lifeStage:'Mature',morphology:'Fixture leaves'},photo_ids:[]});
 const nextObservation='55555555-5555-4555-8555-555555555555';
 await db.query(`INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,origin_type)
 VALUES($1,1,'staff:alice','Approved','{"heightCm":80,"healthStatus":"Healthy"}','later-alice','subsequent_observation')`,[nextObservation]);
 let editId,initialId;
 await t.test('new subsequent requests and existing initial requests retain exact notification evidence',async()=>{
  assert.equal((await call('/observation-edits/capabilities','bot')).body.versioning_available,false);
  assert.equal((await call('/observations/'+initial)).body.observation.origin_type,'initial_registration');
  assert.equal((await call('/observations/'+observation)).body.observation.origin_type,'subsequent_observation');
  const a=await call('/observation-edits','bot','POST',body(observation,'new'));assert.equal(a.status,201,JSON.stringify(a.body));editId=a.body.edit.id;
  assert.equal((await call('/observation-edits','alice','POST',body(initial,'initial-new'))).status,409);
  // Preserve a genuine pre-policy initial-origin proposal/notice fixture, without reopening creation.
  initialId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const eventId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const original=(await call('/observations/'+initial)).body.observation;
  const snapshot={content:original.content,revision:original.revision,photo_ids:[]};
  const fingerprint=require('node:crypto').createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  await db.query('BEGIN');
  await db.query(`INSERT INTO observation_edit_request(id,observation_id,owner_subject,version_number,base_revision,base_fingerprint,base_snapshot,proposed_content,retained_photo_ids,added_photos,client_key,payload_hash)
    VALUES($1,$2,'staff:alice',1,$3,$4,$5,$6,'[]'::jsonb,'[]'::jsonb,'legacy-initial','legacy-hash')`,
    [initialId,initial,original.revision,fingerprint,snapshot,body(initial,'legacy-initial').content]);
  await db.query(`INSERT INTO observation_edit_event(id,request_id,observation_id,actor_subject,event_type) VALUES($1,$2,$3,'staff:alice','submitted')`,[eventId,initialId,initial]);
  await enqueueObservationEdit(db,initialId,eventId);
  await db.query('COMMIT');
  const events=(await db.query("SELECT * FROM staff_notification_event WHERE resource_kind='observation_edit' ORDER BY observation_edit_request_id")).rows;
  assert.equal(events.length,2);assert.ok(events.every(e=>e.observation_edit_revision===1&&e.event_type==='observation_edit_submitted'&&e.observation_id===null&&e.record_change_id===null));assert.deepEqual(new Set(events.map(e=>e.observation_edit_request_id)),new Set([editId,initialId]));
  assert.equal((await db.query("SELECT count(*)::int AS n FROM observation_edit_event WHERE notification_revision=1")).rows[0].n,2);
  assert.equal((await db.query('SELECT status FROM plant_observation WHERE id=$1',[observation])).rows[0].status,'Approved');
 });
 await t.test('identical submission retries and delivery retries do not duplicate event or recipients',async()=>{
  assert.equal((await call('/observation-edits','bot','POST',body(observation,'new'))).body.edit.id,editId);
  directoryDown=true;await assert.rejects(delivery.deliverBatch());directoryDown=false;await delivery.deliverBatch();await delivery.deliverBatch();
  assert.equal((await db.query("SELECT count(*)::int AS n FROM staff_notification_event WHERE resource_kind='observation_edit'")).rows[0].n,2);
  const rows=(await db.query('SELECT * FROM staff_notification n JOIN staff_notification_event e ON e.id=n.event_id WHERE e.observation_edit_request_id=$1',[editId])).rows;
  assert.equal(rows.length,2);assert.deepEqual(new Set(rows.map(r=>r.recipient_subject)),new Set(['staff:officer','staff:second']));
 });
 await t.test('inbox exposes actual proposal/revision with consistent read counts and authorization',async()=>{
  const inbox=await call('/staff-notifications');assert.equal(inbox.status,200,JSON.stringify(inbox.body));assert.equal(inbox.body.unread_count,2);
  const notice=inbox.body.notifications.find(n=>n.resource.id===editId);assert.equal(notice.resource.kind,'observation_edit');assert.equal(notice.resource.revision,1);
  assert.equal((await call('/staff-notifications/unread-count')).body.unread_count,2);
  assert.equal((await call('/staff-notifications/'+notice.id+'/read','visitor','POST',{})).status,403);
  assert.equal((await call('/staff-notifications/'+notice.id+'/read','second','POST',{})).status,404);
  assert.equal((await call('/staff-notifications/'+notice.id+'/read','officer','POST',{})).status,200);
  assert.equal((await call('/staff-notifications/unread-count')).body.unread_count,1);
  await call('/staff-notifications/read-all','officer','POST',{read_through:inbox.body.read_through});assert.equal((await call('/staff-notifications/unread-count')).body.unread_count,0);
 });
 await t.test('two correction rounds produce exact new revisions; stale review/resubmit cannot enqueue',async()=>{
  for(const revision of [1,2]){
   const review=await call(`/observation-edits/${editId}/review`,'officer','POST',{decision:'Correction Required',revision,comment:'Please correct'});assert.equal(review.status,200,JSON.stringify(review.body));
   const correction=await call('/observation-edits/'+editId,'bot','PATCH',{revision,content:{heightCm:95+revision,healthStatus:'Healthy',lifeStage:'Mature',morphology:'Fixture leaves'},photo_ids:[]});assert.equal(correction.status,200,JSON.stringify(correction.body));assert.equal(correction.body.edit.revision,revision+1);
   assert.equal((await call('/observation-edits/'+editId,'bot','PATCH',{revision,content:{heightCm:99,healthStatus:'Healthy',lifeStage:'Mature',morphology:'Fixture leaves'}})).status,409);
  }
  const events=(await db.query('SELECT event_type,observation_edit_revision FROM staff_notification_event WHERE observation_edit_request_id=$1 ORDER BY observation_edit_revision',[editId])).rows;
  assert.deepEqual(events.map(e=>e.observation_edit_revision),[1,2,3]);assert.deepEqual(events.map(e=>e.event_type),['observation_edit_submitted','observation_edit_resubmitted','observation_edit_resubmitted']);
  assert.equal((await call(`/observation-edits/${editId}/review`,'second','POST',{decision:'Approved',revision:1,comment:'Verified proposal'})).status,409);
 });
 await t.test('enqueue failure and commit failure roll back business transition, source evidence and outbox',async()=>{
  const review=await call(`/observation-edits/${editId}/review`,'officer','POST',{decision:'Correction Required',revision:3,comment:'One more correction'});assert.equal(review.status,200);
  const counts=async()=>Promise.all(['observation_edit_event','staff_notification_event'].map(async table=>(await db.query('SELECT count(*)::int AS n FROM '+table)).rows[0].n));const before=await counts();
  for(const failure of ['enqueue','commit']){if(failure==='enqueue')failEnqueue=true;else failCommit=true;
   const r=await call('/observation-edits/'+editId,'bot','PATCH',{revision:3,content:{heightCm:110,healthStatus:'Healthy',lifeStage:'Mature',morphology:'Fixture leaves'}});assert.ok(r.status>=400);assert.deepEqual(await counts(),before);const row=(await db.query('SELECT status,revision FROM observation_edit_request WHERE id=$1',[editId])).rows[0];assert.deepEqual(row,{status:'Correction Required',revision:3});
  }
 });
 await t.test('terminal and cancelled proposals retain authorized historical notices without changing Approved baseline',async()=>{
  assert.equal((await call('/observation-edits/'+initialId+'/cancel','alice','POST',{})).status,200);
  assert.equal((await call('/observation-edits/'+initialId)).body.edit.status,'Cancelled');await delivery.deliverBatch();
  const inbox=(await call('/staff-notifications')).body;assert.ok(inbox.notifications.some(n=>n.resource.id===initialId));
  assert.equal((await db.query('SELECT status FROM plant_observation WHERE id=$1',[initial])).rows[0].status,'Approved');
  assert.equal((await call(`/observation-edits/${initialId}/review`,'officer','POST',{decision:'Approved',revision:1,comment:'Verified proposal'})).status,409);
 });
 await t.test('failed new submissions leave no request or notification; approval keeps historical notice readable',async()=>{
  const before=(await db.query('SELECT count(*)::int AS n FROM observation_edit_request')).rows[0].n;
  const events=(await db.query('SELECT count(*)::int AS n FROM staff_notification_event')).rows[0].n;
  for(const failure of ['enqueue','commit']){if(failure==='enqueue')failEnqueue=true;else failCommit=true;
   assert.ok((await call('/observation-edits','alice','POST',body(nextObservation,'failed-new'))).status>=400);
   assert.equal((await db.query('SELECT count(*)::int AS n FROM observation_edit_request')).rows[0].n,before);
   assert.equal((await db.query('SELECT count(*)::int AS n FROM staff_notification_event')).rows[0].n,events);
  }
  const created=await call('/observation-edits','alice','POST',body(nextObservation,'approved-new'));assert.equal(created.status,201);
  const approved=await call('/observation-edits/'+created.body.edit.id+'/review','officer','POST',{decision:'Approved',revision:1,comment:'Verified proposal'});assert.equal(approved.status,200,JSON.stringify(approved.body));
  await delivery.deliverBatch();assert.ok((await call('/staff-notifications')).body.notifications.some(n=>n.resource.id===created.body.edit.id));
 });
 await t.test('new identities and annotated source evidence are immutable',async()=>{
  const event=(await db.query('SELECT id FROM staff_notification_event WHERE observation_edit_request_id=$1 LIMIT 1',[editId])).rows[0];
  await assert.rejects(db.query('UPDATE staff_notification_event SET observation_edit_revision=99 WHERE id=$1',[event.id]));
  await assert.rejects(db.query("UPDATE observation_edit_event SET notification_revision=99 WHERE request_id=$1 AND notification_revision=1",[editId]));
  await assert.rejects(db.query("DELETE FROM observation_edit_event WHERE request_id=$1 AND notification_revision=1",[editId]));
 });
 await t.test('reconciliation ignores unannotated legacy evidence and recovers only exact annotated current revisions',async()=>{
  await call('/observation-edits/'+editId,'bot','PATCH',{revision:3,content:{heightCm:120,healthStatus:'Healthy',lifeStage:'Mature',morphology:'Fixture leaves'}});
  const reconciliation=createObservationEditNotificationReconciliation({pool,config:{enabled:true,lowerBound:'2020-01-01T00:00:00Z'}});
  assert.equal((await reconciliation.runOnce()).enqueued,0);
  await db.query('DELETE FROM staff_notification_event WHERE observation_edit_request_id=$1 AND observation_edit_revision=4',[editId]);
  assert.equal((await reconciliation.preview()).candidates.length,1);assert.equal((await reconciliation.runOnce()).enqueued,1);assert.equal((await reconciliation.runOnce()).enqueued,0);
  await call(`/observation-edits/${editId}/review`,'officer','POST',{decision:'Rejected',revision:4,comment:'Final decision'});
  assert.equal((await reconciliation.preview()).candidates.length,0);
  await db.query(`INSERT INTO observation_edit_request(id,observation_id,owner_subject,status,revision,version_number,base_revision,base_fingerprint,base_snapshot,proposed_content,client_key,payload_hash)
   SELECT 'legacy-notice',observation_id,owner_subject,'Pending Review',1,2,base_revision,base_fingerprint,base_snapshot,proposed_content,'legacy-key','legacy-hash' FROM observation_edit_request WHERE id=$1`,[editId]);
  await db.query(`INSERT INTO observation_edit_event(id,request_id,observation_id,actor_subject,event_type)
   VALUES('legacy-event','legacy-notice',$1,'staff:bot','submitted')`,[observation]);
  assert.equal((await reconciliation.preview()).candidates.length,0,'legacy events without exact evidence must not be backfilled');
  await assert.rejects(db.query("UPDATE observation_edit_event SET notification_revision=1 WHERE id='legacy-event'"),/Exact current-transaction/);
  assert.equal((await createObservationEditNotificationReconciliation({pool}).runOnce()).disabled,true);
 });
});
