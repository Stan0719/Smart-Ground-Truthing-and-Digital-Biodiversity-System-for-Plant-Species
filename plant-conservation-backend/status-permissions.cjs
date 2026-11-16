"use strict";

// A request revision advances only when a Correction Required proposal is
// resubmitted. Keep the legacy Cancelled transition for older clients, but do
// not let that endpoint withdraw a correction resubmission awaiting review.
function canCancelEdit(status, revision) {
  return status === "Correction Required" ||
    (status === "Pending Review" && revision === 1);
}

// The deployed Species trigger advances review_cycle only when a correction is
// resubmitted. A missing cycle is ambiguous and must not grant an action.
function canModifyOriginalSpecies(status, reviewCycle, reviewedAt = null) {
  if (status === "Correction Required") return true;
  if (status !== "Pending Review") return false;
  if (Number.isInteger(reviewCycle)) return reviewCycle === 1 && reviewedAt == null;
  // Older installations lack the review-cycle trigger. Their correction
  // review timestamp survives resubmission, while ordinary edits have none.
  return reviewedAt == null;
}

async function canModifyPendingObservation(c, observation) {
  if (observation.status === "Correction Required") return true;
  if (observation.status !== "Pending Review") return false;
  // Every Officer correction in the current workflow creates a review row.
  // Older unknown-origin rows with multiple revisions and no review evidence
  // cannot be classified safely; keep them read-only pending reconciliation.
  const result = (await c.query(`SELECT
    EXISTS(SELECT 1 FROM observation_review WHERE observation_id=$1
      AND decision='Correction Required') AS corrected,
    EXISTS(SELECT 1 FROM observation_review WHERE observation_id=$1) AS reviewed`,
  [observation.id])).rows[0];
  if (!result || result.corrected || result.reviewed) return false;
  // Before origin provenance was installed, retain the existing revision-based
  // pending edit contract after checking that no Officer decision exists.
  const hasOrigin = (await c.query(`SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name='plant_observation' AND column_name='origin_type') AS available`)).rows[0]?.available;
  if (!hasOrigin && observation.origin_type === undefined) return true;
  if (["initial_registration", "subsequent_observation"].includes(observation.origin_type)) return true;
  if (observation.revision === 1) return true;
  // Unknown-origin legacy Plants need a complete pending-only version trail
  // before another edit. An absent or incomplete trail is ambiguous.
  const available = (await c.query("SELECT to_regclass(current_schema() || '.record_version_history') IS NOT NULL AS available")).rows[0]?.available;
  if (!available) return false;
  const versions = (await c.query(`SELECT count(*)::int AS count,
    min(version_number) AS first_version,max(version_number) AS last_version,
    bool_or(status NOT IN ('Pending Review','Superseded')) AS invalid
    FROM record_version_history WHERE plant_id=$1 AND record_type='plant'
      AND change_id IS NULL AND snapshot->>'observation_id'=$2`,
  [observation.plant_id, observation.id])).rows[0];
  return versions?.count === observation.revision && versions.first_version === 1 &&
    versions.last_version === observation.revision && versions.invalid === false;
}

module.exports = { canCancelEdit, canModifyOriginalSpecies, canModifyPendingObservation };
