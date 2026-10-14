# iPhone liveness investigation — 13 October 2026

**Live Face Login is not confirmed fixed.** The corrected observer has now completed inference on the user's real iPhone capture. Fasnet accepted it; SFace subsequently found no matching enrollment at the unchanged 0.30 threshold. No authenticated session was issued.

## Verified request causes

| Reference | Observed stage | Cause |
| --- | --- | --- |
| `42e4ac03ec9b` (earlier investigation) | JPEG decoding/EXIF normalization succeeded, then Fasnet/DeepFace raised `SpoofDetected`; HTTP 422 `liveness_rejected` | Model rejected the capture before matching. The historical log contains no class confidence, so low confidence cannot be inferred. |
| `ff4bacd92f57` | Decoding succeeded, detection began, no anti-spoofing-start diagnostic; HTTP 400 | The newly added observer accepted `image=`, while installed DeepFace calls `analyze(img=..., facial_area=...)`. Python rejects the unexpected keyword before inference. |
| `e03521564c7a` | Same pattern; HTTP 400 | Same observer keyword-interface defect. This is not evidence of a low-confidence prediction. |
| `5e8d5954286a` (fresh physical iPhone retry) | Fasnet passed, SFace embedding generated, matching rejected; HTTP 401 `face_not_matched` | No stored identity passed the unchanged cosine-distance threshold of 0.30. This attempt is not an anti-spoofing rejection. |

### Fresh iPhone evidence: `5e8d5954286a`

The request called `/face-login` with a validated one-use challenge. Its JPEG decoded at 916×720 with EXIF orientation 6 and was transposed to 720×916 BGR uint8, three channels. The detected bounding box was within the image; its area was 55.7% of the frame. Fasnet's upstream boundary rule reduced both requested context scales (2.7 and 4.0) to 1.19. The observer reported **passed**, winning-class confidence band **high**. Detection found one face with eyes located and alignment enabled, and SFace generated a 128-dimensional embedding. `matching_completed` then reported **zero matches**, threshold **0.30**, followed by `face_not_matched`.

This verifies that the keyword-interface repair runs through actual iPhone inference. It does not establish general liveness accuracy, visual crop quality, or the reason this capture differs from the existing template. No photo was retained and no individual match distance was logged. Reduced context is observable, but this successful liveness decision does not justify blaming it for a spoof rejection or changing preprocessing. The historical enrollment image/provenance is unavailable; identity mismatch, historical pipeline differences, pose/capture variation and threshold suitability cannot be distinguished from this trace alone. No threshold, model decision or enrollment was changed in response.

A read-only database audit after this attempt found one preserved legacy template (128 dimensions), zero real-account templates and zero account links. The matcher includes that unlinked legacy template, so missing linkage did not cause this particular `face_not_matched` result. Even a successful match would still require explicit authenticated linking to an eligible real account before a real session could be issued. No link was created and no account restrictions were changed.

The erroneous observer was introduced by the preceding diagnostic change. The original liveness rejection predates it. The server previously caught internal TypeError together with input ValueError, incorrectly reporting the integration defect as a bad client request.

## Exact changes

- `face_backend/spoof_diagnostics.py`: preserves the exact upstream `analyze(img, facial_area)` keyword interface and invokes the original with those keywords. It remains idempotent and returns the original decision/score unchanged. No inference retry or score override is added.
- Safe diagnostics now include BGR input dimensions/channels/dtype, whether the face bounding box fits the image, coarse face-area fraction, requested/effective context scales, expected 80×80 input and winning-class confidence band. The band is informational only and does not alter acceptance. No photos, crop pixels, embeddings, raw scores, credentials or session tokens are logged.
- `face_backend/server.py`: internal TypeError now reaches the existing sanitized service-failure handler (503, exception type/stack locations), rather than being mislabeled as invalid request (400).
- `face_backend/test_spoof_diagnostics.py`: exact keyword-call regression, unchanged acceptance/rejection, original input-object/bounding-box preservation, no retry and exception propagation.
- `face_backend/test_image_pipeline.py`: actual startup-instrumented DeepFace/Fasnet integration and an actual-model public-fixture rejection test.
- `face_backend/test_http.py`: internal TypeError is 503, does not leak exception details, and does not stop the service.

The Expo capture settings, JPEG processing, orientation normalization, facial templates, model weights, matching threshold, upstream liveness decision rule, account roles/statuses and authoritative session verification are unchanged.

## Input/preprocessing findings

1. Historical iPhone frames decode as JPEG 916×720 with EXIF orientation 6 and normalize to 720×916. The decoder uses EXIF transpose, RGB conversion, then contiguous BGR uint8 arrays with aspect-preserving size bounds. This is internally consistent. It does not prove the person's visual pose because no photo was retained or inspected.
2. Installed DeepFace's detection module gives Fasnet the complete original BGR image and a clipped `(x,y,w,h)` face rectangle. Fasnet builds its own two contextual crops at 2.7/4.0 scales, constrained to fit the source, then resizes them to 80×80. It does not use the aligned SFace embedding crop as the liveness input.
3. Installed Fasnet converts BGR crops to CHW float32 without dividing by 255. The observer delegates this unchanged; adding conventional 0–1 normalization would be a different preprocessing policy, not a justified fix.
4. The two models are MiniFASNetV2 and MiniFASNetV1SE. Their softmax outputs are summed. Winning class 1 is live; the returned score is confidence in the winning class, not always confidence in liveness. A rejected high-band result can therefore mean a high-confidence non-live prediction. Bands (<0.6, 0.6–<0.8, ≥0.8) are diagnostic bins only, not new authentication thresholds.
5. The actual startup test receives BGR uint8, three channels, valid bounding box and unchanged original model behavior. One public fixture has effective context scales 1.79/1.79 despite requested 2.7/4.0, showing how frame size and face size constrain context. This is the upstream crop rule, not proof of a defect.
6. Camera capture uses processed front-camera JPEG, quality 0.8 and mirror=false. JPEG compression, camera processing, pose and available surrounding context may affect a texture classifier, but causality for the user's rejection is not established. No forced crop/stretch, alternative orientation retries after spoof rejection, or quality setting change was applied.

The upstream Android demo limits its input ratio to 3:4, whereas 720×916 is approximately 0.786 rather than 0.75. That demo convention is not proof that arbitrary ratio frames violate the model's crop interface. The upstream README explicitly describes camera/scene dependence and requires a complete face with limited pose rotation. These support controlled capture evaluation, not automatic cropping or weaker acceptance:

- [Upstream camera/scene guidance](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing/blob/master/README_EN.md)
- [Upstream demo and input-ratio convention](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing/blob/master/test.py)

## Actual-model results

- **42 Python tests passed, no failures/skips**, with actual public portrait fixtures enabled, plus isolated real Node/Python account integration.
- Startup-instrumented public `img1` passes Fasnet and generates a valid 128-dimensional SFace embedding through DeepFace's real keyword call.
- Public `img5`, processed at quality 85 with the same 1600-pixel bound, remains rejected with `liveness_rejected`; its actual winning-class band was moderate. The wrapper does not turn it into acceptance.
- Rotation/mirror/EXIF, blank-image, existing enrollment, account restrictions, ambiguous/unknown matches, sessions and revocation regressions pass.
- **27 client face/session/routing tests passed**; mobile lint/type checking passed. Frontend code was unchanged in this turn.
- An injected internal TypeError safely returns 503. It is a controlled integration-failure test, not a remaining observed exception in successful real-model inference.
- Legacy template count remains one. No account, role, suspension, password or template was altered by agent tests.

Public static-photo fixtures are smoke/regression tests, **not** evidence of real-person liveness or presentation-attack performance. One actual iPhone capture now passed liveness. Eligible account authentication and correct dashboard access remain unverified.

## Physical iPhone validation

The corrected services are already running. Backend reload was necessary to replace the faulty observer. Expo does not need to be restarted for this Python-only change.

1. Use a real eligible account whose facial enrollment is explicitly linked, or perform the separate previously documented authenticated linking process. Do not delete/re-enroll or change roles to test liveness. An unlinked face may be rejected later with `account_not_linked`, independently of liveness.
2. Hold the phone upright in even lighting with the whole face and surrounding context visible; keep the face roughly frontal. Leave email/password blank and press **Login with Face ID**. If the automatic first capture fires before positioning, use the existing retry button after settling; each retry gets a fresh challenge/reference.
3. Send only the new error/reference or confirmation of success. No photo, code, password or token is needed. The operator correlates:
   - `image_decoded` / `image_normalized`: dimensions, EXIF handling, BGR.
   - `anti_spoofing_started`: boundingBoxValid, input dtype/channels, effective context scales.
   - `anti_spoofing_decision`: passed/rejected and winningClassConfidenceBand.
   - `matching_completed`, `session_created`, authoritative `session_verified`, frontend verification and dashboard navigation.
4. Missing `anti_spoofing_started` followed by 503 indicates an integration/service failure rather than a model prediction. A valid bounding box/input followed by a rejected decision locates rejection in inference; it does not prove camera-domain reliability or ideal crop quality.
5. A successful liveness decision must still pass identity matching and current account restrictions. Confirm the correct account/dashboard, log out, and repeat with a new capture. Do not count a model-only pass or public-fixture success as a repaired login.
6. With consent, evaluate multiple live captures and separately labeled presentation attacks across devices, lighting, face distances and poses. Hold out subjects/sessions; report bona-fide rejection and attack acceptance with denominators and uncertainty. Synthetic pose variants are not independent live samples. Retain metadata only unless separate consent explicitly authorizes image collection.

## Supported alternative

[AWS Rekognition Face Liveness](https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness.html) provides a short prompted video-selfie flow with React web, native iOS and Android components and backend result verification. Its probabilistic result is not a perfect guarantee. Native iOS integration would require a native Expo development build/bridge; it is not a drop-in Expo Go component.

A candidate architecture would bind an expiring provider liveness session to a server-owned one-use attempt, verify results from the server, use the corresponding reference image for matching, reject unknown/ambiguous subjects and request a session from the existing authoritative account service only after current role/status checks. Never trust a client `live:true` flag or switch a failed Fasnet attempt to an easier verifier automatically. Evaluate thresholds, consent, cloud processing/retention, region/cost and provider SDK maintenance first. No provider account, SDK or cloud transfer was installed/activated in this turn.

For passwordless account authentication rather than remote face-photo verification, platform passkeys are another separate design, requiring authenticated credential enrollment and server-verified challenge signatures. A local Face ID boolean alone is not remote authentication proof. Existing facial templates can remain preserved. This is not implemented or claimed equivalent to raw-face liveness.

## Reproduction command

From the repository root:

```bash
cd mobileapp/face_backend
FACE_TEST_PORTRAIT=/tmp/niah-public-fixtures/img1.jpg FACE_TEST_NEGATIVE_PORTRAIT=/tmp/niah-public-fixtures/img5.jpg FACE_IMAGE_DEBUG=1 OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 TF_NUM_INTRAOP_THREADS=2 TF_NUM_INTEROP_THREADS=2 .venv/bin/python -m unittest test_core test_http test_supervisor test_image_pipeline test_account_integration test_spoof_diagnostics
```

After stopping existing owned services, startup remains `cd mobileapp && bash scripts/start-authoritative-face-dev.sh --backend-only` if Expo already runs, or omit `--backend-only` to start Expo as well. Private account service stays on loopback 3002; the approved face HTTPS endpoint remains on 8000. `/health` must report models and authoritative service ready.
