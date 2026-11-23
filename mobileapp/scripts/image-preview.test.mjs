import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const React = require("react");
const ts = require("typescript");
const source = readFileSync(new URL("../components/PreviewableImage.js", import.meta.url), "utf8");
const code = ts.transpileModule(source, { fileName: "PreviewableImage.jsx", compilerOptions: {
  jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
} }).outputText;

function fixture(photoSource = { uri: "https://example.invalid/full.jpg", headers: { Authorization: "Bearer synthetic" } }) {
  const slots = [];
  const alerts = [];
  let cursor = 0;
  const hooks = { ...React, useState(initial) {
    const position = cursor++;
    if (!(position in slots)) slots[position] = initial;
    return [slots[position], (next) => { slots[position] = typeof next === "function" ? next(slots[position]) : next; }];
  } };
  const native = { ActivityIndicator: "ActivityIndicator", Alert: { alert: (...args) => alerts.push(args) }, Image: "Image", Modal: "Modal", Platform: { OS: "android" },
    Pressable: "Pressable", ScrollView: "ScrollView", View: "View", useWindowDimensions: () => ({ width: 360, height: 700 }),
    StyleSheet: { create: (value) => value, flatten: (value) => Array.isArray(value) ? Object.assign({}, ...value.filter(Boolean)) : value,
      absoluteFillObject: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } } };
  const module = { exports: {} };
  new Function("require", "module", "exports", code)((name) => {
    if (name === "react") return { ...hooks, default: hooks, __esModule: true };
    if (name === "react-native") return native;
    if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ top: 12, bottom: 12 }) };
    if (name === "./ScaledText") return { default: "Text", __esModule: true };
    if (name === "../translations/i18n") return { t: (key, values) => values?.label ? `View ${values.label}` : key,
      useAppTranslation() {} };
    throw Error(`Unexpected import ${name}`);
  }, module, module.exports);
  const render = () => { cursor = 0; return module.exports.default({ source: photoSource, style: { width: 100, height: 100 }, accessibilityLabel: "Leaf photo" }); };
  const nodes = (element) => element == null ? [] : Array.isArray(element) ? element.flatMap(nodes)
    : typeof element === "object" ? [element, ...React.Children.toArray(element.props?.children).flatMap(nodes)] : [];
  return { render, nodes, alerts, confirmPhotoRemoval: module.exports.confirmPhotoRemoval };
}

test("thumbnail opens the original full-resolution source without changing it, and Android Back closes the modal", () => {
  const source = { uri: "https://example.invalid/full.jpg", headers: { Authorization: "Bearer synthetic" } };
  const app = fixture(source);
  let tree = app.nodes(app.render());
  assert.equal(tree.some((node) => node.type === "Modal"), false);
  let stopped = false;
  tree.find((node) => node.type === "Pressable").props.onPress({ stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);
  tree = app.nodes(app.render());
  assert.equal(tree.find((node) => node.type === "Modal").props.visible, true);
  assert.equal(tree.filter((node) => node.type === "Image").at(-1).props.source, source);
  tree.find((node) => node.type === "Modal").props.onRequestClose();
  assert.equal(app.nodes(app.render()).some((node) => node.type === "Modal"), false);
  assert.deepEqual(source, { uri: "https://example.invalid/full.jpg", headers: { Authorization: "Bearer synthetic" } });
});

test("viewer offers bounded zoom, loading/error recovery and no editing actions", () => {
  const app = fixture({ uri: "file:///private/photo.jpg" });
  app.nodes(app.render()).find((node) => node.type === "Pressable").props.onPress();
  let tree = app.nodes(app.render());
  assert.equal(tree.filter((node) => node.type === "Image").at(-1).props.source.uri, "file:///private/photo.jpg");
  const zoomIn = tree.find((node) => node.props?.accessibilityLabel === "imagePreview.zoomIn");
  zoomIn.props.onPress();
  tree = app.nodes(app.render());
  assert.equal(tree.filter((node) => node.type === "Image").at(-1).props.style.width, 540);
  tree.filter((node) => node.type === "Image").at(-1).props.onError();
  tree = app.nodes(app.render());
  assert.ok(tree.find((node) => node.props?.accessibilityRole === "button" && node.props?.children?.props?.children === "common.tryAgain"));
  assert.equal(tree.some((node) => /delete|retake|gallery/i.test(String(node.props?.accessibilityLabel || ""))), false);
});

test("photo removal requires explicit confirmation and Cancel leaves the selected photo intact", () => {
  const app = fixture();
  let removals = 0;
  app.confirmPhotoRemoval((key) => key, () => { removals++; });
  assert.equal(removals, 0);
  assert.equal(app.alerts.length, 1);
  assert.equal(app.alerts[0][2][0].style, "cancel");
  app.alerts[0][2][1].onPress();
  assert.equal(removals, 1);
});
