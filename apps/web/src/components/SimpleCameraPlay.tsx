import type { DartZone } from '@darts-180/contracts';
import { BOARD_RADII_MM, formatZone } from '@darts-180/rules';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';

import {
  invertHomography,
  mapBoardPointToImage,
  solveImageToBoardHomography,
  type Homography,
  type ImagePoint,
} from '../lib/annotationGeometry';
import {
  AUTOMATIC_BOARD_FIT_REQUIRED_OBSERVATIONS,
  advanceAutomaticBoardFitStability,
  detectBoardFitFromColors,
  type AutoBoardFitResult,
  type AutomaticBoardFitStability,
} from '../lib/autoBoardFit';
import {
  analysisRadiusForBoardSkew,
  analyzeDartDifference,
  assessAutomaticBoardFitQuality,
  assessBoardFitCalibration,
  frameFromImageData,
  selectAutomaticTipCandidate,
  selectReviewTipCandidate,
  type CameraFrame,
  type DartTipCandidate,
  type DifferenceAnalysis,
  type GuidedCalibrationQuality,
} from '../lib/cameraScoring';
import { describeCameraAccessError, getCameraAccessPreflightMessage } from '../lib/cameraAccess';
import {
  resolveStartPlayReferenceCapture,
  START_PLAY_REFERENCE_SETTLE_MS,
} from '../lib/startPlayReferenceCapture';
import type { CameraTurnProposal } from '../lib/cameraProposal';
import {
  BOARD_FIT_CANONICAL_ANCHORS,
  boardFitCenter,
  createInitialBoardFit,
  moveBoardFitHandle,
  nearestBoardFitHandle,
  pointIsInsideBoardFit,
  transformBoardFit,
  translateBoardFit,
  type BoardFitPoints,
} from '../lib/boardFit';

// Keep more of a modern rear-camera frame than the original 960 px prototype cap: thin shafts and
// compact flights need usable pixels after a full board is framed, while auto-board finding itself
// still samples sparsely.
const MAX_WORKING_EDGE = 1280;
const MIN_HANDLE_HIT_RADIUS = 24;
// A 1280 px portrait frame plus local board registration is intentionally more work than a simple
// preview draw. A half-second cadence still leaves Safari/Chrome room to render, while confirming a
// settled direct-entry cue before a player naturally throws a second dart.
const LOCAL_ANALYSIS_INTERVAL_MS = 500;

type CameraPhase =
  | 'finding-board'
  | 'manual-fit'
  | 'ready-to-play'
  | 'capturing-reference'
  | 'watching'
  | 'reviewing-candidate'
  | 'turn-ready'
  | 'awaiting-clear';

type GestureState =
  | {
      kind: 'move';
      pointerId: number;
      start: ImagePoint;
      last: ImagePoint;
      startFit: BoardFitPoints;
    }
  | { kind: 'handle'; pointerId: number; handleIndex: number }
  | {
      kind: 'transform';
      pointerIds: readonly [number, number];
      startFit: BoardFitPoints;
      startCenter: ImagePoint;
      startDistance: number;
      startAngle: number;
    };

export interface CameraPlayDraft {
  slot: 1 | 2 | 3;
  zone: DartZone;
  source: 'auto' | 'manual' | 'corrected';
  confidence: number;
  wireMarginMm: number;
  filled: boolean;
}

interface HeldCameraCandidate {
  candidate: DartTipCandidate;
  frame: CameraFrame;
  analysis: DifferenceAnalysis;
}

interface SimpleCameraPlayProps {
  activePlayerName: string;
  availableSlots: number;
  gameComplete: boolean;
  turnDarts: readonly CameraPlayDraft[];
  onAddProposal: (proposal: CameraTurnProposal) => number | null;
  onConfirmVisit: () => boolean;
  onOpenReview: () => void;
  onOpenAdvanced: () => void;
}

/**
 * The normal player path: infer an upright standard board from its red/green scoring colors, then
 * let browser-local temporal change detection propose the next score. It deliberately hides
 * physical-tip picking; an optional visual guide is recovery-only and ordinary score correction
 * remains available if the heuristic is unsure.
 */
export function SimpleCameraPlay({
  activePlayerName,
  availableSlots,
  gameComplete,
  turnDarts,
  onAddProposal,
  onConfirmVisit,
  onOpenReview,
  onOpenAdvanced,
}: SimpleCameraPlayProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const renderFrameRef = useRef<number | null>(null);
  const fitRef = useRef<BoardFitPoints | null>(null);
  const activePointersRef = useRef(new Map<number, ImagePoint>());
  const gestureRef = useRef<GestureState | null>(null);
  const stabilityRef = useRef<{
    zoneKey: string;
    imagePoint: ImagePoint;
    count: number;
    misses: number;
  } | null>(null);
  const referenceCaptureTimerRef = useRef<number | null>(null);
  const referenceCaptureGenerationRef = useRef(0);
  const autoFitStabilityRef = useRef<AutomaticBoardFitStability | null>(null);
  const recordingRef = useRef(false);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [fit, setFit] = useState<BoardFitPoints | null>(null);
  const [homography, setHomography] = useState<Homography | null>(null);
  const [quality, setQuality] = useState<GuidedCalibrationQuality | null>(null);
  const [automaticFit, setAutomaticFit] = useState<AutoBoardFitResult | null>(null);
  const [reference, setReference] = useState<CameraFrame | null>(null);
  const [phase, setPhase] = useState<CameraPhase>('finding-board');
  const [analysis, setAnalysis] = useState<DifferenceAnalysis | null>(null);
  const [heldCandidate, setHeldCandidate] = useState<HeldCameraCandidate | null>(null);
  const [lastRecorded, setLastRecorded] = useState<Readonly<{
    slot: number;
    zone: DartZone;
    imagePoint: ImagePoint;
  }> | null>(null);
  const [liveMessage, setLiveMessage] = useState(
    'Start the rear camera. Darts 180 will look for the board’s red and green scoring colors automatically.',
  );

  useEffect(() => {
    fitRef.current = fit;
  }, [fit]);

  useEffect(() => {
    if (gameComplete && phase !== 'finding-board') {
      setLiveMessage(
        'The game is complete. Open Play demo to review the final result or start another game.',
      );
    }
  }, [gameComplete, phase]);

  const turnCount = turnDarts.filter((dart) => dart.filled).length;
  const turnTotal = turnDarts
    .filter((dart) => dart.filled)
    .reduce((total, dart) => total + dart.zone.score, 0);
  const guideLocked = phase !== 'manual-fit';
  const canStartPlay =
    cameraActive &&
    homography !== null &&
    quality?.pass === true &&
    phase === 'ready-to-play' &&
    !gameComplete;
  const isWatching = phase === 'watching';
  const isCapturingReference = phase === 'capturing-reference';
  const isReviewingCandidate = phase === 'reviewing-candidate';
  const isLiveScoring = isWatching || isCapturingReference;
  const isDetectorStateVisible = isWatching || isReviewingCandidate;

  const clearReferenceCapture = useCallback(() => {
    referenceCaptureGenerationRef.current += 1;
    if (referenceCaptureTimerRef.current !== null) {
      window.clearTimeout(referenceCaptureTimerRef.current);
      referenceCaptureTimerRef.current = null;
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (renderFrameRef.current !== null) {
      window.cancelAnimationFrame(renderFrameRef.current);
      renderFrameRef.current = null;
    }
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    if (videoRef.current !== null) videoRef.current.srcObject = null;
    activePointersRef.current.clear();
    gestureRef.current = null;
    clearReferenceCapture();
    stabilityRef.current = null;
    autoFitStabilityRef.current = null;
    recordingRef.current = false;
    setCameraActive(false);
    setFit(null);
    setReference(null);
    setHomography(null);
    setQuality(null);
    setAutomaticFit(null);
    setHeldCandidate(null);
    setPhase('finding-board');
  }, [clearReferenceCapture]);

  useEffect(() => stopCamera, [stopCamera]);

  const workingDimensions = useCallback((video: HTMLVideoElement) => {
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (sourceWidth === 0 || sourceHeight === 0) return null;
    const scale = Math.min(1, MAX_WORKING_EDGE / Math.max(sourceWidth, sourceHeight));
    return {
      width: Math.max(2, Math.round(sourceWidth * scale)),
      height: Math.max(2, Math.round(sourceHeight * scale)),
    };
  }, []);

  const captureFrame = useCallback((): CameraFrame | null => {
    const video = videoRef.current;
    const frameCanvas = frameCanvasRef.current;
    if (
      video === null ||
      frameCanvas === null ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      return null;
    }
    const dimensions = workingDimensions(video);
    if (dimensions === null) return null;
    if (frameCanvas.width !== dimensions.width || frameCanvas.height !== dimensions.height) {
      frameCanvas.width = dimensions.width;
      frameCanvas.height = dimensions.height;
    }
    const context = frameCanvas.getContext('2d', { willReadFrequently: true });
    if (context === null) return null;
    context.drawImage(video, 0, 0, dimensions.width, dimensions.height);
    return frameFromImageData(context.getImageData(0, 0, dimensions.width, dimensions.height));
  }, [workingDimensions]);

  const startCamera = async () => {
    const preflight = getCameraAccessPreflightMessage();
    if (preflight !== null) {
      setCameraError(preflight);
      return;
    }
    const mediaDevices = navigator.mediaDevices;
    if (mediaDevices?.getUserMedia === undefined) {
      setCameraError(
        'This browser did not expose a usable camera API. Open the direct HTTPS Darts 180 URL in Safari or Chrome.',
      );
      return;
    }

    try {
      stopCamera();
      const stream = await mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video === null) throw new Error('Camera preview element was unavailable.');
      video.srcObject = stream;
      await video.play();
      // Some mobile browsers resolve play before reporting dimensions on the first permission run.
      for (let attempt = 0; video.videoWidth === 0 && attempt < 20; attempt += 1) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
      }
      const dimensions = workingDimensions(video);
      if (dimensions === null)
        throw new Error('Camera dimensions were not available yet. Try starting it again.');
      // A valid frame buffer is now mounted below before this runs. Do not create a default manual
      // guide: the normal path begins by looking for red/green scoring bands automatically.
      setFit(null);
      setCameraActive(true);
      setCameraError(null);
      setQuality(null);
      setAutomaticFit(null);
      setAnalysis(null);
      setLastRecorded(null);
      setPhase('finding-board');
      autoFitStabilityRef.current = null;
      setLiveMessage(
        'Looking for the board’s red and green scoring colors. Keep the whole board visible and the physical 20 at the top of the camera image.',
      );
    } catch (error) {
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
      streamRef.current = null;
      if (videoRef.current !== null) videoRef.current.srcObject = null;
      setCameraError(describeCameraAccessError(error));
      setCameraActive(false);
    }
  };

  useEffect(() => {
    if (!cameraActive) return;
    let cancelled = false;
    const render = () => {
      const video = videoRef.current;
      const canvas = previewCanvasRef.current;
      const dimensions = video === null ? null : workingDimensions(video);
      if (!cancelled && video !== null && canvas !== null && dimensions !== null) {
        if (canvas.width !== dimensions.width || canvas.height !== dimensions.height) {
          canvas.width = dimensions.width;
          canvas.height = dimensions.height;
        }
        const context = canvas.getContext('2d');
        if (context !== null) {
          context.drawImage(video, 0, 0, dimensions.width, dimensions.height);
          drawBoardGuide(
            context,
            fitRef.current,
            guideLocked,
            lastRecorded?.imagePoint ?? null,
            lastRecorded?.zone ?? null,
          );
        }
      }
      if (!cancelled) renderFrameRef.current = window.requestAnimationFrame(render);
    };
    render();
    return () => {
      cancelled = true;
      if (renderFrameRef.current !== null) {
        window.cancelAnimationFrame(renderFrameRef.current);
        renderFrameRef.current = null;
      }
    };
  }, [cameraActive, guideLocked, lastRecorded?.imagePoint, lastRecorded?.zone, workingDimensions]);

  const restartAutomaticBoardFind = () => {
    clearReferenceCapture();
    if (!cameraActive) {
      setLiveMessage(
        'Start the rear camera first, then Darts 180 can look for the board automatically.',
      );
      return;
    }
    setFit(null);
    setHomography(null);
    setReference(null);
    setQuality(null);
    setAutomaticFit(null);
    setAnalysis(null);
    setHeldCandidate(null);
    setLastRecorded(null);
    setPhase('finding-board');
    stabilityRef.current = null;
    autoFitStabilityRef.current = null;
    setLiveMessage(
      'Looking for the board’s red and green scoring colors. Keep the full board in view and the physical 20 at the top of the camera image.',
    );
  };

  useEffect(() => {
    if (!cameraActive || phase !== 'finding-board' || gameComplete) return;
    let cancelled = false;

    const findBoard = () => {
      const frame = captureFrame();
      if (frame === null) {
        setLiveMessage('Waiting for a complete camera frame before looking for the board.');
        return;
      }
      const result = detectBoardFitFromColors(frame);
      if (cancelled) return;
      setAutomaticFit(result);
      const nextStability = advanceAutomaticBoardFitStability(
        autoFitStabilityRef.current,
        result.fit,
      );
      autoFitStabilityRef.current = nextStability;
      if (result.fit === null) {
        if (nextStability !== null) {
          // A warm board, focus pull, or exposure correction can temporarily weaken the color
          // pattern even though the mounted board has not moved. Retain the last fit briefly, but
          // keep the player in finding mode until a second comparable observation arrives.
          setFit(nextStability.fit);
          setLiveMessage(
            'The board color pattern briefly flickered. Keeping the last board read while the camera settles…',
          );
          return;
        }
        setFit(null);
        setHomography(null);
        setQuality(null);
        setLiveMessage(result.message);
        return;
      }

      setFit(result.fit);
      if (
        nextStability === null ||
        nextStability.matchingObservations < AUTOMATIC_BOARD_FIT_REQUIRED_OBSERVATIONS
      ) {
        setLiveMessage('Board colors found. Confirming the board in the live view…');
        return;
      }

      const nextHomography = solveImageToBoardHomography(result.fit, BOARD_FIT_CANONICAL_ANCHORS);
      const nextQuality = assessAutomaticBoardFitQuality(result.fit, frame);
      setQuality(nextQuality);
      if (nextHomography === null) {
        setHomography(null);
        setLiveMessage(
          'The automatically found board shape was not usable. Reframe the board, then try again.',
        );
        return;
      }
      if (!nextQuality.pass) {
        setHomography(null);
        setLiveMessage(nextQuality.blockers[0] ?? 'The automatic board fit needs a clearer view.');
        return;
      }

      setHomography(nextHomography);
      setPhase('ready-to-play');
      setLiveMessage(
        'Board found automatically. With the board clear, tap Start Play — no calibration points or guide fitting needed.',
      );
    };

    findBoard();
    // Radial color-pattern fitting is intentionally more thorough than the old outermost-color
    // estimate. It runs only until two fits agree, at a cadence that leaves a mobile browser time
    // to render the live preview smoothly.
    const interval = window.setInterval(findBoard, 800);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [cameraActive, captureFrame, gameComplete, phase]);

  const startOptionalManualGuide = () => {
    clearReferenceCapture();
    const frame = captureFrame();
    if (frame === null) {
      setLiveMessage(
        'The camera is still starting. Wait for the live image, then open optional guide recovery.',
      );
      return;
    }
    setFit(createInitialBoardFit(frame.width, frame.height));
    setHomography(null);
    setReference(null);
    setQuality(null);
    setAutomaticFit(null);
    setAnalysis(null);
    setHeldCandidate(null);
    setLastRecorded(null);
    setPhase('manual-fit');
    autoFitStabilityRef.current = null;
    setLiveMessage(
      'Optional recovery only: place the 20 handle on the real 20, adjust the guide, then continue to Start Play.',
    );
  };

  const useOptionalManualGuide = () => {
    if (fit === null) {
      setLiveMessage('Wait for the optional guide before continuing.');
      return;
    }
    const frame = captureFrame();
    if (frame === null) {
      setLiveMessage(
        'The camera has not supplied a complete frame yet. Wait for the live image, then try again.',
      );
      return;
    }
    const nextQuality = assessBoardFitCalibration(fit, frame);
    setQuality(nextQuality);
    const nextHomography = solveImageToBoardHomography(fit, BOARD_FIT_CANONICAL_ANCHORS);
    if (nextHomography === null) {
      setLiveMessage(
        'That optional guide shape cannot be mapped. Reset it or return to automatic board finding.',
      );
      return;
    }
    if (!nextQuality.pass) {
      setLiveMessage(nextQuality.blockers[0] ?? 'Improve the optional guide before continuing.');
      return;
    }
    setHomography(nextHomography);
    setPhase('ready-to-play');
    setLiveMessage('Optional guide recovery is ready. With the board clear, tap Start Play.');
  };

  const startLiveReferenceCapture = () => {
    if (homography === null || quality?.pass !== true) {
      setLiveMessage(
        'I am still finding a usable board. Keep the board visible, or use optional recovery only if auto-find cannot recover.',
      );
      return;
    }

    clearReferenceCapture();
    const generation = referenceCaptureGenerationRef.current;
    setReference(null);
    setAnalysis(null);
    setHeldCandidate(null);
    setLastRecorded(null);
    stabilityRef.current = null;
    setPhase('capturing-reference');
    setLiveMessage('Starting live play. Keep the board clear for a brief moment…');

    let missingFrameRetries = 0;
    const captureFreshReference = () => {
      if (generation !== referenceCaptureGenerationRef.current) return;
      referenceCaptureTimerRef.current = null;
      const decision = resolveStartPlayReferenceCapture(captureFrame(), {
        retryCount: missingFrameRetries,
      });
      if (decision.kind === 'retry') {
        missingFrameRetries += 1;
        setLiveMessage('Waiting for a complete camera frame before starting live play…');
        referenceCaptureTimerRef.current = window.setTimeout(
          captureFreshReference,
          decision.delayMs,
        );
        return;
      }
      if (decision.kind === 'camera-frame-unavailable') {
        setPhase('ready-to-play');
        setLiveMessage(
          'The live camera frame was not ready. Wait for the preview, then tap Start Play once more.',
        );
        return;
      }

      // This is intentionally a bounded timed handoff, not a second dart-detection state machine.
      // Board finding has already required two comparable automatic fits. Capturing the fresh frame
      // here avoids treating ordinary video noise, a removed dart, or a transient hand as a reason
      // to trap the player in setup.
      setReference(decision.reference);
      setAnalysis(null);
      setPhase('watching');
      setLiveMessage('Watching locally. Throw one dart, then step clear while it settles.');
    };

    referenceCaptureTimerRef.current = window.setTimeout(
      captureFreshReference,
      START_PLAY_REFERENCE_SETTLE_MS,
    );
  };
  const startPlay = () => {
    startLiveReferenceCapture();
  };

  const recordCandidate = useCallback(
    (
      candidate: DartTipCandidate,
      frame: CameraFrame,
      candidateAnalysis: DifferenceAnalysis,
      source: 'auto' | 'corrected',
    ): number | null => {
      const slot = onAddProposal({
        zone: candidate.zone,
        confidence: candidate.confidence,
        wireMarginMm: candidate.wireMarginMm,
        source,
      });
      if (slot === null) return null;

      // Carry a clearly accepted bounded board-relative similarity correction into the next local reference.
      // Without this, a dart after mobile optical stabilization could be decoded against a stale
      // pre-impact guide even when its own local change was correctly aligned.
      const frameAlignment = candidateAnalysis.alignment;
      const hasPoseCorrection =
        frameAlignment.offset.x !== 0 ||
        frameAlignment.offset.y !== 0 ||
        frameAlignment.scale !== 1 ||
        frameAlignment.rotationRadians !== 0;
      if (fit !== null && hasPoseCorrection) {
        const currentFitCenter = boardFitCenter(fit);
        const correctedFit = transformBoardFit(
          fit,
          currentFitCenter,
          {
            x: currentFitCenter.x + frameAlignment.offset.x,
            y: currentFitCenter.y + frameAlignment.offset.y,
          },
          frameAlignment.scale,
          frameAlignment.rotationRadians,
        );
        const correctedHomography = solveImageToBoardHomography(
          correctedFit,
          BOARD_FIT_CANONICAL_ANCHORS,
        );
        if (correctedHomography !== null) {
          fitRef.current = correctedFit;
          setFit(correctedFit);
          setHomography(correctedHomography);
        }
      }
      setReference(frame);
      setHeldCandidate(null);
      setLastRecorded({
        slot,
        zone: candidate.zone,
        imagePoint: candidate.imagePoint,
      });
      stabilityRef.current = null;
      return slot;
    },
    [fit, onAddProposal],
  );

  useEffect(() => {
    if (
      !isWatching ||
      reference === null ||
      homography === null ||
      availableSlots <= 0 ||
      gameComplete
    ) {
      return;
    }
    let cancelled = false;

    const analyzeCurrentFrame = () => {
      if (cancelled || recordingRef.current) return;
      const frame = captureFrame();
      if (frame === null) return;
      const nextAnalysis = analyzeDartDifference(reference, frame, homography, {
        ...(quality?.boardDiameterPixels === undefined
          ? {}
          : { boardDiameterPixels: quality.boardDiameterPixels }),
        // A near-centreline mounted phone sees a dart on the board face, not across most of the
        // lower room. Keep the outside-flight search tight there; retain more margin only when the
        // fitted board is genuinely oblique.
        acceptedRadiusMm: analysisRadiusForBoardSkew(quality?.estimatedOffAxisDegrees),
      });
      if (cancelled) return;
      setAnalysis(nextAnalysis);

      if (nextAnalysis.status === 'no-change') {
        const previous = stabilityRef.current;
        stabilityRef.current =
          previous !== null && previous.misses === 0 ? { ...previous, misses: 1 } : null;
        setLiveMessage('Watching the board. Throw one dart, then step clear while it settles.');
        return;
      }
      if (nextAnalysis.status === 'camera-moved-or-hand-present') {
        stabilityRef.current = null;
        setLiveMessage(
          'I see broad movement. Keep the mount still and move hands out of the frame.',
        );
        return;
      }
      if (nextAnalysis.status === 'incompatible-frame') {
        stabilityRef.current = null;
        setLiveMessage(
          'Camera framing or resolution changed. Tap Find Board Again, wait for Board Found, then Start Play with an empty board.',
        );
        return;
      }
      if (nextAnalysis.status !== 'dart-candidate') {
        const previous = stabilityRef.current;
        stabilityRef.current =
          previous !== null && previous.misses === 0 ? { ...previous, misses: 1 } : null;
        setLiveMessage(
          'A change is visible, but it does not yet look like one settled dart or compact flight. Waiting safely.',
        );
        return;
      }

      // `selectAutomaticTipCandidate` is an eligibility gate as well as a ranker: it refuses a
      // compact-flight centroid, an equal-width endpoint pair, a near-wire endpoint, and MISS.
      // Never convert those clues into an arbitrary score just because they persisted twice. A
      // board-edge foreground disturbance can retain a local suggestion, but it must take the
      // explicit review path even if the dart silhouette itself looks direct.
      const candidate = nextAnalysis.requiresExplicitReview
        ? null
        : selectAutomaticTipCandidate(nextAnalysis.candidates);
      const reviewCandidate =
        candidate === null ? selectReviewTipCandidate(nextAnalysis.candidates) : null;
      const stableCandidate = candidate ?? reviewCandidate;
      if (stableCandidate === null) {
        const previous = stabilityRef.current;
        stabilityRef.current =
          previous !== null && previous.misses === 0 ? { ...previous, misses: 1 } : null;
        setLiveMessage(
          'Dart-like changes compete or cannot be mapped safely. Nothing was auto-scored; use Review / Enter Score if the dart is settled.',
        );
        return;
      }
      // Component ordering and an elongated shaft's apparent endpoint can fluctuate by a few pixels
      // between video frames. Stabilize the physical board zone plus nearby image location instead
      // of the temporary connected-component id, otherwise a real settled dart can be held forever.
      const zoneKey = `${stableCandidate.zone.ring}:${stableCandidate.zone.segment ?? 'bull'}`;
      const previous = stabilityRef.current;
      const count =
        previous?.zoneKey === zoneKey &&
        distance(previous.imagePoint, stableCandidate.imagePoint) <= 18
          ? previous.count + 1
          : 1;
      stabilityRef.current = { zoneKey, imagePoint: stableCandidate.imagePoint, count, misses: 0 };
      if (count < 2) {
        setLiveMessage(
          nextAnalysis.requiresExplicitReview
            ? 'A board-edge change is present. Holding the dart-shaped clue for one settled review frame…'
            : 'Dart/flight change found. Holding for one more settled frame…',
        );
        return;
      }

      if (candidate === null) {
        // The preceding stable-candidate guard makes this true in practice, but retain the explicit
        // guard so a future selector change cannot turn an absent review candidate into a score.
        if (reviewCandidate === null) {
          stabilityRef.current = null;
          setLiveMessage('The camera suggestion was incomplete. Nothing was recorded.');
          return;
        }
        // A stable review suggestion is useful for correction flow, but remains unrecorded until the
        // player deliberately accepts it. This keeps normal Camera Play tip-click-free without
        // pretending a compact or tied endpoint is an automatic score.
        setHeldCandidate({ candidate: reviewCandidate, frame, analysis: nextAnalysis });
        stabilityRef.current = null;
        setPhase('reviewing-candidate');
        setLiveMessage(
          `${formatZone(reviewCandidate.zone)} is a held camera suggestion, not an automatic score. Confirm it or use Review / Enter Score.`,
        );
        return;
      }

      recordingRef.current = true;
      const slot = recordCandidate(candidate, frame, nextAnalysis, 'auto');
      if (slot === null) {
        recordingRef.current = false;
        setLiveMessage(
          'That turn is full. Review or confirm the scores before recording another dart.',
        );
        return;
      }

      setLiveMessage(
        `Dart ${slot}: ${formatZone(candidate.zone)} added. ${slot >= 3 ? 'Review and confirm the turn.' : 'Throw the next dart.'}`,
      );
      if (slot >= 3) setPhase('turn-ready');
      window.setTimeout(() => {
        recordingRef.current = false;
      }, 700);
    };

    analyzeCurrentFrame();
    const interval = window.setInterval(analyzeCurrentFrame, LOCAL_ANALYSIS_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    availableSlots,
    captureFrame,
    fit,
    gameComplete,
    homography,
    isWatching,
    recordCandidate,
    quality?.boardDiameterPixels,
    reference,
  ]);

  const acceptHeldCandidate = () => {
    if (heldCandidate === null || recordingRef.current) return;
    recordingRef.current = true;
    const { candidate, frame, analysis: heldAnalysis } = heldCandidate;
    // The player has explicitly accepted this tentative location, so retain it as a corrected
    // score rather than misrepresenting the compact/ambiguous visual cue as automatic inference.
    const slot = recordCandidate(candidate, frame, heldAnalysis, 'corrected');
    if (slot === null) {
      recordingRef.current = false;
      setLiveMessage(
        'That turn is full. Review or confirm the scores before recording another dart.',
      );
      return;
    }
    setLiveMessage(
      `Dart ${slot}: ${formatZone(candidate.zone)} recorded after your check. ${slot >= 3 ? 'Review and confirm the turn.' : 'Throw the next dart.'}`,
    );
    if (slot >= 3) setPhase('turn-ready');
    else setPhase('watching');
    window.setTimeout(() => {
      recordingRef.current = false;
    }, 700);
  };

  const beginNextTurn = () => {
    if (homography === null) {
      restartAutomaticBoardFind();
      return;
    }
    startLiveReferenceCapture();
  };

  const confirmTurn = () => {
    if (!onConfirmVisit()) return;
    setAnalysis(null);
    setHeldCandidate(null);
    setReference(null);
    clearReferenceCapture();
    stabilityRef.current = null;
    setPhase('awaiting-clear');
    setLiveMessage(
      gameComplete
        ? 'The game is complete. Review the final result in Play demo.'
        : 'Turn confirmed. Remove all darts, then capture the next clear board with one tap.',
    );
  };

  const pointForEvent = (event: PointerEvent<HTMLCanvasElement>): ImagePoint | null => {
    const canvas = previewCanvasRef.current;
    if (canvas === null) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const handleHitRadiusForEvent = (event: PointerEvent<HTMLCanvasElement>): number => {
    const canvas = previewCanvasRef.current;
    if (canvas === null) return MIN_HANDLE_HIT_RADIUS;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0) return MIN_HANDLE_HIT_RADIUS;
    // Keep roughly a 56 px-wide touch hit area when a high-resolution camera canvas is downscaled.
    return Math.max(MIN_HANDLE_HIT_RADIUS, (28 * canvas.width) / rect.width);
  };

  const startTransformGesture = () => {
    const pointers = [...activePointersRef.current.entries()].slice(0, 2);
    const currentFit = fitRef.current;
    if (pointers.length !== 2 || currentFit === null) return;
    const [first, second] = pointers;
    if (first === undefined || second === undefined) return;
    const firstPoint = first[1];
    const secondPoint = second[1];
    gestureRef.current = {
      kind: 'transform',
      pointerIds: [first[0], second[0]],
      startFit: currentFit,
      startCenter: midpoint(firstPoint, secondPoint),
      startDistance: Math.max(1, distance(firstPoint, secondPoint)),
      startAngle: Math.atan2(secondPoint.y - firstPoint.y, secondPoint.x - firstPoint.x),
    };
  };

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (phase !== 'manual-fit' || fitRef.current === null) return;
    const point = pointForEvent(event);
    if (point === null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointersRef.current.set(event.pointerId, point);
    if (activePointersRef.current.size >= 2) {
      startTransformGesture();
      return;
    }
    const currentFit = fitRef.current;
    if (currentFit === null) return;
    const handleIndex = nearestBoardFitHandle(point, currentFit, handleHitRadiusForEvent(event));
    if (handleIndex !== null) {
      gestureRef.current = { kind: 'handle', pointerId: event.pointerId, handleIndex };
      setLiveMessage(
        handleIndex === 0
          ? 'Move the 20 handle to the outer double wire at the real 20.'
          : 'Pull this edge handle until the board guide follows the outer double wire.',
      );
      return;
    }
    if (pointIsInsideBoardFit(point, currentFit)) {
      gestureRef.current = {
        kind: 'move',
        pointerId: event.pointerId,
        start: point,
        last: point,
        startFit: currentFit,
      };
      setLiveMessage('Drag the guide to move it, or tap inside it to center it there.');
    }
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = pointForEvent(event);
    if (point === null) return;
    if (!activePointersRef.current.has(event.pointerId)) return;
    activePointersRef.current.set(event.pointerId, point);
    const gesture = gestureRef.current;
    if (gesture === null) return;

    if (gesture.kind === 'transform') {
      const [firstPointerId, secondPointerId] = gesture.pointerIds;
      const first = activePointersRef.current.get(firstPointerId);
      const second = activePointersRef.current.get(secondPointerId);
      if (first === undefined || second === undefined) return;
      const nextCenter = midpoint(first, second);
      const nextDistance = Math.max(1, distance(first, second));
      const nextAngle = Math.atan2(second.y - first.y, second.x - first.x);
      setFit(
        transformBoardFit(
          gesture.startFit,
          gesture.startCenter,
          nextCenter,
          nextDistance / gesture.startDistance,
          nextAngle - gesture.startAngle,
        ),
      );
      return;
    }
    if (gesture.pointerId !== event.pointerId) return;
    if (gesture.kind === 'handle') {
      setFit((current) =>
        current === null ? current : moveBoardFitHandle(current, gesture.handleIndex, point),
      );
      return;
    }
    const deltaX = point.x - gesture.last.x;
    const deltaY = point.y - gesture.last.y;
    gestureRef.current = { ...gesture, last: point };
    setFit((current) => (current === null ? current : translateBoardFit(current, deltaX, deltaY)));
  };

  const endPointer = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = pointForEvent(event);
    const gesture = gestureRef.current;
    if (
      point !== null &&
      gesture?.kind === 'move' &&
      gesture.pointerId === event.pointerId &&
      distance(point, gesture.start) < 5
    ) {
      setFit(
        translateBoardFit(
          gesture.startFit,
          point.x - boardFitCenter(gesture.startFit).x,
          point.y - boardFitCenter(gesture.startFit).y,
        ),
      );
    }
    activePointersRef.current.delete(event.pointerId);
    if (activePointersRef.current.size < 2) gestureRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // The pointer may already have been released by the browser.
    }
  };

  const visibleQuality = useMemo(() => {
    if (quality === null) return null;
    return `${Math.round(quality.boardDiameterPixels)} px board · ${Math.round(quality.estimatedOffAxisDegrees)}° board skew · ${Math.round(quality.sharpness)} focus`;
  }, [quality]);
  const needsImmediateScoreRecovery =
    isWatching &&
    analysis !== null &&
    (analysis.status === 'camera-moved-or-hand-present' ||
      analysis.status === 'ambiguous-change' ||
      (analysis.status === 'dart-candidate' &&
        (analysis.requiresExplicitReview ||
          (selectAutomaticTipCandidate(analysis.candidates) === null &&
            selectReviewTipCandidate(analysis.candidates) === null))));

  return (
    <section className="camera-play shell">
      <header className="camera-play-intro">
        <div>
          <p className="eyebrow">CAMERA PLAY · LOCAL BROWSER FIELD TEST</p>
          <h1>
            Point it.
            <br />
            <em>Play.</em>
          </h1>
          <p>
            Mount the phone near the board centreline. Darts 180 finds the red and green scoring
            bands, maps the board locally, then auto-scores only a settled dart with a direct entry
            cue. Ambiguous darts stay correctable. No photos leave this browser.
          </p>
        </div>
        <aside className="camera-play-privacy-card">
          <span>YOUR CAMERA</span>
          <strong>Browser-local only</strong>
          <p>
            No image upload, account, calibration-point clicks, guide fitting, or dart-tip clicking
            in normal play.
          </p>
        </aside>
      </header>

      <div className="camera-play-grid">
        <section className="camera-play-stage" aria-label="Live camera board">
          <div className="camera-play-stage-head">
            <div>
              <p className="eyebrow">
                {!cameraActive
                  ? 'STEP 1 · START CAMERA'
                  : phase === 'finding-board'
                    ? 'AUTO-FINDING BOARD'
                    : phase === 'manual-fit'
                      ? 'OPTIONAL GUIDE RECOVERY'
                      : phase === 'ready-to-play'
                        ? 'BOARD FOUND'
                        : phase === 'capturing-reference'
                          ? 'STARTING LIVE PLAY'
                          : phase === 'reviewing-candidate'
                            ? 'CAMERA SUGGESTION HELD'
                            : 'PLAYING LOCALLY'}
              </p>
              <h2>
                {!cameraActive
                  ? 'Point the rear camera at the board.'
                  : phase === 'finding-board'
                    ? 'Looking for red and green scoring bands.'
                    : phase === 'manual-fit'
                      ? 'Only use this guide if auto-find cannot recover.'
                      : phase === 'ready-to-play'
                        ? 'Board found. Clear it, then start play.'
                        : phase === 'capturing-reference'
                          ? 'Starting live play.'
                          : phase === 'reviewing-candidate'
                            ? 'Check the held camera suggestion.'
                            : 'Watching for a settled dart.'}
              </h2>
            </div>
            <span className={`camera-state ${cameraActive ? 'on' : ''}`}>
              {cameraActive ? 'LIVE' : 'OFF'}
            </span>
          </div>

          <div className={`camera-play-surface ${guideLocked ? 'is-locked' : ''}`}>
            <video className="camera-play-source" autoPlay muted playsInline ref={videoRef} />
            <canvas aria-hidden="true" className="camera-play-frame-buffer" ref={frameCanvasRef} />
            <canvas
              aria-label={
                phase === 'manual-fit'
                  ? 'Optional manual board guide. Drag to move, use two fingers to pinch or twist, and pull each edge handle to fit the board.'
                  : phase === 'finding-board'
                    ? 'Live camera. Darts 180 is automatically looking for the board colors.'
                    : 'Live camera. Board found automatically.'
              }
              className="camera-play-canvas"
              onPointerCancel={endPointer}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={endPointer}
              ref={previewCanvasRef}
            />
            {!cameraActive && (
              <div className="camera-play-empty">
                <span>⌁</span>
                <strong>Rear camera stays on this device.</strong>
                <p>Open this direct HTTPS page in Safari or Chrome on the mounted phone.</p>
              </div>
            )}
            {cameraActive && phase === 'finding-board' && (
              <div className="camera-play-gesture-chip auto">
                LOOKING FOR RED + GREEN BOARD COLORS
              </div>
            )}
            {cameraActive && phase === 'manual-fit' && (
              <div className="camera-play-gesture-chip">
                OPTIONAL ONLY · 20 ↑ · DRAG · PINCH · TWIST
              </div>
            )}
            {cameraActive && phase === 'ready-to-play' && (
              <div className="camera-play-gesture-chip locked">BOARD FOUND · 20 ↑ UPRIGHT</div>
            )}
            {cameraActive &&
              (phase === 'capturing-reference' ||
                phase === 'watching' ||
                phase === 'reviewing-candidate' ||
                phase === 'turn-ready' ||
                phase === 'awaiting-clear') && (
                <div className="camera-play-gesture-chip locked">
                  {phase === 'capturing-reference'
                    ? 'STARTING LIVE PLAY'
                    : phase === 'reviewing-candidate'
                      ? 'CAMERA SUGGESTION · CHECK SCORE'
                      : 'BOARD FOUND · WATCHING LOCALLY'}
                </div>
              )}
          </div>

          <div className="camera-play-stage-actions">
            {!cameraActive ? (
              <button className="button primary" onClick={startCamera}>
                START REAR CAMERA
              </button>
            ) : phase === 'finding-board' ? (
              <>
                <button className="button ghost compact" onClick={restartAutomaticBoardFind}>
                  FIND BOARD AGAIN
                </button>
                <button className="text-button" onClick={stopCamera}>
                  STOP CAMERA
                </button>
              </>
            ) : phase === 'manual-fit' ? (
              <>
                <button className="button primary" onClick={useOptionalManualGuide}>
                  USE OPTIONAL GUIDE
                </button>
                <button className="text-button" onClick={restartAutomaticBoardFind}>
                  USE AUTO BOARD FIND
                </button>
              </>
            ) : phase === 'ready-to-play' ? (
              <>
                <button className="button primary" disabled={!canStartPlay} onClick={startPlay}>
                  START PLAY
                </button>
                <button className="text-button" onClick={restartAutomaticBoardFind}>
                  FIND AGAIN
                </button>
              </>
            ) : (
              <>
                <button className="button ghost compact" onClick={restartAutomaticBoardFind}>
                  FIND BOARD AGAIN
                </button>
                <button className="text-button" onClick={stopCamera}>
                  STOP CAMERA
                </button>
              </>
            )}
          </div>
          {cameraError !== null && <p className="camera-error">{cameraError}</p>}
          <p className="camera-play-notice" role="status">
            {liveMessage}
          </p>
          {needsImmediateScoreRecovery && (
            <button className="text-button camera-play-inline-recovery" onClick={onOpenReview}>
              CHECK / ENTER SCORE
            </button>
          )}
        </section>

        <aside className="camera-play-turn">
          <div className="camera-play-turn-head">
            <div>
              <p className="eyebrow">LIVE TURN · {activePlayerName.toUpperCase()}</p>
              <h2>{turnTotal} points</h2>
            </div>
            <span>{turnCount}/3 DARTS</span>
          </div>

          <div className="camera-play-darts" aria-label="Camera score suggestions">
            {turnDarts.map((dart) => {
              const needsReview =
                dart.filled &&
                dart.source === 'auto' &&
                (dart.confidence < 0.7 || dart.wireMarginMm < 1.5);
              return (
                <button
                  className={`camera-play-dart ${dart.filled ? 'is-filled' : ''} ${needsReview ? 'needs-review' : ''}`}
                  disabled={!dart.filled}
                  key={dart.slot}
                  onClick={dart.filled ? onOpenReview : undefined}
                  type="button"
                >
                  <span>DART {dart.slot}</span>
                  <strong>{dart.filled ? formatZone(dart.zone) : '—'}</strong>
                  <em>
                    {!dart.filled
                      ? isReviewingCandidate
                        ? 'Check held camera suggestion'
                        : isLiveScoring
                          ? isCapturingReference
                            ? 'Starting live play'
                            : 'Watching for a settled dart'
                          : 'Waiting to play'
                      : needsReview
                        ? 'Tap to correct if needed'
                        : 'Camera suggestion · tap to correct'}
                  </em>
                  {dart.filled && dart.source === 'auto' && (
                    <i>
                      {Math.round(dart.confidence * 100)}% heuristic cue ·{' '}
                      {dart.wireMarginMm.toFixed(1)} mm from wire
                    </i>
                  )}
                </button>
              );
            })}
          </div>

          {heldCandidate !== null && isReviewingCandidate && (
            <div className="camera-play-held-candidate">
              <span>HELD CAMERA SUGGESTION · NOT AUTO-RECORDED</span>
              <strong>{formatZone(heldCandidate.candidate.zone)}</strong>
              <p>
                The dart-shaped change settled, but its entry direction or wire margin is not safe
                enough to fill a DartCard automatically. Check the physical score before accepting.
              </p>
              <button className="button primary" onClick={acceptHeldCandidate} type="button">
                USE {formatZone(heldCandidate.candidate.zone)}
              </button>
            </div>
          )}

          {lastRecorded !== null && (
            <div className="camera-play-last-score">
              <span>LAST LOCAL SUGGESTION</span>
              <strong>
                DART {lastRecorded.slot} · {formatZone(lastRecorded.zone)}
              </strong>
              <p>
                It used a new dart-shaped visual change, not the player choosing a steel or soft
                tip. Correct the score if it does not match the board.
              </p>
            </div>
          )}

          {phase === 'awaiting-clear' ? (
            <button className="button primary" disabled={gameComplete} onClick={beginNextTurn}>
              {gameComplete ? 'GAME COMPLETE' : 'BOARD CLEAR · START NEXT TURN'}
            </button>
          ) : (
            <button
              className="button primary"
              disabled={turnCount === 0 || gameComplete}
              onClick={confirmTurn}
            >
              CONFIRM {turnCount === 3 ? 'TURN' : 'CURRENT DARTS'}
            </button>
          )}
          <button className="button ghost" disabled={gameComplete} onClick={onOpenReview}>
            {turnCount === 0 ? 'REVIEW / ENTER SCORE' : 'REVIEW OR CORRECT SCORES'}
          </button>

          {(automaticFit !== null ||
            visibleQuality !== null ||
            (analysis !== null && isDetectorStateVisible)) && (
            <details className="camera-play-diagnostics">
              <summary>CAMERA DIAGNOSTICS</summary>
              <div className="camera-play-diagnostics-body">
                {automaticFit !== null && phase !== 'manual-fit' && (
                  <p className={`camera-play-auto-state ${automaticFit.status}`}>
                    <strong>AUTO BOARD FIND</strong>
                    {automaticFit.message}
                    {automaticFit.fit !== null && (
                      <span>
                        {Math.round(automaticFit.estimatedBoardDiameterPixels)} px board ·{' '}
                        {automaticFit.outerAngularCoverage}/20 outer-band sectors ·{' '}
                        {automaticFit.redPixelCount.toLocaleString()} red /{' '}
                        {automaticFit.greenPixelCount.toLocaleString()} green samples ·{' '}
                        {Math.round(automaticFit.outerAlternatingColorStrength * 100)}% alternating
                        · {Math.round(automaticFit.bandColorPhaseAgreement * 100)}% band agreement ·{' '}
                        {Math.round(automaticFit.confidence * 100)}% color-pattern cue
                      </span>
                    )}
                  </p>
                )}

                {visibleQuality !== null && (
                  <p className={`camera-play-quality ${quality?.pass ? 'pass' : 'warn'}`}>
                    <strong>{quality?.pass ? 'BOARD CHECKED' : 'BOARD NEEDS WORK'}</strong>
                    {visibleQuality}
                    {quality?.blockers[0] !== undefined && <span>{quality.blockers[0]}</span>}
                    {quality?.warnings[0] !== undefined && <span>{quality.warnings[0]}</span>}
                  </p>
                )}

                {analysis !== null && isDetectorStateVisible && (
                  <p className="camera-play-engine-state">
                    <strong>
                      LOCAL DETECTOR · {analysis.status.replaceAll('-', ' ').toUpperCase()}
                    </strong>
                    <span>
                      {analysis.status === 'dart-candidate'
                        ? analysis.requiresExplicitReview
                          ? 'A board-edge foreground change is present, so any isolated dart clue is held for explicit review.'
                          : analysis.shapes.some((shape) => shape.kind === 'compact')
                            ? 'Compact flight/occlusion found; held for correction because its entry direction is not directly visible.'
                            : selectAutomaticTipCandidate(analysis.candidates) === null
                              ? 'Dart-shaped change found, but its endpoint evidence is held for correction instead of being auto-scored.'
                              : 'Settled dart-shaped change found; checking its direct entry cue over another frame.'
                        : analysis.status === 'camera-moved-or-hand-present'
                          ? 'Broad movement held for safety.'
                          : analysis.message}
                    </span>
                    <small>
                      {analysis.changedPixels.toLocaleString()} changed /{' '}
                      {analysis.comparedPixels.toLocaleString()} board-support px ·{' '}
                      {(analysis.changedFraction * 100).toFixed(2)}% support ·{' '}
                      {(analysis.stableCoreChangedFraction * 100).toFixed(2)}% stable core ·
                      threshold {Math.round(analysis.differenceThreshold)} · align{' '}
                      {analysis.alignmentOffset.x >= 0 ? '+' : ''}
                      {analysis.alignmentOffset.x},{analysis.alignmentOffset.y >= 0 ? '+' : ''}
                      {analysis.alignmentOffset.y} px · {analysis.alignment.scale.toFixed(3)}× ·{' '}
                      {((analysis.alignment.rotationRadians * 180) / Math.PI).toFixed(1)}° ·{' '}
                      {analysis.shapes.length} shape{analysis.shapes.length === 1 ? '' : 's'}
                    </small>
                  </p>
                )}
              </div>
            </details>
          )}
        </aside>
      </div>

      <section className="camera-play-how">
        <div>
          <p className="eyebrow">NO-CALIBRATION PLAYER FLOW</p>
          <h2>Point the phone. Let the board find itself.</h2>
        </div>
        <ol>
          <li>
            <b>Show the board</b>
            Keep the whole double ring visible, with the physical 20 upright in the camera image.
          </li>
          <li>
            <b>Wait for Board Found</b>
            The browser looks for the standard board’s red/green scoring pattern and confirms when
            it is ready.
          </li>
          <li>
            <b>Start Play</b>
            With an empty board, one tap saves a fresh local reference and starts live scoring.
          </li>
          <li>
            <b>Correct only when needed</b>
            Scores are heuristic proposals from new dart-shaped changes, not proven auto-scoring.
          </li>
        </ol>
      </section>

      <details className="camera-play-disclosure">
        <summary>Board not found? Optional recovery &amp; advanced diagnostics</summary>
        <p>
          Normal play has no calibration. If board-color detection cannot recover because of an
          unusual board, glare, or extreme perspective, use the optional visual guide. It supports
          drag/tap, pinch, twist, and edge handles, but is never required for the normal path.
        </p>
        <button className="text-button" onClick={startOptionalManualGuide}>
          USE OPTIONAL VISUAL GUIDE →
        </button>
        <p>
          The advanced field-test view exposes named anchors, explicit frame analysis, and endpoint
          inspection for engineering diagnosis only.
        </p>
        <button className="text-button" onClick={onOpenAdvanced}>
          OPEN ADVANCED FIELD TEST →
        </button>
      </details>
    </section>
  );
}

function drawBoardGuide(
  context: CanvasRenderingContext2D,
  fit: BoardFitPoints | null,
  locked: boolean,
  lastImagePoint: ImagePoint | null,
  lastZone: DartZone | null,
) {
  if (fit === null) return;
  const imageToBoard = solveImageToBoardHomography(fit, BOARD_FIT_CANONICAL_ANCHORS);
  const boardToImage = imageToBoard === null ? null : invertHomography(imageToBoard);
  // Normal Camera Play should feel like a camera, not a calibration screen. Detailed rings, spokes,
  // handles, and the 20 marker are reserved for the explicit optional recovery guide.
  const showRecoveryGuide = !locked;
  const color = showRecoveryGuide ? '#f5c26a' : 'rgba(143, 220, 193, 0.72)';
  context.save();
  context.lineJoin = 'round';
  context.lineCap = 'round';

  if (boardToImage !== null) {
    const rings = showRecoveryGuide
      ? [
          BOARD_RADII_MM.doubleOuter,
          BOARD_RADII_MM.doubleInner,
          BOARD_RADII_MM.trebleOuter,
          BOARD_RADII_MM.trebleInner,
          BOARD_RADII_MM.outerBull,
          BOARD_RADII_MM.innerBull,
        ]
      : [BOARD_RADII_MM.doubleOuter];
    rings.forEach((radius, index) => {
      traceProjectedCircle(context, boardToImage, radius);
      context.strokeStyle = index === 0 ? color : 'rgba(232, 255, 244, 0.62)';
      context.lineWidth = index === 0 ? (showRecoveryGuide ? 2.8 : 1.5) : 1.1;
      context.stroke();
    });

    if (showRecoveryGuide) {
      for (let index = 0; index < 20; index += 1) {
        const degrees = index * 18 - 9;
        const radians = (degrees * Math.PI) / 180;
        const inner = mapBoardPointToImage(
          {
            xMm: Math.sin(radians) * BOARD_RADII_MM.outerBull,
            yMm: -Math.cos(radians) * BOARD_RADII_MM.outerBull,
          },
          boardToImage,
        );
        const outer = mapBoardPointToImage(
          {
            xMm: Math.sin(radians) * BOARD_RADII_MM.doubleOuter,
            yMm: -Math.cos(radians) * BOARD_RADII_MM.doubleOuter,
          },
          boardToImage,
        );
        if (inner === null || outer === null) continue;
        context.beginPath();
        context.moveTo(inner.x, inner.y);
        context.lineTo(outer.x, outer.y);
        context.strokeStyle = 'rgba(232, 255, 244, 0.5)';
        context.lineWidth = 0.8;
        context.stroke();
      }

      const center = mapBoardPointToImage({ xMm: 0, yMm: 0 }, boardToImage);
      if (center !== null) {
        context.beginPath();
        context.moveTo(center.x - 10, center.y);
        context.lineTo(center.x + 10, center.y);
        context.moveTo(center.x, center.y - 10);
        context.lineTo(center.x, center.y + 10);
        context.strokeStyle = color;
        context.lineWidth = 1.5;
        context.stroke();
      }
    }
  } else {
    context.beginPath();
    fit.forEach((point, index) =>
      index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y),
    );
    context.closePath();
    context.strokeStyle = '#ffae7a';
    context.lineWidth = 2.5;
    context.stroke();
  }

  if (showRecoveryGuide) {
    fit.forEach((point, index) => {
      context.beginPath();
      context.arc(point.x, point.y, index === 0 ? 24 : 20, 0, Math.PI * 2);
      context.fillStyle = '#f5c26a';
      context.fill();
      context.strokeStyle = '#062016';
      context.lineWidth = 2;
      context.stroke();
      if (index === 0) {
        context.fillStyle = '#062016';
        context.font = '900 12px ui-sans-serif, system-ui, sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText('20', point.x, point.y + 0.5);
        context.fillStyle = '#f5fff9';
        context.font = '900 11px ui-sans-serif, system-ui, sans-serif';
        context.fillText('20 ↑', point.x, point.y - 36);
      }
    });
  }

  if (lastImagePoint !== null && lastZone !== null) {
    // This shows the internally selected image endpoint after scoring; it is never a player input.
    context.beginPath();
    context.arc(lastImagePoint.x, lastImagePoint.y, 11, 0, Math.PI * 2);
    context.fillStyle = 'rgba(8, 32, 22, 0.88)';
    context.fill();
    context.strokeStyle = '#8fdcc1';
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = '#effff7';
    context.font = '900 10px ui-sans-serif, system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(formatZone(lastZone), lastImagePoint.x, lastImagePoint.y + 0.5);
  }
  context.restore();
}

function traceProjectedCircle(
  context: CanvasRenderingContext2D,
  boardToImage: Homography,
  radiusMm: number,
) {
  let started = false;
  context.beginPath();
  for (let index = 0; index <= 80; index += 1) {
    const radians = (index / 80) * Math.PI * 2;
    const point = mapBoardPointToImage(
      { xMm: Math.sin(radians) * radiusMm, yMm: -Math.cos(radians) * radiusMm },
      boardToImage,
    );
    if (point === null) continue;
    if (!started) {
      context.moveTo(point.x, point.y);
      started = true;
    } else {
      context.lineTo(point.x, point.y);
    }
  }
  context.closePath();
}

function distance(first: ImagePoint, second: ImagePoint): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function midpoint(first: ImagePoint, second: ImagePoint): ImagePoint {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}
