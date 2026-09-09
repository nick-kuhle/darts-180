import assert from 'node:assert/strict';
import test from 'node:test';

import { formatZone } from '@darts-180/rules';

import {
  DEEPDARTS_SOURCE_TO_STANDARD_ROTATION_DEGREES,
  DeepDartsDevelopmentEngine,
  deriveDeepDartsDevelopmentPose,
  rotateSourceCanonicalPoint,
} from '../src/lib/developmentVision/engine.js';
import {
  isRunnableDevelopmentModelManifest,
  parseDevelopmentModelManifest,
} from '../src/lib/developmentVision/modelManifest.js';
import type {
  DeepDartsDetection,
  DeepDartsDevelopmentModelManifest,
} from '../src/lib/developmentVision/types.js';
import { decodeDeepDartsYoloOutput } from '../src/lib/developmentVision/yoloOutputDecoder.js';

const developmentManifest: DeepDartsDevelopmentModelManifest = {
  schemaVersion: 1,
  modelId: 'darts180-deepdarts-yolo',
  modelVersion: 'test-five-point-yolo-v1',
  releaseStage: 'development',
  assetPath: '/models/test-five-point-yolo-v1.onnx',
  sha256: 'b'.repeat(64),
  runtime: 'onnxruntime-web',
  input: {
    width: 640,
    height: 640,
    colorOrder: 'rgb',
    normalization: 'zero-to-one',
    resizeMode: 'stretch',
  },
  output: {
    detections: 'output0',
    layout: 'yolov8-raw-cxcywh-class-scores',
    classCount: 5,
  },
  classMap: {
    dartEntryPoint: 0,
    calibration1: 1,
    calibration2: 2,
    calibration3: 3,
    calibration4: 4,
  },
  policy: {
    minDetectionConfidence: 0.1,
    minDartConfidence: 0.1,
    minCalibrationConfidence: 0.1,
    nmsIouThreshold: 0.45,
    maxDetections: 32,
    tipTrackMatchDistanceMm: 12,
    tipTrackSettleMs: 200,
    tipTrackStaleAfterMs: 1_000,
    maxTipTrackSpreadMm: 4,
  },
  provenance: {
    trainingDataId: 'test-deepdarts-data',
    licenseReviewId: 'test-data-license-review',
    trainedAt: null,
  },
};

const sourceAnchors = [
  { xMm: 0, yMm: -170 },
  { xMm: 0, yMm: 170 },
  { xMm: -170, yMm: 0 },
  { xMm: 170, yMm: 0 },
] as const;

function detection(
  classId: DeepDartsDetection['classId'],
  xPx: number,
  yPx: number,
  confidence = 0.95,
): DeepDartsDetection {
  return {
    classId,
    confidence,
    center: { xPx, yPx },
    widthPx: 20,
    heightPx: 20,
  };
}

function standardToImage(point: { xMm: number; yMm: number }) {
  return { xPx: point.xMm + 400, yPx: point.yMm + 400 };
}

function orientedAnchorDetections(): readonly DeepDartsDetection[] {
  return sourceAnchors.map((source, index) => {
    const image = standardToImage(rotateSourceCanonicalPoint(source));
    return detection((index + 1) as 1 | 2 | 3 | 4, image.xPx, image.yPx);
  });
}

test('five-point development manifest is local, immutable in class roles, and development-only', () => {
  assert.equal(isRunnableDevelopmentModelManifest(developmentManifest), true);
  assert.deepEqual(parseDevelopmentModelManifest(developmentManifest), developmentManifest);
  assert.throws(
    () => parseDevelopmentModelManifest({ ...developmentManifest, releaseStage: 'production' }),
    /development-stage only/,
  );
  assert.throws(
    () =>
      parseDevelopmentModelManifest({
        ...developmentManifest,
        classMap: { ...developmentManifest.classMap, calibration1: 2, calibration2: 1 },
      }),
    /class map must preserve calibration1/,
  );
  assert.throws(
    () =>
      parseDevelopmentModelManifest({
        ...developmentManifest,
        assetPath: 'https://example.com/model.onnx',
      }),
    /same-origin asset path/,
  );
  assert.throws(
    () =>
      parseDevelopmentModelManifest({
        ...developmentManifest,
        policy: { ...developmentManifest.policy, tipTrackStaleAfterMs: 200 },
      }),
    /must exceed/,
  );
});

test('raw YOLOv8 output decodes both exporter layouts, restores stretched source pixels, and NMSes per class', () => {
  const candidateCount = 4;
  const featureMajor = new Float32Array(9 * candidateCount);
  const set = (candidate: number, feature: number, value: number) => {
    featureMajor[feature * candidateCount + candidate] = value;
  };
  // Two overlapping class-0 boxes: only the stronger one survives class-aware NMS.
  for (const [candidate, cx, cy, score0, score1] of [
    [0, 320, 320, 0.9, 0.02],
    [1, 323, 321, 0.8, 0.01],
    [2, 120, 200, 0.01, 0.88],
    [3, 500, 100, 0.01, 0.01],
  ] as const) {
    set(candidate, 0, cx);
    set(candidate, 1, cy);
    set(candidate, 2, 40);
    set(candidate, 3, 40);
    set(candidate, 4, score0);
    set(candidate, 5, score1);
    set(candidate, 6, 0.01);
    set(candidate, 7, 0.01);
    set(candidate, 8, 0.01);
  }
  const transform = {
    sourceWidth: 1280,
    sourceHeight: 720,
    inputWidth: 640,
    inputHeight: 640,
    scaleX: 0.5,
    scaleY: 640 / 720,
  };
  const decoded = decodeDeepDartsYoloOutput(
    { data: featureMajor, dims: [1, 9, candidateCount] },
    transform,
    developmentManifest.policy,
  );
  assert.equal(decoded.length, 2);
  const dart = decoded.find((item) => item.classId === 0);
  assert.notEqual(dart, undefined);
  assert.ok(Math.abs(dart!.center.xPx - 640) < 0.01);
  assert.ok(Math.abs(dart!.center.yPx - 360) < 0.01);
  assert.equal(decoded.filter((item) => item.classId === 1).length, 1);

  const candidateMajor = new Float32Array(candidateCount * 9);
  for (let candidate = 0; candidate < candidateCount; candidate += 1) {
    for (let feature = 0; feature < 9; feature += 1) {
      candidateMajor[candidate * 9 + feature] =
        featureMajor[feature * candidateCount + candidate] ?? 0;
    }
  }
  assert.deepEqual(
    decodeDeepDartsYoloOutput(
      { data: candidateMajor, dims: [1, candidateCount, 9] },
      transform,
      developmentManifest.policy,
    ),
    decoded,
  );
});

test('four semantic DeepDarts anchors create the rotated standard-board frame without synthetic v1 landmarks', () => {
  assert.equal(DEEPDARTS_SOURCE_TO_STANDARD_ROTATION_DEGREES, -9);
  const top = rotateSourceCanonicalPoint(sourceAnchors[0]);
  assert.ok(Math.abs(top.xMm + 26.59) < 0.02);
  assert.ok(Math.abs(top.yMm + 167.91) < 0.02);

  const pose = deriveDeepDartsDevelopmentPose(orientedAnchorDetections(), developmentManifest);
  assert.notEqual(pose, null);
  if (pose === null) return;
  assert.ok(Math.abs(pose.boardDiameterPixels - 340) < 0.02);
  assert.equal(
    deriveDeepDartsDevelopmentPose(orientedAnchorDetections().slice(0, 3), developmentManifest),
    null,
  );
});

test('development engine requires genuine anchors plus a genuine class-0 dart and always emits an editable review suggestion', () => {
  const engine = new DeepDartsDevelopmentEngine();
  const dartPoint = standardToImage({ xMm: 0, yMm: -103 });
  const detections = [...orientedAnchorDetections(), detection(0, dartPoint.xPx, dartPoint.yPx)];
  const result = (frameTimestampMs: number) => ({
    frameTimestampMs,
    detections,
    inferenceMs: 9,
    backend: 'wasm' as const,
  });

  const first = engine.process(result(1_000), developmentManifest);
  assert.notEqual(first.pose, null);
  assert.equal(first.suggestion, null);
  const settled = engine.process(result(1_250), developmentManifest);
  assert.equal(settled.suggestion?.disposition, 'review');
  assert.equal(formatZone(settled.suggestion!.zone), 'T20');
  assert.match(settled.suggestion!.reasons.join(' '), /always editable|Edit or confirm/);
  assert.equal(engine.process(result(1_500), developmentManifest).suggestion, null);

  const noDartEngine = new DeepDartsDevelopmentEngine();
  assert.equal(
    noDartEngine.process(
      { ...result(2_000), detections: orientedAnchorDetections() },
      developmentManifest,
    ).suggestion,
    null,
  );

  const lostPose = engine.process({ ...result(2_000), detections: [] }, developmentManifest);
  assert.equal(lostPose.pose, null);
  assert.equal(lostPose.tracks.length, 0);
});
