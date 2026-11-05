"use strict";

// No dependency on domain/review code: classification never changes eligibility.
const origins = new Set(["initial_registration", "subsequent_observation", "unknown"]);
const positiveId = value => /^[1-9][0-9]*$/.test(String(value));
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
async function originColumnAvailable(c) {
  return Boolean((await c.query(`SELECT EXISTS (
    SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('plant_observation')
    AND attname='origin_type' AND NOT attisdropped) AS available`)).rows[0]?.available);
}

function validReceipt(receipt, plant, observations, species, requests) {
  const result = receipt.result;
  // The existing receipt has no version column. Accept its unversioned atomic
  // response shape only; hashes are immutable replay evidence, not recomputed here.
  if (!object(result) || Object.hasOwn(result, "version") ||
      typeof result.id !== "string" || !positiveId(result.plant_id) || !positiveId(result.species_id) ||
      result.status !== "Pending Review" || typeof result.qr_token !== "string" || !result.qr_token.trim() ||
      !/^[a-f0-9]{64}$/.test(receipt.payload_hash) || !Object.hasOwn(result, "species_request_id") ||
      (result.species_request_id !== null && !positiveId(result.species_request_id))) return false;
  const initial = observations.get(result.id);
  if (!plant || String(result.plant_id) !== String(plant.plant_id) ||
      !initial || String(initial.plant_id) !== String(plant.plant_id) ||
      receipt.owner_subject !== plant.registered_subject || initial.owner_subject !== receipt.owner_subject ||
      initial.client_key !== receipt.client_key || !species.has(String(result.species_id))) return false;
  // Existing-species registration can legitimately change its current selection.
  // A genuine proposal must still bind to its original request and proposed species.
  if (result.species_request_id !== null) {
    const request = requests.get(String(result.species_request_id));
    if (!request || request.owner_subject !== receipt.owner_subject || request.client_key !== receipt.client_key ||
        String(plant.species_id) !== String(result.species_id) ||
        (request.proposed_species_id == null && request.approved_species_id == null) ||
        (request.proposed_species_id != null && String(request.proposed_species_id) !== String(result.species_id)) ||
        (request.approved_species_id != null && String(request.approved_species_id) !== String(result.species_id))) return false;
  }
  return true;
}

async function classifyObservations(pool, rows) {
  if (!rows.length) return rows;
  const plantIds = [...new Set(rows.map(row => String(row.plant_id)))];
  const ids = rows.map(row => row.id);
  const hasReceipts = Boolean((await pool.query("SELECT to_regclass('plant_submission_receipt') IS NOT NULL AS available")).rows[0]?.available);
  const receipts = hasReceipts ? (await pool.query(`SELECT owner_subject,client_key,payload_hash,result
    FROM plant_submission_receipt WHERE result->>'plant_id'=ANY($1::text[]) OR result->>'id'=ANY($2::text[])`, [plantIds, ids])).rows : [];
  const plants = new Map((await pool.query("SELECT plant_id,registered_subject,species_id FROM plant_record WHERE plant_id::text=ANY($1::text[])", [plantIds])).rows.map(row => [String(row.plant_id), row]));
  const initialIds = [...new Set(receipts.flatMap(receipt => typeof receipt.result?.id === "string" ? [receipt.result.id] : []))];
  const observations = new Map(initialIds.length ? (await pool.query("SELECT id,plant_id,owner_subject,client_key FROM plant_observation WHERE id=ANY($1::text[])", [initialIds])).rows.map(row => [row.id, row]) : []);
  const speciesIds = [...new Set(receipts.flatMap(receipt => positiveId(receipt.result?.species_id) ? [String(receipt.result.species_id)] : []))];
  const species = new Set(speciesIds.length ? (await pool.query("SELECT species_id FROM species WHERE species_id::text=ANY($1::text[])", [speciesIds])).rows.map(row => String(row.species_id)) : []);
  const requestIds = [...new Set(receipts.flatMap(receipt => positiveId(receipt.result?.species_request_id) ? [String(receipt.result.species_request_id)] : []))];
  let requests = new Map();
  if (requestIds.length && (await pool.query("SELECT to_regclass('species_request_submission') IS NOT NULL AS available")).rows[0]?.available) {
    requests = new Map((await pool.query(`SELECT request_id,owner_subject,client_key,proposed_species_id,approved_species_id
      FROM species_request_submission WHERE request_id::text=ANY($1::text[])`, [requestIds])).rows.map(row => [String(row.request_id), row]));
  }
  return rows.map(row => {
    const stored = Object.hasOwn(row, "origin_type") ? row.origin_type : "unknown";
    const candidates = receipts.filter(receipt => String(receipt.result?.plant_id) === String(row.plant_id) || receipt.result?.id === row.id);
    let origin = "unknown";
    if (origins.has(stored) && candidates.length === 0) {
      if (stored === "subsequent_observation") origin = stored;
    } else if (origins.has(stored) && candidates.length === 1 &&
        validReceipt(candidates[0], plants.get(String(row.plant_id)), observations, species, requests)) {
      const exactInitial = candidates[0].result.id === row.id;
      if (exactInitial && stored !== "subsequent_observation") origin = "initial_registration";
      if (!exactInitial && stored === "subsequent_observation") origin = stored;
    }
    // Replace any raw column value; never return receipt internals to the client.
    return { ...row, origin_type: origin };
  });
}

module.exports = { originColumnAvailable, classifyObservations };
