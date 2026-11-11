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

test("Visitor cards trust the approved-only catalogue, hide explicit non-approved rows, and label status clearly", () => {
  const list = read("../screens/Plant.js");
  assert.match(list, /isPlantVisibleInRoleCatalog\(record, user\?\.role, user\?\.id\)/);
  assert.match(read("../utils/plantApi.js"), /normalizedRole === "visitor"\) return plant\?\.currentStatus === "Approved"/);
  assert.match(list, /const displayStatus = plant\.currentStatus/);
  assert.match(list, /!isVisitor && <View pointerEvents="none" style=\{styles\.imageBadges\}>/);
  assert.match(list, /isVisitor && <View style=\{styles\.visitorBadges\}>/);
  assert.match(list, /visitorBadge, styles\.statusBadge, plantStatusStyle\(displayStatus\)/);
  assert.match(list, /visitorBadges: \{ flexDirection: "row", flexWrap: "wrap"/);
  assert.match(list, /numberOfLines=\{2\} style=\{\[styles\.imageBadge, styles\.visitorBadge/);
  assert.match(list, /plantHeart: \{ position: "absolute", top: 8, right: 8/);
  assert.match(list, /favourites\.toggle\("plant", plant\.plantId\)/);
  assert.match(read("../components/FavouriteHeart.js"), /width: 44, height: 44/);
  assert.match(list, /imageSource \? \(/);
  assert.match(list, /styles\.plantIcon/);
});

test("Visitor status and location badges wrap below the image instead of competing with the heart", () => {
  const list = read("../screens/Plant.js");
  const cardBody = list.slice(list.indexOf("function PlantCard("), list.indexOf("function plantStatusStyle"));
  assert.ok(cardBody.indexOf("visitorBadges") > cardBody.indexOf("cardImage"));
  assert.ok(cardBody.indexOf("visitorBadges") < cardBody.indexOf("plantHeart"));
  assert.match(list, /visitorBadge: \{ maxWidth: "100%", flexShrink: 1 \}/);
});
