import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { submissionGroupMatchesSearch } from "../utils/submissionSearch.js";

const dashboard = readFileSync(new URL("../screens/BotanistDashboard.js", import.meta.url), "utf8");

test("Plant submission search matches names, IDs, zones and species names case-insensitively", () => {
  const group = { record: { id: "plant-30", plantId: "30", plantScientificName: "Shorea parvifolia",
    plantCommonName: "Meranti", zone: "Niah West", speciesDetails: { scientificName: "Shorea parvifolia" } }, versions: [] };
  for (const query of ["shorea", "MER", "  plant-30 ", "30", "niah", "parvifolia"])
    assert.equal(submissionGroupMatchesSearch(group, "plants", query), true, query);
  assert.equal(submissionGroupMatchesSearch(group, "plants", "unrelated"), false);
  assert.equal(submissionGroupMatchesSearch(group, "plants", "  "), true);
});

test("Species request search uses available scientific name, family, genus and request ID only", () => {
  const group = { record: { request_id: "req-9", scientific_name: "Hopea nervosa", family_name: "Dipterocarpaceae",
    genus_name: "Hopea", unrelatedPrivateNote: "secret phrase" }, versions: [] };
  for (const query of ["hopea", "nerv", "diptero", "req-9"])
    assert.equal(submissionGroupMatchesSearch(group, "requests", query), true, query);
  assert.equal(submissionGroupMatchesSearch(group, "requests", "secret phrase"), false, "unapproved unrelated fields are excluded from matching");
});

test("My Submissions combines search with the selected category and existing status filter", () => {
  assert.match(dashboard, /const data = filterSubmissionGroups\(groups, filter\)/);
  assert.match(dashboard, /const searchedData = data\.filter\(\(group\) => submissionGroupMatchesSearch\(group, tab, searchQuery\)\)/);
  assert.match(dashboard, /data=\{searchedData\}/);
  assert.match(dashboard, /testID="submissions-search"/);
  assert.equal((dashboard.match(/testID="submissions-search"/g) || []).length, 1);
  assert.ok(dashboard.indexOf('testID={"submissions-tab-" + value}') < dashboard.indexOf('testID="submissions-search"'));
  assert.ok(dashboard.indexOf('testID="submissions-search"') < dashboard.indexOf('testID={"submissions-filter-" + value}'));
  assert.match(dashboard, /setSearchQuery\(""\)/);
  assert.match(dashboard, /noMatchingSubmissions/);
});

test("submission search text is localized in English, Malay and Chinese", () => {
  for (const code of ["en", "ms", "zh"]) {
    const translations = JSON.parse(readFileSync(new URL(`../translations/${code}.json`, import.meta.url), "utf8"));
    assert.ok(translations.submissions.searchPlaceholder, code);
    assert.ok(translations.submissions.noMatchingSubmissions, code);
    assert.ok(translations.submissions.searchEmptyHint, code);
  }
});
