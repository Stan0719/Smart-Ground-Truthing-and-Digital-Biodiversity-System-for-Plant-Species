# Officer notification completion: implemented paths and blocked detection

## Standalone requests (migration 013 reused)

POST /api/species-requests enqueues species_request_submitted after its new Pending
Review insert/audit in the same transaction. Idempotent replay returns before enqueue.
Source key: officer:species_request_submitted:<INTEGER request ID>. The combined
plant-submissions producer is unchanged and does not call this hook.

The existing delivery worker handles this resource with species.manage, current
active Officer eligibility and self-review exclusion. Existing API visibility for
species requests is already based on species.manage; no role grants are added.
Only generic localized wording and the request reference are exposed in the inbox.

conservation-reviews?speciesRequest=<full ID> loads GET /api/species-requests/:id
and reuses the existing species-request panel with separate selection state. No
observation/plant is fabricated. Plant decisions/QR/history are absent in this mode.
Approval visibility, correction/rejection comments, self-review, current Pending
Review state, conflict reload and uncertain-write protection remain mandatory.
The existing endpoint does not offer content-version compare-and-swap: the frontend
rechecks current data/status, but cannot add a stronger concurrency contract alone.
Original plant-registration review paths remain unchanged. Notification acknowledgements
remain in the bell service, never destination-page mount.

## Subsequent correction resubmissions (migration 013 reused)

The locked Draft-to-Pending submit transaction classifies authoritative observation
origin, reads the newest two observation_review entries with database-precision
created_at ordering, and checks the newest review precedes the edited draft, has a
real non-owner reviewer and has a consistent positive revision. Tied latest review
timestamps or inconsistent evidence suppress notification classification; they do
not change submission business behavior or guess an ordinary notification.

No reviews means ordinary first submission. Latest Rejected/Approved/Flagged is
not a correction. A latest Correction Required review emits observation_resubmitted
with source key officer:field_correction:<observation ID>:<review ID>. Metadata records
submitted_revision and correction_review_id. Later review IDs distinguish cycles.
Pending submit retries return before enqueue. Correction and ordinary notification
branches are mutually exclusive. Draft edits never enqueue. Initial-registration
correction handling is unchanged. Failure to insert an outbox event rolls back the
submit, using the existing transaction and pool. Exact destination remains
conservation-observations?observation=<full original ID>.

Historical missing/deleted review evidence cannot reconstruct facts; there is no
backfill or reconciliation. Ambiguous suppression should be reviewed operationally
before any separately authorized historical recovery.

## Possible poaching: BLOCKED, no producer or activation

The only camera activity examples found are explicitly frontend fixtures in
web/src/data/cameraMonitoringPrototype.ts. Backend iot.cjs ingests authenticated
Sensor readings and generates configured metric-threshold alerts; it rejects Camera
devices on that ingestion path. These readings must never be relabelled as poaching.
The separate public.threat_alert reader is not an authoritative detection producer.

An authorized detector must first have an approved identity, source/version contract,
stable detection ID, validated suspected-poaching classification and evidence linkage,
replay protection and resource authorization. Its alert and outbox event must then
commit together. Use suspected language only; do not infer confirmed crime.

proposals/possible-poaching-notifications.draft.sql is an unapplied storage proposal,
not a numbered migration or startup script. It adds a TEXT threat FK, dedicated
possible_poaching_detected contract, immutable provenance strings and unique source/
detection identity. It preserves existing event contracts, read-state triggers and
RLS/grants. It does not prove provenance authenticity and permits NULL references
for source deletion; future readers must hide unavailable resources. No code produces,
delivers, renders or activates this event yet.

Before application: verify live source/schema identity, exact current constraint names,
backup and restore procedure, lock budget and compatibility with all current readers.
The draft deliberately fails on a prior/partial install. It uses one transaction and
plant_app-local search path. Never rerun automatically. Offline fixtures validate
legacy-event survival, provenance checks, deduplication, FKs, immutability, deletion
and unchanged RLS. No live compatibility or deployment is claimed.

Rollback: before commit, transaction rollback leaves the old schema. After commit,
disable the future producer first; keep additive schema/history for compatible old
readers. Do not drop the FK/column or delete events as a runtime rollback. Any structural
rollback requires separate review of retained threat events, a verified backup and
restoration of the previous guard/constraints. No automatic destructive rollback is
provided. A future authorized GET /api/alerts/:id with alerts.read and response history
is also required: existing ?alert=<full ID> only searches 500 loaded alerts. Match
list/count/read/read-all visibility and require responses.manage for investigation.

## Safety and verification

All tests use mocks or disposable PGlite, no live database. No existing process is
restarted, no real notification is acknowledged, no detector is enabled and no
migration is applied. A deployment and real browser validation remain separately
required: direct and mounted routes, EN/MS/ZH text, keyboard focus, mobile scrolling,
recipient isolation and a genuine authorized business event/read acknowledgement.
