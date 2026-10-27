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
  visibilityFor,
  projectSpecies,
  assertEdit,
  assertReview,
};
