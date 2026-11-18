import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { validGpsPoint, readGpsLocation } from "../utils/gpsLocation.js";
const require = createRequire(import.meta.url), React = require("react"), ts = require("typescript");
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

function picker(initial = { latitude: "4.5", longitude: "113.7" }, os = "ios") {
  const refs = [], effects = [], states = [], changes = [], interactions = [], timers = new Set();
  let refIndex = 0, effectIndex = 0, stateIndex = 0, pending = [], location = initial;
  const hooks = { ...React,
    useState(value) { const i = stateIndex++; if (!(i in states)) states[i] = value;
      return [states[i], (next) => { states[i] = typeof next === "function" ? next(states[i]) : next; }]; },
    useRef(value) { const i = refIndex++; if (!(i in refs)) refs[i] = { current: value }; return refs[i]; },
    useEffect(callback, deps) { const i = effectIndex++; const old = effects[i];
      if (!old || deps.some((value, j) => value !== old.deps[j])) pending.push(() => { old?.cleanup?.(); effects[i] = { deps, cleanup: callback() }; }); },
  };
  const native = { Platform: { OS: os }, StyleSheet: { create: (value) => value, absoluteFillObject: { position: "absolute" } }, View: "View", Text: "Text", TouchableOpacity: "TouchableOpacity", ActivityIndicator: "ActivityIndicator" };
  const deps = { react: hooks, "react-native": native, "react-native-maps": { default: "MapView" },
    "../translations/i18n": { t: (key) => key, useAppTranslation() {} }, "../utils/gpsLocation": { validGpsPoint } };
  const code = ts.transpileModule(read("../components/GpsLocationPicker.js"), {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", "setTimeout", "clearTimeout", code)((name) => { assert.ok(name in deps, name); return { ...deps[name], __esModule: name !== "react" }; }, module, module.exports,
    (fn) => { timers.add(fn); return fn; }, (fn) => timers.delete(fn));
  const render = (next = location, inputActive = false) => {
    location = next; refIndex = 0; effectIndex = 0; stateIndex = 0; pending = [];
    const tree = module.exports.default({ location, inputActive, onChange: (point) => changes.push(point), onInteractionChange: (value) => interactions.push(value) });
    pending.forEach((effect) => effect()); return tree;
  };
  const nodes = (root) => root && typeof root === "object" ? [root, ...React.Children.toArray(root.props?.children).flatMap(nodes)] : [];
  const mount = () => {
    nodes(render()).find((node) => node.props.onLayout)?.props.onLayout({ nativeEvent: { layout: { width: 400, height: 260 } } });
    const map = nodes(render()).find((node) => node.type === "MapView");
    map.props.onMapReady(); if (os === "android") map.props.onMapLoaded();
    return nodes(render());
  };
  return { render, nodes, mount, changes, interactions, expire: () => [...timers].forEach((fn) => fn()), unmount: () => effects.forEach((effect) => effect?.cleanup?.()) };
}

test("inline map has a fixed tip, no modal/actions, and emits precise completed centers together", () => {
  const p = picker(), nodes = p.mount(), map = nodes.find((node) => node.type === "MapView");
  assert.equal(nodes.some((node) => node.type === "Modal"), false);
  const pin = nodes.find((node) => node.props.pointerEvents === "none" && node.props.style.top === "50%");
  assert.equal(pin.props.style.top, "50%"); assert.equal(pin.props.style.marginTop, -40);
  assert.equal(map.props.initialRegion.latitude, 4.5);
  assert.equal(map.props.zoomEnabled, true); assert.equal(map.props.pitchEnabled, false);
  map.props.onTouchStart(); assert.equal(p.interactions.at(-1), true);
  map.props.onRegionChangeComplete({ latitude: 4.5123456789, longitude: 113.7123456789 });
  assert.deepEqual(p.changes, [{ latitude: "4.5123456789", longitude: "113.7123456789", accuracy_m: "" }]);
  assert.equal(p.interactions.at(-1), false);
  map.props.onRegionChangeComplete({ latitude: NaN, longitude: 113 }); assert.equal(p.changes.length, 1);
});

test("fresh GPS camera update ignores stale centers and never clears new measured accuracy", () => {
  const p = picker(), map = p.mount().find((node) => node.type === "MapView");
  let camera;
  map.props.ref.current = { animateCamera: (next) => { camera = next; } };
  const nextMap = p.nodes(p.render({ latitude: "4.6", longitude: "113.8", accuracy_m: "6" })).find((node) => node.type === "MapView");
  assert.deepEqual(camera.center, { latitude: 4.6, longitude: 113.8 });
  nextMap.props.onRegionChangeComplete({ latitude: 4.51, longitude: 113.71 }); assert.deepEqual(p.changes, []);
  nextMap.props.onRegionChangeComplete({ latitude: 4.6, longitude: 113.8 }); assert.deepEqual(p.changes, []);
  nextMap.props.onTouchStart(); nextMap.props.onRegionChangeComplete({ latitude: 4.7, longitude: 113.9 });
  assert.equal(p.changes[0].accuracy_m, "");
  p.unmount(); nextMap.props.onRegionChangeComplete({ latitude: 4.8, longitude: 114 }); assert.equal(p.changes.length, 1);
});

test("manual typing defers the camera until blur and camera callbacks never rewrite text or accuracy", () => {
  const p = picker(), map = p.mount().find((node) => node.type === "MapView");
  const cameras = [];
  map.props.ref.current = { animateCamera: (camera) => cameras.push(camera) };
  map.props.onTouchStart();
  let nextMap = p.nodes(p.render({ latitude: "4.", longitude: "113.7", accuracy_m: "7" }, true)).find((node) => node.type === "MapView");
  nextMap.props.onRegionChangeComplete({ latitude: 4.8, longitude: 113.9 });
  assert.deepEqual(p.changes, []); assert.deepEqual(cameras, []);
  nextMap = p.nodes(p.render({ latitude: "4.5123", longitude: "113.7", accuracy_m: "7" })).find((node) => node.type === "MapView");
  assert.deepEqual(cameras[0].center, { latitude: 4.5123, longitude: 113.7 });
  nextMap.props.onRegionChangeComplete({ latitude: 4.5123, longitude: 113.7 });
  assert.deepEqual(p.changes, []);
});

test("native map mounts only after measurable layout, exposes initialization failure, and retries safely", () => {
  const p = picker();
  let nodes = p.nodes(p.render());
  assert.equal(nodes.some((node) => node.type === "MapView"), false);
  const host = nodes.find((node) => node.props.onLayout);
  assert.equal(host.props.collapsable, false);
  host.props.onLayout({ nativeEvent: { layout: { width: 0, height: 260 } } });
  assert.equal(p.nodes(p.render()).some((node) => node.type === "MapView"), false);
  host.props.onLayout({ nativeEvent: { layout: { width: 400, height: 260 } } });
  nodes = p.nodes(p.render());
  const oldMap = nodes.find((node) => node.type === "MapView");
  assert.equal(oldMap.props.style.flex, 1); assert.equal(oldMap.props.mapType, "standard");
  assert.equal(oldMap.props.provider, undefined, "same native default as Biodiversity Map");
  p.expire(); nodes = p.nodes(p.render());
  assert.ok(nodes.some((node) => node.props.accessibilityRole === "alert"));
  assert.equal(nodes.some((node) => node.props.style?.top === "50%"), false, "failed map has no usable pin");
  nodes.find((node) => node.type === "TouchableOpacity").props.onPress();
  nodes = p.nodes(p.render());
  const newMap = nodes.find((node) => node.type === "MapView");
  assert.notEqual(newMap.key, oldMap.key);
  oldMap.props.onMapReady();
  assert.equal(p.nodes(p.render()).some((node) => node.props.style?.top === "50%"), false);
  newMap.props.onMapReady();
  assert.ok(p.nodes(p.render()).some((node) => node.props.style?.top === "50%"));
  assert.deepEqual(p.changes, []);
});

test("Android waits for native tile-load notification without depending on that unsupported Apple Maps event", () => {
  const p = picker(undefined, "android");
  const host = p.nodes(p.render()).find((node) => node.props.onLayout);
  host.props.onLayout({ nativeEvent: { layout: { width: 400, height: 260 } } });
  const map = p.nodes(p.render()).find((node) => node.type === "MapView");
  map.props.onMapReady(); p.expire();
  assert.ok(p.nodes(p.render()).some((node) => node.props.accessibilityRole === "alert"));
  map.props.onMapLoaded();
  assert.ok(p.nodes(p.render()).some((node) => node.props.style?.top === "50%"));
});

test("GPS capture validates pairs, preserves zero, and does not invent unavailable measurements", async () => {
  for (const point of [{ latitude: "", longitude: 3 }, { latitude: null, longitude: 4 }, { latitude: 91, longitude: 0 }, { latitude: false, longitude: 0 }]) assert.equal(validGpsPoint(point), false);
  assert.equal(validGpsPoint({ latitude: 0, longitude: 0 }), true);
  const source = { Accuracy: { High: 4 }, requestForegroundPermissionsAsync: async () => ({ status: "granted" }),
    getCurrentPositionAsync: async () => ({ coords: { latitude: 0, longitude: 0, altitude: null, accuracy: NaN } }) };
  assert.deepEqual(await readGpsLocation(source, (key) => key), { latitude: "0", longitude: "0", altitude_m: "", accuracy_m: "" });
  source.requestForegroundPermissionsAsync = async () => ({ status: "denied" });
  await assert.rejects(readGpsLocation(source, (key) => key), /permissionDenied/);
});

test("inline GPS labels are translated and active forms no longer mount a modal picker", () => {
  for (const language of ["en", "ms", "zh"]) {
    const catalog = JSON.parse(read(`../translations/${language}.json`));
    for (const key of ["chooseLocationOnMap", "notAvailable", "moveMap", "permissionDenied", "unableToGetLocation", "loadingMap", "mapUnavailable", "retryMap", "blankMapRetry"]) assert.ok(catalog.gpsPicker[key]);
  }
  for (const name of ["AddPlant", "EditPlantRecord", "FieldCollection"]) {
    const source = read(`../screens/${name}.js`);
    assert.match(source, /validGpsPoint\([\s\S]*?<GpsLocationPicker/);
    assert.doesNotMatch(source, /pickerVisible|onConfirm=|onCancel=/);
    assert.match(source, /readGpsLocation\(Location, t\)/);
  }
});

test("active Observation GPS inputs are editable, remain optional, and preserve altitude in local drafts", async () => {
  const source = read("../screens/FieldCollection.js");
  const names = [...source.matchAll(/\[(\w+),\s*\w+\]\s*=\s*useState/g)].map((match) => match[1]);
  const values = { user: { id: "owner", role: "botanist" }, recoveryResolved: true, plantEligibility: "approved",
    plantRecord: { id: 8, location: { latitude: 4.5, longitude: 113.7 } } };
  let stateIndex = 0, refIndex = 0, autosave;
  const refs = [], drafts = [];
  const hooks = { ...React, useEffect() {}, useState(initial) {
    const key = names[stateIndex++]; assert.ok(key);
    if (!(key in values)) values[key] = typeof initial === "function" ? initial() : initial;
    return [values[key], (next) => { values[key] = typeof next === "function" ? next(values[key]) : next; }];
  }, useRef(initial) { const i = refIndex++; return refs[i] ||= { current: initial }; } };
  const native = { StyleSheet: { create: (styles) => styles } };
  for (const type of ["ScrollView", "Text", "TextInput", "TouchableOpacity", "View", "Image", "ActivityIndicator"]) native[type] = type;
  const deps = { react: hooks, "react-native": native,
    "../translations/i18n": { useAppTranslation() {}, t: (key, options) => options?.field ? `${key}:${options.field}` : key,
      translateLabel: (value) => value, translateUIMessage: (value) => value, translateFieldLabel: (field) => field },
    "../utils/rbac": { canCollectDrafts: () => true }, "@expo/vector-icons/Ionicons": { default: "Icon" },
    "expo-location": {}, "expo-image-picker": {}, "../utils/plantApi": {}, "../utils/faceSession": {},
    "../utils/fieldStorage": { saveDraft: async (_id, draft) => drafts.push(draft), readDrafts: async () => [] },
    "../utils/fieldSync": {}, "../utils/fieldCapture": { createFieldCapture: () => ({}) },
    "../utils/botanistDraftAutosave": { useBotanistDraftAutosave: (options) => { autosave = options; return {}; } },
    "../components/fieldFormStyles": { fieldFormStyles: {} }, "../components/OriginalUpdatedField": { default: "OriginalUpdatedField" },
    "../components/RefreshButton": { default: "RefreshButton" }, "../components/GpsLocationPicker": { default: "GpsLocationPicker" },
    "../utils/gpsLocation": { validGpsPoint, readGpsLocation },
  };
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)((key) => { assert.ok(key in deps, key); return { ...deps[key], __esModule: key !== "react" }; }, module, module.exports);
  const walk = (root) => root && typeof root === "object" ? [root, ...React.Children.toArray(root.props?.children).flatMap(walk)] : [];
  const render = () => { stateIndex = 0; refIndex = 0; return walk(module.exports.default({ route: { name: "AddObservation", params: { plantId: "8" } }, navigation: {} })); };
  let nodes = render();
  const input = (field) => nodes.find((node) => node.type === "TextInput" && String(node.props.accessibilityLabel).endsWith(`:${field}`));
  for (const field of ["latitude", "longitude", "accuracy_m"]) {
    assert.equal(input(field).props.value, "");
    assert.match(input(field).props.accessibilityLabel, /optionalField/);
  }
  assert.equal(nodes.some((node) => node.type === "GpsLocationPicker"), false, "a new Observation does not copy Plant GPS");
  const altitude = nodes.find((node) => node.type === "TextInput" && node.props.accessibilityLabel === "addPlant.altitudeM");
  assert.ok(altitude); altitude.props.onChangeText("0");
  input("latitude").props.onChangeText("0"); input("longitude").props.onChangeText("110.35");
  input("accuracy_m").props.onChangeText("5");
  nodes = render();
  nodes.find((node) => node.type === "GpsLocationPicker").props.onChange({ latitude: "1.2", longitude: "110.36", accuracy_m: "" });
  render(); await autosave.save();
  assert.deepEqual({ ...drafts[0].body.content, heightCm: undefined, healthStatus: undefined, lifeStage: undefined, morphology: undefined, taxonomy: undefined, notes: undefined },
    { heightCm: undefined, healthStatus: undefined, lifeStage: undefined, morphology: undefined, taxonomy: undefined, notes: undefined,
      latitude: "1.2", longitude: "110.36", altitudeM: "0", accuracy_m: "" });
});
