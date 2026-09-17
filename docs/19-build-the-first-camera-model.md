# Build the first camera model: synthetic bootstrap plus real throws

**Snapshot date:** 2026-09-09 (America/Los_Angeles)<br />
**Audience:** a Darts 180 owner/tester building the first real development scorer<br />
**Purpose:** begin with fully labeled simulated scenes, then turn consented, board-only real throws into
an honestly evaluated local training set—without pretending the current app has a model already

## The fifth-grade version

The camera can already show a picture. The app also knows all dart rules: it knows what `T20`, a bull,
and a miss mean. What it does **not** have yet is practice recognizing a dart tip and a board in a real
phone picture.

We give it that practice in four simple stages:

1. **Begin with simulated board pictures and throws** where the computer knows the exact generated
   dart tips and board points. This tests the data/training plumbing, not real-phone accuracy.
2. **Take board pictures** after real throws. Keep people out of the picture and obtain the displayed
   Data Lab agreement before opening the camera.
3. **Auto-record where the dart tip and four board guide points are** in each real picture. Data Lab
   captures these from the local learned model while it runs; every label stays unreviewed until a
   restricted operator screens it. This is done in the special data tools, not in normal Live Scoring.
4. **Train the model** from approved examples. Then Live Scoring can suggest scores, and you can
   correct the suggestions to make the next model better.

Normal players never interact with the data tools directly. The automatic capture is only the
temporary, honest way to teach the first version what it is looking for.

## What to collect first

Start small enough to prove the workflow, then grow it:

| Stage                    | Goal                                                                       | What “done” means                                                                           |
| ------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Dry run                  | 12–20 one-dart board pictures from **at least 3 different setup sessions** | JPEG + manifest + five-point label sidecar auto-captures; no privacy/split mistake          |
| First experimental model | roughly 200–300 clearly labeled dart entries across 10+ sessions           | Enough varied material to train a real, editable development model—not to promise accuracy  |
| Improvement campaign     | up to ~1,000 or more balanced real throws                                  | Use the model's confirmed/corrected results plus independent labels to cover its weak spots |

A **setup session** means a continuous run with the same phone, mount position, board, and lighting.
Data Lab rotates to a new session automatically after moving the camera, changing room/light, changing
board, or starting another day. The compiler keeps a whole session in either training, validation, or
test. That prevents a model from appearing smart merely because it saw nearly identical pictures during
training.

Do not collect 1,000 copies of T20 from one perfect view. Spread examples across:

- every single, double, treble, bull, near-wire hit, and known miss;
- practical centreline and off-axis mounts, portrait/landscape, distance, and focus conditions;
- bright/even/dim/mixed/glare lighting, backgrounds, board wear, and different phone cameras;
- steel-tip and soft-tip where relevant; and
- hard cases such as overlaps, flight/shaft clutter, visibly embedded tips, and honest failures.

Keep dangerous robin hoods, hidden tips, bounce-outs, and genuinely ambiguous points for a later
adjudication queue. Do not make up a precise label just to increase the count.

## Start today: fully synthetic bootstrap

The repository can now build a local numeric five-point YOLO dataset from simulated dartboards and
simulated dart throws with known labels:

```bash
cd ml
PYTHONPATH=src python -m darts180_vision.synthetic_five_point_dataset \
  --output-directory /secure/darts180/synthetic-five-point-v1 \
  --count 300 \
  --seed 20260908
```

The output is external-only and marks every report with `SYNTHETIC-NO-USER-DATA` and
`synthetic-not-real-world-evaluation`. It has train/validation/test folders only to smoke-test a
training experiment; none is a real-device evaluation split. Do not commit its JPEGs/labels, mix its
test partition into real evaluation, or claim scoring performance from it.

When a locally licensed YOLOv8-compatible base checkpoint is available, the same local training command
can consume that numeric five-point dataset for an explicitly synthetic development experiment:

```bash
cd ml
pip install -e '.[train,export,quality]'
PYTHONPATH=src python -m darts180_vision.deepdarts_yolo_train \
  /secure/darts180/synthetic-five-point-v1 \
  --base-model /secure/models/approved-yolov8n.pt \
  --output-directory /secure/darts180/synthetic-five-point-run \
  --model-version darts180-synthetic-bootstrap-YYYY-MM-DD \
  --training-data-id synthetic-five-point-v1 \
  --training-data-kind synthetic-only \
  --license-review-id synthetic-procedural-review-v1 \
  --hash-images
```

That command needs a local base checkpoint; this repository intentionally does not download weights or
ship a trained model. An arbitrary AI-generated whole-board photo must not be used as supervised data
simply because it looks real: its dart tips and landmarks need separately reviewed, geometry-consistent
synthetic labels and must remain explicitly synthetic. The included renderer is procedural because it
can honestly provide ground truth.

## Exact real-throw workflow

### 1. Use the guided Data Lab

1. Open the direct HTTPS Darts 180 page in Safari/Chrome—not an embedded preview—and choose
   **DATA LAB**. This is separate from **LIVE SCORING**. Read its development collection notice and
   select the required agreement only if you accept automatic private collection for product/model
   improvement. Normal players never use the data tools.
2. Wait until the private collection says **Ready**, then select **Start auto capture** once (the only
   camera button). Keep the full board/number ring visible and use a stable safe mount.
3. Wait for **Board set**, then throw one to three darts and let them settle. If **Board set** never
   appears on a real board, select **CALIBRATE SETUP**, centre the bull in the crosshair, and tap the
   outer-double rim junction between **D5 and D20** once: the 170 mm canonical geometry then locks the
   board so collection can proceed, with the learned anchors taking over whenever the model resolves
   them itself. The displayed setup session rotates automatically when the camera moves to a
   materially different pose; it also rotates on a lighting change, board change, or later collection
   day. There are no lighting band or camera notes inputs.
4. A newly settled dart auto-captures one board-only JPEG: the entry agreement has already written
   `DEVELOPMENT-DATA-LAB-CONSENT-V1`, its acceptance timestamp, and `consented-development-unreviewed`
   status into this record's metadata, and the record stays unreviewed until a restricted operator
   screens it. Whenever the board is clear, Data Lab auto-saves one blank-board anchor record.
5. When a dart record saves, the detected anchors are CAL 1 D5/D20, CAL 2 D17/D3, CAL 3 D8/D11, CAL 4
   D13/D6 with the visible settled class-0 tips. If the package is absent, invalid, unsupported by the
   browser, or can neither learn nor be setup-locked to a safe board pose, the Lab says auto capture
   stays off and saves nothing instead of deriving points from ad-hoc image thresholds. A frame
   without a safe pose—or, for a dart record, a settled tip—is skipped.
6. Watch the **Saved / Saving / Failed** counters and keep the tab open. Records save themselves to
   private storage with no confirmation; a failed save retries automatically a few times, and there is
   no manual retry. Select **Stop camera** when finished.

No manual marker review exists. The anchors follow the same five-point coordinate convention as the
isolated development Live Scoring engine, so a model trained from your pictures can use the same
detector layout without an invented landmark map:

| Model point | Physical point on the board                      |
| ----------- | ------------------------------------------------ |
| CAL 1       | the outer-double rim junction between D5 and D20 |
| CAL 2       | the outer-double rim junction between D17 and D3 |
| CAL 3       | the outer-double rim junction between D8 and D11 |
| CAL 4       | the outer-double rim junction between D13 and D6 |

### 2. Store and screen the pairs safely

Data Lab automatically stores the matched JPEG, capture manifest, and annotations JSON under a random
private record folder; it produces no public image URL and offers no browser download. When an
authorized storage operator later retrieves an approved record for model building, keep each
`JPEG + annotations JSON` pair together in a protected folder **outside the Git repository**. Do not
put images, labels, ZIP archives, weights, or credentials in the repository or chat.

Screen retrieved records for people/background details and remove EXIF before an approved training
handoff. Vercel private storage is controlled intake, not automatic dataset approval. See
[`20-private-capture-lab.md`](20-private-capture-lab.md),
[`runbooks/field-capture.md`](runbooks/field-capture.md), and
[`runbooks/local-annotation.md`](runbooks/local-annotation.md).

### 3. Keep blank boards useful but honest

Blank-board records are useful anchor-only examples: the five-point compiler accepts their four
CAL labels with zero dart labels. They do **not** let the model learn a dart tip by themselves.
Collect dart tests in every important session, and do not submit a compiled data set with no real
dart entry labels—the compiler rejects that state.

### 4. Build the local training folder

On a dedicated ML machine, compile the operator-screened pairs to the strict five-class YOLO layout:

```bash
cd ml
PYTHONPATH=src python -m darts180_vision.local_five_point_dataset \
  /secure/darts180/reviewed-capture-pairs \
  --output-directory /secure/darts180/compiled-five-point-v1 \
  --split-seed darts180-initial-campaign-v1 \
  --accepted-consent-version DEVELOPMENT-DATA-LAB-CONSENT-V1
```

The compiler refuses the wrong annotation mode, missing/mismatched JPEGs, changed image dimensions,
unsafe paths, missing session IDs, duplicate JPEG bytes, fewer than three sessions, labels outside the
image, and a source/output directory that overlaps the repository. It makes a session-separated
`train`/`val`/`test` layout, numeric class IDs `0` through `4`, a traceability report, and a structural
audit. It does not train, download, upload, or deploy anything.

### 5. Mix approved real throws with procedural simulated scenes

After a restricted operator has screened the private records, compile the real pairs and generate the
procedural bootstrap outside the repository. Then create a mixed development dataset:

```bash
cd ml
PYTHONPATH=src python -m darts180_vision.mixed_five_point_dataset \
  --real-dataset-root /secure/darts180/compiled-five-point-v1 \
  --synthetic-dataset-root /secure/darts180/synthetic-five-point-v1 \
  --output-directory /secure/darts180/mixed-five-point-v1 \
  --mix-id darts180-mixed-dev-v1 \
  --real-review-id private-capture-review-v1 \
  --synthetic-review-id procedural-renderer-review-v1
```

The mixer uses real + synthetic examples for `train`, but retains **real-only** `val` and `test`
sessions. It re-audits class mapping, JPEG/label pairing, and cross-source duplicate bytes, records
source-report hashes and explicit review IDs, and refuses automatic training admission. It neither
reads Vercel Blob nor makes generated scenes count as real-camera evaluation.

### 6. Train a mixed local development model

A vision engineer then supplies a **locally licensed** YOLOv8-compatible starting checkpoint. This command
does not download one automatically:

```bash
cd ml
pip install -e '.[train,export,quality]'
PYTHONPATH=src python -m darts180_vision.deepdarts_yolo_train \
  /secure/darts180/mixed-five-point-v1 \
  --base-model /secure/models/approved-yolov8n.pt \
  --output-directory /secure/darts180/first-mixed-five-point-run \
  --model-version darts180-mixed-dev-YYYY-MM-DD \
  --training-data-id darts180-mixed-dev-v1 \
  --training-data-kind mixed-synthetic-and-real \
  --license-review-id local-self-capture-and-procedural-review-v1 \
  --hash-images
```

It makes a raw local ONNX model and a development-only JSON description with its SHA-256 fingerprint.
A reviewer must inspect both, test them in actual phone browsers, and consciously install them under
`apps/web/public/models/`. Only then does Live Scoring change from “model not installed” to real **editable
suggestions**. It still never becomes production auto-recording from this workflow.

## What happens after the first model works

The model suggests a score; you either choose **Confirm as shown** or correct the DartCard. For this
consent-gated development program, collect any later training examples through **Data Lab** instead of a
Live Scoring download/export path. Data Lab auto-captures each settled dart and blank board and saves the
matching private JPEG/manifest/annotations trio with no review step, but it is still not automatically a
valid training label. A restricted operator must screen, deduplicate, split, and approve each unreviewed
record before the next training run.

Keep an untouched set of whole sessions as the exam for each new model. Never move a model's own training
pictures into that exam just to get a nicer number.

## What this does not claim

This workflow creates the path to a real first model. It does not yet prove broad phone accuracy, make the
unavailable production model available, or authorize a Vercel deployment. Every initial suggestion remains
editable precisely because real-world data collection and improvement are still underway.
