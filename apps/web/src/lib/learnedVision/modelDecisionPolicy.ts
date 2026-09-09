import type { VisionModelDecisionPolicy } from '@darts-180/contracts';

export interface ParseDecisionPolicyOptions {
  /** Production attestations must name the held-out evaluation that fitted this policy. */
  requireHeldOutEvaluationId?: boolean;
}

/**
 * Parse the exact schema-v2 policy shared by a public model manifest and its production
 * attestation. Keeping this in one module prevents a release record from accepting a weaker
 * numeric policy than the runtime parser.
 */
export function parseVisionModelDecisionPolicy(
  value: unknown,
  { requireHeldOutEvaluationId = false }: ParseDecisionPolicyOptions = {},
): VisionModelDecisionPolicy {
  if (!isRecord(value)) throw new Error('Model decision policy is required.');
  if (typeof value.autoRecordEnabled !== 'boolean') {
    throw new Error('decisionPolicy.autoRecordEnabled must be boolean.');
  }
  const policy: VisionModelDecisionPolicy = {
    autoRecordEnabled: value.autoRecordEnabled,
    minAutoScoreProbability: requiredProbability(
      value.minAutoScoreProbability,
      'decisionPolicy.minAutoScoreProbability',
    ),
    minAutoScoreWireMarginMm: requiredNonNegative(
      value.minAutoScoreWireMarginMm,
      'decisionPolicy.minAutoScoreWireMarginMm',
    ),
    minReviewProbability: requiredProbability(
      value.minReviewProbability,
      'decisionPolicy.minReviewProbability',
    ),
    minZonePosteriorMargin: requiredProbability(
      value.minZonePosteriorMargin,
      'decisionPolicy.minZonePosteriorMargin',
    ),
    minLandmarkConfidence: requiredProbability(
      value.minLandmarkConfidence,
      'decisionPolicy.minLandmarkConfidence',
    ),
    maxPoseValidationResidualMm: requiredNonNegative(
      value.maxPoseValidationResidualMm,
      'decisionPolicy.maxPoseValidationResidualMm',
    ),
    maxQualityOffAxisDegrees: requiredDegrees(
      value.maxQualityOffAxisDegrees,
      'decisionPolicy.maxQualityOffAxisDegrees',
    ),
    minBoardDiameterPixels: requiredNonNegative(
      value.minBoardDiameterPixels,
      'decisionPolicy.minBoardDiameterPixels',
    ),
    minOverallQuality: requiredProbability(
      value.minOverallQuality,
      'decisionPolicy.minOverallQuality',
    ),
    minBoardCoverage: requiredProbability(
      value.minBoardCoverage,
      'decisionPolicy.minBoardCoverage',
    ),
    minSharpness: requiredProbability(value.minSharpness, 'decisionPolicy.minSharpness'),
    maxGlareRisk: requiredProbability(value.maxGlareRisk, 'decisionPolicy.maxGlareRisk'),
    maxOcclusionRisk: requiredProbability(
      value.maxOcclusionRisk,
      'decisionPolicy.maxOcclusionRisk',
    ),
    tipTrackMatchDistanceMm: requiredPositive(
      value.tipTrackMatchDistanceMm,
      'decisionPolicy.tipTrackMatchDistanceMm',
    ),
    tipTrackSettleMs: requiredNonNegative(
      value.tipTrackSettleMs,
      'decisionPolicy.tipTrackSettleMs',
    ),
    tipTrackStaleAfterMs: requiredPositive(
      value.tipTrackStaleAfterMs,
      'decisionPolicy.tipTrackStaleAfterMs',
    ),
    maxTipTrackSpreadMm: requiredNonNegative(
      value.maxTipTrackSpreadMm,
      'decisionPolicy.maxTipTrackSpreadMm',
    ),
    confidenceTemperature: requiredPositive(
      value.confidenceTemperature,
      'decisionPolicy.confidenceTemperature',
    ),
    confidenceBias: requiredFiniteNumber(value.confidenceBias, 'decisionPolicy.confidenceBias'),
    heldOutEvaluationId: nullableString(
      value.heldOutEvaluationId,
      'decisionPolicy.heldOutEvaluationId',
    ),
  };
  if (policy.minReviewProbability > policy.minAutoScoreProbability) {
    throw new Error('Review threshold cannot exceed automatic-score threshold.');
  }
  if (policy.tipTrackStaleAfterMs < policy.tipTrackSettleMs) {
    throw new Error('Tip-track stale interval cannot be shorter than its settle interval.');
  }
  if (requireHeldOutEvaluationId && policy.heldOutEvaluationId === null) {
    throw new Error('Model release attestation requires decisionPolicy.heldOutEvaluationId.');
  }
  return policy;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

function nullableString(value: unknown, name: string): string | null {
  if (value === null) return null;
  return requiredString(value, name);
}

function requiredFiniteNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be finite.`);
  }
  return value;
}

function requiredNonNegative(value: unknown, name: string): number {
  const number = requiredFiniteNumber(value, name);
  if (number < 0) throw new Error(`${name} must be non-negative.`);
  return number;
}

function requiredPositive(value: unknown, name: string): number {
  const number = requiredFiniteNumber(value, name);
  if (number <= 0) throw new Error(`${name} must be positive.`);
  return number;
}

function requiredDegrees(value: unknown, name: string): number {
  const number = requiredNonNegative(value, name);
  if (number > 90) throw new Error(`${name} must be between 0 and 90.`);
  return number;
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
