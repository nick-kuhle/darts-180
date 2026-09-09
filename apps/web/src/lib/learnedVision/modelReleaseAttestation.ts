import type {
  PublicModelReleaseAttestation,
  VisionModelArtifactManifest,
  VisionModelDecisionPolicy,
} from '@darts-180/contracts';

import { parseVisionModelDecisionPolicy } from './modelDecisionPolicy';

/**
 * Parse the safe, hash-bound public release attestation checked by CI and re-verified by the
 * Worker before production inference. It contains release traceability only; the Worker separately
 * verifies the ONNX bytes before creating a session.
 */
export function parsePublicModelReleaseAttestation(value: unknown): PublicModelReleaseAttestation {
  if (!isRecord(value)) throw new Error('Model release attestation must be an object.');
  if (value.schemaVersion !== 1) throw new Error('Unsupported model release attestation schema.');
  if (!isRecord(value.evaluation))
    throw new Error('Model release attestation evaluation is required.');

  return {
    schemaVersion: 1,
    modelId: requiredString(value.modelId, 'modelId'),
    modelVersion: requiredString(value.modelVersion, 'modelVersion'),
    modelSha256: requiredSha256(value.modelSha256, 'modelSha256'),
    outputContract: readOutputContract(value.outputContract),
    trainingDataId: requiredString(value.trainingDataId, 'trainingDataId'),
    licenseReviewId: requiredString(value.licenseReviewId, 'licenseReviewId'),
    heldOutEvaluationId: requiredString(value.heldOutEvaluationId, 'heldOutEvaluationId'),
    evaluatedAt: requiredIsoTimestamp(value.evaluatedAt, 'evaluatedAt'),
    approvalId: requiredString(value.approvalId, 'approvalId'),
    decisionPolicy: parseVisionModelDecisionPolicy(value.decisionPolicy, {
      requireHeldOutEvaluationId: true,
    }),
    evaluation: {
      evaluatedDartCount: requiredPositiveInteger(
        value.evaluation.evaluatedDartCount,
        'evaluation.evaluatedDartCount',
      ),
      exactScoreRate: requiredProbability(
        value.evaluation.exactScoreRate,
        'evaluation.exactScoreRate',
      ),
      unsafeAutoRecordRate: requiredProbability(
        value.evaluation.unsafeAutoRecordRate,
        'evaluation.unsafeAutoRecordRate',
      ),
      reviewOrAbstainRate: requiredProbability(
        value.evaluation.reviewOrAbstainRate,
        'evaluation.reviewOrAbstainRate',
      ),
    },
  };
}

/**
 * Refuse a production attestation that describes any artifact or release decision other than the
 * manifest deployed with it. IDs are compared exactly so an old approval cannot be relabeled for
 * new weights or a changed output contract.
 */
export function assertAttestationMatchesManifest(
  attestation: PublicModelReleaseAttestation,
  manifest: VisionModelArtifactManifest,
): void {
  if (manifest.releaseStage !== 'production') {
    throw new Error('Only production manifests may be matched with a release attestation.');
  }
  const expected = {
    modelId: manifest.modelId,
    modelVersion: manifest.modelVersion,
    modelSha256: manifest.sha256,
    outputContract: manifest.outputContract,
    trainingDataId: manifest.provenance.trainingDataId,
    licenseReviewId: manifest.provenance.licenseReviewId,
    heldOutEvaluationId: manifest.decisionPolicy.heldOutEvaluationId,
    evaluatedAt: manifest.provenance.evaluatedAt,
    approvalId: manifest.releaseEvidence.approvalId,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (value === null || attestation[field as keyof typeof attestation] !== value) {
      throw new Error(`Model release attestation ${field} does not match the production manifest.`);
    }
  }
  if (!sameDecisionPolicy(attestation.decisionPolicy, manifest.decisionPolicy)) {
    throw new Error(
      'Model release attestation decision policy does not match the production manifest.',
    );
  }
}

function sameDecisionPolicy(
  left: VisionModelDecisionPolicy,
  right: VisionModelDecisionPolicy,
): boolean {
  return (
    left.autoRecordEnabled === right.autoRecordEnabled &&
    left.minAutoScoreProbability === right.minAutoScoreProbability &&
    left.minAutoScoreWireMarginMm === right.minAutoScoreWireMarginMm &&
    left.minReviewProbability === right.minReviewProbability &&
    left.minZonePosteriorMargin === right.minZonePosteriorMargin &&
    left.minLandmarkConfidence === right.minLandmarkConfidence &&
    left.maxPoseValidationResidualMm === right.maxPoseValidationResidualMm &&
    left.maxQualityOffAxisDegrees === right.maxQualityOffAxisDegrees &&
    left.minBoardDiameterPixels === right.minBoardDiameterPixels &&
    left.minOverallQuality === right.minOverallQuality &&
    left.minBoardCoverage === right.minBoardCoverage &&
    left.minSharpness === right.minSharpness &&
    left.maxGlareRisk === right.maxGlareRisk &&
    left.maxOcclusionRisk === right.maxOcclusionRisk &&
    left.tipTrackMatchDistanceMm === right.tipTrackMatchDistanceMm &&
    left.tipTrackSettleMs === right.tipTrackSettleMs &&
    left.tipTrackStaleAfterMs === right.tipTrackStaleAfterMs &&
    left.maxTipTrackSpreadMm === right.maxTipTrackSpreadMm &&
    left.confidenceTemperature === right.confidenceTemperature &&
    left.confidenceBias === right.confidenceBias &&
    left.heldOutEvaluationId === right.heldOutEvaluationId
  );
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

function requiredSha256(value: unknown, name: string): string {
  const hash = requiredString(value, name);
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new Error(`${name} must be a lowercase SHA-256 hash.`);
  }
  return hash;
}

function requiredIsoTimestamp(value: unknown, name: string): string {
  const timestamp = requiredString(value, name);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) ||
    Number.isNaN(Date.parse(timestamp))
  ) {
    throw new Error(`${name} must be an ISO-8601 timestamp with timezone.`);
  }
  return timestamp;
}

function readOutputContract(value: unknown): 'darts180-board-tip-v1' {
  if (value !== 'darts180-board-tip-v1') {
    throw new Error('Unsupported model release output contract.');
  }
  return value;
}

function requiredPositiveInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value as number;
}

function requiredProbability(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a finite probability.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
