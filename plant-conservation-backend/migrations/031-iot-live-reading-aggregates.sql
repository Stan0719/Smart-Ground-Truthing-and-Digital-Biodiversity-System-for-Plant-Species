-- Add live-reading checkpoints and 10-minute report aggregates.
-- Existing sensor readings, ingestion receipts, alerts and database instances
-- are preserved. This migration does not delete or rewrite existing rows.
BEGIN;

ALTER TABLE plant_app.threat_alert_history
  ALTER COLUMN reading_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS plant_app.iot_reading_checkpoint(
  device_id TEXT PRIMARY KEY NOT NULL REFERENCES plant_app.iot_device(id),
  bucket_start TIMESTAMPTZ NOT NULL,
  last_observed_at TIMESTAMPTZ NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0 CHECK(sample_count>=0),
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  active_thresholds JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_payload_hash TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS plant_app.iot_reading_aggregate(
  device_id TEXT NOT NULL REFERENCES plant_app.iot_device(id),
  bucket_start TIMESTAMPTZ NOT NULL,
  bucket_end TIMESTAMPTZ NOT NULL,
  sample_count INTEGER NOT NULL CHECK(sample_count>0),
  metrics JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(device_id,bucket_start),
  CHECK(bucket_end>bucket_start)
);

CREATE INDEX IF NOT EXISTS iot_reading_aggregate_time_idx
  ON plant_app.iot_reading_aggregate(bucket_start DESC,device_id);

ALTER TABLE plant_app.iot_reading_checkpoint ENABLE ROW LEVEL SECURITY;
ALTER TABLE plant_app.iot_reading_aggregate ENABLE ROW LEVEL SECURITY;

COMMIT;
