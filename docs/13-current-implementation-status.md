# Darts 180 — current implementation status

**Snapshot date:** 2026-09-07 (America/Los_Angeles)<br />
**Product name:** Darts 180 — working name; legal clearance is still required<br />
**Repository target:** `https://github.com/nick-kuhle/darts-180.git` (private)<br />
**Status:** foundation, playable scoring prototype, local data-tooling slice, and controlled
browser-camera field-test workflow complete; no production auto-scoring claim.

This is the operational source of truth for what exists now versus what is intentionally deferred.
It complements the longer product/design specifications rather than changing their safety gates.

## Completed and in the repository

| Area                     | Delivered now                                                                                                                                                                                                                                                                                                                         | Important boundary                                                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git / delivery           | Private GitHub `main`, merged initial foundation [PR #1](https://github.com/nick-kuhle/darts-180/pull/1) and browser field-test [PR #2](https://github.com/nick-kuhle/darts-180/pull/2), CI workflow, lint/format/type/test/build commands, issue templates, contribution/security notices, root and `apps/web` Vercel configurations | Open/review the prepared `vercel-camera-deployment` branch, verify its GitHub Actions result, configure branch protections/required review policy, and import only `apps/web` as the Vercel project.                                      |
| Web product              | Responsive Vite/React playable 501 and Cricket scorer, standard interactive board, manual corrections, checkout hints, visit history, and transparent simulated camera-review states                                                                                                                                                  | Simulated camera cards are UX evidence only, not vision inference.                                                                                                                                                                        |
| Browser Camera Score     | HTTPS browser camera, embedded/insecure/permission diagnostics, manual four-double-bed calibration, transparent size/perspective/focus setup gate, volatile clear-board reference, temporal elongated-change/endpoint proposals, manual tip picker, deterministic score mapping, DartCard handoff, no-media debug export              | Fixed-mount heuristic only; it is not a trained entry-point model, real-world accuracy evidence, or a silent auto-score path. Direct top-level HTTPS browser testing is required; Arena/in-app previews cannot request camera permission. |
| Browser Capture Lab      | Click-gated rear-camera preference, video-only/no-audio request, browser-local still preview, frozen metadata, per-still privacy attestation, paired JPEG/manifest downloads                                                                                                                                                          | No upload/API/account/analytics path exists. Attestation is not automatic privacy detection or consent approval.                                                                                                                          |
| Browser Annotation Lab   | Local JPEG + exact manifest filename pairing, four named double-bed anchors, image→canonical homography, up to three visible-tip labels, deterministic zone/wire-margin output, local sidecar download                                                                                                                                | It is a narrow human-labeling aid. It has no zoom, landmark model, dual-label merge, image hash, or automated occlusion resolution.                                                                                                       |
| Deterministic game logic | Standard board geometry, X01 straight/double/master in/out, Cricket marks/scoring, checkout routing, correction-aware event projection                                                                                                                                                                                                | X01 and Cricket are the implemented product modes; broader game modes remain planned.                                                                                                                                                     |
| Session policy           | Testable pose-quality, settle-window, three-slot, review-routing, and board-clear state machine                                                                                                                                                                                                                                       | Native runtime must supply real tracks and candidates.                                                                                                                                                                                    |
| Development API          | Fastify game creation/snapshot endpoints, idempotent event append, correction-aware X01/Cricket projection, event catch-up endpoint, WebSocket fan-out, OpenAPI contract                                                                                                                                                              | In-memory only, unauthenticated, not durable, and unsafe to expose as production infrastructure.                                                                                                                                          |
| ML / vision tooling      | Canonical Python geometry, capture/sidecar validator CLI, deterministic synthetic scenes, OpenCV pose/quality baseline, fixed-camera before/after temporal baseline, debug output                                                                                                                                                     | These are inspectable pipeline baselines and synthetic tests—not trained models, real-world accuracy results, or product auto-scoring.                                                                                                    |
| Native / infra seeds     | Expo product shell, Darts 180 launcher/splash assets, real camera-preview setup screen, Rust geometry seed, Postgres starting migration, Docker Compose development dependencies                                                                                                                                                      | No production native frame processor, authentication, persistent event-store adapter, cloud capture path, or model artifact exists.                                                                                                       |

## Current validation baseline

The following pass in the current workspace after the Darts 180 rename:

```bash
npm run verify
cd ml && PYTHONPATH=src python3 -m unittest discover -s tests -v
```

`npm run verify` checks formatting, documentation links, all workspace TypeScript typechecks, web/rules/session/API tests, and the production web build. The web suite includes embedded-preview/HTTPS permission diagnostics, synthetic clear-board/no-change, elongated-change endpoint, manual-tip mapping, resolution-change, motion/hand rejection, setup-gate tests, and root/app-root Vercel configuration checks for the browser field-test scorer. The Python suite covers canonical geometry, manifest/sidecar validation, synthetic generation, pose-quality heuristics, and the temporal baseline. Rust parity remains configured for GitHub Actions; Cargo is not available in this local environment.

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

### P0 — repository, legal, and safe field readiness

1. [Initial foundation PR #1](https://github.com/nick-kuhle/darts-180/pull/1) and
   [browser Camera Score PR #2](https://github.com/nick-kuhle/darts-180/pull/2) are merged. Open
   and review the prepared `vercel-camera-deployment` branch, verify its GitHub Actions result, then
   enable branch protection and required-review policy. `CODEOWNERS` temporarily points at
   `@nick-kuhle` until an organization/team structure exists.
2. Import the repository into Vercel and manually test the deployed site on actual iOS and Android
   HTTPS browsers: camera permission, four-double-bed calibration, clear-board reference, one-dart
   temporal proposal, visible-tip fallback, DartCard correction, still capture, privacy reset,
   JPEG/manifest pairing, Annotation Lab import/pairing, and sidecar download. Follow
   [`docs/14-browser-camera-field-test.md`](14-browser-camera-field-test.md).
3. Obtain legal review for the **new Darts 180 name**. Earlier BullzEye search material is historical
   only and must not be treated as current-name clearance.
4. Replace placeholder mobile application identifiers (`com.yourcompany.darts180`), create an EAS
   project, and establish Apple/Google signing ownership before an external native build.
5. Approve contributor consent, retention/deletion, secure intake, and privacy-review procedures
   before accepting any raw media. The local browser downloads do not bypass this gate.

### P1 — measured single-camera alpha

1. Build a safe preferred-mount capture rig and collect consented, board-focused real captures across
   device, board, lighting, distance, angle, dart count, and failure slices.
2. Run secure intake, de-identification/review, independent annotation, deduplication, and
   leakage-safe split assignment. Keep sacred evaluation data non-synthetic and access controlled.
3. Implement native AVFoundation/CameraX frame delivery and pose/quality tracking behind the existing
   native boundary; do not use a JavaScript frame loop for production inference.
4. Replace heuristics with trained pose, temporal, entry-point, and ambiguity models; measure every
   release against held-out slices before exposing a scoring proposal.
5. Replace the browser heuristic’s review candidates with ranked native-model candidates while
   retaining DartCard confirmation/correction and manual fallback whenever quality or uncertainty
   gates fail.

### P2 — connected product and reliability expansion

1. Replace the API's in-memory store with authenticated, durable Postgres-backed event storage and
   reconnect/sync conflict handling.
2. Add offline persistence, legs/sets, practice modes, statistics, accessibility/localization, and
   account-optional history.
3. Expand through measured support envelopes rather than marketing claims; investigate a second-phone
   mode only if data shows that it improves hard-angle/occlusion reliability.
4. Pursue DartCounter or other ecosystem integrations only through a documented sanctioned API or
   commercial partnership—never UI automation, traffic interception, or protocol emulation.

## Explicit non-claims

- Darts 180 does **not** currently have a trained or production auto-scoring model. The deployed
  browser scorer proposes fixed-camera frame-difference endpoints and always requires review.
- Camera Score, Capture Lab, and Annotation Lab do **not** upload raw media or establish
  training-data approval.
- Synthetic images and OpenCV baselines do **not** prove real-device accuracy.
- The development API is **not** a deployable production backend.
- The working name is **not** legally cleared.

## Change log

| Date       | Change                                                                                                                                                                                                                                                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-07 | Added an `apps/web` Vercel configuration, monorepo-root install/build commands, explicit shared-source setting guidance, dependency declarations, and configuration tests so the web app can be selected directly from Vercel’s monorepo directory picker.                                                                    |
| 2026-09-07 | Added embedded-preview/HTTPS/permission diagnostics for Camera Score and Capture Lab, explicit top-level Vercel mobile-test guidance, and a `mediastream:` CSP allowance.                                                                                                                                                     |
| 2026-09-07 | Added deployable browser Camera Score field-test workflow: fixed-camera setup, four-anchor homography, transparent setup gate, in-memory clear-board reference, temporal dart-shape endpoint proposals, manual visible-tip scoring, DartCard handoff, no-media debug record, synthetic algorithm tests, and field-test guide. |
| 2026-09-07 | Created private-repository bootstrap `main`, merged [initial foundation PR #1](https://github.com/nick-kuhle/darts-180/pull/1) and [browser field-test PR #2](https://github.com/nick-kuhle/darts-180/pull/2), and prepared the Vercel/mobile deployment update for separate review.                                          |
| 2026-09-07 | Working product name changed from BullzEye to Darts 180. Product copy, technical package scope, Python module, mobile identifiers, web file exports, docs, and deployment configuration were renamed. The prior-name market/name research was preserved but explicitly marked non-applicable to Darts 180 clearance.          |
| 2026-09-07 | Added local Annotation Lab, paired capture metadata, four-anchor homography utility/tests, local annotation runbook, stricter manifest/image pairing, and static deployment privacy headers.                                                                                                                                  |
| 2026-09-07 | Added deterministic X01/Cricket API projections and event catch-up, local Capture Lab, capture manifest/data-contract checks, synthetic scenes, pose-quality baseline, and temporal before/after baseline.                                                                                                                    |
