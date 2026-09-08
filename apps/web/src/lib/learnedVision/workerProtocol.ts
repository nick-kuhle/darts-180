import type {
  BoardLandmarkObservation,
  DartTipObservation,
  ModelQualityObservation,
  VisionModelArtifactManifest,
} from '@darts-180/contracts';

export interface LearnedInferenceFrameResult {
  frameTimestampMs: number;
  landmarks: readonly BoardLandmarkObservation[];
  dartTips: readonly DartTipObservation[];
  quality: ModelQualityObservation;
  inferenceMs: number;
  backend: 'webgpu' | 'wasm';
}

export type VisionWorkerRequest =
  | {
      kind: 'initialize';
      requestId: number;
      manifest: VisionModelArtifactManifest;
    }
  | {
      kind: 'infer';
      requestId: number;
      bitmap: ImageBitmap;
      sourceWidth: number;
      sourceHeight: number;
      frameTimestampMs: number;
    }
  | { kind: 'dispose'; requestId: number };

export type VisionWorkerResponse =
  | {
      kind: 'initialized';
      requestId: number;
      backend: 'webgpu' | 'wasm';
      modelVersion: string;
    }
  | {
      kind: 'inference';
      requestId: number;
      result: LearnedInferenceFrameResult;
    }
  | { kind: 'disposed'; requestId: number }
  | { kind: 'error'; requestId: number; message: string };
