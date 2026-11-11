import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const React = require("react"), ts = require("typescript");
const transpile = (file) => ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
  fileName: file, compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
function screen(file, dependencies) {
  const module = { exports: {} };
  new Function("require", "module", "exports", transpile(file))((name) => {
    if (name === "../components/BackButton") return { default: "TouchableOpacity", __esModule: true };
    assert.ok(name in dependencies, `Missing mock: ${name}`);
    return { ...dependencies[name], __esModule: name !== "react" };
  }, module, module.exports);
  return module.exports.default;
}
function harness(file, { record, approved, species = false, locationDenied = false, failReuseOnce = false, pendingEdit = false, editAvailabilityError = false, conflictOnChange = false, draftSaveError = false, savedDraft = null, speciesRequestId = null, speciesRequest = null, catalog = [{ id: "6", scientificName: "Species name", commonName: "Common name" }] }) {
  let stateIndex = 0, refIndex = 0, states = [], refs = [], focus, alert, calls = [], draftSaves = [], navigations = [], photoReads = 0;
  const hooks = { ...React, useCallback: (fn) => fn, useRef: (initial) => {
    const index = refIndex++; if (!(index in refs)) refs[index] = { current: initial }; return refs[index];
  }, useState: (initial) => {
    const index = stateIndex++; if (!(index in states)) states[index] = initial;
    return [states[index], (next) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
  } };
  const native = { StyleSheet: { create: (value) => value }, Alert: { alert: (...args) => { alert = args; } } };
  for (const name of ["ActivityIndicator", "Image", "ScrollView", "Text", "TextInput", "TouchableOpacity", "View"]) native[name] = name;
  const api = async (path, options) => {
    calls.push([path, options]);
    if (path.startsWith("/species-requests/")) return { species_request: speciesRequest || {} };
    if (path === "/record-changes/capabilities") return { approved_edits_available: true };
    if (path === "/record-changes" && options?.method === "POST" && conflictOnChange)
      throw Object.assign(Error("Changes are already pending review for this record."), { status: 409 });
    if (path === "/record-changes" && options?.method === "POST") return { change: { id: "change-12", status: "Pending Review" } };
    if (path === "/qr-codes") return { qr_codes: [{ qr_id: 2, qr_code: "current-token", plant_id: 8, status: "assigned" },
      { qr_id: 3, qr_code: "free-token", plant_id: null, status: "generated" }] };
    return {};
  };
  let failDownload = failReuseOnce;
  const deps = { react: hooks, "react-native": native,
    "../components/OriginalUpdatedField": { default: (props) => React.createElement("View", {}, React.createElement("Text", {}, props.label), props.originalContent, props.children) },
    "../components/BotanicalSkeleton": { DetailSkeletonContent: "DetailSkeletonContent" },
    "@react-navigation/native": { useFocusEffect: (fn) => { focus = fn; } },
    "expo-image-picker": { requestCameraPermissionsAsync: async () => ({ granted: true }), requestMediaLibraryPermissionsAsync: async () => ({ granted: true }),
      launchCameraAsync: async () => ({ canceled: false, assets: [{ uri: "file://camera.jpg" }] }),
      launchImageLibraryAsync: async () => ({ canceled: false, assets: [{ uri: "file://gallery.jpg" }] }) },
    "expo-location": { Accuracy: { High: 4 }, requestForegroundPermissionsAsync: async () => ({ status: locationDenied ? "denied" : "granted" }),
      getCurrentPositionAsync: async () => ({ coords: { latitude: 4.6, longitude: 113.8, altitude: 25.34, accuracy: 6.78 } }) },
    "expo-file-system/legacy": { readAsStringAsync: async () => { photoReads++; return "aGVsbG8="; }, EncodingType: { Base64: "base64" } },
    "@expo/vector-icons": { Ionicons: "Ionicons" },
    "../utils/qrInventory": { normalizeQRCodes: (payload) => payload.qr_codes.map((qr) => ({ id: String(qr.qr_id), label: `QR-${String(qr.qr_id).padStart(4, "0")}`, plantId: qr.plant_id == null ? null : String(qr.plant_id), status: qr.status })) },
    "../utils/botanistRecords": { ...(species ? { fetchBotanistSpeciesRequest: async () => record } : { fetchBotanistPlant: async () => record }),
      fetchBotanistRecordChangeStatus: async () => {
        if (editAvailabilityError) throw Error("offline");
        return { available: true, pending: pendingEdit ? { status: "Pending Review" } : null, latest: null };
      } },
    "../utils/plantApi": species ? { plantApi: api } : { plantApi: api, fetchSpeciesCatalog: async () => catalog },
    "../utils/photoReuse": { downloadPhotoForReuse: async () => {
      if (failDownload) { failDownload = false; throw Object.assign(Error("PHOTO_REUSE_DOWNLOAD_FAILED"), { code: "PHOTO_REUSE_DOWNLOAD_FAILED" }); }
      return { photo: { content_type: "image/jpeg", base64: "cmV1c2Vk" }, cleanup: async () => {} };
    } },
    "../utils/botanistFormDrafts": { getBotanistFormDraft: async () => savedDraft, findBotanistFormDraft: async () => null, saveBotanistFormDraft: async (accountId, draft) => { draftSaves.push({ accountId, draft }); if (draftSaveError) throw Error("storage unavailable"); return { ...draft, saved_at: "test" }; }, deleteBotanistFormDraft: async () => true },
    "../utils/botanistDraftAutosave": { useBotanistDraftAutosave: () => ({ stop: async () => {}, flush: async () => {} }) },
    "../translations/i18n": { useAppTranslation() {}, t: (key) => key, translateUIMessage: (value) => value },
  };
  const component = screen(file, deps);
  const route = { params: { botanist: { id: "owner" }, ...(species ? { requestId: "1" } : { plantId: "8", ...(savedDraft ? { formDraftKey: savedDraft.client_key } : {}), ...(speciesRequestId ? { speciesRequestId } : {}) }) } };
  const navigation = { goBack() {}, setParams(params) { navigations.push(["setParams", params]); }, navigate(...args) { navigations.push(args); } };
  const render = () => { stateIndex = 0; refIndex = 0; return component({ route, navigation }); };
  function walk(node, predicate) {
    if (!node || typeof node !== "object") return null;
    if (typeof node.type === "function") return walk(node.type(node.props), predicate);
    if (predicate(node)) return node;
    for (const child of React.Children.toArray(node.props?.children)) { const found = walk(child, predicate); if (found) return found; }
    return null;
  }
  function collect(node, predicate, found = []) {
    if (!node || typeof node !== "object") return found;
    if (typeof node.type === "function") return collect(node.type(node.props), predicate, found);
    if (predicate(node)) found.push(node);
    for (const child of React.Children.toArray(node.props?.children)) collect(child, predicate, found);
    return found;
  }
  const text = (node) => typeof node === "string" ? node : node && typeof node.type === "function"
    ? text(node.type(node.props)) : React.Children.toArray(node?.props?.children).map(text).join(" ");
  return { render, walk, collect, text, get focus() { return focus; }, get alert() { return alert; }, calls, draftSaves, navigations, get photoReads() { return photoReads; } };
}
const plant = (status) => ({ id: "8", speciesId: "6", scientificName: "Manual plant name", status, qrId: "2", qrCode: "QR-0002",
  latestObservation: { revision: 1, assets: [{ id: "photo-1" }, { id: "photo-2" }, { id: "photo-3" }], content: { heightCm: 20, healthStatus: "Healthy", lifeStage: "Mature", morphology: "Leaves", notes: "", latitude: 4.5, longitude: 113.7 } },
  observations: [{ status: "Approved", content: { heightCm: 20, healthStatus: "Healthy", lifeStage: "Mature", morphology: "Leaves", notes: "", latitude: 4.5, longitude: 113.7 } }],
  photos: [1, 2, 3].map((index) => ({ uri: `https://example.invalid/existing-${index}` })) });
const request = (status) => ({ request_id: 1, request_status: status, scientific_name: "Species A", common_name: "Common A",
  genus_name: "Genus A", family_name: "Family A", conservation_status: "Least Concern", description: "Original", habitat: "Forest",
  photo: { uri: "https://example.invalid/species" } });

test("Edit Plant opens the separate species request route only after saving the account and plant scoped draft", async () => {
  const h = harness("screens/EditPlantRecord.js", { record: plant("Approved") });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  const requestMode = h.walk(h.render(), (node) => node.type === "TouchableOpacity" && h.text(node).includes("recordEdits.requestNewSpecies"));
  requestMode.props.onPress();
  const open = h.walk(h.render(), (node) => node.type === "TouchableOpacity" && h.text(node).includes("recordEdits.openSpeciesRequest"));
  await open.props.onPress();
  assert.equal(h.draftSaves.length, 1);
  assert.equal(h.draftSaves[0].accountId, "owner");
  assert.equal(h.draftSaves[0].draft.form_type, "edit-plant");
  assert.equal(String(h.draftSaves[0].draft.target_id), "8");
  assert.deepEqual(h.navigations[0], ["setParams", { formDraftKey: h.draftSaves[0].draft.client_key }]);
  assert.equal(h.navigations[1][0], "AddSpeciesRequest");
  assert.equal(h.navigations[1][1].returnToPlantId, "8");
  assert.equal(h.navigations[1][1].returnPlantDraftKey, h.draftSaves[0].draft.client_key);
  assert.equal(h.calls.some(([path]) => path === "/plant-submissions" || path === "/record-changes"), false);
});

test("species request navigation is blocked when the secure plant edit draft cannot be saved", async () => {
  const h = harness("screens/EditPlantRecord.js", { record: plant("Approved"), draftSaveError: true });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  h.walk(h.render(), (node) => node.type === "TouchableOpacity" && h.text(node).includes("recordEdits.requestNewSpecies")).props.onPress();
  const open = h.walk(h.render(), (node) => node.type === "TouchableOpacity" && h.text(node).includes("recordEdits.openSpeciesRequest"));
  await open.props.onPress();
  assert.equal(h.navigations.length, 0);
  assert.ok(h.text(h.render()).includes("storage unavailable"));
  assert.ok(h.walk(h.render(), (node) => node.type === "TextInput" && node.props.value === "Manual plant name"));
});

for (const status of ["Pending Review", "Rejected", "Approved"]) {
  test(`resuming the same plant edit refreshes the catalog and reports the tracked species request's ${status} status`, async () => {
    const availableSpecies = [{ id: "6", scientificName: "Species name", commonName: "Common name" },
      ...(status === "Approved" ? [{ id: "7", scientificName: "Approved proposal", commonName: "Approved common" }] : [])];
    const h = harness("screens/EditPlantRecord.js", { record: plant("Approved"), speciesRequestId: "23",
      speciesRequest: { request_id: "23", request_status: status, approved_species_id: status === "Approved" ? "7" : null }, catalog: availableSpecies });
    h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
    const tree = h.render();
    const expected = status === "Pending Review" ? "recordEdits.speciesRequestPending" : status === "Rejected" ? "recordEdits.speciesRequestRejected" : "recordEdits.speciesRequestApproved";
    assert.ok(h.text(tree).includes(expected));
    assert.ok(h.calls.some(([path]) => path === "/species-requests/23"));
    assert.ok(h.text(tree).includes("Species name"));
    if (status === "Approved") assert.ok(h.text(tree).includes("Approved proposal"));
  });
}

test("only the approved role-visible species catalog is selectable, never a pending original species proposal", async () => {
  const pending = plant("Pending Review");
  pending.speciesId = "8";
  pending.speciesDetails = { species_id: "8", scientificName: "Unapproved proposal", commonName: "Unapproved common" };
  const h = harness("screens/EditPlantRecord.js", { record: pending, catalog: [{ id: "6", scientificName: "Approved species", commonName: "Approved common" }] });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  const options = h.collect(h.render(), (node) => node.type === "TouchableOpacity" && h.text(node).includes("Approved species"));
  assert.equal(options.length, 1);
  assert.equal(h.collect(h.render(), (node) => node.type === "TouchableOpacity" && h.text(node).includes("Unapproved proposal")).length, 0);
});

test("an approved but role-unavailable requested species is not selectable or assigned automatically", async () => {
  const h = harness("screens/EditPlantRecord.js", { record: plant("Approved"), speciesRequestId: "23",
    speciesRequest: { request_id: "23", request_status: "Approved", approved_species_id: "7" },
    catalog: [{ id: "6", scientificName: "Species name", commonName: "Common name" }] });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  const tree = h.render();
  assert.ok(h.text(tree).includes("recordEdits.speciesRequestUnavailable"));
  assert.equal(h.collect(tree, (node) => node.type === "TouchableOpacity" && h.text(node).includes("approved proposal")).length, 0);
  const save = h.walk(tree, (node) => node.type === "TouchableOpacity" && h.text(node).includes("botanistDrafts.saveDraft"));
  await save.props.onPress();
  assert.equal(h.draftSaves[0].draft.form.species_id, "6");
});

test("resuming an edit draft preserves its values and stores the separate species request ID for later status refresh", async () => {
  const savedDraft = { client_key: "edit-draft-8", form_type: "edit-plant", target_id: "8", saved_at: "old-save",
    form: { scientific_name: "Botanist edit in progress", species_id: "6", qr_id: "2", heightCm: "20", healthStatus: "Healthy", lifeStage: "Mature", morphology: "Leaves", notes: "unfinished", zone: "", latitude: "4.5", longitude: "113.7", accuracy_m: "", altitudeM: "" },
    photo_refs: [], baseline: { plant: plant("Approved") } };
  const h = harness("screens/EditPlantRecord.js", { record: plant("Approved"), savedDraft, speciesRequestId: "23",
    speciesRequest: { request_id: "23", request_status: "Pending Review" } });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  assert.ok(h.walk(h.render(), (node) => node.type === "TextInput" && node.props.value === "Botanist edit in progress"));
  const savedMetadata = h.draftSaves.find(({ draft }) => draft.species_request_id === "23");
  assert.ok(savedMetadata);
  assert.equal(savedMetadata.accountId, "owner");
  assert.equal(savedMetadata.draft.target_id, "8");
  assert.equal(savedMetadata.draft.form.notes, "unfinished");
});

for (const { file, record, species, type } of [
  { file: "screens/EditPlantRecord.js", record: plant("Approved"), species: false, type: "edit-plant" },
  { file: "screens/EditSpeciesRequest.js", record: request("pending_review"), species: true, type: "edit-species" },
]) {
  test(`${type} saves a partial local draft without running submission validation`, async () => {
    const h = harness(file, { record, approved: true, species });
    h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
    const save = h.collect(h.render(), (node) => node.type === "TouchableOpacity" && h.text(node).includes("botanistDrafts.saveDraft"))[0];
    assert.ok(save, "Save Draft action is present");
    await save.props.onPress();
    assert.equal(h.draftSaves.length, 1);
    assert.equal(h.draftSaves[0].accountId, "owner");
    assert.equal(h.draftSaves[0].draft.form_type, type);
    assert.ok(h.draftSaves[0].draft.form && typeof h.draftSaves[0].draft.form === "object");
    assert.equal(h.calls.some(([path]) => path === "/record-changes" || path.includes("species-requests")), false);
    assert.equal(h.alert[0], "botanistDrafts.savedStatus");
    h.alert[2][0].onPress();
    assert.deepEqual(h.navigations.at(-1), ["BotanistMyDrafts", { botanist: { id: "owner" }, openDraftKey: h.draftSaves[0].draft.client_key }]);
  });
}

for (const approved of [false, true]) {
  test(`${approved ? "approved" : "pending"} plant editor prefills and submits to the correct endpoint`, async () => {
    const h = harness("screens/EditPlantRecord.js", { record: plant(approved ? "Approved" : "Pending Review") });
    h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
    const tree = h.render();
    assert.ok(h.walk(tree, (node) => node.type === "TextInput" && node.props.value === "Manual plant name"));
    assert.ok(h.walk(tree, (node) => node.type === "Image" && node.props.source.uri.includes("existing")));
    const button = h.walk(tree, (node) => node.type === "TouchableOpacity" && h.text(node) === "recordEdits.submitChanges");
    button.props.onPress();
    assert.equal(h.alert[0], "recordEdits.confirmTitle");
    await h.alert[2][1].onPress();
    const saved = h.calls.find(([path]) => path === (approved ? "/record-changes" : "/my-plants/8"));
    assert.ok(saved);
    assert.equal(saved[1].body.proposed?.scientific_name ?? saved[1].body.scientific_name, "Manual plant name");
    assert.equal(saved[1].body.proposed?.species_id ?? saved[1].body.species_id, 6);
    assert.equal(Object.hasOwn(saved[1].body.proposed || saved[1].body, "photo_ids"), false, "text-only edits must not alter photo associations");
    if (!approved) assert.equal(saved[1].body.expected_revision, 1);
    assert.equal(h.alert[0], "recordEdits.savedTitle");
    h.alert[2][0].onPress();
    assert.deepEqual(h.navigations.at(-1), ["BotanistSubmissions", { botanist: { id: "owner" }, openTarget: { kind: "plant", recordId: "8", ...(approved ? { changeId: "change-12" } : {}) } }]);
  });
  test(`${approved ? "approved" : "pending"} species editor prefills and submits to the correct endpoint`, async () => {
    const h = harness("screens/EditSpeciesRequest.js", { record: request(approved ? "Approved" : "Pending Review"), species: true });
    h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
    const tree = h.render();
    assert.ok(h.walk(tree, (node) => node.type === "Image" && node.props.source.uri.includes("species")));
    const button = h.walk(tree, (node) => node.type === "TouchableOpacity" && h.text(node) === "recordEdits.submitChanges");
    button.props.onPress();
    assert.equal(h.alert[0], "recordEdits.confirmTitle");
    await h.alert[2][1].onPress();
    const saved = h.calls.find(([path]) => path === (approved ? "/record-changes" : "/my-species-requests/1"));
    assert.ok(saved);
    assert.equal(saved[1].body.proposed?.scientific_name ?? saved[1].body.scientific_name, "Species A");
    assert.equal(Object.hasOwn(saved[1].body.proposed || saved[1].body, "photo"), false, "text-only species edits must retain the saved photo");
    assert.equal(h.alert[0], "recordEdits.savedTitle");
    h.alert[2][0].onPress();
    assert.deepEqual(h.navigations.at(-1), ["BotanistSubmissions", { botanist: { id: "owner" }, openTarget: { kind: "species", recordId: "1", ...(approved ? { changeId: "change-12" } : {}) } }]);
  });
}

test("approved plant edit with a pending reviewed change blocks before reading selected photo files", async () => {
  const h = harness("screens/EditPlantRecord.js", { record: plant("Approved"), pendingEdit: true });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  const originals = h.collect(h.render(), (node) => node.type === "TouchableOpacity" && node.props.accessibilityRole === "checkbox" && node.props.accessibilityLabel?.startsWith("recordEdits.originalPhoto"));
  originals.forEach((original) => original.props.onPress());
  const submit = h.walk(h.render(), (node) => node.type === "TouchableOpacity" && h.text(node) === "recordEdits.submitChanges");
  submit.props.onPress();
  await h.alert[2][1].onPress();
  assert.equal(h.calls.some(([path, options]) => path === "/record-changes" && options?.method === "POST"), false);
  assert.equal(h.photoReads, 0);
  assert.equal(h.alert[1], "recordEdits.pendingEditExplanation");
  assert.ok(h.walk(h.render(), (node) => node.type === "TextInput" && node.props.value === "Manual plant name"));
});

test("approved species edit with a pending reviewed change blocks before photo reuse download", async () => {
  const h = harness("screens/EditSpeciesRequest.js", { record: request("Approved"), species: true, pendingEdit: true });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  const reuse = h.walk(h.render(), (node) => node.type === "TouchableOpacity" && node.props.accessibilityRole === "checkbox" && node.props.accessibilityLabel === "recordEdits.originalPhoto");
  reuse.props.onPress();
  const submit = h.walk(h.render(), (node) => node.type === "TouchableOpacity" && h.text(node) === "recordEdits.submitChanges");
  submit.props.onPress(); await h.alert[2][1].onPress();
  assert.equal(h.calls.some(([path, options]) => path === "/record-changes" && options?.method === "POST"), false);
  assert.equal(h.alert[1], "recordEdits.pendingEditExplanation");
  assert.ok(h.walk(h.render(), (node) => node.type === "TextInput" && node.props.value === "Species A"));
});

test("approved edit form treats availability lookup errors as unavailable, not as permission to submit", async () => {
  const h = harness("screens/EditPlantRecord.js", { record: plant("Approved"), editAvailabilityError: true });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  const submit = h.walk(h.render(), (node) => node.type === "TouchableOpacity" && h.text(node) === "recordEdits.submitChanges");
  submit.props.onPress(); await h.alert[2][1].onPress();
  assert.equal(h.calls.some(([path, options]) => path === "/record-changes" && options?.method === "POST"), false);
  assert.equal(h.alert[1], "recordEdits.editAvailabilityUnavailable");
});

test("backend 409 pending-edit conflict is localized and keeps entered form values", async () => {
  const h = harness("screens/EditPlantRecord.js", { record: plant("Approved"), conflictOnChange: true });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  const submit = h.walk(h.render(), (node) => node.type === "TouchableOpacity" && h.text(node) === "recordEdits.submitChanges");
  submit.props.onPress(); await h.alert[2][1].onPress();
  assert.equal(h.alert[1], "recordEdits.pendingEditExplanation");
  assert.ok(h.walk(h.render(), (node) => node.type === "TextInput" && node.props.value === "Manual plant name"));
});

test("species backend 409 pending-edit conflict preserves the proposal values", async () => {
  const h = harness("screens/EditSpeciesRequest.js", { record: request("Approved"), species: true, conflictOnChange: true });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  const submit = h.walk(h.render(), (node) => node.type === "TouchableOpacity" && h.text(node) === "recordEdits.submitChanges");
  submit.props.onPress(); await h.alert[2][1].onPress();
  assert.equal(h.alert[1], "recordEdits.pendingEditExplanation");
  assert.ok(h.walk(h.render(), (node) => node.type === "TextInput" && node.props.value === "Species A"));
});

test("species editor reuses the authenticated original through the existing single-photo payload", async () => {
  const h = harness("screens/EditSpeciesRequest.js", { record: request("Correction Required"), species: true });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  const tree = h.render();
  const reuse = h.walk(tree, (node) => node.type === "TouchableOpacity" && node.props.accessibilityRole === "checkbox" && node.props.accessibilityLabel === "recordEdits.originalPhoto");
  assert.ok(reuse);
  reuse.props.onPress();
  const submit = h.walk(h.render(), (node) => node.type === "TouchableOpacity" && h.text(node) === "recordEdits.submitChanges");
  submit.props.onPress(); await h.alert[2][1].onPress();
  const sent = h.calls.find(([path]) => path === "/my-species-requests/1");
  assert.deepEqual(sent[1].body.photo, { content_type: "image/jpeg", base64: "cmV1c2Vk" });
});

test("species photo download failure keeps the selection and a retry submits once", async () => {
  const h = harness("screens/EditSpeciesRequest.js", { record: request("Correction Required"), species: true, failReuseOnce: true });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  const reuse = h.walk(h.render(), (node) => node.type === "TouchableOpacity" && node.props.accessibilityRole === "checkbox" && node.props.accessibilityLabel === "recordEdits.originalPhoto");
  reuse.props.onPress();
  let submit = h.walk(h.render(), (node) => node.type === "TouchableOpacity" && h.text(node) === "recordEdits.submitChanges");
  submit.props.onPress(); await h.alert[2][1].onPress();
  assert.equal(h.calls.some(([path]) => path === "/my-species-requests/1"), false);
  assert.equal(h.alert[1], "recordEdits.photoReuseDownloadFailed");
  assert.ok(h.walk(h.render(), (node) => node.type === "TouchableOpacity" && node.props.accessibilityLabel === "recordEdits.originalPhoto" && node.props.accessibilityState.checked), "the failed download keeps the user's original-photo selection");
  submit = h.walk(h.render(), (node) => node.type === "TouchableOpacity" && h.text(node) === "recordEdits.submitChanges");
  submit.props.onPress(); await h.alert[2][1].onPress();
  assert.equal(h.calls.filter(([path]) => path === "/my-species-requests/1").length, 1);
});

test("plant editor shows assigned QR, four GPS values and fills them from device location", async () => {
  const h = harness("screens/EditPlantRecord.js", { record: plant("Approved") });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  let tree = h.render();
  assert.ok(h.text(tree).includes("QR-0002"));
  for (const field of ["latitude", "longitude", "altitudeM", "accuracy_m"])
    assert.ok(h.text(tree).includes(`recordEdits.${field}`));
  const detect = h.walk(tree, (node) => node.type === "TouchableOpacity" && h.text(node) === "addPlant.getCurrentLocation");
  assert.ok(detect);
  await detect.props.onPress();
  tree = h.render();
  for (const value of ["4.600000", "113.800000", "25.34", "6.78"])
    assert.ok(h.walk(tree, (node) => node.type === "TextInput" && node.props.value === value));
  const freeQr = h.walk(tree, (node) => node.type === "TouchableOpacity" && h.text(node).includes("QR-0003"));
  assert.ok(freeQr && !freeQr.props.disabled);
  freeQr.props.onPress();
  const button = h.walk(h.render(), (node) => node.type === "TouchableOpacity" && h.text(node) === "recordEdits.submitChanges");
  button.props.onPress(); await h.alert[2][1].onPress();
  const sent = h.calls.find(([path]) => path === "/record-changes");
  assert.equal(sent[1].body.proposed.qr_id, 3);
  assert.equal(sent[1].body.proposed.content.latitude, 4.6);
  assert.equal(sent[1].body.proposed.content.altitudeM, 25.34);
  assert.equal(sent[1].body.proposed.content.accuracy_m, 6.78);
});

test("denied GPS permission leaves existing plant coordinates unchanged", async () => {
  const h = harness("screens/EditPlantRecord.js", { record: plant("Approved"), locationDenied: true });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  const tree = h.render();
  const detect = h.walk(tree, (node) => node.type === "TouchableOpacity" && h.text(node) === "addPlant.getCurrentLocation");
  await detect.props.onPress();
  assert.equal(h.alert[0], "addPlant.permissionRequired");
  assert.ok(h.walk(h.render(), (node) => node.type === "TextInput" && node.props.value === "4.5"));
});

test("plant editor reuses originals, removes one only from the selection, and mixes a camera photo", async () => {
  const h = harness("screens/EditPlantRecord.js", { record: plant("Approved") });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  let tree = h.render();
  const originals = h.collect(tree, (node) => node.type === "TouchableOpacity" && node.props.accessibilityRole === "checkbox" && node.props.accessibilityLabel?.startsWith("recordEdits.originalPhoto"));
  originals.forEach((photo) => photo.props.onPress());
  tree = h.render();
  const remove = h.walk(tree, (node) => node.type === "TouchableOpacity" && node.props.accessibilityLabel === "recordEdits.removePhoto");
  remove.props.onPress();
  tree = h.render();
  const camera = h.walk(tree, (node) => node.type === "TouchableOpacity" && node.props.accessibilityLabel === "recordEdits.takePhoto");
  await camera.props.onPress();
  tree = h.render();
  const button = h.walk(tree, (node) => node.type === "TouchableOpacity" && h.text(node) === "recordEdits.submitChanges");
  button.props.onPress(); await h.alert[2][1].onPress();
  const sent = h.calls.find(([path]) => path === "/record-changes");
  assert.ok(sent, JSON.stringify(h.alert));
  assert.deepEqual(sent[1].body.proposed.photo_ids, ["photo-2", "photo-3"]);
  assert.equal(sent[1].body.proposed.photos.length, 1);
});

test("gallery selection adds a preview without discarding saved photos", async () => {
  const h = harness("screens/EditPlantRecord.js", { record: plant("Approved") });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  const tree = h.render();
  const gallery = h.walk(tree, (node) => node.type === "TouchableOpacity" && node.props.accessibilityLabel === "recordEdits.addGallery");
  await gallery.props.onPress();
  const updated = h.render();
  assert.ok(h.walk(updated, (node) => node.type === "Image" && node.props.source?.uri === "file://gallery.jpg"));
  assert.ok(h.walk(updated, (node) => node.type === "Image" && node.props.source?.uri?.includes("existing-1")));
});

for (const { name, indexes, cameraCount, expected } of [
  { name: "only Photo 1", indexes: [0], cameraCount: 2, expected: ["photo-1"] },
  { name: "only Photo 2", indexes: [1], cameraCount: 2, expected: ["photo-2"] },
  { name: "Photo 1 and Photo 3", indexes: [0, 2], cameraCount: 1, expected: ["photo-1", "photo-3"] },
]) test(`plant editor submits ${name} with new photos and no other original IDs`, async () => {
  const h = harness("screens/EditPlantRecord.js", { record: plant("Approved") });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  let tree = h.render();
  const reuse = h.collect(tree, (node) => node.type === "TouchableOpacity" && node.props.accessibilityRole === "checkbox" && node.props.accessibilityLabel?.startsWith("recordEdits.originalPhoto"));
  indexes.forEach((index) => reuse[index].props.onPress());
  for (let i = 0; i < cameraCount; i++) {
    tree = h.render();
    const camera = h.walk(tree, (node) => node.type === "TouchableOpacity" && node.props.accessibilityLabel === "recordEdits.takePhoto");
    await camera.props.onPress();
  }
  const button = h.walk(h.render(), (node) => node.type === "TouchableOpacity" && h.text(node) === "recordEdits.submitChanges");
  button.props.onPress(); await h.alert[2][1].onPress();
  const sent = h.calls.find(([path]) => path === "/record-changes");
  assert.deepEqual(sent[1].body.proposed.photo_ids, expected);
  assert.equal(sent[1].body.proposed.photos.length, cameraCount);
});

test("tapping an original twice does not duplicate it, and the user can select other originals individually", async () => {
  const h = harness("screens/EditPlantRecord.js", { record: plant("Approved") });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  let tree = h.render();
  h.collect(tree, (node) => node.type === "TouchableOpacity" && node.props.accessibilityRole === "checkbox" && node.props.accessibilityLabel?.startsWith("recordEdits.originalPhoto"))[0].props.onPress();
  tree = h.render();
  const originals = h.collect(tree, (node) => node.type === "TouchableOpacity" && node.props.accessibilityRole === "checkbox" && node.props.accessibilityLabel?.startsWith("recordEdits.originalPhoto"));
  originals[0].props.onPress();
  originals[1].props.onPress();
  originals[2].props.onPress();
  const selected = h.collect(h.render(), (node) => node.type === "TouchableOpacity" && node.props.accessibilityLabel === "recordEdits.removePhoto");
  assert.equal(selected.length, 3);
  const submit = h.walk(h.render(), (node) => node.type === "TouchableOpacity" && h.text(node) === "recordEdits.submitChanges");
  submit.props.onPress(); await h.alert[2][1].onPress();
  const sent = h.calls.find(([path]) => path === "/record-changes");
  assert.deepEqual(sent[1].body.proposed.photo_ids, ["photo-1", "photo-2", "photo-3"]);
});

test("plant editor keeps the existing 3–8 photo validation for changed sets", async () => {
  const minimum = harness("screens/EditPlantRecord.js", { record: plant("Approved") });
  minimum.render(); minimum.focus(); await new Promise((resolve) => setImmediate(resolve));
  hReuseOne(minimum);
  minimum.walk(minimum.render(), (node) => node.type === "TouchableOpacity" && minimum.text(node) === "recordEdits.submitChanges").props.onPress();
  assert.equal(minimum.alert[0], "common.error");
  assert.equal(minimum.alert[1], "recordEdits.threePhotos");

  const maximum = harness("screens/EditPlantRecord.js", { record: plant("Approved") });
  maximum.render(); maximum.focus(); await new Promise((resolve) => setImmediate(resolve));
  hReuseOne(maximum);
  for (let index = 0; index < 8; index++) {
    const gallery = maximum.walk(maximum.render(), (node) => node.type === "TouchableOpacity" && node.props.accessibilityLabel === "recordEdits.addGallery");
    await gallery.props.onPress();
  }
  assert.equal(maximum.alert[1], "recordEdits.maxPhotos");
});

function hReuseOne(h) {
  const photo = h.collect(h.render(), (node) => node.type === "TouchableOpacity" && node.props.accessibilityRole === "checkbox" && node.props.accessibilityLabel?.startsWith("recordEdits.originalPhoto"))[0];
  photo.props.onPress();
}

test("version history screen opens an actual version and shows only its changed values", async () => {
  let states = [], index = 0, focus;
  const version = { id: "version-2", record_type: "plant", plant_id: 8, version_number: 2, status: "Pending Review",
    edited_by: "staff:owner", owner_subject: "staff:owner", created_at: "2026-11-04T00:00:00Z",
    previous_snapshot: { scientific_name: "Old plant", qr_id: 2, content: { latitude: 4.5, longitude: 113.7 } },
    snapshot: { scientific_name: "New plant", qr_id: 3, content: { latitude: 4.6, longitude: 113.7 } } };
  const prior = { id: "prior-change", plant_id: 8, status: "Rejected", owner_subject: "staff:owner",
    created_at: "2026-11-03T00:00:00Z", base_snapshot: { scientific_name: "Older plant" },
    proposed_snapshot: { scientific_name: "Older proposal" }, proposal_photo_count: 0 };
  const hooks = { ...React, useCallback: (fn) => fn, useEffect: () => {}, useState: (initial) => {
    const at = index++; if (!(at in states)) states[at] = initial;
    return [states[at], (next) => { states[at] = typeof next === "function" ? next(states[at]) : next; }];
  } };
  const native = { StyleSheet: { create: (value) => value } };
  for (const name of ["ActivityIndicator", "Image", "ScrollView", "Text", "TouchableOpacity", "View"]) native[name] = name;
  const component = screen("screens/RecordVersionHistory.js", { react: hooks, "react-native": native,
    "@react-navigation/native": { useFocusEffect: (fn) => { focus = fn; } },
    "../utils/plantApi": { plantApi: async (path) => path.startsWith("/record-versions?")
      ? { history_available: true, versions: [version], prior_changes: [prior] } : { version } },
    "../utils/faceSession": { faceSession: { withToken: async () => {} } },
    "../utils/apiConfiguration": { mobileApiUrl: () => "https://example.invalid" },
    "../translations/i18n": { useAppTranslation() {}, t: (key) => key, translateUIMessage: (value) => value },
  });
  let routeParams = { kind: "plant", targetId: "8", botanist: { id: "owner" } };
  const render = () => { index = 0; return component({ route: { params: routeParams }, navigation: { goBack() {} } }); };
  const visit = (node, predicate) => { if (!node || typeof node !== "object") return null; if (predicate(node)) return node;
    for (const child of React.Children.toArray(node.props?.children)) { const found = visit(child, predicate); if (found) return found; } return null; };
  const text = (node) => typeof node === "string" ? node : React.Children.toArray(node?.props?.children).map(text).join(" ");
  render(); focus(); await new Promise((resolve) => setImmediate(resolve));
  const list = render();
  const card = visit(list, (node) => node.type === "TouchableOpacity" && text(node).includes("recordEdits.version"));
  assert.ok(card); await card.props.onPress();
  const detail = render();
  assert.match(text(detail), /Old plant\s*→\s*New plant/);
  assert.match(text(detail), /4\.5\s*→\s*4\.6/);
  assert.doesNotMatch(text(detail), /113\.7\s*→\s*113\.7/);
  const back = visit(detail, (node) => node.type === "TouchableOpacity" && (text(node).includes("recordEdits.backToRecord") || node.props.label === "recordEdits.backToRecord"));
  back.props.onPress();
  const earlier = visit(render(), (node) => node.type === "TouchableOpacity" && text(node).includes("recordEdits.priorProposal"));
  assert.ok(earlier); earlier.props.onPress();
  assert.match(text(render()), /Older plant\s*→\s*Older proposal/);
  routeParams = { ...routeParams, versionId: version.id };
  render(); focus(); await new Promise((resolve) => setImmediate(resolve));
  assert.match(text(render()), /Old plant.*New plant/, "View Details opens the selected version directly");});

test("My Submissions version rows open a direct read-only snapshot view", async () => {
  let states = [], index = 0, focus, backCount = 0;
  const version = { id: "version-2", record_type: "plant", plant_id: 8, version_number: 2, status: "Pending Review",
    created_at: "2026-11-04T00:00:00Z", review_comment: "Add a clearer location.",
    previous_snapshot: { scientific_name: "Plant before edit", content: { morphology: "Original morphology" } },
    snapshot: { scientific_name: "Plant after edit", content: { morphology: "Updated morphology" } } };
  const hooks = { ...React, useCallback: (fn) => fn, useEffect: () => {}, useState: (initial) => {
    const at = index++; if (!(at in states)) states[at] = initial;
    return [states[at], (next) => { states[at] = typeof next === "function" ? next(states[at]) : next; }];
  } };
  const native = { StyleSheet: { create: (value) => value } };
  for (const name of ["ActivityIndicator", "Image", "ScrollView", "Text", "TouchableOpacity", "View"]) native[name] = name;
  const component = screen("screens/RecordVersionHistory.js", { react: hooks, "react-native": native,
    "@react-navigation/native": { useFocusEffect: (fn) => { focus = fn; } },
    "../utils/plantApi": { plantApi: async (path) => path.startsWith("/record-versions?")
      ? { history_available: true, versions: [version], prior_changes: [] } : { version } },
    "../utils/faceSession": { faceSession: { withToken: async () => {} } },
    "../utils/apiConfiguration": { mobileApiUrl: () => "https://example.invalid" },
    "../translations/i18n": { useAppTranslation() {}, t: (key) => key, translateUIMessage: (value) => value },
  });
  let routeParams = { kind: "plant", targetId: "8", botanist: { id: "owner" }, submissionVersionDetail: true,
    submissionVersionLabel: "Edit 1", versionId: version.id, versionSnapshot: "previous", originalStatus: "Approved",
    originalCreatedAt: "2025-01-01T00:00:00Z" };
  const render = () => { index = 0; return component({ route: { params: routeParams }, navigation: { goBack() { backCount++; } } }); };
  const visit = (node, predicate) => { if (!node || typeof node !== "object") return null; if (predicate(node)) return node;
    for (const child of React.Children.toArray(node.props?.children)) { const found = visit(child, predicate); if (found) return found; } return null; };
  const text = (node) => typeof node === "string" ? node : React.Children.toArray(node?.props?.children).map(text).join(" ");
  render(); focus(); await new Promise((resolve) => setImmediate(resolve));
  let detail = render();
  assert.match(text(detail), /recordEdits\.originalPlantRecord/);
  assert.match(text(detail), /Plant before edit/);
  assert.match(text(detail), /Original morphology/);
  assert.doesNotMatch(text(detail), /Plant after edit|recordEdits\.versionHistory/);
  visit(detail, (node) => node.type === "TouchableOpacity" && (text(node).includes("common.goBack") || node.props.label === "common.goBack")).props.onPress();
  assert.equal(backCount, 1, "Back returns to the submissions screen in the existing navigation stack");

  routeParams = { ...routeParams, versionSnapshot: undefined, submissionVersionLabel: "Edit 1" };
  render(); focus(); await new Promise((resolve) => setImmediate(resolve));
  detail = render();
  assert.match(text(detail), /Edit 1.*recordEdits\.versionStatus\.PendingReview/);
  assert.match(text(detail), /Plant after edit/);
  assert.match(text(detail), /Updated morphology/);
  assert.match(text(detail), /Add a clearer location\./);
  assert.doesNotMatch(text(detail), /recordEdits\.versionHistory/);
});
