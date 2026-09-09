import { describe, expect, it } from 'vitest';
import { buildWalkForwardFolds, evaluateWalkForward } from '@/lib/walkForwardValidation';

const rows = (count: number) => Array.from({ length: count }, (_, i) => ({
  probability: 70,
  occurred: i % 3 !== 0,
  occurredAt: i + 1,
  modelVersion: 'v1',
}));

describe('walkForwardValidation', () => {
  it('creates strictly chronological expanding folds', () => {
    const folds = buildWalkForwardFolds(rows(55), 30, 10);
    expect(folds).toHaveLength(3);
    for (const fold of folds) {
      expect(fold.testStartAt).toBeGreaterThan(fold.trainEndAt);
      expect(fold.test.every((r) => r.occurredAt > fold.trainEndAt)).toBe(true);
    }
  });

  it('calculates metrics only from out-of-sample rows', () => {
    const result = evaluateWalkForward(rows(55), 30, 10);
    expect(result.valid).toBe(true);
    expect(result.leakageDetected).toBe(false);
    expect(result.testObservations).toHaveLength(25);
    expect(result.metrics.count).toBe(25);
    expect(result.reason).toBe('OUT_OF_SAMPLE_VALIDATION');
  });

  it('fails closed when there is not enough chronological data', () => {
    const result = evaluateWalkForward(rows(30), 30, 10);
    expect(result.valid).toBe(false);
    expect(result.leakageDetected).toBe(false);
    expect(result.reason).toBe('INSUFFICIENT_TIME_SERIES');
  });

  it('drops malformed provenance rows before creating folds', () => {
    const result = evaluateWalkForward([
      ...rows(35),
      { probability: 70, occurred: true, occurredAt: 0, modelVersion: 'v1' },
      { probability: 101, occurred: true, occurredAt: 100, modelVersion: 'v1' },
      { probability: 70, occurred: true, occurredAt: 101, modelVersion: '' },
    ], 30, 5);
    expect(result.valid).toBe(true);
    expect(result.testObservations.every((r) => r.occurredAt > 0 && r.probability <= 100 && r.modelVersion === 'v1')).toBe(true);
  });
});
