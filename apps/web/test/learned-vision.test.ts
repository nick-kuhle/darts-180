import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  BoardLandmarkObservation,
  DartTipObservation,
  ModelQualityObservation,
  VisionModelArtifactManifest,
} from '@darts-180/contracts';
import { formatZone } from '@darts-180/rules';

import { deriveBoardPose, mapDartTipToBoard } from '../src/lib/learnedVision/boardPose.js';
import { CanonicalDartTracker } from '../src/lib/learnedVision/dartTracker.js';
import { CaptureEventGate, createLumaFrame } from '../src/lib/learnedVision/eventGate.js';
import { decodeModelOutputs } from '../src/lib/learnedVision/modelOutputDecoder.js';
import { LearnedVisionEngine } from '../src/lib/learnedVision/learnedVisionEngine.js';
import {
  isRunnableModelManifest,
  parseModelManifest,
  UNAVAILABLE_MODEL_MANIFEST,
} from '../src/lib/learnedVision/modelManifest.js';
import { createLearnedScoringProposal, rankZones } from '../src/lib/learnedVision/scoreProposal.js';

const quality: ModelQualityObservation = {
  overall: 0.99,
  boardCoverage: 0.99,
  sharpness: 0.95,
  glareRisk: 0.05,
  occlusionRisk: 0.02,
  offAxisDegrees: 15,
  boardDiameterPixels: 680,
  reasons: [],
};

const landmarks: readonly BoardLandmarkObservation[] = [
  { kind: 'bull', imagePoint: { xPx: 500, yPx: 500 }, confidence: 0.99 },
  { kind: 'd20-double', imagePoint: { xPx: 500, yPx: 168 }, confidence: 0.99 },
  { kind: 'd6-double', imagePoint: { xPx: 832, yPx: 500 }, confidence: 0.99 },
  { kind: 'd3-double', imagePoint: { xPx: 500, yPx: 832 }, confidence: 0.99 },
  { kind: 'd11-double', imagePoint: { xPx: 168, yPx: 500 }, confidence: 0.99 },
  { kind: 'outer-top', imagePoint: { xPx: 500, yPx: 160 }, confidence: 0.99 },
  { kind: 'outer-right', imagePoint: { xPx: 840, yPx: 500 }, confidence: 0.99 },
  { kind: 'outer-bottom', imagePoint: { xPx: 500, yPx: 840 }, confidence: 0.99 },
  { kind: 'outer-left', imagePoint: { xPx: 160, yPx: 500 }, confidence: 0.99 },
];

const productionManifest: VisionModelArtifactManifest = {
  schemaVersion: 2,
  modelId: 'darts180-board-tip',
  modelVersion: 'test-production-v1',
  releaseStage: 'production',
  assetPath: '/models/test-production-v1.onnx',
  sha256: 'a'.repeat(64),
  runtime: 'onnxruntime-web',
  input: { width: 1024, height: 1024, colorOrder: 'rgb', normalization: 'zero-to-one' },
  outputContract: 'darts180-board-tip-v1',
  outputs: { landmarks: 'board_landmarks', dartTips: 'dart_tips', quality: 'quality' },
  decisionPolicy: {
    autoRecordEnabled: true,
    minAutoScoreProbability: 0.97,
    minAutoScoreWireMarginMm: 1.5,
    minReviewProbability: 0.45,
    minZonePosteriorMargin: 0.08,
    minLandmarkConfidence: 0.45,
    maxPoseValidationResidualMm: 18,
    maxQualityOffAxisDegrees: 65,
    minBoardDiameterPixels: 480,
    minOverallQuality: 0.7,
    minBoardCoverage: 0.8,
    minSharpness: 0.7,
    maxGlareRisk: 0.45,
    maxOcclusionRisk: 0.5,
    tipTrackMatchDistanceMm: 12,
    tipTrackSettleMs: 320,
    tipTrackStaleAfterMs: 1200,
    maxTipTrackSpreadMm: 4,
    confidenceTemperature: 1,
    confidenceBias: 0,
    heldOutEvaluationId: 'sacred-eval-test-v1',
  },
  provenance: {
    trainingDataId: 'consented-data-test-v1',
    licenseReviewId: 'license-review-test-v1',
    evaluatedAt: '2026-09-08T00:00:00.000Z',
  },
  releaseEvidence: {
    attestationPath: '/models/test-production-v1.attestation.json',
    attestationSha256: 'c'.repeat(64),
    approvalId: 'approval-test-v1',
  },
};

const productionPoseGate = {
  minLandmarkConfidence: productionManifest.decisionPolicy.minLandmarkConfidence,
  maxPoseValidationResidualMm: productionManifest.decisionPolicy.maxPoseValidationResidualMm,
};

function dartTip(xPx: number, yPx: number): DartTipObservation {
  return {
    imagePoint: { xPx, yPx },
    sigmaXPx: 1.2,
    sigmaYPx: 1.2,
    confidence: 0.995,
    occlusionRisk: 0.01,
  };
}

test('model manifest binds automatic scoring to calibrated quality, provenance, and a release attestation', () => {
  assert.equal(isRunnableModelManifest(UNAVAILABLE_MODEL_MANIFEST), false);
  assert.throws(
    () =>
      parseModelManifest({
        ...productionManifest,
        provenance: { ...productionManifest.provenance, evaluatedAt: null },
      }),
    /Production model manifests require held-out evaluation/,
  );
  assert.throws(
    () =>
      parseModelManifest({
        ...productionManifest,
        releaseEvidence: { ...productionManifest.releaseEvidence, approvalId: null },
      }),
    /Release attestation and approval ID must be supplied together/,
  );
  assert.throws(
    () =>
      parseModelManifest({
        ...productionManifest,
        releaseEvidence: { attestationPath: null, attestationSha256: null, approvalId: null },
      }),
    /Production model manifests require a hash-bound release attestation/,
  );
  assert.throws(
    () =>
      parseModelManifest({
        ...productionManifest,
        decisionPolicy: { ...productionManifest.decisionPolicy, minSharpness: 1.1 },
      }),
    /minSharpness must be a finite probability/,
  );
  assert.throws(
    () =>
      parseModelManifest({
        ...productionManifest,
        decisionPolicy: { ...productionManifest.decisionPolicy, tipTrackStaleAfterMs: 100 },
      }),
    /Tip-track stale interval cannot be shorter/,
  );
  assert.throws(
    () =>
      parseModelManifest({
        ...productionManifest,
        releaseStage: 'development',
        releaseEvidence: { attestationPath: null, attestationSha256: null, approvalId: null },
      }),
    /Only a production model manifest/,
  );
  assert.throws(
    () => parseModelManifest({ ...productionManifest, assetPath: '/models/../outside.onnx' }),
    /same-origin asset/,
  );
  assert.throws(
    () => parseModelManifest({ ...productionManifest, assetPath: '/models//outside.onnx' }),
    /same-origin asset/,
  );
  assert.throws(
    () => parseModelManifest({ ...productionManifest, assetPath: '/models/' }),
    /same-origin asset/,
  );
  assert.throws(
    () =>
      parseModelManifest({
        ...productionManifest,
        input: { ...productionManifest.input, height: 768 },
      }),
    /dimensions must be equal whole pixels/,
  );
  assert.equal(isRunnableModelManifest(productionManifest), true);
});

test('learned named anchors produce an oriented automatic calibration and map an entry point', () => {
  const pose = deriveBoardPose(landmarks, quality, 1_000, productionPoseGate);
  assert.notEqual(pose, null);
  if (pose === null) return;
  assert.ok(pose.bullResidualMm !== null && pose.bullResidualMm < 0.01);
  const mapped = mapDartTipToBoard(dartTip(500, 296), pose.calibration.imageToBoardHomography);
  assert.notEqual(mapped, null);
  if (mapped === null) return;
  assert.ok(Math.abs(mapped.point.xMm) < 0.1);
  assert.ok(Math.abs(mapped.point.yMm + 102) < 0.1);
});

test('pose refuses anchors that conflict with independently learned board landmarks', () => {
  const inconsistentBull = landmarks.map((landmark) =>
    landmark.kind === 'bull' ? { ...landmark, imagePoint: { xPx: 700, yPx: 700 } } : landmark,
  );
  assert.equal(deriveBoardPose(inconsistentBull, quality, 1_000, productionPoseGate), null);

  const inconsistentOuter = landmarks.map((landmark) =>
    landmark.kind === 'outer-top' ? { ...landmark, imagePoint: { xPx: 500, yPx: 500 } } : landmark,
  );
  assert.equal(deriveBoardPose(inconsistentOuter, quality, 1_000, productionPoseGate), null);

  const noReliableBull = landmarks.map((landmark) =>
    landmark.kind === 'bull' ? { ...landmark, confidence: 0.1 } : landmark,
  );
  assert.equal(deriveBoardPose(noReliableBull, quality, 1_000, productionPoseGate), null);

  const noReliableOuter = landmarks.map((landmark) =>
    landmark.kind === 'outer-left' ? { ...landmark, confidence: 0.1 } : landmark,
  );
  assert.equal(deriveBoardPose(noReliableOuter, quality, 1_000, productionPoseGate), null);
  assert.equal(
    deriveBoardPose(landmarks, { ...quality, glareRisk: Number.NaN }, 1_000, productionPoseGate),
    null,
  );
  assert.equal(deriveBoardPose(landmarks, quality, Number.NaN, productionPoseGate), null);
});

test('canonical uncertainty ranking preserves wire ambiguity and automatic policy is model-gated', () => {
  const pose = deriveBoardPose(landmarks, quality, 2_000, productionPoseGate);
  assert.notEqual(pose, null);
  if (pose === null) return;
  const mapped = mapDartTipToBoard(dartTip(500, 296), pose.calibration.imageToBoardHomography);
  assert.notEqual(mapped, null);
  if (mapped === null) return;

  const automatic = createLearnedScoringProposal({
    model: productionManifest,
    calibration: pose.calibration,
    tip: dartTip(500, 296),
    boardPoint: mapped.point,
    uncertainty: mapped.uncertainty,
    frameTimestampMs: 2_000,
  });
  assert.equal(automatic.disposition, 'auto-score');
  assert.equal(formatZone(automatic.candidates[0]!.zone), 'T20');

  const nearWire = createLearnedScoringProposal({
    model: productionManifest,
    calibration: pose.calibration,
    tip: dartTip(500, 302),
    boardPoint: { xMm: 0, yMm: -99.1 },
    uncertainty: { sigmaXMm: 1.6, sigmaYMm: 1.6 },
    frameTimestampMs: 2_200,
  });
  assert.equal(nearWire.disposition, 'review');
  assert.match(nearWire.reasons.join(' '), /too close to a scoring wire/);

  const development = createLearnedScoringProposal({
    model: {
      ...productionManifest,
      releaseStage: 'development',
      decisionPolicy: { ...productionManifest.decisionPolicy, autoRecordEnabled: false },
    },
    calibration: pose.calibration,
    tip: dartTip(500, 296),
    boardPoint: mapped.point,
    uncertainty: mapped.uncertainty,
    frameTimestampMs: 2_400,
  });
  assert.equal(development.disposition, 'review');
  assert.match(development.reasons.join(' '), /not approved/);

  const poorFocus = createLearnedScoringProposal({
    model: productionManifest,
    calibration: {
      ...pose.calibration,
      quality: { ...pose.calibration.quality, sharpness: 0.2 },
    },
    tip: dartTip(500, 296),
    boardPoint: mapped.point,
    uncertainty: mapped.uncertainty,
    frameTimestampMs: 2_500,
  });
  assert.equal(poorFocus.disposition, 'abstain');
  assert.match(poorFocus.reasons.join(' '), /focus/);

  const malformedQuality = createLearnedScoringProposal({
    model: productionManifest,
    calibration: {
      ...pose.calibration,
      quality: { ...pose.calibration.quality, glareRisk: Number.NaN },
    },
    tip: dartTip(500, 296),
    boardPoint: mapped.point,
    uncertainty: mapped.uncertainty,
    frameTimestampMs: 2_550,
  });
  assert.equal(malformedQuality.disposition, 'abstain');
  assert.match(malformedQuality.reasons.join(' '), /quality output is invalid/);

  const occludedTip = createLearnedScoringProposal({
    model: productionManifest,
    calibration: pose.calibration,
    tip: { ...dartTip(500, 296), occlusionRisk: 0.9 },
    boardPoint: mapped.point,
    uncertainty: mapped.uncertainty,
    frameTimestampMs: 2_575,
  });
  assert.equal(occludedTip.disposition, 'abstain');
  assert.match(occludedTip.reasons.join(' '), /too occluded/);

  const possibleMiss = createLearnedScoringProposal({
    model: productionManifest,
    calibration: pose.calibration,
    tip: dartTip(500, 296),
    boardPoint: { xMm: 0, yMm: -176 },
    uncertainty: { sigmaXMm: 0.6, sigmaYMm: 0.6 },
    frameTimestampMs: 2_600,
  });
  assert.notEqual(possibleMiss.disposition, 'auto-score');
  assert.match(possibleMiss.reasons.join(' '), /possible miss/);

  const ambiguous = rankZones({ xMm: 0, yMm: -99.2 }, { sigmaXMm: 2.5, sigmaYMm: 2.5 });
  assert.ok(ambiguous.length >= 2);
});

test('semantic tip tracker settles only consistent learned points and retires vanished tracks', () => {
  const tracker = new CanonicalDartTracker({ settleMs: 300, staleAfterMs: 500 });
  const observation = (atMs: number, xMm = 0) => ({
    tip: dartTip(500, 296),
    boardPointMm: { xMm, yMm: -102 },
    uncertaintyMm: { sigmaXMm: 0.7, sigmaYMm: 0.7 },
    frameTimestampMs: atMs,
  });
  let tracks = tracker.observe([observation(0)], 0);
  assert.equal(tracks[0]?.isSettled, false);
  tracks = tracker.observe([observation(360, 1)], 360);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0]?.isSettled, true);
  tracker.markProposed(tracks[0]!.trackId);
  assert.equal(tracker.snapshot()[0]?.proposed, true);
  tracks = tracker.observe([], 900);
  assert.equal(tracks.length, 0);
});

test('temporal event gate supplies timing only and emits no board coordinates', () => {
  const gate = new CaptureEventGate({
    motionFraction: 0.1,
    disturbanceFraction: 0.8,
    settleMs: 200,
    lumaDelta: 20,
  });
  const rgba = (left: number, right: number) =>
    new Uint8ClampedArray([left, left, left, 255, right, right, right, 255]);
  assert.equal(gate.observe(createLumaFrame(rgba(10, 10), 2, 1, 0)), 'none');
  assert.equal(gate.observe(createLumaFrame(rgba(100, 10), 2, 1, 30)), 'motion-started');
  assert.equal(gate.observe(createLumaFrame(rgba(100, 10), 2, 1, 250)), 'settled-after-motion');
  gate.reset();
  assert.equal(gate.observe(createLumaFrame(rgba(10, 10), 2, 1, 0)), 'none');
  assert.equal(gate.observe(createLumaFrame(rgba(100, 100), 2, 1, 30)), 'camera-disturbed');
});

test('strict model decoder restores source coordinates and preserves learned tip occlusion', () => {
  const decoded = decodeModelOutputs(
    {
      landmarks: new Float32Array([
        0.5, 0.5, 0.99, 0.5, 0.3, 0.99, 0.8, 0.5, 0.99, 0.5, 0.7, 0.99, 0.2, 0.5, 0.99, 0.5, 0.25,
        0.9, 0.95, 0.5, 0.9, 0.5, 0.75, 0.9, 0.05, 0.5, 0.9,
      ]),
      dartTips: new Float32Array([0.5, 0.5, 0.95, 0.01, 0.02, 0.18, 0, 0, 0, 0, 0, 0]),
      quality: new Float32Array([0.9, 0.9, 0.8, 0.1, 0.2, 0.05]),
    },
    {
      sourceWidth: 1920,
      sourceHeight: 1080,
      inputWidth: 1024,
      inputHeight: 1024,
      scaleX: 1024 / 1920,
      scaleY: 576 / 1080,
      offsetX: 0,
      offsetY: 224,
    },
  );
  assert.equal(decoded.landmarks.length, 9);
  assert.equal(decoded.dartTips.length, 1);
  assert.ok(Math.abs(decoded.dartTips[0]!.imagePoint.xPx - 960) < 0.01);
  assert.ok(Math.abs(decoded.dartTips[0]!.imagePoint.yPx - 540) < 0.01);
  assert.ok(Math.abs(decoded.dartTips[0]!.sigmaXPx - 19.2) < 0.01);
  assert.ok(Math.abs(decoded.dartTips[0]!.occlusionRisk - 0.18) < 0.00001);
  assert.ok(Math.abs(decoded.quality.offAxisDegrees - 18) < 0.00001);

  const lowConfidenceButContractValid = decodeModelOutputs(
    {
      landmarks: new Float32Array(27),
      dartTips: new Float32Array([0.5, 0.5, 0.0005, 0.01, 0.02, 0.18]),
      quality: new Float32Array([0.9, 0.9, 0.8, 0.1, 0.2, 0.05]),
    },
    {
      sourceWidth: 1920,
      sourceHeight: 1080,
      inputWidth: 1024,
      inputHeight: 1024,
      scaleX: 1024 / 1920,
      scaleY: 576 / 1080,
      offsetX: 0,
      offsetY: 224,
    },
  );
  assert.equal(lowConfidenceButContractValid.dartTips.length, 1);

  assert.throws(
    () =>
      decodeModelOutputs(
        {
          landmarks: new Float32Array(27),
          dartTips: new Float32Array(5),
          quality: new Float32Array(6),
        },
        {
          sourceWidth: 100,
          sourceHeight: 100,
          inputWidth: 100,
          inputHeight: 100,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: 0,
        },
      ),
    /dart-tip output/,
  );
  assert.throws(
    () =>
      decodeModelOutputs(
        {
          landmarks: new Float32Array(27),
          dartTips: new Float32Array(6),
          quality: new Float32Array([Number.NaN, 0, 0, 0, 0, 0]),
        },
        {
          sourceWidth: 100,
          sourceHeight: 100,
          inputWidth: 100,
          inputHeight: 100,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: 0,
        },
      ),
    /quality overall/,
  );
  assert.throws(
    () =>
      decodeModelOutputs(
        {
          landmarks: new Float32Array(27),
          dartTips: new Float32Array([1.1, 0.5, 0.9, 0.01, 0.01, 0.1]),
          quality: new Float32Array([0.9, 0.9, 0.9, 0.1, 0.1, 0.1]),
        },
        {
          sourceWidth: 100,
          sourceHeight: 100,
          inputWidth: 100,
          inputHeight: 100,
          scaleX: 1,
          scaleY: 1,
          offsetX: 0,
          offsetY: 0,
        },
      ),
    /dart-tip point/,
  );
});

test('decoder restores rounded letterbox coordinates with independent horizontal and vertical scales', () => {
  const inputWidth = 1024;
  const inputHeight = 1024;
  const sourceWidth = 1000;
  const sourceHeight = 333;
  const drawnHeight = 341;
  const decoded = decodeModelOutputs(
    {
      landmarks: new Float32Array(27),
      dartTips: new Float32Array([0.5, (341 + 170.5) / inputHeight, 0.9, 0.01, 0.01, 0.1]),
      quality: new Float32Array([0.9, 0.9, 0.9, 0.1, 0.1, 0.1]),
    },
    {
      sourceWidth,
      sourceHeight,
      inputWidth,
      inputHeight,
      scaleX: inputWidth / sourceWidth,
      scaleY: drawnHeight / sourceHeight,
      offsetX: 0,
      offsetY: Math.floor((inputHeight - drawnHeight) / 2),
    },
  );
  const tip = decoded.dartTips[0];
  assert.notEqual(tip, undefined);
  assert.ok(Math.abs(tip!.imagePoint.xPx - 500) < 0.001);
  assert.ok(Math.abs(tip!.imagePoint.yPx - 166.5) < 0.001);
  assert.ok(Math.abs(tip!.sigmaXPx - 10) < 0.001);
  assert.ok(Math.abs(tip!.sigmaYPx - 10) < 0.001);
});

test('learned vision engine emits one settled semantic proposal without invoking a pixel heuristic', () => {
  const engine = new LearnedVisionEngine();
  const result = (atMs: number) => ({
    frameTimestampMs: atMs,
    landmarks,
    dartTips: [dartTip(500, 296)],
    quality,
    inferenceMs: 12,
    backend: 'wasm' as const,
  });
  assert.equal(engine.process(result(1_000), productionManifest).proposal, null);
  const settled = engine.process(result(1_400), productionManifest);
  assert.equal(settled.proposal?.disposition, 'auto-score');
  assert.equal(formatZone(settled.proposal?.candidates[0]!.zone!), 'T20');
  assert.equal(engine.process(result(1_600), productionManifest).proposal, null);
});

test('learned vision drops tracked tips when complete board pose is lost', () => {
  const engine = new LearnedVisionEngine();
  const result = (atMs: number) => ({
    frameTimestampMs: atMs,
    landmarks,
    dartTips: [dartTip(500, 296)],
    quality,
    inferenceMs: 12,
    backend: 'wasm' as const,
  });
  assert.equal(engine.process(result(1_000), productionManifest).tracks.length, 1);
  const lostPose = engine.process({ ...result(1_200), landmarks: [] }, productionManifest);
  assert.equal(lostPose.pose, null);
  assert.equal(lostPose.tracks.length, 0);
  const reacquired = engine.process(result(1_600), productionManifest);
  assert.equal(reacquired.proposal, null);
  assert.equal(reacquired.tracks[0]?.observationCount, 1);

  const lostQuality = engine.process(
    { ...result(1_800), quality: { ...quality, sharpness: 0.1 } },
    productionManifest,
  );
  assert.equal(lostQuality.pose, null);
  assert.equal(lostQuality.tracks.length, 0);
  const afterQualityRecovery = engine.process(result(2_200), productionManifest);
  assert.equal(afterQualityRecovery.proposal, null);
  assert.equal(afterQualityRecovery.tracks[0]?.observationCount, 1);
});

test('learned vision resets temporal state when any artifact decision policy changes', () => {
  const engine = new LearnedVisionEngine();
  const result = (atMs: number) => ({
    frameTimestampMs: atMs,
    landmarks,
    dartTips: [dartTip(500, 296)],
    quality,
    inferenceMs: 12,
    backend: 'wasm' as const,
  });
  assert.equal(engine.process(result(1_000), productionManifest).tracks[0]?.observationCount, 1);
  const changedPolicy = {
    ...productionManifest,
    decisionPolicy: { ...productionManifest.decisionPolicy, minSharpness: 0.9 },
  };
  const afterChange = engine.process(result(1_400), changedPolicy);
  assert.equal(afterChange.proposal, null);
  assert.equal(afterChange.tracks[0]?.observationCount, 1);
});

test('learned vision does not track a materially occluded dart tip', () => {
  const engine = new LearnedVisionEngine();
  const result = (atMs: number, occlusionRisk: number) => ({
    frameTimestampMs: atMs,
    landmarks,
    dartTips: [{ ...dartTip(500, 296), occlusionRisk }],
    quality,
    inferenceMs: 12,
    backend: 'wasm' as const,
  });
  const occluded = engine.process(result(1_000, 0.9), productionManifest);
  assert.equal(occluded.blockedTipCount, 1);
  assert.equal(occluded.tracks.length, 0);
  assert.equal(occluded.proposal, null);

  const firstClear = engine.process(result(1_400, 0.01), productionManifest);
  assert.equal(firstClear.blockedTipCount, 0);
  assert.equal(firstClear.tracks[0]?.observationCount, 1);
  assert.equal(firstClear.proposal, null);

  const secondClear = engine.process(result(1_800, 0.01), productionManifest);
  assert.equal(secondClear.tracks[0]?.observationCount, 2);
  assert.notEqual(secondClear.proposal, null);
});
