"use strict";
const {randomUUID}=require('node:crypto');
async function notificationReady(c) {
 return Boolean((await c.query(`SELECT current_schema()='plant_app' AND to_regclass('plant_app.staff_notification_event') IS NOT NULL
 AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='plant_app' AND table_name='staff_notification_event' AND column_name='observation_edit_revision')
 AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='plant_app' AND table_name='observation_edit_event' AND column_name='notification_revision') AS ready`)).rows[0]?.ready);
}
async function enqueueObservationEdit(c,requestId,eventId) {
 // Backward compatibility: business workflows remain available before the additive notification migration.
 if(!await notificationReady(c)) return false;
 const reference=(await c.query('SELECT observation_id FROM observation_edit_request WHERE id=$1',[requestId])).rows[0];
 if(!reference)return false;
 await c.query('SELECT id FROM plant_observation WHERE id=$1 FOR UPDATE',[reference.observation_id]);
 const row=(await c.query('SELECT * FROM observation_edit_request WHERE id=$1 FOR UPDATE',[requestId])).rows[0];
 const evidence=(await c.query('SELECT * FROM observation_edit_event WHERE id=$1 AND request_id=$2 FOR UPDATE',[eventId,requestId])).rows[0];
 if(!row || row.status!=='Pending Review' || !evidence || evidence.observation_id!==row.observation_id || evidence.actor_subject!==row.owner_subject ||
  !((evidence.event_type==='submitted'&&row.revision===1)||(evidence.event_type==='resubmitted'&&row.revision>1)) ||
  (evidence.notification_revision!==null&&evidence.notification_revision!==row.revision)) return false;
 if(evidence.notification_revision===null) await c.query('UPDATE observation_edit_event SET notification_revision=$1 WHERE id=$2',[row.revision,eventId]);
 const type=evidence.event_type==='submitted'?'observation_edit_submitted':'observation_edit_resubmitted';
 const inserted=await c.query(`INSERT INTO plant_app.staff_notification_event(id,source_key,event_type,audience_role,resource_kind,observation_edit_request_id,observation_edit_revision)
 VALUES($1,$2,$3,'Conservation Officer','observation_edit',$4,$5) ON CONFLICT(source_key) DO NOTHING RETURNING id`,
 [randomUUID(),`officer:observation_edit:${row.id}:${row.revision}`,type,row.id,row.revision]);
 return inserted.rowCount===1;
}
// Explicit policy, opt-in only; never infer revision evidence from legacy event order or timestamps.
function createObservationEditNotificationReconciliation({pool,config={}}) {
 const enabled=config.enabled===true, lower=config.lowerBound, limit=config.batchSize??20;
 if(!Number.isInteger(limit)||limit<1||limit>50)throw Error('Invalid reconciliation batch size');
 const policy=()=>{if(typeof lower!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(lower)||!Number.isFinite(Date.parse(lower))||new Date(lower).toISOString().slice(0,19)!==lower.slice(0,19))throw Error('Explicit UTC reconciliation lowerBound required');};
 if(enabled)policy();
 async function work(write){
  policy();const c=await pool.connect();
  try{await c.query(write?'BEGIN':'BEGIN READ ONLY');
   await c.query("SET LOCAL statement_timeout='5000ms'");await c.query("SET LOCAL lock_timeout='1000ms'");
   if(!await notificationReady(c)){await c.query('COMMIT');return {available:false,candidates:[],enqueued:0};}
   if(write && !(await c.query('SELECT pg_try_advisory_xact_lock(193701,4) AS locked')).rows[0]?.locked){await c.query('COMMIT');return {busy:true};}
   const candidates=(await c.query(`SELECT e.id AS event_id,r.id AS request_id,r.revision FROM observation_edit_event e
    JOIN observation_edit_request r ON r.id=e.request_id AND r.observation_id=e.observation_id AND r.owner_subject=e.actor_subject
    WHERE r.status='Pending Review' AND e.notification_revision=r.revision AND e.created_at >= $1::timestamptz
    AND NOT EXISTS(SELECT 1 FROM staff_notification_event n WHERE n.observation_edit_request_id=r.id AND n.observation_edit_revision=r.revision)
    ORDER BY e.created_at,e.id LIMIT $2`,[lower,limit])).rows;
   let enqueued=0;if(write)for(const row of candidates)if(await enqueueObservationEdit(c,row.request_id,row.event_id))enqueued++;
   await c.query('COMMIT');return {available:true,candidates,enqueued};
  }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
 }
 return {enabled,preview:()=>work(false),runOnce:()=>enabled?work(true):Promise.resolve({disabled:true})};
}
module.exports={notificationReady,enqueueObservationEdit,createObservationEditNotificationReconciliation};
