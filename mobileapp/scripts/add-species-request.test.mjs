import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { validateSpeciesRequest } from "../utils/addPlantValidation.js";

const require = createRequire(import.meta.url), React = require("react"), ts = require("typescript");
const source = readFileSync(new URL("../screens/AddSpeciesRequest.js", import.meta.url), "utf8");
const output = ts.transpileModule(source, { fileName: "AddSpeciesRequest.jsx", compilerOptions: {
  jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022,
} }).outputText;

function fixture({ fail = false } = {}) {
  const states = [], refs = [], alerts = [], calls = [], navigations = [];
  let stateIndex = 0, refIndex = 0;
  const hooks = { ...React, useState: (initial) => {
    const index = stateIndex++;
    if (!(index in states)) states[index] = initial;
    return [states[index], (next) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
  }, useRef: (initial) => refs[refIndex++] ||= { current: initial }, useEffect: () => {} };
  const native = { StyleSheet: { create: (value) => value }, Alert: { alert: (...args) => alerts.push(args) } };
  for (const name of ["ActivityIndicator", "Image", "ScrollView", "Text", "TextInput", "TouchableOpacity", "View"]) native[name] = name;
  const dependencies = {
    react: hooks, "react-native": native,
    "expo-image-picker": { requestCameraPermissionsAsync: async () => ({ granted: true }), requestMediaLibraryPermissionsAsync: async () => ({ granted: true }),
      launchCameraAsync: async () => ({ canceled: false, assets: [{ uri: "file:///species.jpg" }] }), launchImageLibraryAsync: async () => ({ canceled: false, assets: [{ uri: "file:///species.jpg" }] }) },
    "expo-file-system/legacy": { EncodingType: { Base64: "base64" }, readAsStringAsync: async () => "cGhvdG8=" },
    "@expo/vector-icons": { Ionicons: "Ionicons" },
    "../translations/i18n": { useAppTranslation() {}, t: (key) => key, translateLabel: (value) => value, translateUIMessage: (value) => value },
    "../utils/addPlantValidation": { validateSpeciesRequest },
    "../utils/botanistFormDrafts": { findBotanistFormDraft: async () => null, getBotanistFormDraft: async () => null,
      saveBotanistFormDraft: async (_accountId, draft) => ({ ...draft, saved_at: "saved" }), deleteBotanistFormDraft: async () => true },
    "../utils/botanistDraftAutosave": { useBotanistDraftAutosave: () => ({ stop: async () => {}, flush: async () => {} }) },
    "../utils/plantApi": { plantApi: async (...args) => { calls.push(args); if (fail) throw Object.assign(Error("duplicate"), { status: 409 }); return { species_request: { request_id: 23, request_status: "Pending Review" } }; } },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => { assert.ok(name in dependencies, name); return { ...dependencies[name], __esModule: name !== "react" }; }, module, module.exports);
  const component = module.exports.default;
  const navigation = { goBack() { navigations.push("back"); }, navigate(...args) { navigations.push(args); } };
  const route = { params: { botanist: { id: "botanist-1" }, returnToPlantId: "plant-8", returnPlantDraftKey: "edit-plant-botanist-1-8" } };
  const render = () => { stateIndex = 0; refIndex = 0; return component({ route, navigation }); };
  const children = (node) => node && typeof node === "object" ? React.Children.toArray(node.props?.children) : [];
  const text = (node) => typeof node === "string" ? node : children(node).map(text).join(" ");
  const collect = (node, predicate, found = []) => {
    if (!node || typeof node !== "object") return found;
    if (predicate(node)) found.push(node);
    for (const child of children(node)) collect(child, predicate, found);
    return found;
  };
  return { render, text, collect, alerts, calls, navigations };
}

test("standalone species request submits the existing endpoint and opens the submitted request in My Submissions", async () => {
  const app = fixture();
  let tree = app.render();
  const fields = app.collect(tree, (node) => node.type === "TextInput");
  ["Nepenthes rafflesiana", "Raffles pitcher plant", "Nepenthes", "Nepenthaceae", "Lowland forest species", "Lowland tropical forest"].forEach((value, index) => fields[index].props.onChangeText(value));
  tree = app.render();
  const gallery = app.collect(tree, (node) => node.type === "TouchableOpacity" && app.text(node).includes("addPlant.gallery"))[0];
  await gallery.props.onPress();
  tree = app.render();
  const submit = app.collect(tree, (node) => node.type === "TouchableOpacity" && app.text(node).includes("addPlantWorkflow.submitSpeciesRequest"))[0];
  await submit.props.onPress();
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0][0], "/species-requests");
  assert.equal(app.calls[0][1].method, "POST");
  assert.equal(app.calls[0][1].expectedAccountId, "botanist-1");
  assert.equal(app.calls[0][1].body.scientific_name, "Nepenthes rafflesiana");
  assert.equal(app.calls[0][1].body.photo.content_type, "image/jpeg");
  assert.ok(app.calls[0][1].body.client_key);
  assert.equal(app.calls.some(([path]) => path === "/plant-submissions"), false);
  const alert = app.alerts[0];
  assert.equal(alert[1], "speciesRequestForm.submittedMessage");
  alert[2][0].onPress();
  assert.deepEqual(app.navigations[0], ["BotanistSubmissions", {
    botanist: { id: "botanist-1" }, openTarget: { kind: "species", recordId: "23" },
  }]);
});

test("409 species-name conflicts keep the submitted proposal and never create a plant", async () => {
  const app = fixture({ fail: true });
  let tree = app.render();
  const fields = app.collect(tree, (node) => node.type === "TextInput");
  ["Nepenthes rafflesiana", "Raffles pitcher plant", "Nepenthes", "Nepenthaceae", "Description", "Habitat"].forEach((value, index) => fields[index].props.onChangeText(value));
  tree = app.render();
  await app.collect(tree, (node) => node.type === "TouchableOpacity" && app.text(node).includes("addPlant.gallery"))[0].props.onPress();
  let submit = app.collect(app.render(), (node) => node.type === "TouchableOpacity" && app.text(node).includes("addPlantWorkflow.submitSpeciesRequest"))[0];
  await submit.props.onPress();
  assert.equal(app.calls[0][0], "/species-requests");
  assert.match(app.text(app.render()), /speciesRequestForm.duplicateRequest/);
  assert.equal(app.navigations.length, 0);
  const firstKey = app.calls[0][1].body.client_key;
  await app.collect(app.render(), (node) => node.type === "TouchableOpacity" && app.text(node).includes("addPlantWorkflow.submitSpeciesRequest"))[0].props.onPress();
  assert.equal(app.calls[1][1].body.client_key, firstKey, "an unchanged retry reuses its idempotency key");
  app.collect(app.render(), (node) => node.type === "TextInput")[0].props.onChangeText("Nepenthes mirabilis");
  await app.collect(app.render(), (node) => node.type === "TouchableOpacity" && app.text(node).includes("addPlantWorkflow.submitSpeciesRequest"))[0].props.onPress();
  assert.notEqual(app.calls[2][1].body.client_key, firstKey, "changed proposal details get a fresh key");
});

test("Add Plant success prompts route to the exact submission or saved draft only after OK", () => {
  const addPlant = readFileSync(new URL("../screens/AddPlant.js", import.meta.url), "utf8");
  assert.match(addPlant, /navigation\.navigate\("BotanistMyDrafts",\s*\{\s*botanist,\s*openDraftKey:\s*draft\.client_key\s*\}\)/);
  assert.ok(addPlant.includes('openTarget: { kind: "plant", recordId: plantId'));
  assert.ok(addPlant.includes('navigation.navigate("BotanistSubmissions"'));
  assert.match(addPlant, /Alert\.alert\(\s*t\("addPlant\.plantSubmitted"\)/);
  assert.match(addPlant, /Alert\.alert\(\s*t\("botanistDrafts\.savedStatus"\)/);
});
