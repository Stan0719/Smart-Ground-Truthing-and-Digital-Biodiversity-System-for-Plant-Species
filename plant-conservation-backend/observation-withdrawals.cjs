"use strict";

const { audit, fail, subject, transaction } = require("./domain.cjs");
const { classifyObservations } = require("./observation-origin.cjs");
const versions = require("./observation-submission-versions.cjs");

async function withdrawalReady(pool) {
  return Boolean((await pool.query(`SELECT
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema()
      AND table_name='plant_observation' AND column_name='withdrawn_by') AND
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema()
      AND table_name='plant_observation' AND column_name='withdrawn_at') AS ready`)).rows[0]?.ready);
}

function mountObservationWithdrawals(app, { pool, allow }) {
  app.post("/api/observations/:id/withdraw", allow("observations.create"), async (req, res) => {
    if (req.user?.role !== "Botanist") fail(403, "Only the submitting Botanist can withdraw an Observation.");
    if (!req.body || Array.isArray(req.body) || Object.keys(req.body).length)
      fail(400, "Withdrawal does not accept Observation changes.");
    if (!await withdrawalReady(pool)) fail(503, "Observation withdrawal requires migration 027.");

    const versioned = Boolean((await pool.query(`SELECT to_regclass('plant_app.observation_submission_photo') IS NOT NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='plant_app'
        AND table_name='observation_review' AND column_name='submission_version_id') AS ready`)).rows[0]?.ready);
    const result = await (versioned ? versions.withVersionTransaction : transaction)(pool, async (c) => {
      // Officer review and Observation editing lock this row first. Use the same
      // lock order so a concurrent review cannot approve a withdrawn record.
      const observation = (await c.query(`SELECT id,plant_id,owner_subject,status,origin_type,content,
        withdrawn_by,withdrawn_at FROM plant_observation WHERE id=$1 FOR UPDATE`, [req.params.id])).rows[0];
      if (!observation) fail(404, "Observation submission not found.");
      if (observation.owner_subject !== subject(req.user))
        fail(403, "Only the submitting Botanist can withdraw this Observation.");
      if (observation.status === "Withdrawn" || observation.withdrawn_at)
        fail(409, "This Observation has already been withdrawn.");
      if (!["Pending Review", "Correction Required"].includes(observation.status))
        fail(409, "Only a Pending Review or Correction Required Observation can be withdrawn.");

      // An initial-registration Observation is part of its Plant submission.
      // Withdrawing it alone would leave the parent in an inconsistent state.
      if ((await classifyObservations(c, [observation]))[0].origin_type !== "subsequent_observation")
        fail(409, "This Observation is linked to its original Plant submission. Withdraw the Plant submission instead.");

      // A correction resubmission is Pending Review but is locked under Phase 1.
      // Prior correction review evidence distinguishes it from an original request.
      if (observation.status === "Pending Review" && (await c.query(`SELECT 1 FROM observation_review
        WHERE observation_id=$1 AND decision='Correction Required' LIMIT 1`, [observation.id])).rows.length)
        fail(409, "A correction has already been resubmitted and is awaiting Officer review.");

      const editTable = (await c.query("SELECT to_regclass(current_schema() || '.observation_edit_request') IS NOT NULL AS available")).rows[0]?.available;
      if (editTable && (await c.query(`SELECT 1 FROM observation_edit_request
        WHERE observation_id=$1 AND status IN ('Pending Review','Correction Required') LIMIT 1`, [observation.id])).rows.length)
        fail(409, "This Observation has an active edit request and cannot be withdrawn separately.");

      let currentVersion = null;
      if (versioned) {
        currentVersion = (await c.query(`SELECT * FROM observation_submission_version
          WHERE observation_id=$1 ORDER BY version_number DESC LIMIT 1 FOR UPDATE`, [observation.id])).rows[0];
        if (!currentVersion || currentVersion.owner_subject !== observation.owner_subject ||
            currentVersion.request_id !== null || currentVersion.status !== observation.status ||
            !(await c.query("SELECT $1::jsonb=$2::jsonb AS matches",
              [JSON.stringify(currentVersion.content), JSON.stringify(observation.content)])).rows[0].matches)
          fail(409, "Observation submission version changed. Reload before withdrawing.");
      }
      // Match Officer review's Observation -> version -> parent lock order.
      const plant = (await c.query(`SELECT plant_id,rbac_status FROM plant_record
        WHERE plant_id=$1 FOR UPDATE`, [observation.plant_id])).rows[0];
      if (!plant || plant.rbac_status !== "Approved")
        fail(409, "This Observation depends on a Plant that is not currently approved. It cannot be withdrawn separately.");
      if (versioned) {
        // The exact active version is closed while both it and the canonical
        // Observation are locked. All earlier snapshots and review rows remain.
        await versions.transitionVersion(c, { observationId: observation.id,
          versionId: currentVersion.id, status: "Withdrawn", actorSubject: subject(req.user) });
      }

      const updated = (await c.query(`UPDATE plant_observation SET status='Withdrawn',withdrawn_by=$1,
        withdrawn_at=CURRENT_TIMESTAMP,revision=revision+1,updated_at=CURRENT_TIMESTAMP
        WHERE id=$2 AND status IN ('Pending Review','Correction Required') RETURNING id,plant_id,status,withdrawn_by,withdrawn_at`,
      [subject(req.user), observation.id])).rows[0];
      if (!updated) fail(409, "The Observation changed during withdrawal. Reload and try again.");
      await audit(c, req.user, "observation_submission_withdrawn", observation.id);
      return updated;
    });
    res.json({ withdrawn: true, observation: result });
  });
}

module.exports = { mountObservationWithdrawals };
