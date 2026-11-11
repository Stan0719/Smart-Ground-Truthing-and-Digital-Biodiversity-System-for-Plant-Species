import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const React = require("react");
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

function makeScreen({ language = "en", species = null, fetchSpeciesDetail = async () => null } = {}) {
  const state = [];
  const refs = [];
  let stateIndex = 0;
  let refIndex = 0;
  let focus;
  const navigations = [];
  const hooks = {
    ...React,
    useState(initialValue) {
      const index = stateIndex++;
      if (!(index in state)) state[index] = initialValue;
      return [state[index], (next) => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
    },
    useRef(initialValue) {
      const index = refIndex++;
      if (!(index in refs)) refs[index] = { current: initialValue };
      return refs[index];
    },
    useCallback: (callback) => callback,
  };
  const native = { StyleSheet: { create: (styles) => styles } };
  for (const type of ["View", "Text", "ScrollView", "TouchableOpacity", "Image", "RefreshControl"]) native[type] = type;
  const source = read("../screens/SpeciesDetail.js");
  const compiled = ts.transpileModule(source, {
    fileName: "SpeciesDetail.jsx",
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies = {
    react: hooks,
    "react-native": native,
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "../translations/i18n": { t: (key) => key === "plant.back" ? ({ en: "Back", ms: "Kembali", zh: "返回" })[language] : key, useAppTranslation() {}, translateLabel: (value) => value, translateUIMessage: (value) => value, translateFieldValue: (_label, value) => value },
    "../data/mockData": { getSpeciesBySlug: () => null },
    "@react-navigation/native": { useFocusEffect: (callback) => { focus = callback; } },
    "../data/speciesImages": { getSpeciesImageSource: () => null },
    "../components/BackButton": { default: "TouchableOpacity" },
    "../utils/plantApi": { fetchPlantRecords: async () => [], fetchSpeciesDetail, filterUniqueSpeciesPlantRecords: (records) => records, isPlantVisibleInRoleCatalog: () => true },
    "../components/PlantCard": { default: "PlantCard" },
    "../components/RefreshButton": { default: "RefreshButton" },
    "../components/FavouriteHeart": { default: "FavouriteHeart" },
    "../hooks/useVisitorFavourites": { default: () => ({ isFavourite: () => false, isPending: () => false, loading: false, refreshing: false, mutationError: "", refresh: async () => {}, toggle: async () => {} }) },
    "../components/BotanicalSkeleton": { DetailSkeletonContent: "DetailSkeletonContent" },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    assert.ok(name in dependencies, `Unexpected import ${name}`);
    const dependency = dependencies[name];
    return name === "react" ? dependency : { ...dependency, __esModule: true };
  }, module, module.exports);
  const screen = module.exports.default;
  const navigation = { goBack: () => navigations.push("back"), navigate: (...args) => navigations.push(args) };
  const render = () => {
    stateIndex = 0;
    refIndex = 0;
    return screen({ route: { params: species ? { species } : { slug: "not-in-mock", speciesId: "6" } }, navigation, user: null });
  };
  const children = (node) => node && typeof node === "object" ? React.Children.toArray(node.props?.children) : [];
  const allNodes = (root) => [root, ...children(root).flatMap(allNodes)];
  return { render, get focus() { return focus; }, navigations, allNodes };
}

function assertOneWorkingBackButton(fixture, tree, expectedLabel) {
  assert.equal(tree.type, "SafeAreaView", "the screen content begins below the device status area");
  const buttons = fixture.allNodes(tree).filter((node) => node?.type === "TouchableOpacity" && node.props.label === expectedLabel && node.props.onPress);
  assert.equal(buttons.length, 1, "the screen renders exactly one Back control");
  assert.equal(buttons[0].props.label, expectedLabel);
  assert.equal(buttons[0].props.variant, "plain", "Back uses the compact, borderless shared style");
  assert.deepEqual(buttons[0].props.style, { alignSelf: "flex-start", maxWidth: "100%" });
  const backRow = fixture.allNodes(tree).find((node) => node?.props?.style?.alignItems === "flex-start" && node.props.style.paddingHorizontal === 20);
  assert.ok(backRow, "Back is in a left-aligned row in every screen state");
  assert.equal(backRow.props.style.paddingHorizontal, 20, "Back aligns with the content inset");
  buttons[0].props.onPress();
  assert.deepEqual(fixture.navigations, ["back"], "Back returns through the existing navigation history");
}

test("Species Detail has one localized safe-area Back control in loading, success, empty, and error states", async () => {
  for (const language of ["en", "ms", "zh"]) {
    const loading = makeScreen({ language });
    let tree = loading.render();
    assert.ok(loading.allNodes(tree).some((node) => node?.type === "DetailSkeletonContent"), "loading skeleton remains visible");
    assertOneWorkingBackButton(loading, tree, { en: "Back", ms: "Kembali", zh: "返回" }[language]);

    const success = makeScreen({ language, species: { id: "6", slug: "species-six", name: "Species Six", scientificName: "Species six" } });
    tree = success.render();
    assertOneWorkingBackButton(success, tree, { en: "Back", ms: "Kembali", zh: "返回" }[language]);

    const empty = makeScreen({ language, fetchSpeciesDetail: async () => null });
    empty.render();
    empty.focus();
    await new Promise((resolve) => setImmediate(resolve));
    tree = empty.render();
    assert.ok(empty.allNodes(tree).some((node) => node?.props?.children === "plant.speciesNotFound"));
    assertOneWorkingBackButton(empty, tree, { en: "Back", ms: "Kembali", zh: "返回" }[language]);

    const failed = makeScreen({ language, fetchSpeciesDetail: async () => { throw new Error("Offline"); } });
    failed.render();
    failed.focus();
    await new Promise((resolve) => setImmediate(resolve));
    tree = failed.render();
    assert.ok(failed.allNodes(tree).some((node) => node?.props?.children === "plant.speciesDetailsUnavailable"));
    assertOneWorkingBackButton(failed, tree, { en: "Back", ms: "Kembali", zh: "返回" }[language]);
  }
});

test("Species Detail stacks keep native headers hidden so the screen renders no duplicate header Back control", () => {
  const app = read("../App.js");
  const matches = app.match(/name="SpeciesDetail"[\s\S]{0,100}?headerShown: false/g) || [];
  assert.ok(matches.length >= 2, "Plants and Account stacks use the in-screen Back control without native headers");
});
