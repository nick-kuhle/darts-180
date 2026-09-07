import assert from 'node:assert/strict';
import test from 'node:test';

import { applyCricketVisit, createCricketState, makeZone } from '../src/index';

test('a treble closes an untouched Cricket number without scoring', () => {
  const state = createCricketState(['ada', 'bea']);
  const result = applyCricketVisit(state, 'ada', [makeZone('T', 20)]);

  assert.equal(result.state.players[0]?.marks[20], 3);
  assert.equal(result.pointsAdded, 0);
});

test('overflow marks score while an opponent remains open', () => {
  const state = createCricketState(['ada', 'bea']);
  const first = applyCricketVisit(state, 'ada', [makeZone('D', 20)]).state;
  // Beatrice's empty visit hands the turn back to Ada.
  const secondTurn = applyCricketVisit(first, 'bea', [makeZone('MISS')]).state;
  const result = applyCricketVisit(secondTurn, 'ada', [makeZone('D', 20)]);

  assert.equal(result.darts[0]?.marksAdded, 1);
  assert.equal(result.darts[0]?.scoringMarks, 1);
  assert.equal(result.pointsAdded, 20);
  assert.equal(result.state.players[0]?.points, 20);
});

test('does not score overflow once every opponent has closed the target', () => {
  const state = createCricketState(['ada', 'bea']);
  const withBeaClosed = {
    ...state,
    players: state.players.map((player) =>
      player.playerId === 'bea' ? { ...player, marks: { ...player.marks, 20: 3 } } : player,
    ),
  };
  const result = applyCricketVisit(withBeaClosed, 'ada', [makeZone('T', 20), makeZone('S', 20)]);

  assert.equal(result.state.players[0]?.marks[20], 3);
  assert.equal(result.pointsAdded, 0);
});

test('outer bull is one mark and inner bull is two marks', () => {
  const state = createCricketState(['ada', 'bea']);
  const result = applyCricketVisit(state, 'ada', [makeZone('OB'), makeZone('IB')]);

  assert.equal(result.state.players[0]?.marks.BULL, 3);
  assert.equal(result.pointsAdded, 0);
});

test('closing all targets requires no fewer points than every opponent to win', () => {
  const state = createCricketState(['ada', 'bea']);
  const closedAda = {
    ...state,
    players: state.players.map((player) =>
      player.playerId === 'ada'
        ? {
            ...player,
            marks: { 20: 3, 19: 3, 18: 3, 17: 3, 16: 3, 15: 3, BULL: 2 },
            points: 40,
          }
        : { ...player, points: 60 },
    ),
  };
  const noWin = applyCricketVisit(closedAda, 'ada', [makeZone('OB')]);
  assert.equal(noWin.winnerId, undefined);

  const tied = {
    ...closedAda,
    players: closedAda.players.map((player) =>
      player.playerId === 'bea' ? { ...player, points: 40 } : player,
    ),
  };
  const win = applyCricketVisit(tied, 'ada', [makeZone('OB')]);
  assert.equal(win.winnerId, 'ada');
});
