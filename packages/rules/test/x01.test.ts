import assert from 'node:assert/strict';
import test from 'node:test';

import { applyX01Visit, createX01State, makeZone } from '../src/index';

test('double-out bust restores the turn-start score', () => {
  const state = createX01State(['ada', 'bea'], { startingScore: 40, outRule: 'double' });
  const result = applyX01Visit(state, 'ada', [makeZone('S', 20), makeZone('S', 20)]);

  assert.equal(result.bust, true);
  assert.equal(result.turnScore, 0);
  assert.equal(result.state.players[0]?.remaining, 40);
  assert.equal(result.state.players[0]?.busts, 1);
  assert.equal(result.state.activePlayerIndex, 1);
  assert.equal(result.darts[1]?.causedBust, true);
});

test('double-out accepts a legal finishing double', () => {
  const state = createX01State(['ada'], { startingScore: 40, outRule: 'double' });
  const result = applyX01Visit(state, 'ada', [makeZone('D', 20)]);

  assert.equal(result.checkout, true);
  assert.equal(result.state.winnerId, 'ada');
  assert.equal(result.state.players[0]?.remaining, 0);
});

test('double-in waits for a legal entry dart', () => {
  const state = createX01State(['ada'], {
    startingScore: 101,
    inRule: 'double',
    outRule: 'straight',
  });
  const result = applyX01Visit(state, 'ada', [makeZone('T', 20), makeZone('D', 20)]);

  assert.equal(result.darts[0]?.counts, false);
  assert.equal(result.darts[1]?.counts, true);
  assert.equal(result.state.players[0]?.remaining, 61);
  assert.equal(result.state.players[0]?.hasStarted, true);
});

test('a double-in bust restores both score and entry state', () => {
  const state = createX01State(['ada'], {
    startingScore: 80,
    inRule: 'double',
    outRule: 'double',
  });
  const result = applyX01Visit(state, 'ada', [makeZone('D', 20), makeZone('T', 20)]);

  assert.equal(result.bust, true);
  assert.equal(result.state.players[0]?.remaining, 80);
  assert.equal(result.state.players[0]?.hasStarted, false);
});

test('master-out permits a treble as a finishing dart', () => {
  const state = createX01State(['ada'], { startingScore: 60, outRule: 'master' });
  const result = applyX01Visit(state, 'ada', [makeZone('T', 20)]);

  assert.equal(result.checkout, true);
  assert.equal(result.state.winnerId, 'ada');
});

test('darts supplied after a checkout are auditable but ignored', () => {
  const state = createX01State(['ada'], { startingScore: 40, outRule: 'double' });
  const result = applyX01Visit(state, 'ada', [makeZone('D', 20), makeZone('T', 20)]);

  assert.equal(result.darts[0]?.completedLeg, true);
  assert.equal(result.darts[1]?.ignored, true);
  assert.equal(result.state.players[0]?.dartsThrown, 1);
});

test('rejects an out-of-turn visit', () => {
  const state = createX01State(['ada', 'bea']);
  assert.throws(() => applyX01Visit(state, 'bea', [makeZone('S', 20)]), /not bea's turn/);
});
