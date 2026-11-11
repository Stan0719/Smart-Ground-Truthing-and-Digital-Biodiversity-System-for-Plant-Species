import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../utils/plantLocationDisplay.js", import.meta.url), "utf8")
  .replace(/export function /g, "function ");
const context = vm.createContext({});
vm.runInContext(`${source}\nthis.getPlantLocationDisplay = getPlantLocationDisplay;`, context);
const display = (location, role) => JSON.parse(JSON.stringify(context.getPlantLocationDisplay(location, role)));

test("Botanists can see available approved location fields", () => {
  assert.deepEqual(display({ latitude: 4, longitude: 113, accuracyM: 5, altitudeM: 28, zone: "Zone A" }, "Botanist"), {
    status: "available", latitude: 4, longitude: 113, accuracyM: 5, altitudeM: 28, zone: "Zone A",
  });
});

test("missing approved GPS displays not recorded for Botanists", () => {
  assert.deepEqual(display({ latitude: null, longitude: null }, "botanist"), { status: "not_recorded" });
});

test("an authorized owner can see a saved pending Zone even when the GPS pair is unavailable", () => {
  assert.deepEqual(display({ latitude: null, longitude: null, zone: "Zone B" }, "Botanist"), {
    status: "not_recorded", zone: "Zone B",
  });
  assert.deepEqual(display({ latitude: null, longitude: null }, "Botanist"), { status: "not_recorded" });
});

test("an authorized Conservation Officer sees actual valid approved coordinates", () => {
  assert.deepEqual(display({ latitude: "4.123456", longitude: 113.654321, accuracyM: 5 }, "Conservation Officer"), {
    status: "available", latitude: 4.123456, longitude: 113.654321, accuracyM: 5, altitudeM: null, zone: null,
  });
});

test("an authorized viewer sees not recorded when no approved GPS pair is returned", () => {
  assert.deepEqual(display({ latitude: null, longitude: null }, "Conservation Officer"), { status: "not_recorded" });
  assert.deepEqual(display({ latitude: 4, longitude: null }, "Conservation Officer"), { status: "not_recorded" });
});

test("Visitors remain restricted even if the client object contains location fields", () => {
  assert.deepEqual(display({ latitude: 4, longitude: 113, altitudeM: 28, zone: "Zone A" }, "Visitor"), { status: "restricted" });
  assert.deepEqual(display({ latitude: null, longitude: null, zone: "Owner-only Zone" }, "Visitor"), { status: "restricted" });
});

test("Map and Plant Details use the same location display policy", () => {
  for (const screen of ["Map.js", "PlantDetail.js"]) {
    const screenSource = readFileSync(new URL(`../screens/${screen}`, import.meta.url), "utf8");
    assert.match(screenSource, /getPlantLocationDisplay/);
    assert.match(screenSource, /map\.locationRestricted/);
    assert.match(screenSource, /map\.locationNotRecorded/);
  }
  const map = readFileSync(new URL("../screens/Map.js", import.meta.url), "utf8");
  const detail = readFileSync(new URL("../screens/PlantDetail.js", import.meta.url), "utf8");
  assert.ok(detail.indexOf("const [plant, setPlant]") < detail.indexOf("const locationDisplay"));
  assert.match(map, /fetchPlantRecords\(\[\], \{ accountId: user\.id, scopeMine: true \}\)/);
  assert.match(map, /recordsById\.set\(record\.plantId, record\)/);
  assert.match(detail, /fetchPlantDetail\(plantId, \{ \.\.\.options, scopeMine: true \}\)/);
  assert.match(detail, /if \(error\?\.status !== 404\) throw error/);
  assert.match(detail, /isOwnedPendingPlant\(plant, user\?\.id\)/);
  assert.match(detail, /const locationZoneValue = locationDisplay\.zone/);
  assert.ok((detail.match(/\{locationZoneValue\}|value=\{locationZoneValue\}/g) || []).length >= 2);
  for (const value of ["accuracyM", "altitudeM", "zone"]) {
    assert.match(map, new RegExp(`location\\.${value}`));
    assert.match(detail, new RegExp(`locationDisplay\\.${value}`));
  }
});
