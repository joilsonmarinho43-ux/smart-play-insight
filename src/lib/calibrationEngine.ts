/**
 * Legacy compatibility adapter.
 *
 * Historical hit-rate multipliers are not calibration. The authoritative
 * calibration path is calibrationEngineV2 + prediction_ledger observations.
 * This module remains only so old imports fail closed instead of applying
 * heuristic confidence bonuses from legacy trading tables.
 */
export interface MarketCalibration {
  market: string;
  wins: number;
  losses: number;
  total: number;
  winRate: number;
  multiplier: number;
  trend: 'hot' | 'cold' | 'neutral';
}

export interface CalibrationProfile {
  markets: MarketCalibration[];
  updatedAt: number;
  sampleSize: number;
}

export async function getCalibrationProfile(): Promise<CalibrationProfile> {
  return { markets: [], updatedAt: Date.now(), sampleSize: 0 };
}

/** Never modify model confidence using historical hit-rate heuristics. */
export function getMarketMultiplier(_profile: CalibrationProfile, _marketName: string): number {
  return 1;
}

/** Compatibility function: preserves the supplied value without calibration bonus. */
export function calibrateConfidence(_profile: CalibrationProfile, _marketName: string, rawConfidence: number): number {
  return Math.round(Math.min(95, Math.max(0, rawConfidence)));
}
