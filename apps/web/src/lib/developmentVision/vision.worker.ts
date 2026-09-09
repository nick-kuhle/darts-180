/// <reference lib="webworker" />

import * as ort from 'onnxruntime-web';

import { isRunnableDevelopmentModelManifest, parseDevelopmentModelManifest } from './modelManifest';
import type { DeepDartsDevelopmentModelManifest, DeepDartsInferenceFrameResult } from './types';
import type {
  DevelopmentVisionWorkerRequest,
  DevelopmentVisionWorkerResponse,
} from './workerProtocol';
import { decodeDeepDartsYoloOutput } from './yoloOutputDecoder';

let session: ort.InferenceSession | null = null;
let manifest: DeepDartsDevelopmentModelManifest | null = null;
let backend: 'webgpu' | 'wasm' | null = null;
let processing: Promise<void> = Promise.resolve();
let preprocessCanvas: OffscreenCanvas | null = null;
let preprocessContext: OffscreenCanvasRenderingContext2D | null = null;

// Keep the development artifact fully local and usable without cross-origin isolation.
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;

self.addEventListener('message', (event: MessageEvent<DevelopmentVisionWorkerRequest>) => {
  processing = processing
    .then(() => handleMessage(event.data))
    .catch(() => {
      // `handleMessage` posts bounded errors. Do not poison the serialized worker queue.
    });
});

async function handleMessage(request: DevelopmentVisionWorkerRequest): Promise<void> {
  try {
    switch (request.kind) {
      case 'initialize': {
        const initialized = await initialize(request.manifest);
        post({
          kind: 'initialized',
          requestId: request.requestId,
          backend: initialized,
          modelVersion: request.manifest.modelVersion,
        });
        return;
      }
      case 'infer': {
        const result = await infer(request);
        post({ kind: 'inference', requestId: request.requestId, result });
        return;
      }
      case 'dispose': {
        await dispose();
        post({ kind: 'disposed', requestId: request.requestId });
        return;
      }
    }
  } catch (error) {
    post({ kind: 'error', requestId: request.requestId, message: safeErrorMessage(error) });
  }
}

async function initialize(
  nextManifest: DeepDartsDevelopmentModelManifest,
): Promise<'webgpu' | 'wasm'> {
  // Structured clone input is not a trust boundary. A direct worker caller gets the same strict
  // same-origin/hash/class-map checks as the React client.
  const verifiedManifest = parseDevelopmentModelManifest(nextManifest);
  if (!isRunnableDevelopmentModelManifest(verifiedManifest)) {
    throw new Error('The verified local experimental model is not installed.');
  }
  await dispose();
  const bytes = await fetchVerifiedModel(verifiedManifest);

  if (supportsWebGpu()) {
    try {
      session = await ort.InferenceSession.create(bytes, {
        executionProviders: ['webgpu'],
        graphOptimizationLevel: 'all',
      });
      manifest = verifiedManifest;
      backend = 'webgpu';
      return backend;
    } catch {
      // An available WebGPU implementation can still lack an ONNX operator. Fall back to local
      // single-threaded WASM rather than reaching for hosted inference or a non-ML substitute.
      await dispose();
    }
  }

  session = await ort.InferenceSession.create(bytes, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  manifest = verifiedManifest;
  backend = 'wasm';
  return backend;
}

async function infer(
  request: Extract<DevelopmentVisionWorkerRequest, { kind: 'infer' }>,
): Promise<DeepDartsInferenceFrameResult> {
  const start = performance.now();
  try {
    if (session === null || manifest === null || backend === null) {
      throw new Error('The local experimental model is not ready.');
    }
    if (
      !Number.isInteger(request.sourceWidth) ||
      !Number.isInteger(request.sourceHeight) ||
      !Number.isFinite(request.frameTimestampMs) ||
      request.frameTimestampMs < 0 ||
      request.sourceWidth !== request.bitmap.width ||
      request.sourceHeight !== request.bitmap.height
    ) {
      throw new Error('The camera frame dimensions do not match the local experimental request.');
    }
    const prepared = await preprocess(request.bitmap, manifest.input.width, manifest.input.height);
    const inputName = session.inputNames[0];
    if (inputName === undefined || session.inputNames.length !== 1) {
      throw new Error('The model does not match the single-image development contract.');
    }
    const outputs = await session.run({
      [inputName]: new ort.Tensor('float32', prepared.tensor, [
        1,
        3,
        manifest.input.height,
        manifest.input.width,
      ]),
    });
    const output = outputs[manifest.output.detections];
    if (output === undefined || !(output.data instanceof Float32Array)) {
      throw new Error('The development YOLO detection output is unavailable.');
    }
    const detections = decodeDeepDartsYoloOutput(
      { data: output.data, dims: output.dims },
      prepared.transform,
      manifest.policy,
    );
    return {
      frameTimestampMs: request.frameTimestampMs,
      detections,
      inferenceMs: Math.round((performance.now() - start) * 10) / 10,
      backend,
    };
  } finally {
    request.bitmap.close();
  }
}

async function dispose(): Promise<void> {
  const previousSession = session;
  session = null;
  manifest = null;
  backend = null;
  preprocessCanvas = null;
  preprocessContext = null;
  if (previousSession !== null) await previousSession.release();
}

async function fetchVerifiedModel(
  nextManifest: DeepDartsDevelopmentModelManifest,
): Promise<Uint8Array> {
  const response = await fetch(nextManifest.assetPath, {
    cache: 'force-cache',
    credentials: 'same-origin',
  });
  if (!response.ok) throw new Error('The local experimental model file is missing.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if ((await sha256Hex(bytes)) !== nextManifest.sha256) {
    throw new Error('The local experimental model failed integrity verification.');
  }
  return bytes;
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, '0')).join('');
}

interface PreparedFrame {
  tensor: Float32Array;
  transform: {
    sourceWidth: number;
    sourceHeight: number;
    inputWidth: number;
    inputHeight: number;
    scaleX: number;
    scaleY: number;
  };
}

/** Exact stretch transform declared in the versioned manifest; coordinates are inverted on decode. */
async function preprocess(
  bitmap: ImageBitmap,
  inputWidth: number,
  inputHeight: number,
): Promise<PreparedFrame> {
  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error('The camera did not produce a drawable frame.');
  }
  const context = getPreprocessContext(inputWidth, inputHeight);
  context.clearRect(0, 0, inputWidth, inputHeight);
  context.drawImage(bitmap, 0, 0, inputWidth, inputHeight);
  const rgba = context.getImageData(0, 0, inputWidth, inputHeight).data;
  const pixels = inputWidth * inputHeight;
  const tensor = new Float32Array(pixels * 3);
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 4;
    tensor[pixel] = (rgba[offset] ?? 0) / 255;
    tensor[pixels + pixel] = (rgba[offset + 1] ?? 0) / 255;
    tensor[pixels * 2 + pixel] = (rgba[offset + 2] ?? 0) / 255;
  }
  return {
    tensor,
    transform: {
      sourceWidth,
      sourceHeight,
      inputWidth,
      inputHeight,
      scaleX: inputWidth / sourceWidth,
      scaleY: inputHeight / sourceHeight,
    },
  };
}

function getPreprocessContext(
  inputWidth: number,
  inputHeight: number,
): OffscreenCanvasRenderingContext2D {
  if (
    preprocessCanvas === null ||
    preprocessContext === null ||
    preprocessCanvas.width !== inputWidth ||
    preprocessCanvas.height !== inputHeight
  ) {
    preprocessCanvas = new OffscreenCanvas(inputWidth, inputHeight);
    preprocessContext = preprocessCanvas.getContext('2d', { willReadFrequently: true });
  }
  if (preprocessContext === null) {
    throw new Error('The browser could not prepare a local model frame.');
  }
  return preprocessContext;
}

function supportsWebGpu(): boolean {
  return 'gpu' in (self.navigator as Navigator & { gpu?: unknown });
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('integrity')) {
    return 'The local experimental model failed integrity verification.';
  }
  if (message.includes('not installed') || message.includes('missing')) {
    return 'The verified local experimental model is not installed.';
  }
  if (
    message.includes('contract') ||
    message.includes('output') ||
    message.includes('single-image') ||
    message.includes('dimensions')
  ) {
    return 'The local experimental model does not match the Darts 180 development contract.';
  }
  return 'Experimental local camera inference could not complete. No score was recorded.';
}

function post(message: DevelopmentVisionWorkerResponse): void {
  self.postMessage(message);
}
