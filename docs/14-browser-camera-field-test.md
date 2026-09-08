# Browser Camera Play — automatic board-find field-test guide

**Status:** implemented browser-local experimental player flow, September 2026

**Purpose:** test the simplest viable mounted-phone experience while native runtime and trained
vision models are still being built. A player starts the camera, lets the browser find the board’s
red/green scoring pattern, taps **Start Play** with an empty board, and receives local score
suggestions for settled darts.

> This is **not** a trained or proven production auto-scoring system. It is a fixed-mount,
> browser-local color-fit plus frame-difference heuristic. A score is a proposal: ordinary score
> correction remains available whenever the result does not match the board.

## Normal player flow — no calibration

The **CAMERA PLAY** workspace requests camera only and keeps camera frames in volatile browser
memory. The normal flow has no named-point selection, guide fitting, separate reference capture,
photo download, manual frame-analysis action, or visible-tip click.

1. **Start rear camera.** Mount the phone near the board centreline and tap **START REAR CAMERA**.
2. **Wait for Board Found.** Keep the entire board and double ring visible. The browser looks for the
   standard board’s repeated red/green double and treble scoring bands—not merely the outermost
   colored object—then estimates the board shape and draws a guide.
3. **Start Play.** With no darts in the board and people clear of the view, tap **START PLAY**. This
   stores the clear-board baseline in local memory and arms live scoring; the player has not
   calibrated anything.
4. **Throw naturally.** Throw one dart, step clear, and wait for it to settle. The detector compares
   the new frame with the local baseline, chooses its best internal endpoint/candidate, and adds a
   score suggestion. The frame containing that dart becomes the local reference for the next dart.
5. **Confirm or correct.** Confirm the current darts/turn directly in Camera Play. Tap **REVIEW OR
   CORRECT SCORES** only when a score needs correction.
6. **Next turn.** Remove all darts and tap **BOARD CLEAR · START NEXT TURN**. The app captures the
   next volatile clear-board baseline without asking the player to find or fit the board again.

The player is never asked whether darts are steel-tip or soft-tip, and is never asked to click a
physical point. That interaction parity does **not** prove that the current heuristic can identify
every endpoint under every angle, flight, shadow, board surface, or occlusion.

## What “automatic” means here

The browser’s automatic board fit is deliberately inspectable and conservative:

1. samples the local camera frame for conventional saturated red and green board accents;
2. finds the repeated, color-balanced, alternating-color outer-double and inner-treble band pair, so
   a red surround, printed board branding, wall logo, or one colored object is not automatically
   treated as the board;
3. cross-checks the broad fit against the compact two-color bull, then requires two matching full
   guide shapes before accepting a board;
4. creates the same internal image-to-canonical-board mapping used by deterministic scoring; and
5. retains an in-memory clear-board frame only when the player taps **START PLAY**.

The color pattern can estimate **where** a conventional board is, but colors alone cannot uniquely
read the number ring or resolve every possible board rotation: alternating red/green bands repeat
around a board. For this field test, automatic mode assumes the physical **20 is upright at the top
of the camera image**. The visible `20 ↑` guide makes that assumption inspectable. Mount the phone
level with a normally oriented board. A future trained board/number-orientation model must replace
this assumption before claiming arbitrary roll/board rotation support. The player-facing manual board
now follows the conventional dark-S20/red-accent and light-S1/S5/green-accent palette. This fixes an
old visual mismatch, but black/white beds are not yet a number-reading model and cannot independently
prove that a particular physical wedge is 20.

After board finding, each dart is still a browser-local visual-change heuristic. It compensates a
bounded global exposure/white-balance shift and a few pixels of board-face translation from impact or
mount vibration; after it accepts an aligned dart, it carries that small offset into the in-memory
guide and next baseline. It still rejects broad motion, retains elongated side-view shafts and
compact near-centreline flight/occlusion changes, projects them through canonical geometry, and waits
for a nearby same-zone candidate in two frames (with one-frame grace) before recording an editable
suggestion. A protruding flight/shaft endpoint beyond the double wire is held rather than recorded as
an automatic `MISS`; compact-flight locations are intentionally low-confidence and reviewable. This
is not a learned tip detector or a calibrated score probability.

## Required first-test envelope

Start inside this envelope. A result outside it is evidence to investigate, not a reason to call the
feature accurate or broken.

| Item     | Initial field-test requirement                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| Board    | Conventional red/green standard board, normal 20-at-top orientation, complete double ring visible             |
| Device   | Phone/tablet rear camera in a fixed, safe mount outside the throwing path                                     |
| Distance | Usually about 0.7–1.2 m; automatic fit’s compressed/short axis must report at least 480 px before play starts |
| Position | As close to the board centreline as practical; mount the camera level with the board’s 20-up orientation      |
| Light    | Even diffuse room light; avoid glare that desaturates red/green bands or crosses wires                        |
| Movement | Do not move the mount; step out of the view after every throw                                                 |
| Darts    | One new dart at a time; wait for the dart/flight to stop moving before expecting a score                      |
| Decision | Treat each local suggestion as correctable, especially close to a wire                                        |

The browser can use a modestly elliptical color fit, but cannot make a tiny, blurred, heavily
occluded, non-standard-color, or extreme side view safe for one-camera entry-point estimation.

## Deploy and test on a physical device

1. The browser field test and Vercel app-root preparation are merged in
   [PR #2](https://github.com/nick-kuhle/darts-180/pull/2),
   [PR #3](https://github.com/nick-kuhle/darts-180/pull/3),
   [PR #5](https://github.com/nick-kuhle/darts-180/pull/5), and the initial browser-camera
   remediation [PR #6](https://github.com/nick-kuhle/darts-180/pull/6). Use the Vercel Preview for
   the follow-up Camera Play reliability work in
   [PR #7](https://github.com/nick-kuhle/darts-180/pull/7).
2. In Vercel, select **`apps/web`**—not `services` or `ml`—as Root Directory and enable
   **Include files outside the Root Directory**. `apps/web/vercel.json` runs the monorepo-root install
   and web workspace build; no environment variables are required. See the
   [Vercel guide](12-web-demo-and-vercel.md).
3. Open the resulting **top-level HTTPS** deployment directly in Safari or Chrome on the mounted
   device. Camera permission normally cannot work on plain HTTP, in the Arena preview iframe, or in
   an in-app browser/WebView.
4. If no permission prompt appears, use the browser lock/camera site controls to set Camera to
   **Allow**, reload, and retry.

Do not invite broad testers, collect raw media, or claim camera accuracy based only on this browser
heuristic. Test direct top-level HTTPS deployments on actual iOS and Android hardware.

## Expected failure behavior and recovery

| In-app state                               | Meaning                                                                      | Safe response                                                                                                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Embedded-preview camera message            | The page is in an iframe that cannot request user media                      | Open the direct `https://…vercel.app` URL in Safari/Chrome, not an Arena/in-app preview                                                                       |
| Camera permission blocked                  | Browser/device denied or remembered a denial                                 | In the direct HTTPS tab, set Camera to Allow from lock/camera controls, reload, retry                                                                         |
| Waiting for a complete frame               | Browser camera has not delivered drawable video data                         | Wait briefly after permission; if a live preview is visible but this persists, update/reload to the fixed Camera Play build and report device/browser details |
| No red/green board found                   | Color signal is weak, cropped, non-standard, or obscured                     | Show complete board, use diffuse light, reduce glare, move closer, and keep physical 20 upright                                                               |
| Board too small                            | Not enough board pixels for the first test                                   | Move closer or use optical resolution; automatic finding resumes without player calibration                                                                   |
| Board needs work                           | Automatic color ellipse is too oblique, soft, or malformed                   | Center/level the mount, improve light/focus, then tap **FIND BOARD AGAIN**                                                                                    |
| Broad movement held                        | A hand/body/shadow or movement beyond the bounded alignment changed too much | Step out, stabilize the mount/light, and let the board settle; retain the displayed alignment offset in a failure report                                      |
| No score appears                           | Change was not yet a stable isolated dart shape                              | Wait, check framing, then use ordinary score correction if the dart is clear but unproposed                                                                   |
| Wrong/near-wire score                      | Heuristic endpoint or geometry is ambiguous                                  | Tap **REVIEW OR CORRECT SCORES**, correct the DartCard, then confirm                                                                                          |
| Camera framing/resolution changed          | Existing baseline/mapping is no longer trustworthy                           | Tap **FIND BOARD AGAIN**, wait for Board Found, then Start Play with an empty board                                                                           |
| Unusual board colors / extreme perspective | Color heuristic cannot establish a usable automatic shape                    | Open **Optional recovery & advanced diagnostics**; do not make it the normal player flow                                                                      |
| Bounce-out/stacked/hidden dart             | One-camera visual difference is insufficiently isolated                      | Record/correct manually; retain it as field-test failure evidence                                                                                             |

## Report a real failure usefully

A real-board failure is not a cue to keep moving the mount indefinitely. In the Camera Play build,
the **AUTO BOARD FIND** panel reports board pixels, outer-band sectors, red/green sample counts,
alternating-color strength, double/treble band agreement, and its color-pattern cue. After **START
PLAY**, the **LOCAL DETECTOR** panel reports whether it saw `no change`, `ambiguous change`, `camera
moved or hand present`, or a candidate, plus changed pixels, frame fraction, threshold, bounded
alignment offset, and shape count.

For a reproducible defect report, attach or securely retain (with the tester’s consent) an empty-board
screenshot that includes the visible guide and auto-find panel; a same-mount still with one dart;
the detector panel after the dart settles; device/browser; board model/colors/surround; and the known
score. Do not treat a crystal-clear-looking view as sufficient evidence that the heuristic’s color
or temporal assumptions succeeded.

## Controlled field-test record

Record independent ground truth before looking at the suggestion. For every dart, retain the test
conditions and both the proposed and corrected score.

| Field                | Example                                                                              |
| -------------------- | ------------------------------------------------------------------------------------ |
| Test ID / date       | `CM-001 / 2026-09-07`                                                                |
| Device/browser       | `iPhone / Safari` or `Pixel / Chrome`                                                |
| Board/mount          | board model, color scheme, distance, centreline offset, mount type                   |
| Light                | diffuse, side shadow, glare, low light                                               |
| Point style          | soft-tip or steel-tip, recorded for later analysis—not setup branching               |
| Ground truth         | `T20`, confirmed by player/referee                                                   |
| Detector state       | board found/not-found, movement hold, automatic suggestion, corrected score          |
| Proposed → corrected | `S20 → T20`                                                                          |
| Wire margin          | displayed mm cue, if proposed                                                        |
| Notes                | camera roll, board rotation, bounce-out, stacked dart, flight shadow, movement, etc. |

Include clean singles, trebles, doubles, both bulls, misses, near-wire hits, both point styles, and
deliberate difficult cases. Preserve difficult/ambiguous cases rather than combining them into an
optimistic accuracy number.

## Optional recovery and advanced-only tooling

The normal path never asks a player to calibrate. If automatic color finding cannot recover, a
collapsed **Optional visual guide** exposes the previous drag/tap, pinch, twist, and edge-handle fit.
It is a recovery tool for unusual conditions, not an onboarding requirement.

The separate **Advanced field test** exposes named double-bed anchors, explicit reference/frame
analysis, endpoint inspection, manual visible-tip recovery, and a no-media debug record for
engineering diagnosis only. Capture Lab and Annotation Lab remain separate consent-sensitive data
tools; their downloads/manual labels are not part of Camera Play and do not authorize raw-media
collection or model-training use.

## Known limits and next work

- Browser processing cannot be physically validated in this development sandbox. Test a direct
  top-level HTTPS deployment on real iOS and Android hardware before claiming it works for a mount.
- This implementation has synthetic/unit coverage for color-board fitting, fit stability,
  homography/guide geometry, optional gesture recovery, quality gates, and automatic-candidate
  ranking. It has no real-world performance measurement.
- A production native implementation still needs a trained board detector with number/orientation
  recognition, measured pose tracking, temporal/dart tracking, calibrated entry-point uncertainty,
  stacked-dart handling, real-device evaluation, and a correction-first product contract.
