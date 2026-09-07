import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import type { GameEventStore } from './store';
import { InMemoryGameEventStore } from './store';
import { appendEventRequestSchema, createGameRequestSchema, parseGameEvent } from './schemas';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

interface GameParams {
  gameId: string;
}

interface EventsQuery {
  after?: string;
}

export async function buildServer(
  store: GameEventStore = new InMemoryGameEventStore(),
): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.DARTS180_ENV !== 'test' });

  await app.register(cors, {
    // Restrict this in production to the mobile deep-link/web app origins. Local dev stays easy.
    origin: process.env.DARTS180_CORS_ORIGIN?.split(',') ?? true,
    methods: ['GET', 'POST', 'OPTIONS'],
  });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'INVALID_REQUEST',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    if (error instanceof Error && error.message === 'GAME_NOT_FOUND') {
      return reply.status(404).send({ error: 'GAME_NOT_FOUND' });
    }
    if (error instanceof Error && error.message === 'GAME_ID_MISMATCH') {
      return reply.status(409).send({ error: 'GAME_ID_MISMATCH' });
    }
    app.log.error(error);
    return reply.status(500).send({ error: 'INTERNAL_ERROR' });
  });

  app.get('/healthz', async () => ({ ok: true, service: 'darts-180-api', version: '0.1.0' }));

  app.post('/v1/games', async (request, reply) => {
    const input = createGameRequestSchema.parse(request.body);
    const game = store.create(input);
    return reply.status(201).send(game);
  });

  app.get<{ Params: GameParams }>('/v1/games/:gameId', async (request, reply) => {
    const game = store.get(request.params.gameId);
    if (game === undefined) return reply.status(404).send({ error: 'GAME_NOT_FOUND' });
    return reply.send(game);
  });

  app.get<{ Params: GameParams; Querystring: EventsQuery }>(
    '/v1/games/:gameId/events',
    async (request, reply) => {
      const after = request.query.after === undefined ? 0 : Number(request.query.after);
      if (!Number.isSafeInteger(after) || after < 0) {
        return reply.status(400).send({ error: 'INVALID_AFTER_SEQUENCE' });
      }
      const events = store.list(request.params.gameId, after);
      return reply.send({ gameId: request.params.gameId, after, events });
    },
  );

  app.post<{ Params: GameParams }>('/v1/games/:gameId/events', async (request, reply) => {
    const input = appendEventRequestSchema.parse(request.body);
    const envelope = store.append(
      request.params.gameId,
      input.idempotencyKey,
      parseGameEvent(input.event),
    );
    return reply.status(201).send(envelope);
  });

  app.get<{ Params: GameParams }>(
    '/v1/games/:gameId/live',
    { websocket: true },
    (socket, request) => {
      const gameId = request.params.gameId;
      if (store.get(gameId) === undefined) {
        socket.close(4404, 'Game not found');
        return;
      }

      // Attach handlers synchronously: fastify-websocket intentionally warns against awaiting here.
      const unsubscribe = store.subscribe(gameId, (event) => {
        // ws.OPEN is 1; use the numeric ready state so this adapter stays framework-neutral.
        if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'game.event', event }));
      });
      socket.send(JSON.stringify({ type: 'game.snapshot', game: store.get(gameId) }));
      socket.on('close', unsubscribe);
      socket.on('error', unsubscribe);
    },
  );

  return app;
}
