# Species photos: implementation and activation

The Officer form reuses `SpeciesPhotoManager.vue` inline. Create queues files;
Edit shows four loaded previews and expands into a source-filtered 16-item library.
The standalone table action is removed. Existing species text contracts are unchanged.

## Activation is deliberately incomplete

No live migration has been applied. The frontend now uses the versioned server
capability contract, not a hardcoded Boolean. Production `createPlantApp` does not pass `speciesPhotoWritesEnabled`;
the optional constructor argument defaults to false and has no environment override.
Canonical/library GET routes are Officer-only. PUT is registered but returns 503
unless explicit activation AND runtime `plant_app` metadata/RLS/grant checks pass.
The gate requires both 014 and 015. It has no environment auto-enable path.
The existing species upload pipeline is reused, never duplicated.

After separate authorization: back up and verify the application schema; deploy
compatible readers and review helpers; apply 014 once, then additive 015; verify
runtime RLS/constraints and role tests; explicitly enable backend writes and verify
capabilities before using the photo form. Do not roll back membership-aware
readers after removals. No SQL or deployment was performed by this implementation.

## Separate commits and retries

Text saves first and the real created species ID is retained while the form stays
open. Uploads use stable per-file client keys; acknowledged asset IDs are retained
on each file. A retry skips successful uploads and never recreates the species.
Canonical membership/revision is checked before the final arrangement PUT.
Stale saves retain the draft and receipts rather than silently merging another
Officer's changes. Each upload and the final arrangement are separate transactions.
On conflict, the form fetches the current canonical state and requires an explicit
choice to reapply eligible local choices or use the latest saved arrangement.
Neither choice sends a write; the next explicit Save uses the new revision.
Cancellation revokes local previews, not already committed assets. With unavailable
capability, text-only saves remain allowed and the form explicitly reports that
selected photos were not saved. In Create the first queued file is the default main image;
reordering never changes its stable ID selection. Removing it selects the first
remaining file. Edit preserves its existing main until an explicit new choice.
Live end-to-end persistence still requires activation verification.

## Semantic photo roles and mobile integration specification

Migration 015 adds immutable provenance in `plant_asset_photo_role` and a separate
`species_request_proposed_image` relationship. It does not classify existing assets,
modify 014, copy bytes, replace the request photo, or change observation foreign keys.
Roles describe explicit capture intent, not automated botanical verification.

Supported new contract: optional `role` on each `POST /api/plant-submissions` photo:

```json
{"content_type":"image/jpeg","base64":"...","role":"whole_plant"}
```

Allowed roles: `whole_plant`, `leaf_close_up`, `stem_bark`, `flower_fruit`, `additional`.
Non-additional roles must be unique within a submission/observation. The existing
unlabeled contract is still accepted, with no role inferred. When labels are supplied
but 015 is absent, return 503 and roll back; never silently discard the labels.
`GET /api/plant-submissions/capabilities` advertises role support to Botanists.

**Mobile change is deferred:** AddPlant must preserve the guided keys while building
its photo array, map each guided key to the above role, and label extra images
`additional`. It must check capabilities before submitting role-bearing data. Keep
the separate `new_species.photo` unchanged. Never derive a label from array position.
EditSpeciesRequest should use `proposed_photo_url` for the proposed preview and retain
`photo_url` for the original request photo. Neither mobile file was modified.
The current mobile payload does not send these roles, so it cannot populate the new
whole-plant group automatically until this integration is separately authorized.

Later observation uploads/record-change photo additions do not yet persist roles.
They remain excluded from the semantic library unless a supported capture contract
is added. Existing explicitly labeled retained evidence keeps its provenance.

## Authorization, sources and portrait policy

The library is a bounded relational query, independent of the capped plants list.
It combines active approved species references and explicitly labeled whole-plant
evidence. Evidence requires current plant, observation and species approval plus
same-species authorization. Withdrawal/reassociation immediately changes eligibility.
Source-bound keyset cursors retain full database timestamp precision and return
`hasMore`/`nextCursor`, with no invented total. Images use lazy loading.

Original evidence remains plant-owned. Selecting it as a persisted species primary
is disabled: 014 intentionally permits only directly species-owned references.
A future publication-reference contract requires separate review; do not weaken
its same-species foreign key to bypass this restriction.

Public portrait priority remains saved eligible Officer primary, approved direct
portrait fallback, approved observation fallback, then placeholder. The existing
Catalogue/Detail selector and binary privacy checks are preserved. Pending review
never enters this public selector.

In authorized pending review only, a request's whole-plant proposal requires the
explicit role, original ownership, matching species/observation, and atomic receipt.
The Officer request-photo alias and new `proposed-photo` route use it when verified;
otherwise they retain the original request-photo fallback. The original `/photo`
route, request bytes, approval handling and version history remain intact.
