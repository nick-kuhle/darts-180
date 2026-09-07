import assert from 'node:assert/strict';
import test from 'node:test';

import type { CameraPoseQuality, RankedZoneCandidate } from '@darts-180/contracts';

import {
  createVisionSessionState,
  markTurnConfirmed,
  observeVisionFrame,
  type VisionFrameObservation,
} from '../src/index';

const quality: CameraPoseQuality = {
  overall: 0.95,
  boardCoverage: 0.9,
  sharpness: 0.9,
  glareRisk: 0.05,
  occlusionRisk: 0.05,
  offAxisDegrees: 20,
  boardDiameterPixels: 780,
  reasons: [],
};

function candidate(probability: number, wireMarginMm: number): RankedZoneCandidate {
  return {
    zone: { ring: 'T', segment: 20, score: 60 },
    probability,
    wireMarginMm,
  };
}

function frame(
  atMs: number,
  ids: readonly string[],
  c = candidate(0.99, 3),
): VisionFrameObservation {
  return {
    atMs,
    quality,
    darts: ids.map((trackId) => ({ trackId, candidates: [c] })),
  };
}

test('waits through a settle window before proposing a dart', () => {
  const initial = createVisionSessionState();
  const first = observeVisionFrame(initial, frame(0, ['one']));
  assert.equal(first.state.phase, 'settling');
  assert.equal(first.actions[0]?.type, 'SETTLING_STARTED');

  const premature = observeVisionFrame(first.state, frame(200, ['one']));
  assert.equal(premature.state.proposals.length, 0);

  const stable = observeVisionFrame(premature.state, frame(351, ['one']));
  assert.equal(stable.state.proposals.length, 1);
  assert.equal(stable.state.proposals[0]?.disposition, 'auto-accepted');
});

test('sends borderline wire hits to review even at high class probability', () => {
  const initial = createVisionSessionState();
  const started = observeVisionFrame(initial, frame(0, ['one'], candidate(0.99, 0.2)));
  const stable = observeVisionFrame(started.state, frame(351, ['one'], candidate(0.99, 0.2)));

  assert.equal(stable.state.proposals[0]?.disposition, 'needs-review');
});

test('blocks scoring when the board is too small or too oblique', () => {
  const initial = createVisionSessionState();
  const poorQuality: CameraPoseQuality = {
    ...quality,
    boardDiameterPixels: 300,
    offAxisDegrees: 60,
  };
  const result = observeVisionFrame(initial, { ...frame(0, []), quality: poorQuality });

  assert.equal(result.state.phase, 'blocked');
  assert.equal(result.actions[0]?.type, 'QUALITY_BLOCKED');
});

test('becomes ready for review after three settled dart tracks', () => {
  let state = createVisionSessionState();
  state = observeVisionFrame(state, frame(0, ['one'])).state;
  state = observeVisionFrame(state, frame(351, ['one'])).state;
  state = observeVisionFrame(state, frame(400, ['one', 'two'])).state;
  state = observeVisionFrame(state, frame(751, ['one', 'two'])).state;
  state = observeVisionFrame(state, frame(800, ['one', 'two', 'three'])).state;
  const result = observeVisionFrame(state, frame(1151, ['one', 'two', 'three']));

  assert.equal(result.state.phase, 'reviewing');
  assert.equal(result.state.proposals.length, 3);
  assert.ok(result.actions.some((action) => action.type === 'TURN_READY_FOR_REVIEW'));
});

test('blocks a board state with more than three dart tracks', () => {
  const result = observeVisionFrame(
    createVisionSessionState(),
    frame(0, ['one', 'two', 'three', 'unexpected-fourth']),
  );

  assert.equal(result.state.phase, 'blocked');
  assert.equal(result.actions[0]?.type, 'BOARD_STATE_CHANGED');
});

test('requires clearing the board after a confirmed visit', () => {
  const session = markTurnConfirmed({
    phase: 'reviewing',
    proposals: [
      {
        slot: 1,
        trackId: 'one',
        candidates: [candidate(0.99, 3)],
        disposition: 'auto-accepted',
      },
    ],
    stableSignature: 'one',
    stableSinceMs: 0,
    lastVisibleDartCount: 1,
  });
  const cleared = observeVisionFrame(session, frame(1000, []));

  assert.equal(cleared.state.phase, 'watching');
  assert.equal(cleared.actions[0]?.type, 'DARTS_REMOVED');
});
