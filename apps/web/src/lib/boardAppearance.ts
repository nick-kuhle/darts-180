export interface BoardSegmentAppearance {
  singleColor: string;
  accentColor: string;
}

/**
 * Conventional dartboard palette by position in STANDARD_SEGMENT_ORDER, beginning at D20.
 * D20 is dark with red double/treble beds; its adjacent D1 and D5 positions are light with green
 * accents. Keep this separate from camera color fitting: it is an accurate player-facing rendering,
 * not a claim that black/white alone can identify the physical number ring.
 */
export function conventionalSegmentAppearance(index: number): BoardSegmentAppearance {
  const redAccentSegment = Math.abs(index) % 2 === 0;
  return {
    singleColor: redAccentSegment ? '#1f2927' : '#e6d6b8',
    accentColor: redAccentSegment ? '#d6463d' : '#1b9568',
  };
}
