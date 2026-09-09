# Darts 180 — current implementation status

**Snapshot date:** 2026-09-08 (America/Los_Angeles)<br />
**Product name:** Darts 180 — working name; trademark and commercial legal clearance remain required<br />
**Repository:** private Darts 180 repository; no Git remote is configured in this workspace<br />
**Current local branch:** `feat/development-consent-synthetic-bootstrap`<br />
**Prior local implementation commit:** `e0d6a401c77354ff00af98f67c331d086885f41e`<br />
**Current delivery state:** revised local implementation only; no remote push, Vercel deployment, Blob store, raw-data upload, or model activation<br />
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

| Area                       | Implemented now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Boundary / evidence still missing                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production ABI             | The existing schema-v2 `darts180-board-tip-v1` parser, Worker, attestation verifier, quality/uncertainty logic, and production-only auto-record gate remain intact.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | The checked-in production manifest remains unavailable; no production ONNX, attestation, evaluation, or auto-record release exists.                                                                                                                                                                                                                                                                            |
| Development manifest       | `developmentVision/modelManifest.ts` accepts only `darts180-deepdarts-yolo`, schema 1, `releaseStage: development`, same-origin hashed ONNX, raw five-class output, immutable class IDs, declared stretch preprocessing, and bounded NMS/tracker policy.                                                                                                                                                                                                                                                                                                                                                                                          | No actual manifest/ONNX bytes are checked in. A malformed/remote/changed-class package cannot run.                                                                                                                                                                                                                                                                                                             |
| Local YOLO Worker          | An isolated Worker verifies the development ONNX SHA-256, tries WebGPU then local WASM, stretches RGB camera frames exactly as declared, accepts only raw YOLOv8 `[1,9,N]`/`[1,N,9]`-style output, and runs class-aware NMS locally.                                                                                                                                                                                                                                                                                                                                                                                                              | A real export must still prove it initializes on target Safari/Chrome devices and returns the declared raw output. No hosted inference is used.                                                                                                                                                                                                                                                                |
| Automatic geometry         | Four learned semantic anchors solve a projective map; class-0 learned dart centers map through it; `@darts-180/rules` calculates ring/sector/score. The source-to-standard `−9°` adapter has synthetic arithmetic fixtures.                                                                                                                                                                                                                                                                                                                                                                                                                       | The adapter needs independent real-throw validation across board/camera variation. Four anchors do not provide production's redundant learned quality/landmark validation.                                                                                                                                                                                                                                     |
| Live Scoring UX            | `CameraPlayRouter` selects the five-point path only when the production artifact is unavailable and a valid development package is installed. The path has no normal-flow manual calibration, reference capture, upload, or tip click. It opens every model result as `review`.                                                                                                                                                                                                                                                                                                                                                                   | Until a real artifact is installed, public Live Scoring correctly stays on the unavailable production path. No live score claim is justified yet.                                                                                                                                                                                                                                                              |
| Human correction           | Score Review now has **Confirm as shown** in addition to board correction. Development proposals block visit confirmation until the player explicitly confirms/corrects every one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                | This is a tester safeguard, not independent ground truth. Player corrections need consent, QA, and independent labeling before model training/evaluation.                                                                                                                                                                                                                                                      |
| Local evidence             | A tester may opt in per Live Scoring session to retain a bounded JPEG plus actual detector record in page memory. After human review, the browser can download JPEGs and a paired manifest; it never uploads or stores them automatically.                                                                                                                                                                                                                                                                                                                                                                                                        | Exported media may contain room/background information and must pass consent/redaction/validation before controlled data intake. It is a near-settled frame, not falsely presented as byte-identical to the model `ImageBitmap`.                                                                                                                                                                               |
| Guided own-throw bootstrap | The visible app separates **Live Scoring** from one consent-gated **Data Lab**. An unchecked entry agreement explains automatic private collection for product/model improvement; its version/time and `consented-development-unreviewed` status join each completed board-only record. After per-still and label review, Data Lab automatically saves the JPEG/manifest/sidecar trio through a credential-free same-origin private Blob Function. `local_five_point_dataset.py` checks pairs/dimensions/profile/consent, accepts explicit blank-board anchor-only records, rejects duplicates, and creates session-disjoint numeric YOLO splits. | No real captures have been collected or independently reviewed yet. The private route stays disabled until the existing Vercel project has a private Blob store and exact `development-consent-v1` access mode. The agreement is not application authentication, identity verification, or automated training admission; manual Data Lab steps are collection tooling only, never a normal Live Scoring setup. |
| Training handoff           | `deepdarts_yolo_train.py` audits the compiled local export, requires the reviewed five-class mapping/integrity, trains from a supplied local YOLO checkpoint, exports raw ONNX, hashes it, and writes a development-only manifest.                                                                                                                                                                                                                                                                                                                                                                                                                | It has not run because no full lawful local data corpus or base checkpoint is present. It deliberately cannot download data/weights, install a model into the web app, or deploy.                                                                                                                                                                                                                              |
| CI artifact verification   | `verify:model-artifact` continues to verify production packages and now also hashes a present optional five-point development ONNX/manifest without weakening production checks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Hash integrity says nothing about accuracy, provenance approval, real-device compatibility, or production readiness.                                                                                                                                                                                                                                                                                           |

## Current artifact and deployment status

- **No browser ONNX model is installed.** The supplied representative DeepDarts image/label pair remains
  a reviewed sample, not a trainable corpus or functioning detector.
- **No Roboflow hosted inference, tokenized URL, API key, or credential is used.** Camera frames remain
  local to the browser Worker.
- **No public Vercel redeployment has been made.** The existing production URL stays unchanged and still
  correctly reports that a verified strict model package is unavailable. The revised Data Lab intake
  Function is local code only and fail-closed until the owner configures a private Blob store and exact
  `DARTS180_CAPTURE_ACCESS_MODE=development-consent-v1` in that same project. This is the requested
  consent-gated development mode, not an authentication claim.
- **No production behavior was relaxed.** A future development package is review-only and only wins the
  router when production has no runnable artifact.

## Validation status for this local change

The revised local change has passed the following as of this snapshot:

```text
npm run verify
# Prettier; 33-document link check; all TypeScript workspace typechecks;
# unavailable-production-model verifier; 47 web + 25 rules + 6 vision-session + 2 API tests;
# Vite production build

cd ml && PYTHONPATH=src python3 -m unittest discover -s tests -v   # 28 tests
cd ml && python3 -m ruff check src tests && python3 -m ruff format --check src tests
npm audit --omit=dev --audit-level=high
# no high/critical findings; npm still reports 10 moderate transitive uuid findings through Expo/xcode
```

A built-browser identifier scan must confirm that no Blob token/store ID/OIDC token, server-only access-mode
environment name, retired collection-key header, or `@vercel/blob` identifier appears in the Vite browser
assets; the expected same-origin `/api/capture-ingest` route appears once. No forced `npm audit fix` is
planned without a compatibility review because npm previously proposed a breaking Expo downgrade for the
existing moderate advisory chain.

The browser tests cover development-manifest rejection, raw YOLO layout decoding/stretch-coordinate
restoration/class-aware NMS, the source-compatible rim-anchor orientation arithmetic, real-detector-only
suggestion requirements, mandatory `review` disposition, optional development-package hash verification,
and the Data Lab private-intake fail-closed exact-mode/store configuration, consent timestamp/admission
provenance, same-origin credential-free request, bounded body, immutable private-write, automatic-review-save
regression, and sanitized-error boundaries. The Python tests cover development manifest creation, audit gates,
session ID validation, local JPEG/sidecar-to-YOLO compilation with duplicate/wrong-profile rejection, explicit
blank-board anchors, corpus-wide dart-label requirements, and the external-only synthetic five-point builder—
without requiring GPU libraries. Rust/native code is unchanged; Cargo is not available in this environment for
an additional native check.

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
- Corrected local evidence exports are not automatically valid training labels, consent records, or sacred
  evaluation data.

## Next gates, in order

1. **Configure and test the consent-gated development collector.** Merge/deploy through the existing Vercel
   project, attach its private Blob store, and set exact server-only
   `DARTS180_CAPTURE_ACCESS_MODE=development-consent-v1`. Verify the unchecked entry agreement, private
   readiness gate, and automatic save for one safe blank-board and one dart-test record. Follow
   [`20-private-capture-lab.md`](20-private-capture-lab.md); do not send credentials, raw archives, or media
   in chat/Git.
2. **Build the synthetic bootstrap separately.** Generate the external-only five-point simulated dataset and,
   once a locally licensed base checkpoint is available, use it only for an explicitly synthetic development
   experiment. Do not present its validation/test partition as real-device evidence.
3. **Collect the first own-throw bootstrap batch.** Use the guided Data Lab for 12–20 board-only and dart-test
   stills across at least three pseudonymous setup sessions, then complete restricted review and compile them
   locally.
4. **Grow a balanced real training/evaluation campaign.** Build roughly 200–300 clearly labeled darts across
   10+ setup sessions before treating a trained artifact as useful. Preserve later, untouched whole real
   sessions for honest testing; a 1,000-throw campaign must be diverse rather than T20 repetition.
5. **Train/export and inspect the development artifact.** Supply a locally licensed base checkpoint, run the
   local audit/training recipe, and inspect ONNX input/output names/shapes, SHA-256, model size, and actual
   device initialization.
6. **Install and test only the development package.** Copy the reviewed ONNX + schema-1 manifest to the
   optional static model paths, run full verification, then use the existing Vercel project only for an
   explicitly labeled development deployment/retest decision.
7. **Promote only through the separate production gates.** Add real redundant quality/uncertainty evidence,
   locked independent evaluation, a reviewed ABI/artifact/attestation, and browser field proof before any
   production auto-recording claim. Native delivery remains after those web contracts are validated.
