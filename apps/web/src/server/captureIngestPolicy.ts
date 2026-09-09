/**
 * Small, dependency-free policy layer for the private Data Lab intake Function.
 *
 * Keep this separate from the Vercel Blob call so the access-mode allow-list, size limits, IDs,
 * consent provenance, and document-pairing rules can be exercised without a storage credential or
 * a deployed Function.
 */

import {
  DEVELOPMENT_DATA_LAB_ADMISSION_STATUS,
  DEVELOPMENT_DATA_LAB_CONSENT_VERSION,
} from '../lib/captureConsent';
import {
  MAX_CAPTURE_IMAGE_BYTES,
  MAX_CAPTURE_JSON_BYTES,
  type CaptureVaultAssetKind,
} from '../lib/captureVault';

/** New records use a separate immutable prefix from the earlier owner-only collector. */
export const CAPTURE_BLOB_PREFIX = 'darts180/capture-lab/v2';

/**
 * Explicitly permits the consent-gated development Lab to receive same-origin browser submissions.
 * This is deliberately not authentication: it is suitable only for a small, manually screened
 * development corpus with private storage and no automatic training admission.
 */
export const DEVELOPMENT_CONSENT_ACCESS_MODE = 'development-consent-v1';

/**
 * Retained as a more restricted deployment option for an operator who later enables edge protection.
 * It has the same private-write contract, but is not the mode requested for current development.
 */
export const VERCEL_PROTECTED_OWNER_ACCESS_MODE = 'vercel-protected-owner-v1';

export type CaptureIngestAccessMode =
  typeof DEVELOPMENT_CONSENT_ACCESS_MODE | typeof VERCEL_PROTECTED_OWNER_ACCESS_MODE;

const CAPTURE_ID = /^cap_[A-Fa-f0-9]{32}$/;
const SESSION_ID = /^session_[A-Fa-f0-9]{32}$/;
const RECORD_ID = /^record_[A-Fa-f0-9]{32}$/;
const IMAGE_FILE = /^[A-Za-z0-9_.-]+\.jpe?g$/i;

export interface CaptureIngestEnvironment {
  accessMode: string | undefined;
  blobStoreId: string | undefined;
}

export interface CaptureIngestRequestMetadata {
  captureId: string;
  recordId: string;
  kind: CaptureVaultAssetKind;
  contentType: string | null;
}

export interface ValidatedCaptureIngestAsset {
  pathname: string;
  contentType: 'image/jpeg' | 'application/json';
  maxBytes: number;
}

export class CaptureIngestPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaptureIngestPolicyError';
  }
}

/** Return an exact, allow-listed deployment mode; whitespace and lookalikes fail closed. */
export function resolveCaptureIngestAccessMode(
  environment: CaptureIngestEnvironment,
): CaptureIngestAccessMode | null {
  switch (environment.accessMode) {
    case DEVELOPMENT_CONSENT_ACCESS_MODE:
    case VERCEL_PROTECTED_OWNER_ACCESS_MODE:
      return environment.accessMode;
    default:
      return null;
  }
}

export function isCaptureIngestConfigured(environment: CaptureIngestEnvironment): boolean {
  return (
    resolveCaptureIngestAccessMode(environment) !== null && Boolean(environment.blobStoreId?.trim())
  );
}

export function isCaptureVaultAssetKind(value: string | null): value is CaptureVaultAssetKind {
  return value === 'image' || value === 'manifest' || value === 'annotations';
}

export function validateCaptureIngestAsset(
  metadata: CaptureIngestRequestMetadata,
  bytes: Uint8Array,
): ValidatedCaptureIngestAsset {
  if (!CAPTURE_ID.test(metadata.captureId)) {
    throw new CaptureIngestPolicyError('Capture ID is invalid. Start a new Data Lab record.');
  }
  if (!RECORD_ID.test(metadata.recordId)) {
    throw new CaptureIngestPolicyError(
      'Storage record ID is invalid. Start this private save again.',
    );
  }
  if (!isCaptureVaultAssetKind(metadata.kind)) {
    throw new CaptureIngestPolicyError('That private capture asset type is not allowed.');
  }

  const expectedContentType = metadata.kind === 'image' ? 'image/jpeg' : 'application/json';
  const suppliedContentType = normalizedContentType(metadata.contentType);
  if (suppliedContentType !== expectedContentType) {
    throw new CaptureIngestPolicyError(
      `Expected ${expectedContentType} for this private capture asset.`,
    );
  }

  const maxBytes = metadata.kind === 'image' ? MAX_CAPTURE_IMAGE_BYTES : MAX_CAPTURE_JSON_BYTES;
  if (bytes.byteLength === 0) throw new CaptureIngestPolicyError('Empty files cannot be saved.');
  if (bytes.byteLength > maxBytes) {
    throw new CaptureIngestPolicyError(
      metadata.kind === 'image'
        ? 'JPEG exceeds the private capture size limit. Retake the still.'
        : 'JSON document exceeds the private capture size limit.',
    );
  }

  if (metadata.kind === 'image') validateJpeg(bytes);
  else validateCaptureDocument(bytes, metadata.kind, metadata.captureId);

  return {
    pathname: `${CAPTURE_BLOB_PREFIX}/${metadata.recordId}/${assetFileName(metadata.kind)}`,
    contentType: expectedContentType,
    maxBytes,
  };
}

export function normalizedContentType(value: string | null): string {
  return value?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function assetFileName(kind: CaptureVaultAssetKind): string {
  switch (kind) {
    case 'image':
      return 'board.jpg';
    case 'manifest':
      return 'manifest.json';
    case 'annotations':
      return 'annotations.json';
  }
}

function validateJpeg(bytes: Uint8Array): void {
  if (
    bytes.byteLength < 4 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[bytes.byteLength - 2] !== 0xff ||
    bytes[bytes.byteLength - 1] !== 0xd9
  ) {
    throw new CaptureIngestPolicyError(
      'Only a complete JPEG still may enter private capture storage.',
    );
  }
}

function validateCaptureDocument(
  bytes: Uint8Array,
  kind: Exclude<CaptureVaultAssetKind, 'image'>,
  captureId: string,
): void {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new CaptureIngestPolicyError('Capture metadata must be valid UTF-8 JSON.');
  }
  if (!isRecord(value)) {
    throw new CaptureIngestPolicyError('Capture metadata must be a JSON object.');
  }

  const capture = kind === 'manifest' ? value : value.capture;
  if (!isRecord(capture) || capture.captureId !== captureId) {
    throw new CaptureIngestPolicyError('Capture metadata does not match this private capture ID.');
  }
  if (
    capture.consentVersion !== DEVELOPMENT_DATA_LAB_CONSENT_VERSION ||
    !isIsoTimestamp(capture.consentAcceptedAt) ||
    capture.admissionStatus !== DEVELOPMENT_DATA_LAB_ADMISSION_STATUS ||
    capture.containsFaces !== false ||
    capture.imageMime !== 'image/jpeg'
  ) {
    throw new CaptureIngestPolicyError(
      'Capture metadata must attest to a consented, board-only JPEG awaiting development review.',
    );
  }
  if (capture.captureMode !== 'still') {
    throw new CaptureIngestPolicyError('Data Lab accepts one board still image at a time.');
  }
  if (!isPseudonymousId(capture.sessionId)) {
    throw new CaptureIngestPolicyError(
      'Capture metadata must include a valid pseudonymous setup session.',
    );
  }
  if (capture.captureIntent !== 'empty-board' && capture.captureIntent !== 'static-dart') {
    throw new CaptureIngestPolicyError(
      'Capture metadata must identify a blank board or dart test.',
    );
  }
  const expectedImageFile = `darts-180-${captureId}-${capture.captureIntent}.jpg`;
  if (
    typeof capture.imageFile !== 'string' ||
    !IMAGE_FILE.test(capture.imageFile) ||
    capture.imageFile !== expectedImageFile
  ) {
    throw new CaptureIngestPolicyError('Capture metadata must name this Data Lab JPEG exactly.');
  }

  if (kind === 'annotations') {
    if (!isRecord(value.image) || !isRecord(value.board) || !Array.isArray(value.darts)) {
      throw new CaptureIngestPolicyError('Annotation metadata is incomplete and was not stored.');
    }
    if (value.image.file !== capture.imageFile) {
      throw new CaptureIngestPolicyError('Annotation metadata does not name this capture JPEG.');
    }
    if (
      (capture.captureIntent === 'empty-board' && value.darts.length !== 0) ||
      (capture.captureIntent === 'static-dart' && value.darts.length === 0)
    ) {
      throw new CaptureIngestPolicyError(
        'Blank-board labels must have no tips, while a dart test needs at least one reviewed tip.',
      );
    }
  }
}

function isPseudonymousId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID.test(value);
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64) return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
