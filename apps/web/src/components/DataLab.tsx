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
    }>;
  };
  darts: Array<{
    dartTrackId: string;
    tipPixel: [number, number];
    entryPointBoardMm: [number, number];
    zone: DartZone;
    visibility: 'clear';
    wireMarginMm: number;
  }>;
}

const EMPTY_ANCHORS: Array<ImagePoint | null> = [null, null, null, null];
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
 * sequence: choose a kind, photograph it, tap its known points, then automatically save the reviewed
 * matched record to private development storage. A required entry agreement records consent provenance;
 * it is not authentication and every record still needs manual data-operations review before training.
 */
export function DataLab({ onExit }: { onExit: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const automaticSaveStartedRef = useRef(false);
  const automaticUploadAttemptedRecordRef = useRef<string | null>(null);
  const uploadInFlightRef = useRef(false);

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
  const [activeAnchorIndex, setActiveAnchorIndex] = useState<number | null>(0);
  const [darts, setDarts] = useState<AnnotatedDart[]>([]);
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
    setAnchors([...EMPTY_ANCHORS]);
    setActiveAnchorIndex(0);
    setDarts([]);
    setAnnotationReviewed(false);
    setAnnotationError(null);
  }, []);

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
      setCaptured({
        imageBlob: snapshot.blob,
        imageUrl: URL.createObjectURL(snapshot.blob),
        width: snapshot.width,
        height: snapshot.height,
        manifest,
      });
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
    } catch (error) {
      setCameraError(messageForSnapshotError(error));
    }
  };

  const continueToLabels = () => {
    if (captured === null || !privacyConfirmed || !rightsConfirmed) return;
    resetAnnotation();
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
      setAnchors((current) => {
        const next = current.map((anchor, index) => (index === selected ? point : anchor));
        const nextEmpty = next.findIndex((anchor) => anchor === null);
        setActiveAnchorIndex(nextEmpty === -1 ? null : nextEmpty);
        return next;
      });
      setDarts([]);
      setAnnotationReviewed(false);
      setAnnotationError(null);
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
    if (darts.length >= 3) {
      setAnnotationError(
        'Label at most three visible darts in one visit. Remove one or take another still.',
      );
      return;
    }
    const boardPoint = mapImagePointToBoard(point, homography);
    if (boardPoint === null) {
      setAnnotationError(
        'That tip could not be mapped safely. Recheck the four board guide points.',
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
      },
    ]);
    setAnnotationReviewed(false);
    setAnnotationError(null);
  };

  const annotation = useMemo<AnnotationSidecar | null>(() => {
    if (captured === null || homography === null) return null;
    return createAnnotationSidecar(captured, anchors, homography, darts);
  }, [anchors, captured, darts, homography]);

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
            <b>TAP KNOWN POINTS</b>
            <small>Four board points, then tips</small>
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
          activeAnchorIndex={activeAnchorIndex}
          activeAnchorInstruction={activeAnchor?.instruction ?? null}
          darts={darts}
          homography={homography}
          annotationReviewed={annotationReviewed}
          annotationError={annotationError}
          onAddImagePoint={addImagePoint}
          onSelectAnchor={(index) => {
            setActiveAnchorIndex(index);
            setDarts([]);
            setAnnotationReviewed(false);
            setAnnotationError(null);
          }}
          onReset={resetAnnotation}
          onRemoveDart={(id) => {
            setDarts((current) => current.filter((dart) => dart.id !== id));
            setAnnotationReviewed(false);
          }}
          onReviewed={setAnnotationReviewed}
          onBack={() => setStep('capture')}
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
            place in Darts 180 where a completed board photo and its manual labels can be collected.
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
              board-focused JPEG, your manual board/tip labels, and limited setup metadata such as a
              pseudonymous setup ID, board/camera notes, estimated angle/distance, and lighting.
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
                  type="checkbox"
                  onChange={(event) => onRightsConfirmed(event.target.checked)}
                />
                <span>
                  I own this board-focused photo, or have permission to use it for Darts 180
                  development.
                </span>
              </label>
              <div className="data-lab-captured-actions">
                <button
                  className="button primary"
                  disabled={!privacyConfirmed || !rightsConfirmed}
                  onClick={onContinue}
                  type="button"
                >
                  NEXT · TAP THE BOARD POINTS
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
  activeAnchorIndex,
  activeAnchorInstruction,
  darts,
  homography,
  annotationReviewed,
  annotationError,
  onAddImagePoint,
  onSelectAnchor,
  onReset,
  onRemoveDart,
  onReviewed,
  onBack,
  onContinue,
  canContinue,
}: {
  captured: CapturedStill;
  imageRef: React.RefObject<HTMLImageElement | null>;
  anchors: Array<ImagePoint | null>;
  activeAnchorIndex: number | null;
  activeAnchorInstruction: string | null;
  darts: readonly AnnotatedDart[];
  homography: Homography | null;
  annotationReviewed: boolean;
  annotationError: string | null;
  onAddImagePoint: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onSelectAnchor: (index: number) => void;
  onReset: () => void;
  onRemoveDart: (id: string) => void;
  onReviewed: (checked: boolean) => void;
  onBack: () => void;
  onContinue: () => void;
  canContinue: boolean;
}) {
  const isBlankBoard = captured.manifest.captureIntent === 'empty-board';
  const nextInstruction =
    activeAnchorInstruction ??
    (isBlankBoard
      ? 'All four board points are set. This blank-board example needs no dart tip.'
      : 'All four board points are set. Tap each clearly visible physical dart tip.');
  return (
    <div className="data-lab-label-layout">
      <section className="data-lab-label-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">STEP 2 · TAP THE KNOWN POINTS</p>
            <h2>{nextInstruction}</h2>
          </div>
          <span className={`camera-state ${homography !== null ? 'on' : ''}`}>
            {homography !== null ? 'BOARD SET' : `${anchors.filter(Boolean).length}/4 SET`}
          </span>
        </div>
        <p className="data-lab-label-intro">
          These are human labels for the first model—not camera guesses. Tap carefully; if you are
          unsure, discard this example instead of inventing a point.
        </p>
        {annotationError !== null && (
          <p className="annotation-error" role="alert">
            {annotationError}
          </p>
        )}
        <button
          className="annotation-image-surface data-lab-image-surface"
          type="button"
          onClick={onAddImagePoint}
          aria-label={nextInstruction}
        >
          <img
            ref={imageRef}
            alt="Board still being labeled for the Darts 180 Data Lab"
            src={captured.imageUrl}
          />
          {anchors.map((point, index) =>
            point === null ? null : (
              <span
                className={`annotation-marker anchor-marker anchor-${index}`}
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
              className="annotation-marker dart-marker"
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
          <button className="text-button" onClick={onBack} type="button">
            ← BACK TO PHOTO
          </button>
          <button className="button ghost compact" onClick={onReset} type="button">
            RESET POINTS
          </button>
        </div>
      </section>

      <aside className="data-lab-label-controls">
        <div>
          <p className="eyebrow">FOUR BOARD POINTS</p>
          <h2>Tap each named junction.</h2>
        </div>
        <div className="anchor-list">
          {DEVELOPMENT_FIVE_POINT_ANNOTATION_ANCHORS.map((anchor, index) => {
            const set = anchors[index] !== null;
            return (
              <button
                className={`anchor-row ${activeAnchorIndex === index ? 'active' : ''} ${set ? 'set' : ''}`}
                key={anchor.id}
                type="button"
                onClick={() => onSelectAnchor(index)}
              >
                <span>{index + 1}</span>
                <strong>{anchor.title}</strong>
                <small>{set ? 'Placed · tap to move' : anchor.instruction}</small>
              </button>
            );
          })}
        </div>
        <section className="data-lab-label-result">
          <p className="eyebrow">{isBlankBoard ? 'BLANK BOARD LABEL' : 'DART TEST LABELS'}</p>
          {isBlankBoard ? (
            <p>
              {homography === null
                ? 'Set all four board points to finish this blank-board example.'
                : 'Four board points are ready. Do not add a made-up dart tip.'}
            </p>
          ) : darts.length === 0 ? (
            <p>Set the four board points, then tap every clearly visible physical dart tip.</p>
          ) : (
            <div className="data-lab-dart-list">
              {darts.map((dart, index) => (
                <article key={dart.id}>
                  <span>DART {index + 1}</span>
                  <strong>{formatZone(dart.zone)}</strong>
                  <small>{dart.wireMarginMm.toFixed(2)} mm from nearest wire</small>
                  <button
                    className="text-button danger-text"
                    onClick={() => onRemoveDart(dart.id)}
                    type="button"
                  >
                    REMOVE
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
        <label className="checkbox-label data-lab-label-check">
          <input
            checked={annotationReviewed}
            disabled={homography === null || (!isBlankBoard && darts.length === 0)}
            type="checkbox"
            onChange={(event) => onReviewed(event.target.checked)}
          />
          <span>
            I rechecked this exact photo. Every selected point is visible and deliberate; uncertain
            tips are excluded.
          </span>
        </label>
        <button
          className="button primary"
          disabled={!canContinue}
          onClick={onContinue}
          type="button"
        >
          COMPLETE REVIEW · AUTO-SAVE
        </button>
      </aside>
    </div>
  );
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
  homography: Homography,
  darts: readonly AnnotatedDart[],
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
        };
      }),
    },
    darts: darts.map((dart, index) => ({
      dartTrackId: `manual-${captured.manifest.captureId}-dart-${index + 1}`,
      tipPixel: [round(dart.imagePoint.x, 2), round(dart.imagePoint.y, 2)],
      entryPointBoardMm: [round(dart.boardPoint.xMm, 3), round(dart.boardPoint.yMm, 3)],
      zone: dart.zone,
      visibility: 'clear',
      wireMarginMm: round(dart.wireMarginMm, 3),
    })),
  };
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
