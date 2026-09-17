import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveSetupCalibrationAnchorImagePoints,
  DEVELOPMENT_FIVE_POINT_ANNOTATION_ANCHORS,
  invertHomography,
  mapBoardPointToImage,
  mapImagePointToBoard,
  setupAffineAnchorImagePoints,
  solveImageToBoardHomography,
  type CanonicalPoint,
  type ImagePoint,
  type SetupAffineTemplate,
} from '../src/lib/annotationGeometry.js';
import { rotateSourceCanonicalPoint } from '../src/lib/developmentVision/engine.js';

function mapBoardToImage(point: CanonicalPoint): ImagePoint {
  // A non-affine, known canonical-to-image transform used to produce test correspondences.
  const denominator = 0.00035 * point.xMm - 0.0002 * point.yMm + 1;
  return {
    x: (2.2 * point.xMm + 0.18 * point.yMm + 640) / denominator,
    y: (0.12 * point.xMm + 2.0 * point.yMm + 360) / denominator,
  };
}

test('five-point annotation landmarks match the development engine source-frame adapter', () => {
  const sourceAnchors: CanonicalPoint[] = [
    { xMm: 0, yMm: -170 },
    { xMm: 0, yMm: 170 },
    { xMm: -170, yMm: 0 },
    { xMm: 170, yMm: 0 },
  ];
  assert.deepEqual(
    DEVELOPMENT_FIVE_POINT_ANNOTATION_ANCHORS.map((anchor) => anchor.id),
    ['cal1', 'cal2', 'cal3', 'cal4'],
  );
  for (const [index, sourceAnchor] of sourceAnchors.entries()) {
    const expected = rotateSourceCanonicalPoint(sourceAnchor);
    const actual = DEVELOPMENT_FIVE_POINT_ANNOTATION_ANCHORS[index]?.canonical;
    assert.ok(actual !== undefined);
    assert.ok(Math.abs(actual.xMm - expected.xMm) < 0.001);
    assert.ok(Math.abs(actual.yMm - expected.yMm) < 0.001);
  }
});

test('solves four image-to-board correspondences and maps a held-out point', () => {
  const boardPoints: CanonicalPoint[] = [
    { xMm: 0, yMm: -166 },
    { xMm: 166, yMm: 0 },
    { xMm: 0, yMm: 166 },
    { xMm: -166, yMm: 0 },
  ];
  const imagePoints = boardPoints.map(mapBoardToImage);
  const homography = solveImageToBoardHomography(imagePoints, boardPoints);
  assert.notEqual(homography, null);
  assert.ok(homography !== null);

  const expected = { xMm: 31.25, yMm: -72.5 };
  const actual = mapImagePointToBoard(mapBoardToImage(expected), homography);
  assert.notEqual(actual, null);
  assert.ok(actual !== null);
  assert.ok(Math.abs(actual.xMm - expected.xMm) < 0.001);
  assert.ok(Math.abs(actual.yMm - expected.yMm) < 0.001);
});

test('inverts a guide homography so canonical board rings can be drawn over camera pixels', () => {
  const boardPoints: CanonicalPoint[] = [
    { xMm: 0, yMm: -170 },
    { xMm: 170, yMm: 0 },
    { xMm: 0, yMm: 170 },
    { xMm: -170, yMm: 0 },
  ];
  const imagePoints = boardPoints.map(mapBoardToImage);
  const imageToBoard = solveImageToBoardHomography(imagePoints, boardPoints);
  assert.notEqual(imageToBoard, null);
  assert.ok(imageToBoard !== null);
  const boardToImage = invertHomography(imageToBoard);
  assert.notEqual(boardToImage, null);
  assert.ok(boardToImage !== null);

  const expected = { xMm: -73.5, yMm: 42.25 };
  const roundTrip = mapBoardPointToImage(expected, boardToImage);
  assert.notEqual(roundTrip, null);
  assert.ok(roundTrip !== null);
  const actual = mapImagePointToBoard(roundTrip, imageToBoard);
  assert.notEqual(actual, null);
  assert.ok(actual !== null);
  assert.ok(Math.abs(actual.xMm - expected.xMm) < 0.001);
  assert.ok(Math.abs(actual.yMm - expected.yMm) < 0.001);
});

test('rejects degenerate calibration anchors', () => {
  const degenerate: ImagePoint[] = [
    { x: 100, y: 100 },
    { x: 200, y: 100 },
    { x: 300, y: 100 },
    { x: 400, y: 100 },
  ];
  const boardPoints: CanonicalPoint[] = [
    { xMm: 0, yMm: -166 },
    { xMm: 166, yMm: 0 },
    { xMm: 0, yMm: 166 },
    { xMm: -166, yMm: 0 },
  ];
  assert.equal(solveImageToBoardHomography(degenerate, boardPoints), null);
});

test('derives all four calibration anchors from a bull-centred single D5/D20 junction tap', () => {
  const bull: ImagePoint = { x: 640, y: 360 };
  const scale = 2.4;
  const cal1 = DEVELOPMENT_FIVE_POINT_ANNOTATION_ANCHORS[0];
  assert.ok(cal1 !== undefined);
  const junction: ImagePoint = {
    x: bull.x + scale * cal1.canonical.xMm,
    y: bull.y + scale * cal1.canonical.yMm,
  };
  const derived = deriveSetupCalibrationAnchorImagePoints(bull, junction);
  assert.notEqual(derived, null);
  assert.ok(derived !== null);
  assert.equal(derived.length, 4);
  for (const [index, anchor] of DEVELOPMENT_FIVE_POINT_ANNOTATION_ANCHORS.entries()) {
    const point = derived[index];
    assert.ok(point !== undefined);
    assert.ok(Math.abs(point.x - (bull.x + scale * anchor.canonical.xMm)) < 0.001);
    assert.ok(Math.abs(point.y - (bull.y + scale * anchor.canonical.yMm)) < 0.001);
  }
  assert.equal(deriveSetupCalibrationAnchorImagePoints(bull, { x: bull.x + 3, y: bull.y }), null);
});

test('setup calibration honours a rotated board orientation', () => {
  const bull: ImagePoint = { x: 640, y: 360 };
  const scale = 2.4;
  const angle = (25 * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const cal1 = DEVELOPMENT_FIVE_POINT_ANNOTATION_ANCHORS[0];
  assert.ok(cal1 !== undefined);
  const junction: ImagePoint = {
    x: bull.x + scale * (cosine * cal1.canonical.xMm - sine * cal1.canonical.yMm),
    y: bull.y + scale * (sine * cal1.canonical.xMm + cosine * cal1.canonical.yMm),
  };
  const derived = deriveSetupCalibrationAnchorImagePoints(bull, junction);
  assert.notEqual(derived, null);
  assert.ok(derived !== null);
  for (const [index, anchor] of DEVELOPMENT_FIVE_POINT_ANNOTATION_ANCHORS.entries()) {
    const point = derived[index];
    assert.ok(point !== undefined);
    const expectedX =
      bull.x + scale * (cosine * anchor.canonical.xMm - sine * anchor.canonical.yMm);
    const expectedY =
      bull.y + scale * (sine * anchor.canonical.xMm + cosine * anchor.canonical.yMm);
    assert.ok(Math.abs(point.x - expectedX) < 0.001);
    assert.ok(Math.abs(point.y - expectedY) < 0.001);
  }
});

test('fits the four calibration anchors to an independent two-axis board template', () => {
  const template: SetupAffineTemplate = {
    centre: { x: 640, y: 360 },
    scaleX: 2.2,
    scaleY: 2.8,
    rotationRad: 0,
  };
  const derived = setupAffineAnchorImagePoints(template);
  assert.notEqual(derived, null);
  assert.ok(derived !== null);
  assert.equal(derived.length, 4);
  for (const [index, anchor] of DEVELOPMENT_FIVE_POINT_ANNOTATION_ANCHORS.entries()) {
    const point = derived[index];
    assert.ok(point !== undefined);
    assert.ok(Math.abs(point.x - (640 + 2.2 * anchor.canonical.xMm)) < 0.001);
    assert.ok(Math.abs(point.y - (360 + 2.8 * anchor.canonical.yMm)) < 0.001);
  }
});

test('setup template fit honours rotation and both pixel-per-mm axes', () => {
  const template: SetupAffineTemplate = {
    centre: { x: 640, y: 360 },
    scaleX: 2.2,
    scaleY: 2.6,
    rotationRad: (30 * Math.PI) / 180,
  };
  const { centre, scaleX, scaleY, rotationRad } = template;
  const sine = Math.sin(rotationRad);
  const cosine = Math.cos(rotationRad);
  const derived = setupAffineAnchorImagePoints(template);
  assert.notEqual(derived, null);
  assert.ok(derived !== null);
  for (const [index, anchor] of DEVELOPMENT_FIVE_POINT_ANNOTATION_ANCHORS.entries()) {
    const point = derived[index];
    assert.ok(point !== undefined);
    const expectedX =
      centre.x + (cosine * scaleX * anchor.canonical.xMm - sine * scaleY * anchor.canonical.yMm);
    const expectedY =
      centre.y + (sine * scaleX * anchor.canonical.xMm + cosine * scaleY * anchor.canonical.yMm);
    assert.ok(Math.abs(point.x - expectedX) < 0.001);
    assert.ok(Math.abs(point.y - expectedY) < 0.001);
  }
});

test('setup template fit applies horizontal and vertical tilt independently from roll', () => {
  const flat: SetupAffineTemplate = {
    centre: { x: 640, y: 360 },
    scaleX: 2.2,
    scaleY: 2.6,
    rotationRad: 0,
  };
  const tilted: SetupAffineTemplate = {
    ...flat,
    tiltXRad: (18 * Math.PI) / 180,
    tiltYRad: (-24 * Math.PI) / 180,
  };
  const flatPoints = setupAffineAnchorImagePoints(flat);
  const tiltedPoints = setupAffineAnchorImagePoints(tilted);
  assert.notEqual(flatPoints, null);
  assert.notEqual(tiltedPoints, null);
  assert.ok(flatPoints !== null && tiltedPoints !== null);
  assert.notDeepEqual(tiltedPoints, flatPoints);
  assert.ok(tiltedPoints.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
});

test('rejects degenerate setup template fits', () => {
  assert.equal(
    setupAffineAnchorImagePoints({
      centre: { x: 640, y: 360 },
      scaleX: 0,
      scaleY: 2.4,
      rotationRad: 0,
    }),
    null,
  );
  assert.equal(
    setupAffineAnchorImagePoints({
      centre: { x: Infinity, y: 360 },
      scaleX: 2.2,
      scaleY: 2.4,
      rotationRad: 0,
    }),
    null,
  );
});
