import { describe, expect, it } from 'vitest';
import { buildWalkForwardWindows, evaluateWalkForward } from '@/lib/walkForward';

describe('walkForward', () => {
  const records = Array.from({ length: 8 }, (_, i) => ({
    probability: 60 + i,
    occurred: i % 2 === 0,
    occurredAt: i + 1,
    modelVersion: 'v1',
  }));
  it('keeps test observations strictly after training', () => {
    const windows = buildWalkForwardWindows(records, 4, 2);
    expect(windows.length).toBeGreaterThan(0);
    for (const window of windows) {
      expect(Math.min(...window.test.map(x => x.occurredAt))).toBeGreaterThan(Math.max(...window.train.map(x => x.occurredAt)));
    }
  });
  it('reports chronological evaluation metrics', () => {
    const result = evaluateWalkForward(buildWalkForwardWindows(records, 4, 2));
    expect(result.leakageDetected).toBe(false);
    expect(result.testObservations).toBeGreaterThan(0);
    expect(result.brierScore).not.toBeNull();
    expect(result.logLoss).not.toBeNull();
  });
});
