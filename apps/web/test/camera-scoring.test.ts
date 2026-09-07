import assert from 'node:assert/strict';
import test from 'node:test';

import { makeZone } from '@darts-180/rules';

import {
  analyzeDartDifference,
  assessBoardFitCalibration,
  assessGuidedCalibration,
  candidateFromManualPoint,
  selectAutomaticTipCandidate,
  type CameraFrame,
  type DartTipCandidate,
} from '../src/lib/cameraScoring.js';
import { solveImageToBoardHomography, type ImagePoint } from '../src/lib/annotationGeometry.js';

const WIDTH = 720;
const HEIGHT = 720;
const anchors: ImagePoint[] = [
  { x: 360, y: 80 },
  { x: 640, y: 360 },
  { x: 360, y: 640 },
  { x: 80, y: 360 },
];
const boardPoints = [
  { xMm: 0, yMm: -166 },
  { xMm: 166, yMm: 0 },
  { xMm: 0, yMm: 166 },
  { xMm: -166, yMm: 0 },
];

function calibration() {
  const value = solveImageToBoardHomography(anchors, boardPoints);
  assert.notEqual(value, null);
  assert.ok(value !== null);
  return value;
}

function makeFrame(width = WIDTH, height = HEIGHT, fill = 185): CameraFrame {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba[offset] = fill;
    rgba[offset + 1] = fill;
    rgba[offset + 2] = fill;
    rgba[offset + 3] = 255;
  }
  return { width, height, rgba, capturedAtMs: 1_000 };
}

function drawDarkLine(frame: CameraFrame, x: number, startY: number, endY: number, thickness = 5) {
  for (let y = startY; y <= endY; y += 1) {
    for (
      let xOffset = -Math.floor(thickness / 2);
      xOffset <= Math.floor(thickness / 2);
      xOffset += 1
    ) {
      setPixel(frame, x + xOffset, y, 20);
    }
  }
}

function drawCompactFlight(
  frame: CameraFrame,
  centerX: number,
  centerY: number,
  radius = 9,
  value = 166,
) {
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      if (Math.hypot(x - centerX, y - centerY) <= radius) setPixel(frame, x, y, value);
    }
  }
}

function adjustExposure(frame: CameraFrame, gain: number, offset: number) {
  for (let index = 0; index < frame.rgba.length; index += 4) {
    frame.rgba[index] = Math.round(Math.min(255, frame.rgba[index]! * gain + offset));
    frame.rgba[index + 1] = Math.round(Math.min(255, frame.rgba[index + 1]! * gain + offset));
    frame.rgba[index + 2] = Math.round(Math.min(255, frame.rgba[index + 2]! * gain + offset));
  }
}

function drawCheckerboard(frame: CameraFrame) {
  for (let y = 80; y < 640; y += 1) {
    for (let x = 80; x < 640; x += 1) {
      setPixel(frame, x, y, (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0 ? 135 : 230);
    }
  }
}

function drawLargeChangedBlock(frame: CameraFrame) {
  for (let y = 100; y < 620; y += 1) {
    for (let x = 100; x < 620; x += 1) setPixel(frame, x, y, 20);
  }
}

function setPixel(frame: CameraFrame, x: number, y: number, value: number) {
  if (x < 0 || x >= frame.width || y < 0 || y >= frame.height) return;
  const offset = (y * frame.width + x) * 4;
  frame.rgba[offset] = value;
  frame.rgba[offset + 1] = value;
  frame.rgba[offset + 2] = value;
}

test('reports no change when the settled frame matches the clear-board reference', () => {
  const reference = makeFrame();
  const current = makeFrame();
  const result = analyzeDartDifference(reference, current, calibration(), {
    boardDiameterPixels: 570,
  });

  assert.equal(result.status, 'no-change');
  assert.equal(result.candidates.length, 0);
  assert.equal(result.changedPixels, 0);
});

test('finds reviewable endpoint candidates for a newly visible elongated change', () => {
  const reference = makeFrame();
  const current = makeFrame();
  drawDarkLine(current, 360, 190, 390);

  const result = analyzeDartDifference(reference, current, calibration(), {
    boardDiameterPixels: 570,
  });

  assert.equal(result.status, 'dart-candidate');
  assert.ok(result.shapes.length >= 1);
  assert.ok(result.candidates.length >= 1);
  assert.ok(result.candidates.every((candidate) => candidate.confidence > 0));
  assert.ok(result.candidates.every((candidate) => candidate.tipLikelihood > 0));
  assert.ok(result.candidates.some((candidate) => candidate.zone.score >= 0));
  const selected = selectAutomaticTipCandidate(result.candidates);
  assert.notEqual(selected, null);
  assert.ok(selected !== null);
  assert.ok(result.candidates.some((candidate) => candidate.id === selected.id));
});

test('finds a subtle compact flight change for a near-centreline camera view', () => {
  const reference = makeFrame(720, 720, 110);
  const current = makeFrame(720, 720, 110);
  // Deliberately below the old 22-level floor: a front-on flight/occlusion need not look like a
  // high-contrast elongated shaft to be a useful correctable candidate.
  drawCompactFlight(current, 360, 190, 9, 92);

  const result = analyzeDartDifference(reference, current, calibration(), {
    boardDiameterPixels: 570,
  });
  assert.equal(result.status, 'dart-candidate');
  const selected = selectAutomaticTipCandidate(result.candidates);
  assert.ok(selected !== null);
  assert.equal(selected?.endpoint, 'center');
  assert.equal(selected?.directionEvidence, 'compact-local-change');
  assert.ok((selected?.confidence ?? 1) < 0.7);
});

test('keeps a compact dart proposal through modest global exposure drift', () => {
  const reference = makeFrame();
  const current = makeFrame();
  drawCheckerboard(reference);
  drawCheckerboard(current);
  adjustExposure(current, 1.08, 4);
  drawCompactFlight(current, 360, 190, 9, 60);

  const result = analyzeDartDifference(reference, current, calibration(), {
    boardDiameterPixels: 570,
  });
  assert.equal(result.status, 'dart-candidate');
  assert.ok(result.changedFraction < 0.02);
});

test('manual visible-tip selection maps through the same canonical scorer', () => {
  const candidate = candidateFromManualPoint({ x: 360, y: 190 }, calibration());
  assert.notEqual(candidate, null);
  assert.ok(candidate !== null);
  assert.deepEqual(candidate.zone, makeZone('T', 20));
  assert.equal(candidate.tipLikelihood, 1);
  assert.ok(candidate.boardPoint.yMm < -90);
});

test('automatic candidate choice prefers board-direction evidence, then endpoint shape cue', () => {
  const base: Omit<DartTipCandidate, 'id' | 'tipLikelihood' | 'directionEvidence'> = {
    shapeId: 'shape-1',
    endpoint: 'A',
    imagePoint: { x: 350, y: 220 },
    boardPoint: { xMm: -6, yMm: -82 },
    zone: makeZone('S', 20),
    wireMarginMm: 3.2,
    confidence: 0.52,
  };
  const ambiguousWideEnd: DartTipCandidate = {
    ...base,
    id: 'ambiguous-wide-end',
    tipLikelihood: 0.91,
    directionEvidence: 'ambiguous-endpoint',
  };
  const containedEnd: DartTipCandidate = {
    ...base,
    id: 'contained-end',
    tipLikelihood: 0.42,
    directionEvidence: 'only-endpoint-on-board',
  };
  assert.equal(selectAutomaticTipCandidate([ambiguousWideEnd, containedEnd])?.id, 'contained-end');

  const lowerShapeCue: DartTipCandidate = {
    ...base,
    id: 'lower-shape-cue',
    tipLikelihood: 0.36,
    directionEvidence: 'ambiguous-endpoint',
  };
  assert.equal(
    selectAutomaticTipCandidate([lowerShapeCue, ambiguousWideEnd])?.id,
    'ambiguous-wide-end',
  );
});

test('rejects comparisons when camera resolution changes after reference capture', () => {
  const result = analyzeDartDifference(makeFrame(), makeFrame(640, 640), calibration());
  assert.equal(result.status, 'incompatible-frame');
});

test('rejects a large frame-wide change as camera movement or a hand in view', () => {
  const reference = makeFrame();
  const current = makeFrame();
  drawLargeChangedBlock(current);

  const result = analyzeDartDifference(reference, current, calibration(), {
    boardDiameterPixels: 570,
  });
  assert.equal(result.status, 'camera-moved-or-hand-present');
});

test('guided quality accepts a sharp, adequately sized straight-on board', () => {
  const frame = makeFrame();
  drawCheckerboard(frame);
  const quality = assessGuidedCalibration(anchors, frame);
  assert.equal(quality.pass, true);
  assert.ok(quality.boardDiameterPixels >= 480);
  assert.ok(quality.sharpness >= 7);
});

test('board-fit quality accepts the outer double-wire handles used by Camera Play', () => {
  const frame = makeFrame();
  drawCheckerboard(frame);
  const outerWireHandles: ImagePoint[] = [
    { x: 360, y: 70 },
    { x: 650, y: 360 },
    { x: 360, y: 650 },
    { x: 70, y: 360 },
  ];
  const quality = assessBoardFitCalibration(outerWireHandles, frame);
  assert.equal(quality.pass, true);
  assert.ok(quality.boardDiameterPixels >= 560);
});

test('board-fit quality uses the compressed axis as its resolution floor', () => {
  const frame = makeFrame();
  drawCheckerboard(frame);
  const obliqueHandles: ImagePoint[] = [
    { x: 360, y: 160 },
    { x: 690, y: 360 },
    { x: 360, y: 560 },
    { x: 30, y: 360 },
  ];
  const quality = assessBoardFitCalibration(obliqueHandles, frame);
  assert.equal(quality.pass, false);
  assert.equal(Math.round(quality.boardDiameterPixels), 400);
  assert.ok(quality.blockers.some((blocker) => blocker.includes('at least 480 px')));
});

test('guided quality blocks a board that is too small', () => {
  const smallAnchors: ImagePoint[] = [
    { x: 100, y: 80 },
    { x: 180, y: 160 },
    { x: 100, y: 240 },
    { x: 20, y: 160 },
  ];
  const quality = assessGuidedCalibration(smallAnchors, makeFrame(320, 320));
  assert.equal(quality.pass, false);
  assert.ok(quality.blockers.some((blocker) => blocker.includes('at least 480 px')));
});
