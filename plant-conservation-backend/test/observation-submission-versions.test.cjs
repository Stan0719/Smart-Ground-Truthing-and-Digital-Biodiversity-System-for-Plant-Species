"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { createPlantDatabase } = require("./postgres-fixture.cjs");
const history = require("../observation-submission-versions.cjs");

async function fixture(t) {
  const db = await createPlantDatabase();
  t.after(() => db.end());
  for (const number of ["004", "008", "009", "021", "022", "024", "025", "026", "027", "028", "029"]) {
    const names = require("node:fs").readdirSync(join(__dirname, "../migrations"));
    const filename = names.find(name => name.startsWith(`${number}-`));
    await db.query(readFileSync(join(__dirname, "../migrations", filename), "utf8"));
  }
  await db.query(`INSERT INTO family(family_id,family_name) VALUES(1,'Family');
    INSERT INTO genus(genus_id,family_id,genus_name) VALUES(1,1,'Genus');
    INSERT INTO conservation_status(status_id,status_name) VALUES(1,'Status');
    INSERT INTO species(species_id,scientific_name,genus_id,status_id) VALUES(1,'Species',1,1);
    INSERT INTO plant_record(plant_id,species_id,registered_subject,rbac_status,qr_token)
      VALUES(1,1,'owner','Approved','qr1');
    INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,origin_type,client_key)
      VALUES('pending',1,'owner','Pending Review','{"heightCm":10}','subsequent_observation','p'),
       ('approved',1,'owner','Approved','{"heightCm":20}','subsequent_observation','a'),
       ('initial',1,'owner','Approved','{}','initial_registration','i'),
       ('unknown',1,'owner','Approved','{}','unknown','u');
    INSERT INTO plant_asset(id,plant_id,owner_subject,client_key,observation_id,approved,content_type,content)
      VALUES('photo-1',1,'owner','ph1','approved',TRUE,'image/jpeg',decode('01','hex')),
            ('photo-2',1,'owner','ph2','approved',TRUE,'image/jpeg',decode('02','hex'));`);
  return db;
}

async function tx(db, work) {
  return history.withVersionTransaction(db, work);
}

test("allocates immutable ordered snapshots and resolves the approved version", async t => {
  const db = await fixture(t);
  const original = await tx(db, c => history.insertVersion(c, {
    observationId: "pending", ownerSubject: "owner", submissionType: "original",
    content: { heightCm: 10 }, photoRefs: [],
  }));
  assert.equal(original.version_number, 1);
  await assert.rejects(tx(db, c => history.insertVersion(c, {
    observationId: "pending", ownerSubject: "owner", submissionType: "pending_edit",
    content: { heightCm: 99 }, photoRefs: [], basedOnVersionId: original.id,
  })), /Snapshot must match/);
  await assert.rejects(tx(db, c => history.insertVersion(c, {
    observationId: "pending", ownerSubject: "owner", submissionType: "pending_edit",
    basedOnVersionId: "missing", content: { heightCm: 11 }, photoRefs: [],
  })), /Snapshot must match/);
  await assert.rejects(tx(db, async c => {
    await history.transitionVersion(c, { observationId: "pending", versionId: original.id, status: "Superseded" });
    await c.query("UPDATE plant_observation SET content='{\"heightCm\":11}' WHERE id='pending'");
    await history.insertVersion(c, { observationId: "pending", ownerSubject: "owner",
      submissionType: "pending_edit", basedOnVersionId: original.id,
      content: { heightCm: 99 }, photoRefs: [] });
  }), /Snapshot must match/);
  assert.equal((await history.latestVersion(db, "pending")).status, "Pending Review");
  await assert.rejects(tx(db, c => history.transitionVersion(c, {
    observationId: "pending", versionId: original.id, status: "Superseded",
  })), /replacement in the same transaction/);
  const second = await tx(db, async c => {
    await history.transitionVersion(c, { observationId: "pending", versionId: original.id, status: "Superseded" });
    await c.query("UPDATE plant_observation SET content='{\"heightCm\":11}' WHERE id='pending'");
    return history.insertVersion(c, {
    observationId: "pending", ownerSubject: "owner", submissionType: "pending_edit",
    basedOnVersionId: original.id, content: { heightCm: 11 }, photoRefs: [],
    });
  });
  assert.equal(second.version_number, 2);
  await assert.rejects(tx(db, c => history.insertVersion(c, {
    observationId: "pending", ownerSubject: "owner", submissionType: "pending_edit",
    basedOnVersionId: original.id, content: { heightCm: 12 }, photoRefs: [],
  })), /Snapshot must match/);
  const empty = await history.currentApprovedVersion(db, "pending");
  assert.equal(empty, null);
  assert.deepEqual((await history.versionHistory(db, "pending")).map(v => v.version_number), [1, 2]);
  assert.equal((await history.latestVersion(db, "pending")).id, second.id);
  assert.equal(await history.versionById(db, "pending", "missing"), null);
  await assert.rejects(db.query("UPDATE observation_submission_version SET content='{}' WHERE id=$1", [original.id]), { code: "55000" });
  await assert.rejects(db.query("DELETE FROM observation_submission_version WHERE id=$1", [original.id]), { code: "55000" });
});

test("legacy baseline keeps exact ordered photos and refuses unbound edit review", async t => {
  const db = await fixture(t);
  await db.query(`INSERT INTO observation_edit_request(id,observation_id,owner_subject,status,revision,version_number,
    base_revision,base_fingerprint,base_snapshot,proposed_content,retained_photo_ids,client_key,payload_hash)
    VALUES('request','approved','owner','Pending Review',1,1,1,'fingerprint',
      '{"content":{"heightCm":20},"photo_ids":["photo-1","photo-2"]}',
      '{"heightCm":21}','["photo-1","photo-2"]'::jsonb,'edit-key','hash')`);
  const baseline = await tx(db, c => history.insertVersion(c, {
    observationId: "approved", ownerSubject: "owner", submissionType: "legacy_baseline",
    baselineForRequestId: "request", baselineCapturedBy: "owner",
    content: { heightCm: 20 }, photoRefs: ["photo-1", "photo-2"],
  }));
  assert.equal(baseline.version_number, 1);
  assert.deepEqual(baseline.photo_refs, ["photo-1", "photo-2"]);
  await assert.rejects(tx(db, c => history.insertVersion(c, {
    observationId: "approved", ownerSubject: "owner", submissionType: "edit",
    requestId: "request", requestRevision: 1, basedOnVersionId: baseline.id,
    content: { heightCm: 21 }, photoRefs: ["missing-photo"],
  })), /photo snapshot does not match|photo references changed/);
  await assert.rejects(tx(db, c => history.insertVersion(c, {
    observationId: "approved", ownerSubject: "owner", submissionType: "legacy_baseline",
    baselineForRequestId: "request", baselineCapturedBy: "owner",
    content: { heightCm: 20 }, photoRefs: ["photo-2", "photo-1"],
  })), /no prior submission/);
  const edit = await tx(db, c => history.insertVersion(c, {
    observationId: "approved", ownerSubject: "owner", submissionType: "edit",
    requestId: "request", requestRevision: 1, basedOnVersionId: baseline.id,
    content: { heightCm: 21 }, photoRefs: ["photo-1", "photo-2"],
  }));
  assert.equal(edit.version_number, 2);
  assert.deepEqual(edit.photo_refs, ["photo-1", "photo-2"]);
  assert.equal((await history.currentApprovedVersion(db, "approved")).id, baseline.id);
  await db.query("INSERT INTO observation_edit_event(id,request_id,observation_id,actor_subject,event_type,comment) VALUES('edit-review','request','approved','officer','approved','Accepted')");
  await assert.rejects(tx(db, c => history.transitionVersion(c, {
    observationId: "approved", versionId: edit.id, status: "Approved", actorSubject: "officer",
    reviewEventId: "edit-review", verifyOfficer: async () => true,
  })), /Migration 030 exact request-revision and version evidence|exact persisted request revision and version evidence/);
  await assert.rejects(tx(db, async c => {
    await history.transitionVersion(c, { observationId: "approved", versionId: baseline.id, status: "Superseded" });
    await history.transitionVersion(c, { observationId: "approved", versionId: edit.id, status: "Approved",
      actorSubject: "officer", reviewEventId: "edit-review", verifyOfficer: async () => true });
  }), /Migration 030 exact request-revision and version evidence|exact persisted request revision and version evidence/);
  assert.equal((await history.currentApprovedVersion(db, "approved")).id, baseline.id);
  assert.equal((await history.versionById(db, "approved", edit.id)).status, "Pending Review");
  assert.deepEqual((await db.query("SELECT content,status FROM plant_observation WHERE id='approved'")).rows[0],
    { content: { heightCm: 20 }, status: "Approved" });
  await assert.rejects(tx(db, c => history.transitionVersion(c, {
    observationId: "approved", versionId: baseline.id, status: "Approved", actorSubject: "officer",
  })), /Invalid Observation version status/);
  await assert.rejects(db.query("UPDATE observation_submission_version SET photo_refs='[]' WHERE id=$1", [baseline.id]), { code: "55000" });
  assert.equal((await db.query("SELECT count(*)::int n FROM plant_asset")).rows[0].n, 2);
  assert.deepEqual((await db.query("SELECT id,encode(content,'hex') AS bytes FROM plant_asset ORDER BY id")).rows,
    [{ id: "photo-1", bytes: "01" }, { id: "photo-2", bytes: "02" }]);
});

test("corrected approved-record edits validate the exact request without changing the public Observation", async t => {
  const db = await fixture(t);
  await db.query(`INSERT INTO observation_edit_request(id,observation_id,owner_subject,status,revision,version_number,
    base_revision,base_fingerprint,base_snapshot,proposed_content,retained_photo_ids,client_key,payload_hash)
    VALUES('request','approved','owner','Pending Review',1,1,1,'fingerprint',
      '{"content":{"heightCm":20},"photo_ids":["photo-1","photo-2"]}',
      '{"heightCm":21}','["photo-1","photo-2"]'::jsonb,'edit-key','hash')`);
  const baseline = await tx(db, c => history.insertVersion(c, {
    observationId: "approved", ownerSubject: "owner", submissionType: "legacy_baseline",
    baselineForRequestId: "request", baselineCapturedBy: "owner",
    content: { heightCm: 20 }, photoRefs: ["photo-1", "photo-2"],
  }));
  const edit = await tx(db, c => history.insertVersion(c, {
    observationId: "approved", ownerSubject: "owner", submissionType: "edit",
    requestId: "request", requestRevision: 1, basedOnVersionId: baseline.id,
    content: { heightCm: 21 }, photoRefs: ["photo-1", "photo-2"],
  }));
  await db.query(`INSERT INTO observation_edit_event(id,request_id,observation_id,actor_subject,event_type,comment)
    VALUES('old-review','request','approved','officer','correction_required','Correct height')`);
  await assert.rejects(tx(db, c => history.transitionVersion(c, {
    observationId: "approved", versionId: edit.id, status: "Correction Required",
    actorSubject: "officer", reviewEventId: "old-review", verifyOfficer: async () => true,
  })), /Migration 030 exact request-revision and version evidence|exact persisted request revision and version evidence/);
  await db.query(`UPDATE observation_edit_request SET revision=2,proposed_content='{"heightCm":22}' WHERE id='request'`);
  await assert.rejects(tx(db, c => history.transitionVersion(c, {
    observationId: "approved", versionId: edit.id, status: "Correction Required",
    actorSubject: "officer", reviewEventId: "old-review", verifyOfficer: async () => true,
  })), /Migration 030 exact request-revision and version evidence|exact persisted request revision and version evidence/);
  await assert.rejects(tx(db, c => history.insertVersion(c, {
    observationId: "approved", ownerSubject: "owner", submissionType: "correction_resubmission",
    requestId: "request", requestRevision: 1, basedOnVersionId: edit.id,
    correctionReviewId: "old-review", content: { heightCm: 22 }, photoRefs: [],
  })), /exact active request revision/);
  await assert.rejects(tx(db, c => history.insertVersion(c, {
    observationId: "approved", ownerSubject: "owner", submissionType: "correction_resubmission",
    requestId: "request", requestRevision: 2, basedOnVersionId: edit.id,
    correctionReviewId: "old-review", content: { heightCm: 99 }, photoRefs: [],
  })), /exact active request revision/);
  assert.deepEqual((await db.query("SELECT content,status FROM plant_observation WHERE id='approved'")).rows[0],
    { content: { heightCm: 20 }, status: "Approved" });
  await assert.rejects(tx(db, c => history.insertVersion(c, {
    observationId: "approved", ownerSubject: "owner", submissionType: "edit",
    requestId: "request", requestRevision: 2, basedOnVersionId: "unrelated-version",
    content: { heightCm: 22 }, photoRefs: [],
  })), /current approved version|photo snapshot does not match/);
});

test("rejects unsupported origins, missing lineage, and invalid transitions", async t => {
  const db = await fixture(t);
  for (const observationId of ["initial", "unknown"]) {
    await assert.rejects(tx(db, c => history.insertVersion(c, {
      observationId, ownerSubject: "owner", submissionType: "original",
      content: {}, photoRefs: [],
    })), /verified subsequent/);
    await assert.rejects(history.versionHistory(db, observationId), /verified subsequent/);
  }
  await assert.rejects(tx(db, c => history.insertVersion(c, {
    observationId: "pending", ownerSubject: "someone-else", submissionType: "original",
    content: {}, photoRefs: [],
  })), /owner does not match/);
  const original = await tx(db, c => history.insertVersion(c, {
    observationId: "pending", ownerSubject: "owner", submissionType: "original",
    content: { heightCm: 10 }, photoRefs: [],
  }));
  await assert.rejects(tx(db, c => history.transitionVersion(c, {
    observationId: "pending", versionId: original.id, status: "Withdrawn", actorSubject: "other",
  })), /Only the Observation owner/);
  await assert.rejects(tx(db, c => history.transitionVersion(c, {
    observationId: "pending", versionId: original.id, status: "Approved", actorSubject: "owner",
  })), /verified Officer/);
  await db.query("INSERT INTO observation_review(id,observation_id,reviewer_subject,decision,comment) VALUES('officer-review','pending','officer','Approved','Accepted')");
  await assert.rejects(tx(db, c => history.transitionVersion(c, {
    observationId: "pending", versionId: original.id, status: "Approved", actorSubject: "officer",
    reviewEventId: "officer-review", verifyOfficer: async () => false,
  })), /verified Officer/);
});

test("correction snapshots require superseded review and remain locked while pending", async t => {
  const db = await fixture(t);
  const original = await tx(db, c => history.insertVersion(c, {
    observationId: "pending", ownerSubject: "owner", submissionType: "original",
    content: { heightCm: 10 }, photoRefs: [],
  }));
  await tx(db, async c => {
    await c.query("INSERT INTO observation_review(id,observation_id,reviewer_subject,decision,comment) VALUES('review','pending','officer','Correction Required','Clarify.')");
    await history.transitionVersion(c, { observationId: "pending", versionId: original.id,
      status: "Correction Required", actorSubject: "officer", reviewEventId: "review", verifyOfficer: async () => true });
  });
  await db.query("INSERT INTO observation_review(id,observation_id,reviewer_subject,decision,comment) VALUES('stale-review','pending','officer','Correction Required','Other feedback')");
  await assert.rejects(tx(db, c => history.insertVersion(c, {
    observationId: "pending", ownerSubject: "owner", submissionType: "correction_resubmission",
    basedOnVersionId: original.id, correctionReviewId: "review",
    content: { heightCm: 11 }, photoRefs: [],
  })), /Snapshot must match/);
  const corrected = await tx(db, async c => {
    await history.transitionVersion(c, { observationId: "pending", versionId: original.id, status: "Superseded" });
    await c.query("UPDATE plant_observation SET status='Pending Review',content='{\"heightCm\":11}' WHERE id='pending'");
    await assert.rejects(history.insertVersion(c, { observationId: "pending", ownerSubject: "owner",
      submissionType: "correction_resubmission", basedOnVersionId: original.id,
      correctionReviewId: "stale-review", content: { heightCm: 11 }, photoRefs: [] }),
    /does not belong to the source/);
    return history.insertVersion(c, { observationId: "pending", ownerSubject: "owner",
      submissionType: "correction_resubmission", basedOnVersionId: original.id,
      correctionReviewId: "review", content: { heightCm: 11 }, photoRefs: [] });
  });
  assert.equal(corrected.version_number, 2);
  await assert.rejects(tx(db, c => history.transitionVersion(c, {
    observationId: "pending", versionId: corrected.id, status: "Withdrawn", actorSubject: "owner",
  })), /Invalid Observation version status/);
  await tx(db, async c => {
    await c.query("INSERT INTO observation_review(id,observation_id,reviewer_subject,decision,comment) VALUES('review-2','pending','officer','Correction Required','Clarify again.')");
    await history.transitionVersion(c, { observationId: "pending", versionId: corrected.id,
      status: "Correction Required", actorSubject: "officer", reviewEventId: "review-2",
      verifyOfficer: async () => true });
    await history.transitionVersion(c, { observationId: "pending", versionId: corrected.id, status: "Superseded" });
    await c.query("UPDATE plant_observation SET content='{\"heightCm\":12}' WHERE id='pending'");
    const again = await history.insertVersion(c, { observationId: "pending", ownerSubject: "owner",
      submissionType: "correction_resubmission", basedOnVersionId: corrected.id,
      correctionReviewId: "review-2", content: { heightCm: 12 }, photoRefs: [] });
    assert.equal(again.version_number, 3);
  });
  await assert.rejects(tx(db, c => history.transitionVersion(c, {
    observationId: "pending", versionId: corrected.id, status: "Superseded",
  })), /Invalid Observation version status/);
});

test("serialized clients cannot allocate two original versions", async t => {
  const db = await fixture(t);
  const submit = () => tx(db, c => history.insertVersion(c, {
    observationId: "pending", ownerSubject: "owner", submissionType: "original",
    content: { heightCm: 10 }, photoRefs: [],
  }));
  const results = await Promise.allSettled([submit(), submit()]);
  assert.deepEqual(results.map(result => result.status).sort(), ["fulfilled", "rejected"]);
  assert.deepEqual((await history.versionHistory(db, "pending")).map(row => row.version_number), [1]);
});
