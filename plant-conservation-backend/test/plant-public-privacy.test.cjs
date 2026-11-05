"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {once}=require('node:events');
const {createPlantDatabase}=require('./postgres-fixture.cjs');
const {createPlantApp}=require('../server.js');

test('public plant, species, QR and assets use safe projections while staff/owners retain their contracts',async t=>{
 const pool=await createPlantDatabase();t.after(()=>pool.end());
 await pool.query("CREATE TABLE public.qr_code(qr_id integer,plant_id integer,qr_code text,status text)");
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
 VALUES('approved',1,'staff:bot','Approved','{"latitude":1,"longitude":2,"heightCm":10}','approved'),
 ('private',1,'staff:bot','Draft','{"heightCm":11}','private'),
 ('inconsistent',5,'staff:bot','Approved','{}','inconsistent');
 INSERT INTO public.qr_code(qr_id,plant_id,qr_code,status) SELECT plant_id,plant_id,qr_token,'active' FROM plant_record;`);
 for(const [id,species,plant,approved,observation]of [['public-image',1,null,true,null],['pending-image',1,null,false,null],['pending-species-image',4,null,true,null],['private-photo',null,1,false,'private'],['unapproved-species-plant-photo',null,5,true,'inconsistent']])
  await pool.query("INSERT INTO plant_asset(id,species_id,plant_id,owner_subject,client_key,approved,content_type,content,observation_id) VALUES($1,$2,$3,'staff:bot',$1,$4,'image/jpeg',$5,$6)",[id,species,plant,approved,Buffer.from('test fixture'),observation]);
 const roles={officer:'Conservation Officer',bot:'Botanist',admin:'Administrator',visitor:'Visitor',other:'Botanist'};
 const tokens=Object.fromEntries(Object.keys(roles).map((key,i)=>[key,String(i+1).repeat(64)]));
 const auth={session:async token=>{const key=Object.keys(tokens).find(k=>tokens[k]===token);return key?{id:key,role:roles[key],status:'Active',mustChangePassword:false}:null},event:async()=>{}};
 const server=createPlantApp({pool,auth,origins:new Set()}).listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)}));
 const call=async(path,role)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{headers:role?{Authorization:`Bearer ${tokens[role]}`}:{}});return {status:r.status,data:r.headers.get('content-type')?.includes('json')?await r.json():null}};
 for(const role of [undefined,'visitor']) {
  const r=await call('/plants/1',role);assert.equal(r.status,200);assert.deepEqual(Object.keys(r.data.plant).sort(),['plant_id','species_id']);
  const list=await call('/plants',role);assert.equal(list.data.plants.length,1);assert.deepEqual(list.data.plants[0],r.data.plant);
  const species=(await call('/species/1',role)).data.species;
  assert.deepEqual(Object.keys(species).sort(),['common_name','description','family_name','genus_name','image_asset_id','image_url','scientific_name','species_id']);
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
 assert.equal(officer.latitude,1);assert.equal(officer.accuracy_m,3);assert.equal(officer.registered_subject,'staff:bot');assert.ok(officer.registered_at);assert.equal(officer.rbac_status,'Approved');assert.equal(officer.latest_approved.heightCm,10);
 for(const id of [2,3,4])assert.equal((await call('/plants/'+id,'officer')).status,200);
 assert.equal((await call('/assets/pending-image','officer')).status,200);assert.equal((await call('/assets/private-photo','officer')).status,200);
 const bot=(await call('/plants/2?scope=mine','bot')).data.plant;
 assert.equal(bot.registered_subject,'staff:bot');assert.equal(bot.rbac_status,'Pending Review');assert.ok(bot.registered_at);assert.equal(bot.qr_token,'pending-qr');
 assert.equal((await call('/plants/3','bot')).status,200);assert.equal((await call('/plants/4?scope=mine','bot')).status,200);
 assert.equal((await call('/assets/private-photo?scope=mine','bot')).status,200);assert.equal((await call('/assets/pending-image','bot')).status,200);
 assert.equal((await call('/plants/1','bot')).data.plant.latitude,1);
 assert.equal((await call('/plants/1','bot')).data.plant.latest_approved.latitude,undefined);
 assert.equal((await call('/assets/pending-image','other')).status,404);
 assert.deepEqual((await call('/assets?species_id=1','other')).data.assets.map(a=>a.id),['public-image']);
 assert.equal((await call('/assets/private-photo','other')).status,404);
 assert.equal((await call('/plants/1','admin')).status,403);
});
