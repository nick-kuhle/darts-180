import { BlobPreconditionFailedError, put } from '@vercel/blob';
import { createHash } from 'node:crypto';

import {
  CaptureIngestPolicyError,
  DEVELOPMENT_CONSENT_ACCESS_MODE,
  type CaptureIngestEnvironment,
  isCaptureIngestConfigured,
  isCaptureVaultAssetKind,
  resolveCaptureIngestAccessMode,
  validateCaptureIngestAsset,
} from '../src/server/captureIngestPolicy';
import { MAX_CAPTURE_IMAGE_BYTES, MAX_CAPTURE_JSON_BYTES } from '../src/lib/captureVault';

interface PrivateBlobWriteOptions {
  access: 'private';
  addRandomSuffix: false;
  allowOverwrite: false;
  contentType: 'image/jpeg' | 'application/json';
  cacheControlMaxAge: number;
}

export interface CaptureIngestHandlerDependencies {
  getEnvironment: () => CaptureIngestEnvironment;
  putPrivateBlob: (
    pathname: string,
    body: ArrayBuffer,
    options: PrivateBlobWriteOptions,
  ) => Promise<unknown>;
}

/**
 * Private intake for Data Lab's reviewed JPEG + JSON triplets.
 *
 * This remains a server upload rather than a browser-to-Blob token exchange: raw capture bytes are
 * size-limited and validated by one same-origin Function. In `development-consent-v1`, any visitor
 * who reaches the development app can submit after the UI agreement; that agreement is recorded as
 * provenance, not treated as authentication. Every accepted record therefore remains private and
 * pending manual screening before it can enter a training or evaluation set.
 */
export function createCaptureIngestHandler({
  getEnvironment,
  putPrivateBlob,
}: CaptureIngestHandlerDependencies): (request: Request) => Promise<Response> {
  return async function captureIngest(request: Request): Promise<Response> {
    const environment = getEnvironment();
    const accessMode = resolveCaptureIngestAccessMode(environment);
    const configured = isCaptureIngestConfigured(environment);
    if (request.method === 'GET') {
      return json(
        {
          configured,
          maxImageBytes: MAX_CAPTURE_IMAGE_BYTES,
          maxJsonBytes: MAX_CAPTURE_JSON_BYTES,
        },
        configured ? 200 : 503,
      );
    }
    if (request.method !== 'PUT') {
      return json(
        { error: 'Use GET to check storage or PUT to save one approved capture file.' },
        405,
        {
          Allow: 'GET, PUT',
        },
      );
    }
    if (!configured || accessMode === null) {
      return json(
        {
          error:
            'Private capture storage is not configured for this Data Lab deployment. Capture remains disabled.',
        },
        503,
      );
    }

    // Same-origin is a second boundary against cross-site browser writes. Development consent is
    // deliberately not an identity or anti-abuse mechanism, so it additionally requires an Origin
    // header from the browser. Neither check turns an open development collector into public auth.
    if (!isSameOriginBrowserRequest(request, accessMode === DEVELOPMENT_CONSENT_ACCESS_MODE)) {
      return json({ error: 'Private capture saves must come from this Darts 180 site.' }, 403);
    }

    const captureId = request.headers.get('X-Darts180-Capture-Id') ?? '';
    const recordId = request.headers.get('X-Darts180-Record-Id') ?? '';
    const requestedKind = request.headers.get('X-Darts180-Asset-Kind');
    if (!isCaptureVaultAssetKind(requestedKind)) {
      return json({ error: 'That private capture asset type is not allowed.' }, 400);
    }
    const declaredLength = request.headers.get('content-length');
    const maximum = requestedKind === 'image' ? MAX_CAPTURE_IMAGE_BYTES : MAX_CAPTURE_JSON_BYTES;
    if (
      declaredLength !== null &&
      (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maximum)
    ) {
      return json({ error: 'This private capture file exceeds the allowed size.' }, 413);
    }

    let raw: ArrayBuffer;
    try {
      raw = await readBoundedBody(request, maximum);
    } catch (error) {
      return json(
        {
          error:
            error instanceof RequestBodyLimitError
              ? 'This private capture file exceeds the allowed size.'
              : 'This private capture file could not be read.',
        },
        error instanceof RequestBodyLimitError ? 413 : 400,
      );
    }
    const bytes = new Uint8Array(raw);

    let asset: ReturnType<typeof validateCaptureIngestAsset>;
    try {
      asset = validateCaptureIngestAsset(
        {
          captureId,
          recordId,
          kind: requestedKind,
          contentType: request.headers.get('content-type'),
        },
        bytes,
      );
    } catch (error) {
      return json(
        { error: policyMessage(error) },
        error instanceof CaptureIngestPolicyError ? 400 : 500,
      );
    }

    try {
      await putPrivateBlob(asset.pathname, raw, {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: asset.contentType,
        // Private objects are not exposed by this app, but keep any dashboard-mediated browser cache
        // short for a future controlled export workflow.
        cacheControlMaxAge: 60,
      });
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError || isNamedPreconditionError(error)) {
        return json(
          {
            error:
              'This private record asset already exists. Do not upload a different file under the same record.',
          },
          409,
        );
      }
      // Blob SDK errors can mention infrastructure or credential details. Keep those on the server.
      return json(
        {
          error:
            'Private storage could not confirm this file. Keep this tab open and retry only this file.',
        },
        502,
      );
    }

    return json({
      captureId,
      recordId,
      kind: requestedKind,
      bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  };
}

const captureIngest = createCaptureIngestHandler({
  getEnvironment: () => ({
    accessMode: process.env.DARTS180_CAPTURE_ACCESS_MODE,
    // @vercel/blob resolves Vercel's rotating runtime OIDC token from the Function request context.
    // The store ID is the deliberate configuration signal; this route never handles a Blob credential.
    blobStoreId: process.env.BLOB_STORE_ID,
  }),
  putPrivateBlob: (pathname, body, options) => put(pathname, body, options),
});

// Vercel's Web Standard Function contract invokes this Fetch handler without Node body parsing.
export default { fetch: captureIngest };

class RequestBodyLimitError extends Error {
  constructor() {
    super('Request body exceeded the configured limit.');
    this.name = 'RequestBodyLimitError';
  }
}

async function readBoundedBody(request: Request, maximumBytes: number): Promise<ArrayBuffer> {
  if (request.body === null) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumBytes) {
        try {
          await reader.cancel();
        } catch {
          // The byte limit is still authoritative even if the remote stream has already closed.
        }
        throw new RequestBodyLimitError();
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

function isSameOriginBrowserRequest(request: Request, requireOrigin: boolean): boolean {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite === 'cross-site') return false;
  const origin = request.headers.get('origin');
  if (origin === null) return !requireOrigin;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function isNamedPreconditionError(error: unknown): boolean {
  return error instanceof Error && error.name === 'BlobPreconditionFailedError';
}

function policyMessage(error: unknown): string {
  if (error instanceof CaptureIngestPolicyError) return error.message;
  return 'Private capture validation could not complete.';
}

function json(
  body: Record<string, unknown>,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}
