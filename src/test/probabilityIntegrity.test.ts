import { describe, expect, it } from 'vitest';
import {
  brierScore,
  calibrationMetrics,
  expectedCalibrationError,
  hasPositiveExpectedValue,
  impliedProbabilityFromOdd,
  logLoss,
  probabilityToDecimal,
  reliabilityBins,
  validProbability,
} from '@/lib/probabilityIntegrity';

describe('probabilityIntegrity', () => {
  it('rejects invalid probabilities instead of coercing them', () => {
    expect(validProbability(NaN)).toBeNull();
    expect(validProbability(Infinity)).toBeNull();
    expect(validProbability(-1)).toBeNull();
    expect(validProbability(101)).toBeNull();
    expect(probabilityToDecimal(undefined)).toBeNull();
  });

  it('calculates perfect Brier score and near-zero log loss for perfect predictions', () => {
    const data = [
      { probability: 100, occurred: true },
      { probability: 0, occurred: false },
    ];
    expect(brierScore(data)).toBe(0);
    expect(logLoss(data)).toBeLessThan(1e-10);
  });

  it('exposes calibration rather than calling a win rate a probability', () => {
    const data = [
      { probability: 80, occurred: true },
      { probability: 80, occurred: false },
      { probability: 80, occurred: true },
      { probability: 20, occurred: false },
    ];
    const metrics = calibrationMetrics(data);
    expect(metrics.count).toBe(4);
    expect(metrics.meanPredicted).toBe(65);
    expect(metrics.observedRate).toBe(0.5);
    expect(metrics.brierScore).not.toBeNull();
    expect(metrics.logLoss).not.toBeNull();
    expect(metrics.expectedCalibrationError).not.toBeNull();
  });

  it('builds reliability bins', () => {
    const bins = reliabilityBins([
      { probability: 81, occurred: true },
      { probability: 89, occurred: false },
      { probability: 21, occurred: false },
    ]);
    expect(bins.map(b => b.lower)).toEqual([20, 80]);
    expect(bins[1].count).toBe(2);
    expect(expectedCalibrationError([
      { probability: 80, occurred: true },
      { probability: 80, occurred: false },
    ])).toBe(0.3);
  });

  it('requires a genuine odd for implied probability and value', () => {
    expect(impliedProbabilityFromOdd(2)).toBe(0.5);
    expect(impliedProbabilityFromOdd(undefined)).toBeNull();
    expect(hasPositiveExpectedValue(60, 2)).toBe(true);
    expect(hasPositiveExpectedValue(40, 2)).toBe(false);
    expect(hasPositiveExpectedValue(99, undefined)).toBe(false);
  });
});
