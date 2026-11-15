const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createPlantDatabase } = require('./postgres-fixture.cjs');
const { createPlantApp } = require('../server.js');
test('Administrator overview returns exact read-only totals and rejects other roles', async t => {
 const pool=await createPlantDatabase();t.after(()=>pool.end());
 const token='a'.repeat(64);
 let role='Administrator';
 const app=createPlantApp({pool,auth:{session:async()=>role ? ({id:'a',role,status:'Active',mustChangePassword:false}) : null,event:async()=>{}}});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
 const get=()=>fetch(`http://127.0.0.1:${server.address().port}/api/admin/overview`,{headers:{cookie:`niah_session=${token}`}});
 let r=await get();assert.equal(r.status,200);assert.deepEqual((await r.json()).overview,{plants:0,alerts:0});
 await pool.query(`INSERT INTO species(species_id,scientific_name) VALUES(1,'Species');
 INSERT INTO plant_record(species_id,registered_subject,qr_token) VALUES(1,'staff:a','a'),(1,'staff:a','b');
 INSERT INTO iot_device(id,name,key_hash) VALUES('d','Device','hash');
 INSERT INTO threat_alert_history(id,device_id,metric,value,status) VALUES('a','d','temperature',31,'New'),('b','d','movement',1,'Reviewing'),('c','d','movement',1,'Resolved');`);
 r=await get();assert.deepEqual((await r.json()).overview,{plants:2,alerts:2});
 for(role of ['Conservation Officer','Botanist','Visitor']){r=await get();assert.equal(r.status,403)}
 role=null;r=await get();assert.equal(r.status,401);
 assert.equal((await pool.query('SELECT COUNT(*)::integer AS n FROM threat_alert_history')).rows[0].n,3);
});
