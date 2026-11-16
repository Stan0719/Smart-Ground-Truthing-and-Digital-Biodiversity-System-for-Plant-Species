"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { createPlantDatabase } = require("./postgres-fixture.cjs");
const { createPlantApp } = require("../server.js");

test("review history authorizes Officers and reads stored decisions with precision and pagination", async t => {
  // This fixture uses in-memory PGlite and never opens a configured database.
  const pool = await createPlantDatabase();
  t.after(() => pool.end());
  const users = {
    officer: { id: "officer", role: "Conservation Officer", status: "Active", mustChangePassword: false },
    admin: { id: "admin", role: "Administrator", status: "Active", mustChangePassword: false },
    bot: { id: "owner", role: "Botanist", status: "Active", mustChangePassword: false },
    visitor: { id: "visitor", role: "Visitor", status: "Active", mustChangePassword: false },
    inactive: { id: "inactive", role: "Conservation Officer", status: "Inactive", mustChangePassword: false },
    temporary: { id: "temporary", role: "Conservation Officer", status: "Active", mustChangePassword: true },
  };
  const tokens = Object.fromEntries(Object.keys(users).map((key, index) => [key, String(index + 1).repeat(64)]));
  const auth = { session: async token => users[Object.keys(tokens).find(key => tokens[key] === token)] || null, event: async () => {} };
  const server = createPlantApp({ pool, auth }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  async function call(path, user = "officer", method = "GET", body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { "Content-Type": "application/json", ...(user ? { Authorization: `Bearer ${tokens[user]}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  }
  await pool.query(`INSERT INTO species(species_id,scientific_name) VALUES(1,'Test species');
    INSERT INTO rbac_species_visibility VALUES(1,'protected');
    INSERT INTO plant_record(plant_id,species_id,registered_subject,qr_token,rbac_status) VALUES(1,1,'staff:owner','test-qr','Approved');
    CREATE TABLE plant_app.qr_code(qr_id INTEGER PRIMARY KEY,plant_id INTEGER,qr_code TEXT,status TEXT,activated_at TIMESTAMPTZ,retired_at TIMESTAMPTZ);
    INSERT INTO plant_app.qr_code(qr_id,plant_id,qr_code,status) VALUES(1,1,'test-qr','assigned');
    INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,origin_type) VALUES
      ('1',1,'staff:owner','Pending Review','{"heightCm":20}','one','subsequent_observation'),
      ('2',1,'staff:owner','Pending Review','{}','two','subsequent_observation');
    INSERT INTO observation_review(id,observation_id,reviewer_subject,decision,comment,created_at) VALUES
      ('a','1','staff:archived-officer','Correction Required','Original correction','2026-11-05T02:30:00.000001Z'),
      ('b','1','staff:officer','Flagged','Check field notes','2026-11-06T02:30:00.123456Z'),
      ('c','1','staff:officer','Approved','<script>stored plain text</script>','2026-11-06T02:30:00.123456Z');`);

  await t.test("role, session and resource checks", async () => {
    for (const role of [null, "admin", "bot", "visitor", "inactive", "temporary"])
      assert.equal((await call('/observations/1/reviews', role)).status, role ? 403 : 401);
    assert.equal((await call('/observations/999/reviews')).status, 404);
    assert.equal((await call('/observations/bad/reviews')).status, 400);
    assert.equal((await call('/observations/1/reviews?limit=101')).status, 400);
  });
  await t.test("full history preserves fields and original timestamps with stable tie ordering", async () => {
    const result = await call('/observations/1/reviews?limit=2');
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.reviews.map(row => row.id), ['c', 'b']);
    assert.equal(result.data.reviews[0].created_at, '2026-11-06T02:30:00.123456Z');
    assert.equal(result.data.reviews[0].comment, '<script>stored plain text</script>');
    assert.deepEqual(Object.keys(result.data.reviews[0]).sort(), ['id','observation_id','decision','reviewer_subject','comment','created_at'].sort());
    assert.equal(result.data.page.has_more, true);
    const cursor = result.data.page.next_cursor;
    const older = await call('/observations/1/reviews?limit=2&cursor=' + cursor);
    assert.deepEqual(older.data.reviews.map(row => row.id), ['a']);
    assert.equal(older.data.reviews[0].reviewer_subject, 'staff:archived-officer');
    assert.equal(older.data.page.next_cursor, null);
    assert.equal((await call('/observations/2/reviews?cursor=' + cursor)).status, 400);
    const empty = await call('/observations/2/reviews');
    assert.deepEqual(empty.data.reviews, []);
    assert.equal(empty.data.page.has_more, false);
  });
  await t.test("correction, owner resubmission and approval retain previous review records", async () => {
    // The owner correction workflow requires a species visible to Botanists.
    await pool.query("UPDATE rbac_species_visibility SET visibility='public' WHERE species_id=1");
    assert.equal((await call('/observations/2/review', 'officer', 'POST', { revision: 1, decision: 'Correction Required', comment: 'Please correct height' })).status, 200);
    assert.equal((await call('/observations/2', 'bot', 'PATCH', { revision: 2, content: { heightCm: 25, healthStatus: "Healthy", lifeStage: "Juvenile", morphology: "Corrected measurement" } })).status, 200);
    assert.equal((await call('/observations/2/submit', 'bot', 'POST', {})).status, 200);
    assert.equal((await call('/observations/2/review', 'officer', 'POST', { revision: 3, decision: 'Approved', comment: 'Verified correction' })).status, 200);
    const result = await call('/observations/2/reviews');
    assert.deepEqual(result.data.reviews.map(row => row.decision), ['Approved', 'Correction Required']);
    assert.deepEqual(result.data.reviews.map(row => row.comment), ['Verified correction', 'Please correct height']);
    assert.ok(result.data.reviews.every(row => row.reviewer_subject === 'staff:officer' && row.created_at));
    const before = (await pool.query('SELECT COUNT(*)::integer AS n FROM business_audit')).rows[0].n;
    await call('/observations/2/reviews');
    assert.equal((await pool.query('SELECT COUNT(*)::integer AS n FROM business_audit')).rows[0].n, before);
  });
  await t.test("concurrent decisions preserve exactly one committed review", async () => {
    await pool.query(`INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key)
      VALUES('3',1,'staff:owner','Pending Review','{}','three')`);
    const results = await Promise.all([
      call('/observations/3/review', 'officer', 'POST', { revision: 1, decision: 'Approved', comment: 'First decision' }),
      call('/observations/3/review', 'officer', 'POST', { revision: 1, decision: 'Flagged', comment: 'Competing decision' }),
    ]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    assert.equal((await call('/observations/3/reviews')).data.reviews.length, 1);
    assert.equal((await pool.query("SELECT COUNT(*)::integer AS n FROM business_audit WHERE target='3'")).rows[0].n, 1);
  });
});
