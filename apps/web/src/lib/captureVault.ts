/**
 * Browser client for the optional, private Data Lab intake route.
 *
 * This module intentionally knows only the same-origin route and a collection key supplied by the
 * current operator. It never contains, reads, or derives a Vercel Blob credential. The key stays in
 * React memory in Data Lab and is not written to a URL, storage, download, or analytics event.
 */

export const CAPTURE_INGEST_PATH = '/api/capture-ingest';
export const MAX_CAPTURE_IMAGE_BYTES = 3_500_000;
export const MAX_CAPTURE_JSON_BYTES = 196_608;
export const MIN_COLLECTION_KEY_LENGTH = 32;

export type CaptureVaultAssetKind = 'image' | 'manifest' | 'annotations';
export type CaptureVaultAvailability = 'checking' | 'ready' | 'not-configured' | 'unavailable';

export interface CaptureVaultStatus {
  configured: boolean;
  maxImageBytes: number;
  maxJsonBytes: number;
}

export interface UploadPrivateCaptureAssetInput {
  collectionKey: string;
  captureId: string;
  recordId: string;
  kind: CaptureVaultAssetKind;
  body: Blob;
  fetchImplementation?: typeof fetch;
}

export interface UploadedPrivateCaptureAsset {
  captureId: string;
  recordId: string;
  kind: CaptureVaultAssetKind;
  bytes: number;
  sha256: string;
}

export class CaptureVaultError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'CaptureVaultError';
    this.status = status;
  }
}

export function hasUsableCollectionKey(value: string): boolean {
  return value.trim().length >= MIN_COLLECTION_KEY_LENGTH;
}

export async function getCaptureVaultStatus(
  fetchImplementation: typeof fetch = fetch,
): Promise<CaptureVaultStatus> {
  let response: Response;
  try {
    response = await fetchImplementation(CAPTURE_INGEST_PATH, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new CaptureVaultError('The private capture service could not be reached.', null);
  }

  const payload = await responseJson(response);
  // A deployed but intentionally unconfigured Function returns its bounded status as 503. Treat
  // that as an honest local-only state rather than pretending cloud storage is available.
  if (!isCaptureVaultStatus(payload) || (!response.ok && response.status !== 503)) {
    throw new CaptureVaultError(
      messageFromPayload(
        payload,
        'The private capture service is not available on this deployment.',
      ),
      response.status,
    );
  }
  return payload;
}

export async function uploadPrivateCaptureAsset({
  collectionKey,
  captureId,
  recordId,
  kind,
  body,
  fetchImplementation = fetch,
}: UploadPrivateCaptureAssetInput): Promise<UploadedPrivateCaptureAsset> {
  if (!hasUsableCollectionKey(collectionKey)) {
    throw new CaptureVaultError(
      `Enter the ${MIN_COLLECTION_KEY_LENGTH}-character private collection key before saving.`,
    );
  }
  if (body.size === 0) throw new CaptureVaultError('This capture file is empty and was not sent.');
  if (kind === 'image' && body.size > MAX_CAPTURE_IMAGE_BYTES) {
    throw new CaptureVaultError(
      'This JPEG is too large for the private capture route. Retake the still.',
    );
  }
  if (kind !== 'image' && body.size > MAX_CAPTURE_JSON_BYTES) {
    throw new CaptureVaultError('This label document is too large for the private capture route.');
  }

  let response: Response;
  try {
    response = await fetchImplementation(CAPTURE_INGEST_PATH, {
      method: 'PUT',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': kind === 'image' ? 'image/jpeg' : 'application/json',
        'X-Darts180-Collection-Key': collectionKey.trim(),
        'X-Darts180-Capture-Id': captureId,
        'X-Darts180-Record-Id': recordId,
        'X-Darts180-Asset-Kind': kind,
      },
      body,
    });
  } catch {
    throw new CaptureVaultError(
      'The private capture service could not be reached. Nothing was confirmed.',
    );
  }

  const payload = await responseJson(response);
  if (!response.ok || !isUploadedPrivateCaptureAsset(payload)) {
    throw new CaptureVaultError(
      messageFromPayload(payload, 'The private capture service did not confirm this file.'),
      response.status,
    );
  }
  return payload;
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function isCaptureVaultStatus(value: unknown): value is CaptureVaultStatus {
  if (!isRecord(value)) return false;
  return (
    typeof value.configured === 'boolean' &&
    typeof value.maxImageBytes === 'number' &&
    typeof value.maxJsonBytes === 'number'
  );
}

function isUploadedPrivateCaptureAsset(value: unknown): value is UploadedPrivateCaptureAsset {
  if (!isRecord(value)) return false;
  return (
    typeof value.captureId === 'string' &&
    typeof value.recordId === 'string' &&
    (value.kind === 'image' || value.kind === 'manifest' || value.kind === 'annotations') &&
    typeof value.bytes === 'number' &&
    typeof value.sha256 === 'string'
  );
}

function messageFromPayload(value: unknown, fallback: string): string {
  if (!isRecord(value) || typeof value.error !== 'string') return fallback;
  return value.error.slice(0, 280) || fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
