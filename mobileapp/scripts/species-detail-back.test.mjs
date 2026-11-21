import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const React = require("react");
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const compile = (path) => ts.transpileModule(read(path), { fileName: path, compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
const recordsModule = { exports: {} };
new Function("require", "module", "exports", compile("../utils/botanistRecords.js"))(
  () => ({}), recordsModule, recordsModule.exports,
);
const orderingModule = { exports: {} };
new Function("require", "module", "exports", compile("../utils/speciesPlantOrdering.js"))(
  () => ({ submissionStatus: recordsModule.exports.submissionStatus }), orderingModule, orderingModule.exports,
);

function makeScreen({ language = "en", species = null, fetchSpeciesDetail = async () => null, user = null,
  records = [], imageSource = () => null } = {}) {
  const state = [];
  const refs = [];
  let stateIndex = 0;
  let refIndex = 0;
  let focus;
  const navigations = [];
  const favouriteCalls = [];
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
    useMemo: (compute) => compute(),
  };
  const native = { StyleSheet: { create: (styles) => styles }, useWindowDimensions: () => ({ height: 900, width: 390 }) };
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
    "../data/speciesImages": { getSpeciesImageSource: imageSource },
    "../components/BackButton": { default: "TouchableOpacity" },
    "../utils/plantApi": { fetchPlantRecords: async () => records, fetchSpeciesDetail, filterUniqueSpeciesPlantRecords: (items) => items, isPlantVisibleInRoleCatalog: () => true, isOwnedRejectedPlant: () => false },
    "../components/PlantCard": { default: "PlantCard" },
    "../components/RefreshButton": { default: "RefreshButton" },
    "../components/FavouriteHeart": { default: "FavouriteHeart" },
    "../hooks/useVisitorFavourites": { default: () => ({ isFavourite: () => false, isPending: () => false, loading: false, refreshing: false, mutationError: "", refresh: async (...args) => { favouriteCalls.push(["refresh", ...args]); }, toggle: async (...args) => { favouriteCalls.push(["toggle", ...args]); } }) },
    "../components/BotanicalSkeleton": { DetailSkeletonContent: "DetailSkeletonContent" },
    "../utils/speciesPlantOrdering": orderingModule.exports,
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    if (name === "../components/DiscoverableScrollView") return { default: "ScrollView", __esModule: true };
    assert.ok(name in dependencies, `Unexpected import ${name}`);
    const dependency = dependencies[name];
    return name === "react" ? dependency : { ...dependency, __esModule: true };
  }, module, module.exports);
  const screen = module.exports.default;
  const navigation = { goBack: () => navigations.push("back"), navigate: (...args) => navigations.push(args) };
  const render = () => {
    stateIndex = 0;
    refIndex = 0;
    return screen({ route: { params: species ? { species } : { slug: "not-in-mock", speciesId: "6" } }, navigation, user });
  };
  const children = (node) => node && typeof node === "object" ? React.Children.toArray(node.props?.children) : [];
  const allNodes = (root) => [root, ...children(root).flatMap(allNodes)];
  return { render, get focus() { return focus; }, navigations, favouriteCalls, allNodes };
}

function assertOneWorkingBackButton(fixture, tree, expectedLabel) {
  assert.equal(tree.type, "SafeAreaView", "the screen content begins below the device status area");
  const buttons = fixture.allNodes(tree).filter((node) => node?.type === "TouchableOpacity" && node.props.label === expectedLabel && node.props.onPress);
  assert.equal(buttons.length, 1, "the screen renders exactly one Back control");
  assert.equal(buttons[0].props.label, expectedLabel);
  assert.equal(buttons[0].props.variant, "plain", "Back uses the compact, borderless shared style");
  assert.deepEqual(buttons[0].props.style, { alignSelf: "flex-start", maxWidth: "100%" });
  const backRow = fixture.allNodes(tree).find((node) => node?.props?.style?.alignItems === "center" && node.props.style.paddingHorizontal === 20);
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

test("public Species Detail does not trust a protected Species passed through navigation params", async () => {
  for (const user of [null, { role: "Guest" }, { role: "Visitor" }]) {
    const fixture = makeScreen({ user, species: { id: "99", name: "Private request", scientificName: "Private species" },
      fetchSpeciesDetail: async () => null });
    let tree = fixture.render();
    assert.equal(fixture.allNodes(tree).some((node) => node?.props?.children === "Private species"), false);
    fixture.focus();
    await new Promise((resolve) => setImmediate(resolve));
    tree = fixture.render();
    assert.equal(fixture.allNodes(tree).some((node) => node?.props?.children === "Private species"), false);
  }
});

test("Species Details uses authorized botanical fields and hides unsupported or blank optional sections", async () => {
  const actual = { id: "6", slug: "api-species-6", name: "Common name", scientificName: "Scientific name",
    genus: "Genus", family: "Family", conservationStatus: "Not Assessed",
    description: "Recorded description", habitat: "  ", culturalSignificance: "Recorded cultural use",
    speciesImageVerified: true, image: { uri: "authorized-photo" } };
  const fixture = makeScreen({ user: { id: "botanist", role: "Botanist" },
    species: { ...actual, name: "Stale route name", characteristics: ["Invented characteristic"] },
    fetchSpeciesDetail: async () => actual, imageSource: (item) => item.image });
  assert.equal(fixture.allNodes(fixture.render()).some((node) => node?.props?.children === "Stale route name"), false);
  fixture.focus(); await new Promise((resolve) => setImmediate(resolve));
  const nodes = fixture.allNodes(fixture.render());
  const has = (value) => nodes.some((node) => node?.props?.children === value);
  assert.ok(has("Recorded description"));
  assert.ok(has("Recorded cultural use"));
  assert.equal(has("Stale route name"), false);
  assert.equal(has("Invented characteristic"), false);
  assert.equal(has("speciesDetail.keyCharacteristics"), false);
  assert.equal(has("speciesDetail.naturalHabitat"), false, "whitespace habitat does not leave an empty subsection");
  assert.equal(has("speciesDetail.ecologicalImportance"), false);
  assert.equal(has("speciesDetail.botanicalPhotographs"), false, "no empty gallery section");
  assert.equal(nodes.filter((node) => node?.props?.children === "Recorded description").length, 1);
  assert.ok(nodes.some((node) => node?.type === "Image" && node.props.source.uri === "authorized-photo"));
  const facts = nodes.filter((node) => typeof node?.type === "function" && node.props?.label);
  assert.ok(facts.some((node) => node.props.value === "Family"));
  assert.ok(facts.some((node) => node.props.value === "Genus"));
  assert.ok(facts.some((node) => node.props.value === "Not Assessed"));
});

test("Species Details groups recorded facts, shows only Botanist approval, and moves View All above cards", async () => {
  const species = { id: "6", slug: "api-species-6", name: "Common", scientificName: "Scientific",
    approvalStatus: "Approved", description: "Description", habitat: "Recorded habitat", family: "Family", genus: "Genus",
    conservationStatus: "Not Assessed" };
  const records = [{ plantId: "17", speciesId: "6", currentStatus: "Approved" }];
  for (const role of ["Botanist", "Visitor", "Guest", "Officer"]) {
    const fixture = makeScreen({ user: { id: "owner", role }, fetchSpeciesDetail: async () => species, records });
    fixture.render(); fixture.focus(); await new Promise((resolve) => setImmediate(resolve));
    const nodes = fixture.allNodes(fixture.render());
    const about = nodes.find((node) => node?.props?.style?.backgroundColor === "#FFFFFF" && node.props.style.borderRadius === 18);
    assert.ok(about, "one white About box");
    const insideAbout = fixture.allNodes(about);
    for (const value of ["Description", "Recorded habitat", "Family", "Genus"])
      assert.ok(insideAbout.some((node) => node?.props?.children === value || node?.props?.value === value), value);
    assert.equal(nodes.filter((node) => node?.props?.children === "speciesDetail.aboutThisSpecies").length, 1);
    const badge = nodes.filter((node) => node?.props?.children === "Approved" &&
      Array.isArray(node.props.style) && node.props.style.some((style) => style?.fontWeight === "700"));
    assert.equal(badge.length, role === "Botanist" ? 1 : 0);
    const button = nodes.find((node) => node?.type === "TouchableOpacity" && node.props.accessibilityLabel === "speciesDetail.viewAllPlants");
    assert.ok(button);
    assert.equal(button.props.style.minHeight, 44);
    assert.ok(nodes.indexOf(button) < nodes.findIndex((node) => node?.type === "PlantCard"));
    assert.equal(nodes.filter((node) => node?.props?.children === "speciesDetail.viewAllPlants").length, 1);
    button.props.onPress();
    assert.equal(fixture.navigations.at(-1)[0], "Species");
  }
});

test("Species Detail shares one safe-area header row with working right-aligned actions for every role", async () => {
  for (const language of ["en", "ms", "zh"]) {
    for (const user of [null, { role: "Guest" }, { role: "Visitor" }, { role: "Botanist" }, { role: "Officer" }]) {
      let reads = 0;
      const species = { id: "6", slug: "species-six", name: "Species Six" };
      const fixture = makeScreen({ language, user, species, fetchSpeciesDetail: async () => { reads++; return species; } });
      let tree = fixture.render();
      fixture.focus();
      await new Promise((resolve) => setImmediate(resolve));
      tree = fixture.render();
      assert.deepEqual(tree.props.edges, ["top", "left", "right"]);
      const all = fixture.allNodes(tree);
      const refreshes = all.filter((node) => node?.type === "RefreshButton");
      assert.equal(refreshes.length, 1);
      const row = React.Children.toArray(tree.props.children)[0];
      assert.equal(row.props.style.justifyContent, "space-between");
      assert.equal(row.props.style.alignItems, "center");
      const [back, actions] = React.Children.toArray(row.props.children);
      assert.equal(back.props.variant, "plain");
      assert.equal(actions.props.style.gap, 8);
      assert.equal(actions.props.style.alignItems, "center");
      const buttons = React.Children.toArray(actions.props.children);
      assert.equal(buttons[0].type, "RefreshButton");
      assert.equal(buttons.length, user?.role === "Visitor" ? 2 : 1);
      for (const button of buttons) {
        assert.equal(button.props.style.minWidth, 44);
        assert.equal(button.props.style.height, 44);
        assert.equal(button.props.style.borderRadius, 13);
      }
      assert.equal(buttons[0].props.loading, false);
      buttons[0].props.onPress();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(reads, 2);
      assert.deepEqual(fixture.favouriteCalls[0], ["refresh", true]);
      if (user?.role === "Visitor") {
        assert.equal(buttons[1].type, "FavouriteHeart");
        buttons[1].props.onPress();
        assert.deepEqual(fixture.favouriteCalls.at(-1), ["toggle", "species", "6"]);
      }
      back.props.onPress();
      assert.deepEqual(fixture.navigations, ["back"]);
    }
  }
});
