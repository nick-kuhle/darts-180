import type { DartZone } from '@darts-180/contracts';
import { BOARD_RADII_MM, decodeBoardPoint, nearestWireMarginMm } from '@darts-180/rules';

import {
  invertHomography,
  mapBoardPointToImage,
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
  directionEvidence:
    | 'only-endpoint-on-board'
    | 'narrow-endpoint-shape'
    | 'compact-local-change'
    | 'ambiguous-endpoint';
}

/**
 * Bounded image-space compensation from the clear-board reference into the current frame. It is a
 * small similarity correction for ordinary mount / optical-stabilization jitter, not a substitute
 * for a camera-pose model or arbitrary scene warping.
 */
export interface FrameAlignment {
  /** Board-center displacement from reference pixels to current pixels. */
  offset: ImagePoint;
  /** Current-frame scale relative to the reference, kept close to one. */
  scale: number;
  /** Current-frame rotation relative to the reference, in radians. */
  rotationRadians: number;
  /** Fractional sparse-board improvement over no compensation, for field diagnostics. */
  improvement: number;
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
  /** Changed pixels on the actual scoring face; external flight-margin pixels are shape-only. */
  changedPixels: number;
  /** Pixels on the calibrated scoring face that were actually compared. */
  comparedPixels: number;
  /** Changed fraction of the compared scoring face, never the whole phone frame. */
  changedFraction: number;
  /**
   * Changed fraction inside the stable central board core. This distinguishes a broad hand/camera
   * change from a foreground edge/surround intrusion without treating either as a score.
   */
  stableCoreChangedFraction: number;
  /**
   * A large change was confined to the board edge/surround. Any isolated candidate remains usable
   * as a player-reviewed suggestion, but must not be auto-recorded from that disturbed frame.
   */
  requiresExplicitReview: boolean;
  /**
   * Backward-compatible shortcut for the bounded similarity correction's center displacement.
   * New callers should use `alignment` when they need scale/rotation too.
   */
  alignmentOffset: ImagePoint;
  alignment: FrameAlignment;
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

/**
 * Chooses a board-local flight envelope from the fitted board skew. Front-on cameras do not need a
 * large outside-board search area, while genuinely oblique views retain room for a projected shaft
 * or flight. This affects shape search only—score candidates still have to land on a scoring bed.
 */
export function analysisRadiusForBoardSkew(
  estimatedOffAxisDegrees: number | null | undefined,
): number {
  if (
    estimatedOffAxisDegrees === null ||
    estimatedOffAxisDegrees === undefined ||
    !Number.isFinite(estimatedOffAxisDegrees)
  ) {
    return DEFAULT_ANALYSIS_RADIUS_MM;
  }
  if (estimatedOffAxisDegrees <= 18) {
    return BOARD_RADII_MM.doubleOuter + CENTRELINE_ANALYSIS_MARGIN_MM;
  }
  if (estimatedOffAxisDegrees <= 35) {
    return BOARD_RADII_MM.doubleOuter + MODERATE_SKEW_ANALYSIS_MARGIN_MM;
  }
  return BOARD_RADII_MM.doubleOuter + OBLIQUE_ANALYSIS_MARGIN_MM;
}

const STANDARD_DOUBLE_DIAMETER_MM = BOARD_RADII_MM.doubleOuter * 2;
const CARDINAL_ANCHOR_SEPARATION_MM = 332;
// Measured on the scoring face only. A settled dart normally changes well below one percent; a
// six-and-a-half-percent ceiling leaves room for natural video noise while holding a reframe/hand.
const MAX_CHANGED_FRACTION = 0.065;
// Estimate exposure, noise, and pose from the visible board face—not walls, cabinet shadows, or
// the deliberately permitted flight margin around it.
const STABLE_BOARD_SUPPORT_RADIUS_MM = BOARD_RADII_MM.doubleOuter - 10;
// Broad-motion decisions belong to the actual scoring face. A dart's flight may extend outside it,
// but cabinet / wall movement in the permitted flight margin must not dominate temporal safety.
const MOTION_BOARD_SUPPORT_RADIUS_MM = BOARD_RADII_MM.doubleOuter + 4;
// A foreground just along the lower rim (for example a player stepping clear below a centreline
// mount) should not be mistaken for a full-board camera/hand movement. A real reframe changes the
// stable core too; a very large face change remains a hard safety stop regardless of core coverage.
const STABLE_CORE_MOTION_RADIUS_MM = BOARD_RADII_MM.trebleOuter;
const MAX_STABLE_CORE_CHANGED_FRACTION = 0.025;
// If a broad core change pushes the median residual high, the adaptive pixel threshold may mask
// most of that same change. Keep that signal as a second broad-motion guard rather than mistaking
// the remaining edge fragments for a local dart.
const MAX_LOCAL_EVENT_ADAPTIVE_NOISE = 20;
const HARD_MAX_CHANGED_FRACTION = 0.14;
// A side-view flight can extend past the double wire, but a generic +70 mm envelope admits a large
// amount of lower-room foreground on a centred portrait phone. The normal generic default retains a
// moderate margin; Camera Play selects an even tighter or wider value from the measured board skew.
const DEFAULT_ANALYSIS_RADIUS_MM = BOARD_RADII_MM.doubleOuter + 42;
const CENTRELINE_ANALYSIS_MARGIN_MM = 24;
const MODERATE_SKEW_ANALYSIS_MARGIN_MM = 42;
const OBLIQUE_ANALYSIS_MARGIN_MM = 70;
const NO_FRAME_TRANSLATION: Readonly<ImagePoint> = { x: 0, y: 0 };
const NO_FRAME_ALIGNMENT: Readonly<FrameAlignment> = {
  offset: NO_FRAME_TRANSLATION,
  scale: 1,
  rotationRadians: 0,
  improvement: 0,
};

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
    comparedPixels: 0,
    changedFraction: 0,
    stableCoreChangedFraction: 0,
    requiresExplicitReview: false,
    alignmentOffset: NO_FRAME_TRANSLATION,
    alignment: NO_FRAME_ALIGNMENT,
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
  const alignmentCenter = estimateBoardImageCenter(homography, width, height);
  // Estimate illumination only over the stable board face. Phone auto-exposure should not be fit
  // against a dark cabinet, a hand in the room, or the flight margin where a dart is expected.
  const preliminaryAdjustments = estimateChannelAdjustments(
    reference,
    current,
    homography,
    NO_FRAME_ALIGNMENT,
    alignmentCenter,
  );
  const alignment = estimateFrameAlignment(
    reference,
    current,
    homography,
    preliminaryAdjustments,
    alignmentCenter,
  );
  const adjustments = estimateChannelAdjustments(
    reference,
    current,
    homography,
    alignment,
    alignmentCenter,
  );
  const adaptiveNoise = estimateAdaptiveNoise(
    reference,
    current,
    homography,
    adjustments,
    alignment,
    alignmentCenter,
  );
  // A board-centreline camera often sees a dart flight as a compact local occlusion instead of a
  // long shaft. Keep the floor low enough to preserve that subtle stable change, then let adaptive
  // noise, shape checks, and the two-frame stability gate reject ordinary video noise.
  const differenceThreshold = clamp(
    Math.max(options.minimumDifference ?? 14, adaptiveNoise * 2.5 + 6),
    14,
    72,
  );
  // Keep enough margin for a dart shaft/flight that projects outside the double ring in an oblique
  // view without admitting most of a portrait phone image. Only a later endpoint on a real scoring
  // bed can be eligible for automatic scoring.
  const acceptedRadiusMm = options.acceptedRadiusMm ?? DEFAULT_ANALYSIS_RADIUS_MM;
  const mask = new Uint8Array(width * height);
  let changedPixels = 0;
  let comparedPixels = 0;
  let stableCoreChangedPixels = 0;
  let stableCoreComparedPixels = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const referencePoint = mapCurrentPointToReference({ x, y }, alignment, alignmentCenter);
      if (!isReferencePointInsideFrame(referencePoint, width, height)) continue;
      const boardPoint = mapImagePointToBoard(referencePoint, homography);
      if (boardPoint === null) continue;
      const boardRadiusMm = Math.hypot(boardPoint.xMm, boardPoint.yMm);
      if (boardRadiusMm > acceptedRadiusMm) continue;
      const onScoringFace = boardRadiusMm <= MOTION_BOARD_SUPPORT_RADIUS_MM;
      const onStableCore = boardRadiusMm <= STABLE_CORE_MOTION_RADIUS_MM;
      if (onScoringFace) comparedPixels += 1;
      if (onStableCore) stableCoreComparedPixels += 1;
      const pixel = y * width + x;
      const difference = adjustedPixelDifferenceAt(
        reference,
        current,
        referencePoint,
        pixel * 4,
        adjustments,
      );
      if (difference < differenceThreshold) continue;
      // Retain a local outside-board flight extension for connected-shape geometry, but only a
      // change that reaches the scoring face can trigger / classify a dart event.
      mask[pixel] = 1;
      if (onScoringFace) changedPixels += 1;
      if (onStableCore) stableCoreChangedPixels += 1;
    }
  }

  const changedFraction = changedPixels / Math.max(1, comparedPixels);
  const stableCoreChangedFraction = stableCoreChangedPixels / Math.max(1, stableCoreComparedPixels);
  if (changedPixels === 0) {
    return {
      status: 'no-change',
      message:
        'No stable local change yet. Throw, step away, wait for the dart to stop moving, then analyze again.',
      differenceThreshold,
      changedPixels,
      comparedPixels,
      changedFraction,
      stableCoreChangedFraction,
      requiresExplicitReview: false,
      alignmentOffset: alignment.offset,
      alignment,
      shapes: [],
      candidates: [],
    };
  }
  const broadMotionTouchesStableCore =
    stableCoreChangedFraction > MAX_STABLE_CORE_CHANGED_FRACTION ||
    adaptiveNoise > MAX_LOCAL_EVENT_ADAPTIVE_NOISE;
  const requiresExplicitReview =
    changedFraction > MAX_CHANGED_FRACTION &&
    !broadMotionTouchesStableCore &&
    changedFraction <= HARD_MAX_CHANGED_FRACTION;
  if (
    changedFraction > MAX_CHANGED_FRACTION &&
    (broadMotionTouchesStableCore || changedFraction > HARD_MAX_CHANGED_FRACTION)
  ) {
    return {
      status: 'camera-moved-or-hand-present',
      message:
        'Too much of the calibrated board changed. Keep the mount still, move hands out of frame, then wait for a settled dart.',
      differenceThreshold,
      changedPixels,
      comparedPixels,
      changedFraction,
      stableCoreChangedFraction,
      requiresExplicitReview: true,
      alignmentOffset: alignment.offset,
      alignment,
      shapes: [],
      candidates: [],
    };
  }

  const joinedMask = dilateMask(mask, width, height, 2);
  const components = findComponents(joinedMask, width, height);
  const boardDiameterPixels =
    options.boardDiameterPixels ?? estimateBoardDiameterFromHomography(homography);
  const minimumLength = Math.max(14, boardDiameterPixels * 0.055);
  const maximumElongatedLength = boardDiameterPixels * maximumDartLengthRatio(acceptedRadiusMm);
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
        alignment,
        alignmentCenter,
        minimumLength,
        maximumElongatedLength,
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
      comparedPixels,
      changedFraction,
      stableCoreChangedFraction,
      requiresExplicitReview,
      alignmentOffset: alignment.offset,
      alignment,
      shapes: [],
      candidates: [],
    };
  }

  const candidates = deduplicateCandidates(
    shapes.flatMap((shape) => candidatesForShape(shape, homography, alignment, alignmentCenter)),
  ).slice(0, 4);
  if (candidates.length === 0) {
    return {
      status: 'ambiguous-change',
      message:
        'A dart-like change was found, but it could not be mapped safely onto the board. Find the board again or use ordinary score correction.',
      differenceThreshold,
      changedPixels,
      comparedPixels,
      changedFraction,
      stableCoreChangedFraction,
      requiresExplicitReview,
      alignmentOffset: alignment.offset,
      alignment,
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
    comparedPixels,
    changedFraction,
    stableCoreChangedFraction,
    requiresExplicitReview,
    alignmentOffset: alignment.offset,
    alignment,
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

function estimateBoardImageCenter(
  homography: Homography,
  width: number,
  height: number,
): Readonly<ImagePoint> {
  const inverse = invertHomography(homography);
  const mapped = inverse === null ? null : mapBoardPointToImage({ xMm: 0, yMm: 0 }, inverse);
  return mapped ?? { x: width / 2, y: height / 2 };
}

/** Maps a current-frame pixel back into the clear-board reference image. */
function mapCurrentPointToReference(
  imagePoint: ImagePoint,
  alignment: Readonly<FrameAlignment>,
  center: Readonly<ImagePoint>,
): ImagePoint {
  // Reference → current is: center + offset + scale × rotation × (reference - center).
  // Undo that bounded similarity transform before querying the reference image / board map.
  const translatedX = imagePoint.x - center.x - alignment.offset.x;
  const translatedY = imagePoint.y - center.y - alignment.offset.y;
  const inverseScale = 1 / Math.max(0.001, alignment.scale);
  const cosine = Math.cos(alignment.rotationRadians);
  const sine = Math.sin(alignment.rotationRadians);
  return {
    x: center.x + inverseScale * (translatedX * cosine + translatedY * sine),
    y: center.y + inverseScale * (-translatedX * sine + translatedY * cosine),
  };
}

function mapCurrentImagePointToBoard(
  imagePoint: ImagePoint,
  homography: Homography,
  alignment: Readonly<FrameAlignment>,
  alignmentCenter: Readonly<ImagePoint>,
): CanonicalPoint | null {
  return mapImagePointToBoard(
    mapCurrentPointToReference(imagePoint, alignment, alignmentCenter),
    homography,
  );
}

function isReferencePointInsideFrame(
  point: Readonly<ImagePoint>,
  width: number,
  height: number,
): boolean {
  return point.x >= 1 && point.x < width - 1 && point.y >= 1 && point.y < height - 1;
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

/**
 * Reads a reference pixel with bilinear interpolation. Similarity compensation commonly lands
 * between source pixels; interpolation prevents sub-pixel optical stabilization from turning every
 * wire edge into a false temporal change.
 */
function interpolatedReferenceChannel(
  frame: CameraFrame,
  x: number,
  y: number,
  channel: 0 | 1 | 2,
): number {
  const left = Math.floor(x);
  const top = Math.floor(y);
  const right = left + 1;
  const bottom = top + 1;
  const xFraction = x - left;
  const yFraction = y - top;
  const topLeft = frame.rgba[(top * frame.width + left) * 4 + channel]!;
  const topRight = frame.rgba[(top * frame.width + right) * 4 + channel]!;
  const bottomLeft = frame.rgba[(bottom * frame.width + left) * 4 + channel]!;
  const bottomRight = frame.rgba[(bottom * frame.width + right) * 4 + channel]!;
  const topValue = topLeft + (topRight - topLeft) * xFraction;
  const bottomValue = bottomLeft + (bottomRight - bottomLeft) * xFraction;
  return topValue + (bottomValue - topValue) * yFraction;
}

function adjustedPixelDifferenceAt(
  reference: CameraFrame,
  current: CameraFrame,
  referencePoint: Readonly<ImagePoint>,
  currentOffset: number,
  adjustments: ChannelAdjustments,
): number {
  const referenceRed = interpolatedReferenceChannel(
    reference,
    referencePoint.x,
    referencePoint.y,
    0,
  );
  const referenceGreen = interpolatedReferenceChannel(
    reference,
    referencePoint.x,
    referencePoint.y,
    1,
  );
  const referenceBlue = interpolatedReferenceChannel(
    reference,
    referencePoint.x,
    referencePoint.y,
    2,
  );
  return (
    (Math.abs(
      current.rgba[currentOffset]! - (referenceRed * adjustments.r.gain + adjustments.r.offset),
    ) +
      Math.abs(
        current.rgba[currentOffset + 1]! -
          (referenceGreen * adjustments.g.gain + adjustments.g.offset),
      ) +
      Math.abs(
        current.rgba[currentOffset + 2]! -
          (referenceBlue * adjustments.b.gain + adjustments.b.offset),
      )) /
    3
  );
}

function maximumFrameTranslationPixels(reference: CameraFrame): number {
  // A 480–720 px board can shift by roughly 10–16 px when mobile optical stabilization recenters
  // after a throw. This remains intentionally bounded so a meaningful reframe is held, not warped
  // away as though it were a dart.
  return Math.min(16, Math.max(3, Math.round(Math.min(reference.width, reference.height) * 0.024)));
}

function stableBoardSamples(
  frame: CameraFrame,
  homography: Homography,
  maximumShift: number,
): ImagePoint[] {
  // Use an odd sparse interval so it does not repeatedly alias regular score-wire-like texture.
  const nominalStep = Math.max(11, Math.round(Math.min(frame.width, frame.height) / 57));
  const step = nominalStep % 2 === 0 ? nominalStep + 1 : nominalStep;
  const samples: ImagePoint[] = [];
  for (let y = maximumShift + 1; y < frame.height - maximumShift - 1; y += step) {
    for (let x = maximumShift + 1; x < frame.width - maximumShift - 1; x += step) {
      const boardPoint = mapImagePointToBoard({ x, y }, homography);
      if (
        boardPoint !== null &&
        Math.hypot(boardPoint.xMm, boardPoint.yMm) <= STABLE_BOARD_SUPPORT_RADIUS_MM
      ) {
        samples.push({ x, y });
      }
    }
  }
  return samples;
}

function scoreFrameAlignment(
  reference: CameraFrame,
  current: CameraFrame,
  samples: readonly ImagePoint[],
  adjustments: ChannelAdjustments,
  alignment: Readonly<FrameAlignment>,
  alignmentCenter: Readonly<ImagePoint>,
): number {
  let total = 0;
  let count = 0;
  for (const sample of samples) {
    const referencePoint = mapCurrentPointToReference(sample, alignment, alignmentCenter);
    if (!isReferencePointInsideFrame(referencePoint, reference.width, reference.height)) continue;
    const currentOffset = (sample.y * current.width + sample.x) * 4;
    // Cap a local dart, flight, or glare change so the normal board texture determines pose.
    total += Math.min(
      52,
      adjustedPixelDifferenceAt(reference, current, referencePoint, currentOffset, adjustments),
    );
    count += 1;
  }
  return count === 0 ? Number.POSITIVE_INFINITY : total / count;
}

function findBestFrameTranslation(
  reference: CameraFrame,
  current: CameraFrame,
  samples: readonly ImagePoint[],
  adjustments: ChannelAdjustments,
  alignmentCenter: Readonly<ImagePoint>,
): Readonly<{ offset: ImagePoint; score: number }> {
  const maximumShift = maximumFrameTranslationPixels(reference);
  let bestOffset: ImagePoint = NO_FRAME_TRANSLATION;
  let bestScore = scoreFrameAlignment(
    reference,
    current,
    samples,
    adjustments,
    NO_FRAME_ALIGNMENT,
    alignmentCenter,
  );
  for (let offsetY = -maximumShift; offsetY <= maximumShift; offsetY += 1) {
    for (let offsetX = -maximumShift; offsetX <= maximumShift; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) continue;
      const alignment: FrameAlignment = {
        ...NO_FRAME_ALIGNMENT,
        offset: { x: offsetX, y: offsetY },
      };
      const score = scoreFrameAlignment(
        reference,
        current,
        samples,
        adjustments,
        alignment,
        alignmentCenter,
      );
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
  return { offset: bestOffset, score: bestScore };
}

/**
 * Estimates a deliberately small similarity transform after a dart impact or mobile optical
 * stabilization adjustment. It only uses the board face and only takes effect when it clearly
 * outperforms a stationary interpretation; hands and large scene changes remain broad-motion holds.
 */
function estimateFrameAlignment(
  reference: CameraFrame,
  current: CameraFrame,
  homography: Homography,
  adjustments: ChannelAdjustments,
  alignmentCenter: Readonly<ImagePoint>,
): FrameAlignment {
  const samples = stableBoardSamples(
    reference,
    homography,
    maximumFrameTranslationPixels(reference),
  );
  if (samples.length < 40) return NO_FRAME_ALIGNMENT;

  const stationaryScore = scoreFrameAlignment(
    reference,
    current,
    samples,
    adjustments,
    NO_FRAME_ALIGNMENT,
    alignmentCenter,
  );
  const coarse = findBestFrameTranslation(
    reference,
    current,
    samples,
    adjustments,
    alignmentCenter,
  );
  let best: FrameAlignment = { ...NO_FRAME_ALIGNMENT, offset: coarse.offset };
  let bestScore = coarse.score;
  const scaleOffsets = [-0.018, -0.009, 0, 0.009, 0.018];
  const rotationOffsets = [-0.014, -0.007, 0, 0.007, 0.014];

  for (const scaleOffset of scaleOffsets) {
    for (const rotationRadians of rotationOffsets) {
      const alignment: FrameAlignment = {
        ...best,
        scale: 1 + scaleOffset,
        rotationRadians,
      };
      const score = scoreFrameAlignment(
        reference,
        current,
        samples,
        adjustments,
        alignment,
        alignmentCenter,
      );
      if (isBetterAlignment(score, alignment, bestScore, best)) {
        best = alignment;
        bestScore = score;
      }
    }
  }

  // A small scale / rotation correction shifts the apparent board center slightly. Refine only a
  // ±3 px neighborhood so this remains a bounded jitter correction, not generic registration.
  const maximumShift = maximumFrameTranslationPixels(reference);
  for (let offsetY = best.offset.y - 3; offsetY <= best.offset.y + 3; offsetY += 1) {
    for (let offsetX = best.offset.x - 3; offsetX <= best.offset.x + 3; offsetX += 1) {
      if (Math.abs(offsetX) > maximumShift || Math.abs(offsetY) > maximumShift) continue;
      const alignment: FrameAlignment = { ...best, offset: { x: offsetX, y: offsetY } };
      const score = scoreFrameAlignment(
        reference,
        current,
        samples,
        adjustments,
        alignment,
        alignmentCenter,
      );
      if (isBetterAlignment(score, alignment, bestScore, best)) {
        best = alignment;
        bestScore = score;
      }
    }
  }

  const absoluteImprovement = stationaryScore - bestScore;
  const improvement = absoluteImprovement / Math.max(1, stationaryScore);
  // A localized dart cannot meaningfully improve a sparse whole-board alignment score by itself.
  // Requiring both relative and absolute improvement prevents endpoint content from becoming a pose
  // explanation while accepting the modest optical-stabilization motion observed in field evidence.
  if (improvement < 0.14 || absoluteImprovement < 1.2) return NO_FRAME_ALIGNMENT;
  return { ...best, improvement };
}

function isBetterAlignment(
  score: number,
  candidate: Readonly<FrameAlignment>,
  bestScore: number,
  currentBest: Readonly<FrameAlignment>,
): boolean {
  if (score < bestScore - 0.0001) return true;
  if (Math.abs(score - bestScore) > 0.0001) return false;
  // Prefer the least deformation when the sparse board fit is indistinguishable.
  return alignmentMagnitude(candidate) < alignmentMagnitude(currentBest);
}

function alignmentMagnitude(alignment: Readonly<FrameAlignment>): number {
  return (
    Math.hypot(alignment.offset.x, alignment.offset.y) / 16 +
    Math.abs(alignment.scale - 1) * 25 +
    Math.abs(alignment.rotationRadians) * 18
  );
}

function estimateChannelAdjustments(
  reference: CameraFrame,
  current: CameraFrame,
  homography: Homography,
  alignment: Readonly<FrameAlignment>,
  alignmentCenter: Readonly<ImagePoint>,
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
      const referencePoint = mapCurrentPointToReference({ x, y }, alignment, alignmentCenter);
      if (!isReferencePointInsideFrame(referencePoint, reference.width, reference.height)) continue;
      const boardPoint = mapImagePointToBoard(referencePoint, homography);
      if (
        boardPoint === null ||
        Math.hypot(boardPoint.xMm, boardPoint.yMm) > STABLE_BOARD_SUPPORT_RADIUS_MM
      ) {
        continue;
      }
      const referenceRed = interpolatedReferenceChannel(
        reference,
        referencePoint.x,
        referencePoint.y,
        0,
      );
      const referenceGreen = interpolatedReferenceChannel(
        reference,
        referencePoint.x,
        referencePoint.y,
        1,
      );
      const referenceBlue = interpolatedReferenceChannel(
        reference,
        referencePoint.x,
        referencePoint.y,
        2,
      );
      const currentOffset = (y * current.width + x) * 4;
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
  homography: Homography,
  adjustments: ChannelAdjustments,
  alignment: Readonly<FrameAlignment>,
  alignmentCenter: Readonly<ImagePoint>,
): number {
  const values: number[] = [];
  const step = Math.max(6, Math.round(Math.min(reference.width, reference.height) / 70));
  for (let y = 1; y < reference.height - 1; y += step) {
    for (let x = 1; x < reference.width - 1; x += step) {
      const referencePoint = mapCurrentPointToReference({ x, y }, alignment, alignmentCenter);
      if (!isReferencePointInsideFrame(referencePoint, reference.width, reference.height)) continue;
      const boardPoint = mapImagePointToBoard(referencePoint, homography);
      if (
        boardPoint === null ||
        Math.hypot(boardPoint.xMm, boardPoint.yMm) > STABLE_BOARD_SUPPORT_RADIUS_MM
      ) {
        continue;
      }
      const currentOffset = (y * current.width + x) * 4;
      values.push(
        adjustedPixelDifferenceAt(reference, current, referencePoint, currentOffset, adjustments),
      );
    }
  }
  if (values.length === 0) return 0;
  values.sort((left, right) => left - right);
  return values[Math.floor(values.length * 0.5)] ?? 0;
}

function maximumDartLengthRatio(acceptedRadiusMm: number): number {
  const outsideMarginMm = acceptedRadiusMm - BOARD_RADII_MM.doubleOuter;
  // A centred camera sees a heavily foreshortened dart, so a board-length component is foreground
  // noise rather than a plausible shaft. An oblique view genuinely projects more dart length, and
  // its wider allowed flight envelope receives a correspondingly larger (still bounded) allowance.
  if (outsideMarginMm <= CENTRELINE_ANALYSIS_MARGIN_MM) return 0.64;
  if (outsideMarginMm <= MODERATE_SKEW_ANALYSIS_MARGIN_MM) return 0.74;
  return 0.9;
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
  alignment: Readonly<FrameAlignment>,
  alignmentCenter: Readonly<ImagePoint>,
  minimumLength: number,
  maximumElongatedLength: number,
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
  // Do not let a long lower-room foreground edge, blanket fold, or board-sized shadow impersonate
  // a narrow shaft merely because its connected-component aspect ratio is high. The allowance is
  // chosen by the caller's fitted-view envelope: tighter for a centreline camera and broader only
  // for a genuinely oblique view.
  const elongated =
    lineLengthPixels >= minimumLength &&
    lineLengthPixels <= maximumElongatedLength &&
    aspectRatio >= 1.8;
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
    mapCurrentImagePointToBoard(endpoint, homography, alignment, alignmentCenter),
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
  alignment: Readonly<FrameAlignment>,
  alignmentCenter: Readonly<ImagePoint>,
): DartTipCandidate[] {
  if (shape.kind === 'compact') {
    const boardPoint = mapCurrentImagePointToBoard(
      shape.center,
      homography,
      alignment,
      alignmentCenter,
    );
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
    mapCurrentImagePointToBoard(point, homography, alignment, alignmentCenter),
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
    const endpointWidth = shape.endpointWidths[index] ?? 0;
    const oppositeEndpointWidth = shape.endpointWidths[index === 0 ? 1 : 0] ?? 0;
    // A clearly visible flight is wider than the shaft/point end. Treat that as direct direction
    // evidence only when the gap is sizeable relative to this shape; equal-width endpoints are
    // deliberately ambiguous rather than arbitrarily picking the endpoint closer to the bull.
    const minimumFlightWidthGap = Math.max(
      4,
      Math.min(14, Math.round(shape.lineLengthPixels * 0.08)),
    );
    const narrowEndpointShape =
      !onlyEndpointOnBoard &&
      oppositeEndpointWidth - endpointWidth >= minimumFlightWidthGap &&
      oppositeEndpointWidth >= Math.max(6, endpointWidth * 1.55);
    const directionEvidence = onlyEndpointOnBoard
      ? 'only-endpoint-on-board'
      : narrowEndpointShape
        ? 'narrow-endpoint-shape'
        : 'ambiguous-endpoint';
    const widthContrast =
      (oppositeEndpointWidth - endpointWidth) / Math.max(6, oppositeEndpointWidth + endpointWidth);
    const directionBase =
      directionEvidence === 'only-endpoint-on-board'
        ? 0.8
        : directionEvidence === 'narrow-endpoint-shape'
          ? 0.72
          : 0.5;
    const tipLikelihood = clamp(directionBase + widthContrast * 0.22, 0.12, 0.94);
    const confidence = clamp(
      shape.confidence *
        (directionEvidence === 'only-endpoint-on-board'
          ? 0.76 + tipLikelihood * 0.16
          : directionEvidence === 'narrow-endpoint-shape'
            ? 0.66 + tipLikelihood * 0.2
            : 0.31 + tipLikelihood * 0.34),
      0.08,
      0.8,
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
 * Whether a candidate has enough direct visual direction evidence to add without making the player
 * choose a physical tip. Compact changes and equal-width endpoint pairs remain usable diagnostic /
 * correction evidence, but are intentionally not automatic scores.
 */
export function isAutomaticTipCandidateEligible(candidate: DartTipCandidate): boolean {
  if (candidate.zone.ring === 'MISS' || candidate.endpoint === 'center') return false;
  if (
    candidate.directionEvidence !== 'only-endpoint-on-board' &&
    candidate.directionEvidence !== 'narrow-endpoint-shape'
  ) {
    return false;
  }
  if (candidate.confidence < 0.55 || candidate.wireMarginMm < 1.5) return false;
  const requiredTipLikelihood =
    candidate.directionEvidence === 'narrow-endpoint-shape' ? 0.72 : 0.68;
  return candidate.tipLikelihood >= requiredTipLikelihood;
}

/**
 * Picks one local *review* suggestion for an isolated single shape. It may be a compact centroid
 * or ambiguous endpoint, so callers must require an explicit player action; it is deliberately not
 * an automatic-score selector. Competing mapped shapes return `null` rather than being collapsed.
 */
export function selectReviewTipCandidate(
  candidates: readonly DartTipCandidate[],
): DartTipCandidate | null {
  if (new Set(candidates.map((candidate) => candidate.shapeId)).size > 1) return null;
  return (
    rankTipCandidates(candidates.filter((candidate) => candidate.zone.ring !== 'MISS'))[0] ?? null
  );
}

/**
 * Chooses only an automatic-score-eligible endpoint for the touch-first camera flow. This avoids
 * silently recording a compact-flight centroid or arbitrary ambiguous endpoint; those cases stay
 * in an explicit review / ordinary correction path instead of being treated as a score.
 */
export function selectAutomaticTipCandidate(
  candidates: readonly DartTipCandidate[],
): DartTipCandidate | null {
  // A normal throw should yield one isolated dart shape. If independent mapped changes compete,
  // keep the entire event in correction rather than accepting one and silently absorbing the rest.
  if (new Set(candidates.map((candidate) => candidate.shapeId)).size > 1) return null;
  return rankTipCandidates(candidates.filter(isAutomaticTipCandidateEligible))[0] ?? null;
}

function rankTipCandidates(candidates: readonly DartTipCandidate[]): DartTipCandidate[] {
  return [...candidates].sort((left, right) => {
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
  });
}

function directionEvidenceRank(evidence: DartTipCandidate['directionEvidence']): number {
  if (evidence === 'only-endpoint-on-board') return 3;
  if (evidence === 'narrow-endpoint-shape') return 2;
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
