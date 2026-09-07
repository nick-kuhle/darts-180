import type {
  DartCorrectedEvent,
  DartEvent,
  DartZone,
  GameEvent,
  TurnConfirmedEvent,
} from '@darts-180/contracts';

import { isZoneWellFormed } from './board';
import {
  applyCricketVisit,
  createCricketState,
  type CricketState,
  type CricketVisitResolution,
} from './cricket';
import {
  applyX01Visit,
  createX01State,
  type X01Settings,
  type X01State,
  type X01VisitResolution,
} from './x01';

export type ProjectionIssueCode =
  | 'DUPLICATE_EVENT_ID'
  | 'DUPLICATE_TURN_CONFIRMATION'
  | 'CORRECTION_TARGET_NOT_FOUND'
  | 'CORRECTION_TARGET_NOT_DART'
  | 'UNCONFIRMED_VISIT'
  | 'INVALID_VISIT_DART_COUNT'
  | 'INVALID_VISIT_DART_INDICES'
  | 'INVALID_ZONE'
  | 'RULES_REJECTED_VISIT'
  | 'EVENT_AFTER_GAME_COMPLETE';

export interface ProjectionIssue {
  code: ProjectionIssueCode;
  message: string;
  eventId?: string;
  visitId?: string;
}

export interface EffectiveDart {
  event: DartEvent;
  zone: DartZone;
  correction?: DartCorrectedEvent;
}

export interface ConfirmedVisit {
  confirmation: TurnConfirmedEvent;
  darts: readonly EffectiveDart[];
}

export interface EventProjection<TState, TVisitResolution> {
  state: TState;
  visits: readonly Readonly<{ visit: ConfirmedVisit; resolution: TVisitResolution }>[];
  issues: readonly ProjectionIssue[];
}

export interface ProjectX01EventsInput {
  playerIds: readonly string[];
  settings?: Partial<X01Settings>;
  events: readonly GameEvent[];
}

export interface ProjectCricketEventsInput {
  playerIds: readonly string[];
  events: readonly GameEvent[];
}

/**
 * Deterministically rebuilds X01 state from ordered immutable events. A correction that appears
 * after its turn confirmation still changes the effective historical dart on rebuild; nothing is
 * mutated in the event log.
 */
export function projectX01Events(
  input: ProjectX01EventsInput,
): EventProjection<X01State, X01VisitResolution> {
  const initialState = createX01State(input.playerIds, input.settings);
  return projectConfirmedVisits({
    events: input.events,
    initialState,
    applyVisit: (state, visit) =>
      applyX01Visit(
        state,
        visit.confirmation.playerId,
        visit.darts.map((dart) => dart.zone),
      ),
  });
}

/** Deterministically rebuilds standard Cricket state from ordered immutable events. */
export function projectCricketEvents(
  input: ProjectCricketEventsInput,
): EventProjection<CricketState, CricketVisitResolution> {
  const initialState = createCricketState(input.playerIds);
  return projectConfirmedVisits({
    events: input.events,
    initialState,
    applyVisit: (state, visit) =>
      applyCricketVisit(
        state,
        visit.confirmation.playerId,
        visit.darts.map((dart) => dart.zone),
      ),
  });
}

function projectConfirmedVisits<TState extends { winnerId?: string }, TVisitResolution>(
  input: Readonly<{
    events: readonly GameEvent[];
    initialState: TState;
    applyVisit: (state: TState, visit: ConfirmedVisit) => TVisitResolution & { state: TState };
  }>,
): EventProjection<TState, TVisitResolution> {
  const collected = collectConfirmedVisits(input.events);
  const issues = [...collected.issues];
  let state = input.initialState;
  const visits: Array<Readonly<{ visit: ConfirmedVisit; resolution: TVisitResolution }>> = [];

  for (const visit of collected.visits) {
    if (state.winnerId !== undefined) {
      issues.push(
        issue(
          'EVENT_AFTER_GAME_COMPLETE',
          'A confirmed visit appears after the game was already complete.',
          visit.confirmation,
        ),
      );
      continue;
    }

    try {
      const resolution = input.applyVisit(state, visit);
      state = resolution.state;
      visits.push({ visit, resolution });
    } catch (error) {
      issues.push(
        issue(
          'RULES_REJECTED_VISIT',
          error instanceof Error ? error.message : 'Rules engine rejected the visit.',
          visit.confirmation,
        ),
      );
    }
  }

  return { state, visits, issues };
}

/**
 * Produces complete, validated visits from an already sequence-ordered event stream. The API is
 * intentionally tolerant of in-flight unconfirmed dart events: it reports them but does not
 * apply them to official game state.
 */
export function collectConfirmedVisits(events: readonly GameEvent[]): Readonly<{
  visits: readonly ConfirmedVisit[];
  issues: readonly ProjectionIssue[];
}> {
  const issues: ProjectionIssue[] = [];
  const dartById = new Map<string, DartEvent>();
  const correctedZoneByDartId = new Map<string, DartCorrectedEvent>();
  const confirmations: TurnConfirmedEvent[] = [];
  const seenEventIds = new Set<string>();

  for (const event of events) {
    if (seenEventIds.has(event.eventId)) {
      issues.push(issue('DUPLICATE_EVENT_ID', 'An event ID appears more than once.', event));
      continue;
    }
    seenEventIds.add(event.eventId);

    if (event.type === 'dart.recorded') {
      dartById.set(event.eventId, event);
      continue;
    }
    if (event.type === 'dart.corrected') {
      const target = dartById.get(event.replacesEventId);
      if (target === undefined) {
        issues.push(
          issue(
            'CORRECTION_TARGET_NOT_FOUND',
            'Correction refers to a dart event that is not present.',
            event,
          ),
        );
      } else if (!isZoneWellFormed(event.correctedZone)) {
        issues.push(issue('INVALID_ZONE', 'Correction contains an invalid dart zone.', event));
      } else {
        correctedZoneByDartId.set(event.replacesEventId, event);
      }
      continue;
    }
    confirmations.push(event);
  }

  const dartEventsByVisit = new Map<string, DartEvent[]>();
  for (const dart of dartById.values()) {
    const group = dartEventsByVisit.get(dart.visitId) ?? [];
    group.push(dart);
    dartEventsByVisit.set(dart.visitId, group);
  }

  const confirmationByVisit = new Map<string, TurnConfirmedEvent>();
  for (const confirmation of confirmations) {
    if (confirmationByVisit.has(confirmation.visitId)) {
      issues.push(
        issue(
          'DUPLICATE_TURN_CONFIRMATION',
          'A visit has more than one turn confirmation.',
          confirmation,
        ),
      );
      continue;
    }
    confirmationByVisit.set(confirmation.visitId, confirmation);
  }

  for (const visitId of dartEventsByVisit.keys()) {
    if (!confirmationByVisit.has(visitId)) {
      issues.push({
        code: 'UNCONFIRMED_VISIT',
        message: 'Darts exist for a visit that has not been confirmed yet.',
        visitId,
      });
    }
  }

  const visits: ConfirmedVisit[] = [];
  for (const confirmation of confirmations) {
    // Ignore duplicate confirmation after recording the deterministic issue above.
    if (confirmationByVisit.get(confirmation.visitId)?.eventId !== confirmation.eventId) continue;
    const dartEvents = dartEventsByVisit.get(confirmation.visitId) ?? [];
    const validated = validateVisit(confirmation, dartEvents, correctedZoneByDartId, issues);
    if (validated !== undefined) visits.push(validated);
  }

  return { visits, issues };
}

function validateVisit(
  confirmation: TurnConfirmedEvent,
  dartEvents: readonly DartEvent[],
  correctedZoneByDartId: ReadonlyMap<string, DartCorrectedEvent>,
  issues: ProjectionIssue[],
): ConfirmedVisit | undefined {
  if (dartEvents.length !== confirmation.dartCount) {
    issues.push(
      issue(
        'INVALID_VISIT_DART_COUNT',
        `Turn confirmation declares ${confirmation.dartCount} dart(s), but ${dartEvents.length} dart event(s) exist.`,
        confirmation,
      ),
    );
    return undefined;
  }
  if (dartEvents.some((dart) => dart.playerId !== confirmation.playerId)) {
    issues.push(
      issue(
        'RULES_REJECTED_VISIT',
        'All darts in a visit must belong to the confirming player.',
        confirmation,
      ),
    );
    return undefined;
  }

  const sorted = [...dartEvents].sort((left, right) => left.dartIndex - right.dartIndex);
  const indexes = sorted.map((dart) => dart.dartIndex);
  const expectedIndexes = Array.from({ length: confirmation.dartCount }, (_, index) => index + 1);
  if (indexes.some((index, position) => index !== expectedIndexes[position])) {
    issues.push(
      issue(
        'INVALID_VISIT_DART_INDICES',
        'Dart indexes must be contiguous and start at 1 for a confirmed visit.',
        confirmation,
      ),
    );
    return undefined;
  }

  const darts: EffectiveDart[] = [];
  for (const event of sorted) {
    const correction = correctedZoneByDartId.get(event.eventId);
    const zone = correction?.correctedZone ?? event.zone;
    if (!isZoneWellFormed(zone)) {
      issues.push(issue('INVALID_ZONE', 'A dart event contains an invalid dart zone.', event));
      return undefined;
    }
    darts.push({ event, zone, ...(correction === undefined ? {} : { correction }) });
  }
  return { confirmation, darts };
}

function issue(
  code: ProjectionIssueCode,
  message: string,
  event: Readonly<{ eventId: string; visitId?: string }>,
): ProjectionIssue {
  return {
    code,
    message,
    eventId: event.eventId,
    ...(event.visitId === undefined ? {} : { visitId: event.visitId }),
  };
}
