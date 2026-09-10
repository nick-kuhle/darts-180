# Darts 180 ML workspace

This directory is for **training, evaluation, model conversion, and reproducible experiment
metadata**. It is not deployed to the phone. The browser is the first runtime target; native
contracts remain in `native/vision-core/` and `apps/mobile/src/vision/` for later reuse.

## Bootstrap

Use Python 3.11+ and an isolated environment. Keep heavy GPU dependencies optional:

```bash
cd ml
python -m venv .venv
. .venv/bin/activate
# Lightweight, runnable pose/quality baseline and tests.
pip install -e '.[vision]'
PYTHONPATH=src python -m unittest discover -s tests -v

# Add expensive GPU training/export tools only on a dedicated ML machine.
pip install -e '.[train,export,quality]'
```

## Runnable pose/quality baseline

`darts180_vision.pose_baseline` is an inspectable OpenCV baseline that finds a likely board circle
and emits framing/focus/glare/off-axis quality guidance. It is designed for data-capture diagnostics
and synthetic tests, **not** production scoring or a pose-model claim.

```bash
PYTHONPATH=src python -m darts180_vision.pose_baseline path/to/board.jpg \
  --debug-output /tmp/darts-180-pose-debug.jpg --off-axis-degrees 20
```

This allows the team to exercise the first camera-quality loop while landmark-model work is under
way. Production must replace it with the landmark/pose pipeline described in
`docs/03-detection-engine.md`.

## Temporal before/after baseline

`darts180_vision.temporal_baseline` is a conservative development baseline for fixed-camera,
settled before/after frames. Given a board circle from calibration, it detects an elongated changed
region, proposes the endpoint nearest the board centre as a probable tip, and can map that point
through an image-to-board homography for deterministic scoring.

```bash
PYTHONPATH=src python -m darts180_vision.temporal_baseline before.jpg after.jpg \
  --center 640 360 --radius 280 --debug-output /tmp/temporal-debug.jpg
```

It is intentionally not exposed as product auto-scoring: movement, occlusion, lighting changes,
bounces, overlapping darts, camera shake, and non-radial visual evidence can defeat it. Its value is
an inspectable test baseline and a source of hard examples for the learned temporal pipeline.

## Synthetic smoke-test dataset

Generate controlled, locally stored scenes with geometry-consistent JSON sidecars:

```bash
PYTHONPATH=src python -m darts180_vision.synthetic --output /tmp/darts-180-synthetic --count 100 --seed 42
```

The generator varies dart count, ring/wedge, board scale, simple perspective, and backgrounds. It
marks every sidecar `SYNTHETIC-NO-USER-DATA` plus `synthetic-not-real-world-evaluation`; it can never
be used to claim real-world accuracy or as sacred evaluation data. `data_contract.py` validates capture
metadata and that each label agrees with canonical score geometry. Validate either a Data Lab manifest
or a nested labeled sidecar before it enters a handoff queue:

```bash
PYTHONPATH=src python -m darts180_vision.data_contract path/to/manifest-or-sidecar.json
```

The web Data Lab creates a matching nested sidecar only after its required entry agreement and
per-still/label review. Its four-anchor transform is a controlled human-labeling aid, not a substitute
for independent annotations or adjudication; see `docs/runbooks/local-annotation.md`.

## Fully synthetic five-point bootstrap

For a reproducible initial detector experiment, build a standard numeric YOLO dataset from fully
simulated board scenes and throws **outside this repository**:

```bash
PYTHONPATH=src python -m darts180_vision.synthetic_five_point_dataset \
  --output-directory /secure/path/to/darts180-synthetic-fivepoint-v1 \
  --count 300 \
  --seed 20260908
```

It generates known five-point labels (class `0` dart entry, `1`–`4` fixed landmarks), output-only
JPEGs/labels, and an aggregate provenance/audit report. It does not use a raw external archive,
contact an API, or manufacture a model artifact. Its `train`/`val`/`test` partitions are all synthetic;
use them only for controlled bootstrap/pretraining checks and keep them completely separate from
real-device testing. The builder rejects a repository output path so a raw synthetic archive cannot be
committed accidentally.

A photorealistic-looking AI-generated board image has no trustworthy tip/landmark ground truth merely
because it was generated. Do not add one to supervised training until it has explicit synthetic
provenance and separately reviewed, geometry-consistent labels. Do not relabel it as real capture.

## Build a local five-point data set from real throws

For the first model built from Darts 180's own captures, choose **Five-point development model labels**
in the web Annotation Lab. Its four outer-double-rim junctions have a different meaning from the
ordinary D20/D6/D3/D11 annotation profile; they match the development browser engine's `cal1`–`cal4`
source frame exactly.

A restricted storage operator retrieves each approved private JPEG + annotation JSON pair into a
protected local folder outside this repository. The Data Lab contributor never downloads it. Use a
stable setup/session ID for one continuous phone/mount/light configuration, then compile only reviewed
self-capture pairs:

```bash
PYTHONPATH=src python -m darts180_vision.local_five_point_dataset \
  /secure/path/to/reviewed-capture-pairs \
  --output-directory /secure/path/to/compiled-five-point-v1 \
  --split-seed darts180-initial-campaign-v1 \
  --accepted-consent-version DEVELOPMENT-DATA-LAB-CONSENT-V1
```

The compiler checks privacy/consent markers (including the recorded Data Lab consent timestamp and
unreviewed status), exact JPEG/sidecar pairing and dimensions, the required five-point annotation profile,
clear tip labels, session-disjoint train/validation/test splits, duplicate JPEG bytes, and numeric YOLO
labels. It never downloads, uploads, trains, or deploys. A completed private Data Lab save is not
automatic training admission; conduct restricted privacy/provenance/label review first. Read
[`docs/19-build-the-first-camera-model.md`](../docs/19-build-the-first-camera-model.md) before starting
a campaign.

## Mix reviewed real throws with simulated training scenes

Once a restricted operator has reviewed and compiled the private Darts 180 records, the offline
mixer can combine those real examples with the procedural bootstrap **without contaminating the
real-world exam**:

```bash
PYTHONPATH=src python -m darts180_vision.mixed_five_point_dataset \
  --real-dataset-root /secure/path/to/compiled-five-point-v1 \
  --synthetic-dataset-root /secure/path/to/darts180-synthetic-fivepoint-v1 \
  --output-directory /secure/path/to/mixed-five-point-v1 \
  --mix-id darts180-mixed-dev-v1 \
  --real-review-id private-capture-review-v1 \
  --synthetic-review-id procedural-renderer-review-v1
```

The mixer accepts only the repository's approved report shapes, re-audits both inputs, rejects exact
JPEG duplicates, and creates one external-only data set with this fixed policy:

| Split   | Contents                                                           |
| ------- | ------------------------------------------------------------------ |
| `train` | reviewed real train examples + procedural synthetic train examples |
| `val`   | reviewed real validation examples only                             |
| `test`  | reviewed real test examples only                                   |

It writes `darts180-mixed-fivepoint-dataset.json`, including source-report hashes, explicit operator
review IDs, source counts, and the rule that automatic training admission remains false. It does not
read Vercel Blob, contact a service, access browser data, train, install, or deploy a model. Use
`--training-data-kind mixed-synthetic-and-real` when training from this output; the trainer refuses a
mixed manifest unless that report preserves real-only validation and test splits.

## External YOLO research intake

`darts180_vision.deepdarts_yolo_audit` performs an aggregate-only structural intake audit of a
**locally extracted** DeepDarts YOLOv8 export. It does not download from Roboflow, use an API key,
train a model, generate an artifact, or change a browser manifest. It checks the numeric class map,
paired image/label counts, YOLO row validity, anchor/dart co-occurrence, representative relative
image/label pairs covering all declared classes, and simple cross-split leakage indicators.
`--hash-images` additionally detects byte-identical images across split boundaries and can take time
on a large archive.

```bash
PYTHONPATH=src python -m darts180_vision.deepdarts_yolo_audit \
  /secure/path/to/extracted-deepdarts-export \
  --hash-images \
  --output /tmp/deepdarts-yolov8-v2-audit.json
```

This is a research intake tool, not an approval gate. Read
[`docs/research/2026-09-deepdarts-yolov8-candidate.md`](../docs/research/2026-09-deepdarts-yolov8-candidate.md)
before using the candidate. Do not add the ZIP, raw images, labels, weights, an API token, or the
report's local paths to Git.

## Editable five-point development training/export

Once a **locally compiled Darts 180 five-point set**, the external-only **fully synthetic five-point
bootstrap**, a reviewed **mixed real + synthetic five-point set**, or a lawfully acquired local
DeepDarts-style export and a **local** YOLOv8-compatible base checkpoint are available,
`darts180_vision.deepdarts_yolo_train` can create an isolated browser ONNX baseline. It runs the structural audit first and refuses a changed five-class numeric map, label-integrity
issues, or no dart-plus-four-anchor frame. It does not download data/weights, call Roboflow or another
hosted inference service, copy output into `apps/web/public`, deploy, or make a production claim.

The trainer requires `--training-data-kind` for every experiment. When training from the synthetic
bootstrap, use `--training-data-kind synthetic-only` and a data ID such as `synthetic-five-point-v1`; the
trainer verifies the bootstrap report and writes that provenance into the browser manifest. A synthetic-only
model is not real-world validation and cannot be installed as a production scoring model. For the reviewed
mixed output above, use `mixed-synthetic-and-real`; the trainer requires its mixed-provenance report and
refuses synthetic examples in validation or test.

```bash
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

The output contains an ONNX file, its SHA-256, a raw-five-class **development-only** manifest, dataset
audit, and summary. Review and browser-test those output files before intentionally installing them as the
optional Camera Play development package. The resulting app path emits editable review cards only. Read
[`docs/18-development-five-point-scorer.md`](../docs/18-development-five-point-scorer.md) for the exact
browser contract and local correction-evidence workflow.

## Protected GitHub Actions option

When the data owner is using the Vercel/GitHub web interfaces rather than a dedicated desktop ML
machine, `.github/workflows/private-development-model.yml` provides a manual-only alternative. It
requires a protected GitHub Environment with a private Blob credential and an **exact owner-approved
record-ID allow-list**; it does not add a browser Blob-reader route or enumerate all contributor records.
Raw triplets and intermediate data stay in the ephemeral runner workspace, while the seven-day Action
artifact contains only an aggregate review record and, after a separately approved training run, the
review-only ONNX plus its manifest. Follow
[`docs/21-private-github-actions-model-build.md`](../docs/21-private-github-actions-model-build.md)
for the required secret setup, checkpoint review, cleanup policy, and installation boundary.

## Data boundaries

- `data/raw/` — encrypted, access-controlled source captures; gitignored.
- `data/curated/` — versioned, de-identified training set; gitignored because it will be large.
- `data/eval/` — access-controlled sacred held-out evaluation set; gitignored.
- Only manifests, schemas, fixtures, and aggregate reports belong in Git.
- Faces, room backgrounds, account identifiers, and audio are out of scope for training data.

## Model split

1. **Board pose / calibration** runs continuously at low cadence. It finds board geometry and
   computes image→canonical-board mapping plus a quality score.
2. **Dart entry-point model** runs after a temporal change trigger. It predicts an entry point and
   uncertainty distribution, never merely a whole-image score class.
3. **Post-processing** maps candidate points into board millimetres and uses deterministic dart
   rules to generate ranked score zones.

Read `docs/03-detection-engine.md` before creating a model experiment, and register every run with
its data snapshot, source commit, model checksum, metrics by slice, and the sacred-eval result.
