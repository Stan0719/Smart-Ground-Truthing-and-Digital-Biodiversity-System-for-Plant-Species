import { validGpsPoint, readGpsLocation } from "../utils/gpsLocation.js";
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
    if (name === "../utils/imageSelection") return { inspectPickedImages: async (assets) => ({ accepted: assets, rejected: [] }), imageSizeAlert: () => ({}), base64Bytes: () => 5, MAX_IMAGE_BYTES: 4194304, __esModule: true };
    if (name === "../components/ScaledText") return { default: "Text", ScaledTextInput: "TextInput", __esModule: true };
    if (name === "../components/BackButton") return { default: "TouchableOpacity", __esModule: true };
    if (name === "../components/TextLanguageSelect") return { default: "TextLanguageSelect", __esModule: true };
    if (name === "../components/DiscoverableScrollView") return { default: "ScrollView", __esModule: true };
    if (name === "../components/PreviewableImage" || name === "./PreviewableImage") return { default: "Image", confirmPhotoRemoval: (_translate, remove) => remove(), __esModule: true };
    assert.ok(name in dependencies, `Missing mock: ${name}`);
    return {
      ...(name === "../utils/plantApi" ? { requestMobileSourceLanguages: async () => [] } : {}),
      ...dependencies[name], __esModule: name !== "react",
    };
  }, module, module.exports);
  return module.exports.default;
}
function harness(file, { record, approved, species = false, correction = false, locationDenied = false, failReuseOnce = false, photoSourceFailsOnce = false, pendingEdit = false, editAvailabilityError = false, conflictOnChange = false, draftSaveError = false, savedDraft = null, findDraftCandidate = null, speciesRequestId = null, speciesRequest = null, correctionChange = null, refreshedRecord = null, refreshError = false, refreshedCorrectionChange = undefined, pendingVersionSelection = null, acknowledgement = undefined, catalog = [{ id: "6", scientificName: "Species name", commonName: "Common name" }], qrCodes = [{ qr_id: 2, qr_code: "current-token", plant_id: 8, status: "assigned" }, { qr_id: 3, qr_code: "free-token", plant_id: null, status: "generated" }] }) {
  let stateIndex = 0, refIndex = 0, states = [], refs = [], focus, alert, calls = [], draftSaves = [], navigations = [], photoReads = 0;
  const hooks = { ...React, useCallback: (fn) => fn, useRef: (initial) => {
    const index = refIndex++; if (!(index in refs)) refs[index] = { current: initial }; return refs[index];
  }, useState: (initial) => {
    const index = stateIndex++; if (!(index in states)) states[index] = initial;
    return [states[index], (next) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
  } };
  const native = { StyleSheet: { create: (value) => value }, Alert: { alert: (...args) => { alert = args; } } };
  for (const name of ["ActivityIndicator", "Image", "ScrollView", "Text", "TextInput", "TouchableOpacity", "View"]) native[name] = name;
  let speciesEditCount = 0, speciesFetchCount = 0, plantFetchCount = 0, correctionFetchCount = 0;
  const api = async (path, options) => {
    calls.push([path, options]);
    if (path.startsWith("/my-species-requests/") && record.editConflict && speciesEditCount++ === 0) throw Object.assign(Error("internal error detail"), { status: 409, code: "SPECIES_REQUEST_EDIT_VERSION_CONFLICT" });
    if (path.startsWith("/species-requests/")) return { species_request: speciesRequest || {} };
    if (path === "/record-changes/capabilities") return { approved_edits_available: true };
    if (path === "/record-changes" && options?.method === "POST" && conflictOnChange)
      throw Object.assign(Error("Changes are already pending review for this record."), { status: 409 });
    if (path === "/record-changes" && options?.method === "POST") return acknowledgement === undefined ? { change: { id: "change-12", status: "Pending Review" } } : acknowledgement;
    if (/^\/record-changes\/[^/]+$/.test(path) && options?.method === "PATCH") return { change: { id: correctionChange?.id, status: "Pending Review", revision: 2 } };
    if (path === "/qr-codes") return { qr_codes: qrCodes };
    return {};
  };
  let failDownload = failReuseOnce, failPhotoSource = photoSourceFailsOnce;
  const deps = { react: hooks, "react-native": native,
    "../components/GpsLocationPicker": { default: "GpsLocationPicker" }, "../utils/gpsLocation": { validGpsPoint, readGpsLocation },
    "../components/OriginalUpdatedField": { default: (props) => React.createElement("View", {}, React.createElement("Text", {}, props.label), props.originalContent, props.children) },
    "../components/fieldFormStyles": { fieldFormStyles: { photoButtonRow: {}, photoButton: {}, photoButtonText: {}, qrRefreshButton: {}, qrRefreshText: {} } },
    "../components/BotanicalSkeleton": { DetailSkeletonContent: "DetailSkeletonContent" },
    "@react-navigation/native": { useFocusEffect: (fn) => { focus = fn; } },
    "expo-image-picker": { requestCameraPermissionsAsync: async () => ({ granted: true }), requestMediaLibraryPermissionsAsync: async () => ({ granted: true }),
      launchCameraAsync: async () => ({ canceled: false, assets: [{ uri: "file://camera.jpg" }] }),
      launchImageLibraryAsync: async () => ({ canceled: false, assets: [{ uri: "file://gallery.jpg" }] }) },
    "expo-location": { Accuracy: { High: 4 }, requestForegroundPermissionsAsync: async () => ({ status: locationDenied ? "denied" : "granted" }),
      getCurrentPositionAsync: async () => ({ coords: { latitude: 4.6, longitude: 113.8, altitude: 25.34, accuracy: 6.78 } }) },
    "expo-file-system/legacy": { readAsStringAsync: async () => { photoReads++; return "aGVsbG8="; }, EncodingType: { Base64: "base64" } },
    "@expo/vector-icons": { Feather: "Feather", Ionicons: "Ionicons" }, "@expo/vector-icons/Ionicons": { default: "Ionicons" },
    "../components/OriginalUpdatedField": { default: ({ children, label, originalContent, originalValue }) =>
      React.createElement("View", null,
        label ? React.createElement("Text", null, label) : null,
        React.createElement("Text", null, originalContent || String(originalValue ?? "recordEdits.informationNotAvailable")),
        children) },
    "../utils/qrInventory": { normalizeQRCodes: (payload) => payload.qr_codes.map((qr) => ({ id: String(qr.qr_id), label: `QR-${String(qr.qr_id).padStart(4, "0")}`, plantId: qr.plant_id == null ? null : String(qr.plant_id), status: qr.status })) },
    "../utils/botanistRecords": { ...(species ? { fetchBotanistSpeciesRequest: async () => { if (speciesFetchCount++ > 0 && record.failReload) throw Error("offline"); return { ...record }; } } : { fetchBotanistPlant: async () => { if (plantFetchCount++ > 0 && refreshError) throw Error("network unavailable"); return plantFetchCount > 1 && refreshedRecord ? refreshedRecord : record; } }),
      fetchBotanistRecordChange: async (_accountId, changeId, options) => { assert.equal(String(changeId), String(correctionChange?.id)); assert.equal(options.kind, species ? "species" : "plant"); correctionFetchCount++; return correctionFetchCount > 1 && refreshedCorrectionChange !== undefined ? refreshedCorrectionChange : correctionChange; },
      fetchBotanistRecordChangeStatus: async () => {
        if (editAvailabilityError) throw Error("offline");
        return { available: true, pending: pendingEdit ? { status: "Pending Review" } : null, latest: null };
      } },
    "../utils/plantApi": species ? { plantApi: api, recordChangePhotoSource: async () => ({ uri: "https://example.invalid/proposed-photo" }) } : { plantApi: api, fetchSpeciesCatalog: async () => catalog,
      plantAssetSources: async (assets) => { if (failPhotoSource) { failPhotoSource = false; throw Error("Photo session unavailable"); }
        return assets.map((asset) => ({ uri: `https://example.invalid/existing-${String(asset.id).replace("photo-", "")}` })); },
      recordChangePhotoSource: async () => ({ uri: "https://example.invalid/proposed-photo" }) },
    "../utils/photoReuse": { downloadPhotoForReuse: async () => {
      if (failDownload) { failDownload = false; throw Object.assign(Error("PHOTO_REUSE_DOWNLOAD_FAILED"), { code: "PHOTO_REUSE_DOWNLOAD_FAILED" }); }
      return { photo: { content_type: "image/jpeg", base64: "cmV1c2Vk" }, cleanup: async () => {} };
    } },
    "../utils/botanistFormDrafts": { getBotanistFormDraft: async () => savedDraft, findBotanistFormDraft: async (...args) => findDraftCandidate && (!args[3] || args[3](findDraftCandidate)) ? findDraftCandidate : null, saveBotanistFormDraft: async (accountId, draft) => { draftSaves.push({ accountId, draft }); if (draftSaveError) throw Error("storage unavailable"); return { ...draft, saved_at: "test" }; }, deleteBotanistFormDraft: async () => true },
    "../utils/botanistDraftAutosave": { useBotanistDraftAutosave: () => ({ stop: async () => {}, flush: async () => {} }) },
    "../translations/i18n": { useAppTranslation() {}, t: (key) => key, translateUIMessage: (value) => value },
  };
  const component = screen(file, deps);
  const route = { params: { botanist: { id: "owner" }, ...(correctionChange ? { correctionChangeId: correctionChange.id, correction: true } : correction ? { correction: true } : {}), ...(species ? { requestId: "1" } : { plantId: "8", ...(pendingVersionSelection || {}), ...(savedDraft ? { formDraftKey: savedDraft.client_key } : {}), ...(speciesRequestId ? { speciesRequestId } : {}) }) } };
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
  return { render, route, walk, collect, text, get focus() { return focus; }, get alert() { return alert; }, calls, draftSaves, navigations, get photoReads() { return photoReads; } };
}
const plant = (status) => ({
  registrationState: status === "Approved" ? "available" : "unavailable",
  registration: status === "Approved" ? { heightCm:20,healthStatus:"Healthy",lifeStage:"Mature",morphology:"Leaves",notes:"",latitude:4.5,longitude:113.7 } : null,
  registrationPhotoIds: ["photo-1","photo-2","photo-3"],
  current_registration: { state:"available", observation_id:"registration", observation_revision:1, version_id:null },
  id: "8", speciesId: "6", scientificName: "Manual plant name", status, qrId: "2", qrCode: "QR-0002",
  latestObservation: { revision: 1, assets: [{ id: "photo-1" }, { id: "photo-2" }, { id: "photo-3" }], content: { heightCm: 20, healthStatus: "Healthy", lifeStage: "Mature", morphology: "Leaves", notes: "", latitude: 4.5, longitude: 113.7 } },
  observations: [{ status: "Approved", assets: [{ id: "photo-1" }, { id: "photo-2" }, { id: "photo-3" }], content: { heightCm: 20, healthStatus: "Healthy", lifeStage: "Mature", morphology: "Leaves", notes: "", latitude: 4.5, longitude: 113.7 } }],
  photos: [1, 2, 3].map((index) => ({ uri: `https://example.invalid/existing-${index}` })) });
const request = (status) => ({ request_id: 1, content_revision: 1, request_status: status, scientific_name: "Species A", common_name: "Common A",
  genus_name: "Genus A", family_name: "Family A", conservation_status: "Least Concern", description: "Original", habitat: "Forest",
  photo: { uri: "https://example.invalid/species" } });

test("restored approved Plant draft ignores baseline key order and validates genuine changes", async () => {
  const record = plant("Approved");
  const open = async (savedDraft) => {
    const h = harness("screens/EditPlantRecord.js", { record, savedDraft });
    h.render(); h.focus(); await new Promise(setImmediate);
    return h;
  };
  const button = (h, label) => h.walk(h.render(), (node) => node.type === "TouchableOpacity" && h.text(node) === label);
  const submit = (h) => button(h, "recordEdits.submitChanges");
  const field = (h, key) => h.walk(h.walk(h.render(), (node) => node.type === "View" &&
    React.Children.toArray(node.props.children).some((child) => child.props?.children === key)),
  (node) => node.type === "TextInput");
  const h = await open();
  assert.equal(submit(h).props.disabled, true);
  assert.match(h.text(h.render()), /recordEdits.noEditChanges/);
  field(h, "recordEdits.zone").props.onChangeText("Zone B");
  assert.equal(submit(h).props.disabled, false);
  field(h, "recordEdits.notes").props.onChangeText("New note");
  field(h, "recordEdits.zone").props.onChangeText("");
  assert.equal(submit(h).props.disabled, false);
  await button(h, "botanistDrafts.saveDraft").props.onPress();
  const draft = h.draftSaves[0].draft;
  const snapshot = JSON.parse(draft.base_signature);
  draft.base_signature = JSON.stringify(Object.fromEntries(Object.entries(snapshot).reverse()));
  const restored = harness("screens/EditPlantRecord.js", { record, savedDraft: draft, findDraftCandidate: draft });
  delete restored.route.params.formDraftKey;
  restored.render(); restored.focus(); await new Promise(setImmediate);
  const continueDraft = restored.alert[2].find((action) => action.text === "botanistDrafts.continueDraft");
  await continueDraft.onPress();
  assert.equal(field(restored, "recordEdits.notes").props.value, "New note");
  assert.equal(submit(restored).props.disabled, false);
  const unchanged = await open({ ...draft, form: { ...draft.form, notes: "" } });
  assert.equal(submit(unchanged).props.disabled, true);
  const invalid = await open({ ...draft, form: { ...draft.form, heightCm: "" } });
  assert.equal(submit(invalid).props.disabled, true);
  assert.match(invalid.text(invalid.render()), /addPlantWorkflow.invalidHeight/);
  submit(restored).props.onPress();
  const confirm = restored.alert[2][1].onPress;
  await Promise.all([confirm(), confirm()]);
  const writes = restored.calls.filter(([path, options]) => path === "/record-changes" && options?.method === "POST");
  assert.equal(writes.length, 1);
  assert.equal(writes[0][1].body.proposed.content.notes, "New note");
  assert.equal(writes[0][1].body.proposed.content.latitude, 4.5);
  assert.equal(writes[0][1].body.proposed.content.longitude, 113.7);
  assert.equal(record.registration.notes, "");
});

test("Edit Plant uses the approved location Zone in both columns and changes only the proposal", async () => {
  const open = async (zone) => {
    const record = { ...plant("Approved"), location: { latitude: 4.5, longitude: 113.7, zone } };
    record.latestObservation.content.zone = "Unrelated Observation Zone";
    const h = harness("screens/EditPlantRecord.js", { record });
    h.render(); h.focus(); await new Promise(setImmediate);
    return h;
  };
  const zoneField = (h) => h.walk(h.render(), (node) => node.type === "View" &&
    React.Children.toArray(node.props.children).some((child) => child.props?.children === "recordEdits.zone"));
  const input = (h) => h.walk(zoneField(h), (node) => node.type === "TextInput");
  const h = await open("Zone A");
  assert.match(h.text(zoneField(h)), /Zone A/);
  assert.equal(input(h).props.value, "Zone A");
  input(h).props.onChangeText("Zone B");
  assert.match(h.text(zoneField(h)), /Zone A/);
  h.walk(h.render(), (node) => node.type === "TouchableOpacity" && h.text(node) === "recordEdits.submitChanges").props.onPress();
  await h.alert[2][1].onPress();
  const { content } = h.calls.find(([path, options]) => path === "/record-changes" && options?.method === "POST")[1].body.proposed;
  assert.equal(content.zone, "Zone B");
  assert.equal(content.latitude, 4.5);
  assert.equal(content.longitude, 113.7);
  const missing = await open(null);
  assert.match(missing.text(zoneField(missing)), /recordEdits.informationNotAvailable/);
  assert.equal(input(missing).props.value, "");
  const approved = await open("Zone B");
  assert.match(approved.text(zoneField(approved)), /Zone B/);
  assert.equal(input(approved).props.value, "Zone B");
});

test("Plant edit and correction labels mark only required inputs", async () => {
  for (const status of ["Pending Review", "Approved"]) {
    const h = harness("screens/EditPlantRecord.js", { record: plant(status) });
    h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
    const labels = h.collect(h.render(), (node) => node.type === "Text").map((node) => h.text(node));
    for (const field of ["plantScientificName", "heightCm", "healthStatus", "lifeStage", "morphology", "latitude", "longitude"])
      assert.ok(labels.includes(`recordEdits.${field} *`), `${status}: ${field}`);
    assert.ok(labels.includes("addPlantWorkflow.approvedSpecies *"), `${status}: approved species`);
    for (const field of ["notes", "zone", "accuracy_m", "altitudeM", "qr_id", "plantPhotos"])
      assert.ok(!labels.includes(`recordEdits.${field} *`), `${status}: ${field} remains optional or reusable`);
  }
});

test("Plant edit and correction reject height above 100000 before any API write", async () => {
  for (const status of ["Pending Review", "Approved"]) {
    const h = harness("screens/EditPlantRecord.js", { record: plant(status), correction: status === "Pending Review" });
    h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
    let tree = h.render();
    const height = h.walk(tree, (node) => node.type === "TextInput" && node.props.value === "20");
    assert.ok(height);
    height.props.onChangeText("100001");
    tree = h.render();
    h.walk(tree, (node) => node.type === "TouchableOpacity" && h.text(node) === "recordEdits.submitChanges").props.onPress();
    assert.equal(h.alert?.[1], "addPlantWorkflow.invalidHeight");
    assert.equal(h.calls.some(([path, options]) => path === "/record-changes" && options?.method === "POST"), false);
  }
});

test("Plant correction refresh preserves the live form and photos, then requires review before rebasing", async () => {
  const correctionChange = { id: "change-8", status: "Correction Required", revision: 1, review_comment: "Please clarify the location.",
    base_snapshot: { photo_ids: ["photo-1", "photo-2", "photo-3"] }, proposed_snapshot: {}, proposal_photo_count: 0 };
  const original = plant("Approved"), latest = { ...plant("Approved"), scientificName: "Latest server name", latestObservation: { ...plant("Approved").latestObservation, revision: 2 } };
  const savedDraft = { client_key: "draft-8", correction_change_id: correctionChange.id,
    base_signature: JSON.stringify({ status: "Approved", revision: null, scientific_name: original.scientificName, species_id: original.speciesId,
      qr_id: original.qrId, content: original.observations[0].content, photo_ids: ["photo-1", "photo-2", "photo-3"] }),
    form: { scientific_name: "Manual plant name", species_id: "6", qr_id: "2", heightCm: "20", healthStatus: "Healthy", lifeStage: "Mature",
      morphology: "Leaves", notes: "", zone: "", latitude: "4.5", longitude: "113.7", accuracy_m: "", altitudeM: "", selectedOriginalPhotos: [], photoSelectionTouched: false }, photo_refs: [] };
  const h = harness("screens/EditPlantRecord.js", { record: original, refreshedRecord: latest, correctionChange, savedDraft });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  let tree = h.render();
  const refresh = h.walk(tree, (node) => node.type === "TouchableOpacity" && node.props.testID === "plant-correction-refresh");
  assert.ok(refresh, "refresh control appears on correction form");
  assert.equal(refresh.props.style.width, 44);
  assert.equal(refresh.props.style.height, 44);
  assert.equal(h.walk(refresh, (node) => node.type === "Feather")?.props.name, "refresh-cw");
  const name = h.walk(tree, (node) => node.type === "TextInput" && node.props.value === "Manual plant name");
  name.props.onChangeText("Unsaved correction name");
  const addPhoto = h.walk(h.render(), (node) => node.type === "TouchableOpacity" && node.props.accessibilityLabel === "recordEdits.addGallery");
  await addPhoto.props.onPress();
  await refresh.props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  tree = h.render();
  assert.ok(h.walk(tree, (node) => node.type === "TextInput" && node.props.value === "Unsaved correction name"), "typed correction remains in the form");
  assert.ok(h.walk(tree, (node) => node.type === "Image" && node.props.source?.uri === "file://gallery.jpg"), "new photo selection remains in the form");
  assert.ok(h.text(tree).includes("botanistDrafts.editConflict"), `changed revision raises the existing conflict warning: ${h.text(tree)}`);
  const submit = h.walk(tree, (node) => node.type === "TouchableOpacity" && h.text(node) === "recordEdits.submitChanges");
  assert.equal(submit.props.disabled, true, "submission remains blocked until latest baseline is reviewed");
  const review = h.walk(tree, (node) => node.type === "TouchableOpacity" && h.text(node).includes("recordEdits.reviewLatestAndContinue"));
  assert.ok(review, "review and explicit continue action is offered");
  await review.props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  tree = h.render();
  assert.ok(h.walk(tree, (node) => node.type === "TextInput" && node.props.value === "Unsaved correction name"), "rebasing does not replace edited values");
  assert.ok(h.walk(tree, (node) => node.type === "Image" && node.props.source?.uri === "file://gallery.jpg"), "rebasing does not discard selected photos");
  assert.equal(h.draftSaves.length, 1, "the explicitly accepted baseline is persisted with the saved draft");
  assert.equal(h.draftSaves[0].draft.base_revision, latest.current_registration.observation_revision);
  assert.equal(h.draftSaves[0].draft.form.scientific_name, "Unsaved correction name");
  assert.equal(h.draftSaves[0].draft.photos[0].uri, "file://gallery.jpg");
  assert.equal(h.walk(tree, (node) => node.type === "TouchableOpacity" && h.text(node) === "recordEdits.submitChanges").props.disabled, false);
});

test("Plant correction refresh merges non-overlapping server changes and rebases its saved draft", async () => {
  const original = plant("Pending Review");
  original.latestObservation = { ...original.latestObservation, id: "observation-8", status: "Correction Required" };
  const latest = { ...original, latestObservation: { ...original.latestObservation, revision: 2,
    content: { ...original.latestObservation.content, healthStatus: "Recovering" } } };
  const savedDraft = { client_key: "correction-draft-8", base_signature: JSON.stringify({ status: "Pending Review", revision: 1,
      scientific_name: original.scientificName, species_id: original.speciesId, qr_id: original.qrId,
      content: original.latestObservation.content, photo_ids: ["photo-1", "photo-2", "photo-3"] }),
    baseline: { plant: original }, form: { scientific_name: "Manual plant name", species_id: "6", qr_id: "2", heightCm: "20", healthStatus: "Healthy",
      lifeStage: "Mature", morphology: "Leaves", notes: "", zone: "", latitude: "4.5", longitude: "113.7", accuracy_m: "", altitudeM: "",
      selectedOriginalPhotos: [], photoSelectionTouched: false }, photo_refs: [] };
  const h = harness("screens/EditPlantRecord.js", { record: original, refreshedRecord: latest, savedDraft, correction: true });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  let tree = h.render();
  let refresh = h.walk(tree, (node) => node.type === "TouchableOpacity" && node.props.testID === "plant-correction-refresh");
  assert.ok(refresh);
  h.walk(tree, (node) => node.type === "TextInput" && node.props.value === "Manual plant name").props.onChangeText("Keep this correction");
  tree = h.render();
  refresh = h.walk(tree, (node) => node.type === "TouchableOpacity" && node.props.testID === "plant-correction-refresh");
  await refresh.props.onPress(); await new Promise((resolve) => setImmediate(resolve));
  tree = h.render();
  assert.ok(h.walk(tree, (node) => node.type === "TextInput" && node.props.value === "Keep this correction"), "entered correction is retained");
  assert.ok(h.walk(tree, (node) => node.type === "TextInput" && node.props.value === "Recovering"), "untouched field is updated from the latest record");
  assert.equal(h.text(tree).includes("botanistDrafts.editConflict"), false, "non-overlapping change is safely reconciled");
  assert.equal(h.walk(tree, (node) => node.type === "TouchableOpacity" && h.text(node).includes("recordEdits.reviewLatestAndContinue")), null,
    "no unnecessary review confirmation remains");
  assert.equal(h.walk(tree, (node) => node.type === "TouchableOpacity" && h.text(node) === "recordEdits.submitChanges").props.disabled, false);
  assert.equal(h.draftSaves.length, 1, "saved draft baseline is updated");
  assert.match(h.draftSaves[0].draft.base_signature, /"revision":2/);
  assert.equal(h.draftSaves[0].draft.base_revision, 2);
  h.walk(tree, (node) => node.type === "TouchableOpacity" && h.text(node) === "recordEdits.submitChanges").props.onPress();
  await h.alert[2][1].onPress();
  const submission = h.calls.find(([path, options]) => path === "/my-plants/8" && options?.method === "PATCH");
  assert.equal(submission[1].body.expected_revision, 2, "backend revision validation receives the refreshed revision");
});

test("Plant correction refresh failure leaves the draft untouched and reports an error", async () => {
  const correctionChange = { id: "change-8", status: "Correction Required", revision: 1, review_comment: "Please clarify the location.", base_snapshot: { photo_ids: [] }, proposed_snapshot: {}, proposal_photo_count: 0 };
  const h = harness("screens/EditPlantRecord.js", { record: plant("Approved"), correctionChange, refreshError: true });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  h.walk(h.render(), (node) => node.type === "TextInput" && node.props.value === "Manual plant name").props.onChangeText("Keep my correction");
  const refresh = h.walk(h.render(), (node) => node.type === "TouchableOpacity" && node.props.testID === "plant-correction-refresh");
  await refresh.props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  const tree = h.render();
  assert.ok(h.walk(tree, (node) => node.type === "TextInput" && node.props.value === "Keep my correction"));
  assert.ok(h.text(tree).includes("recordEdits.correctionRefreshFailed"));
});

test("Species edit and correction labels mark seven required fields, not replacement photo", async () => {
  const h = harness("screens/EditSpeciesRequest.js", { record: request("Pending Review"), species: true });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  const labels = h.collect(h.render(), (node) => node.type === "Text").map((node) => h.text(node));
  for (const field of ["genus_name", "family_name", "conservation_status", "description", "habitat"])
    assert.ok(labels.includes(`recordEdits.${field} *`), field);
  assert.ok(labels.includes("addPlant.scientificName"));
  assert.ok(labels.includes("addPlant.commonName"));
  assert.ok(!labels.includes("recordEdits.speciesPhoto *"));
  for (const language of ["en", "ms", "zh"]) {
    const translations = JSON.parse(readFileSync(new URL(`../translations/${language}.json`, import.meta.url), "utf8"));
    assert.ok(translations.addPlant.scientificName.endsWith(" *"), `${language}: scientific name`);
    assert.ok(translations.addPlant.commonName.endsWith(" *"), `${language}: common name`);
    assert.ok(translations.addPlantWorkflow.approvedSpecies, `${language}: approved species`);
  }
});

test("Plant correction keeps a selected species in a bounded, searchable list", async () => {
  const catalog = Array.from({ length: 24 }, (_, index) => ({ id: String(index + 1), scientificName: `Species ${index + 1}`, commonName: `Common ${index + 1}` }));
  const h = harness("screens/EditPlantRecord.js", { record: plant("Pending Review"), catalog });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  const list = h.walk(h.render(), (node) => node.type === "ScrollView" && node.props.nestedScrollEnabled && node.props.style?.maxHeight === 220);
  assert.ok(list, "species options scroll independently of the form");
  const last = h.walk(list, (node) => node.type === "TouchableOpacity" && h.text(node).includes("Species 24"));
  last.props.onPress();
  const search = h.walk(h.render(), (node) => node.type === "TextInput" && node.props.placeholder === "addPlant.searchByScientificOrCommonName");
  search.props.onChangeText("Species 3");
  assert.ok(h.walk(h.render(), (node) => node.type === "TouchableOpacity" && h.text(node).includes("Species 24") && node.props.accessibilityState?.selected));
  assert.ok(h.walk(h.render(), (node) => node.type === "TouchableOpacity" && h.text(node).includes("recordEdits.requestNewSpecies")));
});

test("Plant correction lists only available and current QR codes and retains refresh", async () => {
  const qrCodes = [
    { qr_id: 2, qr_code: "current-token", plant_id: 8, status: "assigned" },
    { qr_id: 3, qr_code: "other-token", plant_id: 9, status: "assigned" },
    { qr_id: 4, qr_code: "retired-token", plant_id: null, status: "retired" },
    ...Array.from({ length: 20 }, (_, index) => ({ qr_id: 10 + index, qr_code: `free-${index}`, plant_id: null, status: "generated" })),
  ];
  const h = harness("screens/EditPlantRecord.js", { record: plant("Pending Review"), qrCodes });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  const lists = h.collect(h.render(), (node) => node.type === "ScrollView" && node.props.nestedScrollEnabled && node.props.style?.maxHeight === 220);
  assert.equal(lists.length, 2);
  assert.ok(h.text(lists[1]).includes("QR-0002"));
  assert.ok(h.text(lists[1]).includes("QR-0029"));
  assert.ok(!h.text(lists[1]).includes("QR-0003"));
  assert.ok(!h.text(lists[1]).includes("QR-0004"));
  h.walk(lists[1], (node) => node.type === "TouchableOpacity" && h.text(node).includes("QR-0029")).props.onPress();
  assert.ok(h.walk(h.render(), (node) => node.type === "TouchableOpacity" && h.text(node).includes("QR-0029") && node.props.accessibilityState?.selected));
  await h.walk(h.render(), (node) => node.type === "TouchableOpacity" && h.text(node).includes("recordEdits.refreshQr")).props.onPress();
  assert.ok(h.calls.filter(([path]) => path === "/qr-codes").length >= 2);
});

test("Plant correction resolves original photos by baseline asset ID, not gallery position", async () => {
  const correctionChange = { id: "change-8", status: "Correction Required", revision: 1, review_comment: "Review photos",
    base_snapshot: { photo_ids: ["photo-3", "photo-1"] }, proposed_snapshot: {}, proposal_photo_count: 0 };
  const h = harness("screens/EditPlantRecord.js", { record: plant("Approved"), correctionChange });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  const originals = h.collect(h.render(), (node) => node.type === "View" && node.props.accessibilityLabel?.startsWith("recordEdits.originalPhoto"));
  assert.equal(originals.length, 2);
  assert.equal(h.walk(originals[0], (node) => node.type === "Image")?.props.source.uri, "https://example.invalid/existing-3");
  assert.equal(h.walk(originals[1], (node) => node.type === "Image")?.props.source.uri, "https://example.invalid/existing-1");
});

test("Plant correction shows a retry when original photo authorization fails", async () => {
  const h = harness("screens/EditPlantRecord.js", { record: plant("Pending Review"), photoSourceFailsOnce: true });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  assert.ok(h.text(h.render()).includes("Photo session unavailable"));
  const retry = h.walk(h.render(), (node) => node.type === "TouchableOpacity" && h.text(node).includes("common.tryAgain"));
  assert.ok(retry);
  retry.props.onPress(); await new Promise((resolve) => setImmediate(resolve));
  assert.ok(h.walk(h.render(), (node) => node.type === "Image" && node.props.source?.uri === "https://example.invalid/existing-1"));
});

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
    assert.deepEqual(h.navigations.at(-1), ["BotanistSubmissions", { botanist: { id: "owner" }, openTarget: { kind: "plant", recordId: "8" } }]);
  });
  test(`${approved ? "approved" : "pending"} species editor prefills and submits to the correct endpoint`, async () => {
    const h = harness("screens/EditSpeciesRequest.js", { record: request(approved ? "Approved" : "Pending Review"), species: true });
    h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
    if (approved) h.walk(h.render(), (node) => node.type === "TextInput" && node.props.value === "Original").props.onChangeText("Updated description");
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
    assert.deepEqual(h.navigations.at(-1), ["BotanistSubmissions", { botanist: { id: "owner" }, openTarget: { kind: "species", recordId: "1" } }]);
  });
}

test("latest Pending Review Plant history revision opens its current owned data and saves with that revision", async () => {
  const current = plant("Pending Review");
  current.scientificName = "Latest Edit 2 plant";
  current.latestObservation = { ...current.latestObservation, id: "initial-8", revision: 3,
    content: { ...current.latestObservation.content, heightCm: 37, zone: "Latest zone" } };
  const selection = { pendingObservationId: "initial-8", pendingRevision: 3, pendingStatus: "Pending Review" };
  const h = harness("screens/EditPlantRecord.js", { record: current, pendingVersionSelection: selection });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  const tree = h.render();
  assert.ok(h.walk(tree, (node) => node.type === "TextInput" && node.props.value === "Latest Edit 2 plant"));
  assert.ok(h.walk(tree, (node) => node.type === "TextInput" && node.props.value === "37"));
  assert.ok(h.walk(tree, (node) => node.type === "TextInput" && node.props.value === "Latest zone"));
  assert.ok(h.walk(tree, (node) => node.type === "Image" && node.props.source.uri.includes("existing")));
  h.walk(tree, (node) => node.type === "TouchableOpacity" && h.text(node) === "recordEdits.submitChanges").props.onPress();
  await h.alert[2][1].onPress();
  const saved = h.calls.find(([path]) => path === "/my-plants/8");
  assert.equal(saved[1].body.expected_revision, 3);
  assert.equal(saved[1].body.scientific_name, "Latest Edit 2 plant");
  assert.equal(saved[1].body.species_id, 6);
  assert.equal(saved[1].body.content.heightCm, 37);
  assert.equal(saved[1].body.content.zone, "Latest zone");
  assert.equal(Object.hasOwn(saved[1].body, "photo_ids"), false, "unchanged photos remain attached");

  const stale = harness("screens/EditPlantRecord.js", { record: current,
    pendingVersionSelection: { ...selection, pendingRevision: 2 } });
  stale.render(); stale.focus(); await new Promise((resolve) => setImmediate(resolve));
  assert.ok(stale.text(stale.render()).includes("botanistDrafts.editConflict"));
  assert.equal(stale.calls.some(([path]) => path === "/my-plants/8"), false);
});

test("approved plant edit with a pending reviewed change blocks before reading selected photo files", async () => {
  const h = harness("screens/EditPlantRecord.js", { record: plant("Approved"), pendingEdit: true });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
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
  h.walk(h.render(), (node) => node.type === "TextInput" && node.props.value === "Original").props.onChangeText("Updated description");
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
  h.walk(h.render(), (node) => node.type === "TextInput" && node.props.value === "Original").props.onChangeText("Updated description");
  const submit = h.walk(h.render(), (node) => node.type === "TouchableOpacity" && h.text(node) === "recordEdits.submitChanges");
  submit.props.onPress(); await h.alert[2][1].onPress();
  assert.equal(h.alert[1], "recordEdits.pendingEditExplanation");
  assert.ok(h.walk(h.render(), (node) => node.type === "TextInput" && node.props.value === "Species A"));
});

test("Plant edit correction is prefilled from the owner proposal and PATCHes the same proposal ID", async () => {
  const correctionChange = { id: "change-plant-1", plant_id: "8", owner_subject: "staff:owner", status: "Correction Required", revision: 1,
    review_comment: "Clarify the morphology.", proposal_photo_count: 0,
    proposed_snapshot: { scientific_name: "Proposed plant name", species_id: "6", qr_id: 2,
      content: { heightCm: 31, healthStatus: "Healthy", lifeStage: "Mature", morphology: "Corrected leaves", notes: "Updated note", zone: "Zone B", latitude: 4.5, longitude: 113.7 } } };
  const h = harness("screens/EditPlantRecord.js", { record: plant("Approved"), correctionChange });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  assert.ok(h.text(h.render()).includes("Clarify the morphology."));
  assert.ok(h.walk(h.render(), (node) => node.type === "TextInput" && node.props.value === "Proposed plant name"));
  assert.ok(h.walk(h.render(), (node) => node.type === "TextInput" && node.props.value === "Corrected leaves"));
  h.walk(h.render(), (node) => node.type === "TouchableOpacity" && h.text(node) === "recordEdits.submitChanges").props.onPress();
  await h.alert[2][1].onPress();
  const sent = h.calls.find(([path, options]) => path === "/record-changes/change-plant-1" && options.method === "PATCH");
  assert.equal(sent[1].body.revision, 1);
  assert.equal(sent[1].body.proposed.scientific_name, "Proposed plant name");
  assert.equal(sent[1].body.proposed.content.morphology, "Corrected leaves");
  h.alert[2][0].onPress();
  assert.deepEqual(h.navigations.at(-1), ["BotanistSubmissions", { botanist: { id: "owner" }, openTarget: { kind: "plant", recordId: "8" } }]);
  assert.equal(h.calls.some(([path, options]) => path === "/record-changes" && options?.method === "POST"), false);
});

test("Species edit correction is prefilled and resubmits the same proposal", async () => {
  const correctionChange = { id: "change-species-1", species_id: "6", owner_subject: "staff:owner", status: "Correction Required", revision: 1,
    review_comment: "Use a clearer common name.", proposal_photo_count: 0, base_snapshot: { request_id: 1 },
    proposed_snapshot: { scientific_name: "Proposed species", common_name: "Updated common", genus_name: "Genus A", family_name: "Family A",
      conservation_status: "Least Concern", description: "Updated description", habitat: "Wet forest" } };
  const h = harness("screens/EditSpeciesRequest.js", { record: request("Approved"), species: true, correctionChange });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  assert.ok(h.text(h.render()).includes("Use a clearer common name."));
  assert.ok(h.walk(h.render(), (node) => node.type === "TextInput" && node.props.value === "Proposed species"));
  h.walk(h.render(), (node) => node.type === "TouchableOpacity" && h.text(node) === "recordEdits.submitChanges").props.onPress();
  await h.alert[2][1].onPress();
  const sent = h.calls.find(([path, options]) => path === "/record-changes/change-species-1" && options.method === "PATCH");
  assert.equal(sent[1].body.revision, 1);
  assert.equal(sent[1].body.proposed.scientific_name, "Proposed species");
  h.alert[2][0].onPress();
  assert.deepEqual(h.navigations.at(-1), ["BotanistSubmissions", { botanist: { id: "owner" }, openTarget: { kind: "species", recordId: "1" } }]);
  assert.equal(h.calls.some(([path, options]) => path === "/record-changes" && options?.method === "POST"), false);
});

test("Plant correction silently restores only a draft for the same correction request", async () => {
  const correctionChange = { id: "change-plant-1", plant_id: "8", owner_subject: "staff:owner", status: "Correction Required", revision: 1,
    proposed_snapshot: { scientific_name: "Submitted plant", species_id: "6", qr_id: 2, content: { morphology: "Submitted morphology" } } };
  const candidate = { client_key: "plant-correction-draft", correction_change_id: correctionChange.id,
    form: { scientific_name: "Unsaved plant", species_id: "6", qr_id: "2", morphology: "Unsaved morphology" },
    photo_refs: [{ slot: "new:00", uri: "file://unsaved.jpg" }] };
  const h = harness("screens/EditPlantRecord.js", { record: plant("Approved"), correctionChange, savedDraft: candidate, findDraftCandidate: candidate });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  const tree = h.render();
  assert.equal(h.alert, undefined, "correction drafts do not prompt");
  assert.ok(h.walk(tree, (node) => node.type === "TextInput" && node.props.value === "Unsaved plant"));
  assert.ok(h.walk(tree, (node) => node.type === "TextInput" && node.props.value === "Unsaved morphology"));
});

test("Species correction ignores an unfinished draft for a different correction request", async () => {
  const correctionChange = { id: "change-species-1", species_id: "6", owner_subject: "staff:owner", status: "Correction Required", revision: 1,
    base_snapshot: { request_id: 1 }, proposed_snapshot: { scientific_name: "Latest submitted species", common_name: "Latest common" } };
  const unrelated = { client_key: "other-correction-draft", correction_change_id: "different-change",
    form: { scientific_name: "Unrelated draft", common_name: "Unrelated common" }, photo_refs: [] };
  const h = harness("screens/EditSpeciesRequest.js", { record: request("Approved"), species: true, correctionChange, savedDraft: unrelated, findDraftCandidate: unrelated });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  const tree = h.render();
  assert.equal(h.alert, undefined, "correction drafts do not prompt");
  assert.ok(h.walk(tree, (node) => node.type === "TextInput" && node.props.value === "Latest submitted species"));
  assert.equal(h.walk(tree, (node) => node.type === "TextInput" && node.props.value === "Unrelated draft"), null);
});

test("normal plant editing keeps the existing unfinished-draft recovery prompt", async () => {
  const candidate = { client_key: "ordinary-plant-draft", correction_change_id: null,
    form: { scientific_name: "Saved ordinary edit", species_id: "6", qr_id: "2" }, photo_refs: [] };
  const h = harness("screens/EditPlantRecord.js", { record: plant("Approved"), findDraftCandidate: candidate });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.alert?.[0], "botanistDrafts.recoveryTitle");
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

test("approved Species edit previews the retained photo without treating it as a change", async () => {
  const h = harness("screens/EditSpeciesRequest.js", { record: request("Approved"), species: true });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  let tree = h.render();
  const images = h.collect(tree, (node) => node.type === "Image");
  assert.equal(images.length, 2, "Original and Updated Information each show the existing photo");
  assert.deepEqual(images[0].props.source, images[1].props.source);
  assert.ok(!h.text(tree).includes("recordEdits.speciesPhotoSingleLimit"));
  const submit = h.walk(tree, (node) => node.type === "TouchableOpacity" && h.text(node) === "recordEdits.submitChanges");
  assert.equal(submit.props.disabled, true);
  const remove = h.walk(tree, (node) => node.type === "TouchableOpacity" && node.props.accessibilityLabel === "recordEdits.removePhoto");
  remove.props.onPress();
  assert.equal(h.alert[1], "recordEdits.speciesPhotoRemovalUnsupported");
  assert.equal(h.collect(h.render(), (node) => node.type === "Image").length, 2);
  const gallery = h.walk(h.render(), (node) => node.type === "TouchableOpacity" && h.text(node) === "recordEdits.addGallery");
  await gallery.props.onPress();
  tree = h.render();
  assert.equal(h.collect(tree, (node) => node.type === "Image")[1].props.source.uri, "file://gallery.jpg");
  assert.equal(h.walk(tree, (node) => node.type === "TouchableOpacity" && h.text(node) === "recordEdits.submitChanges").props.disabled, false);
  const saveDraft = h.walk(tree, (node) => node.type === "TouchableOpacity" && h.text(node) === "botanistDrafts.saveDraft");
  await saveDraft.props.onPress();
  assert.equal(h.draftSaves.at(-1).draft.photos[0].uri, "file://gallery.jpg");
  h.walk(h.render(), (node) => node.type === "TouchableOpacity" && node.props.accessibilityLabel === "recordEdits.removePhoto").props.onPress();
  tree = h.render();
  assert.deepEqual(h.collect(tree, (node) => node.type === "Image")[0].props.source,
    h.collect(tree, (node) => node.type === "Image")[1].props.source);
  assert.equal(h.walk(tree, (node) => node.type === "TouchableOpacity" && h.text(node) === "recordEdits.submitChanges").props.disabled, true);
  await gallery.props.onPress();
  h.walk(h.render(), (node) => node.type === "TouchableOpacity" && h.text(node) === "recordEdits.submitChanges").props.onPress();
  await h.alert[2][1].onPress();
  const sent = h.calls.find(([path]) => path === "/record-changes");
  assert.deepEqual(sent[1].body.proposed.photo, { content_type: "image/jpeg", base64: "aGVsbG8=" });
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

test("plant editor preloads its inline map, captures fresh GPS, then applies a manual center without losing altitude", async () => {
  const h = harness("screens/EditPlantRecord.js", { record: plant("Approved") });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  let tree = h.render();
  assert.ok(h.text(tree).includes("QR-0002"));
  for (const field of ["latitude", "longitude", "altitudeM", "accuracy_m"])
    assert.ok(h.text(tree).includes(`recordEdits.${field}`));
  const detect = h.walk(tree, (node) => node.type === "TouchableOpacity" && h.text(node) === "addPlant.getCurrentLocation");
  assert.ok(detect);
  assert.equal(h.walk(tree, (node) => node.type === "GpsLocationPicker").props.location.latitude, "4.5");
  await detect.props.onPress();
  tree = h.render();
  const picker = h.walk(tree, (node) => node.type === "GpsLocationPicker");
  assert.ok(picker);
  assert.equal(picker.props.location.latitude, "4.6");
  assert.equal(picker.props.location.accuracy_m, "6.78");
  picker.props.onChange({ latitude: "4.700000", longitude: "113.900000", accuracy_m: "" });
  tree = h.render();
  for (const value of ["4.700000", "113.900000", "25.34"])
    assert.ok(h.walk(tree, (node) => node.type === "TextInput" && node.props.value === value));
  const freeQr = h.walk(tree, (node) => node.type === "TouchableOpacity" && h.text(node).includes("QR-0003"));
  assert.ok(freeQr && !freeQr.props.disabled);
  freeQr.props.onPress();
  const button = h.walk(h.render(), (node) => node.type === "TouchableOpacity" && h.text(node) === "recordEdits.submitChanges");
  button.props.onPress(); await h.alert[2][1].onPress();
  const sent = h.calls.find(([path]) => path === "/record-changes");
  assert.equal(sent[1].body.proposed.qr_id, 3);
  assert.equal(sent[1].body.proposed.content.latitude, 4.7);
  assert.equal(sent[1].body.proposed.content.altitudeM, 25.34);
  assert.equal(sent[1].body.proposed.content.accuracy_m, null, "manual map placement clears stale measured accuracy");
});

test("denied GPS permission leaves an unlocated plant form unchanged", async () => {
  const record = plant("Approved");
  delete record.registration.latitude; delete record.registration.longitude;
  delete record.latestObservation.content.latitude; delete record.latestObservation.content.longitude;
  delete record.observations[0].content.latitude; delete record.observations[0].content.longitude;
  const h = harness("screens/EditPlantRecord.js", { record, locationDenied: true });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  const tree = h.render();
  const detect = h.walk(tree, (node) => node.type === "TouchableOpacity" && h.text(node) === "addPlant.getCurrentLocation");
  await detect.props.onPress();
  assert.equal(h.alert[0], "addPlant.locationError");
  assert.equal(h.alert[1], "gpsPicker.permissionDenied");
  assert.equal(h.walk(h.render(), (node) => node.type === "GpsLocationPicker"), null);
  for (const field of ["latitude", "longitude", "altitudeM", "accuracy_m"]) {
    const input = h.walk(h.render(), (node) => node.type === "TextInput" && node.props.accessibilityLabel?.startsWith(`recordEdits.${field}`));
    assert.ok(input, `${field} is still manually editable after permission denial`);
    assert.equal(input.props.value, "");
  }
});

test("Plant editing and correction retain measurements during manual coordinate entry", async () => {
  for (const status of ["Approved", "Correction Required"]) {
    const record = plant(status);
    if (record.registration) { record.registration.accuracy_m = 6; record.registration.altitudeM = 0; }
    for (const observation of [record.latestObservation, ...record.observations]) {
      observation.content.accuracy_m = 6; observation.content.altitudeM = 0;
    }
    const h = harness("screens/EditPlantRecord.js", { record, correction: status === "Correction Required" });
    h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
    let tree = h.render();
    const input = (field) => h.walk(tree, (node) => node.type === "TextInput" && node.props.accessibilityLabel?.startsWith(`recordEdits.${field}`));
    assert.equal(input("accuracy_m").props.value, "6"); assert.equal(input("altitudeM").props.value, "0");
    input("latitude").props.onChangeText("-"); tree = h.render();
    assert.equal(h.walk(tree, (node) => node.type === "GpsLocationPicker"), null);
    assert.equal(input("latitude").props.value, "-");
    input("latitude").props.onChangeText("0"); tree = h.render();
    assert.ok(h.walk(tree, (node) => node.type === "GpsLocationPicker"));
    assert.equal(input("accuracy_m").props.value, "6"); assert.equal(input("altitudeM").props.value, "0");
  }
});

test("plant editor reuses originals, removes one only from the selection, and mixes a camera photo", async () => {
  const h = harness("screens/EditPlantRecord.js", { record: plant("Approved") });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  let tree = h.render();
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
  for (const index of [2, 1, 0].filter((photoIndex) => !indexes.includes(photoIndex))) {
    const remove = h.collect(h.render(), (node) => node.type === "TouchableOpacity" && node.props.accessibilityLabel === "recordEdits.removePhoto")[index];
    remove.props.onPress();
  }
  let tree;
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

test("original photos are read-only and updated photos retain originals until removed or restored", async () => {
  const h = harness("screens/EditPlantRecord.js", { record: plant("Approved") });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  let tree = h.render();
  const images = h.collect(tree, (node) => node.type === "Image" && node.props.source?.uri?.includes("existing-"));
  assert.equal(images.length, 6, "all three source photos appear read-only and in the proposed collection");
  assert.equal(h.collect(tree, (node) => node.type === "TouchableOpacity" && node.props.accessibilityRole === "checkbox").length, 0);
  const remove = h.collect(tree, (node) => node.type === "TouchableOpacity" && node.props.accessibilityLabel === "recordEdits.removePhoto");
  assert.equal(remove.length, 3);
  remove[1].props.onPress();
  tree = h.render();
  assert.equal(h.collect(tree, (node) => node.type === "TouchableOpacity" && node.props.accessibilityLabel === "recordEdits.removePhoto").length, 2);
  const restore = h.collect(tree, (node) => node.type === "TouchableOpacity" && node.props.accessibilityRole === "button" && node.props.accessibilityLabel?.startsWith("recordEdits.originalPhoto"));
  assert.equal(restore.length, 1);
  restore[0].props.onPress();
  assert.equal(h.collect(h.render(), (node) => node.type === "TouchableOpacity" && node.props.accessibilityLabel === "recordEdits.removePhoto").length, 3);
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
  const remove = h.collect(h.render(), (node) => node.type === "TouchableOpacity" && node.props.accessibilityLabel === "recordEdits.removePhoto");
  remove.slice(1).forEach((photo) => photo.props.onPress());
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


test("species conflict retains text and photo until explicit reload and latest-version inspection", async () => {
  const record = { ...request("Pending Review"), editConflict: true };
  const h = harness("screens/EditSpeciesRequest.js", { record, species: true });
  h.render(); h.focus(); await new Promise(resolve => setImmediate(resolve));
  let tree = h.render();
  const textField = h.walk(tree, node => node.type === 'TextInput' && node.props.value === 'Species A');
  textField.props.onChangeText('Unsaved proposal');
  await h.walk(h.render(), node => node.props?.accessibilityLabel === 'recordEdits.addGallery').props.onPress();
  const submit = () => h.walk(h.render(), node => node.type === 'TouchableOpacity' && h.text(node) === 'recordEdits.submitChanges');
  submit().props.onPress(); await h.alert[2][1].onPress();
  assert.ok(h.walk(h.render(), node => node.type === 'TextInput' && node.props.value === 'Unsaved proposal'));
  assert.equal(submit().props.disabled, true);
  assert.ok(h.walk(h.render(), node => node.props?.accessibilityRole === 'alert'));
  assert.ok(h.walk(h.render(), node => node.type === 'Image' && node.props.source?.uri === 'file://gallery.jpg'));
  assert.equal(h.calls.find(([path]) => path === '/my-species-requests/1')[1].body.expected_revision, 1);
  record.content_revision = 2; record.scientific_name = 'Latest content';
  record.failReload = true;
  const reload = h.walk(h.render(), node => node.type === 'TouchableOpacity' && h.text(node) === 'recordEdits.reloadLatest');
  reload.props.onPress(); await h.alert[2][1].onPress();
  assert.equal(h.alert[1], 'recordEdits.latestLoadFailed');
  assert.equal(submit().props.disabled, true);
  assert.ok(h.walk(h.render(), node => node.type === 'TextInput' && node.props.value === 'Unsaved proposal'));
  record.failReload = false;
  reload.props.onPress(); await h.alert[2][1].onPress();
  assert.ok(h.walk(h.render(), node => node.type === 'TextInput' && node.props.value === 'Latest content'));
  assert.equal(submit().props.disabled, true);
  h.walk(h.render(), node => node.type === 'TouchableOpacity' && h.text(node) === 'recordEdits.acknowledgeLatest').props.onPress();
  submit().props.onPress(); await h.alert[2][1].onPress();
  const saved = h.calls.filter(([path]) => path === '/my-species-requests/1').at(-1);
  assert.equal(saved[1].body.expected_revision, 2);
});


test('deep linked final species and plant records show a read-only outcome without save actions',async()=>{
 for(const species of [false,true]){
  const h=harness(species?'screens/EditSpeciesRequest.js':'screens/EditPlantRecord.js',{record:species?request('Rejected'):plant('Rejected'),species});
  h.render();h.focus();await new Promise(resolve=>setImmediate(resolve));
  const tree=h.render();assert.ok(h.text(tree).includes('recordEdits.finalRejected'));
  assert.equal(h.walk(tree,node=>node.type==='TouchableOpacity'&&h.text(node)==='recordEdits.submitChanges'),null);
  assert.equal(h.calls.filter(([,options])=>['PATCH','POST'].includes(options?.method)).length,0);
  assert.equal(h.photoReads,0);
 }
});


test('a rejected subsequent observation does not block approved plant change proposals',async()=>{
 const record=plant('Approved');record.latestObservation={...record.latestObservation,status:'Rejected'};
 const h=harness('screens/EditPlantRecord.js',{record});h.render();h.focus();await new Promise(resolve=>setImmediate(resolve));
 const submit=h.walk(h.render(),node=>node.type==='TouchableOpacity'&&h.text(node)==='recordEdits.submitChanges');assert.ok(submit);
 submit.props.onPress();await h.alert[2][1].onPress();assert.ok(h.calls.some(([path])=>path==='/record-changes'));
});

for (const species of [false,true]) for (const acknowledgement of [{}, {change:{}}, {change:{id:'bad/path',status:'Pending Review'}}, {change:{id:'change-12',status:'Approved'}}]) {
  test(`malformed approved ${species?'species':'plant'} receipt preserves form and never reports submitted: ${JSON.stringify(acknowledgement)}`,async()=>{
    const h=harness(species?'screens/EditSpeciesRequest.js':'screens/EditPlantRecord.js',{record:species?request('Approved'):plant('Approved'),species,acknowledgement});
    h.render();h.focus();await new Promise(resolve=>setImmediate(resolve));
    if (species) h.walk(h.render(),node=>node.type==='TextInput'&&node.props.value==='Original').props.onChangeText('Updated');
    const tree=h.render(),button=h.walk(tree,node=>node.type==='TouchableOpacity'&&h.text(node)==='recordEdits.submitChanges');
    button.props.onPress();await h.alert[2][1].onPress();
    assert.notEqual(h.alert[0],'recordEdits.savedTitle');assert.equal(h.navigations.length,0);
    assert.ok(h.walk(h.render(),node=>node.type==='TextInput'&&Boolean(node.props.value)));
  });
}


test("approved Plant edit prefills registration A rather than newer Observation B", async () => {
  const record = plant("Approved");
  record.registration.heightCm = 30;
  record.observations.unshift({ id:"visit-B",status:"Approved",revision:4,
    content:{heightCm:10,healthStatus:"Poor",lifeStage:"Seedling",latitude:37,longitude:-122},assets:[] });
  record.latestObservation = record.observations[0];
  const h = harness("screens/EditPlantRecord.js", { record });
  h.render(); h.focus(); await new Promise(resolve => setImmediate(resolve));
  const input = name => h.walk(h.render(), node => node.type === "TextInput" && node.props.accessibilityLabel?.startsWith(`recordEdits.${name}`));
  assert.ok(h.walk(h.render(), node => node.type === "TextInput" && node.props.value === "30"));
  assert.ok(h.walk(h.render(), node => node.type === "TextInput" && node.props.value === "Mature"));
  assert.equal(input("latitude").props.value,"4.5");
  assert.equal(input("longitude").props.value,"113.7");
});
