import type { DartZone } from '@darts-180/contracts';
import { BOARD_RADII_MM, formatZone } from '@darts-180/rules';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { mapBoardPointToImage, type Homography } from '../lib/annotationGeometry';
import { describeCameraAccessError, getCameraAccessPreflightMessage } from '../lib/cameraAccess';
import type { CameraTurnProposal } from '../lib/cameraProposal';
import {
  DeepDartsDevelopmentEngine,
  type DevelopmentVisionFrame,
} from '../lib/developmentVision/engine';
import type {
  DeepDartsDevelopmentModelManifest,
  DevelopmentScoreSuggestion,
} from '../lib/developmentVision/types';
import {
  DevelopmentWebInferenceClient,
  getDevelopmentBrowserVisionSupport,
} from '../lib/developmentVision/webInferenceClient';
import {
  captureLumaCue,
  captureModelFrame,
  capturePostImpactFrames,
  waitForCameraArmHandoff,
} from '../lib/learnedVision/cameraCapture';
import { CaptureEventGate } from '../lib/learnedVision/eventGate';

export interface DevelopmentCameraPlayDraft {
  slot: 1 | 2 | 3;
  zone: DartZone;
  source: 'auto' | 'manual' | 'corrected';
  confidence: number;
  wireMarginMm: number;
  requiresReview?: boolean;
  developmentSuggestion?: boolean;
  filled: boolean;
}

export interface DeepDartsDevelopmentCameraPlayProps {
  activePlayerName: string;
  availableSlots: number;
  gameComplete: boolean;
  turnDarts: readonly DevelopmentCameraPlayDraft[];
  model: DeepDartsDevelopmentModelManifest;
  onAddProposal: (proposal: CameraTurnProposal) => number | null;
  onConfirmVisit: () => boolean;
  onOpenReview: () => void;
  onOpenAdvanced: () => void;
}

type DevelopmentCameraPhase =
  | 'idle'
  | 'starting-camera'
  | 'loading-model'
  | 'finding-board'
  | 'ready-to-play'
  | 'watching'
  | 'analysing-impact'
  | 'visit-complete'
  | 'awaiting-clear'
  | 'camera-disturbed'
  | 'error';

const PREVIEW_EDGE = 1280;
const BOARD_REFRESH_MS = 1_100;
const WATCH_SENTINEL_MS = 900;
const LUMA_SAMPLE_MS = 90;

/**
 * An intentionally isolated development camera path for the real five-class DeepDarts-style
 * detector. It uses no manual calibration, no server inference, and no image upload. In contrast
 * to the production ABI, every deterministic result is an editable review proposal.
 */
export function DeepDartsDevelopmentCameraPlay({
  activePlayerName,
  availableSlots,
  gameComplete,
  turnDarts,
  model,
  onAddProposal,
  onConfirmVisit,
  onOpenReview,
  onOpenAdvanced,
}: DeepDartsDevelopmentCameraPlayProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const lumaCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const clientRef = useRef<DevelopmentWebInferenceClient | null>(null);
  const engineRef = useRef<DeepDartsDevelopmentEngine | null>(null);
  const eventGateRef = useRef(new CaptureEventGate());
  const animationFrameRef = useRef<number | null>(null);
  const runGenerationRef = useRef(0);
  const inferenceInFlightRef = useRef(false);
  const runtimeFailedRef = useRef(false);
  const lastSentinelAtRef = useRef(0);
  const latestFrameRef = useRef<DevelopmentVisionFrame | null>(null);

  const [phase, setPhase] = useState<DevelopmentCameraPhase>('idle');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [runtimeBackend, setRuntimeBackend] = useState<'webgpu' | 'wasm' | null>(null);
  const [latestFrame, setLatestFrame] = useState<DevelopmentVisionFrame | null>(null);
  const [status, setStatus] = useState(
    'Start the rear camera. Darts 180 will detect the standard board automatically.',
  );
  const [lastSuggestion, setLastSuggestion] = useState<DevelopmentScoreSuggestion | null>(null);

  const browserSupport = useMemo(() => getDevelopmentBrowserVisionSupport(), []);
  const poseReady = latestFrame?.pose !== null && latestFrame?.pose !== undefined;

  const stopCamera = useCallback(() => {
    runGenerationRef.current += 1;
    inferenceInFlightRef.current = false;
    runtimeFailedRef.current = false;
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
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
    setLastSuggestion(null);
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
    if (frame !== null) {
      drawDetectionMarkers(context, frame);
      if (frame.pose !== null) {
        drawGeometryOverlay(context, frame.pose.boardToImageHomography);
        drawTrackedTips(context, frame);
      }
    }
    context.restore();
    animationFrameRef.current = window.requestAnimationFrame(drawPreview);
  }, []);

  const beginPreview = useCallback(() => {
    if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = window.requestAnimationFrame(drawPreview);
  }, [drawPreview]);

  const runInference = useCallback(
    async (generation: number): Promise<DevelopmentVisionFrame | null> => {
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
          setStatus('Experimental camera inference stopped. No score was recorded.');
        }
        return null;
      } finally {
        if (generation === runGenerationRef.current) inferenceInFlightRef.current = false;
      }
    },
    [model],
  );

  const admitBoard = useCallback((frame: DevelopmentVisionFrame | null): boolean => {
    if (runtimeFailedRef.current) return false;
    if (frame === null || frame.pose === null) {
      setPhase('finding-board');
      setStatus('Looking for four learned board anchors and their orientation…');
      return false;
    }
    setPhase('ready-to-play');
    setStatus('Board geometry is ready. With the board clear, tap Arm Camera to start the visit.');
    return true;
  }, []);

  const initializeCamera = useCallback(async () => {
    const preflight = getCameraAccessPreflightMessage();
    if (preflight !== null) {
      setCameraError(preflight);
      setPhase('error');
      return;
    }
    if (!browserSupport.supported) {
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

      setPhase('loading-model');
      setStatus('Verifying the local experimental model and starting on-device inference…');
      const client = new DevelopmentWebInferenceClient();
      clientRef.current = client;
      const loadedBackend = await client.initialize(model);
      if (generation !== runGenerationRef.current) {
        await client.dispose();
        return;
      }
      engineRef.current = new DeepDartsDevelopmentEngine();
      setRuntimeBackend(loadedBackend);
      setPhase('finding-board');
      setStatus('Looking for four learned board anchors and their orientation…');
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
          ? 'The experimental learned runtime could not start. No score was recorded.'
          : 'The camera could not start. No camera image was uploaded or retained.',
      );
    }
  }, [admitBoard, beginPreview, browserSupport, model, runInference]);

  const armCamera = useCallback(async () => {
    if (phase !== 'ready-to-play' || inferenceInFlightRef.current) return;
    if (gameComplete || availableSlots <= 0) {
      setPhase('visit-complete');
      setStatus(
        'This visit already has three darts. Edit or confirm it before scanning another dart.',
      );
      return;
    }
    const generation = runGenerationRef.current;
    const engine = engineRef.current;
    if (engine === null) return;
    engine.resetVisit();
    setLastSuggestion(null);
    setStatus('Checking automatically that the board is clear…');
    await waitForCameraArmHandoff();
    if (generation !== runGenerationRef.current) return;
    const frame = await runInference(generation);
    if (generation !== runGenerationRef.current || frame === null || !admitBoard(frame)) return;
    if (frame.tracks.length > 0 || frame.blockedDartCount > 0) {
      setStatus(
        'Darts are visible or a dart point cannot be mapped. Remove them, then Darts 180 will check again automatically.',
      );
      return;
    }
    eventGateRef.current.reset();
    lastSentinelAtRef.current = performance.now();
    setPhase('watching');
    setStatus(
      'Camera armed. Throw normally; the detected score will open as an editable suggestion.',
    );
  }, [admitBoard, availableSlots, gameComplete, phase, runInference]);

  const handleSuggestion = useCallback(
    (suggestion: DevelopmentScoreSuggestion): boolean => {
      setLastSuggestion(suggestion);
      const slot = onAddProposal({
        zone: suggestion.zone,
        confidence: suggestion.detectorConfidence,
        wireMarginMm: suggestion.wireMarginMm,
        source: 'auto',
        disposition: 'review',
        developmentSuggestion: true,
      });
      if (slot === null) {
        setPhase('visit-complete');
        setStatus('The visit already has three darts. Edit or confirm the existing DartCards.');
        return false;
      }
      setStatus(
        `Dart ${slot}: ${formatZone(suggestion.zone)} is an editable development suggestion. Review it before confirming the visit.`,
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
    setStatus('Dart motion settled. Checking a short local model burst…');
    try {
      let suggestion: DevelopmentScoreSuggestion | null = null;
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
        if (frame.suggestion !== null) suggestion = frame.suggestion;
      }
      if (generation !== runGenerationRef.current) return;
      if (suggestion !== null) handleSuggestion(suggestion);
      else {
        setStatus(
          'No settled detected dart point was available. Use Correct a Score if a dart is embedded, then continue testing.',
        );
      }
      if (availableSlots <= 1) setPhase('visit-complete');
      else setPhase('watching');
    } catch (error) {
      if (generation === runGenerationRef.current) {
        setCameraError(safeVisionError(error));
        setPhase('error');
        setStatus('The local post-impact model burst failed. No score was recorded.');
      }
    } finally {
      if (generation === runGenerationRef.current) inferenceInFlightRef.current = false;
    }
  }, [availableSlots, handleSuggestion, model]);

  const runWatchSentinel = useCallback(async () => {
    const generation = runGenerationRef.current;
    const frame = await runInference(generation);
    if (generation !== runGenerationRef.current || frame === null) return;
    if (frame.pose === null) {
      setPhase('finding-board');
      setStatus(
        'Board anchors were lost. Re-reading the board automatically before another score.',
      );
      return;
    }
    if (frame.suggestion !== null) {
      handleSuggestion(frame.suggestion);
      if (availableSlots <= 1) setPhase('visit-complete');
    }
  }, [availableSlots, handleSuggestion, runInference]);

  useEffect(() => {
    if (!cameraActive || phase !== 'finding-board') return;
    const interval = window.setInterval(() => {
      void runInference(runGenerationRef.current).then((frame) => admitBoard(frame));
    }, BOARD_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [admitBoard, cameraActive, phase, runInference]);

  useEffect(() => {
    if (!cameraActive || phase !== 'watching') return;
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
          'The camera or scene moved. Re-reading board geometry automatically; no score was recorded.',
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
  }, [analysePostImpact, cameraActive, phase, runWatchSentinel]);

  useEffect(() => {
    if (!cameraActive || phase !== 'camera-disturbed') return;
    const timer = window.setTimeout(() => {
      setPhase('finding-board');
      setStatus('Looking for the four learned board anchors again after camera movement…');
    }, 350);
    return () => window.clearTimeout(timer);
  }, [cameraActive, phase]);

  useEffect(() => {
    if (phase !== 'watching' || availableSlots > 0) return;
    setPhase('visit-complete');
    setStatus(
      'All three DartCards are filled. Edit or confirm the visit before scanning another dart.',
    );
  }, [availableSlots, phase]);

  const confirmVisit = useCallback(() => {
    if (
      turnDarts.some((dart) => dart.filled && dart.developmentSuggestion && dart.requiresReview)
    ) {
      setStatus(
        'Open Edit Scores to confirm as shown or correct every development DartCard first.',
      );
      onOpenReview();
      return;
    }
    if (!onConfirmVisit()) return;
    engineRef.current?.resetVisit();
    eventGateRef.current.reset();
    setLastSuggestion(null);
    setPhase('awaiting-clear');
    setStatus(
      'Visit confirmed. Remove the darts; Darts 180 will recognize the clear board before the next visit.',
    );
  }, [onConfirmVisit, onOpenReview, turnDarts]);

  useEffect(() => {
    if (!cameraActive || phase !== 'awaiting-clear') return;
    const interval = window.setInterval(() => {
      void runInference(runGenerationRef.current).then((frame) => {
        if (frame === null || frame.pose === null) return;
        if (frame.tracks.length > 0 || frame.blockedDartCount > 0) return;
        engineRef.current?.resetVisit();
        eventGateRef.current.reset();
        setPhase('ready-to-play');
        setStatus('Board clear. Tap Arm Camera for the next visit.');
      });
    }, BOARD_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [cameraActive, phase, runInference]);

  const stageCaption = phaseCaption(phase, runtimeBackend);
  const primaryAction = !cameraActive ? 'START CAMERA' : 'STOP CAMERA';
  const canArm = cameraActive && poseReady;

  return (
    <section className="shell learned-camera-play development-camera-play">
      <div className="camera-play-intro">
        <div>
          <p className="eyebrow">LIVE SCORING · DEVELOPMENT LEARNED VISION</p>
          <h1>Point it. Get an editable model suggestion.</h1>
          <p>
            This development path finds a standard board and dart-entry point from the mounted rear
            camera. It needs no calibration taps, reference photos, uploads, or analysis button.
          </p>
        </div>
        <aside className="camera-play-privacy-card">
          <span>LOCAL TESTING ONLY</span>
          <strong>Every model score stays editable.</strong>
          <p>
            The five-class model runs in a Worker on this device. Camera images are not sent to the
            Darts 180 API, and a result is never auto-recorded.
          </p>
        </aside>
      </div>

      <div className="development-score-banner" role="note">
        <strong>DEVELOPMENT MODE</strong>
        <span>
          A learned dart/board detection becomes a deterministic score suggestion. Check or edit
          every DartCard before confirming the visit; corrections are the test evidence that
          improves this model.
        </span>
      </div>

      <div className="learned-camera-grid">
        <section className="learned-camera-stage" aria-label="Experimental camera board detection">
          <div className="camera-play-stage-head">
            <div>
              <p className="eyebrow">REAR CAMERA · FOUR-ANCHOR BOARD POSE</p>
              <h2>{stageCaption}</h2>
            </div>
            <span className={`learned-status-pill phase-${phase}`}>{phaseLabel(phase)}</span>
          </div>

          <div className={`learned-camera-surface ${poseReady ? 'is-pose-ready' : ''}`}>
            <video ref={videoRef} className="camera-play-source" autoPlay muted playsInline />
            <canvas
              ref={previewCanvasRef}
              className="learned-camera-canvas"
              aria-label="Live rear camera preview with learned development board geometry"
            />
            {!cameraActive && (
              <div className="camera-play-empty">
                <span>◉</span>
                <strong>REAR CAMERA READY</strong>
                <p>
                  Mount close to the board centreline where practical and keep the full number ring
                  visible, then start.
                </p>
              </div>
            )}
            {cameraActive && cameraError !== null && (
              <div className="learned-camera-notice error">
                <strong>CAMERA CHECK NEEDED</strong>
                <p>{cameraError}</p>
              </div>
            )}
            {cameraActive && cameraError === null && (
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
            >
              {primaryAction}
            </button>
            {cameraActive && phase === 'ready-to-play' && (
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
            The small motion cue only decides when to inspect a frame. All board anchors and dart
            points come from the local learned detector, then standard dart rules calculate the
            suggestion.
          </p>
        </section>

        <aside className="learned-camera-panel">
          <div className="camera-play-turn-head">
            <div>
              <p className="eyebrow">DEVELOPMENT VISIT · {activePlayerName.toUpperCase()}</p>
              <h2>Edit every detected dart.</h2>
            </div>
            <button className="text-button" onClick={onOpenReview}>
              EDIT SCORES
            </button>
          </div>

          <DevelopmentModelState model={model} backend={runtimeBackend} />
          <DevelopmentBoardState frame={latestFrame} />

          <div className="learned-dart-cards">
            {turnDarts.map((dart) => (
              <article
                key={dart.slot}
                className={`learned-dart-card ${dart.filled ? '' : 'is-empty'} ${dart.requiresReview === true ? 'needs-review' : ''}`}
              >
                <span>DART {dart.slot}</span>
                <strong>{dart.filled ? formatZone(dart.zone) : '—'}</strong>
                <b>
                  {!dart.filled ? 'WAITING' : dart.requiresReview === true ? 'EDIT' : 'CONFIRMED'}
                </b>
                {dart.filled && dart.source === 'auto' && (
                  <small>
                    {Math.round(dart.confidence * 100)}% detector evidence ·{' '}
                    {dart.wireMarginMm.toFixed(1)} mm wire margin
                  </small>
                )}
              </article>
            ))}
          </div>

          <div className="learned-proposal-summary" aria-live="polite">
            <small>LAST LOCAL DEVELOPMENT SUGGESTION</small>
            {lastSuggestion === null ? (
              <p>No settled detected dart point yet.</p>
            ) : (
              <>
                <strong>{formatZone(lastSuggestion.zone)} · EDITABLE</strong>
                <p>{lastSuggestion.reasons[0]}</p>
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

function DevelopmentModelState({
  model,
  backend,
}: {
  model: DeepDartsDevelopmentModelManifest;
  backend: 'webgpu' | 'wasm' | null;
}) {
  const syntheticOnly = model.provenance.trainingDataKind === 'synthetic-only';
  const mixedData = model.provenance.trainingDataKind === 'mixed-synthetic-and-real';
  return (
    <section className="learned-model-state is-runnable development-model-state">
      <small>LOCAL DEVELOPMENT MODEL</small>
      <strong>{model.modelVersion}</strong>
      <span>
        EDITABLE ONLY · {backend === null ? 'WAITING FOR RUNTIME' : backend.toUpperCase()}
      </span>
      {syntheticOnly && (
        <span className="development-synthetic-warning">
          SYNTHETIC BOOTSTRAP ONLY · NOT VALIDATED ON REAL THROWS
        </span>
      )}
      {mixedData && (
        <span className="development-mixed-warning">
          REVIEWED REAL + SIMULATED TRAINING · CHECK EVERY SUGGESTION
        </span>
      )}
    </section>
  );
}

function DevelopmentBoardState({ frame }: { frame: DevelopmentVisionFrame | null }) {
  if (frame === null || frame.pose === null) {
    return (
      <section className="learned-quality-state">
        <small>LEARNED BOARD GEOMETRY</small>
        <strong>WAITING FOR FOUR ANCHORS</strong>
        <p>cal1–cal4 must be detected before any dart point can be scored.</p>
      </section>
    );
  }
  return (
    <section className="learned-quality-state is-ready">
      <div>
        <small>LEARNED BOARD GEOMETRY</small>
        <strong>ORIENTED BOARD READY</strong>
      </div>
      <dl>
        <div>
          <dt>BOARD</dt>
          <dd>{Math.round(frame.pose.boardDiameterPixels)} px</dd>
        </div>
        <div>
          <dt>ANCHOR</dt>
          <dd>{Math.round(frame.pose.minimumAnchorConfidence * 100)}%</dd>
        </div>
        <div>
          <dt>DARTS</dt>
          <dd>{frame.tracks.length}</dd>
        </div>
      </dl>
      <p>Four learned anchors set orientation automatically. Every score remains review-only.</p>
    </section>
  );
}

function phaseLabel(phase: DevelopmentCameraPhase): string {
  switch (phase) {
    case 'idle':
      return 'IDLE';
    case 'starting-camera':
      return 'OPENING';
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

function phaseCaption(phase: DevelopmentCameraPhase, backend: 'webgpu' | 'wasm' | null): string {
  if (phase === 'watching') {
    return `Watching locally${backend === null ? '' : ` · ${backend.toUpperCase()}`}`;
  }
  if (phase === 'analysing-impact') return 'Checking the physical tip entry';
  if (phase === 'ready-to-play') return 'Automatic board geometry found';
  if (phase === 'awaiting-clear') return 'Waiting for darts to be removed';
  if (phase === 'camera-disturbed') return 'Re-reading board geometry';
  if (phase === 'error') return 'Camera paused safely';
  return 'Automatic board pose';
}

function drawDetectionMarkers(
  context: CanvasRenderingContext2D,
  frame: DevelopmentVisionFrame,
): void {
  for (const detection of frame.detections) {
    const isDart = detection.classId === 0;
    context.save();
    context.strokeStyle = isDart ? '#ffffff' : '#f7c96f';
    context.fillStyle = isDart ? 'rgba(255, 255, 255, 0.13)' : 'rgba(247, 201, 111, 0.16)';
    context.lineWidth = 2;
    context.beginPath();
    context.arc(detection.center.xPx, detection.center.yPx, isDart ? 6 : 7, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle = '#ffffff';
    context.font = '800 12px ui-sans-serif, system-ui, sans-serif';
    context.textAlign = 'center';
    context.fillText(
      isDart ? 'DART' : `CAL ${detection.classId}`,
      detection.center.xPx,
      detection.center.yPx - 10,
    );
    context.restore();
  }
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

function drawTrackedTips(context: CanvasRenderingContext2D, frame: DevelopmentVisionFrame): void {
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
  return 'Experimental local camera inference could not complete. No score was recorded.';
}
