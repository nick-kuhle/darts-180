import assert from 'node:assert/strict';
import test from 'node:test';

import type { DartCorrectedEvent, DartEvent, TurnConfirmedEvent } from '@darts-180/contracts';

import { makeZone, projectCricketEvents, projectX01Events } from '../src/index';

const gameId = 'game-1';
const at = '2026-09-06T12:00:00.000Z';

function dart(
  eventId: string,
  visitId: string,
  playerId: string,
  dartIndex: 1 | 2 | 3,
  zone = makeZone('S', 20),
): DartEvent {
  return {
    type: 'dart.recorded',
    schemaVersion: 1,
    eventId,
    gameId,
    visitId,
    playerId,
    dartIndex,
    zone,
    source: 'manual',
    occurredAt: at,
    recordedAt: at,
  };
}

function confirm(
  eventId: string,
  visitId: string,
  playerId: string,
  dartCount: 1 | 2 | 3,
): TurnConfirmedEvent {
  return {
    type: 'turn.confirmed',
    schemaVersion: 1,
    eventId,
    gameId,
    visitId,
    playerId,
    dartCount,
    occurredAt: at,
  };
}

function correction(
  eventId: string,
  replacesEventId: string,
  correctedZone = makeZone('T', 20),
): DartCorrectedEvent {
  return {
    type: 'dart.corrected',
    schemaVersion: 1,
    eventId,
    gameId,
    replacesEventId,
    correctedZone,
    reason: 'player-correction',
    occurredAt: at,
  };
}

test('projects confirmed X01 visits in event order', () => {
  const projection = projectX01Events({
    playerIds: ['ada', 'bea'],
    events: [
      dart('d1', 'v1', 'ada', 1, makeZone('T', 20)),
      dart('d2', 'v1', 'ada', 2, makeZone('S', 20)),
      dart('d3', 'v1', 'ada', 3, makeZone('S', 20)),
      confirm('c1', 'v1', 'ada', 3),
    ],
  });

  assert.equal(projection.issues.length, 0);
  assert.equal(projection.visits.length, 1);
  assert.equal(projection.state.players[0]?.remaining, 401);
  assert.equal(projection.state.activePlayerIndex, 1);
});

test('replays a later correction without mutating the original dart', () => {
  const original = dart('d2', 'v1', 'ada', 2, makeZone('S', 20));
  const projection = projectX01Events({
    playerIds: ['ada'],
    events: [
      dart('d1', 'v1', 'ada', 1, makeZone('T', 20)),
      original,
      dart('d3', 'v1', 'ada', 3, makeZone('S', 20)),
      confirm('c1', 'v1', 'ada', 3),
      correction('fix-d2', 'd2'),
    ],
  });

  assert.equal(original.zone.score, 20);
  assert.equal(projection.state.players[0]?.remaining, 361);
  assert.equal(projection.visits[0]?.visit.darts[1]?.zone.score, 60);
});

test('does not score an unconfirmed visit', () => {
  const projection = projectX01Events({
    playerIds: ['ada'],
    events: [dart('d1', 'v1', 'ada', 1, makeZone('T', 20))],
  });

  assert.equal(projection.state.players[0]?.remaining, 501);
  assert.deepEqual(
    projection.issues.map((issue) => issue.code),
    ['UNCONFIRMED_VISIT'],
  );
});

test('rejects malformed confirmed visit indexes before applying rules', () => {
  const projection = projectX01Events({
    playerIds: ['ada'],
    events: [dart('d1', 'v1', 'ada', 1), dart('d2', 'v1', 'ada', 1), confirm('c1', 'v1', 'ada', 2)],
  });

  assert.equal(projection.state.players[0]?.remaining, 501);
  assert.deepEqual(
    projection.issues.map((issue) => issue.code),
    ['INVALID_VISIT_DART_INDICES'],
  );
});

test('projects Cricket marks and later correction deterministically', () => {
  const projection = projectCricketEvents({
    playerIds: ['ada', 'bea'],
    events: [
      dart('d1', 'v1', 'ada', 1, makeZone('T', 20)),
      dart('d2', 'v1', 'ada', 2, makeZone('OB')),
      dart('d3', 'v1', 'ada', 3, makeZone('OB')),
      confirm('c1', 'v1', 'ada', 3),
      correction('fix-d3', 'd3', makeZone('IB')),
    ],
  });

  assert.equal(projection.state.players[0]?.marks[20], 3);
  assert.equal(projection.state.players[0]?.marks.BULL, 3);
  assert.equal(projection.state.players[0]?.points, 0);
});

test('reports events after a completed leg rather than changing its winner', () => {
  const projection = projectX01Events({
    playerIds: ['ada'],
    settings: { startingScore: 40, outRule: 'double' },
    events: [
      dart('d1', 'v1', 'ada', 1, makeZone('D', 20)),
      confirm('c1', 'v1', 'ada', 1),
      dart('d2', 'v2', 'ada', 1, makeZone('S', 20)),
      confirm('c2', 'v2', 'ada', 1),
    ],
  });

  assert.equal(projection.state.winnerId, 'ada');
  assert.deepEqual(
    projection.issues.map((issue) => issue.code),
    ['EVENT_AFTER_GAME_COMPLETE'],
  );
});
