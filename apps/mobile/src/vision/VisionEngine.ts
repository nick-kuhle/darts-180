import type {
  BoardCalibration,
  CameraPoseQuality,
  RankedZoneCandidate,
} from '@darts-180/contracts';

/**
 * The only interface the React Native UI should know about. iOS/Android implementations will be
 * TurboModules backed by the shared native vision core, not a JavaScript OpenCV loop.
 */
export interface VisionEngine {
  warmUp(): Promise<void>;
  startSession(input: Readonly<{ calibration: BoardCalibration }>): Promise<void>;
  stopSession(): Promise<void>;
  onBoardQuality(listener: (quality: CameraPoseQuality) => void): () => void;
  onDartCandidates(listener: (event: VisionCandidateEvent) => void): () => void;
}

export interface VisionCandidateEvent {
  trackId: string;
  frameTimestampMs: number;
  candidates: readonly RankedZoneCandidate[];
}

/**
 * Guardrail for development: Camera preview may work in Expo Go, but per-frame native CV must
 * run in a development/production build. A real adapter is intentionally introduced behind this
 * contract, never inside a screen component.
 */
export const unavailableVisionEngine: VisionEngine = {
  async warmUp() {
    throw new Error(
      'Native vision is unavailable in this build. Install a Darts 180 development build.',
    );
  },
  async startSession() {
    throw new Error('Native vision is unavailable in this build.');
  },
  async stopSession() {},
  onBoardQuality() {
    return () => undefined;
  },
  onDartCandidates() {
    return () => undefined;
  },
};
