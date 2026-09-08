# Darts 180 — camera-assisted darts scoring

> **Working-name warning:** `Darts 180` is a product codename, not a cleared trademark. The name
> research retained in this repository concerns the former BullzEye working name and does not assess
> Darts 180. See [`LICENSE-NOTICE.md`](LICENSE-NOTICE.md) before public launch or an app-store listing.

Darts 180 is a cross-platform mobile darts app that watches a dartboard, proposes each dart's
score, and makes the player the final authority. Its product promise is not “AI never misses”; it
is **fast, explainable, confirmable scoring with a graceful manual fallback**.

## The decision record encoded here

| Decision                                               | Implementation consequence                                                                                                                                      |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cross-platform first; native apps later**            | React Native + Expo development builds own UI. High-rate vision is isolated behind a native TurboModule contract.                                               |
| **Any practical camera angle; cheap mount preferred**  | Adaptive pose/calibration is designed in from day one. A quality gate refuses impossible views rather than pretending certainty.                                |
| **Large expert team / unlimited development capacity** | The repo separates product, game rules, vision session policy, native runtime, ML tooling, API, and infrastructure immediately—without premature microservices. |
| **Name: Darts 180**                                    | Used as a codename throughout, pending counsel.                                                                                                                 |

## Reality check on “any angle”

A single camera can normalize a planar board seen at an oblique angle using pose estimation and a
homography. It cannot recover an entry point reliably when the board is tiny, blurred, blocked, or
so oblique that the dart point is hidden. Darts 180 therefore supports **adaptive placement**, with
an explicit setup quality coach:

- preferred: camera near the board centreline, **0.7–1.2 m** away, a little above the bull;
- supported target: full board visible, diameter ≥480 px, estimated off-axis pose ≤55°;
- otherwise: show a specific adjustment, retain manual entry, or later offer a second-phone mode.

That is how we can honestly compete with a purpose-built multi-camera system while preserving a
low-cost phone-first setup. Full design: [`docs/03-detection-engine.md`](docs/03-detection-engine.md).

## What is implemented now

- A runnable Expo/React Native **501 confirmation-flow demo**: automatic-looking dart cards,
  manual correction, double-out/bust logic, checkout hint, and a real camera-setup preview.
- A polished, deployable **web prototype** with interactive manual board input, 501 and Cricket,
  event-style history, local-only Capture and Annotation Labs, and Vercel static hosting/security
  configuration.
- An experimental browser-local **Camera Play** field-test workflow: automatic red/green board-color
  finding, a visible 20-up guide, a one-tap local baseline via **Start Play**, automatic temporal
  dart-shape score proposals, and DartCard correction when needed. Visual-guide gestures remain an
  optional recovery path rather than normal setup.
- Deterministic TypeScript rules for standard board geometry, X01 (straight/double/master in/out),
  Cricket (including correct bull marks), checkout routes, and correction-aware event projection,
  with executable tests.
- A pure vision-session state machine that enforces settle time, quality gates, three dart slots,
  review routing, and board-clear handling.
- A Fastify **development** API with idempotent append-only game events, X01/Cricket snapshots,
  ordered event catch-up, WebSocket fan-out, runtime validation, OpenAPI, and test coverage.
- A Rust native-geometry seed; Python capture/sidecar validation CLI; deterministic synthetic scenes;
  inspectable pose/quality and before/after temporal baselines; Postgres migration, local infra,
  CI, ADRs, runbooks, and a full design-doc set.

For an exact done/next/non-claim snapshot, read
[`docs/13-current-implementation-status.md`](docs/13-current-implementation-status.md).

### What is deliberately **not** claimed yet

There is no trained detection model, no production authentication, no durable database adapter,
no DartCounter integration, and no guarantee of score accuracy. The web Camera Play workspace is a
transparent browser-local frame-difference field-test heuristic—not a trained or proven production
auto-scoring claim; the native score stream remains a transparent simulation until the native CV
milestone lands. See
[`docs/14-browser-camera-field-test.md`](docs/14-browser-camera-field-test.md) for its required
mount, automatic-board-find, review, privacy, and failure boundaries.

## Repository map

```text
apps/mobile/                Expo + React Native product shell and confirm-flow demo
apps/web/                   Deployable Vite/React manual-scoring and camera-review prototype
packages/contracts/         API/mobile/native wire contracts
packages/rules/             Deterministic board, X01, Cricket, checkout rules + tests
packages/vision-session/    Testable settle / confidence / review orchestration
native/vision-core/         Rust geometry + native runtime boundary seed
ml/                         Training, evaluation, data contract, export configuration
services/api/               Fastify event-log / realtime development API
infra/                      Postgres schema and local Docker Compose
scripts/                    Repository utilities (added as the platform grows)
docs/                       Product, CV, data, UX, protocol, security, quality and ops specs
```

## Local quick start

Prerequisites: Node 20.19+ / npm 10+, a current iOS or Android toolchain for device work, Docker
for the optional local services, and Python 3.11+ for ML tooling.

```bash
# From repository root
npm install
npm run verify

# Terminal 1 — API on http://localhost:8787
npm run dev:api

# Terminal 2 — Expo app
npm run dev:mobile

# Optional Terminal 3 — browser prototype at http://localhost:4173
npm run dev:web
```

The first camera-preview demo can use Expo Go. The actual frame processor needs a native
**development build**, not Expo Go:

```bash
cd apps/mobile
npx expo prebuild --clean
npx expo run:ios       # macOS/Xcode required
# or npx expo run:android
# or: eas build --profile development --platform all
```

Start the Phase-2 local dependencies only when the durable adapter is being implemented:

```bash
docker compose -f infra/docker-compose.dev.yml up -d
```

## Private GitHub delivery

The private repository at `https://github.com/nick-kuhle/darts-180.git` has its initial foundation,
browser field test, and Vercel app-root/mobile-camera deployment preparation merged into `main`
through [PR #1](https://github.com/nick-kuhle/darts-180/pull/1),
[PR #2](https://github.com/nick-kuhle/darts-180/pull/2), and
[PR #3](https://github.com/nick-kuhle/darts-180/pull/3), the initial Camera Play simplification in
[PR #4](https://github.com/nick-kuhle/darts-180/pull/4), automatic board finding in
[PR #5](https://github.com/nick-kuhle/darts-180/pull/5), and the initial browser-camera reliability
remediation in [PR #6](https://github.com/nick-kuhle/darts-180/pull/6). The follow-up reliability
work is in [PR #7](https://github.com/nick-kuhle/darts-180/pull/7) and awaits direct field
validation; synthetic tests alone do not make it merge-ready.

Verify each pull request's GitHub Actions checks and protect `main` with review policy. No credential
is stored in this repository; revoke any short-lived delivery token after confirming a delivery.

Before public launch, choose a licence/contributor policy, replace placeholder mobile package IDs
(`com.yourcompany.darts180`), replace the temporary individual `CODEOWNERS` mapping with organization
teams, and complete current-name trademark clearance.

### Deploy the safe web prototype

The root `vercel.json` is ready for a static Vercel deployment. It intentionally deploys only the
browser demo—not the unfinished API or camera model. Follow the no-credentials-needed guide in
[`docs/12-web-demo-and-vercel.md`](docs/12-web-demo-and-vercel.md).

## Documentation guide

Start here, in order:

1. [`docs/00-project-charter.md`](docs/00-project-charter.md) — product thesis, non-negotiables,
   success metrics, and team topology.
2. [`docs/01-product-requirements.md`](docs/01-product-requirements.md) — personas, MVP scope,
   use cases, and acceptance criteria.
3. [`docs/02-system-architecture.md`](docs/02-system-architecture.md) — boundaries and scaling path.
4. [`docs/03-detection-engine.md`](docs/03-detection-engine.md) — the end-to-end computer-vision
   design and honest limits of one-phone scoring.
5. [`docs/04-ml-data-and-evaluation.md`](docs/04-ml-data-and-evaluation.md) — data moat, labels,
   metrics, release gates, and model operations.
6. [`docs/05-game-rules.md`](docs/05-game-rules.md) through
   [`docs/11-roadmap-and-team.md`](docs/11-roadmap-and-team.md) — gameplay, UX, API, privacy,
   quality, operations, and delivery plan.

Market research is time-stamped and intentionally separate in
[`docs/research/2026-09-market-landscape.md`](docs/research/2026-09-market-landscape.md); re-check
competitor terms/prices before any public claim.

## Core principles

1. **Player is final authority.** Never silently change a score; corrections are first-class events.
2. **Offline-first.** A house game works without an account or network.
3. **Vision earns trust.** Show confidence, boundary risk, and replay where relevant; abstain when
   unsure.
4. **One physics model.** Model predicts an entry point; deterministic canonical geometry scores it.
5. **Privacy by default.** On-device scoring and explicit opt-in only for de-identified training data.
6. **Scale by replacing adapters, not rewriting the product.** Keep stable contracts at every seam.

## Important external-integration position

Target Omni officially connects to DartCounter, but a public, sanctioned DartCounter third-party
score-injection API was not identified during September 2026 research. Do not build brittle UI
automation or scrape private app traffic. Darts 180 should own its game platform and publish an
opt-in/open integration protocol; pursue a DartCounter partnership only through a commercial/API
agreement.
