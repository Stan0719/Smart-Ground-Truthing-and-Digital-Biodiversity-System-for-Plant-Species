# Plant gallery metadata API (Phase 2A)

`GET /api/plants/:plantId/gallery?limit=20&cursor=...`

Web gateway equivalent: `/api/data/plants/:plantId/gallery`.
This endpoint returns metadata only. It does not upload images, modify data,
create workers, or activate reconciliation. No schema migration is required.

## Parameters

- `plantId`: positive existing integer plant ID (not a formatted PL identifier).
- `limit`: 1–100; default 20.
- `cursor`: opaque continuation from the previous page, bound to plant and scope.
- `scope=mine`: optional existing Botanist ownership view. Other roles are denied.
  This uses the same explicit owner exception as existing plant/image reads.

Unknown parameters and malformed/mismatched cursors return 400. An unavailable
plant returns 404 without hidden image counts. Existing role/session restrictions
still apply (including Administrator exclusion from plant reads). Storage failures
use the existing sanitized 503 handler. No new credentials or pool settings exist.

## Response

```json
{
  "plant_id": "1",
  "assets": [
    {
      "asset_id": "example-photo",
      "content_type": "image/jpeg",
      "observation_id": "101",
      "linkage": "observation",
      "effective_origin": "initial_registration",
      "observation_date": "2026-11-05T03:44:37+00:00",
      "observation_status": "Pending Review",
      "observation_revision": 1,
      "photo_order": "0"
    }
  ],
  "page": { "limit": 20, "has_more": false, "next_cursor": null }
}
```

The example review context is for an authorized Officer or observation owner,
not a public response. `observation_date` is the observation's creation time,
not EXIF capture time. Date, current status and current revision are null for
public viewers and for a Botanist viewing somebody else's approved evidence.

`photo_order` is the persisted numeric photo-index suffix represented as a
decimal **string**, preserving values beyond JavaScript's safe integer range.
It is null when that information is unavailable. It is never a photo category.
The API does not expose client keys, owner identities, GPS, content bytes,
private paths, storage URLs, or authentication data.

Unlinked assets have `observation_id: null`, `linkage: "unlinked"`,
`effective_origin: "unknown"` and null observation context. Linked historical
observations with unknown provenance retain their real ID and unknown origin.
Broken cross-plant references are excluded; they are not relabeled as unlinked.

## Privacy

Parent visibility follows existing plant reads. Image eligibility mirrors the
plant-image branch of `/api/assets/:id`: current species visibility and approval,
approved plant plus approved linked observation (or approved unlinked image),
with the existing asset-owner/Officer and explicit owner-scope exceptions.
Approval of an observation is authoritative for its linked evidence; the asset's
old approval flag alone does not override a Draft/Pending observation for visitors.

Public users never receive pending plant/evidence metadata. Officers can inspect
currently permitted pending evidence, including restricted species. Botanists
retain existing owner exceptions; unrelated pending evidence stays unavailable.
Every continuation rechecks the current viewer and filters rows BEFORE the page
limit. There are no hidden-asset totals or unfiltered scan counts.

The content endpoint remains the final authority. Metadata does not guarantee
that an image remains accessible after a later review, deletion or role change.
For Botanist `scope=mine` access, the content request must retain that same
explicit scope where required by existing `/api/assets/:id?scope=mine` rules.

## Ordering, grouping and pagination

Ordering is `(linked observation ID or empty string, numeric-order-present first,
numeric photo index, asset ID)`. Unindexed ties use stable asset-ID order, never
an inferred category. The keyset cursor contains no dates or account details.
It is untrusted input; access is always re-evaluated regardless of cursor values.

A group may span multiple pages. Accumulate pages, deduplicate by asset ID, and
group by real `observation_id`. Use effective origin to separate initial,
subsequent and unknown provenance. Keep unlinked assets separate. Clients with
authorized observation dates may sort completed groups chronologically. Public
clients should retain server order rather than invent dates.

One request borrows a client from the existing pool for a short repeatable-read,
read-only transaction. The asset query is plant-scoped and returns at most
limit+1 metadata rows. Origin classification is batched by distinct observations,
not queried separately for every asset. No new pool or standalone connection is
created. Query plans at large deployment volumes may need separate review;
no indexes or migrations are introduced here.

Pages are not one long database snapshot across HTTP requests. Concurrent changes
can alter later pages; reload the gallery when its context changes. Current
observation revision is context only: the database does not establish historical
asset ownership by revision, so neither this API nor its client may invent it.

## Frontend integration (separate phase)

1. Wait for the verified session and authorized Plant Detail response.
2. Fetch the plant-scoped gateway route. Follow every returned cursor to complete
   the gallery, or provide an explicit load-more control; never claim a partial
   page is the complete image count.
3. Group and order as above. Reference photos remain in the species gallery.
4. Use the Phase 1 `assetImages.ts` mapper for content URLs. Explicit Botanist
   owner-scope support, if used, must preserve the non-secret `scope=mine` query
   without allowing arbitrary external URLs or token parameters.
5. Cancel/ignore old loads on route, account or role changes; clear prior private
   metadata immediately. Handle 400/401/403/404/503 and broken image loads safely.

No frontend gallery is implemented in Phase 2A. No live browser rendering or
live gallery API response is verified by the isolated tests. Deployment/restart
is a separate authorized operation.
