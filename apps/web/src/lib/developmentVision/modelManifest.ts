import { isSameOriginAssetPath } from '../learnedVision/modelManifest';

import {
  DEEPDARTS_CLASS_IDS,
  type DeepDartsDevelopmentModelManifest,
  type DevelopmentDetectionPolicy,
  type DevelopmentTrainingDataKind,
} from './types';

/**
 * Optional package path. It is deliberately absent from source until an actual locally verified
 * development artifact is trained and installed beside this manifest.
 */
export const DEFAULT_DEVELOPMENT_MODEL_MANIFEST_PATH =
  '/models/darts180-deepdarts-yolo-dev-v1.json';

export interface DevelopmentManifestLoadResult {
  manifest: DeepDartsDevelopmentModelManifest | null;
  /** User-safe, non-sensitive installation failure. `null` means no optional dev package exists. */
  message: string | null;
}

/**
 * Load a development-only experimental model package. This is intentionally separate from the
 * signed/release-evidenced `darts180-board-tip-v1` production ABI.
 */
export async function loadDevelopmentModelManifest(
  path = DEFAULT_DEVELOPMENT_MODEL_MANIFEST_PATH,
  fetcher: typeof fetch = fetch,
): Promise<DevelopmentManifestLoadResult> {
  if (!isSameOriginAssetPath(path)) {
    return {
      manifest: null,
      message: 'The local experimental model manifest path is invalid.',
    };
  }

  try {
    const response = await fetcher(path, { cache: 'no-store', credentials: 'same-origin' });
    if (response.status === 404) return { manifest: null, message: null };
    if (!response.ok) {
      return {
        manifest: null,
        message: 'The local experimental model package could not be loaded.',
      };
    }
    return { manifest: parseDevelopmentModelManifest(await response.json()), message: null };
  } catch {
    return {
      manifest: null,
      message: 'The local experimental model package could not be verified.',
    };
  }
}

export function parseDevelopmentModelManifest(value: unknown): DeepDartsDevelopmentModelManifest {
  if (!isRecord(value)) throw new Error('Development model manifest must be an object.');
  if (value.schemaVersion !== 1) throw new Error('Unsupported development model manifest schema.');
  if (value.modelId !== 'darts180-deepdarts-yolo') {
    throw new Error('Unexpected development model identifier.');
  }
  if (value.releaseStage !== 'development') {
    throw new Error('Experimental YOLO artifacts must be development-stage only.');
  }
  if (value.runtime !== 'onnxruntime-web') {
    throw new Error('This browser runtime only accepts onnxruntime-web.');
  }

  const manifest: DeepDartsDevelopmentModelManifest = {
    schemaVersion: 1,
    modelId: 'darts180-deepdarts-yolo',
    modelVersion: requiredString(value.modelVersion, 'modelVersion'),
    releaseStage: 'development',
    assetPath: requiredAssetPath(value.assetPath, 'assetPath'),
    sha256: requiredSha256(value.sha256, 'sha256'),
    runtime: 'onnxruntime-web',
    input: readInput(value.input),
    output: readOutput(value.output),
    classMap: readClassMap(value.classMap),
    policy: readPolicy(value.policy),
    provenance: readProvenance(value.provenance),
  };

  validateDevelopmentManifest(manifest);
  return manifest;
}

export function isRunnableDevelopmentModelManifest(
  manifest: DeepDartsDevelopmentModelManifest,
): boolean {
  return isSameOriginAssetPath(manifest.assetPath) && /^[a-f0-9]{64}$/.test(manifest.sha256);
}

function validateDevelopmentManifest(manifest: DeepDartsDevelopmentModelManifest): void {
  if (!isRunnableDevelopmentModelManifest(manifest)) {
    throw new Error(
      'Development model artifacts require a same-origin asset path and lowercase SHA-256 hash.',
    );
  }
  if (!manifest.assetPath.endsWith('.onnx')) {
    throw new Error('Development model asset must be an ONNX file.');
  }
  if (manifest.policy.minDartConfidence < manifest.policy.minDetectionConfidence) {
    throw new Error('minDartConfidence cannot be below minDetectionConfidence.');
  }
  if (manifest.policy.minCalibrationConfidence < manifest.policy.minDetectionConfidence) {
    throw new Error('minCalibrationConfidence cannot be below minDetectionConfidence.');
  }
  if (manifest.policy.tipTrackStaleAfterMs <= manifest.policy.tipTrackSettleMs) {
    throw new Error('tipTrackStaleAfterMs must exceed tipTrackSettleMs.');
  }
}

function readInput(value: unknown): DeepDartsDevelopmentModelManifest['input'] {
  if (!isRecord(value)) throw new Error('Development model input descriptor is required.');
  const width = requiredInteger(value.width, 'input.width');
  const height = requiredInteger(value.height, 'input.height');
  if (width < 256 || width > 2048 || height < 256 || height > 2048) {
    throw new Error('Development model input dimensions must be between 256 and 2048 pixels.');
  }
  if (
    value.colorOrder !== 'rgb' ||
    value.normalization !== 'zero-to-one' ||
    value.resizeMode !== 'stretch'
  ) {
    throw new Error('Unsupported development model preprocessing descriptor.');
  }
  return {
    width,
    height,
    colorOrder: 'rgb',
    normalization: 'zero-to-one',
    resizeMode: 'stretch',
  };
}

function readOutput(value: unknown): DeepDartsDevelopmentModelManifest['output'] {
  if (!isRecord(value)) throw new Error('Development model output descriptor is required.');
  if (value.layout !== 'yolov8-raw-cxcywh-class-scores') {
    throw new Error('Unsupported development YOLO output layout.');
  }
  if (value.classCount !== 5)
    throw new Error('Development YOLO contract requires exactly five classes.');
  return {
    detections: requiredOutputName(value.detections, 'output.detections'),
    layout: 'yolov8-raw-cxcywh-class-scores',
    classCount: 5,
  };
}

function readClassMap(value: unknown): DeepDartsDevelopmentModelManifest['classMap'] {
  if (!isRecord(value)) throw new Error('Development model class map is required.');
  const classMap = {
    dartEntryPoint: value.dartEntryPoint,
    calibration1: value.calibration1,
    calibration2: value.calibration2,
    calibration3: value.calibration3,
    calibration4: value.calibration4,
  };
  for (const [name, expected] of Object.entries(DEEPDARTS_CLASS_IDS)) {
    if (classMap[name as keyof typeof classMap] !== expected) {
      throw new Error(`Development class map must preserve ${name} class ID ${expected}.`);
    }
  }
  return DEEPDARTS_CLASS_IDS;
}

function readPolicy(value: unknown): DevelopmentDetectionPolicy {
  if (!isRecord(value)) throw new Error('Development detection policy is required.');
  const policy: DevelopmentDetectionPolicy = {
    minDetectionConfidence: probability(
      value.minDetectionConfidence,
      'policy.minDetectionConfidence',
    ),
    minDartConfidence: probability(value.minDartConfidence, 'policy.minDartConfidence'),
    minCalibrationConfidence: probability(
      value.minCalibrationConfidence,
      'policy.minCalibrationConfidence',
    ),
    nmsIouThreshold: probability(value.nmsIouThreshold, 'policy.nmsIouThreshold'),
    maxDetections: boundedInteger(value.maxDetections, 'policy.maxDetections', 1, 128),
    tipTrackMatchDistanceMm: boundedNumber(
      value.tipTrackMatchDistanceMm,
      'policy.tipTrackMatchDistanceMm',
      1,
      100,
    ),
    tipTrackSettleMs: boundedInteger(value.tipTrackSettleMs, 'policy.tipTrackSettleMs', 50, 10_000),
    tipTrackStaleAfterMs: boundedInteger(
      value.tipTrackStaleAfterMs,
      'policy.tipTrackStaleAfterMs',
      100,
      30_000,
    ),
    maxTipTrackSpreadMm: boundedNumber(
      value.maxTipTrackSpreadMm,
      'policy.maxTipTrackSpreadMm',
      0.1,
      100,
    ),
  };
  return policy;
}

function readProvenance(value: unknown): DeepDartsDevelopmentModelManifest['provenance'] {
  if (!isRecord(value)) throw new Error('Development model provenance is required.');
  return {
    trainingDataId: requiredString(value.trainingDataId, 'provenance.trainingDataId'),
    trainingDataKind: readTrainingDataKind(value.trainingDataKind),
    licenseReviewId: requiredString(value.licenseReviewId, 'provenance.licenseReviewId'),
    trainedAt: nullableIsoTimestamp(value.trainedAt, 'provenance.trainedAt'),
  };
}

function readTrainingDataKind(value: unknown): DevelopmentTrainingDataKind {
  if (
    value !== 'synthetic-only' &&
    value !== 'real-reviewed' &&
    value !== 'mixed-synthetic-and-real'
  ) {
    throw new Error(
      'provenance.trainingDataKind must state synthetic-only, real-reviewed, or mixed-synthetic-and-real.',
    );
  }
  return value;
}

function requiredAssetPath(value: unknown, name: string): string {
  const path = requiredString(value, name);
  if (!isSameOriginAssetPath(path)) throw new Error(`${name} must be a same-origin asset path.`);
  return path;
}

function requiredSha256(value: unknown, name: string): string {
  const hash = requiredString(value, name);
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error(`${name} must be a lowercase SHA-256 hash.`);
  return hash;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`${name} must be a non-empty string.`);
  return value;
}

function requiredInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value))
    throw new Error(`${name} must be a whole number.`);
  return value;
}

function boundedInteger(value: unknown, name: string, minimum: number, maximum: number): number {
  const number = requiredInteger(value, name);
  if (number < minimum || number > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return number;
}

function boundedNumber(value: unknown, name: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function probability(value: unknown, name: string): number {
  return boundedNumber(value, name, 0, 1);
}

function requiredOutputName(value: unknown, name: string): string {
  const output = requiredString(value, name);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(output)) {
    throw new Error(`${name} is not a safe tensor name.`);
  }
  return output;
}

function nullableIsoTimestamp(value: unknown, name: string): string | null {
  if (value === null) return null;
  const timestamp = requiredString(value, name);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) ||
    Number.isNaN(Date.parse(timestamp))
  ) {
    throw new Error(`${name} must be an ISO-8601 timestamp with timezone.`);
  }
  return timestamp;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
