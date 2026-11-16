import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../utils/photoReuse.js", import.meta.url), "utf8")
  .replace(/^import .*;\r?\n/m, "").replace("export async function", "async function") + "\nglobalThis.downloadPhotoForReuse = downloadPhotoForReuse;";
function harness({ status = 200, contentType = "image/jpeg", size = 8 } = {}) {
  const downloads = [], deleted = [], reads = [];
  const context = vm.createContext({ Date, Math, Error, Object, Number, String, RegExp, URL, mobileApiUrl: () => "https://plant.example" });
  vm.runInContext(source, context);
  const fileSystem = {
    documentDirectory: "file:///private-documents/",
    EncodingType: { Base64: "base64" },
    getInfoAsync: async (uri) => ({ exists: true, size: uri.endsWith("/") ? 0 : size }),
    makeDirectoryAsync: async () => {},
    downloadAsync: async (uri, destination, options) => {
      downloads.push({ uri, destination, options });
      return { uri: destination, status, headers: { "Content-Type": contentType } };
    },
    readAsStringAsync: async (uri, options) => { reads.push({ uri, options }); return "aGVsbG8="; },
    deleteAsync: async (uri, options) => { deleted.push({ uri, options }); },
  };
  return { run: context.downloadPhotoForReuse, fileSystem, downloads, deleted, reads };
}
const sourcePhoto = { uri: "https://plant.example/api/species-requests/42/photo", headers: { Authorization: "Bearer private-token" } };

test("securely downloads an authenticated JPEG to private storage and reads the existing photo payload", async () => {
  const h = harness();
  const result = await h.run(h.fileSystem, sourcePhoto);
  assert.deepEqual(JSON.parse(JSON.stringify(result.photo)), { content_type: "image/jpeg", base64: "aGVsbG8=" });
  assert.deepEqual(h.downloads[0].options.headers, sourcePhoto.headers);
  assert.match(h.downloads[0].destination, /^file:\/\/\/private-documents\/photo-reuse\/photo-/);
  assert.equal(h.reads.length, 1);
  await result.cleanup();
  assert.equal(h.deleted.length, 1);
});

test("rejects unauthenticated photo sources without making a request", async () => {
  const h = harness();
  await assert.rejects(h.run(h.fileSystem, { uri: sourcePhoto.uri }), (error) => error.code === "PHOTO_REUSE_UNAVAILABLE");
  await assert.rejects(h.run(h.fileSystem, { ...sourcePhoto, uri: "https://attacker.example/api/species-requests/42/photo" }), (error) => error.code === "PHOTO_REUSE_UNAVAILABLE");
  assert.equal(h.downloads.length, 0);
});

test("cleans up and rejects failed downloads, unsupported formats, and files over 4 MB", async () => {
  const failed = harness({ status: 403 });
  await assert.rejects(failed.run(failed.fileSystem, sourcePhoto), (error) => error.code === "PHOTO_REUSE_DOWNLOAD_FAILED");
  assert.equal(failed.deleted.length, 1);

  const wrongType = harness({ contentType: "text/html" });
  await assert.rejects(wrongType.run(wrongType.fileSystem, sourcePhoto), (error) => error.code === "PHOTO_REUSE_UNSUPPORTED_FORMAT");
  assert.equal(wrongType.deleted.length, 1);

  const tooLarge = harness({ size: 4 * 1024 * 1024 + 1 });
  await assert.rejects(tooLarge.run(tooLarge.fileSystem, sourcePhoto), (error) => error.code === "PHOTO_REUSE_TOO_LARGE");
  assert.equal(tooLarge.reads.length, 0);
  assert.equal(tooLarge.deleted.length, 1);
});
