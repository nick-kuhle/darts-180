# Mobile UX and interaction specification

**Status:** product UX baseline  
**Implementation shell:** `apps/mobile/` (Expo / React Native)

## 1. Experience thesis

The player is throwing darts, not operating a computer. The app should stay legible from the oche,
be operable one-handed beside the board, and resolve uncertain scoring in less time than manual
math. It must never make an AI disagreement feel like the player is arguing with a machine.

## 2. Navigation model

```text
Home
 ├─ Quick local game
 │   ├─ game setup
 │   ├─ board / turn review
 │   ├─ camera setup (optional)
 │   ├─ history / match summary
 │   └─ stats / export
 ├─ Practice
 ├─ Connected play (later)
 └─ Settings
     ├─ device / camera
     ├─ privacy / data contribution
     ├─ accessibility / score caller
     └─ account (optional)
```

The current scaffold opens directly to the board-review demo so the team can test the highest-risk
interaction first.

## 3. Camera setup UX

### Goal

Get a stable, valid view without asking an amateur to understand homographies, pixels, or camera
extrinsics.

### Screen states

| State                     | What player sees                                       | System behavior                             |
| ------------------------- | ------------------------------------------------------ | ------------------------------------------- |
| Permission needed         | purpose + privacy, manual fallback                     | request only after intent                   |
| Looking for board         | automatic red/green board find and “show whole board”  | board/pose detector running                 |
| Board found, quality poor | one dominant, actionable problem                       | quality diagnostics ranked                  |
| Board found               | visible 20-up guide and one **Start Play** action      | retain baseline, arm scoring                |
| Optional recovery         | drag/tap, pinch, twist, and four edge handles          | only after automatic finding cannot recover |
| Mapping drift             | “board/camera moved—finding board again”               | pause candidates, preserve game             |
| Unsupported               | manual-entry / reposition / later second-device option | never dead-end                              |

### Copy principles

Say **“Move the phone 20 cm closer”**, not “insufficient resolution.” Say **“Reduce the glare on
right side of board”**, not “quality 0.42.” Expert diagnostics may be revealed in a detail panel,
never as the default message.

### Normal automatic-board interaction

The player must never have to learn named board-point labels or a homography. For a conventional board,
the app should find red/green scoring bands automatically, display a visible `20` orientation marker,
and ask only for **Start Play** with the board empty. Internally it infers a mapping and retains a
local baseline; the player does not calibrate or fit a guide.

Red/green bands repeat around a board, so a non-trained browser heuristic cannot uniquely infer every
number-ring rotation from color alone. The starting contract is a level camera with the physical 20
upright. A future trained board/orientation model removes that assumption. Drag/tap, pinch, twist,
and individual outer-edge handles are recovery-only controls for failed automatic finding, not normal
onboarding.

The same interaction is presented for steel-tip and soft-tip darts. The runtime may use internal
endpoint/shape evidence, but it must not ask the player to select a physical tip. Ordinary score-card
correction is the safety route when a suggestion is wrong or ambiguous.

### Placement guidance

1. Put device on a cheap, stable mount—not in a hand during play.
2. Start centered horizontally with the camera slightly above bull height.
3. Place it roughly 0.7–1.2 m from the board and fit the complete double ring in frame.
4. Let the app assess actual quality; do not pretend one universal distance/angle works for all
   devices.

## 4. DartCard review pattern

Every visible dart gets exactly one card in visit order.

```text
DART 2                         CHECK
S20 · 20 points
87% score confidence · 0.8 mm from wire
[ tap to edit ]  [ see alternatives / replay ]
```

| State     | Meaning                                        | Default interaction                             |
| --------- | ---------------------------------------------- | ----------------------------------------------- |
| `LOCKED`  | high confidence and safe boundary margin       | visually quiet; always tap-to-edit              |
| `CHECK`   | plausible but near wire / uncertain            | prominent alternate options, one-tap correction |
| `FLAGGED` | occlusion, robin hood, bounce-out, board shift | request human decision; do not pre-commit       |
| `MANUAL`  | camera absent or unusable                      | normal dart picker/numpad                       |

### Editing behavior

- Tapping a card opens a board-aware picker (standard segments/rings) and a concise recent/favorite
  list. Do not make users type `T20` during a live turn.
- If the candidate has top-k alternatives, show them first with probability only in details—not as
  a demand for the user to understand probability.
- On selection, label card `MANUAL` or `CORRECTED`; retain original model evidence in the event.
- Undo is immediate and local. After sync, it appends a correction/undo event and updates every
  projection; it does not silently mutate history.
- Player confirms 1–3 darts. The app shows total, potential bust/checkout, and next player only as
  assistance, never removes individual-card provenance.

## 5. Game-board layout

From farthest visual importance to least:

1. active player and remaining score / Cricket state;
2. three DartCards and current visit total;
3. confirm / correction action;
4. checkout recommendation, if it is mathematically relevant;
5. connection/camera quality subtle status;
6. history, advanced stats, settings.

Use a landscape/tablet scoreboard companion later. It subscribes to the same event stream but has
no independent scoring authority.

## 6. Error and recovery flows

| Situation                    | UX response                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| No camera permission         | “Use manual scoring” remains primary viable route                                  |
| Board not found              | show framing guide + one most likely fix                                           |
| Phone moves during turn      | freeze proposal, ask player to stabilize/recheck                                   |
| Dart removed early           | “Board changed before this visit was confirmed”; show cards/manual correction      |
| Network lost                 | status “Saved on this device”; play continues                                      |
| Sync conflict                | show visits chronologically and host/referee resolution—not silent merge           |
| Model overload/thermal state | reduce preview rate / pause vision; preserve manual scoring                        |
| App backgrounded             | persist provisional review safely or discard with clear message; never auto-submit |

## 7. Visual language

Initial scaffold tokens:

| Token                    | Use                                |
| ------------------------ | ---------------------------------- |
| Charcoal `#101415`       | board-like dark base               |
| Mint `#57D6A8`           | ready/confirm/safe action          |
| Amber `#FFB64C`          | uncertainty / attention, not error |
| Warm off-white `#F8FBFA` | primary score/text                 |
| Muted slate `#8C9B98`    | secondary telemetry                |

Do not rely on colors: status words, icons, haptics (optional), and accessible labels convey state.
Avoid faux dartboard backgrounds behind numbers; legibility wins.

## 8. Accessibility requirements

- DartCard has an explicit screen-reader label with dart number, notation, points, score state, and
  edit action.
- Control targets minimum 44×44 points; use large-type-safe layout rather than clipping a score.
- Keyboard navigation works on web/desktop scoreboard; TalkBack/VoiceOver work for every game
  transition.
- Haptic/audio score-caller is optional, configurable, and never the only notification.
- Camera quality message has text equivalent, not a tiny red/green indicator.

## 9. Offline and privacy UX

- Start local games with no account. “Saved only on this device” is honest.
- Camera permission wording says scoring happens on-device by default.
- Data contribution is a separate, reversible settings decision, not bundled with first-run camera
  permission or Terms acceptance.
- If a clip is eligible to share, show what is shared (board crop/seconds), why, retention, and
  delete choice. Never imply that declining harms gameplay.

## 10. Instrumentation for UX learning

Log non-media product events with consent/analytics policy: setup start/complete/reason, quality
failure category, time-to-first-card, card edit path, correction vs auto confirmation, undo, manual
fallback, session outcome, and app/device performance. Do not log raw score video to analytics.

## 11. Prototype status

The native `apps/mobile` scaffold remains a focused end-to-end interaction demo: simulated camera
candidates, editable DartCards, X01 scoring, camera permission/preview, and clear text saying that
native frame scoring is not wired yet. The separate browser prototype now implements the automatic-board-find
Camera Play field-test interaction, but it is still a testing tool—not a deceptive claim of model
accuracy.
