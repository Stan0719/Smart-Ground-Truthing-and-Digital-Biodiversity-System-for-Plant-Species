# Officer notification reconciliation foundation

## Inactive by construction

`officer-notification-reconciliation.cjs` creates no pools, loads no environment,
and is not imported or started by `server.js`. Importing it does nothing.
`config.enabled` defaults to false; only the boolean `true` enables writes.
There is no browser endpoint, command-line runner, migration, or automatic backfill.
Plant 18 is not hardcoded or recovered by this change.

## Explicit API

`createOfficerNotificationReconciliation({pool, officerNotifications, config, onFailure})`
uses the existing schema-scoped Plant pool and the existing delivery service.
Config: `enabled` (false), `lowerBound` (required explicit UTC timestamp),
`batchSize` (20, allowed 1–50), `intervalMs` (60000, minimum 60000).
Do not supply an arbitrary early historical boundary. Preview also requires a boundary.

- `preview({after})`: repeatable-read **READ ONLY** transaction, bounded results,
  cursor `{at,id}` or null. Outputs observation ID, effective origin, revision,
  source key, event-exists flag, exclusion flag and reason. No account information,
  receipt content, metadata, token, or recipient details are returned. Only pending
  records inside the scan window are examined; this is not a full historical audit.
- `runOnce()`: disabled is a no-op. Enabled calls share one in-flight promise.
  It scans one batch; repeatedly call to progress and begin another bounded sweep.
- `start()`: optional conservative delayed scheduler, exponential failure backoff
  capped at 30 minutes. No immediate sweep. Failure callback receives only
  `OFFICER_RECONCILIATION_UNAVAILABLE`, never driver messages.
- `stop()`: cancels scheduled work and awaits the current pass. No process control.

## Eligibility and boundaries

Current Pending Review, positive revision, and authoritative effective-origin
classification are mandatory. Unknown or ambiguous provenance is excluded.
Initial registrations need the classifier's unique valid receipt relationship;
receipt creation must be at or after lowerBound. Species-request dependency is
recovered from that receipt only after validation of the linked request.

Standalone observations additionally require **distinct** `business_audit` records
for creation and pending submission, matching the owner, observation ID and exact
creation/submission timestamps. Both currently use `observation_submitted`.
The pending submission must fall within policy. Incomplete legacy evidence fails
closed; the module does not guess from raw origin, plant approval or row order.
This intentionally conservative policy can omit older deployments with different
audit conventions; preview exclusions must be reviewed before activation.

Scanning uses `(updated_at,id)` keysets with microsecond precision and a fixed
upper timestamp per write sweep. Full sweeps repeat to catch late commits and
recent submissions of older drafts. The lower boundary never moves backwards.
Boundary-excluded records are not repaired automatically. A short rolling window
cannot guarantee recovery of arbitrarily old missing events.

## Transaction and delivery safety

Each write batch takes transaction advisory lock `(193701,3)`; busy instances skip.
Rows are locked with SKIP LOCKED; status, revision and timestamp are compared with
the scan before classification is checked again. Each statement has a 5-second
timeout and a 1-second lock timeout. Failed batches roll back, release the client,
and retain the previous scan cursor. Small batches bound locks and query volume.
Review query plans at production volume before activation: existing classification
performs receipt/relationship lookups; no supporting indexes are added here.

The event identity helper is shared with the normal producer. Initial keys use
`officer:registration_submitted:<id>`; standalone keys use
`officer:field_observation_submitted:<id>:<revision>`. Existing events of any delivery
state are skipped; source-key uniqueness handles races with normal producers.
Only existing `enqueue` creates outbox events. Recipient uniqueness, active Officer
eligibility, permissions, visibility, self-review exclusion and retry delivery
remain the existing worker's responsibility. No recipient or read-state writes
are made here. Delivered events are never requeued. Botanist/Admin behavior is
unchanged. Existing alerts remain history after subsequent review decisions;
review authorization and species-first gates continue at the destination.

## Later activation (separate authorized task)

1. Confirm the actual serving checkout/database schema and resolve deployment
   identity; this foundation does not identify which host accepted Plant 18.
2. Choose and approve a narrow UTC lowerBound and recovery scope. Run preview
   with `enabled:false` using the existing pool, paging until the cursor is null.
   Review unknown/provenance exclusions, species dependencies and query cost.
3. Add reviewed startup/shutdown wiring for this module, using the same pool
   and delivery instance. Add explicit configuration; no environment values were
   introduced or enabled in this task. Connect `stop()` before pool closure.
4. Authorize deployment/restart separately. Enable conservative batches only after
   preview approval. No migration is required for the current foundation; any
   performance indexes must be proposed and reviewed independently.
5. Monitor sanitized failures, pool pressure, candidate volume and event delivery.
   Verify genuine authorized inbox behavior without inventing test submissions.
   Disable scheduling to halt future reconciliation; do not delete or reset inbox
   rows/read state. Broad historical or targeted Plant 18 recovery needs explicit
   authorization. No live delivery is verified by isolated tests.
