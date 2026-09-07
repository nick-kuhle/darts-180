import type { DartZone } from '@darts-180/contracts';

import { formatZone, isDouble, isMasterMultiplier, makeZone } from './board';
import type { X01ExitRule } from './x01';

export interface CheckoutRoute {
  darts: readonly DartZone[];
  notation: string;
}

const SCORING_DARTS: readonly DartZone[] = [
  ...Array.from({ length: 20 }, (_, index) => makeZone('T', 20 - index)),
  ...Array.from({ length: 20 }, (_, index) => makeZone('D', 20 - index)),
  makeZone('IB'),
  ...Array.from({ length: 20 }, (_, index) => makeZone('S', 20 - index)),
  makeZone('OB'),
];

/**
 * Returns sensible mathematical checkout routes. It is intentionally not a player-specific
 * recommendation engine: preference learning belongs above this deterministic rules package.
 */
export function findCheckoutRoutes(
  remaining: number,
  options: Readonly<{ maxDarts?: 1 | 2 | 3; outRule?: X01ExitRule; limit?: number }> = {},
): readonly CheckoutRoute[] {
  if (!Number.isInteger(remaining) || remaining < 2) return [];
  const maxDarts = options.maxDarts ?? 3;
  const outRule = options.outRule ?? 'double';
  const limit = options.limit ?? 8;
  const routes: CheckoutRoute[] = [];

  const visit = (scoreLeft: number, dartsLeft: number, route: readonly DartZone[]) => {
    if (routes.length >= limit) return;
    for (const dart of SCORING_DARTS) {
      if (dart.score > scoreLeft) continue;
      if (dart.score === scoreLeft && qualifiesAsFinish(dart, outRule)) {
        const darts = [...route, dart];
        routes.push({ darts, notation: darts.map(formatZone).join(' ') });
        if (routes.length >= limit) return;
        continue;
      }
      if (dartsLeft > 1 && dart.score < scoreLeft) {
        visit(scoreLeft - dart.score, dartsLeft - 1, [...route, dart]);
        if (routes.length >= limit) return;
      }
    }
  };

  visit(remaining, maxDarts, []);
  return routes;
}

function qualifiesAsFinish(dart: DartZone, outRule: X01ExitRule): boolean {
  if (outRule === 'straight') return true;
  if (outRule === 'double') return isDouble(dart);
  return isMasterMultiplier(dart);
}
