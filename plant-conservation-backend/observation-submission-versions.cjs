"use strict";

const { randomUUID } = require("node:crypto");
const { classifyObservations } = require("./observation-origin.cjs");
const activeClients = new WeakSet();
const replacements = new WeakMap();

async function withVersionTransaction(pool, work) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    activeClients.add(c);
    replacements.set(c, new Map());
    const result = await work(c);
    if (replacements.get(c).size) throw error("Superseded versions require a replacement in the same transaction.");
    await c.query("COMMIT");
    return result;
  } catch (cause) {
    await c.query("ROLLBACK").catch(() => {});
    throw cause;
  } finally {
    activeClients.delete(c);
    replacements.delete(c);
    c.release();
  }
}
function requireTransaction(c) {
  if (!activeClients.has(c)) throw error("Version writes require one active version transaction.");
}

const transitions = Object.freeze({
  "Pending Review": ["Correction Required", "Approved", "Rejected", "Withdrawn", "Superseded", "Cancelled", "Flagged"],
  "Correction Required": ["Withdrawn", "Superseded", "Cancelled"],
  Approved: ["Superseded"],
  Flagged: ["Correction Required", "Approved", "Rejected", "Superseded"],
});
const decisions = new Set(["Correction Required", "Approved", "Rejected", "Flagged"]);
const types = new Set(["original", "pending_edit", "edit", "correction_resubmission", "legacy_baseline"]);
const error = (message, status = 409) => Object.assign(new Error(message), { status });
async function hasColumn(c, table, column) {
  return Boolean((await c.query(`SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='plant_app' AND table_name=$1 AND column_name=$2) AS present`, [table, column])).rows[0]?.present);
}

// Route integration must use withVersionTransaction for canonical writes and
// version writes together. The callback's client keeps the Observation row
// lock until commit; the migration trigger then checks the same sequence.
// Referenced plant_asset rows must be retained with their original bytes by
// the integrating workflow. JSON photo_refs has no asset foreign key, and
// new photo bytes must be stored as owned assets before snapshot insertion.
// Integrating routes must supply trusted Officer permission checks, bind each
// review to the exact request revision/version with persisted evidence, verify
// the exact submitted photo selection, and retain referenced asset bytes.
// Unknown or contradictory Observation provenance remains ineligible.
async function observation(c, observationId, lock = false) {
  if (lock) requireTransaction(c);
  const row = (await c.query(`SELECT *
    FROM plant_observation WHERE id=$1 ${lock ? "FOR UPDATE" : ""}`, [observationId])).rows[0];
  if (!row) throw error("Observation unavailable.", 404);
  const classified = (await classifyObservations(c, [row]))[0];
  if (classified.origin_type !== "subsequent_observation")
    throw error("Standalone version history requires a verified subsequent Observation.");
  return row;
}

async function nextVersionNumber(c, observationId) {
  await observation(c, observationId, true);
  const row = (await c.query(`SELECT GREATEST(
    COALESCE((SELECT MAX(version_number) FROM observation_version_history WHERE observation_id=$1),0),
    COALESCE((SELECT MAX(version_number) FROM observation_submission_version WHERE observation_id=$1),0)
  )+1 AS next`, [observationId])).rows[0];
  return Number(row.next);
}

async function versionHistory(c, observationId) {
  await observation(c, observationId);
  return (await c.query(`SELECT * FROM observation_submission_version
    WHERE observation_id=$1 ORDER BY version_number ASC,id ASC`, [observationId])).rows;
}

async function versionById(c, observationId, versionId) {
  await observation(c, observationId);
  return (await c.query(`SELECT * FROM observation_submission_version
    WHERE observation_id=$1 AND id=$2`, [observationId, versionId])).rows[0] || null;
}

async function currentApprovedVersion(c, observationId) {
  await observation(c, observationId);
  return (await c.query(`SELECT * FROM observation_submission_version
    WHERE observation_id=$1 AND status='Approved'`, [observationId])).rows[0] || null;
}

async function latestVersion(c, observationId) {
  await observation(c, observationId);
  return (await c.query(`SELECT * FROM observation_submission_version
    WHERE observation_id=$1 ORDER BY version_number DESC,id DESC LIMIT 1`, [observationId])).rows[0] || null;
}

async function insertVersion(c, { observationId, ownerSubject, submissionType,
  content, photoRefs, submittedBy = ownerSubject, basedOnVersionId = null,
  requestId = null, requestRevision = null, correctionReviewId = null,
  correctionEditEventId = null,
  baselineForRequestId = null, baselineCapturedBy = null }) {
  const parent = await observation(c, observationId, true);
  if (ownerSubject !== parent.owner_subject) throw error("Observation version owner does not match.");
  if (!types.has(submissionType)) throw error("Unsupported Observation version type.", 400);
  if (!content || typeof content !== "object" || Array.isArray(content)) throw error("Invalid Observation snapshot.", 400);
  if (submittedBy !== ownerSubject && submissionType !== "legacy_baseline")
    throw error("Observation submitter does not match its owner.", 403);
  if (["original", "pending_edit"].includes(submissionType) ||
      (submissionType === "correction_resubmission" && requestId === null)) {
    if (parent.status !== "Pending Review" ||
        !(await c.query("SELECT content=$2::jsonb AS matches FROM plant_observation WHERE id=$1",
          [observationId, JSON.stringify(content)])).rows[0].matches)
      throw error("Snapshot must match the current submitted Observation and status.");
  }
  if (["edit", "correction_resubmission"].includes(submissionType) && requestId !== null) {
    const request = (await c.query(`SELECT proposed_content,retained_photo_ids,added_photos
      FROM observation_edit_request WHERE id=$1 AND observation_id=$2 AND owner_subject=$3
        AND revision=$4 AND status='Pending Review'`,
    [requestId, observationId, ownerSubject, requestRevision])).rows[0];
    if (parent.status !== "Approved" || !Number.isInteger(requestRevision) || !request ||
        !(await c.query("SELECT $1::jsonb=$2::jsonb AS matches",
          [JSON.stringify(request.proposed_content), JSON.stringify(content)])).rows[0].matches)
      throw error("Edit snapshot must match the exact active request revision.");
    const retained = Array.isArray(request.retained_photo_ids) ? request.retained_photo_ids : [];
    const additions = Array.isArray(request.added_photos) ? request.added_photos : [];
    const staged = additions.length ? (await c.query(`SELECT id FROM plant_asset
      WHERE observation_id=$1 AND plant_id=$2 AND owner_subject=$3
        AND client_key LIKE $4 ORDER BY client_key`,
    [observationId, parent.plant_id, ownerSubject, `observation-edit:${requestId}:${requestRevision}:%`])).rows.map(row => row.id) : [];
    if (staged.length !== additions.length || photoRefs.length !== retained.length + staged.length ||
        retained.some((id, index) => photoRefs[index] !== id) ||
        staged.some((id, index) => photoRefs[retained.length + index] !== id))
      throw error("Edit photo snapshot does not match the exact retained and staged photo selection.");
    if (submissionType === "correction_resubmission") {
      if (!(await hasColumn(c, "observation_edit_event", "submission_version_id")))
        throw error("Edit correction requires Migration 030 exact review evidence.");
      const source = (await c.query(`SELECT * FROM observation_submission_version
        WHERE id=$1 AND observation_id=$2 AND request_id=$3 AND status='Superseded'`,
      [basedOnVersionId, observationId, requestId])).rows[0];
      const evidence = (await c.query(`SELECT * FROM observation_edit_event
        WHERE id=$1 AND observation_id=$2 AND request_id=$3 AND request_revision=$4
          AND submission_version_id=$5 AND event_type='correction_required'`,
      [correctionEditEventId, observationId, requestId, source?.request_revision, basedOnVersionId])).rows[0];
      if (!source || source.request_revision + 1 !== requestRevision || !evidence ||
          source.reviewed_by !== evidence.actor_subject || source.reviewed_at?.getTime() !== evidence.created_at?.getTime() ||
          source.review_comment !== evidence.comment)
        throw error("Correction decision does not belong to the exact preceding edit version and revision.");
    }
  }
  if (!Array.isArray(photoRefs) || photoRefs.some(id => typeof id !== "string" || !id) ||
      new Set(photoRefs).size !== photoRefs.length) throw error("Invalid Observation photo references.", 400);
  const existing = (await c.query(`SELECT id,status,submission_type,reviewed_by,request_id,request_revision FROM observation_submission_version
    WHERE observation_id=$1 ORDER BY version_number DESC LIMIT 1`, [observationId])).rows[0];
  const approved = (await c.query(`SELECT id FROM observation_submission_version
    WHERE observation_id=$1 AND status='Approved'`, [observationId])).rows[0];
  if (submissionType === "original" && (existing ||
      (await c.query("SELECT 1 FROM observation_version_history WHERE observation_id=$1 LIMIT 1", [observationId])).rows.length))
    throw error("Existing Observation history cannot be replaced by a new original.");
  if (submissionType === "legacy_baseline" && (existing || !baselineForRequestId ||
      baselineCapturedBy !== ownerSubject))
    throw error("Legacy baseline requires a new owner-held edit request and no prior submission snapshots.");
  if (submissionType === "pending_edit" && (!existing || existing.id !== basedOnVersionId ||
      existing.status !== "Superseded" || existing.reviewed_by !== null ||
      !["original", "pending_edit"].includes(existing.submission_type)))
    throw error("Pending Observation edit requires the immediately superseded pending version.");
  if (submissionType === "edit" && (!approved || approved.id !== basedOnVersionId ||
      !requestId || !Number.isInteger(requestRevision) ||
      ["Pending Review", "Correction Required"].includes(existing?.status)))
    throw error("Observation edit requires the current approved version and an active request.");
  if (submissionType === "correction_resubmission" && (!existing ||
      existing.id !== basedOnVersionId || existing.status !== "Superseded" ||
      !existing.reviewed_by || (requestId === null ? !correctionReviewId : !correctionEditEventId) ||
      (requestId !== null && (existing.request_id !== requestId ||
        existing.request_revision + 1 !== requestRevision))))
    throw error("Correction resubmission requires the immediately superseded correction version and review.");
  if (submissionType === "correction_resubmission" && requestId === null) {
    // Migration 029 requires observation_review evidence. Current edit-review
    // events have no revision/version FK, so edit corrections fail closed.
    if (requestId !== null) throw error("Edit correction review lacks exact persisted version evidence.");
    const review = (await c.query(`SELECT reviewer_subject,created_at,comment FROM observation_review
      WHERE id=$1 AND observation_id=$2 AND decision='Correction Required'`,
    [correctionReviewId, observationId])).rows[0];
    const source = (await c.query(`SELECT reviewed_by,reviewed_at,review_comment FROM observation_submission_version
      WHERE id=$1 AND observation_id=$2`, [basedOnVersionId, observationId])).rows[0];
    if (!review || !source || review.reviewer_subject !== source.reviewed_by ||
        new Date(review.created_at).getTime() !== new Date(source.reviewed_at).getTime() ||
        review.comment !== source.review_comment)
      throw error("Correction review does not belong to the source version.");
  }
  // A JSON reference is not a foreign key. Check each asset and retain the
  // caller's order; never mutate an asset to manufacture a snapshot.
  if (photoRefs.length) {
    const assets = (await c.query(`SELECT id FROM plant_asset WHERE observation_id=$1
      AND plant_id=$2 AND owner_subject=$3 AND content_type IN ('image/jpeg','image/png')
      AND id=ANY($4::text[])`, [observationId, parent.plant_id, ownerSubject, photoRefs])).rows;
    if (assets.length !== photoRefs.length) throw error("Observation photo references changed. Reload before submitting.");
  }
  const versionNumber = await nextVersionNumber(c, observationId);
  const baseline = submissionType === "legacy_baseline";
  const correctionEvidenceAvailable = await hasColumn(c, "observation_submission_version", "correction_edit_event_id");
  if (correctionEditEventId && !correctionEvidenceAvailable)
    throw error("Edit correction requires Migration 030 exact review evidence.");
  const id = randomUUID();
  const lineageColumn = correctionEvidenceAvailable ? ",correction_edit_event_id" : "";
  const lineageValue = correctionEvidenceAvailable ? ",$12" : "";
  const shift = correctionEvidenceAvailable ? 1 : 0;
  const values = [id, observationId, versionNumber, submissionType, baseline ? "Approved" : "Pending Review",
    ownerSubject, baseline ? null : submittedBy, requestId, requestRevision, baselineForRequestId, correctionReviewId];
  if (correctionEvidenceAvailable) values.push(correctionEditEventId);
  values.push(basedOnVersionId, JSON.stringify(content), JSON.stringify(photoRefs), baseline, baseline ? baselineCapturedBy : null);
  const row = (await c.query(`INSERT INTO observation_submission_version
    (id,observation_id,version_number,submission_type,status,owner_subject,submitted_by,
     request_id,request_revision,baseline_for_request_id,correction_review_id${lineageColumn},based_on_version_id,
     content,photo_refs,submitted_at,baseline_captured_at,baseline_captured_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11${lineageValue},$${12 + shift},$${13 + shift}::jsonb,$${14 + shift}::jsonb,
      CASE WHEN $${15 + shift} THEN NULL ELSE CURRENT_TIMESTAMP END,
      CASE WHEN $${15 + shift} THEN CURRENT_TIMESTAMP ELSE NULL END,$${16 + shift}) RETURNING *`, values)).rows[0];
  if (replacements.get(c).get(observationId)?.id === basedOnVersionId)
    replacements.get(c).delete(observationId);
  return row;
}

async function approvedAncestor(c, row, observationId) {
  const visited = new Set([row.id]);
  let cursor = row;
  while (cursor.based_on_version_id !== null) {
    if (visited.has(cursor.based_on_version_id)) throw error("Observation version lineage contains a cycle.");
    visited.add(cursor.based_on_version_id);
    const ancestor = (await c.query(`SELECT * FROM observation_submission_version
      WHERE id=$1 AND observation_id=$2`, [cursor.based_on_version_id, observationId])).rows[0];
    if (!ancestor || ancestor.owner_subject !== row.owner_subject ||
        ancestor.version_number >= cursor.version_number)
      throw error("Observation version lineage is inconsistent.");
    if (ancestor.status === "Approved" ||
        (ancestor.status === "Superseded" &&
          replacements.get(c).get(observationId)?.id === ancestor.id &&
          replacements.get(c).get(observationId)?.previousStatus === "Approved")) return ancestor;
    if (ancestor.status !== "Superseded" ||
        !["pending_edit", "edit", "correction_resubmission"].includes(cursor.submission_type))
      throw error("Observation version lineage is inconsistent.");
    cursor = ancestor;
  }
  return null;
}
async function approvedVersionAncestor(c, observationId, versionId) {
  requireTransaction(c);
  await observation(c, observationId, true);
  const row = (await c.query(`SELECT * FROM observation_submission_version
    WHERE id=$1 AND observation_id=$2 FOR UPDATE`, [versionId, observationId])).rows[0];
  if (!row) throw error("Observation version unavailable.", 404);
  return approvedAncestor(c, row, observationId);
}

async function transitionVersion(c, { observationId, versionId, status, actorSubject,
  reviewEventId = null, verifyOfficer = null }) {
  const parent = await observation(c, observationId, true);
  const row = (await c.query(`SELECT * FROM observation_submission_version
    WHERE observation_id=$1 AND id=$2 FOR UPDATE`, [observationId, versionId])).rows[0];
  if (!row) throw error("Observation version unavailable.", 404);
  if (!transitions[row.status]?.includes(status) ||
      (row.submission_type === "correction_resubmission" && row.status === "Pending Review" &&
        ["Withdrawn", "Cancelled", "Superseded"].includes(status))) throw error("Invalid Observation version status transition.");
  let review = null;
  let exactOriginalEvidence = false;
  if (decisions.has(status)) {
    if (!actorSubject || actorSubject === parent.owner_subject ||
        typeof verifyOfficer !== "function" || await verifyOfficer(actorSubject) !== true)
      throw error("A verified Officer must record this review decision.", 403);
    if (row.request_id && !(await hasColumn(c, "observation_edit_event", "submission_version_id")))
      throw error("Edit review lacks Migration 030 exact request-revision and version evidence.");
    exactOriginalEvidence = !row.request_id && await hasColumn(c, "observation_review", "submission_version_id");
    review = row.request_id
      ? (await c.query(`SELECT actor_subject AS reviewer,created_at,comment,event_type,
          request_id,request_revision,submission_version_id
          FROM observation_edit_event WHERE id=$1 AND request_id=$2 AND observation_id=$3`,
        [reviewEventId, row.request_id, observationId])).rows[0]
      : (await c.query(`SELECT reviewer_subject AS reviewer,created_at,comment,decision AS event_type,
          ${exactOriginalEvidence ? "submission_version_id" : "NULL::text AS submission_version_id"}
          FROM observation_review WHERE id=$1 AND observation_id=$2`,
        [reviewEventId, observationId])).rows[0];
    const expected = row.request_id ? status.toLowerCase().replace(" ", "_") : status;
    if (!review || review.reviewer !== actorSubject || review.event_type !== expected ||
        (row.request_id && (review.request_revision !== row.request_revision || review.submission_version_id !== row.id)) ||
        (exactOriginalEvidence && review.submission_version_id !== row.id) ||
        (status !== "Approved" && (typeof review.comment !== "string" || !review.comment.trim())))
      throw error("Persisted Officer review does not match this version decision.");
  }
  let replacedApproved = null;
  if (status === "Approved") {
    replacedApproved = await approvedAncestor(c, row, observationId);
    const debt = replacements.get(c).get(observationId);
    if (debt && debt.previousStatus === "Approved" &&
        (!replacedApproved || debt.id !== replacedApproved.id))
      throw error("Approval does not replace the exact current Approved ancestor.");
    if (replacedApproved && (replacedApproved.status === "Approved" ||
        !debt || debt.id !== replacedApproved.id))
      throw error("Approval requires superseding its Approved ancestor in this transaction.");
  }
  if (["Withdrawn", "Cancelled"].includes(status) && actorSubject !== parent.owner_subject)
    throw error("Only the Observation owner can close this version.", 403);
  let reviewAssignments = "reviewed_by=$4,reviewed_at=$5,review_comment=$6";
  let values;
  if (review) {
    // Keep the exact PostgreSQL timestamp. node-postgres parses timestamptz
    // into a millisecond-precision Date, which can lose microseconds before
    // Migration 030's exact-evidence trigger compares it.
    const evidenceIndex = 6;
    const decisionIndex = 7;
    const reviewerIndex = 8;
    if (row.request_id) {
      reviewAssignments = `reviewed_by=(SELECT e.actor_subject FROM observation_edit_event e
          WHERE e.id=$${evidenceIndex} AND e.observation_id=v.observation_id AND e.request_id=v.request_id
            AND e.request_revision=v.request_revision AND e.submission_version_id=v.id
            AND e.event_type=lower(replace($${decisionIndex}::text,' ','_')) AND e.actor_subject=$${reviewerIndex}),
        reviewed_at=(SELECT e.created_at FROM observation_edit_event e
          WHERE e.id=$${evidenceIndex} AND e.observation_id=v.observation_id AND e.request_id=v.request_id
            AND e.request_revision=v.request_revision AND e.submission_version_id=v.id
            AND e.event_type=lower(replace($${decisionIndex}::text,' ','_')) AND e.actor_subject=$${reviewerIndex}),
        review_comment=(SELECT e.comment FROM observation_edit_event e
          WHERE e.id=$${evidenceIndex} AND e.observation_id=v.observation_id AND e.request_id=v.request_id
            AND e.request_revision=v.request_revision AND e.submission_version_id=v.id
            AND e.event_type=lower(replace($${decisionIndex}::text,' ','_')) AND e.actor_subject=$${reviewerIndex})`;
    } else {
      const versionPredicate = exactOriginalEvidence ? "AND r.submission_version_id=v.id" : "";
      reviewAssignments = `reviewed_by=(SELECT r.reviewer_subject FROM observation_review r
          WHERE r.id=$${evidenceIndex} AND r.observation_id=v.observation_id ${versionPredicate}
            AND r.decision=$${decisionIndex} AND r.reviewer_subject=$${reviewerIndex}),
        reviewed_at=(SELECT r.created_at FROM observation_review r
          WHERE r.id=$${evidenceIndex} AND r.observation_id=v.observation_id ${versionPredicate}
            AND r.decision=$${decisionIndex} AND r.reviewer_subject=$${reviewerIndex}),
        review_comment=(SELECT r.comment FROM observation_review r
          WHERE r.id=$${evidenceIndex} AND r.observation_id=v.observation_id ${versionPredicate}
            AND r.decision=$${decisionIndex} AND r.reviewer_subject=$${reviewerIndex})`;
    }
    values = [observationId, versionId, status,
      status === "Withdrawn" ? actorSubject : row.withdrawn_by,
      status === "Cancelled" ? actorSubject : row.cancelled_by,
      reviewEventId, status, actorSubject];
  }
  if (!review) values = [observationId, versionId, status, row.reviewed_by, row.reviewed_at, row.review_comment,
    status === "Withdrawn" ? actorSubject : row.withdrawn_by,
    status === "Cancelled" ? actorSubject : row.cancelled_by];
  const withdrawalActorIndex = review ? 4 : 7;
  const cancellationActorIndex = review ? 5 : 8;
  const updated = (await c.query(`UPDATE observation_submission_version v SET status=$3,
    ${reviewAssignments},
    withdrawn_by=$${withdrawalActorIndex},withdrawn_at=CASE WHEN $3='Withdrawn' THEN CURRENT_TIMESTAMP ELSE v.withdrawn_at END,
    cancelled_by=$${cancellationActorIndex},cancelled_at=CASE WHEN $3='Cancelled' THEN CURRENT_TIMESTAMP ELSE v.cancelled_at END
    WHERE v.observation_id=$1 AND v.id=$2 RETURNING v.*`, values)).rows[0];
  if (!updated) throw error("Persisted Officer review no longer matches this version.");
  if (status === "Superseded") replacements.get(c).set(observationId, { id: versionId, previousStatus: row.status });
  if (status === "Approved" && replacedApproved && replacements.get(c).get(observationId)?.id === replacedApproved.id)
    replacements.get(c).delete(observationId);
  return updated;
}

module.exports = { withVersionTransaction, nextVersionNumber, versionHistory, versionById, currentApprovedVersion,
  latestVersion, insertVersion, approvedVersionAncestor, transitionVersion };
