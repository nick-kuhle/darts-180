import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

interface VercelConfig {
  installCommand?: string;
  buildCommand?: string;
  outputDirectory?: string;
  headers?: Array<{ headers?: Array<{ key?: string; value?: string }> }>;
}

function readConfig(relativePath: string): VercelConfig {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8')) as VercelConfig;
}

function headersFor(config: VercelConfig): Record<string, string> {
  return Object.fromEntries(
    (config.headers?.[0]?.headers ?? []).flatMap((header) =>
      header.key === undefined || header.value === undefined ? [] : [[header.key, header.value]],
    ),
  );
}

test('apps/web has a self-contained Vercel app-root configuration', () => {
  const config = readConfig('../vercel.json');

  assert.equal(config.installCommand, 'cd ../.. && npm ci');
  assert.equal(config.buildCommand, 'cd ../.. && npm run build --workspace=@darts-180/web');
  assert.equal(config.outputDirectory, 'dist');
  const headers = headersFor(config);
  assert.equal(headers['Permissions-Policy'], 'camera=(self), microphone=(), geolocation=()');
  assert.match(headers['Content-Security-Policy'] ?? '', /mediastream:/);
});

test('repository-root fallback has the same browser camera policy', () => {
  const config = readConfig('../../../vercel.json');
  const headers = headersFor(config);

  assert.equal(headers['Permissions-Policy'], 'camera=(self), microphone=(), geolocation=()');
  assert.match(headers['Content-Security-Policy'] ?? '', /mediastream:/);
});
