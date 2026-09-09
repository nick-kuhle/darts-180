# Roadmap and team operating plan

**Status:** execution plan for a large expert team  
**Important:** unlimited development hours do not remove data, trust, field-testing, app-store, or
legal lead time. Parallelize discovery; do not skip gates.

## 0. Delivery snapshot — 2026-09-08

The foundation slice is merged through [PR #11](https://github.com/nick-kuhle/darts-180/pull/11),
whose merge base is verified at `0e4fbe24b51584f8c8317c3f07cda1550ae9b4d6`. It includes CI, a playable
web 501/Cricket prototype, an Expo review demo, deterministic rules/event projections, a development API,
local Capture/Annotation tools, and historical browser-camera experiments. The user-reported direct retest
after PR #11 again failed to record a visibly embedded dart, closing the color/frame-difference remediation
line as a production strategy.

[Draft PR #12](https://github.com/nick-kuhle/darts-180/pull/12) on
`feat/web-first-learned-autoscoring` is the first successor implementation: shared learned vision contracts;
a strict same-origin model manifest and release gate; Worker-owned ONNX Runtime Web with WebGPU/WASM fallback
and SHA-256 verification; automatic named-landmark board pose; canonical tracking and deterministic proposals;
normal Live Scoring without manual calibration; and Worker/WASM CSP support. Its model manifest is deliberately
unavailable, so no score is claimed or recorded. The former camera-play and advanced heuristic components are
removed from the shipped route. The existing Vercel production project/URL must be retained for the follow-up
deployment.

The evidence taxonomy and replacement architecture are in
[`16-camera-autoscoring-reset.md`](16-camera-autoscoring-reset.md) and
[the current implementation status](13-current-implementation-status.md).

**M0 is not fully exited yet.** Remaining exit evidence is an approved consent/retention workflow,
real-board pose/quality measurements, browser capture/data instrumentation, a safe multi-camera lab
rig, current-name/FTO legal review, and physical mobile-browser checks. The next task is to collect and measure
trustworthy evidence for learned dart-tip localization—not to market a browser heuristic.

## 1. Workstreams

| Workstream        | First milestone                                         | Long-term ownership                     |
| ----------------- | ------------------------------------------------------- | --------------------------------------- |
| Product / design  | validated Live Scoring/DartCard correction flow         | games, pricing, research, partnerships  |
| Gameplay          | formal X01/Cricket corpus                               | games platform / statistics             |
| Web runtime       | browser Worker/ONNX capture and performance evidence    | browser/local inference platform        |
| Mobile            | reuse locked web contracts in native development builds | iOS/Android app quality                 |
| ML / data         | consented capture + leakage-safe held-out evaluation    | models, labeling, deployment safety     |
| Backend           | event sync/realtime foundation                          | accounts, online, leagues, integrations |
| Security/platform | environments/CI/privacy/CSP posture                     | SRE, compliance, incident readiness     |
| Community         | board/device cohort                                     | field data, beta support, partnerships  |

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

### M1 — Web-first controlled vision alpha (weeks 3–10)

**Goal:** prove the complete browser single-camera loop on measured mounts before native product work.

- Collect controlled Classes A–D data across the target browser/device/board capture matrix.
- Train and export board-pose, orientation, dart-tip, uncertainty, occlusion, and quality baselines to the
  fixed browser tensor contract; log every experiment and artifact hash.
- Exercise Worker-owned WebGPU/WASM execution, high-resolution bursts, canonical temporal tracking, and
  DartCard review against captured sequences.
- Instrument direct HTTPS browser latency, first-load/cache, setup failure, top-k, corrections, memory,
  battery, and thermal/foreground behavior.
- Hold all scoring proposals to review until a production manifest's calibration/evidence gate is earned.

**Exit:** reproducible browser result on a locked internal evaluation set, exact-zone and unsafe-auto-score
metrics by slice, p95 end-to-card latency target, direct-device Worker/CSP evidence, and no data/privacy
shortcut required to demonstrate it.

### M2 — Web beta and generalization (weeks 8–18, overlapping)

**Goal:** establish a declared, evidence-backed browser support envelope in normal homes.

- Enroll privacy-consented testers with varied boards, devices, rooms, lighting, and mount positions.
- Improve models from independently labelled failures—not aggregate demo score—and retain a locked field set.
- Expand angle/distance support only when slice metrics permit it; offer reposition, second view, review, or
  abstention rather than fabricate a score.
- Harden browser model rollback/integrity, quality telemetry without raw-media collection, offline behavior,
  and support triage.
- Begin native adapters only as faithful consumers of the web-validated contracts, model semantics, data
  governance, and decision policy.

**Exit:** published web beta support envelope, reviewed exact-zone/unsafe-auto/review metrics, correction and
latency evidence, security/privacy review, and a decision on whether native reuse or a multi-camera tier is
justified.

### M3 — Native reuse, product breadth, and connected play (months 4–8)

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

| Day | Concrete deliverable                                                                      | Current status                                                                                                                                                                                                                         |
| --: | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | Review Vercel/mobile deployment PR, assign name/legal owner, and enable CI policy         | [PR #1](https://github.com/nick-kuhle/darts-180/pull/1) and [PR #2](https://github.com/nick-kuhle/darts-180/pull/2) are merged; [PR #3](https://github.com/nick-kuhle/darts-180/pull/3), legal owner, and branch policy remain needed. |
|   2 | Rules team reviews X01/Cricket spec and starts fixture corpus                             | Ready: rules/tests exist; expand toward the conformance corpus.                                                                                                                                                                        |
|   3 | Web team installs the direct HTTPS build on iOS/Android browsers and tests DartCard edits | Camera permission/preview can be exercised; real learned scoring remains blocked by the unavailable model release.                                                                                                                     |
|   4 | Vision team freezes browser landmark/tip tensor contract and safe capture test jig        | Partial: shared contracts, Worker, manifest gate, guided Data Lab, and synthetic tests exist; real rig remains.                                                                                                                        |
|   5 | Privacy team approves capture consent/retention/face-exclusion workflow                   | Not started: browser-local safeguards do not replace legal/privacy approval.                                                                                                                                                           |
|   6 | Capture first 200 controlled board/dart examples across several poses                     | Blocked on Day 5 approval and safe intake.                                                                                                                                                                                             |
|   7 | Web runtime team profiles Worker/WASM/WebGPU frames on physical browsers                  | Build and CSP paths exist; direct-device runtime/performance evidence remains.                                                                                                                                                         |
|   8 | ML team establishes trained pose/entrypoint experiment and locked evaluation split        | Partial: synthetic/heuristic historical baseline exists; consented data/model work remains.                                                                                                                                            |
|   9 | Backend team replaces in-memory-store plan with tested Postgres event-store design        | Not started: contract/projection/catch-up baseline exists.                                                                                                                                                                             |
|  10 | Joint review: show quality dashboard, not just a successful video                         | Pending measured real-capture results.                                                                                                                                                                                                 |

## 4. Staffing sequence

With a large team, begin parallel but retain accountable leads:

- 1 product lead, 1 design lead, 1 delivery/program lead;
- 2–4 gameplay/full-stack engineers;
- 3–5 web/platform engineers split browser capture, Worker/ONNX runtime, WebGPU/WASM performance, and later iOS/Android reuse;
- 3–6 CV/ML engineers plus data engineer and annotation/QA lead;
- 2–4 backend/realtime engineers;
- 1–3 platform/SRE/security engineers;
- privacy counsel/DPO access, QA/device lab specialists, community/beta support.

Team count is not a substitute for decision rights. Every milestone needs a single DRI and a
cross-functional go/no-go review.

## 5. Top risks and planned controls

| Risk                         | Leading indicator                   | Control                                                        |
| ---------------------------- | ----------------------------------- | -------------------------------------------------------------- |
| Single-phone accuracy stalls | boundary/oblique slice weak         | stable mount first, confidence review, second-phone escalation |
| Setup friction kills use     | low automatic board-find completion | smarter coach, mount design, manual game remains valuable      |
| Competitors move faster      | feature comparison changes          | price/privacy/open/community wedge; fast controlled testing    |
| DartCounter never opens API  | no partner response                 | build own ecosystem/open protocol; only sanctioned partnership |
| Name conflict                | search/app-store objection          | legal clearance before launch spend                            |
| Privacy backlash             | low consent/trust/support concern   | on-device default, granular consent, no dark patterns          |
| Model overconfidence         | corrected auto-accepted darts       | hard precision gate, kill switch, replay/diagnostics           |
| Scope explosion              | features without metrics            | milestone exits and P0/P1 ownership                            |

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
