import type { CameraFrame } from './cameraScoring';

/**
 * The fixed delay leaves a just-tapped mobile camera a brief, predictable opportunity to settle.
 * It is deliberately not a detector threshold or a promise that adjacent video frames are
 * pixel-identical.
 */
export const START_PLAY_REFERENCE_SETTLE_MS = 650;
export const START_PLAY_REFERENCE_RETRY_MS = 250;
export const START_PLAY_REFERENCE_MAX_FRAME_RETRIES = 4;

/**
 * Kept explicit as a regression boundary: setup-time difference labels are observational only.
 * They must not send a normal player back through board finding or hold Start Play indefinitely.
 */
export type SetupTransient = 'none' | 'localized-change' | 'broad-motion';

export interface StartPlayReferenceCaptureAttempt {
  /** Number of already-scheduled retries after the initial timed attempt. */
  retryCount?: number;
  /** A concurrent setup observation; intentionally not a reference-capture gate. */
  setupTransient?: SetupTransient;
}

export type StartPlayReferenceDecision =
  | { kind: 'retry'; delayMs: number }
  | { kind: 'camera-frame-unavailable' }
  | { kind: 'watching'; reference: CameraFrame };

/**
 * Convert one scheduled reference-capture attempt into a bounded next action.
 *
 * A present frame always starts watching, even if a concurrent setup observation described
 * localized change or broad motion. This is intentional: normal Camera Play asks for a clear
 * board, takes a fresh local reference after the fixed settle, and reserves temporal difference
 * classification for live scoring. A missing browser frame is retried only a small fixed number of
 * times; it then returns control to the player instead of creating another invisible setup loop.
 */
export function resolveStartPlayReferenceCapture(
  frame: CameraFrame | null,
  attempt: StartPlayReferenceCaptureAttempt = {},
): StartPlayReferenceDecision {
  const { retryCount = 0, setupTransient: _setupTransient = 'none' } = attempt;
  if (frame !== null) return { kind: 'watching', reference: frame };
  if (retryCount >= START_PLAY_REFERENCE_MAX_FRAME_RETRIES) {
    return { kind: 'camera-frame-unavailable' };
  }
  return { kind: 'retry', delayMs: START_PLAY_REFERENCE_RETRY_MS };
}
