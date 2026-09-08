/**
 * Cross-platform, wire-format-safe contracts.
 *
 * These types deliberately contain no React Native, database, or ML framework imports. They are
 * the seam between mobile clients, the scoring rules, the native vision engine, and the API.
 */

export const RINGS = ['S', 'D', 'T', 'IB', 'OB', 'MISS'] as const;
export type Ring = (typeof RINGS)[number];

export const SCORING_SOURCES = ['auto', 'corrected', 'manual', 'imported'] as const;
export type ScoringSource = (typeof SCORING_SOURCES)[number];

export const GAME_KINDS = ['x01', 'cricket', 'count-up', 'around-the-clock'] as const;
export type GameKind = (typeof GAME_KINDS)[number];

/** A physical, canonical point on the board: x right, y down, origin at the bull centre. */
export interface BoardPointMm {
  xMm: number;
  yMm: number;
}

/**
 * A legal result on a standard steel-tip board. `segment` is null for bulls and a miss.
 * `score` is duplicated intentionally: it makes event payloads inspectable and lets validation
 * reject malformed client data at every boundary.
 */
export interface DartZone {
  ring: Ring;
  segment: number | null;
  score: number;
}

export interface RankedZoneCandidate {
  zone: DartZone;
  probability: number;
  /** Distance to the nearest scoring wire in canonical board millimetres. */
  wireMarginMm: number;
}

export interface VisionEvidence {
  modelVersion: string;
  calibrationId: string;
  boardPointMm?: BoardPointMm;
  confidence: number;
  candidates: readonly RankedZoneCandidate[];
  frameTimestampMs: number;
  /** Opaque, short-lived local or consented-upload clip reference; never a filesystem path. */
  clipRef?: string;
}

/** An immutable, user-confirmed dart. Raw model guesses are not game events. */
export interface DartEvent {
  type: 'dart.recorded';
  schemaVersion: 1;
  eventId: string;
  gameId: string;
  visitId: string;
  playerId: string;
  dartIndex: 1 | 2 | 3;
  zone: DartZone;
  source: ScoringSource;
  occurredAt: string;
  recordedAt: string;
  vision?: VisionEvidence;
}

/** A turn is committed after all available darts are reviewed, including a 1- or 2-dart finish. */
export interface TurnConfirmedEvent {
  type: 'turn.confirmed';
  schemaVersion: 1;
  eventId: string;
  gameId: string;
  visitId: string;
  playerId: string;
  dartCount: 1 | 2 | 3;
  occurredAt: string;
}

export interface DartCorrectedEvent {
  type: 'dart.corrected';
  schemaVersion: 1;
  eventId: string;
  gameId: string;
  replacesEventId: string;
  correctedZone: DartZone;
  reason: 'player-correction' | 'referee-correction' | 'sync-resolution';
  occurredAt: string;
}

export type GameEvent = DartEvent | TurnConfirmedEvent | DartCorrectedEvent;

export interface CameraPoseQuality {
  /** 0–1 score from the pose/quality model; not a score confidence. */
  overall: number;
  boardCoverage: number;
  sharpness: number;
  glareRisk: number;
  occlusionRisk: number;
  /** Absolute angle from board normal, estimated from the board pose. */
  offAxisDegrees: number;
  boardDiameterPixels: number;
  reasons: readonly string[];
}

export interface BoardCalibration {
  calibrationId: string;
  boardProfile: 'standard-steel-tip' | 'custom';
  createdAt: string;
  source: 'auto' | 'guided' | 'manual';
  /** Homography maps image pixel coordinates into canonical board millimetres. */
  imageToBoardHomography: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  quality: CameraPoseQuality;
}

export interface CreateGameRequest {
  kind: GameKind;
  playerIds: readonly string[];
  settings: Record<string, unknown>;
}

export interface EventEnvelope {
  gameId: string;
  sequence: number;
  idempotencyKey: string;
  event: GameEvent;
  acceptedAt: string;
}

export interface GameSnapshot {
  gameId: string;
  kind: GameKind;
  sequence: number;
  state: Record<string, unknown>;
  updatedAt: string;
}

export * from './vision.js';
