/**
 * Browser camera permissions behave differently in a sandboxed preview, an iframe, a WebView, and
 * a top-level HTTPS page. Keep this diagnostic separate from scoring so both Live Scoring and
 * Data Lab give an actionable explanation instead of a generic NotAllowedError.
 */
export interface CameraAccessEnvironment {
  isBrowser: boolean;
  isSecureContext: boolean;
  isEmbedded: boolean;
  hasGetUserMedia: boolean;
}

export function getCameraAccessPreflightMessage(): string | null {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return getCameraAccessPreflightMessageFor({
      isBrowser: false,
      isSecureContext: false,
      isEmbedded: false,
      hasGetUserMedia: false,
    });
  }
  return getCameraAccessPreflightMessageFor({
    isBrowser: true,
    isSecureContext: window.isSecureContext,
    isEmbedded: isEmbeddedFrame(),
    hasGetUserMedia: navigator.mediaDevices?.getUserMedia !== undefined,
  });
}

/** Pure version used by tests and by the browser adapter above. */
export function getCameraAccessPreflightMessageFor(
  environment: CameraAccessEnvironment,
): string | null {
  if (!environment.isBrowser) {
    return 'Camera access is available only in a browser on the device that is viewing Darts 180.';
  }
  if (!environment.isSecureContext) {
    return 'Camera permission requires a top-level HTTPS page. Open the Vercel HTTPS deployment, not an HTTP address.';
  }
  if (environment.isEmbedded) {
    return 'This embedded preview cannot request camera permission. Open the deployed Vercel HTTPS URL directly in Safari or Chrome on the mounted device.';
  }
  if (!environment.hasGetUserMedia) {
    return 'This browser does not expose a camera API. Use a current Safari, Chrome, or Edge browser on a device with a camera.';
  }
  return null;
}

export function describeCameraAccessError(error: unknown): string {
  const preflight = getCameraAccessPreflightMessage();
  if (preflight !== null) return preflight;

  const name = getErrorName(error);
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera permission was blocked. In this top-level HTTPS tab, use the browser lock/camera control to set Camera to Allow, then reload and try again.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No usable video camera was found. Check that this device has a camera and that another browser/app is not hiding it.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The camera is already in use or unavailable. Close other apps using it, then retry.';
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'This camera could not satisfy the requested preview size. Retry after closing other camera apps or use a different browser.';
    case 'AbortError':
      return 'The browser stopped the camera request before it completed. Retry from the mounted device’s direct HTTPS browser tab.';
    default:
      return `Could not start the camera${name === '' ? '' : ` (${name})`}. Open the direct Vercel HTTPS URL in Safari or Chrome, confirm Camera is allowed, and try again.`;
  }
}

function isEmbeddedFrame(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // Accessing a cross-origin parent can be restricted. Treat it as embedded rather than asking
    // for media in an unknown host frame.
    return true;
  }
}

function getErrorName(error: unknown): string {
  if (error instanceof Error) return error.name;
  if (typeof error !== 'object' || error === null || !('name' in error)) return '';
  const name = (error as { name?: unknown }).name;
  return typeof name === 'string' ? name : '';
}
