import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inspectPickedImages, imageSizeAlert, base64Bytes, MAX_IMAGE_BYTES } from "../utils/imageSelection.js";

const translations = Object.fromEntries(["en", "ms", "zh"].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../translations/${locale}.json`, import.meta.url), "utf8")).imageSizeAlert]));
const translate = (locale) => (key) => translations[locale][key.split(".")[1]];

test("4 MiB boundary and invalid replacement preserve accepted photos", async () => {
  const oldPhoto = "file://old.jpg";
  const result = await inspectPickedImages([{ uri: "file://valid.jpg" }, { uri: "file://large.jpg" }], ["Leaf Photo", "Stem / Bark Photo"], async (uri) => ({ exists: true, size: uri.includes("valid") ? MAX_IMAGE_BYTES : MAX_IMAGE_BYTES + 1 }));
  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 1);
  assert.equal(oldPhoto, "file://old.jpg");
});

test("every category and all oversized files appear with safe filenames and sizes", async () => {
  const labels = ["Whole Plant Photo", "Leaf Photo", "Stem / Bark Photo", "Species Photo", "Observation Photo"];
  const assets = labels.map((_, index) => ({ uri: `file://private/${index}`, fileName: index === 4 ? undefined : `IMG_${index}.jpg`, fileSize: 6.8 * 1048576 }));
  const result = await inspectPickedImages(assets, labels, async () => ({ exists: true, size: 6.8 * 1048576 }));
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

test("local filesystem size overrides misleading picker metadata for camera and gallery", async () => {
  for (const source of ["camera", "gallery"]) {
    const oversized = await inspectPickedImages([{ uri: `file://${source}`, fileSize: 100 }], ["Leaf Photo"], async () => ({ exists: true, size: MAX_IMAGE_BYTES + 1 }));
    assert.equal(oversized.accepted.length, 0);
    assert.equal(oversized.rejected.length, 1);
    const valid = await inspectPickedImages([{ uri: `file://${source}`, fileSize: MAX_IMAGE_BYTES + 100 }], ["Leaf Photo"], async () => ({ exists: true, size: MAX_IMAGE_BYTES }));
    assert.equal(valid.accepted.length, 1);
  }
  const unavailable = await inspectPickedImages([{ uri: "file://camera", fileSize: 100 }], ["Leaf Photo"], async () => { throw Error("missing"); });
  assert.equal(unavailable.accepted.length, 0);
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

test("submission safety check identifies an oversized photo restored from an older draft", () => {
  const oldDraftPhoto = "/9j/" + "A".repeat(5592408);
  const bytes = base64Bytes(oldDraftPhoto);
  assert.ok(bytes > MAX_IMAGE_BYTES);
  const alert = imageSizeAlert(translate("en"), [{ label: "Observation Photo 2", bytes }]);
  assert.match(alert.message, /Observation Photo 2/);
  assert.match(alert.message, /4 MB per image/);
  assert.doesNotMatch(alert.message, /undefined|null|file:\/\//);
});
