export const observationContentFields = ["heightCm", "healthStatus", "lifeStage", "morphology", "taxonomy", "notes",
  "latitude", "longitude", "accuracy_m", "zone", "altitudeM"];

export function observationDetailContent(row, selectedSnapshot, selectedVersion, selectedEdit, historicalSelection) {
  return selectedVersion?.content || (historicalSelection
    ? selectedEdit?.proposed_content || selectedSnapshot?.content : row?.content) || {};
}

export function canStartObservationEdit(row, editHistory, activeEdit, historicalSelection, accountId) {
  return !historicalSelection && row?.owner_subject === `staff:${accountId}` && row.status === "Approved" &&
    !!editHistory && !activeEdit;
}
