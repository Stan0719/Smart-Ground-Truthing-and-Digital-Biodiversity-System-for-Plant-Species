'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {once}=require('node:events');
const sharp=require('sharp');
const {createPlantDatabase}=require('./postgres-fixture.cjs');
const {createPlantApp}=require('../server.js');

test('species previews use only approved accessible images with stable upload order and official-image priority',async t=>{
 const pool=await createPlantDatabase();t.after(()=>pool.end());
 await pool.query("INSERT INTO species(scientific_name) VALUES('Public'),('Internal'),('Protected'),('No image'); INSERT INTO rbac_species_visibility VALUES(1,'public'),(2,'internal'),(3,'protected'),(4,'public'); INSERT INTO plant_record(species_id,registered_subject,rbac_status,qr_token) VALUES(1,'staff:bot','Approved','one'),(1,'staff:bot','Pending Review','two'),(2,'staff:bot','Approved','three'),(3,'staff:bot','Approved','four'); INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key) VALUES('obs-approved',1,'staff:bot','Approved','{}','one'),('obs-pending',1,'staff:bot','Pending Review','{}','two'),('obs-parent-pending',2,'staff:bot','Approved','{}','three'),('obs-internal',3,'staff:bot','Approved','{}','four'),('obs-protected',4,'staff:bot','Approved','{}','five')");
 const bytes=await sharp({create:{width:3,height:4,channels:3,background:'green'}}).jpeg().toBuffer();
 for(const [id,plant,observation,key] of [['a-photo-one',1,'obs-approved','upload:photo:1'],['z-photo-zero',1,'obs-approved','upload:photo:0'],['private-pending',1,'obs-pending','private:photo:0'],['parent-pending',2,'obs-parent-pending','parent:photo:0'],['internal',3,'obs-internal','internal:photo:0'],['protected',4,'obs-protected','protected:photo:0']]) await pool.query("INSERT INTO plant_asset(id,plant_id,observation_id,owner_subject,client_key,approved,content_type,content) VALUES($1,$2,$3,'staff:bot',$4,TRUE,'image/jpeg',$5)",[id,plant,observation,key,bytes]);
 await pool.query("INSERT INTO plant_asset(id,species_id,owner_subject,client_key,approved,content_type,content) VALUES('official',1,'staff:bot','official',FALSE,'image/jpeg',$1)",[bytes]);
 const roles={bot:'Botanist',other:'Botanist',officer:'Conservation Officer'};const tokens={bot:'1'.repeat(64),other:'2'.repeat(64),officer:'3'.repeat(64)};
 const auth={session:async token=>{const id=Object.keys(tokens).find(id=>tokens[id]===token);return id?{id,role:roles[id],status:'Active',mustChangePassword:false}:null},event:async()=>{}};
 const server=createPlantApp({pool,auth,origins:new Set()}).listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r))});
 const call=async(path,role)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{headers:tokens[role]?{Authorization:'Bearer '+tokens[role]}:{}});return{status:r.status,type:r.headers.get('content-type'),data:r.headers.get('content-type')?.includes('json')?await r.json():Buffer.from(await r.arrayBuffer())}};
 for(let n=0;n<3;n++){const result=await call('/species');assert.equal(result.status,200);const s=result.data.species.find(s=>s.species_id==='1');assert.equal(s.image_asset_id,'z-photo-zero');assert.equal(s.image_url,'/api/assets/z-photo-zero');assert.equal(result.data.species.find(s=>s.species_id==='4').image_url,undefined);}
 const image=await call('/assets/z-photo-zero');assert.equal(image.status,200);assert.match(image.type,/image\/jpeg/);assert.ok(image.data.equals(bytes));
 const own=await call('/observations?scope=mine','bot');const order=own.data.observations.find(o=>o.id==='obs-approved').assets.map(a=>a.id);assert.deepEqual(order,['z-photo-zero','a-photo-one']);
 assert.equal((await call('/species/2')).status,404);assert.equal((await call('/assets/internal')).status,404);assert.equal((await call('/assets/internal','bot')).status,200);
 assert.equal((await call('/species/3','bot')).status,404);assert.equal((await call('/assets/protected','bot')).status,404);assert.equal((await call('/assets/protected','officer')).status,200);
 await pool.query("UPDATE plant_record SET rbac_status='Pending Review' WHERE plant_id=1");assert.equal((await call('/species/1')).data.species.image_url,undefined);
 await pool.query("UPDATE plant_record SET rbac_status='Approved' WHERE plant_id=1; UPDATE plant_asset SET approved=FALSE WHERE id IN('z-photo-zero','a-photo-one')");assert.equal((await call('/species/1')).data.species.image_url,undefined);
 await pool.query("UPDATE plant_asset SET approved=TRUE WHERE id IN('z-photo-zero','a-photo-one','official')");assert.equal((await call('/species/1')).data.species.image_asset_id,'official');
});
