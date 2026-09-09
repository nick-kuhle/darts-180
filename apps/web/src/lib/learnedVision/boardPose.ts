import type {
  BoardCalibration,
  BoardLandmarkKind,
  BoardLandmarkObservation,
  BoardPointMm,
  CameraPoseQuality,
  DartTipObservation,
  ModelQualityObservation,
} from '@darts-180/contracts';

import {
  invertHomography,
  mapImagePointToBoard,
  solveImageToBoardHomography,
  type Homography,
  type ImagePoint,
} from '../annotationGeometry';

const REQUIRED_ANCHOR_KINDS = ['d20-double', 'd6-double', 'd3-double', 'd11-double'] as const;
const REQUIRED_VALIDATION_KINDS = [
  'bull',
  'outer-top',
  'outer-right',
  'outer-bottom',
  'outer-left',
] as const;

const CANONICAL_ANCHORS: Record<(typeof REQUIRED_ANCHOR_KINDS)[number], BoardPointMm> = {
  'd20-double': { xMm: 0, yMm: -166 },
  'd6-double': { xMm: 166, yMm: 0 },
  'd3-double': { xMm: 0, yMm: 166 },
  'd11-double': { xMm: -166, yMm: 0 },
};

// These are semantic model observations, not additional player calibration handles. The outer
// cardinal points are defined on the outer-double boundary at r=170 mm.
const CANONICAL_VALIDATION_POINTS: Record<
  (typeof REQUIRED_VALIDATION_KINDS)[number],
  BoardPointMm
> = {
  bull: { xMm: 0, yMm: 0 },
  'outer-top': { xMm: 0, yMm: -170 },
  'outer-right': { xMm: 170, yMm: 0 },
  'outer-bottom': { xMm: 0, yMm: 170 },
  'outer-left': { xMm: -170, yMm: 0 },
};

/** Geometry-only thresholds carried by the model artifact's calibrated decision policy. */
export interface BoardPoseGate {
  minLandmarkConfidence: number;
  maxPoseValidationResidualMm: number;
}

export interface DerivedBoardPose {
  calibration: BoardCalibration;
  boardToImageHomography: Homography;
  /** Distance of the independently predicted bull from canonical (0, 0), in millimetres. */
  bullResidualMm: number;
  /** Mean anchor reprojection error in source-frame pixels. */
  anchorReprojectionErrorPx: number;
  /** Largest redundant learned-landmark residual in board millimetres. */
  secondaryLandmarkResidualMm: number;
}

export interface BoardUncertaintyMm {
  sigmaXMm: number;
  sigmaYMm: number;
}

/**
 * Creates a fully oriented board calibration only from complete named learned landmarks. Repeated
 * red/green bands never supply the number orientation: D20/D6/D3/D11 identify the rotation, while
 * bull and outer-double points independently reject a flipped or internally inconsistent solution.
 */
export function deriveBoardPose(
  landmarks: readonly BoardLandmarkObservation[],
  quality: ModelQualityObservation,
  frameTimestampMs: number,
  gate: Readonly<BoardPoseGate>,
): DerivedBoardPose | null {
  if (
    !Number.isFinite(frameTimestampMs) ||
    frameTimestampMs < 0 ||
    !isValidGate(gate) ||
    !isValidModelQuality(quality)
  ) {
    return null;
  }

  const anchors = REQUIRED_ANCHOR_KINDS.map((kind) => mostConfidentLandmark(landmarks, kind));
  const validations = REQUIRED_VALIDATION_KINDS.map((kind) =>
    mostConfidentLandmark(landmarks, kind),
  );
  if (
    anchors.some(
      (anchor) => anchor === undefined || anchor.confidence < gate.minLandmarkConfidence,
    ) ||
    validations.some(
      (landmark) => landmark === undefined || landmark.confidence < gate.minLandmarkConfidence,
    )
  ) {
    return null;
  }

  const imagePoints: ImagePoint[] = [];
  const boardPoints: BoardPointMm[] = [];
  for (const kind of REQUIRED_ANCHOR_KINDS) {
    const anchor = mostConfidentLandmark(landmarks, kind);
    if (anchor === undefined) return null;
    imagePoints.push({ x: anchor.imagePoint.xPx, y: anchor.imagePoint.yPx });
    boardPoints.push(CANONICAL_ANCHORS[kind]);
  }

  const imageToBoard = solveImageToBoardHomography(imagePoints, boardPoints);
  if (imageToBoard === null) return null;
  const boardToImage = invertHomography(imageToBoard);
  if (boardToImage === null) return null;

  const anchorError = meanAnchorReprojectionError(imagePoints, boardPoints, boardToImage);
  if (!Number.isFinite(anchorError)) return null;

  const validationResiduals: number[] = [];
  for (const kind of REQUIRED_VALIDATION_KINDS) {
    const landmark = mostConfidentLandmark(landmarks, kind);
    if (landmark === undefined) return null;
    const mapped = mapImagePointToBoard(
      { x: landmark.imagePoint.xPx, y: landmark.imagePoint.yPx },
      imageToBoard,
    );
    const expected = CANONICAL_VALIDATION_POINTS[kind];
    if (mapped === null) return null;
    validationResiduals.push(Math.hypot(mapped.xMm - expected.xMm, mapped.yMm - expected.yMm));
  }
  const secondaryLandmarkResidualMm = Math.max(...validationResiduals);
  const bullResidualMm = validationResiduals[0];
  if (
    bullResidualMm === undefined ||
    !Number.isFinite(secondaryLandmarkResidualMm) ||
    secondaryLandmarkResidualMm > gate.maxPoseValidationResidualMm
  ) {
    return null;
  }

  const poseQuality = toCameraPoseQuality(quality);
  const calibrationId = calibrationSignature(imagePoints, frameTimestampMs);
  return {
    calibration: {
      calibrationId,
      boardProfile: 'standard-darts',
      createdAt: new Date(frameTimestampMs).toISOString(),
      source: 'auto',
      imageToBoardHomography: imageToBoard,
      quality: poseQuality,
    },
    boardToImageHomography: boardToImage,
    bullResidualMm,
    anchorReprojectionErrorPx: anchorError,
    secondaryLandmarkResidualMm,
  };
}

export function mapDartTipToBoard(
  tip: DartTipObservation,
  imageToBoardHomography: Homography,
): Readonly<{ point: BoardPointMm; uncertainty: BoardUncertaintyMm }> | null {
  const point = mapImagePointToBoard(
    { x: tip.imagePoint.xPx, y: tip.imagePoint.yPx },
    imageToBoardHomography,
  );
  if (point === null) return null;
  const sigmaXMm = projectedDistance(
    tip.imagePoint,
    { xPx: Math.max(0.1, tip.sigmaXPx), yPx: 0 },
    imageToBoardHomography,
  );
  const sigmaYMm = projectedDistance(
    tip.imagePoint,
    { xPx: 0, yPx: Math.max(0.1, tip.sigmaYPx) },
    imageToBoardHomography,
  );
  if (!Number.isFinite(sigmaXMm) || !Number.isFinite(sigmaYMm)) return null;
  return {
    point,
    uncertainty: {
      sigmaXMm: Math.max(0.05, sigmaXMm),
      sigmaYMm: Math.max(0.05, sigmaYMm),
    },
  };
}

export function toCameraPoseQuality(quality: ModelQualityObservation): CameraPoseQuality {
  return {
    overall: clampProbability(quality.overall),
    boardCoverage: clampProbability(quality.boardCoverage),
    sharpness: clampProbability(quality.sharpness),
    glareRisk: clampProbability(quality.glareRisk),
    occlusionRisk: clampProbability(quality.occlusionRisk),
    offAxisDegrees: clamp(quality.offAxisDegrees, 0, 90),
    boardDiameterPixels: Math.max(0, quality.boardDiameterPixels),
    reasons: quality.reasons,
  };
}

function isValidGate(gate: Readonly<BoardPoseGate>): boolean {
  return (
    Number.isFinite(gate.minLandmarkConfidence) &&
    gate.minLandmarkConfidence >= 0 &&
    gate.minLandmarkConfidence <= 1 &&
    Number.isFinite(gate.maxPoseValidationResidualMm) &&
    gate.maxPoseValidationResidualMm >= 0
  );
}

function isValidModelQuality(quality: ModelQualityObservation): boolean {
  return (
    isProbability(quality.overall) &&
    isProbability(quality.boardCoverage) &&
    isProbability(quality.sharpness) &&
    isProbability(quality.glareRisk) &&
    isProbability(quality.occlusionRisk) &&
    Number.isFinite(quality.offAxisDegrees) &&
    quality.offAxisDegrees >= 0 &&
    quality.offAxisDegrees <= 90 &&
    Number.isFinite(quality.boardDiameterPixels) &&
    quality.boardDiameterPixels >= 0
  );
}

function isProbability(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function mostConfidentLandmark(
  landmarks: readonly BoardLandmarkObservation[],
  kind: BoardLandmarkKind,
): BoardLandmarkObservation | undefined {
  return landmarks
    .filter(
      (landmark) =>
        landmark.kind === kind &&
        Number.isFinite(landmark.imagePoint.xPx) &&
        Number.isFinite(landmark.imagePoint.yPx) &&
        isProbability(landmark.confidence),
    )
    .sort((left, right) => right.confidence - left.confidence)[0];
}

function meanAnchorReprojectionError(
  imagePoints: readonly ImagePoint[],
  boardPoints: readonly BoardPointMm[],
  boardToImage: Homography,
): number {
  let total = 0;
  for (let index = 0; index < imagePoints.length; index += 1) {
    const expected = imagePoints[index];
    const canonical = boardPoints[index];
    if (expected === undefined || canonical === undefined) return Number.POSITIVE_INFINITY;
    const projected = mapImagePointToBoard({ x: canonical.xMm, y: canonical.yMm }, boardToImage);
    // `mapImagePointToBoard` is coordinate-agnostic: here its x/y values are board-mm input and
    // its output's xMm/yMm fields represent source pixels after the reverse transform.
    if (projected === null) return Number.POSITIVE_INFINITY;
    total += Math.hypot(projected.xMm - expected.x, projected.yMm - expected.y);
  }
  return total / imagePoints.length;
}

function projectedDistance(
  point: DartTipObservation['imagePoint'],
  offset: Readonly<{ xPx: number; yPx: number }>,
  imageToBoard: Homography,
): number {
  const negative = mapImagePointToBoard(
    { x: point.xPx - offset.xPx, y: point.yPx - offset.yPx },
    imageToBoard,
  );
  const positive = mapImagePointToBoard(
    { x: point.xPx + offset.xPx, y: point.yPx + offset.yPx },
    imageToBoard,
  );
  if (negative === null || positive === null) return Number.NaN;
  return Math.hypot(positive.xMm - negative.xMm, positive.yMm - negative.yMm) / 2;
}

function calibrationSignature(
  imagePoints: readonly ImagePoint[],
  frameTimestampMs: number,
): string {
  const geometry = imagePoints
    .map((point) => `${Math.round(point.x)}:${Math.round(point.y)}`)
    .join('-');
  return `web-auto-${frameTimestampMs}-${geometry}`;
}

function clampProbability(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, lower: number, upper: number): number {
  return Math.max(lower, Math.min(upper, Number.isFinite(value) ? value : lower));
}
