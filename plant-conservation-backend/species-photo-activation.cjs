"use strict";
// Startup snapshot only. Never loads configuration files or creates a pool.
const { inspectPhotoSchema } = require("./species-photo-readiness.cjs");
function speciesPhotoWritesRequested(env = process.env) {
  return env.PLANT_SPECIES_PHOTO_WRITES_ENABLED === "true";
}
async function requireSpeciesPhotoWrites(pool, enabled) {
  if (enabled !== true)
    throw Object.assign(Error("Photo management writes are disabled."), { status: 503 });
  if ((await inspectPhotoSchema(pool)).schemaReady !== true)
    throw Object.assign(Error("Photo management schema or runtime permissions are not ready."), { status: 503 });
}
module.exports = { speciesPhotoWritesRequested, requireSpeciesPhotoWrites };
