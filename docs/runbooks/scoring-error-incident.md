# Runbook: scoring error / model-quality incident

**Audience:** Support, Product, Vision Runtime, ML/Data, Mobile, Security/Privacy  
**Use for:** a wrong suggested/auto-accepted score, repeat misread pattern, unsafe camera behavior,
or a report that may include user-approved diagnostic media.

## Severity guide

| Severity | Example                                                                             | Immediate action                                                  |
| -------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| S1       | repeat wrong auto-accepted scores; safety/privacy issue; a whole device class fails | disable affected auto-accept/model cohort; incident lead assigned |
| S2       | one model/board/angle slice has elevated corrections                                | pause rollout for slice; route all to review/manual               |
| S3       | isolated uncertain score correctly routed to review                                 | log/label, no emergency action                                    |
| S4       | UI typo/non-scoring cosmetic problem                                                | normal backlog unless accessibility blocked                       |

A single wrong **reviewed** suggestion is not necessarily a model emergency. A wrong score silently
committed or a misleading confidence state is high priority.

## First 15 minutes

1. Thank player; do not imply they threw incorrectly.
2. Capture non-sensitive facts: app/build/model version, device/OS, board profile, camera setup
   status, timestamp, predicted candidates, chosen correction, and whether a score auto-accepted.
3. Ask for a diagnostic clip only if user explicitly offers/consents. Never request a full room video
   by default.
4. Check dashboard for cohort spike (model, device, board, off-axis/light, latency, crash).
5. If S1/S2 signal, use feature flag to raise review threshold or disable auto proposals. Preserve
   manual scoring and local game history.
6. Open incident ticket with severity, DRI, customer impact, and privacy classification.

## Triage

Classify root symptom:

- setup/pose quality gate should have rejected;
- calibration drift / board moved;
- temporal track/order failure;
- entrypoint/ring/wedge error;
- confidence calibration failure;
- UI correction/turn-confirm bug;
- rules-engine/projection bug;
- device thermal/frame drop/native crash;
- sync/API mismatch;
- privacy/media handling defect.

Reproduce with a synthetic fixture or approved de-identified diagnostic. Do not copy personal media
into chat, issue tracker, or a public test fixture.

## Mitigation options

1. Tighten quality gate / reduce support envelope.
2. Raise auto-accept threshold / minimum wire margin.
3. Turn uncertain mode into review-all for affected cohort.
4. Roll back model artifact remotely.
5. Disable problematic native camera mode by app/device/model version.
6. Fix rules/UI/API bug with test first; app release if configuration cannot mitigate.
7. If media/privacy related, invoke security/privacy incident process immediately.

Never rewrite past player-confirmed darts to conceal a model failure. Correct via visible domain
correction when the player chooses it.

## Closure

- Root cause / contributing conditions documented.
- Reproduction fixture, regression test, and metrics slice added.
- Rollback or threshold change verified on target device.
- Customer communication sent where applicable.
- Model/data team decides whether consented example can enter labeling queue.
- Postmortem includes why existing quality gate, model review, monitoring, or UX did not catch it.
