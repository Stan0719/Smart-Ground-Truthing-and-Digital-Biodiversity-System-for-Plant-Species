# Sensor ranges and alert snapshots — team review required

Implementation is prepared. Migration `034-sensor-alert-evidence.sql` must be
reviewed with the team before it is applied to an application database. No code
path applies it automatically. Tests install it only in disposable PGlite databases.

## Proposed database change

Add nullable `sensor_evidence JSONB` to canonical `plant_app.threat_alert_history`,
with a shape/identity constraint and an update trigger protecting saved evidence
and its associated alert identity, metric, value and timestamps. Status changes
and the existing response workflow remain available. Existing rows stay null;
no historical Plant assignment or threshold is guessed or backfilled.

Snapshots contain version, device ID, Plant ID at detection (or explicit null),
triggering metric/value, configured min/max, low/high direction, the incoming
packet's implemented measurements, optional sensor capture time and server
receipt time. Capture time is null when the device did not provide it.

Only packets that create an alert receive a snapshot. Multiple metric violations
produce separate alerts using the same packet values. Ordinary samples continue
through the live memory cache and ten-minute aggregates/checkpoints. Snapshots
are never inserted as raw `sensor_reading` rows or included in aggregate queries,
so reports do not double-count them.

## API and compatibility

The existing device `thresholds` JSONB supports both legacy numeric maxima and
`{ "min": 20, "max": 35 }` ranges. Either bound can be omitted. Both bounds are
inclusive: alerts occur strictly below minimum or strictly above maximum.

`PATCH /api/devices/:id/thresholds` merges only the supplied metric keys under a
device row lock. A metric object replaces that metric's range; `null` disables
that metric, and omitted metrics are retained. The Admin form sends only the
selected metric. Camera devices cannot configure environmental thresholds.
Ingestion locks the same device row and reads its latest saved configuration.

Before 034 is installed, legacy numeric maxima remain operational without new
snapshots. Range configuration returns 503 instead of promising evidence that
cannot be saved. Once 034 is installed, new numeric-maximum and range alerts both
receive snapshots. Legacy boolean active states are read as active high states;
new durable states distinguish low/high and suppress continuous repeats. A
normal sample re-arms the metric, and high-to-low transitions create a new alert.
Retry identities, receipts and sample counts retain their existing behaviour.

Exact alert context adds validated `plant_at_detection`, `historical_threshold`
and `reading.basis = 'alert_snapshot'` for new evidence. The raw reading reference
remains null. Legacy linked raw evidence and current-assignment APIs are retained.
Officer details distinguish saved Plant/limits from current assignment and show
Unavailable for old alerts. Existing v1 report `temperatureThreshold` remains the
configured maximum, including when the device uses a range.

Officer latest-reading responses also include current thresholds. Refreshing
readings updates those limits without replacing inventory/status/camera state.
Fixed soil and surface descriptions remain descriptive; low/high alert status is
shown separately using the Admin settings. Live report cards remain transient.

## Review and activation

Confirm the deployed canonical schema and existing migrations 031 and 033, and
review backup, writer privileges and the migration ledger with the team. Existing
notification migration 032 and its prerequisites are still required for notices;
034 does not replace, replay or modify those migrations or Camera ingestion.

After approval, rehearse the exact SQL against an isolated copy, then apply it
once through the team's database deployment process. Deploy the backend and
frontend together and verify an actual device, Officer inbox and exact alert.
Do not drop the evidence column during rollback: that would destroy saved history.
An older backend cannot evaluate object ranges, so any application rollback must
include a reviewed threshold-compatibility plan.

## Verification

Backend tests cover registration, independently saved limits, boundary/normal
values, simultaneous violations, repeats/retries, direction changes, evidence
immutability, later configuration/Plant reassignment, old records, Camera
isolation and sample-weighted report totals without raw-row writes. The combined
Sensor/Camera notification test installs 034 alongside the existing notification
chain and verifies per-alert notices remain atomic and deduplicated.

Frontend tests cover legacy limits, optional bounds, zero, disabled thresholds,
range status, refreshed configuration, strict snapshot validation, localized
labels and saved alert detail rendering. Physical-device/deployed verification
and applying 034 are separate team deployment steps.
