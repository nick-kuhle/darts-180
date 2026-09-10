# Darts 180 — camera-assisted darts scoring

> **Working-name warning:** `Darts 180` is a product codename, not a cleared trademark. The name
> research retained in this repository concerns the former BullzEye working name and does not assess
> Darts 180. See [`LICENSE-NOTICE.md`](LICENSE-NOTICE.md) before public launch or an app-store listing.

Darts 180 is a web-first darts scorer that watches a physical dartboard, proposes each dart's score,
and makes the player the final authority. Its product promise is not “AI never misses”; it is
**fast, explainable, confirmable scoring with a graceful manual fallback**. Native iOS and Android apps
follow after the browser scorer has a validated perception contract and evidence base.

## The decision record encoded here

| Decision                                                 | Implementation consequence                                                                                                                                      |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Web scoring first; native apps second**                | The deployed Vite/React app is the first production inference target: browser-local ONNX/Worker inference, shared geometry/contracts, then native reuse.        |
| **Cheap stable mount; broad angles only where measured** | Learned complete-board pose/tip inference and an automatic quality coach target the demonstrated single-phone envelope; unsupported views are refused honestly. |
| **Large expert team / unlimited development capacity**   | The repo separates product, game rules, shared perception contracts, web runtime, native reuse path, ML tooling, API, and infrastructure immediately.           |
| **Name: Darts 180**                                      | Used as a codename throughout, pending counsel.                                                                                                                 |

## Reality check on “any angle”

Darts 180 must automatically detect a standard board's complete geometry/orientation and adapt its
capture/model path to practical phone angle, distance, brightness, and lighting—not ask a player to fit a
guide. A single camera can normalize a planar board using pose estimation and a homography, but cannot
truthfully recover an entry point when the board is out of frame/tiny/blurred, the image is saturated/dark,
or the tip is completely hidden. Darts 180 therefore supports **adaptive placement**, with an automatic
setup quality coach rather than player calibration:

- preferred single-phone starting point: a stable mount **about one metre away and slightly off-axis**,
  so the camera can see both the face and a dart projecting from it;
- supported target: full board/number ring visible, sufficient effective resolution, even light, low glare,
  and an automatic model-specific readiness decision; and
- otherwise: show a specific automatic adjustment, retain manual entry, or offer a second/mobile-rig
  camera tier when the measured evidence supports it.

The approximately-one-metre, slightly off-axis position is a helpful default rather than a player-facing
requirement. The quality model must accept any practical view with sufficient information and automatically
suggest a simple move only when it cannot measure safely. The browser Camera Play replacement is the first
production scorer, but it remains model-gated until a trained model passes held-out real-device evaluation;
the reset is recorded in [`docs/16-camera-autoscoring-reset.md`](docs/16-camera-autoscoring-reset.md).

## What is implemented now

- A runnable Expo/React Native **501 confirmation-flow demo**: automatic-looking dart cards,
  manual correction, double-out/bust logic, checkout hint, and a real camera-setup preview.
- A deployable **web product** with interactive manual board input, 501 and Cricket, event-style
  history, local-only Capture and Annotation Labs, Vercel static hosting/security configuration, and a
  browser-local learned-vision Camera Play runtime: same-origin manifest/release gates, Worker-owned
  ONNX Runtime Web, model-byte integrity verification, WebGPU/WASM fallback, automatic named-landmark
  board pose, canonical tip-to-score proposals, review/abstention safeguards, and no normal-flow manual
  calibration controls.
- An archived experimental browser color/frame-difference baseline. Its Camera Play components, scoring
  modules, and associated synthetic tests were removed after physical-device failure; the historical record
  remains in documentation and is not a runtime fallback.
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

There is no lawful trained production detection model, production authentication, durable database adapter,
or guarantee of score accuracy. The checked-in learned Camera Play manifest is intentionally unavailable, so
the browser runtime must not record a score until its ONNX artifact, calibrated decision policy, hash-bound
public release attestation, provenance, and held-out real-device evaluation gate exist. Native apps reuse that
validated contract afterward. The old
browser frame-difference remediation is archived and is not a reason to relax thresholds or restore a fallback
scorer.

## Repository map

```text
apps/mobile/                Expo + React Native product shell for later web-proven vision reuse
apps/web/                   Deployable Vite/React scorer; web-first learned camera runtime target
packages/contracts/         API/web/native wire contracts and perception boundary
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

# Terminal 2 — browser scorer at http://localhost:4173
npm run dev:web

# Optional Terminal 3 — later Expo/native reuse shell
npm run dev:mobile
```

The web-first camera runtime is tested through the deployed HTTPS browser app. The later native
frame processor will need a native **development build**, not Expo Go:

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
remediation in [PR #6](https://github.com/nick-kuhle/darts-180/pull/6), and the first reliability
follow-up in [PR #7](https://github.com/nick-kuhle/darts-180/pull/7). A direct post-merge iPhone
report found better automatic board finding but materially failed dart resolution. The dedicated
post-field-report remediation in [PR #8](https://github.com/nick-kuhle/darts-180/pull/8) and its
baseline-recovery follow-up in [PR #9](https://github.com/nick-kuhle/darts-180/pull/9) and the
bounded Start Play handoff in [PR #10](https://github.com/nick-kuhle/darts-180/pull/10) are merged.
PR #10's direct iPhone retest successfully reached **Watching Locally**, but intermittent acquisition
and live temporal detection recorded none of the shown darts. The user subsequently reported
[PR #11](https://github.com/nick-kuhle/darts-180/pull/11) merged and closed; its direct post-merge
retest still failed to record a visibly embedded dart. `origin/main` is independently verified at
`0e4fbe24b51584f8c8317c3f07cda1550ae9b4d6` (the PR #11 merge commit).
[Draft PR #12](https://github.com/nick-kuhle/darts-180/pull/12) contains the learned browser-runtime
replacement and intentionally keeps its model manifest unavailable; it is not a completed or deployable
physical dart scorer. The browser-remediation line is an archived diagnostic baseline, not an accuracy
claim. See [`docs/16-camera-autoscoring-reset.md`](docs/16-camera-autoscoring-reset.md).

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
7. [`docs/16-camera-autoscoring-reset.md`](docs/16-camera-autoscoring-reset.md) — September 2026
   research decision: replace the browser heuristic with web-first learned single-camera scoring, later
   native reuse, and a high-confidence multi-camera tier.
8. [`docs/17-web-model-artifact-contract.md`](docs/17-web-model-artifact-contract.md) — binding
   browser/native-portable tensor, manifest, integrity, release, and evidence requirements.
9. [`docs/14-browser-camera-field-test.md`](docs/14-browser-camera-field-test.md) and
   [`docs/15-browser-dart-field-remediation.md`](docs/15-browser-dart-field-remediation.md) — the
   future model-release field protocol and the archived browser failure history.
10. [`docs/21-private-github-actions-model-build.md`](docs/21-private-github-actions-model-build.md) —
    manual-only private Blob retrieval, aggregate review, and development-model build path for a
    protected GitHub Actions environment.

Market research is time-stamped and intentionally separate in
[`docs/research/2026-09-market-landscape.md`](docs/research/2026-09-market-landscape.md); the
research decision and current source limits are in
[`docs/16-camera-autoscoring-reset.md`](docs/16-camera-autoscoring-reset.md). Re-check competitor
terms/prices before any public claim.

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
