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

export interface LearnedScoreInput {
  model: VisionModelArtifactManifest;
  calibration: BoardCalibration | null;
  tip: DartTipObservation | null;
  boardPoint: BoardPointMm | null;
  uncertainty: BoardUncertaintyMm | null;
  frameTimestampMs: number;
}

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
  if (runnerUp !== undefined && best.probability - runnerUp.probability < 0.08) {
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
    (runnerUp === undefined || best.probability - runnerUp.probability >= 0.08);

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
 * The deterministic quadrature is deliberately small and replayable. Its calibration happens at the
 * model/policy layer; this function only captures geometric boundary ambiguity.
 */
export function rankZones(
  point: BoardPointMm,
  uncertainty: BoardUncertaintyMm,
): readonly RankedZoneCandidate[] {
  const sigmaX = Math.max(0.05, uncertainty.sigmaXMm);
  const sigmaY = Math.max(0.05, uncertainty.sigmaYMm);
  const samples: readonly Readonly<{ x: number; y: number; weight: number }>[] = [
    { x: 0, y: 0, weight: 0.28 },
    { x: -1, y: 0, weight: 0.1 },
    { x: 1, y: 0, weight: 0.1 },
    { x: 0, y: -1, weight: 0.1 },
    { x: 0, y: 1, weight: 0.1 },
    { x: -1, y: -1, weight: 0.055 },
    { x: -1, y: 1, weight: 0.055 },
    { x: 1, y: -1, weight: 0.055 },
    { x: 1, y: 1, weight: 0.055 },
    { x: -2, y: 0, weight: 0.0225 },
    { x: 2, y: 0, weight: 0.0225 },
    { x: 0, y: -2, weight: 0.0225 },
    { x: 0, y: 2, weight: 0.0225 },
  ];

  const weights = new Map<string, { zone: DartZone; weight: number }>();
  for (const sample of samples) {
    const zone = decodeBoardPoint({
      xMm: point.xMm + sample.x * sigmaX,
      yMm: point.yMm + sample.y * sigmaY,
    });
    const key = `${zone.ring}:${zone.segment ?? 'none'}`;
    const current = weights.get(key);
    weights.set(key, { zone, weight: (current?.weight ?? 0) + sample.weight });
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
  const reasons: string[] = [];
  if (quality.overall < model.decisionPolicy.minOverallQuality) {
    reasons.push('The automatic quality model needs a clearer view before scoring.');
  }
  if (quality.boardDiameterPixels < model.decisionPolicy.minBoardDiameterPixels) {
    reasons.push('Move the phone closer so the complete board has enough usable detail.');
  }
  if (quality.offAxisDegrees > model.decisionPolicy.maxQualityOffAxisDegrees) {
    reasons.push('The current view hides too much board-plane detail; move to a clearer angle.');
  }
  if (
    quality.occlusionRisk > model.decisionPolicy.maxOcclusionRisk ||
    (tip?.occlusionRisk ?? 1) > model.decisionPolicy.maxOcclusionRisk
  ) {
    reasons.push('A dart or object is too occluded for a safe one-view score.');
  }
  return reasons;
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
