# Officer notifications: Phase 2 scope and deployment review

## Implemented: returned initial-registration corrections

The existing PATCH /api/my-plants/:id transaction passes its locked observation's
pre-edit status and revision to enqueueCorrection after the existing save, version
snapshot and audit writes. Only Correction Required -> Pending Review with exactly
one revision increment and authoritative initial_registration provenance emits an
event. Pending edits, Draft saves, rejected edits, unknown provenance and subsequent
observations do not emit correction events through this hook.

The existing migration 013 observation_resubmitted/observation contract is reused.
Source key: officer:observation_resubmitted:<full observation ID>:<new revision>.
A stale retry fails existing revision validation; enqueue replay is also protected
by source_key uniqueness. A later returned correction has a distinct revision.
Outbox insertion is in the business transaction: enqueue failure rolls back the
correction. Recipient delivery uses the existing worker, permissions, visibility,
self-review exclusion, retry and event/recipient uniqueness. No new pool/scheduler.

The client recognizes this event, localizes its title/message and re-reads the
observation before navigating. Initial registration uses conservation-reviews with
query.review containing the full ID. Existing subsequent routes and Phase 1 error
recovery are unchanged. Destination mount never acknowledges a notification.

## Blocked: standalone species requests

species-requests.cjs has an atomic POST /api/species-requests, Pending Review default,
idempotent client key, and authorized GET /api/species-requests/:id. Migration 013
already permits species_request_submitted and the INTEGER species_request_id FK.
However the Officer UI reviews species requests only through a linked observation
in ReviewSubmissionsView. The router has no standalone species-request review
interface. Do not invent a linked observation or route to an unrelated registration.
A standalone authorized review interface/navigation contract is required before
adding the producer and resource-aware delivery/client support. Combined registration
notifications remain unchanged; do not emit a second event for that path.

## Blocked: other correction workflows

The observation PATCH resets content to Draft and increments revision; the following
submit sees only Draft. Its audit action observation_resubmitted is written on edits,
so that label alone cannot establish a genuine returned-correction transition.
A durable relation between the prior Correction Required decision, draft revision
and next submit is required. Do not classify ordinary Draft submissions as corrections.
Species corrections have version history but lack a standalone Officer destination.
Approved record-change submissions are a separate contract, not correction retries.

## Blocked: threat alerts; separate schema proposal, not an executable migration

IoT ingestion already creates durable threat_alert_history records transactionally
when configured device metric thresholds are exceeded. The model uses New, Reviewing,
Resolved; it has no high/critical severity field. Routine readings are not alerts.
Migration 013 has neither a threat resource kind nor a threat FK/event contract.
Do not overload observation/species references or ship an unsupported client label.

A separately reviewed follow-on migration would need an additive nullable TEXT
threat-alert FK matching threat_alert_history.id, a threat resource kind and dedicated
event type, reference-shape CHECK constraints, immutable-reference trigger updates,
and deliberate deleted-resource behavior. Existing event contracts must be preserved.
Before producing executable SQL, agree resource authorization and exact-alert UI
lookup/navigation contracts; then add matching shared list/count/read predicates,
delivery visibility and a transactional hook at actual alert INSERT. No polling-based
generator, thresholds, RLS/grant changes or historical backfill are proposed here.
No migration file was altered or executed.

## Verification and operational limits

Offline tests use only mocked frontend requests and disposable PGlite fixtures.
No existing server is restarted, no live notification is generated/acknowledged,
and no environment or activation setting changes. Live serving code and schema
installation are not established by offline success. A separately authorized deploy
is needed; verify a genuine correction's single event/delivery, full-ID destination,
read persistence, EN/MS/ZH rendering, keyboard focus and narrow-screen layout.
Existing first-read/mark-all boundaries and polling intervals remain unchanged.
