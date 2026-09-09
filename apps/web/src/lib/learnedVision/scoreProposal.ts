import type {
  BoardCalibration,
  BoardPointMm,
  DartTipObservation,
  DartZone,
  RankedZoneCandidate,
  ScoringProposal,
  VisionModelArtifactManifest,
} from '@darts-180/contracts';
import { decodeBoardPoint, formatZone, nearestWireMarginMm } from '@darts-180/rules';

import type { BoardUncertaintyMm } from './boardPose';
import { dartTipBlocker, modelQualityBlockers } from './qualityPolicy';

export interface LearnedScoreInput {
  model: VisionModelArtifactManifest;
  calibration: BoardCalibration | null;
  tip: DartTipObservation | null;
  boardPoint: BoardPointMm | null;
  uncertainty: BoardUncertaintyMm | null;
  frameTimestampMs: number;
}

/** Five-node Gauss–Hermite quadrature transformed for a standard-normal expectation. */
const STANDARD_NORMAL_QUADRATURE = [
  { value: -2.8569700138728056, weight: 0.0112574113277207 },
  { value: -1.355626179974266, weight: 0.2220759220056126 },
  { value: 0, weight: 0.5333333333333333 },
  { value: 1.355626179974266, weight: 0.2220759220056126 },
  { value: 2.8569700138728056, weight: 0.0112574113277207 },
] as const;

/**
 * Converts semantic model output into a player-facing proposal. This is intentionally the only
 * browser path that turns a learned dart-tip point into a score. It never calls the legacy
 * pixel-difference/endpoint heuristic.
 */
export function createLearnedScoringProposal(input: LearnedScoreInput): ScoringProposal {
  const quality = input.calibration?.quality;
  const preconditions = qualityFailureReasons(input.model, quality, input.tip);
  if (preconditions.length > 0) {
    return abstain(input, preconditions);
  }
  if (
    input.boardPoint === null ||
    input.uncertainty === null ||
    input.tip === null ||
    input.calibration === null
  ) {
    return abstain(input, ['The learned model did not produce a usable board-plane dart point.']);
  }
  if (!hasUsableBoardMeasurement(input.boardPoint, input.uncertainty)) {
    return abstain(input, [
      'The learned board-plane measurement is invalid, so no score is proposed.',
    ]);
  }

  const candidates = rankZones(input.boardPoint, input.uncertainty);
  const best = candidates[0];
  if (best === undefined)
    return abstain(input, ['No deterministic scoring candidate was produced.']);

  const confidence = calibratedConfidence(
    best.probability * input.tip.confidence * input.calibration.quality.overall,
    input.model,
  );
  const reasons: string[] = [];
  const runnerUp = candidates[1];
  const posteriorMargin = best.probability - (runnerUp?.probability ?? 0);
  if (best.zone.ring === 'MISS') {
    // A one-view system must not turn an outside point into a fabricated no-score. A validated
    // impact/miss model could later add a distinct evidence contract; until then it is review-only.
    reasons.push(
      'A possible miss is never automatically recorded from a one-view dart-tip proposal.',
    );
  }
  if (best.wireMarginMm < input.model.decisionPolicy.minAutoScoreWireMarginMm) {
    reasons.push('The measured point is too close to a scoring wire for automatic recording.');
  }
  if (
    runnerUp !== undefined &&
    posteriorMargin < input.model.decisionPolicy.minZonePosteriorMargin
  ) {
    reasons.push(`The learned uncertainty overlaps ${formatZone(runnerUp.zone)}.`);
  }
  if (!input.model.decisionPolicy.autoRecordEnabled) {
    reasons.push('This model release is not approved to record a score automatically.');
  }

  const safeForAutomaticScore =
    input.model.decisionPolicy.autoRecordEnabled &&
    input.model.releaseStage === 'production' &&
    best.zone.ring !== 'MISS' &&
    confidence >= input.model.decisionPolicy.minAutoScoreProbability &&
    best.wireMarginMm >= input.model.decisionPolicy.minAutoScoreWireMarginMm &&
    posteriorMargin >= input.model.decisionPolicy.minZonePosteriorMargin;

  if (safeForAutomaticScore) {
    return proposal(input, 'auto-score', candidates, confidence, [
      'Learned point and calibrated score policy passed.',
    ]);
  }
  if (confidence >= input.model.decisionPolicy.minReviewProbability) {
    return proposal(input, 'review', candidates, confidence, reasons);
  }
  return abstain(input, [
    ...reasons,
    'The calibrated learned evidence is below the review threshold, so no score is proposed.',
  ]);
}

/**
 * Approximate a local score posterior from the learned point uncertainty in canonical millimetres.
 * The fixed five-by-five Gaussian quadrature is deterministic and replayable. Its calibration
 * happens at the model/policy layer; this function only captures geometric boundary ambiguity.
 */
export function rankZones(
  point: BoardPointMm,
  uncertainty: BoardUncertaintyMm,
): readonly RankedZoneCandidate[] {
  const sigmaX = Math.max(0.05, uncertainty.sigmaXMm);
  const sigmaY = Math.max(0.05, uncertainty.sigmaYMm);
  const weights = new Map<string, { zone: DartZone; weight: number }>();
  // Tensor sigma values are defined as independent standard deviations. A fixed Gauss–Hermite
  // quadrature integrates that local uncertainty against the deterministic scoring geometry rather
  // than treating a thresholded point estimate as certainty. Calibration still belongs to the
  // manifest policy and its held-out evidence, not these mathematical integration nodes.
  for (const xNode of STANDARD_NORMAL_QUADRATURE) {
    for (const yNode of STANDARD_NORMAL_QUADRATURE) {
      const zone = decodeBoardPoint({
        xMm: point.xMm + xNode.value * sigmaX,
        yMm: point.yMm + yNode.value * sigmaY,
      });
      const key = `${zone.ring}:${zone.segment ?? 'none'}`;
      const current = weights.get(key);
      weights.set(key, { zone, weight: (current?.weight ?? 0) + xNode.weight * yNode.weight });
    }
  }

  const total = [...weights.values()].reduce((sum, entry) => sum + entry.weight, 0);
  return [...weights.values()]
    .map(({ zone, weight }) => ({
      zone,
      probability: total === 0 ? 0 : weight / total,
      wireMarginMm: nearestWireMarginMm(point),
    }))
    .sort((left, right) => {
      if (right.probability !== left.probability) return right.probability - left.probability;
      return formatZone(left.zone).localeCompare(formatZone(right.zone));
    });
}

function qualityFailureReasons(
  model: VisionModelArtifactManifest,
  quality: BoardCalibration['quality'] | undefined,
  tip: DartTipObservation | null,
): readonly string[] {
  if (model.releaseStage === 'unavailable') {
    return ['The verified local learned model is not installed. No camera score is guessed.'];
  }
  if (quality === undefined)
    return ['The model could not establish complete board pose and orientation.'];
  const qualityBlockers = modelQualityBlockers(model, quality);
  if (qualityBlockers.length > 0) return qualityBlockers;
  if (tip !== null) {
    const tipBlocker = dartTipBlocker(model, tip);
    if (tipBlocker !== null) return [tipBlocker];
  }
  return [];
}

function hasUsableBoardMeasurement(point: BoardPointMm, uncertainty: BoardUncertaintyMm): boolean {
  return (
    Number.isFinite(point.xMm) &&
    Number.isFinite(point.yMm) &&
    Number.isFinite(uncertainty.sigmaXMm) &&
    uncertainty.sigmaXMm > 0 &&
    Number.isFinite(uncertainty.sigmaYMm) &&
    uncertainty.sigmaYMm > 0
  );
}

function abstain(input: LearnedScoreInput, reasons: readonly string[]): ScoringProposal {
  return {
    schemaVersion: 1,
    proposalId: proposalId(input),
    disposition: 'abstain',
    ...(input.boardPoint === null ? {} : { boardPointMm: input.boardPoint }),
    ...(input.tip === null ? {} : { tip: input.tip }),
    ...(input.calibration === null ? {} : { calibration: input.calibration }),
    candidates: [],
    confidence: 0,
    reasons,
  };
}

function proposal(
  input: LearnedScoreInput,
  disposition: 'auto-score' | 'review',
  candidates: readonly RankedZoneCandidate[],
  confidence: number,
  reasons: readonly string[],
): ScoringProposal {
  const point = input.boardPoint;
  const tip = input.tip;
  const calibration = input.calibration;
  if (point === null || tip === null || calibration === null) {
    throw new Error('A scored proposal requires a point, dart tip, and board calibration.');
  }
  return {
    schemaVersion: 1,
    proposalId: proposalId(input),
    disposition,
    boardPointMm: point,
    tip,
    calibration,
    candidates,
    confidence,
    reasons,
    evidence: {
      modelVersion: input.model.modelVersion,
      calibrationId: calibration.calibrationId,
      boardPointMm: point,
      confidence,
      candidates,
      frameTimestampMs: input.frameTimestampMs,
    },
  };
}

function proposalId(input: LearnedScoreInput): string {
  const point = input.boardPoint;
  const position =
    point === null ? 'no-point' : `${Math.round(point.xMm * 10)}-${Math.round(point.yMm * 10)}`;
  return `web-${input.model.modelVersion}-${input.frameTimestampMs}-${position}`;
}

function calibratedConfidence(raw: number, model: VisionModelArtifactManifest): number {
  const bounded = Math.max(0.000001, Math.min(0.999999, raw));
  const logit = Math.log(bounded / (1 - bounded));
  const calibrated =
    1 /
    (1 +
      Math.exp(
        -(logit + model.decisionPolicy.confidenceBias) / model.decisionPolicy.confidenceTemperature,
      ));
  return Math.max(0, Math.min(1, calibrated));
}
