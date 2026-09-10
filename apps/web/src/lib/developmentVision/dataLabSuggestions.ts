import type { BoardPointMm, DartZone } from '@darts-180/contracts';
import { decodeBoardPoint, nearestWireMarginMm } from '@darts-180/rules';

import { mapImagePointToBoard, type ImagePoint } from '../annotationGeometry';

import { deriveDeepDartsDevelopmentPose } from './engine';
import {
  DEEPDARTS_CLASS_IDS,
  type DeepDartsDetection,
  type DeepDartsDevelopmentModelManifest,
  type DeepDartsDevelopmentPose,
  type DeepDartsInferenceFrameResult,
} from './types';

const CALIBRATION_CLASS_IDS = [
  DEEPDARTS_CLASS_IDS.calibration1,
  DEEPDARTS_CLASS_IDS.calibration2,
  DEEPDARTS_CLASS_IDS.calibration3,
  DEEPDARTS_CLASS_IDS.calibration4,
] as const;

/** A point has either been proposed by a learned model or deliberately supplied/adjusted by a person. */
export type DataLabPointSource = 'learned-suggestion' | 'human-adjusted' | 'human-added';

export interface DataLabSuggestedAnchor {
  imagePoint: ImagePoint;
  confidence: number;
}

export interface DataLabSuggestedDart {
  imagePoint: ImagePoint;
  boardPoint: BoardPointMm;
  zone: DartZone;
  wireMarginMm: number;
  confidence: number;
}

export interface DataLabLearnedSuggestionResult {
  /** Ordered cal1 through cal4; missing classes stay null rather than being invented. */
  anchors: readonly (DataLabSuggestedAnchor | null)[];
  /** Present only after a complete learned four-anchor transform can map model tip detections. */
  darts: readonly DataLabSuggestedDart[];
  pose: DeepDartsDevelopmentPose | null;
  /** Learned dart candidates intentionally omitted because their board pose was incomplete or limit was reached. */
  omittedDartDetectionCount: number;
}

/**
 * Convert one actual five-point model inference into editable Data Lab suggestions.
 *
 * This helper deliberately has no image heuristic, named-point default, or score fallback. It uses
 * only class-aware model detections that meet the installed model's declared floors. A partial model
 * result may suggest only the anchors it truly found; darts are withheld until all four learned
 * anchors define a safe oriented board transform.
 */
export function buildDataLabLearnedSuggestions(
  inference: DeepDartsInferenceFrameResult,
  model: DeepDartsDevelopmentModelManifest,
): DataLabLearnedSuggestionResult {
  const anchors = CALIBRATION_CLASS_IDS.map((classId) => {
    const detected = bestDetection(
      inference.detections,
      classId,
      model.policy.minCalibrationConfidence,
    );
    if (detected === null) return null;
    return {
      imagePoint: { x: detected.center.xPx, y: detected.center.yPx },
      confidence: detected.confidence,
    };
  });
  const pose = deriveDeepDartsDevelopmentPose(inference.detections, model);
  const dartDetections = inference.detections
    .filter(
      (detection) =>
        detection.classId === DEEPDARTS_CLASS_IDS.dartEntryPoint &&
        detection.confidence >= model.policy.minDartConfidence,
    )
    .sort(
      (left, right) =>
        right.confidence - left.confidence ||
        left.center.xPx - right.center.xPx ||
        left.center.yPx - right.center.yPx,
    );
  if (pose === null) {
    return {
      anchors,
      darts: [],
      pose: null,
      omittedDartDetectionCount: dartDetections.length,
    };
  }

  const darts: DataLabSuggestedDart[] = [];
  let omittedDartDetectionCount = 0;
  for (const detection of dartDetections) {
    const boardPoint = mapImagePointToBoard(
      { x: detection.center.xPx, y: detection.center.yPx },
      pose.imageToBoardHomography,
    );
    if (boardPoint === null || !isFinitePoint(boardPoint) || darts.length >= 3) {
      omittedDartDetectionCount += 1;
      continue;
    }
    darts.push({
      imagePoint: { x: detection.center.xPx, y: detection.center.yPx },
      boardPoint,
      zone: decodeBoardPoint(boardPoint),
      wireMarginMm: nearestWireMarginMm(boardPoint),
      confidence: detection.confidence,
    });
  }
  return { anchors, darts, pose, omittedDartDetectionCount };
}

function bestDetection(
  detections: readonly DeepDartsDetection[],
  classId: Exclude<DeepDartsDetection['classId'], 0>,
  minimumConfidence: number,
): DeepDartsDetection | null {
  return (
    detections
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
      )[0] ?? null
  );
}

function isFinitePoint(point: BoardPointMm): boolean {
  return Number.isFinite(point.xMm) && Number.isFinite(point.yMm);
}
