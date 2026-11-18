import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const React = require("react");
const ts = require("typescript");
const source = readFileSync(new URL("../screens/PlantDetail.js", import.meta.url), "utf8");

function renderTimelineCard(observation) {
  let open;
  const calls = [];
  const hooks = { ...React, useState: (initial) => {
    if (open === undefined) open = initial;
    return [open, (next) => { open = typeof next === "function" ? next(open) : next; }];
  } };
  const native = { StyleSheet: { create: (value) => value } };
  for (const component of ["View", "Text", "TouchableOpacity", "Image", "ScrollView", "Modal", "RefreshControl"])
    native[component] = component;
  const translations = { useAppTranslation() {}, t: (key) => key, translateLabel: (value) => value,
    dateLocale: () => "en" };
  const code = ts.transpileModule(source, { fileName: "PlantDetail.jsx",
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)((name) => {
    const value = name === "react" ? hooks : name === "react-native" ? native
      : name === "../translations/i18n" ? translations
        : name === "../utils/plantApi" ? { getObservationRecorderDisplayName: (row, _user, fallback) => row.recordedByName || fallback } : {};
    return name === "react" ? value : { ...value, __esModule: true };
  }, module, module.exports);
  const render = () => module.exports.ObservationCard({ observation,
    user: { id: "viewer", role: "Botanist", name: "Viewer" }, navigation: { navigate: (...args) => calls.push(args) } });
  return { render, calls };
}

const children = (node) => node && typeof node === "object" ? React.Children.toArray(node.props?.children) : [];
function find(node, predicate) {
  if (predicate(node)) return node;
  for (const child of children(node)) {
    const match = find(child, predicate);
    if (match) return match;
  }
}

test("timeline card retains expand/collapse and opens its exact approved Observation", () => {
  const card = renderTimelineCard({ observationId: "obs-b", plantId: "24", date: "2026-11-12T00:00:00Z",
    status: "Approved", recordedBy: "staff:author", recordedByName: "Author", photos: [] });
  const closed = card.render();
  assert.equal(find(closed, (node) => node?.props?.accessibilityLabel === "recordEdits.viewDetails"), undefined);
  find(closed, (node) => node?.props?.style?.flexDirection === "row" && node.props.onPress)?.props.onPress();
  const expanded = card.render();
  const action = find(expanded, (node) => node?.props?.accessibilityLabel === "recordEdits.viewDetails");
  assert.ok(action);
  assert.equal(action.props.style.minHeight, 44);
  action.props.onPress();
  assert.deepEqual(card.calls, [["NotificationObservation", { observationId: "obs-b", readOnlyApproved: true }]]);
  find(expanded, (node) => node?.props?.style?.flexDirection === "row" && node.props.onPress)?.props.onPress();
  assert.equal(find(card.render(), (node) => node?.props?.accessibilityLabel === "recordEdits.viewDetails"), undefined);
});

test("timeline Rejected badge is red while Pending and Approved retain their colors", () => {
  for (const [status, background] of [["Rejected", "#FCE2E2"], ["Pending Review", "#F4E7D2"], ["Approved", "#D8EBD9"]]) {
    const card = renderTimelineCard({ observationId: status, plantId: "24", status, date: "2026-11-12T00:00:00Z" });
    const tree = card.render();
    const badge = find(tree, (node) => node?.props?.style?.some?.((style) => style?.backgroundColor === background));
    assert.ok(badge, status);
    find(tree, (node) => node?.props?.style?.flexDirection === "row" && node.props.onPress)?.props.onPress();
    find(card.render(), (node) => node?.props?.accessibilityLabel === "recordEdits.viewDetails").props.onPress();
    assert.equal(card.calls[0][1].readOnlyApproved, status === "Approved");
  }
});

test("timeline View Details label exists in English, Malay and Chinese", () => {
  for (const language of ["en", "ms", "zh"]) {
    const catalog = JSON.parse(readFileSync(new URL(`../translations/${language}.json`, import.meta.url), "utf8"));
    assert.ok(catalog.recordEdits.viewDetails, language);
  }
});
