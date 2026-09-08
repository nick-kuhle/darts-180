# Browser Camera Play — automatic board-find field-test guide

**Status:** browser-local experimental player flow. PR #9 is merged; a post-PR #9 iPhone report
found a normal-flow setup loop. [PR #10](https://github.com/nick-kuhle/darts-180/pull/10) contains the follow-up and requires a new direct-device retest.
**Date:** September 2026.

**Purpose:** test the simplest viable mounted-phone experience while native runtime and trained
vision models are still being built. A player starts a camera, lets the browser find the board’s
red/green scoring pattern, taps **Start Play** with an empty board, and receives a local score only
when a settled dart has enough direct entry-direction evidence.

> This is **not** a trained or proven production auto-scoring system. It is a fixed-mount,
> browser-local color-fit plus frame-difference heuristic. Every result remains correctable.

## Normal player flow — no calibration

Camera Play requests camera only and keeps frames in volatile browser memory. Normal play has no
named-point selection, guide fitting, player-operated reference capture, photo download, manual
frame analysis, or visible-tip click.

1. **Start rear camera.** Mount the phone near the board centreline and tap **START REAR CAMERA**.
2. **Wait for Board Found.** Keep the entire board and double ring visible. The browser looks for the
   standard board’s repeated red/green double and treble scoring bands, then confirms comparable
   automatic fits. Normal play shows only a subtle board indication and status—not calibration
   handles or spokes.
3. **Start Play.** With no darts in the board and people clear of the view, tap **START PLAY** once.
   The chip briefly says **STARTING LIVE PLAY**, then captures a fresh local reference after a fixed
   short settle and changes to **BOARD FOUND · WATCHING LOCALLY**. Do not wait through detector
   messages or tap Start Play repeatedly.
4. **Throw naturally.** Throw one dart, step clear, and wait for it to settle. The live detector
   compares the frame with its local reference. An accepted dart frame becomes the next reference.
5. **Confirm or correct.** A result is only a proposal. If Camera Play holds one compact or ambiguous
   change as a **held camera suggestion**, it fills a DartCard only after the player explicitly uses
   it. Otherwise use **REVIEW / ENTER SCORE** for ordinary entry/correction.
6. **Next turn.** Remove all darts and tap **BOARD CLEAR · START NEXT TURN**. The app takes another
   short automatic local reference without asking the player to fit the board again.

The player is never asked whether darts are steel-tip or soft-tip and is never asked to click a
physical point. This shared interaction does not prove that the current heuristic can identify every
endpoint under every angle, flight, shadow, board surface, or occlusion.

## What “automatic” means here

The automatic board fit is conservative but not a trained board/orientation model:

1. it samples the local camera frame for conventional saturated red and green board accents;
2. it finds the repeated, color-balanced, alternating outer-double and inner-treble band pair, so a
   red surround, printed branding, wall logo, or one colored object is not treated as the board;
3. it cross-checks the broad fit against the compact two-color bull and requires two comparable full
   board shapes before accepting it;
4. it creates the internal image-to-canonical-board mapping used by scoring; and
5. after **Start Play**, it waits a fixed 650 ms then keeps one fresh in-memory reference frame. A
   missing drawable browser frame retries at 250 ms up to four additional attempts, then returns to
   Start Play; detector classifications do not gate setup.

Color pattern can estimate where a conventional board is, but cannot uniquely read every number-ring
rotation. This field test assumes the physical **20 is upright at the top of the camera image**.
Mount the phone level with a normally oriented board. The normal preview's status chip makes that
assumption visible; the detailed `20` guide is reserved for optional recovery. The current
player-facing board styling follows a conventional dark-S20/red-accent and light-S1/S5/green-accent
palette, but it is not a number-reading model.

After live watching starts, browser-local temporal analysis estimates illumination/noise on the board
face and may compensate bounded board-relative similarity jitter. It rejects broad changes and does
not weaken acceptance just to improve recall. Automatic scoring requires a non-`MISS`, on-board,
adequately confident / sufficiently far-from-wire endpoint with either one unique on-board endpoint
or a visible wider-flight/narrower-entry direction cue. Compact centroids, equal-width endpoint
pairs, near-wire cues, low-confidence cues, competing shapes, and ambiguous endpoint choices remain
correctable abstentions. An exterior flight/shaft endpoint is never automatically recorded as `MISS`.

Full detail on the post-merge setup fix and its evidence boundary lives in
[`15-browser-dart-field-remediation.md`](15-browser-dart-field-remediation.md).

## Required first-test envelope

Start inside this envelope. A result outside it is evidence to investigate, not a reason to call the
feature accurate or broken.

| Item     | Initial field-test requirement                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| Board    | Conventional red/green standard board, normal 20-at-top orientation, complete double ring visible             |
| Device   | Phone/tablet rear camera in a fixed, safe mount outside the throwing path                                     |
| Distance | Usually about 0.7–1.2 m; automatic fit’s compressed/short axis must report at least 480 px before play starts |
| Position | As close to the board centreline as practical; mount level with the 20-up board                               |
| Light    | Even diffuse room light; avoid glare that desaturates red/green bands or crosses wires                        |
| Movement | Do not move the mount; step out of the view after every throw                                                 |
| Darts    | One new dart at a time; wait for dart/flight motion to stop before expecting a proposal                       |
| Decision | Treat every local proposal as correctable, especially close to a wire                                         |

The browser can use a modestly elliptical color fit, but cannot make a tiny, blurred, heavily
occluded, non-standard-color, or extreme side view safe for one-camera entry-point estimation.

## Deploy and test on a physical device

The browser field test and reliability work through [PR #9](https://github.com/nick-kuhle/darts-180/pull/9)
are merged. Test [PR #10](https://github.com/nick-kuhle/darts-180/pull/10)'s top-level HTTPS preview/deployment before treating its implementation as
field-proven.

1. In Vercel, select **`apps/web`**—not `services` or `ml`—as Root Directory and enable **Include
   files outside the Root Directory**. `apps/web/vercel.json` runs the monorepo-root install and web
   workspace build; no environment variables are required. See the [Vercel guide](12-web-demo-and-vercel.md).
2. Open the resulting **top-level HTTPS** deployment directly in Safari or Chrome on the mounted
   device. Camera permission normally cannot work on plain HTTP, an Arena preview iframe, or an
   in-app browser/WebView.
3. If no permission prompt appears, use browser lock/camera site controls to set Camera to **Allow**,
   reload, and retry.
4. Follow the current retest sequence in
   [`15-browser-dart-field-remediation.md`](15-browser-dart-field-remediation.md#required-physical-retest).

Do not invite broad testers, collect raw media, or claim camera accuracy based only on this browser
heuristic. Test direct top-level HTTPS deployments on actual iOS and Android hardware.

## Expected failure behavior and recovery

| In-app state                               | Meaning                                                                 | Safe response                                                                                                                                                      |
| ------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Embedded-preview camera message            | The page is in an iframe that cannot request user media                 | Open the direct `https://…vercel.app` URL in Safari/Chrome, not an Arena/in-app preview                                                                            |
| Camera permission blocked                  | Browser/device denied or remembered a denial                            | In the direct HTTPS tab, set Camera to Allow from lock/camera controls, reload, retry                                                                              |
| Waiting for a complete frame               | Browser has not delivered drawable video data                           | Wait briefly after permission. If it persists with a visible preview, reload/update and record device/browser details                                              |
| No red/green board found                   | Color signal is weak, cropped, non-standard, or obscured                | Show complete board, use diffuse light, reduce glare, move closer if genuinely too small, and keep physical 20 upright                                             |
| Board too small / needs work               | Initial automatic fit cannot safely map the board                       | Improve framing/level/light, then use **FIND BOARD AGAIN**; a soft focus warning alone is diagnostic, not evidence that manual fitting is required                 |
| Starting Live Play does not reach watching | A missing drawable browser frame or a regression in the bounded handoff | Wait through the brief bounded retry. Do not tune the mount around broad-motion/dart-like setup messages; record the failure and deployment/device/browser instead |
| No score appears                           | Change was not an isolated dart or lacked safe direct entry evidence    | Wait briefly; if it remains held, use **REVIEW / ENTER SCORE** and log an abstention as a recall failure rather than inducing a guessed score                      |
| Wrong / near-wire score                    | Heuristic geometry or an otherwise direct-looking cue can be wrong      | Tap **REVIEW OR CORRECT SCORES**, correct the DartCard, then confirm; record physical ground truth and diagnostics                                                 |
| Camera framing/resolution changed          | Existing mapping/reference is no longer trustworthy                     | Tap **FIND BOARD AGAIN**, wait for Board Found, then Start Play with an empty board                                                                                |
| Unusual board colors / extreme perspective | Color heuristic cannot establish a usable automatic shape               | Open **Optional recovery & advanced diagnostics**; do not make it the normal player flow                                                                           |
| Bounce-out / stacked / hidden dart         | One-camera visual difference is insufficiently isolated                 | Record/correct manually; retain it as field-test failure evidence                                                                                                  |

## Report a real failure usefully

A real-board failure is not a cue to keep moving a suitable mount indefinitely. The normal screen
keeps raw fit and detector numbers hidden. If a report needs them, open **Camera diagnostics** and
record the auto-fit measurements or, after live watching, changed board-support pixels, threshold,
bounded shift/scale/rotation, and shape count.

For a reproducible defect report, retain only consented, privacy-safe material: an empty-board
screenshot showing the normal status; a same-mount still with one dart if appropriate; a diagnostics
screenshot after the dart settles; device/browser; board colors/surround; mount/distance/light; and
known physical score. Do not upload raw media without the separate consent and intake gate.

## Controlled field-test record

Record independent ground truth before looking at a suggestion. For every dart, retain test conditions
and both proposed and corrected score.

| Field                 | Example                                                                            |
| --------------------- | ---------------------------------------------------------------------------------- |
| Test ID / date        | `CM-001 / 2026-09-07`                                                              |
| Deployment            | production or preview URL / commit                                                 |
| Device/browser        | `iPhone / Safari` or `Pixel / Chrome`                                              |
| Board/mount           | model, color scheme, distance, centreline offset, mount type                       |
| Light                 | diffuse, side shadow, glare, low light                                             |
| Point style           | soft-tip or steel-tip, recorded for analysis—not setup branching                   |
| Ground truth          | `T20`, confirmed by player/referee                                                 |
| Start Play transition | board found → starting live play → watching, or exact failure state                |
| Proposed → corrected  | `S20 → T20`, or `held → D20` for ordinary-entry fallback                           |
| Wire margin           | displayed mm cue, if proposed                                                      |
| Diagnostics           | fit / changed support / threshold / transform / shape count, if disclosure opened  |
| Notes                 | camera roll, board rotation, bounce-out, stacked dart, flight shadow, motion, etc. |

Include clean singles, trebles, doubles, both bulls, known misses, near-wire hits, both point styles,
and deliberate difficult cases. Preserve difficult/ambiguous cases rather than combining them into an
optimistic accuracy number.

## Optional recovery and limits

If automatic color finding cannot recover, a collapsed **Optional visual guide** exposes the previous
drag/tap, pinch, twist, and edge-handle fit. It is recovery for unusual conditions, never onboarding.
The separate **Advanced field test** exposes named double-bed anchors, explicit reference/frame
analysis, endpoint inspection, manual visible-tip recovery, and a no-media debug record for
engineering diagnosis only. Capture Lab and Annotation Lab remain separate consent-sensitive data
tools.

The implementation has synthetic/unit coverage for color-board fitting, fit stability, homography /
manual-guide geometry, quality gates, board-face support masking, bounded similarity alignment,
automatic-candidate abstention/ranking, and the bounded Start Play reference policy. It has no
real-world performance or accuracy measurement. A production native implementation still needs a
trained board detector with number/orientation recognition, measured pose tracking, temporal/dart
tracking, calibrated entry-point uncertainty, stacked-dart handling, and real-device evaluation.
