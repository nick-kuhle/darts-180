import {
  getBrowserVisionSupport,
  type BrowserVisionSupport,
} from '../learnedVision/webInferenceClient';

import { isRunnableDevelopmentModelManifest, parseDevelopmentModelManifest } from './modelManifest';
import type { DeepDartsDevelopmentModelManifest, DeepDartsInferenceFrameResult } from './types';
import type {
  DevelopmentVisionWorkerRequest,
  DevelopmentVisionWorkerResponse,
} from './workerProtocol';

interface WorkerLike {
  postMessage(message: DevelopmentVisionWorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<DevelopmentVisionWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

/** Main-thread facade for the isolated development-only YOLO worker. */
export class DevelopmentWebInferenceClient {
  private readonly makeWorker: () => WorkerLike;
  private worker: WorkerLike | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: DevelopmentVisionWorkerResponse) => void; reject: (reason: Error) => void }
  >();
  private ready = false;
  private disposed = false;
  private backend: 'webgpu' | 'wasm' | null = null;

  public constructor(makeWorker: () => WorkerLike = createDevelopmentVisionWorker) {
    this.makeWorker = makeWorker;
  }

  public get isReady(): boolean {
    return this.ready;
  }

  public get activeBackend(): 'webgpu' | 'wasm' | null {
    return this.backend;
  }

  public async initialize(manifest: DeepDartsDevelopmentModelManifest): Promise<'webgpu' | 'wasm'> {
    if (this.disposed) throw new Error('The experimental local vision runtime has been closed.');
    const verifiedManifest = parseDevelopmentModelManifest(manifest);
    if (!isRunnableDevelopmentModelManifest(verifiedManifest)) {
      throw new Error(
        'A verified local experimental model is required before camera inference can start.',
      );
    }
    if (this.ready && this.backend !== null) return this.backend;
    const worker = this.ensureWorker();
    const response = await this.send(
      { kind: 'initialize', requestId: 0, manifest: verifiedManifest },
      worker,
    );
    if (response.kind !== 'initialized') {
      throw new Error('The local experimental model did not initialize.');
    }
    this.ready = true;
    this.backend = response.backend;
    return response.backend;
  }

  public async infer(
    bitmap: ImageBitmap,
    sourceWidth: number,
    sourceHeight: number,
    frameTimestampMs: number,
  ): Promise<DeepDartsInferenceFrameResult> {
    if (!this.ready || this.worker === null) {
      bitmap.close();
      throw new Error('The local experimental model is not ready.');
    }
    if (
      !Number.isInteger(sourceWidth) ||
      sourceWidth <= 0 ||
      !Number.isInteger(sourceHeight) ||
      sourceHeight <= 0 ||
      !Number.isFinite(frameTimestampMs) ||
      frameTimestampMs < 0
    ) {
      bitmap.close();
      throw new Error(
        'The local experimental vision request has invalid frame dimensions or timestamp.',
      );
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
    if (response.kind !== 'inference') {
      throw new Error('The local experimental model did not return an inference result.');
    }
    return response.result;
  }

  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const worker = this.worker;
    this.ready = false;
    this.backend = null;
    this.worker = null;
    if (worker !== null) {
      try {
        worker.postMessage({ kind: 'dispose', requestId: this.nextRequestId++ });
      } catch {
        // Termination below is the bounded teardown path even if a worker is already wedged.
      }
      worker.terminate();
    }
    this.rejectAll('The local experimental vision runtime was closed.');
  }

  private ensureWorker(): WorkerLike {
    if (this.worker !== null) return this.worker;
    const worker = this.makeWorker();
    worker.onmessage = (event) => this.handleMessage(event.data);
    worker.onerror = () => {
      if (this.worker === worker) {
        this.worker = null;
        this.ready = false;
        this.backend = null;
        worker.terminate();
      }
      this.rejectAll('The local experimental vision worker stopped unexpectedly.');
    };
    this.worker = worker;
    return worker;
  }

  private send(
    request: DevelopmentVisionWorkerRequest,
    worker: WorkerLike,
    transfer: Transferable[] = [],
  ): Promise<DevelopmentVisionWorkerResponse> {
    const requestId = this.nextRequestId++;
    const message = { ...request, requestId } as DevelopmentVisionWorkerRequest;
    return new Promise<DevelopmentVisionWorkerResponse>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      try {
        worker.postMessage(message, transfer);
      } catch {
        this.pending.delete(requestId);
        if (message.kind === 'infer') message.bitmap.close();
        reject(new Error('The local experimental vision worker could not receive this frame.'));
      }
    });
  }

  private handleMessage(response: DevelopmentVisionWorkerResponse): void {
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

export function getDevelopmentBrowserVisionSupport(): BrowserVisionSupport {
  return getBrowserVisionSupport();
}

function createDevelopmentVisionWorker(): WorkerLike {
  return new Worker(new URL('./vision.worker.ts', import.meta.url), {
    type: 'module',
    name: 'Darts 180 experimental vision',
  });
}
