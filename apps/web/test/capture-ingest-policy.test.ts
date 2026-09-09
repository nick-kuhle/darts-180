import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CAPTURE_BLOB_PREFIX,
  CaptureIngestPolicyError,
  isCaptureIngestConfigured,
  normalizedContentType,
  validateCaptureIngestAsset,
} from '../src/server/captureIngestPolicy.js';

const CAPTURE_ID = 'cap_0123456789abcdef0123456789abcdef';
const RECORD_ID = 'record_0123456789abcdef0123456789abcdef';

function metadata(kind: 'image' | 'manifest' | 'annotations', contentType: string | null) {
  return { captureId: CAPTURE_ID, recordId: RECORD_ID, kind, contentType };
}

function jpegBytes(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0x00, 0x00, 0xff, 0xd9]);
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function captureManifest(captureIntent: 'empty-board' | 'static-dart' = 'static-dart') {
  return {
    captureId: CAPTURE_ID,
    sessionId: 'session_0123456789abcdef0123456789abcdef',
    consentVersion: 'SELF-CAPTURE-DEVELOPMENT-V1',
    captureMode: 'still',
    captureIntent,
    containsFaces: false,
    imageMime: 'image/jpeg',
    imageFile: `darts-180-${CAPTURE_ID}-${captureIntent}.jpg`,
  };
}

test('private capture storage stays disabled without both a strong collection secret and server Blob credentials', () => {
  assert.equal(
    isCaptureIngestConfigured({
      collectionSecret: 'x'.repeat(31),
      blobReadWriteToken: 'token',
      blobStoreId: undefined,
      vercelOidcToken: undefined,
    }),
    false,
  );
  assert.equal(
    isCaptureIngestConfigured({
      collectionSecret: 'x'.repeat(32),
      blobReadWriteToken: undefined,
      blobStoreId: 'store_123',
      vercelOidcToken: undefined,
    }),
    false,
  );
  assert.equal(
    isCaptureIngestConfigured({
      collectionSecret: 'x'.repeat(32),
      blobReadWriteToken: undefined,
      blobStoreId: 'store_123',
      vercelOidcToken: 'oidc',
    }),
    true,
  );
  assert.equal(
    isCaptureIngestConfigured({
      collectionSecret: 'x'.repeat(32),
      blobReadWriteToken: 'token',
      blobStoreId: undefined,
      vercelOidcToken: undefined,
    }),
    true,
  );
});

test('intake accepts only bounded JPEGs and fixed private record paths', () => {
  const asset = validateCaptureIngestAsset(
    metadata('image', 'image/jpeg; charset=binary'),
    jpegBytes(),
  );
  assert.deepEqual(asset, {
    pathname: `${CAPTURE_BLOB_PREFIX}/${RECORD_ID}/board.jpg`,
    contentType: 'image/jpeg',
    maxBytes: 3_500_000,
  });
  assert.equal(normalizedContentType(' Application/JSON; charset=utf-8 '), 'application/json');

  assert.throws(
    () => validateCaptureIngestAsset(metadata('image', 'image/png'), jpegBytes()),
    CaptureIngestPolicyError,
  );
  assert.throws(
    () =>
      validateCaptureIngestAsset(
        metadata('image', 'image/jpeg'),
        new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      ),
    /complete JPEG/,
  );
  assert.throws(
    () =>
      validateCaptureIngestAsset(
        { ...metadata('image', 'image/jpeg'), captureId: 'cap_guessable' },
        jpegBytes(),
      ),
    /Capture ID/,
  );
  assert.throws(
    () =>
      validateCaptureIngestAsset(
        { ...metadata('image', 'image/jpeg'), recordId: 'record_guessable' },
        jpegBytes(),
      ),
    /Storage record ID/,
  );
});

test('manifest and sidecar assets must attest to the matching board-only capture', () => {
  const manifest = validateCaptureIngestAsset(
    metadata('manifest', 'application/json'),
    jsonBytes(captureManifest()),
  );
  assert.equal(manifest.pathname, `${CAPTURE_BLOB_PREFIX}/${RECORD_ID}/manifest.json`);

  const annotation = validateCaptureIngestAsset(
    metadata('annotations', 'application/json; charset=utf-8'),
    jsonBytes({
      capture: captureManifest(),
      image: { file: captureManifest().imageFile, width: 1280, height: 720 },
      board: { anchors: [] },
      darts: [{}],
    }),
  );
  assert.equal(annotation.pathname, `${CAPTURE_BLOB_PREFIX}/${RECORD_ID}/annotations.json`);

  assert.throws(
    () =>
      validateCaptureIngestAsset(
        metadata('manifest', 'application/json'),
        jsonBytes({ ...captureManifest(), captureId: 'cap_different_0123456789' }),
      ),
    /does not match/,
  );
  assert.throws(
    () =>
      validateCaptureIngestAsset(
        metadata('annotations', 'application/json'),
        jsonBytes({ capture: captureManifest(), image: {}, board: {} }),
      ),
    /incomplete/,
  );
  assert.throws(
    () =>
      validateCaptureIngestAsset(
        metadata('manifest', 'application/json'),
        jsonBytes({ ...captureManifest(), containsFaces: true }),
      ),
    /reviewed, board-only JPEG/,
  );
  assert.throws(
    () =>
      validateCaptureIngestAsset(
        metadata('manifest', 'application/json'),
        jsonBytes({ ...captureManifest(), consentVersion: 'LOCAL-CAPTURE-NOT-YET-SHARED' }),
      ),
    /reviewed, board-only JPEG/,
  );
  assert.throws(
    () =>
      validateCaptureIngestAsset(
        metadata('annotations', 'application/json'),
        jsonBytes({
          capture: captureManifest(),
          image: { file: captureManifest().imageFile },
          board: {},
          darts: [],
        }),
      ),
    /dart test needs at least one reviewed tip/,
  );
  assert.throws(
    () =>
      validateCaptureIngestAsset(
        metadata('annotations', 'application/json'),
        jsonBytes({
          capture: captureManifest('empty-board'),
          image: { file: captureManifest('empty-board').imageFile },
          board: {},
          darts: [{}],
        }),
      ),
    /Blank-board labels must have no tips/,
  );
  assert.throws(
    () =>
      validateCaptureIngestAsset(
        metadata('annotations', 'application/json'),
        jsonBytes({
          capture: captureManifest(),
          image: { file: 'another-board.jpg' },
          board: {},
          darts: [{}],
        }),
      ),
    /does not name this capture JPEG/,
  );
});
