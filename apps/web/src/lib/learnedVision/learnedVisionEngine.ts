import type {
  BoardPoseObservation,
  ScoringProposal,
  VisionModelArtifactManifest,
} from '@darts-180/contracts';

import { deriveBoardPose, mapDartTipToBoard, type DerivedBoardPose } from './boardPose';
import { CanonicalDartTracker, type DartTrackerOptions, type TrackedDart } from './dartTracker';
import { createLearnedScoringProposal } from './scoreProposal';
import type { LearnedInferenceFrameResult } from './workerProtocol';

export interface LearnedVisionFrame {
  pose: DerivedBoardPose | null;
  observation: BoardPoseObservation;
  tracks: readonly TrackedDart[];
  /** At most one newly settled dart proposal is emitted per inference frame. */
  proposal: ScoringProposal | null;
}

/**
 * Framework-free core joining worker semantic output, automatic complete-board calibration,
 * canonical dart tracking, and deterministic scoring. The browser uses it first; a native adapter
 * can feed the same output shape after the web program has passed its evidence gate.
 */
export class LearnedVisionEngine {
  private readonly tracker: CanonicalDartTracker;

  public constructor(trackerOptions: Partial<DartTrackerOptions> = {}) {
    this.tracker = new CanonicalDartTracker(trackerOptions);
  }

  public process(
    result: LearnedInferenceFrameResult,
    model: VisionModelArtifactManifest,
  ): LearnedVisionFrame {
    const pose = deriveBoardPose(result.landmarks, result.quality, result.frameTimestampMs);
    const observation: BoardPoseObservation = {
      frameTimestampMs: result.frameTimestampMs,
      landmarks: result.landmarks,
      quality: result.quality,
      calibration: pose?.calibration ?? null,
    };

    if (pose === null) {
      return { pose: null, observation, tracks: this.tracker.snapshot(), proposal: null };
    }

    const canonicalTips = result.dartTips.flatMap((tip) => {
      const mapped = mapDartTipToBoard(tip, pose.calibration.imageToBoardHomography);
      return mapped === null
        ? []
        : [
            {
              tip,
              boardPointMm: mapped.point,
              uncertaintyMm: mapped.uncertainty,
              frameTimestampMs: result.frameTimestampMs,
            },
          ];
    });
    const tracks = this.tracker.observe(canonicalTips, result.frameTimestampMs);
    const next = tracks.find((track) => track.isSettled && !track.proposed);
    if (next === undefined) return { pose, observation, tracks, proposal: null };

    const proposal = createLearnedScoringProposal({
      model,
      calibration: pose.calibration,
      tip: next.tip,
      boardPoint: next.boardPointMm,
      uncertainty: next.uncertaintyMm,
      frameTimestampMs: result.frameTimestampMs,
    });
    // Once a scored/review proposal is emitted, consume that physical track. An abstention remains
    // eligible for a better later high-resolution burst, rather than becoming a silent score.
    if (proposal.disposition !== 'abstain') this.tracker.markProposed(next.trackId);
    return { pose, observation, tracks, proposal };
  }

  public resetVisit(): void {
    this.tracker.reset();
  }
}
