import type { DartTipObservation, VisionModelArtifactManifest } from '@darts-180/contracts';

import { isRunnableModelManifest } from './modelManifest';

/** Structural subset shared by model-output and canonical pose-quality observations. */
export interface LearnedQualityEvidence {
  overall: number;
  boardCoverage: number;
  sharpness: number;
  glareRisk: number;
  occlusionRisk: number;
  offAxisDegrees: number;
  boardDiameterPixels: number;
}

/**
 * The model-manifest-owned full-board admission gate. Keeping it outside React and scoring avoids
 * a UI-only quality threshold from drifting away from temporal tracking or score proposal safety.
 */
export function modelQualityBlockers(
  model: VisionModelArtifactManifest,
  quality: LearnedQualityEvidence,
): readonly string[] {
  if (!isRunnableModelManifest(model)) {
    return ['A verified local learned model package is required before scoring.'];
  }
  if (!isUsableQualityEvidence(quality)) {
    return ['The learned quality output is invalid. No camera score will be proposed.'];
  }

  const policy = model.decisionPolicy;
  const blockers: string[] = [];
  if (quality.boardCoverage < policy.minBoardCoverage) {
    blockers.push('Keep the full board face and number ring inside the camera view.');
  }
  if (quality.sharpness < policy.minSharpness) {
    blockers.push('Wait for the rear camera to focus, then keep the mount still.');
  }
  if (quality.glareRisk > policy.maxGlareRisk) {
    blockers.push('Reduce direct glare on the board face before scoring.');
  }
  if (quality.boardDiameterPixels < policy.minBoardDiameterPixels) {
    blockers.push('Move the mount closer so the board face has enough learned detail.');
  }
  if (quality.offAxisDegrees > policy.maxQualityOffAxisDegrees) {
    blockers.push('Move toward a clearer angle while keeping the full board in view.');
  }
  if (quality.overall < policy.minOverallQuality) {
    blockers.push('Improve focus or lighting until the learned quality check is ready.');
  }
  if (quality.occlusionRisk > policy.maxOcclusionRisk) {
    blockers.push('Clear the board face or move to a view with less occlusion.');
  }
  return blockers;
}

/** True only for finite, range-valid learned quality evidence. */
export function isUsableQualityEvidence(quality: LearnedQualityEvidence): boolean {
  return (
    isProbability(quality.overall) &&
    isProbability(quality.boardCoverage) &&
    isProbability(quality.sharpness) &&
    isProbability(quality.glareRisk) &&
    isProbability(quality.occlusionRisk) &&
    Number.isFinite(quality.boardDiameterPixels) &&
    quality.boardDiameterPixels >= 0 &&
    Number.isFinite(quality.offAxisDegrees) &&
    quality.offAxisDegrees >= 0 &&
    quality.offAxisDegrees <= 90
  );
}

/**
 * Tip gating belongs to the same manifest policy as board quality. A bad/hidden tip is not fed to
 * the temporal tracker, preventing an unsafe low-observability point from contaminating a later
 * high-quality proposal.
 */
export function dartTipBlocker(
  model: VisionModelArtifactManifest,
  tip: DartTipObservation,
): string | null {
  if (!isRunnableModelManifest(model)) {
    return 'A verified local learned model package is required before scoring.';
  }
  if (
    !Number.isFinite(tip.imagePoint.xPx) ||
    !Number.isFinite(tip.imagePoint.yPx) ||
    !Number.isFinite(tip.sigmaXPx) ||
    tip.sigmaXPx <= 0 ||
    !Number.isFinite(tip.sigmaYPx) ||
    tip.sigmaYPx <= 0 ||
    !isProbability(tip.confidence) ||
    !isProbability(tip.occlusionRisk)
  ) {
    return 'The learned dart-tip output is invalid, so no score is proposed.';
  }
  if (tip.occlusionRisk > model.decisionPolicy.maxOcclusionRisk) {
    return 'A dart or object is too occluded for a safe one-view score.';
  }
  return null;
}

function isProbability(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}
