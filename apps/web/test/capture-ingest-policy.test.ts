import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEVELOPMENT_DATA_LAB_ADMISSION_STATUS,
  DEVELOPMENT_DATA_LAB_CONSENT_VERSION,
} from '../src/lib/captureConsent.js';
import {
  CAPTURE_BLOB_PREFIX,
  CaptureIngestPolicyError,
  DEVELOPMENT_CONSENT_ACCESS_MODE,
  VERCEL_PROTECTED_OWNER_ACCESS_MODE,
  isCaptureIngestConfigured,
  normalizedContentType,
  resolveCaptureIngestAccessMode,
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
    consentVersion: DEVELOPMENT_DATA_LAB_CONSENT_VERSION,
    consentAcceptedAt: '2026-09-08T12:00:00.000Z',
    admissionStatus: DEVELOPMENT_DATA_LAB_ADMISSION_STATUS,
    captureMode: 'still',
    captureIntent,
    containsFaces: false,
    imageMime: 'image/jpeg',
    imageFile: `darts-180-${CAPTURE_ID}-${captureIntent}.jpg`,
  };
}

test('private capture storage stays fail-closed unless an exact supported mode and Blob store are configured', () => {
  assert.equal(
    isCaptureIngestConfigured({
      accessMode: undefined,
      blobStoreId: 'store_123',
    }),
    false,
  );
  assert.equal(
    isCaptureIngestConfigured({
      accessMode: 'development-consent-v0',
      blobStoreId: 'store_123',
    }),
    false,
  );
  assert.equal(
    isCaptureIngestConfigured({
      accessMode: DEVELOPMENT_CONSENT_ACCESS_MODE,
      blobStoreId: '   ',
    }),
    false,
  );
  assert.equal(
    isCaptureIngestConfigured({
      accessMode: ` ${DEVELOPMENT_CONSENT_ACCESS_MODE} `,
      blobStoreId: 'store_123',
    }),
    false,
  );
  assert.equal(
    resolveCaptureIngestAccessMode({
      accessMode: DEVELOPMENT_CONSENT_ACCESS_MODE,
      blobStoreId: 'store_123',
    }),
    DEVELOPMENT_CONSENT_ACCESS_MODE,
  );
  assert.equal(
    isCaptureIngestConfigured({
      accessMode: DEVELOPMENT_CONSENT_ACCESS_MODE,
      blobStoreId: 'store_123',
    }),
    true,
  );
  assert.equal(
    isCaptureIngestConfigured({
      accessMode: VERCEL_PROTECTED_OWNER_ACCESS_MODE,
      blobStoreId: 'store_123',
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

test('manifest and sidecar assets must attest to matching board-only consent provenance', () => {
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
    /consented, board-only JPEG awaiting development review/,
  );
  assert.throws(
    () =>
      validateCaptureIngestAsset(
        metadata('manifest', 'application/json'),
        jsonBytes({ ...captureManifest(), consentAcceptedAt: 'later' }),
      ),
    /consented, board-only JPEG awaiting development review/,
  );
  assert.throws(
    () =>
      validateCaptureIngestAsset(
        metadata('manifest', 'application/json'),
        jsonBytes({ ...captureManifest(), admissionStatus: 'approved-for-training' }),
      ),
    /consented, board-only JPEG awaiting development review/,
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
