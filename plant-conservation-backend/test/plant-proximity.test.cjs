"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {once}=require('node:events');
const {readFileSync}=require('node:fs'),{join}=require('node:path');
const {createPlantDatabase}=require('./postgres-fixture.cjs');
const {createPlantApp}=require('../server.js');
const {distanceMetres,category,proximityConfig,compareSpeciesIdentity,comparePlantIdentity}=require('../plant-proximity.cjs');
test('Haversine metres, valid zero, invalid GPS, every exact threshold and configuration validation',()=>{
 const c=proximityConfig();assert.equal(distanceMetres({latitude:0,longitude:0},{latitude:0,longitude:0}),0);
 for(const d of [0,1.999,2,2.001,4.999,5,5.001,9.999,10,10.001,29.999,30,30.001]){
  const p={latitude:0,longitude:d/6371000*180/Math.PI};assert.ok(Math.abs(distanceMetres({latitude:0,longitude:0},p)-d)<1e-8);
  assert.equal(category(d,c),d<=2?'very_close':d<=5?'close':d<=10?'nearby':d<=30?'additional':'outside');
 }
 assert.ok(distanceMetres({latitude:0,longitude:179.999},{latitude:0,longitude:-179.999})<223);
 for(const latitude of [undefined,null,'0',NaN,Infinity,91])assert.throws(()=>distanceMetres({latitude,longitude:0},{latitude:0,longitude:0}));
 for(const config of [{radius_m:101},{very_close_m:5},{candidate_limit:51},{nearby_m:NaN},{unknown:1}])assert.throws(()=>proximityConfig(config));
 for(const config of [{grouping_radius_m:0},{grouping_radius_m:31}])assert.throws(()=>proximityConfig(config));
 assert.equal(proximityConfig({very_close_m:1}).very_close_m,1);
 assert.equal(proximityConfig().grouping_radius_m,5);
});
test('canonical IDs outrank renamed scientific names; unverified name equality stays provisional',()=>{
 assert.equal(compareSpeciesIdentity({kind:'canonical',id:'12',name:'Old name'},{kind:'canonical',id:'12',name:'Current name'}),'confirmed_same');
 assert.equal(compareSpeciesIdentity({kind:'canonical',id:'12',name:'Same text'},{kind:'canonical',id:'13',name:'Same text'}),'confirmed_different');
 assert.equal(compareSpeciesIdentity({kind:'provisional',name:'Species A'},{kind:'provisional',name:' species   a '}),'provisional_same_name');
 assert.equal(compareSpeciesIdentity({kind:'provisional',name:'Species A'},{kind:'provisional',name:'Species B'}),'provisional_different_name');
 const comparison=comparePlantIdentity({kind:'provisional',name:'Species A'},null,{species_id:2,species_approval_status:'Pending Review',species_name:'Species A',zone:'Zone A'});
 assert.equal(comparison.match_status,'provisional_species');assert.equal(comparison.zone_match_status,'unknown');
});
test('read-only Officer proximity against more than 500 Plants with authentic registration provenance',async t=>{
 const pool=await createPlantDatabase();t.after(()=>pool.end());
 for(const file of ['004-species-requests.sql','006-atomic-plant-submissions.sql','008-record-change-submissions.sql','009-record-version-history.sql'])await pool.query(readFileSync(join(__dirname,'../migrations',file),'utf8'));
 await pool.query(`INSERT INTO species(species_id,scientific_name) VALUES(1,'Existing species'),(2,'Proposed species');
  INSERT INTO rbac_species_visibility VALUES(1,'protected'),(2,'protected');
  INSERT INTO plant_record(plant_id,species_id,registered_subject,qr_token,rbac_status,scientific_name)
   SELECT n,1,'staff:owner','qr-'||n,'Approved','Plant '||n FROM generate_series(1,600) n;
  INSERT INTO plant_location(plant_id,latitude,longitude,accuracy_m) SELECT n,0,1,5 FROM generate_series(1,600) n;
  INSERT INTO plant_record(plant_id,species_id,registered_subject,qr_token,rbac_status) VALUES(1000,1,'staff:owner','target-qr','Pending Review');
  INSERT INTO plant_location(plant_id,latitude,longitude,accuracy_m) VALUES(1000,0,0,2);
  INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,origin_type)
   VALUES('1',1000,'staff:owner','Pending Review','{"latitude":0,"longitude":0,"accuracy_m":2}','initial','initial_registration');
  INSERT INTO plant_submission_receipt(owner_subject,client_key,payload_hash,result)
   VALUES('staff:owner','initial',repeat('a',64),'{"id":"1","plant_id":1000,"species_id":1,"status":"Pending Review","qr_token":"target-qr","species_request_id":null}');
  UPDATE plant_location SET longitude=0,accuracy_m=null WHERE plant_id=1;
  UPDATE plant_location SET longitude=0.00001 WHERE plant_id=2;`);
 const users={officer:{id:'officer',role:'Conservation Officer',status:'Active',mustChangePassword:false},bot:{id:'owner',role:'Botanist',status:'Active',mustChangePassword:false},admin:{id:'admin',role:'Administrator',status:'Active',mustChangePassword:false},inactive:{id:'inactive',role:'Conservation Officer',status:'Inactive',mustChangePassword:false},temporary:{id:'temporary',role:'Conservation Officer',status:'Active',mustChangePassword:true}};
 const tokens=Object.fromEntries(Object.keys(users).map((key,i)=>[key,String(i+1).repeat(64)]));
 const auth={session:async token=>users[Object.keys(tokens).find(key=>tokens[key]===token)]||null,event:async()=>{}};
 const server=createPlantApp({pool,auth}).listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)}));
 async function call(path='/observations/1/proximity?revision=1',who='officer'){
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{headers:who?{Authorization:`Bearer ${tokens[who]}`}:{}});
  return {status:response.status,data:await response.json(),cache:response.headers.get('cache-control')};
 }
 await t.test('authorization, identifiers, revision conflict and self-exclusion',async()=>{
  for(const who of [null,'bot','admin','inactive','temporary'])assert.equal((await call(undefined,who)).status,who?403:401);
  for(const path of ['/observations/bad/proximity?revision=1','/observations/1/proximity','/observations/1/proximity?revision=1&radius=999'])assert.equal((await call(path)).status,400);
  assert.equal((await call('/observations/1/proximity?revision=2')).status,409);assert.equal((await call('/observations/999/proximity?revision=1')).status,404);
  const r=await call();assert.equal(r.status,200);assert.equal(r.cache,'no-store');assert.equal(r.data.eligible_count,600);assert.equal(r.data.state,'complete');
  assert.deepEqual(r.data.candidates.map(x=>x.plant_id),['1','2']);assert.equal(r.data.candidates[0].distance_m,0);assert.equal(r.data.candidates[0].accuracy_m,null);
  assert.ok(r.data.candidates.every(x=>x.plant_id!=='1000'&&x.category==='very_close'));
 });
 await t.test('SQL distance agrees with the metre formula across every category',async()=>{
  await pool.query('UPDATE plant_location SET longitude=1 WHERE plant_id<>1000');
  for(const d of [0,2-0.001,2+0.001,5-0.001,5+0.001,10-0.001,10+0.001,30-0.001,30+0.001]){
   await pool.query('UPDATE plant_location SET longitude=$1 WHERE plant_id=1',[d/6371000*180/Math.PI]);const r=(await call()).data;
   assert.equal(r.candidates.length,d<=30?1:0);if(d<=30){assert.ok(Math.abs(r.candidates[0].distance_m-d)<1e-6);assert.equal(r.candidates[0].category,category(d,proximityConfig()));}
  }
 });
 await t.test('same Species and normalized zone are required for grouping candidates; 5 m is a separate grouping radius',async()=>{
  await pool.query('UPDATE plant_observation SET content=$1 WHERE id=$2',[{latitude:0,longitude:0,accuracy_m:2,zone:'  Zone   A '},'1']);
  const candidates=[
   {id:11,distance:1,zone:'zone a',species:1},
   {id:12,distance:4,zone:' Zone A ',species:1},
   {id:13,distance:8,zone:'ZONE A',species:1},
   {id:14,distance:25,zone:'Zone A',species:1},
   {id:15,distance:1,zone:'Zone A',species:2},
   {id:16,distance:1,zone:'Zone B',species:1}
  ];
  for(const item of candidates){
   await pool.query('UPDATE plant_record SET species_id=$1 WHERE plant_id=$2',[item.species,item.id]);
   await pool.query(`INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,origin_type)
    VALUES($1,$2,'staff:owner','Approved',$3,$4,'subsequent_observation')`,[
    'group-candidate-'+item.id,item.id,{latitude:0,longitude:item.distance/6371000*180/Math.PI,accuracy_m:2,zone:item.zone},'group-candidate-'+item.id]);
  }
  const rows=(await call()).data.candidates,byId=Object.fromEntries(rows.map(row=>[row.plant_id,row]));
  for(const item of candidates)assert.ok(byId[String(item.id)],'candidate '+item.id+' should be returned');
  assert.equal(byId['11'].match_status,'same_species_zone');assert.equal(byId['11'].within_grouping_radius,true);
  assert.equal(byId['12'].match_status,'same_species_zone');assert.equal(byId['12'].within_grouping_radius,true);
  assert.equal(byId['13'].match_status,'same_species_zone');assert.equal(byId['13'].within_grouping_radius,false);
  assert.equal(byId['14'].match_status,'same_species_zone');assert.equal(byId['14'].within_grouping_radius,false);
  assert.equal(byId['15'].match_status,'different_species');
  assert.equal(byId['16'].match_status,'different_zone');
  await pool.query(`INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,origin_type)
   VALUES('group-unknown-zone',17,'staff:owner','Approved','{"latitude":0,"longitude":0.00001,"accuracy_m":2}','group-unknown-zone','subsequent_observation')`);
  assert.equal((await call()).data.candidates.find(row=>row.plant_id==='17').match_status,'uncertain_zone');
  await pool.query("DELETE FROM plant_observation WHERE id LIKE 'group-%'; UPDATE plant_record SET species_id=1 WHERE plant_id=15");
 });
 await t.test('approved coordinates win over a newer unverified recorded location, location history does not duplicate Plants',async()=>{
  await pool.query(`UPDATE plant_location SET longitude=0 WHERE plant_id=1;
   INSERT INTO plant_location(plant_id,latitude,longitude,accuracy_m) VALUES(1,0,0,5);
   INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key) VALUES('approved-source',1,'staff:owner','Approved','{"latitude":0,"longitude":1,"accuracy_m":25}','approved');`);
  assert.equal((await call()).data.candidates.length,0);
  await pool.query(`UPDATE plant_observation SET content='{"latitude":0,"longitude":0,"accuracy_m":25}' WHERE id='approved-source'`);
  const r=(await call()).data;assert.equal(r.candidates.length,1);assert.equal(r.candidates[0].location_source,'approved_observation');assert.equal(r.candidates[0].accuracy_m,25);assert.equal(r.candidates[0].latitude,0);assert.equal(r.candidates[0].longitude,0);assert.equal(r.target_location.latitude,0);assert.equal(r.target_location.longitude,0);assert.equal(r.target_location.source,'submission');
  await pool.query(`UPDATE plant_observation SET content=content||'{"accuracy_m":"bad legacy value"}'::jsonb WHERE id='approved-source'`);assert.equal((await call()).data.candidates[0].accuracy_m,null);
  await pool.query(`UPDATE plant_observation SET content=content||'{"accuracy_m":25}'::jsonb WHERE id='approved-source'`);
 });
 await t.test('pending registrations are separate candidates and use current pending GPS before unverified recorded GPS',async()=>{
  await pool.query(`INSERT INTO plant_record(plant_id,species_id,registered_subject,qr_token,rbac_status) VALUES(701,1,'staff:other','pending-701','Pending Review');
   INSERT INTO plant_location(plant_id,latitude,longitude) VALUES(701,0,1);
   INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key) VALUES('candidate-pending',701,'staff:other','Pending Review','{"latitude":0,"longitude":0.00001}','pending-701');`);
  const r=(await call()).data,candidate=r.candidates.find(row=>row.plant_id==='701');assert.ok(candidate);assert.equal(candidate.status,'Pending Review');assert.equal(candidate.location_source,'pending_observation_unverified');assert.equal(candidate.accuracy_m,null);assert.equal(candidate.latitude,0);assert.equal(candidate.longitude,0.00001);
  await pool.query("UPDATE plant_record SET rbac_status='Rejected' WHERE plant_id=701");assert.ok(!(await call()).data.candidates.some(row=>row.plant_id==='701'));
 });
 await t.test('missing or invalid submitted GPS is unavailable; reviewed and subsequent submissions are not eligible',async()=>{
  await pool.query("UPDATE plant_record SET rbac_status='Approved' WHERE plant_id=1000");assert.equal((await call()).data.state,'not_eligible');
  await pool.query("UPDATE plant_record SET rbac_status='Pending Review' WHERE plant_id=1000");
  for(const content of [{},{latitude:null,longitude:0},{latitude:91,longitude:0},{latitude:'0',longitude:0}]){
   await pool.query('UPDATE plant_observation SET content=$1 WHERE id=$2',[content,'1']);assert.equal((await call()).data.state,'unavailable');
  }
  await pool.query(`UPDATE plant_observation SET content='{"latitude":0,"longitude":0}',status='Approved' WHERE id='1'`);assert.equal((await call()).data.state,'not_eligible');
  await pool.query(`UPDATE plant_observation SET status='Pending Review',origin_type='subsequent_observation' WHERE id='1'`);assert.equal((await call()).data.state,'not_eligible');
  await pool.query(`UPDATE plant_observation SET origin_type='initial_registration' WHERE id='1'`);
 });
 await t.test('pending registration uses its versioned Species Request name provisionally and preserves uncertainty',async()=>{
  await pool.query(`UPDATE plant_location SET longitude=1;
   UPDATE plant_observation SET content='{"latitude":0,"longitude":1,"accuracy_m":2,"zone":"Zone A"}' WHERE id='approved-source';
   INSERT INTO species(species_id,scientific_name,rbac_data) VALUES
    (3,'Shorea macrophylla','{"approvalStatus":"Pending Review"}'),
    (4,'Sonneratia alba','{"approvalStatus":"Pending Review"}'),
    (5,'Approved different species','{"approvalStatus":"Approved"}'),
    (6,'Existing species','{"approvalStatus":"Pending Review"}');
   INSERT INTO species_request_submission(request_id,owner_subject,client_key,payload_hash,scientific_name,common_name,genus_name,family_name,conservation_status,description,habitat,photo,proposed_species_id)
   VALUES(23,'staff:owner','request-23',repeat('b',64),'Sonneratia alba','Common','Genus','Family','Unknown','Description','Forest',decode('00','hex'),2);
   UPDATE plant_record SET species_id=2,scientific_name='Sonneratia alba' WHERE plant_id=1000;
   UPDATE plant_observation SET content='{"latitude":0,"longitude":0,"accuracy_m":2,"zone":"Zone A"}' WHERE id='1';
   UPDATE plant_submission_receipt SET result=result||'{"species_id":2,"species_request_id":23,"species_request_client_key":"request-23"}'::jsonb WHERE owner_subject='staff:owner' AND client_key='initial';
   UPDATE species SET scientific_name='Sonneratia alba',rbac_data='{"approvalStatus":"Pending Review"}' WHERE species_id=2;
   INSERT INTO record_version_history(id,record_type,request_id,version_number,owner_subject,edited_by,status,snapshot,created_at)
    VALUES('species-request-23-v1','species',23,1,'staff:owner','staff:owner','Pending Review',
     '{"request_id":23,"species_id":2,"scientific_name":"Sonneratia alba"}',CURRENT_TIMESTAMP-INTERVAL '1 day');
   INSERT INTO plant_record(plant_id,species_id,registered_subject,qr_token,rbac_status,scientific_name) VALUES
    (702,3,'staff:other','pending-species-candidate','Approved','Rubroshorea macrophylla'),
    (703,4,'staff:other','same-provisional-candidate','Approved','Marsh Apple'),
    (704,1,'staff:other','approved-candidate','Approved','Different common name'),
    (705,5,'staff:other','different-canonical-candidate','Approved','Nearby Plant'),
    (706,6,'staff:other','unverified-name-candidate','Approved','Existing species');
   INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,origin_type) VALUES
    ('candidate-702',702,'staff:other','Approved','{"latitude":0,"longitude":0.00001,"accuracy_m":2,"zone":"Zone A"}','candidate-702','subsequent_observation'),
    ('candidate-703',703,'staff:other','Approved','{"latitude":0,"longitude":0.00002,"accuracy_m":2,"zone":"Zone A"}','candidate-703','subsequent_observation'),
    ('candidate-704',704,'staff:other','Approved','{"latitude":0,"longitude":0.00003,"accuracy_m":2,"zone":"Zone A"}','candidate-704','subsequent_observation'),
    ('candidate-705',705,'staff:other','Approved','{"latitude":0,"longitude":0.00004,"accuracy_m":2,"zone":"Zone A"}','candidate-705','subsequent_observation'),
    ('candidate-706',706,'staff:other','Approved','{"latitude":0,"longitude":0.00005,"accuracy_m":2,"zone":"Zone A"}','candidate-706','subsequent_observation');
   UPDATE plant_location SET longitude=0.00001 WHERE plant_id=702;
   UPDATE plant_location SET longitude=0.00002 WHERE plant_id=703;
   UPDATE plant_location SET longitude=0.00003 WHERE plant_id=704;
   UPDATE plant_location SET longitude=0.00004 WHERE plant_id=705;
   UPDATE plant_location SET longitude=0.00005 WHERE plant_id=706;`);
  let result=(await call()).data;assert.equal(result.state,'complete');
  const byId=Object.fromEntries(result.candidates.map(row=>[row.plant_id,row]));
  assert.equal(byId['702'].plant_name,'Rubroshorea macrophylla');
  assert.equal(byId['702'].species_name,'Shorea macrophylla');
  assert.equal(byId['702'].species_match_status,'provisional_different_name');
  assert.equal(byId['702'].zone_match_status,'same');
  assert.equal(byId['702'].match_status,'provisional_species');
  assert.equal(byId['703'].species_match_status,'provisional_same_name');
  assert.equal(byId['703'].match_status,'provisional_species');
  assert.equal(byId['706'].species_match_status,'provisional_different_name');
  assert.equal(byId['706'].match_status,'provisional_species',
   'matching an approved catalog name by text alone must not create a confirmed canonical match');

  // A later corrected Species Request name must not replace the exact initial name
  // associated with the observation being reviewed.
  await pool.query(`UPDATE species_request_submission SET scientific_name='Corrected later name' WHERE request_id=23;
   UPDATE species SET scientific_name='Corrected later name' WHERE species_id=2;
   INSERT INTO record_version_history(id,record_type,request_id,version_number,owner_subject,edited_by,status,snapshot,created_at)
    VALUES('species-request-23-v2','species',23,2,'staff:owner','staff:owner','Pending Review',
     '{"request_id":23,"species_id":2,"scientific_name":"Corrected later name"}',CURRENT_TIMESTAMP+INTERVAL '1 day');`);
  result=(await call()).data;assert.equal(result.candidates.find(row=>row.plant_id==='703').species_match_status,'provisional_same_name');

  // The Species row may already be canonical even while an associated request is pending.
  await pool.query(`INSERT INTO species_request_submission(request_id,owner_subject,client_key,payload_hash,scientific_name,common_name,genus_name,family_name,conservation_status,description,habitat,photo,proposed_species_id)
   VALUES(24,'staff:owner','request-24',repeat('c',64),'Existing species','Common','Genus','Family','Unknown','Description','Forest',decode('00','hex'),1);
   UPDATE plant_record SET species_id=1 WHERE plant_id=1000;
   UPDATE plant_submission_receipt SET result=result||'{"species_id":1,"species_request_id":24,"species_request_client_key":"request-24"}'::jsonb WHERE owner_subject='staff:owner' AND client_key='initial';`);
  result=(await call()).data;
  assert.equal(result.candidates.find(row=>row.plant_id==='704').species_match_status,'confirmed_same');
  assert.equal(result.candidates.find(row=>row.plant_id==='704').match_status,'same_species_zone');

  // Selecting an approved Species directly is confirmed by its canonical ID.
  await pool.query(`UPDATE plant_submission_receipt SET result=result||'{"species_request_id":null}'::jsonb WHERE owner_subject='staff:owner' AND client_key='initial'`);
  result=(await call()).data;
  assert.equal(result.candidates.find(row=>row.plant_id==='704').species_match_status,'confirmed_same');

  // A missing submitted identity stays unknown; a missing target zone cannot become a match.
  await pool.query(`UPDATE plant_record SET species_id=2 WHERE plant_id=1000;
   UPDATE plant_submission_receipt SET result='{"id":"1","plant_id":1000,"species_id":2,"status":"Pending Review","qr_token":"target-qr","species_request_id":23,"species_request_client_key":"request-23"}' WHERE owner_subject='staff:owner' AND client_key='initial';
   DELETE FROM record_version_history WHERE request_id=23;`);
  result=(await call()).data;
  assert.equal(result.candidates.find(row=>row.plant_id==='704').species_match_status,'unknown');
  await pool.query(`INSERT INTO record_version_history(id,record_type,request_id,version_number,owner_subject,edited_by,status,snapshot,created_at)
   VALUES('species-request-23-v1-restored','species',23,1,'staff:owner','staff:owner','Pending Review',
    '{"request_id":23,"species_id":2,"scientific_name":"Sonneratia alba"}',CURRENT_TIMESTAMP-INTERVAL '1 day');
   UPDATE plant_observation SET content='{"latitude":0,"longitude":0,"accuracy_m":2}' WHERE id='1';`);
  result=(await call()).data;
  assert.equal(result.candidates.find(row=>row.plant_id==='704').species_match_status,'provisional_different_name');
  assert.equal(result.candidates.find(row=>row.plant_id==='704').zone_match_status,'unknown');
  assert.equal(result.candidates.find(row=>row.plant_id==='704').match_status,'provisional_species');

  // A confirmed species mismatch remains excluded regardless of poor GPS accuracy.
  await pool.query(`UPDATE plant_record SET species_id=1 WHERE plant_id=1000;
   UPDATE plant_submission_receipt SET result='{"id":"1","plant_id":1000,"species_id":1,"status":"Pending Review","qr_token":"target-qr","species_request_id":null}' WHERE owner_subject='staff:owner' AND client_key='initial';
   UPDATE plant_observation SET content='{"latitude":0,"longitude":0,"accuracy_m":25,"zone":"Zone A"}' WHERE id='1';`);
  result=(await call()).data;
  assert.equal(result.candidates.find(row=>row.plant_id==='705').species_match_status,'confirmed_different');
  assert.equal(result.candidates.find(row=>row.plant_id==='705').match_status,'different_species');
  assert.equal(result.candidates.find(row=>row.plant_id==='704').accuracy_m,2);
 });
 await t.test('no nearby, missing existing coordinates and result truncation are distinct',async()=>{
  await pool.query(`UPDATE plant_observation SET content='{"latitude":0,"longitude":1}' WHERE id='approved-source';
   UPDATE plant_observation SET content='{"latitude":0,"longitude":1,"accuracy_m":2,"zone":"Zone A"}' WHERE id LIKE 'candidate-%';
   UPDATE plant_location SET longitude=1 WHERE plant_id<>1000`);
  let r=(await call()).data;assert.equal(r.state,'complete');assert.equal(r.candidates.length,0);
  await pool.query(`INSERT INTO plant_record(plant_id,species_id,registered_subject,qr_token,rbac_status) VALUES(700,1,'staff:owner','unlocated','Approved')`);
  r=(await call()).data;assert.equal(r.state,'incomplete');assert.equal(r.unlocated_count,1);
  await pool.query('UPDATE plant_location SET longitude=0 WHERE plant_id BETWEEN 2 AND 30');
  r=(await call()).data;assert.equal(r.state,'incomplete');assert.equal(r.total_nearby,29);assert.equal(r.candidates.length,20);
 });
 await t.test('repeated GETs are READ ONLY and preserve every original row, review and audit',async()=>{
  const tables=['plant_record','plant_location','plant_observation','observation_review','business_audit','plant_submission_receipt','species_request_submission'];
  async function snapshot(){const result={};for(const table of tables)result[table]=(await pool.query(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM ${table} t`)).rows[0].rows;return result}
  const before=await snapshot(),sql=[],connect=pool.connect.bind(pool);
  pool.connect=async()=>{const c=await connect(),query=c.query.bind(c);c.query=(text,values)=>{sql.push(text);return query(text,values)};return c};
  try{await call();await call()}finally{pool.connect=connect}
  assert.deepEqual(await snapshot(),before);assert.ok(sql.some(q=>q==='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'));
  assert.ok(sql.every(q=>/^\s*(SELECT|WITH|BEGIN|SET LOCAL|COMMIT|ROLLBACK)\b/.test(q)));
 });
});
