"use strict";
const { randomUUID, randomBytes, createHash } = require("node:crypto");
const {
  permitted,
  visibilityFor,
  projectSpecies,
  assertEdit,
  assertReview,
} = require("../shared/rbac.cjs");
const hash = (value) => createHash("sha256").update(value).digest("hex");
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
  text(body.healthStatus, 100);
  text(body.lifeStage, 100);
  text(body.morphology);
  if (
    body.notes !== undefined &&
    (typeof body.notes !== "string" || body.notes.length > 4000)
  )
    fail(400, "Invalid notes.");
  if (body.taxonomy !== undefined) text(body.taxonomy, 1000);
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
    body.accuracy_m !== undefined &&
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
async function speciesRow(c, speciesId, user) {
  const row = (
    await c.query(
      `SELECT s.*,g.genus_name,f.family_name,cs.status_name AS conservation_status,COALESCE(v.visibility,'protected') AS visibility FROM species s LEFT JOIN genus g ON g.genus_id=s.genus_id LEFT JOIN family f ON f.family_id=g.family_id LEFT JOIN conservation_status cs ON cs.status_id=s.status_id LEFT JOIN rbac_species_visibility v ON v.species_id=s.species_id WHERE s.species_id=$1 AND COALESCE(v.visibility,'protected') = ANY($2::text[])`,
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
function mountDomain(app, { pool, auth, allow }) {
  app.get("/api/species", allow("plants.public.read"), async (req, res) => {
    const scientific = req.query.scope === "scientific";
    if (scientific && !permitted(req.user, "plants.scientific.read"))
      fail(req.user ? 403 : 401, "Scientific access required.");
    const q = typeof req.query.q === "string" ? req.query.q : "";
    if (q.length > 200) fail(400, "Search is too long.");
    const rows = (
      await pool.query(
        `SELECT s.*,g.genus_name,f.family_name,cs.status_name AS conservation_status,COALESCE(v.visibility,'protected') AS visibility FROM species s LEFT JOIN genus g ON g.genus_id=s.genus_id LEFT JOIN family f ON f.family_id=g.family_id LEFT JOIN conservation_status cs ON cs.status_id=s.status_id LEFT JOIN rbac_species_visibility v ON v.species_id=s.species_id WHERE COALESCE(v.visibility,'protected') = ANY($1::text[]) AND strpos(lower(coalesce(s.scientific_name,'')||' '||coalesce(s.common_name,'')||' '||coalesce(g.genus_name,'')||' '||coalesce(f.family_name,'')),lower($2))>0 ORDER BY s.scientific_name LIMIT 200`,
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
    const plantId = req.params.id === undefined ? null : req.params.id;
    if (
      plantId !== null &&
      (!/^[1-9][0-9]{0,9}$/.test(plantId) || Number(plantId) > 2147483647)
    )
      fail(400, "Invalid plant identifier.");
    const staff = permitted(req.user, "plants.scientific.read");
    const rows = (
      await pool.query(
        `SELECT p.plant_id,p.species_id,p.rbac_status,p.registered_subject,p.registered_at,l.latitude,l.longitude,l.accuracy_m,o.content AS latest_approved,o.updated_at AS observed_at FROM plant_record p LEFT JOIN plant_location l ON l.location_id=(SELECT location_id FROM plant_location WHERE plant_id=p.plant_id ORDER BY recorded_at DESC,location_id DESC LIMIT 1) LEFT JOIN plant_observation o ON o.id=(SELECT id FROM plant_observation WHERE plant_id=p.plant_id AND status='Approved' ORDER BY updated_at DESC,id DESC LIMIT 1) LEFT JOIN rbac_species_visibility v ON v.species_id=p.species_id WHERE COALESCE(v.visibility,'protected') = ANY($1::text[]) AND (p.rbac_status='Approved' OR p.registered_subject=$2 OR $3) AND ($4::integer IS NULL OR p.plant_id=$4) ORDER BY p.plant_id DESC LIMIT 500`,
        [
          visibilityFor(req.user),
          req.user ? subject(req.user) : "",
          req.user?.role === "Conservation Officer",
          plantId,
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
    if (plantId !== null) {
      if (!plants.length) fail(404, "Plant unavailable.");
      return res.json({ plant: plants[0] });
    }
    res.json({ plants });
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
    const result = await transaction(pool, async (c) => {
      // BEGIN IMMEDIATE serializes writers before checking idempotency.
      const previous = (
        await c.query(
          "SELECT o.* ,p.species_id FROM plant_observation o JOIN plant_record p ON p.plant_id=o.plant_id WHERE o.owner_subject=$1 AND o.client_key=$2",
          [subject(req.user), b.client_key],
        )
      ).rows[0];
      if (previous) {
        if (String(previous.species_id) !== String(b.species_id))
          fail(409, "Draft key already belongs to a different species.");
        await speciesRow(c, previous.species_id, req.user);
        return previous;
      }
      await speciesRow(c, b.species_id, req.user);
      const plant = (
        await c.query(
          "INSERT INTO plant_record(species_id,registered_subject,qr_token) VALUES($1,$2,$3) RETURNING plant_id",
          [b.species_id, subject(req.user), randomBytes(24).toString("hex")],
        )
      ).rows[0];
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
    const rows = (
      await pool.query(
        "SELECT o.*,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'content_type',a.content_type)) FROM plant_asset a WHERE a.observation_id=o.id),'[]') AS assets,p.species_id,s.scientific_name,s.common_name,r.comment AS review_comment,r.decision AS review_decision,r.created_at AS reviewed_at FROM plant_observation o JOIN plant_record p ON p.plant_id=o.plant_id JOIN species s ON s.species_id=p.species_id LEFT JOIN LATERAL (SELECT comment,decision,created_at FROM observation_review WHERE observation_id=o.id ORDER BY created_at DESC LIMIT 1) r ON true LEFT JOIN rbac_species_visibility v ON v.species_id=p.species_id WHERE ($1 OR o.owner_subject=$2) AND COALESCE(v.visibility,'protected') = ANY($3::text[]) AND ($4::text IS NULL OR o.id=$4) ORDER BY o.created_at DESC LIMIT 500",
        [officer, subject(req.user), visibilityFor(req.user), observationId],
      )
    ).rows;
    if (observationId !== null) {
      if (!rows.length) fail(404, "Observation unavailable.");
      return res.json({ observation: rows[0] });
    }
    res.json({ observations: rows });
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
      res.status(201).json(result);
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
      res.json(result);
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
        await c.query(
          "INSERT INTO observation_review(id,observation_id,reviewer_subject,decision,comment) VALUES($1,$2,$3,$4,$5)",
          [
            randomUUID(),
            row.id,
            subject(req.user),
            req.body.decision,
            req.body.comment || "Verified.",
          ],
        );
        await c.query(
          "UPDATE plant_observation SET status=$1,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=$2",
          [req.body.decision, row.id],
        );
        if (req.body.decision === "Approved") {
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
        await audit(c, req.user, `observation_${req.body.decision}`, row.id);
        return { reviewed: true };
      });
      res.json(result);
    },
  );
  app.get("/api/qr/:token", allow("plants.public.read"), async (req, res) => {
    const row = (
      await pool.query(
        "SELECT plant_id,species_id,rbac_status FROM plant_record WHERE qr_token=$1 AND rbac_status='Approved'",
        [req.params.token],
      )
    ).rows[0];
    if (!row) fail(404, "QR code is unavailable.");
    const species = await speciesRow(pool, row.species_id, req.user);
    res.json({
      plant: row,
      species: projectSpecies(
        species,
        permitted(req.user, "plants.scientific.read"),
      ),
    });
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
    text(b.scientific_name, 200);
    text(b.common_name, 200);
    text(b.description);
    for (const key of ["habitat", "culturalSignificance"])
      if (
        b[key] !== undefined &&
        (typeof b[key] !== "string" || b[key].length > 4000)
      )
        fail(400, "Invalid species text.");
    if (!["public", "internal", "protected"].includes(b.visibility))
      fail(400, "Select visibility.");
    const result = await transaction(pool, async (c) => {
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
    text(b.scientific_name, 200);
    text(b.common_name, 200);
    text(b.description);
    for (const key of ["habitat", "culturalSignificance"])
      if (
        b[key] !== undefined &&
        (typeof b[key] !== "string" || b[key].length > 4000)
      )
        fail(400, "Invalid species text.");
    if (!["public", "internal", "protected"].includes(b.visibility))
      fail(400, "Select visibility.");
    await transaction(pool, async (c) => {
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
};
