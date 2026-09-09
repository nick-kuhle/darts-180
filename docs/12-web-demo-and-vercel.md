# Web app and Vercel deployment

**Purpose:** deploy the web-first Darts 180 application through the existing Vercel project and URL,
without overstating the status of its camera scorer.

**Snapshot:** 2026-09-08 (America/Los_Angeles). The user reports PR #11 merged; authenticated Git fetch
verified `origin/main` at `0e4fbe24b51584f8c8317c3f07cda1550ae9b4d6`.
[Draft PR #12](https://github.com/nick-kuhle/darts-180/pull/12) contains the learned-runtime follow-up and
is not deployed. GitHub Actions/checks and Vercel deployment status remain unverified from this environment.

## What this web branch delivers

`apps/web/` remains a static React/Vite application with:

- interactive standard-board manual input, 501, Cricket, correction-aware DartCards, checkout hints, and
  visit history;
- **Camera Play**, the only normal camera route, built around a browser-local learned-vision pipeline:
  `getUserMedia` → timing-only low-resolution cue → high-resolution transferable frame → Worker-owned
  ONNX Runtime → learned landmarks/tip/quality → canonical board geometry → deterministic rules →
  auto-score / review / abstain proposal;
- a live, non-interactive geometry overlay after a complete board pose is found automatically—no guide
  handles, named-point selection, clear-frame capture, image download/upload, or visible-tip click in
  normal play;
- full same-origin model-manifest parsing, static model-byte SHA-256 verification, WebGPU-first session
  creation with single-threaded WASM fallback, serialized Worker requests, and resource cleanup;
- an inspectable **Learned Vision Diagnostics** page, which reports runtime/model gates but is not an
  alternate score engine; and
- local Capture and Annotation Labs for separately consented future research workflows.

The retired red/green color-fit and frame-difference Camera Play components and scoring modules are no
longer reachable or bundled by the product route. Their historical failure record is retained in
[`15-browser-dart-field-remediation.md`](15-browser-dart-field-remediation.md); it must not be used to
restore live scoring behavior.

## Critical release boundary: the checked-in model is deliberately unavailable

`public/models/darts180-board-tip-v1.json` is an explicit schema-v2 unavailable placeholder. It names no ONNX
artifact or checksum and carries an intentionally impossible, disabled policy rather than production evidence.
Camera Play can still request a direct browser camera preview, but it displays **Verified model package required**
and records no score. This is intentional.

A runnable artifact must be supplied only after all of the following are complete:

1. a lawful, provenance-reviewed and consented training-data record;
2. exported ONNX bytes matching the fixed `darts180-board-tip-v1` tensor semantics;
3. a lowercase SHA-256 of those exact bytes in the same-origin manifest;
4. model-card/release-policy values, including temporal association/settle gates, calibrated against a locked,
   held-out real-device evaluation set;
5. a production manifest with training-data, licence-review, evaluation timestamp, held-out evaluation, and
   approval identifiers; and
6. a separately hashed public release attestation that exactly binds those IDs, the artifact hash, output
   contract, and every decision-policy value. Only that parser- and verifier-gated state may set
   `autoRecordEnabled: true`.

A compiled Worker and passing unit tests do **not** prove physical dart recognition. No deployed copy should
be described as live or accurate camera scoring until an approved artifact has completed the device test
gates in [`16-camera-autoscoring-reset.md`](16-camera-autoscoring-reset.md).

## Vercel configuration and preserved deployment identity

Keep the existing Vercel project and production URL. Do **not** create a replacement project or point a new
URL at a different app. The repository has equivalent root and `apps/web` Vercel configurations so the
existing project must continue to use:

| Vercel setting                       | Required value                                         |
| ------------------------------------ | ------------------------------------------------------ |
| Root Directory                       | `apps/web`                                             |
| Include files outside Root Directory | enabled                                                |
| Install Command                      | `cd ../.. && npm ci`                                   |
| Build Command                        | `cd ../.. && npm run build --workspace=@darts-180/web` |
| Output Directory                     | `dist`                                                 |
| Environment variables                | none for the static web application                    |

The build emits a same-origin module Worker and ONNX Runtime Web's WASM asset. Both `vercel.json` files
therefore preserve the restrictive camera/privacy policy while explicitly permitting only what this runtime
needs:

- `Permissions-Policy: camera=(self), microphone=(), geolocation=()`;
- `media-src` for same-origin, `blob:`, and `mediastream:` browser camera presentation;
- `connect-src 'self'` for the manifest/model/WASM fetches;
- `worker-src 'self' blob:` for the module Worker and any runtime helper worker; and
- `script-src 'self' 'wasm-unsafe-eval'` for WebAssembly compilation. This is **not** general
  `'unsafe-eval'` and does not allow remote scripts.

The deployed runtime currently bundles approximately 27.8 MB of uncompressed ONNX Runtime WASM. Treat
first-load performance, cache behavior, memory, thermal state, and CSP behavior as real-device acceptance
criteria, not merely a Vite build success.

## Deploying the follow-up safely

1. Review the branch diff, including model-release gate changes; confirm that no model artifact or raw
   camera file has been added accidentally.
2. Run the verification commands below locally and in CI.
3. Create/review/merge the follow-up PR into the existing repository `main`.
4. Let the **existing** Vercel project deploy `main` using `apps/web`; preserve the current production URL.
5. Verify headers and the production build in the Vercel dashboard before inviting any direct-device tester.
6. Test a top-level HTTPS tab on actual iOS Safari and Android Chrome. An Arena preview iframe or an
   in-app browser cannot be used to validate a camera permission prompt.

Until a runnable model release exists, the only expected direct-device result is: camera permission works
when allowed, the local preview appears, and Camera Play accurately reports that it will not guess a score.
Do not turn that safety state into a fallback to the retired heuristic.

## Required verification

From the repository root:

```bash
npm run format:check
npm run docs:check
git diff --check
npm run typecheck
npm run test --workspace=@darts-180/web
npm run build --workspace=@darts-180/web
npm run verify:model-artifact --workspace=@darts-180/web
npm run verify
cd ml && PYTHONPATH=src python3 -m unittest discover -s tests -v
```

The web test suite covers manifest provenance/release rejection, automatic named-landmark pose mapping,
canonical uncertainty/ranking, near-wire review, unavailable-model abstention, timing-only event gating,
semantic tensor decoding, Worker-client protocol, normal-route retirement of the legacy scorer, and Vercel
Worker/WASM CSP requirements. These are engineering checks, not a real-device score-accuracy result.

## Direct-device model-release test protocol

After an approved model is installed, use the current flow in
[`14-browser-camera-field-test.md`](14-browser-camera-field-test.md): start camera, let Camera Play find
complete geometry automatically, arm the visit with an empty board, throw normally, and use DartCard
correction for a review or abstention. Test every supported board/phone/environment slice against independent
ground truth. Keep camera frames local unless a participant separately opts into the governed research
program.
