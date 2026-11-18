import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../screens/Map.js", import.meta.url), "utf8");

test("Plant Explorer renders the existing search below Documented Plants and before filters and cards", () => {
  const title = source.indexOf("{t(\"map.plantExplorer\")}");
  const mapHeading = source.indexOf("{t(\"map.biodiversityMap\")}");
  const map = source.indexOf("<PlantExplorerMap");
  const documentedHeading = source.indexOf("{t(\"map.documentedPlants\")}");
  const search = source.indexOf("<View style={styles.searchContainer}>");
  const filters = source.indexOf("contentContainerStyle={styles.statusFilters}");
  const cards = source.indexOf("<FlatList data={filteredPlants}");
  assert.ok(title < mapHeading && mapHeading < map && map < documentedHeading && documentedHeading < search && search < filters && filters < cards);
  assert.equal((source.match(/<View style=\{styles\.searchContainer\}>/g) || []).length, 1, "the existing search appears once");
  assert.match(source, /searchContainer: \{ minHeight: 52,[\s\S]*?marginBottom: 15,/);
});

test("search keeps its filtering, clear behavior and map component selection state", () => {
  assert.match(source, /function matchesPlantSearch\(plant, value\)/);
  assert.match(source, /onChangeText=\{updateSearch\}/);
  assert.match(source, /onPress=\{\(\) => updateSearch\(""\)\}/);
  assert.match(source, /filterMapPlantsByStatus\(documentedPlants, user\?\.role, user\?\.id, effectiveStatusFilter\)/);
  assert.match(source, /PlantExplorerMap key=\{isBotanist \? effectiveStatusFilter : "default"\}/);
  assert.doesNotMatch(source, /PlantExplorerMap key=\{isBotanist \? `\$\{statusFilter\}:\$\{search\}`/);
});
