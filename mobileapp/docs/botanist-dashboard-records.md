# Botanist dashboard saved-record visibility fix

## Confirmed live submission

Read-only inspection confirmed a committed submission: plant 8, species 6,
observation 5d8a3647-e3c3-43fa-b355-aabdddf05f71 and species request 1.
The plant, observation, request and species proposal have matching staff ownership.
The plant, observation, species and request are pending review, and the committed
submission receipt exists. No duplicate or replacement record was needed.

Plant identity is in plant_record; species classification is in species; field
content is in plant_observation; the request is in species_request_submission.
Location, QR assignment and photos use the existing plant_location, public.qr_code
and plant_asset relationships.

## Root causes

1. BotanistDashboard still loaded botanistPlantRecords from mockData and filtered
   it by the botanist display name. The real submission writes to PostgreSQL.
2. Its pending filter did not recognize the backend's canonical Pending Review state.
3. Plant and observation reads always applied species visibility first. Proposed
   species intentionally have protected visibility, so this hid even the submitter's
   own pending records.
4. BotanistPlantDetail also looked in mockData instead of loading the saved plant ID.

## Corrections

The dashboard loads plants, observations and species requests from the existing
APIs, with all requests bound to the active account ID. A second client ownership
filter uses staff:<account ID>, never display names. Requests appear in My Species
Requests with their real status; the Pending Approval statistic filters the owner's
pending plants/observations and requests. It is an owner submission view, not an
approval interface. No approval controls or permission grants were added.

The backend permits access to an unapproved proposed-species record only when the
plant submitter and species proposer match the authenticated owner; observation
and photo reads additionally verify their own ownership. Other botanists and public
users remain blocked. Existing protected-species restrictions and exact-GPS redaction
remain in force. Pending species still do not enter the public/selectable catalogue.

The plant response now includes the authorized species details and latest owned
submission content. Plant scientific name stays independent of species scientific
name. Details load the same saved plant ID, observation, status and private photo
sources using the existing authenticated asset endpoint. Pending records are read-only;
permitted observation corrections use the existing correction route instead of a
mock-only save action. The Add Plant, staff session, QR and location/photo upload
workflows were not modified.

Focus reloads when returning to the dashboard or opening details. My Plants,
Pending Approval and Approved cards filter and refresh the records; pull-to-refresh
also reloads. A single in-flight loader deduplicates overlapping refreshes, cancels
stale responses on blur/account changes, preserves loaded data on temporary errors
and displays errors rather than claiming a valid empty list. There are no writes in
the dashboard loader.

## Files modified

- plant-conservation-backend/domain.cjs
- plant-conservation-backend/uploads.cjs
- plant-conservation-backend/test/plant-submissions.test.cjs
- mobileapp/screens/BotanistDashboard.js
- mobileapp/screens/BotanistPlantDetail.js
- mobileapp/utils/plantApi.js
- mobileapp/utils/botanistRecords.js (new)
- mobileapp/utils/useBotanistRecords.js (new)
- mobileapp/translations/en.json and ms.json (new labels in both languages)
- mobileapp/scripts/botanist-records.test.mjs (new)
- mobileapp/scripts/localization.test.mjs and localization-contract.json
- This report.

## Verification

- 43 frontend/regression tests passed, including actual dashboard/detail rendering,
  API ownership binding, canonical statuses, both languages, focus refresh, manual
  refresh, deduplication, stale response rejection, notifications, Add Plant and
  record mapping.
- 14 targeted backend/security/integration tests passed, including submission via
  existing and new species, owner reads of pending plants/observations/requests/photos,
  denial for other botanists and public users, exact GPS restrictions, no duplicate
  records, rollback and approval rules.
- Expo lint and TypeScript checking passed.
- The exact updated backend SELECT queries were checked read-only against plant 8:
  the owner query returned one plant and one observation; unrelated botanist and
  public queries returned zero for that plant.
- The plant API was restarted and its gateway health is 200. No migration was
  needed or run. No records were created, edited or deleted in production, and no
  commit or push was performed.

Reload the Expo app to load the new dashboard code. Physical-device navigation and
camera UI were not tested. Live verification covered existing data and read queries;
submission tests used isolated PostgreSQL/PGlite without unwanted production records.
