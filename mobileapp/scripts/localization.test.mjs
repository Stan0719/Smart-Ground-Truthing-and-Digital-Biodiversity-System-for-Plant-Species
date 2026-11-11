import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { createLocalization, createDisplayTranslator, createFieldValueTranslator, flattenTranslations, LANGUAGE_STORAGE_KEY, supportedLanguages } from "../translations/core.js";
import { A4_PRINT_OPTIONS, buildQRPrintHtml } from "../utils/qrPrint.js";
import { validateSpeciesRequest, validatePlantDetails } from "../utils/addPlantValidation.js";

const require = createRequire(import.meta.url);
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;
const React = require("react");
const ts = require("typescript");
const root = new URL("../", import.meta.url);
const en = JSON.parse(readFileSync(new URL("translations/en.json", root), "utf8"));
const ms = JSON.parse(readFileSync(new URL("translations/ms.json", root), "utf8"));
const zh = JSON.parse(readFileSync(new URL("translations/zh.json", root), "utf8"));
const resources = () => ({ en: { translation: structuredClone(en) }, ms: { translation: structuredClone(ms) }, zh: { translation: structuredClone(zh) } });
function fixture(initial = null) {
  const saved = new Map(initial ? [[LANGUAGE_STORAGE_KEY, initial]] : []);
  const storage = { getItem: async (key) => saved.get(key) || null, setItem: async (key, value) => saved.set(key, value) };
  return { saved, storage, ...createLocalization({ storage, resources: resources() }) };
}

test("first launch defaults to English and invalid saved preferences fall back to English", async () => {
  assert.deepEqual(supportedLanguages, ["en", "ms", "zh"]);
  for (const initial of [null, "xx", "", "BM"]) {
    const app = fixture(initial);
    await app.restoreLanguage();
    assert.equal(app.i18n.resolvedLanguage, "en");
    assert.equal(app.i18n.t("common.cancel"), "Cancel");
  }
});

test("English, Bahasa Melayu and Simplified Chinese switching is immediate and restores after restart", async () => {
  const app = fixture();
  const changes = [];
  app.i18n.on("languageChanged", (language) => changes.push(language));
  const changing = app.changeLanguage("ms");
  assert.equal(app.i18n.t("common.cancel"), "Batal");
  await changing;
  const restart = createLocalization({ storage: app.storage, resources: resources() });
  await restart.restoreLanguage();
  assert.equal(restart.i18n.t("common.cancel"), "Batal");
  await restart.changeLanguage("zh");
  assert.equal(restart.i18n.t("common.cancel"), "取消");
  const chineseRestart = createLocalization({ storage: app.storage, resources: resources() });
  await chineseRestart.restoreLanguage();
  assert.equal(chineseRestart.i18n.resolvedLanguage, "zh");
  assert.equal(chineseRestart.i18n.t("common.cancel"), "取消");
  await restart.changeLanguage("en");
  assert.equal(restart.i18n.t("common.cancel"), "Cancel");
  assert.equal(app.saved.get(LANGUAGE_STORAGE_KEY), "en");
  assert.deepEqual(changes, ["ms"]);
  assert.equal(app.i18n.services.backendConnector.backend == null, true);
});

test("storage failures do not block UI switching or startup; saves are ordered", async () => {
  const failed = createLocalization({ resources: resources(), storage: {
    getItem: async () => { throw Error("Storage unavailable"); }, setItem: async () => { throw Error("Disk full"); },
  } });
  await failed.restoreLanguage();
  assert.equal(failed.i18n.language, "en");
  await assert.rejects(failed.changeLanguage("ms"), /Disk full/);
  assert.equal(failed.i18n.t("common.cancel"), "Batal");
  await assert.rejects(failed.changeLanguage("xx"), /Unsupported/);
  const app = fixture();
  await Promise.all([app.changeLanguage("ms"), app.changeLanguage("en"), app.changeLanguage("ms")]);
  assert.equal(app.saved.get(LANGUAGE_STORAGE_KEY), "ms");
});

test("a slow preference restore cannot overwrite a newer user selection", async () => {
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  const app = createLocalization({ resources: resources(), storage: { getItem: () => pending, setItem: async () => {} } });
  const restoring = app.restoreLanguage();
  await app.changeLanguage("en");
  resolve("ms");
  await restoring;
  assert.equal(app.i18n.language, "en");
});

test("all three catalogues have identical keys, nonempty translations and matching interpolation slots", () => {
  const english = new Map(flattenTranslations(en)), malay = new Map(flattenTranslations(ms)), chinese = new Map(flattenTranslations(zh));
  assert.deepEqual([...english.keys()].sort(), [...malay.keys()].sort());
  assert.deepEqual([...english.keys()].sort(), [...chinese.keys()].sort());
  assert.ok(english.size > 850);
  const slots = (value) => [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();
  for (const [key, value] of english) {
    assert.ok(malay.get(key).trim(), `Empty Malay translation: ${key}`);
    assert.ok(chinese.get(key).trim(), `Empty Chinese translation: ${key}`);
    assert.deepEqual(slots(value), slots(malay.get(key)), `Interpolation mismatch: ${key}`);
    assert.deepEqual(slots(value), slots(chinese.get(key)), `Chinese interpolation mismatch: ${key}`);
    assert.equal(malay.get(key).includes("\\\n"), false, `Stray newline escape: ${key}`);
  }
  const intentionalEnglish = new Set(["common.english", "common.bahasaMelayu", "addPlant.label"]);
  for (const [key, value] of english) {
    if (chinese.get(key) === value) assert.ok(intentionalEnglish.has(key), `Untranslated Chinese entry: ${key}`);
  }
  assert.equal(zh.common.cancel, "取消");
  assert.equal(zh.navigation.plantDetails, "植物详情");
  assert.equal(zh.plantQRCode.qrCodeStatus, "二维码状态");
});

test("missing localized entries fall back to English, while dynamic IDs and scientific names are preserved", async () => {
  const data = resources();
  delete data.ms.translation.common.cancel;
  delete data.zh.translation.common.cancel;
  const app = createLocalization({ storage: { getItem: async () => null, setItem: async () => {} }, resources: data });
  await app.changeLanguage("ms");
  assert.equal(app.i18n.t("common.cancel"), "Cancel");
  await app.changeLanguage("zh");
  assert.equal(app.i18n.t("common.cancel"), "Cancel");
  assert.equal(app.i18n.t("common.ok"), "确定");
  await app.changeLanguage("ms");
  assert.equal(app.i18n.t("plantQRCode.generatedReady", { count: 2 }), "2 kod QR boleh cetak telah tersedia.");
  assert.equal(app.i18n.t("notifications.plant", { plantId: "12345" }), "Tumbuhan 12345");
  const display = createDisplayTranslator(app.i18n, en);
  assert.equal(display.label("Approved"), "Diluluskan");
  assert.equal(display.label("Correction Required"), "Pembetulan Diperlukan");
  assert.equal(display.label("Nepenthes rafflesiana"), "Nepenthes rafflesiana");
  assert.equal(display.message("Custom Officer feedback stays unchanged."), "Custom Officer feedback stays unchanged.");
  assert.equal(display.message("3 draft(s) synchronized."), "3 draf telah disegerakkan.");
  const backendRecord = { status: "Approved", scientific_name: "Nepenthes rafflesiana", qr_code: "raw-token-123", notes: "Healthy" };
  const copy = structuredClone(backendRecord);
  display.label(backendRecord.status);
  assert.deepEqual(backendRecord, copy);
  const field = createFieldValueTranslator(display.label, en, ms, zh);
  assert.equal(field("Status Kesihatan", "Healthy"), "Sihat");
  assert.equal(field("Peringkat Hidup", "Mature"), "Matang");
  await app.changeLanguage("zh");
  assert.equal(field("健康状况", "Healthy"), "健康");
  assert.equal(field("生长阶段", "Mature"), "成熟");
  assert.equal(field("Catatan", "Healthy"), "Healthy");
  assert.equal(field("Nama saintifik", "Nepenthes rafflesiana"), "Nepenthes rafflesiana");
});

const sourceFiles = () => ["App.js", ...["screens", "components"].flatMap((directory) => readdirSync(new URL(directory + "/", root)).filter((name) => name.endsWith(".js")).map((name) => directory + "/" + name)), "src/app/forgot-password.js", "translations/notifications.js"];
test("every static translation key resolves in both languages and every screen subscribes to changes", () => {
  const app = fixture();
  for (const file of sourceFiles()) {
    const source = readFileSync(new URL(file, root), "utf8");
    const ast = parser.parse(source, { sourceType: "module", plugins: ["jsx"] });
    traverse(ast, {
      CallExpression(path) {
        const node = path.node;
        if (node.callee.name !== "t" || node.arguments[0]?.type !== "StringLiteral") return;
        const key = node.arguments[0].value;
        for (const lng of ["en", "ms", "zh"]) assert.ok(app.i18n.exists(key, { lng, count: 2 }), `Missing ${lng} key ${key} in ${file}`);
      },
      FunctionDeclaration(path) {
        if (!path.node.id || !/^[A-Z]/.test(path.node.id.name) || path.findParent((parent) => parent.isFunction())) return;
        if (!source.includes("translations/i18n")) return;
        const first = path.node.body.body[0];
        const hook = first?.expression?.callee?.name || first?.declarations?.[0]?.init?.callee?.name;
        assert.equal(hook, "useAppTranslation", `No language subscription: ${file}:${path.node.id.name}`);
      },
    });
  }
});

test("API calls, route targets, auth checks and canonical status comparisons match the contract", () => {
  const contracts = JSON.parse(readFileSync(new URL("localization-contract.json", import.meta.url), "utf8"));
  let count = 0;
  for (const [file, expected] of Object.entries(contracts)) {
    const actual = [];
    traverse(parser.parse(readFileSync(new URL(file, root), "utf8"), { sourceType: "module", plugins: ["jsx"] }), {
      CallExpression(path) {
        const node = path.node, callee = node.callee;
        const name = callee.type === "Identifier" ? callee.name : callee.type === "MemberExpression" && ["faceSession", "navigation", "router"].includes(callee.object.name) ? callee.object.name + "." + callee.property.name : null;
        if (["plantApi", "faceApi", "fetch", "probeAuthConnection", "changeFirstLoginPassword"].includes(name) || name?.startsWith("faceSession.") || name?.startsWith("navigation.") || name?.startsWith("router.")) actual.push(generate(node, { compact: true, comments: false }).code);
      },
      BinaryExpression(path) {
        if (["===", "!=="].includes(path.node.operator) && [path.node.left, path.node.right].some((node) => node.type === "StringLiteral")) actual.push(generate(path.node, { compact: true, comments: false }).code);
      },
    });
    assert.deepEqual(actual, expected, `Behavior changed in ${file}`);
    count += actual.length;
  }
  assert.equal(count, 256);
});

function screenFixture(name, app, stateValues = [], notificationItems = []) {
  let index = 0;
  const alerts = [], network = [], printJobs = [];
  const hooks = { ...React, useEffect: () => {}, useCallback: (fn) => fn, useMemo: (fn) => fn(), useRef: (value) => ({ current: value }), useState: (initial) => [index < stateValues.length ? stateValues[index++] : (index++, typeof initial === "function" ? initial() : initial), () => {}] };
  const native = { StyleSheet: { create: (value) => value }, Alert: { alert: (...args) => alerts.push(args) }, Platform: { OS: "android" } };
  for (const component of ["View", "Text", "TextInput", "TouchableOpacity", "ScrollView", "FlatList", "ActivityIndicator", "RefreshControl", "Image"]) native[component] = component;
  const display = createDisplayTranslator(app.i18n, en);
  const ui = { t: (key, values) => app.i18n.t(key, values), translateLabel: display.label, translateUIMessage: display.message, useAppTranslation: () => ({ i18n: app.i18n }), formatDateTime: (value) => new Date(value).toISOString() };
  const deps = {
    react: hooks, "react-native": native, "@react-navigation/native": { useFocusEffect: () => {} },
    "../translations/i18n": ui, "../components/LanguageSelector": { default: "LanguageSelector" },
    "../components/QRRefreshButton": { default: "QRRefreshButton" }, "../components/RefreshButton": { default: "RefreshButton" }, "@expo/vector-icons/Ionicons": { default: "Icon" },
    "../components/fieldFormStyles": { fieldFormStyles: native.StyleSheet.create(Object.fromEntries(["container", "scrollView", "scrollContent", "card", "sectionTitle", "label", "input", "textArea", "locationButton", "locationButtonText", "photoButtonRow", "photoButton", "photoButtonText", "photoPreview", "removePhotoButton", "submitButton", "submitButtonText"].map((key) => [key, {}]))) },
    "react-native-qrcode-svg": { default: "QRCode" }, "expo-location": {}, "expo-image-picker": {}, "expo-file-system/legacy": {}, "expo-print": { printAsync: async (job) => printJobs.push(job) },
    "../utils/plantApi": { plantApi: (...args) => { network.push(args); return Promise.resolve({ deleted: true }); } },
    "../utils/addPlantValidation": { validateSpeciesRequest, validatePlantDetails },
    "../utils/qrInventory": { createQRInventoryLoader: () => ({ getState: () => ({ loading: false }), refresh: async () => { network.push(["inventory-refresh"]); return true; }, addGenerated: () => 1, removeDeleted: (id) => network.push(["inventory-remove", id]) }), emptyQRInventory: () => ({ records: [], loading: true, hasLoaded: false, error: "" }) },
    "../utils/qrPrint": { A4_PRINT_OPTIONS, buildQRPrintHtml }, "../data/mockData": { botanistPlantRecords: [] },
    "../utils/useBotanistNotifications": { useBotanistNotifications: () => ({ items: notificationItems, loading: false, loaded: true, error: "", unreadCount: notificationItems.filter((item) => !item.read).length }) },
    "../utils/useBotanistRecords": { useBotanistRecords: () => ({ plants: [], observations: [], requests: [], loading: false, loaded: true, error: "", refresh: async () => {} }) },
    "../utils/botanistRecords": { submissionStatus: (value) => String(value).toLowerCase() === "pending review" ? "pending" : String(value).toLowerCase() },
    "../utils/botanistNotifications": {}, "../utils/fieldStorage": {},
    "../utils/botanistNotificationStore": { notificationPresentation: { observation_approved: { title: "Observation Approved", icon: "checkmark-circle-outline" } } },
    "../translations/notifications": { localizedNotificationMessage: (item) => `${app.i18n.t("notifications.plant", { plantId: item.plantId })}: ${item.comment}` },
  };
  const code = ts.transpileModule(readFileSync(new URL(`screens/${name}.js`, root), "utf8"), { fileName: name + ".jsx", compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)((dependency) => {
    assert.ok(dependency in deps, `Unexpected screen dependency: ${dependency}`);
    return { ...deps[dependency], __esModule: dependency !== "react" };
  }, module, module.exports);
  const tree = module.exports.default({ route: { params: { botanist: { id: "owner", name: "Aina" } } }, navigation: {}, user: { id: "owner", role: "botanist" } });
  return { tree, alerts, network, printJobs };
}
function children(node) {
  if (!node || typeof node !== "object") return [];
  if (node.type === "FlatList") return [node.props.ListHeaderComponent, ...node.props.data.map((item, index) => node.props.renderItem({ item, index })), ...(node.props.data.length ? [] : [node.props.ListEmptyComponent])];
  return React.Children.toArray(node.props?.children);
}
function text(node) { return typeof node === "string" ? node : children(node).map(text).join(" "); }
function find(node, predicate) { if (predicate(node)) return node; for (const child of children(node)) { const match = find(child, predicate); if (match) return match; } }

test("actual Dashboard, Add Plant, QR and Notification screens render all three languages without changing record content", async () => {
  const app = fixture();
  const code = { id: "17", label: "QR-0017", plantId: null, value: "DO-NOT-TRANSLATE-TOKEN", status: "generated" };
  const item = { id: "event-1", type: "observation_approved", plantId: "17", createdAt: "2026-11-02T02:00:00Z", read: false, comment: "Officer original comment: Healthy leaves." };
  for (const language of ["en", "ms", "zh", "en"]) {
    await app.changeLanguage(language);
    const dashboard = screenFixture("BotanistDashboard", app);
    const dashboardLabel = language === "ms" ? "Urus rekod tumbuhan anda" : language === "zh" ? "管理您的植物记录" : "Manage your plant records";
    assert.ok(text(dashboard.tree).includes(dashboardLabel));
    const add = screenFixture("AddPlant", app);
    const selectSpecies = language === "ms" ? "Pilih Spesies Sedia Ada" : language === "zh" ? "选择已有物种 *" : "Select Existing Species *";
    const addPlantRecord = language === "ms" ? "Tambah Rekod Tumbuhan" : language === "zh" ? "添加植物记录" : "Add Plant Record";
    assert.ok(text(add.tree).includes(selectSpecies));
    assert.ok(text(add.tree).includes(addPlantRecord));
    await find(add.tree, (node) => node?.type === "TouchableOpacity" && text(node) === addPlantRecord).props.onPress();
    assert.equal(add.alerts[0][0], app.i18n.t("addObservation.missingInformation"));
    const qr = screenFixture("PlantQRCode", app, ["3", { records: [code], hasLoaded: true, loading: false, error: "" }, false, null]);
    assert.ok(text(qr.tree).includes(language === "ms" ? "Jana Kod QR" : language === "zh" ? "生成二维码" : "Generate QR Codes"));
    assert.ok(text(qr.tree).includes("QR-0017"));
    assert.equal(find(qr.tree, (node) => node?.type === "QRCode")?.props.value, code.value);
    await find(qr.tree, (node) => node?.props?.accessibilityLabel === (language === "ms" ? "Cetak QR-0017" : language === "zh" ? "打印 QR-0017" : "Print QR-0017")).props.onPress();
    assert.equal(qr.printJobs.length, 1);
    assert.equal(qr.printJobs[0].width, A4_PRINT_OPTIONS.width);
    assert.equal(qr.printJobs[0].height, A4_PRINT_OPTIONS.height);
    assert.ok(qr.printJobs[0].html.includes("QR-0017"));
    assert.ok(qr.printJobs[0].html.includes(language === "ms" ? "Tag pengenalan tumbuhan" : language === "zh" ? "植物识别标签" : "Plant identification tag"));
    const deleteButton = find(qr.tree, (node) => node?.props?.accessibilityLabel === app.i18n.t("plantQRCode.deleteQrCode", { label: code.label }));
    assert.equal(deleteButton?.props.disabled, false);
    const notifications = screenFixture("BotanistNotifications", app, [], [item]);
    assert.ok(text(notifications.tree).includes(language === "ms" ? "Pemerhatian Diluluskan" : language === "zh" ? "观察记录已批准" : "Observation Approved"));
    assert.ok(text(notifications.tree).includes(item.comment));
    assert.deepEqual([...dashboard.network, ...add.network, ...qr.network, ...notifications.network], []);
  }
});

test("QR inventory confirms deletion, calls the selected QR endpoint, and refreshes", async () => {
  const app = fixture();
  const code = { id: "17", label: "QR-0017", plantId: null, value: "stable-qr-payload", status: "generated" };
  const retired = { id: "18", label: "QR-0018", plantId: null, value: "retired-payload", status: "retired" };
  const qr = screenFixture("PlantQRCode", app, ["3", { records: [code, retired], hasLoaded: true, loading: false, error: "" }, false, null, null]);
  const button = find(qr.tree, (node) => node?.props?.accessibilityLabel === app.i18n.t("plantQRCode.deleteQrCode", { label: code.label }));
  assert.equal(button?.props.disabled, false);
  assert.equal(find(qr.tree, (node) => node?.props?.accessibilityLabel === app.i18n.t("plantQRCode.deleteQrCode", { label: retired.label })), undefined);
  assert.ok(text(qr.tree).includes(app.i18n.t("plantQRCode.retired")));
  button.props.onPress();
  assert.equal(qr.alerts[0][0], app.i18n.t("plantQRCode.confirmDeleteQrCodeTitle"));
  const destructive = qr.alerts[0][2].find((action) => action.style === "destructive");
  assert.ok(destructive);
  destructive.onPress();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(qr.network.some(([path, options]) => path === "/qr-codes/17" && options.method === "DELETE" && options.expectedAccountId === "owner"));
  assert.ok(qr.network.some(([action, id]) => action === "inventory-remove" && id === "17"));
  assert.ok(qr.network.some(([action]) => action === "inventory-refresh"));
});

test("language selector exposes the English, Bahasa Melayu and 中文 options", () => {
  const source = readFileSync(new URL("components/LanguageSelector.js", root), "utf8");
  assert.match(source, /name: "English"/);
  assert.match(source, /name: "Bahasa Melayu"/);
  assert.match(source, /name: "中文"/);
  assert.match(source, /code: "zh"/);
});
