-- N2 only: no seed data, producers, backfill, account mapping or Botanist changes.
-- Review and manually apply to the application database; never run at API startup.
-- Requires the existing plant_app schema and migrations 004 and 008 there.
BEGIN;
DO $$
BEGIN
  IF to_regclass('plant_app.plant_observation') IS NULL
    OR to_regclass('plant_app.species_request_submission') IS NULL
    OR to_regclass('plant_app.record_change_submission') IS NULL THEN
    RAISE EXCEPTION 'Staff notification prerequisites are missing in plant_app';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS plant_app.staff_notification_event (
  id UUID PRIMARY KEY,
  source_key TEXT NOT NULL UNIQUE CHECK(length(btrim(source_key)) BETWEEN 1 AND 200),
  event_type TEXT NOT NULL,
  audience_role TEXT NOT NULL CHECK(audience_role IN ('Administrator','Conservation Officer')),
  resource_kind TEXT NOT NULL CHECK(resource_kind IN ('system','observation','species_request','record_change')),
  observation_id TEXT REFERENCES plant_app.plant_observation(id) ON DELETE SET NULL,
  species_request_id INTEGER REFERENCES plant_app.species_request_submission(request_id) ON DELETE SET NULL,
  record_change_id TEXT REFERENCES plant_app.record_change_submission(id) ON DELETE SET NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('normal','high')),
  metadata JSONB NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(metadata)='object' AND octet_length(metadata::text)<=4096),
  delivery_state TEXT NOT NULL DEFAULT 'pending' CHECK(delivery_state IN ('pending','delivered','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  last_error_code TEXT CHECK(last_error_code ~ '^[A-Z0-9_]{1,64}$'),
  delivered_at TIMESTAMPTZ,
  UNIQUE(id,audience_role),
  CONSTRAINT staff_notification_event_contract CHECK (
    (audience_role='Administrator' AND resource_kind='system'
      AND event_type IN ('system_failure','account_administration','security_event'))
    OR (audience_role='Conservation Officer' AND (
      (resource_kind='observation' AND event_type IN ('registration_submitted','field_observation_submitted','observation_resubmitted','observation_flagged','species_dependency_resolved'))
      OR (resource_kind='species_request' AND event_type IN ('species_request_submitted','species_request_resubmitted'))
      OR (resource_kind='record_change' AND event_type='record_change_submitted')))
  ),
  CHECK((resource_kind='observation' OR observation_id IS NULL)
    AND (resource_kind='species_request' OR species_request_id IS NULL)
    AND (resource_kind='record_change' OR record_change_id IS NULL)),
  CHECK((delivery_state='delivered')=(delivered_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS plant_app.staff_notification (
  id UUID PRIMARY KEY,
  event_id UUID NOT NULL,
  recipient_subject TEXT NOT NULL CHECK(recipient_subject ~ '^staff:[A-Za-z0-9_-]{1,200}$'),
  intended_role TEXT NOT NULL CHECK(intended_role IN ('Administrator','Conservation Officer')),
  delivery_seq BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  read_at TIMESTAMPTZ CHECK(read_at IS NULL OR read_at>=created_at),
  FOREIGN KEY(event_id,intended_role) REFERENCES plant_app.staff_notification_event(id,audience_role),
  UNIQUE(event_id,recipient_subject,intended_role)
);
CREATE INDEX IF NOT EXISTS staff_notification_recipient_page
  ON plant_app.staff_notification(recipient_subject,intended_role,delivery_seq DESC);
CREATE INDEX IF NOT EXISTS staff_notification_recipient_unread
  ON plant_app.staff_notification(recipient_subject,intended_role,delivery_seq DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS staff_notification_event_retry
  ON plant_app.staff_notification_event(next_attempt_at,id) WHERE delivery_state IN ('pending','failed');

-- Row insertion and read-through issuance use the same transaction lock. This
-- prevents a late-committing older delivery from slipping under an issued boundary.
CREATE OR REPLACE FUNCTION plant_app.staff_notification_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    PERFORM pg_advisory_xact_lock(193701,2);
    NEW.delivery_seq := nextval('plant_app.staff_notification_delivery_seq_seq'::regclass);
    NEW.created_at := clock_timestamp();
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-'read_at') IS DISTINCT FROM (to_jsonb(OLD)-'read_at') THEN
    RAISE EXCEPTION 'Staff notification identity is immutable';
  END IF;
  IF OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at THEN
    RAISE EXCEPTION 'First acknowledgement is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION plant_app.staff_notification_event_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  -- Deleted resource references may become NULL; replacement/reassignment may not.
  IF (to_jsonb(NEW)-ARRAY['delivery_state','attempts','next_attempt_at','last_error_code','delivered_at','observation_id','species_request_id','record_change_id'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['delivery_state','attempts','next_attempt_at','last_error_code','delivered_at','observation_id','species_request_id','record_change_id'])
    OR (NEW.observation_id IS NOT NULL AND NEW.observation_id IS DISTINCT FROM OLD.observation_id)
    OR (NEW.species_request_id IS NOT NULL AND NEW.species_request_id IS DISTINCT FROM OLD.species_request_id)
    OR (NEW.record_change_id IS NOT NULL AND NEW.record_change_id IS DISTINCT FROM OLD.record_change_id) THEN
    RAISE EXCEPTION 'Staff notification event identity is immutable';
  END IF;
  RETURN NEW;
END $$;
DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='plant_app.staff_notification'::regclass AND tgname='staff_notification_guard') THEN
    CREATE TRIGGER staff_notification_guard BEFORE INSERT OR UPDATE ON plant_app.staff_notification
      FOR EACH ROW EXECUTE FUNCTION plant_app.staff_notification_guard();
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='plant_app.staff_notification_event'::regclass AND tgname='staff_notification_event_guard') THEN
    CREATE TRIGGER staff_notification_event_guard BEFORE UPDATE ON plant_app.staff_notification_event
      FOR EACH ROW EXECUTE FUNCTION plant_app.staff_notification_event_guard();
  END IF;
END $$;
ALTER TABLE plant_app.staff_notification_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE plant_app.staff_notification ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON plant_app.staff_notification_event,plant_app.staff_notification FROM PUBLIC;
REVOKE ALL ON SEQUENCE plant_app.staff_notification_delivery_seq_seq FROM PUBLIC;
REVOKE ALL ON FUNCTION plant_app.staff_notification_guard(),plant_app.staff_notification_event_guard() FROM PUBLIC;
DO $$
DECLARE browser_role TEXT;
BEGIN
  FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
      EXECUTE format('REVOKE ALL ON plant_app.staff_notification_event,plant_app.staff_notification FROM %I',browser_role);
      EXECUTE format('REVOKE ALL ON SEQUENCE plant_app.staff_notification_delivery_seq_seq FROM %I',browser_role);
      EXECUTE format('REVOKE ALL ON FUNCTION plant_app.staff_notification_guard(),plant_app.staff_notification_event_guard() FROM %I',browser_role);
    END IF;
  END LOOP;
END $$;
-- Consistent with migration 011: trusted postgres runtime, application predicates.
-- Other runtime roles require separately reviewed grants/RLS; do not grant to browsers.
GRANT SELECT,INSERT,UPDATE ON plant_app.staff_notification_event,plant_app.staff_notification TO postgres;
GRANT USAGE,SELECT ON SEQUENCE plant_app.staff_notification_delivery_seq_seq TO postgres;
GRANT EXECUTE ON FUNCTION plant_app.staff_notification_guard(),plant_app.staff_notification_event_guard() TO postgres;
COMMIT;
