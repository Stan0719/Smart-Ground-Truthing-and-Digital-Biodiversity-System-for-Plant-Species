import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
const require = createRequire(import.meta.url), ts = require("typescript"), React = require("react");
const read = (file) => readFileSync(new URL("../" + file, import.meta.url), "utf8");
function moduleFrom(file, deps) {
  const code = ts.transpileModule(read(file), { fileName: file.endsWith("Screen.js") ? file + ".jsx" : file.replace(/\.js$/, ".jsx"), compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)((name) => { assert.ok(name in deps, name); return { ...deps[name], __esModule: name !== "react" }; }, module, module.exports);
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
  const api = fixture(async (path, options) => { calls.push([path, options]); return path === "/plants?scope=mine" ? { plants: rows } : path === "/plants/8?scope=mine" ? { plant: rows[0] } : path === "/observations?scope=mine" ? { observations } : { species_requests: requests }; });
  const result = await api.fetchBotanistRecords("owner"); assert.equal(result.plants.length, 1);
  assert.equal(calls.length, 3); assert.ok(calls.every(([, options]) => options.expectedAccountId === "owner"));
  const detail = await api.fetchBotanistPlant("owner", "8");
  assert.equal(detail.photos[0].owner, "owner"); assert.equal(detail.photos[0].uri, "https://example.invalid/assets/asset-8");
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
  const native = { StyleSheet: { create: (v) => v }, Alert: { alert: () => {} } };
  for (const name of ["View", "Text", "TextInput", "TouchableOpacity", "ScrollView", "Image"]) native[name] = name;
  const record = fixture().projectBotanistRecords("owner", rows, observations, requests).plants[0];
  record.photos = [{ uri: "https://example.invalid/assets/private", headers: { Authorization: "Bearer test-only" } }];
  const screen = moduleFrom("screens/BotanistPlantDetail.js", { react: hooks, "react-native": native,
    "@react-navigation/native": { useFocusEffect: (fn) => { focus = fn; } },
    "../utils/botanistRecords": { fetchBotanistPlant: async (...args) => { requested = args; return record; }, fetchBotanistRecordChanges: async () => [] },
    "../translations/i18n": { useAppTranslation: () => {}, t, translateLabel: (v) => v, translateFieldValue: (_, v) => v, translateUIMessage: (v) => v },
    "../data/mockData": { botanistPlantRecords: [], botanistSpeciesRequests: [], plants: [] },
    "../components/EditAction": { default: "EditAction" },
  });
  const render = () => { index = 0; return screen.default({ route: { params: { plantId: "8", botanist: { id: "owner", name: "Owner" } } }, navigation: {} }); };
  render(); const cleanup = focus(); await new Promise((resolve) => setImmediate(resolve)); const tree = render();
  assert.deepEqual(requested, ["owner", "8"]);
  const children = (node) => node && typeof node === "object" ? React.Children.toArray(node.props?.children) : [];
  const text = (node) => typeof node === "string" ? node : children(node).map(text).join(" ");
  function find(predicate, node) { if (predicate(node)) return node; for (const child of children(node)) { const result = find(predicate, child); if (result) return result; } }
  assert.ok(text(tree).includes("Manual plant name")); assert.ok(text(tree).includes("Different species name"));
  assert.ok(text(tree).includes("Pending Review")); assert.ok(find((n) => n?.type === "EditAction" && n.props.testID === "edit-own-plant", tree));
  assert.equal(find((n) => n?.type === "Image", tree).props.source.headers.Authorization, "Bearer test-only");
  cleanup();
  record.status = "Approved";
  render(); const approvedCleanup = focus(); await new Promise((resolve) => setImmediate(resolve));
  assert.ok(find((n) => n?.type === "EditAction" && n.props.testID === "edit-own-plant", render()));
  approvedCleanup();
});

for (const language of ["en", "ms"]) {
  test(`${language}: separate tabs, independent filters and correct card navigation`, () => {
    const messages = JSON.parse(read(`translations/${language}.json`));
    const t = (key, values = {}) => key.split(".").reduce((a, k) => a?.[k], messages)?.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key]) || key;
    let index = 0, slots = [], refreshes = 0; const navigations = [];
    const projected = fixture().projectBotanistRecords("owner", rows, observations, requests);
    projected.requests[0] = { ...projected.requests[0], genus_name: "Genus value", family_name: "Family value" };
    const native = { StyleSheet: { create: (v) => v } }; for (const name of ["View", "Text", "TouchableOpacity", "FlatList", "Image"]) native[name] = name;
    const screen = moduleFrom("screens/BotanistDashboard.js", {
      react: { ...React, useState: (initial) => { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], (next) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; } }, "react-native": native,
      "../translations/i18n": { useAppTranslation: () => {}, t, translateLabel: (value) => value, translateUIMessage: (v) => v },
      "../components/LanguageSelector": { default: "LanguageSelector" }, "@expo/vector-icons/Ionicons": { default: "Icon" },
      "../utils/botanistRecords": fixture(),
      "../utils/useBotanistNotifications": { useBotanistNotifications: () => ({ unreadCount: 0 }) },
      "../utils/useBotanistRecords": { useBotanistRecords: () => ({ ...projected, loaded: true, loading: false, error: "", refresh: () => { refreshes++; } }) },
    });
    let tree; const render = () => { index = 0; tree = screen.default({ route: { params: { botanist: { id: "owner" } } }, navigation: { navigate: (...args) => navigations.push(args) } }); };
    function children(node) { if (!node || typeof node !== "object") return []; if (node.type === "FlatList") return [node.props.ListHeaderComponent, ...node.props.data.map((item) => node.props.renderItem({ item }))]; return React.Children.toArray(node.props?.children); }
    const text = (node) => typeof node === "string" ? node : children(node).map(text).join(" ");
    function find(predicate, node = tree) { if (predicate(node)) return node; for (const child of children(node)) { const found = find(predicate, child); if (found) return found; } }
    function assertNativeText(node, insideText = false) {
      if (typeof node === "string" || typeof node === "number") {
        if (String(node).length) assert.ok(insideText, `Raw native text outside Text: ${JSON.stringify(node)}`);
        return;
      }
      const nextInsideText = node?.type === "Text" || (node?.type === React.Fragment && insideText);
      for (const child of children(node)) assertNativeText(child, nextInsideText);
    }
    const pressText = (label, role = "button") => { const node = find((n) => n?.type === "TouchableOpacity" && n.props.accessibilityRole === role && text(n) === label); assert.ok(node, label); node.props.onPress(); render(); };
    render(); assertNativeText(tree); let list = find((n) => n?.type === "FlatList"); assert.equal(list.props.data[0].id, "8");
    const plantCard = list.props.renderItem({ item: list.props.data[0] }); assert.ok(text(plantCard).includes("Manual plant name")); assert.ok(text(plantCard).includes("Different species name")); plantCard.props.onPress();
    assert.equal(navigations[0][0], "BotanistPlantDetail"); assert.equal(navigations[0][1].plantId, "8");
    pressText(t("submissions.pending")); assert.equal(slots[1].plants, "pending");
    const requestTab = find((n) => n?.props?.accessibilityRole === "tab" && text(n).includes(t("botanistRecords.speciesRequests"))); requestTab.props.onPress(); render();
    list = find((n) => n?.type === "FlatList"); assert.equal(list.props.data.length, 1); assert.equal(list.props.data[0].request_id, 1); assert.equal(slots[1].requests, "all");
    const requestCard = list.props.renderItem({ item: list.props.data[0] }); assert.ok(text(requestCard).includes("Genus value")); assert.ok(text(requestCard).includes("Pending Review")); requestCard.props.onPress();
    assert.equal(navigations[1][0], "BotanistSpeciesRequestDetail"); assert.equal(navigations[1][1].requestId, "1");
    pressText(t("submissions.rejected")); assert.equal(find((n) => n?.type === "FlatList").props.data.length, 0);
    assert.equal(slots[1].plants, "pending"); list.props.onRefresh(); assert.equal(refreshes, 1);
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

test("read-only request detail renders actual fields, review metadata and authenticated photo", async () => {
  let index = 0, slots = [], focus, requested;
  const hooks = { ...React, useCallback: (fn) => fn, useState: (initial) => { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], (next) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; } };
  const native = { StyleSheet: { create: (v) => v } }; for (const name of ["View", "Text", "ScrollView", "Image", "TouchableOpacity", "ActivityIndicator", "RefreshControl"]) native[name] = name;
  const record = { ...requests[0], genus_name: "Actual genus", family_name: "Actual family", conservation_status: "Endangered", description: "Actual description", habitat: "Actual habitat", submitted_at: "2026-11-03T01:00:00Z", review_comment: "Actual reviewer comment", photo: { uri: "https://example.invalid/photo", headers: { Authorization: "Bearer fixture" } } };
  const screen = moduleFrom("screens/BotanistSpeciesRequestDetail.js", {
    react: hooks, "react-native": native, "@react-navigation/native": { useFocusEffect: (fn) => { focus = fn; } },
    "../utils/botanistRecords": { submissionStatus: fixture().submissionStatus, fetchBotanistSpeciesRequest: async (...args) => { requested = args; return record; }, fetchBotanistRecordChanges: async () => [] },
    "../translations/i18n": { useAppTranslation: () => {}, t: (v) => v, translateLabel: (v) => v, translateUIMessage: (v) => v },
    "../components/EditAction": { default: "EditAction" },
  });
  const render = () => { index = 0; return screen.default({ route: { params: { requestId: "1", botanist: { id: "owner" } } } }); };
  render(); const cleanup = focus(); await new Promise((r) => setImmediate(r)); const tree = render();
  const children = (node) => node && typeof node === "object" ? React.Children.toArray(node.props?.children) : [];
  const text = (node) => typeof node === "string" ? node : children(node).map(text).join(" ");
  for (const value of ["Different species name", "Common species name", "Actual genus", "Actual family", "Endangered", "Actual description", "Actual habitat", "Pending Review", "Actual reviewer comment"]) assert.ok(text(tree).includes(value), value);
  assert.deepEqual(requested, ["owner", "1"]); assert.ok(!text(tree).includes("Delete")); cleanup();
  record.request_status = "Approved";
  render(); const approvedCleanup = focus(); await new Promise((resolve) => setImmediate(resolve));
  const approvedTree = render();
  function find(predicate, node) { if (predicate(node)) return node; for (const child of children(node)) { const result = find(predicate, child); if (result) return result; } }
  assert.ok(find((node) => node?.type === "EditAction" && node.props.testID === "edit-own-species", approvedTree));
  approvedCleanup();
});
