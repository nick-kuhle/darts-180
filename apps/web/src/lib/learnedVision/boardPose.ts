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

const CANONICAL_ANCHORS: Record<(typeof REQUIRED_ANCHOR_KINDS)[number], BoardPointMm> = {
  'd20-double': { xMm: 0, yMm: -166 },
  'd6-double': { xMm: 166, yMm: 0 },
  'd3-double': { xMm: 0, yMm: 166 },
  'd11-double': { xMm: -166, yMm: 0 },
};

// These are redundant semantic observations, not additional player calibration handles. The outer
// cardinal points are defined on the outer double boundary at r=170 mm.
const SECONDARY_LANDMARKS: Readonly<Partial<Record<BoardLandmarkKind, BoardPointMm>>> = {
  bull: { xMm: 0, yMm: 0 },
  'outer-top': { xMm: 0, yMm: -170 },
  'outer-right': { xMm: 170, yMm: 0 },
  'outer-bottom': { xMm: 0, yMm: 170 },
  'outer-left': { xMm: -170, yMm: 0 },
};

const SECONDARY_LANDMARK_MIN_CONFIDENCE = 0.45;
const MAX_SECONDARY_LANDMARK_RESIDUAL_MM = 18;

export interface DerivedBoardPose {
  calibration: BoardCalibration;
  boardToImageHomography: Homography;
  /** Distance of the independently predicted bull from canonical (0, 0), in millimetres. */
  bullResidualMm: number | null;
  /** Mean anchor reprojection error in source-frame pixels. */
  anchorReprojectionErrorPx: number;
  /** Largest redundant learned-landmark residual in board millimetres, when available. */
  secondaryLandmarkResidualMm: number | null;
}

export interface BoardUncertaintyMm {
  sigmaXMm: number;
  sigmaYMm: number;
}

/**
 * Creates a fully oriented board calibration only from named learned landmarks. Repeated red/green
 * bands never supply the number orientation: the distinct D20/D6/D3/D11 landmark identities do.
 */
export function deriveBoardPose(
  landmarks: readonly BoardLandmarkObservation[],
  quality: ModelQualityObservation,
  frameTimestampMs: number,
): DerivedBoardPose | null {
  const anchors = REQUIRED_ANCHOR_KINDS.map((kind) => mostConfidentLandmark(landmarks, kind));
  if (anchors.some((anchor) => anchor === undefined)) return null;

  const imagePoints: ImagePoint[] = [];
  const boardPoints: BoardPointMm[] = [];
  for (const kind of REQUIRED_ANCHOR_KINDS) {
    const anchor = mostConfidentLandmark(landmarks, kind);
    if (anchor === undefined || anchor.confidence <= 0) return null;
    imagePoints.push({ x: anchor.imagePoint.xPx, y: anchor.imagePoint.yPx });
    boardPoints.push(CANONICAL_ANCHORS[kind]);
  }

  const imageToBoard = solveImageToBoardHomography(imagePoints, boardPoints);
  if (imageToBoard === null) return null;
  const boardToImage = invertHomography(imageToBoard);
  if (boardToImage === null) return null;

  const anchorError = meanAnchorReprojectionError(imagePoints, boardPoints, boardToImage);
  if (!Number.isFinite(anchorError) || anchorError > 8) return null;

  const bull = mostConfidentLandmark(landmarks, 'bull');
  const mappedBull =
    bull === undefined
      ? null
      : mapImagePointToBoard({ x: bull.imagePoint.xPx, y: bull.imagePoint.yPx }, imageToBoard);
  const bullResidualMm = mappedBull === null ? null : Math.hypot(mappedBull.xMm, mappedBull.yMm);
  const secondaryLandmarkResidualMm = maxSecondaryLandmarkResidual(landmarks, imageToBoard);
  // Independent bull and outer-double cues validate the exact four points used to solve the
  // homography. They catch flipped, repeated-band, and internally inconsistent landmark sets;
  // they never infer a score from colour or frame difference.
  if (
    bull === undefined ||
    bull.confidence < SECONDARY_LANDMARK_MIN_CONFIDENCE ||
    bullResidualMm === null ||
    bullResidualMm > MAX_SECONDARY_LANDMARK_RESIDUAL_MM ||
    (secondaryLandmarkResidualMm !== null &&
      secondaryLandmarkResidualMm > MAX_SECONDARY_LANDMARK_RESIDUAL_MM)
  ) {
    return null;
  }

  const poseQuality = toCameraPoseQuality(quality);
  const calibrationId = calibrationSignature(imagePoints, frameTimestampMs);
  return {
    calibration: {
      calibrationId,
      boardProfile: 'standard-steel-tip',
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
        Number.isFinite(landmark.confidence),
    )
    .sort((left, right) => right.confidence - left.confidence)[0];
}

function maxSecondaryLandmarkResidual(
  landmarks: readonly BoardLandmarkObservation[],
  imageToBoard: Homography,
): number | null {
  const residuals: number[] = [];
  for (const [kind, expected] of Object.entries(SECONDARY_LANDMARKS) as [
    BoardLandmarkKind,
    BoardPointMm,
  ][]) {
    const landmark = mostConfidentLandmark(landmarks, kind);
    if (landmark === undefined || landmark.confidence < SECONDARY_LANDMARK_MIN_CONFIDENCE) continue;
    const mapped = mapImagePointToBoard(
      { x: landmark.imagePoint.xPx, y: landmark.imagePoint.yPx },
      imageToBoard,
    );
    if (mapped === null) return Number.POSITIVE_INFINITY;
    residuals.push(Math.hypot(mapped.xMm - expected.xMm, mapped.yMm - expected.yMm));
  }
  if (residuals.length === 0) return null;
  return Math.max(...residuals);
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
