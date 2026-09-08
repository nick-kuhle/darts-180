# Darts 180 — current implementation status

**Snapshot date:** 2026-09-07 (America/Los_Angeles)<br />
**Product name:** Darts 180 — working name; legal clearance is still required<br />
**Repository target:** `https://github.com/nick-kuhle/darts-180.git` (private)<br />
**Status:** foundation, playable scoring prototype, local data tooling, and an experimental
browser-camera field-test workflow exist. [PR #8](https://github.com/nick-kuhle/darts-180/pull/8),
[PR #9](https://github.com/nick-kuhle/darts-180/pull/9), and
[PR #10](https://github.com/nick-kuhle/darts-180/pull/10) are merged. PR #10's direct iPhone retest
proved the bounded startup transition but did not record a dart; a new field-remediation branch
awaits delivery and another direct retest. There is no production auto-scoring claim.

This is the operational source of truth for what exists versus what is intentionally deferred. It
separates synthetic/build evidence from a physical-device result.

## Completed in `main`

| Area                 | Delivered now                                                                                                                                                                                                                                                                                                                                                                                            | Important boundary                                                                                                                                                                                                                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Git / delivery       | Private GitHub `main` includes foundations through [PR #1](https://github.com/nick-kuhle/darts-180/pull/1), Camera Play simplification / automatic board finding / reliability work through [PR #10](https://github.com/nick-kuhle/darts-180/pull/10), CI commands, issue/security/contribution material, and root plus `apps/web` Vercel configuration.                                                 | Configure branch protections and review policy; import only `apps/web` as the Vercel project. A successful push/PR API operation does not itself prove GitHub Actions or Vercel deployment status.                                                                                                                             |
| Web product          | Responsive Vite/React 501 and Cricket scorer, accurate interactive standard board, manual correction, checkout hints, visit history, and transparent simulated camera-review states.                                                                                                                                                                                                                     | Simulated camera cards are UX evidence, not vision inference.                                                                                                                                                                                                                                                                  |
| Browser Camera Play  | HTTPS browser camera plus embedded/insecure/permission diagnostics; conventional red/green repeated double/treble-band finding with alternating-color/two-color-bull cross-checks; the PR #10 bounded Start Play handoff; 20-up internal mapping; board-face temporal analysis with bounded similarity alignment; direct-entry automatic-score gating; correction and optional manual/advanced recovery. | Fixed-mount heuristic only. PR #10 physically reached watching but did not record a dart. It is not a trained board/orientation or entry-point model, real-world accuracy proof, or silent production auto-score path. Automatic mode assumes level 20-up orientation; the same player flow does not branch on steel/soft tip. |
| Capture / annotation | Browser-local Capture Lab JPEG/manifest pairing, Annotation Lab local homography/sidecar workflow, privacy attestations, validators, and synthetic scenes.                                                                                                                                                                                                                                               | No raw-media upload, consented training corpus, or cloud data path.                                                                                                                                                                                                                                                            |
| Development API      | Fastify game creation/snapshot endpoints, idempotent event append, correction-aware X01/Cricket projection, event catch-up, WebSocket fan-out, and OpenAPI contract.                                                                                                                                                                                                                                     | In-memory, unauthenticated, and not production infrastructure.                                                                                                                                                                                                                                                                 |
| ML / native seeds    | Python geometry / data-contract / synthetic / pose-quality / temporal baselines; Expo product shell and camera preview; Rust geometry seed; Postgres/Docker starting infrastructure.                                                                                                                                                                                                                     | No trained production model, native high-rate frame processor, durable event store, authentication, or model artifact.                                                                                                                                                                                                         |

## Current follow-up — post-PR #10 field failure, not yet physical-device proven

The post-PR #10 direct iPhone retest produced an important split result on the reported
near-centreline view:

- **Succeeded:** automatic finding reached **BOARD FOUND · 20 ↑ UPRIGHT**, then one **START PLAY**
  tap reached **STARTING LIVE PLAY** and **BOARD FOUND · WATCHING LOCALLY**. The old detector-gated
  setup loop was not observed.
- **Failed:** acquisition was still difficult/intermittent in practical use, and live analysis showed
  broad movement, a one-frame dart/flight hold, and competing/unmappable changes. Two later visible
  darts did not fill any DartCard.

The next remediation preserves PR #10's bounded handoff and changes the browser heuristic without
relaxing its score-safety gate:

- separates a red scoring bed from a warm orange cork/sisal single bed by requiring red-channel
  dominance, then holds a matching automatic fit through at most two isolated color dropouts while
  retaining the two-comparable-fit requirement;
- keeps the temporal flight envelope near the board for a front/near-centreline view and expands it
  only as fitted skew increases, rather than treating a large lower-room surround as dart geometry;
- distinguishes a broad stable-core movement from an outer-rim foreground disturbance, keeps the
  latter review-only, and rejects board-length connected components that cannot be a projected dart;
- samples at a 500 ms cadence to get a second settled observation sooner and surfaces **CHECK / ENTER
  SCORE** by an unsafe live message; and
- retains no automatic `MISS`, no arbitrary compact/equal-endpoint/near-wire/competing score, normal
  correction, and optional manual/advanced recovery without returning calibration to normal flow.

Focused synthetic regression coverage exists for each policy change, but the follow-up must be
reviewed, delivered from actual merged `main`, and retested on a direct iPhone before it can be
described as a device fix. See
[`15-browser-dart-field-remediation.md`](15-browser-dart-field-remediation.md).

## Validation baseline

Run from the repository root:

```bash
npm run verify
cd ml && PYTHONPATH=src python3 -m unittest discover -s tests -v
```

**Current remediation-branch result:** on 2026-09-07, `npm run verify` passed (including 43 web
tests), and the Python suite passed 12 tests. These are build/synthetic results, not physical-device
evidence.

`npm run verify` checks formatting, documentation links, workspace TypeScript typechecks, web/rules/
session/API tests, and the production web build. The web suite covers embedded-preview/HTTPS
permission diagnostics; synthetic red/green automatic board finding; red-surround/lopsided-branding
rejection; warm-cork separation; two-color-bull refinement; transient fit stability; homography and
optional recovery geometry; quality gates; board-face/stable-core support masking; skew-aware flight
envelopes; bounded translation/scale/rotation alignment; implausible foreground-shape rejection;
direct-entry candidate gating and compact/equal-width/near-wire abstention; exterior-flight `MISS`
rejection; and the bounded Start Play reference policy. The Python suite covers canonical geometry,
manifest/sidecar validation, synthetic generation, pose-quality heuristics, and a temporal baseline.
None of this is physical iPhone/Android score-accuracy evidence.

Useful local commands:

```bash
# Web prototype
npm run dev:web

# Development API (not production infrastructure)
npm run dev:api

# Validate a local Capture/Annotation file
cd ml && PYTHONPATH=src python -m darts180_vision.data_contract path/to/file.json

# Generate synthetic pipeline-test images only
cd ml && PYTHONPATH=src python -m darts180_vision.synthetic --output /tmp/darts-180-synthetic --count 20 --seed 42
```

## Immediate next work, in order

### P0 — delivery, legal, and safe field readiness

1. Obtain a fresh short-lived delivery credential only when needed, fetch actual merged `main`, then
   rebase/recreate the current remediation branch from it. Run the complete validation baseline,
   review the diff, push it, and open a new PR. Confirm Actions/Vercel separately where access
   permits.
2. Retest that PR's top-level HTTPS deployment directly on the reported iPhone setup before saying
   live detection works. Expected sequence: **Board Found** → one **Start Play** tap → **Starting
   Live Play** → **Watching Locally**, followed by a DartCard or explicitly held suggestion for one
   isolated settled dart before a second is thrown. Follow
   [`15-browser-dart-field-remediation.md`](15-browser-dart-field-remediation.md).
3. Test direct iOS and Android HTTPS browser permission, complete-frame capture, warm/standard
   color-board finding, steel/soft-tip interaction parity, lower-foreground behavior, conservative
   candidate abstention, correction, turn confirmation, optional recovery only on failure, and
   privacy behavior. Use **Camera diagnostics** only for consented failure reporting.
4. Obtain legal review for the new Darts 180 name. Earlier BullzEye material is historical and does
   not clear the current working name.
5. Approve consent, retention/deletion, secure intake, and privacy-review procedures before accepting
   any raw media. Browser-local downloads do not bypass this gate.

### P1 — measured single-camera alpha

1. Build a safe preferred-mount capture rig and collect consented board-focused captures across
   device, board, lighting, distance, angle, dart count, and failure slices.
2. Run secure intake, de-identification/review, independent annotation, deduplication, and leakage-
   safe split assignment. Keep sacred evaluation data non-synthetic and access-controlled.
3. Implement native AVFoundation/CameraX delivery behind the existing boundary; do not use a
   JavaScript frame loop for production inference.
4. Replace browser heuristics with trained pose, temporal, entry-point, and ambiguity models. Measure
   releases against held-out device/board slices before exposing an automatic proposal.

### P2 — connected product and reliability expansion

1. Replace in-memory storage with authenticated durable Postgres event storage and reconnect/sync
   conflict handling.
2. Add offline persistence, legs/sets, practice modes, statistics, accessibility/localization, and
   account-optional history.
3. Expand through measured support envelopes; investigate a second-phone mode only when evidence
   shows it improves difficult angles/occlusion.
4. Pursue third-party ecosystem integrations only through a documented sanctioned API or commercial
   partnership—never UI automation, traffic interception, or protocol emulation.

## Explicit non-claims

- Darts 180 does **not** currently have a trained or production auto-scoring model.
- Browser Camera Play is a fixed-camera red/green color fit plus frame-difference heuristic; it has
  no real-world accuracy proof and every score remains correctable.
- Camera Play, Capture Lab, and Annotation Lab do **not** upload raw media or establish training-data
  approval.
- Synthetic images, unit tests, and OpenCV baselines do **not** prove real-device accuracy.
- The development API is **not** deployable production backend infrastructure.
- The working name is **not** legally cleared.

## Change log

| Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-07 | [PR #10](https://github.com/nick-kuhle/darts-180/pull/10) merged. Its direct iPhone retest physically confirmed **Start Play → Watching Locally**, but board acquisition remained intermittent and live analysis recorded none of the shown darts. The next remediation retains the handoff, separates warm cork from red beds, latches brief comparable-fit dropouts, tightens near-centreline flight support, distinguishes stable-core motion from rim foreground, caps implausibly long shapes, shortens polling, and requires another direct-device retest. |
| 2026-09-07 | PR #9 merged. A subsequent direct iPhone report showed strong automatic board finding but a normal Start Play loop driven by detector-based clear-board setup. [PR #10](https://github.com/nick-kuhle/darts-180/pull/10) replaced it with a fixed 650 ms fresh-reference handoff, preserved live scoring safety gates, removed normal-mode calibration-looking overlays/telemetry, and added focused reference-policy tests.                                                                                                                                     |
| 2026-09-07 | PR #8 addressed post-PR #7 dart-resolution failures with stronger board-color fitting, board-face-only temporal support, bounded similarity alignment, direct-entry-only automatic scoring, and compact/ambiguous/exterior-`MISS` abstention.                                                                                                                                                                                                                                                                                                                    |
| 2026-09-07 | Camera Play introduced normal no-calibration automatic color-board finding, optional visual-guide/advanced recovery, browser-local privacy behavior, and in-camera correction/turn flow.                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-09-07 | Foundation work added deterministic X01/Cricket rules, Expo/web prototypes, capture/annotation contracts, development API, synthetic tools, deployment configuration, and private repository delivery.                                                                                                                                                                                                                                                                                                                                                           |
