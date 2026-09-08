# Browser Camera Play — post-PR #10 field remediation

**Status:** [PR #8](https://github.com/nick-kuhle/darts-180/pull/8),
[PR #9](https://github.com/nick-kuhle/darts-180/pull/9), and
[PR #10](https://github.com/nick-kuhle/darts-180/pull/10) are merged. This document records the
post-PR #10 direct-iPhone result and the next browser field-remediation branch. It still requires a
fresh direct-device retest. **Date:** 2026-09-07 (America/Los_Angeles).

Camera Play remains an experimental, browser-local fixed-mount heuristic. It is not a trained
entry-point model, and this work makes no production accuracy claim.

## Field-report chronology

| Point in the work   | Direct evidence                                                                                                                                                                                                                                                                                                                                                                | Appropriate conclusion                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| After PR #7         | Automatic board finding improved on a real iPhone/board, but dart resolution either did not occur or was materially wrong.                                                                                                                                                                                                                                                     | Do not claim dart-scoring readiness.                                                                                                                                            |
| After PR #8         | A direct device run got stuck in clear-board arming before live dart watching.                                                                                                                                                                                                                                                                                                 | PR #9 added detector-driven clear-board recovery.                                                                                                                               |
| After merged PR #9  | A roughly one-yard, near-centreline iPhone mount found the board strongly, but normal Camera Play cycled between dart-like / broad-motion setup messages and returned to **Start Play**.                                                                                                                                                                                       | The setup gate was a product defect; do not ask the player to keep tuning an otherwise suitable mount.                                                                          |
| After merged PR #10 | On `darts-180-web.vercel.app`, Camera Play visibly reached **BOARD FOUND · 20 ↑ UPRIGHT** → **START PLAY** → **STARTING LIVE PLAY** → **BOARD FOUND · WATCHING LOCALLY**. Board acquisition was still intermittent in use; after throws, the screen reported broad movement, a one-frame dart/flight hold, and competing/unmappable changes. No thrown dart filled a DartCard. | The bounded Start Play handoff is physically observed and must remain. Live board acquisition and temporal dart detection are still not field-proven or practically successful. |

The supplied retest screens showed a conventional, near-centreline board and later two visible darts
near the upper scoring area. They do **not** establish a score ground truth, a labeled video sequence,
or an accuracy benchmark. In particular, two unresolved darts in one later frame are a reason to
abstain rather than a reason to choose one arbitrarily.

The private screens were used only for diagnostic inspection and were deleted from the workspace.
They are not source assets, test fixtures, raw camera frames, or committed material.

## What the next remediation changes

### 1. Preserve the bounded Start Play handoff

After the automatic finder has accepted two comparable color fits, **Start Play** continues to:

1. show **STARTING LIVE PLAY**;
2. wait a fixed 650 ms;
3. save one fresh, volatile browser-local reference; and
4. enter **BOARD FOUND · WATCHING LOCALLY** whenever a drawable frame exists.

A missing drawable frame retries every 250 ms up to four additional attempts, then returns control.
A dart-like or broad-motion classifier label is never allowed to send normal setup back to board
finding or trap the player in clear-board proof. This is the behavior PR #10 physically demonstrated;
it is not reverted by this follow-up.

### 2. Make automatic acquisition more tolerant of the observed board

The field inspection identified two weaknesses in a hue-only bootstrap:

- warm natural cork/sisal single beds can land in an orange-red hue range under phone white balance;
  treating those broad light beds as red erases the uncoloured single-bed gap needed to prove the
  double/treble pair; and
- a correct conventional color pattern can fade for an isolated autofocus or auto-exposure sample.

The finder now requires red-channel dominance as well as a tolerant red hue, retains the repeated
red/green band proof and two-color bull cross-check, and latches a matching fit through at most two
intermittent missing observations. It still needs two comparable actual fits before **Board Found**;
a third consecutive missing observation forgets the old mapping so a real reframe cannot inherit it.
No calibration controls return to normal flow.

### 3. Keep live analysis local to the fitted view

The direct retest included changing foreground below the lower rim while the preferred near-centreline
view was used. To keep that room foreground from competing with a real dart, live analysis now:

- chooses its permitted outside-double flight margin from measured skew: 24 mm for a front/near-
  centreline fit, 42 mm for moderate skew, and 70 mm only for an oblique view;
- uses a moderate 42 mm default rather than assuming a wide 70 mm surround when skew is unavailable;
- distinguishes broad change across the stable central board core from an outer-rim/surround
  disturbance; a large rim-only disturbance can produce a recoverable suggestion but cannot
  auto-record a score;
- rejects a component longer than a physically plausible projected dart instead of treating a
  board-length foreground edge or blanket fold as a shaft; and
- checks at a 500 ms cadence so the second settled confirmation is requested before a player would
  normally throw a second dart.

The collapsed diagnostics disclose the stable-core fraction alongside the existing board-support,
threshold, alignment, and shape information. When a safe local candidate cannot be formed, the
normal screen now puts **CHECK / ENTER SCORE** next to the failure message rather than requiring the
player to find the lower review control. That is ordinary correction recovery, not a calibration step.

### 4. Preserve conservative score safety

This remediation does **not** solve recall by guessing:

- automatic board finding still needs comparable repeated conventional red/green band fits;
- an automatic result still needs a non-`MISS`, on-board endpoint, adequate confidence and wire
  margin, plus a unique endpoint or a visible wider-flight/narrower-entry direction cue;
- compact, equal-endpoint, low-margin, competing, exterior, and otherwise ambiguous changes remain
  unscored or become one explicitly accepted held suggestion;
- a high-change outer-rim frame is review-only even if it happens to contain one direct-looking
  candidate; and
- an exterior shaft/flight endpoint is never silently recorded as `MISS`.

Ordinary **Review / Enter Score**, the optional visual guide, and Advanced Field Test remain
available for recovery. The latter two are not normal setup.

## Evidence separated by strength

| Evidence level             | Covered now                                                                                                                                                                                                                                                                                                  | Not proved                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Synthetic/build regression | Warm-cork color separation, transient-fit latching, near-centreline/mid-skew flight envelopes, lower-rim foreground handling, physically implausible long-shape rejection, direct visible-flight selection, candidate abstention, no automatic `MISS`, and the bounded Start Play policy have focused tests. | Accuracy on a physical board, a particular phone, either dart point style, or the deployment.               |
| Direct physical evidence   | PR #10’s **Start Play → Watching Locally** transition was observed on the reported iPhone/board. The subsequent live detector failed to record the shown throws.                                                                                                                                             | That this remediation acquires the board consistently, recognizes a dart, or scores it correctly on device. |
| Privacy-safe diagnostics   | The browser can expose fit and temporal measurements under an explicit disclosure without uploading media.                                                                                                                                                                                                   | A labeled video corpus, raw-video inspection, or consent for media collection.                              |

A passing local build or synthetic test must never be described as a direct-device result.

## Required physical retest

Use the top-level HTTPS deployment directly in Safari or Chrome. An Arena preview iframe or in-app
browser cannot exercise the real permission/frame path.

1. Mount the phone near the board centreline at the previously workable distance, with the whole
   double ring visible and the physical 20 upright. Keep movable foreground below the board from
   crossing the lower double/number area when practical; this is framing hygiene, not calibration.
2. Start the rear camera and wait for **BOARD FOUND**. Do not use the optional guide unless automatic
   board finding genuinely fails after it has had time to settle.
3. With an empty board, tap **START PLAY** once. Verify **STARTING LIVE PLAY** then **BOARD FOUND ·
   WATCHING LOCALLY**. The successful PR #10 transition must remain intact.
4. Throw **one isolated dart at a time** and wait for the resulting card or held suggestion before
   throwing the next. Start with clear, well-inside singles and trebles; record doubles, bulls,
   misses, near-wire hits, steel tips, and soft tips as separate cases.
5. Independently record physical ground truth before looking at the screen. For each no-score, held
   suggestion, or wrong proposal, use normal correction and record it as recall/precision evidence
   rather than forcing an automatic result.
6. Open **Camera diagnostics** only for a failure report. Capture consented privacy-safe screenshots
   if useful; do not upload raw media without the separate consent and intake gate.

Use the field sheet in
[`14-browser-camera-field-test.md`](14-browser-camera-field-test.md#controlled-field-test-record).

## Exit criteria for this follow-up

Do not say live dart detection is fixed until a new direct iPhone retest demonstrates all of the
following:

- automatic conventional-board finding succeeds repeatedly for the reported mounted setup without
  normal-flow calibration;
- one **Start Play** tap reliably enters live watching without a detector-driven setup loop;
- at least one isolated, clearly visible settled dart is automatically recorded at its independently
  confirmed score, and subsequent controlled cases are recorded rather than silently discarded;
- a changing lower foreground, compact/ambiguous cue, competing darts, and exterior endpoint do not
  create an arbitrary auto-score or automatic `MISS`; and
- correction still completes a turn without calibration, manual analysis, or a visible-tip click.

A trained board/orientation and entry-point model, measured device performance, consented real-world
evaluation, and native frame processing remain necessary before a production auto-scoring claim.
