"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const { createPlantDatabase } = require("./postgres-fixture.cjs");

async function database(t, before030) {
  const db = await createPlantDatabase();
  t.after(() => db.end());
  const names = readdirSync(join(__dirname, "../migrations"));
  for (const number of ["004", "006", "008", "009", "021", "022", "024", "025", "026", "027", "028", "029"]) {
    const name = names.find(value => value.startsWith(`${number}-`));
    await db.query(readFileSync(join(__dirname, "../migrations", name), "utf8"));
  }
  await db.query(`INSERT INTO family(family_id,family_name) VALUES(1,'Family');
    INSERT INTO genus(genus_id,family_id,genus_name) VALUES(1,1,'Genus');
    INSERT INTO conservation_status(status_id,status_name) VALUES(1,'Status');
    INSERT INTO species(species_id,scientific_name,genus_id,status_id) VALUES(1,'Species',1,1);
    INSERT INTO plant_record(plant_id,species_id,registered_subject,rbac_status,qr_token)
      VALUES(1,1,'owner','Approved','qr');
    INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,origin_type,client_key)
      VALUES('obs',1,'owner','Approved','{"heightCm":20}','subsequent_observation','obs');
    INSERT INTO observation_edit_request(id,observation_id,owner_subject,status,revision,version_number,
      base_revision,base_fingerprint,base_snapshot,proposed_content,client_key,payload_hash)
      VALUES('request','obs','owner','Pending Review',1,1,1,'hash',
        '{"content":{"heightCm":20},"photo_ids":[]}','{"heightCm":21}','edit','hash');
    INSERT INTO observation_submission_version(id,observation_id,version_number,submission_type,status,
      owner_subject,baseline_for_request_id,content,photo_refs,baseline_captured_at,baseline_captured_by)
      VALUES('base','obs',1,'legacy_baseline','Approved','owner','request','{"heightCm":20}','[]',CURRENT_TIMESTAMP,'owner');
    INSERT INTO observation_submission_version(id,observation_id,version_number,submission_type,status,
      owner_subject,submitted_by,request_id,request_revision,based_on_version_id,content,photo_refs,submitted_at)
      VALUES('edit-1','obs',2,'edit','Pending Review','owner','owner','request',1,'base',
        '{"heightCm":21}','[]',CURRENT_TIMESTAMP);
    INSERT INTO observation_edit_event(id,request_id,observation_id,actor_subject,event_type,comment)
      VALUES('legacy','request','obs','officer','correction_required','Old feedback');
    INSERT INTO observation_review(id,observation_id,reviewer_subject,decision,comment)
      VALUES('legacy-original','obs','officer','Approved','Historical decision');`);
  if (before030) await before030(db);
  await db.query(readFileSync(join(__dirname, "../migrations/030-observation-edit-review-version-lineage.sql"), "utf8"));
  return db;
}

const decision = (id, version, revision, type = "correction_required") =>
  [id, "request", "obs", "officer", type, "Improve height", revision, version];
async function insertDecision(db, args) {
  return db.query(`INSERT INTO observation_edit_event
    (id,request_id,observation_id,actor_subject,event_type,comment,request_revision,submission_version_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, args);
}

test("migration 030 preserves legacy events, binds a decision, and permits read_at", async t => {
  const db = await database(t);
  const legacy = (await db.query("SELECT request_revision,submission_version_id FROM observation_edit_event WHERE id='legacy'")).rows[0];
  assert.deepEqual(legacy, { request_revision: null, submission_version_id: null });
  await assert.rejects(insertDecision(db, decision("missing", null, null)), { code: "23514" });
  await insertDecision(db, decision("review-1", "edit-1", 1));
  await db.query("UPDATE observation_edit_event SET read_at=CURRENT_TIMESTAMP WHERE id='review-1'");
  await assert.rejects(db.query("UPDATE observation_edit_event SET comment='Changed' WHERE id='review-1'"), { code: "55000" });
  await assert.rejects(insertDecision(db, decision("duplicate", "edit-1", 1)), { code: "23505" });
  assert.equal((await db.query("SELECT count(*)::int n FROM observation_edit_event")).rows[0].n, 2);
  assert.equal((await db.query("SELECT submission_version_id FROM observation_review WHERE id='legacy-original'")).rows[0].submission_version_id, null);
});

test("wrong request, revision and version evidence fail; stale review rolls back", async t => {
  const db = await database(t);
  await assert.rejects(insertDecision(db, decision("wrong-revision", "edit-1", 2)), { code: "23514" });
  await assert.rejects(insertDecision(db, decision("wrong-version", "base", 1)), { code: "23514" });
  await assert.rejects(insertDecision(db, ["wrong-request", "other", "obs", "officer", "approved", "OK", 1, "edit-1"]));
  await db.query("UPDATE observation_edit_request SET status='Correction Required' WHERE id='request'");
  await assert.rejects(insertDecision(db, decision("stale", "edit-1", 1)), { code: "23514" });
  await assert.rejects(db.query(`BEGIN;
    UPDATE observation_edit_request SET status='Pending Review' WHERE id='request';
    INSERT INTO observation_edit_event(id,request_id,observation_id,actor_subject,event_type,request_revision,submission_version_id)
      VALUES('bad','request','obs','owner','approved',1,'edit-1');
    COMMIT;`));
  await db.query("ROLLBACK");
  assert.equal((await db.query("SELECT status FROM observation_edit_request WHERE id='request'")).rows[0].status,
    "Correction Required");
});

test("a mismatched version transition rolls its decision event back", async t => {
  const db = await database(t);
  await db.query("BEGIN");
  try {
    await insertDecision(db, decision("would-rollback", "edit-1", 1, "approved"));
    await assert.rejects(db.query(`UPDATE observation_submission_version SET status='Rejected',
      reviewed_by='officer',reviewed_at=CURRENT_TIMESTAMP,review_comment='Improve height'
      WHERE id='edit-1'`), { code: "23514" });
  } finally { await db.query("ROLLBACK"); }
  assert.equal((await db.query("SELECT count(*)::int n FROM observation_edit_event WHERE id='would-rollback'")).rows[0].n, 0);
  assert.equal((await db.query("SELECT status FROM observation_submission_version WHERE id='edit-1'")).rows[0].status, "Pending Review");
});

test("edit correction follows exact source over repeated cycles; original review remains compatible", async t => {
  const db = await database(t);
  await insertDecision(db, decision("review-1", "edit-1", 1));
  const event = (await db.query("SELECT created_at FROM observation_edit_event WHERE id='review-1'")).rows[0];
  await db.query(`UPDATE observation_submission_version SET status='Correction Required',
    reviewed_by='officer',reviewed_at=$1,review_comment='Improve height' WHERE id='edit-1'`, [event.created_at]);
  await db.query("UPDATE observation_submission_version SET status='Superseded' WHERE id='edit-1'");
  await db.query(`UPDATE observation_edit_request SET revision=2,status='Pending Review',
    proposed_content='{"heightCm":22}' WHERE id='request'`);
  await assert.rejects(db.query(`INSERT INTO observation_submission_version(id,observation_id,version_number,
    submission_type,status,owner_subject,submitted_by,request_id,request_revision,based_on_version_id,
    correction_edit_event_id,content,photo_refs,submitted_at)
    VALUES('wrong','obs',3,'correction_resubmission','Pending Review','owner','owner',
      'request',2,'base','review-1','{"heightCm":22}','[]',CURRENT_TIMESTAMP)`, []), { code: "23514" });
  await db.query(`INSERT INTO observation_submission_version(id,observation_id,version_number,
    submission_type,status,owner_subject,submitted_by,request_id,request_revision,based_on_version_id,
    correction_edit_event_id,content,photo_refs,submitted_at)
    VALUES('edit-2','obs',3,'correction_resubmission','Pending Review','owner','owner',
      'request',2,'edit-1','review-1','{"heightCm":22}','[]',CURRENT_TIMESTAMP)`);
  await assert.rejects(db.query("UPDATE observation_submission_version SET correction_edit_event_id=NULL WHERE id='edit-2'"), { code: "55000" });
  await insertDecision(db, decision("review-2", "edit-2", 2));
  const event2 = (await db.query("SELECT created_at FROM observation_edit_event WHERE id='review-2'")).rows[0];
  await db.query(`UPDATE observation_submission_version SET status='Correction Required',
    reviewed_by='officer',reviewed_at=$1,review_comment='Improve height' WHERE id='edit-2'`, [event2.created_at]);
  await db.query("UPDATE observation_submission_version SET status='Superseded' WHERE id='edit-2'");
  await db.query(`UPDATE observation_edit_request SET revision=3,status='Pending Review',
    proposed_content='{"heightCm":23}' WHERE id='request'`);
  await assert.rejects(db.query(`INSERT INTO observation_submission_version(id,observation_id,version_number,
    submission_type,status,owner_subject,submitted_by,request_id,request_revision,based_on_version_id,
    correction_edit_event_id,content,photo_refs,submitted_at)
    VALUES('stale-correction','obs',4,'correction_resubmission','Pending Review','owner','owner',
      'request',3,'edit-2','review-1','{"heightCm":23}','[]',CURRENT_TIMESTAMP)`), { code: "23514" });
  await db.query(`INSERT INTO observation_submission_version(id,observation_id,version_number,
    submission_type,status,owner_subject,submitted_by,request_id,request_revision,based_on_version_id,
    correction_edit_event_id,content,photo_refs,submitted_at)
    VALUES('edit-3','obs',4,'correction_resubmission','Pending Review','owner','owner',
      'request',3,'edit-2','review-2','{"heightCm":23}','[]',CURRENT_TIMESTAMP)`);
  await assert.rejects(db.query(`UPDATE observation_submission_version SET status='Approved',
    reviewed_by='officer',reviewed_at=CURRENT_TIMESTAMP,review_comment='Approved' WHERE id='edit-3'`), { code: "23514" });
  await insertDecision(db, decision("approved-3", "edit-3", 3, "approved"));
  const approved = (await db.query("SELECT created_at FROM observation_edit_event WHERE id='approved-3'")).rows[0];
  await assert.rejects(db.query(`UPDATE observation_submission_version SET status='Rejected',
    reviewed_by='officer',reviewed_at=$1,review_comment='Improve height' WHERE id='edit-3'`,
  [approved.created_at]), { code: "23514" });
  await assert.rejects(db.query(`UPDATE observation_submission_version SET status='Approved',
    reviewed_by='other-officer',reviewed_at=$1,review_comment='Improve height' WHERE id='edit-3'`,
  [approved.created_at]), { code: "23514" });
  await db.query("BEGIN");
  try {
    await db.query("UPDATE observation_submission_version SET status='Superseded' WHERE id='base'");
    await db.query(`UPDATE observation_submission_version SET status='Approved',reviewed_by='officer',
      reviewed_at=$1,review_comment='Improve height' WHERE id='edit-3'`, [approved.created_at]);
    await db.query("COMMIT");
  } catch (cause) { await db.query("ROLLBACK"); throw cause; }
  assert.equal((await db.query("SELECT id FROM observation_submission_version WHERE observation_id='obs' AND status='Approved'")).rows[0].id, "edit-3");
  assert.equal((await db.query("SELECT count(*)::int n FROM observation_submission_version")).rows[0].n, 4);
  assert.equal((await db.query("SELECT count(*)::int n FROM observation_edit_event")).rows[0].n, 4);
});

test("original review requires exact pending version; Plant-linked reviews and legacy rows remain valid", async t => {
  const db = await database(t);
  await db.query(`INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,origin_type,client_key)
    VALUES('new',1,'owner','Pending Review','{}','subsequent_observation','new'),
      ('initial',1,'owner','Pending Review','{}','initial_registration','initial');
    INSERT INTO observation_submission_version(id,observation_id,version_number,submission_type,status,
      owner_subject,submitted_by,content,photo_refs,submitted_at)
    VALUES('new-v1','new',1,'original','Pending Review','owner','owner','{}','[]',CURRENT_TIMESTAMP);`);
  await db.query(`INSERT INTO plant_submission_receipt(owner_subject,client_key,payload_hash,result)
    VALUES('owner','initial',repeat('a',64),
      '{"id":"initial","plant_id":"1","species_id":"1","status":"Pending Review","qr_token":"qr","species_request_id":null}'::jsonb)`);
  await assert.rejects(db.query(`INSERT INTO observation_review(id,observation_id,reviewer_subject,decision,comment)
    VALUES('unlinked','new','officer','Approved','Good')`), { code: "23514" });
  await assert.rejects(db.query(`UPDATE observation_submission_version SET status='Approved',
    reviewed_by='officer',reviewed_at=CURRENT_TIMESTAMP,review_comment='Good' WHERE id='new-v1'`), { code: "23514" });
  await db.query(`INSERT INTO observation_review(id,observation_id,reviewer_subject,decision,comment)
    VALUES('plant-review','initial','officer','Approved','Good')`);
  await db.query(`INSERT INTO observation_review(id,observation_id,submission_version_id,reviewer_subject,decision,comment)
    VALUES('new-review','new','new-v1','officer','Approved','Good')`);
  const review = (await db.query("SELECT created_at FROM observation_review WHERE id='new-review'")).rows[0];
  await db.query(`UPDATE observation_submission_version SET status='Approved',reviewed_by='officer',
    reviewed_at=$1,review_comment='Good' WHERE id='new-v1'`, [review.created_at]);
  assert.equal((await db.query("SELECT status FROM observation_submission_version WHERE id='new-v1'")).rows[0].status, "Approved");
  await assert.rejects(db.query("UPDATE observation_review SET comment='Changed' WHERE id='new-review'"), { code: "55000" });
});

test("migration seeds immutable legacy-only eligibility from exact creation evidence", async t => {
  const db = await database(t, async seeded => {
    await seeded.query(`INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,origin_type,client_key,created_at)
      VALUES ('legacy-pending',1,'owner','Pending Review','{}','subsequent_observation','legacy-pending','2024-01-02T03:04:05.123456Z'),
        ('legacy-correction',1,'owner','Correction Required','{}','unknown','legacy-correction','2024-01-02T03:04:05.123456Z'),
        ('legacy-unknown',1,'owner','Pending Review','{}','unknown','legacy-unknown','2024-01-02T03:04:05.123456Z'),
        ('legacy-no-audit',1,'owner','Pending Review','{}','unknown','legacy-no-audit','2024-01-02T03:04:05.123456Z'),
        ('legacy-approved',1,'owner','Approved','{}','subsequent_observation','legacy-approved','2024-01-02T03:04:05.123456Z'),
        ('legacy-initial',1,'owner','Pending Review','{}','initial_registration','legacy-initial','2024-01-02T03:04:05.123456Z');
      INSERT INTO business_audit(id,actor_subject,action,target,created_at)
        SELECT 'audit-'||id,owner_subject,'observation_submitted',id,created_at FROM plant_observation
        WHERE id IN ('legacy-pending','legacy-correction','legacy-unknown','legacy-approved','legacy-initial');
      INSERT INTO observation_review(id,observation_id,reviewer_subject,decision,comment)
        VALUES('legacy-correction-review','legacy-correction','officer','Correction Required','Clarify the field.');
      INSERT INTO plant_submission_receipt(owner_subject,client_key,payload_hash,result)
        VALUES('owner','legacy-initial',repeat('b',64),
          '{"id":"legacy-initial","plant_id":"1","species_id":"1","status":"Pending Review","qr_token":"qr","species_request_id":null}'::jsonb);`);
  });
  const enrolled = (await db.query(`SELECT observation_id,owner_subject,captured_revision,captured_status
    FROM observation_legacy_review_eligibility ORDER BY observation_id`)).rows;
  assert.deepEqual(enrolled, [
    { observation_id: "legacy-correction", owner_subject: "owner", captured_revision: 1, captured_status: "Correction Required" },
    { observation_id: "legacy-pending", owner_subject: "owner", captured_revision: 1, captured_status: "Pending Review" },
    { observation_id: "legacy-unknown", owner_subject: "owner", captured_revision: 1, captured_status: "Pending Review" },
  ]);
  assert.equal((await db.query("SELECT origin_type FROM plant_observation WHERE id='legacy-unknown'")).rows[0].origin_type, "unknown");
  await assert.rejects(db.query(`INSERT INTO observation_legacy_review_eligibility
    (observation_id,plant_id,owner_subject,captured_revision,captured_status)
    VALUES('legacy-no-audit',1,'owner',1,'Pending Review')`), { code: "55000" });
  await assert.rejects(db.query(`UPDATE observation_legacy_review_eligibility SET captured_revision=2
    WHERE observation_id='legacy-pending'`), { code: "55000" });
  await assert.rejects(db.query(`INSERT INTO observation_review(id,observation_id,reviewer_subject,decision,comment)
    VALUES('legacy-unlinked','legacy-pending','officer','Approved','Good')`), { code: "23514" });
  await assert.rejects(db.query(`INSERT INTO observation_review(id,observation_id,reviewer_subject,decision,comment,legacy_revision)
    VALUES('legacy-stale','legacy-pending','officer','Approved','Good',2)`), { code: "23514" });
  await db.query(`INSERT INTO observation_review(id,observation_id,reviewer_subject,decision,comment,legacy_revision)
    VALUES('legacy-current','legacy-pending','officer','Approved','Good',1)`);
  await assert.rejects(db.query(`INSERT INTO observation_review(id,observation_id,reviewer_subject,decision,comment,legacy_revision)
    VALUES('unknown-unseeded','legacy-no-audit','officer','Approved','Good',1)`), { code: "23514" });
  await assert.rejects(db.query(`INSERT INTO observation_review(id,observation_id,reviewer_subject,decision,comment,legacy_revision)
    VALUES('legacy-approved-review','legacy-approved','officer','Rejected','No',1)`), { code: "23514" });
});

test("ordered snapshot photos retain bytes after current attachment is removed", async t => {
  const db = await database(t);
  await db.query(`INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,origin_type,client_key)
    VALUES('photo-obs',1,'owner','Pending Review','{}','subsequent_observation','photo-obs');
    INSERT INTO plant_asset(id,plant_id,owner_subject,client_key,observation_id,approved,content_type,content)
    VALUES('asset-a',1,'owner','asset-a','photo-obs',FALSE,'image/jpeg',decode('01','hex')),
      ('asset-b',1,'owner','asset-b','photo-obs',FALSE,'image/png',decode('02','hex'));`);
  await db.query(`INSERT INTO observation_submission_version(id,observation_id,version_number,submission_type,status,
    owner_subject,submitted_by,content,photo_refs,submitted_at)
    VALUES('photo-v1','photo-obs',1,'original','Pending Review','owner','owner',
      '{}','["asset-b","asset-a"]',CURRENT_TIMESTAMP)`);
  assert.deepEqual((await db.query(`SELECT asset_id FROM observation_submission_photo
    WHERE version_id='photo-v1' ORDER BY position`)).rows.map(row => row.asset_id), ["asset-b", "asset-a"]);
  await db.query("UPDATE plant_asset SET observation_id=NULL,approved=FALSE WHERE id='asset-a'");
  await assert.rejects(db.query("DELETE FROM plant_asset WHERE id='asset-a'"), { code: "55000" });
  await assert.rejects(db.query("UPDATE plant_asset SET content=decode('03','hex') WHERE id='asset-a'"), { code: "55000" });
  await assert.rejects(db.query("UPDATE observation_submission_photo SET position=7 WHERE asset_id='asset-a'"), { code: "55000" });
  await assert.rejects(db.query("DELETE FROM observation_submission_photo WHERE asset_id='asset-a'"), { code: "55000" });
  assert.equal((await db.query("SELECT encode(content,'hex') AS bytes FROM plant_asset WHERE id='asset-a'")).rows[0].bytes, "01");
  await db.query(`INSERT INTO plant_asset(id,plant_id,owner_subject,client_key,observation_id,approved,content_type,content)
    VALUES('unreferenced',1,'owner','unreferenced','photo-obs',FALSE,'image/jpeg',decode('04','hex'))`);
  await db.query("DELETE FROM plant_asset WHERE id='unreferenced'");
  assert.equal((await db.query("SELECT count(*)::int n FROM plant_asset WHERE id='unreferenced'")).rows[0].n, 0);
  await assert.rejects(db.query(`INSERT INTO observation_submission_version(id,observation_id,version_number,
    submission_type,status,owner_subject,submitted_by,content,photo_refs,submitted_at)
    VALUES('bad-photo','photo-obs',2,'pending_edit','Pending Review','owner','owner',
      '{}','["asset-a"]',CURRENT_TIMESTAMP)`), { code: "23514" });
  assert.equal((await db.query("SELECT count(*)::int n FROM observation_submission_version WHERE observation_id='photo-obs'")).rows[0].n, 1);
  await assert.rejects(db.query(`INSERT INTO observation_submission_version(id,observation_id,version_number,
    submission_type,status,owner_subject,submitted_by,content,photo_refs,submitted_at)
    VALUES('duplicate-photo','photo-obs',2,'pending_edit','Pending Review','owner','owner',
      '{}','["asset-b","asset-b"]',CURRENT_TIMESTAMP)`), { code: "23505" });
});

test("direct historical photo INSERT validates snapshot order, asset context and ownership", async t => {
  const db = await database(t, async seeded => {
    await seeded.query(`INSERT INTO plant_record(plant_id,species_id,registered_subject,rbac_status,qr_token)
      VALUES(2,1,'owner','Approved','qr2');
      INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,origin_type,client_key)
      VALUES('legacy-photo-obs',1,'owner','Pending Review','{}','subsequent_observation','legacy-photo-obs'),
        ('another-photo-obs',1,'owner','Pending Review','{}','subsequent_observation','another-photo-obs'),
        ('other-plant-obs',2,'owner','Pending Review','{}','subsequent_observation','other-plant-obs');
      INSERT INTO plant_asset(id,plant_id,owner_subject,client_key,observation_id,approved,content_type,content)
      VALUES('legacy-good',1,'owner','legacy-good','legacy-photo-obs',FALSE,'image/jpeg',decode('01','hex')),
        ('legacy-second',1,'owner','legacy-second','legacy-photo-obs',FALSE,'image/jpeg',decode('02','hex')),
        ('legacy-unlisted',1,'owner','legacy-unlisted','legacy-photo-obs',FALSE,'image/jpeg',decode('03','hex')),
        ('other-observation',1,'owner','other-observation','another-photo-obs',FALSE,'image/jpeg',decode('04','hex')),
        ('other-plant',2,'owner','other-plant','other-plant-obs',FALSE,'image/jpeg',decode('05','hex')),
        ('other-owner',1,'someone-else','other-owner','legacy-photo-obs',FALSE,'image/jpeg',decode('06','hex'));
      INSERT INTO observation_submission_version(id,observation_id,version_number,submission_type,status,
        owner_subject,submitted_by,content,photo_refs,submitted_at)
      VALUES('legacy-photo-v1','legacy-photo-obs',1,'original','Pending Review','owner','owner','{}',
        '["legacy-good","legacy-second","other-observation","other-plant","other-owner"]',CURRENT_TIMESTAMP);`);
  });
  const link = (position, assetId, plantId = 1, owner = "owner") => db.query(`INSERT INTO observation_submission_photo
    (version_id,observation_id,position,asset_id,plant_id,owner_subject)
    VALUES('legacy-photo-v1','legacy-photo-obs',$1,$2,$3,$4)`, [position, assetId, plantId, owner]);
  await link(0, "legacy-good");
  assert.deepEqual((await db.query(`SELECT asset_id,plant_id,owner_subject FROM observation_submission_photo
    WHERE version_id='legacy-photo-v1'`)).rows[0],
  { asset_id: "legacy-good", plant_id: 1, owner_subject: "owner" });
  await assert.rejects(link(0, "legacy-good"), { code: "23505" });
  await assert.rejects(link(1, "legacy-good"), { code: "23514" });
  await assert.rejects(link(1, "legacy-unlisted"), { code: "23514" });
  await assert.rejects(link(2, "other-observation"), { code: "23514" });
  await assert.rejects(link(3, "other-plant"), { code: "23514" });
  await assert.rejects(link(4, "other-owner"), { code: "23514" });
  await assert.rejects(link(1, "legacy-second", 2), { code: "23514" });
  await assert.rejects(link(1, "legacy-second", 1, "someone-else"), { code: "23514" });
  await assert.rejects(link(5, "legacy-second"), { code: "23514" });
  await assert.rejects(db.query("UPDATE observation_submission_photo SET position=1 WHERE version_id='legacy-photo-v1'"), { code: "55000" });
  await assert.rejects(db.query("DELETE FROM observation_submission_photo WHERE version_id='legacy-photo-v1'"), { code: "55000" });
  await db.query("UPDATE plant_asset SET observation_id=NULL,approved=FALSE WHERE id='legacy-good'");
  await assert.rejects(db.query("DELETE FROM plant_asset WHERE id='legacy-good'"), { code: "55000" });
  assert.equal((await db.query("SELECT count(*)::int n FROM observation_submission_photo WHERE version_id='legacy-photo-v1'")).rows[0].n, 1);
});

test("original correction retains migration 029 review linkage", async t => {
  const db = await database(t);
  await db.query(`INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,origin_type,client_key)
    VALUES('original',1,'owner','Pending Review','{"heightCm":5}','subsequent_observation','original');
    INSERT INTO observation_submission_version(id,observation_id,version_number,submission_type,status,
      owner_subject,submitted_by,content,photo_refs,submitted_at)
    VALUES('original-v1','original',1,'original','Pending Review','owner','owner',
      '{"heightCm":5}','[]',CURRENT_TIMESTAMP);
    INSERT INTO observation_review(id,observation_id,reviewer_subject,decision,comment,submission_version_id)
    VALUES('original-review','original','officer','Correction Required','Clarify original','original-v1');
    UPDATE observation_submission_version SET status='Correction Required',reviewed_by='officer',
      reviewed_at=(SELECT created_at FROM observation_review WHERE id='original-review'),
      review_comment='Clarify original' WHERE id='original-v1';
    UPDATE observation_submission_version SET status='Superseded' WHERE id='original-v1';
    UPDATE plant_observation SET content='{"heightCm":6}' WHERE id='original';
    `);
  await assert.rejects(db.query(`INSERT INTO observation_submission_version(id,observation_id,version_number,submission_type,status,
      owner_subject,submitted_by,based_on_version_id,correction_review_id,content,photo_refs,submitted_at)
    VALUES('wrong-original-v2','original',2,'correction_resubmission','Pending Review','owner','owner',
      'original-v1','legacy-original','{"heightCm":6}','[]',CURRENT_TIMESTAMP)`), { code: "23514" });
  await db.query(`INSERT INTO observation_submission_version(id,observation_id,version_number,submission_type,status,
      owner_subject,submitted_by,based_on_version_id,correction_review_id,content,photo_refs,submitted_at)
    VALUES('original-v2','original',2,'correction_resubmission','Pending Review','owner','owner',
      'original-v1','original-review','{"heightCm":6}','[]',CURRENT_TIMESTAMP);`);
  assert.deepEqual((await db.query(`SELECT correction_review_id,correction_edit_event_id
    FROM observation_submission_version WHERE id='original-v2'`)).rows[0],
  { correction_review_id: "original-review", correction_edit_event_id: null });
});

async function insertSealedPlantVersion(db, { id, versionNumber, observationId = "obs", plantId = 1,
  owner = "owner", photoIds, status = "Pending Review", changeId = null, changeRevision = null,
  links = photoIds.map((assetId, position) => ({ assetId, position, plantId, observationId, owner })) }) {
  await db.query("BEGIN");
  try {
    await db.query(`INSERT INTO record_version_history(id,record_type,plant_id,version_number,owner_subject,
      edited_by,status,snapshot,photo_refs_sealed,change_id,change_revision)
      VALUES($1,'plant',$2,$3,$4,$4,$5,$6,TRUE,$7,$8)`,
    [id, plantId, versionNumber, owner, status,
      JSON.stringify({ observation_id: observationId, photo_refs: photoIds.map(asset_id => ({ asset_id })) }), changeId, changeRevision]);
    for (const link of links) await db.query(`INSERT INTO plant_record_version_photo
      (version_id,plant_id,observation_id,owner_subject,position,asset_id) VALUES($1,$2,$3,$4,$5,$6)`,
    [id, link.plantId, link.observationId, link.owner, link.position, link.assetId]);
    await db.query("COMMIT");
  } catch (error) {
    try { await db.query("ROLLBACK"); } catch {}
    throw error;
  }
}

test("sealed Plant-version photos preserve order, bytes, and legal detachment", async t => {
  const db = await database(t);
  await db.query(`INSERT INTO plant_asset(id,plant_id,owner_subject,client_key,observation_id,approved,content_type,content)
    VALUES('plant-photo-a',1,'owner','plant-photo-a','obs',TRUE,'image/jpeg',decode('aa','hex')),
      ('plant-photo-b',1,'owner','plant-photo-b','obs',TRUE,'image/png',decode('bb','hex'));`);
  await insertSealedPlantVersion(db, { id: "plant-version-r1", versionNumber: 1, photoIds: ["plant-photo-b", "plant-photo-a"] });
  assert.deepEqual((await db.query(`SELECT position,asset_id FROM plant_record_version_photo
    WHERE version_id='plant-version-r1' ORDER BY position`)).rows,
  [{ position: 0, asset_id: "plant-photo-b" }, { position: 1, asset_id: "plant-photo-a" }]);

  await db.query("UPDATE plant_asset SET observation_id=NULL,approved=FALSE WHERE id='plant-photo-a'");
  assert.equal((await db.query("SELECT encode(content,'hex') AS bytes FROM plant_asset WHERE id='plant-photo-a'")).rows[0].bytes, "aa");
  await assert.rejects(db.query("DELETE FROM plant_asset WHERE id='plant-photo-a'"), { code: "55000" });
  await assert.rejects(db.query("UPDATE plant_asset SET content=decode('ff','hex') WHERE id='plant-photo-a'"), { code: "55000" });
  await assert.rejects(db.query("UPDATE plant_asset SET content_type='image/gif' WHERE id='plant-photo-b'"), { code: "55000" });
  await assert.rejects(db.query("DELETE FROM plant_record_version_photo WHERE version_id='plant-version-r1'"), { code: "55000" });
  await assert.rejects(db.query("UPDATE plant_record_version_photo SET position=9 WHERE version_id='plant-version-r1'"), { code: "55000" });
  await assert.rejects(db.query("UPDATE record_version_history SET photo_refs_sealed=FALSE WHERE id='plant-version-r1'"), { code: "55000" });

  await db.query(`INSERT INTO plant_asset(id,plant_id,owner_subject,client_key,observation_id,approved,content_type,content)
    VALUES('staged-photo',1,'owner','staged-photo',NULL,FALSE,'image/jpeg',decode('cc','hex'))`);
  await db.query("UPDATE plant_asset SET observation_id='obs',approved=TRUE WHERE id='staged-photo'");
  assert.equal((await db.query("SELECT approved FROM plant_asset WHERE id='staged-photo'")).rows[0].approved, true);
});

test("sealed Plant-version photo links reject wrong owner, Plant, Observation, and position", async t => {
  const db = await database(t);
  await db.query(`INSERT INTO plant_record(plant_id,species_id,registered_subject,rbac_status,qr_token)
    VALUES(2,1,'owner','Approved','qr2');
    INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,origin_type,client_key)
    VALUES('other-obs',2,'owner','Approved','{}','initial_registration','other-obs');
    INSERT INTO plant_asset(id,plant_id,owner_subject,client_key,observation_id,approved,content_type,content)
    VALUES('right-asset',1,'owner','right-asset',NULL,FALSE,'image/jpeg',decode('01','hex')),
      ('wrong-owner-asset',1,'someone-else','wrong-owner-asset',NULL,FALSE,'image/jpeg',decode('02','hex')),
      ('wrong-plant-asset',2,'owner','wrong-plant-asset','other-obs',TRUE,'image/jpeg',decode('03','hex'));`);
  const rejectLink = async (id, link) => {
    await assert.rejects(insertSealedPlantVersion(db, { id, versionNumber: 1, photoIds: ["right-asset"], links: [link] }),
      { code: "23514" });
    assert.equal((await db.query("SELECT count(*)::int n FROM record_version_history WHERE id=$1", [id])).rows[0].n, 0);
  };
  await rejectLink("bad-owner", { assetId: "wrong-owner-asset", position: 0, plantId: 1, observationId: "obs", owner: "owner" });
  await rejectLink("bad-plant", { assetId: "wrong-plant-asset", position: 0, plantId: 2, observationId: "other-obs", owner: "owner" });
  await rejectLink("bad-observation", { assetId: "right-asset", position: 0, plantId: 1, observationId: "other-obs", owner: "owner" });
  await rejectLink("bad-position", { assetId: "right-asset", position: 1, plantId: 1, observationId: "obs", owner: "owner" });

  await db.query("BEGIN");
  try {
    await db.query(`INSERT INTO record_version_history(id,record_type,plant_id,version_number,owner_subject,edited_by,status,snapshot,photo_refs_sealed)
      VALUES('missing-link','plant',1,1,'owner','owner','Pending Review',$1,TRUE)`,
    [JSON.stringify({ observation_id: "obs", photo_refs: [{ asset_id: "right-asset" }] })]);
    await assert.rejects(db.query("COMMIT"), { code: "23514" });
    try { await db.query("ROLLBACK"); } catch {}
  } catch (error) {
    try { await db.query("ROLLBACK"); } catch {}
    if (error.code !== "23514") throw error;
  }
});

test("Plant correction revisions retain separate immutable photo sets", async t => {
  const db = await database(t);
  await db.query(`INSERT INTO record_change_submission(id,plant_id,owner_subject,base_snapshot,proposed_snapshot,
      base_fingerprint,client_key,payload_hash)
    VALUES('plant-change',1,'owner','{}','{}','base','photo-change','payload');
    INSERT INTO plant_asset(id,plant_id,owner_subject,client_key,observation_id,approved,content_type,content)
    VALUES('revision-photo-1',1,'owner','revision-photo-1',NULL,FALSE,'image/jpeg',decode('11','hex')),
      ('revision-photo-2',1,'owner','revision-photo-2',NULL,FALSE,'image/jpeg',decode('22','hex'));`);
  await insertSealedPlantVersion(db, { id: "plant-change-v1", versionNumber: 1, photoIds: ["revision-photo-1"],
    status: "Correction Required", changeId: "plant-change", changeRevision: 1,
    links: [{ assetId: "revision-photo-1", position: 0, plantId: 1, observationId: "obs", owner: "owner" }] });
  await insertSealedPlantVersion(db, { id: "plant-change-v2", versionNumber: 2, photoIds: ["revision-photo-2"],
    changeId: "plant-change", changeRevision: 2,
    links: [{ assetId: "revision-photo-2", position: 0, plantId: 1, observationId: "obs", owner: "owner" }] });
  await db.query("UPDATE record_change_submission SET proposed_snapshot=$1 WHERE id='plant-change'", [JSON.stringify({ photos: ["new revision bytes"] })]);
  assert.deepEqual((await db.query(`SELECT p.version_id,p.position,p.asset_id,encode(a.content,'hex') AS bytes FROM plant_record_version_photo p
    JOIN plant_asset a ON a.id=p.asset_id WHERE p.version_id IN ('plant-change-v1','plant-change-v2') ORDER BY p.version_id`)).rows,
  [{ version_id: "plant-change-v1", position: 0, asset_id: "revision-photo-1", bytes: "11" },
    { version_id: "plant-change-v2", position: 0, asset_id: "revision-photo-2", bytes: "22" }]);
  await assert.rejects(db.query("UPDATE plant_asset SET content=decode('33','hex') WHERE id='revision-photo-1'"), { code: "55000" });
});

test("legacy Plant versions remain readable without destructive photo backfill", async t => {
  const db = await database(t);
  await db.query(`INSERT INTO record_version_history(id,record_type,plant_id,version_number,owner_subject,edited_by,status,snapshot)
    VALUES('legacy-plant-version','plant',1,1,'owner','owner','Approved',
      '{"observation_id":"obs","photo_refs":[{"change_id":"legacy-change","change_photo_index":0}]}');`);
  assert.deepEqual((await db.query(`SELECT photo_refs_sealed,snapshot->'photo_refs' AS photo_refs
    FROM record_version_history WHERE id='legacy-plant-version'`)).rows[0],
  { photo_refs_sealed: false, photo_refs: [{ change_id: "legacy-change", change_photo_index: 0 }] });
  assert.equal((await db.query("SELECT count(*)::int n FROM plant_record_version_photo WHERE version_id='legacy-plant-version'")).rows[0].n, 0);
});
