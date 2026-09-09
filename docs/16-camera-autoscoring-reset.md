# Darts 180 automatic-scoring reset — research decision

**Decision date:** 2026-09-08
**Status:** active web-first replacement direction; [draft PR #12](https://github.com/nick-kuhle/darts-180/pull/12) is based on freshly fetched merged `main`
**Scope:** replaces the production perception/detection subsystem, **not** the game, rules, correction, privacy, or product shell.

> **Decision in one sentence:** retire the browser frame-difference / connected-component detector as a production auto-scorer; build and validate a web-first, browser-local learned single-camera system that automatically adapts to practical phone views, then reuse its contracts/data/model program in native apps, while designing a fixed calibrated multi-camera and lighting tier for high-confidence steel-tip scoring.

## Clarified product requirement — automatic adaptation, not player calibration

Darts 180 must let a player point a phone at a normal physical dartboard and automatically:

1. find the board, its outer boundary, bulls, double/treble rings, all twenty sectors, and its actual
   orientation—not merely red/green colour bands or an assumed 20-up pose;
2. account for the phone's practical distance, angle, lens characteristics, framing, focus, brightness,
   white balance, glare, and lighting changes without asking the player to click points or fit a guide;
3. detect the **new physical dart tip** and its intersection with the board's scoring plane, rather than
   merely detect that pixels moved; and
4. map that measured coordinate through canonical board geometry to the correct section/ring/score,
   retaining fast correction only when calibrated evidence says the answer is unsafe.

“Any angle/distance/lighting” is a product requirement for broad automatic adaptation, data coverage,
and honest device-quality handling—not permission to fabricate a score when the camera contains no
recoverable information. A board outside the frame, too few effective board pixels, a saturated/black
image, or a tip completely hidden behind another dart is physically unobservable from one view. In those
rare cases the app must automatically request a simple reposition, accept a second view, or abstain to
correction. It must never turn that limitation into manual calibration or a guessed score.

## 1. Why this decision exists

A direct post-merge field retest was reported after PR #11. Board acquisition and the bounded **Start Play → Watching Locally** transition worked, but the detector still did not record a visibly embedded dart. One screen reported broad movement; another reported that dart-like changes competed or could not be mapped safely. The private screenshots were used only as diagnostic evidence, not as test fixtures or training data.

That evidence establishes three things:

1. The immediate failure is not simply board discovery or the clear-board handoff.
2. The present system correctly prefers abstention over inventing a score, so its safety policy remains valuable.
3. Its **perception method has not achieved usable dart recall on a real phone setup**. It cannot be promoted by another threshold adjustment.

The retired browser path reduced a video frame to a canvas with a maximum working edge of 1280 pixels, compared RGB pixels against a reference about every 500 ms, joined changed pixels into connected components, estimated an elongated/compact shape, and guessed a likely endpoint from width and board containment. Temporal change, shape heuristics, and endpoint ranking are therefore being asked to do two different jobs:

- detect that an event happened; and
- measure the physical point at which a dart intersects the scoring plane.

They are useful diagnostics and reasonable event cues. They are not a reliable semantic dart-tip detector or calibrated position measurement system. The second field failure is the expected failure mode of that distinction, not evidence that the rules engine, correction UX, or the entire application must be discarded.

## 2. Direct answers

### Does Winmau / Autodarts Lens work the same way?

**It is a one-phone, on-device vision product, but its model and internal scoring pipeline are not publicly disclosed.** We should not claim that Lens uses frame differencing, a specific neural-network architecture, radar, acoustic sensing, flight tracking, or triangulation.

What Autodarts publicly documents is materially different from the current Darts 180 browser experiment:

- Lens uses one phone or tablet camera and says dart recognition happens on the device; it recommends hardware with an Apple Neural Engine or Android NPU.
- Its application checks framing and asks the player to position a stable device roughly one metre from the board and **off to one side**. It explicitly warns that an almost straight-on view makes it hard to see how far the dart protrudes.
- It says one viewpoint can hide a dart behind another and positions dedicated multi-camera hardware as the next step for frequent use.

Those statements prove neither its exact model nor its accuracy. They do prove that Lens is not marketed as a front-on, browser-canvas, frame-difference-only system, and that its product designers accept one-camera occlusion as a real physical limitation.

### Does Darts 180 need an entire overhaul?

**The automatic-scoring subsystem needs a substantial replacement. The whole product does not.**

Keep and harden:

- darts rules, checkout logic, turn management, scoring records, and game modes;
- the conservative correction and confirmation path;
- the privacy principle that camera data stays local unless a player explicitly opts into research capture;
- the normal-flow promise of no manual calibration, no named board-point clicks, no visible-tip clicking, no image upload, and no manual analysis action; and
- the bounded clear-board / Start Play state transition as a product-state safety mechanism.

Replace:

- browser canvas frame-difference / color-threshold logic as the primary perception runtime;
- RGB reference differencing, connected-component shape rules, and endpoint-width rules as the primary dart-localization mechanism;
- the near-centreline-only placement recommendation; and
- “confidence” values that are heuristic ranks rather than calibrated probabilities.

## 3. What the September 2026 market actually supports

The market now separates into useful technical classes. Vendor percentages and feature claims below are vendor claims, not Darts 180 benchmarks or independent validation.

| Class                                   | Publicly disclosed example              | What is credible from public material                                                                                                                                        | What it proves for Darts 180                                                                                                  |
| --------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Single-phone, on-device vision          | Autodarts Lens                          | One mobile camera, local recognition, guided position quality, one-viewpoint occlusion limitation                                                                            | A low-friction learned mobile route is commercially plausible, but it is not physically immune to occlusion.                  |
| Single-phone with optional second phone | Dartsmind                               | Its store listings describe on-device AI and an optional dual-device / dual-camera mode for better accuracy                                                                  | A mobile product can graduate from one view to two without changing game UX. Treat its accuracy marketing as unverified.      |
| Dual-camera board accessory             | GRAN EYE                                | Two compact cameras and AI scoring are publicly marketed                                                                                                                     | A fixed second viewpoint is a meaningful product tier, but two views still leave coverage and ambiguity design work.          |
| Fixed multi-camera system               | Target OMNI, Winmau Autodarts X, Scolia | OMNI and Autodarts X publicly advertise four HD cameras and integrated/shadow-controlled lighting; Scolia describes cameras plus a processing unit and automatic calibration | Multi-view geometry plus controlled lighting is the commercial high-reliability pattern for steel-tip darts.                  |
| Academic learned one-camera benchmark   | DeepDarts                               | Learned dart-tip and board-calibration keypoints are detected from an image, then mapped to board coordinates                                                                | A semantic keypoint pipeline is the right baseline class; the published data is too narrow to promise production reliability. |
| Academic multi-camera benchmark         | Domazet, _ICGA Journal_                 | Five calibrated low-cost cameras, real-time processing, reported 99.63% experimental detection and under-600 ms response                                                     | Redundancy and geometry can be highly effective, but a paper result is not a transferable product claim.                      |

### Public source limits

- Target advertises 99.7% accuracy for OMNI. That is its own product claim, so Darts 180 must not quote it as an independently established result.
- Scolia, GRAN EYE, Winmau, Autodarts, Dartsmind, and DartsOn describe product behavior, not architecture, training data, error distribution, or reproducible benchmark methodology.
- DeepDarts reported 94.7% correct total-score accuracy on its much larger face-on smartphone data set and 84.0% on a small, varied-angle set. That gap is exactly why “works at any angle” must be measured under realistic held-out conditions, not assumed from a demo.

## 4. The central engineering distinction: event versus measurement

The replacement design must treat three problems separately.

| Problem                                                                    | Valid signals                                                                                                          | Invalid shortcut                                                      |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Event detection** — did something that merits a capture occur?           | low-rate image change, local audio, piezo/contact microphone, rig accelerometer, optional light curtain                | assuming an RGB difference tells where a dart tip landed              |
| **Localization** — where does the physical dart intersect the board plane? | learned dart-tip/keypoint inference, board pose, high-resolution post-settle images, multi-view rays and triangulation | using the centroid or arbitrary endpoint of a changed blob as the tip |
| **Decision** — can the system safely record this score?                    | calibrated uncertainty, score/wire margin, agreement among frames/views, turn state, explicit correction               | a heuristic rank called “confidence”                                  |

This also answers the radar and motion-tracking question:

- **Doppler radar is not a scoring sensor.** A radar gun measures radial (line-of-sight) velocity, not the two-dimensional intersection of a stationary dart with the board. It could at most become an expensive event/timing cue.
- **In-flight high-speed tracking is not the primary product requirement.** The score is determined after the dart lands. A short high-quality post-impact burst is more practical and less sensitive to motion blur than attempting to reconstruct every flight path from a consumer phone.
- **Audio, piezo, IMU, or impact sensing can be valuable—but only as a trigger or corroborating event signal.** A single acoustic/vibration sensor does not reveal a reliable 2D score coordinate on a real sisal board. It must never override visual geometry.
- **Frame differences and optical flow remain useful.** They should wake a capture pipeline, detect an empty/occupied board transition, and associate a new dart with a turn; they should not decide the score.

## 5. Automatic geometry and lighting adaptation—not a fixed-mount ritual

The former near-centreline preference and a fixed-distance prescription are not acceptable normal-flow
requirements. They may be useful **starting hints** and research configurations, but Darts 180 must infer
and continually refresh its board/camera relationship automatically for a broad range of practical phone
locations.

### What “detect every section” requires technically

A standard board has fixed physical geometry, but repeated red/green colours do not identify which radial
sector is 20, 1, 5, and so on. The new system therefore must estimate a complete board pose and
orientation from image evidence, for example the board contour/wires, number-ring/known layout cues, and
learned board landmarks. Once orientation is verified, canonical geometry supplies all sections, rings,
and score boundaries. This is automatic internal calibration; it is **not** a player calibration flow.

### What automatic adaptation does

For each session and after material device/light changes, the system should:

1. detect and track the board in the live preview;
2. estimate scale, perspective, lens distortion, orientation, sharpness, glare, exposure, dynamic range,
   and visible board fraction;
3. choose the appropriate crop/resolution, exposure/focus strategy, image normalisation, model branch,
   and post-impact burst timing;
4. rectify/map visual estimates into canonical board coordinates while retaining uncertainty; and
5. give only a simple automatic readiness result or, if needed, an actionable instruction such as
   _move back slightly_, _more light_, or _shift a little sideways_.

A stable mount about one metre from the board and slightly off-axis is an evidence-backed **helpful default**
for a one-phone steel-tip view. It is not a hard configuration rule. The quality model should accept a
near-centreline, closer, farther, portrait, landscape, or other practical view whenever enough visible
information supports a safe result. It should only reject or route to a second view when the physics or
measured uncertainty requires it.

Autodarts’ off-axis recommendation is useful evidence: a perfectly frontal view can hide the very depth cue
needed to distinguish a dart's entry point from its barrel/flight. That is why the product must continuously
assess observability rather than rely on either a mandatory centreline or a mandatory side angle.

## 6. Target architecture

```text
                 ┌──────────────────────────────────────────────┐
                 │ Darts 180 game / rules / correction / sync   │
                 │                 (retain)                     │
                 └───────────────────▲──────────────────────────┘
                                     │ scored proposal + provenance
┌────────────────────────────────────┴────────────────────────────────────┐
│                 Perception decision layer (new, shared contract)         │
│  event association → board pose → dart-tip inference → geometry →       │
│  uncertainty calibration → auto-record / held review / abstain           │
└───────────────▲─────────────────────────▲────────────────────────────────┘
                │                         │
      ┌─────────┴─────────┐     ┌─────────┴────────────────┐
      │ Browser-local     │     │ Fixed hardware tier       │
      │ web capture       │     │ 3–4 cameras + lighting    │
      └─────────▲─────────┘     └─────────▲────────────────┘
                │                         │
  low-rate quality/event frames     synchronized post-impact views
  high-quality post-settle burst    optional piezo trigger
```

### 6.1 Tier A — web-first learned single-camera system

This is the convenience tier and the first delivery target. It must automatically adapt across broad
real-world camera pose, scale, brightness, and board variation; it is not a promise that one physical
viewpoint can see through a fully occluding dart.

**Capture:**

- Build the browser path around `getUserMedia`, high-resolution transferable `ImageBitmap` frames, and a
  Worker-owned ONNX Runtime Web session. Continuously observe lightweight quality/event cues at a throttled
  rate; after a likely impact, acquire a short high-resolution post-settle burst.
- Use available browser focus/exposure/white-balance/device metadata cautiously, and let the learned quality
  model adapt crop/resolution/timing to measured conditions. Do not run an unnecessarily large model
  continuously, because it wastes battery and can thermal-throttle the phone.
- Keep a cheap physical phone stand as an accessory because physical stability is a system requirement, not a
  UX inconvenience. Native AVFoundation/CameraX modules come **after** browser evidence and preserve the
  same capture/model semantic contracts.

**Learned perception:**

- Train a multitask model, or tightly coupled models, for complete board instance/pose and orientation,
  rings/sector landmarks, dart-tip keypoints, visible dart/flight masks or lines, occlusion state, capture
  quality, and photometric condition. The model must learn from real variation rather than assuming a
  red/green colour threshold or a level 20-up board.
- Map predicted tips to board coordinates through an automatically estimated camera/board pose and
  lens-distortion model. The game rules package remains the authoritative conversion from board coordinate
  to the exact section/ring/score.
- Fuse multiple sharp post-settle frames. Temporal state identifies “new dart” and prevents duplicate recording; it does not replace semantic detection.
- Estimate uncertainty in millimetres and in score categories. Scores near a wire, unstable tips, low-quality frames, conflicting frame estimates, and suspected occlusion go to a fast correction flow—not an automatic score.

**Deployment:**

- Make ONNX Runtime Web the initial browser artifact/runtime target, with WebGPU preferred when available and single-threaded WASM fallback. Keep the artifact/output contract portable to Core ML/Vision on iOS and LiteRT or ONNX Runtime Mobile on Android.
- The existing Expo/mobile shell is a useful later product foundation. The web runtime is the first production auto-score reference implementation; it needs Worker capability admission, a versioned local model artifact, and browser performance evidence before it may claim automatic scoring. The legacy Camera Play heuristic is removed from the shipped route and remains only as a historical baseline.
- The normal product flow remains one tap to start a session after the automatic readiness gate. No normal-flow image leaves the device.

### 6.2 Tier B — optional impact trigger

A contact microphone/piezo on a board surround or a safely mounted rig sensor can:

- wake the high-resolution capture burst promptly;
- reduce continuous compute and heat;
- assist bounce-out / missed-board event handling when paired with vision; and
- improve event ordering during a three-dart turn.

It cannot determine the score coordinate by itself. Trigger thresholds must be learned/tested across boards, rooms, surrounds, dart weights, and incidental knocks. The microphone must be optional, visibly indicated, processed locally, and discarded immediately unless the user gives specific research consent.

### 6.3 Tier C — fixed multi-camera hardware for high-confidence steel-tip

For competitive use, dense clustering, frequent play, high-value statistics, and reliable handling of a dart hidden from one view, make the target product a fixed rig with **four protected cameras**, diffuse 360-degree lighting, and local compute. Three calibrated views are a credible minimum research configuration; four gives better fault/occlusion redundancy and matches the topology publicly marketed by current leading hardware.

Core capabilities:

- rigid camera locations and factory/installation calibration;
- automatic board identification and pose refresh at session start, with no player point selection;
- per-camera lens distortion correction and extrinsic calibration;
- multi-view dart-line/tip estimates intersected with the board plane, with robust outlier rejection;
- synchronized or precisely timestamped post-impact frames;
- controlled, high-CRI, flicker-safe diffuse illumination;
- protection against errant darts, safe mounting, and no need to change the player’s darts or board; and
- local inference with encrypted, opt-in diagnostic upload only.

Multi-camera calibration and triangulation are established computer-vision primitives. They do not eliminate the need for learned detection, quality evaluation, drift checks, and correction UX.

### 6.4 Soft-tip versus steel-tip

The player-facing setup must not ask which point type is being used. The perception system should infer or classify the board/dart context internally where needed.

- **Steel-tip bristle boards** are the harder visual case and define this architecture.
- **Electronic soft-tip boards** may have a native electrical scoring path if an integration is available, but Darts 180 must not require one.
- The unified game flow receives a `ScoringProposal` with source/provenance; rules and correction behave identically across sources.

## 7. Data, model, and evaluation program

No model can be declared production-ready from screenshots, synthetic unit tests, or vendor marketing. Data and evaluation are first-class product work.

### 7.1 Data collection

Build a separate, consent-first capture application before building the production scorer. Collect synchronized event bundles rather than indiscriminate continuous video:

- empty-board reference and post-impact burst;
- raw device/camera metadata, device capability, capture resolution, and quality metrics;
- board make/condition, surround, mount geometry, lighting type, brightness/glare/background, phone
  orientation/lens/capture settings, and dart characteristics;
- true point type and true score independently labelled by two annotators or an auditable physical reference process;
- dart-tip coordinate, board pose landmarks, occlusion/clustering, bounce-out/miss, wire proximity, and ambiguity labels; and
- failure category: no event, missed dart, duplicate dart, wrong tip, wrong board pose, wrong ring/sector, wire ambiguity, or unsafe false positive.

Do not add private support screenshots, game footage, or user camera frames to a data set without separate explicit opt-in consent. Build deletion, retention, access logging, and export controls before recruiting beta testers.

The public DeepDarts data set can be used only after licence, provenance, patent, and dataset-fit review. It is useful for baselines and pretraining research, not evidence that our production model is valid.

### 7.2 Split design

Prevent leakage by holding out entire combinations of household/site, physical board, board condition, device model, player/dart set, and lighting condition. A random image split is insufficient because neighbouring frames of the same dartboard turn are nearly duplicates.

Report performance by:

- one, two, and three darts already in the board;
- wire-distance bands, especially doubles/trebles and bull;
- full practical angle, distance, board-pixel, portrait/landscape, blur, lens, illumination, glare,
  and exposure/white-balance bands;
- board manufacturers and colour/wire conditions;
- steel and soft tip;
- device tier and sustained thermal state;
- occluded versus unobstructed darts; and
- auto-score, held-review, and abstain outcomes separately.

### 7.3 Release gates

Before an automatic score is allowed, evaluate and publish internally:

1. **Per-dart recall** — a visible, eligible new dart is found.
2. **Exact score correctness** — ring and segment, not only turn total.
3. **Unsafe false-auto-score rate** — the most important metric; a miss or review is preferable to a wrong automatic score.
4. **Calibration quality** — error in board-plane millimetres and error by wire distance.
5. **Abstention/review rate** — high enough to be safe, low enough to be useful.
6. **Latency, heat, battery, offline reliability, and recovery behavior.**

Set production thresholds from a locked, independently held-out field set with confidence intervals—not from a desired marketing number. The auto-record policy should require calibrated conditional correctness and reject the exact cases where probability mass crosses a wire or two plausible scores compete.

## 8. Roadmap with evidence gates

This is deliberately staged so unlimited engineering effort is directed at evidence, not at endlessly tuning an unsuitable prototype.

### Stage 0 — stop the wrong iteration

- Freeze the present browser detector as an **experimental diagnostic baseline**.
- Do not relax thresholds, broaden masks, accept arbitrary endpoints, or lower the automatic safety gate to make a dashboard look better.
- Update product copy and readiness logic to remove near-centreline as the primary single-phone recommendation.
- Preserve manual score entry and correction so field users are not blocked while the new system is built.

**Exit evidence:** a written baseline report that reproduces the current failure taxonomy on controlled captures; no claim of automatic scoring reliability.

### Stage 1 — web capture and lab infrastructure

- Build the browser `getUserMedia`/Worker capture harness, local derived diagnostic events, consent screens,
  annotation tools, and a field-data registry.
- Procure representative phones, boards, darts, mounts, lighting configurations, and a four-camera geometry test rig.
- Establish ground-truth procedure, annotation agreement measurement, data governance, and a privacy review.

**Exit evidence:** a labelled, diverse, leak-resistant development set and a locked field test set; every record has a trustworthy source and consent state.

### Stage 2 — web-first learned single-camera feasibility

- Implement/export browser-compatible board-pose + tip/keypoint/quality baselines and high-resolution post-settle frame selection.
- Compare trained static-image localization with the old difference pipeline only as a historical baseline.
- Build calibrated uncertainty and held-review policies from validation data; exercise WebGPU/WASM behavior on direct HTTPS mobile browsers.
- Test the off-axis placement envelope and prove which browser/device/configuration slices should be admitted or rejected.

**Exit evidence:** a per-slice browser report showing whether the single-phone tier meets the defined safety/usefulness target. If it does not, market it as assisted scoring or direct users to the multi-camera tier; do not hide the limitation.

### Stage 3 — browser product release and native reuse

- Lock the versioned `ScoringProposal` / `DetectionDecision` contract across browser capture, rules, API, telemetry, correction UX, and later native adapters.
- Implement offline-first browser inference, deterministic replay from consented test bundles, model-version provenance, and a one-tap correction experience.
- Deploy only to the device/geometry quality envelope demonstrated in Stage 2 through the existing Vercel project and URL.
- Start native AVFoundation/CameraX adapters as faithful consumers of the validated browser model/data/geometry/policy program, not as a second unvalidated scorer.

**Exit evidence:** browser beta telemetry independently confirms lab findings, including no regression under sustained heat and changing lighting; native reuse scope is approved from that evidence.

### Stage 4 — multi-camera rig

- Design the four-camera/light enclosure and local compute platform after formal freedom-to-operate review.
- Implement automatic calibration, multi-view learned tip/ray inference, robust board-plane intersection, sensor-trigger fusion, diagnostics, and field-replaceable components.
- Validate bounce-outs, dense clusters, board variation, camera faults, and lighting failures.

**Exit evidence:** rig performance achieves the high-confidence product target on unseen homes/boards and maintains safe abstention when a view/camera fails.

## 9. Privacy, safety, security, and intellectual property

### Privacy and safety

- Default: images and audio remain on the device and are discarded after inference.
- Separate opt-in: research capture, explicit purpose, minimised burst duration, deletion schedule, participant withdrawal, and secure access control.
- Store derived diagnostics by default (model version, quality metrics, anonymised error code), not frames.
- Never silently activate microphone capture. A piezo/contact sensor is preferable to room-audio capture where practical.
- Do not show or transmit visual proof frames in online matches without clear player consent and product-specific policy.
- Hardware must protect cameras and users from errant steel-tip darts; lighting and power design require electrical/safety testing.

### Freedom to operate

This is not legal advice. A preliminary search found active/potentially relevant patent families covering multi-camera dartboard scoring, automatic calibration, frame/background comparison, sensor-triggered captures, and single-camera learned board/tip localization. For example, Google Patents reports US 10,443,987 as active with an adjusted 2038 expiration, and the DeepDarts inventors’ US 2022/0341716 application describes single-camera learned calibration and tip localization.

Before commercial implementation, counsel must commission a jurisdiction-specific freedom-to-operate analysis covering method claims, camera placement, triggering, lighting, calibration, software distribution, and hardware enclosure. Engineers should document independent design choices and not copy competitor code, models, fixtures, or proprietary user-interface behavior.

## 10. Research sources consulted on 2026-09-08

| Source                                                                                                                                                                                                    | Why it matters                                                                                                                                 | Limits                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [Autodarts Lens official guide](https://docs.autodarts.com/getting-started/detection/lens/)                                                                                                               | Documents on-device recognition, NPU/Neural Engine guidance, one-camera limitation, stability/lighting, and deliberately off-axis positioning. | Does not disclose model architecture, training, score accuracy, or sensors.            |
| [Winmau Autodarts X official hardware page](https://winmau.com/en-us/pages/winmau-autodarts-x-hardware)                                                                                                   | Documents four HD cameras and 360-degree diffused lighting.                                                                                    | Marketing material; no reproducible benchmark or algorithm disclosure.                 |
| [Target OMNI official page](https://www.targetdarts.com/us/omni)                                                                                                                                          | Documents four HD cameras, shadow-free lighting, bounce-out claim, and 99.7% vendor claim.                                                     | Vendor claim, not independently validated here.                                        |
| [Scolia FAQ](https://scoliadarts.com/faq/)                                                                                                                                                                | Describes a camera set plus processing unit and automatic score calculation/calibration behavior.                                              | Does not disclose model/geometry implementation or independent accuracy study.         |
| [GRAN EYE official page](https://www.gran-darts.com/graneye)                                                                                                                                              | Documents two compact cameras and AI scoring/close-up view.                                                                                    | Marketing material; no methodology or independent benchmark.                           |
| [Dartsmind App Store listing](https://apps.apple.com/us/app/dartsmind/id1018594473) and [DartsOn’s own guide](https://dartson.app/camera-auto-scoring/)                                                   | Current examples of apps publicly claiming on-device learned scoring and optional multi-device camera support.                                 | Self-descriptions; not architecture disclosure or independent performance evidence.    |
| [DeepDarts CVPR Workshop paper](https://openaccess.thecvf.com/content/CVPR2021W/CVSports/papers/McNally_DeepDarts_Modeling_Keypoints_as_Objects_for_Automatic_Scorekeeping_in_Darts_CVPRW_2021_paper.pdf) | Learned dart and calibration keypoints, image-to-board homography, public benchmark, and the 94.7% / 84.0% results.                            | 2021 research data/conditions; not a production or safety validation.                  |
| [Domazet, real-time optical dart detection](https://journals.sagepub.com/doi/10.3233/ICG-230214)                                                                                                          | Five-camera experimental design and reported 99.63% detection in under 600 ms.                                                                 | Abstract-level evidence; different hardware, calibration, and experimental conditions. |
| [OpenCV calibration and 3D reconstruction documentation](https://docs.opencv.org/4.13.0/d9/d0c/group__calib3d.html)                                                                                       | Standard camera-calibration, pose, and triangulation primitives.                                                                               | A toolkit, not an end-to-end dart detector.                                            |
| [Apple high-resolution capture guidance](https://developer.apple.com/videos/play/wwdc2026/304/) and [Android CameraX analysis guidance](https://developer.android.com/media/camera/camerax/analyze)       | Native paths for high-quality capture and efficient on-device frame processing.                                                                | Device-specific capability/performance must be tested.                                 |
| [Google AI Edge / LiteRT](https://ai.google.dev/edge) and [ONNX Runtime Mobile](https://onnxruntime.ai/docs/get-started/with-mobile.html)                                                                 | Cross-platform on-device inference runtime options.                                                                                            | Runtime choice does not solve data, model, geometry, or evaluation.                    |
| [NOAA Doppler velocity explainer](https://www.noaa.gov/jetstream/velocity)                                                                                                                                | Confirms Doppler measures radial velocity, supporting the conclusion that radar is not a 2D board scorer.                                      | General radar education, not dart-specific testing.                                    |
| [US 10,443,987 / related dartboard scoring patent](https://patents.google.com/patent/US10443987B2/en) and [US 2022/0341716](https://patents.justia.com/patent/20220341716)                                | Prior-art/FTO warning around multi-camera, trigger, calibration, and single-camera learned approaches.                                         | Patent search is not an FTO legal opinion.                                             |

## 11. Implementation handoff

The initial handoff has now been completed from verified `origin/main` on
`feat/web-first-learned-autoscoring`: shared perception contracts, an unavailable fail-closed manifest,
a browser Worker runtime, learned-pose/tip/scoring orchestration, normal-route replacement, and Worker/WASM
CSP tests exist. Before a model or automatic score is introduced:

1. obtain fresh, short-lived repository-scoped authorization only when delivery requires it;
2. preserve the existing Vercel production project/URL and deploy from `apps/web` after review;
3. retain this document and the failed-browser-baseline history without re-enabling that detector;
4. complete consent/provenance/FTO and locked-field-evaluation gates; and
5. make the next scoring deliverable a lawful trained browser artifact plus evidence report—not another
   browser heuristic patch or an unvalidated native fork.

That sequence preserves useful product work while restarting the one subsystem that field evidence has shown is
not yet fit for purpose.
