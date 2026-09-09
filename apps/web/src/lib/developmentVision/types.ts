import type { BoardPointMm, DartZone } from '@darts-180/contracts';

import type { Homography } from '../annotationGeometry';

/** The confirmed DeepDarts YOLOv8 v2 class roles; all IDs are immutable in this dev contract. */
export const DEEPDARTS_CLASS_IDS = {
  dartEntryPoint: 0,
  calibration1: 1,
  calibration2: 2,
  calibration3: 3,
  calibration4: 4,
} as const;

export type DeepDartsClassId = (typeof DEEPDARTS_CLASS_IDS)[keyof typeof DEEPDARTS_CLASS_IDS];

export type DevelopmentInferenceBackend = 'webgpu' | 'wasm';

/** Required artifact provenance prevents a synthetic bootstrap from masquerading as real-device evidence. */
export type DevelopmentTrainingDataKind =
  'synthetic-only' | 'real-reviewed' | 'mixed-synthetic-and-real';

export interface DevelopmentDetectionPolicy {
  /** Raw YOLO class-score floor before class-aware NMS. This is not calibrated score accuracy. */
  minDetectionConfidence: number;
  minDartConfidence: number;
  minCalibrationConfidence: number;
  nmsIouThreshold: number;
  maxDetections: number;
  tipTrackMatchDistanceMm: number;
  tipTrackSettleMs: number;
  tipTrackStaleAfterMs: number;
  maxTipTrackSpreadMm: number;
}

/**
 * A development-only, five-point YOLOv8 artifact description. It intentionally cannot be a
 * production manifest: every resulting score is an editable `review` suggestion.
 */
export interface DeepDartsDevelopmentModelManifest {
  schemaVersion: 1;
  modelId: 'darts180-deepdarts-yolo';
  modelVersion: string;
  releaseStage: 'development';
  assetPath: string;
  sha256: string;
  runtime: 'onnxruntime-web';
  input: {
    width: number;
    height: number;
    colorOrder: 'rgb';
    normalization: 'zero-to-one';
    /** Matches the Roboflow v2 export's 640×640 stretch preprocessing. */
    resizeMode: 'stretch';
  };
  output: {
    detections: string;
    layout: 'yolov8-raw-cxcywh-class-scores';
    classCount: 5;
  };
  classMap: {
    dartEntryPoint: 0;
    calibration1: 1;
    calibration2: 2;
    calibration3: 3;
    calibration4: 4;
  };
  policy: DevelopmentDetectionPolicy;
  provenance: {
    trainingDataId: string;
    trainingDataKind: DevelopmentTrainingDataKind;
    licenseReviewId: string;
    trainedAt: string | null;
  };
}

/** A class-aware NMS result in original camera-frame pixels. */
export interface DeepDartsDetection {
  classId: DeepDartsClassId;
  confidence: number;
  center: Readonly<{ xPx: number; yPx: number }>;
  widthPx: number;
  heightPx: number;
}

export interface DeepDartsStretchTransform {
  sourceWidth: number;
  sourceHeight: number;
  inputWidth: number;
  inputHeight: number;
  scaleX: number;
  scaleY: number;
}

export interface DeepDartsInferenceFrameResult {
  frameTimestampMs: number;
  detections: readonly DeepDartsDetection[];
  inferenceMs: number;
  backend: DevelopmentInferenceBackend;
}

/** Four detector-derived anchors solve this development-only standard-board mapping. */
export interface DeepDartsDevelopmentPose {
  imageToBoardHomography: Homography;
  boardToImageHomography: Homography;
  boardDiameterPixels: number;
  minimumAnchorConfidence: number;
}

export interface DevelopmentTrackedDart {
  trackId: string;
  firstSeenMs: number;
  lastSeenMs: number;
  observationCount: number;
  boardPointMm: BoardPointMm;
  detection: DeepDartsDetection;
  /** Stable detector-derived observations through the development settle interval. */
  isSettled: boolean;
  /** True once this track has produced an editable proposal. */
  proposed: boolean;
}

export interface DevelopmentScoreSuggestion {
  zone: DartZone;
  boardPointMm: BoardPointMm;
  detectorConfidence: number;
  wireMarginMm: number;
  /** Development suggestions are intentionally always editable. */
  disposition: 'review';
  reasons: readonly string[];
}
