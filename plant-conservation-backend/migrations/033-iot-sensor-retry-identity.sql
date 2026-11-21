-- Additive retry metadata only; no raw-reading writes or historical backfill.
-- Apply after 031 (and in project order after 032) with the reviewed backend role.
BEGIN;
CREATE TABLE IF NOT EXISTS plant_app.iot_sensor_receipt(
  device_id TEXT NOT NULL REFERENCES plant_app.iot_device(id),
  client_key TEXT NOT NULL CHECK(length(client_key) BETWEEN 1 AND 100),
  payload_hash TEXT NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
  observed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(device_id,client_key)
);
ALTER TABLE plant_app.iot_sensor_receipt ENABLE ROW LEVEL SECURITY;
COMMIT;
