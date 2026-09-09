# Web app and Vercel deployment

**Purpose:** deploy the web-first Darts 180 application through the existing Vercel project and URL,
without overstating the status of its camera scorer.

**Snapshot:** 2026-09-08 (America/Los_Angeles). This workspace has no configured Git remote, deployment
credential, or Vercel project connection. No GitHub Actions result, deployed Function behavior, Deployment
Protection configuration, Blob/OIDC behavior, or real-device camera behavior has been verified here.

## What this web branch delivers

`apps/web/` remains a static React/Vite application with:

- interactive standard-board manual input, 501, Cricket, correction-aware DartCards, checkout hints, and
  visit history;
- **Live Scoring**, the only normal camera route, built around a browser-local learned-vision pipeline:
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
- a clearly separate guided **Data Lab** for separately consented blank-board and dart-test examples.
  An unchecked development collection agreement appears before camera controls; it records consent version/
  time and marks every completed browser record unreviewed. After label review, the app automatically sends
  the reviewed JPEG/manifest/annotation trio through a same-origin guarded Function to a private Vercel Blob
  store. It has no browser collection credential, local-download path, or manual per-record Save control.

The retired red/green color-fit and frame-difference Live Scoring components and scoring modules are no
longer reachable or bundled by the product route. Their historical failure record is retained in
[`15-browser-dart-field-remediation.md`](15-browser-dart-field-remediation.md); it must not be used to
restore live scoring behavior.

## Critical release boundary: the checked-in model is deliberately unavailable

`public/models/darts180-board-tip-v1.json` is an explicit schema-v2 unavailable placeholder. It names no ONNX
artifact or checksum and carries an intentionally impossible, disabled policy rather than production evidence.
Live Scoring can still request a direct browser camera preview, but it displays **Verified model package required**
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

| Vercel setting                       | Required value                                                                                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Root Directory                       | `apps/web`                                                                                                                                                                                       |
| Include files outside Root Directory | enabled                                                                                                                                                                                          |
| Install Command                      | `cd ../.. && npm ci`                                                                                                                                                                             |
| Build Command                        | `cd ../.. && npm run build --workspace=@darts-180/web`                                                                                                                                           |
| Output Directory                     | `dist`                                                                                                                                                                                           |
| Environment variables                | For the consent-gated development Lab: linked private Blob store (`BLOB_STORE_ID`) + exact server-only `DARTS180_CAPTURE_ACCESS_MODE=development-consent-v1`; never a `VITE_` Blob/auth variable |

The build emits a same-origin module Worker and ONNX Runtime Web's WASM asset. Both `vercel.json` files
therefore preserve the restrictive camera/privacy policy while explicitly permitting only what this runtime
needs:

- `Permissions-Policy: camera=(self), microphone=(), geolocation=()`;
- `media-src` for same-origin, `blob:`, and `mediastream:` browser camera presentation;
- `connect-src 'self'` for the manifest/model/WASM fetches and the same-origin private Data Lab
  Function (the browser does not connect directly to a Blob hostname);
- an SPA fallback that explicitly excludes `/api/*`, so `/api/capture-ingest` remains a Vercel
  Function rather than being rewritten to `index.html`;
- `worker-src 'self' blob:` for the module Worker and any runtime helper worker; and
- `script-src 'self' 'wasm-unsafe-eval'` for WebAssembly compilation. This is **not** general
  `'unsafe-eval'` and does not allow remote scripts.

The deployed runtime currently bundles approximately 27.8 MB of uncompressed ONNX Runtime WASM. Treat
first-load performance, cache behavior, memory, thermal state, and CSP behavior as real-device acceptance
criteria, not merely a Vite build success.

## Consent-gated development Data Lab storage

The app-root and repository-root configurations both include the same `api/capture-ingest` Function so the
existing Vercel project can keep its current Root Directory configuration. It is not a public read endpoint:
it accepts only completed-review bounded JPEG/JSON assets, writes them to a **private** Blob store, and
exposes no browser read/list/download route. It reports ready only when the exact development-consent
acknowledgement and linked `BLOB_STORE_ID` are present; otherwise the Lab fail-closes and disables camera
capture.

`DARTS180_CAPTURE_ACCESS_MODE=development-consent-v1` deliberately supports the requested small-scale,
consent-gated development intake without paid All Deployments protection. The browser sends no Blob
credential, collection key, or `Authorization` header. Its checkbox is not authentication: records remain
`consented-development-unreviewed`, and a restricted operator must screen them before model use. Retain or
change Vercel Authentication separately and deliberately; it is not replaced by the checkbox.

Follow [`20-private-capture-lab.md`](20-private-capture-lab.md) for exact setup, risk boundary, retry
behavior, controlled retrieval, synthetic-data separation, and limitations. Do not place a Blob credential,
protection bypass secret, or any auth value in a `VITE_` variable, repository, browser storage, or support
message.

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
when allowed, the local preview appears, and Live Scoring accurately reports that it will not guess a score.
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
[`14-browser-camera-field-test.md`](14-browser-camera-field-test.md): start camera, let Live Scoring find
complete geometry automatically, arm the visit with an empty board, throw normally, and use DartCard
correction for a review or abstention. Test every supported board/phone/environment slice against independent
ground truth. Keep camera frames local unless a participant separately opts into the governed research
program.
