import { useEffect, useRef, useState } from 'react';

import { describeCameraAccessError, getCameraAccessPreflightMessage } from '../lib/cameraAccess';

type CaptureMode = 'empty-board' | 'static-dart' | 'failure-case';
type LightingBand = 'low' | 'normal' | 'bright' | 'mixed' | 'glare';

interface CaptureMetadata {
  sessionId: string;
  boardModel: string;
  deviceModel: string;
  captureMode: CaptureMode;
  offAxisDegrees: string;
  distanceMm: string;
  lightingBand: LightingBand;
}

function initialCaptureMetadata(): CaptureMetadata {
  return {
    sessionId: newSessionId(),
    boardModel: 'Standard steel-tip board',
    deviceModel: 'Browser camera',
    captureMode: 'static-dart',
    offAxisDegrees: '20',
    distanceMm: '900',
    lightingBand: 'normal',
  };
}

/**
 * Local-only, browser-based controlled capture helper. It intentionally has no upload endpoint:
 * a contributor downloads the image + manifest and transfers it through the approved data process.
 */
export function CaptureLab() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [metadata, setMetadata] = useState<CaptureMetadata>(initialCaptureMetadata);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [captureRecordId, setCaptureRecordId] = useState<string | null>(null);
  const [capturedMetadata, setCapturedMetadata] = useState<CaptureMetadata | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [facesExcluded, setFacesExcluded] = useState(false);
  const [selfCaptureUseApproved, setSelfCaptureUseApproved] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (video !== null) video.srcObject = streamRef.current;
    return () => stopCamera();
  }, []);

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
      if (videoRef.current !== null) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraError(null);
      setCameraActive(true);
    } catch (error) {
      setCameraError(describeCameraAccessError(error));
      setCameraActive(false);
    }
  };

  const stopCamera = () => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    if (videoRef.current !== null) videoRef.current.srcObject = null;
    setCameraActive(false);
  };

  const captureStill = () => {
    if (!isValidSessionId(metadata.sessionId)) {
      setCameraError(
        'Use an 8–128 character setup session ID with letters, numbers, dashes, or underscores only.',
      );
      return;
    }
    const video = videoRef.current;
    if (video === null || video.videoWidth === 0 || video.videoHeight === 0) {
      setCameraError('Start the camera and wait for a visible board before taking a still.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (context === null) {
      setCameraError('This browser could not create an image canvas.');
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    setImageDataUrl(canvas.toDataURL('image/jpeg', 0.92));
    setCaptureRecordId(newCaptureId());
    setCapturedMetadata({ ...metadata });
    // Require explicit privacy and self-capture-use confirmations for every newly captured still.
    setFacesExcluded(false);
    setSelfCaptureUseApproved(false);
    setCameraError(null);
  };

  const downloadImage = () => {
    if (imageDataUrl === null || captureRecordId === null || capturedMetadata === null) return;
    downloadUrl(imageDataUrl, captureImageFileName(captureRecordId, capturedMetadata.captureMode));
  };

  const downloadManifest = () => {
    if (captureRecordId === null || capturedMetadata === null) return;
    const manifest = {
      captureId: captureRecordId,
      sessionId: capturedMetadata.sessionId.trim(),
      consentVersion: selfCaptureUseApproved
        ? 'SELF-CAPTURE-DEVELOPMENT-V1'
        : 'LOCAL-CAPTURE-NOT-YET-SHARED',
      boardModel: capturedMetadata.boardModel.trim() || 'Unknown standard steel-tip board',
      deviceModel: capturedMetadata.deviceModel.trim() || 'Browser camera',
      captureMode: 'still',
      captureIntent: capturedMetadata.captureMode,
      imageFile: captureImageFileName(captureRecordId, capturedMetadata.captureMode),
      imageMime: 'image/jpeg',
      offAxisDegrees: numeric(capturedMetadata.offAxisDegrees, 20),
      distanceMm: numeric(capturedMetadata.distanceMm, 900),
      lightingBand: capturedMetadata.lightingBand,
      containsFaces: false,
      createdAt: new Date().toISOString(),
      labelsVersion: 'unlabeled-v0',
      split: 'unassigned',
    };
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    downloadUrl(URL.createObjectURL(blob), `darts-180-${manifest.captureId}-manifest.json`, true);
  };

  const update = <Key extends keyof CaptureMetadata>(key: Key, value: CaptureMetadata[Key]) => {
    setMetadata((current) => ({ ...current, [key]: value }));
  };

  const startNewSession = () => {
    setMetadata((current) => ({ ...current, sessionId: newSessionId() }));
  };

  return (
    <section className="capture-lab shell">
      <div className="capture-intro">
        <div>
          <p className="eyebrow">DARTS 180 DATA CAPTURE LAB</p>
          <h1>
            Build the dataset.
            <br />
            <em>Keep it local first.</em>
          </h1>
          <p className="lede">
            This helper takes a board-focused still and a manifest on your device. It does not
            upload anything. Use it only after reading the field-capture protocol.
          </p>
        </div>
        <aside className="privacy-card">
          <span>LOCAL ONLY</span>
          <strong>No cloud upload. No audio.</strong>
          <p>
            Do not capture faces, people, or identifying room details. A good board crop is all we
            need.
          </p>
        </aside>
      </div>

      <div className="capture-grid">
        <section className="capture-camera-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">1 · FRAME THE BOARD</p>
              <h2>Use a stable mount if possible.</h2>
            </div>
            <span className={`camera-state ${cameraActive ? 'on' : ''}`}>
              {cameraActive ? 'CAMERA ON' : 'CAMERA OFF'}
            </span>
          </div>
          <div className="camera-frame">
            <video ref={videoRef} autoPlay muted playsInline />
            {!cameraActive && (
              <div className="camera-empty">
                <span>⌁</span>
                <p>Camera preview stays on your device.</p>
              </div>
            )}
            <div className="camera-guide">
              <i />
              <i />
              <i />
              <i />
              <b>FIT FULL BOARD</b>
            </div>
          </div>
          {cameraError !== null && (
            <p className="camera-error" role="alert">
              {cameraError}
            </p>
          )}
          <div className="capture-actions">
            {!cameraActive ? (
              <button className="button primary" onClick={startCamera}>
                START DEVICE CAMERA
              </button>
            ) : (
              <>
                <button className="button secondary" onClick={captureStill}>
                  TAKE BOARD STILL
                </button>
                <button className="button ghost compact" onClick={stopCamera}>
                  STOP CAMERA
                </button>
              </>
            )}
          </div>
          {imageDataUrl !== null && (
            <div className="still-preview">
              <img alt="Locally captured board still" src={imageDataUrl} />
              <div>
                <strong>Still captured locally</strong>
                <button className="text-button" onClick={downloadImage}>
                  DOWNLOAD JPEG
                </button>
              </div>
            </div>
          )}
        </section>

        <aside className="capture-metadata-panel">
          <div>
            <p className="eyebrow">2 · RECORD CONTEXT</p>
            <h2>Make the image useful later.</h2>
          </div>
          <label>
            SESSION / SETUP GROUP
            <input
              value={metadata.sessionId}
              onChange={(event) => update('sessionId', event.target.value)}
            />
            <small className="capture-input-note">
              Keep this ID for one continuous phone/mount/lighting setup. Start a new one after a
              meaningful setup change so training and testing can stay separate.
            </small>
          </label>
          <button
            className="text-button capture-new-session"
            onClick={startNewSession}
            type="button"
          >
            START A NEW SETUP SESSION
          </button>
          <label>
            CAPTURE TYPE
            <select
              value={metadata.captureMode}
              onChange={(event) => update('captureMode', event.target.value as CaptureMode)}
            >
              <option value="empty-board">Empty board / calibration</option>
              <option value="static-dart">Static dart(s) in board</option>
              <option value="failure-case">Difficult or failure case</option>
            </select>
          </label>
          <label>
            BOARD MODEL / NOTES
            <input
              value={metadata.boardModel}
              onChange={(event) => update('boardModel', event.target.value)}
            />
          </label>
          <label>
            DEVICE / CAMERA NOTES
            <input
              value={metadata.deviceModel}
              onChange={(event) => update('deviceModel', event.target.value)}
            />
          </label>
          <div className="metadata-two">
            <label>
              OFF-AXIS ANGLE (°)
              <input
                inputMode="decimal"
                value={metadata.offAxisDegrees}
                onChange={(event) => update('offAxisDegrees', event.target.value)}
              />
            </label>
            <label>
              DISTANCE (MM)
              <input
                inputMode="numeric"
                value={metadata.distanceMm}
                onChange={(event) => update('distanceMm', event.target.value)}
              />
            </label>
          </div>
          <label>
            LIGHTING
            <select
              value={metadata.lightingBand}
              onChange={(event) => update('lightingBand', event.target.value as LightingBand)}
            >
              <option value="normal">Normal / diffuse</option>
              <option value="low">Low light</option>
              <option value="bright">Bright</option>
              <option value="mixed">Mixed / side shadow</option>
              <option value="glare">Glare</option>
            </select>
          </label>
          <label className="checkbox-label">
            <input
              checked={facesExcluded}
              type="checkbox"
              onChange={(event) => setFacesExcluded(event.target.checked)}
            />
            <span>
              I confirm this capture contains no faces, people, audio, or sensitive room details.
            </span>
          </label>
          <label className="checkbox-label">
            <input
              checked={selfCaptureUseApproved}
              type="checkbox"
              onChange={(event) => setSelfCaptureUseApproved(event.target.checked)}
            />
            <span>
              I own this board-focused capture or have permission to use it for Darts 180
              development. I will not use this self-capture confirmation for someone else’s image.
            </span>
          </label>
          <button
            className="button primary"
            disabled={
              !facesExcluded ||
              !selfCaptureUseApproved ||
              imageDataUrl === null ||
              capturedMetadata === null ||
              !isValidSessionId(capturedMetadata.sessionId)
            }
            onClick={downloadManifest}
          >
            DOWNLOAD LOCAL MANIFEST
          </button>
          <p className="capture-footnote">
            Metadata is frozen when you take a still. Download the JPEG and JSON together; they are
            not a training upload, so use the approved secure handoff and labeling workflow later.
          </p>
        </aside>
      </div>

      <section className="capture-checklist">
        <div>
          <p className="eyebrow">FIELD CHECKLIST</p>
          <h2>What a useful first capture looks like</h2>
        </div>
        <ol>
          <li>
            <b>Safe</b>
            <span>Mounted outside the throw path, no one in the frame.</span>
          </li>
          <li>
            <b>Full board</b>
            <span>All double ring and numbers visible, board reasonably sharp.</span>
          </li>
          <li>
            <b>Diverse</b>
            <span>
              Record device, board, light, distance, and angle—not only ideal front views.
            </span>
          </li>
          <li>
            <b>Ground truth</b>
            <span>
              For dart-in captures, use the later annotation process; do not trust the prototype as
              truth.
            </span>
          </li>
        </ol>
      </section>
    </section>
  );
}

function newCaptureId(): string {
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `cap_${uuid.replaceAll('-', '').slice(0, 20)}`;
}

function newSessionId(): string {
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `session_${uuid.replaceAll('-', '').slice(0, 20)}`;
}

function isValidSessionId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{8,128}$/.test(value.trim());
}

function captureImageFileName(captureId: string, captureIntent: CaptureMode): string {
  return `darts-180-${captureId}-${captureIntent}.jpg`;
}

function numeric(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function downloadUrl(url: string, fileName: string, revoke = false) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  if (revoke) window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
