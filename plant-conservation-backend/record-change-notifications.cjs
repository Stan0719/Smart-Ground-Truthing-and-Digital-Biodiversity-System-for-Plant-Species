"use strict";

// A durable, recipient-scoped notification is part of the decision transaction.
// Never cache readiness across requests: deployment state may change.
async function requireRecordChangeNotifications(c) {
  const ready = (await c.query(`SELECT
    (SELECT count(*)=10 FROM pg_attribute
      WHERE attrelid=to_regclass('plant_app.botanist_notification') AND NOT attisdropped
        AND attname=ANY(ARRAY['id','recipient_subject','type','source_key','plant_id','metadata',
          'observation_id','review_id','created_at','read_at']::text[])) AS columns_ready,
    EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('plant_app.botanist_notification') AND relrowsecurity) AS security_ready,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('plant_app.botanist_notification')
      AND conname='botanist_notification_type_check' AND convalidated
      AND pg_get_constraintdef(oid) LIKE '%record_change_approved%'
      AND pg_get_constraintdef(oid) LIKE '%record_change_rejected%'
      AND pg_get_constraintdef(oid) LIKE '%record_change_correction%') AS types_ready,
    EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('plant_app.botanist_notification')
      AND conname='botanist_notification_check' AND convalidated
      AND pg_get_constraintdef(oid) LIKE '%record_change_approved%'
      AND pg_get_constraintdef(oid) LIKE '%record_change_rejected%'
      AND pg_get_constraintdef(oid) LIKE '%entityType%') AS contract_ready,
    EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=to_regclass('plant_app.botanist_notification')
      AND i.indisunique AND i.indisvalid AND i.indimmediate AND i.indpred IS NULL AND i.indexprs IS NULL
      AND (SELECT array_agg(a.attname::text ORDER BY k.ordinality)
        FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality)
        JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum)
        =ARRAY['recipient_subject','source_key']::text[]) AS dedup_ready`)).rows[0];
  if (!ready?.columns_ready || !ready.security_ready || !ready.types_ready || !ready.contract_ready || !ready.dedup_ready) {
    const error = new Error("Plant/Species edit review notifications require migrations 011-botanist-notification-history.sql and 030-record-change-review-notifications.sql in plant_app. No review was saved.");
    error.status = 503;
    error.code = "RECORD_CHANGE_NOTIFICATION_SCHEMA_REQUIRED";
    throw error;
  }
}
module.exports = { requireRecordChangeNotifications };
