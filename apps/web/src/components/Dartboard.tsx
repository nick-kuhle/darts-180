import type { DartZone } from '@darts-180/contracts';
import { decodeBoardPoint, STANDARD_SEGMENT_ORDER } from '@darts-180/rules';
import type { PointerEvent } from 'react';

import { conventionalSegmentAppearance } from '../lib/boardAppearance';

const VIEWBOX_SIZE = 500;
const CENTER = VIEWBOX_SIZE / 2;
const SCALE = 1.18;
const RADII = {
  innerBull: 6.35,
  outerBull: 15.9,
  trebleInner: 99,
  trebleOuter: 107,
  doubleInner: 162,
  doubleOuter: 170,
} as const;

export interface DartboardMarker {
  id: string;
  label: string;
  zone: DartZone;
  tone: 'auto' | 'manual' | 'corrected';
}

interface DartboardProps {
  markers: readonly DartboardMarker[];
  onScore: (zone: DartZone) => void;
}

/**
 * Interactive board used for manual input and for visually explaining the canonical geometry
 * used by the vision pipeline. A pointer location is converted to mm and decoded by the shared
 * rules package—not a separate UI-only score calculation.
 */
export function Dartboard({ markers, onScore }: DartboardProps) {
  const handlePointerDown = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const xPx = ((event.clientX - rect.left) / rect.width) * VIEWBOX_SIZE;
    const yPx = ((event.clientY - rect.top) / rect.height) * VIEWBOX_SIZE;
    const point = { xMm: (xPx - CENTER) / SCALE, yMm: (yPx - CENTER) / SCALE };
    if (Math.hypot(point.xMm, point.yMm) > RADII.doubleOuter) return;
    onScore(decodeBoardPoint(point));
  };

  return (
    <div className="dartboard-wrap">
      <svg
        aria-describedby="dartboard-help"
        aria-label="Interactive dartboard. Select a DartCard then tap a scoring segment to set its score."
        className="dartboard"
        onPointerDown={handlePointerDown}
        role="img"
        viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
      >
        <circle
          className="board-backplate"
          cx={CENTER}
          cy={CENTER}
          r={RADII.doubleOuter * SCALE + 3}
        />

        {STANDARD_SEGMENT_ORDER.map((segment, index) => {
          const { singleColor, accentColor } = conventionalSegmentAppearance(index);
          const start = index * 18 - 9;
          const end = index * 18 + 9;
          return (
            <g key={segment}>
              <path
                d={sectorPath(start, end, RADII.outerBull, RADII.trebleInner)}
                fill={singleColor}
              />
              <path
                d={sectorPath(start, end, RADII.trebleInner, RADII.trebleOuter)}
                fill={accentColor}
              />
              <path
                d={sectorPath(start, end, RADII.trebleOuter, RADII.doubleInner)}
                fill={singleColor}
              />
              <path
                d={sectorPath(start, end, RADII.doubleInner, RADII.doubleOuter)}
                fill={accentColor}
              />
              <text
                className="board-number"
                dominantBaseline="central"
                textAnchor="middle"
                x={pointAt(190, index * 18).x}
                y={pointAt(190, index * 18).y}
              >
                {segment}
              </text>
            </g>
          );
        })}

        <circle className="outer-bull" cx={CENTER} cy={CENTER} r={RADII.outerBull * SCALE} />
        <circle className="inner-bull" cx={CENTER} cy={CENTER} r={RADII.innerBull * SCALE} />
        <circle className="ring-line" cx={CENTER} cy={CENTER} r={RADII.trebleInner * SCALE} />
        <circle className="ring-line" cx={CENTER} cy={CENTER} r={RADII.trebleOuter * SCALE} />
        <circle className="ring-line" cx={CENTER} cy={CENTER} r={RADII.doubleInner * SCALE} />
        <circle className="ring-line" cx={CENTER} cy={CENTER} r={RADII.doubleOuter * SCALE} />

        {markers.map((marker) => {
          const point = pointForZone(marker.zone);
          return (
            <g className={`dart-marker dart-marker-${marker.tone}`} key={marker.id}>
              <circle cx={point.x} cy={point.y} r="12" />
              <text dominantBaseline="central" textAnchor="middle" x={point.x} y={point.y + 0.5}>
                {marker.label}
              </text>
            </g>
          );
        })}
      </svg>
      <p id="dartboard-help" className="sr-only">
        For keyboard or screen-reader entry, use the quick score buttons below the board.
      </p>
    </div>
  );
}

function pointAt(
  radiusMm: number,
  degreesClockwiseFromTop: number,
): Readonly<{ x: number; y: number }> {
  const radians = (degreesClockwiseFromTop * Math.PI) / 180;
  return {
    x: CENTER + Math.sin(radians) * radiusMm * SCALE,
    y: CENTER - Math.cos(radians) * radiusMm * SCALE,
  };
}

function sectorPath(
  startDegrees: number,
  endDegrees: number,
  innerRadiusMm: number,
  outerRadiusMm: number,
): string {
  const outerStart = pointAt(outerRadiusMm, startDegrees);
  const outerEnd = pointAt(outerRadiusMm, endDegrees);
  const innerEnd = pointAt(innerRadiusMm, endDegrees);
  const innerStart = pointAt(innerRadiusMm, startDegrees);
  const outerRadius = outerRadiusMm * SCALE;
  const innerRadius = innerRadiusMm * SCALE;
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 0 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 0 0 ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ');
}

function pointForZone(zone: DartZone): Readonly<{ x: number; y: number }> {
  if (zone.ring === 'IB') return pointAt(0, 0);
  if (zone.ring === 'OB') return pointAt(11, 0);
  if (zone.ring === 'MISS' || zone.segment === null) return { x: CENTER + 215, y: CENTER + 170 };

  const index = STANDARD_SEGMENT_ORDER.findIndex((segment) => segment === zone.segment);
  const degrees = (index < 0 ? 0 : index) * 18;
  const radius = zone.ring === 'T' ? 103 : zone.ring === 'D' ? 166 : 60;
  return pointAt(radius, degrees);
}
