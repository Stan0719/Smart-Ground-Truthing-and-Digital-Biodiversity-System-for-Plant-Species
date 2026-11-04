> Historical instructions: project Python files and launchers were removed at the user's request. Python commands below are no longer runnable. The active website uses Vue, Node.js and PostgreSQL.

> Historical PostgreSQL-era document. The current plant backend uses SQLite.
> Follow [SQLite plant storage](sqlite-plant-storage.md) for current setup and backup instructions.
> Old PostgreSQL commands and completion counts below are retained for history.

# RBAC implementation and local setup

## Architecture and boundaries

- Authentication remains in `web/server/data/auth.sqlite`: staff, Visitors, scrypt password hashes, hashed cookie/bearer sessions, recovery codes, activation tokens, audit events and security settings.
- The plant Express service imports the existing `createAuth` module and uses the SAME absolute `AUTH_DB` file. It does not maintain another login database. This topology requires both Node services to run on the same host with local SQLite storage.
- Python face login must use the authoritative account service. Prototype mode requires explicit `ALLOW_PROTOTYPE_AUTH=1` and cannot supply valid business API sessions.
- PostgreSQL/PostGIS retains species, plant and location records. Proposed migrations add business workflows without deleting existing records.
- `shared/rbac.cjs` contains fixed role grants. Administrator does not inherit plant, field, review, report, or response permissions.
- Guest/Visitor responses use field allowlists. Sensitive fields are not merely hidden by buttons. Authenticated Admin plant requests are denied; an Admin who logs out has the same public access as any Guest.
- Species lacking visibility classification are protected. Botanists are denied protected records until an explicit internal policy is supplied. Officers may classify species; never bulk-publish records to make an empty catalogue look populated.

## What has actually been migrated

The local SQLite account database was backed up and upgraded. Existing account IDs, hashes and sessions were preserved; foreign-key validation passed. Backups are under `web/server/data/backups/` (ignored by Git).

No application PostgreSQL migration has been applied: this checkout has no configured database connection and no PostgreSQL command-line utilities. The relational migrations and workflows are tested in isolated PGlite. Its spatial functions are test doubles, so PostGIS and the real schema remain unverified.

Original modified source files were preserved under `.rbac-backups/source/` (ignored by Git). This includes the previous demo records. They were not imported into the real database or treated as verified observations.

## Local configuration

Use Node matching the existing website engines (`^22.18.0 || >=24.12.0`).

1. Install locked dependencies with `npm ci` in `web`, `mobileapp`, and `plant-conservation-backend`.
2. Authentication: copy `web/.env.server.example` to `web/.env.server`. The Node server loads this file. Set the exact `APP_ORIGIN`, and configure EmailJS service/public key and separate OTP and activation template IDs. The activation template uses `to_email`, `to_name`, `role`, and `activation_link`. Do not email passwords. Activation delivery currently remains unconfigured; invitations fail closed rather than falsely reporting success.
3. Plant service: copy its `.env.example` to `.env` and configure the actual development PostgreSQL/PostGIS connection. Use the same absolute `AUTH_DB` as the web service. Set exact `WEB_ORIGINS` (comma separated), with no trailing slash. In production they must use HTTPS.
4. Mobile: set `EXPO_PUBLIC_PLANT_API_URL` to the plant service's reachable HTTPS ORIGIN (no `/api` suffix). The existing face URL is separate. Never put database passwords or device/service keys in Expo public configuration. No plant origin was guessed or port visibility widened automatically.
5. Configure authoritative face startup with the existing script after restoring its Python 3.11 environment and models. The current checkout lacks an executable `face_backend/.venv/bin/python`.

## PostgreSQL inspection and guarded migration

From `plant-conservation-backend`:

```bash
npm run inspect-schema
npm run migrate:local
```

Before the second command:

- Verify the connection is a local development/test database, never production.
- Inspect all existing columns, foreign keys, triggers, observation and IoT tables.
- Adapt migrations to reuse equivalent existing structures. The supplied migration aborts on known equivalent-table conflicts; it must not be forced past those checks.
- Install working `pg_dump`. The runner refuses changes if a consistent backup cannot be created.

The runner saves a custom-format dump and schema metadata with restricted file permissions, takes a PostgreSQL advisory transaction lock, tracks migration filenames, and rolls back failed SQL. `NODE_ENV=production` is rejected. A localhost listener does not imply this migration has run.

Migration 001 adds `registered_subject`, `rbac_status`, `qr_token`, species `rbac_data`, and `rbac_species_visibility`. Existing `registered_by` foreign keys and values are preserved; the legacy field becomes nullable for canonical SQLite ownership. PostgreSQL cannot have a foreign key into SQLite; the existing auth service verifies the subject on each API request.

Migration 002 adds observation/review/media, device/reading/alert/response, and business audit tables with foreign keys, checks and owner-scoped idempotency keys.

Existing legacy plant ownership is not guessed. Existing records are initially unpublished and species are protected until reviewed. Mapping legacy owner IDs and importing legacy records into the approval workflow require schema/data review; no synthetic observations were generated.

Recovery: stop writes, preserve post-backup changes, restore a reviewed backup into a separate recovery database, verify account/record counts and foreign keys, then reconcile and switch during maintenance. Do not blindly drop ownership columns or overwrite a database containing newer records. Production migration/restore requires separate approval.

## Running development services

In separate terminals:

```bash
# web/
npm run server
npm run dev

# plant-conservation-backend/
npm start

# mobileapp/
npm start
```

Configured ports: website 5173; authentication 3001; plant service 3000; Expo 8081. The website development proxy routes `/api/data/*` to the plant service and other `/api/*` to authentication. Production hosting needs equivalent HTTPS reverse-proxy rules.

A missing business database results in HTTP 503; no fallback demo records are returned.

## Workflows

### Invitations and accounts

Admin → User Management → Invite staff. Provide full name, unique username, email, and Botanist/Conservation Officer role. Pending accounts have NULL password hashes and cannot log in. Tokens are random, hashed at rest, expire after 24 hours, and are consumed atomically. The activation page clears the token fragment from the address bar. Backend confirmation requires matching passwords of 8–128 characters. Failed delivery invalidates the token; pending invitations may be resent. Visitor registration cannot request staff roles.

Existing Admin account email/password remain unchanged. Visitor accounts are included in administration; Visitors cannot be promoted through Visitor edit requests. Disable preserves records and invalidates sessions; the legacy Delete API now disables rather than physically deleting referenced accounts.

### Field collection and review

The active mobile navigator uses `FieldCollection.js` and `PersistentKnowledge.js` for backend workflows. Earlier prototype screen files remain available as source reference, but mutable demo records no longer supply production data.

Botanist → capture field content/GPS/photos → save account-scoped offline draft → synchronize with an expected authoritative account ID. Server ownership ignores submitted user IDs. Retry keys prevent duplicate records. Uploads complete while observations are Draft; explicit submission then exposes them for review. Interrupted synchronization retains the draft. Synchronization runs on explicit request and verified session restoration/revalidation.

Officer → Review Submissions → revision-checked approve/reject/flag/request correction. Non-approval requires feedback. Self-approval is denied by immutable owner subject, including after role changes. Edits are restricted to the owner's Draft/Rejected/Correction Required observations, and resubmission follows upload completion. Exact GPS updates become authoritative only on approval. QR codes persist on plant records and public lookup requires approval.

Offline queues use account-scoped AsyncStorage, not a second authentication database. OS-level encryption, device-loss behavior, storage quotas and prolonged-offline UX still require device testing; a successful mock queue test is not proof of those properties. Authentication clears unusable sessions. An already open field form remains available for local draft saving after session loss; it cannot synchronize until the owner signs in again. Reopening private drafts after an offline cold start, OS-level draft protection and full device recovery UX still require further work and device verification.

### Species, reports and media

Officer curation persists official species, conservation status IDs, publication classification, photos and PDF documents. Current curation forms accept existing genus/status IDs; taxonomy selection UX still needs validation against the actual reference tables. Reports export authorized data as CSV or PDF. CSV cells are escaped and spreadsheet-formula prefixes are neutralized.

The backend decodes/re-encodes photos through Sharp, strips original metadata, bounds pixel count and upload size, and gates each download by parent visibility/review state. Field photos are not public before approval. PDFs are staff-only attachment downloads with sandbox/no-sniff headers.

### IoT

Admin registers sensors and receives a one-time provisioning key; only its hash is stored. Admin configures metric thresholds and device active status. Officer/Admin may view readings/alerts. Only Officers may record responses, and resolved alerts cannot be modified through the response endpoint.

`serial_bridge.py` accepts the current Arduino firmware's textual output on stdin and posts device-authenticated readings over HTTPS, using `PLANT_API_ORIGIN`, `DEVICE_ID`, and `DEVICE_KEY` from the environment. It does not configure USB ports. Sensor ADC values remain raw firmware units: no calibration or rainfall/soil percentages are invented. Thresholds currently use numeric upper-bound comparisons; hardware-specific lower-bound alarms/calibration remain integration work. Existing firmware's independent LED behavior is unchanged.

## Tests

```bash
# web/
npm run test:auth
npm run build

# plant-conservation-backend/
npm test

# mobileapp/
npm run lint
npm run type-check
node --test --test-isolation=none scripts/face-api.test.mjs scripts/face-capture-flow.test.mjs scripts/face-login-flow.test.mjs scripts/face-session.test.mjs scripts/field-sync.test.mjs scripts/plant-session.test.mjs scripts/recovery-flow.test.mjs

# mobileapp/face_backend/
python -m unittest test_core test_http test_account_integration

# repository root
python -m unittest discover -s IoT/PlantPrototype -p 'test_*.py'
```

HTTP tests need localhost networking. PGlite is a test-only dependency and never replaces the production PostgreSQL/PostGIS connection. Face HTTP tests inject matching fixtures; actual recognition/liveness and email receipt require external integration verification. Expo bundle compilation does not establish physical-device functionality.
