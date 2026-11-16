"use strict";
const { randomUUID } = require("node:crypto");
function conflict(message, code = "SPECIES_REQUEST_LINK_CONFLICT") {
  throw Object.assign(Error(message), { status: 409, code });
}
async function rejectLinkedRegistration(c, request, user, comment, decisionId, audit) {
  const hasReceipts = (await c.query("SELECT to_regclass('plant_submission_receipt') IS NOT NULL AS available")).rows[0].available;
  const receipts = hasReceipts ? (await c.query(`SELECT owner_subject,client_key,result FROM plant_submission_receipt
    WHERE result->>'species_request_id'=$1
    ORDER BY (client_key=$2) DESC,created_at,client_key`, [String(request.request_id), request.client_key])).rows : [];
  if (!receipts.length && !request.proposed_species_id) return null;
  if (!receipts.length) conflict("The linked registration cannot be verified. Manual reconciliation is required.");
  // Each receipt is an independently submitted plant. Validate every link and
  // reject them in the caller's transaction; any inconsistency rolls back all.
  let linkedDecisionUsed = false;
  for (const receipt of receipts) {
  const link = receipt.result;
  if (receipt.owner_subject !== request.owner_subject ||
      request.client_key !== (link.species_request_client_key ?? receipt.client_key) ||
      typeof link.id !== "string" || !link.id || !/^[1-9][0-9]*$/.test(String(link.plant_id)) ||
      String(link.species_id) !== String(request.proposed_species_id)) conflict("The registration receipt is inconsistent.");
  let observation, plant;
  // The species request is already locked by its review handler. Never wait for
  // parent locks: existing observation reviews/plant edits can lock parents first.
  // NOWAIT rolls this transaction back instead of introducing a lock-order cycle.
  try {
    observation = (await c.query("SELECT * FROM plant_observation WHERE id=$1 FOR UPDATE NOWAIT", [link.id])).rows[0];
    plant = (await c.query("SELECT * FROM plant_record WHERE plant_id::text=$1 FOR UPDATE NOWAIT", [String(link.plant_id)])).rows[0];
  } catch (error) {
    if (error.code === '55P03') conflict("The registration is being changed. Reload and inspect it before retrying.", "SPECIES_REQUEST_REVIEW_BUSY");
    throw error;
  }
  const competing = (await c.query(`SELECT count(*)::integer AS n FROM plant_submission_receipt
    WHERE result->>'id'=$1 OR result->>'plant_id'=$2`, [link.id, String(link.plant_id)])).rows[0].n;
  if (!observation || !plant || competing !== 1 || String(observation.plant_id) !== String(plant.plant_id) ||
      observation.owner_subject !== request.owner_subject || plant.registered_subject !== request.owner_subject ||
      observation.client_key !== receipt.client_key || String(plant.species_id) !== String(request.proposed_species_id) ||
      observation.origin_type === 'subsequent_observation' || !['Pending Review','Flagged','Rejected'].includes(observation.status) ||
      !['Pending Review','Rejected'].includes(plant.rbac_status)) conflict("The parent registration state is inconsistent. Manual reconciliation is required.");
  if ((observation.status === 'Rejected') !== (plant.rbac_status === 'Rejected')) conflict("The parent rejection state requires reconciliation.");
  if (observation.status === 'Rejected') continue;
  const notifications = (await c.query("SELECT to_regclass(current_schema() || '.botanist_notification') IS NOT NULL AS available")).rows[0].available;
  if (!notifications) throw Object.assign(Error("Linked rejection requires notification migration 011."), { status: 503 });
  const reason = `Species request ${request.request_id} was rejected. Its linked initial plant registration was automatically rejected. Both rejections are final. ${comment}`;
  const linkedDecisionId = linkedDecisionUsed ? randomUUID() : decisionId;
  linkedDecisionUsed = true;
  await c.query(`INSERT INTO observation_review(id,observation_id,reviewer_subject,decision,comment,review_origin,species_request_id,species_review_cycle)
    VALUES($1,$2,$3,'Rejected',$4,'species_dependency',$5,$6)`,
  [linkedDecisionId, observation.id, `staff:${user.id}`, reason, request.request_id, request.review_cycle]);
  await c.query("UPDATE plant_observation SET status='Rejected',revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1", [observation.id]);
  await c.query("UPDATE plant_record SET rbac_status='Rejected' WHERE plant_id=$1", [plant.plant_id]);
  const history = (await c.query(`SELECT count(*)=8 AS available FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name='record_version_history'
      AND column_name IN ('id','version_number','plant_id','status','reviewed_by','reviewed_at','review_comment','snapshot')`)).rows[0].available;
  if (history) await c.query(`UPDATE record_version_history SET status='Rejected',reviewed_by=$1,
    reviewed_at=CURRENT_TIMESTAMP,review_comment=$2 WHERE id=(SELECT id FROM record_version_history
    WHERE plant_id=$3 AND status='Pending Review' AND snapshot->>'observation_id'=$4 ORDER BY version_number DESC LIMIT 1)`,
  [`staff:${user.id}`, reason, plant.plant_id, observation.id]);
  await c.query(`INSERT INTO botanist_notification(id,recipient_subject,type,source_key,observation_id,review_id,plant_id,metadata)
    VALUES($1,$2,'observation_rejected',$3,$4,$1,$5,$6) ON CONFLICT(recipient_subject,source_key) DO NOTHING`,
  [linkedDecisionId, request.owner_subject, `species-dependency:${linkedDecisionId}`, observation.id, plant.plant_id,
    { cause: 'species_dependency', species_request_id: String(request.request_id), final: true }]);
  await audit(c, user, "linked_registration_auto_rejected", observation.id);
  }
  return { linked_registrations: receipts.length, already_rejected: !linkedDecisionUsed };
}
module.exports = { rejectLinkedRegistration };
