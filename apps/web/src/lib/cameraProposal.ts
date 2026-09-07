import type { DartZone } from '@darts-180/contracts';

/** A browser-local camera suggestion awaiting ordinary score review/correction. */
export interface CameraTurnProposal {
  zone: DartZone;
  confidence: number;
  wireMarginMm: number;
  source: 'auto' | 'corrected' | 'manual';
}
