import { validGpsPoint, readGpsLocation } from "../utils/gpsLocation.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { validateSpeciesRequest, validatePlantDetails, validatePlantGps } from "../utils/addPlantValidation.js";
import { normalizeSpeciesName } from "../utils/speciesNameNormalization.js";
import { createLocalization, createDisplayTranslator } from "../translations/core.js";
const require = createRequire(import.meta.url), React = require("react"), ts = require("typescript");
const en = JSON.parse(readFileSync(new URL("../translations/en.json", import.meta.url), "utf8"));
const ms = JSON.parse(readFileSync(new URL("../translations/ms.json", import.meta.url), "utf8"));
const zh = JSON.parse(readFileSync(new URL("../translations/zh.json", import.meta.url), "utf8"));
const source = readFileSync(new URL("../screens/AddPlant.js", import.meta.url), "utf8");
const stateNames = [...source.slice(source.indexOf("export function AddPlantForm(")).matchAll(/\[(\w+)(?:,\s*(\w+))?\]\s*=\s*useState/g)].map((m) => [m[1], m[2]]);
const code = ts.transpileModule(source, { fileName: "AddPlant.jsx", compilerOptions: {
  jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022,
} }).outputText;
const species = { id: "7", name: "Swamp pitcher plant", scientificName: "Nepenthes mirabilis", family: "Nepenthaceae" };
const proposal = { scientific_name: "Nepenthes rafflesiana", common_name: "Raffles pitcher plant", genus_name: "Nepenthes", family_name: "Nepenthaceae", conservation_status: "Least Concern", description: "Climbing pitcher plant", habitat: "Lowland forest", photoUri: "file:///species.png" };
test("Add Plant distinguishes required species and plant names in all supported languages", async () => {
  const labels = {
    en: ["Species Scientific Name *", "Species Common Name *", "Plant Scientific Name *"],
    ms: ["Nama Saintifik Spesies *", "Nama Biasa Spesies *", "Nama Saintifik Tumbuhan *"],
    zh: ["物种学名 *", "物种俗名 *", "植株学名 *"],
  };
  for (const [language, expected] of Object.entries(labels)) {
    const app = await fixture(language, { showSpeciesForm: true });
    for (const label of expected) assert.ok(app.text().includes(label), `${language}: ${label}`);
  }
});
test("Add Plant marks QR as required and Location Zone as optional in all languages", async () => {
  for (const [language, zone] of Object.entries({ en: "Location (Zone)", ms: "Lokasi (Zon)", zh: "位置区域" })) {
    const app = await fixture(language);
    const text = app.text();
    assert.match(text, new RegExp(`${app.t("navigation.plantQrCode")}\\s+\\*`), `${language}: required QR`);
    assert.ok(text.includes(zone), `${language}: zone label`);
    assert.ok(!text.includes(`${zone} *`), `${language}: optional zone`);
  }
});

test("all GPS inputs stay editable before and after capture, map movement, and a failed refresh", async () => {
  for (const language of ["en", "ms", "zh"]) {
    const app = await fixture(language, { plantScientificName: "Saved plant", gpsSamples: [
      { latitude: 0, longitude: 110.123456789, altitude: null, accuracy: null },
      { latitude: 1.55, longitude: 110.35, altitude: 20, accuracy: 5 }, new Error("GPS unavailable"),
    ] });
    for (const key of ["latitude", "longitude", "altitudeM", "gpsAccuracyM"]) {
      assert.ok(app.text().includes(app.t(`addPlant.${key}`)));
      const input = app.byLabel(`addPlant.${key}`);
      assert.equal(input.type, "TextInput"); assert.equal(input.props.value, "");
      assert.notEqual(input.props.editable, false);
    }
    assert.equal(app.find((node) => node?.type === "GpsLocationPicker"), undefined);
    await app.press("addPlant.getCurrentLocation");
    assert.equal(app.state.latitude, "0"); assert.equal(app.state.longitude, "110.123456789");
    assert.equal(app.state.altitude, ""); assert.equal(app.state.gpsAccuracy, "");
    const map = app.find((node) => node?.type === "GpsLocationPicker"); assert.ok(map);
    assert.ok(app.byLabel("addPlant.latitude"));
    await app.press("addPlant.getCurrentLocation");
    assert.equal(app.state.latitude, "1.55"); assert.equal(app.state.gpsAccuracy, "5");
    app.find((node) => node?.type === "GpsLocationPicker").props.onChange({ latitude: "1.56", longitude: "110.36", accuracy_m: "" }); app.render();
    assert.equal(app.state.latitude, "1.56"); assert.equal(app.state.longitude, "110.36");
    assert.equal(app.state.gpsAccuracy, ""); assert.equal(app.state.altitude, "20");
    await app.press("addPlant.getCurrentLocation");
    assert.equal(app.state.latitude, "1.56"); assert.equal(app.state.altitude, "20");
    assert.equal(app.state.plantScientificName, "Saved plant"); assert.ok(app.alerts.length);
  }
});

test("manual GPS entry initializes the map without permission and preserves other manually entered measurements", async () => {
  const app = await fixture("en");
  app.fill("setAltitude", "0"); app.fill("setGpsAccuracy", "9");
  app.fill("setLatitude", "-"); app.fill("setLongitude", "110.35");
  assert.equal(app.find((node) => node?.type === "GpsLocationPicker"), undefined);
  app.fill("setLatitude", "0");
  assert.ok(app.find((node) => node?.type === "GpsLocationPicker"));
  assert.equal(app.state.gpsAccuracy, "9"); assert.equal(app.state.altitude, "0");
  app.byLabel("addPlant.latitude").props.onFocus(); app.render();
  assert.equal(app.find((node) => node?.type === "GpsLocationPicker").props.inputActive, true);
  app.fill("setLatitude", "");
  assert.equal(app.find((node) => node?.type === "GpsLocationPicker"), undefined);
  assert.equal(app.byLabel("addPlant.latitude").props.value, "");
});
test("species scientific-name normalization handles case, whitespace and Unicode canonical forms", () => {
  const forms = ["Agave sisalana", "agave sisalana", "AGAVE SISALANA", " Agave  sisalana ", "Agave\u00a0sisalana"];
  assert.ok(forms.every((name) => normalizeSpeciesName(name) === normalizeSpeciesName(forms[0])));
  assert.notEqual(normalizeSpeciesName("Agave sisalana L."), normalizeSpeciesName("Agave sisalana"));
});
async function fixture(language = "en", initial = {}, api) {
  const app = createLocalization({ resources: { en: { translation: en }, ms: { translation: ms }, zh: { translation: zh } }, storage: { getItem: async () => null, setItem: async () => {} } });
  await app.changeLanguage(language);
  const display = createDisplayTranslator(app.i18n, en), t = (key, values) => app.i18n.t(key, values);
  const state = { speciesCatalog: [species], loadingSpeciesCatalog: false, recoveryResolved: true, ...initial }, refs = [], alerts = [], network = [], qrChecks = [], speciesReads = [], effects = [], navigationCalls = [], savedDrafts = [];
  let stateIndex, refIndex, tree, focusEffect;
  const hooks = { ...React, useId: () => "workflow-form", useCallback: (fn) => fn, useState: (value) => {
    const [key, setterName] = stateNames[stateIndex++];
    if (!(key in state)) state[key] = typeof value === "function" ? value() : value;
    const setter = (next) => { state[key] = typeof next === "function" ? next(state[key]) : next; };
    Object.defineProperty(setter, "name", { value: setterName }); return [state[key], setter];
  }, useRef: (value) => refs[refIndex++] ||= { current: value }, useEffect: (fn) => effects.push(fn) };
  const native = { StyleSheet: { create: (v) => v }, Alert: { alert: (...args) => alerts.push(args) },
    useWindowDimensions: () => ({ height: initial.screenHeight ?? 900, width: initial.screenWidth ?? 400 }) };
  for (const name of ["View", "Text", "TextInput", "TouchableOpacity", "ScrollView", "ActivityIndicator", "Image"]) native[name] = name;
  const deps = { react: hooks, "react-native": native, "@react-navigation/native": { useFocusEffect: (fn) => { focusEffect = fn; } },
    "../translations/i18n": { useAppTranslation: () => {}, t, translateLabel: display.label, translateUIMessage: display.message },
    "../utils/addPlantValidation": { validateSpeciesRequest, validatePlantDetails, validatePlantGps },
    "../utils/speciesNameNormalization": { normalizeSpeciesName },
    "../utils/botanistFormDrafts": { hasMeaningfulAddPlantDraft: () => true, deleteBotanistFormDraft: async () => true,
      saveBotanistFormDraft: async (_owner, draft) => { savedDrafts.push(structuredClone(draft)); return { ...draft, saved_at: "saved" }; } },
    "../utils/botanistDraftAutosave": { useBotanistDraftAutosave: () => ({ stop: async () => {}, flush: async () => {}, retry: async () => {} }), stopBotanistDraftAutosave: async () => {} },
    "expo-location": { Accuracy: { High: 4 }, requestForegroundPermissionsAsync: async () => ({ status: "granted" }),
      getCurrentPositionAsync: async () => { const sample = initial.gpsSamples?.shift() ?? { latitude: 4.5, longitude: 113.7, altitude: null, accuracy: null };
        if (sample instanceof Error) throw sample; return { coords: sample }; } }, "expo-image-picker": { requestMediaLibraryPermissionsAsync: async () => ({ status: "granted" }), launchImageLibraryAsync: async () => ({ canceled: false, assets: [{ uri: proposal.photoUri }] }) },
    "expo-file-system/legacy": { EncodingType: { Base64: "base64" }, readAsStringAsync: async () => "cGhvdG8=" },
    "react-native-qrcode-svg": { default: "QRCode" }, "@expo/vector-icons/Ionicons": { default: "Icon" }, "../components/QRRefreshButton": { default: "QRRefreshButton" }, "../components/RefreshButton": { default: "RefreshButton" }, "../components/GpsLocationPicker": { default: "GpsLocationPicker" }, "../utils/gpsLocation": { validGpsPoint, readGpsLocation },
    "../components/SpeciesDictionary": { default: "SpeciesDictionary" },
    "../components/fieldFormStyles": { fieldFormStyles: native.StyleSheet.create({ ...Object.fromEntries(["container", "scrollView", "scrollContent", "card", "sectionTitle", "label", "input", "textArea", "locationButton", "locationButtonText", "photoButtonRow", "photoButton", "photoButtonText", "submitButton", "submitButtonText"].map((key) => [key, {}])), qrRefreshButton: { minHeight: 48 }, qrRefreshText: {} }) },
    "../utils/plantApi": { fetchSpeciesCatalog: async (options) => { speciesReads.push(options); return initial.catalogSpecies || [species]; },
      fetchSpeciesDetail: async () => initial.speciesDetail || species, plantApi: async (...args) => {
      if (String(args[0]).startsWith("/qr-codes?qr_id=")) { qrChecks.push(args); return { qr_codes: state.selectedQRCode ? [{
        ...state.selectedQRCode, status: "generated", plant_id: null,
      }] : [] }; }
      network.push(args);
      if (api) return api(...args);
      if (String(args[0]).startsWith("/species-requests?scope=mine-active")) return { species_requests: initial.speciesRequests || [] };
      if (args[0] === "/species-requests") return { species_request: { request_id: 12, request_status: "Pending Review" } };
      if (args[0] === "/plant-submissions") return { plant_id: 42, id: "observation-42", qr_token: "unchanged-qr-token" };
      if (args[0].endsWith("/qr")) return { qr_token: "unchanged-qr-token" }; return {};
    } },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", code)((name) => {
    assert.ok(name in deps, name); return { ...deps[name], __esModule: name !== "react" };
  }, module, module.exports);
  const render = () => { stateIndex = 0; refIndex = 0; effects.length = 0; tree = module.exports.AddPlantForm({ onSubmitted() {}, onStartNew() {}, route: { params: { botanist: { id: "bot", name: "Aina" } } }, navigation: { goBack: () => {}, setParams() {}, navigate: (...args) => navigationCalls.push(args) } }); };
  const children = (node) => node && typeof node === "object" ? React.Children.toArray(node.props?.children) : [];
  const text = (node) => typeof node === "string" ? node : children(node).map(text).join(" ");
  function find(predicate, node = tree) { if (predicate(node)) return node; for (const child of children(node)) { const found = find(predicate, child); if (found) return found; } }
  async function press(key) { const node = find((n) => n?.type === "TouchableOpacity" && text(n).trim() === t(key)); assert.ok(node, key); assert.ok(!node.props.disabled, key); await node.props.onPress(); render(); }
  function fill(setter, value) {
    const node = find((n) => n?.type === "TextInput" && n.props.onChangeText?.name === setter); assert.ok(node, setter); node.props.onChangeText(value); render();
  }
  const byLabel = (key) => find((n) => n?.props?.accessibilityLabel === t(key) || (n?.type === "RefreshButton" && n.props.label === t(key)));
  render(); return { state, alerts, network, qrChecks, speciesReads, navigationCalls, savedDrafts, render, find, text: () => text(tree), textOf: text, t, press, fill, byLabel,
    startDuplicateCheck() { const check = effects.find((effect) => effect.toString().includes("normalizeSpeciesName")); assert.equal(typeof check, "function"); return check(); },
    async checkDuplicate() { this.startDuplicateCheck(); await new Promise((resolve) => setTimeout(resolve, 525)); render(); },
    async focus() { focusEffect(); await new Promise((resolve) => setImmediate(resolve)); render(); } };
}
test("Add Plant refreshes the database species list with the signed-in botanist account", async () => {
  const app = await fixture("en", { speciesCatalog: [], loadingSpeciesCatalog: true });
  await app.focus();
  assert.deepEqual(app.speciesReads, [{ accountId: "bot" }]);
  assert.equal(app.state.speciesCatalog[0].id, "7");
  assert.equal(app.state.loadingSpeciesCatalog, false);
  assert.match(app.text(), /Nepenthes mirabilis/);
  assert.ok(app.byLabel("addPlantWorkflow.refreshSpecies"));
});
test("legacy species adapters preserve separate scientific and common names and reject plant lists as species", async () => {
  const source = readFileSync(new URL("../utils/plantApi.js", import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "").replace(/export /g, "");
  let payload = { species: [{ species_id: 7, scientific_name: species.scientificName, common_name: species.name }] };
  const context = vm.createContext({ mobileApiUrl: () => "https://example.invalid", faceSession: { hasSession: () => false }, fetch: async () => ({ ok: true, json: async () => payload }) });
  vm.runInContext(source, context);
  const [record] = await vm.runInContext("fetchSpeciesCatalog()", context);
  assert.equal(record.id, "7"); assert.equal(record.scientificName, species.scientificName);
  assert.equal(record.commonName, species.name); assert.equal(record.name, species.name);
  payload = { species: [{ id: 8, scientificName: species.scientificName, commonName: species.name }] };
  const [legacy] = await vm.runInContext("fetchSpeciesCatalog()", context);
  assert.equal(legacy.commonName, species.name); assert.equal(legacy.scientificName, species.scientificName);
  payload = { plants: [{ plant_id: 1, species_id: 7 }] };
  await assert.rejects(vm.runInContext("fetchSpeciesCatalog()", context), /unexpected list response/);
});
test("plant mapping preserves the entered plant name and never substitutes the species name", async () => {
  const source = readFileSync(new URL("../utils/plantApi.js", import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "").replace(/export /g, "");
  const context = vm.createContext({ mobileApiUrl: () => "https://example.invalid", faceSession: { hasSession: () => false },
    fetch: async () => ({ ok: true, json: async () => ({ plants: [
      { plant_id: 1, species_id: 7, scientific_name: "Manual plant name" },
      { plant_id: 2, species_id: 7, scientific_name: null },
    ] }) }) });
  vm.runInContext(source, context);
  context.catalog = [species];
  const records = await vm.runInContext("fetchPlantRecords(catalog)", context);
  assert.equal(records[0].scientificName, "Manual plant name");
  assert.equal(records[0].species.scientificName, species.scientificName);
  assert.equal(records[1].scientificName, "");
});

const plantValues = { selectedQRCode: { qr_id: 17, qr_code: "test-qr-17" }, guidedPhotos: { wholePlant: "whole.jpg", leafCloseUp: "leaf.jpg", stemBark: "stem.jpg", flowerFruit: null } };
function fillPlant(app) {
  for (const [setter, value] of [["setPlantScientificName", "Manual plant name"], ["setHeight", "80"], ["setGrowthStage", "Juvenile"], ["setMorphology", "Plant morphology"], ["setLatitude", "4.5"], ["setLongitude", "113.7"]]) app.fill(setter, value);
}
function fillSpecies(app) {
  for (const [setter, key] of [["setSpeciesScientificName", "scientific_name"], ["setSpeciesCommonName", "common_name"], ["setSpeciesGenus", "genus_name"], ["setSpeciesFamily", "family_name"], ["setSpeciesDescription", "description"], ["setSpeciesHabitat", "habitat"]]) app.fill(setter, proposal[key]);
}
test("mode-aware validators keep manual plant names required without a hidden selector requirement", () => {
  assert.equal(validatePlantDetails({ newSpecies: true, plantScientificName: "Plant", height: "80", healthStatus: "Healthy", growthStage: "Juvenile", morphology: "Leaves" }), null);
  assert.equal(validatePlantDetails({ newSpecies: true, plantScientificName: "", height: "80", healthStatus: "Healthy", growthStage: "Juvenile", morphology: "Leaves" }), "plantScientificNameRequired");
  assert.equal(validatePlantDetails({ plantScientificName: "Plant", height: "80", healthStatus: "Healthy", growthStage: "Juvenile", morphology: "Leaves" }), "chooseExistingSpecies");
  for (const key of Object.keys(proposal)) assert.ok(validateSpeciesRequest({ ...proposal, [key]: "" }), key);
});
test("Add Plant GPS rejects missing, malformed and out-of-range values before submission", () => {
  assert.equal(validatePlantGps("0", 0), null);
  assert.equal(validatePlantGps("-90", "180"), null);
  assert.equal(validatePlantGps("90.0001", "113"), "invalidLatitude");
  assert.equal(validatePlantGps("1", "-180.0001"), "invalidLongitude");
  assert.equal(validatePlantGps("", "113"), "invalidLatitude");
  assert.equal(validatePlantGps("1", "   "), "invalidLongitude");
  assert.equal(validatePlantGps("NaN", "113"), "invalidLatitude");
  assert.equal(validatePlantGps("1", "Infinity"), "invalidLongitude");
  assert.equal(validatePlantGps(true, 113), "invalidLatitude");
  for (const language of [en, ms, zh]) {
    assert.ok(language.addPlantWorkflow.invalidLatitude);
    assert.ok(language.addPlantWorkflow.invalidLongitude);
  }
});
test("existing species picker scrolls a short or long list and selects the last species", async () => {
  for (const count of [2, 24]) {
    const catalog = Array.from({ length: count }, (_, index) => ({
      id: String(index + 1), scientificName: `Species ${index + 1}`, name: `Common ${index + 1}`, family: "Family",
    }));
    const app = await fixture("en", { speciesCatalog: catalog });
    const picker = app.find((node) => node?.type === "ScrollView" && node.props.style?.[1]?.maxHeight === 280);
    assert.ok(picker);
    assert.equal(picker.props.nestedScrollEnabled, true);
    assert.equal(picker.props.keyboardShouldPersistTaps, "always");
    assert.equal(picker.props.style[0].marginRight, 52);
    const options = React.Children.toArray(picker.props.children).flatMap((node) =>
      node?.type === React.Fragment ? React.Children.toArray(node.props.children) : [node])
      .filter((node) => node?.type === "TouchableOpacity");
    assert.equal(options.length, count);
    options.at(-1).props.onPress(); app.render();
    assert.equal(app.state.selectedSpecies.id, String(count));
    assert.equal(app.state.speciesSearch, `Species ${count}`);
    assert.equal(app.state.showSpeciesPicker, false);
    assert.equal(app.find((node) => node?.type === "ScrollView" && node.props.style?.[1]?.maxHeight === 280), undefined);
    assert.ok(app.text().includes(`Species ${count}`));
  }
});
test("species picker stays bounded on a short screen while the parent form remains scrollable", async () => {
  const app = await fixture("en", { screenHeight: 600 });
  const picker = app.find((node) => node?.type === "ScrollView" && node.props.style?.[1]?.maxHeight === 220);
  assert.ok(picker?.props.nestedScrollEnabled);
  assert.ok(app.find((node) => node?.type === "ScrollView" && node !== picker && node.props.keyboardShouldPersistTaps === "handled"));
});
test("approved species remain selectable when pending-request loading fails", async () => {
  const app = await fixture("en", {}, async (path) => {
    if (path === "/species-requests?scope=mine-pending") throw Error("Network unavailable");
    return {};
  });
  await app.focus();
  assert.equal(app.state.speciesCatalog.length, 1);
  assert.equal(app.state.pendingSpeciesError, true);
  assert.ok(app.text().includes(app.t("addPlantWorkflow.pendingUnavailable")));
  assert.ok(app.text().includes("Nepenthes mirabilis"));
});
test("owned pending species appear in the compact picker and submit by request ID", async () => {
  for (const language of ["en", "ms", "zh"]) {
    const pending = { request_id: 44, requested_by: "staff:bot", request_status: "Pending Review",
      scientific_name: "Nepenthes shared", common_name: "Shared pitcher", family_name: "Nepenthaceae" };
    const app = await fixture(language, { ...plantValues }, async (path) => {
      if (path === "/species-requests?scope=mine-pending") return { species_requests: [pending,
        { ...pending, request_id: 45, requested_by: "staff:other" },
        { ...pending, request_id: 46, request_status: "Rejected" }] };
      if (path === "/plant-submissions") return { plant_id: 52, id: "observation-52", qr_token: "qr-52" };
      return {};
    });
    await app.focus();
    assert.equal(app.state.speciesCatalog.length, 2);
    assert.ok(app.text().includes(app.t("addPlantWorkflow.approvedSpecies")));
    assert.ok(app.text().includes(app.t("addPlantWorkflow.myPendingSpeciesRequests")));
    assert.ok(app.text().includes(app.t("common.pendingReview")));
    assert.ok(!app.text().includes("staff:other"));
    const picker = app.find((node) => node?.type === "ScrollView" && node.props.style?.[1]?.maxHeight === 280);
    assert.ok(picker?.props.nestedScrollEnabled);
    app.byLabel("addPlant.searchSpeciesInTheDatabase").props.onChangeText("SWAMP"); app.render();
    assert.ok(app.text().includes("Nepenthes mirabilis"));
    assert.ok(!app.text().includes("Nepenthes shared"));
    app.byLabel("addPlant.searchSpeciesInTheDatabase").props.onChangeText("no-match-plant-species"); app.render();
    assert.ok(app.text().includes(app.t("addPlant.noMatchingSpeciesInTheDatabaseAskAConservationOfficer")));
    app.byLabel("addPlant.searchSpeciesInTheDatabase").props.onChangeText("SHARED"); app.render();
    assert.ok(app.text().includes("Nepenthes shared"));
    const option = app.find((node) => node?.type === "TouchableOpacity" && app.textOf(node).includes("Nepenthes shared"));
    assert.ok(option); option.props.onPress(); app.render();
    assert.equal(app.state.selectedSpecies.requestId, 44);
    fillPlant(app); await app.press("addPlantWorkflow.addPlantRecord");
    const submitted = app.network.find(([path]) => path === "/plant-submissions");
    assert.ok(submitted, JSON.stringify(app.alerts.at(-1)));
    assert.equal(submitted[1].body.species_request_id, 44);
    assert.equal(submitted[1].body.species_id, undefined);
    assert.equal(submitted[1].body.new_species, undefined);
  }
});

test("Plant QR refresh is an icon beside the heading and options scroll above Generate", async () => {
  for (const language of ["en", "ms", "zh"]) {
    for (const count of [0, 1, 4]) {
      const codes = Array.from({ length: count }, (_, index) => ({ qr_id: 22 + index, qr_code: `plant-qr-${index}`, status: "generated", plant_id: null }));
      const app = await fixture(language, { showQRDropdown: true, loadingQRCodes: false, availableQRCodes: codes, screenWidth: language === "zh" ? 900 : 400, screenHeight: language === "zh" ? 1000 : 600 });
      const button = app.find((node) => node?.props?.testID === "add-plant-qr-refresh");
      assert.ok(button);assert.equal(button.type, "TouchableOpacity");
      assert.equal(button.props.accessibilityLabel, app.t("addPlant.refreshQrInventory"));
      assert.equal(button.props.style.width, 44);
      assert.equal(button.props.style.height, 44);
      assert.equal(button.props.style.backgroundColor, "#EDF6F1");
      assert.equal(button.props.disabled, false);
      const heading = app.find((node) => node?.type === "View" && node.props.style?.justifyContent === "space-between" &&
        React.Children.toArray(node.props.children).some((child) => child?.props?.testID === "add-plant-qr-refresh"));
      assert.ok(heading);
      assert.match(app.textOf(heading), new RegExp(`${app.t("navigation.plantQrCode")}\\s+\\*`));
      assert.ok(!app.text().includes(app.t("addPlant.refreshQrInventory")));
      const options = app.find((node) => node?.type === "ScrollView" && node.props.nestedScrollEnabled && node.props.style?.[0]?.flexGrow === 0);
      assert.ok(options);
      assert.ok(options.props.style[1].maxHeight >= 240 && options.props.style[1].maxHeight <= 270);
      assert.equal(app.find((node, parent) => node?.props?.testID === "add-plant-generate-qr") != null, true);
      assert.ok(!app.textOf(options).includes(app.t("addPlantWorkflow.generateQrCode")));
      assert.equal(app.find((node) => node?.type === "QRCode" && node.props.size === 44) != null, count > 0);
      if (count) {
        const option = app.find((node) => node?.type === "TouchableOpacity" && node.props?.style?.paddingVertical === 13);
        assert.ok(option);option.props.onPress();app.render();
        assert.equal(app.state.selectedQRCode.qr_id, 22);
        assert.equal(app.state.showQRDropdown, false);
      }
    }
  }
});

test("Plant QR refresh keeps its loader and reports fetch failure without changing selection", async () => {
  const selected = { qr_id: 22, qr_code: "existing-code", status: "generated", plant_id: null };
  const loading = await fixture("en", { showQRDropdown: true, loadingQRCodes: true, availableQRCodes: [] });
  const busyButton = loading.find((node) => node?.props?.testID === "add-plant-qr-refresh");
  assert.equal(busyButton.props.disabled, true);
  assert.equal(busyButton.props.accessibilityState.busy, true);
  assert.ok(React.Children.toArray(busyButton.props.children).some((node) => node?.type === "ActivityIndicator"));

  const empty = await fixture("en", { showQRDropdown: true, loadingQRCodes: false, availableQRCodes: [] },
    async (path) => path === "/qr-codes" ? { qr_codes: [selected] } : {});
  await empty.find((node) => node?.props?.testID === "add-plant-qr-refresh").props.onPress();empty.render();
  assert.deepEqual(empty.network.map(([path]) => path), ["/qr-codes"]);
  assert.equal(empty.state.availableQRCodes[0].qr_id, 22);
  assert.equal(empty.state.loadingQRCodes, false);

  const failed = await fixture("en", { showQRDropdown: true, loadingQRCodes: false, availableQRCodes: [], selectedQRCode: selected },
    async () => { throw Error("QR service unavailable"); });
  await failed.find((node) => node?.props?.testID === "add-plant-qr-refresh").props.onPress();failed.render();
  assert.equal(failed.state.qrLoadError, "QR service unavailable");
  assert.equal(failed.state.loadingQRCodes, false);
  assert.equal(failed.state.selectedQRCode.qr_id, 22);
  assert.ok(failed.text().includes("QR service unavailable"));
  assert.equal(failed.find((node) => node?.props?.testID === "add-plant-qr-refresh").props.style.width, 44);
});

test("QR refresh stays visible when closed and preserves Plant inputs", async () => {
  const code = { qr_id: 61, qr_code: "unused-61", status: "generated", plant_id: null };
  const app = await fixture("en", { showQRDropdown: false, plantScientificName: "Preserved plant", height: "66", selectedSpecies: species },
    async () => ({ qr_codes: [code] }));
  assert.ok(app.find((node) => node?.props?.testID === "add-plant-qr-refresh"));
  assert.equal(app.find((node) => node?.props?.testID === "add-plant-generate-qr"), undefined);
  await app.find((node) => node?.props?.testID === "add-plant-qr-refresh").props.onPress(); app.render();
  assert.equal(app.state.availableQRCodes[0].qr_id, 61);
  assert.equal(app.state.plantScientificName, "Preserved plant");
  assert.equal(app.state.height, "66");
  assert.equal(app.state.selectedSpecies.id, species.id);
});

test("rapid Refresh taps share one QR inventory request", async () => {
  let release;
  const response = new Promise((resolve) => { release = resolve; });
  const app = await fixture("en", { loadingQRCodes: false }, async () => response);
  const button = app.find((node) => node?.props?.testID === "add-plant-qr-refresh");
  const first = button.props.onPress();
  const second = button.props.onPress();
  assert.equal(app.network.length, 1);
  app.render();
  assert.equal(app.find((node) => node?.props?.testID === "add-plant-qr-refresh").props.disabled, true);
  release({ qr_codes: [{ qr_id: 62, qr_code: "unused-62", status: "generated", plant_id: null }] });
  await Promise.all([first, second]); app.render();
  assert.equal(app.state.availableQRCodes[0].qr_id, 62);
});

test("Add Plant generates one available QR, selects it, and preserves the form in all languages", async () => {
  const generated = { qr_id: 31, qr_code: "new-qr-token", status: "generated", plant_id: null };
  for (const language of ["en", "ms", "zh"]) {
    const app = await fixture(language, { ...plantValues, showQRDropdown: true, loadingQRCodes: false, selectedSpecies: species, plantScientificName: "My plant", height: "81", latitude: "4.5", longitude: "113.7", screenWidth: language === "zh" ? 900 : 400 },
      async (path, options) => path === "/qr-codes" && options?.method === "POST" ? { qr_codes: [generated] }
        : path === "/qr-codes" ? { qr_codes: [generated] } : {});
    const button = app.find((node) => node?.props?.testID === "add-plant-generate-qr");
    assert.ok(button);
    assert.equal(button.props.style[0].alignSelf, "flex-end");
    assert.equal(button.props.style[0].minHeight, 44);
    await button.props.onPress(); app.render();
    assert.deepEqual(app.network.map(([path]) => path), ["/qr-codes", "/qr-codes"]);
    assert.deepEqual(app.network[0][1], { method: "POST", body: { count: 1 }, expectedAccountId: "bot" });
    assert.equal(app.state.selectedQRCode.qr_id, 31);
    assert.equal(app.state.plantScientificName, "My plant");
    assert.equal(app.state.height, "81");
    assert.equal(app.state.latitude, "4.5");
    assert.equal(app.state.longitude, "113.7");
    assert.equal(app.state.selectedSpecies.id, species.id);
    assert.deepEqual(app.state.guidedPhotos, plantValues.guidedPhotos);
    assert.ok(app.text().includes(app.t("addPlantWorkflow.qrGeneratedAndSelected", { id: "QR-0031" })));
    assert.equal(app.navigationCalls.length, 0);
  }
});

test("Add Plant prevents rapid duplicate QR generation and permits retry after failure", async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let posts = 0;
  const app = await fixture("en", { showQRDropdown: true, loadingQRCodes: false }, async (path, options) => {
    if (path === "/qr-codes" && options?.method === "POST") { posts++; return pending; }
    return { qr_codes: [{ qr_id: 41, qr_code: "code-41", status: "generated", plant_id: null }] };
  });
  const button = app.find((node) => node?.props?.testID === "add-plant-generate-qr");
  const first = button.props.onPress();
  await button.props.onPress(); app.render();
  assert.equal(posts, 1);
  assert.equal(app.find((node) => node?.props?.testID === "add-plant-generate-qr").props.disabled, true);
  release({ qr_codes: [{ qr_id: 41, qr_code: "code-41", status: "generated", plant_id: null }] });
  await first; app.render();
  assert.equal(app.state.selectedQRCode.qr_id, 41);

  const failed = await fixture("en", { showQRDropdown: true, loadingQRCodes: false, plantScientificName: "Kept plant" }, async () => { throw Error("Offline"); });
  await failed.find((node) => node?.props?.testID === "add-plant-generate-qr").props.onPress(); failed.render();
  assert.equal(failed.state.plantScientificName, "Kept plant");
  assert.equal(failed.state.qrGenerationFailed, true);
  assert.ok(failed.text().includes("Offline"));
  assert.equal(failed.find((node) => node?.props?.testID === "add-plant-generate-qr").props.disabled, false);
});

test("generated QR stays unused until normal Plant submission assigns its ID", async () => {
  const generated = { qr_id: 51, qr_code: "unused-51", status: "generated", plant_id: null };
  const app = await fixture("en", { ...plantValues, showQRDropdown: true, loadingQRCodes: false, selectedSpecies: species }, async (path, options) => {
    if (path === "/qr-codes" && options?.method === "POST") return { qr_codes: [generated] };
    if (path === "/qr-codes") return { qr_codes: [generated] };
    if (path === "/plant-submissions") return { plant_id: 52, id: "observation-52", qr_token: generated.qr_code };
    return {};
  });
  await app.find((node) => node?.props?.testID === "add-plant-generate-qr").props.onPress(); app.render();
  assert.equal(app.network.some(([path]) => path === "/plant-submissions"), false);
  assert.equal(app.network.some(([path, options]) => options?.method === "DELETE"), false);
  fillPlant(app); await app.press("addPlantWorkflow.addPlantRecord");
  const submission = app.network.find(([path]) => path === "/plant-submissions");
  assert.equal(submission[1].body.qr_id, 51);
});
test("Add Plant blocks invalid GPS locally and accepts numeric zero coordinates", async () => {
  const app = await fixture("en", { ...plantValues, selectedSpecies: species });
  fillPlant(app);
  app.fill("setLatitude", "91");
  await app.press("addPlantWorkflow.addPlantRecord");
  assert.equal(app.alerts.at(-1)[1], app.t("addPlantWorkflow.invalidLatitude"));
  assert.equal(app.network.length, 0);
  app.fill("setLatitude", "0");
  app.fill("setLongitude", "181");
  await app.press("addPlantWorkflow.addPlantRecord");
  assert.equal(app.alerts.at(-1)[1], app.t("addPlantWorkflow.invalidLongitude"));
  assert.equal(app.network.length, 0);
  app.fill("setLongitude", "0");
  await app.press("addPlantWorkflow.addPlantRecord");
  assert.equal(app.network[0][1].body.latitude, 0);
  assert.equal(app.network[0][1].body.longitude, 0);
});
for (const language of ["en", "ms"]) {
  test(`${language}: new mode has no separate submit; Cancel restores selector and preserves independent plant input`, async () => {
    const app = await fixture(language, { ...plantValues, selectedSpecies: species });
    app.fill("setPlantScientificName", "Manual plant name"); app.fill("setHeight", "99");
    await app.press("addPlantWorkflow.requestNewSpecies");
    assert.equal(app.network.length, 0);
    assert.equal(app.byLabel("addPlant.searchSpeciesInTheDatabase"), undefined);
    assert.equal(app.byLabel("addPlantWorkflow.refreshSpecies"), undefined);
    for (const key of ["addPlantWorkflow.selectExistingSpecies", "addPlant.canTFindThisSpecies", "addPlantWorkflow.requestNewSpecies", "addPlantWorkflow.submitSpeciesRequest"]) assert.ok(!app.text().includes(app.t(key)), key);
    assert.equal(app.text().includes(app.t("addPlant.speciesApprovalRequired")), false);
    assert.equal(app.text().includes(app.t("addPlantWorkflow.requestApprovalInfo")), false);
    for (const key of ["scientificName", "commonName", "genus", "family", "conservationStatus", "description", "habitatEcologicalInformation", "speciesPhotos"]) assert.ok(app.text().includes(app.t(`addPlant.${key}`)), key);
    app.fill("setSpeciesScientificName", "Different species name");
    assert.equal(app.byLabel("addPlantWorkflow.plantScientificName").props.value, "Manual plant name");
    assert.ok(app.find((n) => n?.props?.onChangeText?.name === "setHeight"));
    app.byLabel("addPlantWorkflow.cancelSpeciesRequest").props.onPress(); app.render();
    assert.ok(app.byLabel("addPlantWorkflow.refreshSpecies"));
    assert.equal(app.state.height, "99"); assert.equal(app.state.plantScientificName, "Manual plant name");
    assert.equal(app.state.speciesScientificName, "Different species name");
  });
  test(`${language}: existing species bottom action sends one atomic plant submission without new species`, async () => {
    const app = await fixture(language, { ...plantValues, selectedSpecies: species });
    assert.equal(app.byLabel("addPlantWorkflow.plantScientificName").props.value, "");
    await app.press("addPlantWorkflow.addPlantRecord");
    assert.equal(app.alerts.at(-1)[1], app.t("addPlantWorkflow.plantScientificNameRequired"));
    assert.equal(app.network.length, 0);
    fillPlant(app); await app.press("addPlantWorkflow.addPlantRecord");
    assert.equal(app.qrChecks.length, 1);
    assert.equal(app.qrChecks[0][0], "/qr-codes?qr_id=17");
    assert.equal(app.network.length, 1);
    const [path, { body }] = app.network[0];
    assert.equal(path, "/plant-submissions"); assert.equal(body.species_id, 7); assert.equal(body.new_species, undefined);
    assert.equal(body.scientific_name, "Manual plant name"); assert.equal(body.qr_id, 17); assert.equal(body.photos.length, 3);
    assert.equal(app.state.submittedQr.token, "unchanged-qr-token");
  });
  test(`${language}: bottom action validates species and plant together with no existing species selected`, async () => {
    const app = await fixture(language, plantValues);
    await app.press("addPlantWorkflow.requestNewSpecies");
    await app.press("addPlantWorkflow.addPlantRecord"); assert.equal(app.network.length, 0);
    assert.equal(app.alerts.at(-1)[1], app.t("addPlantWorkflow.speciesMissing_scientific_name"));
    fillSpecies(app); await app.press("addPlant.gallery");
    await app.press("addPlantWorkflow.addPlantRecord");
    assert.equal(app.alerts.at(-1)[1], app.t("addPlantWorkflow.plantScientificNameRequired"));
    fillPlant(app); await app.press("addPlantWorkflow.addPlantRecord");
    assert.equal(app.network.length, 1);
    const [path, { body }] = app.network[0];
    assert.equal(path, "/plant-submissions"); assert.equal(body.species_id, undefined);
    assert.equal(body.new_species.scientific_name, proposal.scientific_name); assert.equal(body.new_species.common_name, proposal.common_name);
    assert.equal(body.scientific_name, "Manual plant name"); assert.equal(body.photos.length, 3);
    assert.ok(app.alerts.at(-1)[1].includes(language === "ms" ? "kelulusan" : "approval"));
  });
  test(`${language}: changing species never overwrites manual plant name`, async () => {
    const other = { ...species, id: "8", scientificName: "Other species", name: "Other common name" };
    const app = await fixture(language, { speciesCatalog: [species, other] });
    const choose = (name) => {
      app.byLabel("addPlant.searchSpeciesInTheDatabase").props.onChangeText(""); app.render();
      const option = app.find((n) => n?.type === "TouchableOpacity" && app.textOf(n).includes(name));
      assert.ok(option); option.props.onPress(); app.render();
    };
    choose(species.scientificName); assert.equal(app.state.plantScientificName, "");
    app.fill("setPlantScientificName", "Manual plant name"); choose(other.scientificName);
    assert.equal(app.state.plantScientificName, "Manual plant name");
  });
}
test("duplicate taps are guarded and a failed submission retains inputs/key for safe retry", async () => {
  let fail = true;
  const app = await fixture("en", { ...plantValues, selectedSpecies: species }, async () => {
    if (fail) throw Error("Plant database setup is incomplete. Apply the supplied Add Plant migrations and restart the plant API.");
    return { plant_id: 42, id: "observation-42", qr_token: "unchanged-qr-token" };
  });
  fillPlant(app);
  const submit = app.find((n) => n?.type === "TouchableOpacity" && React.Children.toArray(n.props.children).some((c) => c?.props?.children === app.t("addPlantWorkflow.addPlantRecord")));
  await Promise.all([submit.props.onPress(), submit.props.onPress()]); app.render();
  assert.equal(app.network.length, 1); assert.equal(app.state.plantScientificName, "Manual plant name");
  assert.ok(app.alerts.at(-1)[1].includes("database setup is incomplete"));
  fail = false; await app.press("addPlantWorkflow.addPlantRecord");
  assert.equal(app.network[0][1].body.client_key, app.network[1][1].body.client_key);
  assert.ok(!source.includes("handleAddSpeciesRequest")); assert.ok(!source.includes('t("addPlantWorkflow.submitSpeciesRequest")'));
});

test("debounced approved duplicate offers selection without losing plant fields", async () => {
  const app = await fixture("en", { ...plantValues, showSpeciesForm: true, speciesScientificName: "  NEPENTHES   MIRABILIS  ",
    plantScientificName: "My field record", height: "87", selectedQRCode: { qr_id: 17 },
    guidedPhotos: { wholePlant: "whole.jpg", leafCloseUp: "leaf.jpg", stemBark: "bark.jpg" } });
  await app.checkDuplicate();
  assert.ok(app.text().includes(app.t("addPlantWorkflow.speciesAlreadyExists")));
  assert.ok(app.text().includes(app.t("addPlantWorkflow.selectExistingSpeciesAction")));
  assert.deepEqual(app.network.map(([path]) => path), ["/species-requests?scope=mine-active"]);
  await app.press("addPlantWorkflow.selectExistingSpeciesAction");
  assert.equal(app.state.selectedSpecies.id, "7");
  assert.equal(app.state.selectedSpecies.source, "approved");
  assert.equal(app.state.showSpeciesForm, false);
  assert.equal(app.state.plantScientificName, "My field record");
  assert.equal(app.state.height, "87");
  assert.equal(app.state.selectedQRCode.qr_id, 17);
  assert.equal(app.state.guidedPhotos.wholePlant, "whole.jpg");
});

test("approved duplicate selection is compact and right aligned on phone and tablet", async () => {
  for (const screenWidth of [390, 900]) {
    const app = await fixture("en", { showSpeciesForm: true, speciesScientificName: species.scientificName,
      speciesDuplicate: { type: "approved", species, normalizedName: normalizeSpeciesName(species.scientificName) }, screenWidth });
    const button = app.find((node) => node?.type === "TouchableOpacity" && app.textOf(node).trim() === app.t("addPlantWorkflow.selectExistingSpeciesAction"));
    assert.ok(button);
    assert.equal(button.props.style.alignSelf, "flex-end");
    assert.equal(button.props.style.backgroundColor, "#B7E2C5");
    assert.equal(button.props.style.borderColor, "#468B67");
    assert.equal(button.props.style.minHeight, 44);
    assert.equal(button.props.style.width, undefined);
    assert.ok(app.find((node) => node?.type === "Icon" && node.props.name === "arrow-forward"));
    const warning = app.find((node) => node?.type === "View" && node.props.style?.backgroundColor === "#FFF8E8" &&
      app.textOf(node).includes(app.t("addPlantWorkflow.speciesAlreadyExists")));
    const warningChildren = React.Children.toArray(warning.props.children);
    const info = warningChildren.find((node) => node?.props?.style?.backgroundColor === "#FFFFFF");
    assert.ok(info);
    assert.ok(warningChildren.findIndex((node) => node?.props?.style?.backgroundColor === "#FFFFFF") <
      warningChildren.findIndex((node) => node?.props?.style?.backgroundColor === "#B7E2C5"));
    const infoTop = React.Children.toArray(info.props.children)[0];
    assert.equal(infoTop.props.style.justifyContent, "space-between");
    assert.ok(app.textOf(infoTop).includes(app.t("addPlantWorkflow.approvedBadge")));
    assert.equal(info.props.style.borderRadius, 10);
    const cancel = app.find((node) => node?.type === "TouchableOpacity" && node.props.accessibilityLabel === app.t("addPlantWorkflow.cancelSpeciesRequest"));
    assert.ok(cancel);
    assert.equal(cancel.props.style.minHeight, 48);
  }
});

test("pending duplicate mirrors the approved card on phone and tablet", async () => {
  const request = { request_id: 29, request_status: "Pending Review", requested_by: "staff:bot",
    scientific_name: "Nepenthes mirabilis", common_name: "Pitcher plant" };
  for (const screenWidth of [390, 900]) {
    const app = await fixture("en", { showSpeciesForm: true, speciesScientificName: request.scientific_name,
      speciesDuplicate: { type: "pending", request, normalizedName: normalizeSpeciesName(request.scientific_name) }, screenWidth });
    const warning = app.find((node) => node?.type === "View" && node.props.style?.backgroundColor === "#FFF8E8" &&
      app.textOf(node).includes(app.t("addPlantWorkflow.speciesRequestAlreadyPending")));
    const children = React.Children.toArray(warning.props.children);
    const infoIndex = children.findIndex((node) => node?.props?.style?.backgroundColor === "#FFFFFF");
    const actionIndex = children.findIndex((node) => node?.props?.style?.backgroundColor === "#B7E2C5");
    assert.ok(infoIndex >= 0 && actionIndex > infoIndex);
    const info = children[infoIndex];
    assert.ok(app.textOf(info).includes("Nepenthes mirabilis"));
    assert.ok(app.textOf(info).includes(app.t("addPlantWorkflow.requestReference", { id: 29 })));
    const top = React.Children.toArray(info.props.children)[0];
    const badge = React.Children.toArray(top.props.children)[1];
    assert.equal(badge.props.style.backgroundColor, "#FFF0CC");
    assert.equal(app.textOf(badge), app.t("common.pendingReview"));
    const button = children[actionIndex];
    assert.equal(button.props.style.alignSelf, "flex-end");
    assert.equal(button.props.style.minHeight, 44);
    assert.equal(button.props.style.width, undefined);
    assert.ok(app.find((node) => node?.type === "Icon" && node.props.name === "arrow-forward"));
    const cancel = app.find((node) => node?.type === "TouchableOpacity" && node.props.accessibilityLabel === app.t("addPlantWorkflow.cancelSpeciesRequest"));
    assert.equal(cancel.props.style.minHeight, 48);
  }
});

test("confirmed duplicates block submission, focus the warning, and a new name can proceed", async () => {
  for (const kind of ["approved", "pending", "correction"]) {
    const request = { request_id: 29, request_status: kind === "correction" ? "Correction Required" : "Pending Review",
      requested_by: "staff:bot", scientific_name: "Nepenthes mirabilis" };
    const app = await fixture("en", { ...plantValues, showSpeciesForm: true, speciesScientificName: "Nepenthes mirabilis",
      catalogSpecies: kind === "approved" ? [species] : [], speciesRequests: kind === "approved" ? [] : [request] });
    await app.checkDuplicate();
    const submit = app.find((node) => node?.type === "TouchableOpacity" && app.textOf(node) === app.t("addPlantWorkflow.addPlantRecord"));
    assert.equal(submit.props.accessibilityState.disabled, true);
    await submit.props.onPress();
    assert.equal(app.network.some(([path]) => path === "/plant-submissions"), false);
    assert.equal(app.alerts.at(-1)[0], app.t("addPlantWorkflow.duplicateSubmissionBlocked"));
  }
  const app = await fixture("en", { ...plantValues, showSpeciesForm: true, speciesScientificName: "Nepenthes mirabilis", speciesImages: [proposal.photoUri] });
  await app.checkDuplicate();
  app.fill("setSpeciesScientificName", proposal.scientific_name);
  fillSpecies(app); fillPlant(app);
  await app.checkDuplicate();
  assert.equal(app.state.speciesDuplicate, null);
  await app.press("addPlantWorkflow.addPlantRecord");
  assert.equal(app.network.filter(([path]) => path === "/plant-submissions").length, 1, JSON.stringify(app.alerts));
});

test("confirmed duplicates hide only species fields and retain their values when the name changes", async () => {
  for (const kind of ["approved", "pending", "correction"]) {
    const request = { request_id: 44, request_status: kind === "correction" ? "Correction Required" : "Pending Review",
      requested_by: "staff:bot", scientific_name: species.scientificName };
    const app = await fixture("en", { ...plantValues, showSpeciesForm: true, speciesScientificName: species.scientificName,
      speciesCommonName: "Entered common name", speciesDescription: "Entered description", plantScientificName: "Individual plant",
      catalogSpecies: kind === "approved" ? [species] : [], speciesRequests: kind === "approved" ? [] : [request] });
    await app.checkDuplicate();
    assert.ok(app.find((node) => node?.type === "TextInput" && node.props.value === species.scientificName));
    assert.ok(app.text().includes(app.t(kind === "approved" ? "addPlantWorkflow.speciesAlreadyExists" :
      kind === "pending" ? "addPlantWorkflow.speciesRequestAlreadyPending" : "addPlantWorkflow.speciesRequestRequiresCorrection")));
    assert.equal(app.find((node) => node?.type === "TextInput" && node.props.value === "Entered common name"), undefined);
    assert.equal(app.text().includes("Individual plant"), false);
    assert.ok(app.find((node) => node?.type === "TextInput" && node.props.value === "Individual plant"));
    app.fill("setSpeciesScientificName", "A genuinely different species");
    assert.ok(app.find((node) => node?.type === "TextInput" && node.props.value === "Entered common name"));
    assert.equal(app.state.speciesDescription, "Entered description");
    await app.checkDuplicate();
    assert.equal(app.state.speciesDuplicate, null);
  }
});

test("own Pending Review duplicate can be reused without creating a species request", async () => {
  const request = { request_id: 29, request_status: "Pending Review", requested_by: "staff:bot",
    scientific_name: "Nepenthes mirabilis", common_name: "Pitcher plant", family_name: "Nepenthaceae" };
  const app = await fixture("en", { catalogSpecies: [], speciesRequests: [request], ...plantValues,
    showSpeciesForm: true, speciesScientificName: "nepenthes mirabilis" });
  await app.checkDuplicate();
  assert.ok(app.text().includes(app.t("addPlantWorkflow.speciesRequestAlreadyPending")));
  await app.press("addPlantWorkflow.usePendingSpecies");
  assert.deepEqual(app.state.selectedSpecies, { id: "request:29", source: "pending", requestId: 29,
    scientificName: request.scientific_name, name: request.common_name, family: request.family_name });
  fillPlant(app); await app.press("addPlantWorkflow.addPlantRecord");
  const [path, { body }] = app.network.find(([path]) => path === "/plant-submissions");
  assert.equal(path, "/plant-submissions");
  assert.equal(body.species_request_id, 29);
  assert.equal(body.new_species, undefined);
});

test("Correction Required duplicate saves the Add Plant draft and opens the existing correction", async () => {
  const request = { request_id: 31, request_status: "Correction Required", requested_by: "staff:bot",
    scientific_name: "Nepenthes mirabilis", common_name: "Pitcher plant", family_name: "Nepenthaceae" };
  const app = await fixture("en", { catalogSpecies: [], speciesRequests: [request], ...plantValues,
    showSpeciesForm: true, speciesScientificName: "Nepenthes mirabilis", plantScientificName: "My saved plant", height: "92" });
  await app.checkDuplicate();
  assert.ok(app.text().includes(app.t("addPlantWorkflow.speciesRequestRequiresCorrection")));
  await app.press("addPlantWorkflow.viewCorrectSpeciesRequest");
  assert.equal(app.savedDrafts.length, 1);
  assert.equal(app.savedDrafts[0].form.plantScientificName, "My saved plant");
  assert.equal(app.savedDrafts[0].form.height, "92");
  assert.equal(app.navigationCalls[0][0], "EditSpeciesRequest");
  assert.equal(app.navigationCalls[0][1].requestId, "31");
  assert.equal(app.navigationCalls[0][1].correction, true);
  assert.equal(app.network.some(([path]) => path === "/plant-submissions"), false);
});

test("duplicate lookup ignores other owners and does not treat rejected requests as active", async () => {
  const app = await fixture("en", { catalogSpecies: [], speciesRequests: [
    { request_id: 40, request_status: "Pending Review", requested_by: "staff:other", scientific_name: "Nepenthes mirabilis" },
    { request_id: 41, request_status: "Rejected", requested_by: "staff:bot", scientific_name: "Nepenthes mirabilis" },
  ], showSpeciesForm: true, speciesScientificName: "Nepenthes mirabilis" });
  await app.checkDuplicate();
  assert.equal(app.text().includes(app.t("addPlantWorkflow.speciesRequestAlreadyPending")), false);
  assert.equal(app.text().includes(app.t("addPlantWorkflow.speciesRequestRequiresCorrection")), false);
});

test("duplicate warning labels are localized in English, Malay and Chinese", async () => {
  for (const language of ["en", "ms", "zh"]) {
    const app = await fixture(language, { showSpeciesForm: true, speciesScientificName: "Nepenthes mirabilis" });
    await app.checkDuplicate();
    assert.ok(app.text().includes(app.t("addPlantWorkflow.speciesAlreadyExists")), language);
  }
});

test("duplicate lookup skips empty input and shows unavailable on network errors", async () => {
  const empty = await fixture("en", { showSpeciesForm: true, speciesScientificName: "   " });
  await empty.checkDuplicate();
  assert.deepEqual(empty.network, []);
  assert.equal(empty.text().includes(empty.t("addPlantWorkflow.duplicateCheckUnavailable")), false);
  assert.ok(empty.find((node) => node?.type === "TextInput" && node.props.onChangeText?.name === "setSpeciesCommonName"));
  const failed = await fixture("en", { showSpeciesForm: true, speciesScientificName: "Nepenthes mirabilis" },
    async () => { throw Error("network unavailable"); });
  await failed.checkDuplicate();
  assert.ok(failed.text().includes(failed.t("addPlantWorkflow.duplicateCheckUnavailable")));
  assert.equal(failed.state.speciesDuplicate.type, "unavailable");
  assert.ok(failed.find((node) => node?.type === "TextInput" && node.props.onChangeText?.name === "setSpeciesCommonName"));
});

test("a late duplicate response cannot replace the result for a newer scientific name", async () => {
  let resolveOld, calls = 0;
  const oldResponse = new Promise((resolve) => { resolveOld = resolve; });
  const request = { request_id: 88, request_status: "Pending Review", requested_by: "staff:bot", scientific_name: "Agave sisalana" };
  const app = await fixture("en", { showSpeciesForm: true, speciesScientificName: "Nepenthes mirabilis", speciesRequests: [request] },
    async (path) => {
      if (String(path).startsWith("/species-requests?scope=mine-active")) {
        calls += 1;
        return calls === 1 ? oldResponse : { species_requests: [request] };
      }
      return {};
    });
  await app.checkDuplicate();
  assert.ok(app.text().includes(app.t("addPlantWorkflow.checkingDuplicate")));
  app.fill("setSpeciesScientificName", "Agave sisalana");
  await app.checkDuplicate();
  assert.ok(app.text().includes(app.t("addPlantWorkflow.speciesRequestAlreadyPending")));
  resolveOld({ species_requests: [] });
  await new Promise((resolve) => setImmediate(resolve)); app.render();
  assert.ok(app.text().includes(app.t("addPlantWorkflow.speciesRequestAlreadyPending")));
  assert.equal(app.state.speciesDuplicate.type, "pending");
});

test("authoritative approved-duplicate submission error fetches its visible record and opens selection", async () => {
  const app = await fixture("en", { ...plantValues, catalogSpecies: [], speciesDetail: species,
    speciesImages: [proposal.photoUri], plantScientificName: "Field plant", height: "81" }, async (path) => {
    if (path === "/plant-submissions") throw Object.assign(Error("This scientific name already exists."), {
      status: 409, code: "SPECIES_DUPLICATE_APPROVED", duplicateType: "approved", speciesId: "7",
    });
    return {};
  });
  await app.focus();
  await app.press("addPlantWorkflow.requestNewSpecies"); fillSpecies(app); fillPlant(app);
  await app.press("addPlantWorkflow.addPlantRecord");
  assert.equal(app.state.speciesDuplicate.type, "approved");
  assert.ok(app.text().includes(app.t("addPlantWorkflow.speciesAlreadyExists")));
  await app.press("addPlantWorkflow.selectExistingSpeciesAction");
  assert.equal(app.state.selectedSpecies.id, "7");
  assert.equal(app.state.plantScientificName, "Manual plant name");
  assert.equal(app.state.height, "80");
});

test("authoritative own pending duplicate fetches the owned request and offers reuse", async () => {
  const request = { request_id: 55, request_status: "Pending Review", requested_by: "staff:bot",
    scientific_name: proposal.scientific_name, common_name: proposal.common_name, family_name: proposal.family_name };
  const app = await fixture("en", { ...plantValues, catalogSpecies: [], speciesImages: [proposal.photoUri],
    plantScientificName: "Field plant" }, async (path) => {
    if (path === "/plant-submissions") throw Object.assign(Error("A matching request is pending."), {
      status: 409, code: "SPECIES_DUPLICATE_PENDING", duplicateType: "pending", requestId: "55", requestStatus: "Pending Review",
    });
    if (path === "/species-requests/55") return { species_request: request };
    return {};
  });
  await app.focus(); await app.press("addPlantWorkflow.requestNewSpecies"); fillSpecies(app); fillPlant(app);
  await app.press("addPlantWorkflow.addPlantRecord");
  assert.ok(app.text().includes(app.t("addPlantWorkflow.speciesRequestAlreadyPending")));
  await app.press("addPlantWorkflow.usePendingSpecies");
  assert.equal(app.state.selectedSpecies.requestId, 55);
  assert.equal(app.state.plantScientificName, "Manual plant name");
});
