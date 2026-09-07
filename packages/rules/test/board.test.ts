import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BOARD_RADII_MM,
  decodeBoardPoint,
  makeZone,
  nearestWireMarginMm,
  scoreFor,
  segmentAtPoint,
} from '../src/index';

test('decodes bulls and all radial ring classes', () => {
  assert.deepEqual(decodeBoardPoint({ xMm: 0, yMm: 0 }), makeZone('IB'));
  assert.deepEqual(decodeBoardPoint({ xMm: 0, yMm: -10 }), makeZone('OB'));
  assert.deepEqual(decodeBoardPoint({ xMm: 0, yMm: -50 }), makeZone('S', 20));
  assert.deepEqual(decodeBoardPoint({ xMm: 0, yMm: -103 }), makeZone('T', 20));
  assert.deepEqual(decodeBoardPoint({ xMm: 0, yMm: -130 }), makeZone('S', 20));
  assert.deepEqual(decodeBoardPoint({ xMm: 0, yMm: -166 }), makeZone('D', 20));
  assert.deepEqual(decodeBoardPoint({ xMm: 0, yMm: -171 }), makeZone('MISS'));
});

test('uses the official board ordering clockwise from 20 at twelve o’clock', () => {
  const theta = (18 * Math.PI) / 180;
  const pointAtOne = { xMm: 103 * Math.sin(theta), yMm: -103 * Math.cos(theta) };
  assert.equal(segmentAtPoint({ xMm: 0, yMm: -100 }), 20);
  assert.equal(segmentAtPoint(pointAtOne), 1);
  assert.deepEqual(decodeBoardPoint(pointAtOne), makeZone('T', 1));
});

test('rejects malformed zone combinations in score construction', () => {
  assert.throws(() => scoreFor('D', null));
  assert.throws(() => scoreFor('IB', 20));
  assert.throws(() => scoreFor('S', 21));
});

test('reports zero wire margin at a radial scoring boundary', () => {
  assert.equal(nearestWireMarginMm({ xMm: 0, yMm: -BOARD_RADII_MM.trebleOuter }), 0);
  assert.ok(nearestWireMarginMm({ xMm: 0, yMm: -103 }) > 3);
});
