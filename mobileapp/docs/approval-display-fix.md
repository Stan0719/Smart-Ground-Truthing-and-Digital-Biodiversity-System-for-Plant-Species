# Botanist records and species catalogue after approval

## Findings from existing production records

Initial read-only SQL confirmed that Plant 8 still existed, was Approved, retained
its original registered_subject, and referenced Species 6. Its observation was
Approved and belonged to the same owner. Request 1 was Approved, reviewed, and
linked to Species 6 through both proposed_species_id and approved_species_id.
Approval had not deleted or detached the plant.

All three species initially had protected visibility. Species 6 additionally had
rbac_data.approvalStatus = Pending Review despite Request 1 being Approved.
The catalogue requires both approved species metadata and visibility permitted for
the current role. Changing Species 6 to public alone therefore did not make it
eligible. Request history reads the request's status independently, explaining why
My Species Requests displayed the approved request while the catalogue was empty.

The existing plant read's owner exception applied only to an unapproved plant
belonging to its proposed species' submitter. Once the plant became Approved,
that exception stopped applying. With protected visibility, the creator lost the
history entry even though ownership was intact. Catalogue authorization and
personal submission history were incorrectly coupled.

Species.js is the catalogue used by the Plants route. Plant.js is the per-species
plant list used by the Species route; SpeciesDetail.js shows species details.
Species.js loaded only on mount and waited for the plant-count read before
publishing the catalogue. It could stay stale after approval or fail to display a
successful catalogue response when the secondary count read failed. Species detail
navigation passed only a synthetic slug instead of its available stable species ID.

There was no matching approval audit entry in the inspected business_audit history.
The exact writer that created the original conflicting live statuses cannot be
proven. The current species review API updates both proposal metadata and request
status in one transaction; tests verified that behavior. No production approval
was submitted to reproduce the issue.

## Focused changes

Existing plant, observation and asset read routes accept scope=mine for personal
submission history. This scope uses server-side Botanist permission and immutable
ownership checks, not a caller-supplied owner ID. It returns the owner's plant
history at all existing statuses and only their observations on their own plants.
For protected species it omits live catalogue taxonomy/common-name data and never
grants access to the protected species catalogue or exact GPS. A submitted species
request snapshot may still be displayed because the same owner can already read
that request. Own submitted plant photos remain readable through the scoped asset
read, with both asset and parent ownership checked. QR rules, uploads, approval
actions and normal protected reads are unchanged.

The dashboard and existing owned plant detail use these scoped reads. Species
requests retain their independent list and existing authenticated endpoints.
The existing loader keeps failed sections' previously loaded data, coalesces
refreshes and ignores outdated navigation responses. Private records clear for
logout, account mismatch or rejected credentials.

The catalogue now refreshes on navigation focus, pull-to-refresh and app foreground.
It publishes species independently of the secondary count request, counts only
approved plants, hides unknown counts on count failure, and displays a localized
nonblocking error. Authenticated callers bind reads to the expected account, even
if the session must first restore from secure storage. Account changes hide old
catalogue state. Existing detail/per-species list screens also refresh on focus.
Species-detail navigation now passes speciesId. Existing layout and styles remain.

## Explicitly authorized data repair

The user changed only Species 6's visibility to public. After checking that the
species status was still inconsistent, the user explicitly approved the guarded
repair of its stale approvalStatus. One transaction changed that single JSON key
to Approved only when existing Request 1 was Approved, had review metadata,
referenced Species 6 in both species ID fields, and matched its original submitter.
The transaction verified all other JSON metadata was unchanged and Species 1 and 2
remained protected before committing. Visibility was not changed by the repair.
No pending request was approved and no duplicate record was created.

The repair used the following conditional update inside that validated transaction:

```sql
UPDATE species s
SET rbac_data = jsonb_set(s.rbac_data, '{approvalStatus}', '"Approved"'::jsonb, false)
WHERE s.species_id = 6
  AND s.rbac_data->>'approvalStatus' = 'Pending Review'
  AND EXISTS (
    SELECT 1 FROM species_request_submission r
    WHERE r.request_id = 1 AND r.request_status = 'Approved'
      AND r.reviewed_at IS NOT NULL AND r.reviewed_by IS NOT NULL
      AND r.proposed_species_id = s.species_id
      AND r.approved_species_id = s.species_id
      AND r.owner_subject = s.rbac_data->>'submittedBy'
  )
  AND EXISTS (
    SELECT 1 FROM rbac_species_visibility v
    WHERE v.species_id = s.species_id AND v.visibility = 'public'
  );
```

No schema migration, database reset, record deletion or new table was needed.

## Files modified in this task

- plant-conservation-backend/domain.cjs
- plant-conservation-backend/uploads.cjs
- plant-conservation-backend/test/plant-submissions.test.cjs
- mobileapp/utils/plantApi.js
- mobileapp/utils/botanistRecords.js
- mobileapp/utils/useBotanistRecords.js
- mobileapp/utils/useSpeciesCatalog.js (new)
- mobileapp/screens/Species.js
- mobileapp/screens/SpeciesDetail.js
- mobileapp/screens/Plant.js
- mobileapp/translations/en.json and ms.json
- mobileapp/scripts/botanist-records.test.mjs
- mobileapp/scripts/species-catalog.test.mjs (new)
- mobileapp/scripts/localization-contract.json (intentional speciesId navigation fix)
- This report

## Executed verification

65 targeted tests passed together. They cover atomic existing/new-species plant
submissions, pending reads, request and plant approval, unchanged ownership and
distinct scientific names, retry/idempotency/rollback, owner history at
Pending Review/Approved/Rejected, protection against another owner or guest,
restricted taxonomy redaction, own-photo isolation, unchanged protected QR rules,
catalogue navigation with real IDs, focus/foreground/manual refresh, stale-response
rejection, independent plant-count failure, account changes, session/logout and
English/Malay localization. Backend mutation tests used isolated test databases.
Expo lint and TypeScript checking passed.

Read-only execution of the actual updated plant query against the existing database
returned Approved Plant 8 for its owner and zero rows for an unrelated identity.
Botanist catalogue eligibility returned only Species 6. Actual public HTTPS GETs
returned 200 for /api/species with only ID 6, 200 for /api/species/6, and 404 for
/api/species/1 and /api/species/2.

On the connected physical iPad, existing normal navigation/refresh handlers were
exercised through the development debugger. The dashboard displayed Plant 8 and
Request 1 as Approved with no read error. Species.js displayed only Species 6,
with one approved plant. Two species-detail/back/refresh cycles loaded Species 6's
scientific/common names and linked Plant 8. Returning to the dashboard retained
the Approved plant and request. Actual on-device authenticated API response
diagnostics included HTTP 200 for the scoped history reads, scientific catalogue
and Species 6 detail. Credentials remained on the device and were never printed.

The Plant API was restarted to load the backend read changes. Expo delivered the
updated code during live verification; no additional manual restart is currently
needed. Authentication and Face ID services were not restarted. There was no
production resubmission or new approval for testing, no migration, commit or push.
