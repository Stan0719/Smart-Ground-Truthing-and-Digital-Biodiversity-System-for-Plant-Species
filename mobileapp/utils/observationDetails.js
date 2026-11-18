export const observationContentFields = ["heightCm", "healthStatus", "lifeStage", "morphology", "taxonomy", "notes",
  "latitude", "longitude", "accuracy_m", "zone", "altitudeM"];

export function observationDetailContent(row, selectedSnapshot, selectedVersion, selectedEdit, historicalSelection) {
  return selectedVersion?.content || (historicalSelection
    ? selectedEdit?.proposed_content || selectedSnapshot?.content : row?.content) || {};
}

export function canStartObservationEdit(row, editHistory, activeEdit, historicalSelection, accountId, versioningActive = false) {
  const verifiedOrigin = ["initial_registration", "subsequent_observation"].includes(row?.origin_type);
  return !historicalSelection && row?.owner_subject === `staff:${accountId}` && row.status === "Approved" &&
    !!editHistory && !activeEdit && (!versioningActive || verifiedOrigin);
}

export function canWithdrawOriginalObservation(row, activeEdit, historicalSelection, accountId) {
  if (historicalSelection || !row || row.owner_subject !== `staff:${accountId}` ||
      row.origin_type !== "subsequent_observation" || row.withdrawn_at ||
      !["Pending Review", "Correction Required"].includes(row.status) ||
      (activeEdit && ["Pending Review", "Correction Required"].includes(activeEdit.status))) return false;
  // Pending Review after a correction decision is a locked correction
  // resubmission, not an original request that can be withdrawn.
  return !(row.status === "Pending Review" && row.review_decision === "Correction Required");
}
