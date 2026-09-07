# ADR-0002: Store scoring as append-only events with rebuildable projections

- **Status:** Accepted
- **Date:** 2026-09-06
- **Decision owners:** Gameplay + Backend leads

## Context

Darts 180 scores offline, receives provisional vision evidence, allows human corrections, will later
sync across devices, and may support spectators/referees. Mutable “current score” rows make undo,
conflict resolution, trust/audit, stats recalculation, and bug repair much harder.

## Decision

Represent confirmed darts and turn confirmation as immutable ordered game events. Corrections append
an explicit replacement event. Build current score, history, stats, and scoreboard view as
projections. Local storage writes events first; server sync uses UUID idempotency keys and per-game
sequence envelopes.

A vision candidate is not an event until human/product review commits a score.

## Consequences

### Positive

- Exact audit trail and player-visible provenance (`auto`, `corrected`, `manual`).
- Offline retry is safe and duplication-resistant.
- Projection bugs can be repaired by rebuild rather than corrupting history.
- Future replays, live scoreboards, statistics, refereeing and exports share one source.

### Costs

- Event schema/versioning, ordering, correction UX, and projection tests require up-front discipline.
- Storage/read volume is higher than a mutable score table, though trivial for early scale.
- Eventual sync conflicts must be presented/resolved explicitly.

## Alternatives considered

| Alternative               | Rejected because                                                        |
| ------------------------- | ----------------------------------------------------------------------- |
| Mutable scoreboard row    | loses correction provenance / makes safe sync difficult                 |
| CRDT-only game state      | hides ordered referee semantics and does not simplify rules transitions |
| Full cloud authority only | breaks offline-first local play                                         |

## Follow-up

- Freeze event fixture corpus and add 300+ rules/conformance cases.
- Define server projection worker transaction/sequence semantics before connected beta.
- Add an explicit undo event and match/leg progression events when their behavior is specified.
