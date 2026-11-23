"use strict";
const { randomUUID } = require("node:crypto");
const { permitted, visibilityFor } = require("../shared/rbac.cjs");
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

async function historyAvailable(c) {
  return (await c.query("SELECT to_regclass(current_schema() || '.record_version_history') IS NOT NULL AS available")).rows[0].available;
}
async function initialVersionAvailable(c) {
  return Boolean((await c.query(`SELECT to_regclass(current_schema() || '.record_version_history') IS NOT NULL
    AND (SELECT count(*) FROM information_schema.columns WHERE table_schema=current_schema()
      AND table_name='record_version_history' AND column_name IN
      ('record_type','owner_subject','edited_by','snapshot','species_photo'))=5 AS available`)).rows[0]?.available);
}
async function historyRevisionAvailable(c) {
  return Boolean((await c.query(`SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name='record_version_history' AND column_name='change_revision') AS available`)).rows[0]?.available);
}
async function requireVersionHistory(c, { revisions = false } = {}) {
  if (!(await historyAvailable(c)) || (revisions && !(await historyRevisionAvailable(c))))
    fail(503, revisions
      ? "Immutable version history requires reviewed migration 028. No submission changes were saved."
      : "Version history is unavailable. No submission changes were saved.");
}
async function requirePlantVersionPhotoHistory(c) {
  const available = (await c.query(`SELECT to_regclass(current_schema() || '.plant_record_version_photo') IS NOT NULL
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema()
      AND table_name='record_version_history' AND column_name='photo_refs_sealed') AS available`)).rows[0]?.available;
  if (!available) fail(503, "Immutable Plant-version photo history requires Migration 030. No submission changes were saved.");
}
async function appendInitialVersion(c, { kind, targetId, owner, snapshot, photo = null }) {
  await requireVersionHistory(c);
  const column = kind === "plant" ? "plant_id" : "request_id";
  const row = (await c.query(`INSERT INTO record_version_history(id,record_type,${column},version_number,owner_subject,edited_by,status,snapshot,species_photo)
    VALUES($1,$2,$3,1,$4,$4,'Pending Review',$5,$6) RETURNING id,version_number`,
  [randomUUID(), kind, targetId, owner, snapshot, photo])).rows[0];
  return row;
}
const plantPhotoRefs = (ids) => ids.map((asset_id) => ({ asset_id }));

async function appendVersion(c, { kind, targetId, owner, editor, base, baseStatus,
  basePhoto = null, baselineAt = null, baselineReview = null, proposed,
  proposedPhoto = null, changeId = null, changeRevision = null, plantPhotoSet = null }) {
  if (!(await historyAvailable(c))) return null;
  const revisions = await historyRevisionAvailable(c);
  if (plantPhotoSet) {
    if (kind !== "plant" || !changeId || !Number.isInteger(changeRevision) ||
      !Array.isArray(plantPhotoSet.assetIds) || !Array.isArray(plantPhotoSet.stagedAssets) ||
      JSON.stringify(proposed.photo_refs) !== JSON.stringify(plantPhotoRefs(plantPhotoSet.assetIds)))
      fail(409, "Sealed Plant-version photos do not match the version snapshot.");
    await requirePlantVersionPhotoHistory(c);
  }
  const column = kind === "plant" ? "plant_id" : "request_id";
  const previous = (await c.query(`SELECT id,version_number,status,snapshot FROM record_version_history WHERE ${column}=$1 ORDER BY version_number DESC LIMIT 1 FOR UPDATE`,
    [targetId])).rows[0];
  if (!previous) {
    if (revisions) fail(409, "This legacy record has no complete version history. Editing is blocked to preserve its existing history.");
    await c.query(`INSERT INTO record_version_history(id,record_type,${column},version_number,owner_subject,edited_by,status,snapshot,species_photo,created_at,reviewed_by,reviewed_at,review_comment)
      VALUES($1,$2,$3,1,$4,$4,$5,$6,$7,COALESCE($8,CURRENT_TIMESTAMP),$9,$10,$11)`,
    [randomUUID(), kind, targetId, owner, baseStatus ?? (changeId ? "Approved" : "Pending Review"), base, basePhoto, baselineAt,
      baselineReview?.reviewed_by ?? null, baselineReview?.reviewed_at ?? null, baselineReview?.review_comment ?? null]);
  }
  if (previous && (previous.status === "Pending Review" ||
      ((kind === "plant" || revisions) && previous.status === "Correction Required")))
    await c.query("UPDATE record_version_history SET status='Superseded' WHERE id=$1", [previous.id]);
  if (!previous && baseStatus === "Pending Review")
    await c.query(`UPDATE record_version_history SET status='Superseded' WHERE ${column}=$1 AND version_number=1`, [targetId]);
  const version = previous ? previous.version_number + 1 : 2;
  const previousSnapshot = changeId && changeRevision === 1 ? base : previous?.snapshot || base;
  const row = changeId && revisions
    ? (await c.query(`INSERT INTO record_version_history(id,record_type,${column},version_number,owner_subject,edited_by,status,snapshot,previous_snapshot,species_photo,change_id,change_revision${plantPhotoSet ? ",photo_refs_sealed" : ""})
      VALUES($1,$2,$3,$4,$5,$6,'Pending Review',$7,$8,$9,$10,$11${plantPhotoSet ? ",TRUE" : ""}) RETURNING id,version_number,change_revision`,
    [randomUUID(), kind, targetId, version, owner, editor, proposed, previousSnapshot, proposedPhoto, changeId, changeRevision])).rows[0]
    : (await c.query(`INSERT INTO record_version_history(id,record_type,${column},version_number,owner_subject,edited_by,status,snapshot,previous_snapshot,species_photo,change_id)
      VALUES($1,$2,$3,$4,$5,$6,'Pending Review',$7,$8,$9,$10) RETURNING id,version_number`,
    [randomUUID(), kind, targetId, version, owner, editor, proposed, previousSnapshot, proposedPhoto, changeId])).rows[0];
  if (plantPhotoSet) {
    const stagedById = new Map(plantPhotoSet.stagedAssets.map(asset => [asset.id, asset]));
    if (stagedById.size !== plantPhotoSet.stagedAssets.length ||
      plantPhotoSet.stagedAssets.some(asset => !plantPhotoSet.assetIds.includes(asset.id)))
      fail(409, "Staged Plant-version photos do not match the selected photo set.");
    for (const asset of plantPhotoSet.stagedAssets) {
      await c.query(`INSERT INTO plant_asset(id,plant_id,owner_subject,client_key,observation_id,approved,content_type,content)
        VALUES($1,$2,$3,$4,NULL,FALSE,'image/jpeg',$5)`,
      [asset.id, plantPhotoSet.plantId, owner, asset.clientKey, asset.content]);
    }
    for (const [position, assetId] of plantPhotoSet.assetIds.entries()) {
      await c.query(`INSERT INTO plant_record_version_photo
        (version_id,plant_id,observation_id,owner_subject,position,asset_id)
        VALUES($1,$2,$3,$4,$5,$6)`,
      [row.id, plantPhotoSet.plantId, plantPhotoSet.observationId, owner, position, assetId]);
    }
  }
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
  const { subject } = require("./domain.cjs");
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
  const select = async (c) => `SELECT id,record_type,plant_id,request_id,version_number,owner_subject,edited_by,status,snapshot,previous_snapshot,
    species_photo IS NOT NULL AS has_species_photo,encode(sha256(species_photo),'hex') AS species_photo_fingerprint,change_id,${await historyRevisionAvailable(c) ? "change_revision" : "NULL::integer AS change_revision"},
    reviewed_by,reviewed_at,review_comment,created_at FROM record_version_history`;
  app.get("/api/record-versions/capabilities", read, async (_req, res) => {
    res.json({ history_available: await historyAvailable(pool) });
  });
  // Officers need the submitted registration cycles while reviewing a Plant.
  // Keep this read path limited to the exact initial Observation and omit
  // approval captures, change proposals, and unrelated Plant history.
  app.get("/api/observations/:observationId/registration-history", allow("observations.review"), async (req, res) => {
    const observationId = String(req.params.observationId || "");
    if (!/^(?:[1-9]\d{0,18}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(observationId))
      fail(400, "Invalid registration history target.");
    const receiptsAvailable = Boolean((await pool.query("SELECT to_regclass(current_schema() || '.plant_submission_receipt') IS NOT NULL AS available")).rows[0]?.available);
    const observation = (await pool.query(`SELECT plant_id,to_jsonb(o)->>'origin_type' AS origin_type,
        ${receiptsAvailable ? "EXISTS (SELECT 1 FROM plant_submission_receipt r WHERE r.owner_subject=o.owner_subject AND r.result->>'id'=o.id)" : "FALSE"} AS has_initial_receipt
      FROM plant_observation o WHERE id=$1`, [observationId])).rows[0];
    const verifiedInitial = observation?.origin_type === "initial_registration" ||
      (observation?.origin_type !== "subsequent_observation" && observation?.has_initial_receipt === true);
    if (!observation || !verifiedInitial) fail(404, "Registration history unavailable.");
    if (!(await historyAvailable(pool))) return res.json({ history_available: false, versions: [] });
    const versions = (await pool.query(`SELECT id,record_type,plant_id,version_number,status,
        snapshot - 'qr_token' - 'photo_refs' AS snapshot,reviewed_by,reviewed_at,review_comment,created_at
      FROM record_version_history WHERE record_type='plant' AND plant_id=$1 AND change_id IS NULL
        AND snapshot->>'observation_id'=$2 AND NOT (snapshot ? 'review_provenance')
      ORDER BY version_number DESC`, [observation.plant_id, observationId])).rows;
    res.json({ history_available: true, versions });
  });
  app.get("/api/record-versions", read, async (req, res) => {
    if (!(await historyAvailable(pool))) return res.json({ history_available: false, versions: [] });
    const kind = req.query.kind;
    if (!["plant", "species"].includes(kind) || !/^[1-9]\d*$/.test(String(req.query.id || ""))) fail(400, "Invalid version target.");
    const column = kind === "plant" ? "plant_id" : "request_id";
    const rows = (await pool.query(`${await select(pool)} WHERE ${column}=$1 ORDER BY version_number DESC LIMIT 200`, [req.query.id])).rows;
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
    const row = (await pool.query(`${await select(pool)} WHERE id=$1`, [req.params.id])).rows[0];
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

module.exports = { historyAvailable, initialVersionAvailable, historyRevisionAvailable, requireVersionHistory, requirePlantVersionPhotoHistory, appendInitialVersion, appendVersion,
  plantPhotoRefs, plantProposedSnapshot, mountRecordVersionHistory };
