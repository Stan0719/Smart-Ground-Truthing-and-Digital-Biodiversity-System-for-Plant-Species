"use strict";
// Historical capture and read projection. Lazy baselines can contain later edits;
// only a snapshot captured in the actual approval transaction is trustworthy.
const { randomUUID } = require("node:crypto");
const { initialVersionAvailable } = require("./record-version-history.cjs");
async function available(c) {
  return initialVersionAvailable(c);
}
const missing = () => ({ state: "unavailable", assets: [], fields: {} });
// Store in the existing optional history entity. Parent review locks serialize numbering;
// no approval, live-record, upload, notification or status semantics change here.
async function captureApprovedReview(c, { kind, submissionId, reviewId, reviewer, versionId = null }) {
  if (!(await initialVersionAvailable(c))) return;
  let targetId, owner, snapshot, photo = null;
  if (kind === "plant") {
    const row = (await c.query(`SELECT o.*,p.species_id,p.scientific_name AS plant_scientific_name,
      s.scientific_name AS species_scientific_name,s.common_name
      FROM plant_observation o JOIN plant_record p ON p.plant_id=o.plant_id
      JOIN species s ON s.species_id=p.species_id WHERE o.id=$1`, [submissionId])).rows[0];
    targetId=row.plant_id;owner=row.owner_subject;
    const assets=(await c.query("SELECT id FROM plant_asset WHERE observation_id=$1 AND plant_id=$2 AND content_type='image/jpeg' ORDER BY created_at,id", [submissionId,targetId])).rows;
    snapshot={plant_id:targetId,observation_id:submissionId,observation_revision:row.revision,
      species_id:row.species_id,scientific_name:row.plant_scientific_name,
      species_scientific_name:row.species_scientific_name,common_name:row.common_name,
      content:row.content,photo_ids:assets.map(asset=>asset.id)};
  } else {
    const row=(await c.query("SELECT * FROM species_request_submission WHERE request_id=$1",[submissionId])).rows[0];
    targetId=row.request_id;owner=row.owner_subject;photo=row.photo;
    snapshot=Object.fromEntries(["request_id","scientific_name","common_name","genus_name","family_name","conservation_status","description","habitat","approved_species_id"].map(key=>[key,row[key]]));
  }
  snapshot.review_provenance={kind,submission_id:String(submissionId),review_id:reviewId};
  const column=kind==="plant"?"plant_id":"request_id";
  const existing=versionId ? (await c.query(`SELECT id FROM record_version_history WHERE id=$1 AND ${column}=$2
    AND change_id IS NULL AND status='Approved' AND reviewed_at=CURRENT_TIMESTAMP AND reviewed_by=$3 FOR UPDATE`,
    [versionId,targetId,reviewer])).rows[0] : null;
  if(existing) await c.query("UPDATE record_version_history SET snapshot=$1,species_photo=$2 WHERE id=$3",[snapshot,photo,existing.id]);
  else await c.query(`INSERT INTO record_version_history(id,record_type,${column},version_number,owner_subject,edited_by,status,snapshot,species_photo,reviewed_by,reviewed_at,review_comment)
    SELECT $1,$2,$3,COALESCE(MAX(version_number),0)+1,$4,$4,'Approved',$5,$6,$7,CURRENT_TIMESTAMP,$8 FROM record_version_history WHERE ${column}=$3`,
    [randomUUID(),kind,targetId,owner,snapshot,photo,reviewer,kind==="plant"?
      (await c.query("SELECT comment FROM observation_review WHERE id=$1",[reviewId])).rows[0].comment:
      (await c.query("SELECT review_comment FROM species_request_submission WHERE request_id=$1",[submissionId])).rows[0].review_comment]);
}
async function speciesHistory(c, request) {
  if (request.request_status !== "Approved") return request;
  const metadata = (await c.query("SELECT reviewed_by,reviewed_at FROM species_request_submission WHERE request_id=$1",[request.request_id])).rows[0];
  let historical = missing();
  if (await available(c)) {
    const version = (await c.query(`SELECT v.id,v.snapshot,v.species_photo IS NOT NULL AS has_photo,r.reviewed_by,r.reviewed_at
      FROM record_version_history v JOIN species_request_submission r ON r.request_id=v.request_id
      WHERE v.request_id=$1 AND v.change_id IS NULL AND v.status='Approved'
        AND v.snapshot->'review_provenance'->>'kind'='species'
        AND v.snapshot->'review_provenance'->>'submission_id'=r.request_id::text
        AND v.snapshot->'review_provenance'->>'review_id'=(to_jsonb(r)->>'review_decision_id')
        AND v.reviewed_at=r.reviewed_at AND v.reviewed_by=r.reviewed_by AND v.created_at<=v.reviewed_at
        AND v.snapshot->>'request_id'=r.request_id::text
      ORDER BY v.version_number DESC LIMIT 1`, [request.request_id])).rows[0];
    if (version) historical = { state: ["scientific_name","common_name","genus_name","family_name","conservation_status","description","habitat"].every(key=>Object.hasOwn(version.snapshot,key)) ? "available" : "partial", fields: Object.fromEntries(
      ["scientific_name","common_name","genus_name","family_name","conservation_status","description","habitat"]
        .filter(key => Object.hasOwn(version.snapshot,key)).map(key => [key,version.snapshot[key]])),
      assets: version.has_photo ? [{ id: `historical-species-${version.id}`, content_type: "image/jpeg" }] : [],
      photos_unavailable: !version.has_photo, reviewed_by: version.reviewed_by, reviewed_at: version.reviewed_at };
  }
  return { ...request, reviewed_by: metadata?.reviewed_by ?? request.reviewed_by, reviewed_at: metadata?.reviewed_at ?? request.reviewed_at, historical_review: historical };
}
async function observationHistory(c, rows) {
  const approved = rows.filter(row => row.status === "Approved");
  let versions = [];
  if (approved.length && await available(c)) versions = (await c.query(`SELECT v.snapshot,v.id,r.observation_id,
      r.reviewer_subject,r.created_at,r.comment
    FROM record_version_history v JOIN observation_review r ON r.observation_id=v.snapshot->>'observation_id'
      AND r.reviewer_subject=v.reviewed_by AND r.created_at=v.reviewed_at AND r.decision='Approved'
    WHERE r.observation_id=ANY($1::text[]) AND v.change_id IS NULL
      AND v.status='Approved' AND v.created_at<=r.created_at AND v.plant_id::text=v.snapshot->>'plant_id'
      AND v.snapshot->'review_provenance'->>'kind'='plant'
      AND v.snapshot->'review_provenance'->>'submission_id'=r.observation_id
      AND v.snapshot->'review_provenance'->>'review_id'=r.id
    ORDER BY v.version_number DESC`, [approved.map(row => row.id)])).rows;
  const result = [];
  for (const row of rows) {
    let projected = row;
    if (row.status === "Approved") {
      const version = versions.find(v => v.observation_id === row.id && String(v.snapshot.plant_id) === String(row.plant_id));
      let historical = missing();
      if (version) {
        const snapshot = version.snapshot;
        // References establish identity; live attachment membership never selects historical photos.
        const ids = Array.isArray(snapshot.photo_ids) ? snapshot.photo_ids.filter(id => typeof id === "string") : [];
        const photos = ids.length ? (await c.query("SELECT id,content_type FROM plant_asset WHERE id=ANY($1::text[]) AND plant_id=$2 AND content_type='image/jpeg'", [ids,row.plant_id])).rows : [];
        historical = { state: ["content","scientific_name","species_id","species_scientific_name","common_name","photo_ids"].every(key=>Object.hasOwn(snapshot,key)) ? "available" : "partial", fields: { content: snapshot.content || {},
          plant_scientific_name: snapshot.scientific_name || null, species_id: snapshot.species_id || null,
          // Read only the catalogue values captured at this review event.
          scientific_name: snapshot.species_scientific_name ?? null,
          species_scientific_name: snapshot.species_scientific_name ?? null, common_name: snapshot.common_name ?? null },
          assets: ids.flatMap(id => photos.filter(photo => photo.id === id)),
          photos_unavailable: !Array.isArray(snapshot.photo_ids) || photos.length !== ids.length,
          reviewed_by: version.reviewer_subject, reviewed_at: version.created_at };
      }
      projected = { ...row, historical_review: historical };
    }
    if (row.species_request) projected = { ...projected, species_request: await speciesHistory(c,row.species_request) };
    result.push(projected);
  }
  return result;
}
module.exports = { observationHistory, speciesHistory, captureApprovedReview };
