import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import captureIngestFunction, {
  createCaptureIngestHandler,
  type CaptureIngestHandlerDependencies,
} from '../api/capture-ingest.js';
import { VERCEL_PROTECTED_OWNER_ACCESS_MODE } from '../src/server/captureIngestPolicy.js';

const CAPTURE_ID = 'cap_0123456789abcdef0123456789abcdef';
const RECORD_ID = 'record_0123456789abcdef0123456789abcdef';

function configuredDependencies() {
  const writes: Array<{ pathname: string; body: ArrayBuffer; options: unknown }> = [];
  const dependencies: CaptureIngestHandlerDependencies = {
    getEnvironment: () => ({
      ownerAccessMode: VERCEL_PROTECTED_OWNER_ACCESS_MODE,
      blobStoreId: 'store_123',
    }),
    putPrivateBlob: async (pathname, body, options) => {
      writes.push({ pathname, body, options });
      return {};
    },
  };
  return { handler: createCaptureIngestHandler(dependencies), writes };
}

function captureManifest() {
  return {
    captureId: CAPTURE_ID,
    sessionId: 'session_0123456789abcdef0123456789abcdef',
    consentVersion: 'SELF-CAPTURE-DEVELOPMENT-V1',
    captureMode: 'still',
    captureIntent: 'empty-board',
    containsFaces: false,
    imageMime: 'image/jpeg',
    imageFile: `darts-180-${CAPTURE_ID}-empty-board.jpg`,
  };
}

function privateHeaders(kind: 'image' | 'manifest' | 'annotations', contentType: string) {
  return {
    'Content-Type': contentType,
    'X-Darts180-Capture-Id': CAPTURE_ID,
    'X-Darts180-Record-Id': RECORD_ID,
    'X-Darts180-Asset-Kind': kind,
  };
}

function request(method: string, headers: Record<string, string> = {}, body?: BodyInit): Request {
  return new Request('https://darts180.example/api/capture-ingest', { method, headers, body });
}

test('default API export uses Vercel’s Web Fetch Function contract', async () => {
  assert.equal(typeof captureIngestFunction.fetch, 'function');
  const response = await captureIngestFunction.fetch(request('PATCH'));
  assert.equal(response.status, 405);
});

test('intake status is fail-closed until protected owner mode and its Blob store are configured', async () => {
  let writeCount = 0;
  const handler = createCaptureIngestHandler({
    getEnvironment: () => ({
      ownerAccessMode: undefined,
      blobStoreId: 'store_123',
    }),
    putPrivateBlob: async () => {
      writeCount += 1;
      return {};
    },
  });

  const status = await handler(request('GET'));
  assert.equal(status.status, 503);
  assert.deepEqual(await status.json(), {
    configured: false,
    maxImageBytes: 3_500_000,
    maxJsonBytes: 196_608,
  });

  const rejected = await handler(
    request('PUT', privateHeaders('image', 'image/jpeg'), new Uint8Array([0xff, 0xd8, 0xff, 0xd9])),
  );
  assert.equal(rejected.status, 503);
  assert.equal(writeCount, 0);
});

test('intake rejects cross-site writes before it can write private capture bytes', async () => {
  const { handler, writes } = configuredDependencies();
  const crossSite = await handler(
    request(
      'PUT',
      {
        ...privateHeaders('image', 'image/jpeg'),
        Origin: 'https://attacker.example',
        'Sec-Fetch-Site': 'cross-site',
      },
      new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    ),
  );
  assert.equal(crossSite.status, 403);
  assert.equal(writes.length, 0);
});

test('intake accepts a same-origin validated JPEG without a collection key and never returns a Blob URL', async () => {
  const { handler, writes } = configuredDependencies();
  const body = new Uint8Array([0xff, 0xd8, 0x00, 0x00, 0xff, 0xd9]);
  const response = await handler(
    request(
      'PUT',
      { ...privateHeaders('image', 'image/jpeg'), Origin: 'https://darts180.example' },
      body,
    ),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    captureId: CAPTURE_ID,
    recordId: RECORD_ID,
    kind: 'image',
    bytes: body.byteLength,
    sha256: createHash('sha256').update(body).digest('hex'),
  });
  assert.deepEqual(writes, [
    {
      pathname: `darts180/capture-lab/v1/${RECORD_ID}/board.jpg`,
      body: writes[0]?.body,
      options: {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: 'image/jpeg',
        cacheControlMaxAge: 60,
      },
    },
  ]);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('intake bounds a streamed body even when a request omits content-length', async () => {
  const { handler, writes } = configuredDependencies();
  const oversized = new Uint8Array(3_500_001);
  oversized.set([0xff, 0xd8], 0);
  oversized.set([0xff, 0xd9], oversized.length - 2);

  const response = await handler(request('PUT', privateHeaders('image', 'image/jpeg'), oversized));
  assert.equal(response.status, 413);
  assert.equal(writes.length, 0);
});

test('intake validates matching JSON before a storage write and hides storage implementation errors', async () => {
  const { handler, writes } = configuredDependencies();
  const mismatched = await handler(
    request(
      'PUT',
      privateHeaders('manifest', 'application/json'),
      JSON.stringify({ ...captureManifest(), captureId: 'cap_different_0123456789' }),
    ),
  );
  assert.equal(mismatched.status, 400);
  assert.equal(writes.length, 0);

  const unconfirmed = await handler(
    request(
      'PUT',
      privateHeaders('manifest', 'application/json'),
      JSON.stringify({ ...captureManifest(), consentVersion: 'LOCAL-CAPTURE-NOT-YET-SHARED' }),
    ),
  );
  assert.equal(unconfirmed.status, 400);
  assert.equal(writes.length, 0);

  const unavailableHandler = createCaptureIngestHandler({
    getEnvironment: () => ({
      ownerAccessMode: VERCEL_PROTECTED_OWNER_ACCESS_MODE,
      blobStoreId: 'store_123',
    }),
    putPrivateBlob: async () => {
      throw new Error('BLOB_READ_WRITE_TOKEN leaked in this mock error');
    },
  });
  const unavailable = await unavailableHandler(
    request(
      'PUT',
      privateHeaders('manifest', 'application/json'),
      JSON.stringify(captureManifest()),
    ),
  );
  assert.equal(unavailable.status, 502);
  const payload = (await unavailable.json()) as { error: string };
  assert.equal(
    payload.error,
    'Private storage could not confirm this file. Keep this tab open and retry only this file.',
  );
  assert.doesNotMatch(payload.error, /BLOB_READ_WRITE_TOKEN/);
});
