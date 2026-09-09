# Darts 180 — current implementation status

**Snapshot date:** 2026-09-08 (America/Los_Angeles)
**Product name:** Darts 180 — working name; trademark and commercial legal clearance remain required
**Repository:** `https://github.com/nick-kuhle/darts-180.git` (private)
**Reported product base:** `0e4fbe24b51584f8c8317c3f07cda1550ae9b4d6` (PR #11 merge); this
workspace currently has no configured `origin`, so retained remote refs are not treated as fresh verification
**Active product-delivery branch:** `feat/web-first-learned-autoscoring`
**Delivery PR:** [#12 — ready for review](https://github.com/nick-kuhle/darts-180/pull/12)
**Active research branch:** `research/deepdarts-yolov8-evaluation` (local, non-production, not deployed)
**Delivery order:** web app first; native mobile reuse follows only after web evidence

This document separates code that exists, code that is safe to deploy, and claims that evidence does **not**
support. It is not a marketing status page.

## Current decision

The direct post-PR #11 iPhone retest found that the old browser color/frame-difference path could reach
watching state but failed to record a visibly embedded dart. The private screens did not provide ground truth,
training consent, or an accuracy benchmark and were deleted. The correct conclusion is that the old perception
method is unsuitable—not that the rules engine, correction UX, local-first privacy design, or product shell
should be discarded.

The production route has therefore been replaced architecturally with a **web-first learned semantic pipeline**.
The retired color/connected-component scorer, its Camera Play components, and its scoring modules have been
removed from the web application. Its history remains documented only as a failure record; it must never be
reintroduced to make live scoring appear to work.

A DeepDarts YOLOv8 v2 public-data lead is now conditionally admitted for isolated research intake. Its official
source dataset metadata identifies CC BY 4.0, and its likely five-class structure is one dart point plus four
ordered board-calibration anchors. It remains a data-only candidate: the class mapping needs visual confirmation,
no weights or browser artifact have been acquired, its four-anchor output cannot be silently substituted for the
nine-landmark production contract, and no live behavior changes. See
[`research/2026-09-deepdarts-yolov8-candidate.md`](research/2026-09-deepdarts-yolov8-candidate.md).

## Delivered in the active branch, not yet merged/deployed

| Area                   | Implemented now                                                                                                                                                                                                                                                                                                                                                                      | Boundary / evidence still missing                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared contracts       | `@darts-180/contracts` now defines all nine named full-board landmarks, source-frame dart-tip uncertainty/occlusion, learned quality, schema-v2 model metadata, release evidence, and explainable `auto-score` / `review` / `abstain` proposals.                                                                                                                                     | Contract tests demonstrate types/semantics, not a trained model. Native adapters must preserve the semantic boundary and cannot add a competing score decoder.                                |
| Manifest/release gate  | The browser accepts only same-origin non-traversing paths, verified lowercase SHA-256 values, complete calibrated pose/quality/decision policy, and production provenance/evaluation/release evidence. CI verifies exact ONNX and public-attestation hashes plus their identity and complete decision-policy binding.                                                                | The checked-in manifest is deliberately `unavailable`; no ONNX artifact, approved provenance, held-out evaluation, attestation, or auto-record release exists.                                |
| Browser Worker runtime | `vision.worker.ts` owns ONNX Runtime Web initialization, manifest re-validation across the Worker boundary, ONNX and production-attestation SHA-256 verification/binding, exact RGB letterbox preprocessing, WebGPU-first/WASM fallback, strict tensor decoding, serialized requests, bitmap/session cleanup, and bounded user-safe errors.                                          | A built Worker is not proof that a production model runs successfully on Safari/Chrome hardware. Model compatibility, CSP, latency, memory, heat, and behavior still require device evidence. |
| Learned geometry       | Four learned named doubles solve the oriented homography; the bull and four outer cardinal landmarks independently validate it. Learned tip uncertainty maps into canonical millimetres; deterministic `@darts-180/rules` alone maps that point to ring/segment/score.                                                                                                               | No trained landmark or tip predictor exists. Geometry tests use synthetic values only.                                                                                                        |
| Decision safety        | Proposal code models deterministic quadrature alternatives, preserves wire uncertainty, applies manifest-calibrated pose/quality/occlusion/posterior/**temporal** gates, clears temporal tracks on lost admission, sends unapproved models to review, and never auto-records a predicted `MISS`.                                                                                     | Calibration values are intentionally safe placeholders until fit and approved on a locked field evaluation set.                                                                               |
| Camera Play UX         | The new normal web route uses `getUserMedia`, automatic full-board checks, a non-interactive geometry overlay, low-res timing-only event association, high-res post-impact Worker bursts, auto-clear checks, DartCard review, and ordinary manual correction. It exposes no normal-flow guide fitting, named-point clicks, reference capture, analysis button, upload, or tip click. | With the unavailable manifest, it truthfully opens a camera preview and records **no** score. It is not yet a functional trained scorer.                                                      |
| Deployment/CSP         | Root and app-root Vercel config preserve the existing project shape and add narrowly scoped Worker/WASM CSP directives verified by tests. The follow-up is published as draft PR #12.                                                                                                                                                                                                | Vercel deployment/header status remains unverified; this draft deliberately must not promote the unavailable model to production.                                                             |

## Previously merged foundation

`main` contains the playable 501/Cricket product shell, deterministic standard-board/X01/Cricket rules,
manual correction, local Capture/Annotation tools, a development Fastify API, native/Rust/Python seeds,
Vercel configuration, and historical PR #1–#11 work. The user reports PR #11 merged and closed; the merge base
was verified by authenticated Git fetch. GitHub Actions/check-run reads and Vercel production status have not
been verified from this environment.

## Validation status

The current schema-v2 release-hardening revision passed its final local pre-commit gate: `npm ci`, Prettier,
documentation links, all workspace TypeScript checks, explicit unavailable-manifest verification, 28 web tests,
25 rules tests, six vision-session tests, two API tests, and a production web build (including same-origin Worker
and WASM assets). It also passed the 12-test Python ML/data/geometry suite, Rust `cargo fmt --check` plus six
Rust unit tests, and `git diff --check`. The production dependency audit passes the configured high/critical
threshold but still reports 10 moderate Expo-tooling transitive findings; its force fix proposes a breaking Expo
downgrade and has not been applied. Passing build/unit tests mean only that the implementation is internally
consistent; they do not demonstrate a dart score from a real phone.

Run from repository root:

```bash
npm run format:check
npm run docs:check
git diff --check
npm run verify:model-artifact --workspace=@darts-180/web
npm run verify
cd ml && PYTHONPATH=src python3 -m unittest discover -s tests -v
cd .. && cargo fmt --manifest-path native/vision-core/Cargo.toml -- --check
cargo test --manifest-path native/vision-core/Cargo.toml
```

## Explicit non-claims

- Darts 180 does **not** currently have a lawful trained production dartboard/dart-tip model.
- The checked-in web release does **not** claim that it scores a physical dart; the unavailable manifest blocks it
  from guessing a score.
- Browser unit tests, synthetic geometry, model-free Worker builds, Vercel config checks, and vendor marketing
  are not direct-device accuracy evidence.
- A single camera cannot observe a fully hidden tip or recover information outside its frame; quality admission,
  reposition/second-view guidance, review, and abstention are required behavior, not defects to suppress.
- Radar, room audio, piezo, and IMU may help order/timestamp an event but cannot localize its planar score.
- No raw camera image is uploaded by normal Camera Play. Any research capture requires separate consent,
  retention, deletion, access, and provenance controls.
- The current Fastify API and working product name are not production-cleared infrastructure or branding.

## Next gates, in order

1. **Data/legal gate:** approve consented capture protocol, data registry, independent ground truth, retention,
   licence/provenance review, and jurisdiction-specific IP/FTO review.
2. **Model gate:** train/export a legal browser-compatible named-landmark/tip/quality model; supply exact output
   contract, SHA-256, model card, calibration, and a non-production evaluation manifest first.
3. **Evaluation gate:** lock a leakage-resistant real-device holdout partitioned by site, board, device, lighting,
   camera pose, point type, dart count, wire distance, and occlusion. Measure per-dart recall, exact score,
   unsafe false-auto rate, review/abstain rate, latency, memory, battery, and thermal behavior.
4. **Release gate:** promote only when the model's documented held-out results support the manifest decision
   policy; then deploy through the existing Vercel project/URL and retest on direct HTTPS Safari/Chrome tabs.
5. **Native second:** reuse the locked contracts, data program, geometry, model outputs, and decision policy in
   native capture runtimes. Add fixed multi-camera hardware only after formal FTO and safety design review.

See [`16-camera-autoscoring-reset.md`](16-camera-autoscoring-reset.md) for the research rationale and
[`12-web-demo-and-vercel.md`](12-web-demo-and-vercel.md) for deployment requirements.
