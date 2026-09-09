import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

test('normal Camera Play selects only learned runtime paths, never the retired color/difference scorer', () => {
  const app = source('../src/App.tsx');
  const router = source('../src/components/CameraPlayRouter.tsx');
  const productionCamera = source('../src/components/LearnedCameraPlay.tsx');
  const developmentCamera = source('../src/components/DeepDartsDevelopmentCameraPlay.tsx');

  assert.match(app, /CameraPlayRouter/);
  assert.match(router, /LearnedCameraPlay/);
  assert.match(router, /DeepDartsDevelopmentCameraPlay/);
  assert.doesNotMatch(app, /SimpleCameraPlay|CameraScoringLab/);
  assert.doesNotMatch(
    `${productionCamera}\n${developmentCamera}`,
    /cameraScoring|autoBoardFit|boardFit|startPlayReferenceCapture/,
  );
});
