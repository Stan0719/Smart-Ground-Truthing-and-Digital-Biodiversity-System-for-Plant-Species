import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url), ts = require("typescript");
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const load = async (path) => import("data:text/javascript;base64," + Buffer.from(read(path)).toString("base64"));
const { createDraftStore } = await load("utils/offlineDraftStore.js");
function moduleFrom(path, dependencies) {
  const source = ts.transpileModule(read(path), { fileName: path.replace(/\.js$/, ".jsx"), compilerOptions: {
    jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", source)((name) => {
    assert.ok(name in dependencies, `Unexpected draft utility dependency: ${name}`);
    return { ...dependencies[name], __esModule: true };
  }, module, module.exports);
  return module.exports;
}

function fixture() {
  const stored = new Map(), files = new Map();
  let activeAccount = "owner", failCopy = false;
  const storage = { async getItem(key) { return stored.get(key) ?? null; }, async setItem(key, value) { stored.set(key, value); } };
  const draftEngine = createDraftStore({ storage, authorize: async (id) => { if (id !== activeAccount) throw Error("Wrong account"); },
    encrypt: async (_id, value) => ({ version: 1, ciphertext: Buffer.from(value).toString("base64") }),
    decrypt: async (_id, value) => Buffer.from(value.ciphertext, "base64").toString("utf8"), availableBytes: async () => 10000000 });
  const FileSystem = { documentDirectory: "file:///private/", async makeDirectoryAsync() {},
    async getInfoAsync(uri) { return { exists: files.has(uri) || uri.startsWith("file:///cache/"), isDirectory: false }; },
    async copyAsync({ from, to }) { files.set(to, "photo"); if (failCopy) throw Error("disk full"); if (!files.has(from) && !from.startsWith("file:///cache/")) throw Error("missing"); },
    async deleteAsync(uri) { files.delete(uri); } };
  const api = moduleFrom("utils/botanistFormDrafts.js", { "expo-file-system/legacy": FileSystem,
    "./fieldStorage": { readDrafts: draftEngine.readDrafts, saveDraft: draftEngine.saveDraft, removeDraft: draftEngine.removeDraft } });
  return { api, files, readDrafts: draftEngine.readDrafts, setAccount(id) { activeAccount = id; }, setFailCopy(value) { failCopy = value; } };
}

test("form draft photos persist as app-private references and same-key saves replace atomically", async () => {
  const { api, files, setFailCopy } = fixture();
  const first = await api.saveBotanistFormDraft("owner", { client_key: "edit-plant-1", form_type: "edit-plant", target_id: "1",
    form: { notes: "partial" }, photos: [{ slot: "new:00", uri: "file:///cache/plant.jpg", content_type: "image/jpeg" }] });
  assert.equal(first.form.notes, "partial");
  assert.equal(first.photo_refs.length, 1);
  assert.ok(first.photo_refs[0].uri.startsWith("file:///private/botanist-form-drafts/owner/"));
  assert.equal(JSON.stringify(first).includes("base64"), false);
  const file1 = first.photo_refs[0].uri;
  const second = await api.saveBotanistFormDraft("owner", { client_key: "edit-species-2", form_type: "edit-species", target_id: "2",
    form: { habitat: "forest" }, photos: [{ slot: "new:photo", uri: "file:///cache/species.jpg", content_type: "image/jpeg" }] });
  const file2 = second.photo_refs[0].uri;

  setFailCopy(true);
  await assert.rejects(api.saveBotanistFormDraft("owner", { client_key: first.client_key, form_type: first.form_type, target_id: first.target_id,
    form: { notes: "replacement" }, photos: [{ slot: "new:00", uri: "file:///cache/replacement.jpg", content_type: "image/jpeg" }] }), /Device storage is full/);
  setFailCopy(false);
  assert.equal((await api.getBotanistFormDraft("owner", first.client_key, "edit-plant", "1")).form.notes, "partial");
  assert.equal(files.has(file1), true, "failed replacement keeps the previous photo");

  const updated = await api.saveBotanistFormDraft("owner", { client_key: first.client_key, form_type: first.form_type, target_id: first.target_id,
    form: { notes: "updated" }, photos: [{ slot: "new:00", uri: "file:///cache/replacement.jpg", content_type: "image/jpeg" }] });
  assert.equal(updated.form.notes, "updated");
  assert.equal(files.has(file1), false, "unreferenced replaced photo is cleaned after the metadata save succeeds");
  assert.equal(files.has(file2), true, "another draft's photo remains available");
  assert.equal((await api.getBotanistFormDraft("owner", second.client_key, "edit-species", "2")).form.habitat, "forest");
  assert.equal(await api.deleteBotanistFormDraft("owner", updated.client_key, "stale-save-time"), false);
  assert.equal((await api.getBotanistFormDraft("owner", updated.client_key, "edit-plant", "1")).form.notes, "updated");
  assert.equal(await api.deleteBotanistFormDraft("owner", updated.client_key, updated.saved_at), true);
  assert.equal(files.has(file2), true);
});

test("form draft access checks the owner and reports a missing persistent photo without deleting the draft", async () => {
  const fixtureValue = fixture();
  const draft = await fixtureValue.api.saveBotanistFormDraft("owner", { client_key: "add-plant-1", form_type: "add-plant", form: { name: "partial" },
    photos: [{ slot: "guided:leafCloseUp", uri: "file:///cache/leaf.jpg", content_type: "image/jpeg" }] });
  fixtureValue.setAccount("another-botanist");
  await assert.rejects(fixtureValue.api.getBotanistFormDraft("owner", draft.client_key, "add-plant"), /Wrong account/);
  fixtureValue.setAccount("owner"); fixtureValue.files.delete(draft.photo_refs[0].uri);
  await assert.rejects(fixtureValue.api.getBotanistFormDraft("owner", draft.client_key, "add-plant"), /saved draft photo is unavailable/);
  assert.equal((await fixtureValue.readDrafts("owner")).some((row) => row.client_key === draft.client_key), true);
});

test("My Draft classifies supported form types and combines category and text search without changing stored drafts", async () => {
  const React = require("react");
  const storedDrafts = [
    { kind: "botanist-form", form_type: "add-plant", client_key: "plant-1", title: "Shorea", saved_at: "2026-01-01", form: {} },
    { kind: "botanist-form", form_type: "add-species", client_key: "species-new", title: "Nepenthes test", saved_at: "2026-01-01T12:00:00Z", auto_saved: true, form: {} },
    { kind: "botanist-form", form_type: "edit-species", client_key: "species-1", target_id: "7", saved_at: "2026-01-02", form: {} },
    { kind: "botanist-form", form_type: "edit-plant", client_key: "edit-1", target_id: "8", saved_at: "2026-01-03", form: {} },
    { client_key: "correction-1", method: "PATCH", target_id: "9", saved_at: "2026-01-04", form: { plant_name: "Niah palm" } },
    { client_key: "observation-1", path: "/observations", saved_at: "2026-01-05", form: { qr_id: "QR-10" } },
    { client_key: "field-plant-1", path: "/plants", saved_at: "2026-01-06", form: { plant_name: "Field fern" } },
  ];
  const native = { StyleSheet: { create: (value) => value }, Alert: { alert: (...args) => { alert = args; } }, useWindowDimensions: () => ({ width: 390, height: 844 }) };
  for (const name of ["ActivityIndicator", "RefreshControl", "ScrollView", "Text", "TextInput", "TouchableOpacity", "View"]) native[name] = name;
  let index = 0, refIndex = 0, state = [], refs = [], focus, alert, effects = [], navigations = [], reads = 0, removals = 0;
  const hooks = { ...React, useCallback: (fn) => fn, useState: (initial) => {
    const position = index++; if (!(position in state)) state[position] = typeof initial === "function" ? initial() : initial;
    return [state[position], (next) => { state[position] = typeof next === "function" ? next(state[position]) : next; }];
  }, useRef: (initial) => refs[refIndex++] ||= { current: initial }, useEffect: (fn) => effects.push(fn) };
  const { default: Drafts, draftCategory, filterBotanistDrafts } = moduleFrom("screens/BotanistMyDrafts.js", {
    react: { default: React, ...hooks }, "react-native": native, "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "@react-navigation/native": { useFocusEffect: (fn) => { focus = fn; } },
    "@expo/vector-icons/Ionicons": { default: "Icon" },
    "../components/BotanicalSkeleton": { CardListSkeleton: "CardListSkeleton" },
    "../translations/i18n": { t: (key) => key, translateUIMessage: (value) => value, useAppTranslation() {} },
    "../utils/faceSession": { faceSession: { restore: async () => ({ id: "owner", role: "botanist" }) } },
    "../utils/fieldStorage": { readDrafts: async () => { reads++; return storedDrafts; }, removeDraft: async () => { removals++; return true; } },
    "../utils/botanistFormDrafts": { deleteBotanistFormDraft: async () => { removals++; return true; } },
    "../utils/botanistDraftAutosave": { subscribeBotanistDraftAutosaveFailures: () => () => {}, retryBotanistDraftAutosave: async () => true, stopBotanistDraftAutosave: async () => {} },
  });
  assert.deepEqual(storedDrafts.map(draftCategory), ["plant-records", "species-requests", "species-requests", "plant-records", "corrections", "observations", "plant-records"]);
  assert.deepEqual(filterBotanistDrafts(storedDrafts, "plant-records", "field fern").map((draft) => draft.client_key), ["field-plant-1"]);
  assert.deepEqual(filterBotanistDrafts(storedDrafts, "corrections", "9").map((draft) => draft.client_key), ["correction-1"]);
  assert.deepEqual(filterBotanistDrafts(storedDrafts, "species-requests").map((draft) => draft.client_key), ["species-new", "species-1"]);
  const route = { params: { botanist: { id: "owner" } } };
  const navigation = { navigate: (...args) => navigations.push(args), setParams: (params) => Object.assign(route.params, params), goBack() { throw Error("page content must not create a second back action"); } };
  const render = () => { index = 0; refIndex = 0; effects = []; const result = Drafts({ route, navigation }); effects.forEach((effect) => effect()); return result; };
  let tree = render();
  const children = (node) => node && typeof node === "object" ? React.Children.toArray(node.props?.children) : [];
  const text = (node) => typeof node === "string" ? node : children(node).map(text).join(" ");
  function find(predicate, node = tree) { if (predicate(node)) return node; for (const child of children(node)) { const match = find(predicate, child); if (match) return match; } }
  assert.ok(find((node) => node?.type === "CardListSkeleton"), "My Drafts shows draft-shaped placeholders while loading");
  focus(); await new Promise((resolve) => setImmediate(resolve));
  tree = render();
  assert.ok(!text(tree).includes("common.goBack"));
  assert.ok(find((node) => node?.props?.testID === "draft-filter-all"));
  find((node) => node?.props?.testID === "draft-filter-plant-records").props.onPress();
  tree = render(); assert.ok(find((node) => node?.props?.testID === "my-draft-plant-1")); assert.ok(!find((node) => node?.props?.testID === "my-draft-species-1"));
  find((node) => node?.type === "TextInput").props.onChangeText("field fern");
  tree = render(); assert.ok(find((node) => node?.props?.testID === "my-draft-field-plant-1")); assert.equal(find((node) => node?.props?.testID?.startsWith("my-draft-"))?.props.testID, "my-draft-field-plant-1");
  assert.ok(text(tree).includes("botanistDrafts.matchingDrafts"));
  const search = find((node) => node?.type === "TextInput"); search.props.onChangeText("not found");
  tree = render(); assert.ok(text(tree).includes("botanistDrafts.noMatches"));
  find((node) => node?.type === "TextInput").props.onChangeText("field fern"); tree = render();
  const resume = find((node) => node?.type === "TouchableOpacity" && text(node).includes("botanistDrafts.resume"));
  resume.props.onPress(); assert.equal(navigations.at(-1)[0], "FieldCollectionPlant");
  const remove = find((node) => node?.type === "TouchableOpacity" && node.props.accessibilityLabel === "fieldCollection.deleteDraft");
  remove.props.onPress(); assert.ok(alert); alert[2][1].onPress(); await new Promise((resolve) => setImmediate(resolve));
  assert.ok(removals >= 1); assert.equal(reads, 2); assert.equal(storedDrafts.length, 7, "filtering did not mutate the source draft array");

  route.params.openDraftKey = "species-new";
  render(); focus(); await new Promise((resolve) => setImmediate(resolve)); render();
  assert.deepEqual(navigations.at(-1), ["AddSpeciesRequest", { botanist: { id: "owner" }, formDraftKey: "species-new" }]);
  assert.equal(route.params.openDraftKey, undefined, "auto-saved draft resumes through the existing form route");

  route.params.openDraftKey = "correction-1";
  render();
  focus(); await new Promise((resolve) => setImmediate(resolve));
  render();
  assert.deepEqual(navigations.at(-1), ["FieldCollectionEdit", { botanist: { id: "owner" }, draft: storedDrafts.find((draft) => draft.client_key === "correction-1") }]);
  assert.equal(route.params.openDraftKey, undefined, "consumed resume target is cleared to prevent duplicate navigation");
});
