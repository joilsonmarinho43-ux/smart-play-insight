import { describe, expect, it } from 'vitest';
import { assessDataQuality } from '@/lib/dataQualityGate';

describe('dataQualityGate', () => {
  const now = '2026-09-08T12:00:00.000Z';
  it('rejects stale live data', () => {
    const result = assessDataQuality({ live: true, observedAt: '2026-09-08T11:56:00.000Z', now });
    expect(result.status).toBe('REJECT');
    expect(result.reasons).toContain('DATA_STALE');
  });
  it('rejects live data without a timestamp', () => {
    const result = assessDataQuality({ live: true, now });
    expect(result.status).toBe('REJECT');
    expect(result.reasons).toContain('LIVE_TIMESTAMP_MISSING');
  });
  it('degrades estimated data but does not pretend it is exact', () => {
    const result = assessDataQuality({ live: false, estimatedData: true, sourceCompleteness: 95 });
    expect(result.status).toBe('DEGRADED');
    expect(result.reasons).toContain('ESTIMATED_DATA');
  });
  it('rejects insufficient sample when sample size is supplied', () => {
    const result = assessDataQuality({ sampleSize: 2, requiredSampleSize: 3 });
    expect(result.status).toBe('REJECT');
    expect(result.reasons).toContain('INSUFFICIENT_SAMPLE');
  });
});
