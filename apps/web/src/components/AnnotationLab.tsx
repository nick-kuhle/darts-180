import { useEffect, useMemo, useRef, useState } from 'react';
import type { DartZone } from '@darts-180/contracts';
import { decodeBoardPoint, formatZone, nearestWireMarginMm } from '@darts-180/rules';

import {
  ANNOTATION_ANCHORS,
  mapImagePointToBoard,
  solveImageToBoardHomography,
  type CanonicalPoint,
  type Homography,
  type ImagePoint,
} from '../lib/annotationGeometry';

interface LocalImage {
  fileName: string;
  width: number;
  height: number;
  url: string;
}

type CaptureManifest = Record<string, unknown> & {
  captureId: string;
  containsFaces: false;
  imageFile: string;
  imageMime?: 'image/jpeg';
};

interface AnnotatedDart {
  id: string;
  imagePoint: ImagePoint;
  boardPoint: CanonicalPoint;
  zone: DartZone;
  wireMarginMm: number;
}

const EMPTY_ANCHORS: Array<ImagePoint | null> = [null, null, null, null];

/**
 * Local-only, manual annotation helper for an image/manifest pair made in Capture Lab.
 * It deliberately does not transmit either raw media or labels.
 */
export function AnnotationLab() {
  const imageRef = useRef<HTMLImageElement>(null);
  const [image, setImage] = useState<LocalImage | null>(null);
  const [manifest, setManifest] = useState<CaptureManifest | null>(null);
  const [anchors, setAnchors] = useState<Array<ImagePoint | null>>(EMPTY_ANCHORS);
  const [activeAnchorIndex, setActiveAnchorIndex] = useState<number | null>(0);
  const [darts, setDarts] = useState<AnnotatedDart[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [privacyReviewed, setPrivacyReviewed] = useState(false);

  useEffect(() => {
    const url = image?.url;
    return () => {
      if (url !== undefined) URL.revokeObjectURL(url);
    };
  }, [image?.url]);

  const homography = useMemo<Homography | null>(() => {
    const imagePoints = anchors.filter((point): point is ImagePoint => point !== null);
    if (imagePoints.length !== ANNOTATION_ANCHORS.length) return null;
    return solveImageToBoardHomography(
      imagePoints,
      ANNOTATION_ANCHORS.map((anchor) => anchor.canonical),
    );
  }, [anchors]);

  const imageMatchesManifest =
    image !== null && manifest !== null && manifest.imageFile === image.fileName;
  const canExport =
    image !== null &&
    manifest !== null &&
    imageMatchesManifest &&
    homography !== null &&
    darts.length > 0 &&
    privacyReviewed;
  const activeAnchor =
    activeAnchorIndex === null ? null : (ANNOTATION_ANCHORS[activeAnchorIndex] ?? null);

  const resetAnnotation = () => {
    setAnchors([...EMPTY_ANCHORS]);
    setActiveAnchorIndex(0);
    setDarts([]);
    setError(null);
    setPrivacyReviewed(false);
  };

  const chooseImage = (file: File | undefined) => {
    if (file === undefined) return;
    if (!file.type.startsWith('image/') && !/\.jpe?g$/i.test(file.name)) {
      setError('Choose a local board JPEG, not another document type.');
      return;
    }
    setImage({ fileName: file.name, width: 0, height: 0, url: URL.createObjectURL(file) });
    setManifest(null);
    resetAnnotation();
  };

  const chooseManifest = async (file: File | undefined) => {
    if (file === undefined) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!isCaptureManifest(parsed)) {
        setManifest(null);
        resetAnnotation();
        setError(
          'This is not a recognizable local Capture Lab manifest. Import the matching manifest JSON, not a labeled sidecar.',
        );
        return;
      }
      setManifest(parsed);
      resetAnnotation();
    } catch {
      setManifest(null);
      resetAnnotation();
      setError('Could not read that manifest as JSON.');
    }
  };

  const markImageLoaded = () => {
    const element = imageRef.current;
    if (element === null) return;
    setImage((current) =>
      current === null
        ? null
        : { ...current, width: element.naturalWidth, height: element.naturalHeight },
    );
  };

  const addImagePoint = (event: React.MouseEvent<HTMLButtonElement>) => {
    const element = imageRef.current;
    if (element === null || image === null || image.width === 0 || image.height === 0) return;
    const bounds = element.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const point: ImagePoint = {
      x: (event.clientX - bounds.left) * (image.width / bounds.width),
      y: (event.clientY - bounds.top) * (image.height / bounds.height),
    };

    if (activeAnchorIndex !== null) {
      const selected = activeAnchorIndex;
      setAnchors((current) =>
        current.map((anchor, index) => (index === selected ? point : anchor)),
      );
      const nextEmpty = anchors.findIndex((anchor, index) => index !== selected && anchor === null);
      setActiveAnchorIndex(nextEmpty === -1 ? null : nextEmpty);
      setDarts([]);
      setPrivacyReviewed(false);
      setError(null);
      return;
    }

    if (homography === null) {
      setError(
        'Those anchor points are degenerate. Select an anchor below and place all four again.',
      );
      setActiveAnchorIndex(0);
      return;
    }
    if (darts.length >= 3) {
      setError(
        'This controlled v0 workflow labels at most three darts. Remove a label or start a new board state.',
      );
      return;
    }
    const boardPoint = mapImagePointToBoard(point, homography);
    if (boardPoint === null) {
      setError('That point could not be mapped safely. Recheck the four calibration anchors.');
      return;
    }
    const zone = decodeBoardPoint(boardPoint);
    setDarts((current) => [
      ...current,
      {
        id: `dart-${current.length + 1}`,
        imagePoint: point,
        boardPoint,
        zone,
        wireMarginMm: nearestWireMarginMm(boardPoint),
      },
    ]);
    setPrivacyReviewed(false);
    setError(null);
  };

  const exportSidecar = () => {
    if (!canExport || image === null || manifest === null || homography === null) return;
    const sidecar = {
      schemaVersion: 1,
      capture: manifest,
      image: { file: image.fileName, width: image.width, height: image.height },
      board: {
        annotationMethod: 'manual-four-double-bed-homography-v0',
        imageToBoardHomography: homography.map((value) => round(value, 10)),
        anchors: ANNOTATION_ANCHORS.map((anchor, index) => {
          const point = anchors[index] ?? null;
          return {
            id: anchor.id,
            canonicalPointMm: [anchor.canonical.xMm, anchor.canonical.yMm],
            imagePointPx: point === null ? null : [round(point.x, 2), round(point.y, 2)],
          };
        }),
      },
      darts: darts.map((dart, index) => ({
        dartTrackId: `manual-${manifest.captureId}-dart-${index + 1}`,
        tipPixel: [round(dart.imagePoint.x, 2), round(dart.imagePoint.y, 2)],
        entryPointBoardMm: [round(dart.boardPoint.xMm, 3), round(dart.boardPoint.yMm, 3)],
        zone: dart.zone,
        visibility: 'clear',
        wireMarginMm: round(dart.wireMarginMm, 3),
      })),
    };
    const blob = new Blob([JSON.stringify(sidecar, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `darts-180-${manifest.captureId}-annotations.json`);
  };

  return (
    <section className="annotation-lab shell">
      <div className="annotation-intro">
        <div>
          <p className="eyebrow">DARTS 180 LOCAL ANNOTATION LAB</p>
          <h1>
            Label evidence.
            <br />
            <em>Do not invent certainty.</em>
          </h1>
          <p className="lede">
            Pair one locally stored board JPEG with its matching Capture Lab manifest, calibrate
            four known double beds, then click visible dart entry points. Nothing is uploaded.
          </p>
        </div>
        <aside className="privacy-card annotation-privacy-card">
          <span>REVIEW BEFORE EXPORT</span>
          <strong>Local files stay local.</strong>
          <p>
            This is a human-labeling aid, not a truth machine. Skip hidden, stacked, bounced, or
            uncertain tips for adjudication.
          </p>
        </aside>
      </div>

      <div className="annotation-import-grid">
        <label className="file-drop">
          <span>1 · LOCAL BOARD JPEG</span>
          <strong>{image?.fileName ?? 'Choose the exact capture image'}</strong>
          <small>JPEG stays in this browser tab.</small>
          <input
            accept="image/jpeg,image/jpg"
            type="file"
            onChange={(event) => chooseImage(event.target.files?.[0])}
          />
        </label>
        <label className="file-drop">
          <span>2 · MATCHING MANIFEST</span>
          <strong>{manifest?.captureId ?? 'Choose its Capture Lab JSON'}</strong>
          <small>Must name the exact JPEG above.</small>
          <input
            accept="application/json,.json"
            type="file"
            onChange={(event) => void chooseManifest(event.target.files?.[0])}
          />
        </label>
      </div>

      {image !== null && manifest !== null && !imageMatchesManifest && (
        <p className="annotation-warning" role="alert">
          The manifest names <b>{manifest.imageFile}</b>, but this image is <b>{image.fileName}</b>.
          Do not annotate or export this mismatched pair.
        </p>
      )}
      {error !== null && (
        <p className="annotation-error" role="alert">
          {error}
        </p>
      )}

      <div className="annotation-workspace">
        <section className="annotation-canvas-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">3 · CALIBRATE, THEN LABEL</p>
              <h2>
                {activeAnchor?.instruction ??
                  'Calibration set — click each clearly visible dart tip.'}
              </h2>
            </div>
            <span className={`camera-state ${homography !== null ? 'on' : ''}`}>
              {homography !== null ? 'CALIBRATED' : `${anchors.filter(Boolean).length}/4 ANCHORS`}
            </span>
          </div>
          {image === null ? (
            <div className="annotation-empty-stage">
              <span>+</span>
              <p>Import a local JPEG to begin the calibration sequence.</p>
            </div>
          ) : (
            <button
              className="annotation-image-surface"
              type="button"
              onClick={addImagePoint}
              aria-label={
                activeAnchor === null
                  ? 'Click a visible dart entry point to add an annotation'
                  : activeAnchor.instruction
              }
            >
              <img
                ref={imageRef}
                alt="Local board image being annotated"
                src={image.url}
                onLoad={markImageLoaded}
              />
              {anchors.map((point, index) =>
                point === null || image.width === 0 || image.height === 0 ? null : (
                  <span
                    className={`annotation-marker anchor-marker anchor-${index}`}
                    key={ANNOTATION_ANCHORS[index]?.id ?? index}
                    style={{
                      left: `${(point.x / image.width) * 100}%`,
                      top: `${(point.y / image.height) * 100}%`,
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
                    left: `${(dart.imagePoint.x / image.width) * 100}%`,
                    top: `${(dart.imagePoint.y / image.height) * 100}%`,
                  }}
                >
                  {index + 1}
                </span>
              ))}
            </button>
          )}
          <p className="annotation-canvas-hint">
            Anchor sequence: D20 at 12 o’clock, D6 at 3, D3 at 6, D11 at 9. Click the center of the
            named double bed—not an arbitrary outside edge.
          </p>
        </section>

        <aside className="annotation-controls-panel">
          <div>
            <p className="eyebrow">ANCHOR CONTROL</p>
            <h2>Reposition rather than guess.</h2>
          </div>
          <div className="anchor-list">
            {ANNOTATION_ANCHORS.map((anchor, index) => {
              const set = anchors[index] !== null;
              return (
                <button
                  className={`anchor-row ${activeAnchorIndex === index ? 'active' : ''} ${set ? 'set' : ''}`}
                  disabled={image === null}
                  key={anchor.id}
                  type="button"
                  onClick={() => {
                    setActiveAnchorIndex(index);
                    setDarts([]);
                    setPrivacyReviewed(false);
                    setError(null);
                  }}
                >
                  <span>{index + 1}</span>
                  <strong>{anchor.title}</strong>
                  <small>{set ? 'Placed · click to reposition' : 'Awaiting click'}</small>
                </button>
              );
            })}
          </div>
          <button
            className="button ghost annotation-reset"
            disabled={image === null}
            onClick={resetAnnotation}
            type="button"
          >
            RESET CALIBRATION + DARTS
          </button>
          <p className="annotation-control-note">
            Four points establish a projective mapping, but human clicks near a wire can still be
            wrong. Recheck every borderline hit and preserve difficult examples for two-person
            review.
          </p>
        </aside>
      </div>

      <section className="annotation-results">
        <div className="annotation-results-head">
          <div>
            <p className="eyebrow">4 · REVIEW LOCAL LABELS</p>
            <h2>
              {darts.length === 0
                ? 'No dart labels yet'
                : `${darts.length} dart ${darts.length === 1 ? 'label' : 'labels'}`}
            </h2>
          </div>
          <span>CANONICAL MM + DETERMINISTIC ZONE</span>
        </div>
        {darts.length === 0 ? (
          <p className="annotation-none">
            Complete calibration, then click only a clearly visible entry point.
          </p>
        ) : (
          <div className="annotation-dart-list">
            {darts.map((dart, index) => (
              <article className="annotation-dart" key={dart.id}>
                <div className="annotation-dart-index">D{index + 1}</div>
                <div>
                  <strong>{formatZone(dart.zone)}</strong>
                  <span>{dart.zone.score} points</span>
                </div>
                <div>
                  <small>BOARD POINT</small>
                  <span>
                    {dart.boardPoint.xMm.toFixed(1)}, {dart.boardPoint.yMm.toFixed(1)} mm
                  </span>
                </div>
                <div>
                  <small>WIRE MARGIN</small>
                  <span>{dart.wireMarginMm.toFixed(2)} mm</span>
                </div>
                <button
                  className="text-button danger-text"
                  onClick={() => {
                    setDarts((current) => current.filter((candidate) => candidate.id !== dart.id));
                    setPrivacyReviewed(false);
                  }}
                  type="button"
                >
                  REMOVE
                </button>
              </article>
            ))}
          </div>
        )}
        <label className="checkbox-label annotation-checkbox">
          <input
            checked={privacyReviewed}
            disabled={!imageMatchesManifest || darts.length === 0}
            type="checkbox"
            onChange={(event) => setPrivacyReviewed(event.target.checked)}
          />
          <span>
            I rechecked this exact local image: no person/sensitive detail is visible, every
            exported tip is visibly resolvable, and uncertain cases are excluded for adjudication.
          </span>
        </label>
        <div className="annotation-export-row">
          <p>
            Export remains <b>local only</b>. Validate the JSON with
            <code> python -m darts180_vision.data_contract </code> before any approved handoff.
          </p>
          <button
            className="button primary"
            disabled={!canExport}
            onClick={exportSidecar}
            type="button"
          >
            EXPORT LOCAL LABEL SIDECAR
          </button>
        </div>
      </section>
    </section>
  );
}

function isCaptureManifest(value: unknown): value is CaptureManifest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const requiredStrings = [
    'captureId',
    'consentVersion',
    'boardModel',
    'deviceModel',
    'captureMode',
    'lightingBand',
    'createdAt',
    'imageFile',
  ];
  return (
    candidate.containsFaces === false &&
    candidate.imageMime === 'image/jpeg' &&
    requiredStrings.every(
      (field) => typeof candidate[field] === 'string' && candidate[field].trim() !== '',
    ) &&
    typeof candidate.offAxisDegrees === 'number' &&
    typeof candidate.distanceMm === 'number'
  );
}

function round(value: number, decimalPlaces: number): number {
  return Number(value.toFixed(decimalPlaces));
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
