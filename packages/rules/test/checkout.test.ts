import assert from 'node:assert/strict';
import test from 'node:test';

import { findCheckoutRoutes } from '../src/index';

test('finds the maximum standard 170 checkout', () => {
  const routes = findCheckoutRoutes(170, { limit: 20 });
  assert.ok(routes.some((route) => route.notation === 'T20 T20 BULL'));
});

test('finds a simple double finish', () => {
  const routes = findCheckoutRoutes(2);
  assert.equal(routes[0]?.notation, 'D1');
});

test('does not invent a three-dart double-out for 169', () => {
  assert.deepEqual(findCheckoutRoutes(169), []);
});
