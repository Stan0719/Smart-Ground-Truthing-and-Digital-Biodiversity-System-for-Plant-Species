# Mobile test defect register

These are observed test-harness issues, not proven production bugs. No production source or backend behavior was changed in this phase.

| ID | Severity / priority | Reproduction and actual | Expected | Cause and fix | Retest / status |
|---|---|---|---|---|---|
| TEST-M01 | Harness; medium | Species detail and Plant card VM cases failed `Unexpected import ../hooks/useDatabaseTranslations` | Screen behavior is evaluated with all current dependencies | Recent database-translation hook was absent from test dependency maps. Added a source-text fallback mock. | Focused and final permitted mobile suite passed; verified |
| TEST-M02 | Harness; low | Plant detail title fragment threw `translatedSpeciesCommonName is not defined` | Isolated fragment declares all values used by the current screen | Added current translated-name binding to fragment fixture; no screen edit. | Focused and final suite passed; verified |
| TEST-M03 | Harness; low | Timeline source assertion expected `plant.observations`, while current safe access uses `plant?.observations` | Assertion recognizes optional access | Updated assertion to match current safe expression. | Focused and final suite passed; verified |

New `TC-TRANS-01` checks actual fetched Species fields, rendered translation result and public-only/account scope across Guest, Visitor and Botanist. Further genuine functional defects require reproduction through an isolated API or phone. Do not classify unrun historical issues as fixed.

## Phase 2

No production defect was reproduced in the new scoped integration cases. The first run of the new test fixture failed because PGlite `query()` accepts a single prepared statement while `schema.postgres.sql` contains multiple statements. The backend-local fixture now uses PGlite `exec()` for schema setup; four final database cases pass. This was a new test setup issue, not an application defect. The new HTTP client/route case passed after using `--test-isolation=none`, required by this managed environment's child-process `spawn EPERM` restriction.

## Phase 3

No production code defect was established. During test development, a Species Request returned HTTP 500 when the isolated fixture had migration 004 but lacked the later `proposed_species_id` column from migration 006. Applying the existing migration **only to the disposable PGlite instance** corrected the fixture; the final route test passed. A Plant detail request initially found no QR inventory table in the base fixture; applying existing migration 014 in memory corrected that test setup. Neither finding proves a deployed defect. No production source or schema was changed.

## Phase 4

No functional defect was reproduced in the executed workflow cases, and no production code was changed. An intermediate test expectation assumed a superseded Species correction version, but the tested legacy `appendVersion` contract retained `Correction Required` on that prior row and added a new Pending Review row; the assertion was corrected to match the stored history. This is not classified as a production defect. The newer immutable revision migration path remains untested.
