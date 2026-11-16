"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const { once } = require("node:events");
const sharp = require("sharp");
const { createHash } = require("node:crypto");
const { createPlantDatabase } = require("./postgres-fixture.cjs");
const { createPlantApp } = require("../server.js");
const versions = require("../observation-submission-versions.cjs");

const observationId = "11111111-1111-4111-8111-111111111111";
const oldPhotoId = "22222222-2222-4222-8222-222222222222";
const content = morphology => ({ heightCm: 80, healthStatus: "Healthy", lifeStage: "Mature", morphology });

async function fixture(t, { before030 } = {}) {
  const pool = await createPlantDatabase();
  t.after(() => pool.end());
  const names = readdirSync(join(__dirname, "../migrations"));
  for (const number of ["004", "005", "006", "008", "009", "021", "022"]) {
    const file = names.find(name => name.startsWith(`${number}-`));
    await pool.query(readFileSync(join(__dirname, "../migrations", file), "utf8"));
  }
  await pool.query(`CREATE TABLE botanist_notification(id TEXT PRIMARY KEY,recipient_subject TEXT NOT NULL,
    type TEXT NOT NULL CONSTRAINT botanist_notification_type_check CHECK(type IN ('observation_submitted','observation_approved','observation_rejected','correction_requested','sync_failed','sync_completed')),
    source_key TEXT NOT NULL,observation_id TEXT,review_id TEXT,plant_id INTEGER REFERENCES plant_record(plant_id),metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,read_at TIMESTAMPTZ,
    UNIQUE(recipient_subject,source_key),
    CONSTRAINT botanist_notification_check CHECK((type IN ('observation_submitted','observation_approved','observation_rejected','correction_requested') AND observation_id IS NOT NULL) OR (type IN ('sync_failed','sync_completed') AND observation_id IS NULL)))`);
  for (const number of ["023", "024", "025", "026", "027", "028", "029"]) {
    const file = names.find(name => name.startsWith(`${number}-`));
    await pool.query(readFileSync(join(__dirname, "../migrations", file), "utf8"));
  }
  await pool.query(`CREATE TABLE plant_app.qr_code(qr_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plant_id bigint UNIQUE,qr_code text UNIQUE,status text,assigned_at timestamptz,activated_at timestamptz,retired_at timestamptz)`);
  await pool.query("INSERT INTO family(family_id,family_name) VALUES(1,'Family')");
  await pool.query("INSERT INTO genus(genus_id,family_id,genus_name) VALUES(1,1,'Genus')");
  await pool.query("INSERT INTO conservation_status(status_id,status_name) VALUES(1,'Status')");
  await pool.query("INSERT INTO species(species_id,scientific_name,genus_id,status_id) VALUES(1,'Species',1,1)");
  await pool.query("INSERT INTO rbac_species_visibility(species_id,visibility) VALUES(1,'public')");
  await pool.query("INSERT INTO plant_record(plant_id,species_id,registered_subject,rbac_status,qr_token) VALUES(1,1,'staff:owner','Approved','obs-qr')");
  await pool.query("INSERT INTO plant_app.qr_code(plant_id,qr_code,status) VALUES(1,'obs-qr','active')");
  await pool.query(`INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,origin_type)
    VALUES($1,1,'staff:owner','Approved',$2,'approved-observation','subsequent_observation')`,
  [observationId, content("Canonical approved content")]);
  // This fixture represents an Observation created through the subsequent
  // route, whose creation and audit inserts share a PostgreSQL transaction time.
  await pool.query(`INSERT INTO business_audit(id,actor_subject,action,target,created_at)
    SELECT 'fixture-subsequent-created',owner_subject,'observation_submitted',id,created_at
    FROM plant_observation WHERE id=$1`, [observationId]);
  const oldBytes = await sharp({ create: { width: 3, height: 3, channels: 3, background: "green" } }).jpeg().toBuffer();
  await pool.query(`INSERT INTO plant_asset(id,plant_id,owner_subject,client_key,observation_id,approved,content_type,content)
    VALUES($1,1,'staff:owner','old-photo',$2,TRUE,'image/jpeg',$3)`, [oldPhotoId, observationId, oldBytes]);
  if (before030) await before030(pool);
  const migration030 = names.find(name => name.startsWith("030-"));
  await pool.query(readFileSync(join(__dirname, "../migrations", migration030), "utf8"));
  const tokens = { owner: "b".repeat(64), officer: "a".repeat(64), other: "c".repeat(64) };
  const auth = { session: async token => {
    const id = Object.keys(tokens).find(key => tokens[key] === token);
    return id ? { id, role: id === "officer" ? "Conservation Officer" : "Botanist", status: "Active", mustChangePassword: false } : null;
  }, event: async () => {} };
  const server = createPlantApp({ pool, auth, origins: new Set() }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const call = async (path, user, method = "GET", body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { Authorization: `Bearer ${tokens[user]}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  const binary = async (path, user) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      headers: { Authorization: `Bearer ${tokens[user]}` },
    });
    return { status: response.status, contentType: response.headers.get("content-type"), bytes: Buffer.from(await response.arrayBuffer()) };
  };
  const photo = async color => sharp({ create: { width: 3, height: 3, channels: 3, background: color } }).jpeg().toBuffer();
  return { pool, call, photo, binary };
}

async function useMicrosecondReviewTimestamp(pool) {
  await pool.query(`CREATE FUNCTION plant_app.force_edit_review_microseconds() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN NEW.created_at := '2026-11-16 12:34:56.123456+00'::timestamptz; RETURN NEW; END $$;
    CREATE TRIGGER aaa_force_edit_review_microseconds BEFORE INSERT ON plant_app.observation_edit_event
      FOR EACH ROW EXECUTE FUNCTION plant_app.force_edit_review_microseconds()`);
}

async function assertExactEditReviewTimestamp(pool, observationId) {
  const exact = (await pool.query(`SELECT
      e.created_at AS parsed_review_at,
      to_char(e.created_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US') AS review_ts,
      to_char(v.reviewed_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US') AS version_ts
    FROM plant_app.observation_edit_event e JOIN plant_app.observation_submission_version v
      ON v.id=e.submission_version_id
    WHERE e.observation_id=$1 AND e.event_type IN ('approved','rejected','correction_required')`, [observationId])).rows[0];
  assert.deepEqual({ review_ts: exact.review_ts, version_ts: exact.version_ts }, {
    review_ts: "2026-11-16 12:34:56.123456",
    version_ts: "2026-11-16 12:34:56.123456",
  });
  assert.equal(exact.parsed_review_at.toISOString(), "2026-11-16T12:34:56.123Z",
    "the isolated Node database client exposes timestamptz as a millisecond-precision Date");
}

async function insertLegacyInitialEdit(pool, { observationId, requestId, status = "Pending Review", initialBytes,
  proposedContent = content("Legacy proposal"), owner = "staff:owner", includeCorrectionEvent = true }) {
  const clientKey = `legacy-initial-${requestId}`;
  const observationContent = content(`Legacy original ${requestId}`);
  await pool.query(`INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,origin_type)
    VALUES($1,1,$2,'Approved',$3,$4,'initial_registration')`, [observationId, owner, observationContent, clientKey]);
  await pool.query(`INSERT INTO plant_submission_receipt(owner_subject,client_key,payload_hash,result)
    VALUES($1,$2,repeat('b',64),$3::jsonb)`, [owner, clientKey, JSON.stringify({ id: observationId, plant_id: "1", species_id: "1",
    status: "Pending Review", qr_token: "obs-qr", species_request_id: null })]);
  const photoHex = createHash("sha256").update(requestId).digest("hex").slice(0, 32);
  const photoId = `${photoHex.slice(0, 8)}-${photoHex.slice(8, 12)}-${photoHex.slice(12, 16)}-${photoHex.slice(16, 20)}-${photoHex.slice(20)}`;
  await pool.query(`INSERT INTO plant_asset(id,plant_id,owner_subject,client_key,observation_id,approved,content_type,content)
    VALUES($1,1,$2,$3,$4,TRUE,'image/jpeg',$5)`, [photoId, owner, `${requestId}-base`, observationId, initialBytes]);
  const observation = (await pool.query("SELECT content,revision FROM plant_observation WHERE id=$1", [observationId])).rows[0];
  const base = { content: observation.content, revision: observation.revision, photo_ids: [photoId] };
  const fingerprint = createHash("sha256").update(JSON.stringify(base)).digest("hex");
  const proposedPhoto = { content_type: "image/jpeg", base64: initialBytes.toString("base64") };
  await pool.query(`INSERT INTO observation_edit_request
    (id,observation_id,owner_subject,status,revision,version_number,base_revision,base_fingerprint,base_snapshot,
      proposed_content,retained_photo_ids,added_photos,client_key,payload_hash,review_comment,reviewed_by,reviewed_at)
    VALUES($1,$2,$3,$4,1,1,1,$5,$6,$7,$8,$9,$10,repeat('c',64),
      CASE WHEN $4='Correction Required' THEN 'Please correct this legacy request.' ELSE NULL END,
      CASE WHEN $4='Correction Required' THEN 'staff:officer' ELSE NULL END,
      CASE WHEN $4='Correction Required' THEN CURRENT_TIMESTAMP ELSE NULL END)`,
  [requestId, observationId, owner, status, fingerprint, base, proposedContent, [photoId], [proposedPhoto], clientKey]);
  await pool.query(`INSERT INTO observation_version_history(id,observation_id,version_number,owner_subject,content,photo_ids)
    VALUES($1,$2,0,$3,$4,$5) ON CONFLICT(observation_id,version_number) DO NOTHING`,
  [`${requestId}-baseline`, observationId, owner, observationContent, [photoId]]);
  await pool.query(`INSERT INTO observation_edit_event(id,request_id,observation_id,actor_subject,event_type,comment)
    VALUES($1,$2,$3,$4,'submitted','Legacy request created before Migration 030')`,
  [`${requestId}-submitted`, requestId, observationId, owner]);
  if (status === "Correction Required" && includeCorrectionEvent) {
    const decision = (await pool.query(`INSERT INTO observation_edit_event
      (id,request_id,observation_id,actor_subject,event_type,comment)
      VALUES($1,$2,$3,'staff:officer','correction_required','Please correct this legacy request.') RETURNING created_at`,
    [`${requestId}-correction`, requestId, observationId])).rows[0];
    await pool.query("UPDATE observation_edit_request SET reviewed_at=$1 WHERE id=$2", [decision.created_at, requestId]);
  }
  return { photoId, baseContent: observationContent, proposedPhoto };
}

test("approved Observation edit snapshots exact photos and changes public content only after approval", async t => {
  const { pool, call, photo, binary } = await fixture(t);
  const before = (await pool.query("SELECT content,status FROM plant_observation WHERE id=$1", [observationId])).rows[0];
  const addA = await photo("red");
  const addB = await photo("blue");
  const submitted = await call("/observation-edits", "owner", "POST", { observation_id: observationId,
    client_key: "approved-edit-1", content: content("Proposed public content"), photo_ids: [oldPhotoId],
    photos: [addA, addB].map(bytes => ({ content_type: "image/jpeg", base64: bytes.toString("base64") })) });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.data));
  const editId = submitted.data.edit.id;
  assert.deepEqual((await pool.query("SELECT content,status FROM plant_observation WHERE id=$1", [observationId])).rows[0], before);
  const versions = (await pool.query(`SELECT * FROM observation_submission_version WHERE observation_id=$1 ORDER BY version_number`, [observationId])).rows;
  assert.deepEqual(versions.map(row => row.submission_type), ["legacy_baseline", "edit"]);
  const stagedIds = (await pool.query(`SELECT id FROM plant_asset WHERE owner_subject='staff:owner'
    AND client_key LIKE $1 ORDER BY client_key`, [`observation-edit:${submitted.data.edit.id}:1:%`])).rows.map(row => row.id);
  assert.deepEqual(versions[1].photo_refs, [oldPhotoId, ...stagedIds]);
  assert.equal(versions[1].request_id, editId);
  assert.equal(versions[1].request_revision, 1);
  const photoRows = (await pool.query(`SELECT position,asset_id FROM observation_submission_photo
    WHERE version_id=$1 ORDER BY position`, [versions[1].id])).rows;
  assert.deepEqual(photoRows.map(row => row.asset_id), versions[1].photo_refs);
  assert.deepEqual(photoRows.map(row => row.asset_id), versions[1].photo_refs);
  assert.equal(photoRows.length, 3);
  const staged = await pool.query("SELECT approved FROM plant_asset WHERE id=ANY($1::text[])", [stagedIds]);
  assert.deepEqual(staged.rows.map(row => row.approved), [false, false]);

  const approved = await call(`/observation-edits/${editId}/review`, "officer", "POST",
    { decision: "Approved", comment: "Verified edit.", revision: 1 });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  const after = (await pool.query("SELECT content,status FROM plant_observation WHERE id=$1", [observationId])).rows[0];
  assert.equal(after.content.morphology, "Proposed public content");
  assert.equal(after.status, "Approved");
  const finalVersions = (await pool.query(`SELECT status FROM observation_submission_version WHERE observation_id=$1 ORDER BY version_number`, [observationId])).rows;
  assert.deepEqual(finalVersions.map(row => row.status), ["Superseded", "Approved"]);
  const evidence = (await pool.query(`SELECT event_type,request_revision,submission_version_id FROM observation_edit_event
    WHERE request_id=$1 AND event_type='approved'`, [editId])).rows[0];
  assert.deepEqual(evidence, { event_type: "approved", request_revision: 1, submission_version_id: versions[1].id });
  const photoStates = (await pool.query("SELECT id,observation_id,approved FROM plant_asset WHERE id=ANY($1::text[]) ORDER BY id",
    [[oldPhotoId, ...versions[1].photo_refs]])).rows;
  assert.equal(photoStates.find(row => row.id === oldPhotoId).observation_id, observationId);
  assert.deepEqual(photoStates.filter(row => row.id !== oldPhotoId).map(row => row.approved), [true, true]);
  assert.equal((await pool.query("SELECT count(*)::int n FROM observation_submission_photo WHERE version_id=$1", [versions[0].id])).rows[0].n, 1);

  const removal = await call("/observation-edits", "owner", "POST", { observation_id: observationId,
    client_key: "approved-edit-remove-photos", content: content("Remove photos"), photo_ids: [], photos: [] });
  assert.equal(removal.status, 201, JSON.stringify(removal.data));
  const removalReview = await call(`/observation-edits/${removal.data.edit.id}/review`, "officer", "POST",
    { decision: "Approved", comment: "Verified photo removal.", revision: 1 });
  assert.equal(removalReview.status, 200, JSON.stringify(removalReview.data));
  assert.equal((await pool.query("SELECT count(*)::int n FROM plant_asset WHERE observation_id=$1 AND approved=TRUE", [observationId])).rows[0].n, 0);
  assert.equal((await pool.query("SELECT count(*)::int n FROM observation_submission_photo WHERE asset_id=ANY($1::text[])",
    [[oldPhotoId, ...stagedIds]])).rows[0].n, 4);
  assert.equal((await pool.query("SELECT count(*)::int n FROM plant_asset WHERE id=ANY($1::text[])", [[oldPhotoId, ...stagedIds]])).rows[0].n, 3);
  const history = await call(`/observations/${observationId}/edit-history`, "owner");
  assert.equal(history.status, 200, JSON.stringify(history.data));
  const verified = history.data.versions.filter(row => row.verified);
  assert.deepEqual(verified.map(row => row.status), ["Superseded", "Superseded", "Approved"]);
  assert.deepEqual(verified[1].photo_ids, [oldPhotoId, ...stagedIds]);
  assert.equal(history.data.versions.filter(row => row.edit_request_id === editId).length, 1,
    "the legacy approved-edit projection must not duplicate its immutable version");
  for (const [index, assetId] of versions[1].photo_refs.entries()) {
    const bytes = (await pool.query("SELECT content FROM plant_asset WHERE id=$1", [assetId])).rows[0].content;
    const historical = await binary(`/observation-versions/${versions[1].id}/photos/${index}`, "owner");
    assert.equal(historical.status, 200);
    assert.deepEqual(historical.bytes, Buffer.from(bytes), `historical photo ${index} keeps its original bytes and order`);
  }
  assert.equal((await call(`/observations/${observationId}/edit-history`, "other")).status, 404);
  assert.equal((await binary(`/observation-versions/${versions[1].id}/photos/0`, "other")).status, 404);
});

test("correction resubmissions preserve approved canonical data and exact repeated lineage", async t => {
  const { pool, call } = await fixture(t);
  const submitted = await call("/observation-edits", "owner", "POST", { observation_id: observationId,
    client_key: "correction-edit", content: content("Edit one"), photo_ids: [], photos: [] });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.data));
  const requestId = submitted.data.edit.id;
  const cycle = async (revision, updatedMorphology) => {
    const decision = await call(`/observation-edits/${requestId}/review`, "officer", "POST",
      { decision: "Correction Required", comment: `Clarify revision ${revision}`, revision });
    assert.equal(decision.status, 200, JSON.stringify(decision.data));
    const correction = await call(`/observation-edits/${requestId}`, "owner", "PATCH", {
      revision, content: content(updatedMorphology), photo_ids: [], photos: [],
    });
    assert.equal(correction.status, 200, JSON.stringify(correction.data));
    assert.equal(correction.data.edit.revision, revision + 1);
  };
  await cycle(1, "Corrected once");
  await cycle(2, "Corrected twice");
  assert.equal((await pool.query("SELECT content->>'morphology' AS morphology FROM plant_observation WHERE id=$1", [observationId])).rows[0].morphology,
    "Canonical approved content");
  const beforeApproval = (await pool.query(`SELECT * FROM observation_submission_version WHERE observation_id=$1 ORDER BY version_number`, [observationId])).rows;
  assert.deepEqual(beforeApproval.map(row => row.status), ["Approved", "Superseded", "Superseded", "Pending Review"]);
  assert.deepEqual(beforeApproval.map(row => row.request_revision), [null, 1, 2, 3]);
  for (let index = 2; index < beforeApproval.length; index++) {
    const evidence = (await pool.query(`SELECT id FROM observation_edit_event WHERE submission_version_id=$1
      AND event_type='correction_required'`, [beforeApproval[index - 1].id])).rows[0];
    assert.equal(beforeApproval[index].correction_edit_event_id, evidence.id);
    assert.equal(beforeApproval[index].based_on_version_id, beforeApproval[index - 1].id);
  }
  const approved = await call(`/observation-edits/${requestId}/review`, "officer", "POST", { decision: "Approved", comment: "Accepted.", revision: 3 });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  assert.equal((await pool.query("SELECT content->>'morphology' AS morphology FROM plant_observation WHERE id=$1", [observationId])).rows[0].morphology,
    "Corrected twice");
  assert.deepEqual((await pool.query(`SELECT status FROM observation_submission_version WHERE observation_id=$1 ORDER BY version_number`, [observationId])).rows
    .map(row => row.status), ["Superseded", "Superseded", "Superseded", "Approved"]);
});

test("rejection and cancellation preserve canonical content; failed approval rolls back evidence and transitions", async t => {
  const { pool, call } = await fixture(t);
  const rejectRequest = async (key, morphology) => {
    const result = await call("/observation-edits", "owner", "POST", { observation_id: observationId,
      client_key: key, content: content(morphology), photo_ids: [], photos: [] });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    return result.data.edit.id;
  };
  const first = await rejectRequest("reject-edit", "Rejected proposal");
  const reject = await call(`/observation-edits/${first}/review`, "officer", "POST", { decision: "Rejected", comment: "Not supported.", revision: 1 });
  assert.equal(reject.status, 200, JSON.stringify(reject.data));
  assert.equal((await pool.query("SELECT content->>'morphology' AS morphology FROM plant_observation WHERE id=$1", [observationId])).rows[0].morphology,
    "Canonical approved content");
  assert.equal((await pool.query("SELECT status FROM observation_submission_version WHERE request_id=$1", [first])).rows[0].status, "Rejected");
  const second = await rejectRequest("cancel-edit", "Cancelled proposal");
  assert.equal((await call(`/observation-edits/${second}/cancel`, "owner", "POST", {})).status, 200);
  assert.equal((await pool.query("SELECT status FROM observation_submission_version WHERE request_id=$1", [second])).rows[0].status, "Cancelled");

  const third = await rejectRequest("rollback-edit", "Rollback proposal");
  await pool.query(`CREATE FUNCTION plant_app.reject_observation_edit_publish() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.content->>'morphology'='Rollback proposal' THEN RAISE EXCEPTION 'isolated approval failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_observation_edit_publish BEFORE UPDATE ON plant_observation
      FOR EACH ROW EXECUTE FUNCTION plant_app.reject_observation_edit_publish()`);
  const failed = await call(`/observation-edits/${third}/review`, "officer", "POST", { decision: "Approved", comment: "Attempt.", revision: 1 });
  assert.equal(failed.status, 503);
  assert.equal((await pool.query("SELECT status FROM observation_edit_request WHERE id=$1", [third])).rows[0].status, "Pending Review");
  assert.equal((await pool.query("SELECT status FROM observation_submission_version WHERE request_id=$1", [third])).rows[0].status, "Pending Review");
  assert.equal((await pool.query("SELECT status FROM observation_submission_version WHERE submission_type='legacy_baseline'")).rows[0].status, "Approved");
  assert.equal((await pool.query("SELECT count(*)::int n FROM observation_edit_event WHERE request_id=$1 AND event_type='approved'", [third])).rows[0].n, 0);
  assert.equal((await pool.query("SELECT content->>'morphology' AS morphology FROM plant_observation WHERE id=$1", [observationId])).rows[0].morphology,
    "Canonical approved content");
});

test("Migration 030 edit versioning rejects unknown provenance and routes verified initial records through the parent workflow", async t => {
  const { pool, call, binary } = await fixture(t);
  const unknownId = "33333333-3333-4333-8333-333333333333";
  const initialId = "44444444-4444-4444-8444-444444444444";
  await pool.query(`INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,origin_type)
    VALUES($1,1,'staff:owner','Approved',$3,'unknown-edit','unknown'),
      ($2,1,'staff:owner','Approved',$3,'initial-edit','initial_registration')`,
  [unknownId, initialId, content("Other approved record")]);
  await pool.query(`INSERT INTO plant_submission_receipt(owner_subject,client_key,payload_hash,result)
    VALUES('staff:owner','initial-edit',repeat('a',64),$1::jsonb)`, [JSON.stringify({
    id: initialId, plant_id: "1", species_id: "1", status: "Pending Review", qr_token: "obs-qr", species_request_id: null,
  })]);
  await pool.query(`INSERT INTO record_version_history(id,record_type,plant_id,version_number,owner_subject,edited_by,status,snapshot)
    VALUES('initial-parent-approved-v1','plant',1,1,'staff:owner','staff:owner','Approved',$1)`,
  [{ plant_id: 1, species_id: 1, scientific_name: "Species", qr_token: "obs-qr", observation_id: initialId,
    observation_revision: 1, content: content("Other approved record"), photo_ids: [], photo_refs: [] }]);
  const uploadedPhoto = await sharp({ create: { width: 5, height: 5, channels: 3, background: "orange" } }).jpeg().toBuffer();
  const proposal = { content: content("Attempted standalone edit"), photo_ids: [],
    photos: [{ content_type: "image/jpeg", base64: uploadedPhoto.toString("base64") }] };
  const unknown = await call("/observation-edits", "owner", "POST", { ...proposal,
    observation_id: unknownId, client_key: "unknown-origin-edit" });
  assert.equal(unknown.status, 409);
  const initial = await call("/observation-edits", "owner", "POST", { ...proposal,
    observation_id: initialId, client_key: "initial-origin-edit" });
  assert.equal(initial.status, 201, JSON.stringify(initial.data));
  const editId = initial.data.edit.id;
  assert.equal(initial.data.edit.observation_id, initialId);
  assert.equal(initial.data.edit.status, "Pending Review");
  assert.equal((await call("/observation-edits", "owner")).data.edits.filter(edit => edit.id === editId).length, 1);
  assert.equal((await call("/observation-edits", "officer")).data.edits.filter(edit => edit.id === editId).length, 1);
  assert.equal((await call("/observation-edits", "other")).data.edits.some(edit => edit.id === editId), false);
  assert.equal((await call(`/observation-edits/${editId}`, "owner")).data.edit.id, editId);
  assert.equal((await call(`/observation-edits/${editId}`, "other")).status, 404);
  const proposalPhoto = await binary(`/observation-edits/${editId}/photos/0`, "owner");
  assert.equal(proposalPhoto.status, 200);
  assert.equal((await call("/record-changes", "officer")).data.changes.some(change => change.id === editId), false);
  const history = await call(`/observations/${initialId}/edit-history`, "owner");
  assert.equal(history.status, 200, JSON.stringify(history.data));
  assert.equal(history.data.versions.length, 1);
  assert.equal(history.data.versions[0].edit_request_id, editId);
  assert.equal(history.data.versions[0].content.morphology, "Attempted standalone edit");
  const firstVersionId = history.data.versions[0].id;
  const firstPhotoResponse = await binary(`/observation-versions/${firstVersionId}/photos/0`, "owner");
  assert.equal(firstPhotoResponse.status, 200);
  const firstPhotoAsset = (await pool.query(`SELECT a.id,a.content FROM plant_record_version_photo p
    JOIN plant_asset a ON a.id=p.asset_id WHERE p.version_id=$1 AND p.position=0`, [firstVersionId])).rows[0];
  assert.ok(firstPhotoAsset.content.length > 0);
  const capability = await call("/observation-edits/capabilities", "owner");
  assert.equal(capability.data.versioning_available, true);
  const staleInitialReview = await call(`/observation-edits/${editId}/review`, "officer", "POST",
    { decision: "Correction Required", comment: "Stale decision", revision: 2 });
  assert.equal(staleInitialReview.status, 409);
  assert.equal((await pool.query("SELECT status,revision FROM record_change_submission WHERE id=$1", [editId])).rows[0].status, "Pending Review");
  const correctionRequested = await call(`/observation-edits/${editId}/review`, "officer", "POST",
    { decision: "Correction Required", comment: "Please clarify", revision: 1 });
  assert.equal(correctionRequested.status, 200, JSON.stringify(correctionRequested.data));
  const correction = await call(`/observation-edits/${editId}`, "owner", "PATCH", { revision: 1, content: content("Corrected initial") });
  assert.equal(correction.status, 200, JSON.stringify(correction.data));
  assert.equal(correction.data.edit.revision, 2);
  const correctedHistory = await call(`/observations/${initialId}/edit-history`, "owner");
  assert.deepEqual(correctedHistory.data.versions.map(version => version.status), ["Superseded", "Pending Review"]);
  assert.deepEqual((await pool.query("SELECT encode(content,'hex') AS bytes FROM plant_asset WHERE id=$1", [firstPhotoAsset.id])).rows[0].bytes,
    Buffer.from(firstPhotoAsset.content).toString("hex"));
  const reviewed = await call(`/observation-edits/${editId}/review`, "officer", "POST", { decision: "Approved", comment: "Verified", revision: 2 });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.data));
  assert.equal((await pool.query("SELECT content->>'morphology' AS morphology FROM plant_observation WHERE id=$1", [initialId])).rows[0].morphology, "Corrected initial");
  assert.equal((await pool.query("SELECT count(*)::int n FROM observation_edit_request WHERE observation_id=ANY($1::text[])",
    [[unknownId, initialId]])).rows[0].n, 0);
  assert.equal((await pool.query("SELECT count(*)::int n FROM observation_submission_version WHERE observation_id=ANY($1::text[])",
    [[unknownId, initialId]])).rows[0].n, 0);
  const second = await call("/observation-edits", "owner", "POST", { ...proposal, observation_id: initialId, client_key: "initial-origin-cancel" });
  assert.equal(second.status, 201, JSON.stringify(second.data));
  const cancelled = await call(`/observation-edits/${second.data.edit.id}/cancel`, "owner", "POST", {});
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
  assert.equal(cancelled.data.edit.status, "Cancelled");
});

test("version-aware Officer decisions reject missing and stale revisions, then accept the displayed current revision", async t => {
  const { pool, call } = await fixture(t);
  const submitted = await call("/observation-edits", "owner", "POST", { observation_id: observationId,
    client_key: "stale-officer-revision", content: content("Current version"), photo_ids: [], photos: [] });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.data));
  const requestId = submitted.data.edit.id;
  const missing = await call(`/observation-edits/${requestId}/review`, "officer", "POST",
    { decision: "Approved", comment: "No revision" });
  assert.equal(missing.status, 400);
  const stale = await call(`/observation-edits/${requestId}/review`, "officer", "POST",
    { decision: "Approved", comment: "Stale revision", revision: 2 });
  assert.equal(stale.status, 409);
  assert.equal((await pool.query("SELECT status FROM observation_edit_request WHERE id=$1", [requestId])).rows[0].status, "Pending Review");
  assert.equal((await pool.query(`SELECT count(*)::int n FROM observation_edit_event WHERE request_id=$1
    AND event_type IN ('approved','rejected','correction_required')`, [requestId])).rows[0].n, 0);
  const current = await call(`/observation-edits/${requestId}/review`, "officer", "POST",
    { decision: "Approved", comment: "Current revision", revision: 1 });
  assert.equal(current.status, 200, JSON.stringify(current.data));
  assert.equal((await pool.query("SELECT status FROM observation_edit_request WHERE id=$1", [requestId])).rows[0].status, "Approved");
});

test("Migration 030 preserves and safely reviews a legacy initial Observation correction without fabricating versions", async t => {
  const initialId = "55555555-5555-4555-8555-555555555555";
  const requestId = "legacy-initial-edit-0001";
  const bytes = await sharp({ create: { width: 3, height: 3, channels: 3, background: "#4a8c55" } }).jpeg().toBuffer();
  let seeded;
  const { pool, call, binary } = await fixture(t, { before030: async c => {
    seeded = await insertLegacyInitialEdit(c, { observationId: initialId, requestId,
      status: "Correction Required", initialBytes: bytes });
  } });
  await pool.query("UPDATE plant_observation SET created_at=CURRENT_TIMESTAMP-INTERVAL '2 days' WHERE id=$1", [initialId]);
  const beforeLater = (await pool.query("SELECT id FROM plant_observation WHERE plant_id=1 AND id<>$1 ORDER BY created_at DESC LIMIT 1", [initialId])).rows[0].id;
  const list = await call("/observation-edits", "owner");
  assert.equal(list.data.edits.filter(edit => edit.id === requestId).length, 1);
  assert.equal((await call("/observation-edits", "officer")).data.edits.filter(edit => edit.id === requestId).length, 1);
  const duplicate = await call("/observation-edits", "owner", "POST", { observation_id: initialId,
    client_key: "duplicate-parent-while-legacy-active", content: content("Must not duplicate") });
  assert.equal(duplicate.status, 409);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM record_change_submission
    WHERE base_snapshot->>'observation_id'=$1 AND status IN ('Pending Review','Correction Required')`, [initialId])).rows[0].n, 0);
  assert.equal((await call(`/observation-edits/${requestId}`, "owner")).data.edit.observation_id, initialId);
  assert.equal((await call(`/observation-edits/${requestId}/cancel`, "other", "POST", {})).status, 404);
  const originalBytes = await binary(`/observation-edits/${requestId}/photos/0`, "owner");
  assert.equal(originalBytes.status, 200);
  assert.deepEqual(originalBytes.bytes, bytes);
  const changed = await call(`/observation-edits/${requestId}`, "owner", "PATCH", {
    revision: 1, content: content("Legacy correction one"), photo_ids: [seeded.photoId], photos: [],
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  assert.equal(changed.data.edit.revision, 2);
  assert.equal((await pool.query("SELECT content->>'morphology' AS morphology FROM plant_observation WHERE id=$1", [initialId])).rows[0].morphology,
    "Legacy original legacy-initial-edit-0001", "a pending correction keeps the approved canonical Observation public");
  assert.equal(changed.data.edit.added_photo_count, 1, "correction resubmission preserves the legacy photo selection");
  assert.deepEqual((await pool.query("SELECT added_photos FROM observation_edit_request WHERE id=$1", [requestId])).rows[0].added_photos,
    [seeded.proposedPhoto], "correction resubmission preserves legacy photo bytes");
  const stale = await call(`/observation-edits/${requestId}/review`, "officer", "POST",
    { decision: "Correction Required", comment: "stale", revision: 1 });
  assert.equal(stale.status, 409);
  const correction = await call(`/observation-edits/${requestId}/review`, "officer", "POST",
    { decision: "Correction Required", comment: "Please clarify the location.", revision: 2 });
  assert.equal(correction.status, 200, JSON.stringify(correction.data));
  const notifications = (await call("/notifications", "owner")).data.notifications;
  const correctionNotice = notifications.find(item => item.entityType === "observation_edit" && item.requestId === requestId);
  assert.equal(correctionNotice?.type, "observation_edit_correction");
  assert.equal(correctionNotice?.revision, 2);
  assert.equal(correctionNotice?.comment, "Please clarify the location.");
  assert.equal(correctionNotice?.read, false);
  await call("/notifications/read", "owner", "POST", { ids: [correctionNotice.id] });
  assert.equal((await call("/notifications", "owner")).data.notifications.find(item => item.id === correctionNotice.id)?.read, true);
  const resubmitted = await call(`/observation-edits/${requestId}`, "owner", "PATCH", {
    revision: 2, content: content("Legacy correction final"), photo_ids: [seeded.photoId], photos: [],
  });
  assert.equal(resubmitted.status, 200, JSON.stringify(resubmitted.data));
  assert.equal(resubmitted.data.edit.added_photo_count, 1);
  const approved = await call(`/observation-edits/${requestId}/review`, "officer", "POST",
    { decision: "Approved", comment: "Verified legacy correction.", revision: 3 });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  assert.equal((await pool.query("SELECT content->>'morphology' AS morphology FROM plant_observation WHERE id=$1", [initialId])).rows[0].morphology,
    "Legacy correction final");
  assert.equal((await pool.query("SELECT content->>'morphology' AS morphology FROM plant_observation WHERE id=$1", [beforeLater])).rows[0].morphology,
    "Canonical approved content");
  const stored = (await pool.query("SELECT status,revision,reviewed_by,review_comment FROM observation_edit_request WHERE id=$1", [requestId])).rows[0];
  assert.deepEqual(stored, { status: "Approved", revision: 3, reviewed_by: "staff:officer", review_comment: "Verified legacy correction." });
  assert.equal((await pool.query("SELECT count(*)::int n FROM observation_submission_version WHERE observation_id=$1 OR request_id=$2", [initialId, requestId])).rows[0].n, 0);
  assert.equal((await pool.query("SELECT count(*)::int n FROM observation_edit_event WHERE request_id=$1 AND event_type IN ('approved','rejected','correction_required')", [requestId])).rows[0].n, 1,
    "the real pre-migration correction event is preserved; no unlinked post-migration decision event is added");
  const history = await call(`/observations/${initialId}/edit-history`, "owner");
  assert.equal(history.status, 200, JSON.stringify(history.data));
  assert.deepEqual(history.data.events.filter(event => event.request_id === requestId && ["correction_required", "approved"].includes(event.event_type))
    .map(event => [event.event_type, event.revision ?? null, event.comment]), [
    ["correction_required", null, "Please correct this legacy request."],
    ["correction_required", 2, "Please clarify the location."],
    ["approved", 3, "Verified legacy correction."],
  ], "new legacy Officer decisions remain visible in history through their persisted notification evidence");
  const latest = (await pool.query(`SELECT v.photo_ids,a.content FROM observation_version_history v
    JOIN plant_asset a ON a.id=v.photo_ids->>1 WHERE v.observation_id=$1 AND v.version_number=1`, [initialId])).rows[0];
  assert.deepEqual(Buffer.from(latest.content), bytes, "legacy proposed photo bytes survive correction and approval");
});

test("Migration 030 permits owner cancellation of a verified legacy Pending Review initial edit", async t => {
  const { pool, call, photo } = await fixture(t);
  const initialId = "66666666-6666-4666-8666-666666666666";
  const requestId = "legacy-initial-cancel-0001";
  await insertLegacyInitialEdit(pool, { observationId: initialId, requestId, initialBytes: await photo("#72964a") });
  const cancelled = await call(`/observation-edits/${requestId}/cancel`, "owner", "POST", {});
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
  assert.equal(cancelled.data.edit.status, "Cancelled");
  assert.equal((await pool.query("SELECT cancelled_by FROM observation_edit_request WHERE id=$1", [requestId])).rows[0].cancelled_by,
    "staff:owner");
  assert.equal((await pool.query("SELECT count(*)::int n FROM observation_submission_version WHERE observation_id=$1", [initialId])).rows[0].n, 0);
  assert.equal((await pool.query("SELECT event_type FROM observation_edit_event WHERE request_id=$1 ORDER BY created_at DESC LIMIT 1", [requestId])).rows[0].event_type,
    "cancelled");
});

test("Migration 030 permits legacy Officer rejection but fails closed for contradictory legacy origin", async t => {
  const { pool, call, photo } = await fixture(t);
  const initialId = "77777777-7777-4777-8777-777777777777";
  const requestId = "legacy-initial-reject-0001";
  const seeded = await insertLegacyInitialEdit(pool, { observationId: initialId, requestId, initialBytes: await photo("#b07a54") });
  const before = (await pool.query("SELECT content,revision FROM plant_observation WHERE id=$1", [initialId])).rows[0];
  const rejected = await call(`/observation-edits/${requestId}/review`, "officer", "POST",
    { decision: "Rejected", comment: "Evidence is insufficient.", revision: 1 });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.data));
  const after = (await pool.query("SELECT content,revision FROM plant_observation WHERE id=$1", [initialId])).rows[0];
  assert.deepEqual(after, before, "rejection leaves approved public content and revision unchanged");
  assert.equal((await pool.query("SELECT status,review_comment FROM observation_edit_request WHERE id=$1", [requestId])).rows[0].status,
    "Rejected");

  const badId = "88888888-8888-4888-8888-888888888888";
  const badRequest = "legacy-initial-unverified-0001";
  await insertLegacyInitialEdit(pool, { observationId: badId, requestId: badRequest, initialBytes: await photo("#678abc") });
  await pool.query("DELETE FROM plant_submission_receipt WHERE client_key=$1", [`legacy-initial-${badRequest}`]);
  const refused = await call(`/observation-edits/${badRequest}/review`, "officer", "POST",
    { decision: "Approved", comment: "Should not be applied.", revision: 1 });
  assert.equal(refused.status, 409);
  assert.equal((await pool.query("SELECT status FROM observation_edit_request WHERE id=$1", [badRequest])).rows[0].status,
    "Pending Review");
  assert.notDeepEqual(seeded.proposedPhoto, null);
});

test("Migration 030 allows cancellation of a verified legacy Correction Required request", async t => {
  const initialId = "99999999-9999-4999-8999-999999999999";
  const requestId = "legacy-initial-correction-cancel";
  const bytes = await sharp({ create: { width: 3, height: 3, channels: 3, background: "#a5a545" } }).jpeg().toBuffer();
  const { pool, call } = await fixture(t, { before030: c => insertLegacyInitialEdit(c, {
    observationId: initialId, requestId, status: "Correction Required", initialBytes: bytes,
  }) });
  const cancelled = await call(`/observation-edits/${requestId}/cancel`, "owner", "POST", {});
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
  assert.equal(cancelled.data.edit.status, "Cancelled");
  assert.equal((await pool.query("SELECT content->>'morphology' AS morphology FROM plant_observation WHERE id=$1", [initialId])).rows[0].morphology,
    "Legacy original legacy-initial-correction-cancel");
});

test("Migration 030 fails closed for a legacy Correction Required request without persisted correction evidence", async t => {
  const initialId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const requestId = "legacy-initial-missing-review-evidence";
  const bytes = await sharp({ create: { width: 3, height: 3, channels: 3, background: "#9366a5" } }).jpeg().toBuffer();
  const { pool, call } = await fixture(t, { before030: c => insertLegacyInitialEdit(c, {
    observationId: initialId, requestId, status: "Correction Required", initialBytes: bytes, includeCorrectionEvent: false,
  }) });
  const refused = await call(`/observation-edits/${requestId}`, "owner", "PATCH", {
    revision: 1, content: content("Must remain blocked"), photo_ids: [], photos: [],
  });
  assert.equal(refused.status, 409);
  assert.equal((await pool.query("SELECT status,revision FROM observation_edit_request WHERE id=$1", [requestId])).rows[0].status,
    "Correction Required");
  assert.equal((await pool.query("SELECT count(*)::int n FROM observation_submission_version WHERE observation_id=$1", [initialId])).rows[0].n, 0);
});

test("edit review decisions copy persisted microsecond timestamps without JavaScript round-tripping", async t => {
  for (const decision of ["Approved", "Rejected", "Correction Required"]) {
    await t.test(decision, async t => {
      const { pool, call } = await fixture(t);
      const submitted = await call("/observation-edits", "owner", "POST", {
        observation_id: observationId, client_key: `microsecond-edit-${decision}`,
        content: content(`Proposal ${decision}`), photo_ids: [], photos: [],
      });
      assert.equal(submitted.status, 201, JSON.stringify(submitted.data));
      await useMicrosecondReviewTimestamp(pool);
      const reviewed = await call(`/observation-edits/${submitted.data.edit.id}/review`, "officer", "POST",
        { decision, comment: `Decision: ${decision}`, revision: 1 });
      assert.equal(reviewed.status, 200, JSON.stringify(reviewed.data));
      await assertExactEditReviewTimestamp(pool, observationId);
      assert.equal((await pool.query("SELECT status FROM observation_submission_version WHERE request_id=$1",
        [submitted.data.edit.id])).rows[0].status, decision);
    });
  }
});

test("mismatched persisted review evidence rolls back the edit-version transition", async t => {
  const { pool, call } = await fixture(t);
  const submitted = await call("/observation-edits", "owner", "POST", {
    observation_id: observationId, client_key: "mismatched-review-evidence",
    content: content("Mismatched review"), photo_ids: [], photos: [],
  });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.data));
  const version = (await pool.query("SELECT id FROM observation_submission_version WHERE request_id=$1",
    [submitted.data.edit.id])).rows[0];
  await assert.rejects(versions.withVersionTransaction(pool, async c => {
    const eventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await c.query(`INSERT INTO observation_edit_event(id,request_id,observation_id,actor_subject,event_type,comment,
      request_revision,submission_version_id)
      VALUES($1,$2,$3,'staff:officer','rejected','Not approved',1,$4)`,
    [eventId, submitted.data.edit.id, observationId, version.id]);
    await versions.transitionVersion(c, { observationId, versionId: version.id, status: "Approved",
      actorSubject: "staff:officer", reviewEventId: eventId, verifyOfficer: async () => true });
  }), /Persisted Officer review does not match/);
  assert.equal((await pool.query("SELECT status FROM observation_submission_version WHERE id=$1", [version.id])).rows[0].status,
    "Pending Review");
  assert.equal((await pool.query("SELECT count(*)::int n FROM observation_edit_event WHERE request_id=$1 AND event_type='rejected'",
    [submitted.data.edit.id])).rows[0].n, 0);
});
