"use strict";
const sharp = require("sharp");
const { fail } = require("./domain.cjs");
const { visibilityFor } = require("../shared/rbac.cjs");

const MODEL = "hf-hub:imageomics/bioclip-2";
const OBSERVATION_ID = /^(?:[1-9][0-9]{0,18}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;
const plantLabel = (id) => `PL${String(id).padStart(3, "0")}`;

function coordinates(content, row) {
  for (const pair of [[content?.latitude, content?.longitude], [row.latitude, row.longitude]]) {
    if (pair.every((value) => typeof value === "number" && Number.isFinite(value)) &&
        Math.abs(pair[0]) <= 90 && Math.abs(pair[1]) <= 180) return pair;
  }
  return null;
}

function distanceMeters(a, b) {
  if (!a || !b) return undefined;
  const radians = (value) => value * Math.PI / 180;
  const lat = radians(b[0] - a[0]), lon = radians(b[1] - a[1]);
  const haversine = Math.sin(lat / 2) ** 2 + Math.cos(radians(a[0])) *
    Math.cos(radians(b[0])) * Math.sin(lon / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, haversine))));
}

async function photo(bytes) {
  try {
    return (await sharp(bytes, { limitInputPixels: 24000000, failOn: "warning" })
      .rotate().resize({ width: 384, height: 384, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 75 }).toBuffer()).toString("base64");
  } catch {
    fail(422, "A stored plant photo could not be processed. Check its image file.");
  }
}

async function searchBioCLIP(payload) {
  const response = await fetch("http://127.0.0.1:8002/search", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(180000), redirect: "error",
  });
  if (!response.ok) throw Error("BioCLIP unavailable");
  return response.json();
}

function mountPlantSimilarity(app, { pool, allow, search = searchBioCLIP }) {
  app.get("/api/observations/:id/similarity", allow("observations.review"), async (req, res) => {
    if (!OBSERVATION_ID.test(req.params.id)) fail(400, "Invalid observation identifier.");
    const visibility = visibilityFor(req.user);
    const query = (await pool.query(`
      SELECT o.id,o.plant_id,o.content,photo.id AS asset_id,photo.content AS image,
             location.latitude,location.longitude
      FROM plant_observation o
      JOIN plant_record p ON p.plant_id=o.plant_id
      LEFT JOIN rbac_species_visibility v ON v.species_id=p.species_id
      LEFT JOIN LATERAL (
        SELECT a.id,a.content FROM plant_asset a
        WHERE a.observation_id=o.id AND a.plant_id=o.plant_id
          AND a.content_type IN ('image/jpeg','image/png')
        ORDER BY CASE WHEN a.client_key ~ ':photo:0$' THEN 0 ELSE 1 END,a.created_at,a.id
        LIMIT 1
      ) photo ON true
      LEFT JOIN LATERAL (
        SELECT l.latitude,l.longitude FROM plant_location l
        WHERE l.plant_id=p.plant_id ORDER BY l.location_id DESC LIMIT 1
      ) location ON true
      WHERE o.id=$1 AND COALESCE(v.visibility,'protected')=ANY($2::text[])
    `, [req.params.id, visibility])).rows[0];
    if (!query) fail(404, "Observation unavailable.");
    if (!query.image) fail(422, "This observation has no stored plant photo to compare.");

    // One whole-plant photo per distinct approved plant; never compare a plant
    // with its own observations, or use pending/unapproved reference photos.
    const references = (await pool.query(`
      SELECT DISTINCT ON (p.plant_id)
        a.id AS asset_id,a.content AS image,p.plant_id,o.id AS observation_id,o.content,
        s.scientific_name,s.common_name,location.latitude,location.longitude
      FROM plant_asset a
      JOIN plant_observation o ON o.id=a.observation_id AND o.plant_id=a.plant_id
      JOIN plant_record p ON p.plant_id=a.plant_id
      JOIN species s ON s.species_id=p.species_id
      LEFT JOIN rbac_species_visibility v ON v.species_id=p.species_id
      LEFT JOIN LATERAL (
        SELECT l.latitude,l.longitude FROM plant_location l
        WHERE l.plant_id=p.plant_id ORDER BY l.location_id DESC LIMIT 1
      ) location ON true
      WHERE p.plant_id<>$1 AND p.rbac_status='Approved' AND o.status='Approved'
        AND a.approved=TRUE AND a.content_type IN ('image/jpeg','image/png')
        AND COALESCE(s.rbac_data->>'approvalStatus','Approved')='Approved'
        AND COALESCE(v.visibility,'protected')=ANY($2::text[])
      ORDER BY p.plant_id,o.updated_at DESC,
        CASE WHEN a.client_key ~ ':photo:0$' THEN 0 ELSE 1 END,a.created_at,a.id
      LIMIT 50
    `, [query.plant_id, visibility])).rows;
    if (!references.length)
      fail(422, "No other approved plant photos are available. Add a reference plant before comparing.");

    const payload = { query: await photo(query.image), references: await Promise.all(
      references.map(async (row) => ({ id: row.asset_id, image: await photo(row.image) })),
    ) };
    let result;
    try {
      result = await search(payload);
    } catch {
      return res.status(503).json({ error: "BioCLIP 2 is unavailable or busy. Start its API on port 8002 and retry." });
    }
    const byAsset = new Map(references.map((row) => [row.asset_id, row]));
    const matches = result?.matches;
    if (result?.model !== MODEL || !Array.isArray(matches) || matches.length !== references.length)
      return res.status(502).json({ error: "BioCLIP returned an invalid comparison. Retry the analysis." });
    const seen = new Set();
    for (const match of matches) {
      if (!match || !byAsset.has(match.id) || seen.has(match.id) ||
          typeof match.similarity !== "number" || !Number.isFinite(match.similarity) ||
          match.similarity < -1 || match.similarity > 1)
        return res.status(502).json({ error: "BioCLIP returned an invalid match. Retry the analysis." });
      seen.add(match.id);
    }
    const origin = coordinates(query.content, query);
    const candidates = [...matches].sort((a, b) => b.similarity - a.similarity).slice(0, 5)
      .map((match, index) => {
        const row = byAsset.get(match.id);
        return { rank: index + 1, plantId: plantLabel(row.plant_id), assetId: row.asset_id,
          observationId: row.observation_id, scientificName: row.scientific_name,
          commonName: row.common_name, similarity: match.similarity,
          distanceMeters: distanceMeters(origin, coordinates(row.content, row)) };
      });
    res.json({ observationId: query.id, plantId: plantLabel(query.plant_id), status: "available",
      highestSimilarity: candidates[0].similarity, candidates, sourceAssetId: query.asset_id });
  });
}

module.exports = { mountPlantSimilarity, searchBioCLIP, distanceMeters };
