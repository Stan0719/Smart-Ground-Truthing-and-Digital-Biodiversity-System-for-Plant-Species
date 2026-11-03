# Isolated enrollment-status compatibility proposal

Status: PREPARED AND TESTED, NOT APPLIED. No services restarted.

## Confirmed cause and scope

The existing `AuthoritativeFaceAuth.enrollment_status()` authenticates the caller,
then iterates `_templates()` across all subjects. `_templates()` validates pipeline
metadata before yielding a subject. An unrelated incompatible record can therefore
raise 409 `template_incompatible` before the caller's record is reached. `any()`
stops early, making the result sensitive to record order. This happens before
camera capture; it does not establish an Android camera defect.

The exact production metadata mismatch remains unknown. No production records,
embeddings, images, environment files or database connections were accessed by
this task. No schema changes are needed for this proposal.

## Smallest proposed change

Only `mobileapp/face_backend/authoritative_auth.py` would change after approval.
The complete proposed copy and unified diff are adjacent to this report.

Before:

```python
def _templates(self):
    # Validate each current template before yielding; include linked legacy data.
    ...

enrolled = any(subject == user['id'] for subject, _ in self._templates())
```

After:

```python
def _templates(self, subject_id=None):
    # In the existing current-template loop, BEFORE compatibility validation:
    if subject_id is not None and user_id != subject_id:
        continue
    # Existing compatibility validation and yield remain unchanged.
    ...
    # In the existing legacy loop:
    if subject_id is None or user_id == subject_id:
        yield user_id, json.loads(template)

enrolled = any(subject == user['id'] for subject, _ in
               self._templates(subject_id=user['id']))
```

Only authenticated enrollment-status supplies the subject filter. It comes from
the authoritative session, not a caller-supplied body field. Calls without a
filter continue validating every current template. Matching and duplicate checks
are not changed. Legacy provenance handling is unchanged; no new claim of legacy
compatibility is introduced. The SELECTs remain unchanged for a minimal patch;
this proposal does not optimize the existing full-table reads.

## Important limitation

This fixes an enrollment-status bug, not all enrollment/verification failures.
If the current user has no template, status can correctly return `enrolled: false`,
but subsequent registration still rejects incompatible unrelated templates during
the global duplicate check. Face login likewise remains strict. This is intentional:
silently dropping candidates could weaken duplicate or ambiguity checks.

A genuinely incompatible current-user template still returns 409. Resolving that
requires a separately authorized recovery decision. This proposal neither changes
stored metadata nor deletes, replaces or re-enrolls any user. Existing legacy
re-enrollment is not a universal replacement mechanism for current enrollments.

## Synthetic test results

Command from project root in CMD:

```cmd
.\mobileapp\face_backend\.runtime\python311\python.exe -B face-id-android-fix\test_proposal.py
```

Result: 15 tests passed, 0 failed. Ordering tests include 12 permutations.

| Requirement | Evidence / limit |
|---|---|
| A: Compatible current user | Status succeeds |
| B: Incompatible unrelated user | Status succeeds for enrolled caller; false for absent caller |
| C: Incompatible current user | Exact 409 / template_incompatible preserved |
| D: Ordering | Same caller result across all tested permutations |
| E: Existing compatible behavior | Original/proposed status contracts and matching candidates equal with synthetic fixtures |
| F: Reported rejection | Original failure reproduced and proposed status path succeeds with identical fixtures |
| G: Security | Authorization denial occurs before reads; strict global compatibility retained; enrollment still fails on incompatible candidates; existing enrollment not replaced; legacy scope retained |
| G: Unchanged methods | AST comparison confirms only _templates and enrollment_status differ; face_login, enroll, session, recovery and all other methods identical |
| H: Data protection | Fake database permits only synthetic SELECTs; original target SHA-256 unchanged |

Tests execute only class definitions extracted with AST, with fake dependencies.
They never import original application modules, initialize models, connect to a
database or network, or use real biometrics. Original and proposed full source
both parse successfully. The proposed module is not imported into the running app.

Real iPhone/Samsung registration, real verification, liveness, duplicate recognition,
cross-device verification, full HTTP integration, and password-login regression
remain UNTESTED. Structural preservation of those methods is not an end-to-end
security or device-compatibility guarantee. This work cannot certify iPhone or
Samsung functionality. Cross-device operation still requires genuinely compatible
templates and successful capture/matching/liveness checks.

No lint/typecheck of the mobile app was needed: no original mobile code changed.
No model/dependency/version/threshold/environment or API format changed.

## Files and baseline

- `prepare.py`: guarded generator; reads original source and writes only inside
  this directory; refuses to overwrite generated artifacts.
- `authoritative_auth.proposed.py`: complete reviewable proposed copy.
- `enrollment-status.patch`: unified diff; not applied.
- `test_proposal.py`: isolated synthetic regression suite.
- `baseline.json`: original target path and raw-byte SHA-256.

`deploy/cloudflared.exe` was already untracked before this task. It was not
created or modified by this task. Original project code remains unchanged.

## Integration only after explicit approval

1. Confirm the target still matches baseline.json and inspect the unified diff.
2. Preserve the exact original file for rollback, then apply only the reviewed
   authoritative_auth.py patch. Do not copy the entire proposal over newer edits.
3. Run isolated regressions again. Any broader tests must first be checked for
   database/network side effects. Real enrollment testing requires separate
   permission because it writes biometric data.
4. Restart only existing Terminal 3 (Python face service), using its exact current
   command. No extra service or permanent terminal is required. Terminals 1, 2,
   4, 5, 6 and 7 do not require restart for this backend-only patch.
5. Validate permitted device flows without deleting/replacing existing records.

All seven startup commands, ports, directories, gateway routing, tunnel and Expo
configuration remain unchanged. No integration or restart has occurred.

## Risks and rollback

Status may now succeed while later enrollment/face login still reports global
incompatibility. This is accurate separation of status from strict matching,
not a full recovery solution. Genuine current-user incompatibility is unresolved.
Malformed owner metadata keeps the existing failure behavior.

After an approved integration, rollback consists of reverting only this reviewed
patch (or restoring its preserved original if no intervening edits), then restarting
Terminal 3 with its existing command. This patch performs no data migration and
requires no database rollback. Reverting restores the original status bug.

STOPPED BEFORE INTEGRATION. Explicit approval is required to change original code.
