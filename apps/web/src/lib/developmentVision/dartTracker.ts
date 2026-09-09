import type { BoardPointMm } from '@darts-180/contracts';

import type { DeepDartsDetection, DevelopmentTrackedDart } from './types';

export interface DevelopmentDartTrackerOptions {
  matchDistanceMm: number;
  settleMs: number;
  staleAfterMs: number;
  maxSettledSpreadMm: number;
}

export interface DevelopmentDartObservation {
  boardPointMm: BoardPointMm;
  detection: DeepDartsDetection;
  frameTimestampMs: number;
}

/**
 * Temporal identity/settling for genuine detector points only. It does not infer a tip from motion,
 * pixels, or a missing detector output.
 */
export class DevelopmentDartTracker {
  private readonly options: DevelopmentDartTrackerOptions;
  private readonly tracks = new Map<string, TrackAccumulator>();
  private sequence = 0;

  public constructor(options: DevelopmentDartTrackerOptions) {
    if (!validOptions(options)) throw new Error('Development dart-track policy is invalid.');
    this.options = options;
  }

  public observe(
    observations: readonly DevelopmentDartObservation[],
    frameTimestampMs: number,
  ): readonly DevelopmentTrackedDart[] {
    const matched = new Set<string>();
    for (const observation of [...observations].sort(
      (left, right) => right.detection.confidence - left.detection.confidence,
    )) {
      const track = this.closestUnmatchedTrack(observation.boardPointMm, frameTimestampMs, matched);
      if (track === undefined) {
        const created = new TrackAccumulator(`development-dart-${++this.sequence}`, observation);
        this.tracks.set(created.trackId, created);
        matched.add(created.trackId);
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

  public snapshot(): readonly DevelopmentTrackedDart[] {
    return [...this.tracks.values()]
      .map((track) => track.toPublic(this.options))
      .sort(
        (left, right) =>
          left.firstSeenMs - right.firstSeenMs || left.trackId.localeCompare(right.trackId),
      );
  }

  private closestUnmatchedTrack(
    point: BoardPointMm,
    timestampMs: number,
    matched: ReadonlySet<string>,
  ): TrackAccumulator | undefined {
    let closest: TrackAccumulator | undefined;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const track of this.tracks.values()) {
      if (
        matched.has(track.trackId) ||
        timestampMs - track.lastSeenMs > this.options.staleAfterMs
      ) {
        continue;
      }
      const distance = distanceMm(point, track.boardPointMm);
      if (distance <= this.options.matchDistanceMm && distance < closestDistance) {
        closest = track;
        closestDistance = distance;
      }
    }
    return closest;
  }

  private retireStaleTracks(timestampMs: number): void {
    for (const [trackId, track] of this.tracks) {
      if (timestampMs - track.lastSeenMs > this.options.staleAfterMs) this.tracks.delete(trackId);
    }
  }
}

class TrackAccumulator {
  public readonly trackId: string;
  public readonly firstSeenMs: number;
  public lastSeenMs: number;
  public observationCount = 1;
  public boardPointMm: BoardPointMm;
  public detection: DeepDartsDetection;
  public proposed = false;
  private readonly recentPoints: BoardPointMm[];

  public constructor(trackId: string, observation: DevelopmentDartObservation) {
    this.trackId = trackId;
    this.firstSeenMs = observation.frameTimestampMs;
    this.lastSeenMs = observation.frameTimestampMs;
    this.boardPointMm = observation.boardPointMm;
    this.detection = observation.detection;
    this.recentPoints = [observation.boardPointMm];
  }

  public add(observation: DevelopmentDartObservation): void {
    const confidence = Math.max(0.05, Math.min(1, observation.detection.confidence));
    const priorWeight = Math.min(8, this.observationCount);
    this.boardPointMm = {
      xMm:
        (this.boardPointMm.xMm * priorWeight + observation.boardPointMm.xMm * confidence) /
        (priorWeight + confidence),
      yMm:
        (this.boardPointMm.yMm * priorWeight + observation.boardPointMm.yMm * confidence) /
        (priorWeight + confidence),
    };
    if (observation.detection.confidence >= this.detection.confidence) {
      this.detection = observation.detection;
    }
    this.lastSeenMs = observation.frameTimestampMs;
    this.observationCount += 1;
    this.recentPoints.push(observation.boardPointMm);
    if (this.recentPoints.length > 6) this.recentPoints.shift();
  }

  public toPublic(options: DevelopmentDartTrackerOptions): DevelopmentTrackedDart {
    return {
      trackId: this.trackId,
      firstSeenMs: this.firstSeenMs,
      lastSeenMs: this.lastSeenMs,
      observationCount: this.observationCount,
      boardPointMm: this.boardPointMm,
      detection: this.detection,
      isSettled:
        this.observationCount >= 2 &&
        this.lastSeenMs - this.firstSeenMs >= options.settleMs &&
        maxDistanceFromCentroid(this.recentPoints) <= options.maxSettledSpreadMm,
      proposed: this.proposed,
    };
  }
}

function validOptions(options: DevelopmentDartTrackerOptions): boolean {
  return (
    Number.isFinite(options.matchDistanceMm) &&
    options.matchDistanceMm > 0 &&
    Number.isFinite(options.settleMs) &&
    options.settleMs >= 0 &&
    Number.isFinite(options.staleAfterMs) &&
    options.staleAfterMs > options.settleMs &&
    Number.isFinite(options.maxSettledSpreadMm) &&
    options.maxSettledSpreadMm >= 0
  );
}

function distanceMm(left: BoardPointMm, right: BoardPointMm): number {
  return Math.hypot(left.xMm - right.xMm, left.yMm - right.yMm);
}

function maxDistanceFromCentroid(points: readonly BoardPointMm[]): number {
  if (points.length === 0) return Number.POSITIVE_INFINITY;
  const centroid = points.reduce(
    (total, point) => ({
      xMm: total.xMm + point.xMm / points.length,
      yMm: total.yMm + point.yMm / points.length,
    }),
    { xMm: 0, yMm: 0 },
  );
  return Math.max(...points.map((point) => distanceMm(point, centroid)));
}
