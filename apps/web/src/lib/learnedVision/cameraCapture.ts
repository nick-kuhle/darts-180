import { createLumaFrame, type LumaFrame } from './eventGate';

export interface CapturedModelFrame {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  capturedAtMs: number;
}

/** Bounded focus/exposure settle after the player arms a visit; this is not a clear-frame capture. */
export const ARM_CAMERA_SETTLE_MS = 650;

/** Keep the temporal event cue inexpensive; all localization pixels go to the learned Worker. */
export function captureLumaCue(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  edge = 192,
): LumaFrame | null {
  if (
    video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
    video.videoWidth <= 0 ||
    video.videoHeight <= 0
  ) {
    return null;
  }
  const scale = Math.min(1, edge / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.max(2, Math.round(video.videoWidth * scale));
  const height = Math.max(2, Math.round(video.videoHeight * scale));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) return null;
  context.drawImage(video, 0, 0, width, height);
  return createLumaFrame(
    context.getImageData(0, 0, width, height).data,
    width,
    height,
    performance.now(),
  );
}

export async function captureModelFrame(video: HTMLVideoElement): Promise<CapturedModelFrame> {
  if (
    video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
    video.videoWidth <= 0 ||
    video.videoHeight <= 0
  ) {
    throw new Error('The rear camera has not produced a complete frame yet.');
  }
  const bitmap = await createImageBitmap(video);
  return {
    bitmap,
    width: video.videoWidth,
    height: video.videoHeight,
    capturedAtMs: performance.now(),
  };
}

/**
 * Keep the historically useful bounded arm handoff without taking a clear-board reference photo.
 * The delay gives mobile autofocus/exposure a deterministic chance to settle before a learned check.
 */
export function waitForCameraArmHandoff(): Promise<void> {
  return waitForVideoFrame(ARM_CAMERA_SETTLE_MS);
}

/**
 * Yield post-impact camera frames one at a time at source resolution. The model rather than reference
 * subtraction chooses the semantic entry point; sequential yielding bounds full-resolution bitmap
 * memory while letting the canonical tracker require a stable learned result.
 */
export async function* capturePostImpactFrames(
  video: HTMLVideoElement,
  delaysMs: readonly number[] = [0, 180, 360, 560],
): AsyncGenerator<CapturedModelFrame, void, undefined> {
  let elapsed = 0;
  for (const delayMs of delaysMs) {
    const waitMs = Math.max(0, delayMs - elapsed);
    if (waitMs > 0) await waitForVideoFrame(waitMs);
    elapsed = delayMs;
    yield await captureModelFrame(video);
  }
}

function waitForVideoFrame(minimumDelayMs: number): Promise<void> {
  // `createImageBitmap(video)` reads the most recently decoded camera frame. Waiting at least the
  // requested interval makes this portable across Safari/Chrome without depending on an optional
  // requestVideoFrameCallback implementation or resolving before a dart has settled.
  return new Promise((resolve) => window.setTimeout(resolve, minimumDelayMs));
}
