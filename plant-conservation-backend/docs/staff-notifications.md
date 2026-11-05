# N2 staff notification foundation

Not deployed by this change. No workflow producers, worker, seed/backfill data,
frontend connections, or modifications to Botanist notifications are included.

## Readiness and identity

Plant API `identity(auth)` validates the existing cookie/bearer session through
`createAuth().session()`. The auth adapter reads current Active staff users and
unexpired sessions, including inactivity and temporary-password checks. The
notification module additionally requires an active Administrator or Conservation
Officer without a mandatory password change, using existing `permitted()` policy.
Subjects are `staff:<trusted session user.id>`, not client input. Authentication
uses AUTH_DATABASE_URL (falling back to DATABASE_URL) and AUTH_PG_SCHEMA (default
plant_auth); the Plant pool is separate. There is no assumed cross-database staff
FK or Supabase auth.uid() mapping. Runtime reads do not enumerate account PII.

The new tables/resources explicitly live in plant_app. The API requires its pool
current_schema() to be plant_app; an absent migration or different configured
PLANT_PG_SCHEMA fails closed with 503. Do not change environment/schema placement
automatically. Verify actual deployment settings separately without printing
credentials. Isolated fixtures use in-memory PGlite, not any environment database.

## Migration 013 (reviewed file, not applied to the application)

`013-staff-notification-foundation.sql` requires existing plant_app resources,
including migrations 004 (species requests) and 008 (record changes). Migration
011 and 012 are unchanged. All names are schema-qualified. It adds only:

- staff_notification_event: UUID identity, unique source key, constrained event /
  role / resource contract, typed optional resource FKs, occurrence time, priority,
  bounded object metadata, retry state / attempts / next attempt / safe error code,
  delivery timestamp. Resource deletion nulls its FK and makes the notice hidden.
- staff_notification: UUID identity, composite event/intended-role FK, validated
  staff subject, unique event/recipient/role delivery, ordered delivery sequence,
  creation and first-read timestamps. No auth/account FK is invented.
- Recipient pagination and partial unread indexes, event retry index, immutable
  identity/first-read guards, RLS, explicit browser/PUBLIC revokes, postgres grants.

Compatible reapplication preserves rows and read state; it does not reconcile
arbitrary pre-existing schema drift. Inspect any unexpectedly existing objects
before applying. No existing application table is altered. New trigger functions
are invoker functions with pg_catalog search_path and qualified object references.
The postgres runtime follows migration 011's trusted-service convention. Other
runtime roles need separate reviewed grants/RLS; do not grant browser access.

Allowed Officer events: registration_submitted, field_observation_submitted,
observation_resubmitted, observation_flagged, species_dependency_resolved,
species_request_submitted, species_request_resubmitted, record_change_submitted.
Administrator system events: system_failure, account_administration, security_event.
These are storage allowlists, not enabled producers or approved event policies.
Sensor/operational resource contracts remain deferred rather than guessing which
legacy/canonical device or alert model applies.

## API contract

Plant API paths (frontend proxy can later use /api/data/staff-notifications):

- GET /api/staff-notifications?limit=20&cursor=... : notifications, unread_count,
  page {limit,has_more,next_cursor}, read_through.
- GET /api/staff-notifications/unread-count : {unread_count}.
- POST /api/staff-notifications/:uuid/read with {} :
  {notification:{id,read_at}}. Preserves the first timestamp on repeat.
- POST /api/staff-notifications/read-all with {read_through:<issued token>} :
  {updated}. Repeating returns zero once the boundary has been acknowledged.

Items expose id, created_at, read_at, event_type, priority, occurred_at and
resource {kind,id}. They do not expose recipient, event source keys, metadata,
actor, private account details, raw error messages, GPS, media or credentials.
No destination or origin is fabricated: future UI integration must fetch current
authoritative detail and respect existing routes/classification/review eligibility.

Only limit/cursor are accepted list inputs. Limit defaults to 20, maximum 100.
Other query/body keys, including arbitrary recipient/role filters, are rejected.
UUIDs are required for inbox item IDs. Resource IDs retain their actual types.

Opaque HMAC tokens bind purpose, recipient subject, current role, a maximum
delivery sequence, and 15-minute expiry; cursors additionally bind the last sequence.
No secret is returned. The signing key is generated per API instance: restart,
token expiry, or a different instance produces 400; reload from that instance.
Multi-instance deployments require affinity or a future reviewed shared signing
key strategy. No new environment variable or persistent secret was introduced.

Pagination uses immutable delivery_seq DESC, independent of event occurrence times
and timestamp ties. New deliveries do not enter an existing traversal. Membership
can still change with deletion/visibility changes; this is not a database snapshot.
unread_count is the current complete accessible unread count, not the page count;
concurrent changes can occur after a response.

The inbox insert trigger takes transaction advisory lock (193701,2), then assigns
a fresh sequence and creation time. Initial list requests use that same lock before
issuing a maximum-sequence boundary. This covers older transactions that commit
late; future delivery writers must keep the trigger enabled. Sequence gaps are
expected (the identity default and guarded reassignment both consume values).
Read-all acknowledges only still-accessible, unread rows at/below the signed cap;
later deliveries remain unread. No workflow/action status is changed.

The same resource predicate applies to list, count, mark-one and mark-all:

- Intended role and recipient must match the current trusted session.
- Administrator: only allowlisted system notices; no Officer observation details.
- Officer observations: existing observation/plant/species plus species visibility
  and plants.scientific.read permission. Protected access follows existing policy.
- Officer species requests: existing request plus species.manage permission,
  matching that endpoint's Officer-wide read contract.
- Officer record changes: existing change and existing target species/plant,
  species visibility plus species.manage permission.

Deleted/missing resources are omitted and cannot leak through unread counts or
acknowledgements. Own submissions remain inspectable under the existing Officer
read contract; notification visibility does not grant self-review permission.
Inactive/revoked sessions cannot access data. A role change hides the old role's
inbox; returning to that role can expose its retained history again. Permanent
role-history revocation and retention are deferred product decisions.

Errors: 400 invalid inputs/tokens, 401 absent/invalid session, 403 unauthorized
role/account state, 404 nonexistent/unowned/inaccessible UUID, 503 unavailable
storage/configuration/database. Queries are parameterized; failures disclose no
raw database diagnostics. Existing origin, JSON and cookie/bearer boundaries apply.

## Deployment and validation

1. Review actual plant_app/auth schema placement, database runtime role and backup.
2. Review and manually apply migration 013 to the intended application database.
   This task does not apply it, connect to Supabase or change environment files.
3. Deploy/restart Plant API through the normal authorized deployment process.
4. Verify authenticated empty inbox/count for both roles and denial for other roles.
   Do not seed fake notices or trigger real reviews for verification.
5. Enable real producers only in separately authorized N3 work. Connect bells later.

Rollback by disabling/removing the route registration/deploying the prior API;
leave additive tables intact for investigation. Do not drop tables containing data
or automatically reverse read timestamps. Migration deployment/rollback requires
normal backup and reviewed operational handling.

Tests use isolated fixtures only, including explicit synthetic data and migration
execution in that disposable engine. Never run this migration or test fixtures
against application/production resources. The Botanist fixture suite remains
separate and unchanged.
