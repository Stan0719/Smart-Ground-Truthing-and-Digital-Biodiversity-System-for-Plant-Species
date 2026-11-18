# IoT summary API v1

Backend: `GET /api/reports/iot-summary`. The existing Vite development proxy
rewrites `/api/data/reports/iot-summary` to that backend path. Production must
preserve the equivalent authenticated proxy routing; no production proxy change
is included here. Register the literal route before `/api/reports/:category`.

Uses the existing identity middleware and `reports.read` permission. No ingestion,
schema, migration, old reporting contract or Officer UI changes are required.

## Request

Required strings: `contractVersion=1`, `device=<canonical device ID>`.
Optional: `measurement` (defaults to `temperature`), `period` (defaults to
`all-time`), `interval=auto|hour|day|week` (defaults to `auto`).
The other measurement keys are `humidity`, `soilMoisture`, `rainfall`, `sound`,
and `movement`. Custom periods require `start` and `end` as inclusive local
calendar dates; other periods reject these dates. Existing `this-month` and
`last-month` meanings are preserved. Unknown/repeated parameters are rejected.

Example: `/api/reports/iot-summary?contractVersion=1&device=DEVICE_ID&period=custom&start=2026-11-01&end=2026-11-07`.

## Response and counting

Returns `contractVersion`, `category`, `generatedAt`, device identity, measurement
key/unit, `scope`, `aggregation`, `summary`, `observedSpan`, ordered `buckets`,
limitation codes and `complete: true`. Scope identifies receipt-time basis
`sensor_reading.created_at`, Malaysia timezone, requested and effective bounds.
All timestamp values are UTC ISO timestamps. Custom bounds are start-inclusive,
next-day-end-exclusive. All Time keeps requested bounds null, derives effective
local-day bounds from all retained readings and never truncates to recent data.

Summary and buckets contain `receivedRows`, `validMeasurements`,
`missingMeasurements`, `absentOrNullMeasurements`, `invalidMeasurements`,
`average`, `minimum`, `maximum`. Missing means unavailable values in RECEIVED
rows: absent/null plus invalid JSON values, not packets that never arrived.
For the five non-Movement measurements, only finite representable JSON numbers
are valid; strings are not coerced. Zero and negative values remain valid for
those existing reporting classifications. Statistics are sample-weighted using
PostgreSQL numeric aggregates, not means of bucket means. Empty statistics are
null. Counts are zero for empty buckets. No physical calibration or availability
is inferred. Soil moisture, rainfall and sound retain raw units; movement uses
0/1 and its mean is a sample fraction, not duration.

For `measurement=movement`, only numeric JSON 0 and 1 are valid. Absent/null
values count as absent; every other present value (including nonbinary numbers,
strings, booleans, arrays and objects) counts as invalid. No stored data is
changed or coerced. Overall summary and every bucket additionally return exact
integer `detectedSampleCount` (numeric 1) and `noMovementSampleCount` (numeric 0),
calculated with PostgreSQL filtered counts, never reconstructed from averages.
`validMeasurements = detectedSampleCount + noMovementSampleCount`;
`receivedRows = validMeasurements + missingMeasurements`;
`missingMeasurements = absentOrNullMeasurements + invalidMeasurements`.
Empty buckets have zero counts and null average/minimum/maximum. Legacy
average/minimum/maximum remain present and use valid binary samples only.
The additive count fields retain contract version 1; the existing Officer web
validator accepts additional fields. Other measurement response fields remain
unchanged. A detected sample is not a unique movement event, person, animal,
threat or duration. Phase B Movement UI is not included in this backend change.

Observed span reports first/last received and first/last valid timestamps.
An existing device with no readings returns HTTP 200; All Time has no buckets,
while explicit periods include empty buckets. Unknown devices return 404.

## Buckets and limits

Automatic: up to 7 days hourly, up to 366 days daily, otherwise weekly.
Weekly boundaries start Monday Malaysia midnight; edge buckets are clipped.
Automatic weekly steps increase as needed to return at most 520 buckets.
Explicit intervals exceeding the cap return 422, not partial data. Request
calendar validation uses the existing maximum 100 years; effective spans over
36,600 days are rejected. Response JSON is limited to 1 MiB and non-safe counts
or non-finite output cause failure, not a misleading complete response.

Errors are `{error:{code,message}}`: invalid requests 400, missing device 404,
bucket/range/response limits 422, source failure/numeric range/timeout 503.
Existing authentication failures retain the application's 401/403 behavior.
SQL details are not exposed. Transactions roll back and release on failure.

## Performance and deployment

SQL aggregates JSONB in PostgreSQL; Node receives totals and at most 520 buckets,
never raw readings. The existing `(device_id, created_at DESC)` index supports
the range predicate. Actual deployed indexes/plans have not been checked.
There are two aggregate scans within one repeatable-read, read-only transaction.
Each statement has a 15-second timeout; this is not a total request deadline.
All Time can still be expensive despite bounded output. No rollups, new indexes,
rate/concurrency limiter or driver-level disconnect cancellation are introduced.
A disconnected request can continue until its statements complete/time out.
Measure representative isolated datasets before broad All Time usage; database
plans, production load and proxy timeout budgets require deployment review.

Deploy/restart the backend through the normal reviewed process. No migration is
required. The Officer UI continues using the existing report endpoint until a
separately approved phase. Raw CSV export is outside this implementation.

Tests use the repository's in-memory PGlite PostgreSQL fixture and loopback HTTP,
not Supabase or production. Run from the backend directory:

`node --test --test-isolation=none test/iot-summary-report.test.cjs test/operational-reports.test.cjs`
