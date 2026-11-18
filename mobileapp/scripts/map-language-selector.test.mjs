import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const map = readFileSync(new URL("../screens/Map.js", import.meta.url), "utf8");
const selector = readFileSync(new URL("../components/LanguageSelector.js", import.meta.url), "utf8");

test("Plant Explorer reuses the shared language selector in its responsive top header", () => {
  assert.match(map, /import LanguageSelector from "\.\.\/components\/LanguageSelector"/);
  assert.match(map, /<View style=\{styles\.headerTop\}>\s*<Text style=\{styles\.title\}>\{t\("map\.plantExplorer"\)\}<\/Text>\s*<LanguageSelector \/>/);
  assert.match(map, /headerTop: \{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 \}/);
  assert.match(map, /title: \{ flex: 1, minWidth: 0/);
});

test("shared selector preserves the existing language options and persistence behavior", () => {
  assert.match(selector, /localization\.changeLanguage\(value\)/);
  assert.match(selector, /code: "en", name: "English", short: "EN"/);
  assert.match(selector, /code: "ms", name: "Bahasa Melayu", short: "BM"/);
  assert.match(selector, /code: "zh", name:/);
});
