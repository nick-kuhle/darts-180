/// <reference lib="webworker" />

import type { VisionModelArtifactManifest } from '@darts-180/contracts';
import * as ort from 'onnxruntime-web';

import { decodeModelOutputs, type LetterboxTransform } from './modelOutputDecoder';
import type {
  LearnedInferenceFrameResult,
  VisionWorkerRequest,
  VisionWorkerResponse,
} from './workerProtocol';

let session: ort.InferenceSession | null = null;
let manifest: VisionModelArtifactManifest | null = null;
let backend: 'webgpu' | 'wasm' | null = null;
let processing: Promise<void> = Promise.resolve();

// The browser app intentionally stays usable without cross-origin isolation. ONNX Runtime's
// single-threaded WASM mode avoids requiring COOP/COEP while the WebGPU path is opportunistic.
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;

self.addEventListener('message', (event: MessageEvent<VisionWorkerRequest>) => {
  processing = processing
    .then(() => handleMessage(event.data))
    .catch(() => {
      // handleMessage posts a bounded error. Keep the serialized queue alive for the next request.
    });
});

async function handleMessage(request: VisionWorkerRequest): Promise<void> {
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

async function initialize(nextManifest: VisionModelArtifactManifest): Promise<'webgpu' | 'wasm'> {
  if (
    nextManifest.releaseStage === 'unavailable' ||
    nextManifest.assetPath === '' ||
    nextManifest.sha256 === ''
  ) {
    throw new Error('The verified local learned model is not installed.');
  }
  await dispose();
  const bytes = await fetchVerifiedModel(nextManifest);

  if (supportsWebGpu()) {
    try {
      session = await ort.InferenceSession.create(bytes, {
        executionProviders: ['webgpu'],
        graphOptimizationLevel: 'all',
      });
      manifest = nextManifest;
      backend = 'webgpu';
      return backend;
    } catch {
      // A browser may expose WebGPU but lack an operator supported by the exported graph. Fall back
      // to the app-bundled, single-threaded WASM runtime rather than failing the entire camera flow.
    }
  }

  session = await ort.InferenceSession.create(bytes, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  manifest = nextManifest;
  backend = 'wasm';
  return backend;
}

async function infer(
  request: Extract<VisionWorkerRequest, { kind: 'infer' }>,
): Promise<LearnedInferenceFrameResult> {
  const start = performance.now();
  try {
    if (session === null || manifest === null || backend === null) {
      throw new Error('The local learned model is not ready.');
    }
    const prepared = await preprocess(request.bitmap, manifest.input.width, manifest.input.height);
    const inputName = session.inputNames[0];
    if (inputName === undefined || session.inputNames.length !== 1) {
      throw new Error('The model does not match the single-image runtime contract.');
    }
    const outputs = await session.run({
      [inputName]: new ort.Tensor('float32', prepared.tensor, [
        1,
        3,
        manifest.input.height,
        manifest.input.width,
      ]),
    });
    const decoded = decodeModelOutputs(
      {
        landmarks: floatTensorData(outputs[manifest.outputs.landmarks], 'board landmarks'),
        dartTips: floatTensorData(outputs[manifest.outputs.dartTips], 'dart tips'),
        quality: floatTensorData(outputs[manifest.outputs.quality], 'quality'),
      },
      prepared.transform,
    );
    return {
      frameTimestampMs: request.frameTimestampMs,
      landmarks: decoded.landmarks,
      dartTips: decoded.dartTips,
      quality: decoded.quality,
      inferenceMs: Math.round((performance.now() - start) * 10) / 10,
      backend,
    };
  } finally {
    request.bitmap.close();
  }
}

async function dispose(): Promise<void> {
  if (session !== null) await session.release();
  session = null;
  manifest = null;
  backend = null;
}

async function fetchVerifiedModel(nextManifest: VisionModelArtifactManifest): Promise<Uint8Array> {
  const response = await fetch(nextManifest.assetPath, {
    cache: 'force-cache',
    credentials: 'same-origin',
  });
  if (!response.ok) throw new Error('The local learned model file is missing.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const actualHash = [...new Uint8Array(digest)]
    .map((part) => part.toString(16).padStart(2, '0'))
    .join('');
  if (actualHash !== nextManifest.sha256)
    throw new Error('The local learned model failed integrity verification.');
  return bytes;
}

interface PreparedFrame {
  tensor: Float32Array;
  transform: LetterboxTransform;
}

async function preprocess(
  bitmap: ImageBitmap,
  inputWidth: number,
  inputHeight: number,
): Promise<PreparedFrame> {
  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;
  if (sourceWidth <= 0 || sourceHeight <= 0)
    throw new Error('The camera did not produce a drawable frame.');
  const scale = Math.min(inputWidth / sourceWidth, inputHeight / sourceHeight);
  const drawnWidth = Math.round(sourceWidth * scale);
  const drawnHeight = Math.round(sourceHeight * scale);
  const offsetX = Math.floor((inputWidth - drawnWidth) / 2);
  const offsetY = Math.floor((inputHeight - drawnHeight) / 2);
  const canvas = new OffscreenCanvas(inputWidth, inputHeight);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) throw new Error('The browser could not prepare a local model frame.');
  context.fillStyle = '#000000';
  context.fillRect(0, 0, inputWidth, inputHeight);
  context.drawImage(bitmap, offsetX, offsetY, drawnWidth, drawnHeight);
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
    transform: { sourceWidth, sourceHeight, inputWidth, inputHeight, scale, offsetX, offsetY },
  };
}

function floatTensorData(tensor: ort.Tensor | undefined, name: string): Float32Array {
  if (tensor === undefined || !(tensor.data instanceof Float32Array)) {
    throw new Error(`The model ${name} output is unavailable.`);
  }
  return tensor.data;
}

function supportsWebGpu(): boolean {
  return 'gpu' in (self.navigator as Navigator & { gpu?: unknown });
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('integrity'))
    return 'The local learned model failed integrity verification.';
  if (message.includes('not installed') || message.includes('missing')) {
    return 'The verified local learned model is not installed.';
  }
  if (
    message.includes('contract') ||
    message.includes('output') ||
    message.includes('single-image')
  ) {
    return 'The local learned model does not match the Darts 180 browser contract.';
  }
  return 'Local learned camera inference could not complete. No score was recorded.';
}

function post(message: VisionWorkerResponse): void {
  self.postMessage(message);
}
