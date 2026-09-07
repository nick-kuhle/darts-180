# Darts 180 documentation map

This documentation set is written as an execution baseline, not marketing collateral. Each document
names what is known, what is a deliberate hypothesis, and what must be proven in field data.

## Read in this order

|   # | Document                                                             | Question answered                                                    |
| --: | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
|  00 | [Project charter](00-project-charter.md)                             | Why Darts 180 exists, its boundaries, and the decisions already made |
|  01 | [Product requirements](01-product-requirements.md)                   | What a player must be able to do in each release slice               |
|  02 | [System architecture](02-system-architecture.md)                     | Which seams allow cross-platform speed and native-scale performance  |
|  03 | [Detection engine](03-detection-engine.md)                           | How phone video becomes a conservative per-dart proposal             |
|  04 | [ML/data/evaluation](04-ml-data-and-evaluation.md)                   | How models are trained, measured, and safely released                |
|  05 | [Game rules](05-game-rules.md)                                       | Exact X01/Cricket behavior and test standard                         |
|  06 | [Mobile UX](06-mobile-ux.md)                                         | Setup, DartCard review, accessibility, and recovery flows            |
|  07 | [API/realtime](07-api-and-realtime.md)                               | Event sync, protocol, and external-integration stance                |
|  08 | [Security/privacy](08-security-privacy.md)                           | Camera/media/identity controls and governance                        |
|  09 | [Quality/release](09-quality-release.md)                             | Test pyramid, SLOs, model and app release gates                      |
|  10 | [Infra/DevOps](10-infra-devops.md)                                   | Environments, CI/CD, local tools, rollout, operations                |
|  11 | [Roadmap/team](11-roadmap-and-team.md)                               | Parallel workstreams, milestones, staffing, risk controls            |
|  12 | [Web demo / Vercel](12-web-demo-and-vercel.md)                       | What can be shared today and how to deploy it safely                 |
|  13 | [Current implementation status](13-current-implementation-status.md) | What is complete, validated, deferred, and next                      |
|  14 | [Browser camera field test](14-browser-camera-field-test.md)         | How to conduct the local, fixed-camera real-board test safely        |

## Decision records

- [ADR-0001 — Cross-platform UI, native vision](adr/0001-cross-platform-first.md)
- [ADR-0002 — Append-only game events](adr/0002-event-sourced-games.md)
- [ADR-0003 — Quality-qualified adaptive camera contract](adr/0003-adaptive-camera-contract.md)

## Operating runbooks

- [Controlled field capture](runbooks/field-capture.md)
- [Capture Lab local workflow and approved handoff](runbooks/capture-lab.md)
- [Local Annotation Lab workflow](runbooks/local-annotation.md)
- [Scoring error / model-quality incident](runbooks/scoring-error-incident.md)
- [Model release and rollback](runbooks/model-release-rollback.md)

## External research

- [Market landscape, dated 2026-09-06](research/2026-09-market-landscape.md)
- [OpenAPI v0](openapi.yaml)

## Documentation rules

1. A document that makes an external market, pricing, compatibility, law, or benchmark claim must
   cite a source and date it.
2. A design decision that affects multiple teams receives an ADR.
3. A feature cannot be called “done” solely because it has a UI; requirements, test strategy,
   operational behavior, privacy impact, and owner are documented.
4. Replace hypotheses with measured results; preserve the decision history rather than rewriting
   it to look inevitable.
5. Public claims require product/legal/vision approval and a re-check of dated competitive research.
