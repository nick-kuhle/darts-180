import assert from 'node:assert/strict';
import test from 'node:test';

import { getCameraAccessPreflightMessageFor } from '../src/lib/cameraAccess.js';

test('explains why an embedded preview cannot request camera permission', () => {
  const message = getCameraAccessPreflightMessageFor({
    isBrowser: true,
    isSecureContext: true,
    isEmbedded: true,
    hasGetUserMedia: true,
  });

  assert.match(message ?? '', /embedded preview/i);
  assert.match(message ?? '', /Vercel HTTPS URL/i);
});

test('requires HTTPS before attempting a camera request', () => {
  const message = getCameraAccessPreflightMessageFor({
    isBrowser: true,
    isSecureContext: false,
    isEmbedded: false,
    hasGetUserMedia: true,
  });

  assert.match(message ?? '', /HTTPS/i);
});

test('permits a top-level secure browser with getUserMedia', () => {
  assert.equal(
    getCameraAccessPreflightMessageFor({
      isBrowser: true,
      isSecureContext: true,
      isEmbedded: false,
      hasGetUserMedia: true,
    }),
    null,
  );
});
