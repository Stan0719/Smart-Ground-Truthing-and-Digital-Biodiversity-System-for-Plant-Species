import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const React = require("react");
const ts = require("typescript");
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const compiled = ts.transpileModule(read("../components/PlantCard.js"), {
  fileName: "PlantCard.jsx",
  compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
}).outputText;

function renderCard({ user, language, tablet, speciesDetailCard = true, status = "Approved" }) {
  const catalog = JSON.parse(read(`../translations/${language}.json`));
  const t = (key) => key.split(".").reduce((value, part) => value?.[part], catalog) || key;
  const native = {
    StyleSheet: { create: (styles) => styles },
    useWindowDimensions: () => ({ width: tablet ? 1024 : 390 }),
    Dimensions: { get: () => ({ width: tablet ? 1024 : 390, height: tablet ? 1366 : 844 }) },
    Platform: { OS: "ios", isPad: tablet },
  };
  for (const name of ["View", "Text", "TouchableOpacity", "Image"]) native[name] = name;
  const dependencies = {
    react: { ...React, useState: (value) => [value, () => {}] },
    "react-native": native,
    "../translations/i18n": { t, translateLabel: (value) => value, translateFieldValue: (_label, value) => value, useAppTranslation() {}, dateLocale: () => language },
    "../utils/plantApi": { getPlantDisplayObservation: (plant) => plant.latestApproved },
    "../utils/plantCardDisplay": { getPlantCardZoneLabel: () => t("map.locationRestricted") },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    assert.ok(name in dependencies, name);
    return { ...dependencies[name], __esModule: name !== "react" };
  }, module, module.exports);
  const plant = { plantId: "17", currentStatus: status, plantScientificName: "Plant 17", plantImage: { uri: "plant-17.jpg" }, latestApproved: { heightCm: 64, lifeStage: "Mature", healthStatus: "Healthy", morphology: "Leaves", date: "2026-11-12" } };
  const calls = [];
  const tree = module.exports.default({ user, plant, speciesDetailCard, navigation: { navigate: (...args) => calls.push(args) } });
  const nodes = (node) => node && typeof node === "object" ? [node, ...React.Children.toArray(node.props?.children).flatMap(nodes)] : [];
  const all = nodes(tree);
  const badgeRows = all.filter((node) => node.type === "View" && node.props.style?.flexDirection === "row" && (node.props.style.gap === 5 || node.props.pointerEvents === "none"));
  return { all, tree, plant, calls, badgeRows, t };
}

test("Species Detail omits the entire badge row for Visitor and Guest on iPhone/iPad in EN/MS/ZH", () => {
  for (const language of ["en", "ms", "zh"]) for (const tablet of [false, true]) {
    for (const user of [{ role: "Visitor" }, null, { role: "Guest" }]) {
      const { all, tree, plant, calls, badgeRows, t } = renderCard({ user, language, tablet });
      assert.equal(badgeRows.length, 0, "no badge container or its margin remains");
      assert.equal(all.some((node) => node.type === "Text" && node.props.children === "Approved"), false);
      const facts = all.filter((node) => typeof node.type === "function" && node.props.label);
      assert.equal(facts.length, 5, "only the location field is removed, with no empty placeholder");
      assert.equal(facts.some((node) => node.props.label === t("plant.locationZone")), false);
      assert.equal(facts.some((node) => node.props.value === t("map.locationRestricted")), false);
      for (const key of ["height", "lifeStage", "health", "morphology", "lastVerified"]) {
        assert.ok(facts.some((node) => node.props.label === t(`plant.${key}`)), key);
      }
      assert.equal(all.find((node) => node.type === "Image").props.source, plant.plantImage);
      assert.ok(all.some((node) => node.props.children === plant.plantScientificName));
      assert.ok(all.some((node) => node.props.children === t("plantCard.viewRecord")));
      tree.props.onPress();
      assert.deepEqual(calls, [["PlantDetails", { plantId: "17" }]]);
      assert.equal(plant.currentStatus, "Approved");
    }
  }
});

test("Species Detail preserves Botanist/Officer badges and public cards hide approval badges", () => {
  for (const language of ["en", "ms", "zh"]) for (const tablet of [false, true]) {
    for (const role of ["Botanist", "Officer"]) {
      const { all, badgeRows, t } = renderCard({ user: { role }, language, tablet });
      assert.equal(all.find((node) => node.props.label === t("plant.locationZone")).props.value, t("map.locationRestricted"));
      assert.equal(badgeRows.length, 1);
      assert.equal(React.Children.count(badgeRows[0].props.children), 2);
      assert.equal(badgeRows[0].props.style.marginBottom, 8);
    }
    for (const user of [{ role: "Visitor" }, null]) {
      const { all, badgeRows, t } = renderCard({ user, language, tablet, speciesDetailCard: false });
      assert.equal(badgeRows.length, 0);
      assert.equal(all.find((node) => node.props.label === t("plant.locationZone")).props.value, t("map.locationRestricted"), "cards outside Species Detail stay unchanged");
    }
  }
});

test("Botanist shared cards use one actual approval status across phone/tablet and card layouts", () => {
  for (const tablet of [false, true]) for (const speciesDetailCard of [false, true]) {
    for (const status of ["Approved", "Pending Review", "Rejected", "Draft", "Correction Required", "Changes Requested", "Not recorded"]) {
      const { badgeRows, plant } = renderCard({ user: { role: "Botanist" }, language: "en", tablet, speciesDetailCard, status });
      assert.equal(badgeRows.length, 1);
      const badges = React.Children.toArray(badgeRows[0].props.children);
      assert.equal(badges[0].props.children, status);
      assert.equal(badges.length, 2, "one status badge and the existing zone badge");
      assert.equal(plant.currentStatus, status);
    }
  }
});

test("Plant Detail hero shows exactly the actual status for Botanists and none for other roles", () => {
  const source = read("../screens/PlantDetail.js");
  const hero = source.match(/<View style=\{styles\.heroBadges\}>[\s\S]*?<\/View>/)?.[0];
  assert.ok(hero);
  const styleSource = source.slice(source.indexOf("const styles = StyleSheet.create("));
  const compiled = ts.transpileModule(`${styleSource}\nmodule.exports = (plant, isBotanist) => (${hero});`, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("React", "View", "Text", "StyleSheet", "translateLabel", "t", "displayedObservation", "locationZoneValue", "module", compiled)(
    React, "View", "Text", { create: (styles) => styles }, (value) => value, (key) => key,
    { healthStatus: "Healthy", lifeStage: "Mature" }, "Location restricted", module,
  );
  for (const status of ["Approved", "Pending Review", "Rejected", "Draft", "Correction Required", "Changes Requested", "Not recorded"]) {
    for (const role of ["Botanist", "Visitor", "Guest", "Officer"]) {
      const tree = module.exports({ currentStatus: status }, role === "Botanist");
      const statuses = React.Children.toArray(tree.props.children).filter((node) => node.props.children === status);
      assert.equal(statuses.length, role === "Botanist" ? 1 : 0);
      if (statuses.length) {
        const style = Object.assign({}, ...statuses[0].props.style);
        assert.equal(style.backgroundColor, status === "Approved" ? "#D8EBD9" : status === "Pending Review" ? "#F4E7D2" : "#E7EBE6");
        assert.equal(style.maxWidth, "100%");
      }
    }
  }
});
