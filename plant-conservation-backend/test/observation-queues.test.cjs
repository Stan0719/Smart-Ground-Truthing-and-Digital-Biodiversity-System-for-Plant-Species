"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { readFileSync } = require("node:fs"), { join } = require("node:path"), { once } = require("node:events");
const sharp = require("sharp");
const { createPlantDatabase } = require("./postgres-fixture.cjs");
const { createPlantApp } = require("../server.js");

test("Phase 3: authorized effective-origin queues and bounded pagination", async t => {
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
  await pool.query(`INSERT INTO plant_record(plant_id,species_id,registered_subject,qr_token,scientific_name)
    SELECT n,1,'staff:bot','queue-qr-'||n,'Queue plant' FROM generate_series(100,619) n;
    INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,created_at)
    SELECT n::text,n,'staff:bot','Pending Review','{"heightCm":20,"latitude":4,"longitude":113}', 'queue-'||n,'2026-01-01T00:00:00.000123Z' FROM generate_series(100,619) n;
    INSERT INTO plant_submission_receipt(owner_subject,client_key,payload_hash,result)
    SELECT 'staff:bot','queue-'||n,repeat('a',64),jsonb_build_object('id',n::text,'plant_id',n,'species_id',1,'species_request_id',NULL,'status','Pending Review','qr_token','queue-qr-'||n) FROM generate_series(100,619) n;
    INSERT INTO plant_record(plant_id,species_id,registered_subject,qr_token,rbac_status) VALUES(10000,1,'staff:bot','field-queue','Approved'),(10001,4,'staff:other','protected-queue','Approved');
    INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,origin_type,created_at)
    SELECT n::text,10000,'staff:bot','Pending Review','{"heightCm":30,"latitude":4,"longitude":113}', 'field-'||n,'subsequent_observation','2026-01-01T00:00:00.000124Z' FROM generate_series(20000,20699) n;
    INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,created_at)
    SELECT n::text,10000,'staff:bot','Flagged','{"heightCm":40}', 'legacy-'||n,'2020-01-01' FROM generate_series(30000,30002) n;
    INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,origin_type) VALUES('40000',10001,'staff:other','Pending Review','{"heightCm":10,"latitude":99}','private-queue','subsequent_observation');`);
  async function collect(origin, status = '', role = 'officer') {
    const found = []; let cursor = null; let requests = 0;
    do {
      const query = new URLSearchParams({ origin_type: origin, limit: '37', ...(status ? { status } : {}), ...(cursor ? { cursor } : {}) });
      const r = await call('/observations?' + query, 'GET', undefined, role);
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.ok(r.data.observations.length <= 37);
      assert.ok(r.data.observations.every(row => row.origin_type === origin));
      found.push(...r.data.observations);
      assert.equal(r.data.page.has_more, r.data.page.next_cursor !== null);
      cursor = r.data.page.next_cursor;
      assert.ok(++requests < 100);
    } while (cursor);
    assert.equal(new Set(found.map(row => row.id)).size, found.length);
    return found;
  }
  await t.test('all 520 receipt-backed initial registrations remain reachable beyond the old cap with tied timestamps', async () => {
    const rows = await collect('initial_registration'); assert.equal(rows.length, 520);
    assert.ok(rows.some(row => row.id === '100'));
    const d = await call('/observations/100', 'GET', undefined, 'officer'); assert.equal(d.data.observation.origin_type, rows.find(row => row.id === '100').origin_type);
  });
  await t.test('subsequent, unknown and status queues preserve every authorized record', async () => {
    assert.equal((await collect('subsequent_observation')).length, 701);
    assert.equal((await collect('unknown', 'Flagged')).length, 3);
    assert.equal((await collect('unknown', 'Pending Review')).length, 0);
  });
  await t.test('origin and cursor never expand Botanist ownership/visibility or expose GPS', async () => {
    const rows = await collect('subsequent_observation', '', 'bot'); assert.equal(rows.length, 700);
    assert.ok(rows.every(row => row.content.latitude === undefined));
    assert.equal((await collect('unknown', '', 'other')).length, 0);
  });
  await t.test('invalid query arguments and mismatched cursor filters are rejected', async () => {
    for (const query of ['limit=0','limit=201','limit=1.5','origin_type=plant','status=Nope','cursor=bad','limit=1&limit=2'])
      assert.equal((await call('/observations?' + query, 'GET', undefined, 'officer')).status, 400, query);
    const first = await call('/observations?origin_type=unknown&limit=1', 'GET', undefined, 'officer');
    assert.equal((await call('/observations?origin_type=initial_registration&cursor=' + encodeURIComponent(first.data.page.next_cursor), 'GET', undefined, 'officer')).status, 400);
  });
  await t.test('legacy callers retain bounded response and unknown review remains governed by existing rules', async () => {
    const old = await call('/observations', 'GET', undefined, 'officer'); assert.equal(old.data.observations.length, 500); assert.equal(old.data.page, undefined);
    assert.equal((await call('/observations/30000/review', 'POST', { decision: 'Approved', revision: 1 }, 'bot')).status, 403);
    assert.equal((await call('/observations/30000/review', 'POST', { decision: 'Approved', revision: 1 }, 'officer')).status, 200);
  });
});
