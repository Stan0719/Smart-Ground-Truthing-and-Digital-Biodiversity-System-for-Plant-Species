"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { readFileSync } = require("node:fs"), { join } = require("node:path"), { once } = require("node:events");
const sharp = require("sharp");
const { createPlantDatabase } = require("./postgres-fixture.cjs");
const { createPlantApp } = require("../server.js");

test("Phase 1: pending species corrections preserve immutable origin and genuine dependencies", async t => {
  // In-memory PGlite only; never opens an application database connection.
  const pool = await createPlantDatabase();
  t.after(() => pool.end());
  for (const name of ["004-species-requests.sql", "006-atomic-plant-submissions.sql", "008-record-change-submissions.sql", "009-record-version-history.sql"])
    await pool.query(readFileSync(join(__dirname, "../migrations", name), "utf8"));
  await pool.query(`CREATE TABLE public.qr_code(qr_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plant_id integer UNIQUE,qr_code text UNIQUE,status text,assigned_at timestamptz,activated_at timestamptz,retired_at timestamptz)`);
  await pool.query(`INSERT INTO species(scientific_name,common_name,rbac_data) VALUES
    ('Species A','A','{}'),('Species B','B','{}'),('Unapproved','U','{"approvalStatus":"Pending Review"}'),('Protected','P','{}');
    INSERT INTO rbac_species_visibility VALUES(1,'public'),(2,'public'),(3,'public'),(4,'protected')`);
  const roles = { bot: "Botanist", other: "Botanist", officer: "Conservation Officer" };
  const tokens = Object.fromEntries(Object.keys(roles).map((key, i) => [key, String(i + 1).repeat(64)]));
  const auth = { session: async token => {
    const key = Object.keys(tokens).find(key => tokens[key] === token);
    return key ? { id: key, role: roles[key], status: "Active", mustChangePassword: false } : null;
  }, event: async () => {} };
  const server = createPlantApp({ pool, auth }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  async function call(path, method = "GET", body, role = "bot") {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokens[role]}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  }
  const photo = { content_type: "image/png", base64: (await sharp({ create: { width: 2, height: 2, channels: 3, background: "green" } }).png().toBuffer()).toString("base64") };
  const content = { heightCm: 20, healthStatus: "Healthy", lifeStage: "Mature", morphology: "Leaves", latitude: 4, longitude: 113 };
  let serial = 0;
  async function create(proposal = false) {
    const n = ++serial;
    const qr = (await pool.query("INSERT INTO public.qr_code(qr_code,status) VALUES($1,'generated') RETURNING qr_id", [`phase1-${n}`])).rows[0];
    const body = { scientific_name: `Individual ${n}`, latitude: 4, longitude: 113, content, photos: [photo, photo, photo], qr_id: qr.qr_id, client_key: `phase1-${n}`,
      ...(proposal ? { new_species: { scientific_name: `Proposal ${n}`, common_name: "New", genus_name: "Genus", family_name: "Family", conservation_status: "Least Concern", description: "Description", habitat: "Forest", photo } } : { species_id: 1 }) };
    const r = await call("/plant-submissions", "POST", body);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return { ...r.data, body };
  }
  const receipt = async f => (await pool.query("SELECT * FROM plant_submission_receipt WHERE client_key=$1", [f.body.client_key])).rows[0];
  const detail = f => call(`/observations/${f.id}`, "GET", undefined, "officer");
  const edit = (f, species, revision = 1, role = "bot") => call(`/my-plants/${f.plant_id}`, "PATCH", { species_id: species, scientific_name: f.body.scientific_name, content, expected_revision: revision }, role);
  const review = (f, revision = 1) => call(`/observations/${f.id}/review`, "POST", { decision: "Approved", comment: "Verified", revision }, "officer");
  const approveSpecies = f => call(`/species-requests/${f.species_request_id}/review`, "POST", { decision: "Approved", comment: "Verified", visibility: "public" }, "officer");

  await t.test("unchanged existing-species registration reviews normally", async () => {
    const f = await create();
    assert.equal((await detail(f)).data.observation.species_request, null);
    assert.equal((await review(f)).status, 200);
  });
  await t.test("A to approved B correction reviews, preserves receipt/replay, and never inherits B history", async () => {
    // Give B genuine historical request metadata using an independently approved proposal.
    const historical = await create(true);
    assert.equal((await approveSpecies(historical)).status, 200);
    const target = Number(historical.species_id);
    const f = await create(), before = await receipt(f);
    const counts = async () => (await pool.query(`SELECT (SELECT count(*) FROM plant_record)::int AS plants,
      (SELECT count(*) FROM plant_observation)::int AS observations,(SELECT count(*) FROM species_request_submission)::int AS requests`)).rows[0];
    const originalCounts = await counts();
    assert.equal((await edit(f, target)).status, 200);
    assert.deepEqual(await receipt(f), before);
    const row = (await detail(f)).data.observation;
    assert.equal(Number(row.species_id), target);
    assert.equal(row.species_request_id, null); assert.equal(row.species_request, null);
    const replay = await call("/plant-submissions", "POST", f.body);
    assert.equal(replay.status, 201); assert.deepEqual(replay.data, before.result);
    assert.equal((await call("/plant-submissions", "POST", { ...f.body, species_id: target })).status, 409);
    assert.equal((await edit(f, 2, 1)).status, 409);
    assert.equal((await review(f, 1)).status, 409);
    assert.equal((await review(f, 2)).status, 200);
    assert.deepEqual(await receipt(f), before);
    assert.deepEqual(await counts(), originalCounts);
  });
  await t.test("unapproved/inaccessible targets and another owner cannot correct species", async () => {
    const f = await create(), before = await receipt(f);
    for (const species of [3, 4]) assert.equal((await edit(f, species)).status, 404);
    assert.equal((await edit(f, 2, 1, "other")).status, 404);
    assert.equal((await edit(f, 2, 1, "officer")).status, 403);
    assert.deepEqual(await receipt(f), before);
    assert.equal(Number((await detail(f)).data.observation.species_id), 1);
  });
  await t.test("pending genuine request cannot be bypassed; approved request remains pinned and linked", async () => {
    const f = await create(true), before = await receipt(f);
    assert.equal((await review(f)).status, 409);
    assert.equal((await edit(f, 2)).status, 409);
    assert.equal((await approveSpecies(f)).status, 200);
    // Phase 1 supports reassignment only for explicit no-request receipts.
    assert.equal((await edit(f, 2)).status, 409);
    const row = (await detail(f)).data.observation;
    assert.equal(row.species_request_id, String(f.species_request_id));
    assert.equal(row.species_request.request_status, "Approved");
    assert.equal((await review(f)).status, 200);
    const visit = await call(`/plants/${f.plant_id}/observations`, "POST", { content, client_key: `visit-${f.id}` });
    assert.equal(visit.status, 201);
    assert.equal((await call(`/observations/${visit.data.id}/submit`, "POST", {})).status, 200);
    assert.equal((await detail(visit.data)).data.observation.species_request, null);
    assert.equal((await review(visit.data)).status, 200);
    assert.deepEqual(await receipt(f), before);
  });
  await t.test("unknown, ambiguous and invalid bindings cannot authorize reassignment", async () => {
    for (const kind of ["missing", "ambiguous", "invalid"]) {
      const f = await create(true);
      if (kind === "missing") await pool.query("DELETE FROM plant_submission_receipt WHERE client_key=$1", [f.body.client_key]);
      if (kind === "ambiguous") await pool.query("INSERT INTO plant_submission_receipt SELECT owner_subject,client_key||'-copy',payload_hash,result,created_at FROM plant_submission_receipt WHERE client_key=$1", [f.body.client_key]);
      if (kind === "invalid") await pool.query("UPDATE plant_submission_receipt SET result=jsonb_set(result,'{id}','\"missing-observation\"') WHERE client_key=$1", [f.body.client_key]);
      assert.equal((await edit(f, 2)).status, 409);
      assert.equal((await review(f)).status, 409);
    }
    const legacy = await create();
    await pool.query("DELETE FROM plant_submission_receipt WHERE client_key=$1", [legacy.body.client_key]);
    assert.equal((await edit(legacy, 2)).status, 409);
    assert.equal((await detail(legacy)).data.observation.species_request, null);
    // Existing legacy review semantics remain: no fabricated dependency.
    assert.equal((await review(legacy)).status, 200);
  });
  await t.test("a genuine request species mismatch fails closed even after direct fixture reassignment", async () => {
    const f = await create(true);
    await pool.query("UPDATE plant_record SET species_id=2 WHERE plant_id=$1", [f.plant_id]);
    const row = (await detail(f)).data.observation;
    assert.equal(row.species_request_id, String(f.species_request_id));
    assert.equal(row.species_request.request_status, "Inconsistent");
    assert.equal((await review(f)).status, 409);
  });
  await t.test("changed current species must still be approved at review time", async () => {
    const f = await create();
    assert.equal((await edit(f, 2)).status, 200);
    await pool.query("UPDATE species SET rbac_data='{\"approvalStatus\":\"Pending Review\"}' WHERE species_id=2");
    assert.equal((await review(f, 2)).status, 409);
  });
});
