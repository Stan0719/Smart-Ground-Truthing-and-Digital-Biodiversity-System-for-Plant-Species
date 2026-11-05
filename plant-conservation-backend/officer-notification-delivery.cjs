"use strict";
const {randomUUID}=require('node:crypto');
const {permitted,visibilityFor}=require('../shared/rbac.cjs');
const {classifyObservations}=require('./observation-origin.cjs');
function officerEventIdentity(row){
  const type={initial_registration:'registration_submitted',subsequent_observation:'field_observation_submitted'}[row.origin_type];
  if(!type || !Number.isSafeInteger(row.revision) || row.revision<1)return null;
  return {type,key:`officer:${type}:${row.id}`+(row.origin_type==='subsequent_observation'?`:${row.revision}`:'')};
}
async function transaction(pool,work){
  const c=await pool.connect();
  try{await c.query('BEGIN');const result=await work(c);await c.query('COMMIT');return result;}
  catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
}
function createOfficerNotificationDelivery({pool,auth}){
  let timer=null,running=null,stopped=false;
  async function enqueue(c,id,speciesReviewRequired=false){
    const rows=(await c.query('SELECT * FROM plant_observation WHERE id=$1',[id])).rows;
    const row=(await classifyObservations(c,rows))[0];
    if(!row || row.status!=='Pending Review')return false;
    const identity=officerEventIdentity(row);
    if(!identity)return false;
    const {type,key}=identity;
    await c.query(`INSERT INTO plant_app.staff_notification_event(id,source_key,event_type,audience_role,resource_kind,observation_id,metadata)
      VALUES($1,$2,$3,'Conservation Officer','observation',$4,$5::jsonb) ON CONFLICT(source_key) DO NOTHING`,
    [randomUUID(),key,type,id,JSON.stringify({plant_id:String(row.plant_id),species_review_required:type==='registration_submitted'&&speciesReviewRequired===true})]);
    return true;
  }
  async function deliverBatch(){
    if(running)return running;
    running=(async()=>{
      // Auth storage can be a different database. Failure leaves durable events
      // pending, never an invented empty recipient cohort or a delivered event.
      const directory=await auth.db.prepare("SELECT id,role,status,must_change_password FROM users WHERE role=? AND status=? AND must_change_password=0").all('Conservation Officer','Active');
      const officers=directory.map(u=>({...u,mustChangePassword:Boolean(u.must_change_password)}))
        .filter(u=>typeof u.id==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(u.id)&&permitted(u,'observations.review'));
      const events=(await pool.query(`SELECT id FROM plant_app.staff_notification_event WHERE audience_role='Conservation Officer'
        AND event_type IN ('registration_submitted','field_observation_submitted') AND delivery_state IN ('pending','failed')
        AND next_attempt_at<=clock_timestamp() ORDER BY next_attempt_at,id LIMIT 20`)).rows;
      for(const event of events){
        try{await transaction(pool,async c=>{
          const row=(await c.query(`SELECT * FROM plant_app.staff_notification_event WHERE id=$1 AND delivery_state IN ('pending','failed')
            AND next_attempt_at<=clock_timestamp() FOR UPDATE SKIP LOCKED`,[event.id])).rows[0];
          if(!row)return;
          const resource=(await c.query(`SELECT o.owner_subject,COALESCE(v.visibility,'protected') AS visibility
            FROM plant_app.plant_observation o JOIN plant_app.plant_record p ON p.plant_id=o.plant_id
            JOIN plant_app.species s ON s.species_id=p.species_id LEFT JOIN plant_app.rbac_species_visibility v ON v.species_id=s.species_id
            WHERE o.id=$1`,[row.observation_id])).rows[0];
          const recipients=resource?officers.filter(u=>`staff:${u.id}`!==resource.owner_subject&&visibilityFor(u).includes(resource.visibility)):[];
          if(!recipients.length){
            await c.query(`UPDATE plant_app.staff_notification_event SET delivery_state='failed',attempts=attempts+1,
              next_attempt_at=clock_timestamp()+interval '60 seconds',last_error_code=$2 WHERE id=$1`,[row.id,resource?'NO_ELIGIBLE_OFFICERS':'RESOURCE_UNAVAILABLE']);return;
          }
          for(const user of recipients)await c.query(`INSERT INTO plant_app.staff_notification(id,event_id,recipient_subject,intended_role)
            VALUES($1,$2,$3,'Conservation Officer') ON CONFLICT(event_id,recipient_subject,intended_role) DO NOTHING`,[randomUUID(),row.id,`staff:${user.id}`]);
          await c.query(`UPDATE plant_app.staff_notification_event SET delivery_state='delivered',delivered_at=clock_timestamp(),
            attempts=attempts+1,last_error_code=NULL WHERE id=$1`,[row.id]);
        });}catch{
          // A partial fan-out rolls back. Retry state is written separately only
          // after rollback; if storage is down, the original pending event remains.
          await pool.query(`UPDATE plant_app.staff_notification_event SET delivery_state='failed',attempts=attempts+1,
            next_attempt_at=clock_timestamp()+interval '60 seconds',last_error_code='DELIVERY_FAILED'
            WHERE id=$1 AND delivery_state<>'delivered'`,[event.id]).catch(()=>{});
        }
      }
    })().finally(()=>{running=null;});
    return running;
  }
  function start(){
    if(timer||stopped)return;
    const tick=()=>{if(!stopped)void deliverBatch().catch(()=>console.error('Officer notification delivery unavailable.'));};
    timer=setInterval(tick,30000);timer.unref();tick();
  }
  async function stop(){stopped=true;if(timer)clearInterval(timer);timer=null;await running?.catch(()=>{});}
  return {enqueue,deliverBatch,start,stop};
}
module.exports={createOfficerNotificationDelivery,officerEventIdentity};
