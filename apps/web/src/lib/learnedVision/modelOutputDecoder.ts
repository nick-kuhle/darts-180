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
  scale: number;
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
    const position = toSourcePoint(values[offset] ?? NaN, values[offset + 1] ?? NaN, transform);
    const confidence = values[offset + 2] ?? NaN;
    if (position === null || !isProbability(confidence)) continue;
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
    // This low floor only removes explicit all-zero padding rows; proposal thresholds remain in the
    // reviewed artifact policy, never in an untracked browser heuristic.
    if (!isProbability(confidence) || confidence <= 0.001) continue;
    const imagePoint = toSourcePoint(values[offset] ?? NaN, values[offset + 1] ?? NaN, transform);
    if (imagePoint === null) continue;
    const sigmaX = sourcePixels(values[offset + 3] ?? NaN, transform);
    const sigmaY = sourcePixels(values[offset + 4] ?? NaN, transform);
    const occlusionRisk = values[offset + 5] ?? NaN;
    if (
      !Number.isFinite(sigmaX) ||
      !Number.isFinite(sigmaY) ||
      sigmaX <= 0 ||
      sigmaY <= 0 ||
      !isProbability(occlusionRisk)
    ) {
      continue;
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
  const overall = clampProbability(values[0] ?? NaN);
  const boardCoverage = clampProbability(values[1] ?? NaN);
  const sharpness = clampProbability(values[2] ?? NaN);
  const glareRisk = clampProbability(values[3] ?? NaN);
  const offAxisDegrees = clampProbability(values[4] ?? NaN) * 90;
  const occlusionRisk = clampProbability(values[5] ?? NaN);
  const boardDiameterPixels = estimatedBoardDiameterPixels(landmarks);
  const reasons: string[] = [];
  if (boardCoverage < 0.7)
    reasons.push('Keep the full board and number ring inside the camera frame.');
  if (sharpness < 0.6)
    reasons.push('Wait for the rear camera to focus, then keep the mount still.');
  if (glareRisk > 0.45) reasons.push('Reduce direct glare on the board face.');
  if (offAxisDegrees > 55) {
    reasons.push('Move to a clearer angle so the board face and dart entry remain visible.');
  }
  return {
    overall,
    boardCoverage,
    sharpness,
    glareRisk,
    occlusionRisk,
    offAxisDegrees,
    boardDiameterPixels,
    reasons,
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
  const xPx = (inputX - transform.offsetX) / transform.scale;
  const yPx = (inputY - transform.offsetY) / transform.scale;
  if (xPx < 0 || yPx < 0 || xPx > transform.sourceWidth || yPx > transform.sourceHeight)
    return null;
  return { xPx, yPx };
}

function sourcePixels(normalizedDistance: number, transform: LetterboxTransform): number {
  if (!Number.isFinite(normalizedDistance) || normalizedDistance <= 0) return Number.NaN;
  return (
    (normalizedDistance * Math.max(transform.inputWidth, transform.inputHeight)) / transform.scale
  );
}

function estimatedBoardDiameterPixels(landmarks: readonly BoardLandmarkObservation[]): number {
  const find = (kind: BoardLandmarkKind) =>
    landmarks.find((item) => item.kind === kind)?.imagePoint;
  const vertical = pairDistance(find('d20-double'), find('d3-double'));
  const horizontal = pairDistance(find('d6-double'), find('d11-double'));
  const measures = [vertical, horizontal].filter((value): value is number => value !== null);
  if (measures.length === 0) return 0;
  // Named anchors lie at r=166mm; their 332mm separation scales to a 340mm outer double diameter.
  return (measures.reduce((sum, value) => sum + value, 0) / measures.length) * (340 / 332);
}

function pairDistance(
  left: Readonly<{ xPx: number; yPx: number }> | undefined,
  right: Readonly<{ xPx: number; yPx: number }> | undefined,
): number | null {
  if (left === undefined || right === undefined) return null;
  return Math.hypot(left.xPx - right.xPx, left.yPx - right.yPx);
}

function clampProbability(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function isProbability(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}
