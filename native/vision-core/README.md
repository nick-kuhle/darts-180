# `native/vision-core`

This is the seed of the deterministic native layer shared by iOS and Android. It currently
contains canonical steel-tip board geometry and camera-quality policy; it is **not yet** the
on-device detector.

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
- Keep the pure board decoder mirrored by tests in `packages/rules` until Rust becomes the
  authoritative shared core. Differential tests must prove the two implementations agree before
  making the switch.
- Use a production build / Expo development build, never Expo Go, for frame-processor work.

See `docs/03-detection-engine.md` for the complete pipeline and `docs/adr/0001-cross-platform-first.md`
for the platform decision.
