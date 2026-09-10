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
  assert.doesNotMatch(
    `${app}\n${developmentCamera}`,
    /downloadCorrectedDevelopmentEvidence|DOWNLOAD REVIEWED TEST SAMPLES|Save local test evidence/,
  );
});

test('the top-level app keeps a consent-gated Data Lab with genuine optional learned suggestions and automatic private saving', () => {
  const app = source('../src/App.tsx');
  const lab = source('../src/components/DataLab.tsx');
  const dataLabSuggestions = source('../src/lib/developmentVision/dataLabSuggestions.ts');
  const consent = source('../src/lib/captureConsent.ts');
  const developmentCamera = source('../src/components/DeepDartsDevelopmentCameraPlay.tsx');
  const styles = source('../src/styles.css');

  assert.match(app, /LIVE SCORING/);
  assert.match(app, /DATA LAB/);
  assert.match(app, /<DataLab onExit/);
  assert.doesNotMatch(app, /AnnotationLab|CaptureLab/);
  assert.match(lab, /DEVELOPMENT COLLECTION NOTICE/);
  assert.match(lab, /CONTINUE TO DATA LAB/);
  assert.match(lab, /disabled={!checked}/);
  assert.match(lab, /if \(dataLabConsent === null\)/);
  assert.ok(
    lab.indexOf('if (dataLabConsent === null)') < lab.indexOf('<CaptureStep'),
    'the consent return must appear before camera controls are rendered',
  );
  assert.match(lab, /consentAcceptedAt/);
  assert.match(lab, /admissionStatus/);
  assert.match(consent, /DEVELOPMENT-DATA-LAB-CONSENT-V1/);
  assert.match(consent, /consented-development-unreviewed/);
  assert.match(developmentCamera, /trainingDataKind === 'synthetic-only'/);
  assert.match(developmentCamera, /trainingDataKind === 'mixed-synthetic-and-real'/);
  assert.match(developmentCamera, /SYNTHETIC BOOTSTRAP ONLY · NOT VALIDATED ON REAL THROWS/);
  assert.match(developmentCamera, /REVIEWED REAL \+ SIMULATED TRAINING · CHECK EVERY SUGGESTION/);
  assert.match(lab, /loadDevelopmentModelManifest/);
  assert.match(lab, /DevelopmentWebInferenceClient/);
  assert.match(lab, /getDevelopmentBrowserVisionSupport/);
  assert.match(lab, /buildDataLabLearnedSuggestions/);
  assert.match(lab, /hasCompletePose: suggestions\.pose !== null/);
  assert.match(
    lab,
    /Dart-tip suggestions were withheld because the learned anchors did not form a safe complete board pose/,
  );
  const heldStillDeclaration = lab.indexOf('const still: CapturedStill');
  const automaticSuggestionInvocation = lab.indexOf('void runLearnedSuggestions(still)');
  assert.ok(
    heldStillDeclaration >= 0 && automaticSuggestionInvocation > heldStillDeclaration,
    'every successfully held still must begin the local suggestion pass before review',
  );
  assert.match(lab, /suggestionRequestRef/);
  assert.match(lab, /suggestionClientRef/);
  assert.match(lab, /No verified local development model is installed/);
  assert.match(lab, /NEXT · REVIEW CAMERA SUGGESTIONS/);
  assert.match(lab, /CONFIRM REVIEW · AUTO-SAVE/);
  assert.match(lab, /RETRY LOCAL MODEL · REPLACE POINTS/);
  assert.match(lab, /annotationProvenance/);
  assert.match(dataLabSuggestions, /deriveDeepDartsDevelopmentPose/);
  assert.match(dataLabSuggestions, /DEEPDARTS_CLASS_IDS\.dartEntryPoint/);
  assert.doesNotMatch(dataLabSuggestions, /DEVELOPMENT_FIVE_POINT_ANNOTATION_ANCHORS/);
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
  assert.match(styles, /\.data-lab-consent-card/);
  assert.doesNotMatch(styles, /data-lab-key-input/);
});
