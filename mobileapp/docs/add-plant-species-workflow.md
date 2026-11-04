# Add Plant: one final submission

## Root cause and fix

The rendered New Species Request still invoked `handleAddSpeciesRequest`, which
posted independently to `/species-requests`. The bottom handler explicitly returned
while `showSpeciesForm` was active. This made the required combined workflow
impossible. Live read-only inspection also found that `plant_app` was missing the
request table and plant scientific-name column required by the prior code; these
missing migrations caused the separate request to fail.

The old submit button and handler are now removed from the actual screen source.
Request New Species only switches modes; inline Cancel restores the existing
selector. The bottom Add Plant Record button is the only submission action.
All eight species fields stay above the individual plant fields. The Staff Record
Session, location, QR and Plant Photo section content was compared against the
original screen and is unchanged. Colors, styles and photo/location handlers remain.

## Submission and storage

Both modes make one POST to `/api/plant-submissions`.

- Existing species: validate the existing accessible approved species, manual plant
  name, plant measurements, GPS, QR selection and required photos. Create only the
  individual plant and its observation/location/assets; reuse the selected species.
- New species: validate species fields and plant fields independently, with no
  hidden selector requirement. Create the proposed species and linked individual
  plant in one database transaction, including both kinds of photos, the species
  request, observation, GPS and QR assignment. All records roll back on failure.
- A synchronous ref guards repeated taps. A server receipt, payload hash and
  transaction advisory lock return the same result for identical/concurrent retries.
  Changed retries and duplicate species names produce explicit conflict responses.
- Success appears only after the complete transaction commits. The response contains
  the assigned QR token, so there are no later writes that could leave a partial
  submission. Failed submissions preserve the inputs and original client key.

Species classification is in `species`, linked to existing `genus`, `family` and
`conservation_status` tables. Habitat and pending approval metadata use the existing
`species.rbac_data` JSONB column. Species photos are species-owned `plant_asset`
records. Request records hold the officer-review snapshot and proposed species ID.

Individual plant identity and independent scientific name are in `plant_record`;
its `species_id` is the real species foreign key. Measurements remain in the existing
`plant_observation.content`, GPS in `plant_location`, and plant photos in plant-owned
`plant_asset` records. The QR inventory lock, token and assignment semantics are
unchanged. Photos retain the existing JPEG/PNG normalization and 4 MB per-photo limit.

`speciesScientificName` and `plantScientificName` remain separate state variables.
The latter must be entered manually, never autofills, and is stored only in
`plant_record.scientific_name`. It can differ from `species.scientific_name`.

## Approval and authorization

The submission endpoint requires the existing Botanist `plants.create` permission.
New species have `rbac_data.approvalStatus = Pending Review` and protected visibility;
they do not enter the selectable/public catalogue. The plant and observation also
remain pending. Plant approval is blocked until the species is approved. Only a
Conservation Officer can review the species request, and self-review is prohibited.
Approval updates the proposed species in place and sets the chosen visibility; it
does not create a second species. Legacy request-only API consumers remain supported.

The existing officer web review UI remains a placeholder; this task supplies the
authorized review API without modifying unrelated screens.

## Applied additive migrations and deployment

The following supplied SQL files were applied to the live `plant_app` schema in
one transaction after isolated tests passed:

- `004-species-requests.sql`: missing request table and pending-name index.
- `005-plant-scientific-name.sql`: nullable plant scientific-name column; old rows
  are preserved without copying their species names.
- `006-atomic-plant-submissions.sql`: proposed-species reference and idempotent
  submission receipt table. New private workflow tables enable RLS.

No existing records were deleted, reset or backfilled. The plant API and gateway
were restarted, with ports unchanged. Public auth/plant/face health checks pass.
No production test plants or species were created. Authentication/face processes
and code were not changed. No commit or push was performed.

The combined endpoint accepts up to 64 MB total JSON and has a 90-second client/
gateway timeout for the photos. Other routes retain their existing limits. Larger
submissions fail before writes, with a size error. Future installations must apply
these migrations in order to the configured schema before deploying the endpoint.

## Files changed for this update

- `mobileapp/screens/AddPlant.js`
- `mobileapp/utils/addPlantValidation.js`
- `mobileapp/utils/plantApi.js`
- `mobileapp/translations/en.json`, `mobileapp/translations/ms.json`
- `mobileapp/scripts/add-plant-workflow.test.mjs`
- `mobileapp/scripts/localization.test.mjs`, `mobileapp/scripts/localization-contract.json`
- `mobileapp/docs/add-plant-species-workflow.md`
- `plant-conservation-backend/plant-submissions.cjs` (new)
- `plant-conservation-backend/domain.cjs`, `plant-conservation-backend/server.js`
- `plant-conservation-backend/species-requests.cjs`
- `plant-conservation-backend/migrations/006-atomic-plant-submissions.sql` (new)
- `plant-conservation-backend/test/plant-submissions.test.cjs` (new)
- `plant-conservation-backend/test/species-requests.test.cjs`
- `deploy/mobile-login-gateway.mjs` (new endpoint body size/timeout only)

Existing translations remain available; only workflow labels/instructions were
added or corrected in both English and Bahasa Melayu.

## Tests and limitations

- 12 actual-screen/validation/mapping tests pass in English and Bahasa Melayu,
  including absence of the old button/handler, mode switching, both bottom-button
  paths, manual scientific names, meaningful errors and repeated taps/retry.
- 15 targeted backend tests pass, including existing and new species submissions,
  independent names, duplicate/conflicting retries, missing fields, approval rules,
  QR assignment, photos, additive migrations and legacy request compatibility.
- An injected storage failure proves rollback of species, plant, taxonomy,
  location, observation, photos, request, receipt and QR assignment.
- 29 additional localization, record mapping, QR inventory/printing, gateway,
  integration-read and security tests pass. Expo lint and TypeScript checking pass.
- Full backend suite: 99 passed, one failed. The pre-existing failure at
  `test/business.test.cjs:157` omits the required QR ID and expects 201 instead of
  the existing 400 Invalid identifier response. It was previously reproduced with
  pre-task code. QR requirements were not weakened to satisfy that old fixture.
- Live schema metadata and public health were verified; full submissions were
  tested against isolated PostgreSQL/PGlite rather than inserting fake live data.
  Physical-device camera and small-screen visual QA were not performed.

Reload the Expo app to load the updated screen.
