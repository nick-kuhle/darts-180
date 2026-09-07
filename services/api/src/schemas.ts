import type { CreateGameRequest, GameEvent } from '@darts-180/contracts';
import { isZoneWellFormed } from '@darts-180/rules';
import { z } from 'zod';

const zoneSchema = z
  .object({
    ring: z.enum(['S', 'D', 'T', 'IB', 'OB', 'MISS']),
    segment: z.number().int().min(1).max(20).nullable(),
    score: z.number().int().min(0).max(60),
  })
  .strict()
  .refine(isZoneWellFormed, { message: 'Zone ring, segment, and score disagree.' });

const rankedCandidateSchema = z
  .object({
    zone: zoneSchema,
    probability: z.number().min(0).max(1),
    wireMarginMm: z.number().min(0),
  })
  .strict();

const visionEvidenceSchema = z
  .object({
    modelVersion: z.string().min(1).max(128),
    calibrationId: z.string().min(1).max(128),
    boardPointMm: z.object({ xMm: z.number(), yMm: z.number() }).strict().optional(),
    confidence: z.number().min(0).max(1),
    candidates: z.array(rankedCandidateSchema).min(1).max(5),
    frameTimestampMs: z.number().int().nonnegative(),
    clipRef: z.string().min(1).max(512).optional(),
  })
  .strict();

const dartRecordedSchema = z
  .object({
    type: z.literal('dart.recorded'),
    schemaVersion: z.literal(1),
    eventId: z.string().uuid(),
    gameId: z.string().uuid(),
    visitId: z.string().uuid(),
    playerId: z.string().min(1).max(128),
    dartIndex: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    zone: zoneSchema,
    source: z.enum(['auto', 'corrected', 'manual', 'imported']),
    occurredAt: z.string().datetime({ offset: true }),
    recordedAt: z.string().datetime({ offset: true }),
    vision: visionEvidenceSchema.optional(),
  })
  .strict();

const turnConfirmedSchema = z
  .object({
    type: z.literal('turn.confirmed'),
    schemaVersion: z.literal(1),
    eventId: z.string().uuid(),
    gameId: z.string().uuid(),
    visitId: z.string().uuid(),
    playerId: z.string().min(1).max(128),
    dartCount: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    occurredAt: z.string().datetime({ offset: true }),
  })
  .strict();

const dartCorrectedSchema = z
  .object({
    type: z.literal('dart.corrected'),
    schemaVersion: z.literal(1),
    eventId: z.string().uuid(),
    gameId: z.string().uuid(),
    replacesEventId: z.string().uuid(),
    correctedZone: zoneSchema,
    reason: z.enum(['player-correction', 'referee-correction', 'sync-resolution']),
    occurredAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const gameEventSchema = z.discriminatedUnion('type', [
  dartRecordedSchema,
  turnConfirmedSchema,
  dartCorrectedSchema,
]);

export const createGameRequestSchema = z
  .object({
    kind: z.enum(['x01', 'cricket', 'count-up', 'around-the-clock']),
    playerIds: z.array(z.string().min(1).max(128)).min(1).max(16),
    settings: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()
  .refine((value) => new Set(value.playerIds).size === value.playerIds.length, {
    message: 'playerIds must be unique.',
    path: ['playerIds'],
  });

export const appendEventRequestSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    event: gameEventSchema,
  })
  .strict();

export function parseCreateGameRequest(input: unknown): CreateGameRequest {
  return createGameRequestSchema.parse(input);
}

export function parseGameEvent(input: unknown): GameEvent {
  return gameEventSchema.parse(input) as GameEvent;
}
