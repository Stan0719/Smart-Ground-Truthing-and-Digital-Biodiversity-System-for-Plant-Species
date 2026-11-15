"use strict";
// Read-only, batched enrichment after existing visibility and origin classification.
// No recipient inbox lookup, writes, migration, pool or workflow changes.
async function withResubmissionEvidence(db,rows,officer){
  if(!officer || !rows.length)return rows;
  const result=rows.map(row=>({...row,is_correction_resubmission:row.status==='Pending Review'?null:false}));
  const pending=result.filter(row=>row.status==='Pending Review' && ['initial_registration','subsequent_observation'].includes(row.origin_type));
  if(!pending.length)return result;
  const available=(await db.query(`SELECT to_regclass(current_schema()||'.staff_notification_event') IS NOT NULL AS events,
    to_regclass(current_schema()||'.record_version_history') IS NOT NULL AS versions`)).rows[0] || {};
  // Optional historical stores are not assumed installed. Missing evidence is NULL.
  const initial=available.versions?`EXISTS(SELECT 1 FROM record_version_history h
    JOIN record_version_history previous ON previous.plant_id=h.plant_id AND previous.record_type='plant'
      AND previous.version_number=h.version_number-1
    WHERE h.record_type='plant' AND h.plant_id=o.plant_id AND h.status='Pending Review' AND h.change_id IS NULL
      AND h.owner_subject=o.owner_subject AND h.edited_by=o.owner_subject AND previous.owner_subject=o.owner_subject
      AND h.snapshot->>'observation_id'=o.id AND h.snapshot->>'observation_revision'=o.revision::text
      AND h.created_at=o.updated_at AND h.previous_snapshot=previous.snapshot
      AND previous.snapshot->>'observation_id'=o.id AND previous.status='Correction Required'
      AND previous.reviewed_at=r.created_at AND previous.reviewed_by=r.reviewer_subject
      AND NOT EXISTS(SELECT 1 FROM record_version_history newer WHERE newer.plant_id=h.plant_id AND newer.version_number>h.version_number)
      AND EXISTS(SELECT 1 FROM business_audit a WHERE a.target=o.plant_id::text AND a.actor_subject=o.owner_subject
        AND a.action='pending_plant_updated' AND a.created_at=o.updated_at))`:'FALSE';
  const subsequent=available.events?`EXISTS(SELECT 1 FROM staff_notification_event e
    WHERE e.observation_id=o.id AND e.audience_role='Conservation Officer' AND e.resource_kind='observation'
      AND e.event_type='observation_resubmitted' AND e.source_key='officer:field_correction:'||o.id||':'||r.id
      AND e.metadata->>'correction_review_id'=r.id AND e.metadata->>'submitted_revision'=o.revision::text
      AND e.occurred_at>=o.updated_at AND e.occurred_at>r.created_at
      AND EXISTS(SELECT 1 FROM business_audit a WHERE a.target=o.id AND a.actor_subject=o.owner_subject
        AND a.action='observation_submitted' AND a.created_at=o.updated_at))`:'FALSE';
  const evidence=(await db.query(`SELECT o.id,CASE WHEN r.decision='Correction Required' AND r.reviewer_subject<>o.owner_subject
      AND r.reviewer_subject ~ '^staff:[A-Za-z0-9_-]{1,200}$'
      AND o.revision>=3 AND r.created_at<o.updated_at
      AND NOT EXISTS(SELECT 1 FROM observation_review tie WHERE tie.observation_id=o.id AND tie.created_at=r.created_at AND tie.id<>r.id)
      AND CASE WHEN requested.origin='initial_registration' THEN ${initial} ELSE ${subsequent} END
      THEN TRUE ELSE NULL END AS verified
    FROM unnest($1::text[],$2::integer[],$3::text[],$4::text[]) requested(id,revision,origin,owner_subject)
    JOIN plant_observation o ON o.id=requested.id AND o.revision=requested.revision AND o.owner_subject=requested.owner_subject AND o.status='Pending Review'
    LEFT JOIN LATERAL(SELECT id,decision,reviewer_subject,created_at FROM observation_review WHERE observation_id=o.id ORDER BY created_at DESC LIMIT 1) r ON TRUE`,
    [pending.map(row=>row.id),pending.map(row=>row.revision),pending.map(row=>row.origin_type),pending.map(row=>row.owner_subject)])).rows;
  const flags=new Map(evidence.map(row=>[row.id,row.verified===true]));
  return result.map(row=>({...row,is_correction_resubmission:row.status==='Pending Review'?(flags.get(row.id)===true?true:null):false}));
}
module.exports={withResubmissionEvidence};
