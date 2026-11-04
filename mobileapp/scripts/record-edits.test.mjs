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
    assert.ok(name in dependencies, `Missing mock: ${name}`);
    return { ...dependencies[name], __esModule: name !== "react" };
  }, module, module.exports);
  return module.exports.default;
}
function harness(file, { record, approved, species = false, locationDenied = false }) {
  let stateIndex = 0, refIndex = 0, states = [], refs = [], focus, alert, calls = [];
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
    if (path === "/record-changes/capabilities") return { approved_edits_available: true };
    if (path === "/qr-codes") return { qr_codes: [{ qr_id: 2, qr_code: "current-token", plant_id: 8, status: "assigned" },
      { qr_id: 3, qr_code: "free-token", plant_id: null, status: "generated" }] };
    return {};
  };
  const deps = { react: hooks, "react-native": native,
    "@react-navigation/native": { useFocusEffect: (fn) => { focus = fn; } },
    "expo-image-picker": { requestCameraPermissionsAsync: async () => ({ granted: true }), requestMediaLibraryPermissionsAsync: async () => ({ granted: true }),
      launchCameraAsync: async () => ({ canceled: false, assets: [{ uri: "file://camera.jpg" }] }),
      launchImageLibraryAsync: async () => ({ canceled: false, assets: [{ uri: "file://gallery.jpg" }] }) },
    "expo-location": { Accuracy: { High: 4 }, requestForegroundPermissionsAsync: async () => ({ status: locationDenied ? "denied" : "granted" }),
      getCurrentPositionAsync: async () => ({ coords: { latitude: 4.6, longitude: 113.8, altitude: 25.34, accuracy: 6.78 } }) },
    "expo-file-system/legacy": { readAsStringAsync: async () => "aGVsbG8=", EncodingType: { Base64: "base64" } },
    "@expo/vector-icons": { Ionicons: "Ionicons" },
    "../utils/qrInventory": { normalizeQRCodes: (payload) => payload.qr_codes.map((qr) => ({ id: String(qr.qr_id), label: `QR-${String(qr.qr_id).padStart(4, "0")}`, plantId: qr.plant_id == null ? null : String(qr.plant_id), status: qr.status })) },
    "../utils/botanistRecords": species ? { fetchBotanistSpeciesRequest: async () => record }
      : { fetchBotanistPlant: async () => record },
    "../utils/plantApi": species ? { plantApi: api } : { plantApi: api, fetchSpeciesCatalog: async () => [{ id: "6", scientificName: "Species name", commonName: "Common name" }] },
    "../translations/i18n": { useAppTranslation() {}, t: (key) => key, translateUIMessage: (value) => value },
  };
  const component = screen(file, deps);
  const route = { params: { botanist: { id: "owner" }, ...(species ? { requestId: "1" } : { plantId: "8" }) } };
  const navigation = { goBack() {} };
  const render = () => { stateIndex = 0; refIndex = 0; return component({ route, navigation }); };
  function walk(node, predicate) {
    if (!node || typeof node !== "object") return null;
    if (predicate(node)) return node;
    for (const child of React.Children.toArray(node.props?.children)) { const found = walk(child, predicate); if (found) return found; }
    return null;
  }
  const text = (node) => typeof node === "string" ? node : React.Children.toArray(node?.props?.children).map(text).join(" ");
  return { render, walk, text, get focus() { return focus; }, get alert() { return alert; }, calls };
}
const plant = (status) => ({ id: "8", speciesId: "6", scientificName: "Manual plant name", status, qrId: "2", qrCode: "QR-0002",
  latestObservation: { revision: 1, assets: [{ id: "photo-1" }, { id: "photo-2" }, { id: "photo-3" }], content: { heightCm: 20, healthStatus: "Healthy", lifeStage: "Mature", morphology: "Leaves", notes: "", latitude: 4.5, longitude: 113.7 } },
  observations: [{ status: "Approved", content: { heightCm: 20, healthStatus: "Healthy", lifeStage: "Mature", morphology: "Leaves", notes: "", latitude: 4.5, longitude: 113.7 } }],
  photos: [1, 2, 3].map((index) => ({ uri: `https://example.invalid/existing-${index}` })) });
const request = (status) => ({ request_id: 1, request_status: status, scientific_name: "Species A", common_name: "Common A",
  genus_name: "Genus A", family_name: "Family A", conservation_status: "Least Concern", description: "Original", habitat: "Forest",
  photo: { uri: "https://example.invalid/species" } });

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
    if (!approved) assert.equal(saved[1].body.expected_revision, 1);
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
  });
}

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

test("plant editor removes one existing image, adds a camera photo and keeps the other IDs", async () => {
  const h = harness("screens/EditPlantRecord.js", { record: plant("Approved") });
  h.render(); h.focus(); await new Promise((resolve) => setImmediate(resolve));
  let tree = h.render();
  const remove = h.walk(tree, (node) => node.type === "TouchableOpacity" && node.props.accessibilityLabel === "recordEdits.removePhoto");
  remove.props.onPress(); h.alert[2][1].onPress();
  tree = h.render();
  const camera = h.walk(tree, (node) => node.type === "TouchableOpacity" && h.text(node) === "recordEdits.takePhoto");
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
  const gallery = h.walk(tree, (node) => node.type === "TouchableOpacity" && h.text(node) === "recordEdits.addGallery");
  await gallery.props.onPress();
  const updated = h.render();
  assert.ok(h.walk(updated, (node) => node.type === "Image" && node.props.source?.uri === "file://gallery.jpg"));
  assert.ok(h.walk(updated, (node) => node.type === "Image" && node.props.source?.uri?.includes("existing-1")));
});

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
  const render = () => { index = 0; return component({ route: { params: { kind: "plant", targetId: "8", botanist: { id: "owner" } } }, navigation: { goBack() {} } }); };
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
  const back = visit(detail, (node) => node.type === "TouchableOpacity" && text(node).includes("recordEdits.backToRecord"));
  back.props.onPress();
  const earlier = visit(render(), (node) => node.type === "TouchableOpacity" && text(node).includes("recordEdits.priorProposal"));
  assert.ok(earlier); earlier.props.onPress();
  assert.match(text(render()), /Older plant\s*→\s*Older proposal/);
});
