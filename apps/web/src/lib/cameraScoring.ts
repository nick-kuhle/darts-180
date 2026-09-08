import type { DartZone } from '@darts-180/contracts';
import { BOARD_RADII_MM, decodeBoardPoint, nearestWireMarginMm } from '@darts-180/rules';

import {
  mapImagePointToBoard,
  type CanonicalPoint,
  type Homography,
  type ImagePoint,
} from './annotationGeometry';

/**
 * A browser-local frame used by the field-test scorer. Frames are deliberately ephemeral: this
 * module never uploads, writes, or persists raw camera pixels.
 */
export interface CameraFrame {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  capturedAtMs: number;
}

export interface GuidedCalibrationQuality {
  boardDiameterPixels: number;
  boardCoverage: number;
  /** Approximation from the manual cardinal anchors, not calibrated camera pose. */
  estimatedOffAxisDegrees: number;
  /** Mean local luminance gradient; a focus heuristic, not an optical-quality measurement. */
  sharpness: number;
  overall: number;
  pass: boolean;
  blockers: readonly string[];
  warnings: readonly string[];
}

export interface DartShape {
  id: string;
  /** A side-view shaft or a compact flight/occlusion seen from near the board centreline. */
  kind: 'elongated' | 'compact';
  pixelCount: number;
  bounds: Readonly<{ left: number; top: number; right: number; bottom: number }>;
  center: ImagePoint;
  endpoints: readonly [ImagePoint, ImagePoint];
  /** Apparent transverse width near endpoint A then B. A flight is often wider than an entry end. */
  endpointWidths: readonly [number, number];
  lineLengthPixels: number;
  aspectRatio: number;
  confidence: number;
}

export interface DartTipCandidate {
  id: string;
  shapeId: string;
  endpoint: 'A' | 'B' | 'center';
  imagePoint: ImagePoint;
  boardPoint: CanonicalPoint;
  zone: DartZone;
  wireMarginMm: number;
  /** Heuristic endpoint ranking from board containment and apparent endpoint width; not a probability. */
  tipLikelihood: number;
  /** A heuristic shape/endpoint ranking, never a calibrated score probability. */
  confidence: number;
  directionEvidence: 'only-endpoint-on-board' | 'compact-local-change' | 'ambiguous-endpoint';
}

export type DifferenceStatus =
  | 'no-change'
  | 'camera-moved-or-hand-present'
  | 'ambiguous-change'
  | 'dart-candidate'
  | 'incompatible-frame';

export interface DifferenceAnalysis {
  status: DifferenceStatus;
  message: string;
  differenceThreshold: number;
  changedPixels: number;
  changedFraction: number;
  /** Bounded integer frame translation applied before differencing to absorb small mount vibration. */
  alignmentOffset: ImagePoint;
  shapes: readonly DartShape[];
  candidates: readonly DartTipCandidate[];
}

export interface DifferenceOptions {
  /** Brightness/color delta on a 0–255 scale. The adaptive threshold can only raise this value. */
  minimumDifference?: number;
  /** Manual-calibration quality is normally 480 px; tests may use a lower-resolution frame. */
  boardDiameterPixels?: number;
  /** Allow a changed shaft/flight just outside the double ring while rejecting room-background noise. */
  acceptedRadiusMm?: number;
}

const STANDARD_DOUBLE_DIAMETER_MM = BOARD_RADII_MM.doubleOuter * 2;
const CARDINAL_ANCHOR_SEPARATION_MM = 332;
const MAX_CHANGED_FRACTION = 0.12;
const NO_FRAME_TRANSLATION: Readonly<ImagePoint> = { x: 0, y: 0 };

/**
 * Produces transparent setup feedback from four manually clicked cardinal double beds:
 * D20 top, D6 right, D3 bottom, and D11 left. The angle value is a screen-space approximation;
 * a production pose model must replace it before it is treated as true camera geometry.
 */
export function assessGuidedCalibration(
  anchors: readonly ImagePoint[],
  frame: CameraFrame,
): GuidedCalibrationQuality {
  return assessFourPointCalibration(anchors, frame, CARDINAL_ANCHOR_SEPARATION_MM, {
    missingAnchorMessage: 'Place all four named double-bed anchors on a visible camera frame.',
    crossedGuideMessage:
      'The four anchors are too close together or crossed. Reposition each named double bed.',
  });
}

/**
 * Evaluates the player-facing outer-board guide. Its handles map to the outer double wire rather
 * than named segment beds, so the same geometry works for a drag/pinch/twist board fit.
 */
export function assessBoardFitCalibration(
  outerBoardHandles: readonly ImagePoint[],
  frame: CameraFrame,
): GuidedCalibrationQuality {
  return assessFourPointCalibration(outerBoardHandles, frame, STANDARD_DOUBLE_DIAMETER_MM, {
    missingAnchorMessage: 'Fit all four board-edge handles over a visible camera frame.',
    crossedGuideMessage:
      'The board guide is too small, crossed, or folded. Drag its four edge handles around the double wire.',
  });
}

/**
 * Evaluates a fit inferred from visible red/green scoring bands. Color segmentation itself requires
 * contrast, so soft focus is a player-visible warning rather than a setup dead end; live scoring
 * still holds ambiguous changes instead of claiming a score.
 */
export function assessAutomaticBoardFitQuality(
  outerBoardHandles: readonly ImagePoint[],
  frame: CameraFrame,
): GuidedCalibrationQuality {
  return assessFourPointCalibration(outerBoardHandles, frame, STANDARD_DOUBLE_DIAMETER_MM, {
    missingAnchorMessage: 'Find a complete colored board in a visible camera frame.',
    crossedGuideMessage:
      'The automatically found board shape is too small, crossed, or folded. Reframe the full double wire.',
    focusIsBlocker: false,
  });
}

function assessFourPointCalibration(
  anchors: readonly ImagePoint[],
  frame: CameraFrame,
  canonicalDiameterMm: number,
  messages: Readonly<{
    missingAnchorMessage: string;
    crossedGuideMessage: string;
    focusIsBlocker?: boolean;
  }>,
): GuidedCalibrationQuality {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (anchors.length !== 4 || !anchors.every(isFinitePoint) || !isFrameUsable(frame)) {
    return {
      boardDiameterPixels: 0,
      boardCoverage: 0,
      estimatedOffAxisDegrees: 90,
      sharpness: 0,
      overall: 0,
      pass: false,
      blockers: [messages.missingAnchorMessage],
      warnings,
    };
  }

  const top = anchors[0]!;
  const right = anchors[1]!;
  const bottom = anchors[2]!;
  const left = anchors[3]!;
  const horizontalDiameter =
    (distance(right, left) * STANDARD_DOUBLE_DIAMETER_MM) / canonicalDiameterMm;
  const verticalDiameter =
    (distance(top, bottom) * STANDARD_DOUBLE_DIAMETER_MM) / canonicalDiameterMm;
  const largestDiameter = Math.max(horizontalDiameter, verticalDiameter);
  const smallestDiameter = Math.min(horizontalDiameter, verticalDiameter);
  // The compressed axis is the resolution bottleneck for an oblique board. Do not let a long axis
  // disguise a short axis that cannot resolve narrow scoring bands safely.
  const boardDiameterPixels = smallestDiameter;
  const boardCoverage = boardDiameterPixels / Math.min(frame.width, frame.height);
  const axisRatio = largestDiameter === 0 ? 0 : clamp(smallestDiameter / largestDiameter, 0, 1);
  const estimatedOffAxisDegrees = (Math.acos(axisRatio) * 180) / Math.PI;
  const sharpness = estimateSharpness(frame, anchors);
  const quadrilateralArea = Math.abs(polygonArea([top, right, bottom, left]));

  if (quadrilateralArea < frame.width * frame.height * 0.01) {
    blockers.push(messages.crossedGuideMessage);
  }
  if (boardDiameterPixels < 480) {
    blockers.push(
      `Board is about ${Math.round(boardDiameterPixels)} px across; move closer until it is at least 480 px.`,
    );
  }
  if (estimatedOffAxisDegrees > 55) {
    blockers.push(
      `Guide proportions suggest roughly ${Math.round(estimatedOffAxisDegrees)}° off-axis; move nearer the centreline.`,
    );
  }
  if (sharpness < 7) {
    const message =
      'The board looks soft at this frame size. Let the camera focus, add diffuse light, or move closer.';
    if (messages.focusIsBlocker === false) warnings.push(message);
    else blockers.push(message);
  }
  if (boardCoverage > 0.9) {
    warnings.push(
      'The board nearly fills the short edge. Leave enough room for the full double ring and dart flights.',
    );
  }
  if (estimatedOffAxisDegrees > 35 && estimatedOffAxisDegrees <= 55) {
    warnings.push('This is an oblique field-test view. Expect more score corrections near wires.');
  }
  if (sharpness >= 7 && sharpness < 11) {
    warnings.push('Focus detail is modest. Avoid trusting candidates near scoring wires.');
  }

  const sizeScore = clamp((boardDiameterPixels - 320) / 400, 0, 1);
  const poseScore = clamp((60 - estimatedOffAxisDegrees) / 60, 0, 1);
  const sharpnessScore = clamp(sharpness / 18, 0, 1);
  const overall = clamp(sizeScore * 0.48 + poseScore * 0.3 + sharpnessScore * 0.22, 0, 1);

  return {
    boardDiameterPixels,
    boardCoverage,
    estimatedOffAxisDegrees,
    sharpness,
    overall,
    pass: blockers.length === 0,
    blockers,
    warnings,
  };
}

/**
 * Finds a newly visible localized dart shape by comparing a clear-board reference to a settled
 * frame. It supports both a side-view shaft and a compact flight/occlusion in a near-centreline
 * camera view, but intentionally returns reviewable candidates rather than silently recording a
 * score. A finger, hand, camera move, bounce-out, or stacked dart should stay in the review path.
 */
export function analyzeDartDifference(
  reference: CameraFrame,
  current: CameraFrame,
  homography: Homography,
  options: DifferenceOptions = {},
): DifferenceAnalysis {
  const empty = (status: DifferenceStatus, message: string): DifferenceAnalysis => ({
    status,
    message,
    differenceThreshold: 0,
    changedPixels: 0,
    changedFraction: 0,
    alignmentOffset: NO_FRAME_TRANSLATION,
    shapes: [],
    candidates: [],
  });

  if (!isFrameUsable(reference) || !isFrameUsable(current)) {
    return empty(
      'incompatible-frame',
      'Camera frame data was unavailable. Restart the local camera session.',
    );
  }
  if (reference.width !== current.width || reference.height !== current.height) {
    return empty(
      'incompatible-frame',
      'Camera resolution changed. Capture a new clear-board reference before analyzing another dart.',
    );
  }

  const { width, height } = current;
  const preliminaryAdjustments = estimateChannelAdjustments(reference, current);
  const alignmentOffset = estimateFrameTranslation(
    reference,
    current,
    homography,
    preliminaryAdjustments,
  );
  const adjustments = estimateChannelAdjustments(reference, current, alignmentOffset);
  const adaptiveNoise = estimateAdaptiveNoise(reference, current, adjustments, alignmentOffset);
  // A board-centreline camera often sees a dart flight as a compact local occlusion instead of a
  // long shaft. Keep the floor low enough to preserve that subtle stable change, then let adaptive
  // noise, shape checks, and the two-frame stability gate reject ordinary video noise.
  const differenceThreshold = clamp(
    Math.max(options.minimumDifference ?? 14, adaptiveNoise * 2.5 + 6),
    14,
    72,
  );
  // Keep enough margin for a dart shaft/flight that projects outside the double ring in an oblique
  // view. Only a later candidate endpoint/centroid is allowed to score on the board itself.
  const acceptedRadiusMm = options.acceptedRadiusMm ?? BOARD_RADII_MM.doubleOuter + 140;
  const mask = new Uint8Array(width * height);
  let changedPixels = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const referenceX = x - alignmentOffset.x;
      const referenceY = y - alignmentOffset.y;
      if (referenceX < 1 || referenceX >= width - 1 || referenceY < 1 || referenceY >= height - 1) {
        continue;
      }
      const pixel = y * width + x;
      const currentOffset = pixel * 4;
      const referenceOffset = (referenceY * width + referenceX) * 4;
      const difference = adjustedPixelDifference(
        reference,
        current,
        referenceOffset,
        currentOffset,
        adjustments,
      );
      if (difference < differenceThreshold) continue;

      const boardPoint = mapAlignedImagePointToBoard({ x, y }, homography, alignmentOffset);
      if (boardPoint === null || Math.hypot(boardPoint.xMm, boardPoint.yMm) > acceptedRadiusMm) {
        continue;
      }
      mask[pixel] = 1;
      changedPixels += 1;
    }
  }

  const changedFraction = changedPixels / (width * height);
  if (changedPixels === 0) {
    return {
      status: 'no-change',
      message:
        'No stable local change yet. Throw, step away, wait for the dart to stop moving, then analyze again.',
      differenceThreshold,
      changedPixels,
      changedFraction,
      alignmentOffset,
      shapes: [],
      candidates: [],
    };
  }
  if (changedFraction > MAX_CHANGED_FRACTION) {
    return {
      status: 'camera-moved-or-hand-present',
      message:
        'Too much of the calibrated view changed. Keep the mount still, move hands out of frame, then wait for a settled dart.',
      differenceThreshold,
      changedPixels,
      changedFraction,
      alignmentOffset,
      shapes: [],
      candidates: [],
    };
  }

  const joinedMask = dilateMask(mask, width, height, 2);
  const components = findComponents(joinedMask, width, height);
  const boardDiameterPixels =
    options.boardDiameterPixels ?? estimateBoardDiameterFromHomography(homography);
  const minimumLength = Math.max(14, boardDiameterPixels * 0.055);
  const minimumPixels = Math.max(
    22,
    Math.round(boardDiameterPixels * boardDiameterPixels * 0.00006),
  );
  const shapes = components
    .map((component, index) =>
      buildDartShape(
        component,
        index,
        width,
        homography,
        alignmentOffset,
        minimumLength,
        boardDiameterPixels,
      ),
    )
    .filter((shape): shape is DartShape => shape !== null)
    .filter(
      (shape) =>
        shape.pixelCount >=
        (shape.kind === 'compact' ? Math.max(minimumPixels, 42) : minimumPixels),
    )
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 4);

  if (shapes.length === 0) {
    return {
      status: 'ambiguous-change',
      message:
        'A small change was found, but it did not yet look like a stable dart shaft or compact flight. Hold still for another moment or use ordinary score correction.',
      differenceThreshold,
      changedPixels,
      changedFraction,
      alignmentOffset,
      shapes: [],
      candidates: [],
    };
  }

  const candidates = deduplicateCandidates(
    shapes.flatMap((shape) => candidatesForShape(shape, homography, alignmentOffset)),
  ).slice(0, 4);
  if (candidates.length === 0) {
    return {
      status: 'ambiguous-change',
      message:
        'A dart-like change was found, but it could not be mapped safely onto the board. Find the board again or use ordinary score correction.',
      differenceThreshold,
      changedPixels,
      changedFraction,
      alignmentOffset,
      shapes,
      candidates: [],
    };
  }

  return {
    status: 'dart-candidate',
    message:
      'New dart/flight-shaped change found. Ranking its likely board entry point locally before proposing a correctable score.',
    differenceThreshold,
    changedPixels,
    changedFraction,
    alignmentOffset,
    shapes,
    candidates,
  };
}

export function candidateFromManualPoint(
  imagePoint: ImagePoint,
  homography: Homography,
): DartTipCandidate | null {
  const boardPoint = mapImagePointToBoard(imagePoint, homography);
  if (boardPoint === null) return null;
  return {
    id: `manual-${Math.round(imagePoint.x)}-${Math.round(imagePoint.y)}`,
    shapeId: 'manual',
    endpoint: 'A',
    imagePoint,
    boardPoint,
    zone: decodeBoardPoint(boardPoint),
    wireMarginMm: nearestWireMarginMm(boardPoint),
    tipLikelihood: 1,
    confidence: 1,
    directionEvidence: 'ambiguous-endpoint',
  };
}

export function frameFromImageData(imageData: ImageData, capturedAtMs = Date.now()): CameraFrame {
  return {
    width: imageData.width,
    height: imageData.height,
    rgba: imageData.data,
    capturedAtMs,
  };
}

function mapAlignedImagePointToBoard(
  imagePoint: ImagePoint,
  homography: Homography,
  alignmentOffset: Readonly<ImagePoint> = NO_FRAME_TRANSLATION,
): CanonicalPoint | null {
  return mapImagePointToBoard(
    {
      x: imagePoint.x - alignmentOffset.x,
      y: imagePoint.y - alignmentOffset.y,
    },
    homography,
  );
}

function isFrameUsable(frame: CameraFrame): boolean {
  return (
    Number.isInteger(frame.width) &&
    Number.isInteger(frame.height) &&
    frame.width > 2 &&
    frame.height > 2 &&
    frame.rgba.length === frame.width * frame.height * 4
  );
}

function isFinitePoint(point: ImagePoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function distance(left: ImagePoint, right: ImagePoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function polygonArea(points: readonly ImagePoint[]): number {
  return (
    points.reduce((area, point, index) => {
      const next = points[(index + 1) % points.length];
      return area + point.x * (next?.y ?? 0) - (next?.x ?? 0) * point.y;
    }, 0) / 2
  );
}

function estimateSharpness(frame: CameraFrame, anchors: readonly ImagePoint[]): number {
  const left = Math.max(1, Math.floor(Math.min(...anchors.map((point) => point.x))));
  const right = Math.min(frame.width - 2, Math.ceil(Math.max(...anchors.map((point) => point.x))));
  const top = Math.max(1, Math.floor(Math.min(...anchors.map((point) => point.y))));
  const bottom = Math.min(
    frame.height - 2,
    Math.ceil(Math.max(...anchors.map((point) => point.y))),
  );
  let totalGradient = 0;
  let samples = 0;
  const step = Math.max(1, Math.round(Math.max(right - left, bottom - top) / 240));
  for (let y = top; y <= bottom - step; y += step) {
    for (let x = left; x <= right - step; x += step) {
      const center = luminanceAt(frame, x, y);
      // Sample across the same interval used to scan the frame. This avoids repeatedly landing on
      // one side of a thin wire when the board is downscaled for browser-local processing.
      totalGradient += Math.abs(center - luminanceAt(frame, x + step, y)) / step;
      totalGradient += Math.abs(center - luminanceAt(frame, x, y + step)) / step;
      samples += 2;
    }
  }
  return samples === 0 ? 0 : totalGradient / samples;
}

function luminanceAt(frame: CameraFrame, x: number, y: number): number {
  const offset = (y * frame.width + x) * 4;
  return (
    frame.rgba[offset]! * 0.2126 +
    frame.rgba[offset + 1]! * 0.7152 +
    frame.rgba[offset + 2]! * 0.0722
  );
}

interface ChannelAdjustment {
  gain: number;
  offset: number;
}

type ChannelAdjustments = Readonly<{
  r: ChannelAdjustment;
  g: ChannelAdjustment;
  b: ChannelAdjustment;
}>;

function adjustedPixelDifference(
  reference: CameraFrame,
  current: CameraFrame,
  referenceOffset: number,
  currentOffset: number,
  adjustments: ChannelAdjustments,
): number {
  return (
    (Math.abs(
      current.rgba[currentOffset]! -
        (reference.rgba[referenceOffset]! * adjustments.r.gain + adjustments.r.offset),
    ) +
      Math.abs(
        current.rgba[currentOffset + 1]! -
          (reference.rgba[referenceOffset + 1]! * adjustments.g.gain + adjustments.g.offset),
      ) +
      Math.abs(
        current.rgba[currentOffset + 2]! -
          (reference.rgba[referenceOffset + 2]! * adjustments.b.gain + adjustments.b.offset),
      )) /
    3
  );
}

/**
 * Absorbs a few pixels of camera/cabinet vibration before declaring a broad frame change. This is
 * deliberately a bounded integer translation—not general motion compensation—so a hand, large
 * occlusion, or an actual reframing remains a safety hold instead of being normalized away.
 */
function estimateFrameTranslation(
  reference: CameraFrame,
  current: CameraFrame,
  homography: Homography,
  adjustments: ChannelAdjustments,
): Readonly<ImagePoint> {
  const maximumShift = Math.min(
    8,
    Math.max(2, Math.round(Math.min(reference.width, reference.height) * 0.012)),
  );
  // Use an odd sparse interval so it does not repeatedly alias the regular 8 px/score-wire-like
  // texture that is common in a board view.
  const nominalStep = Math.max(11, Math.round(Math.min(reference.width, reference.height) / 57));
  const step = nominalStep % 2 === 0 ? nominalStep + 1 : nominalStep;
  const samples: ImagePoint[] = [];
  for (let y = maximumShift + 1; y < current.height - maximumShift - 1; y += step) {
    for (let x = maximumShift + 1; x < current.width - maximumShift - 1; x += step) {
      const boardPoint = mapImagePointToBoard({ x, y }, homography);
      // Sample the stable board face rather than the room or space occupied by a protruding flight.
      if (
        boardPoint !== null &&
        Math.hypot(boardPoint.xMm, boardPoint.yMm) <= BOARD_RADII_MM.doubleOuter - 8
      ) {
        samples.push({ x, y });
      }
    }
  }
  if (samples.length < 40) return NO_FRAME_TRANSLATION;

  const scoreOffset = (offsetX: number, offsetY: number) => {
    let total = 0;
    let count = 0;
    for (const sample of samples) {
      const referenceX = sample.x - offsetX;
      const referenceY = sample.y - offsetY;
      if (
        referenceX < 1 ||
        referenceX >= reference.width - 1 ||
        referenceY < 1 ||
        referenceY >= reference.height - 1
      ) {
        continue;
      }
      const currentOffset = (sample.y * current.width + sample.x) * 4;
      const referenceOffset = (referenceY * reference.width + referenceX) * 4;
      // Cap the contribution of a dart/flight or a local glare change so normal board texture
      // determines the alignment.
      total += Math.min(
        52,
        adjustedPixelDifference(reference, current, referenceOffset, currentOffset, adjustments),
      );
      count += 1;
    }
    return count === 0 ? Number.POSITIVE_INFINITY : total / count;
  };

  const stationaryScore = scoreOffset(0, 0);
  let bestOffset = NO_FRAME_TRANSLATION;
  let bestScore = stationaryScore;
  for (let offsetY = -maximumShift; offsetY <= maximumShift; offsetY += 1) {
    for (let offsetX = -maximumShift; offsetX <= maximumShift; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) continue;
      const score = scoreOffset(offsetX, offsetY);
      const shiftLength = Math.hypot(offsetX, offsetY);
      const bestShiftLength = Math.hypot(bestOffset.x, bestOffset.y);
      if (
        score < bestScore - 0.0001 ||
        (Math.abs(score - bestScore) <= 0.0001 && shiftLength < bestShiftLength)
      ) {
        bestScore = score;
        bestOffset = { x: offsetX, y: offsetY };
      }
    }
  }

  const improvement = (stationaryScore - bestScore) / Math.max(1, stationaryScore);
  return improvement >= 0.18 && stationaryScore - bestScore >= 1.5
    ? bestOffset
    : NO_FRAME_TRANSLATION;
}

function estimateChannelAdjustments(
  reference: CameraFrame,
  current: CameraFrame,
  alignmentOffset: Readonly<ImagePoint> = NO_FRAME_TRANSLATION,
): ChannelAdjustments {
  let referenceR = 0;
  let referenceG = 0;
  let referenceB = 0;
  let currentR = 0;
  let currentG = 0;
  let currentB = 0;
  let referenceRSquared = 0;
  let referenceGSquared = 0;
  let referenceBSquared = 0;
  let referenceCurrentR = 0;
  let referenceCurrentG = 0;
  let referenceCurrentB = 0;
  let samples = 0;
  const step = Math.max(4, Math.round(Math.min(reference.width, reference.height) / 80));
  for (let y = 1; y < reference.height - 1; y += step) {
    for (let x = 1; x < reference.width - 1; x += step) {
      const referenceX = x - alignmentOffset.x;
      const referenceY = y - alignmentOffset.y;
      if (
        referenceX < 1 ||
        referenceX >= reference.width - 1 ||
        referenceY < 1 ||
        referenceY >= reference.height - 1
      ) {
        continue;
      }
      const referenceOffset = (referenceY * reference.width + referenceX) * 4;
      const currentOffset = (y * current.width + x) * 4;
      const referenceRed = reference.rgba[referenceOffset]!;
      const referenceGreen = reference.rgba[referenceOffset + 1]!;
      const referenceBlue = reference.rgba[referenceOffset + 2]!;
      const currentRed = current.rgba[currentOffset]!;
      const currentGreen = current.rgba[currentOffset + 1]!;
      const currentBlue = current.rgba[currentOffset + 2]!;
      referenceR += referenceRed;
      referenceG += referenceGreen;
      referenceB += referenceBlue;
      currentR += currentRed;
      currentG += currentGreen;
      currentB += currentBlue;
      referenceRSquared += referenceRed * referenceRed;
      referenceGSquared += referenceGreen * referenceGreen;
      referenceBSquared += referenceBlue * referenceBlue;
      referenceCurrentR += referenceRed * currentRed;
      referenceCurrentG += referenceGreen * currentGreen;
      referenceCurrentB += referenceBlue * currentBlue;
      samples += 1;
    }
  }
  return {
    r: linearChannelAdjustment(referenceR, currentR, referenceRSquared, referenceCurrentR, samples),
    g: linearChannelAdjustment(referenceG, currentG, referenceGSquared, referenceCurrentG, samples),
    b: linearChannelAdjustment(referenceB, currentB, referenceBSquared, referenceCurrentB, samples),
  };
}

function linearChannelAdjustment(
  referenceSum: number,
  currentSum: number,
  referenceSquaredSum: number,
  referenceCurrentSum: number,
  samples: number,
): ChannelAdjustment {
  if (samples === 0) return { gain: 1, offset: 0 };
  const referenceMean = referenceSum / samples;
  const currentMean = currentSum / samples;
  const variance = referenceSquaredSum / samples - referenceMean * referenceMean;
  const covariance = referenceCurrentSum / samples - referenceMean * currentMean;
  // A small global auto-exposure or white-balance change should not mask a newly inserted dart.
  // Clamp the correction tightly so a local hand or dart cannot become the global explanation.
  const gain = variance < 1 ? 1 : clamp(covariance / variance, 0.82, 1.18);
  return { gain, offset: currentMean - referenceMean * gain };
}

function estimateAdaptiveNoise(
  reference: CameraFrame,
  current: CameraFrame,
  adjustments: ChannelAdjustments,
  alignmentOffset: Readonly<ImagePoint>,
): number {
  const values: number[] = [];
  const step = Math.max(6, Math.round(Math.min(reference.width, reference.height) / 70));
  for (let y = 1; y < reference.height - 1; y += step) {
    for (let x = 1; x < reference.width - 1; x += step) {
      const referenceX = x - alignmentOffset.x;
      const referenceY = y - alignmentOffset.y;
      if (
        referenceX < 1 ||
        referenceX >= reference.width - 1 ||
        referenceY < 1 ||
        referenceY >= reference.height - 1
      ) {
        continue;
      }
      const referenceOffset = (referenceY * reference.width + referenceX) * 4;
      const currentOffset = (y * current.width + x) * 4;
      values.push(
        adjustedPixelDifference(reference, current, referenceOffset, currentOffset, adjustments),
      );
    }
  }
  if (values.length === 0) return 0;
  values.sort((left, right) => left - right);
  return values[Math.floor(values.length * 0.5)] ?? 0;
}

function dilateMask(source: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const target = new Uint8Array(source.length);
  for (let y = radius; y < height - radius; y += 1) {
    for (let x = radius; x < width - radius; x += 1) {
      const index = y * width + x;
      if (source[index] !== 1) continue;
      for (let yOffset = -radius; yOffset <= radius; yOffset += 1) {
        for (let xOffset = -radius; xOffset <= radius; xOffset += 1) {
          target[(y + yOffset) * width + x + xOffset] = 1;
        }
      }
    }
  }
  return target;
}

interface PixelComponent {
  pixels: readonly number[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function findComponents(mask: Uint8Array, width: number, height: number): PixelComponent[] {
  const components: PixelComponent[] = [];
  const queue: number[] = [];
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] !== 1) continue;
    queue.length = 0;
    queue.push(index);
    mask[index] = 0;
    let head = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    const pixels: number[] = [];

    while (head < queue.length) {
      const current = queue[head++]!;
      pixels.push(current);
      const x = current % width;
      const y = Math.floor(current / width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
        for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
          if (xOffset === 0 && yOffset === 0) continue;
          const neighborX = x + xOffset;
          const neighborY = y + yOffset;
          if (neighborX < 0 || neighborY < 0 || neighborX >= width || neighborY >= height) continue;
          const neighbor = neighborY * width + neighborX;
          if (mask[neighbor] !== 1) continue;
          mask[neighbor] = 0;
          queue.push(neighbor);
        }
      }
    }
    components.push({ pixels, minX, maxX, minY, maxY });
  }
  return components;
}

function buildDartShape(
  component: PixelComponent,
  index: number,
  width: number,
  homography: Homography,
  alignmentOffset: Readonly<ImagePoint>,
  minimumLength: number,
  boardDiameterPixels: number,
): DartShape | null {
  if (component.pixels.length < 3) return null;
  let sumX = 0;
  let sumY = 0;
  for (const pixel of component.pixels) {
    sumX += pixel % width;
    sumY += Math.floor(pixel / width);
  }
  const center = { x: sumX / component.pixels.length, y: sumY / component.pixels.length };
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (const pixel of component.pixels) {
    const x = (pixel % width) - center.x;
    const y = Math.floor(pixel / width) - center.y;
    xx += x * x;
    yy += y * y;
    xy += x * y;
  }
  xx /= component.pixels.length;
  yy /= component.pixels.length;
  xy /= component.pixels.length;
  const trace = xx + yy;
  const spread = Math.sqrt(Math.max(0, (xx - yy) ** 2 + 4 * xy * xy));
  const majorVariance = Math.max(0, (trace + spread) / 2);
  const minorVariance = Math.max(0, (trace - spread) / 2);
  if (majorVariance <= 0) return null;
  const angle = Math.atan2(2 * xy, xx - yy) / 2;
  const vector = { x: Math.cos(angle), y: Math.sin(angle) };
  let minimumProjection = Number.POSITIVE_INFINITY;
  let maximumProjection = Number.NEGATIVE_INFINITY;
  for (const pixel of component.pixels) {
    const x = (pixel % width) - center.x;
    const y = Math.floor(pixel / width) - center.y;
    const projection = x * vector.x + y * vector.y;
    minimumProjection = Math.min(minimumProjection, projection);
    maximumProjection = Math.max(maximumProjection, projection);
  }
  const lineLengthPixels = maximumProjection - minimumProjection;
  const aspectRatio = Math.sqrt(majorVariance / Math.max(minorVariance, 0.25));
  const elongated = lineLengthPixels >= minimumLength && aspectRatio >= 1.8;
  // When the camera is close to the board centreline, the dart shaft is foreshortened and the
  // visible flight/occlusion is compact rather than long. A localized compact change is useful as
  // a deliberately low-confidence, correctable proposal, but cap its extent to avoid treating a
  // hand or broad shadow as a dart.
  const compactMinimumExtent = Math.max(7, boardDiameterPixels * 0.014);
  const compactMaximumExtent = Math.max(34, boardDiameterPixels * 0.18);
  const compact =
    !elongated &&
    lineLengthPixels >= compactMinimumExtent &&
    lineLengthPixels <= compactMaximumExtent &&
    aspectRatio < 2.55;
  if (!elongated && !compact) return null;

  const endpoints: [ImagePoint, ImagePoint] = [
    {
      x: center.x + minimumProjection * vector.x,
      y: center.y + minimumProjection * vector.y,
    },
    {
      x: center.x + maximumProjection * vector.x,
      y: center.y + maximumProjection * vector.y,
    },
  ];
  const endpointWidths = measureEndpointWidths(
    component.pixels,
    width,
    center,
    vector,
    minimumProjection,
    maximumProjection,
  );
  const endpointMaps = endpoints.map((endpoint) =>
    mapAlignedImagePointToBoard(endpoint, homography, alignmentOffset),
  );
  if (endpointMaps.every((point) => point === null)) return null;
  const lengthScore = clamp((lineLengthPixels / minimumLength - 1) / 2.5, 0, 1);
  const aspectScore = clamp((aspectRatio - 1.8) / 4, 0, 1);
  const countScore = clamp(component.pixels.length / Math.max(60, minimumLength * 3), 0, 1);
  const compactExtentScore = clamp(
    (lineLengthPixels - compactMinimumExtent) /
      Math.max(1, compactMaximumExtent - compactMinimumExtent),
    0,
    1,
  );
  const confidence = elongated
    ? clamp(0.18 + lengthScore * 0.38 + aspectScore * 0.3 + countScore * 0.14, 0, 0.9)
    : clamp(0.2 + compactExtentScore * 0.2 + countScore * 0.16, 0.16, 0.56);

  return {
    id: `shape-${index + 1}`,
    kind: elongated ? 'elongated' : 'compact',
    pixelCount: component.pixels.length,
    bounds: {
      left: component.minX,
      top: component.minY,
      right: component.maxX,
      bottom: component.maxY,
    },
    center,
    endpoints,
    endpointWidths,
    lineLengthPixels,
    aspectRatio,
    confidence,
  };
}

function measureEndpointWidths(
  pixels: readonly number[],
  width: number,
  center: ImagePoint,
  vector: ImagePoint,
  minimumProjection: number,
  maximumProjection: number,
): [number, number] {
  const span = Math.max(1, maximumProjection - minimumProjection);
  const endpointBand = Math.max(4, span * 0.18);
  const perpendicular = { x: -vector.y, y: vector.x };
  const ranges: Array<{ minimum: number; maximum: number; count: number }> = [
    { minimum: Number.POSITIVE_INFINITY, maximum: Number.NEGATIVE_INFINITY, count: 0 },
    { minimum: Number.POSITIVE_INFINITY, maximum: Number.NEGATIVE_INFINITY, count: 0 },
  ];

  for (const pixel of pixels) {
    const dx = (pixel % width) - center.x;
    const dy = Math.floor(pixel / width) - center.y;
    const projection = dx * vector.x + dy * vector.y;
    const endpointIndex =
      projection <= minimumProjection + endpointBand
        ? 0
        : projection >= maximumProjection - endpointBand
          ? 1
          : null;
    if (endpointIndex === null) continue;
    const transverse = dx * perpendicular.x + dy * perpendicular.y;
    const range = ranges[endpointIndex]!;
    range.minimum = Math.min(range.minimum, transverse);
    range.maximum = Math.max(range.maximum, transverse);
    range.count += 1;
  }

  return ranges.map((range) =>
    range.count < 2 ? 0 : Math.max(0, range.maximum - range.minimum),
  ) as [number, number];
}

function candidatesForShape(
  shape: DartShape,
  homography: Homography,
  alignmentOffset: Readonly<ImagePoint>,
): DartTipCandidate[] {
  if (shape.kind === 'compact') {
    const boardPoint = mapAlignedImagePointToBoard(shape.center, homography, alignmentOffset);
    const zone = boardPoint === null ? null : decodeBoardPoint(boardPoint);
    if (boardPoint === null || zone === null || zone.ring === 'MISS') {
      return [];
    }
    // The actual tip may be hidden by a compact flight in a near-centreline view. The centroid is
    // only an approximate entry location, deliberately kept below the normal high-confidence path
    // so the DartCard is prominently reviewable.
    return [
      {
        id: `${shape.id}-center`,
        shapeId: shape.id,
        endpoint: 'center',
        imagePoint: shape.center,
        boardPoint,
        zone,
        wireMarginMm: nearestWireMarginMm(boardPoint),
        tipLikelihood: 0.36,
        confidence: clamp(shape.confidence * 0.72, 0.12, 0.44),
        directionEvidence: 'compact-local-change',
      },
    ];
  }

  const mappedEndpoints = shape.endpoints.map((point) =>
    mapAlignedImagePointToBoard(point, homography, alignmentOffset),
  );
  const endpointZones = mappedEndpoints.map((point) =>
    point === null ? null : decodeBoardPoint(point),
  );
  // A protruding flight can legitimately lie outside the double wire while the dart point is on
  // the board. It must never be recorded as an automatic MISS: retain only endpoints that map to a
  // real scoring bed and hold the change for review when no entry point can be established.
  const endpointOnBoard = endpointZones.map((zone) => zone !== null && zone.ring !== 'MISS');
  const onlyEndpointOnBoard = endpointOnBoard.filter(Boolean).length === 1;

  return mappedEndpoints.flatMap((boardPoint, index) => {
    const zone = endpointZones[index] ?? null;
    if (boardPoint === null || zone === null || zone.ring === 'MISS') return [];
    const directionEvidence = onlyEndpointOnBoard ? 'only-endpoint-on-board' : 'ambiguous-endpoint';
    const endpointWidth = shape.endpointWidths[index] ?? 0;
    const oppositeEndpointWidth = shape.endpointWidths[index === 0 ? 1 : 0] ?? 0;
    // A visible flight tends to widen one end of a changed dart-shaped region. This is only a
    // ranking cue: flights can be hidden, occluded, or look similar under a board-side camera.
    const widthContrast =
      (oppositeEndpointWidth - endpointWidth) / Math.max(6, oppositeEndpointWidth + endpointWidth);
    const tipLikelihood = clamp(
      (directionEvidence === 'only-endpoint-on-board' ? 0.78 : 0.5) + widthContrast * 0.28,
      0.12,
      0.94,
    );
    const confidence = clamp(
      shape.confidence *
        (directionEvidence === 'only-endpoint-on-board'
          ? 0.72 + tipLikelihood * 0.16
          : 0.31 + tipLikelihood * 0.34),
      0.08,
      0.78,
    );
    return [
      {
        id: `${shape.id}-${index === 0 ? 'a' : 'b'}`,
        shapeId: shape.id,
        endpoint: index === 0 ? 'A' : 'B',
        imagePoint: shape.endpoints[index]!,
        boardPoint,
        zone,
        wireMarginMm: nearestWireMarginMm(boardPoint),
        tipLikelihood,
        confidence,
        directionEvidence,
      },
    ];
  });
}

/**
 * Chooses one internally ranked endpoint for the touch-first camera flow. This avoids asking a
 * player to identify a physical steel/soft tip while preserving a normal score-correction path.
 * It intentionally remains deterministic and conservative rather than claiming trained vision.
 */
export function selectAutomaticTipCandidate(
  candidates: readonly DartTipCandidate[],
): DartTipCandidate | null {
  return (
    [...candidates].sort((left, right) => {
      const directionDifference =
        directionEvidenceRank(right.directionEvidence) -
        directionEvidenceRank(left.directionEvidence);
      if (directionDifference !== 0) return directionDifference;
      const likelihoodDifference = right.tipLikelihood - left.tipLikelihood;
      if (Math.abs(likelihoodDifference) > 0.0001) return likelihoodDifference;
      const confidenceDifference = right.confidence - left.confidence;
      if (Math.abs(confidenceDifference) > 0.0001) return confidenceDifference;
      // Prefer a point farther from a wire only as a deterministic final tie-breaker.
      const wireDifference = right.wireMarginMm - left.wireMarginMm;
      if (Math.abs(wireDifference) > 0.0001) return wireDifference;
      return left.id.localeCompare(right.id);
    })[0] ?? null
  );
}

function directionEvidenceRank(evidence: DartTipCandidate['directionEvidence']): number {
  if (evidence === 'only-endpoint-on-board') return 2;
  if (evidence === 'compact-local-change') return 1;
  return 0;
}

function deduplicateCandidates(candidates: readonly DartTipCandidate[]): DartTipCandidate[] {
  return [...candidates]
    .sort((left, right) => right.confidence - left.confidence)
    .filter((candidate, index, sorted) =>
      sorted
        .slice(0, index)
        .every((earlier) => distance(earlier.imagePoint, candidate.imagePoint) > 14),
    );
}

/** A fallback only for non-UI callers that do not have four anchors to estimate scale. */
function estimateBoardDiameterFromHomography(_homography: Homography): number {
  return 480;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
