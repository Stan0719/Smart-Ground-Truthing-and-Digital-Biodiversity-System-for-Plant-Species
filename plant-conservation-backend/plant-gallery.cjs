"use strict";
const {permitted,visibilityFor}=require('../shared/rbac.cjs');
const {classifyObservations}=require('./observation-origin.cjs');
const bad=()=>{throw Object.assign(Error('Invalid gallery pagination.'),{status:400});};
function options(query,plantId){
  if(Object.keys(query).some(k=>!['limit','cursor','scope'].includes(k)))bad();
  const limit=query.limit===undefined?20:Number(query.limit),scope=query.scope??'';
  if((query.limit!==undefined&&(typeof query.limit!=='string'||!/^\d+$/.test(query.limit)))||!Number.isInteger(limit)||limit<1||limit>100||!['','mine'].includes(scope))bad();
  let cursor=null;
  if(query.cursor!==undefined){
    try{
      if(typeof query.cursor!=='string'||!/^[A-Za-z0-9_-]{1,2000}$/.test(query.cursor))bad();
      cursor=JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8'));
      if(cursor.v!==1||cursor.plant!==plantId||cursor.scope!==scope||typeof cursor.group!=='string'||cursor.group.length>200||
        ![0,1].includes(cursor.kind)||typeof cursor.order!=='string'||!/^\d{1,100}$/.test(cursor.order)||
        typeof cursor.id!=='string'||!cursor.id.length||cursor.id.length>200)bad();
    }catch{bad();}
  }
  return {limit,scope,cursor};
}
function mountPlantGallery(app,{pool,allow}){
  app.get('/api/plants/:plantId/gallery',allow('plants.public.read'),async(req,res)=>{
    const plantId=req.params.plantId;
    if(!/^[1-9][0-9]{0,9}$/.test(plantId)||Number(plantId)>2147483647)bad();
    const {limit,scope,cursor}=options(req.query,plantId);
    if(scope==='mine'&&!permitted(req.user,'plants.create'))throw Object.assign(Error('Botanist access required.'),{status:403});
    const owner=req.user?`staff:${req.user.id}`:'',scientific=permitted(req.user,'plants.scientific.read');
    const officer=permitted(req.user,'observations.review');
    const args=[plantId,visibilityFor(req.user),owner,officer,scientific,scope==='mine'];
    const c=await pool.connect();
    try{
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await c.query("SET LOCAL statement_timeout='5000ms'");
      // Same parent visibility/status contract as readPlants; no hidden-asset
      // totals or cursor is issued when the plant itself is unavailable.
      const plant=(await c.query(`SELECT p.plant_id FROM plant_record p JOIN species s ON s.species_id=p.species_id
        LEFT JOIN rbac_species_visibility v ON v.species_id=s.species_id
        WHERE p.plant_id=$1 AND (CASE WHEN $6 THEN p.registered_subject=$3 ELSE
          (COALESCE(v.visibility,'protected')=ANY($2::text[]) OR (p.registered_subject=$3 AND p.rbac_status<>'Approved'
          AND s.rbac_data->>'submittedBy'=$3 AND s.rbac_data->>'approvalStatus' IN ('Pending Review','Rejected','Correction Required'))) END)
        AND (p.rbac_status='Approved' OR p.registered_subject=$3 OR $4)
        AND ($5 OR COALESCE(s.rbac_data->>'approvalStatus','Approved')='Approved')`,args)).rows[0];
      if(!plant)throw Object.assign(Error('Plant unavailable.'),{status:404});
      // Match /api/assets/:id for plant images: visibility (including its owner
      // exceptions), species approval, then approved evidence OR owner OR Officer.
      // Filter BEFORE pagination. Corrupt cross-plant links are excluded, never
      // projected as another plant's observation or guessed initial registration.
      const rows=(await c.query(`SELECT eligible.* FROM (
        SELECT a.id,a.content_type,COALESCE(o.id,'') AS group_key,
          CASE WHEN a.client_key ~ ':photo:[0-9]+$' THEN 0 ELSE 1 END AS order_kind,
          CASE WHEN a.client_key ~ ':photo:[0-9]+$' THEN substring(a.client_key from ':photo:([0-9]+)$')::numeric ELSE 0 END AS order_value,
          CASE WHEN o.id IS NULL THEN NULL ELSE jsonb_build_object('id',o.id,'plant_id',o.plant_id,
            'owner_subject',o.owner_subject,'client_key',o.client_key,'origin_type',COALESCE(to_jsonb(o)->>'origin_type','unknown'),
            'status',o.status,'revision',o.revision,'created_at',o.created_at,'updated_at',o.updated_at) END AS observation
        FROM plant_asset a JOIN plant_record p ON p.plant_id=a.plant_id JOIN species s ON s.species_id=p.species_id
        LEFT JOIN rbac_species_visibility v ON v.species_id=s.species_id
        LEFT JOIN plant_observation o ON o.id=a.observation_id AND o.plant_id=a.plant_id
        WHERE a.plant_id=$1 AND a.species_id IS NULL AND a.content_type IN ('image/jpeg','image/png')
          AND (a.observation_id IS NULL OR o.id IS NOT NULL)
          AND (COALESCE(v.visibility,'protected')=ANY($2::text[])
            OR (a.owner_subject=$3 AND p.registered_subject=$3 AND p.rbac_status<>'Approved'
              AND s.rbac_data->>'submittedBy'=$3 AND s.rbac_data->>'approvalStatus' IN ('Pending Review','Rejected','Correction Required'))
            OR ($6 AND a.owner_subject=$3 AND p.registered_subject=$3 AND o.id IS NOT NULL))
          AND ($5 OR COALESCE(s.rbac_data->>'approvalStatus','Approved')='Approved')
          AND ((p.rbac_status='Approved' AND (CASE WHEN a.observation_id IS NULL THEN a.approved ELSE o.status='Approved' END))
            OR a.owner_subject=$3 OR $4)
        ) eligible
        WHERE ($7::text IS NULL OR (group_key,order_kind,order_value,id)>($7::text,$8::integer,$9::numeric,$10::text))
        ORDER BY group_key,order_kind,order_value,id LIMIT $11`,
      [...args,cursor?.group??null,cursor?.kind??0,cursor?.order??'0',cursor?.id??'',limit+1])).rows;
      const page=rows.slice(0,limit),observations=[...new Map(page.filter(r=>r.observation).map(r=>[r.observation.id,r.observation])).values()];
      const classified=new Map((await classifyObservations(c,observations)).map(o=>[o.id,o]));
      const assets=page.map(row=>{
        const o=row.observation?classified.get(row.observation.id):null;
        const context=Boolean(o&&scientific&&(officer||o.owner_subject===owner));
        return {asset_id:row.id,content_type:row.content_type,observation_id:o?.id??null,
          linkage:o?'observation':'unlinked',effective_origin:o?.origin_type??'unknown',
          observation_date:context?o.created_at:null,observation_status:context?o.status:null,
          observation_revision:context?o.revision:null,photo_order:row.order_kind===0?String(row.order_value):null};
      });
      const more=rows.length>limit,last=page.at(-1);
      const next=more?Buffer.from(JSON.stringify({v:1,plant:plantId,scope,group:last.group_key,
        kind:last.order_kind,order:String(last.order_value),id:last.id})).toString('base64url'):null;
      await c.query('COMMIT');
      res.json({plant_id:plantId,assets,page:{limit,has_more:more,next_cursor:next}});
    }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
  });
}
module.exports={mountPlantGallery};
