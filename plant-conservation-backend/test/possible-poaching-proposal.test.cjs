const test=require('node:test'),assert=require('node:assert/strict');
const {readFileSync}=require('node:fs'),{join}=require('node:path'),{randomUUID}=require('node:crypto');
test('unapplied poaching schema proposal preserves old events, validates provenance and protects immutable references',async t=>{
 const {testPool}=await import('../../web/server/test-postgres.mjs');const db=await testPool();t.after(()=>db.end());
 await db.query('CREATE SCHEMA plant_app;SET search_path=plant_app,pg_catalog');
 await db.query(readFileSync(join(__dirname,'../schema.postgres.sql'),'utf8'));
 for(const file of ['004-species-requests.sql','008-record-change-submissions.sql','013-staff-notification-foundation.sql'])await db.query(readFileSync(join(__dirname,'../migrations',file),'utf8'));
 const old=randomUUID();await db.query("INSERT INTO staff_notification_event(id,source_key,event_type,audience_role,resource_kind) VALUES($1,'old-admin','security_event','Administrator','system')",[old]);
 await db.query(readFileSync(join(__dirname,'../docs/proposals/possible-poaching-notifications.draft.sql'),'utf8'));
 assert.equal((await db.query('SELECT id FROM staff_notification_event WHERE id=$1',[old])).rows[0].id,old);
 await db.query("INSERT INTO iot_device(id,name,device_type,key_hash) VALUES('camera','Camera','Camera','hash')");
 await db.query("INSERT INTO threat_alert_history(id,device_id,metric,value) VALUES('alert','camera','fixture',1),('other','camera','fixture',1)");
 const insert=(id,key,meta,reference='alert')=>db.query("INSERT INTO staff_notification_event(id,source_key,event_type,audience_role,resource_kind,threat_alert_id,metadata) VALUES($1,$2,'possible_poaching_detected','Conservation Officer','threat_alert',$3,$4)",[id,key,reference,meta]);
 await assert.rejects(insert(randomUUID(),'no-provenance',{}));
 await assert.rejects(insert(randomUUID(),'null-provenance',{detection_source:null,detection_id:'d',source_version:'v'}));
 const id=randomUUID(),meta={detection_source:'fixture-only',detection_id:'d',source_version:'v'};await insert(id,'detection',meta);
 await assert.rejects(insert(randomUUID(),'duplicate',meta));
 await assert.rejects(insert(randomUUID(),'missing-ref',{...meta,detection_id:'missing'},'missing'));
 await assert.rejects(db.query('UPDATE staff_notification_event SET threat_alert_id=$1 WHERE id=$2',['other',id]));
 await assert.rejects(db.query('UPDATE staff_notification_event SET metadata=$1 WHERE id=$2',[{...meta,detection_id:'changed'},id]));
 await db.query("DELETE FROM threat_alert_history WHERE id='alert'");assert.equal((await db.query('SELECT threat_alert_id FROM staff_notification_event WHERE id=$1',[id])).rows[0].threat_alert_id,null);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_class WHERE oid IN ('staff_notification'::regclass,'staff_notification_event'::regclass) AND relrowsecurity")).rows[0].n,2);
});

test('storage proposal is not activated and ordinary sensor alerts are never labelled as poaching',()=>{
 for(const file of ['../iot.cjs','../server.js','../officer-notification-delivery.cjs']){
  const source=readFileSync(join(__dirname,file),'utf8');assert.doesNotMatch(source,/possible_poaching_detected|possible-poaching-notifications\.draft\.sql/)
 }
 const source=readFileSync(join(__dirname,'../iot.cjs'),'utf8');assert.match(source,/INSERT INTO threat_alert_history/);assert.match(source,/device\.device_type !== "Sensor"/)
});
