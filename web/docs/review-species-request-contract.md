# Linked species request: Officer web integration boundary

The Officer web consumes explicit request metadata from the active observation
APIs and persists species decisions through the plant backend. No request is
inferred from names, species ID values or mobile prototype arrays. This web
integration does not change mobile, schema, migrations or authentication.

## Observation response additions

Existing `GET /api/observations` and `GET /api/observations/:id` retain their current
fields, including raw `id`, `revision`, `content`, `assets` and species names.

- Ordinary submission: omit `species_request_id` and `species_request`, or use null.
- Request submission: include `species_request_id` (string/number) and ideally an
  embedded `species_request` object. ID-only references display unavailable and lock
  plant decisions; they do not trigger a guessed request endpoint.
- A declared dependency must remain represented after approval and on every read.
  The deployed backend associates requests through their proposed-species foreign
  key. The web consumes that relationship without reconstructing it.

```ts
species_request: {
  request_id: string | number,
  request_status: string,
  proposed_scientific_name?: string,
  suggested_common_name?: string,
  genus_name?: string,
  family_name?: string,
  conservation_status?: string,
  description?: string,
  habitat?: string,
  requested_by?: string | number, // server-authoritative identity/display value
  submitted_at?: string,
  review_comment?: string,
  approved_species_id?: string | number | null,
  proposed_species_id?: string | number | null,
  assets?: { id: string, content_type: string }[]
}
```

The backend normalizes its stored request names into this projection. Request
photos use protected same-origin `/api/data/assets/species-request-<id>` URLs;
image failures do not prevent reviewing the request.

## Dependency gate

Pending/Pending Review, Rejected, Correction Required, unknown, malformed and
unavailable requests lock **all** plant decisions. Approved alone is insufficient.
Unlock requires an Approved request, a positive numeric `approved_species_id`, the
same value in observation `species_id`, and a nonempty observation `scientific_name`.
Numeric species IDs follow the existing backend species contract; request and
observation IDs remain strings, including UUID observation IDs.

Resulting species names come from the refreshed observation, not proposed values.
The web does not infer conservation status or visibility for the resulting species
from the proposal. Additional resulting-species fields can be agreed later.

Refreshing resolution uses the existing observation-detail GET. Failures preserve
the observation and lock decisions. Opening another modal resets request comments,
errors and loading state. No-request submissions retain Phase 2 behavior.

## Species decisions

`POST /api/species-requests/:rawRequestId/review` sends `decision` and
`comment`, plus `visibility` for approval. Visibility must be explicitly selected
as `public`, `internal`, or `protected`; there is no default. Decisions are Approved, Rejected and Correction Required. Rejection
and correction require nonblank feedback; all comments are limited to 4000
characters. The request table has no revision column, so the web sends no request
revision, reviewer identity, observation ID or resulting species ID.

Species and plant comments and saving states are separate. While saving, duplicate
actions and modal close/switch are blocked and plant review remains locked. After
`reviewed: true`, the web refetches observation detail; it never uses POST response
metadata to optimistically approve or unlock the observation.

A 409 reloads the latest observation, preserves the typed species comment and
does not resubmit. Uncertain POST outcomes or failed readback require a successful
refresh before retrying. Saved-but-unverified decisions are reported separately
from failed saves. Route changes during saving are applied after completion.

The backend independently enforces permissions, self-review, transitions, row
locking and species-first observation review. Rejection/correction of a species
request does not automatically decide the observation. No live request approval
is necessary for UI verification.
