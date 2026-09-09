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
is for pipeline tests and augmentation only; it can never be used to claim real-world accuracy or
as sacred evaluation data. `data_contract.py` validates capture metadata and that each label agrees
with canonical score geometry. Validate either a Capture Lab manifest or a nested labeled sidecar
before it enters a handoff queue:

```bash
PYTHONPATH=src python -m darts180_vision.data_contract path/to/manifest-or-sidecar.json
```

The static web Annotation Lab exports a matching nested sidecar for a locally imported Capture Lab
JPEG/manifest pair. Its four-anchor transform is a controlled human-labeling aid, not a substitute
for independent annotations or adjudication; see `docs/runbooks/local-annotation.md`.

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

Once a **lawfully acquired local** DeepDarts-style export and a **local** YOLOv8-compatible base
checkpoint are available, `darts180_vision.deepdarts_yolo_train` can create an isolated browser ONNX
baseline. It runs the structural audit first and refuses a changed five-class numeric map, label-integrity
issues, or no dart-plus-four-anchor frame. It does not download data/weights, call Roboflow or another
hosted inference service, copy output into `apps/web/public`, deploy, or make a production claim.

```bash
PYTHONPATH=src python -m darts180_vision.deepdarts_yolo_train \
  /secure/path/to/extracted-deepdarts-export \
  --base-model /secure/path/to/yolov8n.pt \
  --output-directory /secure/path/to/darts180-five-point-run \
  --model-version deepdarts-local-dev-YYYY-MM-DD \
  --training-data-id deepdarts-local-audit-YYYY-MM-DD \
  --license-review-id deepdarts-ccby-review-YYYY-MM-DD \
  --hash-images
```

The output contains an ONNX file, its SHA-256, a raw-five-class **development-only** manifest, dataset
audit, and summary. Review and browser-test those output files before intentionally installing them as the
optional Camera Play development package. The resulting app path emits editable review cards only. Read
[`docs/18-development-five-point-scorer.md`](../docs/18-development-five-point-scorer.md) for the exact
browser contract and local correction-evidence workflow.

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
