import type {
  DartZone,
  ModelQualityObservation,
  ScoringProposal,
  VisionModelArtifactManifest,
} from '@darts-180/contracts';
import { BOARD_RADII_MM, formatZone } from '@darts-180/rules';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { mapBoardPointToImage, type Homography } from '../lib/annotationGeometry';
import { describeCameraAccessError, getCameraAccessPreflightMessage } from '../lib/cameraAccess';
import type { CameraTurnProposal } from '../lib/cameraProposal';
import {
  captureLumaCue,
  captureModelFrame,
  capturePostImpactFrames,
  waitForCameraArmHandoff,
} from '../lib/learnedVision/cameraCapture';
import { CaptureEventGate } from '../lib/learnedVision/eventGate';
import {
  LearnedVisionEngine,
  type LearnedVisionFrame,
} from '../lib/learnedVision/learnedVisionEngine';
import {
  isRunnableModelManifest,
  loadModelManifest,
  UNAVAILABLE_MODEL_MANIFEST,
} from '../lib/learnedVision/modelManifest';
import { modelQualityBlockers } from '../lib/learnedVision/qualityPolicy';
import {
  getBrowserVisionSupport,
  WebInferenceClient,
} from '../lib/learnedVision/webInferenceClient';

type LearnedCameraPhase =
  | 'idle'
  | 'starting-camera'
  | 'model-unavailable'
  | 'loading-model'
  | 'finding-board'
  | 'ready-to-play'
  | 'watching'
  | 'analysing-impact'
  | 'visit-complete'
  | 'awaiting-clear'
  | 'camera-disturbed'
  | 'error';

export interface LearnedCameraPlayDraft {
  slot: 1 | 2 | 3;
  zone: DartZone;
  source: 'auto' | 'manual' | 'corrected';
  confidence: number;
  wireMarginMm: number;
  requiresReview?: boolean;
  filled: boolean;
}

export interface LearnedCameraPlayProps {
  activePlayerName: string;
  availableSlots: number;
  gameComplete: boolean;
  turnDarts: readonly LearnedCameraPlayDraft[];
  onAddProposal: (proposal: CameraTurnProposal) => number | null;
  onConfirmVisit: () => boolean;
  onOpenReview: () => void;
  onOpenAdvanced: () => void;
}

const PREVIEW_EDGE = 1280;
const BOARD_REFRESH_MS = 1_100;
const WATCH_SENTINEL_MS = 900;
const LUMA_SAMPLE_MS = 90;

/**
 * The normal Live Scoring path. It never asks a player to fit guides, click a board point, capture
 * an empty reference, or upload an image: a verified model provides semantic board landmarks and
 * dart-tip observations, while the Worker owns image preprocessing and ONNX execution.
 */
export function LearnedCameraPlay({
  activePlayerName,
  availableSlots,
  gameComplete,
  turnDarts,
  onAddProposal,
  onConfirmVisit,
  onOpenReview,
  onOpenAdvanced,
}: LearnedCameraPlayProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const lumaCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const clientRef = useRef<WebInferenceClient | null>(null);
  const engineRef = useRef<LearnedVisionEngine | null>(null);
  const eventGateRef = useRef(new CaptureEventGate());
  const animationFrameRef = useRef<number | null>(null);
  const runGenerationRef = useRef(0);
  const inferenceInFlightRef = useRef(false);
  const runtimeFailedRef = useRef(false);
  const lastSentinelAtRef = useRef(0);
  const latestFrameRef = useRef<LearnedVisionFrame | null>(null);

  const [phase, setPhase] = useState<LearnedCameraPhase>('idle');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [model, setModel] = useState<VisionModelArtifactManifest>(UNAVAILABLE_MODEL_MANIFEST);
  const [modelMessage, setModelMessage] = useState<string | null>('Checking local model package…');
  const [manifestLoading, setManifestLoading] = useState(true);
  const [runtimeBackend, setRuntimeBackend] = useState<'webgpu' | 'wasm' | null>(null);
  const [latestFrame, setLatestFrame] = useState<LearnedVisionFrame | null>(null);
  const [status, setStatus] = useState(
    'Start the rear camera. Darts 180 will find the full standard board automatically.',
  );
  const [lastProposal, setLastProposal] = useState<ScoringProposal | null>(null);

  const runnableModel = isRunnableModelManifest(model);
  const browserSupport = useMemo(() => getBrowserVisionSupport(), []);
  const quality = latestFrame?.observation.quality ?? null;
  const poseReady = latestFrame?.pose !== null && latestFrame?.pose !== undefined;
  const qualityReasons = useMemo(
    () => (quality === null ? [] : modelQualityBlockers(model, quality)),
    [model, quality],
  );

  useEffect(() => {
    let current = true;
    void loadModelManifest().then((loaded) => {
      if (!current) return;
      setModel(loaded.manifest);
      setModelMessage(loaded.message);
      setManifestLoading(false);
    });
    return () => {
      current = false;
    };
  }, []);

  const stopCamera = useCallback(() => {
    runGenerationRef.current += 1;
    inferenceInFlightRef.current = false;
    runtimeFailedRef.current = false;
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    const stream = streamRef.current;
    if (stream !== null) stream.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current !== null) videoRef.current.srcObject = null;
    const client = clientRef.current;
    clientRef.current = null;
    engineRef.current = null;
    eventGateRef.current.reset();
    latestFrameRef.current = null;
    setCameraActive(false);
    setRuntimeBackend(null);
    setLatestFrame(null);
    setLastProposal(null);
    setPhase('idle');
    setStatus('Camera stopped. No camera image was uploaded or retained.');
    if (client !== null) void client.dispose();
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const drawPreview = useCallback(() => {
    const video = videoRef.current;
    const canvas = previewCanvasRef.current;
    if (video === null || canvas === null || video.videoWidth <= 0 || video.videoHeight <= 0)
      return;
    const previewScale = Math.min(1, PREVIEW_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(1, Math.round(video.videoWidth * previewScale));
    const height = Math.max(1, Math.round(video.videoHeight * previewScale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext('2d');
    if (context === null) return;
    context.drawImage(video, 0, 0, width, height);
    context.save();
    context.scale(previewScale, previewScale);
    const frame = latestFrameRef.current;
    if (frame?.pose !== null && frame?.pose !== undefined) {
      drawGeometryOverlay(context, frame.pose.boardToImageHomography);
      drawTrackedTips(context, frame);
    }
    context.restore();
    animationFrameRef.current = window.requestAnimationFrame(drawPreview);
  }, []);

  const beginPreview = useCallback(() => {
    if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = window.requestAnimationFrame(drawPreview);
  }, [drawPreview]);

  const runInference = useCallback(
    async (generation: number): Promise<LearnedVisionFrame | null> => {
      const video = videoRef.current;
      const client = clientRef.current;
      const engine = engineRef.current;
      if (
        video === null ||
        client === null ||
        engine === null ||
        generation !== runGenerationRef.current ||
        inferenceInFlightRef.current
      ) {
        return null;
      }
      inferenceInFlightRef.current = true;
      try {
        const captured = await captureModelFrame(video);
        const result = await client.infer(
          captured.bitmap,
          captured.width,
          captured.height,
          captured.capturedAtMs,
        );
        if (generation !== runGenerationRef.current) return null;
        const frame = engine.process(result, model);
        latestFrameRef.current = frame;
        setLatestFrame(frame);
        return frame;
      } catch (error) {
        if (generation === runGenerationRef.current) {
          runtimeFailedRef.current = true;
          setCameraError(safeVisionError(error));
          setPhase('error');
          setStatus('Camera inference stopped safely. No score was recorded.');
        }
        return null;
      } finally {
        // A stopped/restarted camera may already have a new inference in flight. An obsolete
        // generation must not clear that new run's serialization guard.
        if (generation === runGenerationRef.current) inferenceInFlightRef.current = false;
      }
    },
    [model],
  );

  const admitBoard = useCallback(
    (frame: LearnedVisionFrame | null): boolean => {
      if (runtimeFailedRef.current) return false;
      if (frame === null || frame.pose === null) {
        setPhase('finding-board');
        setStatus('Looking for the full standard board and its orientation…');
        return false;
      }
      const blockers = modelQualityBlockers(model, frame.observation.quality);
      if (blockers.length > 0) {
        setPhase('finding-board');
        setStatus(blockers[0] ?? 'Looking for a camera view safe enough to score.');
        return false;
      }
      setPhase('ready-to-play');
      setStatus(
        'Board geometry is ready. With the board clear, tap Arm Camera to start the visit.',
      );
      return true;
    },
    [model],
  );

  const initializeCamera = useCallback(async () => {
    if (manifestLoading) return;
    const preflight = getCameraAccessPreflightMessage();
    if (preflight !== null) {
      setCameraError(preflight);
      setPhase('error');
      return;
    }
    // An unavailable manifest may still offer a privacy-safe camera preview. A runnable model,
    // however, must fail closed when this browser cannot start its local inference boundary.
    if (runnableModel && !browserSupport.supported) {
      setCameraError(browserSupport.reasons.join(' '));
      setPhase('error');
      return;
    }

    setCameraError(null);
    setPhase('starting-camera');
    setStatus('Opening the rear camera…');
    const generation = ++runGenerationRef.current;
    runtimeFailedRef.current = false;
    let openedCamera = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          // 1080p is enough for a 1024px learned input while avoiding avoidable 4K bitmap transfer
          // pressure on mid-range phones. Browsers may still choose a higher supported mode.
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
      });
      if (generation !== runGenerationRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      openedCamera = true;
      const video = videoRef.current;
      if (video === null) throw new Error('The camera preview is unavailable.');
      video.srcObject = stream;
      await video.play();
      await waitForVideoDimensions(video);
      if (generation !== runGenerationRef.current) return;
      setCameraActive(true);
      beginPreview();

      if (!runnableModel) {
        setPhase('model-unavailable');
        setStatus(
          modelMessage ??
            'The verified local learned model package is not installed. The live preview cannot guess a dart score.',
        );
        return;
      }

      setPhase('loading-model');
      setStatus('Verifying the local model package and starting on-device inference…');
      const client = new WebInferenceClient();
      clientRef.current = client;
      const loadedBackend = await client.initialize(model);
      if (generation !== runGenerationRef.current) {
        await client.dispose();
        return;
      }
      engineRef.current = new LearnedVisionEngine();
      setRuntimeBackend(loadedBackend);
      setPhase('finding-board');
      setStatus('Looking for the full standard board and its orientation…');
      const frame = await runInference(generation);
      admitBoard(frame);
    } catch (error) {
      if (generation !== runGenerationRef.current) return;
      if (openedCamera) {
        const client = clientRef.current;
        clientRef.current = null;
        engineRef.current = null;
        if (client !== null) void client.dispose();
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        if (videoRef.current !== null) videoRef.current.srcObject = null;
        if (animationFrameRef.current !== null) {
          window.cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
        setCameraActive(false);
        setRuntimeBackend(null);
        setLatestFrame(null);
      }
      setCameraError(openedCamera ? safeVisionError(error) : describeCameraAccessError(error));
      setPhase('error');
      setStatus(
        openedCamera
          ? 'The learned runtime could not start safely. No score was recorded.'
          : 'The camera could not start. No camera image was uploaded or retained.',
      );
    }
  }, [
    admitBoard,
    beginPreview,
    browserSupport,
    manifestLoading,
    model,
    modelMessage,
    runInference,
    runnableModel,
  ]);

  const armCamera = useCallback(async () => {
    if (phase !== 'ready-to-play' || inferenceInFlightRef.current) return;
    if (gameComplete || availableSlots <= 0) {
      setPhase('visit-complete');
      setStatus(
        'This visit already has three darts. Review or confirm it before scanning another dart.',
      );
      return;
    }
    const generation = runGenerationRef.current;
    const engine = engineRef.current;
    if (engine === null || !runnableModel) return;
    engine.resetVisit();
    setLastProposal(null);
    setStatus(
      'Letting the rear camera settle, then checking that the board is clear automatically…',
    );
    await waitForCameraArmHandoff();
    if (generation !== runGenerationRef.current) return;
    const frame = await runInference(generation);
    if (generation !== runGenerationRef.current || frame === null) return;
    if (!admitBoard(frame)) return;
    if (frame.tracks.length > 0 || frame.blockedTipCount > 0) {
      setStatus(
        'Darts are visible or too obscured to verify a clear board. Remove them, then Darts 180 will check automatically.',
      );
      return;
    }
    eventGateRef.current.reset();
    lastSentinelAtRef.current = performance.now();
    setPhase('watching');
    setStatus(
      'Camera armed. Throw normally; Darts 180 watches for a settled dart and checks the physical tip locally.',
    );
  }, [admitBoard, availableSlots, gameComplete, phase, runInference, runnableModel]);

  const handleProposal = useCallback(
    (proposal: ScoringProposal): boolean => {
      setLastProposal(proposal);
      if (proposal.disposition === 'abstain') {
        setStatus(proposal.reasons[0] ?? 'No score was recorded because the dart was ambiguous.');
        return false;
      }
      const candidate = proposal.candidates[0];
      if (candidate === undefined) {
        setStatus('No score was recorded because no deterministic board zone was available.');
        return false;
      }
      const slot = onAddProposal({
        zone: candidate.zone,
        confidence: proposal.confidence,
        wireMarginMm: candidate.wireMarginMm,
        source: 'auto',
        disposition: proposal.disposition,
      });
      if (slot === null) {
        setPhase('visit-complete');
        setStatus('The visit already has three darts. Review or confirm the existing DartCards.');
        return false;
      }
      setStatus(
        proposal.disposition === 'auto-score'
          ? `Dart ${slot}: ${formatZone(candidate.zone)} proposed from the learned physical-tip estimate.`
          : `Dart ${slot}: ${formatZone(candidate.zone)} needs review before the visit is confirmed.`,
      );
      return true;
    },
    [onAddProposal],
  );

  const analysePostImpact = useCallback(async () => {
    const video = videoRef.current;
    const client = clientRef.current;
    const engine = engineRef.current;
    const generation = runGenerationRef.current;
    if (video === null || client === null || engine === null || inferenceInFlightRef.current)
      return;
    inferenceInFlightRef.current = true;
    setPhase('analysing-impact');
    setStatus('Dart motion settled. Checking a short high-resolution local burst…');
    try {
      let proposal: ScoringProposal | null = null;
      for await (const captured of capturePostImpactFrames(video)) {
        const result = await client.infer(
          captured.bitmap,
          captured.width,
          captured.height,
          captured.capturedAtMs,
        );
        if (generation !== runGenerationRef.current) return;
        const frame = engine.process(result, model);
        latestFrameRef.current = frame;
        setLatestFrame(frame);
        if (frame.proposal !== null) proposal = frame.proposal;
      }
      if (generation !== runGenerationRef.current) return;
      if (proposal !== null) handleProposal(proposal);
      else
        setStatus(
          'No safe settled physical-tip score was available. If a dart is embedded, use Correct a Score before continuing.',
        );
      if (availableSlots <= 1) setPhase('visit-complete');
      else setPhase('watching');
    } catch (error) {
      if (generation === runGenerationRef.current) {
        setCameraError(safeVisionError(error));
        setPhase('error');
        setStatus('The post-impact inference burst failed safely. No score was recorded.');
      }
    } finally {
      // Do not let a cancelled post-impact burst unlock a newer camera generation.
      if (generation === runGenerationRef.current) inferenceInFlightRef.current = false;
    }
  }, [availableSlots, handleProposal, model]);

  const runWatchSentinel = useCallback(async () => {
    const generation = runGenerationRef.current;
    const frame = await runInference(generation);
    if (generation !== runGenerationRef.current || frame === null) return;
    if (frame.pose === null || modelQualityBlockers(model, frame.observation.quality).length > 0) {
      setPhase('finding-board');
      setStatus(
        'Camera conditions changed. Re-reading the board automatically before another score.',
      );
      return;
    }
    if (frame.proposal !== null) {
      handleProposal(frame.proposal);
      if (availableSlots <= 1) setPhase('visit-complete');
    }
  }, [availableSlots, handleProposal, model, runInference]);

  useEffect(() => {
    if (!cameraActive || !runnableModel || phase !== 'finding-board') return;
    const interval = window.setInterval(() => {
      void runInference(runGenerationRef.current).then((frame) => admitBoard(frame));
    }, BOARD_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [admitBoard, cameraActive, phase, runInference, runnableModel]);

  useEffect(() => {
    if (!cameraActive || !runnableModel || phase !== 'watching') return;
    const interval = window.setInterval(() => {
      const video = videoRef.current;
      const canvas = lumaCanvasRef.current;
      if (video === null || canvas === null) return;
      const cue = captureLumaCue(video, canvas);
      if (cue === null) return;
      const event = eventGateRef.current.observe(cue);
      if (event === 'camera-disturbed') {
        setPhase('camera-disturbed');
        setStatus(
          'The camera or scene moved too much. Re-reading board geometry automatically; no score was recorded.',
        );
        eventGateRef.current.reset();
        return;
      }
      if (event === 'settled-after-motion') {
        void analysePostImpact();
        return;
      }
      const now = performance.now();
      if (now - lastSentinelAtRef.current >= WATCH_SENTINEL_MS) {
        lastSentinelAtRef.current = now;
        void runWatchSentinel();
      }
    }, LUMA_SAMPLE_MS);
    return () => window.clearInterval(interval);
  }, [analysePostImpact, cameraActive, phase, runWatchSentinel, runnableModel]);

  useEffect(() => {
    if (!cameraActive || !runnableModel || phase !== 'camera-disturbed') return;
    const timer = window.setTimeout(() => {
      setPhase('finding-board');
      setStatus('Looking for the full standard board again after camera movement…');
    }, 350);
    return () => window.clearTimeout(timer);
  }, [cameraActive, phase, runnableModel]);

  useEffect(() => {
    if (phase !== 'watching' || availableSlots > 0) return;
    setPhase('visit-complete');
    setStatus(
      'All three DartCards are filled. Review or confirm the visit before scanning another dart.',
    );
  }, [availableSlots, phase]);

  const confirmVisit = useCallback(() => {
    if (!onConfirmVisit()) return;
    const engine = engineRef.current;
    engine?.resetVisit();
    eventGateRef.current.reset();
    setLastProposal(null);
    setPhase('awaiting-clear');
    setStatus(
      'Visit confirmed. Remove the darts; Darts 180 will recognize the clear board before the next visit.',
    );
  }, [onConfirmVisit]);

  useEffect(() => {
    if (!cameraActive || !runnableModel || phase !== 'awaiting-clear') return;
    const interval = window.setInterval(() => {
      void runInference(runGenerationRef.current).then((frame) => {
        if (frame === null || frame.pose === null) return;
        if (frame.tracks.length > 0 || frame.blockedTipCount > 0) return;
        engineRef.current?.resetVisit();
        eventGateRef.current.reset();
        setPhase('ready-to-play');
        setStatus('Board clear. Tap Arm Camera for the next visit.');
      });
    }, BOARD_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [cameraActive, phase, runInference, runnableModel]);

  const stageCaption = phaseCaption(phase, model, runtimeBackend);
  const primaryAction = !cameraActive ? 'START CAMERA' : 'STOP CAMERA';
  const canArm = cameraActive && runnableModel && poseReady && qualityReasons.length === 0;

  return (
    <section className="shell learned-camera-play">
      <div className="camera-play-intro">
        <div>
          <p className="eyebrow">LIVE SCORING · LEARNED VISION</p>
          <h1>Point it. Let Darts 180 read the board.</h1>
          <p>
            The normal path uses the mounted phone’s rear camera to find the complete standard
            board, orientation, and a settled dart-tip entry point locally. There are no guide
            handles, calibration taps, reference photos, or uploads.
          </p>
        </div>
        <aside className="camera-play-privacy-card">
          <span>ON-DEVICE BY DESIGN</span>
          <strong>Camera pixels stay in this tab.</strong>
          <p>
            A Worker verifies and runs the same-origin model locally. Camera images are not sent to
            the Darts 180 API.
          </p>
        </aside>
      </div>

      <div className="learned-camera-grid">
        <section className="learned-camera-stage" aria-label="Camera board detection">
          <div className="camera-play-stage-head">
            <div>
              <p className="eyebrow">REAR CAMERA · AUTOMATIC BOARD POSE</p>
              <h2>{stageCaption}</h2>
            </div>
            <span className={`learned-status-pill phase-${phase}`}>{phaseLabel(phase)}</span>
          </div>

          <div className={`learned-camera-surface ${poseReady ? 'is-pose-ready' : ''}`}>
            <video ref={videoRef} className="camera-play-source" autoPlay muted playsInline />
            <canvas
              ref={previewCanvasRef}
              className="learned-camera-canvas"
              aria-label="Live rear camera preview with automatic board geometry overlay"
            />
            {!cameraActive && (
              <div className="camera-play-empty">
                <span>◉</span>
                <strong>REAR CAMERA READY</strong>
                <p>
                  Mount close to the board centreline where practical, keep the full number ring
                  visible, then start.
                </p>
              </div>
            )}
            {cameraActive && phase === 'model-unavailable' && (
              <div className="learned-camera-notice warning">
                <strong>VERIFIED MODEL NOT INSTALLED</strong>
                <p>
                  {modelMessage ?? 'Camera preview is available, but no score will be guessed.'}
                </p>
              </div>
            )}
            {cameraActive && cameraError !== null && (
              <div className="learned-camera-notice error">
                <strong>CAMERA CHECK NEEDED</strong>
                <p>{cameraError}</p>
              </div>
            )}
            {cameraActive && phase !== 'model-unavailable' && cameraError === null && (
              <div className="learned-camera-chip">{status}</div>
            )}
          </div>
          <canvas ref={lumaCanvasRef} className="learned-luma-canvas" aria-hidden="true" />

          <div className="learned-camera-actions">
            <button
              className="button primary"
              onClick={() => {
                if (cameraActive) stopCamera();
                else void initializeCamera();
              }}
              disabled={!cameraActive && manifestLoading}
            >
              {primaryAction}
            </button>
            {cameraActive && runnableModel && phase === 'ready-to-play' && (
              <button
                className="button secondary"
                onClick={() => void armCamera()}
                disabled={!canArm || gameComplete || availableSlots <= 0}
              >
                ARM CAMERA
              </button>
            )}
            <button className="text-button" onClick={onOpenAdvanced}>
              DIAGNOSTICS →
            </button>
          </div>
          <p className="learned-camera-footnote">
            The small luma cue only associates broad timing. The Worker’s learned landmark and
            dart-tip outputs—not frame subtraction—supply every scoring coordinate.
          </p>
        </section>

        <aside className="learned-camera-panel">
          <div className="camera-play-turn-head">
            <div>
              <p className="eyebrow">LIVE VISIT · {activePlayerName.toUpperCase()}</p>
              <h2>Review stays available.</h2>
            </div>
            <button className="text-button" onClick={onOpenReview}>
              EDIT SCORES
            </button>
          </div>

          <ModelState model={model} modelMessage={modelMessage} backend={runtimeBackend} />
          <QualityState quality={quality} poseReady={poseReady} blockers={qualityReasons} />

          <div className="learned-dart-cards">
            {turnDarts.map((dart) => {
              // The proposal's reviewed manifest policy determines review status. Do not add a
              // second UI-only confidence or wire threshold that could drift from the artifact.
              const needsReview = dart.requiresReview === true;
              return (
                <article
                  key={dart.slot}
                  className={`learned-dart-card ${dart.filled ? '' : 'is-empty'} ${needsReview ? 'needs-review' : ''}`}
                >
                  <span>DART {dart.slot}</span>
                  <strong>{dart.filled ? formatZone(dart.zone) : '—'}</strong>
                  <b>
                    {!dart.filled
                      ? 'WAITING'
                      : needsReview
                        ? 'REVIEW'
                        : dart.source === 'auto'
                          ? 'PROPOSED'
                          : 'CONFIRMED'}
                  </b>
                  {dart.filled && dart.source === 'auto' && (
                    <small>
                      {Math.round(dart.confidence * 100)}% · {dart.wireMarginMm.toFixed(1)} mm wire
                      margin
                    </small>
                  )}
                </article>
              );
            })}
          </div>

          <div className="learned-proposal-summary" aria-live="polite">
            <small>LAST LOCAL DECISION</small>
            {lastProposal === null ? (
              <p>No dart-tip decision yet.</p>
            ) : (
              <>
                <strong>
                  {lastProposal.disposition === 'abstain'
                    ? 'NO SCORE RECORDED'
                    : lastProposal.disposition === 'review'
                      ? 'REVIEW REQUESTED'
                      : 'PROPOSAL READY'}
                </strong>
                <p>
                  {lastProposal.reasons[0] ?? 'Deterministic board geometry supplied the score.'}
                </p>
              </>
            )}
          </div>

          <div className="learned-visit-actions">
            <button
              className="button primary"
              onClick={confirmVisit}
              disabled={gameComplete || turnDarts.every((dart) => !dart.filled)}
            >
              CONFIRM VISIT
            </button>
            <button className="button ghost" onClick={onOpenReview}>
              CORRECT A SCORE
            </button>
          </div>
        </aside>
      </div>
    </section>
  );
}

function ModelState({
  model,
  modelMessage,
  backend,
}: {
  model: VisionModelArtifactManifest;
  modelMessage: string | null;
  backend: 'webgpu' | 'wasm' | null;
}) {
  const runnable = isRunnableModelManifest(model);
  return (
    <section className={`learned-model-state ${runnable ? 'is-runnable' : 'is-unavailable'}`}>
      <small>LOCAL MODEL PACKAGE</small>
      <strong>{runnable ? model.modelVersion : 'UNAVAILABLE'}</strong>
      <span>
        {runnable
          ? `${model.releaseStage.toUpperCase()} · ${backend === null ? 'WAITING FOR RUNTIME' : backend.toUpperCase()}`
          : (modelMessage ?? 'No verified model package is installed.')}
      </span>
    </section>
  );
}

function QualityState({
  quality,
  poseReady,
  blockers,
}: {
  quality: ModelQualityObservation | null;
  poseReady: boolean;
  blockers: readonly string[];
}) {
  if (quality === null) {
    return (
      <section className="learned-quality-state">
        <small>BOARD OBSERVABILITY</small>
        <strong>WAITING FOR A FRAME</strong>
        <p>
          The full number ring, bull, and named orientation anchors must be visible before scoring
          starts.
        </p>
      </section>
    );
  }
  return (
    <section
      className={`learned-quality-state ${poseReady && blockers.length === 0 ? 'is-ready' : ''}`}
    >
      <div>
        <small>BOARD OBSERVABILITY</small>
        <strong>
          {poseReady && blockers.length === 0 ? 'READY TO SCORE' : 'NOT YET SAFE TO SCORE'}
        </strong>
      </div>
      <dl>
        <div>
          <dt>BOARD</dt>
          <dd>{Math.round(quality.boardDiameterPixels)} px</dd>
        </div>
        <div>
          <dt>AXIS</dt>
          <dd>{Math.round(quality.offAxisDegrees)}°</dd>
        </div>
        <div>
          <dt>QUALITY</dt>
          <dd>{Math.round(quality.overall * 100)}%</dd>
        </div>
      </dl>
      {blockers.length > 0 ? (
        <p>{blockers[0]}</p>
      ) : (
        <p>Complete geometry and orientation were found automatically.</p>
      )}
    </section>
  );
}

function phaseLabel(phase: LearnedCameraPhase): string {
  switch (phase) {
    case 'idle':
      return 'IDLE';
    case 'starting-camera':
      return 'OPENING';
    case 'model-unavailable':
      return 'MODEL NEEDED';
    case 'loading-model':
      return 'VERIFYING';
    case 'finding-board':
      return 'FINDING BOARD';
    case 'ready-to-play':
      return 'READY';
    case 'watching':
      return 'ARMED';
    case 'analysing-impact':
      return 'CHECKING TIP';
    case 'visit-complete':
      return 'REVIEW VISIT';
    case 'awaiting-clear':
      return 'WAITING FOR CLEAR';
    case 'camera-disturbed':
      return 'RE-READING';
    case 'error':
      return 'PAUSED';
  }
}

function phaseCaption(
  phase: LearnedCameraPhase,
  model: VisionModelArtifactManifest,
  backend: 'webgpu' | 'wasm' | null,
): string {
  if (phase === 'model-unavailable' || !isRunnableModelManifest(model))
    return 'Verified model package required';
  if (phase === 'watching')
    return `Watching locally${backend === null ? '' : ` · ${backend.toUpperCase()}`}`;
  if (phase === 'analysing-impact') return 'Checking the physical tip entry';
  if (phase === 'ready-to-play') return 'Complete board geometry found';
  if (phase === 'awaiting-clear') return 'Waiting for darts to be removed';
  if (phase === 'camera-disturbed') return 'Re-reading board geometry';
  if (phase === 'error') return 'Camera paused safely';
  return 'Automatic board pose';
}

function drawGeometryOverlay(context: CanvasRenderingContext2D, homography: Homography): void {
  context.save();
  context.lineJoin = 'round';
  context.strokeStyle = 'rgba(115, 238, 182, 0.9)';
  context.fillStyle = 'rgba(115, 238, 182, 0.92)';
  context.lineWidth = 2;
  for (const radius of [
    BOARD_RADII_MM.doubleOuter,
    BOARD_RADII_MM.doubleInner,
    BOARD_RADII_MM.trebleOuter,
    BOARD_RADII_MM.trebleInner,
    BOARD_RADII_MM.outerBull,
    BOARD_RADII_MM.innerBull,
  ]) {
    drawMappedCircle(context, homography, radius);
  }
  context.globalAlpha = 0.82;
  for (let sector = 0; sector < 20; sector += 1) {
    const angle = -Math.PI / 2 - Math.PI / 20 + (sector * Math.PI * 2) / 20;
    const inner = mapBoardPointToImage(
      {
        xMm: Math.cos(angle) * BOARD_RADII_MM.innerBull,
        yMm: Math.sin(angle) * BOARD_RADII_MM.innerBull,
      },
      homography,
    );
    const outer = mapBoardPointToImage(
      {
        xMm: Math.cos(angle) * BOARD_RADII_MM.doubleOuter,
        yMm: Math.sin(angle) * BOARD_RADII_MM.doubleOuter,
      },
      homography,
    );
    if (inner === null || outer === null) continue;
    context.beginPath();
    context.moveTo(inner.x, inner.y);
    context.lineTo(outer.x, outer.y);
    context.stroke();
  }
  const top = mapBoardPointToImage({ xMm: 0, yMm: -178 }, homography);
  if (top !== null) {
    context.font = '900 20px ui-sans-serif, system-ui, sans-serif';
    context.textAlign = 'center';
    context.fillText('20', top.x, top.y);
  }
  context.restore();
}

function drawMappedCircle(
  context: CanvasRenderingContext2D,
  homography: Homography,
  radiusMm: number,
): void {
  const steps = 72;
  context.beginPath();
  for (let step = 0; step <= steps; step += 1) {
    const angle = (step / steps) * Math.PI * 2;
    const point = mapBoardPointToImage(
      { xMm: Math.cos(angle) * radiusMm, yMm: Math.sin(angle) * radiusMm },
      homography,
    );
    if (point === null) return;
    if (step === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  }
  context.closePath();
  context.stroke();
}

function drawTrackedTips(context: CanvasRenderingContext2D, frame: LearnedVisionFrame): void {
  if (frame.pose === null) return;
  for (const track of frame.tracks) {
    const point = mapBoardPointToImage(track.boardPointMm, frame.pose.boardToImageHomography);
    if (point === null) continue;
    context.save();
    context.strokeStyle = track.proposed ? '#f7c96f' : '#ffffff';
    context.fillStyle = track.proposed ? 'rgba(247, 201, 111, 0.16)' : 'rgba(255, 255, 255, 0.14)';
    context.lineWidth = 2;
    context.beginPath();
    context.arc(point.x, point.y, track.isSettled ? 10 : 6, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.restore();
  }
}

function waitForVideoDimensions(video: HTMLVideoElement): Promise<void> {
  if (video.videoWidth > 0 && video.videoHeight > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('The camera did not provide a usable video frame.'));
    }, 5_000);
    const onMetadata = () => {
      if (video.videoWidth <= 0 || video.videoHeight <= 0) return;
      cleanup();
      resolve();
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener('loadedmetadata', onMetadata);
    };
    video.addEventListener('loadedmetadata', onMetadata);
  });
}

function safeVisionError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return 'Local learned camera inference could not complete. No score was recorded.';
}
