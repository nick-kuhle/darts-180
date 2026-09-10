import type { DartZone } from '@darts-180/contracts';

/** A browser-local camera suggestion awaiting ordinary score review/correction. */
export interface CameraTurnProposal {
  zone: DartZone;
  confidence: number;
  wireMarginMm: number;
  source: 'auto' | 'corrected' | 'manual';
  /** A learned or diagnostic proposal may fill a card but still require player review. */
  disposition?: 'auto-score' | 'review';
  /** True only for the isolated five-point development scorer; forces a human review action. */
  developmentSuggestion?: true;
}
