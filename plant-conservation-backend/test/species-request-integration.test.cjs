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
    return { status: response.status, data: response.headers.get("Content-Type")?.includes("json") ? await response.json() : Buffer.from(await response.arrayBuffer()) };
  };
  const photo = await sharp({ create: { width: 2, height: 2, channels: 3, background: "green" } }).jpeg().toBuffer();
  let serial = 0;
  async function fixture({ status = "Pending Review", owner = "bot", request = true } = {}) {
    const n = ++serial;
    const species = (await pool.query(`INSERT INTO species(scientific_name,common_name,rbac_data) VALUES($1,'Common','{"approvalStatus":"Pending Review"}') RETURNING species_id`, [`Species ${n}`])).rows[0].species_id;
    if (!request || status === "Approved") await pool.query("UPDATE species SET rbac_data='{}' WHERE species_id=$1", [species]);
    const plant = (await pool.query("INSERT INTO plant_record(species_id,registered_subject,qr_token) VALUES($1,$2,$3) RETURNING plant_id", [species, `staff:${owner}`, randomUUID()])).rows[0].plant_id;
    const observation = randomUUID();
    await pool.query("INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key) VALUES($1,$2,$3,'Pending Review',$4,$5)", [observation, plant, `staff:${owner}`, { heightCm: 5, latitude: 0, longitude: 0 }, randomUUID()]);
    if (request) await pool.query(`INSERT INTO species_request_submission
      (request_id,owner_subject,client_key,payload_hash,scientific_name,common_name,genus_name,family_name,conservation_status,description,habitat,photo,request_status,proposed_species_id,approved_species_id)
      VALUES($1,$2,$3,'hash','Proposed','Common','Genus','Family','Least Concern','Description','Habitat',$4,$5,$6,$7)`,
      [n, `staff:${owner}`, randomUUID(), photo, status, species, status === "Approved" ? species : null]);
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
    const other = await fixture({request: false});
    await pool.query("UPDATE species_request_submission SET approved_species_id=$1 WHERE request_id=$2", [other.species, f.request]);
    assert.equal((await plantDecision(f)).status, 409);
    assert.equal((await plantDecision(other)).status, 409);
    assert.equal((await observation(other)).species_request.request_status, "Inconsistent");
    const pending = await fixture();
    await pool.query(`INSERT INTO species_request_submission
      (request_id,owner_subject,client_key,payload_hash,scientific_name,common_name,genus_name,family_name,conservation_status,description,habitat,photo,proposed_species_id)
      SELECT $1,owner_subject,$2,payload_hash,'Different',common_name,genus_name,family_name,conservation_status,description,habitat,photo,proposed_species_id
      FROM species_request_submission WHERE request_id=$3`, [++serial, randomUUID(), pending.request]);
    assert.deepEqual((await observation(pending)).species_request, {request_status: "Ambiguous"});
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
});
