"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {readFileSync}=require('node:fs'),{mkdtemp,rm}=require('node:fs/promises');
const {join,resolve,basename,sep}=require('node:path'),{tmpdir}=require('node:os');
const {once}=require('node:events');
const {createPlantDatabase}=require('./postgres-fixture.cjs');
const {createPlantApp}=require('../server.js');
const {hash}=require('../domain.cjs');
const {createOfficerNotificationDelivery}=require('../officer-notification-delivery.cjs');
const prerequisites=['004-species-requests.sql','006-atomic-plant-submissions.sql','008-record-change-submissions.sql','009-record-version-history.sql','013-staff-notification-foundation.sql','016-species-request-content-revision.sql','017-species-review-cycle.sql','021-observation-edit-requests.sql','022-cancel-edit-requests.sql','024-record-change-review-events.sql','025-original-plant-withdrawal.sql','026-original-species-withdrawal.sql','027-original-observation-withdrawal.sql','028-immutable-record-version-revisions.sql','029-observation-submission-versions.sql','030-observation-edit-officer-notifications.sql','031-iot-live-reading-aggregates.sql','032-canonical-threat-officer-notifications.sql'];
test('combined incoming Sensor/Camera producers retain atomic, deduplicated local threat notifications',async t=>{
 const db=await createPlantDatabase();t.after(()=>db.end());
 for(const f of prerequisites)await db.query(readFileSync(join(__dirname,'../migrations',f),'utf8'));
 await db.query("INSERT INTO species(scientific_name) VALUES('Combined synthetic'); INSERT INTO plant_record(species_id,registered_subject,qr_token) VALUES(1,'staff:bot','combined');");
 const sensorKey='a'.repeat(64),cameraKey='b'.repeat(64);
 await db.query(`INSERT INTO iot_device(id,name,device_type,plant_id,key_hash,thresholds) VALUES
 ('combined-sensor','Synthetic sensor','Sensor',1,$1,'{"temperature":25,"humidity":60,"soilMoisture":1000,"rainfall":100,"sound":50,"movement":0.5}'),
 ('combined-camera','Synthetic camera','Camera',1,$2,'{}')`,[hash(sensorKey),hash(cameraKey)]);
 const officer={id:'officer',role:'Conservation Officer',status:'Active',mustChangePassword:false};
 const auth={session:async()=>officer,event:async()=>{},db:{prepare:()=>({all:async()=>[{...officer,must_change_password:0}]})}};
 const root=await mkdtemp(join(tmpdir(),'niah-combined-camera-'));
 t.after(async()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));assert.ok(basename(root).startsWith('niah-combined-camera-'));await rm(root,{recursive:true,force:true});});
 const server=createPlantApp({pool:db,auth,origins:new Set(),recordingsRoot:root}).listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(done=>{server.closeAllConnections();server.close(done)}));
 const base='http://127.0.0.1:'+server.address().port+'/api';
 async function send(path,body,key,headers={}){const response=await fetch(base+path,{method:'POST',headers:{Authorization:'Device '+key,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});const data=await response.json();assert.equal(response.status,201,JSON.stringify(data));return data;}
 const high={temperature:30,humidity:75,soilMoisture:1500,rainfall:1000,sound:100,movement:1};
 const sample=(at,values=high)=>({device_id:'combined-sensor',client_key:'synthetic-'+at,values,capture:{observed_at:at,mpu_connected:true,dht_status:'Operational'}});
 const first=sample('2026-11-19T00:01:00.000Z');await send('/device/readings',first,sensorKey);
 let events=(await db.query("SELECT * FROM staff_notification_event WHERE resource_kind='threat_alert'")).rows;assert.equal(events.length,6);assert.ok(events.every(e=>e.metadata.source==='Sensor'&&e.metadata.reading_id===null));
 await send('/device/readings',first,sensorKey);await send('/device/readings',sample('2026-11-19T00:02:00.000Z'),sensorKey);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM staff_notification_event WHERE resource_kind='threat_alert'")).rows[0].n,6);
 const event={eventId:'c'.repeat(32),plantId:'1',eventType:'possible_plant_contact',title:'Synthetic contact',description:'Synthetic only',detectedAt:'2026-11-19T00:01:00.000Z',recordingStartedAt:'2026-11-19T00:01:00.000Z',recordingEndedAt:null,recordingStatus:'recording'};
 await send('/device/camera-events',event,cameraKey,{'X-Camera-ID':'combined-camera'});
 await send('/device/camera-events',event,cameraKey,{'X-Camera-ID':'combined-camera'});
 events=(await db.query("SELECT * FROM staff_notification_event WHERE resource_kind='threat_alert'")).rows;assert.equal(events.length,7);assert.equal(events.filter(e=>e.metadata.source==='Camera').length,1);
 const delivery=createOfficerNotificationDelivery({pool:db,auth});await delivery.deliverBatch();await delivery.deliverBatch();
 assert.equal((await db.query('SELECT count(*)::int AS n FROM staff_notification')).rows[0].n,7);
 const headers={Authorization:'Bearer '+'1'.repeat(64)};
 const inbox=await (await fetch(base+'/staff-notifications',{headers})).json();assert.equal(inbox.unread_count,7);assert.equal(inbox.notifications.length,7);
 // Authoritative incoming report consumes completed aggregates plus its current checkpoint.
 await send('/device/readings',sample('2026-11-19T00:11:00.000Z'),sensorKey);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM sensor_reading WHERE device_id='combined-sensor'")).rows[0].n,0);
 assert.ok((await db.query("SELECT count(*)::int AS n FROM iot_reading_aggregate WHERE device_id='combined-sensor'")).rows[0].n>0);
 const summaryResponse=await fetch(base+'/reports/iot?device=combined-sensor&measurement=temperature&period=all-time',{headers});assert.equal(summaryResponse.status,200);const summary=await summaryResponse.json();
 assert.equal(summary.statistics.find(s=>s.key==='totalReadings').value,3);
 assert.equal(summary.statistics.find(s=>s.key==='average').value,30);
 assert.equal(summary.rows.length,2);
 for(const metric of Object.keys(high)){
  const response=await fetch(base+'/reports/iot?device=combined-sensor&period=all-time&measurement='+metric,{headers});assert.equal(response.status,200);const report=await response.json();
  assert.equal(report.measurement,metric);assert.equal(report.statistics.find(s=>s.key==='totalReadings').value,3);assert.equal(report.statistics.find(s=>s.key==='average').value,high[metric]);
 }
 t.diagnostic('AUTHORITATIVE REPORT VERIFIED: completed aggregate plus active checkpoint contains all three accepted Sensor samples, without raw-row writes or duplicate notifications.');
});
