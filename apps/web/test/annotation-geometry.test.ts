import assert from 'node:assert/strict';
import test from 'node:test';

import {
  invertHomography,
  mapBoardPointToImage,
  mapImagePointToBoard,
  solveImageToBoardHomography,
  type CanonicalPoint,
  type ImagePoint,
} from '../src/lib/annotationGeometry.js';

function mapBoardToImage(point: CanonicalPoint): ImagePoint {
  // A non-affine, known canonical-to-image transform used to produce test correspondences.
  const denominator = 0.00035 * point.xMm - 0.0002 * point.yMm + 1;
  return {
    x: (2.2 * point.xMm + 0.18 * point.yMm + 640) / denominator,
    y: (0.12 * point.xMm + 2.0 * point.yMm + 360) / denominator,
  };
}

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
