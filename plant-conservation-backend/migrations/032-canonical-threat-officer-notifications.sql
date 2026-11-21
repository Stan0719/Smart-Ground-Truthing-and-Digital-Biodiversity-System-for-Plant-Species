-- Manual, coordinated deployment only. Requires 013 and 030-observation-edit-officer-notifications.
-- No backfill. Public IoT tables and Botanist notifications are deliberately untouched.
BEGIN;
SET LOCAL search_path TO plant_app, pg_catalog;
DO $$ BEGIN
 IF current_schema()<>'plant_app' OR to_regclass('plant_app.threat_alert_history') IS NULL
 OR to_regclass('plant_app.staff_notification_event') IS NULL
 OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='plant_app'
   AND table_name='staff_notification_event' AND column_name='observation_edit_revision') THEN
   RAISE EXCEPTION 'Requires canonical plant_app IoT schema and Officer migrations 013 and 030';
 END IF;
END $$;
ALTER TABLE staff_notification_event ADD COLUMN threat_alert_id TEXT
 REFERENCES plant_app.threat_alert_history(id) ON DELETE RESTRICT;
ALTER TABLE staff_notification_event DROP CONSTRAINT staff_notification_event_resource_kind_check;
ALTER TABLE staff_notification_event ADD CONSTRAINT staff_notification_event_resource_kind_check
 CHECK(resource_kind IN ('system','observation','species_request','record_change','observation_edit','threat_alert'));
ALTER TABLE staff_notification_event DROP CONSTRAINT staff_notification_event_contract;
ALTER TABLE staff_notification_event ADD CONSTRAINT staff_notification_event_contract CHECK (
 (audience_role='Administrator' AND resource_kind='system' AND event_type IN ('system_failure','account_administration','security_event'))
 OR (audience_role='Conservation Officer' AND (
 (resource_kind='observation' AND event_type IN ('registration_submitted','field_observation_submitted','observation_resubmitted','observation_flagged','species_dependency_resolved'))
 OR (resource_kind='species_request' AND event_type IN ('species_request_submitted','species_request_resubmitted'))
 OR (resource_kind='record_change' AND event_type='record_change_submitted')
 OR (resource_kind='observation_edit' AND event_type IN ('observation_edit_submitted','observation_edit_resubmitted'))
 OR (resource_kind='threat_alert' AND event_type='threat_alert_created'))));
ALTER TABLE staff_notification_event ADD CONSTRAINT staff_notification_threat_identity CHECK (
 (resource_kind='threat_alert' AND threat_alert_id IS NOT NULL AND observation_id IS NULL
  AND species_request_id IS NULL AND record_change_id IS NULL AND observation_edit_request_id IS NULL
  AND observation_edit_revision IS NULL AND (metadata->>'source' IN ('Sensor','Camera')) IS TRUE
  AND metadata ?& ARRAY['source','metric','value','device_id']
  AND jsonb_typeof(metadata->'value')='number')
 OR (resource_kind<>'threat_alert' AND threat_alert_id IS NULL));
CREATE UNIQUE INDEX staff_notification_threat_creation_identity
 ON staff_notification_event(threat_alert_id) WHERE resource_kind='threat_alert';

-- Preserve the original immutable-field comparison, plus explicitly protect the new reference.
CREATE OR REPLACE FUNCTION plant_app.staff_notification_event_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF NEW.threat_alert_id IS DISTINCT FROM OLD.threat_alert_id
 OR (to_jsonb(NEW)-ARRAY['delivery_state','attempts','next_attempt_at','last_error_code','delivered_at','observation_id','species_request_id','record_change_id'])
 IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['delivery_state','attempts','next_attempt_at','last_error_code','delivered_at','observation_id','species_request_id','record_change_id'])
 OR (NEW.observation_id IS NOT NULL AND NEW.observation_id IS DISTINCT FROM OLD.observation_id)
 OR (NEW.species_request_id IS NOT NULL AND NEW.species_request_id IS DISTINCT FROM OLD.species_request_id)
 OR (NEW.record_change_id IS NOT NULL AND NEW.record_change_id IS DISTINCT FROM OLD.record_change_id) THEN
 RAISE EXCEPTION 'Staff notification event identity is immutable'; END IF;
 RETURN NEW;
END $$;

-- Canonical insertion is the durable outbox boundary, including external Camera writers.
-- Invoker security: the canonical writer needs INSERT on the existing event table.
-- An event insert failure rolls back its alert/reading transaction; never silently drop an event.
CREATE FUNCTION plant_app.enqueue_canonical_threat_notice() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE source TEXT; device_type TEXT; camera_type TEXT;
BEGIN
 SELECT d.device_type INTO device_type FROM plant_app.iot_device d WHERE d.id=NEW.device_id;
 IF NEW.camera_id IS NOT NULL THEN
  SELECT d.device_type INTO camera_type FROM plant_app.iot_device d WHERE d.id=NEW.camera_id;
 END IF;
 IF NEW.metric IN ('temperature','humidity','soilMoisture','movement','rainfall','sound')
   AND device_type='Sensor' AND NEW.camera_id IS NULL THEN source:='Sensor';
 ELSIF NEW.metric IN ('possible_plant_contact','human_detected','animal_detected','suspicious_movement')
   AND ((device_type='Camera' AND (NEW.camera_id IS NULL OR NEW.camera_id=NEW.device_id))
    OR (device_type='Sensor' AND camera_type='Camera')) THEN source:='Camera';
 ELSE RETURN NEW; END IF;
 IF NEW.value IS NULL OR NEW.value::text IN ('NaN','Infinity','-Infinity') THEN RETURN NEW; END IF;
 INSERT INTO plant_app.staff_notification_event(id,source_key,event_type,audience_role,resource_kind,
   threat_alert_id,metadata)
 VALUES(md5('niah:canonical-threat:'||NEW.id)::uuid,'officer:threat_alert_created:'||md5(NEW.id),
   'threat_alert_created','Conservation Officer','threat_alert',NEW.id,
   jsonb_build_object('source',source,'metric',NEW.metric,'value',NEW.value,'device_id',NEW.device_id,
    'reading_id',NEW.reading_id,'camera_id',NEW.camera_id))
 ON CONFLICT(source_key) DO NOTHING;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION plant_app.enqueue_canonical_threat_notice() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plant_app.enqueue_canonical_threat_notice() TO postgres;
CREATE TRIGGER canonical_threat_notice AFTER INSERT ON plant_app.threat_alert_history
 FOR EACH ROW EXECUTE FUNCTION plant_app.enqueue_canonical_threat_notice();
COMMIT;
