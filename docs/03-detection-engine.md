# Detection engine specification

**Status:** build specification; not a claim that a trained model exists  
**Owner:** Vision Runtime + ML/Data  
**Core stance:** infer dart **entry point**, map it into canonical board geometry, then score deterministically.

## 1. What “any angle” actually means

A dartboard is approximately planar. If the camera can see enough stable board landmarks, a
homography maps image pixels to a face-on canonical board. That makes a front, high, or moderately
side-on camera _geometrically comparable_.

It does **not** magically solve:

- too few pixels across 8 mm double/treble wires;
- a dart point hidden behind its barrel/another dart at a very oblique view;
- blur from impact, low light, lens flare, fisheye distortion, or a moving handheld phone;
- board partly outside frame or a board moved after calibration;
- bounce-outs, robin hoods, and deep occlusion.

Darts 180 expands support angle-by-angle through measured evaluation. The runtime has permission to
say “I cannot see this reliably.” That abstention protects trust and provides an actionable setup
instruction.

## 2. Physical board model

Standard steel-tip geometry, measured from bull center:

| Region / boundary            | Radius / size |
| ---------------------------- | ------------: |
| Inner bull (50) radius       |       6.35 mm |
| Outer bull (25) outer radius |       15.9 mm |
| Treble ring                  |     99–107 mm |
| Double ring                  |    162–170 mm |
| Board outer double radius    |        170 mm |
| Double/treble wire width     |          8 mm |
| Standard board diameter      |        451 mm |

After calibration, canonical coordinates use `x` right, `y` down, origin at bull. Wedge angle is
clockwise from twelve o’clock:

```text
theta = atan2(x, -y) mod 360
segment_index = floor((theta + 9) / 18) mod 20
order = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5]
```

The TS, Rust, and Python references must remain differential-test-equivalent. See
`packages/rules/src/board.ts`, `native/vision-core`, and `ml/.../geometry.py`.

## 3. Camera placement profiles

| Profile                 | Use case                                                                   | Expected strategy                                                                    |
| ----------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Preferred mount         | Cheap phone/tablet arm near centerline, 0.7–1.2 m from board, 10–25° above | Highest single-camera accuracy; default beta contract                                |
| Front-side              | Phone offset left/right/up to about 55° pose if board fills frame          | Homography + angle-trained entrypoint model                                          |
| Room-side               | Further phone/tripod view                                                  | Supported only when board resolution and quality pass; may need high-resolution crop |
| Handheld setup          | User stabilizes then locks device/mount                                    | Automatically assess pose; do not score while pose is moving                         |
| Second phone / multicam | Difficult lighting/occlusion, premium reliability                          | Fuse independent canonical point distributions                                       |

The visible product phrase is “works from the angle your room allows.” The initial engineering envelope is
`boardDiameterPixels ≥ 480`, `quality ≥ 0.70`, `offAxis ≤ 55°`; final values are model-specific. Thresholds
travel in a versioned, integrity-checked same-origin model manifest and can only relax after locked held-out
data says so.

## 4. End-to-end pipeline

```text
High-quality browser camera frames (getUserMedia)
  └─> lens/orientation normalization + exposure/focus checks in a Web Worker
       └─> learned complete-board pose/orientation + quality model (low cadence)
            └─> temporal occupancy/change monitor (event association only)
                 └─> post-impact high-resolution frame burst + settle selection
                      └─> learned dart-entry-point/occlusion model
                           └─> image-to-canonical-board transform + point distribution in mm
                                └─> deterministic polar decoder
                                     └─> calibrated auto-score / review / abstain policy
                                          └─> DartCard review and confirmed immutable game event

The web runtime is the first delivery target. iOS/Android adapters later use the identical model-artifact,
pose/tip, geometry, score-proposal, and decision contracts; they are not a prerequisite for browser scoring.
```

### 4.1 Frame capture and pre-processing

- Capture starts with `getUserMedia` in the HTTPS browser, requesting the best available rear-camera
  resolution; it never uploads normal-play frames.
- A module Web Worker owns preprocessing and ONNX/WASM or WebGPU inference so React rendering does not
  become the frame processor. Keep a small in-memory ring buffer of downscaled luma/chroma event cues and
  high-resolution post-impact frames.
- Separate preview resolution from inference crop. Track quality at low cadence and send a high-resolution
  post-impact burst to the learned model only after an event cue. Native AVFoundation/CameraX adapters will
  implement the same capture contract after the browser scorer has passed its evidence gates.
- Correct orientation, lens distortion, rolling-shutter artifacts where device calibration allows,
  auto-exposure swings, and temporal noise before model inference.
- Measure frame timestamps, dropped frames, focus/sharpness, exposure/glare, motion, board pixel
  scale, and full-board visibility. These are input to quality policy, not merely diagnostics.

### 4.2 Board detection, pose, and calibration

**Goal:** estimate a transform from image pixel `(u,v)` to canonical board point `(x,y)`.

A model predicts redundant landmarks: bull center, cardinal wire intersections, double/treble
ellipse points, outer-board contour, wedge orientation (20 at top), and board profile features. A
robust solver fits a homography / camera pose using RANSAC and rejects geometrically inconsistent
landmarks. Track it over time with a filter; do not re-run expensive full pose at every frame.

Calibration outputs:

```ts
BoardCalibration {
  calibrationId,
  boardProfile,
  imageToBoardHomography: [9 values],
  quality: { overall, boardCoverage, sharpness, glareRisk, occlusionRisk,
             offAxisDegrees, boardDiameterPixels, reasons[] }
}
```

Recalibration triggers: board movement estimate beyond tolerance, sustained landmark residual,
rotation change, camera-motion event, sustained quality drop, or explicit user request. Calibration
must be testable on varied boards—not only fresh boards with ideal wire contrast.

### 4.3 Temporal occupancy and impact policy

A photo-only classifier cannot safely distinguish first/second/third dart, a hand, a bounce-out, or
an already-present shaft. Maintain an occupancy state machine:

```text
BOARD_CLEAR → WATCHING → IMPACT_CANDIDATE → SETTLING → DART_N_PROPOSED
                                                │
                                                ├─ evidence disappears → BOUNCE_OUT / manual flag
                                                └─ board changes unexpectedly → FREEZE + review
DART_1/2/3_PROPOSED → TURN_REVIEW → TURN_CONFIRMED → AWAIT_BOARD_CLEAR → BOARD_CLEAR
```

- Use a low-resolution temporal cue only to associate likely impact timing, then associate learned
  canonical dart-tip observations against semantic occupancy tracks across high-resolution frames.
- Wait until learned tip observations and board pose are stable for the settle window. Never score
  the first sharp-looking impact frame.
- Do not infer a missing dart after a bounce-out. Surface “possible bounce-out / manual” instead.
- If an accepted dart track vanishes before confirmation, stop auto mode; a player likely removed
  a dart or an association failed.
- A robin hood / stacked tip must default to an ambiguous review card. A single camera cannot
  reliably see all entry points in every stack.

The shared policy skeleton lives in `packages/vision-session`; the web Worker supplies track IDs and
candidates first, and later native runtimes must conform to the same boundary.

Current development tooling includes inspectable OpenCV pose/quality and fixed-camera
before/after-frame baselines under `ml/src/darts180_vision`. They use known/synthetic conditions to
exercise contracts and failure capture; they are neither a learned runtime nor evidence of
real-world auto-scoring performance.

### 4.3.1 Implemented web-first learned runtime boundary

The active web branch ships a new **Learned Camera Play** route instead of the former browser heuristic.
It starts a rear camera only after a player action, sends transferable high-resolution `ImageBitmap` frames
to a same-origin module Worker, and never exposes calibration or tip-picking controls in normal play.

The Worker:

1. loads a versioned same-origin manifest and refuses an unavailable, malformed, unproven, or
   integrity-mismatched artifact;
2. verifies exact ONNX bytes with SHA-256 before creating an ONNX Runtime Web session;
3. attempts WebGPU first and falls back to single-threaded WASM without requiring cross-origin isolation;
4. owns RGB zero-to-one letterbox preprocessing and strict `darts180-board-tip-v1` semantic tensor
   decoding; and
5. returns only named landmarks, learned tip positions/uncertainty/occlusion, learned quality values,
   timing, and backend identity—not a model-produced dart score.

`d20-double`, `d6-double`, `d3-double`, and `d11-double` establish orientation; bull plus the four
outer-double cardinal points independently validate that learned pose. Repeated red/green board colors are not
used as an orientation authority. The main-thread engine maps each learned tip to canonical millimetres,
associates stable tips over a post-impact burst, and delegates zone selection to the shared deterministic rules
package. A low-resolution luma frame may request a burst or flag material scene motion, but it has no board
coordinate, endpoint, zone, or score eligibility role.

The current checked-in manifest is deliberately `unavailable`. This means the complete browser architecture,
UI, Worker, integrity/CSP configuration, and safety tests are implemented, while Camera Play correctly refuses
to score until a lawful trained artifact and held-out evaluation release exist. The former red/green/
frame-difference React components are removed from the shipped route; their historical failure baseline is
recorded in [`15-browser-dart-field-remediation.md`](15-browser-dart-field-remediation.md).

The fixed browser output contract is:

```text
input:  float32 [1, 3, H, W], RGB, zero-to-one, letterboxed
landmarks: exactly 9 × [normalized x, normalized y, confidence]
tips:       N × [normalized x, normalized y, confidence, sigma-x, sigma-y, occlusion risk]
quality:    [overall, board coverage, sharpness, glare risk, off-axis fraction, occlusion risk]
```

The exported model owns learned NMS and semantic interpretation. The runtime rejects incompatible tensor
shapes rather than silently applying a second detector. A model manifest locks its output names, dimensions,
release stage, evaluation/provenance identifiers, calibration policy, and artifact checksum together.

### 4.4 Dart entry-point model

**Do not train only an image → 0..60 score classifier.** It cannot generalize cleanly across board
rotations, profiles, angles, or games, and it provides poor correction explanations.

The initial browser output contract takes one high-resolution, orientation-normalized RGB camera frame.
A future version may explicitly accept a learned temporal stack or prior-frame feature tensor only after its
manifest/contract and evaluation are updated. It must not use a hand-crafted RGB difference mask or endpoint
width rule as the score localizer. Relevant model inputs/heads can include:

- the post-settle key frame (and, only in a versioned later contract, learned temporal context);
- full-board pose/scale and image-quality evidence;
- learned visible-dart/flight context and existing-dart occupancy; and
- tip visibility, stacking, bounce-out, and uncertainty evidence.

Output is a semantic distribution over source-frame tip position plus visibility/occlusion and uncertainty
heads; the Worker projects it through the automatically solved board pose and deterministic decoder to create a
top-k zone distribution. Train separate heads or models when ablations prove value:

1. `board-pose` — landmarks/ellipse/orientation/quality; low cadence.
2. `dart-arrival` — temporal event / track association; continuous, lightweight.
3. `entrypoint` — point heatmap/regression + uncertainty; event-triggered.
4. `ambiguity` — occlusion/robin-hood/bounce-out/hand/not-a-dart classifier.

A two-stage crop model is normally more efficient and explainable than a giant detector on every
full camera frame.

### 4.5 Deterministic score decoder

For each canonical point, compute radius and face-on wedge angle. Decode inner bull, outer bull,
single/treble/single/double, or miss using the physical radii in Section 2. Calculate:

- radial distance to every scoring wire;
- angular distance to a wedge wire;
- calibration/pose residual;
- model entropy and top-1 vs top-2 margin;
- track stability and image quality.

The decoder's output must carry `zone`, probability, `wireMarginMm`, calibration/model version, and
optionally a local clip handle. It must never choose game-specific legality (e.g., whether D20 is a
legal checkout); game rules process confirmed zones separately.

## 5. Confidence and human review policy

A top-1 probability is not enough. A `T20` 0.99 prediction 0.1 mm from a wire is a likely UI review
case. Initial policy:

| Condition                                                       | UI disposition                                            |
| --------------------------------------------------------------- | --------------------------------------------------------- |
| Quality gate fails                                              | Block auto proposal; show specific camera fix/manual path |
| Occlusion/ambiguous class                                       | Flag; manual/replay required                              |
| `p(top1) ≥ .97` **and** wire margin ≥1.5 mm **and** stable pose | `LOCKED`, editable                                        |
| Otherwise                                                       | `CHECK`, ranked alternatives and correction affordance    |

Thresholds must be calibrated on the held-out dataset separately by device, angle, light, board,
ring, and margin. Auto-accept _precision_ is a safety metric; coverage is secondary.

## 6. On-device runtime targets

| Dimension             |       Prototype target |               Beta target |                    Mature target |
| --------------------- | ---------------------: | ------------------------: | -------------------------------: |
| Input tracking        |          720p @ 30 fps |          720p @ 30–60 fps |                         adaptive |
| Pose inference        |                  ≤1 Hz |   ≤2 Hz / drift-triggered |                         adaptive |
| Entry inference       | ≤60 ms event-triggered |                    ≤25 ms | ≤10–15 ms device-class dependent |
| End-to-card latency   |             p95 ≤2.5 s |                    ≤1.5 s |                           ≤1.0 s |
| Extra sustained power |                measure |                  aim ≤2 W |      device-aware thermal budget |
| Bundle/model          |            development | INT8/FP16 mobile artifact |             signed, rollbackable |

Benchmark actual supported devices. A startup benchmark/compatibility gate is honest; a weak device
gets manual scoring and camera setup rather than an unreliable promise.

## 7. Failure taxonomy and behavior

| Failure              | Detection signal            | Product response                      | Data label                |
| -------------------- | --------------------------- | ------------------------------------- | ------------------------- |
| Board too small      | diameter pixels below gate  | move camera closer                    | `insufficient-resolution` |
| Oblique/partial view | pose residual / coverage    | reframe toward centerline             | `pose-invalid`            |
| Glare/shadow         | quality head                | change lighting / angle               | `glare`, `shadow`         |
| Motion/handheld      | motion + pose drift         | lock mount; pause scoring             | `camera-motion`           |
| Bounce-out           | impact then no stable track | manual/bounce-out prompt              | `bounce-out`              |
| Robin hood           | conflicting/occluded tracks | mandatory review                      | `robin-hood`              |
| Shaft occlusion      | visibility head             | top-k/replay/manual                   | `occluded-tip`            |
| Board rotation/move  | transform drift             | find board mapping again              | `board-moved`             |
| Unrecognized board   | profile confidence low      | automatic profile / optional recovery | `unknown-board`           |

## 8. Model delivery and safety

- Export one versioned mobile artifact per runtime/device delegate (Core ML, TFLite/NNAPI/GPU as
  justified). Include input normalization and output schema checks.
- Each artifact has a data snapshot ID, source commit, training config, checksum, slice metrics,
  privacy review, and rollback owner.
- Use staged rollout: internal → opt-in beta → 1% → 10% → cohort expansion, with server-configured
  threshold rollback independent of app-store release.
- Never train directly on unreviewed production clips. Ingest consented examples, redact/validate,
  label, split before training, and preserve a sacred evaluation set.

## 9. V1 build order

1. Board-quality/pose model + guided setup, no scoring claim.
2. Offline capture/label tools; stable rig first.
3. Temporal change/occupancy tracker; record candidate timing/false trigger metrics.
4. Entrypoint baseline trained on controlled board/dart data.
5. DartCard integration, confidence calibration, and correction capture.
6. Hard-room/device/angle expansion with evaluation gates.
7. Optional two-phone/multicam fusion for hard conditions.

## 10. Definition of “ready to claim auto-scoring”

A model may be advertised only after a locked, two-human-labeled, non-synthetic, device-diverse
held-out test set demonstrates the published supported envelope; auto-accept precision meets the
safety target; correction, fallback, and privacy flows have passed field testing; and support has a
reproducible clip/diagnostic process. A successful demo is not evidence of any of those conditions.
