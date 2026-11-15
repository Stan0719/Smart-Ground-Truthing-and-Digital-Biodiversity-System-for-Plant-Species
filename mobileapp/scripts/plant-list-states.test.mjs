import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../screens/Plant.js", import.meta.url), "utf8");
const helperSource = source.match(/export function getPlantListViewState\([\s\S]*?\n\}/)?.[0];
assert.ok(helperSource, "Plant.js exports its mutually exclusive list-state selector");
const context = vm.createContext({});
vm.runInContext(`${helperSource.replace("export ", "")}; this.getPlantListViewState = getPlantListViewState;`, context);

test("Plants page distinguishes loading, results, empty, filtered-empty, and API error", () => {
  const resolve = context.getPlantListViewState;
  assert.equal(resolve({ loading: true, errorMessage: "offline", sourceCount: 1, visibleCount: 0, hasActiveFilters: true }), "loading");
  assert.equal(resolve({ loading: false, errorMessage: "offline", sourceCount: 0, visibleCount: 0, hasActiveFilters: false }), "error");
  assert.equal(resolve({ loading: false, errorMessage: "", sourceCount: 2, visibleCount: 2, hasActiveFilters: false }), "results");
  assert.equal(resolve({ loading: false, errorMessage: "", sourceCount: 0, visibleCount: 0, hasActiveFilters: false }), "empty");
  assert.equal(resolve({ loading: false, errorMessage: "", sourceCount: 2, visibleCount: 0, hasActiveFilters: true }), "filtered-empty");
  assert.equal(resolve({ loading: false, errorMessage: "", sourceCount: 0, visibleCount: 0, hasActiveFilters: true }), "empty", "filters do not cause an empty source catalogue");
});

test("loading and API-error UI exclude the leaf empty state and Clear Filters", () => {
  assert.equal((source.match(/t\("plant\.loadingPlantRecords"\)/g) || []).length, 1, "only one plant-record loading label is rendered");
  assert.match(source, /listViewState === "loading" \? <View style=\{styles\.loadingState\}/);
  assert.match(source, /listViewState === "error" \? <View style=\{styles\.loadError\}/);
  assert.match(source, /listViewState === "filtered-empty" && hasActiveResultFilters &&/);
  assert.match(source, /!loading && !refreshing && !errorMessage && speciesPlants\.length > 0 && listViewState !== "filtered-empty"/);
  assert.match(source, /onPress=\{\(\) => \{ void loadSpeciesPlants\(true\); \}\}/);
  assert.match(source, /const clearFilters = \(\) => \{[\s\S]*setSearchQuery\(""\)[\s\S]*setPlantStatusFilter\("allVisible"\)[\s\S]*setHealthFilter\("All"\)[\s\S]*setLifeStageFilter\("All"\)[\s\S]*setQrFilter\("All"\)[\s\S]*setZoneFilter\("All"\)[\s\S]*setSortOption\("default"\)/);
});
