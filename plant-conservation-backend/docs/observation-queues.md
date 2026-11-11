# Officer observation queues (Phase 3)

## List contract

`GET /api/observations` without queue arguments retains its existing envelope and
500-row cap. Detail retrieval is unchanged. Supplying any of `origin_type`,
`status`, `limit`, or `cursor` opts into bounded cursor retrieval:

- `origin_type`: `initial_registration`, `subsequent_observation`, or `unknown`;
  omit for all origins. Uses the effective Phase 2 classifier, including validated
  submission receipts; never infers origin from approval or creation order.
- `status`: one of the existing six statuses; omit for all statuses.
- `limit`: positive integer, default 100, maximum 200.
- `cursor`: opaque continuation value from the preceding response. Preserve the
  same origin, status and `scope` filters. Invalid arguments return HTTP 400.
- Existing `scope=mine`, authorization, species visibility and GPS projection apply.

Response adds `page: { limit, scanned_count, has_more, next_cursor }`. Each request
scans at most `limit` authorized/status-matching rows and classifies that batch.
Origin filtering occurs on the server after classification. Thus a filtered page
can be empty while `has_more` is true. Continue until `has_more` is false; never
treat an empty page as exhaustion. The cursor advances past the last scanned row,
not merely the last matching row. No global count is provided.

Ordering is descending `(created_at, id)`. The cursor preserves PostgreSQL UTC
microseconds rather than JavaScript millisecond precision, and includes the ID to
break timestamp ties. Under stable data, following every continuation visits all
authorized matching rows exactly once, including records older than 500 rows.
Each request fetches one additional authorized row solely to detect continuation.

This is not a database snapshot. Newer insertions during traversal appear after
refreshing the queue; concurrent status/origin/visibility changes or deletions can
change membership. Refresh after decisions or when seeking newly submitted work.
Sparse origins can require several empty pages; retrieval remains bounded per
request rather than issuing an unbounded scan/classification in one request.

## Officer behavior

Review Submissions defaults to initial registrations (existing species and genuine
new-species proposals). Its explicit Unclassified / Legacy selector preserves
unknown records and their existing backend review eligibility. Legacy deep links
select this fallback automatically. Unknown is labeled Origin not verified.

Observations defaults to subsequent field observations, retaining read-only View
and in-modal field review. All Origins provides browsing/history including initial
observations. Registration/unknown review links open Review Submissions rather
than duplicating its decision controls. History can load further all-origin pages.

Both pages expose Load more, including after an empty filtered page; append failures
retain prior rows and the retry cursor. Status changes restart server pagination.
Search, species, submitter/date filters, history and counters operate on the loaded
subset, explicitly labeled in EN/MS/ZH-CN. They do not imply complete/global totals.
Missing pagination metadata is an error, not a falsely complete queue.

Detail is fetched when opening review and again before decisions. Origin mismatch
blocks a route-specific POST and refreshes the queue. Existing revision/conflict,
species dependency, authorization and uncertain-save handling remain authoritative
on the backend. Origin selection does not grant review permission.

## Deployment and verification

No Phase 3 migration is required. Keep the already-applied Phase 2 migration 012
and classifier unchanged. Deploy the Plant API with the opt-in contract before
the frontend. This implementation does not deploy or restart services.

After deployment, manually verify with authorized test accounts: both registration
paths, a subsequent observation, legacy Pending Review and Flagged records,
all-origin history, multiple/empty pages and retry, status filters, origin mismatch
and conflict recovery. Inspect 320/375/390/768-pixel and desktop layouts, horizontal
table actions, submitted media/GPS/zone/altitude/QR, and all three languages.
Do not submit real reviews solely to verify presentation. Automated tests use
isolated PostgreSQL fixtures and frontend mocks; no live Supabase is involved.
