# Browser Camera Play — real-board field-test guide

**Status:** implemented browser-local experimental player flow, September 2026

**Purpose:** provide the least technical real-phone test while the native runtime and trained vision
models are still being built. A player fits an on-screen board guide once, taps **Calibrate & Play**,
and receives local score suggestions for settled darts.

> This is **not** a trained or proven production auto-scoring system. It is a fixed-mount,
> browser-local frame-difference heuristic. A score is a proposal: the player can open ordinary
> score correction whenever the result does not match the board.

## What a normal player sees

The **CAMERA PLAY** workspace runs in the browser. It requests camera only, keeps camera frames in
volatile browser memory, and has no raw-media upload, account, audio request, named-point setup,
photo download, manual analysis button, or visible-tip click in its normal flow.

1. **Start rear camera.** The app prefers the environment-facing camera.
2. **Fit the board guide.** Put the amber `20` handle on the outer double wire at the real 20. Drag
   the guide (or tap inside it to center it), use two fingers to pinch/resize and twist/orient it,
   and pull any of the other three outer-edge handles to match perspective and skew.
3. **Calibrate & Play.** With no darts in the board and people clear of the view, one action checks
   the fit, keeps a clear-board baseline in memory, locks the guide, and starts local watching.
4. **Throw naturally.** Throw one dart, step out of the image, and let it settle. The detector waits
   for two compatible frames, chooses its best internal endpoint/candidate, and adds one score
   suggestion. It then uses the frame containing that dart as the local reference for the next dart.
5. **Confirm or correct.** The three score cards remain reviewable. Tap **REVIEW OR CORRECT SCORES**
   only when a correction is needed, otherwise confirm the current darts/turn directly in Camera
   Play.
6. **Next turn.** Remove all darts and tap **BOARD CLEAR · START NEXT TURN**. This captures the next
   in-memory clear-board baseline without making the player refit the guide.

The same visible-change interaction is used for steel-tip and soft-tip darts. The player is never
asked which point type is in use. That does **not** prove that the current heuristic can identify
all physical dart endpoints under every angle, flight, shadow, or occlusion; score correction stays
part of the product safety path.

## How the guide maps the board

The four draggable handles mean **top / right / bottom / left on the outer double wire**. The top
handle is explicitly the 20 orientation marker. They map to four canonical board positions at a
170 mm radius. A homography maps camera pixels into the shared deterministic board geometry; its
inverse draws the double, treble, bull, and segment guide back onto the camera image.

This permits repositioning, scale, rotation, and a manually adjusted projective shape without asking
a normal player to understand `D20`, `D6`, `D3`, or `D11` calibration labels. It is a user-provided
board fit, not an automatic pose model. The fit coach still blocks a board that is too small,
obviously folded/crossed, too soft, or outside the initial off-axis envelope.

## Required first-test envelope

Start inside this envelope. A result outside it is evidence to investigate, not a reason to call the
feature accurate or broken.

| Item     | Initial field-test requirement                                                     |
| -------- | ---------------------------------------------------------------------------------- |
| Board    | Standard board, normal 20-at-top orientation, complete double ring visible         |
| Device   | Phone/tablet rear camera in a fixed, safe mount outside the throwing path          |
| Distance | Usually about 0.7–1.2 m; adjust until the fit check reports at least 480 px across |
| Position | As close to the board centreline as practical; begin around 10–25° off axis        |
| Light    | Even diffuse room light; avoid glare across wires and strong moving shadows        |
| Movement | Do not move the mount; step out of the view after every throw                      |
| Darts    | One new dart at a time; wait for shaft movement to stop before expecting a score   |
| Decision | Treat each local suggestion as reviewable, especially close to a wire              |

The guide can visually accommodate moderate perspective/skew. It cannot make a tiny, blurred,
heavily occluded, or extreme side view safe for one-camera entry-point estimation.

## Deploy and test on a physical device

1. The camera field test and Vercel app-root preparation are merged in
   [PR #2](https://github.com/nick-kuhle/darts-180/pull/2) and
   [PR #3](https://github.com/nick-kuhle/darts-180/pull/3). Import the private repository into
   Vercel and select **`apps/web`**—not `services` or `ml`—as Root Directory.
2. Turn on **Include files outside the Root Directory**. `apps/web/vercel.json` runs the monorepo-root
   install and web workspace build; no environment variables are required. See the
   [Vercel guide](12-web-demo-and-vercel.md).
3. Open the resulting **top-level HTTPS** deployment directly in Safari or Chrome on the mounted
   device. Camera permission normally cannot work on plain HTTP, in the Arena preview iframe, or in
   an in-app browser/WebView.
4. Choose **CAMERA PLAY** and follow the six-step normal flow above. If no permission prompt appears,
   use the browser lock/camera site controls to set Camera to **Allow**, reload, and retry.

Use a preview deployment for controlled UX work. Do not invite broad testers, collect raw media, or
claim camera accuracy based only on this browser heuristic.

## What the local detector actually does

For each new dart, the current implementation:

1. compares a settled camera frame to the previous in-memory board reference;
2. compensates a coarse whole-frame color offset, thresholds local visual change, and rejects large
   changes that resemble a hand or a moved camera;
3. keeps connected, elongated changed regions near the fitted board;
4. projects each candidate endpoint through the shared deterministic scoring geometry;
5. ranks endpoint candidates deterministically, preferring one-end-on-board evidence and then an
   apparent narrower-end/flight-width cue; and
6. requires the same selected candidate in two polls before it adds an ordinary `auto` DartCard.

The apparent-width cue is not a learned classifier, a calibrated probability, or a guarantee that
an entry point is visible. A flight can be hidden, a soft/steel point can be visually ambiguous, or
a stacked dart can make either endpoint misleading. The on-screen percentage is only a heuristic cue;
it must not be presented as accuracy or a production confidence score.

## Expected failure behavior and recovery

| In-app state                      | Meaning                                                        | Safe response                                                                               |
| --------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Embedded-preview camera message   | The page is in an iframe that cannot request user media        | Open the direct `https://…vercel.app` URL in Safari/Chrome, not an Arena/in-app preview     |
| Camera permission blocked         | Browser/device denied or remembered a denial                   | In the direct HTTPS tab, set Camera to Allow from lock/camera controls, reload, retry       |
| Fit says board too small          | Not enough board pixels for this first test                    | Move closer or use optical resolution; refit then calibrate                                 |
| Fit says too oblique/folded       | Guide proportions fall outside the starting envelope           | Move closer to centreline, refit four edge handles, keep all of the board visible           |
| Fit says soft                     | Focus-detail heuristic is low                                  | Let autofocus settle, clean lens, add diffuse light, or move closer                         |
| Broad movement held               | A hand/body/shadow or camera movement changed too much         | Step out, stabilize the mount/light, and let the board settle                               |
| No score appears                  | Change was not yet a stable isolated dart shape                | Wait, check framing, then use ordinary score correction if the dart is clear but unproposed |
| Wrong/near-wire score             | Heuristic endpoint or geometry is ambiguous                    | Tap **REVIEW OR CORRECT SCORES**, correct the DartCard, then confirm                        |
| Camera framing/resolution changed | Existing baseline and fitted mapping are no longer trustworthy | Tap **ADJUST SETUP**, refit, and Calibrate & Play with an empty board                       |
| Bounce-out/stacked/hidden dart    | One-camera visual difference is insufficiently isolated        | Record/correct manually; retain it as field-test failure evidence                           |

## Controlled field-test record

Record independent ground truth before looking at the suggestion. For every dart, retain the test
conditions and both the proposed and corrected score.

| Field                | Example                                                                |
| -------------------- | ---------------------------------------------------------------------- |
| Test ID / date       | `CM-001 / 2026-09-07`                                                  |
| Device/browser       | `iPhone / Safari` or `Pixel / Chrome`                                  |
| Board/mount          | board model, distance, centreline offset, mount type                   |
| Light                | diffuse, side shadow, glare, low light                                 |
| Point style          | soft-tip or steel-tip, recorded for later analysis—not setup branching |
| Ground truth         | `T20`, confirmed by player/referee                                     |
| Detector state       | no-change, movement hold, automatic suggestion, corrected score        |
| Proposed → corrected | `S20 → T20`                                                            |
| Wire margin          | displayed mm cue, if proposed                                          |
| Notes                | bounce-out, stacked dart, flight shadow, camera movement, etc.         |

Include clean singles, trebles, doubles, both bulls, misses, near-wire hits, both point styles, and
deliberate difficult cases. Preserve difficult/ambiguous cases rather than combining them into an
optimistic accuracy number.

## Advanced-only recovery tooling

**Advanced diagnostics & manual recovery** is intentionally collapsed inside Camera Play. It opens
the prior field-test laboratory with named double-bed anchors, explicit reference/frame-analysis
controls, endpoint inspection, manual visible-tip recovery, and a no-media debug record. It exists
for engineering diagnosis—not normal player onboarding—and must not become a required flow.

Capture Lab and Annotation Lab are separate, consent-sensitive data tools. Their downloads and manual
labels are not part of Camera Play and do not authorize raw-media collection or model-training use.

## Known limits and next work

- Browser processing cannot be physically validated in this development sandbox. Test a direct
  top-level HTTPS deployment on real iOS and Android hardware before claiming it works for a mount.
- This first implementation has synthetic/unit coverage for guide geometry, pinch/twist/handle math,
  homography round trips, quality gates, and automatic-candidate ranking; it has no real-world
  performance measurement.
- A production native implementation still needs measured pose tracking, temporal/dart tracking,
  calibrated entry-point uncertainty, stacked-dart handling, real-device evaluation, and a
  correction-first product contract.
