const test=require('node:test'),assert=require('node:assert/strict');
const {readFileSync}=require('node:fs'),{join}=require('node:path'),{once}=require('node:events');
const {createPlantDatabase}=require('./postgres-fixture.cjs');
const {seedRegistrationReceipt}=require('./registration-provenance-fixture.cjs');
const {createPlantApp}=require('../server.js');
const {resolvePlantRegistration}=require('../plant-registration.cjs');
test('Officer direct edit records truthful immutable provenance and serializes against proposals and stale saves',async t=>{
 const pool=await createPlantDatabase();t.after(()=>pool.end());
 for(const name of ['004-species-requests.sql','006-atomic-plant-submissions.sql','008-record-change-submissions.sql','009-record-version-history.sql','028-immutable-record-version-revisions.sql'])await pool.query(readFileSync(join(__dirname,'../migrations',name),'utf8'));
 await pool.query(`CREATE TABLE observation_edit_request(id text,observation_id text,status text);
  CREATE TABLE plant_app.qr_code(qr_id integer,plant_id integer,qr_code text,status text);
  INSERT INTO species(species_id,scientific_name) VALUES(1,'Species A');
  INSERT INTO rbac_species_visibility VALUES(1,'public');
  INSERT INTO plant_record(plant_id,scientific_name,species_id,registered_subject,rbac_status,qr_token) VALUES(1,'Original name',1,'staff:bot','Approved','qr-1');
  INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,origin_type) VALUES('obs-1',1,'staff:bot','Approved','{"latitude":4,"longitude":113,"notes":"Original evidence"}','original','initial_registration');
  INSERT INTO qr_code VALUES(1,1,'qr-1','active');
  INSERT INTO observation_review VALUES('real-review','obs-1','staff:officer','Approved','Actual review','2026-11-01');
  INSERT INTO record_version_history(id,record_type,plant_id,version_number,owner_subject,edited_by,status,snapshot,reviewed_by,reviewed_at,created_at)
   VALUES('capture','plant',1,1,'staff:bot','staff:bot','Approved','{"plant_id":1,"observation_id":"obs-1","scientific_name":"Original name","species_id":1,"content":{"latitude":4,"longitude":113,"notes":"Original evidence"},"photo_ids":[],"review_provenance":{"kind":"plant","review_id":"real-review","submission_id":"obs-1"}}','staff:officer','2026-11-01','2026-11-01');`);
 await seedRegistrationReceipt(pool,'obs-1');
 const auth={session:async token=>({id:'actor',role:token==='a'.repeat(64)?'Conservation Officer':'Botanist',status:'Active',mustChangePassword:false}),event:async()=>{}};
 const server=createPlantApp({pool,auth}).listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}));
 async function call(path='',method='GET',body,token='a'.repeat(64)){const r=await fetch(`http://127.0.0.1:${server.address().port}/api/officer/plants/1${path}`,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
 assert.equal((await call('/edit','GET',null,'b'.repeat(64))).status,403);
 const first=await call('/edit');assert.equal(first.status,200,JSON.stringify(first.data));
 const body={scientific_name:'Officer name',reason:'Correct transcription',revision:first.data.revision};
 assert.equal((await call('','PATCH',{...body,latitude:9})).status,400);
 assert.equal((await call('','PATCH',{...body,scientific_name:''})).status,400);
 const saved=await call('','PATCH',body);assert.equal(saved.status,200,JSON.stringify(saved.data));
 assert.equal((await call('','PATCH',body)).status,409);
 const registration=await resolvePlantRegistration(pool,1);assert.equal(registration.version_id,saved.data.version_id);assert.equal(registration.content.notes,'Original evidence');
 const history=await call('/edits');assert.equal(history.data.edits.length,1);assert.equal(history.data.edits[0].actor,'staff:actor');
 const version=(await pool.query('SELECT * FROM record_version_history WHERE id=$1',[saved.data.version_id])).rows[0];
 assert.equal(version.reviewed_by,null);assert.equal(version.reviewed_at,null);assert.equal(version.change_id,null);assert.equal(version.owner_subject,'staff:bot');
 assert.equal(version.previous_snapshot.scientific_name,'Original name');assert.equal(version.snapshot.review_provenance.kind,'officer_direct_edit');
 assert.equal((await pool.query('SELECT count(*)::integer AS n FROM observation_review')).rows[0].n,1);
 assert.equal((await pool.query('SELECT count(*)::integer AS n FROM record_change_submission')).rows[0].n,0);
 assert.equal((await pool.query("SELECT count(*)::integer AS n FROM business_audit WHERE action='officer_plant_direct_edit'")).rows[0].n,1);
 const listResponse=await fetch(`http://127.0.0.1:${server.address().port}/api/officer/plants?q=Officer%20name`,{headers:{Authorization:'Bearer '+'a'.repeat(64)}});
 const listed=await listResponse.json();assert.equal(listed.plants[0].scientific_name,'Officer name');assert.equal(listed.plants[0].species_scientific_name,'Species A');
 const publicDetail=await fetch(`http://127.0.0.1:${server.address().port}/api/plants/1/detail`);
 assert.equal((await publicDetail.json()).information.scientific_name,'Officer name');
 assert.equal((await pool.query("SELECT scientific_name FROM species WHERE species_id=1")).rows[0].scientific_name,'Species A');
 assert.equal((await pool.query("SELECT snapshot->>'scientific_name' AS name FROM record_version_history WHERE id='capture'")).rows[0].name,'Original name');
 const fresh=await call('/edit');
 await pool.query("INSERT INTO observation_edit_request VALUES('active','obs-1','Pending Review')");
 assert.equal((await call('','PATCH',{...body,revision:fresh.data.revision})).data.code,'PLANT_EDIT_ACTIVE_PROPOSAL');
 await pool.query('DELETE FROM observation_edit_request');
 await pool.query(`INSERT INTO record_change_submission(id,plant_id,owner_subject,status,base_snapshot,proposed_snapshot,base_fingerprint,client_key,payload_hash)
  VALUES('proposal',1,'staff:bot','Pending Review','{}','{}','fingerprint','proposal-key','hash')`);
 assert.equal((await call('/edit')).data.code,'PLANT_EDIT_ACTIVE_PROPOSAL');
 await pool.query("DELETE FROM record_change_submission WHERE id='proposal'");
 for(const status of ['Rejected','Pending Review','Correction Required','Flagged']){
  await pool.query('UPDATE plant_record SET rbac_status=$1 WHERE plant_id=1',[status]);
  assert.equal((await call('/edit')).data.code,'PLANT_EDIT_APPROVED_ONLY');
 }
 await pool.query("UPDATE plant_record SET rbac_status='Approved' WHERE plant_id=1");
 await assert.rejects(pool.query("UPDATE record_version_history SET snapshot='{}' WHERE id=$1",[saved.data.version_id]),/immutable/);
 await pool.query('ALTER TABLE record_version_history DISABLE TRIGGER record_version_snapshot_immutable');
 assert.equal((await call('/edit')).data.code,'PLANT_EDIT_HISTORY_REQUIRED');
 await pool.query('ALTER TABLE record_version_history ENABLE TRIGGER record_version_snapshot_immutable');
 // An audit failure must roll back both the new version and the Plant update.
 await pool.query(`CREATE FUNCTION fail_direct_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$;
  CREATE TRIGGER fail_direct_audit BEFORE INSERT ON business_audit FOR EACH ROW EXECUTE FUNCTION fail_direct_audit()`);
 const beforeFailure=await call('/edit');
 assert.equal((await call('','PATCH',{...body,scientific_name:'Must roll back',revision:beforeFailure.data.revision})).status,503);
 assert.equal((await pool.query('SELECT scientific_name FROM plant_record WHERE plant_id=1')).rows[0].scientific_name,'Officer name');
 assert.equal((await pool.query('SELECT count(*)::integer AS n FROM record_version_history')).rows[0].n,2);
 // Deletion uses isolated rows only and never removes evidence to make a row eligible.
 await pool.query('DROP TRIGGER fail_direct_audit ON business_audit');
 async function removeCall(plantId,method='GET',body,token='a'.repeat(64)) {
  const r=await fetch(`http://127.0.0.1:${server.address().port}/api/officer/plants/${plantId}${method==='GET'?'/deletion':''}`,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};
 }
 assert.equal((await removeCall(1)).data.code,'PLANT_DELETE_REFERENCED');
 await pool.query("INSERT INTO plant_record(plant_id,scientific_name,species_id,registered_subject,rbac_status,qr_token) VALUES(2,'Unused',1,'staff:bot','Approved','')");
 assert.equal((await removeCall(2,'GET',null,'b'.repeat(64))).status,403);
 const eligible=await removeCall(2);assert.equal(eligible.status,200,JSON.stringify(eligible.data));
 await pool.query("UPDATE plant_record SET scientific_name='Changed' WHERE plant_id=2");
 assert.equal((await removeCall(2,'DELETE',{revision:eligible.data.revision})).data.code,'PLANT_DELETE_CONFLICT');
 const freshDelete=await removeCall(2);
 await pool.query("CREATE TABLE non_fk_plant_evidence(plant_id integer,note text); INSERT INTO non_fk_plant_evidence VALUES(2,'Preserve')");
 assert.equal((await removeCall(2,'DELETE',{revision:freshDelete.data.revision})).data.code,'PLANT_DELETE_REFERENCED');
 assert.equal((await pool.query('SELECT count(*)::integer AS n FROM non_fk_plant_evidence')).rows[0].n,1);
 // Test fixture removes its synthetic dependency, not production application code.
 await pool.query('DROP TABLE non_fk_plant_evidence');
 await pool.query('CREATE TRIGGER fail_delete_audit BEFORE INSERT ON business_audit FOR EACH ROW EXECUTE FUNCTION fail_direct_audit()');
 assert.ok((await removeCall(2,'DELETE',{revision:freshDelete.data.revision})).status>=500);
 assert.equal((await pool.query('SELECT count(*)::integer AS n FROM plant_record WHERE plant_id=2')).rows[0].n,1);
 await pool.query('DROP TRIGGER fail_delete_audit ON business_audit');
 assert.equal((await removeCall(2,'DELETE',{revision:freshDelete.data.revision})).data.deleted,true);
 assert.equal((await removeCall(2)).status,404);
 assert.equal((await pool.query("SELECT count(*)::integer AS n FROM business_audit WHERE action='officer_plant_delete' AND target='2'")).rows[0].n,1);
 assert.equal((await pool.query('SELECT count(*)::integer AS n FROM observation_review')).rows[0].n,1);
});
