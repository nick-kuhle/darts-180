# Browser Live Scoring — real-device field-test guide

**Status:** web-first learned-runtime test protocol; **not currently executable for scoring** because the
checked-in model manifest is deliberately unavailable.
**Date:** 2026-09-08 (America/Los_Angeles)
**Audience:** internal testers after a reviewed model artifact is installed through the release gate.

This replaces the former color/frame-difference camera guide. The old workflow was a historical
heuristic baseline and failed a direct post-PR #11 dart-recognition retest; it is not an alternative test
path. See [`15-browser-dart-field-remediation.md`](15-browser-dart-field-remediation.md) for that record.

## Before testing

Do not begin a score-accuracy test until all of these are true:

- the deployed app is the existing Vercel project/URL built from `apps/web`;
- the direct browser tab is top-level HTTPS, not Arena's embedded preview, an in-app browser, or HTTP;
- the manifest names a same-origin ONNX model with an exact SHA-256 and passes parser/release-policy checks;
- the release has approved provenance/licence identifiers and a locked evaluation plan;
- an independent ground-truth procedure is ready for every throw; and
- the tester has consented to the specific data collection plan if any diagnostic data beyond local derived
  metrics will leave the device.

The current unavailable manifest is a **passing safety result**: Live Scoring may show a preview but must say
that no verified model package is installed and must not score a dart.

## Normal player flow after an approved model release

No manual board calibration is part of this flow.

1. **Mount and open.** Use the rear camera in a stable, safe, inexpensive mount. Begin as close to the board
   centreline as practical, but do not treat that as a rigid requirement. Keep the full board and number ring
   visible. A modest off-axis view can expose an embedded dart's entry geometry; the learned quality model,
   not a fixed position rule, decides whether the view is sufficient.
2. **Start Camera.** Open the direct HTTPS Darts 180 URL and tap **START CAMERA**. Allow camera permission.
   Camera pixels stay in browser-local volatile memory and are transferred only to the same-origin local
   Worker.
3. **Wait for automatic pose.** Live Scoring looks for semantic bull and named D20/D6/D3/D11 landmarks, derives
   complete standard-board geometry and orientation, and shows a non-editable overlay. It may request a simple
   move, more light, focus, or less glare. It must never ask for guide handles, point clicks, a level-20-up
   assumption, or a manual calibration photograph.
4. **Arm the visit.** With the board empty, tap **ARM CAMERA** once. The app uses a bounded short
   focus/exposure settle, then checks the clear board itself; it does not ask the player to capture an empty
   reference frame. If darts remain visible, remove them and wait for the automatic clear check.
5. **Throw normally.** Throw one dart and wait for it to settle before the next. A low-resolution luma cue may
   time a short high-resolution post-impact burst. It has no score coordinate. The learned Worker predicts
   landmarks, tip, uncertainty, and occlusion; the canonical rules package determines the zone.
6. **Review or correct.** A high-evidence production policy may propose an `auto-score`; a near-wire,
   overlapping, low-quality, occluded, unapproved, or otherwise ambiguous point is routed to **REVIEW** or
   **NO SCORE RECORDED**. Use the ordinary DartCard/manual board correction path. Do not invent a visible-tip
   click workflow in normal play.
7. **Next visit.** Confirm the visit, remove darts, and let Live Scoring recognize the cleared board before
   arming the next visit. If the mount/scene moves materially, it re-reads the board geometry before accepting
   another score.

The same player flow applies to steel-tip and soft-tip darts. The model/data program may classify context
internally, but point type is not a setup question.

## Supported-observability principle

The requirement is broad automatic adaptation across practical phone distance, angle, orientation, focus,
brightness, white balance, glare, board condition, and lighting—not a promise that a single camera can see
through physics. Live Scoring should adapt crop/resolution/timing and give one simple instruction only when
necessary. It must decline automatic scoring when:

- the full board or number ring is materially out of frame;
- the board is too small, blurred, dark, saturated, or glare-obscured for the release's evidence envelope;
- named orientation landmarks cannot establish a safe pose;
- the learned tip is unstable, competing, stacked, hidden, or crosses a scoring wire within uncertainty; or
- a material camera/scene disturbance has invalidated current observability.

For a one-view limitation, suggest a modest mount reposition or a supported second view. Do not replace an
abstention with color thresholds, endpoint guesses, radar, acoustic, piezo, or IMU localization. Those sensors
can at most assist event timing/order.

## Required field matrix and evidence record

Use a pre-registered test plan, not a collection of favorable videos. Partition and report at least:

| Dimension      | Required slices                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------ |
| Board          | manufacturers, wiring/color/condition, conventional and visually difficult boards                |
| Device         | iOS/Android, device/lens tiers, portrait/landscape, browser versions, sustained thermal state    |
| Pose           | practical centreline/off-axis views, near/far framing, full-board coverage, mount stability      |
| Light          | dim/even/bright, glare, white balance, flicker, backgrounds                                      |
| Dart state     | steel/soft tip, one/two/three darts, stacked/occluded darts, flight/shaft variation, bounce-outs |
| Score geometry | every sector/ring, bulls, double/treble boundaries, angular/radial wire-distance bands           |
| Decision       | auto-score, review, abstain, duplicate prevention, camera disturbance and recovery               |

Record independent truth, model/manifest version, device/camera metadata, quality values, latency, resource
behavior, and error class. Do **not** retain raw camera frames by default. Any raw bursts for research require
specific opt-in, purpose limitation, encryption/access controls, retention/deletion policy, and participant
withdrawal handling.

## Acceptance measures

Report per slice with confidence intervals:

1. visible eligible dart recall;
2. exact ring-and-sector score accuracy;
3. unsafe automatic score rate (more important than raw recall);
4. calibration/tip error in canonical millimetres and wire-distance behavior;
5. review and abstention rate;
6. duplicate, wrong-event, bounce-out, and camera-moved behavior; and
7. local latency, first-load/cache, memory, battery, thermal, offline, and browser CSP/Worker reliability.

A passing desktop build, camera permission prompt, or synthetic test does not satisfy any of these measures.

## Deployment-specific checks

Follow [`12-web-demo-and-vercel.md`](12-web-demo-and-vercel.md). In particular, confirm the deployed
`Permissions-Policy`, `worker-src`, same-origin model/WASM fetches, and `wasm-unsafe-eval` CSP directive in the
real Vercel response. Test only the existing deployment URL after each merge; do not substitute a new Vercel
project or a localhost/iframe result.
