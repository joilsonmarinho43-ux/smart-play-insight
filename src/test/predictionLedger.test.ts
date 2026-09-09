import { describe, expect, it } from 'vitest';
import { createPredictionRecord, resolvePrediction } from '@/lib/predictionLedger';

describe('predictionLedger', () => {
  const base = {
    predictionId: 'p1', matchId: 'm1', market: 'Over 1.5', probability: 82,
    confidence: 88, modelVersion: 'nexus-v1', mode: 'PRE_MATCH' as const,
    probabilitySource: 'MODEL_ESTIMATE' as const,
    calibrationStatus: 'UNCALIBRATED' as const,
    marketOdd: null,
    predictedAt: '2026-09-08T10:00:00Z', dataObservedAt: null,
    dataQualityScore: 98, dataQualityStatus: 'VALID' as const,
  };

  it('creates unresolved records only from valid provenance', () => {
    const record = createPredictionRecord(base);
    expect(record?.outcome).toBeNull();
    expect(record?.resolvedAt).toBeNull();
    expect(record?.probabilitySource).toBe('MODEL_ESTIMATE');
    expect(record?.calibrationStatus).toBe('UNCALIBRATED');
  });

  it('accepts a missing observation timestamp without inventing one', () => {
    const record = createPredictionRecord(base);
    expect(record?.dataObservedAt).toBeNull();
  });

  it('rejects invalid probabilities, confidence and market odds', () => {
    expect(createPredictionRecord({ ...base, probability: 101 })).toBeNull();
    expect(createPredictionRecord({ ...base, confidence: -1 })).toBeNull();
    expect(createPredictionRecord({ ...base, marketOdd: 1 })).toBeNull();
  });

  it('resolves once and never mutates the original', () => {
    const record = createPredictionRecord(base)!;
    const resolved = resolvePrediction(record, true, '2026-09-08T12:00:00Z');
    expect(record.outcome).toBeNull();
    expect(resolved?.outcome).toBe(true);
    expect(resolvePrediction(resolved!, false, '2026-09-08T13:00:00Z')).toBeNull();
  });
});
