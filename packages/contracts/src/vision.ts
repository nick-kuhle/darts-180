import type {
  BoardCalibration,
  BoardPointMm,
  RankedZoneCandidate,
  VisionEvidence,
} from './index.js';

/**
 * Cross-runtime output contract for the learned perception stack.
 *
 * The browser is the first production target. Native adapters must preserve this semantic boundary
 * rather than introducing a second score-decoding path. Pixel coordinates are always expressed in
 * the original, orientation-normalized camera frame; physical coordinates are millimetres from the
 * bull, with x right and y down.
 */
export const BOARD_LANDMARK_KINDS = [
  'bull',
  'd20-double',
  'd6-double',
  'd3-double',
  'd11-double',
  'outer-top',
  'outer-right',
  'outer-bottom',
  'outer-left',
] as const;

export type BoardLandmarkKind = (typeof BOARD_LANDMARK_KINDS)[number];

export const DETECTION_DISPOSITIONS = ['auto-score', 'review', 'abstain'] as const;
export type DetectionDisposition = (typeof DETECTION_DISPOSITIONS)[number];

export const MODEL_RELEASE_STAGES = [
  'unavailable',
  'development',
  'evaluation',
  'production',
] as const;
export type ModelReleaseStage = (typeof MODEL_RELEASE_STAGES)[number];

/**
 * Fixed semantic tensor contract for the first browser/native-portable model export. Tensor shapes
 * may include a leading batch dimension; rows are flattened in this listed field order. The model,
 * not the runtime, performs detector NMS. A changed shape or semantic requires a new contract id.
 */
export const DARTS180_BOARD_TIP_V1_TENSORS = {
  input: {
    layout: 'nchw-rgb-zero-to-one',
    dimensions: '[1, 3, height, width]',
  },
  landmarks: {
    rowCount: 9,
    fields: ['normalizedX', 'normalizedY', 'confidence'],
  },
  dartTips: {
    maxRows: 16,
    fields: [
      'normalizedX',
      'normalizedY',
      'confidence',
      'normalizedSigmaX',
      'normalizedSigmaY',
      'occlusionRisk',
    ],
  },
  quality: {
    fields: [
      'overall',
      'boardCoverage',
      'sharpness',
      'glareRisk',
      'offAxisFraction',
      'occlusionRisk',
    ],
  },
} as const;

/** Original camera-frame position, after the runtime has applied EXIF/device orientation. */
export interface ImagePointPx {
  xPx: number;
  yPx: number;
}

/** A learned landmark with a calibrated-or-raw confidence explicitly identified by the model card. */
export interface BoardLandmarkObservation {
  kind: BoardLandmarkKind;
  imagePoint: ImagePointPx;
  confidence: number;
}

/**
 * Learned output for one possible physical dart entry point. The actual score is deliberately not
 * part of model output: it is computed deterministically from the board-plane point and rules.
 */
export interface DartTipObservation {
  imagePoint: ImagePointPx;
  /** Standard-deviation estimate in source-frame pixels, before projective mapping. */
  sigmaXPx: number;
  sigmaYPx: number;
  /** Probability-like tip-presence value; calibration is declared by the model artifact. */
  confidence: number;
  /** A learned prediction that the entry point is materially hidden or stacked. */
  occlusionRisk: number;
}

export interface ModelQualityObservation {
  /** Overall image/pose observability, not a dart-score probability. */
  overall: number;
  boardCoverage: number;
  sharpness: number;
  glareRisk: number;
  occlusionRisk: number;
  /** Absolute angle estimated by the learned pose/quality model. */
  offAxisDegrees: number;
  boardDiameterPixels: number;
  reasons: readonly string[];
}

/**
 * Public, hash-bound release attestation for a runnable production artifact. It contains only
 * review identifiers and a safe summary pointer; the governed raw data, private evaluator notes,
 * and participant media remain outside the web bundle.
 */
export interface ModelReleaseEvidence {
  /** Same-origin public attestation JSON. Null for unavailable/development/evaluation artifacts. */
  attestationPath: string | null;
  /** Lowercase SHA-256 of the exact public attestation bytes. */
  attestationSha256: string | null;
  /** Immutable approval record ID from the controlled release system. */
  approvalId: string | null;
}

/**
 * Values fitted on a locked held-out set. This entire object is duplicated in a production public
 * attestation so model bytes cannot be paired with less conservative browser decision thresholds.
 */
export interface VisionModelDecisionPolicy {
  autoRecordEnabled: boolean;
  minAutoScoreProbability: number;
  minAutoScoreWireMarginMm: number;
  minReviewProbability: number;
  /** Required best-vs-runner-up geometric posterior separation. */
  minZonePosteriorMargin: number;
  /** Minimum calibrated landmark confidence for each complete-board pose anchor. */
  minLandmarkConfidence: number;
  /** Largest allowed redundant landmark residual after the oriented homography is solved. */
  maxPoseValidationResidualMm: number;
  maxQualityOffAxisDegrees: number;
  minBoardDiameterPixels: number;
  minOverallQuality: number;
  minBoardCoverage: number;
  minSharpness: number;
  maxGlareRisk: number;
  maxOcclusionRisk: number;
  /** Canonical-board association/settle policy for learned tips across a post-impact burst. */
  tipTrackMatchDistanceMm: number;
  tipTrackSettleMs: number;
  tipTrackStaleAfterMs: number;
  maxTipTrackSpreadMm: number;
  /** Temperature/logit calibration applied to the combined model/geometry confidence. */
  confidenceTemperature: number;
  confidenceBias: number;
  heldOutEvaluationId: string | null;
}

/**
 * Safe aggregate record published beside a production artifact. It deliberately excludes raw media,
 * participant identifiers, precise sites, and private review notes while binding the public release
 * to its data/license/evaluation IDs and decision evidence.
 */
export interface PublicModelReleaseAttestation {
  schemaVersion: 1;
  modelId: string;
  modelVersion: string;
  modelSha256: string;
  outputContract: 'darts180-board-tip-v1';
  trainingDataId: string;
  licenseReviewId: string;
  heldOutEvaluationId: string;
  evaluatedAt: string;
  approvalId: string;
  /** Exact decision policy approved for these model bytes and held-out evidence. */
  decisionPolicy: VisionModelDecisionPolicy;
  evaluation: {
    evaluatedDartCount: number;
    exactScoreRate: number;
    unsafeAutoRecordRate: number;
    reviewOrAbstainRate: number;
  };
}

/**
 * Versioned static-model metadata. A release cannot enable auto-recording just by changing a UI
 * threshold: its held-out evaluation decision, quality/ambiguity policy, checksum, and reviewed
 * release attestation travel with the artifact.
 */
export interface VisionModelArtifactManifest {
  schemaVersion: 2;
  modelId: string;
  modelVersion: string;
  releaseStage: ModelReleaseStage;
  /** Path relative to the app origin. Empty only for the committed unavailable placeholder. */
  assetPath: string;
  /** Lowercase SHA-256 hex of the exact ONNX bytes. Empty only for unavailable. */
  sha256: string;
  runtime: 'onnxruntime-web';
  input: {
    width: number;
    height: number;
    colorOrder: 'rgb';
    normalization: 'zero-to-one';
  };
  outputContract: 'darts180-board-tip-v1';
  outputs: {
    landmarks: string;
    dartTips: string;
    quality: string;
  };
  /** Values learned/fitted on a locked held-out validation set, never inferred from a UI target. */
  decisionPolicy: VisionModelDecisionPolicy;
  provenance: {
    trainingDataId: string | null;
    licenseReviewId: string | null;
    evaluatedAt: string | null;
  };
  releaseEvidence: ModelReleaseEvidence;
}

export interface BoardPoseObservation {
  frameTimestampMs: number;
  landmarks: readonly BoardLandmarkObservation[];
  quality: ModelQualityObservation;
  /** Null means the landmarks did not yield a safe geometric calibration. */
  calibration: BoardCalibration | null;
}

/** A full, explainable score proposal emitted before a game event is written. */
export interface ScoringProposal {
  schemaVersion: 1;
  proposalId: string;
  disposition: DetectionDisposition;
  /** Present only when a score point can be measured safely enough to rank zones. */
  boardPointMm?: BoardPointMm;
  tip?: DartTipObservation;
  calibration?: BoardCalibration;
  candidates: readonly RankedZoneCandidate[];
  confidence: number;
  reasons: readonly string[];
  evidence?: VisionEvidence;
}
