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
| Handheld setup          | User aligns then locks device/mount                                        | Guide/calibrate; do not score while pose is moving                                   |
| Second phone / multicam | Difficult lighting/occlusion, premium reliability                          | Fuse independent canonical point distributions                                       |

The visible product phrase is “works from the angle your room allows.” The engineering contract is
`boardDiameterPixels ≥ 480`, `quality ≥ 0.70`, `offAxis ≤ 55°` for the first support envelope. The
thresholds are versioned remote configuration and can only relax after held-out data says so.

## 4. End-to-end pipeline

```text
Camera frames (native, 30–60 fps)
  └─> lens/orientation normalization + exposure/focus checks
       └─> board pose model (low cadence) ──> homography + calibration quality
            └─> temporal occupancy/change tracker
                 └─> impact / new-dart trigger
                      └─> settle window (typically 200–400 ms)
                           └─> changed-region crop and entry-point model
                                └─> distribution in canonical board mm
                                     └─> deterministic polar decoder
                                          └─> confidence + top-k candidates
                                               └─> DartCard review policy
                                                    └─> confirmed immutable game event
```

### 4.1 Frame capture and pre-processing

- Capture is native (`AVFoundation` on iOS; `CameraX` on Android), never a JavaScript frame loop.
- Maintain a small in-memory ring buffer of downscaled luma/chroma frames and high-resolution key
  frames where device thermals allow it.
- Separate preview resolution from inference crop. It is often efficient to track at 720p and
  query a native full-resolution crop only after a trigger.
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

- Detect change against a stable background/occupancy map, then associate a dart track across
  frames.
- Wait until the shaft/tip likelihood and board pose are stable for the settle window. Never score
  the first sharp-looking impact frame.
- Do not infer a missing dart after a bounce-out. Surface “possible bounce-out / manual” instead.
- If an accepted dart track vanishes before confirmation, stop auto mode; a player likely removed
  a dart or an association failed.
- A robin hood / stacked tip must default to an ambiguous review card. A single camera cannot
  reliably see all entry points in every stack.

The shared policy skeleton lives in `packages/vision-session`; the native runtime supplies track
IDs and candidates.

Current development tooling includes inspectable OpenCV pose/quality and fixed-camera
before/after-frame baselines under `ml/src/darts180_vision`. They use known/synthetic conditions to
exercise contracts and failure capture; they are neither a learned runtime nor evidence of
real-world auto-scoring performance.

### 4.3.1 Implemented browser field-test bridge

The deployable web prototype has a deliberately constrained, no-calibration **Camera Play**
workspace for first real-board testing. It is not the production native runtime. On a fixed mounted
browser camera, it:

1. samples conventional red/green accents and searches for a repeated, color-balanced,
   alternating-color double-and-treble scoring-band pair rather than trusting the outermost colored
   pixel; this resists a red surround, printed branding, or one coloured object;
2. uses the compact two-color bull as a local centre cross-check, then estimates the band-pair ellipse,
   requires two comparable automatic fits, and creates an internal outer-double homography; it checks
   board pixels, band evidence, proportions, and local image detail against the initial 480 px /
   approximately 55° envelope;
3. asks the player only to keep the physical 20 upright in the image and tap **Start Play** with an
   empty board. After the accepted automatic fit, Start Play waits a fixed 650 ms and saves one fresh
   volatile local reference. If no drawable browser frame exists it retries at 250 ms up to four
   additional attempts, then returns control; a dart-like or broad-motion detector label is never
   permitted to return normal setup to board finding or block it indefinitely;
4. compares each later settled frame with the current in-memory reference after board-face-only
   exposure/white-balance/noise estimation and bounded board-relative similarity alignment for
   impact/mount/phone-optical-stabilization jitter (small shift, scale, and rotation). After an
   accepted aligned dart, it carries that correction into the in-memory mapping and next reference. It
   still holds movement that remains broad on the scoring face, while retaining a limited outside-ring
   margin only to connect a local flight/shaft shape;
5. ranks elongated side-view shafts and compact near-centreline flight/occlusion changes, but only
   auto-scores a non-`MISS`, adequately separated endpoint when direction is direct: exactly one
   endpoint is on a scoring bed or a clearly wider flight establishes the opposite narrow entry end.
   Compact centroids, equal-width endpoint pairs, near-wire cues, and ambiguous directions are held
   for ordinary correction instead of being converted into an arbitrary score. One isolated held
   shape can be surfaced as an explicit camera suggestion, but cannot fill a DartCard without a
   player action; competing shapes surface no suggestion. A protruding flight endpoint outside the
   double wire is never an automatic `MISS`; and
6. requires a nearby same-zone automatic-eligible candidate across two frames (with one-frame grace)
   before adding it, then updates the in-memory reference to include that accepted dart before looking
   for the next one. A next turn takes the same bounded one-tap reference handoff without asking the
   player to find the board again.

Normal play does not ask a player to name calibration points, fit a guide, download/capture a
reference image, press a manual-analysis button, select a physical tip, or choose steel versus
soft-tip setup. In automatic normal mode, the preview contains only a subtle non-interactive board
indication and status; detailed rings, spokes, handles, and the `20` marker live only in optional
manual recovery. Raw fit/detector metrics are under an explicit diagnostics disclosure.

The player-facing board rendering follows the conventional dark-S20/red-accent and light-S1/S5/green-
accent pattern, but the browser fitter does **not** mistake black/white singles for number recognition.
Colors cannot uniquely read a board’s number-ring rotation because red/green bands repeat, so this
browser field test deliberately assumes a level, 20-up board; a trained board/number-orientation model
is still required for general automatic orientation. Optional visual-guide gestures plus named-anchor
advanced diagnostics remain recovery-only.

[PR #8](https://github.com/nick-kuhle/darts-180/pull/8) and
[PR #9](https://github.com/nick-kuhle/darts-180/pull/9) are merged. A direct post-PR #9 iPhone report
showed strong automatic board finding but an unacceptable detector-gated setup loop. The bounded
reference handoff described here is regression-tested but is not a claimed device fix until it is
retested on direct top-level HTTPS iPhone and Android deployments. See
[`15-browser-dart-field-remediation.md`](15-browser-dart-field-remediation.md).

### 4.4 Dart entry-point model

**Do not train only an image → 0..60 score classifier.** It cannot generalize cleanly across board
rotations, profiles, angles, or games, and it provides poor correction explanations.

The production model input is the calibrated board crop plus temporal change evidence:

- pre-impact frame / stable background;
- post-settle key frame(s);
- change mask or optical/feature difference;
- pose/scale metadata; optionally shaft-direction cue;
- existing-dart occupancy map.

Output is a heatmap or probabilistic distribution over canonical `(x,y)` plus visibility/occlusion
and uncertainty heads. Project samples/peaks through the deterministic decoder to create a top-k
zone distribution. Train separate heads or models when ablations prove value:

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
