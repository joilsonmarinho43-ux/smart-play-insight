import {
  calibrationMetrics,
  type ProbabilityObservation,
  reliabilityBins,
} from '@/lib/probabilityIntegrity';

/**
 * Calibration Engine 2.0
 *
 * Audit layer only: it measures whether historical probabilities behaved like
 * probabilities. It does not turn a hit-rate into a probability and it does
 * not silently alter model confidence.
 */

export interface CalibrationEvaluation {
  count: number;
  meanPredicted: number | null;
  observedRate: number | null;
  brierScore: number | null;
  logLoss: number | null;
  expectedCalibrationError: number | null;
  reliability: ReturnType<typeof reliabilityBins>;
  statisticallyUsable: boolean;
  reason: string;
}

export interface CalibrationGroupObservation extends ProbabilityObservation {
  market: string;
  league?: string;
  modelVersion: string;
  occurredAt: number;
}

const MIN_CALIBRATION_SAMPLE = 30;

function validTimestamp(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/** Wilson interval for the observed event rate; returned as decimal [0,1]. */
export function wilsonInterval(
  successes: number,
  total: number,
  z = 1.96,
): [number, number] | null {
  if (!Number.isInteger(successes) || !Number.isInteger(total) || total <= 0) return null;
  if (successes < 0 || successes > total || !Number.isFinite(z) || z <= 0) return null;
  const p = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const centre = (p + z2 / (2 * total)) / denominator;
  const margin = (z / denominator) * Math.sqrt((p * (1 - p) / total) + z2 / (4 * total * total));
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
}

/** Evaluate a historical sample without claiming that small samples are calibrated. */
export function evaluateCalibration(
  observations: ProbabilityObservation[],
  minSample = MIN_CALIBRATION_SAMPLE,
): CalibrationEvaluation {
  const metrics = calibrationMetrics(observations);
  const reliability = reliabilityBins(observations);
  const statisticallyUsable = metrics.count >= minSample;

  return {
    count: metrics.count,
    meanPredicted: metrics.meanPredicted,
    observedRate: metrics.observedRate,
    brierScore: metrics.brierScore,
    logLoss: metrics.logLoss,
    expectedCalibrationError: metrics.expectedCalibrationError,
    reliability,
    statisticallyUsable,
    reason: statisticallyUsable ? 'SUFFICIENT_SAMPLE' : 'INSUFFICIENT_SAMPLE',
  };
}

/**
 * Filters malformed ledger rows before calibration. A missing model version or
 * timestamp is a provenance failure, not a reason to guess a value.
 */
export function validCalibrationObservations(
  observations: CalibrationGroupObservation[],
): CalibrationGroupObservation[] {
  return observations.filter((o) =>
    typeof o.market === 'string' && o.market.trim().length > 0 &&
    typeof o.modelVersion === 'string' && o.modelVersion.trim().length > 0 &&
    validTimestamp(o.occurredAt) &&
    Number.isFinite(o.probability) && o.probability >= 0 && o.probability <= 100 &&
    typeof o.occurred === 'boolean',
  );
}

export { MIN_CALIBRATION_SAMPLE };
