import type {
  BoardPoseObservation,
  ScoringProposal,
  VisionModelArtifactManifest,
} from '@darts-180/contracts';

import { deriveBoardPose, mapDartTipToBoard, type DerivedBoardPose } from './boardPose';
import { CanonicalDartTracker, type TrackedDart } from './dartTracker';
import { modelQualityBlockers, dartTipBlocker } from './qualityPolicy';
import { createLearnedScoringProposal } from './scoreProposal';
import type { LearnedInferenceFrameResult } from './workerProtocol';

export interface LearnedVisionFrame {
  pose: DerivedBoardPose | null;
  observation: BoardPoseObservation;
  tracks: readonly TrackedDart[];
  /** Raw learned tips rejected before tracking because evidence is invalid, occluded, or unmapppable. */
  blockedTipCount: number;
  /** At most one newly settled dart proposal is emitted per inference frame. */
  proposal: ScoringProposal | null;
}

/**
 * Framework-free core joining worker semantic output, automatic complete-board calibration,
 * canonical dart tracking, and deterministic scoring. The browser uses it first; a native adapter
 * can feed the same output shape after the web program has passed its evidence gate.
 */
export class LearnedVisionEngine {
  private tracker: CanonicalDartTracker | null = null;
  private trackerPolicyKey: string | null = null;

  public process(
    result: LearnedInferenceFrameResult,
    model: VisionModelArtifactManifest,
  ): LearnedVisionFrame {
    const qualityBlockers = modelQualityBlockers(model, result.quality);
    const pose =
      qualityBlockers.length === 0
        ? deriveBoardPose(result.landmarks, result.quality, result.frameTimestampMs, {
            minLandmarkConfidence: model.decisionPolicy.minLandmarkConfidence,
            maxPoseValidationResidualMm: model.decisionPolicy.maxPoseValidationResidualMm,
          })
        : null;
    const observation: BoardPoseObservation = {
      frameTimestampMs: result.frameTimestampMs,
      landmarks: result.landmarks,
      quality: result.quality,
      calibration: pose?.calibration ?? null,
    };

    if (pose === null) {
      // A track is meaningful only in a continuously validated board coordinate system. Retaining
      // it through a lost/invalid pose could associate a later dart with stale geometry.
      this.tracker?.reset();
      return { pose: null, observation, tracks: [], blockedTipCount: 0, proposal: null };
    }

    const tracker = this.trackerFor(model);
    let blockedTipCount = 0;
    const canonicalTips = result.dartTips.flatMap((tip) => {
      if (dartTipBlocker(model, tip) !== null) {
        blockedTipCount += 1;
        return [];
      }
      const mapped = mapDartTipToBoard(tip, pose.calibration.imageToBoardHomography);
      if (mapped === null) {
        // A raw learned tip that cannot be mapped safely is still evidence that the board is not
        // proven clear; do not silently discard it before the clear-board check.
        blockedTipCount += 1;
        return [];
      }
      return [
        {
          tip,
          boardPointMm: mapped.point,
          uncertaintyMm: mapped.uncertainty,
          frameTimestampMs: result.frameTimestampMs,
        },
      ];
    });
    const tracks = tracker.observe(canonicalTips, result.frameTimestampMs);
    const next = tracks.find((track) => track.isSettled && !track.proposed);
    if (next === undefined) return { pose, observation, tracks, blockedTipCount, proposal: null };

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
    if (proposal.disposition !== 'abstain') tracker.markProposed(next.trackId);
    return { pose, observation, tracks, blockedTipCount, proposal };
  }

  public resetVisit(): void {
    this.tracker?.reset();
  }

  private trackerFor(model: VisionModelArtifactManifest): CanonicalDartTracker {
    const policy = model.decisionPolicy;
    const policyKey = JSON.stringify({
      modelId: model.modelId,
      modelVersion: model.modelVersion,
      artifactSha256: model.sha256,
      releaseStage: model.releaseStage,
      input: model.input,
      outputContract: model.outputContract,
      outputs: model.outputs,
      decisionPolicy: policy,
    });
    if (this.tracker === null || this.trackerPolicyKey !== policyKey) {
      // Temporal association changes score eligibility, so its calibrated values travel with the
      // model artifact rather than remaining hidden JavaScript defaults.
      this.tracker = new CanonicalDartTracker({
        matchDistanceMm: policy.tipTrackMatchDistanceMm,
        settleMs: policy.tipTrackSettleMs,
        staleAfterMs: policy.tipTrackStaleAfterMs,
        maxSettledSpreadMm: policy.maxTipTrackSpreadMm,
      });
      this.trackerPolicyKey = policyKey;
    }
    return this.tracker;
  }
}
