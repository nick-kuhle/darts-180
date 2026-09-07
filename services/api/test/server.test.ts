import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { buildServer } from '../src/server';

test('creates a game, appends an idempotent event, and returns a snapshot', async (t) => {
  process.env.DARTS180_ENV = 'test';
  const app = await buildServer();
  t.after(() => app.close());

  const create = await app.inject({
    method: 'POST',
    url: '/v1/games',
    payload: { kind: 'x01', playerIds: ['ada', 'bea'], settings: { startingScore: 501 } },
  });
  assert.equal(create.statusCode, 201);
  const game = create.json() as {
    gameId: string;
    sequence: number;
    state: { projection: { players: Array<{ remaining: number }> } };
  };
  assert.equal(game.sequence, 0);
  assert.equal(game.state.projection.players[0]?.remaining, 501);

  const now = new Date().toISOString();
  const event = {
    type: 'dart.recorded',
    schemaVersion: 1,
    eventId: randomUUID(),
    gameId: game.gameId,
    visitId: randomUUID(),
    playerId: 'ada',
    dartIndex: 1,
    zone: { ring: 'T', segment: 20, score: 60 },
    source: 'auto',
    occurredAt: now,
    recordedAt: now,
  };
  const idempotencyKey = randomUUID();
  const append = await app.inject({
    method: 'POST',
    url: `/v1/games/${game.gameId}/events`,
    payload: { idempotencyKey, event },
  });
  assert.equal(append.statusCode, 201);
  assert.equal((append.json() as { sequence: number }).sequence, 1);

  const replay = await app.inject({
    method: 'POST',
    url: `/v1/games/${game.gameId}/events`,
    payload: { idempotencyKey, event },
  });
  assert.equal((replay.json() as { sequence: number }).sequence, 1);

  const confirmation = await app.inject({
    method: 'POST',
    url: `/v1/games/${game.gameId}/events`,
    payload: {
      idempotencyKey: randomUUID(),
      event: {
        type: 'turn.confirmed',
        schemaVersion: 1,
        eventId: randomUUID(),
        gameId: game.gameId,
        visitId: event.visitId,
        playerId: 'ada',
        dartCount: 1,
        occurredAt: now,
      },
    },
  });
  assert.equal(confirmation.statusCode, 201);
  assert.equal((confirmation.json() as { sequence: number }).sequence, 2);

  const snapshot = await app.inject({ method: 'GET', url: `/v1/games/${game.gameId}` });
  assert.equal(snapshot.statusCode, 200);
  const current = snapshot.json() as {
    sequence: number;
    state: { projection: { players: Array<{ remaining: number }> }; projectionIssues: unknown[] };
  };
  assert.equal(current.sequence, 2);
  assert.equal(current.state.projection.players[0]?.remaining, 441);
  assert.deepEqual(current.state.projectionIssues, []);

  const catchUp = await app.inject({
    method: 'GET',
    url: `/v1/games/${game.gameId}/events?after=1`,
  });
  assert.equal(catchUp.statusCode, 200);
  const events = catchUp.json() as { after: number; events: Array<{ sequence: number }> };
  assert.equal(events.after, 1);
  assert.deepEqual(
    events.events.map((item) => item.sequence),
    [2],
  );
});

test('rejects malformed dart zones at the API boundary', async (t) => {
  process.env.DARTS180_ENV = 'test';
  const app = await buildServer();
  t.after(() => app.close());

  const create = await app.inject({
    method: 'POST',
    url: '/v1/games',
    payload: { kind: 'x01', playerIds: ['ada'], settings: {} },
  });
  const game = create.json() as { gameId: string };
  const now = new Date().toISOString();
  const response = await app.inject({
    method: 'POST',
    url: `/v1/games/${game.gameId}/events`,
    payload: {
      idempotencyKey: randomUUID(),
      event: {
        type: 'dart.recorded',
        schemaVersion: 1,
        eventId: randomUUID(),
        gameId: game.gameId,
        visitId: randomUUID(),
        playerId: 'ada',
        dartIndex: 1,
        zone: { ring: 'D', segment: 20, score: 20 },
        source: 'manual',
        occurredAt: now,
        recordedAt: now,
      },
    },
  });
  assert.equal(response.statusCode, 400);

  const invalidAfter = await app.inject({
    method: 'GET',
    url: `/v1/games/${game.gameId}/events?after=not-a-sequence`,
  });
  assert.equal(invalidAfter.statusCode, 400);
});
