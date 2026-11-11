"use strict";
const {classifyObservations}=require('./observation-origin.cjs');
const {officerEventIdentity}=require('./officer-notification-delivery.cjs');

// Foundation only: nothing imports this module from server startup. No env loading,
// pool construction, browser endpoint, or recipient writes belong here.
function createOfficerNotificationReconciliation({pool,officerNotifications,config={},onFailure=()=>{}}){
  const enabled=config.enabled===true;
  const lower=config.lowerBound;
  const validLower=typeof lower==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(lower) && Number.isFinite(Date.parse(lower)) && new Date(lower).toISOString().slice(0,19)===lower.slice(0,19);
  const batchSize=config.batchSize??20,intervalMs=config.intervalMs??60000;
  if(!Number.isInteger(batchSize)||batchSize<1||batchSize>50||!Number.isInteger(intervalMs)||intervalMs<60000)
    throw Error('Invalid reconciliation limits.');
  function requirePolicy(){if(!validLower)throw Error('Explicit UTC reconciliation lowerBound required.');}
  if(enabled){requirePolicy();if(typeof officerNotifications?.enqueue!=='function')throw Error('Officer enqueue dependency required.');}
  let cursor=null,upper=null,running=null,timer=null,stopped=false,failures=0;
  async function transaction(readOnly,work){
    const c=await pool.connect();
    try{
      await c.query(readOnly?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN');
      await c.query("SET LOCAL statement_timeout='5000ms'");
      await c.query("SET LOCAL lock_timeout='1000ms'");
      if(!(await c.query("SELECT current_schema()='plant_app' AS ready")).rows[0]?.ready)
        throw Error('Reconciliation requires the plant_app scoped pool.');
      const result=await work(c);await c.query('COMMIT');return result;
    }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
  }
  async function scan(c,after,until){
    // updated_at captures submission of older drafts. Full bounded sweeps repeat,
    // so a late commit cannot be permanently skipped by an in-memory watermark.
    return (await c.query(`SELECT o.*,to_char(o.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS scan_at
      FROM plant_app.plant_observation o WHERE o.status='Pending Review'
      AND o.updated_at >= $1::timestamptz AND o.updated_at <= $2::timestamptz
      AND ($3::timestamptz IS NULL OR (o.updated_at,o.id)>($3::timestamptz,$4::text))
      ORDER BY o.updated_at,o.id LIMIT $5`,[lower,until,after?.at??null,after?.id??null,batchSize])).rows;
  }
  async function inspect(c,raw){
    const row=(await classifyObservations(c,[raw]))[0];
    const identity=officerEventIdentity(row);
    let reason=row.status!=='Pending Review'?'NOT_PENDING':!identity?'UNKNOWN_OR_INVALID_ORIGIN':null;
    let speciesReviewRequired=false;
    if(!reason && row.origin_type==='initial_registration'){
      // The classifier has already validated uniqueness and receipt relationships.
      const receipts=(await c.query(`SELECT result,created_at >= $2::timestamptz AS in_policy
        FROM plant_app.plant_submission_receipt WHERE result->>'id'=$1`,[row.id,lower])).rows;
      if(receipts.length!==1)reason='INVALID_RECEIPT';
      else if(!receipts[0].in_policy)reason='BEFORE_POLICY_BOUNDARY';
      else speciesReviewRequired=receipts[0].result.species_request_id!==null;
    }
    if(!reason && row.origin_type==='subsequent_observation'){
      // Creation and pending submission use the same action name. Require distinct
      // audit records matching both workflow timestamps and the observation owner.
      const verified=(await c.query(`SELECT EXISTS(SELECT 1 FROM plant_app.business_audit a
        JOIN plant_app.business_audit b ON b.target=a.target AND b.actor_subject=a.actor_subject AND b.id<>a.id
        WHERE a.target=$1 AND a.actor_subject=$2 AND a.action='observation_submitted'
        AND b.action='observation_submitted' AND a.created_at=$3::timestamptz
        AND b.created_at=$4::timestamptz AND b.created_at >= $5::timestamptz) AS verified`,
      [row.id,row.owner_subject,row.created_at,row.updated_at,lower])).rows[0]?.verified;
      if(!verified)reason='UNVERIFIED_STANDALONE_SUBMISSION';
    }
    const exists=identity?Boolean((await c.query('SELECT 1 FROM plant_app.staff_notification_event WHERE source_key=$1',[identity.key])).rows.length):false;
    return {observation_id:row.id,effective_origin:row.origin_type,revision:row.revision,
      source_key:identity?.key??null,event_exists:exists,excluded_by_policy:Boolean(reason),
      reason:reason??(exists?'EVENT_ALREADY_EXISTS':'ELIGIBLE_MISSING_EVENT'),speciesReviewRequired};
  }
  function publicResult({speciesReviewRequired,...row}){return row;}
  async function preview({after=null}={}){
    requirePolicy();
    if(after!==null && (!after||typeof after.id!=='string'||after.id.length>200||typeof after.at!=='string'||!Number.isFinite(Date.parse(after.at))))throw Error('Invalid preview cursor.');
    return transaction(true,async c=>{
      const until=(await c.query('SELECT clock_timestamp() AS at')).rows[0].at;
      const rows=await scan(c,after,until),candidates=[];
      for(const row of rows)candidates.push(publicResult(await inspect(c,row)));
      const last=rows.at(-1);
      return {enabled,candidates,next_cursor:rows.length===batchSize?{at:last.scan_at,id:last.id}:null};
    });
  }
  async function pass(){
    const result=await transaction(false,async c=>{
      // One short batch across API instances, not a session lock or a new pool.
      if(!(await c.query('SELECT pg_try_advisory_xact_lock(193701,3) AS locked')).rows[0]?.locked)return {busy:true};
      const until=upper??(await c.query('SELECT clock_timestamp() AS at')).rows[0].at;
      const rows=await scan(c,cursor,until);let enqueued=0;
      for(const snapshot of rows){
        const row=(await c.query(`SELECT *,to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS scan_at
          FROM plant_app.plant_observation WHERE id=$1 FOR UPDATE SKIP LOCKED`,[snapshot.id])).rows[0];
        if(!row||row.revision!==snapshot.revision||row.status!=='Pending Review'||row.scan_at!==snapshot.scan_at)continue;
        const candidate=await inspect(c,row);
        if(!candidate.excluded_by_policy&&!candidate.event_exists && await officerNotifications.enqueue(c,row.id,candidate.speciesReviewRequired))enqueued++;
      }
      const last=rows.at(-1);
      return {busy:false,enqueued,scanned:rows.length,upper:until,next:rows.length===batchSize?{at:last.scan_at,id:last.id}:null};
    });
    if(!result.busy){cursor=result.next;upper=cursor?result.upper:null;}
    return result;
  }
  function runOnce(){
    if(!enabled||stopped)return Promise.resolve({disabled:true});
    if(running)return running;
    running=pass().finally(()=>{running=null;});return running;
  }
  function start(){
    if(!enabled||timer||stopped)return;
    async function tick(){
      try{await runOnce();failures=0;}catch{failures=Math.min(failures+1,5);try{onFailure('OFFICER_RECONCILIATION_UNAVAILABLE');}catch{}}
      if(!stopped){timer=setTimeout(tick,Math.min(intervalMs*2**failures,1800000));timer.unref();}
    }
    timer=setTimeout(tick,intervalMs);timer.unref();
  }
  async function stop(){stopped=true;if(timer)clearTimeout(timer);timer=null;await running?.catch(()=>{});}
  return {enabled,preview,runOnce,start,stop};
}
module.exports={createOfficerNotificationReconciliation};
