-- Notification-only extension after 029. NOT the abandoned Observation-versioning migration.
-- Review/coordinate a backup and isolated rehearsal before approved deployment.
-- No data backfill, no submitted-version/photo capability structures, no startup execution.
BEGIN;
SET LOCAL search_path TO plant_app, pg_catalog;
DO $$ BEGIN
 IF current_schema()<>'plant_app' OR to_regclass('plant_app.staff_notification_event') IS NULL
 OR to_regclass('plant_app.staff_notification') IS NULL OR to_regclass('plant_app.observation_edit_request') IS NULL
 OR to_regclass('plant_app.observation_edit_event') IS NULL OR to_regclass('plant_app.observation_submission_version') IS NULL THEN
  RAISE EXCEPTION 'Requires plant_app migrations 013, 021 and 029';
 END IF;
END $$;
ALTER TABLE staff_notification_event
 ADD COLUMN observation_edit_request_id TEXT REFERENCES observation_edit_request(id) ON DELETE RESTRICT,
 ADD COLUMN observation_edit_revision INTEGER CHECK(observation_edit_revision>0);
ALTER TABLE staff_notification_event DROP CONSTRAINT staff_notification_event_resource_kind_check;
ALTER TABLE staff_notification_event ADD CONSTRAINT staff_notification_event_resource_kind_check
 CHECK(resource_kind IN ('system','observation','species_request','record_change','observation_edit'));
ALTER TABLE staff_notification_event DROP CONSTRAINT staff_notification_event_contract;
ALTER TABLE staff_notification_event ADD CONSTRAINT staff_notification_event_contract CHECK (
 (audience_role='Administrator' AND resource_kind='system' AND event_type IN ('system_failure','account_administration','security_event'))
 OR (audience_role='Conservation Officer' AND (
 (resource_kind='observation' AND event_type IN ('registration_submitted','field_observation_submitted','observation_resubmitted','observation_flagged','species_dependency_resolved'))
 OR (resource_kind='species_request' AND event_type IN ('species_request_submitted','species_request_resubmitted'))
 OR (resource_kind='record_change' AND event_type='record_change_submitted')
 OR (resource_kind='observation_edit' AND event_type IN ('observation_edit_submitted','observation_edit_resubmitted')))));
ALTER TABLE staff_notification_event ADD CONSTRAINT staff_notification_observation_edit_identity CHECK (
 (resource_kind='observation_edit' AND observation_edit_request_id IS NOT NULL AND observation_edit_revision IS NOT NULL
  AND observation_id IS NULL AND species_request_id IS NULL AND record_change_id IS NULL
  AND ((event_type='observation_edit_submitted' AND observation_edit_revision=1) OR (event_type='observation_edit_resubmitted' AND observation_edit_revision>1)))
 OR (resource_kind<>'observation_edit' AND observation_edit_request_id IS NULL AND observation_edit_revision IS NULL));
CREATE UNIQUE INDEX staff_notification_observation_edit_revision
 ON staff_notification_event(observation_edit_request_id,observation_edit_revision) WHERE resource_kind='observation_edit';
-- Existing event guard compares all fields except its explicit retry/reference allowlist.
-- The two new fields are therefore immutable, including request identity and exact revision.

-- Dedicated notification evidence; deliberately NOT request_revision/submission_version_id.
ALTER TABLE observation_edit_event ADD COLUMN notification_revision INTEGER CHECK(notification_revision>0);
CREATE UNIQUE INDEX observation_edit_notification_evidence
 ON observation_edit_event(request_id,notification_revision) WHERE notification_revision IS NOT NULL;
CREATE FUNCTION plant_app.guard_observation_edit_notification_evidence() RETURNS trigger
LANGUAGE plpgsql SET search_path=plant_app,pg_catalog AS $$
DECLARE r observation_edit_request%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.notification_revision IS NOT NULL THEN RAISE EXCEPTION 'Notification evidence is retained' USING ERRCODE='55000'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND OLD.notification_revision IS NOT NULL THEN
  IF (to_jsonb(NEW)-'read_at') IS DISTINCT FROM (to_jsonb(OLD)-'read_at') THEN
   RAISE EXCEPTION 'Notification submission evidence is immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND OLD.notification_revision IS NULL AND NEW.notification_revision IS NOT NULL
  AND (to_jsonb(NEW)-'notification_revision') IS DISTINCT FROM (to_jsonb(OLD)-'notification_revision') THEN
  RAISE EXCEPTION 'Only exact revision annotation may change source evidence' USING ERRCODE='55000';
 END IF;
 IF NEW.notification_revision IS NOT NULL THEN
  SELECT * INTO r FROM observation_edit_request WHERE id=NEW.request_id;
  IF NOT FOUND OR r.observation_id IS DISTINCT FROM NEW.observation_id OR r.owner_subject IS DISTINCT FROM NEW.actor_subject
   OR r.status<>'Pending Review' OR r.revision IS DISTINCT FROM NEW.notification_revision
   OR NEW.created_at IS DISTINCT FROM transaction_timestamp()
   OR NOT ((NEW.event_type='submitted' AND NEW.notification_revision=1) OR (NEW.event_type='resubmitted' AND NEW.notification_revision>1)) THEN
   RAISE EXCEPTION 'Exact current-transaction proposal notification evidence required' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER observation_edit_notification_evidence_guard BEFORE INSERT OR UPDATE OR DELETE ON observation_edit_event
 FOR EACH ROW EXECUTE FUNCTION plant_app.guard_observation_edit_notification_evidence();
COMMIT;
