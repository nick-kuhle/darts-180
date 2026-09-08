# Web learned-model artifact contract

**Status:** binding browser/native-portable interface specification; no approved artifact exists yet.
**Contract ID:** `darts180-board-tip-v1`
**Owner:** Vision Runtime + ML/Data + Release/Privacy review

This contract is the line between a trained perception model and Darts 180 game scoring. A model may predict
semantic visual evidence; it may **not** emit a score. The shared TypeScript source of truth is
[`packages/contracts/src/vision.ts`](../packages/contracts/src/vision.ts), and the strict browser decoder is
[`apps/web/src/lib/learnedVision/modelOutputDecoder.ts`](../apps/web/src/lib/learnedVision/modelOutputDecoder.ts).

## 1. Artifact package layout

A future reviewed release may add only same-origin static files such as:

```text
apps/web/public/models/
  darts180-board-tip-v1.json       # versioned manifest
  darts180-board-tip-v1.onnx       # exact signed/reviewed bytes
  darts180-board-tip-v1.model-card.md  # optional public/internal release card; no raw media
```

The manifest's `assetPath` must begin with `/`, contain no traversal/protocol, and point to the exact ONNX bytes
whose lowercase SHA-256 appears in `sha256`. `vision.worker.ts` fetches those bytes with same-origin credentials,
hashes them before session creation, and fails closed on mismatch. Do not bundle model bytes from a third-party
CDN, dynamically select a URL, or add an API key to the web client.

The currently committed `darts180-board-tip-v1.json` is an `unavailable` placeholder with empty artifact fields.
It is deliberately not a template to edit into a runnable model without the gates below.

## 2. Input tensor

| Property      | Requirement                                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| Tensor        | one `float32` NCHW tensor, `[1, 3, height, width]`                                                             |
| Color         | RGB in source camera orientation, values `[0, 1]`                                                              |
| Dimensions    | manifest-declared integer width/height, each 256–2048; current planned target is 1024 × 1024                   |
| Resize        | Worker black-letterboxes the original `ImageBitmap`, retaining the exact scale/offset used to restore points   |
| Inputs        | exactly one ONNX image input; extra inputs are rejected                                                        |
| Preprocessing | no hidden browser heuristic or unversioned normalization; training/export must match RGB zero-to-one letterbox |

The Worker receives a high-resolution frame transferred from the browser. The visible `<canvas>` preview and the
low-resolution event cue are not model-localization inputs. Any future temporal model must receive a new,
explicitly versioned input/output contract rather than silently adding a handcrafted RGB difference image.

## 3. Required semantic outputs

The manifest maps these semantic names to ONNX output names. Leading batch dimensions are allowed so long as the
flattened lengths below match exactly.

| Semantic output | Flattened requirement                                                                                   | Meaning                                                                                                                                                                                                                                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `landmarks`     | exactly 9 × `[normalizedX, normalizedY, confidence]`                                                    | Values correspond in fixed order to `bull`, `d20-double`, `d6-double`, `d3-double`, `d11-double`, `outer-top`, `outer-right`, `outer-bottom`, `outer-left`. The four `outer-*` points are on the outer-double boundary at 170 mm; bull and outer points are redundant pose checks. Named number identities—not repeated red/green colors—establish orientation. |
| `dartTips`      | 1–16 rows × `[normalizedX, normalizedY, confidence, normalizedSigmaX, normalizedSigmaY, occlusionRisk]` | The model owns NMS. Padding rows have zero confidence. `sigma` is positive normalized image-scale uncertainty; `occlusionRisk` is a `[0,1]` learned risk for hidden/stacked entry.                                                                                                                                                                              |
| `quality`       | exactly `[overall, boardCoverage, sharpness, glareRisk, offAxisFraction, occlusionRisk]`                | All values are `[0,1]`; off-axis fraction maps to 0–90 degrees. Quality is not score probability.                                                                                                                                                                                                                                                               |

Coordinates are normalized in the Worker input canvas, then de-letterboxed into original orientation-normalized
camera-frame pixels. Rows outside the source image or invalid values are rejected. The model must produce a valid
set of D20/D6/D3/D11 plus bull observations for a scoreable pose; the geometry solver rejects degeneracy and
inconsistent bull evidence.

## 4. What Darts 180 computes after inference

1. Map redundant named landmarks into an oriented image-to-board homography.
2. Map each learned dart tip and pixel uncertainty to canonical board millimetres.
3. Associate only spatially consistent learned tips through the post-impact settle interval.
4. Use `@darts-180/rules` to decode canonical radius/angle into the standard board ring/segment.
5. Estimate deterministic local zone alternatives from propagated uncertainty and measure wire margin.
6. Combine model confidence, image quality, uncertainty, occlusion, and manifest calibration into an explainable
   `ScoringProposal`.

The runtime never uses color masks, connected components, flight-width endpoint logic, manual point picking, or
an exterior one-view candidate to automatically record `MISS`. Radar, room audio, piezo, and IMU can only add
separately consented/timed event evidence—not a board-plane score coordinate.

## 5. Manifest stages and promotion

| Stage         | Permitted behavior                                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `unavailable` | No asset path/hash. Camera preview may run; inference/scoring cannot.                                                                                                                      |
| `development` | Runnable locally for engineering. Every score proposal routes to review.                                                                                                                   |
| `evaluation`  | Runnable for governed field testing. Every score proposal routes to review; parser policy forbids automatic recording.                                                                     |
| `production`  | May enable `autoRecordEnabled` only when held-out evaluation ID, training-data ID, licence-review ID, and evaluation timestamp are all non-null and the parser accepts the exact manifest. |

A release record must also include ONNX Runtime compatibility, WebGPU/WASM device/browser results, model size/load
behavior, model card, calibration methodology, data/licenses, known failure slices, abstention/review policy, and
rollback owner. Changing model bytes, output names, preprocessing, calibration, thresholds, or provenance requires
a new model version and SHA-256.

## 6. Evidence and privacy gates

Before adding any runnable artifact:

- verify lawful dataset acquisition and third-party licence/provenance; do not use non-commercial code/weights or
  private support screenshots;
- collect specifically consented, purpose-limited event bundles with independent score/pose/tip ground truth;
- split by household/site, board, board condition, device, player/dart set, and lighting to prevent near-duplicate
  video-frame leakage;
- evaluate every score/ring/sector, wire-distance band, one/two/three-dart state, occlusion, steel/soft tip,
  browser/device, practical angle/distance, glare, blur, and thermal state; and
- lock promotion thresholds from held-out data with confidence intervals, prioritizing unsafe auto-score rate over
  coverage.

Normal Camera Play discards images after local inference. Research-media retention, upload, deletion, access, and
participant withdrawal require a separate explicit consent and governance implementation.

## 7. Browser packaging and test checklist

The browser build packages a module Worker and ONNX Runtime WASM as same-origin Vite assets. The CSP must retain
`connect-src 'self'`, `worker-src 'self' blob:`, and `script-src 'self' 'wasm-unsafe-eval'`; it must not relax to
remote scripts or generic `'unsafe-eval'`. Test each artifact on direct HTTPS Safari/Chrome tabs—not an iframe—with:

- manifest parsing and SHA mismatch rejection;
- WebGPU session creation and WASM fallback;
- output tensor shape/type/semantic rejection;
- no model/camera frame leak on Worker error/dispose;
- automatic full-board pose/orientation and geometric score mapping;
- review/abstain and never-auto-`MISS` behavior; and
- actual measured real-device accuracy, latency, memory, battery, and thermal behavior.

See [`12-web-demo-and-vercel.md`](12-web-demo-and-vercel.md),
[`14-browser-camera-field-test.md`](14-browser-camera-field-test.md), and
[`16-camera-autoscoring-reset.md`](16-camera-autoscoring-reset.md) for deployment, field, and program gates.
