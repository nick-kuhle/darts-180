import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

test('normal Camera Play imports only the learned vision path, never the retired color/difference scorer', () => {
  const app = source('../src/App.tsx');
  const camera = source('../src/components/LearnedCameraPlay.tsx');

  assert.match(app, /LearnedCameraPlay/);
  assert.doesNotMatch(app, /SimpleCameraPlay|CameraScoringLab/);
  assert.doesNotMatch(camera, /cameraScoring|autoBoardFit|boardFit|startPlayReferenceCapture/);
});
