import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const { hasMoreContent } = await import("data:text/javascript;base64," + Buffer.from(read("utils/scrollOverflow.js")).toString("base64"));

test("scroll cue appears only for measured overflow and disappears at the end", () => {
  assert.equal(hasMoreContent(900, 0), false);
  assert.equal(hasMoreContent(400, 400), false);
  assert.equal(hasMoreContent(900, 400), true);
  assert.equal(hasMoreContent(900, 400, 480), true);
  assert.equal(hasMoreContent(900, 400, 490), false);
  assert.equal(hasMoreContent(600, 300, 0), true);
});

test("priority forms, details and filter rows use the measured scroll cue", () => {
  for (const file of ["AddPlant", "AddSpeciesRequest", "EditPlantRecord", "FieldCollection", "BotanistSpeciesRequestDetail", "RecordChangeReview", "BotanistMyDrafts", "BotanistDashboard", "BotanistPlantDetail", "PlantDetail", "SpeciesDetail", "PlantQRCode", "Map"]) {
    assert.match(read(`screens/${file}.js`), /DiscoverableScrollView/);
  }
  const component = read("components/DiscoverableScrollView.js");
  assert.match(component, /onContentSizeChange=\{sizeChanged\}/);
  assert.match(component, /onLayout=\{layoutChanged\}/);
  assert.match(component, /onScroll=\{scrolled\}/);
  assert.match(component, /\{showHint && more && <View/);
  assert.match(read("screens/BotanistMyDrafts.js"), /<DiscoverableScrollView horizontal showHint=\{false\}/);
});

test("Species filters use a height-neutral horizontal scroller above the flexible grid", () => {
  const screen = read("screens/Species.js");
  assert.match(screen, /<ScrollView horizontal showsHorizontalScrollIndicator[\s\S]*?statusFilters[\s\S]*?<\/ScrollView>/);
  assert.doesNotMatch(screen, /DiscoverableScrollView/);
  assert.match(screen, /resultsList: \{ flex: 1 \}/);
  assert.match(screen, /<SafeAreaView style=\{styles\.safeArea\} edges=\{\["top", "left", "right"\]\}/);
  assert.match(screen, /listContent: \{\s*paddingBottom: 8/);
  assert.doesNotMatch(screen, /ListFooterComponent=/);
});

test("scroll cues are localized in all supported languages", () => {
  for (const language of ["en", "ms", "zh"]) {
    const hints = JSON.parse(read(`translations/${language}.json`)).scrollHints;
    assert.ok(hints.vertical && hints.horizontal);
    assert.ok(hints.speciesList && hints.qrList && hints.searchResults);
  }
});

test("scroll cues use compact transparent chevrons without a full-width banner", () => {
  const component = read("components/DiscoverableScrollView.js");
  assert.match(component, /name=\{horizontal \? "chevron-forward" : "chevron-down"\}/);
  assert.match(component, /showHint && more && <View/);
  assert.doesNotMatch(component, /backgroundColor: "#E8F2E9"/);
  assert.doesNotMatch(component, /minHeight: 32/);
  assert.match(component, /accessibilityLabel=\{label\}/);
  for (const language of ["en", "ms", "zh"]) {
    const hints = JSON.parse(read(`translations/${language}.json`)).scrollHints;
    for (const key of ["speciesList", "qrList", "searchResults"]) assert.ok(hints[key].length <= 40);
  }
});

test("nested picker cues keep independent scrolling and the outer Add Plant cue", () => {
  const form = read("screens/AddPlant.js");
  assert.match(form, /<DiscoverableScrollView scrollEnabled=\{!mapInteracting\} ref=\{formScrollRef\}/);
  assert.match(form, /<DiscoverableScrollView nested hintKey="scrollHints\.speciesList"[^>]*>[\s\S]*?<\/DiscoverableScrollView>/);
  assert.match(form, /<DiscoverableScrollView nested hintKey="scrollHints\.qrList"[^>]*>[\s\S]*?<\/DiscoverableScrollView>/);
  assert.equal((form.match(/nestedScrollEnabled keyboardShouldPersistTaps="always" showsVerticalScrollIndicator/g) || []).length >= 2, true);
  assert.equal(hasMoreContent(720, 280), true);
  assert.equal(hasMoreContent(200, 280), false);
  assert.equal(hasMoreContent(720, 280, 440), false);
  assert.match(read("components/SpeciesDictionary.js"), /nested hintKey="scrollHints\.searchResults"/);
});
