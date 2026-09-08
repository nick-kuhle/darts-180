# Darts 180 — current implementation status

**Snapshot date:** 2026-09-07 (America/Los_Angeles)<br />
**Product name:** Darts 180 — working name; legal clearance is still required<br />
**Repository target:** `https://github.com/nick-kuhle/darts-180.git` (private)<br />
**Status:** foundation, playable scoring prototype, local data tooling, and an experimental
browser-camera field-test workflow exist. [PR #8](https://github.com/nick-kuhle/darts-180/pull/8)
and [PR #9](https://github.com/nick-kuhle/darts-180/pull/9) are merged. [PR #10](https://github.com/nick-kuhle/darts-180/pull/10) is open and awaits a
fresh direct iPhone retest; no production auto-scoring claim.

This is the operational source of truth for what exists versus what is intentionally deferred. It
separates synthetic/build evidence from a physical-device result.

## Completed in `main`

| Area                 | Delivered now                                                                                                                                                                                                                                                                                                                                                                                        | Important boundary                                                                                                                                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git / delivery       | Private GitHub `main` includes foundations through [PR #1](https://github.com/nick-kuhle/darts-180/pull/1), Camera Play simplification / automatic board finding / reliability work through [PR #9](https://github.com/nick-kuhle/darts-180/pull/9), CI commands, issue/security/contribution material, and root plus `apps/web` Vercel configuration.                                               | Configure branch protections and review policy; import only `apps/web` as the Vercel project. A successful push/PR API operation does not itself prove GitHub Actions or Vercel deployment status.                                                               |
| Web product          | Responsive Vite/React 501 and Cricket scorer, accurate interactive standard board, manual correction, checkout hints, visit history, and transparent simulated camera-review states.                                                                                                                                                                                                                 | Simulated camera cards are UX evidence, not vision inference.                                                                                                                                                                                                    |
| Browser Camera Play  | HTTPS browser camera plus embedded/insecure/permission diagnostics; conventional red/green repeated double/treble-band finding with alternating-color and two-color-bull cross-checks; two comparable automatic fits; 20-up internal mapping; board-face temporal analysis with bounded similarity alignment; direct-entry automatic-score gating; correction and optional manual/advanced recovery. | Fixed-mount heuristic only. It is not a trained board/orientation or entry-point model, real-world accuracy proof, or silent production auto-score path. Automatic mode assumes level 20-up orientation; the same player flow does not branch on steel/soft tip. |
| Capture / annotation | Browser-local Capture Lab JPEG/manifest pairing, Annotation Lab local homography/sidecar workflow, privacy attestations, validators, and synthetic scenes.                                                                                                                                                                                                                                           | No raw-media upload, consented training corpus, or cloud data path.                                                                                                                                                                                              |
| Development API      | Fastify game creation/snapshot endpoints, idempotent event append, correction-aware X01/Cricket projection, event catch-up, WebSocket fan-out, and OpenAPI contract.                                                                                                                                                                                                                                 | In-memory, unauthenticated, and not production infrastructure.                                                                                                                                                                                                   |
| ML / native seeds    | Python geometry / data-contract / synthetic / pose-quality / temporal baselines; Expo product shell and camera preview; Rust geometry seed; Postgres/Docker starting infrastructure.                                                                                                                                                                                                                 | No trained production model, native high-rate frame processor, durable event store, authentication, or model artifact.                                                                                                                                           |

## Current follow-up — not yet physical-device proven

A new direct post-PR #9 iPhone report found strong automatic board detection but an unacceptable
normal-flow loop: Camera Play alternated clear-board/dart-like/broad-motion setup messages and
returned to **Start Play** on a steady, near-centreline, roughly one-yard mount.

[PR #10](https://github.com/nick-kuhle/darts-180/pull/10) replaces detector-driven setup with a bounded, deterministic Start Play handoff:

- automatic board finding remains two comparable red/green color fits;
- **Start Play** waits 650 ms, saves one fresh local reference, and enters live watching when a
  drawable browser frame exists; a missing frame retries at 250 ms up to four additional attempts, then returns control;
- setup-time localized/broad detector labels cannot reset board finding or hold the player in a
  baseline loop;
- live score acceptance remains conservative: no automatic `MISS`, compact/equal-endpoint/near-wire
  ambiguity remains held or unscored, and ordinary correction remains available;
- normal locked Camera Play removes calibration-looking rings, spokes, handles, and `20` control;
  detailed guide fitting remains optional recovery; and
- color/quality/detector telemetry is collapsed under explicit **Camera diagnostics**.

The PR includes focused regression coverage for the bounded reference policy. It must be reviewed
and physically retested before this can be described as a device fix. See [`15-browser-dart-field-remediation.md`](15-browser-dart-field-remediation.md).

## Validation baseline

Run from the repository root:

```bash
npm run verify
cd ml && PYTHONPATH=src python3 -m unittest discover -s tests -v
```

**Current branch result:** on 2026-09-07, `npm run verify` passed (including 37 web tests), and the
Python suite passed 12 tests. These are build/synthetic results, not physical-device evidence.

`npm run verify` checks formatting, documentation links, workspace TypeScript typechecks, web/rules/
session/API tests, and the production web build. The web suite covers embedded-preview/HTTPS
permission diagnostics; synthetic red/green automatic board finding; red-surround/lopsided-branding
rejection; two-color-bull refinement; fit stability; homography and optional recovery geometry;
quality gates; board-face support masking; bounded translation/scale/rotation alignment; direct-entry
candidate gating and compact/equal-width/near-wire abstention; exterior-flight `MISS` rejection; and
the bounded Start Play reference policy. The Python suite covers canonical geometry, manifest/sidecar
validation, synthetic generation, pose-quality heuristics, and a temporal baseline. None of this is
physical iPhone/Android score-accuracy evidence.

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

1. Run the complete validation baseline for the current branch, review the diff, push it, and open a
   new PR based on merged `main`. Confirm Actions/Vercel separately where access permits.
2. Retest that PR's top-level HTTPS deployment directly on the reported iPhone setup before saying the
   normal flow works. Expected sequence: **Board Found** → one **Start Play** tap → **Starting Live
   Play** → **Watching Locally**, without detector-gated setup messages or a return to Start Play.
   Follow [`15-browser-dart-field-remediation.md`](15-browser-dart-field-remediation.md).
3. Test direct iOS and Android HTTPS browser permission, complete-frame capture, color-board finding,
   steel/soft-tip interaction parity, conservative candidate abstention, correction, turn
   confirmation, optional recovery only on failure, and privacy behavior. Use **Camera diagnostics**
   only for consented failure reporting.
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

| Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-07 | PR #9 merged. A subsequent direct iPhone report showed strong automatic board finding but a normal Start Play loop driven by detector-based clear-board setup. [PR #10](https://github.com/nick-kuhle/darts-180/pull/10) replaces it with a fixed 650 ms fresh-reference handoff, preserves live scoring safety gates, removes normal-mode calibration-looking overlays/telemetry, adds focused reference-policy tests, and requires a new direct-device retest. |
| 2026-09-07 | PR #8 addressed post-PR #7 dart-resolution failures with stronger board-color fitting, board-face-only temporal support, bounded similarity alignment, direct-entry-only automatic scoring, and compact/ambiguous/exterior-`MISS` abstention.                                                                                                                                                                                                                    |
| 2026-09-07 | Camera Play introduced normal no-calibration automatic color-board finding, optional visual-guide/advanced recovery, browser-local privacy behavior, and in-camera correction/turn flow.                                                                                                                                                                                                                                                                         |
| 2026-09-07 | Foundation work added deterministic X01/Cricket rules, Expo/web prototypes, capture/annotation contracts, development API, synthetic tools, deployment configuration, and private repository delivery.                                                                                                                                                                                                                                                           |
