# Editable five-point development scorer

**Status:** implemented browser integration path; **no runnable ONNX artifact is checked in yet**<br />
**Contract ID:** `darts180-deepdarts-yolo-dev-v1`<br />
**Stage:** `development` only — never a production auto-record contract<br />
**Owners:** Vision Runtime + ML/Data + Test Operations

## 1. Purpose and product rule

Darts 180 needs a useful camera scorer before it has release-grade accuracy. This development path
therefore turns a **real learned detector result** into an immediate, deterministic **editable score
suggestion**. It does not wait for a high release threshold, a production attestation, or a fully
calibrated probability model.

It does **not** permit an arbitrary guess. A suggestion exists only when one local model frame contains:

1. a learned class-0 dart-entry detection;
2. learned, semantically ordered classes 1–4 for the full board; and
3. a non-degenerate four-anchor image-to-standard-board transform.

The timing-only luma cue can request a post-impact burst, but has no coordinate, tip, ring, sector, or
score role. There is no color mask, frame-difference scorer, static/demo score, Roboflow hosted
inference, remote image upload, calibration tap, or manual tip click in normal Live Scoring.

Every development result is `review`. It cannot become `auto-score` through a UI setting, model policy,
or confidence threshold. The player must explicitly **Confirm as shown** or correct each development
DartCard before the visit can be confirmed.

## 2. Why this is separate from the production ABI

[`17-web-model-artifact-contract.md`](17-web-model-artifact-contract.md) remains the binding release
contract, `darts180-board-tip-v1`. It requires nine semantic landmarks, learned tip uncertainty and
occlusion, a learned quality tensor, calibration/evaluation policy, and production-only attestation
checks. This five-point development implementation does **not** pretend DeepDarts has those outputs.

| Concern           | Production `darts180-board-tip-v1`                                 | Development `darts180-deepdarts-yolo-dev-v1`                         |
| ----------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Inputs            | square RGB, versioned letterbox preprocessing                      | square RGB, explicitly declared **stretch** preprocessing            |
| Learned output    | nine landmarks + tip rows + quality tensor                         | raw YOLOv8 boxes: `cx, cy, w, h + 5` class scores                    |
| Board pose        | named doubles plus five independently learned validation landmarks | exactly four learned ordered calibration anchors                     |
| Dart point        | learned semantic tip with model uncertainty/occlusion              | learned class-0 box center; no fabricated uncertainty/occlusion head |
| Score disposition | calibrated auto/review/abstain policy                              | always editable `review` suggestion                                  |
| Package evidence  | production attestation/evaluation required for auto-record         | local model hash + training/licence identifiers, no production claim |

The code is isolated under `apps/web/src/lib/developmentVision/` and
`DeepDartsDevelopmentCameraPlay.tsx`. `CameraPlayRouter` selects it only if the strict production
manifest is not runnable and a valid separate development manifest is installed. A future production
package always takes precedence.

## 3. Model package contract

A reviewer-installed package consists of two same-origin static files:

```text
apps/web/public/models/
  darts180-deepdarts-yolo-dev-v1.onnx
  darts180-deepdarts-yolo-dev-v1.json
```

Neither file is committed until a lawful, actual local training/export produces it. The JSON parser
requires all of the following:

- `schemaVersion: 1`, `modelId: darts180-deepdarts-yolo`, and `releaseStage: development` exactly;
- a root-relative `.onnx` path without traversal or remote URLs;
- lowercase SHA-256 for the exact ONNX bytes, rechecked in the Worker before inference;
- `onnxruntime-web`, one RGB NCHW square input, `[0,1]` normalization, and `resizeMode: stretch`;
- one safe ONNX output name, `yolov8-raw-cxcywh-class-scores`, and exactly five classes;
- the immutable mapping `0=dart entry`, `1=cal1`, `2=cal2`, `3=cal3`, `4=cal4`; and
- non-empty local training-data/licence-review IDs plus bounded detector/NMS/tracker settings.

The Worker accepts only raw tensor shapes `[1, 9, N]`, `[1, N, 9]`, `[9, N]`, or `[N, 9]` where
`9 = cx + cy + width + height + five class scores`. It rejects malformed data and wrong layouts rather
than treating objectness logits, a different class map, or arbitrary output rows as a dartboard model.
Class-aware NMS happens locally in the Worker. Detector centers and box sizes are inverted from the
declared 640-style stretch transform back to the original camera pixels.

A development manifest deliberately has no production release evidence field, no `autoRecordEnabled`
switch, and no path into the schema-v2 public production manifest.

## 4. Automatic board geometry and orientation

The source convention under review defines ordered calibration targets at the outer-double radius:

```text
cal1 = (   0, -170) mm     cal2 = (   0, 170) mm
cal3 = (-170,    0) mm     cal4 = ( 170,   0) mm
```

A four-point homography maps detected source pixels to those targets. Darts 180 then rotates the source
canonical frame by **−9°** into the authoritative `@darts-180/rules` standard frame: x right, y down,
D20 at twelve o’clock, then clockwise `[20, 1, 18, …]` sectors. The basis for this adapter is the
published DeepDarts target/sector convention and the reviewed image/label geometry. Synthetic contract
fixtures protect the arithmetic.

This is a constrained integration hypothesis, not a broad real-device validation result. Before relying
on it beyond development testing, validate it against independently scored, held-out real throws at
multiple board rotations/camera views. Do not reuse the `−9°` value for a different export, a relabeled
dataset, or a different detector without repeating that validation.

Once transformed, the ordinary shared rules package alone decodes radial ring, sector, and score. The
model never outputs a score.

## 5. Tester flow and correction evidence

1. Start the rear camera; it finds four learned anchors automatically.
2. With an empty board, tap **Arm Camera**. No reference photo or point clicking is requested.
3. Throw normally. A local post-impact burst tracks a stable learned dart point and fills an editable
   DartCard.
4. Open **Edit Scores**. Choose **Confirm as shown** when correct, or tap the board to set the corrected
   score. Development DartCards block visit confirmation until one of those explicit actions occurs.
5. Keep model-training collection in **Data Lab**, not Live Scoring. Live Scoring neither downloads nor
   exports camera frames or labels. A completed Data Lab review automatically saves its matching private
   JPEG/manifest/annotations record; a restricted operator screens it before any later training handoff.

Before there is any model to make those suggestions, bootstrap real throws through the guided **Data Lab**
using its explicit five-point rim-junction/tip labels. Its unchecked entry agreement records that completed
board-only records are collected privately for product/model improvement; it is a controlled data-operation
tool, not a normal Live Scoring step or user authentication. In the separately configured
`development-consent-v1` deployment, completed review automatically saves a private record marked
`consented-development-unreviewed`; it neither trains nor activates a model. See
[`19-build-the-first-camera-model.md`](19-build-the-first-camera-model.md) and
[`20-private-capture-lab.md`](20-private-capture-lab.md).

## 6. Local training/export handoff

`ml/src/darts180_vision/deepdarts_yolo_train.py` is a deliberate local-only recipe. It does not download
data or base weights, call a hosted API, install an artifact into the web app, or deploy anything.

On a dedicated ML machine, a restricted operator first retrieves approved private Data Lab
JPEG/annotation pairs into a protected local workspace, then compiles them into a session-disjoint
five-point YOLO folder. The contributor-facing app has no browser download/export path. The compiler is
source-preserving: it rejects incorrect label schemes, unsafe paths, duplicates, missing session IDs, and
fewer than three setup sessions.

```bash
cd ml
PYTHONPATH=src python -m darts180_vision.local_five_point_dataset \
  /secure/path/to/reviewed-capture-pairs \
  --output-directory /secure/path/to/compiled-five-point-v1 \
  --split-seed darts180-campaign-v1 \
  --accepted-consent-version DEVELOPMENT-DATA-LAB-CONSENT-V1
```

For a first mixed development experiment, generate the external-only procedural bootstrap and mix it
with the approved real compilation. The mixer copies synthetic examples into `train` only and retains
real-only `val`/`test` sessions:

```bash
PYTHONPATH=src python -m darts180_vision.mixed_five_point_dataset \
  --real-dataset-root /secure/path/to/compiled-five-point-v1 \
  --synthetic-dataset-root /secure/path/to/darts180-synthetic-fivepoint-v1 \
  --output-directory /secure/path/to/mixed-five-point-v1 \
  --mix-id darts180-mixed-dev-v1 \
  --real-review-id private-capture-review-v1 \
  --synthetic-review-id procedural-renderer-review-v1
```

Then supply that reviewed mixed folder and a local YOLOv8-compatible base checkpoint to training:

```bash
cd ml
pip install -e '.[train,export,quality]'
PYTHONPATH=src python -m darts180_vision.deepdarts_yolo_train \
  /secure/path/to/mixed-five-point-v1 \
  --base-model /secure/path/to/approved-yolov8n.pt \
  --output-directory /secure/path/to/darts180-mixed-five-point-run \
  --model-version darts180-mixed-dev-YYYY-MM-DD \
  --training-data-id darts180-mixed-dev-v1 \
  --training-data-kind mixed-synthetic-and-real \
  --license-review-id local-self-capture-and-procedural-review-v1 \
  --hash-images
```

Training runs the structural audit first; it refuses label-integrity issues, a changed numeric five-class
mapping, or no dart-plus-four-anchor example. It exports a fixed-size raw ONNX graph without NMS, hashes
it, inspects its single output name, and writes a **development-only** manifest beside the artifact. Raw
media, labels, base checkpoints, experiment runs, and model bytes remain outside Git.

A reviewer must then inspect the artifact, browser-load it on target devices, place the two reviewed files
into the ignored static-model build input without committing model bytes, run the web contract tests, and
make a separate code/review decision before any development deployment. This is a training handoff—not a
production release command.

## 7. Known limitations and next measurements

- No full local corpus or ONNX artifact is presently available, so the checked-in public app still has no
  working model package to activate.
- Four anchors have no independent redundant landmark/quality validation. Development mode exposes this
  uncertainty through mandatory human review rather than inventing a quality score.
- Class-0 centers are model detections, not a calibrated sub-pixel entry-point/occlusion model. Robin
  hoods, hidden tips, bounce-outs, hands, and out-of-frame darts need explicit future labels/evaluation.
- A detected point outside the board decodes deterministically to `MISS`, but never becomes an automatic
  production score.
- A 1,000-throw tester campaign is useful only when balanced across board condition, ring/sector, wires,
  device, camera pose, lighting, darts, occlusion, and failures. A large pile of near-identical T20 throws
  is not enough.

Promotion remains governed by the production contract: independently labeled held-out evaluation, browser
compatibility, calibrated uncertainty/quality evidence, lawful data/FTO review, and a new reviewed model
ABI or a trained model that truly satisfies the existing one.
