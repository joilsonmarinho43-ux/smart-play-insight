/**
 * Probability integrity primitives.
 *
 * These functions deliberately separate:
 * - probability: estimated event likelihood [0,100]
 * - confidence: trust in the model/context [0,100]
 * - value: market/price comparison (must use a real odd)
 *
 * No function here invents a probability from a confidence score.
 */

export interface ProbabilityObservation {
  probability: number;
  occurred: boolean;
}

export interface CalibrationMetrics {
  count: number;
  brierScore: number | null;
  logLoss: number | null;
  expectedCalibrationError: number | null;
  meanPredicted: number | null;
  observedRate: number | null;
}

export interface ReliabilityBin {
  lower: number;
  upper: number;
  count: number;
  meanPredicted: number;
  observedRate: number;
}

export function validProbability(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < 0 || value > 100) return null;
  return value;
}

export function probabilityToDecimal(value: unknown): number | null {
  const p = validProbability(value);
  return p === null ? null : p / 100;
}

/** Brier score: lower is better. */
export function brierScore(observations: ProbabilityObservation[]): number | null {
  if (!observations.length) return null;
  let sum = 0;
  for (const o of observations) {
    const p = probabilityToDecimal(o.probability);
    if (p === null) return null;
    const y = o.occurred ? 1 : 0;
    sum += (p - y) ** 2;
  }
  return sum / observations.length;
}

/** Log loss: lower is better. Invalid probabilities are rejected. */
export function logLoss(observations: ProbabilityObservation[]): number | null {
  if (!observations.length) return null;
  let sum = 0;
  for (const o of observations) {
    const p = probabilityToDecimal(o.probability);
    if (p === null) return null;
    const clipped = Math.min(1 - 1e-15, Math.max(1e-15, p));
    const y = o.occurred ? 1 : 0;
    sum += -(y * Math.log(clipped) + (1 - y) * Math.log(1 - clipped));
  }
  return sum / observations.length;
}

/**
 * Reliability bins for calibration auditing. Empty bins are omitted.
 * Default: 10 percentage-point bins.
 */
export function reliabilityBins(
  observations: ProbabilityObservation[],
  binSize = 10,
): ReliabilityBin[] {
  if (!Number.isInteger(binSize) || binSize <= 0 || binSize > 100) return [];
  const bins = new Map<number, ProbabilityObservation[]>();
  for (const o of observations) {
    const p = validProbability(o.probability);
    if (p === null) continue;
    const lower = Math.min(100 - binSize, Math.floor(p / binSize) * binSize);
    if (!bins.has(lower)) bins.set(lower, []);
    bins.get(lower)!.push(o);
  }

  return [...bins.entries()]
    .sort(([a], [b]) => a - b)
    .map(([lower, items]) => ({
      lower,
      upper: Math.min(100, lower + binSize),
      count: items.length,
      meanPredicted: items.reduce((s, x) => s + x.probability, 0) / items.length,
      observedRate: (items.filter(x => x.occurred).length / items.length) * 100,
    }));
}

/** Expected calibration error, weighted by bin frequency. Lower is better. */
export function expectedCalibrationError(
  observations: ProbabilityObservation[],
  binSize = 10,
): number | null {
  if (!observations.length) return null;
  const bins = reliabilityBins(observations, binSize);
  if (!bins.length) return null;
  return bins.reduce(
    (sum, bin) => sum + (bin.count / observations.length) * Math.abs(bin.meanPredicted - bin.observedRate),
    0,
  ) / 100;
}

export function calibrationMetrics(observations: ProbabilityObservation[]): CalibrationMetrics {
  if (!observations.length) {
    return { count: 0, brierScore: null, logLoss: null, expectedCalibrationError: null, meanPredicted: null, observedRate: null };
  }
  const valid = observations.filter(o => validProbability(o.probability) !== null);
  if (!valid.length) {
    return { count: 0, brierScore: null, logLoss: null, expectedCalibrationError: null, meanPredicted: null, observedRate: null };
  }
  return {
    count: valid.length,
    brierScore: brierScore(valid),
    logLoss: logLoss(valid),
    expectedCalibrationError: expectedCalibrationError(valid),
    meanPredicted: valid.reduce((s, o) => s + o.probability, 0) / valid.length,
    observedRate: valid.filter(o => o.occurred).length / valid.length,
  };
}

/**
 * Converts a genuine decimal odd into implied probability.
 * This is intentionally separate from model probability.
 */
export function impliedProbabilityFromOdd(odd: unknown): number | null {
  if (typeof odd !== 'number' || !Number.isFinite(odd) || odd <= 1) return null;
  return 1 / odd;
}

/** Value exists only when a real market odd is available. */
export function hasPositiveExpectedValue(modelProbability: unknown, odd: unknown): boolean {
  const p = probabilityToDecimal(modelProbability);
  const implied = impliedProbabilityFromOdd(odd);
  return p !== null && implied !== null && p > implied;
}
