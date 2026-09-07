import assert from 'node:assert/strict';
import test from 'node:test';

import {
  boardFitCenter,
  createInitialBoardFit,
  moveBoardFitHandle,
  nearestBoardFitHandle,
  pointIsInsideBoardFit,
  transformBoardFit,
  translateBoardFit,
} from '../src/lib/boardFit.js';

test('board fit starts centered and a guide tap/drag translation preserves its editable shape', () => {
  const initial = createInitialBoardFit(960, 540);
  assert.deepEqual(boardFitCenter(initial), { x: 480, y: 270 });
  assert.equal(pointIsInsideBoardFit({ x: 480, y: 270 }, initial), true);
  assert.equal(pointIsInsideBoardFit({ x: 50, y: 50 }, initial), false);

  const moved = translateBoardFit(initial, -90, 35);
  assert.deepEqual(boardFitCenter(moved), { x: 390, y: 305 });
  assert.deepEqual(
    moved.map((point, index) => ({
      x: point.x - initial[index]!.x,
      y: point.y - initial[index]!.y,
    })),
    [
      { x: -90, y: 35 },
      { x: -90, y: 35 },
      { x: -90, y: 35 },
      { x: -90, y: 35 },
    ],
  );
});

test('pinch/twist transforms all guide handles while individual handles retain skew control', () => {
  const initial = createInitialBoardFit(600, 600);
  const transformed = transformBoardFit(
    initial,
    boardFitCenter(initial),
    { x: 330, y: 280 },
    1.5,
    Math.PI / 2,
  );

  assert.deepEqual(boardFitCenter(transformed), { x: 330, y: 280 });
  // Top handle rotates clockwise to the right of the transformed center and scales from 186 to 279 px.
  assert.ok(Math.abs(transformed[0].x - 609) < 0.001);
  assert.ok(Math.abs(transformed[0].y - 280) < 0.001);
  assert.equal(nearestBoardFitHandle(transformed[0], transformed, 10), 0);

  const skewed = moveBoardFitHandle(transformed, 1, { x: 640, y: 325 });
  assert.deepEqual(skewed[1], { x: 640, y: 325 });
  assert.deepEqual(skewed[0], transformed[0]);
  assert.deepEqual(skewed[2], transformed[2]);
  assert.deepEqual(skewed[3], transformed[3]);
});
