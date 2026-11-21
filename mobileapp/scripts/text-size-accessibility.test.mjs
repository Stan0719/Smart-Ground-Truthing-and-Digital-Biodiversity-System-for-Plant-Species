import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const React = require("react");
const ts = require("typescript");
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const preference = await import(`data:text/javascript;base64,${Buffer.from(read("utils/textSizePreference.js")).toString("base64")}`);

test("text size defaults to 100%, saves five supported steps, and restores after restart", async () => {
  const values = new Map();
  const storage = { getItem: async (key) => values.get(key) ?? null, setItem: async (key, value) => { values.set(key, value); } };
  const first = preference.createTextSizePreference(storage);
  assert.equal(await first.restore(), 100);
  for (const step of preference.TEXT_SIZE_STEPS) {
    await first.save(step);
    assert.equal(await preference.createTextSizePreference(storage).restore(), step);
  }
  await assert.rejects(first.save(110), /Unsupported/);
  values.set(preference.TEXT_SIZE_STORAGE_KEY, "invalid");
  assert.equal(await preference.createTextSizePreference(storage).restore(), 100);
});

test("system accessibility scaling is preserved and app scaling fills only the remaining difference", () => {
  assert.equal(preference.appTextFactor(100, 1), 1);
  assert.equal(preference.appTextFactor(200, 1), 2);
  assert.equal(preference.appTextFactor(200, 1.5), 4 / 3);
  assert.equal(preference.appTextFactor(125, 1.5), 1);
  assert.equal(preference.appTextFactor(200, 2.5), 1);
});

test("scaled Text and TextInput preserve original styles at 100% and scale font and line height", () => {
  const code = ts.transpileModule(read("components/ScaledText.js"), { fileName: "ScaledText.jsx", compilerOptions: {
    jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  let percent = 100, systemFontScale = 1;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)((name) => {
    if (name === "react") return { ...React, default: React, __esModule: true };
    if (name === "react-native") return { Text: "Text", TextInput: "TextInput", PixelRatio: { getFontScale: () => systemFontScale },
      StyleSheet: { flatten: (style) => Object.assign({}, ...(Array.isArray(style) ? style : [style])) },
      useWindowDimensions: () => ({ fontScale: systemFontScale }), __esModule: true };
    if (name === "./TextSizeContext") return { useTextSize: () => ({ percent }), __esModule: true };
    if (name === "../utils/textSizePreference") return { appTextFactor: preference.appTextFactor, __esModule: true };
    throw Error(name);
  }, module, module.exports);
  const style = { fontSize: 16, lineHeight: 22, color: "green" };
  assert.equal(module.exports.scaledTextStyle(style, 100, 1), style);
  percent = 200;
  const text = module.exports.default.render({ style, children: "Agave sisalana" }, null);
  assert.equal(text.type, "Text");
  assert.deepEqual(text.props.style[1], { fontSize: 32, lineHeight: 44 });
  const inputRef = { current: null };
  const input = module.exports.ScaledTextInput.render({ style, value: "100" }, inputRef);
  assert.equal(input.type, "TextInput");
  assert.equal(input.props.value, "100");
  assert.equal(input.props.ref, inputRef, "TextInput refs remain available to existing focus flows");
  assert.equal(input.props.style[1].fontSize, 32);
  systemFontScale = 2.5;
  assert.equal(module.exports.default.render({ style }, null).props.style, style);
});

test("Text and TextInput apply each supported setting without changing their semantic props", () => {
  const code = ts.transpileModule(read("components/ScaledText.js"), { fileName: "ScaledText.jsx", compilerOptions: {
    jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  let percent = 100;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)((name) => {
    if (name === "react") return { ...React, default: React, __esModule: true };
    if (name === "react-native") return { Text: "Text", TextInput: "TextInput", PixelRatio: { getFontScale: () => 1 },
      StyleSheet: { flatten: (style) => style || {} }, useWindowDimensions: () => ({ fontScale: 1 }), __esModule: true };
    if (name === "./TextSizeContext") return { useTextSize: () => ({ percent }), __esModule: true };
    if (name === "../utils/textSizePreference") return { appTextFactor: preference.appTextFactor, __esModule: true };
    throw Error(name);
  }, module, module.exports);
  for (const step of [100, 125, 150, 175, 200]) {
    percent = step;
    const rendered = module.exports.default.render({ style: { fontSize: 16 }, numberOfLines: 2, children: "Long scientific name" }, null);
    const actualStyle = Array.isArray(rendered.props.style) ? rendered.props.style[1] : rendered.props.style;
    assert.equal(actualStyle.fontSize, 16 * step / 100);
    assert.equal(rendered.props.numberOfLines, 2);
    const onChangeText = () => {};
    const input = module.exports.ScaledTextInput.render({ style: { fontSize: 16 }, value: "draft value", onChangeText }, null);
    const inputStyle = Array.isArray(input.props.style) ? input.props.style[1] : input.props.style;
    assert.equal(inputStyle.fontSize, 16 * step / 100);
    assert.equal(input.props.value, "draft value");
    assert.equal(input.props.onChangeText, onChangeText);
  }
});

test("language popup is scrollable, uses localized slider labels, and keeps language choices", () => {
  const source = read("components/LanguageSelector.js");
  assert.match(source, /accessibilityRole="adjustable"/);
  assert.match(source, /accessibilityValue=\{\{ min: 100, max: 200, now: percent/);
  assert.match(source, /<ScrollView showsVerticalScrollIndicator/);
  assert.match(source, /name: "English"/);
  assert.match(source, /name: "Bahasa Melayu"/);
  assert.match(source, /name: "中文"/);
  for (const language of ["en", "ms", "zh"]) {
    const labels = JSON.parse(read(`translations/${language}.json`)).textSize;
    for (const key of ["title", "size", "normal", "maximum", "preview", "saveFailed"]) assert.ok(labels[key]);
  }
});

test("the first stage connects Guest, Visitor, and Botanist primary screens without changing their data loaders", () => {
  for (const name of ["Home", "Plant", "Species", "BotanistDashboard", "AddPlant", "Login"])
    assert.match(read(`screens/${name}.js`), /components\/ScaledText/);
  assert.match(read("screens/Species.js"), /percent >= 150/);
  assert.match(read("translations/LocalizationProvider.js"), /Promise\.all\(\[localization\.restoreLanguage\(\), textSizePreference\.restore\(\)\]\)/);
});

test("remaining mobile screens and shared text components use the same scaling wrapper", () => {
  const screens = ["Account", "AddObservation", "AddSpeciesRequest", "BotanistMyDrafts", "BotanistMyObservations",
    "BotanistNotifications", "BotanistPlantDetail", "BotanistSpeciesRequestDetail", "EditPlantRecord", "EditSpeciesRequest",
    "FavouritePlants", "FieldCollection", "MandatoryPasswordChange", "Map", "NotificationObservation", "PersistentKnowledge",
    "PlantDetail", "PlantQRCode", "RecordChangeReview", "RecordVersionHistory", "Scan", "ScanHistory", "SpeciesDetail", "VisitorRegister"];
  for (const screen of screens) assert.match(read(`screens/${screen}.js`), /components\/ScaledText/);
  for (const component of ["BotanicalSkeleton", "CustomButton", "DiscoverableScrollView", "EditAction", "FaceCameraModal",
    "GpsLocationPicker", "OriginalUpdatedField", "PlantCard", "PlantExplorerMap.native", "PlantExplorerMap.web",
    "QRRefreshButton", "SpeciesDictionary"]) assert.match(read(`components/${component}.js`), /ScaledText/);
  const app = read("App.js");
  assert.match(app, /tabBarLabel:\s*\(\{ color \}\)\s*=>/);
  assert.match(app, /navigationTextScale/);
});
