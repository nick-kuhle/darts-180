# Runbook: model release and rollback

**Audience:** ML/Data, Vision Runtime, Mobile release, Product quality, Platform/SRE  
**Rule:** a model artifact is a production dependency with owners, evidence, a kill switch, and a rollback.

## Preflight checklist

- [ ] Source commit, training config/seed, dataset manifest/split hash, and artifact checksum recorded.
- [ ] Export parity checked for intended Core ML/TFLite runtimes.
- [ ] Sacred evaluation report includes all required slices and confidence calibration.
- [ ] Regression vs current artifact reviewed; no unexplained support-envelope regression.
- [ ] Device performance report: latency, dropped frames, memory, thermals, battery.
- [ ] Privacy/data lineage review passed; no unapproved dataset source.
- [ ] Product copy/support envelope and quality threshold config match evidence.
- [ ] Remote configuration rollout/rollback flags tested in staging.
- [ ] Named on-call owner and support escalation path confirmed.

## Release steps

1. Register immutable artifact/version in model registry; sign/checksum it.
2. Deploy artifact/config to internal cohort with review-all policy.
3. Validate observability: model version, quality/candidate latency, correction, crash and thermal
   telemetry arrive by slice without raw media leakage.
4. Expand to closed beta cohort. Compare live shadow/outcome metrics with baseline.
5. Enable thresholded auto-accept only after precision criteria and product approval.
6. Expand 1% → 10% → planned cohorts, waiting long enough for representative usage each step.
7. Record approval and outcome. Archive prior artifact/config so rollback is one action.

## Rollback triggers

- wrong auto-accepted score above approved error budget;
- correction/false-trigger/calibration failure spike by any supported slice;
- crash loop, severe thermal/battery regression, or corrupted candidate payload;
- privacy/consent/data-lineage defect;
- unexpected incompatibility with current mobile app/native adapter.

## Rollback steps

1. Set remote config to previous artifact or disable automatic proposals/auto-accept for affected
   cohort. Do not wait for app-store review.
2. Verify config receipt on a representative device and inspect live metrics.
3. Notify support/product; provide manual scoring/review fallback language.
4. Preserve event/model-version evidence; do not mutate historical confirmed scores.
5. Open scoring-error incident and determine whether app/native hotfix is needed.
6. Postmortem and regression evaluation are required before the artifact is retried.

## Never do

- swap a model binary in place with no version/checksum;
- tune thresholds using sacred evaluation labels after declaring the set frozen;
- enable broad auto-accept because a demo cohort looks good;
- bypass consent/data lineage to “get more data”; or
- leave a model with no rollback owner.
