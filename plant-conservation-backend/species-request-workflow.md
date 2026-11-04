# Reconciled species-request workflow

The teammate submission, list/detail, photo and review routes remain available.
The domain injects its transaction, audit and validation helpers into the request
module and mounts it once. The request module never imports the domain.

Migration 004 defines standalone requests. Migration 006 adds proposed_species_id.
Atomic /api/plant-submissions creates a pending species, plant, observation and
request together, with proposed_species_id pointing at that species. Standalone
/api/species-requests creates no species or plant; approval creates taxonomy and
a species and stores approved_species_id. No migration is run by the application.

Observation projection and plant review use proposed_species_id OR
approved_species_id against plant_record.species_id. Neither names, timestamps,
owners nor client keys infer a relationship. Multiple matching requests fail
closed. A mismatched proposed/approved association also fails closed. Requests
with neither reference cannot be linked to observations; they remain available
through the request list/detail workflow. All observations of a linked species
share its dependency because there is no direct request/observation foreign key.

All plant decisions require linked requests to be unambiguously Approved with
the approved species matching the plant and any proposed species matching too.
The canonical species name must be nonblank. Species approval never approves a
plant automatically. Existing observation revision and permission checks remain.

Request review accepts decision, comment and visibility. Approval requires an
explicit public/internal/protected visibility. Rejection and correction require
feedback. Self-review is denied; review status, audit and existing version-history
updates remain transactional. Proposed species are reused; standalone approval
creates a species. Duplicate scientific-name checks are preserved.

The teammate authenticated /api/species-requests/:id/photo remains supported.
The Officer gallery uses the protected compatibility alias
/api/assets/species-request-:id through /api/data/assets/.... Stored photos have
already been normalized during submission. No synthetic asset row is created for
the gallery alias. Observation embeddings retain the Officer metadata contract;
list/detail responses retain the teammate contract. Review additionally returns
reviewed:true for the Officer form, which refetches the observation before unlock.

Tests use isolated PGlite with no environment loading or external database.
These do not prove multi-connection PostgreSQL concurrency behavior. An existing
deployment requires the columns from 004 and 006; this task applies no migrations.
