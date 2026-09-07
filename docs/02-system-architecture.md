# System architecture

**Status:** scalable monolith + native-runtime foundation  
**Principle:** stable contracts now; distributed services only when a measured bottleneck needs them.

## 1. Architecture in one diagram

```text
                         ┌────────────────────────────────────────────────┐
                         │                  Darts 180 mobile                │
                         │ React Native UI / offline store / review UX     │
                         └───────────────┬──────────────────────┬──────────┘
                                         │                      │
                       Dart events + sync│                      │ quality + candidates
                                         ▼                      ▼
                 ┌───────────────┐   ┌────────────────────────────────────┐
                 │ TypeScript    │   │ Native mobile vision adapter        │
                 │ rules package │   │ AVFoundation / CameraX              │
                 │ deterministic │   │ pose + temporal + Core ML/TFLite    │
                 └───────┬───────┘   │ Rust geometry / JSI event bridge    │
                         │           └────────────────────────────────────┘
                         ▼
                local event log
                         │ async / realtime when opted in
                         ▼
       ┌──────────────────────────────────────────────────────────┐
       │ API modular monolith                                       │
       │ identity · game event store · game projections · realtime │
       └─────────┬──────────────────┬─────────────────────────────┘
                 │                  │
          Postgres event log     object storage (consented clips)
                 │                  │
                 └──── aggregate metrics / de-identified ML queue ┘
```

## 2. Repository boundaries

| Area                      | Responsibility                                     | Must not do                          |
| ------------------------- | -------------------------------------------------- | ------------------------------------ |
| `packages/contracts`      | Versioned payloads between every layer             | Import UI/database/ML SDKs           |
| `packages/rules`          | Board math, game state transitions, checkout math  | Read camera frames or network        |
| `packages/vision-session` | Settling, quality and review policy                | Execute a model or mutate game state |
| `apps/mobile`             | UX, local persistence adapter, platform navigation | Run per-frame OpenCV in JS           |
| `native/vision-core`      | Canonical native geometry/policy and bindings      | Own user/account/game rules          |
| `ml/`                     | Train/evaluate/export models                       | Become a production service          |
| `services/api`            | Event ingestion, sync, identity, online projection | Decide vision geometry               |
| `infra/`                  | Reproducible environments and security controls    | Contain product logic                |

The most important rule: a predicted dart is **not** a game event. It becomes one only after the review policy and player action choose a score.

## 3. Client architecture

### Cross-platform first

Use React Native + TypeScript with Expo for developer workflow, **Expo development builds** for native modules, and React Native's New Architecture / TurboModule/JSI boundary for vision. This gives one product UI across iOS/Android while acknowledging that camera throughput and ML inference are native work.

A native iOS or Android app later can retain:

- event schema and sync protocol;
- deterministic rules conformance vectors;
- native Rust geometry core;
- model output contract;
- server APIs and storage.

It should not need a product-data migration or a rewrite of the game record format.

### On-device data model

```text
Local database
  games
  players
  immutable game_events
  projections (rebuildable)
  device_calibrations
  pending_sync_queue
  local encrypted ring-buffer handles (short-lived)
```

Use SQLite with encrypted-at-rest platform facilities/SQLCipher after the manual prototype. Treat local event writes as the source of truth. A cloud write is an asynchronous replica, not a prerequisite for a home game.

### Event model

Each immutable event has a UUID, game ID, visit ID, player ID, order, occurrence time, source (`auto`, `corrected`, `manual`, `imported`), and schema version. Corrections append a replacement relation rather than overwriting history. Turn confirmation makes a 1–3 dart visit official.

Advantages: undo/audit, offline retry, eventual sync, replay, statistics rebuild, future referee review, and testable deterministic projections.

## 4. Vision/native boundary

Do not pass raw 4K images through the React Native bridge. The native adapter emits small events:

```ts
BoardCalibration
CameraPoseQuality
VisionCandidateEvent { trackId, frameTimestampMs, candidates[] }
LocalClipHandle // only if enabled by policy
```

The JS-level `@darts-180/vision-session` package applies shared settle/review policy. The native layer owns camera buffers, stabilization, model invocation, tracking, lens correction, and image-to-board mapping. See [detection engine](03-detection-engine.md).

## 5. Backend evolution

### Phase A — no backend dependency

Manual local game and camera proof-of-concept. API may run only for developers. Do not add accounts just to support a home 501 game.

### Phase B — modular monolith

One Fastify/TypeScript service, one Postgres cluster, one object store, one Redis-compatible presence/cache if online rooms need it. Modules:

- `identity` — anonymous device identity first, optional account later;
- `games` — append-only writes, idempotency, authorization;
- `projection` — rules projection, stats, leaderboard materialization;
- `realtime` — WebSocket rooms and presence;
- `media` — consent validation, pre-signed uploads, retention/deletion;
- `model-feedback` — de-identified correction records.

The scaffold's in-memory store exists only to demonstrate the port. It already rebuilds X01/Cricket snapshots using the shared rules package, but it is not durable, authenticated, or production-safe. `infra/postgres/001_initial.sql` is a Phase-B starting schema.

### Phase C — split only with evidence

| Trigger                                            | Extractable service                  |
| -------------------------------------------------- | ------------------------------------ |
| Training pipeline needs distinct GPU/data controls | data ingestion/model registry        |
| Realtime room traffic harms normal API latency     | realtime gateway                     |
| Stats rebuilds contend with event writes           | projection worker                    |
| Clip lifecycle/compliance dominates                | media/privacy service                |
| Global regions require locality                    | regional event ingress + replication |

Never split "because microservices scale." Split when SLOs, security boundaries, or deployment cadence prove it.

## 6. Sync and conflict policy

1. Client writes local immutable event with UUID/idempotency key.
2. Client applies local projection immediately.
3. Sync worker POSTs events in visit order on connectivity.
4. Server accepts exactly once per `(gameId, idempotencyKey)` and broadcasts sequence-numbered envelope.
5. Client acknowledges matching local event; fetches gap from last server sequence after reconnect.
6. Conflicting edits are visible domain events. The host/referee role resolves a divergent correction; never silently last-write-wins a score.

A future CRDT may help lobby/presence preferences, but score history has ordering and referee semantics; append-only, sequenced events are clearer.

## 7. Storage / retention tiers

| Data                           | Default location               | Retention principle                                         |
| ------------------------------ | ------------------------------ | ----------------------------------------------------------- |
| Game events                    | device; optional Postgres sync | player-controlled game history                              |
| Calibration matrices/quality   | device; optional sync          | no raw image required                                       |
| Raw frame ring buffer          | device only                    | seconds/minutes, deleted after review unless explicit share |
| Shared failure clip            | encrypted object storage       | consent/version/retention bound                             |
| De-identified labels           | controlled ML dataset          | versioned, delete-capable                                   |
| Aggregated performance metrics | analytics store                | no personal/video payload                                   |

## 8. Deployment environments

| Environment         | Purpose           | Data rule                                                |
| ------------------- | ----------------- | -------------------------------------------------------- |
| Local               | developer loop    | synthetic/locally captured only                          |
| Dev                 | integration       | synthetic + explicit internal consent                    |
| Staging             | release rehearsal | production-like controls; no production media by default |
| Production          | player traffic    | region, encryption, audit, retention enforcement         |
| ML secure workspace | labeling/training | least-privilege de-identified data only                  |

## 9. Observability

Track product/technical events separately from personal media:

- camera quality distribution and setup failure reasons;
- pose drift/recalibration rate;
- candidate latency and dropped-frame rate;
- correction rate by model/device/pose/light/ring/wire-margin slice;
- manual fallback and bounce-out flags;
- event-sync error/retry/duplication rate;
- API p50/p95/p99 and WebSocket room health.

No image or clip is needed for most operational telemetry. See [quality/release](09-quality-release.md) and [privacy](08-security-privacy.md).

## 10. Architectural invariants

1. Rules output must be reproducible from events and versioned rules settings.
2. `packages/contracts` changes are backward-compatible or version-negotiated.
3. An offline visit cannot be lost because a network write fails.
4. Raw camera media never crosses the UI/native boundary by accident.
5. A model version always accompanies a vision prediction used for evaluation or feedback.
6. Projections are disposable; event logs are protected.

## 11. Related ADRs

- [ADR-0001: cross-platform UI, native vision](adr/0001-cross-platform-first.md)
- [ADR-0002: append-only scoring events](adr/0002-event-sourced-games.md)
- [ADR-0003: quality-qualified any-angle camera contract](adr/0003-adaptive-camera-contract.md)
