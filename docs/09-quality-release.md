# Quality, reliability, and release gates

**Status:** engineering quality plan  
**Goal:** prove that a score is trustworthy enough for its claimed product context—not just that a demo works.

## 1. Quality pyramid

```text
                controlled field pilots + model release review
             device farm / real-board scenario suites / e2e flows
          API contract + offline sync + native bridge integration tests
       rules / geometry / state-machine / schema / unit tests
```

The base must be cheap, fast, deterministic. A model benchmark does not excuse broken X01 bust
math; a beautiful UI does not excuse a dropped offline event.

## 2. Test ownership

| Layer          | Minimum tests                                                   | Owner             |
| -------------- | --------------------------------------------------------------- | ----------------- |
| Contracts      | valid/invalid payload fixtures, backwards compatibility         | gameplay/backend  |
| Rules          | conformance corpus, properties, checkout/bust/Cricket variants  | gameplay          |
| Vision session | settle, track loss, quality gates, review routing               | vision + gameplay |
| Native runtime | camera lifecycle, frame timing, pose/decoder differential tests | vision runtime    |
| ML             | held-out accuracy/calibration/slice reports/reproducibility     | ML/data           |
| Mobile         | component, accessibility, offline persistence, navigation       | mobile            |
| API            | idempotency, auth, ordering, conflict, WS reconnection          | backend           |
| E2E            | create game → confirm/correct → offline → reconnect → export    | cross-functional  |
| Security       | SAST/dependency/secret scans, authz/media isolation             | platform/security |

## 3. Rules conformance standard

Build a machine-readable corpus that every future TypeScript/Rust/Kotlin/Swift implementation
executes. Initial production bar: **300+ cases**, then grow with every bug.

Required categories:

- every ring/segment/bull/miss validity case;
- geometry boundaries and standard board order;
- X01 start/finish/bust, double/master in/out, one/two/three dart visits;
- multi-player turn rotation, legs/sets, corrections/replays;
- Cricket marks, bull asymmetry, overflow scoring, lead/trailing win state;
- planned-game house-rule settings;
- statistics denominators and historical projection versions.

Property tests should include: invalid zone rejected; a bust returns exactly to turn-start state;
projection from event log is deterministic; a correction changes only dependent projection state.

## 4. Vision evaluation gates

The full methodology is in [ML/data](04-ml-data-and-evaluation.md). Release review requires:

1. frozen sacred evaluation dataset and its hash;
2. candidate model artifact checksum, training source/data/config lineage;
3. exact-zone, ring, wedge, boundary, top-k, latency, trigger, calibration metrics;
4. all metrics stratified by declared support envelope;
5. confidence calibration plot and auto-accept precision/coverage;
6. regression comparison to current production model;
7. mobile thermal/battery/memory benchmarks on target hardware;
8. qualitative failure review including every severe correction/fallback pattern;
9. approved rollout/rollback plan and named on-call owner.

A model cannot improve a global number while regressing a previously supported phone/board/angle
slice without explicit product decision and updated support claims.

## 5. Field pilot protocol

- Invite a diverse set of 20–50 initial players with clear beta terms; do not recruit only staff or
  ideal home setups.
- Capture user consent, board/device/placement metadata, and pre-flight quality outcome.
- Require human confirmation for every turn at first; measure time, correction, and frustration.
- Review all auto-accepted mistakes as severity-one model-quality events.
- Observe setup drop-offs, not only successful matches.
- Maintain support response target and ability to disable model remotely.

Success is a player choosing to leave the camera on because it helps, not a one-time demo score.

## 6. SLOs and error budgets

| Service/experience                | SLO target                                | Measurement                   |
| --------------------------------- | ----------------------------------------- | ----------------------------- |
| Local manual score action         | immediate / no network dependency         | device trace                  |
| Camera quality update             | p95 < 500 ms after frame availability     | native trace                  |
| Candidate card, beta              | p95 ≤1.5 s after settle                   | device trace                  |
| Confirmed event persistence local | 99.99% before UI success toast            | transaction audit             |
| API event append                  | 99.9% monthly, p95 <300 ms regional       | server metrics                |
| Sync durability                   | no acknowledged server event loss         | sequence/audit reconciliation |
| WebSocket delivery                | best effort; REST gap recovery guaranteed | client sequence metrics       |
| Media deletion request            | policy-defined SLA                        | privacy audit                 |

Offline local scoring has no server availability error budget. A cloud outage is never allowed to
prevent a house game.

## 7. Release stages

| Stage                  | Audience                     | Vision behavior                        | Exit criteria                                |
| ---------------------- | ---------------------------- | -------------------------------------- | -------------------------------------------- |
| Internal               | team/test boards             | review every dart                      | deterministic tests + basic device stability |
| Closed technical alpha | skilled capture cohort       | review every dart; no marketing claim  | data/quality feedback loop working           |
| Private beta           | 20–50 diverse players        | thresholded cards but explicit confirm | setup/correction/latency gates               |
| Expanded beta          | opt-in regions/devices       | staged auto-accept after calibration   | held-out model and support gates             |
| General availability   | published supported envelope | clear fallback/replay                  | security/privacy/ops/accuracy sign-off       |

## 8. Observability and diagnostics

A support diagnostic bundle should contain: app/build/model version, device/OS, board profile,
quality summary, calibration residual, event timings, candidate top-k/margin, outcome/correction,
and a user-approved local clip reference if relevant. It must exclude unrelated raw video and
account secrets.

Dashboard segmentation: no personal raw media, no temptation to use “one accuracy number.”
Alert on candidate latency, pose/calibration failure, correction spike, dropped frames, model
crash, upload/consent errors, API event rejection, and sync backlog.

## 9. Rollback rules

- Feature flags may select a reviewed immutable model-release package, disable camera proposals, or
  control separately consented research upload. They must **not** independently relax auto-record,
  quality, pose, wire, posterior, or temporal thresholds outside that package's hash-bound manifest
  and attestation.
- A correction spike, high-severity wrong auto-accept, privacy defect, native crash loop, or severe
  slice regression is sufficient to disable automatic proposals remotely.
- Model rollback retains raw local game events; it does not rewrite past confirmed scores.
- Post-release changes use experiment cohorts and documented holdout analysis, not anecdotal wins.

## 10. Definition of production-ready

A release is ready when people can score manually offline with zero data sharing, camera scoring
fails safely, correctness claims are backed by frozen evaluation, sync is idempotent/auditable,
privacy/deletion/security checks pass, and support can diagnose/recover a problem without asking a
customer to hand over their room video.
