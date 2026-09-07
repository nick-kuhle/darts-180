# Browser camera scorer — real-board field-test guide

**Status:** implemented browser-local experimental scorer, September 2026

**Purpose:** make a safe, deployable first test possible on a real steel-tip dartboard while the
native runtime and trained vision models are still being built.

> This feature is **not** a trained auto-scoring model and must not be marketed as one. It uses a
> manually calibrated board plane plus a clear-board / settled-frame difference heuristic to find
> dart-shaped changes. Every result remains player-reviewable and editable in the existing DartCard
> flow.

## What is in the deployed web app

The **Camera Score** workspace runs entirely in the browser and does not upload raw camera pixels,
video, audio, identifiers, or debug images. It provides:

1. rear-camera preference over HTTPS;
2. manual four-point calibration using the centres of D20, D6, D3, and D11 double beds;
3. transparent board-size, screen-space perspective, and focus-detail setup gates;
4. a clear-board frame held only in browser memory;
5. one-dart-at-a-time temporal difference and elongated-shape detection;
6. one or more visible endpoint candidates mapped through the shared canonical scoring geometry;
7. a manual visible-tip picker when a detector endpoint is wrong or unavailable;
8. deterministic zone decoding, wire-margin display, and handoff into the existing 501/Cricket
   DartCard review flow; and
9. a downloadable **no-media** JSON debug record containing calibration and detector metadata only.

The detector purposefully cannot silently commit a score. Detection candidates are an aid to finding
a visible tip; the player selects or corrects the point before a game event is confirmed.

## Required field-test envelope

Start inside this envelope. Do not use a bad test to declare a camera feature broken or accurate.

| Item     | Initial field-test requirement                                                            |
| -------- | ----------------------------------------------------------------------------------------- |
| Board    | Standard steel-tip board, normal 20-at-top orientation, fully visible                     |
| Camera   | Phone/tablet rear camera in a fixed mount outside the throwing path                       |
| Distance | Approximately 0.7–1.2 m from board, adjusted until quality reports ≥480 px board diameter |
| Position | Near board centreline and slightly above bull; start at 10–25° off axis                   |
| Light    | Even, diffuse room light; avoid a bright reflection crossing the double/treble wires      |
| Movement | Camera/mount fixed; nobody’s hand, body, or shadow in the analysis frame                  |
| Darts    | One dart at a time; wait for it to stop moving before analysis                            |
| Decision | Treat every proposal as `CHECK`; visually confirm or use the manual tip picker            |

A configuration outside the gate is not necessarily impossible, but it is not the first supported
measurement envelope. Do not force the setup gate merely to get a score.

## Deploy for a device test

1. Review/merge the current implementation pull request and ensure GitHub Actions is green.
2. Import the private repository into Vercel as described in
   [the Vercel guide](12-web-demo-and-vercel.md). The static web app needs no environment variables.
3. Open the **HTTPS** Vercel deployment on the mounted device. Browser camera access will normally be
   unavailable on plain HTTP.
4. Grant **camera only** permission. The app requests no audio and sends no camera media to a server.
5. Select **CAMERA SCORE** in the upper workspace navigation.

Use a Vercel preview deployment for initial work. Do not make a public claim, invite broad testers,
or enable raw-media collection based only on this heuristic field test.

## One controlled visit

### 1. Frame and calibrate

1. Mount the device safely, keeping the full board and numbered double ring in view.
2. Tap **Start device camera** and wait for focus/exposure to settle.
3. Tap **Start 4-point calibration**.
4. Click the **centre** of each named double bed in this order:
   - D20 at 12 o’clock;
   - D6 at 3 o’clock;
   - D3 at 6 o’clock;
   - D11 at 9 o’clock.
5. Read the quality panel. Correct any blocking issue rather than continuing with a marginal frame.

The required points are actual scoring-bed centres—not number-ring locations, outer-board edges, or
wire crossings. Four clicks establish an image-to-board homography and thus preserve the standard
board geometry at an oblique view.

### 2. Establish the clear-board reference

1. Remove **all** darts.
2. Ensure hands and bodies are out of the frame and shadows are stable.
3. Tap **Capture clear-board reference**.

That reference stays in volatile browser memory only. Changing zoom, rotating the device, moving the
mount, or a browser resolution change means the reference is no longer valid: reset/recalibrate and
capture a new one.

### 3. Score each dart conservatively

1. Throw one dart.
2. Step out of the image and wait for shaft motion to stop.
3. Choose **Analyze settled frame**, or choose **Arm live watch** before throwing.
4. If candidate markers appear, select the marker that is visibly at the **entry tip**. The two line
   endpoints are intentionally offered separately when the browser cannot infer shaft direction.
5. If no marker is correct, tap **Pick visible tip manually**, then click the actual visible tip.
6. Verify zone, canonical board point, and wire margin. Near-wire hits require special care.
7. Tap **Add … to visit**. The frame that contains this accepted dart becomes the local reference for
   the next dart, so the next analysis looks for one new change.
8. After up to three darts, choose **Open DartCard review** and confirm or correct the visit.

For a new visit, remove the darts and begin a fresh clear-board reference. If the board or camera
moves at any point, recalibrate rather than assuming the old mapping is still safe.

## What to record in the first test pass

Manually record the ground-truth score before looking at the app result. For each dart, record:

| Field                       | Example                                                          |
| --------------------------- | ---------------------------------------------------------------- |
| Test ID / date              | `CM-001 / 2026-09-07`                                            |
| Device/browser              | `iPhone / Safari` or `Pixel / Chrome`                            |
| Board / mount               | board model, distance, centreline offset, mount type             |
| Light                       | diffuse, side shadow, glare, low light                           |
| Ground truth                | `T20`, confirmed by player/referee                               |
| Detector state              | no change, hand/motion rejection, endpoint candidate, manual tip |
| Proposed / corrected result | `S20 → T20`                                                      |
| Wire margin                 | displayed mm value, if a point was selected                      |
| Notes                       | bounce-out, stacked dart, flight shadow, camera movement, etc.   |

Test clean singles, trebles, doubles, both bulls, near-wire hits, and deliberate misses separately.
Keep difficult/ambiguous results as failure evidence. Do not fold them into an optimistic accuracy
number.

The downloaded debug record can be attached to an engineering issue only after confirming it contains
no sensitive free-text notes. It deliberately contains no raw photo or video. Use the separate
[Capture Lab](runbooks/capture-lab.md) and approved consent workflow if raw media needs to enter a
data program.

## Expected failure behavior and recovery

| In-app state                   | Meaning                                            | Safe response                                                                            |
| ------------------------------ | -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Setup blocks board size        | Board is too small in the working frame            | Move closer / use more optical resolution, then recalibrate                              |
| Setup blocks perspective       | Cardinal anchors are overly compressed             | Move nearer centreline and keep full board visible                                       |
| Setup blocks focus             | Edge-detail heuristic is low                       | Let autofocus settle, improve diffuse lighting, clean lens, or move closer               |
| `no change`                    | No stable visual difference exceeded the threshold | Wait for settling; check that a dart is in view; use Manual tip if it is clearly visible |
| `camera moved or hand present` | Too much of the calibrated region changed          | Keep mount fixed, leave frame, wait, and analyze again                                   |
| `ambiguous change`             | Change did not resemble a safe isolated shaft      | Pick the visible tip manually; flag stacked/bounced darts as ambiguous                   |
| Candidate near a wire          | Geometry maps close to a scoring boundary          | Visually verify and correct via DartCard if needed                                       |
| Resolution changed             | Browser camera renegotiated dimensions             | Capture a new clear-board reference; recalibrate if framing changed                      |

A bounce-out, robin hood, hidden tip, or severe shaft/flight occlusion is not a situation to force
through the browser detector. Score it manually and preserve the failure category in test notes.

## Privacy and safety boundary

- Mount the device where it cannot be struck by a dart and never stand in the throw path to adjust it.
- Keep people, faces, children, screens, room identifiers, and conversation out of frame.
- Camera media stays browser-local for this field test; closing the tab or stopping the camera ends
  the session.
- Do not use `Download local debug record` as a substitute for privacy-reviewed data collection.
- Do not represent an endpoint selected by this heuristic as a verified vision-model prediction.

## Engineering next steps after the first field test

1. Review test records and classify false trigger, missed dart, wrong endpoint, calibration drift,
   wire-boundary, lighting, and occlusion failures.
2. Use approved consent/capture procedures to collect representative real frames and two-human labels.
3. Replace this browser heuristic with native pose/quality, temporal tracking, and trained entry-point
   models behind the same canonical scoring and DartCard interfaces.
4. Compare every candidate against held-out real-board data before expanding angle/lighting claims or
   enabling any auto-accept policy.

The high-level architecture and eventual quality gates remain in
[Detection engine](03-detection-engine.md) and [ML/data/evaluation](04-ml-data-and-evaluation.md).
