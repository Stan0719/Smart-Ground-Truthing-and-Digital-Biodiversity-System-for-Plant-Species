"use strict";
const { createHash, randomUUID } = require("node:crypto");
const sharp = require("sharp");
const { permitted } = require("../shared/rbac.cjs");

const fields = ["scientific_name", "common_name", "genus_name", "family_name",
  "conservation_status", "description", "habitat"];
const columns = "request_id,owner_subject AS requested_by,scientific_name,common_name,common_name AS suggested_common_name,genus_name,family_name,conservation_status,description,habitat,request_status,review_comment,reviewed_by,submitted_at,reviewed_at,approved_species_id,proposed_species_id";
const project = (row) => ({ ...row, photo_url: `/api/species-requests/${row.request_id}/photo` });

// The deployed table predates this API. Older installations without it retain
// ordinary observation behavior; no runtime DDL or migrations are performed.
async function requestsAvailable(pool) {
  return Boolean((await pool.query(
    "SELECT to_regclass('species_request_submission') IS NOT NULL AS available",
  )).rows[0].available);
}

function projection(alias) {
  return `jsonb_build_object(
    'request_id',${alias}.request_id::text,
    'request_status',${alias}.request_status,
    'proposed_species_id',${alias}.proposed_species_id::text,
    'approved_species_id',${alias}.approved_species_id::text,
    'proposed_scientific_name',${alias}.scientific_name,
    'suggested_common_name',${alias}.common_name,
    'genus_name',${alias}.genus_name,'family_name',${alias}.family_name,
    'conservation_status',${alias}.conservation_status,
    'description',${alias}.description,'habitat',${alias}.habitat,
    'owner_subject',${alias}.owner_subject,'requested_by',${alias}.owner_subject,
    'submitted_at',${alias}.submitted_at,'review_comment',${alias}.review_comment,
    'review_decision',CASE WHEN ${alias}.request_status='Pending Review' THEN NULL ELSE ${alias}.request_status END,
    'reviewed_at',${alias}.reviewed_at,
    'assets',CASE WHEN octet_length(${alias}.photo)>0 THEN
      jsonb_build_array(jsonb_build_object('id','species-request-'||${alias}.request_id::text,'content_type','image/jpeg'))
      ELSE '[]'::jsonb END)`;
}

function observationRequestSql(available) {
  if (!available) return {
    select: "NULL::text AS species_request_id,NULL::jsonb AS species_request",
    join: "",
  };
  return {
    select: `CASE WHEN sr.count=1 THEN sr.data->>'request_id' ELSE NULL END AS species_request_id,
      CASE WHEN sr.count>1 THEN jsonb_build_object('request_status','Ambiguous')
        WHEN sr.data->>'proposed_species_id' IS NOT NULL
          AND sr.data->>'proposed_species_id' <> p.species_id::text
        THEN sr.data || jsonb_build_object('request_status','Inconsistent')
        ELSE sr.data END AS species_request`,
    // Both species references are authoritative FKs. Standalone requests only
    // acquire a species link on approval. Multiple matches are never guessed.
    join: `LEFT JOIN LATERAL (
      SELECT count(*) AS count,(jsonb_agg(${projection("r")} ORDER BY r.request_id)->0) AS data
      FROM species_request_submission r WHERE (r.proposed_species_id=p.species_id OR r.approved_species_id=p.species_id)
    ) sr ON true`,
  };
}

async function assertSpeciesResolved(c, plantId, fail) {
  if (!(await requestsAvailable(c))) return;
  const plant = (await c.query(
    "SELECT p.species_id,s.scientific_name FROM plant_record p JOIN species s ON s.species_id=p.species_id WHERE p.plant_id=$1 FOR SHARE OF p,s",
    [plantId],
  )).rows[0];
  if (!plant) fail(404, "Plant not found.");
  const requests = (await c.query(
    "SELECT request_status,proposed_species_id,approved_species_id FROM species_request_submission WHERE proposed_species_id=$1 OR approved_species_id=$1 ORDER BY request_id FOR UPDATE",
    [plant.species_id],
  )).rows;
  if (!requests.length) return;
  if (requests.length !== 1 || requests[0].request_status !== "Approved" ||
      String(requests[0].approved_species_id || "") !== String(plant.species_id) ||
      (requests[0].proposed_species_id != null && String(requests[0].proposed_species_id) !== String(plant.species_id)) ||
      !plant.scientific_name?.trim())
    fail(409, "Resolve the linked species request before reviewing this plant submission.");
}

function mountSpeciesRequests(app, { pool, allow, transaction, audit, subject, fail, text, id, assertNewSpecies }) {
  // Reuse current role grants: botanists submit, conservation officers review.
  const read = (req, res, next) => allow(permitted(req.user, "species.manage")
    ? "species.manage" : "plants.create")(req, res, next);
  app.get("/api/assets/species-request-:id", allow("species.manage"), async (req, res) => {
    const row = (await pool.query("SELECT photo FROM species_request_submission WHERE request_id=$1", [id(req.params.id)])).rows[0];
    if (!row) fail(404, "Species request unavailable.");
    res.type("image/jpeg").send(Buffer.from(row.photo));
  });
  app.post("/api/species-requests", allow("plants.create"), async (req, res) => {
    const b = req.body;
    if (!b || typeof b !== "object" || Array.isArray(b) ||
      Object.keys(b).some((key) => ![...fields, "photo", "client_key"].includes(key)))
      fail(400, "Invalid species request fields.");
    const data = Object.fromEntries(fields.map((key) => [key, text(b[key],
      ["description", "habitat"].includes(key) ? 4000 : 200)]));
    const clientKey = text(b.client_key, 100);
    const photo = b.photo;
    if (!photo || !["image/jpeg", "image/png"].includes(photo.content_type) ||
      typeof photo.base64 !== "string" || !photo.base64.length ||
      photo.base64.length > 5592408 || !/^[A-Za-z0-9+/]+={0,2}$/.test(photo.base64))
      fail(400, "A JPEG or PNG species photo is required (maximum 4 MB).");
    const original = Buffer.from(photo.base64, "base64");
    if (!original.length || original.length > 4194304) fail(413, "Species photo exceeds 4 MB.");
    const payloadHash = createHash("sha256").update(JSON.stringify(data)).update(original).digest("hex");
    let bytes;
    try {
      bytes = await sharp(original, { limitInputPixels: 24000000, failOn: "warning" })
        .rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85 }).toBuffer();
    } catch { fail(400, "Invalid or oversized species photo."); }
    const result = await transaction(pool, async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext(lower(btrim($1))))", [data.scientific_name]);
      const previous = (await c.query(`SELECT ${columns},payload_hash FROM species_request_submission WHERE owner_subject=$1 AND client_key=$2`,
        [subject(req.user), clientKey])).rows[0];
      if (previous) {
        if (previous.payload_hash !== payloadHash) fail(409, "Request key belongs to different species details.");
        delete previous.payload_hash;
        return previous;
      }
      await assertNewSpecies(c, data.scientific_name);
      if ((await c.query("SELECT request_id FROM species_request_submission WHERE lower(btrim(scientific_name))=lower(btrim($1)) AND request_status='Pending Review'",
        [data.scientific_name])).rows.length) fail(409, "A request for this scientific name is already pending review.");
      const row = (await c.query(`INSERT INTO species_request_submission(owner_subject,client_key,payload_hash,${fields.join(",")},photo)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${columns}`,
        [subject(req.user), clientKey, payloadHash, ...fields.map((key) => data[key]), bytes])).rows[0];
      await audit(c, req.user, "species_requested", row.request_id);
      return row;
    });
    res.status(201).json({ species_request: project(result) });
  });
  app.get("/api/species-requests", read, async (req, res) => {
    const rows = (await pool.query(`SELECT ${columns} FROM species_request_submission
      WHERE ($1 OR owner_subject=$2) ORDER BY submitted_at DESC,request_id DESC LIMIT 500`,
      [permitted(req.user, "species.manage"), subject(req.user)])).rows;
    res.json({ species_requests: rows.map(project) });
  });
  app.get("/api/species-requests/:id", read, async (req, res) => {
    const row = (await pool.query(`SELECT ${columns} FROM species_request_submission
      WHERE request_id=$1 AND ($2 OR owner_subject=$3)`,
      [id(req.params.id), permitted(req.user, "species.manage"), subject(req.user)])).rows[0];
    if (!row) fail(404, "Species request unavailable.");
    res.json({ species_request: project(row) });
  });
  app.get("/api/species-requests/:id/photo", read, async (req, res) => {
    const row = (await pool.query("SELECT photo FROM species_request_submission WHERE request_id=$1 AND ($2 OR owner_subject=$3)",
      [id(req.params.id), permitted(req.user, "species.manage"), subject(req.user)])).rows[0];
    if (!row) fail(404, "Species request unavailable.");
    res.type("image/jpeg").send(Buffer.from(row.photo));
  });
  app.post("/api/species-requests/:id/review", allow("species.manage"), async (req, res) => {
    const b = req.body;
    if (!b || Array.isArray(b) || Object.keys(b).some(key => !["decision", "comment", "visibility"].includes(key)) || !["Approved", "Rejected", "Correction Required"].includes(b.decision)) fail(400, "Invalid review decision.");
    const comment = b.decision === "Approved" && (b.comment === undefined || b.comment === "") ? "" : text(b.comment);
    if (b.decision === "Approved" && !["public", "internal", "protected"].includes(b.visibility)) fail(400, "Select visibility.");
    const result = await transaction(pool, async (c) => {
      const row = (await c.query("SELECT * FROM species_request_submission WHERE request_id=$1 FOR UPDATE", [id(req.params.id)])).rows[0];
      if (!row) fail(404, "Species request unavailable.");
      if (row.owner_subject === subject(req.user)) fail(403, "You cannot review your own species request.");
      if (row.request_status !== "Pending Review") fail(409, "Species request has already been reviewed.");
      let speciesId = null;
      if (row.proposed_species_id) {
        const linked = (await c.query("SELECT request_id FROM species_request_submission WHERE proposed_species_id=$1 OR approved_species_id=$1 ORDER BY request_id", [row.proposed_species_id])).rows;
        if (linked.length !== 1) fail(409, "Species request association is ambiguous.");
        const proposed = (await c.query("SELECT species_id,rbac_data FROM species WHERE species_id=$1 FOR UPDATE", [row.proposed_species_id])).rows[0];
        if (!proposed || proposed.rbac_data?.approvalStatus !== "Pending Review") fail(409, "Proposed species is no longer awaiting review.");
        if (b.decision === "Approved") {
          await c.query("SELECT pg_advisory_xact_lock(hashtext(lower(btrim($1))))", [row.scientific_name]);
          if ((await c.query("SELECT species_id FROM species WHERE lower(btrim(scientific_name))=lower(btrim($1)) AND species_id<>$2", [row.scientific_name, row.proposed_species_id])).rows.length)
            fail(409, "This scientific name already exists. Resolve the duplicate before approval.");
          speciesId = row.proposed_species_id;
          await c.query("INSERT INTO rbac_species_visibility(species_id,visibility) VALUES($1,$2) ON CONFLICT(species_id) DO UPDATE SET visibility=EXCLUDED.visibility", [speciesId, b.visibility]);
          await c.query("UPDATE plant_asset SET approved=TRUE WHERE species_id=$1", [speciesId]);
        }
        await c.query("UPDATE species SET rbac_data=rbac_data || $1::jsonb WHERE species_id=$2", [{ approvalStatus: b.decision }, row.proposed_species_id]);
      } else if (b.decision === "Approved") {
        await assertNewSpecies(c, row.scientific_name);
        const family = (await c.query("SELECT family_id FROM family WHERE lower(btrim(family_name))=lower(btrim($1)) ORDER BY family_id LIMIT 1", [row.family_name])).rows[0]
          || (await c.query("INSERT INTO family(family_name) VALUES($1) RETURNING family_id", [row.family_name])).rows[0];
        const genus = (await c.query("SELECT genus_id FROM genus WHERE lower(btrim(genus_name))=lower(btrim($1)) AND family_id=$2 ORDER BY genus_id LIMIT 1", [row.genus_name, family.family_id])).rows[0]
          || (await c.query("INSERT INTO genus(genus_name,family_id) VALUES($1,$2) RETURNING genus_id", [row.genus_name, family.family_id])).rows[0];
        const status = (await c.query("SELECT status_id FROM conservation_status WHERE lower(status_name)=lower($1) ORDER BY status_id LIMIT 1", [row.conservation_status])).rows[0]
          || (await c.query("INSERT INTO conservation_status(status_name) VALUES($1) RETURNING status_id", [row.conservation_status])).rows[0];
        speciesId = (await c.query("INSERT INTO species(scientific_name,common_name,genus_id,status_id,description,rbac_data) VALUES($1,$2,$3,$4,$5,$6) RETURNING species_id",
          [row.scientific_name, row.common_name, genus.genus_id, status.status_id, row.description, { habitat: row.habitat }])).rows[0].species_id;
        await c.query("INSERT INTO rbac_species_visibility(species_id,visibility) VALUES($1,$2)", [speciesId, b.visibility]);
        await c.query("INSERT INTO plant_asset(id,species_id,owner_subject,client_key,approved,content_type,content) VALUES($1,$2,$3,$4,TRUE,'image/jpeg',$5)",
          [randomUUID(), speciesId, row.owner_subject, `species-request:${row.request_id}`, row.photo]);
      }
      const reviewed = (await c.query(`UPDATE species_request_submission SET request_status=$1,review_comment=$2,reviewed_by=$3,reviewed_at=CURRENT_TIMESTAMP,approved_species_id=$4 WHERE request_id=$5 RETURNING ${columns}`,
        [b.decision, comment, subject(req.user), speciesId, row.request_id])).rows[0];
      if ((await c.query("SELECT to_regclass(current_schema() || '.record_version_history') IS NOT NULL AS available")).rows[0].available)
        await c.query(`UPDATE record_version_history SET status=$1,reviewed_by=$2,reviewed_at=CURRENT_TIMESTAMP,review_comment=$3
          WHERE id=(SELECT id FROM record_version_history WHERE request_id=$4 AND status='Pending Review' ORDER BY version_number DESC LIMIT 1)`,
          [b.decision, subject(req.user), comment, row.request_id]);
      await audit(c, req.user, "species_request_reviewed", row.request_id);
      return reviewed;
    });
    res.json({ reviewed: true, species_request: project(result) });
  });
}
module.exports = { requestsAvailable, observationRequestSql, assertSpeciesResolved, mountSpeciesRequests };
