# Officer operational reports

The existing `GET /api/reports` and its period-only contract are unchanged.
New authenticated `GET /api/reports/observations`, `/api/reports/threats`, and
`/api/reports/iot` use the existing `reports.read` permission. Unknown categories
and unknown parameters return 400. No category permission grants are added.

All three use the existing pool and schema-scoped connection wrapper, with one
`REPEATABLE READ READ ONLY` transaction per request. They create no tables,
backfills, report history or saved report files. Missing source tables/columns
return 503. Other database failures remain failures, never empty reports.

## Period and counting definitions

`period=all-time|this-month|last-month|custom` reuses `report-period.cjs`.
Custom periods require `start=YYYY-MM-DD&end=YYYY-MM-DD`. Calendar boundaries
are in Asia/Kuala_Lumpur, inclusive start and exclusive midnight after end.

- Observations: `plant_observation.created_at`, with current status other than
  Draft. Initial-registration, subsequent and legacy origins are included once
  per stored observation. No joins to reviews or submission receipts, and no
  private content or owner/reviewer identities. This is creation-period reporting,
  not a review-decision history. Ranges of at most 120 days use Monday-start
  calendar weeks; longer ranges and all-time use calendar months. Five canonical
  non-draft statuses have separate counts, with their sum as the total.
- Threats: `threat_alert_history.created_at`, with current New/Reviewing/Resolved
  status. Group by stored `metric`. New and Reviewing are unresolved. Severity
  and canonical resolved-at timestamps do not exist, so no high/critical counts
  or invented resolution times are supplied. Plant/species labels use the current
  `iot_device.plant_id` relationship, explicitly labelled as current rather than
  historical incident relationships. No GPS, evidence URLs, responses or identities.
- IoT: `sensor_reading.created_at`, one selected device and measurement. Device
  options include devices with readings in the period; the first is selected
  by default. `device` and `measurement` are validated, parameterized filters.
  Full readings, including null for absent/non-numeric values, are ordered by
  timestamp and ID. Summary device count spans the period; reading count, latest
  time and min/mean/max refer to the selected device. Statistics omit nulls, retain
  genuine zero, and remain null when no numeric measurement exists.

Temperature is Celsius; humidity is percent. Soil moisture, rain and sound are
raw nonnegative sensor units, not calibrated percentages, millimetres or dB.
Movement is 0/1. Measurements and devices are never averaged together.

## Presentation and exports

One chart per report: status-stacked observation bars, horizontal incident metric
bars, or timestamp-based single-measurement IoT line. Explicit missing values
break the line. Because no fixed sampling cadence is stored, a documented visual
heuristic also breaks intervals longer than twice the median observed interval.
Min/max chart downsampling retains all gaps and adjacent points. All detailed
rows, totals and exports retain the full authoritative response without a
dashboard pagination cap.

CSV includes title, returned period, generation time, scope, statistics and all
rows, with BOM, escaping and formula neutralization. PDF uses browser Unicode
text rendering and paginated wrapped content plus the main chart. English, Malay
and Chinese labels are localized. Empty, loading or unavailable reports cannot
export. Species report calculations and its original exporters remain separate.

## Deployment and manual acceptance

No service is restarted by implementation or offline tests. An authorized future
deployment must load the new backend routes before the matching web interface is
used. Check each category/period with an Officer session, chart/table/export
agreement, Unicode PDFs, empty and missing-measurement cases, and desktop/tablet/
mobile layouts. Large all-time reports are uncapped; validate latency, memory and
download size against production volume before routine operational use.
