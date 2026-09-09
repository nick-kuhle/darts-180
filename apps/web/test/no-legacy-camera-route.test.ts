import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

test('normal Live Scoring selects only learned runtime paths, never the retired color/difference scorer', () => {
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

test('the top-level app keeps manual point labeling inside the separate guided Data Lab', () => {
  const app = source('../src/App.tsx');
  const lab = source('../src/components/DataLab.tsx');

  assert.match(app, /LIVE SCORING/);
  assert.match(app, /DATA LAB/);
  assert.match(app, /DataLab/);
  assert.doesNotMatch(app, /AnnotationLab|CaptureLab/);
  assert.match(lab, /NEXT · TAP THE BOARD POINTS/);
  assert.match(lab, /SAVE TO PRIVATE STORAGE/);
  assert.doesNotMatch(lab, /localStorage|sessionStorage|BLOB_READ_WRITE_TOKEN|VITE_BLOB/);
});
