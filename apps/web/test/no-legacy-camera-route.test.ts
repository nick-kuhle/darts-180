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
  const styles = source('../src/styles.css');

  assert.match(app, /LIVE SCORING/);
  assert.match(app, /DATA LAB/);
  assert.match(app, /DataLab/);
  assert.doesNotMatch(app, /AnnotationLab|CaptureLab/);
  assert.match(lab, /NEXT · TAP THE BOARD POINTS/);
  assert.match(lab, /COMPLETE REVIEW · AUTO-SAVE/);
  assert.match(lab, /saves automatically to the protected/);
  assert.match(lab, /automaticSaveStartedRef\.current = true/);
  assert.match(lab, /automaticUploadAttemptedRecordRef/);
  assert.match(lab, /void uploadPrivateRecord\(\)/);
  assert.match(lab, /disabled={captured !== null \|\| !collectionReady}/);
  assert.doesNotMatch(
    lab,
    /collectionKey|hasUsableCollectionKey|X-Darts180-Collection-Key|DOWNLOAD LOCAL BACKUP|downloadBlob|SAVE TO PRIVATE STORAGE/,
  );
  assert.doesNotMatch(lab, /download/i);
  assert.doesNotMatch(lab, /type="password"/);
  assert.doesNotMatch(lab, /localStorage|sessionStorage|BLOB_READ_WRITE_TOKEN|VITE_BLOB/);
  assert.doesNotMatch(styles, /data-lab-key-input/);
});
