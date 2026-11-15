"use strict";

const QR_ASSIGNMENT_UNAVAILABLE_MESSAGE =
  "QR assignment is temporarily unavailable until plant records are reconciled.";

function normalizeQrPlantSchema(schema = "plant_app") {
  if (schema !== "plant_app")
    throw Error("PLANT_QR_PLANT_SCHEMA must be plant_app after migration 015.");
  return schema;
}

function qrPlantRecordRelation(schema) {
  return `${normalizeQrPlantSchema(schema)}.plant_record`;
}

function assertQrAssignmentAllowed(schema) {
  normalizeQrPlantSchema(schema);
}

module.exports = {
  QR_ASSIGNMENT_UNAVAILABLE_MESSAGE,
  assertQrAssignmentAllowed,
  normalizeQrPlantSchema,
  qrPlantRecordRelation,
};
