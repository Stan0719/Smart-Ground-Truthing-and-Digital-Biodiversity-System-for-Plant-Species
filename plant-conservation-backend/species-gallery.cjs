"use strict";
// Internal foundation only. No HTTP routes are registered by this module.
const { permitted } = require("../shared/rbac.cjs");
const error = (status, message) => {
  throw Object.assign(Error(message), { status });
};
const actor = (user) => `staff:${user.id}`;
const authorize = (user) => {
  if (!permitted(user, "species.manage"))
    error(403, "Species management access required.");
};
async function available(c) {
  return Boolean(
    (
      await c.query(
        "SELECT to_regclass(current_schema() || '.species_image_collection') IS NOT NULL AS available",
      )
    ).rows[0].available,
  );
}
// SQL aliases are fixed by backend callers, never derived from HTTP input.
function membershipSql(alias = "a") {
  return `(NOT EXISTS (SELECT 1 FROM species_image_collection sic WHERE sic.species_id=${alias}.species_id)
    OR EXISTS (SELECT 1 FROM species_image_reference sir WHERE sir.species_id=${alias}.species_id
      AND sir.asset_id=${alias}.id AND sir.removed_at IS NULL))`;
}
const eligible = (row) =>
  row.approved &&
  ["image/jpeg", "image/png"].includes(row.content_type) &&
  !row.observation_id;
function speciesId(value) {
  if (!/^[1-9][0-9]*$/.test(String(value)) || Number(value) > 2147483647)
    error(400, "Invalid species identifier.");
  return Number(value);
}
async function parent(c, id, lock = false) {
  const row = (
    await c.query(
      `SELECT * FROM species WHERE species_id=$1${lock ? " FOR UPDATE" : ""}`,
      [id],
    )
  ).rows[0];
  if (!row) error(404, "Species unavailable.");
  return row;
}
async function canonical(c, id) {
  const collection = (
    await c.query(
      "SELECT revision FROM species_image_collection WHERE species_id=$1",
      [id],
    )
  ).rows[0];
  const rows = collection
    ? (
        await c.query(
          `SELECT a.id,a.approved,a.content_type,a.observation_id,r.position,r.is_primary FROM species_image_reference r
    JOIN plant_asset a ON a.id=r.asset_id AND a.species_id=r.species_id
    WHERE r.species_id=$1 AND r.removed_at IS NULL ORDER BY r.position,a.id`,
          [id],
        )
      ).rows
    : (
        await c.query(
          "SELECT id,approved,content_type,observation_id FROM plant_asset WHERE species_id=$1 AND approved AND observation_id IS NULL AND content_type IN ('image/jpeg','image/png') ORDER BY created_at DESC,id ASC",
          [id],
        )
      ).rows;
  return {
    speciesId: id,
    managed: Boolean(collection),
    revision: Number(collection?.revision ?? 0),
    primaryAssetId: rows.find((r) => r.is_primary)?.id ?? null,
    images: rows.map((r, i) => ({
      assetId: r.id,
      url: `/api/assets/${encodeURIComponent(r.id)}`,
      contentType: r.content_type,
      position: r.position ?? i,
      eligible: eligible(r),
    })),
  };
}
async function initialize(c, id, who) {
  await c.query(
    "INSERT INTO species_image_collection(species_id,updated_by) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [id, who],
  );
  // Only called once, under the parent lock. Callers check collection existence.
  await c.query(
    `INSERT INTO species_image_reference(species_id,asset_id,position,added_by)
    SELECT species_id,id,(row_number() OVER(ORDER BY created_at DESC,id ASC)-1)::integer,$2 FROM plant_asset
    WHERE species_id=$1 AND approved AND observation_id IS NULL AND content_type IN ('image/jpeg','image/png')`,
    [id, who],
  );
}
async function record(c, id, before, who, operation) {
  await c.query(
    "UPDATE species_image_collection SET revision=revision+1,updated_at=CURRENT_TIMESTAMP,updated_by=$2 WHERE species_id=$1",
    [id, who],
  );
  const after = await canonical(c, id);
  await c.query(
    `INSERT INTO species_image_arrangement_history(species_id,previous_revision,new_revision,previous_arrangement,new_arrangement,operation,actor)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [id, before.revision, after.revision, before, after, operation, who],
  );
  return after;
}
async function readGallery(pool, id, user) {
  authorize(user);
  id = speciesId(id);
  const c = await pool.connect();
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await parent(c, id);
    if (!(await available(c)))
      error(503, "Species gallery migration is required.");
    const result = await canonical(c, id);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
function validateSave(body) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).sort().join(",") !==
      "expectedRevision,orderedAssetIds,primaryAssetId,removedAssetIds" ||
    !Number.isSafeInteger(body.expectedRevision) ||
    body.expectedRevision < 0
  )
    error(400, "Invalid gallery arrangement.");
  for (const key of ["orderedAssetIds", "removedAssetIds"]) {
    const ids = body[key];
    if (
      !Array.isArray(ids) ||
      ids.length > 1000 ||
      ids.some(
        (id) => typeof id !== "string" || !id.length || id.length > 200,
      ) ||
      new Set(ids).size !== ids.length
    )
      error(400, "Invalid gallery asset IDs.");
  }
  if (
    body.primaryAssetId !== null &&
    (typeof body.primaryAssetId !== "string" ||
      !body.orderedAssetIds.includes(body.primaryAssetId))
  )
    error(400, "Invalid primary image.");
  if (body.removedAssetIds.some((id) => body.orderedAssetIds.includes(id)))
    error(400, "An image cannot be retained and removed.");
}
async function saveGallery(pool, id, user, body) {
  authorize(user);
  id = speciesId(id);
  validateSave(body);
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const s = await parent(c, id, true);
    if ((s.rbac_data?.approvalStatus ?? "Approved") !== "Approved")
      error(409, "Pending species must use the review workflow.");
    if (!(await available(c)))
      error(503, "Species gallery migration is required.");
    const before = await canonical(c, id);
    if (before.revision !== body.expectedRevision)
      error(409, "Gallery changed. Reload before saving.");
    const ids = [...body.orderedAssetIds, ...body.removedAssetIds];
    if (
      ids.length !== before.images.length ||
      ids.some((id) => !before.images.some((r) => r.assetId === id))
    )
      error(
        409,
        "Gallery membership changed or does not belong to this species.",
      );
    if (
      body.primaryAssetId &&
      !before.images.find((r) => r.assetId === body.primaryAssetId)?.eligible
    )
      error(409, "Primary image is not eligible.");
    if (body.orderedAssetIds.some(id => !before.images.find(image => image.assetId === id)?.eligible))
      error(409, "Unavailable references must be explicitly removed before saving.");
    if (
      !(
        await c.query(
          "SELECT 1 FROM species_image_collection WHERE species_id=$1",
          [id],
        )
      ).rows.length
    )
      await initialize(c, id, actor(user));
    await c.query(
      "UPDATE species_image_reference SET is_primary=FALSE WHERE species_id=$1",
      [id],
    );
    for (const asset of body.removedAssetIds)
      await c.query(
        `UPDATE species_image_reference SET position=NULL,removed_at=CURRENT_TIMESTAMP,removed_by=$3 WHERE species_id=$1 AND asset_id=$2`,
        [id, asset, actor(user)],
      );
    for (const [position, asset] of body.orderedAssetIds.entries())
      await c.query(
        "UPDATE species_image_reference SET position=$3,is_primary=$4 WHERE species_id=$1 AND asset_id=$2",
        [id, asset, position, asset === body.primaryAssetId],
      );
    const after = await record(c, id, before, actor(user), "save");
    await c.query("COMMIT");
    return after;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
// Existing upload/review callers already hold a species row lock and a transaction.
// Untouched species stay legacy; removed references are never resurrected.
async function snapshotForChange(c, id) {
  if (
    !(await available(c)) ||
    !(
      await c.query(
        "SELECT 1 FROM species_image_collection WHERE species_id=$1",
        [id],
      )
    ).rows.length
  )
    return null;
  return canonical(c, id);
}
async function appendAsset(
  c,
  id,
  asset,
  who,
  operation = "upload",
  replaced = null,
  previous = null,
) {
  if (
    !(await available(c)) ||
    !(
      await c.query(
        "SELECT 1 FROM species_image_collection WHERE species_id=$1",
        [id],
      )
    ).rows.length
  )
    return;
  const before = previous ?? (await canonical(c, id));
  if (replaced)
    await c.query(
      `UPDATE species_image_reference SET position=NULL,is_primary=FALSE,removed_at=COALESCE(removed_at,CURRENT_TIMESTAMP),removed_by=COALESCE(removed_by,$3) WHERE species_id=$1 AND asset_id=$2`,
      [id, replaced, who],
    );
  const row = (
    await c.query("SELECT * FROM plant_asset WHERE species_id=$1 AND id=$2", [
      id,
      asset,
    ])
  ).rows[0];
  if (!row || !eligible(row))
    error(409, "Image is not an eligible species reference.");
  await c.query(
    `INSERT INTO species_image_reference(species_id,asset_id,position,added_by)
    SELECT $1,$2,COALESCE(MAX(position)+1,0),$3 FROM species_image_reference WHERE species_id=$1 ON CONFLICT(species_id,asset_id) DO NOTHING`,
    [id, asset, who],
  );
  await record(c, id, before, who, operation);
}
module.exports = {
  available,
  membershipSql,
  readGallery,
  saveGallery,
  validateSave,
  appendAsset,
  snapshotForChange,
};
