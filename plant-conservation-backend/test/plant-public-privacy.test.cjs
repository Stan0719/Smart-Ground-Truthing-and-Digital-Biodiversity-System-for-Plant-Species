"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {once}=require('node:events');
const {Buffer}=require('node:buffer');
const {createPlantDatabase}=require('./postgres-fixture.cjs');
const {createPlantApp}=require('../server.js');

test('public plant, species, QR and assets use safe projections while staff/owners retain their contracts',async t=>{
 const pool=await createPlantDatabase();t.after(()=>pool.end());
 await pool.query("CREATE TABLE plant_app.qr_code(qr_id integer,plant_id integer,qr_code text,status text)");
 await pool.query(`INSERT INTO species(scientific_name,common_name,description,rbac_data) VALUES
 ('Public species','Public common','Description','{"habitat":"Habitat","culturalSignificance":"Culture"}'),
 ('Internal species','Internal common','Description','{}'),
 ('Protected species','Protected common','Description','{}'),
 ('Pending species','Pending common','Description','{"approvalStatus":"Pending Review","submittedBy":"staff:bot"}');
 INSERT INTO rbac_species_visibility VALUES(1,'public'),(2,'internal'),(3,'protected'),(4,'public');
 INSERT INTO plant_record(species_id,registered_subject,rbac_status,qr_token) VALUES
 (1,'staff:bot','Approved','public-qr'),(1,'staff:bot','Pending Review','pending-qr'),
 (2,'staff:bot','Approved','internal-qr'),(3,'staff:bot','Approved','protected-qr'),(4,'staff:bot','Approved','inconsistent-qr');
 INSERT INTO plant_location(plant_id,latitude,longitude,accuracy_m) VALUES(1,1,2,3);
 INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key)
  VALUES('approved',1,'staff:bot','Approved','{"latitude":1,"longitude":2,"heightCm":10,"healthStatus":"Healthy","lifeStage":"Mature","morphology":"Broad leaves","notes":"Private field note","taxonomy":"Private taxonomy"}','approved'),
 ('pending',1,'staff:bot','Pending Review','{"heightCm":11,"healthStatus":"Poor","lifeStage":"Seedling","morphology":"Unreviewed"}','pending'),
 ('inconsistent',5,'staff:bot','Approved','{}','inconsistent');
 INSERT INTO plant_app.qr_code(qr_id,plant_id,qr_code,status) SELECT plant_id,plant_id,qr_token,'active' FROM plant_record;`);
 for(const [id,species,plant,approved,observation]of [['public-image',1,null,true,null],['pending-image',1,null,false,null],['pending-species-image',4,null,true,null],['private-photo',null,1,false,'pending'],['unapproved-species-plant-photo',null,5,true,'inconsistent']])
  await pool.query("INSERT INTO plant_asset(id,species_id,plant_id,owner_subject,client_key,approved,content_type,content,observation_id) VALUES($1,$2,$3,'staff:bot',$1,$4,'image/jpeg',$5,$6)",[id,species,plant,approved,Buffer.from('test fixture'),observation]);
 const roles={officer:'Conservation Officer',bot:'Botanist',admin:'Administrator',visitor:'Visitor',other:'Botanist'};
 const tokens=Object.fromEntries(Object.keys(roles).map((key,i)=>[key,String(i+1).repeat(64)]));
 const auth={session:async token=>{const key=Object.keys(tokens).find(k=>tokens[k]===token);return key?{id:key,role:roles[key],status:'Active',mustChangePassword:false}:null},event:async()=>{}};
 const server=createPlantApp({pool,auth,origins:new Set()}).listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)}));
 const call=async(path,role)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{headers:role?{Authorization:`Bearer ${tokens[role]}`}:{}});return {status:r.status,data:r.headers.get('content-type')?.includes('json')?await r.json():null}};
 for(const role of [undefined,'visitor']) {
  const r=await call('/plants/1',role);assert.equal(r.status,200);
  assert.deepEqual(Object.keys(r.data.plant).sort(),['common_name','current_registration','latest_approved','latest_verified_observation','observed_at','plant_id','rbac_status','scientific_name','species_id']);
  assert.equal(r.data.plant.rbac_status,'Approved');
  assert.equal(r.data.plant.common_name,'Public common');
  assert.deepEqual(r.data.plant.latest_approved,{heightCm:10,healthStatus:'Healthy',lifeStage:'Mature',morphology:'Broad leaves'});
  assert.equal(r.data.plant.latest_approved.notes,undefined);
  assert.equal(r.data.plant.latest_approved.taxonomy,undefined);
  for(const field of ['registered_subject','registered_at','qr_token','latitude','longitude','zone'])assert.equal(field in r.data.plant,false);
  const list=await call('/plants',role);assert.equal(list.data.plants.length,1);assert.deepEqual(list.data.plants[0],r.data.plant);
  const species=(await call('/species/1',role)).data.species;
  assert.deepEqual(Object.keys(species).sort(),['common_name','description','family_name','genus_name','image_asset_id','image_url','scientific_name','species_id',...(!role ? ['habitat'] : [])].sort());
  const qr=(await call('/qr/public-qr',role)).data;assert.deepEqual(Object.keys(qr.plant).sort(),['plant_id','species_id']);assert.equal('habitat' in qr.species,false);
  for(const id of [2,3,4,5])assert.equal((await call('/plants/'+id,role)).status,404);
  assert.equal((await call('/qr/inconsistent-qr',role)).status,404);
  assert.equal((await call('/species/4',role)).status,404);
  for(const id of ['pending-image','pending-species-image','private-photo','unapproved-species-plant-photo'])assert.equal((await call('/assets/'+id,role)).status,404);
  assert.deepEqual((await call('/assets?species_id=1',role)).data.assets.map(a=>a.id),['public-image']);
  assert.deepEqual((await call('/assets?species_id=4',role)).data.assets,[]);
  assert.equal((await call('/assets/public-image',role)).status,200);
  assert.equal(qr.assigned,true);
  // The incoming plant-photo listing must retain the local species-approval boundary.
  assert.deepEqual((await call('/assets?plant_id=5',role)).data.assets,[]);
 }
 const officer=(await call('/plants/1','officer')).data.plant;
 assert.equal(officer.latitude,null);assert.equal(officer.accuracy_m,null);assert.equal(officer.current_registration.state,'unavailable');assert.equal(officer.registered_subject,'staff:bot');assert.ok(officer.registered_at);assert.equal(officer.rbac_status,'Approved');assert.equal(officer.latest_approved.heightCm,10);
 for(const id of [2,3,4])assert.equal((await call('/plants/'+id,'officer')).status,200);
 assert.equal((await call('/assets/pending-image','officer')).status,200);assert.equal((await call('/assets/private-photo','officer')).status,200);
 const bot=(await call('/plants/2?scope=mine','bot')).data.plant;
 assert.equal(bot.registered_subject,'staff:bot');assert.equal(bot.rbac_status,'Pending Review');assert.ok(bot.registered_at);assert.equal(bot.qr_token,'pending-qr');
 assert.equal((await call('/plants/3','bot')).status,200);assert.equal((await call('/plants/4?scope=mine','bot')).status,200);
 assert.equal((await call('/assets/private-photo?scope=mine','bot')).status,200);assert.equal((await call('/assets/pending-image','bot')).status,200);
 assert.equal((await call('/plants/1','bot')).data.plant.latitude,null);
 assert.equal((await call('/plants/1','bot')).data.plant.latest_approved.latitude,undefined);
 assert.equal((await call('/assets/pending-image','other')).status,404);
 assert.deepEqual((await call('/assets?species_id=1','other')).data.assets.map(a=>a.id),['public-image']);
 assert.equal((await call('/assets/private-photo','other')).status,404);
 assert.equal((await call('/plants/1','admin')).status,200);

 await t.test('Guest web projection omits mobile observation summaries and never changes authenticated contracts',async()=>{
  const list=await call('/plants?scope=public-web');assert.equal(list.status,200);
  assert.deepEqual(list.data.plants.map(p=>p.plant_id),[1]);
  assert.deepEqual(Object.keys(list.data.plants[0]).sort(),['plant_id','species_id']);
  const detail=await call('/plants/1?scope=public-web');assert.deepEqual(detail.data.plant,list.data.plants[0]);
  for(const role of Object.keys(roles))assert.equal((await call('/plants?scope=public-web',role)).status,403);
  for(const id of [2,3,4,5])assert.equal((await call(`/plants/${id}?scope=public-web`)).status,404);
  assert.equal((await call('/plants/1','officer')).data.plant.latest_approved.healthStatus,'Healthy');
  assert.equal((await call('/plants/1/detail','admin')).status,200);
 });

 await t.test('Guest gallery list and image bytes agree on current approved/public assets with no evidence metadata',async()=>{
  await pool.query(`INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,created_at,updated_at) VALUES
   ('older',1,'staff:bot','Approved','{}','older','2020-01-01','2020-01-01'),
   ('rejected',1,'staff:bot','Rejected','{}','rejected','2020-01-01','2020-01-01');
   INSERT INTO species(species_id,scientific_name,rbac_data) VALUES(5,'Missing visibility','{}');
   INSERT INTO plant_record(plant_id,species_id,registered_subject,rbac_status,qr_token) VALUES
    (6,5,'staff:bot','Approved','missing-visibility'),(7,1,'staff:bot','Rejected','rejected-plant');`);
  for(const [id,plant,approved,observation]of [
   ['current-a',1,false,'approved'],['current-b',1,true,'approved'],['standalone',1,true,null],
   ['not-published',1,false,null],['older-photo',1,true,'older'],['rejected-photo',1,true,'rejected'],
   ['pending-plant',2,true,null],['internal-photo',3,true,null],['protected-photo',4,true,null],
   ['missing-visibility-photo',6,true,null],['rejected-plant-photo',7,true,null],['bad-link',1,true,'inconsistent']])
   await pool.query("INSERT INTO plant_asset(id,plant_id,owner_subject,client_key,approved,content_type,content,observation_id) VALUES($1,$2,'staff:bot',$1,$3,'image/jpeg',$4,$5)",[id,plant,approved,Buffer.from('isolated image'),observation]);
  // Add explicit receipt provenance only for the registration gallery scenario.
  await pool.query(`CREATE TABLE plant_submission_receipt(owner_subject text,client_key text,payload_hash text,result jsonb);
    INSERT INTO plant_submission_receipt VALUES('staff:bot','approved',repeat('a',64),
    '{"id":"approved","plant_id":1,"species_id":1,"qr_token":"public-qr","status":"Pending Review","species_request_id":null}');
    UPDATE plant_asset SET approved=TRUE WHERE id='current-a'`);
  const images=(await call('/assets?plant_id=1')).data.assets;
  assert.deepEqual(images.map(a=>a.id).sort(),['current-a','current-b']);
  for(const image of images){assert.deepEqual(Object.keys(image).sort(),['content_type','id']);assert.equal((await call('/assets/'+image.id)).status,200);}
  for(const id of ['not-published','older-photo','rejected-photo','pending-plant','internal-photo','protected-photo','missing-visibility-photo','rejected-plant-photo','bad-link','private-photo'])assert.equal((await call('/assets/'+id)).status,404);
  for(const id of [2,3,4,5,6,7])assert.deepEqual((await call('/assets?plant_id='+id)).data.assets,[]);
  for(const id of [2,3,4,5,6,7])assert.equal((await call('/plants/'+id+'/detail')).status,404);
  for(const route of ['/plants/1/detail/gallery','/plants/1/detail/history','/plants/1/detail/assets/current-a'])assert.equal((await call(route)).status,401);
  const detail=(await call('/plants/1/detail')).data;
  assert.deepEqual(Object.keys(detail.information).sort(),['common_name','description','family_name','genus_name','habitat','plant_id','scientific_name','species_id']);assert.equal(detail.staff,null);
  assert.equal(detail.information.habitat,'Habitat');
  const summary=(await call('/plants?scope=public-web')).data.plants[0];
  assert.deepEqual(Object.keys(summary).sort(),['plant_id','plant_image_asset_id','species_id']);
 });
 await t.test('habitat follows parent publication rules with no new permission or staff-field exposure',async()=>{
  assert.equal((await call('/species/1')).data.species.habitat,'Habitat');
  assert.equal((await call('/plants/1/detail')).data.information.habitat,'Habitat');
  for(const [index,approval,visibility]of [[100,'Pending Review','public'],[101,'Rejected','public'],[102,'Approved','internal'],[103,'Approved','protected'],[104,'Approved',null]]){
   await pool.query('INSERT INTO species(species_id,scientific_name,rbac_data) VALUES($1,$2,$3)',[index,'Habitat fixture '+index,{approvalStatus:approval,habitat:'Riverine forest'}]);
   if(visibility)await pool.query('INSERT INTO rbac_species_visibility VALUES($1,$2)',[index,visibility]);
   await pool.query("INSERT INTO plant_record(plant_id,species_id,registered_subject,rbac_status,qr_token) VALUES($1,$1,'staff:bot','Approved',$2)",[index,'habitat-'+index]);
   assert.equal((await call('/species/'+index)).status,404);
   assert.equal((await call('/plants/'+index+'/detail')).status,404);
  }
  await pool.query("UPDATE species SET rbac_data=jsonb_set(rbac_data,'{habitat}','\"\"') WHERE species_id=1");
  assert.equal((await call('/species/1')).data.species.habitat,'');
  assert.equal((await call('/plants/1/detail')).data.information.habitat,'');
  assert.equal((await call('/plants/1/detail','officer')).data.staff.habitat,'');
  assert.equal((await call('/species/1','admin')).status,200);
  assert.equal((await call('/plants/1/detail','admin')).status,200);
 });

});
