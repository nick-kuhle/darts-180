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

test('the top-level app keeps a consent-gated Data Lab that auto-captures private records with learned suggestions', () => {
  const app = source('../src/App.tsx');
  const lab = source('../src/components/DataLab.tsx');
  const dataLabSuggestions = source('../src/lib/developmentVision/dataLabSuggestions.ts');
  const consent = source('../src/lib/captureConsent.ts');
  const vault = source('../src/lib/captureVault.ts');
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
    lab.indexOf('if (dataLabConsent === null)') < lab.indexOf('<AutoCaptureLab'),
    'the consent return must appear before the auto-capture camera UI is rendered',
  );
  assert.match(lab, /consentAcceptedAt/);
  assert.match(lab, /admissionStatus/);
  assert.match(consent, /DEVELOPMENT-DATA-LAB-CONSENT-V1/);
  assert.match(consent, /consented-development-unreviewed/);

  assert.match(lab, /loadDevelopmentModelManifest/);
  assert.match(lab, /DevelopmentWebInferenceClient/);
  assert.match(lab, /getDevelopmentBrowserVisionSupport/);
  assert.match(lab, /buildDataLabLearnedSuggestions/);
  assert.match(lab, /captureModelFrame/);
  assert.match(lab, /No verified local development model is installed/);

  assert.match(lab, /AUTO_REVIEW_METHOD = 'learned-suggestion-auto-capture-v1'/);
  assert.match(lab, /SETUP_REVIEW_METHOD = 'setup-calibration-auto-capture-v1'/);
  assert.match(lab, /reviewMethod,/);
  assert.match(
    lab,
    /anchorSource === 'setup-calibration' \? SETUP_REVIEW_METHOD : AUTO_REVIEW_METHOD/,
  );
  assert.match(lab, /annotationProvenance/);
  assert.match(dataLabSuggestions, /deriveDeepDartsDevelopmentPose/);
  assert.match(dataLabSuggestions, /DEEPDARTS_CLASS_IDS\.dartEntryPoint/);
  assert.match(dataLabSuggestions, /buildSetupCalibrationSuggestions/);
  assert.doesNotMatch(dataLabSuggestions, /DEVELOPMENT_FIVE_POINT_ANNOTATION_ANCHORS/);

  assert.match(lab, /evaluateAutoCapture/);
  assert.match(lab, /frame\.tracks\.filter\(\(track\) => track\.isSettled\)/);
  assert.match(lab, /void captureStillNow\('empty-board'\)/);
  assert.match(lab, /void captureStillNow\('static-dart'\)/);
  assert.match(lab, /sessionIdRef\.current = newSessionId\(\)/);
  assert.match(lab, /Camera moved · started a new setup session\./);

  assert.match(lab, /setupAffineAnchorImagePoints/);
  assert.match(lab, /processWithPose/);
  assert.match(lab, /poseSignatureFromPose/);
  assert.match(lab, /buildSetupCalibrationSuggestions/);
  assert.match(lab, /CALIBRATE SETUP/);
  assert.match(lab, /LOCK SETUP/);
  assert.match(lab, /<strong>top<\/strong> handle to rotate/);

  assert.match(lab, /uploadPrivateCaptureAsset/);
  assert.match(lab, /getCaptureVaultStatus/);
  assert.match(lab, /void processQueue\(\)/);
  assert.match(vault, /\/api\/capture-ingest/);
  assert.match(vault, /MAX_CAPTURE_IMAGE_BYTES/);

  assert.match(lab, /START AUTO CAPTURE/);
  assert.match(lab, /STOP CAMERA/);
  assert.match(lab, /disabled={busy \|\| !collectionReady}/);
  assert.doesNotMatch(
    lab,
    /NEXT · REVIEW CAMERA SUGGESTIONS|CONFIRM REVIEW · AUTO-SAVE|RETRY LOCAL MODEL|CaptureStep|LabelStep|SaveStep|automaticSaveStartedRef/,
  );
  assert.doesNotMatch(lab, /download/i);
  assert.doesNotMatch(lab, /type="password"/);
  assert.doesNotMatch(
    lab,
    /collectionKey|X-Darts180-Collection-Key|localStorage|sessionStorage|BLOB_READ_WRITE_TOKEN|VITE_BLOB/,
  );

  assert.match(styles, /\.data-lab-consent-card/);
  assert.match(styles, /\.data-lab-auto-grid/);
  assert.match(styles, /\.data-lab-calibration-notice/);
  assert.doesNotMatch(styles, /data-lab-key-input/);
});
