"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { canCancelEdit, canModifyOriginalSpecies, canModifyPendingObservation } = require("../status-permissions.cjs");

test("pending edit cancellation stops after correction resubmission", () => {
  for (const status of ["Approved", "Rejected", "Withdrawn", "Superseded", "Cancelled"])
    assert.equal(canCancelEdit(status, 1), false);
  assert.equal(canCancelEdit("Pending Review", 1), true);
  assert.equal(canCancelEdit("Pending Review", 2), false);
  assert.equal(canCancelEdit("Correction Required", 1), true);
  assert.equal(canCancelEdit("Correction Required", 3), true);
  assert.equal(canCancelEdit("Pending Review", null), false);
});

test("original Species review cycle distinguishes normal pending from corrected pending", () => {
  assert.equal(canModifyOriginalSpecies("Pending Review", 1), true);
  assert.equal(canModifyOriginalSpecies("Pending Review", 2), false);
  assert.equal(canModifyOriginalSpecies("Correction Required", 2), true);
  assert.equal(canModifyOriginalSpecies("Approved", 1), false);
  assert.equal(canModifyOriginalSpecies("Rejected", 1), false);
  assert.equal(canModifyOriginalSpecies("Withdrawn", 1), false);
  assert.equal(canModifyOriginalSpecies("Pending Review", undefined, new Date()), false);
  assert.equal(canModifyOriginalSpecies("Pending Review", undefined, null), true);
});

test("original Observation review evidence locks corrected pending and ambiguous legacy rows", async () => {
  const db = (corrected, reviewed, versions = { count: 0, first_version: null, last_version: null, invalid: null }) => ({
    query: async (sql) => ({ rows: [sql.includes("observation_review") ? { corrected, reviewed }
      : sql.includes("to_regclass") ? { available: true } : versions] }),
  });
  const row = { id: "o", plant_id: 1, origin_type: "initial_registration", revision: 1, status: "Pending Review" };
  assert.equal(await canModifyPendingObservation(db(false, false), row), true);
  assert.equal(await canModifyPendingObservation(db(true, true), { ...row, revision: 3 }), false);
  assert.equal(await canModifyPendingObservation(db(false, true), row), false);
  assert.equal(await canModifyPendingObservation(db(false, false), { ...row, origin_type: "unknown", revision: 2 }), false);
  assert.equal(await canModifyPendingObservation(db(false, false, { count: 2, first_version: 1, last_version: 2, invalid: false }),
    { ...row, origin_type: "unknown", revision: 2 }), true);
  assert.equal(await canModifyPendingObservation(db(false, false), { ...row, status: "Correction Required" }), true);
  assert.equal(await canModifyPendingObservation(db(false, false), { ...row, status: "Approved" }), false);
});
