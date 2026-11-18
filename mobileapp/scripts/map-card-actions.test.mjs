import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const screen = readFileSync(new URL("../screens/Map.js", import.meta.url), "utf8");
const nativeMap = readFileSync(new URL("../components/PlantExplorerMap.native.js", import.meta.url), "utf8");
const webMap = readFileSync(new URL("../components/PlantExplorerMap.web.js", import.meta.url), "utf8");

test("Plant cards provide separate Map and Details actions without nesting presses", () => {
  assert.match(screen, /testID=\{`plant-map-\$\{plant\.plantId\}`\}/);
  assert.match(screen, /onPress=\{\(\) => onMapPress\(plant\)\} disabled=\{!canMap\}/);
  assert.match(screen, /testID=\{`plant-details-\$\{plant\.plantId\}`\}/);
  assert.match(screen, /onPress=\{\(\) => onPress\(plant\)\}/);
  assert.match(screen, /<TouchableOpacity style=\{styles\.cardMain\}/);
  assert.match(screen, /<View style=\{styles\.cardActions\}>/);
  assert.match(screen, /plant\.mapLocation\.status === "available"/);
  assert.match(screen, /t\("map\.locationRestricted"\)/);
  assert.match(screen, /t\("map\.locationNotRecorded"\)/);
});

test("Map Plant status badge overlays the top-right of photo or placeholder without changing status colors", () => {
  const imageSection = screen.slice(screen.indexOf('<View style={styles.imageWrap}>'), screen.indexOf('<View style={styles.cardBody}>'));
  assert.match(imageSection, /styles\.imagePlaceholder/);
  assert.match(imageSection, /pointerEvents="none" style=\{\[styles\.imageStatusBadge, \{ backgroundColor: badgeBackground \}\]\}/);
  assert.match(imageSection, /translateLabel\(status\)/);
  assert.match(screen, /approved: \["#E2F4E6", "#257344"\]/);
  assert.match(screen, /"pending review": \["#FFF1D8", "#9A6210"\]/);
  assert.match(screen, /imageWrap: \{ height: 116, position: "relative"/);
  assert.match(screen, /imageStatusBadge: \{ position: "absolute", top: 8, right: 8/);
  assert.match(screen, /imageStatusBadgeText: \{ fontSize: 10, lineHeight: 13, fontWeight: "700" \}/);
  assert.doesNotMatch(screen.slice(screen.indexOf('<View style={styles.cardBody}>'), screen.indexOf('<View style={styles.cardActions}>')), /styles\.badge/);
});

test("Map action scrolls to and focuses the selected authorized registration marker", () => {
  assert.match(screen, /scrollRef\.current\?\.scrollTo\(\{ y: Math\.max\(0, mapOffset\.current - 16\), animated: true \}\)/);
  assert.match(screen, /setMapFocusRequest\(\{ plantId: plant\.plantId, sequence: \+\+focusSequence\.current \}\)/);
  assert.match(screen, /focusRequest=\{mapFocusRequest\}/);
  assert.match(nativeMap, /const requestedPlantId = focusRequest\?\.plantId/);
  assert.match(nativeMap, /validPlants\.find\(\(item\) => item\.plantId === requestedPlantId\)/);
  assert.match(nativeMap, /animateToRegion\(\{ \.\.\.coordinate, latitudeDelta: 0\.025, longitudeDelta: 0\.025 \}, 350\)/);
  assert.match(nativeMap, /selectedPlantId === plant\.plantId && styles\.selectedMarker/);
  assert.match(webMap, /plants\.find\(\(plant\) => plant\.plantId === selectedPlantId\)/);
});

test("Map buttons use localized labels and Plant Details keeps the existing route", () => {
  for (const language of ["en", "ms", "zh"]) {
    const translations = JSON.parse(readFileSync(new URL(`../translations/${language}.json`, import.meta.url), "utf8"));
    assert.ok(translations.map.details, `Missing Details label in ${language}`);
    assert.ok(translations.navigation.map, `Missing Map label in ${language}`);
  }
  assert.match(screen, /navigate\("PlantDetails", \{ plantId: plant\.plantId \}\)/);
  assert.match(screen, /data=\{filteredPlants\} keyExtractor=\{\(item\) => item\.plantId\} numColumns=\{2\}/);
});
