import assert from 'node:assert/strict';
import test from 'node:test';

import { advanceClearBoardBaseline } from '../src/lib/clearBoardBaseline.js';

test('arms only after two consecutive clear-board comparisons', () => {
  const initial = { stableComparisons: 0, broadMotionComparisons: 0 };
  const firstClear = advanceClearBoardBaseline(initial, 'no-change');
  assert.deepEqual(firstClear, {
    progress: { stableComparisons: 1, broadMotionComparisons: 0 },
    action: 'continue',
  });

  const motion = advanceClearBoardBaseline(firstClear.progress, 'camera-moved-or-hand-present');
  assert.deepEqual(motion, {
    progress: { stableComparisons: 0, broadMotionComparisons: 1 },
    action: 'continue',
  });

  const clearAfterMotion = advanceClearBoardBaseline(motion.progress, 'no-change');
  assert.equal(clearAfterMotion.action, 'continue');
  const armed = advanceClearBoardBaseline(clearAfterMotion.progress, 'no-change');
  assert.deepEqual(armed, {
    progress: { stableComparisons: 2, broadMotionComparisons: 0 },
    action: 'armed',
  });
});

test('requests a fresh automatic map after repeated broad motion instead of remaining stuck', () => {
  const initial = { stableComparisons: 0, broadMotionComparisons: 0 };
  const firstMotion = advanceClearBoardBaseline(initial, 'camera-moved-or-hand-present');
  assert.equal(firstMotion.action, 'continue');

  const secondMotion = advanceClearBoardBaseline(
    firstMotion.progress,
    'camera-moved-or-hand-present',
  );
  assert.deepEqual(secondMotion, {
    progress: { stableComparisons: 0, broadMotionComparisons: 2 },
    action: 'refresh-automatic-board-map',
  });
});

test('never reuses a localized possible dart as a clear-board reference', () => {
  const initial = { stableComparisons: 1, broadMotionComparisons: 1 };
  for (const status of ['dart-candidate', 'ambiguous-change', 'incompatible-frame'] as const) {
    assert.deepEqual(advanceClearBoardBaseline(initial, status), {
      progress: { stableComparisons: 0, broadMotionComparisons: 0 },
      action: 'hold-localized-change',
    });
  }
});
