import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatZone } from '@darts-180/rules';

import {
  ANNOTATION_ANCHORS,
  solveImageToBoardHomography,
  type Homography,
  type ImagePoint,
} from '../lib/annotationGeometry';
import {
  analyzeDartDifference,
  assessGuidedCalibration,
  candidateFromManualPoint,
  frameFromImageData,
  type CameraFrame,
  type DartShape,
  type DartTipCandidate,
  type DifferenceAnalysis,
  type GuidedCalibrationQuality,
} from '../lib/cameraScoring';
import { describeCameraAccessError, getCameraAccessPreflightMessage } from '../lib/cameraAccess';
import type { CameraTurnProposal } from '../lib/cameraProposal';

export type { CameraTurnProposal } from '../lib/cameraProposal';

const EMPTY_ANCHORS: Array<ImagePoint | null> = [null, null, null, null];
const MAX_WORKING_EDGE = 960;

type CanvasMode = 'preview' | 'calibrating' | 'manual-tip';

interface CameraScoringLabProps {
  availableSlots: number;
  onAddProposal: (proposal: CameraTurnProposal) => number | null;
  onOpenReview: () => void;
}

/**
 * Browser-only field-test scorer. It uses a fixed-camera clear-board reference and a deliberately
 * inspectable frame-difference/line heuristic. It is not a trained entry-point model and always
 * routes results through a human-visible tip choice and the existing DartCard confirmation flow.
 */
export function CameraScoringLab({
  availableSlots,
  onAddProposal,
  onOpenReview,
}: CameraScoringLabProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const renderFrameRef = useRef<number | null>(null);
  const lastAnalyzedFrameRef = useRef<CameraFrame | null>(null);
  const watchStabilityRef = useRef<{ key: string; count: number } | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [canvasMode, setCanvasMode] = useState<CanvasMode>('preview');
  const [anchors, setAnchors] = useState<Array<ImagePoint | null>>([...EMPTY_ANCHORS]);
  const [homography, setHomography] = useState<Homography | null>(null);
  const [quality, setQuality] = useState<GuidedCalibrationQuality | null>(null);
  const [reference, setReference] = useState<CameraFrame | null>(null);
  const [analysis, setAnalysis] = useState<DifferenceAnalysis | null>(null);
  const [manualCandidate, setManualCandidate] = useState<DartTipCandidate | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);
  const [watchMessage, setWatchMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState(
    'Start a rear camera, mount it outside the throw path, then calibrate the four named double beds.',
  );

  const placedAnchors = anchors.filter((point): point is ImagePoint => point !== null);
  const nextAnchorIndex = anchors.findIndex((point) => point === null);
  const selectedCandidate = useMemo(() => {
    if (manualCandidate?.id === selectedCandidateId) return manualCandidate;
    return analysis?.candidates.find((candidate) => candidate.id === selectedCandidateId) ?? null;
  }, [analysis?.candidates, manualCandidate, selectedCandidateId]);
  const canCaptureReference = cameraActive && homography !== null && quality?.pass === true;
  const canAnalyze = canCaptureReference && reference !== null;

  const stopCamera = useCallback(() => {
    if (renderFrameRef.current !== null) {
      window.cancelAnimationFrame(renderFrameRef.current);
      renderFrameRef.current = null;
    }
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    if (videoRef.current !== null) videoRef.current.srcObject = null;
    setCameraActive(false);
    setWatching(false);
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
        'This browser did not expose a usable camera API. Open the direct Vercel HTTPS URL in Safari or Chrome.',
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
      setCameraActive(true);
      setCameraError(null);
      setNotice(
        'Camera is local to this browser. Frame the full board, let focus settle, then start calibration.',
      );
    } catch (error) {
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
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          drawCameraOverlay(context, canvas.width, canvas.height, {
            anchors,
            analysis,
            manualCandidate,
            selectedCandidateId,
            mode: canvasMode,
          });
        }
      }
      if (!cancelled) renderFrameRef.current = window.requestAnimationFrame(render);
    };
    renderFrameRef.current = window.requestAnimationFrame(render);
    return () => {
      cancelled = true;
      if (renderFrameRef.current !== null) {
        window.cancelAnimationFrame(renderFrameRef.current);
        renderFrameRef.current = null;
      }
    };
  }, [
    analysis,
    anchors,
    cameraActive,
    canvasMode,
    manualCandidate,
    selectedCandidateId,
    workingDimensions,
  ]);

  useEffect(() => {
    if (!watching || reference === null || homography === null || quality === null) return;
    const timer = window.setInterval(() => {
      const frame = captureFrame();
      if (frame === null) return;
      const nextAnalysis = analyzeDartDifference(reference, frame, homography, {
        boardDiameterPixels: quality.boardDiameterPixels,
      });
      setWatchMessage(nextAnalysis.message);
      if (nextAnalysis.status !== 'dart-candidate') {
        watchStabilityRef.current = null;
        return;
      }
      const primary = nextAnalysis.candidates[0];
      if (primary === undefined) return;
      const key = `${Math.round(primary.imagePoint.x / 8)}:${Math.round(primary.imagePoint.y / 8)}`;
      const previous = watchStabilityRef.current;
      const count = previous?.key === key ? previous.count + 1 : 1;
      watchStabilityRef.current = { key, count };
      if (count < 2) return;
      setAnalysis(nextAnalysis);
      lastAnalyzedFrameRef.current = frame;
      const preferred = nextAnalysis.candidates.find(
        (candidate) =>
          candidate.directionEvidence === 'only-endpoint-on-board' && candidate.wireMarginMm >= 1.5,
      );
      setSelectedCandidateId(preferred?.id ?? null);
      setManualCandidate(null);
      setWatching(false);
      setWatchMessage(null);
      setNotice(
        'Settled dart-shaped change found. Confirm its visibly correct tip marker before adding the score.',
      );
    }, 500);
    return () => window.clearInterval(timer);
  }, [captureFrame, homography, quality, reference, watching]);

  const resetCalibration = () => {
    setAnchors([...EMPTY_ANCHORS]);
    setHomography(null);
    setQuality(null);
    setReference(null);
    setAnalysis(null);
    setManualCandidate(null);
    setSelectedCandidateId(null);
    setCanvasMode('preview');
    setWatching(false);
    lastAnalyzedFrameRef.current = null;
    setNotice(
      'Calibration cleared. Keep the camera mount fixed, then place the four named double-bed anchors again.',
    );
  };

  const beginCalibration = () => {
    if (!cameraActive) {
      setCameraError('Start the local camera first.');
      return;
    }
    resetCalibration();
    setCanvasMode('calibrating');
    setCameraError(null);
    setNotice(ANNOTATION_ANCHORS[0]!.instruction);
  };

  const captureClearBoardReference = () => {
    if (!canCaptureReference) return;
    const frame = captureFrame();
    if (frame === null) {
      setCameraError(
        'A usable camera frame was not available yet. Wait for the preview, then try again.',
      );
      return;
    }
    setReference(frame);
    lastAnalyzedFrameRef.current = null;
    setAnalysis(null);
    setManualCandidate(null);
    setSelectedCandidateId(null);
    setCanvasMode('preview');
    setNotice(
      'Clear-board reference captured locally. Throw one dart, step fully out of frame, let it settle, then analyze or arm live watch.',
    );
  };

  const analyzeSettledFrame = () => {
    if (!canAnalyze || reference === null || homography === null || quality === null) return;
    const frame = captureFrame();
    if (frame === null) {
      setCameraError('No usable camera frame yet. Wait for the preview and try again.');
      return;
    }
    const nextAnalysis = analyzeDartDifference(reference, frame, homography, {
      boardDiameterPixels: quality.boardDiameterPixels,
    });
    setAnalysis(nextAnalysis);
    lastAnalyzedFrameRef.current = frame;
    setManualCandidate(null);
    const preferred = nextAnalysis.candidates.find(
      (candidate) =>
        candidate.directionEvidence === 'only-endpoint-on-board' && candidate.wireMarginMm >= 1.5,
    );
    setSelectedCandidateId(preferred?.id ?? null);
    setCameraError(null);
    setNotice(nextAnalysis.message);
  };

  const toggleLiveWatch = () => {
    if (watching) {
      setWatching(false);
      setWatchMessage(null);
      setNotice('Live watch paused. You can analyze a settled frame manually.');
      return;
    }
    if (!canAnalyze) return;
    setAnalysis(null);
    setManualCandidate(null);
    setSelectedCandidateId(null);
    watchStabilityRef.current = null;
    setWatching(true);
    setNotice(
      'Watching locally every half second. Throw one dart, move out of frame, and wait for it to settle.',
    );
  };

  const beginManualTipPick = () => {
    if (homography === null || !cameraActive) return;
    setCanvasMode('manual-tip');
    setAnalysis(null);
    setManualCandidate(null);
    setSelectedCandidateId(null);
    setWatching(false);
    lastAnalyzedFrameRef.current = null;
    setNotice(
      'Click the visibly resolved dart tip in the camera frame. The canonical board mapping will score that exact point.',
    );
  };

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = previewCanvasRef.current;
    if (canvas === null || canvas.width === 0 || canvas.height === 0) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const point: ImagePoint = {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };

    if (canvasMode === 'calibrating') {
      const index = nextAnchorIndex;
      if (index < 0) return;
      const nextAnchors = anchors.map((anchor, anchorIndex) =>
        anchorIndex === index ? point : anchor,
      );
      setAnchors(nextAnchors);
      const placed = nextAnchors.filter((anchor): anchor is ImagePoint => anchor !== null);
      if (placed.length < ANNOTATION_ANCHORS.length) {
        setNotice(ANNOTATION_ANCHORS[placed.length]!.instruction);
        return;
      }
      const solved = solveImageToBoardHomography(
        placed,
        ANNOTATION_ANCHORS.map((anchor) => anchor.canonical),
      );
      const frame = captureFrame();
      if (solved === null || frame === null) {
        setHomography(null);
        setQuality(null);
        setCameraError(
          'Those anchors could not form a safe calibration. Reset and click the named double-bed centres again.',
        );
        return;
      }
      const nextQuality = assessGuidedCalibration(placed, frame);
      setHomography(solved);
      setQuality(nextQuality);
      setCanvasMode('preview');
      setCameraError(null);
      setNotice(
        nextQuality.pass
          ? 'Guided calibration passed. Remove every dart and capture a clear-board reference.'
          : 'Guided calibration needs attention. Read the blocking setup checks before continuing.',
      );
      return;
    }

    if (canvasMode === 'manual-tip' && homography !== null) {
      const candidate = candidateFromManualPoint(point, homography);
      if (candidate === null) {
        setCameraError('That point could not be mapped. Recheck the four calibration anchors.');
        return;
      }
      setManualCandidate(candidate);
      setSelectedCandidateId(candidate.id);
      setCanvasMode('preview');
      setCameraError(null);
      setNotice(
        `Visible tip mapped to ${formatZone(candidate.zone)}. Review it, then add it to the current visit.`,
      );
    }
  };

  const addSelectedToVisit = () => {
    if (selectedCandidate === null) {
      setNotice(
        'Select a detector endpoint or choose Manual tip by clicking the visibly resolved dart point.',
      );
      return;
    }
    if (availableSlots <= 0) {
      setNotice(
        'All three DartCards already have scores. Open the review panel to confirm or clear a score.',
      );
      return;
    }
    const detectorSelected = selectedCandidate.shapeId !== 'manual';
    const canCallAuto =
      detectorSelected &&
      selectedCandidate.directionEvidence === 'only-endpoint-on-board' &&
      selectedCandidate.confidence >= 0.55 &&
      selectedCandidate.wireMarginMm >= 1.5;
    const source = detectorSelected ? (canCallAuto ? 'auto' : 'corrected') : 'manual';
    const slot = onAddProposal({
      zone: selectedCandidate.zone,
      confidence: selectedCandidate.confidence,
      wireMarginMm: selectedCandidate.wireMarginMm,
      source,
    });
    if (slot === null) {
      setNotice(
        'The target visit could not accept another score. Open the review panel and try again.',
      );
      return;
    }
    const updatedReference = lastAnalyzedFrameRef.current ?? captureFrame();
    if (updatedReference !== null) setReference(updatedReference);
    setAnalysis(null);
    setManualCandidate(null);
    setSelectedCandidateId(null);
    setCanvasMode('preview');
    setWatching(false);
    setNotice(
      `Added ${formatZone(selectedCandidate.zone)} to Dart ${slot}. That frame is now the local reference; throw the next dart or open the review panel.`,
    );
  };

  const downloadDebugRecord = () => {
    const record = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      product: 'Darts 180 browser field-test scorer',
      privacy: 'No raw image, video, audio, or identifier is included in this record.',
      runtime: {
        cameraActive,
        workingFrame:
          reference === null ? null : { width: reference.width, height: reference.height },
        availableSlots,
      },
      calibration:
        homography === null
          ? null
          : {
              method: 'manual-four-double-bed-homography-v0',
              anchors: ANNOTATION_ANCHORS.map((anchor, index) => ({
                id: anchor.id,
                imagePointPx: anchors[index] === null ? null : anchors[index],
              })),
              imageToBoardHomography: homography,
              quality,
            },
      latestAnalysis:
        analysis === null
          ? null
          : {
              status: analysis.status,
              message: analysis.message,
              differenceThreshold: analysis.differenceThreshold,
              changedPixels: analysis.changedPixels,
              changedFraction: analysis.changedFraction,
              shapes: analysis.shapes,
              candidates: analysis.candidates,
            },
      selectedTip: selectedCandidate,
    };
    const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `darts-180-camera-field-test-${Date.now()}.json`);
  };

  return (
    <section className="camera-score-lab shell">
      <div className="camera-score-intro">
        <div>
          <p className="eyebrow">DARTS 180 EXPERIMENTAL CAMERA SCORE</p>
          <h1>
            Calibrate the board.
            <br />
            <em>Review every dart.</em>
          </h1>
          <p className="lede">
            A deployable, browser-local fixed-camera field test: four-point board calibration,
            clear-board reference, temporal dart-shape proposals, deterministic scoring, and player
            confirmation. It never uploads camera pixels.
          </p>
        </div>
        <aside className="privacy-card camera-score-privacy-card">
          <span>FIELD TEST · NOT TRAINED AI</span>
          <strong>Mounted camera + manual fallback.</strong>
          <p>
            The detector is an inspectable frame-difference heuristic. It can propose a tip, but it
            cannot safely resolve every angle, wire, bounce-out, hand, or stacked dart.
          </p>
        </aside>
      </div>

      <div className="camera-score-grid">
        <section className="camera-score-stage-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">LIVE LOCAL CAMERA</p>
              <h2>
                {canvasMode === 'calibrating'
                  ? (ANNOTATION_ANCHORS[nextAnchorIndex]?.instruction ?? 'Calibration complete')
                  : canvasMode === 'manual-tip'
                    ? 'Click the visibly resolved dart tip.'
                    : 'Keep the mount fixed during a visit.'}
              </h2>
            </div>
            <span className={`camera-state ${cameraActive ? 'on' : ''}`}>
              {cameraActive ? (watching ? 'WATCHING' : 'CAMERA ON') : 'CAMERA OFF'}
            </span>
          </div>

          <div className={`camera-score-surface ${canvasMode !== 'preview' ? 'is-picking' : ''}`}>
            <video ref={videoRef} autoPlay muted playsInline className="camera-score-source" />
            <canvas
              aria-label={
                canvasMode === 'calibrating'
                  ? ANNOTATION_ANCHORS[nextAnchorIndex]?.instruction
                  : canvasMode === 'manual-tip'
                    ? 'Click the visible dart tip to score it manually'
                    : 'Live local camera preview with board calibration and detection overlays'
              }
              className="camera-score-canvas"
              onClick={handleCanvasClick}
              ref={previewCanvasRef}
              role="img"
            />
            <canvas ref={frameCanvasRef} className="camera-score-frame-buffer" aria-hidden="true" />
            {!cameraActive && (
              <div className="camera-score-empty">
                <span>⌁</span>
                <strong>Camera stays in this browser.</strong>
                <p>
                  Open a top-level HTTPS Vercel URL on the mounted device; embedded previews cannot
                  prompt for camera access.
                </p>
              </div>
            )}
            {cameraActive && canvasMode === 'preview' && reference === null && (
              <div className="camera-score-overlay-note">CALIBRATE 4 DOUBLE BEDS</div>
            )}
          </div>

          {cameraError !== null && (
            <p className="camera-error" role="alert">
              {cameraError}
            </p>
          )}
          <div className="camera-score-stage-actions">
            {!cameraActive ? (
              <button className="button primary" onClick={() => void startCamera()} type="button">
                START DEVICE CAMERA
              </button>
            ) : (
              <>
                <button className="button ghost compact" onClick={stopCamera} type="button">
                  STOP CAMERA
                </button>
                <button className="text-button" onClick={resetCalibration} type="button">
                  RESET CAMERA SESSION
                </button>
              </>
            )}
          </div>
          <p className="camera-score-notice" role="status">
            {watchMessage ?? notice}
          </p>
        </section>

        <aside className="camera-score-controls-panel">
          <div>
            <p className="eyebrow">GUIDED FIELD FLOW</p>
            <h2>One dart at a time.</h2>
          </div>

          <section className="camera-score-step">
            <div className="camera-score-step-head">
              <span>01</span>
              <div>
                <strong>Calibrate named beds</strong>
                <small>D20 top · D6 right · D3 bottom · D11 left</small>
              </div>
            </div>
            <div className="camera-anchor-list">
              {ANNOTATION_ANCHORS.map((anchor, index) => (
                <span className={anchors[index] === null ? '' : 'set'} key={anchor.id}>
                  {index + 1} · {anchor.title}
                </span>
              ))}
            </div>
            <button
              className="button secondary"
              disabled={!cameraActive}
              onClick={beginCalibration}
              type="button"
            >
              {homography === null ? 'START 4-POINT CALIBRATION' : 'RECALIBRATE BOARD'}
            </button>
          </section>

          <section className="camera-score-step">
            <div className="camera-score-step-head">
              <span>02</span>
              <div>
                <strong>Capture clear board</strong>
                <small>All darts removed; no hands or moving shadows.</small>
              </div>
            </div>
            <button
              className="button secondary"
              disabled={!canCaptureReference}
              onClick={captureClearBoardReference}
              type="button"
            >
              CAPTURE CLEAR-BOARD REFERENCE
            </button>
          </section>

          <section className="camera-score-step">
            <div className="camera-score-step-head">
              <span>03</span>
              <div>
                <strong>Propose or pick the tip</strong>
                <small>Throw once, step away, then wait for the dart to settle.</small>
              </div>
            </div>
            <div className="camera-score-action-pair">
              <button
                className="button primary"
                disabled={!canAnalyze}
                onClick={analyzeSettledFrame}
                type="button"
              >
                ANALYZE SETTLED FRAME
              </button>
              <button
                className="button ghost"
                disabled={!canAnalyze}
                onClick={toggleLiveWatch}
                type="button"
              >
                {watching ? 'STOP LIVE WATCH' : 'ARM LIVE WATCH'}
              </button>
            </div>
            <button
              className="text-button camera-score-manual-tip"
              disabled={homography === null || !cameraActive}
              onClick={beginManualTipPick}
              type="button"
            >
              PICK VISIBLE TIP MANUALLY
            </button>
          </section>
        </aside>
      </div>

      <section className="camera-quality-panel">
        <div>
          <p className="eyebrow">GUIDED CALIBRATION QUALITY</p>
          <h2>
            {quality === null
              ? 'Waiting for four anchors'
              : quality.pass
                ? 'Setup can enter field test'
                : 'Fix setup before detection'}
          </h2>
        </div>
        {quality === null ? (
          <p>
            Place the four named double-bed anchors. The app will calculate transparent
            browser-local size, perspective, and focus heuristics.
          </p>
        ) : (
          <>
            <div className="camera-quality-metrics">
              <span>
                <b>{Math.round(quality.boardDiameterPixels)} px</b>
                BOARD DIAMETER
              </span>
              <span>
                <b>{Math.round(quality.estimatedOffAxisDegrees)}°</b>
                SCREEN-SPACE ANGLE
              </span>
              <span>
                <b>{Math.round(quality.sharpness)}</b>
                FOCUS DETAIL
              </span>
              <span>
                <b>{Math.round(quality.overall * 100)}%</b>
                GUIDED QUALITY
              </span>
            </div>
            {quality.blockers.length > 0 && (
              <ul className="camera-quality-blockers">
                {quality.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            )}
            {quality.warnings.length > 0 && (
              <ul className="camera-quality-warnings">
                {quality.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section className="camera-result-panel">
        <div className="camera-result-head">
          <div>
            <p className="eyebrow">
              DART REVIEW · {availableSlots} SLOT{availableSlots === 1 ? '' : 'S'} AVAILABLE
            </p>
            <h2>
              {selectedCandidate === null
                ? 'Choose a visible tip before recording'
                : `${formatZone(selectedCandidate.zone)} is ready for review`}
            </h2>
          </div>
          {analysis !== null && (
            <span className={`camera-analysis-status ${analysis.status}`}>
              {analysis.status.replaceAll('-', ' ')}
            </span>
          )}
        </div>

        {analysis !== null && (
          <p className="camera-analysis-message">
            {analysis.message} Processed locally with threshold{' '}
            {Math.round(analysis.differenceThreshold)}; changed area{' '}
            {(analysis.changedFraction * 100).toFixed(2)}%.
          </p>
        )}

        <div className="camera-candidate-grid">
          {analysis?.candidates.map((candidate) => (
            <button
              className={`camera-candidate ${candidate.id === selectedCandidateId ? 'selected' : ''}`}
              key={candidate.id}
              onClick={() => {
                setSelectedCandidateId(candidate.id);
                setManualCandidate(null);
                setNotice(
                  `Detector endpoint ${candidate.endpoint} selected. Compare its marker with the actual tip before recording.`,
                );
              }}
              type="button"
            >
              <span>
                ENDPOINT {candidate.endpoint} ·{' '}
                {candidate.directionEvidence === 'only-endpoint-on-board'
                  ? 'BOARD-SIDE'
                  : 'CHECK VISUALLY'}
              </span>
              <strong>{formatZone(candidate.zone)}</strong>
              <em>
                {Math.round(candidate.confidence * 100)}% shape evidence ·{' '}
                {candidate.wireMarginMm.toFixed(1)} mm wire margin
              </em>
            </button>
          ))}
          {manualCandidate !== null && (
            <article
              className={`camera-candidate manual ${manualCandidate.id === selectedCandidateId ? 'selected' : ''}`}
            >
              <span>MANUAL VISIBLE-TIP PICK</span>
              <strong>{formatZone(manualCandidate.zone)}</strong>
              <em>
                {manualCandidate.wireMarginMm.toFixed(1)} mm wire margin · player-selected image
                point
              </em>
            </article>
          )}
          {analysis === null && manualCandidate === null && (
            <p className="camera-result-empty">
              After calibration and clear-board reference, use <b>Analyze settled frame</b> or{' '}
              <b>Arm live watch</b>. If a tip is visible but the detector is not useful, choose{' '}
              <b>Pick visible tip manually</b>.
            </p>
          )}
        </div>

        {selectedCandidate !== null && (
          <div className="camera-selected-detail">
            <div>
              <small>CANONICAL BOARD POINT</small>
              <strong>
                {selectedCandidate.boardPoint.xMm.toFixed(1)},{' '}
                {selectedCandidate.boardPoint.yMm.toFixed(1)} mm
              </strong>
              <span>
                {selectedCandidate.wireMarginMm < 1.5
                  ? 'Near a scoring wire — visually verify or correct it.'
                  : 'Use the DartCard review flow to confirm or correct it.'}
              </span>
            </div>
            <button
              className="button primary"
              disabled={availableSlots <= 0}
              onClick={addSelectedToVisit}
              type="button"
            >
              ADD {formatZone(selectedCandidate.zone)} TO VISIT
            </button>
          </div>
        )}

        <div className="camera-result-actions">
          <button className="button ghost" onClick={onOpenReview} type="button">
            OPEN DARTCARD REVIEW
          </button>
          <button className="text-button" onClick={downloadDebugRecord} type="button">
            DOWNLOAD LOCAL DEBUG RECORD
          </button>
        </div>
      </section>

      <section className="camera-score-checklist">
        <div>
          <p className="eyebrow">FIRST REAL-BOARD TEST</p>
          <h2>Use a stable, honest envelope.</h2>
        </div>
        <ol>
          <li>
            <b>Mount safely</b>
            <span>
              Phone/tablet outside the throw path, rear camera near board centreline, 0.7–1.2 m
              away.
            </span>
          </li>
          <li>
            <b>Calibrate precisely</b>
            <span>
              Click the centre of D20, D6, D3, and D11 double beds—not the number ring or wire edge.
            </span>
          </li>
          <li>
            <b>One dart, clear frame</b>
            <span>
              Throw, step away, let the dart stop moving, then analyze. Use the visible-tip picker
              if needed.
            </span>
          </li>
          <li>
            <b>Confirm, never assume</b>
            <span>
              Every result remains editable in the DartCard flow. Save only the no-media debug
              record for setup feedback.
            </span>
          </li>
        </ol>
      </section>
    </section>
  );
}

function drawCameraOverlay(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: Readonly<{
    anchors: readonly (ImagePoint | null)[];
    analysis: DifferenceAnalysis | null;
    manualCandidate: DartTipCandidate | null;
    selectedCandidateId: string | null;
    mode: CanvasMode;
  }>,
) {
  context.save();
  context.lineJoin = 'round';
  context.lineCap = 'round';

  if (options.anchors.filter(Boolean).length > 1) {
    context.strokeStyle = 'rgba(143, 220, 193, 0.85)';
    context.lineWidth = Math.max(2, width / 420);
    context.beginPath();
    options.anchors.forEach((point, index) => {
      if (point === null) return;
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    const complete = options.anchors.every((point) => point !== null);
    const first = options.anchors[0];
    if (complete && first !== null && first !== undefined) context.lineTo(first.x, first.y);
    context.stroke();
  }

  options.anchors.forEach((point, index) => {
    if (point === null) return;
    drawPointMarker(
      context,
      point,
      String(index + 1),
      '#ffca69',
      width,
      index === 0 || index === 2,
    );
  });

  for (const shape of options.analysis?.shapes ?? []) drawShape(context, shape, width);
  for (const candidate of options.analysis?.candidates ?? []) {
    const selected = candidate.id === options.selectedCandidateId;
    drawPointMarker(
      context,
      candidate.imagePoint,
      candidate.endpoint,
      selected ? '#72dcae' : '#f5c26a',
      width,
      selected,
    );
  }
  if (options.manualCandidate !== null) {
    drawPointMarker(
      context,
      options.manualCandidate.imagePoint,
      'M',
      '#df6955',
      width,
      options.manualCandidate.id === options.selectedCandidateId,
    );
  }

  if (options.mode === 'calibrating' || options.mode === 'manual-tip') {
    context.fillStyle = 'rgba(6, 15, 11, 0.72)';
    context.fillRect(0, height - 34, width, 34);
    context.fillStyle = '#eafff4';
    context.font = `900 ${Math.max(11, Math.round(width / 58))}px system-ui, sans-serif`;
    context.textAlign = 'center';
    context.fillText(
      options.mode === 'calibrating'
        ? 'CLICK THE HIGHLIGHTED NAMED DOUBLE BED'
        : 'CLICK THE VISIBLE DART TIP',
      width / 2,
      height - 12,
    );
  }
  context.restore();
}

function drawShape(context: CanvasRenderingContext2D, shape: DartShape, width: number) {
  context.save();
  context.strokeStyle = 'rgba(166, 208, 190, 0.65)';
  context.setLineDash([Math.max(4, width / 100), Math.max(3, width / 150)]);
  context.lineWidth = Math.max(1, width / 600);
  context.strokeRect(
    shape.bounds.left,
    shape.bounds.top,
    shape.bounds.right - shape.bounds.left,
    shape.bounds.bottom - shape.bounds.top,
  );
  context.setLineDash([]);
  context.beginPath();
  context.moveTo(shape.endpoints[0].x, shape.endpoints[0].y);
  context.lineTo(shape.endpoints[1].x, shape.endpoints[1].y);
  context.stroke();
  context.restore();
}

function drawPointMarker(
  context: CanvasRenderingContext2D,
  point: ImagePoint,
  label: string,
  color: string,
  width: number,
  selected: boolean,
) {
  const radius = Math.max(10, width / 42);
  context.save();
  context.fillStyle = color;
  context.strokeStyle = selected ? '#f9fffb' : 'rgba(6, 15, 11, 0.9)';
  context.lineWidth = selected ? Math.max(3, width / 270) : Math.max(2, width / 380);
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.fillStyle = '#06100b';
  context.font = `900 ${Math.max(10, Math.round(width / 62))}px system-ui, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, point.x, point.y + 0.5);
  context.restore();
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
