import type { DeepDartsDevelopmentModelManifest, DeepDartsInferenceFrameResult } from './types';

export type DevelopmentVisionWorkerRequest =
  | {
      kind: 'initialize';
      requestId: number;
      manifest: DeepDartsDevelopmentModelManifest;
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

export type DevelopmentVisionWorkerResponse =
  | {
      kind: 'initialized';
      requestId: number;
      backend: 'webgpu' | 'wasm';
      modelVersion: string;
    }
  | {
      kind: 'inference';
      requestId: number;
      result: DeepDartsInferenceFrameResult;
    }
  | { kind: 'disposed'; requestId: number }
  | { kind: 'error'; requestId: number; message: string };
