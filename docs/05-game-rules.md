# Darts rules and deterministic scoring specification

**Status:** authoritative behavior for product engineering  
**Code:** `packages/rules/`  
**Principle:** CV identifies board location; rules determine game consequence.

## 1. Standard board vocabulary

| Notation      | Meaning              | Score |
| ------------- | -------------------- | ----: |
| `S20`         | single 20            |    20 |
| `D20`         | double 20            |    40 |
| `T20`         | treble 20            |    60 |
| `OB` / `25`   | outer bull           |    25 |
| `IB` / `BULL` | inner bull           |    50 |
| `MISS`        | off board / no score |     0 |

Face-on standard segment order, from the top clockwise:

```text
20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5
```

The rules package validates that ring, segment, and score agree. A client cannot submit `D20` with
20 points and have it accepted.

## 2. Event model

A camera candidate is provisional. A confirmed dart becomes:

```ts
DartEvent {
  type: 'dart.recorded', schemaVersion: 1,
  eventId, gameId, visitId, playerId, dartIndex: 1 | 2 | 3,
  zone: { ring, segment, score },
  source: 'auto' | 'corrected' | 'manual' | 'imported',
  occurredAt, recordedAt, vision?
}
```

A `turn.confirmed` event commits 1–3 darts, and a correction appends a relation to the replaced
DartEvent. Event ordering is sequence-based on the server and stable locally. The projection can
be rebuilt exactly; no UI state is authoritative.

## 3. X01 (implemented)

### Settings

- Starting score: typical 301, 501, 701, 901; any integer ≥2 is allowed by the engine.
- Entry: `straight`, `double-in`, or `master-in`.
- Exit: `straight`, `double-out`, or `master-out`.
- A visit contains 1–3 darts; a finish can end it early.

### Per-dart behavior

1. In straight-in, the player starts immediately. In double-in, only a double (including inner
   bull) opens scoring. In master-in, a double, treble, or inner bull opens scoring.
2. After opening, subtract each score from the visit's working total.
3. If total becomes negative, it is a bust.
4. For double/master-out, a total of exactly one is a bust because no legal finishing dart exists.
5. If total becomes zero, the final dart must meet the configured exit rule:
   - straight out: any scoring dart;
   - double out: numbered double or inner bull;
   - master out: numbered double, treble, or inner bull.
6. Any illegal zero or bust restores **both** remaining score and in-status to the start of the
   visit. Darts after bust/checkout are retained as malformed/audit input but ignored by rules.
7. A successful checkout finishes the leg. Set/match progression is a higher projection layer and
   must never change per-dart mathematics.

The maximum conventional three-dart double-out checkout is 170: `T20 T20 BULL`. Numbers such as
169, 168, 166, 165, 163, 162, and 159 have no three-dart double-out route.

## 4. Cricket (implemented)

### Targets and marks

Targets are 20, 19, 18, 17, 16, 15, and bull. Three marks close each target:

| Hit           | Marks |
| ------------- | ----: |
| Single target |     1 |
| Double target |     2 |
| Treble target |     3 |
| Outer bull    |     1 |
| Inner bull    |     2 |

Hits on other numbers are irrelevant in standard Cricket.

### Points and win condition

- A player must close a target before excess hits can score its face value.
- Excess marks score only while at least one opponent remains open on that target.
- Example: with two 20 marks, `D20` adds one closure mark plus one excess mark; score 20 only if
  an opponent is still open.
- Bull excess marks are worth 25 each; `IB` is two bull marks and therefore can score 50 after
  closure where an opponent remains open.
- A player wins only when all seven targets are closed **and** their points are equal to or greater
  than every opponent's points. If they close but trail, play continues.

Variants (cut-throat, no-score, wild-card/full-board) are separate configs and must not silently
reuse standard Cricket semantics.

## 5. Planned games and their canonical rules

| Game                    | Product phase | Core rule summary                                                                                                             |
| ----------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Count-Up                | next          | highest total after configured visits/darts; no bust                                                                          |
| Around the Clock        | next          | hit targets in ordered sequence, configurable numeric/board order                                                             |
| Shanghai                | next          | hit current number; single/double/treble Shanghai ends game                                                                   |
| Bob's 27                | later         | start 27, attempt configured doubles 1–20/bull; hit adds double value, miss subtracts it (restart-at-27 is a house-rule flag) |
| Killer                  | later         | establish/capture numbers, then remove opponents' lives; house rules explicit                                                 |
| 121 / Checkout practice | later         | deterministic target/attempt progression and personalized route layer                                                         |
| Halve-It                | later         | target rounds with zero-hit score-halving; variants explicit                                                                  |

Do not add a game merely as a view. Each must have a formal transition spec, fixtures, scoring
source policy, completion conditions, and statistics definition.

## 6. Statistics definitions

Definitions must be visible and never mix practice/manual errors with official scoring silently.

| Statistic          | Definition                                                                            |
| ------------------ | ------------------------------------------------------------------------------------- |
| Three-dart average | X01 valid scored points / darts thrown ×3, with documented bust treatment             |
| First-nine average | first nine darts of eligible X01 legs only                                            |
| Checkout %         | completed checkout legs / checkout opportunities; define an opportunity precisely     |
| Doubles hit rate   | successful requested or final doubles / attempts in relevant context                  |
| Cricket MPR        | marks per round from standard Cricket hits; document whether bonus/points impact it   |
| Correction rate    | corrected or manual darts / recorded darts; a system-quality metric, not player skill |

The first release should calculate only metrics whose denominator is unambiguous in the event log.

## 7. Edge cases

| Case                                              | Required behavior                                                             |
| ------------------------------------------------- | ----------------------------------------------------------------------------- |
| Inner bull in double in/out                       | counts as a double                                                            |
| Outer bull in double in/out                       | does not count as a double                                                    |
| Double-in dart causes illegal zero                | bust, restore pre-visit in-status                                             |
| Camera sees 3 darts but player finished on dart 2 | mark later observation ignored / require review                               |
| Dart is corrected after turn confirmation         | append correction; rebuild affected projection                                |
| Manual score without individual darts             | represent as explicit import/visit policy; do not fabricate vision provenance |
| Board hit but dart bounces out                    | `MISS` only after player confirms; not a forced vision conclusion             |
| Cricket player closes all but trails              | no winner; must continue until points condition is met                        |

## 8. Test standard

The scaffold has focused executable tests; production bar is a named **300+ conformance-case
suite** covering all settings, boundaries, player counts, correction/replay order, and statistics.
Fixture cases are data files shared across future native implementations. Every new rules feature
adds examples before UI work is accepted.

Run today:

```bash
npm run test --workspace=@darts-180/rules
```

## 9. Sources and referee verification

Formal tournament rules and house rules vary. The product must identify the selected setting in the
UI and preserve it in game events. Verify public rule copy with a rules-domain expert before
marketing a mode as “official.” The board geometry source list is maintained in the dated research
document.
