import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { createFieldCapture } = await import(
  "data:text/javascript;base64," +
    Buffer.from(
      readFileSync(
        new URL("../utils/fieldCapture.js", import.meta.url),
        "utf8",
      ),
    ).toString("base64")
);
function fixture() {
  let permission = true,
    result = {
      canceled: false,
      assets: [{ base64: "/9j/AAAA", uri: "file://synthetic.jpg" }],
    },
    coords = { latitude: 0, longitude: 0, accuracy: 2 },
    calls = 0;
  const capture = createFieldCapture({
    imagePicker: {
      requestCameraPermissionsAsync: async () => ({ granted: permission }),
      requestMediaLibraryPermissionsAsync: async () => ({
        granted: permission,
      }),
      launchCameraAsync: async () => {
        calls++;
        return result;
      },
      launchImageLibraryAsync: async () => {
        calls++;
        return result;
      },
    },
    location: {
      Accuracy: { High: 4 },
      requestForegroundPermissionsAsync: async () => ({
        status: permission ? "granted" : "denied",
      }),
      getCurrentPositionAsync: async () => {
        calls++;
        return { coords };
      },
    },
  });
  return {
    capture,
    deny: () => (permission = false),
    result: (v) => (result = v),
    coords: (v) => (coords = v),
    calls: () => calls,
  };
}
test("denied camera/library/GPS never launches native capture or reads location", async () => {
  const f = fixture();
  f.deny();
  for (const camera of [true, false])
    await assert.rejects(f.capture.photo(camera, 0), /denied/);
  await assert.rejects(f.capture.coordinates(), /denied/);
  assert.equal(f.calls(), 0);
});
test("photo cancellation, missing data, unsupported image and size limits are explicit", async () => {
  const f = fixture();
  f.result({ canceled: true });
  assert.equal(await f.capture.photo(true, 0), null);
  f.result({ canceled: false, assets: [{}] });
  await assert.rejects(f.capture.photo(true, 0), /no image data/);
  f.result({ assets: [{ base64: "R0lGODlh" }] });
  await assert.rejects(f.capture.photo(false, 0), /JPEG or PNG/);
  f.result({ assets: [{ base64: "/9j/" + "A".repeat(5592408) }] });
  await assert.rejects(f.capture.photo(true, 0), /4 MB/);
  await assert.rejects(f.capture.photo(true, 3), /three/);
});
test("captured base64 survives local URI loss and valid zero GPS coordinates are retained", async () => {
  const f = fixture();
  assert.equal((await f.capture.photo(true, 0)).content_type, "image/jpeg");
  assert.deepEqual(await f.capture.coordinates(), {
    latitude: "0",
    longitude: "0",
    accuracy_m: "2",
  });
  f.coords({ latitude: NaN, longitude: 1 });
  await assert.rejects(f.capture.coordinates(), /invalid GPS/);
  f.coords({ latitude: 1, longitude: 1, accuracy: -1 });
  await assert.rejects(f.capture.coordinates(), /invalid GPS/);
});
