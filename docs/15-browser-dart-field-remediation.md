# Archived browser heuristic remediation record

**Status:** historical evidence only; not a current Camera Play implementation or release plan.
**Date closed:** 2026-09-08 (America/Los_Angeles)

This document preserves why Darts 180 stopped iterating on the earlier red/green board finder and
frame-difference dart endpoint scorer. It does **not** describe a fallback that may be enabled in the web
product. The normal route now targets the learned Worker architecture in
[`12-web-demo-and-vercel.md`](12-web-demo-and-vercel.md), subject to its model/evaluation gate.

## Field-report chronology

| Point                       | Direct evidence reported                                                                                                                                                                                              | Correct conclusion                                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| PR #7                       | Automatic board finding improved on a real iPhone/board, but dart resolution was absent or materially wrong.                                                                                                          | Do not claim scoring readiness.                                                                                              |
| PR #8                       | A device run became stuck in clear-board arming before live watching.                                                                                                                                                 | The setup state machine needed correction; this did not validate dart localization.                                          |
| PR #9                       | A roughly one-yard near-centreline mount found the board, but normal Camera Play cycled through dart-like/broad-motion messages and returned to Start Play.                                                           | Do not make a player repeatedly tune a mount to satisfy a heuristic setup loop.                                              |
| PR #10                      | `darts-180-web.vercel.app` visibly reached Start Play → Watching Locally. After throws it reported broad movement, single-frame dart/flight holds, and competing/unmappable changes. No shown dart filled a DartCard. | The bounded Start Play handoff worked; live dart recognition was still not proven or useful.                                 |
| User-reported merged PR #11 | Board acquisition and Watching Locally again worked, while a visibly embedded dart produced competing/unmappable output and no score.                                                                                 | The safety policy abstained correctly, but recall was unusable. Replace the perception method; do not tune thresholds again. |

The private retest screens were inspected only to understand failure categories. They did not establish an
exact score, a labelled sequence, a benchmark, data consent, or training permission. They were deleted from
the workspace and are not fixtures, source assets, or model data.

## What the former implementation did

The retired path reduced browser camera frames to a bounded canvas, searched for conventional red/green
scoring bands, assumed an upright conventional orientation, retained a clear-board reference, compared later
RGB pixels, grouped changed components, and ranked possible endpoints from shape/width/board containment.
Later patches added bounded alignment, skew-aware search envelopes, compact-change holds, and broad-motion
handling.

Those changes were reasonable diagnostic experiments. They could indicate movement or sometimes form a
candidate, but they could not reliably measure the physical point where a dart intersects the scoring plane.
They also could not infer true number-ring orientation from repeated colors. More permissive masks or endpoint
rules would increase ungrounded false scores rather than satisfy the product requirement.

## Preserved versus retired

| Preserve                                                                                             | Retire from product scoring                                                       |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Deterministic board rules, X01/Cricket state, DartCards, correction, confirmation, and event history | Color thresholds as board pose/orientation authority                              |
| Browser-local privacy default                                                                        | Reference-frame RGB differencing as dart-tip localizer                            |
| No-manual-calibration normal flow                                                                    | Connected-component/shape/width endpoint ranking                                  |
| Conservative review and abstention                                                                   | A level-20-up assumption or manual guide/tip-click recovery as normal Camera Play |
| Safe mounted-camera and direct HTTPS permission guidance                                             | Automatic `MISS` from a one-view exterior/ambiguous visual candidate              |

The old React components, scoring modules, and synthetic tests have been removed from the web application.
A normal-route test asserts that `LearnedCameraPlay` does not import the retired scoring modules. Do not use
this archival narrative as an invitation to re-enable it.

## Successor requirements

The successor must use learned semantic output for complete board pose/orientation and physical dart-tip
localization, map source coordinates to canonical millimetres, keep uncertainty through deterministic rules,
and gate each proposed score through a reviewed model policy. Temporal low-resolution signals are limited to
capture timing; camera movement, occlusion, near-wire alternatives, poor quality, and unknown cases remain
review/abstain outcomes.

See [`16-camera-autoscoring-reset.md`](16-camera-autoscoring-reset.md) for data, evaluation, native reuse,
hardware, privacy, and IP/FTO gates. No follow-up PR may describe a frame-difference adjustment as the
production solution.
