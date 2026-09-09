import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CAPTURE_INGEST_PATH,
  CaptureVaultError,
  getCaptureVaultStatus,
  uploadPrivateCaptureAsset,
} from '../src/lib/captureVault.js';

const CAPTURE_ID = 'cap_0123456789abcdef0123456789abcdef';
const RECORD_ID = 'record_0123456789abcdef0123456789abcdef';

test('private capture client sends a bounded same-origin JPEG request without a browser credential', async () => {
  let requestUrl: string | URL | Request | undefined;
  let request: RequestInit | undefined;
  const result = await uploadPrivateCaptureAsset({
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
  assert.equal(headers.get('x-darts180-collection-key'), null);
  assert.equal(headers.get('authorization'), null);
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
      captureId: CAPTURE_ID,
      recordId: RECORD_ID,
      kind: 'manifest',
      body: new Blob(['{}'], { type: 'application/json' }),
      fetchImplementation: async () =>
        Response.json(
          { error: 'Private capture saves must come from this Darts 180 site.' },
          { status: 403 },
        ),
    }),
    (error: unknown) =>
      error instanceof CaptureVaultError &&
      error.status === 403 &&
      error.message === 'Private capture saves must come from this Darts 180 site.',
  );
});
