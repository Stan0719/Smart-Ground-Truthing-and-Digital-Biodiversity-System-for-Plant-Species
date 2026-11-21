# Mobile database text translation

The mobile app uses the existing PostgreSQL-backed TranslateGemma service. It sends only a record type, record ID, and allowlisted field name to `POST /api/mobile/translations`; source text is resolved by the backend after applying the existing role, visibility, and source-language metadata checks. Translations share the website's `plant_translation_cache` and `plant_translation_source_language` tables. The app does not persist its own translation copy.

The mobile i18next locale is the source of truth: English makes no translation request, `ms` requests Malaysian Malay, and `zh` requests Simplified Chinese (`zh-CN` to the backend). While a request is pending or fails, the source text remains visible. Interface labels continue to come from the existing mobile locale files.

The supported prose is limited to `species.description`, `species.habitat`, `species.culturalSignificance`, `observation.morphology`, and `observation.notes`. Backend authorization still limits protected species, habitat, notes, and review data by the existing permissions. Review comments are not displayed to the mobile roles and are not requested by the mobile app. Common/scientific names, taxonomy, IDs, measurements, coordinates, media paths, and other technical fields are not sent for translation.

The mobile route is additive. It accepts an existing Botanist or Visitor bearer session, or anonymous public Guest access for public fields only. The browser boundary exception applies only to the exact `POST /api/mobile/translations` path; the website translation route continues to require an approved browser Origin and reject bearer credentials. No other mobile API response or role grant is changed.

## Runtime prerequisites

This feature depends on the translation storage tables already existing in the connected PostgreSQL schema, valid current source-language metadata for each source-text hash, and a reachable local Ollama service with `translategemma:4b`. It does not create the tables or label source text. If any prerequisite is missing, the app falls back to the original text. Do not infer successful live translation from unit tests alone.
