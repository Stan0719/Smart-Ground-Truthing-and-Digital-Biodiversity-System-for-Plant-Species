"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const { once } = require("node:events");
const sharp = require("sharp");
const { createPlantDatabase } = require("./postgres-fixture.cjs");
const { createPlantApp } = require("../server.js");
const { classifyObservations } = require("../observation-origin.cjs");

const content = heightCm => ({ heightCm, healthStatus: "Healthy", lifeStage: "Mature", morphology: "Leaves" });

async function fixture(t, seedBefore030 = async () => {}) {
  const pool = await createPlantDatabase();
  t.after(() => pool.end());
  const names = readdirSync(join(__dirname, "../migrations"));
  for (const number of ["004", "005", "006", "008", "009", "021", "022", "024", "025", "026", "027", "028", "029"]) {
    const filename = names.find(name => name.startsWith(`${number}-`));
    await pool.query(readFileSync(join(__dirname, "../migrations", filename), "utf8"));
  }
  await pool.query(`CREATE TABLE plant_app.qr_code(qr_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plant_id bigint UNIQUE,qr_code text UNIQUE,status text,assigned_at timestamptz,
    activated_at timestamptz,retired_at timestamptz);
    INSERT INTO family(family_id,family_name) VALUES(1,'Family');
    INSERT INTO genus(genus_id,family_id,genus_name) VALUES(1,1,'Genus');
    INSERT INTO conservation_status(status_id,status_name) VALUES(1,'Status');
    INSERT INTO species(species_id,scientific_name,genus_id,status_id) VALUES(1,'Species',1,1);
    INSERT INTO rbac_species_visibility(species_id,visibility) VALUES(1,'public');
    INSERT INTO plant_record(plant_id,species_id,registered_subject,rbac_status,qr_token)
      VALUES(1,1,'staff:bot','Approved','obs-qr');
    INSERT INTO plant_app.qr_code(plant_id,qr_code,status) VALUES(1,'obs-qr','active');`);
  await seedBefore030(pool);
  await pool.query(readFileSync(join(__dirname, "../migrations/030-observation-edit-review-version-lineage.sql"), "utf8"));
  const tokens = { bot: "b".repeat(64), other: "c".repeat(64), officer: "a".repeat(64) };
  const auth = { session: async token => {
    const key = Object.keys(tokens).find(name => tokens[name] === token);
    return key ? { id: key, role: key === "officer" ? "Conservation Officer" : "Botanist",
      status: "Active", mustChangePassword: false } : null;
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
  async function create(key) {
    const response = await call("/plants/1/observations", "POST", { content: content(10), client_key: key });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response.data.id;
  }
  const versionRows = id => pool.query(`SELECT * FROM observation_submission_version
    WHERE observation_id=$1 ORDER BY version_number`, [id]).then(result => result.rows);
  return { pool, call, create, versionRows };
}

async function seedLegacyObservations(pool) {
  const createdAt = "2024-02-03T04:05:06.123456Z";
  await pool.query(`INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,origin_type,client_key,created_at)
    VALUES
      ('legacy-pending',1,'staff:bot','Pending Review','{"heightCm":10}','subsequent_observation','legacy-pending',$1),
      ('legacy-correction',1,'staff:bot','Correction Required','{"heightCm":11}','subsequent_observation','legacy-correction',$1),
      ('legacy-unknown',1,'staff:bot','Pending Review','{"heightCm":12}','unknown','legacy-unknown',$1),
      ('legacy-no-audit',1,'staff:bot','Pending Review','{"heightCm":13}','unknown','legacy-no-audit',$1),
      ('legacy-approved',1,'staff:bot','Approved','{"heightCm":14}','subsequent_observation','legacy-approved',$1),
      ('legacy-initial',1,'staff:bot','Pending Review','{"heightCm":15}','initial_registration','legacy-initial',$1)`, [createdAt]);
  await pool.query(`INSERT INTO business_audit(id,actor_subject,action,target,created_at)
    SELECT 'audit-'||id,owner_subject,'observation_submitted',id,created_at FROM plant_observation
    WHERE id IN ('legacy-pending','legacy-correction','legacy-unknown','legacy-approved','legacy-initial')`);
  await pool.query(`INSERT INTO observation_review(id,observation_id,reviewer_subject,decision,comment)
    VALUES('legacy-correction-decision','legacy-correction','staff:officer','Correction Required','Clarify the height.')`);
  await pool.query(`INSERT INTO plant_submission_receipt(owner_subject,client_key,payload_hash,result)
    VALUES('staff:bot','legacy-initial',repeat('a',64),
      '{"id":"legacy-initial","plant_id":"1","species_id":"1","status":"Pending Review","qr_token":"obs-qr","species_request_id":null}'::jsonb)`);
}

test("migration-captured legacy pending and correction workflows stay versionless and revision-bound", async t => {
  const { pool, call, versionRows } = await fixture(t, seedLegacyObservations);
  assert.equal((await pool.query("SELECT count(*)::int n FROM observation_legacy_review_eligibility")).rows[0].n, 3);

  // A pre-existing pending record may be edited and reviewed without creating
  // a fabricated submission snapshot. The revision remains exact at each step.
  const edit = await call("/observations/legacy-pending", "PATCH", { content: content(20), revision: 1 });
  assert.equal(edit.status, 200, JSON.stringify(edit.data));
  assert.equal(edit.data.status, "Pending Review");
  assert.equal((await call("/observations/legacy-pending/review", "POST",
    { decision: "Correction Required", comment: "Stale.", revision: 1 }, "officer")).status, 409);
  assert.equal((await call("/observations/legacy-pending/review", "POST",
    { decision: "Correction Required", comment: "Self review.", revision: 2 }, "bot")).status, 403);
  assert.equal((await call("/observations/legacy-pending/review", "POST",
    { decision: "Correction Required", comment: "Clarify the height.", revision: 2 }, "officer")).status, 200);
  let evidence = (await pool.query(`SELECT decision,legacy_revision,submission_version_id
    FROM observation_review WHERE observation_id='legacy-pending' ORDER BY created_at DESC LIMIT 1`)).rows[0];
  assert.deepEqual(evidence, { decision: "Correction Required", legacy_revision: 2, submission_version_id: null });
  const correctionDraft = await call("/observations/legacy-pending", "PATCH", { content: content(21), revision: 3 });
  assert.equal(correctionDraft.status, 200, JSON.stringify(correctionDraft.data));
  assert.equal(correctionDraft.data.status, "Draft");
  assert.equal((await call("/observations/legacy-pending/submit", "POST", {})).status, 200);
  assert.equal((await call("/observations/legacy-pending/review", "POST",
    { decision: "Approved", comment: "Verified.", revision: 4 }, "officer")).status, 200);
  assert.equal((await pool.query("SELECT status,revision,origin_type FROM plant_observation WHERE id='legacy-pending'")).rows[0].status, "Approved");
  assert.equal((await versionRows("legacy-pending")).length, 0);

  // A correction already open at migration time is accepted only at the
  // captured revision, then subsequent Officer decisions carry exact revisions.
  assert.equal((await call("/observations/legacy-correction", "PATCH",
    { content: content(22), revision: 1 }, "other")).status, 403);
  const draft = await call("/observations/legacy-correction", "PATCH", { content: content(22), revision: 1 });
  assert.equal(draft.status, 200, JSON.stringify(draft.data));
  assert.equal((await call("/observations/legacy-correction/submit", "POST", {})).status, 200);
  assert.equal((await call("/observations/legacy-correction/review", "POST",
    { decision: "Rejected", comment: "Evidence is insufficient.", revision: 2 }, "officer")).status, 200);
  evidence = (await pool.query(`SELECT decision,legacy_revision,submission_version_id
    FROM observation_review WHERE observation_id='legacy-correction' ORDER BY created_at DESC LIMIT 1`)).rows[0];
  assert.deepEqual(evidence, { decision: "Rejected", legacy_revision: 2, submission_version_id: null });
  assert.equal((await versionRows("legacy-correction")).length, 0);

  // Unknown is not upgraded to subsequent: only the migration-captured
  // versionless workflow works. An unknown record without audit evidence fails.
  assert.equal((await call("/observations/legacy-unknown/review", "POST",
    { decision: "Rejected", comment: "Not supported.", revision: 1 }, "officer")).status, 200);
  assert.equal((await pool.query("SELECT origin_type FROM plant_observation WHERE id='legacy-unknown'")).rows[0].origin_type, "unknown");
  assert.equal((await call("/observations/legacy-no-audit/review", "POST",
    { decision: "Rejected", comment: "No evidence.", revision: 1 }, "officer")).status, 409);
  assert.equal((await call("/observations/legacy-no-audit/submit", "POST", {})).status, 409);

  // Approved history remains untouched and is not enrolled as a review item.
  assert.equal((await call("/observations/legacy-approved/submit", "POST", {})).status, 409);
  assert.equal((await pool.query("SELECT status FROM plant_observation WHERE id='legacy-approved'")).rows[0].status, "Approved");
  assert.equal((await versionRows("legacy-approved")).length, 0);
});

async function useMicrosecondReviewTimestamp(pool, table) {
  if (!new Set(["observation_review", "observation_edit_event"]).has(table)) throw Error("Unsupported review table.");
  await pool.query(`CREATE FUNCTION plant_app.force_review_microseconds() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN NEW.created_at := '2026-11-16 12:34:56.123456+00'::timestamptz; RETURN NEW; END $$;
    CREATE TRIGGER aaa_force_review_microseconds BEFORE INSERT ON plant_app.${table}
      FOR EACH ROW EXECUTE FUNCTION plant_app.force_review_microseconds()`);
}

async function assertExactReviewTimestamp(pool, observationId, reviewTable, versionTable, reviewIdColumn) {
  const exact = (await pool.query(`SELECT
      r.created_at AS parsed_review_at,
      to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US') AS review_ts,
      to_char(v.reviewed_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US') AS version_ts
    FROM plant_app.${reviewTable} r JOIN plant_app.${versionTable} v
      ON v.id=r.submission_version_id
    WHERE r.observation_id=$1`, [observationId])).rows[0];
  assert.deepEqual({ review_ts: exact.review_ts, version_ts: exact.version_ts }, {
    review_ts: "2026-11-16 12:34:56.123456",
    version_ts: "2026-11-16 12:34:56.123456",
  }, `${reviewIdColumn} must be copied with PostgreSQL microsecond precision`);
  assert.equal(exact.parsed_review_at.toISOString(), "2026-11-16T12:34:56.123Z",
    "the isolated Node database client exposes timestamptz as a millisecond-precision Date");
}

test("original submission snapshots photos, supersedes repeated pending edits, and approves the latest version", async t => {
  const { pool, call, create, versionRows } = await fixture(t);
  const id = await create("original-one");
  await pool.query(`INSERT INTO plant_asset(id,plant_id,owner_subject,client_key,observation_id,approved,content_type,content,created_at)
    VALUES('photo-b',1,'staff:bot','photo-b',$1,FALSE,'image/jpeg',decode('02','hex'),CURRENT_TIMESTAMP - INTERVAL '1 second'),
      ('photo-a',1,'staff:bot','photo-a',$1,FALSE,'image/jpeg',decode('01','hex'),CURRENT_TIMESTAMP)`, [id]);
  const submitted = await call(`/observations/${id}/submit`, "POST", {});
  assert.equal(submitted.status, 200, JSON.stringify(submitted.data));
  let versions = await versionRows(id);
  assert.equal(versions.length, 1);
  assert.equal(versions[0].submission_type, "original");
  assert.deepEqual(versions[0].photo_refs, ["photo-b", "photo-a"]);
  assert.deepEqual((await call(`/observations/${id}/submit`, "POST", {})).data, { submitted: true });
  assert.equal((await versionRows(id)).length, 1, "Pending Review retry must not create another version");
  const edited = await call(`/observations/${id}`, "PATCH", { content: content(11), revision: 1 });
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  versions = await versionRows(id);
  assert.deepEqual(versions.map(row => row.status), ["Superseded", "Pending Review"]);
  assert.deepEqual(versions.map(row => row.content.heightCm), [10, 11]);
  assert.equal((await call(`/observations/${id}/review`, "POST",
    { decision: "Approved", comment: "Stale", revision: 1 }, "officer")).status, 409);
  const secondEdit = await call(`/observations/${id}`, "PATCH", { content: content(12), revision: 2 });
  assert.equal(secondEdit.status, 200, JSON.stringify(secondEdit.data));
  versions = await versionRows(id);
  assert.deepEqual(versions.map(row => row.status), ["Superseded", "Superseded", "Pending Review"]);
  const review = await call(`/observations/${id}/review`, "POST",
    { decision: "Approved", comment: "Verified", revision: 3 }, "officer");
  assert.equal(review.status, 200, JSON.stringify(review.data));
  versions = await versionRows(id);
  assert.equal(versions[2].status, "Approved");
  const evidence = (await pool.query("SELECT * FROM observation_review WHERE observation_id=$1", [id])).rows[0];
  assert.equal(evidence.submission_version_id, versions[2].id);
  assert.equal(versions[2].reviewed_at.toISOString(), evidence.created_at.toISOString());
  assert.equal((await pool.query("SELECT status FROM plant_observation WHERE id=$1", [id])).rows[0].status, "Approved");
  await pool.query("UPDATE plant_asset SET observation_id=NULL,approved=FALSE WHERE id='photo-b'");
  await assert.rejects(pool.query("DELETE FROM plant_asset WHERE id='photo-b'"), { code: "55000" });
  assert.equal((await pool.query(`SELECT encode(content,'hex') AS bytes FROM plant_asset WHERE id='photo-b'`)).rows[0].bytes, "02");
});

test("original correction retains exact review lineage over repeated resubmissions", async t => {
  const { pool, call, create, versionRows } = await fixture(t);
  const id = await create("correct-original");
  assert.equal((await call(`/observations/${id}/submit`, "POST", {})).status, 200);
  const correct = async (revision, height) => {
    const officer = await call(`/observations/${id}/review`, "POST",
      { decision: "Correction Required", comment: `Clarify ${height}`, revision }, "officer");
    assert.equal(officer.status, 200, JSON.stringify(officer.data));
    const blockedDirect = await call(`/observations/${id}/submit`, "POST", {});
    assert.equal(blockedDirect.status, 409);
    const denied = await call(`/observations/${id}`, "PATCH", { content: content(height), revision: revision + 1 }, "other");
    assert.equal(denied.status, 403);
    const draft = await call(`/observations/${id}`, "PATCH", { content: content(height), revision: revision + 1 });
    assert.equal(draft.status, 200, JSON.stringify(draft.data));
    const pending = await call(`/observations/${id}/submit`, "POST", {});
    assert.equal(pending.status, 200, JSON.stringify(pending.data));
    const locked = await call(`/observations/${id}`, "PATCH", { content: content(height + 1), revision: revision + 2 });
    assert.equal(locked.status, 409);
  };
  await correct(1, 11);
  let versions = await versionRows(id);
  assert.deepEqual(versions.map(row => row.status), ["Superseded", "Pending Review"]);
  assert.equal(versions[1].based_on_version_id, versions[0].id);
  const firstReview = (await pool.query("SELECT id FROM observation_review WHERE submission_version_id=$1", [versions[0].id])).rows[0];
  assert.equal(versions[1].correction_review_id, firstReview.id);
  await correct(3, 12);
  versions = await versionRows(id);
  assert.deepEqual(versions.map(row => row.status), ["Superseded", "Superseded", "Pending Review"]);
  assert.deepEqual(versions.map(row => row.content.heightCm), [10, 11, 12]);
  const secondReview = (await pool.query("SELECT id FROM observation_review WHERE submission_version_id=$1", [versions[1].id])).rows[0];
  assert.equal(versions[2].correction_review_id, secondReview.id);
  assert.notEqual(secondReview.id, firstReview.id);
  const approved = await call(`/observations/${id}/review`, "POST",
    { decision: "Approved", comment: "Accepted", revision: 5 }, "officer");
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  assert.equal((await versionRows(id))[2].status, "Approved");
});

test("rejection is version-local and a failed approval rolls back review evidence", async t => {
  const { pool, call, create, versionRows } = await fixture(t);
  const rejectedId = await create("reject-original");
  await call(`/observations/${rejectedId}/submit`, "POST", {});
  const rejected = await call(`/observations/${rejectedId}/review`, "POST",
    { decision: "Rejected", comment: "Insufficient evidence", revision: 1 }, "officer");
  assert.equal(rejected.status, 200, JSON.stringify(rejected.data));
  assert.equal((await versionRows(rejectedId))[0].status, "Rejected");
  assert.equal((await call(`/observations/${rejectedId}`, "PATCH", { content: content(11), revision: 2 })).status, 409);
  const pendingId = await create("rollback-original");
  await call(`/observations/${pendingId}/submit`, "POST", {});
  await pool.query("UPDATE plant_app.qr_code SET plant_id=NULL WHERE qr_code='obs-qr'");
  const failed = await call(`/observations/${pendingId}/review`, "POST",
    { decision: "Approved", comment: "Verified", revision: 1 }, "officer");
  assert.equal(failed.status, 409);
  assert.equal((await versionRows(pendingId))[0].status, "Pending Review");
  assert.equal((await pool.query("SELECT count(*)::int n FROM observation_review WHERE observation_id=$1", [pendingId])).rows[0].n, 0);
  assert.equal((await pool.query("SELECT status FROM plant_observation WHERE id=$1", [pendingId])).rows[0].status, "Pending Review");
});

test("verified initial registration stays unversioned; raw or contradictory origin fails closed", async t => {
  const { pool, call, versionRows } = await fixture(t);
  await pool.query(`INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,origin_type)
    VALUES('initial-obs',1,'staff:bot','Draft',$1,'initial-key','initial_registration'),
      ('unknown-obs',1,'staff:bot','Draft',$1,'unknown-key','unknown')`, [JSON.stringify(content(10))]);
  const validInitialReceipt = { id: "initial-obs", plant_id: "1", species_id: "1", status: "Pending Review",
    qr_token: "obs-qr", species_request_id: null };
  await pool.query(`INSERT INTO plant_submission_receipt(owner_subject,client_key,payload_hash,result)
    VALUES('staff:bot','initial-key',repeat('a',64),$1::jsonb)`, [JSON.stringify(validInitialReceipt)]);
  assert.equal((await call("/observations/initial-obs/submit", "POST", {})).status, 200);
  assert.equal((await versionRows("initial-obs")).length, 0);
  const reviewed = await call("/observations/initial-obs/review", "POST",
    { decision: "Approved", comment: "Verified", revision: 1 }, "officer");
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.data));
  assert.equal((await pool.query("SELECT submission_version_id FROM observation_review WHERE observation_id='initial-obs'"))
    .rows[0].submission_version_id, null);
  assert.equal((await call("/observations/initial-obs/submit", "POST", {})).status, 409);
  assert.equal((await call("/observations/unknown-obs/submit", "POST", {})).status, 409);
  assert.equal((await pool.query("SELECT status FROM plant_observation WHERE id='unknown-obs'")).rows[0].status, "Draft");
  await pool.query(`INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,origin_type)
    VALUES('legacy-pending',1,'staff:bot','Pending Review',$1,'legacy-pending','subsequent_observation')`,
  [JSON.stringify(content(10))]);
  assert.equal((await call("/observations/legacy-pending/review", "POST",
    { decision: "Approved", comment: "Cannot infer version", revision: 1 }, "officer")).status, 409);
  assert.equal((await pool.query("SELECT count(*)::int n FROM observation_review WHERE observation_id='legacy-pending'"))
    .rows[0].n, 0);
  await pool.query(`INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,origin_type)
    VALUES('other-initial',1,'staff:bot','Pending Review',$1,'other-initial','initial_registration')`,
  [JSON.stringify(content(10))]);
  await pool.query(`INSERT INTO plant_submission_receipt(owner_subject,client_key,payload_hash,result)
    VALUES('staff:bot','other-receipt',repeat('b',64),$1::jsonb)`, [JSON.stringify({ ...validInitialReceipt,
    id: "legacy-pending", client_key: "legacy-pending" })]);
  assert.equal((await call("/observations/other-initial/review", "POST",
    { decision: "Approved", comment: "Contradictory", revision: 1 }, "officer")).status, 409);
});

test("original review decisions copy persisted microsecond timestamps without JavaScript round-tripping", async t => {
  for (const decision of ["Approved", "Rejected", "Correction Required"]) {
    await t.test(decision, async t => {
      const { pool, call, create } = await fixture(t);
      const id = await create(`microsecond-original-${decision}`);
      assert.equal((await call(`/observations/${id}/submit`, "POST", {})).status, 200);
      await useMicrosecondReviewTimestamp(pool, "observation_review");
      const result = await call(`/observations/${id}/review`, "POST",
        { decision, comment: `Decision: ${decision}`, revision: 1 }, "officer");
      assert.equal(result.status, 200, JSON.stringify(result.data));
      await assertExactReviewTimestamp(pool, id, "observation_review", "observation_submission_version", "observation_id");
      assert.equal((await pool.query("SELECT status FROM observation_submission_version WHERE observation_id=$1", [id])).rows[0].status, decision);
    });
  }
});

test("original review evidence mismatch rolls back the review and version transition", async t => {
  const { pool, call, create, versionRows } = await fixture(t);
  const id = await create("mismatched-original-review");
  assert.equal((await call(`/observations/${id}/submit`, "POST", {})).status, 200);
  await pool.query(`CREATE FUNCTION plant_app.alter_review_officer() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN NEW.reviewer_subject := 'staff:other-officer'; RETURN NEW; END $$;
    CREATE TRIGGER aaa_alter_review_officer BEFORE INSERT ON plant_app.observation_review
      FOR EACH ROW EXECUTE FUNCTION plant_app.alter_review_officer()`);
  const result = await call(`/observations/${id}/review`, "POST",
    { decision: "Approved", comment: "Should not persist", revision: 1 }, "officer");
  assert.equal(result.status, 409, JSON.stringify(result.data));
  assert.equal((await pool.query("SELECT count(*)::int n FROM observation_review WHERE observation_id=$1", [id])).rows[0].n, 0);
  assert.equal((await versionRows(id))[0].status, "Pending Review");
  assert.equal((await pool.query("SELECT status FROM plant_observation WHERE id=$1", [id])).rows[0].status, "Pending Review");
});

test("terminal and correction-required submissions return conflicts without changing records", async t => {
  const { pool, call, create, versionRows } = await fixture(t);
  const rejectedId = await create("terminal-rejected");
  await call(`/observations/${rejectedId}/submit`, "POST", {});
  await call(`/observations/${rejectedId}/review`, "POST", { decision: "Rejected", comment: "No", revision: 1 }, "officer");
  const beforeRejected = (await versionRows(rejectedId)).map(({ id, status }) => ({ id, status }));
  assert.equal((await call(`/observations/${rejectedId}/submit`, "POST", {})).status, 409);
  assert.deepEqual((await versionRows(rejectedId)).map(({ id, status }) => ({ id, status })), beforeRejected);

  const withdrawnId = await create("terminal-withdrawn");
  await call(`/observations/${withdrawnId}/submit`, "POST", {});
  await call(`/observations/${withdrawnId}/withdraw`, "POST", {});
  assert.equal((await call(`/observations/${withdrawnId}/submit`, "POST", {})).status, 409);
  assert.equal((await pool.query("SELECT status FROM plant_observation WHERE id=$1", [withdrawnId])).rows[0].status, "Withdrawn");
  assert.equal((await versionRows(withdrawnId))[0].status, "Withdrawn");
});

test("withdrawal closes the exact active version and preserves prior review and photo evidence", async t => {
  const { pool, call, create, versionRows } = await fixture(t);
  const id = await create("withdraw-correction-version");
  await pool.query(`INSERT INTO plant_asset(id,plant_id,owner_subject,client_key,observation_id,approved,content_type,content)
    VALUES('withdraw-photo',1,'staff:bot','withdraw-photo',$1,FALSE,'image/jpeg',decode('beef','hex'))`, [id]);
  assert.equal((await call(`/observations/${id}/submit`, "POST", {})).status, 200);
  assert.equal((await call(`/observations/${id}/review`, "POST", {
    decision: "Correction Required", comment: "Retain this feedback", revision: 1,
  }, "officer")).status, 200);
  const before = await versionRows(id);
  assert.equal(before[0].status, "Correction Required");
  const withdrawn = await call(`/observations/${id}/withdraw`, "POST", {});
  assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn.data));
  assert.equal(withdrawn.data.observation.status, "Withdrawn");
  assert.equal((await call(`/observations/${id}/withdraw`, "POST", {})).status, 409);
  const after = await versionRows(id);
  assert.equal(after.length, 1);
  assert.equal(after[0].id, before[0].id);
  assert.equal(after[0].status, "Withdrawn");
  assert.equal(after[0].review_comment, "Retain this feedback");
  assert.deepEqual(after[0].photo_refs, ["withdraw-photo"]);
  assert.equal((await pool.query("SELECT encode(content,'hex') AS bytes FROM plant_asset WHERE id='withdraw-photo'"))
    .rows[0].bytes, "beef");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM observation_review WHERE observation_id=$1", [id])).rows[0].n, 1);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM business_audit
    WHERE target=$1 AND action='observation_submission_withdrawn'`, [id])).rows[0].n, 1);
});

test("stale original version prevents withdrawal without changing canonical status", async t => {
  const { pool, call, create, versionRows } = await fixture(t);
  const id = await create("withdraw-stale-version");
  assert.equal((await call(`/observations/${id}/submit`, "POST", {})).status, 200);
  await pool.query("UPDATE plant_observation SET content=$1 WHERE id=$2", [content(99), id]);
  assert.equal((await call(`/observations/${id}/withdraw`, "POST", {})).status, 409);
  assert.equal((await pool.query("SELECT status FROM plant_observation WHERE id=$1", [id])).rows[0].status, "Pending Review");
  assert.equal((await versionRows(id))[0].status, "Pending Review");
});

test("failed canonical withdrawal rolls back its version transition and audit", async t => {
  const { pool, call, create, versionRows } = await fixture(t);
  const id = await create("withdraw-rollback-version");
  assert.equal((await call(`/observations/${id}/submit`, "POST", {})).status, 200);
  await pool.query(`CREATE FUNCTION plant_app.reject_test_canonical_withdrawal() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.status='Withdrawn' THEN RAISE EXCEPTION 'isolated withdrawal failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_test_canonical_withdrawal BEFORE UPDATE ON plant_observation
      FOR EACH ROW EXECUTE FUNCTION plant_app.reject_test_canonical_withdrawal()`);
  assert.equal((await call(`/observations/${id}/withdraw`, "POST", {})).status, 503);
  assert.equal((await pool.query("SELECT status FROM plant_observation WHERE id=$1", [id])).rows[0].status, "Pending Review");
  assert.equal((await versionRows(id))[0].status, "Pending Review");
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM business_audit
    WHERE target=$1 AND action='observation_submission_withdrawn'`, [id])).rows[0].n, 0);
});

test("snapshot insertion failure rolls back canonical submission and leaves assets intact", async t => {
  const { pool, call, create, versionRows } = await fixture(t);
  const id = await create("snapshot-rollback");
  await pool.query(`INSERT INTO plant_asset(id,plant_id,owner_subject,client_key,observation_id,approved,content_type,content)
    VALUES('rollback-photo',1,'staff:bot','rollback-photo',$1,FALSE,'image/jpeg',decode('09','hex'))`, [id]);
  await pool.query(`CREATE FUNCTION plant_app.reject_test_snapshot_photo() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Isolated test failure'; END $$;
    CREATE TRIGGER reject_test_snapshot_photo BEFORE INSERT ON observation_submission_photo
      FOR EACH ROW EXECUTE FUNCTION plant_app.reject_test_snapshot_photo()`);
  const failed = await call(`/observations/${id}/submit`, "POST", {});
  assert.equal(failed.status, 503);
  assert.equal((await pool.query("SELECT status FROM plant_observation WHERE id=$1", [id])).rows[0].status, "Draft");
  assert.equal((await versionRows(id)).length, 0);
  assert.equal((await pool.query("SELECT encode(content,'hex') AS bytes FROM plant_asset WHERE id='rollback-photo'"))
    .rows[0].bytes, "09");
  await pool.query("DROP TRIGGER reject_test_snapshot_photo ON observation_submission_photo; DROP FUNCTION plant_app.reject_test_snapshot_photo()");
  assert.equal((await call(`/observations/${id}/submit`, "POST", {})).status, 200);
  assert.equal((await versionRows(id)).length, 1);
});

test("the existing upload route stages owned photos before submission and rejects late uploads", async t => {
  const { call, create, versionRows } = await fixture(t);
  const id = await create("upload-original");
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "green" } })
    .png().toBuffer();
  const upload = key => call("/assets", "POST", { plant_id: 1, observation_id: id,
    client_key: key, content_type: "image/png", base64: bytes.toString("base64") });
  const staged = await upload("before-submit");
  assert.equal(staged.status, 201, JSON.stringify(staged.data));
  assert.equal((await call(`/observations/${id}/submit`, "POST", {})).status, 200);
  assert.deepEqual((await versionRows(id))[0].photo_refs, [staged.data.id]);
  assert.equal((await upload("after-submit")).status, 409);
});

test("version-aware subsequent provenance requires exact creation audit and consistent Approved content", async t => {
  const { pool, call, create } = await fixture(t);
  const id = await create("provenance-one");
  const later = await create("provenance-later");
  const origin = async target => {
    const row = (await pool.query("SELECT * FROM plant_observation WHERE id=$1", [target])).rows[0];
    return (await classifyObservations(pool, [row]))[0].origin_type;
  };
  assert.equal(await origin(id), "subsequent_observation");
  assert.equal(await origin(later), "subsequent_observation");
  const created = (await pool.query(`SELECT id,created_at FROM business_audit
    WHERE action='observation_submitted' AND target=$1 ORDER BY created_at LIMIT 1`, [id])).rows[0];
  await pool.query(`INSERT INTO business_audit(id,actor_subject,action,target,created_at)
    VALUES($1,'staff:bot','observation_submitted',$2,$3)`, [`${id}-duplicate`, id, created.created_at]);
  assert.equal(await origin(id), "unknown", "duplicate creation evidence fails closed");
  await pool.query("DELETE FROM business_audit WHERE id=$1", [`${id}-duplicate`]);
  for (const [actor, target, offset] of [
    ["staff:other", id, "0 seconds"], ["staff:bot", later, "0 seconds"],
    ["staff:bot", id, "1 second"],
  ]) {
    await pool.query("UPDATE business_audit SET actor_subject=$1,target=$2,created_at=$3::timestamptz + $4::interval WHERE id=$5",
      [actor, target, created.created_at, offset, created.id]);
    assert.equal(await origin(id), "unknown", "mismatched creation evidence fails closed");
  }
  await pool.query("UPDATE business_audit SET actor_subject='staff:bot',target=$1,created_at=$2 WHERE id=$3",
    [id, created.created_at, created.id]);
  assert.equal(await origin(id), "subsequent_observation");
  await pool.query(`INSERT INTO plant_submission_receipt(owner_subject,client_key,payload_hash,result)
    SELECT owner_subject,client_key,repeat('a',64),jsonb_build_object('id',id,'plant_id',plant_id::text,
      'species_id','1','status','Pending Review','qr_token','obs-qr','species_request_id',NULL)
    FROM plant_observation WHERE id=$1`, [id]);
  assert.equal(await origin(id), "unknown", "an exact initial-registration receipt contradicts the subsequent label");
  assert.equal(await origin(later), "subsequent_observation", "a later Observation is not the receipt's initial target");
  await pool.query("DELETE FROM plant_submission_receipt WHERE client_key='provenance-one'");
  assert.equal((await call(`/observations/${id}/submit`, "POST", {})).status, 200);
  await pool.query("DELETE FROM business_audit WHERE id=$1", [created.id]);
  assert.equal(await origin(id), "unknown", "missing creation evidence fails closed");
  assert.equal((await call(`/observations/${id}/withdraw`, "POST", {})).status, 409,
    "the mobile withdrawal route must not trust the raw subsequent label");
  assert.equal((await pool.query("SELECT status FROM plant_observation WHERE id=$1", [id])).rows[0].status, "Pending Review");
  assert.equal(await origin(later), "subsequent_observation", "other Observation on the Plant remains verified");

  assert.equal((await call(`/observations/${later}/submit`, "POST", {})).status, 200);
  assert.equal((await call(`/observations/${later}/review`, "POST", {
    decision: "Approved", comment: "Verified", revision: 1,
  }, "officer")).status, 200);
  assert.equal(await origin(later), "subsequent_observation");
  await pool.query("UPDATE plant_observation SET content=$1 WHERE id=$2", [content(99), later]);
  assert.equal(await origin(later), "unknown", "Approved version content mismatch fails closed");
});
