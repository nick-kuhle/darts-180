import type { BoardPointMm } from '@darts-180/contracts';
import { BOARD_RADII_MM, decodeBoardPoint, nearestWireMarginMm } from '@darts-180/rules';

import {
  invertHomography,
  mapBoardPointToImage,
  mapImagePointToBoard,
  solveImageToBoardHomography,
  type ImagePoint,
} from '../annotationGeometry';

import { DevelopmentDartTracker } from './dartTracker';
import {
  DEEPDARTS_CLASS_IDS,
  type DeepDartsDetection,
  type DeepDartsDevelopmentModelManifest,
  type DeepDartsDevelopmentPose,
  type DeepDartsInferenceFrameResult,
  type DevelopmentScoreSuggestion,
  type DevelopmentTrackedDart,
} from './types';

/**
 * The published DeepDarts source places cal1–4 at top, bottom, left, and right on r=170 mm.
 * Its source sector table differs from Darts 180's standard face-on rules frame by −9°. The
 * constant is scoped to this versioned development adapter and is protected by geometry fixtures;
 * it must not be reused for another dataset/export without revalidation.
 */
export const DEEPDARTS_SOURCE_TO_STANDARD_ROTATION_DEGREES = -9;

const SOURCE_CALIBRATION_TARGETS: readonly BoardPointMm[] = [
  { xMm: 0, yMm: -BOARD_RADII_MM.doubleOuter },
  { xMm: 0, yMm: BOARD_RADII_MM.doubleOuter },
  { xMm: -BOARD_RADII_MM.doubleOuter, yMm: 0 },
  { xMm: BOARD_RADII_MM.doubleOuter, yMm: 0 },
];

const REQUIRED_CALIBRATION_CLASS_IDS = [
  DEEPDARTS_CLASS_IDS.calibration1,
  DEEPDARTS_CLASS_IDS.calibration2,
  DEEPDARTS_CLASS_IDS.calibration3,
  DEEPDARTS_CLASS_IDS.calibration4,
] as const;

export interface DevelopmentVisionFrame {
  /** Raw, class-aware-NMS detector evidence for the current local camera frame. */
  detections: readonly DeepDartsDetection[];
  pose: DeepDartsDevelopmentPose | null;
  tracks: readonly DevelopmentTrackedDart[];
  /** Dart detections that could not safely map through an otherwise valid four-anchor pose. */
  blockedDartCount: number;
  /** Exactly one new development-only review suggestion, at most, per inference frame. */
  suggestion: DevelopmentScoreSuggestion | null;
}

/**
 * Joins real five-class YOLO detector outputs with a deterministic, oriented board transform. No
 * threshold, motion signal, or UI input can manufacture a dart: a suggestion requires all four
 * learned anchors and a learned class-0 dart point. Suggestions are permanently review-only.
 */
export class DeepDartsDevelopmentEngine {
  private tracker: DevelopmentDartTracker | null = null;
  private trackerPolicyKey: string | null = null;

  public process(
    result: DeepDartsInferenceFrameResult,
    model: DeepDartsDevelopmentModelManifest,
  ): DevelopmentVisionFrame {
    const pose = deriveDeepDartsDevelopmentPose(result.detections, model);
    if (pose === null) {
      this.tracker?.reset();
      return {
        detections: result.detections,
        pose: null,
        tracks: [],
        blockedDartCount: 0,
        suggestion: null,
      };
    }
    return this.processWithPose(result, model, pose);
  }

  /**
   * Continue the same joining logic with a board pose that did not come from the current frame's
   * detectors. The development Data Lab uses this to track darts through a setup-template-calibrated
   * board while the learned anchors are unseen. Dart suggestions still require learned class-0 tips.
   */
  public processWithPose(
    result: DeepDartsInferenceFrameResult,
    model: DeepDartsDevelopmentModelManifest,
    pose: DeepDartsDevelopmentPose,
  ): DevelopmentVisionFrame {
    const tracker = this.trackerFor(model);
    let blockedDartCount = 0;
    const observations = result.detections.flatMap((detection) => {
      if (
        detection.classId !== DEEPDARTS_CLASS_IDS.dartEntryPoint ||
        detection.confidence < model.policy.minDartConfidence
      ) {
        return [];
      }
      const boardPointMm = mapImagePointToBoard(
        { x: detection.center.xPx, y: detection.center.yPx },
        pose.imageToBoardHomography,
      );
      if (boardPointMm === null || !isFiniteBoardPoint(boardPointMm)) {
        blockedDartCount += 1;
        return [];
      }
      return [{ boardPointMm, detection, frameTimestampMs: result.frameTimestampMs }];
    });
    const tracks = tracker.observe(observations, result.frameTimestampMs);
    const next = tracks.find((track) => track.isSettled && !track.proposed);
    if (next === undefined) {
      return { detections: result.detections, pose, tracks, blockedDartCount, suggestion: null };
    }

    const suggestion = developmentSuggestion(next, pose);
    tracker.markProposed(next.trackId);
    return { detections: result.detections, pose, tracks, blockedDartCount, suggestion };
  }

  public resetVisit(): void {
    this.tracker?.reset();
  }

  private trackerFor(model: DeepDartsDevelopmentModelManifest): DevelopmentDartTracker {
    const policyKey = JSON.stringify({
      modelVersion: model.modelVersion,
      sha256: model.sha256,
      policy: model.policy,
    });
    if (this.tracker === null || this.trackerPolicyKey !== policyKey) {
      this.tracker = new DevelopmentDartTracker({
        matchDistanceMm: model.policy.tipTrackMatchDistanceMm,
        settleMs: model.policy.tipTrackSettleMs,
        staleAfterMs: model.policy.tipTrackStaleAfterMs,
        maxSettledSpreadMm: model.policy.maxTipTrackSpreadMm,
      });
      this.trackerPolicyKey = policyKey;
    }
    return this.tracker;
  }
}

/** Solve a detector-only oriented transform. There are no derived/relabelled v1 landmarks. */
export function deriveDeepDartsDevelopmentPose(
  detections: readonly DeepDartsDetection[],
  model: Pick<DeepDartsDevelopmentModelManifest, 'policy'>,
): DeepDartsDevelopmentPose | null {
  const anchors = REQUIRED_CALIBRATION_CLASS_IDS.map((classId) =>
    bestDetection(detections, classId, model.policy.minCalibrationConfidence),
  );
  if (anchors.some((anchor) => anchor === undefined)) return null;

  const imagePoints: ImagePoint[] = [];
  const canonicalPoints: BoardPointMm[] = [];
  for (let index = 0; index < REQUIRED_CALIBRATION_CLASS_IDS.length; index += 1) {
    const anchor = anchors[index];
    const sourceTarget = SOURCE_CALIBRATION_TARGETS[index];
    if (anchor === undefined || sourceTarget === undefined) return null;
    imagePoints.push({ x: anchor.center.xPx, y: anchor.center.yPx });
    canonicalPoints.push(rotateSourceCanonicalPoint(sourceTarget));
  }

  const imageToBoardHomography = solveImageToBoardHomography(imagePoints, canonicalPoints);
  if (imageToBoardHomography === null) return null;
  const boardToImageHomography = invertHomography(imageToBoardHomography);
  if (boardToImageHomography === null) return null;
  const boardDiameterPixels = estimateBoardDiameterPixels(boardToImageHomography);
  if (!Number.isFinite(boardDiameterPixels) || boardDiameterPixels <= 0) return null;

  return {
    imageToBoardHomography,
    boardToImageHomography,
    boardDiameterPixels,
    minimumAnchorConfidence: Math.min(...anchors.map((anchor) => anchor?.confidence ?? 0)),
  };
}

/** Convert the DeepDarts source board convention into `@darts-180/rules` standard coordinates. */
export function rotateSourceCanonicalPoint(point: BoardPointMm): BoardPointMm {
  const radians = (DEEPDARTS_SOURCE_TO_STANDARD_ROTATION_DEGREES * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    xMm: point.xMm * cosine - point.yMm * sine,
    yMm: point.xMm * sine + point.yMm * cosine,
  };
}

function bestDetection(
  detections: readonly DeepDartsDetection[],
  classId: Exclude<DeepDartsDetection['classId'], 0>,
  minimumConfidence: number,
): DeepDartsDetection | undefined {
  return detections
    .filter(
      (detection) =>
        detection.classId === classId &&
        detection.confidence >= minimumConfidence &&
        Number.isFinite(detection.center.xPx) &&
        Number.isFinite(detection.center.yPx),
    )
    .sort(
      (left, right) =>
        right.confidence - left.confidence ||
        left.center.xPx - right.center.xPx ||
        left.center.yPx - right.center.yPx,
    )[0];
}

function estimateBoardDiameterPixels(
  boardToImageHomography: DeepDartsDevelopmentPose['boardToImageHomography'],
): number {
  const top = mapBoardPointToImage(
    rotateSourceCanonicalPoint(SOURCE_CALIBRATION_TARGETS[0]!),
    boardToImageHomography,
  );
  const bottom = mapBoardPointToImage(
    rotateSourceCanonicalPoint(SOURCE_CALIBRATION_TARGETS[1]!),
    boardToImageHomography,
  );
  const left = mapBoardPointToImage(
    rotateSourceCanonicalPoint(SOURCE_CALIBRATION_TARGETS[2]!),
    boardToImageHomography,
  );
  const right = mapBoardPointToImage(
    rotateSourceCanonicalPoint(SOURCE_CALIBRATION_TARGETS[3]!),
    boardToImageHomography,
  );
  if (top === null || bottom === null || left === null || right === null) return Number.NaN;
  return (
    (Math.hypot(top.x - bottom.x, top.y - bottom.y) +
      Math.hypot(left.x - right.x, left.y - right.y)) /
    2
  );
}

function developmentSuggestion(
  track: DevelopmentTrackedDart,
  pose: DeepDartsDevelopmentPose,
): DevelopmentScoreSuggestion {
  return {
    zone: decodeBoardPoint(track.boardPointMm),
    boardPointMm: track.boardPointMm,
    // This value only summarizes the weakest detector input, not score correctness/calibration.
    detectorConfidence: Math.min(track.detection.confidence, pose.minimumAnchorConfidence),
    wireMarginMm: nearestWireMarginMm(track.boardPointMm),
    disposition: 'review',
    reasons: [
      'Experimental five-point detector suggestion.',
      'Edit or confirm this score before recording the visit.',
    ],
  };
}

function isFiniteBoardPoint(point: BoardPointMm): boolean {
  return Number.isFinite(point.xMm) && Number.isFinite(point.yMm);
}
