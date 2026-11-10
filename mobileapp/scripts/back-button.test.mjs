import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const arrowGlyphs = /[‹←⟵⟸❮⮜◀◁⇐]/u;

test("shared BackButton renders one chevron and preserves its minimum touch target", () => {
  const source = read("../components/BackButton.js");
  assert.equal((source.match(/name="chevron-back"/g) || []).length, 1);
  assert.match(source, /minWidth:\s*44/);
  assert.match(source, /minHeight:\s*44/);
  assert.match(source, /stripArrowGlyphs\(label\)/);
  assert.match(source, /stripArrowGlyphs\(accessibilityLabel \|\| label\)/);
});

test("localized plant Back labels retain their text without embedded arrows", () => {
  const expected = { en: "Back", ms: "Kembali", zh: "返回" };
  for (const [language, label] of Object.entries(expected)) {
    const translations = JSON.parse(read(`../translations/${language}.json`));
    assert.equal(translations.plant.back, label, language);
  }
});

test("localized strings contain no arrow glyphs that can duplicate the shared icon", () => {
  for (const language of ["en", "ms", "zh"]) {
    const translations = JSON.parse(read(`../translations/${language}.json`));
    const visit = (value, path = "") => {
      for (const [key, child] of Object.entries(value)) {
        const childPath = path ? `${path}.${key}` : key;
        if (typeof child === "string") {
          assert.ok(!arrowGlyphs.test(child), `${language}:${childPath} contains a Back arrow`);
        } else if (child && typeof child === "object") {
          visit(child, childPath);
        }
      }
    };
    visit(translations);
  }
});

test("centered native detail headers render a single custom Back control", () => {
  const source = read("../App.js");
  assert.match(source, /headerTitleAlign: "center"/);
  assert.match(source, /headerBackVisible: false/);
  assert.match(source, /headerLeft: \(\{ label \}\) => navigation\.canGoBack\(\)/);
  assert.match(source, /onPress=\{\(\) => navigation\.goBack\(\)\}/);
  assert.match(source, /variant="plain"/);
});
