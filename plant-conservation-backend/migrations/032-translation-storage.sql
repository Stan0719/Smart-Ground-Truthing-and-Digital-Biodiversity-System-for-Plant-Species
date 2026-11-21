-- Recreate the verified translation-storage table shape for new installations.
-- This is additive and idempotent. It is intentionally not executed by this task.
-- Run with the reviewed plant_app schema selected; source tables are untouched.
BEGIN;

CREATE TABLE IF NOT EXISTS plant_app.plant_translation_cache (
  record_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  source_locale TEXT NOT NULL,
  target_locale TEXT NOT NULL,
  source_hash CHAR(64) NOT NULL,
  translated_text TEXT NOT NULL,
  model_name TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT plant_translation_cache_pkey
    PRIMARY KEY (record_type, record_id, field_name, target_locale),
  CONSTRAINT plant_translation_cache_source_hash_check
    CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT plant_translation_cache_source_locale_check
    CHECK (source_locale = 'en'),
  CONSTRAINT plant_translation_cache_target_locale_check
    CHECK (target_locale = ANY (ARRAY['ms', 'zh-CN']::TEXT[])),
  CONSTRAINT plant_translation_cache_translated_text_check
    CHECK (length(btrim(translated_text)) > 0)
);

CREATE INDEX IF NOT EXISTS plant_translation_cache_locale_updated_idx
  ON plant_app.plant_translation_cache (target_locale, updated_at DESC);

CREATE TABLE IF NOT EXISTS plant_app.plant_translation_source_language (
  record_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  source_hash CHAR(64) NOT NULL,
  source_locale TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT plant_translation_source_language_pkey
    PRIMARY KEY (record_type, record_id, field_name),
  CONSTRAINT plant_translation_source_language_source_hash_check
    CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT plant_translation_source_language_source_locale_check
    CHECK (source_locale = ANY (ARRAY['en', 'ms', 'zh-CN']::TEXT[]))
);

COMMIT;
