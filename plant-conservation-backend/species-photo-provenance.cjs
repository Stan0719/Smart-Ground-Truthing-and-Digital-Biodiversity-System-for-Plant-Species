"use strict";
const { randomUUID } = require("node:crypto");
const {
  available,
  appendAsset,
  snapshotForChange,
} = require("./species-gallery.cjs");
const conflict = () => {
  throw Object.assign(
    Error(
      "Species photo provenance is unavailable or ambiguous. Resolve the association before review.",
    ),
    { status: 409 },
  );
};
// A recorded pointer is authoritative. Legacy recovery requires both an exact
// application-generated key and matching request bytes; owner alone is insufficient.
async function requestAsset(c, request, speciesId) {
  if (request.photo_asset_id) {
    const row = (
      await c.query(
        "SELECT * FROM plant_asset WHERE id=$1 AND species_id=$2 AND owner_subject=$3 AND content=$4 AND observation_id IS NULL FOR UPDATE",
        [
          request.photo_asset_id,
          speciesId,
          request.owner_subject,
          request.photo,
        ],
      )
    ).rows[0];
    if (!row) conflict();
    return row;
  }
  const changes = (
    await c.query(
      "SELECT to_regclass(current_schema() || '.record_change_submission') IS NOT NULL AS available",
    )
  ).rows[0].available;
  const rows = (
    await c.query(
      `SELECT a.* FROM plant_asset a WHERE species_id=$1 AND owner_subject=$2 AND content=$3 AND observation_id IS NULL
    AND (client_key=$4 OR client_key=$5 OR client_key LIKE $6 ${
      changes
        ? `OR EXISTS (
      SELECT 1 FROM record_change_submission rc WHERE rc.species_id=$1 AND rc.owner_subject=$2 AND rc.status='Approved'
        AND a.client_key='approved-edit:' || rc.id || ':species-photo')`
        : ""
    }) FOR UPDATE`,
      [
        speciesId,
        request.owner_subject,
        request.photo,
        `${request.client_key}:species-photo`,
        `species-request:${request.request_id}`,
        `species-request:${request.request_id}:photo:%`,
      ],
    )
  ).rows;
  if (rows.length !== 1) conflict();
  return rows[0];
}
async function setPointer(c, requestId, assetId) {
  if (await available(c))
    await c.query(
      "UPDATE species_request_submission SET photo_asset_id=$2 WHERE request_id=$1",
      [requestId, assetId],
    );
}
async function replaceRequestPhoto(
  c,
  request,
  speciesId,
  bytes,
  approved,
  who,
) {
  const old = await requestAsset(c, request, speciesId);
  const before = await snapshotForChange(c, speciesId);
  const asset = randomUUID();
  // Preserve old bytes permanently; only the identified request image is superseded.
  await c.query("UPDATE plant_asset SET approved=FALSE WHERE id=$1", [old.id]);
  await c.query(
    "INSERT INTO plant_asset(id,species_id,owner_subject,client_key,approved,content_type,content) VALUES($1,$2,$3,$4,$5,'image/jpeg',$6)",
    [
      asset,
      speciesId,
      request.owner_subject,
      `species-request:${request.request_id}:photo:${asset}`,
      approved,
      bytes,
    ],
  );
  await setPointer(c, request.request_id, asset);
  if (approved)
    await appendAsset(
      c,
      speciesId,
      asset,
      who,
      "request-photo",
      old.id,
      before,
    );
  return asset;
}
async function approveRequestPhoto(c, request, speciesId, who) {
  const asset = await requestAsset(c, request, speciesId);
  const before = await snapshotForChange(c, speciesId);
  await c.query("UPDATE plant_asset SET approved=TRUE WHERE id=$1", [asset.id]);
  await setPointer(c, request.request_id, asset.id);
  await appendAsset(c, speciesId, asset.id, who, "request-photo", null, before);
}
module.exports = {
  requestAsset,
  setPointer,
  replaceRequestPhoto,
  approveRequestPhoto,
};
