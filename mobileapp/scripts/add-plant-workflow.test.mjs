import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { validateSpeciesRequest, validatePlantDetails } from "../utils/addPlantValidation.js";
import { createLocalization, createDisplayTranslator } from "../translations/core.js";
const require = createRequire(import.meta.url), React = require("react"), ts = require("typescript");
const en = JSON.parse(readFileSync(new URL("../translations/en.json", import.meta.url), "utf8"));
const ms = JSON.parse(readFileSync(new URL("../translations/ms.json", import.meta.url), "utf8"));
const source = readFileSync(new URL("../screens/AddPlant.js", import.meta.url), "utf8");
const stateNames = [...source.matchAll(/const \[(\w+),\s*(\w+)\] =\s*useState/g)].map((m) => [m[1], m[2]]);
const code = ts.transpileModule(source, { fileName: "AddPlant.jsx", compilerOptions: {
  jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022,
} }).outputText;
const species = { id: "7", name: "Swamp pitcher plant", scientificName: "Nepenthes mirabilis", family: "Nepenthaceae" };
const proposal = { scientific_name: "Nepenthes rafflesiana", common_name: "Raffles pitcher plant", genus_name: "Nepenthes", family_name: "Nepenthaceae", conservation_status: "Least Concern", description: "Climbing pitcher plant", habitat: "Lowland forest", photoUri: "file:///species.png" };
async function fixture(language = "en", initial = {}, api) {
  const app = createLocalization({ resources: { en: { translation: en }, ms: { translation: ms } }, storage: { getItem: async () => null, setItem: async () => {} } });
  await app.changeLanguage(language);
  const display = createDisplayTranslator(app.i18n, en), t = (key, values) => app.i18n.t(key, values);
  const state = { speciesCatalog: [species], loadingSpeciesCatalog: false, ...initial }, refs = [], alerts = [], network = [], speciesReads = [];
  let stateIndex, refIndex, tree, focusEffect;
  const hooks = { ...React, useEffect: () => {}, useCallback: (fn) => fn, useState: (value) => {
    const [key, setterName] = stateNames[stateIndex++];
    if (!(key in state)) state[key] = typeof value === "function" ? value() : value;
    const setter = (next) => { state[key] = typeof next === "function" ? next(state[key]) : next; };
    Object.defineProperty(setter, "name", { value: setterName }); return [state[key], setter];
  }, useRef: (value) => refs[refIndex++] ||= { current: value } };
  const native = { StyleSheet: { create: (v) => v }, Alert: { alert: (...args) => alerts.push(args) } };
  for (const name of ["View", "Text", "TextInput", "TouchableOpacity", "ScrollView", "ActivityIndicator", "Image"]) native[name] = name;
  const deps = { react: hooks, "react-native": native, "@react-navigation/native": { useFocusEffect: (fn) => { focusEffect = fn; } },
    "../translations/i18n": { useAppTranslation: () => {}, t, translateLabel: display.label, translateUIMessage: display.message },
    "../utils/addPlantValidation": { validateSpeciesRequest, validatePlantDetails },
    "expo-location": {}, "expo-image-picker": { requestMediaLibraryPermissionsAsync: async () => ({ status: "granted" }), launchImageLibraryAsync: async () => ({ canceled: false, assets: [{ uri: proposal.photoUri }] }) },
    "expo-file-system/legacy": { EncodingType: { Base64: "base64" }, readAsStringAsync: async () => "cGhvdG8=" },
    "react-native-qrcode-svg": { default: "QRCode" }, "@expo/vector-icons/Ionicons": { default: "Icon" }, "../components/QRRefreshButton": { default: "QRRefreshButton" }, "../components/RefreshButton": { default: "RefreshButton" },
    "../utils/plantApi": { fetchSpeciesCatalog: async (options) => { speciesReads.push(options); return [species]; }, plantApi: async (...args) => {
      network.push(args); if (api) return api(...args);
      if (args[0] === "/species-requests") return { species_request: { request_id: 12, request_status: "Pending Review" } };
      if (args[0] === "/plant-submissions") return { plant_id: 42, id: "observation-42", qr_token: "unchanged-qr-token" };
      if (args[0].endsWith("/qr")) return { qr_token: "unchanged-qr-token" }; return {};
    } },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", code)((name) => {
    assert.ok(name in deps, name); return { ...deps[name], __esModule: name !== "react" };
  }, module, module.exports);
  const render = () => { stateIndex = 0; refIndex = 0; tree = module.exports.default({ route: { params: { botanist: { id: "bot", name: "Aina" } } }, navigation: { goBack: () => {} } }); };
  const children = (node) => node && typeof node === "object" ? React.Children.toArray(node.props?.children) : [];
  const text = (node) => typeof node === "string" ? node : children(node).map(text).join(" ");
  function find(predicate, node = tree) { if (predicate(node)) return node; for (const child of children(node)) { const found = find(predicate, child); if (found) return found; } }
  async function press(key) { const node = find((n) => n?.type === "TouchableOpacity" && text(n) === t(key)); assert.ok(node, key); assert.ok(!node.props.disabled, key); await node.props.onPress(); render(); }
  function fill(setter, value) { const node = find((n) => n?.type === "TextInput" && n.props.onChangeText?.name === setter); assert.ok(node, setter); node.props.onChangeText(value); render(); }
  const byLabel = (key) => find((n) => n?.props?.accessibilityLabel === t(key) || (n?.type === "RefreshButton" && n.props.label === t(key)));
  render(); return { state, alerts, network, speciesReads, render, find, text: () => text(tree), t, press, fill, byLabel,
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

const plantValues = { selectedQRCode: { qr_id: 17 }, guidedPhotos: { wholePlant: "whole.jpg", leafCloseUp: "leaf.jpg", stemBark: "stem.jpg", flowerFruit: null } };
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
for (const language of ["en", "ms"]) {
  test(`${language}: new mode has no separate submit; Cancel restores selector and preserves independent plant input`, async () => {
    const app = await fixture(language, { ...plantValues, selectedSpecies: species });
    app.fill("setPlantScientificName", "Manual plant name"); app.fill("setHeight", "99");
    await app.press("addPlantWorkflow.requestNewSpecies");
    assert.equal(app.network.length, 0);
    assert.equal(app.byLabel("addPlant.searchSpeciesInTheDatabase"), undefined);
    assert.equal(app.byLabel("addPlantWorkflow.refreshSpecies"), undefined);
    for (const key of ["addPlantWorkflow.selectExistingSpecies", "addPlant.canTFindThisSpecies", "addPlantWorkflow.requestNewSpecies", "addPlantWorkflow.submitSpeciesRequest"]) assert.ok(!app.text().includes(app.t(key)), key);
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
      const option = app.find((n) => n?.type === "TouchableOpacity" && React.Children.toArray(n.props.children).some((c) => c?.props?.children === name));
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
