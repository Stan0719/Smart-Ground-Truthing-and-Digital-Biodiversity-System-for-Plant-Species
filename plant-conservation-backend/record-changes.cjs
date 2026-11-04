"use strict";
const { randomUUID, createHash } = require("node:crypto");
const sharp = require("sharp");
const { permitted, visibilityFor } = require("../shared/rbac.cjs");
const { transaction, audit, subject, fail, text, id, fieldContent, speciesRow } = require("./domain.cjs");
const { historyAvailable, appendVersion, plantPhotoRefs, plantProposedSnapshot } = require("./record-version-history.cjs");

const speciesFields = ["scientific_name", "common_name", "genus_name", "family_name", "conservation_status", "description", "habitat"];
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const numericId = (value) => id(String(value));

async function photoBytes(photo) {
  if (!photo || !["image/jpeg", "image/png"].includes(photo.content_type) ||
    typeof photo.base64 !== "string" || !photo.base64.length || photo.base64.length > 5592408 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(photo.base64)) fail(400, "Use a JPEG or PNG photo up to 4 MB.");
  const original = Buffer.from(photo.base64, "base64");
  if (!original.length || original.length > 4194304) fail(413, "Photo exceeds 4 MB.");
  try {
    return await sharp(original, { limitInputPixels: 24000000, failOn: "warning" }).rotate()
      .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 }).toBuffer();
  } catch { fail(400, "Invalid photo. Choose another image."); }
}

function plantProposal(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
    Object.keys(body).some((key) => !["species_id", "scientific_name", "content", "photos", "photo_ids", "qr_id"].includes(key)))
    fail(400, "Unsupported plant edit field.");
  const proposal = { species_id: numericId(body.species_id), scientific_name: text(body.scientific_name, 200),
    content: fieldContent({ ...body.content }) };
  if (!Number.isFinite(proposal.content.latitude) || !Number.isFinite(proposal.content.longitude))
    fail(400, "Plant location is required.");
  if (body.photos !== undefined) {
    if (!Array.isArray(body.photos) || body.photos.length > 8 ||
      (body.photo_ids === undefined && body.photos.length < 3))
      fail(400, "Select three to eight plant photos.");
    proposal.photos = body.photos;
  }
  if (body.photo_ids !== undefined) {
    if (!Array.isArray(body.photo_ids) || body.photo_ids.length > 8 ||
      new Set(body.photo_ids).size !== body.photo_ids.length ||
      body.photo_ids.some((value) => typeof value !== "string" || !/^[A-Za-z0-9:_-]{1,100}$/.test(value)))
      fail(400, "Invalid existing plant photos.");
    proposal.photo_ids = body.photo_ids;
  }
  if (body.qr_id !== undefined) {
    if (body.qr_id === null) fail(409, "A registered plant must retain a QR assignment.");
    proposal.qr_id = numericId(body.qr_id);
  }
  return proposal;
}

function speciesProposal(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
    Object.keys(body).some((key) => ![...speciesFields, "photo"].includes(key)))
    fail(400, "Unsupported species edit field.");
  const proposal = Object.fromEntries(speciesFields.map((key) =>
    [key, text(body[key], ["description", "habitat"].includes(key) ? 4000 : 200)]));
  if (body.photo !== undefined) proposal.photo = body.photo;
  return proposal;
}

async function normalized(proposal, kind) {
  if (kind === "plant" && proposal.photos) {
    const photos = [];
    for (const photo of proposal.photos) photos.push({ content_type: "image/jpeg", base64: (await photoBytes(photo)).toString("base64") });
    return { ...proposal, photos };
  }
  if (kind === "species" && proposal.photo)
    return { ...proposal, photo: { content_type: "image/jpeg", base64: (await photoBytes(proposal.photo)).toString("base64") } };
  return proposal;
}

async function ownedPlant(c, plantId, user, lock = false) {
  const row = (await c.query(`SELECT p.plant_id,p.species_id,p.scientific_name,p.qr_token,p.registered_subject,p.rbac_status,
    COALESCE(v.visibility,'protected') AS visibility,s.rbac_data AS species_data FROM plant_record p
    JOIN species s ON s.species_id=p.species_id
    LEFT JOIN rbac_species_visibility v ON v.species_id=p.species_id WHERE p.plant_id=$1 ${lock ? "FOR UPDATE OF p" : ""}`,
  [plantId])).rows[0];
  const ownUnapprovedProposal = row && row.registered_subject === subject(user) &&
    row.rbac_status !== "Approved" && row.species_data?.submittedBy === subject(user) &&
    ["Pending Review", "Rejected", "Correction Required"].includes(row.species_data?.approvalStatus);
  if (!row || row.registered_subject !== subject(user) ||
    (!visibilityFor(user).includes(row.visibility) && !ownUnapprovedProposal))
    fail(404, "Plant record unavailable.");
  return row;
}
async function ownedSpeciesRequest(c, requestId, user, lock = false) {
  const row = (await c.query(`SELECT * FROM species_request_submission WHERE request_id=$1 ${lock ? "FOR UPDATE" : ""}`,
    [requestId])).rows[0];
  if (!row || row.owner_subject !== subject(user)) fail(404, "Species request unavailable.");
  if (row.approved_species_id) {
    const visibility = (await c.query("SELECT COALESCE(v.visibility,'protected') AS visibility FROM rbac_species_visibility v WHERE v.species_id=$1",
      [row.approved_species_id])).rows[0]?.visibility || "protected";
    if (!visibilityFor(user).includes(visibility)) fail(404, "Species request unavailable.");
  }
  return row;
}
async function approvedPlantSnapshot(c, row) {
  const observation = (await c.query("SELECT id,content,revision FROM plant_observation WHERE plant_id=$1 AND status='Approved' ORDER BY updated_at DESC,id DESC LIMIT 1",
    [row.plant_id])).rows[0];
  if (!observation) fail(409, "Approve the plant observation before editing its public information.");
  const photoIds = (await c.query("SELECT id FROM plant_asset WHERE observation_id=$1 AND approved=TRUE AND content_type='image/jpeg' ORDER BY created_at,id",
    [observation.id])).rows.map((asset) => asset.id);
  const qr = (await c.query("SELECT qr_id FROM public.qr_code WHERE plant_id=$1 AND qr_code=$2", [row.plant_id, row.qr_token])).rows[0];
  return { plant_id: row.plant_id, species_id: row.species_id, scientific_name: row.scientific_name,
    qr_token: row.qr_token, qr_id: qr?.qr_id ?? null,
    observation_id: observation.id, observation_revision: observation.revision, photo_ids: photoIds,
    photo_refs: plantPhotoRefs(photoIds), content: observation.content };
}
async function pendingPlantSnapshot(c, row, observation) {
  const photoIds = await currentPhotoIds(c, observation.id, false);
  const qr = (await c.query("SELECT qr_id FROM public.qr_code WHERE plant_id=$1 AND qr_code=$2", [row.plant_id, row.qr_token])).rows[0];
  return { plant_id: row.plant_id, species_id: row.species_id, scientific_name: row.scientific_name,
    qr_token: row.qr_token, qr_id: qr?.qr_id ?? null, observation_id: observation.id,
    observation_revision: observation.revision, photo_ids: photoIds, photo_refs: plantPhotoRefs(photoIds), content: observation.content };
}
async function plantReview(c, observationId) {
  return (await c.query(`SELECT reviewer_subject AS reviewed_by,created_at AS reviewed_at,comment AS review_comment
    FROM observation_review WHERE observation_id=$1 ORDER BY created_at DESC LIMIT 1`, [observationId])).rows[0] || null;
}
async function applyQrChange(c, plant, qrId) {
  if (qrId === undefined) return;
  const current = (await c.query("SELECT qr_id FROM public.qr_code WHERE plant_id=$1 AND qr_code=$2 FOR UPDATE",
    [plant.plant_id, plant.qr_token])).rows[0];
  if (current && String(current.qr_id) === String(qrId)) return;
  const next = (await c.query("SELECT qr_id,qr_code FROM public.qr_code WHERE qr_id=$1 AND plant_id IS NULL AND status='generated' FOR UPDATE",
    [qrId])).rows[0];
  if (!next) fail(409, "Selected QR code is no longer available. Refresh the QR list.");
  if ((await c.query("SELECT plant_id FROM plant_record WHERE qr_token=$1 AND plant_id<>$2", [next.qr_code, plant.plant_id])).rows.length)
    fail(409, "Selected QR code is already used by another plant.");
  if (current) await c.query("UPDATE public.qr_code SET plant_id=NULL,status='retired',retired_at=CURRENT_TIMESTAMP WHERE qr_id=$1", [current.qr_id]);
  await c.query("UPDATE public.qr_code SET plant_id=$1,status=$2,assigned_at=CURRENT_TIMESTAMP,activated_at=CASE WHEN $2='active' THEN CURRENT_TIMESTAMP ELSE NULL END,retired_at=NULL WHERE qr_id=$3",
    [plant.plant_id, plant.rbac_status === "Approved" ? "active" : "assigned", next.qr_id]);
  await c.query("UPDATE plant_record SET qr_token=$1 WHERE plant_id=$2", [next.qr_code, plant.plant_id]);
}
async function currentPhotoIds(c, observationId, approved) {
  return (await c.query("SELECT id FROM plant_asset WHERE observation_id=$1 AND approved=$2 AND content_type='image/jpeg' ORDER BY created_at,id",
    [observationId, approved])).rows.map((row) => row.id);
}
async function applyPlantPhotos(c, { plantId, observationId, owner, approved, proposal, keyPrefix }) {
  if (proposal.photos === undefined && proposal.photo_ids === undefined) return;
  const existing = await currentPhotoIds(c, observationId, approved);
  const retained = proposal.photo_ids || [];
  if (retained.some((photoId) => !existing.includes(photoId))) fail(409, "Plant photos changed. Reload before saving.");
  const additions = proposal.photos || [];
  if (retained.length + additions.length < 3 || retained.length + additions.length > 8)
    fail(400, "Keep three to eight plant photos.");
  const removed = existing.filter((photoId) => !retained.includes(photoId));
  if (removed.length) await c.query("UPDATE plant_asset SET observation_id=NULL,approved=FALSE WHERE id=ANY($1::text[])", [removed]);
  for (const [index, photo] of additions.entries())
    await c.query("INSERT INTO plant_asset(id,plant_id,owner_subject,client_key,observation_id,approved,content_type,content) VALUES($1,$2,$3,$4,$5,$6,'image/jpeg',$7)",
      [randomUUID(), plantId, owner, `${keyPrefix}:photo:${index}`, observationId, approved, Buffer.from(photo.base64, "base64")]);
}
function speciesSnapshot(row) {
  return Object.fromEntries(speciesFields.map((key) => [key, row[key]]));
}
async function speciesVersion(c, speciesId) {
  const row = (await c.query("SELECT scientific_name,common_name,genus_id,status_id,description,rbac_data->>'habitat' AS habitat,rbac_data->>'approvalStatus' AS approval_status FROM species WHERE species_id=$1",
    [speciesId])).rows[0];
  if (!row || (row.approval_status || "Approved") !== "Approved") fail(409, "Approved species is unavailable.");
  return row;
}
async function taxonomy(c, proposal) {
  const family = (await c.query("SELECT family_id FROM family WHERE lower(btrim(family_name))=lower(btrim($1)) ORDER BY family_id LIMIT 1", [proposal.family_name])).rows[0]
    || (await c.query("INSERT INTO family(family_name) VALUES($1) RETURNING family_id", [proposal.family_name])).rows[0];
  const genus = (await c.query("SELECT genus_id FROM genus WHERE lower(btrim(genus_name))=lower(btrim($1)) AND family_id=$2 ORDER BY genus_id LIMIT 1",
    [proposal.genus_name, family.family_id])).rows[0]
    || (await c.query("INSERT INTO genus(genus_name,family_id) VALUES($1,$2) RETURNING genus_id", [proposal.genus_name, family.family_id])).rows[0];
  const status = (await c.query("SELECT status_id FROM conservation_status WHERE lower(status_name)=lower($1) ORDER BY status_id LIMIT 1",
    [proposal.conservation_status])).rows[0]
    || (await c.query("INSERT INTO conservation_status(status_name) VALUES($1) RETURNING status_id", [proposal.conservation_status])).rows[0];
  return { genusId: genus.genus_id, statusId: status.status_id };
}
async function uniqueName(c, name, speciesId) {
  await c.query("SELECT pg_advisory_xact_lock(hashtext(lower(btrim($1))))", [name]);
  if ((await c.query("SELECT species_id FROM species WHERE lower(btrim(scientific_name))=lower(btrim($1)) AND species_id<>$2 LIMIT 1",
    [name, speciesId])).rows.length) fail(409, "This scientific name belongs to another species.");
}

function mountRecordChanges(app, { pool, allow }) {
  // Pending records are private. The same record and observation IDs are retained.
  app.patch("/api/my-plants/:id", allow("plants.create"), async (req, res) => {
    const { expected_revision: expectedRevision, ...edit } = req.body || {};
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) fail(400, "Current observation revision is required.");
    const proposal = await normalized(plantProposal(edit), "plant");
    const result = await transaction(pool, async (c) => {
      const plant = await ownedPlant(c, numericId(req.params.id), req.user, true);
      if (!["Pending Review", "Rejected", "Correction Required"].includes(plant.rbac_status))
        fail(409, "Approved plants require a reviewed change submission.");
      const observation = (await c.query("SELECT * FROM plant_observation WHERE plant_id=$1 AND owner_subject=$2 ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE",
        [plant.plant_id, subject(req.user)])).rows[0];
      if (!observation || !["Pending Review", "Rejected", "Correction Required"].includes(observation.status))
        fail(409, "Plant observation is unavailable for correction.");
      if (observation.revision !== expectedRevision) fail(409, "Plant changed. Reload its latest version before saving.");
      const before = await pendingPlantSnapshot(c, plant, observation);
      if ((plant.species_data?.approvalStatus || "Approved") !== "Approved" && proposal.species_id !== String(plant.species_id))
        fail(409, "Finish the linked species request before changing this plant's species.");
      if (proposal.species_id !== String(plant.species_id)) await speciesRow(c, proposal.species_id, req.user);
      await applyQrChange(c, plant, proposal.qr_id);
      await c.query("UPDATE plant_record SET species_id=$1,scientific_name=$2,rbac_status='Pending Review' WHERE plant_id=$3",
        [proposal.species_id, proposal.scientific_name, plant.plant_id]);
      await c.query("UPDATE plant_observation SET content=$1,status='Pending Review',revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=$2",
        [{ ...observation.content, ...proposal.content }, observation.id]);
      await c.query("INSERT INTO plant_location(plant_id,latitude,longitude,accuracy_m) VALUES($1,$2,$3,$4)",
        [plant.plant_id, proposal.content.latitude, proposal.content.longitude, proposal.content.accuracy_m ?? null]);
      await applyPlantPhotos(c, { plantId: plant.plant_id, observationId: observation.id, owner: subject(req.user),
        approved: false, proposal, keyPrefix: `plant-edit:${randomUUID()}` });
      const updated = (await c.query("SELECT plant_id,species_id,scientific_name,qr_token FROM plant_record WHERE plant_id=$1", [plant.plant_id])).rows[0];
      const after = await pendingPlantSnapshot(c, updated,
        { ...observation, content: { ...observation.content, ...proposal.content }, revision: observation.revision + 1 });
      await appendVersion(c, { kind: "plant", targetId: plant.plant_id, owner: subject(req.user), editor: subject(req.user),
        base: before, baseStatus: observation.status, proposed: after, baselineAt: observation.created_at,
        baselineReview: await plantReview(c, observation.id) });
      await audit(c, req.user, "pending_plant_updated", plant.plant_id);
      return { plant_id: plant.plant_id, observation_id: observation.id, status: "Pending Review" };
    });
    res.json(result);
  });

  app.patch("/api/my-species-requests/:id", allow("plants.create"), async (req, res) => {
    const proposal = await normalized(speciesProposal(req.body), "species");
    const result = await transaction(pool, async (c) => {
      const row = await ownedSpeciesRequest(c, numericId(req.params.id), req.user, true);
      if (!["Pending Review", "Rejected", "Correction Required"].includes(row.request_status))
        fail(409, "Approved species require a reviewed change submission.");
      const before = { request_id: row.request_id, species_id: row.proposed_species_id,
        ...speciesSnapshot(row) };
      if (row.proposed_species_id) {
        const proposed = (await c.query("SELECT species_id FROM species WHERE species_id=$1 FOR UPDATE", [row.proposed_species_id])).rows[0];
        if (!proposed) fail(409, "Proposed species is unavailable.");
        await uniqueName(c, proposal.scientific_name, row.proposed_species_id);
        const refs = await taxonomy(c, proposal);
        await c.query("UPDATE species SET scientific_name=$1,common_name=$2,genus_id=$3,status_id=$4,description=$5,rbac_data=rbac_data || $6::jsonb WHERE species_id=$7",
          [proposal.scientific_name, proposal.common_name, refs.genusId, refs.statusId, proposal.description,
            { habitat: proposal.habitat, approvalStatus: "Pending Review" }, row.proposed_species_id]);
        if (proposal.photo) await c.query("UPDATE plant_asset SET content=$1 WHERE species_id=$2 AND owner_subject=$3 AND approved=FALSE",
          [Buffer.from(proposal.photo.base64, "base64"), row.proposed_species_id, subject(req.user)]);
      } else {
        await c.query("SELECT pg_advisory_xact_lock(hashtext(lower(btrim($1))))", [proposal.scientific_name]);
        if ((await c.query("SELECT species_id FROM species WHERE lower(btrim(scientific_name))=lower(btrim($1)) LIMIT 1", [proposal.scientific_name])).rows.length)
          fail(409, "This scientific name belongs to another species.");
      }
      if (proposal.scientific_name.toLowerCase() !== row.scientific_name.toLowerCase() &&
        (await c.query("SELECT request_id FROM species_request_submission WHERE request_id<>$1 AND lower(btrim(scientific_name))=lower(btrim($2)) AND request_status='Pending Review'",
          [row.request_id, proposal.scientific_name])).rows.length) fail(409, "Another request for this scientific name is pending.");
      const values = speciesFields.map((field) => proposal[field]);
      await c.query(`UPDATE species_request_submission SET ${speciesFields.map((field, index) => `${field}=$${index + 1}`).join(",")},
        photo=COALESCE($8,photo),request_status='Pending Review' WHERE request_id=$9`,
      [...values, proposal.photo ? Buffer.from(proposal.photo.base64, "base64") : null, row.request_id]);
      await appendVersion(c, { kind: "species", targetId: row.request_id, owner: subject(req.user), editor: subject(req.user),
        base: before, baseStatus: row.request_status, basePhoto: row.photo,
        proposed: { request_id: row.request_id, species_id: row.proposed_species_id, ...speciesSnapshot(proposal) },
        proposedPhoto: proposal.photo ? Buffer.from(proposal.photo.base64, "base64") : row.photo,
        baselineAt: row.submitted_at, baselineReview: row });
      await audit(c, req.user, "pending_species_updated", row.request_id);
      return { request_id: row.request_id, status: "Pending Review" };
    });
    res.json(result);
  });

  app.get("/api/record-changes/capabilities", allow("plants.scientific.read"), async (_req, res) => {
    const available = (await pool.query("SELECT to_regclass(current_schema() || '.record_change_submission') IS NOT NULL AS available")).rows[0].available;
    res.json({ approved_edits_available: available });
  });

  app.post("/api/record-changes", allow("plants.create"), async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((key) => !["kind", "target_id", "proposed", "client_key"].includes(key)) ||
      !["plant", "species"].includes(body.kind)) fail(400, "Invalid change submission.");
    const targetId = numericId(body.target_id), clientKey = text(body.client_key, 100);
    const proposal = await normalized(body.kind === "plant" ? plantProposal(body.proposed) : speciesProposal(body.proposed), body.kind);
    const payloadHash = digest({ kind: body.kind, targetId, proposal });
    const result = await transaction(pool, async (c) => {
      const old = (await c.query("SELECT id,payload_hash,status FROM record_change_submission WHERE owner_subject=$1 AND client_key=$2",
        [subject(req.user), clientKey])).rows[0];
      if (old) {
        if (old.payload_hash !== payloadHash) fail(409, "This submission key belongs to different changes.");
        return old;
      }
      let plantId = null, speciesId = null, base;
      if (body.kind === "plant") {
        const row = await ownedPlant(c, targetId, req.user, true);
        if (row.rbac_status !== "Approved") fail(409, "Pending plants must be edited directly.");
        if (proposal.species_id !== String(row.species_id)) await speciesRow(c, proposal.species_id, req.user);
        plantId = row.plant_id;
        base = await approvedPlantSnapshot(c, row);
        if (proposal.photo_ids !== undefined || proposal.photos !== undefined) {
          const retained = proposal.photo_ids || [];
          if (retained.some((photoId) => !base.photo_ids.includes(photoId)) ||
            retained.length + (proposal.photos?.length || 0) < 3 ||
            retained.length + (proposal.photos?.length || 0) > 8)
            fail(409, "Plant photos changed or the proposed photo count is invalid. Reload before saving.");
        }
        if (proposal.qr_id !== undefined && String(proposal.qr_id) !== String(base.qr_id)) {
          if (!(await c.query("SELECT qr_id FROM public.qr_code WHERE qr_id=$1 AND plant_id IS NULL AND status='generated'",
            [proposal.qr_id])).rows.length) fail(409, "Selected QR code is no longer available. Refresh the QR list.");
        }
      } else {
        const row = await ownedSpeciesRequest(c, targetId, req.user, true);
        if (row.request_status !== "Approved" || !row.approved_species_id)
          fail(409, "Pending species requests must be edited directly.");
        speciesId = row.approved_species_id;
        base = { request_id: row.request_id, species_id: speciesId, ...speciesSnapshot(row),
          photo_fingerprint: createHash("sha256").update(row.photo).digest("hex"),
          species_version: await speciesVersion(c, speciesId) };
      }
      if ((await c.query(`SELECT id FROM record_change_submission WHERE status='Pending Review' AND ${plantId ? "plant_id" : "species_id"}=$1`,
        [plantId || speciesId])).rows.length) fail(409, "Changes are already pending review for this record.");
      const changeId = randomUUID();
      await c.query("INSERT INTO record_change_submission(id,plant_id,species_id,owner_subject,base_snapshot,proposed_snapshot,base_fingerprint,client_key,payload_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [changeId, plantId, speciesId, subject(req.user), base, proposal, digest(base), clientKey, payloadHash]);
      if (plantId) {
        const proposedQr = proposal.qr_id === undefined || String(proposal.qr_id) === String(base.qr_id)
          ? base.qr_token : (await c.query("SELECT qr_code FROM public.qr_code WHERE qr_id=$1", [proposal.qr_id])).rows[0]?.qr_code;
        const original = (await c.query("SELECT registered_at FROM plant_record WHERE plant_id=$1", [plantId])).rows[0];
        await appendVersion(c, { kind: "plant", targetId: plantId, owner: subject(req.user), editor: subject(req.user),
          base, baseStatus: "Approved", proposed: plantProposedSnapshot(base, proposal, changeId, proposedQr),
          changeId, baselineAt: original.registered_at,
          baselineReview: await plantReview(c, base.observation_id) });
      } else {
        const original = (await c.query("SELECT photo,submitted_at,reviewed_by,reviewed_at,review_comment FROM species_request_submission WHERE request_id=$1", [base.request_id])).rows[0];
        await appendVersion(c, { kind: "species", targetId: base.request_id, owner: subject(req.user), editor: subject(req.user),
          base, baseStatus: "Approved", basePhoto: original.photo,
          proposed: { ...base, ...speciesSnapshot(proposal) },
          proposedPhoto: proposal.photo ? Buffer.from(proposal.photo.base64, "base64") : original.photo,
          changeId, baselineAt: original.submitted_at, baselineReview: original });
      }
      await audit(c, req.user, "record_change_submitted", changeId);
      return { id: changeId, status: "Pending Review" };
    });
    res.status(201).json({ change: result });
  });

  const read = (req, res, next) => allow(permitted(req.user, "species.manage") ? "species.manage" : "plants.create")(req, res, next);
  app.get("/api/record-changes", read, async (req, res) => {
    const officer = permitted(req.user, "species.manage");
    const rows = (await pool.query("SELECT id,plant_id,species_id,owner_subject,status,revision,base_snapshot,proposed_snapshot - 'photos' - 'photo' AS proposed_snapshot,CASE WHEN jsonb_typeof(proposed_snapshot->'photos')='array' THEN jsonb_array_length(proposed_snapshot->'photos') WHEN proposed_snapshot ? 'photo' THEN 1 ELSE 0 END AS proposal_photo_count,review_comment,reviewed_by,reviewed_at,created_at FROM record_change_submission WHERE ($1 OR owner_subject=$2) ORDER BY created_at DESC LIMIT 500",
      [officer, subject(req.user)])).rows;
    res.json({ changes: rows });
  });
  app.get("/api/record-changes/:id", read, async (req, res) => {
    const row = (await pool.query("SELECT id,plant_id,species_id,owner_subject,status,revision,base_snapshot,proposed_snapshot - 'photos' - 'photo' AS proposed_snapshot,CASE WHEN jsonb_typeof(proposed_snapshot->'photos')='array' THEN jsonb_array_length(proposed_snapshot->'photos') WHEN proposed_snapshot ? 'photo' THEN 1 ELSE 0 END AS proposal_photo_count,review_comment,reviewed_by,reviewed_at,created_at FROM record_change_submission WHERE id=$1 AND ($2 OR owner_subject=$3)",
      [req.params.id, permitted(req.user, "species.manage"), subject(req.user)])).rows[0];
    if (!row) fail(404, "Change submission unavailable.");
    res.json({ change: row });
  });

  app.get("/api/record-changes/:id/photos/:index", read, async (req, res) => {
    if (!/^(0|[1-7])$/.test(req.params.index)) fail(400, "Invalid photo index.");
    const row = (await pool.query("SELECT proposed_snapshot FROM record_change_submission WHERE id=$1 AND ($2 OR owner_subject=$3)",
      [req.params.id, permitted(req.user, "species.manage"), subject(req.user)])).rows[0];
    if (!row) fail(404, "Change submission unavailable.");
    const photo = row.proposed_snapshot.photos?.[Number(req.params.index)] ||
      (req.params.index === "0" ? row.proposed_snapshot.photo : null);
    if (!photo?.base64) fail(404, "Photo unavailable.");
    res.type("image/jpeg").send(Buffer.from(photo.base64, "base64"));
  });

  app.post("/api/record-changes/:id/review", allow("species.manage"), async (req, res) => {
    if (!req.body || !["Approved", "Rejected"].includes(req.body.decision) ||
      Object.keys(req.body).some((key) => !["decision", "comment"].includes(key))) fail(400, "Invalid review decision.");
    const comment = text(req.body.comment);
    const result = await transaction(pool, async (c) => {
      const change = (await c.query("SELECT * FROM record_change_submission WHERE id=$1 FOR UPDATE", [req.params.id])).rows[0];
      if (!change) fail(404, "Change submission unavailable.");
      if (change.status !== "Pending Review") fail(409, "This submission was already reviewed.");
      if (change.owner_subject === subject(req.user)) fail(403, "You cannot review your own changes.");
      if (req.body.decision === "Approved") {
        if (change.plant_id) {
          const plant = (await c.query("SELECT * FROM plant_record WHERE plant_id=$1 FOR UPDATE", [change.plant_id])).rows[0];
          if (!plant || plant.rbac_status !== "Approved") fail(409, "Approved plant has changed.");
          const base = await approvedPlantSnapshot(c, plant);
          if (digest(base) !== change.base_fingerprint) fail(409, "Approved plant changed since this proposal. Review a fresh version.");
          const proposal = change.proposed_snapshot;
          await speciesRow(c, proposal.species_id, req.user);
          await c.query("UPDATE plant_record SET species_id=$1,scientific_name=$2 WHERE plant_id=$3",
            [proposal.species_id, proposal.scientific_name, plant.plant_id]);
          await applyQrChange(c, plant, proposal.qr_id);
          await c.query("UPDATE plant_observation SET content=$1,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=$2",
            [{ ...base.content, ...proposal.content }, base.observation_id]);
          await c.query("INSERT INTO plant_location(plant_id,latitude,longitude,accuracy_m) VALUES($1,$2,$3,$4)",
            [plant.plant_id, proposal.content.latitude, proposal.content.longitude, proposal.content.accuracy_m ?? null]);
          await applyPlantPhotos(c, { plantId: plant.plant_id, observationId: base.observation_id, owner: change.owner_subject,
            approved: true, proposal, keyPrefix: `approved-edit:${change.id}` });
        } else {
          const request = (await c.query("SELECT * FROM species_request_submission WHERE approved_species_id=$1 AND owner_subject=$2 AND request_status='Approved' FOR UPDATE",
            [change.species_id, change.owner_subject])).rows[0];
          if (!request || digest({ request_id: request.request_id, species_id: change.species_id, ...speciesSnapshot(request),
            photo_fingerprint: createHash("sha256").update(request.photo).digest("hex"),
            species_version: await speciesVersion(c, change.species_id) }) !== change.base_fingerprint)
            fail(409, "Approved species changed since this proposal. Review a fresh version.");
          const proposal = change.proposed_snapshot;
          await uniqueName(c, proposal.scientific_name, change.species_id);
          const refs = await taxonomy(c, proposal);
          await c.query("UPDATE species SET scientific_name=$1,common_name=$2,genus_id=$3,status_id=$4,description=$5,rbac_data=rbac_data || $6::jsonb WHERE species_id=$7",
            [proposal.scientific_name, proposal.common_name, refs.genusId, refs.statusId, proposal.description, { habitat: proposal.habitat }, change.species_id]);
          const values = speciesFields.map((field) => proposal[field]);
          await c.query(`UPDATE species_request_submission SET ${speciesFields.map((field, index) => `${field}=$${index + 1}`).join(",")},photo=COALESCE($8,photo) WHERE request_id=$9`,
            [...values, proposal.photo ? Buffer.from(proposal.photo.base64, "base64") : null, request.request_id]);
          if (proposal.photo) {
            await c.query("UPDATE plant_asset SET approved=FALSE WHERE species_id=$1", [change.species_id]);
            await c.query("INSERT INTO plant_asset(id,species_id,owner_subject,client_key,approved,content_type,content) VALUES($1,$2,$3,$4,TRUE,'image/jpeg',$5)",
              [randomUUID(), change.species_id, change.owner_subject, `approved-edit:${change.id}:species-photo`, Buffer.from(proposal.photo.base64, "base64")]);
          }
        }
      }
      await c.query("UPDATE record_change_submission SET status=$1,review_comment=$2,reviewed_by=$3,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$4",
        [req.body.decision, comment, subject(req.user), change.id]);
      if (await historyAvailable(c)) await c.query("UPDATE record_version_history SET status=$1,review_comment=$2,reviewed_by=$3,reviewed_at=CURRENT_TIMESTAMP WHERE change_id=$4",
        [req.body.decision, comment, subject(req.user), change.id]);
      await audit(c, req.user, `record_change_${req.body.decision.toLowerCase()}`, change.id);
      return { id: change.id, status: req.body.decision };
    });
    res.json({ change: result });
  });
}

module.exports = { mountRecordChanges };
