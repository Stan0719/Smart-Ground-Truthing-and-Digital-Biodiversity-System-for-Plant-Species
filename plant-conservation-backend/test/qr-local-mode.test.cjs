"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createPlantApp } = require("../server.js");
const {
  assertQrAssignmentAllowed,
  normalizeQrPlantSchema,
  qrPlantRecordRelation,
} = require("../qr-plant-mode.cjs");

test("post-migration QR parent configuration accepts only plant_app", () => {
  assert.equal(normalizeQrPlantSchema("plant_app"), "plant_app");
  assert.equal(qrPlantRecordRelation("plant_app"), "plant_app.plant_record");
  assert.doesNotThrow(() => assertQrAssignmentAllowed("plant_app"));
});

test("legacy public QR parent configuration is rejected", () => {
  assert.throws(
    () => normalizeQrPlantSchema("public"),
    /PLANT_QR_PLANT_SCHEMA must be plant_app after migration 015/,
  );
  assert.throws(
    () => qrPlantRecordRelation("public"),
    /PLANT_QR_PLANT_SCHEMA must be plant_app after migration 015/,
  );
  assert.throws(
    () => assertQrAssignmentAllowed("public"),
    /PLANT_QR_PLANT_SCHEMA must be plant_app after migration 015/,
  );
});

test("application startup rejects legacy public QR parent mode", () => {
  assert.throws(
    () => createPlantApp({ auth: {}, pool: {}, qrPlantSchema: "public" }),
    /PLANT_QR_PLANT_SCHEMA must be plant_app after migration 015/,
  );
});
