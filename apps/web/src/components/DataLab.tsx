import type { DartZone } from '@darts-180/contracts';
import { decodeBoardPoint, formatZone, nearestWireMarginMm } from '@darts-180/rules';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  DEVELOPMENT_FIVE_POINT_ANNOTATION_ANCHORS,
  mapImagePointToBoard,
  solveImageToBoardHomography,
  type CanonicalPoint,
  type Homography,
  type ImagePoint,
} from '../lib/annotationGeometry';
import { describeCameraAccessError, getCameraAccessPreflightMessage } from '../lib/cameraAccess';
import {
  buildDataLabLearnedSuggestions,
  type DataLabPointSource,
} from '../lib/developmentVision/dataLabSuggestions';
import { loadDevelopmentModelManifest } from '../lib/developmentVision/modelManifest';
import {
  DevelopmentWebInferenceClient,
  getDevelopmentBrowserVisionSupport,
} from '../lib/developmentVision/webInferenceClient';
import type {
  DeepDartsDevelopmentModelManifest,
  DevelopmentInferenceBackend,
} from '../lib/developmentVision/types';
import {
  DEVELOPMENT_DATA_LAB_ADMISSION_STATUS,
  DEVELOPMENT_DATA_LAB_CONSENT_VERSION,
  type DevelopmentDataLabConsent,
} from '../lib/captureConsent';
import {
  getCaptureVaultStatus,
  uploadPrivateCaptureAsset,
  type CaptureVaultAssetKind,
  type CaptureVaultAvailability,
} from '../lib/captureVault';

type DataLabStep = 'capture' | 'label' | 'save';
type CaptureIntent = 'empty-board' | 'static-dart';
type LightingBand = 'low' | 'normal' | 'bright' | 'mixed' | 'glare';
type AssetSaveState = 'idle' | 'saving' | 'saved' | 'failed';

interface CaptureMetadata {
  sessionId: string;
  boardModel: string;
  deviceModel: string;
  captureIntent: CaptureIntent;
  offAxisDegrees: string;
  distanceMm: string;
  lightingBand: LightingBand;
}

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
  imageUrl: string;
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

type DataLabSuggestionState =
  | { kind: 'idle' }
  | { kind: 'analysing' }
  | {
      kind: 'ready';
      anchorCount: number;
      dartCount: number;
      /** Tips are never prefilled unless the four learned anchors form this valid pose. */
      hasCompletePose: boolean;
      omittedDartDetectionCount: number;
      modelVersion: string;
      trainingDataKind: DeepDartsDevelopmentModelManifest['provenance']['trainingDataKind'];
      backend: DevelopmentInferenceBackend;
    }
  | { kind: 'manual-required'; message: string }
  | { kind: 'failed'; message: string };

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
    reviewMethod: 'manual-review-v1' | 'learned-suggestion-human-review-v1';
    learnedSuggestion: LearnedSuggestionProvenance | null;
  };
}

const EMPTY_ANCHORS: Array<ImagePoint | null> = [null, null, null, null];
const EMPTY_ANCHOR_SOURCES: Array<DataLabPointSource | null> = [null, null, null, null];
const INITIAL_ASSET_STATES: Record<CaptureVaultAssetKind, AssetSaveState> = {
  image: 'idle',
  manifest: 'idle',
  annotations: 'idle',
};
const CAPTURE_LONG_EDGE = 1_536;
const TARGET_JPEG_BYTES = 3_200_000;

/**
 * The deliberately separate collection route. Normal Live Scoring never enters this component,
 * asks for anchors, or uploads media. Data Lab makes a consented first-model sample in one short
 * sequence: choose a kind, photograph it, review a genuine local-model suggestion when one is installed
 * (or label it manually), then automatically save the reviewed matched record to private development storage. A required entry agreement records consent provenance;
 * it is not authentication and every record still needs manual data-operations review before training.
 */
export function DataLab({ onExit }: { onExit: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const automaticSaveStartedRef = useRef(false);
  const automaticUploadAttemptedRecordRef = useRef<string | null>(null);
  const uploadInFlightRef = useRef(false);
  const suggestionRequestRef = useRef(0);
  const suggestionClientRef = useRef<DevelopmentWebInferenceClient | null>(null);

  const cancelLearnedSuggestion = useCallback(() => {
    suggestionRequestRef.current += 1;
    const client = suggestionClientRef.current;
    suggestionClientRef.current = null;
    if (client !== null) void client.dispose();
  }, []);

  const [entryConsentChecked, setEntryConsentChecked] = useState(false);
  const [dataLabConsent, setDataLabConsent] = useState<DevelopmentDataLabConsent | null>(null);
  const [step, setStep] = useState<DataLabStep>('capture');
  const [metadata, setMetadata] = useState<CaptureMetadata>(initialMetadata);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [captured, setCaptured] = useState<CapturedStill | null>(null);
  const [privacyConfirmed, setPrivacyConfirmed] = useState(false);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [anchors, setAnchors] = useState<Array<ImagePoint | null>>(EMPTY_ANCHORS);
  const [anchorSources, setAnchorSources] =
    useState<Array<DataLabPointSource | null>>(EMPTY_ANCHOR_SOURCES);
  const [activeAnchorIndex, setActiveAnchorIndex] = useState<number | null>(0);
  const [activeDartId, setActiveDartId] = useState<string | null>(null);
  const [darts, setDarts] = useState<AnnotatedDart[]>([]);
  const [suggestionState, setSuggestionState] = useState<DataLabSuggestionState>({ kind: 'idle' });
  const [learnedSuggestionProvenance, setLearnedSuggestionProvenance] =
    useState<LearnedSuggestionProvenance | null>(null);
  const [annotationReviewed, setAnnotationReviewed] = useState(false);
  const [annotationError, setAnnotationError] = useState<string | null>(null);
  const [vaultAvailability, setVaultAvailability] = useState<CaptureVaultAvailability>('checking');
  const [assetStates, setAssetStates] =
    useState<Record<CaptureVaultAssetKind, AssetSaveState>>(INITIAL_ASSET_STATES);
  const [storageRecordId, setStorageRecordId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const releaseCamera = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    if (videoRef.current !== null) videoRef.current.srcObject = null;
    setCameraActive(false);
  }, []);

  useEffect(() => releaseCamera, [releaseCamera]);

  useEffect(() => cancelLearnedSuggestion, [cancelLearnedSuggestion]);

  useEffect(() => {
    const url = captured?.imageUrl;
    return () => {
      if (url !== undefined) URL.revokeObjectURL(url);
    };
  }, [captured?.imageUrl]);

  const refreshVaultStatus = useCallback(async () => {
    setVaultAvailability('checking');
    try {
      const status = await getCaptureVaultStatus();
      setVaultAvailability(status.configured ? 'ready' : 'not-configured');
    } catch {
      // A local Vite session deliberately has no Function. Do not make an absent development
      // endpoint look like cloud storage is available.
      setVaultAvailability('unavailable');
    }
  }, []);

  useEffect(() => {
    if (dataLabConsent !== null) void refreshVaultStatus();
  }, [dataLabConsent, refreshVaultStatus]);

  const resetAnnotation = useCallback(() => {
    cancelLearnedSuggestion();
    setAnchors([...EMPTY_ANCHORS]);
    setAnchorSources([...EMPTY_ANCHOR_SOURCES]);
    setActiveAnchorIndex(0);
    setActiveDartId(null);
    setDarts([]);
    setSuggestionState({ kind: 'idle' });
    setLearnedSuggestionProvenance(null);
    setAnnotationReviewed(false);
    setAnnotationError(null);
  }, [cancelLearnedSuggestion]);

  const startCamera = async () => {
    if (dataLabConsent === null) {
      setCameraError(
        'Read and accept the Data Lab development collection notice before using the camera.',
      );
      return;
    }
    if (vaultAvailability !== 'ready') {
      setCameraError(messageForCollectionAvailability(vaultAvailability));
      return;
    }
    const preflight = getCameraAccessPreflightMessage();
    if (preflight !== null) {
      setCameraError(preflight);
      return;
    }
    if (navigator.mediaDevices?.getUserMedia === undefined) {
      setCameraError(
        'This browser did not expose a usable camera. Open the direct Darts 180 HTTPS page in Safari or Chrome.',
      );
      return;
    }
    try {
      releaseCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video === null) throw new Error('The camera preview is not ready.');
      video.srcObject = stream;
      await video.play();
      setCameraActive(true);
      setCameraError(null);
    } catch (error) {
      releaseCamera();
      setCameraError(describeCameraAccessError(error));
    }
  };

  const captureStill = async () => {
    if (dataLabConsent === null) {
      setCameraError(
        'Read and accept the Data Lab development collection notice before taking a photo.',
      );
      return;
    }
    if (vaultAvailability !== 'ready') {
      setCameraError(messageForCollectionAvailability(vaultAvailability));
      return;
    }
    if (!isValidSessionId(metadata.sessionId)) {
      setCameraError('The generated setup session ID is invalid. Start a new setup session.');
      return;
    }
    if (!hasPlausibleMetadata(metadata)) {
      setCameraError('Check the estimated distance and camera angle before taking this still.');
      return;
    }
    const video = videoRef.current;
    if (video === null || video.videoWidth <= 0 || video.videoHeight <= 0) {
      setCameraError('Start the rear camera and wait for the board preview before taking a still.');
      return;
    }
    try {
      const snapshot = await makeBoundedJpeg(video);
      const captureId = newCaptureId();
      const imageFile = captureImageFileName(captureId, metadata.captureIntent);
      const manifest: CaptureManifest = {
        captureId,
        sessionId: metadata.sessionId.trim(),
        consentVersion: dataLabConsent.consentVersion,
        consentAcceptedAt: dataLabConsent.consentAcceptedAt,
        admissionStatus: dataLabConsent.admissionStatus,
        boardModel: metadata.boardModel.trim() || 'Standard dartboard',
        deviceModel: metadata.deviceModel.trim() || 'Browser rear camera',
        captureMode: 'still',
        captureIntent: metadata.captureIntent,
        imageFile,
        imageMime: 'image/jpeg',
        offAxisDegrees: numeric(metadata.offAxisDegrees, 20),
        distanceMm: numeric(metadata.distanceMm, 900),
        lightingBand: metadata.lightingBand,
        containsFaces: false,
        createdAt: new Date().toISOString(),
        labelsVersion: 'unlabeled-v0',
        split: 'unassigned',
      };
      const still: CapturedStill = {
        imageBlob: snapshot.blob,
        imageUrl: URL.createObjectURL(snapshot.blob),
        width: snapshot.width,
        height: snapshot.height,
        manifest,
      };
      setCaptured(still);
      automaticSaveStartedRef.current = false;
      automaticUploadAttemptedRecordRef.current = null;
      setPrivacyConfirmed(false);
      setRightsConfirmed(false);
      setStorageRecordId(null);
      setAssetStates({ ...INITIAL_ASSET_STATES });
      setUploadError(null);
      resetAnnotation();
      releaseCamera();
      setCameraError(null);
      // The pass begins for every newly captured still and remains entirely local. It does not
      // advance past the per-still privacy/rights check or save anything without review.
      void runLearnedSuggestions(still);
    } catch (error) {
      setCameraError(messageForSnapshotError(error));
    }
  };

  const runLearnedSuggestions = useCallback(
    async (still: CapturedStill | null = captured) => {
      if (still === null) return;

      cancelLearnedSuggestion();
      const requestId = suggestionRequestRef.current + 1;
      suggestionRequestRef.current = requestId;
      const isCurrentRequest = () => suggestionRequestRef.current === requestId;
      // A deliberate retry replaces the point set, rather than allowing an asynchronous inference
      // result to silently merge with a person's edits.
      setAnchors([...EMPTY_ANCHORS]);
      setAnchorSources([...EMPTY_ANCHOR_SOURCES]);
      setActiveAnchorIndex(0);
      setActiveDartId(null);
      setDarts([]);
      setAnnotationReviewed(false);
      setAnnotationError(null);
      setLearnedSuggestionProvenance(null);
      setSuggestionState({ kind: 'analysing' });

      const continueManually = (message: string) => {
        if (!isCurrentRequest()) return;
        setSuggestionState({ kind: 'manual-required', message });
      };

      const support = getDevelopmentBrowserVisionSupport();
      if (!support.supported) {
        continueManually(
          `This browser cannot run the local learned suggestion pass. ${support.reasons.join(' ')}`,
        );
        return;
      }

      const loaded = await loadDevelopmentModelManifest();
      if (!isCurrentRequest()) return;
      if (loaded.manifest === null) {
        continueManually(
          loaded.message ??
            'No verified local development model is installed on this deployment yet. Add the labels manually for this bootstrap record.',
        );
        return;
      }

      const client = new DevelopmentWebInferenceClient();
      suggestionClientRef.current = client;
      try {
        const backend = await client.initialize(loaded.manifest);
        if (!isCurrentRequest()) return;
        const bitmap = await createImageBitmap(still.imageBlob);
        if (!isCurrentRequest()) {
          bitmap.close();
          return;
        }
        const inference = await client.infer(bitmap, still.width, still.height, performance.now());
        if (!isCurrentRequest()) return;

        const suggestions = buildDataLabLearnedSuggestions(inference, loaded.manifest);
        const suggestedAnchors = suggestions.anchors.map(
          (suggestion) => suggestion?.imagePoint ?? null,
        );
        const suggestedAnchorSources = suggestions.anchors.map((suggestion) =>
          suggestion === null ? null : 'learned-suggestion',
        );
        // A blank-board record must stay a blank-board record even if the detector has a false dart
        // positive. Dart candidates are never converted into labels for that capture intent.
        const suggestedDarts =
          still.manifest.captureIntent === 'empty-board' ? [] : suggestions.darts;
        const omittedDartDetectionCount =
          suggestions.omittedDartDetectionCount +
          (still.manifest.captureIntent === 'empty-board' ? suggestions.darts.length : 0);

        const firstMissingAnchor = suggestedAnchors.findIndex((point) => point === null);
        setAnchors(suggestedAnchors);
        setAnchorSources(suggestedAnchorSources);
        setActiveAnchorIndex(firstMissingAnchor === -1 ? null : firstMissingAnchor);
        setActiveDartId(null);
        setDarts(
          suggestedDarts.map((dart) => ({
            id: `dart_${newOpaqueHex()}`,
            imagePoint: dart.imagePoint,
            boardPoint: dart.boardPoint,
            zone: dart.zone,
            wireMarginMm: dart.wireMarginMm,
            source: 'learned-suggestion',
            modelConfidence: dart.confidence,
          })),
        );
        setLearnedSuggestionProvenance({
          modelId: loaded.manifest.modelId,
          modelVersion: loaded.manifest.modelVersion,
          modelSha256: loaded.manifest.sha256,
          trainingDataId: loaded.manifest.provenance.trainingDataId,
          trainingDataKind: loaded.manifest.provenance.trainingDataKind,
          backend,
        });
        setSuggestionState({
          kind: 'ready',
          anchorCount: suggestedAnchors.filter((point) => point !== null).length,
          dartCount: suggestedDarts.length,
          hasCompletePose: suggestions.pose !== null,
          omittedDartDetectionCount,
          modelVersion: loaded.manifest.modelVersion,
          trainingDataKind: loaded.manifest.provenance.trainingDataKind,
          backend,
        });
      } catch (error) {
        if (isCurrentRequest()) {
          setSuggestionState({ kind: 'failed', message: messageForLearnedSuggestionError(error) });
        }
      } finally {
        if (suggestionClientRef.current === client) suggestionClientRef.current = null;
        await client.dispose();
      }
    },
    [cancelLearnedSuggestion, captured],
  );

  const continueToLabels = () => {
    if (captured === null || !privacyConfirmed || !rightsConfirmed) return;
    if (suggestionState.kind === 'idle') {
      void runLearnedSuggestions(captured);
      return;
    }
    if (suggestionState.kind === 'analysing') return;
    setStep('label');
  };

  const retakeStill = () => {
    automaticSaveStartedRef.current = false;
    automaticUploadAttemptedRecordRef.current = null;
    setCaptured(null);
    setPrivacyConfirmed(false);
    setRightsConfirmed(false);
    setStorageRecordId(null);
    setAssetStates({ ...INITIAL_ASSET_STATES });
    setUploadError(null);
    resetAnnotation();
  };

  const homography = useMemo<Homography | null>(() => {
    const imagePoints = anchors.filter((point): point is ImagePoint => point !== null);
    if (imagePoints.length !== DEVELOPMENT_FIVE_POINT_ANNOTATION_ANCHORS.length) return null;
    return solveImageToBoardHomography(
      imagePoints,
      DEVELOPMENT_FIVE_POINT_ANNOTATION_ANCHORS.map((anchor) => anchor.canonical),
    );
  }, [anchors]);

  const isBlankBoard = captured?.manifest.captureIntent === 'empty-board';
  const activeAnchor =
    activeAnchorIndex === null
      ? null
      : (DEVELOPMENT_FIVE_POINT_ANNOTATION_ANCHORS[activeAnchorIndex] ?? null);
  const canFinishLabels =
    captured !== null &&
    homography !== null &&
    annotationReviewed &&
    (isBlankBoard || darts.length > 0);

  const addImagePoint = (event: React.MouseEvent<HTMLButtonElement>) => {
    const element = imageRef.current;
    if (
      element === null ||
      captured === null ||
      element.clientWidth <= 0 ||
      element.clientHeight <= 0
    )
      return;
    const bounds = element.getBoundingClientRect();
    const point: ImagePoint = {
      x: (event.clientX - bounds.left) * (captured.width / bounds.width),
      y: (event.clientY - bounds.top) * (captured.height / bounds.height),
    };

    if (activeAnchorIndex !== null) {
      const selected = activeAnchorIndex;
      const nextAnchors = anchors.map((anchor, index) => (index === selected ? point : anchor));
      const nextAnchorSources = anchorSources.map((source, index) => {
        if (index !== selected) return source;
        return anchors[index] === null ? 'human-added' : 'human-adjusted';
      });
      const nextHomography = solveHomographyForAnchors(nextAnchors);
      const nextEmpty = nextAnchors.findIndex((anchor) => anchor === null);
      setAnchors(nextAnchors);
      setAnchorSources(nextAnchorSources);
      setActiveAnchorIndex(nextEmpty === -1 ? null : nextEmpty);
      setActiveDartId(null);
      // Existing tip pixels remain useful after an anchor correction. Recalculate their deterministic
      // board locations instead of asking the collector to recreate every label from scratch.
      setDarts((current) => remapDartsAfterAnchorChange(current, nextHomography));
      setAnnotationReviewed(false);
      setAnnotationError(
        nextHomography === null && darts.length > 0
          ? 'Those board points no longer form a safe map, so the dart labels were removed. Reposition the board points and add visible tips again.'
          : null,
      );
      return;
    }

    if (isBlankBoard) {
      setAnnotationError(
        'This is a blank-board example. Its four board points are the complete label.',
      );
      return;
    }
    if (homography === null) {
      setAnnotationError(
        'Those board points do not form a safe map. Reposition all four guide points.',
      );
      setActiveAnchorIndex(0);
      return;
    }
    const boardPoint = mapImagePointToBoard(point, homography);
    if (boardPoint === null) {
      setAnnotationError(
        'That tip could not be mapped safely. Recheck the four board guide points.',
      );
      return;
    }

    if (activeDartId !== null) {
      setDarts((current) =>
        current.map((dart) =>
          dart.id === activeDartId
            ? {
                ...dart,
                imagePoint: point,
                boardPoint,
                zone: decodeBoardPoint(boardPoint),
                wireMarginMm: nearestWireMarginMm(boardPoint),
                source: 'human-adjusted',
                modelConfidence: null,
              }
            : dart,
        ),
      );
      setActiveDartId(null);
      setAnnotationReviewed(false);
      setAnnotationError(null);
      return;
    }

    if (darts.length >= 3) {
      setAnnotationError(
        'Label at most three visible darts in one visit. Remove one or take another still.',
      );
      return;
    }
    const zone = decodeBoardPoint(boardPoint);
    setDarts((current) => [
      ...current,
      {
        id: `dart_${newOpaqueHex()}`,
        imagePoint: point,
        boardPoint,
        zone,
        wireMarginMm: nearestWireMarginMm(boardPoint),
        source: 'human-added',
        modelConfidence: null,
      },
    ]);
    setAnnotationReviewed(false);
    setAnnotationError(null);
  };

  const annotation = useMemo<AnnotationSidecar | null>(() => {
    if (captured === null || homography === null) return null;
    return createAnnotationSidecar(
      captured,
      anchors,
      anchorSources,
      homography,
      darts,
      learnedSuggestionProvenance,
    );
  }, [anchorSources, anchors, captured, darts, homography, learnedSuggestionProvenance]);

  const uploadPrivateRecord = useCallback(async () => {
    if (
      captured === null ||
      annotation === null ||
      storageRecordId === null ||
      vaultAvailability !== 'ready' ||
      uploadInFlightRef.current
    ) {
      return;
    }

    uploadInFlightRef.current = true;
    setUploadError(null);
    const assets: Array<{ kind: CaptureVaultAssetKind; body: Blob }> = [
      { kind: 'image', body: captured.imageBlob },
      {
        kind: 'manifest',
        body: new Blob([JSON.stringify(captured.manifest)], { type: 'application/json' }),
      },
      {
        kind: 'annotations',
        body: new Blob([JSON.stringify(annotation)], { type: 'application/json' }),
      },
    ];

    try {
      for (const asset of assets) {
        if (assetStates[asset.kind] === 'saved') continue;
        setAssetStates((current) => ({ ...current, [asset.kind]: 'saving' }));
        await uploadPrivateCaptureAsset({
          captureId: captured.manifest.captureId,
          recordId: storageRecordId,
          kind: asset.kind,
          body: asset.body,
        });
        setAssetStates((current) => ({ ...current, [asset.kind]: 'saved' }));
      }
    } catch (error) {
      setAssetStates((current) => {
        const saving = (
          Object.entries(current) as Array<[CaptureVaultAssetKind, AssetSaveState]>
        ).find(([, state]) => state === 'saving')?.[0];
        return saving === undefined ? current : { ...current, [saving]: 'failed' };
      });
      setUploadError(messageForUploadError(error));
    } finally {
      uploadInFlightRef.current = false;
    }
  }, [annotation, assetStates, captured, storageRecordId, vaultAvailability]);

  const enterSaveStep = () => {
    if (!canFinishLabels || annotation === null || automaticSaveStartedRef.current) return;
    automaticSaveStartedRef.current = true;
    automaticUploadAttemptedRecordRef.current = null;
    setStorageRecordId(newStorageRecordId());
    setAssetStates({ ...INITIAL_ASSET_STATES });
    setUploadError(null);
    setStep('save');
  };

  useEffect(() => {
    if (
      !automaticSaveStartedRef.current ||
      step !== 'save' ||
      captured === null ||
      annotation === null ||
      storageRecordId === null ||
      vaultAvailability !== 'ready' ||
      automaticUploadAttemptedRecordRef.current === storageRecordId
    ) {
      return;
    }

    // Effects can be replayed by React Strict Mode. Mark this record before starting the request so
    // one completed review creates at most one automatic upload attempt; retry remains user-driven.
    automaticUploadAttemptedRecordRef.current = storageRecordId;
    void uploadPrivateRecord();
  }, [annotation, captured, storageRecordId, step, uploadPrivateRecord, vaultAvailability]);

  const startAnotherSample = () => {
    const nextIntent =
      captured?.manifest.captureIntent === 'empty-board' ? 'static-dart' : metadata.captureIntent;
    automaticSaveStartedRef.current = false;
    automaticUploadAttemptedRecordRef.current = null;
    setMetadata((current) => ({ ...current, captureIntent: nextIntent }));
    setCaptured(null);
    setPrivacyConfirmed(false);
    setRightsConfirmed(false);
    setStorageRecordId(null);
    setAssetStates({ ...INITIAL_ASSET_STATES });
    setUploadError(null);
    resetAnnotation();
    setStep('capture');
  };

  const allAssetsSaved = Object.values(assetStates).every((state) => state === 'saved');
  const anyAssetSaving = Object.values(assetStates).some((state) => state === 'saving');

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

  return (
    <section className="data-lab shell">
      <header className="data-lab-intro">
        <div>
          <p className="eyebrow">DARTS 180 · DATA LAB</p>
          <h1>
            Teach the camera.
            <br />
            <em>One honest photo at a time.</em>
          </h1>
          <p className="lede">
            Live Scoring is for playing. This consented development Lab is the separate, simple
            place to collect a blank board or a real dart-test picture for the first camera model.
          </p>
        </div>
        <aside className="data-lab-privacy-card">
          <span>PRIVATE DEVELOPMENT COLLECTION</span>
          <strong>No audio. Automatic save only after review.</strong>
          <p>
            Keep people and personal room details out of frame. A photo stays in this tab until you
            complete label review; then its matched record saves automatically to private storage
            and remains pending manual data review.
          </p>
        </aside>
      </header>

      <ol className="data-lab-steps" aria-label="Data Lab steps">
        <li className={step === 'capture' ? 'active' : 'done'}>
          <span>1</span>
          <div>
            <b>TAKE A PHOTO</b>
            <small>Blank board or dart test</small>
          </div>
        </li>
        <li className={step === 'label' ? 'active' : step === 'save' ? 'done' : ''}>
          <span>2</span>
          <div>
            <b>REVIEW POINTS</b>
            <small>Camera suggestions or manual points</small>
          </div>
        </li>
        <li className={step === 'save' ? 'active' : ''}>
          <span>3</span>
          <div>
            <b>COMPLETE REVIEW</b>
            <small>Automatic private save</small>
          </div>
        </li>
      </ol>

      {step === 'capture' && (
        <CaptureStep
          cameraActive={cameraActive}
          cameraError={cameraError}
          vaultAvailability={vaultAvailability}
          captured={captured}
          metadata={metadata}
          privacyConfirmed={privacyConfirmed}
          rightsConfirmed={rightsConfirmed}
          suggestionState={suggestionState}
          videoRef={videoRef}
          onStartCamera={() => void startCamera()}
          onStopCamera={releaseCamera}
          onTakeStill={() => void captureStill()}
          onUpdateMetadata={(key, value) =>
            setMetadata((current) => ({ ...current, [key]: value }))
          }
          onNewSession={() => setMetadata((current) => ({ ...current, sessionId: newSessionId() }))}
          onPrivacyConfirmed={setPrivacyConfirmed}
          onRightsConfirmed={setRightsConfirmed}
          onContinue={continueToLabels}
          onRetake={retakeStill}
          onRefreshVault={() => void refreshVaultStatus()}
        />
      )}

      {step === 'label' && captured !== null && (
        <LabelStep
          captured={captured}
          imageRef={imageRef}
          anchors={anchors}
          anchorSources={anchorSources}
          activeAnchorIndex={activeAnchorIndex}
          activeAnchorInstruction={activeAnchor?.instruction ?? null}
          activeDartId={activeDartId}
          darts={darts}
          homography={homography}
          suggestionState={suggestionState}
          annotationReviewed={annotationReviewed}
          annotationError={annotationError}
          onAddImagePoint={addImagePoint}
          onSelectAnchor={(index) => {
            setActiveAnchorIndex(index);
            setActiveDartId(null);
            setAnnotationReviewed(false);
            setAnnotationError(null);
          }}
          onSelectDart={(id) => {
            setActiveAnchorIndex(null);
            setActiveDartId(id);
            setAnnotationReviewed(false);
            setAnnotationError(null);
          }}
          onClearAnchor={(index) => {
            const nextAnchors = anchors.map((anchor, anchorIndex) =>
              anchorIndex === index ? null : anchor,
            );
            setAnchors(nextAnchors);
            setAnchorSources((current) =>
              current.map((source, anchorIndex) => (anchorIndex === index ? null : source)),
            );
            setActiveAnchorIndex(index);
            setActiveDartId(null);
            setDarts([]);
            setAnnotationReviewed(false);
            setAnnotationError(
              darts.length > 0
                ? 'Removing a board point also removed mapped dart labels. Re-add visible tips after all four anchors are set.'
                : null,
            );
          }}
          onReset={resetAnnotation}
          onRemoveDart={(id) => {
            setDarts((current) => current.filter((dart) => dart.id !== id));
            setActiveDartId((current) => (current === id ? null : current));
            setAnnotationReviewed(false);
          }}
          onReviewed={setAnnotationReviewed}
          onRunLearnedSuggestions={() => void runLearnedSuggestions()}
          onBack={() => {
            // Preserve this still's completed suggestions and any edits if the collector only wants
            // to re-read the per-still checklist. A new capture, reset, or explicit failed-run retry
            // is the only path that replaces labels.
            setStep('capture');
          }}
          onContinue={enterSaveStep}
          canContinue={canFinishLabels}
        />
      )}

      {step === 'save' && captured !== null && annotation !== null && (
        <SaveStep
          capture={captured}
          annotation={annotation}
          vaultAvailability={vaultAvailability}
          assetStates={assetStates}
          storageRecordId={storageRecordId}
          uploadError={uploadError}
          anyAssetSaving={anyAssetSaving}
          allAssetsSaved={allAssetsSaved}
          onRefreshVault={() => void refreshVaultStatus()}
          onRetry={() => void uploadPrivateRecord()}
          onStartAnother={startAnotherSample}
        />
      )}
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
            place in Darts 180 where a completed board photo and its reviewed labels can be
            collected.
          </p>
        </header>

        <section className="data-lab-consent-notice" aria-labelledby="data-lab-consent-title">
          <div>
            <p className="eyebrow">DEVELOPMENT COLLECTION NOTICE</p>
            <h2 id="data-lab-consent-title">What happens if you continue</h2>
          </div>
          <div className="data-lab-consent-copy">
            <p>
              For every photo you choose to complete and review, Darts 180 automatically collects a
              board-focused JPEG, your reviewed board/tip labels (including any corrected
              local-model suggestions), and limited setup metadata such as a pseudonymous setup ID,
              board/camera notes, estimated angle/distance, and lighting.
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
              <li>Submit only a photo you own or have clear permission to use for this purpose.</li>
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
              I understand and agree that completed board-only Data Lab records and related labels/
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

function CaptureStep({
  cameraActive,
  cameraError,
  vaultAvailability,
  captured,
  metadata,
  privacyConfirmed,
  rightsConfirmed,
  suggestionState,
  videoRef,
  onStartCamera,
  onStopCamera,
  onTakeStill,
  onUpdateMetadata,
  onNewSession,
  onPrivacyConfirmed,
  onRightsConfirmed,
  onContinue,
  onRetake,
  onRefreshVault,
}: {
  cameraActive: boolean;
  cameraError: string | null;
  vaultAvailability: CaptureVaultAvailability;
  captured: CapturedStill | null;
  metadata: CaptureMetadata;
  privacyConfirmed: boolean;
  rightsConfirmed: boolean;
  suggestionState: DataLabSuggestionState;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onStartCamera: () => void;
  onStopCamera: () => void;
  onTakeStill: () => void;
  onUpdateMetadata: <Key extends keyof CaptureMetadata>(
    key: Key,
    value: CaptureMetadata[Key],
  ) => void;
  onNewSession: () => void;
  onPrivacyConfirmed: (checked: boolean) => void;
  onRightsConfirmed: (checked: boolean) => void;
  onContinue: () => void;
  onRetake: () => void;
  onRefreshVault: () => void;
}) {
  const intentIsBlank = metadata.captureIntent === 'empty-board';
  const collectionReady = vaultAvailability === 'ready';
  return (
    <div className="data-lab-grid">
      <section className="data-lab-camera-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">STEP 1 · BOARD PHOTO</p>
            <h2>
              {intentIsBlank ? 'Photograph the clear board.' : 'Photograph the settled dart(s).'}
            </h2>
          </div>
          <span className={`camera-state ${cameraActive ? 'on' : ''}`}>
            {cameraActive ? 'CAMERA ON' : 'CAMERA OFF'}
          </span>
        </div>
        <p className="data-lab-camera-help">
          Keep the whole number ring sharp and in frame. Use a safe mount outside the throw path;
          the Lab takes a still only, never audio or video.
        </p>
        {!collectionReady && (
          <section className="data-lab-collection-readiness" aria-live="polite">
            <div>
              <p className="eyebrow">PRIVATE COLLECTION STATUS</p>
              <strong>{privateStorageHeading(vaultAvailability, false)}</strong>
              <p>{privateStorageDescription(vaultAvailability)}</p>
            </div>
            <button
              className="text-button"
              disabled={vaultAvailability === 'checking'}
              onClick={onRefreshVault}
              type="button"
            >
              CHECK AGAIN
            </button>
          </section>
        )}
        <div className="camera-frame data-lab-camera-frame">
          <video ref={videoRef} autoPlay muted playsInline />
          {!cameraActive && (
            <div className="camera-empty">
              <span>◉</span>
              <p>Start the rear camera only when this is a board-only scene.</p>
            </div>
          )}
          <div className="camera-guide" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <b>FULL BOARD</b>
          </div>
        </div>
        {cameraError !== null && (
          <p className="camera-error" role="alert">
            {cameraError}
          </p>
        )}
        <div className="capture-actions">
          {!cameraActive ? (
            <button
              className="button primary"
              disabled={captured !== null || !collectionReady}
              onClick={onStartCamera}
              type="button"
            >
              START REAR CAMERA
            </button>
          ) : (
            <>
              <button
                className="button primary"
                disabled={!collectionReady}
                onClick={onTakeStill}
                type="button"
              >
                TAKE THIS PHOTO
              </button>
              <button className="button ghost compact" onClick={onStopCamera} type="button">
                STOP CAMERA
              </button>
            </>
          )}
        </div>

        {captured !== null && (
          <section className="data-lab-captured-card">
            <img alt="Board still awaiting Data Lab review" src={captured.imageUrl} />
            <div>
              <p className="eyebrow">PHOTO HELD ONLY IN THIS TAB</p>
              <h3>
                {captured.manifest.captureIntent === 'empty-board'
                  ? 'Blank board photo'
                  : 'Dart test photo'}{' '}
                ready
              </h3>
              <p>
                Check this exact still before it becomes a model-training example. It is not
                uploaded yet.
              </p>
              <label className="checkbox-label">
                <input
                  checked={privacyConfirmed}
                  disabled={suggestionState.kind === 'analysing'}
                  type="checkbox"
                  onChange={(event) => onPrivacyConfirmed(event.target.checked)}
                />
                <span>
                  I can see no person, face, audio, or sensitive room detail in this photo.
                </span>
              </label>
              <label className="checkbox-label">
                <input
                  checked={rightsConfirmed}
                  disabled={suggestionState.kind === 'analysing'}
                  type="checkbox"
                  onChange={(event) => onRightsConfirmed(event.target.checked)}
                />
                <span>
                  I own this board-focused photo, or have permission to use it for Darts 180
                  development.
                </span>
              </label>
              {suggestionState.kind === 'analysing' && (
                <p className="data-lab-suggestion-pending" role="status">
                  Checking this still with the verified local development model. The photo remains
                  in this tab; no record is saved until you review it.
                </p>
              )}
              {suggestionState.kind === 'ready' && (
                <p className="data-lab-suggestion-pending ready" role="status">
                  Local-model suggestions are ready to review. Nothing has been saved yet.
                </p>
              )}
              {(suggestionState.kind === 'manual-required' ||
                suggestionState.kind === 'failed') && (
                <p className="data-lab-suggestion-pending unavailable" role="status">
                  No learned suggestion was applied. {suggestionState.message}
                </p>
              )}
              <div className="data-lab-captured-actions">
                <button
                  className="button primary"
                  disabled={
                    !privacyConfirmed || !rightsConfirmed || suggestionState.kind === 'analysing'
                  }
                  onClick={onContinue}
                  type="button"
                >
                  {suggestionState.kind === 'analysing'
                    ? 'READING LOCAL MODEL…'
                    : 'NEXT · REVIEW CAMERA SUGGESTIONS'}
                </button>
                <button className="text-button" onClick={onRetake} type="button">
                  DISCARD AND RETAKE
                </button>
              </div>
            </div>
          </section>
        )}
      </section>

      <aside className="data-lab-setup-panel">
        <div>
          <p className="eyebrow">PHOTO PLAN</p>
          <h2>Choose one simple example.</h2>
        </div>
        <div
          className="data-lab-intent-buttons"
          role="group"
          aria-label="Choose a Data Lab photo type"
        >
          <button
            className={intentIsBlank ? 'active' : ''}
            disabled={captured !== null}
            onClick={() => onUpdateMetadata('captureIntent', 'empty-board')}
            type="button"
          >
            <b>1 · BLANK BOARD</b>
            <span>Four board points; no dart tap.</span>
          </button>
          <button
            className={!intentIsBlank ? 'active' : ''}
            disabled={captured !== null}
            onClick={() => onUpdateMetadata('captureIntent', 'static-dart')}
            type="button"
          >
            <b>2 · DART TEST</b>
            <span>Four board points and up to 3 visible tips.</span>
          </button>
        </div>
        <label className="data-lab-session-input">
          SETUP SESSION
          <input disabled={captured !== null} readOnly value={metadata.sessionId} />
          <small>
            Keep this generated ID while the phone, mount, board, and light stay the same. Start a
            new session after a meaningful change.
          </small>
        </label>
        <button
          className="text-button data-lab-new-session"
          disabled={captured !== null}
          onClick={onNewSession}
          type="button"
        >
          START A NEW SETUP SESSION
        </button>
        <label className="data-lab-lighting-input">
          LIGHTING NOW
          <select
            disabled={captured !== null}
            value={metadata.lightingBand}
            onChange={(event) =>
              onUpdateMetadata('lightingBand', event.target.value as LightingBand)
            }
          >
            <option value="normal">Normal / diffuse</option>
            <option value="low">Low light</option>
            <option value="bright">Bright</option>
            <option value="mixed">Mixed / side shadow</option>
            <option value="glare">Glare</option>
          </select>
        </label>
        <details className="data-lab-details">
          <summary>ADD CAMERA NOTES (OPTIONAL, HELPS LATER)</summary>
          <label>
            BOARD NOTE
            <input
              disabled={captured !== null}
              value={metadata.boardModel}
              onChange={(event) => onUpdateMetadata('boardModel', event.target.value)}
            />
          </label>
          <label>
            CAMERA NOTE
            <input
              disabled={captured !== null}
              value={metadata.deviceModel}
              onChange={(event) => onUpdateMetadata('deviceModel', event.target.value)}
            />
          </label>
          <div>
            <label>
              OFF-AXIS °
              <input
                disabled={captured !== null}
                inputMode="decimal"
                value={metadata.offAxisDegrees}
                onChange={(event) => onUpdateMetadata('offAxisDegrees', event.target.value)}
              />
            </label>
            <label>
              DISTANCE MM
              <input
                disabled={captured !== null}
                inputMode="numeric"
                value={metadata.distanceMm}
                onChange={(event) => onUpdateMetadata('distanceMm', event.target.value)}
              />
            </label>
          </div>
        </details>
        <p className="data-lab-setup-note">
          The photo plan is frozen when you take a still. This Lab is the only place with manual
          point taps; Live Scoring never asks players to do this.
        </p>
      </aside>
    </div>
  );
}

function LabelStep({
  captured,
  imageRef,
  anchors,
  anchorSources,
  activeAnchorIndex,
  activeAnchorInstruction,
  activeDartId,
  darts,
  homography,
  suggestionState,
  annotationReviewed,
  annotationError,
  onAddImagePoint,
  onSelectAnchor,
  onSelectDart,
  onClearAnchor,
  onReset,
  onRemoveDart,
  onReviewed,
  onRunLearnedSuggestions,
  onBack,
  onContinue,
  canContinue,
}: {
  captured: CapturedStill;
  imageRef: React.RefObject<HTMLImageElement | null>;
  anchors: Array<ImagePoint | null>;
  anchorSources: Array<DataLabPointSource | null>;
  activeAnchorIndex: number | null;
  activeAnchorInstruction: string | null;
  activeDartId: string | null;
  darts: readonly AnnotatedDart[];
  homography: Homography | null;
  suggestionState: DataLabSuggestionState;
  annotationReviewed: boolean;
  annotationError: string | null;
  onAddImagePoint: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onSelectAnchor: (index: number) => void;
  onSelectDart: (id: string) => void;
  onClearAnchor: (index: number) => void;
  onReset: () => void;
  onRemoveDart: (id: string) => void;
  onReviewed: (checked: boolean) => void;
  onRunLearnedSuggestions: () => void;
  onBack: () => void;
  onContinue: () => void;
  canContinue: boolean;
}) {
  const isBlankBoard = captured.manifest.captureIntent === 'empty-board';
  const isAnalysing = suggestionState.kind === 'analysing';
  const activeDartIndex = darts.findIndex((dart) => dart.id === activeDartId);
  const nextInstruction =
    activeAnchorInstruction ??
    (activeDartIndex >= 0
      ? `Tap the exact physical tip for dart ${activeDartIndex + 1}.`
      : isBlankBoard
        ? 'Review the four board points. This blank-board example needs no dart tip.'
        : 'Review every visible dart tip, then add any the camera missed.');
  return (
    <div className="data-lab-label-layout">
      <section className="data-lab-label-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">STEP 2 · REVIEW THE POINTS</p>
            <h2>{isAnalysing ? 'Reading the still with the local model…' : nextInstruction}</h2>
          </div>
          <span className={`camera-state ${homography !== null ? 'on' : ''}`}>
            {homography !== null ? 'BOARD SET' : `${anchors.filter(Boolean).length}/4 SET`}
          </span>
        </div>
        <SuggestionNotice state={suggestionState} isBlankBoard={isBlankBoard} />
        <p className="data-lab-label-intro">
          Keep correct camera suggestions or select a point row and tap the image to move it. Add
          missed tips, remove false tips, and only confirm points you can see clearly. The model is
          never treated as a final label on its own.
        </p>
        {annotationError !== null && (
          <p className="annotation-error" role="alert">
            {annotationError}
          </p>
        )}
        <button
          className="annotation-image-surface data-lab-image-surface"
          disabled={isAnalysing}
          type="button"
          onClick={onAddImagePoint}
          aria-label={nextInstruction}
        >
          <img
            ref={imageRef}
            alt="Board still being reviewed for the Darts 180 Data Lab"
            src={captured.imageUrl}
          />
          {anchors.map((point, index) =>
            point === null ? null : (
              <span
                className={`annotation-marker anchor-marker anchor-${index} ${
                  anchorSources[index] === 'learned-suggestion' ? 'learned-suggestion' : ''
                } ${activeAnchorIndex === index ? 'active' : ''}`}
                key={DEVELOPMENT_FIVE_POINT_ANNOTATION_ANCHORS[index]?.id ?? index}
                style={{
                  left: `${(point.x / captured.width) * 100}%`,
                  top: `${(point.y / captured.height) * 100}%`,
                }}
              >
                {index + 1}
              </span>
            ),
          )}
          {darts.map((dart, index) => (
            <span
              className={`annotation-marker dart-marker ${
                dart.source === 'learned-suggestion' ? 'learned-suggestion' : ''
              } ${activeDartId === dart.id ? 'active' : ''}`}
              key={dart.id}
              style={{
                left: `${(dart.imagePoint.x / captured.width) * 100}%`,
                top: `${(dart.imagePoint.y / captured.height) * 100}%`,
              }}
            >
              {index + 1}
            </span>
          ))}
        </button>
        <p className="annotation-canvas-hint">
          Point order: CAL 1 D5/D20 rim junction, CAL 2 D17/D3, CAL 3 D8/D11, CAL 4 D13/D6. These
          are outer-double rim junctions, not double-bed centres.
        </p>
        <div className="data-lab-label-bottom-actions">
          <button className="text-button" disabled={isAnalysing} onClick={onBack} type="button">
            ← BACK TO PHOTO
          </button>
          <button
            className="button ghost compact"
            disabled={isAnalysing}
            onClick={onReset}
            type="button"
          >
            RESET POINTS
          </button>
        </div>
      </section>

      <aside className="data-lab-label-controls">
        <div>
          <p className="eyebrow">FOUR BOARD POINTS</p>
          <h2>
            {suggestionState.kind === 'ready'
              ? 'Review the suggested junctions.'
              : 'Tap each named junction.'}
          </h2>
        </div>
        <div className="anchor-list">
          {DEVELOPMENT_FIVE_POINT_ANNOTATION_ANCHORS.map((anchor, index) => {
            const set = anchors[index] !== null;
            return (
              <button
                className={`anchor-row ${activeAnchorIndex === index ? 'active' : ''} ${set ? 'set' : ''}`}
                disabled={isAnalysing}
                key={anchor.id}
                type="button"
                onClick={() => onSelectAnchor(index)}
              >
                <span>{index + 1}</span>
                <strong>{anchor.title}</strong>
                <small>
                  {anchorSourceDescription(anchorSources[index] ?? null, anchor.instruction)}
                </small>
              </button>
            );
          })}
        </div>
        {activeAnchorIndex !== null && anchors[activeAnchorIndex] !== null && (
          <button
            className="text-button data-lab-clear-anchor"
            disabled={isAnalysing}
            onClick={() => onClearAnchor(activeAnchorIndex)}
            type="button"
          >
            CLEAR SELECTED BOARD POINT
          </button>
        )}
        {suggestionState.kind === 'failed' && (
          <section className="data-lab-suggestion-retry">
            <p>
              Retry only after a local model/device problem is corrected. A retry replaces the
              current point set with a fresh learned result.
            </p>
            <button className="text-button" onClick={onRunLearnedSuggestions} type="button">
              RETRY LOCAL MODEL · REPLACE POINTS
            </button>
          </section>
        )}
        <section className="data-lab-label-result">
          <p className="eyebrow">{isBlankBoard ? 'BLANK BOARD LABEL' : 'DART TEST LABELS'}</p>
          {isBlankBoard ? (
            <p>
              {homography === null
                ? 'Set or correct all four board points to finish this blank-board example.'
                : 'Four board points are ready. Do not add a made-up dart tip.'}
            </p>
          ) : darts.length === 0 ? (
            <p>
              {homography === null
                ? 'Set the four board points before adding a visible tip.'
                : 'Review the image, then tap every clearly visible physical dart tip the camera missed.'}
            </p>
          ) : (
            <div className="data-lab-dart-list">
              {darts.map((dart, index) => (
                <article className={activeDartId === dart.id ? 'active' : ''} key={dart.id}>
                  <span>DART {index + 1}</span>
                  <strong>{formatZone(dart.zone)}</strong>
                  <small>
                    {dartSourceDescription(dart)} · {dart.wireMarginMm.toFixed(2)} mm from nearest
                    wire
                  </small>
                  <div className="data-lab-dart-actions">
                    <button
                      className="text-button"
                      disabled={isAnalysing}
                      onClick={() => onSelectDart(dart.id)}
                      type="button"
                    >
                      {activeDartId === dart.id ? 'TAP PHOTO TO MOVE' : 'MOVE'}
                    </button>
                    <button
                      className="text-button danger-text"
                      disabled={isAnalysing}
                      onClick={() => onRemoveDart(dart.id)}
                      type="button"
                    >
                      REMOVE
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
        <label className="checkbox-label data-lab-label-check">
          <input
            checked={annotationReviewed}
            disabled={isAnalysing || homography === null || (!isBlankBoard && darts.length === 0)}
            type="checkbox"
            onChange={(event) => onReviewed(event.target.checked)}
          />
          <span>
            I reviewed this exact photo and its proposed points. Every selected point is visible and
            deliberate; uncertain tips are excluded.
          </span>
        </label>
        <button
          className="button primary"
          disabled={isAnalysing || !canContinue}
          onClick={onContinue}
          type="button"
        >
          CONFIRM REVIEW · AUTO-SAVE
        </button>
      </aside>
    </div>
  );
}

function SuggestionNotice({
  state,
  isBlankBoard,
}: {
  state: DataLabSuggestionState;
  isBlankBoard: boolean;
}) {
  if (state.kind === 'analysing') {
    return (
      <section className="data-lab-suggestion-notice pending" aria-live="polite">
        <p className="eyebrow">LOCAL MODEL CHECK</p>
        <strong>Reading this captured still…</strong>
        <p>
          The JPEG stays on this device while the verified local development model prepares editable
          suggestions.
        </p>
      </section>
    );
  }
  if (state.kind === 'ready') {
    const dartDescription = isBlankBoard
      ? 'Dart candidates were intentionally withheld for this blank-board record.'
      : !state.hasCompletePose
        ? 'Dart-tip suggestions were withheld because the learned anchors did not form a safe complete board pose.'
        : `${state.dartCount} visible dart tip${state.dartCount === 1 ? '' : 's'} suggested.`;
    return (
      <section className="data-lab-suggestion-notice ready" aria-live="polite">
        <p className="eyebrow">EDITABLE LOCAL-MODEL SUGGESTIONS</p>
        <strong>
          {state.anchorCount}/4 board points and {dartDescription}
        </strong>
        <p>
          {state.modelVersion} ran locally with {state.backend.toUpperCase()}.{' '}
          {dataLabTrainingProvenanceNotice(state.trainingDataKind)}{' '}
          {state.hasCompletePose
            ? 'Keep correct markers, move or remove wrong ones, and add anything it missed before confirming.'
            : 'Set or correct the remaining board points manually before adding any visible tips.'}
          {state.omittedDartDetectionCount > 0
            ? ` ${state.omittedDartDetectionCount} model dart candidate${
                state.omittedDartDetectionCount === 1 ? ' was' : 's were'
              } not turned into a label because the pose or record type was not safe.`
            : ''}
        </p>
      </section>
    );
  }
  if (state.kind === 'manual-required' || state.kind === 'failed') {
    return (
      <section className="data-lab-suggestion-notice unavailable" aria-live="polite">
        <p className="eyebrow">MANUAL LABELING READY</p>
        <strong>No learned suggestion was applied.</strong>
        <p>{state.message}</p>
      </section>
    );
  }
  return null;
}

function dataLabTrainingProvenanceNotice(
  trainingDataKind: DeepDartsDevelopmentModelManifest['provenance']['trainingDataKind'],
): string {
  if (trainingDataKind === 'synthetic-only') {
    return 'It is a synthetic bootstrap model, not a real-world accuracy claim.';
  }
  if (trainingDataKind === 'mixed-synthetic-and-real') {
    return 'It was trained with reviewed real and synthetic scenes, so every point still needs your review.';
  }
  return 'It was trained on reviewed development data, not released scoring evidence.';
}

function anchorSourceDescription(source: DataLabPointSource | null, fallback: string): string {
  if (source === 'learned-suggestion') return 'Suggested locally · tap row, then image, to move';
  if (source === 'human-adjusted') return 'Adjusted by you · tap to move again';
  if (source === 'human-added') return 'Placed by you · tap to move';
  return fallback;
}

function dartSourceDescription(dart: AnnotatedDart): string {
  if (dart.source === 'learned-suggestion' && dart.modelConfidence !== null) {
    return `Local model suggestion ${Math.round(dart.modelConfidence * 100)}%`;
  }
  if (dart.source === 'human-adjusted') return 'Adjusted by you';
  return 'Added by you';
}

function SaveStep({
  capture,
  annotation,
  vaultAvailability,
  assetStates,
  storageRecordId,
  uploadError,
  anyAssetSaving,
  allAssetsSaved,
  onRefreshVault,
  onRetry,
  onStartAnother,
}: {
  capture: CapturedStill;
  annotation: AnnotationSidecar;
  vaultAvailability: CaptureVaultAvailability;
  assetStates: Record<CaptureVaultAssetKind, AssetSaveState>;
  storageRecordId: string | null;
  uploadError: string | null;
  anyAssetSaving: boolean;
  allAssetsSaved: boolean;
  onRefreshVault: () => void;
  onRetry: () => void;
  onStartAnother: () => void;
}) {
  const isBlankBoard = capture.manifest.captureIntent === 'empty-board';
  const isConfigured = vaultAvailability === 'ready';
  const hasFailedAsset = Object.values(assetStates).some((state) => state === 'failed');

  return (
    <div className="data-lab-save-layout">
      <section className="data-lab-save-summary">
        <p className="eyebrow">STEP 3 · REVIEWED RECORD</p>
        <h2>
          {isBlankBoard
            ? 'Blank board labels are reviewed.'
            : `${annotation.darts.length} dart test label${annotation.darts.length === 1 ? '' : 's'} reviewed.`}
        </h2>
        <div className="data-lab-save-summary-card">
          <img alt="Reviewed board still being saved privately" src={capture.imageUrl} />
          <div>
            <strong>{capture.manifest.imageFile}</strong>
            <span>Session: {capture.manifest.sessionId}</span>
            <span>
              {isBlankBoard
                ? '4 board points · 0 dart tips'
                : `4 board points · ${annotation.darts.length} dart tip${annotation.darts.length === 1 ? '' : 's'}`}
            </span>
            <span>Consent: development collection · review pending</span>
          </div>
        </div>
        <p className="data-lab-save-summary-note">
          Your completed review begins an automatic private save of the JPEG, consent-backed
          manifest, and annotation sidecar together. This record is not automatically used for
          training, does not activate a model, and does not claim camera accuracy.
        </p>
      </section>

      <section className="data-lab-save-options">
        <article className="data-lab-save-option private">
          <div className="data-lab-save-option-head">
            <div>
              <p className="eyebrow">PRIVATE DEVELOPMENT COLLECTION</p>
              <h2>{privateStorageHeading(vaultAvailability, allAssetsSaved)}</h2>
            </div>
            <span className={`data-lab-storage-state ${vaultAvailability}`}>
              {privateStorageLabel(vaultAvailability, allAssetsSaved)}
            </span>
          </div>

          {allAssetsSaved ? (
            <>
              <p>
                This reviewed record is confirmed in the private Blob store. No image URL is
                displayed or made public by this app.
              </p>
              <AssetStatusList states={assetStates} />
              <button className="button primary" onClick={onStartAnother} type="button">
                {isBlankBoard ? 'NEXT · ADD A DART TEST' : 'ADD ANOTHER PHOTO'}
              </button>
            </>
          ) : !isConfigured ? (
            <>
              <p>{privateStorageDescription(vaultAvailability)}</p>
              <p className="data-lab-save-summary-note">
                This reviewed record remains only in this browser while collection setup is
                unavailable. It has not been sent anywhere.
              </p>
              <button className="text-button" onClick={onRefreshVault} type="button">
                CHECK PRIVATE COLLECTION AGAIN
              </button>
            </>
          ) : (
            <>
              <p>
                {anyAssetSaving
                  ? 'Saving the matched private record now. Keep this tab open until each item is confirmed.'
                  : hasFailedAsset
                    ? 'A private save was not confirmed. Retry only the unsaved item; already confirmed items remain immutable.'
                    : 'Preparing the reviewed private record for automatic save.'}
              </p>
              <AssetStatusList states={assetStates} />
              {uploadError !== null && (
                <p className="annotation-error" role="alert">
                  {uploadError}
                </p>
              )}
              {hasFailedAsset && (
                <button
                  className="button primary"
                  disabled={anyAssetSaving || storageRecordId === null}
                  onClick={onRetry}
                  type="button"
                >
                  RETRY UNSAVED FILE
                </button>
              )}
            </>
          )}
        </article>
      </section>
    </div>
  );
}

function AssetStatusList({ states }: { states: Record<CaptureVaultAssetKind, AssetSaveState> }) {
  const labels: Record<CaptureVaultAssetKind, string> = {
    image: 'Board JPEG',
    manifest: 'Capture manifest',
    annotations: 'Annotation sidecar',
  };
  return (
    <ul className="data-lab-asset-status" aria-label="Private storage status">
      {(Object.keys(labels) as CaptureVaultAssetKind[]).map((kind) => (
        <li className={states[kind]} key={kind}>
          <span>{labels[kind]}</span>
          <b>{assetStateLabel(states[kind])}</b>
        </li>
      ))}
    </ul>
  );
}

function initialMetadata(): CaptureMetadata {
  return {
    sessionId: newSessionId(),
    boardModel: 'Standard dartboard',
    deviceModel: 'Browser rear camera',
    captureIntent: 'empty-board',
    offAxisDegrees: '20',
    distanceMm: '900',
    lightingBand: 'normal',
  };
}

function createAnnotationSidecar(
  captured: CapturedStill,
  anchors: readonly (ImagePoint | null)[],
  anchorSources: readonly (DataLabPointSource | null)[],
  homography: Homography,
  darts: readonly AnnotatedDart[],
  learnedSuggestion: LearnedSuggestionProvenance | null,
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
      dartTrackId: `reviewed-${captured.manifest.captureId}-dart-${index + 1}`,
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
      reviewMethod:
        learnedSuggestion === null ? 'manual-review-v1' : 'learned-suggestion-human-review-v1',
      learnedSuggestion,
    },
  };
}

function solveHomographyForAnchors(anchors: readonly (ImagePoint | null)[]): Homography | null {
  const imagePoints = anchors.filter((point): point is ImagePoint => point !== null);
  if (imagePoints.length !== DEVELOPMENT_FIVE_POINT_ANNOTATION_ANCHORS.length) return null;
  return solveImageToBoardHomography(
    imagePoints,
    DEVELOPMENT_FIVE_POINT_ANNOTATION_ANCHORS.map((anchor) => anchor.canonical),
  );
}

function remapDartsAfterAnchorChange(
  darts: readonly AnnotatedDart[],
  homography: Homography | null,
): AnnotatedDart[] {
  if (homography === null) return [];
  return darts.flatMap((dart) => {
    const boardPoint = mapImagePointToBoard(dart.imagePoint, homography);
    if (boardPoint === null) return [];
    return [
      {
        ...dart,
        boardPoint,
        zone: decodeBoardPoint(boardPoint),
        wireMarginMm: nearestWireMarginMm(boardPoint),
      },
    ];
  });
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

function hasPlausibleMetadata(metadata: CaptureMetadata): boolean {
  const offAxis = Number(metadata.offAxisDegrees);
  const distance = Number(metadata.distanceMm);
  return (
    Number.isFinite(offAxis) &&
    offAxis >= 0 &&
    offAxis <= 90 &&
    Number.isFinite(distance) &&
    distance >= 200 &&
    distance <= 5_000
  );
}

function isValidSessionId(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,128}$/.test(value.trim());
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

function numeric(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value: number, decimalPlaces: number): number {
  return Number(value.toFixed(decimalPlaces));
}

function messageForSnapshotError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'The board still could not be taken. No photo was stored.';
}

function messageForLearnedSuggestionError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return `The verified local model could not make suggestions: ${error.message} Add the labels manually for this photo.`;
  }
  return 'The verified local model could not make suggestions for this photo. Add the labels manually instead.';
}

function messageForUploadError(error: unknown): string {
  if (error instanceof Error && error.message) {
    if (error.message.includes('already exists')) {
      return `${error.message} Keep this tab open; do not send a different file under this record.`;
    }
    return error.message;
  }
  return 'Private storage did not confirm this file. Keep this tab open and retry only the unsaved file.';
}

function assetStateLabel(state: AssetSaveState): string {
  switch (state) {
    case 'idle':
      return 'WAITING';
    case 'saving':
      return 'SAVING';
    case 'saved':
      return 'SAVED';
    case 'failed':
      return 'RETRY NEEDED';
  }
}

function privateStorageHeading(
  availability: CaptureVaultAvailability,
  allAssetsSaved: boolean,
): string {
  if (allAssetsSaved) return 'Saved privately.';
  if (availability === 'ready') return 'Saving this reviewed record privately.';
  if (availability === 'checking') return 'Checking the private development collection…';
  if (availability === 'not-configured') return 'Private collection setup is incomplete.';
  return 'The private development collection is unavailable.';
}

function privateStorageLabel(
  availability: CaptureVaultAvailability,
  allAssetsSaved: boolean,
): string {
  if (allAssetsSaved) return 'PRIVATE SAVE COMPLETE';
  if (availability === 'ready') return 'READY';
  if (availability === 'checking') return 'CHECKING';
  if (availability === 'not-configured') return 'SETUP NEEDED';
  return 'UNAVAILABLE';
}

function privateStorageDescription(availability: CaptureVaultAvailability): string {
  if (availability === 'ready') {
    return 'The JPEG and both JSON records go through the same-origin guarded intake Function into a private Blob store. The app never exposes a Blob credential or public image link.';
  }
  if (availability === 'checking') {
    return 'Checking whether this deployment can reach its private collection. Camera capture stays disabled until that check succeeds.';
  }
  if (availability === 'not-configured') {
    return 'This deployment is fail-closed until its private Blob store and development-consent access mode are configured. Camera capture stays disabled; no record can be saved here.';
  }
  return 'This page cannot reach the private intake Function. Camera capture stays disabled until the deployment and its private collection are available.';
}

function messageForCollectionAvailability(availability: CaptureVaultAvailability): string {
  if (availability === 'checking') {
    return 'Checking the private development collection. Wait for it to be ready before using the camera.';
  }
  if (availability === 'not-configured') {
    return 'Private collection setup is incomplete on this deployment. Camera capture is disabled.';
  }
  return 'The private development collection is unavailable. Camera capture is disabled until it is reachable.';
}
