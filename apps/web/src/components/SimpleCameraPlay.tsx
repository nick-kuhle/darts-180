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
  boardFitsAreSimilar,
  detectBoardFitFromColors,
  type AutoBoardFitResult,
} from '../lib/autoBoardFit';
import {
  analyzeDartDifference,
  assessAutomaticBoardFitQuality,
  assessBoardFitCalibration,
  frameFromImageData,
  selectAutomaticTipCandidate,
  type CameraFrame,
  type DifferenceAnalysis,
  type GuidedCalibrationQuality,
} from '../lib/cameraScoring';
import { describeCameraAccessError, getCameraAccessPreflightMessage } from '../lib/cameraAccess';
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

const MAX_WORKING_EDGE = 960;
const MIN_HANDLE_HIT_RADIUS = 24;

type CameraPhase =
  'finding-board' | 'manual-fit' | 'ready-to-play' | 'watching' | 'turn-ready' | 'awaiting-clear';

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
  const stabilityRef = useRef<{ key: string; count: number } | null>(null);
  const autoFitStabilityRef = useRef<{ fit: BoardFitPoints; count: number } | null>(null);
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
    stabilityRef.current = null;
    autoFitStabilityRef.current = null;
    recordingRef.current = false;
    setCameraActive(false);
    setFit(null);
    setReference(null);
    setHomography(null);
    setQuality(null);
    setAutomaticFit(null);
    setPhase('finding-board');
  }, []);

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
      if (result.fit === null) {
        autoFitStabilityRef.current = null;
        setFit(null);
        setHomography(null);
        setQuality(null);
        setLiveMessage(result.message);
        return;
      }

      const previous = autoFitStabilityRef.current;
      const count =
        previous !== null && boardFitsAreSimilar(previous.fit, result.fit) ? previous.count + 1 : 1;
      autoFitStabilityRef.current = { fit: result.fit, count };
      setFit(result.fit);
      if (count < 2) {
        setLiveMessage('Board colors found. Checking that the automatic guide is steady…');
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
    const interval = window.setInterval(findBoard, 550);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [cameraActive, captureFrame, gameComplete, phase]);

  const startOptionalManualGuide = () => {
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

  const startPlay = () => {
    if (homography === null || quality?.pass !== true) {
      setLiveMessage(
        'I am still finding a usable board. Keep the board visible, or use optional recovery only if auto-find cannot recover.',
      );
      return;
    }
    const frame = captureFrame();
    if (frame === null) {
      setLiveMessage('Waiting for a complete live camera frame before starting play.');
      return;
    }
    setReference(frame);
    setAnalysis(null);
    setLastRecorded(null);
    stabilityRef.current = null;
    setPhase('watching');
    setLiveMessage(
      'Playing locally. Throw one dart, step clear, and the score will appear after it settles.',
    );
  };

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
      const nextAnalysis = analyzeDartDifference(
        reference,
        frame,
        homography,
        quality?.boardDiameterPixels === undefined
          ? {}
          : { boardDiameterPixels: quality.boardDiameterPixels },
      );
      if (cancelled) return;
      setAnalysis(nextAnalysis);

      if (nextAnalysis.status === 'no-change') {
        stabilityRef.current = null;
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
        stabilityRef.current = null;
        setLiveMessage(
          'A change is visible, but it does not yet look like one settled dart. Waiting safely.',
        );
        return;
      }

      const candidate = selectAutomaticTipCandidate(nextAnalysis.candidates);
      if (candidate === null) {
        stabilityRef.current = null;
        setLiveMessage('A dart-like change needs another moment before a score can be proposed.');
        return;
      }
      const key = `${candidate.shapeId}:${candidate.zone.ring}:${candidate.zone.segment ?? 'bull'}:${Math.round(candidate.imagePoint.x / 8)}:${Math.round(candidate.imagePoint.y / 8)}`;
      const previous = stabilityRef.current;
      const count = previous?.key === key ? previous.count + 1 : 1;
      stabilityRef.current = { key, count };
      if (count < 2) {
        setLiveMessage('Dart-shaped change found. Holding for one more settled frame…');
        return;
      }

      recordingRef.current = true;
      const slot = onAddProposal({
        zone: candidate.zone,
        confidence: candidate.confidence,
        wireMarginMm: candidate.wireMarginMm,
        source: 'auto',
      });
      if (slot === null) {
        recordingRef.current = false;
        setLiveMessage(
          'That turn is full. Review or confirm the scores before recording another dart.',
        );
        return;
      }

      setReference(frame);
      setLastRecorded({
        slot,
        zone: candidate.zone,
        imagePoint: candidate.imagePoint,
      });
      stabilityRef.current = null;
      setLiveMessage(
        `Dart ${slot}: ${formatZone(candidate.zone)} added. ${slot >= 3 ? 'Review and confirm the turn.' : 'Throw the next dart.'}`,
      );
      if (slot >= 3) setPhase('turn-ready');
      window.setTimeout(() => {
        recordingRef.current = false;
      }, 700);
    };

    analyzeCurrentFrame();
    const interval = window.setInterval(analyzeCurrentFrame, 620);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    availableSlots,
    captureFrame,
    gameComplete,
    homography,
    isWatching,
    onAddProposal,
    quality?.boardDiameterPixels,
    reference,
  ]);

  const beginNextTurn = () => {
    if (homography === null) {
      restartAutomaticBoardFind();
      return;
    }
    const frame = captureFrame();
    if (frame === null) {
      setLiveMessage(
        'The camera has not supplied a complete clear-board frame yet. Try again in a moment.',
      );
      return;
    }
    setReference(frame);
    setAnalysis(null);
    setLastRecorded(null);
    stabilityRef.current = null;
    setPhase('watching');
    setLiveMessage('New clear-board baseline captured locally. Throw the first dart.');
  };

  const confirmTurn = () => {
    if (!onConfirmVisit()) return;
    setAnalysis(null);
    setReference(null);
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
    if (phase !== 'manual-fit' || fitRef.current === null) {
      if (cameraActive && phase === 'ready-to-play') {
        setLiveMessage('The board was found automatically. With an empty board, tap Start Play.');
      }
      return;
    }
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
            bands, maps the board locally, then suggests a score for each settled dart. No photos
            leave this browser.
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
                    : 'Live camera with an automatically found board guide.'
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
              (phase === 'watching' || phase === 'turn-ready' || phase === 'awaiting-clear') && (
                <div className="camera-play-gesture-chip locked">
                  BOARD FOUND · WATCHING LOCALLY
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
                      ? isWatching
                        ? 'Watching for a settled dart'
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
          <button className="button ghost" disabled={turnCount === 0} onClick={onOpenReview}>
            REVIEW OR CORRECT SCORES
          </button>

          {automaticFit !== null && (phase === 'finding-board' || phase === 'ready-to-play') && (
            <p className={`camera-play-auto-state ${automaticFit.status}`}>
              <strong>AUTO BOARD FIND</strong>
              {automaticFit.message}
              {automaticFit.fit !== null && (
                <span>
                  {Math.round(automaticFit.estimatedBoardDiameterPixels)} px board ·{' '}
                  {automaticFit.outerAngularCoverage}/20 outer-band sectors ·{' '}
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

          {analysis !== null && isWatching && (
            <p className="camera-play-engine-state">
              <strong>LOCAL DETECTOR</strong>
              {analysis.status === 'dart-candidate'
                ? 'Settled dart-shaped change found; choosing its best internal endpoint.'
                : analysis.status === 'camera-moved-or-hand-present'
                  ? 'Broad movement held for safety.'
                  : 'Waiting for one stable dart-shaped change.'}
            </p>
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
            The browser looks for the standard board’s red/green scoring pattern and shows its
            guide.
          </li>
          <li>
            <b>Start Play</b>
            With an empty board, one tap stores a local baseline and starts live scoring.
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
  const color = locked ? '#8fdcc1' : '#f5c26a';
  context.save();
  context.lineJoin = 'round';
  context.lineCap = 'round';

  if (boardToImage !== null) {
    const rings = [
      BOARD_RADII_MM.doubleOuter,
      BOARD_RADII_MM.doubleInner,
      BOARD_RADII_MM.trebleOuter,
      BOARD_RADII_MM.trebleInner,
      BOARD_RADII_MM.outerBull,
      BOARD_RADII_MM.innerBull,
    ];
    rings.forEach((radius, index) => {
      traceProjectedCircle(context, boardToImage, radius);
      context.strokeStyle = index === 0 ? color : 'rgba(232, 255, 244, 0.62)';
      context.lineWidth = index === 0 ? 2.8 : 1.1;
      context.stroke();
    });

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

  fit.forEach((point, index) => {
    context.beginPath();
    context.arc(point.x, point.y, index === 0 ? 24 : 20, 0, Math.PI * 2);
    context.fillStyle = index === 0 ? '#f5c26a' : color;
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
