"use strict";
const { resolvePlantRegistration } = require("./plant-registration.cjs");
const { canCancelEdit, canModifyOriginalSpecies, canModifyPendingObservation } = require("./status-permissions.cjs");
const { randomUUID, createHash } = require("node:crypto");
const sharp = require("sharp");
const { permitted, visibilityFor } = require("../shared/rbac.cjs");
const { transaction, audit, subject, fail, text, id, fieldContent, speciesRow } = require("./domain.cjs");
const { requireVersionHistory, historyRevisionAvailable, appendVersion, plantPhotoRefs, plantProposedSnapshot } = require("./record-version-history.cjs");
const { classifyObservations } = require("./observation-origin.cjs");
const { replaceRequestPhoto } = require("./species-photo-provenance.cjs");
const { assertSpeciesReassignment } = require("./species-requests.cjs");
const { assertQrAssignmentAllowed, normalizeQrPlantSchema } = require("./qr-plant-mode.cjs");

const { requireReviewCycle } = require("./species-review-cycle.cjs");
const { finalRejection } = require("./final-rejection.cjs");
const speciesFields = ["scientific_name", "common_name", "genus_name", "family_name", "conservation_status", "description", "habitat"];
const initialObservationWorkflow = "initial_registration_observation_edit";
const observationPhotoId = (value) => typeof value === "string" && /^[A-Za-z0-9:_-]{1,100}$/.test(value);
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
async function approvedPlantSnapshot(c, row, qrPlantSchema) {
  const registration = await resolvePlantRegistration(c, row.plant_id);
  if (registration.state !== "available") fail(409, "Current approved Plant registration cannot be verified. No changes were saved.");
  if (registration.observation_id !== registration.registration_observation_id)
    fail(409, "This legacy Plant edit targeted a separate Observation. Registration reconciliation is required before further editing.");
  const observation = { id: registration.observation_id, revision: registration.observation_revision, content: registration.content };
  const photoIds = registration.photo_ids;
  const qr = (await c.query("SELECT qr_id FROM plant_app.qr_code WHERE plant_id=$1 AND qr_code=$2", [row.plant_id, row.qr_token])).rows[0];
  return { plant_id: row.plant_id, species_id: row.species_id, scientific_name: row.scientific_name,
    qr_token: row.qr_token, qr_id: qr?.qr_id ?? null,
    observation_id: observation.id, observation_revision: observation.revision, photo_ids: photoIds,
    photo_refs: plantPhotoRefs(photoIds), content: observation.content };
}
async function pendingPlantSnapshot(c, row, observation, qrPlantSchema) {
  const photoIds = await currentPhotoIds(c, observation.id, false);
  const qr = (await c.query("SELECT qr_id FROM plant_app.qr_code WHERE plant_id=$1 AND qr_code=$2", [row.plant_id, row.qr_token])).rows[0];
  return { plant_id: row.plant_id, species_id: row.species_id, scientific_name: row.scientific_name,
    qr_token: row.qr_token, qr_id: qr?.qr_id ?? null, observation_id: observation.id,
    observation_revision: observation.revision, photo_ids: photoIds, photo_refs: plantPhotoRefs(photoIds), content: observation.content };
}
async function plantReview(c, observationId) {
  return (await c.query(`SELECT reviewer_subject AS reviewed_by,created_at AS reviewed_at,comment AS review_comment
    FROM observation_review WHERE observation_id=$1 ORDER BY created_at DESC LIMIT 1`, [observationId])).rows[0] || null;
}
async function applyQrChange(c, plant, qrId, qrPlantSchema) {
  if (qrId === undefined) return;
  assertQrAssignmentAllowed(qrPlantSchema);
  const current = (await c.query("SELECT qr_id FROM plant_app.qr_code WHERE plant_id=$1 AND qr_code=$2 FOR UPDATE",
    [plant.plant_id, plant.qr_token])).rows[0];
  if (current && String(current.qr_id) === String(qrId)) return;
  const next = (await c.query("SELECT qr_id,qr_code FROM plant_app.qr_code WHERE qr_id=$1 AND plant_id IS NULL AND status='generated' FOR UPDATE",
    [qrId])).rows[0];
  if (!next) fail(409, "Selected QR code is no longer available. Refresh the QR list.");
  if ((await c.query("SELECT plant_id FROM plant_record WHERE qr_token=$1 AND plant_id<>$2", [next.qr_code, plant.plant_id])).rows.length)
    fail(409, "Selected QR code is already used by another plant.");
  if (current) await c.query("UPDATE plant_app.qr_code SET plant_id=NULL,status='retired',retired_at=CURRENT_TIMESTAMP WHERE qr_id=$1", [current.qr_id]);
  await c.query("UPDATE plant_app.qr_code SET plant_id=$1,status=$2,assigned_at=CURRENT_TIMESTAMP,activated_at=CASE WHEN $2='active' THEN CURRENT_TIMESTAMP ELSE NULL END,retired_at=NULL WHERE qr_id=$3",
    [plant.plant_id, plant.rbac_status === "Approved" ? "active" : "assigned", next.qr_id]);
  await c.query("UPDATE plant_record SET qr_token=$1 WHERE plant_id=$2", [next.qr_code, plant.plant_id]);
}
async function currentPhotoIds(c, observationId, approved) {
  return (await c.query("SELECT id FROM plant_asset WHERE observation_id=$1 AND approved=$2 AND content_type='image/jpeg' ORDER BY created_at,id",
    [observationId, approved])).rows.map((row) => row.id);
}
function isInitialObservationChange(change) {
  return change?.base_snapshot?.workflow_type === initialObservationWorkflow &&
    typeof change.base_snapshot.observation_id === "string" && Boolean(change.plant_id);
}
function hasInitialObservationMarker(change) {
  return change?.base_snapshot?.workflow_type === initialObservationWorkflow;
}
async function prepareInitialObservationProposal(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some(key => !["content", "photo_ids", "photos"].includes(key)))
    fail(400, "Initial Observation edits may change only Observation fields and photos.");
  const content = fieldContent({ ...(input.content || {}) });
  const photoIds = input.photo_ids;
  if (photoIds !== undefined && (!Array.isArray(photoIds) || photoIds.length > 3 ||
      new Set(photoIds).size !== photoIds.length || photoIds.some(value => !observationPhotoId(value))))
    fail(400, "Invalid retained Observation photos.");
  if (input.photos !== undefined && (!Array.isArray(input.photos) || input.photos.length > 3))
    fail(400, "Too many Observation photos.");
  const photos = [];
  for (const photo of input.photos || []) photos.push({ content_type: "image/jpeg", base64: (await photoBytes(photo)).toString("base64") });
  return { content, photoIds, photos };
}
async function initialObservationBase(c, plant, observation) {
  if (!plant || plant.rbac_status !== "Approved" || !observation || observation.status !== "Approved" ||
      observation.plant_id !== plant.plant_id || observation.owner_subject !== plant.registered_subject)
    fail(409, "The selected initial Observation is no longer an Approved Plant record.");
  const origin = (await classifyObservations(c, [observation]))[0]?.origin_type;
  if (origin !== "initial_registration")
    fail(409, "The initial Observation origin cannot be verified from its registration receipt.");
  const qr = (await c.query("SELECT qr_id FROM plant_app.qr_code WHERE plant_id=$1 AND qr_code=$2", [plant.plant_id, plant.qr_token])).rows[0];
  if (!qr) fail(409, "The Plant QR assignment is unavailable.");
  const photoIds = (await c.query(`SELECT id FROM plant_asset WHERE observation_id=$1 AND plant_id=$2
    AND owner_subject=$3 AND approved=TRUE AND content_type IN ('image/jpeg','image/png')
    ORDER BY created_at,id`, [observation.id, plant.plant_id, observation.owner_subject])).rows.map(row => row.id);
  return { workflow_type: initialObservationWorkflow, plant_id: plant.plant_id, species_id: plant.species_id,
    scientific_name: plant.scientific_name, qr_token: plant.qr_token, qr_id: qr.qr_id,
    observation_id: observation.id, observation_origin: "initial_registration", observation_revision: observation.revision,
    content: observation.content, photo_ids: photoIds, photo_refs: plantPhotoRefs(photoIds) };
}
function initialObservationSnapshots(base, proposal, retainedIds, stagedAssets) {
  const stagedIds = stagedAssets.map(asset => asset.id);
  const allIds = [...retainedIds, ...stagedIds];
  const content = { ...base.content, ...proposal.content };
  return {
    request: { ...base, content, photo_ids: retainedIds, staged_photo_ids: stagedIds,
      photos: proposal.photos, photo_refs: plantPhotoRefs(allIds) },
    version: { ...base, content, photo_ids: allIds, photo_refs: plantPhotoRefs(allIds) },
    assetIds: allIds,
  };
}
function initialObservationStagedAssets(changeId, revision, photos) {
  return photos.map((photo, index) => ({ id: randomUUID(),
    clientKey: `initial-observation-edit:${changeId}:${revision}:${index}`, content: Buffer.from(photo.base64, "base64") }));
}
async function lockedInitialObservation(c, { plantId, observationId, user, ownerOnly = true }) {
  const plant = ownerOnly
    ? await ownedPlant(c, plantId, user, true)
    : (await c.query("SELECT p.*,s.rbac_data AS species_data FROM plant_record p JOIN species s ON s.species_id=p.species_id WHERE p.plant_id=$1 FOR UPDATE OF p", [plantId])).rows[0];
  if (!plant) fail(404, "Plant record unavailable.");
  const observation = (await c.query("SELECT * FROM plant_observation WHERE id=$1 AND plant_id=$2 FOR UPDATE",
    [observationId, plant.plant_id])).rows[0];
  if (!observation) fail(404, "Initial Observation unavailable.");
  if (!ownerOnly && observation.owner_subject !== plant.registered_subject)
    fail(409, "The selected Observation is not the Plant's registered Observation.");
  const base = await initialObservationBase(c, plant, observation);
  return { plant, observation, base };
}
async function readInitialChange(pool, changeId) {
  const change = (await pool.query(`SELECT id,plant_id,owner_subject,status,revision,base_snapshot
    FROM record_change_submission WHERE id=$1`, [changeId])).rows[0];
  if (hasInitialObservationMarker(change) && !isInitialObservationChange(change))
    fail(409, "The initial Observation change target is incomplete.");
  if (!isInitialObservationChange(change)) fail(404, "Initial Observation change unavailable.");
  return change;
}
async function lockInitialChange(c, coordinates, user, ownerOnly = true) {
  const locked = await lockedInitialObservation(c, { plantId: coordinates.plant_id,
    observationId: coordinates.base_snapshot.observation_id, user, ownerOnly });
  const change = (await c.query("SELECT * FROM record_change_submission WHERE id=$1 FOR UPDATE", [coordinates.id])).rows[0];
  if (!isInitialObservationChange(change) || change.plant_id !== locked.plant.plant_id ||
      change.base_snapshot.observation_id !== locked.observation.id || change.owner_subject !== locked.observation.owner_subject)
    fail(409, "The initial Observation change target has changed.");
  if (digest(locked.base) !== change.base_fingerprint)
    fail(409, "The Approved initial Observation changed. Reload before continuing.");
  return { ...locked, change };
}
function requireInitialChangePermission(user, permission) {
  if (!permitted(user, permission)) fail(403, "You are not allowed to manage this Observation change.");
}
function validateInitialPhotoSelection(base, photoIds, photos) {
  const retained = photoIds === undefined ? base.photo_ids : photoIds;
  if (retained.some(id => !base.photo_ids.includes(id)) || retained.length + photos.length > 3)
    fail(409, "Observation photos changed. Reload before editing.");
  return retained;
}
async function submitInitialObservationEdit(pool, input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some(key => !["user", "plantId", "observationId", "clientKey", "content", "photo_ids", "photos"].includes(key)))
    fail(400, "Initial Observation edits may change only Observation fields and photos.");
  const { user, plantId, observationId, clientKey, content, photo_ids, photos } = input;
  requireInitialChangePermission(user, "observations.create");
  const prepared = await prepareInitialObservationProposal({ content, photo_ids, photos });
  const keyValue = text(clientKey, 100);
  if (!keyValue) fail(400, "An Observation edit key is required.");
  const targetPlantId = numericId(plantId);
  const targetObservationId = text(observationId, 100);
  const payloadHash = digest({ workflow_type: initialObservationWorkflow, plantId: targetPlantId,
    observationId: targetObservationId, proposal: prepared });
  return transaction(pool, async c => {
    const { plant, observation, base } = await lockedInitialObservation(c,
      { plantId: targetPlantId, observationId: targetObservationId, user });
    const prior = (await c.query(`SELECT id,payload_hash,status,revision FROM record_change_submission
      WHERE owner_subject=$1 AND client_key=$2`, [subject(user), keyValue])).rows[0];
    if (prior) {
      if (prior.payload_hash !== payloadHash || prior.status !== "Pending Review")
        fail(409, "This submission key belongs to another or closed change.");
      const verified = await c.query(`SELECT 1 FROM record_change_submission c
        JOIN record_version_history v ON v.change_id=c.id AND v.change_revision=c.revision
        WHERE c.id=$1 AND c.plant_id=$2 AND c.base_snapshot->>'observation_id'=$3
          AND c.base_snapshot->>'workflow_type'=$4 AND v.record_type='plant'
          AND v.status='Pending Review' AND v.snapshot->>'observation_id'=$3
          AND v.snapshot->'content'=c.proposed_snapshot->'content'
          AND v.snapshot->'photo_refs'=c.proposed_snapshot->'photo_refs'`,
      [prior.id, plant.plant_id, observation.id, initialObservationWorkflow]);
      if (!verified.rowCount) fail(409, "The existing submission state cannot be verified. Reload before retrying.");
      return { id: prior.id, status: prior.status, revision: prior.revision, plant_id: plant.plant_id,
        observation_id: observation.id };
    }
    if ((await c.query(`SELECT id FROM record_change_submission WHERE plant_id=$1
      AND status IN ('Pending Review','Correction Required')`, [plant.plant_id])).rows.length)
      fail(409, "Changes are already pending review for this Plant.");
    const retainedIds = validateInitialPhotoSelection(base, prepared.photoIds, prepared.photos);
    const changeId = randomUUID();
    const stagedAssets = initialObservationStagedAssets(changeId, 1, prepared.photos);
    const snapshots = initialObservationSnapshots(base, prepared, retainedIds, stagedAssets);
    await c.query(`INSERT INTO record_change_submission(id,plant_id,owner_subject,base_snapshot,proposed_snapshot,
      base_fingerprint,client_key,payload_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [changeId, plant.plant_id, subject(user), base, snapshots.request, digest(base), keyValue, payloadHash]);
    await appendVersion(c, { kind: "plant", targetId: plant.plant_id, owner: subject(user), editor: subject(user),
      base, proposed: snapshots.version, changeId, changeRevision: 1,
      plantPhotoSet: { plantId: plant.plant_id, observationId: observation.id, assetIds: snapshots.assetIds, stagedAssets } });
    await audit(c, user, "record_change_submitted", changeId);
    return { id: changeId, status: "Pending Review", revision: 1, plant_id: plant.plant_id,
      observation_id: observation.id };
  });
}
async function resubmitInitialObservationEdit(pool, input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some(key => !["user", "changeId", "revision", "content", "photo_ids", "photos"].includes(key)))
    fail(400, "Initial Observation corrections may change only Observation fields and photos.");
  const { user, changeId, revision, content, photo_ids, photos } = input;
  requireInitialChangePermission(user, "observations.create");
  if (!Number.isInteger(revision) || revision < 1) fail(400, "Correction revision is required.");
  const coordinates = await readInitialChange(pool, changeId);
  const prepared = await prepareInitialObservationProposal({ content, photo_ids, photos });
  return transaction(pool, async c => {
    const { plant, observation, base, change } = await lockInitialChange(c, coordinates, user, true);
    if (change.owner_subject !== subject(user)) fail(404, "Owned initial Observation change unavailable.");
    if (change.status !== "Correction Required" || change.revision !== revision)
      fail(409, "Reload this correction request before resubmitting.");
    let retainedInput = prepared.photoIds, photoInput = prepared.photos;
    if (retainedInput === undefined && photos === undefined) {
      retainedInput = change.proposed_snapshot.photo_ids;
      photoInput = change.proposed_snapshot.photos || [];
    }
    const retainedIds = validateInitialPhotoSelection(base, retainedInput, photoInput);
    const nextRevision = change.revision + 1;
    const stagedAssets = initialObservationStagedAssets(change.id, nextRevision, photoInput);
    const snapshots = initialObservationSnapshots(base, { ...prepared, photos: photoInput }, retainedIds, stagedAssets);
    const payloadHash = digest({ workflow_type: initialObservationWorkflow, plantId: plant.plant_id,
      observationId: observation.id, revision: nextRevision, proposal: snapshots.request });
    const row = (await c.query(`UPDATE record_change_submission SET proposed_snapshot=$1,payload_hash=$2,revision=$3,
      status='Pending Review',reviewed_by=NULL,reviewed_at=NULL,review_comment=NULL,cancelled_by=NULL,cancelled_at=NULL,
      updated_at=CURRENT_TIMESTAMP WHERE id=$4 RETURNING id,status,revision,review_comment,updated_at`,
    [snapshots.request, payloadHash, nextRevision, change.id])).rows[0];
    await appendVersion(c, { kind: "plant", targetId: plant.plant_id, owner: change.owner_subject, editor: change.owner_subject,
      base: change.base_snapshot, proposed: snapshots.version, changeId: change.id, changeRevision: nextRevision,
      plantPhotoSet: { plantId: plant.plant_id, observationId: observation.id, assetIds: snapshots.assetIds, stagedAssets } });
    await audit(c, user, "record_change_resubmitted", change.id);
    return { ...row, plant_id: plant.plant_id, observation_id: observation.id };
  });
}
async function cancelInitialObservationEdit(pool, { user, changeId }) {
  requireInitialChangePermission(user, "observations.create");
  const coordinates = await readInitialChange(pool, changeId);
  return transaction(pool, async c => {
    const { plant, observation, change } = await lockInitialChange(c, coordinates, user, true);
    if (change.owner_subject !== subject(user)) fail(404, "Owned initial Observation change unavailable.");
    if (!canCancelEdit(change.status, change.revision)) fail(409, "Only an eligible initial Observation edit can be cancelled.");
    const version = (await c.query(`SELECT id,status FROM record_version_history
      WHERE change_id=$1 AND change_revision=$2 AND plant_id=$3 AND status IN ('Pending Review','Correction Required') FOR UPDATE`,
    [change.id, change.revision, plant.plant_id])).rows[0];
    if (!version) fail(409, "The exact initial Observation edit version is unavailable.");
    const row = (await c.query(`UPDATE record_change_submission SET status='Cancelled',cancelled_by=$1,
      cancelled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$2
      RETURNING id,status,revision,cancelled_at`, [subject(user), change.id])).rows[0];
    await c.query("UPDATE record_version_history SET status='Cancelled' WHERE id=$1", [version.id]);
    await audit(c, user, "record_change_cancelled", change.id);
    return { ...row, plant_id: plant.plant_id, observation_id: observation.id };
  });
}
async function reviewInitialObservationEdit(pool, { user, changeId, revision, decision, comment = "" }) {
  requireInitialChangePermission(user, "observations.review");
  if (!Number.isInteger(revision) || revision < 1 || !["Approved", "Rejected", "Correction Required"].includes(decision))
    fail(400, "Invalid initial Observation review decision.");
  const feedback = text(comment);
  if (decision === "Correction Required" && !feedback) fail(400, "Correction feedback is required.");
  const coordinates = await readInitialChange(pool, changeId);
  return transaction(pool, async c => {
    const { plant, observation, base, change } = await lockInitialChange(c, coordinates, user, false);
    if (change.status !== "Pending Review" || change.revision !== revision)
      fail(409, "This is not the current pending Observation edit revision.");
    if (change.owner_subject === subject(user)) fail(403, "You cannot review your own changes.");
    await requireVersionHistory(c, { revisions: true });
    if (!(await recordChangeReviewEventsAvailable(c))) fail(503, "Exact Plant change review history is unavailable.");
    if (decision === "Correction Required" && !(await recordChangeCorrectionNotificationsAvailable(c)))
      fail(503, "Plant and Species edit correction notifications require migration 023.");
    const version = (await c.query(`SELECT * FROM record_version_history WHERE change_id=$1 AND change_revision=$2
      AND plant_id=$3 AND record_type='plant' AND status='Pending Review' FOR UPDATE`,
    [change.id, change.revision, plant.plant_id])).rows[0];
    if (!version || version.snapshot.workflow_type !== initialObservationWorkflow ||
        version.snapshot.observation_id !== observation.id || version.snapshot.observation_origin !== "initial_registration" ||
        version.photo_refs_sealed !== true)
      fail(409, "The exact sealed initial Observation version is unavailable.");
    const links = (await c.query(`SELECT position,asset_id FROM plant_record_version_photo
      WHERE version_id=$1 ORDER BY position`, [version.id])).rows;
    const selectedIds = version.snapshot.photo_ids || [];
    if (links.length !== selectedIds.length || links.some((link, index) => link.position !== index || link.asset_id !== selectedIds[index]) ||
        JSON.stringify(version.snapshot.photo_refs) !== JSON.stringify(plantPhotoRefs(selectedIds)) ||
        JSON.stringify(change.proposed_snapshot.photo_refs) !== JSON.stringify(version.snapshot.photo_refs) ||
        JSON.stringify(change.proposed_snapshot.content) !== JSON.stringify(version.snapshot.content))
      fail(409, "The selected photo or Observation snapshot no longer matches this revision.");
    const reviewEvent = (await c.query(`INSERT INTO record_change_review_event
      (id,change_id,revision,status,reviewer_subject,comment,created_at)
      VALUES($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP) RETURNING created_at`,
    [randomUUID(), change.id, change.revision, decision, subject(user), feedback || null])).rows[0];
    await c.query(`UPDATE record_change_submission SET status=$1,review_comment=$2,reviewed_by=$3,
      reviewed_at=(SELECT created_at FROM record_change_review_event WHERE change_id=$4 AND revision=$5),
      updated_at=CURRENT_TIMESTAMP WHERE id=$4`, [decision, feedback || null, subject(user), change.id, change.revision]);
    if (decision === "Approved") {
      const currentPlantVersions = (await c.query(`SELECT id FROM record_version_history
        WHERE plant_id=$1 AND record_type='plant' AND status='Approved' ORDER BY version_number DESC FOR UPDATE`,
      [plant.plant_id])).rows;
      if (currentPlantVersions.length > 1)
        fail(409, "Plant version history has more than one current Approved version; review is blocked for reconciliation.");
      if (currentPlantVersions.length === 1)
        await c.query("UPDATE record_version_history SET status='Superseded' WHERE id=$1 AND status='Approved'", [currentPlantVersions[0].id]);
    }
    const transitioned = await c.query(`UPDATE record_version_history SET status=$1,review_comment=$2,reviewed_by=$3,
      reviewed_at=(SELECT created_at FROM record_change_review_event WHERE change_id=$4 AND revision=$5)
      WHERE id=$6 AND change_id=$4 AND change_revision=$5 AND status='Pending Review'`,
    [decision, feedback || null, subject(user), change.id, change.revision, version.id]);
    if (!transitioned.rowCount) fail(409, "The exact pending initial Observation version is unavailable.");
    if (decision === "Approved") {
      const retainedIds = change.proposed_snapshot.photo_ids || [];
      const stagedIds = change.proposed_snapshot.staged_photo_ids || [];
      const expectedIds = [...retainedIds, ...stagedIds];
      if (JSON.stringify(expectedIds) !== JSON.stringify(selectedIds) || new Set(expectedIds).size !== expectedIds.length)
        fail(409, "The proposed Observation photo selection is invalid.");
      const lockIds = [...new Set([...base.photo_ids, ...selectedIds])].sort();
      const assets = (await c.query(`SELECT id,plant_id,owner_subject,observation_id,approved,content_type
        FROM plant_asset WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE`, [lockIds])).rows;
      const assetsById = new Map(assets.map(asset => [asset.id, asset]));
      if (assets.length !== lockIds.length || base.photo_ids.some(assetId => {
        const asset = assetsById.get(assetId);
        return !asset || asset.plant_id !== plant.plant_id || asset.owner_subject !== change.owner_subject ||
          asset.observation_id !== observation.id || asset.approved !== true || !["image/jpeg", "image/png"].includes(asset.content_type);
      }) || stagedIds.some(assetId => {
        const asset = assetsById.get(assetId);
        return !asset || asset.plant_id !== plant.plant_id || asset.owner_subject !== change.owner_subject ||
          asset.observation_id !== null || asset.approved !== false || asset.content_type !== "image/jpeg";
      })) fail(409, "The selected historical photo assets changed before approval.");
      const removed = base.photo_ids.filter(assetId => !retainedIds.includes(assetId));
      if (removed.length) await c.query("UPDATE plant_asset SET observation_id=NULL,approved=FALSE WHERE id=ANY($1::text[])", [removed]);
      if (stagedIds.length) {
        const attached = await c.query(`UPDATE plant_asset SET observation_id=$1,approved=TRUE
          WHERE id=ANY($2::text[]) AND plant_id=$3 AND owner_subject=$4 AND observation_id IS NULL AND approved=FALSE`,
        [observation.id, stagedIds, plant.plant_id, change.owner_subject]);
        if (attached.rowCount !== stagedIds.length) fail(409, "A staged Observation photo could not be attached safely.");
      }
      await c.query(`UPDATE plant_observation SET content=$1,revision=revision+1,updated_at=CURRENT_TIMESTAMP
        WHERE id=$2 AND plant_id=$3 AND owner_subject=$4 AND status='Approved' AND revision=$5`,
      [version.snapshot.content, observation.id, plant.plant_id, change.owner_subject, observation.revision]);
      if (Number.isFinite(version.snapshot.content.latitude) && Number.isFinite(version.snapshot.content.longitude))
        await c.query("INSERT INTO plant_location(plant_id,latitude,longitude,accuracy_m) VALUES($1,$2,$3,$4)",
          [plant.plant_id, version.snapshot.content.latitude, version.snapshot.content.longitude,
            version.snapshot.content.accuracy_m ?? null]);
    } else if (decision === "Correction Required") {
      const metadata = { entityType: "record_change", changeId: change.id, recordKind: "plant",
        targetId: String(plant.plant_id), revision: change.revision };
      await c.query(`INSERT INTO botanist_notification(id,recipient_subject,type,source_key,plant_id,metadata)
        VALUES($1,$2,'record_change_correction',$3,$4,$5::jsonb) ON CONFLICT(recipient_subject,source_key) DO NOTHING`,
      [randomUUID(), change.owner_subject, `record-change-correction:${change.id}:${change.revision}`, plant.plant_id, metadata]);
    }
    await audit(c, user, `record_change_${decision.toLowerCase().replace(" ", "_")}`, change.id);
    return { id: change.id, status: decision, revision: change.revision, reviewed_at: reviewEvent.created_at,
      plant_id: plant.plant_id, observation_id: observation.id };
  });
}
async function recordChangeCorrectionNotificationsAvailable(c) {
  return Boolean((await c.query("SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass(current_schema() || '.botanist_notification') AND conname='botanist_notification_type_check' AND pg_get_constraintdef(oid) LIKE '%record_change_correction%') AS available")).rows[0]?.available);
}
async function recordChangeReviewEventsAvailable(c) {
  return Boolean((await c.query("SELECT to_regclass(current_schema() || '.record_change_review_event') IS NOT NULL AS available")).rows[0]?.available);
}
async function currentChangeBase(c, change) {
  if (change.plant_id) {
    const plant = (await c.query("SELECT * FROM plant_record WHERE plant_id=$1 FOR UPDATE", [change.plant_id])).rows[0];
    if (!plant || plant.rbac_status !== "Approved") fail(409, "Approved plant has changed.");
    const base = await approvedPlantSnapshot(c, plant);
    if (digest(base) !== change.base_fingerprint) fail(409, "Approved plant changed since this proposal. Start a fresh edit.");
    return { plant, base };
  }
  await c.query("SELECT species_id FROM species WHERE species_id=$1 FOR UPDATE", [change.species_id]);
  const request = (await c.query("SELECT * FROM species_request_submission WHERE approved_species_id=$1 AND owner_subject=$2 AND request_status='Approved' FOR UPDATE",
    [change.species_id, change.owner_subject])).rows[0];
  const base = request && { request_id: request.request_id, species_id: change.species_id, ...speciesSnapshot(request),
    photo_fingerprint: createHash("sha256").update(request.photo).digest("hex"),
    species_version: await speciesVersion(c, change.species_id) };
  if (!request || digest(base) !== change.base_fingerprint) fail(409, "Approved species changed since this proposal. Start a fresh edit.");
  return { request, base };
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

function mountRecordChanges(app, { pool, allow, officerNotifications = null, qrPlantSchema = "plant_app" }) {
  qrPlantSchema = normalizeQrPlantSchema(qrPlantSchema);
  // Pending records are private. The same record and observation IDs are retained.
  app.patch("/api/my-plants/:id", allow("plants.create"), async (req, res) => {
    const { expected_revision: expectedRevision, ...edit } = req.body || {};
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) fail(400, "Current observation revision is required.");
    const proposal = await normalized(plantProposal(edit), "plant");
    const result = await transaction(pool, async (c) => {
      const plant = await ownedPlant(c, numericId(req.params.id), req.user, true);
      if (plant.rbac_status === "Rejected") finalRejection();
      if (!["Pending Review", "Correction Required"].includes(plant.rbac_status))
        fail(409, "Approved plants require a reviewed change submission.");
      const observation = (await c.query("SELECT * FROM plant_observation WHERE plant_id=$1 AND owner_subject=$2 ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE",
        [plant.plant_id, subject(req.user)])).rows[0];
      if (observation?.status === "Rejected") finalRejection();
      if (!observation || !["Pending Review", "Correction Required"].includes(observation.status))
        fail(409, "Plant observation is unavailable for correction.");
      if (observation.status === "Pending Review" &&
          !await canModifyPendingObservation(c, observation) &&
          await historyRevisionAvailable(c))
        fail(409, "This correction resubmission is awaiting Officer review and cannot be edited.");
      if (observation.revision !== expectedRevision) fail(409, "Plant changed. Reload its latest version before saving.");
      const before = await pendingPlantSnapshot(c, plant, observation, qrPlantSchema);
      if (proposal.qr_id !== undefined &&
          String(proposal.qr_id) !== String(before.qr_id))
        assertQrAssignmentAllowed(qrPlantSchema);
      if ((plant.species_data?.approvalStatus || "Approved") !== "Approved" && proposal.species_id !== String(plant.species_id))
        fail(409, "Finish the linked species request before changing this plant's species.");
      if (proposal.species_id !== String(plant.species_id)) {
        await assertSpeciesReassignment(c, plant.plant_id, plant, fail);
        await speciesRow(c, proposal.species_id, req.user);
      }
      await applyQrChange(c, plant, proposal.qr_id, qrPlantSchema);
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
        { ...observation, content: { ...observation.content, ...proposal.content }, revision: observation.revision + 1 },
        qrPlantSchema);
      await appendVersion(c, { kind: "plant", targetId: plant.plant_id, owner: subject(req.user), editor: subject(req.user),
        base: before, baseStatus: observation.status, proposed: after, baselineAt: observation.created_at,
        baselineReview: await plantReview(c, observation.id) });
      await audit(c, req.user, "pending_plant_updated", plant.plant_id);
      if (officerNotifications) await officerNotifications.enqueueCorrection(c, observation.id, observation.status, observation.revision);
      return { plant_id: plant.plant_id, observation_id: observation.id, status: "Pending Review" };
    });
    res.json(result);
  });

  app.patch("/api/my-species-requests/:id", allow("plants.create"), async (req, res) => {
    const { expected_revision: expectedRevision, ...edit } = req.body || {};
    const proposal = await normalized(speciesProposal(edit), "species");
    const result = await transaction(pool, async (c) => {
      const row = await ownedSpeciesRequest(c, numericId(req.params.id), req.user, true);
      if (row.request_status === "Rejected") finalRejection();
      if (!["Pending Review", "Correction Required"].includes(row.request_status))
        fail(409, "Approved species require a reviewed change submission.");
      await requireReviewCycle(c, fail);
      if (!Number.isSafeInteger(row.content_revision) || row.content_revision < 1)
        fail(503, "Species editing is unavailable until content revision metadata is installed.");
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || expectedRevision !== row.content_revision)
        return { version_conflict: true };
      if (!canModifyOriginalSpecies(row.request_status, row.review_cycle, row.reviewed_at)) {
        // An unchanged retry after correction is idempotent. It must not
        // advance the teammate review cycle or create another history row.
        if (row.request_status === "Pending Review" && row.review_cycle > 1 && !proposal.photo &&
          speciesFields.every(field => proposal[field] === row[field]))
          return { request_id: row.request_id, status: "Pending Review" };
        fail(409, "This correction resubmission is awaiting Officer review and cannot be edited.");
      }
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
        if (proposal.photo) await replaceRequestPhoto(c,row,row.proposed_species_id,Buffer.from(proposal.photo.base64,"base64"),false,subject(req.user));
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
    if (result.version_conflict) return res.status(409).json({
      code: "SPECIES_REQUEST_EDIT_VERSION_CONFLICT",
      error: "This species request changed. Load and inspect the latest version before saving.",
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
      const old = (await c.query("SELECT id,payload_hash,status,revision FROM record_change_submission WHERE owner_subject=$1 AND client_key=$2",
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
        base = await approvedPlantSnapshot(c, row, qrPlantSchema);
        if (proposal.qr_id !== undefined &&
            String(proposal.qr_id) !== String(base.qr_id))
          assertQrAssignmentAllowed(qrPlantSchema);
        if (proposal.photo_ids !== undefined || proposal.photos !== undefined) {
          const retained = proposal.photo_ids || [];
          if (retained.some((photoId) => !base.photo_ids.includes(photoId)) ||
            retained.length + (proposal.photos?.length || 0) < 1 ||
            retained.length + (proposal.photos?.length || 0) > 8)
            fail(409, "Plant photos changed or the proposed photo count is invalid. Reload before saving.");
        }
        if (proposal.qr_id !== undefined && String(proposal.qr_id) !== String(base.qr_id)) {
          if (!(await c.query("SELECT qr_id FROM plant_app.qr_code WHERE qr_id=$1 AND plant_id IS NULL AND status='generated'",
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
      if ((await c.query(`SELECT id FROM record_change_submission WHERE status IN ('Pending Review','Correction Required') AND ${plantId ? "plant_id" : "species_id"}=$1`,
        [plantId || speciesId])).rows.length) fail(409, "Changes are already pending review for this record.");
      const changeId = randomUUID();
      await c.query("INSERT INTO record_change_submission(id,plant_id,species_id,owner_subject,base_snapshot,proposed_snapshot,base_fingerprint,client_key,payload_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [changeId, plantId, speciesId, subject(req.user), base, proposal, digest(base), clientKey, payloadHash]);
      if (plantId) {
        const proposedQr = proposal.qr_id === undefined || String(proposal.qr_id) === String(base.qr_id)
          ? base.qr_token : (await c.query("SELECT qr_code FROM plant_app.qr_code WHERE qr_id=$1", [proposal.qr_id])).rows[0]?.qr_code;
        await appendVersion(c, { kind: "plant", targetId: plantId, owner: subject(req.user), editor: subject(req.user),
          base, proposed: plantProposedSnapshot(base, proposal, changeId, proposedQr),
          changeId, changeRevision: 1 });
      } else {
        const original = (await c.query("SELECT photo,submitted_at,reviewed_by,reviewed_at,review_comment FROM species_request_submission WHERE request_id=$1", [base.request_id])).rows[0];
        await appendVersion(c, { kind: "species", targetId: base.request_id, owner: subject(req.user), editor: subject(req.user),
          base,
          proposed: { ...base, ...speciesSnapshot(proposal) },
          proposedPhoto: proposal.photo ? Buffer.from(proposal.photo.base64, "base64") : original.photo,
          changeId, changeRevision: 1 });
      }
      if (officerNotifications) await officerNotifications.enqueueRecordChange(c, changeId);
      await audit(c, req.user, "record_change_submitted", changeId);
      return { id: changeId, status: "Pending Review", revision: 1 };
    });
    res.status(201).json({ change: result });
  });

  app.patch("/api/record-changes/:id", allow("plants.create"), async (req, res) => {
    const body = req.body || {};
    if (!Number.isInteger(body.revision) || body.revision < 1 || !body.proposed || typeof body.proposed !== "object" || Array.isArray(body.proposed) ||
      Object.keys(body).some((key) => !["revision", "proposed"].includes(key))) fail(400, "Invalid correction submission.");
    const coordinates = await readInitialChange(pool, req.params.id).catch(error => {
      if (error.status === 404) return null;
      throw error;
    });
    if (coordinates) {
      const updated = await resubmitInitialObservationEdit(pool, {
        user: req.user, changeId: coordinates.id, revision: body.revision, ...body.proposed,
      });
      return res.json({ change: updated });
    }
    const updated = await transaction(pool, async (c) => {
      const change = (await c.query("SELECT * FROM record_change_submission WHERE id=$1 FOR UPDATE", [req.params.id])).rows[0];
      if (!change || change.owner_subject !== subject(req.user)) fail(404, "Owned edit proposal unavailable.");
      if (change.status !== "Correction Required" || change.revision !== body.revision) fail(409, "Reload this correction request before resubmitting.");
      const kind = change.plant_id ? "plant" : "species";
      const proposal = await normalized(kind === "plant" ? plantProposal(body.proposed) : speciesProposal(body.proposed), kind);
      if (kind === "plant" && proposal.photos === undefined && proposal.photo_ids === undefined) {
        if (change.proposed_snapshot.photos !== undefined) proposal.photos = change.proposed_snapshot.photos;
        if (change.proposed_snapshot.photo_ids !== undefined) proposal.photo_ids = change.proposed_snapshot.photo_ids;
      }
      if (kind === "species" && proposal.photo === undefined && change.proposed_snapshot.photo !== undefined)
        proposal.photo = change.proposed_snapshot.photo;
      const { plant, base } = await currentChangeBase(c, change);
      if (kind === "plant") {
        if (proposal.species_id !== String(plant.species_id)) await speciesRow(c, proposal.species_id, req.user);
        if (proposal.photo_ids !== undefined || proposal.photos !== undefined) {
          const retained = proposal.photo_ids || [];
          if (retained.some((photoId) => !base.photo_ids.includes(photoId)) || retained.length + (proposal.photos?.length || 0) < 3 || retained.length + (proposal.photos?.length || 0) > 8)
            fail(409, "Plant photos changed or the proposed photo count is invalid. Reload before saving.");
        }
        if (proposal.qr_id !== undefined && String(proposal.qr_id) !== String(base.qr_id) &&
          !(await c.query("SELECT qr_id FROM plant_app.qr_code WHERE qr_id=$1 AND plant_id IS NULL AND status='generated'", [proposal.qr_id])).rows.length)
          fail(409, "Selected QR code is no longer available. Refresh the QR list.");
      }
      const targetId = kind === "plant" ? change.plant_id : change.species_id;
      const payloadHash = digest({ kind, targetId, proposal });
      const nextRevision = change.revision + 1;
      const row = (await c.query(`UPDATE record_change_submission SET proposed_snapshot=$1,payload_hash=$2,revision=$3,status='Pending Review',
        reviewed_by=NULL,reviewed_at=NULL,review_comment=NULL,cancelled_by=NULL,cancelled_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$4 RETURNING id,status,revision,review_comment,updated_at`,
      [proposal, payloadHash, nextRevision, change.id])).rows[0];
      await requireVersionHistory(c, { revisions: true });
      {
        const proposedSnapshot = kind === "plant"
          ? plantProposedSnapshot(base, proposal, change.id, proposal.qr_id === undefined || String(proposal.qr_id) === String(base.qr_id)
            ? base.qr_token : (await c.query("SELECT qr_code FROM plant_app.qr_code WHERE qr_id=$1", [proposal.qr_id])).rows[0]?.qr_code)
          : { ...change.base_snapshot, ...speciesSnapshot(proposal) };
        await appendVersion(c, { kind, targetId: kind === "plant" ? change.plant_id : change.base_snapshot.request_id,
          owner: change.owner_subject, editor: change.owner_subject, base: change.base_snapshot,
          proposed: proposedSnapshot,
          proposedPhoto: kind === "species" ? (proposal.photo ? Buffer.from(proposal.photo.base64, "base64") : null) : null,
          changeId: change.id, changeRevision: nextRevision });
      }
      await audit(c, req.user, "record_change_resubmitted", change.id);
      return { ...row, plant_id: change.plant_id, species_id: change.species_id };
    });
    res.json({ change: updated });
  });

  const read = (req, res, next) => allow(permitted(req.user, "species.manage") ? "species.manage" : "plants.create")(req, res, next);
  app.get("/api/record-changes", read, async (req, res) => {
    const officer = permitted(req.user, "species.manage");
    const limit = req.query.limit === undefined ? 500 : Number(req.query.limit);
    const status = req.query.status || '', search = req.query.search || '', cursor = req.query.cursor || '';
    if (!Number.isInteger(limit) || limit < 1 || limit > 500 ||
      !['','Pending Review','Approved','Rejected'].includes(status) || typeof search !== 'string' || search.length > 200 ||
      typeof cursor !== 'string' || (cursor && !/^[a-f0-9-]{36}$/i.test(cursor))) fail(400, 'Invalid change queue filters.');
    const rows = (await pool.query(`SELECT id,plant_id,species_id,owner_subject,status,revision,base_snapshot,proposed_snapshot - 'photos' - 'photo' AS proposed_snapshot,CASE WHEN jsonb_typeof(proposed_snapshot->'photos')='array' THEN jsonb_array_length(proposed_snapshot->'photos') WHEN proposed_snapshot ? 'photo' THEN 1 ELSE 0 END AS proposal_photo_count,review_comment,reviewed_by,reviewed_at,created_at
      FROM record_change_submission WHERE ($1 OR owner_subject=$2) AND ($3='' OR status=$3)
      AND base_snapshot->>'workflow_type' IS DISTINCT FROM 'initial_registration_observation_edit'
      AND ($4='' OR concat_ws(' ',id,plant_id::text,species_id::text,owner_subject,base_snapshot->>'scientific_name',proposed_snapshot->>'scientific_name') ILIKE '%' || $4 || '%')
      AND ($5='' OR (created_at,id)<(SELECT created_at,id FROM record_change_submission WHERE id=$5))
      ORDER BY created_at DESC,id DESC LIMIT $6`, [officer, subject(req.user),status,search,cursor,limit+1])).rows;
    const more = rows.length > limit, changes = rows.slice(0,limit);
    res.json({ changes, page: { has_more: more, next_cursor: more ? changes.at(-1).id : null } });
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

  app.post("/api/record-changes/:id/cancel", allow("plants.create"), async (req, res) => {
    if (req.body && Object.keys(req.body).length) fail(400, "Cancellation does not accept proposal changes.");
    const coordinates = await readInitialChange(pool, req.params.id).catch(error => {
      if (error.status === 404) return null;
      throw error;
    });
    if (coordinates) {
      const cancelled = await cancelInitialObservationEdit(pool, { user: req.user, changeId: coordinates.id });
      return res.json({ change: cancelled });
    }
    const cancelled = await transaction(pool, async (c) => {
      const change = (await c.query("SELECT * FROM record_change_submission WHERE id=$1 FOR UPDATE", [req.params.id])).rows[0];
      if (!change || change.owner_subject !== subject(req.user)) fail(404, "Owned edit proposal unavailable.");
      if (!canCancelEdit(change.status, change.revision))
        fail(409, "Only an active edit proposal can be cancelled.");
      await requireVersionHistory(c, { revisions: true });
      const row = (await c.query(`UPDATE record_change_submission SET status='Cancelled',cancelled_by=$1,cancelled_at=CURRENT_TIMESTAMP,
        updated_at=CURRENT_TIMESTAMP WHERE id=$2 RETURNING *`, [subject(req.user), change.id])).rows[0];
      // Keep any Officer feedback intact; the status and audit event record cancellation.
      await c.query(`UPDATE record_version_history SET status='Cancelled' WHERE change_id=$1
        AND (change_revision=$2 OR (change_revision IS NULL AND
          (SELECT COUNT(*) FROM record_version_history WHERE change_id=$1)=1))
        AND status IN ('Pending Review','Correction Required')`, [change.id, change.revision]);
      await audit(c, req.user, "record_change_cancelled", change.id);
      return { id: row.id, status: row.status, cancelled_at: row.cancelled_at };
    });
    res.json({ change: cancelled });
  });

  app.post("/api/record-changes/:id/review", allow("species.manage"), async (req, res) => {
    if (!req.body || !["Approved", "Rejected", "Correction Required"].includes(req.body.decision) ||
      (req.body.revision !== undefined && (!Number.isInteger(req.body.revision) || req.body.revision < 1)) ||
      Object.keys(req.body).some((key) => !["decision", "comment", "revision"].includes(key))) fail(400, "Invalid review decision.");
    const comment = text(req.body.comment);
    const coordinates = await readInitialChange(pool, req.params.id).catch(error => {
      if (error.status === 404) return null;
      throw error;
    });
    if (coordinates) {
      if (req.body.revision === undefined) fail(409, "Reload the exact initial Observation edit revision before reviewing.");
      const result = await reviewInitialObservationEdit(pool, {
        user: req.user, changeId: coordinates.id, revision: req.body.revision,
        decision: req.body.decision, comment,
      });
      return res.json({ change: result });
    }
    const result = await transaction(pool, async (c) => {
      const change = (await c.query("SELECT * FROM record_change_submission WHERE id=$1 FOR UPDATE", [req.params.id])).rows[0];
      if (!change) fail(404, "Change submission unavailable.");
      if (change.status !== "Pending Review") fail(409, "This submission was already reviewed.");
      if (change.revision !== (req.body.revision ?? 1)) fail(409, "This is an older edit version. Reload before reviewing.");
      if (change.owner_subject === subject(req.user)) fail(403, "You cannot review your own changes.");
      await requireVersionHistory(c);
      if (req.body.decision === "Correction Required") {
        if (!comment) fail(400, "Correction feedback is required.");
        if (!(await recordChangeCorrectionNotificationsAvailable(c))) fail(503, "Plant and Species edit correction notifications require migration 023.");
      }
      if (req.body.decision === "Approved") {
        if (change.plant_id) {
          const plant = (await c.query("SELECT * FROM plant_record WHERE plant_id=$1 FOR UPDATE", [change.plant_id])).rows[0];
          if (!plant || plant.rbac_status !== "Approved") fail(409, "Approved plant has changed.");
          const base = await approvedPlantSnapshot(c, plant, qrPlantSchema);
          if (digest(base) !== change.base_fingerprint) fail(409, "Approved plant changed since this proposal. Review a fresh version.");
          const proposal = change.proposed_snapshot;
          await speciesRow(c, proposal.species_id, req.user);
          await c.query("UPDATE plant_record SET species_id=$1,scientific_name=$2 WHERE plant_id=$3",
            [proposal.species_id, proposal.scientific_name, plant.plant_id]);
          await applyQrChange(c, plant, proposal.qr_id, qrPlantSchema);
          await c.query("UPDATE plant_observation SET content=$1,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=$2",
            [{ ...base.content, ...proposal.content }, base.observation_id]);
          await c.query("INSERT INTO plant_location(plant_id,latitude,longitude,accuracy_m) VALUES($1,$2,$3,$4)",
            [plant.plant_id, proposal.content.latitude, proposal.content.longitude, proposal.content.accuracy_m ?? null]);
          await applyPlantPhotos(c, { plantId: plant.plant_id, observationId: base.observation_id, owner: change.owner_subject,
            approved: true, proposal, keyPrefix: `approved-edit:${change.id}` });
        } else {
          await c.query("SELECT species_id FROM species WHERE species_id=$1 FOR UPDATE",[change.species_id]);
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
            await replaceRequestPhoto(c,request,change.species_id,Buffer.from(proposal.photo.base64,"base64"),true,subject(req.user));
          }
        }
      }
      await c.query("UPDATE record_change_submission SET status=$1,review_comment=$2,reviewed_by=$3,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$4",
        [req.body.decision, comment, subject(req.user), change.id]);
      if (await recordChangeReviewEventsAvailable(c)) await c.query(`INSERT INTO record_change_review_event
        (id,change_id,revision,status,reviewer_subject,comment,created_at) VALUES($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP)`,
      [randomUUID(), change.id, change.revision, req.body.decision, subject(req.user), comment]);
      {
        const versionTarget = change.plant_id ? { column: "plant_id", id: change.plant_id } :
          { column: "request_id", id: change.base_snapshot?.request_id };
        const revisionAwareHistory = await historyRevisionAvailable(c);
        if (req.body.decision === "Approved" && revisionAwareHistory) await c.query(`UPDATE record_version_history SET status='Superseded'
          WHERE ${versionTarget.column}=$1 AND status='Approved'`, [versionTarget.id]);
        const revisionMatch = revisionAwareHistory
          ? `AND (change_revision=$5 OR (change_revision IS NULL AND
            (SELECT COUNT(*) FROM record_version_history WHERE change_id=$4)=1))`
          : "";
        const updatedVersion = await c.query(`UPDATE record_version_history SET status=$1,review_comment=$2,reviewed_by=$3,reviewed_at=CURRENT_TIMESTAMP
          WHERE change_id=$4 ${revisionMatch} AND status='Pending Review'`,
        [req.body.decision, comment, subject(req.user), change.id, ...(revisionMatch ? [change.revision] : [])]);
        if (!updatedVersion.rowCount) fail(409, "The exact pending version is unavailable. Reload before reviewing.");
      }
      if (req.body.decision === "Correction Required") {
        const recordKind = change.plant_id ? "plant" : "species";
        const targetId = change.plant_id ?? change.base_snapshot?.request_id ?? change.species_id;
        const metadata = { entityType: "record_change", changeId: change.id, recordKind, targetId: String(targetId), revision: change.revision };
        await c.query(`INSERT INTO botanist_notification(id,recipient_subject,type,source_key,plant_id,metadata)
          VALUES($1,$2,'record_change_correction',$3,$4,$5::jsonb) ON CONFLICT(recipient_subject,source_key) DO NOTHING`,
        [randomUUID(), change.owner_subject, `record-change-correction:${change.id}:${change.revision}`, change.plant_id, metadata]);
      }
      await audit(c, req.user, `record_change_${req.body.decision.toLowerCase()}`, change.id);
      return { id: change.id, status: req.body.decision };
    });
    res.json({ change: result });
  });
}

module.exports = {
  mountRecordChanges,
  submitInitialObservationEdit,
  resubmitInitialObservationEdit,
  cancelInitialObservationEdit,
  reviewInitialObservationEdit,
  isInitialObservationChange,
};
