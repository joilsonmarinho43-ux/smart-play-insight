import { describe, expect, it } from 'vitest';
import { buildLedgerPrediction } from '@/lib/predictionLedgerPersistence';
import type { NexusDecisionOutput } from '@/lib/nexusDecisionCore';
import type { MarketAnalysis } from '@/types/match';

const decision: NexusDecisionOutput = {
  decision: 'SIGNAL',
  confidence: 90,
  riskScore: 10,
  selectedMarket: null,
  reasonCodes: ['CORE_APPROVED_SIGNAL'],
  evidenceScore: 90,
  signalEligible: true,
};

const market: MarketAnalysis = {
  market: 'Over 1.5 Gols',
  probability: 86,
  risk: 'low',
  category: 'goals',
  probabilitySource: 'MODEL_ESTIMATE',
  calibrationStatus: 'CALIBRATED',
  odd: undefined,
};

describe('predictionLedgerPersistence', () => {
  it('builds only an authoritative pre-match model prediction', () => {
    const record = buildLedgerPrediction({
      predictionId: 'p1', matchId: 'm1', decision, market,
      modelVersion: 'nexus-v1', dataQualityScore: 95, dataQualityStatus: 'VALID',
      dataObservedAt: null, predictedAt: '2026-09-08T10:00:00Z',
    });

    expect(record?.probability).toBe(86);
    expect(record?.marketOdd).toBeNull();
    expect(record?.dataObservedAt).toBeNull();
  });

  it('rejects non-signal decisions', () => {
    expect(buildLedgerPrediction({
      predictionId: 'p2', matchId: 'm1',
      decision: { ...decision, decision: 'CONSERVATIVE', signalEligible: false },
      market, modelVersion: 'nexus-v1', dataQualityScore: 95, dataQualityStatus: 'VALID',
    })).toBeNull();
  });

  it('rejects heuristic probabilities even when confidence is high', () => {
    expect(buildLedgerPrediction({
      predictionId: 'p3', matchId: 'm1', decision,
      modelVersion: 'nexus-v1', dataQualityScore: 95, dataQualityStatus: 'VALID',
      market: { ...market, probabilitySource: 'HEURISTIC' },
    })).toBeNull();
  });

  it('rejects uncalibrated probabilities', () => {
    expect(buildLedgerPrediction({
      predictionId: 'p4', matchId: 'm1', decision,
      modelVersion: 'nexus-v1', dataQualityScore: 95, dataQualityStatus: 'VALID',
      market: { ...market, calibrationStatus: 'UNCALIBRATED' },
    })).toBeNull();
  });

  it('rejects degraded or rejected data quality', () => {
    expect(buildLedgerPrediction({
      predictionId: 'p5', matchId: 'm1', decision, market, modelVersion: 'nexus-v1',
      dataQualityScore: 70, dataQualityStatus: 'DEGRADED',
    })).toBeNull();
    expect(buildLedgerPrediction({
      predictionId: 'p6', matchId: 'm1', decision, market, modelVersion: 'nexus-v1',
      dataQualityScore: 0, dataQualityStatus: 'REJECT',
    })).toBeNull();
  });
});
