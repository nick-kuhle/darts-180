# API, sync, and realtime protocol

**Status:** v0 development contract  
**Implementation:** `services/api/`  
**Normative schema:** [`openapi.yaml`](openapi.yaml) (expand alongside contracts)

## 1. Protocol principles

- Local-first game writes; network is replication, not gameplay permission.
- UUID event IDs and idempotency keys make retries safe.
- Server sequences events per game; clients use sequence gaps to recover.
- Authoritative game state is a deterministic projection of immutable events and game settings.
- Realtime is a convenience stream. REST catch-up must always reconstruct state after disconnect.
- Version payloads; never make mobile clients guess a server schema change.

## 2. Implemented development endpoints

| Method | Route                       | Purpose                           |
| ------ | --------------------------- | --------------------------------- |
| `GET`  | `/healthz`                  | liveness/version                  |
| `POST` | `/v1/games`                 | create minimal game record        |
| `GET`  | `/v1/games/{gameId}`        | get snapshot + sequence           |
| `POST` | `/v1/games/{gameId}/events` | append validated idempotent event |
| `WS`   | `/v1/games/{gameId}/live`   | snapshot then event envelopes     |

The current service uses an **in-memory development store** and no authentication. It does rebuild
X01 and Cricket snapshots with the shared deterministic rules engine, but it must not be deployed as
production infrastructure. Its purpose is to prove contracts, idempotency, validation, projection,
WebSocket fan-out, and test strategy before Postgres/identity work.

## 3. Write request

```http
POST /v1/games/4b1…/events
Content-Type: application/json

{
  "idempotencyKey": "8aa…",
  "event": {
    "type": "dart.recorded",
    "schemaVersion": 1,
    "eventId": "d57…",
    "gameId": "4b1…",
    "visitId": "e72…",
    "playerId": "alex",
    "dartIndex": 1,
    "zone": { "ring": "T", "segment": 20, "score": 60 },
    "source": "corrected",
    "occurredAt": "2026-09-06T19:32:12.000Z",
    "recordedAt": "2026-09-06T19:32:13.000Z",
    "vision": {
      "modelVersion": "entrypoint-0.4.0",
      "calibrationId": "local-cal-12",
      "confidence": 0.89,
      "candidates": [{ "zone": { "ring": "T", "segment": 20, "score": 60 }, "probability": 0.89, "wireMarginMm": 0.8 }],
      "frameTimestampMs": 38540
    }
  }
}
```

The API validates notation/score coherence before persistence. A repeated idempotency key returns
the original envelope and does not increment sequence. Production adds actor authorization,
per-game role checks, payload-size limits, schema compatibility, and rate limiting.

## 4. Event types

| Type                                | Purpose                                                |
| ----------------------------------- | ------------------------------------------------------ |
| `dart.recorded`                     | immutable human-confirmed dart, with optional evidence |
| `turn.confirmed`                    | marks a 1–3 dart visit as official                     |
| `dart.corrected`                    | replacement relation; original event remains auditable |
| `game.created`                      | planned server-side canonical creation event           |
| `game.settings.updated`             | planned versioned rule-config change before a leg      |
| `leg.completed` / `match.completed` | planned projection/audit notification                  |
| `presence.updated`                  | ephemeral realtime event, not permanent game history   |

Do not reuse a game event type as an analytics event. Media feedback and telemetry have their own
permissioned pipelines.

## 5. Realtime message shapes

On connection:

```json
{ "type": "game.snapshot", "game": { "gameId": "…", "sequence": 42, "state": {} } }
```

For each accepted event:

```json
{ "type": "game.event", "event": { "gameId": "…", "sequence": 43, "event": {} } }
```

Client behavior:

1. Persist locally first.
2. Maintain `lastAppliedServerSequence` per game.
3. Apply a WebSocket envelope only once; acknowledge matching local UUID/idempotency write.
4. On gap/out-of-order/reconnect, request `GET /v1/games/{gameId}/events?after=N`; it is implemented in the development API and must be backed by durable storage before beta.
5. On authority conflict, show domain resolution UI; do not drop either record.

The scaffold WebSocket is intentionally broadcast-only. Add authentication before accepting any
client WebSocket commands.

## 6. Authentication and authorization plan

| Phase     | Identity                                | Permissions                             |
| --------- | --------------------------------------- | --------------------------------------- |
| Offline   | anonymous installation ID, local only   | device owns local game                  |
| Beta sync | magic link/OAuth/passkey, device link   | owner / invited player / spectator      |
| League    | verified account plus league membership | commissioner, scorer, player, spectator |

Use short-lived access tokens, rotating refresh credentials stored in platform secure storage,
server-side role checks, audited invitation links, and rate limiting. Do not put secrets in
`EXPO_PUBLIC_*` variables.

## 7. Persistence and projections

`infra/postgres/001_initial.sql` provides `games`, `game_players`, `game_events`, `game_snapshots`,
`device_calibrations`, and consented `vision_feedback` starting tables. Production append logic must
use one transaction that:

1. locks game sequence / validates actor and expected state;
2. checks `(gameId, idempotencyKey)`;
3. writes immutable event with next sequence;
4. updates/requeues deterministic projection;
5. publishes realtime after commit.

A snapshot accelerates reads but never replaces the event log. Projection version is recorded so an
updated rules engine can rebuild historical state safely.

## 8. Open integrations

Create a documented Darts 180 protocol rather than coupling product success to a competitor:

```text
POST /v1/devices/register
WS   /v1/games/{gameId}/live
POST /v1/games/{gameId}/events
GET  /v1/games/{gameId}/state
```

A device/partner submits **provisional candidates** separately from confirmed game events unless a
host has explicitly authorized a trusted hardware source. SDKs can expose game state, score input,
and scoreboard output without exposing private media.

### DartCounter position

As of research dated 2026-09-06, no sanctioned public DartCounter third-party score-injection API
was identified. Target Omni is an official DartCounter hardware integration. Darts 180 must not
simulate taps, scrape an app, reverse-engineer private traffic, or market an unsupported connection.
If DartCounter provides a partner API, build a consented adapter behind an integration boundary;
until then, export/share results only through documented user-controlled methods.

## 9. API versioning and compatibility

- URL major version: `/v1`; additive fields are allowed with tolerant readers.
- Every game event has `schemaVersion`; migrations declare up/down compatibility.
- Publish deprecation window, mobile minimum version, and fixture changes before removing fields.
- Generate typed clients from OpenAPI only after API stability; `packages/contracts` remains the
  shared product contract during the scaffold.
- Contract tests run producer and consumer schemas against a fixture corpus.

## 10. Error semantics

|    HTTP | Code                                  | Client response                                     |
| ------: | ------------------------------------- | --------------------------------------------------- |
|     400 | `INVALID_REQUEST`                     | show/retry only if local data can be repaired       |
| 401/403 | auth/role error                       | retain local event, request sign-in/host resolution |
|     404 | `GAME_NOT_FOUND`                      | do not retry blindly; recover local copy/export     |
|     409 | `GAME_ID_MISMATCH` / version conflict | show sync resolution                                |
|     429 | rate limit                            | exponential backoff                                 |
|     5xx | transient/server error                | queue retry, preserve local state                   |

No API error can erase a locally confirmed scoring event.
