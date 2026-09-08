import assert from 'node:assert/strict';
import test from 'node:test';

import type { VisionModelArtifactManifest } from '@darts-180/contracts';

import { WebInferenceClient } from '../src/lib/learnedVision/webInferenceClient.js';
import type {
  VisionWorkerRequest,
  VisionWorkerResponse,
} from '../src/lib/learnedVision/workerProtocol.js';

const manifest: VisionModelArtifactManifest = {
  schemaVersion: 1,
  modelId: 'darts180-board-tip',
  modelVersion: 'client-test-v1',
  releaseStage: 'evaluation',
  assetPath: '/models/client-test-v1.onnx',
  sha256: 'b'.repeat(64),
  runtime: 'onnxruntime-web',
  input: { width: 1024, height: 1024, colorOrder: 'rgb', normalization: 'zero-to-one' },
  outputContract: 'darts180-board-tip-v1',
  outputs: { landmarks: 'board_landmarks', dartTips: 'dart_tips', quality: 'quality' },
  decisionPolicy: {
    autoRecordEnabled: false,
    minAutoScoreProbability: 0.97,
    minAutoScoreWireMarginMm: 1.5,
    minReviewProbability: 0.45,
    maxQualityOffAxisDegrees: 65,
    minBoardDiameterPixels: 480,
    minOverallQuality: 0.7,
    maxOcclusionRisk: 0.5,
    confidenceTemperature: 1,
    confidenceBias: 0,
    heldOutEvaluationId: 'client-test-eval',
  },
  provenance: {
    trainingDataId: 'client-test-data',
    licenseReviewId: 'client-test-license',
    evaluatedAt: null,
  },
};

class FakeWorker {
  public onmessage: ((event: MessageEvent<VisionWorkerResponse>) => void) | null = null;
  public onerror: ((event: ErrorEvent) => void) | null = null;
  public terminated = false;
  public readonly received: Array<{
    request: VisionWorkerRequest;
    transfer: Transferable[] | undefined;
  }> = [];

  public postMessage(request: VisionWorkerRequest, transfer?: Transferable[]): void {
    this.received.push({ request, transfer });
    queueMicrotask(() => {
      if (request.kind === 'initialize') {
        this.reply({
          kind: 'initialized',
          requestId: request.requestId,
          backend: 'wasm',
          modelVersion: request.manifest.modelVersion,
        });
      } else if (request.kind === 'infer') {
        this.reply({
          kind: 'inference',
          requestId: request.requestId,
          result: {
            frameTimestampMs: request.frameTimestampMs,
            landmarks: [],
            dartTips: [],
            quality: {
              overall: 0,
              boardCoverage: 0,
              sharpness: 0,
              glareRisk: 0,
              occlusionRisk: 1,
              offAxisDegrees: 90,
              boardDiameterPixels: 0,
              reasons: ['fake'],
            },
            inferenceMs: 1,
            backend: 'wasm',
          },
        });
      } else {
        this.reply({ kind: 'disposed', requestId: request.requestId });
      }
    });
  }

  public terminate(): void {
    this.terminated = true;
  }

  private reply(response: VisionWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<VisionWorkerResponse>);
  }
}

test('WebInferenceClient uses typed requests, transfers a camera bitmap, and releases its worker', async () => {
  const worker = new FakeWorker();
  const client = new WebInferenceClient(() => worker);
  assert.equal(await client.initialize(manifest), 'wasm');
  assert.equal(client.isReady, true);
  assert.equal(client.activeBackend, 'wasm');

  const bitmap = { close: () => undefined } as unknown as ImageBitmap;
  const result = await client.infer(bitmap, 1920, 1080, 1234);
  assert.equal(result.frameTimestampMs, 1234);
  assert.equal(worker.received[1]?.request.kind, 'infer');
  assert.deepEqual(worker.received[1]?.transfer, [bitmap]);

  await client.dispose();
  assert.equal(worker.received[2]?.request.kind, 'dispose');
  assert.equal(worker.terminated, true);
  assert.equal(client.isReady, false);
});

test('WebInferenceClient refuses an unavailable model before starting a worker', async () => {
  const worker = new FakeWorker();
  const client = new WebInferenceClient(() => worker);
  await assert.rejects(
    client.initialize({ ...manifest, releaseStage: 'unavailable', assetPath: '', sha256: '' }),
  );
  assert.equal(worker.received.length, 0);
});
