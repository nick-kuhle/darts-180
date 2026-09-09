import type {
  DeepDartsClassId,
  DeepDartsDetection,
  DeepDartsStretchTransform,
  DevelopmentDetectionPolicy,
} from './types';

export interface FloatTensorLike {
  data: Float32Array;
  dims: readonly number[];
}

interface InputCandidate {
  classId: DeepDartsClassId;
  confidence: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

interface TensorLayout {
  candidateCount: number;
  valueAt: (candidateIndex: number, featureIndex: number) => number;
}

/**
 * Decode the raw (non-NMS) YOLOv8 export used by the development package. Ultralytics commonly
 * emits [1, 4 + classCount, candidateCount], while some exporters transpose it to
 * [1, candidateCount, 4 + classCount]. Supporting both keeps the manifest explicit without
 * accepting a different class vocabulary or an objectness-based YOLO layout.
 */
export function decodeDeepDartsYoloOutput(
  tensor: FloatTensorLike,
  transform: DeepDartsStretchTransform,
  policy: Pick<
    DevelopmentDetectionPolicy,
    'minDetectionConfidence' | 'nmsIouThreshold' | 'maxDetections'
  >,
): readonly DeepDartsDetection[] {
  validateTransform(transform);
  const featureCount = 9; // cx, cy, width, height + five immutable class scores.
  const layout = readTensorLayout(tensor, featureCount);
  const candidates: InputCandidate[] = [];

  for (let index = 0; index < layout.candidateCount; index += 1) {
    const centerX = layout.valueAt(index, 0);
    const centerY = layout.valueAt(index, 1);
    const width = layout.valueAt(index, 2);
    const height = layout.valueAt(index, 3);
    if (!isPlausibleBox(centerX, centerY, width, height, transform)) continue;

    let classId: DeepDartsClassId = 0;
    let confidence = -Infinity;
    for (let candidateClassId = 0; candidateClassId < 5; candidateClassId += 1) {
      const score = layout.valueAt(index, 4 + candidateClassId);
      if (!Number.isFinite(score) || score < 0 || score > 1) continue;
      if (score > confidence) {
        confidence = score;
        classId = candidateClassId as DeepDartsClassId;
      }
    }
    if (!Number.isFinite(confidence) || confidence < policy.minDetectionConfidence) continue;

    candidates.push({ classId, confidence, centerX, centerY, width, height });
  }

  const selected = classAwareNms(candidates, policy.nmsIouThreshold, policy.maxDetections);
  return selected.map((candidate) => ({
    classId: candidate.classId,
    confidence: candidate.confidence,
    center: {
      xPx: candidate.centerX / transform.scaleX,
      yPx: candidate.centerY / transform.scaleY,
    },
    widthPx: candidate.width / transform.scaleX,
    heightPx: candidate.height / transform.scaleY,
  }));
}

function readTensorLayout(tensor: FloatTensorLike, featureCount: number): TensorLayout {
  if (!(tensor.data instanceof Float32Array)) {
    throw new Error('Development YOLO output must be a Float32 tensor.');
  }
  if (!tensor.dims.every((dimension) => Number.isInteger(dimension) && dimension > 0)) {
    throw new Error('Development YOLO output has invalid tensor dimensions.');
  }
  const expectedLength = tensor.dims.reduce((product, dimension) => product * dimension, 1);
  if (expectedLength !== tensor.data.length) {
    throw new Error('Development YOLO output tensor length does not match its dimensions.');
  }

  const dimensions =
    tensor.dims.length === 3 && tensor.dims[0] === 1 ? tensor.dims.slice(1) : tensor.dims;
  if (dimensions.length !== 2) {
    throw new Error('Development YOLO output must have a batch plus two data dimensions.');
  }

  const first = dimensions[0];
  const second = dimensions[1];
  if (first === undefined || second === undefined) {
    throw new Error('Development YOLO output is missing a data dimension.');
  }
  if (first === featureCount) {
    return {
      candidateCount: second,
      valueAt: (candidateIndex, featureIndex) =>
        tensor.data[featureIndex * second + candidateIndex] ?? NaN,
    };
  }
  if (second === featureCount) {
    return {
      candidateCount: first,
      valueAt: (candidateIndex, featureIndex) =>
        tensor.data[candidateIndex * second + featureIndex] ?? NaN,
    };
  }
  throw new Error(`Development YOLO output must have ${featureCount} features per candidate.`);
}

function isPlausibleBox(
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  transform: DeepDartsStretchTransform,
): boolean {
  if (![centerX, centerY, width, height].every(Number.isFinite)) return false;
  if (width <= 0 || height <= 0) return false;
  // Raw tensor corruption or the wrong model should fail closed rather than create an invented tip.
  if (width > transform.inputWidth * 2 || height > transform.inputHeight * 2) return false;
  return (
    centerX >= 0 &&
    centerY >= 0 &&
    centerX <= transform.inputWidth &&
    centerY <= transform.inputHeight
  );
}

function classAwareNms(
  candidates: readonly InputCandidate[],
  iouThreshold: number,
  maxDetections: number,
): readonly InputCandidate[] {
  const ordered = [...candidates].sort(
    (left, right) =>
      right.confidence - left.confidence ||
      left.classId - right.classId ||
      left.centerX - right.centerX ||
      left.centerY - right.centerY,
  );
  const accepted: InputCandidate[] = [];

  for (const candidate of ordered) {
    const overlapsAcceptedClass = accepted.some(
      (existing) =>
        existing.classId === candidate.classId &&
        intersectionOverUnion(existing, candidate) > iouThreshold,
    );
    if (overlapsAcceptedClass) continue;
    accepted.push(candidate);
    if (accepted.length >= maxDetections) break;
  }

  return accepted;
}

function intersectionOverUnion(left: InputCandidate, right: InputCandidate): number {
  const leftMinX = left.centerX - left.width / 2;
  const leftMaxX = left.centerX + left.width / 2;
  const leftMinY = left.centerY - left.height / 2;
  const leftMaxY = left.centerY + left.height / 2;
  const rightMinX = right.centerX - right.width / 2;
  const rightMaxX = right.centerX + right.width / 2;
  const rightMinY = right.centerY - right.height / 2;
  const rightMaxY = right.centerY + right.height / 2;

  const overlapWidth = Math.max(0, Math.min(leftMaxX, rightMaxX) - Math.max(leftMinX, rightMinX));
  const overlapHeight = Math.max(0, Math.min(leftMaxY, rightMaxY) - Math.max(leftMinY, rightMinY));
  const intersection = overlapWidth * overlapHeight;
  const union = left.width * left.height + right.width * right.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function validateTransform(transform: DeepDartsStretchTransform): void {
  const values = [
    transform.sourceWidth,
    transform.sourceHeight,
    transform.inputWidth,
    transform.inputHeight,
    transform.scaleX,
    transform.scaleY,
  ];
  if (!values.every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('Development YOLO preprocessing transform is invalid.');
  }
}
