# Infrastructure, developer experience, and delivery

**Status:** scalable operational baseline  
**Rule:** operate the smallest secure system that meets the next milestone; automate everything repeatable.

## 1. Local development

```bash
npm install
npm run verify
npm run dev:api
npm run dev:mobile

# Optional when persistence/media adapter work begins
docker compose -f infra/docker-compose.dev.yml up -d

# ML geometry reference only (no GPU required)
cd ml
PYTHONPATH=src python -m unittest discover -s tests -v
```

Current Node workspace packages are TypeScript source workspaces. The mobile app uses Metro
watchfolders to load them. Keep build artifacts and raw ML data out of Git.

## 2. Mobile build/release pipeline

| Stage                     | Tooling                                            | Requirement                                      |
| ------------------------- | -------------------------------------------------- | ------------------------------------------------ |
| UI/manual development     | Expo / Metro                                       | Expo Go can preview non-native camera UI         |
| Native vision development | Expo development build + prebuild / Xcode / Gradle | never rely on Expo Go for frame processors       |
| Internal distribution     | EAS or CI-generated signed builds                  | separate signing credentials by environment      |
| Store submission          | App Store Connect / Play Console                   | privacy labels, camera disclosure, policy review |
| Emergency response        | remote config / feature flag + app hotfix          | disable model/auto-accept without score loss     |

Before first build: replace `com.yourcompany.darts180`, create an EAS project, configure signing in
a secure CI secret manager, and set real environment-specific API endpoints. No secret belongs in
`app.json`, an Expo public variable, or a GitHub Action log.

## 3. Backend deployment evolution

| Stage                  | Deployment                                                        | Why                             |
| ---------------------- | ----------------------------------------------------------------- | ------------------------------- |
| Scaffold               | local Fastify process + in-memory adapter                         | contract testing only           |
| Private beta           | single region container/service + managed Postgres/object storage | low operational load            |
| Connected growth       | multi-AZ database, CDN/WAF, Redis presence if justified           | availability/realtime scale     |
| Global/privacy regions | regional ingress/data boundaries + replicated projections         | legal/latency evidence required |

Containerize the API when deployment begins. Use managed Postgres and object storage before hiring
people to operate databases. GPU training is rented/on-demand and isolated from player production
infrastructure.

## 4. Environments and configuration

| Environment | API             | Database/media               | Model configuration           |
| ----------- | --------------- | ---------------------------- | ----------------------------- |
| local       | localhost       | Docker optional              | fixtures / debug artifact     |
| dev         | shared mutable  | synthetic/internal-consented | experimental, no broad upload |
| staging     | production-like | isolated, scrubbed           | release candidate             |
| production  | controlled      | encrypted/backed up          | approved/staged only          |

Configuration hierarchy: checked-in safe defaults → environment variables/secrets → signed remote
configuration for thresholds/rollout. Validate config at boot. Feature flags must have owner,
expiry, audience, audit trail, and rollback reason.

## 5. CI requirements

Every pull request:

1. install from lockfile;
2. format/lint/typecheck;
3. rules/vision/API tests;
4. Python geometry tests;
5. dependency/secret scan;
6. API contract fixture test;
7. preview build/smoke test when mobile native changes;
8. code-owner review for protected directories.

Every model release adds dataset/model lineage check, frozen evaluation report, artifact checksum,
and approval gate. Every infrastructure change runs plan/review and has a rollback procedure.

## 6. Secrets and access

- Use a centralized vault/CI secret manager; local `.env` remains ignored.
- Different credentials per service/environment; rotate on personnel changes and incidents.
- Require MFA and hardware/passkey preferred access for production, artifact signing, app stores,
  and cloud consoles.
- Use short-lived workload identity rather than long-lived cloud keys where possible.
- Never use a production database dump for local ML experiments or developer debugging.

## 7. Backups, recovery, and data lifecycle

- Point-in-time recovery and encrypted backups for Postgres; test restore regularly.
- Object lifecycle rules enforce short-lived media and deletion requests.
- Event log retention/projection rebuild is tested; restore must retain ordering/uniqueness.
- Define RPO/RTO by feature tier before online GA. Local device data is exportable but cannot be
  silently assumed recoverable after device loss without opted-in sync.

## 8. Cost posture

The expensive resource is expert iteration/data quality, not initial API instances. Start with:

- managed Postgres/object storage/serverless/container for beta;
- device lab/real-board capture equipment;
- rented GPU capacity for bounded experiments;
- paid observability/security only where it removes real launch risk.

Do not self-build GPU infrastructure. Track unit costs per active camera session, synced game,
consented media clip, and training run before pricing a feature.

## 9. Operational runbooks

Required before public beta:

- model rollback and auto-accept kill switch;
- API/database outage / event replay;
- privacy/media deletion request;
- suspected media exposure;
- stuck sync/conflicting score resolution;
- app-store emergency build;
- incident communication and on-call escalation.

Initial capture and scoring-failure runbooks are included under [`docs/runbooks/`](runbooks/).

## 10. Definition of done for platform readiness

A new engineer can bootstrap locally, CI prevents obvious schema/rules regressions, staging mirrors
critical controls, production credentials are isolated/audited, a model can be rolled back without
an app-store delay, and the team has successfully restored a database and processed a media deletion
dril.
