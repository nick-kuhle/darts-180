# `native/vision-core`

This is the seed of the deterministic native layer shared by iOS and Android. It currently
contains canonical standard-darts board geometry and schema-v2 manifest-policy primitives; it is
**not yet** the on-device detector. Normal scoring setup remains identical for steel-tip and
soft-tip darts.

## Why this exists

React Native owns product UI, review flow, and app iteration. It must not own a 30–60 fps image
pipeline. The production boundary is:

```text
AVFoundation / CameraX
  → native frame pre-processing + pose tracker
  → Core ML / TFLite model runtime
  → Rust geometry / confidence policy
  → JSI/TurboModule event stream
  → @darts-180/vision-session (shared settle/review policy)
  → React Native UI
```

The crate builds as `lib`, `staticlib`, and `cdylib` so the platform teams can choose an FFI
bridge without changing its algorithms. The binding layer should be thin and generated where
possible (UniFFI is a candidate after the core API stabilizes).

## Non-negotiable constraints

- Do inference and canonicalization off the JS thread.
- Do not send full camera frames across a bridge.
- Emit only quality updates, pose/calibration updates, ranked score candidates, and an optional
  local clip handle.
- Map only a verified web-contract-equivalent schema-v2 policy into the Rust bridge. Do not use a
  native default, screen-level threshold, or remote toggle to promote a review-only release.
- Require the complete nine learned landmarks, learned quality/occlusion evidence, and verified
  production attestation/evaluation/provenance evidence before an automatic score. A possible
  one-view `MISS` is review-only.
- Keep the pure board decoder mirrored by tests in `packages/rules` until Rust becomes the
  authoritative shared core. Differential tests must prove the two implementations agree before
  making the switch.
- Use a production build / Expo development build, never Expo Go, for frame-processor work.

See `docs/03-detection-engine.md` for the complete pipeline and `docs/adr/0001-cross-platform-first.md`
for the platform decision.
