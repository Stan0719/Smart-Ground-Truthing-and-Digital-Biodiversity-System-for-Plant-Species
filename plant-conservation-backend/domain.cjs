"use strict";
const { randomUUID, randomBytes, createHash } = require("node:crypto");
const {
  permitted,
  projectGps,
  projectApprovedPlantGps,
  visibilityFor,
  projectSpecies,
  assertEdit,
  assertReview,
} = require("../shared/rbac.cjs");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const { requestsAvailable, observationRequestSql, assertSpeciesResolved, mountSpeciesRequests } = require("./species-requests.cjs");
const fail = (status, message) => {
  throw Object.assign(Error(message), { status });
};
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
// Species catalogue images must be explicitly attached to the species itself.
// Plant observation photos can depict other subjects and are not species portraits.
const speciesImageJoin = `LEFT JOIN LATERAL (
  SELECT a.id FROM plant_asset a
  WHERE a.species_id=s.species_id AND a.approved=TRUE AND a.content_type='image/jpeg'
  ORDER BY a.created_at ASC,a.id ASC LIMIT 1
) preview ON true`;
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
async function speciesRow(c, speciesId, user) {
  const row = (
    await c.query(
      `SELECT s.*,preview.id AS image_asset_id,g.genus_name,f.family_name,cs.status_name AS conservation_status,COALESCE(v.visibility,'protected') AS visibility FROM species s LEFT JOIN genus g ON g.genus_id=s.genus_id LEFT JOIN family f ON f.family_id=g.family_id LEFT JOIN conservation_status cs ON cs.status_id=s.status_id LEFT JOIN rbac_species_visibility v ON v.species_id=s.species_id ${speciesImageJoin} WHERE s.species_id=$1 AND COALESCE(s.rbac_data->>'approvalStatus','Approved')='Approved' AND COALESCE(v.visibility,'protected') = ANY($2::text[])`,
      [speciesId, visibilityFor(user)],
    )
  ).rows[0];
  if (!row) fail(404, "Species unavailable.");
  return row;
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
async function assertNewSpecies(c, scientificName) {
  await c.query("SELECT pg_advisory_xact_lock(hashtext(lower(btrim($1))))", [scientificName]);
  if ((await c.query("SELECT species_id FROM species WHERE lower(btrim(scientific_name))=lower(btrim($1)) LIMIT 1", [scientificName])).rows.length)
    fail(409, "This scientific name already exists. Select the existing species.");
}
function mountDomain(app, { pool, auth, allow }) {
  app.get("/api/qr-codes", allow("plants.create"), async (_req, res) => {
    const qrCodes = (
      await pool.query(
        `SELECT q.qr_id,q.plant_id,q.qr_code,
          CASE WHEN q.plant_id IS NULL THEN 'generated' ELSE 'assigned' END AS status,
          CASE WHEN COALESCE(v.visibility,'protected') = ANY($1::text[]) THEN p.scientific_name END AS plant_name,
          q.generated_at,q.assigned_at,q.activated_at,q.retired_at
          FROM public.qr_code q LEFT JOIN plant_record p ON p.plant_id=q.plant_id
          LEFT JOIN rbac_species_visibility v ON v.species_id=p.species_id
          ORDER BY q.qr_id DESC LIMIT 500`,
        [visibilityFor(_req.user)],
      )
    ).rows;
    res.json({ qr_codes: qrCodes });
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
            "INSERT INTO public.qr_code(qr_code,status) VALUES($1,'generated') RETURNING qr_id,plant_id,qr_code,status,generated_at,assigned_at,activated_at,retired_at",
            [code],
          )
        ).rows[0];
        created.push(row);
      }
      await audit(c, req.user, "qr_codes_generated", created.map((row) => row.qr_id).join(","));
      return created;
    });
    res.status(201).json({ qr_codes: qrCodes });
  });
  mountSpeciesRequests(app, { pool, allow, transaction, audit, subject, fail, text, id, assertNewSpecies });
  app.get("/api/species", allow("plants.public.read"), async (req, res) => {
    const scientific = req.query.scope === "scientific";
    if (scientific && !permitted(req.user, "plants.scientific.read"))
      fail(req.user ? 403 : 401, "Scientific access required.");
    if (req.query.q !== undefined && typeof req.query.q !== "string")
      fail(400, "Search must be text.");
    const q = (req.query.q ?? "").trim();
    if (q.length > 200) fail(400, "Search is too long.");
    const rows = (
      await pool.query(
        `SELECT s.*,preview.id AS image_asset_id,g.genus_name,f.family_name,cs.status_name AS conservation_status,COALESCE(v.visibility,'protected') AS visibility FROM species s LEFT JOIN genus g ON g.genus_id=s.genus_id LEFT JOIN family f ON f.family_id=g.family_id LEFT JOIN conservation_status cs ON cs.status_id=s.status_id LEFT JOIN rbac_species_visibility v ON v.species_id=s.species_id ${speciesImageJoin} WHERE COALESCE(s.rbac_data->>'approvalStatus','Approved')='Approved' AND COALESCE(v.visibility,'protected') = ANY($1::text[]) AND strpos(lower(coalesce(s.scientific_name,'')||' '||coalesce(s.common_name,'')||' '||coalesce(g.genus_name,'')||' '||coalesce(f.family_name,'')),lower($2))>0 ORDER BY s.scientific_name LIMIT 200`,
        [visibilityFor(req.user), q],
      )
    ).rows;
    res.json({ species: rows.map((r) => projectSpecies(r, scientific)) });
  });
  app.get("/api/species/:id", allow("plants.public.read"), async (req, res) => {
    const scientific = permitted(req.user, "plants.scientific.read"),
      row = await speciesRow(pool, id(req.params.id), req.user);
    res.json({ species: projectSpecies(row, scientific) });
  });
  const readPlants = async (req, res) => {
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
    const staff = permitted(req.user, "plants.scientific.read");
    const rows = (
      await pool.query(
        `SELECT p.plant_id,p.species_id,p.scientific_name,p.rbac_status,p.registered_subject,p.registered_at,
          p.qr_token,qr.qr_id,qr.status AS qr_status,
          COALESCE(approved_location_row.latitude,approved_location.latitude) AS latitude,
          COALESCE(approved_location_row.longitude,approved_location.longitude) AS longitude,
          COALESCE(approved_location_row.accuracy_m,approved_location.accuracy_m) AS accuracy_m,
          approved_location.altitude_m,approved_location.zone,
          o.content AS latest_approved,o.updated_at AS observed_at,
          submitted.content AS latest_submission,submitted.id AS latest_observation_id,submitted.status AS observation_status,
          CASE WHEN NOT $5 OR COALESCE(v.visibility,'protected') = ANY($1::text[]) THEN s.common_name END AS common_name,
          CASE WHEN NOT $5 OR COALESCE(v.visibility,'protected') = ANY($1::text[]) THEN jsonb_build_object('species_id',s.species_id,'scientific_name',s.scientific_name,'common_name',s.common_name,
            'description',s.description,'habitat',s.rbac_data->>'habitat','genus_name',g.genus_name,
            'family_name',f.family_name,'conservation_status',cs.status_name) END AS species_details
          FROM plant_record p JOIN species s ON s.species_id=p.species_id
          LEFT JOIN public.qr_code qr ON qr.plant_id=p.plant_id AND qr.qr_code=p.qr_token
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
          LEFT JOIN plant_observation o ON o.id=(SELECT id FROM plant_observation WHERE plant_id=p.plant_id AND status='Approved' AND (NOT $5 OR owner_subject=$2) ORDER BY updated_at DESC,id DESC LIMIT 1)
          LEFT JOIN LATERAL (SELECT id,content,status FROM plant_observation WHERE plant_id=p.plant_id AND (owner_subject=$2 OR $3) ORDER BY created_at DESC,id DESC LIMIT 1) submitted ON true
          LEFT JOIN rbac_species_visibility v ON v.species_id=p.species_id
          WHERE (CASE WHEN $5 THEN p.registered_subject=$2 ELSE (COALESCE(v.visibility,'protected') = ANY($1::text[]) OR
            (p.registered_subject=$2 AND p.rbac_status<>'Approved' AND s.rbac_data->>'submittedBy'=$2
             AND s.rbac_data->>'approvalStatus' IN ('Pending Review','Rejected','Correction Required'))) END)
          AND (p.rbac_status='Approved' OR p.registered_subject=$2 OR $3)
          AND ($4::integer IS NULL OR p.plant_id=$4) ORDER BY p.plant_id DESC LIMIT 500`,
        [
          visibilityFor(req.user),
          req.user ? subject(req.user) : "",
          req.user?.role === "Conservation Officer",
          plantId,
          mine,
        ],
      )
    ).rows;
    const plants = rows.map((r) =>
      staff
        ? r
        : {
            plant_id: r.plant_id,
            species_id: r.species_id,
            status: r.rbac_status,
            registered_at: r.registered_at,
          },
    );
    const projectedPlants = req.user?.role === "Botanist"
      ? projectApprovedPlantGps(plants, req.user)
      : projectGps(plants, req.user);
    if (plantId !== null) {
      if (!plants.length) fail(404, "Plant unavailable.");
      return res.json({ plant: projectedPlants[0] });
    }
    res.json({ plants: projectedPlants });
  };
  app.get("/api/plants", allow("plants.public.read"), readPlants);
  app.get("/api/plants/:id", allow("plants.public.read"), readPlants);
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
          "SELECT qr_id,qr_code FROM public.qr_code WHERE qr_id=$1 AND plant_id IS NULL AND status='generated' FOR UPDATE",
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
        "UPDATE public.qr_code SET plant_id=$1,status='assigned',assigned_at=CURRENT_TIMESTAMP WHERE qr_id=$2 AND plant_id IS NULL",
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
  const readObservations = async (req, res) => {
    const mine = req.query.scope === "mine";
    if (mine && !permitted(req.user, "plants.create"))
      fail(req.user ? 403 : 401, "Botanist access required.");
    const observationId = req.params.id ?? null;
    // Imported IDs may be numeric; new records use UUIDs.
    if (
      observationId !== null &&
      !/^(?:[1-9][0-9]{0,18}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(
        observationId,
      )
    )
      fail(400, "Invalid observation identifier.");
    const officer = req.user.role === "Conservation Officer";
    const requestSql = observationRequestSql(await requestsAvailable(pool));
    const rows = (
      await pool.query(

        `SELECT o.*,
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
          CASE
            WHEN NOT $5
              OR COALESCE(v.visibility, 'protected') = ANY($3::text[])
            THEN s.scientific_name
          END AS scientific_name,
          CASE
            WHEN NOT $5
              OR COALESCE(v.visibility, 'protected') = ANY($3::text[])
            THEN s.common_name
          END AS common_name,
          r.comment AS review_comment,
          r.decision AS review_decision,
          r.created_at AS reviewed_at,
          ${requestSql.select}
        FROM plant_observation o
        JOIN plant_record p ON p.plant_id = o.plant_id
        JOIN species s ON s.species_id = p.species_id
        ${requestSql.join}
        LEFT JOIN LATERAL (
          SELECT comment, decision, created_at
          FROM observation_review
          WHERE observation_id = o.id
          ORDER BY created_at DESC
          LIMIT 1
        ) r ON true
        LEFT JOIN rbac_species_visibility v
          ON v.species_id = p.species_id
        WHERE ($1 OR o.owner_subject = $2)
          AND (
            CASE
              WHEN $5 THEN
                o.owner_subject = $2
                AND p.registered_subject = $2
              ELSE (
                COALESCE(v.visibility, 'protected') = ANY($3::text[])
                OR (
                  o.owner_subject = $2
                  AND p.registered_subject = $2
                  AND p.rbac_status <> 'Approved'
                  AND s.rbac_data->>'submittedBy' = $2
                  AND s.rbac_data->>'approvalStatus'
                    IN ('Pending Review', 'Rejected', 'Correction Required')
                )
              )
            END
          )
          AND ($4::text IS NULL OR o.id = $4)
        ORDER BY o.created_at DESC
        LIMIT 500`,
        [
          officer,
          subject(req.user),
          visibilityFor(req.user),
          observationId,
          mine,
        ],

      )
    ).rows;
    if (observationId !== null) {
      if (!rows.length) fail(404, "Observation unavailable.");
      return res.json({ observation: projectGps(rows[0], req.user) });
    }
    res.json({ observations: projectGps(rows, req.user) });
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
    const rows = (await pool.query(
      `SELECT n.id,n.type,n.source_key,n.observation_id,n.plant_id,n.created_at,
        (n.read_at IS NOT NULL) AS read,n.metadata,r.comment
       FROM botanist_notification n
       LEFT JOIN observation_review r ON r.id=n.review_id
       WHERE n.recipient_subject=$1
       ORDER BY n.created_at DESC,n.id DESC`,
      [subject(req.user)],
    )).rows;
    res.json({ notifications: rows.map((row) => ({
      id: row.id,
      type: row.type,
      sourceKey: row.source_key,
      ...(row.observation_id ? { observationId: String(row.observation_id) } : {}),
      ...(row.plant_id != null ? { plantId: String(row.plant_id) } : {}),
      createdAt: row.created_at,
      read: Boolean(row.read),
      ...(typeof row.comment === "string" ? { comment: row.comment } : {}),
      ...(row.metadata?.count != null ? { count: Number(row.metadata.count) } : {}),
      ...(typeof row.metadata?.draftKey === "string" ? { draftKey: row.metadata.draftKey } : {}),
    })) });
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
    res.json({ updated: result.rowCount });
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
        const row = (
          await c.query(
            "INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key) VALUES($1,$2,$3,'Draft',$4,$5) ON CONFLICT(owner_subject,client_key) DO NOTHING RETURNING *",
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
      await transaction(pool, async (c) => {
        const row = (
          await c.query(
            "SELECT * FROM plant_observation WHERE id=$1 FOR UPDATE",
            [req.params.id],
          )
        ).rows[0];
        if (!row || row.owner_subject !== subject(req.user))
          fail(404, "Owned observation not found.");
        const plant = (
          await c.query(
            "SELECT species_id FROM plant_record WHERE plant_id=$1",
            [row.plant_id],
          )
        ).rows[0];
        await speciesRow(c, plant.species_id, req.user);
        if (row.status !== "Draft") return;
        if (!["Draft", "Correction Required", "Rejected"].includes(row.status))
          fail(409, "Observation cannot be submitted in its current state.");
        await c.query(
          "UPDATE plant_observation SET status='Pending Review',updated_at=CURRENT_TIMESTAMP WHERE id=$1",
          [row.id],
        );
        if (await botanistNotificationsAvailable(c)) await c.query(
          `INSERT INTO botanist_notification(id,recipient_subject,type,source_key,observation_id,plant_id)
           VALUES($1,$2,'observation_submitted',$3,$4,$5) ON CONFLICT(recipient_subject,source_key) DO NOTHING`,
          [randomUUID(), row.owner_subject, `submission:${row.id}:${row.revision}`, row.id, row.plant_id],
        );
        await audit(c, req.user, "observation_submitted", row.id);
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
      const result = await transaction(pool, async (c) => {
        const row = (
          await c.query(
            "SELECT * FROM plant_observation WHERE id=$1 FOR UPDATE",
            [req.params.id],
          )
        ).rows[0];
        if (!row) fail(404, "Observation not found.");
        const denied = assertEdit(req.user, row);
        if (denied) fail(denied, "Ownership or review state prevents editing.");
        if (row.revision !== req.body.revision)
          fail(409, "Reload the latest revision.");
        const plant = (
          await c.query(
            "SELECT species_id FROM plant_record WHERE plant_id=$1",
            [row.plant_id],
          )
        ).rows[0];
        await speciesRow(c, plant.species_id, req.user);
        const updated = (
          await c.query(
            "UPDATE plant_observation SET content=$1,status='Draft',revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=$2 RETURNING *",
            [req.body.content, row.id],
          )
        ).rows[0];
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
        await assertSpeciesResolved(c, row.plant_id, fail);
        const review = (await c.query(
          "INSERT INTO observation_review(id,observation_id,reviewer_subject,decision,comment) VALUES($1,$2,$3,$4,$5) RETURNING id",
          [
            randomUUID(),
            row.id,
            subject(req.user),
            req.body.decision,
            req.body.comment || "Verified.",
          ],
        )).rows[0];
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
        if ((await c.query("SELECT to_regclass(current_schema() || '.record_version_history') IS NOT NULL AS available")).rows[0].available)
          await c.query(`UPDATE record_version_history SET status=$1,reviewed_by=$2,reviewed_at=CURRENT_TIMESTAMP,review_comment=$3
            WHERE id=(SELECT id FROM record_version_history WHERE plant_id=$4 AND status='Pending Review'
              AND snapshot->>'observation_id'=$5 ORDER BY version_number DESC LIMIT 1)`,
            [req.body.decision, subject(req.user), req.body.comment || "Verified.", row.plant_id, row.id]);
        await audit(c, req.user, `observation_${req.body.decision}`, row.id);
        return { reviewed: true };
      });
      res.json(result);
    },
  );
  app.get("/api/qr/:token", allow("plants.public.read"), async (req, res) => {
    const row = (
      await pool.query(
        `SELECT q.qr_id,q.plant_id,p.species_id,p.rbac_status,p.scientific_name
         FROM public.qr_code q LEFT JOIN plant_record p ON p.plant_id=q.plant_id
         WHERE q.qr_code=$1`,
        [req.params.token],
      )
    ).rows[0];
    if (!row) fail(404, "QR code not found.");
    if (row.plant_id == null) return res.json({ assigned: false });
    if (row.rbac_status !== "Approved") fail(404, "Plant information is not available.");
    const species = await speciesRow(pool, row.species_id, req.user);
    res.json({
      assigned: true,
      plant: { plant_id: row.plant_id, scientific_name: row.scientific_name },
      species: projectSpecies(
        species,
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
          p.species_id,f.created_at AS favourited_at,s.*,preview.id AS image_asset_id
          FROM visitor_favourite f JOIN plant_record p ON p.plant_id=f.plant_id
          JOIN species s ON s.species_id=p.species_id
          LEFT JOIN rbac_species_visibility v ON v.species_id=s.species_id
          ${speciesImageJoin}
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
          ${speciesImageJoin}
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
          registered_at: row.registered_at,
          species_id: row.species_id,
          species_details: projectSpecies(row, false),
          image_asset_id: row.image_asset_id,
          favourited_at: row.favourited_at,
        })),
        species: speciesRows.rows.map((row) => ({
          ...projectSpecies(row, false),
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
          p.registered_at,p.species_id,s.*,preview.id AS image_asset_id
          FROM public.qr_code q JOIN plant_record p ON p.plant_id=q.plant_id
          JOIN species s ON s.species_id=p.species_id
          LEFT JOIN rbac_species_visibility v ON v.species_id=s.species_id
          ${speciesImageJoin}
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
          VALUES($1,$2,$2,$3,$4)
          RETURNING scan_id,qr_identifier,scanned_at`,
        [owner, row.plant_id, row.qr_id, qrIdentifier],
      )).rows[0];
      return { row, scan };
    });
    res.status(201).json({
      scan: result.scan,
      plant: {
        plant_id: result.row.plant_id,
        scientific_name: result.row.plant_scientific_name,
        registered_at: result.row.registered_at,
        species_id: result.row.species_id,
        species_details: projectSpecies(result.row, false),
        image_asset_id: result.row.image_asset_id,
      },
    });
  });

  app.get("/api/visitor/scan-history", allow("plants.public.read"), async (req, res) => {
    const owner = visitorOwner(req);
    const visible = visibilityFor(req.user);
    const rows = (await pool.query(
      `SELECT h.scan_id,h.qr_id,h.qr_identifier,h.scanned_at,p.plant_id,
        p.scientific_name AS plant_scientific_name,p.registered_at,p.species_id,
        s.*,preview.id AS image_asset_id
        FROM visitor_scan_history h JOIN plant_record p ON p.plant_id=h.plant_id
        JOIN species s ON s.species_id=p.species_id
        LEFT JOIN rbac_species_visibility v ON v.species_id=s.species_id
        ${speciesImageJoin}
        WHERE h.visitor_subject=$1 AND p.rbac_status='Approved'
          AND COALESCE(s.rbac_data->>'approvalStatus','Approved')='Approved'
          AND COALESCE(v.visibility,'protected') = ANY($2::text[])
        ORDER BY h.scanned_at DESC,h.scan_id DESC LIMIT 200`,
      [owner, visible],
    )).rows;
    res.json({ scans: rows.map((row) => ({
      scan_id: row.scan_id,
      qr_id: row.qr_id,
      qr_identifier: row.qr_identifier,
      scanned_at: row.scanned_at,
      plant: {
        plant_id: row.plant_id,
        scientific_name: row.plant_scientific_name,
        registered_at: row.registered_at,
        species_id: row.species_id,
        species_details: projectSpecies(row, false),
        image_asset_id: row.image_asset_id,
      },
    })) });
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
        "UPDATE species SET scientific_name=$1,common_name=$2,description=$3,status_id=$4,rbac_data=$5,genus_id=CASE WHEN $8 THEN $7 ELSE genus_id END WHERE species_id=$6 RETURNING species_id",
        [
          b.scientific_name,
          b.common_name,
          b.description,
          await statusReference(c, b),
          {
            habitat: b.habitat || "",
            culturalSignificance: b.culturalSignificance || "",
          },
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
    const rows = (
      await pool.query(
        "SELECT s.scientific_name,s.common_name,COUNT(p.plant_id) AS approved_plants FROM species s LEFT JOIN plant_record p ON p.species_id=s.species_id AND p.rbac_status='Approved' GROUP BY s.species_id,s.scientific_name,s.common_name ORDER BY s.scientific_name",
      )
    ).rows;
    res.json({ generatedAt: new Date().toISOString(), rows });
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
