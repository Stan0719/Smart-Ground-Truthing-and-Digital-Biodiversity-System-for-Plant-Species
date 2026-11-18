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

test("the Plants page uses one owner-scoped read for own pending Zones and rejected records", () => {
  const list = read("../screens/Plant.js");
  assert.match(list, /fetchPlantRecords\(catalog, \{ accountId, scopeMine: true \}\)/);
  assert.match(list, /ownerRecords\.filter\(\(record\) => isOwnedRejectedPlant\(record, accountId\)\)/);
  assert.match(list, /mergeOwnedPendingPlantZones\(records, ownerRecords, accountId\)/);
  assert.match(list, /allowOwnedPending: isBotanist && isOwnedPendingPlant\(plant, user\?\.id\)/);
});

test("plant list refresh retains the current account's records and hides another account's records immediately", () => {
  const api = read("../utils/plantApi.js");
  const helper = api.match(/export function getScopedPlantRecords\(state, scope\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(helper, "plant API should expose scope-bound list projection");
  const context = vm.createContext({});
  vm.runInContext(`${helper.replace("export ", "")}\nthis.getScopedPlantRecords = getScopedPlantRecords;`, context);
  const records = [{ plantId: "pending-owner-record" }];
  const state = { scope: "owner:botanist:species:6", records };
  assert.equal(context.getScopedPlantRecords(state, state.scope), records);
  assert.deepEqual(Array.from(context.getScopedPlantRecords(state, "different-owner:botanist:species:6")), []);

  const list = read("../screens/Plant.js");
  assert.match(list, /getScopedPlantRecords\(scopedSpeciesPlants, requestKey\)/);
  assert.match(list, /if \(activeRequest\?\.key !== requestKey\) \{\s*setScopedSpeciesPlants\(\{ scope: requestKey, records: \[\] \}\);\s*\}/);
  assert.match(list, /setScopedSpeciesPlants\(\{ scope: requestKey, records: visibleRecords \}\)/);
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
  }
  for (const key of ["height", "health", "qrStatus2"]) assert.match(list, new RegExp(`t\\("plant\\.${key}"\\)`));
  assert.match(list, /label=\{t\("botanistPlantDetail\.growthStage"\)\} value=\{observation\?\.lifeStage \|\| t\("plant\.notRecorded"\)\}/);
  assert.doesNotMatch(list.slice(list.indexOf("function PlantCard("), list.indexOf("function plantStatusStyle(")), /t\("plant\.(morphology|locationZone|lastVerified)"\)|plant\.latestSubmission\?\.status/);
  assert.doesNotMatch(shared, /getSpeciesImageSource/);
  assert.doesNotMatch(list, /getSpeciesImageSource/);
  assert.match(shared, /failedImageUri/);
  assert.match(list, /failedImageKey/);
});

function renderListCard(user, language = "en", status = "Approved", overrides = {}) {
  const source = read("../screens/Plant.js");
  const cardSource = source.slice(source.indexOf("function PlantCard("));
  const catalog = JSON.parse(read(`../translations/${language}.json`));
  const t = (key) => key.split(".").reduce((value, part) => value?.[part], catalog) || key;
  const calls = [];
  const plant = {
    plantId: "17", currentStatus: status, plantImage: { uri: "plant-17.jpg" },
    plantScientificName: "Plant 17", latestApproved: { date: "2026-11-12", heightCm: 64, lifeStage: "Mature", healthStatus: "Healthy", morphology: "Leaves" },
    ...overrides,
  };
  const scope = {
    React, useState: (value) => [value, () => {}], useAppTranslation() {}, t,
    translateLabel: (value) => value, translateFieldValue: (_label, value) => value,
    dateLocale: () => ({ en: "en-GB", ms: "ms-MY", zh: "zh-CN" })[language],
    getPlantDisplayObservation: (record) => record.currentStatus === "Approved" ? record.latestApproved : record.latestSubmission || record.latestApproved,
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
      for (const key of ["height", "health", "qrStatus2"]) {
        assert.ok(all.some((node) => node.props.label === t(`plant.${key}`)), key);
      }
      assert.ok(all.some((node) => node.props.label === t("botanistPlantDetail.growthStage") && node.props.value === "Mature"));
      assert.equal(all.some((node) => node.props.label === t("plant.lifeStage2")), false);
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

test("Botanist and Officer keep approval badges while detailed location stays in Plant Details", () => {
  for (const role of ["Botanist", "Officer"]) {
    const { all, styles, t } = renderListCard({ role });
    assert.ok(all.some((node) => node.props.style === styles.imageBadges));
    assert.equal(styles.imageBadges.position, "absolute");
    assert.equal(styles.imageBadges.top, 12);
    assert.equal(styles.imageBadges.left, 12);
    assert.equal(styles.imageBadges.right, 12);
    assert.equal(styles.imageBadges.alignItems, "flex-end");
    assert.equal(all.some((node) => node.props.label === t("plant.locationZone")), false);
    assert.equal(all.some((node) => node.props.children === t("map.locationRestricted")), false);
    assert.equal(all.some((node) => node.props.children === "Approved"), true);
  }
});

test("Plant status badge remains at the image top-right for each status and missing-image placeholder", () => {
  for (const status of ["Approved", "Pending Review", "Rejected"]) {
    const { all, styles } = renderListCard({ role: "Botanist" }, "en", status, { plantImage: null });
    const badgeRow = all.find((node) => node.props.style === styles.imageBadges);
    assert.ok(badgeRow, `${status} badge row remains visible`);
    assert.ok(all.some((node) => node.props.style === styles.plantIcon), "missing photo placeholder remains visible");
    const badge = React.Children.toArray(badgeRow.props.children)[0];
    assert.ok(badge.props.style.includes(styles.statusBadge));
    assert.equal(badge.props.children, status);
    if (status === "Approved") assert.ok(badge.props.style.includes(styles.statusApproved));
    if (status === "Pending Review") assert.ok(badge.props.style.includes(styles.statusPending));
    if (status === "Rejected") assert.ok(badge.props.style.includes(styles.statusRejected));
  }
});

test("Plant image status badge does not ellipsize labels and accommodates localized text", () => {
  const source = read("../screens/Plant.js");
  const cardSource = source.slice(source.indexOf("function PlantCard("), source.indexOf("function plantStatusStyle("));
  const badgeSource = cardSource.slice(cardSource.indexOf('<View pointerEvents="none" style={styles.imageBadges}>'), cardSource.indexOf("</View>}", cardSource.indexOf('<View pointerEvents="none" style={styles.imageBadges}>')));
  assert.match(badgeSource, /<Text style=\{\[styles\.imageBadge, styles\.statusBadge, plantStatusStyle\(plant\.currentStatus\)\]\}>/);
  assert.doesNotMatch(badgeSource, /numberOfLines|ellipsizeMode/);
  assert.match(source, /imageBadges: \{ position: "absolute", top: 12, left: 12, right: 12, alignItems: "flex-end" \}/);
  assert.match(source, /imageBadge: \{ alignSelf: "flex-end", maxWidth: "100%", paddingHorizontal: 8, paddingVertical: 5/);
  assert.doesNotMatch(source.match(/imageBadge: \{[^\n]+/)?.[0] || "", /overflow: "hidden"|maxWidth: "48%"/);

  for (const language of ["en", "ms", "zh"]) {
    const catalog = JSON.parse(read(`../translations/${language}.json`));
    const labels = catalog.recordEdits.versionStatus;
    for (const key of ["Approved", "PendingReview", "Rejected"]) assert.ok(labels[key], `${language} ${key}`);
  }
});

test("Growth Stage uses the approved observation, an owned submission, or an honest missing value", () => {
  const label = JSON.parse(read("../translations/en.json")).botanistPlantDetail.growthStage;
  const stage = (result) => result.all.find((node) => node.props.label === label)?.props.value;
  assert.equal(stage(renderListCard({ role: "Botanist" }, "en", "Approved", {
    latestApproved: { lifeStage: "Mature" }, latestSubmission: { lifeStage: "Unreviewed seedling" },
  })), "Mature", "approved cards do not expose a pending observation");
  for (const status of ["Pending Review", "Rejected"]) {
    assert.equal(stage(renderListCard({ role: "Botanist" }, "en", status, {
      latestApproved: { lifeStage: "Old stage" }, latestSubmission: { lifeStage: "Young" },
    })), "Young", `${status} owner card uses its submitted observation`);
  }
  assert.equal(stage(renderListCard({ role: "Visitor" }, "en", "Approved", {
    latestApproved: { lifeStage: "Not recorded" },
  })), JSON.parse(read("../translations/en.json")).plant.notRecorded);
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
