import type { DartZone, Ring } from '@darts-180/contracts';

/** Standard board order when viewed face-on: 20 at twelve o'clock, moving clockwise. */
export const STANDARD_SEGMENT_ORDER = [
  20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5,
] as const;

export const BOARD_RADII_MM = {
  innerBull: 6.35,
  outerBull: 15.9,
  trebleInner: 99,
  trebleOuter: 107,
  doubleInner: 162,
  doubleOuter: 170,
} as const;

export type BoardPointMm = Readonly<{ xMm: number; yMm: number }>;

export function isStandardSegment(value: number): value is (typeof STANDARD_SEGMENT_ORDER)[number] {
  return Number.isInteger(value) && STANDARD_SEGMENT_ORDER.includes(value as 1);
}

export function scoreFor(ring: Ring, segment: number | null): number {
  switch (ring) {
    case 'S':
      if (segment === null || !isStandardSegment(segment))
        throw new Error('Single needs segment 1–20.');
      return segment;
    case 'D':
      if (segment === null || !isStandardSegment(segment))
        throw new Error('Double needs segment 1–20.');
      return segment * 2;
    case 'T':
      if (segment === null || !isStandardSegment(segment))
        throw new Error('Treble needs segment 1–20.');
      return segment * 3;
    case 'IB':
      if (segment !== null) throw new Error('Inner bull has no numbered segment.');
      return 50;
    case 'OB':
      if (segment !== null) throw new Error('Outer bull has no numbered segment.');
      return 25;
    case 'MISS':
      if (segment !== null) throw new Error('Miss has no numbered segment.');
      return 0;
  }
}

export function makeZone(ring: Ring, segment: number | null = null): DartZone {
  return { ring, segment, score: scoreFor(ring, segment) };
}

export function isZoneWellFormed(zone: DartZone): boolean {
  try {
    return scoreFor(zone.ring, zone.segment) === zone.score;
  } catch {
    return false;
  }
}

export function isDouble(zone: DartZone): boolean {
  return zone.ring === 'D' || zone.ring === 'IB';
}

export function isMasterMultiplier(zone: DartZone): boolean {
  return zone.ring === 'D' || zone.ring === 'T' || zone.ring === 'IB';
}

export function formatZone(zone: DartZone): string {
  if (zone.ring === 'IB') return 'BULL';
  if (zone.ring === 'OB') return '25';
  if (zone.ring === 'MISS') return 'MISS';
  return `${zone.ring}${zone.segment}`;
}

/**
 * Decodes a point after the camera model has applied its image→board homography.
 * Coordinates are millimetres from the bull with x to the right and y down. This function is
 * intentionally deterministic and knows nothing about camera pixels or ML confidence.
 */
export function decodeBoardPoint(point: BoardPointMm): DartZone {
  const radius = Math.hypot(point.xMm, point.yMm);

  if (radius <= BOARD_RADII_MM.innerBull) return makeZone('IB');
  if (radius <= BOARD_RADII_MM.outerBull) return makeZone('OB');
  if (radius > BOARD_RADII_MM.doubleOuter) return makeZone('MISS');

  const segment = segmentAtPoint(point);
  if (radius < BOARD_RADII_MM.trebleInner) return makeZone('S', segment);
  if (radius <= BOARD_RADII_MM.trebleOuter) return makeZone('T', segment);
  if (radius < BOARD_RADII_MM.doubleInner) return makeZone('S', segment);
  return makeZone('D', segment);
}

/** Clockwise degrees from twelve o'clock, normalized to [0, 360). */
export function boardAngleDegrees(point: BoardPointMm): number {
  const raw = (Math.atan2(point.xMm, -point.yMm) * 180) / Math.PI;
  return (raw + 360) % 360;
}

export function segmentAtPoint(point: BoardPointMm): (typeof STANDARD_SEGMENT_ORDER)[number] {
  const angle = boardAngleDegrees(point);
  const index = Math.floor((angle + 9) / 18) % STANDARD_SEGMENT_ORDER.length;
  const segment = STANDARD_SEGMENT_ORDER[index];
  if (segment === undefined) throw new Error('Unreachable segment index.');
  return segment;
}

/**
 * Conservative distance to the nearest scoring boundary in canonical board millimetres.
 * It is a feature for confidence calibration, not a replacement for model uncertainty.
 */
export function nearestWireMarginMm(point: BoardPointMm): number {
  const radius = Math.hypot(point.xMm, point.yMm);
  const radialWires = [
    BOARD_RADII_MM.innerBull,
    BOARD_RADII_MM.outerBull,
    BOARD_RADII_MM.trebleInner,
    BOARD_RADII_MM.trebleOuter,
    BOARD_RADII_MM.doubleInner,
    BOARD_RADII_MM.doubleOuter,
  ];
  const radialMargin = Math.min(...radialWires.map((wire) => Math.abs(radius - wire)));

  // Bulls are radial only. Numbered wedges also have radial segment wires every nine degrees.
  if (radius <= BOARD_RADII_MM.outerBull) return radialMargin;
  const angleWithinSegment = ((boardAngleDegrees(point) + 9) % 18) - 9;
  const degreesToSegmentWire = 9 - Math.abs(angleWithinSegment);
  const angularMargin = radius * Math.sin((degreesToSegmentWire * Math.PI) / 180);
  return Math.max(0, Math.min(radialMargin, angularMargin));
}
