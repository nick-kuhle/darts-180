# Product requirements — Darts 180 v0 through v1

**Status:** implementation baseline  
**Companion docs:** [mobile UX](06-mobile-ux.md), [rules](05-game-rules.md), [detection engine](03-detection-engine.md)

## 1. Product slices

| Slice                         | Player promise                                         | Must work offline? | Vision requirement                             |
| ----------------------------- | ------------------------------------------------------ | -----------------: | ---------------------------------------------- |
| S0: Manual scorer             | Correct, pleasant X01/Cricket scoring.                 |                Yes | None                                           |
| S1: Camera setup              | Help a player create a viable board view.              |                Yes | Pose/quality preview only                      |
| S2: Assisted turn             | Propose each of three darts and allow fast correction. |                Yes | Simulated first, then real stable-rig detector |
| S3: Private auto-referee beta | Reliable mounted-phone scoring in ordinary rooms.      |                Yes | Native pose + temporal + entrypoint pipeline   |
| S4: Connected play            | Sync games, spectators, history, leagues.              |  Graceful fallback | Cloud event replication                        |
| S5: Wider geometry            | More angles/distances, second-device/multicam option.  |                Yes | Generalized models and quality policy          |

No S2 UI should wait for ML accuracy. The confirmation flow validates whether players will trust and correct a score before capture/model costs escalate.

## 2. Primary flow: one 501 visit

1. Player chooses **Local 501**, player names, starting score, and in/out rules.
2. App offers **Camera setup** or **Manual mode**. It never blocks the game because a camera is unavailable.
3. Camera setup automatically finds the conventional red/green board pattern and displays a visible
   20-up guide. With an empty board, a player uses one **Start Play** action to retain a local
   baseline and arm play—without named-point selection or guide fitting. Gesture fitting remains an
   optional recovery path for unusual boards or failed automatic detection.
4. Once a dart impacts, the vision runtime waits for wobble to settle; it does not score on the impact frame.
5. For each recognized dart, the UI makes its best internal candidate estimate and shows a DartCard:
   - safe-looking proposal → editable camera suggestion;
   - uncertain / near wire → `CHECK` with clear correction access;
   - insufficient evidence / occlusion → no invented score and a manual-correction continuation.
     Normal camera play does not ask the player to identify or click a physical dart tip.
6. Player may tap a score card to select/correct a zone, undo a dart, or enter manually.
7. Player confirms 1–3 darts. The app appends immutable dart events and a turn-confirmed event, updates the deterministic rules projection, and advances the turn.
8. App waits for board clear before looking for the next visit. If someone removes a dart early, it freezes auto-scoring and asks for manual review.

## 3. Functional requirements

### P0: Manual game engine

- [ ] Create local X01 (301/501/701/901/custom), 1–16 players, legs/sets, straight/double/master in and out.
- [ ] Create local standard Cricket, including outer bull = one mark and inner bull = two marks.
- [ ] Add/replace/delete a dart before visit confirmation; undo a confirmed event afterward with auditable provenance.
- [ ] Compute busts, checkouts, visit totals, turn rotation, three-dart average, and Cricket marks deterministically.
- [ ] Retain complete local history in encrypted-on-device storage once persistence adapter lands.
- [ ] Export a human-readable game summary and a machine-readable event log.

### P0: Camera setup and review UX

- [ ] Request camera permission in plain language; manual mode works after denial.
- [ ] Automatically find a conventional red/green board and show a framing guide with a comprehensible top-20 orientation and live quality dimensions: framing, focus, lighting/glare, obliqueness, obstruction.
- [ ] Let a player begin play with one local-baseline action instead of named point picking, guide fitting, or separate reference capture. Keep drag/tap, pinch, twist, and edge handles as optional recovery only.
- [ ] Support a selected board profile and standard-board default without a player-facing steel-tip/soft-tip setup branch.
- [ ] Explain why a view is rejected and offer three actions: reposition, use manual entry, add a second camera later.
- [ ] Present three independently editable DartCards, each with score, notation, confidence state, and source.
- [ ] Never silently commit a raw model result to an official game state.

### P1: Vision session behavior

- [ ] Infer the board mapping automatically on setup and monitor mapping drift; repeat automatic board finding only when necessary.
- [ ] Detect board-empty → dart-arrives → settle → candidate → review → confirmed → board-cleared state transitions.
- [ ] Hold at most three active dart tracks per standard visit; handle early checkout and bounce-out explicitly.
- [ ] Capture a short local ring buffer only under the privacy rules; no hidden full-session recording.
- [ ] Show ranked alternatives when confidence/score margin is insufficient.
- [ ] Let a player flag “robin hood,” “dart obscured,” “board moved,” or “bounce-out” so data labels improve.

### P1: Connected experience

- [ ] Optional account and device identity; anonymous local games remain supported.
- [ ] Idempotent event upload, reconnect, conflict display, game resume, and spectator projection.
- [ ] WebSocket game stream suitable for a scoreboard display.
- [ ] Role policy: player, scorer/host, spectator; do not conflate them with billing roles.

## 4. Supported camera contract

“Any angle” is a product aspiration; the operating contract is measurable.

| Property            | Preferred                       | Minimum initial support target    | Action outside gate                               |
| ------------------- | ------------------------------- | --------------------------------- | ------------------------------------------------- |
| Board size in frame | 700–1,200 px diameter           | ≥480 px diameter                  | Prompt to move closer / use a mount               |
| Distance            | 0.7–1.2 m                       | 0.5–2.0 m with adequate pixels    | Manual fallback or second device                  |
| Off-axis pose       | 0–30°                           | ≤55° after pose confidence passes | Prompt to move toward centerline                  |
| Board visibility    | Entire face + numbers           | Entire double ring visible        | Reframe; do not infer cropped rings               |
| Light               | Even, diffuse                   | No severe glare / motion blur     | Lighting coaching                                 |
| Mount               | Centerline, slightly above bull | Stable fixed phone/tablet         | Warn if handheld/motion invalidates board mapping |

This contract is deliberately tighter than a marketing phrase. It is a transparent starting envelope to expand only when slice metrics show that it is safe.

## 5. Experience acceptance criteria

### Manual scorer acceptance

- A new user reaches an active 501 board in ≤60 seconds without account creation.
- All P0 rule fixtures pass in CI. A correction never changes an unrelated dart.
- A double-out bust restores the start-of-visit score; a close finish updates immediately.
- Cricket scoring does not award excess marks when all opponents have closed the target.

### Camera setup acceptance

- On a supported setup, board detection/quality state appears in ≤3 seconds at p95.
- A normal player can reach Board Found from a visible conventional red/green board, verify the `20`
  orientation marker, and start local play with one action—without calibration, named board-point
  selection, guide fitting, image download/upload, separate reference capture, or visible-tip clicking.
- A failed automatic fit gives an actionable cause and makes visual guide gestures available only as
  optional recovery.
- Feedback names a controllable cause, not “try again”: e.g., “move 20 cm closer,” “reduce glare,” “board is only 300 px wide.”
- Any hard quality failure has a manual-scoring continuation path.

### Assisted-scoring acceptance

- DartCard appears within the latency budget after a stable impact state.
- Editing a card requires no keyboard and preserves a `corrected` source.
- A user can confirm a normal three-dart turn with zero, one, or multiple corrections.
- The UI calls out a possible bust/checkout but never hides the underlying dart sequence.

## 6. Accessibility and internationalization

- Support VoiceOver/TalkBack labels such as “Dart two, triple twenty, sixty points, needs review.”
- Do not encode confidence with color alone; green/amber are paired with text and icon/state labels.
- Minimum 44×44 pt touch targets and high-contrast dark/light themes.
- Localize dates, language, score-call wording, currency, and right-to-left layout; dart notation remains configurable but mathematically consistent.
- Score caller audio is optional and must remain usable with screen readers and no sound.

## 7. Pricing/product constraints (hypothesis, not implemented)

Recommended starting model:

- Free local manual games and basic local stats forever; no account required.
- One-time **Auto-Referee** device/family unlock for unlimited camera scoring, local clip replay, and advanced insights.
- Optional online/leagues/premium caller subscription later.
- Never paywall correction, undo, safety/privacy controls, or access to a player's own game history.

Validate willingness-to-pay through interviews and an ethical beta offer before committing. Competitor packaging changes quickly; see the dated market research.

## 8. Explicit deferred scope

- Soft-tip / electronic boards
- Automated commercial-venue adjudication
- Tournament certification
- DartCounter private integration
- Full social feed / public video sharing
- Betting, prize handling, or gambling mechanics
- “Any phone anywhere” marketing guarantee

## 9. Requirements traceability

| Requirement class         | Source of truth                                                   | Automated proof               |
| ------------------------- | ----------------------------------------------------------------- | ----------------------------- |
| Score math                | `packages/rules` + [rules spec](05-game-rules.md)                 | unit/conformance tests        |
| Dart session safety       | `packages/vision-session` + [engine spec](03-detection-engine.md) | state-machine tests           |
| Wire/API payload validity | `packages/contracts`, OpenAPI                                     | schema/API tests              |
| Mobile interaction        | [mobile UX](06-mobile-ux.md)                                      | e2e/accessibility tests       |
| Vision accuracy           | [ML/eval spec](04-ml-data-and-evaluation.md)                      | frozen evaluation reports     |
| Privacy                   | [privacy spec](08-security-privacy.md)                            | policy + deletion/audit tests |
