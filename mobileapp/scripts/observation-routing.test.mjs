import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (file) => readFileSync(new URL(file, import.meta.url), "utf8");

test("Add New Observation uses the backend collection form and carries the selected plant ID", () => {
  const app = source("../App.js");
  const plantDetail = source("../screens/PlantDetail.js");
  const form = source("../screens/FieldCollection.js");
  assert.match(app, /name="AddObservation"\s+component=\{FieldCollectionScreen\}/);
  assert.match(plantDetail, /navigation\.navigate\("AddObservation",\s*\{\s*plantId:\s*plant\.plantId,?\s*\}\)/);
  assert.match(plantDetail, /fetchPlantObservationEligibility\(user\?\.id, plantId\)/);
  assert.match(plantDetail, /disabled=\{!canAddObservation\}/);
  assert.match(form, /const mode = route\.name/);
  assert.match(form, /const blankForm = \(plantId = ""\) => \(\{[\s\S]*plant_id: String\(plantId \|\| ""\)/);
  assert.match(form, /await verifyApprovedPlantForObservation\(user\.id, plantId\)/);
  assert.match(form, /disabled=\{busy \|\| completed \|\| \(isNewObservation && plantEligibility !== "approved"\) \|\| \(observationEditMode && !autoSaveMeaningful\)\}/);
  assert.doesNotMatch(form, /getPlantById\(/);
  assert.match(form, /const plantId = String\(form\.plant_id \|\| selectedPlantId \|\| ""\)\.trim\(\);[\s\S]*path: `\/plants\/\$\{plantId\}\/observations`/);
});

test("Add New Observation uses the current form design and a user-facing Back control", () => {
  const app = source("../App.js");
  const form = source("../screens/FieldCollection.js");
  assert.match(app, /name="AddObservation"[\s\S]*?headerLeft: \(\) => navigation\.canGoBack\(\) \? <BackButton label=\{t\("common\.goBack"\)\}/);
  assert.match(form, /t\("navigation\.addNewObservation"\)/);
  assert.match(form, /isNewObservation && styles\.observationPage/);
  assert.match(form, /observationSectionTitle\("01", "fieldCollection\.plantInformation"\)/);
  assert.match(form, /observationSectionTitle\("05", "fieldCollection\.submissionSection"\)/);
  assert.match(form, /maxWidth: 720/);
  assert.match(form, /\["taxonomy", "notes"\]\.map\(renderObservationField\)/);
  assert.match(form, /onPress=\{\(\) => capture\(true\)\}/);
  assert.match(form, /onPress=\{\(\) => capture\(false\)\}/);
});

test("Add New Observation keeps five aligned sections and returns to its Plant on Cancel", () => {
  const form = source("../screens/FieldCollection.js");
  for (const [number, key] of [
    ["01", "plantInformation"], ["02", "plantCondition"], ["03", "observationLocation"],
    ["04", "fieldNotesPhotoEvidence"], ["05", "submissionSection"],
  ]) assert.match(form, new RegExp(`observationSectionTitle\\("${number}",[^\\n]*${key}`));
  assert.match(form, /sectionNumberBadge: \{ width: 34, height: 34, alignItems: "center", justifyContent: "center"/);
  assert.match(form, /observationHalfButton: \{ flex: 1, flexBasis: 0, minWidth: 0 \}/);
  assert.match(form, /Alert\.alert\(t\("fieldCollection\.leaveObservationTitle"\)/);
  assert.match(form, /await autosave\.stop\(\);\s*navigation\.navigate\("MainTabs", \{ screen: "PlantsTab", params: \{ screen: "PlantDetails", params: \{ plantId: selectedPlantId \}/);
  for (const language of ["en", "ms", "zh"]) {
    const catalog = JSON.parse(source(`../translations/${language}.json`));
    for (const key of ["leaveObservationTitle", "leaveObservationMessage", "keepEditing", "leaveObservation"])
      assert.ok(catalog.fieldCollection[key], `${language}: ${key}`);
  }
});

test("new-observation sync checks approval before POST while correction PATCH stays separate", () => {
  const sync = source("../utils/fieldSync.js");
  assert.match(sync, /if \(\/\^\\\/plants\\\/\\d\+\\\/observations\$\//);
  assert.ok(sync.indexOf("verifyApprovedPlantForObservation(accountId") < sync.indexOf("saved = await plantApi(draft.path"));
  assert.match(sync, /if \(draft\.method === "PATCH"\)\s*\{/);
});

test("Plant Details retain owner-visible pending record information while disabling observation action", () => {
  const detail = source("../screens/PlantDetail.js");
  assert.match(detail, /fetchPlantDetail\(plantId, \{ \.\.\.options, scopeMine: true \}\)/);
  assert.match(detail, /plant\.photos/);
  assert.match(detail, /disabled=\{!canAddObservation\}/);
  assert.match(detail, /t\(observationBlockedMessageKey\)/);
  assert.doesNotMatch(detail, /if \(plantApprovalStatus !== "approved"\) return/);
});

test("eligibility feedback is localized in all supported language catalogs", async () => {
  const { readFileSync } = await import("node:fs");
  for (const language of ["en", "ms", "zh"]) {
    const catalogue = JSON.parse(readFileSync(new URL(`../translations/${language}.json`, import.meta.url), "utf8"));
    for (const key of ["checkingPlantApproval", "plantObservationPendingApproval", "plantObservationRejected", "plantObservationCorrectionRequired", "plantObservationEligibilityUnavailable"])
      assert.ok(catalogue.fieldCollection[key], `${language}: missing ${key}`);
  }
});

test("Edit Observation remains a distinct correction route with its observation ID", () => {
  const app = source("../App.js");
  const form = source("../screens/FieldCollection.js");
  assert.match(app, /name="FieldCollectionEdit"\s+component=\{FieldCollectionScreen\}/);
  assert.match(form, /mode === "FieldCollectionEdit"/);
  assert.match(form, /path:\s*`\/observations\/\$\{observation\.id\}`/);
  assert.match(form, /navigation\.navigate\("FieldCollectionEdit",\s*\{\s*observation:\s*row,\s*plantId:\s*row\.plant_id\s*\}\)/);
});
