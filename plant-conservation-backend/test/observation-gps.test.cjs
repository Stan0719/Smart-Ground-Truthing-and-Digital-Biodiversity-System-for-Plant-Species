"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { projectObservationGps } = require("../observation-gps.cjs");

const redact = (row, user) => user.role === "Conservation Officer" ? row :
  { ...row, content: Object.fromEntries(Object.entries(row.content).filter(([key]) =>
    !["latitude", "longitude", "altitudeM", "accuracy_m"].includes(key))) };
const view = (row, role = "Botanist", subject = "staff:author") =>
  projectObservationGps(row, { role }, subject, redact);
const base = { id: "first", owner_subject: "staff:author", status: "Approved",
  gps_visibility_allowed: true,
  content: { latitude: 0, longitude: 110.3, altitudeM: 0, accuracy_m: null, notes: "Own reading" } };

test("approved visible Observations expose their own exact GPS to any Botanist", () => {
  for (const subject of ["staff:author", "staff:other"]) {
    const result = view(base, "Botanist", subject);
    assert.deepEqual(result.content, base.content);
    assert.equal(Object.hasOwn(result, "gps_visibility_allowed"), false);
  }
  const second = { ...base, id: "second", content: { latitude: 1.5, longitude: 111, notes: "Second" } };
  assert.deepEqual(view(second, "Botanist", "staff:other").content, second.content);
  assert.equal(Object.hasOwn(view(second).content, "accuracy_m"), false);
});

test("unapproved GPS requires author identity and visible species", () => {
  for (const status of ["Pending Review", "Correction Required", "Rejected"]) {
    assert.equal(view({ ...base, status }).content.latitude, 0);
    assert.equal(view({ ...base, status }, "Botanist", "staff:other").content.latitude, undefined);
  }
  for (const status of ["Approved", "Pending Review"])
    assert.equal(view({ ...base, status, gps_visibility_allowed: false }).content.latitude, undefined);
});

test("Officer access remains; Guest and Visitor gain no GPS", () => {
  assert.equal(view(base, "Conservation Officer").content.latitude, 0);
  for (const role of ["Guest", "Visitor"])
    assert.equal(view(base, role).content.latitude, undefined);
});
