import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inspectPickedImages, imageSizeAlert, MAX_IMAGE_BYTES } from "../utils/imageSelection.js";

const translations = Object.fromEntries(["en", "ms", "zh"].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../translations/${locale}.json`, import.meta.url), "utf8")).imageSizeAlert]));
const translate = (locale) => (key) => translations[locale][key.split(".")[1]];

test("4 MiB boundary and invalid replacement preserve accepted photos", async () => {
  const oldPhoto = "file://old.jpg";
  const result = await inspectPickedImages([{ uri: "file://valid.jpg", fileSize: MAX_IMAGE_BYTES }, { uri: "file://large.jpg", fileSize: MAX_IMAGE_BYTES + 1 }], ["Leaf Photo", "Stem / Bark Photo"]);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 1);
  assert.equal(oldPhoto, "file://old.jpg");
});

test("every category and all oversized files appear with safe filenames and sizes", async () => {
  const labels = ["Whole Plant Photo", "Leaf Photo", "Stem / Bark Photo", "Species Photo", "Observation Photo"];
  const assets = labels.map((_, index) => ({ uri: `file://private/${index}`, fileName: index === 4 ? undefined : `IMG_${index}.jpg`, fileSize: 6.8 * 1048576 }));
  const result = await inspectPickedImages(assets, labels);
  const alert = imageSizeAlert(translate("en"), result.rejected);
  assert.equal(alert.title, "Images Too Large");
  for (const label of labels) assert.match(alert.message, new RegExp(label.replace("/", "\\/")));
  assert.match(alert.message, /IMG_0.jpg/);
  assert.match(alert.message, /6.8 MB/);
  assert.match(alert.message, /4 MB per image/);
  assert.doesNotMatch(alert.message, /file:\/\/|undefined|null/);
});

test("file metadata fallback and unavailable size never accept an unverified replacement", async () => {
  const checked = await inspectPickedImages([{ uri: "file://one" }, { uri: "file://two" }], ["Photo 1", "Photo 2"], async (uri) => uri.endsWith("one") ? { exists: true, size: 1024 } : { exists: false });
  assert.equal(checked.accepted.length, 1);
  assert.equal(checked.rejected.length, 1);
  assert.match(imageSizeAlert(translate("en"), checked.rejected).message, /could not be checked/);
});

test("English, Malay and Chinese warnings retain localized category and action", () => {
  for (const locale of ["en", "ms", "zh"]) {
    const alert = imageSizeAlert(translate(locale), [{ label: translations[locale].speciesPhoto, filename: "species.jpg", bytes: 6 * 1048576 }]);
    assert.equal(alert.title, translations[locale].title);
    assert.match(alert.message, /species.jpg/);
    assert.match(alert.message, /6.0 MB/);
    assert.match(alert.message, /4 MB/);
    assert.ok(alert.message.includes(translations[locale].action));
  }
});
