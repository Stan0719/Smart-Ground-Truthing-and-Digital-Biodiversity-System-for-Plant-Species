# Botanist workflow handoff

This describes the mobile app and supporting backend currently present in this repository. It is a contract for Conservation Officer integration, not a claim that every Officer Web screen is complete. The deployed Observation baseline has Migration 029, no Migration 030, and no `observation_submission_version` rows at the last read-only check. Do not require `submission_version_id` for current original Observation review.

## Common rules

- Authenticated Botanists create and change their own submissions. Backend ownership and role checks are authoritative; hiding a mobile button is not a permission boundary.
- `Pending Review` is actionable by an authorized Officer. `Correction Required` returns work to the owner. `Approved` content remains current while a separate edit proposal is reviewed. `Rejected` and `Withdrawn` are closed for the affected original submission. Existing historical `Superseded` entries are read-only.
- A form's Cancel button discards local input. **Withdraw** closes an eligible original submission. **Cancel Edit Request** closes an eligible pending or correction-required proposal. Neither cancellation endpoint deletes the approved base record.
- The backend returns conflicts (normally HTTP 409) for stale revisions, duplicate active requests, changed photos, or ineligible statuses. The mobile app shows the error and retains form data; details and lists reload after successful actions.
- English and Malay labels are present. The shared translation catalogue also requires Chinese key parity.

## Plant registration and review

`AddPlant.js` sends `POST /api/plant-submissions` with the registration, initial Observation, selected Species or linked Species request, QR assignment, photos, and client key. The backend validates the linked records and submits atomically. The initial-registration Observation belongs to this Plant workflow.

Botanist Plant Details and My Submissions display the current status, Officer feedback, photos, and available history. Eligible original Pending Review records may be edited through `EditPlantRecord.js`; Correction Required records use the appropriate correction route. An approved Plant is edited through a separate `record_change_submission` proposal. The approved Plant remains current until the proposal is approved. Rejected or cancelled proposals do not replace it.

| Operation | Backend contract | Important response or guard |
| --- | --- | --- |
| Check original withdrawal | `GET /api/plant-submissions/:plantId/withdrawal` | Owner-scoped eligibility; the mobile screen uses it before showing Withdraw. |
| Withdraw eligible original | `POST /api/plant-submissions/:plantId/withdraw` with `{}` | `{ withdrawn: true, ... }`; confirmation, row locks, dependency checks, then mobile refresh. Cannot withdraw an Approved Plant. |
| Create approved edit | `POST /api/record-changes` with `{ kind: "plant", target_id, proposed, client_key }` | Returns `{ change }`; rejects duplicate active proposals and changed approved base. |
| Correct edit request | `PATCH /api/record-changes/:id` with `{ revision, proposed }` | Exact request revision required. |
| Cancel eligible edit | `POST /api/record-changes/:id/cancel` with `{}` | Returns `{ change }`; owner and status/revision checks, with confirmation and refresh in mobile. |
| Officer review | `POST /api/record-changes/:id/review` with `{ decision, comment, revision }` | Existing Officer contract; do not change its completed Plant behavior. |

Plant photos, QR assignment, linked Species requests, and version snapshots have independent validations. Cancellation of a pending Plant edit must leave the Approved Plant, QR mapping, and public content intact. Original withdrawal has stricter Plant, initial Observation, linked Species and QR dependency checks.

## Species requests and review

`AddSpeciesRequest.js` sends `POST /api/species-requests` with botanical fields, a JPEG/PNG photo, and `client_key`. A request may be standalone or linked to a Plant registration. The backend preserves this distinction and blocks unsafe dependency changes. `BotanistSpeciesRequestDetail.js` displays review status and feedback; `EditSpeciesRequest.js` handles supported original correction and approved edit proposals.

| Operation | Backend contract | Important response or guard |
| --- | --- | --- |
| Read own request and photo | `GET /api/species-requests/:id`; `GET /api/species-requests/:id/photo` | Owner or authorized Officer only. |
| Withdraw eligible original | `POST /api/species-requests/:id/withdraw` with `{}` | `{ withdrawn: true, species_request }`; owner, status, review-cycle and linked-record checks. Approved Species cannot be withdrawn. |
| Create approved edit | `POST /api/record-changes` with `{ kind: "species", target_id, proposed, client_key }` | Separate proposal; approved Species content remains current. |
| Correct or cancel edit | `PATCH /api/record-changes/:id` with `{ revision, proposed }`; `POST /api/record-changes/:id/cancel` with `{}` | Request revision and cancellation eligibility are enforced by the backend. |
| Officer original review | `POST /api/species-requests/:id/review` with `{ decision, comment, visibility? }` | Approved review requires valid visibility. Existing Officer contract must remain intact. |
| Officer approved edit review | `POST /api/record-changes/:id/review` with `{ decision, comment, revision }` | Existing completed Species review behavior must remain intact. |

Species original withdrawal is not the same operation as cancellation of an approved Species edit. Linked Plants and other requests can block withdrawal. The mobile app confirms destructive actions, shows backend conflicts, and refreshes detail/list state.

## Observation submission and review

`FieldCollection.js` and `fieldSync.js` create an Observation through `POST /api/observations`, update an eligible draft or pending original through `PATCH /api/observations/:id` with `{ content, revision }`, and submit through `POST /api/observations/:id/submit`. New field Observations remain separate from the initial-registration Observation owned by the Plant registration workflow. Camera/gallery selection, offline draft and photo upload remain part of the mobile flow.

The current original Officer review contract is **`POST /api/observations/:id/review` with `{ decision, comment, revision }`**. The backend locks `plant_observation` with `FOR UPDATE`, enforces Officer permission and self-review rules, compares the current revision, validates status and Plant/Species dependencies, then persists `observation_review`, audit and notifications. Pending Review supports Approved, Rejected, Correction Required and Flagged according to backend authorization; Flagged is distinct from Correction Required. The Officer must reload and submit the displayed revision. A stale decision returns 409.

Original Correction Required Observations use the eligible canonical correction/resubmission route. Eligible subsequent originals may be withdrawn with `POST /api/observations/:id/withdraw` and `{}`; the backend checks owner, status, correction-resubmission lock, active edits, verified origin and approved parent Plant. Approved Observations cannot be withdrawn. Initial-registration withdrawal remains part of the Plant submission.

Approved Observation changes use `observation_edit_request`, separate from original review:

| Operation | Backend contract | Important response or guard |
| --- | --- | --- |
| Capability, list and detail | `GET /api/observation-edits/capabilities`; `GET /api/observation-edits`; `GET /api/observation-edits/:id` | Capability reports request availability and whether the optional 030 workflow exists. Current deployed behavior has `versioning_available: false`. |
| Create edit | `POST /api/observation-edits` with `{ observation_id, client_key, content, photo_ids?, photos? }` | `{ edit }`; owner, Approved base, duplicate request, photo and idempotency checks. The approved Observation stays unchanged. |
| Correct edit | `PATCH /api/observation-edits/:id` with `{ revision, content, photo_ids?, photos? }` | Correction Required only; revision and approved-base checks. |
| Cancel eligible edit | `POST /api/observation-edits/:id/cancel` with `{}` | `{ edit }`; owner and status/revision checks; leaves the approved canonical record intact. |
| Officer edit review | `POST /api/observation-edits/:id/review` with `{ decision, comment, revision? }` | Backend accepts legacy callers without revision; if supplied, a stale revision returns 409. Mobile Officer review sends its displayed revision. Do not claim Officer Web support until integrated there. |
| History and photos | `GET /api/observations/:id/edit-history`; `GET /api/observation-edits/:id/photos/:index`; historical version photo route where available | Owner/Officer access checks. Only persisted history and photo references are shown. |

`NotificationObservation.js`, My Observations, Dashboard and Botanist Notifications show current details, exact selected review feedback and permitted actions. Notification deep links use the Observation or edit request ID. Historical selections are read-only. The pre-030 workflow must not promise a new immutable submission snapshot for every original review; Migration 029's table is retained for compatibility and was empty at the last live inspection. Migration 030 is undeployed.

## Officer Web work and integration tests still needed

- Plant and Species Officer Cancel Request screens are unfinished. Backend Botanist cancellation exists; confirm the Officer queue removes a cancelled request and a stale review receives a conflict.
- The Officer Observation UI is incomplete. Confirm original Pending Review and Flagged decisions use the current Observation revision, show and require feedback as appropriate, and handle 409 by reloading. Do not send `submission_version_id` for the current workflow.
- Confirm Officer handling of approved Observation edit requests, including correction, rejection and approval with the exact displayed request revision. The backend endpoint exists; an Officer Web flow has not been independently verified.
- On a completed Officer Web build, manually exercise two-Officer races, notification deep links, linked Species/Plant approval ordering, and old-versus-new photo access. Automated isolated tests cannot prove the unfinished Web interface or real multi-session PostgreSQL concurrency.

## Test evidence and limits

At handoff preparation, the full mobile suite passed **439/439**. The full backend suite reported **493 passed, 0 failed, 2 skipped** using isolated fixtures. Mobile TypeScript and targeted ESLint completed with zero ESLint errors; `git diff --check` passed. Tests cover owner/Officer permissions, status conflicts, corrections, cancellations, withdrawals, history, photos, QR dependencies, notifications and navigation. These results verify the repository's mobile/backend paths, not the incomplete Officer Web screens or a production end-to-end review.
