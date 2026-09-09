import assert from 'node:assert/strict';
import test from 'node:test';

import type { VisionModelArtifactManifest } from '@darts-180/contracts';

import { WebInferenceClient } from '../src/lib/learnedVision/webInferenceClient.js';
import type {
  VisionWorkerRequest,
  VisionWorkerResponse,
} from '../src/lib/learnedVision/workerProtocol.js';

const manifest: VisionModelArtifactManifest = {
  schemaVersion: 2,
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
    minZonePosteriorMargin: 0.08,
    minLandmarkConfidence: 0.45,
    maxPoseValidationResidualMm: 18,
    maxQualityOffAxisDegrees: 65,
    minBoardDiameterPixels: 480,
    minOverallQuality: 0.7,
    minBoardCoverage: 0.8,
    minSharpness: 0.7,
    maxGlareRisk: 0.45,
    maxOcclusionRisk: 0.5,
    tipTrackMatchDistanceMm: 12,
    tipTrackSettleMs: 320,
    tipTrackStaleAfterMs: 1200,
    maxTipTrackSpreadMm: 4,
    confidenceTemperature: 1,
    confidenceBias: 0,
    heldOutEvaluationId: 'client-test-eval',
  },
  provenance: {
    trainingDataId: 'client-test-data',
    licenseReviewId: 'client-test-license',
    evaluatedAt: null,
  },
  releaseEvidence: {
    attestationPath: null,
    attestationSha256: null,
    approvalId: null,
  },
};

class FakeWorker {
  public onmessage: ((event: MessageEvent<VisionWorkerResponse>) => void) | null = null;
  public onerror: ((event: ErrorEvent) => void) | null = null;
  public terminated = false;
  public replyToDispose = true;
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
      } else if (request.kind === 'dispose' && this.replyToDispose) {
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

test('WebInferenceClient tears down immediately even when a Worker never acknowledges disposal', async () => {
  const worker = new FakeWorker();
  worker.replyToDispose = false;
  const client = new WebInferenceClient(() => worker);
  await client.initialize(manifest);

  const completed = await Promise.race([
    client.dispose().then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 50)),
  ]);

  assert.equal(completed, true);
  assert.equal(worker.received[1]?.request.kind, 'dispose');
  assert.equal(worker.terminated, true);
});

test('WebInferenceClient closes an invalid camera bitmap before sending it to a Worker', async () => {
  const worker = new FakeWorker();
  const client = new WebInferenceClient(() => worker);
  await client.initialize(manifest);
  let closed = false;
  const bitmap = { close: () => (closed = true) } as unknown as ImageBitmap;

  await assert.rejects(client.infer(bitmap, 0, 1080, 1234), /invalid frame dimensions/);
  assert.equal(closed, true);
  assert.equal(worker.received.length, 1);
  await client.dispose();
});

test('WebInferenceClient refuses an unavailable model before starting a worker', async () => {
  const worker = new FakeWorker();
  const client = new WebInferenceClient(() => worker);
  await assert.rejects(
    client.initialize({ ...manifest, releaseStage: 'unavailable', assetPath: '', sha256: '' }),
  );
  assert.equal(worker.received.length, 0);
});
