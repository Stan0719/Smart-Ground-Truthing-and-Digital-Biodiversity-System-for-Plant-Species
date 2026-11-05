-- Additive Botanist notification history and persistent read status.
-- Review and apply only after the notification migration is approved.
BEGIN;

DO $$
BEGIN
  IF to_regclass('plant_app.plant_record') IS NULL
     OR to_regclass('plant_app.plant_observation') IS NULL
     OR to_regclass('plant_app.observation_review') IS NULL THEN
    RAISE EXCEPTION 'Expected plant_app notification source tables are missing; no changes made';
  END IF;
  IF to_regclass('plant_app.botanist_notification') IS NOT NULL THEN
    RAISE EXCEPTION 'plant_app.botanist_notification already exists; inspect and reuse it';
  END IF;
END;
$$;

CREATE TABLE plant_app.botanist_notification (
  id TEXT PRIMARY KEY,
  recipient_subject TEXT NOT NULL CHECK (recipient_subject LIKE 'staff:%'),
  type TEXT NOT NULL CHECK (type IN (
    'observation_submitted', 'observation_approved', 'observation_rejected',
    'correction_requested', 'sync_failed', 'sync_completed'
  )),
  source_key TEXT NOT NULL,
  observation_id TEXT REFERENCES plant_app.plant_observation(id) ON DELETE SET NULL,
  review_id TEXT REFERENCES plant_app.observation_review(id) ON DELETE SET NULL,
  plant_id BIGINT REFERENCES plant_app.plant_record(plant_id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at TIMESTAMPTZ,
  UNIQUE (recipient_subject, source_key),
  CHECK (
    (type IN ('observation_submitted', 'observation_approved', 'observation_rejected', 'correction_requested') AND observation_id IS NOT NULL)
    OR (type IN ('sync_failed', 'sync_completed') AND observation_id IS NULL)
  )
);

CREATE INDEX botanist_notification_owner_time
  ON plant_app.botanist_notification(recipient_subject, created_at DESC, id DESC);

-- Existing review rows are authoritative historic review events.
INSERT INTO plant_app.botanist_notification
  (id, recipient_subject, type, source_key, observation_id, review_id, plant_id, created_at)
SELECT 'review:' || r.id,
       o.owner_subject,
       CASE r.decision
         WHEN 'Approved' THEN 'observation_approved'
         WHEN 'Rejected' THEN 'observation_rejected'
         WHEN 'Correction Required' THEN 'correction_requested'
       END,
       'review:' || r.id,
       o.id,
       r.id,
       o.plant_id,
       r.created_at
FROM plant_app.observation_review r
JOIN plant_app.plant_observation o ON o.id = r.observation_id
WHERE r.decision IN ('Approved', 'Rejected', 'Correction Required')
  AND o.owner_subject LIKE 'staff:%';

-- Only currently pending submissions have an authoritative submission time in
-- the existing schema. Older completed submission timestamps are not invented.
INSERT INTO plant_app.botanist_notification
  (id, recipient_subject, type, source_key, observation_id, plant_id, created_at)
SELECT 'submitted:' || o.id || ':' || to_char(o.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
       o.owner_subject,
       'observation_submitted',
       'submitted:' || o.id || ':' || o.revision,
       o.id,
       o.plant_id,
       o.updated_at
FROM plant_app.plant_observation o
WHERE o.status = 'Pending Review'
  AND o.owner_subject LIKE 'staff:%'
ON CONFLICT (recipient_subject, source_key) DO NOTHING;

ALTER TABLE plant_app.botanist_notification ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON plant_app.botanist_notification FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON plant_app.botanist_notification FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON plant_app.botanist_notification FROM authenticated;
  END IF;
END;
$$;
-- The Plant API runtime was previously verified as postgres; it enforces the
-- recipient_subject predicate in every query and bypasses RLS as service role.
GRANT SELECT, INSERT, UPDATE ON plant_app.botanist_notification TO postgres;

COMMIT;
