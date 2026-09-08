import type { DifferenceStatus } from './cameraScoring';

/**
 * Minimal temporal state used while Camera Play proves that its clear-board reference is steady.
 * It deliberately treats broad motion differently from a localized dart-like change: after two
 * consecutive broad comparisons the automatic board map may be refreshed, while a possible dart
 * remains held until the player clears it rather than becoming a new reference.
 */
export interface ClearBoardBaselineProgress {
  stableComparisons: number;
  broadMotionComparisons: number;
}

export type ClearBoardBaselineAction =
  'continue' | 'armed' | 'refresh-automatic-board-map' | 'hold-localized-change';

export interface ClearBoardBaselineAdvance {
  progress: ClearBoardBaselineProgress;
  action: ClearBoardBaselineAction;
}

const REQUIRED_STABLE_COMPARISONS = 2;
const BROAD_MOTION_COMPARISONS_BEFORE_REFRESH = 2;

export function advanceClearBoardBaseline(
  previous: Readonly<ClearBoardBaselineProgress>,
  status: DifferenceStatus,
): ClearBoardBaselineAdvance {
  if (status === 'no-change') {
    const stableComparisons = previous.stableComparisons + 1;
    return {
      progress: { stableComparisons, broadMotionComparisons: 0 },
      action: stableComparisons >= REQUIRED_STABLE_COMPARISONS ? 'armed' : 'continue',
    };
  }

  if (status === 'camera-moved-or-hand-present') {
    const broadMotionComparisons = previous.broadMotionComparisons + 1;
    return {
      progress: { stableComparisons: 0, broadMotionComparisons },
      action:
        broadMotionComparisons >= BROAD_MOTION_COMPARISONS_BEFORE_REFRESH
          ? 'refresh-automatic-board-map'
          : 'continue',
    };
  }

  // A possible dart, changed camera resolution, or a local ambiguous change must never be silently
  // folded into a fresh clear-board reference. Require the user to clear/reframe it instead.
  return {
    progress: { stableComparisons: 0, broadMotionComparisons: 0 },
    action: 'hold-localized-change',
  };
}
