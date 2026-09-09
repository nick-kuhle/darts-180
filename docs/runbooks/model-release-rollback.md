# Runbook: model release and rollback

**Audience:** ML/Data, Vision Runtime, Web release, future Mobile release, Product quality, Platform/SRE
**Rule:** a model artifact is a production dependency with owners, evidence, a kill switch, and a rollback.

For the web-first release, follow the schema-v2 package rules in
[`../17-web-model-artifact-contract.md`](../17-web-model-artifact-contract.md). The checked-in unavailable
manifest is not a candidate release.

## Preflight checklist

- [ ] Source commit, training config/seed, dataset manifest/split hash, and artifact checksum recorded.
- [ ] Browser ONNX artifact, schema-v2 manifest, and public attestation each have immutable versioned paths.
- [ ] `npm run verify:model-artifact --workspace=@darts-180/web` passes with exact ONNX/attestation hashes, production identity binding, and an exact policy match.
- [ ] Parser policy values are the approved held-out calibration values; no UI or remote threshold silently overrides them.
- [ ] Export parity checked for browser ONNX Runtime Web and intended future Core ML/TFLite runtimes.
- [ ] Sacred evaluation report includes all required slices and confidence calibration.
- [ ] Regression vs current artifact reviewed; no unexplained support-envelope regression.
- [ ] Device performance report: latency, dropped frames, memory, thermals, battery.
- [ ] Privacy/data lineage review passed; no unapproved dataset source.
- [ ] Product copy/support envelope and quality threshold config match evidence.
- [ ] Remote configuration rollout/rollback flags tested in staging.
- [ ] Named on-call owner and support escalation path confirmed.

## Release steps

1. Register immutable artifact/version in the model registry and record its checksum.
2. Create the public schema-v2 manifest and attestation from the approved release record; run the artifact verifier.
3. Deploy the static package through the existing web project to an internal cohort with review-all policy.
4. Validate observability: model version, quality/candidate latency, correction, crash and thermal
   telemetry arrive by slice without raw media leakage.
5. Expand to closed beta cohort. Compare live shadow/outcome metrics with baseline.
6. Enable thresholded auto-accept only after precision criteria, approval ID, and product approval.
7. Expand 1% → 10% → planned cohorts, waiting long enough for representative usage each step.
8. Record approval and outcome. Archive the prior immutable package so rollback is one action.

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

- swap a model binary, manifest policy, or attestation in place with no new version/checksum;
- deploy an ONNX file whose hash, provenance/evaluation identity, or approval ID does not exactly match the public attestation;
- tune thresholds using sacred evaluation labels after declaring the set frozen;
- enable broad auto-accept because a demo cohort looks good;
- bypass consent/data lineage to “get more data”; or
- leave a model with no rollback owner.
