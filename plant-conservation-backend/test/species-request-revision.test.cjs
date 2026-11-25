"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { once } = require("node:events");
const sharp = require("sharp");
const { createPlantDatabase, installTranslationStorage } = require("./postgres-fixture.cjs");
const { createPlantApp } = require("../server.js");

test("species request content revisions protect pending edits and every review decision", async t => {
  const pool = await createPlantDatabase();
  t.after(() => pool.end());
  // Migration 017 explicitly selects plant_app; keep this disposable fixture consistent.
  await pool.query("CREATE SCHEMA IF NOT EXISTS plant_app; SET search_path=plant_app,pg_catalog");
  await pool.query(readFileSync(join(__dirname, "../schema.postgres.sql"), "utf8"));
  const migration = name => readFileSync(join(__dirname, "../migrations", name), "utf8");
  for (const name of ["004-species-requests.sql", "006-atomic-plant-submissions.sql", "008-record-change-submissions.sql", "009-record-version-history.sql"])
    await pool.query(migration(name));
  const photo = await sharp({ create: { width: 3, height: 3, channels: 3, background: "green" } }).jpeg().toBuffer();
  await pool.query(`INSERT INTO species_request_submission(owner_subject,client_key,payload_hash,scientific_name,common_name,genus_name,family_name,conservation_status,description,habitat,photo)
    VALUES('staff:bot','legacy','legacy','Legacy','Common','Genus','Family','Least Concern','Description','Forest',$1)`, [photo]);
  await pool.query(migration("016-species-request-content-revision.sql"));
  await pool.query(migration("017-species-review-cycle.sql"));
  await installTranslationStorage(pool);
  await pool.query(migration("016-species-request-content-revision.sql"));
  await pool.query(migration("017-species-review-cycle.sql"));
  const legacy = (await pool.query("SELECT content_revision,content_updated_at FROM species_request_submission WHERE client_key='legacy'")).rows[0];
  assert.deepEqual(legacy, { content_revision: 1, content_updated_at: null });
  const users = {
    bot: { id: "bot", role: "Botanist" }, other: { id: "other", role: "Botanist" },
    officer: { id: "officer", role: "Conservation Officer" }, second: { id: "second", role: "Conservation Officer" },
  };
  const tokens = Object.fromEntries(Object.keys(users).map((key, index) => [key, String(index + 1).repeat(64)]));
  const auth = { event: async () => {}, session: async token => {
    const key = Object.keys(tokens).find(key => tokens[key] === token);
    return key ? { ...users[key], status: "Active", mustChangePassword: false } : null;
  } };
  const server = createPlantApp({ pool, auth, origins: new Set() }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  async function call(path, body, role = "officer", method = body === undefined ? "GET" : "POST") {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { Authorization: `Bearer ${tokens[role]}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
  }
  let serial = 0;
  const proposal = name => ({ scientific_name: name, common_name: "Common", genus_name: "Genus", family_name: "Family", conservation_status: "Least Concern", description: "Description", habitat: "Forest" });
  async function create() {
    const data = proposal(`Revision species ${++serial}`);
    const result = await call("/species-requests", { ...data, photo: { content_type: "image/jpeg", base64: photo.toString("base64") }, client_key: `revision-${serial}` }, "bot");
    assert.equal(result.status, 201, JSON.stringify(result.data));
    assert.equal(result.data.species_request.content_revision, 1);
    return { id: result.data.species_request.request_id, data };
  }
  const stored = async id => (await pool.query("SELECT * FROM species_request_submission WHERE request_id=$1", [id])).rows[0];
  const edit = async (f, changes = {}) => call(`/my-species-requests/${f.id}`, { ...f.data, expected_revision: (await stored(f.id)).content_revision, ...changes }, "bot", "PATCH");
  const review = (f, decision, revision = 1, role = "officer") => call(`/species-requests/${f.id}/review`, {
    decision, expected_review_cycle: 1, comment: "Inspected proposal", visibility: "internal", ...(revision === undefined ? {} : { expected_revision: revision }),
  }, role);
  async function state() {
    const snapshot = {};
    for (const table of ["species_request_submission", "species", "rbac_species_visibility", "plant_asset", "business_audit", "record_version_history"])
      snapshot[table] = (await pool.query(`SELECT * FROM ${table}`)).rows;
    return snapshot;
  }
  await t.test("real pending edits, no-op saves and failed edits advance only content versions", async () => {
    const f = await create();
    assert.equal((await edit(f)).status, 200);
    assert.equal((await stored(f.id)).content_revision, 1);
    assert.equal((await edit(f, { common_name: "Edited common name" })).status, 200);
    const row = await stored(f.id);
    assert.equal(row.content_revision, 2); assert.equal(row.request_status, "Pending Review"); assert.ok(row.content_updated_at);
    assert.equal((await edit(f, { scientific_name: "" })).status, 400);
    assert.equal((await stored(f.id)).content_revision, 2);
    assert.equal((await call(`/my-species-requests/${f.id}`, f.data, "other", "PATCH")).status, 404);
    assert.equal((await stored(f.id)).content_revision, 2);
    const detail = await call(`/species-requests/${f.id}`);
    assert.equal(detail.data.species_request.content_revision, 2);
  });
  await t.test("all stale or missing preconditions reject without any review side effects", async () => {
    const f = await create(); await edit(f, { description: "Changed after opening" });
    const before = await state();
    for (const decision of ["Approved", "Rejected", "Correction Required"]) {
      for (const expected of [1, null, 0, "2"]) {
        const result = await review(f, decision, expected);
        assert.equal(result.status, 409); assert.equal(result.data.code, "SPECIES_REQUEST_VERSION_CONFLICT");
        assert.deepEqual(await state(), before);
      }
    }
    const missing = await call(`/species-requests/${f.id}/review`, { decision: "Approved", visibility: "internal" });
    assert.equal(missing.status, 409); assert.equal(missing.data.code, "SPECIES_REQUEST_VERSION_CONFLICT");
    assert.deepEqual(await state(), before);
    const current = (await call(`/species-requests/${f.id}`)).data.species_request;
    const editedAt = (await stored(f.id)).content_updated_at;
    assert.equal((await review(f, "Approved", current.content_revision)).status, 200);
    assert.equal((await stored(f.id)).content_revision, 2);
    assert.deepEqual((await stored(f.id)).content_updated_at, editedAt);
  });
  await t.test("linked registration detail carries the same version and stale decisions cannot change its species", async () => {
    await pool.query("CREATE TABLE plant_app.qr_code(qr_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,plant_id integer,qr_code text,status text,assigned_at timestamptz)");
    const qr = (await pool.query("INSERT INTO plant_app.qr_code(qr_code,status) VALUES('revision-linked','generated') RETURNING qr_id")).rows[0];
    const image = { content_type: "image/jpeg", base64: photo.toString("base64") };
    const data = proposal("Linked version species");
    const result = await call("/plant-submissions", { scientific_name: "Individual", latitude: 4, longitude: 113, qr_id: qr.qr_id, client_key: "linked-revision", photos: [image,image,image], new_species: { ...data, photo: image }, content: { heightCm: 20, healthStatus: "Healthy", lifeStage: "Mature", morphology: "Leaves" } }, "bot");
    assert.equal(result.status, 201, JSON.stringify(result.data));
    const f = { id: result.data.species_request_id, data };
    const opened = await call(`/observations/${result.data.id}`);
    assert.equal(opened.data.observation.species_request.content_revision, 1);
    await edit(f, { habitat: "Edited linked habitat" });
    const before = await state();
    assert.equal((await review(f, "Approved", 1)).status, 409);
    assert.deepEqual(await state(), before);
    const refreshed = await call(`/observations/${result.data.id}`);
    assert.equal(refreshed.data.observation.species_request.content_revision, 2);
    assert.equal((await review(f, "Approved", 2)).status, 200);
    assert.equal((await pool.query("SELECT status FROM plant_observation WHERE id=$1", [result.data.id])).rows[0].status, "Pending Review");
  });
  await t.test("photo changes advance revision and rolled-back edits retain it", async () => {
    const f = await create();
    const replacement = await sharp({ create: { width: 3, height: 3, channels: 3, background: "blue" } }).jpeg().toBuffer();
    assert.equal((await edit(f, { photo: { content_type: "image/jpeg", base64: replacement.toString("base64") } })).status, 200);
    assert.equal((await stored(f.id)).content_revision, 2);
    const beforeStalePhoto = await state();
    const stalePhoto = await call(`/my-species-requests/${f.id}`, { ...f.data, expected_revision: 1, photo: { content_type: "image/jpeg", base64: photo.toString("base64") } }, "bot", "PATCH");
    assert.equal(stalePhoto.status, 409);
    assert.deepEqual(await state(), beforeStalePhoto);
    await pool.query("UPDATE species_request_submission SET photo=$1 WHERE request_id=$2", [Buffer.from("different photo bytes"), f.id]);
    assert.equal((await stored(f.id)).content_revision, 3);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE species_request_submission SET habitat='Changed' WHERE request_id=$1", [f.id]);
      await client.query("ROLLBACK");
    } finally { client.release(); }
    assert.equal((await stored(f.id)).content_revision, 3);
  });
  await t.test("two editing sessions preserve the newer content and reject invalid preconditions without side effects", async () => {
    const f = await create();
    const sessionA = { ...f.data, expected_revision: 1, habitat: "Session A habitat" };
    const sessionB = { ...f.data, expected_revision: 1, habitat: "Session B habitat" };
    assert.equal((await call(`/my-species-requests/${f.id}`, sessionA, "bot", "PATCH")).status, 200);
    assert.equal((await stored(f.id)).content_revision, 2);
    for (const expected of [undefined, null, "2", 0, 1, 2.5]) {
      const before = await state();
      const result = await call(`/my-species-requests/${f.id}`, { ...sessionB, expected_revision: expected }, "bot", "PATCH");
      assert.equal(result.status, 409);
      assert.equal(result.data.code, "SPECIES_REQUEST_EDIT_VERSION_CONFLICT");
      assert.deepEqual(await state(), before);
    }
    assert.equal((await call(`/my-species-requests/${f.id}`, { ...sessionB, expected_revision: 2 }, "bot", "PATCH")).status, 200);
    assert.equal((await stored(f.id)).content_revision, 3);
    assert.equal((await review(f, "Approved", 2)).status, 409);
  });
  await t.test("conflicting Officers commit one decision and one audit", async () => {
    const f = await create();
    const results = await Promise.all([review(f, "Approved"), review(f, "Rejected", 1, "second")]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    assert.equal((await pool.query("SELECT count(*)::integer AS n FROM business_audit WHERE action='species_request_reviewed' AND target=$1", [String(f.id)])).rows[0].n, 1);
  });
  await t.test("pending edit competing with approval respects the locked revision", async () => {
    const f = await create();
    const results = await Promise.all([edit(f, { habitat: "New habitat" }), review(f, "Approved")]);
    const row = await stored(f.id);
    if (results[0].status === 200) {
      assert.equal(results[1].status, 409); assert.equal(row.request_status, "Pending Review"); assert.equal(row.content_revision, 2);
    } else {
      assert.equal(results[1].status, 200); assert.equal(row.request_status, "Approved"); assert.equal(row.content_revision, 1);
    }
  });
  // The PGlite fixture serializes transactions. These tests prove application
  // ordering and lock use, not multi-connection PostgreSQL timing.
});
