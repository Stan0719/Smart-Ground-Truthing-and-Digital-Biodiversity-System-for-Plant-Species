# Website database translation coverage

Inspected read-only in PostgreSQL database `postgres`, schema `plant_app`, with `search_path` `plant_app, pg_catalog` on 21 November 2026. The backend uses the existing schema-scoped PostgreSQL pool. This implementation does not create or alter tables.

## Source tables and field decisions

| Table (primary key) | Actual columns and relevant links | Translation treatment |
| --- | --- | --- |
| `family` (`family_id bigint`) | `family_name text` | Family names are taxonomic names; preserve exactly. No prose column. |
| `genus` (`genus_id bigint`) | `family_id bigint` → `family.family_id`; `genus_name text` | Genus names and foreign key are protected; no prose column. |
| `conservation_status` (`status_id bigint`) | `status_name text` | Controlled status labels use Vue I18n; no explanatory prose column. |
| `species` (`species_id bigint`) | `scientific_name text`, `common_name text`, `genus_id bigint` → `genus`, `status_id bigint` → `conservation_status`, `description text`, `rbac_data jsonb`, `registered_at timestamptz` | `description`; and present `rbac_data` string paths `habitat` and `culturalSignificance` are eligible. Source-language metadata must match the current text hash. Common and scientific names, IDs, status, and timestamps are preserved. |
| `plant_record` (`plant_id bigint`) | `species_id bigint` → `species`; `registered_subject text`, `rbac_status text`, `qr_token text`, `registered_at timestamptz`, `scientific_name text`, `withdrawn_by text`, `withdrawn_at timestamptz` | No prose columns. Names, QR token, status, identity, and timestamps are preserved. |
| `plant_location` (`location_id bigint`) | `plant_id bigint` → `plant_record`; `latitude double precision`, `longitude double precision`, `accuracy_m double precision`, `recorded_at timestamptz` | Coordinates and measurements are technical values; no prose column. |
| `plant_observation` (`id text`) | `plant_id bigint` → `plant_record`; `owner_subject text`, `status text`, `content jsonb`, `revision integer`, `client_key text`, `created_at/updated_at timestamptz`, `origin_type text`, withdrawal fields | Only `content.morphology` and `content.notes` are translated. The observed JSONB paths are top-level strings. `healthStatus` and `lifeStage` are controlled values; `taxonomy`, numeric measurements, GPS, zone, keys, status, and timestamps are preserved. |
| `observation_review` (`id text`) | `observation_id text` → `plant_observation`; reviewer, decision, `comment text`, timestamp, origin, and optional species-request links | `comment` is eligible only for a reviewer authorized to read it. Decisions, IDs, reviewer identity, timestamps, and links are preserved. |
| `plant_asset` (`id text`) | Nullable links to `species`, `plant_record`, and `plant_observation`; owner/client key, approval, content type, `content bytea`, timestamp | No text caption or description column exists. Binary content and technical metadata are not translated. |
| `plant_asset_photo_role` (`asset_id text`) | Composite links to `plant_asset` and `plant_observation`; `role text`, `recorded_by text`, timestamp | `role` is a controlled value displayed through Vue I18n, not model translation. IDs and timestamp are preserved. |

There were 36 observations. Current `content` keys include string values `healthStatus`, `lifeStage`, `morphology`, `notes`, and `taxonomy`; numeric `heightCm`, `latitude`, `longitude`, `accuracy_m`, and `altitudeM`; and string/null `zone`. No nested narrative objects or arrays were present in the inspected rows. The code still selects only the two allowlisted prose paths rather than translating the JSON document.

## Existing translation storage

The live schema already contains `plant_translation_cache` and `plant_translation_source_language`; both are reused. No migration is included or applied. The cache has keys for source type/id/field/target locale and stores source locale/hash, translated text, model, prompt version, and timestamps. Its current constraints allow source locale `en` and target locale `ms` or `zh-CN`. Cache rows are reused only when source text hash, source locale, model, and protected-value checks pass. Stale rows are left in place and ignored; a new valid result replaces only its dedicated cache entry.

Read-only coverage counts at inspection time: 42 existing cache rows (all target `zh-CN`), 41 source-language metadata rows, 104 current eligible source values, 34 current values with matching verified English source metadata, and 28 hash-matching Chinese cache entries. Fields without matching source-language metadata are kept in their source text. The application does not infer a source language or write source-language metadata because the authoring language is not reliably known.

Only `plant_translation_cache` receives translation writes. Original source tables and `plant_translation_source_language` are read-only to this feature.
