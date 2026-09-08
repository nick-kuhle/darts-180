import assert from 'node:assert/strict';
import test from 'node:test';

import { conventionalSegmentAppearance } from '../src/lib/boardAppearance.js';

test('renders the conventional dark D20/red accent and light D1/D5/green accents', () => {
  // STANDARD_SEGMENT_ORDER starts [20, 1, …, 5].
  assert.deepEqual(conventionalSegmentAppearance(0), {
    singleColor: '#1f2927',
    accentColor: '#d6463d',
  });
  assert.deepEqual(conventionalSegmentAppearance(1), {
    singleColor: '#e6d6b8',
    accentColor: '#1b9568',
  });
  assert.deepEqual(conventionalSegmentAppearance(19), {
    singleColor: '#e6d6b8',
    accentColor: '#1b9568',
  });
});
