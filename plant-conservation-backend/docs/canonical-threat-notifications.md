# Canonical Threat Alert notifications

## Deployment prerequisites (manual approval; not executed by this change)

Use the verified `plant_app.threat_alert_history` TEXT identity contract, never
`public.threat_alert` bigint IDs. Confirm the live columns/FKs, `iot_device.device_type`
values, notification checks/triggers, RLS and grants before deployment. Back up the
schema and data and rehearse the exact upgrade in isolated PostgreSQL.

Keep the teammate migration `031-iot-live-reading-aggregates.sql` unchanged and apply it before 032.
Apply `032-canonical-threat-officer-notifications.sql` only after 013 and the full
prerequisite chain for `030-observation-edit-officer-notifications.sql`. The latter
is distinct from the Botanist `030-record-change-review-notifications.sql`.
Do not replay either 030. `npm run migrate` does not install 032 automatically.
032 is a single transaction and is not intended to be replayed. It preserves
existing event types, RLS, role isolation and acknowledgement triggers. Check the
existing migration ledger/process before recording this separately applied file.

Roll out backend/Web support before enabling the trigger. Pre-032 deployments
continue to serve existing notification types and alerts; they do not promise IoT
notifications. Capability detection checks the new column and enabled trigger.
Verify the canonical writer's grants on the event table and trigger function: the
trigger is invoker-security, not a privilege-escalating SECURITY DEFINER function.
The supplied execute grant is to postgres, consistent with 013; separately review
any different service role and its RLS privileges before enabling ingestion.

## Identity and reliability

An AFTER INSERT trigger on **only** `plant_app.threat_alert_history` inserts one
event per newly inserted, classified canonical alert. It handles Sensor ingestion
and any authenticated external canonical Camera writer. It does not consume
`/camera-events`, register a Camera ingestion endpoint, invent Camera detections,
notify on status changes or scan/backfill historical alerts.

Six Sensor metrics require a Sensor device and no camera reference. Recognized
Camera categories require a Camera device or an explicit verified Camera reference
on a Sensor row. Unknown/mismatched source identities and nonfinite values remain
stored alerts but do not generate misleading Sensor/Camera notifications. The
backend/UI preserve the genuine metric/value, reading and camera references; no
severity, calibrated units, animal counts or incident counts are inferred.

The deterministic source key uses the canonical Alert ID's MD5 digest to stay
within the existing 200-character key bound; the original ID is retained in a FK
and a unique partial index. Recipient uniqueness remains the existing
`(event_id, recipient_subject, intended_role)` constraint. One reading can create
multiple independent metric alerts/events. A retry of the same persisted reading
uses existing ingestion receipts; it must not fabricate new alert identities.

Alert plus outbox event commit atomically. If event storage/permissions fail, the
alert transaction (and same-transaction reading) rolls back and the existing API
returns failure. There is no best-effort catch and no infinite retry loop in the
trigger. Operators must fix the prerequisite before producers retry; producers
should retain their existing bounded retry/client-key behavior. This deliberately
favors no silent notification loss over accepting an alert without durable evidence.
No migration means no trigger: pre-activation alerts are not backfilled later.

Existing 30-second delivery batches process 20 events with row locks and retry
state; directory/delivery failure leaves durable work pending/failed. Only active,
non-temporary-password Conservation Officers with `alerts.read` receive threat
notices. List/count/read/read-all recheck recipient identity, role, alert existence
and permission. Existing categories retain their previous eligibility. Deletion
of a notified canonical alert is RESTRICTed to preserve its event identity/history.

## Navigation and refresh

`GET /api/alerts/:id` (browser `/api/data/alerts/:id`) requires `alerts.read` and
selects the canonical plant_app row directly. It returns up to 500 responses for
that alert, with an explicit `history_capped` flag. It never changes alert status.
The bell verifies exact identity/status before navigation and marks only the
recipient's notice read after successful navigation. `conservation-alerts?alert=ID`
loads exact details even beyond the newest-500 list, including browser reloads.
404/deleted, malformed, inaccessible and unavailable lookups fail safely.

The existing bell cadence remains 15 seconds (already safer/faster than the
recommended 30); the existing Threat table cadence remains 30 seconds. Both pause
hidden/offline, refresh on foreground/reconnect and stop on session invalidation.
Opening the bell refreshes it. No duplicate poller or browser Realtime access is
introduced. Filters/notes remain local while background reads reconcile selected
records and require inspection of changed evidence. Exact old-alert response
readback is independent of the newest-500 window. Response history truncation is
explicit, not silently represented as complete.

## Verification boundaries

Tests use disposable PGlite and mocked browser/auth transports, including the real
013, 030 and 032 SQL, fresh prerequisite installation, existing-row upgrade,
no-backfill, atomic failure, identity/RLS preservation, all metrics, Camera inserts,
worker retry, deduplication, per-Officer read state and old-alert retrieval.
They do not establish real multi-connection PostgreSQL concurrency, shared Supabase
grants, deployed Camera producer persistence or actual browser/device delivery.
Those require separately authorized deployment rehearsal and UAT.
