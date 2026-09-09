# Web learned-model artifact contract

**Status:** binding browser/native-portable interface specification; no approved artifact exists yet.
**Contract ID:** `darts180-board-tip-v1`
**Current manifest schema:** `2`
**Owners:** Vision Runtime, ML/Data, Release/Privacy review

This is the boundary between trained perception and Darts 180 scoring. A model predicts visual evidence only;
it never emits a dart score. The shared type source of truth is
[`packages/contracts/src/vision.ts`](../packages/contracts/src/vision.ts). The browser parser, strict output
decoder, and production-package verifier are respectively
[`modelManifest.ts`](../apps/web/src/lib/learnedVision/modelManifest.ts),
[`modelOutputDecoder.ts`](../apps/web/src/lib/learnedVision/modelOutputDecoder.ts), and
[`verify-model-artifact.ts`](../apps/web/scripts/verify-model-artifact.ts).

The checked-in public manifest is intentionally an `unavailable` schema-v2 sentinel. It contains no runnable
production-contract model, and its existence must never be described as production camera-scoring readiness.

## Scope boundary: separate editable five-point development package

This document remains binding for `darts180-board-tip-v1`; it is **not** relaxed or widened to accept
raw DeepDarts-style YOLO detections. An isolated schema-v1 `darts180-deepdarts-yolo-dev-v1` package can
be installed separately for engineering/tester use. It requires a real same-origin hashed ONNX artifact,
immutable five-class roles, raw YOLO decoder, and deterministic four-anchor geometry, but no synthetic
nine-landmark/quality output. Its only score disposition is editable `review`; it never reaches this
contract's auto-record path. See [`18-development-five-point-scorer.md`](18-development-five-point-scorer.md).

## 1. Immutable package layout

A reviewed release may add only same-origin, versioned static files such as:

```text
apps/web/public/models/
  darts180-board-tip-v1.json                    # schema-v2 public manifest
  darts180-board-tip-v1.onnx                    # exact reviewed model bytes
  darts180-board-tip-v1.attestation.json        # hash-bound public release record
  darts180-board-tip-v1.model-card.md           # optional release card; no raw media
```

`assetPath` and, when present, `releaseEvidence.attestationPath` must be root-relative same-origin paths. They
may not contain a protocol, query, fragment, backslash, empty segment, or traversal. The manifest supplies a
lowercase SHA-256 for the ONNX bytes. The Worker fetches and hashes those bytes before creating an ONNX Runtime
session; for production it also hashes, parses, and binds the public attestation before inference. A cache, CDN,
or deployment mismatch therefore fails closed.

A production manifest additionally supplies an attestation path and SHA-256. The CI verifier hashes the public
attestation bytes and checks that their artifact hash, output-contract ID, training/evaluation/licence IDs,
evaluation timestamp, approval ID, and every decision-policy value exactly equal the public manifest. This detects
a mixed model/manifest/evidence deployment or a less conservative policy paired with previously approved weights. It does **not** substitute for organizational approval, repository protection, deployment
access control, lawful data review, or a signed provenance system.

Do not use third-party model URLs, dynamic artifact selection, browser API keys, mutable `latest` model paths, or
an in-place binary replacement under an existing checksum.

## 2. Input tensor and browser preprocessing

| Property         | Binding requirement                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tensor           | Exactly one `float32` NCHW image input: `[1, 3, height, width]`. Additional ONNX inputs are rejected.                                                                                 |
| Dimensions       | Equal integer width and height, each 256–2048. The first intended release target is 1024 × 1024.                                                                                      |
| Pixels           | RGB in source camera orientation, `[0, 1]`, with no unversioned normalization or image heuristic.                                                                                     |
| Resize           | The Worker black-letterboxes the original transferred `ImageBitmap`. It retains the actual rounded draw dimensions and independent X/Y scales used to restore points and uncertainty. |
| Temporal context | Any learned temporal input needs a new named contract and evidence. The timing-only luma cue is never a localization input.                                                           |

Training/export preprocessing must match this exactly. The visible preview canvas and event cue are not
localization inputs.

## 3. Required semantic ONNX outputs

The manifest maps these semantic names to ONNX output names. Leading batch dimensions are permitted only when the
flattened sizes below remain exact.

| Semantic output | Flattened requirement                                                                                    | Meaning                                                                                                                                                                                                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `landmarks`     | Exactly 9 rows of `[normalizedX, normalizedY, confidence]`                                               | Fixed order: `bull`, `d20-double`, `d6-double`, `d3-double`, `d11-double`, `outer-top`, `outer-right`, `outer-bottom`, `outer-left`. Outer points lie on the 170 mm outer-double boundary. Named number identities establish orientation; repeated red/green beds do not. |
| `dartTips`      | 1–16 rows of `[normalizedX, normalizedY, confidence, normalizedSigmaX, normalizedSigmaY, occlusionRisk]` | The model owns NMS. Zero-confidence rows are padding. Sigma is positive model-input-scale uncertainty; the Worker restores it independently by X/Y scale.                                                                                                                 |
| `quality`       | Exactly `[overall, boardCoverage, sharpness, glareRisk, offAxisFraction, occlusionRisk]`                 | Every value must be finite and in `[0,1]`. `offAxisFraction` maps to 0–90 degrees. It is not score probability.                                                                                                                                                           |

Malformed tensor type, size, non-finite value, out-of-range probability, invalid point, or source-frame escape is
a runtime failure, not a value to clamp. A scoreable pose requires all nine learned landmarks above the
manifest-defined landmark confidence and a non-degenerate, internally consistent homography.

## 4. Deterministic geometry and score responsibility

After inference, Darts 180—not the model—does the following:

1. Fits an oriented image-to-board homography from the four named double anchors, then requires the bull and four outer-cardinal learned landmarks to independently validate it.
2. Maps each learned dart tip and uncertainty into canonical board millimetres.
3. Associates only policy-admitted, spatially consistent learned tips through the manifest-calibrated post-impact settle interval; a lost quality/pose admission clears the track state, and an occluded/invalid learned tip prevents the UI from treating the board as clear.
4. Uses `@darts-180/rules` to decode physical radius and angle into a standard-board ring, sector, and score.
5. Propagates uncertainty through deterministic Gauss–Hermite quadrature to rank local scoring-zone alternatives
   and calculate wire margin.
6. Applies the manifest-owned decision policy to produce an explainable `auto-score`, `review`, or `abstain`
   proposal.

The runtime never uses color masks, connected components, flight-width endpoint rules, manual point picking, or
an outside-frame one-view candidate to automatically record `MISS`. Radar, room audio, piezo, and IMU may only
provide separately consented and timed event evidence; they do not provide a board-plane coordinate.

## 5. Schema-v2 calibration and decision policy

`decisionPolicy` is a flat, model-release-owned object; it is never a hidden Camera Play UI threshold. The parser
validates every finite range and requires `minReviewProbability ≤ minAutoScoreProbability`.

| Policy fields                                                                                                                                     | Runtime use                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `minLandmarkConfidence`, `maxPoseValidationResidualMm`                                                                                            | Require every one of the nine landmarks and reject an inconsistent bull/outer-cardinal pose validation.                                     |
| `minOverallQuality`, `minBoardCoverage`, `minSharpness`, `maxGlareRisk`, `maxQualityOffAxisDegrees`, `minBoardDiameterPixels`, `maxOcclusionRisk` | Reject poor full-board observability before a score decision. Tip occlusion uses the same `maxOcclusionRisk` cap.                           |
| `tipTrackMatchDistanceMm`, `tipTrackSettleMs`, `tipTrackStaleAfterMs`, `maxTipTrackSpreadMm`                                                      | Bind learned-tip association and settle criteria across a post-impact burst. The stale interval cannot be shorter than the settle interval. |
| `confidenceTemperature`, `confidenceBias`                                                                                                         | Apply the declared logit calibration to the combined geometric/tip/frame evidence.                                                          |
| `minAutoScoreProbability`, `minAutoScoreWireMarginMm`, `minZonePosteriorMargin`                                                                   | Require a high calibrated confidence, a safe wire margin, and best-versus-runner-up posterior separation for automatic recording.           |
| `minReviewProbability`, `autoRecordEnabled`, `heldOutEvaluationId`                                                                                | Route weaker viable evidence to review and bind automatic recording to the approved production release/evaluation.                          |

At runtime `auto-score` additionally requires a production stage with `autoRecordEnabled`, clear
pose/quality/occlusion evidence, and parser-validated production-manifest evidence fields. The Worker and release
verifier both check the separate attestation hash/binding before production inference and deployment. `MISS` is
never automatically recorded.
Development and evaluation releases must route every otherwise viable proposal to review.

Thresholds can only be changed by creating a new manifest version, artifact hash, calibration/evaluation record,
and release review. They may not be tuned using a frozen holdout set after promotion criteria are declared.

## 6. Manifest stages and evidence

| Stage         | Permitted behavior                                                                                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unavailable` | No artifact path/hash. Camera preview may run, but inference and scoring cannot.                                                                                  |
| `development` | Schema-v2 ABI runnable only for engineering. Every proposal is review-only. The separate five-point package is also review-only but governed by its own document. |
| `evaluation`  | Runnable for governed field evaluation. Every proposal is review-only.                                                                                            |
| `production`  | May set `autoRecordEnabled` only when all release evidence and parser invariants pass.                                                                            |

A runnable manifest requires a versioned artifact path/checksum, input/output contract, calibration, pose,
quality policy, and provenance object. A production manifest also requires non-null:

- held-out evaluation ID and ISO-8601 evaluation timestamp;
- training-data and licence-review IDs;
- attestation path and SHA-256; and
- approval ID that exactly matches the public attestation.

A release record must document ONNX Runtime compatibility, WebGPU/WASM browser/device behavior, model
size/load/caching behavior, model card, calibration method, data and licences, known failure slices,
review/abstention policy, support envelope, and rollback owner.

## 7. Evidence, privacy, and browser acceptance gates

Before adding a runnable artifact:

- approve lawful dataset acquisition, data lineage, third-party licences, and FTO review; do not use
  non-commercial code/weights, private support screenshots, or unreviewed public derivatives;
- collect separately consented, purpose-limited event bundles with independent board pose, tip, and score ground
  truth;
- split by household/site, board and board condition, device, player/dart set, and lighting so adjacent video
  frames cannot leak between train and holdout;
- evaluate every sector/ring, wire-distance band, one/two/three-dart state, occlusion, steel/soft tip,
  browser/device, practical angle/distance, glare, blur, and thermal state; and
- lock promotion thresholds from held-out data with confidence intervals, prioritizing unsafe auto-score rate over
  coverage.

Normal Camera Play discards camera frames after local inference. Research-media upload, retention, deletion,
access, and participant withdrawal require separately implemented consent and governance controls.

The browser build must retain `connect-src 'self'`, `worker-src 'self' blob:`, and
`script-src 'self' 'wasm-unsafe-eval'`. It must not relax to remote scripts or generic `'unsafe-eval'`.
Acceptance must occur in direct HTTPS Safari/Chrome tabs, not an iframe, and include WebGPU creation/WASM
fallback, tensor rejection, Worker cleanup, complete automatic pose, real-device accuracy/latency/memory/battery/
thermal results, and correction/review/abstention behavior.

## 8. Release verification and rollback

Run from the repository root before merging a model package:

```bash
npm run verify:model-artifact --workspace=@darts-180/web
npm run verify
npm run format:check
npm run docs:check
git diff --check
```

The artifact verifier explicitly passes the checked-in `unavailable` sentinel. For runnable packages it requires
regular, non-symlinked manifest/ONNX/attestation files inside `apps/web/public`, exact model and attestation hashes,
and exact production evidence binding. It is a release-integrity check, not accuracy validation.

If a model byte, output contract, calibration/policy, provenance/evaluation identifier, or evidence document
changes, issue a new version and rerun the complete release process. Follow
[`runbooks/model-release-rollback.md`](runbooks/model-release-rollback.md) for staged rollout, kill switch, and
rollback behavior.

See [`03-detection-engine.md`](03-detection-engine.md),
[`12-web-demo-and-vercel.md`](12-web-demo-and-vercel.md),
[`14-browser-camera-field-test.md`](14-browser-camera-field-test.md), and
[`16-camera-autoscoring-reset.md`](16-camera-autoscoring-reset.md) for the system, deployment, field, and
program gates.
