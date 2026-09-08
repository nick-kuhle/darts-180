import type { BoardPointMm, DartTipObservation } from '@darts-180/contracts';

import type { BoardUncertaintyMm } from './boardPose';

export interface CanonicalTipObservation {
  tip: DartTipObservation;
  boardPointMm: BoardPointMm;
  uncertaintyMm: BoardUncertaintyMm;
  frameTimestampMs: number;
}

export interface TrackedDart {
  trackId: string;
  firstSeenMs: number;
  lastSeenMs: number;
  observationCount: number;
  boardPointMm: BoardPointMm;
  uncertaintyMm: BoardUncertaintyMm;
  tip: DartTipObservation;
  /** True only after spatially consistent learned tip observations through the settle interval. */
  isSettled: boolean;
  /** True once the session has emitted this track into a DartCard proposal. */
  proposed: boolean;
}

export interface DartTrackerOptions {
  /** Maximum canonical-board distance used to associate the same physical dart across frames. */
  matchDistanceMm: number;
  /** Required stable duration before a new learned tip can be proposed. */
  settleMs: number;
  /** A track that disappears for longer than this must be treated as board-state change. */
  staleAfterMs: number;
  /** A moving/jittering point beyond this radius is not settled. */
  maxSettledSpreadMm: number;
}

const DEFAULT_OPTIONS: DartTrackerOptions = {
  matchDistanceMm: 12,
  settleMs: 320,
  staleAfterMs: 1_200,
  maxSettledSpreadMm: 4,
};

/**
 * Associate semantic dart-tip observations in canonical-board space. This uses temporal evidence
 * only for identity/settling; the learned model still supplies every entry point.
 */
export class CanonicalDartTracker {
  private readonly options: DartTrackerOptions;
  private readonly tracks = new Map<string, TrackAccumulator>();
  private sequence = 0;

  public constructor(options: Partial<DartTrackerOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  public observe(
    observations: readonly CanonicalTipObservation[],
    frameTimestampMs: number,
  ): readonly TrackedDart[] {
    const sorted = [...observations].sort(
      (left, right) => right.tip.confidence - left.tip.confidence,
    );
    const matched = new Set<string>();

    for (const observation of sorted) {
      const track = this.closestUnmatchedTrack(observation.boardPointMm, frameTimestampMs, matched);
      if (track === undefined) {
        const newTrack = new TrackAccumulator(`dart-${++this.sequence}`, observation);
        this.tracks.set(newTrack.trackId, newTrack);
        matched.add(newTrack.trackId);
      } else {
        track.add(observation);
        matched.add(track.trackId);
      }
    }

    this.retireStaleTracks(frameTimestampMs);
    return this.snapshot();
  }

  public markProposed(trackId: string): void {
    const track = this.tracks.get(trackId);
    if (track !== undefined) track.proposed = true;
  }

  public reset(): void {
    this.tracks.clear();
    this.sequence = 0;
  }

  public snapshot(): readonly TrackedDart[] {
    return [...this.tracks.values()]
      .map((track) => track.toPublic(this.options))
      .sort(
        (left, right) =>
          left.firstSeenMs - right.firstSeenMs || left.trackId.localeCompare(right.trackId),
      );
  }

  private closestUnmatchedTrack(
    point: BoardPointMm,
    atMs: number,
    matched: ReadonlySet<string>,
  ): TrackAccumulator | undefined {
    let best: TrackAccumulator | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const track of this.tracks.values()) {
      if (matched.has(track.trackId) || atMs - track.lastSeenMs > this.options.staleAfterMs)
        continue;
      const distance = distanceMm(point, track.boardPointMm);
      if (distance <= this.options.matchDistanceMm && distance < bestDistance) {
        best = track;
        bestDistance = distance;
      }
    }
    return best;
  }

  private retireStaleTracks(atMs: number): void {
    for (const [trackId, track] of this.tracks) {
      if (atMs - track.lastSeenMs > this.options.staleAfterMs) this.tracks.delete(trackId);
    }
  }
}

class TrackAccumulator {
  public readonly trackId: string;
  public readonly firstSeenMs: number;
  public lastSeenMs: number;
  public observationCount = 1;
  public boardPointMm: BoardPointMm;
  public uncertaintyMm: BoardUncertaintyMm;
  public tip: DartTipObservation;
  public proposed = false;
  private readonly recentPoints: BoardPointMm[];

  public constructor(trackId: string, observation: CanonicalTipObservation) {
    this.trackId = trackId;
    this.firstSeenMs = observation.frameTimestampMs;
    this.lastSeenMs = observation.frameTimestampMs;
    this.boardPointMm = observation.boardPointMm;
    this.uncertaintyMm = observation.uncertaintyMm;
    this.tip = observation.tip;
    this.recentPoints = [observation.boardPointMm];
  }

  public add(observation: CanonicalTipObservation): void {
    const weight = Math.max(0.05, Math.min(1, observation.tip.confidence));
    const priorWeight = Math.min(8, this.observationCount);
    this.boardPointMm = {
      xMm:
        (this.boardPointMm.xMm * priorWeight + observation.boardPointMm.xMm * weight) /
        (priorWeight + weight),
      yMm:
        (this.boardPointMm.yMm * priorWeight + observation.boardPointMm.yMm * weight) /
        (priorWeight + weight),
    };
    this.uncertaintyMm = {
      sigmaXMm: Math.max(this.uncertaintyMm.sigmaXMm, observation.uncertaintyMm.sigmaXMm),
      sigmaYMm: Math.max(this.uncertaintyMm.sigmaYMm, observation.uncertaintyMm.sigmaYMm),
    };
    this.tip = observation.tip.confidence >= this.tip.confidence ? observation.tip : this.tip;
    this.lastSeenMs = observation.frameTimestampMs;
    this.observationCount += 1;
    this.recentPoints.push(observation.boardPointMm);
    if (this.recentPoints.length > 6) this.recentPoints.shift();
  }

  public toPublic(options: DartTrackerOptions): TrackedDart {
    const settledDuration = this.lastSeenMs - this.firstSeenMs;
    return {
      trackId: this.trackId,
      firstSeenMs: this.firstSeenMs,
      lastSeenMs: this.lastSeenMs,
      observationCount: this.observationCount,
      boardPointMm: this.boardPointMm,
      uncertaintyMm: this.uncertaintyMm,
      tip: this.tip,
      isSettled:
        this.observationCount >= 2 &&
        settledDuration >= options.settleMs &&
        maxDistanceFromCentroid(this.recentPoints) <= options.maxSettledSpreadMm,
      proposed: this.proposed,
    };
  }
}

function distanceMm(left: BoardPointMm, right: BoardPointMm): number {
  return Math.hypot(left.xMm - right.xMm, left.yMm - right.yMm);
}

function maxDistanceFromCentroid(points: readonly BoardPointMm[]): number {
  if (points.length === 0) return Number.POSITIVE_INFINITY;
  const center = points.reduce(
    (sum, point) => ({
      xMm: sum.xMm + point.xMm / points.length,
      yMm: sum.yMm + point.yMm / points.length,
    }),
    { xMm: 0, yMm: 0 },
  );
  return Math.max(...points.map((point) => distanceMm(point, center)));
}
