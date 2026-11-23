"use strict";
const { canCancelEdit } = require("./status-permissions.cjs");
const { randomUUID, createHash } = require("node:crypto");
const sharp = require("sharp");
const { permitted } = require("../shared/rbac.cjs");
const { normalizeSourceLanguages, stageSourceLanguages, promoteSourceLanguages } = require("./translation-source-language.cjs");
const { audit, subject, fail, text, fieldContent, speciesRow } = require("./domain.cjs");
const versions = require("./observation-submission-versions.cjs");
const { classifyObservations } = require("./observation-origin.cjs");
const {
  resubmitInitialObservationEdit,
  cancelInitialObservationEdit,
  reviewInitialObservationEdit,
  isInitialObservationChange,
} = require("./record-changes.cjs");

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const validId = (value) => typeof value === "string" && /^[a-f0-9-]{8,80}$/i.test(value);
const initialObservationWorkflow = "initial_registration_observation_edit";
const evidenceInvalid = () => fail(409, "Observation edit photo evidence is invalid. Contact support for an evidence-preserving assessment.");
const validPhotoIds = value => Array.isArray(value) && value.every(id => typeof id === "string" && id.length > 0);
function assertPhotoEvidence(row) {
  if (!validPhotoIds(row.retained_photo_ids) || !Array.isArray(row.added_photos) ||
      (row.base_snapshot?.photo_ids !== undefined && !validPhotoIds(row.base_snapshot.photo_ids))) evidenceInvalid();
}
const exposed = (row) => {
  assertPhotoEvidence(row);
  const { added_photos, ...safe } = row;
  return { ...safe, added_photo_count: added_photos.length };
};
async function available(c) {
  return Boolean((await c.query("SELECT to_regclass(current_schema() || '.observation_edit_request') IS NOT NULL AS available")).rows[0]?.available);
}
async function requireAvailable(c) {
  if (!(await available(c))) fail(503, "Observation edit requests require migration 021.");
}
async function versioningAvailable(c) {
  return Boolean((await c.query(`SELECT to_regclass('plant_app.observation_submission_version') IS NOT NULL
    AND to_regclass('plant_app.observation_submission_photo') IS NOT NULL
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='plant_app'
      AND table_name='observation_edit_event' AND column_name='submission_version_id')
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='plant_app'
      AND table_name='observation_edit_event' AND column_name='request_revision')
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='plant_app'
      AND table_name='observation_submission_version' AND column_name='correction_edit_event_id') AS available`)).rows[0]?.available);
}
async function initialParentChange(pool, changeId, user) {
  const officer = permitted(user, "observations.review");
  const row = (await pool.query(`SELECT * FROM record_change_submission WHERE id=$1 AND ($2 OR owner_subject=$3)`,
    [changeId, officer, subject(user)])).rows[0];
  if (!row || row.base_snapshot?.workflow_type !== initialObservationWorkflow) return null;
  if (!isInitialObservationChange(row)) fail(409, "The initial Observation edit target is incomplete.");
  const observation = (await pool.query("SELECT * FROM plant_observation WHERE id=$1 AND plant_id=$2",
    [row.base_snapshot.observation_id, row.plant_id])).rows[0];
  if (!observation || observation.owner_subject !== row.owner_subject ||
      (await classifyObservations(pool, [observation]))[0]?.origin_type !== "initial_registration")
    fail(409, "Observation origin cannot be verified for this edit.");
  return row;
}
async function initialChangeEdit(pool, row) {
  const base = row.base_snapshot || {}, proposed = row.proposed_snapshot || {};
  const editNumber = Number((await pool.query(`SELECT COUNT(*)::int AS count FROM record_change_submission
    WHERE owner_subject=$1 AND plant_id=$2 AND base_snapshot->>'workflow_type'=$3
      AND base_snapshot->>'observation_id'=$4
      AND (created_at < $5 OR (created_at=$5 AND id<=$6))`,
  [row.owner_subject, row.plant_id, initialObservationWorkflow, base.observation_id, row.created_at, row.id])).rows[0]?.count) || 1;
  return exposed({
    id: row.id,
    observation_id: base.observation_id,
    owner_subject: row.owner_subject,
    status: row.status,
    revision: row.revision,
    version_number: editNumber,
    base_revision: base.observation_revision,
    base_fingerprint: row.base_fingerprint,
    base_snapshot: { content: base.content, revision: base.observation_revision, photo_ids: base.photo_ids || [] },
    proposed_content: proposed.content || {},
    retained_photo_ids: proposed.photo_ids || [],
    added_photos: proposed.photos || [],
    client_key: row.client_key,
    review_comment: row.review_comment,
    reviewed_by: row.reviewed_by,
    reviewed_at: row.reviewed_at,
    cancelled_by: row.cancelled_by,
    cancelled_at: row.cancelled_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}
async function getInitialChangeRow(pool, changeId) {
  const row = (await pool.query("SELECT * FROM record_change_submission WHERE id=$1", [changeId])).rows[0];
  if (row?.base_snapshot?.workflow_type === initialObservationWorkflow && !isInitialObservationChange(row))
    fail(409, "The initial Observation edit target is incomplete.");
  return row?.base_snapshot?.workflow_type === initialObservationWorkflow ? row : null;
}
async function verifiedInitialChanges(pool, user) {
  const rows = (await pool.query(`SELECT * FROM record_change_submission
    WHERE base_snapshot->>'workflow_type'=$1 AND ($2 OR owner_subject=$3)
    ORDER BY updated_at DESC`, [initialObservationWorkflow, permitted(user, "observations.review"), subject(user)])).rows;
  if (!rows.length) return [];
  for (const row of rows) if (!isInitialObservationChange(row)) fail(409, "An initial Observation edit target is incomplete.");
  const ids = [...new Set(rows.map(row => row.base_snapshot.observation_id))];
  const observations = (await pool.query("SELECT * FROM plant_observation WHERE id=ANY($1::text[])", [ids])).rows;
  const byId = new Map(observations.map(row => [row.id, row]));
  const classified = new Map((await classifyObservations(pool, observations)).map(row => [row.id, row.origin_type]));
  for (const row of rows) {
    const observation = byId.get(row.base_snapshot.observation_id);
    if (!observation || observation.owner_subject !== row.owner_subject ||
        String(observation.plant_id) !== String(row.plant_id) || classified.get(observation.id) !== "initial_registration")
      fail(409, "Observation origin cannot be verified for an edit in this list.");
  }
  return rows;
}
async function verifiedSubsequent(c, observation) {
  return (await classifyObservations(c, [observation]))[0]?.origin_type === "subsequent_observation";
}
async function verifiedLegacyInitialRequest(c, request, { observation = null, activeOnly = true } = {}) {
  if (!request || (activeOnly && !["Pending Review", "Correction Required"].includes(request.status))) return null;
  const row = observation || (await c.query("SELECT * FROM plant_observation WHERE id=$1", [request.observation_id])).rows[0];
  if (!row || row.id !== request.observation_id || row.owner_subject !== request.owner_subject)
    fail(409, "The legacy Observation edit target cannot be verified.");
  const origin = (await classifyObservations(c, [row]))[0]?.origin_type;
  if (origin !== "initial_registration") {
    if (row.origin_type === "initial_registration" || origin === "unknown")
      fail(409, "The legacy Observation edit origin cannot be verified. Contact support before continuing.");
    return null;
  }
  const plant = (await c.query("SELECT registered_subject,rbac_status FROM plant_record WHERE plant_id=$1", [row.plant_id])).rows[0];
  if (!plant || plant.registered_subject !== row.owner_subject || plant.rbac_status !== "Approved" || row.status !== "Approved")
    fail(409, "The approved initial Observation changed. This legacy edit cannot be continued safely.");
  if (row.revision !== request.base_revision || row.owner_subject !== request.owner_subject)
    fail(409, "The approved initial Observation changed since this legacy edit was created.");
  const events = (await c.query(`SELECT event_type,actor_subject,comment,created_at FROM observation_edit_event
    WHERE request_id=$1 AND observation_id=$2 ORDER BY created_at,id`, [request.id, row.id])).rows;
  const submitted = events.filter(event => event.event_type === "submitted");
  const resubmitted = events.filter(event => event.event_type === "resubmitted");
  const corrections = events.filter(event => event.event_type === "correction_required").map(event => ({
    actor: event.actor_subject, comment: event.comment, created_at: event.created_at,
  }));
  if ((await c.query("SELECT to_regclass(current_schema() || '.botanist_notification') IS NOT NULL AS available")).rows[0]?.available) {
    const notices = (await c.query(`SELECT type,observation_id,metadata,created_at FROM botanist_notification
      WHERE recipient_subject=$1 AND metadata->>'entityType'='legacy_observation_edit'
        AND metadata->>'requestId'=$2 ORDER BY created_at,id`, [request.owner_subject, request.id])).rows;
    for (const notice of notices) {
      if (notice.observation_id !== row.id || notice.metadata?.requestId !== request.id ||
          !Number.isInteger(notice.metadata?.revision) || typeof notice.metadata?.reviewedBy !== "string")
        fail(409, "Legacy edit review history is inconsistent. Contact support before continuing.");
      if (notice.type === "correction_requested") corrections.push({ actor: notice.metadata.reviewedBy,
        comment: notice.metadata.comment, created_at: notice.created_at });
    }
  }
  corrections.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const expectedCorrections = request.status === "Correction Required" ? request.revision : request.revision - 1;
  if (submitted.length !== 1 || submitted[0].actor_subject !== request.owner_subject ||
      resubmitted.length !== request.revision - 1 || resubmitted.some(event => event.actor_subject !== request.owner_subject) ||
      corrections.length !== expectedCorrections || corrections.some(event => !event.comment || !event.actor ||
        event.actor === request.owner_subject))
    fail(409, "Legacy edit history is incomplete or ambiguous. Contact support before continuing.");
  if (request.status === "Correction Required") {
    const latestCorrection = corrections.at(-1);
    const exactCurrentDecision = latestCorrection && request.reviewed_by === latestCorrection.actor &&
      request.review_comment === latestCorrection.comment && request.reviewed_at &&
      new Date(request.reviewed_at).getTime() === new Date(latestCorrection.created_at).getTime();
    if (!exactCurrentDecision) fail(409, "The active legacy correction decision cannot be verified. Contact support.");
  } else if (request.reviewed_by != null || request.reviewed_at != null || request.review_comment != null) {
    fail(409, "The pending legacy edit contains inconsistent review information. Contact support.");
  }
  const currentPhotoIds = await photoIds(c, row.id);
  const currentBase = { content: row.content, revision: row.revision, photo_ids: currentPhotoIds };
  const storedBase = { content: request.base_snapshot?.content, revision: request.base_snapshot?.revision,
    photo_ids: request.base_snapshot?.photo_ids };
  if (hash(currentBase) !== request.base_fingerprint || hash(storedBase) !== hash(currentBase))
    fail(409, "The approved initial Observation no longer matches this legacy edit. Contact support.");
  const linkedVersions = await c.query(`SELECT id FROM observation_submission_version
    WHERE observation_id=$1 AND (request_id=$2 OR baseline_for_request_id=$2) LIMIT 1`, [row.id, request.id]);
  if (linkedVersions.rows.length) fail(409, "This legacy edit has version history and cannot use the compatibility workflow.");
  const parentChanges = await c.query(`SELECT id FROM record_change_submission
    WHERE plant_id=$1 AND base_snapshot->>'workflow_type'=$2 AND base_snapshot->>'observation_id'=$3
      AND status IN ('Pending Review','Correction Required') LIMIT 1`, [row.plant_id, initialObservationWorkflow, row.id]);
  if (parentChanges.rows.length) fail(409, "A separate initial Observation change is already active for this record.");
  return row;
}
async function notifyLegacyInitialDecision(c, request, observation, decision, comment, reviewerSubject) {
  const types = { Approved: "observation_approved", Rejected: "observation_rejected", "Correction Required": "correction_requested" };
  const type = types[decision];
  if (!type) return;
  const exists = Boolean((await c.query("SELECT to_regclass(current_schema() || '.botanist_notification') IS NOT NULL AS available")).rows[0]?.available);
  if (!exists) fail(503, "Observation edit notifications are unavailable. No review decision was saved.");
  const metadata = { entityType: "legacy_observation_edit", requestId: request.id, revision: request.revision,
    reviewedBy: reviewerSubject };
  await c.query(`INSERT INTO botanist_notification
    (id,recipient_subject,type,source_key,observation_id,plant_id,metadata)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(recipient_subject,source_key) DO NOTHING`,
  [randomUUID(), request.owner_subject, type, `legacy-observation-edit:${request.id}:${request.revision}`,
    observation.id, observation.plant_id, JSON.stringify({ ...metadata, comment: comment || null })]);
}
async function lockEditTargets(c, requestId, ownerSubject = null) {
  const coordinates = (await c.query(`SELECT r.observation_id,o.plant_id FROM observation_edit_request r
    JOIN plant_observation o ON o.id=r.observation_id WHERE r.id=$1`, [requestId])).rows[0];
  if (!coordinates) fail(404, "Observation edit unavailable.");
  const preview = (await c.query("SELECT * FROM plant_observation WHERE id=$1", [coordinates.observation_id])).rows[0];
  const verifiedOrigin = preview ? (await classifyObservations(c, [preview]))[0]?.origin_type : "unknown";
  // Initial-registration edits share the parent Plant workflow's lock order:
  // Plant -> exact Observation -> legacy request. Subsequent edits retain the
  // Migration 030 order: Observation -> request -> version -> review -> assets.
  if (verifiedOrigin === "initial_registration") {
    const plant = (await c.query("SELECT plant_id FROM plant_record WHERE plant_id=$1 FOR UPDATE", [coordinates.plant_id])).rows[0];
    if (!plant) fail(409, "The initial Observation Plant is unavailable.");
  }
  const observation = (await c.query("SELECT * FROM plant_observation WHERE id=$1 FOR UPDATE", [coordinates.observation_id])).rows[0];
  if (!observation || (ownerSubject && observation.owner_subject !== ownerSubject)) fail(404, "Owned observation edit unavailable.");
  const request = (await c.query("SELECT * FROM observation_edit_request WHERE id=$1 FOR UPDATE", [requestId])).rows[0];
  if (!request || request.observation_id !== observation.id || (ownerSubject && request.owner_subject !== ownerSubject))
    fail(ownerSubject ? 404 : 409, ownerSubject ? "Owned observation edit unavailable." : "Observation edit parent changed.");
  return { observation, request };
}
async function stagedPhotos(c, observation, requestId, revision, additions) {
  const ids = [];
  for (const [index, photo] of additions.entries()) {
    const clientKey = `observation-edit:${requestId}:${revision}:${index}`;
    const existing = (await c.query(`SELECT id,plant_id,owner_subject,observation_id,content_type,content
      FROM plant_asset WHERE owner_subject=$1 AND client_key=$2`, [observation.owner_subject, clientKey])).rows[0];
    const bytes = Buffer.from(photo.base64, "base64");
    if (existing) {
      if (existing.plant_id !== observation.plant_id || existing.observation_id !== observation.id ||
          existing.content_type !== "image/jpeg" || !Buffer.from(existing.content).equals(bytes))
        fail(409, "A staged Observation photo no longer matches this edit revision.");
      ids.push(existing.id);
      continue;
    }
    const id = randomUUID();
    await c.query(`INSERT INTO plant_asset(id,plant_id,owner_subject,client_key,observation_id,approved,content_type,content)
      VALUES($1,$2,$3,$4,$5,FALSE,'image/jpeg',$6)`,
    [id, observation.plant_id, observation.owner_subject, clientKey, observation.id, bytes]);
    ids.push(id);
  }
  return ids;
}
async function ensureApprovedBaseline(c, observation, request, photos, user) {
  let current = await versions.currentApprovedVersion(c, observation.id);
  if (current) {
    const currentAssetSet = [...photos].sort();
    const versionAssetSet = [...current.photo_refs].sort();
    if (JSON.stringify(current.content) !== JSON.stringify(observation.content) ||
        JSON.stringify(versionAssetSet) !== JSON.stringify(currentAssetSet))
      fail(409, "Approved Observation history does not match its current content. Contact support before editing.");
    return current;
  }
  const any = await versions.versionHistory(c, observation.id);
  if (any.length) fail(409, "Observation version history is incomplete. This record cannot be edited safely yet.");
  return versions.insertVersion(c, { observationId: observation.id, ownerSubject: observation.owner_subject,
    submissionType: "legacy_baseline", baselineForRequestId: request.id, baselineCapturedBy: subject(user),
    content: observation.content, photoRefs: photos });
}
async function insertEditSnapshot(c, observation, request, retained, additions, basedOnVersionId, user, correctionEditEventId = null) {
  const staged = await stagedPhotos(c, observation, request.id, request.revision, additions);
  return versions.insertVersion(c, { observationId: observation.id, ownerSubject: request.owner_subject,
    submissionType: correctionEditEventId ? "correction_resubmission" : "edit", requestId: request.id,
    requestRevision: request.revision, correctionEditEventId, basedOnVersionId,
    content: request.proposed_content, photoRefs: [...retained, ...staged], submittedBy: subject(user) });
}
async function photoIds(c, observationId) {
  return (await c.query("SELECT id FROM plant_asset WHERE observation_id=$1 AND approved=TRUE AND content_type IN ('image/jpeg','image/png') ORDER BY created_at,id", [observationId])).rows.map((row) => row.id);
}
async function image(photo) {
  if (!photo || !["image/jpeg", "image/png"].includes(photo.content_type) ||
    typeof photo.base64 !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(photo.base64) || photo.base64.length > 5592408)
    fail(400, "Use a JPEG or PNG photo up to 4 MB.");
  const bytes = Buffer.from(photo.base64, "base64");
  if (!bytes.length || bytes.length > 4194304) fail(413, "Photo exceeds 4 MB.");
  try {
    const normalized = await sharp(bytes, { limitInputPixels: 24000000, failOn: "warning" }).rotate()
      .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    return { content_type: "image/jpeg", base64: normalized.toString("base64") };
  } catch { fail(400, "Invalid photo. Choose another image."); }
}
async function proposal(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
    Object.keys(body).some((key) => !["content", "photo_ids", "photos"].includes(key))) fail(400, "Invalid observation edit.");
  const content = fieldContent({ ...body.content });
  if (body.photo_ids !== undefined && (!Array.isArray(body.photo_ids) || body.photo_ids.some((id) => !validId(id)) ||
    new Set(body.photo_ids).size !== body.photo_ids.length)) fail(400, "Invalid retained observation photos.");
  if (body.photos !== undefined && (!Array.isArray(body.photos) || body.photos.length > 3)) fail(400, "Too many observation photos.");
  const photos = [];
  for (const photo of body.photos || []) photos.push(await image(photo));
  return { content, photoIds: body.photo_ids, photos };
}
async function ownedObservation(c, observationId, user, lock = false) {
  const row = (await c.query(`SELECT * FROM plant_observation WHERE id=$1 ${lock ? "FOR UPDATE" : ""}`, [observationId])).rows[0];
  if (!row || row.owner_subject !== subject(user)) fail(404, "Owned observation unavailable.");
  const plant = (await c.query("SELECT species_id,rbac_status FROM plant_record WHERE plant_id=$1", [row.plant_id])).rows[0];
  if (!plant || plant.rbac_status !== "Approved") fail(409, "The plant must remain Approved for observation editing.");
  await speciesRow(c, plant.species_id, user);
  return row;
}
async function selectedPhotos(c, observationId, selected, additions) {
  const current = await photoIds(c, observationId);
  const retained = selected === undefined ? current : selected;
  if (retained.some((id) => !current.includes(id)) || retained.length + additions.length > 3)
    fail(409, "Observation photos changed. Reload before editing.");
  return { current, retained };
}
function mountObservationEdits(app, { pool, allow, officerNotifications = null }) {
  const read = (req, res, next) => allow(permitted(req.user, "observations.review") ? "observations.review" : "observations.create")(req, res, next);
  app.get("/api/observation-edits/capabilities", read, async (_req, res) => res.json({
    available: await available(pool), versioning_available: await versioningAvailable(pool),
  }));
  app.post("/api/observation-edits", allow("observations.create"), async (req, res) => {
    const { observation_id: observationId, client_key: clientKey, ...input } = req.body || {};
    const sourceLanguages = normalizeSourceLanguages(input.source_languages, ["morphology", "notes"]);
    delete input.source_languages;
    if (!validId(observationId) || typeof clientKey !== "string" || !clientKey.trim() || clientKey.length > 100) fail(400, "Invalid observation edit reference.");
    const proposed = await proposal(input);
    const payloadHash = hash({ observationId, proposed,
      ...(Object.hasOwn(req.body || {}, "source_languages") ? { sourceLanguages } : {}) });
    const result = await versions.withVersionTransaction(pool, async (c) => {
      await requireAvailable(c);
      const observation = await ownedObservation(c, observationId, req.user, true);
      if (observation.status !== "Approved") fail(409, "Only an Approved observation can be edited.");
      const prior = (await c.query("SELECT * FROM observation_edit_request WHERE owner_subject=$1 AND client_key=$2", [subject(req.user), clientKey])).rows[0];
      if (prior) {
        if (prior.payload_hash !== payloadHash || prior.observation_id !== observationId) fail(409, "This edit key belongs to another proposal.");
        return exposed(prior);
      }
      // Creation policy only: preserve verified retries and all existing proposal operations.
      const origin = (await classifyObservations(c, [observation]))[0]?.origin_type;
      if (origin === "initial_registration")
        fail(409, "To change registration information, use Edit Plant.");
      if (origin !== "subsequent_observation")
        fail(409, "Observation origin cannot be verified. Independent edits require a subsequent field Observation.");
      const versioning = await versioningAvailable(c);
      const versioned = versioning && origin === "subsequent_observation";
      if ((await c.query("SELECT id FROM observation_edit_request WHERE observation_id=$1 AND status IN ('Pending Review','Correction Required')", [observationId])).rows.length)
        fail(409, "An observation edit is already awaiting review.");
      const photos = await selectedPhotos(c, observationId, proposed.photoIds, proposed.photos);
      const base = { content: observation.content, revision: observation.revision, photo_ids: photos.current };
      const number = Number((await c.query("SELECT COALESCE(MAX(version_number),0)+1 AS next FROM observation_edit_request WHERE observation_id=$1", [observationId])).rows[0].next);
      const id = randomUUID();
      const row = (await c.query(`INSERT INTO observation_edit_request
        (id,observation_id,owner_subject,version_number,base_revision,base_fingerprint,base_snapshot,proposed_content,retained_photo_ids,added_photos,client_key,payload_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [id, observationId, subject(req.user), number, observation.revision, hash(base), base, proposed.content, JSON.stringify(photos.retained),
        JSON.stringify(proposed.photos), clientKey, payloadHash])).rows[0];
      await stageSourceLanguages(c, { submissionType: "observation_edit", submissionId: row.id,
        values: proposed.content, selections: sourceLanguages, fieldMap: { morphology: "morphology", notes: "notes" } });
      if (versioned) {
        const approved = await ensureApprovedBaseline(c, observation, row, photos.current, req.user);
        await insertEditSnapshot(c, observation, row, photos.retained, proposed.photos, approved.id, req.user);
      }
      await c.query(`INSERT INTO observation_version_history(id,observation_id,version_number,owner_subject,content,photo_ids)
        VALUES($1,$2,0,$3,$4,$5) ON CONFLICT(observation_id,version_number) DO NOTHING`,
      [randomUUID(), observationId, subject(req.user), observation.content, JSON.stringify(photos.current)]);
      const notificationEventId = randomUUID();
      await c.query("INSERT INTO observation_edit_event(id,request_id,observation_id,actor_subject,event_type) VALUES($1,$2,$3,$4,'submitted')",
        [notificationEventId, id, observationId, subject(req.user)]);
      if (officerNotifications) await officerNotifications.enqueueObservationEdit(c, id, notificationEventId);
      await audit(c, req.user, "observation_edit_submitted", id);
      return exposed(row);
    });
    res.status(201).json({ edit: result });
  });
  app.get("/api/observation-edits", read, async (req, res) => {
    await requireAvailable(pool);
    const rows = (await pool.query(`SELECT * FROM observation_edit_request WHERE ($1 OR owner_subject=$2)
      ORDER BY updated_at DESC LIMIT 500`, [permitted(req.user, "observations.review"), subject(req.user)])).rows;
    const initialRows = await versioningAvailable(pool) ? await verifiedInitialChanges(pool, req.user) : [];
    if (await versioningAvailable(pool)) {
      const activeLegacyIds = new Set(rows.filter(row => ["Pending Review", "Correction Required"].includes(row.status))
        .map(row => String(row.observation_id)));
      if (initialRows.some(row => ["Pending Review", "Correction Required"].includes(row.status) &&
          activeLegacyIds.has(String(row.base_snapshot.observation_id))))
        fail(409, "This Observation has both a legacy edit and a parent change active. Contact support before reviewing either request.");
    }
    const merged = [...rows.map(exposed), ...await Promise.all(initialRows.map(row => initialChangeEdit(pool, row)))]
      .sort((a, b) => Date.parse(b.updated_at || b.created_at || 0) - Date.parse(a.updated_at || a.created_at || 0))
      .slice(0, 500);
    res.json({ edits: merged });
  });
  app.get("/api/observation-edits/:id", read, async (req, res) => {
    await requireAvailable(pool);
    if (await versioningAvailable(pool)) {
      const parent = await initialParentChange(pool, req.params.id, req.user);
      if (parent) return res.json({ edit: await initialChangeEdit(pool, parent) });
    }
    const row = (await pool.query("SELECT * FROM observation_edit_request WHERE id=$1 AND ($2 OR owner_subject=$3)",
      [req.params.id, permitted(req.user, "observations.review"), subject(req.user)])).rows[0];
    if (!row) fail(404, "Observation edit unavailable.");
    if (await versioningAvailable(pool)) await verifiedLegacyInitialRequest(pool, row);
    res.json({ edit: exposed(row) });
  });
  app.get("/api/observation-edits/:id/photos/:index", read, async (req, res) => {
    await requireAvailable(pool);
    if (!/^(0|[1-2])$/.test(req.params.index)) fail(400, "Invalid photo index.");
    const row = (await pool.query("SELECT added_photos FROM observation_edit_request WHERE id=$1 AND ($2 OR owner_subject=$3)",
      [req.params.id, permitted(req.user, "observations.review"), subject(req.user)])).rows[0];
    let photo = row?.added_photos?.[Number(req.params.index)];
    if (row && await versioningAvailable(pool)) {
      const request = (await pool.query("SELECT * FROM observation_edit_request WHERE id=$1", [req.params.id])).rows[0];
      if (request) await verifiedLegacyInitialRequest(pool, request);
    }
    if (!row && await versioningAvailable(pool)) {
      const parent = await initialParentChange(pool, req.params.id, req.user);
      photo = parent?.proposed_snapshot?.photos?.[Number(req.params.index)];
    }
    if (!photo) fail(404, "Proposed photo unavailable.");
    res.type("image/jpeg").send(Buffer.from(photo.base64, "base64"));
  });
  app.get("/api/observations/:id/edit-history", read, async (req, res) => {
    await requireAvailable(pool);
    const observation = (await pool.query("SELECT * FROM plant_observation WHERE id=$1", [req.params.id])).rows[0];
    if (!observation || (!permitted(req.user, "observations.review") && observation.owner_subject !== subject(req.user))) fail(404, "Observation history unavailable.");
    const [legacyVersions, legacyEdits, legacyEvents] = await Promise.all([
      pool.query("SELECT id,observation_id,version_number,content,photo_ids,edit_request_id,approved_at FROM observation_version_history WHERE observation_id=$1 ORDER BY version_number", [observation.id]),
      pool.query("SELECT * FROM observation_edit_request WHERE observation_id=$1 ORDER BY created_at", [observation.id]),
      pool.query(`SELECT id,request_id,observation_id,actor_subject,event_type,comment,created_at,
        to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US') AS exact_created_at
        FROM observation_edit_event WHERE observation_id=$1 ORDER BY created_at,id`, [observation.id]),
    ]);
    if (legacyVersions.rows.some(row => !validPhotoIds(row.photo_ids))) evidenceInvalid();
    let versions = legacyVersions.rows, edits = legacyEdits.rows.map(exposed), events = legacyEvents.rows;
    if (legacyEdits.rows.length && (await pool.query("SELECT to_regclass(current_schema() || '.botanist_notification') IS NOT NULL AS available")).rows[0]?.available) {
      const requestIds = legacyEdits.rows.map(row => row.id);
      const persistedLegacyReviews = (await pool.query(`SELECT id,type,metadata,created_at,
        to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US') AS exact_created_at FROM botanist_notification
        WHERE recipient_subject=$1 AND metadata->>'entityType'='legacy_observation_edit'
          AND metadata->>'requestId'=ANY($2::text[]) ORDER BY created_at,id`,
      [observation.owner_subject, requestIds])).rows;
      const reviewTypes = { observation_approved: "approved", observation_rejected: "rejected", correction_requested: "correction_required" };
      events = [...events, ...persistedLegacyReviews.filter(row => reviewTypes[row.type] &&
        Number.isInteger(row.metadata?.revision) && typeof row.metadata?.reviewedBy === "string").map(row => ({
        id: row.id, request_id: row.metadata.requestId, observation_id: observation.id,
        actor_subject: row.metadata.reviewedBy, event_type: reviewTypes[row.type],
        comment: typeof row.metadata.comment === "string" ? row.metadata.comment : null,
        revision: row.metadata.revision, created_at: row.created_at, exact_created_at: row.exact_created_at,
      }))];
    }
    if (await versioningAvailable(pool)) {
      const origin = (await classifyObservations(pool, [observation]))[0]?.origin_type;
      if (origin === "subsequent_observation") {
        const submitted = (await pool.query(`SELECT id,observation_id,version_number,submission_type,status,
          owner_subject,request_id AS edit_request_id,request_revision,based_on_version_id,
          correction_review_id,correction_edit_event_id,content,photo_refs AS photo_ids,
          reviewed_by,reviewed_at,review_comment,submitted_at,baseline_captured_at,created_at,
          COALESCE((SELECT r.decision FROM observation_review r WHERE r.submission_version_id=observation_submission_version.id
            ORDER BY r.created_at DESC,r.id DESC LIMIT 1),
            (SELECT CASE e.event_type WHEN 'approved' THEN 'Approved' WHEN 'rejected' THEN 'Rejected'
              WHEN 'correction_required' THEN 'Correction Required' WHEN 'flagged' THEN 'Flagged' END
              FROM observation_edit_event e WHERE e.submission_version_id=observation_submission_version.id
                AND e.event_type IN ('approved','rejected','correction_required','flagged')
              ORDER BY e.created_at DESC,e.id DESC LIMIT 1)) AS review_decision
          FROM observation_submission_version WHERE observation_id=$1 ORDER BY version_number,id`,
        [observation.id])).rows;
        if (submitted.length) {
          const versionedRequests = new Set(submitted.map(row => row.edit_request_id).filter(Boolean));
          const baseline = submitted.find(row => row.submission_type === "legacy_baseline");
          versions = [...versions.filter(row => !versionedRequests.has(row.edit_request_id) &&
              !(baseline && Number(row.version_number) === 0 &&
                JSON.stringify(row.content) === JSON.stringify(baseline.content) &&
                JSON.stringify(row.photo_ids) === JSON.stringify(baseline.photo_ids)))
            .map(row => ({ ...row, legacy: true })), ...submitted.map(row => ({ ...row, verified: true,
              approved_at: row.reviewed_at }))]
            .sort((a, b) => Number(a.version_number) - Number(b.version_number) || String(a.id).localeCompare(String(b.id)));
        } else versions = versions.map(row => ({ ...row, legacy: true }));
      }
      const parentRows = (await pool.query(`SELECT * FROM record_change_submission
        WHERE plant_id=(SELECT plant_id FROM plant_observation WHERE id=$1)
          AND base_snapshot->>'workflow_type'=$2 AND base_snapshot->>'observation_id'=$1
        ORDER BY created_at,id`, [observation.id, initialObservationWorkflow])).rows;
      if (parentRows.length) {
        const origins = (await classifyObservations(pool, [observation]))[0]?.origin_type;
        if (origins !== "initial_registration" || parentRows.some(row => row.owner_subject !== observation.owner_subject))
          fail(409, "Observation origin cannot be verified for its edit history.");
        const parentIds = parentRows.map(row => row.id);
        const snapshots = (await pool.query(`SELECT * FROM record_version_history
          WHERE change_id=ANY($1::text[]) AND record_type='plant'
            AND snapshot->>'workflow_type'=$2 AND snapshot->>'observation_id'=$3
          ORDER BY created_at,id`, [parentIds, initialObservationWorkflow, observation.id])).rows;
        if (snapshots.length === 0) fail(409, "Initial Observation version history is unavailable.");
        const reviewEvents = (await pool.query(`SELECT id,change_id,revision,status,reviewer_subject,comment,created_at
          FROM record_change_review_event WHERE change_id=ANY($1::text[]) ORDER BY created_at,id`, [parentIds])).rows;
        const auditEvents = (await pool.query(`SELECT id,target,actor_subject,action,created_at FROM business_audit
          WHERE target=ANY($1::text[]) AND action IN ('record_change_submitted','record_change_resubmitted','record_change_cancelled')
          ORDER BY created_at,id`, [parentIds])).rows;
        const requestById = new Map(parentRows.map(row => [row.id, row]));
        const legacyMax = Math.max(0, ...versions.map(row => Number(row.version_number) || 0));
        const sealedPhotos = snapshots.filter(row => row.photo_refs_sealed).length
          ? (await pool.query(`SELECT version_id,asset_id,position FROM plant_record_version_photo
              WHERE version_id=ANY($1::text[]) AND observation_id=$2 ORDER BY version_id,position`,
            [snapshots.filter(row => row.photo_refs_sealed).map(row => row.id), observation.id])).rows : [];
        const photoIds = new Map();
        for (const photo of sealedPhotos) photoIds.set(photo.version_id,
          [...(photoIds.get(photo.version_id) || []), photo.asset_id]);
        const snapshotEdits = snapshots.map((version, index) => {
          const parent = requestById.get(version.change_id);
          if (!parent || !Number.isInteger(version.change_revision)) fail(409, "Initial Observation version lineage is incomplete.");
          const currentRevision = version.change_revision === parent.revision;
          const editId = currentRevision ? parent.id : `${parent.id}#revision-${version.change_revision}`;
          const proposed = version.snapshot || {};
          const edit = exposed({ id: editId, observation_id: observation.id, owner_subject: parent.owner_subject,
            status: version.status, revision: version.change_revision,
            version_number: parentRows.findIndex(item => item.id === parent.id) + 1,
            base_revision: parent.base_snapshot.observation_revision,
            base_snapshot: { content: parent.base_snapshot.content, revision: parent.base_snapshot.observation_revision,
              photo_ids: parent.base_snapshot.photo_ids || [] },
            proposed_content: proposed.content || {}, retained_photo_ids: proposed.photo_ids || [],
            added_photos: (parent.revision === version.change_revision ? parent.proposed_snapshot.photos : [] ) || [],
            review_comment: version.review_comment, reviewed_by: version.reviewed_by, reviewed_at: version.reviewed_at,
            created_at: version.created_at, updated_at: version.created_at });
          return { id: version.id, observation_id: observation.id, version_number: legacyMax + index + 1,
            content: proposed.content || {}, photo_ids: version.photo_refs_sealed ? photoIds.get(version.id) || [] : [],
            verified: Boolean(version.photo_refs_sealed), legacy: !version.photo_refs_sealed, edit_request_id: editId,
            approved_at: version.reviewed_at, status: version.status, review_comment: version.review_comment,
            review_decision: reviewEvents.find(event => event.change_id === version.change_id &&
              event.revision === version.change_revision)?.status || null,
            reviewed_by: version.reviewed_by, created_at: version.created_at };
        });
        const mappedEvents = [
          ...reviewEvents.map(event => ({ id: event.id, request_id: event.change_id, observation_id: observation.id,
            actor_subject: event.reviewer_subject, event_type: event.status.toLowerCase().replace(/ /g, "_"),
            comment: event.comment, created_at: event.created_at, revision: event.revision })),
          ...auditEvents.map(event => ({ id: event.id, request_id: event.target, observation_id: observation.id,
            actor_subject: event.actor_subject, event_type: event.action.replace("record_change_", ""),
            comment: null, created_at: event.created_at })),
        ];
        versions = [...versions, ...snapshotEdits];
        edits = [...edits, ...snapshotEdits.map(item => item.edit)];
        events = [...events, ...mappedEvents].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
      }
    }
    events = events.sort((a, b) => {
      const exactOrder = a.exact_created_at && b.exact_created_at
        ? a.exact_created_at.localeCompare(b.exact_created_at) : 0;
      return exactOrder || Date.parse(a.created_at) - Date.parse(b.created_at) ||
        (a.request_id === b.request_id && Number.isInteger(a.revision) && Number.isInteger(b.revision) ? a.revision - b.revision : 0) ||
        String(a.id).localeCompare(String(b.id));
    });
    events = events.map(({ exact_created_at: _exactCreatedAt, ...event }) => event);
    res.json({ versions, edits, events });
  });
  app.get("/api/observation-versions/:id/photos/:index", read, async (req, res) => {
    await requireAvailable(pool);
    if (!/^(0|[1-2])$/.test(req.params.index)) fail(400, "Invalid photo index.");
    const version = (await pool.query(`SELECT v.photo_ids,v.observation_id,v.owner_subject,
        o.plant_id FROM observation_version_history v JOIN plant_observation o ON o.id=v.observation_id
      WHERE v.id=$1 AND ($2 OR v.owner_subject=$3)`,
    [req.params.id, permitted(req.user, "observations.review"), subject(req.user)])).rows[0];
    let asset;
    const assetId = version?.photo_ids?.[Number(req.params.index)];
    if (assetId) asset = (await pool.query(`SELECT content,content_type FROM plant_asset
      WHERE id=$1 AND plant_id=$2 AND owner_subject=$3`,
    [assetId, version.plant_id, version.owner_subject])).rows[0];
    if (!asset && await versioningAvailable(pool)) {
      const submitted = (await pool.query(`SELECT v.id,v.observation_id,v.owner_subject,o.plant_id,
        p.asset_id FROM observation_submission_version v
        JOIN plant_observation o ON o.id=v.observation_id
        JOIN observation_submission_photo p ON p.version_id=v.id AND p.observation_id=v.observation_id
          AND p.position=$2 AND p.owner_subject=v.owner_subject AND p.plant_id=o.plant_id
        WHERE v.id=$1 AND ($3 OR v.owner_subject=$4)`,
      [req.params.id, Number(req.params.index), permitted(req.user, "observations.review"), subject(req.user)])).rows[0];
      if (submitted && (await classifyObservations(pool, [(await pool.query(
        "SELECT * FROM plant_observation WHERE id=$1", [submitted.observation_id])).rows[0]]))[0]?.origin_type === "subsequent_observation")
        asset = (await pool.query(`SELECT content,content_type FROM plant_asset WHERE id=$1
          AND plant_id=$2 AND owner_subject=$3`,
        [submitted.asset_id, submitted.plant_id, submitted.owner_subject])).rows[0];
      const historicalVersion = (await pool.query(`SELECT id,plant_id,owner_subject,snapshot FROM record_version_history
        WHERE id=$1 AND record_type='plant' AND photo_refs_sealed=TRUE
          AND snapshot->>'workflow_type'=$2 AND ($3 OR owner_subject=$4)`,
      [req.params.id, initialObservationWorkflow, permitted(req.user, "observations.review"), subject(req.user)])).rows[0];
      if (historicalVersion) {
        const targetObservation = (await pool.query("SELECT * FROM plant_observation WHERE id=$1 AND plant_id=$2",
          [historicalVersion.snapshot.observation_id, historicalVersion.plant_id])).rows[0];
        if (!targetObservation || (await classifyObservations(pool, [targetObservation]))[0]?.origin_type !== "initial_registration")
          fail(409, "Observation origin cannot be verified for this photo history.");
        const historical = (await pool.query(`SELECT p.asset_id FROM plant_record_version_photo p
          WHERE p.version_id=$1 AND p.observation_id=$2 AND p.position=$3`,
        [historicalVersion.id, targetObservation.id, Number(req.params.index)])).rows[0];
        if (historical) asset = (await pool.query(`SELECT content,content_type FROM plant_asset
          WHERE id=$1 AND owner_subject=$2 AND plant_id=$3`,
        [historical.asset_id, historicalVersion.owner_subject, historicalVersion.plant_id])).rows[0];
      }
    }
    if (!asset) fail(404, "Historical observation photo unavailable.");
    res.type(asset.content_type).send(asset.content);
  });
  app.patch("/api/observation-edits/:id", allow("observations.create"), async (req, res) => {
    const { revision, source_languages: rawSourceLanguages, ...input } = req.body || {};
    const sourceLanguages = normalizeSourceLanguages(rawSourceLanguages, ["morphology", "notes"]);
    if (!Number.isInteger(revision)) fail(400, "Edit revision is required.");
    if (await versioningAvailable(pool)) {
      const parent = await initialParentChange(pool, req.params.id, req.user);
      if (parent) {
        await proposal(input);
        await resubmitInitialObservationEdit(pool, { user: req.user, changeId: parent.id, revision, ...input,
          source_languages: sourceLanguages });
        const updated = (await pool.query("SELECT * FROM record_change_submission WHERE id=$1", [parent.id])).rows[0];
        return res.json({ edit: await initialChangeEdit(pool, updated) });
      }
    }
    const proposed = await proposal(input);
    const result = await versions.withVersionTransaction(pool, async (c) => {
      await requireAvailable(c);
      const { observation, request: row } = await lockEditTargets(c, req.params.id, subject(req.user));
      if (row.status !== "Correction Required" || row.revision !== revision) fail(409, "Reload the correction request before resubmitting.");
      assertPhotoEvidence(row);
      if (observation.status !== "Approved" || observation.revision !== row.base_revision) fail(409, "Approved observation changed. Start a fresh edit.");
      const versioning = await versioningAvailable(c);
      if (versioning) {
        const legacyInitial = await verifiedLegacyInitialRequest(c, row, { observation });
        if (legacyInitial) {
          const retained = proposed.photoIds === undefined ? row.retained_photo_ids : proposed.photoIds;
          if (JSON.stringify(retained) !== JSON.stringify(row.retained_photo_ids))
            fail(409, "Existing legacy photos cannot be removed or reordered safely. Keep the current photo selection and retry.");
          const added = [...(row.added_photos || []), ...proposed.photos];
          if (retained.length + added.length > 3) fail(409, "The preserved legacy photos exceed the Observation photo limit.");
          const nextRevision = row.revision + 1;
          const updated = (await c.query(`UPDATE observation_edit_request SET proposed_content=$1,added_photos=$2,
            revision=$3,status='Pending Review',review_comment=NULL,reviewed_by=NULL,reviewed_at=NULL,
            updated_at=CURRENT_TIMESTAMP WHERE id=$4 AND revision=$5 AND status='Correction Required' RETURNING *`,
          [proposed.content, JSON.stringify(added), nextRevision, row.id, row.revision])).rows[0];
          if (!updated) fail(409, "Reload the correction request before resubmitting.");
          await stageSourceLanguages(c, { submissionType: "observation_edit", submissionId: row.id,
            values: proposed.content, selections: sourceLanguages, fieldMap: { morphology: "morphology", notes: "notes" } });
          const notificationEventId = randomUUID();
          await c.query("INSERT INTO observation_edit_event(id,request_id,observation_id,actor_subject,event_type) VALUES($1,$2,$3,$4,'resubmitted')",
            [notificationEventId, row.id, row.observation_id, subject(req.user)]);
          if (officerNotifications) await officerNotifications.enqueueObservationEdit(c, row.id, notificationEventId);
          await audit(c, req.user, "observation_edit_resubmitted", row.id);
          return exposed(updated);
        }
      }
      const origin = (await classifyObservations(c, [observation]))[0]?.origin_type;
      if (versioning && origin !== "subsequent_observation")
        fail(409, "Observation origin cannot be verified for correction resubmission.");
      let sourceVersion = null;
      let correctionEvent = null;
      if (versioning) {
        sourceVersion = (await c.query(`SELECT * FROM observation_submission_version
          WHERE request_id=$1 AND request_revision=$2 AND status='Correction Required' FOR UPDATE`, [row.id, row.revision])).rows[0];
        if (!sourceVersion) fail(409, "The exact correction version is unavailable. Reload before resubmitting.");
        correctionEvent = (await c.query(`SELECT id FROM observation_edit_event
          WHERE observation_id=$1 AND request_id=$2 AND request_revision=$3
            AND submission_version_id=$4 AND event_type='correction_required'`,
        [observation.id, row.id, row.revision, sourceVersion.id])).rows[0];
        if (!correctionEvent) fail(409, "The correction decision cannot be linked to this version.");
      }
      const additions = input.photos === undefined ? row.added_photos : proposed.photos;
      const selected = await selectedPhotos(c, row.observation_id,
        input.photo_ids === undefined ? row.retained_photo_ids : proposed.photoIds, additions);
      const updated = (await c.query(`UPDATE observation_edit_request SET proposed_content=$1,retained_photo_ids=$2,added_photos=$3,
        revision=revision+1,status='Pending Review',review_comment=NULL,reviewed_by=NULL,reviewed_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$4 RETURNING *`,
      [proposed.content, JSON.stringify(selected.retained), JSON.stringify(additions), row.id])).rows[0];
      await stageSourceLanguages(c, { submissionType: "observation_edit", submissionId: row.id,
        values: proposed.content, selections: sourceLanguages, fieldMap: { morphology: "morphology", notes: "notes" } });
      if (versioning) {
        await versions.transitionVersion(c, { observationId: observation.id, versionId: sourceVersion.id,
          status: "Superseded", actorSubject: subject(req.user) });
        await insertEditSnapshot(c, observation, updated, selected.retained, additions, sourceVersion.id, req.user, correctionEvent.id);
      }
      const notificationEventId = randomUUID();
      await c.query("INSERT INTO observation_edit_event(id,request_id,observation_id,actor_subject,event_type) VALUES($1,$2,$3,$4,'resubmitted')",
        [notificationEventId, row.id, row.observation_id, subject(req.user)]);
      if (officerNotifications) await officerNotifications.enqueueObservationEdit(c, row.id, notificationEventId);
      await audit(c, req.user, "observation_edit_resubmitted", row.id);
      return exposed(updated);
    });
    res.json({ edit: result });
  });
  app.post("/api/observation-edits/:id/cancel", allow("observations.create"), async (req, res) => {
    if (req.body && Object.keys(req.body).length) fail(400, "Cancellation does not accept proposal changes.");
    if (await versioningAvailable(pool)) {
      const parent = await initialParentChange(pool, req.params.id, req.user);
      if (parent) {
        await cancelInitialObservationEdit(pool, { user: req.user, changeId: parent.id });
        const updated = (await pool.query("SELECT * FROM record_change_submission WHERE id=$1", [parent.id])).rows[0];
        return res.json({ edit: await initialChangeEdit(pool, updated) });
      }
    }
    const result = await versions.withVersionTransaction(pool, async (c) => {
      await requireAvailable(c);
      const { observation, request: edit } = await lockEditTargets(c, req.params.id, subject(req.user));
      if (!canCancelEdit(edit.status, edit.revision)) fail(409, "Only an active observation edit can be cancelled.");
      if (await versioningAvailable(c)) {
        const legacyInitial = await verifiedLegacyInitialRequest(c, edit, { observation });
        const origin = (await classifyObservations(c, [observation]))[0]?.origin_type;
        if (!origin || origin === "unknown") fail(409, "Observation origin cannot be verified for cancellation.");
        if (!legacyInitial && origin === "subsequent_observation") {
          const version = (await c.query(`SELECT * FROM observation_submission_version
            WHERE request_id=$1 AND request_revision=$2 ORDER BY version_number DESC LIMIT 1 FOR UPDATE`,
          [edit.id, edit.revision])).rows[0];
          // A legacy request created before Migration 030 has no safe version
          // evidence to transition. Owner cancellation closes it without
          // changing the approved canonical Observation.
          if (version) await versions.transitionVersion(c, { observationId: observation.id, versionId: version.id,
            status: "Cancelled", actorSubject: subject(req.user) });
        }
      }
      const updated = (await c.query(`UPDATE observation_edit_request SET status='Cancelled',cancelled_by=$1,cancelled_at=CURRENT_TIMESTAMP,
        updated_at=CURRENT_TIMESTAMP WHERE id=$2 RETURNING id,status,cancelled_at`, [subject(req.user), edit.id])).rows[0];
      await c.query("INSERT INTO observation_edit_event(id,request_id,observation_id,actor_subject,event_type,comment) VALUES($1,$2,$3,$4,'cancelled','Cancelled by owner')",
        [randomUUID(), edit.id, edit.observation_id, subject(req.user)]);
      await audit(c, req.user, "observation_edit_cancelled", edit.id);
      return updated;
    });
    res.json({ edit: result });
  });
  app.post("/api/observation-edits/:id/review", allow("observations.review"), async (req, res) => {
    if (!req.body || !["Approved", "Rejected", "Correction Required"].includes(req.body.decision) ||
      Object.keys(req.body).some((key) => !["decision", "comment", "revision", "source_languages"].includes(key)) ||
      (!Number.isSafeInteger(req.body.revision) || req.body.revision < 1))
      fail(400, "Invalid review decision.");
    const versioning = await versioningAvailable(pool);
    if (req.body.comment !== undefined && (typeof req.body.comment !== "string" || req.body.comment.length > 4000))
      fail(400, "Invalid review comment.");
    const comment = typeof req.body.comment === "string" ? req.body.comment.trim() : "";
    if (req.body.decision !== "Approved" && !comment)
      fail(400, "Officer feedback is required for this decision.");
    if (versioning) {
      const parent = await initialParentChange(pool, req.params.id, req.user);
      if (parent) {
        if (parent.revision !== req.body.revision) fail(409, "This edit revision is out of date. Reload before reviewing.");
        await reviewInitialObservationEdit(pool, { user: req.user, changeId: parent.id,
          revision: req.body.revision, decision: req.body.decision, comment });
        const updated = (await pool.query("SELECT * FROM record_change_submission WHERE id=$1", [parent.id])).rows[0];
        return res.json({ edit: await initialChangeEdit(pool, updated) });
      }
    }
    const result = await versions.withVersionTransaction(pool, async (c) => {
      await requireAvailable(c);
      const { observation, request: edit } = await lockEditTargets(c, req.params.id);
      if (edit.status !== "Pending Review") fail(409, "This proposal is not pending review.");
      if (edit.owner_subject === subject(req.user)) fail(403, "You cannot review your own edit.");
      if (!observation || observation.id !== edit.observation_id) fail(409, "Observation edit parent changed.");
      const currentIds = await photoIds(c, edit.observation_id);
      const base = { content: observation?.content, revision: observation?.revision, photo_ids: currentIds };
      if (!observation || observation.status !== "Approved" || hash(base) !== edit.base_fingerprint)
        fail(409, "Approved observation changed since this proposal.");
      const versioned = await versioningAvailable(c);
      const legacyInitial = versioned ? await verifiedLegacyInitialRequest(c, edit, { observation }) : null;
      if (edit.revision !== req.body.revision)
        fail(409, "This edit revision is out of date. Reload before reviewing.");
      assertPhotoEvidence(edit);
      if (legacyInitial) {
        if (req.body.decision !== "Approved" && !comment)
          fail(400, "Officer feedback is required for this decision.");
        let addedIds = [];
        if (req.body.decision === "Approved") {
          const retained = edit.retained_photo_ids || [];
          const additions = edit.added_photos || [];
          if (new Set(retained).size !== retained.length || retained.some(id => !currentIds.includes(id)) ||
              retained.length + additions.length < 1 || retained.length + additions.length > 3)
            fail(409, "The legacy Observation photo selection is no longer valid.");
          const lockIds = [...new Set(currentIds)].sort();
          const lockedAssets = (await c.query(`SELECT id,plant_id,owner_subject,observation_id,approved,content_type
            FROM plant_asset WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE`, [lockIds])).rows;
          const byId = new Map(lockedAssets.map(asset => [asset.id, asset]));
          if (lockedAssets.length !== lockIds.length || currentIds.some(id => {
            const asset = byId.get(id);
            return !asset || asset.plant_id !== observation.plant_id || asset.owner_subject !== edit.owner_subject ||
              asset.observation_id !== observation.id || asset.approved !== true || !["image/jpeg", "image/png"].includes(asset.content_type);
          })) fail(409, "Observation photo ownership changed. Reload before approving this legacy edit.");
          for (const photo of additions) {
            if (!photo || photo.content_type !== "image/jpeg" || typeof photo.base64 !== "string" ||
                !/^[A-Za-z0-9+/]+={0,2}$/.test(photo.base64))
              fail(409, "A legacy edit photo is invalid and cannot be approved safely.");
            const bytes = Buffer.from(photo.base64, "base64");
            if (!bytes.length || bytes.length > 4194304) fail(409, "A legacy edit photo is invalid and cannot be approved safely.");
          }
          addedIds = await stagedPhotos(c, observation, `${edit.id}:legacy`, edit.revision, additions);
          if (addedIds.length) {
            const attached = await c.query(`UPDATE plant_asset SET approved=TRUE
              WHERE id=ANY($1::text[]) AND plant_id=$2 AND owner_subject=$3 AND observation_id=$4 AND approved=FALSE`,
            [addedIds, observation.plant_id, edit.owner_subject, observation.id]);
            if (attached.rowCount !== addedIds.length) fail(409, "A preserved legacy edit photo could not be attached safely.");
          }
          const removed = currentIds.filter(id => !retained.includes(id));
          if (removed.length) await c.query("UPDATE plant_asset SET observation_id=NULL,approved=FALSE WHERE id=ANY($1::text[])", [removed]);
          const changed = await c.query(`UPDATE plant_observation SET content=$1,revision=revision+1,updated_at=CURRENT_TIMESTAMP
            WHERE id=$2 AND plant_id=$3 AND owner_subject=$4 AND status='Approved' AND revision=$5`,
          [edit.proposed_content, observation.id, observation.plant_id, edit.owner_subject, edit.base_revision]);
          if (changed.rowCount !== 1) fail(409, "The approved initial Observation changed before this edit was applied.");
          await promoteSourceLanguages(c, { submissionType: "observation_edit", submissionId: edit.id,
            recordType: "observation", recordId: observation.id, values: edit.proposed_content,
            fieldMap: { morphology: "morphology", notes: "notes" } });
          if (edit.proposed_content.latitude !== undefined)
            await c.query("INSERT INTO plant_location(plant_id,latitude,longitude,accuracy_m) VALUES($1,$2,$3,$4)",
              [observation.plant_id, edit.proposed_content.latitude, edit.proposed_content.longitude, edit.proposed_content.accuracy_m ?? null]);
          const nextVersion = Number((await c.query("SELECT COALESCE(MAX(version_number),0)+1 AS next FROM observation_version_history WHERE observation_id=$1", [observation.id])).rows[0].next);
          await c.query(`INSERT INTO observation_version_history(id,observation_id,version_number,owner_subject,content,photo_ids,edit_request_id)
            VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [randomUUID(), observation.id, nextVersion, edit.owner_subject, edit.proposed_content, JSON.stringify([...retained, ...addedIds]), edit.id]);
        }
        const updated = (await c.query(`UPDATE observation_edit_request SET status=$1,review_comment=$2,reviewed_by=$3,
          reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$4 AND status='Pending Review' AND revision=$5 RETURNING *`,
        [req.body.decision, comment || null, subject(req.user), edit.id, edit.revision])).rows[0];
        if (!updated) fail(409, "This legacy edit revision is no longer pending review.");
        // Migration 030 requires exact immutable version linkage on Officer decision
        // events. These pre-migration requests have no such version, so keep their
        // original event history untouched and persist the decision on the legacy
        // request row plus normal audit/notification records instead.
        await notifyLegacyInitialDecision(c, updated, observation, req.body.decision, comment, subject(req.user));
        await audit(c, req.user, `observation_edit_${req.body.decision.toLowerCase().replace(" ", "_")}`, edit.id);
        return exposed(updated);
      }
      let reviewVersion = null;
      let reviewId = null;
      if (versioned) {
        if (!(await verifiedSubsequent(c, observation))) fail(409, "Observation origin cannot be verified for Officer review.");
        reviewVersion = (await c.query(`SELECT * FROM observation_submission_version
          WHERE request_id=$1 AND request_revision=$2 AND status='Pending Review' FOR UPDATE`,
        [edit.id, edit.revision])).rows[0];
        if (!reviewVersion || reviewVersion.owner_subject !== edit.owner_subject)
          fail(409, "The exact pending Observation edit version is unavailable.");
        reviewId = randomUUID();
        await c.query(`INSERT INTO observation_edit_event(id,request_id,observation_id,actor_subject,event_type,comment,
          request_revision,submission_version_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [reviewId, edit.id, observation.id, subject(req.user), req.body.decision.toLowerCase().replace(" ", "_"), comment,
          edit.revision, reviewVersion.id]);
        const reviewerSubject = subject(req.user);
        const verifyOfficer = async actor => actor === reviewerSubject && permitted(req.user, "observations.review");
        if (req.body.decision === "Approved") {
          const ancestor = await versions.approvedVersionAncestor(c, observation.id, reviewVersion.id);
          if (!ancestor || ancestor.status !== "Approved") fail(409, "No verified current Approved version can be replaced.");
          await versions.transitionVersion(c, { observationId: observation.id, versionId: ancestor.id,
            status: "Superseded", actorSubject: reviewerSubject });
        }
        await versions.transitionVersion(c, { observationId: observation.id, versionId: reviewVersion.id,
          status: req.body.decision, actorSubject: reviewerSubject, reviewEventId: reviewId, verifyOfficer });
      }
      if (req.body.decision === "Approved") {
        if (edit.retained_photo_ids.some((id) => !currentIds.includes(id))) fail(409, "Observation photos changed.");
        const removed = currentIds.filter((id) => !edit.retained_photo_ids.includes(id));
        let addedIds = [];
        if (versioned) addedIds = reviewVersion.photo_refs.slice(edit.retained_photo_ids.length);
        else for (const [index, photo] of edit.added_photos.entries()) {
          const assetId = randomUUID(); addedIds.push(assetId);
          await c.query(`INSERT INTO plant_asset(id,plant_id,owner_subject,client_key,observation_id,approved,content_type,content)
            VALUES($1,$2,$3,$4,$5,TRUE,'image/jpeg',$6)`,
          [assetId, observation.plant_id, edit.owner_subject, `observation-edit:${edit.id}:${index}`, observation.id, Buffer.from(photo.base64, "base64")]);
        }
        if (versioned) {
          const assetIds = [...new Set([...currentIds, ...reviewVersion.photo_refs])];
          const locked = (await c.query("SELECT id FROM plant_asset WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE", [assetIds])).rows;
          if (locked.length !== assetIds.length) fail(409, "Observation photo assets changed before approval.");
        }
        if (removed.length) await c.query("UPDATE plant_asset SET observation_id=NULL,approved=FALSE WHERE id=ANY($1::text[])", [removed]);
        if (addedIds.length) await c.query("UPDATE plant_asset SET approved=TRUE WHERE id=ANY($1::text[]) AND observation_id=$2 AND owner_subject=$3",
          [addedIds, observation.id, edit.owner_subject]);
        await c.query("UPDATE plant_observation SET content=$1,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=$2",
          [edit.proposed_content, observation.id]);
        await promoteSourceLanguages(c, { submissionType: "observation_edit", submissionId: edit.id,
          recordType: "observation", recordId: observation.id, values: edit.proposed_content,
          fieldMap: { morphology: "morphology", notes: "notes" } });
        if (edit.proposed_content.latitude !== undefined)
          await c.query("INSERT INTO plant_location(plant_id,latitude,longitude,accuracy_m) VALUES($1,$2,$3,$4)",
            [observation.plant_id, edit.proposed_content.latitude, edit.proposed_content.longitude,
              edit.proposed_content.accuracy_m ?? null]);
        if (!versioned) {
          const nextVersion = Number((await c.query("SELECT COALESCE(MAX(version_number),0)+1 AS next FROM observation_version_history WHERE observation_id=$1", [observation.id])).rows[0].next);
          await c.query(`INSERT INTO observation_version_history(id,observation_id,version_number,owner_subject,content,photo_ids,edit_request_id)
            VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [randomUUID(), observation.id, nextVersion, edit.owner_subject, edit.proposed_content, JSON.stringify([...edit.retained_photo_ids, ...addedIds]), edit.id]);
        }
      }
      const updated = (await c.query(`UPDATE observation_edit_request SET status=$1,review_comment=$2,reviewed_by=$3,
        reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$4 RETURNING *`,
      [req.body.decision, comment, subject(req.user), edit.id])).rows[0];
      if (!versioned) await c.query("INSERT INTO observation_edit_event(id,request_id,observation_id,actor_subject,event_type,comment) VALUES($1,$2,$3,$4,$5,$6)",
        [randomUUID(), edit.id, observation.id, subject(req.user), req.body.decision.toLowerCase().replace(" ", "_"), comment]);
      await audit(c, req.user, `observation_edit_${req.body.decision.toLowerCase().replace(" ", "_")}`, edit.id);
      return exposed(updated);
    });
    res.json({ edit: result });
  });
}
module.exports = { mountObservationEdits };
