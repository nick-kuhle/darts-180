import { BOARD_RADII_MM } from '@darts-180/rules';

import type { CanonicalPoint, ImagePoint } from './annotationGeometry';

/**
 * The four editable guide handles are the real outer edge of the double wire.
 * Their canonical order is top / right / bottom / left, with the top fixed to the 20 segment.
 */
export const BOARD_FIT_CANONICAL_ANCHORS: readonly [
  CanonicalPoint,
  CanonicalPoint,
  CanonicalPoint,
  CanonicalPoint,
] = [
  { xMm: 0, yMm: -BOARD_RADII_MM.doubleOuter },
  { xMm: BOARD_RADII_MM.doubleOuter, yMm: 0 },
  { xMm: 0, yMm: BOARD_RADII_MM.doubleOuter },
  { xMm: -BOARD_RADII_MM.doubleOuter, yMm: 0 },
] as const;

export type BoardFitPoints = readonly [ImagePoint, ImagePoint, ImagePoint, ImagePoint];

export function createInitialBoardFit(width: number, height: number): BoardFitPoints {
  const radius = Math.max(64, Math.min(width, height) * 0.31);
  const center = { x: width / 2, y: height / 2 };
  return [
    { x: center.x, y: center.y - radius },
    { x: center.x + radius, y: center.y },
    { x: center.x, y: center.y + radius },
    { x: center.x - radius, y: center.y },
  ];
}

export function boardFitCenter(points: BoardFitPoints): ImagePoint {
  return {
    x: (points[0].x + points[1].x + points[2].x + points[3].x) / 4,
    y: (points[0].y + points[1].y + points[2].y + points[3].y) / 4,
  };
}

export function moveBoardFitHandle(
  points: BoardFitPoints,
  index: number,
  position: ImagePoint,
): BoardFitPoints {
  return asBoardFitPoints(
    points.map((point, pointIndex) =>
      pointIndex === index ? { x: position.x, y: position.y } : point,
    ),
  );
}

export function translateBoardFit(
  points: BoardFitPoints,
  deltaX: number,
  deltaY: number,
): BoardFitPoints {
  return asBoardFitPoints(points.map((point) => ({ x: point.x + deltaX, y: point.y + deltaY })));
}

/** Applies a pinch/twist gesture around its starting midpoint without destroying perspective edits. */
export function transformBoardFit(
  points: BoardFitPoints,
  startCenter: ImagePoint,
  nextCenter: ImagePoint,
  scale: number,
  rotationRadians: number,
): BoardFitPoints {
  const safeScale = Math.max(0.35, Math.min(3.2, scale));
  const cosine = Math.cos(rotationRadians);
  const sine = Math.sin(rotationRadians);
  return asBoardFitPoints(
    points.map((point) => {
      const dx = point.x - startCenter.x;
      const dy = point.y - startCenter.y;
      return {
        x: nextCenter.x + safeScale * (dx * cosine - dy * sine),
        y: nextCenter.y + safeScale * (dx * sine + dy * cosine),
      };
    }),
  );
}

export function pointIsInsideBoardFit(point: ImagePoint, fit: BoardFitPoints): boolean {
  // Convex-quadrilateral winding test. It accepts either clockwise or counter-clockwise handles.
  let direction = 0;
  for (let index = 0; index < fit.length; index += 1) {
    const current = fit[index]!;
    const next = fit[(index + 1) % fit.length]!;
    const cross =
      (next.x - current.x) * (point.y - current.y) - (next.y - current.y) * (point.x - current.x);
    if (Math.abs(cross) < 0.001) continue;
    const sign = cross > 0 ? 1 : -1;
    if (direction !== 0 && sign !== direction) return false;
    direction = sign;
  }
  return true;
}

function asBoardFitPoints(points: readonly ImagePoint[]): BoardFitPoints {
  if (points.length !== 4) throw new Error('A board fit must have exactly four edge handles.');
  return [points[0]!, points[1]!, points[2]!, points[3]!];
}

export function nearestBoardFitHandle(
  point: ImagePoint,
  fit: BoardFitPoints,
  maximumDistance: number,
): number | null {
  let nearestIndex: number | null = null;
  let nearestDistance = maximumDistance;
  fit.forEach((handle, index) => {
    const distance = Math.hypot(point.x - handle.x, point.y - handle.y);
    if (distance <= nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });
  return nearestIndex;
}
