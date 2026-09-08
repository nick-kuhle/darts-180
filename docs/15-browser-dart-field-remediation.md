# Browser Camera Play — dart-detection field remediation

**Status:** remediation implementation awaiting a new direct-device retest, 2026-09-07
(America/Los_Angeles)

This note records the reliability response after the browser-camera work in
[PR #7](https://github.com/nick-kuhle/darts-180/pull/7) was merged. It is intentionally separate
from a production-accuracy claim: browser Camera Play remains a local, fixed-mount heuristic while
the trained/native vision path is built.

## What triggered this work

### Direct field report — meaningful, but qualitative

A tester confirmed that the Vercel deployment reflected the merge of PR #7. Their direct physical
board result was:

- automatic board detection was substantially better; and
- dart detection either did not resolve a dart or placed its score far from the actual dart.

That report is sufficient to block any “ready” implication for the dart detector. It does **not**
by itself identify whether the failure was pose drift, reference instability, exposure, a hidden
point, shape fragmentation, or an incorrect endpoint choice.

### Private screenshots — useful context, not a benchmark

Two tester-supplied iPhone screenshots were inspected privately and are **not** committed to this
repository. They show a broadly well-aligned board guide, visible lodged darts, and Camera Play
states including a broad-movement hold / compact-or-ambiguous hold. A prior `S3` marker is visible
near the bull area, but the actual score for that particular proposed dart was not supplied.

Therefore the screenshots must not be used to calculate accuracy, prove the marker wrong, or tune a
pixel threshold as if they were camera frames. They are screen composites: the guide, labels, and UI
are painted over the video, and there is no paired raw clear-board/current-frame capture. They do,
however, expose an unacceptable product behavior: an internally tied endpoint could previously be
silently recorded as a score.

## Remediation contract

The patch retains the better automatic board-find normal flow and changes the local temporal path as
follows.

1. **Stabilize the baseline without another player task.** A **Start Play** tap now checks two
   consecutive clear-board comparisons before it begins live scoring. This gives focus, exposure,
   and mobile optical stabilization a short time to settle without reintroducing manual reference capture.
2. **Use board-local support for exposure, noise, and broad-motion safety.** Illumination estimates
   sample the stable board face rather than the room or the flight margin. The broad-motion fraction
   is measured on the scoring face; a permitted outside-board flight/search margin remains available
   only to connect a local dart shape.
3. **Tighten the temporal search envelope.** The default outside-double search margin is reduced from
   140 mm to 70 mm. A shaft/flight may still project past the double wire, but surrounding cabinet or
   wall changes no longer dominate the detector as readily.
4. **Absorb bounded phone recentering.** Sparse board-face matching may compensate a small similarity
   change: up to 16 px of board-center shift, approximately ±1.8% scale, and approximately ±0.8°
   rotation. It is not general camera registration. A change that remains broad after this bounded
   correction stays held as movement / hand presence.
5. **Make automatic scoring an evidence gate, not a tie-breaker.** A candidate can be auto-recorded
   only when it has a non-`MISS` on-board endpoint, adequate score/wire margin, and either:
   - exactly one endpoint lies on a scoring bed; or
   - a clearly wider visible flight and narrower entry end establish direction.

   Independent competing mapped shapes also hold rather than letting one component silently win. A
   compact centerline flight, equal-width on-board pair, near-wire endpoint, low-confidence cue, and
   ambiguous endpoint remain visible local evidence but return `null` from the automatic selector.
   For one isolated held shape, Camera Play may show a **held camera suggestion** that requires the
   player to explicitly use it; it never fills a DartCard by itself. Competing shapes show no such
   suggestion. Neither case is converted into an arbitrary score after two matching frames.

6. **Keep recovery available.** Camera Play offers **Review / Enter Score** even when no DartCard has
   been auto-filled. This opens ordinary score entry/correction, not a camera calibration or visible
   tip-picking step. The optional guide and Advanced Field Test remain recovery/diagnostic tools, not
   normal setup.

The existing no-automatic-`MISS` rule remains in force.

## Evidence separated by strength

| Evidence level           | What is covered now                                                                                                                                                                                                                                                                                                     | What it does not prove                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Synthetic regression     | Equal-width elongated endpoints stay reviewable rather than auto-scoring; a visibly wider flight selects its narrow end; compact flights remain reviewable; board-surround change does not erase a board-local dart; bounded translation/scale/rotation does not invent a dart; a larger reframe stays a movement hold. | Accuracy on a physical board, a specific phone, any flight, or any point style.                                            |
| Direct device report     | The PR #7 production deployment reached a real iPhone/board; automatic board finding improved; dart handling failed materially.                                                                                                                                                                                         | Which low-level cause triggered this patch, a score ground truth for the screenshots, or that this patch fixes the device. |
| Privacy-safe diagnostics | Camera Play displays changed/scoring-face support pixels, threshold, bounded shift, scale, rotation, and shape count.                                                                                                                                                                                                   | Raw-video inspection, model evaluation, or a replacement for consented data collection.                                    |

## Required retest after this patch

Test the top-level HTTPS preview/deployment directly in Safari and Chrome; an Arena/in-app iframe
cannot exercise device camera permission or the real frame loop.

1. Mount the device near the board centreline with the standard physical 20 at the top, show the
   complete double ring, and wait for **Board Found**.
2. With an empty board, tap **Start Play** and wait for the automatic clear-board check to say it is
   watching. Do not move the mount or throw during that short check.
3. Record the physical ground truth _before_ looking at Camera Play. Start with isolated clean single,
   treble, double, outer bull, and inner bull throws; then repeat with both steel and soft tips where
   practical. Record known misses separately.
4. For every non-resolution, unexpected broad-motion hold, or incorrect proposal, retain a
   privacy-safe screenshot that includes the guide and the **LOCAL DETECTOR** numeric line. Record
   device/browser, board/mount/light, ground truth, proposal/correction, and whether another dart was
   already in the board. Do not upload raw media without the separate consent and intake gate.
5. If Camera Play says endpoint evidence is unsafe, verify that it leaves the DartCard empty. It may
   show one held suggestion, but verify that the card changes only after an explicit **USE …** action;
   otherwise use **Review / Enter Score**. That abstention is the intended behavior; log it as a
   recall failure, not as a correct score.

Use the complete field sheet in
[`14-browser-camera-field-test.md`](14-browser-camera-field-test.md#controlled-field-test-record).

## Exit criteria for the browser heuristic

This remediation is not complete merely because the synthetic suite passes. Before saying the
browser heuristic materially improved in the field, retain independent ground truth for repeated
real-board throws and show all of the following:

- automatic board finding remains successful in the previously improved normal setup;
- a settled, visibly on-board dart resolves more often than the pre-patch direct-device baseline;
- no compact/ambiguous/equal-endpoint case silently fills a DartCard with an arbitrary score;
- no automatic `MISS` is emitted for an external flight/shaft endpoint;
- false broad-motion holds and false locations are characterized by the numeric diagnostics; and
- ordinary correction continues to complete a turn without asking the player to calibrate, analyze a
  frame, or click a physical dart tip.

A trained board/entry-point model, measured pose tracking, consented evaluation data, and native
frame processing are still required for a production auto-scoring claim.
