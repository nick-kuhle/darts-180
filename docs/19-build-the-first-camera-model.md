# Build the first camera model from real throws

**Snapshot date:** 2026-09-08 (America/Los_Angeles)<br />
**Audience:** a Darts 180 owner/tester building the first real development scorer<br />
**Purpose:** turn consented, board-only real throws into a local training set—without pretending the
current app has a model already

## The fifth-grade version

The camera can already show a picture. The app also knows all dart rules: it knows what `T20`, a bull,
and a miss mean. What it does **not** have yet is practice recognizing a dart tip and a board in a real
phone picture.

We give it that practice in three simple stages:

1. **Take board pictures** after real throws. Keep people out of the picture.
2. **Tell the computer where the dart tip and four board guide points are** in each picture. This is
   done in the special data tools, not in normal Live Scoring.
3. **Train the model** from many of those examples. Then Live Scoring can suggest scores, and you can
   correct the suggestions to make the next model better.

Normal players never have to do the clicking in step 2. It is only the temporary, honest way to teach
the first version what it is looking for.

## What to collect first

Start small enough to prove the workflow, then grow it:

| Stage                    | Goal                                                                       | What “done” means                                                                           |
| ------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Dry run                  | 12–20 one-dart board pictures from **at least 3 different setup sessions** | JPEG + manifest + five-point label sidecar export works; no privacy/split mistake           |
| First experimental model | roughly 200–300 clearly labeled dart entries across 10+ sessions           | Enough varied material to train a real, editable development model—not to promise accuracy  |
| Improvement campaign     | up to ~1,000 or more balanced real throws                                  | Use the model's confirmed/corrected results plus independent labels to cover its weak spots |

A **setup session** means a continuous run with the same phone, mount position, board, and lighting.
Start a new session in Data Lab after moving the camera, changing room/light, changing board, or starting
another day. The compiler keeps a whole session in either training, validation, or test. That prevents a
model from appearing smart merely because it saw nearly identical pictures during training.

Do not collect 1,000 copies of T20 from one perfect view. Spread examples across:

- every single, double, treble, bull, near-wire hit, and known miss;
- practical centreline and off-axis mounts, portrait/landscape, distance, and focus conditions;
- bright/even/dim/mixed/glare lighting, backgrounds, board wear, and different phone cameras;
- steel-tip and soft-tip where relevant; and
- hard cases such as overlaps, flight/shaft clutter, visibly embedded tips, and honest failures.

Keep dangerous robin hoods, hidden tips, bounce-outs, and genuinely ambiguous points for a later
adjudication queue. Do not make up a precise label just to increase the count.

## Exact first-model workflow

### 1. Use the guided Data Lab

1. Open the direct HTTPS Darts 180 page in Safari/Chrome—not an embedded preview—and choose
   **DATA LAB**. This is separate from **LIVE SCORING**. Normal players never need the label taps.
2. Start with **Blank board**. Keep the full board/number ring visible, use a stable safe mount, and
   take a board-only photo. Later choose **Dart test** after one to three darts have settled.
3. Keep the generated setup session ID while the phone, mount, board, and light stay the same. Use
   **Start a new setup session** after a material change. Select the lighting band and optional
   camera notes honestly.
4. Inspect the exact still. Confirm both statements only when true: no person/sensitive room detail
   is visible, and you own the board-focused capture or have permission to use it for Darts 180
   development. The app writes `SELF-CAPTURE-DEVELOPMENT-V1` only after that confirmation.
5. Tap these four **outer-double-rim junctions** in the displayed order:

   | Model point | Physical point to tap                            |
   | ----------- | ------------------------------------------------ |
   | CAL 1       | the outer-double rim junction between D5 and D20 |
   | CAL 2       | the outer-double rim junction between D17 and D3 |
   | CAL 3       | the outer-double rim junction between D8 and D11 |
   | CAL 4       | the outer-double rim junction between D13 and D6 |

6. For a **Dart test**, tap each clearly visible physical dart entry tip—not the flight, shaft end,
   or a guessed hidden point. The shown deterministic score is a check on your manual point, not a
   camera prediction. A **Blank board** intentionally stops after the four board points; do not add
   an invented dart label.
7. Recheck the label statement, choose **Review save**, then choose either **Download local backup**
   or **Save to private storage**. The private option is available only after the existing Vercel
   project has the private Blob/collection-key setup in
   [`20-private-capture-lab.md`](20-private-capture-lab.md).

The unusual four points are deliberate. They use the same five-point coordinate convention as the
isolated development Live Scoring engine, so a model trained from your pictures can use real
detections without an invented landmark map.

### 2. Store and screen the pairs safely

A local backup downloads three matched files: JPEG, capture manifest, and annotations JSON. Private
Data Lab storage holds the same three files under a random private record folder; it produces no
public image URL. In either case, keep each `JPEG + annotations JSON` pair together in an approved
folder **outside the Git repository**. Do not put images, labels, ZIP archives, weights, or
credentials in the repository or chat.

Screen for people/background details and remove EXIF before an approved training handoff. Vercel
private storage is controlled intake, not automatic dataset approval. See
[`20-private-capture-lab.md`](20-private-capture-lab.md),
[`runbooks/field-capture.md`](runbooks/field-capture.md), and
[`runbooks/local-annotation.md`](runbooks/local-annotation.md).

### 3. Keep blank boards useful but honest

Blank-board records are useful anchor-only examples: the five-point compiler accepts their four
CAL labels with zero dart labels. They do **not** let the model learn a dart tip by themselves.
Collect dart tests in every important session, and do not submit a compiled data set with no real
dart entry labels—the compiler rejects that state.

### 4. Build the local training folder

On a dedicated ML machine, compile the reviewed pairs to the strict five-class YOLO layout:

```bash
cd ml
PYTHONPATH=src python -m darts180_vision.local_five_point_dataset \
  /secure/darts180/reviewed-capture-pairs \
  --output-directory /secure/darts180/compiled-five-point-v1 \
  --split-seed darts180-initial-campaign-v1 \
  --accepted-consent-version SELF-CAPTURE-DEVELOPMENT-V1
```

The compiler refuses the wrong annotation mode, missing/mismatched JPEGs, changed image dimensions,
unsafe paths, missing session IDs, duplicate JPEG bytes, fewer than three sessions, labels outside the
image, and a source/output directory that overlaps the repository. It makes a session-separated
`train`/`val`/`test` layout, numeric class IDs `0` through `4`, a traceability report, and a structural
audit. It does not train, download, upload, or deploy anything.

### 5. Train a real local development model

A vision engineer then supplies a **locally licensed** YOLOv8-compatible starting checkpoint. This command
does not download one automatically:

```bash
cd ml
pip install -e '.[train,export,quality]'
PYTHONPATH=src python -m darts180_vision.deepdarts_yolo_train \
  /secure/darts180/compiled-five-point-v1 \
  --base-model /secure/models/approved-yolov8n.pt \
  --output-directory /secure/darts180/first-five-point-run \
  --model-version darts180-local-dev-YYYY-MM-DD \
  --training-data-id local-five-point-campaign-v1 \
  --license-review-id local-self-capture-review-v1 \
  --hash-images
```

It makes a raw local ONNX model and a development-only JSON description with its SHA-256 fingerprint.
A reviewer must inspect both, test them in actual phone browsers, and consciously install them under
`apps/web/public/models/`. Only then does Live Scoring change from “model not installed” to real **editable
suggestions**. It still never becomes production auto-recording from this workflow.

## What happens after the first model works

The model suggests a score; you either choose **Confirm as shown** or correct the DartCard. If you opt in,
the browser can download a local JPEG/JSON evidence pair after your review. That is a useful way to focus
later collection on mistakes, but it is not automatically a valid training label. Screen, label, deduplicate,
and split it properly before it enters the next training run.

Keep an untouched set of whole sessions as the exam for each new model. Never move a model's own training
pictures into that exam just to get a nicer number.

## What this does not claim

This workflow creates the path to a real first model. It does not yet prove broad phone accuracy, make the
unavailable production model available, or authorize a Vercel deployment. Every initial suggestion remains
editable precisely because real-world data collection and improvement are still underway.
