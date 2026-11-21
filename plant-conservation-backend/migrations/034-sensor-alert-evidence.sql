-- PREPARED FOR TEAM REVIEW. Apply manually only after agreement; no historical backfill.
-- Requires canonical plant_app IoT tables and 031. Notification migration 032 remains separate.
BEGIN;
ALTER TABLE plant_app.threat_alert_history ADD COLUMN IF NOT EXISTS sensor_evidence JSONB;
ALTER TABLE plant_app.threat_alert_history ADD CONSTRAINT sensor_alert_evidence_object
 CHECK (sensor_evidence IS NULL OR ((jsonb_typeof(sensor_evidence)='object'
   AND sensor_evidence->>'version'='1' AND sensor_evidence->>'device_id'=device_id
   AND sensor_evidence->>'metric'=metric AND (sensor_evidence->>'value')::double precision=value
   AND sensor_evidence->>'direction' IN ('low','high')
   AND jsonb_typeof(sensor_evidence->'values')='object'
   AND jsonb_typeof(sensor_evidence->'limits')='object'
   AND jsonb_typeof(sensor_evidence->'plant_id') IN ('string','null')
   AND jsonb_typeof(sensor_evidence->'captured_at') IN ('string','null')
   AND jsonb_typeof(sensor_evidence->'received_at')='string'
   AND (sensor_evidence->'values'->>metric)::double precision=value) IS TRUE));
CREATE FUNCTION plant_app.protect_sensor_alert_evidence() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF NEW.sensor_evidence IS DISTINCT FROM OLD.sensor_evidence
 OR (OLD.sensor_evidence IS NOT NULL AND
   ROW(NEW.device_id,NEW.reading_id,NEW.metric,NEW.value,NEW.detected_at,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.device_id,OLD.reading_id,OLD.metric,OLD.value,OLD.detected_at,OLD.created_at)) THEN
   RAISE EXCEPTION 'Sensor alert evidence is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_sensor_alert_evidence BEFORE UPDATE ON plant_app.threat_alert_history
 FOR EACH ROW EXECUTE FUNCTION plant_app.protect_sensor_alert_evidence();
COMMIT;
