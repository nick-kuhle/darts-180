import type { CameraPoseQuality, RankedZoneCandidate } from '@darts-180/contracts';

export type VisionSessionPhase =
  'calibrating' | 'watching' | 'settling' | 'reviewing' | 'awaiting-removal' | 'blocked';

export interface VisionDartObservation {
  /** Stable detector track ID; native engine must keep it stable while a dart remains in board. */
  trackId: string;
  candidates: readonly RankedZoneCandidate[];
}

export interface VisionFrameObservation {
  atMs: number;
  quality: CameraPoseQuality;
  /** Darts visible in the current frame after native temporal association. */
  darts: readonly VisionDartObservation[];
}

export interface DartProposal {
  slot: 1 | 2 | 3;
  trackId: string;
  candidates: readonly RankedZoneCandidate[];
  disposition: 'auto-accepted' | 'needs-review';
}

export type VisionAction =
  | { type: 'QUALITY_BLOCKED'; reasons: readonly string[] }
  | { type: 'SETTLING_STARTED'; visibleDartCount: number }
  | { type: 'DART_PROPOSED'; proposal: DartProposal }
  | { type: 'TURN_READY_FOR_REVIEW'; proposals: readonly DartProposal[] }
  | { type: 'BOARD_STATE_CHANGED'; message: string }
  | { type: 'DARTS_REMOVED'; message: string };

export interface VisionSessionState {
  phase: VisionSessionPhase;
  proposals: readonly DartProposal[];
  stableSignature: string | null;
  stableSinceMs: number | null;
  lastVisibleDartCount: number;
}

export interface VisionSessionOptions {
  settleMs: number;
  minOverallQuality: number;
  minBoardDiameterPixels: number;
  maxOffAxisDegrees: number;
  autoAcceptProbability: number;
  minAutoAcceptWireMarginMm: number;
}

const DEFAULT_OPTIONS: VisionSessionOptions = {
  settleMs: 350,
  minOverallQuality: 0.7,
  minBoardDiameterPixels: 480,
  maxOffAxisDegrees: 55,
  autoAcceptProbability: 0.97,
  minAutoAcceptWireMarginMm: 1.5,
};

export function createVisionSessionState(): VisionSessionState {
  return {
    phase: 'calibrating',
    proposals: [],
    stableSignature: null,
    stableSinceMs: null,
    lastVisibleDartCount: 0,
  };
}

/**
 * Pure policy layer between a native frame processor and the review UI.
 *
 * It deliberately waits for a stable board state after impact; it does not decide where a dart
 * landed. This gives every platform the same conservative behavior and makes temporal policy
 * unit-testable without a camera or ML model.
 */
export function observeVisionFrame(
  state: VisionSessionState,
  frame: VisionFrameObservation,
  partialOptions: Partial<VisionSessionOptions> = {},
): Readonly<{ state: VisionSessionState; actions: readonly VisionAction[] }> {
  const options = { ...DEFAULT_OPTIONS, ...partialOptions };
  const qualityReasons = qualityFailureReasons(frame.quality, options);
  if (qualityReasons.length > 0) {
    return {
      state: {
        ...state,
        phase: 'blocked',
        stableSignature: null,
        stableSinceMs: null,
        lastVisibleDartCount: frame.darts.length,
      },
      actions: [{ type: 'QUALITY_BLOCKED', reasons: qualityReasons }],
    };
  }

  const sortedDarts = [...frame.darts].sort((a, b) => a.trackId.localeCompare(b.trackId));
  const signature = sortedDarts.map((dart) => dart.trackId).join('|');
  const actions: VisionAction[] = [];

  if (sortedDarts.length > 3) {
    return {
      state: {
        ...state,
        phase: 'blocked',
        stableSignature: null,
        stableSinceMs: null,
        lastVisibleDartCount: sortedDarts.length,
      },
      actions: [
        {
          type: 'BOARD_STATE_CHANGED',
          message: 'More than three dart tracks are visible. Review the visit manually.',
        },
      ],
    };
  }

  if (state.phase === 'awaiting-removal') {
    if (sortedDarts.length === 0) {
      return {
        state: {
          phase: 'watching',
          proposals: [],
          stableSignature: '',
          stableSinceMs: frame.atMs,
          lastVisibleDartCount: 0,
        },
        actions: [{ type: 'DARTS_REMOVED', message: 'Board cleared. Ready for the next visit.' }],
      };
    }
    return {
      state: { ...state, lastVisibleDartCount: sortedDarts.length },
      actions,
    };
  }

  const visibleTrackIds = new Set(sortedDarts.map((dart) => dart.trackId));
  const proposedTrackIds = new Set(state.proposals.map((proposal) => proposal.trackId));
  const aProposedDartDisappeared = state.proposals.some(
    (proposal) => !visibleTrackIds.has(proposal.trackId),
  );
  if (sortedDarts.length < state.proposals.length || aProposedDartDisappeared) {
    return {
      state: {
        ...state,
        phase: 'blocked',
        stableSignature: null,
        stableSinceMs: null,
        lastVisibleDartCount: sortedDarts.length,
      },
      actions: [
        {
          type: 'BOARD_STATE_CHANGED',
          message: 'A dart disappeared before the visit was confirmed. Review manually.',
        },
      ],
    };
  }

  if (signature !== state.stableSignature) {
    const nextPhase = sortedDarts.length === 0 ? 'watching' : 'settling';
    if (sortedDarts.length > 0) {
      actions.push({ type: 'SETTLING_STARTED', visibleDartCount: sortedDarts.length });
    }
    return {
      state: {
        ...state,
        phase: nextPhase,
        stableSignature: signature,
        stableSinceMs: frame.atMs,
        lastVisibleDartCount: sortedDarts.length,
      },
      actions,
    };
  }

  const stableForMs = frame.atMs - (state.stableSinceMs ?? frame.atMs);
  if (stableForMs < options.settleMs || sortedDarts.length <= state.proposals.length) {
    return {
      state: { ...state, lastVisibleDartCount: sortedDarts.length },
      actions,
    };
  }

  let proposals = [...state.proposals];
  const newlyVisibleDarts = sortedDarts.filter((dart) => !proposedTrackIds.has(dart.trackId));
  for (const dart of newlyVisibleDarts.slice(0, 3 - proposals.length)) {
    const slot = (proposals.length + 1) as 1 | 2 | 3;
    const proposal = toProposal(slot, dart, options);
    proposals = [...proposals, proposal];
    actions.push({ type: 'DART_PROPOSED', proposal });
  }

  const phase: VisionSessionPhase = proposals.length === 3 ? 'reviewing' : 'watching';
  if (proposals.length === 3) actions.push({ type: 'TURN_READY_FOR_REVIEW', proposals });

  return {
    state: {
      ...state,
      phase,
      proposals,
      lastVisibleDartCount: sortedDarts.length,
    },
    actions,
  };
}

export function markTurnConfirmed(state: VisionSessionState): VisionSessionState {
  if (state.proposals.length === 0) throw new Error('Cannot confirm an empty visit.');
  return { ...state, phase: 'awaiting-removal' };
}

function toProposal(
  slot: 1 | 2 | 3,
  dart: VisionDartObservation,
  options: VisionSessionOptions,
): DartProposal {
  const best = dart.candidates[0];
  if (best === undefined) throw new Error(`Track ${dart.trackId} has no scored candidates.`);
  const disposition =
    best.probability >= options.autoAcceptProbability &&
    best.wireMarginMm >= options.minAutoAcceptWireMarginMm
      ? 'auto-accepted'
      : 'needs-review';
  return { slot, trackId: dart.trackId, candidates: dart.candidates, disposition };
}

function qualityFailureReasons(
  quality: CameraPoseQuality,
  options: VisionSessionOptions,
): string[] {
  const reasons: string[] = [];
  if (quality.overall < options.minOverallQuality) reasons.push('Improve lighting or focus.');
  if (quality.boardDiameterPixels < options.minBoardDiameterPixels) {
    reasons.push('Move the camera closer so the board fills more of the frame.');
  }
  if (quality.offAxisDegrees > options.maxOffAxisDegrees) {
    reasons.push('Move closer to the board centerline; the view is too oblique.');
  }
  if (quality.occlusionRisk > 0.7) reasons.push('Clear any obstruction between camera and board.');
  return reasons;
}
