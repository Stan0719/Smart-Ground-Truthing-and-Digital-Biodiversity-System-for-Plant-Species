# Officer notifications for Observation Edit Requests

## Scope and prerequisite

`030-observation-edit-officer-notifications.sql` is a notification-only additive extension after migrations through 029. It is **not** the abandoned advanced Observation-versioning migration. It adds none of that capability's tables/columns, and advanced readiness remains false. Do not edit/replay previous migrations to install this feature.

The migration adds `staff_notification_event.observation_edit_request_id` (TEXT FK, deletion restricted) and `observation_edit_revision` (positive INTEGER), the `observation_edit` resource, and explicit `observation_edit_submitted` / `observation_edit_resubmitted` events. Existing event identities and rows remain unchanged. The existing immutable-event trigger protects the newly added identity fields. One event per proposal revision and existing per-recipient uniqueness prevent duplicates.

`observation_edit_event.notification_revision` records exact notification evidence for new submit/resubmit transactions only. Its guard prevents retrospective timestamp-based annotation, modification or deletion after annotation. This is notification evidence, not submission-version/review evidence; it deliberately does not introduce advanced versioning capability columns.

The operator reports that notification-only Migration 030 has been applied to shared Supabase, with all four structural checks true: `staff_notification_event.observation_edit_request_id` exists, `staff_notification_event.observation_edit_revision` exists, `observation_edit_event.notification_revision` exists, and `observation_edit_notification_evidence_guard` is enabled. This is operator-reported schema evidence, not an independent database inspection or proof of live delivery. Current backend processes and deployed Officer Web compatibility have not been verified.

## Business transaction and compatibility

The existing 029-only POST and correction PATCH workflows retain the Approved baseline and mandatory proposal review revisions. Each successful submission transition creates its source edit event, annotates its exact revision and enqueues the outbox event in that same transaction. Enqueue or commit failure rolls everything back. A repeated identical POST reuses the proposal and cannot create another event. A stale correction PATCH remains a conflict, without another event.

Before the notification migration, the producer returns unavailable without breaking existing business requests. Once the migration exists, outbox failures abort the business transition. Deploy the migration first, then compatible backend, then Web. A submission during an old-backend deployment window will not have annotated evidence and must not be silently backfilled.

## Delivery, inbox and navigation

The existing delivery worker remains responsible for durable retries and active Officer selection. It checks proposal owner/Observation ownership and Plant/species visibility, excluding the submitter. Authorized historical notices remain visible after approval, rejection or cancellation. Their presence never grants review eligibility.

Inbox list, count and acknowledgement share proposal authorization. Only the proposal ID and exact notified revision are projected; arbitrary metadata is not exposed. The bell supports submitted and resubmitted proposal notifications and validates authoritative `/api/data/observation-edits/:id` detail before routing to Observation Review: route name `conservation-observations`, query `observationEdit=<actual-proposal-id>`. Newer revisions are read from the backend; older or mismatched detail fails closed. Completed proposals open the existing read-only detail behavior. Unavailable detail is not acknowledged. Clicks never submit a decision.

Dashboard proposal preview links use the same destination and actual proposal ID. Old Review Submissions bookmarks carrying `observationEdit` redirect to Observation Review on initial load and subsequent query navigation. Observation Edit Requests appear in a separate proposal section there, not under New Plant Registrations; their counts are separate from canonical Observations. Both initial-registration and subsequent-field Approved baselines use this proposal route. Source and isolated tests verify this wiring, not real browser navigation or deployed runtime compatibility.

Polling remains the existing 15-second foreground bell refresh and 30-second delivery loop. No new realtime subscription is installed.

## Reconciliation

There is no automatic historical backfill. `createObservationEditNotificationReconciliation` in `observation-edit-notifications.cjs` exposes read-only `preview()` and opt-in `runOnce()`. It is not enabled or scheduled at startup. An explicit UTC `lowerBound`, bounded batch (1-50) and `enabled: true` are required for writes. It recovers only missing events with immutable, annotated evidence matching the current Pending proposal revision. Legacy unannotated events, earlier correction revisions and terminal requests are excluded. No historical correction evidence is inferred. Inspect previews and establish a separately approved operational policy before using this facility; it does not replace durable outbox retry delivery.

## Rollout order and reported schema state

1. Review the migration, isolated rehearsal and database backup/rollback plan.
2. Coordinate the shared schema and release window with Jia Ning.
3. Confirm the target's migration state. The operator reports shared Supabase already has notification-only 030; do not blindly reapply it. For other environments, apply the exact migration only through a separately authorized rollout.
4. Deploy compatible backend and verify event creation/delivery health.
5. Deploy Officer Web and verify exact-ID navigation and unread/read behavior.
6. Rehearse new proposals and correction rounds for both origins with authorized accounts.

Do not deploy an old Web parser against newly delivered event types; coordinate the backend/Web release to avoid a mixed-contract window. Older backend inbox projections also cannot correctly interpret new resource rows. This requires a coordinated release, not arbitrary rolling downgrade.

A rollback should preserve the additive schema, events and evidence. Disable delivery of the new types / maintain compatible inbox projections before reverting producers. Do not drop columns or delete historical notifications to roll back a release.

## Validation limits

Tests use isolated PGlite and mocked sessions/directory responses, not shared Supabase. Multi-connection PostgreSQL lock timing, live account/visibility configuration and real browser delivery require a deployment rehearsal. Live end-to-end notification delivery remains unverified, as do current backend processes and deployed Officer Web compatibility. The four operator-reported structural checks establish neither delivery readiness nor full Observation versioning. Full subsequent Pending Observation V1 -> V2 -> V3 history still requires coordinated Mobile/backend work; notification-only 030 does not provide it. No operational deployment or shared migration is performed by these tests or this documentation update.
