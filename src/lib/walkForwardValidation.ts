/**
 * Nexus Walk-Forward Validation
 *
 * Chronological, out-of-sample evaluation for analytical predictions.
 * A test observation is never allowed to influence the training window.
 * This module audits model outputs; it never executes bets/orders.
 */

import { calibrationMetrics, type ProbabilityObservation } from './probabilityIntegrity';

export interface WalkForwardObservation extends ProbabilityObservation {
  occurredAt: number;
  modelVersion: string;
}

export interface WalkForwardFold {
  train: WalkForwardObservation[];
  test: WalkForwardObservation[];
  trainEndAt: number;
  testStartAt: number;
}

export interface WalkForwardEvaluation {
  folds: WalkForwardFold[];
  testObservations: WalkForwardObservation[];
  metrics: ReturnType<typeof calibrationMetrics>;
  leakageDetected: boolean;
  valid: boolean;
  reason: string;
}

function validObservation(o: WalkForwardObservation): boolean {
  return Number.isFinite(o.occurredAt) && o.occurredAt > 0 &&
    typeof o.modelVersion === 'string' && o.modelVersion.trim().length > 0 &&
    Number.isFinite(o.probability) && o.probability >= 0 && o.probability <= 100 &&
    typeof o.occurred === 'boolean';
}

/**
 * Builds expanding chronological folds. Each test window starts strictly after
 * the corresponding training window, preventing temporal leakage.
 */
export function buildWalkForwardFolds(
  observations: WalkForwardObservation[],
  minTrainSize = 30,
  testSize = 10,
): WalkForwardFold[] {
  if (!Number.isInteger(minTrainSize) || minTrainSize < 1 ||
      !Number.isInteger(testSize) || testSize < 1) return [];

  const valid = observations.filter(validObservation).sort((a, b) => a.occurredAt - b.occurredAt);
  const folds: WalkForwardFold[] = [];

  for (let trainEnd = minTrainSize; trainEnd < valid.length; trainEnd += testSize) {
    const train = valid.slice(0, trainEnd);
    const test = valid.slice(trainEnd, trainEnd + testSize);
    if (!test.length) break;
    const trainEndAt = train[train.length - 1].occurredAt;
    const testStartAt = test[0].occurredAt;
    if (testStartAt <= trainEndAt) continue;
    folds.push({ train, test, trainEndAt, testStartAt });
  }

  return folds;
}

/**
 * Evaluates only out-of-sample test rows. The implementation intentionally
 * ignores training outcomes when calculating final performance metrics.
 */
export function evaluateWalkForward(
  observations: WalkForwardObservation[],
  minTrainSize = 30,
  testSize = 10,
): WalkForwardEvaluation {
  const validInput = observations.filter(validObservation);
  const folds = buildWalkForwardFolds(validInput, minTrainSize, testSize);
  const testObservations = folds.flatMap((fold) => fold.test);
  const leakageDetected = folds.some((fold) => fold.test.some((row) => row.occurredAt <= fold.trainEndAt));

  if (leakageDetected) {
    return {
      folds,
      testObservations,
      metrics: calibrationMetrics([]),
      leakageDetected: true,
      valid: false,
      reason: 'TEMPORAL_LEAKAGE',
    };
  }

  if (!folds.length) {
    return {
      folds: [],
      testObservations: [],
      metrics: calibrationMetrics([]),
      leakageDetected: false,
      valid: false,
      reason: 'INSUFFICIENT_TIME_SERIES',
    };
  }

  return {
    folds,
    testObservations,
    metrics: calibrationMetrics(testObservations),
    leakageDetected: false,
    valid: true,
    reason: 'OUT_OF_SAMPLE_VALIDATION',
  };
}
