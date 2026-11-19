# Officer Observation workflow and merged backend contract

## Current Officer Web

Observations displays canonical Observation records, identifiers, observer names,
creation dates and current review status. Details presents the current returned
fields and evidence, not an approval-time snapshot browser. Review history is a
read-only list of decisions, comments, reviewers and times; missing historical
fields or photos must not be filled from current mutable values.

Review Submissions retains the existing registration, new Species request, Plant
Edit and Species Edit workflows. Reviewed By resolves the actual completed
review's Officer display name; pending submission rounds must not inherit an
older reviewer. Copy controls preserve full identifiers and use temporary,
control-specific confirmation. Observation Edit is not yet a separate normalized
Officer table category.

Observation decisions send the canonical Observation ID and expected revision.
Species decisions retain expected revision/review-cycle and explicit approval
visibility. Record-change decisions send the exact proposal revision. Backend
permissions, eligibility, current-version checks and HTTP 409 responses remain
authoritative; a visible badge alone never establishes review eligibility.

Conflict recovery reads authoritative detail without automatically retrying the
POST. Changed pending data requires inspection where applicable. Unsaved review
comments survive recoverable refreshes; stale visibility choices are cleared.
Late results are ignored after route/session/request changes or disposal. Saving
cleanup belongs to its request token, even if navigation invalidates the result.
Actual session invalidation clears private review state. Temporary verification
unavailability blocks decisions while preserving appropriate drafts; the shared
session UI retains Retry / Sign out rather than automatically logging out.

## Merged backend source now present

The checkout includes Observation edit requests, correction/cancellation and
withdrawal endpoints, edit history, submission-version helpers and owner-scoped
reads. These are no longer merely proposed backend features. Mobile has newer
Observation workflows; their presence does not prove complete Officer Web UI
integration or database deployment.

Migrations 021?027 introduce edit/review-event and withdrawal structures.
Migration 028 adds exact record-change revisions and immutable history snapshots.
Migration 029 introduces Observation submission-version structures/constraints;
it does not reconstruct all legacy history. No migration is run by the web UI.

The backup audit identified a compatibility risk between Migration 028 snapshot
immutability and approval capture updating an existing history snapshot. This
frontend recovery does not resolve or verify that backend/database path.

## Migration 030 and remaining integration work

No Migration 030 SQL is included in this checkout. Current backend source checks
for exact version/request-revision review evidence and historical photo linkage,
including observation_submission_photo, and gates paths requiring that contract.
These checks are not evidence that Migration 030 is deployed or operational.

Before adding Observation Edit review to Officer Web, verify capabilities and
agree on explicit Observation/proposal/version identities, exact revisions,
immutable approved baseline/proposed fields/photos, latest eligible Pending Review
selection, completed-review associations and correction/withdrawal permissions.
Earlier Approved review outcomes and Superseded version lifecycle are different
concepts. Superseded/historical versions must remain read-only; pending or rejected
proposals must not replace the current approved published record.

Required integration tests include multiple observers on one Plant, stale and
superseded decisions, correction/withdrawal races, exact historical photos,
partial legacy evidence, Flagged follow-up history consistency, notification
targets and all supported locales. Deployment, migrations, data repair and
historical reconstruction require separate verification. Nothing in this document
claims live database readiness or authorizes those operations.
