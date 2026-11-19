# Observation-edit reviews with Migration 029 and notification-only Migration 030

POST /api/observation-edits/:id/review accepts only decision, comment and revision.
The revision field is mandatory in every schema mode. It must be a positive JSON
safe integer matching the proposal revision returned by detail/list reads; it is
not the canonical Observation revision or a history ordinal. Missing, null,
string, fractional, nonpositive and unsafe values return HTTP 400. Supported
decisions remain Approved, Rejected and Correction Required; Flagged is unsupported.

A mismatched revision returns HTTP 409 without applying the review. Existing
permission/self-review/status checks, row locks and approved-baseline fingerprint
validation remain in force. The client must reload and inspect authoritative
proposal detail after a conflict, preserve its draft where appropriate, and obtain
another explicit decision. Never automatically retry using a newer revision.
Correction resubmission increments the request revision, so earlier review forms
cannot decide the corrected round.

The existing Mobile RecordChangeReview caller sends selected.revision. Conservation
Officer Web now integrates Observation Edit Request review under Observation Review
(`conservation-observations`), in a separate proposal section rather than New Plant
Registrations / Review Submissions. Approved baselines from both initial
registrations and subsequent field Observations can have separate edit proposals.
Proposal IDs, revisions and counts remain distinct from canonical Observations.
The Web sends the selected proposal's exact positive revision. External clients
that omitted revision must be updated; no compatibility default is safe.

The Web compares the Approved baseline with the proposal and displays available
photos and edit history. After HTTP 409, authoritative readback preserves the
comment and requires inspection before another eligible Pending Review decision.
It never automatically retries a decision. If POST succeeds but the following GET
fails, saved-but-unverified recovery blocks further decisions and preserves the
draft; Retry Reload performs GET only, never a second POST.

With only the Observation prerequisites through Migration 029, basic edit
capability is available while versioning_available remains false. Existing
legacy proposal, correction, cancellation, approval and history paths operate;
advanced schema-readiness checks remain intact. Notification-only Migration 030
is implemented separately and does not enable advanced Observation versioning.
According to operator-reported checks, it has been applied to shared Supabase:
`staff_notification_event.observation_edit_request_id`,
`staff_notification_event.observation_edit_revision` and
`observation_edit_event.notification_revision` exist, and
`observation_edit_notification_evidence_guard` is enabled. These four reported
structural checks were not independently verified against shared Supabase here.
The abandoned advanced Observation-versioning migration is not being used.
Do not turn on advanced branches by bypassing their checks. A false advanced
capability does not mean the legacy edit API is unavailable.

The canonical Approved content remains unchanged while a proposal is pending or
rejected. Approval publishes it under the existing transaction and baseline
checks. Terminal proposals, including Cancelled and Withdrawn when returned, are
read-only in both decision controls and handlers. Genuine Superseded history is
also read-only and remains distinct from cancellation or withdrawal.

Observation photo replacement detaches removed assets rather than deleting their
bytes. Legacy historical-photo reads resolve captured IDs against owner/Plant
identity, independently of current attachment membership. The regression fixture
verifies the original bytes after replacement. No physical plant_asset deletion
route was found in the inspected Observation paths, so no new deletion mechanism
or retention schema is introduced. This is application behavior, not a database
foreign-key retention guarantee; direct SQL, external cleanup and absent old bytes
remain outside that guarantee. Missing historical evidence is not reconstructed.

The 029-only legacy path does not promise immutable snapshots of every correction
round or exact relational review-to-submission-version evidence. Advanced version
IDs/photos that cannot be resolved return controlled unavailability, not invented
snapshots. Approval captures from the separate Migration 028 repair remain in
record_version_history and are not submitted Observation versions.

Genuine initial-registration snapshots can be displayed through the supported
record_version_history contract. Full subsequent Pending Observation V1 -> V2 -> V3
history remains unsupported by the integrated workflow without coordinated
Mobile/backend submission, finalization and history-read support. Officer Web does
not invent snapshots, version IDs or original photos for that missing contract.

Review-contract tests use the existing in-memory PGlite fixture with the required
migrations through 029 and no additional advanced structures. Separate notification
tests exercise notification-only 030. PGlite verifies SQL/transaction behavior but
serializes clients; real multi-connection PostgreSQL lock timing requires a
separate disposable-server rehearsal. Source and isolated-test verification do not
certify real browser behavior, current backend processes, deployed Officer Web
compatibility or live notification delivery. Those remain unverified; the reported
schema checks alone do not establish deployment readiness or authorize a rollout.
