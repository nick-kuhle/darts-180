import type { DartZone } from '@darts-180/contracts';

import { isDouble, isMasterMultiplier, isZoneWellFormed } from './board';

export type X01EntryRule = 'straight' | 'double' | 'master';
export type X01ExitRule = 'straight' | 'double' | 'master';

export interface X01Settings {
  startingScore: number;
  inRule: X01EntryRule;
  outRule: X01ExitRule;
}

export interface X01PlayerState {
  playerId: string;
  remaining: number;
  /** Matters only for double-in/master-in games. */
  hasStarted: boolean;
  visits: number;
  dartsThrown: number;
  busts: number;
}

export interface X01State {
  kind: 'x01';
  settings: X01Settings;
  players: readonly X01PlayerState[];
  activePlayerIndex: number;
  turnNumber: number;
  winnerId?: string;
}

export interface X01DartResolution {
  dart: DartZone;
  counts: boolean;
  ignored: boolean;
  causedBust: boolean;
  completedLeg: boolean;
  remainingAfter: number;
}

export interface X01VisitResolution {
  state: X01State;
  darts: readonly X01DartResolution[];
  rawScore: number;
  turnScore: number;
  bust: boolean;
  checkout: boolean;
}

export function createX01State(
  playerIds: readonly string[],
  settings: Partial<X01Settings> = {},
): X01State {
  if (playerIds.length === 0) throw new Error('An X01 game needs at least one player.');
  if (new Set(playerIds).size !== playerIds.length) throw new Error('Player IDs must be unique.');

  const resolved: X01Settings = {
    startingScore: settings.startingScore ?? 501,
    inRule: settings.inRule ?? 'straight',
    outRule: settings.outRule ?? 'double',
  };
  if (!Number.isInteger(resolved.startingScore) || resolved.startingScore < 2) {
    throw new Error('startingScore must be an integer of at least 2.');
  }

  return {
    kind: 'x01',
    settings: resolved,
    players: playerIds.map((playerId) => ({
      playerId,
      remaining: resolved.startingScore,
      hasStarted: resolved.inRule === 'straight',
      visits: 0,
      dartsThrown: 0,
      busts: 0,
    })),
    activePlayerIndex: 0,
    turnNumber: 1,
  };
}

/**
 * Resolves a confirmed visit atomically. A busted visit restores the score and in-status from the
 * first dart of that visit. Darts after a bust/checkout are marked ignored because a legal player
 * should not throw them, but retaining them in the result makes malformed input auditable.
 */
export function applyX01Visit(
  state: X01State,
  playerId: string,
  darts: readonly DartZone[],
): X01VisitResolution {
  if (state.winnerId !== undefined) throw new Error('The leg is already complete.');
  if (darts.length < 1 || darts.length > 3) throw new Error('A visit contains one to three darts.');

  const active = state.players[state.activePlayerIndex];
  if (active === undefined || active.playerId !== playerId) {
    throw new Error(`It is not ${playerId}'s turn.`);
  }
  if (!darts.every(isZoneWellFormed)) throw new Error('Visit contains an invalid dart zone.');

  const originalRemaining = active.remaining;
  const originalStarted = active.hasStarted;
  let remaining = active.remaining;
  let hasStarted = active.hasStarted;
  let rawScore = 0;
  let bust = false;
  let checkout = false;
  let terminal = false;
  let processedDarts = 0;
  const resolutions: X01DartResolution[] = [];

  for (const dart of darts) {
    if (terminal) {
      resolutions.push({
        dart,
        counts: false,
        ignored: true,
        causedBust: false,
        completedLeg: false,
        remainingAfter: remaining,
      });
      continue;
    }

    processedDarts += 1;
    rawScore += dart.score;

    if (!hasStarted && !qualifiesForEntry(dart, state.settings.inRule)) {
      resolutions.push({
        dart,
        counts: false,
        ignored: false,
        causedBust: false,
        completedLeg: false,
        remainingAfter: remaining,
      });
      continue;
    }

    hasStarted = true;
    const proposedRemaining = remaining - dart.score;
    const result = evaluateRemaining(proposedRemaining, dart, state.settings.outRule);

    if (result === 'bust') {
      bust = true;
      terminal = true;
      remaining = originalRemaining;
      hasStarted = originalStarted;
      resolutions.push({
        dart,
        counts: false,
        ignored: false,
        causedBust: true,
        completedLeg: false,
        remainingAfter: remaining,
      });
      continue;
    }

    remaining = proposedRemaining;
    if (result === 'checkout') {
      checkout = true;
      terminal = true;
      resolutions.push({
        dart,
        counts: true,
        ignored: false,
        causedBust: false,
        completedLeg: true,
        remainingAfter: remaining,
      });
      continue;
    }

    resolutions.push({
      dart,
      counts: true,
      ignored: false,
      causedBust: false,
      completedLeg: false,
      remainingAfter: remaining,
    });
  }

  const updatedPlayer: X01PlayerState = {
    ...active,
    remaining,
    hasStarted,
    visits: active.visits + 1,
    dartsThrown: active.dartsThrown + processedDarts,
    busts: active.busts + (bust ? 1 : 0),
  };
  const players = state.players.map((player, index) =>
    index === state.activePlayerIndex ? updatedPlayer : player,
  );
  const nextActivePlayerIndex = checkout
    ? state.activePlayerIndex
    : (state.activePlayerIndex + 1) % state.players.length;
  const nextState: X01State = {
    ...state,
    players,
    activePlayerIndex: nextActivePlayerIndex,
    turnNumber: state.turnNumber + (checkout ? 0 : 1),
    ...(checkout ? { winnerId: playerId } : {}),
  };

  return {
    state: nextState,
    darts: resolutions,
    rawScore,
    turnScore: bust ? 0 : originalRemaining - remaining,
    bust,
    checkout,
  };
}

function qualifiesForEntry(dart: DartZone, rule: X01EntryRule): boolean {
  if (rule === 'straight') return true;
  if (rule === 'double') return isDouble(dart);
  return isMasterMultiplier(dart);
}

function qualifiesForExit(dart: DartZone, rule: X01ExitRule): boolean {
  if (rule === 'straight') return true;
  if (rule === 'double') return isDouble(dart);
  return isMasterMultiplier(dart);
}

function evaluateRemaining(
  proposedRemaining: number,
  dart: DartZone,
  outRule: X01ExitRule,
): 'continue' | 'bust' | 'checkout' {
  if (proposedRemaining < 0) return 'bust';
  if (proposedRemaining === 0) return qualifiesForExit(dart, outRule) ? 'checkout' : 'bust';
  // With double/master out, one cannot be finished by a legal final dart.
  if (proposedRemaining === 1 && outRule !== 'straight') return 'bust';
  return 'continue';
}
