import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { canStartObservationEdit, canWithdrawOriginalObservation, observationContentFields, observationDetailContent } from "../utils/observationDetails.js";
const require = createRequire(import.meta.url);
const React = require("react"), ts = require("typescript");

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

function renderObservationDetails(observation, edits = [], params = {}, capabilities = { versioningActive: false, editCapabilityVerified: true }, harness = {}) {
  const hooks = { ...React, useCallback: (callback) => callback,
    useRef: (current) => ({ current }),
    useState: (() => { let slot = 0; return (initial) => { const index = slot++; return [index === 0
      ? { loading: false, observation, editHistory: { edits, versions: capabilities.versions || [], events: [] }, editHistoryError: "", photoToken: "", error: "", ...capabilities }
      : initial, (value) => harness.stateUpdates?.push({ index, value })]; }; })() };
  const native = { StyleSheet: { create: (value) => value }, Alert: { alert: (...args) => harness.alerts?.push(args) } };
  for (const component of ["ActivityIndicator", "Image", "Modal", "ScrollView", "Text", "TouchableOpacity", "View"])
    native[component] = component;
  const mocks = {
    react: hooks, "react-native": native, "@react-navigation/native": { useFocusEffect() {} },
    "../translations/i18n": { useAppTranslation() {}, t: (key) => key, translateLabel: (value) => value,
      translateUIMessage: (value) => value, translateFieldValue: (_field, value) => value,
      translateFieldLabel: (field) => field, formatDateTime: (value) => value },
    "../utils/botanistNotifications": { ownedNotificationObservation() {} },
    "../utils/plantApi": { plantApi: async (...args) => { harness.requests?.push(args); if (harness.failApi) throw new Error(harness.failApi); return {}; }, getObservationRecorderDisplayName: (observation, user, fallback) =>
      observation.recordedByName || (observation.recordedBy === `staff:${user.id}` ? user.name : fallback),
      plantAssetSources: async () => [] }, "../utils/faceSession": { faceSession: {} },
    "../utils/apiConfiguration": { mobileApiUrl: () => "https://example.invalid" },
    "@expo/vector-icons/Ionicons": { default: "Ionicons" },
    "../components/EditAction": { default: "EditAction" },
    "../utils/observationDetails": { canStartObservationEdit, canWithdrawOriginalObservation, observationContentFields, observationDetailContent },
  };
  const code = ts.transpileModule(source("../screens/NotificationObservation.js"), { fileName: "NotificationObservation.jsx",
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)((name) => {
    assert.ok(name in mocks, `Missing mock ${name}`);
    return { ...mocks[name], __esModule: name !== "react" };
  }, module, module.exports);
  return module.exports.default({ route: { params: { observationId: observation.id, ...params } }, navigation: { navigate: (...args) => harness.navigationCalls?.push(args) },
    user: { id: "owner", role: "botanist", name: "Botanist" } });
}

function hasEditObservationButton(tree) {
  const children = (node) => node && typeof node === "object" ? React.Children.toArray(node.props?.children) : [];
  const visit = (node) => node && typeof node === "object" &&
    ((node.type === "EditAction" && node.props.testID === "edit-own-observation") || children(node).some(visit));
  return Boolean(visit(tree));
}

test("actual Observation Details renders Edit for an owned current Approved Observation only", () => {
  const approved = { id: "obs-approved", plant_id: 24, owner_subject: "staff:owner", status: "Approved",
    origin_type: "subsequent_observation", content: { heightCm: 80 }, photos: [] };
  assert.equal(hasEditObservationButton(renderObservationDetails(approved)), true);
  for (const status of ["Pending Review", "Correction Required", "Rejected", "Cancelled", "Superseded"])
    assert.equal(hasEditObservationButton(renderObservationDetails({ ...approved, status })), false, status);
  assert.equal(hasEditObservationButton(renderObservationDetails({ ...approved, owner_subject: "staff:other" })), false);
  assert.equal(hasEditObservationButton(renderObservationDetails(approved,
    [{ id: "active", status: "Pending Review", owner_subject: "staff:owner" }])), false);
  assert.equal(hasEditObservationButton(renderObservationDetails(approved, [],
    { observationVersionSnapshot: { content: approved.content, status: "Approved" } })), false,
  "an approved historical snapshot remains read-only");
  for (const origin_type of ["initial_registration", "unknown"])
    assert.equal(hasEditObservationButton(renderObservationDetails({ ...approved, origin_type })), true, origin_type);
  assert.equal(hasEditObservationButton(renderObservationDetails({ ...approved, origin_type: "initial_registration" }, [], {},
    { versioningActive: true, editCapabilityVerified: true })), true, "verified initial-registration origin is eligible");
  assert.equal(hasEditObservationButton(renderObservationDetails({ ...approved, origin_type: undefined }, [], {},
    { versioningActive: true, editCapabilityVerified: true })), false, "missing provenance is not eligible in version-aware mode");
  assert.equal(hasEditObservationButton(renderObservationDetails({ ...approved, origin_type: "unknown", raw_origin_type: "initial_registration" }, [], {},
    { versioningActive: true, editCapabilityVerified: true })), false, "client raw origin labels cannot override unknown verified provenance");
  assert.equal(hasEditObservationButton(renderObservationDetails({ ...approved, origin_type: "subsequent_observation" }, [], {},
    { versioningActive: true, editCapabilityVerified: true })), true, "verified subsequent origin is eligible");
  assert.equal(hasEditObservationButton(renderObservationDetails(approved, [], {},
    { versioningActive: true, editCapabilityVerified: false })), false, "eligibility fails closed if capability mode cannot be verified");
  const screen = source("../screens/NotificationObservation.js");
  assert.match(screen, /canStartObservationEdit\(row/);
  assert.doesNotMatch(screen, /observation-section-05|state\.editHistory\?\.events\?\.length/);
});

test("Observation Details renders the Plant-style summary, numbered sections, photos and exact historical review", async () => {
  const children = (node) => node && typeof node === "object" ? React.Children.toArray(node.props?.children) : [];
  const text = (node) => typeof node === "string" ? node : children(node).map(text).join(" ");
  const find = (node, predicate) => predicate(node) ? node : children(node).map((child) => find(child, predicate)).find(Boolean);
  const row = { id: "obs-20", plant_id: 20, owner_subject: "staff:owner", status: "Approved",
    review_comment: "Current feedback", recorded_by_name: "Author Botanist",
    content: { heightCm: 40, healthStatus: "Healthy", lifeStage: "Mature", morphology: "Broad leaves",
      taxonomy: "Taxonomy note", notes: "Field note", latitude: 4.5, longitude: 113.7, accuracy_m: 3,
      zone: "Current zone", altitudeM: 22 },
    photos: [{ id: "photo-1", uri: "https://example.invalid/photo-1", headers: { Authorization: "Bearer test" } }] };
  const current = renderObservationDetails(row);
  assert.equal(find(current, (node) => node?.type === "EditAction")?.props.testID, "edit-own-observation");
  assert.ok(!find(current, (node) => node?.type === "TouchableOpacity" && text(node).includes("observationEdits.editObservation")));
  const summary = find(current, (node) => node?.props?.testID === "observation-record-meta");
  assert.ok(text(summary).includes("obs-20"));
  assert.equal(find(summary, (node) => node?.type?.name === "StatusBadge")?.props.status, "Approved");
  for (const number of ["01", "02", "03", "04"])
    assert.ok(find(current, (node) => node?.props?.testID === `observation-section-${number}`), number);
  assert.ok(text(find(current, (node) => node?.props?.testID === "observation-section-01")).includes("40"));
  for (const value of ["Healthy", "Mature", "Broad leaves", "Taxonomy note", "Field note"])
    assert.ok(text(find(current, (node) => node?.props?.testID === "observation-section-01")).includes(value), value);
  assert.ok(text(current).includes("Author Botanist"));
  assert.ok(text(find(current, (node) => node?.props?.testID === "observation-section-02")).includes("Current zone"));
  for (const value of ["4.5", "113.7", "3", "22"])
    assert.ok(text(find(current, (node) => node?.props?.testID === "observation-section-02")).includes(value), value);
  const photo = find(current, (node) => node?.type === "Image" && node.props.source?.uri?.endsWith("photo-1"));
  assert.equal(photo.props.source.headers.Authorization, "Bearer test");
  assert.equal(typeof photo.props.onError, "function");
  assert.equal(typeof find(current, (node) => node?.type === "TouchableOpacity" &&
    children(node).some((child) => child?.type === "Image" && child.props.source?.uri?.endsWith("photo-1")))?.props.onPress, "function");
  const pendingEdit = { id: "edit-20", status: "Pending Review", revision: 1, owner_subject: "staff:owner", version_number: 1,
    proposed_content: { heightCm: 35 } };
  const originalVersion = { id: "original-version", version_number: 0, submission_type: "original", status: "Approved", content: { heightCm: 30 } };
  const originalParams = { observationVersionId: originalVersion.id, editRequestId: pendingEdit.id,
    observationVersionSnapshot: { original: true, status: "Approved", content: { heightCm: 30 }, photoIds: [] } };
  const originalView = renderObservationDetails(row, [pendingEdit], originalParams, { versioningActive: false,
    editCapabilityVerified: true, versions: [originalVersion] });
  const originalSummary = find(originalView, (node) => node?.props?.testID === "observation-record-meta");
  assert.equal(find(originalSummary, (node) => node?.type?.name === "StatusBadge")?.props.status, "Approved");
  assert.equal(find(originalView, (node) => node?.props?.testID === "pending-observation-edit-request"), undefined,
    "Original never falls back to an unrelated active edit request");
  assert.equal(find(originalView, (node) => node?.props?.testID === "cancel-observation-edit-request"), undefined);
  const idValue = find(originalSummary, (node) => node?.props?.testID === "observation-id-value");
  assert.equal(idValue.props.children, row.id);
  assert.equal(idValue.props.selectable, true);
  assert.equal(idValue.props.numberOfLines, undefined, "the Observation UUID is not truncated");
  const plantStatusRow = find(originalSummary, (node) => node?.props?.testID === "plant-id-status-row");
  assert.ok(plantStatusRow);
  assert.equal(find(plantStatusRow, (node) => node?.type?.name === "StatusBadge")?.props.status, "Approved",
    "the status badge is on its own row below the full UUID");

  const originalPending = { ...row, status: "Pending Review", origin_type: "initial_registration" };
  const originalPendingVersion = { ...originalVersion, status: "Pending Review" };
  const plantLinkHarness = { navigationCalls: [] };
  const originalPendingView = renderObservationDetails(originalPending, [pendingEdit], {
    observationVersionId: originalPendingVersion.id,
    observationVersionSnapshot: { original: true, status: "Pending Review", content: originalPendingVersion.content, photoIds: [] },
  }, { versioningActive: false, editCapabilityVerified: true, versions: [originalPendingVersion] }, plantLinkHarness);
  const plantLink = find(originalPendingView, (node) => node?.props?.testID === "open-parent-plant-submission");
  assert.ok(plantLink, "an owned Original registration Observation has a compact Plant submission link");
  assert.ok(find(plantLink, (node) => node?.type === "Ionicons" && node.props.name === "leaf-outline"));
  assert.ok(find(plantLink, (node) => node?.type === "Ionicons" && node.props.name === "chevron-forward"));
  assert.equal(plantLink.props.accessibilityRole, "button");
  assert.ok(plantLink.props.style.minHeight >= 44);
  plantLink.props.onPress();
  assert.deepEqual(plantLinkHarness.navigationCalls[0], ["BotanistPlantDetail", {
    plantId: originalPending.plant_id, botanist: { id: "owner", role: "Botanist" },
  }]);
  const subsequentView = renderObservationDetails({ ...originalPending, origin_type: "subsequent_observation" });
  assert.equal(find(subsequentView, (node) => node?.props?.testID === "open-parent-plant-submission"), undefined);
  const editPlantView = renderObservationDetails(originalPending, [pendingEdit], {
    observationVersionId: "edit-plant-version",
    observationVersionSnapshot: { original: false, status: "Pending Review", editNumber: 1 },
  }, { versioningActive: false, editCapabilityVerified: true, versions: [{ id: "edit-plant-version", version_number: 1,
    request_revision: 1, edit_request_id: pendingEdit.id, status: "Pending Review" }] });
  assert.equal(find(editPlantView, (node) => node?.props?.testID === "open-parent-plant-submission"), undefined,
    "an edit version keeps its own workflow actions");
  const unauthorizedPlantView = renderObservationDetails({ ...originalPending, status: "Approved", owner_subject: "staff:other" }, [],
    { readOnlyApproved: true, observationVersionSnapshot: { original: true, status: "Approved" } }, undefined);
  assert.equal(find(unauthorizedPlantView, (node) => node?.props?.testID === "open-parent-plant-submission"), undefined);
  assert.doesNotMatch(source("../screens/NotificationObservation.js"), /parentRequired|parentWithdrawalNotice/);

  const pendingVersion = { id: "edit-version", version_number: 1, request_revision: 1, edit_request_id: pendingEdit.id,
    status: "Approved", content: { heightCm: 34 } };
  const editParams = { observationVersionId: pendingVersion.id,
    observationVersionSnapshot: { original: false, status: "Pending Review", editNumber: 1, content: pendingVersion.content, photoIds: [] } };
  const activeRequest = renderObservationDetails(row, [pendingEdit], editParams, { versioningActive: false,
    editCapabilityVerified: true, versions: [pendingVersion] });
  const activeSummary = find(activeRequest, (node) => node?.props?.testID === "observation-record-meta");
  const heading = find(activeRequest, (node) => node?.props?.testID === "observation-detail-heading");
  const cancelButton = find(heading, (node) => node?.props?.testID === "cancel-observation-edit-request");
  assert.ok(cancelButton, "the selected eligible edit has a compact heading action");
  assert.equal(cancelButton.props.accessibilityLabel, "recordEdits.cancelEditRequest");
  assert.equal(find(cancelButton, (node) => node?.type === "Ionicons" && node.props.name === "trash-outline")?.props.color, "#B42318");
  assert.equal(find(heading, (node) => node?.props?.testID === "pending-observation-edit-request"), undefined);
  assert.equal(find(activeRequest, (node) => node?.props?.testID === "pending-observation-edit-request"), undefined,
    "the large Pending Edit Request card is removed");
  assert.equal(find(activeSummary, (node) => node?.type?.name === "StatusBadge")?.props.status, "Pending Review",
    "the selected Edit 1 shows its own current status");
  assert.ok(text(find(activeRequest, (node) => node?.props?.testID === "observation-section-01")).includes("34"),
    "the selected Edit 1 displays its proposed information");
  const directlyOpenedEdit = renderObservationDetails(row, [pendingEdit], { editRequestId: pendingEdit.id });
  assert.ok(find(directlyOpenedEdit, (node) => node?.props?.testID === "cancel-observation-edit-request"),
    "direct navigation resolves the specified edit request");
  assert.ok(text(find(directlyOpenedEdit, (node) => node?.props?.testID === "observation-section-01")).includes("35"));
  const emptyRequest = renderObservationDetails(row);
  assert.equal(find(find(emptyRequest, (node) => node?.props?.testID === "observation-detail-heading"),
    (node) => node?.props?.testID === "cancel-observation-edit-request"), undefined);
  const foreignEdit = { id: "edit-foreign", status: "Pending Review", revision: 1, owner_subject: "staff:other" };
  const foreignVersion = { ...pendingVersion, id: "foreign-version", edit_request_id: foreignEdit.id };
  const foreignRequest = renderObservationDetails(row, [foreignEdit], { observationVersionId: foreignVersion.id,
    observationVersionSnapshot: { original: false, status: "Pending Review" } },
  { versioningActive: false, editCapabilityVerified: true, versions: [foreignVersion] });
  assert.equal(find(foreignRequest, (node) => node?.props?.testID === "cancel-observation-edit-request"), undefined,
    "another Botanist's request is not shown");
  assert.ok(!find(activeRequest, (node) => node?.type === "EditAction"));
  const correctedEdit = { ...pendingEdit, revision: 2 };
  const correctedVersion = { ...pendingVersion, id: "edit-version-2", request_revision: 2 };
  const correctedPending = renderObservationDetails(row, [correctedEdit], { observationVersionId: correctedVersion.id,
    observationVersionSnapshot: { original: false, status: "Pending Review", editNumber: 1 } },
  { versioningActive: false, editCapabilityVerified: true, versions: [correctedVersion] });
  assert.equal(find(correctedPending, (node) => node?.props?.testID === "cancel-observation-edit-request"), undefined,
    "a resubmitted request is not cancellable");
  const correctionEdit = { ...pendingEdit, status: "Correction Required", revision: 2 };
  const correctionVersion = { ...pendingVersion, id: "correction-version", request_revision: 2, status: "Correction Required" };
  const correctionRequired = renderObservationDetails(row, [correctionEdit], { observationVersionId: correctionVersion.id,
    observationVersionSnapshot: { original: false, status: "Correction Required", editNumber: 1 } },
  { versioningActive: false, editCapabilityVerified: true, versions: [correctionVersion] });
  assert.ok(find(correctionRequired, (node) => node?.props?.testID === "cancel-observation-edit-request"));
  for (const status of ["Approved", "Rejected", "Cancelled"]) {
    const closedEdit = { ...pendingEdit, status };
    const terminalVersion = { ...pendingVersion, id: `terminal-${status}`, status };
    const terminalEdit = renderObservationDetails(row, [closedEdit], { observationVersionId: terminalVersion.id,
      observationVersionSnapshot: { original: false, status } },
    { versioningActive: false, editCapabilityVerified: true, versions: [terminalVersion] });
    assert.equal(find(terminalEdit, (node) => node?.props?.testID === "cancel-observation-edit-request"), undefined, status);
  }
  const cancelHarness = { alerts: [], requests: [], stateUpdates: [] };
  const cancelTree = renderObservationDetails(row, [pendingEdit], editParams, { versioningActive: false,
    editCapabilityVerified: true, versions: [pendingVersion] }, cancelHarness);
  find(cancelTree, (node) => node?.props?.testID === "cancel-observation-edit-request").props.onPress();
  assert.equal(cancelHarness.alerts[0][0], "recordEdits.deleteEditTitle");
  assert.equal(cancelHarness.alerts[0][1], "observationEdits.cancelConfirmation");
  assert.ok(cancelHarness.alerts[0][1].includes("cancelConfirmation"), "confirmation explains the approved Observation remains unchanged");
  await cancelHarness.alerts[0][2][1].onPress();
  assert.equal(cancelHarness.requests[0][0], "/observation-edits/edit-20/cancel");
  assert.deepEqual(cancelHarness.requests[0][1], { method: "POST", expectedAccountId: "owner", body: {} });
  assert.ok(cancelHarness.stateUpdates.some(({ index, value }) => index === 3 && typeof value === "function"),
    "successful cancellation refreshes the Observation and edit-request state");
  const failureHarness = { alerts: [], requests: [], stateUpdates: [], failApi: "stale revision" };
  const failureTree = renderObservationDetails(row, [pendingEdit], editParams, { versioningActive: false,
    editCapabilityVerified: true, versions: [pendingVersion] }, failureHarness);
  find(failureTree, (node) => node?.props?.testID === "cancel-observation-edit-request").props.onPress();
  await failureHarness.alerts[0][2][1].onPress();
  assert.ok(failureHarness.stateUpdates.some(({ index, value }) => index === 5 && value === "stale revision"),
    "a failed cancellation keeps the request visible and exposes the error");
  const historical = renderObservationDetails(row, [], { observationVersionSnapshot: {
    content: { heightCm: 25, zone: "Old zone" }, status: "Rejected", reviewComment: "Historical feedback",
    original: true, current: false, createdAt: "2026-11-12T00:00:00Z", photoIds: [],
  } });
  assert.ok(!find(historical, (node) => node?.type === "EditAction"));
  assert.equal(find(historical, (node) => node?.type?.name === "StatusBadge")?.props.status, "Rejected");
  assert.ok(text(find(historical, (node) => node?.props?.testID === "observation-section-01")).includes("25"));
  assert.ok(!text(historical).includes("Current feedback"));
  assert.ok(text(historical).includes("Historical feedback"));
  const otherBotanist = renderObservationDetails({ ...row, owner_subject: "staff:author" }, [], { readOnlyApproved: true });
  assert.ok(text(otherBotanist).includes("Author Botanist"));
  assert.ok(!find(otherBotanist, (node) => node?.type === "EditAction"));
  assert.match(source("../screens/NotificationObservation.js"), /plantApi\(`\/observations\/\$\{encodeURIComponent\(observationId\)\}`/);
});

test("Botanist Observation details preserve Withdrawn status and hide edit and withdrawal actions", () => {
  const children = (node) => node && typeof node === "object" ? React.Children.toArray(node.props?.children) : [];
  const find = (node, predicate) => predicate(node) ? node : children(node).map((child) => find(child, predicate)).find(Boolean);
  const withdrawn = renderObservationDetails({ id: "obs-withdrawn", plant_id: 24, owner_subject: "staff:owner",
    origin_type: "subsequent_observation", status: "Withdrawn", withdrawn_at: "2026-11-16T00:00:00Z",
    content: { heightCm: 24 }, photos: [] });
  assert.equal(find(withdrawn, (node) => node?.type?.name === "StatusBadge")?.props.status, "Withdrawn");
  assert.equal(find(withdrawn, (node) => node?.props?.testID === "withdraw-original-observation"), undefined);
  assert.equal(hasEditObservationButton(withdrawn), false);
  const historical = renderObservationDetails({ id: "obs-approved", plant_id: 24, owner_subject: "staff:owner",
    status: "Approved", content: { heightCm: 30 }, photos: [] }, [], {
    observationVersionSnapshot: { status: "Withdrawn", content: { heightCm: 24 }, original: true,
      current: false, photoIds: [] },
  });
  assert.equal(find(historical, (node) => node?.type?.name === "StatusBadge")?.props.status, "Withdrawn");
  assert.equal(find(historical, (node) => node?.props?.testID === "withdraw-original-observation"), undefined);
  assert.equal(hasEditObservationButton(historical), false);
});

test("rejected Observation details use the selected status for the red alert, summary and exact Officer feedback", () => {
  const children = (node) => node && typeof node === "object" ? React.Children.toArray(node.props?.children) : [];
  const text = (node) => typeof node === "string" ? node : children(node).map(text).join(" ");
  const find = (node, predicate) => predicate(node) ? node : children(node).map((child) => find(child, predicate)).find(Boolean);
  const observation = { id: "obs-rejected", plant_id: 24, owner_subject: "staff:owner", status: "Approved",
    content: { heightCm: 18 }, photos: [], review_comment: "Base record feedback" };
  const rejected = renderObservationDetails(observation, [], { observationVersionSnapshot: {
    content: { heightCm: 17 }, status: "Rejected", reviewComment: "Exact edit rejection feedback", original: false,
    editNumber: 1, current: false, photoIds: [],
  } });
  const banner = find(rejected, (node) => node?.props?.testID === "observation-rejected-banner");
  assert.ok(banner);
  assert.ok(text(banner).includes("notificationObservation.rejectedTitle"));
  const meta = find(rejected, (node) => node?.props?.testID === "observation-record-meta");
  assert.ok((Array.isArray(meta.props.style) ? meta.props.style : [meta.props.style]).some((style) => style?.backgroundColor === "#FDECEC"));
  const badgeElement = find(meta, (node) => node?.type?.name === "StatusBadge");
  assert.equal(badgeElement.props.status, "Rejected", "the selected version controls the badge rather than the parent row");
  const badge = badgeElement.type(badgeElement.props);
  const badgeChildren = React.Children.toArray(badge.props.children);
  const badgeText = badgeChildren.find((child) => child?.type === "Text");
  assert.ok((Array.isArray(badge.props.style) ? badge.props.style : [badge.props.style]).some((style) => style?.backgroundColor === "#B42318"));
  assert.ok((Array.isArray(badgeText.props.style) ? badgeText.props.style : [badgeText.props.style]).some((style) => style?.color === "#FFFFFF"));
  const feedback = find(rejected, (node) => node?.props?.testID === "observation-rejected-feedback");
  assert.ok(feedback);
  assert.ok(text(feedback).includes("Exact edit rejection feedback"));
  assert.ok(!text(feedback).includes("Base record feedback"));
  assert.equal((text(rejected).match(/Exact edit rejection feedback/g) || []).length, 1);
  assert.equal(JSON.parse(source("../translations/en.json")).notificationObservation.rejectedTitle, "Observation Rejected");
  assert.equal(JSON.parse(source("../translations/ms.json")).notificationObservation.rejectedTitle, "Pemerhatian Ditolak");

  const approved = renderObservationDetails(observation);
  assert.equal(find(approved, (node) => node?.props?.testID === "observation-rejected-banner"), undefined);
  const approvedMeta = find(approved, (node) => node?.props?.testID === "observation-record-meta");
  assert.ok(!(Array.isArray(approvedMeta.props.style) ? approvedMeta.props.style : [approvedMeta.props.style]).some((style) => style?.backgroundColor === "#FDECEC"));
});

test("Observation detail section labels have English, Malay and Chinese translations", () => {
  const keys = ["recordTitle", "recordSubtitle", "informationSubtitle", "locationInformation", "locationSubtitle",
    "photosSubtitle", "reviewSubtitle"];
  for (const language of ["en", "ms", "zh"]) {
    const catalog = JSON.parse(source(`../translations/${language}.json`));
    for (const key of keys) assert.ok(catalog.notificationObservation[key], `${language}.${key}`);
    assert.ok(catalog.observationWithdrawal.openPlant, `${language}.observationWithdrawal.openPlant`);
    assert.equal(catalog.observationWithdrawal.parentRequired, undefined, `${language} no longer has the obsolete withdrawal paragraph`);
  }
  assert.deepEqual(["en", "ms", "zh"].map((language) => JSON.parse(source(`../translations/${language}.json`)).observationWithdrawal.openPlant),
    ["View Plant Submission", "Lihat Penyerahan Tumbuhan", "查看植物提交"]);
});

test("Approved observation editing reuses the existing form and sends a separate proposal", () => {
  const detail = source("../screens/NotificationObservation.js");
  const form = source("../screens/FieldCollection.js");
  const sync = source("../utils/fieldSync.js");
  assert.match(detail, /canStartObservationEdit\(row, state\.editHistory, activeEdit, selectedDetail, accountId, state\.versioningActive\)/);
  assert.match(detail, /navigate\("FieldCollectionEdit", \{ observation: row, plantId: row\.plant_id, editRequestMode: true \}\)/);
  assert.match(form, /method: "OBSERVATION_EDIT"/);
  assert.match(form, /path: request\?\.id \? `\/observation-edits\/\$\{request\.id\}` : "\/observation-edits"/);
  assert.match(sync, /if \(draft\.method === "OBSERVATION_EDIT"\)/);
  assert.match(sync, /method: correction \? "PATCH" : "POST"/);
  assert.match(sync, /type: "observation-edit"/);
});

test("version-aware Observation editing requires verified origin and Officer decisions submit the displayed revision", () => {
  const detail = source("../screens/NotificationObservation.js");
  const review = source("../screens/RecordChangeReview.js");
  const helper = source("../utils/observationDetails.js");
  assert.match(detail, /plantApi\("\/observation-edits\/capabilities"/);
  assert.match(detail, /versioningActive: capability\?\.versioning_available === true/);
  assert.match(detail, /editCapabilityVerified &&[\s\S]*canStartObservationEdit\(row, state\.editHistory, activeEdit, selectedDetail, accountId, state\.versioningActive\)/);
  assert.match(helper, /\["initial_registration", "subsequent_observation"\]\.includes\(row\?\.origin_type\)/);
  assert.match(review, /body: \{ decision, comment: comment\.trim\(\), revision: selected\.revision \}/);
});

test("Observation Details uses the shared centered header and preserves back navigation", () => {
  const app = source("../App.js");
  assert.match(app, /name="NotificationObservation"\s+options=\{\(\{ route, navigation \}\) => centeredDetailHeader\(\{ route, navigation, title: t\("navigation\.observationDetails"\) \}\)\}/);
  assert.match(app, /headerTitleAlign: "center"/);
  assert.match(app, /onPress=\{\(\) => navigation\.goBack\(\)\}/);
});

test("Observation Details displays every backend-supported content field from the selected version", () => {
  assert.deepEqual(observationContentFields, ["heightCm", "healthStatus", "lifeStage", "morphology", "taxonomy", "notes",
    "latitude", "longitude", "accuracy_m", "zone", "altitudeM"]);
  const current = Object.fromEntries(observationContentFields.map((field) => [field, `current-${field}`]));
  const original = Object.fromEntries(observationContentFields.map((field) => [field, `original-${field}`]));
  const proposed = Object.fromEntries(observationContentFields.map((field) => [field, `edit-${field}`]));
  const row = { content: current };
  assert.deepEqual(observationDetailContent(row, null, null, null, false), current);
  assert.deepEqual(observationDetailContent(row, { content: original }, null, null, true), original);
  assert.deepEqual(observationDetailContent(row, { content: original }, null, { proposed_content: proposed }, true), proposed);
  assert.deepEqual(observationDetailContent(row, { content: original }, { content: original }, { proposed_content: proposed }, true), original,
    "an approved historical version retains its exact snapshot");
  const detail = source("../screens/NotificationObservation.js");
  assert.match(detail, /observationContentFields\.map\(\(field\) =>/);
  assert.match(detail, /formatDateTime\(displayDate\)/);
  assert.match(detail, /photos\.map\(\(photo, index\) => <TouchableOpacity/);
  assert.match(detail, /selectedVersion\.photo_ids\.map\(\(id, index\) =>/);
  assert.match(detail, /selectedSnapshot\?\.useCurrentPhotos \? row\?\.photos \|\| \[\] : \[\]/);
  assert.match(detail, /requestSelection = !originalSelection && Boolean\(route\.params\?\.editRequestId\)/);
  assert.match(detail, /originalSelection \? null : route\.params\?\.editRequestId/);
  assert.match(detail, /selectedDetail = historicalSelection \|\| requestSelection/);
});

test("status badges, separate Officer Review, and active request actions cover all review states", () => {
  const detail = source("../screens/NotificationObservation.js");
  for (const status of ["Pending Review", "Correction Required", "Approved", "Rejected", "Cancelled"])
    assert.ok(detail.includes(status), `Missing ${status} status handling`);
  assert.match(detail, /testID="observation-status-badge"/);
  assert.match(detail, /t\("notificationObservation\.officerReview"\)/);
  assert.match(detail, /selectedEdit\?\.review_comment/);
  assert.match(detail, /selectedEdit\?\.reviewed_at/);
  assert.match(detail, /selectedEdit\?\.reviewed_by/);
  const owned = { owner_subject: "staff:owner", status: "Approved", origin_type: "subsequent_observation" };
  assert.equal(canStartObservationEdit(owned, { edits: [] }, null, false, "owner"), true);
  for (const origin_type of ["initial_registration", "unknown"])
    assert.equal(canStartObservationEdit({ ...owned, origin_type }, { edits: [] }, null, false, "owner"), true);
  for (const status of ["Pending Review", "Correction Required", "Rejected", "Cancelled", "Superseded"])
    assert.equal(canStartObservationEdit({ ...owned, status }, { edits: [] }, null, false, "owner"), false, status);
  assert.equal(canStartObservationEdit(owned, { edits: [] }, { id: "active" }, false, "owner"), false);
  assert.equal(canStartObservationEdit(owned, { edits: [] }, null, true, "owner"), false);
  assert.equal(canStartObservationEdit(owned, { edits: [] }, null, false, "other"), false);
  assert.equal(canStartObservationEdit(owned, null, null, false, "owner"), false);
  assert.match(detail, /selectedEdit\.status === "Correction Required"/);
  assert.match(detail, /selectedEdit\.owner_subject === `staff:\$\{accountId\}`/);
  assert.match(detail, /activeEdit\?\.id === selectedEdit\.id/);
  const form = source("../screens/FieldCollection.js");
  assert.match(form, /online && observationEditMode && !observationCorrectionWorkflow/);
  assert.match(form, /plantApi\(`\/observations\/\$\{encodeURIComponent\(observationId\)\}`/);
  assert.match(form, /plantApi\(`\/observations\/\$\{encodeURIComponent\(observationId\)\}\/edit-history`/);
  assert.match(form, /currentObservation\.status !== "Approved"/);
  assert.match(form, /\["Pending Review", "Correction Required"\]\.includes\(request\.status\)/);
  const backend = source("../../plant-conservation-backend/observation-edits.cjs");
  assert.match(backend, /if \(observation\.status !== "Approved"\) fail\(409/);
  assert.match(backend, /status IN \('Pending Review','Correction Required'\)/);
  assert.match(backend, /row\.status !== "Correction Required" \|\| row\.revision !== revision/);
});

test("Observation withdrawal is rendered only for an eligible current field request and uses confirmation", async () => {
  const alerts = [], requests = [];
  const detail = source("../screens/NotificationObservation.js");
  assert.match(detail, /plantApi\(`\/observations\/\$\{encodeURIComponent\(row\.id\)\}\/withdraw`/);
  assert.match(detail, /withdraw-original-observation/);
  const eligible = { id: "obs-withdraw", plant_id: 24, owner_subject: "staff:owner", status: "Pending Review",
    origin_type: "subsequent_observation", review_decision: "", content: { heightCm: 60 }, photos: [] };
  assert.equal(canWithdrawOriginalObservation(eligible, null, false, "owner"), true);
  for (const status of ["Approved", "Rejected", "Withdrawn", "Superseded"])
    assert.equal(canWithdrawOriginalObservation({ ...eligible, status }, null, false, "owner"), false, status);
  assert.equal(canWithdrawOriginalObservation({ ...eligible, status: "Pending Review", review_decision: "Correction Required" }, null, false, "owner"), false,
    "a correction resubmission awaiting review stays locked");
  assert.equal(canWithdrawOriginalObservation({ ...eligible, status: "Correction Required" }, null, false, "owner"), true,
    "a correction request may be withdrawn");
  assert.equal(canWithdrawOriginalObservation({ ...eligible, origin_type: "initial_registration" }, null, false, "owner"), false);
  assert.equal(canWithdrawOriginalObservation({ ...eligible, origin_type: "unknown" }, null, false, "owner"), false);
  assert.equal(canWithdrawOriginalObservation(eligible, { status: "Pending Review" }, false, "owner"), false);
  assert.equal(canWithdrawOriginalObservation(eligible, null, true, "owner"), false);
  assert.equal(canWithdrawOriginalObservation({ ...eligible, owner_subject: "staff:other" }, null, false, "owner"), false);

  const code = require("typescript").transpileModule(detail, { fileName: "NotificationObservation.jsx",
    compilerOptions: { jsx: require("typescript").JsxEmit.React, module: require("typescript").ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  const dependencies = {
    react: { ...React, useCallback: (callback) => callback, useRef: (current) => ({ current }),
      useState: (() => { let slot = 0; return (initial) => [slot++ === 0
        ? { loading: false, observation: eligible, editHistory: { edits: [], versions: [], events: [] }, editHistoryError: "", photoToken: "", error: "" }
        : initial, () => {}]; })() },
    "react-native": { StyleSheet: { create: (value) => value }, Alert: { alert: (...args) => alerts.push(args) },
      ActivityIndicator: "ActivityIndicator", Image: "Image", Modal: "Modal", ScrollView: "ScrollView", Text: "Text", TouchableOpacity: "TouchableOpacity", View: "View" },
    "@react-navigation/native": { useFocusEffect() {} }, "../translations/i18n": { useAppTranslation() {}, t: (key) => key,
      translateLabel: (value) => value, translateUIMessage: (value) => value, translateFieldValue: (_field, value) => value,
      translateFieldLabel: (field) => field, formatDateTime: (value) => value },
    "../utils/botanistNotifications": { ownedNotificationObservation: async () => eligible },
    "../utils/plantApi": { plantApi: async (...args) => { requests.push(args); return {}; },
      getObservationRecorderDisplayName: (_row, _user, fallback) => fallback, plantAssetSources: async () => [] },
    "../utils/faceSession": { faceSession: {} }, "../utils/apiConfiguration": { mobileApiUrl: () => "https://example.invalid" },
    "@expo/vector-icons/Ionicons": { default: "Ionicons" }, "../components/EditAction": { default: "EditAction" },
    "../utils/observationDetails": { canStartObservationEdit, canWithdrawOriginalObservation, observationContentFields, observationDetailContent },
  };
  new Function("require", "module", "exports", code)((name) => ({ ...dependencies[name], __esModule: name !== "react" }), module, module.exports);
  const tree = module.exports.default({ route: { params: { observationId: eligible.id } }, navigation: { navigate() {} },
    user: { id: "owner", role: "botanist", name: "Botanist" } });
  const children = (node) => node && typeof node === "object" ? React.Children.toArray(node.props?.children) : [];
  const find = (node, id) => node && typeof node === "object" && (node.props?.testID === id ? node : children(node).map((child) => find(child, id)).find(Boolean));
  const button = find(tree, "withdraw-original-observation");
  assert.ok(button, "the actual eligible Observation Details screen renders Withdraw");
  assert.ok(find(find(tree, "observation-detail-heading"), "withdraw-original-observation"),
    "record withdrawal sits beside the Observation title");
  assert.equal(find(find(tree, "observation-record-meta"), "withdraw-original-observation"), undefined,
    "the Record ID card has no withdrawal icon");
  button.props.onPress();
  assert.equal(alerts[0][0], "observationWithdrawal.confirmTitle");
  assert.equal(requests.length, 0, "opening confirmation does not withdraw");
  assert.equal(alerts[0][2][0].text, "observationWithdrawal.keepSubmission");
  assert.equal(alerts[0][2][0].style, "cancel");
  assert.equal(requests.length, 0, "Keep Submission leaves the API untouched");
  await alerts[0][2][1].onPress();
  assert.equal(requests[0][0], `/observations/${eligible.id}/withdraw`);
});

test("correction routing selects the pending proposal while rejected proposals remain read only", () => {
  const notifications = source("../screens/BotanistNotifications.js");
  const correction = source("../screens/BotanistDashboard.js");
  const detail = source("../screens/NotificationObservation.js");
  assert.match(notifications, /item\.entityType === "observation_edit"/);
  assert.match(notifications, /payload\.edit\.status === "Correction Required"/);
  assert.match(correction, /row\.status === "Correction Required"/);
  assert.match(detail, /selectedEdit\.status === "Correction Required"/);
  assert.doesNotMatch(detail, /state\.editHistory\.versions\.map/);
  const officer = source("../screens/RecordChangeReview.js");
  assert.match(officer, /plantApi\("\/observation-edits\/capabilities"\)/);
  assert.match(officer, /selected\.observationEdit \? "observation-edits" : "record-changes"/);
  assert.match(officer, /review\("Correction Required"\)/);
});

test("legacy initial Observation edit corrections navigate by exact request and revision", () => {
  const notifications = source("../screens/BotanistNotifications.js");
  const store = source("../utils/botanistNotificationStore.js");
  const form = source("../screens/FieldCollection.js");
  assert.match(store, /item\.entityType === "observation_edit"[\s\S]*Number\.isInteger\(item\.revision\)/);
  assert.match(form, /photos\.length \+ \(originalObservation\?\.assets\?\.length \|\| 0\) \+ \(editRequest\?\.added_photo_count \|\| 0\) >= 3/);
  assert.match(notifications, /item\.revision != null && payload\.edit\?\.revision !== item\.revision/);
  assert.match(notifications, /navigation\.navigate\("FieldCollectionEdit", \{ observation, plantId: observation\.plant_id, editRequest: payload\.edit \}\)/);
});

test("observation correction draft recovery is scoped to the same request and bypasses the prompt", () => {
  const form = source("../screens/FieldCollection.js");
  assert.match(form, /observationCorrectionWorkflow = Boolean\(editRequest\?\.id && editRequest\.status === "Correction Required"\)/);
  assert.match(form, /draft\.path === `\/observation-edits\/\$\{editRequest\.id\}`/);
  assert.match(form, /String\(draft\.edit_request\?\.id \|\| ""\) === String\(editRequest\.id\)/);
  assert.match(form, /if \(observationCorrectionWorkflow\) \{\s*if \(candidate\) navigation\.setParams\(\{ draft: candidate \}\);\s*setRecoveryResolved\(true\);/);
});

test("Observation edit labels have EN, MS and ZH parity", () => {
  const languages = ["en", "ms", "zh"].map((language) => JSON.parse(source(`../translations/${language}.json`)).observationEdits);
  const keys = (object) => Object.keys(object).flatMap((key) => object[key] && typeof object[key] === "object"
    ? keys(object[key]).map((nested) => `${key}.${nested}`) : [key]).sort();
  for (const language of languages.slice(1)) assert.deepEqual(keys(language), keys(languages[0]));
});

test("Cancel Edit Request is owner-scoped and available only for the selected active proposal", () => {
  const observation = source("../screens/NotificationObservation.js");
  const plant = source("../screens/BotanistPlantDetail.js");
  const species = source("../screens/BotanistSpeciesRequestDetail.js");
  for (const detail of [observation, plant, species]) {
    assert.ok(detail.includes('"Pending Review", "Correction Required"'));
    assert.ok(detail.includes(detail === plant ? "plantWithdrawal.editConfirmTitle" : "recordEdits.deleteEditTitle"));
    assert.ok(detail.includes(detail === plant ? "plantWithdrawal.editConfirmMessage" : detail === observation
      ? "observationEdits.cancelConfirmation" : "recordEdits.deleteEditMessage"));
    assert.ok(detail.includes(detail === plant ? 't("plantWithdrawal.editAction")' : 't("recordEdits.cancelEditRequest")'));
  }
  assert.ok(observation.includes("selectedEdit.owner_subject === `staff:${accountId}`"));
  assert.ok(observation.includes("selectedDetail && row?.status === \"Approved\" && selectedEditIsCurrentRequest"));
  assert.match(observation, /\(canEdit \|\| canWithdraw \|\| canCancelSelectedEdit\)/);
  assert.ok(observation.includes("/observation-edits/${encodeURIComponent(selectedEdit.id)}/cancel"));
  assert.ok(plant.includes("changeInfo.owner_subject === `staff:${botanistId}`"));
  assert.ok(plant.includes("activeSelectedChangeId === String(route.params.selectedChangeId)"));
  assert.ok(plant.includes("String(selected.id) === selectedChangeId"));
  assert.ok(plant.includes("/record-changes/${encodeURIComponent(changeInfo.id)}/cancel"));
  assert.ok(species.includes("changeInfo.owner_subject === `staff:${accountId}`"));
  assert.ok(species.includes("activeSelectedChangeId === String(route.params.selectedChangeId)"));
  assert.ok(species.includes("result.pending && String(result.pending.id) === selectedChangeId"));
  assert.ok(species.includes("/record-changes/${encodeURIComponent(changeInfo.id)}/cancel"));
});

test("Cancel Edit Request confirmation and status labels have EN, MS and ZH parity", () => {
  const languages = ["en", "ms", "zh"].map((language) => JSON.parse(source(`../translations/${language}.json`)));
  for (const section of ["common", "recordEdits"]) {
    const keys = languages.map((language) => Object.keys(language[section]).sort());
    assert.deepEqual(keys[1], keys[0]);
    assert.deepEqual(keys[2], keys[0]);
  }
  const editLocales = languages.map((language) => language.observationEdits);
  for (const locale of editLocales.slice(1)) assert.deepEqual(Object.keys(locale).sort(), Object.keys(editLocales[0]).sort());
  for (const locale of editLocales) assert.ok(locale.cancelConfirmation);
  assert.match(editLocales[0].cancelConfirmation, /only this edit request.*original approved Observation will remain unchanged/i);
  for (const language of languages) {
    assert.ok(language.recordEdits.deleteEdit);
    assert.ok(language.recordEdits.cancelEditRequest);
    assert.ok(language.recordEdits.deleteEditTitle);
    assert.ok(language.recordEdits.deleteEditMessage);
    assert.ok(language.recordEdits.editCancelled);
    assert.ok(language.recordEdits.cancelEditFailed);
    assert.ok(language.common.cancelled);
  }
  assert.deepEqual(languages.map((language) => language.recordEdits.cancelEditRequest), [
    "Cancel Edit Request", "Batalkan Permintaan Suntingan", "取消编辑请求",
  ]);
});


test("Observation Details ends at Officer Review and does not render loaded technical history", () => {
  const children = node => node && typeof node === "object" ? React.Children.toArray(node.props?.children) : [];
  const find = (node,predicate) => predicate(node) ? node : children(node).map(child=>find(child,predicate)).find(Boolean);
  const row = {id:"observation",plant_id:30,owner_subject:"staff:owner",status:"Approved",content:{heightCm:30},photos:[]};
  const tree = renderObservationDetails(row,[],{}, { editCapabilityVerified:true, editHistory:{
    edits:[], events:[{id:"event",event_type:"edit_submitted"}],
    versions:[{id:"version",version_number:0,status:"Approved",content:{heightCm:10,lifeStage:"Seedling",accuracy_m:5}}],
  }});
  assert.ok(find(tree,node=>node?.props?.testID==="observation-section-04"));
  assert.equal(find(tree,node=>node?.props?.testID==="observation-section-05"),undefined);
  const sourceText = source("../screens/NotificationObservation.js");
  assert.doesNotMatch(sourceText,/versionHistory|historySubtitle|state\.editHistory\.events|versions\.map/);
  assert.match(source("../screens/PlantDetail.js"),/plantDetail\.observationHistory/);
  assert.match(sourceText,/plantApi\(`\/observations\/\$\{encodeURIComponent\(observationId\)\}\/edit-history`/,
    "authorization, action eligibility and selected version data still use the existing read");
});

test("Officer Review uses the Observation status and feedback independently of pending edit requests", () => {
  const children = node => node && typeof node === "object" ? React.Children.toArray(node.props?.children) : [];
  const find = (node,predicate) => predicate(node) ? node : children(node).map(child=>find(child,predicate)).find(Boolean);
  const text = node => typeof node === "string" ? node : children(node).map(text).join(" ");
  for (const status of ["Approved","Pending Review","Rejected"]) {
    const row = {id:"observation",plant_id:30,owner_subject:"staff:owner",status,content:{},photos:[],
      review_comment:"Verified.",reviewed_at:"2026-11-17T01:29:45.299Z",reviewed_by:"Officer A"};
    const edits = [{id:"edit",owner_subject:"staff:owner",status:"Pending Review",revision:1,
      review_comment:"Previous request correction",reviewed_at:"2026-11-18",reviewed_by:"Officer B"}];
    const tree=renderObservationDetails(row,edits);
    const review=find(tree,node=>node?.props?.testID==="observation-section-04");
    assert.equal(find(review,node=>node?.type?.name==="StatusBadge").props.status,status);
    assert.ok(text(review).includes("Verified."));
    assert.ok(text(review).includes("2026-11-17T01:29:45.299Z"));
    assert.ok(!text(review).includes("Previous request correction"));
    assert.ok(!text(review).includes("Officer B"));
    const requestTree=renderObservationDetails(row,[{...edits[0],review_comment:null,reviewed_at:null,reviewed_by:null}],{editRequestId:"edit"});
    const requestReview=find(requestTree,node=>node?.props?.testID==="observation-section-04");
    assert.equal(find(requestReview,node=>node?.type?.name==="StatusBadge").props.status,"Pending Review");
    assert.ok(!text(requestReview).includes("Verified."));
    assert.ok(!text(requestReview).includes("2026-11-17T01:29:45.299Z"));
  }
});

test("Observation correction actions remain inside Officer Review after removing history", () => {
  const children = node => node && typeof node === "object" ? React.Children.toArray(node.props?.children) : [];
  const find = (node,predicate) => predicate(node) ? node : children(node).map(child=>find(child,predicate)).find(Boolean);
  const text = node => typeof node === "string" ? node : children(node).map(text).join(" ");
  const row={id:"observation",plant_id:30,owner_subject:"staff:owner",status:"Correction Required",content:{},photos:[]};
  const tree=renderObservationDetails(row);
  const review=find(tree,node=>node?.props?.testID==="observation-section-04");
  assert.ok(find(review,node=>node?.type==="TouchableOpacity"&&text(node)==="fieldCollection.correctObservation"));
  const foreign=renderObservationDetails({...row,owner_subject:"staff:other"});
  assert.equal(find(foreign,node=>node?.props?.testID==="observation-section-04"),undefined);
});
