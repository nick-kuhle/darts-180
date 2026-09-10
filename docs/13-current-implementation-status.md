# Darts 180 — current implementation status

**Snapshot date:** 2026-09-09 (America/Los_Angeles)<br />
**Product name:** Darts 180 — working name; trademark and commercial legal clearance remain required<br />
**Repository:** private Darts 180 repository; this workspace intentionally persists no remote or credentials<br />
**Current delivery state:** the existing Vercel production app has a connected private Blob collector and
can automatically save consented Data Lab triplets; no learned model artifact is installed yet<br />
**Delivery order:** web app first; native reuse follows only after validated web contracts/data/geometry

This document separates implemented code, an artifact-ready camera path, and claims that evidence does
**not** support. It is not a marketing status page.

## Current decision

The previous browser color/frame-difference path failed to record a visibly embedded dart and remains
retired. It must not be revived to make the app appear to score. The replacement strict browser
production path remains a learned semantic model boundary and intentionally has an unavailable manifest
until an attested release artifact exists.

The product requirement now also permits a useful **development-stage** path before release-grade
accuracy: a real local learned detector may automatically find the board and a dart-entry point, calculate
a deterministic standard-board score, and fill an editable DartCard. The result must never auto-record or
pretend to be a calibrated production score. A player must explicitly confirm it as shown or correct it
before a development visit can be recorded.

The reviewed DeepDarts-style five-class data shape supports that specific development route: class 0 is a
dart point and classes 1–4 are ordered board anchors. It cannot be silently squeezed into the existing
nine-landmark/quality production ABI. The implementation therefore adds a separate versioned five-point
contract rather than weakening production gates.

Read [`18-development-five-point-scorer.md`](18-development-five-point-scorer.md) for the exact boundary
and tester workflow.

## Delivered locally in this branch

| Area                          | Implemented now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Boundary / evidence still missing                                                                                                                                                                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production ABI                | The existing schema-v2 `darts180-board-tip-v1` parser, Worker, attestation verifier, quality/uncertainty logic, and production-only auto-record gate remain intact.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | The checked-in production manifest remains unavailable; no production ONNX, attestation, evaluation, or auto-record release exists.                                                                                                                                                                                                      |
| Development manifest          | `developmentVision/modelManifest.ts` accepts only `darts180-deepdarts-yolo`, schema 1, `releaseStage: development`, same-origin hashed ONNX, raw five-class output, immutable class IDs, declared stretch preprocessing, and bounded NMS/tracker policy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | No actual manifest/ONNX bytes are checked in. A malformed/remote/changed-class package cannot run.                                                                                                                                                                                                                                       |
| Local YOLO Worker             | An isolated Worker verifies the development ONNX SHA-256, tries WebGPU then local WASM, stretches RGB camera frames exactly as declared, accepts only raw YOLOv8 `[1,9,N]`/`[1,N,9]`-style output, and runs class-aware NMS locally.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | A real export must still prove it initializes on target Safari/Chrome devices and returns the declared raw output. No hosted inference is used.                                                                                                                                                                                          |
| Automatic geometry            | Four learned semantic anchors solve a projective map; class-0 learned dart centers map through it; `@darts-180/rules` calculates ring/sector/score. The source-to-standard `−9°` adapter has synthetic arithmetic fixtures.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | The adapter needs independent real-throw validation across board/camera variation. Four anchors do not provide production's redundant learned quality/landmark validation.                                                                                                                                                               |
| Live Scoring UX               | `CameraPlayRouter` selects the five-point path only when the production artifact is unavailable and a valid development package is installed. The path has no normal-flow manual calibration, reference capture, upload, or tip click. It opens every model result as `review`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Until a real artifact is installed, public Live Scoring correctly stays on the unavailable production path. No live score claim is justified yet.                                                                                                                                                                                        |
| Human correction              | Score Review now has **Confirm as shown** in addition to board correction. Development proposals block visit confirmation until the player explicitly confirms/corrects every one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | This is a tester safeguard, not independent ground truth. Player corrections need consent, QA, and independent labeling before model training/evaluation.                                                                                                                                                                                |
| Private collection boundary   | Live Scoring has no browser download/export loop for evidence. Data Lab is the only contributor collection path: after consent and completed review, it saves a bounded JPEG/manifest/annotations triplet through the same-origin Function to private Blob.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | A restricted storage operator must still review private records before any local training handoff. The collector is not automatic model training, authentication, or proof of label quality.                                                                                                                                             |
| Guided own-throw bootstrap    | The visible app separates **Live Scoring** from one consent-gated **Data Lab**. An unchecked entry agreement explains automatic private collection for product/model improvement; its version/time and `consented-development-unreviewed` status join each completed board-only record. After per-still and label review, Data Lab automatically saves the JPEG/manifest/sidecar trio through a credential-free same-origin private Blob Function. The deployed private collector is configured and has received the first real captures. `local_five_point_dataset.py` checks pairs/dimensions/profile/consent, accepts explicit blank-board anchor-only records, rejects duplicates, and creates session-disjoint numeric YOLO splits.                                                                            | The initial roughly 16 captures across 3 sessions meet a workflow dry run, not a broadly useful camera-model dataset. The agreement is not application authentication, identity verification, independent review, or automated training admission; manual Data Lab steps are collection tooling only, never a normal Live Scoring setup. |
| Data Lab learned label review | After a held still is captured, Data Lab loads only the optional same-origin, hash-verified five-point development manifest and runs one Worker-owned inference pass over that still; the per-still privacy/rights confirmation still gates the review and private save. Its adapter can prefill only declared class-1–4 anchors above the manifest floor and class-0 tips mapped through a complete learned pose. Markers remain editable: anchors/tips can be moved, false tips removed, and missed tips added; the existing review checkbox remains the explicit confirmation before the automatic private save. Stale/cancelled requests dispose the Worker and cannot update a retaken still. The sidecar records final point sources plus a versioned model/SHA/data-kind/backend audit hint when a pass ran. | No package is currently installed, so the code transparently enters the pre-existing manual path rather than deriving anchors/tips from board geometry, image thresholds, or metadata. Browser-side source metadata is an audit clue only; restricted review remains the trust boundary before data admission.                           |
| Training handoff              | `mixed_five_point_dataset.py` can re-audit and mix restricted-operator-reviewed real compiled data with procedural synthetic training scenes while preserving real-only validation/test splits and explicit non-automatic-admission provenance. `deepdarts_yolo_train.py` requires that mixed report when creating a `mixed-synthetic-and-real` development manifest, audits the compiled export, trains from a supplied local YOLO checkpoint, exports raw ONNX, hashes it, and writes a development-only manifest.                                                                                                                                                                                                                                                                                                | No model has run or been installed. The user must still approve exact private records, validate their labels, provide a lawful hash-locked starting checkpoint, and review aggregate data/phone behavior before any artifact installation.                                                                                               |
| Private Actions handoff       | `.github/workflows/private-development-model.yml` is manual-only and protected-environment scoped. It uses an exact secret record-ID allow-list and direct private Blob `get()` calls for only the expected JPEG/manifest/annotation triplets—never a public Vercel read route or a store-wide list. Raw data and all intermediate model material remain in a temporary runner directory; an always-run cleanup removes it. The artifact contains only an aggregate review record and, after a separate `train` dispatch with a reviewed checkpoint URL/SHA/licence ID, the development ONNX plus its manifest.                                                                                                                                                                                                     | It has not been dispatched, no Blob secret/record allow-list has been configured, no raw records have left private storage, and no model/checkpoint has been downloaded. This GitHub Actions option does not change the private Data Lab browser surface or authorize deployment.                                                        |
| CI artifact verification      | `verify:model-artifact` continues to verify production packages and now also hashes a present optional five-point development ONNX/manifest without weakening production checks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Hash integrity says nothing about accuracy, provenance approval, real-device compatibility, or production readiness.                                                                                                                                                                                                                     |

## Current artifact and deployment status

- **No browser ONNX model is installed.** The supplied representative DeepDarts image/label pair remains
  a reviewed sample, not a trainable corpus or functioning detector.
- **No Roboflow hosted inference, tokenized URL, API key, or credential is used.** Camera frames remain
  local to the browser Worker.
- **The existing Vercel production URL has been redeployed with the repaired intake Function.** Its
  connected private Blob store and exact `DARTS180_CAPTURE_ACCESS_MODE=development-consent-v1` now allow
  consented Data Lab triplets to save. This is the requested consent-gated development mode, not an
  authentication claim, and it does not grant public Blob reads or automatic training admission.
- **No production behavior was relaxed.** A future development package is review-only and only wins the
  router when production has no runnable artifact.

## Validation status for this local change

The revised local change has passed the following as of this snapshot:

```text
npm run verify
# Prettier; 34-document link check; all TypeScript workspace typechecks;
# unavailable-production-model verifier; 49 web + 25 rules + 6 vision-session + 2 API tests;
# 7 private-Blob handoff Node tests + 2 aggregate-summary Python tests; Vite production build

cd ml && PYTHONPATH=src python3 -m unittest discover -s tests -v   # 39 tests
npm audit --omit=dev --audit-level=high
# no high/critical findings; npm still reports 10 moderate transitive uuid findings through Expo/xcode
```

A built-browser identifier scan passed: no Blob token/store ID/OIDC token, server-only access-mode
environment name, retired collection-key header, or `@vercel/blob` identifier appears in the Vite browser
assets; the expected same-origin `/api/capture-ingest` route and optional development-manifest path each
appear once. No forced `npm audit fix` is planned without a compatibility review because npm previously
proposed a breaking Expo downgrade for the existing moderate advisory chain. Ruff is not installed in this
validation environment, so its full-tree check was not rerun here; prior whole-tree output has only
pre-existing unrelated items (`hashlib` unused in `synthetic_five_point_dataset.py` and two `SIM117`
suggestions in existing test files). This update adds a dependency-free aggregate-only Python review-summary
writer plus two focused tests; its raw-record retrieval boundary is covered by seven Node tests without a
Blob credential or network call.

The browser tests cover development-manifest rejection, raw YOLO layout decoding/stretch-coordinate
restoration/class-aware NMS, the source-compatible rim-anchor orientation arithmetic, real-detector-only
suggestion requirements (including confidence floors, no fallback anchors, complete-pose tip withholding, and
the three-tip review limit), mandatory `review` disposition, optional development-package hash verification,
and the Data Lab private-intake fail-closed exact-mode/store configuration, consent timestamp/admission
provenance, same-origin credential-free request, bounded body, immutable private-write, automatic-review-save
regression, learned-still lifecycle/cancellation wiring, and sanitized-error boundaries. The Python tests cover development manifest creation, audit gates,
session ID validation, local JPEG/sidecar-to-YOLO compilation with duplicate/wrong-profile rejection, explicit
blank-board anchors, corpus-wide dart-label requirements, the external-only synthetic five-point builder,
and aggregate review-summary refusal of synthetic evaluation contamination. The new Node tests prove that the
private retrieval accepts only an exact allow-list and the three fixed asset paths, rejects mismatched
provenance/oversized assets/repository output, and removes a failed partial staging directory—without a Blob
credential or network call. Rust/native code is unchanged; Cargo is not available in this environment for an
additional native check.

## Explicit non-claims

- Darts 180 does **not** currently have a lawful trained production dartboard/dart-tip model.
- Darts 180 does **not** currently have a local development ONNX artifact, so no deployed camera currently
  proposes a real score from this new path.
- A static score, one-image model, frame-difference detector, raw color threshold, or manually injected
  label is not a substitute for the required learned dart/anchor detections.
- The `−9°` source-frame adapter is a documented development hypothesis with fixture coverage, not a
  released geometry invariant or performance claim.
- Browser unit tests/builds and synthetic geometry do not demonstrate real phone accuracy, latency, battery,
  thermal behavior, soft-tip coverage, or robustness to all angles/light/boards.
- A completed private Data Lab record is not automatically a valid training label, model package, or sacred
  evaluation example.

## Next gates, in order

1. **Run the protected data-preparation handoff.** Configure the `private-model-build` GitHub Environment
   with a private Blob credential and an exact owner-approved `record_...` allow-list, then manually dispatch
   `Private development model build` in `prepare` mode. It compiles the roughly 16 approved captures from
   three setup sessions and creates only a short-lived aggregate review record. Do not send credentials, raw
   archives, or media in chat/Git, and do not add a public Blob reader.
2. **Review and mix without contaminating the real exam.** The workflow deterministically generates the
   external-only procedural five-point bootstrap and uses `mixed_five_point_dataset.py` to place synthetic
   scenes in training only while retaining real-only validation/test sessions. Do not call synthetic metrics
   real-device evidence.
3. **Train/export and inspect an editable development artifact.** After the aggregate preparation result is
   accepted, supply a lawfully reviewed, hash-locked direct HTTPS checkpoint with a non-secret licence review
   ID and manually dispatch `train` mode. Inspect ONNX input/output names/shapes, SHA-256, model size, and
   actual device initialization. The first model may make only editable suggestions.
4. **Install and phone-test only the development package.** Place the reviewed ONNX + schema-1 manifest through
   the controlled deployment workflow, run full verification, then use the existing Vercel project for an
   explicitly labelled development retest. Data Lab will then prefill its editable local anchor/tip review
   from each held still; normal Live Scoring will find anchors/tips without manual point taps and open each
   proposed score for correction.
5. **Grow a balanced real training/evaluation campaign.** Build roughly 200–300 clearly labeled darts across
   10+ setup sessions before treating a trained artifact as useful. Preserve later, untouched whole real
   sessions for honest testing; a 1,000-throw campaign must be diverse rather than T20 repetition.
6. **Promote only through the separate production gates.** Add real redundant quality/uncertainty evidence,
   locked independent evaluation, a reviewed ABI/artifact/attestation, and browser field proof before any
   production auto-recording claim. Native delivery remains after those web contracts are validated.
