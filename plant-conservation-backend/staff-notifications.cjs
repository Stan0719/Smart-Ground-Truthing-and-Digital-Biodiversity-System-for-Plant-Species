"use strict";
const { randomBytes, createHmac, timingSafeEqual } = require("node:crypto");
const { permitted, visibilityFor } = require("../shared/rbac.cjs");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const sequence = value => typeof value === "string" && /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value)<=9223372036854775807n;
function fail(status) { throw Object.assign(Error("Staff notification request rejected."), { status }); }
function keys(value, allowed) {
  if (!value || typeof value!=="object" || Array.isArray(value) || Object.keys(value).some(key=>!allowed.includes(key))) fail(400);
}
// One predicate is used for lists, counts and BOTH acknowledgement operations.
// Staff role permissions are checked anew on every request; metadata is never projected.
const visible = `n.recipient_subject=$1 AND n.intended_role=$2 AND e.audience_role=$2 AND (
  ($3::boolean AND e.resource_kind='system' AND e.event_type IN ('system_failure','account_administration','security_event'))
  OR ($4::boolean AND e.resource_kind='observation' AND EXISTS (
    SELECT 1 FROM plant_app.plant_observation o
    JOIN plant_app.plant_record p ON p.plant_id=o.plant_id
    JOIN plant_app.species s ON s.species_id=p.species_id
    LEFT JOIN plant_app.rbac_species_visibility v ON v.species_id=s.species_id
    WHERE o.id=e.observation_id AND COALESCE(v.visibility,'protected')=ANY($6::text[])))
  OR ($5::boolean AND e.resource_kind='species_request' AND EXISTS (
    SELECT 1 FROM plant_app.species_request_submission r WHERE r.request_id=e.species_request_id))
  OR ($5::boolean AND e.resource_kind='record_change' AND EXISTS (
    SELECT 1 FROM plant_app.record_change_submission r
    LEFT JOIN plant_app.plant_record p ON p.plant_id=r.plant_id
    JOIN plant_app.species s ON s.species_id=COALESCE(p.species_id,r.species_id)
    LEFT JOIN plant_app.rbac_species_visibility v ON v.species_id=s.species_id
    WHERE r.id=e.record_change_id AND COALESCE(v.visibility,'protected')=ANY($6::text[])))
)`;
const joined = "plant_app.staff_notification n JOIN plant_app.staff_notification_event e ON e.id=n.event_id";
function mountStaffNotifications(app, { pool }) {
  // Ephemeral signing key: no new environment secret. Restart/multi-instance tokens
  // fail closed with 400; reload list to acquire tokens from this API instance.
  const signingKey = randomBytes(32);
  function encode(data, user, kind) {
    const payload=Buffer.from(JSON.stringify({v:1,kind,subject:`staff:${user.id}`,role:user.role,expires:Date.now()+900000,...data})).toString("base64url");
    return payload+"."+createHmac("sha256",signingKey).update(payload).digest("base64url");
  }
  function decode(token,user,kind) {
    if (typeof token!=="string" || token.length>2000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) fail(400);
    const [payload,signature]=token.split(".");
    const expected=createHmac("sha256",signingKey).update(payload).digest();
    const supplied=Buffer.from(signature,"base64url");
    if(supplied.length!==expected.length || !timingSafeEqual(supplied,expected)) fail(400);
    let data; try { data=JSON.parse(Buffer.from(payload,"base64url").toString("utf8")); } catch { fail(400); }
    if(data?.v!==1 || data.kind!==kind || data.subject!==`staff:${user.id}` || data.role!==user.role ||
      !Number.isSafeInteger(data.expires) || data.expires<=Date.now() || !sequence(data.cap) ||
      (kind==='cursor' && (!sequence(data.before) || BigInt(data.before)>BigInt(data.cap)))) fail(400);
    return data;
  }
  const route = handler => async(req,res) => {
    try {
      const user=req.user;
      if(!user) fail(401);
      if(!['Administrator','Conservation Officer'].includes(user.role) || !/^[A-Za-z0-9_-]{1,200}$/.test(user.id) ||
        !(permitted(user,'system.read') || permitted(user,'plants.scientific.read'))) fail(403);
      const args=[`staff:${user.id}`,user.role,permitted(user,'system.read'),permitted(user,'plants.scientific.read'),permitted(user,'species.manage'),visibilityFor(user)];
      const ready=(await pool.query("SELECT current_schema()='plant_app' AND to_regclass('plant_app.staff_notification') IS NOT NULL AND to_regclass('plant_app.staff_notification_event') IS NOT NULL AS ready")).rows[0]?.ready;
      if(!ready) fail(503);
      await handler(req,res,user,args);
    } catch(error) {
      const status=[400,401,403,404].includes(error.status)?error.status:503;
      res.status(status).json({error:status===503?'Staff notifications unavailable.':status===401?'Please sign in.':status===403?'Access denied.':status===404?'Notification unavailable.':'Invalid notification request. Reload the inbox.'});
    }
  };
  async function count(db,args) {
    const value=Number((await db.query(`SELECT count(*)::text AS count FROM ${joined} WHERE ${visible} AND n.read_at IS NULL`,args)).rows[0].count);
    if(!Number.isSafeInteger(value)) fail(503);
    return value;
  }
  app.get('/api/staff-notifications/unread-count',route(async(req,res,user,args)=>{
    keys(req.query,[]);
    res.json({unread_count:await count(pool,args)});
  }));
  app.get('/api/staff-notifications',route(async(req,res,user,args)=>{
    keys(req.query,['limit','cursor']);
    const limit=req.query.limit===undefined?20:Number(req.query.limit);
    if((req.query.limit!==undefined && (typeof req.query.limit!=='string' || !/^[1-9][0-9]*$/.test(req.query.limit))) || !Number.isInteger(limit)||limit<1||limit>100) fail(400);
    const cursor=req.query.cursor===undefined?null:decode(req.query.cursor,user,'cursor');
    const db=await pool.connect();
    try {
      await db.query('BEGIN');
      // Serialized with inbox inserts (migration trigger), not workflow decisions.
      if(!cursor) await db.query('SELECT pg_advisory_xact_lock(193701,2)');
      const cap=cursor?.cap ?? (await db.query(`SELECT COALESCE(max(n.delivery_seq),0)::text AS cap FROM ${joined} WHERE ${visible}`,args)).rows[0].cap;
      const rows=(await db.query(`SELECT n.id,n.created_at,n.read_at,n.delivery_seq::text AS seq,e.event_type,e.priority,e.occurred_at,
        CASE WHEN e.audience_role='Conservation Officer' AND e.event_type='registration_submitted'
          THEN e.metadata->'species_review_required' ELSE NULL END AS species_review_required,
        e.resource_kind,COALESCE(e.observation_id,e.species_request_id::text,e.record_change_id) AS resource_id
        FROM ${joined} WHERE ${visible} AND n.delivery_seq<=$7::bigint AND ($8::bigint IS NULL OR n.delivery_seq<$8::bigint)
        ORDER BY n.delivery_seq DESC LIMIT $9`,[...args,cap,cursor?.before??null,limit+1])).rows;
      const unread=await count(db,args), hasMore=rows.length>limit, page=rows.slice(0,limit);
      await db.query('COMMIT');
      res.json({notifications:page.map(({seq,resource_kind,resource_id,species_review_required,...row})=>({...row,resource:{kind:resource_kind,id:resource_id},
        ...(user.role==='Conservation Officer'&&row.event_type==='registration_submitted'?{species_review_required:species_review_required===true}:{})})),
        unread_count:unread,page:{limit,has_more:hasMore,next_cursor:hasMore?encode({cap,before:page.at(-1).seq},user,'cursor'):null},
        read_through:encode({cap},user,'boundary')});
    } catch(error) { await db.query('ROLLBACK').catch(()=>{}); throw error; }
    finally { db.release(); }
  }));
  app.post('/api/staff-notifications/read-all',route(async(req,res,user,args)=>{
    keys(req.query,[]); keys(req.body,['read_through']);
    const boundary=decode(req.body.read_through,user,'boundary');
    const result=await pool.query(`UPDATE plant_app.staff_notification n SET read_at=clock_timestamp()
      FROM plant_app.staff_notification_event e WHERE e.id=n.event_id AND ${visible} AND n.read_at IS NULL AND n.delivery_seq<=$7::bigint`,[...args,boundary.cap]);
    res.json({updated:result.rowCount});
  }));
  app.post('/api/staff-notifications/:id/read',route(async(req,res,user,args)=>{
    keys(req.query,[]); keys(req.body??{},[]);
    if(!uuid.test(req.params.id)) fail(400);
    const result=await pool.query(`UPDATE plant_app.staff_notification n SET read_at=COALESCE(n.read_at,clock_timestamp())
      FROM plant_app.staff_notification_event e WHERE e.id=n.event_id AND ${visible} AND n.id=$7::uuid RETURNING n.id,n.read_at`,[...args,req.params.id]);
    if(!result.rows.length) fail(404);
    res.json({notification:result.rows[0]});
  }));
}
module.exports={mountStaffNotifications};
