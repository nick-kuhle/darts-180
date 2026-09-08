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
];

const productionManifest: VisionModelArtifactManifest = {
  schemaVersion: 1,
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
    maxQualityOffAxisDegrees: 65,
    minBoardDiameterPixels: 480,
    minOverallQuality: 0.7,
    maxOcclusionRisk: 0.5,
    confidenceTemperature: 1,
    confidenceBias: 0,
    heldOutEvaluationId: 'sacred-eval-test-v1',
  },
  provenance: {
    trainingDataId: 'consented-data-test-v1',
    licenseReviewId: 'license-review-test-v1',
    evaluatedAt: '2026-09-08T00:00:00.000Z',
  },
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

test('model manifest rejects an auto-record model without evidence provenance', () => {
  assert.equal(isRunnableModelManifest(UNAVAILABLE_MODEL_MANIFEST), false);
  assert.throws(
    () =>
      parseModelManifest({
        ...productionManifest,
        provenance: { ...productionManifest.provenance, evaluatedAt: null },
      }),
    /Auto-recording requires held-out evaluation/,
  );
  assert.throws(
    () =>
      parseModelManifest({
        ...productionManifest,
        releaseStage: 'development',
      }),
    /Only a production model manifest/,
  );
  assert.throws(
    () => parseModelManifest({ ...productionManifest, assetPath: '/models/../outside.onnx' }),
    /same-origin asset/,
  );
  assert.equal(isRunnableModelManifest(productionManifest), true);
});

test('learned named anchors produce an oriented automatic calibration and map an entry point', () => {
  const pose = deriveBoardPose(landmarks, quality, 1_000);
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
  assert.equal(deriveBoardPose(inconsistentBull, quality, 1_000), null);

  const inconsistentOuter = [
    ...landmarks,
    { kind: 'outer-top' as const, imagePoint: { xPx: 500, yPx: 500 }, confidence: 0.99 },
  ];
  assert.equal(deriveBoardPose(inconsistentOuter, quality, 1_000), null);

  const noReliableBull = landmarks.map((landmark) =>
    landmark.kind === 'bull' ? { ...landmark, confidence: 0.1 } : landmark,
  );
  assert.equal(deriveBoardPose(noReliableBull, quality, 1_000), null);
});

test('canonical uncertainty ranking preserves wire ambiguity and automatic policy is model-gated', () => {
  const pose = deriveBoardPose(landmarks, quality, 2_000);
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
      scale: 1024 / 1920,
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
          scale: 1,
          offsetX: 0,
          offsetY: 0,
        },
      ),
    /dart-tip output/,
  );
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
