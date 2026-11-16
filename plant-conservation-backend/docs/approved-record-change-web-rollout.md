# Approved-record change handoff

This change exposes existing record_change_submission proposals in Officer Review Submissions inside the original eight-column Review Submissions table, with Plant Edit and Species Edit badges. It does not create observations or change decision semantics, RBAC grants, upload concurrency or observation locking.

## Contracts and routing

The web uses /api/data/record-changes (the existing Plant API proxy), including detail, proposal photographs and /:id/review. Direct /api/record-changes is deliberately avoided because the development generic /api proxy targets authentication. The same /api/data convention must exist in deployment.

GET listing accepts optional status (Pending Review, Approved, Rejected), search (up to 200 characters), limit (1?500) and cursor (last proposal ID). It returns changes plus page.has_more and page.next_cursor. Ordering is created_at descending, id descending. Default remains 500 for existing mobile callers. The web exhausts both source cursors before global sorting/filtering and local 100-row display pagination. Refresh reloads both complete sources. A source failure, cursor loop or safety limit prevents publication of a partial combined queue. This is not a cross-endpoint transactional snapshot; concurrent arrivals are reflected on refresh. Search covers proposal/target IDs, scientific names and owner subject; names/emails are not joined from authentication storage.

POST review retains decision/comment only, proposal and target locking, base fingerprint validation, self-review rejection, pending-only decisions and atomic history/audit updates. HTTP 409 requires explicit reload and never automatically retries. Approved/Rejected proposals are read-only. Photos use authorized same-origin endpoints; no tokens or locations are put in notifications.

## Deployment prerequisites ? verify, do not rerun blindly

No migration, live connection, service restart or existing record modification was performed for this implementation. Installed state of 008, 009 and 013 was not checked against Supabase. The operator previously confirmed 016 and 017 installed in plant_app; that is supplied evidence, not a new verification.

- 008: record_change_submission, including pending-target unique indexes.
- 009: record_version_history for version snapshots and earlier species photographs.
- 013: plant_app.staff_notification_event and staff_notification, their constraints and delivery/deduplication indexes. Follow its existing dependency and privilege instructions. Migration 011 is not the Officer event storage.
- Existing species/observation prerequisites, including 004/006/016/017, remain required by their existing workflows.
- Plant pool must use PLANT_PG_SCHEMA=plant_app. Auth storage remains separately configured.
- No new migration is introduced. A missing notification table makes a new proposal fail with 503 and rolls back proposal/history/audit; malformed/incompatible installed objects must be repaired through the reviewed migration process.

Deploy the backend and web together. Mobile approved-edit acknowledgements now require a nonempty safe proposal ID and Pending Review status when supplied. Keep old backend instances from serving incompatible notification behavior during rollout. Verify the deployed /api/data proxy and session forwarding.

The existing Plant Backend startup starts officerNotifications.start() after listening. Delivery polls every 30 seconds and uses the existing auth directory, Active role permissions, owner exclusion, visibility checks, retry state and per-recipient deduplication. Confirm that worker and auth directory are healthy; do not start a second ad-hoc worker.

## Historical proposals and feedback

Existing pending/approved/rejected proposals are discoverable immediately through the queue and filters. No historical notification events are generated automatically, including idempotent retries of pre-existing proposals. Any backfill/reconciliation needs separate operator authorization and an explicit bounded plan. Plant 24 is not modified by this work.

No new Botanist decision-notification contract was invented: existing proposal decisions persist review status/comment, history and audit, and mobile reads those results. A dedicated decision notification producer was absent; adding a broader feedback contract is a separate product task.

## Validation and remaining operator checks

Automated database tests use isolated in-memory PGlite and cannot read DATABASE_URL. They exercise rollback, event identity, retry deduplication, eligible recipients, same-proposal competing requests, stale base conflicts, rejection preservation and missing storage. They do not establish real multi-connection PostgreSQL lock behavior.

Before deployment, verify installed definitions/permissions with an authorized operator. In an approved test environment exercise two distinct Officers concurrently, mobile plant/species proposal submission, notification delivery, exact deep links, approve/reject, stale-base conflict, and unchanged initial-registration/observation/species-request queues. Verify proposed photos and restricted details only through authorized endpoints. No services were started or stopped during this change.
