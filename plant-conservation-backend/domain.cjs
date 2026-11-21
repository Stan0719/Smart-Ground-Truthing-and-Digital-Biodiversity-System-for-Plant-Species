"use strict";
const { observationHistory, captureApprovedReview, submittedHistoryForReview } = require("./historical-reviews.cjs");
const { resolvePlantRegistrations, registrationLocation } = require("./plant-registration.cjs");
const { finalRejection } = require("./final-rejection.cjs");
const { withSubmissionUpdates } = require("./submission-updates.cjs");
const { projectObservationGps } = require("./observation-gps.cjs");
const { withResubmissionEvidence } = require('./observation-resubmission.cjs');
const { randomUUID, randomBytes, createHash } = require("node:crypto");
const { originColumnAvailable, classifyObservations } = require("./observation-origin.cjs");
const observationVersions = require("./observation-submission-versions.cjs");
const { canModifyPendingObservation } = require("./status-permissions.cjs");
const { queueOptions, queuePage } = require("./observation-queue.cjs");
const { publicPlantPageOptions, publicPlantPageMetadata, readPlantSpeciesCounts } = require("./plant-list-page.cjs");
const {
  permitted,
  canReadScientificCatalogue,
  catalogueVisibilityFor,
  projectGps,
  projectApprovedPlantGps,
  visibilityFor,
  projectSpecies,
  assertEdit,
  assertReview,
} = require("../shared/rbac.cjs");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const { requestsAvailable, provenanceAvailable, observationRequestSql, assertSpeciesResolved, mountSpeciesRequests } = require("./species-requests.cjs");
const {
  assertQrAssignmentAllowed,
  normalizeQrPlantSchema,
  qrPlantRecordRelation,
} = require("./qr-plant-mode.cjs");
const fail = (status, message) => {
  throw Object.assign(Error(message), { status });
};
const { normalizeSpeciesName, sqlSpeciesName } = require("./species-name.cjs");
const subject = (user) =>
  `${user.role === "Visitor" ? "visitor" : "staff"}:${user.id}`;
const id = (value) => {
  if (typeof value !== "string" || !/^\d+$/.test(value))
    fail(400, "Invalid identifier.");
  return value;
};
const text = (value, max = 4000) => {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    fail(400, "Invalid text.");
  return value.trim();
};
// Prefer an explicitly approved species portrait. If absent, use a photograph
// from the latest approved observation of an approved plant linked by species_id.
// This avoids treating unrelated species assets or old observation revisions as portraits.
const {available: galleryAvailable, membershipSql} = require("./species-gallery.cjs");
async function speciesImageJoin(c) {
  const managed=await galleryAvailable(c);
  return `LEFT JOIN LATERAL (
  SELECT image.id
  FROM (
    SELECT a.id,0 AS source_priority,a.created_at AS selected_at,a.created_at AS asset_created_at,
      ${managed ? "COALESCE(r.is_primary,FALSE)" : "FALSE"} AS is_primary
    FROM plant_asset a
    ${managed ? "LEFT JOIN species_image_reference r ON r.species_id=a.species_id AND r.asset_id=a.id" : ""}
    WHERE a.species_id=s.species_id AND a.approved=TRUE
      AND ${managed ? membershipSql() : 'TRUE'}
      AND a.content_type IN ('image/jpeg','image/png')
    UNION ALL
    SELECT a.id,1 AS source_priority,latest_observation.updated_at AS selected_at,a.created_at AS asset_created_at,FALSE AS is_primary
    FROM plant_record p
    JOIN LATERAL (
      SELECT o.id,o.updated_at
      FROM plant_observation o
      WHERE o.plant_id=p.plant_id AND o.status='Approved'
      ORDER BY o.updated_at DESC,o.id DESC
      LIMIT 1
    ) latest_observation ON true
    JOIN plant_asset a ON a.plant_id=p.plant_id AND a.observation_id=latest_observation.id
    WHERE p.species_id=s.species_id AND p.rbac_status='Approved'
      AND a.content_type IN ('image/jpeg','image/png')
  ) image
  ORDER BY image.source_priority,image.is_primary DESC,image.selected_at DESC,image.asset_created_at,image.id
  LIMIT 1
) preview ON true`;
}
function fieldContent(body) {
  const allowed = [
    "heightCm",
    "healthStatus",
    "lifeStage",
    "morphology",
    "notes",
    "latitude",
    "longitude",
    "accuracy_m",
    "taxonomy",
    "zone",
    "altitudeM",
  ];
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((k) => !allowed.includes(k))
  )
    fail(400, "Unsupported field attribute.");
  if (
    typeof body.heightCm !== "number" ||
    !Number.isFinite(body.heightCm) ||
    body.heightCm <= 0 ||
    body.heightCm > 100000
  )
    fail(400, "Invalid height.");
  body.healthStatus = text(body.healthStatus, 100);
  body.lifeStage = text(body.lifeStage, 100);
  body.morphology = text(body.morphology);
  if (
    body.notes !== undefined &&
    (typeof body.notes !== "string" || body.notes.length > 4000)
  )
    fail(400, "Invalid notes.");
  if (body.notes !== undefined) body.notes = body.notes.trim();
  if (body.taxonomy !== undefined) body.taxonomy = text(body.taxonomy, 1000);
  if (body.zone !== undefined && body.zone !== null) body.zone = text(body.zone, 200);
  if (body.altitudeM !== undefined && body.altitudeM !== null && (typeof body.altitudeM !== "number" || !Number.isFinite(body.altitudeM)))
    fail(400, "Invalid altitude.");
  if (body.latitude !== undefined || body.longitude !== undefined) {
    if (
      typeof body.latitude !== "number" ||
      !Number.isFinite(body.latitude) ||
      Math.abs(body.latitude) > 90 ||
      typeof body.longitude !== "number" ||
      !Number.isFinite(body.longitude) ||
      Math.abs(body.longitude) > 180
    )
      fail(400, "Invalid GPS.");
  }
  if (
    body.accuracy_m !== undefined && body.accuracy_m !== null &&
    (typeof body.accuracy_m !== "number" ||
      !Number.isFinite(body.accuracy_m) ||
      body.accuracy_m < 0)
  )
    fail(400, "Invalid accuracy.");
  return body;
}
async function transaction(pool, operation) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const result = await operation(c);
    await c.query("COMMIT");
    return result;
  } catch (error) {
    await c.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    c.release();
  }
}

// Migration 030 is deployed separately. Do not write migration-029-only
// snapshots: its review rows cannot yet prove which version was decided.
async function originalObservationVersionsReady(c) {
  return Boolean((await c.query(`SELECT to_regclass('plant_app.observation_submission_photo') IS NOT NULL
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='plant_app'
      AND table_name='observation_review' AND column_name='submission_version_id') AS ready`)).rows[0]?.ready);
}

async function verifiedObservationOrigin(c, row) {
  return (await classifyObservations(c, [row]))[0]?.origin_type;
}

// Migration 030 enrolls a fixed set of pre-existing, versionless submissions.
// Membership is never granted by an API route; current owner/Plant/revision/
// status and the continued absence of versions are checked under the caller's
// Observation row lock on every legacy action.
async function legacyObservationEligibility(c, row) {
  const available = (await c.query(`SELECT to_regclass('plant_app.observation_legacy_review_eligibility') IS NOT NULL AS available`)).rows[0]?.available;
  if (!available) return null;
  return (await c.query(`SELECT e.* FROM observation_legacy_review_eligibility e
    WHERE e.observation_id=$1 AND e.plant_id=$2 AND e.owner_subject=$3
      AND $4::integer >= e.captured_revision
      AND $5::text IN ('Pending Review','Correction Required','Draft')
      AND NOT EXISTS (SELECT 1 FROM observation_submission_version v WHERE v.observation_id=e.observation_id)
      AND NOT EXISTS (SELECT 1 FROM plant_submission_receipt r WHERE r.result->>'id'=e.observation_id)
      AND $6::text IN ('subsequent_observation','unknown')`,
  [row.id, row.plant_id, row.owner_subject, row.revision, row.status, row.origin_type])).rows[0] || null;
}

async function hasLegacyCorrectionEvidence(c, row, draft = false, eligibility = null) {
  const reviewRevision = draft ? row.revision - 2 : row.revision - 1;
  if (reviewRevision > 0 && (await c.query(`SELECT 1 FROM observation_review
      WHERE observation_id=$1 AND decision='Correction Required' AND legacy_revision=$2
        AND reviewer_subject<>$3 AND NULLIF(btrim(comment),'') IS NOT NULL LIMIT 1`,
  [row.id, reviewRevision, row.owner_subject])).rows.length) return true;
  // Before Migration 030, existing review rows cannot carry an exact revision.
  // Permit only the exact state captured at migration time, and only once.
  if (!eligibility || eligibility.captured_status !== 'Correction Required') return false;
  const expectedRevision = draft ? eligibility.captured_revision + 1 : eligibility.captured_revision;
  if (row.revision !== expectedRevision) return false;
  return (await c.query(`SELECT 1 FROM observation_review
    WHERE observation_id=$1 AND decision='Correction Required' AND legacy_revision IS NULL
      AND reviewer_subject<>$2 AND NULLIF(btrim(comment),'') IS NOT NULL LIMIT 1`,
  [row.id, row.owner_subject])).rows.length > 0;
}

async function submittedObservationPhotos(c, row) {
  return (await c.query(`SELECT id FROM plant_asset WHERE observation_id=$1 AND plant_id=$2
    AND owner_subject=$3 AND content_type IN ('image/jpeg','image/png')
    ORDER BY created_at,id`, [row.id, row.plant_id, row.owner_subject])).rows.map(photo => photo.id);
}
async function audit(c, user, action, target) {
  await c.query(
    "INSERT INTO business_audit(id,actor_subject,action,target) VALUES($1,$2,$3,$4)",
    [randomUUID(), subject(user), action, String(target)],
  );
}
async function botanistNotificationsAvailable(c) {
  return Boolean((await c.query(
    "SELECT to_regclass(current_schema() || '.botanist_notification') IS NOT NULL AS available",
  )).rows[0]?.available);
}
async function speciesRow(c, speciesId, user, catalogue = false) {
  const row = (
    await c.query(
      `SELECT s.*,preview.id AS image_asset_id,g.genus_name,f.family_name,cs.status_name AS conservation_status,COALESCE(v.visibility,'protected') AS visibility FROM species s LEFT JOIN genus g ON g.genus_id=s.genus_id LEFT JOIN family f ON f.family_id=g.family_id LEFT JOIN conservation_status cs ON cs.status_id=s.status_id LEFT JOIN rbac_species_visibility v ON v.species_id=s.species_id ${await speciesImageJoin(c)} WHERE s.species_id=$1 AND COALESCE(s.rbac_data->>'approvalStatus','Approved')='Approved' AND COALESCE(v.visibility,'protected') = ANY($2::text[])`,
      [speciesId, catalogue ? catalogueVisibilityFor(user) : visibilityFor(user)],
    )
  ).rows[0];
  if (!row) fail(404, "Species unavailable.");
  return row;
}
// Public species responses are explicit allowlists; scientific contracts stay intact.
function readableSpecies(row, user, scientific, detail = false) {
  const result = projectSpecies(row, scientific);
  if (canReadScientificCatalogue(user)) return result;
  if (detail && !user) result.habitat = typeof result.habitat === "string" ? result.habitat : "";
  return Object.fromEntries(["species_id", "scientific_name", "common_name", "genus_name", "family_name", "description", "image_asset_id", "image_url", ...(detail && !user ? ["habitat"] : [])]
    .filter(key => Object.hasOwn(result, key)).map(key => [key, result[key]]));
}
function readablePublicPlant(row) {
  // Public discovery is already restricted to approved plants linked to an
  // approved, publicly visible species. Return only the current public plant
  // identity and its latest approved observation summary. Never return staff,
  // QR, or unreviewed submission fields through this projection.
  const result = Object.fromEntries([
    "plant_id", "species_id", "scientific_name", "common_name",
    "rbac_status", "observed_at", "current_registration", "latest_verified_observation",
  ].filter((key) => Object.hasOwn(row, key)).map((key) => [key, row[key]]));
  if (row.plant_image_asset_id != null)
    result.plant_image_asset_id = String(row.plant_image_asset_id);
  if (row.latest_approved && typeof row.latest_approved === "object") {
    const content = row.latest_approved.content && typeof row.latest_approved.content === "object"
      ? row.latest_approved.content
      : row.latest_approved;
    result.latest_approved = Object.fromEntries(
      ["heightCm", "healthStatus", "lifeStage", "morphology"]
        .filter((key) => Object.hasOwn(content, key))
        .map((key) => [key, content[key]]),
    );
  }
  return result;
}
async function statusReference(c, body) {
  if (body.conservation_status === undefined || body.conservation_status === "")
    return body.status_id || null;
  const name = text(body.conservation_status, 200);
  if (body.status_id)
    fail(400, "Provide a status ID or a verified status name, not both.");
  const old = (
    await c.query(
      "SELECT status_id FROM conservation_status WHERE lower(status_name)=lower($1) LIMIT 1",
      [name],
    )
  ).rows[0];
  if (old) return old.status_id;
  return (
    await c.query(
      "INSERT INTO conservation_status(status_name) VALUES($1) RETURNING status_id",
      [name],
    )
  ).rows[0].status_id;
}
async function assertNewSpecies(c, scientificName, { approvedOnly = false } = {}) {
  const normalized = normalizeSpeciesName(scientificName);
  await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [normalized]);
  if ((await c.query(`SELECT species_id FROM species WHERE ${sqlSpeciesName("scientific_name")}=$1
    AND (NOT $2::boolean OR COALESCE(rbac_data->>'approvalStatus','Approved')='Approved') LIMIT 1`, [normalized, approvedOnly])).rows.length)
    throw Object.assign(Error("This scientific name already exists. Select the existing species."), {
      status: 409, code: "SPECIES_DUPLICATE_APPROVED", duplicate_type: "approved",
    });
}
function mountDomain(app, { pool, auth, allow, officerNotifications = null, qrPlantSchema = "plant_app" }) {
  qrPlantSchema = normalizeQrPlantSchema(qrPlantSchema);
  const qrPlantRecord = qrPlantRecordRelation(qrPlantSchema);
  const qrPlantAssociation = "qr.plant_id=p.plant_id AND qr.qr_code=p.qr_token";
  const withQrGeneratorNames = async (rows) => {
    const names = new Map();
    for (const row of rows) {
      const owner = row.generator_subject;
      if (!owner?.startsWith("staff:") || !auth.db?.prepare) {
        row.generated_by_name = null;
        delete row.generator_subject;
        continue;
      }
      if (!names.has(owner)) {
        let name = null;
        try {
          const account = await auth.db.prepare("SELECT id,name,role FROM users WHERE id=?").get(owner.slice(6));
          if (account?.role === "Botanist" && typeof account.name === "string" && account.name.trim())
            name = account.name.trim();
        } catch { /* Missing account directory leaves the creator unavailable. */ }
        names.set(owner, name);
      }
      row.generated_by_name = names.get(owner);
      delete row.generator_subject;
    }
    return rows;
  };
  app.get('/api/admin/overview', allow('devices.manage'), async (req, res) => {
    if (req.user?.role !== 'Administrator') fail(403, 'Administrator access required.');
    const result = await pool.query(`SELECT
      (SELECT COUNT(*)::integer FROM plant_record) AS plants,
      (SELECT COUNT(*)::integer FROM threat_alert_history WHERE lower(status) <> $1) AS alerts`, ['resolved']);
    res.json({ overview: result.rows[0] });
  });

  app.get("/api/qr-codes", allow("plants.create"), async (_req, res) => {
    const requestedQrId = _req.query?.qr_id == null ? null : id(String(_req.query.qr_id));
    const qrCodes = (
      await pool.query(
        `SELECT q.qr_id,q.plant_id,q.qr_code,q.status,creator.generator_subject,
          CASE WHEN COALESCE(v.visibility,'protected') = ANY($1::text[]) THEN p.scientific_name END AS plant_name,
          q.generated_at,q.assigned_at,q.activated_at,q.retired_at
          FROM plant_app.qr_code q LEFT JOIN ${qrPlantRecord} p ON p.plant_id=q.plant_id
          LEFT JOIN rbac_species_visibility v ON v.species_id=p.species_id
          LEFT JOIN (
            SELECT generated.generated_id,CASE WHEN count(*)=1 THEN min(a.actor_subject) END AS generator_subject
            FROM business_audit a CROSS JOIN LATERAL unnest(string_to_array(a.target,',')) AS generated(generated_id)
            WHERE a.action='qr_codes_generated'
            GROUP BY generated.generated_id
          ) creator ON q.status='generated' AND q.plant_id IS NULL AND creator.generated_id=q.qr_id::text
          WHERE q.qr_id=$2 OR q.status='retired' OR q.qr_id IN (
             SELECT qr_id FROM plant_app.qr_code ORDER BY qr_id DESC LIMIT 500
          )
          ORDER BY q.qr_id DESC`,
        [visibilityFor(_req.user), requestedQrId],
      )
    ).rows;
    res.json({ qr_codes: await withQrGeneratorNames(qrCodes) });
  });
  app.delete("/api/qr-codes/:id", allow("plants.create"), async (req, res) => {
    const qrId = id(String(req.params.id));
    const retired = await transaction(pool, async (c) => {
      const qr = (await c.query(
        "SELECT qr_id,plant_id,status FROM plant_app.qr_code WHERE qr_id=$1 FOR UPDATE",
        [qrId],
      )).rows[0];
      if (!qr) fail(404, "QR code not found.");
      if (qr.plant_id != null || qr.status !== "generated")
        fail(409, "Only unused QR codes can be retired.");
      const result = (await c.query(
        "UPDATE plant_app.qr_code SET status='retired',retired_at=CURRENT_TIMESTAMP WHERE qr_id=$1 AND plant_id IS NULL AND status='generated' RETURNING qr_id",
        [qrId],
      )).rows[0];
      if (!result) fail(409, "QR code is no longer available.");
      await audit(c, req.user, "qr_code_retired", result.qr_id);
      return String(result.qr_id);
    });
    // Keep the legacy `deleted` success flag for clients that call this route;
    // the retained QR row now has status `retired` and can still be printed.
    res.json({ deleted: true, qr_id: retired, retired: true, status: "retired" });
  });
  app.post("/api/qr-codes", allow("plants.create"), async (req, res) => {
    const count = req.body?.count;
    if (!Number.isInteger(count) || count < 1 || count > 3)
      fail(400, "Generate between 1 and 3 QR codes at a time.");
    const qrCodes = await transaction(pool, async (c) => {
      const created = [];
      for (let index = 0; index < count; index++) {
        const code = randomBytes(24).toString("hex");
        const row = (
          await c.query(
            "INSERT INTO plant_app.qr_code(qr_code,status) VALUES($1,'generated') RETURNING qr_id,plant_id,qr_code,status,generated_at,assigned_at,activated_at,retired_at",
            [code],
          )
        ).rows[0];
        created.push(row);
      }
      await audit(c, req.user, "qr_codes_generated", created.map((row) => row.qr_id).join(","));
      return created;
    });
    res.status(201).json({ qr_codes: await withQrGeneratorNames(qrCodes.map((row) => ({ ...row, generator_subject: subject(req.user) }))) });
  });
  mountSpeciesRequests(app, { pool, allow, transaction, audit, subject, fail, text, id, assertNewSpecies, speciesRow, officerNotifications });
  app.get("/api/species", allow("plants.catalogue.read"), async (req, res) => {
    const scientific = req.query.scope === "scientific";
    if (scientific && !canReadScientificCatalogue(req.user))
      fail(req.user ? 403 : 401, "Scientific access required.");
    if (req.query.q !== undefined && typeof req.query.q !== "string")
      fail(400, "Search must be text.");
    const q = (req.query.q ?? "").trim();
    if (q.length > 200) fail(400, "Search is too long.");
    const rows = (
      await pool.query(
        `SELECT s.*,preview.id AS image_asset_id,g.genus_name,f.family_name,cs.status_name AS conservation_status,COALESCE(v.visibility,'protected') AS visibility FROM species s LEFT JOIN genus g ON g.genus_id=s.genus_id LEFT JOIN family f ON f.family_id=g.family_id LEFT JOIN conservation_status cs ON cs.status_id=s.status_id LEFT JOIN rbac_species_visibility v ON v.species_id=s.species_id ${await speciesImageJoin(pool)} WHERE COALESCE(s.rbac_data->>'approvalStatus','Approved')='Approved' AND COALESCE(v.visibility,'protected') = ANY($1::text[]) AND strpos(lower(coalesce(s.scientific_name,'')||' '||coalesce(s.common_name,'')||' '||coalesce(g.genus_name,'')||' '||coalesce(f.family_name,'')),lower($2))>0 ORDER BY s.scientific_name LIMIT 200`,
        [catalogueVisibilityFor(req.user), q],
      )
    ).rows;
    res.json({ species: rows.map((r) => readableSpecies(r, req.user, scientific)) });
  });
  app.get("/api/species/:id", allow("plants.catalogue.read"), async (req, res) => {
    const scientific = canReadScientificCatalogue(req.user),
      row = await speciesRow(pool, id(req.params.id), req.user, true);
    res.json({ species: readableSpecies(row, req.user, scientific, true) });
  });
  const readPlants = async (req, res) => {
    // Guest web cards omit the observation summary used by the mobile contract.
    // Keep the default projection and every authenticated role unchanged.
    const publicWeb = req.query.scope === "public-web";
    if (publicWeb && req.user) fail(403, "Guest catalogue required.");
    // Personal submission history is distinct from access to the species catalogue.
    const mine = req.query.scope === "mine";
    if (mine && !permitted(req.user, "plants.create"))
      fail(req.user ? 403 : 401, "Botanist access required.");
    const plantId = req.params.id === undefined ? null : req.params.id;
    if (
      plantId !== null &&
      (!/^[1-9][0-9]{0,9}$/.test(plantId) || Number(plantId) > 2147483647)
    )
      fail(400, "Invalid plant identifier.");
    const pageOptions = publicPlantPageOptions(req.query, plantId === null && !publicWeb && !mine && !req.user);
    const staff = canReadScientificCatalogue(req.user);
    if (req.query.summary === "species-counts" && plantId === null && !publicWeb && !mine && !pageOptions) {
      return res.json({ species_counts: await readPlantSpeciesCounts(pool, catalogueVisibilityFor(req.user), staff) });
    }
    const rows = (
      await pool.query(
        `SELECT p.plant_id,p.species_id,p.scientific_name,p.rbac_status,p.registered_subject,p.registered_at,
          p.qr_token,qr.qr_id,qr.status AS qr_status,
          plant_preview.id AS plant_image_asset_id,
          CASE WHEN COALESCE(v.visibility,'protected') = ANY($1::text[]) OR ($5 AND p.registered_subject=$2)
            THEN COALESCE(approved_location_row.latitude,approved_location.latitude) END AS latitude,
          CASE WHEN COALESCE(v.visibility,'protected') = ANY($1::text[]) OR ($5 AND p.registered_subject=$2)
            THEN COALESCE(approved_location_row.longitude,approved_location.longitude) END AS longitude,
          CASE WHEN COALESCE(v.visibility,'protected') = ANY($1::text[]) OR ($5 AND p.registered_subject=$2)
            THEN COALESCE(approved_location_row.accuracy_m,approved_location.accuracy_m) END AS accuracy_m,
          CASE WHEN COALESCE(v.visibility,'protected') = ANY($1::text[]) OR ($5 AND p.registered_subject=$2)
            THEN approved_location.altitude_m END AS altitude_m,
          CASE WHEN COALESCE(v.visibility,'protected') = ANY($1::text[]) OR ($5 AND p.registered_subject=$2)
            THEN approved_location.zone END AS zone,
          o.content AS latest_approved,o.updated_at AS observed_at,
          verified.id AS verified_observation_id,verified.created_at AS verified_observation_date,
          verified.content AS verified_observation_content,
          (SELECT jsonb_agg(a.id ORDER BY a.created_at,a.id) FROM plant_asset a
            WHERE a.plant_id=p.plant_id AND a.observation_id=verified.id AND a.species_id IS NULL
              AND a.content_type IN ('image/jpeg','image/png')) AS verified_photo_ids,
          submitted.content AS latest_submission,submitted.id AS latest_observation_id,submitted.status AS observation_status,
          CASE WHEN NOT $5 OR COALESCE(v.visibility,'protected') = ANY($1::text[]) OR
            ($5 AND $8 AND p.registered_subject=$2 AND s.rbac_data->>'submittedBy'=$2
              AND s.rbac_data->>'approvalStatus' IN ('Pending Review','Rejected','Correction Required')) THEN s.common_name END AS common_name,
          COALESCE(v.visibility,'protected') AS species_visibility,
          CASE WHEN NOT $5 OR COALESCE(v.visibility,'protected') = ANY($1::text[]) OR
            ($5 AND $8 AND p.registered_subject=$2 AND s.rbac_data->>'submittedBy'=$2
              AND s.rbac_data->>'approvalStatus' IN ('Pending Review','Rejected','Correction Required')) THEN jsonb_build_object('species_id',s.species_id,'scientific_name',s.scientific_name,'common_name',s.common_name,
            'description',s.description,'habitat',s.rbac_data->>'habitat','genus_name',g.genus_name,
            'family_name',f.family_name,'conservation_status',cs.status_name) END AS species_details
          FROM plant_record p JOIN species s ON s.species_id=p.species_id
          LEFT JOIN plant_app.qr_code qr ON ${qrPlantAssociation}
          LEFT JOIN LATERAL (
            SELECT a.id
            FROM plant_asset a
            LEFT JOIN plant_observation image_observation
              ON image_observation.id=a.observation_id
              AND image_observation.plant_id=p.plant_id
            WHERE a.plant_id=p.plant_id
              AND a.content_type IN ('image/jpeg','image/png')
              AND (
                (p.rbac_status='Approved' AND (
                  (a.observation_id IS NULL AND a.approved=TRUE)
                  OR (image_observation.id IS NOT NULL AND image_observation.status='Approved'
                    AND image_observation.id=(SELECT current_observation.id FROM plant_observation current_observation
                      WHERE current_observation.plant_id=p.plant_id AND current_observation.status='Approved'
                      ORDER BY current_observation.updated_at DESC,current_observation.id DESC LIMIT 1))
                ))
                OR ($6 AND p.rbac_status<>'Approved' AND p.registered_subject=$2
                  AND a.owner_subject=$2
                  AND image_observation.id IS NOT NULL
                  AND (image_observation.status='Pending Review' OR
                    ($5 AND image_observation.status='Rejected' AND image_observation.owner_subject=$2
                      AND image_observation.id=(SELECT latest_submission.id FROM plant_observation latest_submission
                        WHERE latest_submission.plant_id=p.plant_id AND latest_submission.owner_subject=$2
                        ORDER BY latest_submission.created_at DESC,latest_submission.id DESC LIMIT 1)) OR
                    (image_observation.status='Approved' AND image_observation.id=(
                      SELECT current_observation.id FROM plant_observation current_observation
                      WHERE current_observation.plant_id=p.plant_id AND current_observation.status='Approved'
                      ORDER BY current_observation.updated_at DESC,current_observation.id DESC LIMIT 1
                    ))))
              )
            ORDER BY CASE WHEN image_observation.status='Rejected' THEN 0 ELSE 1 END,a.created_at,a.id
            LIMIT 1
          ) plant_preview ON true
          LEFT JOIN genus g ON g.genus_id=s.genus_id LEFT JOIN family f ON f.family_id=g.family_id
          LEFT JOIN conservation_status cs ON cs.status_id=s.status_id
          LEFT JOIN LATERAL (
            SELECT candidate.latitude::double precision AS latitude,
              candidate.longitude::double precision AS longitude,
              CASE WHEN candidate.accuracy_m >= 0 THEN candidate.accuracy_m::double precision END AS accuracy_m,
              candidate.altitude_m::double precision AS altitude_m,candidate.zone
            FROM (
              SELECT observation.updated_at,observation.id,
                CASE WHEN jsonb_typeof(observation.content->'latitude')='number'
                  THEN (observation.content->>'latitude')::numeric END AS latitude,
                CASE WHEN jsonb_typeof(observation.content->'longitude')='number'
                  THEN (observation.content->>'longitude')::numeric END AS longitude,
                CASE WHEN jsonb_typeof(observation.content->'accuracy_m')='number'
                  THEN (observation.content->>'accuracy_m')::numeric END AS accuracy_m,
                CASE WHEN jsonb_typeof(observation.content->'altitudeM')='number'
                  THEN (observation.content->>'altitudeM')::numeric
                  WHEN jsonb_typeof(observation.content->'altitude_m')='number'
                  THEN (observation.content->>'altitude_m')::numeric END AS altitude_m,
                CASE WHEN jsonb_typeof(observation.content->'zone')='string'
                  THEN NULLIF(btrim(observation.content->>'zone'),'') END AS zone
              FROM plant_observation observation
              WHERE observation.plant_id=p.plant_id AND observation.status='Approved'
            ) candidate
            WHERE candidate.latitude BETWEEN -90 AND 90 AND candidate.longitude BETWEEN -180 AND 180
            ORDER BY candidate.updated_at DESC,candidate.id DESC LIMIT 1
          ) approved_location ON true
          LEFT JOIN LATERAL (
            SELECT location.latitude,location.longitude,location.accuracy_m
            FROM plant_location AS location
            WHERE location.plant_id=p.plant_id
              AND location.latitude=approved_location.latitude
              AND location.longitude=approved_location.longitude
            ORDER BY location.recorded_at DESC,location.location_id DESC
            LIMIT 1
          ) approved_location_row ON approved_location.latitude IS NOT NULL
            AND approved_location.longitude IS NOT NULL
          LEFT JOIN plant_observation o ON o.id=(SELECT id FROM plant_observation WHERE plant_id=p.plant_id AND status='Approved'
            AND (NOT $5 OR owner_subject=$2 OR EXISTS (
              SELECT 1 FROM rbac_species_visibility observation_visibility
              WHERE observation_visibility.species_id=p.species_id
                AND observation_visibility.visibility=ANY($1::text[])
            )) ORDER BY updated_at DESC,id DESC LIMIT 1)
          LEFT JOIN LATERAL (SELECT id,created_at,content FROM plant_observation
            WHERE plant_id=p.plant_id AND status='Approved'
            ORDER BY created_at DESC,id DESC LIMIT 1) verified ON true
          LEFT JOIN LATERAL (SELECT id,content,status FROM plant_observation WHERE plant_id=p.plant_id AND (owner_subject=$2 OR $3) ORDER BY created_at DESC,id DESC LIMIT 1) submitted ON true
          LEFT JOIN rbac_species_visibility v ON v.species_id=p.species_id
          WHERE (CASE WHEN $5 THEN p.registered_subject=$2 ELSE (COALESCE(v.visibility,'protected') = ANY($1::text[]) OR
            ($8 AND p.rbac_status='Pending Review' AND p.registered_subject=$2) OR
            (p.registered_subject=$2 AND p.rbac_status='Pending Review' AND s.rbac_data->>'submittedBy'=$2
             AND s.rbac_data->>'approvalStatus' IN ('Pending Review','Rejected','Correction Required'))) END)
          AND (CASE WHEN $8 AND NOT $5
            THEN p.rbac_status='Approved' OR (p.rbac_status='Pending Review' AND p.registered_subject=$2)
            ELSE p.rbac_status='Approved' OR p.registered_subject=$2 OR $3 END)
          AND ($7 OR COALESCE(s.rbac_data->>'approvalStatus','Approved')='Approved')
          AND ($4::integer IS NULL OR p.plant_id=$4)
          ${pageOptions ? "AND p.species_id=$9 AND ($10::integer IS NULL OR p.plant_id<$10)" : ""}
          ORDER BY p.plant_id DESC LIMIT ${pageOptions ? "$11" : "500"}`,
        [
          catalogueVisibilityFor(req.user),
          req.user ? subject(req.user) : "",
          req.user?.role === "Conservation Officer" || permitted(req.user, "plants.catalogue.scientific.read"),
          plantId,
          mine,
          permitted(req.user, "plants.create"),
          staff,
          req.user?.role === "Botanist",
          ...(pageOptions ? [pageOptions.speciesId, pageOptions.before, pageOptions.limit + 1] : []),
        ],
      )
    ).rows;
    const page = pageOptions ? publicPlantPageMetadata(rows, pageOptions.limit) : null;
    if (page?.has_more) rows.pop();
    // Parent authorization above runs before resolving any private history.
    const registrations = await resolvePlantRegistrations(pool, rows.filter(r => r.rbac_status === "Approved").map(r => r.plant_id));
    for (const row of rows) {
      if (row.rbac_status !== "Approved") continue;
      const registration = registrations.get(String(row.plant_id));
      const fields = staff ? ["heightCm", "healthStatus", "lifeStage", "morphology", "notes", "taxonomy"] :
        ["heightCm", "healthStatus", "lifeStage", "morphology"];
      row.current_registration = registration?.state === "available" ? {
        state: "available", observation_id: registration.observation_id,
        ...(staff ? { observation_revision: registration.observation_revision, version_id: registration.version_id, version_number: registration.version_number } : {}),
        content: Object.fromEntries(fields.filter(key => Object.hasOwn(registration.content, key)).map(key => [key, registration.content[key]])),
        photo_ids: registration.photo_ids,
      } : { state: "unavailable" };
      row.plant_image_asset_id = registration?.photo_ids?.[0] ?? null;
      const canLocate = catalogueVisibilityFor(req.user).includes(row.species_visibility) || (mine && row.registered_subject === subject(req.user));
      Object.assign(row, canLocate ? registrationLocation(registration) : registrationLocation(null));
    }
    for (const row of rows) {
      const content = row.verified_observation_content;
      row.latest_verified_observation = content ? {
        id: row.verified_observation_id, date: row.verified_observation_date, status: "Approved",
        photo_ids: row.verified_photo_ids || [],
        content: Object.fromEntries(["heightCm", "healthStatus", "lifeStage", "morphology", ...(staff ? ["notes", "taxonomy"] : [])]
          .filter(key => Object.hasOwn(content, key)).map(key => [key, content[key]])),
      } : null;
      if (content && staff) {
        const visible = catalogueVisibilityFor(req.user).includes(row.species_visibility) || (mine && row.registered_subject === subject(req.user));
        const source = { ...row, ...registrationLocation(visible ? { state: "available", content } : null) };
        const safe = req.user?.role === "Botanist" ? projectApprovedPlantGps([source], req.user)[0] :
          permitted(req.user, "plants.catalogue.scientific.read") ? source : projectGps([source], req.user)[0];
        row.latest_verified_observation.location = Object.fromEntries(["latitude", "longitude", "accuracy_m", "altitude_m", "zone"]
          .map(key => [key, safe[key] ?? null]));
      }
      delete row.verified_photo_ids;
      delete row.verified_observation_content;
      delete row.verified_observation_id;
      delete row.verified_observation_date;
    }
    const plants = rows.map((r) => {
      if (publicWeb) return {
        plant_id: r.plant_id, species_id: r.species_id,
        ...(r.plant_image_asset_id == null ? {} : { plant_image_asset_id: String(r.plant_image_asset_id) }),
      };
      const plant = staff
        ? { ...r }
        : readablePublicPlant(r);
      delete plant.species_visibility;
      if (req.user?.role === "Botanist" && !catalogueVisibilityFor(req.user).includes(r.species_visibility ?? "protected") && !(mine && r.registered_subject === subject(req.user)))
        plant.gps_access_restricted = true;
      return plant;
    });
    let projectedPlants = req.user?.role === "Botanist"
      ? projectApprovedPlantGps(plants, req.user)
      : permitted(req.user, "plants.catalogue.scientific.read") ? plants : projectGps(plants, req.user);
    // A Botanist may see the exact location they submitted for their own
    // initial pending record. Keep this owner-scoped exception separate from
    // the approved-location projection used by catalog and public reads.
    if (req.user?.role === "Botanist" && mine) {
      projectedPlants = projectedPlants.map((projected, index) => {
        const source = plants[index];
        if (source.rbac_status !== "Pending Review" || source.registered_subject !== subject(req.user))
          return projected;
        const submission = source.latest_submission?.content && typeof source.latest_submission.content === "object"
          ? source.latest_submission.content
          : source.latest_submission;
        if (!submission || typeof submission !== "object") return projected;
        const latitude = submission.latitude;
        const longitude = submission.longitude;
        const accuracy = submission.accuracy_m;
        const altitude = submission.altitudeM ?? submission.altitude_m;
        const zone = submission.zone;
        return {
          ...projected,
          latitude: typeof latitude === "number" && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 ? latitude : null,
          longitude: typeof longitude === "number" && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 ? longitude : null,
          accuracy_m: typeof accuracy === "number" && Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null,
          altitude_m: typeof altitude === "number" && Number.isFinite(altitude) ? altitude : null,
          zone: typeof zone === "string" && zone.trim() ? zone : null,
        };
      });
    }
    if (plantId !== null) {
      if (!plants.length) fail(404, "Plant unavailable.");
      return res.json({ plant: projectedPlants[0] });
    }
    res.json({
      plants: projectedPlants,
      ...(page ? { page } : {}),
    });
  };
  app.get("/api/plants", allow("plants.catalogue.read"), readPlants);
  app.get("/api/plants/:id", allow("plants.catalogue.read"), readPlants);
  app.post("/api/plants", allow("plants.create"), async (req, res) => {
    const b = req.body;
    if (
      Object.keys(b).some(
        (k) =>
          ![
            "species_id",
            "scientific_name",
            "qr_id",
            "latitude",
            "longitude",
            "accuracy_m",
            "content",
            "client_key",
          ].includes(k),
      )
    )
      fail(400, "Ownership and status are assigned by the server.");
    const content = fieldContent({
      ...b.content,
      latitude: b.latitude,
      longitude: b.longitude,
      ...(b.accuracy_m === undefined ? {} : { accuracy_m: b.accuracy_m }),
    });
    text(b.client_key, 100);
    id(String(b.species_id));
    id(String(b.qr_id));
    assertQrAssignmentAllowed(qrPlantSchema);
    // Older API clients omit this field; never substitute the species name.
    // Add Plant always sends it and requires manual entry before submission.
    const hasPlantScientificName = Object.hasOwn(b, "scientific_name");
    const plantScientificName = hasPlantScientificName ? text(b.scientific_name, 200) : null;
    const result = await transaction(pool, async (c) => {
      // BEGIN IMMEDIATE serializes writers before checking idempotency.
      const previous = (
        await c.query(
          "SELECT o.* ,p.species_id,p.scientific_name FROM plant_observation o JOIN plant_record p ON p.plant_id=o.plant_id WHERE o.owner_subject=$1 AND o.client_key=$2",
          [subject(req.user), b.client_key],
        )
      ).rows[0];
      if (previous) {
        if (String(previous.species_id) !== String(b.species_id))
          fail(409, "Draft key already belongs to a different species.");
        if (hasPlantScientificName && previous.scientific_name !== plantScientificName)
          fail(409, "Draft key already belongs to a different plant scientific name.");
        await speciesRow(c, previous.species_id, req.user);
        return previous;
      }
      await speciesRow(c, b.species_id, req.user);
      const qr = (
        await c.query(
          "SELECT qr_id,qr_code FROM plant_app.qr_code WHERE qr_id=$1 AND plant_id IS NULL AND status='generated' FOR UPDATE",
          [b.qr_id],
        )
      ).rows[0];
      if (!qr) fail(409, "The selected QR code is no longer available.");
      const plant = (
        await c.query(
          "INSERT INTO plant_record(species_id,registered_subject,qr_token,scientific_name) VALUES($1,$2,$3,$4) RETURNING plant_id",
          [b.species_id, subject(req.user), qr.qr_code, plantScientificName],
        )
      ).rows[0];
      await c.query(
        "UPDATE plant_app.qr_code SET plant_id=$1,status='assigned',assigned_at=CURRENT_TIMESTAMP WHERE qr_id=$2 AND plant_id IS NULL",
        [plant.plant_id, qr.qr_id],
      );
      await c.query(
        "INSERT INTO plant_location(plant_id,latitude,longitude,accuracy_m) VALUES($1,$2,$3,$4)",
        [plant.plant_id, b.latitude, b.longitude, b.accuracy_m ?? null],
      );
      const observationId = randomUUID();
      await c.query(
        "INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key) VALUES($1,$2,$3,'Draft',$4,$5)",
        [
          observationId,
          plant.plant_id,
          subject(req.user),
          content,
          b.client_key,
        ],
      );
      await audit(c, req.user, "plant_submitted", plant.plant_id);
      return { ...plant, id: observationId };
    });
    res.status(201).json(result);
  });
  const withRecorderNames = async (rows) => {
    const names = new Map();
    for (const row of rows) {
      const owner = row.owner_subject;
      if (!names.has(owner)) {
        let name = null;
        if (owner?.startsWith("staff:") && auth.db?.prepare) {
          try {
            const account = await auth.db.prepare("SELECT id,name,role FROM users WHERE id=?").get(owner.slice(6));
            if (account?.role === "Botanist" && typeof account.name === "string" && account.name.trim())
              name = account.name.trim();
          } catch { /* Observation remains readable if the account directory is unavailable. */ }
        }
        names.set(owner, name);
      }
      row.recorded_by_name = names.get(owner);
    }
    return rows;
  };
  const withCurrentApprovedEditReview = async (rows) => {
    const ids = rows.filter((row) => row.status === "Approved").map((row) => row.id);
    if (!ids.length) return rows;
    try {
      const available = (await pool.query("SELECT to_regclass(current_schema() || '.observation_edit_request') IS NOT NULL AS available")).rows[0]?.available;
      if (!available) return rows;
      const reviews = (await pool.query(`SELECT DISTINCT ON (observation_id) observation_id,review_comment,reviewed_at
        FROM observation_edit_request WHERE observation_id=ANY($1::text[]) AND status='Approved'
        ORDER BY observation_id,version_number DESC,id DESC`, [ids])).rows;
      const byId = new Map(reviews.map((review) => [review.observation_id, review]));
      return rows.map((row) => {
        const review = row.status === "Approved" ? byId.get(row.id) : null;
        return review ? { ...row, review_comment: review.review_comment, reviewed_at: review.reviewed_at,
          review_decision: "Approved" } : row;
      });
    } catch { return rows; }
  };
  const enrichObservationRead = async (rows, officer, classified = false) => withRecorderNames(
    await withCurrentApprovedEditReview(await withResubmissionEvidence(pool,
      classified ? rows : await classifyObservations(pool, rows), officer)));
  const readObservations = async (req, res) => {
    const mine = req.query.scope === "mine";
    if (mine && !permitted(req.user, "plants.create"))
      fail(req.user ? 403 : 401, "Botanist access required.");
    const observationId = req.params.id ?? null;
    const pageOptions = observationId === null ? queueOptions(req.query, fail) : null;
    // Imported IDs may be numeric; new records use UUIDs.
    if (
      observationId !== null &&
      !/^(?:[1-9][0-9]{0,18}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(
        observationId,
      )
    )
      fail(400, "Invalid observation identifier.");
    const officer = req.user.role === "Conservation Officer";
    const requestSql = observationRequestSql(await requestsAvailable(pool), await provenanceAvailable(pool));
    const rows = (
      await pool.query(

        `SELECT o.*,${pageOptions ? `to_char(o.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS queue_created_at,` : ""}
          COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', a.id,
                'content_type', a.content_type
              )
              ORDER BY
                CASE
                  WHEN a.client_key ~ ':photo:[0-9]+$'
                  THEN substring(a.client_key from ':photo:([0-9]+)$')::numeric
                END ASC NULLS LAST,
                a.created_at ASC,
                a.id ASC
            )
            FROM plant_asset a
            WHERE a.observation_id = o.id
          ), '[]') AS assets,
          p.species_id,
          COALESCE(v.visibility, 'protected') = ANY($3::text[]) AS gps_visibility_allowed,
          CASE WHEN $1 OR COALESCE(v.visibility, 'protected') = ANY($3::text[]) THEN p.scientific_name END AS plant_scientific_name,
          CASE WHEN $1 OR COALESCE(v.visibility, 'protected') = ANY($3::text[]) THEN s.scientific_name END AS species_scientific_name,
          CASE
            WHEN $1
              OR COALESCE(v.visibility, 'protected') = ANY($3::text[])
            THEN s.scientific_name
          END AS scientific_name,
          CASE
            WHEN $1
              OR COALESCE(v.visibility, 'protected') = ANY($3::text[])
            THEN s.common_name
          END AS common_name,
          r.comment AS review_comment,
          r.decision AS review_decision,
          r.created_at AS reviewed_at,r.review_origin,CASE WHEN $1 THEN r.reviewer_subject END AS reviewed_by,
          ${requestSql.select}
        FROM plant_observation o
        JOIN plant_record p ON p.plant_id = o.plant_id
        JOIN species s ON s.species_id = p.species_id
        ${requestSql.join}
        LEFT JOIN LATERAL (
          SELECT comment, decision, created_at,reviewer_subject,to_jsonb(observation_review)->>'review_origin' AS review_origin
          FROM observation_review
          WHERE observation_id = o.id
          ORDER BY created_at DESC
          LIMIT 1
        ) r ON true
        LEFT JOIN rbac_species_visibility v
          ON v.species_id = p.species_id
        WHERE ($1 OR o.owner_subject = $2 OR (
            o.status = 'Approved'
            AND COALESCE(v.visibility, 'protected') = ANY($3::text[])
          ))
          AND (
            CASE
              WHEN $5 THEN
                o.owner_subject = $2
              ELSE (
                COALESCE(v.visibility, 'protected') = ANY($3::text[])
                OR o.owner_subject = $2
              )
            END
          )
          AND ($4::text IS NULL OR o.id = $4)
          ${pageOptions ? "AND ($6::text='' OR o.status=$6) AND ($7::timestamptz IS NULL OR (o.created_at,o.id)<($7::timestamptz,$8::text))" : ""}
        ORDER BY o.created_at DESC,o.id DESC
        LIMIT ${pageOptions ? "$9" : "500"}`,
        [
          officer,
          subject(req.user),
          visibilityFor(req.user),
          observationId,
          mine,
          ...(pageOptions ? [pageOptions.status, pageOptions.cursor?.at || null, pageOptions.cursor?.id || null, pageOptions.limit + 1] : []),
        ],

      )
    ).rows;
    if (observationId !== null) {
      if (!rows.length) fail(404, "Observation unavailable.");
      const enriched = await enrichObservationRead(rows, officer);
      const updated = await withSubmissionUpdates(pool, enriched, officer);
      const projected = officer ? await observationHistory(pool, updated) : updated;
      return res.json({ observation: projectObservationGps(projected[0], req.user, subject(req.user), projectGps) });
    }
    const hasMore = pageOptions && rows.length > pageOptions.limit;
    const batch = pageOptions ? rows.slice(0, pageOptions.limit) : rows;
    const classified = await classifyObservations(pool, batch);
    const visible = pageOptions?.origin ? classified.filter(row => row.origin_type === pageOptions.origin) : classified;
    const enriched = await enrichObservationRead(visible, officer, true);
    const updated = await withSubmissionUpdates(pool, enriched, officer);
    const projected = officer ? await observationHistory(pool, updated) : updated;
    res.json({ observations: projected.map(({ queue_created_at, ...row }) =>
      projectObservationGps(row, req.user, subject(req.user), projectGps)),
      ...(pageOptions ? { page: queuePage(batch, pageOptions, Boolean(hasMore)) } : {}) });
  };
  app.get(
    "/api/observations",
    allow("plants.scientific.read"),
    readObservations,
  );
  app.get(
    "/api/observations/:id",
    allow("plants.scientific.read"),
    readObservations,
  );
  app.get("/api/notifications", allow("observations.create"), async (req, res) => {
    if (String(req.user?.role || "").toLowerCase() !== "botanist")
      fail(403, "Botanist notifications are unavailable for this account.");
    if (!(await botanistNotificationsAvailable(pool)))
      fail(503, "Persistent notification history requires the approved Botanist notification migration.");
    const recordChangesAvailable = (await pool.query("SELECT to_regclass(current_schema() || '.record_change_submission') IS NOT NULL AS available")).rows[0]?.available;
    const recordChangeReviewEventsAvailable = recordChangesAvailable && (await pool.query("SELECT to_regclass(current_schema() || '.record_change_review_event') IS NOT NULL AS available")).rows[0]?.available;
    const rows = (await pool.query(
      `SELECT n.id,n.type,n.source_key,n.observation_id,n.plant_id,n.created_at,
        (n.read_at IS NOT NULL) AS read,n.metadata,COALESCE(r.comment,${recordChangesAvailable && recordChangeReviewEventsAvailable ? "rce.comment" : "NULL"}) AS comment
       FROM botanist_notification n
       LEFT JOIN observation_review r ON r.id=n.review_id
       ${recordChangesAvailable ? "LEFT JOIN record_change_submission rc ON rc.id=n.metadata->>'changeId' AND rc.owner_subject=n.recipient_subject" : ""}
       ${recordChangeReviewEventsAvailable ? "LEFT JOIN record_change_review_event rce ON rce.change_id=rc.id AND rce.revision::text=n.metadata->>'revision'" : ""}
       WHERE n.recipient_subject=$1
       ORDER BY n.created_at DESC,n.id DESC`,
      [subject(req.user)],
    )).rows;
    const speciesRows = await requestsAvailable(pool) ? (await pool.query(
      `SELECT request_id,request_status,review_comment,submitted_at,reviewed_at
       FROM species_request_submission WHERE owner_subject=$1
       AND request_status IN ('Pending Review','Approved','Rejected','Correction Required')
       ORDER BY COALESCE(reviewed_at,submitted_at) DESC LIMIT 200`,
      [subject(req.user)],
    )).rows : [];
    const speciesTypes = { "Pending Review": "species_request_submitted", Approved: "species_request_approved",
      Rejected: "species_request_rejected", "Correction Required": "species_correction_requested" };
    const editAvailable = (await pool.query("SELECT to_regclass(current_schema() || '.observation_edit_request') IS NOT NULL AS available")).rows[0]?.available;
    const editEvents = editAvailable ? (await pool.query(`SELECT e.id,e.request_id,e.observation_id,e.event_type,e.comment,e.created_at,e.read_at,o.plant_id
      FROM observation_edit_event e JOIN observation_edit_request r ON r.id=e.request_id
      JOIN plant_observation o ON o.id=e.observation_id WHERE r.owner_subject=$1
      ORDER BY e.created_at DESC LIMIT 500`, [subject(req.user)])).rows : [];
    const editTypes = { submitted: "observation_edit_submitted", correction_required: "observation_edit_correction",
      resubmitted: "observation_edit_resubmitted", approved: "observation_edit_approved", rejected: "observation_edit_rejected",
      cancelled: "observation_edit_cancelled" };
    res.json({ notifications: [...rows.map((row) => {
      const legacyObservationEdit = row.metadata?.entityType === "legacy_observation_edit" &&
        typeof row.metadata?.requestId === "string" && Number.isInteger(row.metadata?.revision) && row.observation_id;
      const legacyEditTypes = { observation_approved: "observation_edit_approved", observation_rejected: "observation_edit_rejected",
        correction_requested: "observation_edit_correction" };
      return {
      id: row.id,
      type: legacyObservationEdit ? legacyEditTypes[row.type] || row.type : row.type,
      sourceKey: row.source_key,
      ...(row.observation_id ? { observationId: String(row.observation_id) } : {}),
      ...(row.plant_id != null ? { plantId: String(row.plant_id) } : {}),
      createdAt: row.created_at,
      read: Boolean(row.read),
      ...(typeof row.comment === "string" ? { comment: row.comment } : {}),
      ...(legacyObservationEdit && typeof row.metadata?.comment === "string" ? { comment: row.metadata.comment } : {}),
      ...(row.metadata?.count != null ? { count: Number(row.metadata.count) } : {}),
      ...(typeof row.metadata?.draftKey === "string" ? { draftKey: row.metadata.draftKey } : {}),
      ...(["record_change_correction", "record_change_approved", "record_change_rejected"].includes(row.type) && row.metadata?.entityType === "record_change" &&
        ["plant", "species"].includes(row.metadata?.recordKind) && typeof row.metadata?.changeId === "string" && typeof row.metadata?.targetId === "string"
        ? { entityType: "record_change", changeId: row.metadata.changeId, recordKind: row.metadata.recordKind,
          targetId: row.metadata.targetId, ...(Number.isInteger(row.metadata.revision) ? { revision: row.metadata.revision } : {}) } : {}),
      ...(legacyObservationEdit ? { entityType: "observation_edit", requestId: row.metadata.requestId,
        ...(Number.isInteger(row.metadata.revision) ? { revision: row.metadata.revision } : {}) } : {}),
    }; }), ...speciesRows.map((row) => ({
      id: `species-request:${row.request_id}:${row.request_status}:${new Date(row.reviewed_at || row.submitted_at).toISOString()}`,
      type: speciesTypes[row.request_status], entityType: "species_request", requestId: String(row.request_id),
      sourceKey: `species-request:${row.request_id}:${row.request_status}`, createdAt: row.reviewed_at || row.submitted_at,
      read: true, ...(row.review_comment ? { comment: row.review_comment } : {}),
    })), ...editEvents.map((event) => ({ id: `observation-edit:${event.id}`, type: editTypes[event.event_type],
      entityType: "observation_edit", requestId: event.request_id, observationId: event.observation_id,
      plantId: String(event.plant_id), createdAt: event.created_at, read: Boolean(event.read_at),
      ...(event.comment ? { comment: event.comment } : {}),
    }))] });
  });
  app.post("/api/notifications/read", allow("observations.create"), async (req, res) => {
    if (String(req.user?.role || "").toLowerCase() !== "botanist")
      fail(403, "Botanist notifications are unavailable for this account.");
    if (!(await botanistNotificationsAvailable(pool)))
      fail(503, "Persistent notification history requires the approved Botanist notification migration.");
    const all = req.body?.all === true;
    const ids = req.body?.ids;
    if (all && ids !== undefined) fail(400, "Choose either selected notifications or all notifications.");
    if (!all && (!Array.isArray(ids) || ids.length > 10000 || ids.some((value) => typeof value !== "string" || !value || value.length > 200)))
      fail(400, "Invalid notification identifiers.");
    const result = all
      ? await pool.query("UPDATE botanist_notification SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP) WHERE recipient_subject=$1 AND read_at IS NULL", [subject(req.user)])
      : await pool.query("UPDATE botanist_notification SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP) WHERE recipient_subject=$1 AND id=ANY($2::text[]) AND read_at IS NULL", [subject(req.user), [...new Set(ids)]]);
    let editResult = { rowCount: 0 };
    const editsAvailable = (await pool.query("SELECT to_regclass(current_schema() || '.observation_edit_event') IS NOT NULL AS available")).rows[0]?.available;
    if (editsAvailable) editResult = all
      ? await pool.query(`UPDATE observation_edit_event e SET read_at=COALESCE(e.read_at,CURRENT_TIMESTAMP)
          FROM observation_edit_request r WHERE r.id=e.request_id AND r.owner_subject=$1 AND e.read_at IS NULL`, [subject(req.user)])
      : await pool.query(`UPDATE observation_edit_event e SET read_at=COALESCE(e.read_at,CURRENT_TIMESTAMP)
          FROM observation_edit_request r WHERE r.id=e.request_id AND r.owner_subject=$1 AND e.id=ANY($2::text[]) AND e.read_at IS NULL`,
        [subject(req.user), ids.filter((value) => value.startsWith("observation-edit:")).map((value) => value.slice("observation-edit:".length))]);
    res.json({ updated: result.rowCount + editResult.rowCount });
  });
  app.post("/api/notifications/sync", allow("observations.create"), async (req, res) => {
    if (String(req.user?.role || "").toLowerCase() !== "botanist")
      fail(403, "Botanist notifications are unavailable for this account.");
    if (!(await botanistNotificationsAvailable(pool)))
      fail(503, "Persistent notification history requires the approved Botanist notification migration.");
    const { type, key, count } = req.body || {};
    if (!["sync_failed", "sync_completed"].includes(type) || typeof key !== "string" || !key.trim() || key.length > 200 ||
        (type === "sync_completed" && (!Number.isInteger(count) || count < 1)))
      fail(400, "Invalid synchronization notification.");
    const metadata = type === "sync_completed" ? { count } : { draftKey: key };
    const row = (await pool.query(
      `INSERT INTO botanist_notification(id,recipient_subject,type,source_key,metadata)
       VALUES($1,$2,$3,$4,$5::jsonb)
       ON CONFLICT(recipient_subject,source_key) DO UPDATE SET source_key=EXCLUDED.source_key
       RETURNING id,type,source_key,observation_id,plant_id,created_at,(read_at IS NOT NULL) AS read,metadata`,
      [randomUUID(), subject(req.user), type, `sync:${type}:${key}`, JSON.stringify(metadata)],
    )).rows[0];
    res.status(201).json({ notification: {
      id: row.id,
      type: row.type,
      sourceKey: row.source_key,
      createdAt: row.created_at,
      read: Boolean(row.read),
      ...(row.metadata?.count != null ? { count: Number(row.metadata.count) } : {}),
      ...(typeof row.metadata?.draftKey === "string" ? { draftKey: row.metadata.draftKey } : {}),
    } });
  });
  app.post(
    "/api/plants/:id/observations",
    allow("observations.create"),
    async (req, res) => {
      const b = req.body;
      fieldContent(b.content);
      text(b.client_key, 100);
      const result = await transaction(pool, async (c) => {
        const plant = (
          await c.query(
            "SELECT species_id FROM plant_record WHERE plant_id=$1 AND rbac_status='Approved'",
            [id(req.params.id)],
          )
        ).rows[0];
        if (!plant) fail(404, "Approved plant not found.");
        await speciesRow(c, plant.species_id, req.user);
        const withOrigin = await originColumnAvailable(c);
        const row = (
          await c.query(
            `INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key${withOrigin ? ",origin_type" : ""}) VALUES($1,$2,$3,'Draft',$4,$5${withOrigin ? ",'subsequent_observation'" : ""}) ON CONFLICT(owner_subject,client_key) DO NOTHING RETURNING *`,
            [
              randomUUID(),
              req.params.id,
              subject(req.user),
              b.content,
              b.client_key,
            ],
          )
        ).rows[0];
        if (row) {
          await audit(c, req.user, "observation_submitted", row.id);
          return row;
        }
        const old = (
          await c.query(
            "SELECT * FROM plant_observation WHERE owner_subject=$1 AND client_key=$2",
            [subject(req.user), b.client_key],
          )
        ).rows[0];
        if (String(old.plant_id) !== req.params.id)
          fail(409, "Client key already belongs to another plant.");
        return old;
      });
      res.status(201).json(projectGps(result, req.user));
    },
  );
  app.post(
    "/api/observations/:id/submit",
    allow("observations.create"),
    async (req, res) => {
      await observationVersions.withVersionTransaction(pool, async (c) => {
        const row = (
          await c.query(
            "SELECT * FROM plant_observation WHERE id=$1 FOR UPDATE",
            [req.params.id],
          )
        ).rows[0];
        if (!row || row.owner_subject !== subject(req.user))
          fail(404, "Owned observation not found.");
        if (row.status === "Rejected") finalRejection();
        const plant = (
          await c.query(
            "SELECT species_id FROM plant_record WHERE plant_id=$1",
            [row.plant_id],
          )
        ).rows[0];
        await speciesRow(c, plant.species_id, req.user);
        const versioned = await originalObservationVersionsReady(c);
        if (row.status === "Pending Review") {
          if (!versioned) return; // Keep legacy clients' verified canonical retry behavior before 030.
          const origin = await verifiedObservationOrigin(c, row);
          if (origin === "subsequent_observation") {
            const current = await observationVersions.latestVersion(c, row.id);
            const legacy = await legacyObservationEligibility(c, row);
            const photos = await submittedObservationPhotos(c, row);
            if (!current && legacy) return; // Migration-captured legacy retry; never fabricate a version.
            if (!current || current.status !== "Pending Review" || current.request_id !== null ||
                current.owner_subject !== row.owner_subject ||
                !(await c.query("SELECT $1::jsonb=$2::jsonb AS matches",
                  [JSON.stringify(current.content), JSON.stringify(row.content)])).rows[0].matches ||
                JSON.stringify(current.photo_refs) !== JSON.stringify(photos))
              fail(409, "The current Pending Review submission cannot be verified.");
            return;
          }
          if (origin === "initial_registration") {
            const history = (await c.query(`SELECT id FROM record_version_history
              WHERE record_type='plant' AND plant_id=$1 AND status='Pending Review'
                AND snapshot->>'observation_id'=$2 AND snapshot->>'observation_revision'=$3
              ORDER BY version_number DESC LIMIT 1`, [row.plant_id, row.id, String(row.revision)])).rows[0];
            if (!history) fail(409, "The pending initial-registration version cannot be verified.");
            return;
          }
          if (origin === "unknown" && await legacyObservationEligibility(c, row)) return;
          fail(409, "Observation origin is uncertain. Its pending submission cannot be verified.");
        }
        if (row.status !== "Draft")
          fail(409, "Observation cannot be submitted in its current state.");
        let source = null;
        let correctionReviewId = null;
        let origin = null;
        let legacy = null;
        if (versioned) {
          origin = await verifiedObservationOrigin(c, row);
          legacy = await legacyObservationEligibility(c, row);
          if (origin === "subsequent_observation") {
            source = await observationVersions.latestVersion(c, row.id);
            if (source) {
              if (source.status !== "Correction Required" || source.request_id !== null)
                fail(409, "Observation submission history is inconsistent. Reload before submitting.");
              const review = (await c.query(`SELECT id FROM observation_review
                WHERE observation_id=$1 AND submission_version_id=$2 AND decision='Correction Required'`,
              [row.id, source.id])).rows[0];
              if (!review) fail(409, "The correction review cannot be linked to this Observation version.");
              correctionReviewId = review.id;
            } else if (legacy) {
              if (!await hasLegacyCorrectionEvidence(c, row, true, legacy))
                fail(409, "The legacy correction request cannot be verified at this revision.");
            } else if ((await c.query(`SELECT 1 FROM observation_review WHERE observation_id=$1
              UNION ALL SELECT 1 FROM observation_version_history WHERE observation_id=$1 LIMIT 1`,
            [row.id])).rows.length) {
              fail(409, "Legacy Observation review history cannot be reconstructed safely.");
            }
          } else if (origin === "unknown" && legacy) {
            if (!await hasLegacyCorrectionEvidence(c, row, true, legacy))
              fail(409, "The legacy correction request cannot be verified at this revision.");
          } else if (origin !== "initial_registration") {
            fail(409, "Observation origin is uncertain. Its submission needs review before versioning.");
          }
        }
        await c.query(
          "UPDATE plant_observation SET status='Pending Review',updated_at=CURRENT_TIMESTAMP WHERE id=$1",
          [row.id],
        );
        if (versioned && origin === "subsequent_observation" && !(legacy && !source)) {
          if (source) await observationVersions.transitionVersion(c, {
            observationId: row.id, versionId: source.id, status: "Superseded",
          });
          const photoRefs = await submittedObservationPhotos(c, row);
          await observationVersions.insertVersion(c, {
            observationId: row.id, ownerSubject: row.owner_subject,
            submissionType: source ? "correction_resubmission" : "original",
            basedOnVersionId: source?.id ?? null, correctionReviewId,
            content: row.content, photoRefs,
          });
        }
        if (await botanistNotificationsAvailable(c)) await c.query(
          `INSERT INTO botanist_notification(id,recipient_subject,type,source_key,observation_id,plant_id)
           VALUES($1,$2,'observation_submitted',$3,$4,$5) ON CONFLICT(recipient_subject,source_key) DO NOTHING`,
          [randomUUID(), row.owner_subject, `submission:${row.id}:${row.revision}`, row.id, row.plant_id],
        );
        await audit(c, req.user, "observation_submitted", row.id);
        if (officerNotifications) await officerNotifications.enqueueFieldSubmission(c, row);
      });
      res.json({ submitted: true });
    },
  );
  app.patch(
    "/api/observations/:id",
    allow("observations.edit.own"),
    async (req, res) => {
      fieldContent(req.body.content);
      if (!Number.isInteger(req.body.revision))
        fail(400, "Revision is required.");
      const result = await observationVersions.withVersionTransaction(pool, async (c) => {
        const row = (
          await c.query(
            "SELECT * FROM plant_observation WHERE id=$1 FOR UPDATE",
            [req.params.id],
          )
        ).rows[0];
        if (!row) fail(404, "Observation not found.");
        if (row.status === "Rejected") finalRejection();
        const versioned = await originalObservationVersionsReady(c);
        const origin = versioned ? await verifiedObservationOrigin(c, row) : null;
        const legacy = versioned ? await legacyObservationEligibility(c, row) : null;
        if (versioned && origin === "unknown" && !legacy)
          fail(409, "Observation origin is uncertain. Editing needs review before versioning.");
        const pendingOriginal = versioned && origin === "subsequent_observation" && row.status === "Pending Review" && !legacy;
        const legacyPending = Boolean(legacy && row.status === "Pending Review");
        const legacyCorrection = Boolean(legacy && row.status === "Correction Required");
        if (pendingOriginal || legacyPending || legacyCorrection) {
          if (row.owner_subject !== subject(req.user)) fail(403, "Only the submitting Botanist can edit this Observation.");
          if (legacyCorrection && !await hasLegacyCorrectionEvidence(c, row, false, legacy))
            fail(409, "The legacy correction request cannot be verified at this revision.");
          if (pendingOriginal && !await canModifyPendingObservation(c, row))
            fail(409, "This pending Observation is not eligible for another edit.");
        } else {
          const denied = assertEdit(req.user, row);
          if (denied) fail(denied, "Ownership or review state prevents editing.");
        }
        if (row.revision !== req.body.revision)
          fail(409, "Reload the latest revision.");
        const plant = (
          await c.query(
            "SELECT species_id FROM plant_record WHERE plant_id=$1",
            [row.plant_id],
          )
        ).rows[0];
        await speciesRow(c, plant.species_id, req.user);
        let pendingSource = null;
        if (pendingOriginal) {
          pendingSource = await observationVersions.latestVersion(c, row.id);
          if (!pendingSource || pendingSource.status !== "Pending Review" ||
              pendingSource.request_id !== null ||
              !["original", "pending_edit"].includes(pendingSource.submission_type))
            fail(409, "Pending Observation version history is incomplete.");
          await observationVersions.transitionVersion(c, {
            observationId: row.id, versionId: pendingSource.id, status: "Superseded",
          });
        }
        if (versioned && origin === "subsequent_observation" && row.status === "Correction Required" && !legacyCorrection) {
          const correctionSource = await observationVersions.latestVersion(c, row.id);
          if (!correctionSource || correctionSource.status !== "Correction Required" || correctionSource.request_id !== null)
            fail(409, "Correction review history is incomplete.");
        }
        const keepPending = pendingOriginal || legacyPending;
        const updated = (
          await c.query(
            `UPDATE plant_observation SET content=$1,status=$3,revision=revision+1,
              updated_at=CURRENT_TIMESTAMP WHERE id=$2 RETURNING *`,
            [req.body.content, row.id, keepPending ? "Pending Review" : "Draft"],
          )
        ).rows[0];
        if (pendingSource) {
          const photoRefs = await submittedObservationPhotos(c, updated);
          await observationVersions.insertVersion(c, {
            observationId: row.id, ownerSubject: row.owner_subject,
            submissionType: "pending_edit", basedOnVersionId: pendingSource.id,
            content: updated.content, photoRefs,
          });
        }
        await audit(c, req.user, "observation_resubmitted", row.id);
        return updated;
      });
      res.json(projectGps(result, req.user));
    },
  );
  app.post(
    "/api/observations/:id/review",
    allow("observations.review"),
    async (req, res) => {
      const result = await transaction(pool, async (c) => {
        const row = (
          await c.query(
            "SELECT * FROM plant_observation WHERE id=$1 FOR UPDATE",
            [req.params.id],
          )
        ).rows[0];
        if (!row) fail(404, "Observation not found.");
        const denied = assertReview(
          req.user,
          row,
          req.body.decision,
          req.body.comment,
        );
        if (denied)
          fail(denied, "Review is not permitted or feedback is missing.");
        if (row.revision !== req.body.revision)
          fail(409, "Observation changed. Reload before reviewing.");
        const versioned = await originalObservationVersionsReady(c);
        const origin = versioned ? await verifiedObservationOrigin(c, row) : null;
        let submittedVersion = null;
        let legacyReview = false;
        if (versioned && origin === "subsequent_observation") {
          submittedVersion = (await c.query(`SELECT * FROM observation_submission_version
            WHERE observation_id=$1 ORDER BY version_number DESC LIMIT 1 FOR UPDATE`, [row.id])).rows[0];
          if (!submittedVersion && await legacyObservationEligibility(c, row)) legacyReview = true;
          if (!submittedVersion && !legacyReview)
            fail(409, "Observation submission version is missing and this record is not migration-eligible legacy data.");
          if (legacyReview && row.status !== "Pending Review")
            fail(409, "Only the current legacy Pending Review revision can be reviewed.");
          if (!legacyReview && (submittedVersion.status !== row.status ||
              submittedVersion.request_id !== null || submittedVersion.owner_subject !== row.owner_subject ||
              !(await c.query("SELECT $1::jsonb=$2::jsonb AS matches",
                [JSON.stringify(submittedVersion.content), JSON.stringify(row.content)])).rows[0].matches ||
              JSON.stringify(submittedVersion.photo_refs) !== JSON.stringify(await submittedObservationPhotos(c, row))))
            fail(409, "Observation submission version no longer matches the record under review.");
        } else if (versioned && origin === "unknown" && await legacyObservationEligibility(c, row)) {
          legacyReview = true;
          if (row.status !== "Pending Review")
            fail(409, "Only the current legacy Pending Review revision can be reviewed.");
        } else if (versioned && origin !== "initial_registration") {
          fail(409, "Observation origin is uncertain. Officer review needs verified history.");
        }
        await assertSpeciesResolved(c, row.plant_id, fail, row.id);
        const review = (await c.query(
          `INSERT INTO observation_review(id,observation_id,reviewer_subject,decision,comment${submittedVersion ? ",submission_version_id" : legacyReview ? ",legacy_revision" : ""})
           VALUES($1,$2,$3,$4,$5${submittedVersion || legacyReview ? ",$6" : ""}) RETURNING id,comment`,
          [
            randomUUID(),
            row.id,
            subject(req.user),
            req.body.decision,
            req.body.comment || "Verified.",
            ...(submittedVersion ? [submittedVersion.id] : legacyReview ? [req.body.revision] : []),
          ],
        )).rows[0];
        if (submittedVersion) {
          const transitioned = await c.query(`UPDATE observation_submission_version v
            SET status=$1,reviewed_by=r.reviewer_subject,reviewed_at=r.created_at,review_comment=r.comment
            FROM observation_review r
            WHERE v.id=$2 AND v.observation_id=$3 AND r.id=$4 AND r.observation_id=v.observation_id
              AND r.submission_version_id=v.id AND r.decision=$1
              AND r.reviewer_subject=$5 AND r.comment IS NOT DISTINCT FROM $6`,
          [req.body.decision, submittedVersion.id, row.id, review.id, subject(req.user), review.comment]);
          if (transitioned.rowCount !== 1)
            fail(409, "Persisted Officer review no longer matches this Observation version.");
        }
        await c.query(
          "UPDATE plant_observation SET status=$1,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=$2",
          [req.body.decision, row.id],
        );
        const notificationType = {
          Approved: "observation_approved",
          Rejected: "observation_rejected",
          "Correction Required": "correction_requested",
        }[req.body.decision];
        if (notificationType && await botanistNotificationsAvailable(c)) await c.query(
          `INSERT INTO botanist_notification(id,recipient_subject,type,source_key,observation_id,review_id,plant_id,created_at)
           SELECT $1,$2,$3,$4,$5,$6,$7,created_at FROM observation_review WHERE id=$6
           ON CONFLICT(recipient_subject,source_key) DO NOTHING`,
          [randomUUID(), row.owner_subject, notificationType, `review:${review.id}`, row.id, review.id, row.plant_id],
        );
        if (req.body.decision === "Approved") {
          const species = (await c.query("SELECT s.rbac_data FROM species s JOIN plant_record p ON p.species_id=s.species_id WHERE p.plant_id=$1 FOR UPDATE OF s", [row.plant_id])).rows[0];
          if (!species || (species.rbac_data?.approvalStatus || "Approved") !== "Approved")
            fail(409, "Approve the species request before approving its plant record.");
          await c.query(
            "UPDATE plant_asset SET approved=true WHERE observation_id=$1",
            [row.id],
          );
          await c.query(
            "UPDATE plant_record SET rbac_status='Approved' WHERE plant_id=$1",
            [row.plant_id],
          );
          // Keep inventory lifecycle state in sync with the plant approval.
          // The initial registration assigned the code while the record was
          // pending, so approval is the point at which it becomes scannable.
          const activatedQr = await c.query(
            `UPDATE plant_app.qr_code
             SET status='active', activated_at=COALESCE(activated_at,CURRENT_TIMESTAMP), retired_at=NULL
             WHERE plant_id=$1 AND qr_code=(SELECT qr_token FROM plant_record WHERE plant_id=$1)`,
            [row.plant_id],
          );
          if (activatedQr.rowCount !== 1)
            fail(409, "The plant QR inventory mapping is missing or inconsistent; reconcile it before approval.");
          const content = row.content;
          if (content.latitude !== undefined)
            await c.query(
              "INSERT INTO plant_location(plant_id,latitude,longitude,accuracy_m) VALUES($1,$2,$3,$4)",
              [
                row.plant_id,
                content.latitude,
                content.longitude,
                content.accuracy_m ?? null,
              ],
            );
        }
        const reviewedVersionId = await submittedHistoryForReview(c, {
          kind: "plant", targetId: row.plant_id, submissionId: row.id, status: row.status,
        });
        if (reviewedVersionId) {
          const transitioned = await c.query(`UPDATE record_version_history
            SET status=$1,reviewed_by=$2,reviewed_at=CURRENT_TIMESTAMP,review_comment=$3
            WHERE id=$4 AND status=$5`,
          [req.body.decision, subject(req.user), req.body.comment || "Verified.", reviewedVersionId, row.status]);
          if (transitioned.rowCount !== 1) fail(409, "The submitted history version changed before review.");
        }
        if (req.body.decision === "Approved") await captureApprovedReview(c, {
          kind: "plant", submissionId: row.id, reviewId: review.id, reviewer: subject(req.user), versionId: reviewedVersionId,
        });
        await audit(c, req.user, `observation_${req.body.decision}`, row.id);
        return { reviewed: true };
      });
      res.json(result);
    },
  );
  app.get("/api/qr/:token", allow("plants.public.read"), async (req, res) => {
    const row = (
      await pool.query(
        `SELECT q.qr_id,q.plant_id,q.status,p.species_id,p.rbac_status,p.scientific_name
         FROM plant_app.qr_code q LEFT JOIN ${qrPlantRecord} p ON p.plant_id=q.plant_id
         WHERE q.qr_code=$1`,
        [req.params.token],
      )
    ).rows[0];
    if (!row) fail(404, "QR code not found.");
    if (row.plant_id == null || row.status === "generated" || row.status === "retired")
      return res.json({ assigned: false, status: row.status,
        ...(row.status === "generated" && row.plant_id == null && req.user?.role === "Botanist" ? { qr_id: row.qr_id } : {}) });
    if (row.status !== "active") fail(404, "Plant information is not available.");
    if (row.rbac_status !== "Approved") fail(404, "Plant information is not available.");
    const species = await speciesRow(pool, row.species_id, req.user);
    res.json({
      assigned: true,
      plant: permitted(req.user, "plants.scientific.read") ? row : { plant_id: row.plant_id, species_id: row.species_id },
      species: readableSpecies(
        species,
        req.user,
        permitted(req.user, "plants.scientific.read"),
      ),
    });
  });

  const visitorOwner = (req) => {
    if (!req.user) fail(401, "Please sign in as a Visitor.");
    if (req.user.role !== "Visitor") fail(403, "Visitor access required.");
    return subject(req.user);
  };

  app.get("/api/visitor/favourites", allow("plants.public.read"), async (req, res) => {
    const owner = visitorOwner(req);
    const visible = visibilityFor(req.user);
    const [plantRows, speciesRows] = await Promise.all([
      pool.query(
        `SELECT p.plant_id,p.scientific_name AS plant_scientific_name,p.registered_at,
          p.species_id,f.created_at AS favourited_at,s.*,plant_preview.id AS plant_image_asset_id,
          preview.id AS image_asset_id
          FROM visitor_favourite f JOIN plant_record p ON p.plant_id=f.plant_id
          JOIN species s ON s.species_id=p.species_id
          LEFT JOIN rbac_species_visibility v ON v.species_id=s.species_id
          ${await speciesImageJoin(pool)}
          LEFT JOIN LATERAL (
            SELECT a.id
            FROM plant_asset a
            LEFT JOIN plant_observation image_observation
              ON image_observation.id=a.observation_id AND image_observation.plant_id=p.plant_id
            WHERE a.plant_id=p.plant_id AND a.content_type IN ('image/jpeg','image/png')
              AND ((a.observation_id IS NULL AND a.approved=TRUE)
                OR (image_observation.id IS NOT NULL AND image_observation.status='Approved'
                  AND image_observation.id=(SELECT current_observation.id FROM plant_observation current_observation
                    WHERE current_observation.plant_id=p.plant_id AND current_observation.status='Approved'
                    ORDER BY current_observation.updated_at DESC,current_observation.id DESC LIMIT 1)))
            ORDER BY a.created_at,a.id LIMIT 1
          ) plant_preview ON true
          WHERE f.visitor_subject=$1 AND f.plant_id IS NOT NULL AND p.rbac_status='Approved'
            AND COALESCE(s.rbac_data->>'approvalStatus','Approved')='Approved'
            AND COALESCE(v.visibility,'protected') = ANY($2::text[])
          ORDER BY f.created_at DESC,p.plant_id DESC`,
        [owner, visible],
      ),
      pool.query(
        `SELECT s.*,f.created_at AS favourited_at,preview.id AS image_asset_id,
          g.genus_name,fam.family_name,cs.status_name AS conservation_status,
          COALESCE(v.visibility,'protected') AS visibility
          FROM visitor_favourite f JOIN species s ON s.species_id=f.species_id
          LEFT JOIN genus g ON g.genus_id=s.genus_id
          LEFT JOIN family fam ON fam.family_id=g.family_id
          LEFT JOIN conservation_status cs ON cs.status_id=s.status_id
          LEFT JOIN rbac_species_visibility v ON v.species_id=s.species_id
          ${await speciesImageJoin(pool)}
          WHERE f.visitor_subject=$1 AND f.species_id IS NOT NULL
            AND COALESCE(s.rbac_data->>'approvalStatus','Approved')='Approved'
            AND COALESCE(v.visibility,'protected') = ANY($2::text[])
          ORDER BY f.created_at DESC,s.species_id DESC`,
        [owner, visible],
      ),
    ]);
    res.json({
      favourites: {
        plants: plantRows.rows.map((row) => ({
          plant_id: row.plant_id,
          scientific_name: row.plant_scientific_name,
            species_id: row.species_id,
          species_details: readableSpecies(row, req.user, false),
          plant_image_asset_id: row.plant_image_asset_id,
          favourited_at: row.favourited_at,
        })),
        species: speciesRows.rows.map((row) => ({
          ...readableSpecies(row, req.user, false),
          favourited_at: row.favourited_at,
        })),
      },
    });
  });

  app.post("/api/visitor/favourites", allow("plants.public.read"), async (req, res) => {
    const owner = visitorOwner(req);
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some((key) => !["type", "id"].includes(key)) ||
        !["plant", "species"].includes(body.type))
      fail(400, "Invalid favourite request.");
    const targetId = id(body.id);
    const column = body.type === "plant" ? "plant_id" : "species_id";
    const targetQuery = await pool.query(
      body.type === "plant"
        ? `WITH eligible AS MATERIALIZED (
            SELECT p.plant_id AS target_id FROM plant_record p JOIN species s ON s.species_id=p.species_id
            LEFT JOIN rbac_species_visibility v ON v.species_id=s.species_id
            WHERE p.plant_id=$1 AND p.rbac_status='Approved'
              AND COALESCE(s.rbac_data->>'approvalStatus','Approved')='Approved'
              AND COALESCE(v.visibility,'protected') = ANY($2::text[])
          ), inserted AS (
            INSERT INTO visitor_favourite(visitor_subject,plant_id)
            SELECT $3,target_id FROM eligible ON CONFLICT DO NOTHING RETURNING 1
          ) SELECT EXISTS(SELECT 1 FROM eligible) AS available, EXISTS(SELECT 1 FROM inserted) AS inserted`
        : `WITH eligible AS MATERIALIZED (
            SELECT s.species_id AS target_id FROM species s LEFT JOIN rbac_species_visibility v ON v.species_id=s.species_id
            WHERE s.species_id=$1 AND COALESCE(s.rbac_data->>'approvalStatus','Approved')='Approved'
              AND COALESCE(v.visibility,'protected') = ANY($2::text[])
          ), inserted AS (
            INSERT INTO visitor_favourite(visitor_subject,species_id)
            SELECT $3,target_id FROM eligible ON CONFLICT DO NOTHING RETURNING 1
          ) SELECT EXISTS(SELECT 1 FROM eligible) AS available, EXISTS(SELECT 1 FROM inserted) AS inserted`,
      [targetId, visibilityFor(req.user), owner],
    );
    if (!targetQuery.rows[0]?.available) fail(404, "This record is not available.");
    res.status(200).json({ type: body.type, id: targetId, favourited: true });
  });

  app.delete("/api/visitor/favourites/:type/:id", allow("plants.public.read"), async (req, res) => {
    const owner = visitorOwner(req);
    if (!["plant", "species"].includes(req.params.type)) fail(400, "Invalid favourite type.");
    const targetId = id(req.params.id);
    const column = req.params.type === "plant" ? "plant_id" : "species_id";
    await pool.query(
      `DELETE FROM visitor_favourite WHERE visitor_subject=$1 AND ${column}=$2`,
      [owner, targetId],
    );
    res.json({ type: req.params.type, id: targetId, favourited: false });
  });

  app.post("/api/visitor/scan-history", allow("plants.public.read"), async (req, res) => {
    const owner = visitorOwner(req);
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some((key) => key !== "qr_code"))
      fail(400, "Invalid QR scan request.");
    const qrCode = text(body.qr_code, 200);
    const visible = visibilityFor(req.user);
    const result = await transaction(pool, async (client) => {
      const row = (await client.query(
        `SELECT q.qr_id,q.plant_id,p.scientific_name AS plant_scientific_name,
          p.registered_at,p.species_id,s.*,plant_preview.id AS image_asset_id
          FROM plant_app.qr_code q JOIN ${qrPlantRecord} p ON p.plant_id=q.plant_id
          JOIN species s ON s.species_id=p.species_id
          LEFT JOIN rbac_species_visibility v ON v.species_id=s.species_id
          LEFT JOIN LATERAL (
            SELECT a.id
            FROM plant_asset a
            LEFT JOIN plant_observation image_observation
              ON image_observation.id=a.observation_id AND image_observation.plant_id=p.plant_id
            WHERE a.plant_id=p.plant_id AND a.content_type IN ('image/jpeg','image/png')
              AND ((a.observation_id IS NULL AND a.approved=TRUE)
                OR (image_observation.id IS NOT NULL AND image_observation.status='Approved'
                  AND image_observation.id=(SELECT current_observation.id FROM plant_observation current_observation
                    WHERE current_observation.plant_id=p.plant_id AND current_observation.status='Approved'
                    ORDER BY current_observation.updated_at DESC,current_observation.id DESC LIMIT 1)))
            ORDER BY a.created_at,a.id LIMIT 1
          ) plant_preview ON true
          WHERE q.qr_code=$1 AND p.rbac_status='Approved'
            AND COALESCE(s.rbac_data->>'approvalStatus','Approved')='Approved'
            AND COALESCE(v.visibility,'protected') = ANY($2::text[])
          LIMIT 1`,
        [qrCode, visible],
      )).rows[0];
      if (!row) fail(404, "QR code or plant is not available.");
      const qrIdentifier = `QR-${String(row.qr_id).padStart(4, "0")}`;
      const scan = (await client.query(
        `INSERT INTO visitor_scan_history(visitor_subject,plant_id,plant_reference,qr_id,qr_identifier)
          VALUES($1,$2,$3,$4,$5)
          RETURNING scan_id,qr_identifier,scanned_at`,
        [
          owner,
          row.plant_id,
          row.plant_id,
          row.qr_id,
          qrIdentifier,
        ],
      )).rows[0];
      return { row, scan };
    });
    res.status(201).json({
      scan: result.scan,
      plant: {
        plant_id: result.row.plant_id,
        scientific_name: result.row.plant_scientific_name,
        species_id: result.row.species_id,
        species_details: readableSpecies(result.row, req.user, false),
        image_asset_id: result.row.image_asset_id,
      },
    });
  });

  app.get("/api/visitor/scan-history", allow("plants.public.read"), async (req, res) => {
    const owner = visitorOwner(req);
    const visible = visibilityFor(req.user);
    const limit = req.query.limit === undefined ? 200 : Number(req.query.limit);
    const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isSafeInteger(offset) || offset < 0)
      fail(400, "Invalid scan history page.");
    const rows = (await pool.query(
        `SELECT h.scan_id,h.qr_id,h.qr_identifier,h.scanned_at,p.plant_id,
        p.scientific_name AS plant_scientific_name,p.registered_at,p.species_id,
        s.*,plant_preview.id AS image_asset_id
        FROM visitor_scan_history h
        LEFT JOIN ${qrPlantRecord} p ON p.plant_id=h.plant_reference
        LEFT JOIN species s ON s.species_id=p.species_id
        LEFT JOIN rbac_species_visibility v ON v.species_id=s.species_id
        LEFT JOIN LATERAL (
          SELECT a.id
          FROM plant_asset a
          LEFT JOIN plant_observation image_observation
            ON image_observation.id=a.observation_id AND image_observation.plant_id=p.plant_id
          WHERE a.plant_id=p.plant_id AND a.content_type IN ('image/jpeg','image/png')
            AND ((a.observation_id IS NULL AND a.approved=TRUE)
              OR (image_observation.id IS NOT NULL AND image_observation.status='Approved'
                AND image_observation.id=(SELECT current_observation.id FROM plant_observation current_observation
                  WHERE current_observation.plant_id=p.plant_id AND current_observation.status='Approved'
                  ORDER BY current_observation.updated_at DESC,current_observation.id DESC LIMIT 1)))
          ORDER BY a.created_at,a.id LIMIT 1
        ) plant_preview ON true
        WHERE h.visitor_subject=$1 AND (p.plant_id IS NULL OR (
          p.rbac_status='Approved'
          AND COALESCE(s.rbac_data->>'approvalStatus','Approved')='Approved'
          AND COALESCE(v.visibility,'protected') = ANY($2::text[])))
        ORDER BY h.scanned_at DESC,h.scan_id DESC LIMIT $3 OFFSET $4`,
      [owner, visible, limit + 1, offset],
    )).rows;
    const hasMore = rows.length > limit;
    res.json({ scans: rows.slice(0, limit).map((row) => ({
      scan_id: row.scan_id,
      qr_id: row.qr_id,
      qr_identifier: row.qr_identifier,
      scanned_at: row.scanned_at,
      plant: row.plant_id == null ? null : {
        plant_id: row.plant_id,
        scientific_name: row.plant_scientific_name,
        species_id: row.species_id,
        species_details: readableSpecies(row, req.user, false),
        image_asset_id: row.image_asset_id,
      },
    })), page: { limit, offset, has_more: hasMore } });
  });

  app.get("/api/plants/:id/qr", allow("plants.create"), async (req, res) => {
    const row = (
      await pool.query(
        "SELECT qr_token,rbac_status,species_id FROM plant_record WHERE plant_id=$1 AND registered_subject=$2",
        [id(req.params.id), subject(req.user)],
      )
    ).rows[0];
    if (!row) fail(404, "Owned plant not found.");
    await speciesRow(pool, row.species_id, req.user);
    res.json({ qr_token: row.qr_token, rbac_status: row.rbac_status });
  });
  app.get('/api/taxonomy',allow('species.manage'),async(_req,res)=>res.json({genera:(await pool.query('SELECT g.genus_id,g.genus_name,f.family_name FROM genus g LEFT JOIN family f ON f.family_id=g.family_id ORDER BY g.genus_name')).rows}));
  app.post("/api/species", allow("species.manage"), async (req, res) => {
    const b = req.body;
    if (!b || typeof b !== "object" || Array.isArray(b))
      fail(400, "Species details must be an object.");
    b.scientific_name = text(b.scientific_name, 200);
    b.common_name = text(b.common_name, 200);
    b.description = text(b.description);
    for (const key of ["habitat", "culturalSignificance"])
      if (
        b[key] !== undefined &&
        (typeof b[key] !== "string" || b[key].length > 4000)
      )
        fail(400, "Invalid species text.");
    for (const key of ["habitat", "culturalSignificance"])
      if (b[key] !== undefined) b[key] = b[key].trim();
    if (!["public", "internal", "protected"].includes(b.visibility))
      fail(400, "Select visibility.");
    const result = await transaction(pool, async (c) => {
      await assertNewSpecies(c, b.scientific_name);
      const row = (
        await c.query(
          "INSERT INTO species(scientific_name,common_name,genus_id,status_id,description,rbac_data) VALUES($1,$2,$3,$4,$5,$6) RETURNING species_id",
          [
            b.scientific_name,
            b.common_name,
            b.genus_id || null,
            await statusReference(c, b),
            b.description,
            {
              habitat: b.habitat || "",
              culturalSignificance: b.culturalSignificance || "",
            },
          ],
        )
      ).rows[0];
      await c.query("INSERT INTO rbac_species_visibility VALUES($1,$2)", [
        row.species_id,
        b.visibility,
      ]);
      await audit(c, req.user, "species_created", row.species_id);
      return row;
    });
    res.status(201).json(result);
  });
  app.patch("/api/species/:id", allow("species.manage"), async (req, res) => {
    const b = req.body;
    if (!b || typeof b !== "object" || Array.isArray(b))
      fail(400, "Species details must be an object.");
    b.scientific_name = text(b.scientific_name, 200);
    b.common_name = text(b.common_name, 200);
    b.description = text(b.description);
    for (const key of ["habitat", "culturalSignificance"])
      if (
        b[key] !== undefined &&
        (typeof b[key] !== "string" || b[key].length > 4000)
      )
        fail(400, "Invalid species text.");
    for (const key of ["habitat", "culturalSignificance"])
      if (b[key] !== undefined) b[key] = b[key].trim();
    if (!["public", "internal", "protected"].includes(b.visibility))
      fail(400, "Select visibility.");
    await transaction(pool, async (c) => {
      await speciesRow(c, id(req.params.id), req.user);
      const changed = await c.query(
        "UPDATE species SET scientific_name=$1,common_name=$2,description=$3,status_id=$4,rbac_data=rbac_data || $5::jsonb,genus_id=CASE WHEN $8 THEN $7 ELSE genus_id END WHERE species_id=$6 RETURNING species_id",
        [
          b.scientific_name,
          b.common_name,
          b.description,
          await statusReference(c, b),
          // Merge only explicitly supplied, validated metadata. Omission preserves
          // stored values; explicit empty strings still clear these text fields.
          Object.fromEntries(["habitat", "culturalSignificance"]
            .filter(key => Object.hasOwn(b, key) && b[key] !== undefined)
            .map(key => [key, b[key]])),
          id(req.params.id),
          b.genus_id || null,
          Object.hasOwn(b, "genus_id"),
        ],
      );
      if (!changed.rows.length) fail(404, "Species not found.");
      await c.query(
        "INSERT INTO rbac_species_visibility VALUES($1,$2) ON CONFLICT(species_id) DO UPDATE SET visibility=EXCLUDED.visibility",
        [req.params.id, b.visibility],
      );
      await audit(c, req.user, "species_updated", req.params.id);
    });
    res.json({ updated: true });
  });
  app.delete("/api/species/:id", allow("species.manage"), async (req, res) => {
    await transaction(pool, async (c) => {
      const result = await c.query(
        "DELETE FROM species WHERE species_id=$1 RETURNING species_id",
        [id(req.params.id)],
      );
      if (!result.rows.length) fail(404, "Species not found.");
      await audit(c, req.user, "species_deleted", req.params.id);
    });
    res.json({ deleted: true });
  });
  app.get("/api/reports", allow("reports.read"), async (req, res) => {
    const scope = require("./report-period.cjs").reportPeriod(req.query);
    const rows = (
      await pool.query(
        "SELECT s.species_id::text AS species_id,s.scientific_name,s.common_name,COUNT(p.plant_id) AS approved_plants FROM species s LEFT JOIN plant_record p ON p.species_id=s.species_id AND p.rbac_status='Approved' AND ($1::timestamptz IS NULL OR p.registered_at >= $1::timestamptz) AND ($2::timestamptz IS NULL OR p.registered_at < $2::timestamptz) GROUP BY s.species_id,s.scientific_name,s.common_name ORDER BY s.scientific_name",
        [scope.startInclusive, scope.endExclusive],
      )
    ).rows;
    res.json({ generatedAt: new Date().toISOString(), scope, rows });
  });
  app.get("/api/audit", allow("audit.read"), async (req, res) =>
    res.json({
      events: (
        await pool.query(
          "SELECT * FROM business_audit ORDER BY created_at DESC LIMIT 500",
        )
      ).rows,
    }),
  );
}
module.exports = {
  speciesImageReader: Object.freeze({ version: 1, membershipSql }),
  mountDomain,
  transaction,
  audit,
  subject,
  fieldContent,
  fail,
  text,
  id,
  hash,
  assertNewSpecies,
  speciesRow,
};
