import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the catalogue has button and pull refresh backed by the shared API loader", () => {
  const source = read("screens/Species.js");
  assert.match(source, /testID="catalogue-species-refresh"/);
  assert.match(source, /const refreshAll = useCallback\(\(\) => Promise\.all\(\[refresh\(\), refreshFavourites\(true\)\]\)/);
  assert.match(source, /onPress=\{refreshAll\}/);
  assert.match(source, /onRefresh=\{refreshAll\}/);
});

for (const [file, loader, buttonId, guard] of [
  ["screens/SpeciesDetail.js", "loadSpeciesDetails", "species-detail-refresh", /if \(requestRef\.current\) return requestRef\.current/],
  ["screens/Plant.js", "loadSpeciesPlants", "plant-list-refresh", /activeRequest\?\.key === listRequestKey && activeRequest\.promise && !activeRequest\.more/],
  ["screens/PlantDetail.js", "loadPlant", "plant-detail-refresh", /if \(requestRef\.current\) return requestRef\.current/],
]) {
  test(`${file} refreshes through its guarded loader without clearing successful content on failure`, () => {
    const source = read(file);
    assert.match(source, /<RefreshControl/);
    assert.ok(source.includes(`onRefresh={() => { void ${loader}(true);`));
    assert.ok(source.includes(buttonId), `refresh control should expose ${buttonId}`);
    assert.match(source, guard);
    const catchAt = source.indexOf("} catch (error) {");
    const finallyAt = source.indexOf("} finally {", catchAt);
    assert.ok(catchAt >= 0 && finallyAt > catchAt, "loader should have a bounded error handler");
    const errorHandler = source.slice(catchAt, finallyAt);
    assert.ok(!errorHandler.includes("setSpeciesPlants([])") && !errorHandler.includes("setPlant(null)"));
    if (file === "screens/PlantDetail.js") {
      assert.ok(source.includes("setPlant(null);"), "changing plant IDs must clear the previous owner's record");
      assert.match(source, /useEffect\(\(\) => \{[\s\S]*?setPlant\(null\);[\s\S]*?\}, \[plantId\]\)/);
    }
  });
}

test("plant detail refresh forwards the expected account through every API read", async () => {
  const source = read("utils/plantApi.js")
    .replace(/^import .*;\r?\n/gm, "")
    .replace(/export /g, "");
  const calls = [];
  const response = (payload) => ({ ok: true, status: 200, text: async () => JSON.stringify(payload) });
  const context = vm.createContext({
    mobileApiUrl: () => "https://plant.example",
    faceSession: {
      hasSession: () => false,
      withToken: async (operation) => operation("private-test-token", { id: "owner", role: "botanist" }),
    },
    fetch: async (url, options) => {
      calls.push({ url, authorization: options.headers.Authorization });
      if (url.includes("/api/plants/8")) return response({ plant: { plant_id: 8, species_id: 6, scientific_name: "Plant name", rbac_status: "Approved" } });
      if (url.includes("/api/species")) return response({ species: [{ species_id: 6, scientific_name: "Species name", common_name: "Common name" }] });
      if (url.includes("/api/observations")) return response({ observations: [{ id: "obs-8", plant_id: 8, status: "Approved", content: {} }] });
      throw new Error(`Unexpected URL: ${url}`);
    },
    AbortSignal,
    console,
  });
  vm.runInContext(source, context);
  const plant = await vm.runInContext("fetchPlantDetail(8, { includeObservations: true, accountId: 'owner' })", context);
  assert.equal(plant.plantId, "8");
  assert.equal(plant.speciesId, "6");
  assert.equal(calls.length, 4, "plant detail also reads the plant's asset list");
  assert.ok(calls.every((call) => call.authorization === "Bearer private-test-token"));
  assert.ok(calls.some((call) => call.url.endsWith("/api/species?scope=scientific")));
  assert.ok(calls.some((call) => call.url.endsWith("/api/assets?plant_id=8")));
});
