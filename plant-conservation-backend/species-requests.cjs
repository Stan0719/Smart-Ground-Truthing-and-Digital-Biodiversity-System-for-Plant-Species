"use strict";
const { createHash, randomUUID } = require("node:crypto");
const sharp = require("sharp");
const {proposedPhoto}=require("./species-photo-library.cjs");
const {approveRequestPhoto,setPointer}=require("./species-photo-provenance.cjs");
const { permitted } = require("../shared/rbac.cjs");

const fields = ["scientific_name", "common_name", "genus_name", "family_name",
  "conservation_status", "description", "habitat"];
const columns = "request_id,owner_subject AS requested_by,scientific_name,common_name,common_name AS suggested_common_name,genus_name,family_name,conservation_status,description,habitat,request_status,review_comment,reviewed_by,submitted_at,reviewed_at,approved_species_id,proposed_species_id";
const project = (row) => ({ ...row, photo_url: `/api/species-requests/${row.request_id}/photo`, proposed_photo_url: `/api/species-requests/${row.request_id}/proposed-photo` });

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

async function provenanceAvailable(pool) {
  return Boolean((await pool.query("SELECT to_regclass('plant_submission_receipt') IS NOT NULL AS available")).rows[0]?.available);
}
function observationRequestSql(available, hasProvenance = false) {
  const empty = { select: "NULL::text AS species_request_id,NULL::jsonb AS species_request", join: "" };
  if (!available || !hasProvenance) return empty;
  const result = "origin.receipt->'result'";
  const requestId = result + "->>'species_request_id'";
  const linked = "origin.receipt_count=1 AND origin.receipt->>'valid'='true' AND " + result + "->>'id'=o.id AND " + requestId + " IS NOT NULL";
  return {
    select: `CASE WHEN ${linked} THEN ${requestId} ELSE NULL END AS species_request_id,
      CASE WHEN ${linked} THEN CASE
        WHEN origin_request.request_id IS NULL THEN jsonb_build_object('request_id',${requestId},'request_status','Unavailable')
        WHEN origin_request.owner_subject<>origin.receipt->>'owner' OR origin_request.client_key<>origin.receipt->>'client_key'
          OR ${result}->>'species_id'<>p.species_id::text
          OR (origin_request.proposed_species_id IS NOT NULL AND origin_request.proposed_species_id<>p.species_id)
          OR (origin_request.request_status='Approved' AND origin_request.approved_species_id IS DISTINCT FROM p.species_id)
        THEN ${projection('origin_request')} || jsonb_build_object('request_status','Inconsistent')
        ELSE ${projection('origin_request')} END ELSE NULL END AS species_request`,
    // Receipt IDs establish origin. Owner/client-key comparisons validate that binding;
    // they never discover a relationship by matching people, dates or names.
    join: `LEFT JOIN LATERAL (
      SELECT count(*) AS receipt_count,(jsonb_agg(jsonb_build_object(
        'result',receipt.result,'owner',receipt.owner_subject,'client_key',receipt.client_key,
        'valid',receipt.owner_subject=p.registered_subject AND receipt.result ? 'species_request_id' AND receipt.result ? 'species_id' AND EXISTS (
          SELECT 1 FROM plant_observation initial WHERE initial.id=receipt.result->>'id'
            AND initial.plant_id=p.plant_id AND initial.owner_subject=receipt.owner_subject AND initial.client_key=receipt.client_key
        ))) -> 0) AS receipt
      FROM plant_submission_receipt receipt WHERE receipt.result->>'plant_id'=p.plant_id::text
    ) origin ON true
    LEFT JOIN species_request_submission origin_request ON ${linked} AND origin_request.request_id::text=${requestId}`,
  };
}
// A receipt describes the immutable registration, not its mutable catalogue selection.
// Validate explicit origin before using either its null dependency or request ID.
async function registrationReceipt(c, plantId, plant, fail) {
  if (await provenanceAvailable(c)) {
    const receipts = (await c.query("SELECT owner_subject,client_key,result FROM plant_submission_receipt WHERE result->>'plant_id'=$1 FOR SHARE", [String(plantId)])).rows;
    if (receipts.length > 1) fail(409, "Submission provenance is ambiguous. Verify the originating submission before review.");
    if (receipts.length === 1) {
      const receipt = receipts[0], result = receipt.result;
      const initial = result && typeof result.id === 'string' ? (await c.query("SELECT plant_id,owner_subject,client_key FROM plant_observation WHERE id=$1", [result.id])).rows[0] : null;
      if (!initial || String(initial.plant_id)!==String(plantId) || receipt.owner_subject!==plant.registered_subject ||
          initial.owner_subject!==receipt.owner_subject || initial.client_key!==receipt.client_key || !Object.hasOwn(result,'species_request_id') ||
          !/^[1-9][0-9]*$/.test(String(result.species_id)) ||
          (result.species_request_id !== null && !/^[1-9][0-9]*$/.test(String(result.species_request_id))))
        fail(409, "Submission provenance is inconsistent. Verify the originating submission before review.");
      if (!(await c.query("SELECT species_id FROM species WHERE species_id::text=$1 FOR SHARE", [String(result.species_id)])).rows.length)
        fail(409, "The registration receipt references an unavailable original species. Ask an officer to reconcile the submission provenance.");
      return receipt;
    }
  }
  return null;
}

async function assertSpeciesReassignment(c, plantId, plant, fail) {
  const receipt = await registrationReceipt(c, plantId, plant, fail);
  if (!receipt)
    fail(409, "Species reassignment requires verified registration provenance. Ask an officer to reconcile the original submission.");
  if (receipt.result.species_request_id !== null)
    fail(409, "This registration originated a species request. Keep its proposed species; reassignment requires a separately supported review workflow.");
}

async function assertSpeciesResolved(c, plantId, fail, observationId) {
  if (!(await requestsAvailable(c))) return;
  const plant = (await c.query("SELECT p.species_id,p.registered_subject,s.scientific_name,s.rbac_data FROM plant_record p JOIN species s ON s.species_id=p.species_id WHERE p.plant_id=$1 FOR SHARE OF p,s", [plantId])).rows[0];
  if (!plant) fail(404, "Plant not found.");
  const receipt = await registrationReceipt(c, plantId, plant, fail);
  if (receipt) {
      const result = receipt.result;
      if (result.species_request_id === null) {
        // Owner-only corrections validate accessibility with speciesRow. Recheck the
        // current selection under the review lock; never rewrite the replay result.
        if ((plant.rbac_data?.approvalStatus || "Approved") !== "Approved" || !plant.scientific_name?.trim())
          fail(409, "The current species is not approved or is incomplete. Correct the registration to an accessible approved species before review.");
        return;
      }
      if (String(result.species_id)!==String(plant.species_id))
        fail(409, "The originating species request does not match the current plant species. Reconcile the registration before review.");
      // Other observations do not inherit the registration's request. Approval still
      // independently requires an approved species in the observation-review route.
      if (typeof observationId === 'string' && result.id !== observationId) return;
      const requests = (await c.query("SELECT request_status,proposed_species_id,approved_species_id,owner_subject,client_key FROM species_request_submission WHERE request_id::text=$1 FOR UPDATE", [String(result.species_request_id)])).rows;
      if (String(result.species_id)!==String(plant.species_id) || requests.length!==1 ||
          requests[0].owner_subject!==receipt.owner_subject || requests[0].client_key!==receipt.client_key ||
          requests[0].request_status!=='Approved' || String(requests[0].approved_species_id || '')!==String(plant.species_id) ||
          (requests[0].proposed_species_id!=null && String(requests[0].proposed_species_id)!==String(plant.species_id)) || !plant.scientific_name?.trim())
        fail(409, "Resolve the linked species request before reviewing this plant submission.");
      return;
  }
  // Unknown/legacy provenance: expose no invented request, but retain the original
  // conservative species-wide guard until an authoritative relationship is available.
  const requests = (await c.query("SELECT request_status,proposed_species_id,approved_species_id FROM species_request_submission WHERE proposed_species_id=$1 OR approved_species_id=$1 ORDER BY request_id FOR UPDATE", [plant.species_id])).rows;
  if (!requests.length) return;
  if (requests.length!==1 || requests[0].request_status!=='Approved' || String(requests[0].approved_species_id || '')!==String(plant.species_id) ||
      (requests[0].proposed_species_id!=null && String(requests[0].proposed_species_id)!==String(plant.species_id)) || !plant.scientific_name?.trim())
    fail(409, "Species request provenance cannot be verified. Resolve the legacy dependency before review.");
}

function mountSpeciesRequests(app, { pool, allow, transaction, audit, subject, fail, text, assertNewSpecies, officerNotifications = null }) {
  const requestId = (value) => {
    if (typeof value !== "string" || !/^[1-9][0-9]{0,9}$/.test(value) || BigInt(value) > 2147483647n)
      fail(400, "Invalid species request identifier.");
    return value;
  };
  const servePhoto = async (res, photo) => {
    let bytes;
    try {
      if (!(Buffer.isBuffer(photo) || photo instanceof Uint8Array) || !photo.length || photo.length > 4194304)
        throw Error("Invalid photo size");
      const input = sharp(photo, { limitInputPixels: 24000000, failOn: "warning" });
      const metadata = await input.metadata();
      if (!["jpeg", "png"].includes(metadata.format) || (metadata.pages || 1) > 1)
        throw Error("Unsupported photo format");
      bytes = await input.rotate()
        .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85 }).toBuffer();
    } catch { fail(415, "Request photo is unavailable or unsupported."); }
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", 'inline; filename="species-request.jpg"');
    res.type("image/jpeg").send(bytes);
  };
  // Reuse current role grants: botanists submit, conservation officers review.
  const read = (req, res, next) => allow(permitted(req.user, "species.manage")
    ? "species.manage" : "plants.create")(req, res, next);
  app.get("/api/assets/species-request-:id", allow("species.manage"), async (req, res) => {
    const row = (await pool.query("SELECT photo FROM species_request_submission WHERE request_id=$1", [requestId(req.params.id)])).rows[0];
    if (!row) fail(404, "Species request unavailable.");
    await servePhoto(res, await proposedPhoto(pool,requestId(req.params.id),req.user) || row.photo);
  });
  app.get("/api/species-requests/:id/proposed-photo",read,async(req,res)=>{
    const key=requestId(req.params.id);
    const row=(await pool.query("SELECT photo FROM species_request_submission WHERE request_id=$1 AND ($2 OR owner_subject=$3)",[key,permitted(req.user,"species.manage"),subject(req.user)])).rows[0];
    if(!row)fail(404,"Species request unavailable.");
    await servePhoto(res,await proposedPhoto(pool,key,req.user) || row.photo);
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
      if (officerNotifications) await officerNotifications.enqueueSpeciesRequest(c,row.request_id);
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
      [requestId(req.params.id), permitted(req.user, "species.manage"), subject(req.user)])).rows[0];
    if (!row) fail(404, "Species request unavailable.");
    res.json({ species_request: project(row) });
  });
  app.get("/api/species-requests/:id/photo", read, async (req, res) => {
    const row = (await pool.query("SELECT photo FROM species_request_submission WHERE request_id=$1 AND ($2 OR owner_subject=$3)",
      [requestId(req.params.id), permitted(req.user, "species.manage"), subject(req.user)])).rows[0];
    if (!row) fail(404, "Species request unavailable.");
    await servePhoto(res, row.photo);
  });
  app.post("/api/species-requests/:id/review", allow("species.manage"), async (req, res) => {
    const requestKey = requestId(req.params.id);
    const b = req.body;
    if (!b || Array.isArray(b) || Object.keys(b).some(key => !["decision", "comment", "visibility"].includes(key)) || !["Approved", "Rejected", "Correction Required"].includes(b.decision)) fail(400, "Invalid review decision.");
    if (b.comment !== undefined && (typeof b.comment !== "string" || b.comment.length > 4000))
      fail(400, "Invalid review comment.");
    const comment = b.decision === "Approved" ? (b.comment || "").trim() : text(b.comment);
    if (b.decision === "Approved" && !["public", "internal", "protected"].includes(b.visibility)) fail(400, "Select visibility.");
    const result = await transaction(pool, async (c) => {
      const row = (await c.query("SELECT * FROM species_request_submission WHERE request_id=$1 FOR UPDATE", [requestKey])).rows[0];
      if (!row) fail(404, "Species request unavailable.");
      if (row.owner_subject === subject(req.user)) fail(403, "You cannot review your own species request.");
      if (row.request_status !== "Pending Review") fail(409, "Species request has already been reviewed.");
      if (b.decision === "Approved" && fields.some(key => typeof row[key] !== "string" || !row[key].trim()))
        fail(409, "Species request is incomplete.");
      let speciesId = null;
      if (row.proposed_species_id) {
        const linked = (await c.query("SELECT request_id FROM species_request_submission WHERE proposed_species_id=$1 OR approved_species_id=$1 ORDER BY request_id", [row.proposed_species_id])).rows;
        if (linked.length !== 1) fail(409, "Species request association is ambiguous.");
        const proposed = (await c.query("SELECT species_id,scientific_name,rbac_data FROM species WHERE species_id=$1 FOR UPDATE", [row.proposed_species_id])).rows[0];
        if (!proposed || proposed.rbac_data?.approvalStatus !== "Pending Review") fail(409, "Proposed species is no longer awaiting review.");
        if (b.decision === "Approved") {
          if (typeof proposed.scientific_name !== "string" || !proposed.scientific_name.trim())
            fail(409, "Proposed species is incomplete.");
          await c.query("SELECT pg_advisory_xact_lock(hashtext(lower(btrim($1))))", [row.scientific_name]);
          if ((await c.query("SELECT species_id FROM species WHERE lower(btrim(scientific_name))=lower(btrim($1)) AND species_id<>$2", [row.scientific_name, row.proposed_species_id])).rows.length)
            fail(409, "This scientific name already exists. Resolve the duplicate before approval.");
          speciesId = row.proposed_species_id;
          await c.query("INSERT INTO rbac_species_visibility(species_id,visibility) VALUES($1,$2) ON CONFLICT(species_id) DO UPDATE SET visibility=EXCLUDED.visibility", [speciesId, b.visibility]);
          await approveRequestPhoto(c,row,speciesId,subject(req.user));
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
        const photoId=randomUUID();
        await c.query("INSERT INTO plant_asset(id,species_id,owner_subject,client_key,approved,content_type,content) VALUES($1,$2,$3,$4,TRUE,'image/jpeg',$5)",
          [photoId, speciesId, row.owner_subject, `species-request:${row.request_id}`, row.photo]);
        await setPointer(c,row.request_id,photoId);
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
module.exports = { provenanceAvailable, requestsAvailable, observationRequestSql, assertSpeciesResolved, assertSpeciesReassignment, mountSpeciesRequests };
