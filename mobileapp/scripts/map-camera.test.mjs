import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../utils/mapCamera.js", import.meta.url), "utf8")
  .replace(/export const /g, "const ").replace(/export function /g, "function ");
const context = vm.createContext({});
vm.runInContext(`${source}\nthis.mapCamera = { SARAWAK_REGION, validMapPoint, initialMapCluster };`, context);
const { SARAWAK_REGION, validMapPoint, initialMapCluster } = context.mapCamera;
const plant = (plantId, latitude, longitude) => ({ plantId, mapLocation: { latitude, longitude } });
const ids = (plants) => Array.from(initialMapCluster(plants), ({ plant: item }) => item.plantId);

test("coordinates require a complete finite latitude/longitude pair in range", () => {
  for (const [lat, lon] of [[null, 113], [4, undefined], ["", 113], ["   ", 113], [true, 113], [91, 113], [4, 181], [NaN, 113], [4, Infinity], ["abc", 113]]) {
    assert.equal(validMapPoint(plant("invalid", lat, lon)), null);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(validMapPoint(plant("niah", "3.82", "113.78")))),
    { latitude: 3.82, longitude: 113.78 });
  assert.equal(validMapPoint(plant("swapped", 113.78, 3.82)), null);
  assert.deepEqual(JSON.parse(JSON.stringify(validMapPoint(plant("zero", 0, 0)))),
    { latitude: 0, longitude: 0 }, "valid but unexpected coordinates remain available for investigation");
});

test("opening camera prefers a coherent Sarawak group without relocating distant markers", () => {
  const plants = [plant("niah-1", 3.82, 113.78), plant("niah-2", 3.83, 113.79),
    plant("kuching", 1.55, 110.35), plant("pacific-1", 20, -160), plant("pacific-2", 20.01, -160.01), plant("pacific-3", 20.02, -160.02)];
  assert.deepEqual(ids(plants), ["niah-1", "niah-2"]);
  assert.equal(plants.length, 6, "the full input stays available to render as markers");
});

test("when no Sarawak marker exists the opening camera uses an actual distant group", () => {
  assert.deepEqual(ids([plant("a", 20, -160), plant("b", 20.02, -160.01)]), ["a", "b"]);
  assert.deepEqual(ids([]), []);
  assert.equal(SARAWAK_REGION.latitude, 3.82);
  assert.equal(SARAWAK_REGION.longitude, 113.78);
});

test("native map keeps all valid markers, offers individual access to outliers and preserves details navigation", () => {
  const native = readFileSync(new URL("../components/PlantExplorerMap.native.js", import.meta.url), "utf8");
  const screen = readFileSync(new URL("../screens/Map.js", import.meta.url), "utf8");
  assert.match(native, /initialRegion=\{SARAWAK_REGION\}/);
  assert.match(native, /validPlants\.map\(\(plant\) => \(/);
  assert.match(native, /distantPlants\.map\(\(plant\) =>/);
  assert.match(native, /onPress=\{\(\) => \{ onSelectPlant\(plant\.plantId\); focusPlant\(plant\); \}\}/);
  assert.match(native, /onViewDetails\(selected\)/);
  assert.match(screen, /plants=\{mappedPlants\}/);
  assert.match(screen, /filterMapPlantsByStatus\(documentedPlants/);
});
