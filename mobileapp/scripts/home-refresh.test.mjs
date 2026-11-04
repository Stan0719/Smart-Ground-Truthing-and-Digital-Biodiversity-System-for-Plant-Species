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

function load(path, dependencies) {
  const module = { exports: {} };
  new Function("require", "module", "exports", transpile(path))((name) => {
    if (name.startsWith("../assets/")) return 1;
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return { ...dependencies[name], __esModule: name !== "react" };
  }, module, module.exports);
  return module.exports.default;
}

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
