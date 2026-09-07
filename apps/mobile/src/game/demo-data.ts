import type { DartZone } from '@darts-180/contracts';
import { makeZone } from '@darts-180/rules';

export interface DartDraft {
  id: string;
  zone: DartZone;
  confidence: number;
  wireMarginMm: number;
  source: 'auto' | 'manual';
}

export const QUICK_ZONES: readonly DartZone[] = [
  makeZone('T', 20),
  makeZone('S', 20),
  makeZone('D', 20),
  makeZone('T', 19),
  makeZone('S', 19),
  makeZone('D', 16),
  makeZone('IB'),
  makeZone('OB'),
  makeZone('MISS'),
];

const MOCK_TURNS: readonly (readonly DartDraft[])[] = [
  [
    {
      id: 'mock-1-a',
      zone: makeZone('T', 20),
      confidence: 0.995,
      wireMarginMm: 4.2,
      source: 'auto',
    },
    {
      id: 'mock-1-b',
      zone: makeZone('S', 20),
      confidence: 0.87,
      wireMarginMm: 0.8,
      source: 'auto',
    },
    {
      id: 'mock-1-c',
      zone: makeZone('D', 20),
      confidence: 0.982,
      wireMarginMm: 3.1,
      source: 'auto',
    },
  ],
  [
    {
      id: 'mock-2-a',
      zone: makeZone('T', 19),
      confidence: 0.991,
      wireMarginMm: 3.7,
      source: 'auto',
    },
    {
      id: 'mock-2-b',
      zone: makeZone('T', 20),
      confidence: 0.994,
      wireMarginMm: 2.8,
      source: 'auto',
    },
    { id: 'mock-2-c', zone: makeZone('S', 5), confidence: 0.72, wireMarginMm: 0.4, source: 'auto' },
  ],
];

export function mockTurn(turnIndex: number): DartDraft[] {
  const selected = MOCK_TURNS[turnIndex % MOCK_TURNS.length] ?? MOCK_TURNS[0];
  if (selected === undefined) throw new Error('Mock vision turns are unexpectedly empty.');
  return selected.map((dart) => ({ ...dart, zone: { ...dart.zone } }));
}

export function cycleZone(current: DartZone): DartZone {
  const currentIndex = QUICK_ZONES.findIndex(
    (candidate) =>
      candidate.ring === current.ring &&
      candidate.segment === current.segment &&
      candidate.score === current.score,
  );
  return { ...(QUICK_ZONES[(currentIndex + 1) % QUICK_ZONES.length] ?? QUICK_ZONES[0]!) };
}
