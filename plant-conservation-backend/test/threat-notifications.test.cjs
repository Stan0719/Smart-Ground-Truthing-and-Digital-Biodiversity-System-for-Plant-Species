"use strict";
const test = require('node:test'), assert = require('node:assert/strict');
const { readFileSync } = require('node:fs'), { join } = require('node:path'), { once } = require('node:events');
const { createPlantDatabase } = require('./postgres-fixture.cjs');
const { createPlantApp } = require('../server.js');
const { createOfficerNotificationDelivery } = require('../officer-notification-delivery.cjs');
const { threatNotificationReady } = require('../threat-notifications.cjs');
const prerequisites = ['004-species-requests.sql','006-atomic-plant-submissions.sql','008-record-change-submissions.sql','009-record-version-history.sql','013-staff-notification-foundation.sql','016-species-request-content-revision.sql','017-species-review-cycle.sql','021-observation-edit-requests.sql','022-cancel-edit-requests.sql','024-record-change-review-events.sql','025-original-plant-withdrawal.sql','026-original-species-withdrawal.sql','027-original-observation-withdrawal.sql','028-immutable-record-version-revisions.sql','029-observation-submission-versions.sql','030-observation-edit-officer-notifications.sql'];
const migration = file => readFileSync(join(__dirname, '../migrations', file), 'utf8');
const nextMigration = '032-canonical-threat-officer-notifications.sql';
async function setup(t) {
  const db = await createPlantDatabase(); t.after(() => db.end());
  for (const file of prerequisites) await db.query(migration(file));
  await db.query(`INSERT INTO iot_device(id,name,device_type,key_hash,thresholds) VALUES
    ('sensor','Sensor fixture','Sensor','hash','{}'),('camera','Camera fixture','Camera','hash','{}');
    INSERT INTO sensor_reading(id,device_id,"values") VALUES('reading','sensor','{"temperature":40,"movement":1}')`);
  return db;
}
async function insert(db,id,metric='temperature',device='sensor',camera=null,reading='reading',value=40) {
  await db.query(`INSERT INTO plant_app.threat_alert_history(id,device_id,reading_id,metric,value,camera_id)
    VALUES($1,$2,$3,$4,$5,$6)`,[id,device,reading,metric,value,camera]);
}
test('032 fresh prerequisite chain: no backfill, all sensor metrics and canonical Camera producers share atomic outbox', async t => {
  const db = await setup(t);
  await insert(db,'historical'); assert.equal(await threatNotificationReady(db),false);
  await db.query(migration(nextMigration)); assert.equal(await threatNotificationReady(db),true);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM staff_notification_event')).rows[0].n,0);
  const metrics=['temperature','humidity','soilMoisture','movement','rainfall','sound'];
  for (const [i,metric] of metrics.entries()) await insert(db,'sensor-'+i,metric,'sensor',null,'reading',i);
  for (const metric of ['human_detected','animal_detected','suspicious_movement','possible_plant_contact'])
    await insert(db,'camera-'+metric,metric,'camera','camera',null,1);
  await insert(db,'linked-camera','human_detected','sensor','camera');
  await insert(db,'unknown','invented'); await insert(db,'unverified-camera','human_detected','sensor');
  const events=(await db.query("SELECT * FROM staff_notification_event WHERE resource_kind='threat_alert' ORDER BY threat_alert_id")).rows;
  assert.equal(events.length,11); assert.equal(new Set(events.map(e=>e.source_key)).size,11);
  assert.equal(events.filter(e=>e.metadata.source==='Sensor').length,6);
  assert.equal(events.find(e=>e.threat_alert_id==='sensor-0').metadata.value,0);
  assert.equal(events.filter(e=>e.metadata.reading_id==='reading').length,7);
  assert.equal(events.find(e=>e.threat_alert_id==='camera-human_detected').metadata.reading_id,null);
  await assert.rejects(insert(db,'sensor-0')); assert.equal((await db.query('SELECT count(*)::int AS n FROM staff_notification_event')).rows[0].n,11);
  await assert.rejects(db.query("UPDATE staff_notification_event SET threat_alert_id='historical' WHERE threat_alert_id='sensor-0'"));
  await assert.rejects(db.query("UPDATE staff_notification_event SET metadata='{}' WHERE threat_alert_id='sensor-0'"));
  await assert.rejects(db.query("DELETE FROM threat_alert_history WHERE id='sensor-0'"));
  assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='plant_app.staff_notification_event'::regclass")).rows[0].relrowsecurity,true);
  await t.test('outbox failure rolls back canonical insertion; transaction retry is explicit and safe',async()=>{
    await db.query(`CREATE FUNCTION plant_app.fail_threat_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.resource_kind='threat_alert' THEN RAISE EXCEPTION 'isolated event failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER isolated_failure BEFORE INSERT ON staff_notification_event FOR EACH ROW EXECUTE FUNCTION plant_app.fail_threat_event()`);
    await assert.rejects(insert(db,'failed-alert'));
    assert.equal((await db.query("SELECT count(*)::int AS n FROM threat_alert_history WHERE id='failed-alert'")).rows[0].n,0);
    const client=await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO sensor_reading(id,device_id,"values") VALUES('rolled-reading','sensor','{"temperature":45}')`);
      await assert.rejects(insert(client,'rolled-alert','temperature','sensor',null,'rolled-reading',45));
      await client.query('ROLLBACK');
    } finally { client.release(); }
    assert.equal((await db.query("SELECT count(*)::int AS n FROM sensor_reading WHERE id='rolled-reading'")).rows[0].n,0);
    await db.query('DROP TRIGGER isolated_failure ON staff_notification_event');
    await insert(db,'failed-alert');
    assert.equal((await db.query("SELECT count(*)::int AS n FROM staff_notification_event WHERE threat_alert_id='failed-alert'")).rows[0].n,1);
  });
});
test('032 upgrades existing notifications; worker retry, per-Officer unread and exact older-than-500 detail',async t=>{
  const db=await setup(t);
  await db.query(`INSERT INTO staff_notification_event(id,source_key,event_type,audience_role,resource_kind)
    VALUES('11111111-1111-4111-8111-111111111111','existing','security_event','Administrator','system')`);
  await db.query(migration(nextMigration));
  assert.equal((await db.query("SELECT threat_alert_id FROM staff_notification_event WHERE source_key='existing'")).rows[0].threat_alert_id,null);
  await insert(db,'old-alert');
  await db.query("UPDATE threat_alert_history SET created_at='2000-01-01' WHERE id='old-alert'");
  await db.query(`INSERT INTO threat_alert_history(id,device_id,reading_id,metric,value)
    SELECT 'new-'||g,'sensor','reading','temperature',40 FROM generate_series(1,501) g`);
  const users={one:{id:'one',role:'Conservation Officer',status:'Active',mustChangePassword:false},two:{id:'two',role:'Conservation Officer',status:'Active',mustChangePassword:false},bot:{id:'bot',role:'Botanist',status:'Active',mustChangePassword:false}};
  const tokens={one:'1'.repeat(64),two:'2'.repeat(64),bot:'3'.repeat(64)}; let directoryDown=true;
  const auth={session:async token=>users[Object.keys(tokens).find(k=>tokens[k]===token)]||null,event:async()=>{},db:{prepare:()=>({all:async()=>{if(directoryDown)throw Error('isolated directory down');return Object.values(users).filter(u=>u.role==='Conservation Officer').map(u=>({...u,must_change_password:0}))}})}};
  const delivery=createOfficerNotificationDelivery({pool:db,auth});
  await assert.rejects(delivery.deliverBatch()); directoryDown=false;
  await delivery.deliverBatch();
  const delivered=(await db.query("SELECT id FROM staff_notification_event WHERE resource_kind='threat_alert' AND delivery_state='delivered'")).rows;
  assert.equal(delivered.length,20); await delivery.deliverBatch();
  const duplicates=await db.query('SELECT event_id,recipient_subject,count(*) FROM staff_notification GROUP BY event_id,recipient_subject HAVING count(*)>1'); assert.equal(duplicates.rows.length,0);
  const server=createPlantApp({pool:db,auth}).listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)}));
  async function call(path,who='one',method='GET',body) {
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{Authorization:'Bearer '+tokens[who],'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};
  }
  const list=await call('/alerts');assert.equal(list.body.alerts.length,500);assert.ok(!list.body.alerts.some(a=>a.id==='old-alert'));
  const exact=await call('/alerts/old-alert');assert.equal(exact.status,200);assert.equal(exact.body.alert.id,'old-alert');assert.deepEqual(exact.body.responses,[]);
  assert.equal((await call('/alerts/old-alert','bot')).status,403);assert.equal((await call('/alerts/missing')).status,404);assert.equal((await call('/alerts/bad%20id')).status,400);
  const inbox=await call('/staff-notifications');assert.equal(inbox.status,200);assert.ok(inbox.body.notifications.length);
  const notice=inbox.body.notifications[0];assert.equal(notice.resource.kind,'threat_alert');assert.equal(notice.event_type,'threat_alert_created');assert.equal(notice.threat_context.source,'Sensor');assert.equal(notice.threat_context.value,40);
  const count=(await call('/staff-notifications/unread-count','two')).body.unread_count;
  assert.equal((await call('/staff-notifications/'+notice.id+'/read','two','POST',{})).status,404);
  assert.equal((await call('/staff-notifications/'+notice.id+'/read','one','POST',{})).status,200);
  assert.equal((await call('/staff-notifications/unread-count','two')).body.unread_count,count);
  assert.equal((await db.query('SELECT relrowsecurity FROM pg_class WHERE oid=\'plant_app.staff_notification\'::regclass')).rows[0].relrowsecurity,true);
  assert.equal((await db.query("SELECT prosecdef FROM pg_proc WHERE oid='plant_app.enqueue_canonical_threat_notice()'::regprocedure")).rows[0].prosecdef,false);
});

test('missing 032 preserves existing inbox and canonical ingestion without pretending threat delivery is active',async t=>{
  const db=await setup(t);assert.equal(await threatNotificationReady(db),false);
  await insert(db,'pre-activation');
  assert.equal((await db.query("SELECT count(*)::int AS n FROM staff_notification_event")).rows[0].n,0);
  const auth={session:async()=>({id:'one',role:'Conservation Officer',status:'Active',mustChangePassword:false}),event:async()=>{}};
  const server=createPlantApp({pool:db,auth}).listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)}));
  for(const path of ['/api/staff-notifications','/api/staff-notifications/unread-count','/api/alerts/pre-activation']){
    const r=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{headers:{Authorization:'Bearer '+'1'.repeat(64)}});assert.equal(r.status,200);const body=await r.json();if(path.includes('staff-notifications'))assert.equal(body.unread_count,0);else assert.equal(body.alert.id,'pre-activation');
  }
});
