# Browser Camera Play — post-merge field remediation

**Status:** [PR #8](https://github.com/nick-kuhle/darts-180/pull/8) and
[PR #9](https://github.com/nick-kuhle/darts-180/pull/9) are merged. This document records a new
post-PR #9 iPhone field report and the follow-up implementation that still requires a fresh physical
retest. **Date:** 2026-09-07 (America/Los_Angeles).

Camera Play remains an experimental, browser-local fixed-mount heuristic. It is not a trained
entry-point model and this work makes no production accuracy claim.

## Field-report chronology

| Point in the work  | Direct evidence                                                                                                                                                                                                                 | Appropriate conclusion                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| After PR #7        | Automatic board finding improved on a real iPhone/board, but dart resolution either did not occur or was materially wrong.                                                                                                      | Do not claim dart-scoring readiness.                                                                            |
| After PR #8        | A direct device run got stuck in clear-board arming before live dart watching.                                                                                                                                                  | PR #9 added a detector-driven clear-board recovery policy.                                                      |
| After merged PR #9 | On `darts-180-web.vercel.app`, a roughly one-yard, near-centreline, steady iPhone mount found the board strongly, but normal Camera Play cycled between dart-like / broad-motion setup messages and returned to **Start Play**. | The setup gate itself is a product defect. Do not ask the player to keep tuning an otherwise appropriate mount. |

The post-PR #9 screen composites showed a strong automatic fit (approximately 530 px board,
20/20 outer-band sectors, 2,857 red and 1,232 green samples, 56% alternation, 100% band agreement,
and a 91% color-pattern cue). The fit therefore is not the immediate failure. A soft focus heuristic
and a local changed-pixel readout were diagnostic observations, not proof that calibration failed.

The screenshots were private diagnostic material, not source assets, raw camera frames, or an
accuracy benchmark. They must not be used to derive a score ground truth or tune a threshold. They
were removed from the working directory after this review and are never committed.

## What this follow-up changes

### 1. A bounded Start Play reference handoff, not detector-gated setup

After the automatic board finder has accepted two comparable color fits, **Start Play**:

1. shows **STARTING LIVE PLAY**;
2. waits a fixed short settle of **650 ms**;
3. captures one fresh volatile browser-local reference frame; and
4. enters **BOARD FOUND · WATCHING LOCALLY** immediately when a drawable frame exists.

If the browser has not supplied a drawable frame, it retries every 250 ms up to four additional
captures, then returns to **Start Play** with a frame-specific message. That is the only retry
condition. A localized visual change or broad-motion label is not allowed to loop normal setup, reset
board finding, or demand pixel-identical clear-board comparisons. The player is still asked to begin
with an empty board, but no separate capture action is exposed.

This boundary is deliberate. The live dart-difference classifier remains useful _after_ a reference
exists; it was not reliable enough to act as a proof that every setup frame in mobile video was
identical.

### 2. Preserve conservative score safety after watching starts

The follow-up does **not** weaken automatic score acceptance to get through setup:

- board-color finding still requires comparable repeated conventional red/green band fits;
- live detection continues to use board-local temporal analysis and bounded similarity alignment;
- an automatic result needs a non-`MISS`, on-board endpoint, adequate confidence and wire margin,
  plus a unique endpoint or a visible wider-flight/narrower-entry direction cue;
- compact, equal-endpoint, low-margin, competing, and otherwise ambiguous changes remain unscored or
  become one explicitly accepted held suggestion; and
- an external shaft/flight endpoint is not silently recorded as `MISS`.

Ordinary **Review / Enter Score** correction remains available. The optional manual guide and
Advanced Field Test remain recovery/engineering paths; automatic mode does not overwrite a guide a
player owns manually.

### 3. Make normal Camera Play look like play

With an automatically found board, the preview now uses at most a subtle non-interactive outer-board
indication and a status chip. It no longer paints the six rings, twenty spokes, crosshair, cardinal
handle circles, or a draggable `20` control that made the normal camera view look like calibration.
Those details remain only inside the optional manual recovery guide.

Raw color-fit measures, sharpness/skew heuristics, changed-pixel counts, thresholds, alignment, and
shape counts live under a collapsed **Camera diagnostics** disclosure. They remain available for a
consented failure report without being presented as ordinary player decisions.

## Evidence separated by strength

| Evidence level             | Covered now                                                                                                                                                                                                                                                                                                                                           | Not proved                                                                                               |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Synthetic/build regression | The Start Play reference policy has focused unit coverage: a short fixed settle is specified, a missing browser frame retries, and a fresh frame reaches live watching even in the presence of localized or broad setup transient labels. Existing color-fit, geometry, motion-alignment, candidate-abstention, and no-automatic-`MISS` tests remain. | Accuracy on a physical board, a particular phone, either dart point style, or the production deployment. |
| Direct physical evidence   | The post-PR #9 iPhone report proves automatic board finding can succeed while detector-gated setup still produces an unacceptable loop.                                                                                                                                                                                                               | That this replacement reaches watching on device, detects a dart, or scores any dart correctly.          |
| Privacy-safe diagnostics   | The browser can expose fit and temporal metrics under an explicit disclosure.                                                                                                                                                                                                                                                                         | Raw-video inspection, a labeled evaluation corpus, or consent for media collection.                      |

A passing local build or synthetic test must never be described as a direct-device result.

## Required physical retest

Use the top-level HTTPS preview/deployment directly in Safari or Chrome. An Arena preview iframe or
in-app browser cannot exercise the real permission/frame path.

1. Mount the phone near the board centreline, about the previously successful distance if practical,
   with the full double ring visible and the physical 20 upright in the image.
2. Start the rear camera and wait for **BOARD FOUND**. Do not use the optional guide unless automatic
   board finding actually fails.
3. Start with an empty board and tap **START PLAY** once. The expected normal sequence is
   **STARTING LIVE PLAY** followed, after roughly the fixed short handoff, by **BOARD FOUND · WATCHING
   LOCALLY**. It must not display a dart-like/broad-motion baseline loop or return to **Start Play**.
4. Throw isolated, settled singles, trebles, doubles, outer bulls, and inner bulls. Test steel and
   soft tips as equivalent player flows where practical. Record known misses separately.
5. Before accepting a proposed score, independently record physical ground truth. For every no-score,
   held suggestion, or wrong proposal, use normal correction and record it as recall/precision
   evidence rather than forcing an automatic result.
6. Open **Camera diagnostics** only when recording a failure. Retain a privacy-safe screenshot only
   with tester consent; do not upload raw camera media without the separate consent and intake gate.

Use the full field sheet in
[`14-browser-camera-field-test.md`](14-browser-camera-field-test.md#controlled-field-test-record).

## Exit criteria for this follow-up

Do not say the field flow is fixed until a new direct iPhone retest demonstrates all of the following:

- automatic conventional-board finding still succeeds for the reported mounted setup;
- one **Start Play** tap reliably enters live watching without a detector-driven setup loop;
- normal Camera Play does not expose calibration-looking handles/spokes or engineering telemetry by
  default;
- ambiguous/compact/exterior candidates still do not silently fill a DartCard or emit automatic
  `MISS`; and
- normal correction still completes a turn without calibration, frame analysis, or a visible-tip
  click.

A trained board/orientation and entry-point model, measured device performance, consented real-world
evaluation, and native frame processing remain necessary before a production auto-scoring claim.
