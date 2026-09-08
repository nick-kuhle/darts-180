import type { VisionModelArtifactManifest } from '@darts-180/contracts';

import { isRunnableModelManifest } from './modelManifest';
import type {
  LearnedInferenceFrameResult,
  VisionWorkerRequest,
  VisionWorkerResponse,
} from './workerProtocol';

interface WorkerLike {
  postMessage(message: VisionWorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<VisionWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export interface BrowserVisionSupport {
  supported: boolean;
  reasons: readonly string[];
}

/**
 * Main-thread facade for the worker-owned learned runtime. The React component never imports
 * ONNX Runtime or reads pixels itself; it captures a transferable image bitmap and awaits a typed
 * semantic result. Tests can inject a WorkerLike without booting a browser worker.
 */
export class WebInferenceClient {
  private readonly makeWorker: () => WorkerLike;
  private worker: WorkerLike | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: VisionWorkerResponse) => void; reject: (reason: Error) => void }
  >();
  private ready = false;
  private disposed = false;
  private backend: 'webgpu' | 'wasm' | null = null;

  public constructor(makeWorker: () => WorkerLike = createVisionWorker) {
    this.makeWorker = makeWorker;
  }

  public get isReady(): boolean {
    return this.ready;
  }

  public get activeBackend(): 'webgpu' | 'wasm' | null {
    return this.backend;
  }

  public async initialize(manifest: VisionModelArtifactManifest): Promise<'webgpu' | 'wasm'> {
    if (this.disposed) throw new Error('The local vision runtime has been closed.');
    if (!isRunnableModelManifest(manifest)) {
      throw new Error(
        'A verified local learned model is required before camera inference can start.',
      );
    }
    if (this.ready && this.backend !== null) return this.backend;
    const worker = this.ensureWorker();
    const response = await this.send({ kind: 'initialize', requestId: 0, manifest }, worker);
    if (response.kind !== 'initialized')
      throw new Error('The local learned model did not initialize.');
    this.ready = true;
    this.backend = response.backend;
    return response.backend;
  }

  public async infer(
    bitmap: ImageBitmap,
    sourceWidth: number,
    sourceHeight: number,
    frameTimestampMs: number,
  ): Promise<LearnedInferenceFrameResult> {
    if (!this.ready || this.worker === null) {
      bitmap.close();
      throw new Error('The local learned model is not ready.');
    }
    const response = await this.send(
      {
        kind: 'infer',
        requestId: 0,
        bitmap,
        sourceWidth,
        sourceHeight,
        frameTimestampMs,
      },
      this.worker,
      [bitmap],
    );
    if (response.kind !== 'inference')
      throw new Error('The local learned model did not return an inference result.');
    return response.result;
  }

  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const worker = this.worker;
    this.ready = false;
    this.backend = null;
    if (worker !== null) {
      try {
        await this.send({ kind: 'dispose', requestId: 0 }, worker);
      } catch {
        // Worker teardown is best-effort; it must not turn camera shutdown into an app failure.
      }
      worker.terminate();
    }
    this.worker = null;
    this.rejectAll('The local vision runtime was closed.');
  }

  private ensureWorker(): WorkerLike {
    if (this.worker !== null) return this.worker;
    const worker = this.makeWorker();
    worker.onmessage = (event) => this.handleMessage(event.data);
    worker.onerror = () => this.rejectAll('The local vision worker stopped unexpectedly.');
    this.worker = worker;
    return worker;
  }

  private send(
    request: VisionWorkerRequest,
    worker: WorkerLike,
    transfer: Transferable[] = [],
  ): Promise<VisionWorkerResponse> {
    const requestId = this.nextRequestId++;
    const message = { ...request, requestId } as VisionWorkerRequest;
    return new Promise<VisionWorkerResponse>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      try {
        worker.postMessage(message, transfer);
      } catch {
        this.pending.delete(requestId);
        if (message.kind === 'infer') message.bitmap.close();
        reject(new Error('The local vision worker could not receive this frame.'));
      }
    });
  }

  private handleMessage(response: VisionWorkerResponse): void {
    const pending = this.pending.get(response.requestId);
    if (pending === undefined) return;
    this.pending.delete(response.requestId);
    if (response.kind === 'error') {
      pending.reject(new Error(response.message));
      return;
    }
    pending.resolve(response);
  }

  private rejectAll(message: string): void {
    for (const pending of this.pending.values()) pending.reject(new Error(message));
    this.pending.clear();
  }
}

export function getBrowserVisionSupport(): BrowserVisionSupport {
  const reasons: string[] = [];
  if (typeof Worker === 'undefined')
    reasons.push('This browser cannot start a local vision worker.');
  if (typeof OffscreenCanvas === 'undefined')
    reasons.push('This browser cannot prepare local model frames off the UI thread.');
  if (typeof createImageBitmap === 'undefined')
    reasons.push('This browser cannot transfer camera frames to the local vision worker.');
  if (typeof crypto === 'undefined' || crypto.subtle === undefined) {
    reasons.push('This browser cannot verify the local model artifact.');
  }
  return { supported: reasons.length === 0, reasons };
}

function createVisionWorker(): WorkerLike {
  return new Worker(new URL('./vision.worker.ts', import.meta.url), {
    type: 'module',
    name: 'Darts 180 vision',
  });
}
