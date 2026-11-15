import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const React = require("react");
const ts = require("typescript");

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

function loadZoneLabel() {
  const locationSource = read("../utils/plantLocationDisplay.js").replace(/export /g, "");
  const cardSource = read("../utils/plantCardDisplay.js").replace(/^import .*;\r?\n/gm, "").replace(/export /g, "");
  const context = vm.createContext({});
  vm.runInContext(`${locationSource}\n${cardSource}`, context);
  return vm.runInContext("getPlantCardZoneLabel", context);
}

test("Plant card labels exist in English, Malay and Simplified Chinese", () => {
  const expected = {
    en: ["Morphology", "Location Zone", "Unnamed plant"],
    ms: ["Morfologi", "Zon Lokasi", "Tumbuhan tanpa nama"],
    zh: ["形态特征", "位置区域", "未命名植物"],
  };
  for (const [language, values] of Object.entries(expected)) {
    const catalog = JSON.parse(read(`../translations/${language}.json`));
    assert.equal(catalog.plant.morphology.replace(/\s\*$/, ""), values[0]);
    assert.equal(catalog.plant.locationZone.replace(/\s\*$/, ""), values[1]);
    assert.equal(catalog.plant.unnamedPlant, values[2]);
  }
});

test("Plant zone label hides pending and restricted locations while showing approved authorized zones", () => {
  const label = loadZoneLabel();
  const labels = { restricted: "Location restricted", missing: "Not recorded" };
  assert.equal(label({ currentStatus: "Pending Review", location: { zone: "Zone JN" } }, "Botanist", labels), "Not recorded");
  assert.equal(label({ currentStatus: "Approved", location: { zone: "Zone JN" } }, "Botanist", labels), "Zone JN");
  assert.equal(label({ currentStatus: "Approved", location: { zone: "Zone JN", restricted: true } }, "Botanist", labels), "Location restricted");
  assert.equal(label({ currentStatus: "Approved", location: { zone: "Zone JN" } }, "Visitor", labels), "Location restricted");
  assert.equal(label({ currentStatus: "Approved", location: {} }, "Botanist", labels), "Not recorded");
});

test("the Plants page may show Zone only for an authenticated owner's pending plant, without GPS coordinates", () => {
  const source = read("../utils/plantCardDisplay.js").replace(/^import .*;\r?\n/gm, "").replace(/export /g, "");
  const locationSource = read("../utils/plantLocationDisplay.js").replace(/export /g, "");
  const context = vm.createContext({});
  vm.runInContext(`${locationSource}\n${source};this.getPlantCardZoneLabel=getPlantCardZoneLabel;`, context);
  const label = context.getPlantCardZoneLabel;
  const ownerOptions = { restricted: "Location restricted", missing: "Not recorded", allowOwnedPending: true };
  const normalOptions = { restricted: "Location restricted", missing: "Not recorded" };
  assert.equal(label({ currentStatus: "Pending Review", location: { latitude: null, longitude: null, zone: "Zone B" } }, "Botanist", ownerOptions), "Zone B");
  assert.equal(label({ currentStatus: "Pending Review", location: { latitude: null, longitude: null, zone: "Not recorded" } }, "Botanist", ownerOptions), "Not recorded");
  assert.equal(label({ currentStatus: "Pending Review", location: { zone: "Zone B" } }, "Botanist", normalOptions), "Not recorded");
  assert.equal(label({ currentStatus: "Pending Review", location: { zone: "Zone B" } }, "Visitor", ownerOptions), "Not recorded");
  assert.equal(label({ currentStatus: "Approved", location: { zone: "Zone A" } }, "Botanist", normalOptions), "Zone A");
});

test("the Plants page hydrates Zones with one owner-scoped list read only when own pending plants are present", () => {
  const list = read("../screens/Plant.js");
  assert.match(list, /records\.some\(\(record\) => isOwnedPendingPlant\(record, user\?\.id\)\)/);
  assert.match(list, /fetchPlantRecords\(catalog, \{ accountId: user\?\.id, scopeMine: true \}\)/);
  assert.match(list, /mergeOwnedPendingPlantZones\(records, ownerRecords, user\?\.id\)/);
  assert.match(list, /allowOwnedPending: isBotanist && isOwnedPendingPlant\(plant, user\?\.id\)/);
});

test("the Zone change keeps the existing search, approval filters, and sorting predicates", () => {
  const list = read("../screens/Plant.js");
  assert.match(list, /plant\.plantId[\s\S]*?\.includes\(query\)/);
  assert.match(list, /plantStatusFilter === "approved"[\s\S]*?plantStatusFilter === "myPending"/);
  assert.match(list, /matchesSearch &&[\s\S]*?matchesStatus &&[\s\S]*?matchesZone/);
  assert.match(list, /sortOption === "id-asc"[\s\S]*?sortOption === "verified-newest"[\s\S]*?sortOption === "verified-oldest"/);
});

test("Plant card displays plant-record status separately from observation status and uses plant-specific photo/name/ID", () => {
  const shared = read("../components/PlantCard.js");
  const list = read("../screens/Plant.js");
  for (const source of [shared, list]) {
    assert.match(source, /plant\.plantImage/);
    assert.match(source, /plant\.plantScientificName \|\| t\("plant\.unnamedPlant"\)/);
    assert.match(source, /t\("plantDetail\.plantId"\)\}: \{plant\.plantId\}/);
    assert.match(source, /plantStatusStyle\(plant\.currentStatus\)|statusStyle\(plant\.currentStatus\)/);
    for (const value of ["approved", "pending review", "rejected", "correction required"]) assert.ok(source.includes(`case "${value}"`));
    assert.match(source, /plant\.latestSubmission\?\.status/);
    assert.match(source, /t\("plant\.morphology"\)/);
    assert.match(source, /t\("plant\.locationZone"\)/);
  }
  assert.doesNotMatch(shared, /getSpeciesImageSource/);
  assert.doesNotMatch(list, /getSpeciesImageSource/);
  assert.match(shared, /failedImageUri/);
  assert.match(list, /failedImageKey/);
});

function renderListCard(user, language = "en", status = "Approved") {
  const source = read("../screens/Plant.js");
  const cardSource = source.slice(source.indexOf("function PlantCard("));
  const catalog = JSON.parse(read(`../translations/${language}.json`));
  const t = (key) => key.split(".").reduce((value, part) => value?.[part], catalog) || key;
  const calls = [];
  const plant = {
    plantId: "17", currentStatus: status, plantImage: { uri: "plant-17.jpg" },
    plantScientificName: "Plant 17", latestApproved: { date: "2026-11-12", heightCm: 64, lifeStage: "Mature", healthStatus: "Healthy", morphology: "Leaves" },
  };
  const scope = {
    React, useState: (value) => [value, () => {}], useAppTranslation() {}, t,
    translateLabel: (value) => value, translateFieldValue: (_label, value) => value,
    dateLocale: () => ({ en: "en-GB", ms: "ms-MY", zh: "zh-CN" })[language],
    getPlantDisplayObservation: (record) => record.latestApproved,
    getPlantCardZoneLabel: () => t("map.locationRestricted"), isOwnedPendingPlant: () => false,
    StyleSheet: { create: (styles) => styles },
  };
  for (const name of ["View", "Text", "TouchableOpacity", "Image", "FavouriteHeart"]) scope[name] = name;
  const compiled = ts.transpileModule(`${cardSource}\nmodule.exports = { PlantCard, styles };`, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function(...Object.keys(scope), "module", compiled)(...Object.values(scope), module);
  const tree = module.exports.PlantCard({
    plant, user, isVisitor: user?.role?.toLowerCase() === "visitor",
    navigation: { navigate: (...args) => calls.push(args) },
    favourites: { isFavourite: () => true, isPending: () => false, loading: false, toggle: (...args) => calls.push(args) },
  });
  const nodes = (node) => node && typeof node === "object"
    ? [node, ...React.Children.toArray(node.props?.children).flatMap(nodes)] : [];
  return { all: nodes(tree), styles: module.exports.styles, plant, calls, t };
}

test("Visitor and Guest cards omit all badges and Location Zone in EN/MS/ZH while preserving facts and actions", () => {
  for (const language of ["en", "ms", "zh"]) {
    for (const user of [{ role: "Visitor" }, null, { role: "Guest" }]) {
      const { all, styles, plant, calls, t } = renderListCard(user, language);
      assert.equal(all.some((node) => node.props.style === styles.imageBadges), false);
      assert.equal(all.some((node) => node.props.label === t("plant.locationZone")), false);
      assert.equal(all.some((node) => node.props.children === t("map.locationRestricted")), false);
      assert.equal(all.some((node) => node.props.children === "Approved"), false);
      for (const key of ["height", "lifeStage2", "lastVerified", "health", "morphology"]) {
        assert.ok(all.some((node) => node.props.label === t(`plant.${key}`)), key);
      }
      assert.equal(all.find((node) => node.type === "Image").props.source, plant.plantImage);
      assert.ok(all.some((node) => node.props.children === plant.plantScientificName));
      assert.ok(all.some((node) => node.props.children === t("plant.viewPlantRecord")));
      all.find((node) => node.type === "TouchableOpacity").props.onPress();
      assert.deepEqual(calls.shift(), ["PlantDetails", { plantId: "17" }]);
      const heart = all.find((node) => node.type === "FavouriteHeart");
      if (user?.role === "Visitor") {
        assert.equal(heart.props.active, true);
        heart.props.onPress();
        assert.deepEqual(calls.shift(), ["plant", "17"]);
      } else {
        assert.equal(heart, undefined, "Guest favourites behavior stays unchanged");
      }
      assert.equal(plant.currentStatus, "Approved");
      assert.equal(styles.visitorBadges, undefined, "no empty badge row spacing remains");
      assert.equal(styles.infoGrid.flexWrap, "wrap");
    }
  }
});

test("Botanist and Officer keep their existing location field and image badges", () => {
  for (const role of ["Botanist", "Officer"]) {
    const { all, styles, t } = renderListCard({ role });
    assert.ok(all.some((node) => node.props.style === styles.imageBadges));
    assert.ok(all.some((node) => node.props.label === t("plant.locationZone")));
    assert.ok(all.some((node) => node.props.children === t("map.locationRestricted")));
    assert.equal(all.some((node) => node.props.children === "Approved"), true);
  }
});

test("Botanist list cards render exactly the backend plant status, independently of observation status", () => {
  for (const status of ["Approved", "Pending Review", "Rejected", "Draft", "Correction Required", "Changes Requested", "Not recorded"]) {
    const { all, styles } = renderListCard({ role: "Botanist" }, "en", status);
    const badge = all.filter((node) => Array.isArray(node.props.style) && node.props.style.includes(styles.statusBadge));
    assert.equal(badge.length, 1);
    assert.equal(badge[0].props.children, status);
    assert.ok(badge[0].props.style.includes(status === "Approved" ? styles.statusApproved : status === "Pending Review" ? styles.statusPending : styles.statusBadge));
  }
});
