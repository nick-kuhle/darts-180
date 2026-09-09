export interface ImagePoint {
  x: number;
  y: number;
}

export interface CanonicalPoint {
  xMm: number;
  yMm: number;
}

export interface AnnotationAnchor {
  id: string;
  title: string;
  instruction: string;
  canonical: CanonicalPoint;
}

/**
 * These four known locations are centres of the named double beds on a correctly oriented board.
 * An annotator clicks the visible, named bed rather than an arbitrary apparent ellipse extremum.
 */
export const ANNOTATION_ANCHORS: readonly AnnotationAnchor[] = [
  {
    id: 'd20-top',
    title: 'D20 · top',
    instruction: 'Click the centre of the D20 double bed at 12 o’clock.',
    canonical: { xMm: 0, yMm: -166 },
  },
  {
    id: 'd6-right',
    title: 'D6 · right',
    instruction: 'Click the centre of the D6 double bed at 3 o’clock.',
    canonical: { xMm: 166, yMm: 0 },
  },
  {
    id: 'd3-bottom',
    title: 'D3 · bottom',
    instruction: 'Click the centre of the D3 double bed at 6 o’clock.',
    canonical: { xMm: 0, yMm: 166 },
  },
  {
    id: 'd11-left',
    title: 'D11 · left',
    instruction: 'Click the centre of the D11 double bed at 9 o’clock.',
    canonical: { xMm: -166, yMm: 0 },
  },
] as const;

/**
 * The source-compatible landmarks for the five-point development detector. They are deliberately
 * not the centres of D20/D6/D3/D11: each lies at the outer-double rim on a named segment boundary.
 * These standard-frame positions are the DeepDarts source cal1–4 coordinates after the documented
 * −9° adapter used by the isolated development engine.
 */
export const DEVELOPMENT_FIVE_POINT_ANNOTATION_ANCHORS: readonly AnnotationAnchor[] = [
  {
    id: 'cal1',
    title: 'CAL 1 · D5 / D20 rim junction',
    instruction: 'Click the outer-double rim junction between D5 and D20.',
    canonical: { xMm: -26.594, yMm: -167.907 },
  },
  {
    id: 'cal2',
    title: 'CAL 2 · D17 / D3 rim junction',
    instruction: 'Click the outer-double rim junction between D17 and D3.',
    canonical: { xMm: 26.594, yMm: 167.907 },
  },
  {
    id: 'cal3',
    title: 'CAL 3 · D8 / D11 rim junction',
    instruction: 'Click the outer-double rim junction between D8 and D11.',
    canonical: { xMm: -167.907, yMm: 26.594 },
  },
  {
    id: 'cal4',
    title: 'CAL 4 · D13 / D6 rim junction',
    instruction: 'Click the outer-double rim junction between D13 and D6.',
    canonical: { xMm: 167.907, yMm: -26.594 },
  },
] as const;

/** Row-major projective matrix mapping image pixels to canonical board millimetres. */
export type Homography = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/**
 * Solve an exactly determined 4-point image→canonical homography with h33 fixed to one.
 * `null` means the points are degenerate or numerically unusable and must be clicked again.
 */
export function solveImageToBoardHomography(
  imagePoints: readonly ImagePoint[],
  boardPoints: readonly CanonicalPoint[],
): Homography | null {
  if (imagePoints.length !== 4 || boardPoints.length !== 4) return null;

  const coefficients: number[][] = [];
  const values: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    const image = imagePoints[index];
    const board = boardPoints[index];
    if (image === undefined || board === undefined) return null;
    const { x, y } = image;
    const { xMm, yMm } = board;
    if (![x, y, xMm, yMm].every(Number.isFinite)) return null;
    coefficients.push([x, y, 1, 0, 0, 0, -x * xMm, -y * xMm]);
    values.push(xMm);
    coefficients.push([0, 0, 0, x, y, 1, -x * yMm, -y * yMm]);
    values.push(yMm);
  }

  const solution = solveLinearSystem(coefficients, values);
  if (solution === null || solution.some((value) => !Number.isFinite(value))) return null;
  return [
    solution[0] ?? 0,
    solution[1] ?? 0,
    solution[2] ?? 0,
    solution[3] ?? 0,
    solution[4] ?? 0,
    solution[5] ?? 0,
    solution[6] ?? 0,
    solution[7] ?? 0,
    1,
  ];
}

export function mapImagePointToBoard(
  imagePoint: ImagePoint,
  homography: Homography,
): CanonicalPoint | null {
  const point = mapProjectivePoint(imagePoint.x, imagePoint.y, homography);
  return point === null ? null : { xMm: point.x, yMm: point.y };
}

/**
 * Inverts a projective transform so a canonical board guide can be drawn over camera pixels.
 * `null` means the manual shape is degenerate and should be reset rather than guessed through.
 */
export function invertHomography(homography: Homography): Homography | null {
  const [a, b, c, d, e, f, g, h, i] = homography;
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;
  const inverse: Homography = [
    (e * i - f * h) / determinant,
    (c * h - b * i) / determinant,
    (b * f - c * e) / determinant,
    (f * g - d * i) / determinant,
    (a * i - c * g) / determinant,
    (c * d - a * f) / determinant,
    (d * h - e * g) / determinant,
    (b * g - a * h) / determinant,
    (a * e - b * d) / determinant,
  ];
  return inverse.every(Number.isFinite) ? inverse : null;
}

/** Maps canonical millimetres back to camera pixels using an inverted image→board transform. */
export function mapBoardPointToImage(
  boardPoint: CanonicalPoint,
  boardToImageHomography: Homography,
): ImagePoint | null {
  const point = mapProjectivePoint(boardPoint.xMm, boardPoint.yMm, boardToImageHomography);
  return point === null ? null : { x: point.x, y: point.y };
}

function mapProjectivePoint(
  x: number,
  y: number,
  homography: Homography,
): Readonly<{ x: number; y: number }> | null {
  const [h11, h12, h13, h21, h22, h23, h31, h32, h33] = homography;
  const denominator = h31 * x + h32 * y + h33;
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-9) return null;
  const mappedX = (h11 * x + h12 * y + h13) / denominator;
  const mappedY = (h21 * x + h22 * y + h23) / denominator;
  return Number.isFinite(mappedX) && Number.isFinite(mappedY) ? { x: mappedX, y: mappedY } : null;
}

function solveLinearSystem(coefficients: number[][], values: number[]): number[] | null {
  const dimension = values.length;
  if (coefficients.length !== dimension || coefficients.some((row) => row.length !== dimension)) {
    return null;
  }
  const augmented = coefficients.map((row, index) => [...row, values[index] ?? 0]);

  for (let column = 0; column < dimension; column += 1) {
    let pivotRow = column;
    for (let row = column + 1; row < dimension; row += 1) {
      if (Math.abs(augmented[row]?.[column] ?? 0) > Math.abs(augmented[pivotRow]?.[column] ?? 0)) {
        pivotRow = row;
      }
    }
    const pivot = augmented[pivotRow]?.[column] ?? 0;
    if (!Number.isFinite(pivot) || Math.abs(pivot) < 1e-10) return null;
    [augmented[column], augmented[pivotRow]] = [augmented[pivotRow]!, augmented[column]!];

    const normalizedPivot = augmented[column]![column]!;
    for (let item = column; item <= dimension; item += 1) {
      augmented[column]![item] = (augmented[column]![item] ?? 0) / normalizedPivot;
    }
    for (let row = 0; row < dimension; row += 1) {
      if (row === column) continue;
      const factor = augmented[row]![column] ?? 0;
      if (factor === 0) continue;
      for (let item = column; item <= dimension; item += 1) {
        augmented[row]![item] =
          (augmented[row]![item] ?? 0) - factor * (augmented[column]![item] ?? 0);
      }
    }
  }
  return augmented.map((row) => row[dimension] ?? 0);
}
