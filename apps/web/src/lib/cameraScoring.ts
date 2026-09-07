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
  endpoint: 'A' | 'B';
  imagePoint: ImagePoint;
  boardPoint: CanonicalPoint;
  zone: DartZone;
  wireMarginMm: number;
  /** Heuristic endpoint ranking from board containment and apparent endpoint width; not a probability. */
  tipLikelihood: number;
  /** A heuristic shape/endpoint ranking, never a calibrated score probability. */
  confidence: number;
  directionEvidence: 'only-endpoint-on-board' | 'ambiguous-endpoint';
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

function assessFourPointCalibration(
  anchors: readonly ImagePoint[],
  frame: CameraFrame,
  canonicalDiameterMm: number,
  messages: Readonly<{ missingAnchorMessage: string; crossedGuideMessage: string }>,
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
  const boardDiameterPixels = (horizontalDiameter + verticalDiameter) / 2;
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
    blockers.push(
      'The board looks soft at this frame size. Let the camera focus, add diffuse light, or move closer.',
    );
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
 * Finds a newly visible elongated shape by comparing a clear-board reference to a settled frame.
 * It intentionally returns candidates rather than silently recording a score. A finger, hand,
 * camera move, bounce-out, or stacked dart should stay in the review path.
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
  const offsets = estimateChannelOffsets(reference, current);
  const adaptiveNoise = estimateAdaptiveNoise(reference, current, offsets);
  const differenceThreshold = clamp(
    Math.max(options.minimumDifference ?? 22, adaptiveNoise * 3 + 8),
    18,
    72,
  );
  const acceptedRadiusMm = options.acceptedRadiusMm ?? BOARD_RADII_MM.doubleOuter + 90;
  const mask = new Uint8Array(width * height);
  let changedPixels = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const pixel = y * width + x;
      const offset = pixel * 4;
      const difference =
        (Math.abs(current.rgba[offset]! - reference.rgba[offset]! - offsets.r) +
          Math.abs(current.rgba[offset + 1]! - reference.rgba[offset + 1]! - offsets.g) +
          Math.abs(current.rgba[offset + 2]! - reference.rgba[offset + 2]! - offsets.b)) /
        3;
      if (difference < differenceThreshold) continue;

      const boardPoint = mapImagePointToBoard({ x, y }, homography);
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
    .map((component, index) => buildDartShape(component, index, width, homography, minimumLength))
    .filter((shape): shape is DartShape => shape !== null)
    .filter((shape) => shape.pixelCount >= minimumPixels)
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 4);

  if (shapes.length === 0) {
    return {
      status: 'ambiguous-change',
      message:
        'A small change was found, but it did not look like a stable dart shaft. Tap the visible tip manually or wait and try again.',
      differenceThreshold,
      changedPixels,
      changedFraction,
      shapes: [],
      candidates: [],
    };
  }

  const candidates = deduplicateCandidates(
    shapes.flatMap((shape) => candidatesForShape(shape, homography)),
  ).slice(0, 4);
  if (candidates.length === 0) {
    return {
      status: 'ambiguous-change',
      message:
        'A dart-shaped change was found, but its endpoints could not be mapped safely onto the calibrated board. Recalibrate or select the visible tip manually.',
      differenceThreshold,
      changedPixels,
      changedFraction,
      shapes,
      candidates: [],
    };
  }

  return {
    status: 'dart-candidate',
    message:
      'Dart-shaped change found. Select the endpoint that is visibly the tip, or use Manual tip if neither marker is correct.',
    differenceThreshold,
    changedPixels,
    changedFraction,
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

function estimateChannelOffsets(
  reference: CameraFrame,
  current: CameraFrame,
): {
  r: number;
  g: number;
  b: number;
} {
  let r = 0;
  let g = 0;
  let b = 0;
  let samples = 0;
  const step = Math.max(4, Math.round(Math.min(reference.width, reference.height) / 80));
  for (let y = 1; y < reference.height - 1; y += step) {
    for (let x = 1; x < reference.width - 1; x += step) {
      const offset = (y * reference.width + x) * 4;
      r += current.rgba[offset]! - reference.rgba[offset]!;
      g += current.rgba[offset + 1]! - reference.rgba[offset + 1]!;
      b += current.rgba[offset + 2]! - reference.rgba[offset + 2]!;
      samples += 1;
    }
  }
  return {
    r: samples === 0 ? 0 : r / samples,
    g: samples === 0 ? 0 : g / samples,
    b: samples === 0 ? 0 : b / samples,
  };
}

function estimateAdaptiveNoise(
  reference: CameraFrame,
  current: CameraFrame,
  offsets: Readonly<{ r: number; g: number; b: number }>,
): number {
  const values: number[] = [];
  const step = Math.max(6, Math.round(Math.min(reference.width, reference.height) / 70));
  for (let y = 1; y < reference.height - 1; y += step) {
    for (let x = 1; x < reference.width - 1; x += step) {
      const offset = (y * reference.width + x) * 4;
      values.push(
        (Math.abs(current.rgba[offset]! - reference.rgba[offset]! - offsets.r) +
          Math.abs(current.rgba[offset + 1]! - reference.rgba[offset + 1]! - offsets.g) +
          Math.abs(current.rgba[offset + 2]! - reference.rgba[offset + 2]! - offsets.b)) /
          3,
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
  minimumLength: number,
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
  if (lineLengthPixels < minimumLength || aspectRatio < 1.8) return null;

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
  const endpointMaps = endpoints.map((endpoint) => mapImagePointToBoard(endpoint, homography));
  if (endpointMaps.every((point) => point === null)) return null;
  const lengthScore = clamp((lineLengthPixels / minimumLength - 1) / 2.5, 0, 1);
  const aspectScore = clamp((aspectRatio - 1.8) / 4, 0, 1);
  const countScore = clamp(component.pixels.length / Math.max(60, minimumLength * 3), 0, 1);
  const confidence = clamp(
    0.18 + lengthScore * 0.38 + aspectScore * 0.3 + countScore * 0.14,
    0,
    0.9,
  );

  return {
    id: `shape-${index + 1}`,
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

function candidatesForShape(shape: DartShape, homography: Homography): DartTipCandidate[] {
  const mappedEndpoints = shape.endpoints.map((point) => mapImagePointToBoard(point, homography));
  const endpointOnBoard = mappedEndpoints.map(
    (point) => point !== null && Math.hypot(point.xMm, point.yMm) <= BOARD_RADII_MM.doubleOuter + 3,
  );
  const onlyEndpointOnBoard = endpointOnBoard.filter(Boolean).length === 1;

  return mappedEndpoints.flatMap((boardPoint, index) => {
    if (
      boardPoint === null ||
      Math.hypot(boardPoint.xMm, boardPoint.yMm) > BOARD_RADII_MM.doubleOuter + 12
    ) {
      return [];
    }
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
        zone: decodeBoardPoint(boardPoint),
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
        Number(right.directionEvidence === 'only-endpoint-on-board') -
        Number(left.directionEvidence === 'only-endpoint-on-board');
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
