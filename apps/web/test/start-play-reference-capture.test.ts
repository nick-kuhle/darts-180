import assert from 'node:assert/strict';
import test from 'node:test';

import type { CameraFrame } from '../src/lib/cameraScoring.js';
import {
  resolveStartPlayReferenceCapture,
  START_PLAY_REFERENCE_MAX_FRAME_RETRIES,
  START_PLAY_REFERENCE_RETRY_MS,
  START_PLAY_REFERENCE_SETTLE_MS,
  type SetupTransient,
} from '../src/lib/startPlayReferenceCapture.js';

function frame(): CameraFrame {
  return {
    width: 2,
    height: 2,
    rgba: new Uint8ClampedArray(16).fill(185),
    capturedAtMs: 1_000,
  };
}

test('uses a short fixed settle and bounds missing-frame retries', () => {
  assert.equal(START_PLAY_REFERENCE_SETTLE_MS, 650);
  assert.deepEqual(resolveStartPlayReferenceCapture(null), {
    kind: 'retry',
    delayMs: START_PLAY_REFERENCE_RETRY_MS,
  });
  assert.deepEqual(
    resolveStartPlayReferenceCapture(null, {
      retryCount: START_PLAY_REFERENCE_MAX_FRAME_RETRIES - 1,
    }),
    { kind: 'retry', delayMs: START_PLAY_REFERENCE_RETRY_MS },
  );
  assert.deepEqual(
    resolveStartPlayReferenceCapture(null, {
      retryCount: START_PLAY_REFERENCE_MAX_FRAME_RETRIES,
    }),
    { kind: 'camera-frame-unavailable' },
  );
});

test('a fresh reference arms live watching despite localized or broad setup transients', () => {
  const freshFrame = frame();
  const transients: SetupTransient[] = ['none', 'localized-change', 'broad-motion'];

  for (const setupTransient of transients) {
    const decision = resolveStartPlayReferenceCapture(freshFrame, { setupTransient });
    assert.equal(decision.kind, 'watching');
    if (decision.kind === 'watching') assert.equal(decision.reference, freshFrame);
  }
});
