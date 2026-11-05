# Real Officer notifications

This extends N2 for Conservation Officers only. Administrator components, demo
data, authorization and the reported Administrator API issue are outside scope.
Migration 013 is reused unchanged; no new migration or dependency is required.

## Production wiring and transactions

The normal `node server.js` / `npm start` bootstrap constructs an Officer delivery
service, injects it into the two producer routes and starts its worker only after
the HTTP listener succeeds. Custom `createPlantApp` callers must explicitly inject
`officerNotifications`; the default library factory does not start background work.
This keeps isolated legacy fixtures and alternative compositions explicit.

Only these events are created:

- registration_submitted after atomic registration has written its immutable
  receipt, including existing-species and genuine new-species paths. One combined
  event includes a safe species-review-required boolean for a genuine proposal.
- field_observation_submitted after the standalone observation commits its
  Draft-to-Pending transition. Source identity includes observation ID and revision.

The Phase 2 effective classifier verifies origin inside the same transaction. No
event is inferred for unknown provenance, Draft creation, pending-record edits,
replayed registration receipts, repeated submit calls or failed transactions.
Event source keys are deterministic; event insert failure rolls back business
changes rather than silently committing an untracked submission. Deploy with the
verified 012/013 schema present in plant_app. Botanist notification logic is unchanged.

## Durable delivery

Every 30 seconds, at most 20 due events of the two Officer types are processed.
Committed events survive process crashes. Discovery reads only trusted auth users'
ID, role, status and must-change-password fields through auth.db; it does not read
names, email, passwords or session tokens. Existing Officer permission policy and
resource visibility apply. There is no assignment model. Self-review recipients
are excluded by the current observation owner subject.

Authentication and plant pools may be different databases. Recipient discovery is
not claimed to share the workflow transaction. Directory failures reject the pass,
leave durable events pending, log a generic diagnostic and retry on a later tick.
Each event is locked with FOR UPDATE SKIP LOCKED. All eligible recipient inserts
and the delivered transition commit together. A partial fan-out rolls back; a
separate safe retry-state update schedules another attempt in 60 seconds. Unique
event/recipient/role keys prevent duplicates. Missing resources or no eligible
Officers remain failed/retryable; they are never falsely marked delivered.

Recipients are determined at discovery time, not snapshotted at source submission.
An account change immediately afterward cannot be made atomic across independent
databases; the N2 API still rechecks current account role/status and resource
visibility on every read and acknowledgement. If no recipient is eligible, a later
eligible Officer may receive the pending event. Permanent failure cleanup, retention,
delivery metrics and exponential backoff are future operational work.

No producer writes Administrator events or consumes Administrator outbox entries.
The shared N2 list adds only an optional safe species_review_required field for
Officer registration events. Other role behavior and predicates remain unchanged.

## Officer bell

ConservationTopbarActions uses officerNotifications.ts and /api/data/staff-notifications.
It no longer imports the historical demo array or displays camera/sensor/threat
demonstrations. Existing popover dimensions and CSS are retained.

- Initial loading, accurate empty state, unavailable/error/retry feedback.
- All loaded items are shown, with continuation beyond the former five-item cap.
- Refresh on open; count refresh every 60 seconds only while visible, signed in,
  authorized and the popover is closed. Logout/inactive state stops polling.
- Immediate cache/cursor/count invalidation on account/session changes, including
  protection against late success and late 401/403 responses from the prior account.
- Persistent mark-one only AFTER fresh observation detail and successful navigation.
  Missing access or failed navigation does not mark read. Read failures remain
  explicit; uncertain mark-all invalidates its boundary until refreshed.
- Signed N2 boundaries and cursors remain backend-owned; expired cursors can reload.
- EN/MS/ZH-CN event, state and retry labels; localized actual timestamps; canonical
  observation identifier; unread text, Escape dismissal and focus return.

Current authoritative detail controls navigation: initial registration routes to
conservation-reviews with query.review set to the raw observation ID; subsequent
routes to the general conservation-observations queue. Unknown current origin
uses the existing Review Submissions legacy fallback. No exact-record query is
invented for Observations. A historical notice does not imply the record is still
Pending Review and never performs a review decision. Existing modal revision,
species-first, origin and permission safeguards remain authoritative.

The client intentionally supports only the two implemented event contracts.
Enabling additional Officer event types requires coordinated presentation support.
Single-instance cursor-key limitations from N2 remain unchanged.

## Validation and deployment

Automated verification uses only disposable PGlite fixtures and frontend mocks.
It never starts the production worker, submits production records, accesses live
Supabase, changes Administrator UI, or restarts existing services.

The Plant API must be restarted/deployed by the operator to load these source
changes; this implementation does not perform that step. Frontend must receive
the corresponding build/HMR changes. Do not claim live delivery until an authorized
operator verifies an actual legitimate committed submission, its single event,
eligible recipient delivery, UI navigation and persisted read state. Do not create
fake production notices solely for verification.

Manual checks still needed: genuine proposal species-first wording, field queue
landing, retry during directory/API failure, both role/account boundaries, mobile
popover/keyboard behavior and all languages. Real-browser responsive behavior is
not established by source-layout tests alone.
