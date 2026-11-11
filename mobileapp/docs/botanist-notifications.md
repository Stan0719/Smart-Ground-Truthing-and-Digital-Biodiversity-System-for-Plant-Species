# Botanist in-app notifications

## Implemented without backend changes

The bell opens a native-stack Notifications screen, with a back button, unread styling,
mark-all-read action, pull-to-refresh, and loading/error/empty states. Notifications
refresh on screen focus and foreground return; there is no notification polling timer.

`GET /api/observations` already returns observations owned by the authenticated Botanist,
subject to species visibility. It includes the latest `review_decision`, `review_comment`,
and `reviewed_at` from `observation_review`. The mobile client also checks
`owner_subject === staff:<verified account ID>` and passes `expectedAccountId` to the
existing authenticated API client.

The frontend observes these real events:

- Pending Review: Observation Submitted, using the server's `updated_at`.
- Approved review: Observation Approved.
- Rejected review: Observation Rejected.
- Correction Required review: Correction Requested, with Officer feedback when available.
- Actual `syncDrafts` failure: Synchronization Failed, once per draft key.
- Actual nonempty successful sync batch: Synchronization Completed, once per set of removed draft keys.

A Draft alone is not a successful submission. `Flagged` is not relabelled as Rejected.
The legacy mock-based AddObservation screen does not create real notifications.

Observed event references, timestamps, sync counts/draft references, and read flags
persist in AsyncStorage, namespaced by backend URL and account ID. Officer comments,
field notes, tokens, and credentials are not written to this cache. Cached metadata
is accessible through the notification service only after verifying the same Botanist
account, including the existing time-limited offline authorization when available.
Read state survives restarts on the same device; it does not synchronize across devices.
Changing the backend URL creates a separate cache.

Event IDs include the observation ID, review decision, and server review time (or the
confirmed pending-submission time). Refresh merges by ID and preserves read flags and
previously observed history. Per-account storage operations are serialized. Failed or
malformed responses do not erase history. Session changes prevent publishing/caching
the previous account's response. Private in-memory UI data is cleared when authorization
cannot be established.

Opening an observation fetches `/api/observations/:id` and checks ownership again.
Correction/rejection notices open `FieldCollectionEdit` only when the current server
record is editable; otherwise the real read-only observation detail screen opens.
Missing, protected, deleted, offline, or inaccessible records produce an error message.
Sync-failure notices recover their actual saved draft when it still exists.

## Inspection evidence

Read-only live metadata inspection on 2026-11-02 found no notification-related tables.
`plant_app.observation_review` and `plant_app.business_audit` exist. No live records
were inserted, edited, or deleted during this task.

The backend currently exposes only the latest review per observation and at most 500
observations per request. Audit records are administrator-only, not a private Botanist
event feed. Some audit events named `observation_submitted` are also emitted when a
Draft is created, so they cannot alone prove successful submission. An Approved review
sets the parent plant to Approved, including approvals of later observations; the
current response does not identify first plant approval separately.

## Backend/database proposal — NOT implemented, approval required

For complete history and cross-device read state, add an application-schema
`botanist_notification` table through a separately reviewed migration:

- `id` UUID primary key.
- `recipient_subject` TEXT, assigned from the authenticated observation owner.
- `event_key` TEXT and `kind` TEXT with an explicit notification-type allowlist.
- Optional `observation_id`, `plant_id`, and `review_id` foreign keys to the configured
  application-schema tables, using `ON DELETE SET NULL` to retain event history.
- `created_at` TIMESTAMPTZ and nullable `read_at` TIMESTAMPTZ.
- `UNIQUE(recipient_subject, event_key)` for idempotency and an index on
  `(recipient_subject, created_at DESC, id DESC)`.

Add these authenticated, Botanist-only endpoints:

- `GET /api/notifications?cursor=...&limit=...`: newest first, cursor pagination,
  server unread count, and only `recipient_subject` matching the verified session.
- `PATCH /api/notifications/:id/read`: ownership-constrained, idempotent read update.
- `POST /api/notifications/read-all`: mark only the session owner's notifications read;
  use a captured cutoff so newly arriving events stay unread.

Do not accept a recipient account/role from request bodies or URL query parameters.
Keep direct client table access disabled. Apply existing species visibility and
observation ownership checks when returning feedback and resolving targets. No new
access to administrator audit APIs is needed; no change to authentication is proposed.

Insert submission/review notifications in the SAME database transaction as the
successful state transition. Record Plant Record Approved only when the parent plant
actually transitions from a nonapproved status to Approved; avoid also generating an
unnecessary duplicate approval notice for the same initial registration event.
Later observation approvals generate Observation Approved. Join the relevant review
row for Officer feedback instead of copying unrelated personal data.

Sync outcomes can remain device-local. If cross-device sync notices are desired,
separately approve a bounded authenticated event endpoint with validated event IDs;
client reports must not alter plant/review statuses or permissions.

Do not backfill production history, run this migration, or modify existing records
until approved. Historical backfill would need explicit rules because existing audit
event names do not distinguish every successful submission from draft creation.

## Verification and limits

Files changed: `App.js`, `screens/BotanistDashboard.js`, `utils/fieldSync.js`, and
`scripts/field-sync.test.mjs`. New files: `screens/BotanistNotifications.js`,
`screens/NotificationObservation.js`, `utils/botanistNotificationStore.js`,
`utils/botanistNotifications.js`, `utils/useBotanistNotifications.js`,
`scripts/botanist-notifications.test.mjs`, and this document.

Focused tests cover event mapping, sorting/deduplication, persistence across store
restart, role/account isolation, session changes, failed refreshes, offline cache,
backend namespaces, serialized read updates, and real sync outcome hooks. These tests
use synthetic in-memory fixtures and do not write to PostgreSQL.

Verification run: 19 notification/sync tests and 6 existing backend access/security
tests passed. The latter use the existing isolated PostgreSQL-compatible fixture,
not production data. Mobile lint, TypeScript checking, and Android JS bundle export
also passed. Database inspection covered live metadata only.

Full historical delivery, first Plant Record Approved notifications, and cross-device
read status remain pending backend approval. Events that occur and are superseded
before any client fetch can be missed by the current latest-review API. Physical
device UI/navigation, native offline synchronization, and live review workflows still
require device testing.
