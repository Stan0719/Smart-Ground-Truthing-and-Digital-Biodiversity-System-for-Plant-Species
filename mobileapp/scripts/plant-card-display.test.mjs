import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

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
    assert.equal(catalog.plant.morphology, values[0]);
    assert.equal(catalog.plant.locationZone, values[1]);
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
