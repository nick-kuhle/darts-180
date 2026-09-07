import { randomUUID } from 'node:crypto';

import type {
  CreateGameRequest,
  EventEnvelope,
  GameEvent,
  GameSnapshot,
} from '@darts-180/contracts';
import {
  projectCricketEvents,
  projectX01Events,
  type X01EntryRule,
  type X01ExitRule,
} from '@darts-180/rules';

export interface GameEventStore {
  create(input: CreateGameRequest): GameSnapshot;
  get(gameId: string): GameSnapshot | undefined;
  list(gameId: string, afterSequence?: number): readonly EventEnvelope[];
  append(gameId: string, idempotencyKey: string, event: GameEvent): EventEnvelope;
  subscribe(gameId: string, listener: (event: EventEnvelope) => void): () => void;
}

interface GameRecord {
  input: CreateGameRequest;
  snapshot: GameSnapshot;
  events: EventEnvelope[];
  idempotency: Map<string, EventEnvelope>;
  listeners: Set<(event: EventEnvelope) => void>;
}

/**
 * A deliberately small adapter used for local development and endpoint tests.
 * Replace only this port with Postgres/EventStore in Phase 2; route handlers stay independent of
 * a database driver. Unlike a generic demo store, it already projects X01 and Cricket via the
 * same deterministic rules code used by clients.
 */
export class InMemoryGameEventStore implements GameEventStore {
  private readonly games = new Map<string, GameRecord>();

  create(input: CreateGameRequest): GameSnapshot {
    const gameId = randomUUID();
    const now = new Date().toISOString();
    const snapshot: GameSnapshot = {
      gameId,
      kind: input.kind,
      sequence: 0,
      state: snapshotState(input, []),
      updatedAt: now,
    };
    this.games.set(gameId, {
      input,
      snapshot,
      events: [],
      idempotency: new Map(),
      listeners: new Set(),
    });
    return snapshot;
  }

  get(gameId: string): GameSnapshot | undefined {
    return this.games.get(gameId)?.snapshot;
  }

  list(gameId: string, afterSequence = 0): readonly EventEnvelope[] {
    const record = this.games.get(gameId);
    if (record === undefined) throw new Error('GAME_NOT_FOUND');
    return record.events.filter((event) => event.sequence > afterSequence);
  }

  append(gameId: string, idempotencyKey: string, event: GameEvent): EventEnvelope {
    const record = this.games.get(gameId);
    if (record === undefined) throw new Error('GAME_NOT_FOUND');
    if (event.gameId !== gameId) throw new Error('GAME_ID_MISMATCH');

    const existing = record.idempotency.get(idempotencyKey);
    if (existing !== undefined) return existing;

    const envelope: EventEnvelope = {
      gameId,
      sequence: record.snapshot.sequence + 1,
      idempotencyKey,
      event,
      acceptedAt: new Date().toISOString(),
    };
    const allEvents = [...record.events, envelope];
    record.events.push(envelope);
    record.idempotency.set(idempotencyKey, envelope);
    record.snapshot = {
      ...record.snapshot,
      sequence: envelope.sequence,
      updatedAt: envelope.acceptedAt,
      state: snapshotState(
        record.input,
        allEvents.map((candidate) => candidate.event),
      ),
    };
    for (const listener of record.listeners) listener(envelope);
    return envelope;
  }

  subscribe(gameId: string, listener: (event: EventEnvelope) => void): () => void {
    const record = this.games.get(gameId);
    if (record === undefined) throw new Error('GAME_NOT_FOUND');
    record.listeners.add(listener);
    return () => record.listeners.delete(listener);
  }
}

function snapshotState(
  input: CreateGameRequest,
  events: readonly GameEvent[],
): Record<string, unknown> {
  if (input.kind === 'x01') {
    const projection = projectX01Events({
      playerIds: input.playerIds,
      settings: asX01Settings(input.settings),
      events,
    });
    return {
      projection: projection.state,
      projectionIssues: projection.issues,
      projectionVersion: 'rules-0.1.0',
      eventCount: events.length,
    };
  }
  if (input.kind === 'cricket') {
    const projection = projectCricketEvents({ playerIds: input.playerIds, events });
    return {
      projection: projection.state,
      projectionIssues: projection.issues,
      projectionVersion: 'rules-0.1.0',
      eventCount: events.length,
    };
  }
  return {
    playerIds: [...input.playerIds],
    settings: input.settings,
    eventCount: events.length,
    projectionStatus: 'game-kind-projection-not-implemented-yet',
  };
}

function asX01Settings(settings: Record<string, unknown>): Readonly<{
  startingScore?: number;
  inRule?: X01EntryRule;
  outRule?: X01ExitRule;
}> {
  const startingScore = settings.startingScore;
  const inRule = settings.inRule;
  const outRule = settings.outRule;
  return {
    ...(typeof startingScore === 'number' ? { startingScore } : {}),
    ...(isEntryRule(inRule) ? { inRule } : {}),
    ...(isExitRule(outRule) ? { outRule } : {}),
  };
}

function isEntryRule(value: unknown): value is X01EntryRule {
  return value === 'straight' || value === 'double' || value === 'master';
}

function isExitRule(value: unknown): value is X01ExitRule {
  return value === 'straight' || value === 'double' || value === 'master';
}
