#!/usr/bin/env node
/**
 * Retrieve an explicit, owner-approved set of Darts 180 Data Lab records from private Vercel Blob.
 *
 * This is an operator/CI utility, never browser code and never a public API route. It deliberately:
 * - requires a non-secret allow-list of private record IDs supplied through a protected environment;
 * - calls `get()` only for the three expected paths of those records (it never lists the store);
 * - validates that the manifest and annotations sidecar describe the same consented five-point still;
 * - writes an external-only normalized source layout for the existing Python compiler; and
 * - emits only an aggregate receipt, not IDs, URLs, capture bytes, or credentials.
 *
 * It is intended for the manual-only private GitHub Actions workflow. Raw files must remain in a
 * short-lived runner directory and be removed by that workflow even when this command fails.
 */

import { createHash } from 'node:crypto';
import { mkdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRIVATE_CAPTURE_PREFIX = 'darts180/capture-lab/v2';
export const MAX_CAPTURE_IMAGE_BYTES = 3_500_000;
export const MAX_CAPTURE_JSON_BYTES = 196_608;
export const DEVELOPMENT_CONSENT_VERSION = 'DEVELOPMENT-DATA-LAB-CONSENT-V1';
export const DEVELOPMENT_ADMISSION_STATUS = 'consented-development-unreviewed';

const RECORD_ID_PATTERN = /^record_[a-f0-9]{32}$/i;
const CAPTURE_ID_PATTERN = /^cap_[a-f0-9]{32}$/i;
const IMAGE_FILE_PATTERN = /^[A-Za-z0-9_.-]+\.jpe?g$/i;
const CAPTURE_INTENTS = new Set(['empty-board', 'static-dart']);
const OUTPUT_FILE_MODE = 0o600;
const OUTPUT_DIRECTORY_MODE = 0o700;

export class PrivateCaptureRetrievalError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PrivateCaptureRetrievalError';
  }
}

/**
 * Parse a newline-, comma-, or whitespace-separated allow-list without ever echoing its values.
 * Record IDs are not accepted as a generic prefix: every object read is derived from this exact set.
 */
export function parseApprovedRecordIds(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PrivateCaptureRetrievalError(
      'An explicit approved-record allow-list is required; refusing to enumerate the private store.',
    );
  }

  const ids = value
    .split(/[\s,]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
  if (ids.length === 0 || ids.length > 1_000) {
    throw new PrivateCaptureRetrievalError(
      'The approved-record allow-list must contain between one and 1,000 record IDs.',
    );
  }

  const unique = new Set();
  for (const value of ids) {
    const recordId = value.toLowerCase();
    if (!RECORD_ID_PATTERN.test(recordId)) {
      throw new PrivateCaptureRetrievalError(
        'The approved-record allow-list contains an invalid ID.',
      );
    }
    if (unique.has(recordId)) {
      throw new PrivateCaptureRetrievalError('The approved-record allow-list repeats an ID.');
    }
    unique.add(recordId);
  }
  return [...unique].sort();
}

/** Build the only three Blob paths this utility may request for an approved record. */
export function expectedBlobPaths(recordId) {
  if (!RECORD_ID_PATTERN.test(recordId)) {
    throw new PrivateCaptureRetrievalError(
      'Cannot construct private paths for an invalid record ID.',
    );
  }
  const recordPrefix = `${PRIVATE_CAPTURE_PREFIX}/${recordId}`;
  return {
    image: `${recordPrefix}/board.jpg`,
    manifest: `${recordPrefix}/manifest.json`,
    annotations: `${recordPrefix}/annotations.json`,
  };
}

/**
 * Retrieve approved triplets using an injected `getPrivateBlob` function. The small injected
 * boundary permits local tests without any Blob credential or network operation.
 */
export async function retrieveApprovedPrivateCaptures({
  approvedRecordIds,
  getPrivateBlob,
  outputDirectory,
  repositoryRoot,
}) {
  if (!Array.isArray(approvedRecordIds) || approvedRecordIds.length === 0) {
    throw new PrivateCaptureRetrievalError('At least one explicitly approved record is required.');
  }
  if (new Set(approvedRecordIds).size !== approvedRecordIds.length) {
    throw new PrivateCaptureRetrievalError('Approved record IDs must be unique.');
  }
  for (const recordId of approvedRecordIds) {
    if (typeof recordId !== 'string' || !RECORD_ID_PATTERN.test(recordId)) {
      throw new PrivateCaptureRetrievalError(
        'Approved record IDs must use the expected private format.',
      );
    }
  }
  if (typeof getPrivateBlob !== 'function') {
    throw new TypeError('getPrivateBlob must be a function.');
  }

  const secureOutputDirectory = await createExternalOutputDirectory(
    outputDirectory,
    repositoryRoot,
  );
  const summary = {
    schemaVersion: 1,
    scope:
      'aggregate-only private capture retrieval receipt; no capture IDs, URLs, image bytes, or credentials',
    recordCount: 0,
    assetCount: { image: 0, manifest: 0, annotations: 0 },
    byteCount: { image: 0, manifest: 0, annotations: 0 },
  };

  try {
    for (const recordId of [...approvedRecordIds].sort()) {
      const paths = expectedBlobPaths(recordId);
      const [manifestBytes, annotationBytes] = await Promise.all([
        downloadExpectedAsset(
          getPrivateBlob,
          paths.manifest,
          'application/json',
          MAX_CAPTURE_JSON_BYTES,
        ),
        downloadExpectedAsset(
          getPrivateBlob,
          paths.annotations,
          'application/json',
          MAX_CAPTURE_JSON_BYTES,
        ),
      ]);
      const normalized = validateAndNormalizeDocuments(recordId, manifestBytes, annotationBytes);
      const imageBytes = await downloadExpectedAsset(
        getPrivateBlob,
        paths.image,
        'image/jpeg',
        MAX_CAPTURE_IMAGE_BYTES,
      );
      validateJpeg(imageBytes);

      const recordDirectory = resolve(secureOutputDirectory, recordId);
      if (!isDirectChild(secureOutputDirectory, recordDirectory)) {
        throw new PrivateCaptureRetrievalError(
          'Refusing an output path outside the private staging area.',
        );
      }
      await mkdir(recordDirectory, { mode: OUTPUT_DIRECTORY_MODE });
      await writeExclusiveFile(recordDirectory, normalized.imageFile, imageBytes);
      await writeExclusiveFile(recordDirectory, normalized.annotationFile, annotationBytes);
      await writeExclusiveFile(recordDirectory, normalized.manifestFile, manifestBytes);

      summary.recordCount += 1;
      summary.assetCount.image += 1;
      summary.assetCount.manifest += 1;
      summary.assetCount.annotations += 1;
      summary.byteCount.image += imageBytes.byteLength;
      summary.byteCount.manifest += manifestBytes.byteLength;
      summary.byteCount.annotations += annotationBytes.byteLength;
    }
    return summary;
  } catch (error) {
    // The caller owns an additional always-run cleanup, but remove partial records immediately too.
    await rm(secureOutputDirectory, { force: true, recursive: true });
    throw error;
  }
}

async function createExternalOutputDirectory(outputDirectory, repositoryRoot) {
  if (typeof outputDirectory !== 'string' || !isAbsolute(outputDirectory)) {
    throw new PrivateCaptureRetrievalError('outputDirectory must be an absolute external path.');
  }
  if (typeof repositoryRoot !== 'string' || !isAbsolute(repositoryRoot)) {
    throw new PrivateCaptureRetrievalError('repositoryRoot must be an absolute path.');
  }

  const requestedParent = dirname(resolve(outputDirectory));
  const requestedName = basename(resolve(outputDirectory));
  if (!requestedName || requestedName === '.' || requestedName === '..') {
    throw new PrivateCaptureRetrievalError('outputDirectory must name a dedicated new directory.');
  }

  let canonicalParent;
  let canonicalRepositoryRoot;
  try {
    [canonicalParent, canonicalRepositoryRoot] = await Promise.all([
      realpath(requestedParent),
      realpath(repositoryRoot),
    ]);
  } catch {
    throw new PrivateCaptureRetrievalError(
      'The output parent and repository root must already exist before private retrieval.',
    );
  }
  const canonicalOutputDirectory = resolve(canonicalParent, requestedName);
  if (isWithin(canonicalRepositoryRoot, canonicalOutputDirectory)) {
    throw new PrivateCaptureRetrievalError(
      'Private captures must be staged outside the repository, never in a tracked or ignored project path.',
    );
  }

  try {
    await mkdir(canonicalOutputDirectory, { mode: OUTPUT_DIRECTORY_MODE });
  } catch (error) {
    if (isNodeError(error, 'EEXIST')) {
      throw new PrivateCaptureRetrievalError(
        'The private staging directory already exists; use a new empty runner directory.',
      );
    }
    throw new PrivateCaptureRetrievalError('Could not create the private staging directory.');
  }

  const metadata = await stat(canonicalOutputDirectory);
  if (!metadata.isDirectory()) {
    await rm(canonicalOutputDirectory, { force: true, recursive: true });
    throw new PrivateCaptureRetrievalError('The private staging destination is not a directory.');
  }
  return canonicalOutputDirectory;
}

async function downloadExpectedAsset(getPrivateBlob, pathname, expectedContentType, maxBytes) {
  let result;
  try {
    result = await getPrivateBlob(pathname);
  } catch {
    throw new PrivateCaptureRetrievalError('A requested approved private asset could not be read.');
  }
  if (result === null || !isRecord(result) || result.statusCode !== 200 || result.stream === null) {
    throw new PrivateCaptureRetrievalError(
      'An approved private record is incomplete or unavailable.',
    );
  }
  if (!isRecord(result.blob) || result.blob.pathname !== pathname) {
    throw new PrivateCaptureRetrievalError(
      'A private Blob response did not match its approved pathname.',
    );
  }
  if (normalizedContentType(result.blob.contentType) !== expectedContentType) {
    throw new PrivateCaptureRetrievalError(
      'A private record has an unexpected asset content type.',
    );
  }
  if (
    typeof result.blob.size === 'number' &&
    Number.isFinite(result.blob.size) &&
    result.blob.size > maxBytes
  ) {
    throw new PrivateCaptureRetrievalError(
      'A private record exceeds the accepted capture size limit.',
    );
  }
  return readLimitedWebStream(result.stream, maxBytes);
}

async function readLimitedWebStream(stream, maxBytes) {
  if (!stream || typeof stream.getReader !== 'function') {
    throw new PrivateCaptureRetrievalError(
      'The private Blob response did not contain a readable stream.',
    );
  }
  const reader = stream.getReader();
  const chunks = [];
  let byteCount = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      byteCount += chunk.byteLength;
      if (byteCount > maxBytes) {
        await reader.cancel();
        throw new PrivateCaptureRetrievalError(
          'A private asset exceeded the accepted size while streaming.',
        );
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof PrivateCaptureRetrievalError) throw error;
    throw new PrivateCaptureRetrievalError(
      'A requested approved private asset could not be streamed.',
    );
  } finally {
    reader.releaseLock();
  }
  if (byteCount === 0) {
    throw new PrivateCaptureRetrievalError('A requested approved private asset was empty.');
  }
  return Buffer.concat(chunks, byteCount);
}

/** Validate document linkage before any bytes are written to the staging directory. */
export function validateAndNormalizeDocuments(recordId, manifestBytes, annotationBytes) {
  const manifest = parseJsonObject(manifestBytes, 'manifest');
  const annotations = parseJsonObject(annotationBytes, 'annotations');
  const capture = annotations.capture;
  if (!isRecord(capture)) {
    throw new PrivateCaptureRetrievalError(
      'The approved annotations sidecar has no capture metadata.',
    );
  }
  const captureId = manifest.captureId;
  if (typeof captureId !== 'string' || !CAPTURE_ID_PATTERN.test(captureId)) {
    throw new PrivateCaptureRetrievalError('The private manifest contains an invalid capture ID.');
  }
  if (capture.captureId !== captureId) {
    throw new PrivateCaptureRetrievalError(
      'The manifest and annotations sidecar identify different captures.',
    );
  }
  if (!RECORD_ID_PATTERN.test(recordId)) {
    throw new PrivateCaptureRetrievalError('The private record identifier is invalid.');
  }

  for (const key of [
    'sessionId',
    'consentVersion',
    'consentAcceptedAt',
    'admissionStatus',
    'captureMode',
    'captureIntent',
    'imageFile',
    'imageMime',
    'containsFaces',
  ]) {
    if (capture[key] !== manifest[key]) {
      throw new PrivateCaptureRetrievalError(
        'The manifest and annotations sidecar disagree about capture provenance.',
      );
    }
  }
  if (
    manifest.consentVersion !== DEVELOPMENT_CONSENT_VERSION ||
    manifest.admissionStatus !== DEVELOPMENT_ADMISSION_STATUS ||
    manifest.captureMode !== 'still' ||
    !CAPTURE_INTENTS.has(manifest.captureIntent) ||
    manifest.imageMime !== 'image/jpeg' ||
    manifest.containsFaces !== false
  ) {
    throw new PrivateCaptureRetrievalError(
      'The private record is not an approved consented Data Lab still for this build.',
    );
  }
  if (typeof manifest.imageFile !== 'string' || !IMAGE_FILE_PATTERN.test(manifest.imageFile)) {
    throw new PrivateCaptureRetrievalError(
      'The private record has an unsafe or invalid JPEG filename.',
    );
  }
  const expectedImageFile = `darts-180-${captureId}-${manifest.captureIntent}.jpg`;
  if (manifest.imageFile !== expectedImageFile) {
    throw new PrivateCaptureRetrievalError(
      'The private record has an unexpected Data Lab JPEG name.',
    );
  }
  if (!isRecord(annotations.image) || annotations.image.file !== manifest.imageFile) {
    throw new PrivateCaptureRetrievalError(
      'The annotation sidecar does not name its matching JPEG.',
    );
  }

  return {
    imageFile: manifest.imageFile,
    annotationFile: `darts-180-${captureId}-annotations.json`,
    manifestFile: `darts-180-${captureId}-manifest.json`,
  };
}

function parseJsonObject(bytes, label) {
  let value;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new PrivateCaptureRetrievalError(
      `The approved ${label} document is not valid UTF-8 JSON.`,
    );
  }
  if (!isRecord(value)) {
    throw new PrivateCaptureRetrievalError(`The approved ${label} document must be a JSON object.`);
  }
  return value;
}

function validateJpeg(bytes) {
  if (
    bytes.byteLength < 4 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[bytes.byteLength - 2] !== 0xff ||
    bytes[bytes.byteLength - 1] !== 0xd9
  ) {
    throw new PrivateCaptureRetrievalError('A private record image is not a complete JPEG.');
  }
}

async function writeExclusiveFile(directory, fileName, bytes) {
  const filePath = resolve(directory, fileName);
  if (!isDirectChild(directory, filePath)) {
    throw new PrivateCaptureRetrievalError(
      'Refusing a private staging filename outside its record directory.',
    );
  }
  await writeFile(filePath, bytes, { encoding: undefined, flag: 'wx', mode: OUTPUT_FILE_MODE });
}

function normalizedContentType(value) {
  return typeof value === 'string' ? value.split(';', 1)[0].trim().toLowerCase() : '';
}

function isWithin(parent, candidate) {
  const child = relative(parent, candidate);
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child));
}

function isDirectChild(parent, candidate) {
  return (
    dirname(candidate) === resolve(parent) &&
    !basename(candidate).includes('/') &&
    !basename(candidate).includes('\\')
  );
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error, code) {
  return isRecord(error) && error.code === code;
}

async function main() {
  const outputDirectory = readOption('--output-directory');
  const token = process.env.DARTS180_BLOB_READ_WRITE_TOKEN;
  if (typeof token !== 'string' || token.trim() === '') {
    throw new PrivateCaptureRetrievalError(
      'A private Blob credential is required in the protected runner.',
    );
  }
  const approvedRecordIds = parseApprovedRecordIds(process.env.DARTS180_APPROVED_RECORD_IDS);
  const repositoryRoot =
    process.env.GITHUB_WORKSPACE ?? resolve(fileURLToPath(new URL('../..', import.meta.url)));

  const { get } = await import('@vercel/blob');
  const summary = await retrieveApprovedPrivateCaptures({
    approvedRecordIds,
    getPrivateBlob: (pathname) => get(pathname, { access: 'private', token, useCache: false }),
    outputDirectory,
    repositoryRoot,
  });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PrivateCaptureRetrievalError(`${name} is required.`);
  }
  return value;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // Do not print an SDK error: it could contain a Blob URL or a caller-provided value.
    const message =
      error instanceof PrivateCaptureRetrievalError
        ? error.message
        : 'Private capture retrieval stopped before any model-build handoff.';
    process.stderr.write(`Private capture retrieval failed: ${message}\n`);
    process.exitCode = 1;
  });
}
