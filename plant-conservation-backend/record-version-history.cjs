"use strict";
const { randomUUID } = require("node:crypto");
const { permitted, visibilityFor } = require("../shared/rbac.cjs");
const { subject, fail } = require("./domain.cjs");

async function historyAvailable(c) {
  return (await c.query("SELECT to_regclass(current_schema() || '.record_version_history') IS NOT NULL AS available")).rows[0].available;
}
const plantPhotoRefs = (ids) => ids.map((asset_id) => ({ asset_id }));

async function appendVersion(c, { kind, targetId, owner, editor, base, baseStatus, basePhoto = null,
  proposed, proposedPhoto = null, changeId = null, baselineAt = null, baselineReview = null }) {
  if (!(await historyAvailable(c))) return null;
  const column = kind === "plant" ? "plant_id" : "request_id";
  const previous = (await c.query(`SELECT id,version_number,status,snapshot FROM record_version_history WHERE ${column}=$1 ORDER BY version_number DESC LIMIT 1 FOR UPDATE`,
    [targetId])).rows[0];
  if (!previous) {
    await c.query(`INSERT INTO record_version_history(id,record_type,${column},version_number,owner_subject,edited_by,status,snapshot,species_photo,created_at,reviewed_by,reviewed_at,review_comment)
      VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,COALESCE($9,CURRENT_TIMESTAMP),$10,$11,$12)`,
    [randomUUID(), kind, targetId, owner, owner, baseStatus, base, basePhoto, baselineAt,
      baselineReview?.reviewed_by ?? null, baselineReview?.reviewed_at ?? null, baselineReview?.review_comment ?? null]);
  }
  if (previous?.status === "Pending Review")
    await c.query("UPDATE record_version_history SET status='Superseded' WHERE id=$1", [previous.id]);
  if (!previous && baseStatus === "Pending Review")
    await c.query(`UPDATE record_version_history SET status='Superseded' WHERE ${column}=$1 AND version_number=1`, [targetId]);
  const version = previous ? previous.version_number + 1 : 2;
  const row = (await c.query(`INSERT INTO record_version_history(id,record_type,${column},version_number,owner_subject,edited_by,status,snapshot,previous_snapshot,species_photo,change_id)
    VALUES($1,$2,$3,$4,$5,$6,'Pending Review',$7,$8,$9,$10) RETURNING id,version_number`,
    [randomUUID(), kind, targetId, version, owner, editor, proposed, previous?.snapshot || base, proposedPhoto, changeId])).rows[0];
  return row;
}

function plantProposedSnapshot(base, proposal, changeId, qrToken) {
  const retained = proposal.photo_ids !== undefined ? proposal.photo_ids : proposal.photos !== undefined ? [] : base.photo_ids || [];
  return { ...base, species_id: proposal.species_id, scientific_name: proposal.scientific_name,
    qr_id: proposal.qr_id ?? base.qr_id, qr_token: qrToken || base.qr_token,
    content: { ...base.content, ...proposal.content }, photo_refs: [
      ...plantPhotoRefs(retained),
      ...(proposal.photos || []).map((_, change_photo_index) => ({ change_id: changeId, change_photo_index })),
    ] };
}

function mountRecordVersionHistory(app, { pool, allow }) {
  const read = allow("plants.scientific.read");
  async function authorized(req, version) {
    if (!version) fail(404, "Version unavailable.");
    if (permitted(req.user, "species.manage")) return;
    if (version.owner_subject !== subject(req.user) || !permitted(req.user, "plants.create")) fail(404, "Version unavailable.");
    if (version.record_type === "plant") {
      const plant = (await pool.query(`SELECT p.registered_subject,p.rbac_status,s.rbac_data,
        COALESCE(v.visibility,'protected') AS visibility FROM plant_record p JOIN species s ON s.species_id=p.species_id
        LEFT JOIN rbac_species_visibility v ON v.species_id=p.species_id WHERE p.plant_id=$1`, [version.plant_id])).rows[0];
      const ownPending = plant?.rbac_status !== "Approved" && plant?.rbac_data?.submittedBy === subject(req.user) &&
        ["Pending Review", "Rejected", "Correction Required"].includes(plant?.rbac_data?.approvalStatus);
      if (!plant || plant.registered_subject !== subject(req.user) ||
        (!visibilityFor(req.user).includes(plant.visibility) && !ownPending)) fail(404, "Version unavailable.");
    } else {
      const request = (await pool.query(`SELECT r.owner_subject,COALESCE(v.visibility,'protected') AS visibility,r.approved_species_id
        FROM species_request_submission r LEFT JOIN rbac_species_visibility v ON v.species_id=r.approved_species_id WHERE r.request_id=$1`,
        [version.request_id])).rows[0];
      if (!request || request.owner_subject !== subject(req.user) ||
        (request.approved_species_id && !visibilityFor(req.user).includes(request.visibility))) fail(404, "Version unavailable.");
    }
  }
  const select = `SELECT id,record_type,plant_id,request_id,version_number,owner_subject,edited_by,status,snapshot,previous_snapshot,
    species_photo IS NOT NULL AS has_species_photo,change_id,reviewed_by,reviewed_at,review_comment,created_at FROM record_version_history`;
  app.get("/api/record-versions/capabilities", read, async (_req, res) => {
    res.json({ history_available: await historyAvailable(pool) });
  });
  app.get("/api/record-versions", read, async (req, res) => {
    if (!(await historyAvailable(pool))) return res.json({ history_available: false, versions: [] });
    const kind = req.query.kind;
    if (!["plant", "species"].includes(kind) || !/^[1-9]\d*$/.test(String(req.query.id || ""))) fail(400, "Invalid version target.");
    const column = kind === "plant" ? "plant_id" : "request_id";
    const rows = (await pool.query(`${select} WHERE ${column}=$1 ORDER BY version_number DESC LIMIT 200`, [req.query.id])).rows;
    if (rows.length) await authorized(req, rows[0]);
    else {
      // Never reveal whether a target exists through an empty history result.
      await authorized(req, { record_type: kind, [column]: req.query.id, owner_subject: subject(req.user) });
    }
    const prior = kind === "plant"
      ? (await pool.query(`SELECT id,plant_id,species_id,owner_subject,status,base_snapshot,
          proposed_snapshot - 'photos' - 'photo' AS proposed_snapshot,
          CASE WHEN jsonb_typeof(proposed_snapshot->'photos')='array' THEN jsonb_array_length(proposed_snapshot->'photos')
            WHEN proposed_snapshot ? 'photo' THEN 1 ELSE 0 END AS proposal_photo_count,
          reviewed_by,reviewed_at,review_comment,created_at FROM record_change_submission r
          WHERE plant_id=$1 AND NOT EXISTS(SELECT 1 FROM record_version_history v WHERE v.change_id=r.id)
          ORDER BY created_at DESC`, [req.query.id])).rows
      : (await pool.query(`SELECT r.id,r.plant_id,r.species_id,r.owner_subject,r.status,r.base_snapshot,
          r.proposed_snapshot - 'photos' - 'photo' AS proposed_snapshot,
          CASE WHEN jsonb_typeof(r.proposed_snapshot->'photos')='array' THEN jsonb_array_length(r.proposed_snapshot->'photos')
            WHEN r.proposed_snapshot ? 'photo' THEN 1 ELSE 0 END AS proposal_photo_count,
          r.reviewed_by,r.reviewed_at,r.review_comment,r.created_at FROM record_change_submission r
          JOIN species_request_submission s ON s.approved_species_id=r.species_id AND s.owner_subject=r.owner_subject
          WHERE s.request_id=$1 AND NOT EXISTS(SELECT 1 FROM record_version_history v WHERE v.change_id=r.id)
          ORDER BY r.created_at DESC`, [req.query.id])).rows;
    res.json({ history_available: true, versions: rows, prior_changes: prior });
  });
  app.get("/api/record-versions/:id", read, async (req, res) => {
    if (!(await historyAvailable(pool))) fail(503, "Version history is not available yet.");
    const row = (await pool.query(`${select} WHERE id=$1`, [req.params.id])).rows[0];
    await authorized(req, row);
    res.json({ version: row });
  });
  app.get("/api/record-versions/:id/photo", read, async (req, res) => {
    if (!(await historyAvailable(pool))) fail(503, "Version history is not available yet.");
    const row = (await pool.query("SELECT id,record_type,plant_id,request_id,owner_subject,species_photo FROM record_version_history WHERE id=$1",
      [req.params.id])).rows[0];
    await authorized(req, row);
    if (!row.species_photo) fail(404, "Historical photo unavailable.");
    res.type("image/jpeg").send(row.species_photo);
  });
}

module.exports = { historyAvailable, appendVersion, plantPhotoRefs, plantProposedSnapshot, mountRecordVersionHistory };
