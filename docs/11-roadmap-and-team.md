# Roadmap and team operating plan

**Status:** execution plan for a large expert team  
**Important:** unlimited development hours do not remove data, trust, field-testing, app-store, or
legal lead time. Parallelize discovery; do not skip gates.

## 0. Delivery snapshot — 2026-09-07

The foundation slice is delivered: local Git history; a private GitHub destination; CI; a playable
web 501/Cricket prototype; an Expo 501 review demo; deterministic rules and event projections; a
development API; local-only Capture/Annotation Labs; manifest validation; synthetic scenes; and
inspectable pose/temporal baselines. The specific inventory and non-claims live in
[the current implementation status](13-current-implementation-status.md).

**M0 is not fully exited yet.** Remaining exit evidence is an approved consent/retention workflow,
real-board pose/quality measurements, a safe capture rig, current-name legal review, and physical
mobile/browser checks. The next task is not to market an auto-scoring model; it is to collect and
measure trustworthy evidence.

## 1. Workstreams

| Workstream        | First milestone                             | Long-term ownership                     |
| ----------------- | ------------------------------------------- | --------------------------------------- |
| Product / design  | validated DartCard/boarding flow            | games, pricing, research, partnerships  |
| Gameplay          | formal X01/Cricket corpus                   | games platform / statistics             |
| Mobile            | local-first manual scorer, native dev build | iOS/Android app quality                 |
| Vision runtime    | stable pose/quality and temporal pipeline   | performant platform adapters            |
| ML / data         | consented capture + sacred eval             | models, labeling, deployment safety     |
| Backend           | event sync/realtime foundation              | accounts, online, leagues, integrations |
| Security/platform | environments/CI/privacy posture             | SRE, compliance, incident readiness     |
| Community         | board/device cohort                         | field data, beta support, partnerships  |

## 2. Milestone plan

### M0 — Foundation and truth (weeks 1–3)

**Goal:** align the team on the thing being built before expensive CV work diverges.

- Adopt/clear working brand, company, IP/license and contribution policy.
- Execute rules-conformance sprint: expand current tests toward 300+ fixtures.
- Ship the manual local scorer / DartCard prototype to internal devices.
- Establish data governance, capture consent, manifest/label tooling, and sacred-eval ownership.
- Build device/board lab and placement rig; recruit diverse contributors.
- Implement camera setup quality prototype, not automatic score marketing.

**Exit:** every team can run the repo; manual scoring is correct; a privacy-approved capture protocol
exists; pose quality is measured on real boards.

### M1 — Controlled vision alpha (weeks 3–10)

**Goal:** prove the complete single-camera loop on preferred mounts.

- Collect controlled Classes A–D data across target capture matrix.
- Train board-pose and entrypoint baselines; log every experiment.
- Implement native camera adapter / JSI stream / no-JS-frame-loop performance trace.
- Implement temporal tracking and settle state machine against captured sequences.
- Wire ranked candidates/replay/feedback into DartCard; all darts require confirmation.
- Instrument latency, setup failure, top-k, corrections, quality slices.

**Exit:** reproducible preferred-rig result, ≥90% exact zone accuracy on locked internal eval, p95
card ≤2.5s, and no data/privacy shortcut required to demonstrate it.

### M2 — Private beta and generalization (weeks 8–18, overlapping)

**Goal:** learn whether real players keep the camera enabled in normal homes.

- Enroll 20–50 privacy-consented testers with varied boards/devices/rooms.
- Improve model based on labeled failures—not aggregate demo score.
- Expand pose envelope incrementally from centerline toward 55° conditional on slices.
- Add offline persistence, event sync adapter, account-optional history, diagnostics/export.
- Harden native builds, thermal strategy, crash monitoring, remote threshold/model rollback.
- Build support tooling and scored failure triage.

**Exit:** published beta support envelope, ≥95–97% exact-zone accuracy by declared slice, ≥99%
auto-accept precision at threshold, correction/latency evidence, security/privacy review.

### M3 — Product breadth and connected play (months 4–8)

**Goal:** make Darts 180 a compelling darts product even when camera is off.

- Complete 501/Cricket game UX, legs/sets, practice modes, stats/heatmaps/checkout preference.
- Build online invite/spectator/scoreboard/lobby flows and modular backend persistence.
- Add opt-in ML feedback lifecycle / labeling operations / model registry.
- Release Android parity and accessibility/localization baseline.
- Validate pricing: free local play + possible Auto-Referee unlock + online premium.

**Exit:** users choose Darts 180 for games/stats, not merely the camera novelty; connected events are
safe/idempotent/auditable.

### M4 — Reliability edge and ecosystem (months 7–12)

**Goal:** become meaningfully better under difficult real-world geometry.

- Second-phone/multi-camera fusion mode; evaluate inexpensive accessory options only after proving
  need.
- Broaden hard boards, lighting, dart stacks, and off-axis positions through controlled metrics.
- Ship open device/scorer protocol, not proprietary lock-in.
- Pursue sanctioned vendor/league/API partnerships; no reverse-engineering shortcuts.
- Add league/venue features only after referee/dispute/privacy policy is mature.

**Exit:** claimed reliability is evidence-backed, model operations are routine, and integrations do
not compromise player privacy or product independence.

## 3. First 10 working days

| Day | Concrete deliverable                                                               | Current status                                                                                           |
| --: | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
|   1 | Push `main` to private GitHub, assign name/legal owner, and enable CI              | In progress: remote exists; local Git history/CI are ready; current-name legal owner remains needed.     |
|   2 | Rules team reviews X01/Cricket spec and starts fixture corpus                      | Ready: rules/tests exist; expand toward the conformance corpus.                                          |
|   3 | Mobile team installs demo on iOS/Android devices and tests DartCard edits          | Ready for physical-device execution.                                                                     |
|   4 | Vision team freezes landmark/label format and builds safe capture test jig         | Partial: manifest, local Capture/Annotation Labs, synthetic data, and baselines exist; real rig remains. |
|   5 | Privacy team approves capture consent/retention/face-exclusion workflow            | Not started: browser-local safeguards do not replace legal/privacy approval.                             |
|   6 | Capture first 200 controlled board/dart examples across several poses              | Blocked on Day 5 approval and safe intake.                                                               |
|   7 | Native team spikes CameraX/AVFoundation frames + timing trace in dev build         | Not started: interface is seeded; real frame runtime remains.                                            |
|   8 | ML team establishes trained pose/entrypoint experiment and sacred eval split       | Partial: synthetic/heuristic pipeline baseline exists; consented data/model work remains.                |
|   9 | Backend team replaces in-memory-store plan with tested Postgres event-store design | Not started: contract/projection/catch-up baseline exists.                                               |
|  10 | Joint review: show quality dashboard, not just a successful video                  | Pending measured real-capture results.                                                                   |

## 4. Staffing sequence

With a large team, begin parallel but retain accountable leads:

- 1 product lead, 1 design lead, 1 delivery/program lead;
- 2–4 gameplay/full-stack engineers;
- 3–5 mobile engineers split RN/iOS/Android/native bridge;
- 3–6 CV/ML engineers plus data engineer and annotation/QA lead;
- 2–4 backend/realtime engineers;
- 1–3 platform/SRE/security engineers;
- privacy counsel/DPO access, QA/device lab specialists, community/beta support.

Team count is not a substitute for decision rights. Every milestone needs a single DRI and a
cross-functional go/no-go review.

## 5. Top risks and planned controls

| Risk                         | Leading indicator                 | Control                                                        |
| ---------------------------- | --------------------------------- | -------------------------------------------------------------- |
| Single-phone accuracy stalls | boundary/oblique slice weak       | stable mount first, confidence review, second-phone escalation |
| Setup friction kills use     | low calibration completion        | smarter coach, mount design, manual game remains valuable      |
| Competitors move faster      | feature comparison changes        | price/privacy/open/community wedge; fast controlled testing    |
| DartCounter never opens API  | no partner response               | build own ecosystem/open protocol; only sanctioned partnership |
| Name conflict                | search/app-store objection        | legal clearance before launch spend                            |
| Privacy backlash             | low consent/trust/support concern | on-device default, granular consent, no dark patterns          |
| Model overconfidence         | corrected auto-accepted darts     | hard precision gate, kill switch, replay/diagnostics           |
| Scope explosion              | features without metrics          | milestone exits and P0/P1 ownership                            |

## 6. Success scorecard

Leadership review weekly during alpha:

- manual-game completion / retention;
- camera setup success by board/device/pose;
- candidate latency, false triggers, dart-track loss;
- exact-zone/top-k/auto-accept precision by slice;
- review time and correction rate;
- consented data coverage gaps;
- native crash/thermal/battery behavior;
- sync/API reliability and support ticket themes;
- legal/privacy/security gate status.

## 7. Long-term principle

Darts 180 wins only if it is both a trustworthy scoring assistant **and** an enjoyable darts product.
Camera capability earns the first try; accurate rules, player control, good games, fair privacy,
and robust community/online experiences earn repeat use.
