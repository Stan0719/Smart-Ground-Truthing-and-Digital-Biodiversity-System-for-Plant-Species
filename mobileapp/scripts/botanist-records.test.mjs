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

function submissionsUtils() {
  return moduleFrom("screens/BotanistDashboard.js", {
    react: React,
    "../components/LanguageSelector": { default: "LanguageSelector" },
    "../translations/i18n": { useAppTranslation() {}, t: (key) => key, translateLabel: (value) => value, translateUIMessage: (value) => value },
    "react-native": { StyleSheet: { create: (value) => value } },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "@react-navigation/native": { useFocusEffect() {} },
    "../utils/botanistRecords": { submissionStatus: (value) => { const status = String(value).toLowerCase(); return status === "approved" ? "approved" : status === "rejected" ? "rejected" : ["pending", "pending review"].includes(status) ? "pending" : status; } },
    "../utils/useBotanistRecords": { useBotanistRecords() {} }, "../utils/plantApi": { plantApi() {} },
    "../utils/apiConfiguration": { mobileApiUrl: () => "https://example.invalid" },
    "../utils/faceSession": { faceSession: {} }, "@expo/vector-icons/Ionicons": { default: "Ionicons" },
    "../utils/useBotanistNotifications": { useBotanistNotifications() {} },
  });
}

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

  const rejectedEdit = dashboard.versionCardItems("plant", 16, { history_available: true, versions: [
    { id: "r16-v1", version_number: 1, status: "Approved", snapshot: {} },
    { id: "r16-v2", version_number: 2, status: "Rejected", snapshot: {} },
  ] });
  assert.equal(dashboard.groupStatusSummary({ versions: rejectedEdit }).detailKey, "rejectedEditCount");
  assert.equal(rejectedEdit[0].current, true, "rejected edit leaves the approved original current");
  const approvedEdits = dashboard.versionCardItems("plant", 17, { history_available: true, versions: [
    { id: "a17-v1", version_number: 1, status: "Approved", snapshot: {} },
    { id: "a17-v2", version_number: 2, status: "Approved", snapshot: {} },
    { id: "a17-v3", version_number: 3, status: "Approved", snapshot: {} },
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
    raw: { id, plant_id: 8, status, created_at, base_snapshot, proposed_snapshot },
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
  assert.equal(originalParams.historicalOriginal, true);
  assert.equal(originalParams.priorChangeVersion, "original");
  assert.equal(originalParams.historicalSnapshot.scientific_name, "Original species");
  const editParams = dashboard.submissionVersionRoute(pending.versions[1], { id: "owner" })[1];
  assert.equal(editParams.priorChangeId, "pending-8");
  assert.equal(editParams.historicalSnapshot.scientific_name, "Edit pending-8");
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
  assert.equal(previousParams.versionId, "tracked-edit");
  assert.equal(previousParams.versionSnapshot, "previous");
  assert.equal(previousParams.historicalSnapshot.scientific_name, "Plant 8 before edit");

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

  const detailSource = read("screens/PlantDetail.js");
  const staffSectionIndex = detailSource.indexOf("STAFF RECORD");
  const addObservationIndex = detailSource.indexOf('<View style={styles.addObservationSection}>');
  const latestVerifiedIndex = detailSource.indexOf("LATEST VERIFIED OBSERVATION");
  assert.ok(staffSectionIndex < addObservationIndex && addObservationIndex < latestVerifiedIndex);
  assert.match(detailSource, /const isPendingInitialReview = plant\?\.currentStatus === "Pending Review";/);
  assert.match(detailSource, /const showObservationHistory = isBotanist && !isPendingInitialReview;/);
  assert.match(detailSource, /\{isBotanist && plant\.currentStatus === "Approved" && \(/);
  assert.equal((detailSource.match(/\{showObservationHistory && \(/g) || []).length, 2);
  assert.match(detailSource, /disabled=\{!canAddObservation\}/);
  assert.match(detailSource, /key=\{observation\.observationId\}/);
  assert.match(detailSource, /getObservationRecorderDisplayName\(observation, user/);
  assert.match(detailSource, /getObservationRecorderDisplayName\(latestApprovedObservation, user/);
  assert.match(detailSource, /selectLatestApprovedObservation\(plant\.observations \|\| \[\]\)/);
  assert.match(detailSource, /<ObservationPhotos photos=\{latestApprovedObservation\.photos\}/);
  assert.match(detailSource, /<ObservationPhotos photos=\{observation\.photos\}/);
  assert.match(detailSource, /observation\.taxonomy/);
  assert.match(detailSource, /latestApprovedObservation \? \(/);
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

test("approved observation selection uses approval state and updated time", () => {
  const latest = context.selectLatestApprovedObservation([
    { observationId: "old-approved", status: "Approved", date: "2026-01-01", updatedAt: "2026-01-01", heightCm: 10 },
    { observationId: "edited-approved", status: "Approved", date: "2025-12-01", updatedAt: "2026-02-01", heightCm: 20 },
    { observationId: "new-pending", status: "Pending Review", date: "2026-03-01", updatedAt: "2026-03-01", heightCm: 99 },
  ]);
  assert.equal(latest.observationId, "edited-approved");
  assert.equal(latest.heightCm, 20);
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
test("loader binds every API call to the account and detail loads owned photo sources", async () => {
  const calls = [];
  const api = fixture(async (path, options) => { calls.push([path, options]); return path === "/plants?scope=mine" ? { plants: rows } : path === "/plants/8?scope=mine" ? { plant: rows[0] } : path === "/observations?scope=mine" ? { observations } : path === "/assets?plant_id=8&scope=mine" ? { assets: [{ id: "asset-8" }] } : { species_requests: requests }; });
  const result = await api.fetchBotanistRecords("owner"); assert.equal(result.plants.length, 1);
  assert.equal(calls.length, 3); assert.ok(calls.every(([, options]) => options.expectedAccountId === "owner"));
  const detail = await api.fetchBotanistPlant("owner", "8");
  assert.equal(detail.photos[0].owner, "owner"); assert.equal(detail.photos[0].uri, "https://example.invalid/assets/asset-8");
  assert.ok(calls.some(([path, options]) => path === "/assets?plant_id=8&scope=mine" && options.expectedAccountId === "owner"));
});
test("approved Plant Details use approved observation values rather than the Botanist's pending edit", () => {
  const result = fixture().projectBotanistRecords("owner", [
    { plant_id: "8", species_id: "6", registered_subject: "staff:owner", rbac_status: "Approved", latest_approved: { heightCm: 52, healthStatus: "Healthy", lifeStage: "Mature", morphology: "Approved leaf form" } },
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
  const hooks = { ...React, useCallback: (fn) => fn, useState: (initial) => {
    const i = index++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
    return [slots[i], (next) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }];
  } };
  const messages = JSON.parse(read("translations/en.json"));
  const t = (key) => key.split(".").reduce((a, k) => a?.[k], messages) || key;
  let historyCalls = 0, openedRoutes = [], goBackCalls = 0, pendingChange = null, availabilityError = false, plantLoadFails = false;
  const native = { StyleSheet: { create: (v) => v }, Alert: { alert: () => {} }, Platform: { OS: "ios" }, UIManager: {}, LayoutAnimation: { Presets: { easeInEaseOut: "ease" }, configureNext: () => {} } };
  for (const name of ["View", "Text", "TextInput", "TouchableOpacity", "ScrollView", "Image", "Modal", "ActivityIndicator"]) native[name] = name;
  const record = fixture().projectBotanistRecords("owner", rows, observations, requests).plants[0];
  record.isHistoricalVersion = false;
  record.photos = [{ uri: "https://example.invalid/assets/private", headers: { Authorization: "Bearer test-only" } }];
  const screen = moduleFrom("screens/BotanistPlantDetail.js", { react: hooks, "react-native": native,
    "@react-navigation/native": { useFocusEffect: (fn) => { focus = fn; } },
    "../utils/botanistRecords": { fetchBotanistPlant: async (...args) => { requested = args; if (plantLoadFails) throw Error("plant detail network failure"); return record; }, fetchBotanistRecordChangeStatus: async () => {
      if (availabilityError) throw Error("offline");
      return { available: true, pending: pendingChange, latest: pendingChange };
    } },
    "../utils/plantApi": { getPlantRegisteredByDisplayName: (plant, user, fallback) => plant.registeredBy === `staff:${user?.id}` ? user?.name || fallback : fallback, plantApi: async (path) => { historyCalls++; return path.startsWith("/record-versions?") ? { history_available: true, versions: [{ id: "v2", version_number: 2, status: "Pending Review", created_at: "2026-11-04T00:00:00Z", edited_by: "staff:owner", previous_snapshot: { scientific_name: "Old name" }, snapshot: { scientific_name: "New name" } }], prior_changes: [] } : { version: {} }; } },
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
  for (const language of ["en", "ms", "zh"]) {
    const translated = JSON.parse(read(`translations/${language}.json`));
    assert.ok(translated.botanistPlantDetail.backToDashboard, `${language} Back to Dashboard translation remains available`);
  }
  cleanup();
  record.status = "Approved";
  render(); const approvedCleanup = focus(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(find((n) => n?.type === "EditAction" && n.props.testID === "edit-own-plant", render()).props.disabled, false);
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
  const hooks = { ...React, useCallback: (fn) => fn, useState: (initial) => {
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
    "../utils/botanistRecords": { fetchBotanistPlant: async () => { apiReads++; throw Error("must not fetch live record"); }, fetchBotanistRecordChangeStatus: async () => { apiReads++; throw Error("must not fetch history"); } },
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
    historicalSnapshot: snapshot, historicalVersionStatus: "Pending Review", submissionVersionLabel: "Edit 1", historicalPhotos: [photo] } };
  const render = () => { index = 0; return screen.default({ route, navigation: { navigate() {}, goBack() {} } }); };
  render(); const cleanup = focus(); await new Promise((resolve) => setImmediate(resolve)); const tree = render();
  const children = (node) => node && typeof node === "object" ? React.Children.toArray(node.props?.children) : [];
  const text = (node) => typeof node === "string" || typeof node === "number" ? String(node) : children(node).map(text).join(" ");
  function find(predicate, node = tree) { if (predicate(node)) return node; for (const child of children(node)) { const result = find(predicate, child); if (result) return result; } }
  for (const value of ["Plant Record", "Review and manage your plant documentation.", "Record ID", "8", "01", "Species", "Version-specific Shorea", "Historical common name", "02", "Plant Information", "03", "Staff Record", "04", "Plant Photos", "Historical plant-level name", "175", "Original notes", "Original taxonomy", "Pending Review", "Edit 1", "Niah"]) assert.ok(text(tree).includes(value), value);
  assert.deepEqual(speciesReads, [["6", "owner"]], "history resolves the species ID from this snapshot using the Botanist's authorized API session");
  assert.equal(apiReads, 1, "historical detail does not fetch the current plant record");
  for (const hidden of ["Category", "Submitted By", "Sync Status", "Species ID"]) assert.ok(!text(tree).includes(hidden), hidden);
  assert.ok(!find((node) => node?.type === "EditAction"), "historical details do not expose editing controls");
  assert.ok(find((node) => node?.type === "Image" && node.props.source.uri === photo.uri), "the selected version's photo is displayed");
  assert.ok(!text(tree).includes("Edit History") && !text(tree).includes("Complete Version"));
  const app = read("App.js");
  assert.match(app, /title: t\("navigation\.plantDetails"\)/);
  assert.match(app, /const isHistoricalDetail = route\.params\?\.historicalRecordDetail === true/);
  assert.match(app, /headerBackTitle: backLabel \|\| undefined/);
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
  const hooks = { ...React, useCallback: (fn) => fn, useState: (initial) => {
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
    "../utils/botanistRecords": { fetchBotanistPlant: async () => submittedPlant, fetchBotanistRecordChangeStatus: async () => ({ available: true, pending: null, latest: null }) },
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

for (const language of ["en", "ms", "zh"]) {
  test(`${language}: dashboard is a main menu and submission/correction pages retain their actions`, () => {
    const messages = JSON.parse(read(`translations/${language}.json`));
    const t = (key, values = {}) => key.split(".").reduce((a, k) => a?.[k], messages)?.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key]) || key;
    let index = 0, slots = []; const navigations = [], alerts = [];
    const projected = fixture().projectBotanistRecords("owner", rows, observations, requests);
    let liveRecords = projected, isLoading = false;
    projected.plants[0].latestObservation = { owner_subject: "staff:owner", status: "Correction Required", plant_id: "8", review_comment: "Please add leaf details." };
    let viewportWidth = 390;
    const native = { StyleSheet: { create: (v) => v }, Alert: { alert: (...args) => alerts.push(args) }, useWindowDimensions: () => ({ width: viewportWidth, height: 844 }) };
    for (const name of ["View", "Text", "TextInput", "TouchableOpacity", "FlatList", "ScrollView", "Image", "ActivityIndicator", "RefreshControl"]) native[name] = name;
    const screen = moduleFrom("screens/BotanistDashboard.js", {
      react: { ...React, useCallback: (callback) => callback, useEffect: () => {}, useRef: (initial) => ({ current: initial }), useState: (initial) => { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], (next) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; } }, "react-native": native,
      "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
      "@react-navigation/native": { useFocusEffect: () => {} },
      "../translations/i18n": { useAppTranslation: () => {}, t, translateLabel: (value) => value, translateUIMessage: (v) => v },
      "../components/LanguageSelector": { default: "LanguageSelector" }, "@expo/vector-icons/Ionicons": { default: "Icon" },
      "../utils/botanistRecords": fixture(),
      "../utils/useBotanistNotifications": { useBotanistNotifications: () => ({ unreadCount: 0 }) },
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
    const cardIDs = ["dashboard-qr", "dashboard-add-plant", "dashboard-submissions", "dashboard-my-draft", "dashboard-corrections"];
    const grid = find((node) => node?.type === "View" && children(node).some((child) => child.props?.testID === "dashboard-qr"));
    assert.deepEqual(children(grid).map((child) => child.props.testID), cardIDs);
    assert.ok(!find((node) => node?.props?.testID === "dashboard-submission-section"));
    assert.ok(!find((node) => node?.props?.testID === "correction-request-section"));
    const correctionBadge = find((node) => node?.props?.testID === "correction-request-badge");
    assert.ok(correctionBadge);
    assert.equal(text(correctionBadge), "1");
    const expectedCardColors = ["#E2F0E4", "#D6E9D9", "#F1EAD8", "#E8EDDA", "#F5E4D5"];
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
    renderDashboard(); assert.ok(!find((node) => node?.props?.testID === "correction-request-badge"), "resolved requests do not show a badge");
    projected.plants[0].latestObservation.status = "Correction Required";
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
    slots = []; index = 0; tree = screen.BotanistCorrectionRequestsScreen({ route: { params: { botanist } }, navigation: { navigate: (...args) => navigations.push(args), goBack: () => navigations.push(["back"]) } });
    assert.ok(text(tree).includes(t("botanistDashboard.noCorrectionRequests")), "approved records are not misclassified as active corrections");
    projected.plants[0].latestObservation.status = "Correction Required";
    slots = []; index = 0; tree = screen.BotanistCorrectionRequestsScreen({ route: { params: { botanist } }, navigation: { navigate: (...args) => navigations.push(args), goBack: () => navigations.push(["back"]) } });
    assert.ok(text(tree).includes("Please add leaf details."));
    assert.ok(!text(tree).includes("common.goBack"), "Correction Requests has no redundant in-page back control");
    assert.ok(text(tree).includes(t("botanistDashboard.correctionFilter.all")));
    const correctionSearch = find((node) => node?.type === "TextInput", tree);
    correctionSearch.props.onChangeText("does not match");
    index = 0; tree = screen.BotanistCorrectionRequestsScreen({ route: { params: { botanist } }, navigation: { navigate: (...args) => navigations.push(args), goBack() {} } });
    assert.ok(text(tree).includes(t("botanistDashboard.noMatchingCorrectionRequests")));
    const correctionFilter = find((node) => node?.props?.testID === "correction-filter-correctionRequired", tree);
    correctionFilter.props.onPress();
    index = 0; tree = screen.BotanistCorrectionRequestsScreen({ route: { params: { botanist } }, navigation: { navigate: (...args) => navigations.push(args), goBack() {} } });
    assert.ok(text(tree).includes(t("botanistDashboard.correctionFilter.correctionRequired")));
    assert.ok(text(tree).includes(t("botanistDashboard.noMatchingCorrectionRequests")));
    correctionSearch.props.onChangeText("");
    index = 0; tree = screen.BotanistCorrectionRequestsScreen({ route: { params: { botanist } }, navigation: { navigate: (...args) => navigations.push(args), goBack() {} } });
    assert.ok(text(tree).includes("Please add leaf details."));
    const edit = find((node) => node?.type === "TouchableOpacity" && text(node).includes(t("botanistDashboard.editPlantCorrection")), tree); assert.ok(edit); edit.props.onPress(); assert.equal(navigations.at(-1)[0], "FieldCollectionEdit");
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
  const hooks = { ...React, useCallback: (fn) => fn, useState: (initial) => { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], (next) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; } };
  const native = { StyleSheet: { create: (v) => v } }; for (const name of ["View", "Text", "ScrollView", "Image", "TouchableOpacity", "ActivityIndicator", "RefreshControl"]) native[name] = name;
  const record = { ...requests[0], genus_name: "Actual genus", family_name: "Actual family", conservation_status: "Endangered", description: "Actual description", habitat: "Actual habitat", submitted_at: "2026-11-03T01:00:00Z", review_comment: "Actual reviewer comment", photo: { uri: "https://example.invalid/photo", headers: { Authorization: "Bearer fixture" } } };
  const screen = moduleFrom("screens/BotanistSpeciesRequestDetail.js", {
    react: hooks, "react-native": native, "@react-navigation/native": { useFocusEffect: (fn) => { focus = fn; } },
    "../utils/botanistRecords": { submissionStatus: fixture().submissionStatus, fetchBotanistSpeciesRequest: async (...args) => { requested = args; return record; }, fetchBotanistRecordChangeStatus: async () => ({ available: true, pending: pendingChange, latest: pendingChange }) },
    "../translations/i18n": { useAppTranslation: () => {}, t: (v) => v, translateLabel: (v) => v, translateUIMessage: (v) => v },
    "../components/EditAction": { default: "EditAction" },
  });
  const render = () => { index = 0; return screen.default({ route: { params: { requestId: "1", botanist: { id: "owner" } } } }); };
  const initialRequestTree = render();
  function findSkeleton(node) { if (!node || typeof node !== "object") return null; if (node.type === "DetailSkeletonContent") return node; for (const child of React.Children.toArray(node.props?.children)) { const match = findSkeleton(child); if (match) return match; } return null; }
  assert.equal(findSkeleton(initialRequestTree)?.props.label, "submissions.loadingRequestDetails");
  const cleanup = focus(); await new Promise((r) => setImmediate(r)); const tree = render();
  const children = (node) => node && typeof node === "object" ? React.Children.toArray(node.props?.children) : [];
  const text = (node) => typeof node === "string" ? node : children(node).map(text).join(" ");
  for (const value of ["Different species name", "Common species name", "Actual genus", "Actual family", "Endangered", "Actual description", "Actual habitat", "Pending Review", "Actual reviewer comment"]) assert.ok(text(tree).includes(value), value);
  assert.deepEqual(requested, ["owner", "1"]); assert.ok(!text(tree).includes("Delete")); cleanup();
  record.request_status = "Approved";
  render(); const approvedCleanup = focus(); await new Promise((resolve) => setImmediate(resolve));
  const approvedTree = render();
  function find(predicate, node) { if (predicate(node)) return node; for (const child of children(node)) { const result = find(predicate, child); if (result) return result; } }
  assert.equal(find((node) => node?.type === "EditAction" && node.props.testID === "edit-own-species", approvedTree).props.disabled, false);
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
  const hooks = { ...React, useCallback: (fn) => fn, useState: (initial) => { const i = index++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], (next) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; } };
  const native = { StyleSheet: { create: (v) => v } }; for (const name of ["View", "Text", "ScrollView", "Image", "TouchableOpacity", "ActivityIndicator", "RefreshControl"]) native[name] = name;
  const snapshot = { request_id: 4, scientific_name: "Historical species", common_name: "First common name", genus_name: "First genus", family_name: "First family", description: "Original description" };
  const photo = { uri: "https://example.invalid/species-original", headers: { Authorization: "Bearer history" } };
  const screen = moduleFrom("screens/BotanistSpeciesRequestDetail.js", { react: hooks, "react-native": native,
    "@react-navigation/native": { useFocusEffect: (fn) => { focus = fn; } },
    "../utils/botanistRecords": { submissionStatus: fixture().submissionStatus, fetchBotanistSpeciesRequest: async () => { reads++; throw Error("must not fetch live request"); }, fetchBotanistRecordChangeStatus: async () => { reads++; throw Error("must not fetch history"); } },
    "../translations/i18n": { useAppTranslation: () => {}, t: (v) => v, translateLabel: (v) => v, translateUIMessage: (v) => v },
    "../components/EditAction": { default: "EditAction" },
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
