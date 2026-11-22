"use strict";
const { randomUUID, createHash } = require('node:crypto');
const { resolvePlantRegistration } = require('./plant-registration.cjs');
const fail = (status, code) => { throw Object.assign(Error(code), { status, code }); };
const id = value => { if (!/^[1-9][0-9]{0,9}$/.test(value) || Number(value)>2147483647) fail(400,'PLANT_EDIT_INVALID'); return value; };
const token = state => createHash('sha256').update(JSON.stringify(state)).digest('hex');
async function baseline(c, plantId, lock = false) {
  const ready = (await c.query(`SELECT to_regclass('record_version_history') IS NOT NULL AND to_regclass('business_audit') IS NOT NULL
    AND to_regclass('record_change_submission') IS NOT NULL AND to_regclass('observation_edit_request') IS NOT NULL
    AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('record_version_history') AND tgname='record_version_snapshot_immutable' AND tgenabled='O') AS ready`)).rows[0]?.ready;
  if (!ready) fail(503,'PLANT_EDIT_HISTORY_REQUIRED');
  // Match the existing Observation-review lock order, then serialize with Plant proposals.
  if (lock) await c.query("SELECT id FROM plant_observation WHERE plant_id=$1 ORDER BY id FOR UPDATE",[plantId]);
  const p=(await c.query(`SELECT * FROM plant_record WHERE plant_id=$1 ${lock?'FOR UPDATE':''}`,[plantId])).rows[0];
  if (!p) fail(404,'PLANT_EDIT_UNAVAILABLE');
  if (p.rbac_status!=='Approved') fail(409,'PLANT_EDIT_APPROVED_ONLY');
  const conflict=(await c.query(`SELECT EXISTS(SELECT 1 FROM record_change_submission WHERE plant_id=$1 AND status IN ('Pending Review','Correction Required'))
    OR EXISTS(SELECT 1 FROM observation_edit_request r JOIN plant_observation o ON o.id=r.observation_id WHERE o.plant_id=$1 AND r.status IN ('Pending Review','Correction Required')) AS active`,[plantId])).rows[0]?.active;
  if (conflict) fail(409,'PLANT_EDIT_ACTIVE_PROPOSAL');
  const registration=await resolvePlantRegistration(c,plantId);
  if (registration.state!=='available' || !registration.version_id) fail(409,'PLANT_EDIT_BASELINE_UNAVAILABLE');
  const version=(await c.query('SELECT snapshot FROM record_version_history WHERE id=$1',[registration.version_id])).rows[0];
  if (!version?.snapshot) fail(409,'PLANT_EDIT_BASELINE_UNAVAILABLE');
  const state={plant_id:String(p.plant_id),scientific_name:p.scientific_name,species_id:String(p.species_id),status:p.rbac_status,
    observation_id:registration.observation_id,observation_revision:registration.observation_revision,version_id:registration.version_id};
  return {p,registration,snapshot:version.snapshot,state,revision:token(state)};
}
async function transaction(pool,work) {const c=await pool.connect();try{await c.query('BEGIN');const result=await work(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
function mountOfficerPlantEdit(app,{pool,allow}) {
  app.get('/api/officer/plants/:id/edit',allow('plants.officer.edit'),async(req,res)=>{
    const b=await baseline(pool,id(req.params.id));res.json({plant:{id:b.state.plant_id,scientific_name:b.p.scientific_name||'',species_id:b.state.species_id},revision:b.revision});
  });
  app.patch('/api/officer/plants/:id',allow('plants.officer.edit'),async(req,res)=>{
    const plantId=id(req.params.id),body=req.body;
    if (!body || Object.keys(body).some(k=>!['scientific_name','revision','reason'].includes(k)) || typeof body.scientific_name!=='string' || !body.scientific_name.trim() || body.scientific_name.trim().length>200 || /[\u0000-\u001f\u007f]/.test(body.scientific_name) || typeof body.reason!=='string' || !body.reason.trim() || body.reason.trim().length>4000 || !/^[a-f0-9]{64}$/.test(body.revision||'')) fail(400,'PLANT_EDIT_INVALID');
    const result=await transaction(pool,async c=>{
      const b=await baseline(c,plantId,true);
      if(b.revision!==body.revision)fail(409,'PLANT_EDIT_CONFLICT');
      if(b.p.scientific_name===body.scientific_name.trim())return {saved:true,changed:false};
      const eventId=randomUUID(),versionId=randomUUID(),actor='staff:'+req.user.id;
      const audit=(await c.query(`INSERT INTO business_audit(id,actor_subject,action,target) VALUES($1,$2,'officer_plant_direct_edit',$3) RETURNING created_at`,[eventId,actor,plantId])).rows[0];
      const snapshot={...b.snapshot,scientific_name:body.scientific_name.trim(),review_provenance:{kind:'officer_direct_edit',audit_id:eventId,base_version_id:b.registration.version_id,reason:body.reason.trim()}};
      await c.query(`INSERT INTO record_version_history(id,record_type,plant_id,version_number,owner_subject,edited_by,status,snapshot,previous_snapshot,created_at)
        SELECT $1,'plant',$2,coalesce(max(version_number),0)+1,$3,$4,'Approved',$5,$6,$7 FROM record_version_history WHERE plant_id=$2`,[versionId,plantId,b.p.registered_subject,actor,snapshot,b.snapshot,audit.created_at]);
      await c.query('UPDATE plant_record SET scientific_name=$1 WHERE plant_id=$2',[body.scientific_name.trim(),plantId]);
      return {saved:true,changed:true,version_id:versionId};
    });res.json(result);
  });
  // Lock all Plant-dependent tables before checking even non-FK evidence.
  // No CASCADE, child deletes, or evidence detachment is permitted.
  async function deletion(c, plantId) {
    await c.query("SET LOCAL lock_timeout='2s'");
    await c.query("SET LOCAL statement_timeout='10s'");
    const unsafe=(await c.query(`SELECT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('plant_record') AND NOT tgisinternal AND tgenabled<>'D' AND (tgtype::integer & 8)=8)
      OR EXISTS(SELECT 1 FROM pg_constraint c WHERE c.contype='f' AND c.confrelid=to_regclass('plant_record')
        AND (c.connamespace<>(SELECT oid FROM pg_namespace WHERE nspname=current_schema()) OR array_length(c.conkey,1)<>1 OR NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.confrelid AND a.attnum=c.confkey[1] AND a.attname='plant_id') OR NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.conrelid AND a.attnum=c.conkey[1] AND a.attname='plant_id')))
      AS unsafe`)).rows[0]?.unsafe;
    if(unsafe)fail(409,'PLANT_DELETE_REFERENCED');
    const tables=(await c.query(`SELECT DISTINCT table_schema,table_name FROM information_schema.columns
      WHERE table_schema=current_schema() AND column_name='plant_id' AND table_name<>'plant_record'
      ORDER BY table_schema,table_name`)).rows;
    const quote=value=>'"'+value.replace(/"/g,'""')+'"';
    for(const table of tables) await c.query(`LOCK TABLE ${quote(table.table_schema)}.${quote(table.table_name)} IN SHARE ROW EXCLUSIVE MODE`);
    const p=(await c.query('SELECT * FROM plant_record WHERE plant_id=$1 FOR UPDATE',[plantId])).rows[0];
    if(!p)fail(404,'PLANT_DELETE_UNAVAILABLE');
    // A token on the Plant is QR evidence even if the assignment table is absent.
    if(p.qr_token)fail(409,'PLANT_DELETE_REFERENCED');
    await c.query('LOCK TABLE business_audit IN SHARE ROW EXCLUSIVE MODE');
    if((await c.query("SELECT EXISTS(SELECT 1 FROM business_audit WHERE target=$1 AND (action LIKE 'plant_%' OR action LIKE 'officer_plant_%')) AS linked",[plantId])).rows[0]?.linked)fail(409,'PLANT_DELETE_REFERENCED');
    for(const table of tables) {
      const linked=(await c.query(`SELECT EXISTS(SELECT 1 FROM ${quote(table.table_schema)}.${quote(table.table_name)} WHERE plant_id=$1) AS linked`,[plantId])).rows[0];
      if(linked?.linked)fail(409,'PLANT_DELETE_REFERENCED');
    }
    return {revision:token(p)};
  }
  app.get('/api/officer/plants/:id/deletion',allow('plants.officer.delete'),async(req,res)=>{
    res.json(await transaction(pool,c=>deletion(c,id(req.params.id))));
  });
  app.delete('/api/officer/plants/:id',allow('plants.officer.delete'),async(req,res)=>{
    const plantId=id(req.params.id);
    if(!req.body || Object.keys(req.body).some(key=>key!=='revision') || !/^[a-f0-9]{64}$/.test(req.body.revision||''))fail(400,'PLANT_EDIT_INVALID');
    await transaction(pool,async c=>{
      const state=await deletion(c,plantId);
      if(state.revision!==req.body.revision)fail(409,'PLANT_DELETE_CONFLICT');
      try {
        const result=await c.query('DELETE FROM plant_record WHERE plant_id=$1 RETURNING plant_id',[plantId]);
        if(result.rows.length!==1)fail(409,'PLANT_DELETE_CONFLICT');
      }catch(error){if(error.code==='23503')fail(409,'PLANT_DELETE_REFERENCED');throw error;}
      await c.query("INSERT INTO business_audit(id,actor_subject,action,target) VALUES($1,$2,'officer_plant_delete',$3)",[randomUUID(),'staff:'+req.user.id,plantId]);
    });
    res.json({deleted:true});
  });
  app.get('/api/officer/plants/:id/edits',allow('plants.detail.read'),async(req,res)=>{
    if(req.user.role!=='Conservation Officer')fail(403,'PLANT_EDIT_FORBIDDEN');
    const rows=(await pool.query(`SELECT v.id,v.version_number,v.created_at,v.edited_by AS actor,
      v.previous_snapshot->>'scientific_name' AS before,v.snapshot->>'scientific_name' AS after,
      v.snapshot->'review_provenance'->>'reason' AS reason FROM record_version_history v
      JOIN business_audit a ON a.id=v.snapshot->'review_provenance'->>'audit_id' AND a.actor_subject=v.edited_by AND a.target=v.plant_id::text
        AND a.action='officer_plant_direct_edit' AND a.created_at=v.created_at
      WHERE v.plant_id=$1 AND v.snapshot->'review_provenance'->>'kind'='officer_direct_edit'
      ORDER BY v.version_number DESC LIMIT 25`,[id(req.params.id)])).rows;
    res.json({edits:rows});
  });
}
module.exports={mountOfficerPlantEdit,baseline};
