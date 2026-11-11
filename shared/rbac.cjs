"use strict";
const roles = ["Visitor", "Botanist", "Conservation Officer", "Administrator"];
const grants = Object.freeze({
  "accounts.manage": ["Administrator"],
  "permissions.manage": ["Administrator"],
  "audit.read": ["Administrator"],
  "security.manage": ["Administrator"],
  "system.read": ["Administrator"],
  "plants.public.read": [
    "Guest",
    "Visitor",
    "Botanist",
    "Conservation Officer",
  ],
  "plants.scientific.read": ["Botanist", "Conservation Officer"],
  "plants.protected.read": ["Conservation Officer"],
  "plants.gps.exact.read": ["Conservation Officer"],
  // Botanists receive only the approved location projection on authorized
  // plant reads; this does not grant access to arbitrary observation GPS.
  "plants.gps.approved.read": ["Botanist"],
  "plants.create": ["Botanist"],
  "observations.create": ["Botanist"],
  "observations.edit.own": ["Botanist"],
  "observations.review": ["Conservation Officer"],
  "species.manage": ["Conservation Officer"],
  "reports.read": ["Conservation Officer"],
  "devices.manage": ["Administrator"],
  "thresholds.manage": ["Administrator"],
  "devices.read": ["Administrator", "Conservation Officer"],
  "readings.read": ["Administrator", "Conservation Officer"],
  "alerts.read": ["Administrator", "Conservation Officer"],
  "responses.manage": ["Conservation Officer"],
});
function permitted(user, permission) {
  if (!Object.hasOwn(grants, permission)) return false;
  if (!user) return grants[permission].includes("Guest");
  return (
    user.status === "Active" &&
    user.mustChangePassword === false &&
    grants[permission].includes(user.role)
  );
}
const exactGpsFields = new Set([
  "latitude",
  "longitude",
  "gps_latitude",
  "gps_longitude",
  "accuracy_m",
  "gpsLatitude",
  "gpsLongitude",
  "accuracyM",
  "altitude_m",
  "altitudeM",
  "altitude",
  "zone",
]);
const approvedPlantLocationFields = ["latitude", "longitude", "accuracy_m", "altitude_m", "zone"];
const nestedLocationFields = new Set([
  ...exactGpsFields,
  "altitude_m",
  "altitudeM",
  "altitude",
  "zone",
]);
function projectGps(value, user) {
  if (permitted(user, "plants.gps.exact.read")) return value;
  if (Array.isArray(value)) return value.map((item) => projectGps(item, user));
  if (!value || typeof value !== "object") return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const projected = {};
  for (const [key, item] of Object.entries(value))
    if (!exactGpsFields.has(key)) projected[key] = projectGps(item, user);
  return projected;
}
function projectApprovedPlantGps(value, user) {
  if (!permitted(user, "plants.gps.approved.read"))
    return projectGps(value, user);
  if (Array.isArray(value))
    return value.map((item) => projectApprovedPlantGps(item, user));
  if (!value || typeof value !== "object")
    return value;
  const redactNested = (item) => {
    if (Array.isArray(item)) return item.map(redactNested);
    if (!item || typeof item !== "object") return item;
    const prototype = Object.getPrototypeOf(item);
    if (prototype !== Object.prototype && prototype !== null) return item;
    const result = {};
    for (const [key, child] of Object.entries(item))
      if (!nestedLocationFields.has(key)) result[key] = redactNested(child);
    return result;
  };
  const result = redactNested(value);
  // These top-level fields are populated exclusively by the approved-location
  // lateral query in /api/plants and /api/plants/:id.
  for (const field of approvedPlantLocationFields)
    result[field] = value[field] ?? null;
  return result;
}
function visibilityFor(user) {
  if (permitted(user, "plants.protected.read"))
    return ["public", "internal", "protected"];
  if (permitted(user, "plants.scientific.read")) return ["public", "internal"];
  return permitted(user, "plants.public.read") ? ["public"] : [];
}
function projectSpecies(row, scientific = false) {
  const data = row.rbac_data || {};
  const result = {
    species_id: String(row.species_id),
    scientific_name: row.scientific_name,
    common_name: row.common_name,
    genus_name: row.genus_name,
    family_name: row.family_name,
    description: row.description,
    habitat: data.habitat || "",
    culturalSignificance: data.culturalSignificance || "",
  };
  if (row.image_asset_id) Object.assign(result, {
    image_asset_id: String(row.image_asset_id),
    image_url: `/api/assets/${encodeURIComponent(row.image_asset_id)}`,
  });
  if (scientific)
    Object.assign(result, {
      conservation_status: row.conservation_status,
      sensitivity: row.visibility,
      genus_id: row.genus_id,
      status_id: row.status_id,
    });
  return result;
}
function assertEdit(user, observation) {
  if (
    !permitted(user, "observations.edit.own") ||
    observation.owner_subject !== `staff:${user.id}`
  )
    return 403;
  return ["Draft", "Correction Required", "Rejected"].includes(
    observation.status,
  )
    ? 0
    : 409;
}
function assertReview(user, observation, next, comment) {
  if (
    !permitted(user, "observations.review") ||
    observation.owner_subject === `staff:${user.id}`
  )
    return 403;
  const transitions = {
    "Pending Review": [
      "Approved",
      "Rejected",
      "Flagged",
      "Correction Required",
    ],
    Flagged: ["Approved", "Rejected", "Correction Required"],
  };
  if (!(transitions[observation.status] || []).includes(next)) return 409;
  if (next !== "Approved" && (typeof comment !== "string" || !comment.trim()))
    return 400;
  return 0;
}
module.exports = {
  roles,
  grants,
  permitted,
  projectGps,
  projectApprovedPlantGps,
  visibilityFor,
  projectSpecies,
  assertEdit,
  assertReview,
};
