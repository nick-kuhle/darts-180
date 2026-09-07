import type { DartZone } from '@darts-180/contracts';

import { isZoneWellFormed } from './board';

export const CRICKET_TARGETS = [20, 19, 18, 17, 16, 15, 'BULL'] as const;
export type CricketTarget = (typeof CRICKET_TARGETS)[number];
export type CricketMarks = Readonly<Record<CricketTarget, number>>;

export interface CricketPlayerState {
  playerId: string;
  marks: CricketMarks;
  points: number;
  visits: number;
}

export interface CricketState {
  kind: 'cricket';
  players: readonly CricketPlayerState[];
  activePlayerIndex: number;
  turnNumber: number;
  winnerId?: string;
}

export interface CricketDartResolution {
  dart: DartZone;
  target: CricketTarget | null;
  marksAdded: number;
  scoringMarks: number;
  pointsAdded: number;
}

export interface CricketVisitResolution {
  state: CricketState;
  darts: readonly CricketDartResolution[];
  pointsAdded: number;
  winnerId?: string;
}

export function createCricketState(playerIds: readonly string[]): CricketState {
  if (playerIds.length === 0) throw new Error('A Cricket game needs at least one player.');
  if (new Set(playerIds).size !== playerIds.length) throw new Error('Player IDs must be unique.');

  return {
    kind: 'cricket',
    players: playerIds.map((playerId) => ({ playerId, marks: emptyMarks(), points: 0, visits: 0 })),
    activePlayerIndex: 0,
    turnNumber: 1,
  };
}

export function applyCricketVisit(
  state: CricketState,
  playerId: string,
  darts: readonly DartZone[],
): CricketVisitResolution {
  if (state.winnerId !== undefined) throw new Error('The game is already complete.');
  if (darts.length < 1 || darts.length > 3) throw new Error('A visit contains one to three darts.');
  if (!darts.every(isZoneWellFormed)) throw new Error('Visit contains an invalid dart zone.');

  const active = state.players[state.activePlayerIndex];
  if (active === undefined || active.playerId !== playerId) {
    throw new Error(`It is not ${playerId}'s turn.`);
  }

  let marks: Record<CricketTarget, number> = { ...active.marks };
  let points = active.points;
  const resolutions: CricketDartResolution[] = [];

  for (const dart of darts) {
    const targetAndHits = cricketTargetAndHits(dart);
    if (targetAndHits === null) {
      resolutions.push({ dart, target: null, marksAdded: 0, scoringMarks: 0, pointsAdded: 0 });
      continue;
    }

    const { target, hits, pointValue } = targetAndHits;
    const existingMarks = marks[target];
    const marksAdded = Math.min(3 - existingMarks, hits);
    const scoringMarks = Math.max(0, hits - marksAdded);
    const canScore = state.players.some(
      (opponent, index) => index !== state.activePlayerIndex && opponent.marks[target] < 3,
    );
    const pointsAdded = canScore ? scoringMarks * pointValue : 0;

    marks = { ...marks, [target]: Math.min(3, existingMarks + hits) };
    points += pointsAdded;
    resolutions.push({ dart, target, marksAdded, scoringMarks, pointsAdded });
  }

  const updated: CricketPlayerState = {
    ...active,
    marks,
    points,
    visits: active.visits + 1,
  };
  const players = state.players.map((player, index) =>
    index === state.activePlayerIndex ? updated : player,
  );
  const winnerId = winningPlayerId(players);
  const nextState: CricketState = {
    ...state,
    players,
    activePlayerIndex:
      winnerId === undefined
        ? (state.activePlayerIndex + 1) % state.players.length
        : state.activePlayerIndex,
    turnNumber: state.turnNumber + (winnerId === undefined ? 1 : 0),
    ...(winnerId === undefined ? {} : { winnerId }),
  };

  return {
    state: nextState,
    darts: resolutions,
    pointsAdded: points - active.points,
    ...(winnerId === undefined ? {} : { winnerId }),
  };
}

export function cricketTargetAndHits(
  dart: DartZone,
): Readonly<{ target: CricketTarget; hits: number; pointValue: number }> | null {
  if (dart.ring === 'IB') return { target: 'BULL', hits: 2, pointValue: 25 };
  if (dart.ring === 'OB') return { target: 'BULL', hits: 1, pointValue: 25 };
  if (dart.segment === null || dart.segment < 15 || dart.segment > 20) return null;

  const hits = dart.ring === 'T' ? 3 : dart.ring === 'D' ? 2 : dart.ring === 'S' ? 1 : 0;
  return hits === 0
    ? null
    : { target: dart.segment as CricketTarget, hits, pointValue: dart.segment };
}

export function isCricketClosed(player: CricketPlayerState): boolean {
  return CRICKET_TARGETS.every((target) => player.marks[target] >= 3);
}

export function winningPlayerId(players: readonly CricketPlayerState[]): string | undefined {
  for (const player of players) {
    if (!isCricketClosed(player)) continue;
    if (players.every((opponent) => player.points >= opponent.points)) return player.playerId;
  }
  return undefined;
}

function emptyMarks(): Record<CricketTarget, number> {
  return {
    20: 0,
    19: 0,
    18: 0,
    17: 0,
    16: 0,
    15: 0,
    BULL: 0,
  };
}
