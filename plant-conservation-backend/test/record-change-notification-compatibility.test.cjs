"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { once } = require("node:events"), { readFileSync } = require("node:fs"), { join } = require("node:path");
const sharp = require("sharp");
const { createPlantDatabase, installRecordChangeNotifications } = require("./postgres-fixture.cjs");
const { seedRegistrationReceipt } = require("./registration-provenance-fixture.cjs");
const { createPlantApp } = require("../server.js");

async function fixture(t, state = "ready") {
  const pool = await createPlantDatabase(); t.after(() => pool.end());
  const migrate = name => pool.query(readFileSync(join(__dirname, "../migrations", name), "utf8"));
  for (const name of ["004-species-requests.sql", "006-atomic-plant-submissions.sql", "008-record-change-submissions.sql",
    "009-record-version-history.sql", "016-species-request-content-revision.sql", "017-species-review-cycle.sql", "022-cancel-edit-requests.sql", "024-record-change-review-events.sql"])
    await migrate(name);
  if (state !== "missing") {
    await migrate("011-botanist-notification-history.sql");
    if (state === "legacy") await migrate("023-record-change-correction-notifications.sql");
    else await installRecordChangeNotifications(pool);
  }
  const photo = await sharp({ create: { width: 2, height: 2, channels: 3, background: "green" } }).jpeg().toBuffer();
  await pool.query(`INSERT INTO species(scientific_name,common_name,rbac_data) VALUES('Species A','Common A','{"approvalStatus":"Approved"}');
    INSERT INTO rbac_species_visibility VALUES(1,'public');
    INSERT INTO plant_record(plant_id,species_id,registered_subject,scientific_name,rbac_status,qr_token)
      VALUES(1,1,'staff:bot','Plant A','Approved','notification-qr');
    INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key)
      VALUES('11111111-1111-4111-8111-111111111111',1,'staff:bot','Approved',
        '{"heightCm":10,"healthStatus":"Healthy","lifeStage":"Mature","morphology":"Original","latitude":4,"longitude":113}','registration');
    CREATE TABLE plant_app.qr_code(qr_id integer PRIMARY KEY,plant_id integer,qr_code text,status text,
      assigned_at timestamptz,activated_at timestamptz,retired_at timestamptz);
    INSERT INTO plant_app.qr_code VALUES(1,1,'notification-qr','active',NULL,NULL,NULL)`);
  await seedRegistrationReceipt(pool, "11111111-1111-4111-8111-111111111111");
  await pool.query(`INSERT INTO species_request_submission(owner_subject,client_key,payload_hash,scientific_name,common_name,
    genus_name,family_name,conservation_status,description,habitat,photo,request_status,approved_species_id)
    VALUES('staff:bot','species','hash','Species A','Common A','Genus A','Family A','Least Concern','Original','Forest',$1,'Approved',1)`, [photo]);
  const roles = { bot: "Botanist", other: "Botanist", officer: "Conservation Officer", second: "Conservation Officer" };
  const tokens = Object.fromEntries(Object.keys(roles).map((key, i) => [key, String(i + 1).repeat(64)]));
  const server = createPlantApp({ pool, origins: new Set(), auth: { session: async token => {
    const key = Object.keys(tokens).find(key => tokens[key] === token);
    return key ? { id: key, role: roles[key], status: "Active", mustChangePassword: false } : null;
  }, event: async () => {} } }).listen(0, "127.0.0.1");
  await once(server, "listening"); t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  async function call(path, role = "bot", body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${tokens[role]}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
  }
  let serial = 0;
  async function proposal(kind) {
    const proposed = kind === "plant" ? { species_id: 1, scientific_name: "Plant A", content: {
      heightCm: 20, healthStatus: "Healthy", lifeStage: "Mature", morphology: "Updated", latitude: 4, longitude: 113,
    } } : { scientific_name: "Species A", common_name: "Common A", genus_name: "Genus A", family_name: "Family A",
      conservation_status: "Least Concern", description: "Updated", habitat: "Forest" };
    const result = await call("/record-changes", "bot", { kind, target_id: 1, client_key: `${kind}-${++serial}`, proposed });
    assert.equal(result.status, 201, JSON.stringify(result));
    return (await pool.query("SELECT * FROM record_change_submission WHERE id=$1", [result.data.change.id])).rows[0];
  }
  const decide = (change, decision, role = "officer") => call(`/record-changes/${change.id}/review`, role,
    { decision, comment: "Officer feedback", revision: change.revision ?? 1 });
  async function snapshot() {
    const result = {};
    for (const table of ["species", "species_request_submission", "plant_record", "plant_observation", "plant_asset",
      "record_change_submission", "record_version_history", "record_change_review_event", "business_audit"])
      result[table] = (await pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
    return result;
  }
  return { pool, call, proposal, decide, snapshot, migrate };
}

for (const kind of ["plant", "species"]) for (const decision of ["Approved", "Rejected", "Correction Required"])
  test(`${kind} ${decision}: real migrated notification is atomic, exact, owner-scoped and deduplicated`, async t => {
    const f = await fixture(t), change = await f.proposal(kind);
    const deniedBefore = await f.snapshot();
    assert.equal((await f.decide(change, decision, "bot")).status, 403);
    assert.deepEqual(await f.snapshot(), deniedBefore);
    const outcomes = await Promise.all([f.decide(change, decision), f.decide(change, decision, "second")]);
    assert.deepEqual(outcomes.map(row => row.status).sort(), [200, 409]);
    assert.equal((await f.decide(change, decision)).status, 409);
    const notices = (await f.pool.query("SELECT * FROM botanist_notification WHERE metadata->>'changeId'=$1", [change.id])).rows;
    assert.equal(notices.length, 1);
    const notice = notices[0], suffix = decision === "Correction Required" ? "correction" : decision.toLowerCase();
    assert.equal(notice.type, `record_change_${suffix}`); assert.equal(notice.recipient_subject, "staff:bot");
    assert.equal(notice.source_key, `record-change-${suffix}:${change.id}:${change.revision ?? 1}`);
    assert.equal(notice.metadata.recordKind, kind); assert.equal(notice.metadata.entityType, "record_change");
    assert.equal(notice.metadata.targetId, String(kind === "plant" ? change.plant_id : change.base_snapshot.request_id));
    assert.equal(notice.read_at, null);
    const own = await f.call("/notifications"), other = await f.call("/notifications", "other");
    assert.equal(own.status, 200); assert.equal(other.status, 200);
    const projected = own.data.notifications.find(row => row.id === notice.id);
    assert.equal(projected.changeId, change.id); assert.equal(projected.recordKind, kind);
    assert.ok(!other.data.notifications.some(row => row.id === notice.id));
    const history = (await f.pool.query("SELECT status,review_comment FROM record_version_history WHERE change_id=$1", [change.id])).rows;
    assert.ok(history.some(row => row.status === decision && row.review_comment === "Officer feedback"));
    assert.equal((await f.pool.query("SELECT status FROM record_change_submission WHERE id=$1", [change.id])).rows[0].status, decision);
  });

for (const state of ["missing", "legacy"]) for (const kind of ["plant", "species"])
  test(`${kind}: ${state} notification schema fails clearly with no review side effects`, async t => {
    const f = await fixture(t, state), change = await f.proposal(kind), before = await f.snapshot();
    for (const decision of ["Approved", "Rejected", "Correction Required"]) {
      const response = await f.decide(change, decision);
      assert.equal(response.status, 503); assert.equal(response.data.code, "RECORD_CHANGE_NOTIFICATION_SCHEMA_REQUIRED");
      assert.match(response.data.error, /011-botanist-notification-history\.sql/);
      assert.match(response.data.error, /030-record-change-review-notifications\.sql/);
      assert.match(response.data.error, /No review was saved/); assert.deepEqual(await f.snapshot(), before);
    }
    await installRecordChangeNotifications(f.pool);
    assert.equal((await f.decide(change, "Approved")).status, 200);
  });

test("notification insert failure rolls back the actual approval; retry persists one notification", async t => {
  const f = await fixture(t), change = await f.proposal("plant");
  await f.pool.query(`CREATE FUNCTION fail_fixture_notification() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'synthetic notification failure' USING ERRCODE='23514'; END $$;
    CREATE TRIGGER fail_fixture_notification BEFORE INSERT ON botanist_notification FOR EACH ROW EXECUTE FUNCTION fail_fixture_notification()`);
  const before = await f.snapshot(); assert.equal((await f.decide(change, "Approved")).status, 400);
  assert.deepEqual(await f.snapshot(), before);
  assert.equal((await f.pool.query("SELECT count(*)::int AS n FROM botanist_notification")).rows[0].n, 0);
  await f.pool.query("DROP TRIGGER fail_fixture_notification ON botanist_notification");
  assert.equal((await f.decide(change, "Approved")).status, 200);
  assert.equal((await f.pool.query("SELECT count(*)::int AS n FROM botanist_notification")).rows[0].n, 1);
});

for (const state of ["missing-column", "disabled-rls"])
  test(`${state}: schema drift is rejected before review writes`, async t => {
    const f = await fixture(t), change = await f.proposal("plant"), before = await f.snapshot();
    await f.pool.query(state === "missing-column"
      ? "ALTER TABLE botanist_notification DROP COLUMN read_at"
      : "ALTER TABLE botanist_notification DISABLE ROW LEVEL SECURITY");
    const response = await f.decide(change, "Approved");
    assert.equal(response.status, 503); assert.equal(response.data.code, "RECORD_CHANGE_NOTIFICATION_SCHEMA_REQUIRED");
    assert.deepEqual(await f.snapshot(), before);
  });

test("migration preserves prior notifications/read state, enforces constraints and detects lost deduplication", async t => {
  const f = await fixture(t), change = await f.proposal("species");
  assert.equal((await f.decide(change, "Rejected")).status, 200);
  await f.pool.query("UPDATE botanist_notification SET read_at=CURRENT_TIMESTAMP");
  const before = (await f.pool.query("SELECT * FROM botanist_notification")).rows;
  await f.migrate("030-record-change-review-notifications.sql");
  assert.deepEqual((await f.pool.query("SELECT * FROM botanist_notification")).rows, before);
  assert.equal((await f.pool.query("SELECT relrowsecurity AS enabled FROM pg_class WHERE oid='botanist_notification'::regclass")).rows[0].enabled, true);
  await assert.rejects(f.pool.query(`INSERT INTO botanist_notification(id,recipient_subject,type,source_key,metadata)
    VALUES('bad','staff:bot','record_change_approved','bad','{"entityType":"other"}')`), { code: "23514" });
  await f.pool.query("ALTER TABLE botanist_notification DROP CONSTRAINT botanist_notification_recipient_subject_source_key_key");
  const next = await f.proposal("plant"), snapshot = await f.snapshot();
  assert.equal((await f.decide(next, "Approved")).data.code, "RECORD_CHANGE_NOTIFICATION_SCHEMA_REQUIRED");
  assert.deepEqual(await f.snapshot(), snapshot);
});

test("subsequent Observation review keeps its existing supported contract without the record-change inbox schema", async t => {
  const f = await fixture(t, "missing");
  const created = await f.call("/plants/1/observations", "bot", { client_key: "unrelated-visit", content: {
    heightCm: 15, healthStatus: "Healthy", lifeStage: "Mature", morphology: "Field visit",
  } });
  assert.equal(created.status, 201, JSON.stringify(created));
  assert.equal((await f.call(`/observations/${created.data.id}/submit`, "bot", {})).status, 200);
  const reviewed = await f.call(`/observations/${created.data.id}/review`, "officer", {
    decision: "Approved", revision: 1, comment: "Field visit verified",
  });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed));
  assert.equal((await f.pool.query("SELECT status FROM plant_observation WHERE id=$1", [created.data.id])).rows[0].status, "Approved");
  assert.equal((await f.pool.query("SELECT to_regclass('plant_app.botanist_notification') AS inbox")).rows[0].inbox, null);
});
