"use strict";
const { randomUUID, createHash } = require("node:crypto");
const sharp = require("sharp");
const { permitted } = require("../shared/rbac.cjs");
const { transaction, audit, subject, fail, text, fieldContent, speciesRow } = require("./domain.cjs");

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const validId = (value) => typeof value === "string" && /^[a-f0-9-]{8,80}$/i.test(value);
const exposed = (row) => {
  const { added_photos, ...safe } = row;
  return { ...safe, added_photo_count: Array.isArray(added_photos) ? added_photos.length : 0 };
};
async function available(c) {
  return Boolean((await c.query("SELECT to_regclass(current_schema() || '.observation_edit_request') IS NOT NULL AS available")).rows[0]?.available);
}
async function requireAvailable(c) {
  if (!(await available(c))) fail(503, "Observation edit requests require migration 016.");
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
function mountObservationEdits(app, { pool, allow }) {
  const read = (req, res, next) => allow(permitted(req.user, "observations.review") ? "observations.review" : "observations.create")(req, res, next);
  app.get("/api/observation-edits/capabilities", read, async (_req, res) => res.json({ available: await available(pool) }));
  app.post("/api/observation-edits", allow("observations.create"), async (req, res) => {
    const { observation_id: observationId, client_key: clientKey, ...input } = req.body || {};
    if (!validId(observationId) || typeof clientKey !== "string" || !clientKey.trim() || clientKey.length > 100) fail(400, "Invalid observation edit reference.");
    const proposed = await proposal(input);
    const payloadHash = hash({ observationId, proposed });
    const result = await transaction(pool, async (c) => {
      await requireAvailable(c);
      const observation = await ownedObservation(c, observationId, req.user, true);
      if (observation.status !== "Approved") fail(409, "Only an Approved observation can be edited.");
      const prior = (await c.query("SELECT * FROM observation_edit_request WHERE owner_subject=$1 AND client_key=$2", [subject(req.user), clientKey])).rows[0];
      if (prior) {
        if (prior.payload_hash !== payloadHash || prior.observation_id !== observationId) fail(409, "This edit key belongs to another proposal.");
        return exposed(prior);
      }
      if ((await c.query("SELECT id FROM observation_edit_request WHERE observation_id=$1 AND status IN ('Pending Review','Correction Required')", [observationId])).rows.length)
        fail(409, "An observation edit is already awaiting review.");
      const photos = await selectedPhotos(c, observationId, proposed.photoIds, proposed.photos);
      const base = { content: observation.content, revision: observation.revision, photo_ids: photos.current };
      const number = Number((await c.query("SELECT COALESCE(MAX(version_number),0)+1 AS next FROM observation_edit_request WHERE observation_id=$1", [observationId])).rows[0].next);
      const id = randomUUID();
      const row = (await c.query(`INSERT INTO observation_edit_request
        (id,observation_id,owner_subject,version_number,base_revision,base_fingerprint,base_snapshot,proposed_content,retained_photo_ids,added_photos,client_key,payload_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [id, observationId, subject(req.user), number, observation.revision, hash(base), base, proposed.content, photos.retained,
        proposed.photos, clientKey, payloadHash])).rows[0];
      await c.query(`INSERT INTO observation_version_history(id,observation_id,version_number,owner_subject,content,photo_ids)
        VALUES($1,$2,0,$3,$4,$5) ON CONFLICT(observation_id,version_number) DO NOTHING`,
      [randomUUID(), observationId, subject(req.user), observation.content, photos.current]);
      await c.query("INSERT INTO observation_edit_event(id,request_id,observation_id,actor_subject,event_type) VALUES($1,$2,$3,$4,'submitted')",
        [randomUUID(), id, observationId, subject(req.user)]);
      await audit(c, req.user, "observation_edit_submitted", id);
      return exposed(row);
    });
    res.status(201).json({ edit: result });
  });
  app.get("/api/observation-edits", read, async (req, res) => {
    await requireAvailable(pool);
    const rows = (await pool.query(`SELECT * FROM observation_edit_request WHERE ($1 OR owner_subject=$2)
      ORDER BY updated_at DESC LIMIT 500`, [permitted(req.user, "observations.review"), subject(req.user)])).rows;
    res.json({ edits: rows.map(exposed) });
  });
  app.get("/api/observation-edits/:id", read, async (req, res) => {
    await requireAvailable(pool);
    const row = (await pool.query("SELECT * FROM observation_edit_request WHERE id=$1 AND ($2 OR owner_subject=$3)",
      [req.params.id, permitted(req.user, "observations.review"), subject(req.user)])).rows[0];
    if (!row) fail(404, "Observation edit unavailable.");
    res.json({ edit: exposed(row) });
  });
  app.get("/api/observation-edits/:id/photos/:index", read, async (req, res) => {
    await requireAvailable(pool);
    if (!/^(0|[1-2])$/.test(req.params.index)) fail(400, "Invalid photo index.");
    const row = (await pool.query("SELECT added_photos FROM observation_edit_request WHERE id=$1 AND ($2 OR owner_subject=$3)",
      [req.params.id, permitted(req.user, "observations.review"), subject(req.user)])).rows[0];
    const photo = row?.added_photos?.[Number(req.params.index)];
    if (!photo) fail(404, "Proposed photo unavailable.");
    res.type("image/jpeg").send(Buffer.from(photo.base64, "base64"));
  });
  app.get("/api/observations/:id/edit-history", read, async (req, res) => {
    await requireAvailable(pool);
    const observation = (await pool.query("SELECT id,owner_subject FROM plant_observation WHERE id=$1", [req.params.id])).rows[0];
    if (!observation || (!permitted(req.user, "observations.review") && observation.owner_subject !== subject(req.user))) fail(404, "Observation history unavailable.");
    const [versions, edits, events] = await Promise.all([
      pool.query("SELECT id,observation_id,version_number,content,photo_ids,edit_request_id,approved_at FROM observation_version_history WHERE observation_id=$1 ORDER BY version_number", [observation.id]),
      pool.query("SELECT * FROM observation_edit_request WHERE observation_id=$1 ORDER BY created_at", [observation.id]),
      pool.query("SELECT id,request_id,observation_id,actor_subject,event_type,comment,created_at FROM observation_edit_event WHERE observation_id=$1 ORDER BY created_at,id", [observation.id]),
    ]);
    res.json({ versions: versions.rows, edits: edits.rows.map(exposed), events: events.rows });
  });
  app.get("/api/observation-versions/:id/photos/:index", read, async (req, res) => {
    await requireAvailable(pool);
    if (!/^(0|[1-2])$/.test(req.params.index)) fail(400, "Invalid photo index.");
    const version = (await pool.query(`SELECT v.photo_ids FROM observation_version_history v
      WHERE v.id=$1 AND ($2 OR v.owner_subject=$3)`,
    [req.params.id, permitted(req.user, "observations.review"), subject(req.user)])).rows[0];
    const assetId = version?.photo_ids?.[Number(req.params.index)];
    if (!assetId) fail(404, "Historical observation photo unavailable.");
    const asset = (await pool.query("SELECT content,content_type FROM plant_asset WHERE id=$1", [assetId])).rows[0];
    if (!asset) fail(404, "Historical observation photo unavailable.");
    res.type(asset.content_type).send(asset.content);
  });
  app.patch("/api/observation-edits/:id", allow("observations.create"), async (req, res) => {
    const { revision, ...input } = req.body || {};
    if (!Number.isInteger(revision)) fail(400, "Edit revision is required.");
    const proposed = await proposal(input);
    const result = await transaction(pool, async (c) => {
      await requireAvailable(c);
      const row = (await c.query("SELECT * FROM observation_edit_request WHERE id=$1 FOR UPDATE", [req.params.id])).rows[0];
      if (!row || row.owner_subject !== subject(req.user)) fail(404, "Owned observation edit unavailable.");
      if (row.status !== "Correction Required" || row.revision !== revision) fail(409, "Reload the correction request before resubmitting.");
      const observation = await ownedObservation(c, row.observation_id, req.user, true);
      if (observation.status !== "Approved" || observation.revision !== row.base_revision) fail(409, "Approved observation changed. Start a fresh edit.");
      const additions = input.photos === undefined ? row.added_photos : proposed.photos;
      const selected = await selectedPhotos(c, row.observation_id,
        input.photo_ids === undefined ? row.retained_photo_ids : proposed.photoIds, additions);
      const updated = (await c.query(`UPDATE observation_edit_request SET proposed_content=$1,retained_photo_ids=$2,added_photos=$3,
        revision=revision+1,status='Pending Review',review_comment=NULL,reviewed_by=NULL,reviewed_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$4 RETURNING *`,
      [proposed.content, selected.retained, additions, row.id])).rows[0];
      await c.query("INSERT INTO observation_edit_event(id,request_id,observation_id,actor_subject,event_type) VALUES($1,$2,$3,$4,'resubmitted')",
        [randomUUID(), row.id, row.observation_id, subject(req.user)]);
      await audit(c, req.user, "observation_edit_resubmitted", row.id);
      return exposed(updated);
    });
    res.json({ edit: result });
  });
  app.post("/api/observation-edits/:id/cancel", allow("observations.create"), async (req, res) => {
    if (req.body && Object.keys(req.body).length) fail(400, "Cancellation does not accept proposal changes.");
    const result = await transaction(pool, async (c) => {
      await requireAvailable(c);
      const edit = (await c.query("SELECT * FROM observation_edit_request WHERE id=$1 FOR UPDATE", [req.params.id])).rows[0];
      if (!edit || edit.owner_subject !== subject(req.user)) fail(404, "Owned observation edit unavailable.");
      if (!["Pending Review", "Correction Required"].includes(edit.status)) fail(409, "Only an active observation edit can be cancelled.");
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
      Object.keys(req.body).some((key) => !["decision", "comment"].includes(key))) fail(400, "Invalid review decision.");
    const comment = text(req.body.comment);
    const result = await transaction(pool, async (c) => {
      await requireAvailable(c);
      const edit = (await c.query("SELECT * FROM observation_edit_request WHERE id=$1 FOR UPDATE", [req.params.id])).rows[0];
      if (!edit) fail(404, "Observation edit unavailable.");
      if (edit.status !== "Pending Review") fail(409, "This proposal is not pending review.");
      if (edit.owner_subject === subject(req.user)) fail(403, "You cannot review your own edit.");
      const observation = (await c.query("SELECT * FROM plant_observation WHERE id=$1 FOR UPDATE", [edit.observation_id])).rows[0];
      const currentIds = await photoIds(c, edit.observation_id);
      const base = { content: observation?.content, revision: observation?.revision, photo_ids: currentIds };
      if (!observation || observation.status !== "Approved" || hash(base) !== edit.base_fingerprint)
        fail(409, "Approved observation changed since this proposal.");
      if (req.body.decision === "Approved") {
        if (edit.retained_photo_ids.some((id) => !currentIds.includes(id))) fail(409, "Observation photos changed.");
        const removed = currentIds.filter((id) => !edit.retained_photo_ids.includes(id));
        if (removed.length) await c.query("UPDATE plant_asset SET observation_id=NULL,approved=FALSE WHERE id=ANY($1::text[])", [removed]);
        const addedIds = [];
        for (const [index, photo] of edit.added_photos.entries()) {
          const assetId = randomUUID(); addedIds.push(assetId);
          await c.query(`INSERT INTO plant_asset(id,plant_id,owner_subject,client_key,observation_id,approved,content_type,content)
            VALUES($1,$2,$3,$4,$5,TRUE,'image/jpeg',$6)`,
          [assetId, observation.plant_id, edit.owner_subject, `observation-edit:${edit.id}:${index}`, observation.id, Buffer.from(photo.base64, "base64")]);
        }
        await c.query("UPDATE plant_observation SET content=$1,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=$2",
          [edit.proposed_content, observation.id]);
        if (edit.proposed_content.latitude !== undefined)
          await c.query("INSERT INTO plant_location(plant_id,latitude,longitude,accuracy_m) VALUES($1,$2,$3,$4)",
            [observation.plant_id, edit.proposed_content.latitude, edit.proposed_content.longitude,
              edit.proposed_content.accuracy_m ?? null]);
        const nextVersion = Number((await c.query("SELECT COALESCE(MAX(version_number),0)+1 AS next FROM observation_version_history WHERE observation_id=$1", [observation.id])).rows[0].next);
        await c.query(`INSERT INTO observation_version_history(id,observation_id,version_number,owner_subject,content,photo_ids,edit_request_id)
          VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [randomUUID(), observation.id, nextVersion, edit.owner_subject, edit.proposed_content, [...edit.retained_photo_ids, ...addedIds], edit.id]);
      }
      const updated = (await c.query(`UPDATE observation_edit_request SET status=$1,review_comment=$2,reviewed_by=$3,
        reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$4 RETURNING *`,
      [req.body.decision, comment, subject(req.user), edit.id])).rows[0];
      await c.query("INSERT INTO observation_edit_event(id,request_id,observation_id,actor_subject,event_type,comment) VALUES($1,$2,$3,$4,$5,$6)",
        [randomUUID(), edit.id, observation.id, subject(req.user), req.body.decision.toLowerCase().replace(" ", "_"), comment]);
      await audit(c, req.user, `observation_edit_${req.body.decision.toLowerCase().replace(" ", "_")}`, edit.id);
      return exposed(updated);
    });
    res.json({ edit: result });
  });
}
module.exports = { mountObservationEdits };
