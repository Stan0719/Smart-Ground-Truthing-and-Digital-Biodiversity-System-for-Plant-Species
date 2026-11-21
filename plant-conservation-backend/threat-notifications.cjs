"use strict";
// Capability detection keeps pre-032 deployments usable for existing notice categories.
async function threatNotificationReady(pool) {
  return Boolean((await pool.query(`SELECT EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema='plant_app' AND table_name='staff_notification_event'
    AND column_name='threat_alert_id') AND EXISTS(SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='plant_app' AND c.relname='threat_alert_history'
    AND t.tgname='canonical_threat_notice' AND t.tgenabled IN ('O','A')) AS threat_ready`)).rows[0]?.threat_ready);
}
module.exports = { threatNotificationReady };
