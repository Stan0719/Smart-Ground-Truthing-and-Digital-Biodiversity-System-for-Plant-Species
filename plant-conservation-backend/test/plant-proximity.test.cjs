"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {once}=require('node:events');
const {readFileSync}=require('node:fs'),{join}=require('node:path');
const {createPlantDatabase}=require('./postgres-fixture.cjs');
const {createPlantApp}=require('../server.js');
const {distanceMetres,category,proximityConfig}=require('../plant-proximity.cjs');
test('Haversine metres, valid zero, invalid GPS, every exact threshold and configuration validation',()=>{
 const c=proximityConfig();assert.equal(distanceMetres({latitude:0,longitude:0},{latitude:0,longitude:0}),0);
 for(const d of [0,1.999,2,2.001,4.999,5,5.001,9.999,10,10.001,29.999,30,30.001]){
  const p={latitude:0,longitude:d/6371000*180/Math.PI};assert.ok(Math.abs(distanceMetres({latitude:0,longitude:0},p)-d)<1e-8);
  assert.equal(category(d,c),d<=2?'very_close':d<=5?'close':d<=10?'nearby':d<=30?'additional':'outside');
 }
 assert.ok(distanceMetres({latitude:0,longitude:179.999},{latitude:0,longitude:-179.999})<223);
 for(const latitude of [undefined,null,'0',NaN,Infinity,91])assert.throws(()=>distanceMetres({latitude,longitude:0},{latitude:0,longitude:0}));
 for(const config of [{radius_m:101},{very_close_m:5},{candidate_limit:51},{nearby_m:NaN},{unknown:1}])assert.throws(()=>proximityConfig(config));
 assert.equal(proximityConfig({very_close_m:1}).very_close_m,1);
});
test('read-only Officer proximity against more than 500 Plants with authentic registration provenance',async t=>{
 const pool=await createPlantDatabase();t.after(()=>pool.end());
 for(const file of ['004-species-requests.sql','006-atomic-plant-submissions.sql'])await pool.query(readFileSync(join(__dirname,'../migrations',file),'utf8'));
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
 await t.test('approved coordinates win over a newer unverified recorded location, location history does not duplicate Plants',async()=>{
  await pool.query(`UPDATE plant_location SET longitude=0 WHERE plant_id=1;
   INSERT INTO plant_location(plant_id,latitude,longitude,accuracy_m) VALUES(1,0,0,5);
   INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key) VALUES('approved-source',1,'staff:owner','Approved','{"latitude":0,"longitude":1,"accuracy_m":25}','approved');`);
  assert.equal((await call()).data.candidates.length,0);
  await pool.query(`UPDATE plant_observation SET content='{"latitude":0,"longitude":0,"accuracy_m":25}' WHERE id='approved-source'`);
  const r=(await call()).data;assert.equal(r.candidates.length,1);assert.equal(r.candidates[0].location_source,'approved_observation');assert.equal(r.candidates[0].accuracy_m,25);
  await pool.query(`UPDATE plant_observation SET content=content||'{"accuracy_m":"bad legacy value"}'::jsonb WHERE id='approved-source'`);assert.equal((await call()).data.candidates[0].accuracy_m,null);
  await pool.query(`UPDATE plant_observation SET content=content||'{"accuracy_m":25}'::jsonb WHERE id='approved-source'`);
 });
 await t.test('pending registrations are separate candidates and use current pending GPS before unverified recorded GPS',async()=>{
  await pool.query(`INSERT INTO plant_record(plant_id,species_id,registered_subject,qr_token,rbac_status) VALUES(701,1,'staff:other','pending-701','Pending Review');
   INSERT INTO plant_location(plant_id,latitude,longitude) VALUES(701,0,1);
   INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key) VALUES('candidate-pending',701,'staff:other','Pending Review','{"latitude":0,"longitude":0.00001}','pending-701');`);
  const r=(await call()).data,candidate=r.candidates.find(row=>row.plant_id==='701');assert.ok(candidate);assert.equal(candidate.status,'Pending Review');assert.equal(candidate.location_source,'pending_observation_unverified');assert.equal(candidate.accuracy_m,null);
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
 await t.test('linked new-species registration remains eligible without requiring its species approval',async()=>{
  await pool.query(`INSERT INTO species_request_submission(request_id,owner_subject,client_key,payload_hash,scientific_name,common_name,genus_name,family_name,conservation_status,description,habitat,photo,proposed_species_id)
   VALUES(9,'staff:owner','new-species',repeat('a',64),'New proposed name','Common','Genus','Family','Unknown','Description','Forest',decode('00','hex'),2);
   UPDATE plant_record SET species_id=2 WHERE plant_id=1000;
   UPDATE plant_submission_receipt SET result=result||'{"species_id":2,"species_request_id":9,"species_request_client_key":"new-species"}'::jsonb;
   UPDATE species SET rbac_data='{"approvalStatus":"Pending Review"}' WHERE species_id=2;`);
  assert.equal((await call()).data.state,'complete');
 });
 await t.test('no nearby, missing existing coordinates and result truncation are distinct',async()=>{
  await pool.query(`UPDATE plant_observation SET content='{"latitude":0,"longitude":1}' WHERE id='approved-source';UPDATE plant_location SET longitude=1 WHERE plant_id<>1000`);
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
