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
  assert.equal(resolve({ loading: true, errorMessage: "offline", sourceCount: 1, visibleCount: 0, hasActiveFilters: true }), "filtered-empty", "refreshing cached records does not replace their current view with a loading screen");
  assert.equal(resolve({ loading: true, errorMessage: "", sourceCount: 1, visibleCount: 1, hasActiveFilters: false }), "results", "refreshing keeps visible records on screen");
  assert.equal(resolve({ loading: false, errorMessage: "offline", sourceCount: 1, visibleCount: 1, hasActiveFilters: false }), "results", "a failed refresh keeps visible records on screen");
  assert.equal(resolve({ loading: false, errorMessage: "offline", sourceCount: 0, visibleCount: 0, hasActiveFilters: false }), "error");
  assert.equal(resolve({ loading: false, errorMessage: "", sourceCount: 2, visibleCount: 2, hasActiveFilters: false }), "results");
  assert.equal(resolve({ loading: false, errorMessage: "", sourceCount: 0, visibleCount: 0, hasActiveFilters: false }), "empty");
  assert.equal(resolve({ loading: false, errorMessage: "", sourceCount: 2, visibleCount: 0, hasActiveFilters: true }), "filtered-empty");
  assert.equal(resolve({ loading: false, errorMessage: "", sourceCount: 0, visibleCount: 0, hasActiveFilters: true }), "empty", "filters do not cause an empty source catalogue");
});

test("loading and API-error UI exclude the leaf empty state and Clear Filters", () => {
  assert.equal((source.match(/t\("plant\.loadingPlants"\)/g) || []).length, 1, "only one plant-record loading label is rendered");
  assert.match(source, /ListEmptyComponent=\{listViewState === "loading" \? \([\s\S]*?style=\{styles\.loadingState\}/);
  assert.match(source, /\) : listViewState === "error" \? \([\s\S]*?style=\{styles\.loadError\}/);
  assert.match(source, /!!errorMessage && speciesPlants\.length > 0 && <Text accessibilityRole="alert"/);
  assert.match(source, /listViewState === "filtered-empty" && hasActiveResultFilters &&/);
  assert.match(source, /!loading && !refreshing && !errorMessage && speciesPlants\.length > 0 && listViewState !== "filtered-empty"/);
  assert.match(source, /onPress=\{\(\) => \{ void loadSpeciesPlants\(true\); \}\}/);
  assert.match(source, /const clearFilters = \(\) => \{[\s\S]*setSearchQuery\(""\)[\s\S]*setPlantStatusFilter\("allVisible"\)[\s\S]*setHealthFilter\("All"\)[\s\S]*setLifeStageFilter\("All"\)[\s\S]*setQrFilter\("All"\)[\s\S]*setZoneFilter\("All"\)[\s\S]*setSortOption\("default"\)/);
});

test("Plant header, search, filters, and advanced filters stay fixed above the scrolling FlatList", () => {
  const header = source.indexOf('<View style={styles.header}>');
  const search = source.indexOf('<View style={styles.controls}>');
  const statusFilters = source.indexOf('style={styles.statusFilters}');
  const advancedFilters = source.indexOf('{filtersOpen && (');
  const list = source.indexOf('<FlatList');
  assert.ok(header >= 0 && header < search && search < statusFilters && statusFilters < advancedFilters && advancedFilters < list);
  assert.doesNotMatch(source, /<ScrollView/);
  assert.match(source, /<FlatList[\s\S]*?style=\{styles\.listViewport\}[\s\S]*?data=\{listViewState === "results" \? filteredPlants : \[\]\}/);
  assert.match(source, /listViewport: \{ flex: 1/);
  assert.match(source, /refreshControl=\{[\s\S]*?onRefresh=\{\(\) => \{ void loadSpeciesPlants\(true\); void favourites\.refresh\(true\); \}\}/);
  assert.match(source, /\["allVisible", t\("plant\.allFilter"\)\]/);
  assert.match(source, /plantStatusFilter === "allVisible"/);
  assert.match(source, /statusFilters: \{[\s\S]*?flexWrap: "wrap"/);
  for (const language of ["en", "ms", "zh"]) {
    const catalog = JSON.parse(readFileSync(new URL(`../translations/${language}.json`, import.meta.url), "utf8"));
    assert.ok(catalog.plant.allFilter, language);
  }
});
