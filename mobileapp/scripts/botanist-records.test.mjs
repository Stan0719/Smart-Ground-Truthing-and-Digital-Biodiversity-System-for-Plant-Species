import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { getPlantLocationDisplay } from "../utils/plantLocationDisplay.js";
const require = createRequire(import.meta.url), ts = require("typescript"), React = require("react");
const read = (file) => readFileSync(new URL("../" + file, import.meta.url), "utf8");
function moduleFrom(file, deps) {
  const code = ts.transpileModule(read(file), { fileName: file.endsWith("Screen.js") ? file + ".jsx" : file.replace(/\.js$/, ".jsx"), compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)((name) => {
    if (name === "../components/BackButton") return { default: (props) => React.createElement("TouchableOpacity", props, props.label || props.accessibilityLabel), __esModule: true };
    if (name === "../components/BotanicalSkeleton") return { CardListSkeleton: "CardListSkeleton", DetailSkeletonContent: "DetailSkeletonContent", __esModule: true };
    assert.ok(name in deps, name); return { ...deps[name], __esModule: name !== "react" };
  }, module, module.exports);
  return module.exports;
}
const context = vm.createContext({});
vm.runInContext(read("utils/plantApi.js").replace(/^import .*;\r?\n/gm, "").replace(/export /g, ""), context);
const rows = [
  { plant_id: "8", species_id: "6", registered_subject: "staff:owner", scientific_name: "Manual plant name", rbac_status: "Pending Review", species_details: { species_id: "6", scientific_name: "Different species name", common_name: "Common species name" } },
  { plant_id: "9", species_id: "7", registered_subject: "staff:other", scientific_name: "Other plant", rbac_status: "Approved" },
];
const observations = [{ id: "observation-8", plant_id: "8", owner_subject: "staff:owner", status: "Pending Review", content: { heightCm: 80, healthStatus: "Healthy", lifeStage: "Juvenile", morphology: "Leaves" }, assets: [{ id: "asset-8" }], created_at: "2026-11-03T01:00:00Z" }];
const requests = [{ request_id: 1, requested_by: "staff:owner", proposed_species_id: "6", scientific_name: "Different species name", common_name: "Common species name", request_status: "Pending Review" }];
function fixture(api) {
  return moduleFrom("utils/botanistRecords.js", { "./plantApi": { plantApi: api, mapBackendPlant: context.mapBackendPlant,
    speciesRequestPhotoSources: async (rows) => rows.map((row) => ({ uri: `https://example.invalid/requests/${row.request_id}/photo` })),
    plantAssetSources: async (assets, accountId) => assets.map((asset) => ({ uri: `https://example.invalid/assets/${asset.id}`, owner: accountId })) } });
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test("plant mapping displays the saved QR inventory label without replacing the stored token", () => {
  const record = context.mapBackendPlant({ ...rows[0], qr_id: 7, qr_token: "real-qr-token", qr_status: "assigned" });
  assert.equal(record.qrCode, "QR-0007");
  assert.equal(record.qrId, "7");
  assert.equal(record.qr.code, "real-qr-token");
  assert.equal(record.qr.status, "assigned");
  assert.equal(context.mapBackendPlant({ ...rows[0], qr_token: "legacy-token" }).qrCode, "legacy-token");
});

test("Original Plant withdrawal eligibility and history filter use the live owner and status", () => {
  const records = fixture();
  const original = { ...records.projectBotanistRecords("owner", rows, observations, requests).plants[0],
    observations: [{ ...observations[0], origin_type: "initial_registration" }] };
  assert.equal(records.canWithdrawOriginalPlant(original, "owner"), true);
  assert.equal(records.canWithdrawOriginalPlant(original, "other"), false);
  for (const status of ["Approved", "Rejected", "Withdrawn"])
    assert.equal(records.canWithdrawOriginalPlant({ ...original, status }, "owner"), false);
  assert.equal(records.canWithdrawOriginalPlant({ ...original, hasApprovedObservation: true }, "owner"), false);
  assert.equal(records.canWithdrawOriginalPlant({ ...original, initialSubmissionStatus: "Rejected" }, "owner"), false);
  assert.equal(records.canWithdrawOriginalPlant({ ...original, observations: [...original.observations, { id: "another" }] }, "owner"), false);
  const speciesSubmission = { requested_by: "staff:owner", request_status: "Pending Review", review_cycle: "1", reviewed_at: null };
  assert.equal(records.canWithdrawOriginalSpecies(speciesSubmission, "owner"), true);
  assert.equal(records.canWithdrawOriginalSpecies({ ...speciesSubmission, request_status: "Correction Required", review_cycle: "2" }, "owner"), true);
  for (const status of ["Approved", "Rejected", "Withdrawn", "Superseded"])
    assert.equal(records.canWithdrawOriginalSpecies({ ...speciesSubmission, request_status: status }, "owner"), false, status);
  assert.equal(records.canWithdrawOriginalSpecies({ ...speciesSubmission, review_cycle: "2" }, "owner"), false,
    "a corrected Pending Review species request cannot be withdrawn");
  assert.equal(records.canWithdrawOriginalSpecies({ ...speciesSubmission, reviewed_at: "2026-11-15T00:00:00Z" }, "owner"), false);
  assert.equal(records.canWithdrawOriginalSpecies({ ...speciesSubmission, requested_by: "staff:other" }, "owner"), false);
  assert.equal(records.canWithdrawOriginalSpecies(speciesSubmission, "owner", true), false);
  assert.equal(records.canWithdrawOriginalSpecies({ ...speciesSubmission, approved_species_id: "7" }, "owner"), false);
  const dashboard = submissionsUtils();
  const withdrawn = { ...original, status: "Withdrawn", initialSubmissionStatus: "Withdrawn" };
  const group = dashboard.buildSubmissionGroups([withdrawn], "plant", { "plant:8": dashboard.versionCardItems("plant", 8, {
    history_available: true, versions: [{ id: "original-v1", version_number: 1, status: "Pending Review",
      snapshot: { observation_id: "observation-8" } }], prior_changes: [],
  }) })[0];
  assert.equal(group.versions[0].status, "Withdrawn");
  assert.equal(dashboard.groupStatusSummary(group).status, "Withdrawn");
  assert.equal(dashboard.filterSubmissionGroups([group], "withdrawn").length, 1);
  assert.equal(dashboard.filterSubmissionGroups([group], "pending").length, 0);
  assert.equal(dashboard.correctionTasks([withdrawn], [{ ...observations[0], status: "Withdrawn", origin_type: "initial_registration" }], [], "owner").length, 0);
  for (const locale of ["en", "ms", "zh"]) {
    const catalog = JSON.parse(read(`translations/${locale}.json`));
    for (const key of ["action", "confirmTitle", "confirmMessage", "keepSubmission", "successTitle", "successMessage", "failed"])
      assert.ok(catalog.plantWithdrawal[key], `${locale}.${key}`);
    for (const group of ["speciesWithdrawal", "observationWithdrawal"])
      for (const key of ["action", "confirmTitle", "confirmMessage", "keepSubmission", "successTitle", "successMessage", "failed"])
        assert.ok(catalog[group][key], `${locale}.${group}.${key}`);
    assert.ok(catalog.submissions.withdrawn);
  }
  const speciesDetail = read("screens/BotanistSpeciesRequestDetail.js");
  assert.match(speciesDetail, /canWithdrawOriginalSpecies\(request, accountId, historicalDetail\)/);
  assert.match(speciesDetail, /withdraw-original-species/);
  assert.match(speciesDetail, /plantApi\(`\/species-requests\/\$\{encodeURIComponent\(request\.request_id\)\}\/withdraw`/);
});

function submissionsUtils(translate = (key) => key) {
  return moduleFrom("screens/BotanistDashboard.js", {
    react: React,
    "../components/LanguageSelector": { default: "LanguageSelector" },
    "../components/fieldFormStyles": { fieldFormStyles: { submitButton: {}, submitButtonText: {} } },
    "../translations/i18n": { useAppTranslation() {}, t: translate, translateLabel: (value) => value, translateUIMessage: (value) => value },
    "react-native": { StyleSheet: { create: (value) => value } },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "@react-navigation/native": { useFocusEffect() {} },
    "../utils/botanistRecords": { submissionStatus: (value) => { const status = String(value).toLowerCase(); return status === "approved" ? "approved" : status === "rejected" ? "rejected" : ["pending", "pending review"].includes(status) ? "pending" : status; } },
    "../utils/useBotanistRecords": { useBotanistRecords() {} }, "../utils/plantApi": { plantApi() {} },
    "../utils/apiConfiguration": { mobileApiUrl: () => "https://example.invalid" },
    "../utils/faceSession": { faceSession: {} }, "@expo/vector-icons/Ionicons": { default: "Ionicons" },
    "../utils/useBotanistNotifications": { useBotanistNotifications() {} },
    "../utils/botanistNotifications": { ownedNotificationObservation() {} },
  });
}

const plant30History = () => ({ history_available: true, versions: [
  { id: "registration-30", plant_id: 30, version_number: 1, status: "Approved", owner_subject: "staff:owner", edited_by: "staff:owner",
    created_at: "2026-11-16T09:40:42.561Z", reviewed_at: "2026-11-16T13:09:55.394Z", reviewed_by: "staff:officer",
    change_id: null, snapshot: { plant_id: 30, observation_id: "registration-observation", observation_revision: 1,
      scientific_name: "Recorded plant", content: { heightCm: 10 } } },
  { id: "registration-approval-30", plant_id: 30, version_number: 2, status: "Approved", owner_subject: "staff:owner", edited_by: "staff:owner",
    created_at: "2026-11-16T13:09:55.394Z", reviewed_at: "2026-11-16T13:09:55.394Z", reviewed_by: "staff:officer",
    change_id: null, snapshot: { plant_id: 30, observation_id: "registration-observation", observation_revision: 2,
      scientific_name: "Recorded plant", content: { heightCm: 10 }, review_provenance: { kind: "plant",
        submission_id: "registration-observation", review_id: "registration-review", evidence_type: "approval_capture",
        source_submitted_history_id: "registration-30" } } },
  { id: "observation-approval-30", plant_id: 30, version_number: 3, status: "Approved", owner_subject: "staff:owner", edited_by: "staff:owner",
    created_at: "2026-11-17T01:29:45.299Z", reviewed_at: "2026-11-17T01:29:45.299Z", reviewed_by: "staff:officer",
    change_id: null, snapshot: { plant_id: 30, observation_id: "subsequent-observation", observation_revision: 3,
      scientific_name: "Recorded plant", content: { heightCm: 20 }, review_provenance: { kind: "plant",
        submission_id: "subsequent-observation", review_id: "observation-review", evidence_type: "approval_capture",
        source_submitted_history_id: null } } },
], prior_changes: [] });

function translatedSubmissions(language = "en") {
  const catalog = JSON.parse(read(`translations/${language}.json`));
  return submissionsUtils((key, options) => {
    let value = key.split(".").reduce((object, part) => object?.[part], catalog) || key;
    for (const [name, replacement] of Object.entries(options || {})) value = value.replace(`{{${name}}}`, String(replacement));
    return value;
  });
}

test("Plant 30 approval-capture response presents one Original and keeps subsequent Observations out of Plant edits", () => {
  for (const language of ["en", "ms", "zh"]) {
    const dashboard = translatedSubmissions(language), response = plant30History(), before = JSON.stringify(response);
    const rows = dashboard.versionCardItems("plant", 30, response);
    const group = dashboard.buildSubmissionGroups([{ id: 30, status: "Approved" }], "plant", { "plant:30": rows })[0];
    assert.equal(rows.length, 1); assert.equal(group.versionCount, 1);
    assert.equal(rows[0].versionId, "registration-30"); assert.equal(rows[0].original, true);
    assert.equal(rows[0].current, true); assert.equal(rows[0].superseded, false); assert.equal(rows[0].edited, false);
    assert.equal(dashboard.groupStatusSummary(group).detailKey, undefined);
    const catalog = JSON.parse(read(`translations/${language}.json`));
    assert.equal(dashboard.versionDisplayLabel(rows[0]), catalog.recordEdits.originalLabel);
    assert.equal(dashboard.versionDetailParams(rows[0], { id: "owner" }).versionId, "registration-30");
    assert.equal(JSON.stringify(response), before, "API history is never mutated or deleted");
    assert.deepEqual(dashboard.submissionVersionRoute(rows[0], { id: "owner" }), ["BotanistPlantDetail", { plantId: 30, botanist: { id: "owner" } }]);
  }
});

test("actual Plant edits and correction revisions retain exact identifiers and dense Edit numbering despite approval snapshots", () => {
  const dashboard = translatedSubmissions(), response = plant30History();
  response.versions.push(
    { id: "edit-a-r1", version_number: 4, change_id: "edit-a", change_revision: 1, status: "Superseded", owner_subject: "staff:owner", snapshot: { observation_id: "registration-observation" } },
    { id: "edit-a-r2", version_number: 5, change_id: "edit-a", change_revision: 2, status: "Approved", owner_subject: "staff:owner", snapshot: { observation_id: "registration-observation" } },
    { id: "edit-b-r1", version_number: 6, change_id: "edit-b", change_revision: 1, status: "Pending Review", owner_subject: "staff:owner", snapshot: { observation_id: "registration-observation" } },
  );
  const rows = dashboard.versionCardItems("plant", 30, response);
  assert.deepEqual(rows.map(dashboard.versionDisplayLabel), ["Original", "Edit 1", "Edit 2", "Edit 3"]);
  assert.equal(rows[2].historyType, "plantCorrection");
  assert.equal(rows[0].superseded, true); assert.equal(rows[2].current, true);
  assert.equal(rows[3].current, false);
  const params = dashboard.submissionVersionRoute(rows[3], { id: "owner" })[1];
  assert.equal(params.versionId, "edit-b-r1"); assert.equal(params.selectedChangeId, "edit-b"); assert.equal(params.selectedChangeRevision, 1);
  assert.equal(dashboard.submissionVersionRoute(rows[3], { id: "other" })[1].selectedChangeId, undefined);
  const corrected = dashboard.versionDetailParams(rows[2], { id: "owner" });
  assert.equal(corrected.versionId, "edit-a-r2"); assert.equal(corrected.historicalVersionNumber, 5);
});

test("direct Plant correction is recognized from its owned same-Observation snapshot chain, not from null change_id", () => {
  const dashboard = translatedSubmissions();
  const original = { observation_id: "initial", scientific_name: "Plant", content: { heightCm: 10 } };
  const rows = dashboard.versionCardItems("plant", 8, { history_available: true, versions: [
    { id: "v1", version_number: 1, owner_subject: "staff:owner", edited_by: "staff:owner", status: "Correction Required", snapshot: original },
    { id: "v2", version_number: 2, owner_subject: "staff:owner", edited_by: "staff:owner", status: "Approved", previous_snapshot: original,
      snapshot: { ...original, content: { heightCm: 12 } } },
  ] });
  assert.deepEqual(rows.map(dashboard.versionDisplayLabel), ["Original", "Edit 1"]);
  assert.equal(rows[1].historyType, "plantCorrection");
  const response = { history_available: true, versions: [rows[0].raw,
    { ...plant30History().versions[2], plant_id: 8, id: "intervening-observation-approval", version_number: 2,
      snapshot: { ...plant30History().versions[2].snapshot, plant_id: 8 } },
    { ...rows[1].raw, id: "corrected-v3", version_number: 3 },
  ] };
  const corrected = dashboard.versionCardItems("plant", 8, response);
  const group = dashboard.buildSubmissionGroups([{ id: 8, status: "Approved" }], "plant", { "plant:8": corrected })[0];
  assert.equal(group.versions[0].correctionResolved, true);
  assert.equal(dashboard.versionDisplayLabel(group.versions.at(-1)), "Edit 1");
});

test("missing or contradictory provenance remains a neutral snapshot and never fabricates a Plant edit", () => {
  const dashboard = translatedSubmissions(), response = plant30History();
  const capture = response.versions[2];
  const orphan = dashboard.versionCardItems("plant", 30, { history_available: true, versions: [capture] });
  assert.equal(dashboard.versionDisplayLabel(orphan[0]), "Approval snapshot");
  assert.equal(orphan[0].current, false); assert.equal(orphan[0].edited, false);
  response.versions[2].snapshot.review_provenance.submission_id = "different-observation";
  const rows = dashboard.versionCardItems("plant", 30, response);
  assert.equal(dashboard.versionDisplayLabel(rows.at(-1)), "Historical snapshot");
  assert.equal(rows.at(-1).edited, false);
  const partial = dashboard.versionCardItems("plant", 30, { history_available: true, versions: [
    { id: "late-edit", version_number: 55, change_id: "known-edit", status: "Pending Review", snapshot: {} },
  ] });
  assert.equal(partial[0].plantEditNumber, undefined, "a truncated history cannot establish an edit ordinal");
  assert.equal(dashboard.versionDisplayLabel(partial[0]), "Edit");
});

test("separate version cards preserve API status and only mark the latest approved version current", () => {
  const dashboard = submissionsUtils();
  const response = { history_available: true, versions: [
    { id: "v1", version_number: 1, status: "Approved", created_at: "2026-01-01", snapshot: { scientific_name: "Shorea old" } },
    { id: "v2", version_number: 2, status: "Approved", created_at: "2026-02-01", snapshot: { scientific_name: "Shorea current" } },
    { id: "v3", version_number: 3, status: "Pending Review", created_at: "2026-03-01", snapshot: { scientific_name: "Shorea pending" } },
    { id: "v4", version_number: 4, status: "Rejected", created_at: "2026-04-01", snapshot: { scientific_name: "Shorea rejected" } },
  ], prior_changes: [{ id: "legacy-1", status: "Rejected", created_at: "2025-12-01", proposed_snapshot: { scientific_name: "Shorea legacy" } }] };
  const cards = dashboard.versionCardItems("plant", 8, response);
  assert.deepEqual(cards.map((row) => row.key), ["change:legacy-1", "version:v1", "version:v2", "version:v3", "version:v4"]);
  const original = cards.find((row) => row.key === "version:v1");
  const approved = cards.find((row) => row.key === "version:v2");
  const pending = cards.find((row) => row.key === "version:v3");
  const rejected = cards.find((row) => row.key === "version:v4");
  const legacy = cards.find((row) => row.key === "change:legacy-1");
  assert.equal(original.original, true);
  assert.equal(original.status, "Approved", "the backend approval status remains visible alongside the UI superseded label");
  assert.equal(original.superseded, true);
  assert.equal(approved.current, true);
  assert.equal(approved.status, "Approved");
  assert.equal(pending.current, false);
  assert.equal(pending.status, "Pending Review");
  assert.equal(rejected.status, "Rejected");
  assert.equal(legacy.versionNumber, undefined, "legacy proposals do not get invented version numbers");
  const pendingParams = dashboard.versionDetailParams(pending, { id: "owner" });
  assert.equal(pendingParams.historicalRecordDetail, true);
  assert.equal(pendingParams.versionId, "v3");
  assert.equal(pendingParams.historicalSnapshot.scientific_name, "Shorea pending");
  const legacyParams = dashboard.versionDetailParams(legacy, { id: "owner" });
  assert.equal(legacyParams.priorChangeId, "legacy-1");
  assert.equal(legacyParams.historicalSnapshot.scientific_name, "Shorea legacy");
  const pendingOnly = dashboard.versionCardItems("species", 4, { history_available: true, versions: [
    { id: "s1", version_number: 1, status: "Pending Review", snapshot: {} },
    { id: "s2", version_number: 2, status: "Rejected", snapshot: {} },
  ] });
  assert.equal(pendingOnly.some((row) => row.current), false, "without an approved version there is no current-version badge");
  const editPending = dashboard.versionCardItems("plant", 9, { history_available: true, versions: [
    { id: "p1", version_number: 1, status: "Approved", snapshot: {} },
    { id: "p2", version_number: 2, status: "Pending Review", snapshot: {} },
  ] });
  assert.equal(editPending[0].current, true, "a pending edit does not supersede the approved original");
  assert.equal(editPending[1].current, false);
  const editRejected = dashboard.versionCardItems("plant", 10, { history_available: true, versions: [
    { id: "r1", version_number: 1, status: "Approved", snapshot: {} },
    { id: "r2", version_number: 2, status: "Rejected", snapshot: {} },
  ] });
  assert.equal(editRejected[0].current, true, "a rejected edit does not supersede the approved original");
  assert.equal(editRejected[1].current, false);
  const editApproved = dashboard.versionCardItems("plant", 11, { history_available: true, versions: [
    { id: "a1", version_number: 1, status: "Superseded", snapshot: {} },
    { id: "a2", version_number: 2, status: "Approved", snapshot: {} },
  ] });
  assert.equal(editApproved[0].status, "Superseded", "an API superseded state remains visible without inventing prior approval");
  assert.equal(editApproved[1].current, true);
  const legacyApproved = dashboard.versionCardItems("species", 12, { history_available: true,
    versions: [{ id: "s-base", version_number: 1, status: "Approved", created_at: "2025-01-01", snapshot: {} }],
    prior_changes: [{ id: "legacy-approved", status: "Approved", created_at: "2025-02-01", proposed_snapshot: {} }] });
  assert.equal(legacyApproved.find((row) => row.key === "change:legacy-approved").current, true,
    "an approved legacy change is current when its API timestamp is newer than tracked approved snapshots");
  assert.equal(dashboard.versionCardItems("plant", 8, { history_available: false, versions: [] }).length, 0);
});

test("My Submissions supplements missing Plant history with owned requests in every review state", () => {
  const dashboard = submissionsUtils();
  const recordChanges = [
    { id: "rejected-edit", plant_id: 8, owner_subject: "staff:owner", status: "Rejected", review_comment: "Clarify the leaf shape.",
      created_at: "2026-05-02T00:00:00Z", base_snapshot: { scientific_name: "Original plant" }, proposed_snapshot: { scientific_name: "Rejected plant edit" } },
    { id: "cancelled-edit", plant_id: 8, owner_subject: "staff:owner", status: "Cancelled", review_comment: "Previous feedback retained.",
      created_at: "2026-05-03T00:00:00Z", base_snapshot: { scientific_name: "Original plant" }, proposed_snapshot: { scientific_name: "Cancelled plant edit" } },
    { id: "different-plant", plant_id: 9, owner_subject: "staff:owner", status: "Approved", created_at: "2026-05-04T00:00:00Z",
      base_snapshot: {}, proposed_snapshot: { scientific_name: "Other plant" } },
    { id: "other-botanist", plant_id: 8, owner_subject: "staff:other", status: "Rejected", created_at: "2026-05-05T00:00:00Z",
      base_snapshot: {}, proposed_snapshot: { scientific_name: "Private edit" } },
  ];
  const complete = dashboard.mergeRecordChangeSubmissions("plant", 8,
    { history_available: true, versions: [], prior_changes: [] }, recordChanges.filter((row) => row.owner_subject === "staff:owner"));
  const cards = dashboard.versionCardItems("plant", 8, complete);
  assert.deepEqual(cards.map((row) => row.status), ["Rejected", "Cancelled"]);
  assert.ok(dashboard.filterSubmissionGroups(dashboard.buildSubmissionGroups([
    { id: 8, status: "Approved", registeredAt: "2025-01-01T00:00:00Z" },
  ], "plant", { "plant:8": cards }), "rejected").length);
  assert.equal(dashboard.versionDetailParams(cards[0], { id: "owner" }).historicalReviewComment, "Clarify the leaf shape.");
  assert.equal(cards.some((row) => row.title === "Private edit" || row.title === "Other plant"), false);
});

test("live record-change status overrides stale version status by exact change ID across edits to one Plant", () => {
  const dashboard = submissionsUtils();
  const currentChanges = [
    { id: "plant24-edit-2", plant_id: 24, owner_subject: "staff:owner", revision: 2, status: "Rejected",
      review_comment: "Please correct the leaf description.", reviewed_by: "staff:officer", reviewed_at: "2026-11-12T10:00:00Z" },
    { id: "plant24-edit-3", plant_id: 24, owner_subject: "staff:owner", revision: 1, status: "Pending Review", review_comment: null },
    { id: "plant24-edit-4", plant_id: 24, owner_subject: "staff:owner", revision: 2, status: "Correction Required", review_comment: "Add a location." },
    { id: "plant24-edit-5", plant_id: 24, owner_subject: "staff:owner", revision: 1, status: "Approved", review_comment: "Approved." },
    { id: "plant24-edit-6", plant_id: 24, owner_subject: "staff:owner", revision: 1, status: "Cancelled", review_comment: "Prior note." },
    { id: "another-plant-edit", plant_id: 25, owner_subject: "staff:owner", status: "Approved", review_comment: "Different plant" },
  ];
  const merged = dashboard.mergeRecordChangeSubmissions("plant", 24, {
    history_available: true,
    versions: [
      { id: "version-24-2", change_id: "plant24-edit-2", version_number: 3, status: "Pending Review", review_comment: null,
        snapshot: { scientific_name: "Plant 24 Edit 2" } },
      { id: "version-24-3", change_id: "plant24-edit-3", version_number: 4, status: "Correction Required",
        review_comment: "Earlier feedback", snapshot: { scientific_name: "Plant 24 Edit 3" } },
      { id: "version-24-4", change_id: "plant24-edit-4", version_number: 5, status: "Pending Review", snapshot: {} },
      { id: "version-24-5", change_id: "plant24-edit-5", version_number: 6, status: "Rejected", snapshot: {} },
      { id: "version-24-6", change_id: "plant24-edit-6", version_number: 7, status: "Pending Review", snapshot: {} },
      // A version row ID is not a change ID; never infer a match from revision or target alone.
      { id: "plant24-edit-2", version_number: 5, status: "Pending Review", snapshot: { scientific_name: "Unlinked history row" } },
    ],
    prior_changes: [],
  }, currentChanges);
  const cards = dashboard.versionCardItems("plant", 24, merged);
  assert.deepEqual(cards.map((row) => row.status), ["Rejected", "Pending Review", "Correction Required", "Pending Review", "Approved", "Cancelled"]);
  assert.equal(cards[0].raw.review_comment, "Please correct the leaf description.");
  assert.equal(cards[1].priorChangeId, "plant24-edit-3", "version history retains its exact linked edit request ID");
  assert.equal(cards[1].raw.owner_subject, "staff:owner", "ownership comes from the owner-scoped current request list");
  assert.equal(cards[0].raw.reviewed_by, "staff:officer");
  assert.equal(cards[1].raw.review_comment, null, "current status and feedback replace stale correction feedback");
  assert.equal(cards[2].raw.review_comment, "Add a location.");
  assert.equal(cards[3].raw.review_comment, undefined, "an unrelated version row remains unmatched");
  assert.equal(cards[4].raw.review_comment, "Approved.");
  assert.equal(cards[5].raw.review_comment, "Prior note.");
  assert.ok(dashboard.filterSubmissionGroups(dashboard.buildSubmissionGroups([
    { id: 24, status: "Approved" },
  ], "plant", { "plant:24": cards }), "rejected").length, "the rejected edit remains visible under its actual status");
});

test("record-change refresh updates only the matching revision and leaves ambiguous legacy history untouched", () => {
  const dashboard = submissionsUtils();
  const change = { id: "plant24-edit", plant_id: 24, owner_subject: "staff:owner", revision: 2,
    status: "Approved", review_comment: "Current revision approved." };
  const merged = dashboard.mergeRecordChangeSubmissions("plant", 24, {
    history_available: true,
    versions: [
      { id: "edit-r1", change_id: change.id, change_revision: 1, status: "Rejected", review_comment: "Earlier decision." },
      { id: "edit-r2", change_id: change.id, change_revision: 2, status: "Pending Review", review_comment: null },
      { id: "legacy-r1", change_id: "legacy-edit", status: "Pending Review" },
      { id: "legacy-r2", change_id: "legacy-edit", status: "Correction Required" },
    ], prior_changes: [],
  }, [change, { id: "legacy-edit", plant_id: 24, owner_subject: "staff:owner", revision: 2, status: "Rejected" }]);
  assert.deepEqual(merged.versions.map((version) => version.status),
    ["Rejected", "Approved", "Pending Review", "Correction Required"]);
  assert.equal(merged.versions[0].review_comment, "Earlier decision.");
  assert.equal(merged.versions[1].review_comment, "Current revision approved.");
});

test("a rejected original Plant submission follows its own reviewed observation after refresh", () => {
  const dashboard = submissionsUtils();
  const plant = { plant_id: 20, registered_subject: "staff:owner", rbac_status: "Pending Review", registered_at: "2026-11-12T00:00:00Z", scientific_name: "JN test 12/11" };
  const observation = { id: "plant20-original", plant_id: 20, owner_subject: "staff:owner", origin_type: "initial_registration", status: "Pending Review", created_at: "2026-11-12T00:00:00Z", content: {} };
  const before = fixture().projectBotanistRecords("owner", [plant], [observation], []).plants[0];
  const reviewed = fixture().projectBotanistRecords("owner", [plant], [{ ...observation, status: "Rejected", review_decision: "Rejected", review_comment: "request correction~" }], []).plants[0];
  assert.equal(before.initialSubmissionStatus, "Pending Review");
  assert.equal(before.status, "Pending Review");
  assert.equal(reviewed.initialSubmissionStatus, "Rejected");
  assert.equal(reviewed.status, "Rejected", "Plant Details must use the reviewed Original status, not stale Plant RBAC");
  assert.equal(reviewed.currentStatus, "Rejected");
  assert.equal(reviewed.initialObservation.review_comment, "request correction~");
  assert.equal(fixture().canWithdrawOriginalPlant(reviewed, "owner"), false);
  const fallback = dashboard.buildSubmissionGroups([reviewed], "plant")[0];
  assert.equal(fallback.versionCount, 1);
  assert.equal(fallback.versions[0].status, "Rejected");
  assert.equal(dashboard.groupStatusSummary(fallback).status, "Rejected");
  const staleVersion = dashboard.versionCardItems("plant", "20", { history_available: true, versions: [
    { id: "plant20-v1", version_number: 1, status: "Pending Review", snapshot: { observation_id: observation.id } },
  ] });
  assert.equal(dashboard.buildSubmissionGroups([reviewed], "plant", { "plant:20": staleVersion })[0].versions[0].status, "Rejected");
});

test("Plant Details status follows the exact Original review while approved and withdrawn records keep their current state", () => {
  const records = fixture();
  const plant = { ...rows[0], plant_id: 20, rbac_status: "Pending Review" };
  const original = { ...observations[0], id: "original-20", plant_id: 20, origin_type: "initial_registration", review_comment: "Original feedback" };
  for (const status of ["Pending Review", "Correction Required", "Rejected", "Approved"]) {
    const projected = records.projectBotanistRecords("owner", [plant], [{ ...original, status }], []).plants[0];
    assert.equal(projected.status, status);
    assert.equal(projected.initialSubmissionStatus, status);
  }
  const approved = records.projectBotanistRecords("owner", [{ ...plant, rbac_status: "Approved" }],
    [{ ...original, status: "Correction Required" }, { ...original, id: "later-20", origin_type: "subsequent_observation", status: "Pending Review", created_at: "2026-11-13T00:00:00Z", review_comment: "Unrelated feedback" }], []).plants[0];
  assert.equal(approved.status, "Approved");
  assert.equal(approved.initialObservation.review_comment, "Original feedback");
  assert.equal(approved.latestObservation.review_comment, "Unrelated feedback");
  const withdrawn = records.projectBotanistRecords("owner", [{ ...plant, rbac_status: "Withdrawn" }],
    [{ ...original, status: "Pending Review" }], []).plants[0];
  assert.equal(withdrawn.status, "Withdrawn");
});

test("Plant 21 correction and approved Edit 1 stay distinct; only the current version opens editable details", () => {
  const dashboard = submissionsUtils();
  const record = { id: 21, status: "Approved", registeredAt: "2026-11-12T00:00:00Z", initialSubmissionStatus: "Approved" };
  const rows = dashboard.versionCardItems("plant", "21", { history_available: true, versions: [
    { id: "plant21-v1", version_number: 1, status: "Correction Required", created_at: "2026-11-12T00:00:00Z", snapshot: { scientific_name: "JN NEW New" } },
    { id: "plant21-v2", version_number: 2, change_id: "plant21-edit", change_revision: 1, status: "Approved", created_at: "2026-11-13T00:00:00Z", snapshot: { scientific_name: "JN NEW New" } },
  ] });
  const group = dashboard.buildSubmissionGroups([record], "plant", { "plant:21": rows })[0];
  assert.equal(group.versionCount, 2);
  assert.deepEqual(group.versions.map((row) => [row.status, Boolean(row.current), Boolean(row.superseded)]), [
    ["Correction Required", false, false], ["Approved", true, false],
  ]);
  assert.equal(dashboard.groupStatusSummary(group).detailKey, "currentEditSummary");
  assert.equal(dashboard.submissionVersionRoute(group.versions[0], { id: "owner" })[1].historicalRecordDetail, true);
  assert.deepEqual(dashboard.submissionVersionRoute(group.versions[1], { id: "owner" })[1],
    { plantId: "21", botanist: { id: "owner" } });
});

test("Plant and Species originals show resolved correction only for an approved, directly linked resubmission", () => {
  const dashboard = submissionsUtils();
  for (const kind of ["plant", "species"]) {
    const recordKey = kind === "plant" ? "observation_id" : "request_id";
    const originalSnapshot = { [recordKey]: kind === "plant" ? "observation-21" : 21, scientific_name: "Original value", content: { notes: "Before correction" } };
    const base = { id: `${kind}-v1`, version_number: 1, status: "Correction Required", owner_subject: "staff:owner",
      review_comment: "Please correct the details.", reviewed_at: "2026-11-12T10:00:00Z", snapshot: originalSnapshot };
    const correction = { id: `${kind}-v2`, version_number: 2, status: "Approved", owner_subject: "staff:owner",
      edited_by: "staff:owner", change_id: null, previous_snapshot: originalSnapshot,
      snapshot: { ...originalSnapshot, scientific_name: "Corrected value" } };
    const groups = (second) => {
      const rows = dashboard.versionCardItems(kind, 21, { history_available: true, versions: [base, second] });
      const record = kind === "plant" ? { id: 21, status: "Approved" } : { request_id: 21, request_status: "Approved" };
      return dashboard.buildSubmissionGroups([record], kind, { [`${kind}:21`]: rows })[0];
    };
    const approved = groups(correction);
    assert.deepEqual(approved.versions.map((row) => row.status), ["Correction Required", "Approved"]);
    assert.equal(approved.versions[0].correctionResolved, true);
    assert.equal(approved.versions[0].current, false);
    assert.equal(approved.versions[1].current, true);
    assert.equal(dashboard.groupStatusSummary(approved).status, "Approved");
    const originalDetail = dashboard.versionDetailParams(approved.versions[0], { id: "owner" });
    assert.equal(originalDetail.historicalVersionStatus, "Correction Required");
    assert.equal(originalDetail.historicalReviewComment, "Please correct the details.");
    assert.equal(originalDetail.historicalReviewedAt, "2026-11-12T10:00:00Z");
    assert.equal(dashboard.submissionVersionRoute(approved.versions[0], { id: "owner" })[1].historicalRecordDetail, true);

    for (const unverified of [
      { ...correction, status: "Pending Review" },
      { ...correction, status: "Rejected" },
      { ...correction, previous_snapshot: undefined },
      { ...correction, previous_snapshot: { ...originalSnapshot, scientific_name: "Another snapshot" } },
      { ...correction, owner_subject: "staff:other" },
      { ...correction, change_id: "independent-edit" },
    ]) assert.equal(groups(unverified).versions[0].correctionResolved, undefined,
      `${kind}: an active, rejected, or unlinked request must retain Correction Required`);
    assert.equal(groups({ ...correction, status: "Rejected" }).versions[1].current, false);
  }
});

test("My Submissions renders the resolved label while keeping the Original review decision in its route", () => {
  const messages = JSON.parse(read("translations/en.json"));
  const t = (key) => key.split(".").reduce((value, part) => value?.[part], messages) || key;
  const snapshot = { observation_id: "observation-21", scientific_name: "Plant 21" };
  const versions = [
    { id: "plant21-v1", version_number: 1, status: "Correction Required", owner_subject: "staff:owner",
      review_comment: "Correct the original.", snapshot },
    { id: "plant21-v2", version_number: 2, status: "Approved", owner_subject: "staff:owner", edited_by: "staff:owner",
      previous_snapshot: snapshot, snapshot: { ...snapshot, scientific_name: "Corrected Plant 21" } },
  ];
  let stateIndex = 0;
  const slots = [{ "plant:21": submissionsUtils().versionCardItems("plant", 21, { history_available: true, versions }) },
    { "plant:21": true }, false, false, { "plant:21": true }, "plants", "all"];
  const native = { StyleSheet: { create: (value) => value }, useWindowDimensions: () => ({ width: 390 }), Alert: { alert() {} } };
  for (const name of ["View", "Text", "TextInput", "TouchableOpacity", "FlatList", "ScrollView", "Image", "ActivityIndicator", "RefreshControl"]) native[name] = name;
  const screen = moduleFrom("screens/BotanistDashboard.js", {
    react: { ...React, useCallback: (callback) => callback, useEffect() {}, useRef: (initial) => ({ current: initial }),
      useState: (initial) => { const i = stateIndex++; return [slots[i] ?? initial, () => {}]; } },
    "react-native": native, "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "@react-navigation/native": { useFocusEffect() {} },
    "../translations/i18n": { useAppTranslation() {}, t, translateLabel: (value) => value, translateUIMessage: (value) => value },
    "../components/LanguageSelector": { default: "LanguageSelector" }, "@expo/vector-icons/Ionicons": { default: "Icon" },
    "../components/fieldFormStyles": { fieldFormStyles: { submitButton: {}, submitButtonText: {} } },
    "../utils/botanistRecords": { submissionStatus: (value) => value === "Approved" ? "approved" : value === "Rejected" ? "rejected" : String(value).toLowerCase() },
    "../utils/useBotanistRecords": { useBotanistRecords: () => ({ plants: [{ id: 21, status: "Approved", scientificName: "Plant 21" }], requests: [], recordChanges: [],
      loading: false, loaded: true, error: "", refresh() {} }) },
    "../utils/plantApi": { plantApi() {} }, "../utils/apiConfiguration": { mobileApiUrl: () => "https://example.invalid" },
    "../utils/faceSession": { faceSession: {} }, "../utils/useBotanistNotifications": { useBotanistNotifications() {} },
    "../utils/botanistNotifications": { ownedNotificationObservation() {} },
  });
  const tree = screen.BotanistSubmissionsScreen({ route: { params: { botanist: { id: "owner" } } }, navigation: { navigate() {}, goBack() {} } });
  const children = (node) => node && typeof node === "object" ? React.Children.toArray(node.props?.children) : [];
  const text = (node) => typeof node === "string" ? node : children(node).map(text).join(" ");
  const find = (node, predicate) => predicate(node) ? node : children(node).map((child) => find(child, predicate)).find(Boolean);
  const list = find(tree, (node) => node?.type === "FlatList");
  const card = list.props.renderItem({ item: list.props.data[0] });
  const original = find(card, (node) => node?.props?.testID === "submission-version-plant:21-version:plant21-v1");
  const current = find(card, (node) => node?.props?.testID === "submission-version-plant:21-version:plant21-v2");
  assert.ok(text(original).includes("Correction Resolved"));
  assert.ok(text(original).includes("Superseded"));
  assert.equal(original.props.accessibilityLabel, "Original, Correction Resolved, Superseded");
  assert.ok(text(current).includes("Approved"));
  assert.ok(text(current).includes("Current Version"));
});

test("Plant history shows withdrawal only for the exact active edit and never for Superseded Original", async () => {
  const dashboard = submissionsUtils();
  const changes = [
    { id: "plant24-edit-2", plant_id: 24, owner_subject: "staff:owner", status: "Rejected", revision: 1 },
    { id: "plant24-edit-3", plant_id: 24, owner_subject: "staff:owner", status: "Pending Review", revision: 1 },
  ];
  const history = dashboard.mergeRecordChangeSubmissions("plant", 24, { history_available: true,
    versions: [
      { id: "v24-1", version_number: 1, status: "Superseded", created_at: "2026-01-01", snapshot: { plant_id: 24, observation_id: "original-24", scientific_name: "Plant 24", species_details: { scientific_name: "Species 24" } } },
      { id: "v24-3", change_id: "plant24-edit-3", change_revision: 1, owner_subject: "staff:owner", version_number: 3, status: "Correction Required", created_at: "2026-11-13", snapshot: { plant_id: 24, scientific_name: "Plant 24 Edit 3", species_details: { scientific_name: "Species 24" } } },
    ], prior_changes: [] }, changes);
  const cards = dashboard.versionCardItems("plant", 24, history);
  const group = dashboard.buildSubmissionGroups([{ id: 24, status: "Approved", registeredAt: "2026-01-01" }], "plant", { "plant:24": cards })[0];
  const edit3 = group.versions.find((row) => row.priorChangeId === "plant24-edit-3");
  const [screenName, params] = dashboard.submissionVersionRoute(edit3, { id: "owner", name: "Botanist" });
  assert.equal(screenName, "BotanistPlantDetail");
  assert.equal(params.plantId, 24);
  assert.equal(params.versionId, "v24-3", "version ID remains distinct from request ID");
  assert.equal(params.selectedChangeId, "plant24-edit-3");
  assert.equal(params.selectedChangeRevision, 1);
  assert.equal(params.historicalRecordDetail, true);

  let index = 0, slots = [], focus;
  const hooks = { ...React, useCallback: (fn) => fn, useRef: (initial) => ({ current: initial }), useState: (initial) => {
    const i = index++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
    return [slots[i], (next) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }];
  } };
  let alertArgs, cancelFails = false, requestReadFails = false, originalEditable = false; const calls = [], navigations = [];
  const native = { StyleSheet: { create: (value) => value }, Alert: { alert: (...args) => { alertArgs = args; } }, Platform: { OS: "ios" }, UIManager: {}, LayoutAnimation: { Presets: { easeInEaseOut: "ease" }, configureNext() {} } };
  for (const name of ["View", "Text", "TextInput", "TouchableOpacity", "ScrollView", "Image", "Modal", "ActivityIndicator", "RefreshControl"]) native[name] = name;
  const screen = moduleFrom("screens/BotanistPlantDetail.js", { react: hooks, "react-native": native,
    "@react-navigation/native": { useFocusEffect: (fn) => { focus = fn; } },
    "@expo/vector-icons/Ionicons": { default: "Ionicons" },
    "../utils/botanistRecords": { canWithdrawOriginalPlant: () => false, fetchBotanistPlant: async () => { throw Error("historical navigation must not load the current record"); },
      fetchBotanistRecordChangeStatus: async (_owner, kind, target) => {
        assert.equal(kind, "plant"); assert.equal(String(target), "24");
        return { available: true, pending: changes.find((change) => change.id === params.selectedChangeId), latest: changes[1] };
      } },
    "../utils/plantApi": { plantApi: async (path) => { calls.push(path); if (path.endsWith("/withdrawal")) return { eligible: true, editable: originalEditable, observation_id: "original-24" };
      if (path === "/record-changes/plant24-edit-3") {
        if (requestReadFails) throw Error("request lookup failed");
        return { change: changes[1] };
      }
      if (path.endsWith("/cancel")) { if (cancelFails) throw Error("cancel failed"); changes[1].status = "Cancelled"; }
      return {}; }, fetchSpeciesDetail: async () => ({}),
      getPlantRegisteredByDisplayName: (_plant, _user, fallback) => fallback },
    "../utils/plantPhotoGallery": { stepPhotoIndex: () => 0 },
    "../translations/i18n": { useAppTranslation() {}, t: (key) => key, translateLabel: (value) => value,
      translateFieldValue: (_label, value) => value, translateUIMessage: (value) => value },
    "../data/mockData": { botanistPlantRecords: [], botanistSpeciesRequests: [], plants: [] },
    "../components/EditAction": { default: "EditAction" },
    "../components/OriginalUpdatedField": { default: ({ children }) => React.createElement("View", null, children) },
  });
  const route = { params: { ...params, botanist: { id: "owner", name: "Botanist" } } };
  const render = () => { index = 0; return screen.default({ route, navigation: { navigate: (...args) => navigations.push(args), goBack() {} } }); };
  const children = (node) => node && typeof node === "object" ? React.Children.toArray(node.props?.children) : [];
  const text = (node) => typeof node === "string" ? node : children(node).map(text).join(" ");
  function find(node, predicate) { if (!node || typeof node !== "object") return null; if (predicate(node)) return node;
    for (const child of children(node)) { const match = find(child, predicate); if (match) return match; } return null; }
  render(); const cleanup = focus();
  assert.equal(find(render(), (node) => node?.props?.testID === "withdraw-pending-plant-edit"), null,
    "the button waits for the exact owned request response");
  await new Promise((resolve) => setImmediate(resolve)); const tree = render();
  const cancelButton = find(tree, (node) => node?.props?.testID === "withdraw-pending-plant-edit");
  assert.ok(cancelButton, "owner's exact active Pending Review request renders its withdrawal button");
  assert.equal(find(tree, (node) => node?.props?.testID === "edit-own-plant"), null,
    "an approved-record edit proposal remains read-only while awaiting Officer review");
  assert.ok(find(find(tree, (node) => node?.props?.testID === "historical-plant-heading"),
    (node) => node?.props?.testID === "withdraw-pending-plant-edit"), "edit withdrawal is beside the Plant Record title");
  assert.equal(find(find(tree, (node) => node?.props?.testID === "historical-plant-record-meta"),
    (node) => node?.props?.testID === "withdraw-pending-plant-edit"), null, "the Record ID card contains no trash icon");
  assert.equal(cancelButton.props.accessibilityLabel, "plantWithdrawal.editAction");
  assert.ok(text(tree).includes("Plant 24 Edit 3"));
  cancelButton.props.onPress();
  assert.equal(alertArgs[0], "plantWithdrawal.editConfirmTitle");
  assert.equal(alertArgs[1], "plantWithdrawal.editConfirmMessage");
  assert.equal(calls.some((path) => path.endsWith("/cancel")), false);
  cancelFails = true; await alertArgs[2][1].onPress();
  assert.ok(find(render(), (node) => node?.props?.testID === "withdraw-pending-plant-edit"), "failed cancellation leaves the request actionable");
  cancelFails = false; cancelButton.props.onPress(); await alertArgs[2][1].onPress();
  assert.ok(calls.includes("/record-changes/plant24-edit-3/cancel"), "the exact request ID, not the Plant or version ID, is submitted");
  assert.equal(find(render(), (node) => node?.props?.testID === "withdraw-pending-plant-edit"), null);
  assert.ok(text(render()).includes("Cancelled"));
  cleanup();
  requestReadFails = true;
  route.params = { ...params, botanist: { id: "owner", name: "Botanist" } };
  render(); const failedReadCleanup = focus(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(find(render(), (node) => node?.props?.testID === "withdraw-pending-plant-edit"), null,
    "a failed request lookup cannot grant cancellation");
  failedReadCleanup(); requestReadFails = false;
  changes[1].revision = 2;
  route.params = { ...params, botanist: { id: "owner", name: "Botanist" } };
  render(); const staleCleanup = focus(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(find(render(), (node) => node?.props?.testID === "withdraw-pending-plant-edit"), null,
    "a newer request revision cannot be withdrawn from an older version card");
  staleCleanup();
  route.params = { ...route.params, selectedChangeId: undefined, historicalOriginal: true,
    historicalOriginalSubmissionWithdrawalCandidate: false,
    historicalSnapshot: { plant_id: 24, observation_id: "original-24", scientific_name: "Plant 24 Original" },
    historicalVersionStatus: "Superseded", historicalSuperseded: true, submissionVersionLabel: "Original" };
  render(); const originalCleanup = focus(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(find(render(), (node) => node?.props?.testID === "withdraw-original-plant"), null,
    "Superseded Original never shows withdrawal even when the live Plant is eligible");
  assert.equal(find(render(), (node) => node?.props?.testID === "edit-own-plant"), null);
  originalCleanup();
  route.params = { ...route.params, historicalOriginal: false,
    historicalOriginalSubmissionWithdrawalCandidate: true, historicalVersionStatus: "Pending Review",
    historicalSuperseded: false, historicalVersionNumber: 3, submissionVersionLabel: "Edit 2" };
  render(); const pendingOriginalCleanup = focus(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(find(render(), (node) => node?.props?.testID === "edit-own-plant"), null,
    "the current Pending Review revision remains read-only when the backend says it is not editable");
  pendingOriginalCleanup(); originalEditable = true;
  render(); const editableCleanup = focus(); await new Promise((resolve) => setImmediate(resolve));
  const editButton = find(render(), (node) => node?.props?.testID === "edit-own-plant");
  assert.ok(editButton, "the newest backend-authorized Pending Review revision shows Edit");
  editButton.props.onPress();
  assert.deepEqual(navigations.at(-1), ["EditPlant", { plantId: "24", botanist: { id: "owner", name: "Botanist" },
    pendingObservationId: "original-24", pendingRevision: 3, pendingStatus: "Pending Review", correction: false }]);
  const originalRevisionButton = find(render(), (node) => node?.props?.testID === "withdraw-original-plant");
  assert.ok(originalRevisionButton, "the active pending revision of an original submission uses original withdrawal eligibility");
  assert.ok(find(find(render(), (node) => node?.props?.testID === "historical-plant-heading"),
    (node) => node?.props?.testID === "withdraw-original-plant"));
  assert.equal(find(render(), (node) => node?.props?.testID === "withdraw-pending-plant-edit"), null);
  originalRevisionButton.props.onPress();
  assert.equal(alertArgs[0], "plantWithdrawal.confirmTitle", "an original revision is not described as an edit request");
  await alertArgs[2][1].onPress();
  assert.ok(calls.includes("/plant-submissions/24/withdraw"));
  editableCleanup();
});

test("real Plant history shape marks only the newest unlinked pending original revision", () => {
  const dashboard = submissionsUtils();
  const record = { id: 13, registeredBy: "staff:owner", status: "Pending Review",
    initialObservationId: "original-13", initialObservation: { id: "original-13", revision: 3 } };
  const response = { history_available: true, versions: [
    { id: "v3", plant_id: 13, version_number: 3, status: "Pending Review", change_id: null,
      owner_subject: "staff:owner", snapshot: { plant_id: 13, observation_id: "original-13" } },
    { id: "v1", plant_id: 13, version_number: 1, status: "Superseded", change_id: null,
      owner_subject: "staff:owner", snapshot: { plant_id: 13, observation_id: "original-13" } },
    { id: "v2", plant_id: 13, version_number: 2, status: "Superseded", change_id: null,
      owner_subject: "staff:owner", snapshot: { plant_id: 13, observation_id: "original-13" } },
  ] };
  const group = dashboard.buildSubmissionGroups([record], "plant", { "plant:13": dashboard.versionCardItems("plant", 13, response) })[0];
  assert.deepEqual(group.versions.filter((row) => row.originalSubmissionWithdrawalCandidate).map((row) => row.versionNumber), [3]);
  const pending = group.versions.find((row) => row.versionNumber === 3);
  const original = group.versions.find((row) => row.versionNumber === 1);
  const previousEdit = group.versions.find((row) => row.versionNumber === 2);
  assert.equal(dashboard.submissionVersionRoute(pending, { id: "owner" })[1].historicalOriginalSubmissionWithdrawalCandidate, true);
  assert.equal(dashboard.submissionVersionRoute(pending, { id: "owner" })[1].selectedChangeId, undefined);
  assert.equal(dashboard.submissionVersionRoute(pending, { id: "other" })[1].historicalOriginalSubmissionWithdrawalCandidate, false);
  assert.equal(dashboard.submissionVersionRoute(original, { id: "owner" })[1].historicalOriginalSubmissionWithdrawalCandidate, false);
  assert.equal(dashboard.submissionVersionRoute(previousEdit, { id: "owner" })[1].historicalOriginalSubmissionWithdrawalCandidate, false);
  assert.equal(dashboard.submissionVersionRoute(pending, { id: "other" })[1].selectedChangeId, undefined);
});

test("Plant version route identifies only owner-linked active edit versions", () => {
  const dashboard = submissionsUtils();
  const owner = { id: "owner" };
  const base = { kind: "plant", targetId: 24, priorChangeId: "edit-2", changeRevision: 1,
    versionId: "version-2", versionNumber: 2, status: "Pending Review",
    raw: { owner_subject: "staff:owner" }, snapshot: { plant_id: 24 } };
  const route = (row, botanist = owner) => dashboard.submissionVersionRoute({ ...base, ...row }, botanist)[1];
  assert.equal(route({}).selectedChangeId, "edit-2");
  assert.equal(route({}).selectedChangeRevision, 1);
  for (const status of ["Withdrawn", "Approved", "Rejected", "Superseded", "Cancelled"])
    assert.equal(route({ status }).selectedChangeId, undefined, status);
  assert.equal(route({ superseded: true }).selectedChangeId, undefined);
  assert.equal(route({ original: true }).selectedChangeId, undefined);
  assert.equal(route({}, { id: "other" }).selectedChangeId, undefined);
  assert.equal(route({ priorChangeId: undefined }).selectedChangeId, undefined,
    "an unlinked version cannot use its version ID as a request ID");
  const newer = route({ priorChangeId: "edit-3", versionId: "version-3", versionNumber: 3 });
  assert.equal(newer.selectedChangeId, "edit-3");
  assert.equal(newer.versionId, "version-3");
});

test("Plant 13 legacy Pending Review Edit 1 remains read-only without a linked change request", async () => {
  const dashboard = submissionsUtils();
  const response = { history_available: true, versions: [
    { id: "plant13-v1", plant_id: 13, version_number: 1, status: "Superseded", change_id: null, owner_subject: "staff:owner", snapshot: {} },
    { id: "plant13-v2", plant_id: 13, version_number: 2, status: "Pending Review", change_id: null, owner_subject: "staff:owner", snapshot: {} },
  ], prior_changes: [] };
  const merged = dashboard.mergeRecordChangeSubmissions("plant", 13, response, []);
  const group = dashboard.buildSubmissionGroups([{ id: 13, status: "Pending Review" }], "plant",
    { "plant:13": dashboard.versionCardItems("plant", 13, merged) })[0];
  const edit1 = group.versions.find((row) => row.versionNumber === 2);
  assert.equal(edit1.status, "Pending Review", "the version's live status is displayed accurately");
  assert.equal(edit1.priorChangeId, undefined);
  const [, params] = dashboard.submissionVersionRoute(edit1, { id: "owner" });
  assert.equal(params.versionId, "plant13-v2");
  assert.equal(params.selectedChangeId, undefined, "historical version IDs must not become cancellation request IDs");
  const records = fixture(async (path) => path === "/record-changes/capabilities"
    ? { approved_edits_available: true } : path === "/record-changes" ? { changes: [] }
      : (() => { throw Error(`Unexpected path ${path}`); })());
  const status = await records.fetchBotanistRecordChangeStatus("owner", "plant", 13);
  assert.equal(status.pending, null, "the active-request lookup cannot return a request that does not exist");
});

test("submission versions group only by their reliable record IDs and status filters include matching historical versions", () => {
  const dashboard = submissionsUtils();
  const pendingEdit = dashboard.versionCardItems("plant", 13, { history_available: true, versions: [
    { id: "p13-v1", version_number: 1, status: "Approved", created_at: "2026-01-01", snapshot: { scientific_name: "A" } },
    { id: "p13-v2", version_number: 2, status: "Pending Review", created_at: "2026-02-01", snapshot: { scientific_name: "A edit" } },
  ] });
  const parents = [
    { id: 13, commonName: "Same plant name", status: "Pending Review" },
    { id: 14, commonName: "Same plant name", status: "Approved" },
    { id: 15, commonName: "Rejected plant", status: "Rejected" },
    { id: 13, commonName: "Duplicate parent", status: "Pending Review" },
  ];
  const groups = dashboard.buildSubmissionGroups(parents, "plant", { "plant:13": pendingEdit }, { "plant:13": true, "plant:14": true });
  assert.equal(groups.length, 3, "duplicate API rows for one ID do not create duplicate cards");
  assert.equal(groups[0].record.id, 13);
  assert.equal(groups[0].versionCount, 2, "the original and edit stay inside one group");
  assert.equal(groups[0].versions[0].current, true, "pending edit does not supersede the approved original");
  const plant13Edit1 = groups[0].versions[1];
  assert.equal(plant13Edit1.versionNumber, 2);
  assert.equal(plant13Edit1.priorChangeId, undefined, "a version without change_id is not an edit request");
  const [, plant13Route] = dashboard.submissionVersionRoute(plant13Edit1, { id: "owner" });
  assert.equal(plant13Route.historicalRecordDetail, true);
  assert.equal(plant13Route.versionId, "p13-v2");
  assert.equal(plant13Route.selectedChangeId, undefined, "an unlinked pending version cannot borrow another request's cancellation ID");
  assert.deepEqual(dashboard.groupStatusSummary(groups[0]), { status: "Approved", detailKey: "pendingEditCount", count: 1 });
  assert.deepEqual(dashboard.filterSubmissionGroups(groups, "pending").map((group) => group.record.id), [13]);
  assert.deepEqual(dashboard.filterSubmissionGroups(groups, "approved").map((group) => group.record.id), [13, 14]);
  assert.deepEqual(dashboard.filterSubmissionGroups(groups, "rejected").map((group) => group.record.id), [15]);
  assert.equal(groups.find((group) => group.id === "14").versions[0].original, true, "an unedited record with available history is labelled Original");

  const speciesEdit = dashboard.versionCardItems("species", 4, { history_available: true, versions: [
    { id: "s4-v1", version_number: 1, status: "Approved", created_at: "2026-01-01", snapshot: { scientific_name: "Species A" } },
    { id: "s4-v2", version_number: 2, status: "Pending Review", created_at: "2026-02-01", snapshot: { scientific_name: "Species A revised" } },
  ] });
  const speciesGroups = dashboard.buildSubmissionGroups([{ request_id: 4, scientific_name: "Species A" }], "species", { "species:4": speciesEdit }, { "species:4": true });
  assert.equal(speciesGroups.length, 1);
  assert.equal(speciesGroups[0].versionCount, 2, "species edit is grouped with its request ID, not its name");
  assert.deepEqual(dashboard.filterSubmissionGroups(speciesGroups, "pending").map((group) => group.id), ["4"]);
  assert.equal(dashboard.submissionVersionRoute(speciesGroups[0].versions[0], { id: "owner" })[0], "BotanistSpeciesRequestDetail");
  assert.equal(dashboard.submissionVersionRoute(speciesGroups[0].versions[1], { id: "owner" })[1].kind, "species");
  assert.equal(dashboard.submissionVersionRoute(speciesGroups[0].versions[1], { id: "owner" })[1].versionId, "s4-v2");
  const linkedSpecies = dashboard.mergeRecordChangeSubmissions("species", 4, { history_available: true,
    versions: [{ id: "s4-edit-v3", change_id: "species-edit-3", version_number: 3, status: "Pending Review", snapshot: {} }], prior_changes: [] },
  [{ id: "species-edit-3", base_snapshot: { request_id: 4 }, owner_subject: "staff:owner", status: "Pending Review" }]);
  const linkedSpeciesRow = dashboard.versionCardItems("species", 4, linkedSpecies)[0];
  assert.equal(dashboard.submissionVersionRoute(linkedSpeciesRow, { id: "owner" })[1].selectedChangeId, "species-edit-3",
    "Species history passes the exact linked active request ID into its detail route");

  const rejectedEdit = dashboard.versionCardItems("plant", 16, { history_available: true, versions: [
    { id: "r16-v1", version_number: 1, status: "Approved", snapshot: {} },
    { id: "r16-v2", version_number: 2, status: "Rejected", snapshot: {} },
  ] });
  assert.equal(dashboard.groupStatusSummary({ versions: rejectedEdit }).detailKey, "rejectedEditCount");
  assert.equal(rejectedEdit[0].current, true, "rejected edit leaves the approved original current");
  const approvedEdits = dashboard.versionCardItems("plant", 17, { history_available: true, versions: [
    { id: "a17-v1", version_number: 1, status: "Approved", snapshot: {} },
    { id: "a17-v2", version_number: 2, change_id: "a17-edit", change_revision: 1, status: "Approved", snapshot: {} },
    { id: "a17-v3", version_number: 3, change_id: "a17-second-edit", change_revision: 1, status: "Approved", snapshot: {} },
  ] });
  assert.equal(approvedEdits[0].superseded, true);
  assert.equal(approvedEdits[1].superseded, true);
  assert.equal(approvedEdits[2].current, true);
  const approvedSummary = dashboard.groupStatusSummary({ versions: approvedEdits });
  assert.equal(approvedSummary.detailKey, "currentEditSummary");
  assert.equal(approvedSummary.edit.versionNumber, 3);
});

test("historical photo sources use the selected snapshot's authenticated asset references", () => {
  const dashboard = submissionsUtils();
  const photos = dashboard.versionPhotoSources("token", { kind: "plant", detailSnapshot: { photo_refs: [
    { asset_id: "original-asset" }, { change_id: "edit-2", change_photo_index: 1 },
  ] } });
  assert.equal(photos.length, 2);
  assert.match(photos[0].uri, /assets\/original-asset/);
  assert.equal(photos[0].headers.Authorization, "Bearer token");
  assert.match(photos[1].uri, /record-changes\/edit-2\/photos\/1/);
  assert.equal(photos[1].headers.Authorization, "Bearer token");
  assert.deepEqual(dashboard.versionPhotoSources("token", { kind: "plant", snapshot: {} }), [], "missing historical references do not use current plant photos");
  assert.deepEqual(dashboard.versionPhotoSources("token", { kind: "species", priorBase: true, snapshot: { request_id: 4 }, raw: { id: "edit-v2", has_species_photo: true } }), [],
    "an original species snapshot without historical photo references never borrows the current request photo");
  assert.deepEqual(dashboard.versionPhotoSources("token", { kind: "species", priorChangeId: "change-4", detailSnapshot: { request_id: 4 }, raw: { proposal_photo_count: 0 } }), [],
    "a legacy edit with no versioned proposal photo does not substitute the current species photo");
  const historicalSpeciesPhoto = dashboard.versionPhotoSources("token", { kind: "species", versionId: "species-v2", raw: { id: "species-v2", has_species_photo: true } });
  assert.match(historicalSpeciesPhoto[0].uri, /record-versions\/species-v2\/photo/);
  assert.equal(historicalSpeciesPhoto[0].headers.Authorization, "Bearer token");
});

test("legacy edit groups keep the API base snapshot as an original row with correct statuses and navigation", () => {
  const dashboard = submissionsUtils();
  const makeChange = (id, status, created_at, base_snapshot = { scientific_name: "Original species", photo_ids: ["original-photo"] }, proposed_snapshot = { scientific_name: `Edit ${id}` }) => ({
    key: `change:${id}`, kind: "plant", targetId: 8, priorChangeId: id, snapshot: proposed_snapshot,
    title: proposed_snapshot.scientific_name, status, edited: true, createdAt: created_at,
    raw: { id, plant_id: 8, owner_subject: "staff:owner", status, created_at, base_snapshot, proposed_snapshot },
  });
  const record = { id: 8, status: "Approved", registeredAt: "2025-01-01T00:00:00Z", scientificName: "Current record" };
  const pending = dashboard.buildSubmissionGroups([record], "plant", { "plant:8": [
    makeChange("pending-8", "Pending Review", "2025-02-01T00:00:00Z"),
  ] })[0];
  assert.equal(pending.versionCount, 2);
  assert.deepEqual(pending.versions.map((row) => row.original ? "Original" : row.status), ["Original", "Pending Review"]);
  assert.equal(pending.versions[0].status, "Approved");
  assert.equal(pending.versions[0].current, true, "pending edit leaves the approved original current");
  assert.equal(pending.versions[1].current, undefined);
  assert.ok(dashboard.filterSubmissionGroups([pending], "pending").includes(pending), "pending filter retains the whole group");
  const originalParams = dashboard.submissionVersionRoute(pending.versions[0], { id: "owner" })[1];
  assert.equal(dashboard.submissionVersionRoute(pending.versions[0], { id: "owner" })[0], "BotanistPlantDetail");
  assert.equal(originalParams.plantId, "8");
  assert.equal(originalParams.historicalRecordDetail, undefined, "the current approved original opens editable live details");
  const editParams = dashboard.submissionVersionRoute(pending.versions[1], { id: "owner" })[1];
  assert.equal(editParams.priorChangeId, "pending-8");
  assert.equal(editParams.selectedChangeId, "pending-8", "the selected owned active edit ID is carried for live cancellation verification");
  assert.equal(editParams.historicalSnapshot.scientific_name, "Edit pending-8");
  assert.equal(dashboard.submissionVersionRoute(pending.versions[1], { id: "someone-else" })[1].selectedChangeId, undefined,
    "a different Botanist cannot receive a cancellation candidate");
  assert.equal(pending.versions[0].snapshot.scientific_name, "Original species");
  assert.equal(pending.versions[1].snapshot.scientific_name, "Edit pending-8");

  const approved = dashboard.buildSubmissionGroups([record], "plant", { "plant:8": [
    makeChange("approved-8", "Approved", "2025-03-01T00:00:00Z"),
  ] })[0];
  assert.equal(approved.versions[0].superseded, true);
  assert.equal(approved.versions[1].current, true);

  const rejected = dashboard.buildSubmissionGroups([record], "plant", { "plant:8": [
    makeChange("rejected-8", "Rejected", "2025-04-01T00:00:00Z"),
  ] })[0];
  assert.equal(rejected.versions[0].current, true);
  assert.equal(rejected.versions[0].superseded, false);
  assert.equal(rejected.versions[1].status, "Rejected");

  const noBase = dashboard.buildSubmissionGroups([record], "plant", { "plant:8": [
    makeChange("no-base", "Pending Review", "2025-05-01T00:00:00Z", {}),
  ] })[0];
  assert.equal(noBase.versionCount, 1, "an absent historical base is not fabricated");
  assert.equal(noBase.versions[0].original, undefined);

  const previousSnapshotRows = dashboard.versionCardItems("plant", 8, { history_available: true, versions: [
    { id: "tracked-edit", version_number: 2, status: "Pending Review", created_at: "2025-06-01T00:00:00Z",
      previous_snapshot: { scientific_name: "Plant 8 before edit", photo_ids: ["asset-8"] },
      snapshot: { scientific_name: "Plant 8 after edit" } },
  ] });
  const trackedBase = dashboard.buildSubmissionGroups([record], "plant", { "plant:8": previousSnapshotRows })[0];
  assert.equal(trackedBase.versionCount, 2, "version history previous_snapshot can supply a missing original row");
  assert.equal(trackedBase.versions[0].snapshot.scientific_name, "Plant 8 before edit");
  const previousParams = dashboard.submissionVersionRoute(trackedBase.versions[0], { id: "owner" })[1];
  assert.equal(previousParams.plantId, "8");
  assert.equal(previousParams.historicalRecordDetail, undefined, "the current approved base opens live details");

  const multiple = dashboard.buildSubmissionGroups([record], "plant", { "plant:8": [
    makeChange("edit-1", "Rejected", "2025-02-01T00:00:00Z"),
    makeChange("edit-2", "Approved", "2025-03-01T00:00:00Z"),
  ] })[0];
  assert.equal(multiple.versionCount, 3, "one original base plus each linked edit is shown");
  assert.equal(multiple.versions.filter((row) => row.original).length, 1);
  assert.deepEqual(multiple.versions.map((row) => row.original ? "Original" : row.priorChangeId), ["Original", "edit-1", "edit-2"]);
  assert.equal(multiple.versions[1].status, "Rejected");
  assert.equal(multiple.versions[2].current, true);
});

test("Plant Detail mapping shows saved pending botanical fields without treating them as approved GPS", () => {
  const mapped = context.mapBackendPlant({
    ...rows[0],
    latest_submission: { heightCm: 0, healthStatus: "Healthy", lifeStage: "Seedling", morphology: "Young leaves", notes: "Observed", taxonomy: "Family A", latitude: 4.5, longitude: 113.7, zone: "Pending zone" },
  });
  assert.equal(mapped.latestSubmission.heightCm, 0);
  assert.equal(mapped.latestSubmission.lifeStage, "Seedling");
  assert.equal(mapped.latestSubmission.morphology, "Young leaves");
  assert.equal(mapped.latestSubmission.notes, "Observed");
  assert.equal(mapped.latestSubmission.taxonomy, "Family A");
  assert.equal(mapped.latestSubmission.latitude, undefined);
  assert.equal(mapped.latestSubmission.zone, undefined);
  assert.equal(mapped.location.latitude, null);
  assert.equal(mapped.location.longitude, null);
});

test("an owner-scoped pending plant detail maps its server-authorized submitted GPS values", () => {
  const mapped = context.mapBackendPlant({
    plant_id: 44,
    registered_subject: "staff:owner",
    rbac_status: "Pending Review",
    latitude: 4.5,
    longitude: 113.7,
    accuracy_m: 5,
    altitude_m: 30,
    zone: "Zone B",
    latest_submission: { content: { latitude: 4.5, longitude: 113.7, accuracy_m: 5, altitudeM: 30, zone: "Zone B" } },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(mapped.location)), {
    restricted: false, latitude: 4.5, longitude: 113.7, accuracyM: 5, altitudeM: 30, zone: "Zone B",
  });
});

test("Field Record Timeline resolves the signed-in profile name only for its confirmed observation owner", () => {
  const ownerObservation = context.mapBackendObservation({ id: "obs-1", owner_subject: "staff:owner", status: "Approved" });
  const otherObservation = context.mapBackendObservation({ id: "obs-2", owner_subject: "staff:other", status: "Approved" });
  assert.equal(context.getObservationRecorderDisplayName(ownerObservation, { id: "owner", name: "Amina Botanist" }, "Unknown Botanist"), "Amina Botanist");
  assert.equal(context.getObservationRecorderDisplayName(otherObservation, { id: "owner", name: "Amina Botanist" }, "Unknown Botanist"), "Unknown Botanist");
  assert.equal(context.getObservationRecorderDisplayName(ownerObservation, { id: "owner" }, "Unknown Botanist"), "Unknown Botanist");
  assert.equal(context.getObservationRecorderDisplayName({ ...otherObservation, recordedByName: "Daniel Botanist" }, { id: "owner", name: "Amina Botanist" }, "Unknown Botanist"), "Daniel Botanist");
  const verified = context.mapBackendObservation({ id: "obs-3", owner_subject: "staff:other", status: "Pending Review",
    recorded_by_name: "Daniel Botanist", content: { status: "Approved", recorded_by_name: "Forged name" } });
  assert.equal(verified.status, "Pending Review");
  assert.equal(verified.recordedByName, "Daniel Botanist");

  const detailSource = read("screens/PlantDetail.js");
  const staffSectionIndex = detailSource.indexOf("STAFF RECORD");
  const addObservationIndex = detailSource.indexOf('<View style={styles.addObservationSection}>');
  const latestVerifiedIndex = detailSource.indexOf("LATEST VERIFIED OBSERVATION");
  const historyIndex = detailSource.indexOf("OBSERVATION HISTORY", addObservationIndex);
  assert.ok(staffSectionIndex < latestVerifiedIndex && latestVerifiedIndex < addObservationIndex && addObservationIndex < historyIndex);
  assert.match(detailSource, /const showLatestVerifiedObservation = isBotanist && \["approved", "pending review"\]\.includes\(currentPlantStatus\);/);
  assert.match(detailSource, /const showObservationHistory = isBotanist && currentPlantStatus === "approved";/);
  assert.equal((detailSource.match(/\{showLatestVerifiedObservation && \(/g) || []).length, 1);
  assert.equal((detailSource.match(/\{showObservationHistory && \(/g) || []).length, 2);
  assert.match(detailSource, /disabled=\{!canAddObservation\}/);
  assert.match(detailSource, /key=\{observation\.observationId\}/);
  assert.match(detailSource, /getObservationRecorderDisplayName\(observation, user/);
  assert.match(detailSource, /getObservationRecorderDisplayName\(detailsObservation, user/);
  assert.match(detailSource, /selectLatestApprovedObservation\(plant\.observations \|\| \[\]\)/);
  assert.match(detailSource, /selectOwnedPendingPlantObservation\(plant, user\?\.id\)/);
  assert.match(detailSource, /<ObservationPhotos photos=\{detailsObservation\.photos\}/);
  assert.match(detailSource, /<ObservationPhotos photos=\{observation\.photos\}/);
  assert.match(detailSource, /observation\.taxonomy/);
  assert.match(detailSource, /detailsObservation \? \(/);
  assert.match(detailSource, /plantDetail\.latestSubmittedObservation/);
  assert.match(detailSource, /plantDetail\.noSubmittedObservationAvailable/);
  assert.match(detailSource, /styles\.pendingBadge, styles\.pendingText, styles\.submittedObservationBadge/);
  assert.match(detailSource, /noVerifiedObservationAvailable/);
  assert.match(detailSource, /\{isBotanist && \(/);
  assert.match(detailSource, /t\("plantDetail\.fieldObservation"\)/);
  assert.doesNotMatch(detailSource, /<Text style=\{styles\.observationId\}>\s*\{observation\.observationId\}/);
});

test("pending submitted values never replace an approved observation", () => {
  const mapped = context.mapBackendPlant({
    ...rows[1],
    latest_approved: { heightCm: 25, lifeStage: "Mature", morphology: "Approved morphology" },
    latest_submission: { heightCm: 99, lifeStage: "Pending stage", morphology: "Pending morphology", latitude: 4.5, longitude: 113.7 },
  });
  assert.equal(mapped.latestApproved.heightCm, 25);
  assert.equal(mapped.latestApproved.lifeStage, "Mature");
  assert.equal(mapped.latestSubmission, null);
});

test("latest verified selection uses recorded date, not a later edit or pending observation", () => {
  const latest = context.selectLatestApprovedObservation([
    { observationId: "old-approved", status: "Approved", date: "2026-01-01", updatedAt: "2026-01-01", heightCm: 10 },
    { observationId: "edited-approved", status: "Approved", date: "2025-12-01", updatedAt: "2026-02-01", heightCm: 20 },
    { observationId: "new-pending", status: "Pending Review", date: "2026-03-01", updatedAt: "2026-03-01", heightCm: 99 },
  ]);
  assert.equal(latest.observationId, "old-approved");
  assert.equal(latest.heightCm, 10);
  assert.equal(context.selectLatestApprovedObservation([
    { observationId: "A", status: "Approved", date: "2026-01-01", heightCm: 10 },
    { observationId: "B", status: "Approved", date: "2026-01-02", updatedAt: "2026-02-01", heightCm: 20 },
    { observationId: "C", status: "Rejected", date: "2026-01-03", heightCm: 99 },
  ]).observationId, "B");
  assert.equal(context.selectLatestApprovedObservation([
    { observationId: "A", status: "Approved", date: "2026-01-01" },
    { observationId: "B", status: "Approved", date: "2026-01-01" },
  ]).observationId, "B", "equal observation dates use a deterministic ID tie-breaker");
  assert.equal(context.selectLatestApprovedObservation([{ observationId: "C", status: "Pending Review", date: "2026-01-03" }]), null);
});

test("zero latitude and longitude remain valid mapped coordinates", () => {
  const mapped = context.mapBackendPlant({ plant_id: 20, rbac_status: "Approved", latitude: 0, longitude: 0 });
  assert.equal(mapped.location.latitude, 0);
  assert.equal(mapped.location.longitude, 0);
});

test("restricted coordinates remain hidden and display as restricted", () => {
  const mapped = context.mapBackendPlant({ plant_id: 21, rbac_status: "Approved", gps_access_restricted: true, latitude: null, longitude: null });
  assert.equal(mapped.location.latitude, null);
  assert.equal(getPlantLocationDisplay(mapped.location, "Botanist").status, "restricted");
});

test("Species Detail filters by species and renders each plant ID once", () => {
  const rows = [
    { id: "8", plantId: "8", speciesId: "6" },
    { id: "11", plantId: "11", speciesId: "6" },
    { id: "8", plantId: "8", speciesId: "6", stale: true },
    { id: "20", plantId: "20", speciesId: "7" },
  ];
  assert.deepEqual(context.filterUniqueSpeciesPlantRecords(rows, "6", "unused").map((row) => row.id), ["8", "11"]);
});

test("projection uses immutable subject ownership and keeps pending plant, observation, request and names distinct", () => {
  const api = fixture();
  const result = api.projectBotanistRecords("owner", rows, observations, requests);
  assert.equal(result.plants.length, 1); assert.equal(result.plants[0].id, "8");
  assert.equal(result.plants[0].status, "Pending Review"); assert.equal(result.plants[0].height, 80);
  assert.equal(result.plants[0].scientificName, "Manual plant name"); assert.equal(result.plants[0].speciesDetails.scientificName, "Different species name");
  assert.equal(result.plants[0].speciesRequestId, 1); assert.equal(result.requests.length, 1);
  assert.equal(result.plants[0].latestObservation.id, "observation-8");
  assert.equal(api.projectBotanistRecords("another-account", rows, observations, requests).plants.length, 0);
});

test("My Submissions keeps the Botanist's own Pending Review and Rejected Species requests", () => {
  const owned = [
    { request_id: 31, requested_by: "staff:owner", request_status: "Pending Review", scientific_name: "Pending species" },
    { request_id: 32, requested_by: "staff:owner", request_status: "Rejected", scientific_name: "Rejected species" },
    { request_id: 33, requested_by: "staff:other", request_status: "Pending Review", scientific_name: "Private species" },
  ];
  const projection = fixture().projectBotanistRecords("owner", [], [], owned);
  assert.deepEqual(projection.requests.map((request) => [request.request_id, request.request_status]), [
    [31, "Pending Review"], [32, "Rejected"],
  ]);
  const dashboard = submissionsUtils();
  const groups = dashboard.buildSubmissionGroups(projection.requests, "species");
  assert.deepEqual(groups.map((group) => dashboard.groupStatusSummary(group).status), ["Rejected", "Pending Review"],
    "the Requests tab retains each owned request's real status; display order follows recent record activity");
  assert.equal(groups.some((group) => String(group.id) === "33"), false,
    "another Botanist's private Species submission never enters this owner's view");
});

test("Plant status falls back to the authorized current Observation status if the separate Observation read is unavailable", () => {
  const plant = { ...rows[0], observation_status: "Rejected" };
  const result = fixture().projectBotanistRecords("owner", [plant], [], []);
  assert.equal(result.plants[0].currentStatus, "Rejected");
  assert.equal(result.plants[0].status, "Rejected");
});

test("Rejected owner Plant remains in My Submissions when stored version rows are stale", () => {
  const ownerPlant = fixture().projectBotanistRecords("owner", [{
    plant_id: 42, species_id: 6, registered_subject: "staff:owner", scientific_name: "Rejected plant",
    rbac_status: "Pending Review", observation_status: "Rejected",
  }], [], []).plants[0];
  const dashboard = submissionsUtils();
  const groups = dashboard.buildSubmissionGroups([ownerPlant], "plant", {
    "plant:42": dashboard.versionCardItems("plant", 42, { history_available: true, versions: [
      { id: "v1", version_number: 1, status: "Pending Review", snapshot: { observation_id: "obs-42" } },
      { id: "v2", version_number: 2, status: "Pending Review", snapshot: { observation_id: "obs-42" } },
    ] }),
  });
  assert.equal(groups.length, 1);
  assert.equal(dashboard.groupStatusSummary(groups[0]).status, "Rejected");
  assert.deepEqual(dashboard.filterSubmissionGroups(groups, "rejected").map((group) => group.record.id), ["42"]);
  assert.equal(dashboard.filterSubmissionGroups(groups, "approved").length, 0);

  const otherOwner = fixture().projectBotanistRecords("other", [{
    plant_id: 42, species_id: 6, registered_subject: "staff:owner", rbac_status: "Pending Review", observation_status: "Rejected",
  }], [], []).plants;
  assert.equal(otherOwner.length, 0, "the live status override does not bypass Botanist ownership filtering");
});
test("loader binds every API call to the account and detail loads owned photo sources", async () => {
  const calls = [];
  const api = fixture(async (path, options) => { calls.push([path, options]); return path === "/plants?scope=mine" ? { plants: rows } : path === "/plants/8?scope=mine" ? { plant: rows[0] } : path === "/observations?scope=mine" ? { observations } : path === "/assets?plant_id=8&scope=mine" ? { assets: [{ id: "asset-8" }] } : { species_requests: requests }; });
  const result = await api.fetchBotanistRecords("owner"); assert.equal(result.plants.length, 1);
  assert.equal(calls.length, 5); assert.ok(calls.every(([, options]) => options.expectedAccountId === "owner"));
  const detail = await api.fetchBotanistPlant("owner", "8");
  assert.equal(detail.photos[0].owner, "owner"); assert.equal(detail.photos[0].uri, "https://example.invalid/assets/asset-8");
  assert.ok(calls.some(([path, options]) => path === "/assets?plant_id=8&scope=mine" && options.expectedAccountId === "owner"));
});
test("approved Plant Details use registration values rather than later Observation values", () => {
  const result = fixture().projectBotanistRecords("owner", [
    { plant_id: "8", species_id: "6", registered_subject: "staff:owner", rbac_status: "Approved", latest_approved: { heightCm: 52, healthStatus: "Healthy", lifeStage: "Mature", morphology: "Approved leaf form" }, current_registration: { state: "available", content: { heightCm: 52, healthStatus: "Healthy", lifeStage: "Mature", morphology: "Approved leaf form" }, photo_ids: [] } },
  ], [
    { id: "pending-edit", plant_id: "8", owner_subject: "staff:owner", status: "Pending Review", content: { heightCm: 99, healthStatus: "Poor", lifeStage: "Seedling", morphology: "Unreviewed proposal" }, created_at: "2026-11-09T00:00:00Z" },
    { id: "approved-observation", plant_id: "8", owner_subject: "staff:owner", status: "Approved", content: { heightCm: 52, healthStatus: "Healthy", lifeStage: "Mature", morphology: "Approved leaf form" }, created_at: "2026-11-01T00:00:00Z" },
  ], []);
  assert.equal(result.plants[0].height, 52);
  assert.equal(result.plants[0].healthStatus, "Healthy");
  assert.equal(result.plants[0].growthStage, "Mature");
  assert.equal(result.plants[0].morphology, "Approved leaf form");
  assert.equal(result.plants[0].latestObservation.id, "pending-edit", "the pending observation remains available to its existing correction workflow");
});
test("focus/manual refresh share one in-flight read; late responses cannot replace a newer visit", async () => {
  const api = fixture(), old = deferred(), current = deferred(), updates = []; let reads = 0;
  const loader = api.createBotanistRecordsLoader(() => (++reads === 1 ? old.promise : current.promise), (state) => updates.push(state));
  const focus = loader.refresh(), pull = loader.refresh(); assert.equal(focus, pull);
  await Promise.resolve(); assert.equal(reads, 1);
  loader.cancel(); const next = loader.refresh(); await Promise.resolve(); assert.equal(reads, 2);
  old.resolve({ plants: ["stale"], requests: [], observations: [] }); await focus;
  assert.equal(updates.at(-1).loading, true);
  current.resolve({ plants: ["latest"], requests: [], observations: [] }); await next;
  assert.equal(loader.getState().plants[0], "latest"); assert.equal(loader.getState().loaded, true);
});
test("read errors are shown without silently replacing successful data with empty lists; retry works", async () => {
  const api = fixture(); let fail = false;
  const loader = api.createBotanistRecordsLoader(async () => { if (fail) throw Error("Offline"); return { plants: ["saved"], observations: [], requests: [] }; }, () => {});
  await loader.refresh(); fail = true; await loader.refresh();
  assert.equal(loader.getState().plants[0], "saved"); assert.equal(loader.getState().error, "Offline");
  fail = false; await loader.refresh(); assert.equal(loader.getState().error, "");
});
test("an observation gateway failure does not hide successfully returned owned plants and species requests", async () => {
  const api = fixture(async (path) => {
    if (path === "/observations?scope=mine") throw Object.assign(Error("Gateway unavailable"), { status: 502, transient: true });
    return path === "/plants?scope=mine" ? { plants: rows } : { species_requests: requests };
  });
  const result = await api.fetchBotanistRecords("owner");
  assert.equal(result.plants.length, 1); assert.equal(result.plants[0].id, "8");
  assert.equal(result.requests.length, 1); assert.equal(result.plants[0].status, "Pending Review");
  assert.equal(result.warnings.length, 1); assert.match(result.warnings[0], /observation updates/);
  const loader = api.createBotanistRecordsLoader(() => api.fetchBotanistRecords("owner"), () => {});
  await loader.refresh(); assert.equal(loader.getState().plants.length, 1); assert.match(loader.getState().error, /observation updates/);
});
test("expired or changed account credentials clear previously loaded private records", async () => {
  const api = fixture(); let failure;
  const loader = api.createBotanistRecordsLoader(async () => { if (failure) throw failure; return { plants: rows, requests, observations }; }, () => {});
  await loader.refresh(); failure = Object.assign(Error("Session expired"), { status: 401, code: "SESSION_REQUIRED" });
  await loader.refresh(); assert.equal(loader.getState().plants.length, 0); assert.equal(loader.getState().requests.length, 0);
  assert.equal(loader.getState().loaded, false); assert.match(loader.getState().error, /Session expired/);
});
test("actual focus hook reads once per focus, avoids rerender loops and refreshes on return", async () => {
  const api = fixture(); let reads = 0, focus, slots = [], index = 0;
  const hooks = { useState: (initial) => { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], (value) => { slots[i] = value; }]; },
    useMemo: (fn, deps) => { const i = index++; if (!slots[i] || deps.some((d, j) => d !== slots[i].deps[j])) slots[i] = { deps, value: fn() }; return slots[i].value; } };
  hooks.useCallback = (fn, deps) => hooks.useMemo(() => fn, deps);
  const hook = moduleFrom("utils/useBotanistRecords.js", { react: hooks, "@react-navigation/native": { useFocusEffect: (fn) => { focus = fn; } }, "react-native": { AppState: { addEventListener: () => ({ remove() {} }) } }, "./botanistRecords": { ...api, fetchBotanistRecords: async () => { reads++; return { plants: rows, observations, requests }; } } });
  const render = () => { index = 0; return hook.useBotanistRecords("owner"); };
  render(); const firstFocus = focus, cleanup = focus();
  await render().refresh(); assert.equal(reads, 1); render(); assert.equal(focus, firstFocus);
  cleanup(); focus(); await render().refresh(); assert.equal(reads, 2);
});
test("actual plant detail loads the existing owned ID from API and displays its separate species information", async () => {
  let index = 0, slots = [], focus, requested;
  const hooks = { ...React, useCallback: (fn) => fn, useRef: (initial) => ({ current: initial }), useState: (initial) => {
    const i = index++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
    return [slots[i], (next) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }];
  } };
  const messages = JSON.parse(read("translations/en.json"));
  const t = (key) => key.split(".").reduce((a, k) => a?.[k], messages) || key;
  let historyCalls = 0, openedRoutes = [], goBackCalls = 0, pendingChange = null, availabilityError = false, plantLoadFails = false;
  let alertArgs, withdrawalCalls = 0, originalEditable = true;
  const native = { StyleSheet: { create: (v) => v }, Alert: { alert: (...args) => { alertArgs = args; } }, Platform: { OS: "ios" }, UIManager: {}, LayoutAnimation: { Presets: { easeInEaseOut: "ease" }, configureNext: () => {} } };
  for (const name of ["View", "Text", "TextInput", "TouchableOpacity", "ScrollView", "Image", "Modal", "ActivityIndicator"]) native[name] = name;
  const record = fixture().projectBotanistRecords("owner", rows, observations, requests).plants[0];
  record.observations = record.observations.map((observation) => ({ ...observation, origin_type: "initial_registration" }));
  record.isHistoricalVersion = false;
  record.photos = [{ uri: "https://example.invalid/assets/private", headers: { Authorization: "Bearer test-only" } }];
  const screen = moduleFrom("screens/BotanistPlantDetail.js", { react: hooks, "react-native": native,
    "@react-navigation/native": { useFocusEffect: (fn) => { focus = fn; } },
    "../utils/botanistRecords": { canWithdrawOriginalPlant: fixture().canWithdrawOriginalPlant, fetchBotanistPlant: async (...args) => { requested = args; if (plantLoadFails) throw Error("plant detail network failure"); return record; }, fetchBotanistRecordChangeStatus: async () => {
      if (availabilityError) throw Error("offline");
      return { available: true, pending: pendingChange, latest: pendingChange };
    } },
    "../utils/plantApi": { getPlantRegisteredByDisplayName: (plant, user, fallback) => plant.registeredBy === `staff:${user?.id}` ? user?.name || fallback : fallback, plantApi: async (path) => { if (path.endsWith("/withdrawal")) return { eligible: originalEditable, editable: originalEditable, observation_id: "observation-8" }; if (path.endsWith("/withdraw")) { withdrawalCalls++; return { withdrawn: true }; } historyCalls++; return path.startsWith("/record-versions?") ? { history_available: true, versions: [{ id: "v2", version_number: 2, status: "Pending Review", created_at: "2026-11-04T00:00:00Z", edited_by: "staff:owner", previous_snapshot: { scientific_name: "Old name" }, snapshot: { scientific_name: "New name" } }], prior_changes: [] } : { version: {} }; } },
    "@expo/vector-icons/Ionicons": { default: "Ionicons" },
    "../utils/plantPhotoGallery": { stepPhotoIndex: (index, direction, count) => count < 2 ? 0 : (index + direction + count) % count },
    "../translations/i18n": { useAppTranslation: () => {}, t, translateLabel: (v) => v, translateFieldValue: (_, v) => v, translateUIMessage: (v) => v },
    "../data/mockData": { botanistPlantRecords: [], botanistSpeciesRequests: [], plants: [] },
    "../components/EditAction": { default: "EditAction" },
    "../components/OriginalUpdatedField": { default: ({ children }) => React.createElement("View", null, children) },
  });
  const render = () => { index = 0; return screen.default({ route: { params: { plantId: "8", botanist: { id: "owner", name: "Owner" } } }, navigation: { navigate: (...args) => openedRoutes.push(args), goBack() { goBackCalls++; } } }); };
  const initialTree = render();
  const initialSkeleton = (function find(node) { if (!node || typeof node !== "object") return null; if (node.type === "DetailSkeletonContent") return node; for (const child of React.Children.toArray(node.props?.children)) { const match = find(child); if (match) return match; } return null; })(initialTree);
  assert.equal(initialSkeleton?.props.label, "Loading plant record...");
  assert.ok(!JSON.stringify(initialTree).includes("Loading your saved records..."));
  const cleanup = focus(); await new Promise((resolve) => setImmediate(resolve)); const tree = render();
  assert.deepEqual(requested, ["owner", "8"]);
  const children = (node) => node && typeof node === "object" ? React.Children.toArray(node.props?.children) : [];
  const text = (node) => typeof node === "string" ? node : children(node).map(text).join(" ");
  function find(predicate, node) { if (predicate(node)) return node; for (const child of children(node)) { const result = find(predicate, child); if (result) return result; } }
  assert.ok(text(tree).includes("Manual plant name")); assert.ok(text(tree).includes("Different species name"));
  assert.ok(text(tree).includes("Pending Review")); assert.equal(find((n) => n?.type === "EditAction" && n.props.testID === "edit-own-plant", tree).props.disabled, false);
  assert.equal(find((n) => n?.type === "Image", tree).props.source.headers.Authorization, "Bearer test-only");
  assert.ok(text(tree).includes("Plant Photos"));
  assert.ok(!text(tree).includes("Edit History"), "Plant Details does not render the Edit History section");
  assert.equal(historyCalls, 0, "Plant Details no longer loads history for the removed section");
  assert.equal(find((node) => node?.props?.label === "Back to Dashboard", tree), undefined, "Plant Details has no redundant bottom Back to Dashboard button");
  assert.equal(goBackCalls, 0, "removing the bottom button does not invoke its navigation callback");
  cleanup(); originalEditable = false;
  render(); const blockedCleanup = focus(); await new Promise((resolve) => setImmediate(resolve));
  const blockedTree = render();
  assert.equal(find((node) => node?.type === "EditAction" && node.props.testID === "edit-own-plant", blockedTree), undefined);
  assert.equal(find((node) => node?.props?.testID === "withdraw-original-plant", blockedTree), undefined);
  blockedCleanup(); originalEditable = true;
  render(); const resumedCleanup = focus(); await new Promise((resolve) => setImmediate(resolve));
  const withdrawAction = find((node) => node?.props?.testID === "withdraw-original-plant", render());
  assert.ok(withdrawAction, "eligible Original Plant shows withdrawal beside its heading");
  const heading = find((node) => node?.props?.testID === "plant-detail-heading", render());
  assert.ok(find((node) => node?.props?.testID === "withdraw-original-plant", heading));
  assert.equal(find((node) => node?.props?.testID === "withdraw-original-plant",
    find((node) => node?.props?.testID === "plant-record-meta", render())), undefined);
  assert.ok(find((node) => node?.props?.testID === "plant-record-meta", tree));
  withdrawAction.props.onPress();
  assert.equal(alertArgs[0], "Withdraw Plant Submission?");
  assert.equal(withdrawalCalls, 0, "opening confirmation does not withdraw");
  await alertArgs[2][1].onPress();
  assert.equal(withdrawalCalls, 1);
  assert.equal(find((node) => node?.props?.testID === "withdraw-original-plant", render()), undefined);
  assert.ok(text(render()).includes("Withdrawn"));
  for (const language of ["en", "ms", "zh"]) {
    const translated = JSON.parse(read(`translations/${language}.json`));
    assert.ok(translated.botanistPlantDetail.backToDashboard, `${language} Back to Dashboard translation remains available`);
  }
  resumedCleanup();
  record.status = "Approved";
  render(); const approvedCleanup = focus(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(find((n) => n?.type === "EditAction" && n.props.testID === "edit-own-plant", render()).props.disabled, false);
  assert.equal(find((n) => n?.props?.testID === "withdraw-original-plant", render()), undefined);
  approvedCleanup();
  pendingChange = { status: "Pending Review", review_comment: "Please wait" };
  render(); const pendingCleanup = focus(); await new Promise((resolve) => setImmediate(resolve));
  const pendingTree = render();
  const unavailableAction = find((n) => n?.type === "EditAction" && n.props.testID === "edit-own-plant", pendingTree);
  assert.equal(unavailableAction.props.disabled, true);
  assert.equal(unavailableAction.props.labelKey, "recordEdits.editUnavailable");
  assert.ok(text(pendingTree).includes("An edit is already awaiting review."));
  pendingCleanup();
  pendingChange = null; availabilityError = true;
  render(); const failedCheckCleanup = focus(); await new Promise((resolve) => setImmediate(resolve));
  const failedCheckTree = render();
  assert.equal(find((n) => n?.type === "EditAction" && n.props.testID === "edit-own-plant", failedCheckTree).props.disabled, true);
  assert.ok(text(failedCheckTree).includes("Unable to check edit availability."));
  failedCheckCleanup();
  availabilityError = false; record.status = "Correction Required";
  render(); const correctionCleanup = focus(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(find((n) => n?.type === "EditAction" && n.props.testID === "edit-own-plant", render()).props.disabled, false);
  correctionCleanup();
  record.status = "Rejected";
  record.initialObservation = { ...record.initialObservation, status: "Rejected", review_comment: "request correction~" };
  record.latestObservation = { ...record.latestObservation, status: "Pending Review", review_comment: "Other observation feedback" };
  render(); const rejectedCleanup = focus(); await new Promise((resolve) => setImmediate(resolve));
  const rejectedTree = render();
  const rejectedMeta = find((node) => node?.props?.testID === "plant-record-meta", rejectedTree);
  assert.ok(text(rejectedMeta).includes("Rejected"), "the Original detail summary displays its reviewed status");
  const rejectedBanner = find((node) => node?.props?.testID === "plant-rejected-banner", rejectedTree);
  assert.ok(rejectedBanner, "rejected submissions display a prominent rejection banner");
  assert.ok(text(rejectedBanner).includes("Submission Rejected"));
  assert.ok((Array.isArray(rejectedMeta.props.style) ? rejectedMeta.props.style : [rejectedMeta.props.style])
    .some((style) => style?.backgroundColor === "#FDECEC"), "the Record ID panel uses a light red background");
  const rejectedBadge = find((node) => node?.type === "View" &&
    (Array.isArray(node?.props?.style) ? node.props.style : [node?.props?.style]).some((style) => style?.backgroundColor === "#B42318"), rejectedMeta);
  assert.ok(rejectedBadge, "Rejected uses a solid red badge");
  const rejectedBadgeLabel = find((node) => node?.type === "Text" && text(node).includes("Rejected") &&
    (Array.isArray(node?.props?.style) ? node.props.style : [node?.props?.style]).some((style) => style?.color === "#FFFFFF"), rejectedMeta);
  assert.ok(rejectedBadgeLabel, "the Rejected badge label is white");
  const rejectedFeedback = find((node) => node?.props?.testID === "plant-rejected-feedback", rejectedTree);
  assert.ok(rejectedFeedback, "the matching Officer feedback is presented in the rejection panel");
  assert.ok((Array.isArray(rejectedFeedback.props.style) ? rejectedFeedback.props.style : [rejectedFeedback.props.style])
    .some((style) => style?.backgroundColor === "#FEF2F1"));
  assert.equal((text(rejectedTree).match(/request correction~/g) || []).length, 1, "Officer feedback is not duplicated");
  assert.equal(JSON.parse(read("translations/en.json")).botanistPlantDetail.submissionRejected, "Submission Rejected");
  assert.equal(JSON.parse(read("translations/ms.json")).botanistPlantDetail.submissionRejected, "Penyerahan Ditolak");
  assert.ok(!text(rejectedMeta).includes("Pending Review"));
  assert.equal(find((n) => n?.type === "EditAction" && n.props.testID === "edit-own-plant", rejectedTree), undefined,
    "a rejected Original does not offer Edit Plant");
  assert.equal(find((n) => n?.props?.testID === "withdraw-original-plant", rejectedTree), undefined);
  assert.ok(text(rejectedTree).includes("request correction~"), "feedback belongs to the selected Original review");
  assert.ok(!text(rejectedTree).includes("Other observation feedback"));
  rejectedCleanup();
  plantLoadFails = true;
  render(); const loadFailureCleanup = focus(); await new Promise((resolve) => setImmediate(resolve));
  const failedTree = render();
  assert.ok(text(failedTree).includes("plant detail network failure"));
  assert.ok(find((node) => node?.type === "TouchableOpacity" && text(node).includes("Try again"), failedTree));
  assert.ok(!text(failedTree).includes("common.goBack"), "the native header remains the only back control");
  loadFailureCleanup();
});

test("historical plant versions render the normal read-only Plant Record sections from the selected snapshot", async () => {
  let index = 0, slots = [], focus, apiReads = 0, speciesReads = [];
  const hooks = { ...React, useCallback: (fn) => fn, useRef: (initial) => ({ current: initial }), useState: (initial) => {
    const i = index++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
    return [slots[i], (next) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }];
  } };
  const messages = JSON.parse(read("translations/en.json"));
  const t = (key) => key.split(".").reduce((a, k) => a?.[k], messages) || key;
  const native = { StyleSheet: { create: (v) => v }, Alert: { alert: () => {} }, Platform: { OS: "ios" }, UIManager: {}, LayoutAnimation: { Presets: { easeInEaseOut: "ease" }, configureNext: () => {} } };
  for (const name of ["View", "Text", "TextInput", "TouchableOpacity", "ScrollView", "Image", "Modal", "ActivityIndicator"]) native[name] = name;
  const snapshot = { plant_id: 8, scientific_name: "Historical plant-level name", species_id: 6, qr_token: "QR-HISTORY",
    content: { heightCm: 175, healthStatus: "Healthy", lifeStage: "Mature", morphology: "Original leaf form", latitude: 4.2,
      longitude: 114.1, accuracyM: 5, altitudeM: 80, zone: "Niah", notes: "Original notes", taxonomy: "Original taxonomy" } };
  const photo = { uri: "https://example.invalid/historical-photo", headers: { Authorization: "Bearer history" } };
  const screen = moduleFrom("screens/BotanistPlantDetail.js", { react: hooks,
    "react-native": native, "@react-navigation/native": { useFocusEffect: (fn) => { focus = fn; } },
    "../utils/botanistRecords": { canWithdrawOriginalPlant: () => false, fetchBotanistPlant: async () => { apiReads++; throw Error("must not fetch live record"); }, fetchBotanistRecordChangeStatus: async () => { apiReads++; throw Error("must not fetch history"); } },
    "../utils/plantApi": {
      getPlantRegisteredByDisplayName: (_plant, _user, fallback) => fallback,
      fetchSpeciesDetail: async (speciesId, _slug, options) => {
        apiReads++; speciesReads.push([String(speciesId), options.accountId]);
        return { id: String(speciesId), scientificName: "Version-specific Shorea", commonName: "Historical common name" };
      },
      plantApi: async () => { apiReads++; throw Error("must not fetch the current plant record"); },
    },
    "@expo/vector-icons/Ionicons": { default: "Ionicons" },
    "../utils/plantPhotoGallery": { stepPhotoIndex: () => 0 },
    "../translations/i18n": { useAppTranslation: () => {}, t, translateLabel: (v) => v, translateFieldValue: (_, v) => v, translateUIMessage: (v) => v },
    "../data/mockData": { botanistPlantRecords: [], botanistSpeciesRequests: [], plants: [] },
    "../components/EditAction": { default: "EditAction" },
    "../components/OriginalUpdatedField": { default: ({ children }) => React.createElement("View", null, children) },
  });
  const route = { params: { plantId: "8", botanist: { id: "owner", name: "Aina" }, historicalRecordDetail: true,
    historicalSnapshot: snapshot, historicalVersionStatus: "Pending Review", submissionVersionLabel: "Edit 1",
    historicalReviewComment: "Original Officer feedback remains available.", historicalPhotos: [photo] } };
  const render = () => { index = 0; return screen.default({ route, navigation: { navigate() {}, goBack() {} } }); };
  render(); const cleanup = focus(); await new Promise((resolve) => setImmediate(resolve)); const tree = render();
  const children = (node) => node && typeof node === "object" ? React.Children.toArray(node.props?.children) : [];
  const text = (node) => typeof node === "string" || typeof node === "number" ? String(node) : children(node).map(text).join(" ");
  function find(predicate, node) { if (predicate(node)) return node; for (const child of children(node)) { const result = find(predicate, child); if (result) return result; } }
  for (const value of ["Plant Record", "Review and manage your plant documentation.", "Record ID", "8", "01", "Species", "Version-specific Shorea", "Historical common name", "02", "Plant Information", "03", "Staff Record", "04", "Plant Photos", "Historical plant-level name", "175", "Original notes", "Original taxonomy", "Pending Review", "Edit 1", "Niah", "Original Officer feedback remains available."]) assert.ok(text(tree).includes(value), value);
  assert.deepEqual(speciesReads, [["6", "owner"]], "history resolves the species ID from this snapshot using the Botanist's authorized API session");
  assert.equal(apiReads, 1, "historical detail does not fetch the current plant record");
  for (const hidden of ["Category", "Submitted By", "Sync Status", "Species ID"]) assert.ok(!text(tree).includes(hidden), hidden);
  assert.ok(!find((node) => node?.type === "EditAction"), "historical details do not expose editing controls");
  const imageSources = (function collect(node, out = []) { if (!node || typeof node !== "object") return out; if (node.type === "Image") out.push(node.props?.source); for (const child of children(node)) collect(child, out); return out; })(tree);
  assert.ok(imageSources.some((source) => source?.uri === photo.uri), "the selected version's photo is displayed");
  assert.ok(!text(tree).includes("Edit History") && !text(tree).includes("Complete Version"));
  const app = read("App.js");
  assert.match(app, /title: t\("navigation\.plantDetails"\)/);
  assert.match(app, /const isHistoricalDetail = route\.params\?\.historicalRecordDetail === true/);
  assert.match(app, /headerBackTitle: ""/);
  assert.match(app, /headerBackButtonDisplayMode: "minimal"/);
  assert.match(app, /headerTitleAlign: "center"/);
  assert.match(app, /headerBackVisible: false/);
  assert.match(app, /variant="plain"/);
  assert.match(app, /headerTitleStyle: \{ fontSize: 17, fontWeight: "600", color: "#234A3C" \}/);
  cleanup();
  route.params.historicalSnapshot = {};
  render(); const missingCleanup = focus(); const missingTree = render();
  assert.ok(text(missingTree).includes("Plant Record"));
  assert.ok(text(missingTree).includes("Historical information is unavailable for this version."));
  assert.ok(text(missingTree).includes("Species classification details were not saved in this historical version."));
  assert.ok(!text(missingTree).includes("Go Back"), "the navigation header remains the only back control");
  missingCleanup();
});

test("owner-visible pending Plant Details use authorized proposed species details without numeric IDs or removed rows", async () => {
  let index = 0, slots = [], focus;
  const hooks = { ...React, useCallback: (fn) => fn, useRef: (initial) => ({ current: initial }), useState: (initial) => {
    const i = index++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
    return [slots[i], (next) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }];
  } };
  const messages = JSON.parse(read("translations/en.json"));
  const t = (key) => key.split(".").reduce((a, k) => a?.[k], messages) || key;
  const native = { StyleSheet: { create: (v) => v }, Alert: { alert: () => {} }, Platform: { OS: "ios" }, UIManager: {}, LayoutAnimation: { Presets: { easeInEaseOut: "ease" }, configureNext: () => {} } };
  for (const name of ["View", "Text", "TextInput", "TouchableOpacity", "ScrollView", "Image", "Modal", "ActivityIndicator"]) native[name] = name;
  const submittedPlant = { id: "8", plantId: "8", status: "Pending Review", currentStatus: "Pending Review",
    isServerRecord: true, speciesId: "6", speciesDetails: { species_id: "6", scientific_name: "Submitted pending species",
      common_name: "Pending common name", genus_name: "Shorea", family_name: "Dipterocarpaceae" },
    scientificName: "Plant-level submitted name", zone: "Submitted Zone", location: { latitude: 4.5, longitude: 113.7, zone: "Submitted Zone" },
    latestObservation: { status: "Pending Review", revision: 1 }, photos: [] };
  const screen = moduleFrom("screens/BotanistPlantDetail.js", { react: hooks, "react-native": native,
    "@react-navigation/native": { useFocusEffect: (fn) => { focus = fn; } },
    "../utils/botanistRecords": { canWithdrawOriginalPlant: () => false, fetchBotanistPlant: async () => submittedPlant, fetchBotanistRecordChangeStatus: async () => ({ available: true, pending: null, latest: null }) },
    "../utils/plantApi": { getPlantRegisteredByDisplayName: () => "Aina Botanist", fetchSpeciesDetail: async () => { throw Error("current pending species details are already authorized on the plant response"); }, plantApi: async () => ({ history_available: true, versions: [], prior_changes: [] }) },
    "@expo/vector-icons/Ionicons": { default: "Ionicons" }, "../utils/plantPhotoGallery": { stepPhotoIndex: () => 0 },
    "../translations/i18n": { useAppTranslation: () => {}, t, translateLabel: (v) => v, translateFieldValue: (_, v) => v, translateUIMessage: (v) => v },
    "../data/mockData": { botanistPlantRecords: [], botanistSpeciesRequests: [], plants: [] },
    "../components/EditAction": { default: "EditAction" }, "../components/OriginalUpdatedField": { default: ({ children }) => React.createElement("View", null, children) },
  });
  const route = { params: { plantId: "8", botanist: { id: "owner", name: "Aina Botanist" } } };
  const render = () => { index = 0; return screen.default({ route, navigation: { navigate() {}, goBack() {} } }); };
  render(); const cleanup = focus(); await new Promise((resolve) => setImmediate(resolve)); const tree = render();
  const children = (node) => node && typeof node === "object" ? React.Children.toArray(node.props?.children) : [];
  const text = (node) => typeof node === "string" || typeof node === "number" ? String(node) : children(node).map(text).join(" ");
  assert.ok(text(tree).includes("Submitted pending species"));
  assert.ok(text(tree).includes("Pending common name"));
  assert.ok(text(tree).includes("Submitted Zone"), "the existing Zone value remains visible");
  for (const hidden of ["Category", "Submitted By", "Sync Status", "Species ID"]) assert.ok(!text(tree).includes(hidden), hidden);
  assert.ok(text(tree).includes("Pending Review"));
  cleanup();
});

test("Correction Requests include creator-owned observations on another plant and owner-scoped species requests", () => {
  const tasks = submissionsUtils().correctionTasks(
    [{ id: "1", status: "Approved", commonName: "Another Botanist's plant" }, { id: "2", status: "Pending Review", commonName: "My plant" }],
    [
      { id: "10", plant_id: "1", owner_subject: "staff:alice", status: "Correction Required", origin_type: "subsequent_observation", review_comment: "Fix the notes" },
      { id: "11", plant_id: "1", owner_subject: "staff:bob", status: "Correction Required", origin_type: "subsequent_observation" },
      { id: "12", plant_id: "2", owner_subject: "staff:alice", status: "Correction Required", origin_type: "initial_registration" },
      { id: "13", plant_id: "2", owner_subject: "staff:alice", status: "Rejected", origin_type: "initial_registration" },
    ],
    [
      { request_id: 21, requested_by: "staff:alice", request_status: "Correction Required", scientific_name: "New species", review_comment: "Add a photo" },
      { request_id: 22, requested_by: "staff:bob", request_status: "Correction Required" },
      { request_id: 23, requested_by: "staff:alice", request_status: "Rejected" },
    ], "alice", [
      { id: "proposal-1", observation_id: "10", owner_subject: "staff:alice", status: "Correction Required", review_comment: "Correct the edit" },
      { id: "proposal-2", observation_id: "11", owner_subject: "staff:bob", status: "Correction Required" },
    ], [
      { id: "plant-change", plant_id: "1", owner_subject: "staff:alice", status: "Correction Required", proposed_snapshot: { scientific_name: "Plant proposal" }, review_comment: "Plant feedback" },
      { id: "species-change", species_id: "7", owner_subject: "staff:alice", base_snapshot: { request_id: 21 }, status: "Correction Required", proposed_snapshot: { scientific_name: "Species proposal" } },
      { id: "foreign-change", plant_id: "2", owner_subject: "staff:bob", status: "Correction Required" },
    ],
  );
  assert.deepEqual(new Set(tasks.map(({ key, kind }) => `${kind}:${key}`)), new Set([
    "observation:observation:10", "plant:observation:12", "species:species:21", "observationEdit:observation-edit:proposal-1",
    "plantEdit:plant-edit:plant-change", "speciesEdit:species-edit:species-change",
  ]));
  assert.equal(tasks.find((task) => task.id === "10").plantId, "1");
  assert.equal(tasks.find((task) => task.id === "21").feedback, "Add a photo");
  assert.equal(tasks.find((task) => task.id === "proposal-1").plantId, "1");
  assert.equal(tasks.find((task) => task.proposalId === "plant-change").feedback, "Plant feedback");
  assert.equal(tasks.find((task) => task.proposalId === "species-change").requestId, "21");
});

for (const language of ["en", "ms", "zh"]) {
  test(`${language}: dashboard is a main menu and submission/correction pages retain their actions`, async () => {
    const messages = JSON.parse(read(`translations/${language}.json`));
    const t = (key, values = {}) => key.split(".").reduce((a, k) => a?.[k], messages)?.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key]) || key;
    let index = 0, slots = []; const navigations = [], alerts = [];
    const projected = fixture().projectBotanistRecords("owner", rows, observations.map((row) => ({ ...row, status: "Pending Review" })), requests);
    let liveRecords = projected, isLoading = false;
    projected.plants[0].latestObservation = { owner_subject: "staff:owner", status: "Correction Required", plant_id: "8", review_comment: "Please add leaf details." };
    projected.observations[0].status = "Correction Required";
    projected.observations[0].review_comment = "Please add leaf details.";
    let viewportWidth = 390;
    const native = { StyleSheet: { create: (v) => v }, Alert: { alert: (...args) => alerts.push(args) }, useWindowDimensions: () => ({ width: viewportWidth, height: 844 }) };
    for (const name of ["View", "Text", "TextInput", "TouchableOpacity", "FlatList", "ScrollView", "Image", "ActivityIndicator", "RefreshControl"]) native[name] = name;
    const screen = moduleFrom("screens/BotanistDashboard.js", {
      react: { ...React, useCallback: (callback) => callback, useEffect: () => {}, useRef: (initial) => ({ current: initial }), useState: (initial) => { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], (next) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; } }, "react-native": native,
      "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
      "@react-navigation/native": { useFocusEffect: () => {} },
      "../translations/i18n": { useAppTranslation: () => {}, t, translateLabel: (value) => value, translateUIMessage: (v) => v },
      "../components/LanguageSelector": { default: "LanguageSelector" }, "@expo/vector-icons/Ionicons": { default: "Icon" },
      "../components/fieldFormStyles": { fieldFormStyles: { submitButton: {}, submitButtonText: {} } },
      "../utils/botanistRecords": fixture(),
      "../utils/useBotanistNotifications": { useBotanistNotifications: () => ({ unreadCount: 0 }) },
      "../utils/botanistNotifications": { ownedNotificationObservation: async (_accountId, observationId) => ({ id: observationId, plant_id: "8", status: "Correction Required" }) },
      "../utils/useBotanistRecords": { useBotanistRecords: () => ({ ...liveRecords, loaded: !isLoading, loading: isLoading, error: "", refresh: () => {} }) },
      "../utils/plantApi": { plantApi: async () => ({ history_available: false, versions: [] }) },
      "../utils/apiConfiguration": { mobileApiUrl: () => "https://example.invalid" }, "../utils/faceSession": { faceSession: {} },
    });
    const botanist = { id: "owner", name: "Aina Botanist" };
    let tree;
    const renderDashboard = () => { index = 0; tree = screen.default({ route: { params: { botanist } }, navigation: { navigate: (...args) => navigations.push(args) } }); };
    function children(node) { return node && typeof node === "object" ? React.Children.toArray(node.props?.children) : []; }
    const text = (node) => typeof node === "string" || typeof node === "number" ? String(node) : children(node).map(text).join(" ");
    function find(predicate, node = tree) { if (predicate(node)) return node; for (const child of children(node)) { const found = find(predicate, child); if (found) return found; } }
    renderDashboard(); assert.ok(text(tree).includes("Aina Botanist"));
    const cardIDs = ["dashboard-qr", "dashboard-add-plant", "dashboard-submissions", "dashboard-my-observations", "dashboard-my-draft", "dashboard-corrections"];
    const grid = find((node) => node?.type === "View" && children(node).some((child) => child.props?.testID === "dashboard-qr"));
    assert.deepEqual(children(grid).map((child) => child.props.testID), cardIDs);
    assert.ok(!find((node) => node?.props?.testID === "dashboard-submission-section"));
    assert.ok(!find((node) => node?.props?.testID === "correction-request-section"));
    const correctionBadge = find((node) => node?.props?.testID === "correction-request-badge");
    assert.ok(correctionBadge);
    assert.equal(text(correctionBadge), "1");
    const expectedCardColors = ["#E2F0E4", "#D6E9D9", "#D6E9D9", "#E2F0E4", "#E8EDDA", "#F5E4D5"];
    for (let i = 0; i < cardIDs.length; i++) assert.ok(find((node) => node?.props?.testID === cardIDs[i]).props.style.some((style) => style?.backgroundColor === expectedCardColors[i]));
    const headerActions = find((node) => node?.type === "View" && children(node)[0]?.type === "LanguageSelector");
    assert.deepEqual(children(headerActions).map((child) => child.type === "LanguageSelector" ? "language" : children(child).find((icon) => icon?.type === "Icon")?.props?.name), ["language", "notifications-outline", "log-out-outline"]);
    find((node) => node?.props?.testID === "dashboard-submissions").props.onPress(); assert.equal(navigations.at(-1)[0], "BotanistSubmissions");
    find((node) => node?.props?.testID === "dashboard-corrections").props.onPress(); assert.equal(navigations.at(-1)[0], "BotanistCorrectionRequests");
    find((node) => node?.props?.testID === "dashboard-my-draft").props.onPress();
    const draftCard = find((node) => node?.props?.testID === "dashboard-my-draft");
    assert.ok(text(draftCard).includes(t("botanistDashboard.myDraft")));
    assert.ok(!text(draftCard).includes(t("botanistDashboard.comingSoon")));
    assert.ok(find((node) => node?.props?.name === "arrow-forward", draftCard));
    assert.equal(alerts.length, 0); assert.equal(navigations.at(-1)[0], "BotanistMyDrafts");
    projected.plants[0].latestObservation.status = "Approved";
    projected.observations[0].status = "Approved";
    renderDashboard(); assert.ok(!find((node) => node?.props?.testID === "correction-request-badge"), "resolved requests do not show a badge");
    projected.plants[0].latestObservation.status = "Correction Required";
    projected.observations[0].status = "Correction Required";
    viewportWidth = 1024; renderDashboard();
    const dashboardScroll = find((node) => node?.type === "ScrollView");
    assert.equal(dashboardScroll.props.contentContainerStyle[1].maxWidth, 1000, "tablet dashboard stays centered and capped");

    liveRecords = { plants: [], requests: [], observations: [] };
    isLoading = true;
    index = 0; tree = screen.BotanistSubmissionsScreen({ route: { params: { botanist } }, navigation: { navigate: (...args) => navigations.push(args), goBack: () => navigations.push(["back"]) } });
    const initialList = find((node) => node?.type === "FlatList", tree);
    assert.equal(initialList.props.ListEmptyComponent.type, "CardListSkeleton", "My Submissions shows record-shaped placeholders while loading");
    liveRecords = projected; isLoading = false;
    index = 0; tree = screen.BotanistSubmissionsScreen({ route: { params: { botanist } }, navigation: { navigate: (...args) => navigations.push(args), goBack: () => navigations.push(["back"]) } });
    let list = find((node) => node?.type === "FlatList", tree); assert.equal(list.props.data.length, 1); assert.equal(list.props.data[0].record.id, "8");
    assert.ok(text(list.props.ListHeaderComponent).length > 0, "My Submissions title remains in the page header"); assert.ok(!text(tree).includes("common.goBack"), "My Submissions has no redundant in-page back control");
    const recordCard = list.props.renderItem({ item: list.props.data[0] }); assert.ok(text(recordCard).includes("Manual plant name"));
    const groupToggle = find((node) => node?.props?.testID === "submission-group-toggle-plant:8", recordCard); groupToggle.props.onPress();
    index = 0; tree = screen.BotanistSubmissionsScreen({ route: { params: { botanist } }, navigation: { navigate: (...args) => navigations.push(args), goBack: () => navigations.push(["back"]) } });
    list = find((node) => node?.type === "FlatList", tree); const expandedCard = list.props.renderItem({ item: list.props.data[0] });
    const currentRecordRow = find((node) => node?.props?.testID === "submission-version-plant:8-record:plant:8", expandedCard);
    assert.ok(currentRecordRow); currentRecordRow.props.onPress(); assert.equal(navigations.at(-1)[0], "BotanistPlantDetail");
    find((node) => node?.props?.testID === "submissions-filter-pending", list.props.ListHeaderComponent).props.onPress();
    index = 0; tree = screen.BotanistSubmissionsScreen({ route: { params: { botanist } }, navigation: { navigate: (...args) => navigations.push(args), goBack: () => navigations.push(["back"]) } });
    list = find((node) => node?.type === "FlatList", tree); const pendingGroup = list.props.renderItem({ item: list.props.data[0] });
    const matchingPendingRow = find((node) => node?.props?.testID === "submission-version-plant:8-record:plant:8", pendingGroup);
    assert.ok(matchingPendingRow, "a status filter opens a matching group");
    projected.plants[0].latestObservation.status = "Approved";
    projected.observations[0].status = "Approved";
    slots = []; index = 0; tree = screen.BotanistCorrectionRequestsScreen({ route: { params: { botanist } }, navigation: { navigate: (...args) => navigations.push(args), goBack: () => navigations.push(["back"]) } });
    assert.ok(text(tree).includes(t("botanistDashboard.noCorrectionRequests")), "approved records are not misclassified as active corrections");
    projected.plants[0].latestObservation.status = "Correction Required";
    projected.observations[0].status = "Correction Required";
    projected.plants[0].status = "Approved";
    slots = []; index = 0; tree = screen.BotanistCorrectionRequestsScreen({ route: { params: { botanist } }, navigation: { navigate: (...args) => navigations.push(args), goBack: () => navigations.push(["back"]) } });
    assert.ok(text(tree).includes("Please add leaf details."));
    const correctionCard = find((node) => node?.props?.testID === "correction-task-observation:observation-8");
    assert.equal(correctionCard?.props.style.backgroundColor, "#FFFFFF");
    assert.ok(correctionCard?.props.style.borderWidth, "correction card keeps the shared white-card border");
    assert.ok(!text(tree).includes("common.goBack"), "Correction Requests has no redundant in-page back control");
    assert.equal(find((node) => node?.props?.testID === "correction-filter-all", tree), undefined, "Correction Requests has no All filter");
    assert.equal(find((node) => node?.props?.testID === "correction-filter-correctionRequired", tree), undefined, "Correction Requests has no Correction Required filter");
    assert.ok(text(tree).includes(t("botanistDashboard.matchingCorrectionRequests", { count: 1 })), "the count reflects the matching correction requests");
    const correctionSearch = find((node) => node?.type === "TextInput", tree);
    correctionSearch.props.onChangeText("does not match");
    index = 0; tree = screen.BotanistCorrectionRequestsScreen({ route: { params: { botanist } }, navigation: { navigate: (...args) => navigations.push(args), goBack() {} } });
    assert.ok(text(tree).includes(t("botanistDashboard.noMatchingCorrectionRequests")));
    assert.ok(text(tree).includes(t("botanistDashboard.noMatchingCorrectionRequests")), "search still filters correction requests");
    correctionSearch.props.onChangeText("");
    index = 0; tree = screen.BotanistCorrectionRequestsScreen({ route: { params: { botanist } }, navigation: { navigate: (...args) => navigations.push(args), goBack() {} } });
    assert.ok(text(tree).includes("Please add leaf details."));
    const edit = find((node) => node?.type === "TouchableOpacity" && text(node).includes(t("fieldCollection.correctObservation")), tree); assert.ok(edit); await edit.props.onPress(); assert.equal(navigations.at(-1)[0], "FieldCollectionEdit");
    projected.plants[0].status = "Pending Review";
    slots = []; index = 0; tree = screen.BotanistCorrectionRequestsScreen({ route: { params: { botanist } }, navigation: { navigate: (...args) => navigations.push(args), goBack() {} } });
    const registration = find((node) => node?.type === "TouchableOpacity" && text(node).includes(t("recordEdits.correctPlantRegistration")), tree);
    assert.ok(registration); registration.props.onPress(); assert.equal(navigations.at(-1)[0], "EditPlant");
    assert.equal(viewportWidth, 1024);
  });
}
test("each list retains its last successful data when the other endpoint fails, and auth errors clear both", async () => {
  let failedPath;
  const api = fixture(async (path) => {
    if (path === failedPath) throw Object.assign(Error("Gateway unavailable"), { status: 502 });
    return path === "/plants?scope=mine" ? { plants: rows } : path === "/observations?scope=mine" ? { observations } : { species_requests: requests };
  });
  const loader = api.createBotanistRecordsLoader(() => api.fetchBotanistRecords("owner"), () => {});
  await loader.refresh();
  for (const path of ["/species-requests", "/plants?scope=mine", "/observations?scope=mine"]) {
    failedPath = path; await loader.refresh();
    assert.equal(loader.getState().plants[0].id, "8"); assert.equal(loader.getState().requests[0].request_id, 1); assert.ok(loader.getState().error);
  }
  const cold = api.createBotanistRecordsLoader(() => api.fetchBotanistRecords("owner"), () => {});
  failedPath = "/plants?scope=mine"; await cold.refresh(); assert.equal(cold.getState().requests[0].request_id, 1); assert.equal(cold.getState().plants.length, 0);
  const denied = fixture(async (path) => {
    if (path === "/species-requests") throw Object.assign(Error("Session changed"), { status: 403 });
    return path === "/plants?scope=mine" ? { plants: rows } : { observations };
  });
  await assert.rejects(denied.fetchBotanistRecords("owner"), /Session changed/);
});

test("request detail uses the existing authenticated ID endpoint and refuses other owners", async () => {
  const calls = [];
  const api = fixture(async (path, options) => { calls.push([path, options]); return { species_request: requests[0] }; });
  const detail = await api.fetchBotanistSpeciesRequest("owner", "1");
  assert.equal(detail.scientific_name, "Different species name"); assert.match(detail.photo.uri, /requests\/1\/photo/);
  assert.equal(calls[0][0], "/species-requests/1"); assert.equal(calls[0][1].expectedAccountId, "owner");
  await assert.rejects(api.fetchBotanistSpeciesRequest("other", "1"), /unavailable/);
});

test("pending reviewed edits match the exact owned plant or species request identifier", async () => {
  const changes = [
    { id: "plant-pending", plant_id: 8, owner_subject: "staff:owner", status: "Pending Review" },
    { id: "other-plant", plant_id: 80, owner_subject: "staff:owner", status: "Pending Review" },
    { id: "approved-edit", plant_id: 81, owner_subject: "staff:owner", status: "Approved" },
    { id: "rejected-edit", plant_id: 82, owner_subject: "staff:owner", status: "Rejected" },
    { id: "species-pending", owner_subject: "staff:owner", base_snapshot: { request_id: 14 }, status: "Pending Review" },
    { id: "species-approved", owner_subject: "staff:owner", base_snapshot: { request_id: 15 }, status: "Approved" },
    { id: "species-rejected", owner_subject: "staff:owner", base_snapshot: { request_id: 16 }, status: "Rejected" },
    { id: "other-owner", plant_id: 8, owner_subject: "staff:other", status: "Pending Review" },
  ];
  const api = fixture(async (path) => path.endsWith("/capabilities") ? { approved_edits_available: true } : { changes });
  assert.equal((await api.fetchBotanistRecordChangeStatus("owner", "plant", "8")).pending.id, "plant-pending");
  assert.equal((await api.fetchBotanistRecordChangeStatus("owner", "plant", "80")).pending.id, "other-plant");
  assert.equal((await api.fetchBotanistRecordChangeStatus("owner", "species", "14")).pending.id, "species-pending");
  assert.equal((await api.fetchBotanistRecordChangeStatus("owner", "species", "15")).pending, null);
  assert.equal((await api.fetchBotanistRecordChangeStatus("owner", "plant", "81")).pending, null);
  assert.equal((await api.fetchBotanistRecordChangeStatus("owner", "plant", "82")).pending, null);
  assert.equal((await api.fetchBotanistRecordChangeStatus("owner", "species", "16")).pending, null);
});

test("pending reviewed edit status failures are not converted to a clear result", async () => {
  const api = fixture(async (path) => { if (path.endsWith("/capabilities")) throw Error("offline"); return { changes: [] }; });
  await assert.rejects(api.fetchBotanistRecordChangeStatus("owner", "plant", "8"), /offline/);
});

test("read-only request detail renders actual fields, review metadata and authenticated photo", async () => {
  let index = 0, slots = [], focus, requested, pendingChange = null;
  const withdrawalCalls = [], alerts = [];
  const hooks = { ...React, useCallback: (fn) => fn, useRef: (current) => ({ current }), useState: (initial) => { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], (next) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; } };
  const native = { StyleSheet: { create: (v) => v }, Alert: { alert: (...args) => alerts.push(args) } }; for (const name of ["View", "Text", "ScrollView", "Image", "TouchableOpacity", "ActivityIndicator", "RefreshControl"]) native[name] = name;
  const record = { ...requests[0], genus_name: "Actual genus", family_name: "Actual family", conservation_status: "Endangered", description: "Actual description", habitat: "Actual habitat", submitted_at: "2026-11-03T01:00:00Z", review_comment: "Actual reviewer comment", photo: { uri: "https://example.invalid/photo", headers: { Authorization: "Bearer fixture" } } };
  const screen = moduleFrom("screens/BotanistSpeciesRequestDetail.js", {
    react: hooks, "react-native": native, "@react-navigation/native": { useFocusEffect: (fn) => { focus = fn; } },
    "../utils/botanistRecords": { submissionStatus: fixture().submissionStatus, canWithdrawOriginalSpecies: fixture().canWithdrawOriginalSpecies,
      fetchBotanistSpeciesRequest: async (...args) => { requested = args; return record; }, fetchBotanistRecordChangeStatus: async () => ({ available: true, pending: pendingChange, latest: pendingChange }) },
    "../translations/i18n": { useAppTranslation: () => {}, t: (v) => v, translateLabel: (v) => v, translateUIMessage: (v) => v },
    "../components/EditAction": { default: "EditAction" },
    "../utils/plantApi": { plantApi: async (...args) => { withdrawalCalls.push(args); return {}; } },
    "@expo/vector-icons/Ionicons": { default: "Ionicons" },
  });
  const render = () => { index = 0; return screen.default({ route: { params: { requestId: "1", botanist: { id: "owner" } } } }); };
  const initialRequestTree = render();
  function findSkeleton(node) { if (!node || typeof node !== "object") return null; if (node.type === "DetailSkeletonContent") return node; for (const child of React.Children.toArray(node.props?.children)) { const match = findSkeleton(child); if (match) return match; } return null; }
  assert.equal(findSkeleton(initialRequestTree)?.props.label, "submissions.loadingRequestDetails");
  const cleanup = focus(); await new Promise((r) => setImmediate(r)); const tree = render();
  const children = (node) => node && typeof node === "object" ? React.Children.toArray(node.props?.children) : [];
  const text = (node) => typeof node === "string" ? node : children(node).map(text).join(" ");
  function find(predicate, node = tree) { if (predicate(node)) return node; for (const child of children(node)) { const result = find(predicate, child); if (result) return result; } }
  for (const value of ["Different species name", "Common species name", "Actual genus", "Actual family", "Endangered", "Actual description", "Actual habitat", "Pending Review", "Actual reviewer comment"]) assert.ok(text(tree).includes(value), value);
  assert.deepEqual(requested, ["owner", "1"]); assert.ok(!text(tree).includes("Delete"));
  const withdrawButton = find((node) => node?.props?.testID === "withdraw-original-species", tree);
  assert.ok(withdrawButton, "eligible owner sees Withdraw Submission");
  assert.ok(find((node) => node?.props?.testID === "withdraw-original-species",
    find((node) => node?.props?.testID === "species-detail-heading", tree)));
  withdrawButton.props.onPress();
  assert.equal(alerts[0][0], "speciesWithdrawal.confirmTitle");
  assert.equal(withdrawalCalls.length, 0, "opening confirmation does not withdraw");
  assert.equal(alerts[0][2][0].text, "speciesWithdrawal.keepSubmission");
  await alerts[0][2][1].onPress();
  assert.equal(withdrawalCalls[0][0], "/species-requests/1/withdraw");
  assert.equal(alerts[1][0], "speciesWithdrawal.successTitle");
  cleanup();
  record.review_cycle = "2";
  record.reviewed_at = "2026-11-12T00:00:00Z";
  render(); const correctedCleanup = focus(); await new Promise((resolve) => setImmediate(resolve));
  const correctedTree = render();
  function hasEdit(node) { if (!node || typeof node !== "object") return false; return node.type === "EditAction" && node.props.testID === "edit-own-species" || children(node).some(hasEdit); }
  assert.equal(hasEdit(correctedTree), false, "corrected pending Species cannot open another edit");
  assert.equal(find((node) => node?.props?.testID === "withdraw-original-species", correctedTree), undefined,
    "correction resubmission awaiting review cannot be withdrawn");
  correctedCleanup();
  record.request_status = "Approved";
  render(); const approvedCleanup = focus(); await new Promise((resolve) => setImmediate(resolve));
  const approvedTree = render();
  assert.equal(find((node) => node?.type === "EditAction" && node.props.testID === "edit-own-species", approvedTree).props.disabled, false);
  assert.equal(find((node) => node?.props?.testID === "withdraw-original-species", approvedTree), undefined,
    "approved Species cannot be withdrawn");
  approvedCleanup();
  pendingChange = { status: "Pending Review", review_comment: "Awaiting review" };
  render(); const pendingCleanup = focus(); await new Promise((resolve) => setImmediate(resolve));
  const pendingTree = render();
  assert.equal(find((node) => node?.type === "EditAction" && node.props.testID === "edit-own-species", pendingTree).props.disabled, true);
  assert.ok(text(pendingTree).includes("recordEdits.pendingEditExplanation"));
  pendingCleanup();
});

test("historical species request versions use the existing read-only request detail layout without fetching current data", async () => {
  let index = 0, slots = [], focus, reads = 0;
  const hooks = { ...React, useCallback: (fn) => fn, useRef: (current) => ({ current }), useState: (initial) => { const i = index++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], (next) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; } };
  const native = { StyleSheet: { create: (v) => v }, Alert: { alert() {} } }; for (const name of ["View", "Text", "ScrollView", "Image", "TouchableOpacity", "ActivityIndicator", "RefreshControl"]) native[name] = name;
  const snapshot = { request_id: 4, scientific_name: "Historical species", common_name: "First common name", genus_name: "First genus", family_name: "First family", description: "Original description" };
  const photo = { uri: "https://example.invalid/species-original", headers: { Authorization: "Bearer history" } };
  const screen = moduleFrom("screens/BotanistSpeciesRequestDetail.js", { react: hooks, "react-native": native,
    "@react-navigation/native": { useFocusEffect: (fn) => { focus = fn; } },
    "../utils/botanistRecords": { submissionStatus: fixture().submissionStatus, canWithdrawOriginalSpecies: fixture().canWithdrawOriginalSpecies,
      fetchBotanistSpeciesRequest: async () => { reads++; throw Error("must not fetch live request"); }, fetchBotanistRecordChangeStatus: async () => { reads++; throw Error("must not fetch history"); } },
    "../translations/i18n": { useAppTranslation: () => {}, t: (v) => v, translateLabel: (v) => v, translateUIMessage: (v) => v },
    "../components/EditAction": { default: "EditAction" },
    "../utils/plantApi": { plantApi: async () => ({}) },
    "@expo/vector-icons/Ionicons": { default: "Ionicons" },
  });
  const route = { params: { requestId: "4", botanist: { id: "owner" }, historicalRecordDetail: true, historicalSnapshot: snapshot,
    historicalVersionStatus: "Approved", submissionVersionLabel: "Original", historicalCurrent: true, historicalPhotos: [photo] } };
  const render = () => { index = 0; return screen.default({ route, navigation: { navigate() {} } }); };
  render(); const cleanup = focus(); const tree = render();
  const children = (node) => node && typeof node === "object" ? React.Children.toArray(node.props?.children) : [];
  const text = (node) => typeof node === "string" ? node : children(node).map(text).join(" ");
  function find(predicate, node = tree) { if (predicate(node)) return node; for (const child of children(node)) { const found = find(predicate, child); if (found) return found; } }
  for (const value of ["Historical species", "First common name", "First genus", "First family", "Original description", "Approved", "Original", "requestId"]) assert.ok(text(tree).includes(value), value);
  assert.equal(reads, 0);
  assert.ok(find((node) => node?.type === "Image" && node.props.source.uri === photo.uri));
  assert.ok(!find((node) => node?.type === "EditAction"));
  assert.ok(!text(tree).includes("Edit History"));
  cleanup();
  route.params.historicalSnapshot = {};
  render(); const missingCleanup = focus(); const missingTree = render();
  assert.ok(text(missingTree).includes("recordEdits.originalSnapshotUnavailable"));
  assert.ok(text(missingTree).includes("recordEdits.historicalFieldUnavailable"));
  assert.equal(reads, 0);
  missingCleanup();
});
