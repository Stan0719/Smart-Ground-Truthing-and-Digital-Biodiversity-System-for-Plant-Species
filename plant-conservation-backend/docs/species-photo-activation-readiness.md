# Final species photo activation readiness

## Current live status

`plant_app`, migration 014 and migration 015: **Not verified live**.
No connected, authorized read-only Supabase session was available. No new pool was
created and no environment/secrets were read to establish one. There was no live
SQL, migration, policy/grant change, deployment, or activation.

The user has now supplied live key types: species and plant identifiers and their
verified asset/observation links are BIGINT; asset/observation IDs are TEXT;
request_id and approved_species_id are INTEGER; proposed_species_id is BIGINT.
014/015 and the runtime type expectations are corrected for those specific keys.
Isolated PGlite tests model these mixed types; they do not certify live constraints,
grants, RLS, data ranges, backups or deployment. See `species-photo-type-compatibility.md`.

## Read-only verification checklist

Run every SELECT in `species-photo-schema-verification.sql` in the intended project.
Retain results privately for review. Verify the database/project identity separately;
the presence of a schema named plant_app in another project is not sufficient.

Check existing migration prerequisites in source order, including 004 requests,
006 atomic receipts/proposed species, 008 reviewed changes, 009 history, 012 origin
and the existing 013 notification workflow. Preserve all unrelated 001–013 tables,
indexes and policies. Verify existing operations independently; the photo readiness
probe checks the dependencies it uses, not the deployment history of every module.

Compare columns and actual PostgreSQL types (not inferred JavaScript numbers), PKs,
FKs, validated CHECKs, the deferred order constraint, partial unique main index,
immutable-history and role-provenance triggers, pagination indexes and RLS flags
against 014 and 015. There is no general migration ledger in the existing runner.
The ordinary `scripts/migrate.cjs` applies base schema/003; **do not treat it as an
automatic 014/015 deployment runner**.

Historical scripts contain a `public`/BIGINT schema variant (notably 002), while
`schema.postgres.sql` uses INTEGER parent keys. Do not replay either schema over
plant_app. The corrected photo migrations use the user-verified BIGINT species and
plant keys, while retaining INTEGER request IDs. No existing column is altered.
Other prerequisite types, including rbac_species_visibility.species_id and
record_change_submission.species_id, still require live verification against the
runtime checker; their INTEGER source definitions are not evidence of live types.
Current gallery/library validation is limited to int32 species IDs; approval also
stores approved_species_id as INTEGER. Review live ranges and sequence headroom
before activation, and separately review decimal-string ID support if needed.

Record each migration as Verified applied, Verified absent, Partially present or
Not verified. Inventory SELECTs alone are not certification. Partial presence means
stop and review; do not rerun a whole migration opportunistically.

The SQL Editor inspector can be a different role from the API. Also verify the
actual API runtime role through the authenticated capabilities route after readers
are deployed. SQL Editor superuser success does not establish backend readiness.

## Required runtime privileges and RLS

The existing backend role needs USAGE on plant_app and SELECT on the prerequisite
and photo tables. Management needs INSERT/UPDATE on collection and reference,
INSERT on arrangement history, plus USAGE on its identity sequence. Reusing uploads
needs the existing plant_asset INSERT/UPDATE grants; review paths need existing
species and species_request_submission UPDATE privileges. Role-bearing submissions
need INSERT on plant_asset_photo_role and species_request_proposed_image.

Do not grant these operations to anon/authenticated frontend database roles. Existing
HTTP species.manage authorization remains the Officer-only boundary; Administrator
receives no new grant. No grant or policy is applied by this implementation.

The runtime probe conservatively accepts RLS bypass already held by the trusted
backend role, or table ownership when FORCE RLS is off. A non-owner role relying
on policies is rejected for review rather than assuming those policies permit safe
operations. This is not a recommendation to grant superuser/bypass privileges.
Inspect existing policies with the SELECT artifact; any policy-based deployment
requires a separately reviewed and tested readiness extension, not a bypass flag.

## Explicit activation contract

GET `/api/species/photos/capabilities` is authenticated Officer-only. Version 1
reports `activationRequested`, `schemaReady`, `migration014`, `migration015`,
`galleryAvailable`, `semanticRolesAvailable`, `writesEnabled`, and diagnostic codes.
The frontend requires every affirmative field and both verified-applied statuses.
Legacy/partial/failed responses are disabled. Create performs this check before it
has a species ID. Successful image reads or an Officer role do not activate writes.

GET `/api/species/:id/images` returns canonical state without creating a collection.
PUT on the same route requires species.manage, explicit server activation and a
fresh runtime metadata check, followed by the existing locked/revisioned transaction.
When disabled it returns 503. Anonymous/Admin requests remain 401/403. Bad payloads
are 400; unavailable resources are 404; membership/stale/ineligible conflicts are 409.

Production startup parses `PLANT_SPECIES_PHOTO_WRITES_ENABLED`; only exact `true`
requests activation, and every other/absent value means false. The same startup
snapshot and fresh readiness check gate PUT arrangements and POST /api/assets for
direct species JPEG/PNG references. Plant evidence uploads and species PDFs keep
their existing rules. Neither flag can override wrong schema, partial migrations,
RLS, missing grants, triggers or indexes. No schema override or role grant is added.
The UI still uploads only after explicit Save and affirmative capabilities. See
`species-photo-startup-verification.md` for gate scope, preflight incompatibility
with enabled writes, future PowerShell commands and the operator rollback procedure.

## Manual deployment sequence — approval required before executing

1. Confirm a recoverable backup, restoration procedure, responsible operator and
   intended project/runtime role. Include asset bytes and request/version history.
2. Deploy compatible portrait/list/binary readers and capability checks with server
   activation false. Verify existing text CRUD, approvals and public privacy.
3. If and only if 014 is verified absent and prerequisites match, apply the exact
   reviewed 014 file once in plant_app. Its names are unqualified: the authorized
   deployment session must explicitly set search_path to plant_app,pg_catalog before
   executing the file. Do not apply it in public and do not nest its BEGIN/COMMIT
   inside another migration transaction.
4. Run the SELECT verification artifact; compare every 014 object and runtime access.
5. If and only if 015 is verified absent and 014 is complete, apply the exact reviewed
   015 file once in the same explicitly selected plant_app schema.
6. Repeat SELECT verification for 015 types, role FKs/triggers, RLS and indexes.
7. Confirm backend runtime permissions and capabilities: schemaReady must be true,
   both migrations verified-applied, activationRequested/writesEnabled still false.
8. Only after separate explicit authorization, deploy the reviewed server startup
   activation setting. Verify the affirmative capability contract; there is no
   frontend Boolean to flip. Do not change connection pool sizes or start extra
   backend copies against the Supabase session pool.
9. Use one authorized test species to verify create, mixed upload failure/retry,
   primary/order, two-Officer 409 reconciliation and non-destructive removal.
10. Verify Catalogue/Detail portrait agreement, gallery ordering, stale binary URL
    denial after removal, pending/protected privacy and absence of Admin access.

None of these live steps was performed. No live capability is classified Verified live.

## Recovery and rollback

014/015 are transactional one-time scripts, not idempotent rerunnable scripts.
Offline tests reapply each, observe rejection, roll back and verify existing bytes
and metadata are intact. If an authorized live application fails, roll back that
transaction, inspect SELECT results and stop; do not clean up objects speculatively.

After any managed removal, **never deploy old membership-unaware readers**: retained
bytes could become public again. Disable management writes first, retain compatible
readers and all tombstones/history, and prefer a reviewed additive forward fix.
Do not drop the photo tables or delete/reparent evidence. Backup restoration is a
separate coordinated recovery action that must preserve publication/privacy state.

## Remaining dependencies

Mobile AddPlant/EditSpeciesRequest files are unchanged. Whole-plant capture intent
must be sent with the supported role contract before new mobile submissions can
populate that group reliably. Legacy ordering is not a label. Later-observation
role capture remains separate work. Persisted primary selection from plant evidence
remains disabled because 014 supports direct species references only. Public pages,
thumbnails, zoom, documented plants, auth/RBAC, notifications and image history are
preserved; deployed behavior and browser visuals still require approved verification.
