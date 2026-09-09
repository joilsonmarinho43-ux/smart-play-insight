import { describe, expect, it } from 'vitest';
import {
  evaluateCalibration,
  MIN_CALIBRATION_SAMPLE,
  validCalibrationObservations,
  wilsonInterval,
} from '@/lib/calibrationEngineV2';

describe('calibrationEngineV2', () => {
  it('does not call a small sample statistically usable', () => {
    const result = evaluateCalibration([
      { probability: 80, occurred: true },
      { probability: 80, occurred: false },
    ]);
    expect(result.count).toBe(2);
    expect(result.statisticallyUsable).toBe(false);
    expect(result.reason).toBe('INSUFFICIENT_SAMPLE');
    expect(MIN_CALIBRATION_SAMPLE).toBe(30);
  });

  it('marks a sufficiently large sample as usable for audit', () => {
    const observations = Array.from({ length: 30 }, (_, i) => ({
      probability: i % 2 === 0 ? 70 : 60,
      occurred: i % 2 === 0,
    }));
    const result = evaluateCalibration(observations);
    expect(result.statisticallyUsable).toBe(true);
    expect(result.brierScore).not.toBeNull();
    expect(result.logLoss).not.toBeNull();
    expect(result.expectedCalibrationError).not.toBeNull();
  });

  it('returns a bounded Wilson confidence interval', () => {
    const interval = wilsonInterval(18, 30);
    expect(interval).not.toBeNull();
    expect(interval![0]).toBeGreaterThanOrEqual(0);
    expect(interval![1]).toBeLessThanOrEqual(1);
    expect(interval![0]).toBeLessThan(interval![1]);
  });

  it('rejects ledger rows without provenance', () => {
    const valid = validCalibrationObservations([
      { probability: 70, occurred: true, market: 'Over 1.5', modelVersion: 'v1', occurredAt: 1000 },
      { probability: 70, occurred: true, market: '', modelVersion: 'v1', occurredAt: 1000 },
      { probability: 70, occurred: true, market: 'Over 1.5', modelVersion: '', occurredAt: 1000 },
      { probability: 70, occurred: true, market: 'Over 1.5', modelVersion: 'v1', occurredAt: 0 },
      { probability: 101, occurred: true, market: 'Over 1.5', modelVersion: 'v1', occurredAt: 1000 },
    ]);
    expect(valid).toHaveLength(1);
  });
});
