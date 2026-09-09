import type { ModelReleaseStage, VisionModelArtifactManifest } from '@darts-180/contracts';

import { parseVisionModelDecisionPolicy } from './modelDecisionPolicy';

export const DEFAULT_MODEL_MANIFEST_PATH = '/models/darts180-board-tip-v1.json';

/** The checked-in state until a reviewed ONNX artifact is delivered with an evaluation report. */
export const UNAVAILABLE_MODEL_MANIFEST: VisionModelArtifactManifest = {
  schemaVersion: 2,
  modelId: 'darts180-board-tip',
  modelVersion: 'unavailable',
  releaseStage: 'unavailable',
  assetPath: '',
  sha256: '',
  runtime: 'onnxruntime-web',
  input: {
    width: 1024,
    height: 1024,
    colorOrder: 'rgb',
    normalization: 'zero-to-one',
  },
  outputContract: 'darts180-board-tip-v1',
  outputs: {
    landmarks: 'board_landmarks',
    dartTips: 'dart_tips',
    quality: 'quality',
  },
  decisionPolicy: {
    autoRecordEnabled: false,
    minAutoScoreProbability: 1,
    minAutoScoreWireMarginMm: 99,
    minReviewProbability: 1,
    minZonePosteriorMargin: 1,
    minLandmarkConfidence: 1,
    maxPoseValidationResidualMm: 0,
    maxQualityOffAxisDegrees: 0,
    minBoardDiameterPixels: Number.MAX_SAFE_INTEGER,
    minOverallQuality: 1,
    minBoardCoverage: 1,
    minSharpness: 1,
    maxGlareRisk: 0,
    maxOcclusionRisk: 0,
    tipTrackMatchDistanceMm: 0.1,
    tipTrackSettleMs: 1,
    tipTrackStaleAfterMs: 2,
    maxTipTrackSpreadMm: 0,
    confidenceTemperature: 1,
    confidenceBias: 0,
    heldOutEvaluationId: null,
  },
  provenance: {
    trainingDataId: null,
    licenseReviewId: null,
    evaluatedAt: null,
  },
  releaseEvidence: {
    attestationPath: null,
    attestationSha256: null,
    approvalId: null,
  },
};

export interface ManifestLoadResult {
  manifest: VisionModelArtifactManifest;
  /** User-safe status message; intentionally never contains a raw fetch or model exception. */
  message: string | null;
}

/**
 * Load only a same-origin, static model manifest. Model bytes are separately integrity checked in
 * the Worker. A missing or malformed manifest is an unavailable scorer, not an invitation to use
 * the legacy detector.
 */
export async function loadModelManifest(
  path = DEFAULT_MODEL_MANIFEST_PATH,
  fetcher: typeof fetch = fetch,
): Promise<ManifestLoadResult> {
  if (!isSameOriginAssetPath(path)) {
    return {
      manifest: UNAVAILABLE_MODEL_MANIFEST,
      message: 'The local model manifest path is invalid. Camera scoring stays unavailable.',
    };
  }

  try {
    const response = await fetcher(path, { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) {
      return {
        manifest: UNAVAILABLE_MODEL_MANIFEST,
        message:
          'The local learned model package is not installed yet. No camera score will be guessed.',
      };
    }
    const parsed: unknown = await response.json();
    const manifest = parseModelManifest(parsed);
    if (manifest.releaseStage === 'unavailable') {
      return {
        manifest,
        message:
          'The local learned model package is not installed yet. No camera score will be guessed.',
      };
    }
    return { manifest, message: null };
  } catch {
    return {
      manifest: UNAVAILABLE_MODEL_MANIFEST,
      message:
        'The local learned model package could not be verified. No camera score will be guessed.',
    };
  }
}

export function parseModelManifest(value: unknown): VisionModelArtifactManifest {
  if (!isRecord(value)) throw new Error('Model manifest must be an object.');
  if (value.schemaVersion !== 2) throw new Error('Unsupported model manifest schema.');

  const releaseStage = readReleaseStage(value.releaseStage);
  const manifest: VisionModelArtifactManifest = {
    schemaVersion: 2,
    modelId: requiredString(value.modelId, 'modelId'),
    modelVersion: requiredString(value.modelVersion, 'modelVersion'),
    releaseStage,
    assetPath: requiredString(value.assetPath, 'assetPath', releaseStage === 'unavailable'),
    sha256: requiredString(value.sha256, 'sha256', releaseStage === 'unavailable'),
    runtime: readRuntime(value.runtime),
    input: readInput(value.input),
    outputContract: readOutputContract(value.outputContract),
    outputs: readOutputs(value.outputs),
    decisionPolicy: parseVisionModelDecisionPolicy(value.decisionPolicy),
    provenance: readProvenance(value.provenance),
    releaseEvidence: readReleaseEvidence(value.releaseEvidence),
  };

  validateManifest(manifest);
  return manifest;
}

export function isRunnableModelManifest(manifest: VisionModelArtifactManifest): boolean {
  return (
    manifest.releaseStage !== 'unavailable' &&
    isSameOriginAssetPath(manifest.assetPath) &&
    /^[a-f0-9]{64}$/.test(manifest.sha256)
  );
}

export function isSameOriginAssetPath(path: string): boolean {
  // Only a root-relative path is accepted. Protocol-relative and traversal paths are rejected
  // so Vercel's `connect-src 'self'` posture is part of the model trust boundary.
  return /^\/(?:[a-zA-Z0-9._-]+\/)*[a-zA-Z0-9._-]+$/.test(path) && !path.includes('..');
}

function validateManifest(manifest: VisionModelArtifactManifest): void {
  const policy = manifest.decisionPolicy;
  if (new Set(Object.values(manifest.outputs)).size !== 3) {
    throw new Error(
      'Model landmark, dart-tip, and quality outputs must have distinct tensor names.',
    );
  }

  const evidence = manifest.releaseEvidence;
  const hasAttestation = evidence.attestationPath !== null || evidence.attestationSha256 !== null;
  if ((evidence.attestationPath === null) !== (evidence.attestationSha256 === null)) {
    throw new Error('Release attestation path and SHA-256 must be supplied together.');
  }
  if (
    evidence.attestationPath !== null &&
    (!isSameOriginAssetPath(evidence.attestationPath) ||
      !/^[a-f0-9]{64}$/.test(evidence.attestationSha256 ?? ''))
  ) {
    throw new Error('Release attestation must use a same-origin path and lowercase SHA-256 hash.');
  }
  if (hasAttestation !== (evidence.approvalId !== null)) {
    throw new Error('Release attestation and approval ID must be supplied together.');
  }
  if (manifest.releaseStage !== 'production' && hasAttestation) {
    throw new Error('Only production model manifests may name a release attestation.');
  }

  if (manifest.releaseStage === 'unavailable') {
    if (
      manifest.assetPath !== '' ||
      manifest.sha256 !== '' ||
      policy.autoRecordEnabled ||
      hasAttestation ||
      evidence.approvalId !== null
    ) {
      throw new Error(
        'Unavailable model manifests cannot name an artifact, attestation, or auto-record policy.',
      );
    }
    return;
  }

  if (!isRunnableModelManifest(manifest)) {
    throw new Error(
      'Runnable model manifest must use a same-origin asset and lowercase SHA-256 hash.',
    );
  }
  if (manifest.releaseStage === 'production') {
    if (
      evidence.attestationPath === null ||
      evidence.attestationSha256 === null ||
      evidence.approvalId === null
    ) {
      throw new Error(
        'Production model manifests require a hash-bound release attestation and approval ID.',
      );
    }
    if (
      policy.heldOutEvaluationId === null ||
      manifest.provenance.trainingDataId === null ||
      manifest.provenance.licenseReviewId === null ||
      manifest.provenance.evaluatedAt === null
    ) {
      throw new Error(
        'Production model manifests require held-out evaluation and complete provenance.',
      );
    }
  }
  if (policy.autoRecordEnabled && manifest.releaseStage !== 'production') {
    throw new Error('Only a production model manifest can enable auto-recording.');
  }
}

function readReleaseStage(value: unknown): ModelReleaseStage {
  if (
    value === 'unavailable' ||
    value === 'development' ||
    value === 'evaluation' ||
    value === 'production'
  ) {
    return value;
  }
  throw new Error('Invalid model release stage.');
}

function readRuntime(value: unknown): 'onnxruntime-web' {
  if (value !== 'onnxruntime-web')
    throw new Error('This browser runtime only accepts onnxruntime-web.');
  return value;
}

function readOutputContract(value: unknown): 'darts180-board-tip-v1' {
  if (value !== 'darts180-board-tip-v1') throw new Error('Unsupported learned-output contract.');
  return value;
}

function readInput(value: unknown): VisionModelArtifactManifest['input'] {
  if (!isRecord(value)) throw new Error('Model input descriptor is required.');
  const width = requiredNumber(value.width, 'input.width');
  const height = requiredNumber(value.height, 'input.height');
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 256 ||
    height < 256 ||
    width > 2048 ||
    height > 2048 ||
    width !== height
  ) {
    throw new Error('Model input dimensions must be equal whole pixels between 256 and 2048.');
  }
  if (value.colorOrder !== 'rgb' || value.normalization !== 'zero-to-one') {
    throw new Error('Unsupported browser image preprocessing descriptor.');
  }
  return { width, height, colorOrder: 'rgb', normalization: 'zero-to-one' };
}

function readOutputs(value: unknown): VisionModelArtifactManifest['outputs'] {
  if (!isRecord(value)) throw new Error('Model output descriptor is required.');
  return {
    landmarks: requiredOutputName(value.landmarks, 'outputs.landmarks'),
    dartTips: requiredOutputName(value.dartTips, 'outputs.dartTips'),
    quality: requiredOutputName(value.quality, 'outputs.quality'),
  };
}

function readProvenance(value: unknown): VisionModelArtifactManifest['provenance'] {
  if (!isRecord(value)) throw new Error('Model provenance is required.');
  return {
    trainingDataId: nullableString(value.trainingDataId, 'provenance.trainingDataId'),
    licenseReviewId: nullableString(value.licenseReviewId, 'provenance.licenseReviewId'),
    evaluatedAt: nullableIsoTimestamp(value.evaluatedAt, 'provenance.evaluatedAt'),
  };
}

function readReleaseEvidence(value: unknown): VisionModelArtifactManifest['releaseEvidence'] {
  if (!isRecord(value)) throw new Error('Model release evidence is required.');
  return {
    attestationPath: nullableString(value.attestationPath, 'releaseEvidence.attestationPath'),
    attestationSha256: nullableString(value.attestationSha256, 'releaseEvidence.attestationSha256'),
    approvalId: nullableString(value.approvalId, 'releaseEvidence.approvalId'),
  };
}

function requiredString(value: unknown, name: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

function nullableString(value: unknown, name: string): string | null {
  if (value === null) return null;
  return requiredString(value, name);
}

function nullableIsoTimestamp(value: unknown, name: string): string | null {
  const timestamp = nullableString(value, name);
  if (timestamp === null) return null;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) ||
    Number.isNaN(Date.parse(timestamp))
  ) {
    throw new Error(`${name} must be an ISO-8601 timestamp with timezone.`);
  }
  return timestamp;
}

function requiredNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be finite.`);
  }
  return value;
}

function requiredOutputName(value: unknown, name: string): string {
  const output = requiredString(value, name);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(output)) {
    throw new Error(`${name} is not a safe tensor name.`);
  }
  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
