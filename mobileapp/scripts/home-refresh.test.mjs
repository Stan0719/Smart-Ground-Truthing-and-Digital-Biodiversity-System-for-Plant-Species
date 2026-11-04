import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const React = require("react");
const ts = require("typescript");
const transpile = (path) => ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
  fileName: path,
  compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
}).outputText;

function loadModule(path, dependencies) {
  const module = { exports: {} };
  new Function("require", "module", "exports", transpile(path))((name) => {
    if (name.startsWith("../assets/")) return 1;
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return { ...dependencies[name], __esModule: name !== "react" };
  }, module, module.exports);
  return module.exports;
}
const load = (path, dependencies) => loadModule(path, dependencies).default;

function walk(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  const resolved = typeof node.type === "function" && node.type.name === "RevealView"
    ? node.type(node.props) : node;
  for (const child of React.Children.toArray(resolved.props?.children)) {
    const found = walk(child, predicate);
    if (found) return found;
  }
  return null;
}

function collect(node) {
  if (!node || typeof node !== "object") return [];
  const resolved = typeof node.type === "function" && node.type.name === "RevealView"
    ? node.type(node.props) : node;
  return [resolved, ...React.Children.toArray(resolved.props?.children).flatMap(collect)];
}

for (const width of [390, 820, 1194]) {
  test(`Home Species of Niah heading has an adjacent refresh icon at width ${width}`, async () => {
    const effects = [];
    let reads = 0;
    const native = {
      StyleSheet: { create: styles => styles }, Dimensions: { get: () => ({ width }) },
      Animated: { Value: class { constructor(value) { this.value = value; } }, View: "AnimatedView" },
      PanResponder: { create: () => ({ panHandlers: {} }) },
      Linking: {},
    };
    for (const name of ["View", "Text", "ScrollView", "FlatList", "TouchableOpacity", "Image", "ImageBackground", "RefreshControl"]) native[name] = name;
    const screen = load("screens/Home.js", {
      react: { ...React, useEffect: effect => effects.push(effect), useRef: value => ({ current: value }), useState: initial => [initial, () => {}], useCallback: callback => callback },
      "react-native": native,
      "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0 }) },
      "../translations/i18n": { t: key => key, useAppTranslation() {}, translateLabel: value => value, translateUIMessage: value => value },
      "../components/LanguageSelector": { default: "LanguageSelector" },
      "../components/RefreshButton": { default: "RefreshButton" },
      "../data/speciesImages": { getSpeciesImageSource: () => null },
      "../utils/plantApi": { fetchSpeciesCatalog: async () => { reads++; return [{ id: "6", scientificName: "Actual species" }]; } },
    });
    const tree = screen({ navigation: { addListener: () => () => {}, navigate() {} } });
    const scroll = walk(tree, node => node.type === "ScrollView");
    assert.ok(scroll.props.refreshControl);
    const heading = walk(tree, node => node.type === "Text" && node.props.children === "home.speciesOfNiah");
    assert.ok(heading);
    const titleRow = walk(tree, node => node.type === "View" && React.Children.toArray(node.props.children).some(child => child.type === "Text" && child.props.children === "home.speciesOfNiah"));
    assert.ok(titleRow);
    assert.equal(titleRow.props.style.flexDirection, "row");
    const button = React.Children.toArray(titleRow.props.children).find(node => node.type === "RefreshButton");
    assert.equal(button?.props.testID, "home-species-refresh");
    assert.equal(heading.props.style.flexShrink, 1);
    effects[0]();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reads, 1);
    await button.props.onPress();
    assert.equal(reads, 2);
    await new Promise(resolve => setImmediate(resolve));
    await scroll.props.refreshControl.props.onRefresh();
    assert.equal(reads, 3);
  });
}

test("shared icon is a 44 point touch target with localized label and busy state", () => {
  const native = { StyleSheet: { create: styles => styles }, TouchableOpacity: "TouchableOpacity", ActivityIndicator: "ActivityIndicator" };
  const icon = load("components/RefreshButton.js", {
    react: React,
    "react-native": native,
    "@expo/vector-icons/Ionicons": { default: "Icon" },
  });
  const action = () => {};
  const idle = icon({ onPress: action, label: "Muat Semula", testID: "refresh" });
  assert.equal(idle.props.style[0].width, 44);
  assert.equal(idle.props.style[0].height, 44);
  assert.equal(idle.props.accessibilityLabel, "Muat Semula");
  assert.equal(idle.props.onPress, action);
  assert.equal(idle.props.disabled, false);
  const busy = icon({ onPress: action, loading: true, label: "Refresh" });
  assert.equal(busy.props.disabled, true);
  assert.equal(busy.props.accessibilityState.busy, true);
  assert.equal(busy.props.children.type, "ActivityIndicator");
});

test("Home cards omit the empty category badge and use the plant placeholder for unmapped image assets", () => {
  const source = readFileSync(new URL("../screens/Home.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /categoryBadge|categoryText|item\.category/);
  assert.match(source, /data=\{species\}/);
  assert.match(source, /keyExtractor=\{\(item\) => String\(item\.id\)\}/);
  assert.match(source, /<SpeciesCardImage species=\{item\} \/>/);
  assert.match(source, /onError=\{\(\) => setFailedSource\(source\)\}/);
  assert.match(source, /styles\.plantImagePlaceholder/);
  assert.match(source, /speciesId: plant\.id/);
  assert.match(source, /navigation\.navigate\('PlantsTab'\)/);

  const locales = ["en", "ms", "zh"].map((language) => JSON.parse(
    readFileSync(new URL(`../translations/${language}.json`, import.meta.url), "utf8"),
  ).home.discoverTheDiverseTreeFlowerFernAndClimberSpeciesFound);
  assert.deepEqual(locales, [
    "Explore the diverse plant species documented in Niah National Park.",
    "Terokai kepelbagaian spesies tumbuhan yang didokumenkan di Taman Negara Niah.",
    "探索尼亚国家公园已记录的丰富植物物种。",
  ]);
});

test("Home image selection accepts explicitly mapped species images and rejects unverified backend assets", () => {
  const path = "data/speciesImages.js";
  const module = { exports: {} };
  new Function("require", "module", "exports", transpile(path))((name) => {
    assert.match(name, /^\.\.\/assets\/species\//);
    return 73;
  }, module, module.exports);
  const getSource = module.exports.getSpeciesImageSource;
  assert.deepEqual(getSource({ slug: "tropical-pitcher-plant", image: { uri: "https://example.invalid/verified.jpg" }, speciesImageVerified: true }, undefined, { preferVerifiedBackend: true, allowUnmappedRemote: false }), { uri: "https://example.invalid/verified.jpg" });
  assert.equal(getSource({ slug: "tropical-pitcher-plant", image: { uri: "https://example.invalid/unverified.jpg" } }, undefined, { preferVerifiedBackend: true, allowUnmappedRemote: false }), 73);
  assert.equal(getSource({ slug: "api-species-42", image: { uri: "https://example.invalid/unverified.jpg" } }, undefined, { preferVerifiedBackend: true, allowUnmappedRemote: false }), null);
});

test("failed species image loads switch the card to the localized plant placeholder", () => {
  let failedSource = null;
  const native = { StyleSheet: { create: styles => styles }, Dimensions: { get: () => ({ width: 390 }) } };
  for (const name of ["View", "Text", "Image", "ScrollView", "FlatList", "TouchableOpacity", "ImageBackground", "RefreshControl"]) native[name] = name;
  const component = loadModule("screens/Home.js", {
    react: { ...React, useState: initial => [failedSource ?? initial, value => { failedSource = value; }] },
    "react-native": native,
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0 }) },
    "../translations/i18n": { t: key => key, useAppTranslation() {}, translateLabel: value => value, translateUIMessage: value => value },
    "../components/LanguageSelector": { default: "LanguageSelector" },
    "../components/RefreshButton": { default: "RefreshButton" },
    "../data/speciesImages": { getSpeciesImageSource: species => species.image },
    "../utils/plantApi": { fetchSpeciesCatalog: async () => [] },
  }).SpeciesCardImage;
  const props = { species: { image: { uri: "https://example.invalid/species.jpg" }, speciesImageVerified: true } };
  const image = component(props);
  assert.equal(image.type, "Image");
  image.props.onError();
  const placeholder = component(props);
  assert.equal(placeholder.type, "View");
  assert.ok(React.Children.toArray(placeholder.props.children).some(node => node.props?.children === "speciesDetail.plantImageComingSoon"));
});

test("Home catalogue cards show API names and navigate with the backend species ID", () => {
  const native = { StyleSheet: { create: styles => styles }, Dimensions: { get: () => ({ width: 390 }) },
    Animated: { Value: class { constructor(value) { this.value = value; } }, View: "AnimatedView" },
    PanResponder: { create: () => ({ panHandlers: {} }) }, Linking: {} };
  for (const name of ["View", "Text", "ScrollView", "FlatList", "TouchableOpacity", "Image", "ImageBackground", "RefreshControl"]) native[name] = name;
  const routes = [];
  const screen = load("screens/Home.js", {
    react: { ...React, useEffect() {}, useRef: value => ({ current: value }), useState: initial => [initial, () => {}], useCallback: callback => callback },
    "react-native": native,
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0 }) },
    "../translations/i18n": { t: key => key, useAppTranslation() {}, translateLabel: value => value, translateUIMessage: value => value },
    "../components/LanguageSelector": { default: "LanguageSelector" },
    "../components/RefreshButton": { default: "RefreshButton" },
    "../data/speciesImages": { getSpeciesImageSource: () => null },
    "../utils/plantApi": { fetchSpeciesCatalog: async () => [] },
  });
  const tree = screen({ navigation: {
    addListener: () => () => {},
    navigate: (...args) => routes.push(["root", ...args]),
    getParent: () => ({ navigate: (...args) => routes.push(["parent", ...args]) }),
  } });
  const carousel = walk(tree, node => node.type === "FlatList" && node.props.horizontal);
  const item = { id: "42", slug: "api-species-42", name: "Backend common name", scientificName: "Backend scientific name", image: { uri: "https://example.invalid/bird.jpg" } };
  const card = carousel.props.renderItem({ item });
  const nodes = collect(card);
  assert.ok(nodes.some(node => node.type === "Text" && node.props.children === item.name));
  assert.ok(nodes.some(node => node.type === "Text" && node.props.children === item.scientificName));
  assert.ok(nodes.some(node => typeof node.type === "function" && node.type.name === "SpeciesCardImage"));
  card.props.onPress();
  assert.deepEqual(routes[0], ["parent", "PlantsTab", {
    screen: "SpeciesDetail",
    params: { slug: item.slug, speciesId: item.id, species: item },
  }]);

  const exploreButton = collect(tree).find(node => node.type === "TouchableOpacity" && collect(node).some(child => child.type === "Text" && child.props.children === "home.exploreMorePlantSpecies"));
  exploreButton.props.onPress();
  assert.deepEqual(routes[1], ["root", "PlantsTab"]);
});
