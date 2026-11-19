# Botanist Plant/Species review notification compatibility

## Reliability and authorization

For ordinary approved-record Plant/Species change proposals, notification creation
is a **mandatory atomic part of the review transaction**. Approved, Rejected and
Correction Required persist `record_change_approved`, `record_change_rejected` and
`record_change_correction`, respectively. The recipient is the proposal's stored
owner, not a client-supplied account. Metadata retains `entityType`, `changeId`,
`recordKind`, the Plant ID or originating Species Request ID, and exact revision.

This is a durable, owner-scoped database inbox, not a separate asynchronous
delivery outbox and not best-effort. A persisted row does not prove the Mobile UI
has fetched or displayed it. `read_at` remains null until authorized read handling.
Do not label a row delivered merely because its transaction committed.

The existing Officer authorization, self-review prohibition, status/revision
checks, row lock, fingerprint checks, canonical updates, history, audit and
notification insert remain in one transaction. Terminal retries/competing
decisions fail without a second notification. The unique `(recipient_subject,
source_key)` index also deduplicates exact notification identity. Insert failures
roll back the decision; there is no catch-and-continue behavior.

## Required schema and missing-schema behavior

The authoritative schema is:

1. Existing `plant_app` core Plant/Observation/review tables and the existing
   record-change/version-history migrations required by those workflows.
2. `011-botanist-notification-history.sql`: creates the inbox, source FKs,
   `id`, `recipient_subject`, `type`, `source_key`, `plant_id`, `observation_id`,
   `review_id`, `metadata`, `created_at`, `read_at`, primary/dedup indexes,
   staff-recipient and object-metadata constraints, and RLS/restricted grants.
3. `030-record-change-review-notifications.sql`: extends the allowed types and
   record-change identity constraint for all three decisions. On an upgraded
   installation it follows the existing
   `023-record-change-correction-notifications.sql`. A fresh notification
   installation can apply 011 then this 030; the latter includes the 023 type
   contract. It does not create a missing inbox table.

The runtime checks required column presence, validated notification type/identity
constraints, RLS and the immediate valid unique recipient/source index before any
approval mutation. Missing table, old 011/023-only constraints, missing required
columns or lost deduplication return HTTP 503 with
`code: RECORD_CHANGE_NOTIFICATION_SCHEMA_REQUIRED`, the exact prerequisite
filenames and "No review was saved." No review success or partial approval is
reported. Database insert errors are not ignored; the transaction rolls back.
Catalog readiness is not a substitute for an operator rehearsal of permissions,
custom triggers or arbitrary schema drift.

Other registration/species/Observation review routes retain their own existing
schema contracts. This prerequisite concerns ordinary record-change review;
it does not enable IoT bell notifications or change legacy Observation-edit routing.

## Migration identity and rollout

`030-record-change-review-notifications.sql` and
`030-observation-edit-officer-notifications.sql` are different migrations. The
former extends `botanist_notification`; the latter extends Officer event/recipient
and Observation-edit evidence structures. They are not substitutes. Their full
filenames and checksums must be recorded separately; numeric `030` alone is
ambiguous. The existing runner selects explicit QR migration filenames and does
not automatically apply these notification migrations via `npm run migrate`.

Do not rename, edit or replay the existing Officer 030. This compatibility change
imports the Botanist 030 unchanged from remote commit `2d50cfc`. It does not add a
new migration variant, execute schema changes at startup, or modify the runner.

Before a separately approved deployment, review an appropriate backup/snapshot,
the target schema, existing rows/types, constraints, grants and exact migration
ledger. Rehearse the intended full-file order in an isolated PostgreSQL database.
Do not replay 011 if its table already exists; it deliberately rejects that case.
Resolve unexpected existing rows or schema signatures rather than deleting data.
Apply only the missing approved Botanist migration, structurally verify it, then
deploy/restart the compatible backend and matching remote Mobile client. This task
does none of those operational steps and makes no claim about shared Supabase.

The corresponding remote Mobile support for Approved/Rejected notification types,
titles and navigation must be retained during final integration. This focused
backend compatibility task does not replace that later client reconciliation.

## Verification limits

Tests explicitly opt into real migration 011/030 on disposable PGlite. Missing
table, legacy 023-only, invalid schema, failed inserts, exact owner/history
identity, duplicate decisions, competing Officers and atomic rollback are tested.
Existing history/approval, Officer notification and Mobile contract regressions
remain required. PGlite serializes connections; this is not live multi-connection
PostgreSQL concurrency or Mobile end-to-end delivery UAT.

After final Git reconciliation, rerun broad backend/Web/Mobile suites, both
typechecks, Web build, route/security and locale checks, lint and the final patch
and ancestry review against the actual merged source. No deployment readiness
claim follows from isolated module tests alone.
