-- REVIEW DRAFT ONLY. Not in the migration runner. Never applied at startup.
-- Requires separately verified detection provenance/authorization and backup.
-- This adds storage compatibility only; it does not activate any producer.
BEGIN;
SET LOCAL search_path TO plant_app, pg_catalog;
DO $$ BEGIN
  IF to_regclass('plant_app.staff_notification_event') IS NULL OR to_regclass('plant_app.threat_alert_history') IS NULL THEN
    RAISE EXCEPTION 'Required notification/threat tables are absent';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='plant_app.staff_notification_event'::regclass AND attname='threat_alert_id' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'Partial or previous installation: inspect before proceeding';
  END IF;
END $$;
ALTER TABLE plant_app.staff_notification_event ADD COLUMN threat_alert_id TEXT
  REFERENCES plant_app.threat_alert_history(id) ON DELETE SET NULL;
ALTER TABLE plant_app.staff_notification_event DROP CONSTRAINT staff_notification_event_resource_kind_check;
ALTER TABLE plant_app.staff_notification_event ADD CONSTRAINT staff_notification_event_resource_kind_check
  CHECK(resource_kind IN ('system','observation','species_request','record_change','threat_alert'));
ALTER TABLE plant_app.staff_notification_event DROP CONSTRAINT staff_notification_event_contract;
ALTER TABLE plant_app.staff_notification_event ADD CONSTRAINT staff_notification_event_contract CHECK (
  (audience_role='Administrator' AND resource_kind='system' AND event_type IN ('system_failure','account_administration','security_event'))
  OR (audience_role='Conservation Officer' AND (
    (resource_kind='observation' AND event_type IN ('registration_submitted','field_observation_submitted','observation_resubmitted','observation_flagged','species_dependency_resolved'))
    OR (resource_kind='species_request' AND event_type IN ('species_request_submitted','species_request_resubmitted'))
    OR (resource_kind='record_change' AND event_type='record_change_submitted')
    OR (resource_kind='threat_alert' AND event_type='possible_poaching_detected')
  )));
ALTER TABLE plant_app.staff_notification_event ADD CONSTRAINT staff_notification_threat_reference CHECK (
  (resource_kind='threat_alert' OR threat_alert_id IS NULL)
  AND (resource_kind<>'threat_alert' OR (observation_id IS NULL AND species_request_id IS NULL AND record_change_id IS NULL)));
-- Provenance fields are immutable with the rest of metadata. NULL FK is allowed
-- only to preserve historical events after source deletion; readers must hide it.
ALTER TABLE plant_app.staff_notification_event ADD CONSTRAINT staff_notification_detection_provenance CHECK (
  event_type<>'possible_poaching_detected' OR (
    jsonb_typeof(metadata->'detection_source')='string' AND length(btrim(metadata->>'detection_source')) BETWEEN 1 AND 100
    AND jsonb_typeof(metadata->'detection_id')='string' AND length(btrim(metadata->>'detection_id')) BETWEEN 1 AND 100
    AND jsonb_typeof(metadata->'source_version')='string' AND length(btrim(metadata->>'source_version')) BETWEEN 1 AND 100
    AND metadata ?& ARRAY['detection_source','detection_id','source_version']));
CREATE UNIQUE INDEX staff_notification_detection_identity
  ON plant_app.staff_notification_event((metadata->>'detection_source'),(metadata->>'detection_id'))
  WHERE audience_role='Conservation Officer' AND event_type='possible_poaching_detected';
CREATE OR REPLACE FUNCTION plant_app.staff_notification_event_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF (to_jsonb(NEW)-ARRAY['delivery_state','attempts','next_attempt_at','last_error_code','delivered_at','observation_id','species_request_id','record_change_id','threat_alert_id'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['delivery_state','attempts','next_attempt_at','last_error_code','delivered_at','observation_id','species_request_id','record_change_id','threat_alert_id'])
    OR (NEW.observation_id IS NOT NULL AND NEW.observation_id IS DISTINCT FROM OLD.observation_id)
    OR (NEW.species_request_id IS NOT NULL AND NEW.species_request_id IS DISTINCT FROM OLD.species_request_id)
    OR (NEW.record_change_id IS NOT NULL AND NEW.record_change_id IS DISTINCT FROM OLD.record_change_id)
    OR (NEW.threat_alert_id IS NOT NULL AND NEW.threat_alert_id IS DISTINCT FROM OLD.threat_alert_id) THEN
    RAISE EXCEPTION 'Staff notification event identity is immutable';
  END IF;
  RETURN NEW;
END $$;
COMMIT;
