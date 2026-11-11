# Saved plant images in the species catalogue

## Root cause and stored-image evidence

The upload succeeded. Read-only database inspection found three JPEG plant_asset
rows attached to existing Plant 8 and its approved observation. All three plant
photos were approved, each containing 220,644 bytes. Plant 8 references Species 6,
which remains public and Approved. The separate species-request photo is also
stored, but its asset approval flag is false; this task did not change that flag.

The catalogue and species-detail responses previously contained no image reference.
mapBackendSpecies also discarded image information. Species.js already called
getSpeciesImageSource, but newly created API species have no bundled local image,
so the existing conditional renderer displayed its localized Coming Soon text.
That text was a fallback, not evidence of a missing upload. Reuploading or creating
another record was unnecessary.

## Fix

The existing species list and detail SQL now select an eligible preview asset:

- An approved JPEG attached directly to the species takes priority.
- Otherwise, use an approved JPEG from a linked Approved plant's Approved
  observation. A pending/rejected observation or unapproved photo cannot be used.
- Plant previews prefer the latest approved observation, then a deterministic
  plant ID ordering and the existing upload photo index (photo:0 before photo:1).
- Observation photo arrays now also preserve that upload order for My Plant
  Records thumbnails. Remaining ties use creation time and stable asset ID.

The existing species response projection adds image_asset_id and a relative
image_url when an eligible preview exists. The mobile mapper constructs the
actual image source from the configured Plant API base and asset ID, never from
localhost or an arbitrary externally supplied URL. Authenticated reads attach
the current session header; public reads carry no credentials. The existing image
helper and Species.js renderer use that source without UI or placeholder changes.
Species details use the same mapping. Existing bundled-image behavior is preserved.

Species visibility filtering still applies before projection, and the asset read
endpoint retains its existing access checks. No authentication, role grants,
Face ID, QR logic, photo upload behavior or approval workflow was changed.

## Files changed

- plant-conservation-backend/domain.cjs: eligible preview selection and stable
  observation-photo ordering.
- shared/rbac.cjs: species response image metadata only; grants are unchanged.
- mobileapp/utils/plantApi.js: current-API image sources and session headers.
- plant-conservation-backend/test/species-images.test.cjs (new).
- mobileapp/scripts/species-images.test.mjs (new).
- mobileapp/scripts/species-catalog.test.mjs: real catalogue Image source assertion.
- This report.

## Executed checks

68 targeted tests passed together, covering preview priority, upload order,
empty-image fallback, pending/unapproved exclusions, public/internal/protected
access, native source/header mapping, the existing Species.js Image render,
submission rollback/idempotency, owner thumbnails, refresh, session handling and
English/Malay localization. The RBAC suite also passed in an earlier targeted run.
Expo lint and TypeScript checking passed.

After the Plant API restart, actual local, gateway and public Cloudflare species
detail responses returned the existing Plant 8 photo as Species 6's preview.
The public HTTPS image request returned HTTP 200, image/jpeg and 220,644 bytes.
Its SHA-256 matched the stored photo bytes exactly. Protected Species 1 and 2
continued returning 404. The first immediate request during backend startup did
not yet contain a usable preview; subsequent ready-service checks passed at all
three routes.

On the connected physical iPad, the normal dashboard refresh loaded Plant 8's
thumbnail and its native Image component was mounted with the owner-scoped source.
Opening the species catalogue loaded Species 6's preview and mounted its Image
component without a catalogue error. React Native's on-device image loader decoded
both actual sources successfully at 1920 by 1080, using their existing headers.
This is native image-loading/runtime verification; no screenshot-based visual
review was performed. Credentials stayed on the device and were not logged.

The upload was already recoverable and is now referenced for display; no recovery
write, duplicate record, image rewrite or database migration was needed. This task
made no production database writes or visibility/status changes. No packages were
installed and nothing was committed or pushed.

The Plant API was restarted to load the preview query, and the running Expo app
received the mapper update during the iPad check. No additional manual backend
restart is currently needed. Reload Expo Go only if another device still has an
older bundle.
