'use strict';
const {permitted,visibilityFor}=require('../shared/rbac.cjs');
const gallery=require('./species-gallery.cjs');
const {inspectPhotoSchema}=require('./species-photo-readiness.cjs');
const {requireSpeciesPhotoWrites}=require('./species-photo-activation.cjs');
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const roles=['whole_plant','leaf_close_up','stem_bark','flower_fruit','additional'];
async function rolesAvailable(c) {
  return Boolean((await c.query("SELECT to_regclass(current_schema() || '.plant_asset_photo_role') IS NOT NULL AS available")).rows[0].available);
}
function validateRoles(photos) {
  const seen=new Set();
  return photos.map(photo=>{
    const role=photo?.role;
    if(role===undefined)return null;
    if(!roles.includes(role)||(role!=='additional'&&seen.has(role)))fail(400,'Invalid or duplicate semantic photo role.');
    seen.add(role);return role;
  });
}
async function recordRole(c,{assetId,plantId,observationId,role,owner}) {
  if(!role)return;
  if(!await rolesAvailable(c))fail(503,'Semantic photo roles require migration 015.');
  await c.query('INSERT INTO plant_asset_photo_role(asset_id,plant_id,observation_id,role,recorded_by) VALUES($1,$2,$3,$4,$5)',[assetId,plantId,observationId,role,owner]);
}
async function proposedPhoto(c,requestId,user) {
  if(!await rolesAvailable(c))return null;
  const officer=permitted(user,'species.manage'),owner=user?`staff:${user.id}`:'';
  if(!officer&&!permitted(user,'plants.create'))return null;
  // Request/receipt, role provenance, current association and original ownership
  // must all agree. Pending evidence is available only in this authorized scope.
  return (await c.query(`SELECT a.content FROM species_request_proposed_image pi
    JOIN species_request_submission sr ON sr.request_id=pi.request_id
    JOIN plant_asset_photo_role pr ON pr.asset_id=pi.asset_id AND pr.role='whole_plant'
    JOIN plant_asset a ON a.id=pr.asset_id AND a.plant_id=pr.plant_id AND a.observation_id=pr.observation_id
    JOIN plant_record p ON p.plant_id=a.plant_id
    JOIN plant_observation o ON o.id=a.observation_id AND o.plant_id=p.plant_id
    JOIN plant_submission_receipt receipt ON receipt.owner_subject=sr.owner_subject AND receipt.client_key=sr.client_key
    WHERE pi.request_id=$1 AND ($2 OR sr.owner_subject=$3)
      AND p.species_id=sr.proposed_species_id AND a.owner_subject=sr.owner_subject AND o.owner_subject=sr.owner_subject
      AND receipt.result->>'id'=o.id AND receipt.result->>'species_request_id'=sr.request_id::text
      AND a.content_type IN ('image/jpeg','image/png')
      AND sr.request_status IN ('Pending Review','Correction Required','Rejected')`,[requestId,officer,owner])).rows[0]?.content ?? null;
}
async function listLibrary(c,speciesId,user,query={}) {
  if(!permitted(user,'species.manage'))fail(403,'Species management access required.');
  if(!/^[1-9]\d*$/.test(String(speciesId))||Number(speciesId)>2147483647)fail(400,'Invalid species identifier.');
  if(Object.keys(query).some(k=>!['source','limit','cursor'].includes(k)))fail(400,'Invalid library query.');
  const source=query.source??'all',limit=query.limit===undefined?16:Number(query.limit);
  if(!['all','reference','plant'].includes(source)||!Number.isInteger(limit)||limit<1||limit>20||(query.limit!==undefined&&!/^\d+$/.test(String(query.limit))))fail(400,'Invalid library options.');
  let cursor=null;
  if(query.cursor!==undefined)try {
    if(typeof query.cursor!=='string'||! /^[A-Za-z0-9_-]{1,1500}$/.test(query.cursor))throw Error();
    cursor=JSON.parse(Buffer.from(query.cursor,'base64url').toString());
    if(cursor.species!==String(speciesId)||cursor.source!==source||!['reference','plant'].includes(cursor.kind)||typeof cursor.id!=='string'||cursor.id.length>200||!/^\d{4}-\d\d-\d\d[ T]/.test(cursor.time)||!Number.isFinite(Date.parse(cursor.time)))throw Error();
  }catch{fail(400,'Invalid library cursor.');}
  const parent=(await c.query("SELECT s.species_id FROM species s LEFT JOIN rbac_species_visibility v ON v.species_id=s.species_id WHERE s.species_id=$1 AND COALESCE(v.visibility,'protected')=ANY($2::text[])",[speciesId,visibilityFor(user)])).rows[0];
  if(!parent)fail(404,'Species unavailable.');
  const managed=await gallery.available(c),semantic=await rolesAvailable(c);
  const plant=semantic?`UNION ALL SELECT a.id,a.content_type,a.created_at,'plant'::text AS source
    FROM plant_asset a JOIN plant_record p ON p.plant_id=a.plant_id
    JOIN plant_observation o ON o.id=a.observation_id AND o.plant_id=p.plant_id
    JOIN plant_asset_photo_role pr ON pr.asset_id=a.id AND pr.plant_id=p.plant_id AND pr.observation_id=o.id AND pr.role='whole_plant'
    JOIN species s ON s.species_id=p.species_id
    WHERE p.species_id=$1 AND p.rbac_status='Approved' AND o.status='Approved'
      AND COALESCE(s.rbac_data->>'approvalStatus','Approved')='Approved'
      AND a.content_type IN ('image/jpeg','image/png')`:'';
  const rows=(await c.query(`SELECT photos.*,created_at::text AS cursor_time FROM (
    SELECT a.id,a.content_type,a.created_at,'reference'::text AS source FROM plant_asset a JOIN species s ON s.species_id=a.species_id
    WHERE a.species_id=$1 AND a.approved AND a.observation_id IS NULL AND a.content_type IN ('image/jpeg','image/png')
      AND COALESCE(s.rbac_data->>'approvalStatus','Approved')='Approved' AND ${managed?gallery.membershipSql():'TRUE'}
    ${plant}) photos WHERE ($2='all' OR source=$2)
      AND ($3::timestamptz IS NULL OR created_at<$3 OR (created_at=$3 AND (source,id)>($4,$5)))
    ORDER BY created_at DESC,source,id LIMIT $6`,[speciesId,source,cursor?.time??null,cursor?.kind??'',cursor?.id??'',limit+1])).rows;
  const page=rows.slice(0,limit),last=page.at(-1),more=rows.length>limit;
  return {speciesId:Number(speciesId),images:page.map(r=>({assetId:r.id,url:`/api/assets/${encodeURIComponent(r.id)}`,contentType:r.content_type,source:r.source})),page:{limit,hasMore:more,nextCursor:more?Buffer.from(JSON.stringify({species:String(speciesId),source,time:last.cursor_time,kind:last.source,id:last.id})).toString('base64url'):null},semanticRolesAvailable:semantic};
}
function mountSpeciesPhotoLibrary(app,{pool,allow,writesEnabled=false}) {
  app.get('/api/species/photos/capabilities',allow('species.manage'),async(_req,res)=>{
    const readiness=await inspectPhotoSchema(pool);
    res.json({version:1,galleryAvailable:readiness.migration014==='verified-applied',semanticRolesAvailable:readiness.migration015==='verified-applied',
      activationRequested:writesEnabled===true,writesEnabled:writesEnabled===true&&readiness.schemaReady,...readiness});
  });
  app.get('/api/species/:id/images',allow('species.manage'),async(req,res)=>res.json(await gallery.readGallery(pool,req.params.id,req.user)));
  app.get('/api/species/:id/photo-library',allow('species.manage'),async(req,res)=>{
    const c=await pool.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const result=await listLibrary(c,req.params.id,req.user,req.query);await c.query('COMMIT');res.json(result);}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  });
  // The same explicit startup snapshot and fresh metadata check gate direct
  // species-reference uploads and gallery arrangement changes.
  app.put('/api/species/:id/images',allow('species.manage'),async(req,res)=>{
    await requireSpeciesPhotoWrites(pool,writesEnabled);
    res.json(await gallery.saveGallery(pool,req.params.id,req.user,req.body));
  });
}
module.exports={rolesAvailable,validateRoles,recordRole,proposedPhoto,listLibrary,mountSpeciesPhotoLibrary};
