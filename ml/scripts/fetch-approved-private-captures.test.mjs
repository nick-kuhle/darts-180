import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  DEVELOPMENT_ADMISSION_STATUS,
  DEVELOPMENT_CONSENT_VERSION,
  MAX_CAPTURE_IMAGE_BYTES,
  PRIVATE_CAPTURE_PREFIX,
  PrivateCaptureRetrievalError,
  expectedBlobPaths,
  parseApprovedRecordIds,
  retrieveApprovedPrivateCaptures,
  validateAndNormalizeDocuments,
} from './fetch-approved-private-captures.mjs';

const RECORD_ID = 'record_0123456789abcdef0123456789abcdef';
const CAPTURE_ID = 'cap_abcdef0123456789abcdef0123456789';
const SESSION_ID = 'session_11111111111111111111111111111111';

function captureManifest() {
  return {
    captureId: CAPTURE_ID,
    sessionId: SESSION_ID,
    consentVersion: DEVELOPMENT_CONSENT_VERSION,
    consentAcceptedAt: '2026-09-09T12:00:00.000Z',
    admissionStatus: DEVELOPMENT_ADMISSION_STATUS,
    boardModel: 'Standard dartboard',
    deviceModel: 'Test camera',
    captureMode: 'still',
    captureIntent: 'static-dart',
    imageFile: `darts-180-${CAPTURE_ID}-static-dart.jpg`,
    imageMime: 'image/jpeg',
    offAxisDegrees: 20,
    distanceMm: 900,
    lightingBand: 'normal',
    containsFaces: false,
    createdAt: '2026-09-09T12:00:00.000Z',
    labelsVersion: 'unlabeled-v0',
    split: 'unassigned',
  };
}

function annotationSidecar(manifest = captureManifest()) {
  return {
    schemaVersion: 1,
    capture: manifest,
    image: { file: manifest.imageFile, width: 640, height: 480 },
    board: { annotationProfile: 'deepdarts-five-point-v1' },
    darts: [],
  };
}

function resultFor(pathname, contentType, bytes) {
  return {
    statusCode: 200,
    blob: { pathname, contentType, size: bytes.byteLength },
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  };
}

function bytes(value) {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

test('parses only explicit, well-formed, unique private record IDs', () => {
  assert.deepEqual(
    parseApprovedRecordIds(`\n${RECORD_ID},\nrecord_fedcba9876543210fedcba9876543210\n`),
    [RECORD_ID, 'record_fedcba9876543210fedcba9876543210'],
  );
  assert.throws(
    () => parseApprovedRecordIds(`${RECORD_ID},${RECORD_ID}`),
    PrivateCaptureRetrievalError,
  );
  assert.throws(
    () => parseApprovedRecordIds('record_not-an-approved-id'),
    PrivateCaptureRetrievalError,
  );
  assert.throws(() => parseApprovedRecordIds(''), PrivateCaptureRetrievalError);
});

test('constructs only the three exact Blob paths for an approved record', () => {
  assert.deepEqual(expectedBlobPaths(RECORD_ID), {
    image: `${PRIVATE_CAPTURE_PREFIX}/${RECORD_ID}/board.jpg`,
    manifest: `${PRIVATE_CAPTURE_PREFIX}/${RECORD_ID}/manifest.json`,
    annotations: `${PRIVATE_CAPTURE_PREFIX}/${RECORD_ID}/annotations.json`,
  });
});

test('retrieves an allow-listed triplet, validates linkage, and writes a compiler-compatible layout', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'darts180-private-retrieval-test-'));
  const outputDirectory = join(temporary, 'private-captures');
  const repositoryRoot = join(temporary, 'repository');
  await mkdir(repositoryRoot);
  const manifest = captureManifest();
  const annotations = annotationSidecar(manifest);
  const paths = expectedBlobPaths(RECORD_ID);
  const requestedPaths = [];
  const assets = new Map([
    [paths.manifest, resultFor(paths.manifest, 'application/json', bytes(manifest))],
    [paths.annotations, resultFor(paths.annotations, 'application/json', bytes(annotations))],
    [paths.image, resultFor(paths.image, 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xd9]))],
  ]);

  const summary = await retrieveApprovedPrivateCaptures({
    approvedRecordIds: [RECORD_ID],
    outputDirectory,
    repositoryRoot,
    getPrivateBlob: async (pathname) => {
      requestedPaths.push(pathname);
      return assets.get(pathname) ?? null;
    },
  });

  assert.deepEqual(summary.assetCount, { image: 1, manifest: 1, annotations: 1 });
  assert.equal(summary.recordCount, 1);
  assert.deepEqual(new Set(requestedPaths), new Set(Object.values(paths)));
  assert.equal(requestedPaths.length, 3);

  const recordDirectory = join(outputDirectory, RECORD_ID);
  assert.deepEqual(
    JSON.parse(
      await readFile(join(recordDirectory, `darts-180-${CAPTURE_ID}-manifest.json`), 'utf8'),
    ),
    manifest,
  );
  assert.deepEqual(
    JSON.parse(
      await readFile(join(recordDirectory, `darts-180-${CAPTURE_ID}-annotations.json`), 'utf8'),
    ),
    annotations,
  );
  const image = await readFile(join(recordDirectory, manifest.imageFile));
  assert.deepEqual(image, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  assert.equal((await stat(recordDirectory)).isDirectory(), true);
});

test('refuses an unmatched sidecar before writing a partial raw record', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'darts180-private-retrieval-test-'));
  const outputDirectory = join(temporary, 'private-captures');
  const repositoryRoot = join(temporary, 'repository');
  await mkdir(repositoryRoot);
  const manifest = captureManifest();
  const annotations = annotationSidecar({
    ...manifest,
    captureId: 'cap_00000000000000000000000000000000',
  });
  const paths = expectedBlobPaths(RECORD_ID);
  const assets = new Map([
    [paths.manifest, resultFor(paths.manifest, 'application/json', bytes(manifest))],
    [paths.annotations, resultFor(paths.annotations, 'application/json', bytes(annotations))],
    [paths.image, resultFor(paths.image, 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xd9]))],
  ]);

  await assert.rejects(
    retrieveApprovedPrivateCaptures({
      approvedRecordIds: [RECORD_ID],
      outputDirectory,
      repositoryRoot,
      getPrivateBlob: async (pathname) => assets.get(pathname) ?? null,
    }),
    PrivateCaptureRetrievalError,
  );
  await assert.rejects(stat(outputDirectory));
});

test('rejects an asset which exceeds the Data Lab private image size limit', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'darts180-private-retrieval-test-'));
  const outputDirectory = join(temporary, 'private-captures');
  const repositoryRoot = join(temporary, 'repository');
  await mkdir(repositoryRoot);
  const manifest = captureManifest();
  const annotations = annotationSidecar(manifest);
  const paths = expectedBlobPaths(RECORD_ID);
  const oversize = Buffer.alloc(MAX_CAPTURE_IMAGE_BYTES + 1, 0);
  oversize[0] = 0xff;
  oversize[1] = 0xd8;
  oversize[oversize.length - 2] = 0xff;
  oversize[oversize.length - 1] = 0xd9;
  const assets = new Map([
    [paths.manifest, resultFor(paths.manifest, 'application/json', bytes(manifest))],
    [paths.annotations, resultFor(paths.annotations, 'application/json', bytes(annotations))],
    [paths.image, resultFor(paths.image, 'image/jpeg', oversize)],
  ]);

  await assert.rejects(
    retrieveApprovedPrivateCaptures({
      approvedRecordIds: [RECORD_ID],
      outputDirectory,
      repositoryRoot,
      getPrivateBlob: async (pathname) => assets.get(pathname) ?? null,
    }),
    PrivateCaptureRetrievalError,
  );
});

test('refuses an output directory inside the repository before requesting any private Blob asset', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'darts180-private-retrieval-test-'));
  const repositoryRoot = join(temporary, 'repository');
  await mkdir(repositoryRoot);
  let requests = 0;

  await assert.rejects(
    retrieveApprovedPrivateCaptures({
      approvedRecordIds: [RECORD_ID],
      outputDirectory: join(repositoryRoot, 'not-allowed'),
      repositoryRoot,
      getPrivateBlob: async () => {
        requests += 1;
        return null;
      },
    }),
    PrivateCaptureRetrievalError,
  );
  assert.equal(requests, 0);
});

test('rejects unexpected Data Lab filename linkage', () => {
  const manifest = captureManifest();
  const annotations = annotationSidecar(manifest);
  manifest.imageFile = 'other.jpg';
  annotations.capture.imageFile = 'other.jpg';
  annotations.image.file = 'other.jpg';
  assert.throws(
    () => validateAndNormalizeDocuments(RECORD_ID, bytes(manifest), bytes(annotations)),
    PrivateCaptureRetrievalError,
  );
});
