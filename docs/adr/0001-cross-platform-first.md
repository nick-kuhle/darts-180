# ADR-0001: Cross-platform UI first, native vision runtime from day one

- **Status:** Accepted
- **Date:** 2026-09-06
- **Decision owners:** Mobile + Vision leads

## Context

Darts 180 must reach iOS and Android quickly, but its differentiated feature is camera/ML work that
runs at 30–60 fps and must be thermally efficient. A JavaScript frame-processing loop would risk
latency, bridge overhead, device heat, and fragile platform behavior. The product decision is
cross-platform now with native mobile app options later.

## Decision

Use React Native + TypeScript / Expo for shared product UI and developer iteration. Use Expo
development builds—not Expo Go—for any native CV work. Isolate native camera/pose/model pipelines
behind a TurboModule/JSI contract and build deterministic geometry in a portable native core.

The React Native layer receives only calibration/quality updates, ranked candidate events, and
optional local clip handles. It never receives per-frame image data.

## Consequences

### Positive

- One fast UI/product code path across iOS and Android.
- Native teams can optimize AVFoundation/CameraX/Core ML/TFLite without UI rewrite.
- Future fully native apps retain contracts, rules fixtures, event history, and server API.
- Camera work is forced into testable performance boundaries early.

### Costs

- Expo Go is insufficient for real vision work; development builds add build/signing workflow.
- Native bridge/API design requires coordination and device-specific test infrastructure.
- Some third-party RN plugins may lag platform releases; keep adapters replaceable.

## Alternatives considered

| Alternative                    | Why not selected now                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| Flutter UI + platform channels | viable; team chose RN/TS ecosystem and TurboModule path for initial hiring/product speed       |
| Fully native iOS then Android  | highest initial CV control but delays Android/product iteration; user asked cross-platform now |
| Web/PWA camera app only        | weak frame/runtime control and device/browser fragmentation for high-trust scoring             |
| JavaScript/OpenCV frame loop   | unsuitable performance/thermal/bridge profile for production CV                                |

## Follow-up

- Benchmark RN/native bridge event latency and device thermal behavior.
- Create iOS/Android adapter interface test harness.
- Revisit only if measured performance or platform stability fails the stated SLOs.
