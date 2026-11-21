"use strict";
const { permitted, visibilityFor } = require('../shared/rbac.cjs');
const { classifyObservations } = require('./observation-origin.cjs');
const fail = (status, message) => { throw Object.assign(Error(message), { status }); };
const point = value => value && typeof value.latitude === 'number' && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90 &&
  typeof value.longitude === 'number' && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180;
const accuracy = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
function proximityConfig(values = {}) {
  const c = { very_close_m: 2, close_m: 5, nearby_m: 10, radius_m: 30, accuracy_warning_m: 10, candidate_limit: 20, ...values };
  if (Object.keys(c).some(k => !['very_close_m','close_m','nearby_m','radius_m','accuracy_warning_m','candidate_limit'].includes(k)) ||
    ![c.very_close_m,c.close_m,c.nearby_m,c.radius_m,c.accuracy_warning_m].every(n => typeof n === 'number' && Number.isFinite(n) && n > 0) ||
    !(c.very_close_m < c.close_m && c.close_m < c.nearby_m && c.nearby_m < c.radius_m && c.radius_m <= 100) ||
    !Number.isInteger(c.candidate_limit) || c.candidate_limit < 1 || c.candidate_limit > 50) throw Error('Invalid Plant proximity configuration');
  return Object.freeze(c);
}
function distanceMetres(a,b) {
  if (!point(a) || !point(b)) throw Error('Invalid coordinates');
  const rad = Math.PI / 180;
  const h = Math.min(1, Math.max(0, Math.sin((b.latitude-a.latitude)*rad/2)**2 +
    Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin((b.longitude-a.longitude)*rad/2)**2));
  return 2*6371000*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}
function category(distance, config) {
  return distance <= config.very_close_m ? 'very_close' : distance <= config.close_m ? 'close' :
    distance <= config.nearby_m ? 'nearby' : distance <= config.radius_m ? 'additional' : 'outside';
}
// All authorized relevant Plants are considered before the nearest results are limited.
// No catalogue LIMIT 500, raw photo data, postgis extension or new index is required.
const candidateSql = `WITH located AS (
 SELECT p.plant_id,p.rbac_status AS status,left(p.scientific_name,200) AS plant_name,
  left(s.scientific_name,200) AS species_name,
  COALESCE(approved.latitude,pending.latitude,recorded.latitude) AS latitude,
  COALESCE(approved.longitude,pending.longitude,recorded.longitude) AS longitude,
  CASE WHEN approved.latitude IS NOT NULL THEN approved.accuracy_m
       WHEN pending.latitude IS NOT NULL THEN pending.accuracy_m ELSE recorded.accuracy_m END AS accuracy_m,
  CASE WHEN approved.latitude IS NOT NULL THEN 'approved_observation'
       WHEN pending.latitude IS NOT NULL THEN 'pending_observation_unverified' ELSE 'recorded_location_unverified' END AS location_source
 FROM plant_record p JOIN species s ON s.species_id=p.species_id
 LEFT JOIN rbac_species_visibility v ON v.species_id=p.species_id
 LEFT JOIN LATERAL (
  SELECT (o.content->>'latitude')::double precision AS latitude,(o.content->>'longitude')::double precision AS longitude,
   CASE WHEN jsonb_typeof(o.content->'accuracy_m')='number' THEN
        CASE WHEN (o.content->>'accuracy_m')::numeric BETWEEN 0 AND 1.7976931348623157e308
          THEN (o.content->>'accuracy_m')::double precision END END AS accuracy_m
  FROM plant_observation o WHERE o.plant_id=p.plant_id AND o.status='Approved'
   AND CASE WHEN jsonb_typeof(o.content->'latitude')='number' AND jsonb_typeof(o.content->'longitude')='number'
       THEN (o.content->>'latitude')::numeric BETWEEN -90 AND 90 AND (o.content->>'longitude')::numeric BETWEEN -180 AND 180 ELSE false END
  ORDER BY o.updated_at DESC,o.id DESC LIMIT 1
 ) approved ON true
 LEFT JOIN LATERAL (
  SELECT (o.content->>'latitude')::double precision AS latitude,(o.content->>'longitude')::double precision AS longitude,
   CASE WHEN jsonb_typeof(o.content->'accuracy_m')='number' THEN
        CASE WHEN (o.content->>'accuracy_m')::numeric BETWEEN 0 AND 1.7976931348623157e308
          THEN (o.content->>'accuracy_m')::double precision END END AS accuracy_m
  FROM plant_observation o WHERE o.plant_id=p.plant_id AND p.rbac_status='Pending Review' AND o.owner_subject=p.registered_subject
   AND o.status IN ('Pending Review','Correction Required','Flagged')
   AND CASE WHEN jsonb_typeof(o.content->'latitude')='number' AND jsonb_typeof(o.content->'longitude')='number'
       THEN (o.content->>'latitude')::numeric BETWEEN -90 AND 90 AND (o.content->>'longitude')::numeric BETWEEN -180 AND 180 ELSE false END
  ORDER BY o.updated_at DESC,o.id DESC LIMIT 1
 ) pending ON approved.latitude IS NULL
 LEFT JOIN LATERAL (
  SELECT l.latitude,l.longitude,l.accuracy_m FROM plant_location l
  WHERE l.plant_id=p.plant_id AND l.latitude BETWEEN -90 AND 90 AND l.longitude BETWEEN -180 AND 180
  ORDER BY l.recorded_at DESC,l.location_id DESC LIMIT 1
 ) recorded ON approved.latitude IS NULL AND pending.latitude IS NULL
 WHERE p.plant_id<>$1 AND (p.rbac_status='Approved' OR (p.rbac_status='Pending Review' AND EXISTS (
   SELECT 1 FROM plant_observation active WHERE active.plant_id=p.plant_id AND active.owner_subject=p.registered_subject
    AND active.status IN ('Pending Review','Correction Required','Flagged'))))
  AND COALESCE(v.visibility,'protected')=ANY($2::text[])
), measured AS (
 SELECT *, CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN
  12742000*asin(sqrt(least(1::double precision,greatest(0::double precision,
   power(sin(radians(latitude-$3)/2),2)+cos(radians($3))*cos(radians(latitude))*power(sin(radians(longitude-$4)/2),2))))) END AS distance_m
 FROM located
)
SELECT jsonb_build_object(
 'eligible_count',(SELECT count(*) FROM measured),
 'unlocated_count',(SELECT count(*) FROM measured WHERE distance_m IS NULL),
 'total_nearby',(SELECT count(*) FROM measured WHERE distance_m<=$5),
 'candidates',COALESCE((SELECT jsonb_agg(to_jsonb(best) ORDER BY distance_m,plant_id) FROM (
   SELECT plant_id,status,plant_name,species_name,accuracy_m,location_source,distance_m
   FROM measured WHERE distance_m<=$5 ORDER BY distance_m,plant_id LIMIT $6
 ) best),'[]'::jsonb)) AS result`;
function mountPlantProximity(app,{pool,allow,config:values={}}) {
  const config = proximityConfig(values);
  app.get('/api/observations/:id/proximity',allow('observations.review'),async(req,res)=>{
    res.set('Cache-Control','no-store');
    if (!permitted(req.user,'plants.gps.exact.read')) fail(403,'Exact GPS access required.');
    if (!/^(?:[1-9][0-9]{0,18}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(req.params.id) ||
      Object.keys(req.query).some(k=>k!=='revision') || typeof req.query.revision!=='string' || !/^[1-9][0-9]*$/.test(req.query.revision) ||
      !Number.isSafeInteger(Number(req.query.revision))) fail(400,'Invalid proximity request.');
    const c=await pool.connect();
    try {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await c.query("SET LOCAL statement_timeout='5000ms'");
      const row=(await c.query(`SELECT o.*,p.rbac_status AS parent_status FROM plant_observation o
       JOIN plant_record p ON p.plant_id=o.plant_id JOIN species s ON s.species_id=p.species_id
       LEFT JOIN rbac_species_visibility v ON v.species_id=p.species_id
       WHERE o.id=$1 AND COALESCE(v.visibility,'protected')=ANY($2::text[])`,[req.params.id,visibilityFor(req.user)])).rows[0];
      if (!row) fail(404,'Submission unavailable.');
      if (row.revision!==Number(req.query.revision)) fail(409,'Submission changed. Reload before checking proximity.');
      const [classified]=await classifyObservations(c,[row]);
      let result={contract_version:1,observation_id:row.id,revision:row.revision,plant_id:String(row.plant_id),config,
        checked_at:new Date().toISOString(),state:'not_eligible',candidates:[]};
      if (row.parent_status==='Pending Review' && classified.origin_type==='initial_registration' && ['Pending Review','Correction Required','Flagged'].includes(row.status)) {
        const content=row.content||{};
        result={...result,accuracy_m:accuracy(content.accuracy_m),state:'unavailable',reason:'invalid_coordinates'};
        if (point(content)) {
          const data=(await c.query(candidateSql,[row.plant_id,visibilityFor(req.user),content.latitude,content.longitude,config.radius_m,config.candidate_limit])).rows[0].result;
          const candidates=data.candidates.map(candidate=>({...candidate,plant_id:String(candidate.plant_id),accuracy_m:accuracy(candidate.accuracy_m),category:category(candidate.distance_m,config)}));
          result={...result,...data,candidates,state:data.unlocated_count>0||data.total_nearby>candidates.length?'incomplete':'complete',reason:null};
        }
      }
      await c.query('COMMIT');res.json(result);
    } catch(error) {await c.query('ROLLBACK').catch(()=>{});throw error;} finally {c.release();}
  });
}
module.exports={mountPlantProximity,proximityConfig,distanceMetres,category};
