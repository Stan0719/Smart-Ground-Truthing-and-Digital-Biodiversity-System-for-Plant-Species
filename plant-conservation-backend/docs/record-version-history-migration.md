# Record version history rollout

Migration `009-record-version-history.sql` is required for complete edit history. Migration 008 already stores approved-record proposals and review decisions; it does not preserve overwritten pending edits, historical species photo bytes, or a numbered timeline.

Before applying 009 to the configured `PLANT_PG_SCHEMA`:

1. Take and verify a database backup, including the plant schema and `public.qr_code`.
2. Confirm migration 008 is present and inspect the schema search path.
3. Apply 009 once in a transaction using the project's migration runner only after explicit approval. It creates one table and indexes, enables row-level security, and does not update existing rows or change visibility.
4. Check `record_version_history` exists, row-level security is enabled, and existing plant, species, asset and QR counts are unchanged.
5. Restart only the Plant Conservation API, then reload Expo. Test one pending correction and one approved proposal with isolated or deliberately authorized test records before routine use.

Version 1 is captured from the earliest reliably available record snapshot when that record is first edited after 009. Earlier edits overwritten by the old workflow cannot be reconstructed. Existing plant photo assets remain stored when removed from an active version; their IDs are retained in snapshots. Species photo bytes are stored per version. Old QR tokens are retired on reassignment and remain recorded in snapshots; they are not returned to the available inventory.

If 009 is absent, the history API reports `history_available: false`. Existing edit endpoints keep their current behavior, but pending corrections made before 009 cannot acquire complete version history retroactively.
