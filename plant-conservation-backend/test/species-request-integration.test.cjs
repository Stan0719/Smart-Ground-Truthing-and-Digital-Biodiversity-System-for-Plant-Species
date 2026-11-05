"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { once } = require("node:events");
const sharp = require("sharp");
const { createPlantDatabase } = require("./postgres-fixture.cjs");
const { createPlantApp } = require("../server.js");

test("reconciled species requests: authoritative linkage and dependency guards", async t => {
  const pool = await createPlantDatabase();
  let requestLocks = 0;
  const connect = pool.connect.bind(pool);
  pool.connect = async () => {
    const client = await connect();
    const query = client.query.bind(client);
    client.query = (sql, params) => {
      if (/SELECT \* FROM species_request_submission.*FOR UPDATE/.test(sql)) requestLocks++;
      return query(sql, params);
    };
    return client;
  };
  t.after(() => pool.end());
  // Snapshot of the existing deployed table, in isolated PGlite only. No
  // application migration, production DDL, or production fixture is involved.
  await pool.query(`CREATE TABLE species_request_submission (
    request_id integer PRIMARY KEY,owner_subject text NOT NULL,client_key text NOT NULL,
    payload_hash text NOT NULL,scientific_name text NOT NULL,common_name text NOT NULL,
    genus_name text NOT NULL,family_name text NOT NULL,conservation_status text NOT NULL,
    description text NOT NULL,habitat text NOT NULL,photo bytea NOT NULL CHECK(octet_length(photo) BETWEEN 1 AND 4194304),
    request_status text NOT NULL DEFAULT 'Pending Review' CHECK(request_status IN ('Pending Review','Approved','Rejected','Correction Required')),
    review_comment text,reviewed_by text,submitted_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at timestamptz,approved_species_id integer REFERENCES species(species_id),
    proposed_species_id bigint REFERENCES species(species_id),
    UNIQUE(owner_subject,client_key),CHECK((request_status='Approved')=(approved_species_id IS NOT NULL))
  )`);
  await pool.query("CREATE TABLE plant_submission_receipt(owner_subject text NOT NULL,client_key text NOT NULL,payload_hash text NOT NULL,result jsonb NOT NULL,PRIMARY KEY(owner_subject,client_key))");
  const roles = { officer: "Conservation Officer", second: "Conservation Officer", bot: "Botanist", admin: "Administrator" };
  const tokens = Object.fromEntries(Object.keys(roles).map((key, i) => [key, String(i + 1).repeat(64)]));
  const auth = {
    session: async token => {
      const key = Object.keys(tokens).find(key => tokens[key] === token);
      return key ? { id: key, role: roles[key], status: "Active", mustChangePassword: false } : null;
    },
    event: async () => {},
  };
  const server = createPlantApp({ auth, pool, origins: new Set() }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const call = async (path, role = "officer", body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { ...(tokens[role] ? { Authorization: `Bearer ${tokens[role]}` } : {}), "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, headers: response.headers, data: response.headers.get("Content-Type")?.includes("json") ? await response.json() : Buffer.from(await response.arrayBuffer()) };
  };
  const photo = await sharp({ create: { width: 2, height: 2, channels: 3, background: "green" } }).jpeg().toBuffer();
  let serial = 0;
  async function fixture({ status = "Pending Review", owner = "bot", request = true, provenance = true } = {}) {
    const n = ++serial;
    const species = (await pool.query(`INSERT INTO species(scientific_name,common_name,rbac_data) VALUES($1,'Common','{"approvalStatus":"Pending Review"}') RETURNING species_id`, [`Species ${n}`])).rows[0].species_id;
    if (!request || status === "Approved") await pool.query("UPDATE species SET rbac_data='{}' WHERE species_id=$1", [species]);
    const plant = (await pool.query("INSERT INTO plant_record(species_id,registered_subject,qr_token) VALUES($1,$2,$3) RETURNING plant_id", [species, `staff:${owner}`, randomUUID()])).rows[0].plant_id;
    const observation = randomUUID(), clientKey = randomUUID();
    await pool.query("INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key) VALUES($1,$2,$3,'Pending Review',$4,$5)", [observation, plant, `staff:${owner}`, { heightCm: 5, latitude: 0, longitude: 0 }, clientKey]);
    if (request) await pool.query(`INSERT INTO species_request_submission
      (request_id,owner_subject,client_key,payload_hash,scientific_name,common_name,genus_name,family_name,conservation_status,description,habitat,photo,request_status,proposed_species_id,approved_species_id)
      VALUES($1,$2,$3,'hash','Proposed','Common','Genus','Family','Least Concern','Description','Habitat',$4,$5,$6,$7)`,
      [n, `staff:${owner}`, clientKey, photo, status, species, status === "Approved" ? species : null]);
    if (provenance) await pool.query("INSERT INTO plant_submission_receipt(owner_subject,client_key,payload_hash,result) VALUES($1,$2,'hash',$3)", [`staff:${owner}`, clientKey, { id: observation, plant_id: plant, species_id: species, species_request_id: request ? n : null }]);
    return { request: n, species: String(species), plant, observation };
  }
  const observation = async f => (await call(`/observations/${f.observation}`)).data.observation;
  const decision = (f, value, comment = "Reason", role = "officer") => call(`/species-requests/${f.request}/review`, role, { decision: value, comment, ...(value === "Approved" ? { visibility: "internal" } : {}) });
  const plantDecision = (f, value = "Approved") => call(`/observations/${f.observation}/review`, "officer", { decision: value, comment: "Reason", revision: 1 });

  await t.test("pending projection, list/detail and both protected photo routes", async () => {
    const f = await fixture();
    const row = await observation(f);
    assert.equal(row.species_request_id, String(f.request));
    assert.equal(row.species_request.proposed_species_id, f.species);
    assert.equal(row.species_request.request_status, "Pending Review");
    const list = (await call("/observations")).data.observations.find(o => o.id === f.observation);
    assert.deepEqual(list.species_request, row.species_request);
    assert.equal((await call(`/species-requests/${f.request}`)).status, 200);
    for (const path of [`/assets/species-request-${f.request}`, `/species-requests/${f.request}/photo`]) {
      assert.equal((await call(path)).status, 200);
      assert.equal((await call(path, null)).status, 401);
    }
    for (const value of ["Approved", "Rejected", "Correction Required", "Flagged"])
      assert.equal((await plantDecision(f, value)).status, 409);
  });
  await t.test("explicit visibility approval unlocks only subsequent plant review", async () => {
    const f = await fixture();
    assert.equal((await call(`/species-requests/${f.request}/review`, "officer", { decision: "Approved", comment: "" })).status, 400);
    assert.equal((await decision(f, "Approved", "")).status, 200);
    assert.equal((await observation(f)).status, "Pending Review");
    assert.equal((await pool.query("SELECT visibility FROM rbac_species_visibility WHERE species_id=$1", [f.species])).rows[0].visibility, "internal");
    assert.equal((await observation(f)).species_request.approved_species_id, f.species);
    assert.equal((await plantDecision(f)).status, 200);
  });
  await t.test("rejected/correction dependencies stay blocked and self-review is denied", async () => {
    for (const value of ["Rejected", "Correction Required"]) {
      const f = await fixture();
      assert.equal((await decision(f, value, " ")).status, 400);
      assert.equal((await decision(f, value)).status, 200);
      assert.equal((await plantDecision(f)).status, 409);
    }
    assert.equal((await decision(await fixture({owner: "officer"}), "Approved")).status, 403);
  });
  await t.test("mismatched approval and ambiguous foreign keys fail closed", async () => {
    const f = await fixture({status: "Approved"});
    const other = await fixture({request: false, provenance: false});
    await pool.query("UPDATE species_request_submission SET approved_species_id=$1 WHERE request_id=$2", [other.species, f.request]);
    assert.equal((await plantDecision(f)).status, 409);
    assert.equal((await plantDecision(other)).status, 409);
    assert.equal((await observation(other)).species_request, null);
    const pending = await fixture();
    await pool.query(`INSERT INTO species_request_submission
      (request_id,owner_subject,client_key,payload_hash,scientific_name,common_name,genus_name,family_name,conservation_status,description,habitat,photo,proposed_species_id)
      SELECT $1,owner_subject,$2,payload_hash,'Different',common_name,genus_name,family_name,conservation_status,description,habitat,photo,proposed_species_id
      FROM species_request_submission WHERE request_id=$3`, [++serial, randomUUID(), pending.request]);
    assert.equal((await observation(pending)).species_request.request_status, "Pending Review");
    // A second species FK is not proof of origin; conflicting receipts are truly ambiguous.
    await pool.query("INSERT INTO plant_submission_receipt SELECT owner_subject,client_key||'-ambiguous',payload_hash,result FROM plant_submission_receipt WHERE result->>'id'=$1", [pending.observation]);
    assert.equal((await observation(pending)).species_request, null);
    assert.equal((await plantDecision(pending)).status, 409);
    assert.equal((await decision(pending, "Approved")).status, 409);
  });
  await t.test("absent linkage is never inferred; approved FK links without proposed species", async () => {
    const f = await fixture({request: false});
    assert.equal((await observation(f)).species_request, null);
    assert.equal((await plantDecision(f)).status, 200);
    const approved = await fixture({status: "Approved"});
    await pool.query("UPDATE species_request_submission SET proposed_species_id=NULL WHERE request_id=$1", [approved.request]);
    assert.equal((await observation(approved)).species_request_id, String(approved.request));
    assert.equal((await plantDecision(approved)).status, 200);
  });
  await t.test("missing request rows and invalid receipt bindings cannot unlock review", async () => {
    const missing = await fixture();
    await pool.query("UPDATE plant_submission_receipt SET result=jsonb_set(result,'{species_request_id}','999999') WHERE result->>'id'=$1", [missing.observation]);
    assert.equal((await observation(missing)).species_request.request_status, "Unavailable");
    assert.equal((await plantDecision(missing)).status, 409);
    const invalid = await fixture({ request: false });
    await pool.query("UPDATE plant_submission_receipt SET result=jsonb_set(result,'{species_id}','999999') WHERE result->>'id'=$1", [invalid.observation]);
    assert.equal((await observation(invalid)).species_request, null);
    assert.equal((await plantDecision(invalid)).status, 409);
  });
  await t.test("legacy records never acquire a fabricated request, while unresolved guards remain closed", async () => {
    const legacy = await fixture({ provenance: false });
    assert.equal((await observation(legacy)).species_request, null);
    assert.equal((await plantDecision(legacy)).status, 409);
    const ordinary = await fixture({ request: false, provenance: false });
    assert.equal((await observation(ordinary)).species_request, null);
    assert.equal((await plantDecision(ordinary)).status, 200);
  });
  await t.test("duplicate names prevent proposed approval; audit failures roll back", async () => {
    const f = await fixture();
    await pool.query("INSERT INTO species(scientific_name) VALUES(' proposed ')");
    assert.equal((await decision(f, "Approved")).status, 409);
    assert.equal((await observation(f)).species_request.request_status, "Pending Review");
    await pool.query("DELETE FROM species WHERE scientific_name=' proposed '");
    await pool.query("ALTER TABLE business_audit ADD CONSTRAINT reject_request_audit CHECK(action <> 'species_request_reviewed') NOT VALID");
    assert.equal((await decision(f, "Approved")).status, 400);
    assert.equal((await observation(f)).species_request.request_status, "Pending Review");
    assert.equal((await pool.query("SELECT rbac_data FROM species WHERE species_id=$1", [f.species])).rows[0].rbac_data.approvalStatus, "Pending Review");
    await pool.query("ALTER TABLE business_audit DROP CONSTRAINT reject_request_audit");
  });
  await t.test("review updates latest pending history and records audit identity", async () => {
    // Minimal isolated snapshot of the history columns used by request review.
    await pool.query(`CREATE TABLE record_version_history(id text PRIMARY KEY,request_id integer,
      version_number integer,status text,reviewed_by text,reviewed_at timestamptz,review_comment text)`);
    const f = await fixture();
    await pool.query("INSERT INTO record_version_history(id,request_id,version_number,status) VALUES('earlier',$1,1,'Rejected'),('latest',$1,2,'Pending Review')", [f.request]);
    assert.equal((await decision(f, "Approved", "Verified taxonomy")).status, 200);
    const history = (await pool.query("SELECT * FROM record_version_history ORDER BY version_number")).rows;
    assert.equal(history[0].status, "Rejected");
    assert.equal(history[1].status, "Approved");
    assert.equal(history[1].reviewed_by, "staff:officer");
    assert.equal(history[1].review_comment, "Verified taxonomy");
    assert.ok(history[1].reviewed_at);
    assert.equal(Number((await pool.query("SELECT count(*) FROM business_audit WHERE action='species_request_reviewed' AND target=$1", [String(f.request)])).rows[0].count), 1);
  });
  await t.test("request IDs are positive int32 on detail, photo, alias and review", async () => {
    for (const id of ["0", "-1", "bad", "1.5", "2147483648", "9".repeat(100)]) {
      for (const path of [`/species-requests/${id}`, `/species-requests/${id}/photo`, `/assets/species-request-${id}`])
        assert.equal((await call(path)).status, 400, path);
      assert.equal((await call(`/species-requests/${id}/review`, "officer", {decision: "Approved", visibility: "internal"})).status, 400);
    }
    for (const path of ["/species-requests/2147483647", "/species-requests/2147483647/photo", "/assets/species-request-2147483647"])
      assert.equal((await call(path)).status, 404);
    assert.equal((await call("/species-requests/2147483647/review", "officer", {decision: "Approved", visibility: "internal"})).status, 404);
  });
  await t.test("legacy incomplete requests and proposed names cannot be approved", async () => {
    for (const field of ["scientific_name", "common_name", "genus_name", "family_name", "conservation_status", "description", "habitat"]) {
      const f = await fixture();
      await pool.query(`UPDATE species_request_submission SET ${field}=' ' WHERE request_id=$1`, [f.request]);
      assert.equal((await decision(f, "Approved")).status, 409, field);
      assert.equal((await observation(f)).status, "Pending Review");
      assert.equal((await observation(f)).species_request.request_status, "Pending Review");
    }
    const f = await fixture();
    await pool.query("UPDATE species SET scientific_name=' ' WHERE species_id=$1", [f.species]);
    assert.equal((await decision(f, "Approved")).status, 409);
    // No proposed ID is required by the standalone creation workflow.
    const standalone = await fixture();
    await pool.query("UPDATE species_request_submission SET proposed_species_id=NULL,scientific_name='Standalone hardened' WHERE request_id=$1", [standalone.request]);
    const result = await decision(standalone, "Approved");
    assert.equal(result.status, 200);
    assert.ok(result.data.species_request.approved_species_id);
    assert.notEqual(String(result.data.species_request.approved_species_id), standalone.species);
  });
  await t.test("photo routes validate stored bytes, bound decoding, set headers and retain authorization", async () => {
    const f = await fixture();
    const paths = [`/species-requests/${f.request}/photo`, `/assets/species-request-${f.request}`];
    const png = await sharp({create: {width: 2, height: 2, channels: 4, background: 'green'}}).png().toBuffer();
    for (const bytes of [photo, png]) {
      await pool.query("UPDATE species_request_submission SET photo=$1 WHERE request_id=$2", [bytes, f.request]);
      for (const path of paths) {
        const result = await call(path);
        assert.equal(result.status, 200);
        assert.equal(result.headers.get('content-type'), 'image/jpeg');
        assert.equal(result.headers.get('content-security-policy'), "default-src 'none'; sandbox");
        assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(result.headers.get('content-disposition'), 'inline; filename="species-request.jpg"');
        assert.equal((await sharp(result.data).metadata()).format, 'jpeg');
      }
    }
    assert.equal((await call(paths[0], 'bot')).status, 200);
    assert.equal((await call(paths[1], 'bot')).status, 403);
    for (const path of paths) assert.equal((await call(path, 'second')).status, 200);
    const unsupported = await sharp(photo).webp().toBuffer();
    const excessivePixels = await sharp({create: {width: 5000, height: 5000, channels: 3, background: 'green'}}).png().toBuffer();
    for (const bytes of [Buffer.from('not an image'), unsupported, excessivePixels]) {
      await pool.query("UPDATE species_request_submission SET photo=$1 WHERE request_id=$2", [bytes, f.request]);
      for (const path of paths) {
        const result = await call(path);
        assert.equal(result.status, 415);
        assert.deepEqual(result.data, {error: 'Request photo is unavailable or unsupported.'});
      }
    }
    // The real CHECK prevents >4 MB storage. Simulate an invalid legacy adapter
    // result without weakening that CHECK or changing any schema.
    const query = pool.query;
    pool.query = async (sql, params) => sql.startsWith('SELECT photo FROM species_request_submission')
      ? {rows: [{photo: Buffer.alloc(4194305)}]} : query(sql, params);
    try { for (const path of paths) assert.equal((await call(path)).status, 415); }
    finally { pool.query = query; }
  });
  await t.test("optional approval comments normalize without relaxing limits or rejection feedback", async () => {
    for (const [input, stored] of [[undefined, ''], ['', ''], ['   ', ''], ['  Verified  ', 'Verified']]) {
      const f = await fixture();
      const result = await call(`/species-requests/${f.request}/review`, 'officer', {decision: 'Approved', visibility: 'internal', ...(input === undefined ? {} : {comment: input})});
      assert.equal(result.status, 200);
      assert.equal((await observation(f)).species_request.review_comment, stored);
    }
    const f = await fixture();
    for (const decision of ['Approved', 'Rejected', 'Correction Required'])
      assert.equal((await call(`/species-requests/${f.request}/review`, 'officer', {decision, visibility: 'internal', comment: ' '.repeat(4001)})).status, 400);
    for (const decision of ['Rejected', 'Correction Required'])
      for (const comment of ['', '   ']) assert.equal((await decisionCall(f, decision, comment)).status, 400);
    function decisionCall(f, decision, comment) { return call(`/species-requests/${f.request}/review`, 'officer', {decision, comment}); }
  });
  await t.test("malformed review payloads fail without changing request state", async () => {
    const f = await fixture();
    for (const body of [null, [], {}, {decision: 'Flagged'}, {decision: 'Approved', visibility: 'invalid'},
      {decision: 'Approved', visibility: 'internal', reviewer_id: 'other'},
      {decision: 'Approved', visibility: 'internal', revision: 1},
      {decision: 'Approved', visibility: 'internal', comment: 12},
      {decision: 'Approved', visibility: 'internal', comment: 'x'.repeat(4001)}])
      assert.equal((await call(`/species-requests/${f.request}/review`, 'officer', body)).status, 400);
    assert.equal((await observation(f)).species_request.request_status, 'Pending Review');
  });
  await t.test("projection exposes review evidence but omits stored secrets and bytes", async () => {
    const f = await fixture();
    const before = (await observation(f)).species_request;
    assert.equal(before.request_id, String(f.request));
    assert.equal(before.proposed_scientific_name, 'Proposed');
    assert.equal(before.suggested_common_name, 'Common');
    assert.equal(before.genus_name, 'Genus');
    assert.equal(before.family_name, 'Family');
    assert.equal(before.conservation_status, 'Least Concern');
    assert.equal(before.description, 'Description');
    assert.equal(before.habitat, 'Habitat');
    assert.equal(before.requested_by, 'staff:bot');
    assert.ok(before.submitted_at);
    assert.equal(before.approved_species_id, null);
    assert.equal(before.review_decision, null);
    assert.deepEqual(before.assets, [{id: `species-request-${f.request}`, content_type: 'image/jpeg'}]);
    for (const key of ['photo', 'payload_hash', 'client_key', 'reviewed_by']) assert.equal(key in before, false);
    assert.equal((await decision(f, 'Correction Required', 'More evidence')).status, 200);
    const after = (await observation(f)).species_request;
    assert.equal(after.review_decision, 'Correction Required');
    assert.equal(after.review_comment, 'More evidence');
    assert.ok(after.reviewed_at);
    assert.equal((await observation(f)).revision, 1);
    assert.equal((await plantDecision(f)).status, 409);
  });
  await t.test("competing and repeated reviews keep exactly one decision and its metadata", async () => {
    const f = await fixture();
    const beforeLocks = requestLocks;
    // PGlite's pool serializes transactions: this proves HTTP competing/retry
    // behavior and FOR UPDATE use, not multi-connection PostgreSQL lock timing.
    const results = await Promise.all([decision(f, 'Approved', 'First'), decision(f, 'Rejected', 'Second', 'second')]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    assert.equal(requestLocks - beforeLocks, 2);
    const saved = (await pool.query('SELECT * FROM species_request_submission WHERE request_id=$1', [f.request])).rows[0];
    assert.equal(saved.review_comment, results[0].status === 200 ? 'First' : 'Second');
    assert.equal(saved.reviewed_by, results[0].status === 200 ? 'staff:officer' : 'staff:second');
    assert.equal((await decision(f, 'Rejected', 'Overwrite')).status, 409);
    assert.deepEqual((await pool.query('SELECT * FROM species_request_submission WHERE request_id=$1', [f.request])).rows[0], saved);
    assert.equal(Number((await pool.query("SELECT count(*) FROM business_audit WHERE action='species_request_reviewed' AND target=$1", [String(f.request)])).rows[0].count), 1);
    assert.equal((await observation(f)).status, 'Pending Review');
  });
});
