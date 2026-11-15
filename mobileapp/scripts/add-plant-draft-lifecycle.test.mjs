import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { validateSpeciesRequest, validatePlantDetails } from "../utils/addPlantValidation.js";

const require = createRequire(import.meta.url), React = require("react"), ts = require("typescript");
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const source = read("screens/AddPlant.js");
const stateNames = [...source.slice(source.indexOf("export function AddPlantForm(")).matchAll(/\[(\w+)(?:,\s*(\w+))?\]\s*=\s*useState/g)].map((match) => [match[1], match[2]]);
const compiled = new Map();
function load(path, dependencies) {
  if (!compiled.has(path)) compiled.set(path, ts.transpileModule(read(path), { fileName: path.replace(/\.js$/, ".jsx"), compilerOptions: {
    jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022,
  } }).outputText);
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled.get(path))((name) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return { ...dependencies[name], __esModule: name !== "react" };
  }, module, module.exports);
  return module.exports;
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const species = { id: "7", name: "Species Seven", scientificName: "Species scientific" };

function environment() {
  let rendering, nextId = 0, failSubmit = false, saveGate = null, activeAccount = "owner";
  const rows = new Map(), files = new Set(), alerts = [], calls = [], mounts = [];
  const hooks = { ...React,
    useId() { const h = rendering, index = h.cursor++; return (h.cells[index] ||= { value: `form-${h.id}` }).value; },
    useState(initial) {
      const h = rendering, index = h.cursor++, field = h.component === screen.AddPlantForm ? stateNames[h.fieldCursor++] : null;
      if (!(index in h.cells)) h.cells[index] = { value: typeof initial === "function" ? initial() : initial };
      const setter = (next) => {
        const value = typeof next === "function" ? next(h.cells[index].value) : next;
        if (!Object.is(value, h.cells[index].value)) { h.cells[index].value = value; h.dirty = true; }
      };
      if (field) { h.setters[field[0]] = setter; h.fields[field[0]] = () => h.cells[index].value; Object.defineProperty(setter, "name", { value: field[1] }); }
      return [h.cells[index].value, setter];
    },
    useRef(initial) { const h = rendering, index = h.cursor++; return h.cells[index] ||= { current: initial }; },
    useCallback(callback, deps) {
      const h = rendering, index = h.cursor++, prior = h.cells[index];
      if (prior && deps.every((value, i) => Object.is(value, prior.deps[i]))) return prior.callback;
      h.cells[index] = { callback, deps }; return callback;
    },
    useEffect(effect, deps) { scheduleEffect(effect, deps, false); },
    useLayoutEffect(effect, deps) { scheduleEffect(effect, deps, true); },
  };
  function scheduleEffect(effect, deps, layout) {
    const h = rendering, index = h.cursor++, prior = h.cells[index];
    if (!prior || !deps || deps.some((value, i) => !Object.is(value, prior.deps?.[i]))) {
      h.effects.push({ layout, run() { prior?.cleanup?.(); h.cells[index] = { deps, effect, cleanup: effect() }; } });
    }
  }
  const native = { StyleSheet: { create: (styles) => styles }, Alert: { alert: (...args) => alerts.push(args) }, AppState: { addEventListener: () => ({ remove() {} }) } };
  for (const name of ["View", "Text", "TextInput", "TouchableOpacity", "ScrollView", "ActivityIndicator", "Image"]) native[name] = name;
  const fs = { documentDirectory: "file:///private/", EncodingType: { Base64: "base64" }, readAsStringAsync: async () => "cGhvdG8=",
    makeDirectoryAsync: async () => {}, getInfoAsync: async (uri) => ({ exists: files.has(uri) || !uri.startsWith("file:///private/"), isDirectory: false }),
    copyAsync: async ({ to }) => { files.add(to); }, deleteAsync: async (uri) => { files.delete(uri); } };
  const authorize = (accountId) => { if (accountId !== activeAccount) throw Error("Wrong Botanist account"); };
  const draftApi = load("utils/botanistFormDrafts.js", { "expo-file-system/legacy": fs, "./fieldStorage": {
    readDrafts: async (accountId) => { authorize(accountId); return structuredClone(rows.get(accountId) || []); },
    saveDraft: async (accountId, draft) => { if (saveGate) await saveGate; authorize(accountId); rows.set(accountId, [...(rows.get(accountId) || []).filter((row) => row.client_key !== draft.client_key), structuredClone(draft)]); },
    removeDraft: async (accountId, key, expected) => { authorize(accountId); const saved = rows.get(accountId) || []; if (JSON.stringify(saved.find((row) => row.client_key === key)) !== JSON.stringify(expected)) return false; rows.set(accountId, saved.filter((row) => row.client_key !== key)); return true; },
  } });
  const autosave = load("utils/botanistDraftAutosave.js", { react: hooks, "react-native": native });
  const screen = load("screens/AddPlant.js", {
    react: hooks, "react-native": native, "../translations/i18n": { useAppTranslation() {}, t: (key) => key, translateLabel: (value) => value, translateUIMessage: (value) => value },
    "@react-navigation/native": { useFocusEffect: (callback) => { const h = rendering; hooks.useEffect(() => { h.focusListeners.add(callback); const cleanup = callback(); return () => { cleanup?.(); h.focusListeners.delete(callback); }; }, [callback]); } },
    "expo-location": {}, "expo-image-picker": {}, "expo-file-system/legacy": fs,
    "react-native-qrcode-svg": { default: "QRCode" }, "@expo/vector-icons/Ionicons": { default: "Icon" },
    "../components/RefreshButton": { default: "RefreshButton" }, "../components/fieldFormStyles": { fieldFormStyles: {} },
    "../utils/addPlantValidation": { validateSpeciesRequest, validatePlantDetails },
    "../utils/botanistFormDrafts": draftApi, "../utils/botanistDraftAutosave": autosave,
    "../utils/plantApi": { fetchSpeciesCatalog: async () => [species], plantApi: async (path, options) => {
      if (path === "/plant-submissions") { calls.push(options.body); if (failSubmit) throw Error("submission failed"); return { plant_id: 42, qr_token: "qr-42" }; }
      return { qr_codes: [{ qr_id: 17, status: "generated", plant_id: null }] };
    } },
  });
  const nodes = (node) => node && typeof node === "object" ? [node, ...React.Children.toArray(node.props?.children).flatMap(nodes)] : [];
  function mount({ accountId = activeAccount, formDraftKey, skipRecovery = false, component = screen.AddPlantForm, props = {} } = {}) {
    const h = { id: ++nextId, cells: [], setters: {}, fields: {}, dirty: true, effects: [], focusListeners: new Set(), component, fresh: false, submitted: false, listeners: new Map() };
    const route = { key: `route-${h.id}`, params: { botanist: { id: accountId }, formDraftKey } };
    const navigation = { setParams: (params) => { Object.assign(route.params, params); h.dirty = true; }, navigate: (...args) => calls.push(args), goBack() {}, addListener: (event, listener) => { h.listeners.set(event, listener); return () => h.listeners.delete(event); } };
    h.props = { route, navigation, skipRecovery, onStartNew: () => { h.fresh = true; }, onSubmitted: () => { h.submitted = true; }, ...props };
    h.render = () => { rendering = h; h.cursor = 0; h.fieldCursor = 0; h.dirty = false; h.effects = []; h.tree = component(h.props); rendering = null; const effects = h.effects; effects.filter((effect) => effect.layout).forEach((effect) => effect.run()); effects.filter((effect) => !effect.layout).forEach((effect) => effect.run()); return h.tree; };
    h.replayEffects = () => { const effects = h.cells.filter((cell) => cell?.effect); effects.forEach((cell) => cell.cleanup?.()); effects.forEach((cell) => { cell.cleanup = cell.effect(); }); };
    h.settle = async () => { for (let i = 0; i < 6; i++) { if (h.dirty) h.render(); await tick(); } };
    h.set = (key, value) => { assert.ok(h.setters[key], key); h.setters[key](value); h.render(); };
    h.value = (key) => h.fields[key]();
    h.blur = async () => { h.listeners.get("blur")?.(); await h.settle(); };
    h.unmount = async () => { for (const cell of h.cells) cell?.cleanup?.(); await tick(); };
    h.submit = async () => { const button = nodes(h.tree).find((node) => node.type === "TouchableOpacity" && React.Children.toArray(node.props.children).some((child) => child?.props?.children === "addPlantWorkflow.addPlantRecord")); assert.ok(button); await button.props.onPress(); await h.settle(); };
    h.render(); mounts.push(h); return h;
  }
  return { screen, mount, draftApi, autosave, rows, files, alerts, calls, nodes,
    choice: (name) => { const prompt = alerts.findLast((alert) => alert[0] === "botanistDrafts.recoveryTitle"); assert.ok(prompt, "recovery prompt exists"); return prompt[2].find((button) => button.text === `botanistDrafts.${name}`).onPress(); },
    prompts: () => alerts.filter((alert) => alert[0] === "botanistDrafts.recoveryTitle").length,
    seed: (key, form = { plantScientificName: "Saved plant" }, photos = []) => draftApi.saveBotanistFormDraft(activeAccount, { client_key: key, form_type: "add-plant", submission_client_key: `submit-${key}`, form, photos }),
    failSubmit(value) { failSubmit = value; }, setAccount(value) { activeAccount = value; }, delaySaves(promise) { saveGate = promise; },
    async close() { for (const h of mounts) await h.unmount(); },
  };
}
function completeForm(h) {
  for (const [key, value] of Object.entries({ selectedSpecies: species, plantScientificName: "Submitted plant", height: "80", growthStage: "Mature", morphology: "Leaves", latitude: "4.5", longitude: "113.7", selectedQRCode: { qr_id: 17 }, guidedPhotos: { wholePlant: "whole.jpg", leafCloseUp: "leaf.jpg", stemBark: "stem.jpg", flowerFruit: null } })) h.set(key, value);
}

test("no draft or empty/default-only draft opens without recovery and does not autosave", async () => {
  const e = environment();
  try {
    const h = e.mount(); await h.settle(); assert.equal(e.prompts(), 0);
    await h.blur(); assert.equal((e.rows.get("owner") || []).length, 0);
    await h.unmount();
    await e.seed("empty", { plantScientificName: "   ", healthStatus: "Healthy", speciesConservationStatus: "Not Assessed", showSpeciesForm: true });
    const next = e.mount(); await next.settle(); assert.equal(e.prompts(), 0);
  } finally { await e.close(); }
});

test("effect setup replay does not suppress or duplicate draft recovery", async () => {
  const e = environment();
  try {
    await e.seed("replay");
    const h = e.mount(); h.replayEffects(); await h.settle();
    assert.equal(e.prompts(), 1);
    await e.choice("continueDraft"); await h.settle();
    assert.equal(h.value("plantScientificName"), "Saved plant");
  } finally { await e.close(); }
});

test("Resume restores the exact draft, photos and QR; Start New removes only the detected draft and remounts fresh", async () => {
  const e = environment();
  try {
    const draft = await e.seed("resume", { selectedSpecies: species, plantScientificName: "Saved plant", selectedQRCode: { qr_id: 17 }, height: "85" }, [{ slot: "guided:wholePlant", uri: "whole.jpg" }]);
    const h = e.mount(); await h.settle(); assert.equal(e.prompts(), 1);
    await e.choice("continueDraft"); await h.settle();
    assert.equal(h.value("plantScientificName"), "Saved plant"); assert.equal(h.value("selectedQRCode").qr_id, 17);
    assert.equal(h.value("guidedPhotos").wholePlant, draft.photo_refs[0].uri);
    assert.ok(e.rows.get("owner").some((row) => row.client_key === "resume"));
    await h.unmount();
    await e.seed("keep-other"); await e.seed("discard", { plantScientificName: "Discard this" });
    // Force a deterministic latest row independently of millisecond timestamp resolution.
    e.rows.get("owner").find((row) => row.client_key === "discard").saved_at = "2099-01-01";
    const prompt = e.mount(); await prompt.settle(); await e.choice("startNewDraft");
    assert.equal(prompt.fresh, true); assert.equal(e.rows.get("owner").some((row) => row.client_key === "discard"), false);
    assert.ok(e.rows.get("owner").some((row) => row.client_key === "keep-other"));
    const fresh = e.mount({ skipRecovery: true }); await fresh.settle();
    assert.equal(fresh.value("plantScientificName"), ""); assert.equal(fresh.value("selectedQRCode"), null);
    assert.equal(fresh.value("selectedSpecies"), null); assert.equal(fresh.value("guidedPhotos").wholePlant, null);
  } finally { await e.close(); }
});

test("Start New then leave untouched never recreates the draft; meaningful edits remain resumable", async () => {
  const e = environment();
  try {
    await e.seed("old"); const old = e.mount(); await old.settle(); await e.choice("startNewDraft"); await old.unmount();
    const fresh = e.mount({ skipRecovery: true }); await fresh.settle(); await fresh.unmount();
    const next = e.mount(); await next.settle(); assert.equal(e.prompts(), 1, "only the original popup appeared");
    next.set("plantScientificName", "New meaningful plant"); await next.blur(); await next.unmount();
    const reopened = e.mount(); await reopened.settle(); assert.equal(e.prompts(), 2);
    await e.choice("continueDraft"); await reopened.settle(); assert.equal(reopened.value("plantScientificName"), "New meaningful plant");
  } finally { await e.close(); }
});

test("successful submission clears the matching persisted draft only after confirmed success; failure preserves it", async () => {
  const e = environment();
  try {
    const h = e.mount(); await h.settle(); completeForm(h); await h.blur();
    const key = e.rows.get("owner")[0].client_key;
    e.failSubmit(true); await h.submit();
    assert.equal(h.value("plantScientificName"), "Submitted plant"); assert.equal(h.submitted, false);
    assert.ok(e.rows.get("owner").some((row) => row.client_key === key));
    e.failSubmit(false); await h.submit(); assert.equal(h.submitted, true);
    assert.equal(e.rows.get("owner").some((row) => row.client_key === key), false);
    assert.equal(h.props.route.params.formDraftKey, undefined);
    await h.unmount(); const next = e.mount(); await next.settle(); assert.equal(e.prompts(), 0);
    assert.equal(e.calls.filter((call) => call.client_key).length, 2);
    assert.equal(e.calls[0].client_key, e.calls[1].client_key, "retry preserves submission idempotency");
  } finally { await e.close(); }
});

test("a failed submission persists its input even before the first autosave timer fires", async () => {
  const e = environment();
  try {
    const h = e.mount(); await h.settle(); completeForm(h);
    assert.equal((e.rows.get("owner") || []).length, 0);
    e.failSubmit(true); await h.submit();
    assert.equal(h.submitted, false);
    assert.equal(e.rows.get("owner")[0].form.plantScientificName, "Submitted plant");
    assert.equal(h.value("selectedQRCode").qr_id, 17);
    assert.equal(h.value("guidedPhotos").wholePlant, "whole.jpg");
  } finally { await e.close(); }
});

test("discard drains an old delayed writer and cancels its future writes across rapid navigation", async () => {
  const e = environment(); let release;
  try {
    const draft = await e.seed("delayed"); const writer = e.mount({ formDraftKey: draft.client_key }); await writer.settle();
    e.delaySaves(new Promise((resolve) => { release = resolve; }));
    writer.set("plantScientificName", "Latest unfinished input"); await writer.blur();
    const next = e.mount(); await next.settle();
    let discarded = false; const discard = e.choice("startNewDraft").then(() => { discarded = true; });
    await tick(); assert.equal(discarded, false, "discard waits for the in-flight write");
    e.delaySaves(null); release(); await discard;
    await writer.blur(); await writer.unmount();
    assert.equal(e.rows.get("owner").some((row) => row.client_key === "delayed"), false);
  } finally { release?.(); await e.close(); }
});

test("successful submission waits for a delayed autosave before deleting the draft", async () => {
  const e = environment(); let release;
  try {
    const draft = await e.seed("submitting");
    const h = e.mount({ formDraftKey: draft.client_key }); await h.settle(); completeForm(h);
    e.delaySaves(new Promise((resolve) => { release = resolve; }));
    await h.blur();
    const submission = h.submit(); await tick();
    assert.equal(h.submitted, false, "cleanup waits for the earlier autosave");
    assert.equal(e.calls.filter((call) => call.client_key).length, 1, "backend confirmed the plant first");
    e.delaySaves(null); release(); await submission;
    assert.equal(h.submitted, true);
    await h.blur(); await h.unmount();
    assert.equal(e.rows.get("owner").some((row) => row.client_key === draft.client_key), false);
    const next = e.mount(); await next.settle(); assert.equal(e.prompts(), 0);
  } finally { release?.(); await e.close(); }
});

test("draft lookup and deletion remain scoped to the signed-in Botanist", async () => {
  const e = environment();
  try {
    await e.seed("owner-draft"); e.setAccount("other"); await e.seed("other-draft");
    const h = e.mount(); await h.settle(); await e.choice("startNewDraft");
    assert.ok(e.rows.get("owner").some((row) => row.client_key === "owner-draft"));
    assert.equal(e.rows.get("other").length, 0);
    assert.equal(h.fresh, true);
  } finally { await e.close(); }
});

test("screen sessions remount on Start New, next focus after submission, and account changes", async () => {
  const e = environment();
  try {
    const outer = e.mount({ component: e.screen.default });
    const firstAccountKey = outer.tree.key;
    const session = e.mount({ component: outer.tree.type, props: outer.tree.props });
    const originalKey = session.tree.key;
    session.tree.props.onStartNew(); await session.settle();
    assert.notEqual(session.tree.key, originalKey); assert.equal(session.tree.props.skipRecovery, true);
    const freshKey = session.tree.key; session.tree.props.onSubmitted(); await session.settle();
    assert.equal(session.tree.key, freshKey, "successful result remains visible until the next focus");
    for (const focus of session.focusListeners) focus(); await session.settle();
    assert.notEqual(session.tree.key, freshKey); assert.equal(session.props.route.params.formDraftKey, undefined);
    outer.props.route.params.botanist = { id: "another-account" }; outer.render();
    assert.notEqual(outer.tree.key, firstAccountKey, "account key prevents private form state reuse");
    const beforeRestore = session.tree.key;
    session.props.route.params.formDraftKey = "different-draft"; session.render();
    assert.notEqual(session.tree.key, beforeRestore, "opening another draft creates an isolated form/autosave instance");

  } finally { await e.close(); }
});
