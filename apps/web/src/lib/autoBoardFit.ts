import type { ImagePoint } from './annotationGeometry';
import type { BoardFitPoints } from './boardFit';
import type { CameraFrame } from './cameraScoring';

export type AutoBoardFitStatus = 'found' | 'not-found' | 'too-small';

/**
 * Result of a browser-local standard-board color fit. It is a bootstrap heuristic, not a learned
 * board detector: red/green accent pixels estimate the board ellipse and assume the physical 20 is
 * upright in the camera image. It deliberately reports uncertainty rather than inventing a board.
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
  outerRingFraction: number;
  innerRingFraction: number;
  interBandFraction: number;
  outerAngularCoverage: number;
  confidence: number;
  message: string;
}

type AccentColor = 'red' | 'green';
type AccentPoint = ImagePoint & Readonly<{ color: AccentColor }>;

const MINIMUM_WORKING_DIAMETER = 170;

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
    confidence: 0,
    message,
  });

  if (
    !Number.isInteger(frame.width) ||
    !Number.isInteger(frame.height) ||
    frame.width < 4 ||
    frame.height < 4 ||
    frame.rgba.length !== frame.width * frame.height * 4
  ) {
    return empty(
      'not-found',
      'Waiting for a complete camera frame before looking for board colors.',
    );
  }

  // The preview is already capped at 960 px on its long edge. This extra sampling keeps a repeating
  // color search inexpensive enough to run alongside the camera without exporting any media.
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

  const center = meanPoint(accentPixels);
  const principalAxes = findPrincipalAxes(accentPixels, center);
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
  const xDistances: number[] = [];
  const yDistances: number[] = [];
  for (const point of accentPixels) {
    const deltaX = point.x - center.x;
    const deltaY = point.y - center.y;
    xDistances.push(Math.abs(deltaX * axes.horizontal.x + deltaY * axes.horizontal.y));
    yDistances.push(Math.abs(deltaX * axes.vertical.x + deltaY * axes.vertical.y));
  }
  const horizontalRadius = percentile(xDistances, 0.985);
  const verticalRadius = percentile(yDistances, 0.985);
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
      'The colored board shape is too small or narrow to score from. Move the phone closer and show the full double ring.',
      accentPixels.length,
      sampledPixelCount,
      redPixelCount,
      greenPixelCount,
    );
  }

  let outerRingPixels = 0;
  let innerRingPixels = 0;
  let interBandPixels = 0;
  const outerAngularBuckets = new Set<number>();
  for (const point of accentPixels) {
    const deltaX = point.x - center.x;
    const deltaY = point.y - center.y;
    const normalizedX =
      (deltaX * axes.horizontal.x + deltaY * axes.horizontal.y) / horizontalRadius;
    const normalizedY = (deltaX * axes.vertical.x + deltaY * axes.vertical.y) / verticalRadius;
    const normalizedRadius = Math.hypot(normalizedX, normalizedY);
    if (normalizedRadius >= 0.84 && normalizedRadius <= 1.12) {
      outerRingPixels += 1;
      const angle = Math.atan2(normalizedY, normalizedX);
      outerAngularBuckets.add(Math.floor(((angle + Math.PI) / (2 * Math.PI)) * 20) % 20);
    }
    // A standard board has a second colored scoring band near this radius. Requiring it prevents
    // a red/green poster edge or one ring-like object from becoming a scoring board.
    if (normalizedRadius >= 0.47 && normalizedRadius <= 0.74) innerRingPixels += 1;
    // The uncolored single bed between treble and double is equally useful evidence: a colored
    // filled oval may share two colors and an ellipse, but it does not have this radial gap.
    if (normalizedRadius >= 0.74 && normalizedRadius <= 0.85) interBandPixels += 1;
  }
  const outerRingFraction = outerRingPixels / accentPixels.length;
  const innerRingFraction = innerRingPixels / accentPixels.length;
  const interBandFraction = interBandPixels / accentPixels.length;
  const outerAngularCoverage = outerAngularBuckets.size;
  if (
    outerRingFraction < 0.08 ||
    outerAngularCoverage < 12 ||
    innerRingFraction < 0.05 ||
    interBandFraction > 0.12
  ) {
    return empty(
      'not-found',
      'I found color but not the repeated red/green double and treble-band pattern of a complete board. Reframe the full board and reduce reflections.',
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
  const colorCoverage = accentPixels.length / sampledPixelCount;
  const colorScore = clamp((colorCoverage - 0.003) / 0.035, 0, 1);
  const colorBalanceScore = clamp(
    Math.min(redPixelCount, greenPixelCount) / Math.max(redPixelCount, greenPixelCount),
    0,
    1,
  );
  const outerRingScore = clamp((outerRingFraction - 0.08) / 0.38, 0, 1);
  const innerRingScore = clamp((innerRingFraction - 0.05) / 0.28, 0, 1);
  const interBandGapScore = clamp((0.12 - interBandFraction) / 0.12, 0, 1);
  const angularCoverageScore = clamp((outerAngularCoverage - 12) / 8, 0, 1);
  const sizeScore = clamp((estimatedBoardDiameterPixels - MINIMUM_WORKING_DIAMETER) / 420, 0, 1);
  const confidence = clamp(
    colorScore * 0.18 +
      colorBalanceScore * 0.12 +
      outerRingScore * 0.2 +
      innerRingScore * 0.12 +
      interBandGapScore * 0.1 +
      angularCoverageScore * 0.13 +
      sizeScore * 0.15,
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
    outerRingFraction,
    innerRingFraction,
    interBandFraction,
    outerAngularCoverage,
    confidence,
    message:
      'Board colors found. The automatic fit assumes the physical 20 is upright in the camera image.',
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
  return Math.abs(firstRadius - secondRadius) / Math.max(1, firstRadius) <= maximumRadiusChange;
}

function boardAccentColor(red: number, green: number, blue: number): AccentColor | null {
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  if (maximum < 45 || maximum - minimum < 26) return null;
  const saturation = (maximum - minimum) / maximum;
  if (saturation < 0.28) return null;

  const hue = hueDegrees(red, green, blue, maximum, minimum);
  // Broad phone-camera-friendly ranges for the conventional red / green scoring bands.
  if (hue <= 28 || hue >= 336) return 'red';
  if (hue >= 68 && hue <= 178) return 'green';
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
  // A near-circular board has no reliable PCA direction, so preserve the intuitive camera-up / 20-up
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

function averageFitRadius(fit: BoardFitPoints, center: ImagePoint): number {
  return (
    fit.reduce((sum, point) => sum + Math.hypot(point.x - center.x, point.y - center.y), 0) /
    fit.length
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
