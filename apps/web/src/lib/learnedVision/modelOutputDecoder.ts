import {
  BOARD_LANDMARK_KINDS,
  DARTS180_BOARD_TIP_V1_TENSORS,
  type BoardLandmarkKind,
  type BoardLandmarkObservation,
  type DartTipObservation,
  type ModelQualityObservation,
} from '@darts-180/contracts';

export const LEARNED_BOARD_LANDMARK_KINDS: readonly BoardLandmarkKind[] = BOARD_LANDMARK_KINDS;

/** Exact letterbox parameters used by the browser Worker before NCHW RGB conversion. */
export interface LetterboxTransform {
  sourceWidth: number;
  sourceHeight: number;
  inputWidth: number;
  inputHeight: number;
  /** Exact drawn-width/source-width ratio after integer letterbox rounding. */
  scaleX: number;
  /** Exact drawn-height/source-height ratio after integer letterbox rounding. */
  scaleY: number;
  offsetX: number;
  offsetY: number;
}

export interface DecodedModelOutputs {
  landmarks: readonly BoardLandmarkObservation[];
  dartTips: readonly DartTipObservation[];
  quality: ModelQualityObservation;
}

/**
 * Strict semantic decoder for `darts180-board-tip-v1` exported tensors. The model owns NMS and
 * learned predictions; this deterministic adapter only validates tensor shape and restores source
 * camera coordinates after letterboxing.
 *
 * - landmarks: exactly `[9, 3]` flattened as normalized `x, y, confidence`
 * - dart tips: `N × 6`, with normalized `x, y, confidence, sigmaX, sigmaY, occlusionRisk`
 * - quality: exactly `[overall, boardCoverage, sharpness, glareRisk, offAxisFraction, occlusionRisk]`
 */
export function decodeModelOutputs(
  output: Readonly<{ landmarks: Float32Array; dartTips: Float32Array; quality: Float32Array }>,
  transform: LetterboxTransform,
): DecodedModelOutputs {
  const landmarks = decodeLandmarks(output.landmarks, transform);
  return {
    landmarks,
    dartTips: decodeDartTips(output.dartTips, transform),
    quality: decodeQuality(output.quality, landmarks),
  };
}

function decodeLandmarks(
  values: Float32Array,
  transform: LetterboxTransform,
): readonly BoardLandmarkObservation[] {
  if (
    values.length !==
    DARTS180_BOARD_TIP_V1_TENSORS.landmarks.rowCount *
      DARTS180_BOARD_TIP_V1_TENSORS.landmarks.fields.length
  ) {
    throw new Error('The model landmark output does not match darts180-board-tip-v1.');
  }
  const landmarks: BoardLandmarkObservation[] = [];
  for (let index = 0; index < LEARNED_BOARD_LANDMARK_KINDS.length; index += 1) {
    const offset = index * DARTS180_BOARD_TIP_V1_TENSORS.landmarks.fields.length;
    const confidence = values[offset + 2] ?? NaN;
    if (!isProbability(confidence)) {
      throw new Error('The model landmark confidence is outside the browser contract.');
    }
    // A zero-confidence landmark represents no detection. It is not silently substituted with a
    // geometric guess; the complete-pose admission gate will refuse the frame.
    if (confidence === 0) continue;
    const position = toSourcePoint(values[offset] ?? NaN, values[offset + 1] ?? NaN, transform);
    if (position === null) {
      throw new Error('The model landmark point is outside the source camera frame.');
    }
    const kind = LEARNED_BOARD_LANDMARK_KINDS[index];
    if (kind === undefined) continue;
    landmarks.push({ kind, imagePoint: position, confidence });
  }
  return landmarks;
}

function decodeDartTips(
  values: Float32Array,
  transform: LetterboxTransform,
): readonly DartTipObservation[] {
  if (
    values.length % DARTS180_BOARD_TIP_V1_TENSORS.dartTips.fields.length !== 0 ||
    values.length === 0 ||
    values.length >
      DARTS180_BOARD_TIP_V1_TENSORS.dartTips.fields.length *
        DARTS180_BOARD_TIP_V1_TENSORS.dartTips.maxRows
  ) {
    throw new Error('The model dart-tip output does not match darts180-board-tip-v1.');
  }
  const tips: DartTipObservation[] = [];
  for (
    let offset = 0;
    offset < values.length;
    offset += DARTS180_BOARD_TIP_V1_TENSORS.dartTips.fields.length
  ) {
    const confidence = values[offset + 2] ?? NaN;
    if (!isProbability(confidence)) {
      throw new Error('The model dart-tip confidence is outside the browser contract.');
    }
    // The output contract pads absent detections with an exact zero confidence. Do not install an
    // additional browser-side confidence threshold: score eligibility belongs to the reviewed
    // artifact policy.
    if (confidence === 0) continue;
    const imagePoint = toSourcePoint(values[offset] ?? NaN, values[offset + 1] ?? NaN, transform);
    if (imagePoint === null) {
      throw new Error('The model dart-tip point is outside the source camera frame.');
    }
    const sigmaX = sourcePixels(values[offset + 3] ?? NaN, transform, 'x');
    const sigmaY = sourcePixels(values[offset + 4] ?? NaN, transform, 'y');
    const occlusionRisk = values[offset + 5] ?? NaN;
    if (
      !Number.isFinite(sigmaX) ||
      !Number.isFinite(sigmaY) ||
      sigmaX <= 0 ||
      sigmaY <= 0 ||
      !isProbability(occlusionRisk)
    ) {
      throw new Error(
        'The model dart-tip uncertainty or occlusion output is outside the browser contract.',
      );
    }
    tips.push({ imagePoint, sigmaXPx: sigmaX, sigmaYPx: sigmaY, confidence, occlusionRisk });
  }
  return tips;
}

function decodeQuality(
  values: Float32Array,
  landmarks: readonly BoardLandmarkObservation[],
): ModelQualityObservation {
  if (values.length !== DARTS180_BOARD_TIP_V1_TENSORS.quality.fields.length) {
    throw new Error('The model quality output does not match darts180-board-tip-v1.');
  }
  const overall = requiredProbability(values[0], 'overall');
  const boardCoverage = requiredProbability(values[1], 'boardCoverage');
  const sharpness = requiredProbability(values[2], 'sharpness');
  const glareRisk = requiredProbability(values[3], 'glareRisk');
  const offAxisDegrees = requiredProbability(values[4], 'offAxisFraction') * 90;
  const occlusionRisk = requiredProbability(values[5], 'occlusionRisk');
  return {
    overall,
    boardCoverage,
    sharpness,
    glareRisk,
    occlusionRisk,
    offAxisDegrees,
    boardDiameterPixels: estimatedBoardDiameterPixels(landmarks),
    // Player-facing guidance is derived from the artifact's calibrated decision policy, not from
    // hidden decoder thresholds.
    reasons: [],
  };
}

function toSourcePoint(
  normalizedX: number,
  normalizedY: number,
  transform: LetterboxTransform,
): Readonly<{ xPx: number; yPx: number }> | null {
  if (!isProbability(normalizedX) || !isProbability(normalizedY)) return null;
  const inputX = normalizedX * transform.inputWidth;
  const inputY = normalizedY * transform.inputHeight;
  const xPx = (inputX - transform.offsetX) / transform.scaleX;
  const yPx = (inputY - transform.offsetY) / transform.scaleY;
  if (xPx < 0 || yPx < 0 || xPx > transform.sourceWidth || yPx > transform.sourceHeight)
    return null;
  return { xPx, yPx };
}

function sourcePixels(
  normalizedDistance: number,
  transform: LetterboxTransform,
  axis: 'x' | 'y',
): number {
  if (!Number.isFinite(normalizedDistance) || normalizedDistance <= 0) return Number.NaN;
  const inputExtent = axis === 'x' ? transform.inputWidth : transform.inputHeight;
  const scale = axis === 'x' ? transform.scaleX : transform.scaleY;
  return (normalizedDistance * inputExtent) / scale;
}

function estimatedBoardDiameterPixels(landmarks: readonly BoardLandmarkObservation[]): number {
  const find = (kind: BoardLandmarkKind) =>
    landmarks.find((item) => item.kind === kind)?.imagePoint;
  const vertical = pairDistance(find('d20-double'), find('d3-double'));
  const horizontal = pairDistance(find('d6-double'), find('d11-double'));
  const measures = [vertical, horizontal].filter((value): value is number => value !== null);
  if (measures.length === 0) return 0;
  // Named anchors lie at r=166mm; their 332mm separation scales to a 340mm outer-double diameter.
  // Use the smaller independently observed axis: an average would overstate usable detail when an
  // oblique phone view visibly foreshortens one direction.
  return Math.min(...measures) * (340 / 332);
}

function pairDistance(
  left: Readonly<{ xPx: number; yPx: number }> | undefined,
  right: Readonly<{ xPx: number; yPx: number }> | undefined,
): number | null {
  if (left === undefined || right === undefined) return null;
  return Math.hypot(left.xPx - right.xPx, left.yPx - right.yPx);
}

function requiredProbability(value: number | undefined, name: string): number {
  const probability = value ?? Number.NaN;
  if (!isProbability(probability)) {
    throw new Error(`The model quality ${name} value must be a finite probability.`);
  }
  return probability;
}

function isProbability(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}
