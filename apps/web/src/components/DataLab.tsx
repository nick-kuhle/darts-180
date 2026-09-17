import type { DartZone } from '@darts-180/contracts';
import { BOARD_RADII_MM, formatZone } from '@darts-180/rules';
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';

import {
  DEVELOPMENT_FIVE_POINT_ANNOTATION_ANCHORS,
  invertHomography,
  mapBoardPointToImage,
  mapSetupTemplatePoint,
  setupAffineAnchorImagePoints,
  solveImageToBoardHomography,
  type CanonicalPoint,
  type Homography,
  type ImagePoint,
  type SetupAffineTemplate,
} from '../lib/annotationGeometry';
import { describeCameraAccessError, getCameraAccessPreflightMessage } from '../lib/cameraAccess';
import {
  CaptureVaultError,
  getCaptureVaultStatus,
  uploadPrivateCaptureAsset,
  type CaptureVaultAssetKind,
  type CaptureVaultAvailability,
} from '../lib/captureVault';
import {
  DEVELOPMENT_DATA_LAB_ADMISSION_STATUS,
  DEVELOPMENT_DATA_LAB_CONSENT_VERSION,
  type DevelopmentDataLabConsent,
} from '../lib/captureConsent';
import {
  buildDataLabLearnedSuggestions,
  buildSetupCalibrationSuggestions,
  type DataLabLearnedSuggestionResult,
  type DataLabPointSource,
} from '../lib/developmentVision/dataLabSuggestions';
import {
  DeepDartsDevelopmentEngine,
  type DevelopmentVisionFrame,
} from '../lib/developmentVision/engine';
import { loadDevelopmentModelManifest } from '../lib/developmentVision/modelManifest';
import type {
  DeepDartsDetection,
  DeepDartsDevelopmentModelManifest,
  DeepDartsDevelopmentPose,
  DevelopmentInferenceBackend,
} from '../lib/developmentVision/types';
import {
  DevelopmentWebInferenceClient,
  getDevelopmentBrowserVisionSupport,
} from '../lib/developmentVision/webInferenceClient';
import { captureModelFrame } from '../lib/learnedVision/cameraCapture';

type CaptureIntent = 'empty-board' | 'static-dart';
type LightingBand = 'low' | 'normal' | 'bright' | 'mixed' | 'glare';
type AutoPhase = 'idle' | 'opening' | 'loading-model' | 'running' | 'error';
type ActivityKind = 'info' | 'saved' | 'skipped' | 'error';

interface CaptureManifest extends DevelopmentDataLabConsent {
  captureId: string;
  sessionId: string;
  boardModel: string;
  deviceModel: string;
  captureMode: 'still';
  captureIntent: CaptureIntent;
  imageFile: string;
  imageMime: 'image/jpeg';
  offAxisDegrees: number;
  distanceMm: number;
  lightingBand: LightingBand;
  containsFaces: false;
  createdAt: string;
  labelsVersion: 'unlabeled-v0';
  split: 'unassigned';
}

interface CapturedStill {
  imageBlob: Blob;
  width: number;
  height: number;
  manifest: CaptureManifest;
}

interface AnnotatedDart {
  id: string;
  imagePoint: ImagePoint;
  boardPoint: CanonicalPoint;
  zone: DartZone;
  wireMarginMm: number;
  source: DataLabPointSource;
  modelConfidence: number | null;
}

interface LearnedSuggestionProvenance {
  modelId: DeepDartsDevelopmentModelManifest['modelId'];
  modelVersion: string;
  modelSha256: string;
  trainingDataId: string;
  trainingDataKind: DeepDartsDevelopmentModelManifest['provenance']['trainingDataKind'];
  backend: DevelopmentInferenceBackend;
}

interface AnnotationSidecar {
  schemaVersion: 1;
  capture: CaptureManifest;
  image: { file: string; width: number; height: number };
  board: {
    annotationMethod: 'deepdarts-four-cardinal-homography-v1';
    annotationProfile: 'deepdarts-five-point-v1';
    imageToBoardHomography: number[];
    anchors: Array<{
      id: string;
      canonicalPointMm: [number, number];
      imagePointPx: [number, number] | null;
      labelSource: DataLabPointSource | null;
    }>;
  };
  darts: Array<{
    dartTrackId: string;
    tipPixel: [number, number];
    entryPointBoardMm: [number, number];
    zone: DartZone;
    visibility: 'clear';
    wireMarginMm: number;
    labelSource: DataLabPointSource;
    modelConfidence: number | null;
  }>;
  annotationProvenance: {
    schemaVersion: 1;
    reviewMethod: 'learned-suggestion-auto-capture-v1' | 'setup-calibration-auto-capture-v1';
    learnedSuggestion: LearnedSuggestionProvenance | null;
  };
}

interface SetupCalibration {
  /** cal1–cal4 image points derived from the fitted setup template, in video pixels. */
  anchorImagePoints: readonly ImagePoint[];
  pose: DeepDartsDevelopmentPose;
}

const TEMPLATE_MIN_SCALE = 0.02;
const TEMPLATE_SIZE_MIN_PERCENT = 10;
const TEMPLATE_SIZE_MAX_PERCENT = 140;
const TEMPLATE_DEFAULT_WIDTH_PERCENT = 55;
const TEMPLATE_DEFAULT_HEIGHT_PERCENT = 55;

interface PoseSignature {
  cx: number;
  cy: number;
  radius: number;
  angleDegrees: number;
}

interface RecordSummary {
  intent: CaptureIntent;
  dartCount: number;
  zones: string[];
}

interface QueuedRecord {
  recordId: string;
  captureId: string;
  imageBlob: Blob;
  manifest: CaptureManifest;
  annotation: AnnotationSidecar;
  savedKinds: Set<CaptureVaultAssetKind>;
  attempts: number;
  summary: RecordSummary;
}

interface ActivityEntry {
  id: string;
  kind: ActivityKind;
  text: string;
  at: string;
}

const CAPTURE_LONG_EDGE = 1_536;
const TARGET_JPEG_BYTES = 3_200_000;
const OVERLAY_LONG_EDGE = 1_280;
const INFERENCE_INTERVAL_MS = 900;
const MAX_UPLOAD_ATTEMPTS = 4;
const UPLOAD_RETRY_DELAY_MS = 1_500;
const ACTIVITY_LIMIT = 7;
const SESSION_MOVE_RADIUS_FRACTION = 0.12;
const SESSION_MOVE_DIAMETER_FRACTION = 0.16;
const SESSION_MOVE_ANGLE_DEGREES = 12;
const AUTO_REVIEW_METHOD = 'learned-suggestion-auto-capture-v1';
const SETUP_REVIEW_METHOD = 'setup-calibration-auto-capture-v1';
const CALIBRATION_CLASS_IDS = [1, 2, 3, 4] as const;

/**
 * The deliberately separate collection route. Normal Live Scoring never enters this component,
 * asks for anchors, or uploads media. This consented development Lab keeps one local camera loop
 * running: when a newly thrown dart settles it automatically saves one board still with the learned
 * board/tip points, and whenever the board is clear it saves one blank-board anchor record. A single
 * entry agreement records consent provenance; it is not authentication and every record stays
 * `consented-development-unreviewed` until a restricted operator screens it.
 */
export function DataLab({ onExit }: { onExit: () => void }) {
  const [entryConsentChecked, setEntryConsentChecked] = useState(false);
  const [dataLabConsent, setDataLabConsent] = useState<DevelopmentDataLabConsent | null>(null);

  const acceptEntryConsent = () => {
    if (!entryConsentChecked) return;
    setDataLabConsent({
      consentVersion: DEVELOPMENT_DATA_LAB_CONSENT_VERSION,
      consentAcceptedAt: new Date().toISOString(),
      admissionStatus: DEVELOPMENT_DATA_LAB_ADMISSION_STATUS,
    });
  };

  if (dataLabConsent === null) {
    return (
      <DataLabConsentGate
        checked={entryConsentChecked}
        onChecked={setEntryConsentChecked}
        onContinue={acceptEntryConsent}
        onExit={onExit}
      />
    );
  }

  return <AutoCaptureLab consent={dataLabConsent} onExit={onExit} />;
}

function AutoCaptureLab({
  consent,
  onExit,
}: {
  consent: DevelopmentDataLabConsent;
  onExit: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const clientRef = useRef<DevelopmentWebInferenceClient | null>(null);
  const engineRef = useRef<DeepDartsDevelopmentEngine | null>(null);
  const modelRef = useRef<DeepDartsDevelopmentModelManifest | null>(null);
  const backendRef = useRef<DevelopmentInferenceBackend | null>(null);
  const runGenerationRef = useRef(0);
  const inferenceInFlightRef = useRef(false);
  const captureInFlightRef = useRef(false);
  const latestFrameRef = useRef<DevelopmentVisionFrame | null>(null);
  const overlayFrameRef = useRef<number | null>(null);
  const inferenceTickRef = useRef<() => void>(() => {});
  const overlayTickRef = useRef<() => void>(() => {});
  const stopRef = useRef<() => void>(() => {});

  const sessionIdRef = useRef(newSessionId());
  const sessionPoseRef = useRef<PoseSignature | null>(null);
  const sessionPoseSourceRef = useRef<'learned' | 'setup' | null>(null);
  const setupCalibrationRef = useRef<SetupCalibration | null>(null);
  const developmentManifestRef = useRef<DeepDartsDevelopmentModelManifest | null>(null);
  const poseSourceRef = useRef<'learned' | 'setup' | null>(null);
  const setupTemplateRef = useRef<SetupAffineTemplate | null>(null);
  const templateDraggingRef = useRef(false);
  const templateDragOriginRef = useRef<ImagePoint | null>(null);
  const lastCapturePoseRef = useRef<PoseSignature | null>(null);
  const lastCaptureDartCountRef = useRef(0);
  const awaitingBlankRef = useRef(true);
  const wasOccupiedRef = useRef(false);

  const queueRef = useRef<QueuedRecord[]>([]);
  const processingRef = useRef(false);
  const lastSavedUrlRef = useRef<string | null>(null);

  const [vaultAvailability, setVaultAvailability] = useState<CaptureVaultAvailability>('checking');
  const [phase, setPhase] = useState<AutoPhase>('idle');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [modelManifest, setModelManifest] = useState<DeepDartsDevelopmentModelManifest | null>(
    null,
  );
  const [runtimeBackend, setRuntimeBackend] = useState<DevelopmentInferenceBackend | null>(null);
  const [poseReady, setPoseReady] = useState(false);
  const [poseSource, setPoseSource] = useState<'learned' | 'setup' | null>(null);
  const [setupCalibration, setSetupCalibration] = useState<SetupCalibration | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [setupTemplate, setSetupTemplate] = useState<SetupAffineTemplate | null>(null);
  const [visibleDartCount, setVisibleDartCount] = useState(0);
  const [sessionId, setSessionId] = useState(sessionIdRef.current);
  const [savedCount, setSavedCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [lastSaved, setLastSaved] = useState<{
    summary: RecordSummary;
    imageUrl: string;
    savedAt: string;
  } | null>(null);

  const pushActivity = (kind: ActivityKind, text: string) => {
    const entry: ActivityEntry = {
      id: `evt_${newOpaqueHex()}`,
      kind,
      text,
      at: new Date().toLocaleTimeString(),
    };
    setActivity((current) => [entry, ...current].slice(0, ACTIVITY_LIMIT));
  };

  const revokeLastSaved = () => {
    if (lastSavedUrlRef.current !== null) {
      URL.revokeObjectURL(lastSavedUrlRef.current);
      lastSavedUrlRef.current = null;
    }
  };

  const refreshVaultStatus = async () => {
    setVaultAvailability('checking');
    try {
      const status = await getCaptureVaultStatus();
      setVaultAvailability(status.configured ? 'ready' : 'not-configured');
    } catch {
      // A local Vite session deliberately has no Function. Do not make an absent development
      // endpoint look like cloud storage is available.
      setVaultAvailability('unavailable');
    }
  };

  useEffect(() => {
    void refreshVaultStatus();
  }, []);

  const uploadQueuedRecord = async (item: QueuedRecord) => {
    const assets: Array<{ kind: CaptureVaultAssetKind; body: Blob }> = [
      { kind: 'image', body: item.imageBlob },
      {
        kind: 'manifest',
        body: new Blob([JSON.stringify(item.manifest)], { type: 'application/json' }),
      },
      {
        kind: 'annotations',
        body: new Blob([JSON.stringify(item.annotation)], { type: 'application/json' }),
      },
    ];
    for (const asset of assets) {
      if (item.savedKinds.has(asset.kind)) continue;
      try {
        await uploadPrivateCaptureAsset({
          captureId: item.captureId,
          recordId: item.recordId,
          kind: asset.kind,
          body: asset.body,
        });
        item.savedKinds.add(asset.kind);
      } catch (error) {
        // The retry reuses the exact reviewed bytes. A 409 means this immutable object already
        // landed on an earlier attempt, so it is safe to treat as confirmed rather than replacing it.
        if (error instanceof CaptureVaultError && error.status === 409) {
          item.savedKinds.add(asset.kind);
          continue;
        }
        throw error;
      }
    }
  };

  const processQueue = async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        const item = queueRef.current[0];
        if (item === undefined) break;
        try {
          await uploadQueuedRecord(item);
          queueRef.current.shift();
          setPendingCount(queueRef.current.length);
          setSavedCount((count) => count + 1);
          revokeLastSaved();
          const imageUrl = URL.createObjectURL(item.imageBlob);
          lastSavedUrlRef.current = imageUrl;
          setLastSaved({
            summary: item.summary,
            imageUrl,
            savedAt: new Date().toLocaleTimeString(),
          });
          pushActivity('saved', describeRecord(item.summary));
        } catch (error) {
          item.attempts += 1;
          if (item.attempts >= MAX_UPLOAD_ATTEMPTS) {
            queueRef.current.shift();
            setPendingCount(queueRef.current.length);
            setFailedCount((count) => count + 1);
            pushActivity('error', messageForUploadError(error));
          } else {
            await delay(UPLOAD_RETRY_DELAY_MS * item.attempts);
          }
        }
      }
    } finally {
      processingRef.current = false;
    }
  };

  const makeManifest = (captureId: string, intent: CaptureIntent): CaptureManifest => ({
    captureId,
    sessionId: sessionIdRef.current,
    consentVersion: consent.consentVersion,
    consentAcceptedAt: consent.consentAcceptedAt,
    admissionStatus: consent.admissionStatus,
    boardModel: 'Standard dartboard',
    deviceModel: 'Browser rear camera (auto capture)',
    captureMode: 'still',
    captureIntent: intent,
    imageFile: captureImageFileName(captureId, intent),
    imageMime: 'image/jpeg',
    offAxisDegrees: 20,
    distanceMm: 900,
    lightingBand: 'normal',
    containsFaces: false,
    createdAt: new Date().toISOString(),
    labelsVersion: 'unlabeled-v0',
    split: 'unassigned',
  });

  const applySetupTemplate = (template: SetupAffineTemplate | null) => {
    setupTemplateRef.current = template;
    setSetupTemplate(template);
  };

  const frameDims = (): { width: number; height: number } | null => {
    const video = videoRef.current;
    if (video === null || video.videoWidth <= 0 || video.videoHeight <= 0) return null;
    return { width: video.videoWidth, height: video.videoHeight };
  };

  const defaultSetupTemplate = (): SetupAffineTemplate | null => {
    const dims = frameDims();
    if (dims === null) return null;
    const seedScaleX =
      ((TEMPLATE_DEFAULT_WIDTH_PERCENT / 100) * Math.min(dims.width, dims.height)) /
      (2 * BOARD_RADII_MM.doubleOuter);
    const seedScaleY =
      ((TEMPLATE_DEFAULT_HEIGHT_PERCENT / 100) * Math.min(dims.width, dims.height)) /
      (2 * BOARD_RADII_MM.doubleOuter);
    return {
      centre: { x: dims.width / 2, y: dims.height / 2 },
      scaleX: seedScaleX,
      scaleY: seedScaleY,
      rotationRad: 0,
    };
  };

  const enterSetupCalibration = () => {
    const template = defaultSetupTemplate();
    if (template === null) {
      pushActivity('error', 'Start the camera before fitting the board template.');
      return;
    }
    applySetupTemplate(template);
    setCalibrating(true);
  };

  const cancelSetupCalibration = () => {
    setCalibrating(false);
    applySetupTemplate(null);
    templateDraggingRef.current = false;
    templateDragOriginRef.current = null;
  };

  const initializeDevelopmentModel = async (
    manifest: DeepDartsDevelopmentModelManifest,
    generation: number,
  ): Promise<boolean> => {
    const client = new DevelopmentWebInferenceClient();
    clientRef.current = client;
    try {
      setPhase('loading-model');
      const backend = await client.initialize(manifest);
      if (generation !== runGenerationRef.current) {
        await client.dispose();
        return false;
      }
      modelRef.current = manifest;
      backendRef.current = backend;
      engineRef.current = new DeepDartsDevelopmentEngine();
      sessionIdRef.current = newSessionId();
      setSessionId(sessionIdRef.current);
      sessionPoseRef.current = null;
      sessionPoseSourceRef.current = null;
      poseSourceRef.current = null;
      lastCapturePoseRef.current = null;
      lastCaptureDartCountRef.current = 0;
      awaitingBlankRef.current = true;
      wasOccupiedRef.current = false;
      setRuntimeBackend(backend);
      setModelManifest(manifest);
      setPoseSource(null);
      setPhase('running');
      return true;
    } catch (error) {
      if (generation === runGenerationRef.current) {
        setCameraError(messageForStartError(error));
        setPhase('running');
      }
      clientRef.current = null;
      await client.dispose();
      return false;
    }
  };

  const lockSetupCalibration = async () => {
    const template = setupTemplateRef.current;
    if (template === null) return;
    const anchorImagePoints = setupAffineAnchorImagePoints(template);
    if (anchorImagePoints === null) {
      pushActivity(
        'error',
        'The fitted template is degenerate; adjust the sliders and lock again.',
      );
      return;
    }
    const pose = poseFromAnchorImagePoints(anchorImagePoints);
    if (pose === null) {
      pushActivity('error', 'The fitted template could not be turned into a board pose; retry.');
      return;
    }
    const calibration: SetupCalibration = { anchorImagePoints, pose };
    setupCalibrationRef.current = calibration;
    setSetupCalibration(calibration);
    applySetupTemplate(null);
    templateDraggingRef.current = false;
    templateDragOriginRef.current = null;
    const manifest = developmentManifestRef.current;
    if (manifest === null) {
      setCameraError('The local development model manifest is unavailable; restart the camera.');
      setPhase('running');
      applySetupTemplate(template);
      setCalibrating(true);
      return;
    }
    const ready = await initializeDevelopmentModel(manifest, runGenerationRef.current);
    if (!ready) {
      applySetupTemplate(template);
      setCalibrating(true);
      return;
    }
    setCalibrating(false);
    pushActivity('info', 'Setup locked · anchor detection is now running.');
  };

  const canvasClientToVideoPoint = (clientX: number, clientY: number): ImagePoint | null => {
    const canvas = previewCanvasRef.current;
    const video = videoRef.current;
    if (canvas === null || video === null || video.videoWidth <= 0) return null;
    const scale = Math.min(1, OVERLAY_LONG_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const canvasX = ((clientX - rect.left) * canvas.width) / rect.width;
    const canvasY = ((clientY - rect.top) * canvas.height) / rect.height;
    return { x: canvasX / scale, y: canvasY / scale };
  };

  const onTemplatePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!calibrating || setupTemplateRef.current === null) return;
    const point = canvasClientToVideoPoint(event.clientX, event.clientY);
    if (point === null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    templateDraggingRef.current = true;
    templateDragOriginRef.current = point;
  };

  const onTemplatePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const template = setupTemplateRef.current;
    if (!templateDraggingRef.current || template === null || !calibrating) return;
    const point = canvasClientToVideoPoint(event.clientX, event.clientY);
    const origin = templateDragOriginRef.current;
    if (point === null || origin === null) return;
    applySetupTemplate({
      ...template,
      centre: {
        x: template.centre.x + (point.x - origin.x),
        y: template.centre.y + (point.y - origin.y),
      },
    });
    templateDragOriginRef.current = point;
  };

  const onTemplatePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!templateDraggingRef.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    templateDraggingRef.current = false;
    templateDragOriginRef.current = null;
  };

  const updateTemplateSlider = (
    field: 'centreX' | 'centreY' | 'tiltXDeg' | 'tiltYDeg' | 'rollDeg' | 'widthPct' | 'heightPct',
    value: number,
  ) => {
    const template = setupTemplateRef.current;
    const dims = frameDims();
    if (template === null || dims === null) return;
    const minDim = Math.min(dims.width, dims.height);
    let next: SetupAffineTemplate | null = template;
    if (field === 'centreX') {
      next = { ...template, centre: { x: (value / 100) * dims.width, y: template.centre.y } };
    } else if (field === 'centreY') {
      next = { ...template, centre: { x: template.centre.x, y: (value / 100) * dims.height } };
    } else if (field === 'tiltXDeg') {
      next = { ...template, tiltXRad: (value * Math.PI) / 180 };
    } else if (field === 'tiltYDeg') {
      next = { ...template, tiltYRad: (value * Math.PI) / 180 };
    } else if (field === 'rollDeg') {
      next = { ...template, rotationRad: (value * Math.PI) / 180 };
    } else if (field === 'widthPct') {
      const bannerScaleX = ((value / 100) * minDim) / (2 * BOARD_RADII_MM.doubleOuter);
      next = {
        ...template,
        scaleX: Math.max(bannerScaleX, TEMPLATE_MIN_SCALE),
      };
    } else if (field === 'heightPct') {
      const bannerScaleY = ((value / 100) * minDim) / (2 * BOARD_RADII_MM.doubleOuter);
      next = {
        ...template,
        scaleY: Math.max(bannerScaleY, TEMPLATE_MIN_SCALE),
      };
    }
    applySetupTemplate(next);
  };

  const renderSetupSliders = (): ReactElement | null => {
    const values = templateSliderValues();
    if (values === null) return null;
    const rows: Array<{
      label: string;
      field: 'centreX' | 'centreY' | 'tiltXDeg' | 'tiltYDeg' | 'rollDeg' | 'widthPct' | 'heightPct';
      min: number;
      max: number;
      step: number;
      display: string;
    }> = [
      {
        label: 'BULL LEFT → RIGHT',
        field: 'centreX',
        min: 0,
        max: 100,
        step: 0.5,
        display: `${Math.round(values.bullX)}%`,
      },
      {
        label: 'BULL UP → DOWN',
        field: 'centreY',
        min: 0,
        max: 100,
        step: 0.5,
        display: `${Math.round(values.bullY)}%`,
      },
      {
        label: 'TILT UP ↔ DOWN',
        field: 'tiltXDeg',
        min: -60,
        max: 60,
        step: 1,
        display: `${Math.round(values.tiltXDeg)}°`,
      },
      {
        label: 'TILT LEFT ↔ RIGHT',
        field: 'tiltYDeg',
        min: -60,
        max: 60,
        step: 1,
        display: `${Math.round(values.tiltYDeg)}°`,
      },
      {
        label: 'ROLL CW ↔ CCW',
        field: 'rollDeg',
        min: -180,
        max: 180,
        step: 1,
        display: `${Math.round(values.rollDeg)}°`,
      },
      {
        label: 'WIDTH',
        field: 'widthPct',
        min: TEMPLATE_SIZE_MIN_PERCENT,
        max: TEMPLATE_SIZE_MAX_PERCENT,
        step: 1,
        display: `${Math.round(values.widthPct)}%`,
      },
      {
        label: 'HEIGHT',
        field: 'heightPct',
        min: TEMPLATE_SIZE_MIN_PERCENT,
        max: TEMPLATE_SIZE_MAX_PERCENT,
        step: 1,
        display: `${Math.round(values.heightPct)}%`,
      },
    ];
    return (
      <div className="data-lab-fit-controls" aria-label="Board template fit sliders">
        {rows.map((row) => (
          <label key={row.field} className="data-lab-fit-row">
            <span className="data-lab-fit-label">{row.label}</span>
            <input
              type="range"
              min={row.min}
              max={row.max}
              step={row.step}
              value={
                row.field === 'centreX'
                  ? values.bullX
                  : row.field === 'centreY'
                    ? values.bullY
                    : row.field === 'tiltXDeg'
                      ? values.tiltXDeg
                      : row.field === 'tiltYDeg'
                        ? values.tiltYDeg
                        : row.field === 'rollDeg'
                          ? values.rollDeg
                          : row.field === 'widthPct'
                            ? values.widthPct
                            : values.heightPct
              }
              onChange={(event) => updateTemplateSlider(row.field, Number(event.target.value))}
            />
            <span className="data-lab-fit-value">{row.display}</span>
          </label>
        ))}
      </div>
    );
  };

  const templateSliderValues = (): {
    bullX: number;
    bullY: number;
    tiltXDeg: number;
    tiltYDeg: number;
    rollDeg: number;
    widthPct: number;
    heightPct: number;
  } | null => {
    const template = setupTemplateRef.current;
    const dims = frameDims();
    if (template === null || dims === null) return null;
    const minDim = Math.min(dims.width, dims.height);
    return {
      bullX: (template.centre.x / dims.width) * 100,
      bullY: (template.centre.y / dims.height) * 100,
      tiltXDeg: ((template.tiltXRad ?? 0) * 180) / Math.PI,
      tiltYDeg: ((template.tiltYRad ?? 0) * 180) / Math.PI,
      rollDeg: (template.rotationRad * 180) / Math.PI,
      widthPct: ((template.scaleX * 2 * BOARD_RADII_MM.doubleOuter) / minDim) * 100,
      heightPct: ((template.scaleY * 2 * BOARD_RADII_MM.doubleOuter) / minDim) * 100,
    };
  };

  const captureStillNow = async (intent: CaptureIntent) => {
    const client = clientRef.current;
    const model = modelRef.current;
    const backend = backendRef.current;
    const video = videoRef.current;
    if (
      captureInFlightRef.current ||
      client === null ||
      model === null ||
      backend === null ||
      video === null
    ) {
      return;
    }
    if (video.videoWidth <= 0 || video.videoHeight <= 0) return;

    captureInFlightRef.current = true;
    try {
      // The saved JPEG is bounded and may be downscaled, so the annotation pass runs on that exact
      // encoded still. Its pixel coordinates therefore match the bytes that get stored.
      const snapshot = await makeBoundedJpeg(video);
      const bitmap = await createImageBitmap(snapshot.blob);
      const result = await client.infer(bitmap, snapshot.width, snapshot.height, performance.now());
      let suggestions = buildDataLabLearnedSuggestions(result, model);
      let pose = suggestions.pose;
      let anchorSource: DataLabPointSource = 'learned-suggestion';
      if (pose === null && setupCalibrationRef.current !== null) {
        const scaleFactor = snapshot.width / video.videoWidth;
        const calibratedAnchors = setupCalibrationRef.current.anchorImagePoints.map((point) => ({
          x: point.x * scaleFactor,
          y: point.y * scaleFactor,
        }));
        pose = poseFromAnchorImagePoints(calibratedAnchors);
        if (pose !== null) {
          suggestions = buildSetupCalibrationSuggestions(result, model, calibratedAnchors, pose);
          anchorSource = 'setup-calibration';
        }
      }
      if (pose === null) {
        pushActivity(
          'skipped',
          setupCalibrationRef.current === null
            ? 'No complete board pose in that still, so it was not saved.'
            : 'No usable board frame in that still, so it was not saved.',
        );
        return;
      }
      if (intent === 'static-dart' && suggestions.darts.length === 0) {
        pushActivity('skipped', 'No labelable dart tip in that still, so it was not saved.');
        return;
      }

      const captureId = newCaptureId();
      const manifest = makeManifest(captureId, intent);
      const still: CapturedStill = {
        imageBlob: snapshot.blob,
        width: snapshot.width,
        height: snapshot.height,
        manifest,
      };
      const annotation = buildAutoAnnotation(
        still,
        suggestions,
        pose,
        model,
        backend,
        anchorSource,
      );
      const summary: RecordSummary = {
        intent,
        dartCount: annotation.darts.length,
        zones: annotation.darts.map((dart) => formatZone(dart.zone)),
      };
      const item: QueuedRecord = {
        recordId: newStorageRecordId(),
        captureId,
        imageBlob: snapshot.blob,
        manifest,
        annotation,
        savedKinds: new Set<CaptureVaultAssetKind>(),
        attempts: 0,
        summary,
      };
      queueRef.current.push(item);
      setPendingCount(queueRef.current.length);
      void processQueue();
      pushActivity(
        'info',
        intent === 'empty-board'
          ? 'Captured a blank board · saving anchor record.'
          : `Captured ${summary.dartCount} dart${summary.dartCount === 1 ? '' : 's'}${
              summary.zones.length > 0 ? ` · ${summary.zones.join(' ')}` : ''
            } · saving.`,
      );
    } catch (error) {
      pushActivity('error', messageForSnapshotError(error));
    } finally {
      captureInFlightRef.current = false;
    }
  };

  const evaluateAutoCapture = (frame: DevelopmentVisionFrame) => {
    if (captureInFlightRef.current || frame.pose === null) return;
    const signature = poseSignatureFromFrame(frame) ?? poseSignatureFromPose(frame.pose);
    if (signature === null) return;
    const source = poseSourceRef.current;

    if (sessionPoseRef.current === null || sessionPoseSourceRef.current !== source) {
      sessionPoseRef.current = signature;
      sessionPoseSourceRef.current = source;
    } else if (poseSignificantlyDifferent(signature, sessionPoseRef.current)) {
      // Moving the camera is expected. A materially different board pose starts a new pseudonymous
      // setup session so the compiler can keep every session on one side of a split.
      sessionIdRef.current = newSessionId();
      setSessionId(sessionIdRef.current);
      sessionPoseRef.current = signature;
      awaitingBlankRef.current = true;
      wasOccupiedRef.current = false;
      lastCaptureDartCountRef.current = 0;
      lastCapturePoseRef.current = null;
      pushActivity('info', 'Camera moved · started a new setup session.');
    }

    const settledCount = frame.tracks.filter((track) => track.isSettled).length;
    if (settledCount === 0) {
      if (wasOccupiedRef.current) {
        awaitingBlankRef.current = true;
        wasOccupiedRef.current = false;
      }
      lastCaptureDartCountRef.current = 0;
      lastCapturePoseRef.current = null;
      if (awaitingBlankRef.current) {
        awaitingBlankRef.current = false;
        void captureStillNow('empty-board');
      }
      return;
    }

    wasOccupiedRef.current = true;
    const poseChanged = poseSignificantlyDifferent(signature, lastCapturePoseRef.current);
    if (settledCount > lastCaptureDartCountRef.current || poseChanged) {
      lastCaptureDartCountRef.current = settledCount;
      lastCapturePoseRef.current = signature;
      void captureStillNow('static-dart');
    }
  };

  const runInferenceOnce = async () => {
    const generation = runGenerationRef.current;
    const video = videoRef.current;
    const client = clientRef.current;
    const engine = engineRef.current;
    const model = modelRef.current;
    if (video === null || client === null || engine === null || model === null) return;
    if (inferenceInFlightRef.current || captureInFlightRef.current) return;
    if (calibrating) return;

    inferenceInFlightRef.current = true;
    try {
      const captured = await captureModelFrame(video);
      const result = await client.infer(
        captured.bitmap,
        captured.width,
        captured.height,
        captured.capturedAtMs,
      );
      if (generation !== runGenerationRef.current) return;
      let usedSetupCalibration = false;
      let frame = engine.process(result, model);
      if (frame.pose === null && setupCalibrationRef.current !== null) {
        frame = engine.processWithPose(result, model, setupCalibrationRef.current.pose);
        usedSetupCalibration = true;
      }
      const source = frame.pose === null ? null : usedSetupCalibration ? 'setup' : 'learned';
      poseSourceRef.current = source;
      latestFrameRef.current = frame;
      setPoseReady(frame.pose !== null);
      setPoseSource(source);
      setVisibleDartCount(frame.tracks.filter((track) => track.isSettled).length);
      evaluateAutoCapture(frame);
    } catch (error) {
      if (generation === runGenerationRef.current) setCameraError(messageForInferenceError(error));
    } finally {
      if (generation === runGenerationRef.current) inferenceInFlightRef.current = false;
    }
  };
  inferenceTickRef.current = () => void runInferenceOnce();

  const drawOverlay = () => {
    const video = videoRef.current;
    const canvas = previewCanvasRef.current;
    const frame = latestFrameRef.current;
    if (video !== null && canvas !== null && video.videoWidth > 0 && video.videoHeight > 0) {
      const scale = Math.min(1, OVERLAY_LONG_EDGE / Math.max(video.videoWidth, video.videoHeight));
      const width = Math.max(1, Math.round(video.videoWidth * scale));
      const height = Math.max(1, Math.round(video.videoHeight * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const context = canvas.getContext('2d');
      if (context !== null) {
        context.drawImage(video, 0, 0, width, height);
        context.save();
        context.scale(scale, scale);
        if (calibrating && setupTemplateRef.current !== null) {
          drawSetupTemplate(context, setupTemplateRef.current);
        }
        if (frame !== null && !calibrating) drawFrameOverlay(context, frame);
        context.restore();
      }
    }
    overlayFrameRef.current = window.requestAnimationFrame(() => overlayTickRef.current());
  };
  overlayTickRef.current = drawOverlay;

  const beginOverlay = () => {
    if (overlayFrameRef.current !== null) window.cancelAnimationFrame(overlayFrameRef.current);
    overlayFrameRef.current = window.requestAnimationFrame(() => overlayTickRef.current());
  };

  const stopAutoCapture = () => {
    runGenerationRef.current += 1;
    inferenceInFlightRef.current = false;
    captureInFlightRef.current = false;
    if (overlayFrameRef.current !== null) {
      window.cancelAnimationFrame(overlayFrameRef.current);
      overlayFrameRef.current = null;
    }
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    if (videoRef.current !== null) videoRef.current.srcObject = null;
    const client = clientRef.current;
    clientRef.current = null;
    engineRef.current = null;
    modelRef.current = null;
    backendRef.current = null;
    latestFrameRef.current = null;
    setCameraActive(false);
    setRuntimeBackend(null);
    setModelManifest(null);
    developmentManifestRef.current = null;
    setPoseReady(false);
    setPoseSource(null);
    setSetupCalibration(null);
    setCalibrating(false);
    applySetupTemplate(null);
    setVisibleDartCount(0);
    setPhase('idle');
    setupCalibrationRef.current = null;
    poseSourceRef.current = null;
    sessionPoseSourceRef.current = null;
    if (client !== null) void client.dispose();
  };
  stopRef.current = stopAutoCapture;

  useEffect(
    () => () => {
      stopRef.current();
      if (lastSavedUrlRef.current !== null) URL.revokeObjectURL(lastSavedUrlRef.current);
    },
    [],
  );

  const startAutoCapture = async () => {
    setCameraError(null);
    if (vaultAvailability !== 'ready') {
      setCameraError(messageForCollectionAvailability(vaultAvailability));
      return;
    }
    const preflight = getCameraAccessPreflightMessage();
    if (preflight !== null) {
      setCameraError(preflight);
      setPhase('error');
      return;
    }
    if (navigator.mediaDevices?.getUserMedia === undefined) {
      setCameraError(
        'This browser did not expose a usable camera. Open the direct Darts 180 HTTPS page in Safari or Chrome.',
      );
      setPhase('error');
      return;
    }
    const support = getDevelopmentBrowserVisionSupport();
    if (!support.supported) {
      setCameraError(`This browser cannot run the local board model. ${support.reasons.join(' ')}`);
      setPhase('error');
      return;
    }

    setPhase('opening');
    const loaded = await loadDevelopmentModelManifest();
    if (loaded.manifest === null) {
      setCameraError(
        loaded.message ??
          'No verified local development model is installed on this deployment yet. Auto capture stays off.',
      );
      setPhase('error');
      return;
    }

    const generation = ++runGenerationRef.current;
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
      if (video === null) throw new Error('The camera preview is not ready.');
      video.srcObject = stream;
      await video.play();
      await waitForVideoReady(video);
      if (generation !== runGenerationRef.current) return;
      setCameraActive(true);

      developmentManifestRef.current = loaded.manifest;
      sessionPoseRef.current = null;
      sessionPoseSourceRef.current = null;
      setupCalibrationRef.current = null;
      poseSourceRef.current = null;
      lastCapturePoseRef.current = null;
      lastCaptureDartCountRef.current = 0;
      awaitingBlankRef.current = true;
      wasOccupiedRef.current = false;
      const template = defaultSetupTemplate();
      if (template === null)
        throw new Error('The camera frame is not ready for setup calibration.');
      applySetupTemplate(template);
      setPoseSource(null);
      setSetupCalibration(null);
      setCalibrating(true);
      setPhase('running');
      pushActivity('info', 'Camera ready · fit the board overlay before anchor detection starts.');
      beginOverlay();
    } catch (error) {
      if (generation !== runGenerationRef.current) return;
      if (openedCamera) stopAutoCapture();
      setCameraError(openedCamera ? messageForStartError(error) : describeCameraAccessError(error));
      setPhase('error');
    }
  };

  useEffect(() => {
    if (!cameraActive || phase !== 'running' || calibrating) return;
    const handle = window.setInterval(() => inferenceTickRef.current(), INFERENCE_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, [cameraActive, calibrating, phase]);

  const collectionReady = vaultAvailability === 'ready';
  const busy = phase === 'opening' || phase === 'loading-model';
  const running = phase === 'running';

  return (
    <section className="data-lab data-lab-auto shell">
      <header className="data-lab-intro">
        <div>
          <p className="eyebrow">DARTS 180 · DATA LAB</p>
          <h1>
            Set the camera. Throw.
            <br />
            <em>Every record saves itself.</em>
          </h1>
          <p className="lede">
            This consented development Lab watches the board locally and does the collecting for
            you. Each time a newly thrown dart settles it saves one private board photo with the
            detected board and tip points; whenever the board is clear it saves one blank-board
            anchor record. There is nothing to press while it runs.
          </p>
        </div>
        <aside className="data-lab-privacy-card">
          <span>PRIVATE DEVELOPMENT COLLECTION</span>
          <strong>Board-only. No audio. Unreviewed until screened.</strong>
          <p>
            Keep people and personal room details out of frame. The live image is processed on this
            device, and only the matched JPEG plus its labels are sent to the private collection,
            where every record waits for manual review before any use.
          </p>
        </aside>
      </header>

      {!collectionReady && (
        <section className="data-lab-collection-readiness" aria-live="polite">
          <div>
            <p className="eyebrow">PRIVATE COLLECTION STATUS</p>
            <strong>{privateStorageHeading(vaultAvailability)}</strong>
            <p>{privateStorageDescription(vaultAvailability)}</p>
          </div>
          <button
            className="text-button"
            disabled={vaultAvailability === 'checking'}
            onClick={() => void refreshVaultStatus()}
            type="button"
          >
            CHECK AGAIN
          </button>
        </section>
      )}

      <div className="data-lab-auto-grid">
        <section className="data-lab-camera-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">AUTO CAPTURE</p>
              <h2>{statusHeading(phase, poseReady, visibleDartCount)}</h2>
            </div>
            <span className={`camera-state ${cameraActive ? 'on' : ''}`}>
              {running
                ? calibrating
                  ? 'CALIBRATING'
                  : 'WATCHING'
                : cameraActive
                  ? 'STARTING'
                  : 'CAMERA OFF'}
            </span>
          </div>
          <p className="data-lab-camera-help">
            Keep the whole number ring sharp and in frame. Use a safe mount outside the throw path;
            the Lab reads the live preview locally and only stores the bounded stills it captures.
            If the learned board points stay elusive, tap CALIBRATE SETUP, drag the rings to where
            the board is, tune the sliders to fit, then tap LOCK SETUP — the Lab then locks the
            board and keeps watching.
          </p>
          <div
            className={`camera-frame data-lab-camera-frame ${poseReady ? 'is-pose-ready' : ''} ${calibrating ? 'is-calibrating' : ''}`}
          >
            <video ref={videoRef} className="data-lab-auto-source" autoPlay muted playsInline />
            <canvas
              ref={previewCanvasRef}
              className="data-lab-auto-canvas"
              aria-label="Live rear camera preview with detected board points and an editable board template fit"
              onPointerDown={onTemplatePointerDown}
              onPointerMove={onTemplatePointerMove}
              onPointerUp={onTemplatePointerUp}
              onPointerCancel={onTemplatePointerUp}
            />
            {calibrating && cameraActive && (
              <div className="data-lab-calibration-notice" role="status">
                <strong>SETUP CALIBRATION</strong>
                <p>
                  Drag on the preview to move the template onto the board, then use the sliders to
                  fit its size and tilt. The bull ring should sit on the bull's-eye and the outer
                  ring on the double ring. Then tap <strong>LOCK SETUP</strong>.
                </p>
              </div>
            )}
            {!cameraActive && (
              <div className="camera-empty">
                <span>◉</span>
                <p>
                  Start the camera, point it at the board, and throw. No further taps are needed.
                </p>
              </div>
            )}
            {cameraActive && cameraError !== null && (
              <div className="learned-camera-notice error">
                <strong>CAMERA CHECK NEEDED</strong>
                <p>{cameraError}</p>
              </div>
            )}
          </div>
          {calibrating && setupTemplate !== null && renderSetupSliders()}
          {cameraError !== null && !cameraActive && (
            <p className="camera-error" role="alert">
              {cameraError}
            </p>
          )}
          <div className="capture-actions">
            {!cameraActive ? (
              <button
                className="button primary"
                disabled={busy || !collectionReady}
                onClick={() => void startAutoCapture()}
                type="button"
              >
                {busy ? 'STARTING…' : 'START AUTO CAPTURE'}
              </button>
            ) : (
              <button className="button ghost compact" onClick={stopAutoCapture} type="button">
                STOP CAMERA
              </button>
            )}
            {running &&
              (calibrating ? (
                <>
                  <button
                    className="button primary compact"
                    disabled={setupTemplateRef.current === null}
                    onClick={lockSetupCalibration}
                    type="button"
                  >
                    LOCK SETUP
                  </button>
                  <button
                    className="button ghost compact is-calibrating"
                    onClick={cancelSetupCalibration}
                    type="button"
                  >
                    CANCEL
                  </button>
                </>
              ) : (
                <button
                  className="button ghost compact"
                  onClick={enterSetupCalibration}
                  type="button"
                >
                  CALIBRATE SETUP
                </button>
              ))}
            <button className="text-button" onClick={onExit} type="button">
              ← BACK TO LIVE SCORING
            </button>
          </div>
          <p className="data-lab-auto-note">
            One start and one stop. The Lab never invents a point: a record saves when the four
            board points are locked — by the learned anchors or by the fitted setup template — and,
            for a dart record, at least one settled learned tip is detected.
          </p>
        </section>

        <aside className="data-lab-auto-panel">
          <section className="data-lab-auto-stats">
            <div>
              <p className="eyebrow">SETUP SESSION</p>
              <strong>{sessionId}</strong>
              <small>Rotates automatically when the camera moves to a new setup.</small>
            </div>
            <dl>
              <div>
                <dt>BOARD</dt>
                <dd>
                  {poseReady ? (poseSource === 'setup' ? 'SET · SETUP' : 'SET · LEARNED') : '—'}
                </dd>
              </div>
              <div>
                <dt>DARTS</dt>
                <dd>{visibleDartCount}</dd>
              </div>
              <div>
                <dt>MODEL</dt>
                <dd>{runtimeBackend === null ? '—' : runtimeBackend.toUpperCase()}</dd>
              </div>
            </dl>
          </section>

          <section className="data-lab-auto-model">
            <p className="eyebrow">LOCAL MODEL</p>
            <strong>{modelManifest?.modelVersion ?? 'Not loaded yet'}</strong>
            <p>{modelStageNotice(modelManifest)}</p>
          </section>

          <section className="data-lab-auto-counts" aria-live="polite">
            <div>
              <strong>{savedCount}</strong>
              <span>SAVED</span>
            </div>
            <div>
              <strong>{pendingCount}</strong>
              <span>SAVING</span>
            </div>
            <div>
              <strong>{failedCount}</strong>
              <span>FAILED</span>
            </div>
          </section>

          {lastSaved !== null && (
            <section className="data-lab-auto-last">
              <img alt="Most recently saved board still" src={lastSaved.imageUrl} />
              <div>
                <p className="eyebrow">LAST SAVED</p>
                <strong>
                  {lastSaved.summary.intent === 'empty-board'
                    ? 'Blank board'
                    : `${lastSaved.summary.dartCount} dart${
                        lastSaved.summary.dartCount === 1 ? '' : 's'
                      }`}
                </strong>
                <small>
                  {lastSaved.summary.zones.length > 0
                    ? lastSaved.summary.zones.join(' ')
                    : 'anchor-only'}{' '}
                  · {lastSaved.savedAt}
                </small>
              </div>
            </section>
          )}

          <section className="data-lab-auto-activity">
            <p className="eyebrow">ACTIVITY</p>
            {activity.length === 0 ? (
              <p>Nothing captured yet.</p>
            ) : (
              <ul>
                {activity.map((entry) => (
                  <li className={entry.kind} key={entry.id}>
                    <span>{entry.at}</span>
                    {entry.text}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}

function DataLabConsentGate({
  checked,
  onChecked,
  onContinue,
  onExit,
}: {
  checked: boolean;
  onChecked: (checked: boolean) => void;
  onContinue: () => void;
  onExit: () => void;
}) {
  return (
    <section className="data-lab data-lab-consent shell">
      <div className="data-lab-consent-card">
        <header className="data-lab-consent-intro">
          <p className="eyebrow">DARTS 180 · DATA LAB</p>
          <h1>
            Help improve camera scoring.
            <br />
            <em>Read this before opening the camera.</em>
          </h1>
          <p className="lede">
            Data Lab is a development data-collection tool, not ordinary gameplay. It is the only
            place in Darts 180 where a completed board photo and its points can be collected.
          </p>
        </header>

        <section className="data-lab-consent-notice" aria-labelledby="data-lab-consent-title">
          <div>
            <p className="eyebrow">DEVELOPMENT COLLECTION NOTICE</p>
            <h2 id="data-lab-consent-title">What happens if you continue</h2>
          </div>
          <div className="data-lab-consent-copy">
            <p>
              While the Lab is running it watches the board through this device&apos;s camera and
              automatically collects a board-focused JPEG plus the detected board and tip points and
              limited setup metadata such as a pseudonymous setup ID, camera notes, estimated
              angle/distance, and lighting.
            </p>
            <p>
              Those records are stored privately for Darts 180 development and camera-scoring model
              improvement. They are not publicly displayed or made available from this app. They are
              held for manual privacy, quality, provenance, and training/evaluation review before
              any possible dataset use.
            </p>
            <ul>
              <li>
                Frame only the dartboard and darts—no people, faces, voices, audio, or sensitive
                details.
              </li>
              <li>Avoid collecting in view of people who have not agreed to this notice.</li>
              <li>Submit only a scene you own or have clear permission to use for this purpose.</li>
              <li>Do not use the Lab if you do not agree to this automatic private collection.</li>
            </ul>
          </div>
          <label className="checkbox-label data-lab-consent-check">
            <input
              checked={checked}
              type="checkbox"
              aria-describedby="data-lab-consent-boundary"
              onChange={(event) => onChecked(event.target.checked)}
            />
            <span>
              I understand and agree that completed board-only Data Lab records and related points/
              metadata will be collected privately for Darts 180 product and model improvement. I
              will not include people, faces, audio, sensitive material, or content I lack
              permission to submit.
            </span>
          </label>
          <p className="data-lab-consent-boundary" id="data-lab-consent-boundary">
            This checkbox records the version and time of this agreement with each completed record.
            It does not authenticate or identify you, verify image rights, or make an open
            development intake safe for unreviewed training data.
          </p>
          <div className="data-lab-consent-actions">
            <button className="button ghost" onClick={onExit} type="button">
              ← BACK TO LIVE SCORING
            </button>
            <button
              className="button primary"
              disabled={!checked}
              onClick={onContinue}
              type="button"
            >
              CONTINUE TO DATA LAB
            </button>
          </div>
        </section>
      </div>
    </section>
  );
}

function buildAutoAnnotation(
  captured: CapturedStill,
  suggestions: DataLabLearnedSuggestionResult,
  pose: DeepDartsDevelopmentPose,
  model: DeepDartsDevelopmentModelManifest,
  backend: DevelopmentInferenceBackend,
  anchorSource: DataLabPointSource = 'learned-suggestion',
): AnnotationSidecar {
  const anchors = suggestions.anchors.map((anchor) => anchor?.imagePoint ?? null);
  const anchorSources = suggestions.anchors.map((anchor) =>
    anchor === null ? null : anchorSource,
  );
  const darts: AnnotatedDart[] = suggestions.darts.map((dart, index) => ({
    id: `auto-${captured.manifest.captureId}-dart-${index + 1}`,
    imagePoint: dart.imagePoint,
    boardPoint: dart.boardPoint,
    zone: dart.zone,
    wireMarginMm: dart.wireMarginMm,
    source: 'learned-suggestion',
    modelConfidence: dart.confidence,
  }));
  return createAnnotationSidecar(
    captured,
    anchors,
    anchorSources,
    pose.imageToBoardHomography,
    darts,
    {
      modelId: model.modelId,
      modelVersion: model.modelVersion,
      modelSha256: model.sha256,
      trainingDataId: model.provenance.trainingDataId,
      trainingDataKind: model.provenance.trainingDataKind,
      backend,
    },
    anchorSource === 'setup-calibration' ? SETUP_REVIEW_METHOD : AUTO_REVIEW_METHOD,
  );
}

function createAnnotationSidecar(
  captured: CapturedStill,
  anchors: readonly (ImagePoint | null)[],
  anchorSources: readonly (DataLabPointSource | null)[],
  homography: Homography,
  darts: readonly AnnotatedDart[],
  learnedSuggestion: LearnedSuggestionProvenance | null,
  reviewMethod: 'learned-suggestion-auto-capture-v1' | 'setup-calibration-auto-capture-v1',
): AnnotationSidecar {
  return {
    schemaVersion: 1,
    capture: captured.manifest,
    image: {
      file: captured.manifest.imageFile,
      width: captured.width,
      height: captured.height,
    },
    board: {
      annotationMethod: 'deepdarts-four-cardinal-homography-v1',
      annotationProfile: 'deepdarts-five-point-v1',
      imageToBoardHomography: homography.map((value) => round(value, 10)),
      anchors: DEVELOPMENT_FIVE_POINT_ANNOTATION_ANCHORS.map((anchor, index) => {
        const point = anchors[index] ?? null;
        return {
          id: anchor.id,
          canonicalPointMm: [anchor.canonical.xMm, anchor.canonical.yMm],
          imagePointPx: point === null ? null : [round(point.x, 2), round(point.y, 2)],
          labelSource: anchorSources[index] ?? null,
        };
      }),
    },
    darts: darts.map((dart, index) => ({
      dartTrackId: `auto-${captured.manifest.captureId}-dart-${index + 1}`,
      tipPixel: [round(dart.imagePoint.x, 2), round(dart.imagePoint.y, 2)],
      entryPointBoardMm: [round(dart.boardPoint.xMm, 3), round(dart.boardPoint.yMm, 3)],
      zone: dart.zone,
      visibility: 'clear',
      wireMarginMm: round(dart.wireMarginMm, 3),
      labelSource: dart.source,
      modelConfidence: dart.modelConfidence,
    })),
    annotationProvenance: {
      schemaVersion: 1,
      reviewMethod,
      learnedSuggestion,
    },
  };
}

function poseFromAnchorImagePoints(
  anchorImagePoints: readonly ImagePoint[],
): DeepDartsDevelopmentPose | null {
  if (anchorImagePoints.length !== 4) return null;
  const canonicalPoints = DEVELOPMENT_FIVE_POINT_ANNOTATION_ANCHORS.map(
    (anchor) => anchor.canonical,
  );
  const imageToBoardHomography = solveImageToBoardHomography(anchorImagePoints, canonicalPoints);
  if (imageToBoardHomography === null) return null;
  const boardToImageHomography = invertHomography(imageToBoardHomography);
  if (boardToImageHomography === null) return null;
  const first = anchorImagePoints[0];
  const second = anchorImagePoints[1];
  const third = anchorImagePoints[2];
  const fourth = anchorImagePoints[3];
  if (first === undefined || second === undefined || third === undefined || fourth === undefined) {
    return null;
  }
  const boardDiameterPixels =
    (Math.hypot(first.x - second.x, first.y - second.y) +
      Math.hypot(third.x - fourth.x, third.y - fourth.y)) /
    2;
  if (!Number.isFinite(boardDiameterPixels) || boardDiameterPixels <= 0) return null;
  return {
    imageToBoardHomography,
    boardToImageHomography,
    boardDiameterPixels,
    minimumAnchorConfidence: 0,
  };
}

function poseSignatureFromPose(pose: DeepDartsDevelopmentPose): PoseSignature | null {
  const centre = mapBoardPointToImage({ xMm: 0, yMm: 0 }, pose.boardToImageHomography);
  const cal1 = mapBoardPointToImage(
    DEVELOPMENT_FIVE_POINT_ANNOTATION_ANCHORS[0]!.canonical,
    pose.boardToImageHomography,
  );
  if (centre === null || cal1 === null || !(pose.boardDiameterPixels > 0)) return null;
  return {
    cx: centre.x,
    cy: centre.y,
    radius: pose.boardDiameterPixels / 2,
    angleDegrees: (Math.atan2(cal1.y - centre.y, cal1.x - centre.x) * 180) / Math.PI,
  };
}

function poseSignatureFromFrame(frame: DevelopmentVisionFrame): PoseSignature | null {
  const points: ImagePoint[] = [];
  for (const classId of CALIBRATION_CLASS_IDS) {
    const detection = bestDetectionOfClass(frame.detections, classId);
    if (detection === null) return null;
    points.push({ x: detection.center.xPx, y: detection.center.yPx });
  }
  const first = points[0];
  if (first === undefined) return null;
  const cx = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const cy = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const radius =
    points.reduce((sum, point) => sum + Math.hypot(point.x - cx, point.y - cy), 0) / points.length;
  if (!(radius > 0)) return null;
  return {
    cx,
    cy,
    radius,
    angleDegrees: (Math.atan2(first.y - cy, first.x - cx) * 180) / Math.PI,
  };
}

function bestDetectionOfClass(
  detections: readonly DeepDartsDetection[],
  classId: (typeof CALIBRATION_CLASS_IDS)[number],
): DeepDartsDetection | null {
  return (
    detections
      .filter(
        (detection) =>
          detection.classId === classId &&
          Number.isFinite(detection.center.xPx) &&
          Number.isFinite(detection.center.yPx),
      )
      .sort(
        (left, right) =>
          right.confidence - left.confidence ||
          left.center.xPx - right.center.xPx ||
          left.center.yPx - right.center.yPx,
      )[0] ?? null
  );
}

function poseSignificantlyDifferent(
  current: PoseSignature,
  previous: PoseSignature | null,
): boolean {
  if (previous === null) return false;
  const radius = (current.radius + previous.radius) / 2;
  if (!(radius > 0)) return false;
  const centroidShift = Math.hypot(current.cx - previous.cx, current.cy - previous.cy);
  if (centroidShift > radius * SESSION_MOVE_RADIUS_FRACTION) return true;
  if (Math.abs(current.radius - previous.radius) > radius * SESSION_MOVE_DIAMETER_FRACTION) {
    return true;
  }
  return (
    angularDifference(current.angleDegrees, previous.angleDegrees) > SESSION_MOVE_ANGLE_DEGREES
  );
}

function angularDifference(first: number, second: number): number {
  const difference = Math.abs(first - second) % 360;
  return difference > 180 ? 360 - difference : difference;
}

function drawFrameOverlay(context: CanvasRenderingContext2D, frame: DevelopmentVisionFrame): void {
  if (frame.pose !== null) {
    context.save();
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
      drawMappedCircle(context, frame.pose.boardToImageHomography, radius);
    }
    context.restore();
  }

  for (const detection of frame.detections) {
    const isDart = detection.classId === 0;
    context.save();
    context.strokeStyle = isDart ? '#ffffff' : '#f7c96f';
    context.fillStyle = isDart ? 'rgba(255, 255, 255, 0.13)' : 'rgba(247, 201, 111, 0.16)';
    context.lineWidth = 2;
    context.beginPath();
    context.arc(detection.center.xPx, detection.center.yPx, isDart ? 7 : 8, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle = '#ffffff';
    context.font = '800 13px ui-sans-serif, system-ui, sans-serif';
    context.textAlign = 'center';
    context.fillText(
      isDart ? 'DART' : `CAL ${detection.classId}`,
      detection.center.xPx,
      detection.center.yPx - 11,
    );
    context.restore();
  }

  if (frame.pose !== null) {
    for (const track of frame.tracks) {
      const point = mapBoardPointToImage(track.boardPointMm, frame.pose.boardToImageHomography);
      if (point === null) continue;
      context.save();
      context.strokeStyle = track.isSettled ? '#f7c96f' : '#ffffff';
      context.lineWidth = 3;
      context.beginPath();
      context.arc(point.x, point.y, track.isSettled ? 11 : 7, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }
  }
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

function drawSetupTemplate(context: CanvasRenderingContext2D, template: SetupAffineTemplate): void {
  const { centre } = template;
  const mapPoint = (xMm: number, yMm: number): ImagePoint | null =>
    mapSetupTemplatePoint(template, xMm, yMm);

  context.save();
  context.strokeStyle = 'rgba(247, 201, 111, 0.72)';
  context.fillStyle = 'rgba(247, 201, 111, 0.2)';
  context.lineWidth = 1.5;

  context.beginPath();
  for (let step = 0; step < 8; step += 1) {
    const angle = (step / 8) * Math.PI * 2;
    const edge = mapPoint(
      Math.cos(angle) * BOARD_RADII_MM.doubleOuter,
      Math.sin(angle) * BOARD_RADII_MM.doubleOuter,
    );
    if (edge === null) continue;
    context.moveTo(centre.x, centre.y);
    context.lineTo(edge.x, edge.y);
  }
  context.stroke();

  for (const radius of [
    BOARD_RADII_MM.doubleOuter,
    BOARD_RADII_MM.doubleInner,
    BOARD_RADII_MM.trebleOuter,
    BOARD_RADII_MM.trebleInner,
    BOARD_RADII_MM.outerBull,
    BOARD_RADII_MM.innerBull,
  ]) {
    const steps = 72;
    context.beginPath();
    for (let step = 0; step <= steps; step += 1) {
      const angle = (step / steps) * Math.PI * 2;
      const point = mapPoint(Math.cos(angle) * radius, Math.sin(angle) * radius);
      if (point === null) continue;
      if (step === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    }
    context.closePath();
    context.stroke();
  }

  context.strokeStyle = '#ffffff';
  context.fillStyle = 'rgba(247, 201, 111, 0.95)';
  context.lineWidth = 2;
  context.beginPath();
  context.arc(centre.x, centre.y, 5, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.restore();
}

async function makeBoundedJpeg(
  video: HTMLVideoElement,
): Promise<{ blob: Blob; width: number; height: number }> {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (sourceWidth <= 0 || sourceHeight <= 0) throw new Error('The camera has no usable frame yet.');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('This browser could not prepare a private still image.');

  let scale = Math.min(1, CAPTURE_LONG_EDGE / Math.max(sourceWidth, sourceHeight));
  for (const quality of [0.9, 0.84, 0.78]) {
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToJpegBlob(canvas, quality);
    if (blob.size <= TARGET_JPEG_BYTES) {
      return { blob, width: canvas.width, height: canvas.height };
    }
    scale *= 0.78;
  }
  throw new Error(
    'The camera image stayed too large for the private capture limit. Reframe and retake it.',
  );
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) {
          reject(new Error('This browser could not encode the board still as JPEG.'));
          return;
        }
        resolve(blob);
      },
      'image/jpeg',
      quality,
    );
  });
}

function waitForVideoReady(video: HTMLVideoElement): Promise<void> {
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function describeRecord(summary: RecordSummary): string {
  if (summary.intent === 'empty-board') return 'Saved a blank-board anchor record.';
  const zones = summary.zones.length > 0 ? summary.zones.join(' ') : `${summary.dartCount} tips`;
  return `Saved a dart record · ${zones}.`;
}

function statusHeading(phase: AutoPhase, poseReady: boolean, dartCount: number): string {
  if (phase === 'idle') return 'Camera off.';
  if (phase === 'opening') return 'Opening the rear camera…';
  if (phase === 'loading-model') return 'Verifying the local board model…';
  if (phase === 'error') return 'Auto capture paused safely.';
  if (!poseReady) return 'Looking for the four board points…';
  if (dartCount === 0) return 'Board set. Throw when ready.';
  return `Board set · ${dartCount} dart${dartCount === 1 ? '' : 's'} recognized.`;
}

function modelStageNotice(model: DeepDartsDevelopmentModelManifest | null): string {
  if (model === null) {
    return 'The verified local development model loads when the camera starts.';
  }
  return dataLabTrainingProvenanceNotice(model.provenance.trainingDataKind);
}

function dataLabTrainingProvenanceNotice(
  trainingDataKind: DeepDartsDevelopmentModelManifest['provenance']['trainingDataKind'],
): string {
  if (trainingDataKind === 'synthetic-only') {
    return 'It is a synthetic bootstrap model, not a real-world accuracy claim.';
  }
  if (trainingDataKind === 'mixed-synthetic-and-real') {
    return 'It learned from reviewed real and simulated scenes; every point is still saved unreviewed for screening.';
  }
  return 'It learned from reviewed development data; every point is still saved unreviewed for screening.';
}

function newCaptureId(): string {
  return `cap_${newOpaqueHex()}`;
}

function newStorageRecordId(): string {
  return `record_${newOpaqueHex()}`;
}

function newSessionId(): string {
  return `session_${newOpaqueHex()}`;
}

function newOpaqueHex(): string {
  const secureCrypto =
    typeof crypto === 'undefined' ? undefined : (crypto as Crypto & { randomUUID?: () => string });
  if (typeof secureCrypto?.randomUUID === 'function') {
    return secureCrypto.randomUUID().replaceAll('-', '');
  }
  if (secureCrypto !== undefined && typeof secureCrypto.getRandomValues === 'function') {
    const bytes = secureCrypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (value: number) => value.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('Data Lab needs a browser with secure random IDs.');
}

function captureImageFileName(captureId: string, captureIntent: CaptureIntent): string {
  return `darts-180-${captureId}-${captureIntent}.jpg`;
}

function round(value: number, decimalPlaces: number): number {
  return Number(value.toFixed(decimalPlaces));
}

function messageForSnapshotError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'The board still could not be taken. No photo was stored.';
}

function messageForInferenceError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return `Local board reading stopped: ${error.message}`;
  }
  return 'The local board reading stopped unexpectedly. No new record was saved.';
}

function messageForStartError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return `Auto capture could not start: ${error.message}`;
  }
  return 'Auto capture could not start on this device. No record was saved.';
}

function messageForUploadError(error: unknown): string {
  if (error instanceof Error && error.message) {
    if (error.message.includes('already exists')) {
      return `${error.message} The confirmed private record was left untouched.`;
    }
    return error.message;
  }
  return 'Private storage did not confirm this record after several automatic retries.';
}

function privateStorageHeading(availability: CaptureVaultAvailability): string {
  if (availability === 'ready') return 'Private collection ready.';
  if (availability === 'checking') return 'Checking the private development collection…';
  if (availability === 'not-configured') return 'Private collection setup is incomplete.';
  return 'The private development collection is unavailable.';
}

function privateStorageDescription(availability: CaptureVaultAvailability): string {
  if (availability === 'ready') {
    return 'Each captured still and its two JSON records go through the same-origin guarded intake Function into a private Blob store. The app never exposes a Blob credential or public image link.';
  }
  if (availability === 'checking') {
    return 'Checking whether this deployment can reach its private collection. The camera stays disabled until that check succeeds.';
  }
  if (availability === 'not-configured') {
    return 'This deployment is fail-closed until its private Blob store and development-consent access mode are configured. The camera stays disabled and no record can be saved here.';
  }
  return 'This page cannot reach the private intake Function. The camera stays disabled until the deployment and its private collection are available.';
}

function messageForCollectionAvailability(availability: CaptureVaultAvailability): string {
  if (availability === 'checking') {
    return 'Checking the private development collection. Wait for it to be ready before starting the camera.';
  }
  if (availability === 'not-configured') {
    return 'Private collection setup is incomplete on this deployment. Auto capture is disabled.';
  }
  return 'The private development collection is unavailable. Auto capture is disabled until it is reachable.';
}
