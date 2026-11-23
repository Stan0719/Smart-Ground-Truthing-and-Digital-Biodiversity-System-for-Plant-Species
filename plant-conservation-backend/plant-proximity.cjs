"use strict";
const { permitted, visibilityFor } = require('../shared/rbac.cjs');
const { classifyObservations } = require('./observation-origin.cjs');
const { normalizeSpeciesName } = require('./species-name.cjs');
const fail = (status, message) => { throw Object.assign(Error(message), { status }); };
const point = value => value && typeof value.latitude === 'number' && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90 &&
  typeof value.longitude === 'number' && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180;
const accuracy = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
function proximityConfig(values = {}) {
  const c = { very_close_m: 2, close_m: 5, nearby_m: 10, grouping_radius_m: 5, radius_m: 30, accuracy_warning_m: 10, candidate_limit: 20, ...values };
  if (Object.keys(c).some(k => !['very_close_m','close_m','nearby_m','grouping_radius_m','radius_m','accuracy_warning_m','candidate_limit'].includes(k)) ||
    ![c.very_close_m,c.close_m,c.nearby_m,c.radius_m,c.accuracy_warning_m].every(n => typeof n === 'number' && Number.isFinite(n) && n > 0) ||
    !Number.isFinite(c.grouping_radius_m) || c.grouping_radius_m <= 0 ||
    !(c.very_close_m < c.close_m && c.close_m < c.nearby_m && c.nearby_m < c.radius_m && c.grouping_radius_m <= c.radius_m && c.radius_m <= 100) ||
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
 SELECT p.plant_id,p.species_id,COALESCE(s.rbac_data->>'approvalStatus','Approved') AS species_approval_status,
  p.rbac_status AS status,left(p.scientific_name,200) AS plant_name,
  left(s.scientific_name,200) AS species_name,
  CASE WHEN approved.latitude IS NOT NULL THEN approved.zone
       WHEN pending.latitude IS NOT NULL THEN pending.zone END AS zone,
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
    CASE WHEN jsonb_typeof(o.content->'zone')='string' THEN NULLIF(btrim(o.content->>'zone'),'') END AS zone,
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
    CASE WHEN jsonb_typeof(o.content->'zone')='string' THEN NULLIF(btrim(o.content->>'zone'),'') END AS zone,
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
    SELECT plant_id,species_id,species_approval_status,status,plant_name,species_name,zone,accuracy_m,location_source,distance_m
   FROM measured WHERE distance_m<=$5 ORDER BY distance_m,plant_id LIMIT $6
 ) best),'[]'::jsonb)) AS result`;
function normalizedZone(value) {
  return typeof value === 'string' && value.trim() ? value.trim().replace(/\s+/gu, ' ').toLowerCase() : null;
}
const validSpeciesId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
function compareSpeciesIdentity(left, right) {
  if (left?.kind === 'canonical' && right?.kind === 'canonical')
    return String(left.id) === String(right.id) ? 'confirmed_same' : 'confirmed_different';
  if (left?.name && right?.name)
    return normalizeSpeciesName(left.name) === normalizeSpeciesName(right.name)
      ? 'provisional_same_name' : 'provisional_different_name';
  return 'unknown';
}
function speciesIdentity(row) {
  if (row?.species_approval_status === 'Approved' && validSpeciesId(row.species_id))
    return { kind: 'canonical', id: String(row.species_id), name: row.species_name || null };
  return null;
}
async function submittedSpeciesIdentity(c, row) {
  const current = speciesIdentity(row);
  if (current) return current;
  if (!validSpeciesId(row.species_id)) return null;
  // Bind a pending name to this exact initial registration through the already
  // validated immutable receipt; never use the free-text Plant name.
  const provenance = (await c.query(`SELECT receipt.owner_subject,receipt.client_key,receipt.result,
      request.request_id,request.owner_subject AS request_owner,request.client_key AS request_client_key,
      request.request_status,request.proposed_species_id,request.approved_species_id,
      COALESCE(species.rbac_data->>'approvalStatus','Approved') AS linked_species_status
    FROM plant_submission_receipt receipt
    LEFT JOIN species_request_submission request
      ON request.request_id::text=receipt.result->>'species_request_id'
    LEFT JOIN species ON species.species_id::text=receipt.result->>'species_id'
    WHERE receipt.result->>'id'=$1`, [row.id])).rows;
  if (provenance.length !== 1) return null;
  const link = provenance[0], result = link.result;
  const requestId = result?.species_request_id;
  if (link.owner_subject !== row.owner_subject || link.client_key !== row.client_key ||
      String(result?.plant_id || '') !== String(row.plant_id) || String(result?.species_id || '') !== String(row.species_id) ||
      !/^[1-9][0-9]*$/.test(String(requestId || '')) || !link.request_id ||
      link.request_owner !== link.owner_subject ||
      link.request_client_key !== (result.species_request_client_key ?? link.client_key) ||
      (link.proposed_species_id != null && String(link.proposed_species_id) !== String(row.species_id)) ||
      (link.approved_species_id != null && String(link.approved_species_id) !== String(row.species_id))) return null;
  if (link.request_status === 'Approved' && link.approved_species_id != null &&
      String(link.approved_species_id) === String(row.species_id) && link.linked_species_status === 'Approved')
    return { kind: 'canonical', id: String(row.species_id), name: null };

  const historyAvailable = (await c.query("SELECT to_regclass(current_schema() || '.record_version_history') IS NOT NULL AS available")).rows[0]?.available;
  if (!historyAvailable) return null;
  const version = (await c.query(`SELECT snapshot->>'scientific_name' AS scientific_name
    FROM record_version_history
    WHERE record_type='species' AND request_id=$1 AND owner_subject=$2 AND created_at<=$3
      AND snapshot->>'request_id'=$1::text
    ORDER BY created_at DESC,version_number DESC LIMIT 1`, [link.request_id, link.owner_subject, row.created_at])).rows[0];
  return typeof version?.scientific_name === 'string' && version.scientific_name.trim()
    ? { kind: 'provisional', name: version.scientific_name.trim() } : null;
}
function candidateSpeciesIdentity(candidate) {
  if (candidate.species_approval_status === 'Approved' && validSpeciesId(candidate.species_id))
    return { kind: 'canonical', id: String(candidate.species_id), name: candidate.species_name || null };
  const name = typeof candidate.species_name === 'string' ? candidate.species_name.trim() : '';
  return name ? { kind: 'provisional', name } : null;
}
function comparePlantIdentity(targetIdentity, targetZone, candidate) {
  const speciesMatch = compareSpeciesIdentity(targetIdentity, candidateSpeciesIdentity(candidate));
  const leftZone = normalizedZone(targetZone), rightZone = normalizedZone(candidate.zone);
  const zoneMatch = !leftZone || !rightZone ? 'unknown' : leftZone === rightZone ? 'same' : 'different';
  let matchStatus = 'uncertain_species';
  if (speciesMatch === 'confirmed_different') matchStatus = 'different_species';
  else if (speciesMatch === 'provisional_same_name' || speciesMatch === 'provisional_different_name') matchStatus = 'provisional_species';
  else if (speciesMatch === 'confirmed_same') matchStatus = zoneMatch === 'same' ? 'same_species_zone' : zoneMatch === 'different' ? 'different_zone' : 'uncertain_zone';
  return { match_status: matchStatus, species_match_status: speciesMatch, zone_match_status: zoneMatch };
}
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
      const row=(await c.query(`SELECT o.*,p.rbac_status AS parent_status,p.species_id,
        COALESCE(s.rbac_data->>'approvalStatus','Approved') AS species_approval_status FROM plant_observation o
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
          const targetIdentity = await submittedSpeciesIdentity(c, row);
          const candidates=data.candidates.map(candidate=>({
            plant_id:String(candidate.plant_id),status:candidate.status,plant_name:candidate.plant_name,species_name:candidate.species_name,
            accuracy_m:accuracy(candidate.accuracy_m),distance_m:candidate.distance_m,category:category(candidate.distance_m,config),
            location_source:candidate.location_source,
            ...comparePlantIdentity(targetIdentity,content.zone,candidate),
            within_grouping_radius:candidate.distance_m<=config.grouping_radius_m
          }));
          result={...result,...data,candidates,state:data.unlocated_count>0||data.total_nearby>candidates.length?'incomplete':'complete',reason:null};
        }
      }
      await c.query('COMMIT');res.json(result);
    } catch(error) {await c.query('ROLLBACK').catch(()=>{});throw error;} finally {c.release();}
  });
}
module.exports={mountPlantProximity,proximityConfig,distanceMetres,category,compareSpeciesIdentity,comparePlantIdentity};
