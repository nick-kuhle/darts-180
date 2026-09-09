import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CAPTURE_INGEST_PATH,
  CaptureVaultError,
  getCaptureVaultStatus,
  hasUsableCollectionKey,
  uploadPrivateCaptureAsset,
} from '../src/lib/captureVault.js';

const COLLECTION_KEY = 'k'.repeat(32);
const CAPTURE_ID = 'cap_0123456789abcdef0123456789abcdef';
const RECORD_ID = 'record_0123456789abcdef0123456789abcdef';

test('private capture client never treats a short collection key as usable', () => {
  assert.equal(hasUsableCollectionKey(''), false);
  assert.equal(hasUsableCollectionKey('k'.repeat(31)), false);
  assert.equal(hasUsableCollectionKey(`  ${COLLECTION_KEY}  `), true);
});

test('private capture client sends a bounded same-origin JPEG request with the operator key only in a request header', async () => {
  let requestUrl: string | URL | Request | undefined;
  let request: RequestInit | undefined;
  const result = await uploadPrivateCaptureAsset({
    collectionKey: COLLECTION_KEY,
    captureId: CAPTURE_ID,
    recordId: RECORD_ID,
    kind: 'image',
    body: new Blob([new Uint8Array([0xff, 0xd8, 0x00, 0xff, 0xd9])], { type: 'image/jpeg' }),
    fetchImplementation: async (input, init) => {
      requestUrl = input;
      request = init;
      return Response.json({
        captureId: CAPTURE_ID,
        recordId: RECORD_ID,
        kind: 'image',
        bytes: 5,
        sha256: 'a'.repeat(64),
      });
    },
  });

  assert.equal(requestUrl, CAPTURE_INGEST_PATH);
  assert.equal(request?.method, 'PUT');
  assert.equal(request?.credentials, 'same-origin');
  assert.equal(request?.cache, 'no-store');
  const headers = new Headers(request?.headers);
  assert.equal(headers.get('content-type'), 'image/jpeg');
  assert.equal(headers.get('x-darts180-capture-id'), CAPTURE_ID);
  assert.equal(headers.get('x-darts180-record-id'), RECORD_ID);
  assert.equal(headers.get('x-darts180-asset-kind'), 'image');
  assert.equal(headers.get('x-darts180-collection-key'), COLLECTION_KEY);
  assert.equal(result.kind, 'image');
});

test('private capture client understands the deliberate unconfigured status and surfaces server rejection safely', async () => {
  const disabled = await getCaptureVaultStatus(async () =>
    Response.json(
      { configured: false, maxImageBytes: 3_500_000, maxJsonBytes: 196_608 },
      { status: 503 },
    ),
  );
  assert.equal(disabled.configured, false);

  await assert.rejects(
    getCaptureVaultStatus(async () =>
      Response.json(
        { configured: false, maxImageBytes: 3_500_000, maxJsonBytes: 196_608 },
        { status: 500 },
      ),
    ),
    (error: unknown) => error instanceof CaptureVaultError && error.status === 500,
  );

  await assert.rejects(
    uploadPrivateCaptureAsset({
      collectionKey: COLLECTION_KEY,
      captureId: CAPTURE_ID,
      recordId: RECORD_ID,
      kind: 'manifest',
      body: new Blob(['{}'], { type: 'application/json' }),
      fetchImplementation: async () =>
        Response.json({ error: 'Private collection key was not accepted.' }, { status: 401 }),
    }),
    (error: unknown) =>
      error instanceof CaptureVaultError &&
      error.status === 401 &&
      error.message === 'Private collection key was not accepted.',
  );
});
