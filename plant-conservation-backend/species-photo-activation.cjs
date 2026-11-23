"use strict";
// Photo writes are requested by normal server startup; current schema readiness
// and request authorization remain the actual gates.
const { inspectPhotoSchema } = require("./species-photo-readiness.cjs");
function speciesPhotoWritesRequested() { return true; }
async function requireSpeciesPhotoWrites(pool, enabled) {
  if (enabled !== true)
    throw Object.assign(Error("Photo management writes are disabled."), { status: 503 });
  if ((await inspectPhotoSchema(pool)).schemaReady !== true)
    throw Object.assign(Error("Photo management schema or runtime permissions are not ready."), { status: 503 });
}
module.exports = { speciesPhotoWritesRequested, requireSpeciesPhotoWrites };
