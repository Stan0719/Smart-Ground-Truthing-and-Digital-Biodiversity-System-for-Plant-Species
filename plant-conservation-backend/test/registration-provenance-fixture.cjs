"use strict";
const { createHash } = require("node:crypto");

// Synthetic persisted atomic-registration evidence, for disposable test pools only.
// Raw imported Observations without this evidence must remain unverified.
async function seedRegistrationReceipt(pool, observationId) {
  const row = (await pool.query(`SELECT o.id,o.plant_id,o.owner_subject,o.client_key,
    p.species_id,p.qr_token,p.registered_subject FROM plant_observation o
    JOIN plant_record p ON p.plant_id=o.plant_id WHERE o.id=$1`, [observationId])).rows[0];
  if (!row || row.owner_subject !== row.registered_subject || !row.qr_token)
    throw Error("Invalid synthetic registration fixture.");
  await pool.query(`CREATE TABLE IF NOT EXISTS plant_submission_receipt(
    owner_subject TEXT NOT NULL,client_key TEXT NOT NULL,payload_hash TEXT NOT NULL,
    result JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(owner_subject,client_key))`);
  const result = { id: row.id, plant_id: row.plant_id, species_id: row.species_id,
    status: "Pending Review", qr_token: row.qr_token, species_request_id: null };
  await pool.query(`INSERT INTO plant_submission_receipt(owner_subject,client_key,payload_hash,result)
    VALUES($1,$2,$3,$4)`, [row.owner_subject,row.client_key,
    createHash("sha256").update(JSON.stringify(result)).digest("hex"),result]);
  await pool.query("UPDATE plant_observation SET origin_type='initial_registration' WHERE id=$1", [row.id]);
}
module.exports = { seedRegistrationReceipt };
