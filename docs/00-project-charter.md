# Darts 180 project charter

**Status:** foundation and local-data-tooling decision record<br />
**Owner:** Product + Engineering leadership<br />
**Last updated:** 2026-09-07<br />
**Working name:** Darts 180 — legal clearance pending

## 1. One-sentence mission

Make a normal dartboard feel like it has a fair, fast, player-controlled digital referee—using the phone people already own, without forcing them to buy a multi-camera ring. The normal setup interaction must not branch on whether a player throws steel-tip or soft-tip darts.

## 2. Problem we are solving

Darts scoring is deceptively disruptive to play: players stop, calculate, enter scores, debate a wire hit, and lose momentum. Existing automatic systems prove demand, but hardware cost, installation, subscriptions, and locked ecosystems leave room for a phone-first product.

Darts 180 should not promise infallible computer vision. Its durable promise is:

> **See the board, suggest every dart, explain uncertainty, and let the player confirm or correct in one beat.**

That trust loop is a feature, not a temporary embarrassment. It creates the data required to become more accurate over time.

## 3. Product position

| Attribute       | Darts 180 position                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Setup           | Phone/tablet first; a low-cost mount improves experience but no proprietary ring is required.                                        |
| Camera geometry | Adaptive pose calibration for practical angles; quality-gated rather than falsely universal.                                         |
| Score authority | Human always has final approval and one-tap correction.                                                                              |
| Core experience | Offline local play works without an account.                                                                                         |
| Vision privacy  | On-device by default; raw media is never a hidden analytics stream.                                                                  |
| Platform        | React Native cross-platform UI now; native iOS/Android vision modules from the start; independent native apps remain possible later. |
| Ecosystem       | Own game experience and open protocol. Partner with external scorers only through sanctioned integrations.                           |

## 4. Product outcomes

### First launch outcomes (0–90 days)

1. A player can run a reliable manual scorer for 501 and Cricket in under one minute.
2. A mounted phone can guide itself into a calibrated board pose and show clear quality feedback.
3. The review UI demonstrates that every auto result can be confirmed/corrected per dart.
4. The team has a consented, diverse capture program and a locked evaluation dataset—not just demo videos.

### Auto-referee outcomes (initial private beta)

| Metric                                    | Gate                        | Why it matters                                          |
| ----------------------------------------- | --------------------------- | ------------------------------------------------------- |
| Rigged per-dart zone accuracy             | ≥90% before private beta    | A usable hypothesis, not market-ready accuracy.         |
| Turn needing any correction               | ≤40%                        | Confirms review UX is tolerable while models improve.   |
| Score proposal latency after dart settles | p95 ≤2.5 s                  | Play cannot feel slower than manual entry.              |
| Setup completion                          | ≥80% of invited testers     | A clever model is useless if people cannot position it. |
| Auto-accept precision                     | ≥99% at published threshold | Never trade trust for coverage.                         |
| Raw-capture sharing rate                  | measured, never mandated    | Indicates consent language and value exchange work.     |

### Mature product target

At a good fixed setup: ≥99% per-dart zone accuracy, <3% turns corrected, p95 proposal latency ≤1 s. A multi-camera accessory/second-device mode may target the DIY-system class of accuracy later; it is not a prerequisite for phone-first launch.

## 5. Non-goals and hard boundaries

- No claim that a single arbitrary phone view has the physical certainty of four fixed cameras.
- No DartCounter score injection through screen scraping, traffic interception, or other ToS-bypassing automation.
- No mandatory account, ad network, facial analysis, or default upload of room video.
- No "auto accept everything" mode in competitive/league contexts without an explicit local rules setting.
- No premature microservice estate. Contracts and replaceable adapters scale better than empty distributed systems.
- No model release based on a cherry-picked demo dataset.

## 6. Users and jobs

| User                       | Job to be done                                               | First value                                                          |
| -------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| Home casual player         | Stop doing arithmetic and keep a friendly game moving.       | Start 501 and confirm a visit in seconds.                            |
| Improving player           | Track practice consistently and understand misses/checkouts. | Honest dart history, heatmaps, averages, checkout routes.            |
| Host / bar night organizer | Run a repeatable scoreboard with less admin.                 | Big-screen display, manual fallback, auditable edits.                |
| League player              | Preserve fair scoring and resolve disputes.                  | Per-dart confirmation, timestamps, replay where enabled.             |
| Vision contributor         | Help improve scores without giving up private room video.    | Optional de-identified board-crop contribution and deletion control. |

## 7. Operating principles

1. **Abstention beats a wrong confident answer.** A low-confidence card is a successful safety action.
2. **Score from geometry, not arbitrary score classification.** The model estimates where the tip entered; deterministic board rules calculate the result.
3. **Every correction is provenance, not shame.** Preserve `auto`, `corrected`, and `manual` source in the event log.
4. **Offline is a core mode.** Networking enriches games; it does not make the board playable.
5. **An angle is not a quality guarantee.** Pose, image scale, focus, glare, occlusion, and temporal stability all matter.
6. **Data is a consented product asset.** Build labeling, evaluation, deletion, and bias analysis before scaling capture.
7. **Rules are law.** Game logic is deterministic, tested, and never embedded in a UI component or ML model.

## 8. Team topology for the stated large-team scenario

Create autonomous streams with a single integration contract, rather than giving every expert the same unbounded task:

| Stream                   | Initial mandate                                  | Owns                                           |
| ------------------------ | ------------------------------------------------ | ---------------------------------------------- |
| Product / design         | testable player journey, monetization, research  | requirements, UX, research ops                 |
| Gameplay platform        | deterministic rules and event log                | `packages/rules`, contracts, conformance suite |
| Mobile platform          | RN shell, offline store, accessibility, release  | `apps/mobile`, native bridge boundary          |
| Vision runtime           | capture, pose, temporal tracking, Core ML/TFLite | `native/vision-core`, platform adapters        |
| ML / data                | labels, training, calibration, evaluation        | `ml/`, dataset governance, model registry      |
| Backend / realtime       | identity, event sync, lobbies, stats projections | `services/api`, persistence, protocol          |
| Platform / security      | CI, environments, privacy, observability         | `infra/`, release gates, incident response     |
| Community / partnerships | test cohort, board/device coverage, integrations | capture program, vendor relationships          |

## 9. Decisions already made

- **Cross-platform product shell:** React Native + Expo development builds.
- **Native performance seam:** no JS frame loop; native adapters own camera frame processing.
- **Camera promise:** any _practical, quality-qualified_ angle, with a cheap mount recommended close to the centerline.
- **Initial game focus:** X01 and Cricket, then practice games.
- **Domain storage:** append-only event log plus disposable projections.
- **Working name:** Darts 180, pending trademark/domain/app-store clearance.

## 10. Decisions still requiring named owners

| Decision                                | Recommended deadline                       | Owner                 |
| --------------------------------------- | ------------------------------------------ | --------------------- |
| Company / trademark / domain clearance  | Before public launch or branding spend     | Founder + counsel     |
| License and contributor agreement       | Before external code contributions         | Founder + legal       |
| Exact supported camera envelope v1      | Before first data capture protocol freezes | Vision lead + product |
| Minimum iOS/Android hardware benchmark  | Before beta invite                         | Mobile + vision leads |
| Data processor / hosting regions        | Before any cloud upload                    | Security + legal      |
| Competitive/league certification policy | Before paid league feature                 | Product + rules lead  |

## 11. Naming risk

On 2026-09-07 the working product name changed from **BullzEye** to **Darts 180**. The preliminary
searches recorded on 2026-09-06 concern the former name and do **not** establish clearance, conflict,
or availability for Darts 180. Treat the current name as an internal working name until a qualified
trademark attorney clears relevant classes, countries, domains, App Store/Google Play listing
conflicts, and visual identity.

## 12. Foundation-phase completion and remaining gate

The repository foundation is now complete: it has the runnable manual scoring demos, shared rules,
development API, guided protected private Data Lab, initial data contracts, synthetic/heuristic
vision baselines, CI, runbooks, and architecture documentation. The authoritative current snapshot
is [`13-current-implementation-status.md`](13-current-implementation-status.md).

This completion is **not** a claim that automatic detection is complete. The next exit gate is a
privacy-reviewed, consented real-capture program plus measured preferred-mount pose/temporal results.
