import { BOARD_RADII_MM } from '@darts-180/rules';

import type { ImagePoint } from './annotationGeometry';
import type { BoardFitPoints } from './boardFit';
import type { CameraFrame } from './cameraScoring';

export type AutoBoardFitStatus = 'found' | 'not-found' | 'too-small';

/**
 * Result of a browser-local standard-board color fit. It is a bootstrap heuristic, not a learned
 * board detector: repeated red/green double and treble bands estimate the board ellipse and assume
 * the physical 20 is upright in the camera image. It deliberately reports uncertainty rather than
 * inventing a board.
 */
export interface AutoBoardFitResult {
  status: AutoBoardFitStatus;
  fit: BoardFitPoints | null;
  center: ImagePoint | null;
  estimatedBoardDiameterPixels: number;
  colorPixelCount: number;
  redPixelCount: number;
  greenPixelCount: number;
  sampledPixelCount: number;
  /** Fraction of accent pixels assigned to the selected outer double-color band. */
  outerRingFraction: number;
  /** Fraction of accent pixels assigned to the selected inner treble-color band. */
  innerRingFraction: number;
  /** Fraction of accent pixels in the expected uncolored single-bed gap between those bands. */
  interBandFraction: number;
  /** Number of populated angular sectors in the selected outer color band. */
  outerAngularCoverage: number;
  /** Evidence that colors alternate around the selected outer band like a conventional board. */
  outerAlternatingColorStrength: number;
  /** Agreement of the alternating color pattern between selected double and treble bands. */
  bandColorPhaseAgreement: number;
  confidence: number;
  message: string;
}

/**
 * A short-lived board-fit latch for live mobile camera sampling. A valid pattern can disappear for
 * a frame while autofocus or auto-exposure settles; that must not force a player to start finding
 * the same stationary board again.
 */
export interface AutomaticBoardFitStability {
  fit: BoardFitPoints;
  matchingObservations: number;
  intermittentMisses: number;
}

/** Two matching observations still protect normal Camera Play from a one-frame false board fit. */
export const AUTOMATIC_BOARD_FIT_REQUIRED_OBSERVATIONS = 2;
/** At the 800 ms finder cadence, keep a matching board read for no more than 1.6 s of dropouts. */
export const AUTOMATIC_BOARD_FIT_MAX_INTERMITTENT_MISSES = 2;

type AccentColor = 'red' | 'green';
type AccentPoint = ImagePoint & Readonly<{ color: AccentColor }>;

interface PolarAccentPoint extends AccentPoint {
  normalizedRadius: number;
  angleRadians: number;
  angularSector: number;
}

interface RadialBandEvidence {
  points: readonly PolarAccentPoint[];
  redPointCount: number;
  greenPointCount: number;
  angularCoverage: number;
  redAngularCoverage: number;
  greenAngularCoverage: number;
  /** Strength of the expected red/green alternating 20-sector pattern, from 0 to 1. */
  alternatingColorStrength: number;
  /** Phase of that alternating pattern; used only to compare the double and treble bands. */
  colorPhaseRadians: number;
}

interface StandardRingPair {
  outerRadius: number;
  innerRadius: number;
  outer: RadialBandEvidence;
  inner: RadialBandEvidence;
  gap: RadialBandEvidence;
  colorPhaseAgreement: number;
  patternScore: number;
}

const MINIMUM_WORKING_DIAMETER = 170;
const DOUBLE_COLOR_CENTER_MM = (BOARD_RADII_MM.doubleOuter + BOARD_RADII_MM.doubleInner) / 2;
const TREBLE_COLOR_CENTER_MM = (BOARD_RADII_MM.trebleOuter + BOARD_RADII_MM.trebleInner) / 2;
const TREBLE_TO_DOUBLE_RATIO = TREBLE_COLOR_CENTER_MM / DOUBLE_COLOR_CENTER_MM;
const SINGLE_BED_GAP_RATIO =
  (BOARD_RADII_MM.trebleOuter + BOARD_RADII_MM.doubleInner) / 2 / DOUBLE_COLOR_CENTER_MM;
const RADIAL_CANDIDATE_START = 0.14;
const RADIAL_CANDIDATE_END = 1.04;
const RADIAL_CANDIDATE_STEP = 0.02;

export function detectBoardFitFromColors(frame: CameraFrame): AutoBoardFitResult {
  const empty = (
    status: Exclude<AutoBoardFitStatus, 'found'>,
    message: string,
    colorPixelCount = 0,
    sampledPixelCount = 0,
    redPixelCount = 0,
    greenPixelCount = 0,
  ): AutoBoardFitResult => ({
    status,
    fit: null,
    center: null,
    estimatedBoardDiameterPixels: 0,
    colorPixelCount,
    redPixelCount,
    greenPixelCount,
    sampledPixelCount,
    outerRingFraction: 0,
    innerRingFraction: 0,
    interBandFraction: 0,
    outerAngularCoverage: 0,
    outerAlternatingColorStrength: 0,
    bandColorPhaseAgreement: 0,
    confidence: 0,
    message,
  });

  if (!isFrameUsable(frame)) {
    return empty(
      'not-found',
      'Waiting for a complete camera frame before looking for board colors.',
    );
  }

  // The preview is capped at 1280 px on its long edge. This additional sampling keeps color search
  // inexpensive enough to run alongside the camera without exporting or persisting any media.
  const step = Math.max(1, Math.ceil(Math.sqrt((frame.width * frame.height) / 85_000)));
  const accentPixels: AccentPoint[] = [];
  let sampledPixelCount = 0;
  let redPixelCount = 0;
  let greenPixelCount = 0;
  for (let y = 0; y < frame.height; y += step) {
    for (let x = 0; x < frame.width; x += step) {
      const offset = (y * frame.width + x) * 4;
      const accent = boardAccentColor(
        frame.rgba[offset]!,
        frame.rgba[offset + 1]!,
        frame.rgba[offset + 2]!,
      );
      if (accent !== null) {
        accentPixels.push({ x, y, color: accent });
        if (accent === 'red') redPixelCount += 1;
        else greenPixelCount += 1;
      }
      sampledPixelCount += 1;
    }
  }

  const minimumColorPixels = Math.max(110, Math.round(sampledPixelCount * 0.0025));
  if (accentPixels.length < minimumColorPixels) {
    return empty(
      'not-found',
      'I cannot see enough of the board’s red and green scoring colors yet. Keep the full board in view and reduce glare.',
      accentPixels.length,
      sampledPixelCount,
      redPixelCount,
      greenPixelCount,
    );
  }
  const minimumPixelsPerColor = Math.max(24, Math.round(minimumColorPixels * 0.1));
  if (redPixelCount < minimumPixelsPerColor || greenPixelCount < minimumPixelsPerColor) {
    return empty(
      'not-found',
      'I need both red and green scoring-band colors, not just one colored object. Reframe the full board and reduce glare.',
      accentPixels.length,
      sampledPixelCount,
      redPixelCount,
      greenPixelCount,
    );
  }

  // The outermost colored pixel is not necessarily part of the board: a red surround, a wall logo,
  // or a dropped flight can sit outside the double wire. If one color overwhelmingly dominates,
  // estimate the broad ellipse from the other board-band color first, then use both colors to prove
  // the repeated double/treble pattern below.
  const geometryPixels = geometryPointsForColors(accentPixels, redPixelCount, greenPixelCount);
  let center = meanPoint(geometryPixels);
  const principalAxes = findPrincipalAxes(geometryPixels, center);
  if (principalAxes === null) {
    return empty(
      'not-found',
      'The visible board colors do not form a stable board shape yet. Hold the mount still and keep the full board in view.',
      accentPixels.length,
      sampledPixelCount,
      redPixelCount,
      greenPixelCount,
    );
  }
  const axes = orientAxesForUprightBoard(principalAxes);
  let envelopeHorizontalRadius = percentile(
    geometryPixels.map((point) =>
      Math.abs((point.x - center.x) * axes.horizontal.x + (point.y - center.y) * axes.horizontal.y),
    ),
    0.985,
  );
  let envelopeVerticalRadius = percentile(
    geometryPixels.map((point) =>
      Math.abs((point.x - center.x) * axes.vertical.x + (point.y - center.y) * axes.vertical.y),
    ),
    0.985,
  );
  if (
    !Number.isFinite(envelopeHorizontalRadius) ||
    !Number.isFinite(envelopeVerticalRadius) ||
    envelopeHorizontalRadius < 8 ||
    envelopeVerticalRadius < 8
  ) {
    return empty(
      'not-found',
      'The board-color outline is not stable enough yet. Keep the full board visible and let the camera focus.',
      accentPixels.length,
      sampledPixelCount,
      redPixelCount,
      greenPixelCount,
    );
  }

  let polarPoints = normalizeAccentPoints(
    accentPixels,
    center,
    axes,
    envelopeHorizontalRadius,
    envelopeVerticalRadius,
  );
  // A standard board has a compact red/green bull. It provides a more local and less logo-sensitive
  // center cue than red lettering, surrounds, or decorative printing near the double ring. Refine
  // only when a two-color central cluster is close enough to the broad ring-derived center, then
  // repeat the radial search from that consensus center.
  const bullCenter = findTwoColorBullCenter(polarPoints);
  if (
    bullCenter !== null &&
    distance(center, bullCenter) <=
      Math.min(envelopeHorizontalRadius, envelopeVerticalRadius) * 0.22
  ) {
    center = bullCenter;
    envelopeHorizontalRadius = percentile(
      geometryPixels.map((point) =>
        Math.abs(
          (point.x - center.x) * axes.horizontal.x + (point.y - center.y) * axes.horizontal.y,
        ),
      ),
      0.985,
    );
    envelopeVerticalRadius = percentile(
      geometryPixels.map((point) =>
        Math.abs((point.x - center.x) * axes.vertical.x + (point.y - center.y) * axes.vertical.y),
      ),
      0.985,
    );
    polarPoints = normalizeAccentPoints(
      accentPixels,
      center,
      axes,
      envelopeHorizontalRadius,
      envelopeVerticalRadius,
    );
  }
  const ringPair = findStandardRingPair(polarPoints);
  if (ringPair === null) {
    return empty(
      'not-found',
      'I found red and green color, but not a complete repeated double-and-treble scoring-band pattern. Reframe the board and reduce reflections or colorful objects nearby.',
      accentPixels.length,
      sampledPixelCount,
      redPixelCount,
      greenPixelCount,
    );
  }

  // Use only the selected double-band samples for final ellipse extent. This avoids an external red
  // surround inflating the guide and makes the guide track the actual scoring double wire.
  let horizontalRadius = percentile(
    ringPair.outer.points.map((point) =>
      Math.abs((point.x - center.x) * axes.horizontal.x + (point.y - center.y) * axes.horizontal.y),
    ),
    0.985,
  );
  let verticalRadius = percentile(
    ringPair.outer.points.map((point) =>
      Math.abs((point.x - center.x) * axes.vertical.x + (point.y - center.y) * axes.vertical.y),
    ),
    0.985,
  );
  const smallerRadius = Math.min(horizontalRadius, verticalRadius);
  const largerRadius = Math.max(horizontalRadius, verticalRadius);
  const estimatedBoardDiameterPixels = smallerRadius * 2;
  if (
    !Number.isFinite(horizontalRadius) ||
    !Number.isFinite(verticalRadius) ||
    smallerRadius < MINIMUM_WORKING_DIAMETER / 2 ||
    largerRadius / Math.max(smallerRadius, 1) > 4.5
  ) {
    return empty(
      'too-small',
      'The repeated red/green scoring bands are too small or narrow to score from. Move the phone closer and show the full double ring.',
      accentPixels.length,
      sampledPixelCount,
      redPixelCount,
      greenPixelCount,
    );
  }

  const fit: BoardFitPoints = [
    {
      x: center.x - axes.vertical.x * verticalRadius,
      y: center.y - axes.vertical.y * verticalRadius,
    },
    {
      x: center.x + axes.horizontal.x * horizontalRadius,
      y: center.y + axes.horizontal.y * horizontalRadius,
    },
    {
      x: center.x + axes.vertical.x * verticalRadius,
      y: center.y + axes.vertical.y * verticalRadius,
    },
    {
      x: center.x - axes.horizontal.x * horizontalRadius,
      y: center.y - axes.horizontal.y * horizontalRadius,
    },
  ];

  const colorBalanceScore = clamp(
    Math.min(redPixelCount, greenPixelCount) / Math.max(redPixelCount, greenPixelCount),
    0,
    1,
  );
  const ringSignalScore = clamp(
    (ringPair.outer.points.length + ringPair.inner.points.length) / 520,
    0,
    1,
  );
  const sizeScore = clamp((estimatedBoardDiameterPixels - MINIMUM_WORKING_DIAMETER) / 420, 0, 1);
  const confidence = clamp(
    ringPair.patternScore * 0.5 +
      colorBalanceScore * 0.12 +
      ringSignalScore * 0.2 +
      sizeScore * 0.18,
    0,
    1,
  );

  return {
    status: 'found',
    fit,
    center,
    estimatedBoardDiameterPixels,
    colorPixelCount: accentPixels.length,
    redPixelCount,
    greenPixelCount,
    sampledPixelCount,
    outerRingFraction: ringPair.outer.points.length / accentPixels.length,
    innerRingFraction: ringPair.inner.points.length / accentPixels.length,
    interBandFraction: ringPair.gap.points.length / accentPixels.length,
    outerAngularCoverage: ringPair.outer.angularCoverage,
    outerAlternatingColorStrength: ringPair.outer.alternatingColorStrength,
    bandColorPhaseAgreement: ringPair.colorPhaseAgreement,
    confidence,
    message:
      'Repeated red/green double and treble bands found. The automatic fit assumes the physical 20 is upright in the camera image.',
  };
}

/** Stable fits must agree before Camera Play captures a player-visible baseline. */
export function boardFitsAreSimilar(
  first: BoardFitPoints,
  second: BoardFitPoints,
  maximumCenterDriftPixels = 18,
  maximumRadiusChange = 0.12,
): boolean {
  const firstCenter = centerOfFit(first);
  const secondCenter = centerOfFit(second);
  if (
    Math.hypot(firstCenter.x - secondCenter.x, firstCenter.y - secondCenter.y) >
    maximumCenterDriftPixels
  ) {
    return false;
  }
  const firstRadius = averageFitRadius(first, firstCenter);
  const secondRadius = averageFitRadius(second, secondCenter);
  if (Math.abs(firstRadius - secondRadius) / Math.max(1, firstRadius) > maximumRadiusChange) {
    return false;
  }
  // A center/radius-only comparison can accept a guide whose axes have flipped or rotated between
  // frames. Require corresponding cardinal handles to agree as well before Camera Play treats the
  // mapping as stable enough to score from.
  const maximumHandleDrift = Math.max(maximumCenterDriftPixels, firstRadius * 0.08);
  return first.every((point, index) => distance(point, second[index]!) <= maximumHandleDrift);
}

/**
 * Advances the short mobile-camera fit latch without lowering the two-observation requirement.
 * A null observation may be an autofocus / exposure dropout, but prolonged loss still forgets the
 * prior board so a genuine reframe cannot inherit an old mapping.
 */
export function advanceAutomaticBoardFitStability(
  previous: AutomaticBoardFitStability | null,
  nextFit: BoardFitPoints | null,
): AutomaticBoardFitStability | null {
  if (nextFit === null) {
    if (
      previous === null ||
      previous.intermittentMisses >= AUTOMATIC_BOARD_FIT_MAX_INTERMITTENT_MISSES
    ) {
      return null;
    }
    return {
      ...previous,
      intermittentMisses: previous.intermittentMisses + 1,
    };
  }

  const matchesPrevious = previous !== null && boardFitsAreSimilar(previous.fit, nextFit);
  return {
    fit: nextFit,
    matchingObservations: matchesPrevious ? previous.matchingObservations + 1 : 1,
    intermittentMisses: 0,
  };
}

function normalizeAccentPoints(
  points: readonly AccentPoint[],
  center: ImagePoint,
  axes: Readonly<{ horizontal: ImagePoint; vertical: ImagePoint }>,
  horizontalRadius: number,
  verticalRadius: number,
): PolarAccentPoint[] {
  return (
    points
      .map((point) => {
        const deltaX = point.x - center.x;
        const deltaY = point.y - center.y;
        const normalizedX =
          (deltaX * axes.horizontal.x + deltaY * axes.horizontal.y) / horizontalRadius;
        const normalizedY = (deltaX * axes.vertical.x + deltaY * axes.vertical.y) / verticalRadius;
        const angleRadians = Math.atan2(normalizedY, normalizedX);
        return {
          ...point,
          normalizedRadius: Math.hypot(normalizedX, normalizedY),
          angleRadians,
          angularSector: Math.floor(((angleRadians + Math.PI) / (2 * Math.PI)) * 20) % 20,
        };
      })
      // The expected double band lies at the geometry envelope. Exclude farther accent pixels before
      // the radial search so a coloured surround cannot dominate the work or the candidate score.
      .filter((point) => point.normalizedRadius <= 1.12)
  );
}

function findTwoColorBullCenter(points: readonly PolarAccentPoint[]): ImagePoint | null {
  // The outer bull is only about 9% of the double radius. Leave generous room for an initially
  // imperfect ring center, while remaining far inside the treble band and any surrounding branding.
  const localPoints = points.filter((point) => point.normalizedRadius <= 0.2);
  const redPoints = localPoints.filter((point) => point.color === 'red');
  const greenPoints = localPoints.filter((point) => point.color === 'green');
  if (localPoints.length < 12 || redPoints.length < 3 || greenPoints.length < 3) return null;
  return meanPoint(localPoints);
}

function findStandardRingPair(points: readonly PolarAccentPoint[]): StandardRingPair | null {
  let best: StandardRingPair | null = null;
  for (
    let outerRadius = RADIAL_CANDIDATE_START;
    outerRadius <= RADIAL_CANDIDATE_END;
    outerRadius += RADIAL_CANDIDATE_STEP
  ) {
    const innerRadius = outerRadius * TREBLE_TO_DOUBLE_RATIO;
    const radialHalfWidth = clamp(outerRadius * 0.055, 0.018, 0.06);
    const outer = evaluateRadialBand(points, outerRadius, radialHalfWidth);
    if (!hasRepeatedBoardColors(outer)) continue;
    const inner = evaluateRadialBand(points, innerRadius, clamp(innerRadius * 0.065, 0.016, 0.055));
    if (!hasRepeatedBoardColors(inner)) continue;
    const gap = evaluateRadialBand(
      points,
      outerRadius * SINGLE_BED_GAP_RATIO,
      clamp(outerRadius * 0.045, 0.014, 0.05),
    );

    // A scoring board contains uncolored single beds between treble and double. Compare the gap to
    // both selected bands so a large red/green filled surround cannot impersonate a board.
    const gapRatio =
      gap.points.length / Math.max(1, Math.min(outer.points.length, inner.points.length));
    if (gapRatio > 0.48) continue;

    // Printed red branding can be close to the double wire. A real board has an alternating
    // red/green harmonic around both bands; decorative text may have both hues in aggregate but
    // cannot usually reproduce the same 20-sector rhythm in the treble and double rings.
    const colorPhaseAgreement = alternatingPhaseAgreement(outer, inner);
    if (colorPhaseAgreement < 0.42) continue;

    const outerColorScore = Math.min(outer.redAngularCoverage, outer.greenAngularCoverage) / 10;
    const innerColorScore = Math.min(inner.redAngularCoverage, inner.greenAngularCoverage) / 10;
    const angularScore = (outer.angularCoverage + inner.angularCoverage) / 40;
    const gapScore = clamp(1 - gapRatio / 0.48, 0, 1);
    const signalScore = clamp(
      (Math.min(outer.redPointCount, outer.greenPointCount) +
        Math.min(inner.redPointCount, inner.greenPointCount)) /
        210,
      0,
      1,
    );
    const alternatingScore = (outer.alternatingColorStrength + inner.alternatingColorStrength) / 2;
    // Prefer the outer edge when adjacent samples are otherwise equally strong. This keeps the
    // inferred guide aligned with the outside of the double-color band rather than its inner wire.
    const edgePreference = clamp((outerRadius - 0.3) / 0.8, 0, 1);
    const patternScore = clamp(
      angularScore * 0.29 +
        ((outerColorScore + innerColorScore) / 2) * 0.21 +
        gapScore * 0.15 +
        signalScore * 0.11 +
        alternatingScore * 0.17 +
        colorPhaseAgreement * 0.05 +
        edgePreference * 0.02,
      0,
      1,
    );
    if (
      best === null ||
      patternScore > best.patternScore + 0.0001 ||
      (Math.abs(patternScore - best.patternScore) <= 0.0001 && outerRadius > best.outerRadius)
    ) {
      best = {
        outerRadius,
        innerRadius,
        outer,
        inner,
        gap,
        colorPhaseAgreement,
        patternScore,
      };
    }
  }
  return best;
}

function hasRepeatedBoardColors(band: RadialBandEvidence): boolean {
  const colorBalance =
    Math.min(band.redPointCount, band.greenPointCount) /
    Math.max(1, Math.max(band.redPointCount, band.greenPointCount));
  return (
    band.angularCoverage >= 14 &&
    band.redAngularCoverage >= 4 &&
    band.greenAngularCoverage >= 4 &&
    band.points.length >= 36 &&
    // A red surround can share an ellipse with a board. Alternating scoring bands have meaningful
    // samples of both colors, while a surround adds one color across every sector. The harmonic
    // also rejects one-color logos that happen to sit near a plausible ellipse.
    colorBalance >= 0.2 &&
    band.alternatingColorStrength >= 0.16
  );
}

function alternatingPhaseAgreement(first: RadialBandEvidence, second: RadialBandEvidence): number {
  if (first.alternatingColorStrength < 0.0001 || second.alternatingColorStrength < 0.0001) {
    return 0;
  }
  // Some board makers reverse the red/green assignment between rings. Treat equal and inverse
  // phases as consistent, while rejecting unrelated logo colors or a single accidental arc.
  return Math.abs(Math.cos(first.colorPhaseRadians - second.colorPhaseRadians));
}

function evaluateRadialBand(
  points: readonly PolarAccentPoint[],
  targetRadius: number,
  halfWidth: number,
): RadialBandEvidence {
  const selected: PolarAccentPoint[] = [];
  const sectors = new Set<number>();
  const redSectors = new Set<number>();
  const greenSectors = new Set<number>();
  let redPointCount = 0;
  let greenPointCount = 0;
  let alternatingCosine = 0;
  let alternatingSine = 0;
  for (const point of points) {
    if (Math.abs(point.normalizedRadius - targetRadius) > halfWidth) continue;
    selected.push(point);
    sectors.add(point.angularSector);
    const colorSign = point.color === 'red' ? 1 : -1;
    // Red/green scoring beds alternate twenty times around the board. A tenth angular harmonic
    // captures that structure without assuming where sector boundaries land in a camera frame.
    alternatingCosine += colorSign * Math.cos(point.angleRadians * 10);
    alternatingSine += colorSign * Math.sin(point.angleRadians * 10);
    if (point.color === 'red') {
      redSectors.add(point.angularSector);
      redPointCount += 1;
    } else {
      greenSectors.add(point.angularSector);
      greenPointCount += 1;
    }
  }
  const alternatingMagnitude = Math.hypot(alternatingCosine, alternatingSine);
  return {
    points: selected,
    redPointCount,
    greenPointCount,
    angularCoverage: sectors.size,
    redAngularCoverage: redSectors.size,
    greenAngularCoverage: greenSectors.size,
    alternatingColorStrength: alternatingMagnitude / Math.max(1, selected.length),
    colorPhaseRadians: Math.atan2(alternatingSine, alternatingCosine),
  };
}

function geometryPointsForColors(
  points: readonly AccentPoint[],
  redPixelCount: number,
  greenPixelCount: number,
): readonly AccentPoint[] {
  // Surfaces/surrounds and printed board branding are commonly one saturated color. A genuine
  // double/treble palette has similar red/green area, so let the less common color define broad
  // geometry as soon as one color is moderately more prevalent; the later radial-pair check still
  // requires both colors around both scoring bands.
  if (redPixelCount > greenPixelCount * 1.18) {
    const greenPoints = points.filter((point) => point.color === 'green');
    if (greenPoints.length >= 24) return greenPoints;
  }
  if (greenPixelCount > redPixelCount * 1.18) {
    const redPoints = points.filter((point) => point.color === 'red');
    if (redPoints.length >= 24) return redPoints;
  }
  return points;
}

function boardAccentColor(red: number, green: number, blue: number): AccentColor | null {
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  if (maximum < 38 || maximum - minimum < 22) return null;
  const saturation = (maximum - minimum) / maximum;
  if (saturation < 0.22) return null;

  const hue = hueDegrees(red, green, blue, maximum, minimum);
  // A warmly lit sisal/cork single bed can sit at an orange-red hue with modest saturation. Hue
  // alone then turns most of the light scoring beds into “red”, erasing the uncoloured gap that
  // distinguishes the double and treble bands. Real red beds remain materially red-dominant even
  // under a warm phone white balance, so require that channel relationship while allowing a little
  // more hue tolerance than the original narrow red window.
  const redDominant = red >= green * 1.32 && red >= blue * 1.32;
  if ((hue <= 44 || hue >= 330) && redDominant) return 'red';
  if (hue >= 62 && hue <= 184) return 'green';
  return null;
}

function hueDegrees(
  red: number,
  green: number,
  blue: number,
  maximum: number,
  minimum: number,
): number {
  const delta = maximum - minimum;
  if (delta === 0) return 0;
  let hue: number;
  if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
  else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
  else hue = 60 * ((red - green) / delta + 4);
  return hue < 0 ? hue + 360 : hue;
}

function isFrameUsable(frame: CameraFrame): boolean {
  return (
    Number.isInteger(frame.width) &&
    Number.isInteger(frame.height) &&
    frame.width >= 4 &&
    frame.height >= 4 &&
    frame.rgba.length === frame.width * frame.height * 4
  );
}

function meanPoint(points: readonly ImagePoint[]): ImagePoint {
  const total = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), {
    x: 0,
    y: 0,
  });
  return { x: total.x / points.length, y: total.y / points.length };
}

function findPrincipalAxes(
  points: readonly ImagePoint[],
  center: ImagePoint,
): Readonly<{ primary: ImagePoint; secondary: ImagePoint; anisotropy: number }> | null {
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (const point of points) {
    const x = point.x - center.x;
    const y = point.y - center.y;
    xx += x * x;
    yy += y * y;
    xy += x * y;
  }
  xx /= points.length;
  yy /= points.length;
  xy /= points.length;
  const trace = xx + yy;
  const spread = Math.sqrt(Math.max(0, (xx - yy) ** 2 + 4 * xy * xy));
  const larger = (trace + spread) / 2;
  const smaller = (trace - spread) / 2;
  if (!Number.isFinite(larger) || !Number.isFinite(smaller) || smaller <= 1) return null;
  const angle = Math.atan2(2 * xy, xx - yy) / 2;
  const primary = { x: Math.cos(angle), y: Math.sin(angle) };
  const secondary = { x: -Math.sin(angle), y: Math.cos(angle) };
  return {
    primary,
    secondary,
    anisotropy: Math.sqrt(larger) / Math.max(1, Math.sqrt(smaller)),
  };
}

function orientAxesForUprightBoard(
  axes: Readonly<{
    primary: ImagePoint;
    secondary: ImagePoint;
    anisotropy: number;
  }>,
): Readonly<{ horizontal: ImagePoint; vertical: ImagePoint }> {
  // A near-circular board has no reliable PCA direction, so preserve the camera-up / 20-up
  // assumption. With visible ellipse compression, retain the more vertical principal direction.
  if (axes.anisotropy < 1.08) {
    return { horizontal: { x: 1, y: 0 }, vertical: { x: 0, y: 1 } };
  }
  const candidate =
    Math.abs(axes.primary.y) >= Math.abs(axes.secondary.y) ? axes.primary : axes.secondary;
  const vertical = candidate.y >= 0 ? candidate : { x: -candidate.x, y: -candidate.y };
  const horizontalUnoriented = { x: vertical.y, y: -vertical.x };
  const horizontal =
    horizontalUnoriented.x >= 0
      ? horizontalUnoriented
      : { x: -horizontalUnoriented.x, y: -horizontalUnoriented.y };
  return { horizontal, vertical };
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  values.sort((left, right) => left - right);
  const index = Math.max(
    0,
    Math.min(values.length - 1, Math.round((values.length - 1) * fraction)),
  );
  return values[index]!;
}

function centerOfFit(fit: BoardFitPoints): ImagePoint {
  return {
    x: (fit[0].x + fit[1].x + fit[2].x + fit[3].x) / 4,
    y: (fit[0].y + fit[1].y + fit[2].y + fit[3].y) / 4,
  };
}

function distance(first: ImagePoint, second: ImagePoint): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function averageFitRadius(fit: BoardFitPoints, center: ImagePoint): number {
  return (
    fit.reduce((sum, point) => sum + Math.hypot(point.x - center.x, point.y - center.y), 0) /
    fit.length
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
