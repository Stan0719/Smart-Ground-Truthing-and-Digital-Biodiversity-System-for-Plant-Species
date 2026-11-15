"use strict";
const { isDeepStrictEqual } = require("node:util");

// Only recorded direct edits participate. Reviews and approved-change proposals
// do not establish that a Botanist changed this pending submission.
const fields = ["heightCm", "lifeStage", "healthStatus", "morphology", "notes", "taxonomy"];
const scalar = value => typeof value === "string" || typeof value === "number" ? value : null;
function changesBetween(before, after) {
  const changes = fields.filter(field => !isDeepStrictEqual(before.content?.[field], after.content?.[field]))
    .map(field => ({ field, before: scalar(before.content?.[field]), after: scalar(after.content?.[field]) }));
  for (const field of ["scientific_name", "species_id", "qr_id"])
    if (String(before[field] ?? "") !== String(after[field] ?? ""))
      changes.push({ field, before: scalar(before[field]), after: scalar(after[field]) });
  // Location and evidence comparisons reveal no historical coordinates or bytes.
  if (["latitude", "longitude", "accuracy_m", "altitudeM", "zone"].some(field =>
    !isDeepStrictEqual(before.content?.[field], after.content?.[field])))
    changes.push({ field: "location", before: null, after: null });
  if (!isDeepStrictEqual(before.photo_ids || [], after.photo_ids || []))
    changes.push({ field: "evidence", before: null, after: null });
  return changes;
}
function submissionUpdate(row, versions) {
  const unavailable = { state: "unavailable", version: null, updated_at: null, changes: [] };
  const relevant = versions.filter(version => version.change_id === null &&
    version.edited_by === row.owner_subject && version.snapshot?.observation_id === row.id);
  const latest = relevant[0];
  if (!latest || latest.snapshot.observation_revision !== row.revision ||
      !isDeepStrictEqual(latest.snapshot.content, row.content) ||
      String(latest.snapshot.scientific_name ?? "") !== String(row.plant_scientific_name ?? "") ||
      String(latest.snapshot.species_id) !== String(row.species_id) ||
      !isDeepStrictEqual([...(latest.snapshot.photo_ids || [])].sort(), (row.assets || []).map(asset => asset.id).sort()))
    return unavailable;
  if (!latest.previous_snapshot || relevant.some(version => version.version_number > 1 &&
      version.previous_snapshot?.observation_id !== row.id)) return unavailable;
  for (const version of relevant) {
    const before = version.previous_snapshot;
    if (!before || before.observation_id !== row.id) continue;
    const changes = changesBetween(before, version.snapshot);
    if (changes.length) return { state: "updated", version: version.version_number,
      updated_at: version.created_at, changes };
  }
  return { state: "unchanged", version: null, updated_at: null, changes: [] };
}
async function withSubmissionUpdates(pool, rows, officer) {
  if (!officer || !rows.length) return rows;
  const available = (await pool.query(`SELECT count(*)=7 AS available FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name='record_version_history'
      AND column_name IN ('plant_id','version_number','edited_by','snapshot','previous_snapshot','change_id','created_at')`)).rows[0].available;
  const pending = rows.filter(row => row.status === "Pending Review");
  const versions = available && pending.length ? (await pool.query(`SELECT plant_id,version_number,edited_by,snapshot,previous_snapshot,change_id,created_at
    FROM record_version_history WHERE plant_id::text=ANY($1::text[]) AND change_id IS NULL ORDER BY version_number DESC`,
  [[...new Set(pending.map(row => String(row.plant_id)))]])).rows : [];
  return rows.map(row => ({ ...row, submission_update: row.status === "Pending Review"
    ? submissionUpdate(row, versions.filter(version => String(version.plant_id) === String(row.plant_id)))
    : { state: "unchanged", version: null, updated_at: null, changes: [] } }));
}
module.exports = { withSubmissionUpdates, submissionUpdate, changesBetween };
