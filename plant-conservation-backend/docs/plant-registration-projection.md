# Plant registration and field Observations

`plant-registration.cjs` is an internal, batched resolver. It does not grant read
access: each endpoint must retain its parent Plant, Species, role and ownership
checks, and apply its existing location projection before returning coordinates.

## Sources

- Initial registration requires the existing receipt-backed Observation origin
  classifier. A raw `initial_registration` label or earliest timestamp is not proof.
- A matching Officer approval capture preserves registration values independently
  of later mutable Observation content. The capture must match the stored review
  ID, Observation, Plant, reviewer and approval timestamp.
- Later approved Plant changes require matching Plant/request/history IDs and
  ownership, approved request/review metadata, and a complete snapshot. Observation
  approval captures and `initial_registration_observation_edit` requests are excluded.
- Where an older deployment has verified receipt provenance but no approval
  capture, its approved initial-registration Observation is the documented legacy
  source, unless an Observation-only edit makes that live source ambiguous.
  Unverified origins, ambiguous registrations, malformed snapshots and
  missing referenced assets resolve to `state: unavailable`; the Plant remains listed.
- Photos come from the selected approved snapshot's exact references. Change-photo
  references resolve through that approved request's existing asset client keys,
  checked against the Plant and owner. Unrelated/unlinked assets are not fallbacks.

No location rows, asset bytes or historical records are rewritten by reads.

## API compatibility

`/api/plants` and `/api/plants/:id` add `current_registration` and
`latest_verified_observation`. Registration content is allowlisted and contains no
nested coordinates. Authorized registration location remains in the existing
top-level location fields and passes through the existing GPS policy. Plant preview
IDs and the default Plant gallery refer to registration photos.

`latest_approved` retains its previous updated-at Observation-summary meaning for
compatibility. New mobile registration consumers must not use it as registration.
`latest_verified_observation` selects by Observation creation date/ID, independently
of updates caused by a Plant edit. Public callers receive botanical summary fields
and authorized photo references only; staff location is separately projected.

Observation-specific reads/history remain distinct. Photo-byte access accepts the
verified current registration selection in addition to the current verified
Observation selection, with existing Species/publication and private owner/Officer
checks. This does not make every historical approved photo public.

## Edit safety and legacy limitations

Approved Plant edits use the resolver for content/photos and keep the existing
fingerprint, transaction and locking safeguards. An unrelated Observation approval
does not change that base. An old genuine Plant edit that targeted a subsequent
Observation can be displayed from its approved snapshot, but further editing is
blocked rather than mutating that unrelated Observation again. Reconciliation of
such legacy relationships requires a separate reviewed decision.

The existing origin classifier may also leave legacy Species-changing registrations
unavailable if their receipt/request relationship cannot be verified against the
current Species. No request relationship is guessed or repaired by this change.

Deploy backend and mobile changes together. Restart/redeploy the backend through
the normal operational process; tests alone do not activate a running service.
