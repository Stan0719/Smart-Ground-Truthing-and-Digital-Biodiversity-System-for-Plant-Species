"use strict";
const { classifyObservations } = require('./observation-origin.cjs');

// Internal resolver: callers MUST authorize the parent Plant before publishing
// this result. Never send raw history, receipts or request metadata to clients.
async function resolvePlantRegistrations(c, plantIds) {
  const ids = [...new Set(plantIds.map(String))];
  const result = new Map(ids.map(id => [id, { state: 'unavailable' }]));
  if (!ids.length) return result;
  const observations = await classifyObservations(c, (await c.query(
    "SELECT * FROM plant_observation WHERE plant_id::text=ANY($1::text[])", [ids])).rows);
  const ready = (await c.query(`SELECT to_regclass('record_version_history') IS NOT NULL
    AND to_regclass('record_change_submission') IS NOT NULL AS available`)).rows[0]?.available;
  const edits = ready ? (await c.query(`SELECT v.*,r.base_snapshot,r.proposed_snapshot,
      r.owner_subject AS request_owner
    FROM record_version_history v JOIN record_change_submission r ON r.id=v.change_id AND r.plant_id=v.plant_id
    WHERE v.plant_id::text=ANY($1::text[]) AND v.record_type='plant'
      AND v.status IN ('Approved','Superseded') AND r.status='Approved' AND v.owner_subject=r.owner_subject
      AND v.reviewed_at IS NOT NULL AND v.reviewed_by=r.reviewed_by AND v.reviewed_at=r.reviewed_at
      AND v.snapshot->'review_provenance' IS NULL
    ORDER BY v.version_number DESC`, [ids])).rows : [];
  const historyReady = (await c.query("SELECT to_regclass('record_version_history') IS NOT NULL AS available")).rows[0]?.available;
  const captures = historyReady ? (await c.query(`SELECT v.* FROM record_version_history v
    JOIN observation_review r ON r.id=v.snapshot->'review_provenance'->>'review_id'
      AND r.observation_id=v.snapshot->>'observation_id' AND r.decision='Approved'
      AND r.reviewer_subject=v.reviewed_by AND r.created_at=v.reviewed_at
    WHERE v.plant_id::text=ANY($1::text[]) AND v.change_id IS NULL
      AND v.snapshot->'review_provenance'->>'kind'='plant'
      AND v.snapshot->'review_provenance'->>'submission_id'=r.observation_id
      AND v.snapshot->>'plant_id'=v.plant_id::text AND v.created_at<=r.created_at
    ORDER BY v.version_number DESC`, [ids])).rows : [];
  const assets = (await c.query(`SELECT id,plant_id,observation_id,owner_subject,approved,client_key,content_type
    FROM plant_asset WHERE plant_id::text=ANY($1::text[]) AND species_id IS NULL
      AND content_type IN ('image/jpeg','image/png') ORDER BY created_at,id`, [ids])).rows;
  for (const id of ids) {
    const initial = observations.filter(o => String(o.plant_id) === id && o.origin_type === 'initial_registration');
    if (initial.length !== 1 || initial[0].status !== 'Approved') continue;
    const original = initial[0];
    const edit = edits.find(v => String(v.plant_id) === id && v.request_owner === original.owner_subject &&
      v.base_snapshot?.workflow_type !== 'initial_registration_observation_edit');
    const source = edit ? observations.find(o => o.id === edit.base_snapshot?.observation_id &&
      String(o.plant_id) === id && o.owner_subject === original.owner_subject && o.status === 'Approved') : original;
    if (!source) continue;
    const capture = captures.find(v => String(v.plant_id) === id && v.snapshot.observation_id === original.id && v.owner_subject === original.owner_subject);
    const snapshot = edit?.snapshot ?? capture?.snapshot;
    if (!snapshot && edits.some(v => String(v.plant_id) === id && v.request_owner === original.owner_subject &&
        v.base_snapshot?.workflow_type === 'initial_registration_observation_edit')) continue;
    if (edit && (String(snapshot?.plant_id) !== id || snapshot.observation_id !== source.id || !snapshot.content)) continue;
    // An approved request is authoritative even on older deployments which
    // applied its changes to a subsequent Observation. Do not use that
    // Observation's later mutable content as registration data.
    const content = snapshot ? snapshot.content : original.content;
    if (!content || typeof content !== "object" || Array.isArray(content)) continue;
    const eligible = assets.filter(a => String(a.plant_id) === id && a.owner_subject === original.owner_subject);
    let photos;
    if (snapshot) {
      const refs = Array.isArray(snapshot.photo_refs) ? snapshot.photo_refs :
        Array.isArray(snapshot.photo_ids) ? snapshot.photo_ids.map(asset_id => ({ asset_id })) : null;
      if (!refs || refs.some(ref => !ref || typeof ref !== "object")) continue;
      photos = refs.map(ref => eligible.find(a => ref.asset_id ? a.id === ref.asset_id :
        edit && ref.change_id === edit.change_id && Number.isInteger(ref.change_photo_index) &&
        a.client_key === `approved-edit:${edit.change_id}:photo:${ref.change_photo_index}`));
      if (photos.some(a => !a)) continue;
    } else photos = eligible.filter(a => a.approved && a.observation_id === original.id);
    result.set(id, { state: 'available', observation_id: source.id, observation_revision: source.revision,
      registration_observation_id: original.id,
      version_id: edit?.id ?? capture?.id ?? null, version_number: edit?.version_number ?? capture?.version_number ?? null,
      content, photo_ids: photos.map(a => a.id) });
  }
  return result;
}
async function resolvePlantRegistration(c, plantId) {
  return (await resolvePlantRegistrations(c, [plantId])).get(String(plantId));
}
function registrationLocation(registration) {
  const content = registration?.state === 'available' ? registration.content : {};
  const valid = typeof content.latitude === 'number' && Number.isFinite(content.latitude) && Math.abs(content.latitude) <= 90 &&
    typeof content.longitude === 'number' && Number.isFinite(content.longitude) && Math.abs(content.longitude) <= 180;
  return { latitude: valid ? content.latitude : null, longitude: valid ? content.longitude : null,
    accuracy_m: typeof content.accuracy_m === 'number' && Number.isFinite(content.accuracy_m) && content.accuracy_m >= 0 ? content.accuracy_m : null,
    altitude_m: Number.isFinite(content.altitudeM ?? content.altitude_m) ? content.altitudeM ?? content.altitude_m : null,
    zone: typeof content.zone === 'string' ? content.zone : null };
}
module.exports = { resolvePlantRegistration, resolvePlantRegistrations, registrationLocation };
