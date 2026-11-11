import test from "node:test";
import assert from "node:assert/strict";
import { parsePlantQrPayload } from "../utils/qrPayload.js";

test("scanner preserves the opaque assigned QR payload", () => {
  const payload = "b27dcd6c40a7b1b7c13ab06953acca03390d1d1836f353cb";
  assert.equal(parsePlantQrPayload(payload), payload);
});

test("scanner extracts and decodes the token from stable QR lookup URLs", () => {
  assert.equal(parsePlantQrPayload("https://botanist.example/api/qr/a%2Fb"), "a/b");
  assert.equal(parsePlantQrPayload("https://botanist.example/qr/token-8/"), "token-8");
});

test("scanner rejects unrelated URLs and empty or oversized payloads", () => {
  assert.throws(() => parsePlantQrPayload("https://botanist.example/plants/8"), /not a plant record code/);
  assert.throws(() => parsePlantQrPayload("   "), /valid plant token/);
  assert.throws(() => parsePlantQrPayload("x".repeat(201)), /valid plant token/);
});
